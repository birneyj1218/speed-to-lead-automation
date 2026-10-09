/**
 * Turn raw payloads from each lead source into one lead shape:
 * { source, firstName, lastName, phone, email, message, consent, consentText, externalId, receivedAt }
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePhone } from './phone.js';

const TRUTHY = new Set(['true', 'yes', 'y', 'on', '1', 'checked', 'agree', 'i agree']);

export function isTruthyConsent(value) {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(isTruthyConsent);
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function splitName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function cleanEmail(email) {
  const e = String(email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Website form webhook (field names vary by form builder, so accept the common ones). */
export function normalizeWebsiteForm(body = {}) {
  const named = body.first_name || body.firstName
    ? { firstName: body.first_name ?? body.firstName, lastName: body.last_name ?? body.lastName ?? '' }
    : splitName(body.name ?? body.full_name ?? body.fullName);
  return {
    source: 'website',
    firstName: String(named.firstName ?? '').trim(),
    lastName: String(named.lastName ?? '').trim(),
    phone: normalizePhone(body.phone ?? body.phone_number ?? body.mobile),
    email: cleanEmail(body.email),
    message: String(body.message ?? body.comments ?? '').slice(0, 2000),
    consent: isTruthyConsent(body.consent ?? body.sms_consent ?? body.tcpa_consent),
    consentText: body.consent_text ?? body.consentText ?? null,
    externalId: body.submission_id ?? body.id ?? null,
  };
}

/**
 * Facebook Lead Ads: the webhook only carries a leadgen_id; the lead itself is
 * fetched from the Graph API (GET /{leadgen_id}). This maps that response.
 * Consent comes from a custom checkbox question on the form (config.facebook.consentField).
 */
export function normalizeFacebookLead(graphLead = {}, { consentField = 'sms_consent' } = {}) {
  const fields = Object.fromEntries(
    (graphLead.field_data ?? []).map((f) => [f.name, Array.isArray(f.values) ? f.values : [f.values]]),
  );
  const first = (name) => (fields[name] ? fields[name][0] : undefined);
  const named = first('first_name')
    ? { firstName: first('first_name'), lastName: first('last_name') ?? '' }
    : splitName(first('full_name'));
  return {
    source: 'facebook_lead_ad',
    firstName: String(named.firstName ?? '').trim(),
    lastName: String(named.lastName ?? '').trim(),
    phone: normalizePhone(first('phone_number')),
    email: cleanEmail(first('email')),
    message: '',
    consent: isTruthyConsent(fields[consentField]),
    consentText: fields[consentField] ? `Lead form question "${consentField}"` : null,
    externalId: graphLead.id ?? null,
  };
}

/** A comment on a Facebook Page post. No phone and no consent, so it is logged for a human. */
export function normalizeFacebookComment(value = {}) {
  const named = splitName(value.from?.name);
  return {
    source: 'facebook_comment',
    firstName: named.firstName,
    lastName: named.lastName,
    phone: null,
    email: null,
    message: String(value.message ?? '').slice(0, 2000),
    consent: false,
    consentText: null,
    externalId: value.comment_id ?? null,
  };
}

export function normalizeLead(source, payload, config) {
  switch (source) {
    case 'website':
      return normalizeWebsiteForm(payload);
    case 'facebook_lead_ad':
      return normalizeFacebookLead(payload, config?.facebook);
    case 'facebook_comment':
      return normalizeFacebookComment(payload);
    case 'reactivation':
      return { ...normalizeWebsiteForm(payload), source: 'reactivation' };
    default:
      throw new Error(`Unknown lead source "${source}"`);
  }
}

/**
 * Split a Facebook Page webhook body into events we care about.
 * Returns [{ type: 'leadgen', leadgenId, formId, pageId } | { type: 'comment', value }].
 */
export function parseFacebookWebhook(body = {}) {
  const events = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field === 'leadgen') {
        events.push({ type: 'leadgen', leadgenId: v.leadgen_id, formId: v.form_id, pageId: v.page_id });
      } else if (change.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        events.push({ type: 'comment', value: v });
      }
    }
  }
  return events;
}

/** Verify Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyFacebookSignature(rawBody, header, appSecret) {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && timingSafeEqual(a, b);
}
