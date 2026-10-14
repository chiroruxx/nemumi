import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDateInSiteTimeZone,
  siteTimeZone,
} from '../src/config/site-time.ts';

test('site timezone is used to format dates consistently', () => {
  assert.equal(siteTimeZone, 'Asia/Tokyo');
  assert.equal(
    formatDateInSiteTimeZone(new Date('2026-10-02T16:30:00.000Z')),
    '2026-10-03',
  );
});
