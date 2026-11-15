# Alo King Chouf: implementation baseline

Date: 12 November 2026. Planning is closed. This file is the status and the business rules.
The roadmap is `docs/BUILD_PLAN.md`. Rules the code must never break are in `CLAUDE.md`. Costs are in `docs/COST_MODEL.md`.
Everything needed is in this repository. The original Master Blueprint is not, on purpose: where any older document or
conversation disagrees with these files, these files win. `docs/history/` is superseded material.

## Business rules (founder decisions, final for now)

1. **Riders keep 100% of delivery fees and 100% of tips. No hourly wage.**
   The delivery fee is collected on the rider's behalf. It is not Alo King revenue.
   In the ledger it lands in `revenue_delivery` at payment and moves to `rider_payable:<driver>` when the order closes
   (`settle_rider_earnings`, migration 0009). `rider_statement()` shows cash held, earnings, and what to hand over.
   `settings.rider_pay` holds the shares and a `min_guarantee_per_hour_usd` (0 today) for a possible future guarantee.
2. **Only onboarded restaurants are orderable.** A restaurant needs accepted terms, an approved menu with prices, and a
   contracted commission. `approve_merchant()` is the only way to open one; a trigger keeps unapproved ones closed.
   There are no signed partners yet. The dark store is the whole launch catalog until there are.
   A customer asking for an unsigned restaurant is told it is not available yet. Nobody phones the order in.
3. **The service area and the hub are not decided.** The hub will likely be in Baakline, Baqaata or between them, possibly
   near VCC Baakline. That is a planning reference, not a confirmed property. `supabase/seed/villages.sql`, the zones and
   their fees are a draft and stay data, never code: see "Hub and zones" in `docs/BUILD_PLAN.md`.
   Final zones wait for: hub location, measured travel times, rider earnings, and later restaurant coverage.
4. **Neutral, factual, no ratings.** Alo King helps customers find available options that match a request. It never rates,
   praises or criticises a merchant or product, and never calls food healthy. Sorting is by measurable facts. The customer decides.
5. **Food facts only from approved records.** Allergens, ingredients, halal, vegetarian, vegan, fasting and nutrition are stated
   only from approved records, with their status. Unknown is never safe. Nothing is inferred about a person's religion or health.
6. **Explicit restrictions outrank everything**, including learned habits and any paid placement. Customers control what is saved.
7. **No marketing sends.** Switched off in the database. The customer number is never used for promotions. See the build plan.
8. **Small-order fee** is supported as a setting and is company income, separate from the rider's fee. Amount and threshold undecided.
9. **Restaurants:** conversations start during the pilot or earlier; nothing unsigned is orderable. The goal is all of Chouf.
10. **Website and diaspora orders** are Phase 9, after the pilot. WhatsApp-first until then.
11. **Voice notes** are welcome within configurable limits per sender role; voice never authorises money.
12. Unchanged from before: no tobacco or alcohol; nothing branded Tawfeer; Joud and Super Value stay out; COD in USD or LBP
   at the daily rate; Whish and OMT confirmed by a person; rider cash cap soft 150, hard 200; text and interactive
   messages only, never outbound audio; opt-out always wins.

## How to run

```
npm install             # also installs the pre-commit hook (personal-data check, scripts/ci/no-personal-data.mjs)
npx tsc --noEmit
npx vitest run          # about 1,000 tests (40 live-only skipped); apps/console/test/* drive the console's pages; test/db/* run the real migrations in PGlite;
                        # test/pg/* start a throwaway Postgres 16 (or use TEST_DATABASE_URL) and the Worker in workerd
DATABASE_URL=... scripts/check_permissions.sh    # on a scratch Postgres, and on a Supabase branch before launch
```

## Status

### Strategy of 15 November (session DOC1, Sonnet, docs only)
The planning chat of 15 November audited `main` and staging read-only and wrote the strategy now in `docs/strategy/` (start with its `README.md`).
The engine is ahead of the business: the next phase builds less and proves more. Decisions are in `docs/DECISIONS.md` ("Founder decisions,
15 November 2026"); the roadmap rows are the last section of `docs/BUILD_PLAN.md`; the rules every session follows and every prompt are in
`docs/NEXT_SESSIONS.md`. Where these disagree with an older section of this file, they win.
- **Gates.** **A**, the friends' test (Rashid and three friends on the US number): HO1, B1a, B1b, CX1, DS1, D4b, T1 merged; pictures approved; Arabic strings read by a person; simulated customers show zero silences after a hand-off. **B**, the shadow run (staff and family, cash only, 7 days, 100 orders): WH1a, RD1, OPS1, OPS2, AUD1, A3 merged; a nightly backup and a passed restore check; the hub with backup power and a temperature log; real costs entered; blended margin at least 15%. **C**, the paid pilot: the SARL; Meta verification; the lawyer's and accountant's answers; RCPT1; PAY1 switched on or cash only by decision; G2's blockers fixed; Supabase Pro; the +961 numbers; auto-reload on with a limit. Stop conditions: `docs/strategy/01-verdict-gates.md`.
- **DS1 built** (below): the design system (`packages/ui`), the console's shell, Today, Inbox and Orders, and the website's home, category, search and product pages. The crown waits for the founder's approval.
- **HO1 done** (below): the hand-off redesign is in code, and the simulated customers show zero silences after a hand-off (150 run).
- **B1a merged (#77, #79, #80), two of three targets met** (below): on 150 simulated customers, minimum-order loops 66 to 0 and lost baskets 11 to 0; wrong products 34 (target 8; the planner's generic and size picks, a kept overnight basket's counts and reading cases remain); passed 35 to 48. B1b (hand-off wording and language) is not started.
- **What runs next.** Wave 0: PUB1 (public-repository hygiene) and BK0 (free backups and a repeated restore check; done, 15 Nov, see "BK0" below). Wave 1: HO1 (the never-stranded hand-off, first, ahead of T1), COST1 and OPS1; HO1 and COST1 start when SIM1's report is merged. Then B1a and B1b (one after the other), DS1, PIX, CX1 (waits for B1b), D4b. **T1 waits for gate A.** At most three sessions at once.
- **Built and tested by DOC1:** documents only (`docs/strategy/*`, `docs/NEXT_SESSIONS.md`, `docs/BUILD_PLAN.md`, `docs/DECISIONS.md`, this section, the old queue kept in `docs/history/NEXT_SESSIONS_2026-11-14.md`). No code, migration or workflow changed. Not proven: nothing here runs; it is a plan.
- **`docs/DESIGN_BRIEF.md`** was not in the DOC1 hand-over; DS1 converted it from the founder's attachment on 15 November (see "DS1" below). No crown picture was attached: DS1 drew an original mark, which waits for the founder's approval.
- **Founder actions that follow from the strategy** (exact clicks are written into this file by the session that needs each): `BACKUP_PASSPHRASE` is set (BK0, done; keep it in two places, "Founder actions (backups)" below); rotate the webhook secrets that were exposed while the repository was public (PUB1); export what is needed from the old Supabase project and delete it, before its grace period ends on 24 November; create three free uptime checks and Hussein's staff account (OPS1).
- **Coordinator decisions, 15 Nov 13:30** (`docs/DECISIONS.md`): B1 is split into B1a (report fixes 1, 3, 4, 9, 10 and the two no-reply turns) and B1b (fixes 5, 6, 7, 8), one after the other after HO1, and CX1 waits for B1b; the minimum order is $5 with no small-order fee at launch, the amount and the gap stated by code (the founder may overrule); a first order without a map pin is accepted with a typed village and landmark and marked for a rider call; DS1 converts the founder's brief first. Recorded by COST1 in documents only; the code and the seed changed in B1a (below).
- **Left out on purpose:** part 4 of the strategy (the systems audit) and the founder's action drafts stay out of the repository until it is private (`docs/strategy/README.md`).
- **One number corrected:** WH1a's migrations are 0153, 0156, 0157, 0188 and 0189, because WEB1 already uses 0154 and 0155 (`docs/DECISIONS.md`).

### DS1: the design system and the flagship screens, 15 November 2026 (Fable 5.2); no migration
The founder's brief is in the repository as `docs/DESIGN_BRIEF.md` (converted from the attached .docx, unchanged in meaning; the author's name on its date line is left out because the repository is public). The decisions followed are `docs/strategy/05-console-website-design-handoff.md`, sections A, B and C. Screenshots: `docs/screens/ds1/` and the pull request.

**Built.**
- **`packages/ui`**, the one design system for both apps. `tokens.css` is the one file with every colour, font, radius, shadow and the logo reference, light and dark; a change of brand is an edit there and `node packages/ui/scripts/build.mjs`. Tailwind v4 compiles at build time (no runtime): the console's sheet into `apps/console/src/ui.generated.ts` by that script, the website's by the Tailwind Vite plugin in its Astro build. Utilities carry the prefix `tw:` so no ordinary word in a page becomes a class by accident. IBM Plex Sans and IBM Plex Sans Arabic are served from our own addresses, subset to 45.5 KB for both scripts and two weights (`packages/ui/fonts`, licence beside them; `scripts/subset-fonts.py` remakes them). Icons are Lucide, inline. The components of section C are HTML functions (`src/components.ts`: button, input, select, chip, badge, card, KPI tile with comparison and trend line, timer chip, limit bar, data table, drawer, dialog, toast, tabs, command bar, bell, empty, loading and error states, product card, cart bar, order timeline, case row) and Astro components that wrap the same functions (`astro/`), so both apps print the same markup. No React anywhere.
- **Contrast, measured** (`test/ui/design-system.test.ts`, a failing pair fails CI): every text and control pair passes AA in both themes. One value of section C was adjusted within its family: `gold-deep` is #7A5C0C, not #8A6A12, which was 4.37 to 1 on the tinted surface. The dark theme's ok, warn and danger are lighter members of the same families. Green appears only as the ok colour (a test holds it). The Order on WhatsApp button is ink (gold on ink), not WhatsApp green.
- **The crown.** There was no crown picture, so an original mark was drawn: three peaks, three jewels and a band, gold on an ink tile (`packages/ui/crown.svg`, `src/crown.ts`). It is in both galleries at 32, 64 and 120 px, on ink and on paper. It replaced the green "M" icons of the website (`apps/web/public/icons`) and the console's "A" icons (`apps/console/src/icons.ts`); `packages/ui/scripts/make-icons.mjs` redraws them. **It waits for the founder's approval** (Founder actions below).
- **A gallery in each app, staging only**: the console at `/gallery` (linked from More), the website at `/gallery` (linked from the foot of the home page). In production both answer "not found" (tests hold it). They show every component in the viewer's language and theme, the tokens, and the measured contrast table.
- **The console's shell** (`apps/console/src/html.ts`, `nav.ts`, `pwa.ts`; the renderer, the sign-in, every route and every form's posted fields are as built). Sidebar on a laptop with the groups of section A (Today, Inbox, Orders, Approve, Stock, Money, Settings), each with an icon and a badge, open when you are in it; bottom bar on a phone: Today, Orders, Inbox, Approve, More (a picker, who has no Orders or Inbox, gets Today, Approve, Stock, More). A command bar (Ctrl+K or the search button) lists every page the role may open and searches orders (leads) or the catalog (a picker). A bell lists the open high-priority exceptions: the same kinds a phone is pushed (`settings.push_alerts.high_priority_kinds`). Light, dark or "follow the phone" is each person's choice on More (a cookie). Vendors (`/merchants`) is out of every menu and keeps its route. Reports has no page yet, so the group is not shown.
- **Today**: KPI tiles (orders; sales of goods only, because the fee and tips are the rider's; delivered within the zone time; average delivery time; AI cost per order; customers waiting for a person; open exceptions), each against the same hours of yesterday and of the same weekday last week, with a trend line of the seven days before today; "Needs you now" exactly as before; orders late or at risk; the live board of open orders in columns (New, Picking, Ready, On the way, To close) with a timer that turns amber at three quarters of the zone's ETA and red past it; riders with exposure against the soft and hard caps as bars. It refreshes itself each minute while it is in front and nobody is typing.
- **The Inbox** (HO1's actions unchanged: claim, reply through the gateway, give back, resolve): cases as rows with a timer chip, the kind, the order, the last message and who has it; a case page with the chat as bubbles. Arabic and English. Complaints (`/cases`) is its second tab.
- **Orders**: a table with filters in the address (status, channel, payment, village, dates), six ready views, sorting by time, total or status, a choice of columns, paging, and a CSV export that is written to the action log before it is read and never carries a phone number. On a wide screen an order opens in a drawer beside the list; on a phone it is its own page.
- **Kept working, restyled only** (their logic untouched): Staff and roles, Template health, the alerts switch and the test alert on More, the install guide, and the 24 older pages (they take the new look from the element styles). **The installed iPhone icon and alerts**: the manifest, the service worker's list, the push script and `/install` are as OPS1 left them; the icon is now the crown and the status bar is ink. An installed console keeps working; iOS keeps the old icon picture until the icon is removed and added again (Founder actions).
- **The website** (`apps/web`): the crown and the name, search, language and Order on WhatsApp on every page (header on a laptop, bottom bar on a phone; the link opens the chat with a greeting typed). Home: one promise and two buttons, "Do we deliver to you?" by village (fee, time, open or closed, from the database; works with no script), category tiles, the trust strip. Category: product cards, filters by brand, how it is sold and stock, sort by price only. Search: the chat's matcher, results that follow the typing. Product: large picture or a neutral placeholder, price, stock, food facts with their status. Product and shop microdata (no script). Light and dark follow the phone.
- **Page weight** (measured by `test/screens/web.test.ts`): HTML, stylesheet and script together are 34 to 63 KB a page, uncompressed (home 46 to 47 KB; the dairy category, 28 items, 61 KB in English and 63 KB in Arabic; a product 36 to 37 KB). The font files add 34 KB (English) or 45.5 KB (Arabic) once; the browser then keeps them. So a first visit that lands on that category in Arabic loads about 108 KB before pictures, above the 100 KB bar by the fonts; a first visit to the home page loads 80 KB (English) or 93 KB (Arabic), and every later page 3 to 32 KB of HTML. The test that holds "under 100 KB" counts HTML, stylesheet and script, as before.

**Tested.** `npm run typecheck` and `npm test` pass. New: `test/ui/design-system.test.ts` (tokens, contrast, generated files current, crown, components escape, the Arabic list), `apps/console/test/ds1.test.ts` (groups, command bar, bell, appearance, fonts, gallery, the tiles' figures, the table, drawer, CSV), a DS1 block in `test/web/pages-web1.test.ts`. Existing tests changed, each unchanged in meaning: the bottom bar's five places are section A's (was Today, Orders, Approve, Stock, More); the manifest's colour is the ink token (was navy); Today's ordering is read inside the page's main part (the bell also names the high-priority ones); the website's WhatsApp link carries the greeting; the product card's class name.

**Not proven here (needs staging or a phone).** The deploy of both Workers (the console's sheet is a committed file, so its deploy has no new step; the website's Astro build now runs Tailwind; the console workflow runs on the pull request, the web workflow after the merge); the fonts and icons on a real iPhone; a push arriving on the installed console after this change (nothing in the push path changed, but only a phone proves it); the look of real product pictures (none is approved yet: every card shows the placeholder).

**Left out because nothing gives the figure or the data yet** (no migration in DS1; each needs a read that a later session adds):
| What | Where it would show | Needs | Session |
|---|---|---|---|
| Contribution, reply time, missing-item rate, message cost per order | Today's tiles | Daily views (cost of goods per order; a daily median over `turn_waits`; missing items per order; `message_meter`) | AN1 |
| The map, or a village list with open-order counts | Today | Positions (L1); the village count is a small read | L1, UX2 |
| A filter by rider; saved views kept per staff member; pictures on an order's lines | Orders | A read that joins deliveries; a small table; the line's product picture | UX2 (needs a migration number) |
| The reply drafted "by a narrow read-only function" | Inbox | It is HO1's code draft today (no model); unchanged | AN1b |
| Delivery check by shared location; "next round" time | Website home | `locate_pin` for the role `web_channel`; the round's time in `web_catalog_home` | WEB2 (0178 to 0180) |
| Category pictures; "popular now"; sort by size or popularity; a substitute when out of stock; "order again" | Website | A picture per category and pack size as a number in the catalog reads; sales counts; a substitute read; identity | PIX, WEB2, AN1 |
| The cart button and bar | Website | The cart (the bar is built and in the gallery) | WEB2 |
| The second door, vendor pages | Website | The first signed vendor; the components are ready, no page is routed | E1 |
| A search that logs nothing while typing | Website search | A typed pause on three letters or more is one search; if it finds nothing it is logged as demand like any search (capped per hour by the database). An argument "do not log" on `web_catalog_search` would make typing silent | WEB2 |

**For the next sessions.** UX2 moves the remaining console pages onto `@ak/ui/components` (they already wear the tokens) and gives them Arabic; D4b's new pages start on the components. Every screen pull request runs `SCREENS=<folder> npx vitest run test/screens` for its screenshots (it needs Playwright's Chromium, which CI does not install). After a change to `packages/ui` styles or to a class name in `apps/console/src`, run `node packages/ui/scripts/build.mjs` and commit what it writes (CI fails if it is stale).

### Founder actions (DS1)
1. **Approve the crown, or ask for a change.** Open the console on staging, More, "Component gallery (staging)": the first block shows it at 120, 64 and 32 px on ink and on paper. Or open `packages/ui/crown.svg` in the repository on GitHub. If you have the WhatsApp profile artwork, attach it to the next UI session and say "redraw the crown from this"; the change is one file (`packages/ui/src/crown.ts`) and two commands.
2. **Review the screens on staging** (console and website), phone and laptop, Arabic and English, and send changes to the next UI session. A colour or font change is one edit in `packages/ui/tokens.css`.
3. **To see the crown on the iPhone home screen**: press and hold the old icon, Remove App, Delete; open the console in Safari, Share, Add to Home Screen; open it from the new icon and switch alerts on again under More (iOS ties alerts to the icon). Until you do this the old icon picture stays and everything else works.
4. **An Arabic reader** reads the new section of `docs/ARABIC_REVIEW.md` ("DS1, the website's redesigned pages", 34 lines) before the friends' test.
### PIX: pictures for every item into the approval queue, 15 November 2026 (Sonnet 5.5); no migration

**Result, plainly: the pipeline is finished and proven; the catalogue is not covered, because the web search has no key.** The repository secret `BRAVE_SEARCH_API_KEY` is not set (every `images` run prints it empty), so only Open Food Facts could be asked. Without the search, **20 of 291 items have a candidate waiting** (18 public page, 2 Open Food Facts; all proposed by earlier sessions, none approved) and **271 have a named reason**: 180 `search_off` (Open Food Facts had nothing, or the item has no barcode, and the search did not run) and 91 `none_passed` (Open Food Facts had pictures; the check rejected every one: size, background, brand or product; the reasons per item are in the report). "A candidate for every item" is therefore **not met**; "or a named reason" is.

**What is built** (`scripts/images/`, `.github/workflows/images.yml`; no console, SQL or customer-facing change):
- **Sources in order**: Open Food Facts by barcode, then the brand's own site, then web search. A search hit that names an https page is now filed as `public_page` (the founder's rule of 14 Nov: any public page; the picture's address and its page are stored, so it can be withdrawn at once; a person still approves each one). A hit with no page address stays licence `unknown`. Stock-photo and picture-sharing hosts, hits under 800 px and non-https addresses are dropped before anything is downloaded or paid for (`SKIP_HOSTS` in `lib/search.mjs`). Packed items are searched as "pack shot", loose ones as "white background". Up to 4 candidates per source, 8 per item.
- **The check**: unchanged and strict: same brand, product and size, one pack, plain background, no watermark, price or shop logo; "cannot tell" is a no.
- **One canonical file**: JPEG, longest side exactly 1200 px (800 to 1199 px sources are enlarged to it), white behind transparency, under 300 KB.
- **Duplicates and near-duplicates** (`lib/dedupe.mjs`, no model): each picture gets a 16 x 16 colour fingerprint; a picture within an average difference of 4 (of 255) of one that another item holds or is looking at is refused as `duplicate:<sku>` **before the paid check**. Re-encodes and resizes measure under 1; the closest different packs tried, about 8. Held pictures are loaded at the start of a run (the 20 existing ones are hashed from the private bucket). The fingerprint is stored in `product_images.vision.phash`.
- **Source and time stored**: `source_url`, `page_url`, `fetched_at`, and `vision.retrieved_at`.
- **The 20 fastest sellers first**: items run in the order of "Tawfeer units sold" in `supabase/seed/catalog.csv` (Potato, Tomato, Cucumber, Onion, Lemon, ...), so their candidates are the earliest in the queue. **Limit, not fixed:** the console's Pictures page shows the oldest 60 proposals, ordered by SKU inside the page, and cannot sort by speed; the 20 fastest are named in the report (`approve_first`). Sorting the page by speed needs a console or SQL change outside this session.
- **The queue report** (`scripts/images/report.mjs`, last step of the workflow; artifact `pictures-report`: `pictures-report.md`, `.json`, and `pictures-run.json`): for every active item a candidate (source, page host, time) or a named reason (`search_off`, `none_found`, `none_passed` with the failed checks counted, `duplicate` naming the other item, `rejected_before`). The step fails if any item is "not tried" or "error".
- **Cost**: the existing `max_usd` cap (default 2); new input `retry_all`. The search is not a model call, so the run summary counts its requests (about USD 0.005 each).

**Tested:** `scripts/images` 60 tests (real resizing, the real migrations, the dedupe on re-encoded and different synthetic packs, the ranking on the real catalog file, the report); `npm run typecheck` and `npm test` pass (1,861 passed). **Run live** on staging from this branch (`images` run 43737892345, probe; run 43738388316, all 271 items without a candidate, `retry_all`): the ranking, the duplicate load, the report and the private-bucket proof all work; **no search, no public-page candidate from search, and no duplicate rejection happened live** (no search key), so those parts are proven by tests only.

**Spend:** model USD **0.0785** (205 vision calls, `claude-haiku-5-5`, `model_costs` row for run 43738388316-1) plus an earlier probe with no model call; search USD 0.00 (0 requests). Total about **USD 0.08 of the USD 8**. Not tried: a keyless source. A retailer search whose page loads its results from a search backend with a key embedded in the page was not used (that key is the site's, not ours), and scraping search-engine result pages was not built (it is the reselling of scraped results `docs/DECISIONS.md` ruled out).

### Founder actions (PIX)
1. **Add the search key.** Create a Brave Search API key (api.search.brave.com, "Search" plan, add a card; about USD 5 per 1,000 requests, a full run is about 330 requests, USD 1.70). GitHub, the repository, Settings, Secrets and variables, Actions, New repository secret: name `BRAVE_SEARCH_API_KEY`, paste the key, Add secret.
2. **Run the pictures.** GitHub, Actions, **images**, Run workflow, branch `main`, `retry_all` ticked, `max_usd` **6**, Run. About 30 minutes. The run summary ends with the queue (candidates by source, reasons per item); the full list is the artifact `pictures-report`. How many pass is not known until it runs (the check is strict); the rest are named reasons, and those items go on the photograph-at-intake list.
3. **Approve.** Console, **Pictures** (`/pictures`): approve only a picture that shows exactly the item (same brand, product and size, one pack, no price tag, logo or text). Start with the 20 fastest sellers listed at the top of `pictures-report.md`. Today **20 candidates are waiting** (none approved); after step 2 the count is in the run summary ("candidates waiting for approval"). The page shows 60 at a time; approve or reject and the next ones appear.

### OPS1: alerts that wake someone, and the probe stall of 15 November 2026 (Sonnet 5.5); migrations 0140 to 0142
Two things were added to the prompt: diagnose why the hourly probe orders stopped, and a separate alarm for the model provider refusing for an account reason.

**The stall (diagnosed on staging, read-only).** AK-1041 and AK-1042 (06:03 and 07:05 UTC) walked to `closed`. AK-1043 (08:08) and AK-1044 (09:41) stopped at `confirmed` with no delivery row and no offer message.
- **Cause.** Every probe order is cash on delivery. The two probe riders collect the cash at each door and nothing ever handed it in, so their cash held rose with every order: **152.67 and 157.67 USD at 11:21 UTC, against the soft cap of 150** (`settings.cash_cap`). `dispatch_order()` skips a rider over the soft cap, found nobody, and answered `no_rider` every minute. By the books AK-1042's delivery took Probe rider 2 from 149.90 to 157.67 (157.67 less its 7.77), which is why 08:08 was the first order refused; Probe rider 1 had been over since 14 November. The cap did what invariant 5 says and is not touched.
- **Not the pull request.** #51 changed seven files, all workflows, CI scripts and docs (`git diff 711c2ca^1 711c2ca`): nothing the Worker runs and no migration. The deploy at 07:35 UTC carried the same code as the one before; the order of 07:05 had closed before it. The timing was a coincidence; the cash crossed the cap at 07:08.
- **Fix.** `probe_remit_cash()` (0140): the end of a rider's round. A probe rider with no job in hand declares a hub drop (`declare_cash_drop`, as a rider does) and the probe's own ops lead confirms it (`confirm_cash_drop`, the function the console calls), so the ledger entries are those of a real drop. It acts only on `is_probe` riders, only while `settings.probe.enabled` is true (false in production), and only when a probe ops lead exists (`prepare-staging.sql` makes one, with no identity: nothing can be sent to it, pushed to it or signed in as it; no migration makes one). The Worker's probe step calls it each minute, before a new order is placed. A real rider's cash is untouched (a test proves it). `heartbeat_alerts()` now says why a stuck probe order is stuck: riders on shift, and riders with room for it.
- **Why nobody was told.** The `probe_stuck` exceptions did open (08:39 and 10:12). Staging had **no phone subscribed to push (0 subscriptions)** and the only ops recipient (the admin party) has **no identity on the ops line**, so the WhatsApp alert had nowhere to go. That is what the rest of this session is for. Founder actions below.
- **Tests, written failing first:** `test/db/probe-cash-ops1.test.ts` (reproduces the stall: riders over the cap get `no_rider`; the remit; the books balanced; the waiting order is then offered; the guards), `test/db/heartbeat.test.ts` (the probe step calls it; the alert says why), `test/pg/prepare-staging.test.ts` (the probe ops lead, on a real Postgres).
- **The model refusal at 11:12 UTC hid the next probe.** The hourly probe's turn at 11:12 got `400 invalid_request_error: You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.` The code treated it as any bug: a hand-off row (`agent_error`), no exception, no alert. Until the limit is raised or the key replaced, **no new probe order can be placed at all** (every one needs the model). So "the next probe order closes" cannot be shown until then; what can be shown is the two stuck orders closing after the deploy (below).

**The model account alarm (item 7).** `packages/agents/src/model-account.ts` tells an account refusal (usage limit, billing, invalid or revoked key) from capacity trouble and from a bug of ours: by status (401, 402, 403) and by the provider's words (the usage limit arrives as a 400); an ordinary rate limit, overload, 5xx and timeouts are not account trouble. The model client is wrapped in the Worker (`depsFor`, so the staff line and the cron's jobs are covered) and again in `processTurn` (once only: a refusal is counted once). On a refusal it calls `raise_model_account` (0140): one `model_account` exception per reason (ref = reason), the provider's own words with the date access returns (keys scrubbed), a count and the time of the latest. The turn is not retried (a limit does not clear in a minute; HO1's one retry a minute later is skipped for this failure) and no "one moment" is said: after merging HO1 it is a technical failure, so the customer gets the fixed technical line (Browse, Talk to a person), the chat stays with the bot, and the `technical` exception says `model_account:<reason>` so each chat that met it can be found. High priority: pushed as soon as it opens, then **repeated no more than every 30 minutes while it stays open**, for both the push (`claim_alert_pushes`, with `settings.alert_repeat_minutes`) and the ops WhatsApp alert (`ops_exceptions_due` now reads the repeat per kind; every other kind keeps ten minutes). An acknowledged one stays quiet. It resolves itself when a model run with tokens and a good outcome is recorded after the last refusal (`resolve_model_account`, the minute cron). One Sentry issue per reason. Console: the alert names the reason, a repeat replaces the one on the phone and buzzes again. Tests: `packages/agents/test/model-account.test.ts`, `test/db/model-account-ops1.test.ts`, `test/db/concierge-flow.test.ts` (the whole turn, rewritten for HO1's behaviour when main was merged), `apps/console/test/push.test.ts`.
- **What to do when it fires** is in `docs/RUNBOOK.md`, "The AI provider refuses calls".
- **Not covered:** the console's own label reader (`apps/console/src/label.ts`) has its own key and client; a refusal there is a typed error on that page, not this alarm. The sim and evaluation workflows use their own keys and are COST1's.

**The rest of OPS1.**
1. **Push.** `console.yml` makes the VAPID key pair once, when the Worker has none, and keeps it (a new pair would end every phone's alerts); the contact is the console's own https address, so no person's email travels in a push header; keys are never printed (`apps/console/scripts/vapid-keys.mjs --env`). A **"Send me a test alert"** button on More sends one push to the caller's own phones and says how many (`pushTestAlert`). High priority now also covers `agent_handoff`, `model_capacity`, `dead_letter`, the stalled probe and a silent customer line (data in `settings.push_alerts`, 0140 and 0141; names for each in `kinds.ts`, with a test that every kind that can push has one). "Case kinds": allergen complaints and delivery problems were already there; HO1 adds its hand-off case kinds to the same list.
2. **Sentry in all three Workers.** Console: the SDK, scrubbed like the gateway (the scrubber moved to `packages/core/src/scrub.ts`, the gateway re-exports it), tagged `service=console`, `/__sentry-test` on staging. Website: a small direct reporter (`apps/web/src/lib/sentry.ts`; the Astro entry is not ours to wrap): errors scrubbed, no request or visitor detail, twenty a minute at most. Its scrubber is a copy of the shared one, because the website may not import `@ak/core` (`test/ci/web-web1.test.ts`); a test fails if the two ever differ. Both deploy proofs are **cron check-ins to their own monitors** (`deploy-smoke-console-staging`, `deploy-smoke-web-staging`), never error events, so no deploy issue is ever opened and none needs resolving (the A4 rule); `smoke.sh` in each app checks for `flushed=true`. Same staging Sentry project as the gateway (the DSN is a public client key in each `wrangler.jsonc`); production gets its own with A3.
3. **Staff and roles** (`/staff`, admin only): add, change role or name, block and unblock through **`set_staff()`** (0141): admin only, refuses blocking or changing your own account, never touches a customer, rider or probe party, logs every change with before and after in `staff_changes`. The console makes the sign-in account and sends the link; the email is never logged. A blocked person is out on their next click (the console reads the party on every request). **Sign-in throttle:** 5 wrong tries per email and 20 per address in 15 minutes lock that key for 15 minutes (data: `settings.signin_throttle`); a locked sign-in answers 429 with `Retry-After` even with the right password; only keyed hashes are stored (no email, no IP). A database without 0141 is not throttled; any other database error refuses the sign-in.
4. **Template health** (`/templates`, ops lead and admin): every template's state (approved, pending, moved to marketing, not usable), Meta's status and category, what is sent meanwhile, and skips in the last seven days (view `template_health`, 0142).
5. **Dead-letter alert.** The gateway Worker now consumes the dead-letter queue (`wrangler.jsonc`): each message raises `raise_dead_letter` (0141), one `dead_letter` exception per hour with a count, high priority, and is acked so the queue is empty again; the stored event stays unprocessed and the minute cron hands it over again. If the alarm cannot be raised the message is retried, never dropped.
6. **`GET /health`** on the gateway (for the uptime checks below): 200 only while the minute cron has beaten in the last five minutes (`cron_age_seconds`, 0142), else 503; it says nothing else.
- **Migration numbering.** 0140 sorts before D5's 0158, which was applied to staging first. A fresh database runs 0140 before 0158, so 0140 creates what it needs from 0158 "if not exists" in 0158's own shape, the repeat logic is a new function (`claim_alert_pushes`) rather than a redefinition of `claim_exception_pushes`, and the settings row is made by whichever file runs first. A test proves the end state.
- **Not built: HO1's case alerts by role (3 minutes to the ops lead, 5 minutes to the founder and the deputy).** HO1's ladder already raises `support_case_unclaimed` at 3 minutes and `support_case_founder` at 5, both high priority, but every push goes to every subscribed admin and ops lead, and the ops WhatsApp alert to every ops recipient. Routing by kind needs a per-kind target list in the push claim (`claim_alert_pushes` and `push_targets`), the same routing in `alertOps`, and a marker for "deputy" that no role carries today (roles are admin, ops lead, picker). That is more than a small change and needs the founder to say who the deputy is. For a later session (RD1 or HO1's follow-up): `settings.push_alerts.targets` by kind, a `staff_flags.deputy`, and a test per rung.
- **Not built, and why.** The "needs you" count in the bell and the Inbox are DS1 and HO1. Sign-in by link is unchanged. Blocking does not ban the Supabase Auth user (the party block ends access at once; the workflow's `remove-staff` also bans).
- **Still not proven live:** a real push reaching a phone (nobody has subscribed one), the password email (Supabase's built-in mail reaches few addresses until SMTP is set up), the dead-letter consumer (no message has dead-lettered since the deploy), the `model_account` alarm itself (no refusal has happened since the deploy; it is proven by tests and by the real 15 November refusal text in them), and the sign-in throttle and the Staff and Template pages on the live console beyond the console deploy's own smoke test. Founder actions 1 and 2 below give the exact clicks for the first two.

**Live results, 15 November 2026, after the merge of #73 (`01d677e`, staging; read from the staging database and the staging Worker).**
- **Deploy.** `deploy-staging` run 89 (13:16 UTC, success): migrations 0140, 0141 and 0142 applied (recorded on staging), the permission check passed, `prepare-staging.sql` made the probe ops lead, the Worker deployed, the Sentry check-in answered `flushed=true`, the smoke test passed. The `web` run on the same merge deployed the website and its live check (which now includes the Sentry check-in) passed. The console deployed on the pull request (its live smoke test, with the Sentry check-in, passed on `a3d7844`, the same code as `main` apart from docs).
- **`probe_remit_cash` ran.** At 13:18:18 UTC (the first minute of the Worker's cron after the deploy) the probe's ops lead confirmed two hub drops of **152.67 and 157.67 USD**, one per probe rider; both riders then held **0 cash** (exposure back to 0 and 15.54 pending on delivery, both under 150). The ledger sums to 0.0000 afterwards.
- **The stuck orders closed.** AK-1043 (08:08), AK-1044 (09:41) and the 12:13 UTC probe order, AK-1045, were offered by the cron's "orders waiting for a rider" step within a minute, accepted, picked up and delivered by the probe riders, and are `closed` (AK-1043 and AK-1044 by 13:23 UTC, AK-1045 by 13:26 UTC).
- **The next hourly probe order closed on its own.** AK-1046: created 13:29:18 UTC, confirmed 13:30:14, preparing, ready, out for delivery 13:32:18, delivered 13:33:18, **closed 13:34:17**, payment `confirmed`, ledger sum 0.0000, no human step. Its rider's 7.77 cash was in the next remit.
- **The model answers again.** Runs with real tokens and outcome `ok` appear from 11:27 UTC (and the 12:13 and 13:29 probe orders were read by the live model); so the usage limit seen at 11:12 was lifted or the key was changed by someone before 11:27 (I did not do it, and I cannot see which). The refusal of 11:12 is the only one on record, and it was the one that went unnoticed; the alarm has had no refusal to catch since it was deployed.
- **`/health` answers.** `GET /health` on the staging gateway: HTTP 200, `{"ok":true,"cron_age_s":50}`; an unknown path is still 404.
- **The three `probe_stuck` exceptions resolved themselves** as their orders closed (13:23:14, 13:25:15 and 13:27:19 UTC, by the heartbeat). The one exception still open is `probe_handoff_released` of 12:12 UTC: the probe's chat had been left with a person by the 11:12 model refusal, and the probe released it. It is informational and waits for a person to resolve it.
- **Left as it is:** Probe rider 1 holds a few dollars between remits (the remit runs each minute and skips a rider with a job in hand), which is intended.

### Founder actions (OPS1)
1. **Switch alerts on, on your phone.** Open the console on staging in the phone's browser, sign in, add it to the Home Screen (More, "How to add it"), open it from the icon, More, **"Switch alerts on"**, allow notifications, then tap **"Send me a test alert"**. If it shows nothing, say so in the next session. Until a phone is subscribed, nothing wakes anyone.
2. **Hussein's account.** Console, **Staff and roles**, Add a person: his email, the name Hussein, role ops lead, Add. He gets an email with a link to choose a password. If it does not arrive, Supabase dashboard, Authentication, Users, his row, Send password recovery (Supabase's own mail reaches few addresses; SMTP in Authentication, Emails fixes that).
3. **Three free uptime checks** (uptimerobot.com, free plan, 5-minute interval; alerts to your e-mail and the phone app): (a) **gateway health**, HTTP(s), `https://<the staging gateway address>/health`, keyword monitoring for `"ok":true`; (b) **console**, `https://<the staging console address>/health`; (c) **website**, `https://<the staging website address>/`. The three addresses are in each deploy's run summary (`deploy-staging`, `console`, `web`: "Worker deployed" and "Console deployed"). Keep the account's e-mail on a phone that rings.
4. **Raise the model key's usage limit, or replace the key.** The limit that refused calls on 15 November returns on 1 December. Anthropic console, Settings, Limits (raise the monthly limit of the workspace behind the staging key), or make a new key and update the repository secret `ANTHROPIC_API_KEY` then run `deploy-staging`. Until then no customer message and no probe order gets a model answer. The new alarm will now say so, by push and on the ops line.
5. **Give the ops line a recipient.** The admin party has no identity on the ops line (that is the sandbox rule in `docs/DECISIONS.md`: one registered phone). Until one is registered, WhatsApp ops alerts reach no one and only push and the console list show them.

### COST1: what every model-calling workflow spends, recorded and capped, 15 November 2026 (Sonnet 5.5); migration 0139
**What is built.** One meter, `scripts/lib/model-cost.mjs`, wraps `fetch` for `api.anthropic.com/v1/messages` (so the SDK and the scripts' own calls are all counted, and no script's logic changed). It prices each response from the `model_prices` rows in force (read from the database, never hard-coded; cache and long-context rules of `agent_run_costs`), refuses a model with no price, and refuses every call once the run's total reaches its cap (a 400 whose message says `COST_CAP`; the SDK does not retry it, and the scripts' own fatal handling and item loops stop). The cap is for the whole run, across its steps (earlier steps' spend is read back). At the end it prints the total in the run summary and writes rows with `record_model_cost()` into the new table `model_costs` (workflow, run id, model, step, tokens in, out, cache read, cache write, web searches, USD, cap, stopped_at_cap). If the rows cannot be written the job fails and the lines are printed. New view `ai_cost_workflow_daily` (workflow and day), and two columns at the end of `ai_cost_daily` (`workflow_usd`, `workflow_by`); building is never part of `usd_per_order`. Migration 0139 also adds a dated price row for Claude Opus 5.5 ($4 in, $20 out, cache read $0.20, cache write $5.00 = 1.25 times input; confirmed by the founder, 15 Nov), which the language generators use and which had none.
**Wired:** `product-data` (facts, names, categories; cap input `max_usd`, default 3), `research-load` (2), `images` (2), `language-pack` (5; also the generators `gen-cases`, `gen-pack` and both live evals; one "after" pass is now the default, "before", `also_models`, "cases", "pack" and "live" only when asked; `request.json` may carry `max_usd`; the "before" pass copies the meter into the main worktree), `sim-test` (keeps its one dollar limit, `budget_usd`: empty means 27 and 33 as before, else no new conversation from 85% of it and every call refused at it; there is no second `max_usd` input; its own budget now yields rows by model and role, with the hard limit as the cap, recorded by a last step that writes the cost table only), `intake` (keeps its own `max_spend_usd`, at most 0.75, enforced between jobs; the meter records and does not refuse, because a refusal in the middle of a job would put its item on the review list). The deploy self-test `check-anthropic.sh` is not metered: it makes exactly two 5-token calls (a test pins that). The Workers' own turns are priced from `agent_runs` as before.
**Tested:** `test/ci/model-cost-cost1.test.ts` (a run stops at its cap, with the fake API and with the real SDK, and is not retried; an unpriced model is refused; the cap counts earlier steps; every entry point is metered and every workflow has a cap with a default; a new script that calls the API without being listed fails the test) and `test/db/model-cost-cost1.test.ts` (the table, the writer, the views, the old columns kept in order). `npm run typecheck` and `npm test` pass.
**Live runs, 15 Nov 2026, from `main` (`a3a7dc4`) after the staging deploy applied 0139** (each with a small cap; rows read back with `select * from model_costs` and `ai_cost_workflow_daily` on the staging project):

| Workflow (run) | Model, step | Calls | Input | Output | Cache read | Cache write | USD | Cap | Stopped at cap |
|---|---|---|---|---|---|---|---|---|---|
| product-data, names (43717649989-1) | claude-haiku-5-5, names | 22 | 47,888 | 27,595 | 0 | 0 | 0.018586 | 0.05 | no (finished) |
| language-pack, after (43717660119-1) | claude-haiku-5-5, after | 203 | 55,763 | 49,292 | 1,392,690 | 57,136 | 0.051291 | 0.05 | **yes, but recorded `false`** (see below) |
| sim-test, 2 scenarios (43717662821-1) | claude-haiku-5-5, concierge | 50 | 103,121 | 17,941 | 357,100 | 0 | 0.022854 | 0.50 (`budget_usd`) | no |
| | claude-sonnet-5-5, customer | 16 | 64 | 805 | 39,698 | 6,625 | 0.028710 | | |
| | claude-sonnet-5-5, judge | 2 | 8 | 556 | 1,330 | 4,750 | 0.017584 | | |
| intake, 2 jobs (43717665487-1) | claude-haiku-5-5, intake (6 web searches) | 2 | 92,429 | 3,625 | 0 | 0 | 0.071055 | 0.05 | yes |
| images (43717655869-1) | none | 0 | | | | | 0 | 0.05 | no row: 0 items, all 5 already looked at to the end |
| research-load (43717653024-1) | none | 0 | | | | | 0 | 0.05 | no row: all 291 research files already loaded |

`ai_cost_workflow_daily` for 2026-11-15 then read: intake 1 run, 2 calls, 0.071055; language-pack 1 run, 203 calls, 0.051291; product-data 1 run, 22 calls, 0.018586; sim-test 1 run, 68 calls, 0.069148. Total 0.21 USD for all six runs.
What the runs showed: (1) the whole path works against the real staging database (prices read from `model_prices_in_force`, earlier-step spend read back, rows written by `record_model_cost`). (2) The intake row (0.071055) matches `intake_runs.research_spend_usd` (0.071056) to a millionth. (3) The language-pack run was stopped by its cap after 203 calls and failed its last assertion as designed ("the run stopped at its cost cap: its scores are incomplete"); its total passed the cap by the calls in flight (8 at a time). (4) Intake passes its cap by one job (0.071 against 0.05) because it checks between jobs; six web searches were 0.06 of it. (5) **Bug found and fixed (follow-up pull request):** a loop that stops starting items at the cap (language-pack's eval, images, product-data facts, research-load) never counted as a refusal, so its row said `stopped_at_cap = false`; they now call `meter.capStop()`. The language-pack row above keeps its old `false`; the table was not edited. (6) `images` and `research-load` made no model call because the catalogue and the research files are already worked through, so they have a summary line ("0 model calls") and no row; to see a row, run them with `force` (it adds new proposals on staging, so it was not done). (7) The language-pack run also pushed `language-pack-out/43717660119` and product-data pushed `product-data-out/43717649989`; the first holds an incomplete scores file (cut at the cap): do not copy it into a working branch.
Not done on purpose: no Anthropic workspace, key or limit was touched (decision 12); calls in flight when a cap is reached finish and are counted, so a total can pass its cap by those calls; `gen-cases` and `gen-pack` on the whole catalogue (Opus) may need a cap above 5, and were not run.
**Founder action:** none. (When a run is stopped at its cap the run summary says so in bold and the job log has a warning.)

### Where the build stands (14 November 2026, after H1)
- **On `main`:** Phase 0 (A1), ordering B1 to B4, hub C1 to C4, console D1 to D4, infra A2, A4, A5 and A6, pictures P1 and P2, product data N1, catalog K1, audit S1, reply speed SP1, G1 fixes F1, research R1 to R4, delivery windows W1, intake I1 and the commerce core C4 (pull requests 1 to 57). Per-session records: `docs/history/HANDOFF_sessions_2026-11-13_14.md`.
- **Open pull requests at the time of writing:** M1 (message design, #54: built and tested; the coordinator's merge condition of 15 Nov met by language-pack run 43677251482, see "Session M1" below) and the A5 follow-up (#51, the section "A5: infra, live results" below). WEB1 merges beside it.
- **Wave order** is in `docs/BUILD_PLAN.md` ("Waves"): waves 1 and 2 are done, H1 is this hygiene pass, wave 3 is M1, I1 (merged) and C4 (merged).
- **Tests:** `npx tsc --noEmit` clean; `npx vitest run` 1,202 passed and 43 live-only skipped on 14 November (local, before H1's last edits; CI runs the suite on every pull request). `TEST_REPORT.txt` is gone: CI is the record.
- **Everything live is staging only.** Nothing has run with real customers, real money or the two +961 numbers.

### A5: infra, live results, 14 November 2026 (Sonnet 5.5)
A5 itself (K1's lane A request, G1-15, 17, 18, 24, audit points 8 and 11; migrations 0115 and 0116) merged as #47; its record is in `docs/history/HANDOFF_sessions_2026-11-13_14.md`. This follow-up (#51) adds the Cloudflare usage job and writes what staging showed. Nothing was dispatched to deploy from a branch; the proofs are workflows, read-only against staging apart from the removed test rows. Typecheck and tests green.
- **Deploy** (`deploy-staging` run 43618662635, main): 0115 and 0116 applied (87 of 87 migration files recorded), permission check clean ("every function in public has a fixed search_path"), the public `catalog` bucket step passed (public, pictures only, `media` still private, anonymous listing refused).
- **Pilot settings** (`supabase/seed/proposed_pilot_settings.sql`, loaded once by `scripts/ci/load-seeds.sh`, marker row `seed_applied:proposed_pilot_settings`): `villages: 42, served: 25`, `small_order_fee: {"fee_usd": 0.50, "below_subtotal_usd": 10}`. Later deploys skip it, so the console owns both values now.
- **Research-load coverage** (run 43622422904, main): 291 research files for 291 active items. Pictures: **none 271, approved 0, proposed 20** (18 `public_page`); this run's reasons: 181 `none_passed` the vision check, 90 `no_candidates`, 20 already have one. Facts: **258 proposals on 98 items** (ingredients 54, nutrition 66, origin 30, storage 26, allergens 41, halal 11, vegan 0, vegetarian 0), **0 approved from a web page**; 93 files with no facts, 93 `unsure_match`, 7 nothing usable. The feed is therefore still empty and the public bucket holds no object.
- **1.23 on staging** (`staging-new-product`, run 43624878533, then 43625199420): one new product (`AK-A5-PROOF`, Qalamoun Pomegranate Fizz 330 ml, 1.50 USD, 40 at the hub) was queued by the trigger, taken by the Worker's cron and built by the real model in about 52 s: job `done`, **37 words** (brand, exact and kind words in Arabic, Arabizi, English and French, e.g. `قلمون رمان`, `qalamoun rommen`, `pomegranate fizz 330`, `soda grenade`), nothing dropped, **4 of 4 phrasings resolved to it, 0 on the review list**. Removed afterwards: `rows left: 0` and every other item's search words unchanged (fingerprint before and after). A first run with no price and no stock ended `review` with 0 of 4: the planner only matches what can be sold, so the workflow now gives the product an offer and stock. Not "through the console": the console has no page that creates a product and may not insert.
- **Usage** (`usage-check`, run 43624875274, both jobs green). Supabase, free plan: database **35.1 MB of 500 MB (7.0%)**, storage **1.3 MB of 1 GB (0.1%)**; **egress left off** (see the open requests). Cloudflare, Workers Paid limits (10,000,000 requests and 400,000 GB-s of Durable Object duration a month), whole account, month to date: **17,055 requests (0.17%, projected 0.4%)** and **18,154 GB-s (4.54%, projected 9.9%)**. The deploy token **can read analytics**, so no new permission was needed; if it is ever cut the job says "LEFT OFF" and names "Account > Account Analytics > Read" instead of failing. The account also runs two other Workers (`cupsy-coffee-dream` 11,604 requests, `kabsi-go` 2,115): the check counts the whole account because the plan bills it. Figures are Cloudflare's analytics, not its invoice.
- **Not live yet:** Meta steps A to C and approved pictures, so no picture has been copied; the first real status webhook for `outbox_mark_from_status`; the first real inbound picture or voice note (where Kapso redirects media).

### BK0: free backups and a repeated restore, 15 November 2026 (Sonnet 5.5)
**Built.** `.github/workflows/backup.yml` (01:30 UTC nightly and by hand; 14:00 UTC freshness check; environment is a parameter) and `.github/workflows/restore-check.yml`
(Mondays 03:30 UTC and by hand), with `scripts/backup/` (`dump.mjs`, `store.mjs`, `restore.mjs`, `restore-run.sh`, `alert.sh`, `pgclient.sh`, `lib.mjs`). The dump
is `public` plus the migration record from one exported snapshot, so the manifest (row counts, migrations, ledger total) matches the dump exactly; it is encrypted
with gpg symmetric AES-256 (`BACKUP_PASSPHRASE`) and stored in R2 `ak-backups/staging/` (14 nightly, 8 weekly, a read-back checksum before anything is pruned), or in the private Supabase
`media/backups/` when the Cloudflare token cannot use R2. Never an artifact, never printed; the run stops with a clear message if the secret is missing or under 24 characters.
The restore check decrypts the newest copy, restores it into a `postgres:<major>` container on the runner and checks migrations, every table's row count, and the ledger (zero, per transaction, equal to the manifest).
A copy older than 36 hours raises ops exception `backup_stale`; a failed check raises `restore_check_failed`; each also sends a Sentry error event, and a green check resolves it. Production: same files, `BACKUP_ENVIRONMENTS`, `*_PRODUCTION` secrets (header of `backup.yml`).
**Tested.** `test/pg/backup-bk0.test.ts` runs the real scripts against a real Postgres (dump, encryption, directory store, restore into an empty database, every check, three failure cases, the alert) and `test/ci/backup-bk0-workflows.test.ts` reads the workflows for the rules. `npm run typecheck` and `npm test` green.
**Proven live on `main`, 15 November 2026 (staging), both green on the first run** (GitHub does not allow a new workflow to be dispatched from a branch, so the first runs were after the merge of #67):
- **Backup:** [`backup` run 43703456354](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43703456354) (workflow_dispatch, `main` at bfe291a): the pooler dump, encryption and upload worked, **the copy went to R2** (`ak-backups`, `staging/20261115T101924Z.tar.gpg`; the Cloudflare token already has R2 rights, so no token change and no fallback), it read back with a matching checksum, and the freshness check read the new copy as 0.0 hours old.
- **Restore check:** [`restore-check` run 43708874550](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43708874550) (workflow_dispatch, `main` at d113621) fetched that copy from R2, decrypted it, restored it into a `postgres:17` container (the server is Postgres 17) and every check passed: 107 migrations recorded (manifest 107; the repository has 107 files), 127 tables with every row count equal to the manifest, 304 ledger entries, the ledger sums to 0.00, every ledger transaction balances, ledger total equals the manifest. The extension `supabase_vault` is not in the image and was skipped; the dump does not need it.
- **Not exercised live:** the Supabase fallback store (R2 worked, so it was never needed), the `backup_stale` and `restore_check_failed` alerts (the raise path is covered by `test/pg/backup-bk0.test.ts` against a real Postgres, and the green runs ran the "resolve if open" path, which found nothing open), and the first scheduled runs (01:30 and 14:00 UTC nightly, Monday 03:30 UTC for the restore check). Look at the Actions list after the first night.
- **A flaky assertion in the encryption test** (it searched the ciphertext for the three bytes `bk0`) was fixed in #70: it now checks the gpg header and that the decrypted manifest text is not in the ciphertext.

### Founder actions (backups)
- **`BACKUP_PASSPHRASE` is set** (24 characters), and the runs above used it. It exists only with you: keep it in your password manager and one sealed paper copy. Lose it and every copy is unreadable (`docs/RUNBOOK.md` "Backups and Restore"). Nothing else is needed from you for staging.
- **No Cloudflare token change is needed.** R2 worked with the existing `CLOUDFLARE_API_TOKEN`. If it ever stops (a rotated token without R2 rights), the next backup run falls back to the private Supabase bucket `media/backups/` and says so in its summary; the fix is then: Cloudflare dashboard, My Profile, API Tokens, open the token that is the repository secret `CLOUDFLARE_API_TOKEN`, add **Account, Workers R2 Storage, Edit**, save.
- **For production later:** repository variables `BACKUP_ENVIRONMENTS` (`staging,production`), `SUPABASE_PROJECT_REF_PRODUCTION`, `SENTRY_DSN_PRODUCTION`, and secrets `SUPABASE_ACCESS_TOKEN_PRODUCTION`, `SUPABASE_DB_PASSWORD_PRODUCTION`, `SUPABASE_SERVICE_KEY_PRODUCTION`, `CLOUDFLARE_API_TOKEN_PRODUCTION`, `BACKUP_PASSPHRASE_PRODUCTION` (a different passphrase from staging's). A production run never falls back to a staging secret.

### B1a: basket integrity, 15 November 2026 (Opus 5.5)
Ordering lane, branch `claude/beautiful-archimedes-d93rkb`, one pull request. No migration. SIM1's fixes 1, 3, 4, 9 and 10 and its two
no-reply turns (`docs/SIM_REPORT_2026-11-15.md`), each from a failing case of `evals/cases/sim_*.json` written as a flow test
(`test/db/basket-b1a.test.ts`, 18 tests). Hand-off code and language detection are untouched (B1b).

| Fix | What B1a built | Tested by |
| --- | --- | --- |
| 1, minimum order | Coordinator decision 2 of 15 Nov 13:30: **$5 minimum, no small-order fee at launch** (the founder may overrule: the amount is the setting `min_order_usd`, not code). A complete basket under the minimum gets one fixed message by code: the minimum, the basket and the gap, each from `quote_order`'s `below_minimum` issue, with two buttons: Browse and Cancel order (a "+n item" button was removed in the follow-up, below). The basket is kept (`awaiting = "minimum"`); items said next are added to it; "what is the minimum?" is answered by code (the gap, or the setting with no basket). Said before the pin, the address or the window; `issueCard` and `sendBasket` check it too, so `send_confirmation` or a tap never falls silent on it. The output guard refuses the model's own words about the minimum (`minimum_by_code`). Seeds: `proposed_pilot_settings.sql` sets no fee; `minimum_order_2026_11_15.sql` applies the decision **once** per database (`scripts/ci/load-seeds.sh` step 4, its own marker), so staging gets it on the first deploy after merge and the console owns it after | `basket-b1a` (sim-208, sim-024, sim-009), `test/pg/load-seeds-a5.test.ts` (real Postgres), `messages.rules` |
| 3, basket kept | The basket in hand is `state.lastQuote` (or the card waiting on the tap, read back with `basket_from_order`). Lines already matched are kept when another line needs a question, so the answer adds to them. "Where is my order?" with a basket and no order placed answers with the basket so far and its next step (pin, house, number, window, minimum or the card), never "no open order"; no "same as last time" offer over a basket. A basket untouched for 6 hours is let go (one kept overnight stays). A retried turn never edits the card its own first attempt made (G1-21) | `basket-b1a` (sim-009, sim-024, items said early), `reply-speed-sp1` |
| 4, only what was picked | A reading line has a new optional `change` (add, set, remove; `schemas.ts`, prompt). Code applies edits to the basket (`packages/agents/src/basket.ts`): add adds ("add 2 more" is +2), set re-counts, remove takes off; a line with no `change` adds a new item and re-counts one already there (a restated order never doubles). An edit names a product in the basket: the planner's choice, its one candidate in the basket, a name match, or the catalogue search for the words. A substitute the quote listed replaces the line that ran out. The Concierge's `quote_order` now sets lines and keeps the rest (`remove` takes off), never replaces the basket. A new card after a change to a card says what changed (`+ 2 × …`, `− …`, `… 2 → 4`); the old card is withdrawn as before | `basket-b1a` (sim-215, sim-122, sim-020), unit cases; `evals/cases/basket_edits.json` (8 live reading cases, `evals/live`) |
| 9, refused cancel | Cancel tapped on an order the database will not cancel (being prepared, on its way): the fixed line "it is being prepared, a person will call you" and a case of kind `order_problem` (`cancel_refused: AK-…`), whose `support_case` exception alerts ops. Never the error line with a "try again" that fails the same way | `basket-b1a` (sim-112, sim-215) |
| 10, catalogue claims | `show_catalog` that cannot show the WhatsApp catalog answers with the fixed line "tell me what you need" by code (an unknown category still goes back to the model). The guard refuses "the catalogue is not ready" always, and "the only one" / "no other" unless `search_catalog` ran this turn (`catalogue_claim`) | `basket-b1a` |
| No-reply turns | A window tapped for a basket that cannot go (under the minimum, an item gone overnight) always gets an answer: the minimum, what ran out, or the fixed question with buttons (`explainNotSent`) | `basket-b1a` (sim-009, sim-014) |

The simulator report gains "Basket integrity (B1a measures)" (`evals/sim/basket-measures.ts`): minimum-order loops (the minimum said in two
or more turns, at least once without an amount), lost baskets («no open order» after the first turn) and wrong products (the judge),
against SIM1's counts on the same definitions, read from run 43696512658's results: **first 150 scenarios 66, 11 and 40**; all 463 judged
first attempts 227, 40 and 143. B1a's target: each down by at least 80% (at most 13, 2 and 8 of 150), and no new failure class.

Files outside `packages/agents/src/` and `evals/`, and why: `apps/gateway/src/turn.ts` (the new buttons, the refused cancel, the window
tap's answer, the basket's age), `supabase/seed/*` and `scripts/ci/load-seeds.sh` (the settings, as asked), `docs/ARABIC_REVIEW.md`
(nine new Arabic lines, **not read by a person yet**), the tests. No migration, gateway allowlist, price source or confirmation path changed.
Not done here: the two carried ordering bugs (the size-only line; «بدي أغراض لمجدرة», a reading of off-topic that is B1b's fix 8).

**Tested here (CI, no key):** every row above; `npm run typecheck` clean, `npm test` green.

**The language gate holds** (`language-pack` on this branch): [run 43719075127](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43719075127),
990 readings, **F1 0.907, wrong products 0**, the 0.13 demo right; the live cases [run 43719919354](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43719919354)
**58 of 58**, the 9 basket-edit cases among them. The first gate run on B1a's first prompt (43718261533) read «مشيلي الطلب» (go ahead) as a
cancel after the remove example «شيل الخبز», and gave one wrong product («كرتونة بيض هوا», the brand read as its own line); the example was
changed to «ما بدي الخبز» and both came back right. Two live misses of the second run («عندي وجع راس، شو آخد دوا؟» unreadable once, a voice
address read with a village) passed in the third; the off-topic eval now prints a reading's contract errors when one is unreadable.

**Staging:** the deploy after the merge (deploy-staging 43721208341) applied the seed once: `min_order_usd: 5`, `small_order_fee: {"fee_usd": 0, "below_subtotal_usd": 0}`.

**The simulated customers on `main`** ([sim-test 43722643280](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43722643280), limit 150,
budget USD 4, spent **$3.51**; main at 16dea0e, PR #77), against SIM1's first run on the same 150 scenarios:

| | SIM1 (first 150) | B1a on main | target |
| --- | --- | --- | --- |
| minimum-order loops | 66 | **0** | at most 13: met |
| lost baskets («no open order» after the first turn) | 11 | 6 | at most 2: **not met** |
| wrong or uninvited product (judge) | 40 | **71** | at most 8: **not met, worse** |
| passed | 35 | 39 | |
| dead end / repeated question / goal not reached | 72 / 60 / 93 | 29 / 31 / 71 | |
| message rules / no reply / turn error / silence after hand-off | 70 / 2 / 1 / 25 | 35 / 0 / 0 / 0 | |

No failure class appeared that SIM1 did not have. Why two targets were missed, read from the transcripts:
- **Wrong products: the "+n item" button.** 49 of the 71 name it: the minimum line offered "+7 Lipton" (the fewest units of one basket
  item that reach the minimum); customers tapped it and the judge counted the quantity as one they never chose. The rest: words of an
  address read as an item while the basket waited on the house («البناية البيضا» read as eggs, «بيض»), and the minimum said before a
  food question was answered (an item "added before the gluten question was settled").
- **Lost baskets: 5 of the 6 are not baskets.** A customer asking after an open request for a person ("when will someone answer?")
  was read as "where is my order" and told "you have no open order". The sixth is "same as last time" with no earlier order.

**B1a follow-up** (this section's second pull request): the "+n item" button is gone (the minimum line keeps Browse and Cancel; the
customer names what to add); a line whose words are part of the address just given is the address, never an item; a stated restriction
or an unclear line goes to the loop before the minimum is said; "where is my order?" with no order, no basket and a request open gets
the request's reminder. Three flow tests, each failing on the first B1a code (`test/db/basket-b1a.test.ts`, "what the B1a run on main
showed"). Merged as #79.

**The second run on `main`** ([sim-test 43730014902](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43730014902), limit 150,
budget USD 4, spent **$3.49**; main at cbc9d8b): minimum-order loops **0**, lost baskets **3**, wrong products (judge) **54**, passed 41;
no new failure class. Read one by one (all 54 transcripts): **17 were the customer's own additions** (padding to the minimum: "add 2
more", «زيدلي»), which the judge counted against the scenario's first wish; 3 had no wrong product; **34 were the shop's**:
- the planner picked one product for a generic word («ربطة خبز», «قنينة مي», «توم جاهز», a brand alone): 9;
- a wrong match or size (Tannourine 6 L for 2 L × 6, UHT milk for laban): 7; an item nobody asked for (cooking cream after "beer",
  a question's example added): 5;
- add read as set or set as add («٣ بيبسي ... مش ١ بس» gave 4; «it says 9 ... 9 total is fine» gave 17): 7;
- the model said it changed the order when no tool had (sim-079, sim-146, sim-052): 3 as the main cause, and in 7 more as a second fault;
- an item dropped: 2; an ordinal («ربطة خبز تالتة» gave +3): 1.

The 3 lost baskets: twice "edit" on a card sent it back to a draft, and the next "where is my card?" found no order (sim-079, sim-146);
once the model said "your card is on its way" with no basket at all (sim-082).

**B1a second follow-up** (third pull request): "edit" on a card keeps its lines as the basket being changed (`holdDraft`), so the next
words edit it and "where is my order?" brings it back as a card; "where is my order?" with a card waiting for the tap gets its status line
and the card again; the Concierge's `quote_order` on a card waiting for the tap edits that card's basket instead of starting one; the guard refuses
"I changed / updated / «عدّلنا» / «ثواني وبحدّث»" unless `quote_order` or a card changed the basket this turn (`change_claim`); an
ordinal from three on («تالتة», "third", «رابعة») makes that count in all; the gateway's second check of model words now receives the
turn's tool results (a search, a change), which it did not, so "the only one we have" after a real search was refused at the gateway.
The judge's rubric for a wrong product now says what the customer added themselves is what they asked for (`evals/sim/judge.ts`), so
runs from here are not directly comparable with SIM1's 40 on that line; the report says so. Five flow and unit tests, each failing on
#79's code ("what the second B1a run on main showed").

**Not done in B1a, and why:** a generic word picked as one product, and wrong sizes, are the planner's choice in SQL (`plan_order`);
changing it needs a migration, and B1a has none reserved. Add-versus-set phrasings beyond the ordinal («مش ١ بس», "so 9 total") are
reading cases for the language pack. Merged as #80.

**The third run on `main`** ([sim-test 43736730998](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43736730998), limit 150,
budget USD 4, spent **$3.51**; main at 658ef95), against SIM1's first run on the same 150 scenarios:

| | SIM1 (first 150) | run 1 (#77) | run 2 (#79) | run 3 (#80) | target |
| --- | --- | --- | --- | --- | --- |
| minimum-order loops | 66 | 0 | 0 | **0** | at most 13: **met** |
| lost baskets («no open order» after the first turn) | 11 | 6 | 3 | **0** | at most 2: **met** |
| wrong or uninvited product (judge) | 40 | 71 | 54 | **34** | at most 8: **not met** |
| passed | 35 | 39 | 41 | **48** | |
| goal not reached / dead end / repeated question | 93 / 72 / 60 | 71 / 29 / 31 | 71 / 23 / 29 | 58 / 22 / 24 | |

No failure class appeared that SIM1 did not have (the eight classes are SIM1's). Run 3's wrong-product line uses the clarified judge
rubric (the customer's own additions are not counted), so it is not like for like with SIM1's 40. What its 34 name, from the judge's
problems: a basket kept overnight whose counts drift or lose a line when it comes back in the morning (sim-021, -028, -067, -104,
-105); a generic word or a brand alone picked as one product, and sizes (sim-016, -140, -145, -099, -025); «بيضا» (white, of a
building) read as eggs outside the address step (sim-113, -117); "32 pieces" read as 32 packs (sim-147); add read as set or the
reverse («3 kman», "add N more": sim-040, -066, -110). **What B1a leaves open:** the overnight basket's counts (the kept-order path,
`sendKept`), the planner's generic and size picks (`plan_order`, needs a migration), and the reading cases (pack sizes, «بيضا»,
add versus set) for the language pack. **Not proven:** WhatsApp itself.

### HO1: the never-stranded hand-off, 15 November 2026 (Opus 5.5)
Hand-off lane, branch `claude/confident-albattani-a84wbj`, one pull request. Migrations 0135-0137 (0138 held, unused). Specification:
`docs/strategy/05-console-website-design-handoff.md` section D. Baseline (SIM1, the old behaviour): 96 hand-offs, 89 customers left
in silence, 176 messages unanswered. **The principle now in code: a person is added to a chat; the bot is never removed. A technical
failure is not a hand-off.** `conversations.human_handoff` is no longer read by the turn code, and 0135 cleared every lock.

| Item | What HO1 built | Tested by |
| --- | --- | --- |
| The case record | 0135: `handoffs` is the case (kind, topic, order, source, state open/claimed/resolved, who and when, call-back, after hours, late, outcome, complaint link); one open case per chat and kind; `support_cases` view; `conversations.bot_paused_until`; `settings.support` (3/5/15 minutes, pause 10, reminder 10, unanswered 2, credit 5/10/2). Functions `open_case`, `claim_case`, `staff_replied`, `release_pause`, `resolve_case`, `request_callback`, `case_remind`; `open_turn` also returns the pause and the open cases; `release_handoff` (0045) now ends the pause. Older rows: open ones stay open, flagged late, ladder already run (seen in the Inbox, nobody woken) | `test/db/handoff-ho1.test.ts` (21) |
| The nine lock reasons | Model unavailable, agent error: the turn is queued again once after 60 s (`RetryTurnLater`, the Durable Object), then the fixed technical line with Browse and Talk to a person and an ops exception `technical`. Did not finish: one fixed question with three buttons. Hourly cap: a fixed menu (browse, my order, a person), no model call. Button, window, substitution error: the error line with a "try again" button that repeats the tap, and a `technical` exception. "A problem with my delivery", the planner, the model's `handoff_human`, the customer asking: a case. No case is ever a lock | same file; `concierge-flow`, `no-reply-sp2`, `ordering-b2`, `ordering-b3` updated to the new behaviour |
| "I want a person" by code | `packages/agents/src/person-request.ts`, before any model: Lebanese Arabic, Arabizi, English, French; plus "chase" ("when will someone answer?", "is anyone there?") while a case is open. Cases first in `evals/cases/person_request.json` (65: the SIM1 customers' own words and invented ones, 16 must-not-match) | `evals/test/person-request.test.ts`; the four forms open a case and the bot then answers a price question |
| The customer's lines | `messages(...).support` in ar, en, fr: opened (with a call-me-back button when asked for a person), reminder (at most every 10 minutes; in between the Concierge answers, told the request is open), still on it at 5 minutes (Keep ordering, Call me back, Voice note), resumed after a quiet claim, after hours (the real opening time), resolved. A food fact the model hands off is not a case: the fixed "not confirmed in our records" line (invariant 15) | `messages.rules.test.ts` (rules and snapshots), `arabic-review.test.ts` |
| Arabic for a person | `docs/ARABIC_REVIEW.md`: every new Arabic line with its English, a column for the reader's initials. Model-written; **not read by a person yet** (gate A needs it) | the test keeps the file in step with `ar.ts` |
| Timers and the alarm | 0136 `case_timers_due()` on the gateway's minute cron, open hours only: 0 `support_case`, 3 min `support_case_unclaimed`, 5 min `support_case_founder` and "still on it" to the customer, 15 min late; a claim gone quiet for 10 minutes returns the chat to the bot (which says so) and the case to the ladder. Each step closes the previous one, so a case has one open exception; a claim or a reply closes it. `customer_unanswered()`: any customer message with no reply of any kind for 2 minutes in open hours raises a `customer_unanswered` exception once. All five kinds are in `settings.push_alerts` (high priority: pushed by D5's console cron, and on the staff line by `ops_exceptions_due`) | ladder, after-hours, alarm tests in `handoff-ho1` |
| Safe automatic credit | 0137 `auto_credit_missing_item()`: a missing line the picker recorded on a prepaid order is credited only within the three limits; over one, a refund case for a person and no money moves. `pick_remove_line` (0107's text) calls it. Every decision in `auto_credits` with the picker; `case_metrics()` counts them; the Inbox lists them per picker for the spot check | a real pick through `start_pick`/`pick_item_missing`, books balanced |
| The Inbox | `apps/console/src/pages/inbox.ts`: open cases by timer (kind, order, last message, who has it); one case shows the chat, the order and a reply drafted by code from the read-only `case_context()` (no model; edited, then sent through the gateway in one tap, which renews the pause); claim, give back, resolve with an outcome and one closing line. Today's "waiting" count and the exceptions page now read open cases; `kinds.ts` names the new exception kinds | `apps/console/test/inbox.test.ts`, `exceptions.test.ts` updated, shell check |
| The simulator | `evals/sim/driver.ts`: "after a hand-off" is now an open case (or the old lock), so a silent turn after a case is still counted; `report.ts` groups case kinds and counts the case's exception as the alert | `evals/sim/test` (36) |

Files outside the session's list, and why: `packages/agents/src/concierge-tools.ts` and `pipeline.ts` (the two places that wrote the lock),
`packages/agents/src/support.ts` and `person-request.ts` (new), `apps/gateway/src/index.ts` (the cron steps and the one-minute requeue),
`apps/console/src/pages/{index,today,exceptions}.ts` and `kinds.ts` (they read `human_handoff`), `evals/sim/{driver,report}.ts` (the
measure), the tests above. No price source, gateway allowlist, prompt or confirmation path changed.

**Not built, and why.** Push by audience (3 minutes to the ops lead only, 5 to the founder and deputy): push goes to every admin and ops
lead, as D5 built it; who gets which tier is OPS1's (roles). The model's own hand-off reason is classified by code
(`kindOfReason`); "below the minimum" and "cancel refused" are left to B1a as asked (they open an ordinary case today). The
spot-check tab for automatic credits is a section of the Inbox, not the approvals spot-check page.

**Proven here (CI, no key):** every "Done when" item of section D except the last, each with its test. **Not proven:** the
simulated-customer run (below); WhatsApp and Kapso (the buttons and the 60-second requeue on the live Durable Object); a push reaching a
phone; the Arabic read by a person; 0135-0137 on the staging database (applied only in the test database until the next deploy).

**The simulated-customer run: zero silences after a hand-off.** [`sim-test` run 43711132002](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43711132002),
limit 150, HO1's code (3637be6; the two later commits only fix a test's escaping and merge `main`), `claude-haiku-5-5` as the Concierge,
15 Nov 11:58-12:22 UTC, **$3.45** (the key's limit no longer refused calls; SIM1's follow-up ran just before). Dispatched on the branch so the result could land in this one pull request.

| | SIM1 baseline (500, old code) | HO1 (first 150) |
| --- | --- | --- |
| conversations with a hand-off | 96 (19.2%) | 27 (18.0%): person 8, complaint 8, refund 6, order problem 5, payment 2 |
| an ops alert raised for it | 94 | 27 (`support_case`) |
| **customers left in silence after a hand-off** | **89** | **0** |
| **follow-up messages with no reply** | **176** | **0** |
| person / complaint / refund scenarios passed | 0 of 42 | 2 of 16 |
| all conversations passed | 16.6% | 20.0% |

What still fails in the person scenarios is the judge's "goal not reached" (no person ever answers in a simulation) and the ordering
classes B1 owns. The one `no_reply` turn in the run (sim-103, a tap on a kept night order) had no hand-off: the class SIM1 already
reported (sim-009, sim-014), for the ordering lane. The full report is the run's `sim-results` artifact.


### SIM1: simulated customers, 15 November 2026 (Opus 5.5)
Evals lane, branch `claude/gallant-feynman-yhrzow`, pull requests #65 (tooling, merged) and the report's. No migration; no product file changed.
Files: `evals/sim/**`, `.github/workflows/sim-test.yml`, `docs/SIM_REPORT_2026-11-15.md`, `evals/cases/sim_*.json`, this section, the SIM1 row.
- **Built and tested (CI, no key):** 500 seeded scenarios (`evals/sim/scenarios.json`: the brief's 14 categories, ar 225, Arabizi 125, en 75,
  fr 50, mixed 25; 125 voice notes at transcript level, 50 bursts; five seeds regenerate the same scripts); a GET-only copy of staging's
  catalogue and settings (no parties, chats, orders or media); the fetch guard (staging GET-only and closed after the copy, Kapso recorded and
  never called); the real conversation object, turn code, tools and gateway; per-turn checks; the budget guard; the report. `evals/sim/test`
  (36 tests) includes a whole run with stand-in models against a fake staging: GET only during the copy, nothing sent.
- **Run on main** (`sim-test` 43696512658, code `afc8f81`; smoke run 43696258577 before it): 500 conversations, **463 judged, 77 passed (16.6%)**.
  **Spend $11.40 in all** ($0.13 smoke + $11.27), against USD 33. The key behind `ANTHROPIC_API_KEY_SIM` has its own usage limit and stopped
  at that point until 1 December: the last 37 conversations and every repeat of a failing seed could not run, so how often a failure repeats is
  not measured. Staging: 32 GET requests, nothing else; Kapso: 3,372 sends recorded, none sent.
- **What held on every turn:** no order confirmed without the customer's tap, no card total unlike the database, no amount in model text that
  no tool returned, nothing sent after STOP.
- **The ten fixes, owners** (`docs/SIM_REPORT_2026-11-15.md`): (1) the minimum order said by code with its amount, one rule with the small-order
  fee (55% of conversations; ordering lane, message design); (2) no silence after a hand-off (89 of 96 handed-off customers; hand-off);
  (3) the status shortcut must not answer "no open order" while a basket is being built (ordering lane); (4) the basket changes only by what the
  customer picked (ordering lane); (5) a first order without a map pin (address 0 of 34; ordering lane, L1); (6) replies in the customer's
  language, Arabizi included (message design); (7) line length and Latin digits in model text (message design); (8) greetings and thanks are
  not off-topic (ordering lane); (9) a refused cancel gets a fixed answer, not a `button_error` hand-off (ordering lane, hand-off); (10) no
  catalogue claim without a tool result (ordering lane). Failing cases: `evals/cases/sim_<class>.json` (12 classes), not fixed here.
- **Second sample** (asked for after the report): not started. Spend is under USD 25, but the key cannot call before 1 December, so it could
  not finish by 16 Nov 20:00 UTC. Needs the key's usage limit raised (or another key as `ANTHROPIC_API_KEY_SIM`) and a seed input on `sim-test`.
- **Only a live account can prove:** everything outside the turn code: WhatsApp and Kapso, the webhook queue and burst timing, real audio, the cron
  alerting ops, and the WhatsApp catalogue (not connected on staging; the Concierge called it "not ready").

### SP2: no-reply turns, 15 November 2026 (Opus 5.5)
Ordering lane, branch `claude/tender-clarke-zfo77t`, PR rashidhamzy-hue/alo-king#63. No migration (0200-0201 held, unused).
**The bug** (M1's finding; once on staging, 14 Nov 08:13 Beirut, an address-only message with no basket): a turn of the open-question loop
ended with nothing the customer could act on and the chat went to a person (`handoffs.reason = agent_did_not_finish`). Two causes in
`concierge.ts`: an ask call stopped at `max_tokens` (1024) before any tool; or the model called `extract_order`, was told "already
recorded", and ended the turn with free text («I'll reply once I've checked the catalog») or nothing.

| Item | What SP2 built | Tested by |
| --- | --- | --- |
| Eval cases first | `evals/cases/no_reply.json`: 9 recorded step sequences (stop reason, tools, free text) of both causes, replayed through the real ask loop, and 8 live messages (an address with no basket, orders, allergy, gluten, area and French questions). Invented names and addresses only. 15 of the 17 new tests failed on the loop before the fix | `evals/test/no-reply.test.ts` (13), `test/db/no-reply-sp2.test.ts` (4) |
| The cap | Ask calls get `max_tokens` 4096 (`ASK_MAX_TOKENS`; only produced tokens are billed). A response cut at the cap is dropped and never run (a cut tool call is half written; `capped-mid-tool-call`) and the step is asked again | `capped-before-any-tool`, `capped-mid-tool-call`, `capped-twice`, `address-only-no-basket`, `order-capped-then-pin` |
| `extract_order` then silence | Answered «already recorded, in `reading` (null: use the customer's words); do not call it again; answer the customer now». A step with no tool call is answered `ANSWER_NOW` (only a tool reaches the customer; reply, or the pin, card or catalog; a handoff only if you truly cannot help) | `extract-order-then-silence`, `extract-order-then-nothing`, `extract-order-then-search-then-reply` |
| Stalls | A step that reached nobody (cut, no tool, or only `extract_order`) is a stall. After one, the next call runs at effort low; after two, and on the loop's last step whatever came before, the call is forced to `reply` (`tool_choice` tool, as the reading already is on Haiku 5.5). Normal steps are never forced | `capped-twice`, `never-answers` |
| A handoff when the model truly cannot answer | Still fail closed: after six steps, `handoff_human("agent_did_not_finish")`, which sends the fixed handoff message. `runAskLoop` now returns `outcome: "handoff"` with the reason also when the model calls `handoff_human` itself (it returned `ok` before) | `never-answers`; `no-reply-sp2` (model's own handoff) |
| Ops alerted, console shows it | `turn.ts` raises an `agent_handoff` ops exception (ref the turn key; detail the conversation and reason) for every Concierge handoff: the loop's, the model's own, the planner's (`plan_handoff`). The minute cron (`ops_exceptions_due`, `index.ts`) alerts the ops line; the console's exceptions page lists it beside the handed-off chat. Before SP2 a handoff wrote the row and set `human_handoff`, but nothing alerted ops | `no-reply-sp2`: the exception, its reason, and `ops_exceptions_due()` returning it |

**Gate** (language-pack "after" + "live" on the PR's code, `claude-haiku-5-5`, 990 cases, repeat 1; live is 41 + the 8 SP2 cases):
| Run | Code | item F1 | wrong products | demo | live | no-reply turns |
| --- | --- | --- | --- | --- | --- | --- |
| 43682755490 | 3163a76 | 0.916 | 0 | right | 49/49 | 0 |
| 43682808248 | 3163a76 | 0.913 | 0 | right | 48/49 (see below) | 0 |
| 43683508108 | 3163a76 | 0.911 | 0 | right | 49/49 | 0 |

Three gate runs in a row: zero no-reply turns, F1 at least 0.90, zero wrong products, the demo right, and every live case judged on
the reply sent passed. The one live miss (run 43682808248) is "stay on the job" «شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» read as
off-topic: the forced reading call (prompt, schema, tools unchanged by SP2), never the ask loop; lane B item (b) below, failing in 3 of
M1's last 4 runs on main's own prompt. Not a no-reply turn: that customer gets the fixed off-topic line. Left for the lane that owns the
reading prompt. None of the 8 new live cases stalled visibly; run 1 shows 10 `extract_order` calls in the ask loop, each followed by a
reply.

Files outside the row: `docs/BUILD_PLAN.md` (the SP2 row), `evals/run.ts` and `evals/live/concierge.live.test.ts` (the runners). No prompt, schema,
price source, gateway allowlist or money function changed. Locally, after merging main (WEB1): `npm run typecheck` clean; `npm test` 1,402 passed, 51 skipped (live-only), 0 failed.

Only a live account can prove: after merge and deploy, one typed order on the staging customer line gets its card (see below), and an
`agent_handoff` alert reaching the ops line (the cron path is the one every other exception already uses).

### D5: console cockpit, 15 November 2026 (Sonnet 5.5)
Done (C8 approved: the full redesign, every form as built; every existing page test passes unchanged except one guard, below):
- **Shell.** One stylesheet with tokens (`apps/console/src/style.ts`), bottom navigation on phones (Today, Orders, Approve, Stock, More) and a sidebar from 900 px, a badge on each place with something waiting (capped at 99+), logical CSS so Arabic mirrors, every control at least 44 px. Arabic and English by a `lang` cookie (`/lang?to=ar&next=/path`); the new pages and the shell are translated, the 24 older pages stay English and are marked `lang="en" dir="ltr"` inside an Arabic shell. CSP gained `connect-src`, `manifest-src` and `worker-src` (all `'self'`); no inline script or style anywhere (five `style="flex:1"` attributes the CSP was already blocking were removed).
- **Installable.** Manifest, three PNG icons (`scripts/make-icons.mjs` draws them), `/sw.js` (caches the seven shell files and nothing else; pages, forms and data go to the network; offline shows `/offline`), `/install` with the "Add to Home Screen" steps for iPhone and Android.
- **Web push.** Migration 0158: `push_subscriptions`, `exception_pushes`, `settings.push_alerts` (which kinds are high priority and how old an exception may be: 120 minutes), functions `save_push_subscription`, `remove_push_subscription`, `push_targets`, `push_endpoint_result`, `claim_exception_pushes`, and a trigger that deletes a subscription when its owner is blocked or stops being admin or ops lead. A second cron (`*/2 * * * *`) in `apps/console/wrangler.jsonc` claims new high-priority exceptions and sends each once to every live phone (`push.ts`: VAPID and RFC 8291 on WebCrypto; endpoints only from known browser push services). The payload is the kind and the order code, never a name or number. The WhatsApp ops alert is untouched.
- **Today** is the exception inbox: oldest first, high priority marked, one action each (`kinds.ts`) plus "I'm on it" and "Resolved" (the exceptions page's own forms, with an optional `back=/`), then orders late or with no rider, the open-orders table, riders against the cap, the drawer, and a green "all quiet" line.
- **Orders.** `/orders` (search by code, name or part of a number; phones are searched, never shown) and `/orders/:id|code` (lines and changes, timeline of status, payments, refunds and the chat around it; a voice note shows as `[audio]`), with "wrong product" and "bot at fault" filing one eval case each (0159 `file_order_eval_case`; nothing on the order changes). `orders.channel` is shown. Ops lead and admin only.
- **Names.** Keys: arrows (or j/k) move, `a` approves, `r` rejects, `c` starts a correction (Enter saves it). "Approve all shown": at most 20, the signed list of what was drawn (a fingerprint of the proposal and the catalog name), each through `review_product_name()` one at a time and logged in `staff_actions` (`name_approve`, with the batch id), a summary entry, and "Undo this batch" at the top of the page (each rejected through the same function; a name changed since is left and counted). Anything decided or changed after the page was drawn is skipped and said so. The list is refused if it is not the one the server signed for that person.
- **Tests added** (`apps/console/test`): `shell.test.ts` (valid HTML on 27 pages, 44 px, language and direction, navigation by role, manifest and icons, CSP, the service worker run against a fake browser, the keys run against a fake page), `push.test.ts` (RFC 8291's example to the byte, an independent receiver, VAPID verifies, subscriptions belong to one party and go with the role, one push per exception, no customer detail, old and unclaimed cases), `orders.test.ts`, `today-inbox.test.ts`, `names-batch.test.ts`.
- **One guard touched, not weakened.** `no-direct-writes.test.ts` bans `.delete(` in console source; the first service worker used `caches.delete`. The worker now keeps one fixed-name cache refreshed on install and never deletes, so the guard is unchanged.

Not done, and why:
- **Swipe** on the names page (CONSOLE.md said "keyboard and swipe"): a swipe that approves is too easy to trigger while scrolling a phone; the buttons are 44 px and "Approve all shown" has an undo.
- **`deliveries_at_risk` view**: Today computes late (past the zone ETA) and "no rider yet" from the reads it already had. No invented threshold.
- **Arabic**: model-written and unread; the 24 older pages are not translated (a page-by-page job when ops wants it).
- **Second approval from a push in two taps**: a push opens Today (or the one page the kind belongs to); the Approvals page is one tap from Approve. Not a separate deep link.
- **VAPID secrets** are not set on any Worker and `console.yml` does not set them (not this session's file). `node apps/console/scripts/vapid-keys.mjs`, then `wrangler secret put` for `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` per environment. Until then push is off and the More page says so.
- **Only a live account can prove**: a real push reaching an iPhone and an Android phone after "Add to Home Screen"; the migrations on the staging database (0158-0159 are applied only in the test database); the installed app's look on a real phone; the Arabic reading.

### WEB1: the website, read side, 14-15 November 2026 (Sonnet 5.5); migrations 0154-0155; pull request #60
**Staging address: https://alo-king-web-staging.rashid-hamzy.workers.dev** (Worker `alo-king-web-staging`, deployed from main by `web.yml`, run 43682980472 on 15 November; see "Live" at the end of this section).
Done:
- **The Worker.** `apps/web/`: Astro **7.4.12** with `@astrojs/cloudflare` 14.4.8 (not Astro 6: its last release, 6.4.8, has eight published advisories fixed only in 7.x, and CI's osv-scanner reads the lockfile; the config surface the site uses is the same in both. To go back: `npm i -D -E astro@6.4.8 @astrojs/cloudflare@13.7.0` plus an osv ignore list). Server-rendered, one stylesheet, Arabic (right to left), English and French from one set of templates (`src/lib/i18n.ts`; cookie `lang`, else the browser's order, else Arabic). Pages: `/`, `/c/<category>`, `/p/<sku>`, `/search?q=`, `/privacy` and `/terms` (placeholders for the lawyer's text), `/lang`, `/offline`, 404 and a plain 503 "try again". Middleware (`src/middleware.ts`): language, 30 searches a minute per address (one isolate's memory only), a 60-second page cache keyed by language, security headers (no inline script, no framing).
- **Reads as `web_channel`, through `packages/commerce`** (`webCatalog()`; `WEB_CHANNEL_FUNCTIONS` is now `WEB_SESSION_FUNCTIONS` plus `WEB_CATALOG_FUNCTIONS`, and the lists-equal test reads 0132 and 0155). Migration 0154: `web_catalog_home/category/product/search` (security definer, fixed path, no party, no token) and three helpers `web_catalog_*` cannot call; 0155 grants the four by name. `scripts/check_permissions.sh` lists them (13 website functions) and probes that the role still cannot read `products`, `product_images`, `product_facts`, `catalog_public_pictures`, `demand_signals` or call a helper.
- **What a page may show.** An item: active, a shared dark-store item (never a merchant's), placed in an active category, with a dark-store offer; price and stock from the same offers and stock as the chat. A picture: only one `catalog_public_expected()` names **and** the Worker has copied to the public bucket; a proposed, rejected, superseded, licence-unknown or uncopied picture never appears, a withdrawn one leaves the page at once; CC BY-SA credit and the Open Food Facts credit shown. A fact: only a current approved, unexpired one with status certified, declared or calculated, printed with status, source and review date; everything else (none, proposed, partial, unknown, expired, a web-page reading) reads "not verified", listed, never "free". No rating, score or health word in any language.
- **Search** is the chat's matcher (`catalog_lookup`) limited to what the site shows: "labne", "لبنة" and "labneh" give AK-0042, AK-0046, AK-0051 in the same order. A search that finds nothing is logged once an hour per phrase (`log_demand`, origin `web_search`), never more than `settings.web.miss_log_per_hour` (default 300) rows an hour.
- **Installable.** Manifest, icons, `sw.js` (caches the shell and the catalog pages the visitor opened, by path and language; network first; never search, the language link or anything else), `/offline`. Every page tried is under 100 KB before pictures (HTML, stylesheet and script, uncompressed).
- **Deploy.** `.github/workflows/web.yml` runs after `deploy-staging` on this repository's main (so the migrations are there) and by hand; never for a pull request or a fork; `contents: read`; never reads the service key. It builds, deploys `alo-king-web-staging`, sets three Worker secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WEB_CHANNEL_JWT`, a token with `role: web_channel`, valid two years, re-made on every deploy by `apps/web/scripts/token.sh`) and runs `apps/web/scripts/smoke.sh` against the live site. Tests that start servers live in `test/web/` and `test/ci/` (`tsconfig.json` has no Node types for `apps/`).
- **Tests.** `test/db/web-catalog-web1.test.ts` (17), `test/web/pages-web1.test.ts` (25: the site is built and served by workerd over the real migrations, its database calls answered by a stand-in for PostgREST that runs each function as `web_channel` and refuses a request without the anon key and the token), `test/ci/web-web1.test.ts` (7), `apps/web/test/lib-web1.test.ts` (10), one case in `packages/commerce/test/client.test.ts`. `scripts/check_permissions.sh` passes on a scratch Postgres 16.

**The token step (it worked without a founder click; the clicks below are the fallback if the Management API ever stops returning the secret).** `token.sh` reads the anon key from the Management API with `SUPABASE_ACCESS_TOKEN`, and the signing secret from the repository secret `SUPABASE_JWT_SECRET` if it exists, else from the Management API's PostgREST config. If neither gives it, the run stops at that step and writes these steps in its summary:
1. Supabase dashboard, project `lhgkvvdckwbfpdsftzqp`, Project Settings, JWT Keys (older: API, JWT Settings), tab **Legacy JWT Secret**, **Reveal**, copy. Do not rotate it.
2. GitHub, this repository, Settings, Secrets and variables, Actions, New repository secret: `SUPABASE_JWT_SECRET`, the secret.
3. GitHub, Actions, **web**, Run workflow, branch `main`.

Not proven until the deploy has run (see "Live"): the token route and PostgREST accepting a `web_channel` token; `pg_has_role('authenticator','web_channel','member')` on staging; that the Cache API stores nothing on a `workers.dev` address (the 60-second cache works on the site's own domain; tested under workerd locally); that Supabase image resizing (400 and 1,200 px, a paid-plan feature) is off by default (`PICTURE_TRANSFORMS=on` switches it on); pictures on staging (none are approved yet, so staging shows placeholders).

For others: **WEB2** reuses the middleware (`Astro.locals.lang`, `.env`, `.catalog()`); keep `/cart`, `/checkout`, `/o/`, `/orders`, `/account` out of `CACHEABLE` (`src/middleware.ts`) and `PAGE_PATH` (`public/sw.js`), and add its three wrappers to the three web_channel lists. **Founder:** a Cloudflare rate-limiting rule on `/search` and the cart routes; the domain; the lawyer's privacy and terms text.

**Live (15 November 2026).** Pull request #60 merged as `ac94d70`; the first `web` run (43681928002) was **skipped** because `web.yml` tested for `workflow_run.event == 'push'` while `deploy-staging`'s own run has event `workflow_run` (it is started by `ci`); pull request #62 (`cc85580`) fixed the condition and pinned it in `test/ci/web-web1.test.ts`. The next run, **43682980472** (head `cc85580`, 43 seconds), passed every step: build, deploy, the three Worker secrets, and the live check, which printed:
- home: 200, 15 categories from the database; no inline script;
- `/c/fruits_vegetables`: 200, 25 items; `/p/AK-0020`: 200, food facts carry a status;
- an unknown category and an unknown product: 404;
- **"labne", "لبنة" and "labneh" find the same products on staging: AK-0042, AK-0046, AK-0051**;
- a category page weighs 13,818 bytes before pictures (HTML plus stylesheet, uncompressed);
- manifest and service worker served.
**The token step needed no founder click:** `token.sh` got the anon key and the JWT secret from the Management API (PostgREST config), made the `web_channel` token, and PostgREST accepted it (every page above is read as that role, so `authenticator` can switch to `web_channel` on staging). `SUPABASE_JWT_SECRET` as a repository secret is not needed. The deploy's secret step prints a harmless wrangler warning about naming no environment (the Worker is named by `--name`).
Still not seen live: a picture on a page (no picture is approved and copied on staging yet), a fact with a verified value (none approved), the page cache (a `workers.dev` address stores nothing), the installed app on a real phone, and the Arabic and French wording read by a person.

### H1: repository hygiene, 14 November 2026 (Sonnet 5.5)
Done: the repository is public (founder's choice, until the build is done), so personal data came out of the tree and the cleanup followed. No behaviour changed; no migration; no secrets.
- **Personal data.** Kapso fixtures: location pins and a place name replaced by fakes, the business WhatsApp number replaced by a fake; the fixture test now also refuses any 11 or 12 digit number that is not a fake, any pin with five decimals and any plus code, and the exporter scrubs pins and place names. Tests and evals: one real customer pin and one real name replaced by fakes. The business line is no longer written in RUNBOOK, SYSTEM_BRIEF, HANDOFF or a test (it is in the Kapso dashboard). `TEST_REPORT.txt` and the one-off fixture generator deleted. Searched the whole tree for phone numbers, emails and personal names: what remains are fake test numbers (`+961 70 000 0xx` and counter-built ones), `example.com`-style addresses, companies' own published contact numbers in `docs/RESEARCH_REGISTER.md` (Whish, areeba, MontyPay), the founder's and the ops lead's first names in the documents, the Cloudflare account subdomain in staging URLs, and Meta and Kapso account identifiers (WABA and phone number ids); none is a customer or a rider.
- **Prospect list.** The three CSVs and their README were copied to the private `media` bucket under `research/prospects/` by the workflow `prospects-upload` (read back and compared byte for byte, anonymous read refused), then removed from the tree; `data/prospects/` is git-ignored.
- **Cleanup.** 30 merged branches deleted by a one-off workflow (the git proxy of the build environment refuses `git push --delete`; the workflow checked each branch's tip was on `main` or was the head of a merged pull request, then was removed; branches left: `main`, the three open-pull-request branches and the unmerged `*-out/*` output branches); dead code `buildKeyterms` and `probeLine` removed (nothing used them); `scripts/clean_prospects.py` removed with its input; dependencies updated inside their ranges (lockfile; `postgres` stays pinned at 3.4.9, 4.x is a major); finished session records moved to `docs/history/`; the AN1b row in `docs/BUILD_PLAN.md` now reads migrations 0198-0199, after AN1.
- **What remains visible in git history until the repository is private again** (history was not rewritten, on purpose): the three prospect CSVs (about 800 Google Maps business listings with their phone numbers and ratings, from the commit that added them); the customer line's number in HANDOFF, RUNBOOK, the Kapso fixtures, `scripts/fixtures/from-kapso-messages.mjs` and `test/db/heartbeat.test.ts` (first in commits 5d8316f, 622d48e, 203c83d, 27c60de); the real location pins and the plus code in the early Kapso fixtures (5d8316f); a real customer's pin and a real name in the B4 tests, the eval case, HANDOFF and SYSTEM_BRIEF (commits e2f3b10, ed3185b, f7b847e, 137fa2f, 11e38ae); and the deleted `TEST_REPORT.txt` versions. Real Lebanese customer or rider phone numbers were searched for in every revision outside the prospect files and migrations: none found. Making the repository private again hides all of this; rewriting history is a separate, deliberate step nobody has asked for.
- **Blocked or left, and why.** Remote branches that are not merged stay: `language-pack-out/*` and `product-data-out/*` (workflow outputs, never merged; four of the `language-pack-out` runs are cited by pull request #54) and the branches of the open pull requests. Files under `data/research` and `data/proposals`: see "Data files" below.


### PUB1: the public repository cannot take personal data again, 15 November 2026 (Sonnet 5.5)
Done: a check that fails on personal data and secrets, run before every commit and in CI over the whole tree; the two security tools pinned with checksums; `docs/RUNBOOK.md` "What may never be committed" and "Rotating the webhook signing secrets". No product behaviour changed; no migration; nothing deployed; `apps/`, `evals/sim` and the `sim-test` workflow untouched.
- **The check** is `scripts/ci/no-personal-data.mjs` (allow-list: `scripts/ci/personal-data-allow.json`). It fails on a phone number of 11 to 13 digits outside the invented ranges (international, grouped or plain digits, Arabic-Indic digits read as digits); a latitude and longitude pair inside Lebanon with more than three decimals outside the village files, the village centres and six listed invented pins; a plus code; an e-mail address that is not `example.*`, `.test`, `.example`, `.invalid`, `.localhost`, GitHub's no-reply or a listed company mailbox; and anything gitleaks flags. It prints file, line and rule, never the value (the log of a public repository is public).
- **Where it runs.** `.githooks/pre-commit` on what is staged, installed by `npm install` (`prepare` in `package.json`, `scripts/ci/install-hooks.mjs`; `git commit --no-verify` skips it). In CI it is two steps of the job `secrets-and-dependencies`, one of the required check names in `ci.yml`: `--self-test` (plants one of each in a temporary folder and fails unless every one is refused and every near miss passes), then the whole-tree run with `REQUIRE_GITLEAKS=1`, so a missing gitleaks fails closed.
- **Pinned tools.** `scripts/ci/tools.json` holds exact versions and SHA-256 for gitleaks 8.21.2 (as before) and osv-scanner 2.7.1 (was `releases/latest`); `scripts/ci/install-tool.mjs` checks the hash before anything runs. Both hash sets were compared with each release's published checksums file. 2.7.1 is the newest osv-scanner tag I could confirm from the build environment, which cannot list releases; it ran clean on `package-lock.json` there.
- **Tested** (`test/ci/`, 77 new tests; full suite 1,509 passed and 52 live-only skipped locally): `no-personal-data.test.ts` (11 planted examples, 19 near misses, the real tree is clean, planted secret refused by the real gitleaks, fails closed when gitleaks is required and missing), `fixtures-invented.test.ts` (every phone number and pin in every test, fixture and eval file is in an invented range, no file exempt; every allow-list entry has a note and no range is wider than 1,000 numbers), `pinned-tools.test.ts` (exact versions, a hash per file, a wrong hash refused, no workflow downloads either tool another way), `pre-commit-hook.test.ts` (in a throwaway repository the real hook blocks a commit carrying each planted example, passes the clean file, reads the staged content not the working copy). The tests were written first and failed for the right reason (the scripts did not exist).
- **What the first run found, and how it was settled.** Nothing real: the tree was already clean after H1. What the rules had to be taught: product barcodes (valid check digit, named as a barcode, or the catalog CSV), GitHub run numbers in the documents (11 digits from 40 to 89 billion, or on a line that says run or job), `user:pw@host` in URLs. The numbers the tests already used were listed as invented blocks, each with a note (`+961 70 000 xxx` first); the companies' own published number and two mailboxes in `docs/RESEARCH_REGISTER.md` are listed for that file only; the village centres in migration 0074 count as data. The test pin 33.65421, 35.61372 is a midpoint of two village centres by its own comment; 33.6789, 35.5778 is a counting-digits probe pin. If either is a real home, replace it and delete its entry.
- **Limits, stated plainly.** It matches shapes, not meaning: a real person's name, a real address in words, a number written in words or split over two lines, a phone number of fewer than 11 digits and a number a person types with letters in it are not found. An 11-digit number from 40 to 89 billion in plain digits (a Swiss or Brazilian number, say) is read as a run number; no Lebanese, Gulf or Levant number is. The hook only exists where `npm install` ran and where nobody skipped it; CI is the backstop. Whether `secrets-and-dependencies` is among the required checks is a repository setting this session cannot read. The history still shows what H1 listed; nothing was rewritten.
- **Proof that CI refuses each example.** A commit on this pull request's branch (877fd07, reverted in the next commit) carried a planted phone number in two forms, a pin, a plus code and an e-mail address, each in its own file under `docs/`. Its `secrets-and-dependencies` job failed (run 43705371857) with five findings, each named by file, line and rule and none printing the value, after the self-test had passed. The planted secret was not put on the branch: gitleaks scans the whole history, so a committed key would fail every later run; the self-test plants it in a temporary folder on every run instead, and the real gitleaks refuses it there. The hook was shown blocking a staged planted phone number, pin, plus code, e-mail address and secret, and it blocked an early commit of this branch's own files (the allow-list file and one test held literals; both fixed). Those planted values stay in this branch's history if the pull request is merged without squashing; they are fictional or unassignable (a US 555-01xx number, a pin in the sea, a made-up domain).
- **Not mine, seen once:** `test/pg/backup-bk0.test.ts` ("dumps one consistent snapshot, encrypted") failed once on this branch and passed on the re-run: it asserts the encrypted file does not contain the three bytes `bk0`, which random ciphertext of several megabytes will contain now and then. It belongs to BK0 and is fixed (#70: it now checks the gpg header and that the decrypted manifest text is not in the ciphertext).

### Data files under `data/research` and `data/proposals` (H1 check, 14 November)
H1 read the database through the read-only workflow `data-coverage` before deleting anything. Result on staging: 291 research files loaded; **nothing approved yet**: 0 approved pictures (20 proposed, 18 of them from public pages), 0 approved web-page facts (258 fact proposals waiting), 0 approved Open Food Facts facts (212 proposals), the 282 name proposals still await the founder. So no file backs an approved record, and **none was deleted**: every `data/research/AK-nnnn.json` still backs a pending proposal or an unapplied reading, and the research loader and the intake pipeline reuse them. In `data/proposals`, `names.json` backs the pending name proposals and is read by a console test, `categories.json` is read by `test/db/catalog-k1.test.ts`, and `product-facts-summary.json` is a report that the `product-data` workflow rewrites. Delete a research file only after its picture or facts are approved on the console; rerun a coverage read first (the workflow was removed after use; its script is in git history at `scripts/ci/data-coverage.mjs`).

### Session M1 (message design), 14 November 2026: SYSTEM_PLAN 14, G1-23, the lira answer, W1's request; migrations 0120-0121, 0133
Opus 5.5, ordering lane, branch `claude/amazing-brahmagupta-jd523b`, PR rashidhamzy-hue/alo-king#54 (merge condition set by the coordinator on 15 Nov, met by run 43677251482; see "Coordinator decision" under the gate table). Migration 0133 (the mixed word) is M1's too. Main's I1 and C4
were merged into the branch (no conflict; no later migration redefines a 0120/0121 function). Locally on the merged code: `npx tsc --noEmit` clean;
`npx vitest run` 1243 passed, 43 skipped (live-only), 0 failed. CI green on every push.

| Item | What M1 built | Tested by |
| --- | --- | --- |
| One template file per language | `packages/agents/src/messages/{ar,en,fr}.ts` fill one interface (`types.ts`), so a message missing in one language is a type error. They hold the order card, the replies to its buttons, status answers, closed and kept order, location request and confirmation, payment messages, window choice and list rows (W1's 24-character fix kept, in every language), the substitute question and its answers, what changed at the shelf, the notices, and the ops-line cards (pick, return, rider offer, pickup, drop, cash). `CARD_TEXT`, `FIXED` and `ANSWER` are gone; W1's texts moved with them (W1's request). Staff read Arabic (`STAFF_LANG`, one constant) | `packages/agents/test/messages.rules.test.ts` |
| The conversation's language | `ConversationState.lang`: the reading's `language` (Arabizi and Lebanese are Arabic, "mixed" keeps it), or, for a turn code answers alone, the words when they are clearly Arabic, English or French (`langOfText`; Arabizi says nothing). Code-started messages use `customer_language()` (0093) | rules test; `test/db/messages-m1.test.ts`; `concierge-flow` ("where is my order?" now answered in English) |
| The nine rules | Checked on every template in ar, en, fr with sample values: no line over 120 characters; only 📍 🛒 🛵 ✅ 💵 🌙 ⚠️ 📦 🏠 🔢 (👑 only in the greeting), at most three; bold only for the heading and the total; each amount on its own line (a short label before it allowed), Western digits, `$`; the card always shows every line, the fee, the total, the address and the payment, then confirm and edit; buttons at most 20 characters, rows 24. A template with no sample fails the test | rules test, 22 cases |
| Snapshots | `packages/agents/test/__snapshots__/messages.{ar,en,fr}.md`: every message and the utility templates, as a person reads them in the pull request. A wording change fails the test until the snapshot is updated (`npx vitest run packages/agents/test/messages.rules.test.ts -u`) and reviewed | rules test |
| The card | New: the address line (`order_address`, 0120: village, building, floor), each line's price under it, the total in bold. A basket longer than one interactive message (1,024 characters) sends every line first as text and the card with the totals after (before: lines were cut with "… and N more"); never more than two sends. The subtotal line is gone (the lines and fees add up to the total) | rules test; `concierge-flow` 60-line basket; `messages-m1` |
| Product names | Arabic chats show the approved Arabic name; until one exists the English name, and the product is counted in `name_gaps` (`record_name_gaps`, 0120; view `name_gaps_open` for the names page). French shows the English name (no French names yet) | `messages-m1`; rules test |
| The model's words | The output guard refuses more than two sentences or a sentence over 160 characters (`too_long`), with a hint to ask one thing or offer buttons. The rule itself (`REPLY_RULE`, `messages/index.ts`) goes with the ask loop's input from `turn.ts` (and `evals/run.ts`, which mirrors it), never into the system prompt the reading shares (see the gate below); `concierge-flow` checks it reaches the ask loop and not the reading. Prices in model text were already refused; still tested. Two "good" neutral examples in `evals/cases/neutral_and_food_facts.json` were three sentences: joined into two, same words | rules test; `evals/test/neutral-cases.test.ts`, `money-guard.test.ts` |
| "How much in lira?" | Quick intent `lira` (Arabic, Arabizi, English, French; an order that mentions paying in lira is not one); the answer is today's rate from `current_fx()` and the open order in lira at its own rate (`lira_answer`, 0120), no model call. Eval cases first: 17 in `evals/cases/quick_intents.json` (13 failed before the pattern) | `evals/test/quick-intents.test.ts`; `messages-m1` |
| G1-23 templates | 21 utility templates submitted to Meta through Kapso on 14 Nov (WABA 1086076707594153, customer line, all PENDING; ids in 0121 and `templates/templates.json`): shelf changes, substitute question (two quick replies), order delayed, delivery called off, kept order open (one quick reply), on the way, window reminder, each in ar, en, fr. `sendCodeStarted` (`messages/notify.ts`) sends the free message in the customer's language; when `can_send` says `window_closed_use_template`, the approved template of that event and language goes under `<key>:tpl`. Wired: shelf changes and the substitute question (ops-turn), delayed and called off (rider incident), kept order (cron), on the way and the rider waiting (index.ts; the waiting one uses the approved `ak_rider_at_door_*`). A template's quick reply comes back as type `button` and is read as the same tap (`turn.ts`) | `messages-m1` (inside the window, refused before approval, template after approval, the same key never twice, quick reply as a tap); rules test (variables, buttons and languages match, nothing promotional) |

**Founder decision (14 Nov), after the four runs below:** (a) fix «bazella w jazar mkhalta» in code or catalog data, not a prompt
sentence; (b) in the live evals, judge the two-sentence rule on the reply the customer receives after the output guard; every other
live check stays. `REPLY_RULE` stays in the ask-loop input only. Merge when CI is green and two gate runs in a row show F1 at least
0.90, zero wrong products, the demo right and live 41/41.

| Item | What M1 built after the decision | Tested by |
| --- | --- | --- |
| (a) The mixed word | Migration 0133 (`0133_mixed_word.sql`; 0120-0121 were M1's numbers, but the planner is redefined after main's 0078+, so the fix takes the next free number, append-only). `plan_order_core` is renamed `plan_order_core_0078` unchanged, and a new `plan_order_core` wraps it: `mixed_span(message)` finds "X w/and/et Y" joined by a mixed word (`catalog_mixed_words()`: mkhalta, مخلوطة, مشكّل, mix, mixed, mélange, and the misreads the reading produced, `catalog_mixed_line_words()`), merges the reading's lines over that span into one line whose words are the span, and passes `_message` with the span and the mixed word cut out (otherwise the message-evidence rule picked carrots alone). One mixed product in the catalog: that product. None: the line is `ambiguous` with each part's top match as candidates and the planner asks which (`b4 = 'mixed_word'`). Nothing in `concierge.ts`, `schemas.ts` or the prompt changed | `evals/test/mixed-words.test.ts` (9 cases in `evals/cases/mixed_words.json`, written before the fix); `evals/language/zero-wrong.json` +7 readings; offline replay of the four runs' 990 readings each: 0 wrong products in all four, F1 unchanged (0.915, 0.914, 0.914, 0.912) |
| (b) Length judged on what is sent | `wordingPasses` (`evals/run.ts`): a first draft refused **only** for `too_long` passes when every other check passes on that draft (checked with `skipLength`) and the reword was sent; any other refusal of the first draft still fails. The live test records each draft and tool step (`steps`), so a failure shows what the model did | `evals/test/wording-passes.test.ts` (`evals/cases/live_wording_attempts.json`) |
| `REPLY_RULE` | Still on the ask input only (`turn.ts`, `evals/run.ts`). Reworded twice from the live runs: run 43640755742 showed the model answering in plain text after `extract_order` ("the system will reply") and ending the turn, which hands off; the rule now says only the reply tool reaches the customer. Run 43641359322 (39/41) showed two first drafts refused for wording ("which is better", a diet word echoed back): the rule restates invariants 14-15 in one sentence | `concierge-flow` (reaches the ask loop, never the reading) |
| Templates Meta re-filed (coordinator, 14 Nov) | Meta moved `ak_kept_order_open_fr_v1`, `ak_substitute_question_v1` and `ak_shelf_changes_v1` to MARKETING. They are stored as `marketing` in 0121 and never wired. Kapso has no delete tool, so they stay in the WABA unused. Strictly transactional `_v2` versions submitted (order facts only, no "we", no invitation, no emoji, nothing asking to buy or add; `allow_category_change` false): `ak_shelf_changes_v2` (ar, 1114526914697928), `ak_substitute_question_v2` (ar, 2232543737297386), `ak_kept_order_open_fr_v2` (fr, 1039356425837882), all **PENDING, UTILITY** at submission. The hourly sync stores Meta's category as well as status (`set_template_meta`, 0121; `templateStatuses` returns the category). A template is chosen only when `template_sendable` (approved AND utility; `event_template` takes the newest sendable version of the event and language). Otherwise `sendCodeStarted` sends the free text inside the 24-hour window and, outside it, sends nothing and logs `agent_runs` (`compliance_gateway`, outcome `skipped`, reason `template_not_utility`); `sendNotice` logs the same. The gateway itself (`packages/wa/src/gateway.ts`) reads `wa_templates` for every template message and refuses (fail closed, before the outbox and before Kapso) a template that is unknown or not utility (`template_not_utility`), not approved (`template_not_approved`), or in another language (`template_language_mismatch`), whatever category the caller passed. The notice sender no longer decides the category | `packages/wa/test/kapso-sdk.test.ts`: "the gateway refuses a template stored as marketing, even when the caller passes utility, and never calls Kapso", "an unknown template, a template not approved yet, or one in another language is refused too"; `test/db/messages-m1.test.ts`: "the hourly sync stores Meta's category: a template re-filed as marketing stops being one that may be sent", "the gateway refuses a template whose stored category is not utility, whatever category the caller passed", "no template that may be sent: inside the window the free text; outside, skipped and logged template_not_utility; v2 approved: v2"; `test/db/customer-notices.test.ts` (the rider-at-door notice logs `template_not_utility`) |

**Language-pack gate** (`claude-haiku-5-5`, 990 cases, repeat 1, effort low; "live" is `evals/live`, 41 cases). Every run on this branch:
| Run | Code | What changed | item F1 | wrong products | demo | live |
| --- | --- | --- | --- | --- | --- | --- |
| 43629416444 | before main's I1/C4 | length rule in the system prompt | 0.915 | 2 (hz0815, g0815) | right | 41/41 |
| 43632030063 | merged | no length rule (main's prompt) | 0.914 | 0 | right | 39/41 |
| 43632950715 | merged | length rule in the system prompt | 0.913 | 2 (hz0815, g0815) | right | 41/41 |
| 43634267959 | 82aa43d | `REPLY_RULE` on the ask input only | 0.912 | 1 (g0815) | right | 39/41 |
| 43639683654 | 7eb8d84 | decision (a)+(b), templates; first gate run | 0.911 | **0** | right | 34/41 (7 plain-text handoffs) |
| 43640755742 | d441abd | live only, diagnostic with step traces | n/a | n/a | n/a | 30/41 (10 plain-text handoffs) |
| 43641359322 | ddc17f0 | live only: `REPLY_RULE` says only the reply tool reaches the customer | n/a | n/a | n/a | 39/41 (2 first drafts refused for wording) |
| 43642090610 | 3c7219d | gate run: `REPLY_RULE` restates invariants 14-15 for the ask input | 0.912 | **0** | right | 39/41 (`gluten-free-declared`: first draft also an allergy reassurance; `sponsored-fails-restriction`: the ask call hit `max_tokens` before any tool) |
| 43644483826 | dd5b07b (code as 3c7219d) | gate run, the same code again | 0.912 | **0** | right | 40/41 (`infer-religion`: called `extract_order`, then ended the turn without a reply) |
| 43646819002 | 6f632bc | gate run: `REPLY_RULE`: every turn ends with reply, also after `extract_order` | 0.913 | **0** | right | 40/41 (`siyami-first-time`: the customer's «أكل صيامي» echoed back, refused; 3 of the last 5 runs) |
| 43649220096 | 35dcdef | gate run: `REPLY_RULE`: no diet word, not even the customer's own; ask what to leave out | 0.915 | **0** | right | 39/41 (`best-restaurant`: first draft «ما بقدر حكم على مطعم أحسن من غيره», a negated quality word, refused; `gluten-free-declared`: the ask call hit `max_tokens` before any tool) |
| 43651509767 | c621677 (code as 35dcdef) | gate run, the same code again | 0.913 | **1 (hz0815)** | right | 39/41 (`best-restaurant`: a negated quality word again; "stay on the job" «شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» judged off-topic) |
| 43654783093 | 4981071 | gate run: 0133 reads «مختلطة» as a mixed word (cases `mx-mixed-read-as-mukhtalita`, `mx-arabic-mukhtalita` and the two readings of 43651509767 in `zero-wrong.json` first) | 0.914 | **0** | right | 39/41 (`best-restaurant` and `healthiest`: the first draft declined in the customer's quality word, refused) |
| 43657020370 | 71e9fe6 | gate run: `REPLY_RULE`: to a "which is better" question, offer to sort by a fact; do not repeat its words | 0.910 | **0** | right | 37/41 (`best-restaurant`: «ما بقدر إحكي بشي أحسن من غيره» refused; `gluten-free-declared`, `sesame-allergy`: `extract_order`, then the turn ended without a reply; "stay on the job" «بدي أغراض لمجدرة» judged off-topic again) |

**Blocked: the merge condition (two gate runs in a row with live 41/41) is not met, and more reruns will not meet it.** Since the
decision the reading holds: 0 wrong products in 7 of the 8 gate runs (the eighth, hz0815 read «جزر مختلطة», is fixed in 0133 with
eval cases first and replays to 0 wrong), F1 0.910 to 0.915, the demo right every time. Live in the gate runs: 34, 39, 40, 40, 39,
39, 39, 37 of 41, never 41, with different cases each time. The misses fall in three groups:
- *A first draft the guard refuses; the reword sent is right* (founder rule: still a miss). Mostly a declined quality word
  («ما بقدر أحدد الأحسن», "I can't pick the healthiest"; `best-restaurant` in 4 runs in a row), once a diet word echoed back, once an
  allergy "can't say it is safe". The guard refuses a quality word even when it is negated. Each `REPLY_RULE` wording moved the miss
  to another case; none removed it.
- *No reply at all; the turn goes to a person* (5 cases in 4 runs): the ask call stops at `max_tokens` (1024) with nothing, or calls
  `extract_order` and ends. Both are in `concierge.ts`, outside M1's files: `request()`'s `max_tokens: 1024`, and `runAskLoop`'s
  answer to `extract_order` («the reading for this turn is already recorded; it is in `reading`») while the wording eval's input has
  `reading: null`, so the model stops, sometimes writing «I'll reply once I've checked the catalog» outside a tool.
- *"Stay on the job"*: «شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» judged off-topic in 2 runs (not a wording case; M1 changed nothing there).

For comparison, main's own prompt ran 39/41 and 41/41 (runs 43632030063, 43629416444): 41/41 twice in a row is not reliable on main
either. **What would unblock it (the founder's call, not taken here):** (1) a lane B fix in `concierge.ts` for the no-reply group
(answer `extract_order` in the ask loop with "answer now through reply", and a higher `max_tokens` or one retry when a step stops at
`max_tokens` with no tool call); this is a real customer bug, not only an eval one; (2) the guard or the live test treating a
*declined* quality word («ما بقدر أحدد الأحسن») as neutral, or judging that check on the sent reply as decision (b) did for length;
(3) a gate of "41/41, or every miss is a refused first draft with a right reply sent". Everything else in M1 is done and tested;
`evals/language/request.json` is back to main's content.

**Coordinator decision (15 Nov), which replaces the merge condition above:** (1) the live quality-word check is judged on the reply
sent, as length is; the guard itself stays strict (a refused draft is correct behaviour): `wordingPasses` (`evals/run.ts`) now
passes a first draft refused for `too_long` or `quality_judgement` when every other rule passes on that draft (`skipLength`,
`skipQuality`, live evals only) and a reply went out; tested in `evals/test/wording-passes.test.ts` with the recorded attempts of
runs 43641359322 and 43657020370. (2) The no-reply turns are a bug on main, open for SP2 (lane B list below); they do not block M1.
(3) Merge on one gate run on the final code with 0 wrong products, F1 at least 0.90, the demo right and every live miss a no-reply
turn. Re-judging 43657020370 under (1): `best-restaurant` passes; `gluten-free-declared` and `sesame-allergy` are no-reply turns; the
"stay on the job" miss («بدي أغراض لمجدرة» judged off-topic) is neither, so that run does not qualify and a gate run on the final code
follows (below).

| Run | Code | What changed | item F1 | wrong products | demo | live misses |
| --- | --- | --- | --- | --- | --- | --- |
| 43675197868 | 4eb4567 | final code: the quality word judged on the reply sent | 0.911 | **1 (g0752)** | right | 3: `gluten-free-declared`, `sesame-allergy` (no reply, SP2); "stay on the job" «بدي أغراض لمجدرة» judged off-topic |

Neither failure of 43675197868 is M1's. **g0752** «baddi zet Lina 3abbed shams, l 2annine l z8ire 0.85» was read as three lines and
the size-only line «l 2annine l z8ire» ("the small bottle") matched AK-0121 (7Up 330 ml): main's planner (`plan_order_core_0078`)
returns exactly the same as M1's wrapper for that reading (checked locally; the wrapper acts only on a mixed word). **«بدي أغراض لمجدرة»**
is the reading call, whose prompt, schema and tools M1 left byte-identical to main; it failed in 3 of the last 4 runs. Both are
recorded for lane B below. One more gate run on the same code followed:

| Run | Code | What changed | item F1 | wrong products | demo | live misses |
| --- | --- | --- | --- | --- | --- | --- |
| **43677251482** | 7d0008b (code as 4eb4567) | the same final code | **0.914** | **0** | **right** | **none (41/41)** |

**The coordinator's merge condition is met by 43677251482** (0 wrong products, F1 0.914, the demo right, no live miss). M1 merges.

**For the ordering lane (found here, not fixed: `concierge.ts` is outside M1's files):** in 2 of the last 4 live runs one ask call
stopped at `max_tokens` (1024, `request()` in `concierge.ts`) with no text and no tool call, so the turn handed off with nothing sent
(`sponsored-fails-restriction` in 43642090610, `gluten-free-declared` in 43649220096). The same can happen on a real turn. The live
test's `steps` trace shows it as `{"stop":"max_tokens","tools":[],"text":null}`.

Before the decision, the wrong product was main's, not M1's: run 4 read with main's prompt, schema, tools and effort byte for byte and
still got g0815 wrong, and SP1's "before" run on main had the same pair wrong. Live misses on main's own prompt run about 2 of 41 a run
(first drafts the guard refuses: `halal-certified`, `calories-no-data`, `best-restaurant`, `siyami-first-time` in turn).

Files outside the row, each minimal and only to follow the move: `packages/agents/src/{pipeline,windows,concierge-tools,cart,cron,job-card,payment-proof,quick-intent,output-guard}.ts`, `apps/gateway/src/index.ts` (notices and on-the-way through the messages), `evals/cases/{quick_intents,neutral_and_food_facts}.json`, `evals/run.ts` (its ask input mirrors `turn.ts`, with `REPLY_RULE`), and the flow tests whose expected words changed (`test/db/*`: now read from `ar`, `en`, `fr`). No price source, no gateway allowlist, no money function changed.

Changes a reader will see (the meaning is the same; the brief's rules forced the layout):
- The brief's own card example has four emojis (🛒 🛵 📍 💵); the rule says three, so the card has 🛒 📍 💵 and the fee line none. The founder may pick the other way; the test then changes.
- 🙏 ☀️ 🚪 🧺 🗑 📎 are gone (not in the set). The pick and return cards group their lines under one ⚠️ or ✅ heading instead of one emoji per line.
- Amounts that sat mid-sentence ("حوّل $12.00 عبر Whish", "أغلى بـ $0.24", staff cash lines) are now on their own line.

Not done, and why:
- **The founder's nightly report (G1-23)**: `ak_day_close_*` is in 0121 and `templates.json` as a draft, not submitted. The ops line is the Kapso sandbox, which holds no templates, and a template on the customer number would break invariant 9. Submit it on the ops number once the +961 numbers exist (A3); wiring it is in `apps/console` (`sendDayClose`), console lane: use `sendCodeStarted`'s pattern on the ops line.
- **The window reminder**: the template is submitted; no code sends a reminder yet (no such event exists). Whoever builds it: event `window_reminder`, params code and window label.
- **Fixed texts still Arabic-only, outside M1's files**: `memory.ts` (remember/forget), `feedback.ts` (the after-delivery tap), `catalog-messages.ts`, `voice.ts` (voice limits), `cart.ts`'s own `CART_TEXT`, and the ops alarms in `index.ts`. They follow the old wording and are not checked by the rules test. Move them into `messages/` in the next session that touches each file.
- **Live proof**: an English or French customer on staging, the address on the card, and a template after 24 hours wait for a deploy of main and Meta's approval (about a day). The hourly sync reads the new templates' status like the others.

For other sessions:
- Every fixed message: add the key to `messages/types.ts`, the words to `ar.ts`, `en.ts`, `fr.ts`, a sample to `render()` in the rules test, and update the snapshots. Never a string literal to a customer in code.
- A message code starts outside the customer's turn: `sendCodeStarted(deps, party, event, build, key)`, with a template per language in a new migration.
- Console (names page): `name_gaps_open` lists the products customers saw without an Arabic name, most seen first.

### Open requests carried forward

Collected by H1 from every finished session record (`docs/history/HANDOFF_sessions_2026-11-13_14.md`) and checked against later sessions: an item is here only if nothing later shows it done. "A3" is the production session; "WEB1", "WEB2", "D4b", "D5" and "M1" are in `docs/BUILD_PLAN.md`.

#### Lane A infra

- A2: build the Anthropic client in `apps/gateway/src/index.ts` with `maxRetries: 0`, because `turn.ts` retries capacity failures itself. No later section says it was done. (session B1)
- Lane A: wire `deps.stt` once the founder picks a second speech provider and its key exists (`settings.stt.second_provider`); `STT_API_KEY` is not set. (session B3; Phase 0 table)
- Lane A: let the gateway re-check only the model's words of a reply that also carries code-written prices (e.g. `authored.text`). (session B3)
- Whoever owns `package.json`: `npm run eval` points at `tsx evals/run.ts`, which cannot load the prompt's `.md` import; change it to `vitest run evals/live` with `ALO_LIVE_EVAL=1`. (session B2)
- A3 (G1-13): staff sign-in settings and SMTP for staff invitations are not done; the founder chose Resend for staff email, but no section shows it built. Until then invitation mail only reaches Supabase org members. (sessions A5, D3, R4; D1)
- A3 (G1-14): replace "narrow production key" with a separate production Kapso project and key; webhook signing secrets are readable by any read key. (session R4; F)
- A3 (G1-20): Supabase Pro with daily backups and one tried restore before real money; also still to do: a production project. (sessions R4, section D)
- A3 (4.11): correct `docs/COST_MODEL.md` (AI cost per order $0.012) against `ai_cost_daily` (probe about $0.0018 an order, upper bound). (session A4)
- A3: read Meta's policy section 4.7 and the opt-in page in full before the paid pilot; Kapso docs were only 100,000 of about 992,000 characters read, so retention and the transcription provider are unconfirmed. (session R4)
- Supabase egress is not read by `usage-check.yml`: the dashboard's usage report refuses the Supabase access token (HTTP 401) and the documented API has no figure. The weekly run says "left off"; read egress by hand (dashboard, Organization, Usage) until a way exists. (session A5)
- `CATALOG_FEED_PASSWORD` is not a repository secret yet (the Worker keeps the value set in Cloudflare; `deploy-staging` only sets it when the secret exists), and `SUPABASE_PLAN` is not a repository variable (the usage check assumes the free plan until it is). (session A5)
- If Kapso redirects media outside `kapso.ai`, the picture or note is refused; add the host in `packages/wa/src/media.ts` if a real message shows it. (session A5)
- Ops line safety condition: do not register a picker on staging until the hourly probe also picks (a probe picker that taps start and done), or the probe order sticks in `confirmed` and raises `probe_stuck`. (session C2)
- Test infrastructure session: build the migrated database once per CI run and restore per file (`apps/console/test/kit.ts`, `test/db/flow-kit.ts`); this is what reaches the 60% CI-minutes cut. Workflow changes alone gave about 25%. (session A6)
- Watch the next days' runs for the daily CI minute figure and a docs-only pull request, neither seen yet. (session A6)
- Kapso API shows no credit balance, so "alert below an amount" cannot be built; only the paused-sends check exists (blocked, nothing to do). (session A2)

#### Lane B ordering / agents

- **Lane B (open; found by M1's gate run 43675197868, main's code):** (a) a size-only reading line becomes a product: g0752 «baddi zet Lina 3abbed shams, l 2annine l z8ire 0.85» read as «zet Lina» / «3abbed shams» / «l 2annine l z8ire», and the planner (`plan_order_core_0078`, unchanged by M1) matched the third line to AK-0121 (7Up 330 ml); add the reading to `evals/language/zero-wrong.json` when fixing. (b) The reading judges «شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» off-topic in 3 of the last 4 language-pack runs (`evals/cases/off_topic`, live "stay on the job"). (session M1)
- **SP2 (fixed in #63, see "SP2: no-reply turns" above; found by M1, coordinator 15 Nov): the ask loop could end a turn with no reply**, which hands the customer to a person with nothing sent. Two causes in `packages/agents/src/concierge.ts`: a step stops at `max_tokens` (1024, `request()`) with no text and no tool call; or the model calls `extract_order`, `runAskLoop` answers «the reading for this turn is already recorded; it is in `reading`» (while `reading` can be null), and the model ends the turn, sometimes writing «I'll reply once I've checked the catalog» outside a tool. Seen in 5 live cases over 4 language-pack runs (43642090610, 43644483826, 43649220096, 43657020370; `evals/live` `steps` trace). Likely fix: answer `extract_order` in the ask loop with "answer now through reply", and retry once (or raise the cap) when a step stops at `max_tokens` with no tool call. Recorded case: `sesame-allergy-no-reply` in `evals/cases/live_wording_attempts.json`. (session M1)
- Pound total on the order card and receipt should be a setting, not hard-coded either way, pending lawyer item 4; not built. (session R4)
- Known limit: the deterministic card path does not check restrictions against food facts; a stated restriction only travels on order notes. Case `sponsored-fails-restriction` needs 1.11 and 8.12. (session B2)
- Known limit: the output guard has one known false positive («أحسن تبعتلنا الموقع» read as a quality word), and food-fact unlock is per attribute group, not per product. (session B2)
- Found, not changed: `fold_text` (0003) has misaligned strings (ة to ي, ى to ا, ؤ to ه, ئ to و), so «قهوة» and «قهوه» fold apart; `catalog_tokens` works around it. (session B3)
- WEB2 (`turn.ts`): a customer message containing `ALO-` goes to `claimLinkCode` before any model; "sign out" calls `revokeWebSessions`; `confirm_on_whatsapp` sends the card to WhatsApp; token-first wrappers `locate_pin`, `save_customer_pin`, `set_place_details`, `open_delivery_windows` (0156-0157), added to the grant lists. (session C4)
- WEB1 (done and live on staging, pull requests #60 and #62): see "WEB1" above. Still open: a Cloudflare rate-limiting rule on `/search` and the cart routes; the domain; the lawyer's privacy and terms text; Arabic and French wording read by a person. (session WEB1)
- Whoever next changes `turn.ts`'s catalog-cart path: mark those cards `channel = 'catalog'` (today `whatsapp`). (session C4)

#### Lane C hub

- Switch on `settings.picking.offer_substitutes` (still false) together with C2's picker tests that assume it off; B3 left it to "the next hub session". (sessions C2, B3, C3)
- Ops line (`apps/gateway/src/ops-turn.ts`): `rider_picked_up` raises `CASH_CAP hard_cap at pickup`; the rider gets a generic error. Catch it with a plain "hand in cash at the hub first" message, and catch `wrong_line`. (session F1)
- Known limit: the ops-line voice note is not copied to the `media` bucket; a person must listen in the ops number's inbox. (session C3)
- Rider-incident transfer: no "pick up from a rider" stop on the job card (goods come back to the hub). (session C2)

#### Lane D console

- Console pages for C2's items: pick queue (`pick_queue`, `pick_list`), rider incidents (`mark_rider_off`, `call_off_stranded`, `receive_rider_cash`, `riders_on_shift`), and the `count_needed` and `pick_empty` exception actions "were not built". (sessions C2, D2)
- Console action for exception kind `scheduled_day_changed` (detail: slot and its orders), and the schedule actions telling the customer; windows, calendar and slot pages are built. (session C3)
- "Go without this line" button on the `scheduled_stock_short` exception calling `drop_scheduled_line(order, product, by, reason)`, then telling the customer. Only SQL can call it today. (sessions W1, C3)
- `apps/console/src/pages/approvals.ts` : kind `payment` should read "Overpaid transfer", not "Refund". (session F1)
- `app.ts` `explain()`: plain words for `EXCEEDS_OWED`, an "advance" checkbox on the receiving pay form (`pay_supplier_checked` needs the two new args), and day-close columns for `over_short_usd`, `short_owed_usd`, `cod_flags`. (session F1)
- No page changes a catalog placement (`catalog_placements` has no editing function); readiness says "not placed" without a link. One function and one form. (session D4)
- Console could show `catalog_feed_report().not_placed`. (session K1)
- Pictures page: show the vision check's reasons (CONSOLE.md "extend"), not in D4's row. (session D4)
- Names page: keys and "Approve all shown" are built (D5); swipe was left out on purpose (see D5).
- No SQL function exists for disputing a cash drop, rejecting a menu import, or adding staff from the console (staff are added by workflow only). (session D1)
- Sign-in has no throttle of its own; only Supabase Auth's per-IP limits, which count Cloudflare's IP. (session D1)
- Console tests flake under load: each test builds its DB inside the test (add `beforeAll` with a longer timeout), `today.test.ts` measures lateness against the clock, `sign-in.test.ts` hook timeouts at 10 s. (sessions B3, B4, A6)
- `docs/CONSOLE.md` not updated for I1's page. (session I1)

#### Founder / Rasheed

- Rotate the three Kapso webhook signing secrets once before the pilot (and after anyone who might have seen one leaves). It is one click and no code: Actions, `deploy-staging`, Run workflow, branch `main`, tick "Make new Kapso webhook signing secrets". It is a switch on the whole deploy workflow, so the run also applies migrations and redeploys the Worker from `main`: pick a quiet hour. Check the run summary for three lines, "webhook ready ... signed test event accepted" (customer, ops, project). Steps and failure handling: `docs/RUNBOOK.md` "Rotating the webhook signing secrets". Nothing is known to have leaked; no session has run it, because it is a deploy. (session PUB1)
- Send the 0.13 message from his own phone to the staging customer number (READY TO SEND); then any session runs the `staging-evidence` workflow. S1 notes the phone retest "is not recorded anywhere as done". (sessions A2, S1)
- 0.9 Meta ownership and verification: BLOCKED on the Meta Business Portfolio admin (steps 1 to 5, including one real click-to-WhatsApp ad click so a payload with `referral` is saved). (section E)
- 0.12 Meta billing guard: BLOCKED on the billing owner (Kapso credits or card; a few dollars of Kapso credits are needed for the staging ops line either way). Real traffic does not start before this. (section E)
- Meta and Cloudflare steps of RUNBOOK "WhatsApp catalog" A to C (password, link, catalog, hourly feed, catalog id into `settings.catalog`, sets, icon and cart). Until then `show_catalog` answers `catalog_not_ready`. (session K1)
- Add Account > Billing > Edit to the `CLOUDFLARE_API_TOKEN` secret, set repository variable `CLOUDFLARE_BILLING_EMAIL`, rerun `cloudflare-spend-limit`; until then there is no hard stop or spend alert on Cloudflare. (session A6)
- Sign in to the console once: run `console` workflow action `add-staff` for his email and set a password. The emailed link flow is not proven live. (sessions D1)
- Set `BRAVE_SEARCH_API_KEY` (adds brand-site and web image search) and take intake photographs on a plain background (5.15); Open Food Facts alone gave 2 of 291 pictures. (session P1)
- Decide each of the 282 name proposals on `/names` (loaded by D4) and have Arabic names, all model-written, read by an Arabic reader; the checks cannot tell a wrong word from a right one. (sessions N1, D4)
- Arabic-reader sample for auto-approvals: `record_arabic_reader_sample` needs 50 checked with no error before model-written Arabic can ever auto-approve. (session I1)
- Approve pictures on the console pictures page; none of the proposed pictures is approved, so the catalog feed is empty. (sessions K1, S1)
- Confirm food-fact proposals at intake against the real pack (5.15); none is approved, and no real label photo has been read. (sessions N1, D3)
- Upload the 51 voice notes to `media/voice_eval/shouf-51/` (RUNBOOK "Voice notes for the evaluation"); V1 starts when the check query answers 51. (session A4)
- Privacy notice: say Kapso transcribes voice notes through ElevenLabs, which may keep transcripts up to three years, or choose a second provider and score both on the 38 notes (5.8). (session B3)
- Set the monthly spend limit on the staging Anthropic key (console only) and use a separate key for production; confirm API web search is enabled for the organisation (I1's identity step). (sessions A1 table, I1)
- Send the written questions to Whish, areeba, MontyPay and Tap (only he can; no answers exist). Tap goes last, only to ask. (session R4)
- Windows data: the seeded Ramadan, Lent and holiday plans are labels only (`calendar_kind` null); decide whether to add kind plans on `/windows` (needed before February 2027), and correct the "expected" Islamic dates when decrees are published. Martyrs' Day and Eid office-closure days are unconfirmed. (session A6)
- GitHub plan and minutes: confirm the plan (Free 2,000 minutes, 1,671 used in two days), or choose GitHub Team (3,000 minutes, one seat), or merge fewer, larger pull requests. Sentry Team about $29 a month if two people need it. (sessions R4, A6, I1)
- Second Kapso test number is needed before two riders at once, a rider and ops lead on different phones, or testing templates on the ops line. (session A1)
- Remove the two leftover Kapso functions (`whatsapp-flow-...-data-...`) by deleting the two Flows or data endpoints in the Kapso dashboard. (session A1)
- If he prefers the card straight after the pin, drop the one-time house-and-floor question (`place_has_details` in `completePending`, one condition). (session B4)
- Confirm the decisions written down "for the founder": C2 (), C3 (757-763), D2 (524-530), F1 (961-969), D4 (997-1003), W1 (1091), I1 (1114-1119, including whether to research the 291 existing items again through the API, about $15).
- R4 records Hussein as the second approver; no section shows his staff account added (gap, not stated as a request). (session R4)

#### Lawyer / accountant

- Lawyer question 4: whether the 2019 Ministry of Economy circular on pound price display still binds shops. (session R4)
- Lawyer question 8: Open Food Facts share-alike (ODbL; attribution is stored in every proposal's `detail`). (session R4)
- Accountant: no item addressed to an accountant appears in HANDOFF.

#### Live proof needed

- Real Kapso webhook payloads captured by our own Worker (`capture-kapso-fixtures` after 0.13; also real payloads without a phone, real image payloads and whether `media_url` needs the API key). (sessions A2, B1, B2, D)
- Typing indicator, a second speech provider, a real click-to-WhatsApp ad referral payload. (session B3)
- Real ops-line buttons on a real phone (sandbox buttons never proven; no picker has used the ops line). (sessions A2, C2)
- Meta approval of nine utility templates (three Arabic, three English, three French), and rates on the first bill (4.4); the Lebanon rate cards disagree (0.0091 or 0.0105 USD), the first bill decides. (sessions A2, A4, S1)
- A4's live checks after deploy not recorded: the 12 open `heartbeat:probe_silent` cases close, the two Sentry cron monitors appear, `ai_cost_daily` fills, language-specific templates. (session A4)
- A5: the public `catalog` bucket holds no picture yet (nothing is approved); the first approval on the pictures page is the first copy and the first real proof of `syncCatalogPictures`. `outbox_mark_from_status` (0116) and the Kapso media redirect need a real message. (session A5)
- Scheduled windows: a tap on a real list, a card after hours, a full window. Windows now exist on staging (A6 seed) but nothing has been tried by a customer. (sessions C3, W1, A6)
- WhatsApp catalog end to end: feed fetch by Meta, `link` required or not, picture size rules, commerce settings (icon, cart) through Kapso, a real cart below the minimum, `select * from place_rechecks` on staging. (session K1)
- Money paths (late payment, overpayment approval, damaged note, drawer refusals, COD over/short) are proven on PGlite only. (session F1)
- Console actions (any form), the end-of-shift message and chat replies reaching a phone, the founder's day-close message. (sessions D1, D3, D4)
- 1.23: proven on staging 14 Nov with one test product (see "A5: infra, live results"); a real new product from the founder is still unseen. (sessions B4, A5)
- Brave search request shape (never called), a person approving a picture. (session P1)
- C1's food facts, demand, receiving and recall functions on real data. (session C1)
- A real customer's ask-path turn (a line not found or ambiguous) still makes two model calls; not seen on staging. (session SP1)
- Intake pipeline: no research run, spot check or rule switch on staging; web search tool pairing `claude-haiku-5-5` with `web_search_20250305`. (session I1)
- C4: `web_channel` role grants on staging and a JWT with `role: web_channel` through PostgREST. (session C4)
- Cloudflare: load, queue retry, free-plan CPU limits against a real turn; plan not known. (section D, Phase 0 facts)
- Speed from a phone in Chouf (server side measured: p50 5.6 s on staging after SP1); speech accuracy on the hand-corrected voice notes; a shadow run with staff placing real orders reconciling to zero. (sessions SP1, section D)

#### Other

- G1-23 / M1 (**built in #54, not merged**; the nightly report is left for the ops number, see "Session M1"): service messages that staff or code start have no template and fail outside the 24-hour window: what changed at the shelf, the substitute question, a delay, the founder's nightly report (21:40 Beirut). One utility template per event in ar, en, fr. (sessions C2, D2; AUDIT-G1)
- M1 (**built in #54, not merged**): move W1's texts (`CARD_TEXT` in `order-card.ts`, `ANSWER.status`) with the rest of the message design. (session W1)
- H1: `supabase/seed/proposed_pilot_settings.sql` header still says "not applied automatically" and the small-order fee "has no effect until task 1.16". (sessions B2, A5)
- `close_shift(driver)` without `p_force_by` still records no acting party. (sessions D1, D2)
- Tracking-page map for the website: Mapbox free tier (50,000 loads) or MapTiler Flex ($30), never OSM's own tile servers; choice not yet made. (session R4)

### A. Built and covered by automated tests
| Area | Where | Notes |
| --- | --- | --- |
| Schema, state machine, ledger, consent | migrations 0001-0003 | `order-machine.ts` is checked against the table in a test |
| Hardening: skipped-step taps, per-currency cash, exposure cap, timers, indexed search | 0004 | |
| Rider flow: shift, dispatch, batching, accept, pickup, arrive, deliver, collect, no-answer, prepaid confirm | 0006, `apps/gateway/src/ops-turn.ts` | Rider messages are parsed by code, no model |
| Hub flow on the ops line: pick, missing item, substitute, refunds and credit, rider offered at pick start, returns by button, rider incident | 0030-0035, `apps/gateway/src/ops-turn.ts` | Session C2 (history record); staff messages are parsed by code, no model |
| Scheduled orders: windows and a calendar as data, capacity held at the tap, cut-offs, changes, rescheduling, the rider in time for the window | 0040-0041, `packages/agents/src/order-card.ts` | Session C3 (history record); the customer side is lane B's to wire |
| Reliability: turn keys, outbox lease, inbound reconciliation, exception queue | 0007, 0008, `apps/gateway/src/index.ts` | Lease means at-least-once after a crash, by design |
| Stale-quote and address checks at confirmation | 0007 `confirm_order_checked` | |
| Returned goods after a failed delivery | 0008 `receive_return` | Chilled, frozen, fresh are written off unless cleared |
| Learning: customer memory, alias promotion, eval capture | 0007 | |
| Menu import from a link, merchant approval | 0007, 0009, `packages/agents/src/menu-fetch.ts` | A person approves every import |
| Rider earnings: fees and tips to the rider, kept from USD then LBP cash, remainder from the hub | 0009, 0010, `test/db/rider-settlement.test.ts` | Acceptance test: customer pays fully in lira, books reconcile |
| Marketing kill switch; voice-note policy (customer line); neutrality and food-facts prompt rules | 0011, `packages/core/src/voice-policy.ts`, `prompts/concierge.md` | The rules are enforced on model text by the output guard since B2 (1.10) |
| Pilot locks: the gateway refuses to send unless the outbox claim returns true; marketing cannot be switched on by a settings write | 0012, `packages/wa/src/gateway.ts`, `packages/wa/test/gateway-outbox.test.ts` | Both were real defects found in review on 12 Nov; see below |
| CI, secret and dependency scanning, staging and production Worker environments, runbook | `.github/workflows/ci.yml`, `wrangler.jsonc`, `docs/RUNBOOK.md` | Written and dry-run locally; not yet run on GitHub or Cloudflare |
| Cash message parser, job cards, merchant channel adapters | `packages/core`, `packages/agents` | |

Two defects fixed on 12 November 2026, both confirmed in the code before the fix:
- The gateway sent the message when the outbox claim returned a database error. The Concierge test's fake database had no
  `outbox_claim`, so every test send had been going out through that hole. It now throws `OutboxUnavailable` and the turn retries.
- Migration 0011 seeded the marketing switch with "do nothing on conflict", so a database that already had it on kept it on.
  0012 forces it off and a trigger rejects any write that enables it. The gateway also refuses marketing in code.

Outbound send audit, 12 November 2026. Every path that sends was read. Before the audit, five ops alerts had no key and
two reply paths sent unkeyed when a turn key was missing. Now `dedupeKey` is required by the type, the gateway refuses a send
without one, and every path has a stable key:

| Path | Key | Stable across a retry? |
| --- | --- | --- |
| Customer replies (`turn.ts`) | turn key + message index | Yes. The turn key is the sorted inbound message ids. |
| Rider replies (`ops-turn.ts`) | turn key + message index | Yes |
| Ops alerts raised inside a rider turn (cash drop, no answer, error) | turn key + alert name + recipient | Yes |
| Rider job offer | `offer:` + delivery id | Yes |
| No rider available | `norider:` + order + 5-minute bucket | Yes within the bucket; repeats by design after it |
| Offer expired, cash reminder, unpaid, exception due, returns pending, door wait | event id + time bucket + recipient | Yes within the bucket |
| Customer notices (on the way, rider waiting) | notice + order | Yes |
| Give-up alert after three failed attempts | `giveup:` + turn key | Yes |

Known limit: reply keys use the message's position in the turn. If a retried turn produces its replies in a different order,
a different sentence could be skipped as "already sent". The turn record (`begin_turn`, `finish_turn`) makes this rare; task 4.5
tests a crash in the middle of a turn. Templates do not exist yet; when 4.3 adds them, each is keyed on order + event.

### B. Built, not covered end to end (written and type-checked; no test drives them)
- Deliverect adapter: shape only. Needs a partner account.
- Market tables (`markets`, `market_settings`, `setting_for`): schema only. Functions still read global settings.

### C. Still to build
See `docs/BUILD_PLAN.md`: Phases 0 to 7 lead to a paid grocery pilot; Phase 8 is restaurants; Phase 9 is the website and diaspora
orders; later items (nutrition calculation, advertising, forecasting) each have a trigger. Scheduled orders (2.8) are built in the database and the card (C3); the customer cannot choose a window until lane B wires it.
The console exists (D1, D2, above). D1's proposed functions are migration 0045. The 1.23 review-list page can be built: B4 merged its functions (`search_word_reviews_open`, `resolve_search_word_review`).
Ordering lane: B1, B2, B3 and B4 are done (history record). 0.13: retry after B4's deploy (the flow now asks the pin, then house and floor, then sends the card). 1.22's zero-wrong gate is met on the replay of live readings (B4). K1 is done (history record): the leftovers, audit items 4 and 5, and 1.21 in code; the catalog waits on Rasheed's Meta steps (RUNBOOK) and on approved pictures.
Hub lane: C1, C2 and C3 are done (history record). Console lane: D1 and D2 are done (history record). Commerce core: C4 is done (history record); the website (WEB1, WEB2) builds on it.
Use its task numbers (0.1, 1.2, ...) for branches and pull requests.

### D. Needs a live account or real conditions (cannot be finished in code alone)
- Kapso: real webhook payloads captured by our own Worker (A2 built fixtures from real message objects and Kapso's documented envelope), typing indicator.
- Meta: approval of the nine submitted utility templates (three Arabic, A2, 4.3; three English and three French, A4); the rates on the first bill (4.4). Which messages are billed is now recorded per message from Meta's status webhooks (4.12).
- Supabase: staging project `alo-king-staging` (`lhgkvvdckwbfpdsftzqp`, eu-central-1) exists and was empty on 13 Nov; `deploy-staging` fills it (Phase 0 facts below). Still to do: turn on point-in-time recovery before real money (paid plan), and a production project.
- Cloudflare: deploy and the one-minute cron trigger are in place (Phase 0 facts below); the hourly probe order proves the cron and the Durable Object alarms doing real work on staging (A2). Still to prove: load, queue retry.
- Speed: time from message to card, measured on a phone in Chouf. The server side is measured (A4, `turn_waits`): typed text p50 15.9 s on staging, 14 Nov.
- Speech: accuracy on the hand-corrected voice notes.
- A shadow run: staff place real orders end to end, and stock, rider cash, rider earnings and the ledger reconcile to zero
  unexplained balance at day close.

### E. Meta account steps (cannot be done from code; written by session A1, 13 November 2026)

#### 0.9 Meta ownership and verification: status BLOCKED on the Meta Business Portfolio admin
What Kapso shows (read 13 Nov): WhatsApp Business Account `1086076707594153`, number (see the Kapso dashboard), display name "Alo King" (approved without review),
phone_number_id `1378974041965966`, status CONNECTED, quality rating UNKNOWN (no traffic yet), messaging limit TIER_250 (250 customers a day),
WABA review APPROVED, not an official business account. What Kapso cannot show: which Meta business portfolio owns the WABA, and whether the business is verified.
The person who is an admin of the Meta business portfolio does these, in order:
1. Open business.facebook.com, Business settings, Accounts, WhatsApp accounts, select `1086076707594153`. Read **Owned by**. It must be Alo King's own portfolio
   (the one in the company's legal name). If it names anyone else (Kapso, a personal portfolio, an earlier attempt), the number does not survive a change of provider:
   write that name in the pull request or an issue and do not start verification yet. Ownership is fixed first.
2. Business settings, Business info: legal name, address, phone, website and email exactly as they appear on the company documents.
3. Security Center, Business verification, Start verification. Have ready: the company registration certificate or commercial register extract, a document that
   proves the address (bank statement or utility bill in the company name), and the business phone or email on the same domain as the website. Submit. Record the date submitted and the status Meta shows.
4. Business settings, People: at least two admins with full control, two-factor authentication on for both. Business settings, Partners: Kapso is listed with access to the WABA; leave it.
5. Click-to-WhatsApp data: Kapso documents that the ad `referral` (source id, ad click id, headline) arrives inside the `whatsapp.message.received` payload when present.
   Proof needs one real click on an ad that opens a chat with the customer line (a test ad from Alo King's ad account, small budget, ended after one click).
   Afterwards: Kapso dashboard, WhatsApp, Data, Ads (CTWA) shows the click; run the `capture-kapso-fixtures` workflow; the saved payload must contain a `referral` object.
   If it does not, task 1.13 cannot be built as written: say so in the pull request.
Done when: step 1 names Alo King's portfolio, verification is submitted (date written here), and one payload with `referral` is saved under `test/fixtures/kapso/`.

#### 0.12 Meta billing guard: status BLOCKED on the billing owner
Since 1 October 2026 replies are billed after 1,000 free a month per number, and an account with nothing to charge stops sending when the allowance runs out.
Two ways to pay, chosen per WhatsApp Business Account and hard to change later (switching from Kapso credits to a Meta card means a new WABA and a number migration):
- **Kapso credits.** Kapso pays Meta and charges the project's credits at Meta's published USD price. You can connect with a zero balance, but once the balance is at or below zero
  Kapso pauses sends on every number in the account (reason `service_credits_exhausted`; the send API answers HTTP 402).
- **Pay Meta directly.** A card in Meta Billing Hub for the WABA. Meta controls the rules if a payment fails.
Steps, by whoever holds the billing login:
1. Kapso dashboard, project settings, the WhatsApp billing card: read which mode WABA `1086076707594153` is in and, if it is not USD, the FX margin shown. If a payment source is already attached, say which in the pull request and stop.
2. If it is **Kapso credits**: add credits. At about USD 0.07 to 0.09 of Meta fees per order (`docs/COST_MODEL.md`), USD 50 covers many times over the 100+ shadow-run orders. Write the date and amount here.
3. If it is **direct**: business.facebook.com, Billing Hub (Payments), Payment methods, add a card to WhatsApp account `1086076707594153`. Write the date and the last four digits here, never the whole number.
4. **The staging ops line uses Kapso credits whichever mode the customer line is in.** Kapso bills service messages sent from its sandbox number to the project's credits, at the recipient market's rate,
   and rejects them with HTTP 402 when the balance is too low. So even with direct billing, put a few dollars of credits on the project, or the staging ops line cannot send.
Done when: a payment source is attached to the WABA (step 2 or 3) and the project holds some credits (step 4), both with dates written here. Real traffic does not start before this is done.


### F. Standing facts from the Phase 0 live runs (the run table and the task table are in the history record)

**Things the live runs showed that the plan did not know.**
- **Rolling back across a secret change reverts the secret set.** The drill rolled back one version; that version was created in the middle of the webhook step, so it had the customer signing secret but not yet the ops one. After a rollback, check `wrangler secret list` and run `deploy-staging` with "rotate" ticked if a secret is missing.
- **The Kapso connector returns webhook signing secrets in plain text** to anything with read access to the project. They were seen once by the build session, then replaced by the drill's rotation. Anything with Kapso read scope can read them: this matters for the decision in `docs/TOOLS.md` about the Kapso plugin and key scopes.
- The Supabase CLI is pinned (3.1.0). Bump it on purpose and re-run the deploy; `latest` failed once on a rate limit and v2 and v3 differ on `db push`.

**Staging ops line.** The Kapso sandbox number (`597907523413541`) is wired as the ops line, and a webhook for it was accepted. Kapso documents that the sandbox can send interactive messages (buttons) but not templates,
and only to one registered phone. Buttons are therefore not a blocker, and **a second test number is not needed for the 0.13 demo on one phone** (the customer line and the sandbox are different
business numbers). It **is** needed before: two riders at once, a rider and an ops lead on different phones, or testing the approved templates of task 4.3 on the ops line.
Sending a button from the sandbox is not proven live: it needs a registered phone (6-character code sent to the sandbox number) and is part of 0.13. The sandbox bills service messages to Kapso credits (0.12, step 4).

**Kapso leftovers.** Two functions remain in the Kapso project (`whatsapp-flow-...-data-...`). Kapso refused to delete them: each is still referenced by a WhatsApp Flow data endpoint.
They go when those two Flows or their data endpoints are removed in the Kapso dashboard (WhatsApp, Flows). They do nothing and are not connected to the Worker.

**Connectors.** The Supabase, Cloudflare and Kapso connectors available to build sessions are write-capable and account-wide (`docs/TOOLS.md`). This session used them to read and verify only.


## The AI architecture, stated once
One conversational agent, the Concierge. Around it: narrow AI functions (vision extraction for labels, menus and receipts;
speech-to-text; later, optional summaries) and deterministic services in SQL and TypeScript (stock, dispatch, cash, settlement,
refunds, ranking, timers, alerts). "Ops Copilot", "Business Analyst" and "Food Intelligence" are names for functions and reports,
not agents. A new agent is added only when a measured job cannot be done by the Concierge, a function or code.

## The milestone that matters
A real customer sends a Lebanese WhatsApp order, gets the right card, confirms, receives the right goods, pays, and
inventory, rider cash, rider earnings and the company ledger all reconcile. Everything in C and D is ordered toward that.

## Cost model
`docs/COST_MODEL.md`. With riders on fees and tips, Alo King's income is grocery margin and contracted commission only.
Rider earnings per hour is the number to watch.
