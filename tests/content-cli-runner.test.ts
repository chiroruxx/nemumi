import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import YAML from 'yaml';

const runFile = promisify(execFile);

test('sync CLI can be imported without parsing argv or executing an operation', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const errors: unknown[][] = [];
  process.argv = ['node', 'sync-content', 'unknown'];
  console.error = (...values) => errors.push(values);
  try {
    await import(
      `${pathToFileURL(path.resolve('scripts/cli/sync-content.ts')).href}?import-test`
    );
    assert.deepEqual(errors, []);
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    console.error = originalError;
  }
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
    ['sync-content.ts', []],
    ['sync-content.ts', ['sizu', '--dryrun']],
    ['sync-content.ts', ['sizu', '--dry-run', '--dry-run']],
    ['sync-content.ts', ['sizu', 'hatena']],
    ['sync-content.ts', ['--dry-run', 'sizu']],
    ['sync-content.ts', ['--', '--', 'sizu']],
    ['prune-content.ts', ['--dry-run', 'unexpected']],
    ['prune-content.ts', ['unexpected']],
    ['prune-content.ts', ['--dryrun']],
    ['prune-content.ts', ['--dry-run', '--dry-run']],
    ['prune-content.ts', ['--', '--', '--dry-run']],
    ['check-content-links.ts', ['--dry-run', 'unexpected']],
    ['check-content-links.ts', ['unexpected']],
    ['check-content-links.ts', ['--dryrun']],
    ['check-content-links.ts', ['--dry-run', '--dry-run']],
    ['check-content-links.ts', ['--', '--', '--dry-run']],
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

test('prune CLI accepts empty arguments and an optional pnpm separator before dry-run', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'prune-cli-args-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await Promise.all(
    ['articles', 'talks'].map((collection) =>
      mkdir(path.join(fixtureRoot, 'src/content', collection), {
        recursive: true,
      }),
    ),
  );
  const cliPath = new URL('../scripts/cli/prune-content.ts', import.meta.url);
  for (const args of [[], ['--'], ['--dry-run'], ['--', '--dry-run']]) {
    const { stdout, stderr } = await runFile(
      process.execPath,
      [cliPath.pathname, ...args],
      {
        cwd: fixtureRoot,
        env: { ...process.env, GITHUB_OUTPUT: '' },
      },
    );
    assert.equal(stderr, '');
    assert.equal(
      stdout.trim(),
      '公開状態を確認できなかった URL はありません。',
    );
  }
});

test('link check CLI accepts empty arguments and an optional pnpm separator before dry-run', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'check-links-cli-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await Promise.all(
    ['articles', 'talks'].map((collection) =>
      mkdir(path.join(fixtureRoot, 'src/content', collection), {
        recursive: true,
      }),
    ),
  );
  const cliPath = new URL(
    '../scripts/cli/check-content-links.ts',
    import.meta.url,
  );
  for (const args of [[], ['--'], ['--dry-run'], ['--', '--dry-run']]) {
    const { stdout, stderr } = await runFile(
      process.execPath,
      [cliPath.pathname, ...args],
      {
        cwd: fixtureRoot,
        env: { ...process.env, GITHUB_OUTPUT: '' },
      },
    );
    assert.equal(stderr, '');
    assert.equal(
      stdout.trim(),
      '公開状態を確認できなかった URL はありません。',
    );
  }
});

async function createCliFixture(t: import('node:test').TestContext) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'content-cli-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const contentDirectory = path.join(fixtureRoot, 'src/content');
  await Promise.all(
    ['articles', 'talks'].map((collection) =>
      mkdir(path.join(contentDirectory, collection), { recursive: true }),
    ),
  );
  const outputFile = path.join(fixtureRoot, 'github-output');
  const preloadFile = path.join(fixtureRoot, 'fetch-fixture.mjs');
  await writeFile(
    preloadFile,
    `
    const feeds = {
      'https://sizu.me/chihiroxx/rss': 'https://sizu.me/chihiroxx/posts/fixture',
      'https://toyo.hatenablog.jp/rss': 'https://toyo.hatenablog.jp/entry/fixture',
      'https://speakerdeck.com/chiroruxx.rss': 'https://speakerdeck.com/chiroruxx/fixture',
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (feeds[url]) {
        return new Response('<rss version="2.0"><channel><item><title>Fixture</title><link>' + feeds[url] + '</link><pubDate>Mon, 12 Oct 2026 18:20:00 GMT</pubDate></item></channel></rss>');
      }
      if (!url.startsWith('https://sizu.me/chihiroxx/posts/') &&
          !url.startsWith('https://toyo.hatenablog.jp/entry/') &&
          !url.startsWith('https://speakerdeck.com/chiroruxx/')) {
        throw new Error('Unexpected fixture URL: ' + url);
      }
      const status = process.env.FIXTURE_LINK_STATUS ||
        (url.endsWith('/deferred') ? 503 : url.endsWith('/review') ? 400 : url.endsWith('/deleted') ? 404 : 200);
      return new Response('', { status: Number(status) });
    };
  `,
  );
  const run = (script: string, args: string[], linkStatus = '200') =>
    runFile(
      process.execPath,
      [
        '--import',
        pathToFileURL(preloadFile).href,
        new URL(`../scripts/cli/${script}.ts`, import.meta.url).pathname,
        ...args,
      ],
      {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          FIXTURE_LINK_STATUS: linkStatus,
        },
      },
    );
  return { contentDirectory, outputFile, run };
}

test('sync CLI accepts each service, honors dry-run, and writes its report to GitHub output', async (t) => {
  const { contentDirectory, outputFile, run } = await createCliFixture(t);
  for (const [source, collection] of [
    ['sizu', 'articles'],
    ['hatena', 'articles'],
    ['speakerdeck', 'talks'],
  ]) {
    const directory = path.join(contentDirectory, collection);
    const before = await readdir(directory);
    const { stdout, stderr } = await run('sync-content', [
      '--',
      source,
      '--dry-run',
    ]);
    assert.equal(stderr, '');
    assert.equal(
      stdout.trim(),
      '公開状態を確認できなかった URL はありません。',
    );
    assert.deepEqual(await readdir(directory), before);
    assert.match(
      await readFile(outputFile, 'utf8'),
      /summary<<CONTENT_SUMMARY_.*\n公開状態を確認できなかった URL はありません。\nCONTENT_SUMMARY_/,
    );
    await run('sync-content', [source]);
    assert.equal((await readdir(directory)).length, before.length + 1);
  }
});

test('sync CLI saves candidates without checking links; shared checker reports and preserves unverified links', async (t) => {
  const { contentDirectory, outputFile, run } = await createCliFixture(t);
  for (const status of ['400', '503']) {
    await writeFile(outputFile, '');
    await run('sync-content', ['sizu'], status);
    assert.equal(
      (await readdir(path.join(contentDirectory, 'articles'))).length,
      1,
    );
    const checked = await run('check-content-links', [], status);
    assert.equal(
      checked.stdout.trim(),
      '公開状態を確認できなかった URL:\n- https://sizu.me/chihiroxx/posts/fixture',
    );
    assert.match(
      await readFile(outputFile, 'utf8'),
      /公開状態を確認できなかった URL:/,
    );
    assert.equal(
      (await readdir(path.join(contentDirectory, 'articles'))).length,
      1,
    );
    await rm(path.join(contentDirectory, 'articles'), { recursive: true });
    await mkdir(path.join(contentDirectory, 'articles'), { recursive: true });
  }
});

test('link check CLI reports unverified URLs and honors dry-run before deleting confirmed links', async (t) => {
  const { contentDirectory, outputFile, run } = await createCliFixture(t);
  const directory = path.join(contentDirectory, 'articles');
  for (const slug of ['public', 'deferred', 'review', 'deleted']) {
    await writeFile(
      path.join(directory, `${slug}.yaml`),
      YAML.stringify({
        date: '2026-10-01',
        title: slug,
        url: `https://sizu.me/chihiroxx/posts/${slug}`,
      }),
    );
  }
  const expected =
    '公開状態を確認できなかった URL:\n- https://sizu.me/chihiroxx/posts/deferred\n- https://sizu.me/chihiroxx/posts/review';
  const { stdout, stderr } = await run(
    'check-content-links',
    ['--dry-run'],
    '',
  );
  assert.equal(stderr, '');
  assert.equal(stdout.trim(), expected);
  assert.equal((await readdir(directory)).length, 4);
  assert.ok((await readFile(outputFile, 'utf8')).includes(expected));
  const applied = await run('check-content-links', [], '');
  assert.equal(applied.stdout.trim(), expected);
  assert.deepEqual((await readdir(directory)).sort(), [
    'deferred.yaml',
    'public.yaml',
    'review.yaml',
  ]);
});

test('link check CLI reports invalid saved content and exits without writing a summary', async (t) => {
  const { contentDirectory, outputFile, run } = await createCliFixture(t);
  await writeFile(
    path.join(contentDirectory, 'articles', 'invalid.yaml'),
    'date: [unterminated',
  );
  await writeFile(outputFile, 'unchanged\n');

  await assert.rejects(
    run('check-content-links', []),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr ?? '', /invalid YAML/);
      return true;
    },
  );

  assert.equal(await readFile(outputFile, 'utf8'), 'unchanged\n');
});

test('sync CLI rejects unknown services before loading content', async (t) => {
  const { run, contentDirectory } = await createCliFixture(t);
  await assert.rejects(
    run('sync-content', ['unknown']),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.notEqual(error.code, 0);
      assert.match(error.stderr ?? '', /Unknown service: unknown/);
      return true;
    },
  );
  assert.deepEqual(await readdir(path.join(contentDirectory, 'articles')), []);
});
