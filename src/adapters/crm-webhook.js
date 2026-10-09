/**
 * Generic CRM adapter: POST the lead as JSON to any URL (Zapier/Make/n8n
 * catch hook, an internal API, a spreadsheet bridge). Signs the body with
 * HMAC-SHA256 so the receiver can verify it came from this system.
 * Interface shared by every CRM adapter: upsertLead(crmPayload) -> { id }
 */
import { createHmac } from 'node:crypto';
import { request } from './http.js';

export function webhookCrm({ url, signingSecret, retry } = {}) {
  if (!url) throw new Error('webhookCrm needs a url');
  return {
    name: 'webhook',
    async upsertLead(payload) {
      const body = JSON.stringify({ event: 'lead.upsert', lead: payload });
      const headers = { 'Content-Type': 'application/json' };
      if (signingSecret) headers['X-Signature-256'] = `sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}`;
      const res = await request(url, { headers, body, ...retry });
      return { id: res.id ?? payload.leadId };
    },
  };
}
