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
    const result: SyncResult = {
      deferred,
      review,
      unchecked: checked.unchecked,
    };
    if (deferred.length || review.length) {
      throw Object.assign(
        new Error(
          `Could not verify new items: ${[...deferred, ...review]
            .map(({ url }) => url)
            .join(', ')}`,
        ),
        { report: result },
      );
    }
    if (checked.unchecked.length) return result;
    const changes = preliminaryPlan.changes.filter(
      ({ action, url }) =>
        action === 'update' || checked.statuses.get(url) === 'public',
    );
    const operations = syncOperations(changes);
    await validateFileTargets(operations, contentDirectory);
    if (!dryRun) await applyFileChanges(operations, contentDirectory);
    return result;
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
    const collectionPlans: {
      index: ReturnType<typeof buildCollectionIndex>;
      plan: ReturnType<typeof createPrunePlan>;
    }[] = [];
    for (const collection of Object.keys(limits) as Collection[]) {
      const entries = await readCollection(collection, contentDirectory);
      const index = buildCollectionIndex(collection, entries);
      collectionPlans.push({ index, plan: createPrunePlan(index) });
    }

    const initialRemovals = collectionPlans.flatMap(
      ({ plan }) => plan.removals,
    );
    await validateFileTargets(
      pruneOperations(initialRemovals),
      contentDirectory,
    );
    const linkChecks = collectionPlans
      .flatMap(({ plan }) => plan.linkChecks)
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
    const removals = collectionPlans
      .flatMap(({ index, plan }) => [
        ...plan.removals,
        ...plan.linkChecks.flatMap(({ url }) => {
          if (checked.statuses.get(url) !== 'deleted') return [];
          const entry = index.byUrl.get(url)?.entry;
          if (!entry) throw new Error(`Missing planned prune entry: ${url}`);
          return [
            {
              reason: 'link' as const,
              file: entry.file,
              date: entry.data.date,
              title: entry.data.title,
              url,
            },
          ];
        }),
      ])
      .sort((a, b) => a.file.localeCompare(b.file));
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
