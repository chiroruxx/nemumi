import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayRelativePath,
  formatContentSummary,
  formatPruneSummary,
  formatSyncSummary,
  parsePruneArguments,
  parseSyncArguments,
  serializeContentResult,
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

test('content summary keeps each title on one escaped Markdown line and preserves URL queries', () => {
  const summary = formatContentSummary(
    [
      {
        label: '追加',
        date: '2026-10-13',
        title: 'title\n- injected `code` [link] *bold*',
        url: 'https://example.com/a?one=1&two=two',
      },
    ],
    '変更はありません。',
  );
  assert.equal(
    summary,
    '- 追加: 2026-10-13「title \\- injected \\`code\\` \\[link\\] \\*bold\\*」 <https://example.com/a?one=1&two=two>',
  );
  assert.equal(
    formatContentSummary([], '変更はありません。'),
    '変更はありません。',
  );
});

test('content summary displays existing HTTP URLs without changing their query', () => {
  assert.equal(
    formatContentSummary(
      [
        {
          label: '上限超過',
          date: '2020-01-01',
          title: 'Legacy URL',
          url: 'http://example.com/legacy?source=manual',
        },
      ],
      '削除対象はありません。',
    ),
    '- 上限超過: 2020-01-01「Legacy URL」 <http://example.com/legacy?source=manual>',
  );
});

test('content summary displays credentialed and non-HTTP URLs as inert text', () => {
  assert.equal(
    formatContentSummary(
      [
        {
          label: '削除',
          date: '2020-01-01',
          title: 'Legacy scheme',
          url: 'ftp://user:secret@example.com/file?download=1',
        },
      ],
      '削除対象はありません。',
    ),
    '- 削除: 2020-01-01「Legacy scheme」 `ftp://user:secret@example.com/file?download=1`',
  );
});

test('content summary safely fences backticks in legacy URLs and file paths', () => {
  assert.equal(
    formatContentSummary(
      [
        {
          label: '削除',
          date: '2020-01-01',
          title: 'Legacy URL',
          url: 'javascript:alert(`x`)',
          file: 'src/content/articles/file`name.yaml',
        },
      ],
      '削除対象はありません。',
    ),
    '- 削除: 2020-01-01「Legacy URL」 ``javascript:alert(`x`)`` (``src/content/articles/file`name.yaml``)',
  );
});

test('file display path is relative to the supplied repository root', () => {
  assert.equal(
    displayRelativePath('/repo/src/content/articles/post.yaml', '/repo'),
    'src/content/articles/post.yaml',
  );
});

test('sync report keeps original values while serializing file paths relative and summarizes dispositions', () => {
  const result = {
    source: 'sizu' as const,
    collection: 'articles' as const,
    feedCount: 4,
    changes: [
      {
        action: 'add' as const,
        file: '/repo/src/content/articles/new.yaml',
        date: new Date('2026-10-13'),
        title: 'New\npost',
        url: 'https://sizu.me/chihiroxx/posts/new?ref=rss',
        types: ['日常記事'],
      },
    ],
    kept: 5,
    skipped: [
      {
        source: 'sizu' as const,
        url: 'https://sizu.me/chihiroxx/posts/skipped',
        status: 'unchecked' as const,
        reason: 'execution-deadline' as const,
      },
    ],
    deferred: [],
    review: [],
    unchecked: [],
    remainingByCollection: { articles: 6 },
  };
  assert.deepEqual(serializeContentResult(result, '/repo'), {
    ...result,
    changes: [
      {
        ...result.changes[0],
        date: '2026-10-13',
        file: 'src/content/articles/new.yaml',
      },
    ],
  });
  assert.equal(result.changes[0].file, '/repo/src/content/articles/new.yaml');
  const summary = formatSyncSummary(result, '/repo');
  assert.match(summary, /RSS取得: 4件/);
  assert.match(summary, /保持: 5件/);
  assert.match(summary, /未確認/);
  assert.match(summary, /src\/content\/articles\/new.yaml/);
  assert.match(summary, /ref=rss/);
});

test('prune report summarizes removal, keep, manual skip, and remaining counts with relative files', () => {
  const result = {
    removals: [
      {
        reason: 'limit' as const,
        file: '/repo/src/content/articles/old.yaml',
        date: new Date('2020-01-01'),
        title: 'Old post',
        url: 'http://example.com/old?from=archive',
      },
    ],
    kept: [
      {
        file: '/repo/src/content/articles/current.yaml',
        date: '2026-10-13',
        title: 'Current post',
        url: 'https://example.com/current',
        reason: 'public' as const,
      },
    ],
    skipped: [
      {
        file: '/repo/src/content/articles/manual.yaml',
        date: '2026-10-12',
        title: 'Manual post',
        url: 'mailto:editor@example.com',
        reason: 'manual' as const,
      },
    ],
    deferred: [{ source: 'sizu' as const, url: 'https://sizu.me/item' }],
    review: [],
    unchecked: [],
    remainingByCollection: { articles: 20, talks: 10 },
  };
  assert.deepEqual(serializeContentResult(result, '/repo'), {
    ...result,
    removals: [
      {
        ...result.removals[0],
        date: '2020-01-01',
        file: 'src/content/articles/old.yaml',
      },
    ],
    kept: [{ ...result.kept[0], file: 'src/content/articles/current.yaml' }],
    skipped: [
      { ...result.skipped[0], file: 'src/content/articles/manual.yaml' },
    ],
  });
  const summary = formatPruneSummary(result, '/repo');
  assert.match(summary, /上限超過/);
  assert.match(summary, /保持: 1件/);
  assert.match(summary, /手動管理: 1件/);
  assert.match(summary, /判定保留/);
  assert.match(summary, /articles: 20件/);
  assert.match(summary, /src\/content\/articles\/old.yaml/);
  assert.match(summary, /mailto:editor@example.com/);
});
