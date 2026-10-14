import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  type ContentAutomationApi,
  guardContentAutomation,
} from '../lib/content-automation.ts';
import { createContentAutomationApi } from '../lib/content-automation-api.ts';
import { writeGitHubOutput } from '../lib/content-cli.ts';

const runFile = promisify(execFile);

type PrepareContentPrOptions = {
  api: ContentAutomationApi;
  appSlug: string;
  head: string;
  base?: string;
  getGitStatus?: () => Promise<string>;
  writeOutput?: (name: string, value: string) => Promise<void>;
};

async function getContentGitStatus(): Promise<string> {
  // These are the only paths staged by create-pull-request in the content jobs.
  const { stdout } = await runFile(
    'git',
    [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'src/content/articles',
      'src/content/talks',
    ],
    { encoding: 'utf8' },
  );
  return stdout;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

export async function runPrepareContentPr({
  api,
  appSlug,
  head,
  base = 'main',
  getGitStatus = getContentGitStatus,
  writeOutput = writeGitHubOutput,
}: PrepareContentPrOptions): Promise<{
  proceed: boolean;
  action: string;
}> {
  let decision: Awaited<ReturnType<typeof guardContentAutomation>>;
  try {
    const status = await getGitStatus();
    decision = await guardContentAutomation({
      api,
      appSlug,
      base,
      head,
      hasDiff: status.trim().length > 0,
    });
    if (decision.action === 'stop') throw new Error(decision.reason);
  } catch (error) {
    await writeOutput('proceed', 'false');
    throw error;
  }
  const proceed =
    decision.action === 'run-cpr' || decision.action === 'reopen-then-run-cpr';
  await writeOutput('proceed', String(proceed));
  return { proceed, action: decision.action };
}

async function main(): Promise<void> {
  const repository = requiredEnvironment('GITHUB_REPOSITORY').split('/');
  if (repository.length !== 2 || repository.some((part) => !part)) {
    throw new Error('GITHUB_REPOSITORY must be owner/repository');
  }
  const api = createContentAutomationApi({
    owner: repository[0] ?? '',
    repo: repository[1] ?? '',
    token: requiredEnvironment('GH_TOKEN'),
  });
  await runPrepareContentPr({
    api,
    appSlug: requiredEnvironment('APP_SLUG'),
    head: requiredEnvironment('CONTENT_BRANCH'),
  });
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
