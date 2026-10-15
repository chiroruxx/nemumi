import assert from 'node:assert/strict';
import test from 'node:test';
import { isSource } from '../scripts/lib/external-content.ts';

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
