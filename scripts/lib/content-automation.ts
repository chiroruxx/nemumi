const noDiffMarker = '<!-- nemumi:no-diff -->';
const githubActionsLogin = 'github-actions[bot]';
const pageSize = 100;
const maxPages = 1_000;

export type ContentAutomationPage<T> = { hasNextPage: boolean } & T;

export type ContentAutomationPullRequest = {
  number: number;
  state: 'open' | 'closed';
  mergedAt: string | null;
  body: string | null;
  createdAt: string;
};

export type ContentAutomationEvent = {
  id: number;
  event: string;
  createdAt: string;
  actor: { login: string | null } | null;
};

export type ContentAutomationCommit = {
  author: { login: string | null } | null;
  committer: { login: string | null } | null;
};

export type ContentAutomationApi = {
  listPullRequests(input: {
    head: string;
    base: string;
    page: number;
    perPage: number;
  }): Promise<ContentAutomationPage<{ items: ContentAutomationPullRequest[] }>>;
  compareCommits(input: {
    base: string;
    head: string;
    page: number;
    perPage: number;
  }): Promise<
    ContentAutomationPage<{
      found: boolean;
      commits: ContentAutomationCommit[];
    }>
  >;
  listIssueEvents(input: {
    pullNumber: number;
    page: number;
    perPage: number;
  }): Promise<ContentAutomationPage<{ events: ContentAutomationEvent[] }>>;
  updatePullRequest(input: {
    number: number;
    body: string;
    state: 'open' | 'closed';
  }): Promise<void>;
};

type GuardResult =
  | { action: 'run-cpr' }
  | { action: 'no-op' }
  | { action: 'close-no-diff' }
  | { action: 'reopen-then-run-cpr' }
  | { action: 'stop'; reason: string };

function stop(reason: string): GuardResult {
  return { action: 'stop', reason };
}

async function collectPages<T>(
  getPage: (page: number) => Promise<ContentAutomationPage<T>>,
): Promise<T[]> {
  const pages: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await getPage(page);
    if (typeof result.hasNextPage !== 'boolean') {
      throw new Error('API pagination response is incomplete');
    }
    const { hasNextPage: _hasNextPage, ...data } = result;
    pages.push(data as T);
    if (!result.hasNextPage) return pages;
  }
  throw new Error('API pagination exceeded the safety limit');
}

function newestPullRequest(
  pullRequests: ContentAutomationPullRequest[],
): ContentAutomationPullRequest | undefined {
  if (pullRequests.some((pullRequest) => !isPullRequest(pullRequest))) {
    throw new Error('Pull request has an invalid creation timestamp');
  }
  return pullRequests.toSorted(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.number - left.number,
  )[0];
}

function isPullRequest(value: ContentAutomationPullRequest): boolean {
  return (
    Number.isInteger(value.number) &&
    (value.state === 'open' || value.state === 'closed') &&
    (value.mergedAt === null ||
      (typeof value.mergedAt === 'string' &&
        !Number.isNaN(Date.parse(value.mergedAt)))) &&
    (value.body === null || typeof value.body === 'string') &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}

function markerBody(body: string | null): string {
  const current = body ?? '';
  return current.includes(noDiffMarker)
    ? current
    : `${current.trimEnd()}${current.trimEnd() ? '\n\n' : ''}${noDiffMarker}`;
}

function removeMarker(body: string | null): string {
  return (body ?? '')
    .split('\n')
    .filter((line) => line.trim() !== noDiffMarker)
    .join('\n')
    .trimEnd();
}

async function hasOnlyAutomationCommits(
  api: ContentAutomationApi,
  base: string,
  head: string,
): Promise<boolean> {
  const pages = await collectPages((page) =>
    api.compareCommits({ base, head, page, perPage: pageSize }),
  );
  const firstPage = pages[0];
  if (!firstPage || typeof firstPage.found !== 'boolean') return false;
  if (!firstPage.found) {
    return pages.length === 1 && firstPage.commits.length === 0;
  }
  return pages.every(
    (page) =>
      page.found === true &&
      Array.isArray(page.commits) &&
      page.commits.every(
        (commit) => commit.committer?.login === githubActionsLogin,
      ),
  );
}

async function latestClosedActor(
  api: ContentAutomationApi,
  pullNumber: number,
): Promise<string | null | undefined> {
  const pages = await collectPages((page) =>
    api.listIssueEvents({ pullNumber, page, perPage: pageSize }),
  );
  const closedEvents = pages.flatMap((page) =>
    page.events.filter((event) => event.event === 'closed'),
  );
  if (closedEvents.length === 0) return undefined;
  if (
    closedEvents.some(
      (event) =>
        Number.isNaN(Date.parse(event.createdAt)) ||
        !Number.isInteger(event.id),
    )
  ) {
    return undefined;
  }
  const latestTimestamp = Math.max(
    ...closedEvents.map((event) => Date.parse(event.createdAt)),
  );
  const latest = closedEvents.filter(
    (event) => Date.parse(event.createdAt) === latestTimestamp,
  );
  const latestIds = new Set(latest.map((event) => event.id));
  if (latestIds.size !== latest.length) return undefined;
  const event = latest.toSorted((left, right) => right.id - left.id)[0];
  return event?.actor?.login;
}

export async function guardContentAutomation(input: {
  api: ContentAutomationApi;
  appSlug: string;
  base: string;
  head: string;
  hasDiff: boolean;
}): Promise<GuardResult> {
  try {
    const { api, appSlug, base, head, hasDiff } = input;
    const pullRequestPages = await collectPages((page) =>
      api.listPullRequests({ head, base, page, perPage: pageSize }),
    );
    const pullRequest = newestPullRequest(
      pullRequestPages.flatMap((page) => page.items),
    );

    if (!(await hasOnlyAutomationCommits(api, base, head))) {
      return stop('The automation branch contains a non-automation commit.');
    }

    if (!pullRequest) return { action: hasDiff ? 'run-cpr' : 'no-op' };
    if (pullRequest.mergedAt !== null) return { action: 'run-cpr' };
    if (pullRequest.state === 'open') {
      if (hasDiff) return { action: 'run-cpr' };
      await api.updatePullRequest({
        number: pullRequest.number,
        body: markerBody(pullRequest.body),
        state: 'closed',
      });
      return { action: 'close-no-diff' };
    }

    const latestActor = await latestClosedActor(api, pullRequest.number);
    if (latestActor !== `${appSlug}[bot]`) {
      return stop('The latest close was not verified as an automation close.');
    }
    if (!pullRequest.body?.includes(noDiffMarker)) {
      return stop('The closed pull request has no automation no-diff marker.');
    }
    if (!hasDiff) return { action: 'no-op' };
    await api.updatePullRequest({
      number: pullRequest.number,
      body: removeMarker(pullRequest.body),
      state: 'open',
    });
    return { action: 'reopen-then-run-cpr' };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown API error';
    return stop(`Content automation guard failed: ${message}`);
  }
}
