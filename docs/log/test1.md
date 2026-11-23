# TEST1: a working friends' test on staging, with the WhatsApp catalogue (23 November 2026)

Session TEST1. The founder's decision of 23 November: not launching yet (no stock, van, warehouse or label day); the founder's friends test
Alo King end to end on WhatsApp and the website, now. Decisions: `docs/DECISIONS.md`, "TEST1, a working friends' test on staging, 23 November
2026". Migrations **0271** (test mode), **0272** (the catalogue's product link), **0273** (the catalogue id, after the stage stop). No new
agent (invariant 21); no write by a model; Kabsi not touched.

## Built
1. **Test mode** (`settings.test_mode`, 0271). On for staging, impossible in production: a trigger refuses it on unless the database holds
   the staging mark (`deployment_marker`, written only by `scripts/staging/prepare-staging.sql`), and the gateway honours it only when its
   `ENVIRONMENT` is `staging`. The first deploy that marks staging switches it on; after that the Settings page decides ("Friends' test mode").
2. **The gate.** A number not on the tester list (console, People, Places, Testers) gets one short "we're not open yet" in its language
   (Arabic, English or French), before any model, every turn, voice notes included; no price, no menu. STOP and START still win. The probe
   keeps its own path.
3. **What testers order.** Any hour; every active item with a hub price (no stock, no label rule, no price-basis question); dishes of
   approved, testers-visible places (Safa Chicken once the founder approves it; the test kitchen now) at any hour; the minimum order holds;
   any pin (outside the area: the nearest served village's fee). The planner, the cart and the confirm tap's re-check all price for the
   tester (they priced for nobody before).
4. **Test orders** (`orders.is_test`). No stock moves, no rider is offered one, no picker sees one, no payment or ledger row; confirmed only
   by the customer's own tap; after it the order walks by itself, one step every 60 to 120 seconds, with the real customer messages: being
   prepared (food: "<place> took the order", the call ahead simulated and accepted with the place's preparation time), on the way, at the
   door, delivered, then the feedback question. A test order ends at delivered and never closes.
5. **The test line**: «🧪 طلب تجريبي: ما في توصيل ولا دفع» / "🧪 Test order: no delivery, no payment" on the card and on every status
   message of a test order, in the customer's language, added in one place around the gateway's send.
6. **Console**: «🧪 Test: no delivery, no payment» on test orders (list and page); **Clear test orders** (Orders page, ops lead or admin, a
   reason): open test orders cancelled without a customer notice, all of them off the list, logged in `test_mode_log`.
7. **The catalogue**: 0272 sets `catalog.product_link` to the customer line's wa.me link; deploy-staging proves `GET /catalog/feed.csv` after
   every deploy; the `catalog-setup` workflow does Meta's side through Kapso where the access allows (inspect, enable_cart, sets); in test
   mode every listed item is in stock.

## Tested (free)
- `test/db/test1-test-mode.test.ts` (14): the lock (off, refused without the mark, on with it); the gate (tester, stranger, probe); a
  tester's quote at a closed hour with no stock against a stranger's; the minimum; dishes; a far pin; a catalogue cart; the feed; a test
  order confirmed only by the tap (agent and system refused), nothing reserved, no rider or picker; the walk step by step to the feedback
  question, the same step back until its message is sent, never closing, no payment, ledger, stock or delivery row; a food test order's
  simulated call; a stranger's order untouched by the walk; clearing (staff only, a reason, test orders only, no notice, logged).
- `test/db/test1-flow.test.ts` (7), through the real turn code and gateway with the shop closed and the hub empty: a stranger refused in
  Arabic and English, a voice note answered, STOP; outside staging the gate is not asked; a tester's typed order (card with the test line,
  the tap, five walked messages each with the line, no stock or ledger row); a catalogue cart; a food order with required choices.
- `apps/console/test/test1-orders.test.ts` (2): the mark, clearing, the log, a picker refused.
- The message rules and snapshots (`messages.{ar,en,fr}.md`) with the two new messages; 🧪 allowed for the test line only.

## Founder actions (TEST1)
_Filled in at the end of the session._
