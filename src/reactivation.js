/**
 * Database reactivation: plan a rate-limited batch of texts to old leads.
 * Pure function: it decides who gets a message and when; the engine stores
 * the plan and the normal due-steps loop sends it.
 */
import { normalizeLead } from './normalize.js';
import { nextAllowedTime } from './rules.js';
import { localParts, parseClock, MINUTE } from './time.js';

const DAY = 24 * 60 * MINUTE;

function endOfWindow(t, config) {
  const { minutes } = localParts(t, config.business.timezone);
  const end = parseClock(config.contactWindow.end);
  return new Date(t.getTime() + Math.max(end - minutes, 0) * MINUTE);
}

export function planReactivation(rows, { now, config, isOptedOut = () => false, hasActiveSequence = () => false }) {
  const { messagesPerMinute, dailyCap, skipIfContactedWithinDays } = config.reactivation;
  if (!(messagesPerMinute > 0) || !(dailyCap > 0)) throw new Error('reactivation.messagesPerMinute and dailyCap must be > 0');
  const spacingMs = 60000 / messagesPerMinute;
  const tz = config.business.timezone;
  const nowMs = new Date(now).getTime();

  const scheduled = [];
  const skipped = [];
  const seen = new Set();

  let t = nextAllowedTime(now, config);
  let dayKey = localParts(t, tz).dateKey;
  let sentToday = 0;

  rows.forEach((row, index) => {
    const ref = row.id ?? `row-${index + 1}`;
    const lead = normalizeLead('reactivation', row, config);
    const last = row.last_contacted_at ?? row.lastContactedAt;

    let reason = null;
    if (!lead.phone) reason = 'no_phone';
    else if (row.opted_out === true || isOptedOut(lead.phone)) reason = 'opted_out';
    else if (config.requireConsent && !lead.consent) reason = 'no_consent';
    else if (seen.has(lead.phone)) reason = 'duplicate';
    else if (hasActiveSequence(lead.phone)) reason = 'active_sequence';
    else if (last && nowMs - new Date(last).getTime() < skipIfContactedWithinDays * DAY) reason = 'contacted_recently';

    if (reason) {
      skipped.push({ ref, reason });
      return;
    }
    seen.add(lead.phone);

    if (sentToday >= dailyCap) {
      t = endOfWindow(t, config);
    }
    t = nextAllowedTime(t, config);
    const key = localParts(t, tz).dateKey;
    if (key !== dayKey) {
      dayKey = key;
      sentToday = 0;
    }
    scheduled.push({ ref, lead, sendAt: t.toISOString() });
    sentToday += 1;
    t = new Date(t.getTime() + spacingMs);
  });

  return { scheduled, skipped };
}
