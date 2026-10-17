import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatUnverifiedLinks,
  writeGitHubSummary,
} from '../lib/content-cli.ts';
import { isSource, type Source } from '../lib/external-content.ts';
import type { SyncResult } from '../lib/sync-content.ts';
import { syncService } from '../lib/sync-content.ts';

function parseSyncArguments(args: string[]): {
  source: Source;
  dryRun: boolean;
} {
  const [source, ...options] = args[0] === '--' ? args.slice(1) : args;
  if (
    !source ||
    source.startsWith('-') ||
    options.some((option) => option !== '--dry-run') ||
    options.length > 1
  ) {
    throw new Error(
      'Usage: sync-content <sizu|hatena|speakerdeck> [--dry-run]',
    );
  }
  if (!isSource(source)) throw new Error(`Unknown service: ${source}`);
  return { source, dryRun: options.includes('--dry-run') };
}

type RunSyncOptions = {
  source: Source;
  dryRun?: boolean;
  sync?: typeof syncService;
  writeOutput?: (value: string) => void;
  writeSummary?: (value: string) => Promise<void>;
};

function hasSyncReport(
  error: unknown,
): error is Error & { report: SyncResult } {
  if (
    !(error instanceof Error) ||
    !('report' in error) ||
    !error.report ||
    typeof error.report !== 'object'
  ) {
    return false;
  }
  const report = error.report as Record<string, unknown>;
  return ['deferred', 'review', 'unchecked'].every(
    (key) =>
      Array.isArray(report[key]) &&
      report[key].every(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'url' in entry &&
          typeof entry.url === 'string',
      ),
  );
}

async function runSyncContent({
  source,
  dryRun = false,
  sync = syncService,
  writeOutput = (value) => console.log(value),
  writeSummary = writeGitHubSummary,
}: RunSyncOptions): Promise<SyncResult> {
  const writeReport = async (result: SyncResult) => {
    const summary = formatUnverifiedLinks(result);
    writeOutput(summary);
    await writeSummary(summary);
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
