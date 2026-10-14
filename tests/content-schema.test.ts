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
