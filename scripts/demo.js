/**
 * End-to-end demo with a simulated clock. Starts the mock provider server,
 * wires the real Twilio / Vapi / GoHighLevel adapters to it, and walks a few
 * leads through a day. Nothing leaves your machine.
 *
 *   npm run demo
 */
import { createMockServer } from '../mock/server.js';
import { createEngine } from '../src/engine.js';
import { loadConfig } from '../src/config.js';
import { twilioSms, vapiVoice, goHighLevelCrm } from '../src/adapters/index.js';
import { dispatchActions, syncCrm } from '../src/dispatch.js';
import { readFileSync } from 'node:fs';

const config = loadConfig();
const { server, log } = createMockServer({ quiet: true });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const adapters = {
  sms: twilioSms({ accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', authToken: 'placeholder', from: '+13125550100', baseUrl: base }),
  voice: vapiVoice({ apiKey: 'placeholder', phoneNumberId: 'placeholder', assistantIds: { business_hours: 'asst-business', after_hours: 'asst-after-hours' }, baseUrl: base }),
  crm: goHighLevelCrm({ apiKey: 'placeholder', locationId: 'placeholder', baseUrl: base }),
};

let clock = new Date('2026-10-13T15:00:00Z'); // Tue 10:00 in America/Chicago
const engine = createEngine({ config, now: () => clock });
const local = (d) => new Date(d).toLocaleString('en-US', { timeZone: config.business.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const say = (msg) => console.log(`${local(clock).padEnd(16)} ${msg}`);

async function newLead(source, payload) {
  const t0 = performance.now();
  const r = engine.handleNewLead(source, payload);
  await syncCrm(r.crm, adapters);
  await dispatchActions(engine, r.actions, adapters);
  const ms = Math.round(performance.now() - t0);
  say(`${source} lead ${r.lead.firstName || '(no name)'} -> ${r.decision}${r.reason ? ` (${r.reason})` : ''}; ${r.actions.map((a) => a.type).join(' + ') || 'no outreach'}${r.actions.length ? ` in ${ms} ms` : ''}`);
  return r;
}

async function advance(iso) {
  clock = new Date(iso);
  const actions = engine.dueActions();
  await dispatchActions(engine, actions, adapters);
  if (actions.length) say(`follow-up due: ${actions.map((a) => `${a.type} (${a.stepId.split(':')[1]})`).join(', ')}`);
}

console.log(`\n${config.business.name} speed-to-lead demo (simulated clock, mock providers)\n`);

const sample = JSON.parse(readFileSync(new URL('../examples/website-lead.json', import.meta.url), 'utf8'));
const a = await newLead('website', sample);
await newLead('website', sample); // double-submit
await advance('2026-10-13T15:05:00Z');
engine.handleCallStatus({ callId: engine.getLead(a.leadId).steps[1].providerId, status: 'no_answer' });
say('call-back outcome: no answer, sequence continues');
await advance('2026-10-13T16:00:00Z');
engine.handleInboundSms({ from: '+13125550123', body: 'Tomorrow at 9 works' });
say('lead replied by text -> sequence stopped, flagged for a human');

clock = new Date('2026-10-14T03:30:00Z'); // Tue 22:30 local, quiet hours
await newLead('website', { name: 'Morgan Example', phone: '312-555-0177', consent: 'on', message: 'Leak over the garage' });
await advance('2026-10-14T14:00:00Z'); // Wed 09:00 local
const stop = engine.handleInboundSms({ from: '(312) 555-0177', body: 'STOP' });
say(`STOP received -> ${stop.action}; reply: "${stop.reply}"`);

await newLead('website', { name: 'Casey Example', phone: '312-555-0188', message: 'Need a quote' }); // no consent box
await newLead('facebook_comment', { from: { name: 'Jordan Example' }, message: 'How much for a new roof?', comment_id: '123_456' });

const old = JSON.parse(readFileSync(new URL('../examples/old-leads.json', import.meta.url), 'utf8'));
const plan = engine.startReactivation(old);
say(`reactivation: ${plan.scheduled} scheduled (${local(plan.firstSendAt)} to ${local(plan.lastSendAt)}), skipped: ${plan.skipped.map((s) => `${s.ref}=${s.reason}`).join(', ')}`);
await advance('2026-10-14T14:05:00Z');

const counts = log.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
console.log(`\nmock provider received: ${JSON.stringify(counts)}`);
server.close();
