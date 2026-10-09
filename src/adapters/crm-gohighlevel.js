/**
 * GoHighLevel-style CRM adapter using the LeadConnector "upsert contact"
 * endpoint (matches on phone/email, so re-sending the same lead updates it).
 * Check field names against your own sub-account before going live.
 */
import { request } from './http.js';

export function goHighLevelCrm({ apiKey, locationId, baseUrl = 'https://services.leadconnectorhq.com', apiVersion = '2021-07-28', retry } = {}) {
  if (!apiKey || !locationId) throw new Error('goHighLevelCrm needs apiKey and locationId');
  return {
    name: 'gohighlevel',
    async upsertLead(p) {
      const res = await request(`${baseUrl}/contacts/upsert`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: apiVersion,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          locationId,
          firstName: p.firstName || undefined,
          lastName: p.lastName || undefined,
          phone: p.phone || undefined,
          email: p.email || undefined,
          source: p.source,
          tags: p.tags,
        }),
        ...retry,
      });
      return { id: res.contact?.id ?? null };
    },
  };
}
