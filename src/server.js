/**
 * Decision service: a tiny HTTP API around the engine, called by the n8n
 * workflow (or Make.com). No framework, no dependencies.
 *
 *   POST /leads           { source, payload }       -> decision + actions + crm
 *   POST /steps/due       {}                        -> { actions }
 *   POST /steps/result    { stepId, ok, providerId?, error? }
 *   POST /call-status     { callId | stepId, status } or a raw Vapi end-of-call report
 *   POST /inbound-sms     { from, body }  (Twilio's From/Body also accepted)
 *   POST /reactivation    { leads: [...] }
 *   GET  /leads/:id       debug view
 *   GET  /health
 *
 * If DECISION_API_KEY is set, every request except /health must send it in X-Api-Key.
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createEngine } from './engine.js';
import { loadConfig } from './config.js';
import { MemoryStore, FileStore } from './store.js';
import { mapVapiEndedReason } from './adapters/vapi-voice.js';

const MAX_BODY = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const type = req.headers['content-type'] ?? '';
      try {
        resolve(type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function keyMatches(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({ engine, apiKey = null, log = () => {} }) {
  const routes = {
    'POST /leads': (b) => {
      if (!b.source) throw Object.assign(new Error('source is required'), { status: 400 });
      const r = engine.handleNewLead(b.source, b.payload ?? {});
      log(`lead ${r.leadId} ${b.source} -> ${r.decision}${r.reason ? ` (${r.reason})` : ''}`);
      return r;
    },
    'POST /steps/due': () => ({ actions: engine.dueActions() }),
    'POST /steps/result': (b) => engine.reportStepResult(b),
    'POST /call-status': (b) => {
      const msg = b.message ?? null; // raw Vapi server message
      if (msg?.type === 'end-of-call-report') {
        return engine.handleCallStatus({ callId: msg.call?.id, status: mapVapiEndedReason(msg.endedReason) });
      }
      return engine.handleCallStatus(b);
    },
    'POST /inbound-sms': (b) => engine.handleInboundSms({ from: b.from ?? b.From, body: b.body ?? b.Body }),
    'POST /reactivation': (b) => {
      if (!Array.isArray(b.leads)) throw Object.assign(new Error('leads must be an array'), { status: 400 });
      return engine.startReactivation(b.leads);
    },
  };

  return createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
      if (apiKey && !keyMatches(req.headers['x-api-key'], apiKey)) return send(401, { error: 'unauthorized' });

      const leadMatch = /^\/leads\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && leadMatch) {
        const lead = engine.getLead(leadMatch[1]);
        return lead ? send(200, lead) : send(404, { error: 'not found' });
      }
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(404, { error: 'not found' });
      const body = await readBody(req);
      return send(200, await handler(body));
    } catch (err) {
      const status = err.status ?? (/^Unknown (step|lead source)/.test(err.message) ? 400 : 500);
      return send(status, { error: err.message });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(); // .env in the working directory, if present (Node 20.12+)
  } catch {}
  const config = loadConfig();
  const store = process.env.STATE_FILE ? new FileStore(process.env.STATE_FILE) : new MemoryStore();
  const engine = createEngine({ config, store });
  const port = Number(process.env.PORT || 3030);
  const host = process.env.HOST || '127.0.0.1';
  createApp({ engine, apiKey: process.env.DECISION_API_KEY || null, log: (m) => console.log(new Date().toISOString(), m) }).listen(port, host, () => {
    console.log(`decision service for ${config.business.name} on http://${host}:${port}`);
  });
}
