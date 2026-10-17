# Alo King decisions, 6 October 2026 (canonical, final)

> **Update 6 Oct 2026, 16:10 (Beirut):** we run on free plans during the build. Lovable project deleted, repo private on GitHub's free plan, old Supabase project deleted (no dump was taken; nothing from it is needed), Sentry projects `alo-king-functions` and `javascript-tanstackstart-react` created, Anthropic API key ready. Claude created the Supabase project `alo-king-staging` (ref `tzugbbatfbvrfzxuacqx`, Frankfurt, free plan). The Vercel project `shouf-eats` already exists and is linked to the repo. Sections 2, 3, 9, 10 and 11 below are updated for this. Later the same day: sections 12 (WhatsApp Flows), 13 (NotebookLM brief) and 14 (owner preparation) added. 7 October: Kabsi confirmed a separate business; Kapso set-up and merchant call escalation decided. 7 October, 11:00: zones dropped as a launch mechanism, no field visits. 7 October, 12:00: Rasheed decided to keep the scraped vendor details; sections 15-18 rewritten (vendor data, menus, all-Lebanon places and categories, claims, merchant AI tools); repo instructions on branch `rebuild/lebanon` (pushed 7 October). 7 October, 11:45: payments and merchant credit decided (section 20); paid tools ready at launch. 7 October, 12:00: places list sources fixed after Rasheed's Gemini report (section 16); pre-build checklist complete. 7 October, 12:30: second gazetteer report folded into section 16; all research reports now in `docs/research/`.

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

### Changes from Rasheed, 7 October 12:28
- Money: Whish payments go to Alo King's own Whish account; merchants are settled automatically every 2 weeks (monthly on request). Section 20 rewritten.
- Delivery: three modes (merchant, Alo King fleet, outsourced partner) behind one adapter. New section 21.
- Merchant credit: fully automated across Whish, the ledger, the dashboard, WhatsApp and the AI (section 20.3).
- Kapso open-source repos decided (section 26); model and effort per build session (section 10).
- Order receiving through every channel incl. POS and Deliverect (section 23); full website revamp (section 24); build sessions never ask the owner (section 25).
- French added as a fourth ordering language (with Arabic, English and Arabizi), including mixed Arabic-French messages.
- Send Home: orders paid from abroad for family in Lebanon, every number and location case, Tap Payments as the gateway. New section 22.

## 1. The build starts now; merchants gate only launch

DECIDED, confirms the draft:
- **Pilot launch** with real customers needs all of: 5 verified merchants live (wherever they are; each serves its own delivery radius), each with a tested menu and one passed dry-run order; lawyer's written sign-off on the cash model; the Customer and Merchant numbers live in the company's Meta portfolio; the simulator suite green on staging for 7 consecutive days; Supabase Pro with the production project created, Vercel Pro, and Kapso Pro (Supabase $25 + Vercel $20 + Kapso Pro fee).
- **Paid customer ads** need all of: 15 merchants live; 14 consecutive days of pilot with merchant notification delivery above 99%, zero orders accepted while a merchant was closed or paused, zero unresolved money mismatches, and merchant rejections under 5% excluding customer errors. Merchant count alone is not enough; these four numbers prove the system works.
- No zones (decided 7 October). Ordering is switched on per merchant, not per area: a merchant takes orders once it passes the go-live checklist (section 15), and only for addresses inside its own delivery radius (road distance, max 10 km). Towns and villages exist only as a list for addresses and search. The four Shouf villages (Baakline, Bakaata, Semqanieh, Beiteddine) remain the preferred first marketing area, not a technical limit.

### Pilot cash and delivery model (DECIDED; lawyer confirms in writing)
- Merchant self-delivery at pilot (Alo King fleet and outsourced partners follow: section 21). Customer pays cash on delivery to whoever delivers, or pays online by Whish into Alo King's own Whish account; Alo King settles merchants every 2 weeks (section 20, corrected 7 October). Online collection switches on only after the lawyer's written letter on the collection model (section 20.1); if the letter is late, the pilot opens cash-only and Whish switches on the day it arrives.
- Delivery fee bands by road distance (from the route matrix, never straight-line): up to 3 km $2.00; 3 to 6 km $3.00; 6 to 10 km $4.50; no delivery beyond 10 km. A merchant may set a lower fee, never higher, during the pilot. When the merchant delivers, the whole delivery fee belongs to the merchant; when Alo King or a partner delivers, it belongs to Alo King (section 21).
- Alo King's fee to the merchant: $1.00 per delivered order, free for each merchant's first 30 days, netted from the merchant's settlement or deducted from Alo King Credit (section 20). One flat number is easy for merchants to understand and covers our variable cost (estimated below at about $0.15 per order).
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
- **Test numbers (DECIDED 7 October 15:40):** until the pilot cut-over, the only WhatsApp number is Kapso's sandbox (phone number ID `597907523413541`), with sandbox sessions for real test phones (first: Rasheed's own WhatsApp). No Kapso-managed US number (Alo King's account already used the one free claim on Kabsi, Kapso releases unused ones after 30 days, and a US number is wrong for Lebanese customers) and no personal or prepaid SIM (it would sit in a personal Meta portfolio and be thrown away). VERIFIED in Kapso's sandbox docs: text, interactive messages, webhooks and Flows with inbound triggers work in the sandbox; templates and multiple recipients do not. So template sends are built against Kapso's API contract with recorded fixtures and verified live only on the company numbers: templates are submitted for Meta approval the day the company portfolio exists (§14 item 8), weeks before pilot, and a rejected template blocks the pilot until the next build session rewrites and resubmits it. A session needing a second tester phone (merchant side) uses a sandbox session on a partner's phone (Bassem or Firas) and opens an `owner` issue with the steps.
- Supabase: during the build, one project only, `alo-king-staging` (Frankfurt, free plan). Since 7 October the other business's project lives in another Supabase account, so the organisation's second free slot is empty: it stays empty, reserved for the production project at the pilot cut-over (session 14). Reason: production must run on Pro anyway (a free project pauses after a week and has small limits), and a second live project during the build is only another target a session could hit by mistake. The production project is created in Frankfurt at pilot launch, when the organisation moves to Pro ($25 a month): free projects pause after a week without activity and have small limits, which is fine for building and wrong for real orders. A daily CI job calls staging so it never pauses. Edge functions pinned to eu-central-1; every webhook URL carries `?forceFunctionRegion=eu-central-1`. Vercel functions in `fra1`.
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
- Server-rendered HTML, canonical URLs, Open Graph, structured data only where it matches visible content, no thin village pages, real 404s. `llms.txt` included (section 24.6). Ignore Manus's `/manus-routes.json`. The Website report is in the repo at `docs/research/Alo-King-Complete-Website-Design-UX-SEO-AIO-GEO-Strategy.md` (input only).
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
| Courier pay bands, fuel cost per km | Planning estimates only | Set in config when the first fleet area opens (section 21) |

### Cost model per pilot order (DECIDED working estimate, measured from day 1)
- WhatsApp: about 11 customer-side messages per order (bot replies plus status updates) and 2 merchant templates. Each number's first 1,000 service messages a month are free, so about the first 90 orders a month on the Customer number cost almost nothing. After that: about 13 × $0.0091 ≈ $0.12 per order.
- AI: about 5 model turns per order on Haiku 4.5 at roughly 2,000 input and 200 output tokens each ≈ $0.015, plus transcription when a voice note is sent.
- Total variable cost: about $0.15 per order before Kapso's own charges (OPEN: get Kapso's current per-message or monthly price). The $1 merchant fee covers it with room to spare.
- Marketing templates ($0.0392 each in Lebanon) are not used before the ads gate.

## 7. Build order (starts now)
0. Repo reset: branch `rebuild/lebanon`, delete list, `CLAUDE.md`, `.claude/settings.json` with hooks (block destructive commands, block production targets, scan for secrets), five Manus skills edited to match this file, CI and the automerge workflow (section 10), wiring to `alo-king-staging`, Sentry and Vercel, no production access from development sessions.
1. Fresh schema, row-level security, roles, audit log, webhook (signature, idempotency, queue), all-Lebanon places list (section 16), categories (section 17), vendor import from the seed file (section 15), exchange-rate and VAT tables, fee bands.
2. Order lifecycle (state machine with race tests), four-layer merchant notifications, merchant portal queue, the `order_channel` router with portal, WhatsApp, call, printer and email channels (section 23).
3. Customer bot and AI (typed tools, budgets, fixtures, eval set in Arabic, English, French, Arabizi and voice, including mixed Arabic-French and Arabic-English messages); claims, registration, pre-filled profiles, merchant editing on dashboard and WhatsApp, smart menu (section 18).
4. Website revamp (section 24): design system, every public page in Arabic, English and French, claim and registration with the AI onboarding assistant, legal pages, SEO and AIO, dashboard restyle.
5. Delivery (section 21): 5a merchant self-delivery with the `delivery_provider` adapter in place from day one; 5b Alo King fleet (driver app, dispatch, cash custody) and 5c partner adapter, both built before launch and switched on per area by config after the pilot.
6. Payment adapter, ledger and settlement (section 20): cash on delivery; Whish payments into Alo King's Whish account; automated settlement every 2 weeks; Alo King Credit with automatic top-up and deduction; Send Home checkout with Tap (section 22), switched on when Tap approves the SARL.
7. Simulator, evals, one capped live run per week on test numbers, pilot scorecard.
8. Merchant growth tools and Alo King Credit: offers, paid broadcast, paid recommendations, insights, credit wallet and statements (sections 18.3, 20). Required before launch.

Owner track in parallel (Rasheed, with partners Bassem and Firas on the company papers): SARL (one partner allowed; equity and roles memo for the three partners), lawyer engagement, Alfa or touch postpaid lines, Meta portfolio with all three owners as admins, Whish written terms, Tap application once the SARL exists (section 22.5), domain. No field visits: merchants claim or register themselves (section 15).

## 8. Open items from the draft: settled
1. **TanStack Start on Vercel**: KEEP. Verified supported; no Next.js.
2. **Gates**: pilot at 5 live merchants plus legal sign-off, numbers live and 7 green days on staging; ads and expansion at 15 merchants plus 14 days of the four reliability numbers (section 1).
3. **Cash model and fees**: merchant self-delivery, cash to the restaurant, bands $2 / $3 / $4.50 up to 3 / 6 / 10 road-km, nothing beyond 10 km, merchant may go lower; Alo King charges merchants $1 per delivered order after 30 free days.
4. **Meta rate card and cost model**: fixed in section 6. Rates live in a dated table; the cost ledger stores Meta's pricing category from each webhook so real cost replaces the estimate.
5. **Payment rails**: cash on delivery; Whish into Alo King's own account (local wallet, written terms first); Tap for Send Home and foreign cards (section 22). OMT dropped: no merchant API. Stripe impossible for a Lebanese company.
6. **Review of sections 2, 4, 5 and 6**: done; corrections listed at the top.

## 9. Pre-build checklist (audited by Claude, 7 Oct 2026, 12:00)
The build does not start until every line below is ✅.

| Item | State found | Action |
|---|---|---|
| Repo private, Claude GitHub App installed | ✅ private; app installed, push access confirmed 7 October | none |
| Repo name | ✅ `rashidhamzy-hue/alo-king` (old repo now `alo-king-legacy`) | none |
| Repo instructions | ✅ Pushed 7 October: branch `rebuild/lebanon` with the new `CLAUDE.md`, `AGENTS.md` and this file at `docs/decisions/DECISIONS.md`; default branch set to `rebuild/lebanon` (verified); `main` is legacy and frozen | none |
| Supabase `alo-king-staging` (ref `tzugbbatfbvrfzxuacqx`, Frankfurt) | ✅ healthy, empty: 0 tables, 0 migrations, 0 functions | none |
| Supabase ↔ GitHub integration | ✅ disconnected | none |
| Supabase ↔ Vercel integration | ✅ confirmed by Rasheed as `alo-king-staging` | Phase 0 maps its variable names to the app's |
| Vercel project `alo-king` | ✅ renamed 7 October; functions region Frankfurt (fra1) set by Rasheed; no deployments yet; previews behind Vercel login | none |
| Sentry | ✅ `alo-king-functions` and `javascript-tanstackstart-react` exist (org shared with Kabsi projects; free quota is shared) | none |
| GitHub secrets and variable | Rasheed reports: old `WATCHDOG_SECRET` and `ADMIN_WHATSAPP_PHONE` deleted; `SUPABASE_ACCESS_TOKEN` (new), `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `SENTRY_AUTH_TOKEN`, `KAPSO_API_KEY`, `GOOGLE_PLACES_SERVER_KEY` added; variable `SUPABASE_PROJECT_REF` added. Claude cannot read GitHub Actions settings from its session | Phase 0 first PR: a `check-setup` workflow proves each secret works without printing it. That is the confirmation |
| Kapso | ✅ Dead webhook deleted from Kabsi.co. New Kapso project `Alo King` (d4461380-e8d8-4a33-9b87-7b3fffc67d6d (new account since 15 October, §39.8; the old project id is void)) created; its key is `KAPSO_API_KEY`. The claude.ai connector stays on Kabsi.co | Proven by `check-setup` |
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

### Which model (updated 7 October 13:51: model and effort for every session)
Each phase runs in a fresh claude.ai/code session on `rebuild/lebanon`. A big phase is split so no session runs out of context. Effort is set in the session's model menu where shown; if it isn't shown, the model alone is enough.

| # | Session | Model | Effort | Needs first (owner issue) |
|---|---|---|---|---|
| 0 | Repo reset, CI, automerge, hooks, check-setup | Opus 5.5 | high | done 7 Oct (PRs #61–#66) |
| 1 | Phase 1a: schema core, RLS, roles, audit log, ledger tables, dated rate/VAT/fee/config tables, webhook intake (signature, idempotency, pgmq) | Opus 5.5 | high | none |
| 2 | Phase 1b: all-Lebanon places (§16), categories (§17), vendor import (§15), route distances | Opus 5.5 | high | #76 ORS key |
| 3 | Phase 2: order state machine with race tests, four-layer notifications, merchant portal queue, `order_channel` router (§23) | Opus 5.5 | high | none (#67 for live tests) |
| 4 | Phase 3a: customer bot and AI: typed tools, budgets, four-language eval set, voice | Opus 5.5 | high | #77 OpenAI key, #67 Kapso number |
| 5 | Phase 3b: claims and registration (§18), profile editing on dashboard and WhatsApp, smart menu, WhatsApp Flows (§12) | Sonnet 5.5 | high | #67 |
| 6 | Phase 4a: design system and every public page in AR/EN/FR (§24) | Sonnet 5.5 | high | none |
| 7 | Phase 4b: claim and registration UI, AI onboarding panel, legal pages, SEO and AIO, dashboard restyle | Sonnet 5.5 | high | none |
| 8 | Phase 5: delivery adapter, fleet (driver app, dispatch, cash custody), partner adapter (§21) | Sonnet 5.5 | high | none |
| 9 | Phase 6a: payments, ledger, Whish collection, settlement, Alo King Credit (§20) | Opus 5.5 | max | Whish sandbox key (#69) |
| 10 | Phase 6b: Send Home, pay-for-me, Tap adapter (§22) | Opus 5.5 | high | Tap sandbox (#71) |
| 11 | Phase 7: simulator, evals, weekly capped live run, pilot scorecard | Sonnet 5.5 | medium | #67 |
| 12 | Phase 8: offers, paid broadcast (Kapso Broadcasts API, §26), sponsored, insights, credit UI | Sonnet 5.5 | high | none |
| 13 | Security review: webhooks, RLS, tracking links, money paths | Fable 5.1 | max | sessions 1–12 merged |
| D | Data finalisation (§31): final places list, vendor file and every data fix in one run, before cut-over | Opus 5.5 | high | Rasheed's final village and vendor files |
| 14 | Pilot cut-over: production project, numbers live, go-live checklist | Opus 5.5 | high | Supabase Pro, Vercel Pro, Kapso Pro, lawyer letter |

A session whose "needs first" item is missing still runs: it builds against mocks and the sandbox, and switches on the live part in a later run (§25). Haiku 4.5 is never used for building; it is the runtime model only. A planning conversation (claude.ai Project chat, no code) uses Opus 5.5 at medium effort.

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
- Static Flows only until after the pilot: all data is sent with the message (navigate action with initial data), so no data endpoint and no extra hosted code. A dynamic data endpoint (for example a merchant sold-out list) is reconsidered after pilot and, if built, runs in our own Supabase edge function. **Amended by §39.15.13:** the customer app Flow uses a dynamic data endpoint.
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
- Courier fleet and partners: section 21.
- The `orders` table sketch: ignored; the schema is designed fresh in Phase 1.
- Tracking domain `aloking.com`: adopted. Checked 6 October: available.

## 14. Owner preparation, in order
1. Finish section 9 (secrets, Vercel rename and region, delete dead Kapso webhook).
2. Answer the Kabsi question (section 9).
3. Buy `aloking.com` now (about $10-15 a year, Cloudflare Registrar at cost, or any registrar). Needed for tracking links, the privacy policy Meta requires, and business verification.
4. API keys into GitHub secrets when their phase comes: OpenAI (transcription, Phase 3), OpenRouteService free key (Phase 1 route matrix).
5. Record 50 real WhatsApp voice notes ordering food in Lebanese Arabic, Arabizi-style mixed speech, English and French (at least 8 French or Arabic-French), from different people (family, friends; about 10-20 seconds each). This is the transcription eval set for Phase 3. No personal data in them.
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

## 16. All-Lebanon places list (DECIDED; sources fixed 7 October)
One list of every inhabited place in Lebanon, ready before launch; launch areas are chosen later by switching places on.

Structure (confirmed by Rasheed's Gemini report "Lebanese Villages and Logistics Mapping"): 9 governorates (Beirut, Mount Lebanon, Keserwan-Jbeil, North, Akkar, Beqaa, Baalbek-Hermel, South, Nabatieh), 26 districts, about 1,030-1,050 municipalities, 1,623 cadastral zones. The report lists only about 166 villages and misses some we need (Bakaata, Semqanieh), and its elevations and distances are unsourced, so it is used for structure and design, not as the data.

Second report ("Lebanon Master Geographic Gazetteer", 7 October) adopted for:
- Target size: about 2,240 delivery destinations (18 cities, 114 commercial towns, 1,320 villages, 788 hamlets, resorts and city quarters), not just the 1,029 municipalities. About 340 cadastral zones are uninhabited and are kept only for pin snapping.
- Identity: the official Arabic name plus parent municipality is the identity anchor; English spellings are aliases. Place IDs look like `LB-CHF-BAKAATA`.
- Places that are not municipalities get their own record linked to a parent: Bakaata (parent Jdeidet el-Chouf), Dora (Jdeideh), Kaslik (Jounieh), Dawha Aramoun (Aramoun), The Cedars (Bcharre). Two places, one council: Zgharta and Ehden.
- Same-name villages are always separate records with the district in the name shown to customers (e.g. Khraybeh Chouf vs Khraybeh Baalbek).
- Resort sectors as their own places, because their altitude differs from the village: Mzaar (Faraya), Faqra (Kfardebian), The Cedars.
- Each field carries a confidence value (verified, high, medium); village-centre elevation stored separately from the zone's minimum and maximum.
- Its roughly 320 listed places are used as a review and test set, not as the source: coordinates and elevations are re-derived from the sources below.
Not adopted now: hexagon grids (H3) and drive-time zones (PostGIS distance checks are enough at our size); altitude surcharges on delivery fees (merchants deliver themselves and set fees within the bands; revisit with the courier fleet in Phase 5b).

Sources, in order:
1. Polygons and codes: OCHA/HDX "Lebanon - Subnational Administrative Boundaries" (COD-AB, from CDR, updated November 2024): governorates, districts and the cadastral zones, each with a P-code. HDX still uses 8 governorates; the build maps Keserwan and Jbeil districts into the Keserwan-Jbeil governorate.
2. Arabic and official names: the CAS cadastral name and P-code list (HDX / Open Data Lebanon).
3. Villages, hamlets and city neighbourhoods inside cadastral zones, plus common spellings: OpenStreetMap place points (ODbL; attribution in the site footer).
4. Arabizi, French and colloquial spellings (Ba3qlin, Baaqline, Beit el Din, Beiteddine, Achrafieh/Ashrafieh, Jounié): generated by Claude, reviewed against real customer messages over time.
Built by a script in GitHub Actions (cloud sessions cannot reach these sites), stored as a seed file in the repo, checked by Claude for missing places and duplicates.

Fields: `id`, `pcode`, `name_ar`, `name_en`, `name_fr`, `aliases`, `kind` (city, town, village, hamlet, neighbourhood), `governorate`, `district`, `municipality`, `sub_region` (e.g. Chouf el-Aala, Iklim el-Kharroub, Matn el-Aala), `zone_type` (coastal, lower mountain, middle mountain, high mountain, inland valley, semi-arid), `elevation_m` (from a terrain model, not from the report), `winter_risk` (true for places that regularly get snow and road closures, e.g. Faraya, Kfardebian, Ehden, Bcharre, Tannourine), `centroid`, `boundary`, `parent_id`, `service_status` (`off`, `on`, `paused`), `paused_reason`.

Rules:
- Every place starts `off`. Switching a place `on` is one admin action, recorded in the audit log.
- South and Nabatieh governorates: all places loaded with `service_status = paused`, `paused_reason = security`.
- Customer address: first ask for the WhatsApp location pin (Meta's native location-request message); the server snaps the pin to its place by polygon. Only if no pin is possible: pick district, then place, from lists (or the `address_capture` Flow). Free text alone is never an address.
- Landmarks: a `landmarks` table (place, name in Arabic and English, aliases, point) grows from confirmed customer and merchant addresses; the bot uses the nearest landmark within 750 m to describe a pin back to the customer and the merchant.
- `winter_risk` places get a wider ETA range and a winter notice from November to April; merchants there can set a smaller winter delivery radius.

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
| H. Staff | Owner invites by phone number with a role: owner, manager, cashier, kitchen, driver (§27). Only owner and manager edit prices and menu |
| I. Business sold / new owner | New owner claims with documents; old owner notified and has 72 hours to object; then transferred |
| J. Closed, moved or wrong listing | Merchant marks closed or moved; customer reports or a Google "closed" status hide the listing until checked |
| K. Owner wants the listing removed | Deleted; `place_id` kept as do-not-re-import marker |
| L. Lost phone or access | Recover with a second verified number, else documents |
| M. Customer asks for a business we lack | Stored as a request with a counter; no message is ever sent to the business |

### 18.2 Profile pre-fill and editing
On a successful claim the profile opens pre-filled from the seed (name, address, location, phone, links, type) with every seed field marked "please confirm". The merchant confirms or corrects each, then fills what we never had: kitchen WhatsApp, owner mobile, delivery radius, hours, prep time, cash currencies, menu, photos. Every later change is made from the dashboard or by message to the merchant number ("change closing time to 11", "خلصت الكنافة"); the AI turns the message into a proposed change, the merchant confirms with one tap, and the server applies it. Prices, availability and hours are never changed by the AI without that tap.

### 18.3 AI tools for merchants
- Smart menu: import from photos, PDF, a link, or Instagram screenshots (Sonnet 5.5 extracts sections, items, options, prices); the merchant approves section by section. Bulk edits ("raise all grills by 10%"), sold-out toggles by message, menus by time of day.
- Profile writing: description in Arabic, English and French, tags, translations and Arabizi aliases proposed by AI, approved by the merchant.
- Photos: upload from phone or WhatsApp; AI suggests which menu item each photo belongs to; only light cleanup (crop, brightness), never changes to the food itself.
- Offers: discounts, combos, free delivery above an amount, time-limited deals; merchant-funded; validated and priced by the server.
- Paid broadcast: a merchant pays for one WhatsApp promotion sent by Alo King to customers who opted in to marketing and match the merchant's area or past orders. Rules: approved marketing template, maximum 2 promotional messages per customer per week across all merchants, STOP honoured instantly. Price per recipient = Meta's marketing rate plus a margin, set before launch.
- Paid recommendations: sponsored placement in bot suggestions and search, always labelled "مُموَّل · Sponsored", at most one per list, shown only when it matches what the customer asked for, delivers to the address and is open. Charged per delivered sponsored order; price set before launch.
- Insights: orders, revenue, top items, missed and late orders, customer ratings from real orders.
- Billing: merchants pay for everything from prepaid Alo King Credit topped up by Whish, with a monthly statement as fallback (section 20).

### 18.4 Build placement
Claims, registration, pre-fill, profile and menu editing (dashboard and WhatsApp) and the smart menu are Phase 3. Offers, paid broadcast, paid recommendations, insights and Alo King Credit are Phase 8 and are required before launch (decided 7 October).

## 19. Owner reminders (Claude raises these at every check until done)
- Whish: send the extra questions in section 20.6 (the first list is already sent) and get API documents and a sandbox key. After the SARL exists (about 17 October): open Alo King's own Whish business account.
- Lawyer: the questions in section 20.1 (collection model) and 21.6 (drivers). The letter gates online payments, not the build.
- Tap: apply the week the SARL exists, with the documents in section 22.5.
- Buy `aloking.com`; then create the browser Google key restricted to `aloking.com` and `*.vercel.app` and add it to Vercel's environment settings.
- Before launch, Google Cloud spending limits (10 minutes): (1) console.cloud.google.com → Billing → Budgets & alerts → Create budget → $5 a month, alerts at 50%, 90%, 100% to Rasheed's email. (2) APIs & Services → Places API (New) → Quotas & system limits → set per-day caps: Text Search 150, Place Details 300, Autocomplete 300. (3) APIs & Services → Credentials → the server key → API restrictions → only Places API (New).
- 50 voice notes for the transcription test (later).
- Company track: SARL (ready in about 10 days), then a fresh-USD business bank account (needed for Tap payouts and the Whish sweep), lawyer letter on sections 20.1 and 21.6, postpaid lines, Meta business account in the company name.

## 20. Money: collection, settlement, merchant credit, paid tools (DECIDED; corrected 7 October 12:28)
Correction by Rasheed: every Whish payment goes into Alo King's own Whish account, and Alo King settles with merchants. The earlier "paid straight to the merchant" rule is withdrawn. It stays only as the fallback if the lawyer refuses the collection model (20.1).

### 20.1 Customer pays (customer → Alo King → merchant)
- **Methods:** cash on delivery (cap $150, held in config); Whish payment link into Alo King's Whish business account; foreign card through Tap for Send Home and visitors (section 22).
- **Who collects cash:** whoever delivers. Merchant delivery: the merchant keeps the cash. Alo King fleet: the driver collects for Alo King (section 21.4). Partner delivery: the partner collects and remits to Alo King under its contract.
- **Legal model (lawyer confirms in writing before online collection goes live):** Alo King collects as the merchant's **disclosed commercial agent**, under a collection mandate the merchant accepts at go-live (one tap, stored with version and timestamp). The merchant stays the seller of the food and issues the food invoice. Alo King invoices only its own fees. BdL Decision 13790 (January 2026) now licenses electronic payment service providers, so the lawyer answers three questions:
  1. Is agent collection with settlement every 2 weeks outside the EPSP licence?
  2. If not, does acting as merchant of record (Alo King buys and resells the meal) avoid it, and at what VAT cost?
  3. What is the longest settlement period allowed?
  If both models need a licence, the fallback applies: payment links on each merchant's own Whish account, with Alo King recording the result only.
- **Refunds:** back to the original Whish payment or card; never to a wallet. Charged to the merchant only when the merchant caused it (wrong or missing item, cancelled after accepting); otherwise Alo King absorbs it. Each refund is a ledger entry.

### 20.2 Settlement to merchants (automated)
- **Cycle:** every 2 weeks; the cycle closes Sunday 23:59 Beirut time and payout runs Tuesday. A merchant may choose monthly in the dashboard. Every 2 weeks is the default because it keeps the float small and small restaurants need the cash.
- **Net payout** = online payments collected for delivered orders + COD cash the Alo King fleet or a partner collected for this merchant − Alo King order fees − Alo King delivery fees on online orders it delivered − approved refunds caused by the merchant − unpaid paid-tool charges.
- **Payment:** a Whish-to-Whish transfer (free on Whish's fee page) to the merchant's verified Whish account, through the Whish payout API. A bank transfer is used only if the merchant has no Whish account. Each payout needs the merchant's payout account confirmed by OTP; changing it freezes payouts for 72 hours and alerts the old number (anti-takeover).
- **Negative balance** (mostly cash orders, so fees exceed collections): deducted from Alo King Credit first; the remainder carries to the next cycle. Unpaid after 2 cycles: paid tools pause. After 3 cycles: orders pause.
- **Statement:** sent on WhatsApp as a PDF and shown in the dashboard: each order, gross, fees, refunds, net. The merchant can dispute a line within 7 days; the AI drafts the answer from the ledger, and Rasheed approves adjustments over $20.
- **Reconciliation, daily and automatic:**
  - Whish transactions are matched against `payments`, and payouts against `settlements`.
  - Any mismatch opens a money incident, alerts the admin and blocks that merchant's next payout until resolved.
  - "Zero unresolved money mismatches" is a customer-ads gate (section 1).
- **Float control:** Whish lists a USD 30,000 balance limit for corporate accounts. When Alo King's Whish balance passes $15,000 (config), the excess moves automatically to the SARL's fresh-USD bank account. If the balance stays above that after the sweep, settlement switches to weekly. Ask Whish to raise the limit (20.6).

### 20.3 Alo King Credit (merchant → Alo King), automated end to end
- **Purpose:** a prepaid, closed-loop balance spent only on Alo King services (paid broadcasts, sponsored orders, and order fees when settlement doesn't cover them). It cannot be transferred, withdrawn or used with another merchant, and earns no interest. Unused credit is refunded when the merchant closes its account. The lawyer confirms it in the same letter.
- **Top-up, three ways:**
  1. A Whish payment link from the dashboard or WhatsApp ("charge 20$" → link). Minimum $10.
  2. Auto top-up from settlement: the merchant ticks "keep my credit at $X", and the next payout tops it up first.
  3. Admin credit with a reason (promotions, compensation). Over $20 needs Rasheed's tap.
- **Sync:**
  - The Whish webhook (signature checked, idempotent) writes the ledger entry. A Postgres trigger updates the balance view.
  - Supabase Realtime pushes the new balance to the dashboard.
  - The WhatsApp bot answers "رصيدي / my balance" from the same view.
  - The AI tools `get_credit_balance`, `quote_campaign` and `reserve_budget` read and write only through server functions. The AI never computes money.
  - A missed webhook is recovered by the 5-minute Whish status poll and the daily reconciliation.
- **Automation rules:**
  - A campaign or sponsorship reserves its budget when it starts. It is charged per delivered message or order and releases the rest at the end.
  - At 20% of a running budget or under $5 of credit, the merchant gets a WhatsApp alert with a one-tap top-up link.
  - At zero, paid tools pause automatically and resume when the top-up lands.
  - The AI brain suggests a top-up only with the numbers ("your weekend broadcast reached 412 customers and brought 9 orders").
- **Ledger:** every movement is an append-only entry in one ledger:
  - customer payment, refund, COD collected, COD deposited, order fee, delivery fee, settlement payout
  - credit top-up, broadcast charge, sponsored charge, credit refund, admin adjustment with reason
  Balances are views over the ledger, never edited. Statements and VAT invoices come from the ledger. VAT applies once the SARL is registered, at the rate in the VAT table.

### 20.4 Launch prices (stored in a dated price table, changeable without code)
| Product | Price | Rules |
|---|---|---|
| Order fee | $1.00 per delivered order | first 30 days free per merchant |
| Paid broadcast | $0.08 per delivered message, minimum $5 per campaign | audience = customers who opted in to marketing AND either ordered from this merchant or live inside its delivery radius and order its category; max 2 promotional messages per customer per week across all merchants; merchant shown the audience size and exact cost before paying; undelivered messages not charged |
| Sponsored recommendation | $0.40 per delivered order that came from a sponsored suggestion within 24 hours | labelled "مُموَّل · Sponsored · Sponsorisé"; at most one per list; shown only if relevant, open and delivering to the address; merchant sets a daily budget; sponsors rotate by remaining budget and quality score; no auction at launch |
| Offers (discounts, combos, free delivery) | free to create | merchant-funded; server-validated |
| Send Home service fee | $1.50 per order, paid by the sender | covers card fees (about 3%) and the extra support; reviewed after 100 Send Home orders |

Broadcast margin check: Meta charges $0.0392 per delivered marketing message in Lebanon; $0.08 covers that plus replies and AI handling.

### 20.5 Quality guards for paid tools
- A merchant whose broadcasts get more than 2% STOP replies or any WhatsApp block-rate warning is paused from broadcasting for 14 days.
- Sponsored placement is dropped for merchants with acceptance under 90% or more than 5% late orders in the last 14 days.
- Paid placement never changes organic ranking; customers can always ask "show me without sponsored".

### 20.6 Questions for Whish
The first list is already sent. Send these too as provider questions; no negotiation is needed.
1. API documents and a sandbox key for payment links, payment status, signed webhooks, refunds **and payouts (Whish-to-Whish transfers from our account to merchants' accounts by API)**.
2. Can international Visa/Mastercard holders pay our payment links, and at what fee?
3. Can the USD 30,000 corporate balance limit be raised for a marketplace that settles merchants every 2 weeks?
4. The 1% rate in writing: which products, and the settlement timing to a Lebanese bank.
5. Requirements to open Alo King SARL's business account.

## 21. Delivery: three modes, one adapter (DECIDED, 7 October)
Every order has exactly one fulfilment mode, chosen by the server, never by the AI. The code talks to one `delivery_provider` interface with three implementations:
- `merchant`: the merchant delivers.
- `fleet`: Alo King drivers.
- `partner`: an outside delivery company.

Each one supports the same calls: quote, book, cancel, status, proof, cash report. Adding or swapping a partner is config plus one adapter file.

### 21.1 The three modes
| | Merchant delivers | Alo King fleet | Partner delivers |
|---|---|---|---|
| When | Default at pilot and for any merchant with its own drivers | Dense areas where volume pays for drivers | Areas or hours where we have no fleet and the merchant has no driver; scheduled non-hot deliveries |
| Customer fee | Bands; merchant may go lower | Bands (Alo King's revenue) | Bands; Alo King pays the partner and covers any difference up to the subsidy cap |
| Who holds COD cash | Merchant | Driver, for Alo King, then settlement | Partner, remitted to Alo King, then settlement |
| Tracking | Merchant taps "out for delivery / delivered"; optional live pin from the merchant's driver link | Driver app with live location | Partner status by API or webhook mapped to our states |
| Proof | Merchant tap + customer confirm | Photo + GPS + customer confirm or OTP for orders over $50 | Partner proof |

### 21.2 How the mode is chosen (per merchant, per order)
- In the dashboard, each merchant picks one of:
  - "I deliver everything"
  - "Alo King delivers everything"
  - "I deliver up to X km, Alo King beyond"
  - "I deliver; use Alo King when my drivers are busy" (one tap on the order: "need a driver")
- At checkout the server takes the merchant's setting, checks which modes are open for the delivery point (fleet and partner areas are polygons in the database, switched on and off by config), and books the first available mode in this order: merchant → fleet → partner.
- If no mode can deliver, the order is not offered (the customer sees "this place can't deliver to you now" plus pickup if the merchant allows it).
- Pickup (customer collects) is a fourth option, free, on by merchant choice.

### 21.3 Alo King fleet
- **Opening rule:** a fleet area opens when a 5 km cluster averages 40 or more delivered orders a day for 14 days, or when merchants there representing 30% of orders ask for it. Both numbers live in config. Below that, a fleet loses money on idle time.
- **Drivers:** independent contractors with their own motorcycle.
  - **Onboarding** is remote, with no visits: ID, driving licence, motorcycle registration and valid insurance photographed in the driver app; a video call; a test delivery with an operator watching live tracking.
  - **Equipment:** an insulated bag with the Alo King logo, at a deposit.
- **Pay:** 80% of the delivery fee plus 100% of tips, paid weekly by Whish. A guaranteed hourly minimum for booked shifts covers quiet hours in a new area (amount in config, decided when the first area opens).
- **Dispatch:** automatic. Pick the nearest available driver by road time, considering their current load (max 2 orders batched if both pickups are within 1 km and the second drop adds under 8 minutes). The offer is accepted within 30 seconds or goes to the next driver; an operator steps in after 3 refusals.
- **Driver app:** the existing PWA, rebuilt in Phase 5b and wrapped with Capacitor as an Android app for background location (§27.2). It has job offers, navigation hand-off to Google Maps or Waze, pickup and drop-off steps, cash collected, photo proof and an SOS button.
- **Safety:** no dispatch to South and Nabatieh while they are paused. Night cut-off by area (config). Weather and winter-risk places (section 16) block or delay automatically.

### 21.4 Cash custody for the fleet (the main risk)
- Each driver has a cash-in-hand limit of $150 (config). Above it they get no new COD jobs until they deposit.
- Drivers deposit daily by Whish to Alo King's account or at a set cash point. Every deposit is matched to the cash the app says they collected. A shortfall is deducted from the driver's next pay and opens an incident.
- The ledger tracks cash per driver: collected → deposited → settled to the merchant.

### 21.5 Partners (outsourcing)
- **Hot food:** Alo King contracts a local on-demand courier company per region for a pickup under 15 minutes and delivery under 45 minutes, with an API or webhook and COD remittance at least weekly.
  - A partner is chosen by a short written request for quote (sent by Claude; Rasheed only signs).
  - Toters and other ordering apps are competitors, so they are not used as partners.
- **Parcel carriers** such as Wakilni (24–72 hours, $6–15+ per its site) are used only for scheduled non-hot deliveries: water, gas and essentials bundles, Send Home gift boxes and next-day orders.
- **Partner kill-gate:** a partner whose late rate exceeds 10%, or whose cash is remitted more than 7 days late, is switched off by config.

### 21.6 Questions for the lawyer (same letter as 20.1)
1. Driver status as independent contractors: NSSF exposure, and the contract wording.
2. The third-party motorcycle insurance a driver must hold, and whether Alo King needs its own liability cover.
3. Liability split for food damaged in transit by fleet versus partner.

### 21.7 Build and switch-on
- **Built before launch:** the adapter and the `merchant` mode (pilot), then `fleet` and `partner`.
- **Switched on after the pilot:** fleet and partner areas, by config, when the opening rule is met or a partner contract is signed.
- **No delivery fee surcharges at launch:** no altitude, night or weather surcharges. These are revisited with fleet data.

## 22. Send Home: orders paid from abroad (DECIDED, 7 October)
Lebanese abroad order on WhatsApp for family in Lebanon and pay by card. The rule that resolves every scenario: **the phone number says nothing about where a person is. The delivery point decides where food goes; the payment method decides the risk checks.** We never infer location or nationality from a country code.

### 22.1 Who is ordering for whom: the bot asks once
When the delivery address is not one of the customer's own saved addresses, or the message says it's for someone else ("for my mom", "pour ma mère", "la emme"), the bot asks: "Is this order for you or someone else?". If it is for someone else, the order becomes a gift order with three people:
- **sender:** pays, gets all updates
- **recipient:** name, phone, address
- **merchant**

### 22.2 Scenarios
| # | Situation | How it works |
|---|---|---|
| 1 | Foreign number, abroad, sends to family | Gift order. Pay by card (Tap) or Whish link. COD only if the recipient accepts paying (scenario 7). |
| 2 | Lebanese number on roaming abroad, sends to family | Same as 1. We don't detect location and don't need to. |
| 3 | Foreign number, in Lebanon (visiting or summer), orders for self | Normal order. Delivery point from the shared location pin. Pay COD, Whish or card. Until the number has one delivered order, COD is capped at $50 (config, same rule for every new number: §29.4) and the merchant sees "new customer". |
| 4 | Foreign number, in Lebanon, orders for someone else | Gift order, like 1. |
| 5 | Lebanese number in Lebanon orders for someone else (e.g. parents in another village) | Gift order; all payment methods. |
| 6 | Customer in Lebanon builds a basket and asks a relative abroad to pay ("pay for me") | The bot creates a pay-for-me link valid for 30 minutes. The relative pays by card or Whish on a web page. The order starts only when the payment lands. The payer gets a receipt and tracking. |
| 7 | Sender orders, recipient pays cash | Allowed only after the recipient taps "Accept and pay on delivery" on WhatsApp. This prevents prank and harassment orders. |
| 8 | Sender doesn't know the exact address | The sender gives the recipient's number. The recipient gets a utility template "Rami sent you an order from X. Share your location" with a button. The recipient's tap opens the chat, and the bot sends a location request. The order waits 2 hours for the pin, then is cancelled with a full refund. |
| 9 | Scheduled for a date (birthday, Eid, Mother's Day, Christmas) | Up to 14 days ahead, by date and time window in Lebanon time, also shown in the sender's time zone. Paid at checkout. The merchant must confirm 24 hours before; if not, Alo King offers a similar merchant or a full refund. |
| 10 | Recurring (weekly groceries, water, gas for parents) | After launch, phase 2 of Send Home. Card saved with Tap (token, sender consent). Each cycle is confirmed by the sender's tap 24 hours before and can be skipped or stopped anytime. |
| 11 | Several family addresses | The sender's address book: "Mom – Baakline", "Teta – Achrafieh", each with the recipient's phone. |
| 12 | Recipient not reachable at the door | The driver calls the recipient twice, then the sender (WhatsApp call link); waits 10 minutes; leaves it with a neighbour or concierge only with the sender's tap. Otherwise the order returns and the sender gets Alo King Credit for the food (the food was made), with the delivery fee refunded to the card. |
| 13 | Recipient refuses the gift | Same as 12, without the waiting. |
| 14 | Merchant rejects or runs out | Automatic full refund to the card within 1 minute of the rejection. The sender is offered a similar place first. |
| 15 | Sender writes in French, English, Arabic or Arabizi | Full support in all four. The recipient's messages go in the recipient's language: Arabic by default, or as the sender chooses. |
| 16 | Card country, number country and delivery country all differ | Normal for diaspora, so never a fraud signal on its own. |
| 17 | Gift note | Up to 200 characters, printed on the merchant ticket and sent to the recipient on delivery. No photos from the sender (moderation). |
| 18 | Company abroad sending to staff or clients in Lebanon | Later, through the same gift flow with an invoice in the company's name. |

### 22.3 What sender and recipient see
- **Sender:** confirmation, "accepted", "out for delivery" with tracking link, and "delivered at 19:42" with the delivery photo when the fleet delivers. These are utility messages in the 24-hour window or utility templates.
- **Recipient:** at most two messages per order — "an order from Rami is on its way" (utility template) and, if needed, the location request. The sender ticks "they expect this order" before the first template, and the recipient can reply STOP to block all future gift messages.
- Recipients are never added to marketing lists from a gift. Marketing consent is only ever given by the person themselves.

### 22.4 Fraud and chargebacks
- **3-D Secure on every card payment.**
- New cards: max $150 per order and $300 per day, until 2 delivered orders.
- 3 failed payments in an hour block that number for 24 hours.
- **Chargeback evidence** is collected automatically: 3DS result, delivery photo and GPS, recipient or customer confirmation tap, and the message log.
- Alo King, not the merchant, carries Send Home chargebacks. 2% of Send Home revenue is held in a reserve account in the ledger.
- Sanctions and card screening are done by the gateway.

### 22.5 Gateway decision: Tap Payments
- **Primary: Tap Payments.** Tap markets itself for Lebanon and says it supports:
  - Visa, Mastercard and Amex
  - branded payment links shared over WhatsApp
  - payouts to local banks in Lebanon
  - an API, SDKs and a sandbox

  This is the closest fit for WhatsApp checkout. Apple Pay, Google Pay and card tokenisation for recurring baskets must be confirmed for Lebanese merchants in the application. Pricing is not public: ask for it in the application; third-party sources suggest about 2.9% for international cards.
- **Day-one bridge:** a Whish payment link, if Whish confirms foreign cards can pay it (20.6, question 2; 3% on its fee page).
- **Fallback:** if Tap declines or stalls beyond 30 days, apply to Areeba (card acquiring through a Lebanese bank; slower paperwork).
- **Not possible:** Stripe (not available to a Lebanese company), PayPal (no merchant payouts in Lebanon), WhatsApp native payments (not offered in Lebanon).
- **Application, the week the SARL exists:**
  - Documents: commercial registration, articles, IDs of the managers, a fresh-USD bank account, website on `aloking.com` with terms, privacy policy, refund policy and contact page (Phase 4 delivers these pages).
  - Use case: "marketplace food and grocery delivery; WhatsApp payment links; diaspora gifting".
  - Claude prepares all the text; Rasheed submits.
- **How it plugs in:** the payment adapter gets a `tap` provider:
  - create charge or payment link
  - signed webhook
  - refund
  - token for recurring

  The money lands in Alo King's Tap balance, pays out to the SARL bank account, and is settled to merchants in the same 2-week cycle (20.2).

### 22.6 Build and switch-on
- Phase 6 builds the gift order model, pay-for-me links, the recipient templates and the Tap adapter against Tap's sandbox.
- It switches on in production when Tap approves the SARL and the lawyer letter covers collection.
- The diaspora campaign (Meta ads in France, Canada, the Gulf, Australia, the US, West Africa) is a later decision, as Rasheed said.

## 23. How merchants receive orders: every channel, one router (DECIDED, 7 October 12:45)
Big Lebanese restaurants and chains run their own POS, call centre or ordering app and won't work orders from WhatsApp. Small ones have only a phone. Both must work.

The server sends every order through one `order_channel` interface:
- **Calls:** deliver, acknowledge, cancel, status, menu and availability sync.
- **Channels:** one implementation per channel (below).

An order counts as **received** only when its channel acknowledges it:
- an API acknowledgement with the POS order ID
- a printer job confirmed printed
- a button tap
- a call keypress
- the portal opened on the order

Sending alone never counts. The four-layer escalation in section 2 applies to every channel. If the primary channel hasn't acknowledged in 15 seconds, the backup fires. At 45 seconds the automated call goes out, and at 75–90 seconds an operator steps in.

### 23.1 The channels
| Channel | Who it fits | How it works | Built |
|---|---|---|---|
| Merchant portal (web app on phone or tablet) | Default for everyone | Loud alarm, accept or reject with prep time, item out of stock, ready, picked up | Phase 2 |
| WhatsApp (Merchant number) | Small shops, owners on the move | Order card with Accept / Reject / prep time buttons; status by buttons | Phase 2 |
| Automated phone call (Twilio voice) | Phone-only shops; backup for all | Arabic voice reads the order; press 1 to accept, 2 to reject, 3 to repeat; then WhatsApp gets a copy | Phase 2 |
| Kitchen printer (cloud receipt printer: Star CloudPRNT or Epson Server Direct Print) | Busy kitchens without screens | Ticket prints automatically in Arabic and English; acceptance is a tap on the portal, WhatsApp or the call | Phase 2 (adapter), printer optional |
| Through Deliverect | Chains already using Deliverect for other apps | Alo King joins as an ordering channel; orders land in their POS through Deliverect | When the first chain asks; channel-partner terms to be confirmed with Deliverect |
| Direct POS or ordering-system API (Omega POS, Foodics, Oracle Simphony, Squirrel, XStak, a chain's own platform) | Chains with an API and enough volume | One adapter per system: push order, item ID mapping, status back, menu and availability pulled from the POS (POS becomes the menu source) | Built per system when a merchant brings 30+ orders a week or is a chain of 3+ branches; Claude builds it from the vendor's API documents |
| Concierge relay | Chains that refuse all of the above but deliver by their own hotline | An Alo King operator places the order on the chain's hotline or their own WhatsApp, as a customer would, then relays status; later a voice agent does it | After the pilot, only for chains customers ask for most; menu and prices must be confirmed by the chain first |
| Email | Never primary | Copy of each order and the daily summary, if the merchant wants it | Phase 2 |

### 23.2 Scenarios
1. **Owner-run shop, one phone:** WhatsApp primary, with the call as backup.
2. **Restaurant with a cashier and a tablet:** the portal primary, WhatsApp as backup, printer optional.
3. **Busy kitchen:** the printer plus the portal; the call goes to the manager's phone.
4. **Chain with POS through Deliverect:** the Deliverect channel. The branch portal stays as backup and shows status read-only.
5. **Chain with a direct POS API:** the POS adapter, with the portal as backup.
6. **Chain with a central call centre** (one place for all branches): the call centre gets a brand dashboard with all branches and routes to the branch. Alo King still picks the branch by delivery radius and suggests it.
7. **Chain that refuses integration:** the concierge relay.
8. **Integration down** (the POS API errors or times out): an automatic fallback to the backup channel, with an incident logged. After 3 failures in an hour, the merchant switches to backup for the day.
9. **Item unavailable in the POS:** the POS availability pull hides it within 5 minutes. An order already placed gets a substitution offer to the customer.
10. **Price differs between the POS and Alo King:** the POS price is used only after the merchant approves the mapping once. Afterwards, any difference above 5% holds the item until the merchant confirms. This keeps "AI proposes, server decides".
11. **Multi-branch brand:** one brand, many branches, each with its own radius, hours, channel and settlement account. Settlement goes to the branch, or to HQ if the brand chooses.

### 23.3 Tools to add
- **Now (Phase 2):** Twilio voice is already planned. The cloud-printer adapter is software only.
- **Per merchant, optional:** a Star mC-Print3 or similar CloudPRNT printer bought by the merchant, or lent by Alo King against a deposit; a cheap Android tablet for the portal.
- **When the first chain asks:** a Deliverect channel-partner application (Claude drafts it, Rasheed submits). For direct POS adapters, the API documents come from the chain's POS vendor.
- **Not used:** Otter, UrbanPiper, Grubtech, unless a target chain already runs one. They are added the same way as Deliverect.

## 24. Website revamp: every page rebuilt (DECIDED, 7 October 12:45)
The old Lovable pages are discarded as designs. Route logic is reused only where it fits the new schema. The design system in section 5 stays: Crown Gold, ink, cream, Plus Jakarta Sans and IBM Plex Sans Arabic, WCAG 2.2 AA, right-to-left first-class. French is added as a third site language.

### 24.1 How it is built
- **Design system first:**
  - Tokens, components (shadcn/ui themed), icons, imagery rules and motion, in `src/design/`.
  - Built with the `frontend-design` skill in a Sonnet 5.5 session, before any page.
  - Direction: warm, Lebanese, confident; the "Alo" phone-call motif. No stock-template look.
- **Visual review without Rasheed testing:** every website PR runs Playwright and posts screenshots in the PR comment. These cover each changed page on mobile and desktop, in Arabic, English and French. The Claude review job checks them against the design system. The Vercel preview link is there if Rasheed wants to look; he never has to.
- **Budgets enforced in CI:**
  - Lighthouse mobile ≥ 90 for performance, accessibility and SEO.
  - LCP under 2.5 s on simulated 4G.
  - JavaScript under 150 KB on public pages.
  - Accessibility checked with axe.

### 24.2 Pages
| Area | Pages |
|---|---|
| Customers | Home (search by place, dish or cuisine; "Order on WhatsApp"); place pages; cuisine and category pages; claimed vendor pages (menu, hours, delivery area, offers, "Order on WhatsApp" with the basket pre-filled); basket handoff; order tracking; pay page and pay-for-me page (section 22); Send Home landing (Arabic, English, French); help and FAQ; contact |
| Merchants | "For merchants" landing; claim flow; registration flow; merchant dashboard (orders, menu, hours, delivery settings, channels, offers, broadcasts, sponsored, credit, settlements and statements, insights, team, branches) |
| Drivers | Driver sign-up and the driver app (section 21.3) |
| Admin | Claims queue, merchants, orders, money incidents, settlements, partners, places on/off, prices and config |
| Legal | Terms, privacy, refund policy, merchant terms, collection mandate, driver terms, cookie notice (Tap and the lawyer need these) |

### 24.3 Claim and registration on the website
- **Search, then verify:**
  1. Search your business by name or on the map, and pick the result.
  2. Verify with an OTP on the seed phone by WhatsApp or SMS, or upload papers for cases C–M in section 18.
- **Not found:** register as new — a business number OTP, a pin on the map, the type, papers.
- **After verifying, an AI onboarding assistant** sits in a side panel in the dashboard:
  - turns menu photos, a PDF or a link into a draft menu
  - writes the descriptions in three languages
  - suggests delivery radius and fees within the bands
  - checks the go-live checklist

  The merchant approves each item with a tap.

### 24.4 AI on the website
- **Customers:** no separate site chatbot. "Ask Alo King" opens WhatsApp with the context pre-filled (place, basket, dish), because ordering happens in one brain. Site search uses the same search the bot uses: dish, cuisine or place, in four languages and Arabizi.
- **Merchants:** the dashboard copilot. It answers from the merchant's own data, drafts offers and broadcasts, and explains statements. It changes nothing without the merchant's tap.

### 24.5 SEO
- **Rendering and structure:**
  - Server-rendered pages.
  - Language URLs `/ar`, `/en` and `/fr` with hreflang, and an Arabic default for Lebanon.
  - Canonical URLs, breadcrumbs, a real 404, and sitemaps per page type, regenerated nightly.
- **Structured data:** schema.org Restaurant or LocalBusiness, Menu and Offer on claimed vendor pages; FAQPage on help; Organization on home. Only data that is visible on the page.
- **What gets indexed:**
  - Claimed vendor pages only.
  - A place page is indexed only when 3 or more live merchants deliver there; otherwise it is `noindex`. This avoids thin pages.
  - The Send Home pages target "send food to family in Lebanon" searches in English and French.
- **Owner setup (Claude prepares, Rasheed clicks):** Google Search Console and Bing Webmaster after the domain is bought; a Google Business Profile for Alo King.

### 24.6 AIO (being the answer in ChatGPT, Gemini, Claude and Perplexity)
- **Crawlers:** `robots.txt` allows GPTBot, ClaudeBot, PerplexityBot and Google-Extended on public pages.
- **`llms.txt`** (upgraded from "optional" in section 5): what Alo King is, where it delivers, how to order, and links to the live place and vendor lists.
- **Pages written to be quoted:** each place page opens with one factual sentence ("12 restaurants deliver to Baakline through Alo King on WhatsApp; delivery $2–4.50"), generated from live data. The FAQ answers the questions people ask assistants.
- **Consistent identity:** one name, number and description on the website, Google Business Profile, Meta and WhatsApp.

### 24.7 Analytics and privacy
- **PostHog**, cookieless by default, tracks: WhatsApp click, claim start and finish, registration, pay-page conversion, Send Home funnel.
- No personal data in events.
- Consent banner only if a marketing pixel is added (the Meta pixel is added with the ads decision).

### 24.8 Build placement
- **Phase 4 becomes "Website revamp":** design system, then public pages, claim and registration, legal pages, SEO and AIO, then the dashboard restyle.
- **Pages in other phases** use the same design system: dashboard screens in Phases 2, 3 and 8, the driver app in 5b, pay pages in Phase 6.

## 25. Build autonomy (DECIDED, 7 October 12:45)
Rasheed's rule: Claude Code works and auto-merges, and never asks him.
- **Decisions:** build sessions never stop to ask the owner. They decide per this file, write the decision and its reason as one line in `docs/decisions/LOG.md`, and continue. If this file is silent, they choose the option that is reversible and cheapest, and log it.
- **Owner tasks:** something only Rasheed can do (sign, pay, verify identity, use his accounts) becomes a GitHub issue labelled `owner`, with exact click steps. The session continues with other work, and the issue list is the owner's to-do list.
- **Merging:** every PR merges automatically when CI is green (section 10). A red CI is fixed by the same session; nobody is paged.
- **Hard stops (the only exceptions):**
  - anything touching `main` or production
  - Kabsi resources
  - spending money
  - deleting data without a rollback

  The session does not ask about these either; it opens an `owner` issue and works around them.

## 26. Kapso open-source repos (DECIDED, 7 October 13:51)
| Repo | Decision | Why |
|---|---|---|
| `gokapso/whatsapp-cloud-api-js` (npm `@kapso/whatsapp-cloud-api`, MIT) | **Use.** The one WhatsApp client in edge functions (via `npm:` import), from Phase 2 | Typed sending of text, media, interactive, templates and Flows; webhook signature verification; Kapso proxy for history and contacts. Replaces hand-written send code. Every card still passes `meta-limits.ts`. |
| `gokapso/agent-skills` | **Use** (already vendored in `.claude/skills/`) | The three Kapso skills. Refreshed with `npx skills add gokapso/agent-skills` at the start of Phase 3, with `skills-lock.json` updated in the same PR |
| `gokapso/whatsapp-broadcasts-example` (MIT) | **Reference only** for Phase 8 | Paid broadcasts send through Kapso's Broadcasts API (rate limits, delivery stats); Alo King's server still owns audience, consent, STOP, pricing and billing (§20.4) |
| `gokapso/whatsapp-cloud-inbox` (Next.js, MIT) | **Not deployed.** Operators use Kapso's hosted inbox at pilot; our admin conversation view borrows its patterns in Phase 4b | A separate Next.js app is one more thing to host and secure |
| `gokapso/whatsapp-support-agent` (Bun + Slack) | **Not used** | Its "answer if confident, else hand to a human" pattern is already in §2's escalation; Slack is not in our stack |
| `gokapso/claude-code-whatsapp` | **Rejected** | Runs Claude Code on GitHub repos from WhatsApp messages in remote sandboxes with repo tokens: a needless attack path. Builds run in claude.ai/code only |

## 27. Delivery operations: drivers, live tracking and the dispatch brain (DECIDED, 7 October 15:30; replaces the 14:50 version)
Extends section 21, which stays: three modes, one `delivery_provider` adapter, the fleet opening rule, cash custody and the partner kill-gate. This section decides how every driver in every mode is connected, tracked, chosen, watched and proven, and how WhatsApp live location is used both ways.

### 27.1 Principles
1. **Two tracking layers, always both.**
   - *System tracking* (our app, our link or the partner API) is what the dispatch brain sees and decides on.
   - *WhatsApp live location*, shared person to person, is what the customer sees inside WhatsApp.

   VERIFIED (ActiveCampaign WhatsApp API help, 7 October): the WhatsApp Business Platform cannot receive live location; it arrives as an `unsupported` message. So WhatsApp live location can never feed our system, and our system never depends on it. It is still the most trusted tracking a Lebanese customer knows, so we use it on every order.
2. **Every driver is tracked from pickup to handover, in every mode.** No tracked position means no "Live" label, a wider ETA range and a lower quality score, never a silent gap.
3. **The dispatch brain is deterministic server code, not an LLM.** It runs on events plus a 15-second tick. The LLM only explains (customer asks "where is my order?") and drafts operator summaries. Assignments, reassignment, ETAs and alerts are computed, logged and replayable.
4. **One driver app for everyone who drives.** The Alo King Driver app serves fleet drivers and, free, merchants' own drivers. For merchants it doubles as their own fleet tool, with their drivers on a map in the dashboard. The no-install fallback stays for drivers who refuse.

### 27.2 How every driver stays connected
| | Alo King fleet | Merchant driver, with the app (target) | Merchant driver, no app (fallback) | Partner courier |
|---|---|---|---|---|
| Identity | Fleet driver account, remote verification (§21.3) | Merchant staff role `driver` (added to §18.1 H), invited by phone; signs in by WhatsApp OTP from the Merchant number | Same staff role | Partner account; courier name, phone and vehicle from the partner API |
| Device | **Alo King Driver: Android app** (the PWA wrapped with Capacitor, background location; change to §21.3). iOS: the PWA with screen kept on during jobs | Same app | WhatsApp job card from the Merchant number plus a signed driver link (expires delivery + 2 h) | Partner app |
| System tracking | Online: every 60 s; on a job: every 10 s or 50 m; offline: none | On a job only (merchant drivers are not tracked off the job) | While the link page is open (foreground); any static pin the driver sends counts as a ping | Partner API position; required at ≤ 30 s in every partner contract (§21.5 request for quote) |
| Job offers | Push notification with loud sound (Firebase Cloud Messaging, free); if not opened in 10 s, a WhatsApp message from the Merchant number | Push, or WhatsApp | WhatsApp | Partner API |
| Dead zones | Steps and positions queue on the phone with timestamps; synced on reconnect | Same | Taps queue in the page | Partner's |
| Health checks | Heartbeat; auto-offline after 15 min silent; no offers below 15% battery or with location permission off; Android mock-location flag = suspended pending review | Same while on a job | — | Partner SLA timers |

Data cost to drivers is small (about 10 MB a shift); no allowance at launch.

### 27.3 WhatsApp live location, both directions
**Driver → customer (every order, every mode):** at `picked_up`, the driver's job screen shows one step: **"Share live location with the customer (1 hour)"**. It opens a WhatsApp chat with the customer (wa.me link, pre-filled "Hi, I'm Ali from Alo King with your order from X"), where the driver taps 📎 → Location → Share live location → 1 hour.
- **Fleet:** the step is mandatory. The app records the tap, and the order shows "Live" to the customer.
- **Merchant drivers:** the same step is on the app, the link and the WhatsApp job card.
- **Partners:** contractually required where the partner allows it; otherwise our tracking page only.
- When the driver taps "Delivered", the app reminds them to stop sharing; WhatsApp's 1-hour limit ends it anyway.

**Customer → driver (on demand):** when the driver is at `near_drop` (≤ 500 m) and the drop confidence (§28) is below "high", or the building is tagged hard to find, or it is after sunset, the customer gets the button **"Share live location with your driver"**. It opens the driver's chat for a person-to-person live share. The driver app shows "Ask for live location" at any time after `arrived`.

**What the customer gets in the Alo King chat** (within the §6 cost model):
1. Accepted, with the ETA range.
2. On the way: the driver's first name, a photo (fleet), "Ali is sharing his live location with you on WhatsApp", the tracking link and "Call driver".
3. "About 3 minutes away" (once, at `near_drop`), with the live-location button when the conditions above hold.
4. Delivered, with "Received ✅ / Problem".

The tracking page shows the system position every 15 s between `picked_up` and `delivered`, never afterwards, never the customer's own pin publicly (§3 stays).

**Send Home:** the recipient gets the driver's live share and the near-drop message. The sender gets status and the tracking link with the driver dot only, never the recipient's exact pin.

**Numbers:** Lebanon has no practical call masking, so driver and customer see each other's WhatsApp numbers. Driver terms forbid keeping or reusing customer numbers. The app hides the customer's number 2 h after delivery. Customers can report misuse in one tap; a confirmed report ends a fleet contract or a merchant driver's access.

### 27.4 The dispatch brain: assignment
Triggered the moment an order is accepted, re-evaluated on every event and every 15 s until `picked_up`.

**Step 1, mode** (server, per §21.2): merchant → fleet → partner. Before the customer confirms, the brain checks capacity: if no driver in any open mode can reach the pickup by `ready_at + 10 min`, the customer is shown a wider ETA or "pickup only" *before* paying. We never promise a delivery we can't staff.

**Step 2, driver** (fleet, and merchant drivers using the app):
1. **Idle drivers first.** Rasheed's rule: the closest available driver with no current order gets it. "Closest" means road time to the pickup (ORS, corrected by §28), not straight line.
2. A driver with one active order is considered only if no idle driver can reach the pickup by `ready_at + 5 min`, and only under §21.3's batching rule (pickups within 1 km, second drop adds under 8 min, max 2 orders).
3. Hard filters:
   - COD headroom: cash-in-hand plus this order under $150
   - vehicle fit: water and gas to heavy-load drivers only
   - winter roads: winter-risk places (§16) from November to April only to drivers flagged for them
   - battery: at least 20%
   - not on a break
4. Ties go to reliability (14-day acceptance and on-time), then to the driver with the lower earnings today (fairness).

**Step 3, timing.** The offer goes out at `ready_at − driver ETA to pickup − 2 min`, so the driver arrives as the food is bagged. For idle drivers far away, the offer goes immediately. `ready_at` uses the merchant's learned prep time (§28), not the merchant's promise alone.

**Step 4, offer.** One driver, 30 s; then the next; after 2 refusals the top 3 at once, first tap wins; after 3 refusals the operator is alerted (§21.3). Refusals with "too far" or "unsafe" reasons don't count against the driver.

**Merchant mode:**
- *With the app:* the brain suggests the closest idle merchant driver, and the merchant confirms with one tap or overrides. With auto-assign on, it assigns.
- *No app:* the merchant assigns from the order card, or a driver claims the job from the merchant's open jobs.
- *Unassigned at `ready_at + 5 min`:* the merchant gets "Need a driver?", which hands the order to the fleet or a partner where open.

**Partner mode:** booked when the order is accepted, with the partner chosen by config for the area and hour (SLA first, price second). No courier assigned 10 min before `ready_at` means rebooking with the next partner, or the operator.

**Pre-positioning (fleet):** idle drivers get a soft suggestion to wait near the area's hot spot for the next hour, from §28's demand history. It is never forced and earns no penalty.

### 27.5 The dispatch brain: monitoring every active order
One status model for all modes: `accepted → preparing → ready → driver_assigned → heading_to_pickup → at_pickup → picked_up → near_drop (≤ 500 m) → arrived (≤ 100 m) → delivered | failed`. Partner states are mapped by the adapter. A state we don't have is never shown to the customer.

The brain checks each active order every 15 s and acts. Thresholds live in config.

| Signal | Action |
|---|---|
| Merchant not "ready" 5 min after `ready_at` | Ping the merchant ("ready in?" buttons); tell the waiting driver; shift the ETA |
| Driver's ETA to pickup rising for 3 min | Ping the driver; at 5 min reassign (fleet) or alert the merchant (merchant mode) |
| Waiting at pickup over 8 min | Logged against merchant prep accuracy; customer gets a new ETA only if it slips over 10 min (one message) |
| After pickup, distance to the drop not shrinking for 4 min while moving | App asks the driver "all OK?" with the route; no answer in 2 min means a call to the driver |
| Stopped over 5 min mid-route (not at pickup or drop) | Same as above; at 10 min the operator calls and the order may be reassigned with re-preparation at Alo King's cost (fleet) |
| No position for 3 min on a job | ETA range widens; at 10 min the operator calls the driver |
| `arrived` for 3 min without `delivered` | Live-location button to the customer plus "Call" on the driver screen; at 10 min §22.2 scenario 12 |
| "Delivered" more than 150 m from the drop | Driver must give a reason and a photo; over 500 m with no code, the customer is asked at once "did you get your order?" |
| Food age (picked up → now) over 40 min | Customer apology message; logged for the driver and the area |
| Speed over 100 km/h sustained for 1 min | Recorded; three in a week means a safety warning, and repeats affect offers |
| SOS | Position to the operator and Rasheed; offers paused; order reassigned |
| Driver's cash over the limit | No COD offers until a deposit (§21.4) |
| Mock location detected | Driver suspended pending review; open jobs reassigned |

The **operator** is whoever holds the operator role (Rasheed at pilot only for exceptions; a hired operator once a fleet area opens). The operator sees one live board: every active order, every online driver on a map, and the alert list sorted by customer impact. The LLM writes the one-line summary on each alert ("Ali stopped 6 min near Beiteddine checkpoint; food age 22 min; next nearest idle driver 9 min away").

### 27.6 Proof of delivery
| Check | Fleet | Merchant driver, app or link | Merchant driver, WhatsApp card only | Partner |
|---|---|---|---|---|
| Geofence: "Delivered" within 150 m of the drop or learned door point (§28) | required | recorded, flags if outside | not available | partner proof |
| Handover photo (bag at the door or in hand, never faces) | required | optional | optional (sent to the Merchant number) | partner proof |
| 4-digit customer code | orders over $50, every Send Home order, a new customer's first COD order | same | same, typed on the card | passed to the partner |
| Customer "Received" | asked every time; 30 min silence counts as accepted unless a problem is reported within 24 h | same | same | same |
| Cash | amount and currency entered; §21.4 custody | merchant keeps it | merchant keeps it | partner remits |

### 27.7 Driver lifecycle (fleet; merchant drivers get the parts that apply)
- **Joining:** apply in the app. Upload ID, licence, motorcycle registration and insurance. Video call, then a test delivery watched live. Expiry dates are tracked, with reminders 30 and 7 days before; offers stop on expiry.
- **Training:** 6 short in-app lessons in Arabic: the job flow, live-location sharing, cash, proof, safety, customer manners. A 10-question check must be passed before the first offer.
- **Shifts:** drivers book shifts per area a week ahead. Booked shifts carry the hourly minimum (§21.3). Unbooked online time is allowed but has no minimum.
- **Pay:** per §21.3, weekly by Whish, with a statement in the app per job (fee share, tips, cash collected and deposited).
- **Ratings:** the customer rates the delivery (not the food) 1–5. The driver sees their average, never who rated.
- **Tiers:** on-time, acceptance, rating and cash accuracy over 30 days. Gold drivers get offers first among equally close drivers and shift booking first.
- **Ending a contract:** 2 confirmed fake "delivered", a cash shortfall not repaid within 2 weeks, misuse of a customer's number, or 3 safety warnings in a month. Logged with evidence.

### 27.8 Scenarios
| # | Situation | What happens |
|---|---|---|
| 1 | No idle driver in range | Brain offers to a batching driver (27.4), then partner, then a wider ETA before checkout; never an unstaffed promise |
| 2 | Restaurant late | `ready_at` moves; offer timing moves with it; customer told only past 10 min slip |
| 3 | Driver early at pickup | Timing prevents most; waits over 8 min count against merchant prep accuracy |
| 4 | Fleet driver cancels after accepting | Immediate re-offer with priority; after pickup, cancel only through SOS or the operator |
| 5 | Merchant driver absent | "Need a driver?" at ready + 5 min |
| 6 | Partner no-show | Rebook at ready − 10 min; counts toward §21.5's kill-gate |
| 7 | Driver forgets the live share | Fleet: the step blocks "start navigation" until tapped or skipped with a reason. Merchant: a reminder on the card; tracking page still works |
| 8 | Customer's WhatsApp is on another phone or a landline was given | Driver's live share has no target; the tracking link carries the customer; driver calls |
| 9 | Phone dies or dead zone | Last fix kept, queued events sync; operator calls at 10 min silent |
| 10 | Wrong pin | Checkout check: pin over 2 km from the address's place or saved addresses gets one question; at the door, the customer live-location button |
| 11 | Customer changes address after pickup | Allowed within 1 km and the same fee band; otherwise cancel-and-reorder offer |
| 12 | Customer unreachable or refuses | §22.2 scenarios 12–13 for every order; two no-shows in 30 days remove COD for that number |
| 13 | Building with no name, generator off, no elevator | Driver quick tags after delivery (§28); heavy orders (water, gas) delivered to the entrance unless the merchant offers stairs |
| 14 | Damaged food | Handover photo decides; refunds per §20.1 |
| 15 | Accident, threat, checkpoint, road closure | SOS; road incident tag marks the segment for 6 h; dispatch routes around it |
| 16 | Snow or storm | Winter-risk places paused or limited to winter-flagged drivers; ETA ranges widen |
| 17 | Change for cash | Shift float of small USD and LBP notes, recorded in custody; both totals and the locked rate on every order (§13) |
| 18 | Tips | At checkout or after delivery; 100% to the driver (merchant mode: to the merchant) |
| 19 | Batched order | The second customer is told "one stop before you" if it adds over 5 min |
| 20 | Merchant overflow | "I deliver; use Alo King when busy": one tap on the order hands it to the brain |
| 21 | Driver at two apps (also works for a competitor) | Allowed; acceptance and on-time rules handle conflicts; no exclusivity at launch |
| 22 | Night | Area night cut-off by config; after sunset the customer live-location button always shows |

### 27.9 Build placement
- **Phase 2 (session 3):** the status model, merchant `driver` role, merchant assignment, the WhatsApp job card with the live-share step, the brain's monitoring tick and alert table.
- **Phase 3a (session 4):** customer messages (on the way, near drop, live-location button), live-location handling (`unsupported` → ask for a pin), "where is my order?" via a typed tool reading the tracking state, the confirm-code flow.
- **Phase 5 (session 8):** the Capacitor driver app for fleet and merchant drivers, background location, offline queue, push offers, assignment scoring, pre-positioning, geofence proof, SOS, quick tags, training and shifts, partner state and position mapping, the operator live board.

## 28. Location intelligence: the AI learns places, buildings, streets and landmarks (DECIDED, 7 October 14:50)
Goal: every confirmed order and delivery makes the next address in that area faster to resolve and easier to find. "Learning" here means a growing, evidence-scored location knowledge base that the AI reads through server tools, not a fine-tuned model. Reasons: it is auditable, correctable, deletable on request, works from order 1, and cannot be poisoned by one bad message.

### 28.1 What is learned
| Knowledge | Learned from | Promoted to "confirmed" when |
|---|---|---|
| **Door point** of a customer address (where handover really happens; often not the pin the customer dropped) | Driver GPS at "Delivered" with accuracy ≤ 30 m inside the geofence | 2 deliveries within 25 m: robust median becomes the door point |
| **Address note** ("green gate, 3rd floor, call on arrival") | Customer text, driver quick tags | Shown to the next driver immediately; the customer can edit or delete it |
| **Buildings** (name, entrance point, floors, elevator, gated) | Door points of different customers within 15 m plus the same building name in text | 3 distinct customers, or 1 customer + 1 driver tag |
| **Landmarks** (church, mosque, roundabout, shop, "the old school") — §16's `landmarks` table | Names the AI extracts from address text, pinned by the order's door point | 2 distinct customers within 150 m, or a merchant or driver confirmation |
| **Local street names** ("طريق الجامع", "the main road to Moukhtara") as aliases on OpenStreetMap roads | Text mentions whose pin sits within 40 m of an OSM road | 3 distinct orders |
| **Place aliases** (Arabizi, French, colloquial spellings: "ba3aleen", "Baakline", "Ba'aqlin") | Customer text resolved to a place by the pin | 3 distinct customers (auto); before that, used as a hint only |
| **Travel time corrections** | Fleet and driver-link traces vs OpenRouteService estimates, by place pair, hour, weekday and season | 20 trips per cell; until then ORS × the area's default factor |
| **Prep time** per merchant | Accepted → ready, by hour, weekday and basket size | 20 orders |
| **Handover time** per building or place | Arrived → delivered | 5 deliveries |
| **Temporary road problems** (closure, checkpoint, flood, snow) | Driver tags, cluster of stalled traces | Expires after 6 h unless re-reported |

Evidence rules: a confirmation by someone at the place (driver at the geofence, merchant) weighs more than text; one customer can never confirm alone anything other than their own address; contradictions demote to "unconfirmed" and go to a weekly review list that Claude processes (Rasheed sees only the count).

### 28.2 How the AI uses it
- Server tool `resolve_location(text, pin?, customer_id?)` returns ranked candidates (saved address, building, landmark, street, place) with confidence. The AI picks or asks **one** short question ("Near the Baakline municipality, or the one by the church?"). It never invents coordinates.
- Server tool `describe_location(point)` gives the nearest confirmed landmark and building, used to read an address back to the customer and to describe it to the driver ("Behind Saint Elias church, Abou Fadi building, 3rd floor, green gate").
- The AI only proposes observations (`observe_location`): a name, a note, an alias. The server stores them as evidence and promotes them by the thresholds above. Prices, fees and radii never depend on unconfirmed knowledge.
- ETA = ORS duration × learned correction + learned prep + learned handover, shown as a range whose width shrinks as confidence grows.
- Delivery fee bands still use road distance from ORS, pin to pin. Door points only improve the destination point once confirmed.

### 28.3 Privacy (Law 81/2018)
- A customer's addresses, pins, door points and notes are their personal data, visible only to them, the merchant and driver of their active order, and admins.
- Buildings, landmarks, street names and aliases are shared knowledge only once 3 distinct people support them; they keep no link to who supplied the evidence.
- "Delete my data" removes the customer's addresses, door points and evidence rows; shared entities that drop below their threshold are demoted.
- Driver traces are kept 90 days at full detail, then reduced to the travel-time statistics.

### 28.4 Quality numbers (measured from the first order; shown on the pilot scorecard, §7)
- Address first-time-right: share of deliveries with no driver call and no live-location request. Target 80% by order 500 in an area.
- Search time: `arrived` → `delivered` median. Target under 3 min.
- Resolution questions: share of new addresses needing more than one question. Target under 20%.
- ETA honesty: share of deliveries inside the promised range. Target 85%.
**Kill-gate:** if after 300 deliveries in an area the first-time-right rate has not improved by 10 points over the first 100, the learning rules are reviewed (thresholds, extraction prompts) before more areas open. The knowledge base is never turned off; only its promotion rules change.

### 28.5 Build placement
- Phase 1b (session 2): tables for `addresses`, `door_points`, `buildings`, `landmarks` (extends §16), `street_aliases`, `place_aliases`, `location_evidence`, `travel_time_stats`, `prep_time_stats`, `road_incidents`, with PostGIS indexes and the promotion functions (empty, seeded only with §16 data).
- Phase 3a (session 4): `resolve_location`, `describe_location`, `observe_location` tools, the location eval set (100 real-style Lebanese address messages in four languages, with expected places).
- Phase 2 and Phase 5 (sessions 3 and 8): door points, tags, traces and prep and handover times written as orders flow.
- A nightly job promotes and demotes evidence and recomputes statistics.

### 28.6 Why OpenRouteService (answer to Rasheed, 7 October)
ORS is the road-routing service for the whole system: road distance for the $2 / $3 / $4.50 fee bands and the 10 km limit (never straight line), the "can this merchant deliver here" check, ETAs, and dispatch (which driver is closest by road). It is OpenStreetMap-based, so it works for Lebanese villages and costs nothing on the free plan. The basic free key is correct. Results are cached 1-24 h (§3), so free limits are far above pilot volume; if a day ever comes close to the limit, the build logs it and opens an `owner` issue.

- **Doorstep (16 October, session 5e):** a pin within 50 m of the shop is that straight distance (`DOORSTEP_M` in `supabase/functions/_shared/routing.ts`), because ORS gives no route between two points that snap to the same spot and a customer at the shop's door could not check out. It is the only straight-line answer: 50 m is far inside the first fee band, and every other pin still needs an ORS route. Since 17 October (#225) browse applies it too (`app_private.shop_road_km`, the same 50 m), so the shop at the customer's door is listed first with zero routing calls.
- **One request per screen (16 October, session 5e):** the free plan counts matrix requests (500 a day), not routes. A screen that needs many shops' routes to one customer pin asks for all of them in one request (`roadRoutesFrom`, shops as sources, the pin as the destination). On 16 October the browse screens asked once per shop and a morning of tests used up the day (owner issue #209).

## 29. Five external audits (Gemini ×3, ChatGPT, Perplexity), 9 October: verdicts (DECIDED, 9 October 10:30)
Input only (CLAUDE.md "Authority"). Each recommendation is adopted, adapted or rejected below, with the reason. **The audits' proposed migration `20261009110000_consolidated_platform_hardening.sql` is rejected as a file and must never be applied.** It targets tables our schema does not have (`menu_items`, `order_items`, `orders`, `profiles`), hard-codes 89,500 LBP as a default rate (forbidden: §2, CLAUDE.md), duplicates tables that already exist (`road_incidents`, the dated price list, `ledger_entries` already carries USD and LBP), and adds categories rejected below. Adopted ideas are built inside the normal sessions, in the schema those sessions design.

### 29.1 Money: the flat $1 fee is kept, gateway cost is passed through (adapted)
The audits are right on one point: on an online-paid $40 order, a 3% gateway fee ($1.20) exceeds the $1 order fee. They are wrong that commissions of 12-15% are the fix: Alo King's whole merchant pitch is "flat and tiny next to Toters' 22-30%", and merchant count is the pilot gate (§1).
- **Order fee stays $1.00 for prepared food** (restaurant, fast_food, cafe, bakery_manakish, sweets_pastry, ice_cream), free for the first 30 days (§20.4).
- **Online payment cost is passed through at cost** on online-paid orders. The provider's actual fee for that payment (Whish or Tap, from the dated price table) is a separate ledger line netted from the merchant's settlement and shown on the statement as "online payment fee (provider cost, no markup)". Cash orders carry none. This is how a card terminal already works for them. Send Home keeps its $1.50 sender fee (§20.4).
- **Price table gains per-`business_type` rules**: flat amount, percentage, minimum and maximum. Launch values: prepared food $1.00 flat; grocery_supermarket, minimarket, butcher, poultry, fish_market, produce, roastery_nuts: 2.5%, minimum $1.00, maximum $3.00; home_essentials: $0.50 flat; other_food: $1.00 flat.
- **No small-basket surcharge at launch.** The merchant's minimum order covers it.
- **Kill-gate:** if any `business_type`'s contribution margin per delivered order (fees minus message, AI, gateway and support costs from the cost ledger) is negative over 14 days with 50+ orders, its price row is changed before more merchants of that type go live.

### 29.2 Categories: no new categories (rejected), two fulfilment features added (adopted)
- **Rejected at launch:** pharmacies (prescriptions are health data, plus Ministry of Public Health pricing rules and liability), liquor (age verification and municipal rules), electronics, laundry, pet supplies, and flowers as a category. Revisit after the ads gate (§1). The `business_type` list in §17 stays.
- **Adopted: variable-weight items** for butcher, poultry, fish_market and produce.
  - The item is priced per kg with an estimated weight; the customer sees "about $X, final by weight".
  - The merchant enters the actual weight on the order card or portal, and the server recomputes the total.
  - An increase over 10% needs the customer's tap.
  - COD collects the final total. Online-paid weighted orders charge the estimate; if the final is lower, the difference is refunded automatically, and if it is higher, the merchant is paid at most the estimate plus 10%.
  - No pre-authorisation holds: neither Whish links nor COD support them.
- **Adopted: empty-container exchange (تبديل)** for home_essentials (gas cylinders, water gallons).
  - The order asks "do you have an empty to return?". With no empty, the merchant's deposit price is added.
  - The driver confirms the empty was collected.
  - A stairs fee per floor is a merchant option within the price rules, shown before checkout.
- **Kept from §27:** heavy-load driver flag.

### 29.3 Customer AI and search
- **Runtime models are unchanged** (§3): Claude Haiku 4.5 for turns, Sonnet 5.5 for menu extraction and complaints. (Haiku 5.5: see §32.6.)
- **Nutrition macros and an embeddings index are rejected for now.** Merchants won't supply macros, and AI-estimated macros or allergens are a food-safety liability. Item flags stay merchant-declared only (§17); any AI suggestion is labelled "estimated" and never used to answer "is this safe for my allergy". Search runs on Postgres full-text, trigram and the alias tables. Embeddings (pgvector) are reconsidered after pilot only if the search-miss rate on the eval set exceeds 10%.
- **Large catalogues (supermarkets):** the web basket handoff in §5 is the catalogue. The bot sends a link to the merchant's page with the basket shared; nothing new.
- **Interface choice:**
  - free text or voice for open requests
  - buttons for 1-3 choices
  - lists for 4-10 choices
  - Flows for multi-field input (§12)
  - web basket for 10+ choices or big catalogues
- **Addresses:** Google Places is not used for customer addresses. The places list, landmarks and the §28 knowledge base resolve them; the Google key stays for claims (§15.1).
- **Abandoned basket:** one reminder 30 minutes after the last activity, only inside the 24-hour window (a service message), never twice for the same basket, never between 23:00 and 08:00.
- **Upsells:** at most one suggestion per order, from the merchant's own items bought together in past orders, server-priced, shown as a button. No suggestion on reorders.

### 29.4 Operations
- **Merchant pause by message** ("مسكّر نص ساعة", "Mrakad 30 mins", "closed till 8"): the AI proposes a pause with an end time, the merchant taps, and the server pauses ordering and moves open ETAs. This extends §18.2.
- **Driver-to-driver cash swaps are rejected.** They break §21.4 custody. Drivers start shifts with a recorded change float (§27.8 scenario 17).
- **Spoken landmark directions (text-to-speech) for drivers:** after pilot, if search time (§28.4) misses its target.
- **New-customer COD cap, unified:** every number's first order is capped at $50 COD until 1 delivered order. This replaces the foreign-number-only rule in §22.2 scenario 3.

### 29.5 Security and resilience
- **Adopted:**
  - Whish webhook timestamp check (reject over 300 s drift) if Whish signs a timestamp; otherwise dedupe plus the status poll (§20.3).
  - Customer text passed to models inside delimited blocks, never as instructions (already in `alo-ai-tool-safety`).
  - Atomic AI usage quota in one database call (ChatGPT's P1; the legacy read-then-write must not be ported).
  - Ledger idempotency key with request hash (done in session 1's hardening).
  - Before session 4 ports `merchant-ai`: its model comes from config, never `claude-sonnet-4-5` or any hard-coded name, and a contract test proves every table and RPC it calls exists.
- **Backups:** Supabase Pro's daily backups at pilot, plus a nightly encrypted database dump from GitHub Actions to a Cloudflare R2 bucket (free tier) from the pilot cut-over. Session 14 opens the `owner` issue for the R2 account. Point-in-time recovery (a paid add-on) is rejected until volume justifies it.
- **Rejected:** hardware GSM SIM gateways for SMS failover (one more device to run; the automated cellular call in §13 already covers internet loss at the merchant).
- **Analytics IDs:** PostHog distinct IDs are an HMAC of the phone number with a server secret (§24.7, after pilot).

### 29.6 Number quality and standby failover (adopted, precise)
- The webhook handler stores Meta's `phone_number_quality_update` and messaging-limit events.
- On a quality drop to RED, or a restriction, of the Customer number A: new marketing pauses at once, and the admin is alerted. The config flag `active_customer_number` can switch to standby B (§3) in one admin action.
- Customers in active orders get a utility template from B ("we've moved to this number for your order #…"), since B cannot free-message people who never wrote to it. Replies to B bind to the same customer, basket and order by phone number.
- B exists only after Meta business verification (§3). Until then the plan is the quality monitor plus the §20.5 broadcast guards.

### 29.7 Already decided (no change)
Live location (§27, which the ChatGPT audit read in its older form), Google Places data handling (§15.1, Rasheed's decision), Whish written terms and the lawyer's letter gating online collection (§20.1, §20.6), POS routing (§23), the dual-currency ledger (§20.3), the RLS isolation model (session 1), the ban-prevention rules (§18.3, §20.5).

### 29.8 Build placement
- Session 3 (Phase 2): weighted-item and container-exchange order fields; the pause-by-message command; per-`business_type` fee rules in the price table; the quality-event table.
- Session 4 (Phase 3a): interface choice rules, abandoned-basket reminder, upsell, `merchant-ai` model and contract test, atomic AI quota.
- Session 9 (Phase 6a): gateway pass-through ledger line, weighted-order refunds, the contribution-margin report behind the 29.1 kill-gate.
- Session 14 (cut-over): R2 dump and owner issue; standby switch drill once B exists.

## 30. Second round of reports (9 reports, 10 October) and the human support model (DECIDED, 11 October 00:30)
Rasheed asked for every useful idea to be judged on merit, not against the current gates. Below: adopted ideas with their exact rule and where they are built, then what is deferred or rejected and why. **None of the SQL in those reports is applied.** It targets tables that don't exist here (`menu_items`, `order_notifications_queue`, `logistics_landmarks`, `profiles`) and duplicates tables that do (`brands`, `landmarks`, `road_incidents`). Sessions build the ideas in our schema.

### 30.1 Adopted: ordering and catalogue
1. **Menu version check at confirmation.**
   - Each vendor (each branch, §18.1 F) carries a `menu_version` that changes on any price, availability or option change, including POS pulls (§23).
   - The basket stores the version it was priced at. At confirmation the server compares: if it changed, it re-prices, and the customer sees one message with the difference ("Knefe just sold out; total now $11.50") and buttons Confirm / Change.
   - Nothing is charged and no order is created on a stale version. *(session 3)*
2. **Native WhatsApp cart (Meta catalogue) as the main menu interface for claimed merchants, with the web basket as fallback.**
   - Claimed merchants' items sync to one Meta commerce catalogue (one product set per branch; `retailer_id` = our item ID).
   - The bot sends multi-product messages (up to 30 items, 10 sections) by category. The customer's "send cart" arrives as an `order` message; the server re-prices every line from the database and never trusts catalogue prices.
   - Items with options open the `item_options` Flow (§12).
   - It needs the company's Meta business portfolio (a catalogue can't attach to the sandbox), so it is built against fixtures in session 5 and switched on at cut-over.
   - **Amended 15 October (39.12):** built now on the US test number for full testing, not deferred to the cut-over.
   - **Kill-gate:** if fewer than 50% of carts opened through the catalogue are sent within 10 minutes over 200 opens, the list-plus-text path becomes primary again.
3. **Combos follow their parts.** A combo links to its component items; marking a component sold out hides every combo containing it at that branch. *(session 3)*
4. **Optional daily quantities for small vendors.**
   - A merchant may set "today: 50 croissants". At 3 left the item shows "last few", and the merchant gets buttons +10 / +20 / Sold out. At 0 it is sold out.
   - Untracked items stay unlimited. No checkout holds. *(session 3)*
5. **Customer memory profile.**
   - A server-computed profile per customer: usual vendors and items, typical order times, saved addresses, the language they write in, and dietary choices *the customer stated*.
   - It is passed to the model as a short structured block, never recited back.
   - It powers "the usual?" reorders, better suggestions and shorter conversations.
   - The customer can say "forget my history", which clears it (Law 81/2018). *(session 4)*
6. **Two-stage voice understanding.**
   - Transcription runs with a Lebanese vocabulary prompt built from our own data: dish names, places and Arabizi spellings.
   - Then Claude normalises the transcript against the candidate merchant's menu and the places list before parsing.
   - Voice notes over 60 s are accepted; the bot replies "listening…" within 2 s while processing.
   - Real notes average 31 s (37 notes, 10 October), longer than assumed. *(session 4)*

### 30.2 Adopted: merchants
1. **Deterministic merchant commands first, AI second.**
   - Common commands on the Merchant number are parsed by rules before any model call, in Arabic, English, French and Arabizi:
     - sold out / back
     - price X Y
     - pause N minutes / closed till HH
     - open
     - balance
     - top up N
   - Only unrecognised text goes to the model. Every change still needs the merchant's confirming tap (§18.2). *(session 3, extended in 5)*
2. **Auto-pause on missed orders.**
   - 3 orders in a row not acknowledged through all four layers (§2): the merchant pauses automatically and gets "🟢 Reactivate when ready".
   - Its open orders are cancelled with apologies and alternatives sent to customers.
   - Logged in the audit log. *(session 3)*
3. **Ratings from real orders, used carefully.**
   - The rating message goes 30 min after delivery: one list with 1–5 for the food, plus 👍/👎 for the delivery when the fleet or a merchant driver with the app delivered. One message, no second reminder.
   - A vendor rating shows publicly only after 20 ratings, on claimed vendor pages.
   - It weighs in ranking. A vendor averaging under 3.5 over its last 30 ratings is left out of AI suggestions, though it can still be ordered by name, and the merchant is told why with its own numbers.
   - Driver ratings feed §27.7 tiers.
   - Ratings are never shown for unclaimed vendors (§5). *(rating capture session 4; ranking session 12)*
4. **Brand nodes.** Branches get `delivery_enabled`, `pickup_enabled` and `public_listing` flags. A delivery-only kitchen takes orders for its radius but has no public map pin. *(session 3)*
5. **Boost in one tap.**
   - The Merchant number's menu has "🚀 Boost":
     1. choose a budget ($5 / $10 / $20 from credit)
     2. choose an audience (people nearby who opted in / past customers)
     3. done
   - It runs as a sponsored placement (pay per delivered order, §20.4) or a broadcast on pre-approved marketing templates with variables. Per-drop AI-written templates are rejected, because each new template needs Meta approval.
   - Sponsored labels may quote only ratings from our own orders (30.2.3). *(session 12)*
6. **Merchant-funded stamp cards** as an offer type ("5th manakish free"). The server counts, the AI reminds the customer. *(session 12)*

### 30.3 Adopted: money and operations
1. **Mixed-currency cash at the door.** The driver or merchant enters USD and LBP received. The server computes the change due at the order's locked rate and records both amounts in the ledger and custody (§21.4). *(sessions 5 and 9)*
2. **Stairs fee in fleet mode goes 100% to the driver** (amends §29.2's merchant option for fleet orders). *(session 8)*
3. **VAT reserve.** VAT collected on Alo King's own fees posts to a VAT-payable ledger account, so the amount due is always a balance, never a calculation. *(session 9)*
4. **Finance answers for the admin.** A read-only admin RPC returns ledger balances (revenue, float by provider, payouts due, VAT payable, open money incidents). Claude turns it into a plain-language weekly finance note for Rasheed. It is not an accountant: the lawyer's accountant still signs filings. *(session 9)*
5. **Ops alerts (superseded by §32.1: Slack, not Telegram).**
   - Operator alerts go to a private Telegram group through a bot, with action buttons that open the admin page: merchant not answering, SOS, money incident, cash over limit, partner late.
   - Reason: free, instant, no Meta templates, and alert traffic never touches the quality rating of our WhatsApp numbers.
   - Email is the fallback. *(session 3; owner issue: create the bot, 2 minutes)*
6. **Customer cancellation rule.**
   - Free until the merchant accepts, and for 60 s after acceptance.
   - Later, "Cancel" sends a request the merchant can accept. If refused, the order continues.
   - A customer refusing at the door counts toward the no-show rule (§27.8 scenario 12).
   - Online payments are refunded automatically on any accepted cancellation (§20.1). *(session 3)*
7. **Referral program at launch, deliberately simple.**
   - Each customer gets a personal link.
   - The new customer gets $2 off their first delivered order. The referrer gets $2 off their next order after that first order is delivered.
   - Alo King funds both sides as a discount line (not stored money, no cash value, expires in 60 days).
   - Limits: 5 referrals per month; no reward when the two numbers share a door point or payment source; delivered orders only.
   - **Kill-gate:** if referral cost per new ordering customer exceeds $4 over 100 conversions, the amounts are halved. *(session 12)*

### 30.4 Deferred (recorded, not built now)
- **"Crowns" points programme.** A points balance is a liability and a support load. Revisit after 1,000 delivered orders, using referral and stamp-card data.
- **Errand service (pick up anything, Toters Butler-style).** Needs the fleet; built after the first fleet area opens, starting with paid-in-advance pickups from registered businesses only.
- **One delivery from several shops.** Customers order separately; fleet batching (§27.4) combines trips when routes fit. Revisit with fleet data.
- **Native POS adapters (Omega, BIM).** Built per §23 when a chain brings volume. The Deliverect channel-partner application is drafted by Claude in the SARL week (added to owner issue #70's week).
- **Spoken landmark directions for drivers:** §29.4.

### 30.5 Rejected
- **AI-estimated "trending"/"4.8" claims in ads**: only real numbers from our own orders.
- **Hiding a vendor below 4.0 from everything**: too harsh on small samples; rule 30.2.3 instead.
- **15-minute stock holds for weighted items**: no inventory precision to hold against; §29.2 rules suffice.
- **Slack**: Telegram covers it, free.
- Report claims such as "87% net margin" and "Claude 3.5 Sonnet": not used for any decision.

### 30.6 Human support: Rasheed as the named human (DECIDED)
Rasheed offered to help vendors personally. That is a real advantage over Toters' faceless support, as long as it is inbound (no outreach, no sales: profile) and it never becomes the thing the product depends on.
- **Who:** support is signed "Rasheed, Alo King". One name builds trust; partners Bassem and Firas can cover with the same inbox later.
- **Where:**
  - **Chat:** the Merchant number, answered in Kapso's hosted inbox (§26) on his phone's browser, so every conversation stays in the merchant's history and the AI sees it.
  - **Calls:** from the company postpaid line once it exists (#73); until then, his own phone.
- **When a human joins (the AI hands off with a summary of the problem, the merchant's data, and what it already tried):**
  1. The merchant taps "👤 Talk to Rasheed" (always in the Merchant number's menu) or asks for a person.
  2. Onboarding is stuck: claim documents (cases C–M, §18.1), a menu the AI couldn't extract, or no progress for 24 h after claiming.
  3. Money: a disputed statement line over $20, or a payout problem.
  4. Anything urgent: orders failing, a wrong order out, a customer complaint the merchant contests.
  5. The AI's confidence is low twice in one conversation, or the merchant is clearly frustrated.
- **Onboarding call, offered, never pushed:** after a claim succeeds, the merchant sees "Want a 10-minute setup call with Rasheed?" with time slots. On the call, Rasheed and the dashboard's AI assistant finish the menu, hours, radius and go-live checklist together. Target: live within 24 h of the claim.
- **Promise and hours:** chat answered within 15 min from 09:00 to 23:00 Beirut time, within 1 h otherwise. Urgent cases (orders failing, money) page him through the Telegram ops group (30.3.5) at any hour. Outside hours, the AI says honestly when Rasheed will reply.
- **Customers:** the same handoff to the same inbox (§2's human handoff). Rasheed is the pilot operator.
- **Measures:** human minutes per merchant onboarded (target under 30), handoffs per 100 orders, and time to first human reply. **Kill-gate:** if human support passes 2 hours a day for a week, the top three handoff reasons go into the next build session as product fixes before any new feature.

### 30.7 The real voice notes (10 October)
- **Batch 1:** 37 notes, 19.4 minutes, from the Shouf, average 31 s (6–102 s). Committed as eval fixtures in `evals/voice/batch-01/` (private repo). Rasheed is collecting about 100 more.
- **Use:**
  1. pick the transcription model, comparing the leading OpenAI transcription models with the vocabulary prompt
  2. build the Lebanese vocabulary list
  3. become the intent eval: the expected basket for each note
  4. measure end-to-end time
- **Labels without manual testing:** a GitHub Actions job transcribes each note with two models, and Claude reconciles them into a draft transcript and expected order. Only notes where the two disagree on a dish, quantity or place go to Rasheed as a short list to confirm by listening. He confirms a list, not run tests.
- **Collecting the next batch:**
  - different people, with men, women, older and younger speakers
  - some with background noise (car, kitchen, street)
  - at least 15 in French or mixed Arabic-French, and some in English
  - some that change their mind mid-note, and some that only name a place and a craving ("بدي شي طيب بالشوف")
  - each person agrees to their voice being used for testing
  - no names, phone numbers or addresses of real people spoken

### 30.8 Build placement
These items join the sessions named in brackets above. Session count stays at 12 remaining (3–14), with sessions 3, 4 and 12 the heaviest; any of them may split into two PRs or two runs.

## 31. Data freeze until the finalisation run (DECIDED, 11 October 08:00)
Rasheed's rule: the places list (§16), the vendor import (§15) and every derived location or vendor dataset stay **exactly as they are on staging now** until the data finalisation session (session D in §10), which runs once, before the pilot cut-over, with his finalised village and vendor files. Reason: one places run cost about 59% of a session's budget; the data will be replaced anyway.
- Build sessions **must not**:
  - run `places-build` (it stays manual, `workflow_dispatch` only) or the vendor import
  - edit anything under `supabase/seed/places/`, `supabase/seed/vendors/`, `scripts/places/` or `scripts/vendors/`
  - rename or restructure the places, zones, districts, aliases, landmarks or vendor tables or their columns
  - fix individual place or vendor records
- A data problem found during a build session gets one line in `docs/decisions/DATA-ISSUES.md` (what, where, example), and the session moves on. Session D fixes the whole list.
- New features use the existing tables and columns as they are. New tables that *reference* places or vendors are fine. If a feature truly needs a new column on a frozen table, it is added in a new migration with a default, without touching existing rows, and logged in `LOG.md`.
- CI adds a guard: a PR touching the frozen paths fails unless its title starts with `Data:` (reserved for session D).

## 32. Final product decisions: Slack operations, drivers on WhatsApp, nutrition, voice learning, final reports (DECIDED, 11 October 13:00)
Rasheed's last input round: 7 Gemini answers, the ChatGPT review of the repo and Gemini, and the GoKapso repositories. He asked for every good idea to be taken on merit. This section **overrides earlier sections where they conflict**: §30.3.5 Telegram, §30.5's rejection of Slack, §29.3 macros and the Haiku 5.5 note, and §27.2 drivers. No SQL from any report is applied.

### 32.1 Slack is the operations console (replaces Telegram everywhere)
**Who uses what:**
- **Slack:** Rasheed and the operations team only. Merchants, customers and drivers never touch Slack.
- **WhatsApp:**
  - customers: the Customer number A
  - merchants and drivers: the Merchant number M, from their own personal numbers (§32.2)

**Set-up:**
- One Slack app ("Alo King Ops") in Rasheed's workspace, free plan.
- Channels:
  - `#ops-urgent`: merchant not answering at 75 s, SOS, a delivery at risk
  - `#orders-live`: one line per order state change, threaded per order
  - `#claims`: documents with approve and reject buttons
  - `#money`: incidents, payouts due, float
  - `#support`: human handoffs
  - `#drivers`: shifts, cash over the limit, quick tags
  - `#daily-brief`: 08:00 summary of yesterday plus open issues
- Built behind one `ops_notifier` adapter, so the channel is config.
- Alerts that need action carry buttons. Everything is also written to the database: Slack is never the record.

**Control from Slack:** everything an operator may do in the admin pages, through buttons, slash commands and modals:
- `/ak order <code>`: lifecycle, replay, audit trail
- `/ak merchant <name>`: status, pause, resume, channel test, call
- `/ak claim`: queue
- `/ak driver <name>`: status, reassign
- `/ak refund <order> <amount>`
- `/ak credit <merchant> <amount> <reason>`
- `/ak place on|off <place>`
- `/ak finance`: the §30.3.4 snapshot
- `/ak broadcast pause`: kill switch

**Security for Slack actions:**
- Every request is verified with Slack's signing secret.
- The Slack user ID must map to an `operators` row with a role.
- Each action calls the same server function the admin page uses, with the same limits.
- Every action writes an audit row.
- Money actions over $20, claim approvals and refunds open a confirm modal showing the exact effect.
- Nothing in Slack can bypass a server rule.

**Human support through Slack** (adopted from `gokapso/whatsapp-support-agent`'s pattern; supersedes Kapso's hosted inbox in §30.6):
- A handoff opens a thread in `#support` with the AI's summary, the person's history and the last messages.
- Rasheed replies in the thread, and the server sends it on WhatsApp as him ("Rasheed, Alo King"). Replies are inside the 24-hour window; outside it, an approved utility template asks the person to reply.
- "Resolve" closes the case and hands the conversation back to the AI.
- Case state lives in Supabase, so a Slack outage loses nothing.

**Control from WhatsApp (mobile fallback):** Rasheed's own number is an `admin` operator recognised on the Merchant number, with a limited command set:
- `status`
- pause or resume a merchant
- approve or reject a claim
- reply to a handoff
- refunds up to $20

Each one asks for a confirming tap. Everything else stays in Slack.

**Owner issue:** create the Slack app from a manifest the session commits; install it in the workspace; paste two secrets into GitHub. Telegram issue #104 drops its Telegram part.

### 32.2 Drivers: WhatsApp first (amends §27.2)
- **Every driver uses WhatsApp on their own number** with the Merchant number M:
  - job offers as interactive cards (Accept / Decline)
  - status buttons (at pickup / picked up / delivered)
  - the cash entry (§30.3.1)
  - delivery code entry
  - SOS
  - their earnings statement
- **Location:** the WhatsApp job card opens the signed **driver link** (web page, no install), which shares GPS while a job is active.
  - Fleet drivers on Android also install the light Alo King Driver app (§27.2) for background location, offline steps and loud offers. It is optional for merchant drivers.
  - WhatsApp live location to the customer (§27.3) is unchanged.
- **Slack is never required for drivers.** The operator sees drivers in `#drivers` and on the admin map.

### 32.3 Nutrition and dietary data: full macros, with honest sources (amends §29.3)
Rasheed wants full macros. They are built as an evidence-scored attribute system, not booleans and not raw AI guesses.
- **Per item, per serving:**
  - serving size in grams
  - calories, protein, carbohydrates, fat (always when known)
  - sugar, fibre, saturated fat, sodium (when known)
- **Each value carries a source:**
  - `merchant_verified`: the merchant supplied or confirmed it
  - `estimated`: computed (below)
  - `unknown`
  - plus confidence and the assumptions used
- **How estimates are made:** computed from ingredients, never guessed from a dish name.
  - A curated **Lebanese dish library** of about 200 dishes (tawouk, shawarma, manoushe zaatar, falafel, fattoush and so on) holds standard recipes and portion weights. It is built once by Claude from USDA FoodData Central ingredient data (free, public API) and kept in the repo.
  - During menu setup the AI matches each item to a library dish and asks the merchant at most two questions for the batch: portion size (S/M/L or grams) and anything unusual (oil, sauce, extras).
  - The server computes the macros. The merchant sees "≈ 450 kcal · 38 g protein (estimated)" and taps Confirm or edits.
- **Allergens and dietary claims:**
  - Allergens (gluten, milk, eggs, peanuts, tree nuts, sesame, soy, fish, shellfish, mustard, celery, sulphites) are **merchant-declared only**. The AI may suggest "may contain X, please check", but never sets one.
  - Cultural and diet tags (vegan, vegetarian, siyami, halal) need merchant confirmation.
  - Derived tags use fixed thresholds per serving:
    - high-protein: 25 g or more
    - low-carb: 20 g or less
    - low-fat: 10 g or less
    - low-sodium: 600 mg or less
    - sugar-free vs no-added-sugar kept distinct
- **Search:**
  - Hard filters (allergens, dietary must-haves) use only `merchant_verified` values. "Gluten-free" never shows an unverified item.
  - Macro filters may use estimates, labelled "≈ estimated".
  - The bot never says an item is safe for an allergy; it says what the merchant declared.
  - Sponsored results obey the same filters (§20.5).
- **Kill-gate:** after 30 claimed merchants, if fewer than 50% confirm their estimates, or fewer than 3% of searches use nutrition filters, the estimate prompt moves from setup to an optional later step.
- **Build:** session 5.

### 32.4 Voice notes: where they live and how the AI gets better from them
- **Storage:** `evals/voice/batch-NN/` in the private repo, each batch with `manifest.csv` and, after labelling, `labels.csv`. When Rasheed uploads new notes to the planning chat or Project, the planning chat commits them as the next batch in a PR (done for batch 1, #98).
- **The AI does not retrain a model.** It gets better through five assets that grow with every batch, all versioned and tested:
  1. **Vocabulary prompt** for transcription: dishes, places and Arabizi spellings seen in confirmed transcripts.
  2. **Normalisation dictionary:** mishearings mapped to the right word ("tawook", "ta2ouk" → طاووق), fed from every correction.
  3. **Hard-case examples** in the parser prompt: the 30 most instructive confirmed notes (code-switching, changed minds, vague cravings).
  4. **Golden test set:** every confirmed note becomes a regression test. CI fails if order accuracy drops.
  5. **Model choice:** each batch re-runs the transcription and parsing comparison (OpenAI transcription models, Kapso's transcript, Haiku 4.5 vs 5.5), and the winner by accuracy, latency and cost is set in config.
- **Production learning loop:**
  - When a live customer corrects the bot ("no, I said two"), the note, transcript and correction are saved as a candidate hard case. The privacy policy covers this, and "delete my data" removes them.
  - A weekly job proposes additions to the dictionary and examples; Claude reviews them in the next session.
- **The metric is the basket, not the words:** exact basket correct (merchant, items, quantities, options) before any question, and after at most one question.
  - Targets: 85% before any question and 98% after one question by 300 labelled notes.
  - Every order still ends with the customer seeing the basket and tapping Confirm, so a mistake costs one tap, never a wrong order.
  - 100% understanding of every voice note is not a real target; 100% correct confirmed orders is, and the Confirm step guarantees it.
- **Labelling:** two transcriptions plus Claude reconciliation (§30.7), so Rasheed confirms only disagreements. It is blocked until the OpenAI key works (#77). Until then, sessions build the pipeline and run it on Kapso transcripts where available.

### 32.5 Adopted from the final reports
| Idea | Rule | Session |
|---|---|---|
| Order recovery engine | One `order_exceptions` table: every detected problem gets a rule-chosen recovery, a single next action per person, a Slack alert only when a human is needed, and a verified close. The AI drafts wording only. | 5b |
| Group basket | A shareable link; friends add from their own phones; one payer confirms; per-person split shown. No corporate wallet. | 10 |
| Kitchen capacity | Merchant sets max active orders. Above it, ETAs lengthen; at 2× it, new orders pause automatically until the queue drops. | 5 |
| Generator mode | Items tagged `needs_power`. "ما في كهربا / generator off" hides them at that branch with one tap; "power back" restores them. | 5 |
| Staff by WhatsApp | "Add Ali as kitchen +961…" / "remove Ali": roles per §18.1 H, confirmed by the owner's tap. | 5 |
| Shift handover | On the first tap of a new staff member's shift: pending orders, sold-out items, open complaints. | 5 |
| Menu quality coach | Weekly merchant tip from real data: missing sizes asked for, items often sold out, missing photos. Changes need a tap. | 12 |
| Substitution preference | At checkout for grocery types: call me / replace under $X / remove. The merchant offers a substitute with the price difference; the customer taps. | 5 |
| Visual order card | The confirmation and merchant statements also send a generated image (gold card: items, total in USD and LBP, locked rate). | 5 |
| Mixed-cash calculator | "How to pay cash" button: enter USD, get the LBP remainder at the locked rate. | 9 |
| Reorder and refill reminders | Opt-in only. The customer picks the day ("remind me Fridays" / "water every 9 days"). Sent as a utility template the customer asked for; each send confirms current price and stock; off by one tap. | 12 |
| Diaspora occasions | Opt-in after a Send Home order: the sender saves a date, gets a reminder 2 days before. | 10 |
| ETA honesty | A message only when the ETA moves more than 10 min, with a category reason (kitchen busy, traffic, road closure). Never a checkpoint name or the driver's exact position. | 9 |
| Total-cost ranking | Suggestions under a budget rank by food plus delivery fee plus Alo King fee, within hard constraints. | 12 |
| Same-price badge | "Same price as in the shop", shown only when the merchant confirms prices match. No estimated "savings vs other apps" claims. | 5 |
| Merchant insight funnel | Events: search, eligible, impression (with rank), click, add, delivered. Normalised intent tags, no raw health searches kept beyond 90 days. Weekly insight first, Boost offer second. Never claims competitor orders. | 12 |
| Community vouchers | Post-pilot, designed now. Senders add $2–$10 to a village bread/meal pot. Vouchers go only to people enrolled through a named local partner (municipality, parish, NGO), never chosen by AI. 100% of the donation buys food at cost; the delivery fee is shown separately. Anonymous impact receipt. Lawyer review first. | after 14 |
| Voice reply on request | "Send me a voice summary" returns a short voice note. Not automatic. | 12 |
| Kapso SDK | Spike in one send path, then migrate send paths one by one behind contract tests (`@kapso/whatsapp-cloud-api`, pinned). | 5b |
| Flowso | Adopted for local validation and scenario tests of every Flow in CI; a Meta preview stays a release step. | 5 |
| Upstream Kapso skills | Selective diff against a pinned `gokapso/agent-skills` commit; keep our safety rules. | 5b |

### 32.6 Rejected or deferred from the final reports
- **Rejected:**
  - merchant-to-supplier Whish payments (money transmission, not our licence)
  - "competitor markup 25%" savings claims
  - AI choosing needy recipients
  - electricity status hub
  - checkpoint details in customer messages
  - a 15% cut of donations
  - automatic voice receipts
- **Deferred:**
  - corporate wallets and allowances (needs a real employer partner)
  - errands/Butler (needs the fleet)
  - points ("Crowns", §30.4)
  - pgvector (§29.3 rule stands)
- **Haiku 5.5:** ChatGPT reports Anthropic released `claude-haiku-5-5` on 7 October 2026. Not verified here. The model is config, and the next eval run with API credit compares Haiku 4.5 and 5.5 on the voice and text sets; the winner goes in config, and `usage.ts` prices are updated first.

### 32.7 Working without paid AI keys (until credit returns)
Rasheed's card can't add Anthropic credit right now, and OpenAI rejects its key.
- **PR review:** when the CI Claude review cannot run, the build session runs the repo's `pr-reviewer` agent on its own diff before marking a PR ready, and posts the verdict as a PR comment tagged with the head commit. CI accepts that comment in place of the API review for every PR, including money, RLS, webhooks and personal data. Session 13's independent security review re-checks everything merged this way.
- **Runtime AI on staging:** the deterministic paths work without AI (taps, pins, STOP, status, reorder, merchant commands). Free-text turns that need the model answer "please use the buttons or type it shorter", or hand off to a human. Evals that need a live model are marked skipped, not failed.
- **Work Claude Code does itself in place of the API:** writing and labelling text evals, extracting test menus from photos, building the Lebanese dish library, drafting templates and copy.
- **Voice labelling waits for a working transcription key.** Claude Code cannot listen to audio.
- **Owner path:** ask the brother in Dubai to add $20 credit each to Anthropic and OpenAI with his UAE card, or use a prepaid virtual card. Both accounts stay in Alo King's name.

### 32.8 Session plan from here (replaces the remaining rows of §10)
| # | Session | Model | Effort |
|---|---|---|---|
| 5 | Claims and registration, smart menu with dish library and macros (32.3), Flows with Flowso, catalogue sync (fixtures), merchant WhatsApp OS extras (capacity, generator mode, staff, shift handover, substitution, visual card, same-price badge) | Opus 5.5 | high |
| 5b | Slack ops console and support handoff (32.1), WhatsApp admin commands, order recovery engine, Kapso SDK migration, upstream skills diff | Opus 5.5 | high |
| 6 | Website: design system and public pages (§24) | Sonnet 5.5 | high |
| 7 | Website: claim/registration UI, legal pages, SEO/AIO, dashboard restyle | Sonnet 5.5 | high |
| 8 | Delivery: drivers on WhatsApp + driver link + Android app, dispatch brain (§27, 32.2) | Opus 5.5 | high |
| 9 | Payments, ledger, settlement, credit, mixed-cash, ETA honesty (§20, §30.3) | Opus 5.5 | max |
| 10 | Send Home and Tap, group basket, diaspora occasions (§22) | Opus 5.5 | high |
| 11 | Simulator, evals (voice and text), pilot scorecard | Sonnet 5.5 | medium |
| 12 | Growth: offers, Boost, broadcasts, sponsored, insight funnel, referrals, reminders, quality coach, total-cost ranking | Sonnet 5.5 | high |
| 13 | Independent security review (re-checks all PRs reviewed under 32.7) | Fable 5.1 | max |
| D | Data finalisation (§31) | Opus 5.5 | high |
| 14 | Pilot cut-over | Opus 5.5 | high |

## 33. Pilot-first order and lean sessions (DECIDED, 12 October 07:00)
Two sessions used about half of Rasheed's weekly Claude limit. The remaining work is reordered so the pilot can open with the fewest sessions; features the pilot doesn't use move after it. Nothing is dropped. The pilot already runs on merchant self-delivery and cash on delivery (§1), so the fleet, online payments, Send Home and paid growth tools are not needed to open.

**Before the pilot (6 sessions, in this order)**
| # | Session | Model | Effort |
|---|---|---|---|
| 5b | Slack ops console and support handoff, WhatsApp admin commands, order recovery engine, templates for staff welcome and kitchen-full, "open outside hours" reply (§32.1, §32.5) | Sonnet 5.5 | high |
| 6 | Lean website: home, claimed-vendor page, claim/registration pages, legal pages (terms, privacy, refund, merchant terms), contact, `llms.txt`, AR/EN/FR. Merges old sessions 6 and 7; the dashboard restyle and full SEO move after the pilot | Sonnet 5.5 | high |
| 11 | Simulator, evals that run without credit, pilot scorecard | Sonnet 5.5 | medium |
| 13 | Independent security review of everything merged | Opus 5.5 | high |
| D | Data finalisation (§31) | Sonnet 5.5 | high |
| 14 | Pilot cut-over | Opus 5.5 | high |

**After the pilot opens (4 sessions, in order of need)**
- 9: online payments, ledger settlement and credit (when the lawyer letter and Whish terms arrive; Opus 5.5, high)
- 8: fleet drivers, driver app and dispatch brain (when a fleet area meets §21.3; Sonnet 5.5, high)
- 12: growth tools: offers, Boost, broadcasts, sponsored, referrals, reminders (before the ads gate; Sonnet 5.5, high)
- 10: Send Home and Tap, group basket (when Tap approves; Sonnet 5.5, high)
- Plus: the dashboard restyle and full SEO left out of session 6

**Rules for every remaining session, to save limits**
- One session, one scope: no work outside the session's row; anything found goes to LOG.md for later.
- Read only the DECISIONS sections the session needs, not the whole file.
- Do not re-run the full database test suite locally after every edit; rely on CI for the full run.
- At most two review-fix rounds per PR; open remaining low findings as notes in LOG.md.
- Sonnet 5.5 is the default model; Opus 5.5 only where the table says.

## 34. Make ordering testable now; operations at the end (DECIDED, 12 October 07:15)
Rasheed's rule: finish the ordering journey so he can test it on the sandbox; Slack, ops cards and every other operational tool wait until the cut-over. This reorders §33.

**Staging check, 12 October (planning chat, read-only):** messages reach the bot, but:
1. Every AI call fails: the Anthropic account has no credit ("credit balance is too low").
2. One AI call also failed on a real bug: a tool schema declares a nullable string with an enum that lacks `null` ("Enum value 'restaurant' does not match declared type ['string','null']").
3. After a handoff, the conversation stays in handoff mode and the bot answers nothing: no human console exists yet, so the customer hears silence.
4. Nothing can be ordered: 0 orderable vendors, 0 places switched on, 0 menu items.

**Session T: testable ordering (next, Sonnet 5.5, high):**
- Fix the tool-schema bug and add a test that validates every tool schema against Anthropic's rules.
- **Handoff never goes silent:**
  - The bot always acknowledges.
  - Handoff mode ends after 30 minutes, or when the customer sends "menu", "hi" or a button tap.
  - Until the Slack console exists (session 5b), the handoff is stored and noted to Rasheed's number on the Merchant number.
- **A fully button-driven ordering path that needs no AI call.** So ordering works with or without API credit:
  1. "Order" or the menu button
  2. location pin
  3. list of open merchants that deliver there
  4. merchant menu by section (lists)
  5. add with quantity
  6. options via list or Flow
  7. basket
  8. cash currency
  9. Confirm
  10. merchant accept or reject
  11. status messages
  12. delivered
  13. rating

  Free text and voice use AI when credit exists. When it doesn't, the bot replies with the buttons, never an error or silence.
- **Test merchant on staging only.** A staging-only fixture creates one test brand and branch, "Alo Test Grill" in Baakline, with `source = test` and `is_test = true`:
  - a real-looking menu of about 15 items with options and a weighed item
  - 10 km radius, open 24/7
  - switches on Baakline and the three nearby pilot villages for test only

  This does not touch the frozen seeds, scripts or table structure (§31). It is excluded from production by the cut-over checklist and logged in LOG.md.
- **One phone plays both sides (staging only).** Rasheed's admin number can send `#merchant` or `#customer` to switch which side the bot treats him as. As merchant he receives the order card and taps Accept, Ready, Delivered. The merchant portal link works too.
- **Done means:** Rasheed can place a test order from his phone, accept it as the merchant, see every status message, and rate it, with no API credit and no other person.
- **Not in T:** Slack, ops console, admin commands, recovery engine, Twilio, gold card image, templates. These are deferred to session 5b, now run right before the cut-over.

**New order of remaining sessions:**
1. T
2. 6: lean website
3. 11: simulator and scorecard
4. 13: security review
5. D: data
6. 5b: Slack and operations
7. 14: cut-over

The post-pilot sessions are unchanged (§33).

## 35. Open testing: no radius for the test merchant, no Google Places, Kapso setup timing (DECIDED, 12 October 09:10)
**Context:** session T2 merged (#124, 12 October); its CI was blocked only because the self-review comment came after the CI run, and a re-run passed. Rasheed has testers in the Chouf, Beirut and Dubai.

**Test merchant delivers anywhere (staging only):**
- Alo Test Grill accepts any pin, in any country, with no radius check.
- A pin outside every place polygon (Dubai, say) resolves to a "Test location" record. A distance check is not needed for the test merchant. Its delivery fee is the 0–3 km band ($2) everywhere.
- This replaces the 30 km test band from T2; remove that band.
- Real merchants keep the 10 km road-distance rule and the bands in §1. The cut-over checklist asserts that no test merchant exists on production.

**Testers:**
- Each tester joins the Kapso sandbox. Rasheed adds their number under Sandbox WhatsApp → Add session; they send the 6-character code within 15 minutes.
- Testers order as customers. Rasheed stays the only number that can switch to `#merchant`, so he accepts every test order.
- The bot replies in the tester's language (§3), Arabic, English or French.

**Google Places off until Rasheed adds credit:**
- `GOOGLE_PLACES_SERVER_KEY` is not called anywhere: not by the claim lookup (§18.1 D), not by search, and not by `check-setup`.
- Behind the config flag `google_places_enabled = false`. While off, the claim flow uses our vendor list and the "not in our list" path (§18.1 E) only, and `check-setup` reports the key as "skipped".

**Kapso setup timing (no change; recorded because Rasheed asked):**
- No templates, Flows or broadcasts are set up in Kapso yet, and that is intended.
- The sandbox cannot send templates (§3). Flows and the catalogue stay off until the company number exists (§30.1.2). Broadcasts are a post-pilot tool (§33).
- The code for all three exists and is tested against fixtures. Session 5b registers templates and publishes Flows on the company number just before the cut-over.

**Session T3 (Sonnet 5.5, medium):** these changes plus fixes from the next live tests.

## 36. Claude Code does the testing: staging conversation simulator (DECIDED, 12 October 18:40)
**Rasheed's rule:** Claude Code tests the bot itself. Human testers come later, only when they want to. This brings the simulator from session 11 forward as the next session.

**How it works:**
- **Test numbers.** Simulated customers and merchants use reserved numbers (`+999` prefix, plus a country code variant for Lebanon, Beirut and Dubai personas).
  - Messages to these numbers are recorded in a `sim_outbox` table instead of being sent to Kapso.
  - Real numbers are never touched.
  - Staging only; the cut-over checklist asserts the sink is disabled on production.
- **Real path, signed.** A GitHub Actions workflow `staging-e2e` posts signed Kapso-shaped webhook events (text, button replies, list replies, location pins, voice-note stubs) to the deployed `whatsapp-webhook` on staging. It uses the real webhook secret from GitHub secrets. The bot runs exactly as for a person.
- **Scripted conversations with assertions,** in `tests/e2e/scenarios/*.yaml`. Each step sends a message and asserts the reply's type, buttons and key text, then the database state (basket, order status, ledger rows). Starting set:
  1. Full delivery order from a Baakline pin, accepted by the merchant persona, delivered with the code, rated.
  2. The same from a Beirut pin and a Dubai pin (test merchant, §35).
  3. Pickup order.
  4. Double checkout tap, back-and-forth between sections, a quantity change.
  5. Merchant rejects; merchant doesn't answer (auto-cancel at 5 min, time-travelled).
  6. Customer cancels inside 60 s, and after 60 s (§30.3.6).
  7. Free text with no AI credit gets buttons, never silence. Handoff ends on "menu".
  8. Arabic, English and French customers get replies in their language.
  9. Your 12 October chat replayed (T2).
- ~~**Runs after every staging deploy and on demand.**~~ **Test diet (Rasheed's decision, 16 October; replaces the run after every deploy):**
  - **Every PR** runs lint, typecheck, unit tests and the SQL tests on CI's throwaway database only. A pull request never touches staging (the migration dry-run against staging is gone; the deploy applies migrations after the merge).
  - **Staging e2e = a 5-scenario smoke suite** (scenarios marked `smoke: true`: delivery order, catalogue/product-message cart, search to cart, merchant accept, cancel), dispatched by the build session **once at the end of the session** (`staging-e2e`, suite `smoke`). It no longer runs after every merge.
  - **The full suite** runs once before the cut-over, on the production project (session 14).
  - **Staging stays on the free plan** (no upgrade for now; #194 stays open as optional). Background jobs on staging run no more often than every 30 seconds unless a test needs it (session 5e).
- The workflow writes a readable transcript per scenario (who said what, pass/fail per step) as a job summary and an artifact.
  - A failure opens or updates one GitHub issue labelled `e2e`, with the transcript.
  - Build sessions fix what the end-of-session smoke run breaks before finishing.
- **Live phones stay a final check only:** Rasheed or testers tap through once before cut-over (§34 test steps). They are not needed for development.
- **Kill-gate:** if a scenario fails on two consecutive runs with no code change (flaky), it is quarantined with a reason in LOG.md, and the session fixes the flakiness before adding scenarios.

**Session order now:**
1. 11-lite (this simulator; Sonnet 5.5, medium)
2. 6 (lean website)
3. 13 (security review)
4. D (data)
5. 5b (Slack and operations)
6. 14 (cut-over)

## 37. Website: full revamp, "out of this world" (DECIDED, 12 October 22:15; replaces the lean website in §33)
Rasheed wants the whole website revamped to a world-class standard. §24 stays the base: pages, SEO, AIO, budgets. This section adds the creative direction and splits the work into two sessions.

### 37.1 Concept: "Alo" means hello
- The site *is* a conversation, because the product is one.
- Every page leads to one action, **Order on WhatsApp**: a `wa.me` link to the Customer number, with text pre-filled from context (place, dish, merchant).
- No app store badges, no sign-up walls.

### 37.2 Visual direction
- **Palette:**
  - Night is the hero mode: ink #17131A with Crown Gold #F4B63C light, like a warm shop sign in a village at night.
  - Cream #FFF9F0 for reading sections.
  - Gold is never text on cream (§5).
- **Type:** Plus Jakarta Sans and IBM Plex Sans Arabic. Arabic is set as carefully as English, never a fallback. Right-to-left is first-class.
- **Motifs:**
  - a hand-drawn crown
  - the contour lines of the Chouf mountains as a quiet background texture (static SVG)
  - WhatsApp-style chat bubbles as a design element
- **Motion:** purposeful and light. Chat bubbles type in, the basket builds itself, the driver dot moves. Everything respects `prefers-reduced-motion`. No heavy video and no 3D.
- **Built with the `frontend-design` skill.** No stock-template look, and no stock photos of people. Food imagery only from claimed merchants, or illustrated.

### 37.3 Home page, top to bottom
1. **Live chat hero.** A real, coded chat demo (not a video) plays an order in the visitor's language:
   - a voice note waveform
   - its transcript in Arabizi or French mix
   - the basket card, then Confirm
   - "Ali is 3 minutes away"

   Big "Order on WhatsApp" button.
2. **Three taps.** Pin, pick, confirm, shown as three phone frames.
3. **"Speak Lebanese."** Arabic, Arabizi, English and French examples flip through ("بدي ٢ شاورما", "2 shawarma w pepsi", "deux manakish zaatar").
4. **Where we deliver.** A Lebanon map with the places that are switched on lit in gold, read live from the places table (read-only, §31). Before launch it shows the pilot area as "opening soon".
5. **For merchants.**
   - "$1 per order. Not 30%."
   - A savings calculator: the merchant enters monthly orders and average ticket; it shows their cost with Alo King vs a 22–30% commission, labelled "calculated from your numbers".
   - Link to the merchant page.
6. **Send Home.** For Lebanese abroad: order for family from anywhere, pay by card, see the delivery photo. Shows both time zones.
7. **Trust.** Only real facts: cash on delivery, prices set by the shop, Arabic/English/French support, a named human ("Rasheed, Alo King"). No invented reviews, ratings or order counts. Real numbers appear only once they exist.
8. **FAQ** (FAQPage schema) and footer.

### 37.4 Pages
- **Session 6a: customers and foundation.**
  - design system refresh in `src/design/`
  - home
  - place pages (indexed only with 3 or more live merchants, §24.5)
  - cuisine pages
  - claimed-vendor pages: menu, hours, area, "Order on WhatsApp" with the basket pre-filled
  - Send Home landing (AR/EN/FR)
  - order tracking page restyle
  - help/FAQ, contact
  - legal pages: terms, privacy (voice notes, "delete my data", Law 81/2018), refund, cookies; "Alo King SARL (in formation)" until the SARL exists
  - 404
  - `llms.txt`, `robots.txt`, sitemaps, hreflang
- **Session 6b: merchants.**
  - "For merchants" landing with the calculator
  - claim and registration flows (§18, §24.3)
  - merchant terms and collection mandate
  - merchant dashboard restyle, including the AI onboarding side panel shell
  - driver sign-up page
  - admin pages restyle (functional, not marketing)

### 37.5 Quality bar, enforced in CI
- Lighthouse mobile 90 or more for performance, accessibility and SEO; LCP under 2.5 s on simulated 4G; public-page JavaScript under 150 KB; axe with no serious issues; WCAG 2.2 AA (§24.1).
- Every page in Arabic, English and French, at mobile and desktop.
- **Visual self-review loop:**
  1. Playwright screenshots of every changed page in each language and size.
  2. The session reviews them against this section and fixes what looks off: spacing, RTL mirroring, Arabic line height, contrast, overflow.
  3. It repeats until clean, at most three rounds.
  4. The final screenshots go in the PR.
- The Vercel preview link is in the PR for Rasheed. He reviews by looking only and never has to test.

### 37.6 Also in 6a (from the simulator session)
- When the merchant allows pickup, checkout offers **Delivery / Pickup** buttons.
- The track card says "shop", not "driver", on pickup orders.
- `staging-e2e` must stay green.

**Session plan before the pilot:**
1. 6a: Sonnet 5.5, high
2. 6b: Sonnet 5.5, high
3. 13: security review
4. D: data
5. 5b: Slack and operations
6. 14: cut-over

## 38. Shouf-first pilot: final plan (DECIDED, 14 October 12:30; Rasheed's decision, reviewed by Claude Fable 5.1)
Rasheed's decision on 14 October: stop, start from the Shouf with his three Shouf files, and finish to a world-class standard on the Max plan. This section records what he decided, the verdict on every item in the "§40 executive directive" (a Gemini draft; recorded here as §38, since the file's numbering is sequential), the ChatGPT "unknown unknowns" report and the "Operational and Technical Specifications" document, and the final session plan. **This section overrides §31 (the data freeze) and the pilot area in §1 and §16.** Everything else stands unless named below.

### 38.1 Scope: the Shouf, 12 villages, 315 merchants
- **Pilot area:** Baakleen, Boqaata, Barouk, Deir El Qamar, Samqaniyeh, Batloun, Kfar Nabrakh, Kfar Him, Dmit, Ain w Zain, Maaser El Chouf, Jdeideh (the localities in the file). These places are switched `on`; every other place in Lebanon stays `off`. The all-Lebanon places list (§16) stays as built.
- **Vendor data is replaced.** The 2,044 nationwide seed vendors on staging are deleted (they came from the same Google pull and will be superseded by Rasheed's 8,101-row national dataset later). The 315 Shouf merchants become the vendor list: 143 restaurants, 63 cafés, 42 bakeries, 41 groceries, 14 butchers, 12 dessert shops; 218 with a mobile number that can receive a WhatsApp claim code.
- **The data freeze (§31) ends with session D, which is now the Shouf load.** The freeze rule stays for every other session: data changes only in a `Data:` PR.
- **Files, committed in `supabase/seed/shouf/source/`** (ratings and review counts removed before commit, §15.2):
  - `01_shouf_merchants_315.csv`
  - `03_shouf_digital_menus.json`: 19 restaurant menus (4–63 items each; Fred's Food has 63 with real image URLs) and 2 supermarket catalogues of 45 essentials each.
  - `02_shouf_photos.json`: 2,927 Google photo URLs for 234 merchants. **Rasheed's decision (14 October 12:13): include the photos, Google's terms notwithstanding.** Claude's note, recorded once as in §15.1: Google's terms forbid caching Places photos, and the realistic consequence is the Places key being suspended, which §35 has already switched off. Rules that limit the exposure: session D copies each photo into Supabase Storage (the Google URLs expire), marks them `source = seed`, shows them only on claimed vendors' pages after the merchant confirms or replaces them, and deletes them on the merchant's request. The 447 review texts are **not** committed or used: §5 forbids ratings for unclaimed vendors, and the CSV's `cuisine_tags` and `search_tokens` already carry what they add.
- **Decisions confirmed by Rasheed, 14 October 12:13:** the 2,044 nationwide vendors are deleted (his full dataset comes later); all 12 villages stay in the pilot.

### 38.2 Data rules for the Shouf load (session D)
1. **Merchants:** import per §15.2. Split the 57 names that mix scripts into `name_ar` and `name_en`. Backfill the 11 missing localities from the address. Set `is_whatsapp_candidate` from the number, not from the file's column. Everything stays `unclaimed`, `orderable = false`, `public_page = false`, `source = seed_shouf_2026_10`.
2. **Menus:** import the 19 menus as **draft menus** (`status = draft`, `source = seed`), never orderable until the merchant claims and confirms them section by section (§18.3). They exist to make claiming a 2-minute job: the merchant sees their menu pre-filled. Prices are shown to the merchant as "please confirm"; an item with no price stays hidden. This replaces §15.3's "no menu text imported" for these 19 only.
3. **Supermarkets:** the 45-SKU essentials catalogues for Coop Baakleen and Baakline Supermarket import as draft menus the same way, under `grocery_supermarket`, and double as the realistic test catalogue (the staging simulator uses them).
4. **Landmarks seed:** from OpenStreetMap for the pilot area only: mosques, churches, pharmacies, roundabouts, squares, fountains, hospitals, schools, municipal buildings. Into the existing `landmarks` table (§16, §28) with `source = osm` and low confidence; confirmations come from deliveries. The spec document's Overpass queries are the starting point.
5. **Place aliases:** add OSM `alt_name`, `loc_name` and `old_name` for the pilot villages into `place_aliases`.
6. **Dish library:** merge the spec document's Levantine taxonomy (ingredients, cuts, EU-14 allergens) into the 203-dish library (§32.3). Sesame/tahini and toum-egg rules in 38.4.
7. **Verification output** of session D: counts of merchants per village, draft items for ROUTE 66, Un basilico and Fred's Food, SKUs for Coop Baakleen, and one simulated quote returning USD and LBP at the dated rate.

### 38.3 Verdicts on the executive directive
| Item | Verdict | Rule |
|---|---|---|
| Shouf-first, 10–12 km radius, motorbike dispatch validation | Adopt | 38.1 |
| Purge test data and ingest the three files | Adopt, with 38.1 and 38.2 (review texts excluded; photos per 38.1) | session D |
| PostGIS GIST on vendor location | Already in place (session 2) | none |
| Meta charges service and utility messages since 1 Oct 2026 | Already VERIFIED (§0 correction 1, §6); first 1,000 service messages per number per month are free | cost model |
| ≤8 billable messages per order | Adopt as a **budget**: target 8, hard cap 12 per order, consolidated "confirmed + ETA", "on the way + tracking", "delivered + rate". The cost ledger reports the average; above 8 opens a LOG item | session 5c |
| Driver limited to 1 WhatsApp message; telemetry via the driver web app | Adapt: fleet drivers use the app (§32.2) and get at most 2 WhatsApp messages per job (offer, settlement). Merchant drivers on WhatsApp keep the job card and status buttons (about 4 messages, $0.04, inside the $1 fee) | session 8 |
| Scope the assistant to food, grocery, delivery and support only (Meta Business Solution Terms) | Adopt: the system prompt refuses general chat politely in all four languages | session 5c |
| CTWA 72-hour window flag (`is_ctwa_attributed`) | Adopt; the real window is read from the webhook pricing fields (§6) | session 12 |
| AI proposes, PostgreSQL decides; `propose_cart` → `quote_cart` | Already the design (§3, session 4). **Reject "applies 11% VAT" to menu prices**: shop prices are the shop's prices (same-price badge, §32.5); VAT applies only to Alo King's own fees once the SARL is VAT-registered (§20.3) | none |
| Optimistic locking on checkout, `FOR UPDATE` ordered by item ID | Already built (menu version, race tests in session 3); session D adds a deadlock-order test | session D |
| Burst intake under 100 ms, pgmq, dead-letter after 5 attempts, audio never downloaded in intake | Already built (session 1); add the dead-letter queue | session 5c |
| Outbound budget 60 msg/s per number; ≥6 s gap for non-urgent messages to the same person (Meta error 131056, VERIFIED) | Adopt in the outbox sender | session 5c |
| Customer agent: 2-tap "Repeat last order / New order" greeting for returning customers | Adopt | session 5c |
| Arabizi number normalisation and brand words (Picon, Bonjus, Nido) | Adopt into the normalisation dictionary (§32.4) | session 5c |
| "Mood and macro" queries into SQL filters | Already (§32.3 search rules) | none |
| One rule-based upsell per order | Already (§29.3) | none |
| Kitchen station generator mode with auto-reactivation (`set_availability(station, minutes)`) | Adopt: items carry a `station` (fryer, oven, grill, espresso, cold); "fryer off 15 min" hides that station's items and pg_cron restores them | session 5c |
| Vision menu OCR under 60 s | Already (§18.3, §32.3); needs API credit | none |
| Weekly merchant report with 1-tap Boost | Already (§30.2.5, §32.5) | session 12 |
| Batching rule: pickups ≤600 m, same 15-min window, detour ≤1.5 km, first customer delayed ≤8 min | Adopt as config (tighter than §21.3) | session 8 |
| Driver pay P = 1.20 + 0.20·km + 0.60·(n−1) + stairs + weight | Adopt as the fleet pay formula in config, replacing "80% of the fee" in §21.3; tips still 100% | session 8 |
| Stairs surcharge min($2, $0.25·max(0, floor−2)·E) + $0.50·max(0, heavy−1), E=1 with no elevator or power cut; 100% to driver | Adopt as config; charged only when shown before checkout (§29.2) | sessions 5c and 8 |
| Cash cap $150, pause until deposit at Whish/OMT | Already (§21.4) | none |
| Geofence completion with PIN or photo beyond 150 m | Already (§27.6) | none |
| Offline GPS queue in the driver PWA | Already (§27.2) | session 8 |
| Send Home: Whish 3% links; roadmap to a UAE entity and Apple Pay | Already Whish + Tap (§22); the UAE entity is a later owner decision, not a build item | none |
| Care-package subscriptions | Already opt-in reminders and recurring (§22.2, §32.5) | session 10 |
| **Medicine delivery ban** | Adopt. VERIFIED: the Order of Pharmacists announced on 2 June 2026 that ordering medicines through delivery apps is illegal and is pursuing violators. The bot refuses medicine or pharmacy requests in all four languages and points to a pharmacy; pharmacies stay out of the categories (§29.2) | session 5c |
| Dispute arbitrator: missing item ≤$8 auto-credit if the customer's dispute rate <10%; cold food by GPS time ×1.5 → 30% credit; prep delay >15 min → merchant pays; damage photo → remake | Adopt as deterministic rules, inside §20's limits: automatic up to $8, Rasheed's tap above $20, logged. Photo classification waits for API credit | session 5c |
| Escalation ladder 0/15/45/60/75/120 s, auto-cancel at 120 s | Adapt: keep 15/45/75 s (§23); Slack alert at 60 s joins 5b; auto-cancel and reroute at **180 s** (not 120, too short for a small kitchen), with alternatives offered to the customer | sessions 5b and 5c |
| Nightly ledger audit (debits = credits), cash sweeps, unmatched payments | Already (§20.2 reconciliation); the nightly balance assertion is added | session 9 |
| `logistics_landmarks` and `delivery_addresses` tables | Reject the new tables: `landmarks`, `addresses`, `door_points` exist (§28). Adopt the missing fields: `landmark_relation`, `floor`, `has_elevator`, `lost_driver_calls`, running-average door point within 60 m at ≤25 m accuracy, and the metric **lost-driver calls per delivery < 0.5** | session D |
| Food knowledge graph; `is_siyami` and `is_halal` computed from ingredients; sesame/tahini warning on hummus, mutabbal, tarator; `toum_contains_egg`; shared-kitchen disclaimer | Adopt into the dish library and item flags. Computed flags are shown as "estimated" until the merchant confirms (§32.3 evidence rule). The disclaimer appears on every menu | session 5c |
| Google Maps terms: `place_id` only indefinitely, coordinates ≤30 days, no photos/reviews; replace seed values on claim | Adopt for ratings and reviews (none stored at all); photos kept per Rasheed's decision with the 38.1 limits. Seed coordinates are refreshed from the merchant's own pin at claim | session D |
| Fixed peg 89,500, "no FX APIs" | Adapt: the rate stays in the dated rate table (§13), seeded at 89,500 (the official rate since February 2024, unchanged in October 2026); never a constant in code (CLAUDE.md) | none |
| Flat $1 fee; fee bands; online payment pass-through | Already (§1, §29.1) | none |
| "Alo King Plus" opt-in 5–8% tier | Defer: the per-delivered-order sponsored fee (§20.4) does the same job with less to explain; revisit after 500 delivered orders | after pilot |

### 38.4 Verdicts on the ChatGPT report and the specifications document
- **Transcription candidates:** Deepgram Nova-3 (VERIFIED: supports Lebanese Arabic `ar-LB` with keyterm prompting) joins the eval alongside the OpenAI transcription models, Kapso's transcript and ElevenLabs Scribe. The eval on the real voice notes (§32.4) picks the winner by basket accuracy, latency and cost; it is config.
- **Runtime model:** Claude Haiku 5.5 is real (VERIFIED: released 7 October 2026, $0.10 input / $0.50 output per million tokens, ten times cheaper than Haiku 4.5). It becomes the default customer-turn model once the text and voice evals confirm it is at least as accurate; `usage.ts` prices are updated first. Sonnet 5.5 stays for menu extraction, photos and complaints.
- **Rejected tooling:** Upstash Redis, Cloudflare Workers, Fly.io, Valhalla self-hosting with elevation tiles, Playwright scraping of product photos, Stripe (not available in Lebanon), a 10% commission. Reason: each adds a vendor or a server a solo operator must run; Postgres in Frankfurt plus learned travel-time corrections (§28) covers the need. Langfuse observability: deferred; `ai_calls` plus Sentry suffice for the pilot.
- **Adopted from the specifications document:** the OSM colloquial-gazetteer and landmark queries (38.2), the Levantine taxonomy (38.2), the Omega/BIM POS integration notes as input for §23 adapters, the OBA green-tick requirements as an owner track after launch (needs press coverage), the shift float in two currencies and mixed-cash change math (already §27.8, §30.3.1). Cash cap stays $150, not $250.

### 38.5 Final session plan (all on the Max plan; Sonnet 5.5 unless stated)
| # | Session | Model | Content |
|---|---|---|---|
| D | Shouf data load | Opus 5.5, high | 38.1–38.2: purge, import merchants and draft menus, landmarks and aliases from OSM, dish-library merge, address fields, verification queries; switch the 12 villages on; point the simulator (§36) at real Shouf merchants in draft mode; update HANDOFF |
| 5c | Directive engineering | Sonnet 5.5, high | message budget and consolidation, scope prompt, medicine refusal, station generator mode, outbox rate limits and dead-letter, 2-tap greeting, Arabizi dictionary, dispute rules, sesame/toum/disclaimer, stairs config, 180 s auto-cancel, Haiku 5.5 in config behind the eval |
| 13 | Security review | Opus 5.5, high | everything merged, including the §32.7 self-reviewed PRs |
| 5b | Slack and operations | Sonnet 5.5, high | §32.1 console and handoff threads, admin WhatsApp commands, recovery engine, Kapso templates and Flows on the company number, 60 s Slack alert |
| 14 | Pilot cut-over | Opus 5.5, high | production project, numbers, go-live checklist (no test merchant, no sim sink, no E2E secret), Twilio, Pro plans |
| after | 9 payments, 8 fleet, 12 growth, 10 Send Home | per §33 | unchanged |

### 38.6 Owner track for the Shouf pilot (in order)
1. API credit: Anthropic and OpenAI. Deepgram: account and key created 14 October; add it as the GitHub secret `DEEPGRAM_API_KEY` (the transcription eval reads it; `check-setup` proves it).
2. `aloking.com` (#74).
3. SARL → bank account and Whish business account (#70) → company lines and the Meta portfolio (#73) → Tap (#71) and the lawyer letter (#72).
4. First five merchants: they claim themselves from the pre-filled Shouf list (no outreach); Rasheed's 10-minute setup call (§30.6) finishes each menu.

## 39. After session D: CI billing, delivery area, public listings, full menus, agents, Kapso, website (DECIDED, 14 October 14:30, extended 14 October evening; Rasheed's requests, decided by Claude)
Rasheed's requests after session D, and the decision on each. **This section overrides:** §5, §6 ("no public pages for unclaimed vendors", "no further scraping"), §15.2 (`public_page = false`; `phone_seed` never shown publicly, now visible through "Ask them to join"), §15.3 and §38.2 items 1–2 (menu text only for the 19 menus), §32.4 and the voice README ("private repo"), §38.1 (which places are `on`), the "generator mode" naming in §38.3, §30.1 item 2 (native WhatsApp cart, deferred until the Meta portfolio exists) §35 (broadcasts post-pilot: the broadcast sender is built in 5b but stays off until the pilot gate), §30 item 5 ("memory never recited back": the customer can now see their memory, 39.6), §26 (the `whatsapp-cloud-api-js` and `whatsapp-cloud-inbox` rows, 39.8), and §37.3 item 5 and the shared §37.4 FAQ (39.11), and §1's 10 km delivery limit and fee bands with their restatements in §8 item 3, §24 (place-page sentence), §28 (ORS) and §35 (real merchants keep 10 km) (now 20 km by road inside the 39.2 boundary). Everything else stands.

### 39.1 CI was red because the private repo ran out of free GitHub Actions minutes; the repo is now public
- **Root cause (VERIFIED from the run annotations, 14 October):** "The job was not started because recent account payments have failed or your spending limit needs to be increased." The private repo used up its 2,000 free Actions minutes (about 100 runs since 1 October). Nothing in the code was broken.
- **Rasheed's decision (14 October 14:14): the repo is public**, so standard GitHub-hosted runners are free and unlimited (GitHub docs). No card, no budget. Checked the same day: no live secret in the git history (the only hits were the local-dev Postgres password and a Google photo URL).
- **Rasheed's decision on the repo contents (14 October 14:56):** everything stays in the repo as it is, including the voice-note eval set and the Shouf source files; no private bucket. The voice README's "private repo" sentence is corrected; a speaker's removal request is still honoured per that README.
- **Recorded risk (as with the Google note in §15.1):** the public repo exposes the voice notes and about 218 merchant mobile numbers from the seed file (Lebanon's personal-data law, Law 81/2018). Rasheed accepts it. Removal requests from a merchant or speaker are honoured within 48 hours by deleting the file or row in a PR; git history keeps old copies.
- **Branch rules:** with a public repo, a ruleset on `rebuild/lebanon` requires the CI checks before merge (available on the free plan for public repos). Forks cannot read secrets; workflows that use secrets run only on `push` and on `pull_request` from branches of this repo.
- **CI diet stays** (good practice and faster PRs): `concurrency` with `cancel-in-progress`; path filters so docs-only and data-only changes skip the web build and website-quality jobs; Supabase CLI via pinned `supabase/setup-cli` authenticated with `GITHUB_TOKEN` (ends the "rate limit exceeded" failures); `staging-e2e` only after a deploy; Claude review only on ready PRs; job timeouts. Session E logs the change in LOG.md.
- Issue #142 is closed: fixed by making the repo public.

### 39.2 Delivery area: Rasheed's boundary around the Shouf merchants (authoritative list, 14 October evening)
- **Rule:** shops stay in the 12 pilot villages (§38.1; the vendor list). Customers can order **to** any place inside the boundary below that is within 20 km **by road** of the chosen shop (`max_delivery_km()`, the largest fee band; road distance from the routing provider, ~~straight line only as the fallback~~ the shop → place road distance as the fallback, §39.15.1). Price and the per-order distance check stay per order (§29.1); an address outside the boundary is refused whatever its road distance.
- **Delivered-to places (Rasheed's list, corrected 14 October evening; this list is authoritative):**
  - **Shop villages (§38.1):** the 12 pilot villages; toward the north edge: Barouk, Batloun, Ain w Zain and Boqaata.
  - **Top edge:** Niha, Jbaa, Mristi, Khraibeh, Baadarane, Botmeh.
  - **South edge:** Bater is the last village; before it, coming toward it: Ain Qani (there is no "Qanibeh"), Ammatour, Haret Jandal, Kahlouniyeh, Mazraat el Chouf.
  - **North edge:** Ain Zhalta is the maximum; nothing past it.
  - **South-west, from Baakleen:** Ainbal, Aatrine, Gharifeh.
  - **Back down:** Deir Dourit, Deir el Qamar, Beiteddine, Kfar Him, Dmit, Jahliyeh (near Dmit), and the El Manasef villages (Lower Shouf): Kfar Qatra, Kfarfakoud, Derkoush, Bchetfine.
  - Any village physically between these places counts (for example Moukhtara and Samqaniyeh).
- **Hard stops:** no Iqlim el Kharroub village; nothing past Ain Zhalta (not Nabaa el Safa or beyond); Bater is the last village on the south side; nothing past Gharifeh; nothing toward Damour.
- **Checked by Claude against the places gazetteer and the 315 merchant coordinates (14 October):** every named village matches a gazetteer entry in the Chouf (Rasheed corrected "Jbaaliyeh" to Kahlouniyeh, Mazraat el Chouf and Jahliyeh), and all are 0.5–8 km in a straight line from the nearest shop (Niha 7.8, Bater 7.0, Jbaa 6.5, Mristi 6.4; the rest under 4). **A plain 10 km radius would be wrong:** it also takes in Nabaa el Safa (2.2 km), Damour (6.0), the Iqlim el Kharroub towns (Chehim 4.6, Barja 7.9, Ketermaya 7.9, Mazboud 6.1) and the coastal Chouf (Naameh, Saadiyat, Jiyeh). The boundary below is therefore the rule; the distance is only the per-order check.
- **How the boundary is built:** a polygon around the named edge villages and the shop villages; every Chouf place whose centre falls inside it is delivered-to (this is what "any village between" means: for example Moukhtara, Mazraat el Chouf, Fraidis, Kfar Hamel, Jahliyeh, Brih, Maasser Beit ed Dine). The hard stops are an explicit deny-list of place IDs, not a sub-region filter (`sub_region` is blank for 89 Chouf rows): every place in sub-region Iqlim al-Kharroub or Chouf el-Saheli, plus Damour, Naameh, Es-Saadiyat, Wardaniyeh, Sibline, Joun, Jadra, Debbieh, Deir el Mkhalles and Nabaa al Safa, plus everything outside the Chouf district (Aley, Baabda, West Bekaa, Zahle). Deny-listed places are off even if a polygon or distance would include them. **The computed list is committed:** `supabase/seed/places/shouf_delivery_boundary.csv` (59 places: the shop villages, the villages Rasheed named, and the places between them) and `supabase/seed/places/shouf_delivery_denylist.csv` (the hard stops in the Chouf; everything outside the Chouf district is off too). Session F loads these two files as the dated `pilot_place_ids` row; Rasheed strikes or adds a village by editing one line.
- **How it is stored:** the boundary is a dated `pilot_place_ids` row listing every delivered-to place (authoritative). **Session E's merged radius row (259 places from `20261014160000_delivery_area.sql`, including Aley, Baabda, West Bekaa, Damour and the Iqlim) is wrong under this rule and stays live on staging only until session F replaces it.** Session F changes `delivery_area_proposal()` to boundary ∩ road distance and the seed test `supabase/tests/seed/shouf_delivery_area.sql` to "`pilot_place_ids` ⊆ proposal, and every deny-listed place off". Per order, the server checks road distance from the chosen shop; additions when new shops join take effect only through a new dated row. Names the gazetteer cannot match are logged in DATA-ISSUES.md, never guessed.
- **OSM landmarks and place aliases (§38.2 items 4–5) are run for every delivered-to place**, not only the 12 villages. Same categories, same `source = osm`, low confidence.
- **Road distance and fees inside the boundary (decided 15 October, after session F):** session F's road distances show that some villages Rasheed named are more than 10 km by road from every shop (Jbaa 18.3, Niha 16.2, Bater 14.5, Mresti 13.2, Maasser el Chouf 12.5, Baadaran 10.9), while the fee bands stop at 10 km, so those villages would show as "on" but refuse every order. Rule: **the boundary decides where we deliver; road distance only sets the fee.** A **new dated `delivery_fee_bands` set** (new `effective_from`) restates 3 km $2.00, 6 km $3.00 and 10 km $4.50 and **adds 20 km $6.00**; the 7 October rows are never updated or deleted (bands are read from the latest set). The per-order check refuses only addresses outside the boundary or more than 20 km by road from the chosen shop. Raising `max_delivery_km()` to 20 also: lets a merchant set its own-delivery radius up to 20 km, gives vendors with no radius a 20 km limit, and makes the site show fees up to $6 and 20 km (all accepted). **The straight-line radius for "Not on Alo King yet" listings on place pages stays 10 km** through its own dated config key (`listing_radius_km`), not the bands. Delghani (15.6 km) and El Bireh (12.7 km) come back on; El Bireh's route is recomputed in the same `Data:` PR before the new band set loads. A shop's own-delivery radius (§39.7) can still be smaller.
- **The "where we deliver" page** shows this as an interactive map of the zone (session W, 39.11), not a list of village blocks.

### 39.3 Unclaimed Shouf merchants are listed publicly ("Not on Alo King yet")
- **Why:** an empty village page sells nothing. Customers should see every shop near them, and the shops should see demand.
- **Place pages, cuisine pages and the bot** list every seed merchant in the delivery area after the orderable ones, as "Not on Alo King yet" cards: name, category, village, cuisine tags, opening hours, and the draft menu's **item names and descriptions without prices** (prices are unconfirmed). No ratings (§5), no Google photos (§38.1), no ordering. Vendor pages for unclaimed merchants exist with `noindex` until claimed.
- **"Ask them to join"** on the card and in the bot: the customer gets a one-tap `wa.me` link that opens **their own** WhatsApp to the shop's number with a pre-written invitation and the shop's claim link. Alo King never messages an unclaimed merchant itself (Meta opt-in rules; no outreach, §25). Each tap is counted, and the claim page shows the merchant "N customers asked for you".
- The bot, asked for an unclaimed shop, says it is not on Alo King yet, offers the "Ask them to join" link and the closest orderable alternatives.

### 39.4 Full menus for all 315 merchants, as drafts the merchant confirms
- **Goal:** every merchant that claims finds its menu already there; old prices are fine because the merchant confirms each section (§38.2 item 2). Every imported menu is `status = draft`, `source = seed`, with `source_url` and `captured_at`.
- **Sources, in order:**
  1. Owner menu photos: `supabase/seed/shouf/source/04_owner_menu_photos_2026-10-14.json` (SEVEN Burgers & Beyond, Boqaata: 44 items in LBP; Nayeh w Meshwiyeh, Baakleen: 121 items in USD; the photos are in `owner_menu_photos/`). LBP menu prices are converted to `price_usd` at the dated rate when the merchant approves the section (the card shows the LBP figure and the USD it becomes); `menu_items` keeps `price_usd` only, and order totals still lock the rate on the order. Items priced as "A / B" for one price import as one item with a choice option. Nayeh w Meshwiyeh appears twice in the merchant file (two place_ids): merge into one vendor, logged in DATA-ISSUES.md.
  2. The 53 `website_or_menu_link` values, through small platform adapters: Omega (`menu.omegasoftware.ca`, e.g. INDINER time `/indinertime`, Che Vita, Labne w Jebne: read the JSON the page loads), qrscan-menu, Restbits/Thrubits, leb.directory, Coverbox, mymenus.site, ScanGOW, public Google Drive PDFs, plain HTML. Instagram and Facebook are skipped (login walls, terms). Runs as a `workflow_dispatch` job `menu-harvest` (build sessions cannot reach these hosts), output committed in a `Data:` PR.
  3. Menu boards inside the 2,927 seed photos: Haiku 5.5 classifies each photo (menu or not); Sonnet 5.5 extracts the menu photos into draft items. Internal use only; the photos stay hidden (§38.1). Needs Anthropic API credit (§38.6 item 1); estimated under $10 for the whole set.
  4. Merchants without any source: no invented menu. The copilot imports theirs from a photo, PDF, link or text at claim (§18.3).
- The verification output lists, per village, merchants with a draft menu and items per merchant.

### 39.5 Ingredient and nutrition data
- **Already in place:** USDA FoodData Central (public domain) behind the 203-dish library and the `nutrition-library` check (§32.3). No other ingredient database is needed for restaurant dishes.
- **Added for groceries:** Open Food Facts (ODbL) by barcode, on demand, when a grocery item is created or scanned: name, brand, quantity, allergens, ingredients, Nutri-Score, image. Results are cached in their own table with attribution (share-alike stays contained to that table); never a bulk download. Shown as "estimated" until the merchant confirms (§32.3 evidence rule). No health claims beyond allergens and estimated calories.

### 39.6 Customer agent: one smart catalogue across every shop
- The agent searches one index across every orderable menu and catalogue in the customer's delivery area, plus the dish library's synonyms (Arabic, Arabizi, French, English, brand words): "bade shi 7arr w rkhis", "manoushe kishk", "Pepsi diet 2", "akel lal wled" all resolve to real items with server prices. It compares shops, suggests one rule-based upsell (§29.3), remembers usual orders, and handles text, voice and button taps. Unclaimed shops answer per 39.3.
- The code exists (session 4); what is missing is API credit (owner, §38.6 item 1) and the 5c items. Free text and voice stay off until the eval passes on the real voice notes (§32.4).
- **Customer memory (Rasheed's decision, 14 October):** the agent remembers each customer by phone number: name, saved addresses, order history and usual orders, language and way of writing, and **dietary preferences taken only from what the customer says or orders** ("gluten-free", "no sugar", "no nuts, allergy"). The agent never asks about health. Memory is stored as facts with their source and date in the database, not in prompts; a dietary note is shown back as "you asked for gluten-free last time", never as a diagnosis. An allergy or health-related note (health data under Law 81/2018) is saved only after the customer agrees, like a new address. §32.3 still governs: a remembered preference never makes the agent call an item safe, and hard filters use `merchant_verified` values only. The customer can ask to see it ("what do you remember about me?") and delete any part or all of it with one tap. Memory is used only to help that customer order, never for marketing segments, never shown to merchants beyond what an order needs (an allergy note on that order). It follows the four-language rules and the §20 data rules.
- **Address scenarios:** the delivery address is confirmed on **every** order, even when saved addresses exist ("Home in Baakleen, or somewhere else today?"), with a new pin or landmark when it changes, because Lebanese customers order from relatives' homes and other places. A new address is saved only when the customer agrees.
- **Send Home and international numbers:** an expat abroad ordering for family uses the Send Home flow (§22) with the recipient's address and phone; the same expat visiting Lebanon and ordering from the international number while in the Shouf is a normal local order to the address they confirm. The agent never infers location or nationality from the country code (§22); it asks "Is this for you, or for someone else?" only on the §22.1 conditions (the address is not one of the customer's saved addresses, or the message says the order is for someone else), and remembers the answer per address.
- **Scope of the agent:** ordering, basket changes, checkout, tracking, cancellations, refunds and returns through typed tools where the server decides eligibility and amount (§20.1), support and human handoff (§30), recommendations and one upsell, and the opted-in offers and sponsored placements from the ad system (§20.4), all reading live menus, prices and availability from the database. **Zero invented facts:** every item, price, fee, time and policy in a reply comes from a tool result; when the database has no answer the agent says so and offers the closest real option or a human.

### 39.7 Merchant copilot: full control of the shop, not "generator mode"
- The station switch from §38.3 is renamed **availability**; generators are only one reason a station goes off. The copilot covers, in four languages, by text, voice or tap: item and section on/off with auto-restore; stock counts for groceries; price changes; add, edit and remove items; menu import from photo, PDF, link or text; offers (percent off, bundle, free item, happy-hour schedule, first-order offer); opening hours and closures; minimum order and own-delivery radius; Boost and sponsored placement (§20.4, §30.2.5) start, stop and budget; staff and their roles; daily and weekly reports. Every change that touches price, availability or money needs the merchant's confirming tap (product rules).
- **Merchant memory:** the copilot remembers each shop's habits, usual hours, stock patterns, regular closures, the way the owner and staff write, and past decisions, as dated facts in the database. It is **predictive and proactive** inside the rules: suggests marking an item sold out when it usually runs out, reminds before a usual closure, flags slow acceptance, proposes an offer on a quiet day, and summarises the week; every suggestion needs a confirming tap and never changes money or availability on its own.

### 39.8 Kapso: full setup on a US test number first
- Rasheed switched the GitHub secret `KAPSO_API_KEY` and his claude.ai Kapso connector to the `Alo King` project (14 October; checked: project `Alo King`, sandbox number only, instant US number setup available). `Kabsi.co` stays off limits.
- **Session 5b does, on a US test number in the Alo King Kapso project:** number via Kapso setup (if a US number cannot be created by API, an owner issue with click steps); webhooks pinned to `eu-central-1`; all utility templates in four languages (order confirmed + ETA, on the way + tracking, delivered + rate, merchant new order, claim code, payment link, Send Home receipt); marketing templates for opted-in customers only; Flows (address with landmark, checkout, merchant claim, menu section confirm, merchant settings); broadcasts to opted-in segments with STOP; the "smart menu" as list messages and Flows driven by the database.
- ~~**No Meta product catalogue in the pilot:** it needs Commerce Manager per business portfolio, caps multi-product messages at 30 items, and duplicates prices outside the server. Revisit after the Meta portfolio exists (#73).~~ **Overridden on 15 October, see 39.12.**
- The company numbers (§38.6) replace the US number at cut-over (session 14).
- **Kapso's new features:** 5b reviews Kapso's Meta Business Agent tab, workflows, functions, events and the Kapso example repositories on GitHub, and adopts one only where it replaces our own code with less to run; our agent stays the brain (server owns prices, baskets and orders). Rasheed prepares nothing in Kapso by hand.
- **Kapso dashboard as of 15 October (Rasheed's screenshots; superseded the same day, see the next bullet):** the project has only the sandbox number; **templates, broadcasts and the Meta Business Agent are disabled on sandbox numbers** and need a production number, so 5b starts by connecting the US test number through Kapso's setup (Phone numbers → Set up) by API; if only the dashboard can do it (or Meta verification is needed), 5b opens an `owner` issue with exact click steps (§25). The free plan's limits are shown on the dashboard (paid plan: 100K messages a month and 3 numbers); if the free plan cannot hold the US test number, 5b opens an owner issue with the plan and price, never upgrades itself. Kapso Agent (its built-in assistant, with modes for API, Workflows, Inbox, Findings and Meta Business Agent) is available for debugging and drafting templates and Flows; it may be given read-only access to this repository (Kapso Agent → Resources → Connect GitHub; an `owner` issue with click steps, since it is a dashboard action) when 5b needs it, never write access, and never secrets beyond what the Kapso project already holds.
- **Kapso moved to a new account (15 October, Rasheed):** project `Alo King` id `d4461380-e8d8-4a33-9b87-7b3fffc67d6d`; the GitHub secret `KAPSO_API_KEY` holds this project's key. **US test number +1 203-660-2328** (phone_number_id `1378974041965966`, WABA `1086076707594153`), connected through Kapso instant setup on Rasheed's existing Meta business portfolio "Memo Tiles" (he could not create another portfolio); the company portfolio (#73) replaces it at cut-over (session 14). Meta fees are paid with **Kapso credits** (Rasheed's choice in the setup; Meta does not allow this credit line to be replaced later on this WABA). Webhooks registered for both numbers (eu-central-1) and verified on 15 October; the display name "Alo King" is in Meta review, so sending is limited until it is approved. The kapso-number run of 15 October submitted 10 of 15 templates (30 language versions); Meta refused the other five because their buttons contain emoji, and the Flows upload failed: session 13 fixes both. The old account's project and setup links are void.
- **Kapso readiness on the US test number (session 5d, 15 October):**
  - **Templates:** 45 versions (15 templates × ar/en/fr). 42 are submitted and pending at Meta. The 3 alo_claim_code versions are blocked, because Meta takes authentication templates only from the 2K messaging tier (error 2388185).
    - The four refused templates were resubmitted without emoji in their buttons, and the validator now refuses emoji, variables and line breaks in a button.
    - Meta filed alo_staff_welcome (ar/en/fr), alo_merchant_weekly (en/fr) and alo_kitchen_full (fr) as MARKETING; kapso-number warns on every category mismatch.
    - kapso-number now fails on any refused or missing version.
  - **Flows:** all six Flows in ar and en (12) are uploaded as valid drafts with encryption set up; none needs a data endpoint (all are navigate-only).
    - Meta refuses to publish them (422 "Integrity requirements not met") and blocks even a draft test send (139000), until the "Memo Tiles" business is verified and the number's messaging limit is raised (owner issue #182).
    - Until then the address and checkout steps run on the text and button path.
  - **Catalogue (39.12):** Kapso's Meta proxy has no catalogue endpoints. Creating the catalogue, connecting it and a token with `catalog_management` are owner steps (#181). The sync, product messages and native cart are built and tested on the simulator and switch on by themselves once `kapso-catalog` finds the catalogue connected.
  - **Live check with Rasheed's phone (15 October):** pass: greeting, smart list menu, human handoff (customer side).
    - Fixed after the check: the operator alert for the handoff went out from the sandbox, where his Kapso sandbox session had ended (403). An outbox message now goes from the number the person wrote to last.
    - The rest of the checklist waits for his taps on the US number. The simulator covers every item: scenarios 1–26.
- **Kapso's public repositories (github.com/gokapso, reviewed 14 October):** use `flowso` (local WhatsApp Flows emulator) to validate every Flow before publishing; keep `agent-skills` as the source of our `.claude/skills` Kapso skills and update them from it; read `whatsapp-broadcasts-example` as the reference for the broadcast sender. `whatsapp-voice-agent-starter` and `whatsapp-voice-agent-pipecat` (answering WhatsApp calls with a voice agent) are noted for after the pilot. `whatsapp-cloud-api-js`, `whatsapp-cloud-inbox`, the chat SDKs and the n8n, Hermes and OpenClaw plugins are not needed: our edge functions already call Kapso directly and Slack is the operator inbox (§32.1).

### 39.9 Models
- Build sessions stay on Opus 5.5 (high) for data and agent work and Sonnet 5.5 (high) for routine work. **Claude Fable 5.1 is not needed**: no task here is beyond Opus 5.5, and its extra cybersecurity safeguards can get in the way of session 13 (security review).

### 39.10 Session plan from here (replaces the rows after D in §38.5)
| # | Session | Model | Content |
|---|---|---|---|
| E | Finish D, CI diet, delivery area, listings | Opus 5.5, high | 39.1 ruleset, voice README and CI diet; root-cause the intermittent dispatch stall (an attempt dies with no error, the queue retries after 60–100 s, the session's tappable options are lost; it hit pickup and the market tap in run 1 and the merchant Accept tap in customer-cancels in run 2, see #139); fix scenario 11 (tap `sbp:remove` at the grocery substitution question, then expect `cur:USD`); 39.1 CI cuts; 39.2 delivery area + OSM re-run; 39.3 public listings and "Ask them to join"; import 04 owner menus; merge the Nayeh duplicate; e2e 11/11 |
| F | Menu harvest and the boundary | Opus 5.5, high | apply the 39.2 boundary (correct E's place list, landmarks for every delivered-to place); 39.4 sources 2 and 3 (adapters, `menu-harvest` workflow, photo classification and extraction once credit exists); 39.5 Open Food Facts |
| W | Website revamp | Opus 5.5, high | 39.11: design system, customer/merchant split, delivery map, every public page, app and dashboard restyle; website-quality checks (§37.5) |
| 5c | Agents | Opus 5.5, high | §38.3 rows for 5c, 39.6 including customer memory, 39.7 including merchant memory |
| 5b | Kapso and operations | Sonnet 5.5, high | §38.5 row 5b plus 39.8 |
| 13 | Security review | Opus 5.5, high | unchanged |
| W2 | Website audit and polish | Opus 5.5, high | moved by Rasheed (15 October) to just before go-live: WhatsApp icons and "Order on WhatsApp" on every customer page and call to action; make it obvious there is no app to download (ordering is WhatsApp only); clearer, more attractive heroes; audit every public, merchant and staff page (copy in three languages, links, empty states, mobile, the website-quality checks of §37.5) and fix what it finds |
| 5d | Meta catalogue and native cart | Opus 5.5, high | 39.12 on the US test number: catalogue synced from the database, single- and multi-product messages, the cart icon, the inbound `order` message re-priced into the normal checkout, catalogue or list per shop; e2e green on staging |
| 14 | Pilot cut-over | Opus 5.5, high | unchanged |

**Superseded on 16 October by §39.15.8 (5f → 5g → friends' test → 13 → 14; W2 joins 5g).** Earlier order from 15 October: 5b → 5d → 13 → W2 → 14 (5d added by Rasheed on 15 October). W2 runs after the security review so its fixes are the last change before the cut-over, and before 14 so the cut-over ships the polished site.

### 39.11 Website: full revamp with a delivery map and a hard customer/merchant split
- **Rasheed's direction (14 October):** the current site looks unfinished; the "where we deliver" page in village blocks is the example. Every page must look like a well-funded 2030 product, building on §37.
- **Hard split:** customers and merchants never share pages, navigation or FAQs; the customer home page keeps one link, "For businesses", to `/business`, and the merchant calculator (§37.3 item 5) moves there. Customer side: home, search, places and the delivery map, shops and menus, ordering on WhatsApp, Send Home, help for customers. Merchant side under its own section (for example `/business`): join or claim, pricing and terms, the dashboard, help for merchants. Each side has its own FAQ.
- **"Where we deliver":** an interactive map of the 39.2 zone with the villages, shops per village and the "Not on Alo King yet" shops; search by village name in four languages.
- **Scope:** redesign every public page and restyle the app and dashboard in the same design system; keep the working logic, data calls and tests.

### 39.12 Meta catalogue and the native WhatsApp cart, built now (Rasheed's decision, 15 October)
- **Overrides** 39.8 "No Meta product catalogue in the pilot" and the cut-over deferral in §30.1 item 2. The catalogue and the native cart are built now on the US test number (phone_number_id `1378974041965966`, WABA `1086076707594153`, portfolio "Memo Tiles") so they can be tested in full; the company portfolio (#73) takes them over at the cut-over (session 14).
- **The server stays the source of truth.** The catalogue is a synced mirror of the database. Every cart is re-priced by the server before confirmation; a catalogue price is never charged, and a difference is shown to the customer before checkout.
- **Catalogue:** one Meta catalogue for the WABA, one product set per shop. The product id (`retailer_id`) is our menu item id; name, description, price (USD), image and availability come from the database. Sync on every menu, price, availability or stock change, plus a nightly full sync. Draft and unconfirmed items never sync; an item that leaves the menu is hidden, not deleted. The catalogue is created and connected to the WABA and the number by API (Kapso or the Graph API); a step only Commerce Manager can do becomes an `owner` issue with exact click steps (§25) while the rest is built.
- **Native cart:** single-product and multi-product messages (at most 30 items in 10 sections) chosen by the agent: a shop's best sellers, search results, a section. The cart and catalogue icons are turned on for the number. The inbound `order` message is mapped to our menu, re-priced by the server, differences shown, then the normal checkout runs (address confirmation, the checkout Flow, payment choice). Cart and button taps build **one** basket.
- **Smart menu:** list messages stay the fallback and the menu for shops with more than 30 items; the agent picks a catalogue message or a list per shop.
- **Kill-gate** of §30.1 item 2 still applies (50% of opened carts sent within 10 minutes over 200 opens).
- **Demo mode on staging (Rasheed, 15 October):** investors use the whole customer experience on real Shouf shops instead of Alo Test Grill.
  - **Which shops:** config `demo_shops` (a dated row) lists every real shop on staging whose draft menu has at least one priced item. That was 27 on 15 October, Eatout included, and the list grows as menus are added. The staging fixture `supabase/test-fixtures/demo-shops.sql` computes it on every deploy.
  - **What they get:** these shops are claimed, orderable and listed on staging, so they appear in search, the smart list menu and the catalogue, and they sync to the Meta catalogue with photos.
  - **Menus:** each menu is the seed draft. LBP prices are converted at the dated rate, exactly as a merchant's approval converts them. Deli Dough (350 items) and J.O'S (52) use their full harvested menu instead of the short curated draft.
  - **Shops without a priced menu** keep the "Not on Alo King yet" listing (39.3).
  - **Routing:** every order to a demo shop goes to Rasheed's number (`app_private.owner_phones`) as the merchant: the card, accept and reject, the copilot. A database guard on `outbound_messages` reroutes any WhatsApp message or call for a demo shop that would reach anyone but the customer, a gift's recipient, an owner or a simulator number. A shop's own number is never used. The merchant's card carries a "Demo" line; customers see none.
  - **Visibility:** simulated customers see demo shops only when a scenario opts them in (`sim_demo`). Real customers who are not owners do not see the test shops while demo mode is on.
  - **Photos:** every catalogue product has an image of its own item (`menu_item_photos`, never a shop or Google place photo, §38.1). That is the shop's own website photo where its menu had one (Fred's Food), else one drawn illustration per item, labelled "Illustration", stored with `source = illustrative` and removed when the shop is claimed.
  - **Staging-only side effects, accepted:** demo orders leave ratings and ledger rows on real-named shops on staging; the weekly and reactivation merchant messages of every demo shop go to Rasheed; a corrected seed draft reaches a demo shop's menu only after the shop leaves demo mode (the Shouf load updates drafts of unclaimed shops only). A shop that leaves demo mode loses its demo menu (when it never had an order) and its illustrative and website photos.
  - **Not done:** AI-generated photos need paid image credits (the connected image service has none), an owner decision under §25.
  - **Flows:** business verification is deferred to the SARL (Rasheed, 15 October, #182). The chat steps stay the address and checkout path, and Flow publishing is not retried.
  - **Cut-over (session 14):**
    - production never runs the demo fixture and must show `demo_shops` empty and no illustrative photos;
    - the test catalogue is cleared;
    - the production catalogue syncs only claimed shops whose merchant confirmed the menu.

### 39.13 World-class shopping on WhatsApp for the investor demo (Rasheed, 16 October; session 5e)
- **Verdict on the old state:** the catalogue screen in the chat header showed 1,755 products from 29 shops in one flat list with drawn placeholder pictures. Unusable.
- ~~**The catalogue header icon is switched off; the cart stays on.**~~ **Reversed by Rasheed on 16 October, 12:06 (§39.15.2): the header catalogue icon stays ON, with the cart; reversed again on 17 October (§39.15.11): icon off, cart on.** Original text kept for history: **Overrides** the §39.12 line "The cart and catalogue icons are turned on for the number".
  - Meta's WhatsApp Business Platform docs (catalogs overview, share products, commerce settings) offer no collections or product-set grouping in the catalogue a customer opens from the chat header. The only grouping is the sections of a multi-product message.
  - Our catalogue has had one product set per shop since #189, and the header still showed one flat list (Rasheed's screenshot, 16 October).
  - So the header is set to `is_catalog_visible = false` with `is_cart_enabled = true`. Product messages and the cart work without the icon (Meta: the icon is off by default).
  - `kapso-catalog` sets it. Kapso's proxy has no commerce endpoint and `META_CATALOG_TOKEN` lacks `whatsapp_business_management`, so until the owner grants that permission, an `owner` issue carries the 2-minute WhatsApp Manager steps.
- **Browsing is through the bot only** (zero model calls):
  - Order → pin → "What are you craving?": the categories that have shops delivering here (from cuisine tags, business types and the dish words of the menus: burgers, shawarma, pizza, manakish, grills, sandwiches, fried chicken, sushi, mezze, desserts, coffee, juices, bakery, grocery), then "Shops near you" with road distance and delivery fee. With fewer than 4 shops delivering (config), the shops are listed directly as before.
  - A category lists its shops with fee, distance and village.
  - A shop opens with its cover image and one line (cuisine · village · delivery fee · hours today), then its menu as one multi-product message grouped by its sections. That message holds at most 30 items in 10 sections, the best sections first (mains, then sides and sweets, drinks and dips last; best sellers first), then a list opens the rest of the sections.
  - A section opens as its own product message, 30 items at a time with "Next items".
  - Search results come back as one product message grouped by shop.
  - Every path ends in the same basket and checkout. Without a catalogue (sandbox, simulator), the list menus run as before.
- **Photos:** no drawn text tiles any more. In order of preference:
  1. The shop's own photos (`merchant_site`).
  2. Open Food Facts packshots for shelf items (by barcode, or by brand and name with a confidence check; CC BY-SA, credited).
  3. One real food photo per dish from a free library that allows commercial use (Pexels or Unsplash when their API key exists; until then Openverse restricted to CC0, the public domain mark and CC BY), matched through the dish keys of `scripts/demo/dishes.ts`, stored as `source = illustrative` with its license, credit and source, and replaced when the merchant claims the shop.
  - Every product image is at least 500×500, cropped square at 800×800, with the same treatment.
  - Each shop has a cover: its own photo, or its signature dish.
  - An item without any photo is left out of the catalogue (it stays in the list menu).
- **WhatsApp business profile of the US number**, set by API through Kapso's proxy (`kapso-profile`): the Alo King crown as profile photo, about, description, address, category and website.
  - Meta's profile has no opening-hours field; the description says each shop delivers in its own hours, shown when it is opened.
  - The website is listed only when it publicly serves the new site. Vercel's production domain still serves the 6 October build with another business's number until the cut-over, so it is never listed.
- **Outcome on staging (16 October, session 5e):**
  - **Header:** `kapso-catalog` could not set the commerce setting through Kapso (the read-back is "unverified"), so owner issue #199 carried the WhatsApp Manager steps (moot since 16 October 12:06: the icon stays on, §39.15.2). Until it is done, the header icon still opens the flat catalogue; carts from it go through `cart_merge` as before.
  - **Categories:** the craving list ranks categories by how many delivering shops serve them, and shows eight plus "More categories" when more than nine have shops, so every category is two taps away.
  - **Photos:** demo items carry 67 shop photos, 10 packshots (exact brand, variant and size only) and 1,093 dish photos (72 dish keys, CC0, Public Domain Mark or CC BY, credited). 427 items have no fitting photo and stay out of the catalogue. Every one of the 29 demo shops has a cover: its own photo, else the photo of its most common main dish that has one (the reading of "its signature dish" when that dish has no photo).
  - **Profile:** set by API (photo, about, description, address, category); no website until aloking.com serves the new site.
  - **Smoke suite:** run 38870843786 passed all 5 scenarios after the session's fixes (#205 scenarios follow the bot, #206 doorstep rule, #207 a dispatch run always sends its order cards before it ends, which the 30-second ticks made necessary).

### 39.14 The customer-experience spec is adopted (planning chat, 16 October, after session 5e)
- `docs/decisions/CUSTOMER-EXPERIENCE.md` (merged as #202) is **adopted**: every line marked **NEW** there is decided, with the overrides in its §8 and the amendments of §39.15 below. Where that file and this one disagree, this file wins.
- **Rasheed's rule 1, binding on every session:** the customer agent is never limited or weakened. The spec sets presentation, flows and the money and safety guardrails only; the agent keeps its full §39.6 scope (free text and voice in four languages, search across every shop, comparisons, memory, recommendations, support). Every button path must also be reachable by just asking once AI credit exists. Any line in any document that would narrow the agent is void.
- **Rasheed's rule 2:** design for scale. Hundreds of Shouf shops now, thousands across Lebanon later. Nothing may depend on a short shop list or a full catalogue scan per tap.
- **The four nits from PR #202's review, settled:**
  1. The file's status line reads "adopted by §39.14", not "proposal".
  2. Scenario #50: a refund to an online payment happens only where the server grants one under §20.1; the cash-order discount line follows the same eligibility.
  3. Scenario #11: the waitlist notice is one utility message the customer asked for; it is never reused for marketing, and if Meta classes it as marketing it is not sent.
  4. Scenario #36: the COD cap in the message is read from config (`cod_cap_usd`, new-customer cap per §29.4), never written in copy.
- **New dated config keys:** `late_discount_usd`, `late_threshold_min`, `discount_expiry_days`, `tip_amounts_usd`, `basket_keep_hours`, plus the keys of §39.15.

### 39.15 After session 5e and the 16 October live test: the decisions (planning chat, 16 October, 12:30)
**What was reviewed:** session 5e's report and PRs #196–#210; Rasheed's screen recording (11:42–11:46 Beirut, two orders attempted, from BUN BROS, Deli Dough and INDINER time) and eight screenshots; the code (`_shared/catalog.ts`, `20261016120000_photo_sources.sql`, `browse.sql`, `cart_merge`, `_shared/routing.ts`, `dispatch/customer/turn.ts`); the website (`src/`).

**Verdict.** 5e's engineering is good: browsing through the bot, real photos, the test diet and the lighter staging load all work, and taps answer fast. The experience is not yet investor-grade, for six reasons seen on the phone:
1. **Checkout dies on a routing outage.** "I couldn't work out the road route to your address" with no button; Rasheed had to type "Order" to recover. Browse screens and four smoke runs used the free OpenRouteService quota, and a quote has no fallback.
2. **The header catalogue is one flat list of 29 shops, and nothing in it says which shop an item belongs to,** so a cart built from it mixes shops. The server keeps the first shop's lines and drops the rest with "2 item(s) couldn't be added", then loops on "Use the new cart / Keep basket".
3. **Counts lie and items are unreachable.** INDINER time (122 items, 102 with photos) opened with "3 items"; its "Burgers · 9 items" row opened a product message with 1 burger. The sync treats "batch accepted" as visible and never reads Meta's review status, so Meta silently drops IDs; and items without a photo cannot be reached once a section opens as a product message.
4. **The item screen looks unfinished.** Titles mix two languages and ALL CAPS ("Sujuk & Cheese Platter · صحن سجق جبنة", "HOT DOG"); the description is a photo credit ("📷 insatiablemunch via Openverse (flickr) · CC BY 2.0"); the link is our Supabase image URL; the shop is never named.
5. **The shop cover can be off-brand** (a fried-chicken photo for a burger place) and carries the photo credit in the caption.
6. **The website cannot take an order:** `VITE_WHATSAPP_NUMBER` is empty, so every "Order on WhatsApp" goes to "our number is going live soon"; there is no public URL for the site (`aloking.com` is not owned, see 39.15.7).

#### 39.15.1 Routing never blocks an order (amends §3, §4 (the route cache keeps 30 days), §28.2, §28.6 and §39.2's "straight line only as the fallback"; the "no straight-line guess" rule stays)
- **Precomputed shop → place road distances.** A new table `shop_place_routes` (vendor, place, road km, minutes, provider, computed_on) holds the road distance from every orderable or demo shop to the centre point of every delivered-to place (§39.2). It is filled by a `route-matrix` GitHub workflow with ORS Matrix in batches (and the public OSRM table service when ORS refuses or its budget is short, 39.15.10; a few requests for 315 shops × 61 places), run on dispatch, when a shop's pin changes, and when the boundary row changes. It is a new table referencing places and vendors, allowed under §31.
- **Browse costs zero routing calls.** "What are you craving?", category shop lists, "Shops near you", shop headers, search grouping and the fee shown before checkout read `shop_place_routes` for the place the pin snaps to.
- **Checkout makes at most one live call** per shop and customer pin (pin rounded to about 10 m), cached in `route_cache` for 30 days (roads do not move; `route_cache_ttl_hours` becomes a dated config value of 720). The live call has a 2 s timeout.
- **Fallback, never an error:** if the live call fails, times out or the daily budget is spent, the quote uses the shop → place road distance from `shop_place_routes` for the pin's place, records `route_source = place_fallback` on the order, and the order goes through. Only when neither exists does the customer get a message, and it carries buttons (**Try again**, **Change address**, **Help**).
- **Daily budget guard:** a `routing_usage` counter per UTC day with config `ors_daily_budget` (default 400 of the free 500 matrix requests). At 60% only checkout may call ORS; at 100% checkout uses the fallback. Crossing 60% opens or updates one `owner`-labelled issue (information only).
- **Tests never call ORS.** Unit and SQL tests use fixtures. On staging, simulator numbers (`+999…`) get routes from a recorded fixture table (`routing_fixtures`) through config `routing_provider_sim = fixture`; only real phones reach ORS. The smoke suite therefore uses no quota.
- **Every error message in the bot carries at least one button.** A reply that ends a path without a way forward is a bug (test: every `render.ts` error string is sent with buttons).

#### 39.15.2 Native catalogue and cart: true, complete, never mixed (amends §39.12 and §39.13)
- ~~**The header catalogue icon stays ON (Rasheed, 16 October 12:06; reverses §39.13).**~~ **Reversed on 17 October (§39.15.11): icon off, cart on.** Original text kept for history (the sub-bullets below on titles and split carts still apply to product messages and the cart): Friends and investors must see everything: the whole catalogue from the chat header, the product messages and the cart. Meta's header catalogue cannot be grouped by shop (§39.13), so it is made to work as one flat list:
  - **Every title names its shop:** "<Item> · <Shop>" (e.g. "Chicken Popcorn · Safa Chicken"), because the title and price are all a customer sees in the list. The same title shows in product messages.
  - **Only Meta-approved items with a real photo** are in it (below); hidden items stay reachable through the bot.
  - **Carts from it are split by shop, never dropped** (next bullet), and a shop that does not deliver to the confirmed pin is named in the split with "doesn't deliver to <place>" and the closest shop with the same dish offered.
  - ~~`kapso-catalog` sets `is_catalog_visible = true` and `is_cart_enabled = true` and reads them back; issue #199 is closed as not needed. The owner-issue text in `scripts/kapso/catalog-owner-issue.sh` (step 4, "switch on the catalogue icon and Add to cart") is correct and stays.~~ Superseded by §39.15.11 (icon off, cart on).
- **A cart from several shops is split, never dropped.** "Your cart has items from 3 shops. One order comes from one shop. Which one first?" with one row per shop (items and subtotal). The others are kept as **saved carts** for `basket_keep_hours`; after the first order is confirmed: "You also picked 2 items from Deli Dough. Order them now?" Only items truly unavailable are named, by name. This replaces the "couldn't be added" message and the replace/keep loop: when a cart from shop B meets a basket from shop A, the buttons are **Switch to B**, **Keep A**, **Do both** (A first, B saved).
- **Meta's review status is the truth.** The sync reads each product's `review_status` and errors from the Graph API (`/{catalog}/products?fields=retailer_id,review_status,errors,visibility`) after every batch and nightly, into `catalog_item_status`. Product messages and their row counts use only items Meta has approved and that are visible. Rejected items are fixed (see 39.15.4) or left out of product messages.
- **No item is ever unreachable, and every count equals what opens.** A section opens as a product message of its approved photo items; if the section has other items, a list "More <section> (n)" follows with the rest. A shop whose approved photo items are fewer than `browse_min_catalog_items` (config, default 6) opens with the list menu plus the **Open menu** web button (§4 of the spec) instead of a thin product message. Search uses the same rule per shop.
- **Item content (applies the spec's §2 items 2–3 and §5):**
  - Title: "<Item> · <Shop>"; the item part in one language, Title Case, never ALL CAPS, size once, the shop's Latin name for the item if it has one, else English. The Arabic name moves to the description.
  - Description, in this order, each on its own line: shop · village; Arabic name; what it is (the menu text, else "Usually made with …" from the dish library); "≈ 520 kcal · 32 g protein (estimated)" where the dish library has it (§32.3); allergens only when merchant-declared, else nothing (never "safe"); "Extras chosen after you add it" when the item has options.
  - **No photo credits in descriptions or captions.** Credits for CC BY photos live on the item's web page and a `/credits` page (a reasonable manner of attribution for CC BY). New picks prefer CC0, public domain and Pexels (Pexels needs no credit; owner item: a free Pexels API key).
  - `link` = the item's public page `<public_site_url>/<lang>/i/<item id>` (39.15.7), never an image or Supabase URL. `image_link` stays the image route. `brand` = shop name.
- **Shop cover** = the shop's own photo, else the photo of its most-ordered main from **its main category** (a burger place shows a burger). Captions never carry credits.
- **Product carousel messages** (up to 10 product cards, swipeable; verified on the US number before use) are used for "Popular near you" after the craving list and for one "Goes well with" after a cart arrives (the one chat upsell per order, §29.3).
- **INDINER time and every demo shop** are checked after the fix: approved items per shop, items per section and what opens, listed in the session's PR.

#### 39.15.3 Testers anywhere in the world (Rasheed, 16 October: friends outside the Shouf must live the whole experience)
- **Joining:** Rasheed sends friends one link, `wa.me/12036602328?text=<code>`. The code is config `demo_invite_code` (dated). The first message carrying it enrols the number as a **demo tester** for `demo_tester_days` (default 14), up to `demo_tester_max` (default 30). Rasheed can remove one with the admin command `tester remove +…`. No other step for anyone.
- **What a tester sees first:** "You're testing Alo King. Orders are pretend: nothing is cooked, delivered or paid." Then the normal welcome. Testers see the demo shops (extends §39.12 visibility).
- **Address:** the tester shares a pin as normal. A pin outside the boundary gets: "You're outside our delivery area. For this test, pick a demo address:" with three buttons, **Baakleen**, **Deir el Qamar**, **Beiteddine** (fixed points in `demo_addresses` config). Fees and distances are real, read from `shop_place_routes` (zero ORS calls). The tester's real pin is not stored.
- **The shop side plays itself:** Rasheed still gets each tester order card. If no one taps within `demo_autopilot_after_s` (default 60), the **demo autopilot** accepts with a 15-minute prep, then marks ready, out for delivery and delivered at `demo_autopilot_step_s` intervals (default 60), so a tester sees every status message, the delivery code, Received, tip and rating alone. A tap by Rasheed at any point takes over. Autopilot works only for demo testers and owners, only on staging; the cut-over checklist asserts it is off.
- **Demo data stays separate:** tester orders, ratings and ledger rows carry `is_demo = true`, are never shown publicly and never count in shop metrics.
- Real non-tester customers outside the boundary keep the real rule: "We don't deliver to <place> yet." with **Tell me when you do** (waitlist, spec #11) and **Pick up instead** where a shop is in range.

#### 39.15.4 Catalogue rules the merchant agent learns (Rasheed, 16 October)
- **One validator** `validateCatalogItem()` used by the sync, the demo photo pipeline and the merchant copilot (§39.7) before an item or photo is saved. It checks: image at least 500×500, square crop possible, https, no text overlay, watermark, collage or placeholder; title rules (39.15.2); price above zero; description without phone numbers, URLs or promotional text; Meta's commerce policy categories (no medicine §38.3, no alcohol or tobacco products in the catalogue).
- **Rules live in data:** table `catalog_rules` (code, plain rule in four languages, source `meta_published` or `learned`, first seen, count) and `docs/catalog/META-CATALOG-RULES.md` generated from it.
- **Learning loop:** the nightly status read (39.15.2) records every Meta rejection reason. An unseen reason becomes a `learned` rule automatically, with its example item; the next build session reviews learned rules. Target: zero rejected among synced items.
- **The merchant hears it before Meta does:** when a merchant adds an item or photo, the copilot runs the validator and says what Meta would reject and how to fix it, in the merchant's language ("This photo has writing on it, so WhatsApp will refuse it. Send a photo of the dish only."). Nothing is uploaded until it passes.

#### 39.15.5 Website: the audit moves forward and joins the web menu (amends §39.10 W2 and §39.11)
Session **5g** (below) builds the web menu and Explore (spec §4, handoff prompt C) and does the full W2 audit in the same design system. Rasheed's list (16 October), decided:
- **WhatsApp everywhere:** every customer call to action uses the official WhatsApp glyph, white on WhatsApp green (#25D366) for the main "Order on WhatsApp" button (instant recognition beats palette purity on this one button); secondary links keep the brand palette. `VITE_WHATSAPP_NUMBER` points to the US test number until the cut-over, then the Lebanese customer number.
- **Payments:** "Cash on delivery, in dollars or lira" with simple cash icons; the Whish logo shown with a "Soon" chip until online payment is live (§20.1). Never claim Whish works before it does.
- **Every village we deliver to:** a plain, always-visible list of every boundary place (61 today) (grouped by area, in AR/EN/FR) on `/places`, plus a footer link "Where we deliver", alongside the map. The list no longer depends on places being live.
- **No "Arabizi" anywhere a customer reads** (Lebanese people don't use the word). EN: "Arabic, English or French, the way you text, even mixed." AR: "بالعربي، بالإنكليزي أو بالفرنسي، متل ما بتكتب عالواتساب، حتى لو خلطتهم." FR: "En arabe, anglais ou français, comme vous écrivez, même mélangés." The example "2 shawarma w pepsi" stays, labelled "The way you text". Also fix "Three languages" titles that list four, and the hero points.
- **Looks Lebanese:** Lebanese dialect first in Arabic copy; real Shouf village names; prices in $ and LBP; the Chouf contours kept; the old Lebanese cement-tile (ballat) pattern as a quiet section motif; real food photos from the Shouf shops (own photos first). No cedar clichés, no stock people.
- **Merchant journey, reachable everywhere:** "For businesses" in the customer header and footer (overrides the "one link at the foot of the home page" choice; the customer and merchant sides stay separate, §39.11). One name everywhere: "For businesses" / "لأصحاب المحلات" / "Pour les commerces". A business contact page; claim and register end there; "Forgot password" on the dashboard sign-in; the fee headline never renders without its number; the contact page's merchant block rendered.
- **Quality bar** unchanged (§37.5): Lighthouse mobile ≥ 90, axe clean, AR/EN/FR at 360 px and desktop, screenshots in the PR.
- The W2 slot before go-live becomes a short final check inside session 14's checklist.

#### 39.15.6 Speed (measured, not assumed)
Each session reports p50/p95 tap-to-reply from `outbound_messages` for the demo path. Target unchanged (§4): button p50 under 700 ms, p95 under 1.5 s. Meta's own product-sheet loading (about 1 s skeleton in the recording) is outside our control.

#### 39.15.7 A public address for the site (owner and build)
- `aloking.com` is **not owned**: GoDaddy lists it as a premium resale and Vercel's registrar refuses it (checked 16 October). Decision: buy **`alo-king.com`** (standard price, about $10 a year at Cloudflare Registrar) now; `aloking.com` is reconsidered only if its resale price is under $100. Every link the system builds reads one dated config value, `public_site_url`, so switching domains is one row.
- Until the domain is attached, session 5f makes the `rebuild/lebanon` site public: Vercel's production branch becomes `rebuild/lebanon` and the production domain `alo-king.vercel.app` (or the nearest free name), checked to answer 200 without a Vercel login. This replaces the 6 October build that still shows another business's number. Supabase production still does not exist; the site reads staging. Vercel stays on Hobby until the pilot (§2).
- `kapso-profile` then lists that website on the WhatsApp profile.

#### 39.15.8 Session plan from here (replaces the order in §39.10)
| # | Session | Model | Effort | Content |
|---|---|---|---|---|
| 5f | WhatsApp ordering, investor-grade | Opus 5.5 | Extra (xhigh) | 39.14; 39.15.1–39.15.4, 39.15.6–39.15.7, 39.15.9 when the keys work; spec §§2, 3 (the 5f scenarios), 5, 6 in chat; item page `/i/<id>` |
| 5g | Web menu, Explore and the website audit | Opus 5.5 | Extra (xhigh) | spec §4 web menu with signed basket links, Explore, item page polish, 39.15.5 in full, 39.15.11 (header icon off, ice breakers and commands) |
| — | Friends' test | owner | — | after 5g: Rasheed sends the invite link (39.15.3) |
| 13 | Security review | Opus 5.5 | high | unchanged, includes 5f and 5g |
| 14 | Pilot cut-over | Opus 5.5 | high | unchanged, plus the final website check and the autopilot/tester assertions |

Max effort is not needed: the work is broad, not deep, and Extra keeps the weekly limit for 5g.

#### 39.15.9 AI and voice switch on as soon as the credit lands (Rasheed, 16 October 12:06)
- Rasheed adds Anthropic and OpenAI API credit (and the Deepgram key) so friends can type and send voice notes. The agents are built and tested with recorded answers (session 5c, #164, #166); their model paths are switched off only for lack of credit (§32.7).
- **The session that finds the keys working** (`check-setup` proves each one) runs the text eval (four languages, §39.6) and the voice pipeline on the labelled notes (§32.4), and then:
  - switches on free text, voice notes, photo understanding and the merchant copilot's model path for **owners and demo testers** as soon as the evals show **zero safety failures** (no invented item, price, fee or policy; no cross-shop basket; no allergy called safe). Accuracy is not the gate for testers, because every order ends in the basket and Confirm (§32.4);
  - switches them on for **every customer** when the §32.4 accuracy targets are met (that gate stays for the pilot);
  - updates `usage.ts` prices first, sets the cheapest passing model in config (Haiku 5.5 vs 4.5, §38.4), and keeps the per-turn caps (§4).
- Until the keys work, free text and voice keep answering with buttons, never silence (§32.7).

#### 39.15.10 Outcome on staging (17 October, session 5f)
- **Routing (39.15.1):** built as decided. Browse makes zero routing calls (the exact cached route, the doorstep, else `shop_place_routes`); checkout makes at most one live ORS call (none for a doorstep pin) with the place distance as its fallback; the daily budget is 400, and from 240 (60%) only checkout may call ORS, so 160 are kept for checkout; simulator numbers read `routing_fixtures`.
  - The first `route-matrix` run (16 October) got 403 on every request (the day's ORS quota was spent), so the shop → place distances also come from the public OSRM table service when ORS refuses or its budget is short (#216; amends the "ORS" wording of §3, §28.6 and 39.15.1 for these distances only).
  - **OSRM is used only by batch jobs, never while a customer is ordering:** `route-matrix` and, as before 5f, `area-data`. No edge function and no site code calls it; checkout's live call is ORS only.
  - The cut-over replaces OSRM in `route-matrix` with a second ORS key or ORS's paid plan (FOSSGIS's server is for reasonable non-commercial use, with no uptime guarantee).
- **Meta's review status (39.15.2):** Meta returned an empty `review_status` for every product (the first sweep, 16 October: 1,701 products). It is read through visibility and errors and fails safe (#215): published with its errors read and none left is approved; a refusal is rejected; anything else (an unknown error, no visibility, errors not read) waits in the list; stock is checked separately for showing.
- **Catalogue icon (39.15.2):** on. `kapso-catalog` sets the cart and the icon on and reads them back; #199 is closed. The header catalogue is one flat list of every shop's approved photo items, titled "<Item> · <Shop>"; a cart from it is split by shop, never dropped.
- **Item links:** they wait for `public_site_url`, which is set once the site is public (owner issue #214); until then products link to the image route, and a CC BY photo keeps its credit in the description and in the shop cover's caption (a temporary exception to 39.15.2's "no photo credits in descriptions or captions", which ends when the address is set).
- **Testers (39.15.3) and catalogue rules (39.15.4):** built as decided. The medicine rule (§38.3) knows medicine words in Arabic, English, French and Arabizi, for customers and for the catalogue; a food claim such as "antibiotic-free chicken" is not a medicine.
- **AI and voice (39.15.9):** not switched on. The Anthropic API answers "credit balance is too low" (evals run 38891335576, 16 October), the OpenAI key is refused (#77) and no Deepgram key is set.
- **Speed (39.15.6):** taps on staging p50 0.77 s / p95 3.28 s (16 October) and p50 0.75 s / p95 1.21 s (17 October, the smoke runs), against the §4 target (p50 0.7 s, p95 1.5 s): p50 above it on both days, p95 above it on 16 October and within it on 17 October (22 taps); the slow paths are the address save, the shop menu with its catalogue message and the cart (HANDOFF, session 5f).
- **Smoke suite:** run 38989125628 passed all 5 scenarios after #225 (the scenarios answer the change question; browse applies the doorstep rule), on recorded routes with no ORS request; the day's first run (38985321196) passed 0 of 5 on those two causes.

#### 39.15.11 Customers shop by place and shop; the header catalogue icon goes off now (Rasheed, 17 October 09:05 and 09:09 Beirut)
- **Why:** Meta's header catalogue is one flat list of every product in the connected catalogue, with no grouping we can rely on and no knowledge of where the customer is. With 2,000+ vendors and tens of thousands of items across Lebanon it would mix shops 100 km apart in one endless list. Rasheed wants his friends and investors to test the finished product, not a demo shortcut, so the scale design applies **now**.
- **Rule:** the header catalogue icon is **off** (`is_catalog_visible = false`, `is_cart_enabled = true`), from session 5g on staging and on the production number at the cut-over. This reverses §39.15.2's "stays ON" (16 October 12:06). `kapso-catalog` sets it and reads it back; if Meta refuses through our token, an `owner` issue carries the 2-minute WhatsApp Manager steps (Account tools → Catalogue → switch off "Show catalogue icon in chat header", keep "Add to cart" on). The native cart stays on: product messages fill it.
- **How customers shop (every view is filtered, so it works for 10 shops or 10,000):**
  1. **The bot, location first:** pin → "What are you craving?" (only categories with shops delivering to that pin) → shops near you → one shop → its sections as product messages, 30 items at a time (§39.13, §39.15.2). Search returns one product message grouped by shop, delivering shops only.
  2. **Explore and the shop menu on the web**, opened from chat buttons (spec §4, session 5g): the Toters-style home and full menus inside WhatsApp's own browser, filtered to the customer's pin.
  3. **Always one tap away:** WhatsApp conversational components on the number: ice breakers ("Order food", "Explore shops near me", "My orders", "Talk to a person") and commands (`/order`, `/explore`, `/orders`, `/help`), set by API where Meta allows; each answers through the same deterministic paths.
- **The customer agent is not narrowed (§39.14 rule 1):** these are the button and browse paths. The agent keeps its full §39.6 scope; free text and voice reach every path, and a customer who names a shop that does not deliver to the pin gets "doesn't deliver to <place>" plus the closest alternative (§39.15.2), never silence.
- **Code that changes in 5g:** `scripts/kapso/catalog.ts` (the commerce setting and its read-back) and step 4 of `scripts/kapso/catalog-owner-issue.sh`. Meta's limits for conversational components (at most 4 ice breakers of up to 80 characters, command names and descriptions) go into `supabase/functions/_shared/meta-limits.ts` and its test. Meta gives a number one set, so the ice breakers and commands are written in English, the language every tester reads, and each answers in the customer's language.
- The catalogue itself keeps every approved item (product messages need them); only the header icon is off.
- **Item-name clean-up** (titles with a missing item part, stray leading punctuation) is deferred by Rasheed to a later session; photo-to-item mismatches are still fixed in 5g, because product messages show them.

#### 39.15.12 Outcome on staging (17 October, session 5g)
- **Web menu and Explore (spec §4):** built as decided. Open menu and Explore in the chat open `/<lang>/m/<slug>` and `/<lang>/e` with a signed link (`web_link_create`: a 24-character token bound to the customer, 24 h in dated config, only its hash stored); the pages never show the phone, the address or the pin. Every amount comes from the server: Continue in WhatsApp sends item ids and quantities only, `web_basket_save` prices each line from the menu (#228, #230). Explore lists only shops that deliver to the customer's place (zero routing calls) and answers "outside" for a place we do not deliver to.
- **Website audit (39.15.5):** built as decided (#234): WhatsApp-green Order with ink text (9.3:1; white on #25D366 fails AA), cash in $ or LBP and Whish as a neutral wordmark with Soon, all 61 villages grouped by area, no "Arabizi" in customer copy, For businesses in the header and footer with `/<lang>/business/contact`, Forgot password on the staff sign-in. Pages are checked at 360 px.
- **Header catalogue icon off, cart on (39.15.11):** `kapso-catalog` and `kapso-profile` set them and the ice breakers and commands by API; Meta refused both through our token, so they are owner issues #236 (icon, 2 minutes in WhatsApp Manager) and #237 (ice breakers and commands). The bot answers each ice breaker and command through its deterministic paths either way.
- **Testers anywhere (39.15.3):** Change address and the "no shop delivers here" card offer the demo addresses to testers and owners, never "we don't deliver to you" (#232).
- **The friends' path on the simulator (#239):** scenario 31 walks it from a Dubai, a Riyadh and a Beirut pin: the demo address, the craving list, Popular near you and Explore, a shop from the website, Open menu, the web menu, Continue in WhatsApp, checkout, and the demo autopilot to delivered. Its first run found that a pin's turn never showed Explore (the turn's three messages were full); #240 puts "Address saved" in the craving list's first line. Run 39029332105 then passed: three demo orders of $14.00, each delivered about 4 minutes after it was placed.
- **Speed (39.15.6):** #238 reads the checkout in one call, the search point once per turn and the shop menu's parts side by side. The same five smoke scenarios, before (5f, 01:02 UTC) and after (11:10 UTC, warm): address save p50 2.39 → 1.87 s, p95 2.90 → 2.62 s; native cart p50 1.63 → 0.88 s, p95 1.75 → 1.07 s; taps p50 0.89 → 0.82 s, p95 1.77 → 1.64 s (49 taps each). Carts meet the target (p50 0.7 s, p95 1.5 s); taps and the address save do not yet. The address save now also creates the Explore and menu links.
- **Public site (39.15.7):** live at `https://alo-king.vercel.app` (`public_site_url` set, the catalogue re-synced with item links and no photo credits, #214 closed). **Vercel's production does not follow `rebuild/lebanon`:** each merge makes a preview, and the session promotes the newest `rebuild/lebanon` build to production by hand (owner issue #233 has the setting). This corrects the 5f note that production tracks the branch.
- **AI and voice (39.15.9):** still off. The Anthropic key cannot run models (credit balance too low), the OpenAI key is refused (#77) and no Deepgram key is set.

#### 39.15.13 The Alo King app lives inside WhatsApp: native screens, no website for customers (Rasheed, 17 October 18:24)
- **Rasheed's verdict:** customers must not be sent to a website. He wants a catalogue that feels like an application, inside WhatsApp. **This reverses the header-icon part of §39.15.11 and demotes the web menu and Explore of §39.15.5 / session 5g for customers.**
- **What WhatsApp can and cannot do (checked 17 October):**
  - The header catalogue (chat-header icon) is one flat list of the whole catalogue; Meta offers no grouping by shop or category in it for our catalogue.
  - Product messages are native WhatsApp screens: a shop's items with photos in up to 10 sections, Add to cart, the native cart. Product carousels: up to 10 swipeable product cards.
  - **WhatsApp Flows are native full-screen pages inside WhatsApp, not a browser.** Since Flow JSON 6.2 (December 2024) a NavigationList item shows text, an image and tags; radio, checkbox and dropdown options can show images (Flow JSON 5.0); a data endpoint serves live data per screen (payloads up to 10 MB, list images up to 100 KB). This is the "app inside WhatsApp".
- **Decision: the Alo King app is a dynamic WhatsApp Flow**, served live from our database through a data endpoint (an edge function in Frankfurt; amends §12's "static Flows only"):
  1. **Home:** search, "What are you craving?" categories with images, Popular near you, open-now shops near the confirmed pin.
  2. **Shops:** cover image, cuisine · village, fee, time, open until; only shops delivering to the pin (testers: their demo address, §39.15.3).
  3. **Shop page:** its sections, then items with photo, name, price; items without a photo as clean rows.
  4. **Item page:** photo, description, Arabic name, required choices, add-ons with prices, a note, quantity, Goes well with, estimated nutrition, declared allergens only.
  5. **Basket:** lines, notes, subtotal and fee; Confirm closes the Flow and the chat sends the §3.6 summary with Confirm / Change. The server prices everything (product rules); a Flow never carries a price the server didn't compute.
  - Every screen is fetched for the customer's place, so it works for 10 shops or 10,000. Opened from the chat's **Order** / **Explore** buttons, the ice breakers and `/order`, `/explore`.
  - Only claimed, orderable shops (and demo shops for testers and owners) appear in the Flow; unclaimed vendors never do (§39.3).
  - **The data endpoint** (`flow-app` edge function): every request is decrypted and checked with the Flow key pair, whose private key is a Supabase secret only; `verify_jwt = false`, listed in `supabase/functions-deploy.txt`, its URL pinned with `?forceFunctionRegion=eu-central-1`; the `flow_token` is signed, expiring and bound to the customer's phone and basket, so no one can read another customer's place or basket; it answers synchronously within Meta's timeout (the one exception to "fast 200 then queue"); Confirm is stored with the Flow version and handled deterministically (zero model calls).
  - §12's kill-gate and text fallback apply: the native chat path is the app Flow's fallback.
- **Blocker: Meta business verification (#182).** Meta refuses to publish Flows on an unverified business (422 "Integrity requirements not met", §39.8). The Flow is built and tested now (Flowso emulator, drafts on the number, the simulator) and switches on by itself the day the business is verified.
- **Until then (and as the fallback forever):**
  - **The header catalogue icon stays ON** (reverses §39.15.11's "off now"; owner issue #236 is closed as not wanted). It is switched off only once the Flow app is live **and** the catalogue passes `header_catalog_max_items` (a new dated config value).
  - **The native chat path is the primary path:** pin → craving list → shops → the shop's product messages and native cart, all inside WhatsApp.
  - **No website for customers:** the bot no longer offers Explore after a pin and no longer leads with "Open menu". The web menu stays only as a last-resort row ("Full menu") in a shop's section list when some of its items cannot be shown natively (no approved photo); it disappears for a shop once the Flow app is live. The website remains for search engines, merchants and Send Home senders.

#### 39.15.14 Outcome on staging (17 October, session 5h)
- **Native first (§39.15.13):** done (#243).
  - `kapso-catalog` sets the header catalogue icon on, with the cart, and reads both back; #236 is closed as not wanted.
  - A shop opens with its cover and its product messages; nothing leads with Open menu, and nothing offers Explore after a pin.
  - The web menu is only a last "Full menu" row in a shop's section list when some of its items cannot be shown natively.
  - `/explore` and the "Explore shops near me" ice breaker answer in the chat: shops near you, then Popular near you as a product carousel.
- **The Alo King app Flow (§39.15.13):** built and tested (#244, #246); drafts on the US number; not published.
  - Flow JSON 7.3, data API 3.0: Home, Search, Shops, Shop, List, Item and Basket, in Arabic and English.
  - Served by the `flow-app` edge function (eu-central-1) through Kapso's data-endpoint function. Kapso decrypts; the function forwards each request signed with a proxy key.
  - The Flow token is signed, expires (`flow_app_token_hours`) and is bound to the customer. Every price is the server's.
  - Lists stay within Meta's NavigationList limits and page at 19 rows plus More. List pictures (144 px) and item photos (600 px, under 95 KB) are made ahead in the staging deploy.
  - Zero routing calls: scenario 32 checks `routing_usage`.
  - Flowso validates both languages and replays their scenarios against the endpoint logic in CI. `flow-screens` takes the screenshots from Flowso's preview against staging.
  - **Publish refused:** whatsapp-flows run 39055910617 (17 October) got 422 "Integrity requirements not met." for every Flow (#182, business verification). The drafts are kept and the endpoint is registered with its secrets (run 39057981143).
  - **Switching on:** `flow_app_live` stays false. The day a run with `publish` gets both app languages published, the workflow sets it, and the bot then opens the app from Order, Explore, the ice breakers and the commands (§12 kill-gate). Until then, and as its fallback, the native chat path.
- **No website for customers, also at delivery:** the on-the-way message no longer links the tracking page; it links the driver's WhatsApp chat, or is text (#246). Scenario 31 checks that no `cta_url` reaches a friend.
- **AI and voice (39.15.9):** still off.
  - `check-setup` (run 39052441464) found the Anthropic key valid and Deepgram valid; the OpenAI key is set but unproven (#77).
  - The evals (run 39052494658) could not run: Anthropic answered 400 "credit balance is too low", and the voice eval has no labels.
  - Nothing was switched on and `usage.ts` prices are unchanged.
- **Speed (39.15.6):** #245 makes the shop list after a pin one call (`browse_delivering`), stops `address_card` from looking the place up twice, and skips `flow_open` while a Flow is off.
  - bot_turns on staging, before (11:00 to 12:00 UTC, the smoke and friends' runs) and after the deploy (18:25 to 18:45 UTC, the same runs):
    - taps: p50 0.93 → 0.86 s, p95 2.37 → 1.47 s (114 and 65 taps);
    - pins (address save and the shops): p50 1.85 → 1.23 s, p95 3.25 → 2.70 s (16 and 10).
  - Tap p95 meets the target (p50 0.7 s, p95 1.5 s); tap p50 and pins do not yet. The next lever is `address_save_pin` itself (about 430 ms mean in the database) and the remaining PostgREST round trips of a pin's turn.
- **Simulator:**
  - The smoke suite passed 5/5 (run 39058286690) with no ORS request.
  - The friends' path (scenario 31, Dubai, Riyadh and Beirut pins) and the Flow app (scenario 32) first failed on the two faults fixed in #246 (run 39058284798); after #246 both passed (run 39061705977): three demo orders delivered from the Dubai, Riyadh and Beirut pins with no web link, and the app from Home to Confirm with the server's prices.

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
- Places: Rasheed's Gemini reports "Lebanese Villages and Logistics Mapping" and "Lebanon Master Geographic Gazetteer" (structure, rules and test set); OCHA/HDX COD-AB Lebanon (data.humdata.org/dataset/cod-ab-lbn); CAS cadastral names and P-codes (data.humdata.org/dataset/lebanon-cadastral-name-and-pcodes).
- Google: Places API policies (place_id storage, attribution), Places data fields (SKU per field), Maps Platform pricing (free monthly caps).
- Kapso docs: pricing FAQ, flows (Kapso integration, static vs dynamic, data endpoint), webhooks advanced. Flows client support and pricing: infiq.in Flows guide; Flowella (Web/Desktop rollout Dec 2025). GoDaddy availability check for aloking.com.
- Anthropic: models overview (platform.claude.com/docs/en/models/overview); Claude Code cloud sessions, auto-fix and projects (code.claude.com/docs).
- 7 October: Tap Payments Lebanon page (payment links over WhatsApp, payouts to Lebanese banks); Whish fees page (payment links 3%, international card 3%, corporate account balance limit USD 30,000); Wakilni delivery page (24-72 h, $6-$15+); BdL Decision 13790 of January 2026 (EPSP licensing framework, five service categories); BdL card-fee circulars reported 10 September 2026 (0.9%-1.2% merchant commission cap in essential sectors).
- 7 October 12:45: XStak 'best POS software in Lebanon' (June 2026: Omega POS, Hamster POS, XStak, BIM POS); Deliverect help centre (connects delivery channels to restaurant POS).
- 7 October 14:50: ActiveCampaign help centre, "Unsupported message types with WhatsApp API" (live location not supported inbound); confirmed on the Kapso sandbox in session 4 (§27.1).
- 14 October: Vals AI model page for Claude Haiku 5.5 (released 7 October 2026, $0.10/$0.50 per M tokens); Al-Modon, 2 June 2026, Order of Pharmacists pursuing pharmacies selling through delivery apps; Deepgram Nova-3 Arabic page (ar-LB, keyterm prompting); DoubleTick guide to WhatsApp error 131056 (pair rate limit).
