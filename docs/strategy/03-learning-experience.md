# Alo King strategy, part 3: the learning system and the experience strategy

Planning chat, 15 November 2026. Sources checked the same day are listed at the end.

---

# A. The learning system

## Rules
1. **Record once, never edit.** Facts are appended; corrections are new rows.
2. **Learning writes proposals only.** A person, or a written rule a person switched on, applies them. No model moves money, stock, food facts or an order's state.
3. **Every estimate has four things:** the simple rule it starts as, one number that says if it is good, a silent trial beside the current rule for two weeks before it replaces it, and a one-tap way back.
4. **Small numbers are respected.** Nothing is shown as learned from fewer than 20 cases; below that the screen says "not enough data yet" and the rule stays.
5. **Only the customer's own order behaviour is used.** Never a name, a village's religion, a health guess or anything inferred about a person (invariant 16).
6. **Personal data is kept short:** ids instead of names in the log, rider position only during a job, no voice or picture content in any log.

## The event log
One append-only table, `events`, written only by SQL functions in the same transaction as the change they describe (helper `log_event()`), never by TypeScript.

| Column | Meaning |
|---|---|
| `id`, `at`, `occurred_at` | When we stored it; when it happened (a rider's tap may arrive late) |
| `kind` | Dotted name: `order.confirmed`, `pick.line_missing`, `offer.declined`, `case.claimed` |
| `actor_kind`, `actor_id` | Customer, agent, picker, rider, ops, system |
| `order_id`, `party_id`, `product_id`, `rider_id`, `source_id`, `village_id`, `lot_id` | What it is about (nullable) |
| `channel` | whatsapp, catalog, web, console, staff line |
| `payload`, `payload_version` | The measured facts for that kind, as JSON |
| `request_key` | So a retried call records once |

The tables that already hold facts stay as they are and are not duplicated: `order_events`, `stock_movements`, `ledger_entries`, `staff_actions`, `agent_runs`, `wa_messages`, `turn_waits`, `demand_signals`, `substitution_offers`, `order_feedback`, `driver_positions`. `events` covers what none of them records. L1's `order_timeline` becomes a view over `order_events` and `events`.

## What to record from day one
| Area | Record (new unless marked) |
|---|---|
| Conversation | Input type (text, voice, catalog, web, list photo); language; whether a question was needed; seconds and customer turns to the card; edits after the card; guard blocks; every case and hand-off with its reason; model calls and cost (exists) |
| Search | Every search phrase with the number of results and the item chosen; misses (exists); views of an out-of-stock item |
| Order | Every status change (exists); the promise shown (fee, time or window); cancel and refund reason codes; feedback (exists) |
| Warehouse | Receipt lines with lot, expiry and cost; put-away bin; pick start, each line picked, missing or substituted with seconds; pack done; temperature readings; counts (expected against counted); write-offs with a reason code; price and cost changes |
| Riders | Offer sent, accepted, declined or expired with seconds; arrival and wait at the hub; pickup; position once a minute during a job; arrival and wait at the door; delivered; cash by currency and the note given; no answer; incidents; shift start and end |
| Money | Payment proofs: what the reader proposed against what the person decided; over and short; the exchange rate used (ledger exists) |
| Operations | Exception raised, claimed, resolved with seconds; approvals and how long they waited; spot-check results |
| Context | Holiday or season (calendar exists), a village pause, a power cut at the hub |
| Vendors (later) | Card sent and accepted with seconds; preparation promised against actual; missed orders |

## The models
| Estimate | Starts as (now) | Becomes | Learning model only when | Checked by | Applied by |
|---|---|---|---|---|---|
| Delivery time | The zone table (ring estimates) | Median of the last 20 deliveries per village and part of day, blended with the zone figure (weight n/(n+10)); the promise shown is the 80th percentile | Over 2,000 deliveries and the averages are measurably worse | Share delivered within the promise (target 90%); average error in minutes, weekly | The console's proposal page; a person taps `set_zone` |
| Picking and preparation time | A fixed 10 minutes | Base plus median seconds per line; per vendor, the median from accept to ready | The same test | Promised ready time against actual | Settings proposal, one tap |
| Demand and reorder points | The founder's judgement | Average daily sales per item by weekday over four weeks, times supplier lead time, plus a safety margin; lost sales counted from out-of-stock views and unmet requests | Six months of data and about 100 orders a day | Stock-out rate, days of cover, waste | The evening purchase proposal the founder approves |
| Substitutes | Same subgroup, nearest size, nearest price | Ranked by how often customers accepted that pair (at least 5 offers) | Not needed | Acceptance rate | Automatic ordering of the suggestions; never crosses a stated restriction |
| Dispatch | Nearest free rider under the cash cap; up to 3 orders, 8 minutes of detour | The same rules with thresholds tuned from measured detours and lateness | More than about 15 riders | On-time share, idle time, spread of earnings per hour between riders | Settings proposal |
| Cash-on-delivery risk | First-order cap and fixed rules | A points table on the customer's own history: refusals, no-answers, cancellations after picking | 300 orders with at least 30 bad outcomes | Share of flagged orders that did go wrong | Lowers the cap, asks for a confirmation call or part payment; never blocks alone |
| Recommendations | None | "The usual" (that customer's most frequent items) and "often bought together" pairs seen at least 5 times; one suggestion per order | Volume in the thousands of orders | Acceptance rate; complaints | Shown on the card; restrictions and "stop suggesting" always win |
| AI answer quality | The 990-case gate and the nightly 150 | Plus the simulated-customer suite weekly; live code checks on every turn (no reply, wrong language, guard block); 5% of real chats judged weekly; the console's "bot at fault" button | Not applicable | Cards right without an edit; turns to the card; hand-off rate; cost per order | A prompt or planner change ships only if every gate holds |
| Voice notes | One provider | Scored on the 51 hand-corrected notes | Not applicable | Item accuracy per provider | Founder decision after V1 |
| Staff outliers | None | Missing-item rate per picker, over and short per rider, refunds per staff member, against the group, with a minimum sample | Not needed | Review by the founder | Shown only; a person decides |

## Rhythm
Nightly: rebuild the statistics, run the 150-case check, write "what the system learned" (N2). Weekly: the full language run, the simulated customers, the judged sample, the proposals page. Monthly: each estimate's number against its rule, and anything that is not better is switched back.

**Sessions:** L1 carries the event log, the timeline and measured times; N2 the nightly jobs; AN1 the reports; WH1b the reorder proposals; LOY1 and BK1 the recommendations.

---

# B. The experience strategy

## Three corrections to the brief
1. **Restock reminders cannot be utility messages.** Meta's category rules class replenishment and back-in-stock messages as marketing, and it re-checks approved templates. They would be blocked by the marketing lock, rightly. The compliant version is a **standing order the customer sets** ("every Friday"): the message "your Friday order is ready, confirm or skip" is about a transaction they asked for. Until that exists, "the usual" appears whenever the customer writes to us.
2. **Send Home does not need a card gateway, but it does need the company's Whish account.** Whish lets Lebanese abroad send money home, serves users in the United States in its app and runs a Canadian branch. Its consumer terms are for personal use, so receiving order payments needs the corporate account, which needs the SARL.
3. **Change for cash:** Toters lets a customer load its wallet by paying the courier extra cash. Alo King already has customer credit and an overpayment path: "keep the change as credit" is one tap, and it removes the rider's change problem. Stored value is already on the lawyer's list.

## What Alo King adopts, in order
★ = not offered by Toters according to its own store listing, and I found nobody in Lebanon offering it. Peep Peep was not test-ordered; that stays a founder task (5.12).

| When | Area | Feature (from) | How Alo King does it better |
|---|---|---|---|
| **Before the friends' test** | Support and hand-offs | A person always reachable (Just Eat's lesson) | A case beside the chat with timers; the bot keeps serving (HO1) ★ |
| | Notifications | One update per stage (Uber Eats, DoorDash) | At most four customer messages per order, since each one is billed; the rest lives on the tracking link |
| | Ordering | First-contact welcome | Three buttons and one privacy line, in the customer's language |
| **Before the shadow run** | Substitutions | Preference per item (Instacart) | One choice on the card; "ask me" sends the substitute's picture with yes or no ★ |
| | Cash on delivery | Confirm before dispatch, first-order cap (regional practice) | Already built; add "which note will you pay with?" and keep the change as credit ★ |
| | Cancellations | Free until preparation starts | Self-service by button until picking starts; after that the exact refundable amount is shown |
| | Tracking | Stage timeline | A signed link, no address or phone on it; rider position only with consent |
| | Delivery | Proof of delivery | A four-digit handover code for prepaid and gift orders ★ |
| | Fulfilment | Pickup | Collect at the hub, no fee |
| **Pilot weeks 1 to 4** | Ordering | Catalog and cart in WhatsApp (JioMart, Just Eat) | The whole order closes in the chat, payment proof included ★ |
| | Ordering | Website with the same cart (all) | Same prices, stock and rules; "Order on WhatsApp" on every page |
| | Reorder | "Order my usual" (DoorDash) | One button, re-priced, missing items named first |
| | Refunds | Self-help with the agent's own options (DoorDash) | Automatic credit only where our own picker recorded the miss, capped per customer per month; a photo for the rest; never an automated "not eligible" |
| | Delivery | Scheduled slots (Toters, talabat) | Fixed village rounds with a promise calibrated from measured times ★ |
| | Payments | Diaspora ordering | Send Home with a Whish transfer once the company account exists; the buyer gets the updates ★ |
| **After four clean weeks** | Loyalty | Points and free delivery (Toters), subscriptions (talabat, Deliveroo) | A stamp card: every tenth paid order earns a delivery, paid by us to the rider. No subscription until numbers show it pays |
| | Reorder | Proactive reminders (DoorDash) | The customer's own standing order, confirm or skip ★ |
| | Ordering | Cart from a photo (Uber Eats) | A photo of a handwritten shopping list becomes the card ★ |
| | AI | Suggestions by budget and group size (DoorDash) | Basket builder from approved portion rules; restrictions always win; no health words |
| | Delivery | Calibrated promises | The time shown is the one we hit nine times in ten |
| **With vendors** | Vendor tools | AI menu tools, dashboards (DoorDash, Uber Eats) | Menu from a photo, changes by message with one tap and undo, a weekly report by message ★ |
| | Ordering | Group orders (DoorDash) | One organiser, one payment, joined from private chats |
| | Ads | Sponsored listings (all) | One labelled slot that never overrides a restriction; not before customers browse vendors |
| **Staff side, as volume grows** | AI agents | Driver assistant (DoorDash) | A "how do I" helper on the staff line; a read-only founder assistant |

## What Alo King does not adopt
| Feature | Why not |
|---|---|
| Ratings and "best" lists | Business rule 4 |
| Marketing broadcasts and promotional reminders | Locked until the founder unlocks them; never on the customer number |
| Delivery subscription now | Riders keep the fee, so every free delivery costs us about $1.75 |
| Lock-screen live tracking cards | Needs a native app |
| Payment inside the chat | Meta offers it in a few countries, not Lebanon |
| Voice replies from the bot | Invariant 2 |
| A native app | Not planned; the installable website covers it |

## The pitch this adds up to
What only Alo King offers in the Chouf: order by Lebanese voice note with no app; order for your family from abroad; riders who keep the whole fee; a time promise that is kept; a person within minutes when something goes wrong.

---

## Sources (checked 15 November 2026)
- Mastercard newsroom, Whish Money and Mastercard Move, August 2025: https://www.mastercard.com/news/eemea/en/newsroom/press-releases/en/2025-1/august/whish-money-collaborates-with-mastercard-move-to-bring-seamless-cross-border-payments-to-lebanon
- Whish Money app listing (United States): https://mwm.ai/apps/id/1284243483 ; Whish Money Canada: https://www.whish.money/canada
- LINK Mobility, WhatsApp template categories: https://www.linkmobility.com/blog/the-whatsapp-business-template-categories
- Wati, reducing utility-to-marketing reclassification: https://support.wati.io/en/articles/15932488-best-practices-to-reduce-whatsapp-utility-to-marketing-template-reclassification
- Toters on the App Store: https://apps.apple.com/lb/app/toters/id1015006220 ; Toters Cash terms (Lebanon): https://totersapp.com/toters-cash-lebanon-draft
- The brief's own sources for Just Eat, DoorDash, Uber Eats, Instacart, JioMart, talabat and Deliveroo (docs/DESIGN_BRIEF.md once committed).
