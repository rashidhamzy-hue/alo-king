# Alo King Chouf: build plan to launch

The one current roadmap: the phases and their numbered tasks, the product rules, how a session works, and the sessions still open.
Trimmed on 18 November 2026 by session DOC2: the finished sessions' rows, the gap matrix and the three older "revision" tables are in
`docs/log/build-plan-sessions-2026-11-18.md` (history). Where a phase row below disagrees with a later decision, the decision wins
(`docs/RULES.md` lists every current rule and setting value with the decision that set it). Status and the critical path to the friends'
test are in `docs/STATUS.md`. Rules the code must never break are in `CLAUDE.md`.
Everything a session needs is in this repository; no earlier conversation or outside document is required.

## The milestone that matters

A real customer sends a Lebanese WhatsApp order, gets the right card, confirms, receives the right goods, and pays.
At day close, stock, rider cash, rider earnings and the company ledger reconcile with no unexplained balance.

## Shape of the plan

```
Phase 0 (accounts, CI) ─┬─ Phase 1 (ordering) ─ Phase 2 (hub ops) ─ Phase 3 (console) ─┐
                        ├─ Phase 4 (live integration, runs beside 2 and 3) ────────────┼─ Phase 6 (shadow run) ─ Phase 7 (paid pilot) ─ Phase 8 (restaurants)
                        └─ Phase 5 (data and readiness, founder and team, from day one)┘
After the pilot: Phase 9 (pay-by-link, card checkout, diaspora orders), then the "Later" list. The cash-only website is not Phase 9: it is built (WEB1, WEB2) and is being restyled to the founder's reference.
```

The pilot is groceries only. Restaurants are Phase 8: they are part of the product, not an afterthought. The long-term goal
is every restaurant in Chouf, reached one signed partner at a time. Phase 8 can start during the pilot the day one signs.

Sizes are estimates for one builder with Claude Code, in focused working days. They are a sense of scale, not a schedule.

| Phase | Size | Done when |
| --- | --- | --- |
| 0. Accounts and CI | 2-3 days | Migrations run on a Supabase branch, the permission check passes there, a sandbox WhatsApp message is stored and answered, CI is green |
| 1. Ordering path | 10-12 days | Typed and voice orders produce the right card on the real schema; unsigned restaurants get "not yet"; a payment screenshot reaches the ops queue |
| 2. Hub operations | 8-10 days | Pick, substitute with the customer's tap, mark ready; missing items refunded; returns by button |
| 3. Staff console | 8-10 days | Every human step done from a browser; day-close report shows zero unexplained balance; roles enforced by the database |
| 4. Live integration | 4-6 days | Both numbers carry real traffic; templates approved; cron running; dispatch race tested; speed measured in Chouf |
| 5. Data and readiness | founder and team | Every stocked item has cost, price and count; hub, pilot zone and fees fixed; riders signed; voice eval scored |
| 6. Shadow run | 1-2 weeks | 100+ staff orders over 7+ days, every day closes clean |
| 7. Paid pilot | 4-6 weeks | The measures in Phase 7 hold |
| 8. Restaurants | 8-10 days, starts when the first partner signs | A signed restaurant receives, accepts and settles real orders |
| 9. Website and diaspora | sized when started | Gated: four clean pilot weeks and a signed card gateway |

## Product rules that shape every phase

**Neutral, factual discovery.** Alo King is not a reviewer, critic or nutrition adviser. The Concierge shows available
options that match the request and sorts them by measurable things: what was asked for, availability, price, delivery
time, portion size, approved food facts, the customer's own stated preferences and past purchases, and real aggregate
popularity where there is enough data. It never says best, better, worse, tasty or healthy, never invents a rating, and
never speaks negatively of a merchant. Asked "which is best", it asks what matters or offers a sort. The customer decides.

**Food facts.** Allergen, ingredient, halal, vegetarian, vegan, fasting and nutrition statements come only from approved
records, always with their status (certified, declared, calculated, partial, unknown). Unknown is never shown as safe.
The model never states one from its own knowledge. A stated allergy is passed to the kitchen as an allergy.

**Preferences.** Explicit restrictions outrank learned habits, popularity, margin and any paid placement. Nothing sensitive
is inferred from a name, a place or an order. Customers can see, change and clear what is saved.

**Learning.** The system improves aliases, usuals, demand, prep times and travel times from real data. It never invents
food facts, changes prices or financial rules, or approves a campaign.

## Marketing and the customer number

The customer number is the business. No set of rules makes a promotional broadcast risk-free, because a number's standing
with Meta depends on how recipients react (blocks and spam reports), and nobody controls that.
- Marketing sends are switched off in the database (`settings.marketing.enabled = false`); `can_send()` refuses them. Tested.
- The pilot sends only replies inside a conversation the customer started, and approved utility templates about that customer's own order.
- A promotion is never sent as a utility template. Miscategorising is itself a violation.
- We never message a person who has not messaged us (for example a gift recipient).
- If promotions are ever wanted: a separate number, explicit marketing opt-in, an opt-out in every message, a small test audience first, and a stop rule if the quality rating leaves green. Even a second number in the same business account is not fully isolated. That is a founder decision, taken with the first month of real quality data in hand, not a build task.

## Voice notes

| Sender | Processed automatically up to | Notes |
| --- | --- | --- |
| Customer | 3 minutes | No "preferred length" message is ever sent; friction is only at the limit |
| Restaurant or merchant | 5 minutes | Menus are better sent as a file, photo or link; say so when a long note looks like a menu |
| Rider and staff | 2 minutes | Voice never records an amount, a payout or a drop: buttons or typed figures only |

- Limits are settings, not code (`settings.voice_limits`), with an hourly budget per sender.
- Over the limit: a polite reply offering shorter notes, typing, or a person. Nothing is dropped silently.
- Notes sent within the same burst are read as one request; a later note can correct an earlier one.
- Unreadable, looped or empty transcripts get the existing "could not hear that" reply.
- WhatsApp accepts audio up to 16 MB, far above these limits; the limits are ours. Revisit them after the 38-note evaluation (5.8).
- Built: the policy function with tests, and the customer line. To build: task 1.17.

## Acceptance tests for the new rules

| Behaviour | Test | State |
| --- | --- | --- |
| Marketing refused while the switch is off | `test/db/rider-flow.test.ts` | Passing |
| Voice limits per role, hourly budget, never silent | `packages/core/test/voice-policy.test.ts` | Passing |
| Rider paid in lira keeps fees, books reconcile | `test/db/rider-settlement.test.ts` | Passing |
| Neutral replies; no unapproved food claims; allergy handling; no inferred religion | `evals/cases/neutral_and_food_facts.json`, `evals/test/neutral-cases.test.ts` | Passing against the output guard; live model run in `evals/live/` |
| Restriction check: unknown fails, sponsored item must pass | `test/db/food-facts.test.ts` (the check itself); the ranking side is written with 8.12 | Passing for 1.11 |
| Small-order fee shown on the card and posted to its own account | `test/db/ordering-b2.test.ts` | Passing |
| Cost at receiving gives margin; ledger at zero | `test/db/receiving-margin.test.ts` | Passing |
| Phase 2: a pick with one missing item, one accepted substitute and one refund leaves stock, order total, rider's cash due and ledger consistent | `test/db/substitutions.test.ts` | Passing |
| A full slot refuses a scheduled order | `test/db/scheduled-orders.test.ts`, `test/pg/slot-race.test.ts` (two taps at once) | Passing |
| Memory commands show, forget and stop | `test/db/ordering-b2.test.ts`, `evals/test/memory-commands.test.ts` | Passing |

## Which model for which session

Set the model at the start of each Claude Code session with `/model`. The session table under "Build sessions" decides the model for a session. The table below shows which tasks are sensitive and why; where a bundle mixes both kinds, it runs on the stronger model.

| Model | Use for | Tasks |
| --- | --- | --- |
| Sonnet 5.5 (default) | Well-specified work with a clear test: setup, screens, forms, wiring, fixtures, documentation | 0.1-0.13, 1.18, 1.19, 1.20, 3.16, 3.17, 4.12, 4.13, 5.15, 8.13, 1.3, 1.4, 1.8, 1.12, 1.13, 1.15, 1.17, 2.1, 2.5, 2.6, 2.9, 3.2-3.10, 3.14, 4.1, 4.3, 4.4, 4.9-4.11, 5.6, 5.9, 8.2, 8.9, 9.0, 9.3, 9.5 |
| Opus 5.5 | Anything that moves money or stock, changes the state machine, touches concurrency, security or privacy, or designs a new migration | 1.1, 1.2, 1.5, 1.6, 1.7, 1.9, 1.10, 1.11, 1.14, 1.16, 2.2, 2.3, 2.4, 2.7, 2.8, 2.10, 2.11, 3.1, 3.11-3.13, 3.15, 4.2, 4.5, 4.6, 4.8, 8.3-8.8, 8.10-8.12, 8.14, 8.15, 9.1, 9.2, 9.4, 9.6, 9.7 |
| Fable 5.2 (only when needed) | (a) One audit session before Phase 6 and one before Phase 7: read every migration and test, and try to break the money path, permissions and recovery. (b) Any task Opus has failed twice. (c) A day-close balance nobody can trace. | Phase gates and escalations only |
| Haiku 5.5 | Not for building. It is the Concierge's runtime model. | |

Rule of escalation: if a session cannot make its tests pass after two honest attempts, stop, write down what was tried, and restart the task one model up.

## Phase 0: accounts, environments, CI

| # | Task | Notes |
| --- | --- | --- |
| 0.1 | Private GitHub repository from this tree | Start clean: see `START_HERE.md` for what to keep and what to retire from the earlier attempt. Protect main. One pull request per task. |
| 0.2 | CI on every push | In the tree: `.github/workflows/ci.yml` runs typecheck, tests, the permission check on a real Postgres, gitleaks and osv-scanner. Not yet run on GitHub. Red blocks the merge. |
| 0.3 | Supabase project with a staging branch | Region nearest Lebanon; confirm latency. Apply all migrations and seeds. Create the private `media` bucket. |
| 0.4 | Permission check on Supabase | `scripts/check_permissions.sh` against staging. It has only passed on plain Postgres. |
| 0.5 | Cloudflare Workers Paid, staging | `wrangler.jsonc` has complete `staging` and `production` environments; both bundle in a dry run. Still to do on the account: Worker, conversation object, queue and dead-letter queue, one-minute cron. Secrets via `wrangler secret`. |
| 0.6 | Kapso account with test numbers | Point both webhooks at staging. Save ten real payloads of each event type under `test/fixtures/kapso/` before changing any parser. Kapso facts (13 Nov 2026): message webhooks are set per phone number, one for each of the four numbers; map `phone_number_id` to line in our own config. There is no single switch that turns off Kapso AI agents and workflows: open each one left from the earlier attempt, disable its trigger, and verify nothing replies but us (on 12 Nov the project had no workflows and no Meta agents). Pro includes 3 connected numbers, 10 USD for each extra: four numbers (2 staging, 2 production) are 35 USD a month (`docs/COST_MODEL.md`). |
| 0.7 | Anthropic API keys with a monthly spend limit | One for staging, one for production. |
| 0.8 | Error tracking, free tier | Worker exceptions and failed cron runs alert the builder. |
| 0.9 | Meta ownership and verification | Confirm the WhatsApp Business Account and both numbers sit in Alo King's own Meta business portfolio (so the numbers survive a change of provider). Start Meta business verification. Check on a real payload that click-to-WhatsApp referral data reaches us through Kapso. |
| 0.10 | Builder tools | Install the Supabase and Cloudflare skills; Supabase MCP on staging only, read-only, one project (`.mcp.json.example`); Kapso plugin on a staging key after checking what its scopes can send. Decisions in `docs/TOOLS.md`. |
| 0.11 | Deploy and recovery procedure proven once | Walk `docs/RUNBOOK.md` on staging: deploy, roll back the Worker, rotate one secret. Mark each step proven. |
| 0.12 | Meta billing guard | Use Kapso managed billing (partner_managed, Kapso's Meta app, available on Pro). Load Kapso credits before any billable send; sends pause when the balance is insufficient. The sandbox ops line also draws on Kapso credits. Since 1 October 2026 replies are billed after 1,000 free a month per number. |
| 0.13 | Staging demo with evidence | From a real phone to the staging customer number: a three-item Arabic order, the card, the confirm tap, a rider accepting and delivering on the staging ops number, cash recorded. Then `scripts/staging_evidence.sql` for that order, saved with screenshots under `docs/evidence/`. Passes when every state is an allowed transition, stock moved equals items sold, each ledger transaction and the whole ledger sum to zero, and no message was sent twice. Needs sessions A1 and B1 merged. |

Phase 0 status on 12 November 2026 is superseded: staging, CI, both Workers, Kapso, the console and backups exist (`docs/STATUS.md`, "Live on staging"). Still open, each needs the founder's accounts: 0.9 (Meta ownership and verification), 0.12 (Meta billing guard), production (A3).

Update 13 November 2026 (session A1): 0.1 and 0.2 are done. 0.3 to 0.8, 0.10 and 0.11 are built as GitHub Actions workflows and scripts
(`deploy-staging`, `staging-drill`, `capture-kapso-fixtures`); the build environment cannot reach the accounts, so they are proven only by a run.
0.9 and 0.12 are Meta steps for the account owners, written out in `docs/log/inventory-2026-11-13.md` section E. Results are in section F: 0.3, 0.4, 0.5, 0.6 (webhooks), 0.7 (key and models) and 0.11 are proven on live staging; 0.8 is delivered to Sentry's ingest but not yet visible in the project; real webhook fixtures, the Anthropic spend limit, 0.9 and 0.12 remain.

Not in this phase: the two real +961 numbers. They join in Phase 4.

## Phase 1: customer ordering path

| # | Task | Where |
| --- | --- | --- |
| 1.1 | Parse once, then the database. One forced extraction call; `plan_order` returns a card, a question or a handoff. The tool loop runs only when `next = 'ask'`. | `packages/agents/src/concierge.ts`, `apps/gateway/src/turn.ts`, migration 0005 |
| 1.2 | Unsigned restaurants: reply "not available yet". The request is logged by 1.12. | `plan_order` status `merchant_not_onboarded` |
| 1.3 | Answers without the model: order status, hours, "same as last time", out-of-area villages. | `order_status_for`, `repeat_order_lines`, `resolve_place` |
| 1.4 | Card shows any amount owed from a failed delivery and asks for prepayment when required. | `packages/agents/src/order-card.ts` |
| 1.5 | Money guardrail: no free-text model reply may state a price, fee or total. | gateway `preflight` |
| 1.6 | Payment screenshots: stored privately, queued for ops; an optional model read pre-fills amount and reference; a person confirms. | `turn.ts`, `payment_proofs` Fetch media through Kapso's `media_url`, never a raw Meta link, and copy what we must keep into our own private storage at once. |
| 1.7 | Voice notes: Kapso transcript first; second provider behind a setting so 5.8 can score both. | `packages/agents/src/stt.ts` Fetch audio through Kapso's `media_url`, never a raw Meta link, and copy what we must keep into private storage at once. Kapso's transcription runs through ElevenLabs, which may keep transcripts up to three years: the founder decides between stating this in the privacy notice and using our own provider behind the existing setting. Score Lebanese Arabic on the real Shouf notes (5.8) before choosing. |
| 1.8 | Typing indicator on arrival; per-customer cap on model turns per hour, then alert a person. | `turn.ts` |
| 1.9 | Move `concierge-flow.test.ts` from its fake database to the real schema; add ten voice-note cases to `evals/`. | `test/db/` |
| 1.10 | Neutral and factual Concierge. The prompt rules exist (`prompts/concierge.md`). Wire `evals/cases/neutral_and_food_facts.json` into `evals/run.ts`; add an output check that blocks quality adjectives and unapproved food claims. | `evals/`, gateway `preflight` |
| 1.11 | Food-facts schema: `product_facts` (product, attribute, value, status certified / declared / calculated / partial / unknown, source, approved by, reviewed, expires) and `evidence_documents`. One function answers "does this product meet these restrictions": unknown fails. | new migration |
| 1.12 | Demand signals: one log for what customers asked for and could not get (unknown product, out of stock, unsigned restaurant, out of area, no slot). | new migration |
| 1.13 | First-contact source: store the ad click id or QR code on the customer and the first order. | `apps/gateway/src/index.ts`, new columns. Also store a referral code when a customer's first message carries one (data capture only; no reward exists yet). |
| 1.14 | Customer control of memory: "what do you know about me", "forget", "stop remembering". Add origin (stated / observed) to `customer_memory`. Stated restrictions apply to the current order and are saved only after a yes. New aliases wait for a person's approval instead of auto-promoting. | 0007 functions, new migration |
| 1.15 | Model-capacity fallback: fixed "one moment" reply, retry with backoff, then hand to a person. Never silence. | `turn.ts` |
| 1.16 | Small-order fee and first-order cash cap, read from `settings.small_order_fee` and `settings.first_order` (both off today). The fee is company income, a separate line on the card, never mixed with the rider's delivery fee. | `quote_order`, `order-card.ts`, ledger account |
| 1.17 | Voice-note policy by sender role. Customer line is wired (`packages/core/src/voice-policy.ts`). Read limits from `settings.voice_limits`; enforce the hourly budget across turns; use the provider's real duration when present; apply to riders and staff. | `turn.ts`, `ops-turn.ts` |
| 1.18 | Stay on the job | Meta has barred general-purpose AI chatbots from the Business Platform since 15 January 2026. Asked for anything unrelated to ordering, delivery or an existing order (homework, general questions, long chat), the Concierge declines in one friendly line and offers to help with an order. Prompt rule plus eval cases. |
| 1.19 | No phone number in the webhook | WhatsApp usernames can hide a customer's number. Identity already rests on the business-scoped id. When no number arrives, ask for a number the rider can call before the order card, and store it on the customer. Test with a fixture that has no phone. |
| 1.20 | Same as last time | A returning customer with a closed order is offered their last basket as one button, re-priced and re-checked for stock by `quote_order`; a missing item is named before the card. `repeat_order_lines` exists. Never shown to a customer with no closed order. |
| 1.21 | WhatsApp catalog for the 291 products | Browse with pictures, add to cart, send. The database stays the only source of price and stock; the catalog never confirms. Session K1. Details below the table. |
| 1.22 | Catalog language pack, proven on the live model | Found live on 13 Nov: the model writes catalog searches in English (`schemas.ts` asks for an English phrase), so "bread" matched nothing, labneh became laban, eggs became "Chicken Legs", and the 0.13 demo message got "Najjar coffee not found". Fix: the search keeps the customer's own words first; a generated language pack gives every product search terms in Lebanese Arabic, Arabic in Latin letters, English and French, plus the generic words people use (خبز، بيض، لبنة); a term that points at more than one product is dropped. A generated eval set (at least two phrasings per product, mixed languages, truth known by construction) runs on the live model before and after. Gate: item F1 at least 0.90, zero wrong products, and the 0.13 demo message gives the right card on staging. Generation and live runs go through GitHub Actions with `ANTHROPIC_API_KEY`. |
| 1.23 | Search words for every new product and menu item, automatically | Founder rule (13 Nov): whenever a product is added (console catalog, intake 5.15) or a merchant menu item is imported (3.10, Phase 8), the system writes its search words in Lebanese Arabic, Arabic in Latin letters, English and French, plus the generic words people use, with the same builder 1.22 used: drop a word that points at more than one product, drop any allergen, diet or nutrition word not printed in the name (invariant 15). It then runs a few generated phrasings through the planner; an item whose phrasings do not resolve to it goes on a review list in the console instead of being guessed. Runs as a queued job in the Worker with the fast model, so a new item is searchable within minutes. A nightly check re-runs it for items whose name, brand or size changed. Test: adding a product creates its words, a colliding word is dropped, and a failed phrasing lands on the review list. |

Status 13 November 2026 (session B3): 1.22 is built and measured on the live model: item F1 0.503 before, 0.918 after (precision 0.995),
10 wrong products in 2,458 items from four phrasings, so the zero-wrong gate is not met yet; the 0.13 message is right in every live run, and
the staging probe turned it into the right card and a closed order (AK-1001, 13 Nov 17:43 UTC): 0.13 is ready to send. 1.7, 1.8, 1.13, 1.17 and 2.9 are built and tested; the typing indicator, the feedback cron and
the ops-line voice reply need one call each in lane A and C files (requests in `docs/history/HANDOFF_sessions_2026-11-13_14.md` (or `docs/log/`), session B3). Plan change made by B3: the
pack and eval set are regenerated through `.github/workflows/language-pack.yml`, never by hand.

Status 13 November 2026 (session B4): the founder's first live order (13 Nov) failed four ways (basket lost after the address, village taken
from the text not the pin, «حي راجح» read as a village, no card); each is a replayed test and fixed: the pin decides the village (village
centres are data, 0074), a first delivery asks once for house and floor, then the card. 1.22's zero-wrong gate: on the replay of all 1,972
recorded live readings, wrong products 10 -> 0 at F1 0.918 (0075); live runs in `docs/history/HANDOFF_sessions_2026-11-13_14.md` (or `docs/log/`). 1.23 is built and tested (0076); the
console's review list for it is D2's next page. The lane B requests of D1, C2 and B3 are done (0077). K1 can start.

Every misread order becomes an eval case before it is fixed.

### 1.21 WhatsApp catalog for the 291 products (session K1)

Goal: customers browse a categorised catalog with pictures inside WhatsApp, add items to a cart, and send it. The database
stays the only source of price and stock. The catalog is a way to browse and choose, never a way to confirm.

Facts from Kapso (13 Nov 2026): Kapso can send catalog, product and product-list messages using Meta catalog and product
ids, and passes incoming cart orders to our webhook. It has no API to create or edit a catalog; the catalog lives in Meta
Commerce Manager.

Build:
1. Categories. Every product gets one customer-facing category and a sort order, in Arabic and English (about 12 to 15
   categories). The founder approves the list.
2. Feed. A protected Worker endpoint serves the catalog as a Meta data feed generated from the database: id, title,
   description, price, availability, picture address, category, brand. Only products with an approved, usable picture
   (5.17) are included.
3. Meta side, once. Create the catalog in Commerce Manager under Alo King's business portfolio, add the feed on the
   shortest schedule Meta allows, create one collection per category, and connect the catalog to the WhatsApp account.
   Catalog visibility and the cart are switched on per number with Meta's Commerce Settings API or Meta's tools: try the
   call through Kapso's Meta proxy on staging; if it is not supported, use Meta's tools. Write every step into
   `docs/RUNBOOK.md`.
4. Sending. The Concierge can send the full catalog, a product list for one category ("what dairy do you have?"), or a
   single product. All go through the gateway as `interactive` messages with a dedupe key; no new message type is added
   (invariant 2). A product-list message holds at most 30 products in at most 10 sections: a category with more than 30
   products is split into named sub-lists, or the customer gets the full catalog view.
5. Receiving. A cart order is parsed into the same lines a typed order produces and goes through `plan_order` and
   `quote_order`. The customer then gets the normal order card and confirms with a tap. If a price or stock level changed
   since Meta fetched the feed, the card says so before the tap.
6. Sold out. When an item goes out of stock the database refuses it at once, even if the catalog still shows it until
   the next feed fetch.

Check against Meta's current documentation before building: required feed fields (including whether a web link per
product is mandatory), picture size rules, and which product types Meta's commerce policy refuses.

Tests:
- A cart order and the same order typed in chat produce identical quotes.
- A cart item that is out of stock is named and removed before the card.
- A cart with a stale price shows the database price on the card.
- No product without an approved picture appears in the feed.
- No product-list message is ever built with more than 30 products or 10 sections.
- A catalog cart never confirms an order without the customer's tap.

Must be live on staging before the paid pilot (Phase 7).

Status 14 November 2026 (session K1): built and tested in code (migration 0085; `docs/history/HANDOFF_sessions_2026-11-13_14.md` (or `docs/log/`), K1). Not live: it waits on
Rasheed's Meta steps (`docs/RUNBOOK.md`, "WhatsApp catalog") and on approved pictures (none yet). K1 used 0085-0087 and left 0051
unused: a migration numbered below ones already applied on staging would apply out of order.

## Phase 2: hub operations

| # | Task | Notes |
| --- | --- | --- |
| 2.1 | Picker flow on the ops line: pick list, start, item missing, picked. Picked moves the order to ready. | `settle_stock` exists; add a picker branch to the ops handler |
| 2.2 | Missing item and substitution: the customer taps keep or remove, with the price difference shown; no answer means remove; total recalculated before a rider is offered. Never substitute silently. | new migration: line changes with stock and ledger entries |
| 2.3 | Refunds and complaints after delivery: credit on next order, or cash or Whish refund, each with its own ledger entries. | new migration; screens in 3.6 |
| 2.4 | Offer the rider when picking starts, not at confirmation. | `dispatch_order` trigger point |
| 2.5 | Returns by button. | `receive_return` exists |
| 2.6 | Stock adjustments with a reason and a name. | `stock_movements` exists |
| 2.7 | Suppliers and receiving: goods receipt with supplier, quantity, unit cost and expiry date; moving average cost per product; cost of goods posted at sale. Without this the business cannot see its own margin. | new migration; console form in 3.12 |
| 2.8 | Scheduled orders. (a) Windows: a requested delivery window on the order; windows and their capacity are rows a person edits, with a calendar for Ramadan, Lent and holidays; no hard-coded dates. (b) Capacity: a slot is held only at confirmation; the card never offers a full window. (c) Cut-off: each window has an order-by time; fresh goods have their own earlier cut-off. (d) Changes: the customer may add, remove or cancel until the cut-off, and every change is re-quoted and re-confirmed by a tap. (e) Rescheduling: by the customer before the cut-off, or by ops at any time with a reason; the old slot is released and the new one taken in one transaction. (f) Dispatch offers the rider in time for the window, not at confirmation. (g) Stock for ambient goods is reserved at confirmation; fresh goods are bought to order. Needed before February 2027. | new migration, `dispatch_order`, `order-card.ts` |
| 2.9 | One-tap feedback after delivery: fine, or a problem (which becomes a handoff). | `turn.ts` |
| 2.10 | Rider cannot continue (accident, breakdown, phone dead) | Ops marks the rider off; each open delivery is re-offered; goods and cash already held are handed over or dropped with a count; the first rider's exposure and earnings stay correct. Test on the real schema. |
| 2.11 | Product recall and supplier credit | Hold a product (not sellable, not pickable) in one action; list every order that contained it in a date range so ops can phone those customers; a supplier credit note reduces the payable and the average cost. |

Done when a test on the real schema shows a pick with one missing item, one accepted substitute and one refund leaves stock,
the order total, the rider's cash due and the ledger consistent.

## Phase 3: staff console and day close

Security first: `confirm_payment`, `confirm_cash_drop`, `approve_merchant`, `pay_rider_earnings` and `receive_return` take
"who is acting" as an input. The browser must never supply it. Staff sign in; the worker checks the session and passes the
signed-in person. Roles: admin, ops lead, picker.

| # | Screen or job | What it does |
| --- | --- | --- |
| 3.1 | Sign-in and roles | Supabase Auth, staff only. Every admin action logged. |
| 3.2 | Today | Orders by status, late first; riders on shift with cash and exposure. |
| 3.3 | Payments to confirm | Screenshot, expected amount, typed reference, confirm or reject. |
| 3.4 | Cash drops and rider payouts | Confirm a drop per currency; show `rider_statement`; run `pay_rider_earnings`. Also a WhatsApp end-of-shift message to the rider with the same figures. |
| 3.5 | Exceptions and handoffs | The `ops_exceptions` queue and open chats; replies go through the gateway. |
| 3.6 | Returns and refunds | From Phase 2. |
| 3.7 | Catalog | Price, availability, stock count, reason on every change. |
| 3.8 | Daily exchange rate | One person each morning; a 3% move within the day pauses quoting until confirmed. |
| 3.9 | Zones and fees | Edit which villages are served, their zone, and each zone's delivery fee and ETA. See "Hub and zones" below. |
| 3.10 | Merchants (minimal) | Approve a menu import; approve a merchant. Used in Phase 8. |
| 3.11 | Day-close report | One SQL function and one screen: orders by outcome, sales, stock moved against items sold, each rider's cash by currency, rider earnings, transfers, credits, and an unexplained balance that must be zero. Sent to the founder nightly. |
| 3.12 | Money in and out of the hub: receiving form (2.7), gross margin in the day-close report, bank deposit and expense entries so hub cash reconciles to the bank. | |
| 3.13 | Second approval for price changes above a set percentage and for refunds above a set amount. | |
| 3.14 | Food-facts editor with evidence upload, and an "expires within three days" stock list. | |
| 3.15 | Petty cash and bank deposits | Two more ledger movements at day close: cash to the bank (with the slip photo) and petty cash spent (with a reason and a name). The hub cash account must match the counted drawer. |
| 3.16 | Complaint cases | One record per complaint: order, kind (late, missing, wrong, quality, allergen, payment), owner, what was done, refund link, closed by whom. An allergen complaint opens at the top of the queue and holds the product (2.11) until a person clears it. |
| 3.17 | Day-open checklist | One screen: orders waiting, deliveries not closed from yesterday, stock expiring in 3 days, receipts not yet counted, rider cash and rider payables outstanding, open cases, last cron heartbeat. SQL only. |
| 3.18 | Picture review page (5.17 step 6) | The item and its proposed picture side by side, with source and licence; approve or reject. Writes only through the 0050 functions. |

Build it plain: server-rendered pages. No design work until the pilot shows what ops uses.

## Phase 4: live integration on real accounts

| # | Task | Why tests alone cannot do it |
| --- | --- | --- |
| 4.1 | Replace assumed webhook shapes with the saved fixtures: message, status, marketing preference, sender id. | The parser was written from documentation. |
| 4.2 | The two +961 numbers: business verification, display names, connect through Kapso. | Needs company documents. |
| 4.3 | Submit utility templates (order cancelled, rider at the door, payment received); wire each to its event. | Meta approval takes days. Templates belong to the WhatsApp account; Meta review is often about 24 hours and can be longer. Submit early. |
| 4.4 | Read the first real bill; correct message costs per number and category in `docs/COST_MODEL.md`. | Free messages apply only to some categories. |
| 4.5 | Worker end-to-end test: webhook path and `scheduled()` in the local Workers runtime against real Postgres, including a crash mid-turn. | No automated test covers these today. |
| 4.6 | Dispatch race: two dispatches for one rider on two real connections; only one wins. | PGlite has one connection. |
| 4.7 | Speed: message to card, on a phone in the pilot area, typed and voice. Starting target: most typed orders within 10 seconds; revise once measured. | Depends on four services together. |
| 4.8 | Production Supabase: point-in-time recovery on, a restore tried once, security advisor clean, permission check re-run. | Real money needs a restorable database. |
| 4.9 | Outage runbook: how ops takes orders by phone and enters them afterwards. Tested once on purpose. | A procedure, not code. |
| 4.10 | Heartbeat alert if webhooks or the cron go silent; an hourly test order on staging. | Silence is the failure nobody reports. Also: subscribe to Kapso's project webhook for account enforcement events (disabled, restricted, reinstated, violation); each one opens an ops exception and alerts the founder. Kapso has no webhook for quality-rating changes: once a day poll `GET /platform/v1/whatsapp/phone_numbers` and alert if `quality_rating` is anything but the top rating. Alert when the Kapso credit balance falls below a set amount. |
| 4.11 | Record real tokens and cost per order from `agent_runs`; correct `docs/COST_MODEL.md`. | The current figure is an estimate. |
| 4.12 | Message meter | Count billable messages per number per month from `wa_messages`; warn at 800 of the 1,000 free service messages; show cost per order at day close. | Billing changed on 1 October 2026. Kapso's own allowance is 100,000 messages a month on Pro; a message can count there and also incur a Meta fee. |
| 4.13 | Official Kapso SDK inside the gateway | Try `@kapso/whatsapp-cloud-api` in `packages/wa/src/kapso.ts` on staging: same sends, typed errors with a retry hint feeding the outbox, webhook signature helper. Keep it only if the fixtures from 0.6 pass unchanged. `gateway.ts` stays the only caller. | Needs live Kapso. |

Status 13 November 2026 (session A2): 4.1, 4.5, 4.6, 4.12 and 4.13 are built and tested; 4.3's templates are submitted and wired (approval is Meta's);
4.10 is built and tested, and proven by the hourly probe order once deployed. 0.13 is prepared and waits for one message from the founder's phone
(`docs/history/HANDOFF_sessions_2026-11-13_14.md` (or `docs/log/`), session A2). Plan changes made by A2: the 0.13 rider leg is played by a staging test rider (the probe) instead of a second phone on the
sandbox number; the "credit balance below an amount" alert in 4.10 is replaced by "Kapso paused paid sends", because Kapso's API has no balance figure.

## Phase 5: data and launch readiness (founder and team; starts now)

| # | Item | Notes |
| --- | --- | --- |
| 5.1 | Hub location | Planning reference: Baakline, Baqaata or between them, possibly near VCC Baakline. Not a confirmed property. See "Hub and zones". |
| 5.2 | Opening assortment | Keep all 291 items in the catalog; stock the fast movers. |
| 5.3 | Supplier, cost and selling price for every stocked item | Fix pack sizes and units. Several by-weight items carry per-100 g reference prices (AK-0042 shows 0.67). No item goes live without an approved price. |
| 5.4 | Opening stock count | Through the console. |
| 5.5 | Pilot zone and delivery fees | A small cluster first. Fees are the riders' whole income; set them with rider earnings per hour in view. |
| 5.6 | Travel times | `scripts/fetch_village_coords.mjs`, then `scripts/build_travel_times.mjs` from the confirmed hub, on a machine with open internet. Check a sample by riding. Then the route check in `docs/DECISIONS.md`: a rider drives 20 hub-to-village journeys with a timer; compare the OSRM figure, and Google Routes if the founder approves a billing account, against the measured time. Our own measured times replace both as deliveries accumulate. |
| 5.7 | Riders | Number, hours, written terms: fees and tips are theirs, cash cap, drops, shortfalls. A Lebanese labour lawyer reads the shortfall and damaged-note policy before it is used. |
| 5.8 | Voice-note evaluation | Hand-correct the 38 transcripts; score item and quantity accuracy for both providers. |
| 5.9 | Data retention | Proposal: voice notes and photos deleted after 90 days unless tied to a payment or complaint; chat text after 12 months; financial records kept as law requires. Built as a nightly job once approved. Set a retention window on the Kapso project to match; Kapso's default keeps message data indefinitely. |
| 5.10 | Daily exchange rate owner | One named person. |
| 5.11 | Lawyer and accountant | Rider status and insurance; food-handling permits; VAT and receipts, including whether the rider's delivery fee is taxable to the company; privacy notice under Law 81 of 2018; refund terms; liability wording for repeated allergen and halal declarations; whether a cash shortfall can be charged to a rider. |
| 5.12 | Market and money | Test-order the competitor rolling out in Chouf; seasonal assortment for Ramadan and Lent 2027; working capital for opening stock, rider change float and one month of fixed costs. |
| 5.13 | Staff routine | Two pages: day open, day close, what to do when the system is down. |
| 5.14 | Small-order fee | Decide the threshold and the amount before the paid pilot, from real margins and what competitors charge. |
| 5.15 | Label scan at intake | A picker photographs the barcode and the label; the vision function proposes name, brand, size, ingredients, allergens and nutrition panel; Open Food Facts is looked up by barcode as a second opinion; a person confirms every field against the pack before it is published. Each fact keeps its source, status and date. Needs the food-facts tables (1.11). |
| 5.16 | Restaurant prospect calls | `research/prospects/alo_king_launch_shortlist.csv` in the private `media` bucket (moved out of the repository in H1): the founder or ops lead visits or phones, in person, never from the system. Record interest, owner name and permission to contact in the cleaned sheet. |
| 5.17 | Product pictures, fetched by the system | One clean, usable picture per catalog item, approved by a person. Session P1. Details below. |
| 5.18 | Product data from sources, proposed for approval | For each of the 291 products with a barcode: fetch ingredients, allergens, nutrition panel and diet labels from Open Food Facts and store them with C1's `propose_fact` as proposed records, source `open_food_facts`, never approved by code. The fast model only maps Open Food Facts' own ingredient and allergen text onto our allergen vocabulary and writes an Arabic rendering of the ingredient list; every mapped value stays a proposal with the source text beside it. Nothing reaches a customer until a person approves it against the pack at intake (5.15). Also proposed, not applied: cleaned Arabic and English display names and sizes, and the 12 to 15 customer categories for 1.21 (written to `data/proposals/`). No model writes a food fact it did not read from a source (invariant 15). Session N1. |

### 5.17 Product pictures (session P1)

Goal: one clean picture for each of the 291 catalog items, approved by a person, with its source and licence recorded.

1. A script reads each catalog item: name, brand, size, and barcode when known.
2. It gathers up to five candidates per item: Open Food Facts by barcode first, then the brand's own product page, then a
   web image search API. The fetch runs in GitHub Actions (`.github/workflows/images.yml`), because cloud build sessions
   cannot reach these sites. The session picks the search provider, writes the choice and its price in `docs/DECISIONS.md`
   and the secret name it needs in `docs/history/HANDOFF_sessions_2026-11-13_14.md` (or `docs/log/`). Until the founder adds that secret, only Open Food Facts runs.
3. A vision check (the fast model) keeps a candidate only if all of these are true: same brand, product and size as the
   catalog item; one pack on a plain background; at least 800 pixels wide; no watermark, overlaid text, price tag or shop logo.
4. Licence. Every candidate keeps its source address and licence. Open Food Facts pictures are CC BY-SA: keep the
   attribution. A picture from the brand's own site is usable. A picture from search results or another shop is "licence
   unknown": it may guide the intake photo but is never shown to customers until the lawyer's line (5.11) allows it.
5. The best usable candidate is resized (longest side 1200 px, under 300 KB), saved to the private `media` bucket with its
   source and licence, status `proposed`.
6. Review: task 3.18 (session D1) adds the console page that shows the item and the picture side by side; a person
   approves or rejects each one. Until it exists, pictures wait as `proposed`.
7. Only approved pictures leave the database: one SQL function returns an item's picture only when it is approved, as a
   short-lived signed link. Customers may see pictures only inside allowed message types (the image header of an
   interactive message) and later on the website. Never add `image` to the gateway allowlist (invariant 2). Using the
   picture in messages is a later Ordering-lane task; P1 only provides the function.
8. Items with no usable picture go on the "photograph at intake" list (5.15); the intake photo goes through the same approval.

Expect local brands to fail more often.

Done when: every catalog item is either approved or on the "photograph at intake" list, and a test shows the customer-side
function never returns a proposed, rejected or licence-unknown picture.

## Hub and zones

The hub is not final. Nothing in the code may assume it is.
- Villages, their zone, and each zone's fee and ETA are rows in `villages` and `zones`, loaded from `supabase/seed/villages.sql`. That seed is a draft built around the Baakline-Baqaata corridor.
- The hub's village is the `village_id` of the dark-store row in `sources`. Travel times in `travel_times` are ring estimates until 5.6 runs.
- Changing the hub means: set the dark store's village, re-run 5.6, review zone membership and fees (3.9). No migration.
- Do not hard-code a village, a fee or a hub coordinate in TypeScript or in a prompt.

## Phase 6: shadow run

Staff, family and friends place real orders with real money and real riders inside the pilot zone.
- At least 7 days and 100 orders; longer if any day fails to close clean.
- The day-close report is reviewed every night; any unexplained balance is traced before the next day.
- Once each, on purpose: no answer at the door, a missing item, a wrong-amount transfer, a rider losing signal, a worker restart mid-order, a customer paying fully in lira.

Exit gate, all together: zero unexplained balance every day; no lost or unanswered customer message; no exception older than a day; each deliberate failure handled and reconciled.

## Phase 7: paid pilot

Paying customers in the pilot zone, invite-first, limited hours, groceries only until a restaurant is live.
Entry condition: the WhatsApp catalog (1.21) is live on staging.
- Watch weekly: orders per day, repeat customers, cards correct without help, on-time deliveries, failed deliveries, rider earnings per hour, contribution per order against `docs/COST_MODEL.md`, day-close balance.
- Stop and fix if: an unexplained balance cannot be traced within a day, an order is lost, rider earnings fall to a level riders will not stay at, or failed deliveries keep rising.
- Widen when four straight weeks close clean: hours, then villages, then restaurants. One at a time.

## Phase 8: restaurants

The goal is every restaurant in Chouf. Coverage grows only through signed partners: accepted terms, an approved menu with
prices, a contracted commission (5 to 10% in Chouf). `approve_merchant()` is the only way a restaurant becomes orderable.
Starts the day the first partner signs; it does not wait for the pilot to end.

| # | Task | Notes |
| --- | --- | --- |
| 8.1 | Onboarding pack (founder) | Terms, commission, prep-time promise, who pays for a cancelled cooked order, weekly settlement. |
| 8.2 | Menu in | From a link, PDF or photo via `packages/agents/src/menu-fetch.ts`; ops approves in 3.10. Nightly re-check from `source_integrations`. |
| 8.3 | Kitchen flow on the ops line | Order card to the restaurant with accept, busy and ready buttons and a prep time; `pushWithFallback` in `packages/core/src/merchant-channel.ts`. |
| 8.4 | Rider timed to the kitchen | Offer the job when the kitchen accepts, timed to prep, hot food picked up last. |
| 8.5 | Restaurant controls by WhatsApp | Item off and prep time apply at once; prices and new dishes need ops approval. Free-text restaurant messages go to the Ops Copilot. |
| 8.6 | Mixed orders | One delivery fee, hub goods loaded first, batching within the 5-minute detour limit. |
| 8.7 | Weekly merchant statement and settlement | From the ledger: orders, commission, owed, paid. `merchant_payable:<source>` must reach zero at settlement. |
| 8.8 | Restaurant cancellation and failed-delivery rules | Who bears a cooked, undelivered order; already charged to the customer's next order by `rider_no_answer`. |
| 8.9 | Coverage tracking | The request log from 1.2 ranks unsigned restaurants by demand; report it weekly. |
| 8.10 | Acceptance test | A restaurant order from card to settlement on the real schema: commission to revenue, net to the merchant, fee to the rider, ledger at zero. |
| 8.11 | Merchant declarations at onboarding | A short form per restaurant and per dish: contains (meat, poultry, dairy, eggs, fish, shellfish, pork, alcohol), allergens, halal evidence with certificate upload, shared fryers. Stored as food facts with status. A stated allergy reaches the kitchen as an alert it must acknowledge before accepting. |
| 8.12 | Neutral ranking | One SQL ranking function, in this order: available now; passes every stated restriction (unknown fails); relevance and the customer's own history; then at most one clearly labelled paid slot, off by default. No quality scores. |
| 8.13 | Prospect pipeline | Stages kept in the prospect sheet until there are more than about 30 live conversations: research lead, verified, contact permitted, interested, negotiating, signed, onboarding, approved. Only then a `merchant_prospects` table. Onboarding is staff-assisted; ~~there is no public "claim your business" page~~ **Superseded 17 Nov (LV1, `docs/DECISIONS.md`, "Listings before they sign"):** unsigned places are listed (name, kind, village, distance, map link; never orderable) and an owner can claim one by sending "Claim <listing_id>" on the customer line; that opens a staff case and verification stays a person's (the owner's own message or a visit). What follows a verified claim is Phase 8. |
| 8.14 | Restaurant stamp card (optional, restaurant-funded) | One template: N paid orders at this restaurant earns one named item, funded by the restaurant, redeemable only there. Commission is charged on what the customer pays. Built only after ten restaurants are live and two ask for it. |
| 8.15 | Group order, first version | One restaurant, one address, one delivery window, one organiser who pays. The organiser gets a link that opens our WhatsApp number with a join code; each person joins from their own private chat, so nobody is messaged who did not message us and no WhatsApp group is used. Each person adds and confirms their own items and sees only their own; the organiser sees every name and item. At the deadline the basket locks, is re-quoted for price and availability, and only the organiser's tap confirms it. One delivery fee, one payment, one kitchen ticket with a name on each meal. The organiser may cancel until the kitchen accepts; refunds go to the organiser. A group nobody submits expires 30 minutes after its deadline. Codes are random, expire, and cap at 15 people. Starts when five restaurants are live and 2.8 is done. Design notes in `docs/DECISIONS.md`. |

## Phase 9: pay-by-link, card checkout and diaspora orders (after the pilot)

Superseded in part: the 12 November decision "WhatsApp-first, no storefront before the pilot" was replaced on 14 November (C4): a cash-only
website exists at launch (WEB1, WEB2, built) and is restyled to the founder's reference (18 November). What stays gated is **card payment**:
it starts when both gates are met: four clean pilot weeks, and a signed contract with a card gateway that settles to
the company in usable dollars. Rows 9.0, 9.3, 9.4 and 9.5 below are built as the website (WEB1, WEB2); 9.1, 9.2, 9.6 and 9.7 are the card parts. One backend, one ledger, one order state machine: the website is another client of the
same SQL functions, never a second system.

| # | Task | Notes |
| --- | --- | --- |
| 9.0 | One-page site | What Alo King is, where it delivers, a button that opens WhatsApp. May be done any time after Phase 4. No catalog, no checkout. |
| 9.1 | Buyer and recipient | An order can have a payer who is not the receiver: recipient name, phone and place on the order; a gift flag; updates go to the buyer. The recipient is never added to marketing, and the buyer's saved preferences are never applied to the recipient. The rider phones the recipient; we do not send WhatsApp templates to a person who never messaged us. |
| 9.2 | Pay by link | A hosted payment page from the gateway (we never see card data), sent in the chat. Webhook verified and idempotent on the gateway reference; a processor-fee account in the ledger; refunds through the gateway. This alone serves a buyer abroad ordering over WhatsApp. |
| 9.3 | Read-only storefront | Server-rendered, Arabic (right-to-left) and English, from the same catalog and food facts; cached; every page links to WhatsApp. Only pages with real, maintained content. |
| 9.4 | Web checkout | The cart is a server-side draft order. Price, fee, stock and slot are re-checked by `quote_order` at checkout. Guest checkout with phone verification; the phone links web and WhatsApp identities. |
| 9.5 | Order tracking link | A signed, expiring link; shows status only, no address or phone. |
| 9.6 | Fraud rules for cards | First-order limits, velocity limits, manual review above a threshold, delivery only to served villages, chargeback procedure. |
| 9.7 | Acceptance test | A card-paid gift order from abroad: payment webhook twice, rider fee and tip to the rider, processor fee recorded, refund of one item, ledger at zero. |

## Later, each with the trigger that brings it forward

| Item | Trigger |
| --- | --- |
| Rider web app | More than about 10 riders, or ops-line message costs become material |
| POS or Deliverect link (adapters exist) | A partner doing 15+ of our orders a day asks for it |
| Per-market settings in functions, nearest-hub lookup (schema exists) | Chouf holds 60+ orders a day for a month |
| Second city | The above, plus one WhatsApp number per market |
| Rider minimum guarantee (`settings.rider_pay`) | Rider earnings per hour too low to keep riders |
| Supplier-funded promotions and featured products | About 100 orders a day and sell-out data to show suppliers |
| Scheduled and recurring orders for businesses | After the pilot; needs invoices and terms |
| Calculated nutrition from recipes (ingredients, weights, versions) | A signed merchant asks for it and supplies weighed recipes; results always labelled estimates |
| Sponsored placement (one labelled slot, flat fee) | Enough signed restaurants that customers browse; uses the ranking order in 8.12 |
| Promotional broadcasts | Not on the customer number. See "Marketing and the customer number" |
| Co-funded click-to-WhatsApp ads | Several signed restaurants; referral capture from 1.13 |
| Demand forecasting and learned ETAs beyond rolling averages | Simple averages measurably worse on real data |
| Customer stamp card: every 10th paid order earns one delivery paid by Alo King to the rider | Four clean pilot weeks with repeat rate and contribution per order measured. Counted and redeemed by SQL functions; the Concierge only reads the count |
| Referral: the friend's first delivery and one delivery for the referrer, after the friend's first paid order | Same trigger. The friend must message us first; nobody is messaged because they were referred |
| Catalog feed for outside AI assistants (UCP or ACP) | The website catalog exists (9.3) and a hosted card gateway is live. Read-only discovery first; any purchase still ends in our own confirmation step |
| Shared family basket (several family members add to one hub order) | Group order (8.15) is live and customers ask; it is the same mechanism pointed at the hub |
| Office lunch club (a group order that repeats on set days) | Three workplaces have each used group order four times |
| Shopping list for a gathering ("barbecue for ten"): the Concierge proposes a basket from the catalog, the customer edits it | After the pilot; quantities are suggestions the customer confirms line by line, never facts |
| Multi-restaurant group orders; each person paying separately | Demand shown by 8.15, and a card gateway live (card checkout, Phase 9) |
| Fixed delivery rounds to far villages (a set time each day) | A village too far for on-demand fees to pay a rider; needs scheduled orders (2.8) |
| Meal-photo calorie estimates | Rejected. Not an ordering feature, and a photo cannot show weight, oil or hidden ingredients |
| Merchant subscriptions, delivery pass, native apps | Not planned |
| Marketing campaigns | Repeat rate measured in the pilot |
| Model-written daily digest | The day-close report has run a month and ops wants more |
| More AI agents | Not planned. Only for a job the current ones measurably fail at |

### Running sessions side by side

1. One git worktree and one branch per session: `git worktree add ../ak-B1 -b B1`. Never two sessions in one folder.
2. A session edits only the files its row owns. If it needs a change elsewhere, it writes the request in its pull request and stops.
3. Migration numbers are reserved per session in the table. Gaps are fine. A session never edits another session's migration or any applied one.
4. Until production exists, staging is disposable: after each merge run `supabase db reset` on staging so migrations apply in number order.
5. Merge one pull request at a time. The next one rebases, re-runs `npx tsc --noEmit` and `npx vitest run`, then merges.
6. If a session's context grows stale (it forgets rules or repeats work), commit, start a fresh session on the same branch, and tell it which tasks are done.
7. Parallel sessions are for separate lanes only. Never run two sessions in the same lane at once.

## How to work

1. Read `CLAUDE.md`, then `docs/STATUS.md` and `docs/RULES.md` in full.
2. One bundle per session, as in the table above. One commit per task, one pull request per session.
3. Tests first, on the real schema. Anything touching stock, cash or the ledger asserts the ledger sums to zero.
4. Migrations are append-only.
5. Green before done: `npx tsc --noEmit`, `npx vitest run` (CI is the record of the run; `TEST_REPORT.txt` no longer exists).
6. Label every finished task built, tested, or proven live. Only proven live counts toward launch. Write your report to `docs/log/<session>.md` and update `docs/STATUS.md` where its facts changed.
7. If the plan is wrong, change this file in the same pull request and say so.
8. If a session cannot make its tests pass after two honest attempts at a task, stop, write down what was tried, and restart that task one model up.

## Founder inputs and when they are needed

| Input | Needed by |
| --- | --- |
| Accounts budget (about USD 83 a month at launch) and who holds the logins | Phase 0 |
| Named ops lead and picker; daily exchange-rate owner | Phase 3 |
| Company documents for Meta verification; the two +961 numbers | Phase 4 |
| Hub location; opening assortment, costs, prices, count; pilot zone and fees; riders and their terms; retention policy | Phase 5 |
| Lawyer's read of the rider shortfall policy | Before Phase 7 |
| Restaurant terms template; first signed partners. Start the conversations during the pilot or earlier | Phase 8 |
| Who owns the GitHub organisation; approval to create the Supabase staging project and the Cloudflare paid plan; a payment method on the Meta WhatsApp account | Phase 0 |
| A card gateway that accepts the company and settles in usable dollars (apply to two) | Before card checkout (Phase 9) |

## Sessions still open (18 November 2026)
Finished sessions (SP1 to WH1a, B1e, QA1, DOC2) are in `docs/STATUS.md`, "Sessions", with a link to each report in `docs/log/`. Prompts, models and "done when" for these rows: `docs/NEXT_SESSIONS.md`, "Sessions still to run". At most three at once.

| Wave | Session | Waits for | Migrations | State |
|---|---|---|---|---|
| 4 | FD1 friends' test food: places and menus | DS2 | 0245 to 0247 | **Done** 18 November (`docs/log/FD1.md`); 0248 unused |
| 4 | FD2 friends' test food: ordering for testers (quote, card, the rider buys at the counter, ledger) | FD1 | Next free number | Not started |
| 4 | T1 friends' test set-up | The critical path in `docs/STATUS.md` | 0134 | Waits for gate A's approvals, label day and stock |
| 4 | WEB4a (was DS3) the website to the reference: stage 1 the frame and home, stage 2 aisles, an aisle, product, search | Stage 2 waits for the founder's reply on stage 1 | 0243 | Stage 1 merged, waiting for the founder (`docs/log/web4a.md`) |
| 5 | L1 event log, timeline, measured times, places | Gate A open | 0149 to 0152 | Not started |
| 5 | N2 nightly checks and learning | COST1 (merged) | 0186 | Not started |
| 6 | RD1 rider pack | L1 | 0160 to 0163 | Not started |
| 6 | AN1 reports and the daily summary | L1 | 0164 to 0166 | Not started |
| 6 | BK1 list photo to basket | SR1 (merged); gate A open | 0195 to 0197 | Not started |
| 7 | PAY1 payment core and adapters | CX1 (merged) | 0167 to 0171 | Not started |
| 7 | RCPT1 receipts and lira display | CX1 (merged) | 0172 to 0173 | Not started |
| 7 | AUD1 audit of what the planning chat could not reach | Nothing | 0176 to 0177 | Not started |
| 8 | SH1 Send Home | PAY1 | 0174 to 0175 | Not started |
| 8 | OPS2 runbooks | RD1, WH1a (built) | None | Not started |
| 8 | A3 production environment | AUD1, BK0 (built); the domain | None | Not started |
| 9 | G2 audit before the pilot | Gate B passed | None | Not started |
| 9 | V1 voice provider scoring | The 51 corrected notes | None | Not started |
| 9 | AN1b founder assistant | AN1 | 0182 | Not started |
| 9 | WH1b warehouse, second part | Two weeks of shadow or pilot data | 0183 to 0185 | Not started |
| 9 | RET1 retention | The lawyer's periods | 0181 | Not started |
| After gate B | WEB3 the assistant on the website | WEB2 (merged); gate B | 0219 to 0220 | Not started |
| Later | LOY1; E1 to E3 vendors | Four clean pilot weeks; a signed vendor | | Each opens on its own gate |
| Last | PRIV make the repository private | The build finished | | Not started; last step |

Gates A, B and C and the rules every session follows are in `docs/NEXT_SESSIONS.md`.
