import Parser from 'rss-parser';
import { formatDateInSiteTimeZone } from '../../src/config/site-time.ts';
import {
  type LinkCheck,
  type LinkStatus,
  type Service,
  type Source,
  services,
  validateContentUrl,
} from './external-content-planning.ts';

export const DEFAULT_EXECUTION_BUDGET_MS = 8 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const RSS_RESPONSE_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ExecutionContext = {
  signal: AbortSignal;
  remainingMs(): number;
  startRequest?(source: Source): Promise<boolean>;
  initialRequestScheduled?: boolean;
  dispose(): void;
};

type Timer = ReturnType<typeof setTimeout>;
export type ExecutionContextOptions = {
  budgetMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  intervalMs?: number;
  sleep?: Sleep;
};

export function createExecutionContext({
  budgetMs = DEFAULT_EXECUTION_BUDGET_MS,
  now = Date.now,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer),
  intervalMs = 1000,
  sleep: wait = sleep,
}: ExecutionContextOptions = {}): ExecutionContext {
  const controller = new AbortController();
  const deadlineAt = now() + Math.max(0, budgetMs);
  let expired = false;
  const lastStarted = new Map<Source, number>();
  const requestQueues = new Map<Source, Promise<void>>();
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
    startRequest: async (source) => {
      const previousQueue = requestQueues.get(source) ?? Promise.resolve();
      let releaseQueue!: () => void;
      const currentQueue = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      requestQueues.set(source, currentQueue);
      await previousQueue;
      try {
        while (!expired && !controller.signal.aborted) {
          const previous = lastStarted.get(source);
          const delay =
            previous === undefined ? 0 : previous + intervalMs - now();
          if (delay <= 0) {
            if (deadlineAt <= now()) return false;
            lastStarted.set(source, now());
            return true;
          }
          if (delay >= deadlineAt - now()) return false;
          try {
            await wait(delay, controller.signal);
          } catch {
            return false;
          }
        }
        return false;
      } finally {
        releaseQueue();
        if (requestQueues.get(source) === currentQueue) {
          requestQueues.delete(source);
        }
      }
    },
    dispose: () => clearTimer(timer),
  };
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type Sleep = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;
export type HttpRuntime = {
  fetch?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  context?: ExecutionContext;
  requestTimeoutMs?: number;
};

function sourceForService(service: Service): Source | undefined {
  return (Object.entries(services) as [Source, Service][]).find(
    ([, configured]) =>
      configured.host === service.host &&
      configured.pathPrefix === service.pathPrefix,
  )?.[0];
}

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

function publicationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid RSS publication date: ${value}`);
  return formatDateInSiteTimeZone(date);
}

export async function parseFeedXml(xml: string, service: Service) {
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
    return {
      date: publicationDate(item.pubDate),
      title,
      url: validateContentUrl(item.link, service),
    };
  });
}

export async function fetchFeed(service: Service, runtime: HttpRuntime = {}) {
  const fetchImpl = runtime.fetch ?? fetch;
  const wait = runtime.sleep ?? sleep;
  const now = runtime.now ?? Date.now;
  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    assertBudget(runtime);
    const source = sourceForService(service);
    if (source && runtime.context?.startRequest) {
      if (!(await runtime.context.startRequest(source))) {
        throw new DOMException('Execution deadline exceeded', 'TimeoutError');
      }
    }
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
      url = new URL(validateContentUrl(target, service));
    } catch {
      return 'review';
    }
    if (visited.has(url.href)) return 'review';
    visited.add(url.href);
    const source = sourceForService(service);
    if (
      source &&
      runtime.context?.startRequest &&
      !(redirects === 0 && runtime.context.initialRequestScheduled)
    ) {
      if (!(await runtime.context.startRequest(source))) return 'defer';
    }
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

export type ScheduledLinkVerifier = (
  url: string,
  service: Service,
  context: ExecutionContext,
) => Promise<LinkStatus>;
export type LinkCheckRunOptions = {
  services: typeof services;
  context: ExecutionContext;
  intervalMs?: number;
  now?: () => number;
  sleep?: Sleep;
};
export type LinkCheckRunResult = {
  statuses: Map<string, LinkStatus>;
  unchecked: LinkCheck[];
};

export async function runLinkChecks(
  entries: LinkCheck[],
  verify: ScheduledLinkVerifier,
  {
    services: configuredServices,
    context,
    intervalMs = 1000,
    now = Date.now,
    sleep: wait = sleep,
  }: LinkCheckRunOptions,
): Promise<LinkCheckRunResult> {
  const statuses = new Map<string, LinkStatus>();
  const pending = entries.map((entry, index) => ({ entry, index }));
  const inFlight = new Map<number, Promise<void>>();
  const lastStarted = new Map<Source, number>();
  let resolveDeadline!: () => void;
  const deadline = new Promise<void>((resolve) => {
    resolveDeadline = resolve;
  });
  const onDeadline = () => resolveDeadline();
  context.signal.addEventListener('abort', onDeadline, { once: true });
  if (context.signal.aborted) resolveDeadline();
  let startBlocked = false;

  try {
    while (pending.length || inFlight.size) {
      if (context.signal.aborted) break;
      if (context.remainingMs() <= 0) {
        if (inFlight.size) await deadline;
        break;
      }
      let started = false;
      while (!startBlocked && inFlight.size < 2) {
        const currentTime = now();
        const eligibleIndex = context.startRequest
          ? pending.length
            ? 0
            : -1
          : pending.findIndex(({ entry }) => {
              const previous = lastStarted.get(entry.source);
              return (
                previous === undefined || currentTime - previous >= intervalMs
              );
            });
        if (eligibleIndex < 0) break;
        const [{ entry, index }] = pending.splice(eligibleIndex, 1);
        if (context.startRequest) {
          let requestGranted = false;
          try {
            requestGranted = await context.startRequest(entry.source);
          } catch {
            requestGranted = false;
          }
          if (!requestGranted) {
            pending.unshift({ entry, index });
            startBlocked = true;
            break;
          }
        } else {
          lastStarted.set(entry.source, now());
        }
        const linkContext = context.startRequest
          ? { ...context, initialRequestScheduled: true }
          : context;
        let verification: Promise<LinkStatus>;
        try {
          verification = verify(
            entry.url,
            configuredServices[entry.source],
            linkContext,
          );
        } catch (error) {
          verification = Promise.reject(error);
        }
        const task = verification
          .then((status) => {
            if (!context.signal.aborted && context.remainingMs() > 0) {
              statuses.set(entry.url, status);
            }
          })
          .catch(() => {
            if (!context.signal.aborted && context.remainingMs() > 0) {
              statuses.set(entry.url, 'defer');
            }
          })
          .finally(() => inFlight.delete(index));
        inFlight.set(index, task);
        started = true;
      }
      if (started) continue;

      if (inFlight.size) {
        const progress = Promise.race(inFlight.values());
        if (pending.length && !startBlocked && !context.startRequest) {
          const currentTime = now();
          const nextDelay = Math.min(
            ...pending.map(({ entry }) =>
              Math.max(
                0,
                (lastStarted.get(entry.source) ?? currentTime) +
                  intervalMs -
                  currentTime,
              ),
            ),
          );
          const remaining = context.remainingMs();
          const waitMs = nextDelay < remaining ? nextDelay : remaining;
          const beforeWait = now();
          try {
            await Promise.race([
              progress,
              wait(waitMs, context.signal),
              deadline,
            ]);
          } catch {
            await deadline;
          }
          if (
            !context.signal.aborted &&
            context.remainingMs() > 0 &&
            now() === beforeWait
          ) {
            await Promise.race([progress, deadline]);
          }
        } else {
          await Promise.race([progress, deadline]);
        }
        continue;
      }

      if (pending.length && !startBlocked) {
        const currentTime = now();
        const nextDelay = Math.min(
          ...pending.map(({ entry }) =>
            Math.max(
              0,
              (lastStarted.get(entry.source) ?? currentTime) +
                intervalMs -
                currentTime,
            ),
          ),
        );
        const remaining = context.remainingMs();
        if (nextDelay >= remaining) break;
        const beforeWait = now();
        try {
          await Promise.race([wait(nextDelay, context.signal), deadline]);
        } catch {
          await deadline;
        }
        if (
          !context.signal.aborted &&
          context.remainingMs() > 0 &&
          now() === beforeWait
        ) {
          break;
        }
        continue;
      }
      break;
    }
  } finally {
    context.signal.removeEventListener('abort', onDeadline);
  }

  const unchecked = entries.filter((entry) => !statuses.has(entry.url));
  return { statuses, unchecked };
}
