import assert from 'node:assert/strict';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { checkContentLinks } from '../scripts/lib/check-content-links.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

test('checkContentLinks removes confirmed invalid managed links and preserves manual and unverified entries', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const directory = path.join(contentDirectory, 'articles');
  for (const slug of ['deleted', 'unavailable', 'unexpected', 'public']) {
    await writeFile(
      path.join(directory, `${slug}.yaml`),
      YAML.stringify({
        date: '2026-10-01',
        title: slug,
        url: `https://sizu.me/chihiroxx/posts/${slug}`,
      }),
    );
  }
  await writeFile(
    path.join(directory, 'manual.yaml'),
    YAML.stringify({
      date: '2026-10-02',
      title: 'Manual',
      url: 'https://example.com/manual',
    }),
  );

  const result = await checkContentLinks({
    contentDirectory,
    linkVerifier: async (url) => {
      if (url.href.endsWith('/deleted')) return 'deleted';
      if (url.href.endsWith('/unavailable')) return 'unverified';
      if (url.href.endsWith('/unexpected')) return 'unverified';
      return 'public';
    },
    linkCheckBatchIntervalMs: 0,
  });

  assert.deepEqual(
    result.unverified.map(({ url }) => url.href),
    [
      'https://sizu.me/chihiroxx/posts/unavailable',
      'https://sizu.me/chihiroxx/posts/unexpected',
    ],
  );
  assert.deepEqual(result.unchecked, []);
  assert.deepEqual((await readdir(directory)).sort(), [
    'manual.yaml',
    'public.yaml',
    'unavailable.yaml',
    'unexpected.yaml',
  ]);
});

test('checkContentLinks supports dry-run without deleting confirmed invalid links', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const directory = path.join(contentDirectory, 'articles');
  await writeFile(
    path.join(directory, 'deleted.yaml'),
    YAML.stringify({
      date: '2026-10-01',
      title: 'Deleted',
      url: 'https://sizu.me/chihiroxx/posts/deleted',
    }),
  );

  await checkContentLinks({
    contentDirectory: path.relative(process.cwd(), contentDirectory),
    dryRun: true,
    linkVerifier: async () => 'deleted',
    linkCheckBatchIntervalMs: 0,
  });

  assert.deepEqual(await readdir(directory), ['deleted.yaml']);
});

test('checkContentLinks checks every managed article and talk without applying collection limits', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const checked: string[] = [];
  for (let index = 1; index <= 21; index += 1) {
    await writeFile(
      path.join(contentDirectory, 'articles', `article-${index}.yaml`),
      YAML.stringify({
        date: `2026-10-${String(index).padStart(2, '0')}`,
        title: `Article ${index}`,
        url: `https://sizu.me/chihiroxx/posts/article-${index}`,
      }),
    );
  }
  await mkdir(path.join(contentDirectory, 'talks'), { recursive: true });
  await writeFile(
    path.join(contentDirectory, 'talks', 'talk.yaml'),
    YAML.stringify({
      date: '2026-10-22',
      title: 'Talk',
      url: 'https://speakerdeck.com/chiroruxx/talk',
    }),
  );

  await checkContentLinks({
    contentDirectory,
    linkCheckBatchIntervalMs: 0,
    linkVerifier: async (url) => {
      checked.push(url.href);
      return url.href.endsWith('/talk') ? 'deleted' : 'public';
    },
  });

  assert.equal(checked.length, 22);
  assert.deepEqual(
    (await readdir(path.join(contentDirectory, 'articles'))).sort(),
    Array.from(
      { length: 21 },
      (_, index) => `article-${index + 1}.yaml`,
    ).sort(),
  );
  assert.deepEqual(await readdir(path.join(contentDirectory, 'talks')), []);
});

test('checkContentLinks validates deletion targets before removing confirmed invalid links', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const articleDirectory = path.join(contentDirectory, 'articles');
  const target = path.join(contentDirectory, 'outside.yaml');
  const link = path.join(articleDirectory, 'linked.yaml');
  await writeFile(
    target,
    YAML.stringify({
      date: '2026-10-01',
      title: 'Outside',
      url: 'https://sizu.me/chihiroxx/posts/deleted',
    }),
  );
  await symlink(target, link);

  await assert.rejects(
    checkContentLinks({
      contentDirectory,
      linkVerifier: async () => 'deleted',
      linkCheckBatchIntervalMs: 0,
    }),
    /Refusing to modify a non-regular file/,
  );
  assert.deepEqual(await readdir(articleDirectory), ['linked.yaml']);
});

test('checkContentLinks removes confirmed invalid links and reports later checks as unchecked at the deadline', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const directory = path.join(contentDirectory, 'articles');
  for (let index = 1; index <= 6; index += 1) {
    await writeFile(
      path.join(directory, `entry-${index}.yaml`),
      YAML.stringify({
        date: `2026-10-${String(index).padStart(2, '0')}`,
        title: `Entry ${index}`,
        url: `https://sizu.me/chihiroxx/posts/entry-${index}`,
      }),
    );
  }
  let elapsed = 0;
  const result = await checkContentLinks({
    contentDirectory,
    executionBudgetMs: 1000,
    now: () => elapsed,
    linkCheckBatchIntervalMs: 0,
    linkVerifier: async (url) => {
      if (url.href.endsWith('/entry-1')) return 'deleted';
      if (url.href.endsWith('/entry-6')) {
        elapsed = 1000;
        return 'deleted';
      }
      return 'public';
    },
  });

  assert.deepEqual(
    result.unchecked.map(({ url }) => url.href),
    ['https://sizu.me/chihiroxx/posts/entry-6'],
  );
  assert.deepEqual((await readdir(directory)).sort(), [
    'entry-2.yaml',
    'entry-3.yaml',
    'entry-4.yaml',
    'entry-5.yaml',
    'entry-6.yaml',
  ]);
});
