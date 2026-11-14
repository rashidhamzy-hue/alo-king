# Alo King: the system plan (session S1, 14 November 2026)

How Alo King grows from one WhatsApp line and 291 products into a system that keeps taking in products, vendors, villages,
riders and channels without rewrites. It follows `docs/SYSTEM_BRIEF.md` (the founder's brief, unchanged) and never weakens an
invariant in `CLAUDE.md`. Where a founder decision needs an invariant's wording changed, it is in the conflict register in
`docs/DECISIONS.md` and nothing is built on the changed wording until he says yes.

Read with: `docs/AUDIT-G1.md` (what exists, what is broken), `docs/RESEARCH_REGISTER.md` (facts checked), `docs/WEBSITE.md`,
`docs/CONSOLE.md`, `docs/COST_MODEL.md`, `docs/BUILD_PLAN.md` (gap matrix, sessions), `docs/NEXT_SESSIONS.md` (prompts).

Each part says: what exists and is reused, what is new, data model, functions, pages, tests, cost, the governing invariant, the
session, and its class: **A** must work at launch, **B** designed now and switched on after evidence, **C** piloted after a
benchmark, **D** rejected or deferred.

## 1. One commerce core for every channel (A, session C4)

**Exists, reused.** The core already is the SQL: `plan_order`, `plan_cart`, `repeat_plan`, `quote_order`,
`create_order_from_quote`, `confirm_order_checked`, `handle_order_button`, `order_status_for`, `open_delivery_windows`,
`request_delivery_window`, `apply_customer_credit`, `locate_pin`, `save_customer_pin`, `set_place_details`, `catalog_list`,
`product_image_for_customer`, `product_food_facts`, the state machine and the ledger. WhatsApp typed orders and catalog carts
already produce identical quotes (`test/db/catalog-k1.test.ts`).

**What ties it to WhatsApp today.** (1) A customer is known only by a WhatsApp identity (`party_identities`). (2) Confirmation
takes a WhatsApp message id and needs transactional consent on the customer line (`transition_order`: `NO_CONSENT`). (3) The
TypeScript that calls the functions lives inside `packages/agents` and `apps/gateway`. (4) Every caller holds the service key (G1-12).

**New.**
- `packages/commerce/`: a small typed client for the functions above (no logic), used by the gateway's tools, the website and the console.
- `orders.channel` (`whatsapp`, `catalog`, `web`, `console`, later `app`) and `orders.request_key` (the confirm action's idempotency key on any channel).
- **Identity across channels.** A web visitor proves their phone once by sending a code to our WhatsApp number from a
  `wa.me` link ("ALO-7K3Q"). That one message links the web session to the party, opens the 24-hour window, and records
  transactional consent, so invariant 17 holds (we never message someone who has not messaged us) and no SMS or
  authentication template is paid for. Tables: `web_sessions` (hashed token, party, expires, device), `link_codes` (code, session, expires in 10 minutes, used).
- `carts` and `cart_lines` (server-side, per session or party; no stock held). `plan_cart` (0085) turns a cart into quote lines,
  as it does for a WhatsApp catalog cart. Nothing new prices anything.
- A database role `web_channel` that may execute only the listed customer functions; the website Worker connects as it, never
  with the service key. Each function still takes the party from the server-side session.

**Functions.** `web_session_start`, `web_link_code`, `claim_link_code(party, code)` (called by the customer-line turn, by code,
before any model), `cart_set_line`, `cart_view`, `checkout_quote(cart, place, window)` (wraps `plan_cart` and `quote_order`),
`confirm_order_checked` extended to accept a request key in place of a WhatsApp message id.

**Tests.** The same basket through chat, catalog cart and web gives the same lines, totals and ledger; `web_channel` cannot call
any staff or money function (permission script, new section); a confirm sent twice confirms once; a link code is single-use,
expires, and cannot be claimed by a second phone; the agent still cannot confirm.

**Cost.** No new service. One more Worker on the existing Cloudflare plan.
**Invariants.** 3, 4 (wording: register item C1), 7, 12, 17, 19.

## 2. Who delivers: the delivery-provider model (model B now, switched on with restaurants; session E2)

**Exists.** `deliveries.driver_id` (an Alo King rider, always), `delivery_stops`, `dispatch_order`, the cash cap, `settle_rider_earnings`.

**New data.** `delivery_providers` (kind `alo_rider`, `vendor_fleet`, `courier`; `source_id` for a vendor's own drivers; service
hours; villages served; `fee_owner`; `cash_rule`: `collects_for_alo_king`, `collects_for_vendor`, `prepaid_only`; who answers for
a failed delivery). `fulfilments.delivery_provider_id`. `deliveries.provider_id`, with `driver_id` null for a vendor's fleet.

**Rules.**
- `delivery_options(order)` answers, per fulfilment, which providers can deliver now (hours, village). The shop is "open" for an
  order when at least one provider can take each fulfilment: a restaurant open until 4 am with its own drivers keeps taking orders
  after our riders stop at 11 pm. Dark-store goods need our riders or a scheduled window.
- **Vendor fleet:** the vendor gets the job card with the address, taps out-for-delivery and delivered; its driver collects the
  cash; the delivery fee is the vendor's; Alo King's commission becomes `merchant_receivable:<source>` and is settled weekly.
  No rider cash, no cap. Delivered is still not paid: the order closes when the vendor's cash is declared (button) or the
  customer prepaid.
- **Courier:** prepaid orders only at first; the courier's fee is a cost line shown to the customer; tracking number stored.
- The customer always sees who delivers and the fee before confirming.

**Tests.** A vendor-fleet order after our closing time, from card to weekly settlement, ledger at zero, commission booked, no
rider involved; a hub line in the same cart is refused or scheduled; the cash cap is untouched.
**Cost.** None until used. **Invariants.** 5, 10 (wording: register item C2), 11, 12, 13.

## 3. Combined orders: our groceries plus food from vendors (model exists; B, session E3)

**Exists.** `fulfilments` is one row per source; `offer_delivery` already creates one pickup stop per source; `post_cod_collection`
and `confirm_payment` already split money per fulfilment (goods, merchant payable, commission).

**Launch rule.** One source per cart (`settings.cart.max_sources = 1`), enforced in `plan_order` and `plan_cart`. A message that
mixes sources gets two cards, one after the other.

**When switched on (evidence: at least 10% of customers ask for both within one hour, from `demand_signals`).**
- Stops are ordered by code: hub first, each vendor timed to its measured preparation time, hot food last, then the door.
- **Fee:** the zone fee plus `settings.delivery.extra_pickup_usd` for each pickup after the first (proposed 0.50), all of it the
  rider's. The cost model prices it; the customer sees one delivery line.
- **Partial failure:** a vendor that cannot deliver cancels its fulfilment only; the customer is told, refunded or not charged
  for that part (`refund_order`, existing), and the rest goes.
- Grocery comes only from our dark store; no other supermarket is ever a vendor (`sources.kind` check).

**Tests.** A hub-plus-vendor order: one rider, stops in the right order, one fee with the add-on to the rider, each source's
money in its own accounts, the vendor's line cancelled after confirmation and the rest delivered, ledger at zero.
**Invariants.** 10, 11, 12.

## 4. Intake pipelines (A for products, session I1; B for menus and invoices)

One queue per kind of thing. A step proposes, a person or a written rule approves, code executes, and a failure lands on a list.

**Exists, reused.** Search words per item (0076, 0080); picture fetch, vision check and licences (`scripts/images/`, 0050,
0070); Open Food Facts and web-page facts as proposals (0071, 0073); label scan (0049); receiving and cost (0024); review pages
for pictures, facts, search words; `photograph_at_intake()`.

**New: the product pipeline.**
- `product_intake_jobs` (product, step, status, attempts, last error, result) with the eight steps of the brief. A trigger on
  `products` starts it; the 291 existing items are enqueued once, so item 292 and item 1 take the same road.
- The research step runs **through the API from a scheduled GitHub workflow** (`intake.yml`, every 30 minutes, a few items a
  run): one fast-model call with web search per item under the rules of `data/research/README.md`, output in the same file
  shape, loaded by P2's loader unchanged. About 3 to 6 cents an item (COST_MODEL section 4). Claude Code sessions no longer research items.
- `product_readiness(product)` and the console's readiness page (docs/CONSOLE.md): what each item still lacks.
- Names: `product_name_proposals` (the 282 in `data/proposals/names.json` are loaded into it); approving one updates the product
  and re-queues its search words (0076 does that on a name change).

**Automatic approval (founder request, 14 Nov).** One table, `auto_approval_rules`, one row per field, read by one function
`try_auto_approve(proposal)`; every pass is logged in `auto_approvals` with the checks; a daily random tenth is shown for a spot
check; a failed spot check switches that field's rule off (`enabled = false`) until a person turns it back on.

| Field | Automatic only when code can check all of | Never automatic |
| --- | --- | --- |
| Picture | barcode exact match; vision check passes every rule; source is the brand, Open Food Facts or our own photo | any `cannot_tell`; `public_page` pictures from shops |
| Names, size, category | barcode exact match and two independent sources agree | Arabic names written by the model, until a reader has passed a sample of 50 with no error (recorded as a setting) |
| Search words | the 1.23 phrasing tests pass (already automatic) | misses on the review list |
| Ingredients, nutrition | the intake label photo and a second source agree for that barcode | web sources alone |
| Allergens, diet labels | **never** | always one tap, against the real pack |
| Price, cost | **never** | always |

**Menus (B, E1).** Signed vendor only (`approve_merchant`). Photos, PDF or link go through `menu-fetch.ts` to
`merchant_menu_imports`; a new photo produces a difference (new, removed, re-priced) for line-by-line approval; each approved
item gets search words and the vendor's own photo; allergens and diet labels only from the vendor's written statement, stored
with source `vendor_declared`; a staff test order before going live. Menu items must carry options (size, extras, removals) and
a preparation time: `product_options`, `product_option_groups`, `order_item_options`.

**Supplier invoices (B, WH1).** A photo at receiving; a narrow reader proposes supplier, date and lines; each line matches by
barcode, then search words; an unknown line starts the product pipeline; staff confirm quantities and only `receive_goods` moves
stock; a cost move beyond `settings.approvals` goes to the founder; `supplier_price_history` feeds the margin report.

**Tests.** A new product walks all eight steps with the network and model faked; a failed step retries three times then lists;
no auto-approval of an allergen, a diet label or a price under any input; a spot-check failure disables the rule; an invoice
photo never moves stock.
**Invariants.** 3, 14, 15, 21.

## 5. Places: the Shouf's own words (A for the list, session L1)

**Exists.** `landmarks` and `landmark_aliases` (0001, with source and confidence), `customer_places` (pin, building, floor,
the customer's directions, `verified_by_driver`, `delivery_count`), `locate_pin`, `village_in_text`, village centres (0074).

**New.** `place_names` (village, neighbourhood or landmark; spellings in Arabic, Arabizi, English; village; optional pin area;
status proposed or approved; source founder, rider, customer, voice note, map). `landmark_proposals` from deliveries: the pin,
the words the customer gave, the rider's confirmation or door voice note ("30 metres past Abou Adham's butcher", transcribed and
proposed, never applied). The Concierge's address reading gets approved names as context for the pin's village only.

**The pin still decides** the village and the fee (0074). A landmark never moves an order to another zone; it goes on the rider's card.

**Learning from every delivery.** `order_timeline` (one row per step: received, card sent, confirmed, pick start, pick done,
offered, accepted or declined, arrived at hub or vendor, waited, picked up, delivered; with the route distance when known) filled
from `order_events` and stop times; `delivery_time_stats` (village, hour, rider) and `prep_time_stats` (vendor, item) rebuilt
nightly. They propose new ETAs and zone settings on the console; a person applies them (`set_zone`). Rider position is recorded
only between pickup and delivery, at most once a minute, and the rider's terms and the privacy notice say so.

**Tests.** A proposed landmark is invisible to the Concierge until approved; a landmark in another village never changes the
fee; timings rebuild from a known set of events; no position row exists outside a job.
**Invariants.** 7, 13, 16, 18.

## 6. Learning loops and nightly jobs (A for the eval run and the note; session N2)

| Every | Becomes | Exists | New |
| --- | --- | --- | --- |
| Order | alias candidates, eval cases from real phrasings | `learn_from_order`, `alias_candidates_ready` | nightly export of confirmed phrasings as eval candidates |
| Miss or wrong match | review item, eval case before any fix | `search_word_reviews`, `evals/` | "wrong product" button on the console order page that files the case |
| Item not stocked | buying list | `unmet_demand()` | on the daily summary |
| Substitution kept or refused | ranked substitute suggestions | `substitution_offers` | `substitute_stats`, used to order `substitute_candidates` |
| Delivery | ETAs, places | section 5 | section 5 |
| Voice note | corrected transcripts as eval cases | V1 | a correction box on the console chat page |
| Intake photo, invoice | facts, cost | 0049, 0024 | section 4 |
| Complaint, staff correction | a case, and an eval case when the bot was at fault | `complaint_cases` | "bot at fault" tick that files the eval case |

**Nightly (GitHub Actions, 01:00 Beirut):** (1) the whole eval set against the live model and prompt; a drop in F1 or any wrong
product opens an ops exception and a Sentry event before the shop opens; (2) the collectors above; (3) a short "what the system
learned today" note on the console and to the ops line. **Weekly:** the founder's one-page report (section 11).

**Guardrails.** Learning writes proposals only. A change to prompts, search words or planner rules ships only if the whole eval
set passes with zero wrong products (the `language-pack` gate, already in CI for the pack). Food facts are never learned from
customers or the model. Voices and personal data never enter the repository.
**Cost.** About $3 a full live eval run (HANDOFF B4): nightly is about $90 a month. Recommended: the 990-case run weekly and a
150-case smoke set nightly (about $0.45 a night, $14 a month). **Invariants.** 3, 7, 15, 21.

## 7. The warehouse at professional level (B, session WH1; scanning C)

**Exists.** `stock_levels`, `stock_movements` (valued), `receive_goods` with expiry, `adjust_stock`, `count_stock`,
`expiring_stock`, `hold_product`, the picker flow on the ops line, reserved-stock protection.

**New data.** `stock_lots` (product, receipt line, expiry, quantity, bin); `bins` (zone, aisle, shelf); `product_barcodes`
(several per product, pack levels); `pick_scans` (order line, barcode read, by, at, result); `cycle_count_plans`; `reorder_points`.

**Rules.** FEFO: `pick_list` names the bin and the earliest-expiring lot. **Scan to pick:** a five-item order needs five good
scans, or an exception the picker states (no barcode, damaged label) that the ops lead sees the same day; a wrong barcode is
refused before the order can be marked ready. Scanning runs in the console on the phone camera (the browser's barcode
detection where available, a small JavaScript reader otherwise); dedicated scanners only if measured pick time requires them.
Counts: a few bins a day, chosen by value and by recent `missing_at_pick`. Reorder: code proposes from sales rate, lead time and
`unmet_demand`; a person orders. The AI never moves stock.

**Tests.** FEFO picks the earlier lot; a wrong scan blocks ready; an authorised exception is logged with who and why; lots
reconcile to `stock_levels` and to the inventory account; an expired lot cannot be picked.
**Cost.** None (phone cameras). **Invariants.** 3, 7, 15.

## 8. Vendors: notifications and commands by message (B, sessions E1, E2)

**Never miss an order.** The job card is a utility template on the staff line (vendors opt in at signing): order number, items
with options and notes, the rider's arrival time, and three buttons: Accept, Accept in X minutes, Can't make an item.
Escalation by cron: reminder at 2 minutes, ops alerted to phone at 4, and at `settings.vendor.give_up_min` the customer is told
and offered another vendor or a refund. A tapped missing item goes to the customer as substitute or removal before anything is
cooked (the hub's substitution flow, 0032, reused). The rider is dispatched to arrive when the food is ready and the vendor is
told two minutes before. A printable ticket link and a daily statement come from the console's vendor pages.
Measured per vendor: acceptance time, preparation time per item, missed orders; repeated misses pause the vendor automatically
(`sources.is_open = false`, an ops exception says why).

**Commands by message.** "Closed tomorrow", "out of brown bread", "prep time 40 minutes tonight", a new menu photo. A narrow
function on the staff line reads the message into one of a closed list of proposed changes (`vendor_change_proposals`: hours
exception, item availability, prep time, menu import), sends it back with Confirm and Cancel, applies it through the existing
functions on the tap, logs it, and offers Undo for 10 minutes. Availability and prep time apply at once; prices and new dishes
go to ops for approval (BUILD_PLAN 8.5). No agent: it is a function; anything it cannot classify goes to a person.

**Tests.** A missed card escalates on the clock; the vendor's confirm applies exactly the proposed change; a price in a vendor
message never changes a price; undo restores; a vendor cannot change another vendor's items.
**Invariants.** 1, 9, 11, 20, 21.

## 9. Payments now and later (cash and screenshots A; Whish Pay B, session PAY1; cards C)

**Now.** Cash on delivery in USD or LBP; Whish and OMT by screenshot, confirmed by a person. Fix first: late payments (G1-04),
overpayments (G1-05), the COD tolerance (G1-01).

**The shape that lets gateways arrive without touching orders or the ledger.**
- `payment_providers` (code, kind, settings reference) and `payment_intents` (order, provider, amount, currency, status
  `created`, `pending`, `paid`, `failed`, `expired`, `refunded`; the provider's reference, unique per provider; hosted page link; raw event ids).
- One function, `record_gateway_payment(provider, reference, amount, currency, event_id)`: idempotent on the event and the
  reference; it checks the amount against the order and then calls the existing `confirm_payment` path with actor `payment_api`
  (invariant 4 already allows "a payment API"). A new ledger account `processor_fees`, and `gateway_clearing:<provider>`.
- The gateway only reports. A webhook is verified by signature, stored first (like WhatsApp events), then processed. We never see card data: hosted pages only.
- `payment_method` gains `whish_pay` and `card`. Refunds go back through the provider when its API allows, otherwise as customer credit.

**Order of arrival.** Whish Pay (it has a merchant API with a sandbox; see RESEARCH_REGISTER a) once the company has a Whish
merchant account; then one card gateway for buyers abroad (areeba, MontyPay or Tap: whichever approves the SARL in writing).
OMT stays manual until OMT confirms an API. Never assume Stripe.

**Buyer and recipient (send home).** `orders.recipient_name`, `recipient_phone`, `is_gift`; updates go to the buyer; the rider
phones the recipient; we never message a recipient who has not messaged us; the buyer's saved preferences are never applied to the recipient (BUILD_PLAN 9.1).

**Tests.** The same webhook twice pays once; a wrong amount is held for a person; a paid, card gift order with one refunded item
leaves the rider's fee with the rider, the processor fee recorded and the ledger at zero (BUILD_PLAN 9.7).
**Cost.** Processor fees of about 2.5 to 3.5% on card orders only (assumption until a contract). **Invariants.** 3, 4, 12, 18, 19.

## 10. Loyalty and referrals, priced against margin (B after four clean pilot weeks; session LOY1)

Riders keep 100% of fees, so every free delivery is paid by Alo King to the rider. `docs/COST_MODEL.md` section 6 and
`data/cost_model.csv` price each design. Summary at the model's inputs (a grocery order leaves about $2.61 before fixed costs; average fee $1.75):

| Design | Cost | Verdict |
| --- | --- | --- |
| Founder idea: first 3 deliveries free | $5.25 per new customer | Pays back only if the customer places 3 further grocery orders they would not have placed. On vendor orders each free delivery loses money. **Not before the pilot shows 30-day repeat rate** |
| Founder idea: credit after every 30 orders | cheap, and too far away to change behaviour | Replace with the stamp card |
| **Stamp card: every 10th paid order earns one delivery** | $0.175 an order if every reward is used | **Recommended first.** 7% of a grocery order's contribution |
| Referral: one delivery each, after the friend's first paid order | $3.50 per new customer | Second, after the stamp card; the friend must message us first |
| First delivery free on a first grocery basket of $15 or more | $1.75 once | Acceptable as the single acquisition offer |

**Data.** `loyalty_accounts`, `loyalty_events` (earned at close, redeemed at card), a ledger account `loyalty_expense`; the rider
is paid the full fee from it. Counted and redeemed by SQL; the Concierge only reads the count. Referral codes are already
captured (0056). No reward is ever announced by a marketing message (invariant 17): it appears on the order card and the website.
**Tests.** The tenth order's fee is paid to the rider from `loyalty_expense`; a cancelled order earns nothing; a referral pays
only after the friend's first paid order; ledger at zero. **Invariants.** 10, 12, 17.

## 11. Analytics, reports and the founder assistant (daily summary A; assistant B; session AN1)

**Exists.** `day_close_report`, `gross_margin`, `inventory_valuation`, `unmet_demand`, `ai_cost_daily`, `agent_latency`,
`turn_waits`, `message_meter`, `order_feedback`, the nightly founder report at 21:40.

**New views (SQL only).** `daily_summary(day)`: orders by outcome and channel, what customers asked for (including what we do
not sell), best sellers in the dark store and per vendor, substitutions refused, refunds and why, feedback, late deliveries,
errors and exceptions by kind, cost per order, what waits for approval. `weekly_report(week)`: the same over a week plus repeat
rate and rider earnings per hour. One console page each; the daily summary replaces checking.

**The founder assistant.** A chat box in the console for admins. It is the second place a model talks, so it is built as a
**narrow function, not an agent** (invariant 21): a fixed list of read-only tools over the views above (`what_went_wrong(day)`,
`deliveries_at_risk()`, `money(day)`, `stock_alerts()`, `waiting_for_me()`); it cannot write; any change it suggests is a link
to the console form the founder taps himself. Amounts in its answers are placed by code from the tool results, as on the customer line.
**Tests.** The assistant's database role can only select from the report views; a prompt asking it to refund or message
someone produces a link, never an action. **Cost.** A few cents a day on the fast model. **Invariants.** 3, 7, 14, 21 (register item C3).

## 12. The website (A for day one; sessions WEB1, WEB2) and 13. the console (A for the review pages; sessions D4, D5)

Page by page in `docs/WEBSITE.md` and `docs/CONSOLE.md`.

## 14. Message design (A, session M1)

**Exists.** `order-card.ts`, `FIXED` strings, notices in ar, en, fr (0093), the output guard. **New.** One template file per
language (`packages/agents/src/messages/{ar,en,fr}.ts`) holding every fixed message; the model's own replies capped at two short
sentences by the guard; the brief's nine rules checked by a test (`messages.rules.test.ts`): a line break every two or three
lines, only the approved emoji set and at most three, bold only for headings and the total, each price on its own line with
Western digits and `$`, the card always showing every line, fee, total, address and payment. A snapshot file per language is
committed, so a person reads the messages in the pull request. Product names follow the conversation's language; a missing
Arabic name falls back to English and is logged (`name_gaps`). Utility templates for the code-started messages of G1-23 are
submitted in the same session. "How much in lira?" gets a fixed answer from `current_fx()` (founder decision 2).
**Invariants.** 2, 7, 14, 20.

## 15. A smarter Concierge, within the rules (B, session BK1)

**Basket builder.** "We're four and want snacks", "dinner for five children". Code proposes quantities from `portion_rules`
(founder-approved rows: per person, per meal, by category) inside a stated budget; the Concierge asks first about allergies,
diets and budget when it matters; restrictions outrank everything (`product_meets_restrictions`); it explains the basket in two
lines; the customer edits and confirms the normal card. "Healthy" is answered with neutral choices by measurable facts (fruit,
nuts, items lower in sugar by approved nutrition data), never the word. Every such request becomes an eval case.
**Invariants.** 7, 14, 15, 16, 21.

## 16. The friends' test (A before any real customer; session T1)

Simulated by founder decision: no goods or cash move. `parties.is_tester` (three numbers); testers' orders run on staging with
the test rider; a tester in Beirut or Dubai orders to a Shouf address or a marked test address, and a Beirut address gets the
polite "not yet"; a 15-scenario script (`docs/TEST_SCRIPT.md`); after each order the tester's reply lands as a console case; the
first message carries a short privacy notice; the Anthropic and Kapso caps are checked first; payments are cash plus a Whish or
OMT screenshot to exercise the reader. Adding a real picker on staging needs the probe to pick first (HANDOFF C2).

## 17. Expansion through markets (B, before the second area; session MK1)

**Exists.** `markets`, `market_settings`, `setting_for` (schema only); villages, zones, hubs and fees are data (invariant 13).
**New, before a second area and not before launch:** every function that reads `setting('x')` for hours, fees, cash caps,
scheduling and picking reads `setting_for(market, 'x')`; `villages.market_id`, `sources.market_id`; nearest-hub lookup for the
dark-store fulfilment; one WhatsApp customer number per market or one with the market taken from the pin. Test: two markets
with different fees and hours quote correctly side by side. Trigger: Chouf holds 60 orders a day for a month (BUILD_PLAN "Later").

## 18. Repo hygiene (A, session H1, after every wave)

One short pull request: delete merged branches, dead code, unused scripts and workflows, `TEST_REPORT.txt`; move finished HANDOFF
Status sections to `docs/history/`; delete `data/research/*.json` and `data/proposals/*` once loaded and approved (the database
is the record); check file sizes and Actions minutes; update dependencies with the lockfile; CI and the secret scan stay green.
Never in the repository: secrets, customer data, voice notes, receipts, invoices, photos of people.

## 19. Platform rules (A; checked list in RESEARCH_REGISTER e and "Not checked")

What the build must keep: opt-in before any business-started message (the customer's first message is the opt-in); the 24-hour
window (`can_send`); utility templates only for the customer's own order, never promotion; the Concierge stays on ordering and
delivery (1.18); a human is always reachable (handoff); catalog items within Meta's commerce policy; quality rating watched
daily (`kapsoHealth`); webhook signatures verified; Kapso retention set to match ours; Open Food Facts credited where its data
or pictures appear; picture sources kept and withdrawable; robots rules and rate limits respected by the intake fetch;
spending caps on Anthropic and Kapso; Supabase usage checked weekly (A5) and point-in-time recovery on before real money (A3).

## 20. The customer record and retention (A before the pilot; session A3 with the lawyer's answers)

**Exists.** `parties`, `customer_places`, `customer_memory` with origin stated or observed, memory commands, `order_feedback`,
restrictions stated and never inferred. **New.** `customer_profile(party)` for the console (one page: places with pins and
landmarks, history, stated preferences and restrictions, language, feedback, credit); the retention job (proposal 7 in
DECISIONS: voice notes and photos 90 days unless tied to a payment or complaint, chat text 12 months, financial records as the
law requires), run nightly once the founder and the lawyer approve; the Kapso project's retention set to match.
**Invariants.** 15, 16.

---

## Founder list (only what the founder alone can give)

### Decisions
| # | Decision | Recommended answer | Blocks |
| --- | --- | --- | --- |
| 1 | Conflict register items C1 to C6 in `docs/DECISIONS.md` (wording of invariants 4, 10 and 21; website now; one cart one vendor; pictures) | Yes to each as worded there | C4, E2, AN1, WEB1 |
| 2 | Speech provider and the retention wording | Decide after V1 scores the 51 notes; until then say in the privacy notice that transcription is done by a processor that may keep transcripts | V1, privacy notice |
| 3 | `supabase/seed/proposed_pilot_settings.sql` (25 villages; small-order fee 0.50 under $10) | Yes: the cost model shows the fee is worth about $0.20 an order | Pilot |
| 4 | COD tolerance: how much a rider may be short on one order before it is his to explain | $0.25 (lira-note rounding), the rest to the rider's account for review | F1 |
| 5 | SMTP sender for staff sign-in emails | Resend, on the company domain (about $0 at this volume) | Staff accounts |
| 6 | Loyalty at launch | None at launch; the stamp card after four clean pilot weeks | LOY1 |
| 7 | Combined-order extra pickup fee | $0.50 per extra pickup, to the rider | E3 |
| 8 | The 200 USD Claude plan for the build month | Yes for one month: waves of three sessions otherwise queue behind the usage limit | Session pace |
| 9 | Second approval when there is one ops lead: who approves Rashid's own refunds and price changes | Hussein, from his phone, on the installed console | D5 |

### Information and actions
1. Approve the 282 Arabic names (on the names review page once D4 merges; about an hour).
2. Meta: confirm the WhatsApp account sits in Alo King's own business portfolio; start verification when the SARL papers exist.
3. The two +961 numbers.
4. WhatsApp catalog steps A to C in `docs/RUNBOOK.md`, and the feed password as the repository secret `CATALOG_FEED_PASSWORD`.
5. Upload the 51 voice notes (`docs/RUNBOOK.md`, "Voice notes for the evaluation").
6. Kapso credits topped up; the Anthropic cap lowered after 17 November.
7. Delivery windows, their capacity and cut-offs; Ramadan, Lent and holiday dates for 2027 (on the windows page once D4 merges).
8. Apply in writing to Whish (merchant account and Whish Pay) and to areeba, MontyPay and Tap (card gateway): ask each for
   onboarding requirements for a new SARL, settlement currency and account, fees, refunds by API, and a sandbox.
9. Hub location, opening stock, suppliers and costs, riders and their terms (Phase 5, unchanged).
10. The three testers' numbers, and portion rules for the basket builder (bread, water, snacks per person).
11. Retest the demo order from his phone, including an order after closing time.

### Questions for the lawyer
1. Data protection (Law 81 of 2018): the privacy notice's required content; whether voice notes and location pins need explicit
   consent; lawful retention periods for chat, voice, receipts and financial records; transfers to processors abroad (Supabase in
   Germany, Anthropic, Kapso, ElevenLabs, Cloudflare); whether a transcription processor keeping transcripts for up to three years is acceptable.
2. Rider location recorded during a job, and rider door voice notes: consent wording in the rider terms.
3. Riders: status (independent or employee), insurance, and whether a cash shortfall or a damaged note may be charged to a rider (G1-10).
4. Consumer law: must prices be displayed in LBP as well as USD; refund and cancellation rights for groceries and cooked food;
   gift orders refunded less the delivery fee; wording for allergen and halal statements and our liability when a vendor's declaration is wrong.
5. Product pictures taken from public pages (founder decision of 14 November): the exposure, and the withdrawal procedure.
6. Vendor agreements: commission, who bears a cooked and undelivered order, vendor-operated delivery and who answers to the customer.
7. Loyalty credit and customer credit as liabilities: any licensing issue (stored value) under Banque du Liban rules.

### Questions for the accountant
1. VAT: registration threshold and timing for the SARL; VAT on groceries by category; on the commission; on the small-order fee.
2. The rider's delivery fee and tips, collected on the rider's behalf: confirm they are not company revenue and not subject to
   company VAT; the document that must exist to support it.
3. Invoicing: must each order carry a tax invoice or receipt, in which language and currency, with which numbering; is a
   WhatsApp message or a web page an acceptable receipt.
4. Books in USD with LBP cash: the exchange-rate source to use, and how to treat `cash_over_short` and FX differences.
5. Vendor settlements when the vendor's own driver collects the cash (commission receivable), and weekly statements.
6. Card processor fees, refunds and chargebacks; customer credit and loyalty liabilities on the balance sheet.
7. Stock: moving average cost, write-offs for waste and expiry, and the opening stock valuation.
