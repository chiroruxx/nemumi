import path from 'node:path';
import type { z } from 'zod';
import type { contentRecordSchema } from '../../src/config/content-schema.ts';
import type { LinkVerifier, Sleep } from './external-content-http.ts';

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
export type FeedItem = { date: Date; title: string; url: string };
export type StoredEntry = { file: string; id: string; data: ContentData };
export type LinkStatus = 'public' | 'deleted' | 'unverified';
type IndexedEntry = {
  entry: StoredEntry;
  url: string | undefined;
  source: Source | undefined;
};
export type CollectionIndex = {
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
  const configuredSource = (Object.keys(services) as Source[]).find(
    (source) => {
      const configured = services[source];
      return (
        configured.host === service.host &&
        configured.pathPrefix === service.pathPrefix &&
        configured.collection === service.collection
      );
    },
  );
  if (
    url.protocol !== 'https:' ||
    (url.port !== '' && url.port !== '443') ||
    url.hostname !== service.host ||
    !url.pathname.startsWith(service.pathPrefix) ||
    url.username ||
    url.password ||
    !configuredSource ||
    source !== configuredSource
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
  linkVerifier?: LinkVerifier;
  executionBudgetMs?: number;
  linkCheckBatchIntervalMs?: number;
  now?: () => number;
  sleep?: Sleep;
};

export type ContentResult = {
  unverified: LinkCheck[];
  unchecked: LinkCheck[];
};
