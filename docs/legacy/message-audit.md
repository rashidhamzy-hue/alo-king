# Outgoing message audit (flow items M1/M2)

Why: Meta's pricing is per message. Its page "Upcoming pricing updates for Meta Business Agent, service and utility messages" says that from **1 Oct 2026** non-template messages sent inside the 24-hour window are charged as service messages (at the market's utility rate), and utility templates inside the window are charged too; only messages inside a **free entry point window** (72 hours after a Click-to-WhatsApp ad or Facebook CTA conversation) stay free. Meta's main pricing page still says non-template messages are free and describes the model as of July 2026. The two pages disagree about timing; see "What Meta actually billed" below for what we observed. Our research report also claims each number gets **1,000 free service messages a month**; I could not find that in the Meta pages above, so it is unverified (assumption A2 in the merchant spec).

The Lebanon USD rate is **not** in `docs/research/Meta Whatsapp USD rate card.md` (it holds the page text, not the CSV). Costs here use the planning figure in `docs/research/WhatsApp Business Platform Lebanon Guide.md` (utility/service $0.0112-$0.0121 per message; a secondary source, to be replaced by the CSV rate) and are labelled as such. The Oct 2026 announcement quoted below is Meta's page "Upcoming pricing updates for Meta Business Agent, service and utility messages" as mirrored in the Kapso `whatsapp` docs corpus (scraped 11 Aug 2026); it is not in `docs/research/`.

## Method

- **Exact counts, per path:** `supabase/functions/kapso-brain/tests/message-audit.ts` drives the staging copy (`kapso-brain-test`) in dry-run mode: every outgoing payload is returned instead of sent, so each step's message count is exact. It covers the model-free paths (numbered menu, tap flow, reorder) and aborts if any step makes a model call without `--model`; on the 6 Oct run `model_calls` was 0 on every step. The table below is from that run (staging v27, test phones) plus the code for status updates. The free-text path needs the model and runs with `--model` in the one capped live run.
- **Status updates:** read from `_shared/lifecycle.ts`, `_shared/notify.ts` and `handleOrderDecision` in `kapso-brain/index.ts`.
- **Real traffic:** `conversations` rows for real (non-test) phones, counting what each assistant turn sent (cards, lists, plain texts), and Kapso's message log for the owner's own test phone.
- **Not counted:** typing indicators and read receipts are not messages and are not billed; customer-sent messages are free.

## Results, before any change (staging v27 = main on 6 Oct 2026)

Messages the **customer** receives for one confirmed order, from the first tap to "order received", then the status updates after the kitchen answers.

| Path | Steps and messages | To "order received" | + opt-in prompt (first order only) | + status updates | Total, repeat customer | Total, first order |
|---|---|---|---|---|---|---|
| Numbered menu | menu list 1, basket 2 (basket card + "Add a drink?"), summary 1, order received 1 | 5 | +1 | 5 (accepted, preparing, on the way, delivered, rating list) | **10** | 11 |
| Tap flow (search, item, add) | results list 1, item card 1, basket 1 (+1 "Add a drink?" when the vendor has a suggestion and the basket has no drink; none in this run), summary 1, order received 1 | 5-6 | +1 | 5 | **10-11** | 11-12 |
| Reorder | reorder card 1, summary 1, order received 1 | 3 | +1 | 5 | **8** | 9 |
| Free text | model-dependent (cards and texts); real traffic averages 1.6 messages per free-text turn (max 3, 41 turns) | measured in the live run | +1 | 5 | n/a until measured | n/a |
| Real traffic, taps | 1.14 messages per tap turn (max 4, 43 turns) | | | | | |

Other outgoing messages per order (merchant and admin, also business messages):

| Message | When | Count |
|---|---|---|
| Kitchen card (Accept / Reject) to the owner | every order, if the vendor has a linked owner WhatsApp (today 0 of 816 vendors, SQL 6 Oct) | 1 |
| "Accepted #… The customer was notified" to the owner | after the owner taps | 1 |
| "Still being confirmed" to the customer plus a ping to the admin | only when nobody answers in 90 s (watchdog; seen on order #84CC63) | 0-2 |
| Cancelled or rejected notice | only on those outcomes | 0-1 |

Example from production (owner's phone, order #84CC63, 5 Oct): menu-free-text turn 1, basket card 1, summary 1, order received 1, "still being confirmed" 1, plus one admin ping: **5 to the customer and 1 to the admin** before any status update.

## What Meta actually billed (observed, not assumed)

Kapso's message log shows Meta's `pricing` object on every outgoing message. The last outgoing messages in the owner's conversation, sent on 5 Oct 2026 at 18:28-18:29 UTC (after the 1 Oct date), all carry `billable: false`, `type: free_customer_service`, `category: service`. So **as of that evidence Meta had not yet billed an in-window message**, although its announcement says it would from 1 Oct. Three readings are possible (billing starts later than announced; the status webhook still reports the old classification while the invoice applies the new one; or the messages fell inside the 1,000 free service messages a month that our research report describes) and only a Meta invoice or the pricing analytics endpoint can settle it. Item M3 stores the `pricing` fields per message so this is measured from now on rather than argued.

## Cost of the messages (planning inputs, assumption A1)

At about $0.0112 per message, if all in-window messages were charged (not true if the 1,000 monthly free service messages exist: about 100 orders a month would stay inside it): 10 messages is about $0.11 and 7 is about $0.08 per order; average order $13.69 (SQL on `orders`, 6 Oct, mostly test orders), so even the current count is under 1% of the order. The reason to cut messages is mostly customer experience (less noise, fewer taps to wait through); the saving is small in dollars and must never come at the price of clarity.

## Proposed target

| Path | Target (customer-facing, repeat customer, to "delivered") | Today |
|---|---|---|
| Numbered menu | **7** (menu, basket, summary, received, accepted (the ETA is already in it), on the way, delivered with rating) | 10 |
| Tap flow | **8** (one extra for the item card; 9 with the drink suggestion) | 10-11 |
| Reorder | **6** | 8 |
| Free text | **9** (a conversational path can need a clarifying question) | to measure |

Rules the target must respect: never remove or merge away the allergy/diet notice, any price or total, or the order confirmation (summary and "order received"); keep cancel/rejected notices; keep the consent prompt exactly as it is until the owner decides (it touches consent, see M2 report).

The changes behind the target (no "preparing" message, rating folded into "delivered", no drink suggestion after a typed quick order) are **proposals**; M2 implements them and the report calls them out for owner sign-off.

## Implemented in M2

- `preparing` is recorded but not messaged (`isSilentStatus`); accepted already carries the ETA and now promises "I'll message you when it's on the way".
- Delivered and the rating prompt are one list message (`buildDeliveredRatingList`); one send, one retry unit.
- No optional "Add a drink?" card after a typed quick order (numbered reply or parsed multi-item order); taps and model turns keep it (at most once per basket).
- **Not changed, for the owner to decide (touches consent):** the opt-in prompt that follows the first "order received", and the privacy notice shown the first time a location is shared. Moving the opt-in question to the delivered message would remove one message from the first order, but it changes when consent is requested.

## Measured after the changes (6 Oct 2026, staging v30 = main after M2-M9, dry run, test phones)

| Path | To "order received" | + opt-in prompt (first order only) | Status updates (accepted, on the way, delivered with rating) | **Total, repeat customer** | Before | Target |
|---|---|---|---|---|---|---|
| Numbered menu | 4 (menu, basket, summary, received) | +1 | 3 | **7** | 10 | 7 |
| Tap flow | 5 (list, item card, basket, summary, received; +1 when a drink is suggested) | +1 | 3 | **8** (9) | 10-11 | 8 |
| Reorder | 3 | +1 | 3 | **6** | 8 | 6 |
| Free text that resolves server-side ("I want 2 Jebneh Baladiyi from Serail El Bek"); *a resolvable order only, not comparable to the target of 9, which allows for clarifying questions in a model-bound conversation* | 3 (basket, summary, received), 0 model calls | +1 | 3 | **6** | not measured | 9 (still to measure) |

**Dry run:** payloads were captured, nothing was delivered, and Meta billing was not measured (see "What Meta actually billed"). The status messages were driven through the real sweep on staging (`?job=order-watchdog` in dry-run mode: the audit order was moved to accepted, preparing, on the way and delivered in the database and the sweep run after each step; the script itself does not drive them): accepted 1, preparing 0 (recorded, not sent), on the way 1, delivered 1 (a list message carrying the delivery text and the rating prompt) = 3 instead of 5. All counts are customer-facing messages; the kitchen card (1 plus 1 confirmation) goes to a linked owner, none are linked today. Model-bound free text still varies by conversation (real traffic: 1.6 messages per turn); the audit script drives only resolvable orders.
