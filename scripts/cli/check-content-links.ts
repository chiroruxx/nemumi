import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkContentLinks } from '../lib/check-content-links.ts';
import { writeGitHubSummary } from '../lib/content-cli.ts';

function parseArguments(args: string[]): { dryRun: boolean } {
  const options = args[0] === '--' ? args.slice(1) : args;
  if (options.length === 0) return { dryRun: false };
  if (options.length === 1 && options[0] === '--dry-run')
    return { dryRun: true };
  throw new Error('Usage: check-content-links [--dry-run]');
}

function formatUnverifiedLinks(result: {
  unverified: Array<{ url: string }>;
  unchecked: Array<{ url: string }>;
}): string {
  const urls = new Set(
    [...result.unverified, ...result.unchecked].map(({ url }) => url),
  );
  if (urls.size === 0) return '公開状態を確認できなかった URL はありません。';
  return `公開状態を確認できなかった URL:\n${[...urls].map((url) => `- ${url}`).join('\n')}`;
}

async function main(): Promise<void> {
  const { dryRun } = parseArguments(process.argv.slice(2));
  const result = await checkContentLinks({ dryRun });
  const summary = formatUnverifiedLinks(result);
  console.log(summary);
  await writeGitHubSummary(summary);
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
