import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../src/pages/robots.txt.ts';

test('robots route includes the configured sitemap URL and a text content type', async () => {
  const response = await GET({
    site: new URL('https://example.com/'),
  } as Parameters<typeof GET>[0]);
  assert.equal(
    response.headers.get('Content-Type'),
    'text/plain; charset=utf-8',
  );
  assert.equal(
    await response.text(),
    'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap-index.xml\n',
  );
});

test('robots route rejects a missing site URL', () => {
  assert.throws(
    () => GET({ site: undefined } as Parameters<typeof GET>[0]),
    /site URL must be configured/,
  );
});
