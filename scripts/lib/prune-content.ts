import {
  type CommonContentOptions,
  defaultContentDirectory,
} from './external-content.ts';
import {
  type ContentFileRemoval,
  readCollection,
  removeFiles,
  validateFileRemovals,
} from './external-content-files.ts';
import {
  buildCollectionIndex,
  type Collection,
  createPruneRemovals,
  limits,
} from './external-content-planning.ts';

type PruneOptions = Omit<
  CommonContentOptions,
  | 'linkVerifier'
  | 'executionBudgetMs'
  | 'linkCheckBatchIntervalMs'
  | 'now'
  | 'sleep'
>;

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
}: PruneOptions = {}): Promise<void> {
  const removals: ContentFileRemoval[] = [];
  for (const collection of Object.keys(limits) as Collection[]) {
    const entries = await readCollection(collection, contentDirectory);
    const index = buildCollectionIndex(collection, entries);
    removals.push(...createPruneRemovals(index));
  }

  await validateFileRemovals(removals, contentDirectory);
  if (!dryRun) await removeFiles(removals);
}
