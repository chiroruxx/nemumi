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
};

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return delay(milliseconds, undefined, { signal });
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
    signal: runtime.context?.signal,
    maxResponseSize: RSS_RESPONSE_LIMIT_BYTES,
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
      return 'unverified';
    }
    let url: URL;
    try {
      url = new URL(target);
      validateContentUrl(url, service);
      url.hash = '';
    } catch {
      return 'unverified';
    }
    if (visited.has(url.href)) return 'unverified';
    visited.add(url.href);
    let response: Response;
    try {
      response = await ky.head(url.href, {
        fetch: runtime.fetch,
        redirect: 'manual',
        signal: runtime.context?.signal,
        // Classify HTTP statuses without reading error bodies.
        throwHttpErrors: false,
      });
    } catch {
      return 'unverified';
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) return 'unverified';
      try {
        target = new URL(location, url).href;
      } catch {
        return 'unverified';
      }
      continue;
    }
    const status = response.status;
    if (status === 404 || status === 410) return 'deleted';
    return response.ok ? 'public' : 'unverified';
  }
  return 'unverified';
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
            status = 'unverified';
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
