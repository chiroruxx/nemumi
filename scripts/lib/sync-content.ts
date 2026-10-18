import {
  type CommonContentOptions,
  defaultContentDirectory,
  getService,
  type Service,
  type Source,
} from './external-content.ts';
import {
  readCollection,
  validateFileWrites,
  writeFiles,
} from './external-content-files.ts';
import {
  createExecutionContext,
  type ExecutionContext,
  fetchFeed,
} from './external-content-http.ts';
import {
  buildCollectionIndex,
  createSyncWrites,
  type FeedItem,
} from './external-content-planning.ts';

type FeedLoader = (
  service: Service,
  context: ExecutionContext,
) => Promise<FeedItem[]>;
type SyncOptions = Omit<
  CommonContentOptions,
  'linkVerifier' | 'linkCheckBatchIntervalMs' | 'sleep'
> & { feedLoader?: FeedLoader };

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
    const writes = createSyncWrites({
      source,
      index,
      feed: currentFeed,
      contentDirectory,
    });
    await validateFileWrites(writes, contentDirectory);
    if (!dryRun) await writeFiles(writes);
  } finally {
    context.dispose();
  }
}
