import assert from 'node:assert/strict';
import {
  lstat,
  readdir,
  readFile,
  rename as renameFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {
  applyFileChanges,
  readCollection,
  validateFileTargets,
} from '../scripts/lib/external-content-files.ts';
import {
  buildCollectionIndex,
  createSyncChanges,
  type FeedItem,
} from '../scripts/lib/external-content-planning.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

const item: FeedItem = {
  date: new Date('2026-10-03'),
  title: 'A planned post',
  url: 'https://sizu.me/chihiroxx/posts/planned',
};

test('readCollection returns parsed and validated content with file identity', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const file = path.join(contentDirectory, 'articles', 'post.yaml');
  await writeFile(
    file,
    YAML.stringify({
      date: '2026-10-03',
      types: ['日常記事'],
      title: 'A post',
      url: 'https://sizu.me/chihiroxx/posts/a',
    }),
  );

  const entries = await readCollection('articles', contentDirectory);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, file);
  assert.equal(entries[0].id, 'post.yaml');
  assert.ok(entries[0].data.date instanceof Date);
  assert.equal(entries[0].data.date.toISOString(), '2026-10-03T00:00:00.000Z');
  assert.equal(entries[0].data.title, 'A post');
  assert.ok(entries[0].data.url instanceof URL);
  assert.equal(entries[0].data.url.href, 'https://sizu.me/chihiroxx/posts/a');
});

test('validateFileTargets checks every target and detects escapes and collisions before changes', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const file = path.join(contentDirectory, 'articles', 'post.yaml');
  await assert.doesNotReject(
    validateFileTargets(
      [{ kind: 'create', target: file, content: 'date: 2026-10-03\n' }],
      contentDirectory,
    ),
  );
  await assert.rejects(
    validateFileTargets(
      [
        { kind: 'create', target: file, content: 'first' },
        { kind: 'create', target: file, content: 'second' },
      ],
      contentDirectory,
    ),
    /duplicate file target/,
  );
  await assert.rejects(
    validateFileTargets(
      [
        {
          kind: 'create',
          target: path.join(contentDirectory, '..', 'outside.yaml'),
          content: 'outside',
        },
      ],
      contentDirectory,
    ),
    /outside src\/content/,
  );
  await writeFile(file, 'already exists');
  const untouched = path.join(contentDirectory, 'articles', 'untouched.yaml');
  await assert.rejects(
    applyFileChanges(
      [
        { kind: 'create', target: untouched, content: 'new content' },
        { kind: 'create', target: file, content: 'collision' },
      ],
      contentDirectory,
    ),
    /already exists/,
  );
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), [
    'post.yaml',
  ]);
  await assert.rejects(
    validateFileTargets(
      [{ kind: 'create', target: file, content: 'collision' }],
      contentDirectory,
    ),
    /already exists/,
  );
});

test('applyFileChanges atomically replaces an existing file', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const file = path.join(contentDirectory, 'articles', 'replace.yaml');
  await writeFile(file, 'old content');

  await applyFileChanges(
    [{ kind: 'replace', target: file, content: 'new content' }],
    contentDirectory,
  );

  assert.equal(await readFile(file, 'utf8'), 'new content');
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), [
    'replace.yaml',
  ]);
});

test('applyFileChanges makes per-file atomic replacements and a reread/replan retry converges after partial failure', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const feed = [
    item,
    {
      ...item,
      title: 'Another planned post',
      url: 'https://sizu.me/chihiroxx/posts/planned-2',
    },
  ];
  const initialIndex = buildCollectionIndex('articles', []);
  const initialChanges = createSyncChanges({
    source: 'sizu',
    index: initialIndex,
    feed,
    contentDirectory,
  });
  const secondTarget = initialChanges[1].file;
  let failOnce = true;

  await assert.rejects(
    applyFileChanges(
      initialChanges.map((change) => ({
        kind:
          change.action === 'add' ? ('create' as const) : ('replace' as const),
        target: change.file,
        content: YAML.stringify({
          date: change.date.toISOString().slice(0, 10),
          types: change.types,
          title: change.title,
          url: change.url,
        }),
      })),
      contentDirectory,
      {
        lstat,
        writeFile,
        rm,
        rename: async (temporary, target) => {
          if (target === secondTarget && failOnce) {
            failOnce = false;
            throw new Error('injected rename failure');
          }
          return renameFile(temporary, target);
        },
      },
    ),
    /injected rename failure/,
  );

  const afterFailure = await readCollection('articles', contentDirectory);
  assert.equal(afterFailure.length, 1);
  const retryChanges = createSyncChanges({
    source: 'sizu',
    index: buildCollectionIndex('articles', afterFailure),
    feed,
    contentDirectory,
  });
  assert.equal(retryChanges.length, 1);
  assert.equal(retryChanges[0].url, feed[1].url);
  await applyFileChanges(
    retryChanges.map((change) => ({
      kind:
        change.action === 'add' ? ('create' as const) : ('replace' as const),
      target: change.file,
      content: YAML.stringify({
        date: change.date.toISOString().slice(0, 10),
        types: change.types,
        title: change.title,
        url: change.url,
      }),
    })),
    contentDirectory,
  );

  assert.equal(
    (await readdir(path.join(contentDirectory, 'articles'))).length,
    2,
  );
  assert.deepEqual(
    await readFile(initialChanges[0].file, 'utf8'),
    YAML.stringify({
      date: feed[0].date.toISOString().slice(0, 10),
      types: ['日常記事'],
      title: feed[0].title,
      url: feed[0].url,
    }),
  );
  assert.deepEqual(
    await readFile(secondTarget, 'utf8'),
    YAML.stringify({
      date: feed[1].date.toISOString().slice(0, 10),
      types: ['日常記事'],
      title: feed[1].title,
      url: feed[1].url,
    }),
  );
  assert.equal(
    (await readdir(path.join(contentDirectory, 'articles'))).some((name) =>
      name.endsWith('.tmp'),
    ),
    false,
  );
});
