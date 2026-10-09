import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { setup, lead } from './helpers.js';

let server;
let base;
const ctx = setup();
before(async () => {
  server = createApp({ engine: ctx.engine, apiKey: 'test-key' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = { 'X-Api-Key': 'test-key' }) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health is open, everything else needs the API key', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await post('/steps/due', {}, {})).status, 401);
  assert.equal((await post('/steps/due', {}, { 'X-Api-Key': 'wrong' })).status, 401);
});

test('full loop over HTTP: lead -> actions -> results -> Vapi report -> inbound STOP', async () => {
  const r = await (await post('/leads', { source: 'website', payload: lead() })).json();
  assert.equal(r.decision, 'contact');
  const call = r.actions.find((a) => a.type === 'call');
  const res = await (await post('/steps/result', { stepId: call.stepId, ok: true, providerId: 'call-xyz' })).json();
  assert.equal(res.status, 'sent');
  const report = { message: { type: 'end-of-call-report', endedReason: 'customer-did-not-answer', call: { id: 'call-xyz' } } };
  assert.equal((await (await post('/call-status', report)).json()).action, 'sequence_continues');

  const twilioForm = new URLSearchParams({ From: '+13125550123', Body: 'STOP' }).toString();
  const stop = await fetch(`${base}/inbound-sms`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Api-Key': 'test-key' }, body: twilioForm });
  assert.equal((await stop.json()).action, 'opted_out');

  const lookup = await fetch(`${base}/leads/${r.leadId}`, { headers: { 'X-Api-Key': 'test-key' } });
  assert.equal((await lookup.json()).status, 'opted_out');
});

test('bad input gets 400, not 500', async () => {
  assert.equal((await post('/leads', {})).status, 400);
  assert.equal((await post('/leads', { source: 'fax' })).status, 400);
  assert.equal((await post('/steps/result', { stepId: 'nope:x', ok: true })).status, 400);
  const bad = await fetch(`${base}/leads`, { method: 'POST', headers: { 'X-Api-Key': 'test-key' }, body: '{not json' });
  assert.equal(bad.status, 400);
});
