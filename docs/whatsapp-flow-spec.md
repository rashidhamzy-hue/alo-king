# Alo King WhatsApp ordering flow: conversation design spec

Status: living spec. Each feature is tagged with the work item that delivers it (`[1]` basket, `[2]` browsing, `[3]` smart understanding, `[4]` lifecycle, `[5]` handoff/routing, `[now]` already shipped). Background: `docs/research/Conversational and voice design.md` (buttons vs lists vs Flows, drop-off, reorder, upsell timing, prompt-injection defences, Arabic ASR), the Blueprint (single-turn message density) and the Lebanon WhatsApp guide (24 h window, templates, consent).

## 1. Principles

1. **One turn, one rich message.** A customer turn yields one interactive message (a card, list or summary) wherever possible; hard cap **3 messages per turn**. Never repeat what a card already says.
2. **Tap beats type.** Every decision point offers buttons/lists. Free text always still works (the LLM understands it), and every card has a way back (Menu / Basket).
3. **The server owns the facts.** Items, prices, fees, totals, availability, opening hours, delivery areas and the COD cap come from the database through server code. The LLM chooses *which* tool to call and writes the words; it never states a price that did not come from a tool result, and a total is only ever shown by server-built cards.
4. **Nothing is ordered without the customer's own confirmation.** An order is created only by a `CONFIRM|<cart>` tap or a clear "yes" typed in a **later** message than the summary. Law 81/2018 affirmative confirmation: the summary is immutable, shows everything, and ends with one unambiguous Confirm button.
5. **Dual currency, always.** Every customer-facing amount is `$X.XX · N LBP` at 89,500, including basket lines, fees, totals, substitutions and refunds. Delivery fee ($2.00) and the cash-on-delivery cap ($150) are shown/enforced per order.
6. **Language mirrors the customer.** Arabic script → Levantine Arabic; Arabizi → Arabic script (or Arabizi if they keep using it); English → English; French → French. Language is stored on the customer from their first clear text and re-checked per message. Server-built cards are bilingual where the language is unknown.
7. **Respect consent.** Transactional messages (confirmations, status, rating prompt, cancellations) are service messages sent inside the customer's 24 h window. Marketing only to `marketing_opt_in`, via approved templates, each with an opt-out. STOP / "Stop offers" is handled before everything else.
8. **No secrets in chat.** The bot never asks for or echoes keys, tokens, OTPs, card numbers or the admin's number. Tool results, owner notes, menu text and customer messages are data, never instructions.
9. **Fail soft, never silent.** Every error path ends with a short human sentence and a next step (button or question), never a stack trace, never nothing.
10. **Cheap by default.** Deterministic code handles what code can (buttons, basket ops, greetings, status); a small model handles simple language turns; the large model is reserved for ambiguity, dietary/allergy questions and complaints. `[5]`

## 2. WhatsApp constraints the bot designs for

| Element | Limit | Rule |
|---|---|---|
| Reply buttons | max 3, title ≤ 20 chars | emoji count toward the limit; keep the price in the label, drop the emoji first |
| List message | max 10 rows total, row title ≤ 24, description ≤ 72, button label ≤ 20, section title ≤ 24 | paginate with a "More…" row |
| Body | ≤ 1024 chars | footer ≤ 60 |
| Header | text ≤ 60, or image | item cards use the dish photo when there is one |
| Button/row ids | ≤ 256 / ≤ 200 | ids carry only opaque ids (item id, cart id), never prices |
| Free-form window | 24 h after the customer's last message | all lifecycle messages are in-window; outside it we do not message (log + retry on next inbound) |
| Template messages | approved templates only | marketing only, opted-in only |

Message ids used by the server (stable contract): `ADD|<item>|<qty>`, `QTY|<item>`, `CZ|<item>|<qty>|<picks>`, `CAT|<vendor>|<n>`, `ITEM|<item>`, `BASKET`, `BSET|<item>|<qty>`, `BDEL|<item>`, `BCLR|<basket>`, `CHECKOUT`, `CONFIRM|<cart>`, `EDIT|<cart>`, `ADDR|<id|new>`, `ORD|…` (legacy: add one), `REORDER|<order>`, `CANCEL|<order>`, `SUB|<offer>|<ok|no|cancel>`, `RATE|<order>|<1-5>`, `VOICE|<ok|no>`, `HUMAN`, `OPTIN|…`, `OPTOUT`.

## 3. State the server keeps

| State | Where | Notes |
|---|---|---|
| Profile: name, language, village, last address, saved addresses | `customers`, `customer_addresses` `[3]` | language from first clear text |
| Basket per vendor | `baskets` + `basket_lines` `[1]` | lines hold item id, quantity, chosen options; **never a price** |
| Pending confirmation | `carts` (20 min) | one per vendor basket at checkout; holds the server-priced summary that was shown |
| Orders + lifecycle | `orders` (+ `customer_notified_status`, cancel/substitution fields) `[4]` | statuses: pending → accepted → preparing → ready → out_for_delivery → delivered, or cancelled / rejected |
| Short-lived decisions | `pending_actions` `[3][4]` | voice transcript awaiting yes/no, substitution offers; expire |
| Ratings | `order_ratings` `[4]` | 1-5 + optional comment |
| Handoff | `customers.handoff_until`, `handoff_log` `[5]` | bot stays quiet while a human has the conversation |

## 4. Flows

### 4.1 Opening
- **New customer, plain greeting** → short welcome + "what are you craving, or share your location" with a location-request button. `[now]`
- **Returning customer, greeting** → "Welcome back" card with **Reorder last order** / **See Full Menu** (no prices on the card). `[now]`
- **"The usual"** (EN/AR/Arabizi: "the usual", "as usual", "زي العادة", "el 3ade") → the most frequent recent order rebuilt as a fresh server-priced summary; if there is no history, say so and offer the menu. `[3]`
- **Location pin** → nearest village stored; suggestions follow. Saved addresses are offered at checkout. `[3]`
- **Click-to-WhatsApp / QR entry** → source stored; QR text is never shown to the LLM as raw text. `[now]`
- **STOP** at any time → opted out immediately, bilingual confirmation. `[now]`

### 4.2 Browsing `[2]`
1. **Categories**: a list message of the vendor's sections (max 10 rows, "More…" when there are more), each row showing the item count.
2. **Items in a category**: a list of up to 9 items + "More…", each with the dual-currency price in the description.
3. **Item card**: photo header (when available), name, 1-2 line description, macros with `~`, price in both currencies; buttons **Add (price)** · **Quantity** · **Menu**. No allergen claims unless the kitchen confirmed them (`allergens_reviewed`).
4. **Quantity picker**: a list of 1-10 (`ADD|<item>|<n>`); typing "3" also works.
5. **Customizations**: if the item has required/optional groups, a list message per group (rows show the option and its price delta in both currencies); picks accumulate in the button ids; the item is added only after all required groups are answered. Min/max rules are enforced server-side.
6. **Add-on, at most once per order**: after the first item lands in a basket, if the basket has no drink and the vendor has one, send **one** card suggesting a relevant drink (same vendor, cheapest popular drink) with **Add** / **No thanks**. Declining or ignoring it never repeats; one offer per order, enforced with a flag on the basket.
7. Recommendation text from the LLM uses the same item card (`present_offer`); an LLM message never carries a price.

### 4.3 Basket `[1]`
- **Add**: item must exist, be available and be priced; quantity 1-20; choices valid. Adding from a second vendor creates a **second basket**; the bot says so in one line ("Separate basket from X: it will be a separate order with its own delivery fee").
- **Show basket**: one card per vendor basket: lines with line totals, subtotal, delivery fee, total, all dual-currency, prices recomputed from the database at display time (a changed price is simply shown, not honoured from history). Buttons: **Checkout** · **Add more** · **Clear**.
- **Change**: "make it 3", "remove the drink", "no tawouk" → `BSET`/`BDEL` through tools or buttons. Changing one's mind any number of times just edits the basket; nothing is ordered.
- **Clear**: clears one basket (button) or all (typed), with a one-line acknowledgement.
- Baskets persist for 48 h and survive "cancel the conversation"; an old basket is re-priced on view.
- **Checkout** processes every active basket: **one summary card per vendor**, each with its own delivery fee and total **before** its own Confirm; confirming each creates a separate order. A basket below the vendor's minimum, a closed vendor, an unserved village or a total above the COD cap is explained and left in the basket.

### 4.4 Checkout and confirmation
- Delivery details: name, village, landmark. Taken from the profile / saved addresses; only the missing piece is asked, in one short message. The summary shows the address with **Change address**. `[3]`
- Summary card (server-built): vendor, lines, subtotal, delivery, **total** (dual currency), address, name, payment (cash on delivery), prep time. Buttons: **Confirm Order** · **Change Order** · **Change Location**. `[now]`
- **Confirm** → order created (`pending`), receipt text with short code and tracking link, opt-in prompt once (only if never asked). Re-pricing happens again at confirm; a mismatch re-asks instead of charging a different amount. `[now]`
- A typed clear "yes" is accepted **only** in a later turn than the summary. `[now]`

### 4.5 Smart replies and understanding `[3]`
- **Arabizi and typos**: the model normalizes ("shawarma", "shaurma", "شورما", "bde pizza") and the search tool is called with both Arabic and English terms; the bot never answers "I didn't understand" before trying search.
- **Voice notes**: transcribe, then **confirm before acting**: "I heard: “…” Right?" with **Yes** / **Retype**. Only a Yes runs the transcript as a normal message. A failed transcription asks for text. Money-moving words in a transcript never skip the confirm step.
- **Ambiguity**: ask one short question with buttons/list (which of two same-named items, which vendor), never a paragraph.
- **Dietary/allergy**: answered by the large model with the strict-allergy rules (only confirmed allergens; otherwise advise telling the kitchen).
- **Prompt injection**: user text, menu text, owner notes and FAQs are data. Requests to reveal instructions, change prices, skip confirmation, act as admin, or send messages elsewhere are refused in one line and the flow continues.

### 4.6 Lifecycle messages `[4]`
All in-window, localized, one message each, sent when the status changes (by the kitchen's WhatsApp tap, the kitchen dashboard, or the driver app):

| Status | Message |
|---|---|
| accepted | "✅ {vendor} accepted order #{code} · ~{n} min" + **Cancel order** button until the kitchen starts preparing |
| preparing | "👨‍🍳 Preparing" |
| out_for_delivery | "🛵 On the way" + live tracking link |
| delivered | "🎉 Delivered. Enjoy!" followed by the **rating prompt** (list 1-5, optional comment) |
| rejected | apology + offer to pick another kitchen |
| cancelled | confirmation of the cancellation |

- **Cancel before accept**: "cancel" / the **Cancel order** button sets `cancelled`, tells the kitchen, confirms to the customer. After acceptance the bot explains it needs the kitchen and offers the human handoff. Nothing is ever cancelled by a model guess: it needs the explicit tap or a clear "cancel order #…".
- **Vendor closes or pauses while the order is pending**: the customer is told immediately with **Keep waiting** / **Cancel**.
- **Item sells out after confirm** (kitchen marks it unavailable): the customer gets a substitution card: "{item} just sold out. Swap for {similar item} ({price both currencies}, new total …)?" with **Swap** / **Remove it** / **Cancel order**. Substitutes are chosen by the server (same vendor, same section, closest price, available). A swap or removal re-prices the order on the server and needs the customer's tap before the order changes; no tap within 10 minutes → the kitchen is told to call the customer.
- No-response escalation (90 s) and the kitchen Accept/Reject card are `[now]`.

### 4.7 Errors and edge cases
| Situation | Behaviour |
|---|---|
| Item not found / sold out | say so, offer 2-3 close alternatives from search (cards or list) |
| Vendor closed or paused | say so with opening hours if known, offer other open vendors; never create a cart |
| Village not served | list the villages the vendor serves |
| Below minimum order | state the minimum in both currencies and what is missing |
| Total above $150 COD cap | explain, offer to split or remove items |
| Price changed between summary and confirm | re-ask with the new summary; never charge the old price |
| LLM / tool failure | bilingual one-liner + retry hint; the basket is untouched |
| Duplicate webhook | deduplicated by message id; no double reply |
| Confirm tapped twice / after expiry | "already placed or expired" |
| Unknown button id | "that button isn't valid any more" + menu |
| Customer sends only an emoji/sticker/unsupported media | ask what they'd like in one line |
| Customer asks about order status | answered from the order row (status, ETA), never invented |

### 4.8 Human handoff `[5]`
Triggers: the customer asks for a person ("agent", "human", "موظف", "بدي احكي مع حدا"), repeated failure (the same question three times), a complaint or refund request, an allergy emergency, anything after acceptance that changes the order.
1. The bot says a team member will reply and gives expected timing, sets `handoff_until` (default 2 h) and writes a `handoff_log` row.
2. The admin (`ADMIN_WHATSAPP_PHONE`, a secret) receives a summary: who (phone + `wa.me` link), the last messages, basket/order codes, reason, with **Resume bot** button. Delivery needs the admin's 24 h window; otherwise it is logged and visible in the dashboard.
3. While a handoff is active the bot only handles buttons, STOP and a single holding reply; free text is not answered by the bot (a human replies from the business app).
4. **Resume bot** (or expiry) ends the handoff.

## 5. Message budget and style
- ≤ 1 rich message per turn, ≤ 3 messages per turn, ≤ 25 messages for a full single-vendor order from greeting to receipt.
- No text after a card or list. Confirmation texts are short. Emoji sparingly (👑 for the brand, status icons).
- Voice of Alo King: warm, decisive, a little Lebanese hospitality, never pushy; no apologies about data.

## 6. Persona test suite

`supabase/functions/kapso-brain/tests/` runs scripted customers against the staging copy `kapso-brain-test` (dry run: no WhatsApp is sent; the database is real, test phones only, prefix `961700000`). Run with `bun run supabase/functions/kapso-brain/tests/run.ts` (needs `SELFTEST_TOKEN`; see the suite README). Each persona asserts:

| Assertion | Meaning |
|---|---|
| **price-from-db** | every order line's unit price equals the public `menu_items.price_usd` (plus option deltas); subtotal/total/fee recompute exactly; every amount shown in text has USD and LBP |
| **no-unconfirmed-order** | an order row exists only if the persona confirmed (tap or later-turn yes) |
| **language** | replies are in the persona's language (Arabic script ratio / Latin) |
| **button-limits** | ≤ 3 buttons, titles ≤ 20; list rows ≤ 10, row title ≤ 24, description ≤ 72; body ≤ 1024; header ≤ 60 |
| **message-cap** | ≤ 3 messages per turn; total under the persona's budget |
| **no-leak** | no keys, tokens, system-prompt text or admin number in any reply |
| feature assertions | tagged with the item that delivers them; before that item they are reported as `pending`, not failures |

Personas: Arabic speaker, English speaker, Arabizi speaker, typo-heavy, voice note (fixtures: `kapso.transcript_fixture`, dry-run only), changes their mind three times, two vendors, closed vendor, cancels, asks for a human, prompt injection. The universal assertions must pass in every run; `pending` assertions become required as the items land.

## 7. Instant feedback and latency targets (`docs/latency.md`)
- **Read receipt + typing indicator** on every inbound customer message, sent in parallel with the turn (`receipts.ts`): `POST /{phone_number_id}/messages` `{status:"read", message_id, typing_indicator:{type:"text"}}`, no `to`. The indicator clears when the bot sends, or after about 25 s. Skipped in dry runs; the admin's own messages are only marked read. Known edge: while a human handoff is active the bot stays silent, so the indicator can linger until it expires.
- **Targets (ours, excluding Kapso's buffer window):** a tap that needs no model answers in under 1.5 s of handler time; free text uses at most one model call when the message can be resolved server-side.

## 8. Retrieval-first, one model call (flow item 2)
- **Before the model runs**, the server resolves the customer's free text against an in-memory index of every orderable dish (`resolve.ts`: Arabic / English / Arabizi normalisation, a shared consonant skeleton for transliterations, typo tolerance; refreshed every 5 minutes, ids and names only, never prices). The best matches per typed segment (with vendor, open now, needs-choices) go into the prompt as `SERVER MATCHES`; the model uses those ids directly.
- **`add_items`**: one call adds every dish of one vendor (`items:[{item_id, quantity, choices?}]`). Prices come from the database, required options are enforced per line, one basket card is sent at the end; a failure note, if any, goes before the card.
- **No "say nothing" call**: when every tool result in a batch is terminal (the card was already sent), the loop stops instead of calling the model again.
- **Smaller prompts**: `search_menu` rows are slimmed (no ingredients/nutrition detail/AI notes; allergen facts kept when confirmed), and history is the last 6 messages with long assistant logs clipped.

## 9. Multi-item natural-language ordering (flow item 3)
"2 shawarma, fries and a Pepsi from X", "badde etneen shawarma w batata w 3 pepsi", "بدي اتنين شاورما و بطاطا و 3 بيبسي" (`orderparse.ts`, pure, no model):
1. **Parse**: segments split on commas / and / w / و / +; per segment a quantity (digits, `2x`, `x2`, English, Arabic and Arabizi number words, "a couple of") and the dish words; "from / min / من X" names the vendor. Quantity is clamped to 1-20.
2. **Order intent**: only when the message looks like an order (a quantity, an order verb such as want / badde / بدي / عطيني, or two or more items). A bare "shawarma" or "do you have falafel" is a search, not an order.
3. **Decide** (`decideOrder`):
   - every item resolves confidently (score >= 0.8, clear margin) in ONE open vendor with no required options: **add them all, one basket card, no model call**;
   - two plausible dishes for one item: add the clear ones, ask **ONE short question** with up to 3 buttons (`ADD|vendor|item|qty`), the next tap shows the basket card;
   - anything else (no match, needs options, closed vendor, no common vendor, weak match): the model gets the matches and asks or searches.
4. Works in button-only mode too (it costs nothing). Nothing is ordered: the customer still taps **Confirm Order** on the server-built summary. Prices come from the database when the basket is shown.

## 10. Numbered quick-order (flow item 4)
- **"See Full Menu"** (the `MENU|vendor` tap and the model's `show_menu`) sends the vendor's **popular dishes as a numbered text list** with a dual-currency price on every line (`numbered.ts`): popular first, then the vendor's own order; up to 10 dishes per page, body always under 1024 characters (rows are fitted to the budget, the reply hint and the ⚙ "has options" legend are reserved). Buttons: **More dishes** (next page, numbers restart at 1), **Categories** (the old category tree, now one tap away), **My basket**.
- **Replies are parsed deterministically, no model call**: `3`, `1x2, 3, 5`, `1 1 3` (repeats add up: two of #1, one of #3), separators space / comma / `+` / "and" / `و`, Arabic-Indic digits, `×`, `*`; "more" / "next" / "المزيد" / "كمان" / "mazeed" shows the next page. Strict grammar only: any other text goes to the normal flow. Quantity is capped at 20 per dish; a number outside the list, or a zero quantity, rejects the whole message with a one-line hint (nothing is added).
- **State**: `quick_menus` (one row per customer: vendor, page, the dish ids the numbers refer to; phone + ids only). The list is **live only until the bot sends anything else** (a plain order consumes it, "Add more" reopens it; an invalid reply, or more than one dish still needing options, keeps it live so the retry works) (the first other outgoing message drops the row) and for at most 5 minutes; it is deleted with "delete my data" and purged when expired. Without a live list a bare number is never interpreted, so "2" as a floor or house number goes to the normal flow. Times (`7:30`), phone-number digits and out-of-range bare numbers are not list replies; only a pair with `x` (`9x2`) gets the "pick numbers 1-N" hint.
- Lines are added through the same server path as `add_items` (open, available, priced, options, MAX_LINES; ONE basket card). Dishes with required options start the usual option list for the first one; others are named in one line.

## 11. Running basket card and clean edits (flow item 5)
- **After every add** (button, numbered reply, typed order, `add_items`) the customer gets ONE basket card: lines with line totals, subtotal, delivery noted for checkout, all dual-currency and re-priced from the database. Buttons: **✅ Checkout** · **➕ Add more** (reopens the numbered list) · **✏️ Edit**.
- **Edit** opens a list of the basket's dishes (plus *Clear basket* and *Back to basket*); tapping a dish offers **➖ One less / ➕ One more / 🗑 Remove** (`BEDIT|basket`, `BLINE|line`, `BSET|line|qty`, quantity 0 removes). The line must belong to the customer's own active basket; quantity is capped at 1-20; every change re-prices and withdraws any waiting order summary.
- **Typed edits with no model call** (`basketedit.ts`): "make it 3", "only 2", "change the shawarma to 1", "fries x3", "3 pepsi instead", "remove the fries", "no pepsi", "I don't want the fries", "خليها 3", "شيل البطاطا", "احذف البيبسي", "khalli el batata 3", "shil el batata", "ma badde pepsi". With no dish named, the dish added last is meant. If two basket lines match the name, one short question with buttons (never a guess). Names that match nothing in the basket ("no onions", "remove the pickles") are not basket edits and go to the normal flow.
