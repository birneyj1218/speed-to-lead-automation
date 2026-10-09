/**
 * Run engine actions against real adapters and report results back to the
 * engine. This is what the n8n workflow does with HTTP nodes; having it in
 * code too makes the whole loop testable and lets the service run without n8n.
 */
export async function dispatchActions(engine, actions, { sms, voice }) {
  const results = [];
  for (const action of actions) {
    try {
      const res = action.type === 'sms' ? await sms.send(action) : await voice.startCall(action);
      results.push(engine.reportStepResult({ stepId: action.stepId, ok: true, providerId: res.id }));
    } catch (err) {
      results.push(engine.reportStepResult({ stepId: action.stepId, ok: false, error: err.message }));
    }
  }
  return results;
}

export async function syncCrm(crmPayload, { crm }) {
  if (!crmPayload) return null;
  try {
    return await crm.upsertLead(crmPayload);
  } catch (err) {
    // CRM trouble must never block the text-back; surface it for a human instead.
    return { error: err.message };
  }
}
