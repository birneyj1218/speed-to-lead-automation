import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseClock } from './time.js';

export const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../config/blue-gable-roofing.json', import.meta.url));

export function validateConfig(config) {
  const errors = [];
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.business?.timezone });
  } catch {
    errors.push(`business.timezone "${config.business?.timezone}" is not a valid IANA zone`);
  }
  for (const w of ['businessHours', 'contactWindow']) {
    try {
      if (parseClock(config[w].start) >= parseClock(config[w].end)) errors.push(`${w}.start must be before ${w}.end`);
      if (!config[w].days.length) errors.push(`${w}.days is empty`);
    } catch (e) {
      errors.push(`${w}: ${e.message}`);
    }
  }
  for (const step of config.sequence ?? []) {
    if (!['sms', 'call'].includes(step.channel)) errors.push(`sequence step ${step.id}: channel must be sms or call`);
    if (step.channel === 'sms' && !config.templates?.[step.template]) errors.push(`sequence step ${step.id}: missing template "${step.template}"`);
  }
  if (errors.length) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  return config;
}

export function loadConfig(path = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH) {
  return validateConfig(JSON.parse(readFileSync(path, 'utf8')));
}
