import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentDateSchema,
  contentRecordSchema,
} from '../src/config/content-schema.ts';

test('content schemas coerce dates and reject invalid records', () => {
  const date = contentDateSchema.parse('2026-10-03');

  assert.ok(date instanceof Date);
  assert.equal(date.toISOString(), '2026-10-03T00:00:00.000Z');
  assert.equal(contentDateSchema.parse(date).getTime(), date.getTime());

  const validRecord = {
    date: '2026-10-03',
    title: 'Valid post',
  };
  assert.doesNotThrow(() => contentRecordSchema.parse(validRecord));
  const invalidFields = [
    ['date', 2026],
    ['date', 'not-a-date'],
    ['title', null],
    ['title', '  '],
    ['url', null],
    ['url', 'not a URL'],
    ['url', ''],
    ['url', 123],
    ['types', null],
    ['types', []],
    ['types', ['']],
    ['types', [1]],
  ] as const;

  for (const [field, value] of invalidFields) {
    assert.throws(() =>
      contentRecordSchema.parse({ ...validRecord, [field]: value }),
    );
  }

  for (const value of [null, []])
    assert.throws(() => contentRecordSchema.parse(value));
});

test('content record URL parsing preserves query and fragment and keeps a missing URL optional', () => {
  const url = 'https://example.com/post?ref=rss#section';
  const value = { date: '2026-10-03', title: 'Post', url };
  const result = contentRecordSchema.safeParse(value);
  assert.ok(result.success);
  assert.ok(result.data.url instanceof URL);
  assert.equal(result.data.url.href, url);
  assert.equal(value.url, url);
  const missing = contentRecordSchema.parse({
    date: '2026-10-03',
    title: 'Manual',
  });
  assert.equal(missing.url, undefined);
  assert.equal(Object.hasOwn(missing, 'url'), false);
});

test('content record URL can be omitted but cannot explicitly be undefined', () => {
  const value = { date: '2026-10-03', title: 'Manual' };
  assert.equal(contentRecordSchema.safeParse(value).success, true);
  const result = contentRecordSchema.safeParse({ ...value, url: undefined });
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ['url']);
});
