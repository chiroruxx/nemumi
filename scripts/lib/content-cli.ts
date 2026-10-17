import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

type GitHubSummaryOptions = {
  outputPath?: string | null;
  append?: (path: string, content: string) => Promise<void>;
  createDelimiter?: () => string;
};

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
