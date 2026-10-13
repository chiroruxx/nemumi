import type {
  ContentAutomationApi,
  ContentAutomationCommit,
  ContentAutomationEvent,
  ContentAutomationPage,
  ContentAutomationPullRequest,
} from './content-automation.ts';

type ApiConfig = {
  owner: string;
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
};

type PaginationState = { page: number; url: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function login(value: unknown): { login: string | null } | null {
  if (value === null || value === undefined) return null;
  const user = record(value);
  return { login: requiredString(user?.login) ?? null };
}

function parsePullRequest(value: unknown): ContentAutomationPullRequest {
  const pullRequest = record(value);
  if (!pullRequest) {
    throw new Error('GitHub API returned an invalid pull request response');
  }
  const state = pullRequest?.state;
  const mergedAt = pullRequest?.merged_at;
  const body = pullRequest?.body;
  const createdAt = requiredString(pullRequest?.created_at);
  if (
    !Number.isInteger(pullRequest?.number) ||
    (state !== 'open' && state !== 'closed') ||
    (mergedAt !== null && typeof mergedAt !== 'string') ||
    (body !== null && typeof body !== 'string') ||
    !createdAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    (typeof mergedAt === 'string' && Number.isNaN(Date.parse(mergedAt)))
  ) {
    throw new Error('GitHub API returned an invalid pull request response');
  }
  return {
    number: pullRequest.number as number,
    state,
    mergedAt,
    body,
    createdAt,
  };
}

function parseEvent(value: unknown): ContentAutomationEvent {
  const event = record(value);
  const id = event?.id;
  const name = requiredString(event?.event);
  const createdAt = requiredString(event?.created_at);
  if (
    !Number.isInteger(id) ||
    !name ||
    !createdAt ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    throw new Error('GitHub API returned an invalid issue event response');
  }
  return {
    id: id as number,
    event: name,
    createdAt,
    actor: login(event?.actor),
  };
}

function parseCommit(value: unknown): ContentAutomationCommit {
  const commit = record(value);
  if (!commit)
    throw new Error('GitHub API returned an invalid compare response');
  return { author: login(commit.author), committer: login(commit.committer) };
}

function parseNextLink(
  linkHeader: string | null,
  responseUrl: string,
  repositoryPath: string,
): string | undefined {
  if (linkHeader === null) return undefined;
  const links = linkHeader.split(/,\s*(?=<)/);
  if (links.length === 0 || links.some((link) => !link.trim())) {
    throw new Error('GitHub API returned an invalid Link header');
  }
  let nextUrl: string | undefined;
  for (const link of links) {
    const target = link.match(/^\s*<([^>]+)>/);
    const relation = link.match(
      /(?:^|;)\s*rel=(?:"([^"]+)"|'([^']+)'|([^;\s]+))/,
    );
    if (!target || !relation) {
      throw new Error('GitHub API returned an invalid Link header');
    }
    const rel = relation[1] ?? relation[2] ?? relation[3] ?? '';
    if (!rel.split(/\s+/).includes('next')) continue;
    const targetUrl = new URL(target[1] ?? '', responseUrl);
    if (
      targetUrl.origin !== new URL(responseUrl).origin ||
      !targetUrl.pathname.startsWith(repositoryPath)
    ) {
      throw new Error('GitHub API returned an unsafe pagination Link');
    }
    nextUrl = targetUrl.toString();
  }
  return nextUrl;
}

export function createContentAutomationApi(
  config: ApiConfig,
): ContentAutomationApi {
  const { owner, repo, token } = config;
  if (!owner || !repo || !token.trim()) {
    throw new Error('GitHub API owner, repository, and token are required');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBaseUrl = (config.apiBaseUrl ?? 'https://api.github.com').replace(
    /\/$/,
    '',
  );
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`;
  const pagination = new Map<string, PaginationState>();

  function endpoint(path: string): string {
    return `${apiBaseUrl}${repositoryPath}${path}`;
  }

  async function request(
    url: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(
        `${method} ${new URL(url).pathname} failed before a response`,
      );
    }
    return response;
  }

  async function responseJson(
    response: Response,
    method: string,
    url: string,
  ): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error(
        `${method} ${new URL(url).pathname} returned invalid JSON`,
      );
    }
  }

  async function checkResponse(
    response: Response,
    method: string,
    url: string,
  ): Promise<void> {
    if (!response.ok) {
      throw new Error(
        `${method} ${new URL(url).pathname} returned HTTP ${response.status}`,
      );
    }
  }

  async function paginated<T>(input: {
    key: string;
    path: string;
    page: number;
    perPage: number;
    query?: Record<string, string>;
    parse: (value: unknown) => T;
  }): Promise<ContentAutomationPage<{ items: T[] }>> {
    let url: string;
    if (input.page === 1) {
      pagination.delete(input.key);
      const requestUrl = new URL(endpoint(input.path));
      for (const [name, value] of Object.entries(input.query ?? {})) {
        requestUrl.searchParams.set(name, value);
      }
      requestUrl.searchParams.set('per_page', String(input.perPage));
      requestUrl.searchParams.set('page', '1');
      url = requestUrl.toString();
    } else {
      const state = pagination.get(input.key);
      if (!state || state.page !== input.page) {
        throw new Error('GitHub API pagination response is incomplete');
      }
      url = state.url;
    }
    const response = await request(url);
    await checkResponse(response, 'GET', url);
    const payload = await responseJson(response, 'GET', url);
    if (!Array.isArray(payload)) {
      throw new Error('GitHub API returned an invalid list response');
    }
    const nextUrl = parseNextLink(
      response.headers.get('link'),
      url,
      repositoryPath,
    );
    if (nextUrl)
      pagination.set(input.key, { page: input.page + 1, url: nextUrl });
    else pagination.delete(input.key);
    return {
      items: payload.map(input.parse),
      hasNextPage: nextUrl !== undefined,
    };
  }

  const api: ContentAutomationApi = {
    async listPullRequests({ head, base, page, perPage }) {
      const key = `pulls:${head}:${base}`;
      const result = await paginated({
        key,
        path: 'pulls',
        page,
        perPage,
        query: {
          head: `${owner}:${head}`,
          base,
          state: 'all',
          sort: 'created',
          direction: 'desc',
        },
        parse: parsePullRequest,
      });
      return { items: result.items, hasNextPage: result.hasNextPage };
    },

    async compareCommits({ base, head, page, perPage }) {
      const key = `compare:${base}:${head}`;
      let url: string;
      if (page === 1) {
        pagination.delete(key);
        const requestUrl = new URL(
          endpoint(
            `compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
          ),
        );
        requestUrl.searchParams.set('per_page', String(perPage));
        requestUrl.searchParams.set('page', '1');
        url = requestUrl.toString();
      } else {
        const state = pagination.get(key);
        if (!state || state.page !== page) {
          throw new Error('GitHub API pagination response is incomplete');
        }
        url = state.url;
      }
      const response = await request(url);
      if (response.status === 404 && page === 1) {
        const branchUrl = endpoint(`branches/${encodeURIComponent(head)}`);
        const branchResponse = await request(branchUrl);
        if (branchResponse.status === 404) {
          pagination.delete(key);
          return { found: false, commits: [], hasNextPage: false };
        }
        await checkResponse(branchResponse, 'GET', branchUrl);
        const branch = record(
          await responseJson(branchResponse, 'GET', branchUrl),
        );
        if (requiredString(branch?.name) !== head) {
          throw new Error('GitHub API returned an invalid branch response');
        }
        throw new Error(`GET ${new URL(url).pathname} returned HTTP 404`);
      }
      await checkResponse(response, 'GET', url);
      const payload = record(await responseJson(response, 'GET', url));
      if (!payload || !Array.isArray(payload.commits)) {
        throw new Error('GitHub API returned an invalid compare response');
      }
      const nextUrl = parseNextLink(
        response.headers.get('link'),
        url,
        repositoryPath,
      );
      if (nextUrl) pagination.set(key, { page: page + 1, url: nextUrl });
      else pagination.delete(key);
      return {
        found: true,
        commits: payload.commits.map(parseCommit),
        hasNextPage: nextUrl !== undefined,
      };
    },

    async listIssueEvents({ pullNumber, page, perPage }) {
      const key = `events:${pullNumber}`;
      const result = await paginated({
        key,
        path: `issues/${pullNumber}/events`,
        page,
        perPage,
        parse: parseEvent,
      });
      return { events: result.items, hasNextPage: result.hasNextPage };
    },

    async updatePullRequest({ number, body, state }) {
      const url = endpoint(`pulls/${number}`);
      const response = await request(url, 'PATCH', { body, state });
      await checkResponse(response, 'PATCH', url);
    },
  };
  return api;
}
