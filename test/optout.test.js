import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInboundSms } from '../src/optout.js';

test('standard keywords, any case and punctuation', () => {
  for (const s of ['STOP', 'stop', ' Stop. ', 'UNSUBSCRIBE', 'cancel', 'End', 'quit', 'STOPALL', 'opt out', 'Revoke']) {
    assert.equal(classifyInboundSms(s), 'stop', s);
  }
  assert.equal(classifyInboundSms('START'), 'start');
  assert.equal(classifyInboundSms('unstop'), 'start');
  assert.equal(classifyInboundSms('help'), 'help');
});

test('plain-English opt-out requests are honored', () => {
  for (const s of ['Please stop texting me', 'remove me from your list', 'do not call me again', "don't text me"]) {
    assert.equal(classifyInboundSms(s), 'stop', s);
  }
});

test('ordinary replies are not opt-outs', () => {
  for (const s of ['Yes tomorrow works', 'Can you come at 3?', 'What does it cost to stop a leak?', 'endless leaks lol']) {
    assert.equal(classifyInboundSms(s), 'message', s);
  }
});
