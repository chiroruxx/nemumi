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

    await writeFile(
      path.join(repository, 'src', 'move-target.ts'),
      'export const moved = true;\n',
    );
    await rm(path.join(repository, 'src', 'moved.ts'));
    runHook(
      event(
        'apply_patch',
        '*** Begin Patch\n*** Update File: src/moved.ts\n*** Move to: src/move-target.ts\n@@\n-export const renamed = true;\n+export const moved = true;\n*** End Patch',
      ),
    );
    assert.equal((await logLines()).length, 7);
    assert.ok((await logLines()).at(-1)?.includes('--write'));
    assert.ok((await logLines()).at(-1)?.includes('src/move-target.ts'));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('setup.sh installs Lefthook hooks, stays idempotent, and preserves existing hooks', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nemumi-git-hook-'),
  );
  const repository = path.join(temporaryRoot, 'repo');
  const existingRepository = path.join(temporaryRoot, 'existing-repo');
  const fakeMise = await installFakeMise(temporaryRoot);
  const fakeHome = path.join(temporaryRoot, 'fake-home');
  const userBin = path.join(fakeHome, '.local', 'bin');
  const fakePnpm = path.join(fakeMise.bin, 'pnpm');
  const lefthook = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    'lefthook',
  );
  const setup = path.join(repositoryRoot, 'scripts', 'setup.sh');
  const config = path.join(repositoryRoot, '.lefthook.yml');

  try {
    await mkdir(repository);
    await mkdir(userBin, { recursive: true });
    await copyFile(path.join(fakeMise.bin, 'mise'), path.join(userBin, 'mise'));
    await chmod(path.join(userBin, 'mise'), 0o755);
    await writeFile(
      fakePnpm,
      `#!/bin/sh\nif [ "$1" = exec ] && [ "$2" = lefthook ]; then\n  shift 2\n  exec "${lefthook}" "$@"\nfi\nexit 1\n`,
    );
    await chmod(fakePnpm, 0o755);

    const prepareRepository = async (root: string) => {
      await mkdir(root, { recursive: true });
      command('git', ['init', '--quiet'], root);
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await copyFile(setup, path.join(root, 'scripts', 'setup.sh'));
      await copyFile(config, path.join(root, '.lefthook.yml'));
      await copyFile(
        path.join(repositoryRoot, '.env.example'),
        path.join(root, '.env.example'),
      );
      command('git', ['config', 'user.name', 'Hook test'], root);
      command(
        'git',
        ['config', 'user.email', 'hook-test@example.invalid'],
        root,
      );
      command('git', ['add', '.'], root);
      command('git', ['commit', '--quiet', '-m', 'fixture'], root);
    };
    const environment = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${fakeMise.bin}:${process.env.PATH}`,
      BIOME_HOOK_LOG: fakeMise.log,
    };

    await prepareRepository(repository);
    const firstSetup = spawnSync('bash', ['scripts/setup.sh'], {
      cwd: repository,
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(firstSetup.status, 0, firstSetup.stderr);
    const installedHook = command(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push'],
      repository,
    );
    const installedHookSource = await readFile(installedHook, 'utf8');
    assert.match(installedHookSource, /call_lefthook/);

    const push = spawnSync('sh', [installedHook, 'origin', 'url'], {
      cwd: repository,
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(push.status, 0, `${push.stdout}${push.stderr}`);
    assert.match(await readFile(fakeMise.log, 'utf8'), /run ci/);

    const secondSetup = spawnSync('bash', ['scripts/setup.sh'], {
      cwd: repository,
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(secondSetup.status, 0, secondSetup.stderr);
    assert.equal(await readFile(installedHook, 'utf8'), installedHookSource);
    assert.equal(
      await readFile(`${installedHook}.old`, 'utf8').catch(() => ''),
      '',
    );

    const changedConfig = (
      await readFile(path.join(repository, '.lefthook.yml'), 'utf8')
    ).replace("mise run ci'", "mise run ci --changed'");
    await writeFile(path.join(repository, '.lefthook.yml'), changedConfig);
    const changedPush = spawnSync('sh', [installedHook, 'origin', 'url'], {
      cwd: repository,
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(
      changedPush.status,
      0,
      `${changedPush.stdout}${changedPush.stderr}`,
    );
    assert.match(await readFile(fakeMise.log, 'utf8'), /run ci --changed/);

    await prepareRepository(existingRepository);
    const existingHook = path.join(
      existingRepository,
      '.git',
      'hooks',
      'pre-push',
    );
    const existingHookSource = '#!/bin/sh\necho custom\n';
    await writeFile(existingHook, existingHookSource);
    const blockedSetup = spawnSync('bash', ['scripts/setup.sh'], {
      cwd: existingRepository,
      encoding: 'utf8',
      env: environment,
    });
    assert.notEqual(blockedSetup.status, 0);
    assert.equal(await readFile(existingHook, 'utf8'), existingHookSource);
    assert.equal(
      await readFile(`${existingHook}.old`, 'utf8').catch(() => ''),
      '',
    );

    const legacyRepository = path.join(temporaryRoot, 'legacy-repo');
    await prepareRepository(legacyRepository);
    const legacyHook = path.join(legacyRepository, '.git', 'hooks', 'pre-push');
    await writeFile(
      legacyHook,
      '#!/bin/sh\n# Installed by nemumi: mise run setup-git-hooks\nset -eu\n\nrepo_root=$(git rev-parse --show-toplevel)\nexec "$repo_root/.githooks/pre-push" "$@"\n',
    );
    const legacySetup = spawnSync('bash', ['scripts/setup.sh'], {
      cwd: legacyRepository,
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(legacySetup.status, 0, legacySetup.stderr);
    assert.match(await readFile(legacyHook, 'utf8'), /call_lefthook/);

    const customRepository = path.join(temporaryRoot, 'custom-repo');
    await prepareRepository(customRepository);
    command(
      'git',
      ['config', 'core.hooksPath', '.custom-hooks'],
      customRepository,
    );
    const customSetup = spawnSync('bash', ['scripts/setup.sh'], {
      cwd: customRepository,
      encoding: 'utf8',
      env: environment,
    });
    assert.notEqual(customSetup.status, 0);
    assert.equal(
      command('git', ['config', '--get', 'core.hooksPath'], customRepository),
      '.custom-hooks',
    );
    assert.equal(
      await readFile(
        path.join(customRepository, '.custom-hooks', 'pre-push'),
        'utf8',
      ).catch(() => ''),
      '',
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
