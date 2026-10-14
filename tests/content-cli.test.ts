import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatUnverifiedLinks,
  parsePruneArguments,
  parseSyncArguments,
  writeGitHubSummary,
} from '../scripts/lib/content-cli.ts';

test('sync argument parser accepts one service and the pnpm separator', () => {
  assert.deepEqual(parseSyncArguments(['--', 'sizu', '--dry-run']), {
    source: 'sizu',
    dryRun: true,
  });
  assert.deepEqual(parseSyncArguments(['hatena']), {
    source: 'hatena',
    dryRun: false,
  });
});

test('sync argument parser rejects unknown services, flags, and extra positionals', () => {
  assert.throws(() => parseSyncArguments(['unknown']), /Unknown service/);
  assert.throws(() => parseSyncArguments([]), /Usage/);
  assert.throws(() => parseSyncArguments(['sizu', '--dryrun']), /Usage/);
  assert.throws(() => parseSyncArguments(['sizu', 'hatena']), /Usage/);
  assert.throws(() => parseSyncArguments(['--dry-run', 'sizu']), /Usage/);
  assert.throws(() => parseSyncArguments(['--', '--', 'sizu']), /Usage/);
});

test('prune parser accepts the README pnpm separator form and only dry-run', () => {
  assert.deepEqual(parsePruneArguments(['--', '--dry-run']), { dryRun: true });
  assert.deepEqual(parsePruneArguments(['--']), { dryRun: false });
  assert.deepEqual(parsePruneArguments([]), { dryRun: false });
  assert.throws(() => parsePruneArguments(['unexpected']), /Usage/);
  assert.throws(() => parsePruneArguments(['--dryrun']), /Usage/);
  assert.throws(() => parsePruneArguments(['--dry-run', '--dry-run']), /Usage/);
  assert.throws(() => parsePruneArguments(['--', '--', '--dry-run']), /Usage/);
});

test('GitHub summary output is a no-op without a path and writes a random-delimited multiline value', async () => {
  const writes: { path: string; content: string }[] = [];
  await writeGitHubSummary('must not write', {
    outputPath: null,
    append: async (path, content) => {
      writes.push({ path, content });
    },
    createDelimiter: () => 'FIXED_DELIMITER',
  });
  assert.equal(writes.length, 0);

  await writeGitHubSummary('first line\nsecond line', {
    outputPath: '/tmp/github-output',
    append: async (path, content) => {
      writes.push({ path, content });
    },
    createDelimiter: () => 'RANDOM_DELIMITER',
  });
  assert.deepEqual(writes, [
    {
      path: '/tmp/github-output',
      content:
        'summary<<CONTENT_SUMMARY_RANDOM_DELIMITER\nfirst line\nsecond line\nCONTENT_SUMMARY_RANDOM_DELIMITER\n',
    },
  ]);
});

test('GitHub summary append errors propagate to the caller', async () => {
  await assert.rejects(
    writeGitHubSummary('summary', {
      outputPath: '/tmp/github-output',
      append: async () => {
        throw new Error('disk full');
      },
      createDelimiter: () => 'DELIMITER',
    }),
    /disk full/,
  );
});

test('reports only distinct URLs whose public status could not be verified', () => {
  const result = {
    deferred: [
      { source: 'sizu' as const, url: 'https://sizu.me/deferred' },
      { source: 'hatena' as const, url: 'https://sizu.me/shared' },
    ],
    review: [{ source: 'sizu' as const, url: 'https://sizu.me/review' }],
    unchecked: [
      { source: 'sizu' as const, url: 'https://sizu.me/shared' },
      { source: 'sizu' as const, url: 'https://sizu.me/unchecked' },
    ],
  };
  assert.equal(
    formatUnverifiedLinks(result),
    [
      '公開状態を確認できなかった URL:',
      '- https://sizu.me/deferred',
      '- https://sizu.me/shared',
      '- https://sizu.me/review',
      '- https://sizu.me/unchecked',
    ].join('\n'),
  );
  assert.equal(
    formatUnverifiedLinks({
      ...result,
      deferred: [],
      review: [],
      unchecked: [],
    }),
    '公開状態を確認できなかった URL はありません。',
  );
});
