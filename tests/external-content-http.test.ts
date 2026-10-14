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

test('parseFeedXml maps all service fixtures to site dates and normalized feed items without network access', async () => {
  for (const [service, , normalizedUrl, xml] of feedFixtures) {
    const source = Object.entries(services).find(
      ([, value]) => value === service,
    )?.[0];
    assert.ok(source);
    const parsed = await parseFeedXml(xml, service);
    assert.deepEqual(parsed, [
      {
        date: new Date('2026-10-13'),
        title: `${service === services.sizu ? 'Sizu' : service === services.hatena ? 'Hatena' : 'Speaker Deck'} & fixture`,
        url: normalizedUrl,
      },
    ]);
  }
});

test('parseFeedXml rejects RSS item URLs outside the configured service path', async () => {
  const invalidFeed = feedFixtures[0][3].replace(
    'https://sizu.me/chihiroxx/posts/fixture#fragment',
    'https://example.com/not-an-sizu-post',
  );
  await assert.rejects(
    parseFeedXml(invalidFeed, services.sizu),
    /Unexpected .* content URL/,
  );
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

test('runLinkChecks completes batches of five before waiting one second, without a final wait', async (t) => {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const checks: LinkCheck[] = Array.from({ length: 11 }, (_, index) => ({
    source: 'sizu',
    url: `https://sizu.me/chihiroxx/posts/${index}`,
  }));
  const started: string[] = [];
  const pending: (() => void)[] = [];
  const waits: number[] = [];
  let resumeWait!: () => void;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const work = runLinkChecks(
    checks,
    async (url) => {
      started.push(url);
      await new Promise<void>((resolve) => pending.push(resolve));
      return 'public';
    },
    {
      services,
      context: createTestContext(() => 60_000, controller.signal),
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        await new Promise<void>((resolve) => {
          resumeWait = resolve;
        });
      },
    },
  );
  await tick();
  assert.deepEqual(
    started,
    checks.slice(0, 5).map(({ url }) => url),
  );
  pending.splice(0, 4).forEach((resolve) => {
    resolve();
  });
  await tick();
  assert.deepEqual(waits, []);
  assert.equal(started.length, 5);
  pending.shift()?.();
  await tick();
  assert.deepEqual(waits, [1000]);
  assert.equal(started.length, 5);
  resumeWait();
  await tick();
  assert.equal(started.length, 10);
  pending.splice(0).forEach((resolve) => {
    resolve();
  });
  await tick();
  assert.deepEqual(waits, [1000, 1000]);
  assert.equal(started.length, 10);
  resumeWait();
  await tick();
  assert.equal(started.length, 11);
  pending.shift()?.();
  const result = await work;
  assert.equal(result.statuses.size, 11);
  assert.deepEqual(result.unchecked, []);
  assert.deepEqual(waits, [1000, 1000]);
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

test('link batches include redirects without per-request spacing', async (t) => {
  const context = createExecutionContext();
  t.after(() => context.dispose());
  const requests: string[] = [];
  const waits: number[] = [];
  const checks: LinkCheck[] = [
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/one' },
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/two' },
  ];
  const result = await runLinkChecks(
    checks,
    (url, service, execution) =>
      verifyLink(url, service, {
        context: execution,
        fetch: async (input) => {
          const target = String(input);
          requests.push(target);
          return target.endsWith('/one')
            ? new Response(null, {
                status: 302,
                headers: { location: '/chihiroxx/posts/redirected' },
              })
            : new Response(null, { status: 200 });
        },
      }),
    {
      services,
      context,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    },
  );
  assert.equal(requests.length, 3);
  assert.ok(requests.includes('https://sizu.me/chihiroxx/posts/redirected'));
  assert.deepEqual([...result.statuses.values()], ['public', 'public']);
  assert.deepEqual(waits, []);
});

test('runLinkChecks returns at the deadline and ignores a verifier that settles later', async () => {
  const controller = new AbortController();
  let remaining = 10_000;
  const check = {
    source: 'sizu' as const,
    url: 'https://sizu.me/chihiroxx/posts/stuck',
  };
  let finish!: (status: LinkStatus) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const context = createTestContext(() => remaining, controller.signal);
  const run = runLinkChecks(
    [check],
    async () => {
      started();
      return new Promise<LinkStatus>((resolve) => {
        finish = resolve;
      });
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
  finish('deleted');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(result.statuses.size, 0);
  assert.deepEqual(result.unchecked, [check]);
});

test('runLinkChecks preserves completed results and leaves later batches unchecked when a wait aborts', async () => {
  const controller = new AbortController();
  const checks: LinkCheck[] = Array.from({ length: 6 }, (_, index) => ({
    source: 'sizu',
    url: `https://sizu.me/chihiroxx/posts/${index}`,
  }));
  let calls = 0;
  const result = await runLinkChecks(
    checks,
    async () => {
      calls += 1;
      return 'public';
    },
    {
      services,
      context: createTestContext(() => 60_000, controller.signal),
      sleep: async (_milliseconds, signal) => {
        controller.abort(new Error('deadline'));
        throw signal?.reason;
      },
    },
  );
  assert.equal(calls, 5);
  assert.equal(result.statuses.size, 5);
  assert.deepEqual(result.unchecked, checks.slice(5));
});

test('runLinkChecks converts thrown and rejected checks to defer without stopping the batch', async () => {
  const checks: LinkCheck[] = Array.from({ length: 3 }, (_, index) => ({
    source: 'sizu',
    url: `https://sizu.me/chihiroxx/posts/${index}`,
  }));
  const result = await runLinkChecks(
    checks,
    (url) => {
      if (url.endsWith('/0')) throw new Error('synchronous failure');
      if (url.endsWith('/1')) return Promise.reject(new Error('async failure'));
      return Promise.resolve('public');
    },
    { services, context: createTestContext(() => 60_000) },
  );
  assert.deepEqual(
    checks.map(({ url }) => result.statuses.get(url)),
    ['defer', 'defer', 'public'],
  );
  assert.deepEqual(result.unchecked, []);
});

test('runLinkChecks skips expired work and does not wait when the next batch cannot fit', async () => {
  const checks: LinkCheck[] = Array.from({ length: 6 }, (_, index) => ({
    source: 'sizu',
    url: `https://sizu.me/chihiroxx/posts/${index}`,
  }));
  for (const remaining of [0, 500]) {
    let calls = 0;
    const result = await runLinkChecks(
      checks,
      async () => {
        calls += 1;
        return 'public';
      },
      {
        services,
        context: createTestContext(() => remaining),
        sleep: async () => {
          assert.fail('insufficient time for a batch interval');
        },
      },
    );
    const completed = remaining === 0 ? 0 : 5;
    assert.equal(calls, completed);
    assert.equal(result.statuses.size, completed);
    assert.deepEqual(result.unchecked, checks.slice(completed));
  }
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

test('fetchFeed retries using Retry-After without adding a service interval', async () => {
  let clock = 0;
  const starts: number[] = [];
  const context = createExecutionContext({
    budgetMs: 10_000,
    now: () => clock,
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
  assert.deepEqual(starts, [0, 500]);
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

test('verifyLink reviews unsafe redirect destinations without fetching them', async () => {
  const cases = [
    {
      url: 'https://sizu.me/chihiroxx/posts/post',
      location: '/login',
      requests: 1,
    },
    {
      url: 'https://sizu.me/chihiroxx/posts/post',
      location: '/',
      requests: 1,
    },
    {
      url: 'https://sizu.me/chihiroxx/posts/post',
      location: '/other-account/posts/post',
      requests: 1,
    },
    {
      url: 'https://sizu.me/chihiroxx/posts/post',
      location: 'http://sizu.me/chihiroxx/posts/post',
      requests: 1,
    },
    {
      url: 'https://sizu.me/chihiroxx/posts/post',
      location: 'https://user:password@sizu.me/chihiroxx/posts/post',
      requests: 1,
    },
    {
      url: 'https://sizu.me/chihiroxx/posts/post',
      location: 'https://example.com/chihiroxx/posts/post',
      requests: 1,
    },
    {
      url: 'http://sizu.me/chihiroxx/posts/post',
      location: undefined,
      requests: 0,
    },
    {
      url: 'https://user:password@sizu.me/chihiroxx/posts/post',
      location: undefined,
      requests: 0,
    },
  ] as const;
  for (const { url, location, requests: expectedRequests } of cases) {
    let requests = 0;
    const status = await verifyLink(url, services.sizu, {
      fetch: async () => {
        requests += 1;
        return new Response(null, {
          status: location ? 302 : 200,
          ...(location ? { headers: { location } } : {}),
        });
      },
    });
    assert.equal(status, 'review', url);
    assert.equal(requests, expectedRequests, url);
  }
});

test('verifyLink reviews redirect loops and allows five redirects but rejects a sixth', async () => {
  let requests = 0;
  const request = (redirects: number) =>
    verifyLink('https://sizu.me/chihiroxx/posts/start', services.sizu, {
      fetch: async () => {
        requests += 1;
        if (redirects > 0 && requests > redirects) {
          return new Response(null, { status: 200 });
        }
        return new Response(null, {
          status: 302,
          headers: {
            location:
              redirects === 0
                ? '/chihiroxx/posts/start'
                : `/chihiroxx/posts/step-${requests}`,
          },
        });
      },
    });
  assert.equal(await request(0), 'review');
  assert.equal(requests, 1);
  for (const [redirects, expected] of [
    [5, 'public'],
    [6, 'review'],
  ] as const) {
    requests = 0;
    assert.equal(await request(redirects), expected, `${redirects} redirects`);
    assert.equal(requests, 6);
  }
});
