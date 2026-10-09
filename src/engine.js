/**
 * The decision engine. It never talks to a provider itself: it decides what
 * should happen and returns "actions" (send this SMS, place this call). The
 * n8n workflow, Make.com scenario, or src/dispatch.js carries them out and
 * reports back, which keeps every rule here unit-testable.
 */
import { randomUUID } from 'node:crypto';
import { normalizeLead } from './normalize.js';
import { normalizePhone } from './phone.js';
import { isBusinessHours, isContactAllowed, nextAllowedTime } from './rules.js';
import { classifyInboundSms } from './optout.js';
import { render, templateVars } from './templates.js';
import { planReactivation } from './reactivation.js';
import { addMinutes, MINUTE } from './time.js';
import { MemoryStore } from './store.js';

const ACTIVE = new Set(['pending', 'dispatched']);

export function createEngine({ config, store = new MemoryStore(), now = () => new Date(), newId = randomUUID } = {}) {
  if (!config) throw new Error('createEngine needs a config');

  const iso = (d) => new Date(d).toISOString();

  function dedupKey(lead) {
    if (lead.phone) return `phone:${lead.phone}`;
    if (lead.email) return `email:${lead.email}`;
    if (lead.externalId) return `ext:${lead.source}:${lead.externalId}`;
    return null;
  }

  function crmPayload(record, note) {
    return {
      leadId: record.id,
      firstName: record.firstName,
      lastName: record.lastName,
      phone: record.phone,
      email: record.email,
      source: record.source,
      status: record.status,
      consent: record.consent,
      tags: [`source:${record.source}`, `status:${record.status}`],
      note,
    };
  }

  function publicLead(record) {
    const { steps, history, ...rest } = record;
    return rest;
  }

  function stopSequence(record, status, why, t) {
    record.stopped = true;
    record.status = status;
    for (const step of record.steps) {
      if (step.status === 'pending') {
        step.status = 'canceled';
        step.note = why;
      }
    }
    record.history.push({ at: iso(t), event: status, detail: why });
  }

  function scheduleSequence(record, t, sequence) {
    const first = nextAllowedTime(t, config);
    let prev = first;
    record.steps = sequence.map((s) => {
      let at = nextAllowedTime(addMinutes(first, s.offsetMinutes ?? 0), config);
      if (at < prev) at = nextAllowedTime(prev, config);
      prev = at;
      return {
        id: `${record.id}:${s.id}`,
        key: s.id,
        channel: s.channel,
        template: s.template ?? null,
        at: iso(at),
        status: 'pending',
        attempts: 0,
      };
    });
  }

  function buildAction(record, step, t) {
    const vars = templateVars(record, config);
    const open = isBusinessHours(t, config);
    if (step.channel === 'sms') {
      let name = step.template;
      if (name === 'instant' && !open && config.templates.instant_after_hours) name = 'instant_after_hours';
      return { stepId: step.id, leadId: record.id, type: 'sms', to: record.phone, body: render(config.templates[name], vars) };
    }
    return {
      stepId: step.id,
      leadId: record.id,
      type: 'call',
      to: record.phone,
      assistant: open ? config.voice.businessHoursAssistant : config.voice.afterHoursAssistant,
      variables: { ...vars, source: record.source, message: record.message ?? '' },
    };
  }

  /** Mark due steps as dispatched and return their actions. */
  function takeDue(record, t) {
    const due = record.steps.filter((s) => s.status === 'pending' && new Date(s.at) <= t);
    if (due.length === 0) return [];
    if (record.stopped || store.isOptedOut(record.phone)) {
      for (const s of due) s.status = 'canceled';
      return [];
    }
    if (!isContactAllowed(t, config)) {
      const at = iso(nextAllowedTime(t, config));
      for (const s of due) s.at = at;
      return [];
    }
    // Several steps on the same channel can be due at once (after downtime, or
    // a retry landing next to the next follow-up). Stale ones are skipped
    // unless they are the newest; of the rest, only the first goes now and the
    // others wait a few minutes, so a lead never gets a burst of texts.
    const STALE = (config.staleAfterMinutes ?? 30) * MINUTE;
    const GAP = config.minGapMinutes ?? 5;
    const actions = [];
    for (const channel of ['sms', 'call']) {
      const group = due.filter((s) => s.channel === channel);
      const fresh = group.filter((s, i) => {
        if (i < group.length - 1 && t - new Date(s.at) > STALE) {
          s.status = 'skipped';
          s.note = 'stale, superseded by a later step';
          return false;
        }
        return true;
      });
      fresh.forEach((s, i) => {
        if (i > 0) {
          s.at = iso(nextAllowedTime(addMinutes(t, GAP), config));
          return;
        }
        s.status = 'dispatched';
        s.attempts += 1;
        s.dispatchedAt = iso(t);
        actions.push(buildAction(record, s, t));
      });
    }
    return actions;
  }

  function findStep(stepId) {
    const leadId = String(stepId).split(':')[0];
    const record = store.getLead(leadId);
    const step = record?.steps.find((s) => s.id === stepId);
    if (!record || !step) throw new Error(`Unknown step ${stepId}`);
    return { record, step };
  }

  return {
    config,
    store,

    /** A new lead arrived. Returns the decision, any actions to run now, and the CRM record. */
    handleNewLead(source, payload) {
      const t = now();
      const lead = normalizeLead(source, payload, config);
      const key = dedupKey(lead);

      if (key) {
        const prev = store.getDedup(key);
        const existing = prev && store.getLead(prev.leadId);
        if (existing && t - new Date(prev.at) < config.dedupWindowMinutes * MINUTE) {
          existing.email ||= lead.email;
          if (lead.message && lead.message !== existing.message) {
            existing.message = [existing.message, lead.message].filter(Boolean).join('\n---\n');
          }
          existing.history.push({ at: iso(t), event: 'duplicate', detail: `again via ${lead.source}` });
          store.saveLead(existing);
          return {
            decision: 'duplicate',
            reason: `same contact within ${config.dedupWindowMinutes} minutes`,
            leadId: existing.id,
            lead: publicLead(existing),
            actions: [],
            crm: crmPayload(existing, `Submitted again via ${lead.source}; no new outreach.`),
            nextStepAt: null,
          };
        }
        if (existing && !existing.stopped) {
          stopSequence(existing, existing.status, 'superseded by a newer submission', t);
          store.saveLead(existing);
        }
      }

      const record = {
        id: newId(),
        ...lead,
        receivedAt: iso(t),
        status: 'new',
        stopped: false,
        steps: [],
        history: [{ at: iso(t), event: 'received', detail: lead.source }],
      };

      let decision;
      let reason = null;
      if (!lead.phone) {
        decision = 'log_only';
        reason = 'no_phone';
      } else if (store.isOptedOut(lead.phone)) {
        decision = 'suppressed';
        reason = 'opted_out';
      } else if (config.requireConsent && !lead.consent) {
        decision = 'log_only';
        reason = 'no_consent';
      }

      let actions = [];
      if (!decision) {
        scheduleSequence(record, t, config.sequence);
        record.status = 'in_sequence';
        actions = takeDue(record, t);
        decision = actions.length > 0 ? 'contact' : 'deferred';
        if (decision === 'deferred') reason = 'quiet_hours';
      } else {
        record.status = decision === 'suppressed' ? 'opted_out' : 'needs_review';
        record.stopped = true;
      }

      if (key) store.setDedup(key, { leadId: record.id, at: iso(t) });
      store.saveLead(record);

      const next = record.steps.find((s) => s.status === 'pending');
      const notes = {
        contact: 'Instant text and call-back sent.',
        deferred: 'Arrived during quiet hours; outreach scheduled for the next contact window.',
        log_only: reason === 'no_phone' ? 'No phone number; needs a human.' : 'No SMS/call consent; logged for a human, no automated outreach.',
        suppressed: 'Number previously opted out; no outreach.',
      };
      return {
        decision,
        reason,
        leadId: record.id,
        lead: publicLead(record),
        actions,
        crm: crmPayload(record, notes[decision]),
        nextStepAt: next ? next.at : null,
      };
    },

    /** Called on a schedule (every minute). Returns actions that are due now. */
    dueActions() {
      const t = now();
      const actions = [];
      for (const record of store.allLeads()) {
        if (!record.steps.some((s) => s.status === 'pending' && new Date(s.at) <= t)) continue;
        const a = takeDue(record, t);
        store.saveLead(record);
        actions.push(...a);
      }
      return actions;
    },

    /** The workflow reports whether the provider accepted the SMS/call. Failures are retried with backoff. */
    reportStepResult({ stepId, ok, providerId = null, error = null }) {
      const t = now();
      const { record, step } = findStep(stepId);
      if (step.status !== 'dispatched') return { stepId, status: step.status, ignored: true };
      if (ok) {
        step.status = 'sent';
        step.providerId = providerId;
        if (step.channel === 'call' && providerId) store.linkCall(providerId, { leadId: record.id, stepId });
        record.lastContactedAt = iso(t);
        store.saveLead(record);
        return { stepId, status: 'sent' };
      }
      step.lastError = String(error ?? 'unknown error').slice(0, 500);
      const { maxAttempts, backoffMinutes } = config.retry;
      if (step.attempts < maxAttempts && !record.stopped) {
        const wait = backoffMinutes[Math.min(step.attempts - 1, backoffMinutes.length - 1)];
        step.status = 'pending';
        step.at = iso(nextAllowedTime(addMinutes(t, wait), config));
        store.saveLead(record);
        return { stepId, status: 'retry_scheduled', retryAt: step.at };
      }
      step.status = 'failed';
      record.history.push({ at: iso(t), event: 'step_failed', detail: step.key });
      store.saveLead(record);
      return { stepId, status: 'failed' };
    },

    /** Outcome of a voice call (from the provider's end-of-call webhook). */
    handleCallStatus({ callId = null, stepId = null, status }) {
      const t = now();
      const ref = stepId ? { stepId } : store.findCall(callId);
      if (!ref) return { action: 'ignored', reason: 'unknown call' };
      const { record, step } = findStep(ref.stepId);
      step.outcome = status;
      if (status === 'answered') {
        stopSequence(record, 'contacted', 'call answered', t);
        store.saveLead(record);
        return { leadId: record.id, action: 'sequence_stopped', crm: crmPayload(record, 'Lead answered the call-back.') };
      }
      if (status === 'failed' && step.status === 'dispatched') {
        return { leadId: record.id, action: 'step_result', ...this.reportStepResult({ stepId: step.id, ok: false, error: 'call failed' }) };
      }
      store.saveLead(record);
      return {
        leadId: record.id,
        action: 'sequence_continues',
        crm: crmPayload(record, `Call-back outcome: ${status}. Follow-up sequence continues.`),
      };
    },

    /** Inbound text from a lead: STOP/START/HELP, or a real reply that ends the sequence. */
    handleInboundSms({ from, body }) {
      const t = now();
      const phone = normalizePhone(from);
      const kind = classifyInboundSms(body);
      const leads = phone ? store.leadsByPhone(phone) : [];
      const vars = templateVars(leads[leads.length - 1], config);

      if (kind === 'stop') {
        if (phone) store.setOptOut(phone, iso(t));
        for (const r of leads) {
          stopSequence(r, 'opted_out', 'STOP received', t);
          store.saveLead(r);
        }
        return {
          kind,
          action: 'opted_out',
          reply: config.sms.sendOptOutConfirmation ? render(config.templates.opt_out_confirmation, vars) : null,
          leadIds: leads.map((r) => r.id),
          crm: leads.length ? crmPayload(leads[leads.length - 1], 'Opted out by text (STOP). Do not contact.') : null,
        };
      }
      if (kind === 'start') {
        if (phone) store.clearOptOut(phone);
        return { kind, action: 'opted_in', reply: render(config.templates.opt_in_confirmation, vars), leadIds: leads.map((r) => r.id), crm: null };
      }
      if (kind === 'help') {
        return { kind, action: 'help', reply: render(config.templates.help, vars), leadIds: leads.map((r) => r.id), crm: null };
      }
      for (const r of leads) {
        if (!r.stopped) stopSequence(r, 'replied', 'lead replied by text', t);
        r.history.push({ at: iso(t), event: 'inbound_sms', detail: String(body ?? '').slice(0, 500) });
        store.saveLead(r);
      }
      return {
        kind,
        action: leads.length ? 'needs_human' : 'unknown_sender',
        reply: null,
        leadIds: leads.map((r) => r.id),
        crm: leads.length ? crmPayload(leads[leads.length - 1], `Lead replied: "${String(body ?? '').slice(0, 300)}"`) : null,
      };
    },

    /** Database reactivation: schedule a rate-limited batch of texts to old leads. */
    startReactivation(rows) {
      const t = now();
      const plan = planReactivation(rows, {
        now: t,
        config,
        isOptedOut: (p) => store.isOptedOut(p),
        hasActiveSequence: (p) => store.leadsByPhone(p).some((r) => !r.stopped && r.steps.some((s) => ACTIVE.has(s.status))),
      });
      for (const item of plan.scheduled) {
        const record = {
          id: newId(),
          ...item.lead,
          receivedAt: iso(t),
          status: 'reactivation',
          stopped: false,
          history: [{ at: iso(t), event: 'reactivation_planned', detail: item.ref }],
          steps: [],
        };
        record.steps = [
          { id: `${record.id}:reactivation`, key: 'reactivation', channel: 'sms', template: config.reactivation.template, at: item.sendAt, status: 'pending', attempts: 0 },
        ];
        store.saveLead(record);
      }
      return {
        scheduled: plan.scheduled.length,
        firstSendAt: plan.scheduled[0]?.sendAt ?? null,
        lastSendAt: plan.scheduled[plan.scheduled.length - 1]?.sendAt ?? null,
        skipped: plan.skipped,
      };
    },

    getLead(id) {
      return store.getLead(id);
    },
  };
}
