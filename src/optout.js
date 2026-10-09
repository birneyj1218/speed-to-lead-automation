/**
 * Inbound SMS keyword handling (STOP / START / HELP).
 *
 * Opt-out detection deliberately errs toward honoring the request: the
 * standard keywords count when they are the whole message, and common
 * plain-English phrasings ("please stop texting me", "remove me") count
 * anywhere in the message. A false opt-out costs one lead; a missed one
 * can cost far more.
 */

export const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REVOKE'];
export const START_KEYWORDS = ['START', 'UNSTOP', 'SUBSCRIBE'];
export const HELP_KEYWORDS = ['HELP', 'INFO'];

const STOP_PHRASES =
  /\b(stop (texting|messaging|calling|contacting)|unsubscribe|opt[\s-]?out|remove me|take me off|do not (text|call|contact)|don'?t (text|call|contact))\b/i;

function clean(body) {
  return String(body ?? '')
    .trim()
    .replace(/[.!?,;:"'()]+/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Returns 'stop' | 'start' | 'help' | 'message'. */
export function classifyInboundSms(body) {
  const text = clean(body);
  if (STOP_KEYWORDS.includes(text)) return 'stop';
  if (START_KEYWORDS.includes(text)) return 'start';
  if (HELP_KEYWORDS.includes(text)) return 'help';
  if (STOP_PHRASES.test(String(body ?? ''))) return 'stop';
  return 'message';
}
