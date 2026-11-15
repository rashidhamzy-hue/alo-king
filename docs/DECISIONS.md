# Decisions (12 November 2026)

## Confirmed by the founder
| Decision | Where it lives |
| --- | --- |
| Riders keep 100% of delivery fees and tips. No hourly wage. | Rule 10; migration 0009 |
| Only signed, approved restaurants are orderable. Commission 5 to 10% in Chouf. | Rule 11; `approve_merchant()` |
| No tobacco, no alcohol, nothing branded Tawfeer; Joud and Super Value excluded from the catalog. 291 items. | `supabase/seed/catalog.csv` |
| Cash on delivery in USD or LBP at the daily rate; Whish and OMT confirmed by a person. Rider cash cap 150 soft, 200 hard. | Settings; migrations 0002, 0006 |
| No AI voice notes out. No promotional broadcasts from the customer number. Marketing locked off for the pilot. | Rules 17, 20; migration 0012 |
| Neutral and factual; food facts only from approved records; unknown is never safe. | Rules 14 to 16 |
| WhatsApp first. Website and diaspora orders are Phase 9. | Build plan Phase 9 |
| One Concierge agent, narrow AI functions, deterministic services. | Rule 21 |
| Hub near Baakline or Baqaata; not a confirmed property. Zones and fees are data. | Rule 13 |
| Restaurant outreach starts during the pilot, in person. | Task 5.16 |
| Voice-note limits: customers 3 minutes, merchants 5, riders and staff 2. | `settings.voice_limits` |

## Proposed, not yet confirmed
These arrived in an AI-written message on 12 November, in the founder's voice. Nothing below is applied. Each needs a
plain yes from Hussein. `supabase/seed/proposed_pilot_settings.sql` holds the first two, ready to run.
Update, 14 November: the founder approved the pilot settings file and answered the shortfall rule (item 8); see "Founder answers, 14 November".

| # | Proposal | Note |
| --- | --- | --- |
| 1 | Launch with the core and mid rings (25 villages); keep the outer 17 off until riders average 1.6 orders an hour | Matches the seed. Ring membership itself is still a draft to be checked by people who ride the roads. |
| 2 | Small-order fee of 0.50 USD on baskets under 10 USD, company income | Not charged until task 1.16 is built. |
| 3 | Stock only the fast movers on day one; offer the rest next day | Needs scheduled orders (2.8) for "next day" to be a real promise. |
| 4 | The three prospects named "Joud" are unrelated to the excluded Joud | Only the founder can know this. They stay flagged until he says so. |
| 5 | POS and Deliverect links wait until a partner passes 15 orders a day and asks | Already the trigger in the build plan. |
| 6 | Ops may phone customers who struggle with text or buttons | Goes into the staff routine (5.13). |
| 7 | Retention: voice notes and photos 90 days unless tied to a payment or complaint; chat text 12 months; financial records as the law requires | Task 5.9. A lawyer confirms the legal minimum. |
| 8 | Rider shortfalls stay flagged ledger entries, with no automatic deduction, until a labour lawyer has read the policy | This is how the code behaves today. |
| 9 | A Ramadan evening bonus for riders, budgeted in Phase 5 | Company money; add to the cost model when the amount is set. |
| 10 | Gift orders: hub goods refundable less the delivery fee; cooked food and failed surprise deliveries of chilled food not refundable, disclosed before payment | Phase 9. A lawyer checks it against consumer law. |

## Route provider: Google Routes or OpenStreetMap
Not measured. No journey data exists yet and no Google account was opened. What can be said now:

- **Geocoding and Places are not needed.** Customers send a WhatsApp location pin, and we save it with their own directions. A pin is a coordinate we own.
- **Routing is needed rarely.** The system uses a table of travel times from the hub to each village, refreshed occasionally. That is tens of requests, not one per order.
- **Cost.** Google's basic route request has a free monthly allowance of 10,000 calls and then costs about 5 USD per 1,000. The table refresh sits far inside the free allowance. Traffic-aware requests are a dearer tier with a smaller allowance.
- **Licence.** Google restricts storing and reusing its content. Place ids may be kept. Whether a stored travel time may be kept in our table was not confirmed; read the current terms before storing any. OpenStreetMap data may be stored with attribution.
- **Accuracy in the mountains.** Unknown for both. This is the question a test must answer.

The test (part of task 5.6): a rider drives 20 hub-to-village journeys covering all three rings, timed. Compare the OSRM
figure and the Google figure with the stopwatch. Adopt Google only if its typical error is better by three minutes or more.
Either way, our own measured delivery times replace the provider's figure as they accumulate, and those are ours to keep.

If Google wins, it goes behind the existing travel-time table as another `source` value, kept in its own rows, with a daily
quota cap and a budget alert. Dispatch, fees and the ledger do not change. A Google billing account needs the founder's
approval first.

Recommendation today: keep the OpenStreetMap path, run the comparison once in Phase 5, decide on the numbers.

## Group ordering
Placed as task 8.15, after five restaurants are live and scheduled orders (2.8) exist. Not built before.

| Question | Answer for the first version |
| --- | --- |
| How people join | A link that opens our WhatsApp number with a join code already typed. Each person sends it from their own chat. No WhatsApp group, no message to anyone who has not written to us. |
| Identity | The WhatsApp sender id, plus the first name they give. The name is printed on their meal. |
| Privacy | A participant sees only their own items. The organiser sees names and items. Phone numbers are never shown to other participants. |
| Deadline | Set by the organiser. At the deadline the basket locks. |
| Menu and price changes | The whole basket is re-quoted at lock. Anything unavailable is named to the organiser before the card. |
| Slot | Checked and held only when the organiser confirms. The card says the window is not held until then. |
| Who authorises | Only the organiser's tap confirms, and the organiser pays. One payment. |
| Delivery fee | One fee, the rider's, as on any order. |
| Cancelling and refunds | The organiser, until the kitchen accepts. Refunds go to the organiser. A participant may remove their own items until the lock. |
| Abandoned groups | Expire 30 minutes after the deadline. Participants who are still inside the 24-hour window are told. |
| Kitchen | One ticket, each meal labelled with a name. |
| Abuse | Codes are random, expire, and cap at 15 people. |

Deferred, each with a trigger in the build plan: several restaurants in one group, each person paying separately, shared
family baskets, office lunch clubs, shopping lists for gatherings. Recurring orders and village delivery rounds were already there.

## Product picture search (task 5.17, session P1, 13 November 2026)
The picture fetch (`scripts/images/`, run by `.github/workflows/images.yml`) needs one web image search API for the steps after Open Food Facts.

**Chosen: Brave Search API, image endpoint** (`GET https://api.search.brave.com/res/v1/images/search`, key in a header). Repository secret: `BRAVE_SEARCH_API_KEY`.

| Option | Why not, or why |
| --- | --- |
| Brave Search API | **Chosen.** Independent index, one key, results carry the picture address and the page it sits on, which the licence rule needs. Priced at about **USD 5 per 1,000 requests** (read from third-party pages on 13 Nov; Brave's own pricing page was not reachable from the build environment, and older pages show USD 3 per 1,000 and a free tier, since replaced by about USD 5 of monthly credit). |
| Google Custom Search JSON API | Closed to new customers and ending 1 January 2027. |
| Bing Image Search | Retired by Microsoft in 2025. |
| Resellers of Google results (SerpAPI, Serper and similar) | Work, but resell scraped results: a licence and terms question we do not need. Revisit only if Brave's pictures prove poor. |

**What it costs here.** One open search per item still without a usable picture, plus one brand-site search for the few brands listed in `scripts/images/brand-sites.json`. 291 items is at most about 330 requests, so **about USD 1.70 a full run**, and a second run only searches the items still without one. That is inside the monthly credit. Vision checks (fast model, up to five pictures an item) add a few US dollars for a full run.

**Founder step:** create a Brave Search API key and add it as the repository secret `BRAVE_SEARCH_API_KEY`. Until it exists the workflow runs Open Food Facts only, by design.

**Licence rules (build plan 5.17 step 4), as built.** The source decides the licence, and migration 0050 enforces the pairing with a check constraint: Open Food Facts is `cc_by_sa` and keeps its attribution; a picture counts as the brand's own (`brand_own`) only when both the page and the picture are on a host listed for that brand in `brand-sites.json`; everything else is `unknown`. Unknown pictures are kept only as a guide for the intake photo. `product_image_for_customer()` returns a picture only when it is approved and its licence is `cc_by_sa`, `brand_own` or `own_photo`. When the lawyer's line (5.11) allows search pictures, one later migration changes `product_image_licence_usable()`. Nothing changes it by a settings write.
`brand-sites.json` lists nine global brands whose own sites are certain (Nescafe, Nutella, Kinder, Lipton, Pepsi, 7Up, Nivea, Colgate, Lurpak). Local brands (Liban Lait, Leen Taanayel, Tannourine and the rest) are not listed: a person adds one only after opening its site. Until then their search pictures are `unknown`.

## Console hosting (task 3.1, session D1, 13 November 2026)
**Chosen: Cloudflare Workers, a second Worker beside the gateway** (`apps/console/`, staging name `alo-king-console-staging`, deployed by `.github/workflows/console.yml`). Not Vercel.

| Option | Why not, or why |
| --- | --- |
| Cloudflare Worker | **Chosen.** Same account, same deploy tooling (wrangler, GitHub Actions) and same secrets as the gateway, so one place to rotate a key and one runbook. It imports the gateway's own `send()` (`packages/wa/src/gateway.ts`), so a reply typed in the console passes the same preflight, `can_send()` and outbox claim as every other message: one door out (invariant 1). Plain server-rendered pages need no framework. Runs on the free plan (no queues or Durable Objects). |
| Vercel | A second hosting account, a second set of secrets and a second deploy path, for no gain: the console is plain HTML forms. It would also need its own copy of the send path or a new endpoint on the gateway. |

How it holds the rules: the browser never sees a Supabase key or token. Staff sign in with Supabase Auth through the Worker; the link from an Auth user to a staff party is `app_metadata.party_id`, which only the service key can write. The role is read from `parties` on every request, and the SQL functions check it again. The console reads tables and calls SQL functions, nothing else: its database module has no insert, update or delete (a test enforces it). Every action is written to an append-only log in the private `media` bucket (`console_audit/`) before it runs, and does not run if the log cannot be written.

## Picking and transfer rules (session C2, accepted 13 November 2026)
C2 built four rules into code and asked for confirmation. Accepted on 13 Nov by Claude, to whom Rasheed delegates these calls; he can overturn any of them.
1. A unit the picker cannot find is written off the stock count at once, and ops is asked to recount the shelf.
2. A dearer substitute is allowed on a cash order, only after the customer taps to accept it and sees both prices.
3. When an order passes to a second rider, the delivery fee goes to the rider who delivers it.
4. The second rider picks the order up at the hub.

## Search words for every new item (13 November 2026)
Founder rule: every new product or menu item gets its search words in every ordering language automatically, with the same builder and safety rules as the 1.22 language pack (task 1.23). An item the planner cannot find from generated phrasings goes to a person's review list, never to a guess.

## Product pictures from public pages (founder decision, 14 November 2026)
Rasheed decided that customer-facing product pictures may come from any public web page (brand sites, retailers, Open Food Facts),
overriding the "licence unknown is never shown" rule of 5.17 step 4 and not waiting for the lawyer's line (5.11). He accepts the risk.
What still holds: the picture shows exactly the catalog item; no watermark, shop logo, price tag or added text (Meta's catalog rules and
our own); the source address is stored with every picture; a person approves each one before a customer sees it; if a rights holder or
Meta objects to a picture it is withdrawn at once and replaced by our own photo at intake (5.15). Recorded licence value: `public_page`.
Applied to web search by session PIX (15 Nov 2026): a search hit that names its https page is filed as `public_page`; a hit without a page address stays `unknown`. No migration: 0070 already allows it.

## Founder decisions, 15 November 2026 (later): design paused; no new picture search service
Recorded by session PIX2. Each supersedes any earlier line that disagrees.

**1. All website and console design is paused for a full redesign later.** The founder will restart design himself; until he does,
**UX2, UX3 and WEB2 are parked** (each stays in `docs/NEXT_SESSIONS.md` and `docs/BUILD_PLAN.md` marked parked, with its row kept) and a
new session **FX1** is parked with them. Console work in other sessions stays **functional, on the existing components, with no visual
work** (no new styles, no new components, no screenshots required for it). Customer ordering on WhatsApp is unaffected.
**PAY1 now waits for CX1, not WEB2** (the payment core is built against the order functions, not the website's checkout).

**2. FX1, product facts by kind (parked).** Each item gets a **kind**: food, drink, household, personal care, baby or pet. AI proposes
the kind; a person approves it in the console (the same propose-and-approve path as names). Each kind shows only its own facts:
**no nutrition, allergen, diet or Open Food Facts lines on a non-food item.** Facts that are not confirmed collapse to one line,
"ask us on WhatsApp". The chat answers "doesn't apply" to a food question (calories, allergens, diet) about a non-food item. Invariants 14
to 16 still hold: unknown is never safe, and a stated allergy is an allergy.

**3. No new search service for pictures.** The founder declined to add Brave or any other search API (this replaces the "Chosen: Brave
Search API" row in "Product picture search" below; that section is kept as history). Pictures now come from a list of candidates
(`data/pictures/candidates.csv`: sku, picture address, page, time found), found with a session's own web search or by hand, and loaded by
the `images` workflow's **from list** mode, which runs the same checks (same pack, no watermark, duplicates refused, 1200 px JPEG under 300 KB).
A person still approves each picture on the console's Pictures page, fastest sellers first. The public-page rule of 14 November is unchanged.

## Founder decisions of 14 November 2026 (from `docs/SYSTEM_BRIEF.md`), recorded by session S1
Each is a decision. Where it disagrees with an older decision or with the wording of an invariant, it is in the conflict
register below; S1 resolved none of them. The founder answered all eleven on 14 November (section "Founder answers, 14 November", below).

| Decision | Where it is planned |
| --- | --- |
| A customer website at launch: catalog, search, cart, cash checkout, tracking, history, on the same core as WhatsApp | `docs/WEBSITE.md`, SYSTEM_PLAN 1 |
| Vendor-operated and third-party delivery; a vendor's hours may run past ours | SYSTEM_PLAN 2 |
| One cart, one vendor at first; combined orders (our groceries plus vendors' food) when data shows demand | SYSTEM_PLAN 3 |
| Grocery only from our own dark store; vendors are restaurants, cafes, bakeries and similar | SYSTEM_PLAN 3 |
| The AI acts alone only on a written list of low-risk actions; items code can prove certain go live without a tap; allergens, diet labels, prices and costs never | SYSTEM_PLAN 4 |
| One owner-operator, exception based; a daily summary replaces checking | `docs/CONSOLE.md`, SYSTEM_PLAN 11 |
| Console redesigned as the founder's cockpit, mobile first, installable, with push where supported | `docs/CONSOLE.md` |
| A founder assistant in the console, read only | SYSTEM_PLAN 11 |
| Vendor commands by message, confirmed in one tap, logged, undoable | SYSTEM_PLAN 8 |
| Warehouse at professional level: scan to pick, lots, expiry, FEFO, bins, counts | SYSTEM_PLAN 7 |
| Live tracking for customers: status first, position only with rider consent | `docs/WEBSITE.md` |
| Diaspora "send home" with card payment; never assume Stripe | SYSTEM_PLAN 9, RESEARCH_REGISTER a |
| National expansion as data (markets), before the second area, not before launch | SYSTEM_PLAN 17 |
| A full cost model per operation, editable | `docs/COST_MODEL.md`, `data/cost_model.csv` |
| The friends' test is simulated: the test rider delivers, no goods or cash move | SYSTEM_PLAN 16 |
| Prices in dollars; the amount in Lebanese pounds at the day's approved rate when a customer asks | SYSTEM_PLAN 14 |
| Rashid approves names, pictures, food facts and search words until an ops lead is hired | `docs/CONSOLE.md` (names review, readiness) |
| Friends' test payments: cash, plus a Whish or OMT screenshot | SYSTEM_PLAN 16 |
| Keep the source of every picture so it can be withdrawn at once | already enforced (0050, 0070) |
| Loyalty and referrals: ideas "first 3 deliveries free" and "credit after every 30 orders"; every reward priced against margin first | SYSTEM_PLAN 10, COST_MODEL 6 |
| A places list that grows from every delivery; the pin still decides | SYSTEM_PLAN 5 |
| Every operation timed; rider location only during a job | SYSTEM_PLAN 5 |

### Conflict register (C1 to C11: all resolved, approved as worded on 14 November 2026; see "Founder answers, 14 November" below)
| # | New decision | Conflicts with | Recommended answer (now the decision) | Built until the answer (superseded) |
| --- | --- | --- | --- | --- |
| C1 (resolved) | Web checkout confirms an order | **Invariant 4**: "Confirmation is a customer button tap" (written for WhatsApp) | Reword to "a customer's own confirm action on a channel where we verified them: a WhatsApp button, or the confirm button of a signed-in web session. The agent can never confirm." | The web checkout ends by sending the order card to the customer's WhatsApp, and the tap there confirms. No invariant changes |
| C2 (resolved) | A vendor's own drivers deliver and keep the fee | **Invariant 10**: "The delivery fee and tips belong to the rider" | Reword to "belong to whoever delivers: our rider, or the vendor whose driver delivers. Never company revenue." | The provider model as data only; vendor delivery stays switched off |
| C3 (resolved) | A founder assistant in the console; later a merchant assistant on the staff line | **Invariant 21**: "The Concierge is the only conversational agent"; BUILD_PLAN "More AI agents: not planned" and "Model-written daily digest" only after a month of day closes | Reword to "one customer-facing conversational agent. Staff tools may answer questions from read-only reports and may never act." The merchant assistant stays a narrow function that proposes a change for one tap | The daily summary and weekly report as pages and messages written by code; no chat box |
| C4 (resolved) | Website at launch | DECISIONS (12 Nov) "WhatsApp first. Website and diaspora orders are Phase 9"; HANDOFF business rule 10; BUILD_PLAN Phase 9 gates (four clean pilot weeks and a signed card gateway) | The new decision replaces the old for a cash-only website. The card-gateway gate stays for card checkout and diaspora orders | The plan follows the new decision: WEB1 and WEB2 are class A |
| C5 (resolved) | Combined orders carry a fee designed for the extra pickups | BUILD_PLAN 8.6: mixed orders have "one delivery fee" | One delivery line for the customer: the zone fee plus $0.50 for each extra pickup, all to the rider | One source per cart; no combined orders |
| C6 (resolved) | Items the system is certain about go live without a tap | DECISIONS (14 Nov, pictures): "a person approves each one before a customer sees it"; brief rule 2 "a person approves" | Automatic only for the rows of the table in SYSTEM_PLAN 4, each a check code can run; pictures from shops' public pages always need a person; a daily spot check of one in ten | Everything is approved by a person; the rules table ships switched off |
| C7 (resolved) | "First 3 deliveries free", "credit after every 30 orders" | BUILD_PLAN "Later": a stamp card (every 10th order) only after four clean pilot weeks; COST_MODEL | No reward at launch; the stamp card first; one acquisition offer at most (first delivery free on a first basket of $15 or more) | No reward exists in code |
| C8 (resolved) | Console redesign now | BUILD_PLAN Phase 3: "Build it plain. No design work until the pilot shows what ops uses" | Redesign the shell and the founder's pages now (he is the operator); keep every form and function as built | D4 adds the missing pages in the plain style; D5 (the redesign) waits for this answer |
| C9 (resolved) | The Concierge builds baskets ("dinner for 5 children") | BUILD_PLAN "Later": shopping list for a gathering, after the pilot | Design now, switch on when its eval cases pass (class B) | Not built; such requests get a question or a person |
| C10 (resolved) | A friends' test with three testers, simulated | BUILD_PLAN Phase 6: the shadow run uses real orders, real money and real riders | They are different steps: the friends' test comes first and does not replace the shadow run | T1 builds the simulated test |
| C11 (resolved) | Rashid approves alone until an ops lead is hired | DECISIONS (D2): the person who asked can never approve their own price change or refund | Hussein is the second approver, from the installed console | The rule stays: a large refund or price change waits for a second admin |

## Founder answers, 14 November
Recorded by session R4 on 14 November 2026, word for word from the founder's message. Each one supersedes any earlier line that disagrees with it.

1. The 11 conflict-register items C1-C11: approved as worded (the "Recommended answer" column).
2. supabase/seed/proposed_pilot_settings.sql: approved.
3. COD tolerance: $0.25 per order. A shortfall above it may be recorded as a rider receivable, but is never deducted automatically from rider fees, tips or earnings (riders keep 100%; deductions wait for the lawyer).
4. Staff email sender: Resend.
5. Loyalty: none at launch; stamp card after four clean weeks, priced first.
6. Combined orders: $0.50 extra pickup fee, to the rider.
7. Claude plan: stays on the 100 USD plan for the build month (at most three sessions at a time).
8. Second approver for Rashid's own refunds and price changes: Hussein.
9. Database: Supabase Pro with daily backups and one tested restore before real money; point-in-time recovery later, at volume.
10. Payment research: confirm Whish Pay, areeba, MontyPay and Tap from their own pages or sales contact, not third-party connectors or forums.

### What each answer changes (R4)
| Answer | Applied in |
| --- | --- |
| 1 (C1) | CLAUDE.md invariant 4 reworded; C4 and WEB2 may set `settings.web.confirm_on_page` to true |
| 1 (C2) | CLAUDE.md invariant 10 reworded; E2 may build vendor-operated delivery when its gate opens |
| 1 (C3) | CLAUDE.md invariant 21 reworded; AN1b (founder assistant, read-only) is a full prompt in NEXT_SESSIONS, run after AN1 |
| 1 (C4) | The cash-only website at launch; the card-gateway gate stays for card checkout and diaspora orders |
| 1 (C5, 6) | Combined orders: one delivery line, zone fee plus $0.50 per extra pickup, all to the rider (E3) |
| 1 (C6) | I1 ships its rules enabled only for the rows of SYSTEM_PLAN section 4's table, each after its first passing spot check |
| 1 (C7, 5) | No reward at launch; stamp card after four clean weeks, priced first; at most one acquisition offer |
| 1 (C8) | D5 builds the full console redesign; its stop condition is removed |
| 1 (C9) | The basket builder is designed now and switched on when its eval cases pass (class B) |
| 1 (C10) | The friends' test comes first and does not replace the shadow run |
| 1 (C11, 8) | Hussein is the second approver |
| 2 | The pilot settings seed may be run: 25 villages; small-order fee 0.50 on baskets under 10 USD |
| 3 | F1 (done) already built `settings.over_short.cod_tolerance_usd` at 0.25. Added rule: a shortfall may be recorded as owed by a rider, never deducted automatically; CLAUDE.md invariant 10 says so |
| 4 | Staff sign-in emails go through Resend (A3) |
| 7 | Nothing in code; sessions run at most three at a time on the 100 USD plan |
| 9 | A3 uses daily backups and one tried restore; COST_MODEL point-in-time recovery input is 0, status "later, at volume (founder, 14 Nov)" |
| 10 | RESEARCH_REGISTER (a) rewritten from the companies' own pages; questions for each sales contact listed there |

## Founder decisions, 15 November 2026
Recorded by session DOC1 from `docs/strategy/01-verdict-gates.md` ("Founder decisions, 15 November") and the header of
`docs/strategy/05-console-website-design-handoff.md`. Each supersedes any earlier line that disagrees. The stop conditions and the
three gates (A, B, C) are in `docs/strategy/01-verdict-gates.md` and `docs/NEXT_SESSIONS.md`.

| # | Decision | Applied in |
| --- | --- | --- |
| 1 | The hand-off fix (HO1) runs first, ahead of T1. | `docs/NEXT_SESSIONS.md`, `docs/BUILD_PLAN.md` |
| 2 | The repository stays public until the build ends, then private (the last step, PRIV). No paid plans. Secrets only in Cloudflare and Supabase; seed and test data are invented; a check blocks secrets and real phone numbers; exposed webhook secrets are rotated. | PUB1; HANDOFF "Founder actions" |
| 3 | Production stays on the current Cloudflare account ($5 plan); a separate account later. | A3 |
| 4 | The old Supabase project: export what is needed and delete it this week (the grace period ends 24 November). | HANDOFF "Founder actions" |
| 5 | The rider guarantee runs for eight weeks: yes, capped, paid from company money. | RD1; stop condition 3 |
| 6 | Chilled goods stay in the range: a generator subscription, a UPS, a twice-daily temperature log, insulated bags. Frozen waits. | WH1a; gate B |
| 7 | Open, not decided: the capital figure (a line-by-line estimate once supplier costs are in) and the status of the SARL. | `docs/strategy/01-verdict-gates.md` |
| 8 | Added to later parts of the strategy: rider insurance and legal status, hub permits, USD and LBP price display rules, data protection, security of cash at the hub. | Parts still to come |
| 9 | Launch hours are 09:00 to 21:00, with delivery rounds. | `docs/strategy/05-console-website-design-handoff.md` |
| 10 | No paid plans before the paid pilot. | Gate C ("Supabase Pro" and the numbers are bought at gate C, not before) |
| 11 | No React in the console. One look, two renderers: `packages/ui` as HTML functions for the console and Astro components for the website. shadcn/ui, Radix, TanStack Table and Tremor are not adopted; their patterns are copied, not their code. | DS1, UX2 |
| 12 | No Anthropic workspace or key changes: only metering and a dollar cap per run. | COST1; rule 7 in `docs/NEXT_SESSIONS.md` |
| 13 | The staff line during testing (no +961 numbers yet): pickers use the console pick queue; one rider phone is registered on Kapso's sandbox and opens the day with a "start shift" message; a second rider, transfers and batching are tested by database tests and the console's "act for a rider" buttons; alerts to ops go by console and phone push; customers are Rashid and three friends on the US number. The US number is kept through the shadow run too; the +961 lines are bought and registered once, in January, on whichever Meta portfolio is verified. | `docs/strategy/06-session-plan.md` sections 4 and 5; D4b, T1, OPS1 |

### One correction by DOC1 (a number, not a decision)
`docs/strategy/06-session-plan.md` reserves migrations 0153 to 0157 for WH1a, but 0154 and 0155 were shipped by WEB1 and are on
`main` (rule: migrations are append-only, never renumber). WH1a uses 0153, 0156, 0157, 0188 and 0189 in `docs/BUILD_PLAN.md` and
`docs/NEXT_SESSIONS.md`; the strategy file is left as the planning chat wrote it.

## Coordinator decisions, 15 November 2026, 13:30
Recorded by session COST1 at the coordinator's instruction. Docs only: no code, migration or setting changed by this entry. Each supersedes
any earlier line that disagrees; the minimum-order and no-pin decisions may be overruled by the founder.

| # | Decision | Applied in |
| --- | --- | --- |
| 1 | **B1 is split into B1a and B1b**, both Opus, high, one after the other after HO1. **B1a:** report fixes 1, 3, 4, 9 and 10 and the two no-reply turns (sim-009 and sim-014). **B1b:** report fixes 5, 6, 7 and 8. B1b starts when B1a is merged. **CX1 waits for B1b.** Gate A lists both. | `docs/NEXT_SESSIONS.md` (table, gate A, prompts), `docs/BUILD_PLAN.md`, `docs/HANDOFF.md` |
| 2 | **Minimum order: $5. No small-order fee at launch.** The amount and the gap are stated by code, from the quote, never by the model (invariant 7). One rule, never the minimum and the fee together. The founder may overrule the amount. This replaces the 14 November approval of a 0.50 fee on baskets under 10 USD (R4 answer 2; `docs/SYSTEM_PLAN.md`); the fee stays supported as a setting, off. | B1a (report fix 1): `packages/agents/src/basket.ts`; `supabase/seed/proposed_pilot_settings.sql` (no fee) and `supabase/seed/minimum_order_2026_11_15.sql` (applied once per database by `scripts/ci/load-seeds.sh`, so staging gets it on its next deploy) |
| 3 | **A first order without a map pin is accepted** with a typed village and landmark, and **marked for a rider call** (the rider or ops phones the customer before the order goes out). A pin outside the service area is still refused. | B1b (report fix 5); L1 for the places data |
| 4 | **DS1 converts the founder's brief to `docs/DESIGN_BRIEF.md` first**, from its attachment, before any design work. | DS1 prompt; resolves the item "Not done by DOC1" in `docs/HANDOFF.md` once DS1 runs |
