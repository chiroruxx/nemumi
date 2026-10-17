import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const globalRule = 'selector-pseudo-class-disallowed-list';

async function lintStyle(css: string) {
  return stylelint.lint({
    code: `<style>\n${css}\n</style>`,
    codeFilename: 'src/lint-suppression-probe.astro',
    configFile: 'stylelint.config.mjs',
  });
}

test('Stylelint rejects file and same-line suppressions, including attempts to disable the restriction', async () => {
  for (const css of [
    `/* stylelint-disable ${globalRule} -- External markup. */\n:global(body) { color: red; }`,
    `:global(body) { color: red; } /* stylelint-disable-line ${globalRule} -- External markup. */`,
    '/* stylelint-disable -- External markup. */\n:global(body) { color: red; }',
    '/* stylelint-disable comment-word-disallowed-list -- Bypass the restriction. */\nbody { color: red; }',
    '/* stylelint-disable-next-line comment-word-disallowed-list -- Bypass the restriction. */\n/* stylelint-disable selector-pseudo-class-disallowed-list -- External markup. */\n:global(body) { color: red; }',
  ]) {
    const result = await lintStyle(css);
    assert.equal(result.errored, true, css);
    assert.ok(
      result.results.some((entry) =>
        entry.warnings.some(
          (warning) =>
            warning.rule === 'comment-word-disallowed-list' ||
            warning.rule === 'reportDisables' ||
            warning.rule === '--report-unscoped-disables',
        ),
      ),
      css,
    );
  }
});

test('Stylelint requires a specific rule and a reason for next-line suppressions', async () => {
  for (const comment of [
    `/* stylelint-disable-next-line ${globalRule} */`,
    `/* stylelint-disable-next-line ${globalRule} -- */`,
    '/* stylelint-disable-next-line -- External markup. */',
  ]) {
    assert.equal(
      (await lintStyle(`${comment}\n:global(body) { color: red; }`)).errored,
      true,
      comment,
    );
  }
});

test('Stylelint permits documented next-line suppressions and ordinary comments', async () => {
  const result = await lintStyle(
    `/* Ordinary component styles. */\n/* stylelint-disable-next-line ${globalRule} -- External markup is outside this component. */\n:global(body) { color: red; }`,
  );
  assert.equal(
    result.errored,
    false,
    JSON.stringify(result.results.flatMap((entry) => entry.warnings)),
  );
});

test('Stylelint still checks global selectors after the suppressed line', async () => {
  const result = await lintStyle(
    `/* stylelint-disable-next-line ${globalRule} -- External markup. */\n:global(body) { color: red; }\n:global(main) { color: blue; }`,
  );
  assert.equal(result.errored, true);
  assert.equal(
    result.results.flatMap((entry) =>
      entry.warnings.filter((warning) => warning.rule === globalRule),
    ).length,
    1,
  );
});

test('Biome rejects missing or blank reasons and accepts a documented inline suppression', async () => {
  const directory = await mkdtemp(path.resolve('tests/lint-suppression-'));
  try {
    for (const [comment, expectedStatus] of [
      ['// biome-ignore lint/suspicious/noDebugger', 1],
      ['// biome-ignore lint/suspicious/noDebugger:', 1],
      ['// biome-ignore lint/suspicious/noDebugger:   ', 1],
      [
        '// biome-ignore lint/suspicious/noDebugger: Intentional debugging hook.',
        0,
      ],
    ] as const) {
      const file = path.join(directory, 'probe.ts');
      await writeFile(file, `${comment}\ndebugger;\n`);
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(import.meta.resolve('@biomejs/biome/bin/biome')),
          'lint',
          file,
        ],
        { encoding: 'utf8' },
      );
      assert.ifError(result.error);
      assert.equal(
        result.status,
        expectedStatus,
        result.stdout + result.stderr,
      );
      if (expectedStatus !== 0) {
        assert.match(result.stdout + result.stderr, /suppressions\/parse/);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
