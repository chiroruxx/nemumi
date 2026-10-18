import assert from 'node:assert/strict';
import test from 'node:test';
import { isHTTPError, isResponseSizeError, isTimeoutError } from 'ky';
import {
  findSource,
  getService,
  type LinkCheck,
  type LinkStatus,
  type Service,
} from '../scripts/lib/external-content.ts';
import {
  createExecutionContext,
  type ExecutionContext,
  fetchFeed,
  runLinkChecks,
  verifyLink,
} from '../scripts/lib/external-content-http.ts';

const feedFixtures: [Service, string, string, string][] = [
  [
    getService('sizu'),
    'https://sizu.me/chihiroxx/posts/fixture#fragment',
    'https://sizu.me/chihiroxx/posts/fixture',
    '<rss version="2.0"><channel><item><title> Sizu &amp; fixture </title><link>https://sizu.me/chihiroxx/posts/fixture#fragment</link><pubDate>Mon, 12 Oct 2026 18:20:00 GMT</pubDate></item></channel></rss>',
  ],
  [
    getService('hatena'),
    'https://toyo.hatenablog.jp/entry/fixture?from=rss',
    'https://toyo.hatenablog.jp/entry/fixture?from=rss',
    '<rss version="2.0"><channel><item><title> Hatena &amp; fixture </title><link>https://toyo.hatenablog.jp/entry/fixture?from=rss</link><pubDate>Mon, 12 Oct 2026 18:20:00 GMT</pubDate></item></channel></rss>',
  ],
  [
    getService('speakerdeck'),
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

test('fetchFeed allows automatic redirects and maps all service fixtures to normalized feed items without network access', async () => {
  for (const [service, , normalizedUrl, xml] of feedFixtures) {
    const source = findSource(new URL(normalizedUrl), service.collection);
    assert.ok(source);
    const parsed = await fetchFeed(service, {
      fetch: async (input, init) => {
        assert.equal(new Request(input, init).redirect, 'follow');
        return new Response(xml);
      },
    });
    assert.deepEqual(parsed, [
      {
        date: new Date('2026-10-13'),
        title: `${service === getService('sizu') ? 'Sizu' : service === getService('hatena') ? 'Hatena' : 'Speaker Deck'} & fixture`,
        url: normalizedUrl,
      },
    ]);
  }
});

test('fetchFeed rejects RSS item URLs outside the configured service path', async () => {
  const invalidFeed = feedFixtures[0][3].replace(
    'https://sizu.me/chihiroxx/posts/fixture#fragment',
    'https://example.com/not-an-sizu-post',
  );
  await assert.rejects(
    fetchFeed(getService('sizu'), {
      fetch: async () => new Response(invalidFeed),
    }),
    /Unexpected .* content URL/,
  );
});

test('fetchFeed retries network failures and server errors using Ky', async () => {
  let calls = 0;
  const result = await fetchFeed(getService('sizu'), {
    fetch: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      if (calls === 2)
        return new Response('busy', {
          status: 503,
          headers: { 'retry-after': '0' },
        });
      return new Response(feedFixtures[0][3]);
    },
  });
  assert.equal(calls, 3);
  assert.equal(result[0]?.title, 'Sizu & fixture');
});

test('fetchFeed stops after two retries and exposes the Ky HTTP error', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeed(getService('sizu'), {
      fetch: async () => {
        calls += 1;
        return new Response('busy', {
          status: 503,
          headers: { 'retry-after': '0' },
        });
      },
    }),
    (error: unknown) => isHTTPError(error) && error.response.status === 503,
  );
  assert.equal(calls, 3);
});

test('fetchFeed retries rate limiting with an HTTP date and rejects malformed RSS without partial output', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeed(getService('sizu'), {
      fetch: async () => {
        calls += 1;
        if (calls === 1)
          return new Response('busy', {
            status: 429,
            headers: { 'retry-after': new Date(0).toUTCString() },
          });
        return new Response('<rss><channel><item><title>broken');
      },
    }),
    /RSS|XML|feed|Unclosed/i,
  );
  assert.equal(calls, 2);
});

test('fetchFeed rejects failed responses and enforces the byte limit', async () => {
  for (const status of [404, 501]) {
    const requests: string[] = [];
    await assert.rejects(
      fetchFeed(getService('sizu'), {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request.url);
          return new Response('', { status });
        },
      }),
      (error: unknown) =>
        isHTTPError(error) && error.response.status === status,
    );
    assert.deepEqual(requests, [getService('sizu').feed]);
  }
  for (const headers of [{}, { 'content-length': '1' }]) {
    await assert.rejects(
      fetchFeed(getService('sizu'), {
        fetch: async () =>
          new Response('x'.repeat(5 * 1024 * 1024 + 1), { headers }),
      }),
      isResponseSizeError,
    );
  }
  const parsed = await fetchFeed(getService('sizu'), {
    fetch: async () =>
      new Response(feedFixtures[0][3], {
        headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
      }),
  });
  assert.equal(parsed[0]?.title, 'Sizu & fixture');
});

test('verifyLink uses HEAD and passes the execution signal to fetch', async () => {
  const controller = new AbortController();
  const requests: string[] = [];
  const passedSignals: AbortSignal[] = [];
  const status = await verifyLink(
    new URL('https://sizu.me/chihiroxx/posts/fixture'),
    getService('sizu'),
    {
      context: createTestContext(() => 60_000, controller.signal),
      fetch: async (input, init) => {
        requests.push(input instanceof Request ? input.url : String(input));
        const request = new Request(input, init);
        assert.equal(request.method, 'HEAD');
        passedSignals.push(request.signal);
        return new Response(null, { status: 200 });
      },
    },
  );
  assert.equal(status, 'public');
  assert.deepEqual(requests, ['https://sizu.me/chihiroxx/posts/fixture']);
  assert.equal(passedSignals.length, 1);
  assert.ok(passedSignals.every((signal) => !signal.aborted));
});

test('runLinkChecks completes batches of five before waiting one second, without a final wait', async (t) => {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const checks: LinkCheck[] = Array.from({ length: 11 }, (_, index) => ({
    source: 'sizu',
    url: new URL(`https://sizu.me/chihiroxx/posts/${index}`),
  }));
  const started: string[] = [];
  const pending: (() => void)[] = [];
  const waits: number[] = [];
  let resumeWait!: () => void;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const work = runLinkChecks(
    checks,
    async (url) => {
      started.push(url.href);
      await new Promise<void>((resolve) => pending.push(resolve));
      return 'public';
    },
    {
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
    checks.slice(0, 5).map(({ url }) => url.href),
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
  const withoutInjectedSleep = await runLinkChecks(
    checks,
    async () => 'public',
    {
      context: createTestContext(() => 60_000, controller.signal),
      batchIntervalMs: 0,
    },
  );
  assert.equal(withoutInjectedSleep.statuses.size, checks.length);
  assert.deepEqual(withoutInjectedSleep.unchecked, []);
});

test('runLinkChecks leaves never-started and interrupted checks unchecked after the global deadline', async () => {
  const controller = new AbortController();
  let remaining = 1;
  const checks: LinkCheck[] = [
    { source: 'sizu', url: new URL('https://sizu.me/chihiroxx/posts/one') },
    { source: 'sizu', url: new URL('https://sizu.me/chihiroxx/posts/two') },
  ];
  const result = await runLinkChecks(
    checks,
    async () => {
      controller.abort(new Error('global deadline'));
      remaining = 0;
      return 'unverified';
    },
    {
      context: createTestContext(() => remaining, controller.signal),
      sleep: async () => {},
    },
  );
  assert.equal(result.statuses.size, 0);
  assert.deepEqual(result.unchecked, checks);
});

test('createExecutionContext exposes a cancellable deadline signal and remaining budget', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100 });
  const context = createExecutionContext({ budgetMs: 8000 });
  assert.equal(context.remainingMs(), 8000);
  assert.equal(context.signal.aborted, false);
  t.mock.timers.tick(7999);
  assert.equal(context.remainingMs(), 1);
  assert.equal(context.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(context.signal.aborted, true);
  assert.equal(context.signal.reason.name, 'TimeoutError');
  assert.equal(context.remainingMs(), 0);
  context.dispose();

  const disposed = createExecutionContext({ budgetMs: 100 });
  disposed.dispose();
  t.mock.timers.tick(100);
  assert.equal(disposed.signal.aborted, false);
});

test('fetchFeed rejects a failed body read instead of returning partial RSS items', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeed(getService('sizu'), {
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

test('fetchFeed uses Ky default timeouts and cancels retry waits at the execution deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const phase of ['headers', 'body'] as const) {
    let calls = 0;
    const failure = assert.rejects(
      fetchFeed(getService('sizu'), {
        fetch: async () => {
          calls += 1;
          return phase === 'headers'
            ? new Promise<Response>(() => {})
            : new Response(new ReadableStream());
        },
      }),
      isTimeoutError,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(10_000);
    await failure;
    assert.equal(calls, 1);
  }
  t.mock.timers.reset();

  const context = createExecutionContext({ budgetMs: 20 });
  let calls = 0;
  try {
    await assert.rejects(
      fetchFeed(getService('sizu'), {
        context,
        fetch: async () => {
          calls += 1;
          return new Response('busy', {
            status: 503,
            headers: { 'retry-after': '10' },
          });
        },
      }),
      { name: 'TimeoutError' },
    );
    assert.equal(context.signal.aborted, true);
    assert.equal(calls, 1);
  } finally {
    context.dispose();
  }
});

test('deadline abort reaches the signal passed to the active fetch', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const started = Promise.withResolvers<void>();
  const verification = verifyLink(
    new URL('https://sizu.me/chihiroxx/posts/fixture'),
    getService('sizu'),
    {
      context: createTestContext(() => 60_000, controller.signal),
      fetch: async (input, init) => {
        requestSignal = new Request(input, init).signal;
        started.resolve();
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
  await started.promise;
  controller.abort(new Error('deadline'));
  assert.equal(await verification, 'unverified');
  assert.equal(requestSignal?.aborted, true);
});

test('runLinkChecks leaves canceled verification unchecked at the deadline', async () => {
  const controller = new AbortController();
  let remaining = 10_000;
  const check = {
    source: 'sizu' as const,
    url: new URL('https://sizu.me/chihiroxx/posts/canceled'),
  };
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const context = createTestContext(() => remaining, controller.signal);
  const run = runLinkChecks(
    [check],
    async (_url, _service, execution) => {
      execution.signal.throwIfAborted();
      return new Promise<LinkStatus>((_resolve, reject) => {
        execution.signal.addEventListener(
          'abort',
          () => reject(execution.signal.reason),
          { once: true },
        );
        started();
      });
    },
    { context },
  );
  await startedPromise;
  remaining = 0;
  controller.abort(new Error('global deadline'));
  const result = await run;
  assert.equal(result.statuses.size, 0);
  assert.deepEqual(result.unchecked, [check]);
});

test('runLinkChecks preserves completed results and leaves later batches unchecked when a wait aborts', async () => {
  for (const useDefaultSleep of [false, true]) {
    const controller = new AbortController();
    const checks: LinkCheck[] = Array.from({ length: 6 }, (_, index) => ({
      source: 'sizu',
      url: new URL(`https://sizu.me/chihiroxx/posts/${index}`),
    }));
    let calls = 0;
    const result = await runLinkChecks(
      checks,
      async () => {
        calls += 1;
        if (useDefaultSleep && calls === 5) {
          setImmediate(() => controller.abort(new Error('deadline')));
        }
        return 'public';
      },
      {
        context: createTestContext(() => 60_000, controller.signal),
        ...(useDefaultSleep
          ? {}
          : {
              sleep: async (_milliseconds: number, signal?: AbortSignal) => {
                controller.abort(new Error('deadline'));
                throw signal?.reason;
              },
            }),
      },
    );
    assert.equal(calls, 5);
    assert.equal(result.statuses.size, 5);
    assert.deepEqual(result.unchecked, checks.slice(5));
  }
});

test('runLinkChecks converts thrown and rejected checks to unverified without stopping the batch', async () => {
  const checks: LinkCheck[] = Array.from({ length: 3 }, (_, index) => ({
    source: 'sizu',
    url: new URL(`https://sizu.me/chihiroxx/posts/${index}`),
  }));
  const result = await runLinkChecks(
    checks,
    (url) => {
      if (url.href.endsWith('/0')) throw new Error('synchronous failure');
      if (url.href.endsWith('/1'))
        return Promise.reject(new Error('async failure'));
      return Promise.resolve('public');
    },
    { context: createTestContext(() => 60_000) },
  );
  assert.deepEqual(
    checks.map(({ url }) => result.statuses.get(url.href)),
    ['unverified', 'unverified', 'public'],
  );
  assert.deepEqual(result.unchecked, []);
});

test('runLinkChecks skips expired work and does not wait when the next batch cannot fit', async () => {
  const checks: LinkCheck[] = Array.from({ length: 6 }, (_, index) => ({
    source: 'sizu',
    url: new URL(`https://sizu.me/chihiroxx/posts/${index}`),
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

test('verifyLink reports an expired global deadline and malformed targets as unverified', async () => {
  const controller = new AbortController();
  controller.abort(new Error('deadline'));
  const context = createTestContext(() => 0, controller.signal);
  assert.equal(
    await verifyLink(
      new URL('https://sizu.me/chihiroxx/posts/one'),
      getService('sizu'),
      {
        context,
        fetch: async () => new Response(null, { status: 200 }),
      },
    ),
    'unverified',
  );
  for (const value of [
    'https://example.com/login',
    'http://sizu.me/chihiroxx/posts/post',
    'https://user:password@sizu.me/chihiroxx/posts/post',
  ]) {
    assert.equal(
      await verifyLink(new URL(value), getService('sizu'), {
        context: createTestContext(() => 60_000),
        fetch: async () =>
          assert.fail('Invalid input URLs must not be fetched'),
      }),
      'unverified',
    );
  }
});

test('verifyLink classifies HEAD statuses and retries network failures with Ky defaults', async (t) => {
  const response = (status: number, headers?: HeadersInit) =>
    new Response(null, {
      status,
      ...(headers === undefined ? {} : { headers }),
    });
  const methods: string[] = [];
  const statuses = [302, 404, 410, 401, 403, 429, 500, 503, 400] as const;
  const expected = [
    'public',
    'deleted',
    'deleted',
    'unverified',
    'unverified',
    'unverified',
    'unverified',
    'unverified',
    'unverified',
  ] as const;
  for (const [index, status] of statuses.entries()) {
    assert.equal(
      await verifyLink(
        new URL('https://sizu.me/chihiroxx/posts/one'),
        getService('sizu'),
        {
          fetch: async (input, init) => {
            methods.push(new Request(input, init).method);
            return response(
              status,
              status === 302
                ? { location: 'https://example.com/elsewhere' }
                : undefined,
            );
          },
        },
      ),
      expected[index],
    );
  }
  assert.deepEqual(
    methods,
    statuses.map(() => 'HEAD'),
  );
  let calls = 0;
  assert.equal(
    await verifyLink(
      new URL('https://sizu.me/chihiroxx/posts/one'),
      getService('sizu'),
      {
        fetch: async () => {
          calls += 1;
          throw new TypeError('fetch failed');
        },
      },
    ),
    'unverified',
  );
  assert.equal(calls, 3);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  calls = 0;
  const verification = verifyLink(
    new URL('https://sizu.me/chihiroxx/posts/one'),
    getService('sizu'),
    {
      fetch: async () => {
        calls += 1;
        return new Promise<Response>(() => {});
      },
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10_000);
  assert.equal(await verification, 'unverified');
  assert.equal(calls, 1);
});

test('verifyLink treats redirects as public without requesting any destination', async () => {
  const source = 'https://sizu.me/chihiroxx/posts/post';
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of [
      undefined,
      '/login',
      '/',
      '/other-account/posts/post',
      source,
      'http://sizu.me/chihiroxx/posts/post',
      'https://user:password@sizu.me/chihiroxx/posts/post',
      'https://example.com/deleted',
      'https://[invalid',
    ]) {
      const requests: string[] = [];
      const result = await verifyLink(new URL(source), getService('sizu'), {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push(request.url);
          assert.equal(request.method, 'HEAD');
          assert.equal(request.redirect, 'manual');
          return new Response(null, {
            status,
            ...(location === undefined ? {} : { headers: { location } }),
          });
        },
      });
      assert.equal(result, 'public');
      assert.deepEqual(requests, [source]);
    }
  }
});

test('verifyLink accepts a URL with query parameters and a fragment without modifying it', async () => {
  const requested: string[] = [];
  const value = new URL('https://sizu.me/chihiroxx/posts/one?ref=feed#section');
  assert.equal(
    await verifyLink(value, getService('sizu'), {
      fetch: async (input) => {
        requested.push(input instanceof Request ? input.url : String(input));
        return new Response(null, { status: 200 });
      },
    }),
    'public',
  );
  assert.deepEqual(requested, [value.href]);
  assert.equal(
    value.href,
    'https://sizu.me/chihiroxx/posts/one?ref=feed#section',
  );
});
