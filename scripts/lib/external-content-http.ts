import Parser from 'rss-parser';
import { contentDateSchema } from '../../src/config/content-schema.ts';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  getService,
  type Service,
  validateContentUrl,
} from './external-content.ts';
import type { LinkCheck, LinkStatus } from './external-content-planning.ts';

const DEFAULT_EXECUTION_BUDGET_MS = 8 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const RSS_RESPONSE_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 2;
const LINK_CHECK_BATCH_SIZE = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ExecutionContext = {
  signal: AbortSignal;
  remainingMs(): number;
  dispose(): void;
};

type Timer = ReturnType<typeof setTimeout>;
type ExecutionContextOptions = {
  budgetMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export function createExecutionContext({
  budgetMs = DEFAULT_EXECUTION_BUDGET_MS,
  now = Date.now,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer),
}: ExecutionContextOptions = {}): ExecutionContext {
  const controller = new AbortController();
  const deadlineAt = now() + Math.max(0, budgetMs);
  let expired = false;
  const timer = setTimer(
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
    dispose: () => clearTimer(timer),
  };
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;
export type HttpRuntime = {
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  context?: ExecutionContext;
  requestTimeoutMs?: number;
};

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function requestSignal(runtime: HttpRuntime): AbortSignal {
  const timeout = AbortSignal.timeout(
    runtime.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  return runtime.context
    ? AbortSignal.any([timeout, runtime.context.signal])
    : timeout;
}

function assertBudget(runtime: HttpRuntime): void {
  if (runtime.context?.remainingMs() === 0 || runtime.context?.signal.aborted) {
    throw new DOMException('Execution deadline exceeded', 'TimeoutError');
  }
}

function retryDelay(
  value: string | null,
  now: () => number,
  attempt: number,
): number {
  if (value) {
    const seconds = Number(value);
    const requested = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(value) - now();
    if (Number.isFinite(requested) && requested > 0) {
      return Math.min(requested, 10_000);
    }
  }
  return (attempt + 1) * 1000;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response body may already be closed or errored; release it best-effort.
  }
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > RSS_RESPONSE_LIMIT_BYTES
  ) {
    await cancelBody(response);
    throw new Error('RSS exceeds the 5 MiB response limit');
  }
  if (!response.body) throw new Error('RSS response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > RSS_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new Error('RSS exceeds the 5 MiB response limit');
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the read error if the stream has already failed.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
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
  const fetchImpl = runtime.fetch ?? fetch;
  const wait = runtime.sleep ?? sleep;
  const now = runtime.now ?? Date.now;
  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    assertBudget(runtime);
    try {
      response = await fetchImpl(service.feed, {
        signal: requestSignal(runtime),
        redirect: 'manual',
        headers: { 'user-agent': 'nemumi-sync-content/1.0' },
      });
    } catch (error) {
      if (
        runtime.context?.signal.aborted ||
        runtime.context?.remainingMs() === 0
      ) {
        throw new DOMException('Execution deadline exceeded', 'TimeoutError');
      }
      if (attempt === MAX_RETRIES) throw error;
      await wait(retryDelay(null, now, attempt), runtime.context?.signal);
      continue;
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      let redirect: URL | undefined;
      try {
        redirect = location ? new URL(location, service.feed) : undefined;
      } catch {
        redirect = undefined;
      }
      await cancelBody(response);
      if (
        !redirect ||
        redirect.hostname !== service.host ||
        redirect.protocol !== 'https:'
      ) {
        throw new Error(
          `${service.label} RSS redirected outside its HTTPS host`,
        );
      }
      throw new Error(
        `${service.label} RSS redirect requires updating its configured URL`,
      );
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) {
        const status = response.status;
        await cancelBody(response);
        throw new Error(`${service.label} RSS returned HTTP ${status}`);
      }
      const delayMs = retryDelay(
        response.headers.get('retry-after'),
        now,
        attempt,
      );
      await cancelBody(response);
      await wait(delayMs, runtime.context?.signal);
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      await cancelBody(response);
      throw new Error(`${service.label} RSS returned HTTP ${status}`);
    }
    const body = await readLimitedText(response);
    return parseFeedXml(body, service);
  }
  throw new Error(`${service.label} RSS request returned no response`);
}

export async function verifyLink(
  value: string,
  service: Service,
  runtime: HttpRuntime = {},
): Promise<LinkStatus> {
  const fetchImpl = runtime.fetch ?? fetch;
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
      response = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal: requestSignal(runtime),
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
  let onDeadline!: () => void;
  const deadline = new Promise<void>((resolve) => {
    onDeadline = resolve;
  });
  context.signal.addEventListener('abort', onDeadline, { once: true });

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
      // A custom verifier may ignore AbortSignal, so stop waiting at the deadline.
      await Promise.race([Promise.all(batch), deadline]);
      if (expired() || offset + LINK_CHECK_BATCH_SIZE >= entries.length) break;
      if (context.remainingMs() <= batchIntervalMs) break;
      await Promise.race([wait(batchIntervalMs, context.signal), deadline]);
    }
  } catch (error) {
    if (!context.signal.aborted) throw error;
  } finally {
    context.signal.removeEventListener('abort', onDeadline);
  }

  return {
    statuses,
    unchecked: entries.filter(({ url }) => !statuses.has(url)),
  };
}
