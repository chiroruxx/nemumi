import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { findTestFiles } from '../scripts/lib/test-files.ts';

test('discovers executable TypeScript tests recursively and excludes unsupported formats', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nemumi-test-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'nested'), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'top.test.ts'), ''),
    writeFile(path.join(root, 'nested', 'deep.test.ts'), ''),
    writeFile(path.join(root, 'nested', 'unsupported.test.tsx'), ''),
    writeFile(path.join(root, 'nested', 'not-a-test.ts'), ''),
  ]);

  assert.deepEqual(await findTestFiles(root), [
    path.join(root, 'nested', 'deep.test.ts'),
    path.join(root, 'top.test.ts'),
  ]);
});

test('the Node runner executes nested TypeScript tests and ignores TSX', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nemumi-test-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tests', 'nested'), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(root, 'tests', 'nested', 'child.test.ts'),
      `import test from 'node:test';
      test('nested executable test', () => {
        process.stdout.write('x'.repeat(1_100_000));
      });`,
    ),
    writeFile(
      path.join(root, 'tests', 'ignored.test.tsx'),
      `throw new Error('TSX should not be executed');`,
    ),
  ]);

  const result = await promisify(execFile)(
    process.execPath,
    [path.resolve('scripts/cli/run-tests.ts')],
    {
      cwd: root,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const output = result.stdout + result.stderr;
  assert.match(output, /nested executable test/);
  assert.doesNotMatch(output, /TSX should not be executed/);
  assert.ok(Buffer.byteLength(result.stdout) > 1024 * 1024);
});

test('the Node runner propagates a child test failure and its diagnostic', async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'nemumi-test-runner-failure-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(
    path.join(root, 'tests', 'failure.test.ts'),
    `import test from 'node:test';
      test('deliberately fails', () => {
        throw new Error('intentional child failure');
      });`,
  );

  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [path.resolve('scripts/cli/run-tests.ts')],
      { cwd: root, env: { ...process.env, NODE_TEST_CONTEXT: undefined } },
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof Error &&
          'code' in error &&
          'stdout' in error &&
          'stderr' in error,
      );
      assert.equal(error.code, 1);
      const output = `${error.stdout}${error.stderr}`;
      assert.match(output, /deliberately fails/);
      assert.match(output, /intentional child failure/);
      return true;
    },
  );
});
