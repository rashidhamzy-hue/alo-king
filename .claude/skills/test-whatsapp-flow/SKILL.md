---
name: test-whatsapp-flow
description: Run end-to-end dry-run tests of the Alo King WhatsApp bot (kapso-brain) for the customer order flow, owner price edits with duplicate item names, and the owner broadcast flow. Use after changing kapso-brain or its prompts, or before a release.
---

# Test the WhatsApp flows (dry run)

`kapso-brain` accepts an `x-selftest: <token>` header (token = a live row in `selftest_tokens`). In that mode it **does not call Kapso**: it returns `{ "out": [...] }`, the exact payloads it would have sent. Everything else is real: LLM calls, **DB writes** (customers, carts, orders, broadcasts, credits, menu prices).

## Setup
1. Needs network access to `hnjkietmwvkgbyrcnweq.supabase.co` (the cloud environment's Allowed domains).
2. Create a short-lived token (Supabase `execute_sql`): `insert into selftest_tokens(token, expires_at) values ('t-<random>', now() + interval '3 hours');` then `export SELFTEST_TOKEN=t-<random>`.
3. Test identities only: customers `961700000001..`, owner `961700000099`. Link the owner temporarily: `update vendors set owner_whatsapp_phone='961700000099' where vendor_id='al-tahouneh-restaurant-36524'`.
4. Note original prices before editing. Vendor `al-tahouneh-restaurant-36524` has duplicates: `…-soft-drinks` and `…-soft-drinks-2` ($2.50 each).

`send.sh <phone> text "<msg>"` or `send.sh <phone> reply "<button id>" "<title>"` prints each outgoing message (interactive cards show body, button ids, titles and title lengths).

## Cases and expected results
**Order flow** (customer)
- Ask for an item with name, village and landmark in one message → exactly **one** interactive summary card: dual-currency lines (`$ · LBP`), $2.00 delivery, `CONFIRM|<cart id>` / `EDIT|…` / `LOC` buttons, every title ≤ 20 chars. **No** "ORDER RECEIVED" in that turn (the customer must confirm themselves).
- `send.sh … reply "CONFIRM|<id>" "✅ Confirm Order"` → "ORDER RECEIVED" text + opt-in card; one `orders` row, `status=pending`. Tapping again → "expired or already placed".
- Alternative: reply `yes confirm` as a new message → same result.
- Recommendation cards: button reads `Order Now ($x.xx)` (no emoji), and no free text follows a card.

**Price edits with duplicate names** (owner)
- `Change Soft Drinks to $3` → asks which item (lists both, with sections); changes nothing.
- `Change both Soft Drinks to $3` → both updated; `undo` reverts (one item per undo).
- Language: Arabic message → Arabic reply; English message → English reply, even after an Arabic turn.
- A change >3x the current price must ask for confirmation first.

**Broadcast flow** (owner)
- Opt a test customer in (`reply "OPTIN|1"`), who must have ordered from the vendor.
- `Send 10% off … to my customers` → one preview card: reach, cost ($0.05/msg), credit before → after, `BCAST|OK|<id>` / `BCAST|NO|<id>` buttons, nothing after it.
- Send → payload to each opted-in customer: a plain `text` message if they wrote to us in the last 24h, otherwise the `template` for their language (`alo_offer_ar` / `alo_offer_en_optout`), "Broadcast done", credit reduced. Cancel → nothing sent, no charge. Tapping an already-handled card → "already handled".

**Vendor order card and 90 s escalation** (see `docs/legacy/vendor-orders.md`)
- Confirming an order → the owner (linked test number) gets a card with `ORDER|ACC|…` / `ORDER|REJ|…`; `reply "ORDER|ACC|<id>" "✅ Accept"` from the owner → status `accepted` + customer notice; Reject → `rejected` + notice; a second tap → "already handled".
- Escalation: leave an order pending, backdate it (`update orders set created_at = now() - interval '2 minutes' where id = '…'`), then `curl -X POST -H "x-selftest: $SELFTEST_TOKEN" -H "x-selftest-admin: 961700000095" "$URL?job=order-watchdog"` → customer "still confirming" + admin ping; a second call escalates nothing. Dry job runs only touch `961700000…` orders.

**Customer side** (see `docs/legacy/customer-side.md`)
- Reorder: for a customer with a pending/accepted order, `hi` → card with `REORDER|<id>`; `reply "REORDER|<id>" "Reorder last order"` → a fresh summary (re-priced) with a Confirm button, no order until Confirm.
- Opt-out: `STOP`, `Stop offers`, and `tpl-button OPTOUT "Stop offers"` each set `marketing_opt_in=false` at once (check `customers`); `stop the order` / `cancel my order` do not.
- Source: an event with `"message": {..., "referral": {"source_type":"ad","source_id":"1","ctwa_clid":"x"}}` or the text `ORDER_BAAK_SANAWBAR_T12` sets `customers.acquisition_*` once.

## Cleanup (always)
- Restore any changed prices; `update vendors set owner_whatsapp_phone=null, broadcast_credits_usd=10.00 where vendor_id=…`.
- Expire the token: `update selftest_tokens set expires_at=now()-interval '1 minute' where token='…'`.
- Test rows (`961700000%` in customers/carts/orders/conversations/`admin:961700000%`, `broadcasts`, `admin_actions`, `processed_messages` with `wamid.t4.%`): cancel test orders and set `marketing_opt_in=false`; delete them with DELETE statements when the SQL tool allows it.

## Gotchas
- `execute_sql` DELETEs and `UPDATE`s without a `WHERE` can hang (60 s timeout) waiting on a confirmation; use specific `WHERE` clauses, and delete in a SQL console if needed.
- Dry run still spends LLM tokens and mutates data; never use real customer phones.
