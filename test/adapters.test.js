import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../mock/server.js';
import { twilioSms, vapiVoice, goHighLevelCrm, webhookCrm, mapVapiEndedReason, adaptersFromEnv } from '../src/adapters/index.js';
import { withRetry } from '../src/adapters/http.js';
import { dispatchActions } from '../src/dispatch.js';
import { setup, lead } from './helpers.js';

let mock;
let base;
before(async () => {
  mock = createMockServer({ quiet: true });
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${mock.server.address().port}`;
});
after(() => mock.server.close());
const reset = () => fetch(`${base}/_reset`, { method: 'POST' });
const fail = (count) => fetch(`${base}/_fail`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) });
const fast = { retry: { baseDelayMs: 1 } };

test('Twilio adapter posts form-encoded To/From/Body with basic auth', async () => {
  await reset();
  const sms = twilioSms({ accountSid: 'ACtest', authToken: 'x', from: '+13125550100', baseUrl: base, ...fast });
  const res = await sms.send({ to: '+13125550123', body: 'hello' });
  assert.match(res.id, /^SM_mock_/);
  const [entry] = mock.log;
  assert.equal(entry.path, '/2010-04-01/Accounts/ACtest/Messages.json');
  assert.deepEqual(entry.body, { To: '+13125550123', Body: 'hello', From: '+13125550100' });
  assert.equal(entry.auth, true);
});

test('Vapi adapter picks the assistant by name and passes variables', async () => {
  await reset();
  const voice = vapiVoice({ apiKey: 'k', phoneNumberId: 'pn', assistantIds: { after_hours: 'asst-ah' }, baseUrl: base, ...fast });
  const res = await voice.startCall({ to: '+13125550123', assistant: 'after_hours', variables: { firstName: 'Dana' } });
  assert.match(res.id, /^call_mock_/);
  assert.equal(mock.log[0].body.assistantId, 'asst-ah');
  assert.equal(mock.log[0].body.customer.number, '+13125550123');
  await assert.rejects(voice.startCall({ to: '+1', assistant: 'business_hours' }), /No Vapi assistant/);
});

test('Vapi ended reasons map onto call statuses', () => {
  assert.equal(mapVapiEndedReason('customer-ended-call'), 'answered');
  assert.equal(mapVapiEndedReason('customer-did-not-answer'), 'no_answer');
  assert.equal(mapVapiEndedReason('customer-busy'), 'busy');
  assert.equal(mapVapiEndedReason('voicemail'), 'voicemail');
  assert.equal(mapVapiEndedReason('twilio-failed-to-connect-call'), 'failed');
});

test('GoHighLevel-style and webhook CRM adapters', async () => {
  await reset();
  const ghl = goHighLevelCrm({ apiKey: 'k', locationId: 'loc', baseUrl: base, ...fast });
  const r1 = await ghl.upsertLead({ leadId: 'l1', firstName: 'Dana', phone: '+13125550123', source: 'website', tags: ['source:website'] });
  assert.match(r1.id, /^contact_mock_/);
  assert.equal(mock.log[0].body.locationId, 'loc');
  const hook = webhookCrm({ url: `${base}/crm/webhook`, signingSecret: 's', ...fast });
  await hook.upsertLead({ leadId: 'l1' });
  assert.equal(mock.log[1].body.event, 'lead.upsert');
});

test('HTTP retry: 5xx is retried, then succeeds', async () => {
  await reset();
  await fail(2);
  const sms = twilioSms({ accountSid: 'AC', authToken: 'x', from: '+13125550100', baseUrl: base, ...fast });
  const res = await sms.send({ to: '+13125550123', body: 'hi' });
  assert.ok(res.id);
  assert.equal(mock.log.filter((e) => e.kind === 'forced-failure').length, 2);
});

test('withRetry does not retry non-retryable errors', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw Object.assign(new Error('400'), { retryable: false }); }, { tries: 3, baseDelayMs: 1 }));
  assert.equal(calls, 1);
});

test('dispatch: provider outage becomes a scheduled retry in the engine', async () => {
  await reset();
  await fail(10);
  const { engine } = setup();
  const r = engine.handleNewLead('website', lead());
  const sms = twilioSms({ accountSid: 'AC', authToken: 'x', from: '+13125550100', baseUrl: base, retry: { tries: 1 } });
  const voice = vapiVoice({ apiKey: 'k', phoneNumberId: 'pn', assistantIds: { default: 'a' }, baseUrl: base, retry: { tries: 1 } });
  const results = await dispatchActions(engine, r.actions, { sms, voice });
  assert.deepEqual(results.map((x) => x.status), ['retry_scheduled', 'retry_scheduled']);
  await fail(0);
});

test('adaptersFromEnv defaults to in-memory adapters', () => {
  const a = adaptersFromEnv({});
  assert.equal(a.sms.name, 'memory');
  assert.equal(a.voice.name, 'memory');
  assert.equal(a.crm.name, 'memory');
});
