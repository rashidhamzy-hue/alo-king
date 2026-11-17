# Next sessions

Rewritten on 15 November 2026 by session DOC1 from `docs/strategy/06-session-plan.md`, replacing the queue S1 wrote on 14 November.
The superseded queue is kept whole in `docs/history/NEXT_SESSIONS_2026-11-14.md` (never build from it); the prompts of sessions that
are finished stay below, under "History". The strategy behind this file is in `docs/strategy/` (start with its `README.md`).
Roadmap rows are in `docs/BUILD_PLAN.md`, "Strategy revision, 15 November 2026"; status is in `docs/HANDOFF.md`.

## Rules for every session
1. Read `CLAUDE.md`, the Status part of `docs/HANDOFF.md`, and the strategy section the prompt names, before anything else.
2. The invariants in `CLAUDE.md` hold. Every behaviour change starts with a failing test.
3. Migrations: use only the numbers reserved for the session; never edit an applied one.
4. No secrets, real phone numbers, pins or real names anywhere. Seed and test data are invented.
5. Never ask Rasheed. Anything only he can do goes into HANDOFF "Founder actions", with exact clicks.
6. Never dispatch `deploy-staging` from a branch. Merge `main` before merging. One pull request at a time, merged when CI is green.
7. A model is called only through a workflow that records its cost and has a dollar cap.
8. Screen work: screenshots at 390 and 1440 px, Arabic and English, light and dark, attached to the pull request.
9. Do not change vendor tables, village names or locations.
10. **Design follows the founder's reference (DS2, 17 November; `docs/DECISIONS.md`, "Design reference, 17 November 2026").** The pause
    is over: DS2 applied the reference to `packages/ui`, the website's pages and the console's frame. Every screen session builds from
    `packages/ui` (its tokens, components, the status label table and the four staff-screen rules in its README) and from the reference's
    screens in `docs/screens/ds2/` (`ref-*`). The reference is a pattern: no Lovable or React code is imported, and nothing of the
    reference is committed. Restaurants are not shown before Phase 8. Which session builds which reference screen: `docs/HANDOFF.md`, DS2.
11. Finish by updating HANDOFF Status (built, tested, not proven), the session's row in BUILD_PLAN, and NEXT_SESSIONS.
12. **Testing and model spend (coordinator, 16 November; `docs/DECISIONS.md`, "Coordinator decisions, 16 November 2026").** Fifteen full
    simulations cost about USD 43 in two days and no longer measure anything: the judge moves by about eight wrong products between runs
    of the same code. So:
    1. Every pull request: free tests only (unit tests, flow tests with a scripted model, the offline replay of recorded readings,
       zero-wrong). USD 0.
    2. The live language gate: once per session, and only when the session changed reading, planner or prompt code.
    3. Simulated customers: at most one run per session, limit 50, only for sessions that change ordering code. Never a second run to
       check variance. Limit 150 only at a gate check (T1 for gate A, then gate B).
    4. Data and product-intake sessions run no simulation.
    5. `sim-test` refuses to start above a monthly ceiling (the setting `sim_monthly_cap_usd`).
    6. `intake` runs by hand only.

## Gates
| Gate | Opens | Needs |
|---|---|---|
| **A** | The friends' test (Rashid and three friends on the US number) | HO1, B1a, B1b, CX1, DS1, D4b, **PD1, SR1**, T1 merged; pictures approved; Arabic strings read by a person (**done, 16 November: AR1**); the simulated customers show zero silences after a hand-off; **the two failed requests ("snacks with no sugar for 5 kids", "protein bars with no sugar") answered correctly on staging; every active item at least "sellable"; every stocked item photographed and read; allergens, halal and hazard warnings decided by a person** (16 November; B1d is not a gate item, its number is the friends' test's first measure) |
| **B** | The shadow run (staff and family, cash only, 7 days, 100 orders) | WH1a, RD1, OPS1, OPS2, AUD1, A3 merged; a nightly backup and a passed restore check; the hub with backup power and a temperature log; real costs entered; blended margin at least 15% |
| **C** | The paid pilot | The SARL; Meta verification; the lawyer's and accountant's answers; RCPT1; PAY1 switched on or cash only by decision; G2's blockers fixed; Supabase Pro; the numbers; auto-reload on with a limit |

Stop conditions: `docs/strategy/01-verdict-gates.md`.

**Product data first (16 November, `docs/DECISIONS.md`, "Founder decisions, 16 November 2026").** Two voice notes ("snacks with no sugar
for 5 kids", "protein bars with no sugar") failed on staging: nothing in stock fits, no item has an approved food fact, the safety check
refused the words themselves, there are no fields for what was asked, and search cannot filter by facts (`docs/PRODUCT_DATA_STANDARD.md`).
**PD1** (the product data standard, three pull requests) and **B1d** (counts and edits) run now; **SR1** (search by meaning and facts),
**T1** and **LD1** (JSON-LD on the product page) follow PD1. **DS2** applies the design reference when it arrives. **FX1 is closed**
(PD1 and LD1). **BK1** moves to wave 6. **WEB3** (the assistant on the website) comes after WEB2 and gate B. At most three sessions at once:
PD1 and B1d now; then SR1, T1 and LD1.

**PD1 status (16 November).** Pull requests 1 (#96: the narrowed safety check, the honest answer) and 2 (#98: templates, two readiness
levels, intake and the approval rules) are merged; 3 (#99: recommendation data, the enrichment run) follows. Migrations 0202 to 0209 used;
0210 and 0211 are free. **SR1 reads:** `product_search_documents` (one per item, `refresh_search_documents()`), `product_nutrition()`,
`product_claims`, `product_tags`, `product_facts_for_chat()`, `product_meets_restrictions()` (a pass needs a fact-complete item),
`substitutes_for()`, `dish_basket()`, `product_unit_price()`, and the honest answer (`packages/agents/src/honest.ts`). **LD1 reads:**
`product_template_status()`, `template_fields` and `product_facts_for_chat()` for the product page. **B1d:** PD1 changed no reading,
planner or edit code; sim-test 43814118255 (main after #96) had one turn error in an edit turn (sim-014, «شيلوه من الطلب»), B1d's ground.

**SR1 status (16 November).** Merged: #104, #106, #107 and the closing docs; migrations 0212 to 0216 used (0210 and 0211 stay LB1's).
`find_products(query, filters, limit, embedding, model, cache key)` is the one search for the Concierge (`search_catalog`) and the website
(`web_catalog_search`); `build_basket` builds a dish, lunchbox or budget basket by code; the reading step is `packages/search/src/reading.ts`.
Live reading model: right item in the first five 0.630 to 0.881, fact failures 153 to 0, "nothing fits" 19 of 19; language gate held
(wrong 0, F1 0.915). **Open:** (1) search by meaning is built and **off**: the Cloudflare token lacks Workers AI (founder action in HANDOFF,
"Founder actions (SR1)"); after the founder says it is fixed, one session runs `search-eval` with `embed` (USD 1 cap) and switches a model on
only if it beats words alone. (2) The limit-50 sim-test (run 43900749787) stopped before any conversation: `evals/sim/world.ts` empties
`approved_by` on staging's approved food facts but keeps `approved_at`, which 0021's check refuses. LB1 (owner of `evals/sim`) or the next
session that runs a sim-test fixes the copy first (HANDOFF, SR1, "The sim-test"), then one limit-50 run measures SR1's last gate.
**BK1** may start (SR1 merged); it still waits for gate A. **T1** may start. **LD1 is built** (16 November; `docs/HANDOFF.md`, LD1; migration 0218; WEB3 now reserves 0219 to 0220): product page by template, JSON-LD, Arabic and French strings wait for a reader (`docs/ARABIC_REVIEW.md`, LD1).

**UX2a status (17 November).** Built (`docs/HANDOFF.md`, UX2a; no migration; 0227 and 0228 stay free): Today (four link tiles), Inbox ("I'm on it", the 3/5/15 steps from `settings.support`), Orders (the drawer: history, choice, handover state, only the transitions `order_transitions` allows ops), Pick (the one-handed runner), Dispatch (cash against `cash_cap`, the code at the door, the pickup shelf) and Stock (counts and adjustments, reason required). The undo toast and `/go` (the command bar's jump to an order) are in place for UX2b to use. UX2b may start; the Arabic of UX2a is unread (`docs/ARABIC_REVIEW.md`, UX2a).

**CFG1 status (17 November).** Built: the 20-minute reminder for an unconfirmed card, reopening a lapsed order, the handover code on every pickup order, `refund_usd` 10 and a second person for the LBP rate, the cash cap 100/150, and the inbox timers pinned as a setting. Migrations 0222 and 0223 used; the next free number is 0224 (0219 and 0220 stay WEB3's). Decisions: `docs/DECISIONS.md`, "Design reference, 17 November 2026, settings"; what is not proven: `docs/HANDOFF.md`, CFG1. Its new Arabic lines wait for a reader (`docs/ARABIC_REVIEW.md`, CFG1).

**Design pause (15 November, `docs/DECISIONS.md`).** The founder paused all website and console design for a full redesign later. UX2, UX3, WEB2 and the new FX1 are parked until he restarts design; PAY1 now waits for CX1. Console work in other sessions stays functional, on the existing components, with no visual work.

**Where the queue stands.** CX1 is built and merged (16 November, #90 and #94; `docs/HANDOFF.md`, CX1; the language gate held and the simulated customers on `main` show no new failure class): PAY1 and RCPT1 may start on it (WEB2 when design restarts); UX2, when design restarts, adds two small console forms CX1 left (the handover code when acting for a rider, and a pickup handover at the hub; the SQL is `rider_handover` and `hub_handover`); SH1 sets `orders.handover_required` on a gift order. D4b is built (16 November; `docs/HANDOFF.md`, D4b): UX2 and T1 may start on it; T1 turns on the pick-queue switch (HANDOFF, D4b, "Before the friends' test"; no founder action). DS1 is built (15 November; `docs/HANDOFF.md`, DS1): D4b and UX2 build on `packages/ui` (the HTML functions in `packages/ui/src/components.ts`; after a style or class change run `node packages/ui/scripts/build.mjs`; screenshots with `SCREENS=<folder> npx vitest run test/screens`). The crown waits for the founder's approval; 34 new Arabic lines of the website wait for a reader (`docs/ARABIC_REVIEW.md`). What DS1 left out for lack of a source is a table in HANDOFF, DS1: AN1, WEB2 and UX2 read it first.
HO1 is done (15 November; `docs/HANDOFF.md`, HO1): the simulated customers show zero silences after a hand-off. B1 and DS1 may
start on it. DOC1 is done. COST1 is built (15 Nov; its live runs wait for migration 0139 on staging). Wave 0 continues with PUB1 and BK0 (BK0 waits for the founder's secret
`BACKUP_PASSPHRASE`). SIM1's report is merged (`docs/SIM_REPORT_2026-11-15.md`).
B1a is merged (#77, #79, #80; `docs/HANDOFF.md`, B1a). B1b is merged (#85; `docs/HANDOFF.md`, B1b): **CX1 may start**. B1b took B1a's
reading cases (pack sizes, «بيضا», add versus set). B1c is built (0138; `docs/HANDOFF.md`, B1c): generic words and sizes
asked by code or given the house default; the basket shown at the minimum and at night; edits on the basket's own product; hz0815. Its five
proposed house defaults are for the founder to keep or change (HANDOFF, B1c). Its target (wrong products at most 8 of 150) was not met: 18,
mostly the model's reading of counts and edits; next, reading cases for counts and a complaint that is not an edit (HANDOFF, B1c). B1d took those (#97, 16 Nov; `docs/HANDOFF.md`, B1d): counts against a pack's measure, «wa7de tene», a complaint not an edit, a swap never doubling a line, out of stock never replaced unasked, a picker that loops; the language gate held. Two 150-runs on main: wrong products 21 and 30 against the target of 8 (**not met**); about a third of each run is the customer's own additions the judge counts, and the judge classes move by about eight between runs of the same code. What is left for the ordering lane is listed in HANDOFF, B1d, "For the next ordering session". T1 measures nine cases from it on the friends' test (HANDOFF, B1d, F1 to F9). Left for L1: a field for "no pin, call before dispatch", read by the job card and
dispatch (HANDOFF, B1b). Fixed messages for an Arabizi customer stay in Arabic script (an Arabizi pack is new copy for a person to
write and read). T1 waits for gate A. At most three sessions at once.

**Coordinator decisions of 15 November, 13:30** (full text in `docs/DECISIONS.md`, "Coordinator decisions, 15 November 2026, 13:30"):
B1 is split into **B1a** and **B1b**, run one after the other after HO1, and CX1 waits for B1b; the minimum order is $5 with no small-order fee
at launch; a first order without a map pin is accepted with a typed village and landmark and marked for a rider call; DS1 converts the
founder's brief to `docs/DESIGN_BRIEF.md` first, from its attachment.

## Sessions in run order
| Wave | Session | Model, effort | Waits for | Runs beside | Files | Migrations | Done when |
|---|---|---|---|---|---|---|---|
| 0, now | **DOC1** strategy into the repository | Sonnet, medium | Nothing | PUB1, BK0, SIM1 | `docs/` only | None | Strategy files, the brief, the rules block, plan rows and decisions are on `main`; no code changed |
| 0 | **PUB1** public-repository hygiene | Sonnet, medium | Nothing | DOC1, BK0 | `scripts/ci/`, `.github/workflows/ci.yml`, `.gitleaks.toml`, `test/ci/`, `package.json` | None | A planted phone number, pin, plus code or key fails CI and the pre-commit hook; CI tools pinned with checksums |
| 0 | **BK0** free backups and restore check | Sonnet, medium | The founder's passphrase secret | DOC1, PUB1 | `.github/workflows/backup.yml`, `restore-check.yml`, `scripts/backup/`, `docs/RUNBOOK.md` | None | One encrypted copy stored; one restore check green; an alert when a copy is older than 36 hours |
| 1 | **HO1** never-stranded hand-off (done, 15 Nov) | Opus, high | SIM1's report merged | COST1, OPS1 | `apps/gateway/src/turn.ts`, `packages/agents/src/messages/`, `apps/console/src/pages/inbox.ts` (new) | 0135 to 0137 used | The tests in `05`, section D; a plain Inbox page works |
| 1 | **COST1** cost recorded, capped | Sonnet, medium | SIM1's report merged | HO1, OPS1 | `.github/workflows/*`, `scripts/` that call a model | 0139 | Every model-calling workflow writes tokens and dollars to a table and its summary, and stops at its cap. **Built 15 Nov**; one real run of each waits for 0139 on staging |
| 1 | **OPS1** alerts that wake someone (**built**, see HANDOFF) | Sonnet, high | Nothing | HO1, COST1 | `apps/console/` (push, roles, settings pages), `apps/web/` (Sentry) | 0140 to 0142 | A test case pushes to a phone; staff can be added and blocked in the console; template-health page; sign-in throttle; Sentry in all three Workers |
| 2 | **B1a** ordering fixes from SIM1, part 1 | Opus, high | HO1 merged | DS1, PIX | `packages/agents/src/` (reading, planner, guard, fixed messages), `packages/commerce/` quote, `supabase/seed/proposed_pilot_settings.sql`, `evals/` | None | Report fixes 1, 3, 4, 9 and 10 and the two no-reply turns pass their new cases; the language gate holds; 150 simulated conversations re-run with those classes at zero |
| 2 | **B1b** ordering fixes from SIM1, part 2 | Opus, high | B1a merged | DS1, PIX | `packages/agents/src/` (reading, places, language), `evals/` | None | Report fixes 5, 6, 7 and 8 pass their new cases; the language gate holds; 150 simulated conversations re-run with those classes at zero |
| 2 | **DS1** design system and flagship screens (**built**, 15 Nov, see HANDOFF) | **Fable, high** | OPS1 and HO1 merged; the crown picture and the founder's brief (.docx) attached | B1a, B1b, PIX | `packages/ui/` (new), Today, Inbox and Orders pages, the website's home, category, search and product | None | The gallery; the screens rebuilt; every existing test passes; screenshots |
| 2 | **PIX** pictures (built 15 Nov; **PIX2, 15 Nov: no search service**, pictures come from `data/pictures/candidates.csv` through the `images` workflow's from-list mode; HANDOFF, PIX2) | Sonnet, medium | Nothing | B1a, B1b, DS1 | Picture scripts and workflow only | None | A candidate for every item; the 20 fastest sellers first in the queue; duplicate and wrong-pack checks |
| 3 | **CX1** customer pack (**built and merged**, 16 Nov, #90 and #94, see HANDOFF) | Opus, high | B1b merged (B1a before it) | D4b | `packages/agents/src/`, `packages/commerce/`, card and order functions | 0143 to 0146 | Welcome with the privacy line; missing-item choice; "which note" and keep-the-change; self-service cancel until picking; handover code; pickup |
| 3 | **D4b** pick queue and rider jobs on the console (**built**, 16 Nov, see HANDOFF) | Sonnet, high | DS1 merged | CX1 | `apps/console/src/pages/` (new pages) | 0147 to 0148 used | A picker completes an order with no WhatsApp; ops can act for a rider; rider incident pages |
| 4a, now | **PD1** product data standard (16 Nov) | Opus, high | Nothing | B1d | `supabase/` (templates, facts, readiness, intake), `packages/agents/src/` (output guard, honest answer, facts tool), `apps/console/src/label.ts` and the readiness page (functional), the intake, product-data and research-load workflows, `evals/`, `docs/PRODUCT_DATA_STANDARD.md` | 0202 to 0211 | Three pull requests merged; the two voice-note cases get the honest answer and a demand row; templates, two readiness levels and intake rules tested; the enrichment run finished inside USD 15; language gate holds; 150 simulated customers show no new failure class |
| 4a, now | **B1d** counts and edits (16 Nov) | Opus, high | Nothing | PD1 | `packages/agents/src/` (reading, planner; not `output-guard.ts`, the facts tools or PD1's messages), `evals/cases/b1d_counts_edits.json` | 0217 | Wrong products at most 8 of 150; language gate holds |
| 4a, now | **LB1** label day tooling and test budget (16 Nov) | Sonnet, high | PD1 merged (0209 on staging) | SR1, T1, LD1 | `.github/workflows/sim-test.yml`, `intake.yml`, `evals/sim/` (budget, judge), `apps/console/src/` (capture page, label reader, approval queue; functional), the label-reading workflow and `scripts/label/`, `docs/` | 0210 to 0211 | Test budget in code (sim ceiling, limit 50, intake by hand); the judge sees the basket; directions and warnings as template fields; a phone capture page (scan or pick, three photos, next item, counter by aisle); one batch reading run (Batch API, MODEL_FAST, cap USD 5, in `model_costs`); the approval queue in one sitting's order; no simulation run. **Built 16 Nov** (`docs/HANDOFF.md`, LB1); the label day, the first live reading and the approvals are the founder's ("Founder actions (LB1)") |
| 4b | **SR1** search by meaning and facts (16 Nov) | Opus, high | PD1 merged | T1, LD1 | `supabase/` (pgvector, hybrid search), `packages/agents/src/concierge-tools.ts`, `apps/web/` search (functional), `evals/search/` | 0212 to 0216 | The request set (100 or more, four languages, plus 50 basket requests) scored before and after; no item that fails a fact filter is ever returned; chat and website use one function **Done (16 Nov) except two:** 0 fact failures, one function; first five 0.881 live (French 1.000, English 0.930, Arabic 0.857, Latin letters 0.696: below 0.85, misses are lines the model did not read); +36/+55 ms; language gate held. Not measured: embeddings (token) and the sim-test (simulator's copy) |
| 4b | **LD1** website product data (16 Nov) | Sonnet, medium | PD1 merged | SR1, T1 | `apps/web/` product page (functional only) | None | JSON-LD (price, stock, approved facts only) on every product page; the page shows only its template's fields, with "not confirmed yet"; no visual change |
| Done | **DS2** apply the design reference (**built 17 Nov**, `docs/HANDOFF.md`, DS2) | Fable, high | The reference archive and the coordinator's review | Any one | `packages/ui/`, the website's pages, the console's frame and LB1's pages | None | Tokens and shared components match; pages restyled; data, rules and tests unchanged; UX2 (UX2a, UX2b), WEB2, UX3 un-parked |
| 4b | **T1** friends' test set-up | Opus, medium | PD1 merged; CX1, D4b, DS1 merged; pictures approved; Arabic read (done, 16 Nov, AR1) | SR1, LD1 | Test accounts, the daily test report, `docs/` | 0134 | Four testers and one rider phone work end to end on staging; the report arrives nightly; it checks the new gate A (16 Nov) |
| 4 | **WEB2** cart, checkout, tracking (un-parked by DS2, 17 Nov; screens: `docs/HANDOFF.md`, DS2) | Opus, high | CX1 merged; DS2 merged | T1, UX2 | `apps/web/`, the web functions | 0178 to 0180 | One order placed on the site and one on WhatsApp are identical in price and ledger |
| 4 | **UX2** every remaining console page, in two parts (un-parked by DS2, 17 Nov): **UX2a** Today, Inbox, Orders, Pick, Dispatch, Stock; **UX2b** Approve, Intake, Money, Settings, Riders (the split was accepted by the coordinator on 17 Nov) | Sonnet, high | DS1, D4b, DS2 merged | T1, WEB2 | `apps/console/src/pages/` | None | All pages on the components, bilingual; the navigation of `05`, section A |
| Closed | **FX1** product facts by kind (**CLOSED** 16 Nov: absorbed by PD1, data and chat, and LD1, the product page) | | | | | | |
| 5 | **L1** event log, timeline, measured times, places | Opus, high | Gate A open | WH1a, N2 | `supabase/`, gateway rider steps, console proposals tab | 0149 to 0152 | `events` and `log_event()`; an order timeline; proposals for times and landmarks |
| 5 | **WH1a** warehouse basics | Opus, high | D4b merged | L1, N2 | `supabase/`, console Stock pages | 0153, 0156, 0157, 0188, 0189 (0154 and 0155 are WEB1's, on `main`) | Lots and first-to-expire; bins; temperature log by photo; packing checklist; simple purchase orders |
| 5 | **N2** nightly checks and learning | Sonnet, medium | COST1 merged | L1, WH1a | `.github/workflows/nightly.yml`, statistics views | 0186 | The full language run nightly within its cap; "what the system learned" |
| 6 | **RD1** rider pack | Opus, high | L1 merged | AN1, UX3 | Staff-line flow, `supabase/`, console Riders | 0160 to 0163 | Application, terms by tap, training job, guarantee report, rounds, village pause, plain cash-cap message |
| 6 | **AN1** reports and the daily summary | Sonnet, high | L1, UX2 merged | RD1, UX3 | Report views, console Reports | 0164 to 0166 | The nine reports with comparisons and CSV; the daily summary replaces the nightly message |
| 6 | **UX3** remaining website pages (un-parked by DS2, 17 Nov) | Sonnet, medium | WEB2 merged; DS2 merged | RD1, AN1 | `apps/web/` | 0187 | How it works, sign-up forms, privacy and terms shells, vendor pages hidden behind a switch |
| 7 | **PAY1** payment core and adapters | Opus, high | CX1 merged (was WEB2; design pause 15 Nov) | RCPT1, AUD1 | `packages/commerce/`, `supabase/`, a webhook route | 0167 to 0171 | Intents, webhooks stored first, MontyPay and areeba adapters and a Whish shell against fakes; everything off by a switch |
| 7 | **RCPT1** receipts and lira display | Sonnet, medium | CX1 merged | PAY1, AUD1 | Card and receipt messages, `supabase/` | 0172 to 0173 | Lira total, rate, date and time on the card and receipt as a setting; receipt numbers; tax per line |
| 7 | **AUD1** audit of what the planning chat could not reach | Sonnet, high | Nothing | PAY1, RCPT1 | `docs/AUDIT-2026-11.md`, small migrations | 0176 to 0177 | GitHub settings, Supabase advisors, Cloudflare secrets and routes, Kapso settings read and listed; row security on every table; the indexes that matter |
| 8 | **SH1** Send Home | Opus, medium | PAY1 merged | OPS2, A3 | Order functions, messages, the hidden website page | 0174 to 0175 | Buyer and recipient apart, gift flag, updates to the buyer; off by a switch |
| 8 | **OPS2** runbooks | Sonnet, medium | RD1, WH1a merged | SH1, A3 | `docs/runbooks/` | None | Ten one-page procedures in Arabic and English |
| 8 | **A3** production environment | Opus, high | AUD1, BK0 merged; the domain | SH1, OPS2 | Deploy workflows, `wrangler` configs | None | A production project on the free plan with BK0 pointed at it and a passed restore; production Workers on the domain with a rate-limit rule |
| 9 | **G2** audit before the pilot | **Fable, high** | Gate B passed | V1, AN1b | `docs/AUDIT-G2.md` | None | Every blocker listed with a test |
| 9 | **V1** voice provider scoring | Sonnet, medium | The 51 corrected notes | G2, AN1b | `evals/voice/` | None | Item accuracy per provider; a recommendation |
| 9 | **AN1b** founder assistant | Sonnet, high | AN1 merged | G2, V1 | A narrow function, console panel | 0182 | Six read-only tools; amounts placed by code; a role that can only read |
| 9 | **WH1b** warehouse, second part | Opus, high | Two weeks of shadow or pilot data | Any two | `supabase/`, console Stock | 0183 to 0185 | Camera scanning, invoice reading, the evening purchase proposal |
| 9 | **RET1** retention | Sonnet, medium | The lawyer's periods | Any two | `supabase/`, a cron | 0181 | Voice, pictures and chat deleted on schedule, logged |
| 6 | **BK1** list photo to basket (moved up, 16 Nov) | Opus, high | SR1 merged; gate A open | RD1, AN1 | A narrow reading function, `supabase/` | 0195 to 0197 | A photo of a handwritten list becomes a card the customer confirms |
| After WEB2 and gate B | **WEB3** the assistant on the website (16 Nov) | Opus, high | WEB2 merged; gate B passed | Any one | `apps/web/` chat panel, the same turn pipeline | 0219 to 0220 (LD1 used 0218) | The same Concierge in a chat panel; confirmation is the signed-in session's own button; one order placed there equals a WhatsApp order in price and ledger |
| Later | LOY1 stamp card and "the usual"; E1 to E3 vendors | Opus | Four clean pilot weeks; a signed vendor | | | | |
| Last | **PRIV** make the repository private | Founder, with a Sonnet check | The build finished | | | | Private; Actions usage checked against the free allowance; the history question closed |

## The staff line during testing
Kapso's sandbox sends buttons but no templates, and only to one registered phone, so pickers use the console pick queue and one rider
phone is registered; the full rule, and the January Meta verification paths, are in `docs/strategy/06-session-plan.md` sections 4 and 5.

## Prompts

### DOC1 (Sonnet, medium) — attach the strategy bundle and the founder's brief
```
You are session DOC1 (strategy into the repository), Sonnet, medium
effort. Two files are attached: the strategy bundle
(ALO-KING-STRATEGY-2026-11-15.md) and the founder's brief (.docx).
Docs only: change no code, migration or workflow.

1. Split the bundle at its "=== FILE: <path> ===" lines and write
   each part to that path under docs/strategy/. Add
   docs/strategy/README.md: what each file is, and that part 4 (the
   systems audit) and the founder's action drafts stay out of the
   repository until it is private.
2. Convert the brief to docs/DESIGN_BRIEF.md, unchanged in meaning.
3. Put the "Rules for every session" block from 06-session-plan.md
   at the top of docs/NEXT_SESSIONS.md, then the session table and
   every prompt from that file, replacing the old queue. Keep
   finished sessions as history below.
4. docs/BUILD_PLAN.md: one row per session in 06 (model, waits for,
   migrations). Mark T1 as waiting for gate A.
5. docs/DECISIONS.md: add "Founder decisions, 15 November 2026" from
   01-verdict-gates.md, plus: launch hours 09:00 to 21:00 with
   rounds; no paid plans before the paid pilot; no React in the
   console; the staff line during testing (06, section 4).
6. docs/HANDOFF.md Status: one section, "Strategy of 15 November",
   with the gates and what runs next.

Done when: the files are on main, every internal link resolves, and
git diff shows only docs/. Check the bundle for secrets, phone
numbers and pins before committing; stop and list any you find.
Rules: never ask Rasheed; merge main before merging; one pull
request, merged when CI is green.
```

### PUB1 (Sonnet, medium)
```
You are session PUB1 (public-repository hygiene), Sonnet, medium
effort. Read CLAUDE.md, docs/HANDOFF.md (H1, "Repository"), .gitleaks.toml
and .github/workflows/ci.yml. The repository stays public until the
build ends, so nothing personal or secret may enter it again.

1. scripts/ci/no-personal-data.mjs, run in CI over the whole tree
   and by a pre-commit hook installed through package.json: fail on
   a phone number of 11 to 13 digits outside an allow-list of
   invented fixtures, a latitude and longitude pair inside Lebanon
   with more than three decimals outside the seed villages file, a
   plus code, an email address that is not a documented example,
   and anything gitleaks flags. Failing tests first, with planted
   examples of each.
2. Pin gitleaks and osv-scanner to exact versions with checksum
   verification.
3. A test proves every fixture phone number and pin is from the
   invented ranges.
4. docs/RUNBOOK.md: "What may never be committed", and how to rotate
   the webhook secrets with the existing rotate option. Add the
   rotation itself to HANDOFF "Founder actions"; do not run a
   deploy.

Do not touch evals/sim, the sim-test workflow or apps/. Done when: a
branch carrying each planted example fails CI, main passes, and the
hook blocks a local commit. Rules: the block at the top of
docs/NEXT_SESSIONS.md; never ask Rasheed; one pull request.
```

### BK0 (Sonnet, medium) — after the founder adds the secret BACKUP_PASSPHRASE
```
You are session BK0 (free backups and a repeated restore), Sonnet,
medium effort. Read CLAUDE.md, docs/RUNBOOK.md and
.github/workflows/deploy-staging.yml (how the database password and
the Cloudflare token are used). No paid plan is allowed.

1. .github/workflows/backup.yml, nightly at 01:30 UTC and by hand:
   dump the staging database through the session pooler, encrypt it
   with gpg symmetric AES-256 using secrets.BACKUP_PASSPHRASE, and
   store it in a private Cloudflare R2 bucket ak-backups with the
   existing Cloudflare token. If the token lacks R2 rights, store it
   in the private Supabase bucket under backups/ and write the exact
   token change into HANDOFF "Founder actions". Keep 14 nightly and
   8 weekly copies. Never upload a dump as a workflow artifact and
   never print the passphrase. Stop with a clear message if the
   secret is missing.
2. .github/workflows/restore-check.yml, weekly and by hand: fetch
   the newest copy, decrypt it, restore it into a Postgres service
   container, then check the migration count, row counts against a
   manifest written at dump time, and that the ledger balances.
3. An ops exception and a Sentry event when the newest copy is older
   than 36 hours or a restore check fails.
4. The environment is a parameter, so production uses the same two
   workflows later.
5. docs/RUNBOOK.md "Restore": the steps a person follows, and that
   the passphrase exists only with the founder.

Done when: one backup and one restore check have run green on main
and their run links are in HANDOFF. Rules: the block at the top of
docs/NEXT_SESSIONS.md; never ask Rasheed; one pull request.
```

### HO1 (Opus, high) — start when SIM1's report is merged
```
You are session HO1 (never-stranded hand-off), Opus, high effort.
Read CLAUDE.md, docs/strategy/05-console-website-design-handoff.md
section D (the specification: follow it exactly),
docs/SIM_REPORT_2026-11-15.md (the silence-after-hand-off baseline),
apps/gateway/src/turn.ts and migrations 0045 and 0077.
Migrations 0135 to 0138.

Build section D in this order, each with a failing test first:
1. The case record on handoffs, conversations.bot_paused_until,
   settings.support, and the SQL functions listed.
2. turn.ts: stop reading human_handoff; the table "what each of
   today's nine lock reasons becomes"; the pause only by a staff
   claim or reply.
3. "I want a person" recognised by code in Lebanese Arabic, Latin
   letters, English and French, before any model.
4. The six customer lines in all three languages; export every new
   Arabic line to docs/ARABIC_REVIEW.md for a human read.
5. The timers on the minute cron, and the alarm for a customer
   message unanswered for 2 minutes in open hours.
6. Safe automatic credit with its three limits.
7. A plain Inbox page on the console: list by timer, chat, drafted
   reply from a narrow read-only function, send, resolve. DS1
   restyles it later.
8. The migration clears every existing lock.

Done when: section D's "Done when" list passes; the language gate
holds; dispatch sim-test on main with limit 150 and show zero
silences after a hand-off. Rules: the block at the top of
docs/NEXT_SESSIONS.md; never ask Rasheed; one pull request.
```

### COST1 (Sonnet, medium)
```
You are session COST1, Sonnet, medium effort. Migration 0139. No key
or secret changes. Find every workflow and script that calls a
model. Each must write model, tokens (input, output, cache read and
write), dollars from model_prices, workflow and run id to one table,
print the total in its run summary, and stop when it passes a dollar
cap given as a workflow input with a safe default. The language-pack
workflow runs one "after" pass by default; "before" and other-model
passes only when asked. Add the totals by workflow and day to the AI
cost view. Done when: a test proves a run stops at its cap, and one
real run of each workflow shows its cost in the table. Rules: the
block at the top of docs/NEXT_SESSIONS.md.
```

### OPS1 (Sonnet, high)
```
You are session OPS1 (alerts that wake someone), Sonnet, high
effort. Read docs/strategy/05 section A (Settings) and section D
(timers), and apps/console push code. Migrations 0140 to 0142.
1. Push: the key script wired into the deploy; agent_handoff and
   case kinds as high priority; a "send me a test alert" button.
2. Sentry in the console and website Workers; the deploy self-test
   issues resolved automatically.
3. Staff and roles page: add and block staff through one new SQL
   function, logged; a sign-in throttle.
4. Template health page: approved, pending, moved to marketing, and
   the fallback in force for each.
5. An alert when the dead-letter queue is not empty.
6. HANDOFF "Founder actions": three free uptime checks to create
   (gateway health, console, website) and Hussein's account.
Done when: a forced case pushes to a subscribed phone on staging;
the tests pass; screenshots. Rules: the block at the top of
docs/NEXT_SESSIONS.md.
```

### B1a (Opus, high)
```
You are session B1a (ordering fixes from the simulated customers,
part 1), Opus, high effort. Read docs/SIM_REPORT_2026-11-15.md,
evals/cases/sim_*.json and "Coordinator decisions, 15 November 2026,
13:30" in docs/DECISIONS.md. Run after HO1; B1b follows you. Fix, in
the report's ranked order, each on its failing cases:
 1. The minimum order, said by code with its amount and the gap, both
    from the quote. The minimum is $5 (a setting: min_order_usd) and
    there is no small-order fee at launch (the fee setting stays off;
    change supabase/seed/proposed_pilot_settings.sql to match). One
    rule, never both. Say it was set by the coordinator and the
    founder may overrule: the amount is data, not code.
 3. The status shortcut must not say "no open order" while a basket
    or draft is in hand; the card is built from the whole basket.
 4. The basket changes only by what the customer picked (no item from
    a tentative "maybe", quantities as additions, edits by explicit
    add, remove, set-quantity; a changed card shows what changed).
 9. A cancel the database refuses gets a fixed answer and an ops
    alert, not a button_error hand-off.
10. No catalogue claim without a tool result; a failed show_catalog
    gets a fixed line and a typed alternative.
 And the two no-reply turns (sim-009, sim-014: a tap on a delivery
 window from the list got nothing back, outcome buttons): a reply or
 a recorded reason on every tap.
Also the two carried ordering bugs in HANDOFF (the size-only line;
«بدي أغراض لمجدرة») if their cases are not already covered. No change
to hand-off code or to anything fixes 5, 6, 7 and 8 own (B1b). Every
bug becomes a case in evals/ before its fix. Done when: the new cases
pass; the language gate holds (wrong products 0, F1 at least 0.90);
sim-test with limit 150 shows those classes at zero. Rules: the block
at the top of docs/NEXT_SESSIONS.md; update HANDOFF Status and the
B1a row of BUILD_PLAN.
```

### B1b (Opus, high)
```
You are session B1b (ordering fixes from the simulated customers,
part 2), Opus, high effort. Read docs/SIM_REPORT_2026-11-15.md,
evals/cases/sim_*.json and "Coordinator decisions, 15 November 2026,
13:30" in docs/DECISIONS.md. Run after B1a is merged; CX1 waits for
you. Fix, each on its failing cases:
 5. A first order without a map pin. A first order is accepted with
    a typed village and landmark and is marked for a rider call: the
    rider or ops phones the customer before the order goes out. Use
    the existing resolve_place path and the order's existing note and
    flag fields; if a new column is needed, stop and write it into
    HANDOFF for L1 (this session has no migration). A pin that falls
    between villages asks one short question, not a 257-character
    list. A pin outside the service area is still refused.
 6. Replies in the customer's language, Arabizi included: pass the
    language the reading found to every fixed message and to the ask
    loop, and keep it for the conversation.
 7. Message rules in model text: fold Arabic-Indic digits to Latin
    and refuse or split a line over 120 characters in the output
    guard, as it already does for amounts.
 8. A greeting, a thank-you or a goodbye is not off-topic. Add the
    cases to evals/cases/off_topic.json before changing the reading.
No change to hand-off code, to the minimum-order rule or to anything
B1a owns. Every bug becomes a case in evals/ before its fix. Done
when: the new cases pass; the language gate holds (wrong products 0,
F1 at least 0.90); sim-test with limit 150 shows classes 5 to 8 at
zero and B1a's classes still at zero. Rules: the block at the top of
docs/NEXT_SESSIONS.md; update HANDOFF Status and the B1b row of
BUILD_PLAN.
```

### DS1 (Fable, high) — attach the crown picture and the founder's brief (.docx)
```
You are session DS1 (design system and flagship screens), Fable,
high effort. First, before anything else: convert the founder's
brief, from its attachment, to docs/DESIGN_BRIEF.md, unchanged in
meaning, and commit it on its own. If the attachment is missing,
stop and write that in HANDOFF "Founder actions". Then read
docs/DESIGN_BRIEF.md, docs/strategy/05 sections A,
B and C (the decisions: follow them), docs/CONSOLE.md and
docs/WEBSITE.md. No React in the console; its renderer and every
write path stay as built.
1. packages/ui: tokens.css (the values in section C; check contrast
   and adjust within the family), Tailwind v4 compiled at build
   time, IBM Plex Sans Arabic and IBM Plex Sans served from our own
   address, the crown as SVG from the attached picture, and the
   component list of section C as HTML functions for the console
   and Astro components for the website.
2. A gallery page in each app, staging only.
3. Console: the shell (sidebar, bottom bar, command bar, bell),
   Today, the Inbox and Orders, as section A describes. A figure
   with no source is left out and listed in HANDOFF.
4. Website: home, category, search and product, as section B
   describes, with the delivery check and Order on WhatsApp.
5. Export every customer-facing Arabic string to
   docs/ARABIC_REVIEW.md.
Done when: every existing test passes unchanged in meaning; pages
stay under 100 KB before pictures; screenshots per rule 8. Rules:
the block at the top of docs/NEXT_SESSIONS.md.
```

### PIX (Sonnet, medium)
```
You are session PIX, Sonnet, medium effort. Read HANDOFF's picture
sections and the founder's picture rule in DECISIONS. Pipeline only:
no customer-facing change. Get one candidate picture for every
active item into the approval queue: sources in order of quality,
the pack shot matching name and size, no watermark or logo, one
canonical 1200 px file, duplicates and near-duplicates rejected, the
source and time stored. Put the 20 fastest sellers first. Cap model
spend through the workflow's cost cap. Done when: the queue shows a
candidate for every item or a named reason, and HANDOFF tells the
founder how many to approve. Rules: the block at the top of
docs/NEXT_SESSIONS.md.
```

### CX1 (Opus, high)
```
You are session CX1 (customer pack), Opus, high effort. Read
docs/strategy/02-journeys.md section 1 and 03 section B. Migrations
0143 to 0146. Build, each with a failing test first: the first-ever
welcome with three buttons and one privacy line carrying consent;
on the order card, the missing-item choice (best match, ask me,
remove) and "which note will you pay with?" with keep-the-change as
credit; self-service cancel until picking starts and the exact
refundable amount after; a four-digit handover code for prepaid and
gift orders; pickup at the hub with no fee. At most four customer
messages per order. Done when: tests pass, the language gate holds,
and sim-test with limit 150 shows no new failure class. Rules: the
block at the top of docs/NEXT_SESSIONS.md.
```

### D4b (Sonnet, high)
```
You are session D4b, Sonnet, high effort. Read docs/strategy/02
sections 3 and 4 and 06 section 4. Migrations 0147 to 0148. Console
pages on the shared components: the pick queue (start, missing,
substitute, done, packing checklist) so a picker needs no WhatsApp;
rider jobs with "act for a rider" (accept, pick up, arrive,
delivered, cash) logged with who acted; rider incidents (rider off,
transfer, cash received). Every action calls the existing SQL
functions. Done when: one order is picked and delivered on staging
with no staff-line message; tests and screenshots. Rules: the block
at the top of docs/NEXT_SESSIONS.md.
```

<!-- Prompts of 16 November (coordinator's note), recorded by PD1. -->
### PD1 (Opus, high). Attach the founder's document and this note.
```
You are session PD1 (product data standard), Opus, high effort.
Attached: the founder's document "Alo King: product data, search and
2026-27 practices" (16 Nov) and COORDINATOR-STATE-2026-11-16.md.
Read CLAUDE.md and HANDOFF Status. Then read what already exists,
because you extend it and do not rebuild it: migrations 0021, 0049,
0073, 0111, 0114 and 0123 to 0127 (facts, evidence, label scans,
proposals, readiness, label beats web, intake, auto-approval), 0022
(demand_signals, log_demand, unmet_demand),
packages/agents/src/output-guard.ts and pack-rules.ts,
apps/console/src/label.ts, the workflows intake, product-data and
research-load, and data/research/README.md. Migrations 0202 to 0211.
FX1 is closed: you build its data and chat parts.

Step 0, documents only, first commit: record the note's decisions
in docs/DECISIONS.md ("Founder decisions, 16 November 2026"), its
gate A and wave table in docs/NEXT_SESSIONS.md and
docs/BUILD_PLAN.md, and convert the founder's document to
docs/PRODUCT_DATA_STANDARD.md. Where the document and this prompt
differ on a field list, the document wins; on scope, this prompt
wins.

Three pull requests, in this order, each merged green before the
next. Every behaviour starts with a failing test.

PULL REQUEST 1: the chat stops failing today (e, g).
e) The narrowed safety check. Before the food-term and quality
   checks run, take out of the model's text (1) the exact name of
   every product or dish a tool returned this turn, and (2) the
   customer's own words from this turn where they are said back as
   the request ("you asked for ...", "we don't carry ... yet").
   Check what is left exactly as today. Failing tests first; must
   pass: "We have Balance Protein Crackers", "X Protein Bar", a
   dish called "Protein Chicken Wrap", "Lipton Ice Tea Zero Sugar",
   "you asked for protein bars" and the same in Arabic and in
   Lebanese written in Latin letters. Must stay refused with no
   approved record: "this bar has 20 g of protein", "it's
   sugar-free", "good for kids", "healthy", and an echo that
   confirms (the customer asks «هيدا بدون سكر؟» and the draft says
   «إيه، بدون سكر»). With an approved record returned this turn
   for that product, the fact is stated with its source ("the pack
   says no added sugar"); the unlock is per product, not per
   attribute group. Invariants 14, 15 and 16 are unchanged.
g) The honest answer when nothing fits, written by code in Arabic,
   English and French: what we do not carry yet (noted), what we
   cannot confirm yet, and at most three real items by their exact
   name and price from the tool. It logs the request with
   log_demand: the kind asked, the facts asked, audience, quantity
   and language. It never offers the catalogue button while
   settings.catalog has no catalogue (staging, 15 Nov 22:20: the
   bot offered it and the tap answered "write what you want").
   Eval cases first: the two voice notes ("snacks with no sugar for
   5 kids", "protein bars with no sugar") on today's seed, with the
   answer the document gives. New Arabic lines go to
   docs/ARABIC_REVIEW.md.

PULL REQUEST 2: the standard (a, b, c, d).
a) Templates as data: tables for templates, their fields (key,
   type, unit, required for "sellable" or for "fact-complete",
   allowed sources, approved automatically or by a person) and the
   category-to-template map. Seed the common core and every
   template of the document: packaged food and drinks, fresh
   produce, meat and poultry, bakery, water, cleaning and
   household, beauty and personal care, baby and child, pet, and
   gas (future, no items). Food fields exist only on food
   templates: the database refuses a food fact on a non-food
   template, and the chat answers "doesn't apply" to a food
   question about a non-food item. A category with no template
   cannot hold an active item (a trigger, with a test).
b) Nutrition per 100 g or 100 ml as numbers built from approved
   facts (energy, fat, saturated fat, carbohydrate, sugars, added
   sugars where printed, protein, fibre, salt, serving size);
   printed claims as a list with evidence; caffeine;
   certifications with evidence; audience and occasion tags, which
   are shopping tags and never a health or safety claim; hazard
   warnings and pictograms as printed; the supply fields. The
   vendor dish standard of the document as schema, functions and
   tests on invented data only: every food fact "declared by the
   vendor" with its date. No existing vendor row changes (rule 9);
   invariant 11 holds.
c) Two readiness levels, by extending product_readiness (0111):
   "sellable" (core complete) and "fact-complete" (template
   complete). Only a fact-complete item can be returned by a fact
   filter or have a fact stated; a sellable item's facts read "not
   confirmed yet" in the chat and in product_food_facts. The
   catalogue must not freeze: this migration pauses no item that
   is active today. The rule applies on insert and on activation
   from now on; existing items that fail the core are listed with
   what is missing. Both levels and the missing fields show per
   item on the console's existing readiness page, functional only
   (rule 10).
d) The intake pipeline of the document on the existing
   intake_advance steps, for every current and future item, vendor
   and dish: start (barcode, supplier line or an unmet-demand
   row), barcode lookup, the label read into the template's own
   fields (extend the label reader: hazards and active ingredient
   for cleaning, the ingredient list and age for beauty, age range
   for baby, species and life stage for pet), compare sources,
   propose the rest, approve, re-check (facts expire after 12
   months). Auto-approval as rows in auto_approval_rules: identity
   and pictures on an exact barcode and printed-name match;
   nutrition numbers and ingredients when the label photo and the
   barcode record agree, or when two independent published sources
   for the same market agree exactly (coordinator's rule, one row
   the founder can switch off); printed claims only from a label
   photo or the brand's own page; kind, tags, storage and search
   words by rules. Always a person, enforced in SQL and never in a
   prompt: allergens, halal and every certificate, hazard
   warnings, anything that sounds medical, and any disagreement
   between sources. Test that the automatic party cannot approve
   those. The vendor path (menu read into dishes, the vendor
   confirms, ops approves) as functions and tests only; no new
   send path (invariants 1, 2, 20).

PULL REQUEST 3: recommendation data and the run (f, h).
f) Substitute groups, complements, Lebanese dishes as baskets (a
   dish, its kinds and the quantity per person), portions per
   person, pack format, unit price (computed in SQL from price and
   size, never by a model), taste and type, local origin, seasons,
   and one search document per item in a table SR1 will read.
   Proposed by a model, checked by rules: a substitute has the
   same template and kind; quantities are numbers code can
   multiply; nothing crosses a stated restriction. None of it is a
   health claim and the chat never says it as advice (invariant
   14).
h) One enrichment run over the 291 through COST1's recording,
   max_usd 15, stopping at the cap. Sources in order: Open Food
   Facts, the files in data/research (every item has one), label
   scans where they exist. Everything lands as proposals; the
   rules of (d) approve what they may. Open Food Facts front
   pictures go to data/pictures/candidates.csv and through the
   images workflow's from-list mode (max_usd 3). The report, in
   HANDOFF and the run summary: items sellable and fact-complete
   per template; per item what is missing and which route fills
   it: a page already on file, the supplier sheet, a label photo
   at a shop shelf before stock arrives (a printable list by
   aisle), or the label photo at first receiving. The 34 items
   with no barcode are filled by their template's rules and the
   supplier's or bakery's declaration; expect no nutrition for
   them.

Done when: all tests pass; the language gate holds (wrong products
0, F1 at least 0.90); sim-test with limit 150 shows zero silences
after a hand-off and no new failure class; the two voice-note
cases get the honest answer and a demand row; the run finished
inside its cap with its dollars recorded; HANDOFF has the
readiness report and "Founder actions (PD1)" with exact clicks
(what to approve first: allergens, halal, hazards). Say plainly
what is built, what is tested and what only staging can prove. If
(f) is not finished, say so and leave baskets and complements to
SR1; do not claim it. Rules: the block at the top of
docs/NEXT_SESSIONS.md; never ask Rasheed.
```

### SR1 (Opus, high). Start when PD1's third pull request is merged.
```
You are session SR1 (search by meaning and facts), Opus, high
effort. Read CLAUDE.md, HANDOFF Status (PD1 above all),
docs/PRODUCT_DATA_STANDARD.md, migrations 0053 (the language pack
and search_catalog), 0080, PD1's migrations 0202 to 0211, and
packages/agents/src/concierge-tools.ts. Migrations 0212 to 0216.

Build, each with a failing test first:
1. The request set, before any code: evals/search/requests.json
   with at least 100 Lebanese requests spread over Arabic, Lebanese
   in Latin letters, English and French, each with what must come
   back (products, a kind, or "nothing fits"). It includes the two
   that failed ("snacks with no sugar for 5 kids", "protein bars
   with no sugar"), non-food ones ("fragrance-free shampoo for
   kids", "dog food for a puppy") and requests that mix a fact, an
   audience and a count. Add the 50 basket requests ("mjadra for
   6", "lunchbox snacks for the week", "a basket under $20").
   Score today's search on it first and write the baseline down.
2. Hybrid search inside Postgres: pgvector in the extensions
   schema; one embedding per item from PD1's search document; the
   built word search and language pack; the two ranked lists
   merged; then hard filters. One SQL function, used by the
   Concierge's tool and by the website's search page (invariant
   19). Sort by measurable facts only (invariant 14).
3. Filters by approved facts only: sugars, protein, salt, printed
   claims, diet, allergens (through product_meets_restrictions),
   audience and occasion, and each template's own fields (scent,
   age range, species and life stage). Only fact-complete items
   can pass a fact filter. Unknown never passes (invariant 15). A
   stated allergy is a restriction, never a preference (16).
4. The reading step returns the filters as structured data (a
   ceiling or floor on a nutrient, a claim, an audience, people,
   budget, a dish). Every reading bug becomes a case in evals/
   before its fix.
5. Embeddings: test Cloudflare Workers AI bge-m3 on the request
   set against the baseline before trusting it; if it does not
   beat word search alone on the Arabic and Latin-letter requests,
   try one other multilingual model and record both. Every call is
   recorded with its cost; a daily cap is a setting; query
   embeddings are cached. If the embedding call fails or the cap
   is reached, search falls back to word search and the turn still
   answers.
6. Baskets: a dish for N people, a budget basket and a week of
   lunchbox snacks are built by code from PD1's dishes, portions
   and unit prices and priced by the quote tool (invariant 7); the
   customer still confirms the card (invariant 4).
7. When facts exist the chat states them with their source ("the
   pack says ..."); when nothing passes, PD1's honest answer runs
   and the demand row is logged.
8. The website's search uses the same function and filters,
   functional only (rule 10).

Done when: on the request set, no returned item fails a fact
filter (zero, a hard gate); the share of requests with a right
item in the first five is at least 0.85 and clearly above the
baseline, reported per language; every "nothing fits" request gets
the honest answer; median added time per search is under 150 ms on
staging; the language gate holds (wrong products 0, F1 at least
0.90); sim-test with limit 150 shows zero silences and no new
failure class. Report the wrong-product count before and after:
cutting it is B1d's target, not yours, but say what search
changed. Update HANDOFF, BUILD_PLAN and NEXT_SESSIONS. Rules: the
block at the top of docs/NEXT_SESSIONS.md; never ask Rasheed.
```

### B1d (Opus, high). Runs beside PD1.
```
You are session B1d (counts and edits), Opus, high effort. Read
HANDOFF "B1c" (what the 18 were) and the sim-test runs 43776071899
and 43781701377. Migration 0217 if the planner needs one. Do not
touch output-guard.ts, the facts tools or the messages PD1 owns.
Read the wrong-product conversations of the latest run one by one
into evals/cases/b1d_counts_edits.json, then fix by class, each on
its failing cases: a count against a pack's weight («٣ كيلو» sugar
is not three 5 kg bags); «wa7de tene» is one more, not two; a
complaint or a question («sar 5?») is not an edit; a swap or a
correction never doubles a line; an out-of-stock path never drops
or adds an item unasked; a product picker that loops. Done when:
the new cases pass; the language gate holds (wrong products 0, F1
at least 0.90); sim-test with limit 150 shows wrong products at
most 8 and no class worse than CX1's run. Rules: the block at the
top of docs/NEXT_SESSIONS.md; never ask Rasheed.
```

### LB1 (Sonnet, high). Label day tooling and test budget (16 November). Runs beside SR1, T1 and LD1.
Prompt as given by the coordinator on 16 November: first commit documents only (the testing rules above, gate A, this row, the decisions);
then, each behaviour with a failing test first: (1) the test budget in code; (2) the simulator's judge is given the basket; (3) migration 0210,
"directions as printed" and "warnings as printed" as core template fields; (4) the console capture page for a phone; (5) one reading run
through the Batch API; (6) the approval queue in one sitting's order. Migrations 0210 and 0211. No simulation run. Done when and the
founder actions: `docs/HANDOFF.md`, "LB1" and "Founder actions (LB1)".

### LD1, DS2, WEB3 (16 November)
Each uses the standard text below ("WEB2, UX2, ...") with its row in the table above.

### T1 (Opus, medium)
```
You are session T1 (friends' test set-up), Opus, medium effort. Read
docs/strategy/06 sections 2 and 4 and the T1 notes in HANDOFF.
Migration 0134. Check gate A item by item and stop with a list if
one is missing. Then: four tester customers and one rider phone on
staging through the existing workflows; a nightly test report (what
each tester did, every failure with its chat, cases and their
times, cost); a one-page tester guide in Arabic and English; a
"report a problem" word that files an eval case. Done when: a full
order by one tester, picked on the console and delivered by the
rider phone, appears in the report. Rules: the block at the top of
docs/NEXT_SESSIONS.md.
```

### WEB2, UX2, L1, WH1a, N2, RD1, AN1, UX3, PAY1, RCPT1, AUD1, SH1, OPS2, A3, G2, V1, AN1b, WH1b, RET1
Each uses this text with its own line from the table in section 3:
```
You are session <NAME> (<title>), <model>, <effort>. Read CLAUDE.md,
HANDOFF Status, and docs/strategy/<file and section>. Migrations
<range>. Build exactly what that section and the session's "Done
when" in docs/strategy/06-session-plan.md describe, each behaviour
with a failing test first. Anything the section leaves open, decide
the simplest way that keeps the invariants and record it in
DECISIONS. Rules: the block at the top of docs/NEXT_SESSIONS.md;
never ask Rasheed; one pull request.
```
| Session | Read |
|---|---|
| WEB2 | `05` section B (cart, checkout, tracking, orders, account); `docs/WEBSITE.md` |
| UX2 | `05` section A |
| L1 | `03` section A (event log, what to record, delivery time) |
| WH1a | `02` section 4 |
| N2 | `03` section A (rhythm) |
| RD1 | `02` section 3 |
| AN1 | `05` section A (reports) |
| UX3 | `05` section B (how it works, sign-up, privacy, terms, vendor pages) |
| PAY1 | `docs/RESEARCH_REGISTER.md` (a); `docs/SYSTEM_PLAN.md` 9; adapters against fakes, everything off by a switch |
| RCPT1 | `02` section 1 (card, payment); the lira total as a setting, on by default |
| AUD1 | `06` section 3, its row; read-only against live systems, findings to `docs/AUDIT-2026-11.md` |
| SH1 | `05` section B (Send home); `docs/SYSTEM_PLAN.md` 9.1 |
| OPS2 | `02` section 5; the ten procedures named in `06` section 3 |
| A3 | `docs/RUNBOOK.md`; BK0's workflows pointed at production |
| G2 | The whole of `docs/strategy/` and `docs/AUDIT-G1.md`; findings only, no fixes |
| V1 | `docs/RESEARCH_REGISTER.md` (d) |
| AN1b | `05` section A (founder assistant) |
| WH1b | `02` section 4 (second part) |
| RET1 | The lawyer's periods in DECISIONS |

---

## History: finished sessions (prompts as they were run)
The rules in these old prompts are superseded by the block at the top of this file.

### 1. SP1: reply speed (Opus 5.5)
```
You are session SP1 (reply speed), Opus 5.5, ordering lane. Read CLAUDE.md, docs/HANDOFF.md (section "Session A4", item 3 and
"For lane B"), docs/AUDIT-G1.md (G1-19, G1-21, and point 10 of "The brief's Points for the audit") and docs/BUILD_PLAN.md "S1 revision", row SP1.

Goal: most typed orders answered in under 10 seconds. A4 measured p50 15.9 s on staging (view turn_waits): about 8.3 s pass
before the turn starts (a fixed 6-second burst buffer, BUFFER_SECONDS, plus about 2.3 s of database calls: touch_conversation,
record_first_contact, the wa_messages insert, begin_turn), and the "ask" path makes a second model call with four times the
output tokens.

Do, each with a failing test first:
1. Burst buffer: make it adaptive and a setting (settings.burst: quiet_ms 1200, max_ms 4000). A single text starts its turn
   after quiet_ms of silence; a new message inside that time extends the wait up to max_ms; voice notes and images keep the
   longer wait; buttons stay instant. Test on the conversation object: one complete text starts within 1.5 s; three texts sent
   one second apart are read as one turn.
2. Pre-turn calls: one SQL function (open_turn) that does what the four calls do now and returns everything the turn needs.
   Start from the latest definitions; change no behaviour. One database round trip before the model.
3. Ask path: try output_config effort "low" on the reading behind the evals; answer by code every ask case that needs no
   model (list them from agent_runs on staging first); keep one model call where a second is not needed. Record per-call
   timings and cache_read_input_tokens in agent_runs.trace, and price cached input in agent_run_costs.
4. Key model-written replies by turn key plus a hash of the text, not by position (G1-19). A retried turn reuses its draft
   order and card instead of issuing a second one (G1-21).
5. Record in a code comment and in HANDOFF that no model escalation exists: MODEL_SMART refuses the forced tool choice and is
   not used at run time (audit point 10). Do not add a second model to the hot path.

Files: apps/gateway/src/index.ts (the conversation object only), apps/gateway/src/turn.ts, packages/agents/src/concierge.ts,
pipeline.ts, evals/. Migrations 0100-0102. Do not touch packages/wa, the console or any money function.

Done when: the tests above pass; the language-pack gate still holds (run the language-pack workflow: item F1 at least 0.90,
zero wrong products, the demo message right); after deploy-staging, turn_waits shows typed replies at p50 under 10 s over at
least 20 probe turns, and the numbers are written into HANDOFF.

Rules: CLAUDE.md invariants hold; touch only your files; every language bug becomes an eval case first; npm run typecheck and
npm test must pass; no secrets in files or output; never ask Rasheed; write anything blocked in docs/HANDOFF.md Status; use
the branch this environment allows, open one pull request, merge it yourself when CI is green.
```

### 2. F1: G1 money and permission fixes (Opus 5.5)
```
You are session F1 (G1 fixes), Opus 5.5. Read CLAUDE.md, docs/AUDIT-G1.md section 2 in full, docs/HANDOFF.md (sessions C1, C2,
D2, D3 and their "start from" notes) and docs/BUILD_PLAN.md "S1 revision", row F1.

Fix each finding with a failing test first, in migrations 0103-0109, never editing an applied migration and always starting
from the latest definition of a function (HANDOFF names them):
1. G1-11 first: one migration sets search_path on every function in public (keep "public, extensions, pg_temp" where trigram
   functions are used); scripts/check_permissions.sh fails if any function lacks it.
2. G1-01: the cash-on-delivery tolerance becomes settings.over_short.cod_tolerance_usd (default 0.25). Inside it the
   difference posts to cash_over_short; beyond it and up to 1.00 the shortfall posts to rider_receivable:<driver> with a risk
   flag; above that the collection is refused as today. Add over/short per rider to day_close_report.
3. G1-02: drawer_can_pay() inside the base pay_supplier and cash pay_out_credit, in pay_rider_earnings' "hub pays the rest"
   step, and in record_damaged_note for a hub drop. Fix the two fixtures in test/db/refunds.test.ts and
   receiving-margin.test.ts by dropping the rider's cash at the hub first (D3's note).
4. G1-03: record_damaged_note takes a request key, checks ops lead or admin with require_role, refuses an amount that is not
   positive or exceeds the drop.
5. G1-04: a payment proof for an order cancelled by the payment timer in the last 24 hours is queued as "late payment";
   accept_late_payment(proof, by, reference, amount) books the money to the clearing account and to customer credit, once.
   Show it on the console payments page.
6. G1-05: an overpaid transfer books the surplus to customer credit, not cash_over_short; more than 5% over the total goes to
   the second approval.
7. G1-06, G1-07, G1-08, G1-25: require_role() in every function where a person acts (confirm_payment, review_payment_proof,
   pay_rider_earnings, declare_cash_drop, grant_customer_credit, open_complaint, the pick functions); a request key and a
   balance check in pay_supplier; an explicit role-against-line check in can_send (start from 0063).
8. G1-09: re-check the cash cap at pickup against the total after picking.
9. A test that fails if any script, package or migration stores or shows Nutri-Score, NOVA, eco-score or "high in" levels.

Files: supabase/migrations 0103-0109, test/db/, scripts/check_permissions.sh, apps/console/src/pages/payments.ts and riders.ts
only (session D4 owns the rest of the console).

Done when: every test asserts the ledger sums to zero; no function can take the drawer below zero; the permission script
passes fresh and with EXISTING=1; after deploy-staging the security advisor lists no function without a search_path.

Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets in files or
output; never ask Rasheed; write anything blocked in docs/HANDOFF.md Status; use the branch this environment allows, open one
pull request, merge it yourself when CI is green.
```

### 3. D4: console review pages (Sonnet 5.5)
```
You are session D4 (console review pages), Sonnet 5.5. Read CLAUDE.md, docs/CONSOLE.md, docs/HANDOFF.md (sessions D1, D2, D3,
N1, C3 "Requests for other sessions: Console") and docs/BUILD_PLAN.md "S1 revision", row D4. Keep D1's rules: no insert,
update or delete in the console; the acting party comes from the session; log before acting; plain server-rendered pages.

Build, each page tested through the console's request handler on PGlite as D1's tests do:
1. Names review (/names): load data/proposals/names.json into a new table product_name_proposals by a migration; show current
   and proposed Arabic and English name and size side by side; approve, correct or reject each through review_product_name();
   approving updates the product, which re-queues its search words (0076). Ops lead and admin.
2. Product readiness (/readiness): product_readiness() returns, per product, name approved, approved usable picture, approved
   facts, cost, search words, catalog placement; filters "blocks the catalog" and "blocks ordering"; links to the fixing page.
3. Windows and calendar (/windows): rows of delivery_window_plans and delivery_calendar, one slot's edit (edit_delivery_slot),
   the schedule (delivery_schedule), reschedule_order and cancel_scheduled_order with a reason.
4. Food facts and intake pages: show the basis of every proposal in words (for example "inferred from the ingredient list,
   not printed on the pack"; "from a web page for the Gulf market"); when a label photo and a web source disagree, flag it and
   prefer the label (audit points 1 and 4).
5. staff_actions: an append-only table written by one function with a sequence, replacing the bucket objects as the action
   log (keep log-first-or-nothing); fix apps/console/test/sign-in.test.ts so it no longer depends on the clock (G1-16).

Files: apps/console/ except pages/payments.ts and pages/riders.ts (F1 owns those). Migrations 0110-0114.

Done when: the 282 names load and each action works once on a double tap; a window entered on the page is returned by
open_delivery_windows; pickers are refused by the page and by the database; the console workflow's smoke sweep opens the new pages.

Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets in files or
output; never ask Rasheed; write anything blocked in docs/HANDOFF.md Status; use the branch this environment allows, open one
pull request, merge it yourself when CI is green.
```

### 4. W1: delivery windows for customers (Opus 5.5; after SP1)
```
You are session W1 (delivery windows for customers), Opus 5.5, ordering lane. Read CLAUDE.md, docs/HANDOFF.md session C3
("Requests for other sessions: Lane B", items 1 to 7, and "Known limits") and docs/BUILD_PLAN.md "S1 revision", row W1.

Wire the customer side of scheduled orders exactly as C3 asked: offer open windows with formatWindowChoice when the customer
asks for a time or the plan asks when; read a list tap (interactive.list_reply) in the customer branch of turn.ts with
parseWindowButton and request_delivery_window; after slot_full or slot_closed offer the remaining windows; after change_open
make the next basket a replacement order (link_replacement_order); a lane B overflow migration for quote_order so a scheduled
order's bought-to-order lines need no stock now and opening hours do not block it; answers.ts says the window from
order_status_for; eval cases for a time said in words ("بكرا الصبح", "jumaa ba3d el dohr") before the extraction learns it.
Also: a scheduled order whose fresh goods never arrive gets a "go without that line" action for ops (G1-22).

Files: apps/gateway/src/turn.ts, packages/agents/, evals/. Migrations 0118-0119. Start quote_order from 0077's text.

Done when: a customer picks a window by tap and by words; a full window is never offered; a card can be made after hours for
a window; C3's acceptance test "a full slot refuses a scheduled order" still passes; the language-pack gate still holds.

Rules: CLAUDE.md invariants hold; touch only your files; every language bug becomes an eval case first; npm run typecheck and
npm test must pass; no secrets; never ask Rasheed; write anything blocked in docs/HANDOFF.md Status; use the branch this
environment allows, open one pull request, merge it yourself when CI is green.
```

### 5. A5: infra (Sonnet 5.5; after SP1)
```
You are session A5 (infra), Sonnet 5.5. Read CLAUDE.md, docs/AUDIT-G1.md (G1-13, G1-15, G1-17, G1-18, G1-24, audit points 8
and 11), docs/HANDOFF.md (session K1 "Lane A request", session A4) and docs/BUILD_PLAN.md "S1 revision", row A5.

Do: (1) add CATALOG_FEED_PASSWORD to deploy-staging's secret step and to the names in wrangler.jsonc; (2) a public storage
bucket "catalog" that holds only approved product pictures: copy on approval, remove on withdrawal, and make catalog_feed
return its stable public address (receipts, voice notes and proposed pictures stay in the private bucket; a test proves a
proposed or withdrawn picture is never public); (3) a weekly workflow that reads Supabase database size, storage and egress
and fails above 70% of the plan's limits; (4) fetch media only from Kapso's hosts (an allowlist in payment-proof.ts's and
stt.ts's shared helper; request the change from lane B if you cannot edit packages/agents, and put the helper in packages/wa);
(5) move the typing-indicator call behind one function in packages/wa; (6) a Sentry event when a sent message could not be
marked sent, and mark it from the status webhook's message id; (7) refuse a webhook whose payload has no phone_number_id for
message events; (8) on staging, add one test product through the console and record that its search words appeared (1.23);
(9) run research-load and write the coverage numbers in HANDOFF.

Files: .github/, wrangler.jsonc, packages/wa/, apps/gateway/src/index.ts (not the conversation object), catalog-feed.ts,
scripts/ci/. Migrations 0115-0117. Read staging with workflows only.

Rules: CLAUDE.md invariants hold (never add a message type; one door out); touch only your files; npm run typecheck and npm
test must pass; no secrets in files or output; never ask Rasheed; write anything blocked in docs/HANDOFF.md Status; use the
branch this environment allows, open one pull request, merge it yourself when CI is green.
```

### 6. R4: research remainder (Sonnet 5.5) (DONE 14 November; kept for the record)
```
You are session R4 (research), Sonnet 5.5. You write only docs/RESEARCH_REGISTER.md. Read it, then answer its section "Not
checked in this session" (eight items) with about 14 web searches: official sources first, the date checked, facts kept apart
from assumptions, and for each item the decision it changes. Do not repeat what is already checked. No product code.
Rules: no secrets; never ask Rasheed; use the branch this environment allows, open one pull request, merge when CI is green.
```

### 7. H1: repo hygiene (Sonnet 5.5; after each wave)
```
You are session H1 (repo hygiene), Sonnet 5.5. Read CLAUDE.md and docs/SYSTEM_PLAN.md section 18. One pull request, tests
green: delete merged branches, dead code, unused scripts and workflows and TEST_REPORT.txt; move finished Status sections of
docs/HANDOFF.md into docs/history/ (keep the business rules, "how to run", the current state and every open request); delete
files under data/research and data/proposals that are loaded and approved in the database (check with the coverage functions
through a workflow first; keep any that still back a pending proposal); list file sizes over 1 MB and this month's Actions
minutes in the pull request; update dependencies with the lockfile. Change no behaviour: no file under apps/, packages/ or
supabase/ changes except deletions of dead code proven unused by typecheck and tests.
Rules: CLAUDE.md invariants hold; npm run typecheck and npm test must pass; no secrets; never ask Rasheed; merge when CI is green.
```

### 8. M1: message design (Opus 5.5; after W1)
```
You are session M1 (message design), Opus 5.5, ordering lane. Read CLAUDE.md, docs/SYSTEM_BRIEF.md section "Message design"
(rules and the Arabic and English examples), docs/SYSTEM_PLAN.md section 14, docs/AUDIT-G1.md G1-23.

Build: one template file per language (packages/agents/src/messages/ar.ts, en.ts, fr.ts) holding every fixed message: the
order card, status updates, closed and kept order, location request and confirmation, payment messages, window choice,
substitution question, what changed at the shelf, and the ops-line cards. Code builds them; the model writes none of them.
The model's own replies are at most two short sentences (enforce in the output guard). A test checks the brief's nine rules
on every template in three languages and writes a snapshot file per language into the pull request. Product names follow the
conversation's language; a missing Arabic name falls back to English and is logged. "How much in lira?" gets a fixed answer
computed from current_fx(). Submit utility templates in ar, en, fr for the code-started messages that can fall outside the
24-hour window (G1-23) and wire each to its event with a stable dedupe key.

Files: packages/agents/src/messages/ (new), order-card.ts, answers.ts, the fixed strings in turn.ts and ops-turn.ts,
templates/. Migrations 0120-0121. Do not change what any message means, any price source, or the gateway's allowlist.

Done when: the rules test and the snapshots pass; every existing flow test passes with the new wording; no price appears in
model-written text; the language-pack gate still holds.

Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets; never ask
Rasheed; write anything blocked in docs/HANDOFF.md Status; use the branch this environment allows, open one pull request,
merge it yourself when CI is green.
```

### 9. I1: intake pipeline (Opus 5.5; after D4 and A5)
```
You are session I1 (product intake pipeline), Opus 5.5. Read CLAUDE.md (invariants 14, 15, 21), docs/SYSTEM_PLAN.md section 4,
data/research/README.md, docs/HANDOFF.md sessions P1, P2, N1, D2, and docs/DECISIONS.md conflict register C6 (approved 14 Nov).

Build: product_intake_jobs with the eight steps; a trigger on products and a one-time enqueue of the 291 items; a scheduled
workflow (intake.yml) that takes a few jobs a run and, for the research step, calls the fast model with web search under the
README's rules and writes the same file shape P2's loader reads (reuse the loader, the picture evaluation and the fact checks
unchanged); retries three times, then a review list with the reason. auto_approval_rules, try_auto_approve() and
auto_approvals exactly as the table in SYSTEM_PLAN 4 (C6 is approved). Rules ship enabled only for the rows of that table
(picture, names/size/category, search words, ingredients/nutrition), each switched on only after its first passing spot check;
pictures from shops' public pages always need a person; allergens, diet labels, prices and
costs have no rule and a test proves no input can auto-approve them; a daily random tenth for a spot check and a failed check
disables the rule; the console page autoapprovals.ts.

Files: scripts/intake/ (new), scripts/images/, scripts/product-data/, .github/workflows/intake.yml,
apps/console/src/pages/autoapprovals.ts. Migrations 0122-0127. No new agent: every AI step is a narrow function.

Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets; never ask
Rasheed; write anything blocked in docs/HANDOFF.md Status; use the branch this environment allows, open one pull request,
merge it yourself when CI is green.
```

### 10. C4: commerce core (Opus 5.5; after F1)
```
You are session C4 (commerce core), Opus 5.5. Read CLAUDE.md (invariants 3, 4, 12, 17, 19), docs/SYSTEM_PLAN.md section 1,
docs/WEBSITE.md "Identity and consent", docs/DECISIONS.md conflict register C1 (approved 14 Nov), docs/AUDIT-G1.md G1-12.

Build, database and package only (no website, no change to turn.ts): orders.channel and orders.request_key; web_sessions,
link_codes, carts, cart_lines; functions web_session_start, web_link_code, claim_link_code, cart_set_line, cart_view,
checkout_quote (wrapping plan_cart and quote_order; no new pricing); confirm_order_checked accepting a request key in place of
a WhatsApp message id only for a session whose party was linked by a claimed code, and only if settings.web.confirm_on_page is
true. C1 is approved (invariant 4 now reads "a customer's own confirm action on a channel where we verified them"), so the
migration sets it to true; the agent still can never confirm, and a session not linked by a claimed code still confirms only
by the WhatsApp tap; a database role
web_channel with EXECUTE on the listed customer functions and nothing else; packages/commerce, a typed client with no logic.

Files: packages/commerce/ (new), scripts/check_permissions.sh, supabase/migrations 0128-0133, tests. Start
confirm_order_checked from C3's text (0040).

Done when: one basket through the chat path, a catalog cart and the commerce client gives the same lines, totals and ledger;
web_channel can call no staff or money function (a new section of the permission script); a link code is single use, expires
and cannot be claimed by a second phone; the agent still cannot confirm.

Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets; never ask
Rasheed; write anything blocked in docs/HANDOFF.md Status; use the branch this environment allows, open one pull request,
merge it yourself when CI is green.
```

### 12. WEB1: website, read side (Sonnet 5.5; after C4 and A5)
```
You are session WEB1 (website, read side), Sonnet 5.5. Read CLAUDE.md (invariants 7, 14, 15, 19), docs/WEBSITE.md,
docs/RESEARCH_REGISTER.md (b), docs/SYSTEM_PLAN.md section 1.
Build apps/web/: an Astro 6 project with the Cloudflare adapter, rendered on the server, deployed as its own Worker by
.github/workflows/web.yml to staging. Pages: home, category, product, search, privacy and terms placeholders; Arabic (right to
left) and English from one set of templates; installable shell (manifest, icons, a service worker that caches only the shell
and catalog pages). It reads through packages/commerce as the database role web_channel, never with the service key. Only
approved pictures (from the public catalog bucket) and approved food facts with their status and the Open Food Facts credit;
unknown is shown as not verified; no ratings and no health words. Search uses the same matcher as the chat and logs misses.
Files: apps/web/ (new), .github/workflows/web.yml, migrations 0154-0155 (read functions for web_channel only).
Done when: pages render from the database with JavaScript off; no unapproved picture or fact can render (tests); "labne",
"لبنة" and "labneh" find the same product; a page weighs under 100 KB before pictures; deployed to staging.
Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets; never ask
Rasheed; write anything blocked in docs/HANDOFF.md Status; open one pull request, merge it yourself when CI is green.
```

### 13. D5: console cockpit (Sonnet 5.5; after D4 and F1; C8 approved 14 Nov)
```
You are session D5 (console cockpit), Sonnet 5.5. Read CLAUDE.md, docs/CONSOLE.md ("The shell", "Run the day", "Tests the
redesign adds"), docs/RESEARCH_REGISTER.md (f). C8 is approved (docs/DECISIONS.md): build the full redesign, keeping every form and function as built.
Build: the shell (one stylesheet with tokens, bottom navigation on phones, Arabic and English, 44 px controls), installable
(manifest, icons, a service worker that caches the shell only, an "Add to Home Screen" guide on iPhone), web push for new
high-priority exceptions (push_subscriptions, VAPID keys as Worker secrets; the WhatsApp ops alert stays), Today as an
exception inbox, the orders page with its timeline. Change nothing a form posts: every existing page test must pass unchanged.
Files: apps/console/. Migrations 0158-0159.
Rules: CLAUDE.md invariants hold; touch only your files; npm run typecheck and npm test must pass; no secrets; never ask
Rasheed; write anything blocked in docs/HANDOFF.md Status; open one pull request, merge it yourself when CI is green.
```
