import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import YAML from 'yaml';
import { syncService } from '../scripts/lib/external-content.ts';

async function createContentDirectory(t: TestContext): Promise<string> {
  const contentDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'nemumi-content-'),
  );
  await Promise.all(
    ['articles', 'talks'].map((collection) =>
      mkdir(path.join(contentDirectory, collection)),
    ),
  );
  t.after(() => rm(contentDirectory, { recursive: true, force: true }));
  return contentDirectory;
}

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

  await syncService('sizu', options);
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
    forward.changes[0].data.url,
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
