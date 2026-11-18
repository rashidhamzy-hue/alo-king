<!-- Moved from docs/BUILD_PLAN.md on 18 November 2026 by session DOC2. The text below is unchanged. -->

## Build sessions

Thirteen Claude Code sessions take the project to the shadow run, plus two audits. Up to three run at the same time.
Each session is one bundle of tasks, one branch, one pull request, with one commit per task.

| Session | Lane | Model | Tasks | Can start when | Owns these files |
| --- | --- | --- | --- | --- | --- |
| A1 | Infra | Sonnet 5.5 | 0.1 to 0.12 | Day one | `.github/`, `wrangler.jsonc`, `docs/RUNBOOK.md`, `test/fixtures/` |
| B1 | Ordering | Opus 5.5 | 1.1, 1.2, 1.3, 1.9, 1.15, 1.19, 1.20 | The repository exists and CI is green (0.1, 0.2) | `apps/gateway/src/turn.ts`, `packages/agents/`, `prompts/`, `evals/`, migrations 0013-0019 (B1 used 0013-0017; lane B overflow: 0052-0059) |
| C1 | Hub | Opus 5.5 | 1.11, 1.12, 2.6, 2.7, 2.11 | Same as B1; runs beside it | migrations 0020-0029, their tests (C1 used 0020-0025) |
| A2 | Infra | Opus 5.5 | 0.13, 4.1, 4.3, 4.5, 4.6, 4.10, 4.12, 4.13 | A1 and B1 merged | `apps/gateway/src/index.ts`, `packages/wa/`, migrations 0060-0069 (A2 used 0060-0063; the table had no range for lane A, so A2 took the next free block), `test/pg/`, `scripts/staging/` |
| B2 | Ordering | Opus 5.5 | 1.4, 1.5, 1.6, 1.10, 1.14, 1.16, 1.18 | B1 merged | as B1 |
| C2 | Hub | Opus 5.5 | 2.1, 2.2, 2.3, 2.4, 2.5, 2.10 | C1 merged; runs beside B2 | `apps/gateway/src/ops-turn.ts`, migrations 0030-0039 (C2 used 0030-0035) |
| D1 | Console | Opus 5.5 for 3.1, then Sonnet 5.5 | 3.1 to 3.10, 3.18 | C1 merged; runs beside B2 and C2 | `apps/console/` (new) |
| B3 | Ordering | Opus 5.5 | 1.22 first, then 1.7, 1.8, 1.13, 1.17, 2.9 | B2 merged | as B1, plus `.github/workflows/language-pack.yml` (new); migrations 0053-0059 |
| B4 | Ordering | Opus 5.5 | First, the live findings of 13 Nov (founder's own order, 18:43-18:58 UTC, in HANDOFF): after the address the bot asked him to send the whole order again (the basket was lost); the pin he sent was in Khraibeh but the bot said Baakline (the village must come from the pin, or the bot asks); "حي راجح" in a voice note is a neighbourhood, not a village; and the card never came. Each becomes an eval or flow test before its fix. Then the 1.22 zero-wrong gate (the four phrasings B3 left), 1.23, and the lane B requests in HANDOFF: `quote_order` refuses while the exchange-rate pause is on (D1); customer credit shown and applied on the card (C2); `learn_from_order` ignores removed or replaced lines (C2); wire the typing indicator and the feedback cron in `index.ts` (B3); the staging probe releases its own handoff (B3) | B3 merged. Never beside K1 | as B1, plus the two wiring lines in `apps/gateway/src/index.ts` and the probe module in `packages/wa/`; migrations 0074-0079 |
| C3 | Hub | Opus 5.5 | 2.8, plus: start from 0035's `dispatch_order` (C2); `recall_orders` counts only lines that left the hub (C2); wire the rider voice reply in `ops-turn.ts` (B3) | B2 and C2 merged | migrations 0040-0044 (C3 used 0040-0043), `order-card.ts`, `dispatch_order` |
| K1 | Catalog | Opus 5.5 | First the lane B leftovers B4 recorded in HANDOFF (an order sent after closing time loses its items and the pin gets a greeting; the order note repeats the floor; the two older live eval cases), each as a test first; then 1.21, using the approved category list in `data/proposals/categories.json` | B4 merged. Edits `turn.ts`, so never beside lane B | the feed endpoint (new file), the cart-order branch in `apps/gateway/src/turn.ts`, migrations 0051 and 0085-0089, its tests, the 1.21 steps in `docs/RUNBOOK.md` |
| D2 | Console | Opus 5.5 | 3.11 to 3.17, 5.15, plus: move D1's `apps/console/sql/proposed_functions.sql` into a migration; `confirm_cash_drop` and `resolve_ops_exception` check who is acting (D1); the refunds page on `refund_order` and `pay_out_credit` (C2); the 1.23 review list page | D1 and C2 merged; runs beside B3 and C3 | `apps/console/`, migrations 0045-0049 |
| D3 | Console | Sonnet 5.5 | The D2 leftovers in HANDOFF: the 1.23 review-list page (B4 has merged its table); the console workflow sets `ANTHROPIC_API_KEY` as a console Worker secret so intake can read label photos; `pay_supplier` and cash `pay_out_credit` refuse to take the drawer below zero | D2 merged. Runs beside K1 and C3 | `apps/console/`, `.github/workflows/console.yml`, migrations 0080-0084 |
| P1 | Pictures | Sonnet 5.5 | 5.17 (steps 1-5, 7, 8; the review page is 3.18 in D1) | Now: A1 has merged. Runs beside any other lane. Must merge before K1 | `scripts/images/` (new), `.github/workflows/images.yml` (new), migration 0050, `test/db/product-images.test.ts` |
| P2 | Pictures and web data loader | Fable 5.2 | Founder decision of 14 Nov. Reads `data/research/*.json` (written by R1-R3) in GitHub Actions: downloads each candidate picture, runs P1's vision rules (exact product, one pack, plain background, no watermark, logo, price or text, 800 px or more), proposes the best one with licence `public_page`; proposes ingredients, allergens, nutrition, diet labels, storage and origin as facts with source `web_page`, status partial, each with its page address. Nothing is approved by code | Now, beside any lane | `scripts/images/`, `scripts/product-data/`, `.github/workflows/images.yml`, `.github/workflows/research-load.yml` (new), migrations 0070-0072 |
| R1, R2, R3 | Research | Fable 5.2 | Web research per item, by the rules in `data/research/README.md`. R1: AK-0001 to AK-0097; R2: AK-0098 to AK-0194; R3: AK-0195 to AK-0291 | Now, in parallel | only `data/research/AK-*.json` in its own range |
| N1 | Product data | Sonnet 5.5 | 5.18 | Now; runs beside any lane. Uses the Anthropic credit before 17 Nov | `scripts/product-data/` (new), `.github/workflows/product-data.yml` (new), `data/proposals/` (new), migration 0073 |
| A4 | Infra | Opus 5.5 | `docs/AUDIT-2026-11-14.md` items 1, 2, 3 (measure), 6, 8, 11 | Now; runs beside K1, C3, D3 | `apps/gateway/src/index.ts`, `packages/wa/`, `.github/`, templates, migrations 0090-0094 |
| V1 | Voice | Sonnet 5.5 | 5.8 prepared: draft transcripts and the order in each of the 51 real notes for a person to correct, then score both speech providers. Audio never enters the repo | The founder adds the notes to the private `media` bucket (steps written by A4 in the runbook). Before 17 Nov if possible | `scripts/voice-eval/` (new), `.github/workflows/voice-eval.yml` (new) |
| G1 | Audit | Fable 5.2 | Read every migration and test; try to break money, permissions, recovery and the send path | Everything above merged | Findings only; fixes go to Opus |
| A3 | Infra | Sonnet 5.5 | 4.2, 4.4, 4.7, 4.8, 4.9, 4.11 | The +961 numbers and production accounts exist | production configuration |
| Phase 6 | | | Shadow run, by people | G1 findings closed | |
| G2 | Audit | Fable 5.2 | Same audit, on production settings | Before Phase 7 | |
| E1, E2 | Restaurants | Opus 5.5 | 8.2 to 8.12; then 8.13 to 8.15 | The first restaurant signs | Phase 8 |
| F1, F2 | Website | Opus 5.5, Sonnet 5.5 | 9.1, 9.2, 9.6, 9.7; then 9.0, 9.3, 9.4, 9.5 | Phase 9 gates | Phase 9 |

Phase 5 is founder and team work, not sessions. It starts now.


## S1 revision, 14 November 2026: gap matrix, task classes, next sessions

Sources: `docs/SYSTEM_BRIEF.md` (the founder's brief), `docs/AUDIT-G1.md`, `docs/SYSTEM_PLAN.md`, `docs/WEBSITE.md`, `docs/CONSOLE.md`,
`docs/COST_MODEL.md`, `docs/RESEARCH_REGISTER.md`, and the conflict register in `docs/DECISIONS.md`. Prompts: `docs/NEXT_SESSIONS.md`.

Classes: **A** must work at launch. **B** designed now, switched on after evidence. **C** piloted after a benchmark.
**D** rejected or deferred, with the reason.

### Gap matrix (what exists against the plan)
| Area | Exists today | Gap | Class | Session |
| --- | --- | --- | --- | --- |
| Reply speed | Measured: typed reply p50 15.9 s | 6 s buffer, pre-turn calls, the ask path; target most typed orders under 10 s | A | SP1 |
| Money defects | Ledger balances; staging clean | G1-01 to G1-09: COD tolerance, drawer below zero, damaged note, late and over payments, role checks | A | F1 |
| Database hardening | No client role reaches anything | 322 functions without a fixed `search_path`; explicit role and line check in `can_send` | A | F1 |
| Customer picks a delivery window | Database and card (2.8) | The customer turn does not offer or read windows; `quote_order` for scheduled orders | A | W1 |
| Names, readiness, windows pages | 21 console page modules | Names review, product readiness, windows and calendar, the basis of each food fact shown, an action log table | A | D4 |
| Pick queue and rider incidents on the console | SQL exists (C2) | Pages | A | D4b |
| Catalog live | Feed, lists, carts in code | Feed password in the deploy, public picture bucket, Meta steps (founder), approved pictures | A | A5 + founder |
| Infra leftovers | Alarms, meter, cost views | Supabase usage check, media host allowlist, outbox mark alert, typing call behind `packages/wa` | A | A5 |
| Message design | Cards and fixed strings | One template file per language, the nine rules as a test, snapshots, templates for code-started messages, the lira answer | A | M1 |
| Product intake as a pipeline | One-off scripts and review pages | A per-item queue through the API, readiness, name proposals in the database | A | I1 |
| Automatic approval | None | Rules table, log, spot check (ships switched off: C6) | B | I1 |
| Commerce core for every channel | SQL functions | `packages/commerce`, channel and request key on orders, web sessions, carts, the `web_channel` role | A | C4 |
| Friends' test | Staging probe | Tester list, script, feedback as cases, privacy line | A | T1 |
| Website, read side | None | Home, category, product, search | A | WEB1 |
| Website, ordering | None | Cart, checkout with cash, tracking, history, account | A | WEB2 |
| Console as a cockpit | Plain pages | Shell, installable, push, Today as an exception inbox, orders page (built, D5, 15 Nov) | A | D5 |
| Places and delivery learning | `landmarks`, saved places, the pin decides | Place names, landmark proposals, the order timeline, time statistics, rider door notes | A (list), B (learned ETAs) | L1 |
| Nightly learning and evals | Language-pack workflow by hand | Nightly smoke eval, weekly full run, collectors, the "learned today" note | A (evals), B (collectors) | N2 |
| Daily summary and reports | Day close, margin, demand views | Daily summary, weekly report, costs and customer pages | A | AN1 |
| Founder assistant | None | Read-only chat over the reports (C3 approved 14 Nov; runs after AN1; migrations 0198-0199) | B | AN1b |
| Warehouse | Stock, receiving, expiry date, counts | Lots, FEFO, bins, cycle counts, reorder proposals | B | WH1 |
| Scan to pick | None | Phone-camera scanning in the console | C (benchmark: pick time and error rate with and without) | WH1 |
| Supplier invoice reading | Receiving form | Photo, proposed lines, new-item intake | B | WH1 |
| Basket builder | None | Portion rules, proposal, eval cases (C9) | B | BK1 |
| Whish Pay at checkout | Screenshot confirmed by a person | Payment intents, webhook, adapter | B (needs a merchant account) | PAY1 |
| Card payments, send home | None | Card gateway adapter, buyer and recipient, fraud rules | C (needs a signed gateway) | PAY2 |
| Vendors: menus with options, kitchen flow, notifications, settlement | Shapes only | Phase 8 as planned, plus options, escalation, statements | B (first signed vendor) | E1 |
| Vendor-operated delivery, couriers | None | Delivery-provider model (C2) | B | E2 |
| Combined orders | Fulfilments per source | Stop order, fee add-on, partial failure (C5) | B (evidence: 10% of customers ask for both) | E3 |
| Vendor commands by message | None | Proposed change, confirm, undo | B | E2 |
| Loyalty and referrals | Referral codes captured | Stamp card, referral reward (C7) | B (four clean pilot weeks) | LOY1 |
| Markets | Schema only | Functions read per-market settings | B (60 orders a day for a month) | MK1 |
| Production, +961 numbers, recovery, retention job, routines | Runbook, staging | As 4.2, 4.8, 4.9, 5.9, 5.13 | A, blocked on company papers | A3 |
| Voice evaluation | Runbook steps | Score four providers on the 51 notes | A, blocked on the upload | V1 |
| Repo hygiene | CI, secret scan | A cleanup pass after each wave | A | H1 |
| Live rider position for customers | None | After rider consent | B | WEB3 |
| The web assistant | None | The Concierge on the website | D for now: after the pilot proves the WhatsApp Concierge |
| Eight separate planning documents and a nine-region competitor survey | - | - | D: rejected by the brief itself (documents instead of progress) |
| Native apps, delivery pass, merchant subscriptions | - | - | D: not planned (unchanged) |
| OMT at checkout | Screenshot | - | D until OMT confirms a merchant API in writing |

### Sessions, in run order
At most three at a time. A session edits only the files in its row. Migration numbers are reserved; gaps are fine. `deploy-staging`
applies with `--include-all`, so merge order does not matter on staging; a fresh reset applies by number, which is why two
sessions never redefine the same function out of number order. Model: Opus for money, ordering and security; Sonnet for
mechanical work; Fable only for audits.

| # | Session | Model | Does | Owns | Migrations | Waits for | May run beside | Done when (tests) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **SP1** Reply speed | Opus 5.5 | A4's three causes: the burst buffer, the pre-turn calls, the ask path; reply keys by content (G1-19); a retried turn reuses its draft (G1-21) | `apps/gateway/src/index.ts` (the conversation object only), `apps/gateway/src/turn.ts`, `packages/agents/src/concierge.ts`, `pipeline.ts`, `evals/` | 0100-0102 | nothing | F1, D4 | A single complete text starts its turn within 1.5 s (test on the conversation object); one database call before the model; the language-pack gate still met (F1 at least 0.90, zero wrong, the demo message right); `turn_waits` on staging shows typed replies at p50 under 10 s over at least 20 probe turns |
| 2 | **F1** G1 fixes | Opus 5.5 | G1-01 to G1-09, G1-11, G1-25, the late-payment queue, a test that bans Nutri-Score-type fields | `test/db/`, `scripts/check_permissions.sh`, `apps/console/src/pages/payments.ts` and `riders.ts` only | 0103-0109 | nothing | SP1, D4 | Each finding has a failing test first; the drawer cannot go below zero by any function; a late transfer becomes customer credit; ledger at zero in every test; the advisor shows no function without a `search_path` |
| 3 | **D4** Review pages | Sonnet 5.5 | Names review, product readiness, windows and calendar, basis of each proposed fact shown, `staff_actions` table (G1-16) | `apps/console/` except `payments.ts` and `riders.ts` | 0110-0114 | nothing | SP1, F1 | The 282 names load, approve, correct, reject; approving a name queues its search words; readiness distinguishes "blocks the catalog" from "blocks ordering"; a window entered on the page is offered by `open_delivery_windows`; `sign-in.test.ts` no longer depends on the clock |
| 4 | **W1** Windows for customers | Opus 5.5 | C3's seven requests: offer windows, read the list tap, slot full or closed, changes, `quote_order` for scheduled orders, status answer, eval cases | `apps/gateway/src/turn.ts`, `packages/agents/`, `evals/` | 0118-0119 | SP1 | A5, R4, H1 | A customer picks a window by tap and by words ("بكرا الصبح"); a full window is never offered; a scheduled order can be carded after hours; the acceptance test "a full slot refuses a scheduled order" still passes |
| 5 | **A5** Infra | Sonnet 5.5 | Feed password in the deploy; public `catalog` bucket for approved pictures; weekly Supabase usage check; media host allowlist; typing call into `packages/wa`; alert on a send that could not be marked; the webhook line check; prove 1.23 on staging with one test product; run research-load and record coverage | `.github/`, `wrangler.jsonc`, `packages/wa/`, `apps/gateway/src/index.ts` (not the conversation object), `apps/gateway/src/catalog-feed.ts`, `scripts/ci/` | 0115-0117 | SP1 (shares `index.ts`) | W1, R4, H1 | The feed serves stable public picture addresses and only approved pictures; withdrawing a picture removes the public copy; the usage workflow fails above 70% of a limit; a non-Kapso media host is refused |
| 6 | **R4** Research remainder | Sonnet 5.5 | The eight unchecked items of RESEARCH_REGISTER | `docs/RESEARCH_REGISTER.md` | none | nothing | anything | Each item has official sources, a date, facts apart from assumptions |
| 7 | **H1** Repo hygiene | Sonnet 5.5 | The cleanup list in SYSTEM_PLAN 18; repeat after every wave | deletions, `docs/history/`, `docs/HANDOFF.md` | none | wave 1 merged | W1, A5 | CI green; HANDOFF Status under 200 lines; nothing loaded and approved left in `data/` |
| 8 | **M1** Message design | Opus 5.5 | SYSTEM_PLAN 14; utility templates for code-started messages (G1-23); the lira answer | `packages/agents/src/messages/` (new), `order-card.ts`, `answers.ts`, the fixed strings in `turn.ts` and `ops-turn.ts`, `templates/` | 0120-0121, 0133 (in C4's range, which C4 left unused: the mixed-word planner fix, founder decision of 14 Nov) | W1 | I1, C4 | The rules test passes for every template in ar, en, fr; snapshots committed; no fixed message is written by the model; templates submitted |
| 9 | **I1** Intake pipeline | Opus 5.5 | Product intake queue, API research step, name proposals in the database, readiness function, automatic-approval rules (switched off), the automatic approvals page | `scripts/intake/` (new), `scripts/images/`, `scripts/product-data/`, `.github/workflows/intake.yml`, `apps/console/src/pages/autoapprovals.ts` (new) | 0122-0127 | D4, A5 | M1, C4 | A new product walks the eight steps with the network faked; no input auto-approves an allergen, a diet label or a price; a failed spot check disables the rule; the 291 items are enqueued once |
| 10 | **C4** Commerce core | Opus 5.5 | SYSTEM_PLAN 1, database and package only | `packages/commerce/` (new), `scripts/check_permissions.sh` | 0128-0132 (0133 left unused; M1 used it) | F1 | M1, I1 | One basket through chat, catalog cart and the commerce client gives the same quote and ledger; `web_channel` can call nothing else; a link code is single use; the agent still cannot confirm |
| 11 | **T1** Friends' test | Sonnet 5.5 | SYSTEM_PLAN 16 | `docs/TEST_SCRIPT.md`, `scripts/staging/`, `apps/console/src/pages/cases.ts` | 0134 | M1 | WEB1, D5 | A tester's order runs to closed with the test rider; a Beirut address gets the "not yet" line; a tester's note becomes a case |
| 12 | **WEB1** Website, read side | Sonnet 5.5 | Home, category, product, search; Arabic and English; installable shell | `apps/web/` (new), `.github/workflows/web.yml` | 0154-0155 | C4, A5 | T1, D5 | Pages render from the database with JavaScript off; no unapproved picture or fact; the same search results as chat; deployed to staging |
| 13 | **D5** Console cockpit | Sonnet 5.5 | Shell, installable, push, Today as an exception inbox, orders page (after the founder's yes to C8) | `apps/console/` | 0158-0159 | D4, F1, C8 | T1, WEB1 | Every existing page test passes unchanged; the service worker caches no personal data; one push per exception |
| 14 | **WEB2** Website, ordering | Opus 5.5 | Cart, checkout with cash, number check by WhatsApp code, tracking, history, account | `apps/web/`, the code branch in `apps/gateway/src/turn.ts` | 0156-0157 | WEB1, M1, T1 | L1, WH1 | The done-when of `docs/WEBSITE.md`; a confirm sent twice confirms once; an expired tracking link shows nothing |
| 15 | **L1** Places and delivery learning | Opus 5.5 | SYSTEM_PLAN 5 | `apps/gateway/src/ops-turn.ts`, `packages/agents/src/pipeline.ts` (address context only), console pages `landmarks.ts`, `eta.ts` (new) | 0135-0139 | M1 | WEB2, WH1 | A proposed landmark is invisible until approved; a landmark never changes the fee; no position outside a job |
| 16 | **WH1** Warehouse | Opus 5.5 | SYSTEM_PLAN 7 and the invoice pipeline | console pages `lots.ts`, `scan.ts`, `invoices.ts` (new) | 0140-0147 | F1, D5 | WEB2, L1 | FEFO; a wrong scan blocks ready; lots reconcile to stock and the inventory account; an invoice photo never moves stock |
| 17 | **N2** Nightly learning | Sonnet 5.5 | SYSTEM_PLAN 6 | `.github/workflows/nightly.yml`, `evals/`, console page `learned.ts` (new) | 0148-0150 | I1, L1 | AN1 | A wrong product in the nightly run opens an exception; learning writes proposals only |
| 18 | **AN1** Reports | Sonnet 5.5 | Daily summary, weekly report, costs, customers pages | new console pages | 0151-0153 | D5 | N2 | The daily summary equals the day close on the same day; the customers page shows only stated restrictions |
| 19 | **G2** Audit before the paid pilot | Fable 5.2 | The same audit on production settings | findings only | none | everything above, A3 | nothing | |
| 20 | **SP2** No reply | Opus 5.5 | The ask loop's no-reply turns (M1's finding, staging 14 Nov): a call cut at `max_tokens` (1024) before any tool, and `extract_order` then silence. Eval cases first; every order, question or address ends in a reply, a card or one clear question; a handoff alerts ops and shows in the console | `packages/agents/src/concierge.ts`, `pipeline.ts` if needed, the handoff path in `apps/gateway/src/turn.ts`, `evals/` (and its own flow test, `test/db/no-reply-sp2.test.ts`) | none (0200-0201 held, unused) | M1 merged | anything outside its files | A unit test per cause still sends a reply; three gate runs in a row with zero no-reply turns, F1 at least 0.90, zero wrong products, the demo right, live judged on the sent reply; after deploy, one typed order on the staging customer line gets its card |
| 21 | **SIM1** Simulated customers | Opus 5.5 | About 500 simulated customer conversations with the real Concierge on a throwaway database with a read-only copy of staging's catalogue, at most USD 33 of API credit before 17 Nov; a ranked failure report; every failure class becomes failing cases. Fixes nothing in product code | `evals/sim/**` (new), `.github/workflows/sim-test.yml` (new), `docs/SIM_REPORT_2026-11-15.md`, `evals/cases/sim_*.json`, its HANDOFF section and this row | none | SP2 merged | anything (touches no product file) | The workflow ran on main; at least 450 conversations judged; spend stated and at most USD 33; five seeds re-run give the same scripts; the report merged |

Gated sessions (start when the gate opens; prompts in `docs/NEXT_SESSIONS.md`): **V1** voice evaluation (the 51 notes uploaded);
**A3** production (company papers, +961 numbers); **PAY1** Whish Pay (a merchant account), 0160-0164; **PAY2** cards and send home
(a signed gateway); **E1, E2, E3** vendors, delivery providers, combined orders (the first signed vendor; C2 and C5 answered),
0165-0184; **LOY1** loyalty (four clean pilot weeks; C7), 0185-0189; **MK1** markets (60 orders a day for a month), 0190-0194;
**BK1** basket builder (C9), 0195-0197; **AN1b** founder assistant (C3 approved; runs after AN1), 0198-0199; **D4b** pick queue and rider incident pages (after D4,
Sonnet, no migration).

Waves: (1) SP1, F1, D4. (2) W1, A5, R4 then H1. (3) M1, I1, C4. (4) T1, WEB1, D5. (5) WEB2, L1, WH1. (6) N2, AN1, then AN1b, D4b. Then G2.
Phase 6 (the shadow run) starts when waves 1 to 4 are merged, the catalog is live, and the founder's Phase 5 data is in.

## Strategy revision, 15 November 2026: sessions from here to the paid pilot

Source: `docs/strategy/` (start with its `README.md`); the live prompts are in `docs/NEXT_SESSIONS.md`. Founder decisions of the day:
`docs/DECISIONS.md`, "Founder decisions, 15 November 2026". This section is the current roadmap and wins over every older section
above, including the S1 table: the S1 rows that have not run (T1, WEB2, L1, WH1, N2, AN1, AN1b, A3, G2, V1, PAY1, PAY2, E1 to E3,
LOY1, MK1, BK1, D4b) are replaced by the rows below, and the migration numbers S1 reserved for them are released. Numbers already
used on `main` stay used (0154, 0155, 0158, 0159).

Next work: the hand-off fix (HO1) runs first, ahead of T1. At most three sessions at once. Gates and stop conditions are in
`docs/NEXT_SESSIONS.md` ("Gates") and `docs/strategy/01-verdict-gates.md`.

| Wave | Session | Model, effort | Waits for | Migrations | Status |
|---|---|---|---|---|---|
| 0, now | DOC1 strategy into the repository | Sonnet, medium | Nothing | None | Done (this change) |
| 0 | PUB1 public-repository hygiene | Sonnet, medium | Nothing | None | Not started |
| 0 | BK0 free backups and restore check | Sonnet, medium | The founder's passphrase secret | None | Not started |
| 1 | HO1 never-stranded hand-off | Opus, high | SIM1's report merged | 0135 to 0137 (0138 unused) | Done: built, tested in CI, and sim-test run 43711132002 shows zero silences after a hand-off (`docs/HANDOFF.md`, HO1) |
| 1 | COST1 cost recorded, capped | Sonnet, medium | SIM1's report merged | 0139 | Built and tested (15 Nov); the live run of each workflow waits for 0139 on staging (`deploy-staging` from `main`) |
| 1 | OPS1 alerts that wake someone | Sonnet, high | Nothing | 0140 to 0142 | Built and tested (see HANDOFF, "OPS1"); founder actions listed there; live results recorded (merged 15 Nov as #73; the stuck probe orders closed and the next hourly probe order closed on its own) |
| 2 | B1a ordering fixes from SIM1, part 1 (report fixes 1, 3, 4, 9, 10 and the two no-reply turns; minimum order $5, no small-order fee at launch) | Opus, high | HO1 merged | None | Merged (#77, #79, #80). sim-test on main after #80 (43736730998): minimum loops 66 to 0 and lost baskets 11 to 0 (met); wrong products 34 (target 8, not met: the planner's generic and size picks need a migration, a kept overnight basket's counts, reading cases); passed 35 to 48; no new failure class (`docs/HANDOFF.md`, B1a) |
| 2 | B1b ordering fixes from SIM1, part 2 (report fixes 5, 6, 7, 8; a first order without a pin is accepted, marked for a rider call) | Opus, high | B1a merged | None | Done (#85, #87, 15 Nov); 150 simulated on main: address 1, language 0, message rules 2, off-topic 1: all targets met; see HANDOFF, B1b |
| 2 | B1c wrong products, part 3 (generic words and sizes, a kept basket's counts, same as last time, hz0815) | Opus, high | B1b merged | 0138 | Built (#91, #92, 15-16 Nov): language gate F1 0.915, wrong 0; 150 on main: wrong products 34 to 18 (target 8 **not met**), lost baskets 0; see HANDOFF, B1c |
| 2 | B1d counts and edits (a count against a pack's weight, «wa7de tene», a complaint is not an edit, a swap never doubles a line, out of stock never drops or adds, a picker that loops) | Opus, high | B1c and CX1 merged | 0217 reserved, not used | Built (#97, #101, 16 Nov): language gate F1 0.908 and 0.915, wrong 0, live 103 of 103; 150 on main twice: wrong products 21 and 30 (target 8 **not met**), message rules 0; see HANDOFF, B1d |
| 2 | DS1 design system and flagship screens (converts the founder's brief to `docs/DESIGN_BRIEF.md` first) | Fable, high | OPS1 and HO1 merged; the crown picture and the brief attached | None | **Built 15 Nov** (`docs/HANDOFF.md`, DS1): `packages/ui`, both galleries, the console's shell, Today, Inbox and Orders, the website's four pages. No crown picture came: an original mark was drawn and waits for the founder's approval. Figures and data with no source are listed there for AN1, WEB2 and UX2 |
| 2 | PIX pictures | Sonnet, medium | Nothing | None | Pipeline built and tested (public-page search hits, duplicate check, fastest-first, queue report); 20 of 291 candidates waiting and every other item has a named reason, because `BRAVE_SEARCH_API_KEY` is not set. Spend about USD 0.08. Founder actions in `docs/HANDOFF.md` (PIX) **PIX2 (15 Nov):** no search service; from-list mode and a fastest-first Pictures page built; 29 candidates wait, the 120-fastest target is not met (`docs/HANDOFF.md`, PIX2) |
| 3 | CX1 customer pack | Opus, high | B1b merged | 0143 to 0146 | **Built and merged 16 Nov** (#90, #94; `docs/HANDOFF.md`, CX1; language gate held, sim-test 43781701377 on main: no new failure class): welcome with the privacy line kept per customer; the card's missing-item and note choices, change kept as credit; self-service cancel until picking, the exact refundable amount after; a handover code for prepaid orders; pickup at the hub (off until the place is named: Founder actions); at most four code-started messages per order. Console forms for the code and a pickup handover wait for UX2 |
| 3 | D4b pick queue and rider jobs on the console | Sonnet, high | DS1 merged | 0147 to 0148 | **Built 16 Nov** (`docs/HANDOFF.md`, D4b): pick queue, rider jobs with "act for a rider", rider incidents; one order goes confirmed to closed on the console alone, with no staff-line message (`apps/console/test/d4b.test.ts`). Not proven on a phone or staging |
| 4 | T1 friends' test set-up | Opus, medium | Gate A: CX1, D4b, DS1 merged; pictures approved; Arabic read (T1 checks the list and stops if one is missing) | 0134 | **Waits for gate A** |
| 4 | WEB2 cart, checkout, tracking | Opus, high | CX1 merged | 0228 to 0230 (0178 to 0180 stay unused) | **Built 17 Nov** (`docs/HANDOFF.md`, WEB2): basket, sign-in by WhatsApp code, checkout, the card sent by the gateway and confirmed on WhatsApp, order page, history, account, How it works; every page under 100 KB cold |
| 4 | UX2 every remaining console page | Sonnet, high | DS1, D4b merged | None | **Split 17 Nov**: UX2a (Today, Inbox, Orders, Pick, Dispatch, Stock) **built 17 Nov** (`docs/HANDOFF.md`, UX2a; migration 0227, the picker's walking order; the Undo toast exists and is offered for pick marks only, the command bar jumps to an order by code); UX2b (Approve, Intake, Money, Settings, Riders) **built 17 Nov** (`docs/HANDOFF.md`, UX2b; migrations 0231 and 0232: the Settings write door with two-person rules, and written rider terms on file) |
| 4 | FX1 product facts by kind (food, drink, household, personal care, baby, pet; AI proposes, console approves; no food facts on non-food; unconfirmed facts collapse to "ask us on WhatsApp"; the chat says "doesn't apply") | Opus, medium | The founder restarts design; CX1 merged | Next free number | **Parked** (design pause, 15 Nov) |
| 5 | L1 event log, timeline, measured times, places | Opus, high | Gate A open | 0149 to 0152 | Not started |
| 5 | WH1a warehouse basics | Opus, high | D4b merged | **0236 to 0240** (the old reservation 0153, 0156, 0157, 0188, 0189 stays unused) | **Built 18 Nov** (`docs/HANDOFF.md`, WH1a; decisions in `docs/DECISIONS.md`, WH1a): purchase orders printed in Arabic and English; receiving against one (lot, expiry, short, damaged; stock enters only this way; the label day's list follows); lots and first-to-expire (an expired lot cannot be picked); bins in UX2a's walk; the chilled zone's temperature log by photo with staff alerts; the packing checklist kept. Not on staging or a phone yet |
| 5 | N2 nightly checks and learning | Sonnet, medium | COST1 merged | 0186 | Not started |
| 6 | RD1 rider pack | Opus, high | L1 merged | 0160 to 0163 | Not started |
| 6 | AN1 reports and the daily summary | Sonnet, high | L1, UX2 merged | 0164 to 0166 | Not started |
| 6 | UX3 join pages (riders and vendors; the Applicants tab) | Sonnet, high | DS2, UX2b merged | 0233 and 0234 | **Built 17 Nov** (`docs/HANDOFF.md`, UX3). Not built from the old row: the other website pages (how it works, ordering) stay WEB2's |
| 6 | QA1 the whole system on staging before the founder's own test | Opus, high | UX3 merged | None (0235 stays free) | **Done 17 Nov** (`docs/QA1.md`, `docs/HANDOFF.md`, QA1): every page at 390 px in Arabic and English, one order by WhatsApp text, website and voice note end to end, the cross-session rules and search on staging; fixed the `web` workflow (red since #109), the stalled hourly probe and the Settings page refusing every change on staging; language gate held (wrong 0, F1 0.916, USD 0.19); sim-test limit 50: 24 of 50, 0 silences (USD 1.05). Proposed: **B1e** (a line the reading drops; `docs/QA1.md` section 9) |
| 6 | B1e dropped and invented lines (QA1's proposal) | Opus, high | QA1 merged | 0235 (WH1a then used 0236 to 0240) | **Built 18 Nov** (`docs/HANDOFF.md`, B1e): a kind and a fact with no line get PD1's honest answer and a demand row in four languages; the restriction line in the customer's language, never about an order that does not exist; the output guard refuses an area claim no tool returned this turn (sim-021) and a reply in another language; UX3's Arabic as read (0235). Language gate held (wrong 0, F1 0.913, USD 0.20; live 102 of 103); sim-test limit 50: 29 of 50, 0 silences, 0 wrong-language replies (USD 1.13) |
| 7 | PAY1 payment core and adapters | Opus, high | CX1 merged (was WEB2; design pause, 15 Nov) | 0167 to 0171 | Not started |
| 7 | RCPT1 receipts and lira display | Sonnet, medium | CX1 merged | 0172 to 0173 | Not started |
| 7 | AUD1 audit of what the planning chat could not reach | Sonnet, high | Nothing | 0176 to 0177 | Not started |
| 8 | SH1 Send Home | Opus, medium | PAY1 merged | 0174 to 0175 | Not started |
| 8 | OPS2 runbooks | Sonnet, medium | RD1, WH1a merged | None | Not started |
| 8 | A3 production environment | Opus, high | AUD1, BK0 merged; the domain | None | Not started |
| 9 | G2 audit before the pilot | Fable, high | Gate B passed | None | Not started |
| 9 | V1 voice provider scoring | Sonnet, medium | The 51 corrected notes | None | Not started |
| 9 | AN1b founder assistant | Sonnet, high | AN1 merged | 0182 | Not started |
| 9 | WH1b warehouse, second part | Opus, high | Two weeks of shadow or pilot data | 0183 to 0185 | Not started |
| 9 | RET1 retention | Sonnet, medium | The lawyer's periods | 0181 | Not started |
| Later | LOY1 stamp card and "the usual"; BK1 basket builder and list photo; E1 to E3 vendors | Opus | Four clean pilot weeks; a signed vendor | - | Not started; each opens on its own gate |
| Last | PRIV make the repository private | Founder, with a Sonnet check | The build finished | - | Not started; last step |

Files each session owns, what it runs beside, and its "done when" are in the table of `docs/NEXT_SESSIONS.md`.

## Revision of 16 November 2026: product data first

Source: the founder's document of 16 November (`docs/PRODUCT_DATA_STANDARD.md`) and the coordinator's note of the same morning; the
decisions are in `docs/DECISIONS.md`, "Founder decisions, 16 November 2026"; the prompts in `docs/NEXT_SESSIONS.md`. These rows change
the table above; every other row stands. **Gate A from today:** HO1, B1a, B1b, CX1, DS1, D4b, **PD1, SR1**, T1 merged; pictures approved;
Arabic read by a person; zero silences after a hand-off; the two failed requests answered correctly on staging; every active item at least
"sellable". At most three sessions at once: PD1 and B1d now; then SR1, T1 and LD1.

| Wave | Session | Model, effort | Waits for | Runs beside | Migrations | Status |
|---|---|---|---|---|---|---|
| 4a, now | **PD1** product data standard: (1) the narrowed safety check and the honest answer; (2) templates, two readiness levels, intake and auto-approval; (3) recommendation data and the enrichment run | Opus, high | Nothing | B1d | 0202 to 0209 used (0210 and 0211 are LB1's) | (1) merged #96, (2) merged #98, (3) #99; the run's report and the gates in `docs/HANDOFF.md`, PD1 |
| 4a, now | **B1d** counts and edits (the wrong products left after B1c) | Opus, high | Nothing | PD1 | 0217 | Not started |
| 4a, now | **LB1** label day tooling and test budget (test budget in code, the judge sees the basket, directions and warnings fields, a phone capture page, one batch reading run, the approval queue in one sitting's order) | Sonnet, high | PD1 merged | SR1, T1, LD1 | 0210 to 0211 | Built (16 Nov): sim ceiling and limit 50, judge sees the basket, 0210, capture page, reading run (Batch API, USD 5 cap), approval queue; the first live reading and the photos wait for the label day; `docs/HANDOFF.md`, LB1 |
| 4b | **SR1** search by meaning and facts (pgvector plus word search, filters by approved facts, one function for chat and website) | Opus, high | PD1 merged | T1, LD1 | 0212 to 0216 used | Built: #104 (the request set, the baseline), #106 (the search, filters, baskets, the website), #107; live first five 0.630 to 0.881, fact failures 0, language gate held; search by meaning off (token), sim-test not measured (simulator's copy); `docs/HANDOFF.md`, SR1 |
| 4b | **T1** friends' test set-up (checks the new gate A) | Opus, medium | PD1 merged; Arabic read | SR1, LD1 | 0134 | Waits |
| 4b | **LD1** website product data (JSON-LD, facts by template, functional only) | Sonnet, medium | PD1 merged | SR1, T1 | 0218 used | Built (16 Nov; `docs/HANDOFF.md`, LD1): the page follows the item's template, JSON-LD on every product page, an ItemList on categories |
| Done | **DS2** apply the design reference to `packages/ui`, the website's pages and the console's frame | Fable, high | The reference archive and the coordinator's review | Any one | None | **Built 17 Nov** (`docs/HANDOFF.md`, DS2): tokens, the status label table, the shared components, the website's eight pages, the console's frame with a phone bar by role, LB1's pages; a restyle, no behaviour change. Not seen on a phone. The Arabic aisle page is 115 KB on a first visit (112 KB before) |
| Done | **LV1** Chouf places listed before they sign (a `listings` table, the Food pages, "I want to order from here", "Remove this listing", "Claim <listing_id>", the console's Listings page) | Sonnet, high | DS2 merged | Any one | 0224 to 0225 | **Built 17 Nov** (`docs/HANDOFF.md`, LV1): 460 places from the founder's file; a listing is never a merchant; demand logged per session; hidden at once on request, restored only by an ops lead or admin with a reason; the claim read by code before any model; Arabic, English and French wait for a reader |
| 4 | WEB2, UX2 (as UX2a: Today, Inbox, Orders, Pick, Dispatch, Stock; UX2b: Approve, Intake, Money, Settings, Riders; accepted by the coordinator, 17 Nov), UX3 | As before | DS2 merged | | As before | **Un-parked 17 Nov** (DS2); the reference's screens and their sessions are in `docs/HANDOFF.md`, DS2 |
| 4c | **CFG1** settings and small rules from the design review: the order-card reminder, reopen a lapsed order, the pickup code for every pickup, refund 10 and a second person for the LBP rate, cash cap 100/150, inbox timers as a setting | Sonnet, medium | Nothing | Any one | 0222, 0223 used | Built (17 Nov; `docs/HANDOFF.md`, CFG1) |
| 4c | **SELL1** nothing packaged sells before its label: the setting `sell_requires_label` (off), "packaged" per item, the gate in `quote_order`, search, the website and the catalogue feed, "coming soon" in the chat and on the site, the readiness page's label numbers | Sonnet, medium | LB1, PD1 | Any one | 0226 | Built (17 Nov; `docs/HANDOFF.md`, SELL1) |
| Closed | FX1 | | Absorbed by PD1 (data and chat) and LD1 (product page) | | | Closed |
| 6 | **BK1** list photo to basket (moved up from "Later") | Opus, high | SR1 merged; gate A open | RD1, AN1 | 0195 to 0197 | Not started |
| After WEB2 and gate B | **WEB3** the assistant on the website (the same Concierge, same turn pipeline) | Opus, high | WEB2 merged; gate B passed | Any one | 0219 to 0220 (LD1 used 0218) | Not started |

