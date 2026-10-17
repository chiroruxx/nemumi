import {
  type CommonContentOptions,
  defaultContentDirectory,
} from './external-content.ts';
import {
  applyFileChanges,
  type ContentFileOperation,
  readCollection,
  validateFileTargets,
} from './external-content-files.ts';
import {
  buildCollectionIndex,
  type Collection,
  createPruneRemovals,
  limits,
  type PruneRemoval,
} from './external-content-planning.ts';

type PruneOptions = Omit<
  CommonContentOptions,
  | 'linkVerifier'
  | 'executionBudgetMs'
  | 'linkCheckBatchIntervalMs'
  | 'now'
  | 'sleep'
>;

function pruneOperations(removals: PruneRemoval[]): ContentFileOperation[] {
  return removals.map(({ file }) => ({ kind: 'delete', target: file }));
}

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
}: PruneOptions = {}): Promise<void> {
  const removals: PruneRemoval[] = [];
  for (const collection of Object.keys(limits) as Collection[]) {
    const entries = await readCollection(collection, contentDirectory);
    const index = buildCollectionIndex(collection, entries);
    removals.push(...createPruneRemovals(index));
  }

  const operations = pruneOperations(removals);
  await validateFileTargets(operations, contentDirectory);
  if (!dryRun) await applyFileChanges(operations, contentDirectory);
}
