# Meta billing log and cost per order (flow item M3)

`message_billing_log` stores, for every message WE send, what Meta says about it: the status, `pricing.billable`, `pricing.type`, `pricing.category`, `pricing.pricing_model`, the error code if it failed, the message type (text / interactive / template, plus the template name), and who it went to. **No message content is stored.** It is filled by `kapso-brain` from Kapso's message status webhooks (`billing.ts`).

## Turning it on (owner step: a production webhook setting)
The Kapso webhook for the production number currently subscribes to `whatsapp.message.received` only. Add **`whatsapp.message.sent`** (Meta puts `pricing` on the sent status) and **`whatsapp.message.failed`** (error codes, used by the failure handling in M5). `delivered` and `read` are optional: they add traffic (three events per message) but no new pricing information. Status events arrive on the same URL with the same authentication, with the event name in the `X-Webhook-Event` header; the code handles them before the inbound pipeline, so they never start a conversation turn.

Order of rollout: merge and deploy this change first (so the function understands status events), then add the events in Kapso. Subscribing earlier would send status events to a function that treated them as unknown messages.

## Rates
`meta_rates (category, usd_per_message, source, effective_from)` is empty on purpose: the Lebanon USD rate is only published in Meta's CSV rate card and was not available when this was built. After downloading it, insert one row per category you use, for example (replace the numbers with the real ones):
```sql
insert into meta_rates(category, usd_per_message, source) values ('service', 0.00000, 'Meta USD rate card <date>');
```

## Reading it (service role / SQL editor only)
- `message_cost_per_order`: per order, the messages sent to the customer's phone from 30 minutes before the order until 15 minutes after delivery or cancellation (6 hours after placing it while it is open, at most 12 hours): `messages_total`, `messages_billable`, `messages_free`, `billable_by_category`, `est_meta_usd` (only categories with a rate), `rates_missing`, `ai_usd` and `total_est_usd`.
- Counts come from Meta's own `billable` flag, so they are real even before any rate is entered. Orders from one customer that overlap in time share messages (each counts them).
- The first thing to check: whether in-window service messages are `billable: true` after Meta's announced 1 Oct 2026 change (the messages seen on 5 Oct were still `billable: false`, see `docs/message-audit.md`).

## Privacy
Rows hold a phone number only to join them to orders. "Delete my data" clears `to_phone` (the pricing flags stay, they identify nobody), and the scheduled purge deletes rows after 90 days, like `ai_call_log`.
