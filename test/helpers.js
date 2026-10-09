import { readFileSync } from 'node:fs';
import { createEngine } from '../src/engine.js';

export const baseConfig = () => JSON.parse(readFileSync(new URL('../config/blue-gable-roofing.json', import.meta.url), 'utf8'));

// Fixed reference times in America/Chicago (CDT, UTC-5, in October 2026)
export const TUE_10AM = '2026-10-13T15:00:00Z';
export const TUE_6PM = '2026-10-13T23:00:00Z'; // after business hours, inside contact window
export const TUE_1030PM = '2026-10-14T03:30:00Z'; // quiet hours
export const WED_9AM = '2026-10-14T14:00:00Z';

export function setup({ at = TUE_10AM, config = baseConfig() } = {}) {
  const clock = { t: new Date(at) };
  let n = 0;
  const engine = createEngine({ config, now: () => clock.t, newId: () => `lead${++n}` });
  return { engine, clock, set: (iso) => (clock.t = new Date(iso)), config };
}

export const lead = (over = {}) => ({ name: 'Dana Example', phone: '(312) 555-0123', consent: 'on', message: 'Roof leak', ...over });
