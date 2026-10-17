import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { checkContentLinks } from '../scripts/lib/check-content-links.ts';
import { syncService } from '../scripts/lib/sync-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

test('sync dry-run does not write files, and a repeated sync is idempotent', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const item = {
    date: new Date('2026-10-03'),
    title: 'New post',
    url: 'https://sizu.me/chihiroxx/posts/new-post',
  };
  const options: NonNullable<Parameters<typeof syncService>[1]> = {
    contentDirectory,
    feedLoader: async () => [item],
  };

  await syncService('sizu', { ...options, dryRun: true });
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), []);

  await syncService('sizu', options);
  const files = await readdir(path.join(contentDirectory, 'articles'));
  assert.equal(files.length, 1);
  const saved = YAML.parse(
    await readFile(path.join(contentDirectory, 'articles', files[0]), 'utf8'),
  );
  assert.deepEqual(saved.types, ['日常記事']);
  assert.equal(saved.url, item.url);

  await syncService('sizu', options);
  assert.equal(
    (await readdir(path.join(contentDirectory, 'articles'))).length,
    1,
  );
});

test('sync updates the existing filename, keeps types, and round-trips quoted multiline titles', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  const file = path.join(articlesDirectory, 'legacy-name.yaml');
  const url = 'https://sizu.me/chihiroxx/posts/existing';
  await writeFile(
    file,
    YAML.stringify({
      date: '2026-10-01',
      types: ['手動分類', '追加カテゴリ'],
      title: 'Previous title',
      url,
    }),
  );
  const title = 'Updated "quoted" title\nsecond line';
  await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => [{ date: new Date('2026-10-02'), title, url }],
  });

  assert.deepEqual(await readdir(articlesDirectory), ['legacy-name.yaml']);
  assert.deepEqual(YAML.parse(await readFile(file, 'utf8')), {
    date: '2026-10-02',
    types: ['手動分類', '追加カテゴリ'],
    title,
    url,
  });
});

test('sync adds selected candidates and the shared link check removes invalid additions', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 19; index += 1) {
    const id = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `manual-${id}.yaml`),
      YAML.stringify({
        date: '2026-10-01',
        title: `Manual ${id}`,
        url: `https://example.com/manual-${id}`,
      }),
    );
  }
  const feed = [
    {
      date: new Date('2026-10-03'),
      title: 'Deleted',
      url: 'https://sizu.me/chihiroxx/posts/deleted',
    },
    {
      date: new Date('2026-10-02'),
      title: 'Public',
      url: 'https://sizu.me/chihiroxx/posts/public',
    },
  ];
  await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => feed,
  });

  assert.ok((await readdir(articlesDirectory)).length > 19);
  const checked: string[] = [];
  await checkContentLinks({
    contentDirectory,
    linkCheckBatchIntervalMs: 0,
    linkVerifier: async (url) => {
      checked.push(url);
      return url.endsWith('/deleted') ? 'deleted' : 'public';
    },
  });
  assert.deepEqual(checked, [feed[0].url]);
  const savedUrls = await Promise.all(
    (await readdir(articlesDirectory)).map(async (file) => {
      const saved = YAML.parse(
        await readFile(path.join(articlesDirectory, file), 'utf8'),
      );
      return saved.url as string;
    }),
  );
  assert.deepEqual(
    savedUrls.sort(),
    Array.from(
      { length: 19 },
      (_, index) =>
        `https://example.com/manual-${String(index + 1).padStart(2, '0')}`,
    ),
  );
  assert.equal(savedUrls.includes(feed[1].url), false);
});

test('sync rejects duplicate saved URLs before feed loading and leaves both files unchanged', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  const entries = [
    ['first.yaml', 'https://sizu.me/chihiroxx/posts/duplicate#first'],
    ['second.yaml', 'https://sizu.me/chihiroxx/posts/duplicate#second'],
  ] as const;
  for (const [name, url] of entries) {
    await writeFile(
      path.join(articlesDirectory, name),
      YAML.stringify({ date: '2026-10-01', title: name, url }),
    );
  }
  const originalFiles = await Promise.all(
    entries.map(([name]) =>
      readFile(path.join(articlesDirectory, name), 'utf8'),
    ),
  );
  let feedCalls = 0;

  await assert.rejects(
    syncService('sizu', {
      contentDirectory,
      feedLoader: async () => {
        feedCalls += 1;
        return [];
      },
    }),
    /articles URL is duplicated/,
  );

  assert.equal(feedCalls, 0);
  assert.deepEqual(await readdir(articlesDirectory), [
    'first.yaml',
    'second.yaml',
  ]);
  assert.deepEqual(
    await Promise.all(
      entries.map(([name]) =>
        readFile(path.join(articlesDirectory, name), 'utf8'),
      ),
    ),
    originalFiles,
  );
});

test('sync deduplicates identical feed content after fragment normalization regardless of input order', async (t) => {
  const baseDirectory = await createContentDirectory(t);
  const forwardDirectory = path.join(baseDirectory, 'forward');
  const reverseDirectory = path.join(baseDirectory, 'reverse');
  await Promise.all([
    mkdir(path.join(forwardDirectory, 'articles'), { recursive: true }),
    mkdir(path.join(forwardDirectory, 'talks'), { recursive: true }),
    mkdir(path.join(reverseDirectory, 'articles'), { recursive: true }),
    mkdir(path.join(reverseDirectory, 'talks'), { recursive: true }),
  ]);
  const item = {
    date: new Date('2026-10-03'),
    title: 'Repeated post',
    url: 'https://sizu.me/chihiroxx/posts/repeated?ref=rss#first',
  };
  const duplicate = {
    ...item,
    url: `${item.url.slice(0, item.url.indexOf('#'))}#second`,
  };
  const run = (contentDirectory: string, items: (typeof item)[]) =>
    syncService('sizu', {
      contentDirectory,
      feedLoader: async () => items,
    });

  await run(forwardDirectory, [item, duplicate]);
  await run(reverseDirectory, [duplicate, item]);
  const savedEntries = await Promise.all(
    [forwardDirectory, reverseDirectory].map(async (directory) => {
      const articleDirectory = path.join(directory, 'articles');
      const files = await readdir(articleDirectory);
      assert.equal(files.length, 1);
      const filename = files[0];
      assert.ok(filename);
      return YAML.parse(
        await readFile(path.join(articleDirectory, filename), 'utf8'),
      );
    }),
  );
  assert.deepEqual(savedEntries[0], savedEntries[1]);
  assert.equal(
    savedEntries[0]?.url,
    'https://sizu.me/chihiroxx/posts/repeated?ref=rss',
  );
});

test('sync rejects conflicting duplicate feed URLs before file changes', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const items = [
    {
      date: new Date('2026-10-03'),
      title: 'First title',
      url: 'https://sizu.me/chihiroxx/posts/conflict#first',
    },
    {
      date: new Date('2026-10-03'),
      title: 'Second title',
      url: 'https://sizu.me/chihiroxx/posts/conflict#second',
    },
  ];
  const dateConflict = [
    {
      date: new Date('2026-10-03'),
      title: 'Same title',
      url: 'https://sizu.me/chihiroxx/posts/date-conflict#first',
    },
    {
      date: new Date('2026-10-02'),
      title: 'Same title',
      url: 'https://sizu.me/chihiroxx/posts/date-conflict#second',
    },
  ];
  for (const feedItems of [
    items,
    [...items].reverse(),
    dateConflict,
    [...dateConflict].reverse(),
  ]) {
    await assert.rejects(
      syncService('sizu', {
        contentDirectory,
        feedLoader: async () => feedItems,
      }),
      /Conflicting RSS items for URL/,
    );
    assert.deepEqual(
      await readdir(path.join(contentDirectory, 'articles')),
      [],
    );
  }
});

test('sync validates saved YAML values with file and field context before loading RSS', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const filename = 'invalid.yaml';
  const file = path.join(contentDirectory, 'articles', filename);
  const cases = [
    { field: 'title', yaml: 'date: 2026-10-03\ntitle: null\n' },
    { field: 'YAML', yaml: 'date: [unterminated' },
  ];

  for (const invalid of cases) {
    await writeFile(file, invalid.yaml);
    await assert.rejects(
      syncService('sizu', {
        contentDirectory,
        feedLoader: async () => assert.fail('RSS must not be loaded'),
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(file) &&
        error.message.includes(invalid.field),
      `invalid ${invalid.field} should identify ${filename}`,
    );
    assert.equal(await readFile(file, 'utf8'), invalid.yaml);
    assert.deepEqual(await readdir(path.dirname(file)), [filename]);
  }
});

test('sync applies feed changes without checking item links', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  await writeFile(
    path.join(articlesDirectory, 'existing.yaml'),
    YAML.stringify({
      date: '2026-10-01',
      title: 'Saved title',
      url: 'https://sizu.me/chihiroxx/posts/existing',
    }),
  );
  await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => [
      {
        date: new Date('2026-10-02'),
        title: 'Updated title',
        url: 'https://sizu.me/chihiroxx/posts/existing',
      },
      {
        date: new Date('2026-10-03'),
        title: 'New item',
        url: 'https://sizu.me/chihiroxx/posts/new',
      },
      {
        date: new Date('2026-10-04'),
        title: 'Another new item',
        url: 'https://sizu.me/chihiroxx/posts/another-new',
      },
    ],
  });
  assert.equal((await readdir(articlesDirectory)).length, 3);
  const saved = YAML.parse(
    await readFile(path.join(articlesDirectory, 'existing.yaml'), 'utf8'),
  );
  assert.equal(saved.title, 'Updated title');
});
