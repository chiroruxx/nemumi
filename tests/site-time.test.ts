import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDateInSiteTimeZone,
  getSiteTimeZone,
} from '../src/config/site-time.ts';

test('TZ environment variable is shared with site date formatting', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(getSiteTimeZone(), 'America/Los_Angeles');
    assert.equal(
      formatDateInSiteTimeZone(new Date('2026-10-02T16:30:00.000Z')),
      '2026-10-02',
    );
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
