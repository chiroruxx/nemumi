import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pruneContent } from '../lib/external-content.ts';

const dryRun = process.argv.includes('--dry-run');

export async function runPruneContent({
  dryRun = false,
  prune = pruneContent,
  writeOutput = (value: string) => console.log(value),
  writeSummary = (value: string) =>
    process.env.GITHUB_OUTPUT ? appendGitHubSummary(value) : Promise.resolve(),
}: {
  dryRun?: boolean;
  prune?: typeof pruneContent;
  writeOutput?: (value: string) => void;
  writeSummary?: (value: string) => Promise<void>;
} = {}) {
  const result = await prune({ dryRun });
  const summary = result.removals.length
    ? result.removals
        .map(
          ({ reason, date, title, url }) =>
            `- ${reason === 'limit' ? '上限超過' : 'リンク切れ'}: ${date}「${title}」 ${url}`,
        )
        .join('\n')
    : '削除対象はありません。';
  await writeSummary(summary);
  writeOutput(
    JSON.stringify(
      {
        removals: result.removals.map(({ reason, file, date, title, url }) => ({
          reason,
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
  return result;
}

async function appendGitHubSummary(summary: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const delimiter = `PRUNE_SUMMARY_${randomUUID()}`;
  await appendFile(
    outputPath,
    `summary<<${delimiter}\n${summary}\n${delimiter}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await runPruneContent({ dryRun });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
