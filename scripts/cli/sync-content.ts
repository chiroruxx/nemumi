import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatSyncSummary,
  parseSyncArguments,
  serializeContentResult,
  writeGitHubSummary,
} from '../lib/content-cli.ts';
import type { Source, SyncResult } from '../lib/external-content.ts';
import { syncService } from '../lib/external-content.ts';

type RunSyncOptions = {
  source: Source;
  dryRun?: boolean;
  sync?: typeof syncService;
  writeOutput?: (value: string) => void;
  writeSummary?: (value: string) => Promise<void>;
  repositoryRoot?: string;
};

function hasSyncReport(
  error: unknown,
): error is Error & { report: SyncResult } {
  return (
    error instanceof Error &&
    typeof error === 'object' &&
    'report' in error &&
    Boolean(error.report) &&
    typeof error.report === 'object' &&
    error.report !== null &&
    'source' in error.report
  );
}

export async function runSyncContent({
  source,
  dryRun = false,
  sync = syncService,
  writeOutput = (value) => console.log(value),
  writeSummary = writeGitHubSummary,
  repositoryRoot = process.cwd(),
}: RunSyncOptions): Promise<SyncResult> {
  const writeReport = async (result: SyncResult) => {
    await writeSummary(formatSyncSummary(result, repositoryRoot));
    writeOutput(
      JSON.stringify(serializeContentResult(result, repositoryRoot), null, 2),
    );
  };

  let result: SyncResult;
  try {
    result = await sync(source, { dryRun });
  } catch (error) {
    if (hasSyncReport(error)) await writeReport(error.report);
    throw error;
  }
  await writeReport(result);
  return result;
}

async function main(): Promise<void> {
  const { source, dryRun } = parseSyncArguments(process.argv.slice(2));
  await runSyncContent({ source, dryRun });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
