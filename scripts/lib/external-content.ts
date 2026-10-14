import path from 'node:path';
import Parser from 'rss-parser';
import YAML from 'yaml';
import {
  applyFileChanges,
  type ContentFileOperation,
  readCollection,
  validateFileTargets,
} from './external-content-files.ts';
import {
  buildCollectionIndex,
  type Collection,
  createPrunePlan,
  createSyncPlan,
  type FeedItem,
  type LinkCheck,
  type LinkStatus,
  limits,
  type PruneRemoval,
  type Service,
  type Source,
  type SyncChange,
  services,
  validateContentUrl,
} from './external-content-planning.ts';

export { assertRepositoryFile } from './external-content-files.ts';
export type {
  Collection,
  ContentData,
  FeedItem,
  LinkStatus,
  PruneRemoval,
  Service,
  Source,
  StoredEntry,
  SyncChange,
} from './external-content-planning.ts';
export {
  canonicalUrl,
  isSource,
  limits,
  services,
  validateContentUrl,
} from './external-content-planning.ts';

const defaultContentDirectory = path.resolve('src/content');
const parser = new Parser({ timeout: 30_000, maxRedirects: 0 });

type FeedLoader = (service: Service) => Promise<FeedItem[]>;
type LinkVerifier = (url: string, service: Service) => Promise<LinkStatus>;
type CommonContentOptions = {
  dryRun?: boolean;
  contentDirectory?: string;
  linkVerifier?: LinkVerifier;
};
export type SyncOptions = CommonContentOptions & { feedLoader?: FeedLoader };
export type PruneOptions = CommonContentOptions & {
  linkCheckIntervalMs?: number;
};
export type SyncResult = {
  source: Source;
  collection: Collection;
  feedCount: number;
  changes: SyncChange[];
};
export type PruneResult = { removals: PruneRemoval[] };

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
      url: validateContentUrl(item.link, service),
    };
  });
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
      url = new URL(validateContentUrl(target, service));
    } catch {
      return 'review';
    }
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
  entries: LinkCheck[],
  linkVerifier: LinkVerifier,
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

function syncOperations(changes: SyncChange[]): ContentFileOperation[] {
  return changes.map((change) => ({
    kind: change.action === 'add' ? 'create' : 'replace',
    target: change.file,
    content: YAML.stringify(
      {
        date: change.date,
        types: change.types,
        title: change.title,
        url: change.url,
      },
      { defaultStringType: 'QUOTE_DOUBLE' },
    ),
  }));
}

export async function syncService(
  source: Source,
  {
    dryRun = false,
    contentDirectory = defaultContentDirectory,
    feedLoader = fetchFeed,
    linkVerifier = verifyLink,
  }: SyncOptions = {},
): Promise<SyncResult> {
  const service = services[source];
  if (!service) throw new Error(`Unknown service: ${source}`);

  const collection = service.collection;
  const existing = await readCollection(collection, contentDirectory);
  const index = buildCollectionIndex(collection, existing);
  // Sync each source independently. Saved entries from other sources still
  // reserve their current slots until the later prune run ranks the collection.
  const currentFeed = await feedLoader(service);
  const planInput = {
    source,
    index,
    feed: currentFeed,
    contentDirectory,
  };
  const preliminaryPlan = createSyncPlan(planInput);
  await validateFileTargets(
    syncOperations(preliminaryPlan.changes),
    contentDirectory,
  );

  const linkStatuses = new Map<string, LinkStatus>();
  for (const check of preliminaryPlan.linkChecks) {
    linkStatuses.set(
      check.url,
      await linkVerifier(check.url, services[check.source]),
    );
  }
  const plan = createSyncPlan({ ...planInput, linkStatuses });
  const operations = syncOperations(plan.changes);
  await validateFileTargets(operations, contentDirectory);
  if (!dryRun) await applyFileChanges(operations, contentDirectory);
  return {
    source,
    collection,
    feedCount: currentFeed.length,
    changes: plan.changes,
  };
}

function pruneOperations(removals: PruneRemoval[]): ContentFileOperation[] {
  return removals.map(({ file }) => ({ kind: 'delete', target: file }));
}

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
  linkVerifier = verifyLink,
  linkCheckIntervalMs = 1000,
}: PruneOptions = {}): Promise<PruneResult> {
  const indexes = new Map<
    Collection,
    ReturnType<typeof buildCollectionIndex>
  >();
  const initialPlans = new Map<
    Collection,
    ReturnType<typeof createPrunePlan>
  >();
  for (const collection of Object.keys(limits) as Collection[]) {
    const entries = await readCollection(collection, contentDirectory);
    const index = buildCollectionIndex(collection, entries);
    indexes.set(collection, index);
    initialPlans.set(collection, createPrunePlan(index));
  }

  const initialRemovals = [...initialPlans.values()].flatMap(
    ({ removals }) => removals,
  );
  await validateFileTargets(pruneOperations(initialRemovals), contentDirectory);
  const linkChecks = [...initialPlans.values()]
    .flatMap(({ linkChecks: checks }) => checks)
    .sort(
      (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
    );
  const linkStatuses = await verifyLinks(
    linkChecks,
    linkVerifier,
    linkCheckIntervalMs,
  );
  for (const check of linkChecks) {
    const status = linkStatuses.get(check.url);
    if (status === 'defer' || status === 'review') {
      const entry = [...indexes.values()]
        .flatMap(({ entries }) => entries)
        .find(({ url }) => url === check.url)?.entry;
      if (entry)
        console.warn(`Link check ${status}; keeping ${entry.id}: ${check.url}`);
    }
  }

  const removals = [...indexes.values()].flatMap(
    (index) => createPrunePlan(index, linkStatuses).removals,
  );
  const operations = pruneOperations(removals);
  await validateFileTargets(operations, contentDirectory);
  if (!dryRun) await applyFileChanges(operations, contentDirectory);
  return { removals };
}
