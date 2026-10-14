import path from 'node:path';
import YAML from 'yaml';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  applyFileChanges,
  type ContentFileOperation,
  readCollection,
  validateFileTargets,
} from './external-content-files.ts';
import {
  createExecutionContext,
  type ExecutionContext,
  fetchFeed,
  type HttpRuntime,
  type LinkVerifier,
  runLinkChecks,
  verifyLink,
} from './external-content-http.ts';
import {
  buildCollectionIndex,
  type Collection,
  canonicalUrl,
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
} from './external-content-planning.ts';

const defaultContentDirectory = path.resolve('src/content');

export { fetchFeed, verifyLink } from './external-content-http.ts';

type FeedLoader = (
  service: Service,
  context: ExecutionContext,
) => Promise<FeedItem[]>;
type CommonContentOptions = {
  dryRun?: boolean;
  contentDirectory?: string;
  linkVerifier?: LinkVerifier;
  executionBudgetMs?: number;
  executionContext?: ExecutionContext;
  linkCheckBatchIntervalMs?: number;
  now?: () => number;
  sleep?: HttpRuntime['sleep'];
};
export type SyncOptions = CommonContentOptions & { feedLoader?: FeedLoader };
export type PruneOptions = CommonContentOptions;
/** A feed item withheld from sync; PruneResult.skipped is reserved for manual entries. */
export type LinkDisposition = LinkCheck & {
  status: LinkStatus | 'unchecked';
  reason: 'deleted' | 'execution-deadline' | 'verification-failed';
};
export type KeptContent = {
  file: string;
  date: string;
  title: string;
  url: string;
  reason: 'public' | 'defer' | 'review' | 'unchecked';
};
export type SkippedContent = {
  file: string;
  date: string;
  title: string;
  url?: string;
  reason: 'manual';
};
export type SyncResult = {
  source: Source;
  collection: Collection;
  feedCount: number;
  changes: SyncChange[];
  kept: number;
  skipped: LinkDisposition[];
  deferred: LinkCheck[];
  review: LinkCheck[];
  unchecked: LinkCheck[];
  remainingByCollection: Partial<Record<Collection, number>>;
};
export type PruneResult = {
  removals: PruneRemoval[];
  kept: KeptContent[];
  skipped: SkippedContent[];
  deferred: LinkCheck[];
  review: LinkCheck[];
  unchecked: LinkCheck[];
  remainingByCollection: Record<Collection, number>;
};

function syncOperations(changes: SyncChange[]): ContentFileOperation[] {
  return changes.map((change) => ({
    kind: change.action === 'add' ? 'create' : 'replace',
    target: change.file,
    content: YAML.stringify(
      {
        date: formatDateInSiteTimeZone(change.date),
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
    feedLoader,
    linkVerifier,
    executionBudgetMs,
    executionContext,
    linkCheckBatchIntervalMs = 1000,
    now = Date.now,
    sleep,
  }: SyncOptions = {},
): Promise<SyncResult> {
  const service = services[source];
  if (!service) throw new Error(`Unknown service: ${source}`);

  const context =
    executionContext ??
    createExecutionContext({
      ...(executionBudgetMs === undefined
        ? {}
        : { budgetMs: executionBudgetMs }),
      now,
    });
  try {
    const collection = service.collection;
    const existing = await readCollection(collection, contentDirectory);
    const index = buildCollectionIndex(collection, existing);
    // Sync each source independently. Saved entries from other sources still
    // reserve their current slots until the later prune run ranks the collection.
    const loadFeed =
      feedLoader ??
      ((configured, execution) =>
        fetchFeed(configured, { context: execution }));
    const currentFeed = await loadFeed(service, context);
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

    const checked = await runLinkChecks(
      preliminaryPlan.linkChecks,
      linkVerifier ??
        ((url, configured, execution) =>
          verifyLink(url, configured, { context: execution })),
      {
        services,
        context,
        batchIntervalMs: linkCheckBatchIntervalMs,
        ...(sleep ? { sleep } : {}),
      },
    );
    const deferred = preliminaryPlan.linkChecks.filter(
      ({ url }) => checked.statuses.get(url) === 'defer',
    );
    const review = preliminaryPlan.linkChecks.filter(
      ({ url }) => checked.statuses.get(url) === 'review',
    );
    const skipped: LinkDisposition[] = preliminaryPlan.linkChecks.flatMap(
      (entry) =>
        checked.statuses.get(entry.url) === 'deleted'
          ? [
              {
                ...entry,
                status: 'deleted' as const,
                reason: 'deleted' as const,
              },
            ]
          : [],
    );
    if (deferred.length || review.length) {
      const report: SyncResult = {
        source,
        collection,
        feedCount: currentFeed.length,
        changes: [],
        kept: index.entries.length,
        skipped: [
          ...skipped,
          ...[...deferred, ...review].map((entry) => ({
            ...entry,
            status: (checked.statuses.get(entry.url) ?? 'unchecked') as
              | LinkStatus
              | 'unchecked',
            reason: 'verification-failed' as const,
          })),
        ],
        deferred,
        review,
        unchecked: checked.unchecked,
        remainingByCollection: { [collection]: index.entries.length },
      };
      throw Object.assign(
        new Error(
          `Could not verify new items: ${[...deferred, ...review]
            .map(({ url }) => url)
            .join(', ')}`,
        ),
        { report },
      );
    }
    if (checked.unchecked.length) {
      return {
        source,
        collection,
        feedCount: currentFeed.length,
        changes: [],
        kept: index.entries.length,
        skipped: [
          ...skipped,
          ...checked.unchecked.map((entry) => ({
            ...entry,
            status: 'unchecked' as const,
            reason: 'execution-deadline' as const,
          })),
        ],
        deferred,
        review,
        unchecked: checked.unchecked,
        remainingByCollection: { [collection]: index.entries.length },
      };
    }
    const uncheckedUrls = new Set(checked.unchecked.map(({ url }) => url));
    const safeFeed = currentFeed.filter(
      (item) => !uncheckedUrls.has(canonicalUrl(item.url)),
    );
    const plan = createSyncPlan({
      ...planInput,
      feed: safeFeed,
      linkStatuses: checked.statuses,
    });
    const operations = syncOperations(plan.changes);
    await validateFileTargets(operations, contentDirectory);
    if (!dryRun) await applyFileChanges(operations, contentDirectory);
    const additions = plan.changes.filter(
      ({ action }) => action === 'add',
    ).length;
    return {
      source,
      collection,
      feedCount: currentFeed.length,
      changes: plan.changes,
      kept: index.entries.length + additions,
      skipped,
      deferred,
      review,
      unchecked: checked.unchecked,
      remainingByCollection: {
        [collection]: index.entries.length + additions,
      },
    };
  } finally {
    if (!executionContext) context.dispose();
  }
}

function pruneOperations(removals: PruneRemoval[]): ContentFileOperation[] {
  return removals.map(({ file }) => ({ kind: 'delete', target: file }));
}

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
  linkVerifier,
  executionBudgetMs,
  executionContext,
  linkCheckBatchIntervalMs = 1000,
  now = Date.now,
  sleep,
}: PruneOptions = {}): Promise<PruneResult> {
  const context =
    executionContext ??
    createExecutionContext({
      ...(executionBudgetMs === undefined
        ? {}
        : { budgetMs: executionBudgetMs }),
      now,
    });
  try {
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
    await validateFileTargets(
      pruneOperations(initialRemovals),
      contentDirectory,
    );
    const linkChecks = [...initialPlans.values()]
      .flatMap(({ linkChecks: checks }) => checks)
      .sort(
        (a, b) =>
          a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
      );
    const checked = await runLinkChecks(
      linkChecks,
      linkVerifier ??
        ((url, configured, execution) =>
          verifyLink(url, configured, { context: execution })),
      {
        services,
        context,
        batchIntervalMs: linkCheckBatchIntervalMs,
        ...(sleep ? { sleep } : {}),
      },
    );
    const removals = [...indexes.values()].flatMap(
      (index) => createPrunePlan(index, checked.statuses).removals,
    );
    const operations = pruneOperations(removals);
    await validateFileTargets(operations, contentDirectory);
    if (!dryRun) await applyFileChanges(operations, contentDirectory);

    const removalFiles = new Set(removals.map(({ file }) => file));
    const uncheckedUrls = new Set(checked.unchecked.map(({ url }) => url));
    const checkedUrls = new Set(linkChecks.map(({ url }) => url));
    const kept: KeptContent[] = [];
    const skipped: SkippedContent[] = [];
    for (const index of indexes.values()) {
      for (const { entry, source, url } of index.entries) {
        if (removalFiles.has(entry.file)) continue;
        if (!source || !url) {
          skipped.push({
            file: entry.file,
            date: formatDateInSiteTimeZone(entry.data.date),
            title: entry.data.title,
            ...(entry.data.url ? { url: entry.data.url } : {}),
            reason: 'manual',
          });
          continue;
        }
        const reason = uncheckedUrls.has(url)
          ? 'unchecked'
          : (checked.statuses.get(url) ??
            (checkedUrls.has(url) ? 'defer' : 'public'));
        kept.push({
          file: entry.file,
          date: formatDateInSiteTimeZone(entry.data.date),
          title: entry.data.title,
          url,
          reason: reason as KeptContent['reason'],
        });
      }
    }
    const deferred = linkChecks.filter(
      ({ url }) => checked.statuses.get(url) === 'defer',
    );
    const review = linkChecks.filter(
      ({ url }) => checked.statuses.get(url) === 'review',
    );
    const remainingByCollection = {
      articles: (indexes.get('articles')?.entries ?? []).filter(
        ({ entry }) => !removalFiles.has(entry.file),
      ).length,
      talks: (indexes.get('talks')?.entries ?? []).filter(
        ({ entry }) => !removalFiles.has(entry.file),
      ).length,
    };
    return {
      removals,
      kept,
      skipped,
      deferred,
      review,
      unchecked: checked.unchecked,
      remainingByCollection,
    };
  } finally {
    if (!executionContext) context.dispose();
  }
}
