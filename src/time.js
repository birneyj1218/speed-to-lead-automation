/**
 * Time-zone aware helpers built on Intl, so there are no date-library
 * dependencies. All rule checks happen in the business's local time.
 */

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

/** Returns { weekday (0=Sun), minutes (since local midnight), dateKey (YYYY-MM-DD) }. */
export function localParts(date, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAYS[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** "09:30" -> 570 */
export function parseClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes > 24 * 60) throw new Error(`Invalid time "${hhmm}"`);
  return minutes;
}

export const MINUTE = 60 * 1000;

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * MINUTE);
}
