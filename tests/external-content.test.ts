import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCollectionIndex,
  getService,
  isSource,
  type Service,
  type StoredEntry,
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

function storedEntry(
  id: string,
  date: string,
  title: string,
  url: string,
  types?: string[],
): StoredEntry {
  return {
    file: `/repo/src/content/articles/${id}`,
    id,
    data: {
      date: new Date(date),
      title,
      url: new URL(url),
      ...(types ? { types } : {}),
    },
  };
}

test('buildCollectionIndex normalizes URLs and rejects stored duplicates', () => {
  const index = buildCollectionIndex('articles', [
    storedEntry(
      'sizu.yaml',
      '2026-10-01',
      'Sizu',
      'https://sizu.me/chihiroxx/posts/one?ref=feed#section',
    ),
    storedEntry('manual.yaml', '2026-10-02', 'Manual', 'https://example.com/a'),
  ]);

  assert.ok(index.entries[0]?.url instanceof URL);
  assert.equal(
    index.byUrl.has('https://sizu.me/chihiroxx/posts/one?ref=feed'),
    true,
  );
  assert.throws(
    () =>
      buildCollectionIndex('articles', [
        storedEntry(
          'one.yaml',
          '2026-10-01',
          'One',
          'https://sizu.me/chihiroxx/posts/one#first',
        ),
        storedEntry(
          'two.yaml',
          '2026-10-02',
          'Two',
          'https://sizu.me/chihiroxx/posts/one#second',
        ),
      ]),
    /articles URL is duplicated in one.yaml and two.yaml/,
  );
});

test('source ownership matches host, account path, and collection while preserving stored URL transport', () => {
  const cases = [
    ['articles', 'https://sizu.me/chihiroxx/posts/one?ref=rss#section', 'sizu'],
    ['articles', 'https://toyo.hatenablog.jp/entry/one', 'hatena'],
    ['talks', 'https://speakerdeck.com/chiroruxx/one', 'speakerdeck'],
    ['articles', 'http://sizu.me/chihiroxx/posts/one', 'sizu'],
    ['articles', 'https://sizu.me/other/posts/one', undefined],
    ['articles', 'https://sizu.me/chihiroxx/', undefined],
    ['articles', 'https://example.com/chihiroxx/posts/one', undefined],
    ['talks', 'https://sizu.me/chihiroxx/posts/one', undefined],
    ['articles', 'https://speakerdeck.com/chiroruxx/one', undefined],
  ] as const;
  for (const [collection, url, source] of cases) {
    const index = buildCollectionIndex(collection, [
      storedEntry('one.yaml', '2026-10-01', 'One', url),
    ]);
    assert.equal(index.entries[0]?.source, source);
  }
});

test('buildCollectionIndex removes fragments from comparison URLs, preserves queries, and leaves stored entries unchanged', () => {
  const urls = [
    'https://sizu.me/chihiroxx/posts/one?ref=first#section',
    'https://sizu.me/chihiroxx/posts/one?ref=second#section',
  ];
  const entries = urls.map((url, index) =>
    storedEntry(`${index}.yaml`, '2026-10-01', 'One', url),
  );
  const index = buildCollectionIndex('articles', entries);
  const expected = [
    'https://sizu.me/chihiroxx/posts/one?ref=first',
    'https://sizu.me/chihiroxx/posts/one?ref=second',
  ];
  assert.deepEqual(
    index.entries.map(({ url }) => url?.href),
    expected,
  );
  assert.deepEqual([...index.byUrl.keys()], expected);
  assert.deepEqual(
    index.entries.map(({ source }) => source),
    ['sizu', 'sizu'],
  );
  assert.deepEqual(
    entries.map(({ data }) => data.url?.href),
    urls,
  );
});
