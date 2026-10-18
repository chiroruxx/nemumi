import { setTimeout as delay } from 'node:timers/promises';
import ky from 'ky';
import Parser from 'rss-parser';
import { contentDateSchema } from '../../src/config/content-schema.ts';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  getService,
  type LinkCheck,
  type LinkStatus,
  type Service,
  validateContentUrl,
} from './external-content.ts';

const DEFAULT_EXECUTION_BUDGET_MS = 8 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const RSS_RESPONSE_LIMIT_BYTES = 5 * 1024 * 1024;
const LINK_CHECK_BATCH_SIZE = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ExecutionContext = {
  signal: AbortSignal;
  remainingMs(): number;
  dispose(): void;
};

type ExecutionContextOptions = {
  budgetMs?: number;
  now?: () => number;
};

export function createExecutionContext({
  budgetMs = DEFAULT_EXECUTION_BUDGET_MS,
  now = Date.now,
}: ExecutionContextOptions = {}): ExecutionContext {
  const controller = new AbortController();
  const deadlineAt = now() + Math.max(0, budgetMs);
  let expired = false;
  const timer = setTimeout(
    () => {
      expired = true;
      controller.abort(
        new DOMException('Execution deadline exceeded', 'TimeoutError'),
      );
    },
    Math.max(0, budgetMs),
  );
  return {
    signal: controller.signal,
    remainingMs: () => (expired ? 0 : Math.max(0, deadlineAt - now())),
    dispose: () => clearTimeout(timer),
  };
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
// Injected waits must settle promptly when the signal is aborted.
export type Sleep = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;
export type HttpRuntime = {
  fetch?: FetchLike;
  context?: ExecutionContext;
  requestTimeoutMs?: number;
};

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return delay(milliseconds, undefined, { signal });
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response body may already be closed or errored; release it best-effort.
  }
}

function publicationDate(value: string): Date {
  const instant = contentDateSchema.parse(value);
  return contentDateSchema.parse(formatDateInSiteTimeZone(instant));
}

async function parseFeedXml(xml: string, service: Service) {
  const parsed = await new Parser().parseString(xml);
  if (!parsed.items.length)
    throw new Error(`${service.label} RSS feed is empty`);
  return parsed.items.map((item) => {
    const title = item.title?.trim();
    if (!title || !item.pubDate || !item.link) {
      throw new Error(
        `${service.label} RSS item is missing title, pubDate, or link`,
      );
    }
    const date = publicationDate(item.pubDate);
    const url = new URL(item.link);
    validateContentUrl(url, service);
    url.hash = '';
    return { date, title, url: url.href };
  });
}

export async function fetchFeed(service: Service, runtime: HttpRuntime = {}) {
  const body = await ky(service.feed, {
    fetch: runtime.fetch,
    redirect: 'manual',
    headers: { 'user-agent': 'nemumi-sync-content/1.0' },
    signal: runtime.context?.signal,
    // Bound the entire RSS request, including retries, waits, and body reads.
    timeout: false,
    totalTimeout: runtime.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    maxResponseSize: RSS_RESPONSE_LIMIT_BYTES,
    // Keep server-directed retry waits within ten seconds.
    retry: { maxRetryAfter: 10_000 },
  }).text();
  return parseFeedXml(body, service);
}

export async function verifyLink(
  value: string,
  service: Service,
  runtime: HttpRuntime = {},
): Promise<LinkStatus> {
  let target = value;
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (
      runtime.context?.signal.aborted ||
      runtime.context?.remainingMs() === 0
    ) {
      return 'defer';
    }
    let url: URL;
    try {
      url = new URL(target);
      validateContentUrl(url, service);
      url.hash = '';
    } catch {
      return 'review';
    }
    if (visited.has(url.href)) return 'review';
    visited.add(url.href);
    let response: Response;
    try {
      response = await ky(url.href, {
        fetch: runtime.fetch,
        redirect: 'manual',
        signal: runtime.context?.signal,
        timeout: runtime.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
        // Classify HTTP statuses without retries or reading error bodies.
        retry: 0,
        throwHttpErrors: false,
        headers: { 'user-agent': 'nemumi-link-check/1.0' },
      });
    } catch {
      return 'defer';
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location) return 'review';
      try {
        target = new URL(location, url).href;
      } catch {
        return 'review';
      }
      continue;
    }
    const status = response.status;
    await cancelBody(response);
    if (status === 404 || status === 410) return 'deleted';
    if (status === 401 || status === 403 || status === 429 || status >= 500) {
      return 'defer';
    }
    return response.ok ? 'public' : 'review';
  }
  return 'review';
}

// Verifiers must settle promptly when context.signal is aborted.
export type LinkVerifier = (
  url: string,
  service: Service,
  context: ExecutionContext,
) => Promise<LinkStatus>;
type LinkCheckRunOptions = {
  context: ExecutionContext;
  batchIntervalMs?: number;
  sleep?: Sleep;
};
type LinkCheckRunResult = {
  statuses: Map<string, LinkStatus>;
  unchecked: LinkCheck[];
};

export async function runLinkChecks(
  entries: LinkCheck[],
  verify: LinkVerifier,
  { context, batchIntervalMs = 1000, sleep: wait = sleep }: LinkCheckRunOptions,
): Promise<LinkCheckRunResult> {
  const statuses = new Map<string, LinkStatus>();
  const expired = () => context.signal.aborted || context.remainingMs() <= 0;

  try {
    for (
      let offset = 0;
      offset < entries.length && !expired();
      offset += LINK_CHECK_BATCH_SIZE
    ) {
      const batch = entries
        .slice(offset, offset + LINK_CHECK_BATCH_SIZE)
        .map(async (entry) => {
          if (expired()) return;
          let status: LinkStatus;
          try {
            status = await verify(entry.url, getService(entry.source), context);
          } catch {
            status = 'defer';
          }
          if (!expired()) statuses.set(entry.url, status);
        });
      await Promise.all(batch);
      if (expired() || offset + LINK_CHECK_BATCH_SIZE >= entries.length) break;
      if (context.remainingMs() <= batchIntervalMs) break;
      await wait(batchIntervalMs, context.signal);
    }
  } catch (error) {
    if (!context.signal.aborted) throw error;
  }

  return {
    statuses,
    unchecked: entries.filter(({ url }) => !statuses.has(url)),
  };
}
