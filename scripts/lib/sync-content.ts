import YAML from 'yaml';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  type CommonContentOptions,
  type ContentResult,
  defaultContentDirectory,
} from './external-content.ts';
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
  runLinkChecks,
  verifyLink,
} from './external-content-http.ts';
import {
  buildCollectionIndex,
  createSyncPlan,
  type FeedItem,
  type Service,
  type Source,
  type SyncChange,
  services,
} from './external-content-planning.ts';

type FeedLoader = (
  service: Service,
  context: ExecutionContext,
) => Promise<FeedItem[]>;
type SyncOptions = CommonContentOptions & { feedLoader?: FeedLoader };
export type SyncResult = ContentResult;

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
