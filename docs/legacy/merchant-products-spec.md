# Merchant products: broadcast packs, recommendations, sponsored slots (design only)

Status: **design, no code, nothing deployed, nothing priced for real customers.** Written 5 Oct 2026 against `main`. Background reading in `docs/research/` is not source of truth; where it disagrees with the code or Meta's own documentation, those win.

How to read the markers:
- **[V]** verified against a primary source (Meta's documentation as mirrored in the Kapso `whatsapp` docs corpus, or our own database / code at the date above).
- **[M]** measured by us (cost and latency logs).
- **[A#]** an assumption that must be checked before money moves; every one is listed in the register in section 8, with who must check it (**Lawyer**, **Meta**, **Owner**, **Data**).

Hard rules from `CLAUDE.md` apply to everything below: consent-based marketing only, server-side pricing, dual-currency display (USD and LBP at 89,500), no secrets in chat or logs, schema only through new migration files.

## 0. What the evidence says today (read this first)

| Fact | Value | Source |
|---|---|---|
| Customers in the database | 154, of which **151 are test phones** (`961700000…`); 3 real customers, 4 real orders | [M] SQL, 5 Oct |
| Customers ever opted in to offers | **1** (and 1 explicit opt-out). `marketing_opt_in` defaults to false, so "153 not opted in" is not 153 refusals | [M] SQL |
| Broadcasts ever sent | **0**; vendors with a linked owner WhatsApp: **0** of 816 | [M] SQL |
| Average order | $13.69 (28 orders, mostly test) | [M] SQL |
| Our AI cost per confirmed order | $0.064 average over 7 attributed orders (staging-heavy); $0.006 on server-resolved numbered orders in the latest capped run | [M] `ai_cost_per_order`, latency run |
| Number messaging tier | `TIER_250`, quality `GREEN` (Kapso, 5 Oct) | [M] Kapso `whatsapp_numbers` |
| Templates | 2 usable marketing templates (`alo_offer_ar`, `alo_offer_en_optout`; a third English one is superseded), all **PENDING** review; authentication template cannot be created (WABA permission) | `docs/whatsapp-templates.md` |
| Current broadcast price charged to merchants | `BROADCAST_COST_PER_MSG_USD` default **$0.05**, and every vendor row defaults to **$10.00 free credit** | code + migration |

Consequence: **there is no real audience and no real conversion data yet.** Every product below is designed to be *proved with a small pilot before it is sold*, and the launch order (section 7) is driven by what each product costs us to run per unit, not by revenue hopes.

### Meta pricing: what is verified and what is not

*Update, 6 Oct 2026:* `docs/research/Meta Whatsapp USD rate card.md` (Meta's pricing page text, rates effective 1 Jul 2026) is now in the repo. It confirms the model below and the free entry point rules, but it contains **no Lebanon USD figure** (the CSV is not part of the page), so assumption A1 is still open. It also still says non-template messages and in-window utility templates are free, while Meta's announcement page says they are charged from 1 Oct 2026; Kapso's own message log showed in-window messages still `billable: false` on 5 Oct (`docs/message-audit.md`). The billing log (`docs/billing-log.md`) now records Meta's flag per message, so the real answer will be measured; this spec therefore prices **both** readings.

Verified [V] (Meta's pricing pages, mirrored in the Kapso docs corpus, current as of the scrape dated 11 Aug 2026):
- Billing is **per delivered message**. Template messages are billed by category (marketing, utility, authentication) and by the recipient's country calling code. Marketing has **no volume tiers**; utility and authentication have.
- **Marketing templates are charged even inside an open 24-hour customer-service window.** Messages inside a 72-hour free-entry-point window (Click-to-WhatsApp ad or Facebook CTA) are free.
- **From 1 Oct 2026 Meta charges for service messages** (non-template replies inside the 24-hour window) **and** for utility templates sent inside the window, at the market's utility/authentication rate, with no volume tiers for service messages. "Only one charge applies per message": a non-template message with promotional content is charged as a service message, **not** additionally as marketing. This changes our own cost per order (section 1.3).
- Lebanon is in the **"Rest of Middle East"** region (BH, IQ, JO, KW, LB, OM, YE). Meta moves markets out of "Rest Of" regions on rate-card dates (1 Oct 2026: Iraq, Kuwait, Oman among those announced); the rate card can change on 1 Jan / 1 Apr / 1 Jul / 1 Oct with one month's notice.
- Per-user marketing limits exist: a user who has received too many marketing templates is not delivered more (error **131049**, not billed); retrying within 24 h can suspend delivery for up to 24 h.
- Template pacing, quality rating and messaging tiers apply (our number is `TIER_250`).

**Not verified [A1]**: the actual USD rate for Lebanon. Meta publishes it only as a CSV/PDF rate card (and an interactive page); the network proxy of this session blocks `developers.facebook.com` and `business.whatsapp.com`, and the docs mirror carries the links but not the figures. The numbers used below, **marketing about $0.0421 and utility about $0.0112 per delivered message**, come from our own research report (`docs/research/WhatsApp Business Platform Lebanon Guide.md`, which cites secondary summaries and quotes ranges $0.0421-$0.0471 and $0.0112-$0.0121) and are used only as planning inputs. **Before any price is published, someone must download the USD rate card CSV from Meta's pricing page (or read it in WhatsApp Manager > Billing) and replace the inputs in the table in section 1.2.** The same report's claim of "1,000 free service messages per month" **does not appear** in the Meta pages I could read and conflicts with them; treat it as false until Meta confirms [A2].

Also unknown: **Kapso's own fee** for sending (platform/message markup) [A3, Owner]. Not included in any cost below.

## 1. Broadcast packs

A broadcast pack is prepaid credit a merchant spends to send **one approved marketing template** to **opted-in customers who already ordered from that merchant**. Today this exists as `draft_broadcast` / `confirm_broadcast` in the owner bot with a `broadcast_credits_usd` balance, `reserve_broadcast_credits` / `refund_broadcast_credits`, and `broadcasts` rows; this section prices it and fixes its economics.

### 1.1 Unit cost to us, per delivered message

| Component | Value | Basis |
|---|---|---|
| Meta marketing message | **$0.0421** (range $0.0421-$0.0471; code default charges $0.05) | [A1] |
| Kapso fee | unknown | [A3] |
| Payment collection (Whish/OMT/cash top-up) | $0.30 flat per top-up | [A4] taken from the research report's per-order processing line; real rail fees to be confirmed |
| Owner-bot AI to draft and confirm a campaign | about $0.05-$0.07 per campaign (one short owner conversation) | [M] analogue: $0.064 per order; [A5] |
| Ops/support allowance | $0.10 per 100 delivered messages | [A5] |
| **Bot replies after a customer answers the broadcast** | see 1.2b: $0.0006-$0.023 per delivered message depending on reply rate and on whether service messages are billed | [A21-A24] |
| Undelivered messages (blocked by per-user limit, no WhatsApp, template not approved) | **not billed by Meta**, and our code credits the merchant back | [V] / code |

Because Meta bills only on delivery and we credit back non-delivery, **price per delivered message** is the right unit, and the merchant pays only for delivered messages.

### 1.2 Margin and minimum viable price

Margin = revenue - Meta marketing cost - bot-reply cost (1.2b) - $0.30 payment - $0.10 per 100 messages. Columns: **A** no reply cost (the first draft of this spec); **C** replies at a 10% rate with service messages billed at the utility rate (the reading in Meta's announcement; the planning case until pilot data exists), 50% of repliers order; **D** stress: 20% reply rate, service billed. (A reading where service messages stay free costs only the AI: about $0.003 per delivered message at a 10% reply rate, so margins sit between A and C.)

**Prices after including the reply cost** (the first draft's $0.08 / $0.075 / $0.07 left too little in C):

| Pack (delivered msgs) | Price/msg | Price | LBP at 89,500 | Margin A, Meta $0.0421 / $0.0471 | **C**, Meta $0.0421 / $0.0471 | D, Meta $0.0421 / $0.0471 |
|---|---|---|---|---|---|---|
| Starter 100 | **$0.085** | **$8.50** | 760,750 | $3.89 (46%) / $3.39 (40%) | **$2.75 (32%) / $2.25 (26%)** | $1.61 (19%) / $1.11 (13%) |
| Growth 300 | **$0.080** | **$24.00** | 2,148,000 | $10.77 (45%) / $9.27 (39%) | **$7.35 (31%) / $5.85 (24%)** | $3.93 (16%) / $2.43 (10%) |
| Pro 1,000 | **$0.075** | **$75.00** | 6,712,500 | $31.60 (42%) / $26.60 (35%) | **$20.20 (27%) / $15.20 (20%)** | $8.80 (12%) / $3.80 (5%) |
| *Previous Starter, 100* | *$0.080* | *$8.00* | *716,000* | *$3.39 (42%) / $2.89 (36%)* | *$2.25 (28%) / $1.75 (22%)* | *$1.11 (14%) / $0.61 (8%)* |

- **Break-even price per delivered message** (zero margin, 100-message pack, after the $0.30 and $0.10 allowances): A $0.046 / $0.051; **C $0.058 / $0.063**; D $0.069 / $0.074 (Meta $0.0421 / $0.0471). Large packs sit about $0.002-$0.003 lower. At today's $0.05 the product loses money in C.
- **Minimum viable price: $0.075 per delivered message for the Pro pack, never below $0.07** (positive in the stress case D at both Meta rates for packs of 300 or more; 20% margin in C at Meta $0.0471). **Minimum viable pack: 50 messages for $4.50** ($0.09 each: 32% margin in C at Meta $0.0421, 26% at $0.0471); below that the $0.30 payment cost dominates.
- **Finding for the owner (touches pricing, so reported rather than changed):** the current $0.05 default charge loses money once the bot's reply cost is counted, and on 100-message packs if the real Meta rate is above about $0.046. Every vendor row also carries **$10 of free credit by default**: 200 messages x $0.0421 = $8.42 of Meta cost per vendor, plus replies, if used. Across 816 vendors that is a theoretical $6.9k+ exposure, bounded in practice by opt-in audience size and the `TIER_250` daily limit, but it should not be left at the default. Recommendation: default credit **$0**; one free trial send of at most 25 messages, gated on the vendor being claimed and linked.
- Prices are USD-based and shown in LBP at 89,500 on every merchant-facing screen and receipt; a pack is paid in USD or LBP at that rate. The existing broadcast preview shows USD only (`usd(cost)`): a known gap to fix before packs are sold.

### 1.2b Cost of the bot's replies after a customer answers a broadcast

A broadcast is one marketing template (charged at the marketing rate). If the customer **replies**, a 24-hour customer-service window opens and everything the bot says back is a non-template message. Inside the window those are free on Meta's July page but **billed as service messages from 1 Oct 2026 per Meta's announcement** (utility rate, no volume tiers); marketing sent inside a window still counts as marketing. So the replies are real marginal cost, on top of the AI cost of understanding and answering them.

Inputs (all assumptions, to be replaced by the billing log and `ai_call_log` once a pilot has run):

| Input | Value | Basis |
|---|---|---|
| Service/utility message rate | $0.0112 (or $0 if still free) | A1 / A2 |
| Outgoing messages in a reply that does not order | 4 | `docs/message-audit.md`: about 1.6 per free-text turn over 2-3 turns [A22] |
| Outgoing messages in a reply that ends in a delivered order | 11 today (7-8 after the M2 changes) | measured, `docs/message-audit.md` (10 to delivered plus one before the order) |
| AI cost per reply conversation | $0.02 browsing only, $0.04 ordering | `ai_cost_per_order` ($0.006 for server-resolved numbered orders, $0.064 average over 7 staging-heavy orders) [A23] |
| Reply rate (customers who answer a delivered broadcast) | 2% / 5% / 10% / 20% | **no data; scenarios** [A21] |
| Share of repliers who order | 30% / 50% | **no data; scenarios** [A24] |

Cost per replier: browsing only $0.065 (4 x $0.0112 + $0.02); ordering $0.163 (11 x $0.0112 + $0.04); with 50% ordering the average replier costs **$0.114** (30%: $0.094). If service messages stay free the average replier costs $0.03 (AI only).

**Reply cost per delivered broadcast message** (reply rate x average replier cost):

| Reply rate | Service messages free (AI only), 50% order | Service billed, 30% order | Service billed, 50% order |
|---|---|---|---|
| 2% | $0.0006 | $0.0019 | $0.0023 |
| 5% | $0.0015 | $0.0047 | $0.0057 |
| 10% | $0.0030 | $0.0094 | **$0.0114** |
| 20% | $0.0060 | $0.0189 | $0.0228 |

Reading it: at a realistic 5-10% reply rate the replies add **$0.006-$0.011 per delivered message** (14-27% on top of the $0.0421 marketing charge); at 20% they add $0.023 (54%). Replies that become orders are the point of the product, so this is a cost of success, but it is paid by us unless the price covers it (it now does, column C). With the order path cut from 11 to 8 messages (M2) the billed case falls by about $0.0017 per delivered message at a 10% reply rate and 50% ordering. Above a 20% reply rate the price should be revisited with real data.

### 1.3 What the merchant has to believe (to check, not assume)

At an average order of $13.69 and an assumed 35% food-and-packaging cost, a merchant keeps roughly $8.90 per order (**[A6]: the 35% is a placeholder; ask three pilot merchants**). A Starter pack ($8.50 for 100 messages) therefore pays back at **about 1 incremental order** per 100 messages (0.96), about 1% incremental conversion. Whether broadcasts reach that depends on opt-in size, offer quality and response rates, none of which we have measured. This is the number the pilot (section 7) must establish; it is a hypothesis, not a promise, and **no response-rate figure may appear in merchant-facing copy until we have our own data.**

Our own message costs also change on 1 Oct 2026 (service messages are now billed, section 0). An order exchanges 10 outbound messages to "delivered" today (measured, `docs/message-audit.md`; 7 after the M2 changes) at the utility/service rate of about $0.0112: about $0.08-$0.11 per order, plus $0.006-$0.064 of AI, roughly 1% of the average order. `message_cost_per_order` (M3) now reports it per order from Meta's own flags; set no per-order fee before it has data.

### 1.4 Constraints that cap the product

- **`TIER_250`**: the number may start conversations with about 250 unique users per 24 hours across *all* merchants [M]. Marketing broadcasts and out-of-window utility templates share it. A queue and a per-merchant daily allocation are needed, and a tier upgrade depends on Meta's quality/volume rules **[A8, Meta]**.
- **Quality rating**: opt-outs, blocks and low engagement can move the number from GREEN to YELLOW/RED and cut limits for everyone. A broadcast product can damage the ordering product; hence the kill-gates in section 7.
- **Per-user limits (131049)**: a customer cannot be marketed to by every merchant; section 5 sets our own caps well below Meta's.
- **Template approval**: all three marketing templates are PENDING. Merchants never write a template; they fill the single variable (`{{1}}`) of a pre-approved one (section 4).

**Known gap to fix:** the existing broadcast preview and low-credit messages show `usd(cost)` only (USD, no LBP); merchant-facing amounts need both currencies like every customer-facing amount.

## 2. Smart recommendations (organic, free, never for sale)

Goal: when a customer asks for food or "what's good", the bot returns a short list ordered by relevance to *that customer, now*. Ranking is computed on the server from data we already hold, with **no model call on the default path** (matches `searchfirst.ts`, which already tiers by relevance, then nearest, then popular).

### 2.1 Ranking signals, in priority order

1. **Hard filters (never traded off):** vendor open now (Asia/Beirut hours; `vendor_is_open`, `null` counts as closed), dish available, within the delivery area of the customer's last shared location or village, and diet/allergen constraints stated by the customer (section 3.5).
2. **Relevance to the request:** text/mood match score (already in `resolve.ts` / `searchfirst.ts`); a result that does not match the request is not shown to fill a slot.
3. **Distance:** nearest first within a relevance tier (km from the last shared location; unknown distance sorts last).
4. **Customer preference:** vendors and dishes the customer has ordered before (reorder boost); cuisine/mood tags they chose; language. First-party order history only.
5. **Time of day (Asia/Beirut):** simple windows (breakfast 06-11, lunch 11-16, dinner 17-23, late night otherwise) mapping to mood terms already in the lexicon; a soft boost only.
6. **Popularity and quality:** order count in the last 30 days (`is_popular`), cancellation rate, on-time rate, once we have them.
7. **Cold-start fairness:** new or small vendors get a small deterministic exposure floor (for example, a rotating slot in 1 of every 4 lists) so that popularity does not freeze the market. This is a fixed rule, not for sale.

Weights are configuration, versioned, and logged with every impression (`ranker_version`), so a change can be evaluated against the previous version.

### 2.2 No pay-to-win: how it is enforced

- The organic ranker **has no input that depends on payment, credits, broadcast purchases or sponsorship.** A test asserts that the function's parameter type has no such field, and that permuting merchants' balances/sponsorship flags leaves the organic order unchanged.
- Buying a broadcast pack or a sponsored slot changes nothing in the organic list. A merchant who pays nothing can be first.
- The organic list is generated and logged **before** any sponsored slot is considered (section 3), so the logs can prove the organic order was not altered.
- Customer-visible explanation line when asked ("why this?"): "Open now, close to you, and you ordered here before" (built from the signals actually used, never invented).

### 2.3 Privacy limits

- Preference uses only orders and explicit choices in our own database. **No inference of health, religion or other sensitive traits** from orders (for example, do not infer halal or diabetic status from purchases); diet/allergy constraints are used only when the customer states them in the current conversation **[A9, Lawyer]** (Law 81/2018 purpose limitation).
- A customer's "delete my data" removes their preference signals along with everything else (the existing wipe already clears the customer row).

## 3. Sponsored placement: separately labelled, capped, never in health answers

A merchant can pay to appear in **one clearly labelled slot** next to organic results. It is advertising, shown as advertising.

### 3.1 Where it may appear

- Only in a **search or recommendation list that the customer asked for** (search-first results, "what's good", mood searches).
- **Not** in: allergy or diet answers, complaint or handoff flows, order status, checkout, basket, confirmation, or any message that confirms or changes an order.

### 3.2 Hard caps

| Rule | Value |
|---|---|
| Sponsored slots per list | **at most 1** (WhatsApp lists allow 10 rows in total, so at least 9 are organic) |
| Position | always **after** the organic rows, in its own list section; never first, never interleaved |
| Per customer per day | at most **3** sponsored impressions; the same merchant at most **once per customer per day** |
| Eligibility | merchant open now, item available, inside the delivery area, and **matching the customer's request** above a relevance floor; if nothing qualifies the slot stays **empty** (no filler, no weaker match) |
| Share of lists | sponsored shown in at most **30%** of eligible lists platform-wide; a **10% holdout** never sees a sponsored slot (needed to measure harm, section 6) |
| Price effect on organic order | **none** |

The slot is a single list row inside a section titled with the disclosure label; Meta limits (10 rows total, 24-character section and row titles) are enforced by `meta-limits.ts` and every builder is added to `meta-limits.test.ts`.

### 3.3 Disclosure wording (drafts; native-speaker and legal review required, [A10, Lawyer])

Section title (24-character limit):
- English: `Sponsored` 
- Arabic: `إعلان ممول`

List footer (Meta caps list footers at 60 characters and row descriptions at 72; the clamp in `meta-limits.ts` would otherwise cut the disclosure):
- English: `Sponsored: paid placement, does not affect ranking` (51)
- Arabic: `إعلان ممول: مدفوع ولا يؤثر على الترتيب` (about 38)

The full sentence ("the restaurant paid to appear here; it does not change the order of the results above" / `دفع المطعم ليظهر هنا، وهذا لا يغيّر ترتيب النتائج أعلاه`) is given when the customer asks why they see it. The footer builder is added to `meta-limits.test.ts`.

When a customer taps a sponsored row and asks "why am I seeing this", the bot answers with the same sentence plus how to turn it off ("Reply NO ADS to stop sponsored suggestions" / `بدون إعلانات`); a customer who says it is excluded from sponsored slots from then on (one boolean on the customer row, honoured immediately).

Lebanon has no codified paid-ranking disclosure rule that I could verify (the research report says the Levant is uneven; the EU P2B Regulation and FTC guidance are the usual benchmarks). Plain, adjacent, same-script labelling is the conservative design **[A10, Lawyer]**. Meta's own Commerce Policy and Business Messaging Policy on promotional content in service messages must also be checked **[A11, Meta]**.

### 3.4 What a merchant buys

Not an auction at launch. A fixed, published price list, bought and renewed by the merchant on WhatsApp or the dashboard:

- **Weekly slot**: one merchant per village and per meal period (breakfast, lunch, dinner, late) may hold the sponsored slot for matching lists. Price to be set from the pilot; the first pilot is **free for 2 weeks** to measure, because we have no impression data.
- **Per-order variant to test later:** a pay-per-attributed-order fee with a floor. Not at launch (attribution is weak, section 6).
- Minimum price rule: slot price covers our cost to serve (near zero) plus a margin; there is no cost data to anchor it yet, so the price is set only after the pilot shows impressions and orders.

### 3.5 Never in allergy or diet answers

**Fail closed.** A sponsored slot is shown **only** when the request matched a positive allow-list (a mood from the lexicon, a plain dish or cuisine word, or "what's good") **and** none of the conditions below holds. "The guard did not match" is not enough, because the guard has gaps. A sponsored slot is **suppressed** whenever any of these is true:
- The request contains diet, allergen or negation terms (the same `GUARD` list in `searchfirst.ts`: vegan, vegetarian, halal, gluten, nut, sesame, lactose, diabetic, "without", "no ...", "safe", "ingredients" and their Arabic and Arabizi forms).
- The search was called with `p_vegan`, `p_gluten_free`, `p_keto`, `exclude_allergens` or any other diet/allergen parameter, or the answer cites `allergens` / `allergen_list` / `allergens_reviewed` fields.
- The customer has stated an allergy or diet earlier in the session.
- The turn is routed to the model's allergen rules, a complaint, or a handoff.

**Precondition:** `GUARD` in `searchfirst.ts` today lacks terms such as keto, egg, soy, fish, shellfish, milk, wheat, pregnant and intolerant, and differs from the wider list in `router.ts`; both are merged into one shared list (with tests) before any sponsored slot ships. A property test asserts that no list built from a filtered search ever contains a sponsored row, and a second asserts the guard is a superset of the diet words used by the search path. Safety wins over revenue: **an unlabelled or wrongly placed sponsored row in a diet answer is a stop-ship defect.**

## 4. How merchants buy and manage it, with no human selling

Both channels use the same server-side services; the WhatsApp owner bot ("Alo King Business") and the dashboard (`src/routes/merchant.*`) are two front ends.

### 4.1 Flow

1. **Link and verify** (already built): claim the business, link the owner's WhatsApp with an `ALO-` code, and only then can anything be bought.
2. **See the price list** (fixed, USD and LBP): packs (section 1.2), sponsored slots (section 3.4). No negotiation, no quotes.
3. **Buy**: the owner taps a pack; the bot sends an itemised confirmation (what, price in USD and LBP, what is not covered) with an explicit **Confirm and pay** button (affirmative action, Law 81/2018 checkout principle, **[A12, Lawyer]**), then payment instructions for the chosen rail. Rails (Whish, OMT, card, cash agent) are an open decision in the legal blueprint; at launch use one rail with a **webhook-confirmed** payment, never a screenshot check by a person.
4. **Credit is added only by the payment confirmation**, through a ledger (section 4.2); never by a chat message.
5. **Create a campaign**: the owner writes or speaks the offer; the bot (server-side, not trusting the model for prices or totals) validates it (below), shows the exact message, the audience size (aggregate only), the cost in USD and LBP, and **Send / Cancel**. Nothing is sent without that tap.
6. **Manage**: balance, past campaigns with aggregate results, pause/cancel a scheduled campaign, buy again, turn off sponsored slots. Refunds for undelivered messages are automatic credits.

### 4.2 What has to exist (spec only, no schema applied)

- A **credit ledger** (append-only rows: vendor, amount, reason, reference, idempotency key) replacing the single mutable `broadcast_credits_usd` number, so every purchase, spend and refund is auditable and a retried payment webhook cannot double-credit. Done in a new migration with RLS on and no anon grants.
- A **price list table** (pack/slot, USD price, active) read by the server; the client never supplies a price.
- A **moderation step** for campaign text before it reaches a template variable: length limit, no links to unknown domains, no categories Meta prohibits (alcohol, tobacco, unverified medical claims, prize promotions), no prices that do not match the vendor's menu, an injection check (the text is data, never instructions). Failures go to a small review queue handled by support staff; that queue exists to protect the number, not to sell.
- **Rate limits** per vendor (campaigns per day) and a **spend cap** per vendor per month, to contain a compromised owner phone.
- **Terms** accepted in-flow once (version recorded), covering: audience is only customers who ordered from you, you receive no phone numbers, opt-outs are honoured, we may refuse content.

### 4.3 What stays human

Support for failed payments and flagged content only. No sales calls, no custom quotes. If a merchant cannot self-serve, that is a product bug to fix, not a reason to add a salesperson.

## 5. Consent and opt-out for any customer who receives a merchant message

The current state [V, code]: one generic opt-in prompt after an order ("Want first dibs on offers from Shouf restaurants near you?", button `OPTIN|1`), recorded as `marketing_opt_in`, `opted_in_at`; STOP / "Stop offers" / `إيقاف العروض` or the quick reply sets `marketing_opt_in = false` immediately; consent is re-checked at send time. The audience function `broadcast_audience` includes customers who ordered from the merchant **or** who live in a target village.

Proposed rules (every one needing **[A13, Lawyer / Meta]** review for Lebanon and Meta's opt-in policy):

1. **Opt-in is explicit, separate from ordering, and names the sender.** Wording must say that restaurants the customer ordered from may send offers through Alo King, how often, and how to stop. The current generic wording ("offers from Shouf restaurants near you") is broader than a single merchant's blast and should be tightened.
2. **Audience for a merchant broadcast = opted-in customers who have ordered from that merchant.** Drop the village-only path at launch: a customer who never ordered from a restaurant has not given that restaurant's offers a basis. A platform-level "Alo King offers" curated by us (not sold per merchant) can serve the village case later.
3. **Frequency caps, stricter than Meta's:** at most **1 merchant message per customer per 7 days** and **2 per 30 days across all merchants**, quiet hours **22:00-08:00 Asia/Beirut**, enforced server-side at send time, not by the merchant.
4. **Every message carries an opt-out:** a quick reply (`Stop offers` / `إيقاف العروض`) plus the line "reply STOP". Add a second quick reply, **"Mute this restaurant"**, scoped to that merchant; STOP remains global.
5. **Opt-out is honoured immediately:** STOP ends all marketing templates at once (sponsored suggestions in lists have their own switch, `NO ADS`); an opted-out number is never messaged for marketing and never counted in an audience size shown to a merchant. Opt-out events are stored with timestamps and survive a data wipe as a suppression flag (without personal data) so a re-import cannot re-add the number **[A14, Lawyer: what may be retained after deletion]**.
6. **Merchants never see phone numbers** of recipients; they see aggregate counts (and, for small groups, nothing: report only when the group has at least 5 people). Replies to a broadcast open our 24-hour service window with the bot, not a private channel to the merchant.
7. **Free-entry-point traffic** (Click-to-WhatsApp ads, QR) does not imply marketing opt-in; ask in-conversation.
8. **Sponsored suggestions** in a list the customer requested need no marketing opt-in (they are an in-session answer), but are labelled and can be switched off (section 3.3) **[A11, Meta; A10, Lawyer]**.
9. **Data deletion** ("delete my data") removes the customer from every audience and clears preference signals (already the case for the customer row).
10. **Complaints path:** a customer who reports an unwanted message is opted out at once and the merchant's campaign count is flagged; repeated flags suspend the merchant's sending.

## 6. Metrics we would log (and how not to fool ourselves)

All logs are written server-side, keyed by campaign or impression id, with phones hashed or omitted, retention aligned with the existing 90-day clean-up of `ai_call_log`.

### 6.1 Consent
- **Opt-in rate** = opt-ins / customers shown the prompt, split by when the prompt is shown (after first order, after second). Today: 1 of 154, but 151 are test phones, so **no usable baseline exists**.
- **Opt-out rate** per broadcast within 24 h and 7 d; **opt-out per recipient** per merchant.
- Size of the opted-in audience per merchant (for the pilot gate).

### 6.2 Broadcast
- Sent, **delivered** (Meta status webhooks), **read**, failed with error code (131049 per-user limit, 131026 undeliverable, template paused, etc.).
- **Meta charge per message**, taken from the status webhook's `pricing` object (`type`, `category`) rather than assumed; cost per campaign; cost per delivered message vs the price list.
- **Reply rate** = customers who sent any inbound message within 24 h of delivery / delivered. Reads are partial (some users disable read receipts), so reply rate is the safer engagement signal.
- **Orders attributed** (below), with revenue and our cost.

### 6.3 Recommendations and sponsored
- Per list: ranker version, number of rows, whether a sponsored row was shown, positions tapped, whether a basket add and a confirmed order followed.
- **Tap rate and add-to-basket rate by position**, sponsored vs organic, to expose position bias.
- Latency per list (the tap budget in `docs/latency.md` still applies), and complaints ("why am I seeing this") per 1,000 impressions.

### 6.4 Our own unit costs
- **Outbound messages per order and Meta charge per order** by `pricing.category` (this replaces assumption A7), AI cost per order (`ai_cost_per_order`), and gross margin per product after all three.

### 6.5 Attribution, honestly
- **Rule:** an order is *attributed* to a broadcast if it is placed by a recipient, with that merchant, within 48 hours of delivery. For a sponsored slot: an order within the same session that follows a tap on the sponsored row.
- **Caveats to print on every report:** (1) attribution counts orders that would have happened anyway (customers who ordered before are exactly those we message), so it **overstates impact**; (2) the **holdout** is the only honest number: randomly withhold 10% of eligible recipients (and 10% of lists from sponsored slots) and report the *difference* in order rate, with its uncertainty; (3) volumes are tiny now (4 real orders to date), so early differences are noise, and no percentage should be quoted below roughly 30 orders in each arm; (4) cash on delivery and phone sharing mean some orders arrive under another number; (5) read receipts and reply rates are incomplete; (6) 48 hours is a convention, not a measurement; (7) merchants' own promotions and weather run in the same weeks.
- No merchant-facing claim of "X% more orders" until a holdout comparison has reached the sample above.

## 7. Recommended launch order and kill-gates

Order chosen by marginal cost, risk to the shared WhatsApp number, and dependency: each step produces the data the next one needs. Thresholds are **proposals** to be agreed by the owner; none was measured.

| # | Product | Why this position (cost data) | Go gate | Kill / pause gate |
|---|---|---|---|---|
| 0 | **Measurement + consent growth** (log everything in section 6; fix the opt-in wording; real opt-in prompt placement) | costs almost nothing; no Meta charge; produces the first real opt-in rate and messages-per-order cost | Meta rate card checked (A1); logging live for 2 weeks | none (this is infrastructure) |
| 1 | **Organic recommendations** (section 2) | marginal cost about $0 (SQL ranking, no model call); builds trust and the impression logs sponsored needs; improves conversion for everyone | ranker + no-pay-to-win tests pass; added latency under 200 ms p95 | revert to current `orderNearest` if order conversion or tap rate is worse than the current ordering over 2 weeks, or latency budget broken |
| 2 | **Broadcast packs**, Starter only, 3-5 pilot merchants | each message costs $0.0421-$0.0471 to us plus about $0.006-$0.011 in replies, so today's $0.05 loses money and margin is healthy only from $0.075-$0.085; blast radius is the shared number (`TIER_250`, GREEN) | Meta rate verified; all templates APPROVED; at least **200 real opted-in customers** and at least 5 pilot merchants with 20+ opted-in past customers each; payments rail + ledger live; free-credit default removed | **pause selling** if any of: delivery rate under 70%; opt-out rate above 2% of recipients in one campaign (A15); number quality leaves GREEN; the all-in cost per delivered message (Meta marketing charge plus the bot's replies, from `message_billing_log` and `ai_call_log`) above $0.06 (the Starter price of $0.085 no longer leaves 25%); or after 4 pilot campaigns the holdout shows no incremental orders (then packs are not worth the risk) |
| 3 | **Larger packs (Growth, Pro) and scheduling** | volume discounts only valid while margin stays above 20% in the planning case C (floor $0.07) | 10+ paying merchants; repeat purchase by at least half of pilots | same as 2, plus any month with negative gross margin |
| 4 | **Sponsored slot**, one village, one meal period, free pilot first | near-zero marginal cost but needs traffic and carries the most trust risk; must not exist before organic is trusted | at least **1,000 list impressions per week** in the pilot area; disclosure wording approved by counsel (A10) and checked against Meta policy (A11); suppression tests for diet/allergy pass in production; 10% holdout wired | **stop** if any sponsored row ever appears in a diet/allergy answer (stop-ship); pause if tap rate on the sponsored row is below the organic last-position baseline, if order conversion in lists with a sponsored slot is more than 2 percentage points below the holdout, or if "why am I seeing this" complaints exceed 5 per 1,000 impressions (A15) |
| 5 | **Per-order pricing / auction** | only meaningful with trusted attribution | holdout-validated attribution over 100+ orders | not built until then |

Free alternatives to keep in view: customer QR codes and Click-to-WhatsApp ads open a **72-hour free entry window** in which template messages are not charged [V], and replies inside the 24-hour window are cheap relative to marketing templates; a merchant growth product built on those costs us no marketing-rate messages.

## 8. Assumption register (each needs checking before money moves)

| ID | Assumption | Check with | Where it bites |
|---|---|---|---|
| A1 | Lebanon marketing about $0.0421 and utility about $0.0112 per delivered message (range $0.0421-$0.0471 / $0.0112-$0.0122) from a secondary report; real USD rate card not read | **Meta** (USD rate card CSV / WhatsApp Manager billing) | every price in section 1 |
| A2 | "1,000 free service messages per month" is wrong; service messages are charged from 1 Oct 2026 at the utility/authentication rate, no volume tiers | **Meta** | our per-order cost, section 1.3 |
| A3 | Kapso charges nothing extra per message (unknown) | **Owner** (Kapso invoice/plan) | margin |
| A4 | $0.30 flat cost per top-up on Whish/OMT/cash; card rails cost more | **Owner** + chosen processor | minimum pack size |
| A5 | AI/ops allowances ($0.05-$0.07 per campaign; $0.10 per 100 messages) | **Data** (measure in the pilot) | margin |
| A6 | Merchant keeps about $8.90 on a $13.69 order (35% costs) | **Owner**, 3 pilot merchants | merchant break-even |
| A7 | About 10 outbound messages per order | **Data** (status webhook `pricing` log) | per-order cost |
| A8 | `TIER_250` upgrade conditions and quality-rating consequences | **Meta** | how many merchants can broadcast per day |
| A9 | Using order history for preference, and diet/allergy statements only in-session, is lawful purpose-limited processing under Law 81/2018 | **Lawyer** | section 2.3 |
| A10 | Arabic and English disclosure wording and placement are adequate; no codified Lebanese paid-ranking rule found | **Lawyer** + native speaker | section 3.3 |
| A11 | Promotional content in an in-window reply, and sponsored suggestions, comply with Meta's Commerce and Business Messaging policies; Meta charges it as a service message, not marketing | **Meta** | section 3, 5.8 |
| A12 | In-flow "Confirm and pay" button satisfies the affirmative-consent principle for merchant purchases | **Lawyer** | section 4.1 |
| A13 | Opt-in wording, per-merchant audience, frequency caps and quiet hours meet Lebanese law and Meta's opt-in policy; the current generic prompt and the village-only audience path may not | **Lawyer** + **Meta** | section 5 |
| A14 | What may be retained as a suppression record after "delete my data" | **Lawyer** | section 5.5 |
| A15 | Opt-out (2%) and complaint (5 per 1,000) thresholds in the kill-gates are sensible | **Owner** (policy), validated on pilot data | section 7 |
| A17 | The 1 Oct 2026 service-message billing, the Rest-of-Middle-East market moves and the "one charge per message" rule come from Meta's pages as mirrored in the Kapso docs corpus (`whatsapp/pricing.md`, `whatsapp/pricing/non-template-messages.md`, scraped Aug 2026), not read directly from Meta | **Meta** (confirm on the live pricing page / WhatsApp Manager) | sections 0, 1.3 |
| A18 | Today's in-window broadcast path (a plain message with an opt-out line first, template as fallback, see `docs/whatsapp-templates.md`) is billed as a service message, not marketing, so its real cost and the 1.1 unit cost differ by path | **Meta** + **Data** | section 1.1 |
| A19 | Accepting LBP at a fixed 89,500 for packs; refund and expiry of unused prepaid credit; merchant terms of service content; whether merchants are controllers of the aggregates and replies we route (Law 81/2018) | **Lawyer** | sections 1.2, 4.2, 5.6 |
| A20 | Licensing and terms of the payment rail (Whish, OMT, card) for collecting merchant prepayments | **Lawyer** + processor | section 4.1 |
| A16 | Courier/VAT/tax treatment of selling prepaid messaging credit and advertising to merchants (invoice, VAT on services) | **Lawyer / accountant** | whether prices are VAT-inclusive |
| A21 | Reply rate to a broadcast (2-20% scenarios) | **Data** (pilot: inbound within 24 h / delivered) | section 1.2b |
| A22 | 4 outgoing messages for a reply that does not order | **Data** (`message_billing_log` per conversation) | section 1.2b |
| A23 | AI cost per reply conversation ($0.02 / $0.04) | **Data** (`ai_call_log`) | section 1.2b |
| A24 | Share of repliers who order (30-50%) | **Data** (pilot, with a holdout) | section 1.2b |

## 9. Out of scope here

Schema and code for the ledger, price list and event logs (a separate PR each, with tests first); payment rail selection; WhatsApp Flows menus (see `docs/flows-plan.md`); courier dispatch; Meta Business Agent (a separate Meta product billed per token; we use our own model).
