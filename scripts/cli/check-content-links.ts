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
  unverified: Array<{ url: URL }>;
  unchecked: Array<{ url: URL }>;
}): string {
  const urls = new Set(
    [...result.unverified, ...result.unchecked].map(({ url }) => url.href),
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

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
