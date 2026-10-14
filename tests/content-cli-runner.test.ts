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
  source: 'sizu' as const,
  collection: 'articles' as const,
  feedCount: 2,
  changes: [
    {
      action: 'add' as const,
      file: '/repo/src/content/articles/new.yaml',
      date: new Date('2026-10-13'),
      title: 'New post',
      url: 'https://sizu.me/chihiroxx/posts/new?ref=rss',
      types: ['日常記事'],
    },
  ],
  kept: 1,
  skipped: [],
  deferred: [],
  review: [],
  unchecked: [],
  remainingByCollection: { articles: 2 },
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

test('runSyncContent injects sync, writes formatted summary and relative-path JSON, and returns the original report', async () => {
  const output: string[] = [];
  const summaries: string[] = [];
  let received: { source: string; dryRun: boolean } | undefined;
  const result = await runSyncContent({
    source: 'sizu',
    dryRun: true,
    sync: async (source, options) => {
      received = { source, dryRun: options?.dryRun ?? false };
      return syncReport;
    },
    writeOutput: (value) => output.push(value),
    writeSummary: async (value) => {
      summaries.push(value);
    },
    repositoryRoot: '/repo',
  });

  assert.deepEqual(received, { source: 'sizu', dryRun: true });
  assert.equal(result, syncReport);
  assert.equal(
    syncReport.changes[0].file,
    '/repo/src/content/articles/new.yaml',
  );
  assert.equal(
    JSON.parse(output[0] ?? '{}').changes[0].file,
    'src/content/articles/new.yaml',
  );
  assert.match(summaries[0] ?? '', /RSS取得: 2件/);
  assert.match(summaries[0] ?? '', /src\/content\/articles\/new.yaml/);
});

test('runSyncContent writes a structured failure report before rethrowing the sync error', async () => {
  const output: string[] = [];
  const summaries: string[] = [];
  const failure = Object.assign(new Error('verification failed'), {
    report: {
      ...syncReport,
      changes: [],
      review: [{ source: 'sizu' as const, url: 'https://sizu.me/unavailable' }],
    },
  });
  await assert.rejects(
    runSyncContent({
      source: 'sizu',
      sync: async () => {
        throw failure;
      },
      writeOutput: (value) => output.push(value),
      writeSummary: async (value) => {
        summaries.push(value);
      },
      repositoryRoot: '/repo',
    }),
    /verification failed/,
  );
  assert.equal(JSON.parse(output[0] ?? '{}').review.length, 1);
  assert.match(summaries[0] ?? '', /要確認: 1件/);
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
