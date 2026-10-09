/**
 * Phone helpers. Numbers are stored in E.164 (+15550100123 style) so that
 * dedup and opt-out lookups match no matter how the lead typed them.
 */

export function normalizePhone(input, defaultCountryCode = '1') {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');

  if (raw.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (defaultCountryCode === '1') {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
  }
  return digits.length >= 6 ? `+${defaultCountryCode}${digits}` : null;
}

/** Hide all but the last four digits, for logs. */
export function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone);
  return s.length <= 4 ? s : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}
