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
