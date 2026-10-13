import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import ts from 'typescript';
import { findUntestedExports } from '../scripts/lib/exported-function-tests.ts';

function createFixture(contents: Record<string, string>) {
  const root = path.resolve('tests/fixtures/exported-functions');
  const files = new Map(
    Object.entries(contents).map(([name, text]) => [
      path.join(root, name),
      text,
    ]),
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = (file) => files.has(file);
  host.readFile = (file) => files.get(file);
  host.directoryExists = () => true;
  host.getSourceFile = (file, languageVersion) => {
    const text = files.get(file);
    return text === undefined
      ? undefined
      : ts.createSourceFile(file, text, languageVersion, true);
  };
  const names = [...files.keys()];
  return {
    program: ts.createProgram(names, options, host),
    files: {
      sources: names.filter((name) => !name.endsWith('.test.ts')),
      tests: names.filter((name) => name.endsWith('.test.ts')),
    },
  };
}

test('reports exported functions with no direct test call, ignoring private functions and data', () => {
  const fixture = createFixture({
    'source.ts': `export function missing() { return 1; }
      function internal() { return 2; }
      export const data = 3;
      export type Callback = () => void;`,
    'types.ts': `export type { missing } from './source.ts';`,
    'source.test.ts': `import test from 'node:test';
      import { missing } from './source.ts';
      test('does not call the imported function', () => {});`,
  });
  assert.deepEqual(findUntestedExports(fixture.program, fixture.files), [
    { file: fixture.files.sources[0], name: 'missing', line: 1 },
  ]);
});

test('recognizes aliases, namespaces, arrow functions, default exports, and re-exports', () => {
  const fixture = createFixture({
    'source.ts': `export function named() { return 1; }
      export const arrow = () => 2;
      export default function () { return 3; }`,
    'barrel.ts': `export { named as renamed } from './source.ts';`,
    'source.test.ts': `import { it as check } from 'node:test';
      import * as runner from 'node:test';
      import defaultFunction, * as api from './source.ts';
      import { renamed as aliased } from './barrel.ts';
      check('named', () => { aliased(); });
      runner.test('arrow', () => { api.arrow(); });
      check('default', () => { defaultFunction(); });`,
  });
  assert.deepEqual(findUntestedExports(fixture.program, fixture.files), []);
});

test('ignores calls outside tests and in skipped or todo tests', () => {
  const fixture = createFixture({
    'source.ts': `export function outside() {}
      export function skipped() {}
      export function todo() {}`,
    'source.test.ts': `import test from 'node:test';
      import { outside, skipped, todo } from './source.ts';
      outside();
      test.skip('skip', () => { skipped(); });
      test('skip option', { skip: true }, () => { skipped(); });
      test('todo', { todo: true }, () => { todo(); });
      test('active parent', () => { test.skip('nested skip', () => { skipped(); }); });
      test.skip('skipped parent', () => { test('nested active', () => { skipped(); }); });`,
  });
  assert.deepEqual(
    findUntestedExports(fixture.program, fixture.files).map(({ name }) => name),
    ['outside', 'skipped', 'todo'],
  );
});

test('does not confuse a shadowed name with the imported function', () => {
  const fixture = createFixture({
    'source.ts': 'export function action() {}',
    'source.test.ts': `import test from 'node:test';
      import { action } from './source.ts';
      test('shadowed', () => {
        const action = () => {};
        action();
      });`,
  });
  assert.deepEqual(
    findUntestedExports(fixture.program, fixture.files).map(({ name }) => name),
    ['action'],
  );
});

test('CLI fails for an untested export and succeeds after adding a direct test call', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nemumi-export-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'tests'));
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { noLib: true, types: [] },
      include: ['src/**/*.ts', 'tests/**/*.ts'],
    }),
  );
  await writeFile(
    path.join(root, 'src/api.ts'),
    'export function missing() {}',
  );
  const run = () =>
    promisify(execFile)(
      process.execPath,
      [path.resolve('scripts/cli/check-exported-function-tests.ts')],
      { cwd: root },
    );
  await assert.rejects(run(), (error: unknown) => {
    assert.ok(error instanceof Error && 'code' in error && 'stderr' in error);
    assert.equal(error.code, 1);
    assert.match(
      String(error.stderr),
      /src\/api.ts:1: exported function "missing"/,
    );
    return true;
  });
  await writeFile(
    path.join(root, 'tests/api.test.ts'),
    `import test from 'node:test';
    import { missing } from '../src/api.ts';
    test('missing', () => { missing(); });`,
  );
  const result = await run();
  assert.match(result.stdout, /All exported functions have a direct test call/);
});
