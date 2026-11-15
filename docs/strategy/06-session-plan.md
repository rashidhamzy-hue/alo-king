# Alo King strategy, part 6: the session plan

Planning chat, 15 November 2026. At most three sessions at once. Every prompt below is paste-ready. Sessions after the friends' test get their prompts re-issued by the coordinator with what the test found; the ones here are the starting text.

---

## 1. Rules for every session (DOC1 puts this block at the top of `docs/NEXT_SESSIONS.md`)
1. Read `CLAUDE.md`, the Status part of `docs/HANDOFF.md`, and the strategy section the prompt names, before anything else.
2. The invariants in `CLAUDE.md` hold. Every behaviour change starts with a failing test.
3. Migrations: use only the numbers reserved for the session; never edit an applied one.
4. No secrets, real phone numbers, pins or real names anywhere. Seed and test data are invented.
5. Never ask Rasheed. Anything only he can do goes into HANDOFF "Founder actions", with exact clicks.
6. Never dispatch `deploy-staging` from a branch. Merge `main` before merging. One pull request at a time, merged when CI is green.
7. A model is called only through a workflow that records its cost and has a dollar cap.
8. Screen work: screenshots at 390 and 1440 px, Arabic and English, light and dark, attached to the pull request.
9. Do not change vendor tables, village names or locations.
10. Finish by updating HANDOFF Status (built, tested, not proven), the session's row in BUILD_PLAN, and NEXT_SESSIONS.

## 2. Gates
| Gate | Opens | Needs |
|---|---|---|
| **A** | The friends' test (Rashid and three friends on the US number) | HO1, B1, CX1, DS1, D4b, T1 merged; pictures approved; Arabic strings read by a person; the simulated customers show zero silences after a hand-off |
| **B** | The shadow run (staff and family, cash only, 7 days, 100 orders) | WH1a, RD1, OPS1, OPS2, AUD1, A3 merged; a nightly backup and a passed restore check; the hub with backup power and a temperature log; real costs entered; blended margin at least 15% |
| **C** | The paid pilot | The SARL; Meta verification; the lawyer's and accountant's answers; RCPT1; PAY1 switched on or cash only by decision; G2's blockers fixed; Supabase Pro; the numbers; auto-reload on with a limit |

Stop conditions: `01-verdict-gates.md`.

## 3. Sessions in run order
| Wave | Session | Model, effort | Waits for | Runs beside | Files | Migrations | Done when |
|---|---|---|---|---|---|---|---|
| 0, now | **DOC1** strategy into the repository | Sonnet, medium | Nothing | PUB1, BK0, SIM1 | `docs/` only | None | Strategy files, the brief, the rules block, plan rows and decisions are on `main`; no code changed |
| 0 | **PUB1** public-repository hygiene | Sonnet, medium | Nothing | DOC1, BK0 | `scripts/ci/`, `.github/workflows/ci.yml`, `.gitleaks.toml`, `test/ci/`, `package.json` | None | A planted phone number, pin, plus code or key fails CI and the pre-commit hook; CI tools pinned with checksums |
| 0 | **BK0** free backups and restore check | Sonnet, medium | The founder's passphrase secret | DOC1, PUB1 | `.github/workflows/backup.yml`, `restore-check.yml`, `scripts/backup/`, `docs/RUNBOOK.md` | None | One encrypted copy stored; one restore check green; an alert when a copy is older than 36 hours |
| 1 | **HO1** never-stranded hand-off | Opus, high | SIM1's report merged | COST1, OPS1 | `apps/gateway/src/turn.ts`, `packages/agents/src/messages/`, `apps/console/src/pages/inbox.ts` (new) | 0135 to 0138 | The tests in `05`, section D; a plain Inbox page works |
| 1 | **COST1** cost recorded, capped | Sonnet, medium | SIM1's report merged | HO1, OPS1 | `.github/workflows/*`, `scripts/` that call a model | 0139 | Every model-calling workflow writes tokens and dollars to a table and its summary, and stops at its cap |
| 1 | **OPS1** alerts that wake someone | Sonnet, high | Nothing | HO1, COST1 | `apps/console/` (push, roles, settings pages), `apps/web/` (Sentry) | 0140 to 0142 | A test case pushes to a phone; staff can be added and blocked in the console; template-health page; sign-in throttle; Sentry in all three Workers |
| 2 | **B1** ordering fixes from SIM1 | Opus, high | HO1 merged | DS1, PIX | `packages/agents/src/` (reading, planner, guard), `evals/` | None | The report's ranked classes pass their new cases; the language gate holds; 150 simulated conversations re-run with those classes at zero |
| 2 | **DS1** design system and flagship screens | **Fable, high** | OPS1 and HO1 merged; the crown picture attached | B1, PIX | `packages/ui/` (new), Today, Inbox and Orders pages, the website's home, category, search and product | None | The gallery; the screens rebuilt; every existing test passes; screenshots |
| 2 | **PIX** pictures | Sonnet, medium | Nothing | B1, DS1 | Picture scripts and workflow only | None | A candidate for every item; the 20 fastest sellers first in the queue; duplicate and wrong-pack checks |
| 3 | **CX1** customer pack | Opus, high | B1 merged | D4b | `packages/agents/src/`, `packages/commerce/`, card and order functions | 0143 to 0146 | Welcome with the privacy line; missing-item choice; "which note" and keep-the-change; self-service cancel until picking; handover code; pickup |
| 3 | **D4b** pick queue and rider jobs on the console | Sonnet, high | DS1 merged | CX1 | `apps/console/src/pages/` (new pages) | 0147 to 0148 | A picker completes an order with no WhatsApp; ops can act for a rider; rider incident pages |
| 4 | **T1** friends' test set-up | Opus, medium | CX1, D4b, DS1 merged; pictures approved; Arabic read | WEB2, UX2 | Test accounts, the daily test report, `docs/` | 0134 | Four testers and one rider phone work end to end on staging; the report arrives nightly |
| 4 | **WEB2** cart, checkout, tracking | Opus, high | CX1 merged | T1, UX2 | `apps/web/`, the web functions | 0178 to 0180 | One order placed on the site and one on WhatsApp are identical in price and ledger |
| 4 | **UX2** every remaining console page | Sonnet, high | DS1, D4b merged | T1, WEB2 | `apps/console/src/pages/` | None | All pages on the components, bilingual; the navigation of `05`, section A |
| 5 | **L1** event log, timeline, measured times, places | Opus, high | Gate A open | WH1a, N2 | `supabase/`, gateway rider steps, console proposals tab | 0149 to 0152 | `events` and `log_event()`; an order timeline; proposals for times and landmarks |
| 5 | **WH1a** warehouse basics | Opus, high | D4b merged | L1, N2 | `supabase/`, console Stock pages | 0153 to 0157 | Lots and first-to-expire; bins; temperature log by photo; packing checklist; simple purchase orders |
| 5 | **N2** nightly checks and learning | Sonnet, medium | COST1 merged | L1, WH1a | `.github/workflows/nightly.yml`, statistics views | 0186 | The full language run nightly within its cap; "what the system learned" |
| 6 | **RD1** rider pack | Opus, high | L1 merged | AN1, UX3 | Staff-line flow, `supabase/`, console Riders | 0160 to 0163 | Application, terms by tap, training job, guarantee report, rounds, village pause, plain cash-cap message |
| 6 | **AN1** reports and the daily summary | Sonnet, high | L1, UX2 merged | RD1, UX3 | Report views, console Reports | 0164 to 0166 | The nine reports with comparisons and CSV; the daily summary replaces the nightly message |
| 6 | **UX3** remaining website pages | Sonnet, medium | WEB2 merged | RD1, AN1 | `apps/web/` | 0187 | How it works, sign-up forms, privacy and terms shells, vendor pages hidden behind a switch |
| 7 | **PAY1** payment core and adapters | Opus, high | WEB2 merged | RCPT1, AUD1 | `packages/commerce/`, `supabase/`, a webhook route | 0167 to 0171 | Intents, webhooks stored first, MontyPay and areeba adapters and a Whish shell against fakes; everything off by a switch |
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
| Later | LOY1 stamp card and "the usual"; BK1 basket builder and list photo; E1 to E3 vendors | Opus | Four clean pilot weeks; a signed vendor | | | | |
| Last | **PRIV** make the repository private | Founder, with a Sonnet check | The build finished | | | | Private; Actions usage checked against the free allowance; the history question closed |

## 4. The staff line during testing (no +961 numbers yet)
Kapso's sandbox sends buttons but no templates, and only to one registered phone. So during all testing:
- **Pickers use the console pick queue** (D4b), not WhatsApp. That is the launch design anyway.
- **One rider phone is registered on the sandbox** (Bassem's, or a second phone of Rashid's). The rider opens the day with a "start shift" message, which keeps the 24-hour window open; no template is needed.
- **A second rider, transfers and batching** are tested two ways: the existing database tests, and D4b's "act for a rider" buttons on the console, which stay useful when a real rider's phone dies.
- **Alerts to ops** go by console and phone push (OPS1), not the staff line.
- **Customers:** Rashid and three friends on the US number.
- **Recommendation for the next numbers decision:** keep the US number through the shadow run as well, since its users are staff and family. Buy and register the +961 lines once, in January, on whichever Meta portfolio is verified. That removes any need to move a number.

## 5. January: Meta verification, both outcomes
**Path 1: verify the existing portfolio (try first)**
1. Papers in hand: the commercial registration, the tax number certificate, and one document showing the company name with its address and phone.
2. The domain live, the website footer showing the registered name, address and phone, and one mailbox on the domain.
3. Business settings, Business info: the legal name, address, phone and website typed exactly as on the papers.
4. A second admin on the portfolio.
5. Security Centre: start verification, upload the papers, confirm by the domain email or the listed phone.
6. Approved: add the two +961 lines, submit the display name, re-check each template's category, raise limits as Meta allows.
7. Refused: correct the mismatch Meta names and resubmit once. A second refusal, or ten working days with no decision, moves to path 2.

**Path 2: a new portfolio in the company's name**
| | |
|---|---|
| Who creates it | A partner whose Facebook account can still create one; two admins from the start |
| What moves | Nothing has to: the +961 lines were never registered elsewhere, so they are registered fresh. Our own database keeps every customer, order and chat |
| What is rebuilt | The WhatsApp account through Kapso; every template resubmitted from `templates/` (the workflow exists); the Meta catalogue reconnected to the feed; new number ids and webhook secrets in the deploy secrets |
| What is lost | The US number's history and quality record (it stays as a test number on the old portfolio); the approval state of today's templates; the old catalogue |
| How long | Portfolio, account and numbers: one day. Display name and templates: one to three days. Verification: typically two to ten working days. About two weeks in all |
| Cost of being wrong | None if no +961 line was put on the old portfolio. That is why the lines wait |

---

## 6. Prompts

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

### B1 (Opus, high)
```
You are session B1 (ordering fixes from the simulated customers),
Opus, high effort. Read docs/SIM_REPORT_2026-11-15.md and
evals/cases/sim_*.json. Fix the failure classes in the report's
ranked order, each on its failing cases: at least the minimum-order
loop that never states the amount, Arabic-Indic digits copied into
replies, the substitute question asked twice, and the two carried
ordering bugs in HANDOFF (the size-only line; «بدي أغراض لمجدرة»).
No change to hand-off code. Done when: the new cases pass; the
language gate holds (wrong products 0, F1 at least 0.90); sim-test
with limit 150 shows those classes at zero. Rules: the block at the
top of docs/NEXT_SESSIONS.md.
```

### DS1 (Fable, high) — attach the crown picture
```
You are session DS1 (design system and flagship screens), Fable,
high effort. Read docs/DESIGN_BRIEF.md, docs/strategy/05 sections A,
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
