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
npx vitest run          # 365 tests (32 live-only skipped); test/db/* run the real migrations in PGlite
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
Nothing here is proven live yet: `deploy-staging` applies 0020-0025 to staging after the merge; its result is recorded at the end of this section.

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
- Live: not yet run. (Updated after the merge with the `deploy-staging` result.)

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

### B. Built, not covered end to end (written and type-checked; no test drives them)
- `scheduled()` in `apps/gateway/src/index.ts`: the SQL it calls is tested, the handler is not.
- The live webhook path: signature check, store, direct hand-off, queue retry.
- The per-rider advisory lock in `dispatch_order`: PGlite has one connection, so two dispatches never race in tests.
- Deliverect adapter: shape only. Needs a partner account.
- Market tables (`markets`, `market_settings`, `setting_for`): schema only. Functions still read global settings.

### C. Still to build
See `docs/BUILD_PLAN.md`: Phases 0 to 7 lead to a paid grocery pilot; Phase 8 is restaurants; Phase 9 is the website and diaspora
orders; later items (nutrition calculation, advertising, forecasting) each have a trigger. Not built at all today: scheduled orders,
the console.
Ordering lane: B1 and B2 are done (above); B3 is next (1.7, 1.8, 1.13, 1.17, 2.9).
Hub lane: C1 is done (below); C2 (2.1, 2.2, 2.3, 2.4, 2.5, 2.10) and D1 (console) can start.
Use its task numbers (0.1, 1.2, ...) for branches and pull requests.

### D. Needs a live account or real conditions (cannot be finished in code alone)
- Kapso: real webhook payloads for both numbers, signature header, marketing-preference event shape, typing indicator.
- Meta: template approval; which messages are billed and at what rate, per number and category.
- Supabase: staging project `alo-king-staging` (`lhgkvvdckwbfpdsftzqp`, eu-central-1) exists and was empty on 13 Nov; `deploy-staging` fills it (section F). Still to do: turn on point-in-time recovery before real money (paid plan), and a production project.
- Cloudflare: deploy and the one-minute cron trigger are in place (section F); still to prove: the cron doing real work, Durable Object alarms under load, queue retry.
- Speed: time from message to card, measured on a phone in Chouf.
- Speech: accuracy on the hand-corrected voice notes.
- A two-connection test of the dispatch lock on real Postgres.
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
| 0.8 Error tracking | **Partly** | Built: `apps/gateway/src/worker.ts` wraps the gateway; scrubbing is tested (4 tests); under workerd the SDK sends a valid event. Live: the raw ingest check got HTTP 200 (event `6f30eba108de2334b717ef822273528b`) and the Worker's test route reported `flushed=true` (event `3f08a8de23234b16aa17c357b61e1a3d`). **Not confirmed: that Sentry stores them.** Twenty-plus minutes later, neither event, nor any issue, is visible in project `alo-king-gateway`, with the read-only connector and cache bypassed. The DSN is the gateway project's own key. Someone with Sentry access should open the project and check Settings, Client Keys (is "Default" active, any rate limit), Inbound Filters, Stats (accepted, filtered, dropped) and the org quota, and search for those two event ids. Until then, 0.8 is not done. Also: the default alert "high priority issues" exists. Gap for A2: errors the gateway catches and retries (queue handler, failed turns) never reach Sentry until `index.ts` reports them. A silent cron is task 4.10. |
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
