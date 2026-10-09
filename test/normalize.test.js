import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { normalizeWebsiteForm, normalizeFacebookLead, parseFacebookWebhook, verifyFacebookSignature, isTruthyConsent } from '../src/normalize.js';

test('website form with full name and checkbox consent', () => {
  const l = normalizeWebsiteForm(JSON.parse(readFileSync(new URL('../examples/website-lead.json', import.meta.url))));
  assert.equal(l.firstName, 'Dana');
  assert.equal(l.lastName, 'Example');
  assert.equal(l.phone, '+13125550123');
  assert.equal(l.email, 'dana@example.com');
  assert.equal(l.consent, true);
  assert.match(l.consentText, /not a condition of purchase/);
});

test('website form with first/last fields and no consent', () => {
  const l = normalizeWebsiteForm({ first_name: 'Lee', last_name: 'Example', phone: '312 555 0150', email: 'not-an-email' });
  assert.equal(l.firstName, 'Lee');
  assert.equal(l.email, null);
  assert.equal(l.consent, false);
});

test('consent values', () => {
  for (const v of [true, 'true', 'on', 'yes', '1', ['yes']]) assert.equal(isTruthyConsent(v), true, String(v));
  for (const v of [false, undefined, '', 'no', '0', []]) assert.equal(isTruthyConsent(v), false, String(v));
});

test('Facebook Graph lead mapping', () => {
  const l = normalizeFacebookLead({
    id: 'L1',
    field_data: [
      { name: 'first_name', values: ['Riley'] },
      { name: 'last_name', values: ['Example'] },
      { name: 'phone_number', values: ['+13125550142'] },
      { name: 'sms_consent', values: ['yes'] },
    ],
  });
  assert.deepEqual([l.source, l.firstName, l.phone, l.consent, l.externalId], ['facebook_lead_ad', 'Riley', '+13125550142', true, 'L1']);
});

test('Facebook webhook parsing: leadgen and new comments only', () => {
  const body = JSON.parse(readFileSync(new URL('../examples/facebook-webhook.json', import.meta.url)));
  body.entry[0].changes.push({ field: 'feed', value: { item: 'comment', verb: 'remove' } });
  const events = parseFacebookWebhook(body);
  assert.deepEqual(events.map((e) => e.type), ['leadgen', 'comment']);
  assert.equal(events[0].leadgenId, '100000000000001');
});

test('Facebook signature verification', () => {
  const raw = '{"object":"page"}';
  const secret = 'test-secret';
  const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  assert.equal(verifyFacebookSignature(raw, sig, secret), true);
  assert.equal(verifyFacebookSignature(raw, sig, 'wrong'), false);
  assert.equal(verifyFacebookSignature(raw, undefined, secret), false);
});
