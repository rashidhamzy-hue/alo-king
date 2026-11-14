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
npx vitest run          # 851 tests (40 live-only skipped); apps/console/test/* drive the console's pages; test/db/* run the real migrations in PGlite;
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

### B. Built, not covered end to end (written and type-checked; no test drives them)
- The queue retry path (`queue()` in `index.ts`): the webhook path and `scheduled()` are now driven end to end in workerd (A2, 4.5); a hand-off failure that falls to the queue is not.
- Deliverect adapter: shape only. Needs a partner account.
- Market tables (`markets`, `market_settings`, `setting_for`): schema only. Functions still read global settings.

### C. Still to build
See `docs/BUILD_PLAN.md`: Phases 0 to 7 lead to a paid grocery pilot; Phase 8 is restaurants; Phase 9 is the website and diaspora
orders; later items (nutrition calculation, advertising, forecasting) each have a trigger. Not built at all today: scheduled orders.
The console exists (D1, D2, above). D1's proposed functions are migration 0045. The 1.23 review-list page can be built: B4 merged its functions (`search_word_reviews_open`, `resolve_search_word_review`).
Ordering lane: B1, B2, B3 and B4 are done (above). 0.13: retry after B4's deploy (the flow now asks the pin, then house and floor, then sends the card). 1.22's zero-wrong gate is met on the replay of live readings (B4). K1 is done (above): the leftovers, audit items 4 and 5, and 1.21 in code; the catalog waits on Rasheed's Meta steps (RUNBOOK) and on approved pictures.
Hub lane: C1 and C2 are done (above); C3 (2.8) can start (B2 and C2 are merged). Console lane: D1 and D2 are done (above).
Use its task numbers (0.1, 1.2, ...) for branches and pull requests.

### D. Needs a live account or real conditions (cannot be finished in code alone)
- Kapso: real webhook payloads captured by our own Worker (A2 built fixtures from real message objects and Kapso's documented envelope), typing indicator.
- Meta: approval of the three submitted utility templates (A2, 4.3); the rates on the first bill (4.4). Which messages are billed is now recorded per message from Meta's status webhooks (4.12).
- Supabase: staging project `alo-king-staging` (`lhgkvvdckwbfpdsftzqp`, eu-central-1) exists and was empty on 13 Nov; `deploy-staging` fills it (section F). Still to do: turn on point-in-time recovery before real money (paid plan), and a production project.
- Cloudflare: deploy and the one-minute cron trigger are in place (section F); the hourly probe order proves the cron and the Durable Object alarms doing real work on staging (A2). Still to prove: load, queue retry.
- Speed: time from message to card, measured on a phone in Chouf.
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
