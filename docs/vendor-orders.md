# Vendor order card and 90 s escalation

When a customer confirms an order (`confirmCart` in `kapso-brain`):
1. The order is inserted (`status = pending`, prices computed server-side) and the customer gets the receipt.
2. If the vendor has linked an owner WhatsApp number, the kitchen gets an interactive card: order code, customer, items, **total in USD and LBP**, address, notes, with **Accept** / **Reject** buttons (`ORDER|ACC|<id>`, `ORDER|REJ|<id>`). The card is an in-window message, so it is only delivered if the owner messaged the Alo King number in the last 24h.
3. Accept → `accepted`, Reject → `rejected` (only while still `pending`, only by that vendor's owner); the customer is told, in their language (`customers.language`, default Arabic), with the prep time when the vendor set one. Rejection invites them to pick another kitchen.
4. 90 s after confirmation, if the order is still `pending`: the customer gets a "still confirming" message and the admin (`ADMIN_WHATSAPP_PHONE`, in-window message) gets a ping. Each order is escalated at most once (`orders.escalated_at`); orders older than 30 min and web-demo orders are ignored.

Mechanisms (no pg_cron):
- **Timer**: `confirmCart` starts a 90 s timer with `EdgeRuntime.waitUntil` for that order.
- **Scheduled check**: `.github/workflows/order-watchdog.yml` calls `POST kapso-brain?job=order-watchdog` every 5 minutes (best effort). It needs the secret `WATCHDOG_SECRET` in **both** GitHub (repo secret) and Supabase (function secret); while unset, the job endpoint refuses every request and the workflow skips.
- **Dry run**: `POST …?job=order-watchdog` with `x-selftest` returns the messages it would send and only touches test orders (`961700000…`).

Limits to know:
- Both the kitchen card and the admin ping are in-window messages: they are only delivered if that person messaged the Alo King number in the last 24h. If the card isn't delivered, `vendor_notified_at` stays empty and the only signal is the 90 s escalation, which goes to the admin, not the owner. An approved utility template would remove this limit.
- If the customer notice itself fails to send, `escalated_at` is cleared so the next scheduled run retries; a failed admin ping is only logged.

Columns: `orders.vendor_notified_at` (card delivered), `orders.escalated_at`.

## Customer lifecycle messages (flow item 4)
- The kitchen / driver apps call the JWT-verified `order-notify` function after every status change; it checks the caller is staff for that order, then sends the customer a free-form WhatsApp message (accepted, preparing, on the way with the tracking link, delivered + a 1–5 star rating list, cancelled, rejected). Only inside the customer's 24h window. The scheduled `order-watchdog` job also runs a sweep as backup (every 5 min), so a failed call is retried. Each status is claimed atomically via `orders.customer_notified_status` (no duplicates).
- The "order received" message has a **Cancel order** button; it works only while the order is still `pending` (the status flip is atomic against the kitchen's Accept). After accept the customer is told the team will help.
- If the vendor closes or pauses while an order is still pending (>3 min), the customer gets Cancel / Keep waiting buttons.
- If a dish sells out after confirm (`menu_items.available = false`), the customer gets one offer: swap for a close substitute (same section, ≤25% dearer; price and the new total come from the database, quantity kept, COD cap enforced) or cancel. Dishes with options get cancel-only. The vendor is told what changed.
- Ratings go to `order_ratings`; 1–2 stars also ping `ADMIN_WHATSAPP_PHONE`.

## Privacy: "delete my data" / "forget my address"
- Customers can send *delete my data*, *forget my address* (or Arabic / Arabizi: احذف بياناتي، احذف عنواني، e7zef bayanati، emsa7 3enwani) at any time; it works in every mode and never reaches the model. The bot confirms exactly what was deleted, or says it could not finish (it never claims a deletion that failed).
- `address`: saved addresses, location pins/coordinates, the current delivery address, unconfirmed summaries. `all`: also name, language, acquisition source, saved baskets, voice transcripts, chat history, AI call log phone link, and marketing is switched off (opt-out is kept so they are never messaged again).
- **Kept** (policy default, to be confirmed by legal counsel): finished orders keep items, totals, dates, vendor and the phone number (settlements, disputes); their name, address and notes are removed (open orders are anonymised by the scheduled job once they finish). Ratings and substitution offers keep only the phone plus a score / item id.
- The one-line privacy notice is shown once, before the first card that stores an address or pin; `customers.data_consent_at` records when (notice display, not a marketing opt-in). `customers.last_inbound_at` keeps the 24h-window clock after chat history is deleted.
