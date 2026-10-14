import { Octokit } from '@octokit/rest';
import { z } from 'zod';
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

type ApiPage = { data: unknown };
type PageIterator = AsyncIterator<ApiPage>;
type PaginationState = {
  page: number;
  iterator: PageIterator;
  next: IteratorResult<ApiPage>;
};

const loginSchema = z
  .object({ login: z.string().nullable().optional() })
  .nullable()
  .optional()
  .transform((user) => (user ? { login: user.login ?? null } : null));

const pullRequestSchema = z
  .object({
    number: z.number().int(),
    state: z.enum(['open', 'closed']),
    merged_at: z.iso.datetime().nullable(),
    body: z.string().nullable(),
    created_at: z.iso.datetime(),
  })
  .transform(({ number, state, merged_at, body, created_at }) => ({
    number,
    state,
    mergedAt: merged_at,
    body,
    createdAt: created_at,
  }));

const eventSchema = z
  .object({
    id: z.number().int(),
    event: z.string().min(1),
    created_at: z.iso.datetime(),
    actor: loginSchema,
  })
  .transform(({ id, event, created_at, actor }) => ({
    id,
    event,
    createdAt: created_at,
    actor,
  }));

const commitSchema = z
  .object({ author: loginSchema, committer: loginSchema })
  .transform(({ author, committer }) => ({ author, committer }));

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(message);
  return result.data;
}

const parsePullRequest = (value: unknown): ContentAutomationPullRequest =>
  parse(
    pullRequestSchema,
    value,
    'GitHub API returned an invalid pull request response',
  );

const parseEvent = (value: unknown): ContentAutomationEvent =>
  parse(
    eventSchema,
    value,
    'GitHub API returned an invalid issue event response',
  );

const parseCommit = (value: unknown): ContentAutomationCommit =>
  parse(commitSchema, value, 'GitHub API returned an invalid compare response');

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  return typeof error.status === 'number' ? error.status : undefined;
}

function safeRequestError(method: string, path: string, error: unknown): Error {
  const status = errorStatus(error);
  const result = new Error(
    status === undefined
      ? `${method} ${path} failed before a response`
      : `${method} ${path} returned HTTP ${status}`,
  );
  if (status !== undefined) Object.assign(result, { status });
  return result;
}

export function createContentAutomationApi(
  config: ApiConfig,
): ContentAutomationApi {
  const { owner, repo, token } = config;
  if (!owner || !repo || !token.trim()) {
    throw new Error('GitHub API owner, repository, and token are required');
  }
  const apiBaseUrl = (config.apiBaseUrl ?? 'https://api.github.com').replace(
    /\/$/,
    '',
  );
  const apiBase = new URL(apiBaseUrl);
  const repositoryPath = `${apiBase.pathname.replace(/\/$/, '')}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`;
  const fetchImpl = config.fetchImpl ?? fetch;
  const octokit = new Octokit({
    auth: token,
    baseUrl: apiBaseUrl,
    userAgent: 'nemumi-content-automation',
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    request: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          url.origin !== apiBase.origin ||
          !url.pathname.startsWith(repositoryPath)
        ) {
          throw new Error('GitHub API returned an unsafe pagination Link');
        }
        const timeoutSignal = AbortSignal.timeout(30_000);
        const signal = init?.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal;
        return fetchImpl(input, { ...init, signal });
      },
    },
  });
  const pagination = new Map<string, PaginationState>();

  async function nextPage(
    iterator: PageIterator,
    path: string,
  ): Promise<IteratorResult<ApiPage>> {
    try {
      return await iterator.next();
    } catch (error) {
      throw safeRequestError('GET', path, error);
    }
  }

  async function paginated<T>(input: {
    key: string;
    path: string;
    page: number;
    iterator: () => AsyncIterable<ApiPage>;
    parse: (value: unknown) => T;
    extractItems?: (value: unknown) => unknown;
  }): Promise<ContentAutomationPage<{ items: T[] }>> {
    let state = pagination.get(input.key);
    let current: IteratorResult<ApiPage>;
    if (input.page === 1) {
      const iterator = input.iterator()[Symbol.asyncIterator]();
      current = await nextPage(iterator, input.path);
      if (current.done) return { items: [], hasNextPage: false };
      state = {
        page: 2,
        iterator,
        next: await nextPage(iterator, input.path),
      };
    } else if (!state || state.page !== input.page) {
      throw new Error('GitHub API pagination response is incomplete');
    } else {
      current = state.next;
      if (current.done) {
        pagination.delete(input.key);
        return { items: [], hasNextPage: false };
      }
      state = {
        page: input.page + 1,
        iterator: state.iterator,
        next: await nextPage(state.iterator, input.path),
      };
    }
    if (!current || current.done) {
      pagination.delete(input.key);
      return { items: [], hasNextPage: false };
    }
    if (state.next.done) pagination.delete(input.key);
    else pagination.set(input.key, state);
    const items = input.extractItems
      ? input.extractItems(current.value.data)
      : current.value.data;
    if (!Array.isArray(items)) {
      throw new Error('GitHub API returned an invalid list response');
    }
    return {
      items: items.map(input.parse),
      hasNextPage: !state.next.done,
    };
  }

  return {
    async listPullRequests({ head, base, page, perPage }) {
      const path = `${repositoryPath}pulls`;
      return paginated({
        key: `pulls:${head}:${base}`,
        path,
        page,
        iterator: () =>
          octokit.paginate.iterator(octokit.rest.pulls.list, {
            owner,
            repo,
            head: `${owner}:${head}`,
            base,
            state: 'all',
            sort: 'created',
            direction: 'desc',
            per_page: perPage,
          }),
        parse: parsePullRequest,
      });
    },

    async compareCommits({ base, head, page, perPage }) {
      const path = `${repositoryPath}compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
      const key = `compare:${base}:${head}`;
      let result: ContentAutomationPage<{ items: ContentAutomationCommit[] }>;
      try {
        result = await paginated({
          key,
          path,
          page,
          iterator: () =>
            octokit.paginate.iterator(
              octokit.rest.repos.compareCommitsWithBasehead,
              { owner, repo, basehead: `${base}...${head}`, per_page: perPage },
            ),
          parse: parseCommit,
          extractItems: (value) =>
            typeof value === 'object' && value !== null && 'commits' in value
              ? value.commits
              : undefined,
        });
      } catch (error) {
        if (errorStatus(error) !== 404 || page !== 1) throw error;
        try {
          const branch = await octokit.rest.repos.getBranch({
            owner,
            repo,
            branch: head,
          });
          if (branch.data.name !== head) {
            throw new Error('GitHub API returned an invalid branch response');
          }
        } catch (branchError) {
          if (errorStatus(branchError) === 404) {
            pagination.delete(key);
            return { found: false, commits: [], hasNextPage: false };
          }
          if (
            branchError instanceof Error &&
            /invalid branch response/.test(branchError.message)
          ) {
            throw branchError;
          }
          throw safeRequestError(
            'GET',
            `${repositoryPath}branches/${encodeURIComponent(head)}`,
            branchError,
          );
        }
        throw error;
      }
      return {
        found: true,
        commits: result.items,
        hasNextPage: result.hasNextPage,
      };
    },

    async listIssueEvents({ pullNumber, page, perPage }) {
      const path = `${repositoryPath}issues/${pullNumber}/events`;
      const result = await paginated({
        key: `events:${pullNumber}`,
        path,
        page,
        iterator: () =>
          octokit.paginate.iterator(octokit.rest.issues.listEventsForRepo, {
            owner,
            repo,
            issue_number: pullNumber,
            per_page: perPage,
          }),
        parse: parseEvent,
      });
      return { events: result.items, hasNextPage: result.hasNextPage };
    },

    async updatePullRequest({ number, body, state }) {
      const path = `${repositoryPath}pulls/${number}`;
      try {
        await octokit.rest.pulls.update({
          owner,
          repo,
          pull_number: number,
          body,
          state,
        });
      } catch (error) {
        throw safeRequestError('PATCH', path, error);
      }
    },
  };
}
