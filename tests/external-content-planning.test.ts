import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildCollectionIndex,
  createPrunePlan,
  createSyncPlan,
  type FeedItem,
  limits,
  type StoredEntry,
  services,
  validateContentUrl,
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
    data: { date: new Date(date), title, url, ...(types ? { types } : {}) },
  };
}

const feedItem = (date: string, title: string, url: string): FeedItem => ({
  date: new Date(date),
  title,
  url,
});

test('validateContentUrl applies one HTTPS, account, host, and credential policy while preserving query', () => {
  const accepted = [
    [
      'https://sizu.me/chihiroxx/posts/one?ref=feed#section',
      'https://sizu.me/chihiroxx/posts/one?ref=feed',
    ],
    [
      'https://toyo.hatenablog.jp/entry/one?ref=feed#section',
      'https://toyo.hatenablog.jp/entry/one?ref=feed',
    ],
  ] as const;
  for (const [input, expected] of accepted) {
    const service = input.includes('sizu.me') ? services.sizu : services.hatena;
    assert.equal(validateContentUrl(input, service), expected);
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
    assert.throws(() => validateContentUrl(input, services.sizu), /Unexpected/);
  }
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

test('createSyncPlan is deterministic, keeps existing types, and reports links to verify', () => {
  const existing = [
    storedEntry(
      'sizu.yaml',
      '2026-10-01',
      'Old title',
      'https://sizu.me/chihiroxx/posts/existing?ref=feed',
      ['手動分類'],
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

  assert.deepEqual(initial.linkChecks, [
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/a' },
    { source: 'sizu', url: 'https://sizu.me/chihiroxx/posts/b' },
  ]);
  assert.deepEqual(
    initial.changes.map(({ action, date, title, url, types }) => ({
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
        types: ['手動分類'],
      },
    ],
  );
  assert.deepEqual(
    initial.changes.map(({ url }) => url),
    [
      'https://sizu.me/chihiroxx/posts/a',
      'https://sizu.me/chihiroxx/posts/b',
      'https://sizu.me/chihiroxx/posts/existing?ref=feed',
    ],
  );
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

  assert.deepEqual(plan, { changes: [], linkChecks: [] });
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
    tiePlan.linkChecks.map(({ url }) => url),
    ['https://sizu.me/chihiroxx/posts/a'],
  );
  assert.deepEqual(tiePlan.removals.map(({ url }) => url).sort(), [
    'https://sizu.me/chihiroxx/posts/m',
    'https://sizu.me/chihiroxx/posts/z',
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
    plan.removals.map(({ reason, url }) => [reason, url]),
    [
      ['limit', 'https://sizu.me/chihiroxx/posts/post-1'],
      ['limit', 'https://sizu.me/chihiroxx/posts/post-2'],
    ],
  );
  assert.deepEqual(
    plan.linkChecks.map(({ url }) => url).filter((url) => url.includes('tie-')),
    [
      'https://sizu.me/chihiroxx/posts/tie-1',
      'https://sizu.me/chihiroxx/posts/tie-2',
      'https://sizu.me/chihiroxx/posts/tie-3',
    ],
  );
  assert.ok(!plan.removals.some(({ url }) => url === manual.data.url));
});
