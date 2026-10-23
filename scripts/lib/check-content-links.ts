import {
  buildCollectionIndex,
  type Collection,
  type CommonContentOptions,
  type ContentResult,
  defaultContentDirectory,
  limits,
} from './external-content.ts';
import {
  readCollection,
  removeFiles,
  validateFileRemovals,
} from './external-content-files.ts';
import {
  createExecutionContext,
  type LinkVerifier,
  runLinkChecks,
  type Sleep,
  verifyLink,
} from './external-content-http.ts';

type CheckContentLinksOptions = CommonContentOptions & {
  linkVerifier?: LinkVerifier;
  executionBudgetMs?: number;
  linkCheckBatchIntervalMs?: number;
  now?: () => number;
  sleep?: Sleep;
};

async function readContentLinkChecks(contentDirectory: string) {
  const collections = await Promise.all(
    (Object.keys(limits) as Collection[]).map(async (collection) => {
      const entries = await readCollection(collection, contentDirectory);
      return buildCollectionIndex(collection, entries);
    }),
  );
  return collections
    .flatMap(({ entries }) => entries)
    .flatMap(({ entry, source, url }) =>
      source && url ? [{ entry, source, url }] : [],
    )
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.url.href.localeCompare(b.url.href),
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
    const linkChecks = await readContentLinkChecks(contentDirectory);
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
    const removals = linkChecks
      .flatMap(({ entry, url }) =>
        checked.statuses.get(url.href) === 'deleted'
          ? [{ target: entry.file }]
          : [],
      )
      .sort((a, b) => a.target.localeCompare(b.target));
    await validateFileRemovals(removals, contentDirectory);
    if (!dryRun) await removeFiles(removals);

    return {
      unverified: linkChecks.flatMap(({ source, url }) =>
        checked.statuses.get(url.href) === 'unverified'
          ? [{ source, url }]
          : [],
      ),
      unchecked: checked.unchecked.map(({ source, url }) => ({ source, url })),
    };
  } finally {
    context.dispose();
  }
}
