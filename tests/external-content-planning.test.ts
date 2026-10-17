import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildCollectionIndex,
  createContentLinkCheckPlan,
  createPrunePlan,
  createSyncPlan,
  type FeedItem,
  limits,
  type StoredEntry,
} from '../scripts/lib/external-content-planning.ts';

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

const feedItem = (date: string, title: string, url: string): FeedItem => ({
  date: new Date(date),
  title,
  url,
});

test('collection ownership remains host and path based even when URL transport needs review', () => {
  const index = buildCollectionIndex('articles', [
    storedEntry(
      'legacy-http.yaml',
      '2026-10-01',
      'Legacy HTTP',
      'http://sizu.me/chihiroxx/posts/legacy',
    ),
  ]);
  assert.equal(index.manualCount, 0);
  assert.equal(index.entries[0]?.source, 'sizu');
});

test('buildCollectionIndex normalizes URLs, counts manual entries, and rejects stored duplicates', () => {
  const index = buildCollectionIndex('articles', [
    storedEntry(
      'sizu.yaml',
      '2026-10-01',
      'Sizu',
      'https://sizu.me/chihiroxx/posts/one?ref=feed#section',
    ),
    storedEntry('manual.yaml', '2026-10-02', 'Manual', 'https://example.com/a'),
  ]);

  assert.equal(index.manualCount, 1);
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

test('createSyncPlan is deterministic and keeps existing types', () => {
  for (const types of [['手動分類'], undefined, []]) {
    const existing = [
      storedEntry(
        'sizu.yaml',
        '2026-10-01',
        'Old title',
        'https://sizu.me/chihiroxx/posts/existing?ref=feed',
        types,
      ),
    ];
    const index = buildCollectionIndex('articles', existing);
    const feed = [
      feedItem('2026-10-03', 'New B', 'https://sizu.me/chihiroxx/posts/b#feed'),
      feedItem(
        '2026-10-02',
        'Updated title',
        'https://sizu.me/chihiroxx/posts/existing?ref=feed',
      ),
      feedItem('2026-10-03', 'New A', 'https://sizu.me/chihiroxx/posts/a'),
    ];
    const options = {
      source: 'sizu' as const,
      index,
      feed,
      contentDirectory: '/repo/src/content',
    };
    const initial = createSyncPlan(options);

    assert.deepEqual(
      initial.map(({ action, date, title, url, types }) => ({
        action,
        date,
        title,
        url,
        types,
      })),
      [
        {
          action: 'add',
          date: new Date('2026-10-03'),
          title: 'New A',
          url: 'https://sizu.me/chihiroxx/posts/a',
          types: ['日常記事'],
        },
        {
          action: 'add',
          date: new Date('2026-10-03'),
          title: 'New B',
          url: 'https://sizu.me/chihiroxx/posts/b',
          types: ['日常記事'],
        },
        {
          action: 'update',
          date: new Date('2026-10-02'),
          title: 'Updated title',
          url: 'https://sizu.me/chihiroxx/posts/existing?ref=feed',
          types: types ?? ['日常記事'],
        },
      ],
    );
    assert.deepEqual(
      initial.map(({ url }) => url),
      [
        'https://sizu.me/chihiroxx/posts/a',
        'https://sizu.me/chihiroxx/posts/b',
        'https://sizu.me/chihiroxx/posts/existing?ref=feed',
      ],
    );
    assert.equal(initial[2]?.file, existing[0]?.file);
  }
});

test('sync ranks one source against saved entries from another source under the shared collection cap', () => {
  const hatenaEntries = Array.from({ length: limits.articles }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return storedEntry(
      `hatena-${day}.yaml`,
      `2026-10-${day}`,
      `Hatena ${day}`,
      `https://toyo.hatenablog.jp/entry/hatena-${day}`,
    );
  });
  const index = buildCollectionIndex('articles', hatenaEntries);

  const plan = createSyncPlan({
    source: 'sizu',
    index,
    feed: [
      feedItem(
        '2026-09-30',
        'Older Sizu post',
        'https://sizu.me/chihiroxx/posts/older',
      ),
    ],
    contentDirectory: '/repo/src/content',
  });

  assert.deepEqual(plan, []);
});

test('createPrunePlan ranks saved entries by date and URL and preserves manual slots', () => {
  const saved = Array.from({ length: limits.articles + 1 }, (_, index) => {
    const day = index + 1;
    const date =
      day >= 19 ? '2026-10-21' : `2026-10-${String(day).padStart(2, '0')}`;
    const slug = day >= 19 ? `tie-${22 - day}` : `post-${day}`;
    return storedEntry(
      `${String(day).padStart(2, '0')}.yaml`,
      date,
      `Post ${day}`,
      `https://sizu.me/chihiroxx/posts/${slug}`,
    );
  });
  const manual = storedEntry(
    'manual.yaml',
    '2026-10-22',
    'Manual',
    'https://example.com/manual',
  );
  const index = buildCollectionIndex('articles', [...saved, manual]);
  const plan = createPrunePlan(index);

  assert.equal(index.manualCount, 1);
  const tieEntries = [
    storedEntry(
      'tie-z.yaml',
      '2026-10-21',
      'Z',
      'https://sizu.me/chihiroxx/posts/z',
    ),
    storedEntry(
      'tie-a.yaml',
      '2026-10-21',
      'A',
      'https://sizu.me/chihiroxx/posts/a',
    ),
    storedEntry(
      'tie-m.yaml',
      '2026-10-21',
      'M',
      'https://sizu.me/chihiroxx/posts/m',
    ),
  ];
  const manualEntries = Array.from(
    { length: limits.articles - 1 },
    (_, index) =>
      storedEntry(
        `manual-${index}.yaml`,
        '2026-10-22',
        `Manual ${index}`,
        `https://example.com/manual-${index}`,
      ),
  );
  const tiePlan = createPrunePlan(
    buildCollectionIndex('articles', [...tieEntries, ...manualEntries]),
  );
  assert.deepEqual(
    createContentLinkCheckPlan(
      buildCollectionIndex('articles', [...tieEntries, ...manualEntries]),
    ).map(({ url }) => url),
    [
      'https://sizu.me/chihiroxx/posts/a',
      'https://sizu.me/chihiroxx/posts/m',
      'https://sizu.me/chihiroxx/posts/z',
    ],
  );
  assert.deepEqual(tiePlan.map(({ file }) => file).sort(), [
    '/repo/src/content/articles/tie-m.yaml',
    '/repo/src/content/articles/tie-z.yaml',
  ]);
  const collisionUrl = 'https://sizu.me/chihiroxx/posts/collision';
  const collisionFilename = `sizu-${createHash('sha256').update(collisionUrl).digest('hex')}.yaml`;
  assert.throws(
    () =>
      createSyncPlan({
        source: 'sizu',
        index: buildCollectionIndex('articles', [
          storedEntry(
            collisionFilename,
            '2026-10-01',
            'Manual',
            'https://example.com/manual',
          ),
        ]),
        feed: [feedItem('2026-10-03', 'Collision', collisionUrl)],
        contentDirectory: '/repo/src/content',
      }),
    /Filename collision while adding/,
  );
  assert.deepEqual(
    plan.map(({ file }) => file),
    [
      '/repo/src/content/articles/01.yaml',
      '/repo/src/content/articles/02.yaml',
    ],
  );
  assert.deepEqual(
    createContentLinkCheckPlan(index)
      .map(({ url }) => url)
      .filter((url) => url.includes('tie-')),
    [
      'https://sizu.me/chihiroxx/posts/tie-1',
      'https://sizu.me/chihiroxx/posts/tie-2',
      'https://sizu.me/chihiroxx/posts/tie-3',
    ],
  );
  assert.ok(!plan.some(({ file }) => file.endsWith('manual.yaml')));
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
    index.entries.map(({ url }) => url),
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

test('createSyncPlan leaves unchanged saved records untouched', () => {
  const url = 'https://sizu.me/chihiroxx/posts/unchanged?ref=rss';
  const index = buildCollectionIndex('articles', [
    storedEntry('unchanged.yaml', '2026-10-03', 'Unchanged', url, ['日常記事']),
  ]);
  assert.deepEqual(
    createSyncPlan({
      source: 'sizu',
      index,
      feed: [feedItem('2026-10-03', 'Unchanged', url)],
      contentDirectory: '/repo/src/content',
    }),
    [],
  );
});
