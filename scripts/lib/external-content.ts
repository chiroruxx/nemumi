import path from 'node:path';
import type { z } from 'zod';
import type { contentRecordSchema } from '../../src/config/content-schema.ts';

const services = {
  sizu: {
    label: 'しずかなインターネット',
    feed: 'https://sizu.me/chihiroxx/rss',
    collection: 'articles',
    type: '日常記事',
    host: 'sizu.me',
    pathPrefix: '/chihiroxx/posts/',
  },
  hatena: {
    label: 'はてなブログ',
    feed: 'https://toyo.hatenablog.jp/rss',
    collection: 'articles',
    type: 'テック記事',
    host: 'toyo.hatenablog.jp',
    pathPrefix: '/entry/',
  },
  speakerdeck: {
    label: 'Speaker Deck',
    feed: 'https://speakerdeck.com/chiroruxx.rss',
    collection: 'talks',
    type: '登壇資料',
    host: 'speakerdeck.com',
    pathPrefix: '/chiroruxx/',
  },
} as const;

export type Source = keyof typeof services;
export type Service = (typeof services)[Source];

export const limits = { articles: 20, talks: 10 };

export type Collection = keyof typeof limits;
export type ContentData = z.infer<typeof contentRecordSchema>;
export type FeedItem = { date: Date; title: string; url: URL };
// File paths are absolute, resolved when collections are read.
export type StoredEntry = { file: string; id: string; data: ContentData };
export type LinkStatus = 'public' | 'deleted' | 'unverified';
type IndexedEntry = {
  entry: StoredEntry;
  url: URL | undefined;
  source: Source | undefined;
};
export type CollectionIndex = {
  collection: Collection;
  entries: IndexedEntry[];
  byUrl: Map<string, IndexedEntry>;
};
export type LinkCheck = { source: Source; url: URL };

export function buildCollectionIndex(
  collection: Collection,
  entries: StoredEntry[],
): CollectionIndex {
  const byUrl = new Map<string, IndexedEntry>();
  const seenUrls = new Map<string, string>();
  const indexedEntries = entries.map((entry) => {
    const value = entry.data.url;
    const url = value ? new URL(value) : undefined;
    if (url) {
      url.hash = '';
      const previous = seenUrls.get(url.href);
      if (previous) {
        throw new Error(
          `${collection} URL is duplicated in ${previous} and ${entry.id}: ${url}`,
        );
      }
      seenUrls.set(url.href, entry.id);
    }
    const source = url ? findSource(url, collection) : undefined;
    const indexed = { entry, url, source };
    if (url && source) byUrl.set(url.href, indexed);
    return indexed;
  });

  return {
    collection,
    entries: indexedEntries,
    byUrl,
  };
}

export function findSource(
  url: URL,
  collection: Service['collection'],
): Source | undefined {
  for (const source of Object.keys(services) as Source[]) {
    const service = services[source];
    if (
      service.collection === collection &&
      service.host === url.hostname &&
      url.pathname.startsWith(service.pathPrefix)
    )
      return source;
  }
  return undefined;
}

export function validateContentUrl(url: URL, service: Service): void {
  const source = findSource(url, service.collection);
  const configured = source ? services[source] : undefined;
  if (
    url.protocol !== 'https:' ||
    (url.port !== '' && url.port !== '443') ||
    url.username ||
    url.password ||
    !configured ||
    configured.host !== service.host ||
    configured.pathPrefix !== service.pathPrefix
  ) {
    throw new Error(`Unexpected ${service.label} content URL: ${url.href}`);
  }
}

export function getService(source: Source): Service {
  if (!isSource(source)) throw new Error(`Unknown service: ${source}`);
  return services[source];
}

export function isSource(value: string | undefined): value is Source {
  return value !== undefined && Object.hasOwn(services, value);
}

export const defaultContentDirectory = path.resolve('src/content');

export type CommonContentOptions = {
  dryRun?: boolean;
  contentDirectory?: string;
};

export type ContentResult = {
  unverified: LinkCheck[];
  unchecked: LinkCheck[];
};
