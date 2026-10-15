import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import type { ExecutionContext } from '../scripts/lib/external-content-http.ts';
import { pruneContent } from '../scripts/lib/prune-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

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
      memo: 'storage-only field',
    }),
  );

  const options: NonNullable<Parameters<typeof pruneContent>[0]> = {
    contentDirectory,
    linkVerifier: async (url: string) => {
      if (url.endsWith('/post-02')) return 'deleted' as const;
      if (url.endsWith('/post-03')) return 'defer' as const;
      if (url.endsWith('/post-04')) return 'review' as const;
      return 'public' as const;
    },
    linkCheckBatchIntervalMs: 0,
  };
  const dryRun = await pruneContent({ ...options, dryRun: true });
  assert.deepEqual(
    dryRun.deferred.map(({ url }) => url),
    ['https://sizu.me/chihiroxx/posts/post-03'],
  );
  assert.deepEqual(
    dryRun.review.map(({ url }) => url),
    ['https://sizu.me/chihiroxx/posts/post-04'],
  );
  assert.deepEqual(
    (await readdir(articlesDirectory)).sort(),
    [
      ...Array.from(
        { length: 20 },
        (_, index) => `entry-${String(index + 1).padStart(2, '0')}.yaml`,
      ),
      manualFilename,
    ].sort(),
  );
  assert.equal((await readdir(articlesDirectory)).length, 21);

  const result = await pruneContent(options);
  assert.deepEqual(
    result.deferred.map(({ url }) => url),
    ['https://sizu.me/chihiroxx/posts/post-03'],
  );
  assert.deepEqual(
    result.review.map(({ url }) => url),
    ['https://sizu.me/chihiroxx/posts/post-04'],
  );
  const remainingFiles = await readdir(articlesDirectory);
  assert.equal(remainingFiles.length, 19);
  assert.ok(remainingFiles.includes(manualFilename));
  assert.ok(remainingFiles.includes('entry-03.yaml'));
  assert.equal(remainingFiles.includes('entry-01.yaml'), false);
  assert.equal(remainingFiles.includes('entry-02.yaml'), false);
});

test('pruning stops without changing files when manual entries exceed the collection cap', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 21; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `manual-${suffix}.yaml`),
      YAML.stringify({
        date: `2026-10-${suffix}`,
        title: `Manual ${suffix}`,
        url: `https://example.com/manual-${suffix}`,
      }),
    );
  }
  let linkChecks = 0;

  await assert.rejects(
    pruneContent({
      contentDirectory,
      linkVerifier: async () => {
        linkChecks += 1;
        return 'public';
      },
      linkCheckBatchIntervalMs: 0,
    }),
    /articles manual entries exceed its 20 item limit/,
  );

  assert.equal(linkChecks, 0);
  assert.equal((await readdir(articlesDirectory)).length, 21);
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
    await pruneContent({
      contentDirectory,
      linkVerifier: async () => 'public',
      linkCheckBatchIntervalMs: 0,
    });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(
      (await readdir(path.join(contentDirectory, 'articles'))).sort(),
      Array.from(
        { length: 20 },
        (_, index) => `entry-${String(index + 2).padStart(2, '0')}.yaml`,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pruning preserves manual entries and applies each collection limit under an articles-named parent', async (t) => {
  const baseDirectory = await createContentDirectory(t);
  const contentDirectory = path.join(baseDirectory, 'articles');
  const articlesDirectory = path.join(contentDirectory, 'articles');
  const talksDirectory = path.join(contentDirectory, 'talks');
  await mkdir(articlesDirectory);
  await mkdir(talksDirectory);
  await writeFile(
    path.join(articlesDirectory, 'manual.yaml'),
    YAML.stringify({
      date: '2026-10-01',
      title: 'Manual entry',
      memo: 'storage-only field',
    }),
  );
  for (let index = 1; index <= 11; index += 1) {
    await writeFile(
      path.join(talksDirectory, `talk-${index}.yaml`),
      YAML.stringify({
        date: `2026-10-${String(index).padStart(2, '0')}`,
        title: `Talk ${index}`,
        memo: 'storage-only field',
        url: `https://speakerdeck.com/chiroruxx/talk-${index}`,
      }),
    );
  }
  await pruneContent({
    contentDirectory,
    linkVerifier: async () => 'public',
    linkCheckBatchIntervalMs: 0,
  });
  assert.deepEqual((await readdir(articlesDirectory)).sort(), ['manual.yaml']);
  assert.equal((await readdir(talksDirectory)).length, 10);
});

test('pruning applies confirmed limit and link removals while retaining unchecked links at deadline', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 21; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `entry-${suffix}.yaml`),
      YAML.stringify({
        date: `2020-01-${suffix}`,
        title: `Post ${suffix}`,
        url: `https://sizu.me/chihiroxx/posts/post-${suffix}`,
      }),
    );
  }
  const controller = new AbortController();
  let remaining = 1000;
  let checks = 0;
  const result = await pruneContent({
    contentDirectory,
    executionContext: {
      signal: controller.signal,
      remainingMs: () => remaining,
      dispose: () => {},
    },
    linkCheckBatchIntervalMs: 1000,
    linkVerifier: async () => {
      checks += 1;
      if (checks === 1) return 'deleted';
      await new Promise<void>((resolve) => setImmediate(resolve));
      remaining = 0;
      controller.abort(new Error('deadline'));
      return 'deleted';
    },
  });
  assert.equal(result.unchecked.length, 19);
  assert.deepEqual(
    (await readdir(articlesDirectory)).sort(),
    Array.from(
      { length: 19 },
      (_, index) => `entry-${String(index + 3).padStart(2, '0')}.yaml`,
    ),
  );
});

test('prune leaves a caller-owned execution context usable after completion and failure', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  let disposals = 0;
  const executionContext: ExecutionContext = {
    signal: new AbortController().signal,
    remainingMs: () => 1000,
    dispose: () => {
      disposals += 1;
    },
  };

  assert.deepEqual(await pruneContent({ contentDirectory, executionContext }), {
    deferred: [],
    review: [],
    unchecked: [],
  });
  await writeFile(
    path.join(contentDirectory, 'articles', 'invalid.yaml'),
    'date: [unterminated',
  );
  await assert.rejects(
    pruneContent({ contentDirectory, executionContext }),
    /YAML/,
  );
  assert.equal(disposals, 0);
  assert.equal(executionContext.signal.aborted, false);
});
