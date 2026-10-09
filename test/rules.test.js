import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBusinessHours, isContactAllowed, nextAllowedTime } from '../src/rules.js';
import { validateConfig } from '../src/config.js';
import { baseConfig, TUE_10AM, TUE_6PM, TUE_1030PM, WED_9AM } from './helpers.js';

const config = baseConfig();

test('business hours vs contact window', () => {
  assert.equal(isBusinessHours(new Date(TUE_10AM), config), true);
  assert.equal(isBusinessHours(new Date(TUE_6PM), config), false);
  assert.equal(isContactAllowed(new Date(TUE_6PM), config), true);
  assert.equal(isContactAllowed(new Date(TUE_1030PM), config), false);
});

test('window end is exclusive, start is inclusive', () => {
  assert.equal(isContactAllowed(new Date('2026-10-14T01:00:00Z'), config), false); // 20:00 local
  assert.equal(isContactAllowed(new Date('2026-10-14T00:59:00Z'), config), true); // 19:59 local
  assert.equal(isContactAllowed(new Date(WED_9AM), config), true); // 09:00 local
});

test('weekend is not business hours', () => {
  assert.equal(isBusinessHours(new Date('2026-10-17T15:00:00Z'), config), false); // Sat 10:00
});

test('next allowed time inside the window is unchanged', () => {
  assert.equal(nextAllowedTime(new Date(TUE_10AM), config).toISOString(), new Date(TUE_10AM).toISOString());
});

test('quiet hours defer to next morning at window start', () => {
  assert.equal(nextAllowedTime(new Date(TUE_1030PM), config).toISOString(), new Date(WED_9AM).toISOString());
});

test('early morning defers to the same day', () => {
  assert.equal(nextAllowedTime(new Date('2026-10-14T11:15:45Z'), config).toISOString(), WED_9AM.replace('Z', '.000Z')); // 06:15:45 local
});

test('handles the DST change (Nov 1 2026, CDT -> CST)', () => {
  // Sat Oct 31 22:00 CDT -> Sun Nov 1 09:00 CST = 15:00Z
  assert.equal(nextAllowedTime(new Date('2026-11-01T03:00:00Z'), config).toISOString(), '2026-11-01T15:00:00.000Z');
});

test('skips days that are not in the contact window', () => {
  const weekdaysOnly = { ...config, contactWindow: { days: [1, 2, 3, 4, 5], start: '09:00', end: '20:00' } };
  // Fri Oct 16 21:00 local -> Mon Oct 19 09:00 local
  assert.equal(nextAllowedTime(new Date('2026-10-17T02:00:00Z'), weekdaysOnly).toISOString(), '2026-10-19T14:00:00.000Z');
});

test('config validation catches mistakes', () => {
  assert.throws(() => validateConfig({ ...config, business: { ...config.business, timezone: 'Mars/Base' } }), /timezone/);
  assert.throws(() => validateConfig({ ...config, contactWindow: { days: [1], start: '20:00', end: '09:00' } }), /before/);
  assert.throws(() => validateConfig({ ...config, sequence: [{ id: 'x', channel: 'sms', template: 'nope' }] }), /missing template/);
  assert.doesNotThrow(() => validateConfig(config));
});
