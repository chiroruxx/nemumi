import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { isSource, syncService } from '../lib/external-content.ts';

const [source, ...options] = process.argv.slice(2);
const dryRun = options.includes('--dry-run');

try {
  if (!isSource(source)) throw new Error(`Unknown service: ${source ?? ''}`);
  const result = await syncService(source, { dryRun });
  const summary = result.changes.length
    ? result.changes
        .map(
          ({ action, date, title, url }) =>
            `- ${action === 'add' ? '追加' : '更新'}: ${date}「${title}」 ${url}`,
        )
        .join('\n')
    : '変更はありません。';
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
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
