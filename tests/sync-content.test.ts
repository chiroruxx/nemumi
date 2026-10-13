import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { syncService } from '../scripts/lib/external-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

test('sync dry-run does not write files, and a repeated sync is idempotent', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const item = {
    date: '2026-10-03',
    title: 'New post',
    url: 'https://sizu.me/chihiroxx/posts/new-post',
  };
  const options = {
    contentDirectory,
    feedLoader: async () => [item],
    linkVerifier: async () => 'public' as const,
  };

  const dryRun = await syncService('sizu', { ...options, dryRun: true });
  assert.equal(dryRun.changes.length, 1);
  assert.equal(dryRun.changes[0].action, 'add');
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), []);

  const applied = await syncService('sizu', options);
  assert.deepEqual(applied.changes, dryRun.changes);
  const files = await readdir(path.join(contentDirectory, 'articles'));
  assert.equal(files.length, 1);
  const saved = YAML.parse(
    await readFile(path.join(contentDirectory, 'articles', files[0]), 'utf8'),
  );
  assert.deepEqual(saved.types, ['日常記事']);
  assert.equal(saved.url, item.url);

  const repeated = await syncService('sizu', options);
  assert.deepEqual(repeated.changes, []);
});

test('sync deduplicates identical feed content after fragment normalization regardless of input order', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const item = {
    date: '2026-10-03',
    title: 'Repeated post',
    url: 'https://sizu.me/chihiroxx/posts/repeated?ref=rss#first',
  };
  const duplicate = {
    ...item,
    url: `${item.url.slice(0, item.url.indexOf('#'))}#second`,
  };
  const run = (items: (typeof item)[]) =>
    syncService('sizu', {
      contentDirectory,
      dryRun: true,
      feedLoader: async () => items,
      linkVerifier: async () => 'public',
    });

  const forward = await run([item, duplicate]);
  const reverse = await run([duplicate, item]);
  assert.equal(forward.changes.length, 1);
  assert.equal(reverse.changes.length, 1);
  assert.deepEqual(forward.changes, reverse.changes);
  assert.equal(
    forward.changes[0].url,
    'https://sizu.me/chihiroxx/posts/repeated?ref=rss',
  );
});

test('sync rejects conflicting duplicate feed URLs before verification or file changes', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  let verifications = 0;
  const items = [
    {
      date: '2026-10-03',
      title: 'First title',
      url: 'https://sizu.me/chihiroxx/posts/conflict#first',
    },
    {
      date: '2026-10-03',
      title: 'Second title',
      url: 'https://sizu.me/chihiroxx/posts/conflict#second',
    },
  ];
  const dateConflict = [
    {
      date: '2026-10-03',
      title: 'Same title',
      url: 'https://sizu.me/chihiroxx/posts/date-conflict#first',
    },
    {
      date: '2026-10-02',
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
        date: '2026-10-02',
        title: 'Updated title',
        url: 'https://sizu.me/chihiroxx/posts/existing',
      },
      {
        date: '2026-10-03',
        title: 'New item',
        url: 'https://sizu.me/chihiroxx/posts/new',
      },
      {
        date: '2026-10-04',
        title: 'Another new item',
        url: 'https://sizu.me/chihiroxx/posts/another-new',
      },
    ],
    executionContext: {
      signal: controller.signal,
      remainingMs: () => remaining,
      dispose: () => {},
    },
    linkCheckIntervalMs: 0,
    linkVerifier: async () => {
      checks += 1;
      if (checks === 2) {
        remaining = 0;
        controller.abort(new Error('deadline'));
      }
      return 'public';
    },
  });
  assert.deepEqual(result.changes, []);
  assert.equal(result.unchecked.length, 2);
  assert.equal(result.kept, 1);
  assert.deepEqual(await readdir(articlesDirectory), ['existing.yaml']);
  assert.equal(
    await readFile(path.join(articlesDirectory, 'existing.yaml'), 'utf8'),
    original,
  );
});

test('sync deadline preserves confirmed deleted additions alongside unchecked additions', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const controller = new AbortController();
  let remaining = 1000;
  let calls = 0;
  const result = await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => [
      {
        date: '2026-10-02',
        title: 'Deleted item',
        url: 'https://sizu.me/chihiroxx/posts/deleted',
      },
      {
        date: '2026-10-03',
        title: 'Unchecked item',
        url: 'https://sizu.me/chihiroxx/posts/unchecked',
      },
    ],
    executionContext: {
      signal: controller.signal,
      remainingMs: () => remaining,
      dispose: () => {},
    },
    linkCheckIntervalMs: 0,
    linkVerifier: async (url) => {
      calls += 1;
      if (url.endsWith('/deleted')) return 'deleted';
      await new Promise((resolve) => setTimeout(resolve, 0));
      remaining = 0;
      controller.abort(new Error('deadline'));
      return await new Promise(() => {});
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.skipped, [
    {
      source: 'sizu',
      url: 'https://sizu.me/chihiroxx/posts/deleted',
      status: 'deleted',
      reason: 'deleted',
    },
    {
      source: 'sizu',
      url: 'https://sizu.me/chihiroxx/posts/unchecked',
      status: 'unchecked',
      reason: 'execution-deadline',
    },
  ]);
  assert.equal(result.unchecked.length, 1);
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), []);
});

test('sync reports counts only for the collection it read', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  await writeFile(
    path.join(contentDirectory, 'talks', 'existing.yaml'),
    YAML.stringify({
      date: '2026-10-03',
      title: 'Unobserved collection entry',
      url: 'https://speakerdeck.com/chiroruxx/existing',
    }),
  );
  const result = await syncService('sizu', {
    contentDirectory,
    feedLoader: async () => [],
    linkCheckIntervalMs: 0,
  });
  assert.deepEqual(result.remainingByCollection, { articles: 0 });
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
            date: '2026-10-03',
            title: 'New item',
            url: `https://sizu.me/chihiroxx/posts/${status}`,
          },
        ],
        linkVerifier: async () => status,
        linkCheckIntervalMs: 0,
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
