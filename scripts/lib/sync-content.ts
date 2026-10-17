import YAML from 'yaml';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  type CommonContentOptions,
  defaultContentDirectory,
  getService,
  type Service,
  type Source,
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
} from './external-content-http.ts';
import {
  buildCollectionIndex,
  createSyncPlan,
  type FeedItem,
  type SyncChange,
} from './external-content-planning.ts';

type FeedLoader = (
  service: Service,
  context: ExecutionContext,
) => Promise<FeedItem[]>;
type SyncOptions = Omit<
  CommonContentOptions,
  'linkVerifier' | 'linkCheckBatchIntervalMs' | 'sleep'
> & { feedLoader?: FeedLoader };

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
    executionBudgetMs,
    now = Date.now,
  }: SyncOptions = {},
): Promise<void> {
  const service = getService(source);

  const context = createExecutionContext({
    ...(executionBudgetMs === undefined ? {} : { budgetMs: executionBudgetMs }),
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
    const plan = createSyncPlan(planInput);
    const operations = syncOperations(plan.changes);
    await validateFileTargets(operations, contentDirectory);
    if (!dryRun) await applyFileChanges(operations, contentDirectory);
  } finally {
    context.dispose();
  }
}
