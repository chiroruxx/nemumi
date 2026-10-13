import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import YAML from 'yaml';
import { runPruneContent } from '../scripts/cli/prune-content.ts';
import { pruneContent } from '../scripts/lib/external-content.ts';

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

test('prune CLI passes dry-run through and emits an empty result summary', async () => {
  const output: string[] = [];
  const summaries: string[] = [];
  let receivedDryRun = false;

  await runPruneContent({
    dryRun: true,
    prune: async (options) => {
      receivedDryRun = options?.dryRun ?? false;
      return { removals: [] };
    },
    writeOutput: (value) => output.push(value),
    writeSummary: async (value) => {
      summaries.push(value);
    },
  });

  assert.equal(receivedDryRun, true);
  assert.deepEqual(JSON.parse(output[0]), { removals: [] });
  assert.deepEqual(summaries, ['削除対象はありません。']);
});

test('pruning honors the directory cap, preserves manual content, and dry-run leaves files intact', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');

  for (let index = 1; index <= 20; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `entry-${suffix}.yaml`),
      YAML.stringify({
        date: `2020-01-${suffix}`,
        types: ['日常記事'],
        title: `Post ${suffix}`,
        url: `https://sizu.me/chihiroxx/posts/post-${suffix}`,
      }),
    );
  }
  const manualFilename = 'manual.yaml';
  await writeFile(
    path.join(articlesDirectory, manualFilename),
    YAML.stringify({
      date: '2020-01-21',
      title: 'Manual entry',
      url: 'https://example.com/manual',
    }),
  );

  const options = {
    contentDirectory,
    linkVerifier: async (url: string) =>
      url.endsWith('/post-02') ? ('deleted' as const) : ('public' as const),
    linkCheckIntervalMs: 0,
  };
  const dryRun = await pruneContent({ ...options, dryRun: true });
  assert.deepEqual(
    dryRun.removals.map(({ reason, entry }) => [reason, entry.id]),
    [
      ['limit', 'entry-01.yaml'],
      ['link', 'entry-02.yaml'],
    ],
  );
  assert.equal((await readdir(articlesDirectory)).length, 21);

  const applied = await pruneContent(options);
  assert.equal(applied.removals.length, 2);
  const remainingFiles = await readdir(articlesDirectory);
  assert.equal(remainingFiles.length, 19);
  assert.ok(remainingFiles.includes(manualFilename));
  assert.ok(remainingFiles.includes('entry-03.yaml'));
});

test('pruning ranks saved entries without requesting RSS feeds', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 21; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `entry-${suffix}.yaml`),
      YAML.stringify({
        date: `2020-01-${suffix}`,
        title: `Saved post ${suffix}`,
        url: `https://sizu.me/chihiroxx/posts/saved-${suffix}`,
      }),
    );
  }

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('RSS must not be fetched while pruning');
  };
  try {
    const result = await pruneContent({
      contentDirectory,
      linkVerifier: async () => 'public',
      linkCheckIntervalMs: 0,
    });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(
      result.removals.map(({ reason, entry }) => [reason, entry.id]),
      [['limit', 'entry-01.yaml']],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
