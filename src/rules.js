/**
 * Business-hours and quiet-hours rules.
 *
 * - contactWindow: when automated texts/calls may go out at all. Anything
 *   outside it is "quiet hours" and outreach is deferred, never dropped.
 * - businessHours: when the office is staffed. Changes the wording of the
 *   first text and which voice assistant answers, not whether we contact.
 */
import { localParts, parseClock, MINUTE } from './time.js';

export function isWithinWindow(date, window, timeZone) {
  const { weekday, minutes } = localParts(date, timeZone);
  if (!window.days.includes(weekday)) return false;
  return minutes >= parseClock(window.start) && minutes < parseClock(window.end);
}

export function isBusinessHours(date, config) {
  return isWithinWindow(date, config.businessHours, config.business.timezone);
}

export function isContactAllowed(date, config) {
  return isWithinWindow(date, config.contactWindow, config.business.timezone);
}

/**
 * The earliest moment at or after `date` when outreach is allowed.
 * Jumps straight to the next window opening instead of polling, and
 * re-checks after each jump so DST changes settle correctly.
 */
export function nextAllowedTime(date, config) {
  const tz = config.business.timezone;
  const start = parseClock(config.contactWindow.start);
  let t = new Date(date);
  for (let i = 0; i < 16; i += 1) {
    if (isContactAllowed(t, config)) return t;
    const { minutes } = localParts(t, tz);
    let delta = (start - minutes + 1440) % 1440;
    if (delta === 0) delta = 1440; // at window start, but today is not an allowed day
    const trimmed = t.getTime() - (t.getTime() % MINUTE); // drop seconds
    t = new Date(trimmed + delta * MINUTE);
  }
  throw new Error('contactWindow never opens; check days/start/end in config');
}
