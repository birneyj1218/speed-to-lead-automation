import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReactivation } from '../src/reactivation.js';
import { baseConfig, setup, lead, WED_9AM } from './helpers.js';

const rows = (n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i + start}`, name: `Person ${i}`, phone: `31255501${String(i + start).padStart(2, '0')}`, consent: true }));

test('spaces messages by the rate limit', () => {
  const config = baseConfig();
  const { scheduled } = planReactivation(rows(4), { now: new Date(WED_9AM), config });
  assert.deepEqual(scheduled.map((s) => s.sendAt), [
    '2026-10-14T14:00:00.000Z',
    '2026-10-14T14:00:10.000Z',
    '2026-10-14T14:00:20.000Z',
    '2026-10-14T14:00:30.000Z',
  ]);
});

test('daily cap rolls the rest to the next day', () => {
  const config = baseConfig();
  config.reactivation.dailyCap = 2;
  const { scheduled } = planReactivation(rows(5), { now: new Date(WED_9AM), config });
  assert.deepEqual(scheduled.map((s) => s.sendAt.slice(0, 10)), ['2026-10-14', '2026-10-14', '2026-10-15', '2026-10-15', '2026-10-16']);
  assert.equal(scheduled[2].sendAt, '2026-10-15T14:00:00.000Z');
});

test('never sends in quiet hours even when the batch runs past window end', () => {
  const config = baseConfig();
  config.reactivation.messagesPerMinute = 1;
  const now = new Date('2026-10-14T00:58:00Z'); // 19:58 local
  const { scheduled } = planReactivation(rows(3), { now, config });
  assert.deepEqual(scheduled.map((s) => s.sendAt), ['2026-10-14T00:58:00.000Z', '2026-10-14T00:59:00.000Z', '2026-10-14T14:00:00.000Z']);
});

test('skips opted-out, no-consent, duplicate, recently contacted, and missing phone', () => {
  const config = baseConfig();
  const input = [
    { id: 'ok', phone: '3125550101', consent: true },
    { id: 'optout', phone: '3125550102', consent: true },
    { id: 'flagged', phone: '3125550103', consent: true, opted_out: true },
    { id: 'noconsent', phone: '3125550104' },
    { id: 'dup', phone: '+1 312 555 0101', consent: true },
    { id: 'recent', phone: '3125550105', consent: true, last_contacted_at: '2026-10-01T00:00:00Z' },
    { id: 'nophone', consent: true },
  ];
  const { scheduled, skipped } = planReactivation(input, { now: new Date(WED_9AM), config, isOptedOut: (p) => p === '+13125550102' });
  assert.deepEqual(scheduled.map((s) => s.ref), ['ok']);
  assert.deepEqual(skipped, [
    { ref: 'optout', reason: 'opted_out' },
    { ref: 'flagged', reason: 'opted_out' },
    { ref: 'noconsent', reason: 'no_consent' },
    { ref: 'dup', reason: 'duplicate' },
    { ref: 'recent', reason: 'contacted_recently' },
    { ref: 'nophone', reason: 'no_phone' },
  ]);
});

test('engine: reactivation texts go out through the normal due loop and honor STOP', () => {
  const { engine, set } = setup({ at: WED_9AM });
  const res = engine.startReactivation(rows(3));
  assert.equal(res.scheduled, 3);
  engine.handleInboundSms({ from: '3125550101', body: 'STOP' });
  set('2026-10-14T14:01:00Z');
  const actions = engine.dueActions();
  assert.equal(actions.length, 2);
  assert.ok(actions.every((a) => /Reply STOP to opt out/.test(a.body)));
});

test('engine: leads already in an active sequence are not reactivated', () => {
  const { engine } = setup({ at: WED_9AM });
  engine.handleNewLead('website', lead({ phone: '3125550100' }));
  const res = engine.startReactivation(rows(2));
  assert.deepEqual(res.skipped, [{ ref: 'r0', reason: 'active_sequence' }]);
});
