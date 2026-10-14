import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runSyncContent } from '../scripts/cli/sync-content.ts';

const runFile = promisify(execFile);

const syncReport = {
  deferred: [],
  review: [],
  unchecked: [],
};

test('sync CLI can be imported without parsing argv or executing an operation', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const errors: unknown[][] = [];
  process.argv = ['node', 'sync-content', 'unknown'];
  console.error = (...values) => errors.push(values);
  try {
    const cli = await import(
      `${pathToFileURL(path.resolve('scripts/cli/sync-content.ts')).href}?import-test`
    );
    assert.equal(typeof cli.runSyncContent, 'function');
    assert.deepEqual(errors, []);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    console.error = originalError;
  }
});

test('runSyncContent reports only unverified URLs and returns the original result', async () => {
  const summaries: string[] = [];
  const output: string[] = [];
  let received: { source: string; dryRun: boolean } | undefined;
  const result = await runSyncContent({
    source: 'sizu',
    dryRun: true,
    sync: async (source, options) => {
      received = { source, dryRun: options?.dryRun ?? false };
      return syncReport;
    },
    writeSummary: async (value) => {
      summaries.push(value);
    },
    writeOutput: (value) => output.push(value),
  });

  assert.deepEqual(received, { source: 'sizu', dryRun: true });
  assert.equal(result, syncReport);
  assert.equal(summaries[0], '公開状態を確認できなかった URL はありません。');
  assert.deepEqual(output, summaries);
});

test('runSyncContent writes a structured failure report before rethrowing the sync error', async () => {
  const summaries: string[] = [];
  const output: string[] = [];
  const failure = Object.assign(new Error('verification failed'), {
    report: {
      ...syncReport,
      review: [{ source: 'sizu' as const, url: 'https://sizu.me/unavailable' }],
    },
  });
  await assert.rejects(
    runSyncContent({
      source: 'sizu',
      sync: async () => {
        throw failure;
      },
      writeSummary: async (value) => {
        summaries.push(value);
      },
      writeOutput: (value) => output.push(value),
    }),
    /verification failed/,
  );
  assert.equal(
    summaries[0],
    '公開状態を確認できなかった URL:\n- https://sizu.me/unavailable',
  );
  assert.deepEqual(output, summaries);
});

test('sync and prune invalid CLI arguments exit nonzero before changing content fixtures', async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'content-cli-args-'),
  );
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const articleDirectory = path.join(fixtureRoot, 'src/content/articles');
  const talkDirectory = path.join(fixtureRoot, 'src/content/talks');
  await Promise.all([
    mkdir(articleDirectory, { recursive: true }),
    mkdir(talkDirectory, { recursive: true }),
  ]);
  const sentinel = path.join(articleDirectory, 'sentinel.yaml');
  await writeFile(sentinel, 'title: Keep this fixture\n');
  const outputFile = path.join(fixtureRoot, 'github-output');
  await writeFile(outputFile, 'existing=keep\n');

  for (const [script, args] of [
    ['sync-content.ts', ['sizu', '--dry-run', 'unexpected']],
    ['prune-content.ts', ['--dry-run', 'unexpected']],
  ] as const) {
    const cliPath = new URL(`../scripts/cli/${script}`, import.meta.url);
    await assert.rejects(
      runFile(process.execPath, [cliPath.pathname, ...args], {
        cwd: fixtureRoot,
        env: { ...process.env, GITHUB_OUTPUT: outputFile },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.notEqual(error.code, 0);
        assert.match(error.stderr ?? '', /Usage:/);
        return true;
      },
    );
  }

  assert.equal(await readFile(sentinel, 'utf8'), 'title: Keep this fixture\n');
  assert.equal(await readFile(outputFile, 'utf8'), 'existing=keep\n');
});
