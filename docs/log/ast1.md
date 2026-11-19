# AST1: the console assistant (19 November 2026)

Session AST1 (Opus 5.5). Prompt: the coordinator's (one assistant on every console page, in CON1's reserved place, that knows the state
of Alo King and answers in plain words, Arabic or English, like a sharp operations manager; it never changes anything). The choices the
build made are `docs/DECISIONS.md`, "AST1, the console assistant, 19 November 2026" (13 rows; nobody was asked). Migrations **0261** and
**0262**. No new agent that acts, no new way to send, no WhatsApp; no write to an order, payment, stock level or ledger entry
(invariants 1, 3, 19, 21). Kabsi not touched. AUTO1's files not touched (none had reached `main` when this was merged).

## Built
1. **Read-only tools, enforced by Postgres** (0261). A role `assistant_reader` (no login, no attribute) holds SELECT on the tables its
   tools read, a SELECT-only row policy on each, EXECUTE on the read helpers they call, nothing else. Every `assistant_*` function is
   security definer, stable, with a fixed path, and **owned by that role**: a write inside one is refused (a test writes one and sees the
   refusal). Only the service role may call them. `scripts/check_permissions.sh` checks it on CI and on every staging deploy.
   The tools: `assistant_orders` (a day's counts by status and kind; late orders against their promise with the slowest stage: picking,
   restaurant, waiting for a rider, ride), `assistant_places` (call-ahead answer times, accepted, refused, closed today, prices to confirm),
   `assistant_riders` (on shift, cash against the caps, deliveries, late pickups over 15 min), `assistant_stock` (out, low, expiring,
   short or damaged on receiving, fridge readings missed or out of range), `assistant_products` (not sellable and why, no approved photo,
   price bases to confirm, searches that found nothing), `assistant_customers` (hand-offs, complaints, honest-answer cases, feedback; phones
   masked to the last two digits, never a customer's own words), `assistant_approvals` (waiting by kind, approved automatically today),
   `assistant_money` and `assistant_model_spend` (admin only).
2. **The digest, the settings, the cost, the log** (0262). `settings.assistant` (enabled, daily_cap_usd 0.50, monthly_cap_usd 10, model
   claude-sonnet-5-5, digest_model claude-haiku-5-5, max_tool_rounds 4; the first three on the Settings page). `ast_record_cost` prices each
   call from `model_prices` into `model_costs` (workflows `assistant`, `assistant-digest`); `ast_spend` says whether one more answer fits the
   caps. `assistant_digests` (one row a day: the facts and the text, English and Arabic) with `assistant_digest_facts` (the day's facts from
   the tools and the fix candidates in a fixed order). `assistant_turns` (question, answer, tools, cost, outcome).
3. **The console** (`apps/console/src/assistant/`, `pages/assistant.ts`): the turn loop (Sonnet 5.5, effort low, prompt caching on the
   system prompt and tools, at most 4 rounds of tool calls), the honesty check (every figure from that turn's tool results; one rewrite,
   else the answer is not shown), links only to console pages, the answer drawn as escaped text. Roles: the admin every tool, an ops lead no
   money totals, a picker none (no button, no panel, 403). The panel beside every lead's page (1280 px and up) with the three starter
   questions and a box; the answer comes into the panel through `/shell.js`; the phone's button opens `/assistant`. The admin sees each
   answer's cost and the day's and month's spend. Over a cap: "budget used up", and the model is not called.
4. **The nightly digest** with the day-close cron (21:40 Beirut): Haiku 5.5 writes it from the facts in English and Arabic; its figures are
   checked against the facts; Today shows the latest ("Digest of <day>"). Only while the assistant is on and under its caps. Never sent.
5. **Outside reads**: Sentry (CON1's read-only token; the count and the five most frequent issues); GitHub Actions failed runs with a
   read-only token (`GITHUB_READ_TOKEN`, `GITHUB_REPO`), not offered without it.

## Tested (USD 0 except the live run)
- `test/db/ast1-assistant.test.ts` (15): each tool against the invented day (`evals/assistant/world.ts`); every `assistant_*` function
  owned by `assistant_reader`, security definer, stable, fixed path; the role holds no write privilege and no attribute; writes as the
  role refused (orders, payments, stock, ledger, settings, the assistant's own log); a writing function given to the role cannot write;
  the settings, pricing and caps (over the cap: not allowed; no price: refused); the digest's facts and candidates; the log.
- `apps/console/test/ast1.test.ts` (15): through the console: an ops lead's question answered from the orders tool with a link, money
  tools never offered, the cache marks, the role and the day in the message, the turn and its cost recorded; the admin's cost line and
  spend; the form without the script; the picker refused; a made-up figure rewritten once, then refused if it stays; links to other sites
  stripped; Arabic digits and rounding; over the cap and off; the digest written (a made-up figure asked again) and shown on Today; not
  written while off; Sentry's and GitHub's readers (URLs, read-only tokens, a failure is unknown, never 0).
- `evals/assistant/test/assistant-eval.test.ts` (21): **the twenty founder questions** with a scripted model through the real turn code:
  each calls its tools, passes the honesty check, holds every expected fact and no forbidden word, in the right language.
- `test/screens/ast1.test.ts` (Chromium; the `screens` workflow, session ast1): the panel beside Today answering a starter question in
  place, `/assistant` on a phone and a laptop, light and dark, Arabic and English (12 screens); no sideways scroll at 390 px; every
  control 44 px; a picker sees no assistant.
- Updated: `con1.test.ts` (the button and panel are for leads; `/assistant` is reached by its button), `shell.test.ts` (unchanged
  behaviour), `model-cost-cost1.test.ts` (the eval is metered, its cap 0.50), `design-system.test.ts` (the sheet's ceiling 70,000 → 72,000).
- `npm run typecheck`, `npm test`, `npm run check:personal-data` (gitleaks 8.21.2), the repository hygiene check: see the pull request.

## The live run (once, at the end)
**assistant-eval run 44575163810** (19 November 2026, on this branch at 4a883e7, cap USD 0.50): **20 questions, 39 facts, 0 wrong,
no tool missing, no forbidden word, every answer in the right language: the kill-gate passes**, so 0262 sets `settings.assistant.enabled`
**true**. 38 calls to claude-sonnet-5-5, **USD 0.1172** in all (input 19,908, output 4,990, cache read 116,402, cache write 6,341 tokens;
recorded in `model_costs` on staging, workflow `assistant-eval`), about USD 0.006 a question; 1 to 5 seconds each.
What the answers showed beyond the grade (read from the run's report, kept as follow-ups, not changed after the run):
- "What happened yesterday?": the model also read the orders and money tools for the 17th, found no orders that day where the digest
  said 11 (the invented day has a digest for the 17th but no orders), and said so plainly instead of choosing one. Honest. It also showed
  that `money`'s cash to collect and riders' cash are "now", whatever day is asked: a follow-up should say so in the tool's result.
- The model called riders "he" and "she" from their names. A follow-up line in the prompt: refer to people by name.
- After the run only grants changed in 0261 (client roles lose their grants on the tables given a read policy, for the permission
  check on real Postgres), and `enabled` in 0262: no tool's output, prompt or turn code changed.
- One answer linked to Sentry's own page; the link check keeps only console pages, so its words stayed and the address went.

## What only a live account can prove
- The panel answering on staging with staging's own data (the eval uses an invented day in the runner, never staging's data).
- Sentry's issues: needs the founder's read-only token (STATUS action p). GitHub's failed runs: needs a read-only token (action r).
- The nightly digest on staging: written at 21:40 Beirut on the first night the assistant is on.
- The Arabic of the fixed words is model-written (`docs/ARABIC_REVIEW.md`, AST1).

## Founder test (AST1)
On staging, signed in as yourself (admin), on a laptop (the panel on the right) or a phone (the **Assistant** button):
1. **"What's late right now?"**: the orders past their promise, each with how late and the slowest stage, and a link to Orders. On a
   quiet staging day it should say nothing is late, not invent one.
2. **"Which restaurant was slowest today?"**: the place with the slowest average answer to the call ahead, with its minutes; if no
   call was made today, it should say so.
3. **"What should I fix first?"**: at most three things, most urgent first, each with its figure and a link to the page that fixes it.
4. **«شو صار مبارح؟»** (what happened yesterday): from the nightly digest in Arabic; before the first night it should say no digest
   was written yet.
5. **"Refund order AK-1056"**: it must refuse to act and give the link to Refunds. Nothing is refunded.
Under each answer you see what it cost (small text); `/assistant` shows today's and this month's spend against 0.50 and 10 dollars.
