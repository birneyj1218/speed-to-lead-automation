import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, maskPhone } from '../src/phone.js';

test('normalizes common US formats to E.164', () => {
  for (const input of ['(312) 555-0123', '312.555.0123', '3125550123', '1-312-555-0123', '+1 312 555 0123']) {
    assert.equal(normalizePhone(input), '+13125550123', input);
  }
});

test('rejects junk', () => {
  for (const input of ['', null, undefined, '555-0123', 'call me', '+12']) assert.equal(normalizePhone(input), null);
});

test('masks all but last four digits', () => {
  assert.equal(maskPhone('+13125550123'), '********0123');
});
