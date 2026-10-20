import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();

const hookMatcher = JSON.parse(
  await readFile(path.join(repositoryRoot, '.codex', 'hooks.json'), 'utf8'),
).hooks.PostToolUse[0].matcher as string;
const matchesHook = (toolName: string) =>
  new RegExp(hookMatcher).test(toolName);
assert.ok(matchesHook('apply_patch'));
assert.ok(matchesHook('Bash'));
assert.ok(matchesHook('mcp__jetbrains__edit_file'));
assert.ok(!matchesHook('Read'));

function command(
  file: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) {
  const result = spawnSync(file, args, { cwd, env, encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `${file} ${args.join(' ')} failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

async function initializeRepository(root: string): Promise<void> {
  command('git', ['init', '--quiet'], root);
  command('git', ['config', 'user.name', 'Hook test'], root);
  command('git', ['config', 'user.email', 'hook-test@example.invalid'], root);
  await mkdir(path.join(root, '.codex', 'hooks'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'biome.jsonc'), '{}\n');
  await writeFile(path.join(root, 'package.json'), '{}\n');
  await writeFile(
    path.join(root, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\n",
  );
  await writeFile(
    path.join(root, 'src', 'known.ts'),
    'export const value = 1;\n',
  );
  await writeFile(path.join(root, 'src', 'deleted.ts'), 'export {};\n');
  await writeFile(
    path.join(root, 'src', 'renamed.ts'),
    'export const renamed = true;\n',
  );
  await writeFile(path.join(root, '.gitignore'), 'dist/\n');
  command('git', ['add', '.'], root);
  command('git', ['commit', '--quiet', '-m', 'fixture'], root);
}

async function installFakeMise(
  root: string,
): Promise<{ bin: string; log: string }> {
  const bin = path.join(root, 'fake-bin');
  const log = path.join(root, 'mise.log');
  await mkdir(bin);
  const fakeMise = path.join(bin, 'mise');
  await writeFile(
    fakeMise,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "$BIOME_HOOK_LOG"`,
      'if [ "$BIOME_HOOK_FAIL" = 1 ]; then exit 1; fi',
      '',
    ].join('\n'),
  );
  await chmod(fakeMise, 0o755);
  return { bin, log };
}

function event(toolName: string, commandText = 'python wrote a file'): string {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: { command: commandText },
  });
}

test('Codex hook checks unknown edit paths read-only, caches successful content, and invalidates on config changes', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nemumi-codex-hook-'),
  );
  const repository = path.join(temporaryRoot, 'repo');
  const temporaryDirectory = path.join(temporaryRoot, 'tmp');
  await mkdir(temporaryDirectory);
  const hookPath = path.join(repository, '.codex', 'hooks', 'biome-check.mjs');
  const sourceHook = path.join(
    repositoryRoot,
    '.codex',
    'hooks',
    'biome-check.mjs',
  );

  try {
    await mkdir(repository);
    await initializeRepository(repository);
    await copyFile(sourceHook, hookPath);
    await writeFile(
      path.join(repository, 'src', 'known.ts'),
      'export const value = 1.5;\n',
    );
    await writeFile(
      path.join(repository, 'src', 'new.ts'),
      'export const added = true;\n',
    );
    await mkdir(path.join(repository, 'dist'));
    await writeFile(
      path.join(repository, 'dist', 'generated.ts'),
      'export {};\n',
    );
    command('git', ['rm', '--quiet', 'src/deleted.ts'], repository);
    command('git', ['mv', 'src/renamed.ts', 'src/moved.ts'], repository);
    const fakeMise = await installFakeMise(temporaryRoot);
    const environment = {
      ...process.env,
      BIOME_HOOK_LOG: fakeMise.log,
      PATH: `${fakeMise.bin}:${process.env.PATH}`,
      TMPDIR: temporaryDirectory,
    };

    const runHook = (
      input: string,
      shouldSucceed = true,
      failBiome = false,
    ) => {
      const result = spawnSync(process.execPath, [hookPath], {
        cwd: repository,
        env: { ...environment, BIOME_HOOK_FAIL: failBiome ? '1' : '' },
        input,
        encoding: 'utf8',
      });
      assert.equal(result.status, shouldSucceed ? 0 : 2, result.stderr);
    };
    const logLines = async () => {
      try {
        return (await readFile(fakeMise.log, 'utf8')).trim().split('\n');
      } catch {
        return [];
      }
    };

    runHook(event('Bash'), false, true);
    assert.equal((await logLines()).length, 1);
    runHook(event('Bash'));
    const firstRun = await logLines();
    assert.equal(firstRun.length, 2, 'failed checks should not be cached');
    assert.ok(!firstRun[0]?.includes('--write'));
    assert.ok(firstRun[0]?.includes('src/known.ts'), JSON.stringify(firstRun));
    assert.ok(firstRun[0]?.includes('src/new.ts'), JSON.stringify(firstRun));
    assert.ok(firstRun[0]?.includes('src/moved.ts'), JSON.stringify(firstRun));
    assert.ok(
      !firstRun[0]?.includes('src/deleted.ts'),
      JSON.stringify(firstRun),
    );
    assert.ok(
      !firstRun[0]?.includes('dist/generated.ts'),
      JSON.stringify(firstRun),
    );

    await writeFile(
      path.join(repository, 'src', 'new.ts'),
      'export const added = false;\n',
    );
    runHook(event('mcp__jetbrains__edit_file'));
    const mcpRun = await logLines();
    assert.equal(mcpRun.length, 3);
    assert.ok(!mcpRun.at(-1)?.includes('--write'));
    assert.ok(mcpRun.at(-1)?.includes('src/new.ts'));

    runHook(event('mcp__jetbrains__edit_file'));
    assert.equal(
      (await logLines()).length,
      3,
      'same file content should use the successful cache',
    );

    await writeFile(
      path.join(repository, 'biome.jsonc'),
      '{\n  "formatter": {}\n}\n',
    );
    runHook(event('Bash'));
    assert.equal(
      (await logLines()).length,
      4,
      'Biome configuration changes should invalidate the cache',
    );

    await writeFile(
      path.join(repository, 'src', 'known.ts'),
      'export const value = 2;\n',
    );
    runHook(
      event(
        'apply_patch',
        '*** Begin Patch\n*** Update File: src/known.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch',
      ),
    );
    const finalRuns = await logLines();
    assert.equal(finalRuns.length, 5);
    assert.ok(finalRuns.at(-1)?.includes('--write'));
    assert.ok(finalRuns.at(-1)?.includes('src/known.ts'));

    await writeFile(
      path.join(repository, 'src', 'new.ts'),
      'export const added = 2;\n',
    );
    runHook(
      JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/new.ts' },
      }),
    );
    assert.equal((await logLines()).length, 6);
    assert.ok((await logLines()).at(-1)?.includes('--write'));
    assert.ok((await logLines()).at(-1)?.includes('src/new.ts'));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('Git hook installer runs only in an independent repository and preserves existing hooks', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nemumi-git-hook-'),
  );
  const repository = path.join(temporaryRoot, 'repo');

  try {
    await mkdir(repository);
    command('git', ['init', '--quiet'], repository);
    command('git', ['config', 'core.hooksPath', '.custom-hooks'], repository);
    await mkdir(path.join(repository, '.githooks'), { recursive: true });
    await mkdir(path.join(repository, 'scripts'), { recursive: true });
    await copyFile(
      path.join(repositoryRoot, '.githooks', 'pre-push'),
      path.join(repository, '.githooks', 'pre-push'),
    );
    await copyFile(
      path.join(repositoryRoot, 'scripts', 'setup-git-hooks.sh'),
      path.join(repository, 'scripts', 'setup-git-hooks.sh'),
    );

    const fakeMise = await installFakeMise(temporaryRoot);
    const fakeHome = path.join(temporaryRoot, 'fake-home');
    const userBin = path.join(fakeHome, '.local', 'bin');
    await mkdir(userBin, { recursive: true });
    await copyFile(path.join(fakeMise.bin, 'mise'), path.join(userBin, 'mise'));
    await chmod(path.join(userBin, 'mise'), 0o755);
    command('bash', ['scripts/setup-git-hooks.sh'], repository);
    const installedHook = path.join(repository, '.custom-hooks', 'pre-push');
    assert.ok(
      (await readFile(installedHook, 'utf8')).includes('Installed by nemumi'),
    );
    const push = spawnSync(
      'sh',
      [installedHook, 'refs/heads/feature', 'abc', 'refs/heads/main', 'def'],
      {
        cwd: repository,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: fakeHome,
          BIOME_HOOK_LOG: fakeMise.log,
        },
      },
    );
    assert.equal(push.status, 0, push.stderr);
    assert.match(await readFile(fakeMise.log, 'utf8'), /run ci/);

    const existingHook = '#!/bin/sh\necho custom\n';
    await writeFile(installedHook, existingHook);
    const secondInstall = spawnSync('bash', ['scripts/setup-git-hooks.sh'], {
      cwd: repository,
      encoding: 'utf8',
    });
    assert.notEqual(secondInstall.status, 0);
    assert.equal(await readFile(installedHook, 'utf8'), existingHook);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
