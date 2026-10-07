---
name: alo-order-flow
description: Use when implementing or reviewing Alo King customer discovery, menu browsing, basket, checkout, order confirmation, cancellation, substitution, reorder, Send Home, tracking links, or order-state behaviour.
---

# Alo King order flow

Rules come from `docs/decisions/DECISIONS.md` (it wins over this skill). Old behaviour for reference only: `docs/legacy/whatsapp-flow-spec.md`, `docs/legacy/customer-side.md`, `docs/legacy/vendor-orders.md`.

## Read first
- DECISIONS §1 (fees, COD cap, no zones), §3 (architecture), §4 (latency), §12 (Flows), §16 (places and addresses), §20 (money), §21 (delivery modes), §22 (Send Home), §23 (order channels).
- The order state machine and its race tests (Phase 2), the relevant migrations in `supabase/migrations/`, and the bot modules under `supabase/functions/`.

## Invariants
- The AI interprets; the server owns prices, baskets, payments and order states. A model never claims an order, payment, refund or delivery that a tool result did not confirm.
- Prices, fees, totals and the COD cap come from the database. Fee bands by road distance from the route matrix ($2 up to 3 km, $3 to 6 km, $4.50 to 10 km, nothing beyond 10 km), read from the fee-band table, never from code. A merchant may set a lower fee, never higher.
- No zones: a merchant is orderable once it passes go-live, and only for addresses inside its own delivery radius (road distance, max 10 km). Places in `service_status = paused` (South, Nabatieh) take no orders.
- Every customer total shows USD and LBP at the rate locked on the order (dated rate table), e.g. "$12.50 = 1,118,750 LBP (rate locked at order)".
- An order is created only by the customer's explicit confirmation of the current summary (button tied to the summary, or a clear yes in a later message). One vendor per order.
- At confirmation the server re-checks price, availability, hours, pause state, delivery radius and COD cap; the confirmed order keeps its price snapshot.
- Address: WhatsApp location pin first, snapped to a place by polygon; else district then place lists or the `address_capture` Flow. Free text alone is never an address.
- Languages: Arabic, English, French and Arabizi, including mixed Arabic-French and Arabic-English. Reply in the customer's latest language.
- Taps, STOP, basket edits and status use a deterministic path with zero model calls; at most three messages per customer turn.
- Tracking links are signed and expire; they show only status, merchant, order code, total, broad area and an ETA range: no coordinates, no items.
- Send Home (§22): the bot asks once who the order is for; sender and recipient numbers are both stored; foreign cards go through Tap only.

## Workflow
1. Map the current state and every actor that can change it.
2. Name the source of truth for price, availability, hours, address, payment and delivery.
3. Check authorization and row-level security; check idempotency and races.
4. Design customer, merchant, driver and operator messages within WhatsApp limits (`supabase/functions/_shared/meta-limits.ts`; add new card builders to its test).
5. Add failure and timeout behaviour; implement the smallest safe change; add tests.
6. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Edge cases to cover
Duplicate confirm tap; confirm after basket expiry; price change between summary and confirm; item sold out; merchant closes or pauses during checkout; address outside the radius; duplicate webhook; cancel racing with accept; merchant reject; no driver; payment pending or failed; COD above the cap; human handoff; stale tracking link; "delete my data"; voice note that cannot be transcribed.

## Never
Trust a client, Flow or model price; create an order from an ambiguous yes; silently change an item or a total; mark paid from a redirect; mark delivered from a model reply; expose another customer's order or address; hard-code a rate, fee or cap.

## Report
Current vs intended behaviour, state transitions, files, migration and RLS impact, messages changed, tests, commands run, risks, rollback.
