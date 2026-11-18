# Next sessions

Rules, gates, the sessions still to run and their prompts. Trimmed on 18 November 2026 by session DOC2: the finished sessions' prompts, the
old run-order table and the per-session status notes are in `docs/log/next-sessions-*-2026-11-18.md` (history; never build from them).
Status and the critical path are in `docs/STATUS.md`; every rule and setting value is in `docs/RULES.md`; roadmap rows in `docs/BUILD_PLAN.md`;
the strategy behind this file is in `docs/strategy/` (start with its `README.md`).

## Rules for every session
1. Read `CLAUDE.md`, then `docs/STATUS.md` and `docs/RULES.md` **in full** (they are short on purpose), then the strategy section your prompt names. Open a file in `docs/log/` only when you need what an earlier session wrote; never read `docs/HANDOFF.md` for status (it is a pointer).
2. The invariants in `CLAUDE.md` hold. Every behaviour change starts with a failing test.
3. Migrations: use only the numbers reserved for the session; never edit an applied one.
4. No secrets, real phone numbers, pins or real names anywhere. Seed and test data are invented.
5. Never ask Rasheed. Anything only he can do goes into `docs/STATUS.md`, "Open founder actions", with exact clicks (a long walk-through may live in your log, linked from there).
6. Never dispatch `deploy-staging` from a branch. Merge `main` before merging. One pull request at a time, merged when CI is green.
7. A model is called only through a workflow that records its cost and has a dollar cap.
8. **Screen work (changed 18 November; `docs/DECISIONS.md`, "Founder decisions, 18 November 2026", 7).** Screenshots (390 and 1280 or 1440 px, Arabic and English, light and dark) are **never committed** (CI refuses any image under `docs/` and any file over 300 KB). Dispatch the `screens` workflow (action `shoot`, your test file under `test/screens/`, your session's lower-case name) on your branch: it runs the test in Chromium and uploads to the private bucket `screens`, replacing older screenshots of the same pages. They show on the console's **Screens** page beside the reference's matching screen. A website page's first-visit weight is reported per page in the pull request (the 100 KB budget is lifted; free savings stay).
9. Do not change vendor tables, village names or locations.
10. **Design follows the founder's reference (`docs/DECISIONS.md`, "Design reference, 17 November 2026" and "Founder decisions, 18 November 2026", 2).** The website must look like the reference on every page, phone and desktop: the reference's React components rendered by Astro on the server (`@astrojs/react`, Tailwind 4), islands only where a page is interactive; one palette (`packages/ui/tokens.css`, no second set of colour values); Arabic mirrored with start/end classes, never by hand; only the look comes from the reference (no demo data, demo store, localStorage logic or invented numbers). The console is unchanged (no React in the console). The reference's own screens are `ref-*` on the Screens page.
11. **Finish by:** writing your report to `docs/log/<session>.md` (built, tested, not proven, decisions, founder actions); updating `docs/STATUS.md` **only where its facts changed** (a step's state, what is live on staging, open founder actions, the session table, migration numbers) and `docs/RULES.md` if a rule or a setting value changed; your row in `docs/BUILD_PLAN.md`. `docs/STATUS.md` stays under 400 lines.
12. **Testing and model spend (coordinator, 16 November; `docs/DECISIONS.md`, "Coordinator decisions, 16 November 2026"; confirmed 18 November: model credits are for live testing).** Fifteen full
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
13. No git history rewrite until the repository goes private (PRIV).

## Gates
| Gate | Opens | Needs |
|---|---|---|
| **A** | The friends' test (Rashid and three friends on the US number; since 18 November it includes food) | **Code no longer blocks it** (HO1, B1a, B1b, CX1, DS1, D4b, PD1, SR1, LB1, WH1a, SELL1 and the rest are merged). What blocks it: pictures approved; the label day (photos of every packaged item in stock) and its readings approved, allergens, halal and hazard warnings decided by a person; stock bought and received; every active item at least "sellable" and every stocked item photographed and read; `sell_requires_label` turned on with every packaged item in stock label-ready; the menus (Safa Chicken and up to 10 Baqaata places) photographed and approved; the WhatsApp catalogue set up; then T1. Already done: Arabic strings read (AR1, 16 November); zero silences after a hand-off. The critical path with owners and clicks is the first table of `docs/STATUS.md`. |
| **B** | The shadow run (staff and family, cash only, 7 days, 100 orders) | WH1a (built), RD1, OPS1, OPS2, AUD1, A3 merged; a nightly backup and a passed restore check; the hub with backup power and a temperature log; real costs entered; blended margin at least 15% |
| **C** | The paid pilot | The SARL; Meta verification; the lawyer's and accountant's answers; RCPT1; PAY1 switched on or cash only by decision; G2's blockers fixed; Supabase Pro; the numbers; auto-reload on with a limit |

Stop conditions: `docs/strategy/01-verdict-gates.md`.

## Sessions still to run
Done, built and running sessions are in `docs/STATUS.md`, "Sessions". Order is by wave; at most three at once.

| Session | Model, effort | Waits for | Migrations | Done when |
|---|---|---|---|---|
| **FD2** friends' test food, ordering: a tester orders a dish from a place FD1 opened (`product_orderable_for`, `places_for`, `dish_facts_status`, the option groups); the quote with the dish's price, the zone's delivery fee and `food.service_fee_usd`; the card and the customer's own confirm; Alo King buys for the customer (the rider orders and pays at the counter, or staff call it in) | Opus, high (proposed) | FD1 (merged) | Next free number | A tester can order from Safa Chicken and a Baqaata place; a non-tester cannot see or order from either; the ledger shows the buy-for-the-customer order closing with a recorded payment |
| **T1** friends' test set-up | Opus, medium | The critical path of `docs/STATUS.md` up to "WhatsApp catalogue" | 0134 | Four testers and one rider phone work end to end on staging; the nightly report; it checks gate A |
| **WEB4a** (was DS3) the website to the reference: every page, phone and desktop, by rule 10. **Done: stage 1 (the frame and the home page) and stage 2 (aisles, an aisle, product, search) approved by the founder and merged on 18 November** (`docs/log/web4a.md`) | Opus, high | Done | 0243, 0244 | Each page beside its `ref-*` screen on the Screens page; `packages/ui/tokens.css` the only palette; Arabic by start/end classes; weights reported per page |
| **B1f** search and product data. **Done 18 November** (`docs/log/b1f.md`): «لبنة», the eggs, the by-weight items and their weights list, the three ordering items, CX2's sim turn errors | Opus, high | Done | 0253 | The smoke test's known-failure branch removed; «لبنة» a real check |
| **L1** event log, timeline, measured times, places | Opus, high | Gate A open | 0149 to 0152 | `events` and `log_event()`; an order timeline; proposals for times and landmarks |
| **N2** nightly checks and learning | Sonnet, medium | COST1 (merged) | 0186 | The full language run nightly within its cap; "what the system learned" |
| **RD1** rider pack | Opus, high | L1 merged | 0160 to 0163 | Application, terms by tap, training job, guarantee report, rounds, village pause, plain cash-cap message |
| **AN1** reports and the daily summary | Sonnet, high | L1 merged (UX2 done) | 0164 to 0166 | The nine reports with comparisons and CSV; the daily summary replaces the nightly message |
| **PAY1** payment core and adapters | Opus, high | CX1 (merged) | 0167 to 0171 | Intents, webhooks stored first, MontyPay and areeba adapters and a Whish shell against fakes; everything off by a switch |
| **RCPT1** receipts and lira display | Sonnet, medium | CX1 (merged) | 0172 to 0173 | Lira total, rate, date and time on the card and receipt as a setting; receipt numbers; tax per line |
| **AUD1** audit of what the planning chat could not reach | Sonnet, high | Nothing | 0176 to 0177 | GitHub settings, Supabase advisors, Cloudflare secrets and routes, Kapso settings read and listed; row security on every table |
| **SH1** Send Home | Opus, medium | PAY1 merged | 0174 to 0175 | Buyer and recipient apart, gift flag; off by a switch; takes the reference's design behind its switch |
| **OPS2** runbooks | Sonnet, medium | RD1, WH1a merged | None | Ten one-page procedures in Arabic and English |
| **A3** production environment | Opus, high | AUD1, BK0 merged; the domain | None | A production project with BK0 pointed at it and a passed restore; production Workers on the domain |
| **G2** audit before the pilot | Fable, high | Gate B passed | None | Every blocker listed with a test |
| **V1** voice provider scoring | Sonnet, medium | The 51 corrected notes | None | Item accuracy per provider; a recommendation |
| **AN1b** founder assistant | Sonnet, high | AN1 merged | 0182 | Six read-only tools; a role that can only read |
| **WH1b** warehouse, second part | Opus, high | Two weeks of shadow or pilot data | 0183 to 0185 | Camera scanning, invoice reading, the evening purchase proposal |
| **RET1** retention | Sonnet, medium | The lawyer's periods | 0181 | Voice, pictures and chat deleted on schedule, logged |
| **BK1** list photo to basket | Opus, high | SR1 (merged); gate A open | 0195 to 0197 | A photo of a handwritten list becomes a card the customer confirms |
| **WEB3** the assistant on the website | Opus, high | WEB2 (merged); gate B passed | 0219 to 0220 | The same Concierge in a chat panel; confirmation is the signed-in session's own button |
| Later | LOY1 stamp card and "the usual"; E1 to E3 vendors | Opus | Four clean pilot weeks; a signed vendor | | |
| Last | **PRIV** make the repository private | Founder, with a Sonnet check | The build finished | | Private; Actions usage checked; the history question closed |

## The staff line during testing
Kapso's sandbox sends buttons but no templates, and only to one registered phone, so pickers use the console pick queue and one rider
phone is registered; the full rule, and the January Meta verification paths, are in `docs/strategy/06-session-plan.md` sections 4 and 5.

## Prompts
The prompts of finished sessions are in `docs/log/next-sessions-prompts-finished-2026-11-18.md`.

### T1 (Opus, medium)
```
You are session T1 (friends' test set-up), Opus, medium effort. Read
docs/strategy/06 sections 2 and 4 and the critical path in docs/STATUS.md.
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


### L1, N2, RD1, AN1, PAY1, RCPT1, AUD1, SH1, OPS2, A3, G2, V1, AN1b, WH1b, RET1
Each uses this text with its own line from the table in section 3:
```
You are session <NAME> (<title>), <model>, <effort>. Read CLAUDE.md,
docs/STATUS.md and docs/RULES.md (in full), and docs/strategy/<file and section>. Migrations
<range>. Build exactly what that section and the session's "Done
when" in docs/strategy/06-session-plan.md describe, each behaviour
with a failing test first. Anything the section leaves open, decide
the simplest way that keeps the invariants and record it in
DECISIONS. Rules: the block at the top of docs/NEXT_SESSIONS.md;
never ask Rasheed; one pull request.
```
| Session | Read |
|---|---|
| L1 | `03` section A (event log, what to record, delivery time) |
| N2 | `03` section A (rhythm) |
| RD1 | `02` section 3 |
| AN1 | `05` section A (reports) |
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

