# Alo King Chouf: implementation baseline

Date: 12 November 2026. Planning is closed. This file is the status and the business rules.
The roadmap is `docs/BUILD_PLAN.md`. Rules the code must never break are in `CLAUDE.md`. Costs are in `docs/COST_MODEL.md`.
Everything needed is in this repository. The original Master Blueprint is not, on purpose: where any older document or
conversation disagrees with these files, these files win. `docs/history/` is superseded material.

## Business rules (founder decisions, final for now)

1. **Riders keep 100% of delivery fees and 100% of tips. No hourly wage.**
   The delivery fee is collected on the rider's behalf. It is not Alo King revenue.
   In the ledger it lands in `revenue_delivery` at payment and moves to `rider_payable:<driver>` when the order closes
   (`settle_rider_earnings`, migration 0009). `rider_statement()` shows cash held, earnings, and what to hand over.
   `settings.rider_pay` holds the shares and a `min_guarantee_per_hour_usd` (0 today) for a possible future guarantee.
2. **Only onboarded restaurants are orderable.** A restaurant needs accepted terms, an approved menu with prices, and a
   contracted commission. `approve_merchant()` is the only way to open one; a trigger keeps unapproved ones closed.
   There are no signed partners yet. The dark store is the whole launch catalog until there are.
   A customer asking for an unsigned restaurant is told it is not available yet. Nobody phones the order in.
3. **The service area and the hub are not decided.** The hub will likely be in Baakline, Baqaata or between them, possibly
   near VCC Baakline. That is a planning reference, not a confirmed property. `supabase/seed/villages.sql`, the zones and
   their fees are a draft and stay data, never code: see "Hub and zones" in `docs/BUILD_PLAN.md`.
   Final zones wait for: hub location, measured travel times, rider earnings, and later restaurant coverage.
4. **Neutral, factual, no ratings.** Alo King helps customers find available options that match a request. It never rates,
   praises or criticises a merchant or product, and never calls food healthy. Sorting is by measurable facts. The customer decides.
5. **Food facts only from approved records.** Allergens, ingredients, halal, vegetarian, vegan, fasting and nutrition are stated
   only from approved records, with their status. Unknown is never safe. Nothing is inferred about a person's religion or health.
6. **Explicit restrictions outrank everything**, including learned habits and any paid placement. Customers control what is saved.
7. **No marketing sends.** Switched off in the database. The customer number is never used for promotions. See the build plan.
8. **Small-order fee** is supported as a setting and is company income, separate from the rider's fee. Amount and threshold undecided.
9. **Restaurants:** conversations start during the pilot or earlier; nothing unsigned is orderable. The goal is all of Chouf.
10. **Website and diaspora orders** are Phase 9, after the pilot. WhatsApp-first until then.
11. **Voice notes** are welcome within configurable limits per sender role; voice never authorises money.
12. Unchanged from before: no tobacco or alcohol; nothing branded Tawfeer; Joud and Super Value stay out; COD in USD or LBP
   at the daily rate; Whish and OMT confirmed by a person; rider cash cap soft 150, hard 200; text and interactive
   messages only, never outbound audio; opt-out always wins.

## How to run

```
npm install
npx tsc --noEmit
npx vitest run          # 965 tests (40 live-only skipped); apps/console/test/* drive the console's pages; test/db/* run the real migrations in PGlite;
                        # test/pg/* start a throwaway Postgres 16 (or use TEST_DATABASE_URL) and the Worker in workerd
DATABASE_URL=... scripts/check_permissions.sh    # on a scratch Postgres, and on a Supabase branch before launch
```
`TEST_REPORT.txt` is the captured run for this tree.

## Status

### A. Built and covered by automated tests
| Area | Where | Notes |
| --- | --- | --- |
| Schema, state machine, ledger, consent | migrations 0001-0003 | `order-machine.ts` is checked against the table in a test |
| Hardening: skipped-step taps, per-currency cash, exposure cap, timers, indexed search | 0004 | |
| Rider flow: shift, dispatch, batching, accept, pickup, arrive, deliver, collect, no-answer, prepaid confirm | 0006, `apps/gateway/src/ops-turn.ts` | Rider messages are parsed by code, no model |
| Hub flow on the ops line: pick, missing item, substitute, refunds and credit, rider offered at pick start, returns by button, rider incident | 0030-0035, `apps/gateway/src/ops-turn.ts` | Session C2 below; staff messages are parsed by code, no model |
| Scheduled orders: windows and a calendar as data, capacity held at the tap, cut-offs, changes, rescheduling, the rider in time for the window | 0040-0041, `packages/agents/src/order-card.ts` | Session C3 below; the customer side is lane B's to wire |
| Reliability: turn keys, outbox lease, inbound reconciliation, exception queue | 0007, 0008, `apps/gateway/src/index.ts` | Lease means at-least-once after a crash, by design |
| Stale-quote and address checks at confirmation | 0007 `confirm_order_checked` | |
| Returned goods after a failed delivery | 0008 `receive_return` | Chilled, frozen, fresh are written off unless cleared |
| Learning: customer memory, alias promotion, eval capture | 0007 | |
| Menu import from a link, merchant approval | 0007, 0009, `packages/agents/src/menu-fetch.ts` | A person approves every import |
| Rider earnings: fees and tips to the rider, kept from USD then LBP cash, remainder from the hub | 0009, 0010, `test/db/rider-settlement.test.ts` | Acceptance test: customer pays fully in lira, books reconcile |
| Marketing kill switch; voice-note policy (customer line); neutrality and food-facts prompt rules | 0011, `packages/core/src/voice-policy.ts`, `prompts/concierge.md` | The rules are enforced on model text by the output guard since B2 (1.10) |
| Pilot locks: the gateway refuses to send unless the outbox claim returns true; marketing cannot be switched on by a settings write | 0012, `packages/wa/src/gateway.ts`, `packages/wa/test/gateway-outbox.test.ts` | Both were real defects found in review on 12 Nov; see below |
| CI, secret and dependency scanning, staging and production Worker environments, runbook | `.github/workflows/ci.yml`, `wrangler.jsonc`, `docs/RUNBOOK.md` | Written and dry-run locally; not yet run on GitHub or Cloudflare |
| Cash message parser, job cards, merchant channel adapters | `packages/core`, `packages/agents` | |

Two defects fixed on 12 November 2026, both confirmed in the code before the fix:
- The gateway sent the message when the outbox claim returned a database error. The Concierge test's fake database had no
  `outbox_claim`, so every test send had been going out through that hole. It now throws `OutboxUnavailable` and the turn retries.
- Migration 0011 seeded the marketing switch with "do nothing on conflict", so a database that already had it on kept it on.
  0012 forces it off and a trigger rejects any write that enables it. The gateway also refuses marketing in code.

Outbound send audit, 12 November 2026. Every path that sends was read. Before the audit, five ops alerts had no key and
two reply paths sent unkeyed when a turn key was missing. Now `dedupeKey` is required by the type, the gateway refuses a send
without one, and every path has a stable key:

| Path | Key | Stable across a retry? |
| --- | --- | --- |
| Customer replies (`turn.ts`) | turn key + message index | Yes. The turn key is the sorted inbound message ids. |
| Rider replies (`ops-turn.ts`) | turn key + message index | Yes |
| Ops alerts raised inside a rider turn (cash drop, no answer, error) | turn key + alert name + recipient | Yes |
| Rider job offer | `offer:` + delivery id | Yes |
| No rider available | `norider:` + order + 5-minute bucket | Yes within the bucket; repeats by design after it |
| Offer expired, cash reminder, unpaid, exception due, returns pending, door wait | event id + time bucket + recipient | Yes within the bucket |
| Customer notices (on the way, rider waiting) | notice + order | Yes |
| Give-up alert after three failed attempts | `giveup:` + turn key | Yes |

Known limit: reply keys use the message's position in the turn. If a retried turn produces its replies in a different order,
a different sentence could be skipped as "already sent". The turn record (`begin_turn`, `finish_turn`) makes this rare; task 4.5
tests a crash in the middle of a turn. Templates do not exist yet; when 4.3 adds them, each is keyed on order + event.

### Session B1 (ordering), 13 November 2026: tasks 1.1, 1.2, 1.3, 1.9, 1.15, 1.19, 1.20
Built and tested locally (PGlite with every migration, vitest; permission check on Postgres 16 in fresh and EXISTING=1 modes; Worker dry run for staging and production). Nothing here is proven live.

| Task | Where | Tested by |
| --- | --- | --- |
| 1.9 Concierge flow on the real schema; ten voice-note cases | `test/db/concierge-flow.test.ts`, `test/db/supabase-shim.ts`, `evals/voice_notes/cases/` | The flow test runs the Durable Object, turn code, tools, SQL and gateway; only the model and Kapso's HTTP endpoint are replaced. `evals/test/voice-cases.test.ts` |
| 1.1 Parse once, then the database | `packages/agents/src/concierge.ts` (`extractOrder`, `runAskLoop`), `pipeline.ts`, `apps/gateway/src/turn.ts` | One forced `extract_order` call; `plan_order` answers card / ask; a card or pin request goes out with no second call; a pin for a waiting card sends it with no model; the loop gets the reading and the plan |
| 1.2 Unsigned restaurants | migration 0013, `pipeline.ts` | "Not available yet" in one fixed line, no handoff, no order; mixed message names it before the grocery card; only `approve_merchant()` makes a merchant searchable |
| 1.3 Answers without the model | migration 0014, `packages/agents/src/answers.ts`, `quick-intent.ts`, `evals/cases/quick_intents.json` | Status, hours, do-you-deliver-to-X, out-of-area order, same as last time (typed short forms with no model call; the same answers when the extraction reads those intents) |
| 1.20 Same as last time, one button | migration 0015, `answers.ts` | Offered only with a closed (delivered and paid) order, once per six hours; tap re-prices at today's price; missing items named before the card; someone else's order refused. A stale card at the confirm tap is rebuilt the same way, with no model |
| 1.19 No phone in the webhook | migration 0016, `packages/agents/src/phone.ts`, `issueCard()` | Fixture with only a business-scoped id: number asked before the card, stored in `parties.contact_phone`, card sent on arrival with no model; rider job card shows it; it is never used as a WhatsApp address |
| 1.15 Model capacity | `packages/agents/src/capacity.ts`, `turn.ts` | Overload once: one "one moment", then the card. Overload throughout: retries at 2, 5, 12 s, then handoff, ops exception, and the customer is told. Retried turn does not repeat "one moment". A 400 is not retried |

Also: migration 0017 revokes the leftover `anon` / `authenticated` grants on `ops_exceptions` (A1's finding under 0.4).
Also fixed in `turn.ts`: an `OutboxUnavailable` error inside the Concierge path was being turned into a handoff; it now propagates so the turn retries (invariant 20).

Only a live account can prove: the forced extraction's quality on the real model (scored by 1.10 and 5.8); real Kapso payloads without a phone (the fixture follows Kapso's documented shape); which status codes Anthropic returns under load.

For other sessions (B1 did not touch these files):
- A2 (`apps/gateway/src/index.ts`): build the Anthropic client with `maxRetries: 0`. `turn.ts` now retries capacity failures itself, with the "one moment" message; the SDK's own two silent retries only delay it.
- C1 (1.12 demand log): the misses to log are `plan.unavailable` (unsigned restaurant), `answerOutOfArea` (village not served), `repeat_plan().missing`, and plan lines with status `not_found`.
- Anyone redefining `rider_job()`: migration 0016 changed only its `phone` to `customer_contact_phone(o.customer_id)`. Keep that line.
- C2 (substitutions): `basket_from_order()` repeats only `order_items` with status `ok`. A substitute the customer received must end with status `ok` to be repeated.
- The session worked on branch `claude/build-session-b1-3mvmy8` (the branch this environment allows) rather than `B1`.

### Session C1 (hub), 13 November 2026: migration 0020, tasks 1.11, 1.12, 2.6, 2.7, 2.11
Built and tested locally (PGlite with every migration, vitest; permission check on Postgres 16 in fresh and EXISTING=1 modes). Migrations 0020 to 0025; 0026 to 0029 are unused and stay reserved for C1.
Applied to staging by `deploy-staging` after the merge; what that proves is at the end of this section.

| Task | Where | Tested by |
| --- | --- | --- |
| 0020 `pg_trgm` out of `public` (A1's 0.4 finding) | migration 0020, `scripts/check_permissions.sh` | `test/db/extensions-schema.test.ts`: the extension sits in `extensions`; search, the planner and village lookup still match with `search_path = public`; every trigram index now uses `extensions.gin_trgm_ops` and still serves the `%` operator; a guard fails if any function that calls a trigram function loses its pinned `search_path`. The permission check now **fails** on an extension function in `public` and on a client role able to call one (shown failing on a database with the extension moved back), and runs a trigram search as `service_role` |
| 1.11 Food facts | migration 0021 | `test/db/food-facts.test.ts`, including the acceptance test "unknown fails, sponsored item must pass": no record, unapproved, expired, partial, unknown status and unknown restriction all fail; may contain fails an allergy; certified needs evidence; Open Food Facts is never approved on its own; a sponsored item passes only on the same approved facts |
| 1.12 Demand signals | migration 0022 | `test/db/demand-signals.test.ts`: B1's four misses (unsigned restaurant, unknown product, out of area, repeat missing) plus out-of-stock lines are logged by `plan_order` and `repeat_plan` themselves; a retried turn is not counted twice; a failing log never breaks the plan; `unmet_demand()` groups by distinct customers |
| 2.6 Stock adjustments | migration 0023 | `test/db/stock-adjustments.test.ts`: reason, name and note on every adjustment; picker limit; reserved stock protected; double tap is a no-op; shelf counts |
| 2.7 Suppliers, receiving, cost | migration 0024 | `test/db/receiving-margin.test.ts`, the acceptance test "cost at receiving gives margin; ledger at zero", through the real order and rider path: moving average cost, cost of goods against the order at pick, a failed delivery that comes back reverses it, waste to stock loss, supplier paid, every transaction and the whole ledger at zero, inventory account equal to units times average cost |
| 2.11 Recall and supplier credit | migration 0025 | `test/db/recall.test.ts`: one hold takes the product off search and quotes, makes the waiting card stale and blocks the pick by any path; the recall list with the number to phone; release restores the catalog; price credit, goods sent back and credit beyond shelf value |

How the pieces fit, for whoever builds next:
- **Planner functions are wrappers now.** `plan_order` and `repeat_plan` are VOLATILE wrappers that log demand, then return `plan_order_core` / `repeat_plan_core` (B1's functions, unchanged and renamed). PostgREST runs STABLE functions read-only, so the logging could not live in them. **B2 and anyone else: change the planner by redefining `plan_order_core` or `repeat_plan_core`, never the wrappers.** `test/db/demand-signals.test.ts` fails if a wrapper stops logging.
- **Trigram functions live in the `extensions` schema.** A function that calls `similarity()`, `word_similarity()` or the `%` operator must be declared with `set search_path = public, extensions, pg_temp` (a `create or replace` drops the clause unless it is repeated). `plan_order_core`, `search_catalog`, `search_products` and `resolve_place` have it. The guard in `test/db/extensions-schema.test.ts` names any that lose it. 0020 also revoked `anon`/`authenticated` USAGE on `extensions` (nothing of Supabase's auth, storage or realtime depends on it; checked on staging); the console must reach the database as `service_role`, as planned.
- **Every stock movement is valued.** A trigger on `stock_movements` posts cost for `pick` (cost of goods, against the order), `return` (reversal), `waste` and `adjust` (stock loss) at the moving average. Receipts and supplier returns post in their own functions. C2: a `pick` row carries the units leaving as a **positive** `qty_delta` (as `settle_stock` does); keep that, or the posting's sign is wrong. Products never received with a cost post nothing, and `gross_margin()` reports `uncosted_units_sold` until Phase 5 values the opening stock (`value_opening_stock`, or the first receipt).
- **Held products cannot be reserved or picked**, by trigger (`PRODUCT_ON_HOLD`). C2's picker flow (2.1, 2.2) must offer "remove" or a substitute for such a line; 3.16 (allergen complaint) calls `hold_product`.
- **Food facts are stored and checked; B2 has wired them into the Concierge**: the `food_facts` tool calls `product_food_facts` and `product_meets_restrictions`, and its approved facts feed the output guard (see the B2 section). 5.15 (label scan) calls `propose_product_fact`; a person approves with `approve_product_fact`.
- C3 logs a full slot with `log_demand('no_slot', ...)`. D1/D2 wire `receive_goods`, `adjust_stock`, `count_stock`, `hold_product`/`release_hold`, `recall_orders`, `record_supplier_credit`, `pay_supplier`, `gross_margin`, `inventory_valuation`, `expiring_stock` and `unmet_demand`; each takes the acting party, which the console must take from the signed-in session, never from the browser.
- The session worked on branch `claude/lucid-hawking-iv4id3` (the branch this environment allows) rather than `C1`.
- **Live (13 Nov, after the merge):** `deploy-staging` run `43404520947` passed, including the stricter permission check in `EXISTING=1` mode. Read back from staging with read-only queries: migrations 0020-0025 recorded; `pg_trgm` in `extensions`; no extension function left in `public`; `anon` and `authenticated` have no USAGE on `extensions`; `plan_order_core` carries the pinned `search_path`; `search_catalog('labneh')` returns matches. So A1's 0.4 finding is closed on staging. Food facts, demand, receiving and recall are applied there but have not been used with real data yet.
- Seen in passing, not C1's lane: the two `deploy-staging` runs on `main` before this merge (`43398527053`, `43399003048`) failed in the `worker` job at the Sentry ingest check with HTTP 429 ("dropped data due to a quota or internal rate limit"). Run `43404520947` passed. This bears on 0.8: check the Sentry org quota when someone with Sentry access looks at the project.

### Session C2 (hub), 13 November 2026: tasks 2.1, 2.2, 2.3, 2.4, 2.5, 2.10
Migrations 0030 to 0035 (0036 to 0039 are unused and stay reserved for C2). Built and tested locally: PGlite with every migration and
`npx vitest run` (651 pass after rebasing on D1), every migration applied by psql on a real Postgres 16 by the `test/pg` suites, and
`scripts/check_permissions.sh` on a scratch Postgres 16 in fresh and `EXISTING=1` modes. Nothing here is proven live: no picker
has used the ops line on a real phone yet. The rig for these tests is `test/db/hub-kit.ts` and `test/db/ops-kit.ts` (the real
ops-line turn code, WhatsApp replaced by a recorder that honours the outbox claim).

| Task | Where | Tested by |
| --- | --- | --- |
| 2.1 Picker flow | migration 0031, `ops-turn.ts` (staff branch) | `test/db/picker-flow.test.ts`: «طلبات» lists waiting orders; start moves confirmed to preparing; «ناقص 2 1» or the «غرض ناقص» list splits the shortfall into its own line, releases it, writes the phantom units off as `missing_at_pick` and asks ops to count; done moves preparing to ready and picks only what is left; the customer hears what changed on the customer line; the rider collects the new total; a paid prepaid order is owed the difference as credit; held products come up missing at the start and at the end; an emptied order goes to ops, not to the road |
| 2.2 Substitution | migration 0032, `ops-turn.ts` (`handleSubstitutionButton`, `substitutionQuestion`) | `test/db/substitutions.test.ts`, including the **Phase 2 acceptance test**: one missing item, one accepted substitute and one refund leave stock, the order total, the rider's cash due and the ledger consistent. Also: no answer means remove (offer expired when the picker finishes, substitute released); a late tap changes nothing and says so; a stated restriction blocks every substitute; a paid prepaid order is offered nothing dearer and a cheaper kept substitute is owed back; only the order's customer can answer; an order cancelled mid-question releases its stock once |
| 2.3 Refunds | migration 0030 | `test/db/refunds.test.ts`: a refund reverses the revenue it came from or books compensation as `refund_expense`, owed on `customer_credit:<party>`; the delivery fee is never taken back once it is the rider's; caps from the ledger; paid out in cash from the till or by Whish/OMT with a reference; taken off the next order (`apply_customer_credit`) and consumed when that order is paid; a cancelled order gives the credit back |
| 2.4 Offer at pick start | migration 0033, `dispatchAndOffer` in `ops-turn.ts` | `test/db/offer-at-pick.test.ts`: at confirmation the pickers are told once and no rider is offered; ops hears after `settings.picking.pick_alert_min`; start offers the rider; the rider's early pickup tap is refused until ready; the rider is told when it is ready and collects the recalculated total; a waiting order is never batched; a hub with no picker on the ops line behaves as before |
| 2.5 Returns by button | migration 0034, `ops-turn.ts` | `test/db/returns-by-button.test.ts`: a failed delivery sends pickers and the ops lead the count button; the card shows each line that left the hub with its default; «as shown», «all fit», «all waste»; a second tap changes nothing. `receive_return` now restocks only lines that left the hub |
| 2.10 Rider cannot continue | migration 0035, `ops-turn.ts` | `test/db/rider-cannot-continue.test.ts`: «سائقين» and a confirm; the shift ends; a job not yet picked up is cancelled and waits for the next rider; an order on board is transferred and offered to another rider from the hub; the first rider's exposure is only the cash held and they can no longer act on it; the fee goes to whoever delivers; the cash is handed over as one counted drop; a paid order can be called off, owed back as credit and counted back in |

Also, as A2 asked: both ops-line branches now rethrow `OutboxUnavailable` (and `SendNotDelivered`), so a rider or picker turn retries instead of sending "صار في غلط" (tested). A2's other suggestion (an instant "rider at the door" notice on the Arrived tap) was not done: the cron's notice (0062) uses a different key, so the customer would get it twice.

How the pieces fit, for whoever builds next:
- **Who uses the ops line.** `processOpsTurn` routes by role: drivers to the rider flow (unchanged), pickers and the ops lead/admin to the staff flow, merchants still ignored (step 7). Every staff action is a SQL function that checks the role itself.
- **The pick flow is on only when a picker is registered on the ops line** (`hub_uses_pick_flow()`). Then a confirmed hub order waits for its picker, the rider is offered at pick start, and the rider cannot pick up before ready. Without one (staging today) everything is as before. **Do not register a picker on staging until the hourly probe also picks** (A2's lane: the probe has no picker, so its order would stay in confirmed and raise `probe_stuck`). Either add a probe picker that taps start and done, or keep pickers off staging.
- **A missing line is its own `order_items` row** (`status` missing, then removed or substituted; `missing_reason`, `missing_by`, `missing_at`). A kept substitute is a new `ok` row with `substitution_of`. Subtotals always follow the `ok` rows (`recalc_order_lines`); fees and dues stay as quoted. Anything that reads order lines must filter `status = 'ok'` unless it wants the history.
- **Customer credit** (`customer_credit_usd`) is what we owe a customer: refunds after delivery, shortages on paid prepaid orders, a called-off paid order. It is paid out (`pay_out_credit`) or taken off an unpaid order (`apply_customer_credit`, which lowers `dues_usd`; the existing payment functions settle it and a trigger on `payments` consumes the credit).
- **Settings** (`picking`): `pick_alert_min` 10, `offer_substitutes` **false**, `substitute_answer_min` 5.
- `dispatch_order` was redefined twice (0033, 0035). **C3 (2.8): start from 0035's text.** `rider_picked_up` (0033), `rider_owns_stop` and `orders_waiting_for_rider` (0035), `receive_return` (0034) were redefined too; start from those. None of B2's four functions in 0052 were touched.

Decisions taken in code, written down for the founder (each is a setting or one line to change):
- A unit the picker cannot find is written off the shelf figure at once (stock loss, valued) and ops is asked to count; a later count finds it again as `found`. The alternative (only releasing the reservation) would let the next customer buy the same phantom unit.
- A substitute may cost more on a cash order (the customer sees the difference and taps); on a paid transfer order it may not.
- When an order is transferred after a rider incident, the delivery fee goes to the rider who delivers it; the first rider is paid for what they delivered. A share for the first rider would be a change to `settle_rider_earnings`.
- A transferred order is picked up at the hub: the goods are brought back (or ops arranges a hand-over on the road and tells the second rider). The job card has no "pick up from a rider" stop.

Known limits, written down rather than hidden:
- The customer's keep/remove tap reaches the code only once `turn.ts` routes it (request below). Until then `offer_substitutes` stays off and a missing item is removed and the customer told: never substituted silently.
- Typed «ناقص N» numbers follow the list last sent; the list is re-sent after every change. One open pick per picker.
- The rider's offer card shows the total at offer time (now pick start); the drop card and the cash question read the final total, and pickup is refused until the pick is finished. The cash-cap check at offer uses the pre-pick total.
- `receive_rider_cash` records exactly what the rider holds. A different count goes through the console (`declare_cash_drop` with the counted figures, `confirm_cash_drop`, `record_damaged_note`).
- Messages to customers from the ops line (what changed, the substitute question, a delay) are free text inside the 24-hour window. Outside it the gateway refuses them; no template exists for these.

Requests for other sessions (C2 did not touch these files):
- **Lane B (B3), `turn.ts`:** in the customer button branch, before a tap falls through to the model, add `if (await handleSubstitutionButton(deps, conv.party_id, tapped, m.id)) { buttonsHandled++; continue; }` (exported from `ops-turn.ts`; it returns false for anything that is not `sub:keep:` / `sub:remove:`). Then set `settings.picking.offer_substitutes` to true in a lane B migration, and add a `sub:` case to `evals/` if any language case touches it.
- **Lane B, the card (`issueCard`, `order-card.ts`):** to take credit off the next order automatically, call `apply_customer_credit(order)` after `create_order_from_quote` and show the credit as its own line (it arrives as a negative `dues_usd`; today's dues line only shows positive dues, so the total would not visibly add up). Until then ops applies or pays credit from the console.
- **Lane B, `learn_from_order` (0019):** it reads every line of a delivered order; since 0031 that includes lines that were removed or replaced at the shelf (and a split line appears twice). Decide what to learn; at least count each asked-for product once.
- **C1's lane or the next hub session, `recall_orders` (0025) and `rider_job`'s item count (0016):** both count every line; filter `status = 'ok'` so a product that never left the hub is not on the recall list.
- **D2 (console; D1 merged before C2, so its Returns page says refunds are not available yet):** refunds `refund_order` / `pay_out_credit` / `apply_customer_credit` / `customer_credit_view`; picks `pick_queue` / `pick_list`; incidents `mark_rider_off` / `call_off_stranded` / `receive_rider_cash` / `riders_on_shift`. New exception kinds: `count_needed` (count that product: `count_stock`), `pick_empty` (call the customer; cancel with `transition_order(order, 'cancelled', 'ops', …)` and, if paid, `refund_order` with charges `goods`, `delivery_fee`, `small_order_fee` and reason `order_cancelled`), `rider_off`.
- The session worked on branch `claude/gracious-curie-i32i7n` (the branch this environment allows).

### Session B2 (ordering), 13 November 2026: tasks 1.4, 1.5, 1.6, 1.10, 1.14, 1.16, 1.18
Built and tested locally (PGlite with every migration, vitest; permission check on Postgres 16 in fresh and EXISTING=1 modes, no warnings; Worker dry run for staging and production). Nothing here is proven live. Tests for the flows are in `test/db/ordering-b2.test.ts` (rig: `test/db/flow-kit.ts`); language cases are in `evals/cases/` and run by `evals/test/`.

| Task | Where | Tested by |
| --- | --- | --- |
| 1.4 Card shows dues, asks for prepayment | `order-card.ts`, `issueCard()` in `concierge-tools.ts` | Dues on their own line, a total that adds up, a "paid in advance" line; when the Concierge proposes cash for someone who owes, the database refuses and the card goes out prepaid instead |
| 1.5 Money guardrail | `packages/agents/src/output-guard.ts`, `reply` / `ask_location_pin` tools, `evals/cases/money_guard.json` | Any amount in model-written text (digits or number words with a currency, price words near a number; Arabic, Arabizi, English, French; Arabic-Indic digits) is refused, logged in `agent_runs` (code and fragment only) and returned to the model; `reply.price_of` adds prices written by code from `quote_order`; a model that keeps writing prices ends in a handoff |
| 1.6 Payment screenshots | migration 0018, `packages/agents/src/payment-proof.ts`, `turn.ts` | Stored from Kapso's media URL into the private bucket under its SHA-256 (a Meta link is refused); one proof per screenshot even on retry; ops alerted and queued; optional model read pre-fills amount and reference; only `review_payment_proof()` by the ops lead, through `confirm_payment()`, moves money; a reused picture is flagged, not refused; ledger at zero |
| 1.10 Neutral and factual | `output-guard.ts`, `food_facts` tool in `concierge-tools.ts`, `evals/cases/neutral_and_food_facts.json`, `evals/run.ts`, `evals/live/` | Quality words, ratings, food facts without an approved record, reassurance about allergies, and religion are refused; "not verified, I can ask" and repeating the customer's own allergy are allowed. Every case has replies the guard must refuse and allow, run in CI. The `food_facts` tool reads C1's approved records (0021) with their status and `product_meets_restrictions()`; an approved fact unlocks its attribute for the guard, and the same words without the call stay refused. The live runner drives the real ask loop |
| 1.14 Memory control | migration 0019, `packages/agents/src/memory.ts`, `evals/cases/memory_commands.json` | Show, forget (with a confirm button), stop and resume, typed or read by the model; paused memory learns and uses nothing except kept restrictions; a stated allergy goes on that order's notes at once and is kept only after a yes; aliases wait for `review_alias()` by a person |
| 1.16 Small-order fee, first-order cash cap | migration 0052, `order-card.ts`, `issueCard()` | Off by default; on, a small basket shows the fee on its own line, it posts to `revenue_small_order` on cash and on transfer, and the rider is paid the delivery fee only; a first order above the cap goes out prepaid and says why |
| 1.18 Stay on the job | `pipeline.ts`, prompt, `evals/cases/off_topic.json` | An `off_topic` reading gets one fixed line, no second model call; an order inside a chatty message is still an order |

Only a live account can prove: real Kapso image payloads (whether `kapso.media_url` needs our API key; `TurnDeps.fetchMedia` is the hook), the Supabase Storage upload on the real bucket, the model's reading of real Whish and OMT receipts, and how often the guards refuse the real model's replies (`ALO_LIVE_EVAL=1 ... npx vitest run evals/live`, then a person grades `must` / `must_not`).

Known limits, written down rather than hidden:
- The guards are word lists. They fail closed: a false refusal makes the model reword, and after six steps a person takes over. One known false positive: "أحسن تبعتلنا الموقع" ("better send us the pin") is read as a quality word. Every miss found in production becomes a case first.
- A food statement passes the guard only for an attribute `food_facts` returned an approved record for in the same turn. The unlock is per attribute group (gluten, halal, vegetarian, vegan, fasting, other allergens, nutrition), not per product: within one turn, an approved sesame fact for one product also lets an allergen sentence about another through. No approved records exist yet (5.15 and the ops lead create them), so today every positive food claim is refused.
- The deterministic card path (no model) does not check restrictions against food facts; a stated restriction travels on the order notes for whoever prepares it, who must confirm.
- The case `sponsored-fails-restriction` needs the restriction check of 1.11 and 8.12; the guard checks words, not which product is shown.
- "Forget" deletes memories and saved places no order points to; places on past orders stay with those orders, without labels.

Requests for other sessions (B2 did not touch these files):
- A2 (`packages/wa/src/gateway.ts`): 1.5 and 1.10 say "gateway preflight". The check runs in the two tools that send model text, the only paths where model text leaves. For a second lock, add an optional `authored: "model"` to `SendRequest` and call `checkModelText()` from `@ak/agents/output-guard` in `preflight()` for those sends; the tools would set it.
- A2 (`apps/gateway/src/index.ts`): if Kapso's media URLs need the API key, pass `fetchMedia: (url) => fetch(url, { headers: { "X-API-Key": env.KAPSO_API_KEY } })` in `depsFor()`, only for the Kapso host.
- Whoever owns `package.json`: `npm run eval` points at `tsx evals/run.ts`, which cannot load the prompt's `.md` import. Change it to `vitest run evals/live` (with `ALO_LIVE_EVAL=1`).
- Anyone redefining `quote_order`, `create_order_from_quote`, `post_cod_collection` or `confirm_payment` (C2, C3 2.8, D2; C1's 0020-0025 do not): migration 0052 redefines all four and sorts after 0020-0051, so on a fresh `db reset` it is applied after yours and would replace your version. Start from 0052's text and use a number above 0052, or tell the next lane B session to fold your change into a later overflow migration. A tripwire test fails if the small-order fee disappears from any of the four.
- D1 (console): the review lists are `payment_proofs_open()` with `review_payment_proof()`, and `alias_candidates_ready()` with `review_alias()`. Proof pictures are in the private `media` bucket under `payment_proofs/`.
- `supabase/seed/proposed_pilot_settings.sql` still says the small-order fee "has no effect until task 1.16": it now takes effect as soon as that file is run.
- The session worked on branch `claude/sweet-goodall-rg7du3` (the branch this environment allows), rebased on C1's merge.

### Session A2 (infra, live integration), 13 November 2026: tasks 0.13, 4.1, 4.3, 4.5, 4.6, 4.10, 4.12, 4.13
Migrations 0060-0063 (A2 took 0060-0069; see the session table in the build plan). Built and tested locally: PGlite with every migration,
and, new in this session, a real Postgres 16 started by the tests (`test/pg/real-postgres.ts`; GitHub's ubuntu runners have the binaries,
and on CI these suites refuse to skip). Permission check passes on a fresh Postgres. What is proven live is marked below.

**0.13 first real attempt, 13 Nov 18:43-18:58 UTC (founder, from WhatsApp Web; read from `wa_messages`).** The location request went out at once and was delivered. He sent a pin (in Khraibeh); the bot answered "وصلنا موقعك في بعقلين", taking the village from the text and ignoring the pin. It then asked for name, floor and building; he sent a voice note (Kapso transcript: «بحي راجح … بيت شادي أبو اسماعيل، الطابق الثاني … سنقوشي ومحطة راجح»). The bot read «راجح» as a village and asked which area; after he tapped بعقلين it asked him to **send the order again**: the basket was lost (conversation state `{}`), so no card and no order. Recorded for B4 (first items in its row); each is now a replayed test and fixed (session B4 below). Retry 0.13 after B4's deploy.

**0.13, the one thing asked of Rasheed. Status: READY TO SEND (since 13 Nov, 17:43 UTC).** Everything is in place: staging data, the test riders, the evidence workflow, the cron that delivers and collects, and (B3, 1.22) a model reading that turns this message into the right card.
Proof on staging: after B3's merge, the hourly probe sent exactly the message below through the live model at 17:38 UTC. The model kept the customer's words (`query` «قهوة نجار», `brand_hint` «نجار»), the card went out in one go (AK-1001: Tannourine 2L x6, Al Forno pita 800 g, Najjar Classic, $7.27), and the order reached `closed` at 17:43. The same message was right in every live eval run (B3's section). Earlier runs (10:35 and 11:36 UTC) asked a question instead; that is what 1.22 fixed.
Before sending, check that the last probe order closed: `select short_code, status from orders o join parties p on p.id = o.customer_id where p.is_probe order by o.created_at desc limit 3;` (or that the "heartbeat:probe_silent" issue in Sentry is quiet). If the probe is silent, see "Probe stuck in a handoff" below first.
On WhatsApp, from his own phone, between 08:00 and 23:00 Beirut time, to **+1 203 660 2328** (the "Alo King" staging customer number), send exactly:

> بدي كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار، عبعقلين

What he should see, in order:
1. Within about 10 seconds: «تمام، طلبك جاهز. بس بعتلنا موقعك 📍 من الزر تحت لنبعتلك ورقة الطلب.» with a **Send location** button. Tap it and send the current location. **Since B4 the pin decides the village** (13 Nov he was in Khraibeh and the bot said Baakline): the card is priced for the village the pin is in, and the text's «عبعقلين» is only named if it differs. A pin between two villages gets two or three village buttons: tap the right one.
2. «وصلنا موقعك 📍 التوصيل على …. كرمال السائق: شو اسم البيت أو البناية، وأي طابق؟» Answer in a message or a voice note (a neighbourhood such as «حي راجح» is fine: it is kept for the rider, never read as a village). Sending the pin and the address together skips this question.
3. The order card: «طلبك AK-…» with 1 × Tannourine Mineral Water 2L X6 ($2.01), 1 × Al Forno Pita White Bread Big 800G ($1.01), 1 × Najjar Cafe Classic Normal 180G ($3.25), the delivery fee of the pin's village (Baakline $1.00, total $7.27; Khraibeh $2.50, total $8.77), cash on delivery, and three buttons. Tap **تأكيد الطلب**.
4. «تم تأكيد طلبك AK-… ✅ عم نحضّرو هلق.»
5. One to three minutes later: «طلبك #AK-… صار عالطريق 🛵».
6. One to two minutes after that: «وصلنا دفعك لطلب #AK-…: <the total>$ نقداً.» Nobody comes to the door: on staging the rider is a test rider (below), who accepts, picks up, delivers and records the cash through the ops line's real code path.

Why these three items: they are brand-led, and each resolves to the one right product (checked on staging with `plan_order` inside a rolled-back transaction, and by the probe's order AK-1001). Step 1 differs for the probe, which already has a saved pin: its card came at once; a first-time phone gets the pin request first. The staging probe places exactly this message through the live model every hour. If no reply arrives at all, the first suspect is Meta billing on the number (0.12, section E): Kapso pauses sends when the account cannot pay.
After he has done it, any session runs the **staging-evidence** workflow with no input: it finds his closed order, writes `docs/evidence/order_<code>.txt` to the branch `evidence/<code>` and fails if any 0.13 check fails. The conversation is printed in place of screenshots (numbers and user ids masked). Screenshots from the phone are not required.

| Task | Where | Tested | Live |
| --- | --- | --- | --- |
| 4.1 Webhook shapes from real payloads | `test/fixtures/kapso/` (75 from real Kapso message objects of October's traffic, people replaced; contact events and `failed` from Kapso's docs), `packages/wa/src/webhook.ts`, migration 0060 | Every fixture parsed (`packages/wa/test/fixtures.test.ts`); events applied on the real schema (`test/db/webhook-events.test.ts`) | No real webhook captured yet: run `capture-kapso-fixtures` after 0.13; captures sit beside the others as `webhook-*` |
| 4.3 Utility templates | Submitted 13 Nov through Kapso, all PENDING with Meta: `ak_order_cancelled_v1` (1458006846477073), `ak_rider_at_door_v1` (1786544829266049), `ak_payment_received_v1` (1780600283167217). Migration 0062, `customer_notices_due()`, `sendNotice()` in `index.ts` | `test/db/customer-notices.test.ts` | Submission yes; approval no. Status is read from Meta hourly into `wa_templates`; until approved the same words go as free text inside the 24-hour window |
| 4.5 Worker end to end | `test/pg/worker-e2e.test.ts`, `test/pg/postgrest-shim.ts` | workerd + real Postgres: webhook path, a crash mid-turn, the cron walking the probe order to closed, the 0.13 evidence script on it | n/a (local runtime) |
| 4.6 Dispatch race | `test/pg/dispatch-race.test.ts` | Two and twenty concurrent dispatches on real connections; the suite fails when the per-rider lock is removed | n/a |
| 4.10 Heartbeat and alerts | migration 0063, `index.ts` (probe, alarms, project webhook, daily Kapso health), `worker.ts` (Sentry cron monitor), `scripts/staging/prepare-staging.sql` | `test/db/heartbeat.test.ts`, `test/pg/prepare-staging.test.ts`, the e2e | After the deploy of this branch: see "Live after merge" below |
| 4.12 Message meter | migration 0061 | `test/db/message-meter.test.ts` | Meta's per-message pricing is now recorded from every status webhook; the rates are estimates until 4.4 |
| 4.13 Kapso SDK | `@kapso/whatsapp-cloud-api` 0.4.0 in `packages/wa/src/kapso.ts` | Same URL, header and body for every send; signature check agrees with the SDK's on every fixture | Kept. See finding 1 |
| 0.13 | above | The SQL side of the order; the rider leg in the e2e | **Blocked on lane B** (the live model's readings, below). The A2 side is in place and runs every hour |

**What the probe is.** Staging only, locked twice (`settings.probe.enabled`, set by `prepare-staging.sql`, and `PROBE_MODE=on` in the staging Worker's vars; a test keeps it out of production's vars).
A test customer and two test riders (`parties.is_probe`). `can_send()` answers `probe_sink` for them: the gateway claims, marks and logs the message as usual and never hands it to Kapso.
Every minute the cron answers what each probe was last sent, as a person would (confirm the card; accept, picked up, delivered, cash exact), in the real Kapso shape through the real inbound path. Once an hour the test customer orders.
A probe order not closed in 30 minutes, a probe that stops ordering, real customers silent for 6 hours while open (when there is usually traffic), and the cron returning after a gap each open an ops exception once, alert ops, and go to Sentry.
Staging stock is 5,000 of everything (only set on an empty store), so the hourly order can run for months.

**Findings (each fixed and tested in this session):**
1. **The Kapso SDK broke every send on Cloudflare.** It asks fetch for `redirect: "error"`, which workerd rejects outright; Node accepts it, so unit tests passed. Only the workerd end-to-end test showed it. `kapsoClient` now passes a fetch that uses `manual` and refuses redirects.
2. **A passing Kapso error (500, 429, a network error) handed the customer to a person** ("someone will contact you") instead of retrying the turn. The gateway now raises `SendNotDelivered`, an `OutboxUnavailable`, which `turn.ts` already rethrows; Meta's permanent refusals are recorded and the turn goes on.
3. **A marketing STOP was saved as an opt-in**, and the event created a party for strangers and opened the free reply window (the payload is an object; it was read as a string). 0060.
4. **`username: null` failed the whole message**: Kapso sends null, the schema wanted a string or nothing.
5. **identity_changed was not handled**: a new business-scoped id would have made the same person a second, empty customer. 0060 re-keys.
6. **The 0.13 evidence script would have failed every delivered order**: a reservation and its pick net to zero in `stock_movements` by design. It now compares picked with sold, and treats same-state rows (late taps, the learning job) as notes.

**Live after merge** (deploy-staging run `43409985942` on main at 10:33 UTC, **passed, every step including Sentry**; checked with the connectors):
- Supabase staging: migrations 0060-0063 applied (30 in all); the hub is Baakline, there is an exchange rate, all 291 products are stocked, the three probe parties exist, and probes are enabled; the three templates are `submitted`.
- The Worker's cron beats every minute (`heartbeats.cron`). The project webhook is ready (its signed smoke event was stored and processed).
- **The probe's first live order ran the real path on Cloudflare**: cron, stored inbound event, conversation object, turn, the real model (Haiku 5.5), gateway, outbox, sink. No card came out, which surfaced the finding below. The probe now sends the 0.13 message every hour.

**Finding for lane B (B3): the live model's catalog queries miss or pick the wrong product.** (Answered by B3, task 1.22: see that section.) Seen live on 13 Nov, then reproduced on staging with `plan_order` (rolled back):
- The model wrote the query for «ربطتين خبز» as `bread`. English generic words match no catalog name (`search_catalog('bread')` returns nothing; `'خبز'` matches the aliases), so the line was `not_found` and the turn asked a question instead of sending a card. `schemas.ts` invites this: its example for `query` is an English normalised phrase ("facial tissue large pack").
- Brand-led English queries match, but every hit ties at score 0.9, so the brand rule takes the first product of that brand: «لبنة ليبان ليه» (`labneh Liban Lait`) became **Liban Lait Laban 1Kg**, and «بيض هوا» (`Hawa Chicken eggs`) became **Chicken Legs**. Those are wrong cards, not just missed ones.
- Second live run (11:36 UTC, the 0.13 message itself, brand-led on purpose): the model read «قهوة نجار» as `Nassar coffee` (not found), and this time gave no `brand_hint` for «مي تنورين» or «خبز الفورنو», so both were ambiguous. Result: a question instead of a card. The same model reads the same kind of message differently from run to run. Three eval cases straight from the traces: «ربطتين خبز» must not become `bread`; «قهوة نجار» must keep "Najjar"; a brand said in Arabic (تنورين، الفورنو، ليبان ليه) must reach `brand_hint`.
- Per `CLAUDE.md` these become cases in `evals/` before the fix. Likely fixes: keep `query` in the customer's words (Arabic), or have `plan_order` retry with `raw` and the Arabic aliases; and break score ties on the product kind (`sub_type`) before the brand. A2 did not touch `packages/agents/`, `evals/` or lane B's SQL.

**Blocked or not possible, recorded:**
- Kapso's API shows no credit balance figure, so "alert below an amount" cannot be built; the daily check alerts when Kapso has paused paid sends (`paid_messages.paused`), which is the moment it matters.
- Template approval is Meta's (usually about a day). Nothing to do but wait; the hourly sync picks it up.
- The Kapso connector could not obtain a credential for a number health check on 13 Nov (read calls worked earlier the same day); the daily `kapsoHealth` step does the same check from the Worker.
- The sandbox ops line is still unproven for real buttons on a real phone; the probe riders make it unnecessary for 0.13. Needed before two real riders.
- Sentry: done and proven live (section F, 0.8).

**For other sessions:**
- B3 (or the next lane B session), `turn.ts` / `concierge-tools.ts`: (a) a retried turn issues a new card and cancels the first draft as `superseded_by_new_card` (seen in the e2e crash test). The customer only ever sees one card, but key the card on the turn so a retry reuses the draft. (b) Set `authored: { by: "model", approvedFacts }` on the sends of model text in the `reply` and `ask_location_pin` tools: the gateway now re-checks them (B2's request, done on the gateway side).
- C2, `ops-turn.ts`: the per-message `catch` in `processOpsTurn` swallows `OutboxUnavailable` (and now `SendNotDelivered`) and tries to send "صار في غلط", so a rider turn does not retry when Kapso blips. Rethrow those, as `turn.ts` does. Also: call `deps.notifyCustomer(orderId, "rider_waiting")`-style on the Arrived tap if the "rider at the door" notice should be instant; today the cron sends it within a minute.
- B2's media request: Kapso's `media_url` in the real October messages is an `app.kapso.ai` redirect link; whether it needs the API key is still unproven, so `fetchMedia` was not changed.
- Anyone touching `can_send()`: 0063 redefines it (marketing lock first, then probes, then `can_send_checked`). Start from 0063's text.
- The session worked on branch `claude/hopeful-johnson-hvqdoh` (the branch this environment allows).

### Session P1 (pictures), 13 November 2026: task 5.17 steps 1-5, 7, 8; migration 0050
Branch `claude/build-p1-task-5-17-5m1zj4` (the branch this environment allows). Built and tested locally (PGlite with every migration; permission check on Postgres 16); the fetch itself runs only in GitHub Actions. The staging runs are in "First staging runs" below.

| Step | Where | Tested by |
| --- | --- | --- |
| Store, licence rules, review list, customer-side function, intake list | migration 0050 | `test/db/product-images.test.ts` (15 cases): licence follows from the source and a search result cannot be filed as usable; a proposed, rejected, superseded, **licence-unknown** or inactive-item picture is never returned to a customer, even when a person approves an unknown-licence one; only the ops lead or an admin approves; the same bytes are not re-proposed after a rejection; withdrawing takes a picture away at once |
| 1-5 Fetch, vision check, licence, resize, store | `scripts/images/fetch-images.mjs`, `lib/` | `scripts/images/test/`: Open Food Facts folder and candidate rules, search parsing, brand-site classification (look-alike hosts refused), the vision decision (`cannot_tell` is a no), real resizing with sharp (1200 px, under 300 KB, no enlargement, white behind transparency, SVG refused), and the whole pipeline against the real migrations with the network and model replaced |
| Workflow | `.github/workflows/images.yml` | Manual (`workflow_dispatch`); runs its own tests first, then the fetch, then proves the bucket is private and writes the intake list as an artifact |
| 7 Signed link | `scripts/images/sign.mjs`, `product_image_for_customer()` | SQL cannot sign (the key is the project's), so the function returns the storage key, attribution and link lifetime, and the caller signs with the Storage API. `sign.mjs` is a tested example. `prove-private.mjs` does it live against one proposed picture and checks that the public route and an unsigned address are refused |
| 8 Intake list | `photograph_at_intake()` (with the reason: `none_found`, `unknown_licence_only`, `rejected`), the `photograph-at-intake` artifact of each run | Same test file |

**First staging runs (13 Nov, `images.yml` on main; Open Food Facts only, no search key yet).** Proven live: the pipeline, the model check, the resize, the private bucket and the signed link. Not proven: Brave search (no key), and a person approving a picture (3.18 is not built).

| Run | What happened | What it taught |
| --- | --- | --- |
| 1 `43414108385` | 0 proposed. 257 `none_found`, 34 `none_passed` | 176 of the 257 were not "not found": the Open Food Facts lookup had thrown and the error was dropped, so it was filed as `none_found`. Fixed: a failed lookup is an `error` with its message stored, never `none_found` (PR 15) |
| 2 `43415523730` | 1 proposed (AK-0175 Barilla Spaghetti N°5). 123 `error` = HTTP 429 from Open Food Facts, 109 `none_found`, 58 `none_passed`. **Signed link served the picture (HTTP 200, image/jpeg, 72,102 bytes); the same path without a link answered 400; the signed address without its token answered 400** | Open Food Facts rate-limits a GitHub runner even at one read per 1.5 s. Gate is now 4 s, `Retry-After` is honoured, and a rerun skips items already finished with nothing (PR 16) |
| 3 `43417645227` | 2 proposed in all (AK-0175 Barilla Spaghetti N°5, AK-0193 Plein Soleil Sweet Corn 340G, both CC BY-SA). No errors | Every one of the 291 items now has a conclusive result |

**Result: 2 of the 291 items have a usable proposed picture (0.7%). 289 are on the photograph-at-intake list.** Nothing is approved: approval is a person's, on the 3.18 page. Where the other 289 stand:
- **34** have no barcode (the unbranded produce): Open Food Facts is by barcode only, so they need search or an intake photo.
- **153** have a barcode that gave no Open Food Facts picture (not in its database, or no picture). Local brands fail most (as the plan expected).
- **102** had candidates, and every one failed the vision check on the rules as written. The reasons recorded in `product_image_attempts.detail` were mostly `background` (not a plain background: Open Food Facts pictures are usually shop-floor or hand-held shots) and `size` (the pack's size could not be read, and `cannot_tell` counts as no), then `brand` and `product`, `narrow` (under 800 px) and `not_one_pack`. The step 3 rules were kept exactly; they are strict on purpose.

So Open Food Facts alone will not cover the catalog. The two real levers, both the founder's: (1) the `BRAVE_SEARCH_API_KEY` secret, which adds brand-site and web search (search pictures are licence unknown: they guide the intake photo and are never shown to customers, so search raises the count of good guides, not of customer-visible pictures); (2) the intake photographs (5.15), taken on a plain background, which go through the same approval and are the main route to a customer-visible picture for most items. `intake-list.json` (artifact `photograph-at-intake` on each run) lists the items with the reason and any guide picture.
CI note: on PR 16 `test/pg/dispatch-race.test.ts` failed once with "Postgres did not start" on the runner (not this lane's code; the diff was `scripts/images/` only) and passed on the one re-run.

**Secret and switches (founder).** `BRAVE_SEARCH_API_KEY` (repository secret) turns on brand-site and web image search; the choice and price are in `docs/DECISIONS.md`. Without it the workflow runs Open Food Facts only. `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_KEY` are the existing secrets. The model is `MODEL_FAST` from `wrangler.jsonc`.

**How it behaves.** Up to five candidates an item, evaluated in stages (Open Food Facts, brand site, open search); the later stages are skipped once a picture with a customer-usable licence passes. A candidate is kept only if the measured width is at least 800 px and the model says yes to brand, product, size, one pack, plain background, and no to watermark or overlay text, and no to price tag or shop logo. `cannot_tell` is a no. The best kept candidate (usable licence first, then width) is shrunk and stored under `media/product_images/<sku>/<hash>.jpg` as `proposed`. A rerun only touches items still without a usable picture or a usable proposal, and never a picture a person approved. Each item and run leaves a row in `product_image_attempts` with the reason.

**Not done, and why.**
- Step 6 (the review page) is task 3.18, D1.
- Open Food Facts is looked up by barcode only. The 34 items with no barcode (the unbranded produce) get nothing from it, and are on the intake list unless search finds a picture.
- Brand-site search needs a listed domain per brand (`scripts/images/brand-sites.json`, nine brands today). It is a search restricted to that site, not a crawl of the brand's product pages.
- The Brave request shape follows its documentation and is tested with a fake; it has not been called, because the key does not exist yet. First run with the key: expect to read `errors_by_message` in the run summary before trusting it.
- `TEST_REPORT.txt` was not regenerated: it is not in P1's files, and parallel sessions would conflict on it. The next session that owns it should.

**For other sessions.**
- **D1 (3.18):** the review page reads `product_images_review(status, limit)` and writes only through `review_product_image(image, by, 'approve'|'reject', note)`. Each row has `customer_visible` (false for licence unknown: approving it records the decision but never shows it to a customer). The picture itself is in the private `media` bucket: sign `media_path` with the service key on the server (`sign.mjs`), never in the browser. Show the licence and `attribution` next to the picture. `photograph_at_intake()` is the list for 5.15.
- **K1 (1.21 catalog feed):** call `product_image_for_customer(product)`; null means send no picture. Sign the returned `media_path` for `signed_link_seconds` (`sign.mjs`). Show the `attribution` where a CC BY-SA picture is used. WhatsApp fetches the link itself, so keep the lifetime at least a few minutes. Never add `image` to the gateway allowlist (invariant 2): the catalog image header is part of an interactive message.
- **Anyone adding a brand to `brand-sites.json`:** open the site first. A wrong domain would file someone else's picture as the brand's own.

### Session N1 (product data), 13 November 2026: task 5.18; migration 0073
Branch `claude/bold-euler-uw3gxx` (the branch this environment allows). Built and tested locally (PGlite with every migration, 67 tests in `scripts/product-data/test/`, the whole suite 759 pass at the first merge; permission check on Postgres 16 in fresh and `EXISTING=1` modes). The fetch itself runs only in GitHub Actions (`.github/workflows/product-data.yml`, manual). **Run on staging on 13 Nov: done (facts, names, categories), see "First staging runs" below.**

| Step | Where | Tested by |
| --- | --- | --- |
| Store, rules, counts | migration 0073 | `pipeline.test.mjs`: `propose_off_facts()` files each fact through C1's `propose_product_fact` (status `partial`, source `open_food_facts`, nobody approves); a check constraint makes an `open_food_facts` row unapprovable even by a direct update; Open Food Facts never says `free` (an allergen it does not list is unknown, so no row); an allergen or diet value needs a quote that is a literal part of its source text; no source text, code or fingerprint is refused; one bad fact saves nothing for that product; a rerun never touches an approved fact and never re-proposes an unchanged one; a changed record supersedes the old proposal and keeps it. `product_data_coverage()` is the report: items with a proposed fact of each kind, and `approved_from_open_food_facts` (must be 0) |
| Facts | `scripts/product-data/fetch-product-data.mjs`, `lib/` | `facts.test.mjs`, `off-http.test.mjs`: one request every 4 seconds with `Retry-After` honoured and retries through the same gate; a failed lookup is an error, never "not found"; allergen tags map by a fixed table; nutrition is the stated per-100 g numbers only; diet from a label claim or Open Food Facts' own analysis, a conflict is unknown; fasting is never proposed |
| The model's part | `lib/map-model.mjs` | The fast model sees only Open Food Facts' own text (fenced as data), maps it onto our fourteen allergens with a quote, and renders the ingredient list in Arabic. Code keeps a mapping only if the quote is in the text, is about that allergen (word lists in English, French, Arabic), and agrees with its "may contain" wording; keeps the Arabic only if it is Arabic and every number of the source survived. The model's value, never its memory, is what is filed |
| Names, sizes, categories | `propose-catalog.mjs`, `lib/names.mjs`, `lib/categories.mjs` → `data/proposals/` | `names-categories.test.mjs`: no number changes, no praise, health, diet or religion word that the catalog did not have, Arabic must be Arabic; a refused item is asked once more and then left as it is; 12 to 15 neutral categories (no catch-all, no "Healthy"), every item placed once, ordered by name. Proposals only: no table is touched |

Decisions taken in code, written down:
- **Which items are looked up.** The plan says 291 products with a barcode; the catalog has **257** with one, and 34 (the unbranded produce) have none. Of the 257, those whose number is 13 digits starting with 2 are a store's own code (GS1 20-29, by-weight and in-store items): the same number is another item in another shop, so they are never looked up (`product_data_is_internal_code`). The report counts them separately.
- **Status `partial` for everything from Open Food Facts**, never `declared`: the rows say plainly that nobody has checked the pack. A person confirms the field and records it as `label`.
- **No "free" and no "fasting" from this source**, and a "gluten free" label claim is not proposed either (it is a `free` statement). Intake (5.15) records those from the pack.
- A model failure on an item files nothing for it (the item is tried again); a refused key (HTTP 400/401/403) stops the run.
- Rejecting a proposal has no function yet (5.15 / D2): set `superseded_at`. A rerun does not re-propose a set-aside proposal while it is the latest for that attribute.
- Open Food Facts data is ODbL: the attribution is in every proposal's `detail`. Nothing from it reaches a customer until a person records it from the pack.

For other sessions:
- **K1 (1.21):** `data/proposals/categories.json` is the proposed category list and each item's category and order; it is a proposal until the founder approves it. The catalog's own "Healthy" category (2 items) is not carried over (invariant 14).
- **5.15 / D2 (intake and review):** the review list is `product_facts` where `source = 'open_food_facts'`, `approved_at is null`, `superseded_at is null`; `detail` holds `source_text`, `quote`, `off_url`, `ar` and `ar_by`. Compare each field with the pack, then call `propose_product_fact(..., 'label', ...)` and `approve_product_fact`.
- The workflow pushes what it generated to `product-data-out/<run id>`; the `data/proposals/` files in the repository were copied from there.

**First staging runs (13 Nov, `product-data.yml` on main; staging project only, nothing reaches a customer).**

| Run | What happened | What it taught |
| --- | --- | --- |
| 1 `43493359606` | Facts: all 228 items looked up (about 16 minutes at one request every 4 s, no 429), then the run stopped in its own summary: `processItem` returned a number for `rejected` on an item with nothing usable and `summarise` iterated it. Names and categories never ran | Fixed in PR 25, with tests that feed `summarise` real results. The facts were already in the database |
| 2 `43497961883` | Facts: nothing left to look up, coverage printed. Names: 282 proposed, 9 refused. Categories: refused three times (the model returned 22, the catalog's own 21 plus one, and used "fresh") | The retry said only "need 12 to 15", so the model never moved. Fixed in PR 26: the retry lists the codes it sent and says to merge |
| 3 `43501248215` | Categories only: 15 categories, all 291 items placed, none empty | |
| 4 `43503501332` | Names only, after PR 28: 282 proposed, 9 refused | Run 2's names had 49 Arabic names with Latin letters, about a dozen glitched inside a word (`كellogg's`, `ماestro`). PR 28 refuses an Arabic word that mixes scripts; none is left (10 names keep a whole Latin word such as UHT) |

**Result, read from `product_data_coverage()` on staging** (also `data/proposals/product-facts-summary.json`):

| | Items |
| --- | --- |
| In the catalog | 291 |
| Looked up in Open Food Facts (a real barcode) | 228 |
| Found there / not there / errors | 113 / 115 / 0 |
| A store's own 13-digit 2xx code (never looked up) | 29 |
| No barcode | 34 |
| Items with any proposed fact | 87 (212 proposals) |
| Proposed ingredients | 35 (31 with an Arabic rendering; the other 4 have no rendering that passed the checks) |
| Proposed nutrition panel | 86 |
| Proposed allergens | 27 items: 26 with "contains", 6 with "may contain" |
| Proposed diet labels | 25 items: halal 7, vegetarian 9, vegan 17 |
| Approved from Open Food Facts | **0** (the database refuses it) |

Of the 228 looked up, 115 are not in Open Food Facts at all (local Lebanese brands), so for half of the barcoded catalog the intake photo (5.15) is the only source. No allergen proposal for an item means **unknown**, never free.

**Names and sizes (`data/proposals/names.json`).** 282 of 291 proposed, 234 change a current English name (mostly the size moved out, capitals, spacing); 241 Arabic names are written by the model and 41 keep the catalog's Arabic. 9 were refused by the checks and keep their current names: five meats whose catalog name has no size, where the model added "500", Foody's tortilla (size numbers disagree), Kit Kat (Arabic not Arabic), Edita Bake Rolz (an added word, ديت), Maxbell sardine (mixed script). **All Arabic names need an Arabic reader**: the checks cannot tell a wrong word from a right one (for example the `deli_ready_meals` category's Arabic name المرطبانات الجاهزة means "ready jars" and is wrong for deli and ready meals).

**Categories (`data/proposals/categories.json`).** Fifteen, in display order: fruits and vegetables; meat and poultry; deli and ready meals; dairy and eggs; frozen; bakery and bread; water, drinks and hot beverages (41); breakfast and milk powder; snacks and sweets; pantry staples; canned and jarred; cooking and baking; cleaning and household; personal care; baby and pet. Each item has its category and a place in it (alphabetical by name). The catalog's "Healthy" category (2 items) is not carried over (invariant 14). Some placements are doubtful (two snacks under breakfast, two dairy items under cooking and baking); the founder approves the list, and 1.21 should use it only after that.

**Model use.** `claude-haiku-5-5` (`MODEL_FAST`). Recorded: names 22 calls, 47,614 in / 27,244 out tokens (run 4); categories 7 calls, 39,521 in / 7,627 out (run 3). Not recorded because the runs stopped before their summary: the facts calls of run 1 (one per item with text to read, at most 228) and the refused category tries of run 2. The whole spend is a small fraction of the USD 45 credit that expires on 17 Nov; nothing more is needed from it for 5.18.

**Not done, and why.**
- No fact was approved: that is a person at intake (5.15) or the ops lead, against the pack.
- The names and categories are files, not applied. Nothing reads them yet; 1.21 (K1) and a console action for names are the consumers.
- What the checks refused during the facts step is in each item's `product_data_attempts.detail.rejected` (kind, quote, reason); it was not summarised here because run 1's summary was lost. An example of a filed item: AK-0247 (gluten, milk, mustard, ingredients, nutrition, vegan).

### Session D1 (console), 13 November 2026: tasks 3.1 to 3.10, 3.18
`apps/console/` (new Worker, hosted on Cloudflare beside the gateway: `docs/DECISIONS.md`, "Console hosting") and `.github/workflows/console.yml`. No migration (D1 owns none).
Built and tested locally: every page is driven through the real request handler against PGlite with every migration, with the gateway's real `send()` (only Kapso's HTTP replaced) and Supabase Auth and Storage replaced by fakes (`apps/console/test/`, 50 tests).
Proven live on staging by the console workflow (deploy, secrets, Auth redirect, then a smoke test with a real sign-in): see "Live" below.

**Staging address: https://alo-king-console-staging.rashid-hamzy.workers.dev**

**How Rasheed signs in (once):**
1. GitHub, Actions, **console**, Run workflow: action `add-staff`, his email, name `Rasheed`, role `admin`. This makes an admin party and a Supabase Auth account for that email, and Supabase emails him a link.
2. Open the email from Supabase ("Reset your password"), tap the link. It opens the console's "Choose a password" page. A password of at least 12 characters signs him in.
3. From then on: the address above, email and password. A session lasts 12 hours. Sign out is top right.
If no email arrives within a few minutes: Supabase's built-in mail only reaches members of the Supabase organization, a few an hour. Supabase dashboard, Authentication, Users, his user, "Send password recovery" sends the same link. For staff who are not members of the Supabase organization (the ops lead, pickers), set up SMTP in Supabase (Authentication, Emails) first; until then their link must be sent from the dashboard the same way, which has the same limit.
Adding the ops lead or a picker is the same workflow with their role. `remove-staff` blocks the party and bans the sign-in; access ends on their next click.

| Task | Where (`apps/console/src/`) | Writes through | Tested by (`apps/console/test/`) |
| --- | --- | --- | --- |
| 3.1 Sign-in and roles | `app.ts`, `auth.ts`, `session.ts`, `db.ts`, `media.ts`, `roles.ts`, `worker.ts`; staff accounts by `scripts/staff.sh` | Supabase Auth (password grant, emailed link); the action log | `sign-in.test.ts`: staff only (customer, rider and unlinked accounts refused), wrong password not logged, role and block read on every request, 12-hour session, forged cookie, CSRF token and Origin, the emailed-link flow, log-first-or-nothing. `no-direct-writes.test.ts`: no insert, update or delete anywhere in the console; every acting party is `c.staff.partyId`; no Kapso call outside the gateway. `adapters.test.ts` |
| 3.2 Today | `pages/today.ts` | reads only | `today.test.ts`: late first against the zone's ETA from the database; riders with cash per currency and exposure against the cap setting |
| 3.3 Payments | `pages/payments.ts` | `review_payment_proof`, `confirm_payment` | `payments.test.ts`: signed 5-minute link to the screenshot, typed amount and reference, underpaid and missing reference refused, reused reference refused, reject posts nothing, ledger at zero, pickers refused by page and SQL |
| 3.4 Cash and riders | `pages/riders.ts` | `confirm_cash_drop`, `pay_rider_earnings`, `close_shift` (never forced), gateway `send()` on the ops line | `riders.test.ts`: drop above the balance refused, fees kept from cash, the end-of-shift statement sent once from the ops number with the SQL's figures, refused when the rider's 24-hour window is closed |
| 3.5 Exceptions and chats | `pages/exceptions.ts` | `resolve_ops_exception`, gateway `send()` on the customer line, `release_handoff` (proposed) | `exceptions.test.ts`: acknowledge and resolve with who; a reply sent once from the customer number (form key as the outbox key); closed window refused; the action log keeps the reply's length, not its words |
| 3.6 Returns | `pages/returns.ts` | `receive_return` | `returns.test.ts`: counted back, rest written off, order closed, ledger at zero, repeat is a no-op |
| 3.7 Catalog | `pages/catalog.ts` | `count_stock`, `adjust_stock` (form key = request key), `set_offer` (proposed) | `catalog.test.ts`: double tap changes stock once, reason must fit, picker limit from SQL, price and availability with a reason recorded |
| 3.8 Exchange rate | `pages/fx.ts` | `set_fx_rate`, `confirm_fx_rate` (proposed) | `fx.test.ts`: morning rate as typed, a move under 3% set, a 4.21% move held with quoting paused until a person confirms |
| 3.9 Zones and fees | `pages/zones.ts` | `set_zone`, `set_village` (proposed), admin only | `zones.test.ts`: the next quote takes the new fee; village served and moved; reason required |
| 3.10 Merchants | `pages/merchants.ts` | `apply_menu_import`, `approve_merchant`, `review_alias` | `merchants.test.ts`: approval refused before a menu is applied, then opens it with the commission; a learned alias approved (B2's request) |
| 3.18 Pictures | `pages/pictures.ts` | `review_product_image` | `pictures.test.ts`: picture as a signed link with source, licence and attribution; approve makes it the customer's picture; a licence-unknown approval stays invisible to customers; only http(s) links are drawn |

**Five steps wait for a migration.** D1 owns no migration number, so the functions the console needs and the database lacks are written, and tested by the console's tests, in `apps/console/sql/proposed_functions.sql`: `release_handoff` (3.5), `set_offer` (3.7), `set_fx_rate`, `confirm_fx_rate`, `fx_quoting_paused` (3.8), `set_zone`, `set_village` (3.9), and a `config_changes` record of who changed what and why. Until a migration carries that file, those pages say "Not available yet" (the console asks PostgREST which functions exist), and the rate, fees and prices are set by script as today. **D2** (0045-0049): copy the file unchanged into a migration and delete it. **Lane B** (owns `quote_order`): refuse to quote while `fx_quoting_paused()` is true, or the 3% pause of 3.8 pauses nothing.

**Live** (console workflow on this pull request: run `43424814724` on the 3.18 commit **passed, every step**; the earlier runs failed only where pages not yet built were checked):
- The Worker deployed to the address above, its six secrets set (the session key is made once and kept), and `<console>/auth/callback` added to the staging project's Auth redirect list.
- Smoke test against the real Supabase Auth and staging database: health, signed-out redirect, cross-site POST refused, wrong password refused, **a real sign-in as a staging picker** ("Console smoke check (staging)", password random each run and never stored), the Today page rendered from staging data with the staff name, pickers refused on Payments, Cash and riders, Pictures (403) and allowed on Returns and Catalog.
- Not proven live: any action (no real payment, drop or picture was approved on staging by this session); the emailed link (needs Rasheed's address, step 1 above); the end-of-shift message and chat replies reaching a phone; reading PostgREST's function list on the real project (if it cannot be read the pages show the forms, and the call itself then reports the missing function).

**Findings (for the owners of the SQL):**
- `confirm_cash_drop(drop, by)` (0004) does not check the acting party's role: any party id confirms a drop. The console allows only ops lead and admin. Add the check in a migration.
- `resolve_ops_exception(id, by, status)` (0008) checks neither the role nor the status value. The console allows only ops lead and admin, and only `acknowledged` or `resolved`.
- `close_shift(driver)` without `p_force_by` records no acting party; the console's action log has it.

**Not done, and why:**
- Refunds after delivery (part of 3.6): task 2.3, session C2, not merged. The Returns page says so.
- Disputing a cash drop, rejecting a menu import, and adding staff from the console have no SQL function; staff are added by the workflow only.
- The action log is objects in the private `media` bucket (`console_audit/<day>/...json`, one per entry, never overwritten), because a table needs a migration. A `staff_actions` table written by a function would be better for the day-close report (D2).
- Sign-in has no throttle of its own; Supabase Auth's rate limits apply, and they count by IP, which for the console is Cloudflare's. Passwords are at least 12 characters.
- `TEST_REPORT.txt` was not regenerated (not D1's file).
- The session worked on branch `claude/magical-fermi-fob6sq` (the branch this environment allows).

### Session B3 (ordering), 13 November 2026: tasks 1.22, 1.7, 1.8, 1.13, 1.17, 2.9; migrations 0053-0059
Branch `claude/intelligent-ritchie-6kgryn` (the branch this environment allows). Built and tested locally (PGlite with every migration, vitest). 1.22 is measured on the live model through GitHub Actions (`.github/workflows/language-pack.yml`); staging is under 1.22.

**1.22 Catalog language pack. Status: built, measured on the live model, proven on staging for the 0.13 message. F1 gate met (0.918 ≥ 0.90). The staging probe turned the 0.13 message into the right card and the order closed (AK-1001, 13 Nov 17:38-17:43 UTC). Zero-wrong gate NOT met on the generated set: 10 wrong products in 2,458 items, all from 4 phrasings (below).**

| Live model `claude-haiku-5-5` (MODEL_FAST), generated eval set, 986 messages, 1,229 items | Before (main) | After (this branch, 2 runs a case) |
| --- | --- | --- |
| Item F1 | 0.503 | **0.918** |
| Precision / recall | 0.759 / 0.376 | 0.995 / 0.853 |
| Wrong products (customer gets something not asked for) | 147 in 1,229 items | 10 in 2,458 (4 phrasings, each twice) |
| Readings thrown away (extraction contract failures) | 126 of 986 turns | 0 (1 network error) |
| The 0.13 demo message gives Tannourine 2L x6, Al Forno pita 800 g, Najjar Classic | no | yes, every run |
| By language (F1): Lebanese Arabic / Arabizi / mixed / English / French | 0.43 / 0.47 / 0.53 / 0.66 / 0.65 | 0.93 / 0.89 / 0.94 / 0.97 / 0.94 |

How it is built:
- **The eval set** (`evals/language/cases.json`, `gen-cases.mjs`): 863 single-item messages (about three per product: Lebanese Arabic, Arabizi, English/French/mixed) and 116 baskets of 2-4 products, written by `claude-opus-5-5` with the whole shelf in view, then checked by `claude-sonnet-5-5`, which sees only the shelf and the message and must name the same products (14 of 993 dropped). Truth is the product the message was written for. Plus 7 hand cases from the 13 Nov traces (`hand.json`), including the 0.13 message. The generator never saw the pack.
- **The pack** (`evals/language/pack.json` → `build-pack.mjs` → migration 0054): per product, `kind` terms (what people call it, خبز، بيض، mayy, labne), `brand` terms (as said: نجار، الفورنو، najjar) and `exact` terms (fits one product: «نجار هال», "tannourine 500"). 9,216 terms, 295 filler words. The build drops any term with a food-fact word (halal, gluten, vegan, healthy, diet, sugar, fat level, allergy, calories, protein, organic, fasting) unless it is printed in the product's own name or the product is not food (invariant 15; 4 dropped). Tokens and forms are precomputed by the builder (a test checks every shipped row against the SQL functions), so the migration loads in well under a second, drops an exact term two products claim (10) and keeps as kind an exact term that is another product's kind word (22), and never lets a brand be a kind word (22).
- **The matcher** (migration 0053): `catalog_pack_scan` / `catalog_pack_search` match the customer's words token by token (Arabic clitics و ب ع ال on either side, size words in every spelling, units optional, decimals kept together), rank by how much of the text a product explains, and return the words left unexplained. Negations («مش البانيه», "bala zaytoun", "mish diet") rule a product out, unless the term itself carries the negation («zebde bala mel7»). The curated seed aliases are no longer matched (the generator started from them; dropping them changed nothing measurable), only aliases learned from confirmed orders. `catalog_lookup`: the customer's words first; the model's phrase only narrows what those words allow; the old trigram search is kept for restaurant menus only (it was what turned labneh into laban). `plan_order_core` (redefined, wrappers untouched): joins a line the model cut off ("3tine kinder" / "tronky wa7de") to its neighbour, merges the same product said twice, reads the whole message as evidence (a negation, a brand, an exact term the model left out of the line), chooses a best seller only between interchangeable products with nothing left unexplained, never chooses alone a product named by brand only, and asks when the message names another product the line's words share.
- **The prompt and schema**: `raw` and `query` stay in the customer's language and script; brands said in Arabic go to `brand_hint`; a brand is never a `source_hint`. The extraction call now gets 4,096 tokens; an invented unit becomes "each"; a reading sent as a JSON string, or as almost-JSON (`\'`, a trailing comma, one closing brace too many), is repaired (`parseLooseJson`). Each of these threw away a whole reading on the live model before (126 of 986 turns).
- **Staging**: the pack loads by SKU, so the migration needs no catalog order. `deploy-staging` applies 0053-0059 after the merge.

Remaining wrong products: «ابعتلي كيس بازيلا وجزر مفرزة» and «bazella w jazar mkhalta» (the fast model cuts the peas-and-carrots bag into two lines: peas, and fresh carrots), «1 Wilco sodour djej» ("sodour", the plural of breast, is not in the pack: Wilco legs), and «خبز تنور العصر، مش الكبير، التاني تبع الخمس رغفان» (the large loaf is chosen although the customer said not the large one). The recall that is missing is mostly a question instead of a card (ambiguous or not found), which is the safe failure. Each of the four is a case in `evals/language/cases.json`; the next lane B session starts from them (a second pack pass for plurals, and a merge rule for an item the model cuts in two).
`claude-sonnet-5` read the same set at F1 0.897 with 4 wrong in one run, but got the 0.13 message wrong once (`results/after-claude-sonnet-5.json`); `claude-sonnet-5-5` (MODEL_SMART) cannot run the extraction at all: it refuses a forced `tool_choice`.

How to re-run: commit `evals/language/request.json` with `{"steps": [...], "repeat": n}` (`cases`, `pack`, `before`, `after`; `also_models`, `only`) on any branch, or dispatch the workflow; results come back on `language-pack-out/<run id>`. `ALO_LANG_REPLAY=evals/language/results/after.json npx vitest run evals/language/replay.test.ts` replays recorded readings through the current planner with no model (it reproduced the live numbers exactly). Credit spent: about USD 25 of the USD 60 (generation and checking with Opus and Sonnet about 16, twelve live runs with Haiku about 3, one with Sonnet 5 about 5). More runs would not have bought much: the last ones moved the numbers within noise.

| Task | Where | Tested by |
| --- | --- | --- |
| 1.22 | migrations 0053 (matcher, planner), 0054 (pack, generated); `schemas.ts`, `prompts/concierge.md`, `concierge.ts` (`parseLooseJson`), `pipeline.ts` (passes the message); `evals/language/`; `language-pack.yml` | `test/db/catalog-language.test.ts` (the 13 Nov readings, negation, the pack that ships has no shared exact term and no food-fact word), `evals/language/pack.test.mjs` (builder, JS folds as SQL), `evals/test/extract-contract.test.ts`, the live runs |
| 1.7 Voice notes | migration 0059 (`settings.stt` gains `keep_audio`, `second_provider`), `readVoiceNote()` in `packages/agents/src/stt.ts`, `turn.ts` | `test/db/ordering-b3.test.ts`: fetched through Kapso's URL, kept under `voice_notes/<party>/<sha256>.ogg` in the private bucket, Kapso's transcript read; with the setting, a second provider's transcript is taken and rescues a looped one; a Meta link is never fetched. Both transcripts and what failed go to `wa_messages.transcript` (never logged) |
| 1.8 Typing, model-turn cap | migration 0055 (`settings.model_turns` 20 an hour, `model_turn_budget()`), `turn.ts`, `TurnDeps.typing` | Indicator on the message being answered, once, only when the model is needed, and a failing indicator never stops the turn; past the cap: no model call, handoff, one ops exception an hour, ops alerted, customer told; answers without a model are never capped |
| 1.13 First contact | migration 0056 (`parties.first_contact`, `orders.acquisition`, `record_first_contact()`, `settings.contact_codes`) | Ad click (ctwa_clid, ad id) on the customer and the first order, not the second; QR and referral codes from the first message; a later message changes nothing; a customer who wrote before stays unknown. Data only, no reward, no message |
| 1.17 Voice by role | migration 0057 (`voice_usage`, `voice_budget()`), `packages/agents/src/voice.ts`, `turn.ts` | Limits from `settings.voice_limits`; the hourly budget holds across turns; the provider's real duration wins over the size estimate; a retried note counts once; riders and staff: their own limit, a person listens, money stays buttons (`voiceOnOpsLine`) |
| 2.9 Feedback | migration 0058 (`order_feedback`, `feedback_due()`, `record_feedback()`, `settings.delivery_feedback`), `packages/agents/src/feedback.ts`, `turn.ts` | One card after the delay, never twice; «في مشكلة» hands the chat to a person, raises `delivery_problem`, alerts ops; «وصل تمام» thanks once; a repeat tap does nothing; nobody answers for someone else's order |

Also done: C2's request to route the customer's keep / remove taps for a substitute (`turn.ts` calls `handleSubstitutionButton()` before any tap can reach the model). `settings.picking.offer_substitutes` stays off: switching it on by default breaks C2's picker tests, which assume it off, so the next hub session switches it (staging: one settings update) together with those tests. C2's two other lane B requests (crediting `apply_customer_credit` on the card, and what `learn_from_order` learns from replaced lines) are still open. For A2's request: the `reply` and `ask_location_pin` tools mark model text `authored: model`, so the gateway checks it again (not when code appended prices: the gateway check reads the whole body).

Found and not changed:
- `fold_text` (0003) maps ة to ي, ى to ا, ؤ to ه and ئ to و (its two strings are misaligned). Consistent on both sides, so search works, but «قهوة» and «قهوه» fold apart. `catalog_tokens` maps those letters first; `fold_text` is left as is because stored columns depend on it.
- `MODEL_SMART` (`claude-sonnet-5-5`) rejects the forced `tool_choice` the extraction uses. Anyone switching models must change the call first.

Only a live account can prove: the probe turning the 0.13 message into the right card on staging (after the merge), the typing indicator, a second speech provider, a real ad referral payload.

For other sessions (B3 did not touch these files):
- A2 / lane A, `apps/gateway/src/index.ts` and `packages/wa/`: (1) a gateway call that marks a message read with the typing indicator, passed as `deps.typing` in `depsFor()` (better still, called on arrival in `ConversationDO.fetch`); (2) `await sendFeedbackRequests(deps, (p) => party_address(p, 'customer'))` from `@ak/agents/feedback` in `scheduled()`: 2.9's cards go out only once this is wired; (3) `deps.stt` once the founder picks a second provider and its key exists; (4) a way for the gateway to re-check only the model's words of a reply that carries code-written prices (e.g. `authored.text`).
- C2, `apps/gateway/src/ops-turn.ts`: audio on the ops line is ignored today (invariant 18 says nothing may be dropped in silence). Call `voiceOnOpsLine()` from `@ak/agents/voice` for a rider's or staff member's note, send its `reply`, and alert ops with `OPS_VOICE_TEXT.opsAlert` when `forwardToOps`.
- C1's `test/db/extensions-schema.test.ts`: B3 changed the list of functions expected to call trigram functions (they moved into `search_catalog_legacy` and `catalog_brand_fits`); the guard itself is unchanged.
- Anyone redefining `plan_order_core` or `search_catalog`: start from 0053's text.
- A2 / lane A, the probe: **a probe stuck in a handoff stays stuck.** At 12:36 UTC (before B3 merged) a probe turn lost its reading (the string-reading failure 1.22 fixed) and handed off; from then on every hourly probe message went to "a person" and no model ran, so `heartbeat:probe_silent` opened every hour (13:34 to 17:00) without saying why. B3 released the probe customer's conversation on staging by hand at 17:20 (`human_handoff = false`, the probe party only). The probe should release its own handoff (or the alarm should name it), and the console needs a release action (`release_handoff`, still proposed only).
- D1 / D2, `apps/console/test/*`: each test opens its database (every migration and seed) inside the test itself, under vitest's 5-second default. B3's migrations add about 0.3 s to that (2.6 s to 2.9 s here), and on a loaded runner `exceptions.test.ts` timed out once (B3's docs PR, passed on re-run). Open the rig in `beforeAll` with a longer timeout, or give those tests one.
- Founder: Kapso transcribes voice notes through ElevenLabs, which may keep transcripts up to three years. Say so in the privacy notice, or choose a second provider (`settings.stt.second_provider`) and score both on the 38 notes (5.8).

### Session D2 (console), 13 November 2026: tasks 3.11 to 3.17, 5.15; migrations 0045-0049
Branch `claude/quirky-gauss-60ad0s` (the branch this environment allows). Built and tested locally: every page driven through the console's real request handler against PGlite with every migration (as D1's rig: the gateway's real `send()`, Supabase Auth and Storage faked), `apps/console/test/` now 67 tests in 22 files; the whole suite and the permission check are under "Checks" below. **Nothing here is proven live**: `deploy-staging` applies 0045-0049 after the merge (`--include-all`; they apply after 0050-0073 there and depend on nothing in them), and the console workflow deploys the new pages.

| Task | Where (`apps/console/src/`) | Writes through (SQL) | Tested by (`apps/console/test/`) |
| --- | --- | --- | --- |
| D1's proposed functions | migration 0045 (the file, unchanged, below a header); `apps/console/sql/` is gone | `release_handoff`, `set_offer`, `set_fx_rate`, `confirm_fx_rate`, `fx_quoting_paused`, `set_zone`, `set_village`, `config_changes` | the four D1 pages' tests now run on the migrations; the "not available yet" paths by dropping the function (`rig({ without })`) |
| Who is acting (D1's findings) | migration 0046 | `confirm_cash_drop` and `resolve_ops_exception`: ops lead or admin only; an unknown status is refused; a resolved exception is not reopened | `riders.test.ts`, `exceptions.test.ts` (picker, rider and unknown party refused by the database) |
| Refunds page (C2's 2.3) | `pages/refunds.ts` (/refunds) | `refund_order`, `pay_out_credit`, `apply_customer_credit`, `customer_credit_view` (0030) | `refunds.test.ts`: refund once per form key, the rider's fee refused after close with "charge goodwill", Whish needs its reference and nothing is recorded without it, customers owed listed and paid out, credit taken off the next order, ledger at zero, pickers refused |
| 3.11 Day close | `pages/dayclose.ts` (/day-close), `worker.ts` `scheduled()`, cron in `wrangler.jsonc` | `day_close_report`, `close_day`, `day_closes` (0047) | `dayclose.test.ts`: the day's figures from the database with unexplained $0.00; the drawer counted once; a short drawer needs a note, is posted to `cash_over_short` and leaves the day unexplained (-2.00); the founder (every admin) gets it once on the ops line, a closed window is refused by the gateway |
| 3.12 Receiving, expenses | `pages/receiving.ts` (/receiving), `pages/money.ts` | `receive_goods`, `create_supplier`, `pay_supplier` (0024); `record_expense` (0047) | `receiving.test.ts` (expiry for chilled goods, only the lead pays from the drawer, one receipt per invoice number or form key, margin at today's price), `money.test.ts` (expense from the drawer or the bank, categories from settings) |
| 3.13 Second approval | `pages/approvals.ts` (/approvals); Catalog and Refunds say when a change waits | `set_offer`, `refund_order` queue in `pending_approvals` above `settings.approvals`; `decide_approval` (0046) | `approvals.test.ts`: a 50% price change and a $25 refund wait; the asker cannot approve; another lead approves and the change runs in the asker's name; an impossible refund is refused at once; a rejected one moves no money |
| 3.14 Food-facts editor | `pages/foodfacts.ts` (/food-facts) | `add_evidence_document`, `record_food_fact` (0049) | `foodfacts.test.ts`: a picker's entry waits (unknown until approved); the lead's is approved; evidence required; certified needs a certificate; unknown recorded as unknown; the three-day expiry list |
| 3.15 Petty cash, bank deposits | `pages/money.ts` (/money), `app.ts` `upload()` | `record_bank_deposit`, `record_petty_cash`, `hub_cash_movements` (0047) | `money.test.ts`: slip number once, photo stored by its hash in the private bucket, never more than the drawer holds, lira leave at their carried value, a double tap is one movement, pickers refused |
| 3.16 Complaint cases | `pages/cases.ts` (/cases) | `open_complaint`, `note_complaint`, `close_complaint`, `complaint_cases` (0048) | `cases.test.ts`: the allergen case goes first, holds the item at once (off sale, not pickable) and raises an exception; a refund is linked (same order only); closing clears the hold only when the person says so |
| 3.17 Day open | `pages/dayopen.ts` (/day-open) | `day_open_checklist` (0048) | `dayopen.test.ts`: yesterday's unclosed order, orders waiting, drop not counted, rider cash, expiring lot, open case, cron heartbeat |
| 5.15 Label intake | `pages/intake.ts` (/intake), `label.ts` | `record_label_scan`, `review_proposed_fact`, `food_fact_review_queue`, `label_scans` (0049) | `intake.test.ts`: N1's real `propose_off_facts` files the Open Food Facts proposals; a picker scans (photos become evidence, the reading becomes proposals, an entry without printed words is dropped); the lead confirms, corrects or rejects each field with the pack photo; an Open Food Facts field cannot be confirmed without our own evidence; nothing from Open Food Facts is ever approved; without a model key the photos are saved and fields are typed |

How it fits, for whoever comes next:
- **Anyone redefining `set_offer` or `refund_order`: start from 0046.** Their 0045/0030 bodies are `set_offer_now` and `refund_order_now`, unchanged. `refund_order` may now return `{status: 'awaiting_approval', approval_id}` instead of a refund; C2's pick flow calls `grant_customer_credit` directly and is unaffected.
- **Hub money**: every movement out of the drawer is `hub_money_out` (one balanced ledger transaction and a `hub_cash_movements` row). `account_native(code)` gives an account's notes per currency.
- **The day** is a calendar day in `settings.hours.tz` (`hub_day_bounds`, `hub_today`). Probe orders are counted apart.
- **Food facts**: a confirmed field is a new fact (source from its evidence: label, supplier, certificate, lab), approved, with `detail.confirmed_from` pointing at the proposal; a rejected proposal has `superseded_at`, `rejected_by`, `rejected_at`, `review_note` (so N1's rerun does not propose the same reading again, as N1 asked). The label reader is a narrow function (invariant 21): `MODEL_FAST`, forced tool, null on any failure, photos and reading never logged.
- New pages: Day open, Refunds, Complaints, Approvals, Hub money, Day close, Receiving, Food facts, Label intake. Roles: pickers see Day open, Receiving (on credit), Food facts (propose) and Label intake (scan); the rest is ops lead and admin.

Decisions taken in code, written down for the founder (each is a setting or one line):
- **Second approval** above a 10% price move and above a $20 refund (`settings.approvals`). The person who asked can withdraw but never approve; with one ops lead and Rasheed, each approves the other's. A refund approved later runs in the asker's name, recorded with who approved.
- **The founder's report** goes out at 21:40 Beirut in winter, 22:40 in summer (the console's cron, UTC 19:40), to every admin on the ops line, as free text: **only inside the 24-hour window** (the gateway refuses it otherwise; no template exists). Write to the ops number once a day, or ask lane A for a utility template. The screen always has it.
- **A drawer that does not match** is posted to `cash_over_short` at the count (so the books match the drawer from then on) and stays on that day's report as unexplained, with the counter's note.
- **Petty cash, deposits and expenses** are ops lead and admin only. Expense categories are `settings.hub_expenses` (fuel, rent, utilities, supplies, repairs, packaging, fees, other).
- **An allergen complaint** holds the product for every order at once; closing the case does not release it unless the person ticks "the item is safe".
- **Intake does not change a product's name, brand or size.** The label reading is shown beside the catalog to check it is the right item; changing names belongs to the catalog work (1.21, 1.23) because search depends on them.

Not done, and why:
- **1.23 review list page: waits for B4.** B4 has not merged (checked on `main` when this pull request was opened). The next console session (or B4 itself, inside `apps/console/`) adds a page on B4's review list once its table and function exist.
- **For the console workflow** (`.github/workflows/console.yml`, not D2's file): add the optional `ANTHROPIC_API_KEY` Worker secret so Label intake reads labels; without it intake is typed by hand. The cron needs nothing: it deploys with `wrangler.jsonc`.
- **Lane B, still open from D1:** `quote_order` must refuse while `fx_quoting_paused()` is true (0045 is now in the database, so the 3% pause of 3.8 is real on the console side only).
- C2's other console items (pick queue, rider incidents, the `count_needed` and `pick_empty` exception actions) were not in the D2 row and are not built.
- Findings (for the owners of the SQL): `pay_supplier` (0024) and `pay_out_credit` with cash (0030) do not check that the drawer holds the money, so the books can show a negative drawer; `record_bank_deposit` and the petty-cash and expense functions do check. `close_shift` without `p_force_by` still records no acting party (D1's finding).
- The console's action log stays in the private bucket; a `staff_actions` table was not needed for the day close (every figure is in the ledger).
- `TEST_REPORT.txt` was not regenerated (not D2's file).

Checks run for this pull request: `npm run typecheck && npm test` (776 pass, 34 live-only skipped; the `test/pg` suites applied every migration, 0045-0049 included, by psql on Postgres 16), and `scripts/check_permissions.sh` on a scratch Postgres 16 in fresh and `EXISTING=1` modes (both pass: no new function or table is reachable by `anon`, `authenticated` or PUBLIC).

### Session B4 (ordering), 13 November 2026: the founder's live findings, 1.22 zero-wrong gate, 1.23, lane B requests; migrations 0074-0077
Branch `claude/nice-ramanujan-8b4nas` (the branch this environment allows), pull request rashidhamzy-hue/alo-king#27, rebased on D2 and N1.
Built and tested locally (PGlite with every migration; workerd + real Postgres for the e2e): `npx tsc --noEmit && npx vitest run`, 808 passed,
40 live-only skipped (`TEST_REPORT.txt`). What is proven live is marked.

**The founder's order of 13 Nov (18:43-18:58 UTC), read from `wa_messages` and `agent_runs` on staging, became a test before each fix**
(`test/db/live-order-b4.test.ts` replays the four turns with the live model's own readings; `evals/cases/address_readings.json` holds the two misreadings for the live model).
What happened, from the traces: (1) the reading put «عبعقلين» in `needs_clarification` with no village; the plan asked; the model sent its own pin request and nothing kept the three lines. (2) The model's `resolve_place` had set the village to Baakline from the text; `save_customer_pin` saved whatever the conversation believed and never looked at the pin (no village had coordinates). (3) The voice note's reading put «راجح» in `address.village`. (4) With an empty basket the bot asked him to send the order again.

| Finding | Fix | Tested by |
| --- | --- | --- |
| Basket lost | A village written in the message is found by code when the reading leaves it out (`village_in_text`, with the clitics ع ب ل و، "3a b3aklin"; never «حي X»). A basket whose only gap is *where* waits on the pin (`pipeline.ts`); a pin request the model sends also keeps the basket | the replay; `village_in_text` cases |
| The pin decides the village | Migration 0074: village centres from OpenStreetMap as data (`village_coords`, 41 of 42; Jdeidet ech Chouf has none), filled into `villages` now and on insert. `locate_pin()`: nearest centre within `settings.pin_locate.max_km` (2.5) and clearly nearer than the next (`margin_km` 0.4); otherwise the customer taps the village (`pinvillage:` buttons, checked against the pin by `set_pin_village`). A named village with no centre is always asked. When the text said another village the card says which one wins | the replay (his pin is Khraibeh, 0.34 km); a pin between Ain Qani and Moukhtara is asked; a far tap is refused |
| «حي راجح» is not a village | After a pin, the next words are the address for it, whatever village the reading guessed (`takeAddress`, `set_place_details`). A first delivery to a new place gets one question for house and floor, then the card. Prompt and schema: «حي/حارة X» goes in `landmark` | the replay; the address eval cases |
| No card | The replay ends with the card for Khraibeh ($2.50 delivery, its zone) and a confirmed order | the replay |

The 0.13 flow is now: message → pin request → pin → «وصلنا موقعك 📍 التوصيل على …. كرمال السائق: شو اسم البيت أو البناية، وأي طابق؟» → the answer (text or voice) → card. A pin and an address sent together, or a returning customer's saved place, go straight to the card.

**1.22 zero-wrong gate.** The four phrasings are cases first: `evals/language/zero-wrong.json` (all seven live readings of them, replayed through `plan_order` in CI by `zero-wrong.test.ts`) and hand cases `hz*` in every live run. Migration 0075 redefines `plan_order_core` from 0053's text with four rules, each named per line in `b4`:
1. a choice the line negates is withdrawn («مش الكبير» and the Large loaf);
2. the model's phrase never picks while a word left over looks like another same-brand kind's word («sodour» ≈ «sdour»: breasts, not legs);
3. the doubt check also runs for a line the model translated (the customer wrote «jazar», the line says «جزر») when another product explains more of the message;
4. a kind or exact term said word after word across two neighbouring lines («بازيلا وجزر») makes both lines one question;
5. products a line leaves tied and a size word in the message no line carries («wooden bakery l kbar» left in `source_hint`): no best-seller assumption (found by the first live run);
6. (migration 0078, found by the final run) a line that says big or small, a chosen product whose own words never do, no number of the product's own in the line, and another product of the same brand in view: a question.
The message is now scanned once per plan. Replay of all 1,972 recorded live readings of B3's runs: wrong products **10 → 0**, F1 0.918 → **0.918** (precision 0.995 → 1.000, recall 0.853 → 0.849). Live runs on this branch (GitHub Actions `language-pack`, `claude-haiku-5-5`, 990 cases x 3 each, about USD 3 a run):

| Run | Code | Item F1 | Wrong products | 0.13 message right | Address cases (6) |
| --- | --- | --- | --- | --- | --- |
| B3's runs | 0053/0054 | 0.918 | 10 in 2,458 items | yes | (none) |
| 43500022007 | rules 1-4 | 0.912 | 1 in 3,708 (g0354, the size in `source_hint`) | 3 of 3 | 6 of 6 |
| 43500871819 | rules 1-4, rebased | 0.915 | 2 in 3,708 (the same g0354 reading, twice) | 3 of 3 | 6 of 6 |
| replay of run 43500022007's 2,970 readings | rules 1-5 | 0.913 | **0** | 3 of 3 | |
| 43504902606 (final, the merged code) | rules 1-5 | 0.915 | 2 in 3,708 (g0452 twice: «بيبسي دايت الكبيرة، تنين ليتر وربع», 2.25 L in words, got 1.25 L) | 3 of 3 | 6 of 6 |
| replay of the final run's 2,970 readings | rules 1-6 (0078) | 0.912 | **0** | 3 of 3 | |

By language (first run): Lebanese Arabic 0.922, mixed 0.917, Arabizi 0.891, English 0.966, French 0.938. `results/after.json` is the first run's readings (replay with `ALO_LANG_REPLAY=evals/language/results/after.json npx vitest run evals/language/replay.test.ts`, about 12 minutes); `results/live.txt` its `evals/live` report.
The gate as written (F1 at least 0.90, zero wrong products, the 0.13 message right on staging): met on the replay of live readings; a live run's model can still produce a reading no rule has seen, so every wrong product found later becomes a `zero-wrong.json` case before its fix.
`evals/live` on the same runs: the six address cases pass; two older cases fail as before B4 and are not B4's: `healthiest` (the output guard refuses the model's first two wordings, «healthiest» and «allergen» as words; the third goes out, so the customer is answered: a false positive of the guard, B2's) and «kifak? shu 3am ta3mol lyom?» (read as a greeting, which gets the greeting answer, not off-topic). `best-restaurant` failed once in the second run the same way. Recorded for the next lane B session.
Anyone redefining `plan_order_core`: start from 0075's text.

**1.23 search words for every new item** (migration 0076; `packages/agents/src/pack-rules.ts`, `search-words.ts`, `cron.ts`; `test/db/search-words.test.ts`, `evals/language/pack-rules.test.ts`).
A product inserted without words, or whose name, Arabic name or brand changes (the size is in the name), is queued; a nightly pass (00:41 UTC) queues anything whose words were built from an older name. Each cron minute takes `settings.search_words.per_tick` (2) jobs: the fast model proposes kind, brand and exact words in the four languages plus four phrasings, with the item's shelf in view; `pack-rules.ts` drops food-fact words not printed in the name and over-long terms (the same rules as `build-pack.mjs`, proven equal on every term of the 1.22 pack); `save_search_words` applies the whole-pack rules (an exact word two products claim names neither, an exact word that is another's kind word is kind, a kind word that is a brand is dropped); `check_search_words` runs the phrasings through the planner and an item they do not resolve to goes on `search_word_reviews` (`search_word_reviews_open()`, `resolve_search_word_review()`: for D2's console page). A failed job retries three times. The 291 products of the 1.22 pack get no job. Menu items (Phase 8) are products, so they are covered. Only a live account proves the fast model's words on a real new product (nothing has been added on staging yet).

**Lane B requests** (migration 0077):
- D1: `quote_order` (0052's text) refuses with `fx_paused` while a rate move waits for a person (D2's 0045). The customer is told once by code (`FIXED.fxPaused`), no model writes about prices, the basket is kept. Tested with D2's real `set_fx_rate` / `confirm_fx_rate`.
- C2: `apply_customer_credit` runs on every new card; the credit is its own line («رصيد إلك من قبل: -$x») and the total adds up.
- C2: `learn_from_order` learns each asked-for product once, from lines that left the hub as asked (no removed, missing or substitute lines; a kept substitute is not what they asked for).
- B3: `index.ts` wires the typing indicator (`deps.typing`: Kapso `markRead` with a typing indicator; it sends no message and is never called for a probe) and one call to `customerLineCron` in `scheduled()` (2.9's feedback cards, which go out from now on, and 1.23).
- B3: `probe_due()` gives a probe conversation stuck with a person back to the Concierge when no probe order is open, and opens an ops exception `probe_handoff_released` naming the handoff's reason. With `settings.probe.fresh_place` true, each hourly probe order is a first order (its places are cleared), so it walks pin → address → card; the probe answers the address question in words (`probe.ts`).

**Staging proof** (`deploy-staging` 43508174320 applied 0074-0077 at 21:10 UTC; checked with the Supabase connector):
- The founder's own pin of 13 Nov now resolves to Khraibeh (`locate_pin`, 0.34 km); 41 villages have centres; the probe pin is Baakline's centre.
- The wired cron sent 2.9's feedback cards at 21:11 (to the probe's sink, one per closed probe order): the first live use of that wiring.
- The probe was set to `fresh_place` (first order every hour). At 21:42 UTC staging was closed (23:42 Beirut; hours 08:00-23:00), so the probe's order got the "we're closed" path and no card: that path keeps no promise it cannot keep, but after the pin the bot answered with the greeting; recorded below. To prove the order path the same evening, staging's hours were opened all day and the probe interval set to 2 minutes; the interval went back to 60 as soon as the order was sent.
- **AK-1005 (21:46-21:52 UTC), the first-time path on the live model:** the 0.13 message → the code's pin request with the basket waiting (no tool loop) → pin (Baakline's centre) → card for Baakline, $7.27 → confirm → rider offer, accept, pick-up, on the way → arrived, delivered → cash recorded → closed; every transition allowed, ledger sum 0.0000. It did not ask for house and floor: the live reading put «عبعقلين» in `address.verbatim`, which counted as directions. Fixed in rashidhamzy-hue/alo-king#30 (a village name alone is not an address), replayed as a test first.
- Second first-order (AK-1006, 22:14 UTC, after #30 deployed): again no address question. The reading was right this time; the conversation still held AK-1005's directions. Fixed in rashidhamzy-hue/alo-king#31 (a new order's directions are its own; the card clears them), replayed as a test first. AK-1007 (22:39 UTC) ran within two minutes of that deploy, on the conversation object's previous code, and behaved like AK-1006.
- **AK-1008 (22:48-22:53 UTC), the full first-order path on the live model, after #31 deployed:** the 0.13 message → the code's pin request → pin (Baakline's centre) → «وصلنا موقعك 📍 التوصيل على بعقلين. كرمال السائق: شو اسم البيت أو البناية، وأي طابق؟» → the probe's answer («بيت الاختبار، الطابق الأول، حد ساحة الضيعة», read by the live model as the address) → card $7.27 → confirm → rider offered, accepted, picked up, on the way → delivered → cash recorded → **closed**. No transition outside `order_transitions`, the ledger sums to 0.0000, no outbox key twice, and the rider's card carries the customer's own words.
- Staging settings left as found, except `settings.probe.fresh_place = true` (every hourly probe order is now a first order: pin, address, card, closed). Hours went back to 08:00-23:00 Beirut at 22:54 UTC and the probe interval to 60 minutes.
- Cosmetic, for the next lane B session: the order note reads «… الطابق الأول | طابق الطابق الأول» (`directionsOf` prefixes «طابق» to a floor that already says it).

Files outside lane B, each minimal: `apps/gateway/src/index.ts` (the two wiring lines and their imports), `packages/wa/src/probe.ts`, `scripts/staging/prepare-staging.sql` (the probe pin, 33.6789/35.5778, "Baakline, approximately", is 1.1 km from Semqaniyeh's centre and 1.3 km from Baakline's: now Baakline's centre) and the e2e crash test's pin in `test/pg/worker-e2e.test.ts` (same reason).

Found and not changed:
- Ordering after hours: the plan asks (closed), the model sends a pin request saying "we continue later", and after the pin the turn has no card to send (`create_order_from_quote` refuses while closed), so the model answers with the greeting. Nothing wrong is promised or charged, but the basket is not kept for the morning. A next lane B session: keep it and say when it will be sent, or say at once that orders open at 08:00.
- `apps/console/test/today.test.ts` failed once in a full local run and passed alone and on the next run: it measures lateness against the clock. Not B4's file.
- The fast model reads «عبعقلين» and «بحي راجح» differently from run to run; code no longer depends on either reading (the address eval cases watch it).
- `place_has_details` asks once for house and floor on a first delivery to a new place. If the founder prefers the card straight after the pin, drop that step in `completePending` (one condition); the pin alone is enough for `confirm_order_checked`.

For other sessions:
- K1 (1.21) can start: B4 is the lane B session it waits for. `turn.ts` changed in the pin branch, the button branch (`pinvillage:`) and after the reading (`takeAddress`).
- Anyone touching `save_customer_pin`: 0074 changed its meaning (the pin decides; `p_village` is only what the conversation believed). A test or script that saves a pin far from the village it names now gets the pin's village or none.
- D2 or the next console session: the 1.23 review list (`search_word_reviews_open`, `resolve_search_word_review`).

### Session D3 (console), 14 November 2026: the D2 leftovers; migrations 0080-0081
Branch `claude/confident-ritchie-uv7wid` (the branch this environment allows), pull request rashidhamzy-hue/alo-king#33. Built and tested locally on
PGlite with every migration, through the console's real request handler (D1's rig): `npx tsc --noEmit && npx vitest run`, 816 passed,
40 live-only skipped; `scripts/check_permissions.sh` on a scratch Postgres 16 passes (nothing new reachable by `anon`, `authenticated` or PUBLIC).

| Task | Where | Writes through (SQL) | Tested by (`apps/console/test/`) |
| --- | --- | --- | --- |
| 1.23 review list | `pages/searchwords.ts` (/search-words, ops lead and admin) | `search_word_reviews_open`, `resolve_search_word_review` (0076); `rerun_search_words` (0080: queues the item again, reason `manual`, and closes its open phrasings) | `searchwords.test.ts`: a phrasing that missed is listed with what the planner did and the item's words; done once; rebuild queues and closes; a job running now is not queued twice; a job failed three times is listed and retried; an inactive item is refused; pickers refused by the page and by the database |
| Label reader key | `.github/workflows/console.yml` | none | the deploy sets `ANTHROPIC_API_KEY` on the console Worker when the repository secret exists (otherwise the summary says intake stays typed by hand); `scripts/smoke.sh` reports whether the deployed intake page reads labels |
| The drawer never below zero | migration 0081; `pages/receiving.ts`, `pages/refunds.ts` | `drawer_can_pay` (hub_money_out's check, same lock, same `NOT_ENOUGH_CASH hub_cash`); `pay_supplier_checked`, `pay_out_credit_checked` (cash only; a repeat is still a repeat); `refund_order_now` pays cash through the checked one (so does an approved refund); `receive_goods` paid from the till checks its total | `receiving.test.ts`, `refunds.test.ts`, `approvals.test.ts`: an empty drawer refuses the supplier payment, a till receipt, a cash payout, a cash refund and its approval (which keeps waiting); a rider's drop fills it; exactly what is left empties it; the same receipt number is still answered as a repeat when the drawer is empty |

Found and fixed: B4's `check_search_words` (0076) failed the whole job when a phrasing found nothing (the planner's `candidates` is JSON
null; `jsonb_array_elements` raised), so the commonest miss never reached the review list: three tries, then a failed job. 0080 redefines
it with that one line changed. **Anyone redefining `check_search_words`: start from 0080. `pay_supplier_checked`, `pay_out_credit_checked`,
`refund_order_now`, `receive_goods`: start from 0081.**

Not done, and why:
- **The base `pay_supplier` and `pay_out_credit` still take the drawer below zero when called directly.** Every console path goes through
  the checked functions, and nothing else calls them in production. Moving the check into the base functions breaks lane C's
  `test/db/refunds.test.ts` and `test/db/receiving-margin.test.ts`, which pay from an empty drawer; those files are not D3's. The fix is
  two fixture lines there (drop the rider's cash at the hub before paying: `declare_cash_drop` + `confirm_cash_drop`), then
  `perform drawer_can_pay(...)` in the base bodies. For G1 or the next session that owns `test/db`.
- A rider's earnings paid from the hub at settlement (0010, lane C) do not check the drawer either.
- Audit item 16 (SMTP for staff invitations) waits for the founder's decision.

**Staging, proven live** (console workflow run 43562442212, this pull request's deploy, 14 Nov 05:40 UTC; audit item 13):
- `ANTHROPIC_API_KEY` is now a console Worker secret on staging; the deployed intake page reads labels ("label reader: on"). No real
  label photo has been read yet: that waits for real stock (5.15).
- Every page opened once with the smoke account against the staging database, all **work** (200, no error on the page):
  as a picker `/`, `/day-open`, `/receiving`, `/food-facts`, `/intake`, `/returns`, `/catalog`; as an ops lead (the same account, for
  those GETs only) `/day-open`, `/refunds`, `/cases`, `/approvals`, `/money`, `/day-close`, `/receiving`, `/food-facts`, `/intake`,
  `/search-words`, `/payments`, `/riders`, `/exceptions`, `/fx`, `/zones`, `/merchants`, `/pictures`. The account was a picker again
  after the run (checked in `parties`). Every console deploy repeats this sweep and writes the table into the run summary.
- What opening a page does not prove: the forms on them (the actions are proven on PGlite only). Staging has no stock, supplier or cash,
  so posting would have nothing true to record.
- 0080 and 0081 reach staging with `deploy-staging` after the merge; until then `/search-words`'s rebuild button says the function is
  not available yet, and staging's drawer checks are the old ones.

### Session K1 (catalog), 14 November 2026: B4's lane B leftovers, audit items 4 and 5, task 1.21; migrations 0085-0087
Branch `claude/vibrant-wozniak-2rvmp9` (the branch this environment allows), rebased on D3. Built and tested locally (PGlite with every
migration; real Postgres for `test/pg`): `npx tsc --noEmit && npx vitest run`, 851 passed, 40 live-only skipped; `scripts/check_permissions.sh`
on a scratch Postgres 16 passes. Nothing here is proven live: staging gets 0085-0087 with `deploy-staging` after the merge, and the
catalog needs Rasheed's Meta steps first (`docs/RUNBOOK.md`, "WhatsApp catalog").

**B4's leftovers, each a failing test before its fix.**
| Leftover | Fix | Tested by |
| --- | --- | --- |
| An order after closing time lost its items, and the pin got a greeting | With every line known and only `closed` (and where) in the way, code keeps the basket in the conversation (`awaiting: "opening"`), says when we open (`FIXED.closedKept`) with one button «ابعت طلبي» (`kept:send`), and answers a night pin with the hours (`closedKeptPin`), never the model. `issueCard` keeps the basket the same way when we close while it waits (pin, house, phone). The tap, once open, carries on through the normal path (pin, village, house and floor, card), re-priced by the database | `test/db/after-hours-k1.test.ts`: the night order, a night pin, a tap while closed, the tap after opening; closing between the pin and the address; the staging probe's 21:42 path (no tool loop) |
| The order note said the floor twice («الطابق الأول \| طابق الطابق الأول») | `directionsOf` adds «طابق» only to a bare number or word | `packages/agents/test/directions.test.ts` |
| `healthiest` (live eval): the guard refused «healthiest» in a sentence declining to rank, and «allergen» in an offer to filter | Quality words are read per clause; a clause that declines to rank, rate or recommend passes; a comma or a contrast word starts a new clause, so "I can't rank them, X is the best" is still refused. An offer to filter may name the category words (allergens, ingredients), never a fact | new `good` and `bad` lines in `evals/cases/neutral_and_food_facts.json` |
| «kifak? shu 3am ta3mol lyom? khabberne 3an 7alak» (live eval) read as a greeting | Chat about the assistant with nothing about an order is recognised by code (quick intent `small_talk`) and gets the one off-topic line; the prompt says the same for the model's reading | new cases in `evals/cases/quick_intents.json` |
The two live eval cases still need a live run to show the model's own readings and wordings now pass (`language-pack` / `evals/live`); code no longer depends on the reading for the kifak case.

**Audit (docs/AUDIT-2026-11-14.md) items given to K1.**
- Item 4, the kept order offered when we open: migration 0087 (`kept_orders`: who has a kept order, never the basket). The minute cron
  (`offerKeptOrders` in `packages/agents/src/cron.ts`) sends one fixed service message with the button once the shop is open, only when the
  order was kept and the customer last wrote under 23 hours ago; the gateway's `can_send` still decides. Any card or the button clears it.
- Item 5, saved places from before "the pin decides": migration 0086 runs `recheck_places()` once. A place whose pin is clearly in another
  village (or outside, or between villages none of which is the saved one) loses its village and pin, so the next order asks for the pin;
  what it said is kept in `place_rechecks`. On staging this should set aside the founder's place of 13 Nov (Baakline, pin in Khraibeh):
  check `select * from place_rechecks;` after the deploy.

**1.21 WhatsApp catalog.**
| Step | Where | Tested by (`test/db/catalog-k1.test.ts`) |
| --- | --- | --- |
| 1 Categories | 0085: `catalog_categories` (the 15 approved), `catalog_placements` keyed by SKU (all 291), `catalog_subgroups` (water / soft drinks and juice / coffee and tea: the 42 drinks are more than one list). K1 checked every placement against the catalog's own category and storage: seven moved, listed in the migration's header (two chilled creams to dairy, the chilled garlic paste beside Mamig's, the creamer to the coffee, jam to the breakfast spreads, ketchup beside the mayonnaise). `data/proposals/categories.json` is left as approved; the test lists the seven differences | the fifteen, in order, with their approved names; every product placed once, only the seven moves; only drinks over 30, every sub-group at most 30 |
| 2 Feed | `GET /catalog/feed.csv` (`apps/gateway/src/catalog-feed.ts`, one route line in `index.ts`), basic auth user `meta` and `CATALOG_FEED_PASSWORD`; `catalog_feed()`: active, placed, sold at the hub, an approved customer-usable picture (`product_image_licence_usable`); columns id, title (Arabic name), description (both names, the picture's credit for CC BY-SA), availability from free stock, condition, price `x.xx USD`, link (`settings.catalog.product_link`, `{sku}` filled; 503 until a person sets it), image_link (a signed link to the private bucket, a week), brand, product_type, custom_label_0 (the category code, for Meta's sets) | nothing without an approved, usable picture (proposed and licence-unknown left out); 401 without the password, 404 without the secret; price and stock from the database; 503 without the link; a picture that cannot be signed leaves its row out |
| 3 Meta side | `docs/RUNBOOK.md`, "WhatsApp catalog": Rasheed's clicks (password, link, catalog, hourly feed, catalog id into `settings.catalog`, one set per category, connect to the number, catalog icon and cart on) | not testable from code |
| 4 Sending | The Concierge's `show_catalog` tool (`packages/agents/src/catalog-messages.ts`): no argument for the catalog view, a category (code or name in any language) as product lists, or one product. Code builds and words every message; `interactive` through the gateway with the turn's keys (no new type). Never more than 30 products or 10 sections a message; a category that needs more than two messages gets the catalog view | 300 random categories through the builder: no message over the limits, every product once; the tool sends a product list with the catalog id; with no catalog id it refuses and the turn goes on in words |
| 5 Receiving | An inbound `order` message is handled by code in `turn.ts` (`takeCart`, `packages/agents/src/cart.ts`): `plan_cart()` (0085) turns the cart into the same quote lines a typed order makes, leaves out and names unknown and out-of-stock items, names prices that moved, picks the usual place as `plan_order` does; then the normal path (card, pin, house and floor, kept until we open). Anything that needs words (below the minimum, a village we do not serve) goes to the Concierge with the basket kept. A cart from another catalog is refused | a cart and the same order typed give the same items, totals, village and payment; out of stock named and left out before the card; a stale price named and the card at the database price; a new customer's cart waits on the pin, then the house, then the card, with the cart's note on the order; only the tap confirms |
| 6 Sold out | The feed says out of stock from free stock at each fetch; `plan_cart`, `quote_order` and `create_order_from_quote` refuse a sold-out item at once | the out-of-stock cart |

Checked against Meta's documentation (14 Nov): product lists hold at most 30 products in up to 10 sections, with a text header; an
inbound cart is message type `order` with `catalog_id`, `text` and `product_items` (`product_retailer_id`, `quantity`, `item_price`,
`currency`); a scheduled feed is fetched at most hourly and may sit behind HTTP basic auth. Not settled from the documentation: whether
`link` is required for a WhatsApp-only catalog (the feed always sends one, the wa.me link) and the exact picture size rules (P1's pictures
are 1200 px, at least 800 px wide, which is above every published minimum K1 found).

**Not done, and why (for Rasheed or the next session).**
- **Blocked on Rasheed (Meta and Cloudflare):** RUNBOOK "WhatsApp catalog" A to C. Until then `show_catalog` answers `catalog_not_ready`
  and the Concierge carries on in words; nothing customer-facing changes.
- **Pictures:** 2 of 291 items have a proposed picture and none is approved, so the feed is empty today. The catalog fills as pictures
  are approved on the console's pictures page (P1, P2, intake 5.15).
- **Lane A request (A4 owns `index.ts`, `.github/`, `wrangler.jsonc`):** add `CATALOG_FEED_PASSWORD` to `deploy-staging`'s `wrangler secret bulk`
  and to the secret names at the bottom of `wrangler.jsonc`. K1 added one route and one optional env field to `index.ts`, nothing else.
- Commerce settings (catalog icon, cart) through Kapso's Meta proxy were not tried: no catalog exists yet. The RUNBOOK gives both routes.
- A cart below the minimum order is worded by the Concierge (the basket is kept); the live model has not seen one yet.
- `TEST_REPORT.txt` regenerated for this tree.

**For other sessions.** Anyone redefining `plan_cart`, `catalog_feed` or `recheck_places`: start from 0085/0086. A new product needs a
`catalog_placements` row (by SKU) to be in the catalog; `catalog_feed_report().not_placed` lists any that lack one (the console could show it).
P2's new licence `public_page` reaches the feed only if `product_image_licence_usable()` says it may.

### Session P2 (research loader), 14 November 2026: founder decision "Product pictures from public pages"; migrations 0070, 0071
Branch `claude/compassionate-goldberg-htngdk` (the branch this environment allows). Built and tested locally (PGlite with every migration, 19 cases in `scripts/product-data/test/research.test.mjs`; whole suite green; permission check on a fresh Postgres 16). The load itself runs only in GitHub Actions (`.github/workflows/research-load.yml`: by hand, and after every successful staging deploy from main; it always reads the files on main).

| Part | Where | Tested by |
| --- | --- | --- |
| Pictures: `public_page` licence, usable by customers once a person approves | migration 0070 (`product_image_licence_usable()` accepts it; source kind and licence are a pair; the picture's address and its page, both https, are a check constraint; `product_image_coverage()` counts them). `unknown` (P1's search results) is still never shown | `research.test.mjs`: proposed then approved then withdrawn, the database refuses a public-page picture without its page and a search result filed as public page |
| Pictures: download, vision, propose | `scripts/images/research-pictures.mjs` runs P1's own `evaluate()` and `decide()` on up to five candidates, best first; the first that passes is proposed. `cannot_tell` is a no; 800 px measured; a picture a person rejected is never re-proposed | same file |
| Facts: ingredients, allergens, nutrition, diet labels, storage, origin | `scripts/product-data/lib/research.mjs`, migration 0071 (`propose_web_facts`): source `web_page`, status `partial`, page address and market in `detail`; a check constraint makes a web_page row unapprovable. No model is used | same file |
| Repeatable | `research_loads` (item, part, sha-256 of the file): a part already loaded to the end is skipped, an edited file is loaded again, an error is always retried; an item that already has a usable picture gets no second one | same file |
| Report | `research_load_coverage()`: items with a proposed picture, items with a proposed fact of each kind, approved-from-web (must be 0), and the items with no picture with the reason; printed in the run summary and the `research-load-report` artifact | same file |

Decisions taken in code, written down:
- **Allergens** only when the file carries the literal quote. Each named allergen must be stated by a clause of that quote with the same value (contains / may contain); "free from", "without" and "does not contain" never count; a page never says "free". An allergen the quote does not say is reported as not proposed.
- **Diet labels**: only halal, vegetarian and vegan, as "yes", and only when the file's basis names the label. "Gluten free", "lactose free" (free statements, recorded from the pack at intake, as N1 decided) and "organic" (no attribute) are reported, not proposed. Fasting is never proposed.
- **Nutrition** only per 100 g or 100 ml; a per-serving panel is not converted.
- **Storage and origin** are two new food attributes (`storage`, `origin`) of kind `ingredients` (printed text in `detail.text`), so the shape trigger, the intake and food-facts pages and `product_meets_restrictions` (answers not_a_restriction) read them without change.
- A file with match confidence `unsure` gives no facts; a picture-only file (loose produce) is fine.
- `food_fact_review_queue()` counts web-page proposals on their own (`from_web_page`).
- Migration 0072 is unused.

Not built / not proven: the load against the real pages, the real model and the staging database has not run (no runs yet: `data/research/` holds only the README on main until R1-R3 merge). Nothing is approved by code: a person approves each picture on the console picture page and confirms each field against the pack at intake.

### Session C3 (hub), 14 November 2026: task 2.8; C2's and B3's requests; migrations 0040-0043
Branch `claude/blissful-mendel-wmak4a` (the branch this environment allows). Migrations 0040 to 0043 (0044 unused, reserved for C3).
Built and tested locally: PGlite with every migration and `npx vitest run` (899 passed after rebasing on K1 and P2, 40 live-only skipped, `TEST_REPORT.txt`; one earlier full run had a timing miss in N1's `off-http` rate test, 48 ms against 50, which passed alone and on every run since); two real connections on Postgres 16 for the last place
in a window (`test/pg/slot-race.test.ts`). Nothing here is proven live: no customer can choose a window yet (the ordering lane
wires it, below), and staging has no window rows.

| Task | Where | Tested by |
| --- | --- | --- |
| 2.8 (a) Windows are data | 0040: `delivery_window_plans` (weekdays, times, capacity, both cut-offs, optional zone, optional calendar kind), `delivery_calendar` (Ramadan, Lent, holiday, other; a closed flag), `delivery_slots` generated from them for `settings.scheduling.days_ahead` days, `edit_delivery_slot`, `delivery_schedule` | `test/db/scheduled-orders.test.ts`: slots in the hub's time with both cut-offs; a closed day has none; a Ramadan plan replaces the ordinary ones on its days; a plan's new capacity reaches its slots, a slot a person edited keeps its own; only the ops lead or admin edits |
| 2.8 (b) Capacity | 0040: `slot_holds`, taken only by the confirmation tap (`confirm_order_checked` checks under a lock on the slot row; a trigger on `orders` is the second lock), released on cancel; `open_delivery_windows` lists only open slots with room | The acceptance test **"A full slot refuses a scheduled order"**: back to draft, nothing held or reserved, `no_slot` demand logged, never delivered "now" instead; the card never offers a full window; `test/pg/slot-race.test.ts`: two taps at once for the last place, one confirmed and one refused |
| 2.8 (c) Cut-offs | 0040: `order_by` per slot, `fresh_order_by` earlier, for an order with a line in `settings.scheduling.bought_to_order` (fresh) | Past the order-by a window is not offered, chosen or confirmed (`slot_closed`); fresh goods follow the earlier cut-off while shelf goods still go |
| 2.8 (d) Changes | 0040: `handle_order_button` (edit on a confirmed scheduled order answers `change_open`; cancel goes through `cancel_scheduled_order`), `link_replacement_order`, the replacement applied in `confirm_order_checked` | A change is a new card; nothing moves until the tap; then the old order is cancelled and the new one confirmed in one transaction, in a full slot; cancel before the cut-off, `too_late` after; a paid order cancelled is owed back as credit; ledger at zero |
| 2.8 (e) Rescheduling | 0040: `reschedule_order` (customer before the cut-off; ops at any time with a reason, never past capacity or into a closed slot), `slot_changes` | Holds move in one transaction (both slot rows locked in id order); a full window refused; ops past the cut-off with a reason; a held slot on a day the calendar closes is closed to new orders and raises `scheduled_day_changed`, the order keeps its promise |
| 2.8 (f) The rider in time for the window | 0041: `dispatch_order` from 0035's text (answers `scheduled` until `release_before_min` before the window, then releases; not batched before), `orders_waiting_for_rider`, `pick_queue`, `start_pick`, `order_status_for` | Nobody is told at confirmation; due, it goes to the pickers (waited 0 minutes, not days), then picked, offered, delivered, paid, closed, ledger at zero; "where is my order" answers the window |
| 2.8 (g) Stock | 0040: `reserve_stock` (0002) skips bought-to-order lines of a scheduled order; `reserve_due_lines` / `release_scheduled_order` reserve them when it comes due | Shelf goods reserved at the tap, fresh not; fresh not in yet: ops exception `scheduled_stock_short` once, nothing to the pickers; received, it goes and the exception closes |
| Card and replies | `order-card.ts`: `window` and `replaces` on the card, `formatWindowChoice` (a list of open windows, `slot:<slot>:<order>`, optional "now"), `parseWindowButton`, `windowLabel`; `buttonReplyText` for `slot_full`, `slot_closed`, `change_open`, `too_late`, `change_too_late`, a cancel with credit, and the window on confirmation | `scheduled-orders.test.ts`, last block |
| C2's request: lines that left the hub | 0042: `recall_orders` (0025) leaves out a failed delivery whose goods came back (it listed it "with the customer"; it already counted only `ok` lines); `rider_job` (0016) counts only `ok` lines | `test/db/left-the-hub.test.ts` (fails without 0042) |
| B3's request: voice on the ops line | `ops-turn.ts` calls `voiceOnOpsLine` for a rider's or staff member's note: the reply, and `OPS_VOICE_TEXT.opsAlert` to ops with the registered name (0043 `party_display_name`) | `test/db/ops-voice.test.ts`: rider and picker answered, ops told once, an over-long note gets the polite reply, a retried turn sends nothing twice, the order does not move |

How the pieces fit, for whoever builds next:
- **A scheduled order is an ordinary order with `delivery_slot_id`.** It sits in `confirmed` (or `awaiting_payment`) until `order_release_at` (window start minus `settings.scheduling.release_before_min`, 60). The cron's existing minute walk (`orders_waiting_for_rider` then `dispatchAndOffer`) releases it: its fresh lines are reserved, `released_at` is set, and from then on it is any other order (pickers, then the rider at pick start; with no picker on the ops line, the rider at release). `dispatchAndOffer` sends nothing for `scheduled` or `stock_short`; no TypeScript outside `order-card.ts` and the voice wiring changed.
- **Staging order of migrations.** On staging 0040-0043 apply after 0078 (`--include-all`); on a fresh reset they apply before 0045. None of the functions they redefine (`reserve_stock`, `handle_order_button`, `confirm_order_checked`, `dispatch_order`, `orders_waiting_for_rider`, `pick_queue`, `start_pick`, `order_status_for`, `recall_orders`, `rider_job`) is redefined by any migration after 0035, and none of B2's four (0052) or 0077's `quote_order` is touched, so both orders give the same database. Checked on a scratch Postgres 16: every migration applied by number, and again with 0040-0043 after 0078 as staging will; all functions (by definition) and all columns are identical, and `scripts/check_permissions.sh` passes on both. **Anyone redefining one of those ten: start from C3's text** (0040-0042).
- Slots are generated lazily by the functions that read them (no cron needed). A slot a person edited is never regenerated; a slot an order points to keeps its times.
- Settings (`scheduling`): `days_ahead` 7, `release_before_min` 60, `bought_to_order` `["fresh"]` (chilled and frozen are stocked and reserved at confirmation like shelf goods), `offer_max` 6. Plan defaults: order-by 120 minutes before the start, fresh 720.

Decisions taken in code, written down for the founder (each is a setting, a row or one line):
- Capacity is a number of orders per window, not items or minutes.
- A full or closed window at the tap sends the order back to draft and says so; it is never delivered "now" instead.
- The ops lead may move an order past a cut-off (with a reason) but not past capacity: raise the slot's capacity first, on purpose.
- A change to an order already paid by transfer goes to a person (`link_replacement_order` answers `paid`); cancelling it before the cut-off owes the payment back as credit.
- A day the calendar closes, or a plan whose times change, never cancels an order already promised: the slot stops taking orders and ops gets `scheduled_day_changed` to decide and tell the customers.
- Scheduled windows are for hub orders delivered to the door: not for pickup, not for restaurants (Phase 8).

Known limits, written down rather than hidden:
- **No customer can choose a window yet.** The customer turn (lane B) does not call any of this; the request is below. Everything is proven through the SQL and the card functions only.
- `quote_order` (0077, lane B) still refuses a fresh line that is out of stock now, and refuses while the hub is closed, also for a scheduled order. Until lane B changes it, a scheduled order needs its fresh goods in stock when the card is made, and a card cannot be made after hours.
- A scheduled order whose fresh goods never arrive waits (ops is reminded every ten minutes) until ops receives them, reschedules or cancels it. There is no "go without that line" action before picking; once picking starts the picker's missing flow covers it.
- The ops-line voice alert asks a person to listen in the ops number's inbox; the note is not copied to the `media` bucket (the customer line's notes are, 1.7).
- `settings.picking.offer_substitutes` is still off (B3 left it to the next hub session together with C2's picker tests; it was not in C3's row). D3's request to move the drawer check into the base `pay_supplier` / `pay_out_credit` (two fixture lines in `test/db/refunds.test.ts` and `receiving-margin.test.ts`) arrived while C3 ran and is also open.

Requests for other sessions (C3 did not touch these files):
- **Lane B (the next lane B session; K1 merged first), the customer side of 2.8**: (1) when the customer asks for a time, or the plan asks "when", call `open_delivery_windows(p_village, p_fresh)` and send `formatWindowChoice(orderId, windows, { withNow: true })` for the order on the card; (2) a row tap arrives as `interactive.list_reply` (the customer branch of `turn.ts` reads only `button_reply` today): `parseWindowButton`, then `request_delivery_window(order, slot, party)`; on `ok` send the card again with `window`; otherwise send its `windows`; (3) after `slot_full` or `slot_closed` the order is a draft: offer `r.windows`; (4) after `change_open`, the next basket becomes a new card: `create_order_from_quote`, then `link_replacement_order(new, old, party)`, then the card with `replaces` (on `paid`, hand to a person; on `too_late`, `buttonReplyText`); (5) a lane B overflow migration for `quote_order`: a scheduled order's bought-to-order lines need no stock now and the opening hours do not apply to it (K1's kept order, 0087, offers an after-hours basket at opening; a window is the other answer: send it for a chosen time); (6) `answers.ts`: `order_status_for` now returns `window` and no minutes left for a scheduled order: say the window; (7) an eval case for a time said in words («بكرا الصبح», "jumaa ba3d el dohr») before the extraction learns it.
- **Console (D3 or the next console session)**: pages for windows (rows of `delivery_window_plans`), the calendar (`delivery_calendar`; the triggers regenerate the slots), one slot (`edit_delivery_slot`) and the schedule (`delivery_schedule`); `reschedule_order(order, slot, 'ops', by, reason)` and `cancel_scheduled_order(order, 'ops', by, reason)`, then tell the customer (`customer_id` is returned). New exception kinds: `scheduled_stock_short` (detail: the lines not in) and `scheduled_day_changed` (detail: the slot and its orders).
- **Founder**: no windows or calendar dates exist anywhere yet, so scheduled orders are off until someone enters them: the windows and their capacity, the two cut-offs, and the Ramadan, Lent and holiday dates for 2027 (needed before February 2027).

### Session A4 (infra), 14 November 2026: audit items 1, 2, 3 (measure), 6, 8, 11; migrations 0090-0093
Built and tested locally: PGlite with every migration, `npx tsc --noEmit` clean, `npx vitest run` 931 passed, 40 skipped after rebasing on K1, P2 and C3 (the live-only and
real-Postgres suites; CI runs the real-Postgres ones). Each bug has its test first. "Live" below means after `deploy-staging` runs on main.
Migration 0094 was reserved and not used.

| Audit item | What changed | Tested | Live |
| --- | --- | --- | --- |
| 1. Hourly false alarm while closed | 0090: `probe_silent` only while open (`shop_open_now()`, hours past midnight handled) and only once open for three probe periods (`shop_opened_at()`). Conditions keep one ref while they last (`probe`, `customer_line`, `cron`), so one problem is one case, one ops message, one Sentry event. `clear_heartbeat_alarms()` resolves every heartbeat case no longer wrong (`detail.cleared_at`); other kinds stay with a person. `heartbeatAlerts()` calls it each minute | `test/db/alarms-a4.test.ts`; `heartbeat.test.ts` now sets open hours for its silence case | After deploy the 12 open hourly `heartbeat:probe_silent` cases on staging close on the first cron run in which the probe is not silent |
| 2. Sentry noise from deploys | The Worker's `/__sentry-test` and `scripts/ci/sentry-ingest-check.sh` send a cron check-in (monitors `deploy-smoke-staging`, `deploy-ingest-check-staging`, created on first use, yearly schedule) instead of an error. Same proof of DSN, transport and flush; no issue | `test/ci/sentry-smoke.test.ts` (fails if either sends an event again) | After the next deploy: the two monitors appear under Crons; issues ALO-KING-GATEWAY-1 and -2 get no new events |
| 3. Slow reply (measure) | 0091: views `agent_latency` (p50/p90/max per day, model, path) and `turn_waits` (webhook to turn start, the turn, the whole reply) | `test/db/latency-a4.test.ts` | Numbers below, read on staging 14 Nov with the same SQL |
| 6. Cost not recorded | 0092: `model_prices` (dated USD per million tokens: Haiku 5.5 0.10/0.50, above 100K input 0.50/2.50; Sonnet 5.5 2/10; checked 14 Nov), `agent_run_costs` (a run with no price is unpriced, never $0), `ai_cost_daily` (cost per order, probe apart) | `test/db/ai-cost-a4.test.ts` | After deploy: `select * from ai_cost_daily order by day desc` |
| 8. Templates in Arabic only | Six templates submitted to Meta through Kapso on 14 Nov, all PENDING: `ak_order_cancelled_en_v1` 1140802498307803, `ak_rider_at_door_en_v1` 1666280571821443, `ak_payment_received_en_v1` 3080758412302974, `ak_order_cancelled_fr_v1` 3028860460791723, `ak_rider_at_door_fr_v1` 1465972848934487, `ak_payment_received_fr_v1` 2393796074742173. 0093: `customer_language()` (the Concierge's last reading; en, fr, else Arabic) and `customer_notices_due()` picking that template and filling it in that language; `sendNotice()` sends the language code and the same words as free text until approval | `test/db/notice-languages-a4.test.ts` | Submission yes; approval no (Meta, about a day). The hourly sync reads their status like the Arabic three |
| 11. Queue retry path untested | `test/db/queue-retry-a4.test.ts` drives `queue()`: delivered once, never twice, refusals retried with the error kept, Sentry from the third attempt, one bad event does not hold a batch. **Bug found and fixed:** a failed database read was acked as "nothing to do" (the event then waited for the reconciler); only "no such row" acks now, and the error write is best effort | the test above | n/a (the queue is the fallback road) |

Also: `docs/RUNBOOK.md`, "Voice notes for the evaluation": the steps for Rasheed to upload the 51 notes to `media/voice_eval/shouf-51/`
(private bucket, staging, never the repository). V1 starts when the check query there answers 51.

**Item 3, the numbers (staging, 13-14 Nov, 30 Concierge turns, model `claude-haiku-5-5`).** `latency_ms` is the turn alone.
| Path | Turns | p50 | p90 | Mean output tokens |
| --- | --- | --- | --- | --- |
| `ask` (reading, then the open-question model loop: two or more calls) | 15 | 9.3 s | 13.0 s | 1,175 |
| `card` (one reading, the card from SQL) | 4 | 5.4 s | 6.4 s | 291 |
| `ask_pin` | 4 | 4.0 s | 4.1 s | 272 |
| `card_after_pin` (no model at all) | 4 | 2.1 s | 2.2 s | 0 |

What the customer waits for, a typed message (20 turns): webhook to turn start p50 **8.3 s** (p90 8.7 s), the turn p50 8.0 s, the whole
reply p50 **15.9 s**, p90 19.4 s, max 21.8 s. The founder's message of 14 Nov 05:00 UTC (07:00 Beirut, before opening) was stored at
05:00:15.0, its turn started 8.4 s later, took 13.4 s on the `ask` path, and ended at 05:00:36.8: 21.8 s in all. Where the time goes:
1. **The burst buffer, 6 s on every text** (`BUFFER_SECONDS`), plus about 2.3 s of database calls before the turn's clock starts
   (`begin_turn`, `touch_conversation`, first contact, the `wa_messages` insert). The biggest fixed cost, and the target (most typed
   orders within 10 s) cannot be met while it is 6 s.
2. **The `ask` path**: a second model call and about four times the output tokens of the card path. Haiku 5.5 thinks adaptively by
   default (effort medium), so those tokens include its thinking. There is no thinking budget in the code: B3 raised `max_tokens`
   to 4096 on the reading (a ceiling, not a cost). The closed-shop answer goes this way (K1 is changing that path).
3. **About 2 s of round trips inside a turn even with no model** (`card_after_pin`): the Worker to Supabase in eu-central-1.

For lane B (requests, not done here): shorten the buffer for a single text, or end the burst early when the message reads complete;
try `output_config: { effort: "low" }` on the reading behind the evals; fold the pre-turn calls into one function; record per-call
timings and `usage.cache_read_input_tokens` in `agent_runs.trace`, so `agent_latency` can split the turn and `agent_run_costs` can
price cached input (today cached input is priced as input: an upper bound).

**Item 6, the first figure.** The probe's orders cost about **$0.0018 of AI each** (25 runs, $0.0145, 8 orders, 13-14 Nov; an upper
bound, see above), against $0.012 in `docs/COST_MODEL.md`. Correcting the cost model is 4.11 (A3); the figure is `ai_cost_daily.real_usd_per_order` once real orders exist.

Files outside the row, each minimal: `apps/gateway/src/worker.ts` (the smoke route, item 2), `scripts/ci/sentry-ingest-check.sh`
(item 2), one line each in `test/db/heartbeat.test.ts` and `test/db/customer-notices.test.ts` (their expectations moved with 0090
and 0093), `docs/RUNBOOK.md` (asked for), new tests in `test/db/` and `test/ci/`. `TEST_REPORT.txt` was not regenerated: K1, C3 and D3
run beside A4 and would conflict on it.

For other sessions:
- Anyone touching `heartbeat_alerts()` or `customer_notices_due()`: start from 0090 and 0093. A new heartbeat condition needs a stable
  ref (not the hour), or `clear_heartbeat_alarms()` closes it the next minute.
- `shop_open_now()` is shared: K1 defined it (0087), 0090 redefines it identically for ordinary hours and adds hours past midnight.
  Start from 0090 if you change it; `heartbeat_alerts()` and `kept_orders_due()` both read it.
- K1, C3, D3: `TEST_DEPS.db` now also reaches the webhook and queue's database client (tests only).
- A3 (4.11): read `ai_cost_daily`. When a model or price changes, add a row to `model_prices`; never edit a row.

### Session S1 (audit, research and system plan), 14 November 2026: documents only
Fable 5.2. No product code, no migration, no deploy, no message. Branch `s1-audit-system-plan`.

| Part | Where | State |
| --- | --- | --- |
| The founder's brief, unchanged | `docs/SYSTEM_BRIEF.md` | Committed first (converted from the Word file to Markdown; its one diagram is not in the repository) |
| Status of every capability; the G1 attack audit | `docs/AUDIT-G1.md` | Done. 25 findings, 4 high: G1-01 to G1-04 (money). Nothing fixed here |
| Targeted research | `docs/RESEARCH_REGISTER.md` | Partial: 11 searches of the 25 allowed; eight items listed for session R4 |
| System plan, website, console | `docs/SYSTEM_PLAN.md`, `docs/WEBSITE.md`, `docs/CONSOLE.md` | Done |
| Cost model | `docs/COST_MODEL.md`, `data/cost_model.csv` | Done; the sheet recalculates in a spreadsheet; most inputs are still placeholders |
| Decisions, conflict register | `docs/DECISIONS.md` | 11 conflicts recorded, none resolved |
| Gap matrix, classes, sessions | `docs/BUILD_PLAN.md` "S1 revision" | Done |
| Prompts | `docs/NEXT_SESSIONS.md` | Full prompts for the 19 sessions in run order and for PAY1 and E1; the far-gated sessions (LOY1, MK1, BK1, AN1b, D4b, PAY2, WEB3) have a plan section, not a prompt |

Checks run by S1 on `471d99e`: `npm run typecheck` clean; `npm test` 930 passed, 40 skipped, **1 failed**
(`apps/console/test/sign-in.test.ts:152`, the action log's order inside one millisecond; it passed alone; finding G1-16, session D4).
Staging read with read-only queries on 14 Nov about 12:30 UTC: 70 migrations, 14 closed orders, ledger at zero, no open exception,
marketing off, no client grants, templates 3 approved and 6 pending, research-load has run (20 pictures and 470 facts proposed, none approved).

**Start now, together:** SP1 (reply speed), F1 (G1 fixes), D4 (console review pages). Migration numbers from 0100 are reserved per
session in the build plan.

**Blocked or not done, recorded:**
- Research: the items under "Not checked in this session" in the register (Whish Pay's own documentation, gateway onboarding
  terms, Meta's current policy text, Kapso's terms, plan limits, Open Food Facts licence duties, map tiles). Session R4.
- Web checkout confirming on the page, vendor-operated delivery, the founder assistant, automatic approval, the console
  redesign: each waits for the founder's answer to its row in the conflict register (C1, C2, C3, C6, C8). The sessions build
  the "until then" behaviour written there.
- The Meta message rate for Lebanon: published rate cards disagree (0.0091 or 0.0105 USD); the first bill decides.
- The founder's phone retest of 0.13 is not recorded anywhere as done.

### Session SP1 (reply speed), 14 November 2026: A4's three causes, G1-19, G1-21, audit point 10; migrations 0100-0102
Opus 5.5, ordering lane, branch `claude/modest-babbage-mikayo`, PR rashidhamzy-hue/alo-king#43. Each change has its failing test first
(`test/db/reply-speed-sp1.test.ts`, 17 cases; `evals/test/ask-by-code.test.ts`), except the per-call trace, whose test was written
just after the code (it fails on the code before SP1: no `output_config`, no `trace.calls`). Locally: `npx tsc --noEmit` clean,
`npx vitest run` 950 passed, 43 skipped, 0 failed (the workerd + real Postgres e2e included).

| Item | What changed | Tested |
| --- | --- | --- |
| 1. Burst buffer | `settings.burst` (0100): `quiet_ms` 1200, `max_ms` 4000, `media_ms` 6000. A text starts its turn after 1.2 s of quiet; each new text extends the wait, never past 4 s from the burst's first message; a burst with a voice note or a picture waits 6 s from its last message; buttons, pins and the ops line stay instant. The conversation object reads the setting at most once a minute (1 s timeout, the defaults behind it) and counts the wait from arrival, so the read adds nothing. `BUFFER_SECONDS` is now only the fallback for `media_ms` | one text is due within 1.5 s; three texts one second apart are one reading; four texts cap at 4 s; a new burst after a turn; voice 6 s, button instant |
| 2. Pre-turn calls | `open_turn()` (0100): `begin_turn`, `touch_conversation`, `record_first_contact`, the `wa_messages` insert, in that order, then `model_turn_budget` and `customer_context`. It calls the latest definitions unchanged. One stricter rule: a failed `begin_turn` now fails the turn (the conversation object retries) instead of being ignored. The ops line still calls `begin_turn` | a typed order reaches the model after exactly one database call (`open_turn`); the four effects; a retry stores no message twice; done, blocked and unknown-ops cases |
| 3. Ask path | The reading runs at `output_config: { effort: "low" }` (`READING_EFFORT` in `concierge.ts`), behind the language-pack gate (below). The 17 staging `ask` runs (13-14 Nov) are listed in `evals/cases/ask_by_code.json`: 13 are code paths since B4 and K1 (closed hours, the village in the text, the address after the pin), one more is code now (14 Nov 06:13, «مشيلي الطلب»: go ahead with the basket kept overnight, read as an order with no lines and handed to a person; `isGoAhead` / `goAhead` in `pipeline.ts` carry a kept basket or a card waiting on a phone number with no second call), and 3 still need the model's words (a line not found, a line ambiguous, a failed reading). `agent_runs.trace` now holds `calls` (kind, ms, tokens, cache read and write per call) and the turn's cache tokens; `agent_run_costs` prices cached input (0102, new dated price rows with `cache_write_usd_per_mtok`; before, cached input was not counted at all); view `agent_call_timings` | the go-ahead card after one reading; the same words with nothing waiting still reach the Concierge; effort low on the reading; the trace; the cost of cached tokens; the eval cases (live: `evals/live`) |
| 4. G1-19, G1-21 | Customer messages are keyed by turn plus a SHA-256 of the message (and a count when a turn says the same thing twice), not by position. `create_order_for_turn()` (0101, `orders.turn_key`) returns the draft a retried turn already made when the basket, place (a pin saved again with the same coordinates counts), terms and price are the same; anything else goes to `create_order_from_quote()` unchanged | a retry whose model chooses a card where the first attempt asked a question sends the card (before: dropped); a retried card turn leaves one order and one card; a different basket still withdraws the old card; the e2e crash case now asserts one order and no cancelled draft |
| 5. No escalation | Recorded in `packages/agents/src/concierge.ts`: `MODEL_SMART` is configured and never used at run time (it refuses the forced tool choice the reading needs); a failed reading goes to the question loop on the same model or to a person. No second model on the hot path | n/a |

Files outside the row, each minimal: `packages/agents/src/concierge-tools.ts` (`ToolContext.turnKey`; `issueCard` calls
`create_order_for_turn`), `test/db/concierge-flow.test.ts` (the buffer expectation), `test/db/ai-cost-a4.test.ts` (prices are now
dated rows), `test/pg/worker-e2e.test.ts` (G1-21 now asserted), `evals/language/request.json`. Nothing in `packages/wa`, the
console or a money function changed.

**Language-pack gate (effort low):** passed. Run 43603124462 (`language-pack-out/43603124462`), 990 cases, repeat 1, `claude-haiku-5-5`:
| | item F1 | precision | recall | wrong products | missed | demo 0013 | output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before (main, default effort medium) | 0.914 | 0.998 | 0.842 | 2 (hz0815, g0815: «bazella w jazar mkhalta» also read as peas) | 195 | right | 163,516 |
| after (SP1, effort low) | 0.912 | 1.000 | 0.838 | **0** | 200 | right | 160,668 |
Effort low keeps the gate (F1 at least 0.90, zero wrong, the demo right) but saves only 1.7% of the reading's output tokens: the
reading's output is mostly the JSON itself, not thinking. It stays low (no loss measured); it is not where the time goes. Live evals
(`evals/live`, run 43603124462 then 43604651185 after the fix below): wording, off-topic and address cases pass, and the go-ahead
cases pass. **Language bug found by the live run and fixed, eval first:** «لغيلي الطلب» ("cancel my order") was read as an order
with no lines, which the new go-ahead path would have turned into the kept basket's card. `isGoAhead` now refuses when the
customer's own words cancel or refuse (`CANCEL_WORDS`); case `ask-go-ahead-not-cancel` and the word tests in
`evals/test/ask-by-code.test.ts`. The prompt was not changed. In the second live run `siyami-first-time` (the question loop,
unchanged by SP1) had its first wording refused by the output guard («الأكل الصيامي») and its rewording sent; it passed in the
first run: model variance, recorded, not a gate item.

**Staging (turn_waits, typed messages):** STAGING_RESULT

For other sessions:
- W1 and anyone issuing a card: call `create_order_for_turn` with the turn key (`ctx.turnKey`), not `create_order_from_quote`.
- Anyone sending to a customer from a turn: keys come from `replyKey(turnKey, contentHash(msg), n)` in `turn.ts`; never a position.
- A4's numbers before SP1 were read with the same views; `agent_call_timings` now splits a turn into its model calls.

### Session D4 (console review pages), 14 November 2026: names, readiness, windows, fact basis, the action log; migrations 0110-0114
Sonnet 5.5. Branch `claude/loving-mayer-r7yz4z` (the branch this environment allows). Built and tested locally, through the console's real request handler against PGlite with every migration (D1's rig): `npm run typecheck && npm test`, 965 passed, 40 live-only skipped, plus the new console tests (names 9, readiness 5, windows 10, facts-basis 7, sign-in 19). D1's rules kept: the console has no insert, update or delete (`no-direct-writes.test.ts` passes unchanged), the acting party comes from the session, every action is logged first, plain server-rendered pages. **Nothing here is proven live**: the migrations reach staging with `deploy-staging` after the merge, and the console workflow's smoke sweep then opens the three new pages (it reports, it does not fail, a page that cannot load yet).

| Part | Where | Writes through (SQL) | Tested by (`apps/console/test/`) |
| --- | --- | --- | --- |
| 1. Names review (`/names`, ops lead and admin) | `pages/names.ts`; migration 0110: `product_name_proposals` with the 282 of `data/proposals/names.json` loaded (`apps/console/scripts/names-insert.mjs` prints the INSERT), `review_product_name()` | approve, correct or reject one proposal; approving writes the product's name, which queues its search words again (0076's trigger); rejecting an approved one puts the earlier name back | `names.test.ts`: the 282 load and no product changes until a person decides; current and proposed side by side with a progress counter; a double tap, and two taps at the same instant, decide once; a correction is applied in one step and may not add a praise, health, diet or religion word; undo is refused over a name changed since; an item missing from the catalog is refused plainly; pickers refused by the page and by the database |
| 2. Product readiness (`/readiness`) | `pages/readiness.ts`; migration 0111: `product_readiness(p_product default null)` | reads only | `readiness.test.ts`: one answer per active hub item; no approved picture blocks the catalog and not ordering; no price blocks both; unavailable blocks ordering; each part taken away from a ready item says which; each missing part links to the page that fixes it |
| 3. Windows and calendar (`/windows`) | `pages/windows.ts`; migration 0112: `save_window_plan`, `save_calendar_entry`, `remove_calendar_entry` (C3's `edit_delivery_slot`, `delivery_schedule`, `reschedule_order`, `cancel_scheduled_order` are used as they are) | plans, calendar dates, one slot, an order moved or cancelled with a reason | `windows.test.ts`: **a window entered on the page is returned by `open_delivery_windows`**; a changed capacity reaches the slots; a closed calendar day has no windows and removing it brings them back; one slot's edit survives a plan change; a move needs a reason and never goes past capacity; the customer is told only if the person writes a message, once, from the customer number, and a closed 24-hour window or a failing send is reported, never hidden; pickers refused by the page and by the database |
| 4. The basis of every fact proposal, and "the label wins" (`/food-facts/:id`, `/intake/:id`) | `basis.ts`, `pages/foodfacts.ts`, `pages/intake.ts`; migration 0114: `fact_agree`, `label_reading_of`, `fact_basis_conflicts`, and `review_proposed_fact` (0049's text plus one rule) | the same functions as before | `facts-basis.test.ts`: the words for each source ("inferred from the ingredient list on Open Food Facts, not printed on the pack", "from a web page for the Gulf market, quoted from the page; not printed on our pack, and a recipe sold in another market may differ from the Lebanese one"); a disagreement is flagged on both pages; the web row can only be set aside and the database refuses to confirm it (`LABEL_DISAGREES`); what agrees can still be confirmed; a database without 0114 shows the pages with nothing flagged |
| 5. `staff_actions` | migration 0113; `app.ts` `audit()`; `test/kit.ts` | `log_staff_action()` is the only writer | `sign-in.test.ts` (G1-16): intent before done by sequence, not by clock, eight actions in the same instant keep their order; the table refuses update, delete and truncate; a party that is not staff cannot have an action entry; a refused sign-in has no party and the password is never in it; log first or nothing; a database without 0113 still gets its log in the bucket |

Decisions taken in code, written down (each is one line to change):
- **An approved name carries its size after it**: "Tanmia Fresh Chicken Filet" + "500 g" is saved as "Tanmia Fresh Chicken Filet 500 g", with the proposal's own spelling of the size. Every customer surface, the planner (0078 reads sizes from the name) and the search words read the name; `products` has no size column, and adding one without changing those readers would drop the size from customers' view. The size stays separate in `product_name_proposals`. A proposal with no Arabic name leaves the product's Arabic as it is.
- **The nine items 5.18 refused have no proposal** and keep their names. Arabic names written by a model are marked on the page: the checks cannot tell a wrong word from a right one, a reader of Arabic decides.
- **Readiness**: *blocks the catalog* = no approved picture a customer may see, not placed in a category, or no price at the hub (what `catalog_feed()` leaves out); *blocks ordering* = no price at the hub, or marked unavailable; *missing* (never stops a sale) = a name waiting for a person, food facts (the ingredient list and all 14 allergens answered from the pack), cost, search words. A held (recalled) item is inactive and is not listed.
- **No window, day or number is written in code**: the windows page has no default time, capacity or holiday. Until a person enters windows the page says scheduled orders are off.
- **Telling the customer** after a move or cancel is optional and is the person's own text (no copy is written by the console; M1 owns message design). It goes out through the gateway on the customer line with a stable key, only inside WhatsApp's 24-hour window; otherwise the page says the customer was not told. The action log keeps the message's length, never its words.
- **Label beats web**: compared are allergen and diet values; nutrition numbers more than 10% apart (0.5 for small figures); ingredient lists only when both sides state the same language. A label reading is the person's approved fact from the pack, or the label reader's proposal still waiting. `review_proposed_fact` is now 0114's text: anyone redefining it starts there.
- **The action log is a table**; the bucket path (`console_audit/...`) remains only as a fallback while a database lacks 0113 (staging can lag the Worker), so "log first or nothing" holds either way. `kit.ts` keeps `media.audit()` as a mirror for the older tests; `Rig.actions()` reads the table.
- Checks: `npm run typecheck && npm test` (965 passed, 40 live-only skipped; the `test/pg` suites applied every migration, 0110-0114 included, by psql on Postgres 16) and `scripts/check_permissions.sh` on a scratch Postgres 16 (passes: no new table or function is reachable by `anon`, `authenticated` or PUBLIC).
- Migration order: 0110 before 0111 (readiness reads the name proposals). On staging they apply after 0093 (`--include-all`).

Not done, and why:
- **Keyboard and swipe on the names page** (CONSOLE.md): that is the cockpit shell (D5); the page works with taps.
- **No page changes a catalog placement**: `catalog_placements` has no editing function (K1, 0085), so readiness says "not placed" without a link. A function and a form are one small task for a catalog session.
- **Pictures page** (CONSOLE.md "extend": the vision check's reasons) was not in D4's row.
- Not proven live: the actions (as for every console page), the three new pages against the real staging data, and the 282 names loading on staging (0110 inserts by SKU; if the catalog is seeded after it on a fresh reset the table is empty, as for the language pack; `ITEM_NOT_IN_CATALOG` is the page's answer to a proposal whose item is missing).
- A founder step remains for scheduled orders: enter the windows and the Ramadan, Lent and holiday dates for 2027 on `/windows` (needed before February 2027).

### B. Built, not covered end to end (written and type-checked; no test drives them)
- Deliverect adapter: shape only. Needs a partner account.
- Market tables (`markets`, `market_settings`, `setting_for`): schema only. Functions still read global settings.

### C. Still to build
See `docs/BUILD_PLAN.md`: Phases 0 to 7 lead to a paid grocery pilot; Phase 8 is restaurants; Phase 9 is the website and diaspora
orders; later items (nutrition calculation, advertising, forecasting) each have a trigger. Scheduled orders (2.8) are built in the database and the card (C3); the customer cannot choose a window until lane B wires it.
The console exists (D1, D2, above). D1's proposed functions are migration 0045. The 1.23 review-list page can be built: B4 merged its functions (`search_word_reviews_open`, `resolve_search_word_review`).
Ordering lane: B1, B2, B3 and B4 are done (above). 0.13: retry after B4's deploy (the flow now asks the pin, then house and floor, then sends the card). 1.22's zero-wrong gate is met on the replay of live readings (B4). K1 is done (above): the leftovers, audit items 4 and 5, and 1.21 in code; the catalog waits on Rasheed's Meta steps (RUNBOOK) and on approved pictures.
Hub lane: C1, C2 and C3 are done (above). Console lane: D1 and D2 are done (above).
Use its task numbers (0.1, 1.2, ...) for branches and pull requests.

### D. Needs a live account or real conditions (cannot be finished in code alone)
- Kapso: real webhook payloads captured by our own Worker (A2 built fixtures from real message objects and Kapso's documented envelope), typing indicator.
- Meta: approval of the nine submitted utility templates (three Arabic, A2, 4.3; three English and three French, A4); the rates on the first bill (4.4). Which messages are billed is now recorded per message from Meta's status webhooks (4.12).
- Supabase: staging project `alo-king-staging` (`lhgkvvdckwbfpdsftzqp`, eu-central-1) exists and was empty on 13 Nov; `deploy-staging` fills it (section F). Still to do: turn on point-in-time recovery before real money (paid plan), and a production project.
- Cloudflare: deploy and the one-minute cron trigger are in place (section F); the hourly probe order proves the cron and the Durable Object alarms doing real work on staging (A2). Still to prove: load, queue retry.
- Speed: time from message to card, measured on a phone in Chouf. The server side is measured (A4, `turn_waits`): typed text p50 15.9 s on staging, 14 Nov.
- Speech: accuracy on the hand-corrected voice notes.
- A shadow run: staff place real orders end to end, and stock, rider cash, rider earnings and the ledger reconcile to zero
  unexplained balance at day close.

### F. Phase 0, session A1, 13 November 2026
Everything that touches Supabase, Cloudflare or Kapso runs from GitHub Actions, because the build environment cannot reach them. "Proven live" means a named run on GitHub.
`deploy-staging.yml` runs on `main` after `ci` passes, and by hand; `staging-drill.yml` and `capture-kapso-fixtures.yml` are by hand. Staging Worker: `https://alo-king-gateway-staging.rashid-hamzy.workers.dev`.

**How the first live runs went (all on `main`; none of this was visible before running on the real accounts).**
| Run | Result | What it taught |
| --- | --- | --- |
| 1 `43391997973` | failed in the database job | Supabase CLI 3.x: `db push` defaults to a local stack; the linked project needs `--remote`. |
| 2 `43392782206` | failed at the permission check | On real Supabase 31 `pg_trgm` functions in `public` are callable by PUBLIC (see 0.4). The check now separates extension functions (warn) from ours (fail). |
| 3 `43393749615` | failed before any step | `supabase/setup-cli` could not resolve `latest` (GitHub API rate limit). The CLI is now pinned. |
| 4 `43394134487` | **passed, both jobs** | First full deploy (on B1's merge). |
| 5 `43395020393` | failed in the database job | My own mistake: I pinned the CLI to 2.122.1 after looking only at v2 tags; `latest` was v3.1.0. Pinned to **3.1.0**. |
| 6 `43395887837` | failed at Queues | Cloudflare answers "already taken [code: 11009]" for an existing queue; my script only knew "already exists", so every second deploy failed. Fixed and tested with a stub. |
| 7 `43396822066` | **passed, both jobs, on a repeat deploy** | The deploy is idempotent: seeds skipped, bucket found, queues found, webhooks left alone. |
| drill `43394402493` | **passed** | Rollback, redeploy, secret rotation (see 0.11). |

Checked independently with read-only connector queries after run 4 and again after run 7: 17 migrations applied (0001 to 0017, including B1's), 291 products and 291 stock rows, 42 villages, the `media` bucket is private, marketing is `{"enabled": false}`,
both Kapso webhooks exist and are active on the right numbers and routes, and the database holds zero table grants to `anon`/`authenticated` and zero of our functions open to PUBLIC.

| Task | Proven live | Notes |
| --- | --- | --- |
| 0.3 Supabase staging, migrations, seeds, private `media` bucket | **Yes** (runs 4, 7) | Seeds: catalog, aliases, villages, travel times. `proposed_pilot_settings.sql` is NOT loaded: it waits for the founder's yes. Latency to Lebanon is not measured here (measure on a phone in Chouf, task 4.x). |
| 0.4 Permission check on Supabase | **Yes** (runs 4, 7) | Runs with `EXISTING=1`, changes nothing. Findings: (1) `ops_exceptions` had table grants for `anon`/`authenticated` (RLS blocked every row): fixed by B1's migration 0017, confirmed live. (2) **`pg_trgm` is installed in `public`; its 31 functions are callable by PUBLIC**, hence by `anon` and `authenticated`. Pure helpers owned by `supabase_admin`, so a migration cannot revoke them. Fix: a migration that moves the extension to the `extensions` schema. **Fixed by C1's migration 0020** (probed on staging in a rolled-back transaction; applied by `deploy-staging` after merge); the check now fails if any extension function is in `public` or callable by a client role. |
| 0.5 Cloudflare Worker, queues, secrets, cron | **Yes** (runs 4, 7) | Queues `ak-inbound-staging` and `-dlq` were created with no paid-plan error. That does not show which Cloudflare plan the account is on, and Workers Paid is not assumed. Deployed: bundle 3,169 KiB (588 KiB gzipped), startup 32 ms, cron `* * * * *`, six Worker secrets. **Not proven:** the cron doing real work, Durable Object alarms and queue retry under load, free-plan CPU limits against a real turn. `STT_API_KEY` is not set (Kapso's transcript first, 1.7). |
| 0.6 Kapso webhooks | **Yes** for the webhooks, **No** for fixtures | Webhooks exist for both lines, each with its own secret generated in the workflow; a signed test event was accepted on each (signature check and Supabase write). The Kapso sandbox accepted a webhook for the ops line. **No real payload is saved**: that needs real messages on the staging numbers, then the `capture-kapso-fixtures` workflow. |
| 0.7 Anthropic key | **Yes** for the key and both model ids | `claude-haiku-5-5` and `claude-sonnet-5-5` answered. **Manual, console only:** set the monthly spend limit on the staging key; no call from here can see or set it. Use a separate key for production. |
| 0.8 Error tracking | **Yes** (A2, deploy run `43409985942`) | The earlier events were dropped by Sentry: the DSN belonged to another organization whose error quota was used up (rate_limited, error_usage_exceeded). A2 moved staging to project `alo-king-gateway` in the **Alo King** organization (EU). Live on 13 Nov: issue ALO-KING-GATEWAY-1 (the ingest check) and ALO-KING-GATEWAY-2 (the Worker's smoke error) are stored; the cron monitor `gateway-cron-staging` checks in every minute (status ok); the alert rule "Gateway: every new issue" emails the organization. Errors the gateway catches and retries now reach Sentry too (A2, 4.10). |
| 0.9 Meta ownership | **Blocked** | Section E. |
| 0.10 Builder tools | n/a (done) | `docs/TOOLS.md`, last section. Kapso plugin deliberately not installed. |
| 0.11 Deploy and recovery proven | **Yes** | Deploy (runs 4, 7), rollback and secret rotation (drill). `docs/RUNBOOK.md` "Proven on staging" names each. |
| 0.12 Meta billing guard | **Blocked** | Section E. |

**Things the live runs showed that the plan did not know.**
- **Rolling back across a secret change reverts the secret set.** The drill rolled back one version; that version was created in the middle of the webhook step, so it had the customer signing secret but not yet the ops one. After a rollback, check `wrangler secret list` and run `deploy-staging` with "rotate" ticked if a secret is missing.
- **The Kapso connector returns webhook signing secrets in plain text** to anything with read access to the project. They were seen once by the build session, then replaced by the drill's rotation. Anything with Kapso read scope can read them: this matters for the decision in `docs/TOOLS.md` about the Kapso plugin and key scopes.
- The Supabase CLI is pinned (3.1.0). Bump it on purpose and re-run the deploy; `latest` failed once on a rate limit and v2 and v3 differ on `db push`.

**Staging ops line.** The Kapso sandbox number (`597907523413541`) is wired as the ops line, and a webhook for it was accepted. Kapso documents that the sandbox can send interactive messages (buttons) but not templates,
and only to one registered phone. Buttons are therefore not a blocker, and **a second test number is not needed for the 0.13 demo on one phone** (the customer line and the sandbox are different
business numbers). It **is** needed before: two riders at once, a rider and an ops lead on different phones, or testing the approved templates of task 4.3 on the ops line.
Sending a button from the sandbox is not proven live: it needs a registered phone (6-character code sent to the sandbox number) and is part of 0.13. The sandbox bills service messages to Kapso credits (0.12, step 4).

**Kapso leftovers.** Two functions remain in the Kapso project (`whatsapp-flow-...-data-...`). Kapso refused to delete them: each is still referenced by a WhatsApp Flow data endpoint.
They go when those two Flows or their data endpoints are removed in the Kapso dashboard (WhatsApp, Flows). They do nothing and are not connected to the Worker.

**Connectors.** The Supabase, Cloudflare and Kapso connectors available to build sessions are write-capable and account-wide (`docs/TOOLS.md`). This session used them to read and verify only.

### E. Meta account steps (cannot be done from code; written by session A1, 13 November 2026)

#### 0.9 Meta ownership and verification: status BLOCKED on the Meta Business Portfolio admin
What Kapso shows (read 13 Nov): WhatsApp Business Account `1086076707594153`, number **+1 203 660 2328**, display name "Alo King" (approved without review),
phone_number_id `1378974041965966`, status CONNECTED, quality rating UNKNOWN (no traffic yet), messaging limit TIER_250 (250 customers a day),
WABA review APPROVED, not an official business account. What Kapso cannot show: which Meta business portfolio owns the WABA, and whether the business is verified.
The person who is an admin of the Meta business portfolio does these, in order:
1. Open business.facebook.com, Business settings, Accounts, WhatsApp accounts, select `1086076707594153`. Read **Owned by**. It must be Alo King's own portfolio
   (the one in the company's legal name). If it names anyone else (Kapso, a personal portfolio, an earlier attempt), the number does not survive a change of provider:
   write that name in the pull request or an issue and do not start verification yet. Ownership is fixed first.
2. Business settings, Business info: legal name, address, phone, website and email exactly as they appear on the company documents.
3. Security Center, Business verification, Start verification. Have ready: the company registration certificate or commercial register extract, a document that
   proves the address (bank statement or utility bill in the company name), and the business phone or email on the same domain as the website. Submit. Record the date submitted and the status Meta shows.
4. Business settings, People: at least two admins with full control, two-factor authentication on for both. Business settings, Partners: Kapso is listed with access to the WABA; leave it.
5. Click-to-WhatsApp data: Kapso documents that the ad `referral` (source id, ad click id, headline) arrives inside the `whatsapp.message.received` payload when present.
   Proof needs one real click on an ad that opens a chat with +1 203 660 2328 (a test ad from Alo King's ad account, small budget, ended after one click).
   Afterwards: Kapso dashboard, WhatsApp, Data, Ads (CTWA) shows the click; run the `capture-kapso-fixtures` workflow; the saved payload must contain a `referral` object.
   If it does not, task 1.13 cannot be built as written: say so in the pull request.
Done when: step 1 names Alo King's portfolio, verification is submitted (date written here), and one payload with `referral` is saved under `test/fixtures/kapso/`.

#### 0.12 Meta billing guard: status BLOCKED on the billing owner
Since 1 October 2026 replies are billed after 1,000 free a month per number, and an account with nothing to charge stops sending when the allowance runs out.
Two ways to pay, chosen per WhatsApp Business Account and hard to change later (switching from Kapso credits to a Meta card means a new WABA and a number migration):
- **Kapso credits.** Kapso pays Meta and charges the project's credits at Meta's published USD price. You can connect with a zero balance, but once the balance is at or below zero
  Kapso pauses sends on every number in the account (reason `service_credits_exhausted`; the send API answers HTTP 402).
- **Pay Meta directly.** A card in Meta Billing Hub for the WABA. Meta controls the rules if a payment fails.
Steps, by whoever holds the billing login:
1. Kapso dashboard, project settings, the WhatsApp billing card: read which mode WABA `1086076707594153` is in and, if it is not USD, the FX margin shown. If a payment source is already attached, say which in the pull request and stop.
2. If it is **Kapso credits**: add credits. At about USD 0.07 to 0.09 of Meta fees per order (`docs/COST_MODEL.md`), USD 50 covers many times over the 100+ shadow-run orders. Write the date and amount here.
3. If it is **direct**: business.facebook.com, Billing Hub (Payments), Payment methods, add a card to WhatsApp account `1086076707594153`. Write the date and the last four digits here, never the whole number.
4. **The staging ops line uses Kapso credits whichever mode the customer line is in.** Kapso bills service messages sent from its sandbox number to the project's credits, at the recipient market's rate,
   and rejects them with HTTP 402 when the balance is too low. So even with direct billing, put a few dollars of credits on the project, or the staging ops line cannot send.
Done when: a payment source is attached to the WABA (step 2 or 3) and the project holds some credits (step 4), both with dates written here. Real traffic does not start before this is done.

## The AI architecture, stated once
One conversational agent, the Concierge. Around it: narrow AI functions (vision extraction for labels, menus and receipts;
speech-to-text; later, optional summaries) and deterministic services in SQL and TypeScript (stock, dispatch, cash, settlement,
refunds, ranking, timers, alerts). "Ops Copilot", "Business Analyst" and "Food Intelligence" are names for functions and reports,
not agents. A new agent is added only when a measured job cannot be done by the Concierge, a function or code.

## The milestone that matters
A real customer sends a Lebanese WhatsApp order, gets the right card, confirms, receives the right goods, pays, and
inventory, rider cash, rider earnings and the company ledger all reconcile. Everything in C and D is ordered toward that.

## Cost model
`docs/COST_MODEL.md`. With riders on fees and tips, Alo King's income is grocery margin and contracted commission only.
Rider earnings per hour is the number to watch.
