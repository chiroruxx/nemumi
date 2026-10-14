import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import YAML from 'yaml';

export const services = {
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

type Source = keyof typeof services;
type Collection = keyof typeof limits;
type Service = (typeof services)[Source];
type ContentData = {
  date: string;
  types?: string[];
  title: string;
  url?: string;
};
type FeedItem = { date: string; title: string; url: string };
type StoredEntry = { file: string; id: string; data: ContentData };
type KeepEntry = ContentData & { file?: string; source?: Source };
type LinkStatus = 'public' | 'deleted' | 'defer' | 'review';

export const limits = { articles: 20, talks: 10 };
const defaultContentDirectory = path.resolve('src/content');
const parser = new Parser({ timeout: 30_000, maxRedirects: 0 });

export function isSource(value: string | undefined): value is Source {
  return value !== undefined && Object.hasOwn(services, value);
}

function sourceForUrl(
  value: string | undefined,
  collection: Collection,
): Source | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  return (Object.entries(services) as [Source, Service][]).find(
    ([, service]) =>
      service.collection === collection &&
      service.host === url.hostname &&
      url.pathname.startsWith(service.pathPrefix),
  )?.[0];
}

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

function tokyoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid RSS publication date: ${value}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = Object.fromEntries(
    parts.map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${part.year}-${part.month}-${part.day}`;
}

function validateUrl(value: string, service: Service): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== service.host ||
    !url.pathname.startsWith(service.pathPrefix) ||
    url.username ||
    url.password
  ) {
    throw new Error(`Unexpected ${service.label} content URL: ${value}`);
  }
  return canonicalUrl(url.href);
}

export async function fetchFeed(service: Service): Promise<FeedItem[]> {
  let response: Response | undefined;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      response = await fetch(service.feed, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'manual',
        headers: { 'user-agent': 'nemumi-sync-content/1.0' },
      });
    } catch (error) {
      if (attempt === 2) throw error;
      continue;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      const redirect = location && new URL(location, service.feed);
      if (
        !redirect ||
        redirect.hostname !== service.host ||
        redirect.protocol !== 'https:'
      ) {
        throw new Error(
          `${service.label} RSS redirected outside its HTTPS host`,
        );
      }
      throw new Error(
        `${service.label} RSS redirect requires updating its configured URL`,
      );
    }
    if (response.status !== 429 && response.status < 500) break;
    if (attempt === 2)
      throw new Error(`${service.label} RSS returned HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : (attempt + 1) * 1000;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(waitMs, 10_000)),
    );
  }
  if (!response)
    throw new Error(`${service.label} RSS request returned no response`);
  if (!response.ok)
    throw new Error(`${service.label} RSS returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 5 * 1024 * 1024) {
    throw new Error(`${service.label} RSS exceeds the 5 MiB response limit`);
  }
  const chunks = [];
  if (!response.body) throw new Error(`${service.label} RSS response is empty`);
  const reader = response.body.getReader();
  let byteCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > 5 * 1024 * 1024) {
      await reader.cancel();
      throw new Error(`${service.label} RSS exceeds the 5 MiB response limit`);
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  const parsed = await parser.parseString(body);
  if (!parsed.items.length)
    throw new Error(`${service.label} RSS feed is empty`);

  return parsed.items.map((item) => {
    const title = item.title?.trim();
    if (!title || !item.pubDate || !item.link) {
      throw new Error(
        `${service.label} RSS item is missing title, pubDate, or link`,
      );
    }
    return {
      date: tokyoDate(item.pubDate),
      title,
      url: validateUrl(item.link, service),
    };
  });
}

async function readCollection(
  collection: Collection,
  contentDirectory: string,
): Promise<StoredEntry[]> {
  const directory = path.join(contentDirectory, collection);
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith('.yaml'),
  );
  return Promise.all(
    files.map(async (name) => ({
      file: path.join(directory, name),
      id: name,
      data: YAML.parse(
        await readFile(path.join(directory, name), 'utf8'),
      ) as ContentData,
    })),
  );
}

function ensureUniqueUrls(
  entries: StoredEntry[],
  collection: Collection,
): void {
  const seen = new Map();
  for (const entry of entries) {
    const entryUrl = entry.data.url;
    if (!entryUrl) continue;
    const url = canonicalUrl(entryUrl);
    if (seen.has(url)) {
      throw new Error(
        `${collection} URL is duplicated in ${seen.get(url)} and ${entry.id}: ${url}`,
      );
    }
    seen.set(url, entry.id);
  }
}

function selectKeepSet(
  collection: Collection,
  existing: StoredEntry[],
  feeds: Map<Source, FeedItem[]>,
): Map<string, KeepEntry> {
  const byUrl = new Map<string, KeepEntry>();
  for (const entry of existing) {
    const entryUrl = entry.data.url;
    if (entryUrl && sourceForUrl(entryUrl, collection))
      byUrl.set(canonicalUrl(entryUrl), {
        ...entry.data,
        file: entry.file,
      });
  }
  for (const [source, items] of feeds) {
    const service = services[source];
    if (service.collection !== collection) continue;
    for (const item of items) {
      const previous = byUrl.get(item.url);
      byUrl.set(item.url, {
        ...(previous ?? {}),
        ...item,
        types: previous?.types ?? [service.type],
        source,
      });
    }
  }

  const manualCount = existing.filter(
    (entry) => !sourceForUrl(entry.data.url, collection),
  ).length;
  const available = limits[collection] - manualCount;
  if (available < 0)
    throw new Error(
      `${collection} manual entries exceed its ${limits[collection]} item limit`,
    );
  const ranked = [...byUrl.entries()].sort(
    ([urlA, a], [urlB, b]) =>
      b.date.localeCompare(a.date) || urlA.localeCompare(urlB),
  );
  return new Map(ranked.slice(0, available));
}

function filenameFor(source: Source, url: string): string {
  return `${source}-${createHash('sha256').update(url).digest('hex')}.yaml`;
}

function serialize(data: ContentData): string {
  return YAML.stringify(data, { defaultStringType: 'QUOTE_DOUBLE' });
}

export async function syncService(
  source: Source,
  {
    dryRun = false,
    contentDirectory = defaultContentDirectory,
    feedLoader = fetchFeed,
    linkVerifier = verifyLink,
  }: {
    dryRun?: boolean;
    contentDirectory?: string;
    feedLoader?: typeof fetchFeed;
    linkVerifier?: typeof verifyLink;
  } = {},
) {
  const service = services[source];
  if (!service) throw new Error(`Unknown service: ${source}`);

  const collection = service.collection;
  const existing = await readCollection(collection, contentDirectory);
  ensureUniqueUrls(existing, collection);
  // Service syncs remain independent. Other services' current content reserves
  // its place; the later prune run applies the complete cross-service ranking.
  const currentFeed = await feedLoader(service);
  const uniqueFeed = new Map<string, FeedItem>();
  for (const item of currentFeed) {
    const url = canonicalUrl(item.url);
    const normalized = { ...item, url };
    const previous = uniqueFeed.get(url);
    if (
      previous &&
      (previous.date !== normalized.date || previous.title !== normalized.title)
    ) {
      throw new Error(`Conflicting RSS items for URL: ${url}`);
    }
    uniqueFeed.set(url, normalized);
  }
  const feeds = new Map<Source, FeedItem[]>([
    [source, [...uniqueFeed.values()]],
  ]);
  const keep = selectKeepSet(collection, existing, feeds);
  const byUrl = new Map<string, StoredEntry>();
  for (const entry of existing) {
    const entryUrl = entry.data.url;
    if (entryUrl && sourceForUrl(entryUrl, collection) === source)
      byUrl.set(canonicalUrl(entryUrl), entry);
  }
  const changes: {
    action: 'add' | 'update';
    data: ContentData;
    target: string;
  }[] = [];

  for (const item of uniqueFeed.values()) {
    if (!keep.has(item.url)) continue;
    const previous = byUrl.get(item.url);
    if (!previous) {
      const status = await linkVerifier(item.url, service);
      if (status === 'deleted') {
        console.warn(`Skipping unavailable new item: ${item.url}`);
        continue;
      }
      if (status !== 'public') {
        throw new Error(`Could not verify new item (${status}): ${item.url}`);
      }
    }
    const data = {
      date: item.date,
      types: previous?.data.types ?? [service.type],
      title: item.title,
      url: item.url,
    };
    const target =
      previous?.file ??
      path.join(contentDirectory, collection, filenameFor(source, item.url));
    assertRepositoryFile(target, contentDirectory);
    if (previous && serialize(previous.data) === serialize(data)) continue;
    if (!previous && existing.some(({ id }) => id === path.basename(target))) {
      throw new Error(`Filename collision while adding ${item.url}`);
    }
    changes.push({ action: previous ? 'update' : 'add', data, target });
  }

  if (!dryRun) {
    for (const change of changes)
      await writeFile(change.target, serialize(change.data));
  }
  return { source, collection, feedCount: currentFeed.length, changes };
}

export async function verifyLink(
  value: string,
  service: Service,
): Promise<LinkStatus> {
  let target = value;
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return 'review';
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== service.host ||
      !url.pathname.startsWith(service.pathPrefix) ||
      url.username ||
      url.password
    ) {
      return 'review';
    }
    url.hash = '';
    if (visited.has(url.href)) return 'review';
    visited.add(url.href);
    let response: Response;
    try {
      response = await fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
        headers: { 'user-agent': 'nemumi-link-check/1.0' },
      });
    } catch {
      return 'defer';
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return 'review';
      try {
        target = new URL(location, url).href;
      } catch {
        return 'review';
      }
      continue;
    }
    if (response.status === 404 || response.status === 410) return 'deleted';
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return 'defer';
    }
    return response.ok ? 'public' : 'review';
  }
  return 'review';
}

async function verifyLinks(
  entries: { url: string; source: Source }[],
  linkVerifier: typeof verifyLink,
  intervalMs: number,
): Promise<Map<string, LinkStatus>> {
  const results = new Map<string, LinkStatus>();
  const inFlight = new Set<Promise<void>>();
  let previousService: Source | undefined;

  for (const entry of entries) {
    if (previousService === entry.source) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    previousService = entry.source;
    const task = linkVerifier(entry.url, services[entry.source]).then(
      (status) => {
        results.set(entry.url, status);
      },
    );
    inFlight.add(task);
    task.then(
      () => inFlight.delete(task),
      () => inFlight.delete(task),
    );
    if (inFlight.size >= 2) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  return results;
}

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
  feedLoader = fetchFeed,
  linkVerifier = verifyLink,
  linkCheckIntervalMs = 1000,
}: {
  dryRun?: boolean;
  contentDirectory?: string;
  feedLoader?: typeof fetchFeed;
  linkVerifier?: typeof verifyLink;
  linkCheckIntervalMs?: number;
} = {}) {
  const sources = Object.keys(services) as Source[];
  const feedEntries = await Promise.all(
    sources.map(
      async (source) => [source, await feedLoader(services[source])] as const,
    ),
  );
  const feeds = new Map<Source, FeedItem[]>(feedEntries);
  const removals: { reason: 'limit' | 'link'; entry: StoredEntry }[] = [];
  const held: { url: string; source: Source; entry: StoredEntry }[] = [];

  for (const collection of Object.keys(limits) as Collection[]) {
    const existing = await readCollection(collection, contentDirectory);
    ensureUniqueUrls(existing, collection);
    const keep = selectKeepSet(collection, existing, feeds);
    for (const entry of existing) {
      const entryUrl = entry.data.url;
      const source = sourceForUrl(entryUrl, collection);
      if (!source || !entryUrl) continue;
      const url = canonicalUrl(entryUrl);
      if (!keep.has(url)) {
        removals.push({ reason: 'limit', entry });
        continue;
      }
      held.push({ url, source, entry });
    }
  }

  held.sort(
    (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
  );
  const linkResults = await verifyLinks(
    held,
    linkVerifier,
    linkCheckIntervalMs,
  );
  for (const { url, entry } of held) {
    const status = linkResults.get(url);
    if (status === 'deleted') removals.push({ reason: 'link', entry });
    else if (status === 'defer' || status === 'review') {
      console.warn(`Link check ${status}; keeping ${entry.id}: ${url}`);
    }
  }

  if (!dryRun) {
    for (const { entry } of removals) {
      assertRepositoryFile(entry.file, contentDirectory);
      await rm(entry.file);
    }
  }
  return { removals };
}

export function assertRepositoryFile(
  file: string,
  contentDirectory = defaultContentDirectory,
): void {
  const relative = path.relative(contentDirectory, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside src/content: ${file}`);
  }
}
