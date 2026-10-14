import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExecutionContext,
  type ExecutionContext,
  fetchFeed,
  parseFeedXml,
  runLinkChecks,
  verifyLink,
} from '../scripts/lib/external-content-http.ts';
import type {
  LinkCheck,
  LinkStatus,
  Service,
  Source,
} from '../scripts/lib/external-content-planning.ts';
import { services } from '../scripts/lib/external-content-planning.ts';

const feedFixtures: [Service, string, string, string][] = [
  [
    services.sizu,
    'https://sizu.me/chihiroxx/posts/fixture#fragment',
    'https://sizu.me/chihiroxx/posts/fixture',
    '<rss version="2.0"><channel><item><title> Sizu &amp; fixture </title><link>https://sizu.me/chihiroxx/posts/fixture#fragment</link><pubDate>Mon, 12 Oct 2026 18:20:00 GMT</pubDate></item></channel></rss>',
  ],
  [
    services.hatena,
    'https://toyo.hatenablog.jp/entry/fixture?from=rss',
    'https://toyo.hatenablog.jp/entry/fixture?from=rss',
    '<rss version="2.0"><channel><item><title> Hatena &amp; fixture </title><link>https://toyo.hatenablog.jp/entry/fixture?from=rss</link><pubDate>Mon, 12 Oct 2026 18:20:00 GMT</pubDate></item></channel></rss>',
  ],
  [
    services.speakerdeck,
    'https://speakerdeck.com/chiroruxx/fixture?from=rss',
    'https://speakerdeck.com/chiroruxx/fixture?from=rss',
    '<rss version="2.0"><channel><item><title> Speaker Deck &amp; fixture </title><link>https://speakerdeck.com/chiroruxx/fixture?from=rss</link><pubDate>Mon, 12 Oct 2026 18:20:00 GMT</pubDate></item></channel></rss>',
  ],
];

function createTestContext(
  remaining: () => number,
  signal = new AbortController().signal,
): ExecutionContext {
  return { signal, remainingMs: remaining, dispose: () => {} };
}

test('parseFeedXml maps all service fixtures to Tokyo dates and normalized feed items without network access', async () => {
  for (const [service, , normalizedUrl, xml] of feedFixtures) {
    const source = Object.entries(services).find(
      ([, value]) => value === service,
    )?.[0];
    assert.ok(source);
    const parsed = await parseFeedXml(xml, service);
    assert.deepEqual(parsed, [
      {
        date: '2026-10-13',
        title: `${service === services.sizu ? 'Sizu' : service === services.hatena ? 'Hatena' : 'Speaker Deck'} & fixture`,
        url: normalizedUrl,
      },
    ]);
  }
});

test('fetchFeed applies bounded retries and honors Retry-After seconds for network failures and 5xx', async () => {
  const sleeps: number[] = [];
  const attempts: RequestInit[] = [];
  const responses = [
    new Response('busy', { status: 503, headers: { 'retry-after': '2' } }),
    new Response(feedFixtures[0][3], { status: 200 }),
  ];
  let networkFailures = 1;
  const result = await fetchFeed(services.sizu, {
    fetch: async (_input, init) => {
      attempts.push(init ?? {});
      if (networkFailures-- > 0) throw new Error('connection reset');
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });
  assert.equal(attempts.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.equal(result[0]?.title, 'Sizu & fixture');
});

test('fetchFeed stops after two retries and cancels every exhausted error response', async () => {
  let calls = 0;
  let canceled = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    fetchFeed(services.sizu, {
      fetch: async () => {
        calls += 1;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('busy'));
            },
            cancel() {
              canceled += 1;
            },
          }),
          { status: 503 },
        );
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    }),
    /HTTP 503/,
  );
  assert.equal(calls, 3);
  assert.equal(canceled, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('fetchFeed parses Retry-After HTTP dates and rejects malformed RSS without partial output', async () => {
  let now = Date.parse('2026-10-13T00:00:00Z');
  const sleeps: number[] = [];
  let call = 0;
  await assert.rejects(
    fetchFeed(services.sizu, {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      fetch: async () => {
        call += 1;
        if (call === 1) {
          return new Response('busy', {
            status: 429,
            headers: { 'retry-after': new Date(now + 3000).toUTCString() },
          });
        }
        return new Response('<rss><channel><item><title>broken');
      },
    }),
    /RSS|XML|feed|Unclosed/i,
  );
  assert.deepEqual(sleeps, [3000]);
});

test('fetchFeed cancels redirect and failed response bodies and enforces the byte limit', async () => {
  let canceled = 0;
  const response = (status: number, headers?: HeadersInit) =>
    new Response(
      new ReadableStream({
        cancel() {
          canceled += 1;
        },
      }),
      { status, headers },
    );
  await assert.rejects(
    fetchFeed(services.sizu, {
      fetch: async () => response(302, { location: 'https://example.com/rss' }),
      sleep: async () => {},
    }),
    /redirected outside/,
  );
  await assert.rejects(
    fetchFeed(services.sizu, {
      fetch: async () => response(404),
      sleep: async () => {},
    }),
    /HTTP 404/,
  );
  assert.equal(canceled, 2);

  await assert.rejects(
    fetchFeed(services.sizu, {
      fetch: async () => new Response('x'.repeat(5 * 1024 * 1024 + 1)),
      sleep: async () => {},
    }),
    /5 MiB/,
  );
});

test('verifyLink passes the execution signal to fetch and releases response bodies', async () => {
  const controller = new AbortController();
  let passedSignal: AbortSignal | undefined;
  let canceled = 0;
  const status = await verifyLink(
    'https://sizu.me/chihiroxx/posts/fixture',
    services.sizu,
    {
      context: createTestContext(() => 60_000, controller.signal),
      fetch: async (_input, init) => {
        passedSignal = init?.signal as AbortSignal;
        return new Response(
          new ReadableStream({
            cancel() {
              canceled += 1;
            },
          }),
        );
      },
      sleep: async () => {},
    },
  );
  assert.equal(status, 'public');
  assert.ok(passedSignal);
  assert.equal(passedSignal.aborted, false);
  assert.equal(canceled, 1);
});

test('runLinkChecks enforces two concurrent checks and a per-service start interval', async () => {
  let clock = 0;
  const starts: { source: Source; at: number }[] = [];
  const pending: (() => void)[] = [];
  let active = 0;
  let maximum = 0;
  const checks: LinkCheck[] = [
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/one' },
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/two' },
    { source: 'hatena', url: 'https://toyo.hatenablog.jp/entry/three' },
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/four' },
  ];
  const work = runLinkChecks(
    checks,
    async (_url, service) => {
      const source = Object.entries(services).find(
        ([, value]) => value === service,
      )?.[0];
      assert.ok(source);
      starts.push({ source: source as Source, at: clock });
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return 'public';
    },
    {
      services,
      context: createTestContext(() => 60_000),
      intervalMs: 1000,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    },
  );
  while (pending.length || starts.length < checks.length) {
    if (pending.length) pending.shift()?.();
    await Promise.resolve();
  }
  const result = await work;
  assert.equal(maximum, 2);
  const sizuStarts = starts
    .filter(({ source }) => source === 'sizu')
    .map(({ at }) => at);
  assert.ok(
    sizuStarts.slice(1).every((at, index) => {
      const previous = sizuStarts[index];
      return previous !== undefined && at - previous >= 1000;
    }),
    JSON.stringify(starts),
  );
  assert.equal(result.statuses.size, 4);
  assert.deepEqual(result.unchecked, []);
});

test('runLinkChecks leaves never-started and interrupted checks unchecked after the global deadline', async () => {
  const controller = new AbortController();
  let remaining = 1;
  const checks: LinkCheck[] = [
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/one' },
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/two' },
  ];
  const result = await runLinkChecks(
    checks,
    async () => {
      controller.abort(new Error('global deadline'));
      remaining = 0;
      return 'defer';
    },
    {
      services,
      context: createTestContext(() => remaining, controller.signal),
      intervalMs: 1000,
      now: () => 0,
      sleep: async () => {},
    },
  );
  assert.equal(result.statuses.size, 0);
  assert.deepEqual(result.unchecked, checks);
});

test('createExecutionContext exposes a cancellable deadline signal and remaining budget', () => {
  let timer: (() => void) | undefined;
  const context = createExecutionContext({
    budgetMs: 8000,
    now: () => 100,
    setTimer: (callback) => {
      timer = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  });
  assert.equal(context.remainingMs(), 8000);
  assert.equal(context.signal.aborted, false);
  timer?.();
  assert.equal(context.signal.aborted, true);
  assert.equal(context.remainingMs(), 0);
  context.dispose();
});

test('fetchFeed rejects a failed body read instead of returning partial RSS items', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeed(services.sizu, {
      fetch: async () => {
        calls += 1;
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error('body stream failed'));
            },
          }),
        );
      },
    }),
    /body stream failed/,
  );
  assert.equal(calls, 1);
});

test('deadline abort reaches the signal passed to the active fetch', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const verification = verifyLink(
    'https://sizu.me/chihiroxx/posts/fixture',
    services.sizu,
    {
      context: createTestContext(() => 60_000, controller.signal),
      fetch: async (_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(requestSignal?.reason),
            { once: true },
          );
        });
      },
    },
  );
  await Promise.resolve();
  controller.abort(new Error('deadline'));
  assert.equal(await verification, 'defer');
  assert.equal(requestSignal?.aborted, true);
});

test('same-service redirect requests stay spaced when run through the shared scheduler', async () => {
  let clock = 0;
  const starts: number[] = [];
  const context = createExecutionContext({
    budgetMs: 30_000,
    now: () => clock,
    intervalMs: 1000,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });
  const result = await runLinkChecks(
    [
      { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/one' },
      { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/two' },
    ],
    async (url, service, execution) => {
      let redirected = false;
      return verifyLink(url, service, {
        context: execution,
        fetch: async (_input, init) => {
          assert.ok(init?.signal);
          assert.equal(init.signal.aborted, false);
          starts.push(clock);
          if (url.endsWith('/one') && !redirected) {
            redirected = true;
            return new Response(null, {
              status: 302,
              headers: { location: '/chihiroxx/posts/redirected' },
            });
          }
          return new Response(null, { status: 200 });
        },
      });
    },
    {
      services,
      context,
      intervalMs: 1000,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    },
  );
  assert.deepEqual([...result.statuses.values()], ['public', 'public']);
  assert.ok(
    starts.slice(1).every((at, index) => {
      const previous = starts[index];
      return previous !== undefined && at - previous >= 1000;
    }),
    JSON.stringify(starts),
  );
  context.dispose();
});

test('runLinkChecks wakes on the global deadline when an in-flight verifier never settles', async () => {
  const controller = new AbortController();
  let remaining = 10_000;
  const check = {
    source: 'sizu' as const,
    url: 'https://sizu.me/chihiroxx/posts/stuck',
  };
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const context = createTestContext(() => remaining, controller.signal);
  const run = runLinkChecks(
    [check],
    async () => {
      started();
      return new Promise<LinkStatus>(() => {});
    },
    { services, context },
  );
  await startedPromise;
  remaining = 0;
  controller.abort(new Error('global deadline'));
  const result = await Promise.race([
    run,
    new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 50)),
  ]);
  assert.notEqual(result, 'stuck');
  if (result === 'stuck') throw new Error('scheduler did not observe deadline');
  assert.deepEqual(result.unchecked, [check]);
});

test('runLinkChecks waits for the deadline signal when a pending start exceeds budget but work is active', async () => {
  const controller = new AbortController();
  let remaining = 500;
  let abortedAtReturn = false;
  const checks = [
    { source: 'sizu' as const, url: 'https://sizu.me/chihiroxx/posts/active' },
    { source: 'sizu' as const, url: 'https://sizu.me/chihiroxx/posts/pending' },
  ];
  const context = createTestContext(() => remaining, controller.signal);
  const run = runLinkChecks(
    checks,
    async () => new Promise<LinkStatus>(() => {}),
    {
      services,
      context,
      intervalMs: 1000,
      now: () => 0,
      sleep: async () => {},
    },
  ).finally(() => {
    abortedAtReturn = controller.signal.aborted;
  });
  setTimeout(() => {
    remaining = 0;
    controller.abort(new Error('global deadline'));
  }, 20);
  const result = await run;
  assert.equal(abortedAtReturn, true);
  assert.deepEqual(result.unchecked, checks);
});

test('runLinkChecks converts an aborting wait into unchecked items without throwing', async () => {
  const controller = new AbortController();
  let remaining = 1000;
  const checks = [
    { source: 'sizu' as const, url: 'https://sizu.me/chihiroxx/posts/one' },
    { source: 'sizu' as const, url: 'https://sizu.me/chihiroxx/posts/two' },
  ];
  const context = createTestContext(() => remaining, controller.signal);
  const resultPromise = runLinkChecks(
    checks,
    async () => new Promise<LinkStatus>(() => {}),
    {
      services,
      context,
      intervalMs: 1000,
      now: () => 0,
      sleep: async (_milliseconds, signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    },
  );
  setTimeout(() => {
    remaining = 0;
    controller.abort(new Error('global deadline'));
  }, 20);
  const result = await resultPromise;
  assert.deepEqual(result.unchecked, checks);
});

test('verifyLink reports an expired global deadline as defer and malformed targets as review', async () => {
  const controller = new AbortController();
  controller.abort(new Error('deadline'));
  const context = createTestContext(() => 0, controller.signal);
  assert.equal(
    await verifyLink('https://sizu.me/chihiroxx/posts/one', services.sizu, {
      context,
      fetch: async () => new Response(null, { status: 200 }),
    }),
    'defer',
  );
  assert.equal(
    await verifyLink('https://example.com/login', services.sizu, {
      context: createTestContext(() => 60_000),
      fetch: async () => new Response(null, { status: 200 }),
    }),
    'review',
  );
});

test('fetchFeed keeps every retry request inside the service interval after Retry-After', async () => {
  let clock = 0;
  const starts: number[] = [];
  const context = createExecutionContext({
    budgetMs: 10_000,
    now: () => clock,
    intervalMs: 1000,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });
  let attempt = 0;
  await fetchFeed(services.sizu, {
    context,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    fetch: async () => {
      starts.push(clock);
      attempt += 1;
      return attempt === 1
        ? new Response('busy', {
            status: 503,
            headers: { 'retry-after': '0.5' },
          })
        : new Response(feedFixtures[0][3]);
    },
  });
  context.dispose();
  assert.deepEqual(starts, [0, 1000]);
});

test('verifyLink cancels bodies for redirects and each terminal HTTP status', async () => {
  let canceled = 0;
  const response = (status: number, headers?: HeadersInit) =>
    new Response(
      new ReadableStream({
        cancel() {
          canceled += 1;
        },
      }),
      { status, headers },
    );
  const statuses = [302, 404, 403, 400] as const;
  const expected = ['review', 'deleted', 'defer', 'review'] as const;
  for (const [index, status] of statuses.entries()) {
    assert.equal(
      await verifyLink('https://sizu.me/chihiroxx/posts/one', services.sizu, {
        fetch: async () =>
          response(
            status,
            status === 302
              ? { location: 'https://example.com/elsewhere' }
              : undefined,
          ),
      }),
      expected[index],
    );
  }
  assert.equal(canceled, 4);
});
