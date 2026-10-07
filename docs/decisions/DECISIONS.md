# Alo King decisions, 6 October 2026 (canonical, final)

> **Update 6 Oct 2026, 16:10 (Beirut):** we run on free plans during the build. Lovable project deleted, repo private on GitHub's free plan, old Supabase project deleted (no dump was taken; nothing from it is needed), Sentry projects `alo-king-functions` and `javascript-tanstackstart-react` created, Anthropic API key ready. Claude created the Supabase project `alo-king-staging` (ref `tzugbbatfbvrfzxuacqx`, Frankfurt, free plan). The Vercel project `shouf-eats` already exists and is linked to the repo. Sections 2, 3, 9, 10 and 11 below are updated for this. Later the same day: sections 12 (WhatsApp Flows), 13 (NotebookLM brief) and 14 (owner preparation) added. 7 October: Kabsi confirmed a separate business; Kapso set-up and merchant call escalation decided. 7 October, 11:00: zones dropped as a launch mechanism, no field visits. 7 October, 12:00: Rasheed decided to keep the scraped vendor details; sections 15-18 rewritten (vendor data, menus, all-Lebanon places and categories, claims, merchant AI tools); repo instructions on branch `rebuild/lebanon` (pushed 7 October). 7 October, 11:45: payments and merchant credit decided (section 20); paid tools ready at launch.

Drafted by Claude Sonnet 5.5 from the real repo; verified, corrected and finalised by Claude Opus 5.5 on 6 October 2026. This file overrides every other document. Manus reports are input only. Status words used below: VERIFIED (checked against an official or primary source today), DECIDED (Claude's call, final unless partners overrule), OPEN (needs a written answer from a provider or the lawyer; the build does not wait for it).

## 0. Verdict: Phase 0 is GO

Phase 0 starts now. Nothing in the legal, carrier or payment track blocks it, because Phase 0 to Phase 5 touch no real customer, no real money and no production number. The pre-build checklist in section 9 must be all green first; every remaining step is a few minutes in a browser and none needs testing or negotiation. The pilot launch itself stays gated (section 1).

### Corrections made in this review
1. **Meta pricing (section 6 of the draft) was wrong.** The repo's copy of Meta's page predates 1 October 2026. Since 1 October 2026 Meta charges for service (free-form) messages and for utility templates sent inside the 24-hour window, at the market's utility rate, with 1,000 free service messages per phone number per month. Manus was right on this point. VERIFIED on Meta's developer page for the change and on several provider notices.
2. **The repo was public on GitHub.** The draft missed this. Now private (done 6 October).
3. **Package manager: pnpm** (the draft was right). Anthropic documents that Bun has proxy problems fetching packages in Claude Code cloud sessions, where all building happens. Phase 0 replaces `bun.lock`/`bunfig.toml` with `pnpm-lock.yaml`; Vercel and the Lovable config preset work with pnpm.
4. **The Lovable build config stays (clarification).** `vite.config.ts` is built on `@lovable.dev/vite-tanstack-config` (v2.24), which bundles TanStack Start, Nitro and Vercel auto-detection. The draft's "we own the repo now" clean-up must not remove it, or the build breaks. Remove `.lovable/` and the Lovable error reporter; keep the config package until it blocks something.
5. **SARL with one partner is allowed** (IDAL's current page: one to twenty partners, LBP 5,000,000 minimum capital, yearly lawyer retainer mandatory). Manus's "3 to 20 partners" came from an old guide. VERIFIED.
6. **VAT is neither 10% nor 11% for sure.** The rate in force is 11%; in February 2026 the government proposed 12%, pending Parliament. VAT stays a dated config value; the lawyer confirms the rate before the first invoice.
7. **OMT has no public merchant API.** It is dropped from the build plan (section 8).
8. **Edge functions must be pinned to Frankfurt** for webhook calls, or Supabase runs them near the caller (Kapso, likely in the US) and every database call crosses the Atlantic again. VERIFIED: Supabase supports `forceFunctionRegion=eu-central-1` as a query parameter for webhooks.

## 1. The build starts now; merchants gate only launch

DECIDED, confirms the draft:
- **Pilot launch** with real customers needs all of: 5 verified merchants live (wherever they are; each serves its own delivery radius), each with a tested menu and one passed dry-run order; lawyer's written sign-off on the cash model; the Customer and Merchant numbers live in the company's Meta portfolio; the simulator suite green on staging for 7 consecutive days; Supabase Pro with the production project created, Vercel Pro, and Kapso Pro (Supabase $25 + Vercel $20 + Kapso Pro fee).
- **Paid customer ads** need all of: 15 merchants live; 14 consecutive days of pilot with merchant notification delivery above 99%, zero orders accepted while a merchant was closed or paused, zero unresolved money mismatches, and merchant rejections under 5% excluding customer errors. Merchant count alone is not enough; these four numbers prove the system works.
- No zones (decided 7 October). Ordering is switched on per merchant, not per area: a merchant takes orders once it passes the go-live checklist (section 15), and only for addresses inside its own delivery radius (road distance, max 10 km). Towns and villages exist only as a list for addresses and search. The four Shouf villages (Baakline, Bakaata, Semqanieh, Beiteddine) remain the preferred first marketing area, not a technical limit.

### Pilot cash and delivery model (DECIDED; lawyer confirms in writing)
- Merchant self-delivery. The customer pays the restaurant in cash on delivery. Alo King never holds customer money. This keeps Alo King out of the payment-services licensing question while the lawyer reviews it.
- Delivery fee bands by road distance (from the route matrix, never straight-line): up to 3 km $2.00; 3 to 6 km $3.00; 6 to 10 km $4.50; no delivery beyond 10 km. A merchant may set a lower fee, never higher, during the pilot. The whole delivery fee belongs to the merchant.
- Alo King's fee to the merchant: $1.00 per delivered order, free for each merchant's first 30 days, invoiced weekly, paid by Whish transfer or cash. One flat number is easy for merchants to understand and covers our variable cost (estimated below at about $0.15 per order).
- Cash-on-delivery cap per order: $150, held in config.

## 2. Repository: keep the repo (now `rashidhamzy-hue/alo-king`), rebuild inside it

Inspected today: last commit 6 October 2026 (`P2: ETA in the "on the way" message`), 107 commits, branches `main` and one stale `claude/*` branch. Stack: TanStack Start 1.168 (React, Vite 8, SSR, Nitro) with Tailwind and shadcn/ui; Supabase edge functions (Deno); 30 migrations. Secret scan of the current tree and full history: no server keys, service-role keys, webhook secrets or private keys found. The committed `.env` holds only the old project's public URL, publishable key and a Mapbox token.

DECIDED:
- Work on branch `rebuild/lebanon`. `main` stays as-is until the rebuild replaces it at pilot. The old repo `alo-king` is archived, not deleted.
- **The repo is private, on GitHub's free plan.** Free private repos cannot use branch rulesets or GitHub's own auto-merge, so merging runs through our own workflow instead (section 10). No GitHub Pro needed.
- **Front end stays on TanStack Start, deployed to Vercel** (existing project `shouf-eats`, Hobby plan during the build; Vercel limits Hobby to non-commercial use, so it moves to Pro, $20 a month, at pilot launch). VERIFIED: Vercel documents TanStack Start support through Nitro, and Lovable-built TanStack projects deploy with zero configuration when `@lovable.dev/vite-tanstack-config` is 2.6.2 or newer (ours is 2.24). No Next.js rewrite. Set Vercel functions to region `fra1` (Frankfurt) beside the database.

### KEEP (port into the new Frankfurt project)
- Pure modules and their tests in `supabase/functions/kapso-brain/`: meta-limits, resolve, browse, orderparse, party, basket and basketedit, trim, usage, webhookauth, turnstart, smart, numbered. Fix `numbered`'s failing test by making menu order deterministic: merchant `sort_order`, then section order, then item ID. Split the 2,114-line `index.ts` into a thin webhook handler plus these modules.
- `supabase/functions/_shared/lifecycle.ts` and its test.
- `claim-vendor`, `merchant-ai`, `order-notify`: port and harden.
- UI: `src/components/ui`, `landing`, `merchant`, `driver`, `track`, `explore`, `staff`, `shared`, `maps` (swap Mapbox for an OSM tile layer); routes `merchant.*`, `driver`, `admin`, `track.$orderId`, `claim.$slug`, `m.$slug`, `explore`, `for-business`; `i18n.tsx`, `format.ts`. Audit each against the new rules: no ratings for unclaimed vendors, no `select('*')`, signed tracking links, no public coordinates.
- Migrations: kept as reference only in `supabase/migrations_legacy/`, never applied to the new project. Fresh baseline schema. Re-implement the good ideas: `bot_begin_turn` single RPC, claim review audit, `ai_call_log` and budget, human handoff, message billing log, free-entry-point referrals, send incidents, one pending cart per basket, order guard trigger.
- Docs: `docs/research/*`. Working docs (`whatsapp-flow-spec`, `latency`, `webhook-auth`, `human-inbox-plan`, `merchant-products-spec`, `message-audit`, `friction-review`, `flows-plan`, `whatsapp-templates`, `vendor-orders`) move to `docs/legacy/` as input to the new contracts. Add a dated note to `docs/research/Meta Whatsapp USD rate card.md` that it predates the 1 October 2026 pricing change.
- `.claude/skills/` (three Kapso skills), `.claude/agents/pr-reviewer.md`, `skills-lock.json`. Rewrite `test-whatsapp-flow`, `deploy-and-verify`, `merchant-onboarding` for the new design.
- `@lovable.dev/vite-tanstack-config` (see correction 4). `bun.lock` and `bunfig.toml` are replaced by `pnpm-lock.yaml` (correction 3).
- The deploy workflow pattern, with the project ID moved to a variable and a staging-then-production step.

### DELETE
- `.env` from git; add `.env*` to `.gitignore` with a committed `.env.example`. Revoke the Mapbox token in the Mapbox account (maps move to OSM). The old publishable key dies with the old project.
- `.agents/` (164-file duplicate of the Kapso skills).
- `.github/workflows/order-watchdog.yml` (replaced by pg_cron and the queue inside Supabase).
- `demo-chat` edge function (public AI endpoint: cost and abuse exposure).
- `.lovable/`, `src/lib/lovable-error-reporting.ts`, the Lovable block and the "never rewrite history" rule in `AGENTS.md`. Sentry replaces error reporting.
- Hard-coded constants: the flat $2 fee, the 89,500 LBP rate, the 20-orders-in-14-days rule. Fees come from the bands, the exchange rate from a dated table, the COD cap from config.
- The `kapso-brain-test` copy trick in CI (a real staging project replaces it).
- Docs describing old behaviour (`demo-reset`, `billing-log`, `send-failures`, `free-entry-point`, `scope`, `customer-side`, `cost-controls`) move to `docs/legacy/`.
- The old Supabase project `hnjkietmwvkgbyrcnweq` (Tokyo): DONE, deleted by Rasheed on 6 October. Remove every reference to it (`supabase/config.toml`, both workflows). The US number (+1 201 483 5474) belongs to Kabsi, a separate business: Alo King stops using it and builds on its own Kapso project's sandbox number.

## 3. Architecture (DECIDED)
- One Lebanon-wide service with per-merchant activation (no zones).
- Three Lebanese numbers: Customer A and Merchant M first; standby B after Meta business verification. VERIFIED: a new Meta business portfolio can register only two phone numbers until it is verified or reaches the 2,000 messaging limit, then 20. All three owners are portfolio admins; the portfolio is in the company's name.
- Kapso behind a provider adapter; direct Meta Cloud API as the fallback adapter. VERIFIED (Kapso pricing FAQ): Free plan = 1 connected number, 2,000 messages a month, plus a sandbox number; Pro = 3 numbers, 100,000 messages; Kapso charges a plan fee, not a per-message markup; Flows are included on all plans. Build runs on Free with the sandbox; the pilot needs Pro (3 numbers: A, M, B), added to the pilot cost line.
- Supabase: during the build, one project only, `alo-king-staging` (Frankfurt, free plan; the organisation's other free slot is taken by `kabsi-prod`, which we do not touch). The production project is created in Frankfurt at pilot launch, when the organisation moves to Pro ($25 a month): free projects pause after a week without activity and have small limits, which is fine for building and wrong for real orders. A daily CI job calls staging so it never pauses. Edge functions pinned to eu-central-1; every webhook URL carries `?forceFunctionRegion=eu-central-1`. Vercel functions in `fra1`.
- Queue: Supabase Queues (pgmq) plus pg_cron for scheduled jobs. No extra queue vendor.
- AI at runtime: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for ordinary customer turns because it is the fastest and cheapest; Claude Sonnet 5.5 (`claude-sonnet-5-5`) for menu extraction, complaints and turns Haiku fails. The router and the eval set decide; models are config, not code. OpenAI only for voice-note transcription, model chosen by an eval on 50 real Lebanese voice notes.
- Sentry for errors and tracing. PostHog later (after pilot).
- Routing: OSM-based through the hosted OpenRouteService API (no self-hosted routing server for a solo operator). Road distance from the merchant's pin to the customer's pin is computed per order and cached for 1-24 hours; checked against about 20 real Shouf trips before the first merchant goes live.
- Payment adapter with an append-only double-entry ledger; separate USD and LBP. Order of rails in section 8.
- Tracking links are signed, expire, and return only status, merchant, order code, total, broad area and an ETA range. No customer coordinates, no items list for public links.
- At most three messages per customer turn. The AI interprets; the server decides prices, baskets, payments and order states.

## 4. Latency and cost report: adopted with edits (DECIDED)
- Two phases per webhook: verify signature, dedupe on the provider message ID, persist, return 200; then process from the queue.
- Taps, STOP, cart edits and status use a deterministic path with zero model calls. Ordinary text uses at most one model call. Per-turn caps on model calls, time and cost; when a cap is hit, ask one short question or hand off to a person.
- One RPC per business operation; read models for hot paths; short-lived versioned caches (menu 30-120 s, profile 5-15 min, routes 1-24 h). Never cache price or stock at confirmation, payment, order status or consent.
- Targets, measured on staging, not assumed: webhook ack p50 under 300 ms; button handler p50 under 700 ms and p95 under 1.5 s; deterministic text p50 under 1.2 s; AI reply p50 under 3 s and p95 under 5 s. Kapso's inbound buffer off, or at most 1 s; the latency report measured about 5 s in the old setup. OPEN: confirm the buffer setting with Kapso during Phase 1.
- Indexes, `EXPLAIN ANALYZE` on hot RPCs, and cost and latency tests in CI.

## 5. Website: adopted with one rule change (DECIDED)
- Website and WhatsApp are two doors to one system: shared basket, menu versions, orders and identity; signed short-lived handoff tokens; anonymous basket until phone verification.
- Public pages (`/m/{slug}`, area and category pages) exist only for claimed vendors that supplied their own data. Unclaimed, Google-derived vendors get no public page and no ratings anywhere. Private routes are `noindex`.
- Server-rendered HTML, canonical URLs, Open Graph, structured data only where it matches visible content, no thin village pages, real 404s. `llms.txt` optional and low priority. Ignore Manus's `/manus-routes.json`. Note: the Website report referred to in the draft is not among the project files; these rules stand on their own.
- Design system confirmed: Crown Gold #F4B63C, ink #17131A, cream #FFF9F0; Plus Jakarta Sans and IBM Plex Sans Arabic (they replace the current Cormorant Garamond, Inter and Tajawal); WCAG 2.2 AA; right-to-left is first-class. Contrast checked: gold on ink 10.1:1 (passes), ink on cream 17.5:1 (passes), gold on cream 1.7:1 (fails). Rule: gold is never text on cream; use gold for fills and buttons with ink text.

## 6. Manus claims: final verdicts

| Claim | Verdict | Use in the build |
|---|---|---|
| Service messages and in-window utility templates are charged from 1 Oct 2026; 1,000 free service messages per number per month | VERIFIED (Meta's change notice plus provider notices). The draft's rejection was wrong. | Cost model below |
| Lebanon is in "Rest of Middle East": marketing $0.0392, utility, authentication and service $0.0091 per delivered message | Rates VERIFIED from two independent reproductions of Meta's 1 Oct 2026 rate card (360dialog, Flowcall). Lebanon's group is Meta's standard mapping; confirm on the WhatsApp Manager rate card once the portfolio exists. | Store rates in a dated table, never in code |
| Free entry point (click-to-WhatsApp ad) window is 7 days | OPEN. Sources disagree: some say extended to 7 days, Meta's main pricing page and 360dialog say 72 hours. | Plan on 72 hours; read the real window from webhook pricing fields when ads start |
| Meta Business Agent priced per token | VERIFIED but irrelevant: our own AI replies are ordinary service messages | None |
| New account model (WhatsApp account plus messaging account) | VERIFIED; Meta migrates existing accounts automatically in the second half of 2026 | Store both IDs; never remove a live number to migrate |
| New portfolio holds 2 numbers until verified | VERIFIED | A and M first, B after verification |
| Whish public fees: international card 3%, payment link 3%, local card free | VERIFIED on Whish's fee page. Rasheed's 1% merchant rate: OPEN until written. | Whish adapter after written terms |
| OMT has a usable merchant API | Not found; no public API or sandbox | Dropped from the build |
| Tap Payments as the foreign-card gateway | Tap has a Lebanon page offering Visa, Mastercard, payment links over WhatsApp and payouts to Lebanese banks. Merchant eligibility and pricing: OPEN. | Chosen (section 8) |
| Stripe for a Lebanese company | Lebanon is not a Stripe merchant country | Not used |
| SARL needs 3 to 20 partners | WRONG; one partner is allowed (IDAL) | Partners choose freely |
| VAT 10% vs 11% | 11% in force; 12% proposed, pending Parliament | Dated config value; lawyer confirms |
| BdL circulars, capital figures, licence classes | OPEN, lawyer's job. Irrelevant to the pilot because Alo King holds no customer money | Lawyer memo before any prepaid payment |
| Alfa or touch single-line corporate postpaid offer | OPEN; public offers start at 5 lines. Ask at a branch with the company papers. Never prepaid. | Owner track |
| Google Places data rules | Conservative reading kept: store `place_id` only, refresh IDs after 12 months, no public pages or ratings for unclaimed vendors, no further scraping | Schema rule |
| Courier pay bands, fuel cost per km | Planning estimates only | Not needed until platform delivery (Phase 5b) |

### Cost model per pilot order (DECIDED working estimate, measured from day 1)
- WhatsApp: about 11 customer-side messages per order (bot replies plus status updates) and 2 merchant templates. Each number's first 1,000 service messages a month are free, so about the first 90 orders a month on the Customer number cost almost nothing. After that: about 13 × $0.0091 ≈ $0.12 per order.
- AI: about 5 model turns per order on Haiku 4.5 at roughly 2,000 input and 200 output tokens each ≈ $0.015, plus transcription when a voice note is sent.
- Total variable cost: about $0.15 per order before Kapso's own charges (OPEN: get Kapso's current per-message or monthly price). The $1 merchant fee covers it with room to spare.
- Marketing templates ($0.0392 each in Lebanon) are not used before the ads gate.

## 7. Build order (starts now)
0. Repo reset: branch `rebuild/lebanon`, delete list, `CLAUDE.md`, `.claude/settings.json` with hooks (block destructive commands, block production targets, scan for secrets), five Manus skills edited to match this file, CI and the automerge workflow (section 10), wiring to `alo-king-staging`, Sentry and Vercel, no production access from development sessions.
1. Fresh schema, row-level security, roles, audit log, webhook (signature, idempotency, queue), all-Lebanon places list (section 16), categories (section 17), vendor import from the seed file (section 15), exchange-rate and VAT tables, fee bands.
2. Order lifecycle (state machine with race tests), four-layer merchant notifications, merchant portal queue.
3. Customer bot and AI (typed tools, budgets, fixtures, eval set in Arabic, English, Arabizi and voice); claims, registration, pre-filled profiles, merchant editing on dashboard and WhatsApp, smart menu (section 18).
4. Website: claimed-vendor pages, tracking, handoff, SEO.
5. Merchant self-delivery first (5a); courier app and dispatch later (5b, after pilot).
6. Payment adapter and ledger (section 20): cash on delivery; Whish payments straight to the merchant's own Whish account; Alo King's own Whish account for merchant credit top-ups; Tap for foreign cards later.
7. Simulator, evals, one capped live run per week on test numbers, pilot scorecard.
8. Merchant growth tools and Alo King Credit: offers, paid broadcast, paid recommendations, insights, credit wallet and statements (sections 18.3, 20). Required before launch.

Owner track in parallel (Rasheed, with partners Bassem and Firas on the company papers): SARL (one partner allowed; equity and roles memo for the three partners), lawyer engagement, Alfa or touch postpaid lines, Meta portfolio with all three owners as admins, Whish written terms, Tap application once the SARL exists, domain. No field visits: merchants claim or register themselves (section 15).

## 8. Open items from the draft: settled
1. **TanStack Start on Vercel**: KEEP. Verified supported; no Next.js.
2. **Gates**: pilot at 5 live merchants plus legal sign-off, numbers live and 7 green days on staging; ads and expansion at 15 merchants plus 14 days of the four reliability numbers (section 1).
3. **Cash model and fees**: merchant self-delivery, cash to the restaurant, bands $2 / $3 / $4.50 up to 3 / 6 / 10 road-km, nothing beyond 10 km, merchant may go lower; Alo King charges merchants $1 per delivered order after 30 free days.
4. **Meta rate card and cost model**: fixed in section 6. Rates live in a dated table; the cost ledger stores Meta's pricing category from each webhook so real cost replaces the estimate.
5. **Payment rails**: cash on delivery for the pilot; Whish second (local wallet, written terms first); Tap third, for diaspora and foreign cards. OMT dropped: no merchant API. Stripe impossible for a Lebanese company.
6. **Review of sections 2, 4, 5 and 6**: done; corrections listed at the top.

## 9. Pre-build checklist (audited by Claude, 7 Oct 2026, 12:00)
The build does not start until every line below is ✅.

| Item | State found | Action |
|---|---|---|
| Repo private, Claude GitHub App installed | ✅ private; app installed, push access confirmed 7 October | none |
| Repo name | ✅ `rashidhamzy-hue/alo-king` (old repo now `alo-king-legacy`) | none |
| Repo instructions | ✅ Pushed 7 October: branch `rebuild/lebanon` with the new `CLAUDE.md`, `AGENTS.md` and this file at `docs/decisions/DECISIONS.md`; `main` is legacy and frozen. Claude cannot change repository settings | Rasheed: GitHub → Settings → General → Default branch → `rebuild/lebanon` |
| Supabase `alo-king-staging` (ref `tzugbbatfbvrfzxuacqx`, Frankfurt) | ✅ healthy, empty: 0 tables, 0 migrations, 0 functions | none |
| Supabase ↔ GitHub integration | ✅ disconnected | none |
| Supabase ↔ Vercel integration | ✅ confirmed by Rasheed as `alo-king-staging` | Phase 0 maps its variable names to the app's |
| Vercel project `alo-king` | ✅ renamed 7 October; functions region Frankfurt (fra1) set by Rasheed; no deployments yet; previews behind Vercel login | none |
| Sentry | ✅ `alo-king-functions` and `javascript-tanstackstart-react` exist (org shared with Kabsi projects; free quota is shared) | none |
| GitHub secrets and variable | Rasheed reports: old `WATCHDOG_SECRET` and `ADMIN_WHATSAPP_PHONE` deleted; `SUPABASE_ACCESS_TOKEN` (new), `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `SENTRY_AUTH_TOKEN`, `KAPSO_API_KEY`, `GOOGLE_PLACES_SERVER_KEY` added; variable `SUPABASE_PROJECT_REF` added. Claude cannot read GitHub Actions settings from its session | Phase 0 first PR: a `check-setup` workflow proves each secret works without printing it. That is the confirmation |
| Kapso | ✅ Dead webhook deleted from Kabsi.co. New Kapso project `Alo King` (eef48fbd-bb4a-4597-9229-3fd145692ccb) created; its key is `KAPSO_API_KEY`. The claude.ai connector stays on Kabsi.co | Proven by `check-setup` |
| claude.ai/code environment | default "Trusted" network | enough: npm, JSR and GitHub are allowed; Deno and the Supabase CLI install from npm. Deploys run in GitHub Actions, not in sessions. No secrets in the environment. |
| Connectors for build sessions | Supabase, Vercel, Sentry. Kapso is reached through `KAPSO_API_KEY` in code, not the connector | enable only Supabase, Vercel and Sentry on build sessions; all others off |

### Guardrails added because connectors are account-wide
The Supabase connector can reach `kabsi-prod` and the Sentry org holds Kabsi projects. Phase 0 adds a PreToolUse hook in `.claude/settings.json` that rejects any Supabase tool call whose project is not `tzugbbatfbvrfzxuacqx`, and any Vercel call outside the Alo King project. `CLAUDE.md` names the only allowed IDs.

### Kabsi (answered 7 October)
Kabsi is a separate business with no link to Alo King. Alo King uses its own Kapso project, its own numbers and its own Supabase project. Guardrail hooks block any build session from touching `kabsi-prod`, the Kabsi Sentry projects or the Kabsi Kapso project.

## 10. How the build runs (DECIDED)

### Where
- **claude.ai/code (Claude Code in the cloud) for all repo work.** It clones the repo, runs tests, pushes branches, opens pull requests and watches them. Use a Claude Code project there (one conversation that runs each task as a parallel cloud thread) if it appears in the sidebar; it is in beta and rolling out gradually. If it does not appear, start one cloud session per task at claude.ai/code.
- **This claude.ai project chat only for decisions, research, provider letters and reviews of this file.** It does not edit the repo.

### Which model
| Work | Model | Why |
|---|---|---|
| Phase 0 repo reset, Phase 1 schema and security, Phase 2 state machine, Phase 6 payments and ledger | Opus 5.5 | Mistakes here are expensive and hard to see |
| Phase 3 bot, tools and evals | Opus 5.5 to design the tool contracts, Sonnet 5.5 to fill fixtures and copy | Contracts need judgement; fixtures need volume |
| Phase 4 website, porting UI, tests, docs, Arabic and English copy | Sonnet 5.5 | Fast and capable for well-specified work |
| Project coordinator conversation (if Claude Code projects are available) | Opus 5.5 at low effort | Cheap routing, sound judgement |
| One adversarial security review before the pilot opens (webhooks, row-level security, tracking links, money paths) | Fable 5.1 | Deepest review, used once, because it is the most expensive |
| Not used for building | Haiku 4.5 | Runtime model only |

### Automated merging (DECIDED, free plan)
- Every task is one branch and one pull request into `rebuild/lebanon`. Sessions never push to `rebuild/lebanon` or `main` directly: a Claude Code hook in `.claude/settings.json` blocks it, and `CLAUDE.md` states it. Auto-fix stays on, so Claude pushes fixes when checks fail or a review comment arrives.
- CI on every pull request (pnpm): install, typecheck, lint, unit tests, edge-function tests, build, migration dry-run against staging, secret scan, and a Claude review job (`anthropics/claude-code-action` on Sonnet 5.5 with a turn cap, using the `ANTHROPIC_API_KEY` secret; it fails when it finds a critical or high problem in money, permissions, webhooks or personal data).
- An `automerge` workflow runs when CI finishes: if every job passed, the PR targets `rebuild/lebanon`, and the branch is up to date, it squash-merges the PR, deletes the branch, then deploys the edge functions and migrations to staging and runs the simulator suite in the same workflow. (Deploy sits inside this workflow because a merge made by GitHub's built-in token does not trigger other workflows.) No human approval.
- A CI check rejects any migration that drops or truncates data unless it ships with a rollback file.
- `rebuild/lebanon` merges into `main` once, when the pilot gate in section 1 passes; that single merge waits for Rasheed's yes in chat. Production deploys only from `main`.
- Two sessions never edit the same migration at once: schema tasks in Phases 1 and 2 run one at a time.

### Seeing what is being built (DECIDED)
Every pull request gets a Vercel preview link automatically; Claude posts it in the PR with phone-size screenshots of each changed screen in Arabic and English. Once a week Claude publishes a one-page visual tour of the current build (screens plus a recorded WhatsApp conversation from the simulator). That gives Rasheed the visual view without a second tool writing to the code.

## 11. Lovable (DECIDED: not used)
Rasheed deleted the Lovable project on 6 October and asked whether to use Lovable again to see the build visually. Decision: no. Lovable syncs with the repo's `main` branch and edits code itself, so it would be a second writer colliding with the rebuild on `rebuild/lebanon`, and it would not even show that branch without manual switching. The need, seeing the product, is met better by the Vercel preview links and weekly visual tour in section 10, which always show exactly what is in the code. Revisit only for throwaway design mock-ups in a separate Lovable project with no GitHub connection.
The `@lovable.dev/vite-tanstack-config` npm package stays in the repo; it is a build preset and needs no Lovable account.

## 12. WhatsApp Flows (DECIDED: use them, narrowly)
A Flow is a native form sheet inside WhatsApp. VERIFIED: no extra Meta charge (the message carrying it is priced like any message; inside the 24-hour window it is a service message, outside it needs an approved template); works on Android, iOS, and since December 2025 WhatsApp Web and Desktop; Kapso registers, versions, publishes and encrypts flows and is included in every Kapso plan.

**Rule:** a Flow replaces a back-and-forth only where the customer or merchant must type several structured fields. A single choice stays a button or list (one tap beats opening a sheet). Every Flow has a text fallback, and the server re-validates everything a Flow returns; prices and totals never come from Flow data.

| Flow | Who | When it is sent | Fields | Phase |
|---|---|---|---|---|
| `address_capture` | customer | first order, or "new address" | town or village (searchable list), landmark, building, floor, phone for the driver, notes. The map pin stays a native WhatsApp location request, which Flows cannot do. | 3 |
| `item_options` | customer | only for items with 2 or more option groups or more than 3 options | required and optional choices, quantity, kitchen note. Options and prices are passed into the Flow at send time; the server recomputes the price on submit. | 3 |
| `merchant_claim` | merchant | claim link or "join Alo King" | business name (Arabic and English), owner name, opening hours, delivery radius and fee (capped by the bands), cash currencies accepted, menu photo upload request | 3 |
| `merchant_hours` | merchant | "change hours" from the merchant number | weekly hours, temporary closure with end time | 3 |

**Not Flows:** order confirmation, cash currency choice, accept/reject, pause, rating, tracking — these are one-tap buttons.

**Technical decisions**
- Static Flows only until after the pilot: all data is sent with the message (navigate action with initial data), so no data endpoint and no extra hosted code. A dynamic data endpoint (for example a merchant sold-out list) is reconsidered after pilot and, if built, runs in our own Supabase edge function.
- Flow JSON lives in the repo (`whatsapp/flows/*.json`), is validated in CI, and is published to Kapso by the deploy workflow. Arabic and English are separate Flow versions; the customer's language picks the version.
- Each Flow submission is stored with its Flow version and handled by a deterministic handler (zero model calls).
- **Kill-gate:** after 100 sends of `address_capture`, if fewer than 60% complete it, it is switched off and the text path takes over. Same rule for `item_options`.

## 13. NotebookLM "Master Engineering & Product Brief" (input only): verdicts
Adopted: PostGIS for delivery-radius and distance checks; a 90-second merchant acceptance target with escalation at 15 s (portal alarm), 45 s (call), 75-90 s (operator); per-order locked exchange rate with USD and LBP recorded on every money row; button IDs that hit RPCs with zero model calls; Kapso's TypeScript SDK for payloads and Flows; one in-flight outbound message per recipient in our queue (prevents ordering conflicts whatever Kapso returns).
Corrected or rejected:
- "Single WhatsApp number": rejected; customer and merchant numbers stay separate (section 3).
- Bun: rejected; pnpm (correction 3).
- Kapso buffer 2 s: rejected; buffer stays off (the live webhook already has it off). Kapso's own docs say it keeps per-conversation order and retries failed deliveries 3 times over about 50 s; we still dedupe on message ID.
- "Zero per-message markup": half true; no per-message markup, but Kapso charges a plan fee and Free allows one number.
- "HTTP 409 on concurrent sends": not in Kapso's docs; handled anyway by the per-recipient rule above.
- Layer 3 "automated call": DECIDED as an ordinary cellular phone call, not a WhatsApp call. Gemini's point is right: when the kitchen's internet drops (generator switch-over), every WhatsApp layer fails at once, but the owner's mobile still rings over the cellular network. Implementation: an automated voice call (short recorded Arabic message: "new Alo King order, open WhatsApp") to the owner mobile through a voice provider (Twilio Programmable Voice first; price per minute to Lebanese mobiles checked in Phase 2 before turning it on). Layer 4 stays: the operator phones the restaurant.
- Cash at the door: the order summary always shows both totals and the locked rate, for example "$12.50 = 1,118,750 LBP (rate 89,500, locked at order)". The rate comes from the dated rate table, never from code.
- "OpenAI Whisper": not fixed; the transcription model is chosen by the 50-voice-note eval.
- "Official rate e.g. 89,500": never hard-coded; dated rate table.
- Urban courier fleet: after pilot (Phase 5b).
- The `orders` table sketch: ignored; the schema is designed fresh in Phase 1.
- Tracking domain `aloking.com`: adopted. Checked 6 October: available.

## 14. Owner preparation, in order
1. Finish section 9 (secrets, Vercel rename and region, delete dead Kapso webhook).
2. Answer the Kabsi question (section 9).
3. Buy `aloking.com` now (about $10-15 a year, Cloudflare Registrar at cost, or any registrar). Needed for tracking links, the privacy policy Meta requires, and business verification.
4. API keys into GitHub secrets when their phase comes: OpenAI (transcription, Phase 3), OpenRouteService free key (Phase 1 route matrix).
5. Record 50 real WhatsApp voice notes ordering food in Lebanese Arabic, Arabizi-style mixed speech and English, from different people (family, friends; about 10-20 seconds each). This is the transcription eval set for Phase 3. No personal data in them.
6. (Removed 7 October: no field visits.)
7. Vendor file: done (uploaded 7 October). Section 15 says what is kept from it.
8. Company track: SARL papers with the lawyer; then two postpaid lines in the company name; then the Meta business portfolio in the company name (all three owners as admins) and business verification with the SARL documents and the domain.

## 15. Vendor data (DECIDED, 7 October 12:00; replaces earlier versions)

### 15.1 Rasheed's decision and Claude's note
Rasheed decided to keep the details he pulled with Google Places API (New) and use them to pre-fill every vendor's profile. Claude's note, recorded once: Google's terms allow storing only the `place_id`; the realistic consequence is Google suspending the API key or billing account, which would also stop the live business search used for claims. The plan below keeps the data and limits that exposure:
- Ratings and review counts are deleted. They are the most clearly Google-owned content, and the product shows no ratings for unclaimed vendors anyway.
- Pre-filled values are marked `source = seed` and are replaced the moment a merchant confirms or edits them. A claimed vendor's record is then the merchant's own data.
- Unclaimed vendors have no public web page (unchanged).
- The production Google key (`GOOGLE_PLACES_SERVER_KEY`) is used only for live lookups during claims and searches. Any future bulk pull runs from a separate Google Cloud project, never with the production key.
- A business owner can ask for its listing to be removed; the record is deleted and only the `place_id` is kept as a "do not re-import" marker (Lebanese Law 81/2018 rights).

### 15.2 The vendor file: what is kept, derived, deleted, excluded
File: `alo_king_master_lebanon_vendors_cleaned.csv`, 2,087 rows, one `place_id` each (no duplicate IDs).

| Column | Decision |
|---|---|
| `place_id` | keep (link to Google, dedupe key) |
| `name` | keep; split into `name_ar` and `name_en` by script (e.g. "مطعم مزيان - Mezyan"); branch suffix ("- Hazmieh") moved to `branch_label` |
| `alo_king_category` | keep as the import label; mapped to `business_type` (section 17) |
| `google_primary_type` | keep as a hint; mapped to `business_type` and `cuisine_tags` |
| `region_code` | keep as the import label |
| `address` | keep as `address_seed` (internal; 889 are plus-codes only) |
| `phone_e164` | keep as `phone_seed`, internal only, used to send the claim code; never shown publicly |
| `phone_raw` | delete (duplicate of `phone_e164`) |
| `is_whatsapp_candidate` | delete; recomputed from the number (mobile prefixes 3, 70, 71, 76, 78, 79, 81) and confirmed only when a WhatsApp message actually delivers |
| `website_or_menu_link` | keep after checking each link: classified into `website_url`, `instagram_url`, `facebook_url`, `menu_source_url`; expired, parked or hijacked domains dropped |
| `rating`, `reviews_count` | delete |
| `latitude`, `longitude` | keep as `location_seed` |
| derived | `town_id`, district and governorate (point-in-polygon against the places list, section 16), `brand_id` for chains (same normalised name or same website domain; e.g. Sea Sweet, Hibou, Cafe Younes, Wooden Bakery), `slug`, `source = seed_2026_10` |

Rows excluded from import: fuel stations (TotalEnergies etc.), engineering and industrial firms (e.g. Sofregaz), hotels, guesthouses and beach clubs without a separate restaurant listing, coworking spaces, NGOs. Kept in a new `home_essentials` type instead of excluded: drinking-water delivery and gas-cylinder (LPG) delivery companies, because Lebanese households order these on WhatsApp. Claude produces the exclusion list in the Phase 1 import with each row's reason, and the 19 repeated phone numbers are resolved as chain branches or data errors.
All imported vendors start as `claim_status = unclaimed`, `orderable = false`, `public_page = false`.

### 15.3 The six menu files: not usable as menus
Checked in full: `beirut_menus.json` and `chouf_aley_baabda_menus.json`; the other four come from the same scraper and share its format. Each entry holds at most 30 sample lines of website text, not a menu. Most entries are Instagram stubs (one line: "Instagram"), site navigation, cookie banners, empty app templates (`{{item.title}}`), "domain expired" pages, or unrelated sites (gas companies, hotels, an NGO). One restaurant's domain now serves a Turkish gambling site (`gialacucinadamore.com`), so its link must never be shown. A small minority contain real items and prices (for example Olivo in Bhamdoun, Bachir delivery, Beirut Waves, Jebneh w Zebdeh, Good Morning in Aley), but prices from websites are often outdated.
Decision: no menu text is imported. From these files only a checked `menu_source_url` per vendor is kept. Menus are built at claim time from what the merchant provides (section 18.3), and the stored link is offered as "import your menu from this link?" with one tap.

## 16. All-Lebanon places list (DECIDED)
One list of every city, town, village and named neighbourhood in Lebanon, ready before launch; launch areas are chosen later by switching places on.
- Fields: `id`, `name_ar`, `name_en`, `name_fr`, `aliases` (Arabizi and common spellings, e.g. Baakline / Baaqline / Ba3qlin / بعقلين), `kind` (city, town, village, neighbourhood), `governorate`, `district` (qada), `municipality`, `centroid`, `boundary` where available, `parent_id` (neighbourhood → city), `service_status` (`off`, `on`, `paused`), `paused_reason`.
- Sources: the official governorate, district and municipality list (Ministry of Interior / CAS), cross-checked with OpenStreetMap place names and boundaries (ODbL licence, attribution in the site footer). Built by a script in GitHub Actions (cloud sessions cannot reach OpenStreetMap servers), stored as a seed file in the repo, reviewed by Claude for missing villages and duplicate spellings.
- South: every place in the South and Nabatieh governorates is loaded with `service_status = paused`, `paused_reason = security`, so nothing there can be ordered until a person switches it on. Nothing else is special-cased.
- Every place starts `off`. Switching a place `on` is one admin action, recorded in the audit log.
- Customer addresses always point to a place; free text alone is never an address.

## 17. Categories (DECIDED)
Two levels plus flags, the same for vendors, menus, search and AI.
- `business_type` (one per vendor): restaurant, fast_food, cafe, bakery_manakish, sweets_pastry, ice_cream, grocery_supermarket, minimarket, butcher, poultry, fish_market, produce (fruit and vegetables), roastery_nuts, home_essentials (water and gas cylinders), other_food.
- `cuisine_tags` (many per vendor): lebanese, mezze, grills_mashawi, shawarma, falafel, manakish, saj, kaak, broasted_chicken, burgers, pizza, italian, sushi_japanese, chinese, asian, armenian, syrian_aleppan, seafood, healthy_salads, breakfast, brunch, sandwiches, crepes_waffles, lebanese_sweets (knefe, baklava, maamoul), cakes, booza_ice_cream, specialty_coffee, fresh_juices, vegan, kids. Extendable by admin only.
- Item flags (merchant-declared, never guessed by AI): contains_pork, contains_alcohol, vegetarian, vegan, spicy level 0-3, allergens (gluten, nuts, dairy, eggs, sesame, fish, shellfish, soy), fasting-friendly (siyami).
- `meal_times`: breakfast, lunch, dinner, late_night.

## 18. Claims, registration and merchant self-service (DECIDED)
Same backend for the website (`/for-business`, merchant dashboard) and the merchant WhatsApp number. No field visits, no outreach messages: a business hears about Alo King from ads, customers or the site, and starts itself.

### 18.1 Every claim and registration case
| Case | What happens |
|---|---|
| A. In our list, seed phone is a mobile on WhatsApp | Code sent by WhatsApp to that number; entered on the site or sent back in chat → verified |
| B. In our list, seed phone is a landline | Automated voice call reads the code → verified |
| C. In our list, phone wrong, missing or changed | Upload commercial registration or municipal permit + photo of the shop sign → Rasheed approves or rejects in one tap |
| D. Not in our list, but on Google | Live Google lookup creates the vendor from the place, then A, B or C |
| E. Not on Google at all (new shop, home business) | Register: name, type, pin on map, photos, registration document → Rasheed approves. Home kitchens need a registration document; otherwise they join a waitlist (lawyer to confirm the rule) |
| F. Chain with branches | One brand account; each branch is its own vendor (pin, hours, kitchen number, delivery radius); one shared menu with per-branch prices and availability. HQ proves ownership once with a company document, then adds branches |
| G. Two people claim the same place | Both frozen; each submits documents; Rasheed decides; full audit log |
| H. Staff | Owner invites by phone number with a role: owner, manager, cashier, kitchen. Only owner and manager edit prices and menu |
| I. Business sold / new owner | New owner claims with documents; old owner notified and has 72 hours to object; then transferred |
| J. Closed, moved or wrong listing | Merchant marks closed or moved; customer reports or a Google "closed" status hide the listing until checked |
| K. Owner wants the listing removed | Deleted; `place_id` kept as do-not-re-import marker |
| L. Lost phone or access | Recover with a second verified number, else documents |
| M. Customer asks for a business we lack | Stored as a request with a counter; no message is ever sent to the business |

### 18.2 Profile pre-fill and editing
On a successful claim the profile opens pre-filled from the seed (name, address, location, phone, links, type) with every seed field marked "please confirm". The merchant confirms or corrects each, then fills what we never had: kitchen WhatsApp, owner mobile, delivery radius, hours, prep time, cash currencies, menu, photos. Every later change is made from the dashboard or by message to the merchant number ("change closing time to 11", "خلصت الكنافة"); the AI turns the message into a proposed change, the merchant confirms with one tap, and the server applies it. Prices, availability and hours are never changed by the AI without that tap.

### 18.3 AI tools for merchants
- Smart menu: import from photos, PDF, a link, or Instagram screenshots (Sonnet 5.5 extracts sections, items, options, prices); the merchant approves section by section. Bulk edits ("raise all grills by 10%"), sold-out toggles by message, menus by time of day.
- Profile writing: bilingual description, tags, translations and Arabizi aliases proposed by AI, approved by the merchant.
- Photos: upload from phone or WhatsApp; AI suggests which menu item each photo belongs to; only light cleanup (crop, brightness), never changes to the food itself.
- Offers: discounts, combos, free delivery above an amount, time-limited deals; merchant-funded; validated and priced by the server.
- Paid broadcast: a merchant pays for one WhatsApp promotion sent by Alo King to customers who opted in to marketing and match the merchant's area or past orders. Rules: approved marketing template, maximum 2 promotional messages per customer per week across all merchants, STOP honoured instantly. Price per recipient = Meta's marketing rate plus a margin, set before launch.
- Paid recommendations: sponsored placement in bot suggestions and search, always labelled "مُموَّل · Sponsored", at most one per list, shown only when it matches what the customer asked for, delivers to the address and is open. Charged per delivered sponsored order; price set before launch.
- Insights: orders, revenue, top items, missed and late orders, customer ratings from real orders.
- Billing: merchants pay for everything from prepaid Alo King Credit topped up by Whish, with a monthly statement as fallback (section 20).

### 18.4 Build placement
Claims, registration, pre-fill, profile and menu editing (dashboard and WhatsApp) and the smart menu are Phase 3. Offers, paid broadcast, paid recommendations, insights and Alo King Credit are Phase 8 and are required before launch (decided 7 October).

## 19. Owner reminders (Claude raises these at every check until done)
- Change the GitHub default branch to `rebuild/lebanon`.
- Re-send the Gemini report on Lebanese villages and cities (it did not reach the project or the chat on 7 October).
- Whish: send the question list in section 20.5 and get API documents and a sandbox key. After the SARL exists (about 17 October): open Alo King's own Whish business account.
- Buy `aloking.com`; then create the browser Google key restricted to `aloking.com` and `*.vercel.app` and add it to Vercel's environment settings.
- Before launch, Google Cloud spending limits (10 minutes): (1) console.cloud.google.com → Billing → Budgets & alerts → Create budget → $5 a month, alerts at 50%, 90%, 100% to Rasheed's email. (2) APIs & Services → Places API (New) → Quotas & system limits → set per-day caps: Text Search 150, Place Details 300, Autocomplete 300. (3) APIs & Services → Credentials → the server key → API restrictions → only Places API (New).
- 50 voice notes for the transcription test (later).
- Company track: SARL (ready in about 10 days), then lawyer letter on the money flows in section 20, postpaid lines, Meta business account in the company name.

## 20. Money: customer payments, merchant credit, paid tools (DECIDED, 7 October)
Three flows, kept separate so Alo King never holds customers' food money.

### 20.1 Customer pays for food (customer → merchant)
- Cash on delivery, paid to the merchant. Default for every order.
- Whish online payment, straight to the merchant: each merchant connects its own Whish business account in the dashboard; when a customer chooses Whish, Alo King creates the payment link on that merchant's account, the money lands with the merchant, and Alo King only records the signed payment result. A merchant without a Whish business account takes cash only.
- If Whish offers a marketplace product (one Alo King account that routes each payment to the right merchant), it replaces merchant-connected accounts once the lawyer approves it.
- Refunds go back through Whish to the original payment, triggered by the merchant or by Alo King support with the merchant's agreement. No customer wallets or stored balances.
- Foreign cards (diaspora): Tap, later, same rule (paid to the merchant, or Alo King as merchant of record only with the lawyer's written approval).

### 20.2 Merchant pays Alo King (merchant → Alo King)
- Alo King Credit: a prepaid balance a merchant tops up from the dashboard or WhatsApp with a Whish payment link into Alo King's own Whish business account (minimum $10).
- Closed loop: spendable only on Alo King's own services (order fees, broadcasts, sponsored orders); not transferable, not withdrawable, not usable with any other merchant, no interest; unused credit refunded on request when the merchant closes its account. This makes it an advance payment for services rather than stored money; the lawyer confirms this in writing before launch.
- Order fee ($1 per delivered order, first 30 days free) is deducted from credit when the order is marked delivered. If credit is short, the fee goes on the monthly statement. Statement unpaid after 15 days: paid tools pause. After 30 days: the merchant stops receiving orders until paid.
- Paid tools are prepaid only: a campaign or sponsorship reserves its budget from credit when it starts, is charged for what was actually delivered, and releases the rest.
- Every movement is an append-only ledger entry (top-up, order fee, broadcast charge, sponsored charge, refund to credit, adjustment by admin with reason). Statements and VAT invoices are generated from the ledger; VAT applies once the SARL is VAT-registered, at the rate in the VAT table.

### 20.3 Launch prices (stored in a dated price table, changeable without code)
| Product | Price | Rules |
|---|---|---|
| Order fee | $1.00 per delivered order | first 30 days free per merchant |
| Paid broadcast | $0.08 per delivered message, minimum $5 per campaign | audience = customers who opted in to marketing AND either ordered from this merchant or live inside its delivery radius and order its category; max 2 promotional messages per customer per week across all merchants; merchant shown the audience size and exact cost before paying; undelivered messages not charged |
| Sponsored recommendation | $0.40 per delivered order that came from a sponsored suggestion within 24 hours | labelled "مُموَّل · Sponsored"; at most one per list; shown only if relevant, open and delivering to the address; merchant sets a daily budget; sponsors rotate by remaining budget and quality score; no auction at launch |
| Offers (discounts, combos, free delivery) | free to create | merchant-funded; server-validated |

Broadcast margin check: Meta charges $0.0392 per delivered marketing message in Lebanon; $0.08 covers that plus replies and AI handling.

### 20.4 Quality guards for paid tools
- A merchant whose broadcasts get more than 2% STOP replies or any WhatsApp block-rate warning is paused from broadcasting for 14 days.
- Sponsored placement is dropped for merchants with acceptance under 90% or more than 5% late orders in the last 14 days.
- Paid placement never changes organic ranking; customers can always ask "show me without sponsored".

### 20.5 Questions Rasheed sends to Whish (provider questions, not a negotiation)
1. API documents and a sandbox key for Whish Pay payment links, payment status, webhooks (with signature) and refunds.
2. Can a merchant connect its own Whish business account to a platform (API key or authorisation), so payment links created by Alo King pay that merchant directly?
3. Do you offer a marketplace or split-payment product for platforms?
4. Your 1% rate in writing, for which products, and the settlement timing to a Lebanese bank or Whish account.
5. Requirements to open Alo King SARL's own Whish business account.

## Sources checked on 6 October 2026
- Meta: pricing change notice for service and in-window utility messages (developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages); phone-number cap (…/business-phone-numbers/phone-numbers); account model (…/account-model-evolution).
- 360dialog and respond.io notices on the 1 October 2026 change; Flowcall rate table (Rest of Middle East).
- Vercel: TanStack Start on Vercel (vercel.com/docs/frameworks/full-stack/tanstack-start).
- Supabase: regional invocation of edge functions (supabase.com/docs/guides/functions/regional-invocation).
- IDAL: choose your business structure (SARL).
- VATupdate, 18 February 2026: proposed VAT rise from 11% to 12% pending Parliament.
- Whish fees page; Tap Payments Lebanon page.
- GitHub community reports: free-plan private repos cannot use branch protection or rulesets.
- Vercel Hobby plan page (non-commercial use only); Supabase pricing (free plan: 2 active projects, pause after a week of inactivity; Pro $25 a month).
- Vendor file and menu files: checked by Claude on 7 October (section 15).
- Google: Places API policies (place_id storage, attribution), Places data fields (SKU per field), Maps Platform pricing (free monthly caps).
- Kapso docs: pricing FAQ, flows (Kapso integration, static vs dynamic, data endpoint), webhooks advanced. Flows client support and pricing: infiq.in Flows guide; Flowella (Web/Desktop rollout Dec 2025). GoDaddy availability check for aloking.com.
- Anthropic: models overview (platform.claude.com/docs/en/models/overview); Claude Code cloud sessions, auto-fix and projects (code.claude.com/docs).
