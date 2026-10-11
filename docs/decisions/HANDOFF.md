# Handoff — 11 October 2026 (after session 3)

**Read first:** `docs/decisions/DECISIONS.md` (in the project: `claude/DECISIONS-LEBANON-REBUILD-2026-10.md`). It is final and overrides everything else.

## State
- **Decisions:** sections 0–30 are complete (§29 audit verdicts and §30 second-round reports added 9–11 October). Phase 0 is GO.
- **Repo:** `rashidhamzy-hue/alo-king`, branch `rebuild/lebanon` (the default branch), private. `main` is legacy and frozen.
- **Services ready:**
  - Supabase `alo-king-staging` (`tzugbbatfbvrfzxuacqx`, eu-central-1, free plan)
  - Vercel `alo-king` (fra1)
  - Sentry projects `alo-king-functions` and `javascript-tanstackstart-react`
  - Kapso project "Alo King"
- **GitHub secrets set:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `SENTRY_AUTH_TOKEN`, `KAPSO_API_KEY`, `GOOGLE_PLACES_SERVER_KEY`. Variable: `SUPABASE_PROJECT_REF`.
- **Build sessions never ask the owner (§25).** Judgement calls go to `docs/decisions/LOG.md`, and owner-only tasks become GitHub issues labelled `owner`.

## Progress
- **Phase 0: done (7 October).** PRs #61–#66 merged automatically. CI runs typecheck, lint, tests, build, secret scan, a migration dry-run against staging and a Claude review. Guard hooks are in place. `check-setup` runs daily, which also keeps staging from pausing.
  - check-setup confirmed that the Supabase, Anthropic, Google and Kapso keys work.
  - The Sentry token is an org token: enough for releases and source maps, but it can't list projects.
  - Kapso "Alo King" has no WhatsApp number yet (#67).
  - `ORS_API_KEY` and `OPENAI_API_KEY` aren't set yet (#76, #77).
- **Session 1 (Phase 1a): done (7 October).** PRs #79 (schema core), #80 (webhook intake, review hardening) and #84 (deploy fix) merged automatically. All six migrations are applied to staging, and `whatsapp-webhook` is deployed (ACTIVE, `verify_jwt` off).
  - Schema: operators (admin/operator), customers, brands, vendors (no ratings; unclaimed never public or orderable; per-field seed provenance), `vendor_private`, `vendor_members` (owner/manager/cashier/kitchen), audit log, RLS with explicit grants on every table. Conventions are in `supabase/migrations/README.md`.
  - Dated tables seeded from DECISIONS: USD/LBP rate (89,500), VAT (11%), fee bands ($2/$3/$4.50 to 3/6/10 km), price list (§20.4), Meta message rates, config (COD cap $150 and the other §20-22 limits). The admin changes a value by inserting a newer row.
  - Ledger: append-only double-entry with the locked rate and USD and LBP on every entry; `ledger_post` and `ledger_reverse` (service role only); balance views. Phase 6 builds payments and settlement on it.
  - Webhook intake: edge function `whatsapp-webhook` (HMAC signature, fail closed without `KAPSO_WEBHOOK_SECRET`), `webhook_intake` RPC (dedupe, persist, pgmq `webhook_inbound`), `webhook_claim`/`webhook_finish` for consumers. Not yet registered in Kapso: needs the sandbox number (#67); registering it and setting the secret is done in session 3 or 4.
  - Deploy fix (#84): the function deploy list is now `supabase/functions-deploy.txt`. The CLI treated `supabase/functions/DEPLOY` as a function folder, so the deploy job failed after #80 and #82; it passed after #84. `supabase/.temp/` is git-ignored. #81 was closed: it was cut from #80's pre-squash commits.
  - CI now also runs every migration plus `supabase/tests` (RLS as each role, ledger, dated tables, intake; 159 checks) on a throwaway Supabase Postgres, and `deno check` on deployed functions.
  - Review hardening (from #79's Claude review): no backdated dated rows through the API, strict ledger idempotency and 4-decimal amounts, audited customer consent, invoker-only public lookups (Supabase security advisor clean).
  - Open for later sessions: `orders` FK on the ledger (Phase 2); radius checks in session 2 use `least(delivery_radius_km, max_delivery_km())`; Sentry in edge functions with the first queue consumer (session 3); vendor coordinates are hidden from clients until a member-only read is added with the dashboard.
- **Session 2 (Phase 1b): done (7 October).** PRs #87 (places schema, categories, vendor town link), #88 (route distances, location knowledge base), #89 (places pipeline, loader, spelling-tolerant search), #91 (vendor import), #94 (places seed and build fixes, vendor import fixes, branch cleanup), #95 (vendor check fix) and #92 (vendor file) merged automatically.
  - Places on staging: 2,172 places, 1,610 cadastral zones, 26 districts, built by `places-build` (run 37667615171) from COD-AB, CAS, OSM and Copernicus GLO-30. Every place loads `off`; all 476 South and Nabatieh places are `paused` / `security`. Bakaata (under Jdeidet el-Chouf), Semqanieh, Jdeidet el-Chouf, Kfarhim, and Dawha Aramoun (under Aramoun) are present.
  - The build now fails if a §16 place is missing, a disputed "Litige" zone becomes a place (64 had), or one place appears twice within 1.5 km (32 pairs had). Six same-name pairs in one district remain, 5.5–29 km apart, as separate villages.
  - Vendors on staging: 2,044 imported (all unclaimed, not orderable, not public, each linked to a town) and 43 excluded with a reason (23 fuel stations, 11 hotels or guesthouses, 4 industrial or engineering firms incl. Sofregaz, 3 bars, 2 beach clubs). 83 brands. 78 `home_essentials` (water and gas). 1,758 vendors keep a seed phone.
  - The 19 repeated phone numbers: 14 kept as one brand (chain branches, or one business listed twice in one region with a shared name word), 4 dropped as data errors (unrelated businesses), 1 left only on excluded rows (two Coral fuel stations).
  - `data-branch-cleanup` deletes the `data/places-*` branches places-build leaves (daily after 3 days, or all on dispatch); all were deleted after #94.
  - Open for later: the Chouf Bakaata carries an OSM alias "بقعاتة عشقوت" that belongs to Baqaata Achqout (Keserwan); the 14 kept shared phones are listed in the vendor import report for a check at claim time.
- **Between sessions (9–11 October).** #97 (DECISIONS §29 audit verdicts, §30 second-round reports, human support, voice notes) and #98 (37 real voice notes in `evals/voice/batch-01/`) merged once the Anthropic key was replaced (#99, closed; check-setup passes, and `OPENAI_API_KEY` and `ORS_API_KEY` are now set).
  - #100 makes the Claude review resilient. It is skipped when a PR changes only `docs/` or `evals/`. When it gives no verdict (auth, credit, API outage), it blocks only changes to money, RLS, webhooks, personal data or the CI gate (`scripts/review-scope.sh`); other PRs pass with a warning comment. Renames count both paths, and a classifier error fails closed.
- **Session 3 (Phase 2): done (11 October).** PRs #101 (menus, baskets, orders, state machine, race tests), #102 (Bakaata alias) and #103 (order_channel router, four-layer escalation, portal queue, auto-pause, merchant commands) merged automatically. Staging has all 13 migrations, `dispatch` is ACTIVE beside `whatsapp-webhook`, and the pg_cron jobs `order-escalation`, `order-monitor` and `dispatch-kick` run.
  - **Orders:**
    - The §27.5 status model is enforced by a trigger for every writer. Every change goes through `app_private.order_set_status` (conditional on the expected status, one `order_events` row).
    - `order_place` checks, in order: the menu version (a stale summary returns `repriced` with the differences and no order, §30.1.1); availability, including combos following their parts and daily quantities with "last few" at 3 (§30.1.4); pause; delivery/pickup flags; paused places; the road-km fee band from the route cache; the stairs fee and container deposit (§29.2); the COD cap, with $50 until a first delivered order (§29.4). It then locks the rate and snapshots the order fee from the per-business_type rules (§29.1).
    - Merchant actions: accept, reject with a reason, progress, the merchant `driver` role and assignment, final weights (an increase over 10%, or a total above the COD cap, waits for the customer's tap), empty container collected.
    - Customer cancellation per §30.3.6.
    - The ledger's `order_id` now has its foreign key.
  - **Race tests:** `scripts/db-race-test.sh` runs real concurrent sessions in CI. Covered: last units, a duplicate confirmation, accept vs reject, accept vs cancel. It found a deadlock, fixed by serialising placements per vendor.
  - **Merchant notifications:**
    - Channels per vendor: portal by default, WhatsApp backup to the kitchen, call to the owner. "Received" means a channel acknowledged the order.
    - The escalation runs on a 5 s pg_cron tick: backup at 15 s, call at 45 s, operator at 75 s, cancel at 300 s (all config). A failed primary fires the backup at once. Three channel failures in an hour put the merchant on its backup for the day.
    - Three orders in a row missed through all four layers auto-pause the merchant, with a "🟢 Reactivate" card (§30.2.2).
    - Outbox, ops alerts, the monitoring tick for merchant mode (§27.5), the portal queue view, number-quality events (§29.6).
  - **Merchant commands (§30.2.1):** a rules parser in AR, EN, FR and Arabizi: pause / closed till, open, sold out / back, price, balance, top up. A typed change becomes a `merchant_proposals` row applied only by the confirming tap, and a tap on one of our own cards is the confirmation. There are no model calls; the merchant AI comes in session 5.
  - **`dispatch` edge function:** handles merchant taps and commands, then the outbox (Kapso cards, all inside Meta limits), then ops alerts (Telegram). pg_net kicks it every 5 s, and `whatsapp-webhook` kicks it after each intake. The deploy job syncs function secrets from GitHub secrets (`KAPSO_API_KEY` now; Telegram, Sentry and Twilio once set).
  - **Built but off:**
    - Voice calls: `voice_calls_enabled` is false until #105.
    - Telegram alerts: until #104. Alerts are stored for operators meanwhile.
    - CloudPRNT poll endpoint: comes with the first merchant printer. A printer primary falls back to the backup at 15 s.
  - **Open for later:**
    - Register the Kapso webhook for the sandbox number (597907523413541) and set `KAPSO_WEBHOOK_SECRET`. Insert the sandbox row into `whatsapp_numbers` (role `sandbox`) so `dispatch` has a sender. This is session 4, which builds the customer bot. Until then, inbound messages from non-merchants are marked `ignored`.
    - Brand-shared menus with per-branch prices come with the Phase 3 menu editor.
    - The online-paid weight refund and payout cap are Phase 6.
- **Next: session 4 (Phase 3a).** The full session list, with the model and effort for each, is in DECISIONS §10 "Which model".

## How to start each build session
At claude.ai/code, start a new session on repo `rashidhamzy-hue/alo-king`, branch `rebuild/lebanon`. Pick the model and effort from §10, then send:

> Read docs/decisions/HANDOFF.md, DECISIONS.md and LOG.md. Do session N from DECISIONS §10 ("Which model"). Never ask me; follow §25. When done, update HANDOFF.md "Progress" in your last PR and reply with what merged and the open `owner` issues.

## Planning chat (claude.ai, Alo King project)
Use it for strategy, research and decisions. It cannot run code. Decisions it makes are written into DECISIONS.md by the next build session, or uploaded to the project directly.

## Owner to-do (Rasheed)
0. **Now (5 minutes each):** Telegram ops bot and the Sentry DSN for edge functions (#104). Twilio account for the automated merchant call, which spends money (#105). The next ~100 voice notes (#77; the key is set).
1. **Whish:** send the extra questions in §20.6 (#69) and get the API documents and a sandbox key.
2. **SARL** (about 17 October). The same week:
   - open a fresh-USD bank account
   - open Alo King's Whish business account
   - apply to Tap (Claude prepares the text, §22.5) (#70, #71)
3. **Lawyer:** one letter covering §20.1 (collection model, BdL Decision 13790), the merchant credit in §20.3, and §21.6 (drivers) (#72).
4. **Lines:** Alfa or touch postpaid lines; Meta business portfolio in the company name, with all three owners as admins (#73).
5. **Domain:** buy `aloking.com`, then the browser Google key, Search Console, Bing Webmaster and a Google Business Profile (§24.5) (#74).
6. **Before launch:** set Google Cloud spending limits (§19).
