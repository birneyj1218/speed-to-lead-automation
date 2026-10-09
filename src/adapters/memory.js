/** In-memory adapters for tests and dry runs. Nothing leaves the process. */
export function memoryAdapters() {
  const sent = { sms: [], calls: [], crm: [] };
  let n = 0;
  return {
    sent,
    sms: { name: 'memory', async send(m) { sent.sms.push(m); return { id: `sms_${++n}` }; } },
    voice: { name: 'memory', async startCall(c) { sent.calls.push(c); return { id: `call_${++n}` }; } },
    crm: { name: 'memory', async upsertLead(l) { sent.crm.push(l); return { id: l.leadId }; } },
  };
}
