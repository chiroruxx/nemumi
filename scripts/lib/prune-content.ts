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

function createPruneRemovals(index: CollectionIndex): ContentFileRemoval[] {
  return [...index.entries]
    .sort(
      (a, b) =>
        b.entry.data.date.getTime() - a.entry.data.date.getTime() ||
        (a.url?.href ?? a.entry.file).localeCompare(
          b.url?.href ?? b.entry.file,
        ),
    )
    .slice(limits[index.collection])
    .map(({ entry }) => ({ target: path.resolve(entry.file) }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
}: CommonContentOptions = {}): Promise<void> {
  const removals: ContentFileRemoval[] = [];
  for (const collection of Object.keys(limits) as Collection[]) {
    const entries = await readCollection(collection, contentDirectory);
    const index = buildCollectionIndex(collection, entries);
    removals.push(...createPruneRemovals(index));
  }

  await validateFileRemovals(removals, contentDirectory);
  if (!dryRun) await removeFiles(removals);
}
