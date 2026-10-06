# Send failures 131042 and 130429 (flow item M5)

| Code | Meta's meaning | Source |
|---|---|---|
| `131042` | Business eligibility payment issue: the payment-eligibility check failed (an empty or insufficient balance is one possible cause; do not parse the text to decide) | Kapso WhatsApp docs, prepaid billing |
| `130429` | Rate limit hit (also HTTP 429) | same |

Meta's guidance, followed here: do not retry in a tight loop; back off or pause the queue; surface it to the account admin; reconcile against delivery, not acceptance. A message can be accepted by the send call and then fail on the status webhook, so both paths are handled.

## What the bot does
1. **Detects** the failure two ways: a send rejected straight away (HTTP error body with the code, or 429), and a `failed` status webhook carrying the code (needs `whatsapp.message.failed` enabled in Kapso, see `docs/billing-log.md`).
2. **Records one incident per kind** through the atomic SQL function `record_send_failure` (table `send_incidents`). A new incident starts when nothing failed for 24 hours.
3. **Alerts the admin once per incident** (`ADMIN_WHATSAPP_PHONE`, same delivery limits as the budget alert: it needs the admin's 24-hour window; if the alert cannot be delivered it is retried at most hourly, and the incident is always in the function logs as `send_incident` with the kind, code, level and pause end, no phone and no content).
4. **Pauses broadcasts** (`send_paused_until()`): an owner who confirms an offer during a pause is told it is paused until about HH:MM and keeps the draft; nothing is claimed, reserved or sent. A broadcast already running stops at the first rate-limit / payment failure: the remaining recipients are skipped and credited back, and there is **no template fallback and no retry** for the failing recipient.
5. **Backs off** with a ladder (minutes): rate limit 5, 15, 60, 180, 360; payment 60, 360, 1440, 1440, 1440. A failure that arrives after a pause has run out moves to the next rung; failures already in flight during a pause do not escalate. Nothing resumes by itself earlier than the pause end; after 24 quiet hours the incident resets.

**Not paused:** order confirmations, status updates and replies to customers (they are not marketing, and a payment problem would fail them anyway). Order status messages that fail synchronously are retried only by the five-minute sweep, never in a loop.

## For the owner
`131042`: check Billing in WhatsApp Manager (payment method, balance, eligibility); there is no public balance API. `130429` that keeps coming back: slow down broadcasts or raise the sending tier.
