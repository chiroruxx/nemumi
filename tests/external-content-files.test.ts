import assert from 'node:assert/strict';
import {
  mkdir,
  readdir,
  readFile,
  rename as renameFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {
  type ContentFileWrite,
  readCollection,
  removeFiles,
  validateFileRemovals,
  validateFileWrites,
  writeFiles,
} from '../scripts/lib/external-content-files.ts';
import {
  buildCollectionIndex,
  createSyncWrites,
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

test('file write and removal validation checks every target and detects escapes and collisions before changes', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const file = path.join(contentDirectory, 'articles', 'post.yaml');
  await assert.doesNotReject(
    validateFileWrites(
      [{ kind: 'create', target: file, content: 'date: 2026-10-03\n' }],
      contentDirectory,
    ),
  );
  await assert.rejects(
    validateFileWrites(
      [
        { kind: 'create', target: file, content: 'first' },
        {
          kind: 'create',
          target: `${contentDirectory}/articles/../articles/post.yaml`,
          content: 'second',
        },
      ],
      contentDirectory,
    ),
    /duplicate file target/,
  );
  await assert.rejects(
    validateFileWrites(
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
  for (const kind of ['replace', 'delete'] as const) {
    await assert.rejects(
      kind === 'delete'
        ? validateFileRemovals([{ target: file }], contentDirectory)
        : validateFileWrites(
            [{ kind, target: file, content: 'replacement' }],
            contentDirectory,
          ),
      /file does not exist/,
    );
  }
  await assert.rejects(
    validateFileWrites(
      [
        {
          kind: 'create',
          target: path.relative(process.cwd(), file),
          content: 'new content',
        },
      ],
      contentDirectory,
    ),
    /absolute path/,
  );
  await writeFile(file, 'already exists');
  const untouched = path.join(contentDirectory, 'articles', 'untouched.yaml');
  await assert.rejects(
    validateFileWrites(
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
    validateFileWrites(
      [{ kind: 'create', target: file, content: 'collision' }],
      contentDirectory,
    ),
    /already exists/,
  );
  await assert.rejects(
    validateFileRemovals(
      [
        { target: file },
        { target: `${contentDirectory}/articles/../articles/post.yaml` },
      ],
      contentDirectory,
    ),
    /duplicate file target/,
  );
  for (const [target, message] of [
    [path.relative(process.cwd(), file), /absolute path/],
    [path.join(contentDirectory, '..', 'outside.yaml'), /outside src\/content/],
  ] as const) {
    await assert.rejects(
      validateFileRemovals([{ target }], contentDirectory),
      message,
    );
  }
  const directory = path.join(contentDirectory, 'articles', 'directory');
  const link = path.join(contentDirectory, 'articles', 'link.yaml');
  await mkdir(directory);
  await symlink(file, link);
  for (const kind of ['replace', 'delete'] as const) {
    await assert.doesNotReject(
      kind === 'delete'
        ? validateFileRemovals([{ target: file }], contentDirectory)
        : validateFileWrites(
            [{ kind, target: file, content: '' }],
            contentDirectory,
          ),
    );
    for (const target of [directory, link]) {
      await assert.rejects(
        kind === 'delete'
          ? validateFileRemovals([{ target }], contentDirectory)
          : validateFileWrites(
              [{ kind, target, content: 'replacement' }],
              contentDirectory,
            ),
        /non-regular file/,
      );
    }
  }
  for (const kind of ['create', 'replace'] as const) {
    const target = kind === 'create' ? untouched : file;
    await assert.rejects(
      validateFileWrites(
        [
          {
            kind,
            target,
            content: undefined,
          } as unknown as ContentFileWrite,
        ],
        contentDirectory,
      ),
      /Missing file content/,
    );
  }
});

test('writeFiles atomically replaces an existing file and removeFiles deletes it', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  const file = path.join(contentDirectory, 'articles', 'replace.yaml');
  await writeFile(file, 'old content');

  await writeFiles([{ kind: 'replace', target: file, content: 'new content' }]);

  assert.equal(await readFile(file, 'utf8'), 'new content');
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), [
    'replace.yaml',
  ]);
  await removeFiles([{ target: file }]);
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), []);
});

test('writeFiles makes per-file atomic replacements and a reread/replan retry converges after partial failure', async (t) => {
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
  const initialWrites = createSyncWrites({
    source: 'sizu',
    index: initialIndex,
    feed,
    contentDirectory,
  });
  const secondTarget = initialWrites[1].target;
  let failOnce = true;

  await assert.rejects(
    writeFiles(initialWrites, {
      writeFile,
      rm,
      rename: async (temporary, target) => {
        if (target === secondTarget && failOnce) {
          failOnce = false;
          throw new Error('injected rename failure');
        }
        return renameFile(temporary, target);
      },
    }),
    /injected rename failure/,
  );

  const afterFailure = await readCollection('articles', contentDirectory);
  assert.equal(afterFailure.length, 1);
  const retryWrites = createSyncWrites({
    source: 'sizu',
    index: buildCollectionIndex('articles', afterFailure),
    feed,
    contentDirectory,
  });
  assert.equal(retryWrites.length, 1);
  assert.equal(YAML.parse(retryWrites[0].content).url, feed[1].url);
  await writeFiles(retryWrites);

  assert.equal(
    (await readdir(path.join(contentDirectory, 'articles'))).length,
    2,
  );
  assert.deepEqual(
    YAML.parse(await readFile(initialWrites[0].target, 'utf8')),
    {
      date: feed[0].date.toISOString().slice(0, 10),
      types: ['日常記事'],
      title: feed[0].title,
      url: feed[0].url,
    },
  );
  assert.deepEqual(YAML.parse(await readFile(secondTarget, 'utf8')), {
    date: feed[1].date.toISOString().slice(0, 10),
    types: ['日常記事'],
    title: feed[1].title,
    url: feed[1].url,
  });
  assert.equal(
    (await readdir(path.join(contentDirectory, 'articles'))).some((name) =>
      name.endsWith('.tmp'),
    ),
    false,
  );
});
