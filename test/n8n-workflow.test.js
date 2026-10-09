import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../n8n/speed-to-lead.json', import.meta.url), 'utf8');
const wf = JSON.parse(raw);
const names = new Set(wf.nodes.map((n) => n.name));

test('workflow has nodes with unique names and ids', () => {
  assert.ok(wf.nodes.length > 10);
  assert.equal(names.size, wf.nodes.length);
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length);
});

test('every connection points at an existing node', () => {
  for (const [from, { main }] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), `unknown source ${from}`);
    for (const output of main) for (const c of output) assert.ok(names.has(c.node), `${from} -> unknown ${c.node}`);
  }
});

test('every non-trigger, non-note node has an input', () => {
  const targets = new Set(Object.values(wf.connections).flatMap(({ main }) => main.flat().map((c) => c.node)));
  for (const n of wf.nodes) {
    if (/webhook$|scheduleTrigger$|stickyNote$/.test(n.type) && !/respondToWebhook$/.test(n.type)) continue;
    assert.ok(targets.has(n.name), `${n.name} is not connected`);
  }
});

test('webhook method + path pairs are unique', () => {
  const hooks = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => `${n.parameters.httpMethod} ${n.parameters.path}`);
  assert.equal(new Set(hooks).size, hooks.length);
});

test('no credentials, secrets or hard-coded hosts are embedded', () => {
  for (const n of wf.nodes) assert.equal(n.credentials, undefined, `${n.name} carries a credential reference`);
  assert.doesNotMatch(raw, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i, 'URLs must come from $env');
  assert.doesNotMatch(raw, /\b(10|172|192\.168)\.\d+\.\d+/);
  assert.doesNotMatch(raw, /(sk|pk)_(live|test)_|AC[0-9a-f]{32}|Bearer [A-Za-z0-9]/);
});

test('the decision service is the only place rules live (every action path reports back)', () => {
  const into = (name) => Object.entries(wf.connections).filter(([, { main }]) => main.flat().some((c) => c.node === name)).map(([from]) => from);
  assert.deepEqual(into('Build step result').sort(), ['Send SMS (Twilio)', 'Start AI call (Vapi)']);
  assert.deepEqual(into('Actions to items').sort(), ['Decide (decision service)', 'Get due follow-ups']);
});
