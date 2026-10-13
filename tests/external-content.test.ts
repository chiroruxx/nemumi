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
