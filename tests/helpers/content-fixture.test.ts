import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createContentDirectory } from './content-fixture.ts';

test('creates isolated content collections and registers cleanup', async (t) => {
  const contentDirectory = await createContentDirectory(t);
  assert.deepEqual((await readdir(contentDirectory)).sort(), [
    'articles',
    'talks',
  ]);
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), []);
  assert.deepEqual(await readdir(path.join(contentDirectory, 'talks')), []);
});
