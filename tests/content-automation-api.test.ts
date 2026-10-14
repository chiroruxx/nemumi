import assert from 'node:assert/strict';
import test from 'node:test';
import { createContentAutomationApi } from '../scripts/lib/content-automation-api.ts';

const apiBaseUrl = 'https://api.github.test';
const token = 'secret-test-token';

function jsonResponse(
  value: unknown,
  options: { status?: number; link?: string } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.link) headers.set('link', options.link);
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers,
  });
}

function createFetch(responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected fetch');
    return response;
  };
  return { calls, fetchImpl };
}

function responseWithTrackedBody(value: unknown, status = 200) {
  const response = jsonResponse(value, { status });
  const body = response.body;
  assert.ok(body);
  let canceled = false;
  const cancel = body.cancel.bind(body);
  body.cancel = async (reason?: unknown) => {
    canceled = true;
    await cancel(reason);
  };
  return { response, wasCanceled: () => canceled };
}

test('pull request pages map REST fields and follow the Link next URL', async () => {
  const nextUrl = `${apiBaseUrl}/repos/owner/repo/pulls?head=owner%3Aautomation%2Fsizu&base=main&state=all&sort=created&direction=desc&per_page=100&page=2`;
  const fake = createFetch([
    jsonResponse(
      [
        {
          number: 29,
          state: 'open',
          merged_at: null,
          body: 'Update',
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
      { link: `<${nextUrl}>; rel="next", <${nextUrl}>; rel="last"` },
    ),
    jsonResponse([
      {
        number: 30,
        state: 'closed',
        merged_at: null,
        body: null,
        created_at: '2026-10-02T00:00:00Z',
      },
    ]),
  ]);
  const api = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: fake.fetchImpl,
    apiBaseUrl,
  });

  assert.deepEqual(
    await api.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 1,
      perPage: 100,
    }),
    {
      items: [
        {
          number: 29,
          state: 'open',
          mergedAt: null,
          body: 'Update',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      hasNextPage: true,
    },
  );
  assert.deepEqual(
    await api.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 2,
      perPage: 100,
    }),
    {
      items: [
        {
          number: 30,
          state: 'closed',
          mergedAt: null,
          body: null,
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
      hasNextPage: false,
    },
  );
  const firstUrl = new URL(fake.calls[0]?.url ?? '');
  assert.equal(firstUrl.pathname, '/repos/owner/repo/pulls');
  assert.equal(firstUrl.searchParams.get('head'), 'owner:automation/sizu');
  assert.equal(firstUrl.searchParams.get('base'), 'main');
  assert.equal(firstUrl.searchParams.get('state'), 'all');
  assert.equal(firstUrl.searchParams.get('sort'), 'created');
  assert.equal(firstUrl.searchParams.get('direction'), 'desc');
  assert.equal(fake.calls[1]?.url, nextUrl);
});

test('compare maps commit author and committer logins from REST JSON', async () => {
  const fake = createFetch([
    jsonResponse({
      commits: [
        {
          author: { login: 'author-user' },
          committer: { login: 'github-actions[bot]' },
        },
        { author: null, committer: null },
      ],
    }),
  ]);
  const api = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: fake.fetchImpl,
    apiBaseUrl,
  });

  assert.deepEqual(
    await api.compareCommits({
      base: 'main',
      head: 'automation/sizu',
      page: 1,
      perPage: 100,
    }),
    {
      found: true,
      commits: [
        {
          author: { login: 'author-user' },
          committer: { login: 'github-actions[bot]' },
        },
        { author: null, committer: null },
      ],
      hasNextPage: false,
    },
  );
  assert.equal(
    new URL(fake.calls[0]?.url ?? '').pathname,
    '/repos/owner/repo/compare/main...automation%2Fsizu',
  );
});

test('compare 404 means a new branch only when branch lookup also returns 404', async () => {
  const absent = createFetch([
    jsonResponse({ message: 'Not Found' }, { status: 404 }),
    jsonResponse({ message: 'Not Found' }, { status: 404 }),
  ]);
  const absentApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: absent.fetchImpl,
    apiBaseUrl,
  });
  assert.deepEqual(
    await absentApi.compareCommits({
      base: 'main',
      head: 'automation/sizu',
      page: 1,
      perPage: 100,
    }),
    { found: false, commits: [], hasNextPage: false },
  );
  assert.match(absent.calls[1]?.url ?? '', /\/branches\/automation%2Fsizu$/);

  const existing = createFetch([
    jsonResponse({ message: 'Not Found' }, { status: 404 }),
    jsonResponse({ name: 'automation/sizu' }),
  ]);
  const existingApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: existing.fetchImpl,
    apiBaseUrl,
  });
  await assert.rejects(
    existingApi.compareCommits({
      base: 'main',
      head: 'automation/sizu',
      page: 1,
      perPage: 100,
    }),
    /compare\/main.*returned HTTP 404/,
  );
});

test('pull request event maps a missing actor to null', async () => {
  const fake = createFetch([
    jsonResponse([
      {
        id: 7,
        event: 'closed',
        created_at: '2026-10-03T00:00:00Z',
        actor: null,
      },
    ]),
  ]);
  const api = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: fake.fetchImpl,
    apiBaseUrl,
  });
  assert.deepEqual(
    await api.listIssueEvents({ pullNumber: 29, page: 1, perPage: 100 }),
    {
      events: [
        {
          id: 7,
          event: 'closed',
          createdAt: '2026-10-03T00:00:00Z',
          actor: null,
        },
      ],
      hasNextPage: false,
    },
  );
});

test('PATCH sends body and state together and keeps token only in authorization headers', async () => {
  const fake = createFetch([jsonResponse({ state: 'closed' })]);
  const api = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: fake.fetchImpl,
    apiBaseUrl,
  });
  await api.updatePullRequest({
    number: 29,
    body: 'Update\n<!-- marker -->',
    state: 'closed',
  });

  const call = fake.calls[0];
  assert.equal(call?.init?.method, 'PATCH');
  const headers = new Headers(call?.init?.headers);
  assert.equal(headers.get('authorization'), `Bearer ${token}`);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(call?.init?.body)), {
    body: 'Update\n<!-- marker -->',
    state: 'closed',
  });
  assert.equal(call?.url.includes(token), false);
});

test('API releases response bodies for HTTP errors, compare 404s, and PATCH success', async () => {
  const forbidden = responseWithTrackedBody({ message: 'Forbidden' }, 403);
  const forbiddenApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: createFetch([forbidden.response]).fetchImpl,
    apiBaseUrl,
  });
  await assert.rejects(
    forbiddenApi.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 1,
      perPage: 100,
    }),
    /HTTP 403/,
  );
  assert.equal(forbidden.wasCanceled(), true);

  const compareMissing = responseWithTrackedBody({ message: 'Not Found' }, 404);
  const branchMissing = responseWithTrackedBody({ message: 'Not Found' }, 404);
  const absentApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: createFetch([compareMissing.response, branchMissing.response])
      .fetchImpl,
    apiBaseUrl,
  });
  assert.deepEqual(
    await absentApi.compareCommits({
      base: 'main',
      head: 'automation/sizu',
      page: 1,
      perPage: 100,
    }),
    { found: false, commits: [], hasNextPage: false },
  );
  assert.equal(compareMissing.wasCanceled(), true);
  assert.equal(branchMissing.wasCanceled(), true);

  const patched = responseWithTrackedBody({ state: 'closed' });
  const patchApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: createFetch([patched.response]).fetchImpl,
    apiBaseUrl,
  });
  await patchApi.updatePullRequest({
    number: 29,
    body: 'closed',
    state: 'closed',
  });
  assert.equal(patched.wasCanceled(), true);
});

test('invalid Link header, missing required data, unknown HTTP status, and fetch errors reject without exposing token', async () => {
  const invalidLink = createFetch([
    jsonResponse([], { link: 'not a valid Link header' }),
  ]);
  const invalidLinkApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: invalidLink.fetchImpl,
    apiBaseUrl,
  });
  await assert.rejects(
    invalidLinkApi.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 1,
      perPage: 100,
    }),
    /invalid Link header/,
  );

  const missingData = createFetch([jsonResponse([{ number: 29 }])]);
  const missingDataApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: missingData.fetchImpl,
    apiBaseUrl,
  });
  await assert.rejects(
    missingDataApi.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 1,
      perPage: 100,
    }),
    /invalid pull request response/,
  );

  const failed = createFetch([
    jsonResponse({ message: 'Forbidden' }, { status: 403 }),
  ]);
  const failedApi = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    fetchImpl: failed.fetchImpl,
    apiBaseUrl,
  });
  await assert.rejects(
    failedApi.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 1,
      perPage: 100,
    }),
    (error: Error) =>
      error.message.includes('HTTP 403') && !error.message.includes(token),
  );

  const requestSignals: (AbortSignal | null | undefined)[] = [];
  const networkFailure = createContentAutomationApi({
    owner: 'owner',
    repo: 'repo',
    token,
    apiBaseUrl,
    fetchImpl: async (_input, init) => {
      requestSignals.push(init?.signal as AbortSignal | null | undefined);
      throw new Error(token);
    },
  });
  await assert.rejects(
    networkFailure.listPullRequests({
      head: 'automation/sizu',
      base: 'main',
      page: 1,
      perPage: 100,
    }),
    (error: Error) => !error.message.includes(token),
  );
  assert.ok(requestSignals[0] instanceof AbortSignal);
});
