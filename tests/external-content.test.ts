import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getService,
  getSources,
  isSource,
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

test('configured sources preserve their order and service settings', () => {
  assert.deepEqual(getSources(), ['sizu', 'hatena', 'speakerdeck']);
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

test('getSources returns a fresh list and getService rejects unconfigured sources', () => {
  const sources = getSources();
  sources.pop();
  assert.deepEqual(getSources(), ['sizu', 'hatena', 'speakerdeck']);
  for (const source of ['unknown', 'toString', '__proto__']) {
    assert.throws(
      () => getService(source as Parameters<typeof getService>[0]),
      /Unknown service/,
    );
  }
});
