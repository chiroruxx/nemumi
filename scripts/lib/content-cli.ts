import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { isSource } from './external-content.ts';

type GitHubSummaryOptions = {
  outputPath?: string | null;
  append?: (path: string, content: string) => Promise<void>;
  createDelimiter?: () => string;
};

function removeScriptSeparator(args: string[]): string[] {
  return args[0] === '--' ? args.slice(1) : args;
}

export function parseSyncArguments(args: string[]) {
  const [source, ...options] = removeScriptSeparator(args);
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

export function parsePruneArguments(args: string[]) {
  const options = removeScriptSeparator(args);
  if (options.length === 0) return { dryRun: false };
  if (options.length === 1 && options[0] === '--dry-run') {
    return { dryRun: true };
  }
  throw new Error('Usage: prune-content [--dry-run]');
}

export async function writeGitHubSummary(
  summary: string,
  options: GitHubSummaryOptions = {},
): Promise<void> {
  const outputPath =
    options.outputPath === undefined
      ? process.env.GITHUB_OUTPUT
      : options.outputPath;
  if (!outputPath) return;
  const delimiter = `CONTENT_SUMMARY_${(options.createDelimiter ?? randomUUID)()}`;
  await (options.append ?? appendFile)(
    outputPath,
    `summary<<${delimiter}\n${summary}\n${delimiter}\n`,
  );
}

export function formatUnverifiedLinks(result: {
  deferred: Array<{ url: string }>;
  review: Array<{ url: string }>;
  unchecked: Array<{ url: string }>;
}): string {
  const urls = new Set(
    [...result.deferred, ...result.review, ...result.unchecked].map(
      ({ url }) => url,
    ),
  );
  if (urls.size === 0) return '公開状態を確認できなかった URL はありません。';
  return `公開状態を確認できなかった URL:\n${[...urls].map((url) => `- ${url}`).join('\n')}`;
}
