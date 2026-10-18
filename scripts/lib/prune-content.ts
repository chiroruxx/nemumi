import path from 'node:path';
import {
  buildCollectionIndex,
  type Collection,
  type CollectionIndex,
  type CommonContentOptions,
  defaultContentDirectory,
  limits,
} from './external-content.ts';
import {
  type ContentFileRemoval,
  readCollection,
  removeFiles,
  validateFileRemovals,
} from './external-content-files.ts';

type PruneOptions = Omit<
  CommonContentOptions,
  | 'linkVerifier'
  | 'executionBudgetMs'
  | 'linkCheckBatchIntervalMs'
  | 'now'
  | 'sleep'
>;

function rankedKeepSet(index: CollectionIndex): Set<string> {
  const candidates = new Map<string, { date: Date }>();
  for (const indexed of index.entries) {
    candidates.set(indexed.url ?? indexed.entry.file, {
      date: indexed.entry.data.date,
    });
  }

  return new Set(
    [...candidates.entries()]
      .sort(
        ([keyA, a], [keyB, b]) =>
          b.date.getTime() - a.date.getTime() || keyA.localeCompare(keyB),
      )
      .slice(0, limits[index.collection])
      .map(([key]) => key),
  );
}

export function createPruneRemovals(
  index: CollectionIndex,
): ContentFileRemoval[] {
  const keep = rankedKeepSet(index);
  const removals: ContentFileRemoval[] = [];

  for (const indexed of index.entries) {
    if (!keep.has(indexed.url ?? indexed.entry.file)) {
      removals.push({ target: path.resolve(indexed.entry.file) });
    }
  }

  removals.sort((a, b) => a.target.localeCompare(b.target));
  return removals;
}

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
