/**
 * AI voice call-back via Vapi's outbound call API.
 * Interface shared by every voice adapter: startCall({ to, assistant, variables }) -> { id }
 *
 * `assistant` is a logical name from config ("business_hours" / "after_hours");
 * assistantIds maps it to the provider's assistant id.
 */
import { request } from './http.js';

export function vapiVoice({ apiKey, phoneNumberId, assistantIds = {}, baseUrl = 'https://api.vapi.ai', retry } = {}) {
  if (!apiKey || !phoneNumberId) throw new Error('vapiVoice needs apiKey and phoneNumberId');
  return {
    name: 'vapi',
    async startCall({ to, assistant, variables = {} }) {
      const assistantId = assistantIds[assistant] ?? assistantIds.default;
      if (!assistantId) throw new Error(`No Vapi assistant id configured for "${assistant}"`);
      const res = await request(`${baseUrl}/call`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantId,
          phoneNumberId,
          customer: { number: to, name: [variables.firstName, variables.lastName].filter(Boolean).join(' ') || undefined },
          assistantOverrides: { variableValues: variables },
        }),
        ...retry,
      });
      return { id: res.id };
    },
  };
}

/**
 * Map Vapi's end-of-call `endedReason` onto the engine's call statuses.
 * Anything that means a conversation happened counts as "answered".
 */
export function mapVapiEndedReason(endedReason = '') {
  const r = String(endedReason);
  if (r === 'customer-did-not-answer') return 'no_answer';
  if (r === 'customer-busy') return 'busy';
  if (r === 'voicemail') return 'voicemail';
  if (['customer-ended-call', 'assistant-ended-call', 'assistant-said-end-call-phrase', 'exceeded-max-duration', 'assistant-forwarded-call'].includes(r)) {
    return 'answered';
  }
  return 'failed';
}
