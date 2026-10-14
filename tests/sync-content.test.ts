import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { syncService } from '../scripts/lib/external-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

test('sync dry-run does not write files, and a repeated sync is idempotent', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const item = {
    date: new Date('2026-10-03'),
    title: 'New post',
    url: 'https://sizu.me/chihiroxx/posts/new-post',
  };
  const options = {
    contentDirectory,
    feedLoader: async () => [item],
    linkVerifier: async () => 'public' as const,
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
  let linkChecks = 0;
  const title = 'Updated "quoted" title\nsecond line';
  await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => [{ date: new Date('2026-10-02'), title, url }],
    linkVerifier: async () => {
      linkChecks += 1;
      return 'public';
    },
    linkCheckBatchIntervalMs: 0,
  });

  assert.equal(linkChecks, 0);
  assert.deepEqual(await readdir(articlesDirectory), ['legacy-name.yaml']);
  assert.deepEqual(YAML.parse(await readFile(file, 'utf8')), {
    date: '2026-10-02',
    types: ['手動分類', '追加カテゴリ'],
    title,
    url,
  });
});

test('sync does not refill a capped slot after its selected addition is deleted', async (t) => {
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
  const checked: string[] = [];

  await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => feed,
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
  let linkChecks = 0;

  await assert.rejects(
    syncService('sizu', {
      contentDirectory,
      feedLoader: async () => {
        feedCalls += 1;
        return [];
      },
      linkVerifier: async () => {
        linkChecks += 1;
        return 'public';
      },
    }),
    /articles URL is duplicated/,
  );

  assert.equal(feedCalls, 0);
  assert.equal(linkChecks, 0);
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
      linkVerifier: async () => 'public',
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

test('sync rejects conflicting duplicate feed URLs before verification or file changes', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  let verifications = 0;
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
        linkVerifier: async () => {
          verifications += 1;
          return 'public';
        },
      }),
      /Conflicting RSS items for URL/,
    );
    assert.deepEqual(
      await readdir(path.join(contentDirectory, 'articles')),
      [],
    );
  }
  assert.equal(verifications, 0);
});

test('sync validates saved YAML values with file and field context before loading RSS', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const filename = 'invalid.yaml';
  const file = path.join(contentDirectory, 'articles', filename);
  const validFields = {
    date: '2026-10-03',
    types: ['日常記事'],
    title: 'Valid post',
    url: 'https://sizu.me/chihiroxx/posts/valid',
  };
  const cases: { field: string; yaml: string }[] = [
    { field: 'date', yaml: YAML.stringify({ ...validFields, date: 2026 }) },
    {
      field: 'date',
      yaml: YAML.stringify({ ...validFields, date: 'not-a-date' }),
    },
    { field: 'title', yaml: YAML.stringify({ ...validFields, title: null }) },
    { field: 'title', yaml: YAML.stringify({ ...validFields, title: '  ' }) },
    { field: 'url', yaml: YAML.stringify({ ...validFields, url: null }) },
    {
      field: 'url',
      yaml: YAML.stringify({ ...validFields, url: 'not a URL' }),
    },
    { field: 'types', yaml: YAML.stringify({ ...validFields, types: null }) },
    { field: 'types', yaml: YAML.stringify({ ...validFields, types: [] }) },
    { field: 'types', yaml: YAML.stringify({ ...validFields, types: [''] }) },
    { field: 'types', yaml: YAML.stringify({ ...validFields, types: [1] }) },
    { field: '<root>', yaml: 'null' },
    { field: '<root>', yaml: '[]' },
    { field: 'YAML', yaml: 'date: [unterminated' },
  ];

  let feedCalls = 0;
  let linkChecks = 0;
  for (const invalid of cases) {
    await writeFile(file, invalid.yaml);
    await assert.rejects(
      syncService('sizu', {
        contentDirectory,
        feedLoader: async () => {
          feedCalls += 1;
          return [];
        },
        linkVerifier: async () => {
          linkChecks += 1;
          return 'public';
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(file) &&
        error.message.includes(invalid.field),
      `invalid ${invalid.field} should identify ${filename}`,
    );
  }
  assert.equal(feedCalls, 0);
  assert.equal(linkChecks, 0);
});

test('sync deadline keeps existing files unchanged and does not partially apply checked feed items', async (t) => {
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
  const original = await readFile(
    path.join(articlesDirectory, 'existing.yaml'),
    'utf8',
  );
  const controller = new AbortController();
  let remaining = 1000;
  let checks = 0;
  const result = await syncService('sizu', {
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
    executionContext: {
      signal: controller.signal,
      remainingMs: () => remaining,
      dispose: () => {},
    },
    linkCheckBatchIntervalMs: 0,
    linkVerifier: async () => {
      checks += 1;
      if (checks === 2) {
        remaining = 0;
        controller.abort(new Error('deadline'));
      }
      return 'public';
    },
  });
  assert.equal(result.unchecked.length, 2);
  assert.deepEqual(await readdir(articlesDirectory), ['existing.yaml']);
  assert.equal(
    await readFile(path.join(articlesDirectory, 'existing.yaml'), 'utf8'),
    original,
  );
});

test('sync still fails before applying any file when new link checks return defer or review', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  for (const status of ['defer', 'review'] as const) {
    let failure: Error & {
      report?: { deferred: unknown[]; review: unknown[] };
    };
    try {
      await syncService('sizu', {
        contentDirectory,
        feedLoader: async () => [
          {
            date: new Date('2026-10-03'),
            title: 'New item',
            url: `https://sizu.me/chihiroxx/posts/${status}`,
          },
        ],
        linkVerifier: async () => status,
        linkCheckBatchIntervalMs: 0,
      });
      throw new Error('sync unexpectedly succeeded');
    } catch (error) {
      failure = error as Error & {
        report?: { deferred: unknown[]; review: unknown[] };
      };
    }
    assert.match(failure.message, /Could not verify new items/);
    assert.equal(
      failure.report?.[status === 'defer' ? 'deferred' : 'review'].length,
      1,
    );
    assert.deepEqual(
      await readdir(path.join(contentDirectory, 'articles')),
      [],
    );
  }
});
