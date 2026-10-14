import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDateInSiteTimeZone,
  getSiteTimeZone,
} from '../src/config/site-time.ts';

test('site timezone environment variable is shared with date formatting', () => {
  const original = process.env.SITE_TIME_ZONE;
  try {
    process.env.SITE_TIME_ZONE = 'America/Los_Angeles';
    assert.equal(getSiteTimeZone(), 'America/Los_Angeles');
    assert.equal(
      formatDateInSiteTimeZone(new Date('2026-10-02T16:30:00.000Z')),
      '2026-10-02',
    );
  } finally {
    if (original === undefined) delete process.env.SITE_TIME_ZONE;
    else process.env.SITE_TIME_ZONE = original;
  }
});
