import { pruneContent } from '../lib/prune-content.ts';

function parsePruneArguments(args: string[]): { dryRun: boolean } {
  const options = args[0] === '--' ? args.slice(1) : args;
  if (options.length === 0) return { dryRun: false };
  if (options.length === 1 && options[0] === '--dry-run') {
    return { dryRun: true };
  }
  throw new Error('Usage: prune-content [--dry-run]');
}

async function main(): Promise<void> {
  const { dryRun } = parsePruneArguments(process.argv.slice(2));
  await pruneContent({ dryRun });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
