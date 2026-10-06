# Outgoing message audit (flow items M1/M2)

Why: Meta's pricing is per message. Its page "Upcoming pricing updates for Meta Business Agent, service and utility messages" says that from **1 Oct 2026** non-template messages sent inside the 24-hour window are charged as service messages (at the market's utility rate), and utility templates inside the window are charged too; only messages inside a **free entry point window** (72 hours after a Click-to-WhatsApp ad or Facebook CTA conversation) stay free. Meta's main pricing page still says non-template messages are free and describes the model as of July 2026. The two pages disagree about timing; see "What Meta actually billed" below for what we observed.

The Lebanon USD rate is **not** in `docs/research/Meta Whatsapp USD rate card.md` (it holds the page text, not the CSV). Costs here use the planning inputs from `docs/merchant-products-spec.md` (utility/service about $0.0112 per message, assumption A1) and are labelled as such.

## Method

- **Exact counts, per path:** `tests/message-audit.ts` drives the staging copy (`kapso-brain-test`) in dry-run mode: every outgoing payload is returned instead of sent, so each step's message count is exact. It covers the model-free paths (numbered menu, tap flow, reorder). The free-text path needs the model and runs with `--model` in the one capped live run.
- **Status updates:** read from `_shared/lifecycle.ts`, `_shared/notify.ts` and `handleOrderDecision` in `kapso-brain/index.ts`.
- **Real traffic:** `conversations` rows for real (non-test) phones, counting what each assistant turn sent (cards, lists, plain texts), and Kapso's message log for the owner's own test phone.
- **Not counted:** typing indicators and read receipts are not messages and are not billed; customer-sent messages are free.

## Results, before any change (staging v27 = main on 6 Oct 2026)

Messages the **customer** receives for one confirmed order, from the first tap to "order received", then the status updates after the kitchen answers.

| Path | Steps and messages | To "order received" | + opt-in prompt (first order only) | + status updates | Total, repeat customer | Total, first order |
|---|---|---|---|---|---|---|
| Numbered menu | menu list 1, basket 2 (basket card + "Add a drink?"), summary 1, order received 1 | 5 | +1 | 5 (accepted, preparing, on the way, delivered, rating list) | **10** | 11 |
| Tap flow (search, item, add) | results list 1, item card 1, basket 1, summary 1, order received 1 | 5 | +1 | 5 | **10** | 11 |
| Reorder | reorder card 1, summary 1, order received 1 | 3 | +1 | 5 | **8** | 9 |
| Free text | model-dependent (cards and texts); real traffic averages 1.6 messages per free-text turn (max 3, 41 turns) | measured in the live run | +1 | 5 | n/a until measured | n/a |
| Real traffic, taps | 1.14 messages per tap turn (max 4, 43 turns) | | | | | |

Other outgoing messages per order (merchant and admin, also business messages):

| Message | When | Count |
|---|---|---|
| Kitchen card (Accept / Reject) to the owner | every order, if the vendor has a linked owner WhatsApp (today 0 of 816 vendors) | 1 |
| "Accepted #… The customer was notified" to the owner | after the owner taps | 1 |
| "Still being confirmed" to the customer plus a ping to the admin | only when nobody answers in 90 s (watchdog; seen on order #84CC63) | 0-2 |
| Cancelled or rejected notice | only on those outcomes | 0-1 |

Example from production (owner's phone, order #84CC63, 5 Oct): menu-free-text turn 1, basket card 1, summary 1, order received 1, "still being confirmed" 1, plus one admin ping: **5 to the customer and 1 to the admin** before any status update.

## What Meta actually billed (observed, not assumed)

Kapso's message log shows Meta's `pricing` object on every outgoing message. The last outgoing messages in the owner's conversation, sent on 5 Oct 2026 at 18:28-18:29 UTC (after the 1 Oct date), all carry `billable: false`, `type: free_customer_service`, `category: service`. So **as of that evidence Meta had not yet billed an in-window message**, although its announcement says it would from 1 Oct. Two readings are possible (billing starts later than announced; or the status webhook still reports the old classification while the invoice applies the new one) and only a Meta invoice or the pricing analytics endpoint can settle it. Item M3 stores the `pricing` fields per message so this is measured from now on rather than argued.

## Cost of the messages (planning inputs, assumption A1)

At about $0.0112 per message, if all in-window messages were charged: 10 messages is about $0.11 and 7 is about $0.08 per order; average order $13.69, so even the current count is under 1% of the order. The reason to cut messages is mostly customer experience (less noise, fewer taps to wait through); the saving is small in dollars and must never come at the price of clarity.

## Proposed target

| Path | Target (customer-facing, repeat customer, to "delivered") | Today |
|---|---|---|
| Numbered menu | **7** (menu, basket, summary, received, accepted with ETA, on the way, delivered with rating) | 10 |
| Tap flow | **8** (one extra for the item card) | 10 |
| Reorder | **6** | 8 |
| Free text | **9** (a conversational path can need a clarifying question) | to measure |

Rules the target must respect: never remove or merge away the allergy/diet notice, any price or total, or the order confirmation (summary and "order received"); keep cancel/rejected notices; keep the consent prompt exactly as it is until the owner decides (it touches consent, see M2 report).
