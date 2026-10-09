import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, lead, TUE_10AM, TUE_6PM, TUE_1030PM, WED_9AM } from './helpers.js';

test('new lead in business hours: instant text + call, CRM record, follow-ups queued', () => {
  const { engine } = setup();
  const r = engine.handleNewLead('website', lead());
  assert.equal(r.decision, 'contact');
  assert.deepEqual(r.actions.map((a) => a.type), ['sms', 'call']);
  assert.equal(r.actions[0].to, '+13125550123');
  assert.match(r.actions[0].body, /^Hi Dana, this is Blue Gable Roofing/);
  assert.match(r.actions[0].body, /Reply STOP/);
  assert.equal(r.actions[1].assistant, 'business_hours');
  assert.equal(r.crm.status, 'in_sequence');
  assert.equal(r.nextStepAt, '2026-10-13T15:05:00.000Z');
});

test('after business hours but before quiet hours: after-hours wording and assistant', () => {
  const { engine } = setup({ at: TUE_6PM });
  const r = engine.handleNewLead('website', lead());
  assert.equal(r.decision, 'contact');
  assert.match(r.actions[0].body, /office is closed/);
  assert.equal(r.actions[1].assistant, 'after_hours');
});

test('quiet hours: nothing sent now, whole sequence shifts to the next window', () => {
  const { engine, set } = setup({ at: TUE_1030PM });
  const r = engine.handleNewLead('website', lead());
  assert.equal(r.decision, 'deferred');
  assert.equal(r.reason, 'quiet_hours');
  assert.equal(r.actions.length, 0);
  const steps = engine.getLead(r.leadId).steps.map((s) => [s.key, s.at]);
  assert.deepEqual(steps, [
    ['instant-text', '2026-10-14T14:00:00.000Z'],
    ['instant-call', '2026-10-14T14:00:00.000Z'],
    ['text-5m', '2026-10-14T14:05:00.000Z'],
    ['call-1h', '2026-10-14T15:00:00.000Z'],
    ['text-next-day', '2026-10-15T14:00:00.000Z'],
  ]);
  set('2026-10-14T13:59:00Z');
  assert.equal(engine.dueActions().length, 0);
  set(WED_9AM);
  assert.deepEqual(engine.dueActions().map((a) => a.type), ['sms', 'call']);
});

test('follow-up that would land in quiet hours moves to the next morning', () => {
  const { engine } = setup({ at: '2026-10-14T00:30:00Z' }); // Tue 19:30 local
  const r = engine.handleNewLead('website', lead());
  const call1h = engine.getLead(r.leadId).steps.find((s) => s.key === 'call-1h');
  assert.equal(call1h.at, WED_9AM.replace('Z', '.000Z'));
});

test('no consent: logged for a human, no outreach', () => {
  const { engine } = setup();
  const r = engine.handleNewLead('website', lead({ consent: undefined }));
  assert.equal(r.decision, 'log_only');
  assert.equal(r.reason, 'no_consent');
  assert.equal(r.actions.length, 0);
  assert.equal(r.crm.status, 'needs_review');
});

test('consent can be turned off in config (for leads with consent captured elsewhere)', () => {
  const { engine, config } = setup();
  config.requireConsent = false;
  assert.equal(engine.handleNewLead('website', lead({ consent: undefined })).decision, 'contact');
});

test('no phone: log only', () => {
  const { engine } = setup();
  const r = engine.handleNewLead('website', lead({ phone: '' , email: 'dana@example.com' }));
  assert.equal(r.decision, 'log_only');
  assert.equal(r.reason, 'no_phone');
});

test('dedup: same phone within the window is not contacted twice', () => {
  const { engine, set } = setup();
  const first = engine.handleNewLead('website', lead());
  set('2026-10-13T15:02:00Z');
  const second = engine.handleNewLead('facebook_lead_ad', {
    id: 'fb1',
    field_data: [
      { name: 'full_name', values: ['Dana Example'] },
      { name: 'phone_number', values: ['+1 312 555 0123'] },
      { name: 'sms_consent', values: ['yes'] },
    ],
  });
  assert.equal(second.decision, 'duplicate');
  assert.equal(second.leadId, first.leadId);
  assert.equal(second.actions.length, 0);
});

test('dedup window expires: a new inquiry starts a fresh sequence and retires the old one', () => {
  const { engine, set } = setup();
  const first = engine.handleNewLead('website', lead());
  set('2026-10-15T15:00:00Z');
  const second = engine.handleNewLead('website', lead());
  assert.equal(second.decision, 'contact');
  assert.notEqual(second.leadId, first.leadId);
  assert.ok(engine.getLead(first.leadId).steps.every((s) => s.status !== 'pending'));
});

test('STOP cancels every pending step, blocks future leads, START re-allows', () => {
  const { engine, set } = setup();
  const r = engine.handleNewLead('website', lead());
  const stop = engine.handleInboundSms({ from: '312-555-0123', body: 'stop' });
  assert.equal(stop.action, 'opted_out');
  assert.match(stop.reply, /unsubscribed/);
  assert.ok(engine.getLead(r.leadId).steps.every((s) => s.status !== 'pending'));
  set('2026-10-13T16:00:00Z');
  assert.equal(engine.dueActions().length, 0);

  set('2026-10-16T15:00:00Z');
  assert.equal(engine.handleNewLead('website', lead()).decision, 'suppressed');
  assert.equal(engine.handleInboundSms({ from: '+13125550123', body: 'START' }).action, 'opted_in');
  set('2026-10-18T15:00:00Z');
  assert.equal(engine.handleNewLead('website', lead()).decision, 'contact');
});

test('a real reply stops the sequence and flags a human', () => {
  const { engine, set } = setup();
  const r = engine.handleNewLead('website', lead());
  const reply = engine.handleInboundSms({ from: '+13125550123', body: 'Tomorrow at 9 works' });
  assert.equal(reply.action, 'needs_human');
  assert.equal(reply.crm.status, 'replied');
  set('2026-10-14T15:00:00Z');
  assert.equal(engine.dueActions().length, 0);
  assert.equal(engine.getLead(r.leadId).status, 'replied');
});

test('answered call stops the sequence; no-answer keeps it going', () => {
  const { engine, set } = setup();
  const r = engine.handleNewLead('website', lead());
  const [sms, call] = r.actions;
  engine.reportStepResult({ stepId: sms.stepId, ok: true, providerId: 'SM1' });
  engine.reportStepResult({ stepId: call.stepId, ok: true, providerId: 'call-1' });
  assert.equal(engine.handleCallStatus({ callId: 'call-1', status: 'no_answer' }).action, 'sequence_continues');
  set('2026-10-13T15:05:00Z');
  const [followup] = engine.dueActions();
  assert.equal(followup.stepId, `${r.leadId}:text-5m`);
  engine.reportStepResult({ stepId: followup.stepId, ok: true });
  set('2026-10-13T16:00:00Z');
  const [call2] = engine.dueActions();
  engine.reportStepResult({ stepId: call2.stepId, ok: true, providerId: 'call-2' });
  assert.equal(engine.handleCallStatus({ callId: 'call-2', status: 'answered' }).action, 'sequence_stopped');
  set('2026-10-14T15:00:00Z');
  assert.equal(engine.dueActions().length, 0);
  assert.equal(engine.getLead(r.leadId).status, 'contacted');
});

test('provider failure is retried with backoff, then marked failed', () => {
  const { engine, set } = setup();
  const r = engine.handleNewLead('website', lead());
  const stepId = r.actions[0].stepId;
  const first = engine.reportStepResult({ stepId, ok: false, error: 'HTTP 503' });
  assert.equal(first.status, 'retry_scheduled');
  assert.equal(first.retryAt, '2026-10-13T15:01:00.000Z');
  set('2026-10-13T15:01:00Z');
  assert.ok(engine.dueActions().some((a) => a.stepId === stepId));
  assert.equal(engine.reportStepResult({ stepId, ok: false }).retryAt, '2026-10-13T15:06:00.000Z');
  set('2026-10-13T15:06:00Z');
  // the retry and the 5-minute follow-up are both due: retry goes first, follow-up waits
  assert.deepEqual(engine.dueActions().map((a) => a.stepId), [stepId]);
  assert.equal(engine.getLead(r.leadId).steps.find((s) => s.key === 'text-5m').at, '2026-10-13T15:11:00.000Z');
  assert.equal(engine.reportStepResult({ stepId, ok: false }).status, 'failed');
});

test('result for a step that is not in flight is ignored (idempotent webhooks)', () => {
  const { engine } = setup();
  const r = engine.handleNewLead('website', lead());
  engine.reportStepResult({ stepId: r.actions[0].stepId, ok: true });
  assert.equal(engine.reportStepResult({ stepId: r.actions[0].stepId, ok: true }).ignored, true);
});

test('after downtime, stale overdue steps collapse to the latest per channel', () => {
  const { engine, set } = setup();
  const r = engine.handleNewLead('website', lead());
  for (const a of r.actions) engine.reportStepResult({ stepId: a.stepId, ok: true });
  set('2026-10-14T19:00:00Z'); // Wed 14:00, past text-5m, call-1h and text-next-day
  const actions = engine.dueActions();
  assert.deepEqual(actions.map((a) => a.stepId.split(':')[1]), ['text-next-day', 'call-1h']);
  assert.equal(engine.getLead(r.leadId).steps.find((s) => s.key === 'text-5m').status, 'skipped');
});

test('Facebook page comment is logged without outreach', () => {
  const { engine } = setup();
  const r = engine.handleNewLead('facebook_comment', { from: { name: 'Sam Example' }, message: 'Price?', comment_id: 'c1' });
  assert.equal(r.decision, 'log_only');
  assert.equal(r.crm.source, 'facebook_comment');
});
