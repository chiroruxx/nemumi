import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { isSource, syncService } from '../lib/external-content.ts';

const [source, ...options] = process.argv.slice(2);
const dryRun = options.includes('--dry-run');

try {
  if (!isSource(source)) throw new Error(`Unknown service: ${source ?? ''}`);
  const result = await syncService(source, { dryRun });
  const changeSummary = result.changes.length
    ? result.changes
        .map(
          ({ action, date, title, url }) =>
            `- ${action === 'add' ? '追加' : '更新'}: ${date}「${title}」 ${url}`,
        )
        .join('\n')
    : '変更はありません。';
  const reportSummary = [
    result.unchecked.length
      ? `未確認のため保持: ${result.unchecked.length} 件`
      : '',
    result.deferred.length
      ? `確認保留のため保持: ${result.deferred.length} 件`
      : '',
    result.review.length ? `要確認のため保持: ${result.review.length} 件` : '',
  ].filter(Boolean);
  const summary = [changeSummary, ...reportSummary].join('\n');
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = `SYNC_SUMMARY_${randomUUID()}`;
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `summary<<${delimiter}\n${summary}\n${delimiter}\n`,
    );
  }
  console.log(
    JSON.stringify(
      {
        source: result.source,
        collection: result.collection,
        feedCount: result.feedCount,
        changes: result.changes.map(({ action, file, date, title, url }) => ({
          action,
          file,
          date,
          title,
          url,
        })),
        kept: result.kept,
        skipped: result.skipped,
        deferred: result.deferred,
        review: result.review,
        unchecked: result.unchecked,
        remainingByCollection: result.remainingByCollection,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const report =
    typeof error === 'object' && error !== null && 'report' in error
      ? (error as { report: unknown }).report
      : undefined;
  if (report) console.log(JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
}
