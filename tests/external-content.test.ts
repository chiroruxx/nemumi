import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSource,
  getService,
  isSource,
  type Service,
  validateContentUrl,
} from '../scripts/lib/external-content.ts';

test('isSource accepts configured services only', () => {
  for (const source of ['sizu', 'hatena', 'speakerdeck']) {
    assert.equal(isSource(source), true);
  }
  for (const source of ['', 'Sizu', 'toString', '__proto__']) {
    assert.equal(isSource(source), false);
  }
  assert.equal(isSource('unknown'), false);
  assert.equal(isSource(undefined), false);
});

test('getService returns configured service settings', () => {
  assert.deepEqual(getService('sizu'), {
    label: 'しずかなインターネット',
    feed: 'https://sizu.me/chihiroxx/rss',
    collection: 'articles',
    type: '日常記事',
    host: 'sizu.me',
    pathPrefix: '/chihiroxx/posts/',
  });
  assert.equal(getService('hatena').feed, 'https://toyo.hatenablog.jp/rss');
  assert.equal(getService('speakerdeck').collection, 'talks');
});

test('getService rejects unconfigured sources', () => {
  for (const source of ['unknown', 'toString', '__proto__']) {
    assert.throws(
      () => getService(source as Parameters<typeof getService>[0]),
      /Unknown service/,
    );
  }
});

test('findSource matches URL host, account path, and collection', () => {
  const cases = [
    ['https://sizu.me/chihiroxx/posts/one?ref=rss#section', 'articles', 'sizu'],
    ['https://toyo.hatenablog.jp/entry/one', 'articles', 'hatena'],
    ['https://speakerdeck.com/chiroruxx/one', 'talks', 'speakerdeck'],
    ['http://sizu.me/chihiroxx/posts/one', 'articles', 'sizu'],
    ['https://sizu.me/other/posts/one', 'articles', undefined],
    ['https://sizu.me/chihiroxx/', 'articles', undefined],
    ['https://example.com/chihiroxx/posts/one', 'articles', undefined],
    ['https://sizu.me/chihiroxx/posts/one', 'talks', undefined],
    ['https://speakerdeck.com/chiroruxx/one', 'articles', undefined],
  ] as const;
  for (const [url, collection, source] of cases) {
    const parsed = new URL(url);
    assert.equal(findSource(parsed, collection), source);
    assert.equal(parsed.href, url);
  }
});

test('validateContentUrl applies HTTPS, account, host, and credential policy without changing the URL', () => {
  const accepted = [
    'https://sizu.me/chihiroxx/posts/one?ref=feed#section',
    'https://toyo.hatenablog.jp/entry/one?ref=feed#section',
  ];
  for (const input of accepted) {
    const service = input.includes('sizu.me')
      ? getService('sizu')
      : getService('hatena');
    const url = new URL(input);
    assert.equal(validateContentUrl(url, service), undefined);
    assert.equal(url.href, input);
  }

  const rejected = [
    'http://sizu.me/chihiroxx/posts/one',
    'https://sizu.me:8443/chihiroxx/posts/one',
    'https://user@sizu.me/chihiroxx/posts/one',
    'https://sizu.me/login',
    'https://sizu.me/chihiroxx/',
    'https://other.example/chihiroxx/posts/one',
    'https://sizu.me/other-account/posts/one',
  ];
  for (const input of rejected) {
    assert.throws(
      () => validateContentUrl(new URL(input), getService('sizu')),
      /Unexpected/,
    );
  }
});

test('validateContentUrl rejects mismatched service settings and accepts equivalent settings', () => {
  const service = getService('sizu');
  const url = new URL('https://sizu.me/chihiroxx/posts/one');
  assert.doesNotThrow(() => validateContentUrl(url, { ...service }));
  for (const overrides of [
    { pathPrefix: '/chihiroxx/' },
    { collection: 'talks' },
    { host: 'example.com' },
  ]) {
    assert.throws(
      () => validateContentUrl(url, { ...service, ...overrides } as Service),
      /Unexpected .* content URL/,
    );
  }
});
