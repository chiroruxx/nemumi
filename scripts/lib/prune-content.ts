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
  runLinkChecks,
  verifyLink,
} from './external-content-http.ts';
import {
  buildCollectionIndex,
  type Collection,
  createPrunePlan,
  limits,
  type PruneRemoval,
} from './external-content-planning.ts';

type PruneOptions = CommonContentOptions;
export type PruneResult = ContentResult;

function pruneOperations(removals: PruneRemoval[]): ContentFileOperation[] {
  return removals.map(({ file }) => ({ kind: 'delete', target: file }));
}

export async function pruneContent({
  dryRun = false,
  contentDirectory = defaultContentDirectory,
  linkVerifier,
  executionBudgetMs,
  linkCheckBatchIntervalMs = 1000,
  now = Date.now,
  sleep,
}: PruneOptions = {}): Promise<PruneResult> {
  const context = createExecutionContext({ budgetMs: executionBudgetMs, now });
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
          return [{ file: entry.file }];
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
    context.dispose();
  }
}
