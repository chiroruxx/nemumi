import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  formatPruneSummary,
  parsePruneArguments,
  serializeContentResult,
  writeGitHubSummary,
} from '../lib/content-cli.ts';
import type { PruneResult } from '../lib/external-content.ts';
import { pruneContent } from '../lib/external-content.ts';

type RunPruneContentOptions = {
  dryRun?: boolean;
  prune?: typeof pruneContent;
  writeOutput?: (value: string) => void;
  writeSummary?: (value: string) => Promise<void>;
  repositoryRoot?: string;
};

export async function runPruneContent({
  dryRun = false,
  prune = pruneContent,
  writeOutput = (value) => console.log(value),
  writeSummary = writeGitHubSummary,
  repositoryRoot = process.cwd(),
}: RunPruneContentOptions = {}): Promise<PruneResult> {
  const result = await prune({ dryRun });
  await writeSummary(formatPruneSummary(result, repositoryRoot));
  writeOutput(
    JSON.stringify(serializeContentResult(result, repositoryRoot), null, 2),
  );
  return result;
}

async function main(): Promise<void> {
  const { dryRun } = parsePruneArguments(process.argv.slice(2));
  await runPruneContent({ dryRun });
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
