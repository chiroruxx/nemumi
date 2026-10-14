import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRepositoryFile,
  canonicalUrl,
  fetchFeed,
  isSource,
  services,
  verifyLink,
} from '../scripts/lib/external-content.ts';

const feedXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Fixture</title><link>https://sizu.me</link><description>Fixture feed</description>
  <item><title>  A &amp; B  </title><link>https://sizu.me/chihiroxx/posts/example#section</link><pubDate>Fri, 02 Oct 2026 16:30:00 GMT</pubDate></item>
</channel></rss>`;

async function withFetch<T>(
  response: Response,
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('canonical URLs drop fragments but preserve query strings', () => {
  assert.equal(
    canonicalUrl('https://example.com/article?ref=feed#section'),
    'https://example.com/article?ref=feed',
  );
});

test('source validation accepts configured services only', () => {
  assert.equal(isSource('sizu'), true);
  assert.equal(isSource('unknown'), false);
  assert.equal(isSource(undefined), false);
});

test('repository file validation accepts content paths and rejects paths outside the content directory', () => {
  assert.doesNotThrow(() =>
    assertRepositoryFile(
      '/repo/src/content/articles/post.yaml',
      '/repo/src/content',
    ),
  );
  assert.throws(
    () => assertRepositoryFile('/repo/src/secret.yaml', '/repo/src/content'),
    /outside src\/content/,
  );
});

test('feed parsing trims titles and converts publication time to Tokyo date', async () => {
  await withFetch(new Response(feedXml), async () => {
    assert.deepEqual(await fetchFeed(services.sizu), [
      {
        date: '2026-10-03',
        title: 'A & B',
        url: 'https://sizu.me/chihiroxx/posts/example',
      },
    ]);
  });
});

test('feed parsing rejects links outside the configured service path', async () => {
  const invalidFeed = feedXml.replace(
    'https://sizu.me/chihiroxx/posts/example#section',
    'https://example.com/not-an-sizu-post',
  );
  await withFetch(new Response(invalidFeed), async () => {
    await assert.rejects(fetchFeed(services.sizu), /Unexpected .* content URL/);
  });
});

test('link verification distinguishes deleted pages, access restrictions, and off-site redirects', async () => {
  await withFetch(new Response(null, { status: 404 }), async () => {
    assert.equal(
      await verifyLink(
        'https://sizu.me/chihiroxx/posts/missing',
        services.sizu,
      ),
      'deleted',
    );
  });
  await withFetch(new Response(null, { status: 403 }), async () => {
    assert.equal(
      await verifyLink(
        'https://sizu.me/chihiroxx/posts/private',
        services.sizu,
      ),
      'defer',
    );
  });
  await withFetch(
    new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/moved' },
    }),
    async () => {
      assert.equal(
        await verifyLink(
          'https://sizu.me/chihiroxx/posts/moved',
          services.sizu,
        ),
        'review',
      );
    },
  );
});

test('link verification follows relative redirects only to content in the same account', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: '/chihiroxx/posts/new' },
    }),
    new Response(null, { status: 200 }),
  ];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    const response = responses.shift();
    assert.ok(response);
    return response;
  };
  try {
    assert.equal(
      await verifyLink('https://sizu.me/chihiroxx/posts/old', services.sizu),
      'public',
    );
    assert.deepEqual(requests, [
      'https://sizu.me/chihiroxx/posts/old',
      'https://sizu.me/chihiroxx/posts/new',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('link verification reviews redirects to login, top, another account, or another host', async () => {
  for (const location of [
    '/login',
    '/',
    '/other-account/posts/post',
    'http://sizu.me/chihiroxx/posts/post',
    'https://user:password@sizu.me/chihiroxx/posts/post',
    'https://example.com/chihiroxx/posts/post',
  ]) {
    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location } });
    };
    try {
      assert.equal(
        await verifyLink('https://sizu.me/chihiroxx/posts/post', services.sizu),
        'review',
        location,
      );
      assert.equal(requests, 1, location);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('link verification reviews credentialed, insecure, looping, and excessive redirect targets safely', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(null, {
      status: 302,
      headers: { location: '/chihiroxx/posts/post' },
    });
  };
  try {
    assert.equal(
      await verifyLink(
        'https://user:password@sizu.me/chihiroxx/posts/post',
        services.sizu,
      ),
      'review',
    );
    assert.equal(requests, 0);
    assert.equal(
      await verifyLink('http://sizu.me/chihiroxx/posts/post', services.sizu),
      'review',
    );
    assert.equal(requests, 0);
    assert.equal(
      await verifyLink('https://sizu.me/chihiroxx/posts/post', services.sizu),
      'review',
    );
    assert.equal(requests, 1);

    requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      if (requests === 6) return new Response(null, { status: 200 });
      return new Response(null, {
        status: 302,
        headers: { location: `/chihiroxx/posts/post-${requests}` },
      });
    };
    assert.equal(
      await verifyLink('https://sizu.me/chihiroxx/posts/post', services.sizu),
      'public',
      'five redirects followed by a public response are allowed',
    );
    assert.equal(requests, 6);

    requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `/chihiroxx/posts/post-${requests}` },
      });
    };
    assert.equal(
      await verifyLink('https://sizu.me/chihiroxx/posts/post', services.sizu),
      'review',
      'a sixth redirect exceeds the limit',
    );
    assert.equal(requests, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
