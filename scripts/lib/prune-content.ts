import path from 'node:path';
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

function pruneFileRemovals(removals: PruneRemoval[]): ContentFileRemoval[] {
  return removals.map(({ file }) => ({
    target: path.resolve(file),
  }));
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

  const fileRemovals = pruneFileRemovals(removals);
  await validateFileRemovals(fileRemovals, contentDirectory);
  if (!dryRun) await removeFiles(fileRemovals);
}
