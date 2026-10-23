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
const DELETED_STATUSES = new Set([404, 410]);

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
  const timer = setTimeout(
    () => {
      controller.abort(
        new DOMException('Execution deadline exceeded', 'TimeoutError'),
      );
    },
    Math.max(0, budgetMs),
  );
  return {
    signal: controller.signal,
    remainingMs: () =>
      controller.signal.aborted ? 0 : Math.max(0, deadlineAt - now()),
    dispose: () => clearTimeout(timer),
  };
}

// Injected waits must settle promptly when the signal is aborted.
export type Sleep = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;
export type HttpRuntime = {
  fetch?: typeof fetch;
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
    return { date, title, url };
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
  url: URL,
  service: Service,
  runtime: HttpRuntime = {},
): Promise<LinkStatus> {
  if (runtime.context?.signal.aborted || runtime.context?.remainingMs() === 0) {
    return 'unverified';
  }
  try {
    validateContentUrl(url, service);
    const response = await ky.head(url.href, {
      fetch: runtime.fetch,
      redirect: 'manual',
      signal: runtime.context?.signal,
      // Classify HTTP statuses without reading error bodies.
      throwHttpErrors: false,
    });
    if (response.ok) return 'public';
    if (REDIRECT_STATUSES.has(response.status)) return 'public';
    if (DELETED_STATUSES.has(response.status)) return 'deleted';
  } catch {}
  return 'unverified';
}

// Verifiers must settle promptly when context.signal is aborted.
export type LinkVerifier = (
  url: URL,
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

async function runLinkCheckBatches(
  entries: LinkCheck[],
  verify: LinkVerifier,
  statuses: Map<string, LinkStatus>,
  { context, batchIntervalMs = 1000, sleep: wait = sleep }: LinkCheckRunOptions,
): Promise<void> {
  const expired = () => context.signal.aborted || context.remainingMs() <= 0;
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
        if (!expired()) statuses.set(entry.url.href, status);
      });
    await Promise.all(batch);
    if (expired() || offset + LINK_CHECK_BATCH_SIZE >= entries.length) break;
    if (context.remainingMs() <= batchIntervalMs) break;
    await wait(batchIntervalMs, context.signal);
  }
}

export async function runLinkChecks(
  entries: LinkCheck[],
  verify: LinkVerifier,
  options: LinkCheckRunOptions,
): Promise<LinkCheckRunResult> {
  const statuses = new Map<string, LinkStatus>();
  try {
    await runLinkCheckBatches(entries, verify, statuses, options);
  } catch (error) {
    if (!options.context.signal.aborted) throw error;
  }

  return {
    statuses,
    unchecked: entries.filter(({ url }) => !statuses.has(url.href)),
  };
}
