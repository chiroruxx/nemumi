import { createHash } from 'node:crypto';
import path from 'node:path';
import type { z } from 'zod';
import type { contentRecordSchema } from '../../src/config/content-schema.ts';
import { type Service, type Source, services } from './external-content.ts';

export const limits = { articles: 20, talks: 10 };

export type Collection = keyof typeof limits;
type ContentData = z.infer<typeof contentRecordSchema>;
export type FeedItem = { date: Date; title: string; url: string };
export type StoredEntry = { file: string; id: string; data: ContentData };
export type LinkStatus = 'public' | 'deleted' | 'defer' | 'review';
type IndexedEntry = {
  entry: StoredEntry;
  url?: string;
  source?: Source;
};
type CollectionIndex = {
  collection: Collection;
  entries: IndexedEntry[];
  byUrl: Map<string, IndexedEntry>;
  manualCount: number;
};
export type SyncChange = {
  action: 'add' | 'update';
  file: string;
  date: Date;
  title: string;
  url: string;
  types: string[];
};
export type PruneRemoval = {
  file: string;
};
export type LinkCheck = { source: Source; url: string };
type SyncPlan = { changes: SyncChange[]; linkChecks: LinkCheck[] };
type PrunePlan = { removals: PruneRemoval[]; linkChecks: LinkCheck[] };

type ParsedContentUrl = {
  url: URL;
  canonical: string;
  source: Source | undefined;
};

function analyzeContentUrl(
  value: string,
  collection?: Collection,
): ParsedContentUrl {
  const url = new URL(value);
  url.hash = '';
  const source = collection
    ? (Object.entries(services) as [Source, Service][]).find(
        ([, service]) =>
          service.collection === collection &&
          service.host === url.hostname &&
          url.pathname.startsWith(service.pathPrefix),
      )?.[0]
    : undefined;
  return { url, canonical: url.href, source };
}

export function validateContentUrl(value: string, service: Service): string {
  const parsed = analyzeContentUrl(value, service.collection);
  const configuredSource = (
    Object.entries(services) as [Source, Service][]
  ).find(
    ([, configured]) =>
      configured.host === service.host &&
      configured.pathPrefix === service.pathPrefix &&
      configured.collection === service.collection,
  )?.[0];
  if (
    parsed.url.protocol !== 'https:' ||
    (parsed.url.port !== '' && parsed.url.port !== '443') ||
    parsed.url.hostname !== service.host ||
    !parsed.url.pathname.startsWith(service.pathPrefix) ||
    parsed.url.username ||
    parsed.url.password ||
    !configuredSource ||
    parsed.source !== configuredSource
  ) {
    throw new Error(`Unexpected ${service.label} content URL: ${value}`);
  }
  return parsed.canonical;
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
    const url = parsed?.canonical;
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
    manualCount: indexedEntries.filter(({ source }) => !source).length,
  };
}

function normalizedFeed(
  feed: FeedItem[],
  source: Source,
): Map<string, FeedItem> {
  const service = services[source];
  const normalized = new Map<string, FeedItem>();
  for (const item of feed) {
    const url = validateContentUrl(item.url, service);
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
  const byUrl = new Map<string, { date: Date }>();
  for (const indexed of index.byUrl.values()) {
    if (indexed.url) byUrl.set(indexed.url, { date: indexed.entry.data.date });
  }
  for (const [url, item] of feedByUrl) byUrl.set(url, { date: item.date });

  const available = limits[index.collection] - index.manualCount;
  if (available < 0) {
    throw new Error(
      `${index.collection} manual entries exceed its ${limits[index.collection]} item limit`,
    );
  }
  return new Set(
    [...byUrl.entries()]
      .sort(
        ([urlA, a], [urlB, b]) =>
          b.date.getTime() - a.date.getTime() || urlA.localeCompare(urlB),
      )
      .slice(0, available)
      .map(([url]) => url),
  );
}

function filenameFor(source: Source, url: string): string {
  return `${source}-${createHash('sha256').update(url).digest('hex')}.yaml`;
}

function sameValues(left: string[] | undefined, right: string[]): boolean {
  return (
    left?.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function createSyncPlan({
  source,
  index,
  feed,
  contentDirectory,
}: {
  source: Source;
  index: CollectionIndex;
  feed: FeedItem[];
  contentDirectory: string;
}): SyncPlan {
  const service = services[source];
  if (service.collection !== index.collection) {
    throw new Error(
      `${service.label} cannot sync the ${index.collection} collection`,
    );
  }
  const feedByUrl = normalizedFeed(feed, source);
  const keep = rankedKeepSet(index, feedByUrl);
  const changes: SyncChange[] = [];
  const linkChecks: LinkCheck[] = [];

  for (const [url, item] of [...feedByUrl].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!keep.has(url)) continue;
    const previous = index.byUrl.get(url)?.entry;
    const types = previous?.data.types ?? [service.type];
    if (
      previous &&
      previous.data.date.getTime() === item.date.getTime() &&
      previous.data.title === item.title &&
      previous.data.url === item.url &&
      sameValues(previous.data.types, types)
    ) {
      continue;
    }
    const file =
      previous?.file ??
      path.join(contentDirectory, index.collection, filenameFor(source, url));
    if (
      !previous &&
      index.entries.some(({ entry }) => entry.id === path.basename(file))
    ) {
      throw new Error(`Filename collision while adding ${url}`);
    }
    if (!previous) {
      linkChecks.push({ source, url });
    }
    changes.push({
      action: previous ? 'update' : 'add',
      file,
      date: item.date,
      title: item.title,
      url: item.url,
      types,
    });
  }

  return { changes, linkChecks };
}

export function createPrunePlan(index: CollectionIndex): PrunePlan {
  const keep = rankedKeepSet(index);
  const removals: PruneRemoval[] = [];
  const linkChecks: LinkCheck[] = [];

  for (const indexed of index.entries) {
    const { source, url } = indexed;
    if (!source || !url) continue;
    if (!keep.has(url)) {
      removals.push({ file: indexed.entry.file });
      continue;
    }
    linkChecks.push({ source, url });
  }

  removals.sort((a, b) => a.file.localeCompare(b.file));
  linkChecks.sort(
    (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
  );
  return { removals, linkChecks };
}
