import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { checkContentLinks } from '../scripts/lib/check-content-links.ts';
import type { ContentResult } from '../scripts/lib/external-content.ts';
import { syncService } from '../scripts/lib/sync-content.ts';
import { createContentDirectory } from './helpers/content-fixture.ts';

const executions: [
  string,
  (contentDirectory: string) => Promise<ContentResult>,
][] = [
  [
    'sync',
    (contentDirectory) =>
      syncService('sizu', {
        contentDirectory,
        executionBudgetMs: 1000,
        feedLoader: async () => [],
      }),
  ],
  [
    'link check',
    (contentDirectory) =>
      checkContentLinks({
        contentDirectory,
        executionBudgetMs: 1000,
      }),
  ],
];

for (const [name, run] of executions) {
  test(`${name} cancels its execution deadline timer after completion and failure`, async (t) => {
    const contentDirectory = await createContentDirectory(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const setTimer = t.mock.method(globalThis, 'setTimeout');
    const clearTimer = t.mock.method(globalThis, 'clearTimeout');

    assert.deepEqual(await run(contentDirectory), {
      deferred: [],
      review: [],
      unchecked: [],
    });
    assert.equal(setTimer.mock.calls.length, 1);
    assert.equal(clearTimer.mock.calls.length, 1);
    assert.equal(
      clearTimer.mock.calls[0].arguments[0],
      setTimer.mock.calls[0].result,
    );

    await writeFile(
      path.join(contentDirectory, 'articles', 'invalid.yaml'),
      'date: [unterminated',
    );
    await assert.rejects(run(contentDirectory), /YAML/);
    assert.equal(setTimer.mock.calls.length, 2);
    assert.equal(clearTimer.mock.calls.length, 2);
    assert.equal(
      clearTimer.mock.calls[1].arguments[0],
      setTimer.mock.calls[1].result,
    );
  });
}
