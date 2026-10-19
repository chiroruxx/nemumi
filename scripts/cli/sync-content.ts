import { isSource, type Source } from '../lib/external-content.ts';
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

async function main(): Promise<void> {
  const { source, dryRun } = parseSyncArguments(process.argv.slice(2));
  await syncService(source, { dryRun });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
