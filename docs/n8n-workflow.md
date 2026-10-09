# n8n workflow

File: [`n8n/speed-to-lead.json`](../n8n/speed-to-lead.json). Import it in n8n with **Workflows > Import from File**.

## Webhooks it exposes

| Path | Method | Point this at it |
|---|---|---|
| `/webhook/speed-to-lead/website` | POST | Your website form's webhook / "send to URL" setting |
| `/webhook/speed-to-lead/facebook` | GET + POST | Meta App > Webhooks > Page subscription (`leadgen`, `feed`) |
| `/webhook/speed-to-lead/sms-inbound` | POST | Twilio number > Messaging > "A message comes in" |
| `/webhook/speed-to-lead/call-status` | POST | Vapi assistant > Server URL (end-of-call reports) |
| `/webhook/speed-to-lead/reactivation` | POST | You, with `{ "leads": [...] }` and the header-auth key |

## Node map

1. **Website form / Facebook events** normalize into `{ source, payload }`.
   Lead Ads only send a `leadgen_id`, so **Fetch lead from Graph API** pulls the answers. Page comments go straight to the decision service and are logged for a human (no phone, no consent).
2. **Decide (decision service)** returns the decision, the actions to run now, and a CRM payload.
3. **Has CRM update? > Upsert CRM contact** logs or updates the lead. It continues on error, so a CRM outage never blocks the text-back. A disabled **CRM webhook (generic alternative)** node posts to any URL instead.
4. **Actions to items > SMS or call?** fans actions out to **Send SMS (Twilio)** and **Start AI call (Vapi)**.
5. **Build step result > Report step result** tells the decision service whether each send worked. Failures are retried by the service (with backoff and quiet-hours checks), not by n8n.
6. **Every minute > Get due follow-ups** feeds scheduled follow-ups (and reactivation texts) into the same action path.
7. **Inbound SMS** asks the service to classify the text (STOP / START / HELP / real reply) and answers Twilio with TwiML.
8. **Call ended** passes Vapi's end-of-call report to the service: answered stops the sequence; no-answer, busy or voicemail lets it continue.

## Credentials to create

The workflow carries no credentials. After import, create these and select them on the matching nodes:

| Credential type | Used by | Values |
|---|---|---|
| Basic Auth | Send SMS (Twilio) | user = Account SID, password = Auth Token |
| Header Auth | Start AI call (Vapi) | `Authorization` = `Bearer <Vapi private key>` |
| Header Auth | Upsert CRM contact | `Authorization` = `Bearer <CRM token>` |
| Facebook Graph API | Fetch lead from Graph API | Page access token with `leads_retrieval` |
| Header Auth | Start reactivation batch | any header name and a long random value |

Non-secret settings (base URLs, account SID, phone-number and assistant IDs) are read from environment variables (see `.env.example`). That needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, which `docker-compose.yml` sets.

## Notes and caveats

- **Facebook signature.** Meta signs webhook bodies (`X-Hub-Signature-256`). n8n's webhook node does not expose the raw body by default, so the workflow does not verify it. Before production, enable the webhook's raw-body option and check the signature in a Code node, or put the check in the decision service (`verifyFacebookSignature()` in `src/normalize.js` is ready and tested).
- **Twilio Advanced Opt-Out.** If your Messaging Service has Advanced Opt-Out on, Twilio replies to STOP itself. Set `sms.sendOptOutConfirmation` to `false` in the config to avoid a double reply. Either way the decision service records the opt-out.
- **Website form exposure.** The website webhook is public by design. Add a hidden honeypot field, CAPTCHA, or rate limit in front of it if bots find it.
- **Tested how.** The JSON is generated and checked by `test/n8n-workflow.test.js` (every connection resolves, every node is wired, no credentials or hard-coded hosts). Node types and versions target n8n 1.x/2.x. The mock server mirrors the provider paths so the whole flow can be exercised locally.
