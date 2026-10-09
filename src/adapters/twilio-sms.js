/**
 * SMS via Twilio's Messages API.
 * Interface shared by every SMS adapter: send({ to, body }) -> { id }
 */
import { request } from './http.js';

export function twilioSms({ accountSid, authToken, from, messagingServiceSid, statusCallbackUrl, baseUrl = 'https://api.twilio.com', retry } = {}) {
  if (!accountSid || !authToken) throw new Error('twilioSms needs accountSid and authToken');
  if (!from && !messagingServiceSid) throw new Error('twilioSms needs a from number or messagingServiceSid');
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  return {
    name: 'twilio',
    async send({ to, body }) {
      const form = new URLSearchParams({ To: to, Body: body });
      if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
      else form.set('From', from);
      if (statusCallbackUrl) form.set('StatusCallback', statusCallbackUrl);
      const res = await request(`${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        ...retry,
      });
      return { id: res.sid };
    },
  };
}
