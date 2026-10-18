import type { z } from 'zod';
import type { contentRecordSchema } from '../../src/config/content-schema.ts';
import { findSource, type Source } from './external-content.ts';

export const limits = { articles: 20, talks: 10 };

export type Collection = keyof typeof limits;
export type ContentData = z.infer<typeof contentRecordSchema>;
export type FeedItem = { date: Date; title: string; url: string };
export type StoredEntry = { file: string; id: string; data: ContentData };
export type LinkStatus = 'public' | 'deleted' | 'defer' | 'review';
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
