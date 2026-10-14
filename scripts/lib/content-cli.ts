import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import type { PruneResult, SyncResult } from './external-content.ts';
import { isSource } from './external-content.ts';

type SummaryItem = {
  label: string;
  date: string;
  title: string;
  url?: string;
  file?: string;
};

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

function escapeMarkdownText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\\`*_{}[\]()#+\-.!>|]/g, '\\$&');
}

function inlineCode(value: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), ([run]) => run.length),
  );
  const fence = '`'.repeat(longestRun + 1);
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function summaryUrl(value: string | undefined): string {
  if (!value) return '';
  const url = new URL(value);
  if (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password
  ) {
    return ` <${url.href}>`;
  }
  return ` ${inlineCode(url.href)}`;
}

export function formatContentSummary(
  items: SummaryItem[],
  emptyMessage: string,
): string {
  if (items.length === 0) return emptyMessage;
  return items
    .map(
      ({ label, date, title, url, file }) =>
        `- ${escapeMarkdownText(label)}: ${date}「${escapeMarkdownText(title)}」${summaryUrl(url)}${file ? ` (${inlineCode(file)})` : ''}`,
    )
    .join('\n');
}

function formatLinkChecks(
  label: string,
  entries: Array<{ source: string; url: string }>,
): string[] {
  return [
    `${label}: ${entries.length}件`,
    ...entries.map(
      ({ source, url }) =>
        `- ${escapeMarkdownText(source)}: ${summaryUrl(url).trim()}`,
    ),
  ];
}

export function formatSyncSummary(
  result: SyncResult,
  root = process.cwd(),
): string {
  const changes = formatContentSummary(
    result.changes.map(({ action, file, date, title, url }) => ({
      label: action === 'add' ? '追加' : '更新',
      file: displayRelativePath(file, root),
      date: formatDateInSiteTimeZone(date),
      title,
      url,
    })),
    '変更はありません。',
  );
  const skipped = result.skipped.map(
    ({ source, url, status, reason }) =>
      `- ${escapeMarkdownText(source)}: ${summaryUrl(url).trim()} (${status}/${reason})`,
  );
  const remaining = Object.entries(result.remainingByCollection)
    .map(([collection, count]) => `${collection}: ${count}件`)
    .join('、');
  return [
    `RSS取得: ${result.feedCount}件`,
    `変更: ${result.changes.length}件`,
    changes,
    `保持: ${result.kept}件`,
    `追加見送り: ${result.skipped.length}件`,
    ...skipped,
    ...formatLinkChecks('判定保留', result.deferred),
    ...formatLinkChecks('要確認', result.review),
    ...formatLinkChecks('未確認', result.unchecked),
    `残件数: ${remaining || 'なし'}`,
  ].join('\n');
}

export function formatPruneSummary(
  result: PruneResult,
  root = process.cwd(),
): string {
  const removals = formatContentSummary(
    result.removals.map(({ reason, file, date, title, url }) => ({
      label: reason === 'limit' ? '上限超過' : 'リンク切れ',
      file: displayRelativePath(file, root),
      date: formatDateInSiteTimeZone(date),
      title,
      url,
    })),
    '削除対象はありません。',
  );
  const kept = formatContentSummary(
    result.kept.map(({ reason, file, date, title, url }) => ({
      label: `保持 (${reason})`,
      file: displayRelativePath(file, root),
      date,
      title,
      url,
    })),
    '保持対象はありません。',
  );
  const skipped = formatContentSummary(
    result.skipped.map(({ file, date, title, url }) => ({
      label: '手動管理',
      file: displayRelativePath(file, root),
      date,
      title,
      url,
    })),
    '手動管理項目はありません。',
  );
  const remaining = Object.entries(result.remainingByCollection)
    .map(([collection, count]) => `${collection}: ${count}件`)
    .join('、');
  return [
    `削除: ${result.removals.length}件`,
    removals,
    `保持: ${result.kept.length}件`,
    kept,
    `手動管理: ${result.skipped.length}件`,
    skipped,
    ...formatLinkChecks('判定保留', result.deferred),
    ...formatLinkChecks('要確認', result.review),
    ...formatLinkChecks('未確認', result.unchecked),
    `残件数: ${remaining}`,
  ].join('\n');
}

export function serializeContentResult(
  result: SyncResult | PruneResult,
  root = process.cwd(),
): Record<string, unknown> {
  if ('source' in result) {
    return {
      ...result,
      changes: result.changes.map((change) => ({
        ...change,
        date: formatDateInSiteTimeZone(change.date),
        file: displayRelativePath(change.file, root),
      })),
    };
  }
  return {
    ...result,
    removals: result.removals.map((removal) => ({
      ...removal,
      date: formatDateInSiteTimeZone(removal.date),
      file: displayRelativePath(removal.file, root),
    })),
    kept: result.kept.map((entry) => ({
      ...entry,
      file: displayRelativePath(entry.file, root),
    })),
    skipped: result.skipped.map((entry) => ({
      ...entry,
      file: displayRelativePath(entry.file, root),
    })),
  };
}

export function displayRelativePath(
  filePath: string,
  root = process.cwd(),
): string {
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  return relativePath || '.';
}
