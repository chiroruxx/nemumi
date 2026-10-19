import assert from 'node:assert/strict';
import test from 'node:test';
import { writeGitHubSummary } from '../scripts/lib/content-cli.ts';

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
