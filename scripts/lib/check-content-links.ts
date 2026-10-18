import path from 'node:path';
import {
  type CommonContentOptions,
  type ContentResult,
  defaultContentDirectory,
  getService,
} from './external-content.ts';
import {
  type ContentFileRemoval,
  readCollection,
  removeFiles,
  validateFileRemovals,
} from './external-content-files.ts';
import {
  createExecutionContext,
  runLinkChecks,
  verifyLink,
} from './external-content-http.ts';
import {
  buildCollectionIndex,
  type Collection,
  type CollectionIndex,
  type LinkCheck,
  limits,
} from './external-content-planning.ts';

type CheckContentLinksOptions = CommonContentOptions;

export function createContentLinkChecks(index: CollectionIndex): LinkCheck[] {
  return index.entries
    .flatMap(({ source, url }) => (source && url ? [{ source, url }] : []))
    .sort(
      (a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url),
    );
}

export async function checkContentLinks({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
  linkVerifier,
  executionBudgetMs,
  linkCheckBatchIntervalMs = 1000,
  now = Date.now,
  sleep,
}: CheckContentLinksOptions = {}): Promise<ContentResult> {
  const context = createExecutionContext({
    ...(executionBudgetMs === undefined ? {} : { budgetMs: executionBudgetMs }),
    now,
  });
  try {
    const collections = await Promise.all(
      (Object.keys(limits) as Collection[]).map(async (collection) => {
        const entries = await readCollection(collection, contentDirectory);
        return buildCollectionIndex(collection, entries);
      }),
    );
    const indexes = new Map(
      collections.map((index) => [index.collection, index]),
    );
    const linkChecks = collections
      .flatMap(createContentLinkChecks)
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
        context,
        batchIntervalMs: linkCheckBatchIntervalMs,
        ...(sleep ? { sleep } : {}),
      },
    );
    const removals: ContentFileRemoval[] = [];
    for (const { source, url } of linkChecks) {
      if (checked.statuses.get(url) !== 'deleted') continue;
      const collection = getService(source).collection as Collection;
      const entry = indexes.get(collection)?.byUrl.get(url)?.entry;
      if (!entry) throw new Error(`Missing planned link entry: ${url}`);
      removals.push({ target: path.resolve(entry.file) });
    }
    removals.sort((a, b) => a.target.localeCompare(b.target));
    await validateFileRemovals(removals, contentDirectory);
    if (!dryRun) await removeFiles(removals);

    return {
      deferred: linkChecks.filter(
        ({ url }) => checked.statuses.get(url) === 'defer',
      ),
      review: linkChecks.filter(
        ({ url }) => checked.statuses.get(url) === 'review',
      ),
      unchecked: checked.unchecked,
    };
  } finally {
    context.dispose();
  }
}
