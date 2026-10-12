# Handoff — 13 October 2026 (after session 6a)

**Read first:** `docs/decisions/DECISIONS.md` (in the project: `claude/DECISIONS-LEBANON-REBUILD-2026-10.md`). It is final and overrides everything else.

## State

- **Decisions:** sections 0–34 are complete (§33 pilot-first order, §34 ordering testable first). Phase 0 is GO.
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
- **Session 4 (Phase 3a): done (11 October).** PRs #108 (§31 data-freeze guard), #109 (customer bot server side), #110 (customer bot, evals, voice pipeline), #111 and #113 (Kapso webhook registration) merged automatically. Staging has all 16 migrations; `dispatch` now runs the customer bot.
  - **Data freeze (§31):** CI fails a PR that touches the places or vendor seeds or scripts or `places-build.yml`, or renames, drops or retypes a frozen table or column, unless its title starts with `Data:`. Data problems found during the session are in `DATA-ISSUES.md` (8 lines, none fixed).
  - **Customer bot** (`supabase/functions/dispatch/customer/`): every sender who is not a merchant member.
    - Zero model calls for taps, pins, live location (asks for a static pin), STOP, "delete my data" (asks first), "forget my history", a person, tracking, "the usual" and yes/no to a pending summary, in AR/EN/FR/Arabizi.
    - Otherwise one model call (Haiku 4.5, config) choosing typed tools (`tools.ts`, strict schemas, server-validated, refs only to what the session showed); one retry on Sonnet 5.5, complaints straight to it; a price guard on model text. Only the Confirm tap (or a typed yes to that summary) places an order.
    - Atomic daily AI quota per customer and globally (§29.5), cost logged per call; two unclear turns or the customer cap hand off to Rasheed (§30.6).
    - Buttons for 1-3 choices, lists for 4-10 (§29.3); one upsell, never on a reorder; the abandoned-basket reminder once, outside quiet hours; ratings 30 min after delivery; "Received ✅ / Problem".
    - Voice (§30.1.6): "listening…" first, then OpenAI transcription with a vocabulary from our own data, Kapso's transcript as fallback, then the model on the transcript.
    - Customer memory profile and "forget my history" / "delete my data" (§30.1.5, Law 81).
    - Delivery code (§27.6): over $50 or a first COD order; kept in a service-role-only table (#109 review); the merchant or driver types it; 5 wrong codes lock the order.
    - Customer status messages from the outbox (§27.9): accepted with the ETA range, on the way with the driver's WhatsApp, near drop with the live-location button (§27.3), arrived, delivered, weight, cancel refused.
  - **Location (§28.2, §28.5):** `resolve_location`, `describe_location`, `observe_location`; the eval (`evals/location/`, 104 messages, real places) runs in CI after the seed loads and fails below 90% top-3 (now 94%; the first version was 63%).
  - **Evals:** `evals/customer/cases.jsonl` (76 cases, four languages): the 20 deterministic cases run on every PR; the model cases run on demand in `evals.yml`. Contract test (§29.5): every RPC and table the deployed functions call exists, and no model id is hard-coded.
  - **Kapso webhook:** registered on the sandbox number (597907523413541) by `kapso-webhook.yml`, which generates the signing secret, stores it as the function secret `KAPSO_WEBHOOK_SECRET` (never printed) and checks that an unsigned request gets 401. Re-run it to rotate the secret. The sandbox row is in `whatsapp_numbers`.
  - **Voice labels (§30.7):** `voice-label.yml` transcribes each note with two OpenAI models, Claude reads the order from each, and only notes where the two disagree on a dish, quantity or place go to Rasheed. **Not run yet:** OpenAI rejects the `OPENAI_API_KEY` secret (401); see #77. Re-run `voice-label.yml` (batch-01) once the key is replaced, then open a PR from its `data/voice-labels-<run>` branch.
  - **Open for later:**
    - Flows for addresses and item options (§12) and the web basket for 10+ choices: session 5 and Phase 4. Until then options are asked one group at a time as a list.
    - Utility templates for messages outside the 24-hour window: they are stored as skipped until the company number exists (§3).
    - Live location inbound arriving as `unsupported` is assumed from §27.1; confirm on the first live sandbox test.
    - Driver names and photos in "on the way": session 8 (driver profiles).
    - `merchant-ai` port: session 5; the contract test covers it once it joins `functions-deploy.txt`.
- **Session 5 (Phase 3b): done (11 October).** PRs #115 (§32.7 self-review gate, AI evals skip without credit, alo-ai-tool-safety now points to §30.7/§32.4), #116 (claims and registration), #117 (smart menu and nutrition), #118 (Flows, opening hours, catalogue) and #119 (merchant WhatsApp extras) merged automatically. There was no Anthropic or OpenAI credit, so every PR carries a pr-reviewer self-review comment tagged with its head SHA (§32.7); several ran more than one round, and every blocker was fixed before merge.
  - **Self-review gate (§32.7):** `scripts/self-review.sh` accepts only an unedited comment by the owner account whose first three lines are the header, `Head: <sha>` and `Verdict: approve`. CI runs the base branch's copy of the script.
  - **Claims and registration (§18.1 A–M):** onboarding on the Merchant number. A non-member's "join" gets a Yes button, then a name search, then a code to the shop's seed number (by WhatsApp, or a call to a landline) or documents. Also: registration of a new business, branches, brand-wide claims, objections and contests with a window, lost-phone recovery, reports and requests.
    - Codes are 6-digit salted hashes with attempt limits.
    - Notices outside WhatsApp's 24-hour window are recorded as not reached.
    - STOP, delete and forget bypass onboarding.
  - **Smart menu (§18.3, §32.3):**
    - Menu import from photos, PDF or pasted text into a draft approved one section at a time. Prices are never invented, currency only as printed, and instruction-like text is refused. Pasted text works without a model; photos wait for API credit.
    - Lebanese dish library: 203 dishes built from ingredients with evidence-scored macros (`nutrition-library.yml` re-checks values against USDA FDC from a runner).
    - Merchants confirm estimates; allergens and diets are only what the merchant declared; the customer's `dietary_menu` filters on declarations only.
  - **WhatsApp Flows (§12):**
    - The four Flows, tested with Flowso in CI: address capture, item options, merchant profile, merchant hours.
    - Server-built data, single-use tokens bound to the phone that expire after 24 h, and server re-pricing. Each Flow has its own switch in `flows_enabled` (all off) and a kill-gate. Merchant forms start from the branch's real hours, closed days, radius and cash.
    - `whatsapp-flows.yml` uploads the drafts to Kapso. Publishing waits for a Meta preview on the company number.
  - **Opening hours:** `vendor_hours` and the `hours-tick` pause outside hours; "closed until tomorrow" ends at the next opening window.
  - **Catalogue (§30.1.2):** built against fixtures (desired catalogue, sync plan, product lists within Meta limits). `cart_apply` turns a cart into a basket priced by the server, and keeps the old basket if nothing can be added. `catalog_enabled` stays off until the business portfolio exists (#73).
  - **Merchant WhatsApp extras (§32.5):** each is a proposal confirmed by a tap, with roles per §18.1 H.
    - Kitchen capacity: ETAs lengthen above the limit, and new orders pause automatically at 2× until the queue drops.
    - Generator mode: `needs_power` items are hidden and restored.
    - Staff by WhatsApp (owner only).
    - Shift handover on a staff member's first message of a shift.
    - Substitutions: the preference at grocery checkouts; substitutes priced from the menu and decided by the customer's tap, LBP at the locked rate.
    - Visual gold order card: rendered from SVG with resvg and bundled Noto fonts, off by config until checked on the sandbox.
    - Same-price badge, only after the merchant's confirmation.
  - **Open for later:**
    - Photo menu import, model-based merchant text and AI evals need API credit (§32.7). `customer-eval.ts` prints SKIPPED meanwhile.
    - Flows and the catalogue: publish on the company number after a Meta preview, then switch each Flow on in `flows_enabled`.
    - The order card: switch on `order_card_image_enabled` after one sandbox render.
    - Merchant statements reuse the card in Phase 6.
    - "Open" sent outside the set hours is re-paused by the hours tick within a minute; the reply should say so (5b).
    - A catalogue cart whose lines all need choices adds the first one to the existing basket.
    - Open complaints in the handover use cancel requests and low ratings until `order_exceptions` (5b).
- **Session T (testable ordering, §34): done (12 October).** One PR (see LOG.md "session T PR" lines). Done means the owner can place, accept and rate a test order from one phone with no API credit.
  - **Tool-schema bug:** the API rejected `type: ["string","null"]` beside an `enum`, so every AI turn failed. Nullable values are now `anyOf`, value limits are out of the schemas (the server still enforces them), and `tools.test.ts` checks every schema against the API's rules on every PR.
  - **No credit, no error:** any model failure shows the main menu (Order, My order, A person) and is not counted as an unclear turn.
  - **Handoff never silent:** 30 minutes (`handoff_minutes`), every message answered with a Menu button, "menu", "order", "hi" or any tap ends it. Every row of `app_private.owner_phones` gets a WhatsApp note on the Merchant number (until Slack, 5b).
  - **Button path, zero model calls:** Order -> pin -> open places that deliver there -> sections -> items (nine and "More") -> quantity 1-10 -> required options -> basket -> cash currency (USD or LBP, stored on the basket and order) -> summary -> Confirm; merchant Accept -> Ready -> Out for delivery -> Delivered cards (each reply carries the next step); status messages; "Received" and the rating (a test merchant's rating comes at once). Two silent gaps found and fixed on the way: an item tap with no options said nothing, and a pin with no basket only said "saved".
  - **Alo Test Grill:** `supabase/test-fixtures/alo-test-grill.sql`, run by the staging deploy job only (`vendors.is_test`, `source = 'admin'`, Baakline, 15 items, 10 km, 24/7; Baakline, Bakaata, Semqanieh and Beiteddine switched on). **Never run it at the production cut-over** (LOG.md has the checklist line).
  - **`#merchant` / `#customer`:** the owner's phone (`OWNER_TEST_PHONE`, else the only customer on staging) switches which side typed text goes to; taps always reach the owner of the card.
  - **Open for later:**
    - Entering a final weight by WhatsApp is portal-only, so test orders must leave out the lamb chops (weighed).
    - The merchant card does not show the cash currency yet.
    - Slack, ops console, admin commands, recovery engine, templates and the gold card image stay in 5b.
    - The merchant portal link was not part of T.
- **Session T2 (fixes from the first live test, 12 October): done.** One PR (see LOG.md "session T2 PR" lines).
  - **Pickup and Checkout:** `basket_quote` raised on every pickup basket, which the bot showed as "Sorry, I'm a bit slow" (and the stored pickup choice broke every later Checkout). Fixed; pickup is deterministic and works.
  - **Delivery check after the pin:** only places whose road route reaches the pin are listed; none left means "no open place delivers here" with Pick up / Another pin, before any basket. The pickup choice lists open places that take pickup within `pickup_search_km`.
  - **No tap reaches the AI or gets "slow":** failures show the button menu; free text without credit shows the menu.
  - **Stale handoffs** ended by the migration; the handoff card has Menu and My order.
  - **Staging only:** Alo Test Grill delivered up to 30 km through a $6.00 10-30 km test band (retired in T3, which lets it take any pin instead).
  - **CUT-OVER (session 14):** production must have `max_delivery_km() = 10` (no fee band above 10 km), no `is_test` vendors and no `owner_phones.test_switch` rows; the staging fixture adds a $6.00 10-30 km band.
  - **Replay test:** `live-test-replay.test.ts` and `supabase/tests/99_t2_live_test_fixes.sql`.
- **Session T3 (any pin for the test merchant, Google off, review race): done (12 October).** One PR (see LOG.md "session T3 PR" lines).
  - **Any pin:** Alo Test Grill takes a pin anywhere, with no radius check, no road route and no paused-place block; the delivery fee is the 0-3 km band ($2.00). A pin outside every place polygon (Dubai, a gap, a paused place) is saved against the staging-only "Test location" place; a Beirut pin snaps to Beirut as usual. Real merchants keep every check. The T2 30 km band is retired by the fixture (a newer dated band set); the radius on record is 10 km again.
  - **Google Places is off:** config `google_places_enabled = false`; `check-setup` reports "skipped" and never calls Google, `vendor_from_google` answers `disabled`, and a test fails if any other file reaches Google or the key. The claim flow uses our list and "not in our list" only.
  - **Self-review gate:** the review job waits up to 10 minutes for the §32.7 comment instead of failing a race. Post the comment right after every push.
  - **Tests:** `supabase/tests/99_t3_any_pin.sql` (Dubai and Beirut pins order from the test merchant, real merchant unchanged, production fallback, Google flag), the replay in `live-test-replay.test.ts`, `scripts/google-places-guard.test.ts`.
  - **CUT-OVER (session 14), added:** `places` has no row `LB-TST-LOCATION`; with the earlier list: no `is_test` vendors, no `owner_phones.test_switch`, `max_delivery_km() = 10`.
- **Session 11-lite (staging conversation simulator, §36): done (12 October).** PRs #128 (simulator), #130 and #131/#132 (first-run fixes), #133 (bot fixes) merged automatically. Claude Code now tests the bot itself; run 5 passed **9/9 scenarios** and closed the `e2e` issue (#129).
  - **How it works:** `dispatch` records any message to a `+999` number in `sim_outbox` instead of calling Kapso (config `sim_sink_enabled`, on only through the staging fixture; with it off a `+999` message is refused). The `staging-e2e` workflow (`.github/workflows/staging-e2e.yml`, a job at the end of `ci.yml` after every staging deploy, and on demand) sets a one-time `E2E_WEBHOOK_SECRET` function secret, posts signed Kapso-shaped events to the deployed `whatsapp-webhook` (which accepts that secret only for `+999` senders), asserts replies and database state, and publishes transcripts as the job summary and the `e2e-transcripts` artifact. A failure opens or updates one `e2e` issue; a pass closes it. Runner and docs: `tests/e2e/` (`README.md` explains the YAML format). Customers are fresh `+999<cc><7 digits>` numbers per run; the merchant persona `+99996100000001` becomes the test merchant's order channel for the run and `sim_restore` puts the owner's setting back.
  - **Scenarios (all pass):** delivery from Baakline, Beirut and Dubai (accepted, delivered with the code, rated), pickup (code at the handover), basket changes and double taps, merchant reject and unanswered-order auto-cancel (time-travelled), customer cancel inside and after 60 s, no-credit free text and handoff, Arabic/English/French replies, the 12 October chat replayed.
  - **Bugs it found and fixed in the bot:** typing "a person" got the free-text menu (now hands off); a customer could not cancel an order without the AI (now "cancel my order", a track-card button and the model all open the same Yes/Keep card); pickup orders said "give it to the driver at the door" (now a pickup code for the shop). Runner-side: the pooler certificate and an interactive `supabase secrets unset` prompt.
  - **Open for later (notes):** the pickup button is never offered when delivery works (only when nothing delivers), so the pickup scenario taps its id directly (`raw_id`); the track card's own code line still says "driver" on a pickup order (needs the fulfilment in `order_track`); simulated customers and orders stay on staging (orders are ledger-linked), only `sim_outbox` rows older than 3 days are pruned; the runner connects to the pooler without verifying its certificate (same as `psql sslmode=require`), pinning the Supabase CA is a follow-up; voice-note stubs and a scenario for the merchant AI/Flows wait for API credit. Kill-gate (§36): a scenario failing on two consecutive runs with no code change is quarantined with a reason in `LOG.md`.
  - **CUT-OVER (session 14), added:** config `sim_sink_enabled` is false on production, `public.sim_outbox` and `app_private.sim_state` are empty, and no `E2E_WEBHOOK_SECRET` function secret exists.
- **Session 6a (full website, customers and foundation, §37): done (13 October).** One PR (see LOG.md "session 6a PR" lines); final screenshots and the Vercel preview link are in the PR, and the curated set is in `docs/design/session-6a/`.
  - **Design system** (`src/design/`, README there): ink, gold and cream tokens, Plus Jakarta Sans and IBM Plex Sans Arabic (self-hosted), the hand-drawn crown, Chouf contour texture, chat bubbles, CSS-only motion that stops under `prefers-reduced-motion`. Right-to-left is first-class.
  - **Pages, all in `/ar`, `/en`, `/fr` with hreflang:** home (live coded chat hero, three taps, "Speak Lebanese", the map of Lebanon read live from the places table, merchant calculator, Send Home with both clocks, trust, FAQ), places and place pages, cuisines and cuisine pages, claimed-vendor pages (menu, hours, area, order builder that writes the basket into the WhatsApp message), Send Home, help, contact, legal (terms, privacy, refunds, cookies), the restyled tracking page and a real 404. `llms.txt`, `robots.txt` and four sitemaps are server routes. Old `/m/`, `/track/` and `/explore` links redirect.
  - **Data:** `site_overview`, `site_place`, `site_cuisine`, `site_vendor`, `site_vendor_slugs` (security invoker, public vendors only) and `order_track_public` with the hashed tracking token (`order_tracking_link_create` makes a link; nothing sends it yet).
  - **Bot (§37.6):** checkout offers Delivery / Pickup when the shop takes both; the track card says "shop" on pickup orders; e2e scenarios updated, scenario 10 added.
  - **CI:** the `web-quality` job (fixture mock, axe, overflow, console, JavaScript budget, interactions, Lighthouse, screenshots as an artifact) is part of the automerge gate. Measured: Lighthouse performance 98-99, accessibility 100, SEO 100, LCP at most 2.3 s, CLS 0, JavaScript at most 125 KB gzipped.
  - **Open for later:**
    - Indexing is off everywhere until the production project sets `SITE_URL`, `SITE_INDEXING=on` and `VITE_WHATSAPP_NUMBER` (CUT-OVER, session 14). Until the number exists the Order buttons lead to the contact page.
    - Merchant, driver, admin, claim and for-business pages keep their old look (6b); they now get react-query and toasts from `PrivateShell`.
    - Re-run `scripts/web/build-lebanon-dots.mjs` after session D replaces the places list.
    - The bot does not send tracking links yet; session 13 should review `order_track_public` (the one anonymous security-definer function).
    - Legal pages wait for the lawyer (#72); PostHog (§24.7) and a Google Business Profile are not in 6a.
    - Business-type pages (bakery, grocery) were not built, only cuisines.
- **Next: session 6b (merchants: landing and calculator page, claim and registration, merchant terms, dashboard restyle with the AI side-panel shell, driver sign-up, admin restyle)**, then 13, D, 5b and 14 (DECISIONS §34 "New order of remaining sessions"). The full session list, with the model and effort for each, is in DECISIONS §10 "Which model", §32.8, §33 and §34.

## How to start each build session

At claude.ai/code, start a new session on repo `rashidhamzy-hue/alo-king`, branch `rebuild/lebanon`. Pick the model and effort from §10, then send:

> Read docs/decisions/HANDOFF.md, DECISIONS.md and LOG.md. Do session N from DECISIONS §10 ("Which model"). Never ask me; follow §25. When done, update HANDOFF.md "Progress" in your last PR and reply with what merged and the open `owner` issues.

## Planning chat (claude.ai, Alo King project)

Use it for strategy, research and decisions. It cannot run code. Decisions it makes are written into DECISIONS.md by the next build session, or uploaded to the project directly.

## Owner to-do (Rasheed)

0. **Test the ordering path now (no API credit needed):** send `Order` to the sandbox number from your phone; see the steps in the session T reply and in issue #112. Optional: add the GitHub secret `OWNER_TEST_PHONE` (see the owner issue) if you want to be sure which number may switch sides.
1. **Also now (5 minutes each):** replace the OpenAI key, which OpenAI rejects (#77), then the next ~100 voice notes (#77). Join the Kapso sandbox from your phone to test the bot live (#112). Telegram ops bot and the Sentry DSN for edge functions (#104). Twilio account for the automated merchant call, which spends money (#105).
2. **Whish:** send the extra questions in §20.6 (#69) and get the API documents and a sandbox key.
3. **SARL** (about 17 October). The same week:
   - open a fresh-USD bank account
   - open Alo King's Whish business account
   - apply to Tap (Claude prepares the text, §22.5) (#70, #71)
4. **Lawyer:** one letter covering §20.1 (collection model, BdL Decision 13790), the merchant credit in §20.3, and §21.6 (drivers) (#72).
5. **Lines:** Alfa or touch postpaid lines; Meta business portfolio in the company name, with all three owners as admins (#73).
6. **Domain:** buy `aloking.com`, then the browser Google key, Search Console, Bing Webmaster and a Google Business Profile (§24.5) (#74).
7. **Before launch:** set Google Cloud spending limits (§19).
