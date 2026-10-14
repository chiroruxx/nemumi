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
export type SyncResult = {
  deferred: LinkCheck[];
  review: LinkCheck[];
  unchecked: LinkCheck[];
};
export type PruneResult = {
  deferred: LinkCheck[];
  review: LinkCheck[];
  unchecked: LinkCheck[];
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
    if (deferred.length || review.length) {
      const report: SyncResult = {
        deferred,
        review,
        unchecked: checked.unchecked,
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
        deferred,
        review,
        unchecked: checked.unchecked,
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
    return {
      deferred,
      review,
      unchecked: checked.unchecked,
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

    const deferred = linkChecks.filter(
      ({ url }) => checked.statuses.get(url) === 'defer',
    );
    const review = linkChecks.filter(
      ({ url }) => checked.statuses.get(url) === 'review',
    );
    return {
      deferred,
      review,
      unchecked: checked.unchecked,
    };
  } finally {
    if (!executionContext) context.dispose();
  }
}
