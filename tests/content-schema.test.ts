import assert from 'node:assert/strict';
import test from 'node:test';
import { contentDateSchema } from '../src/config/content-schema.ts';

test('content date schema coerces saved calendar dates to Date and rejects invalid input types', () => {
  const date = contentDateSchema.parse('2026-10-03');

  assert.ok(date instanceof Date);
  assert.equal(date.toISOString(), '2026-10-03T00:00:00.000Z');
  assert.equal(contentDateSchema.parse(date).getTime(), date.getTime());
  assert.equal(contentDateSchema.safeParse('not-a-date').success, false);
  assert.equal(contentDateSchema.safeParse(2026).success, false);
});
