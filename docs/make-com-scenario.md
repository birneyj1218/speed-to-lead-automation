# Make.com version

I have built this kind of flow in Make.com for clients as well as in n8n. This is a written walkthrough rather than an exported blueprint file: a blueprint is tied to one account's connections and app versions, and an unvalidated one would not import cleanly. The modules below map one-to-one to the n8n workflow, and both call the same decision service.

## Scenario 1: New lead (instant)

Trigger: **Webhooks > Custom webhook** (one per source, or one shared hook with a `source` field). Scheduling: immediately.

1. **Webhooks > Custom webhook**. Paste its URL into the website form. For Facebook Lead Ads, use Make's **Facebook Lead Ads > Watch Leads** trigger instead; it fetches the answers for you.
2. **HTTP > Make a request** to `POST {DECISION_API_URL}/leads` with body `{ "source": "website", "payload": {{1.body}} }`, header `X-Api-Key`, "Parse response" on.
3. **Router** with three routes:
   - **CRM** (always): the HighLevel app's create-or-update-contact module mapped from `crm.*`, or **HTTP > Make a request** to any CRM webhook. Add an error handler with **Ignore** so CRM trouble never blocks the text-back.
   - **Actions** (filter: `actions[]` length > 0): **Iterator** over `actions`, then a second **Router**:
     - filter `type = sms`: **Twilio > Create a Message** (To = `to`, Body = `body`).
     - filter `type = call`: **HTTP > Make a request** `POST https://api.vapi.ai/call` with the assistant chosen by `assistant`.
     - After each, **HTTP > Make a request** `POST {DECISION_API_URL}/steps/result` with `ok`, `stepId`, and the provider's id. On the provider module, add an error handler route that reports `ok: false` and then **Resume**.
4. **Webhooks > Webhook response** with status 200.

## Scenario 2: Follow-ups (scheduled)

Scheduling: every 1 minute (Make's shortest interval; depends on plan).

1. **HTTP > Make a request** `POST {DECISION_API_URL}/steps/due`.
2. **Iterator** over `actions`, then the same SMS / call / report modules as Scenario 1. Clone them, or move them into a third scenario that Scenarios 1 and 2 call through a webhook so the logic lives in one place.

## Scenario 3: Inbound SMS and call outcomes

1. **Webhooks > Custom webhook** set as the Twilio number's incoming-message URL.
2. **HTTP > Make a request** `POST {DECISION_API_URL}/inbound-sms` with `From` and `Body`.
3. **Webhooks > Webhook response** with `Content-Type: text/xml` and TwiML: `<Response><Message>{{reply}}</Message></Response>` when `reply` is set, otherwise `<Response/>`.
4. **Router > CRM** when `crm` is present: update the contact (status `replied` or `opted_out`) and, for replies, notify a person (email, Slack, or a CRM task).

A second webhook receives Vapi end-of-call reports and forwards them to `POST /call-status`.

## Make-specific tips

- **Operations.** Every module run counts. The one-minute follow-up poll is the main cost; on a small plan, poll every 5 minutes and set the first follow-up to 10 minutes.
- **No decision service?** You can keep dedup and opt-outs in **Data stores** (key = E.164 phone) and use **Tools > Sleep** for short waits, but Sleep caps at a few minutes and every rule ends up spread across filters. The decision service keeps the rules testable, which is why this repo uses it.
- **Incomplete executions.** Turn on "Store incomplete executions" so a failed run can be retried from the Make dashboard instead of silently losing a lead.
