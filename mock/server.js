/**
 * Mock provider server for local demos and tests. It answers on the same
 * paths as the real APIs, so switching to production is only a base-URL
 * change:
 *
 *   POST /2010-04-01/Accounts/:sid/Messages.json   Twilio SMS (form-encoded)
 *   POST /call                                     Vapi outbound call
 *   POST /contacts/upsert                          GoHighLevel-style contact upsert
 *   POST /crm/webhook                              generic CRM webhook
 *   GET  /graph/:leadgenId                         Facebook Graph lead lookup (fake lead)
 *   GET  /_log    POST /_reset    POST /_fail      inspect, clear, or force the next N requests to 500
 *
 * Nothing is sent anywhere; every request is just recorded and printed.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createMockServer({ quiet = false } = {}) {
  const log = [];
  let counter = 0;
  let failNext = 0;

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type'] ?? '';
      let body = {};
      try {
        body = !raw ? {} : type.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
      } catch {
        body = { raw };
      }
      const url = new URL(req.url, 'http://localhost');
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (url.pathname === '/_log') return send(200, log);
      if (url.pathname === '/_reset') {
        log.length = 0;
        return send(200, { ok: true });
      }
      if (url.pathname === '/_fail') {
        failNext = Number(body.count ?? 1);
        return send(200, { failNext });
      }

      const entry = { at: new Date().toISOString(), method: req.method, path: url.pathname, body, auth: Boolean(req.headers.authorization) };
      if (failNext > 0) {
        failNext -= 1;
        log.push({ ...entry, kind: 'forced-failure' });
        return send(500, { error: 'mock forced failure' });
      }
      counter += 1;

      let kind;
      let reply;
      if (req.method === 'POST' && /^\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/.test(url.pathname)) {
        kind = 'sms';
        reply = { sid: `SM_mock_${counter}`, status: 'queued', to: body.To };
      } else if (req.method === 'POST' && url.pathname === '/call') {
        kind = 'call';
        reply = { id: `call_mock_${counter}`, status: 'queued' };
      } else if (req.method === 'POST' && url.pathname === '/contacts/upsert') {
        kind = 'crm';
        reply = { new: true, contact: { id: `contact_mock_${counter}` } };
      } else if (req.method === 'POST' && url.pathname === '/crm/webhook') {
        kind = 'crm';
        reply = { id: `crm_mock_${counter}` };
      } else if (req.method === 'GET' && url.pathname.startsWith('/graph/')) {
        kind = 'graph';
        reply = {
          id: url.pathname.split('/').pop(),
          created_time: new Date().toISOString(),
          field_data: [
            { name: 'full_name', values: ['Riley Example'] },
            { name: 'phone_number', values: ['+13125550142'] },
            { name: 'email', values: ['riley@example.com'] },
            { name: 'sms_consent', values: ['yes'] },
          ],
        };
      } else {
        return send(404, { error: 'mock: unknown endpoint' });
      }
      log.push({ ...entry, kind });
      if (!quiet) {
        const summary = kind === 'sms' ? `to ${body.To}: ${body.Body}` : kind === 'call' ? `to ${body.customer?.number} (assistant ${body.assistantId})` : JSON.stringify(body).slice(0, 160);
        console.log(`[mock ${kind}] ${summary}`);
      }
      return send(200, reply);
    });
  });
  return { server, log };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(); // .env in the working directory, if present (Node 20.12+)
  } catch {}
  const port = Number(process.env.MOCK_PORT || 4010);
  const host = process.env.HOST || '127.0.0.1';
  createMockServer().server.listen(port, host, () => console.log(`mock providers on http://${host}:${port}`));
}
