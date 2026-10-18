import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { checkContentLinks } from '../scripts/lib/check-content-links.ts';
import { pruneContent } from '../scripts/lib/prune-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

test('pruning applies the directory cap to all entries and dry-run leaves files intact', async (t) => {
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
      date: '2019-01-01',
      title: 'Manual entry',
      memo: 'storage-only field',
    }),
  );

  const options: NonNullable<Parameters<typeof pruneContent>[0]> = {
    contentDirectory: path.relative(process.cwd(), contentDirectory),
  };
  await pruneContent({ ...options, dryRun: true });
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

  await pruneContent(options);
  const remainingFiles = await readdir(articlesDirectory);
  assert.equal(remainingFiles.length, 20);
  assert.equal(remainingFiles.includes(manualFilename), false);
  assert.ok(remainingFiles.includes('entry-01.yaml'));
  assert.ok(remainingFiles.includes('entry-20.yaml'));
});

test('pruning keeps the newest entries even when all entries are manual', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 21; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `manual-${suffix}.yaml`),
      YAML.stringify({
        date: `2026-10-${suffix}`,
        title: `Manual ${suffix}`,
        ...(index % 2 === 0
          ? { url: `https://example.com/manual-${suffix}` }
          : {}),
      }),
    );
  }
  await pruneContent({ contentDirectory, dryRun: true });
  assert.equal((await readdir(articlesDirectory)).length, 21);
  await pruneContent({ contentDirectory });
  assert.deepEqual(
    (await readdir(articlesDirectory)).sort(),
    Array.from(
      { length: 20 },
      (_, index) => `manual-${String(index + 2).padStart(2, '0')}.yaml`,
    ),
  );
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
    await pruneContent({ contentDirectory });
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
  await pruneContent({ contentDirectory });
  assert.deepEqual((await readdir(articlesDirectory)).sort(), ['manual.yaml']);
  assert.equal((await readdir(talksDirectory)).length, 10);
});

test('pruning breaks date ties by URL without performing link checks', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 21; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `entry-${suffix}.yaml`),
      YAML.stringify({
        date: index <= 3 ? '2020-01-01' : `2020-01-${suffix}`,
        title: `Post ${suffix}`,
        url:
          index <= 3
            ? `https://sizu.me/chihiroxx/posts/tie-${4 - index}`
            : `https://sizu.me/chihiroxx/posts/post-${suffix}`,
      }),
    );
  }
  await pruneContent({ contentDirectory });
  assert.deepEqual(
    (await readdir(articlesDirectory)).sort(),
    Array.from(
      { length: 20 },
      (_, index) => `entry-${String(index + 2).padStart(2, '0')}.yaml`,
    ),
  );
});

test('update workflow checks links before applying the cap so an invalid newest item does not displace an older valid item', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articlesDirectory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 22; index += 1) {
    const suffix = String(index).padStart(2, '0');
    await writeFile(
      path.join(articlesDirectory, `entry-${suffix}.yaml`),
      YAML.stringify({
        date: `2026-10-${suffix}`,
        title: `Post ${suffix}`,
        url: `https://sizu.me/chihiroxx/posts/post-${suffix}`,
      }),
    );
  }

  const workflow = YAML.parse(
    await readFile('.github/workflows/update-content.yml', 'utf8'),
  ) as {
    jobs: {
      sync: {
        steps: Array<{ uses?: string; run?: string }>;
      };
    };
  };
  for (const step of workflow.jobs.sync.steps) {
    if (step.uses === './.github/actions/check-content-links') {
      await checkContentLinks({
        contentDirectory,
        linkCheckBatchIntervalMs: 0,
        linkVerifier: async (url) =>
          url.endsWith('/post-22') ? 'deleted' : 'public',
      });
    } else if (step.run?.includes('mise run prune-content')) {
      await pruneContent({ contentDirectory });
    }
  }

  const remaining = await readdir(articlesDirectory);
  assert.equal(remaining.length, 20);
  assert.equal(remaining.includes('entry-01.yaml'), false);
  assert.ok(remaining.includes('entry-02.yaml'));
  assert.ok(remaining.includes('entry-21.yaml'));
  assert.equal(remaining.includes('entry-22.yaml'), false);
});
