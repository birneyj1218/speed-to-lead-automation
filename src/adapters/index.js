/**
 * Build adapters from environment variables (see .env.example).
 * SMS_PROVIDER=twilio|memory, VOICE_PROVIDER=vapi|memory, CRM_PROVIDER=gohighlevel|webhook|memory
 */
import { twilioSms } from './twilio-sms.js';
import { vapiVoice } from './vapi-voice.js';
import { webhookCrm } from './crm-webhook.js';
import { goHighLevelCrm } from './crm-gohighlevel.js';
import { memoryAdapters } from './memory.js';

export { twilioSms, vapiVoice, webhookCrm, goHighLevelCrm, memoryAdapters };
export { mapVapiEndedReason } from './vapi-voice.js';

export function adaptersFromEnv(env = process.env) {
  const mem = memoryAdapters();
  const sms =
    env.SMS_PROVIDER === 'twilio'
      ? twilioSms({
          accountSid: env.TWILIO_ACCOUNT_SID,
          authToken: env.TWILIO_AUTH_TOKEN,
          from: env.TWILIO_FROM_NUMBER,
          messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
          baseUrl: env.TWILIO_BASE_URL || undefined,
        })
      : mem.sms;
  const voice =
    env.VOICE_PROVIDER === 'vapi'
      ? vapiVoice({
          apiKey: env.VAPI_API_KEY,
          phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
          assistantIds: { business_hours: env.VAPI_ASSISTANT_ID_BUSINESS_HOURS, after_hours: env.VAPI_ASSISTANT_ID_AFTER_HOURS },
          baseUrl: env.VAPI_BASE_URL || undefined,
        })
      : mem.voice;
  let crm = mem.crm;
  if (env.CRM_PROVIDER === 'gohighlevel') {
    crm = goHighLevelCrm({ apiKey: env.GHL_API_KEY, locationId: env.GHL_LOCATION_ID, baseUrl: env.GHL_BASE_URL || undefined });
  } else if (env.CRM_PROVIDER === 'webhook') {
    crm = webhookCrm({ url: env.CRM_WEBHOOK_URL, signingSecret: env.CRM_WEBHOOK_SECRET });
  }
  return { sms, voice, crm, sent: mem.sent };
}
