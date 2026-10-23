import { createHash } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  buildCollectionIndex,
  type CollectionIndex,
  type CommonContentOptions,
  type ContentData,
  defaultContentDirectory,
  type FeedItem,
  getService,
  type Service,
  type Source,
  validateContentUrl,
} from './external-content.ts';
import {
  type ContentFileWrite,
  readCollection,
  validateFileWrites,
  writeFiles,
} from './external-content-files.ts';
import {
  createExecutionContext,
  type ExecutionContext,
  fetchFeed,
} from './external-content-http.ts';

type FeedLoader = (
  service: Service,
  context: ExecutionContext,
) => Promise<FeedItem[]>;
type SyncOptions = CommonContentOptions & {
  feedLoader?: FeedLoader;
  executionBudgetMs?: number;
  now?: () => number;
};

function normalizeFeedItem(item: FeedItem, service: Service): FeedItem {
  const url = new URL(item.url);
  validateContentUrl(url, service);
  url.hash = '';
  return { ...item, url };
}

function normalizedFeed(
  feed: FeedItem[],
  source: Source,
): Map<string, FeedItem> {
  const service = getService(source);
  const normalized = new Map<string, FeedItem>();
  for (const item of feed) {
    const value = normalizeFeedItem(item, service);
    const { url } = value;
    const previous = normalized.get(url.href);
    if (
      previous &&
      (previous.date.getTime() !== value.date.getTime() ||
        previous.title !== value.title)
    ) {
      throw new Error(`Conflicting RSS items for URL: ${url}`);
    }
    normalized.set(url.href, value);
  }
  return normalized;
}

function filenameFor(source: Source, url: string): string {
  return `${source}-${createHash('sha256').update(url).digest('hex')}.yaml`;
}

function sameContent(
  data: ContentData,
  item: FeedItem,
  types: string[],
): boolean {
  return (
    data.date.getTime() === item.date.getTime() &&
    data.title === item.title &&
    data.url?.href === item.url.href &&
    data.types?.length === types.length &&
    data.types.every((value, index) => value === types[index])
  );
}

function serializeContent(item: FeedItem, types: string[]): string {
  return YAML.stringify(
    {
      date: formatDateInSiteTimeZone(item.date),
      types,
      title: item.title,
      url: item.url.href,
    },
    { defaultStringType: 'QUOTE_DOUBLE' },
  );
}

function createSyncWrites({
  source,
  index,
  feed,
  contentDirectory,
}: {
  source: Source;
  index: CollectionIndex;
  feed: FeedItem[];
  contentDirectory: string;
}): ContentFileWrite[] {
  const feedByUrl = normalizedFeed(feed, source);
  const writes: ContentFileWrite[] = [];

  for (const [, item] of [...feedByUrl].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const write = createSyncWrite(item, source, index, contentDirectory);
    if (write) writes.push(write);
  }

  return writes;
}

function createSyncWrite(
  item: FeedItem,
  source: Source,
  index: CollectionIndex,
  contentDirectory: string,
): ContentFileWrite | undefined {
  const service = getService(source);
  const previous = index.byUrl.get(item.url.href)?.entry;
  if (previous) {
    const types = previous.data.types ?? [service.type];
    if (sameContent(previous.data, item, types)) return undefined;
    return {
      kind: 'replace',
      target: previous.file,
      content: serializeContent(item, types),
    };
  }
  const file = path.resolve(
    contentDirectory,
    index.collection,
    filenameFor(source, item.url.href),
  );
  if (index.entries.some(({ entry }) => entry.id === path.basename(file))) {
    throw new Error(`Filename collision while adding ${item.url.href}`);
  }
  return {
    kind: 'create',
    target: file,
    content: serializeContent(item, [service.type]),
  };
}

export async function syncService(
  source: Source,
  {
    dryRun = false,
    contentDirectory = defaultContentDirectory,
    feedLoader,
    executionBudgetMs,
    now = Date.now,
  }: SyncOptions = {},
): Promise<void> {
  const service = getService(source);

  const context = createExecutionContext({
    ...(executionBudgetMs === undefined ? {} : { budgetMs: executionBudgetMs }),
    now,
  });
  try {
    const index = buildCollectionIndex(
      service.collection,
      await readCollection(service.collection, contentDirectory),
    );
    const loadFeed =
      feedLoader ??
      ((configured, execution) =>
        fetchFeed(configured, { context: execution }));
    const currentFeed = await loadFeed(service, context);
    const writes = createSyncWrites({
      source,
      index,
      feed: currentFeed,
      contentDirectory,
    });
    await validateFileWrites(writes, contentDirectory);
    if (!dryRun) await writeFiles(writes);
  } finally {
    context.dispose();
  }
}
