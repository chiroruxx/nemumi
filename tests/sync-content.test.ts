import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { checkContentLinks } from '../scripts/lib/check-content-links.ts';
import { pruneContent } from '../scripts/lib/prune-content.ts';
import { syncService } from '../scripts/lib/sync-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

test('sync dry-run does not write files, and a repeated sync is idempotent', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const item = {
    date: new Date('2026-10-03'),
    title: 'New post',
    url: new URL('https://sizu.me/chihiroxx/posts/new-post'),
  };
  const options: NonNullable<Parameters<typeof syncService>[1]> = {
    contentDirectory: path.relative(process.cwd(), contentDirectory),
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
  assert.equal(saved.url, item.url.href);

  const savedFile = path.join(contentDirectory, 'articles', files[0]);
  const timestamp = new Date('2000-01-01');
  await utimes(savedFile, timestamp, timestamp);
  await syncService('sizu', options);
  assert.equal(
    (await readdir(path.join(contentDirectory, 'articles'))).length,
    1,
  );
  assert.equal((await stat(savedFile)).mtime.getTime(), timestamp.getTime());
});

test('sync updates the existing filename, keeps types, and round-trips quoted multiline titles', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  const file = path.join(articlesDirectory, 'legacy-name.yaml');
  const url = 'https://sizu.me/chihiroxx/posts/existing';
  for (const types of [['手動分類', '追加カテゴリ'], undefined]) {
    await writeFile(
      file,
      YAML.stringify({
        date: '2026-10-01',
        ...(types === undefined ? {} : { types }),
        title: 'Previous title',
        url,
      }),
    );
    const title = 'Updated "quoted" title\nsecond line';
    await syncService('sizu', {
      contentDirectory,
      feedLoader: async () => [
        { date: new Date('2026-10-02'), title, url: new URL(url) },
      ],
    });

    assert.deepEqual(await readdir(articlesDirectory), ['legacy-name.yaml']);
    assert.deepEqual(YAML.parse(await readFile(file, 'utf8')), {
      date: '2026-10-02',
      types: types ?? ['日常記事'],
      title,
      url,
    });
  }
});

test('sync imports all feed candidates before link checks and pruning', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 20; index += 1) {
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
      url: new URL('https://sizu.me/chihiroxx/posts/deleted'),
    },
    {
      date: new Date('2026-09-30'),
      title: 'Public',
      url: new URL('https://sizu.me/chihiroxx/posts/public'),
    },
  ];
  await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => feed,
  });

  assert.equal((await readdir(articlesDirectory)).length, 22);
  const checked: string[] = [];
  await checkContentLinks({
    contentDirectory,
    linkCheckBatchIntervalMs: 0,
    linkVerifier: async (url) => {
      checked.push(url.href);
      return url.href.endsWith('/deleted') ? 'deleted' : 'public';
    },
  });
  assert.deepEqual(checked, [feed[0].url.href, feed[1].url.href]);
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
    [
      ...Array.from(
        { length: 20 },
        (_, index) =>
          `https://example.com/manual-${String(index + 1).padStart(2, '0')}`,
      ),
      feed[1].url.href,
    ].sort(),
  );
  assert.equal(savedUrls.includes(feed[1].url.href), true);
  await pruneContent({ contentDirectory });
  const remaining = await readdir(articlesDirectory);
  assert.equal(remaining.length, 20);
  assert.ok(remaining.every((file) => file.startsWith('manual-')));
});

test('sync rejects duplicate saved URLs and filename collisions without changing content', async (t) => {
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
  await Promise.all(
    entries.map(([name]) => rm(path.join(articlesDirectory, name))),
  );
  const url = 'https://sizu.me/chihiroxx/posts/collision';
  const filename = `sizu-${createHash('sha256').update(url).digest('hex')}.yaml`;
  const manual = YAML.stringify({
    date: '2026-10-01',
    title: 'Manual',
    url: 'https://example.com/manual',
  });
  await writeFile(path.join(articlesDirectory, filename), manual);
  await assert.rejects(
    syncService('sizu', {
      contentDirectory,
      feedLoader: async () => [
        { date: new Date('2026-10-03'), title: 'Collision', url: new URL(url) },
      ],
    }),
    /Filename collision while adding/,
  );
  assert.deepEqual(await readdir(articlesDirectory), [filename]);
  assert.equal(
    await readFile(path.join(articlesDirectory, filename), 'utf8'),
    manual,
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
    url: new URL('https://sizu.me/chihiroxx/posts/repeated?ref=rss#first'),
  };
  const duplicate = {
    ...item,
    date: new Date(item.date),
    url: new URL('#second', item.url),
  };
  const run = (contentDirectory: string, items: (typeof item)[]) =>
    syncService('sizu', {
      contentDirectory,
      feedLoader: async () => items,
    });

  await run(forwardDirectory, [item, duplicate]);
  await run(reverseDirectory, [duplicate, item]);
  assert.equal(item.url.hash, '#first');
  assert.equal(duplicate.url.hash, '#second');
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
      url: new URL('https://sizu.me/chihiroxx/posts/conflict#first'),
    },
    {
      date: new Date('2026-10-03'),
      title: 'Second title',
      url: new URL('https://sizu.me/chihiroxx/posts/conflict#second'),
    },
  ];
  const dateConflict = [
    {
      date: new Date('2026-10-03'),
      title: 'Same title',
      url: new URL('https://sizu.me/chihiroxx/posts/date-conflict#first'),
    },
    {
      date: new Date('2026-10-02'),
      title: 'Same title',
      url: new URL('https://sizu.me/chihiroxx/posts/date-conflict#second'),
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
    {
      field: 'types',
      yaml: 'date: 2026-10-03\ntitle: Invalid types\ntypes: []\n',
    },
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
  for (let index = 1; index <= 20; index += 1) {
    await writeFile(
      path.join(articlesDirectory, `hatena-${index}.yaml`),
      YAML.stringify({
        date: '2026-10-20',
        title: `Hatena ${index}`,
        url: `https://toyo.hatenablog.jp/entry/${index}`,
      }),
    );
  }
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
        url: new URL('https://sizu.me/chihiroxx/posts/existing'),
      },
      {
        date: new Date('2026-10-03'),
        title: 'New item',
        url: new URL('https://sizu.me/chihiroxx/posts/new'),
      },
      {
        date: new Date('2026-10-04'),
        title: 'Another new item',
        url: new URL('https://sizu.me/chihiroxx/posts/another-new'),
      },
    ],
  });
  assert.equal((await readdir(articlesDirectory)).length, 23);
  const saved = YAML.parse(
    await readFile(path.join(articlesDirectory, 'existing.yaml'), 'utf8'),
  );
  assert.equal(saved.title, 'Updated title');
});
