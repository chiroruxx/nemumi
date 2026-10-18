import { createHash } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import type { z } from 'zod';
import type { contentRecordSchema } from '../../src/config/content-schema.ts';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  findSource,
  getService,
  type Source,
  validateContentUrl,
} from './external-content.ts';
import type {
  ContentFileRemoval,
  ContentFileWrite,
} from './external-content-files.ts';

export const limits = { articles: 20, talks: 10 };

export type Collection = keyof typeof limits;
type ContentData = z.infer<typeof contentRecordSchema>;
export type FeedItem = { date: Date; title: string; url: string };
export type StoredEntry = { file: string; id: string; data: ContentData };
export type LinkStatus = 'public' | 'deleted' | 'defer' | 'review';
type IndexedEntry = {
  entry: StoredEntry;
  url: string | undefined;
  source: Source | undefined;
};
type CollectionIndex = {
  collection: Collection;
  entries: IndexedEntry[];
  byUrl: Map<string, IndexedEntry>;
};
export type LinkCheck = { source: Source; url: string };

type ParsedContentUrl = {
  url: URL;
  source: Source | undefined;
};

function analyzeContentUrl(
  value: URL,
  collection?: Collection,
): ParsedContentUrl {
  const url = new URL(value);
  url.hash = '';
  const source = collection ? findSource(url, collection) : undefined;
  return { url, source };
}

export function buildCollectionIndex(
  collection: Collection,
  entries: StoredEntry[],
): CollectionIndex {
  const byUrl = new Map<string, IndexedEntry>();
  const seenUrls = new Map<string, string>();
  const indexedEntries = entries.map((entry) => {
    const value = entry.data.url;
    const parsed = value ? analyzeContentUrl(value, collection) : undefined;
    const url = parsed?.url.href;
    if (url) {
      const previous = seenUrls.get(url);
      if (previous) {
        throw new Error(
          `${collection} URL is duplicated in ${previous} and ${entry.id}: ${url}`,
        );
      }
      seenUrls.set(url, entry.id);
    }
    const source = parsed?.source;
    const indexed = { entry, url, source };
    if (url && source) byUrl.set(url, indexed);
    return indexed;
  });

  return {
    collection,
    entries: indexedEntries,
    byUrl,
  };
}

function normalizedFeed(
  feed: FeedItem[],
  source: Source,
): Map<string, FeedItem> {
  const service = getService(source);
  const normalized = new Map<string, FeedItem>();
  for (const item of feed) {
    const parsed = new URL(item.url);
    validateContentUrl(parsed, service);
    parsed.hash = '';
    const url = parsed.href;
    const value = { ...item, url };
    const previous = normalized.get(url);
    if (
      previous &&
      (previous.date !== value.date || previous.title !== value.title)
    ) {
      throw new Error(`Conflicting RSS items for URL: ${url}`);
    }
    normalized.set(url, value);
  }
  return normalized;
}

function rankedKeepSet(
  index: CollectionIndex,
  feedByUrl: Map<string, FeedItem> = new Map(),
): Set<string> {
  const candidates = new Map<string, { date: Date }>();
  for (const indexed of index.entries) {
    candidates.set(indexed.url ?? indexed.entry.file, {
      date: indexed.entry.data.date,
    });
  }
  for (const [url, item] of feedByUrl) candidates.set(url, { date: item.date });

  return new Set(
    [...candidates.entries()]
      .sort(
        ([keyA, a], [keyB, b]) =>
          b.date.getTime() - a.date.getTime() || keyA.localeCompare(keyB),
      )
      .slice(0, limits[index.collection])
      .map(([key]) => key),
  );
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
    data.url?.href === item.url &&
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
      url: item.url,
    },
    { defaultStringType: 'QUOTE_DOUBLE' },
  );
}

export function createSyncWrites({
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
  const service = getService(source);
  if (service.collection !== index.collection) {
    throw new Error(
      `${service.label} cannot sync the ${index.collection} collection`,
    );
  }
  const feedByUrl = normalizedFeed(feed, source);
  const keep = rankedKeepSet(index, feedByUrl);
  const writes: ContentFileWrite[] = [];

  for (const [url, item] of [...feedByUrl].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!keep.has(url)) continue;
    const previous = index.byUrl.get(url)?.entry;
    if (previous) {
      const types = previous.data.types ?? [service.type];
      if (sameContent(previous.data, item, types)) continue;
      writes.push({
        kind: 'replace',
        target: path.resolve(previous.file),
        content: serializeContent(item, types),
      });
      continue;
    }

    const file = path.resolve(
      contentDirectory,
      index.collection,
      filenameFor(source, url),
    );
    if (index.entries.some(({ entry }) => entry.id === path.basename(file))) {
      throw new Error(`Filename collision while adding ${url}`);
    }
    writes.push({
      kind: 'create',
      target: file,
      content: serializeContent(item, [service.type]),
    });
  }

  return writes;
}

export function createPruneRemovals(
  index: CollectionIndex,
): ContentFileRemoval[] {
  const keep = rankedKeepSet(index);
  const removals: ContentFileRemoval[] = [];

  for (const indexed of index.entries) {
    if (!keep.has(indexed.url ?? indexed.entry.file)) {
      removals.push({ target: path.resolve(indexed.entry.file) });
    }
  }

  removals.sort((a, b) => a.target.localeCompare(b.target));
  return removals;
}

export function createContentLinkCheckPlan(
  index: CollectionIndex,
): LinkCheck[] {
  return index.entries
    .flatMap(({ source, url }) => (source && url ? [{ source, url }] : []))
    .sort(
      (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
    );
}
