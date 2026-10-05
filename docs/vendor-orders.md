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

Columns: `orders.vendor_notified_at` (card delivered), `orders.escalated_at`.
