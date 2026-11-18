# CX2: WhatsApp replies redesigned, and the founder's test (18 November 2026)

Branch `claude/gifted-carson-cxqd7q`. Migrations **0255** and **0256** (reserved 0255 to 0256). Two stages, one pull request each.

## Stage 1 (this pull request): three fixes, the hours, the proposal

Read first: the founder's own staging chat of 18 November, 07:36 to 09:06 Beirut (`wa_messages`, `demand_signals`, `turns` of his test
number; orders AK-1062 and AK-1063). What it showed, in order:

| Time | What happened | Now |
|---|---|---|
| 07:37 | A voice note «… كرتونة مي تنورين وقهوة نجار … وكمان بدي نص كفة»; we were closed. The reading's third line «نص كفة» was not found (a demand row, `unknown_product`), and the model's reply (a location request with the hours) said nothing of it. | **Fix 1.** «كفة», «كفته», "kafta" are kafta's words (AK-0028, 0256). Any line not found is said: by code before a kept order, a card or a question (`lostText`, `pipeline.ts`), and after the model's reply when the reply did not name it (`nameLost`, called in `turn.ts`). |
| 07:38 | A pin in Khraibeh (not served then): the reply listed all 25 villages we serve. | Proposed in `docs/MESSAGES.md` (area-out): never a list of villages. Khraibeh is served since FIX1 (0241). Stage 2. |
| 08:39 | «… ونسكافيه please و cafe mate …»: Nescafé asked as two buttons cut to «1. نسكافيه قهوة سريع» / «2. نسكافيه قهوة سريع»; «cafe mate» (Coffee-mate creamer, AK-0132, which we carry) asked as «which one?» over three Najjar coffees. | **Fix 2.** "cafe mate", "café mate", «كافي ميت», «كفي ميت», "coffeemate", "kafe mate" are Coffee Mate's words (0256). The rule, for every product (0256, `plan_order_core` wraps 0138's): a «which one?» never offers products when a word the customer said, which none of them explains (by its terms or its own name), names another product's brand (a word of a brand term) or kind (a whole kind term). That line becomes `not_found` with `b4 = 'other_kind'`, and code says PD1's honest answer (`honest.notCarried`). Sizes and describing words («صغيرة») keep their question (B1c). The picker as a list message is proposed (stage 2). |
| 08:45, 08:57 | Payment received sent as the Meta template `ak_payment_received_v1`, in Arabic, inside the 24-hour window, its amount «9.44$ نقداً». | Proposed (payment): a session message in the customer's language inside the window. Stage 2. |
| 08:52 | "Card AK-1063" typed by the website: the card went in Arabic (the chat's language) at 08:52:12, and the cron sent it again in English (the page's) at 08:52:15. | **Fix 3.** A card request is claimed before it is sent, by whichever comes first (`web_card_claim` for the cron, `web_card_again` for "Card AK-xxxx"; 0255); the card goes in the page's language either way. A "Card AK-xxxx" after the card went is the customer's own ask and sends it again. |
| 08:54, 09:06 | The feedback question and its thank-you in Arabic (it is Arabic for every customer). | Proposed (feedback). Stage 2. |

**The hours.** `settings.hours` is 09:00 to 21:00 (0255), the recorded decision (F15 9) the coordinator confirmed for the friends' test and
the shadow run. Rider shifts (`join.rider.shifts`, 08:00 to 15:30 and 15:30 to 23:00) are not changed: the founder sets them (STATUS, action c).

**`docs/ARABIC_REVIEW.md`.** The merge-conflict markers left by WH1a's merge are gone; both sides kept (the Applicants rows with UX3's
"RA 18 Nov" marks, then WH1a's section, then B1e's). A CX2 table lists the one new Arabic line.

**The proposal.** `docs/MESSAGES.md`: the rules before and after, and 26 messages (the card in five forms, the picker, the welcome, closed and
open, the hours, the area in and out, the location request, a location outside, confirmed, on the way, at the door, delivered, payment
received, the feedback question, the honest answer, a word not found, what fits a fact, the reminder, a lapsed card and reopen, the minimum,
the times, a person will answer), before and after, Arabic and English; then every other customer message with today's words. It is written
by `test/screens/cx2-doc.test.ts` from `test/screens/cx2-messages.ts`. The pictures: `test/screens/cx2.test.ts` draws each one as WhatsApp
does (bubble, buttons, a list message with its rows open, the location button), 390 px, Arabic and English: 104 images, on the console's
Screens page, session **cx2** (the `screens` workflow, run on the branch).

### Tested (free)
- `evals/cases/cx2_founder_chat.json` through `test/db/cx2-founder-chat.test.ts` (6 flows: the kafta kept while closed; a word not found
  named while closed; one named after the model's reply when open; "cafe mate" to Coffee Mate on the card; "nescafe vanilla" gets the honest
  answer, never a vanilla item; a reply that asked only about the labneh, and code names «نص كفوف»). All 6 failed on `main` before the fix.
- `test/db/web2-turn.test.ts`: "Card AK-xxxx" before the cron's minute sends one card in the page's language and the cron sends none; after
  the cron, the customer's own "Card" sends it again in the page's language. Both failed before.
- Changed on purpose: `test/db/concierge-flow.test.ts` (the loop's labneh question now has code's «ما لقيت «زنزلخت» عنّا.» after it: the
  reply did not name it); `test/db/ux2b-settings.test.ts` and `apps/console/test/ux2b-settings-page.test.ts` (the hours are 09:00 to 21:00);
  the message-rules snapshots (`honest.notFound`).
- `npm run typecheck` and `npm test`: see the pull request (the seven `test/pg` files need pgvector and run in CI only, as before).

### Not proven here
The fixes on staging (0255 and 0256 reach staging with the next `deploy-staging` from `main`); the live reading of the 07:37 voice note again.
No model was called in stage 1: the live language gate and the sim-test run once, at the end of stage 2.

### Founder action
Read `docs/MESSAGES.md` and the Screens page (session cx2) and reply in the chat with what to change. Stage 2 waits for that reply.

## Stage 2: the approved messages in the code (18 November 2026)

The founder replied "approved, with five changes", all applied: (1) the card's missing-item line «منسألك قبل ما نبدّل» / "We ask you before
swapping anything"; (2) 👑 retired (👋 greets); (3) every customer message in the new layout (order number bold, one emoji at the start of a line,
the 22 emojis only), a status answer and the notice for the same state the same words; (4) `windows.freshForWindow`: «طازة» / "Fresh" before each
product's own name, now from the quote (the database), never the customer's words; (5) restaurant and food messages untouched (FD2).
`docs/MESSAGES.md` is now the frozen record of the approval; the snapshots are the source.

| What | Where |
|---|---|
| The three packs restyled (staff `ops.*` unchanged): bold heading line, emoji at the start of a line, « · » before an amount, italic consent/privacy | `packages/agents/src/messages/{ar,en,fr}.ts`, `types.ts` |
| The card: one line per item with its amount, a totals block (items, delivery, fees, **total**, lira), sections 📍 ⏱️ 💵 🔁, buttons ✅ ✏️ ❌; a long basket's card says the items are in the message above | `order-card-text.ts`, `order-card.ts` |
| «Which one?» as a list message (short name, full name and price per row, up to ten); a line not found goes first as its own message | `choice.ts` (`listTitle`) |
| Out of area: a location request, never a list of villages | `answers.ts`, `pipeline.ts` |
| Feedback question and answers in the customer's language (`customer_language`) | `feedback.ts`, `turn.ts` |
| Notices: the free message first; the template only when the 24-hour window has closed (it went inside the window before) | `apps/gateway/src/index.ts` |
| On the way: the cash to have ready (`orders.total_usd`, as `rider_job`); the status answer says the same | `index.ts`, `answers.ts` |
| The website prints the card without WhatsApp's marks | `apps/web/src/lib/order.ts` (`plainWords`, `splitAmount`) |
| **0257**: `catalog_other_kind` (0256) failed on a plan line whose `candidates` is JSON null ("cannot extract elements from a scalar"); a non-array now counts as empty | `supabase/migrations/0257_cx2_other_kind_guard.sql`, a case in `test/db/cx2-founder-chat.test.ts` |

**Tests changed on purpose:** the message rules (22 emojis, one at the start of a line, the order number bold, amounts at the end after « · »;
staff messages keep M1's rules), the sim's rule checks (`evals/sim/checks.ts`), the three snapshots, and the flow tests and eval cases that pinned
old wording or a button picker. New: `packages/agents/test/cx2-stage2.test.ts`. `docs/ARABIC_REVIEW.md` lists every new Arabic line (CX2 stage 2).
`npm run typecheck` clean; `npm test`: all pass except the seven `test/pg` files (pgvector, CI only), which pass in CI.

**The model runs.**

| Run | Result | Spend |
|---|---|---|
| Language gate, first dispatch, run 44303688282 | **Stopped on the 0256 bug** before any score (the error above). No gate result | USD 0.011 |
| Language gate, run [44305776838](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44305776838) (after 0257): the one scored run | **holds**: wrong products **0** (precision 1.000), F1 **0.911** (B1e 0.913); ar_lb 0.919, arabizi 0.886, en 0.966, fr 0.932, mixed 0.930; zero-wrong 28 of 28; the 0.13 demo right | USD 0.197 |
| Sim-test, limit 50, budget 2, repeats 0, run [44303693502](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44303693502) (before 0257) | 50 judged, **23 passed**; **0 silences after a hand-off**, **0 replies in another language**, 0 message-rule breaks, 0 no-reply; **3 turn errors** (sim-006, sim-016, sim-028: the technical line on the turn after a correction, path `agent_error`), most likely the same 0256 failure 0257 fixes; not proven (the sim's copy of staging is not kept, and no second run was made) | USD 1.17 |

The gate was dispatched twice because the first stopped on a bug of this session before scoring; the sim-test once.

**Not proven here:** the new messages on a real phone (WhatsApp's own rendering of bold, italic, list messages and RTL amounts); the three turn
errors gone (the next sim-test or the founder's test shows it); the notices' free-message-first order with a real template outside the window.

### Founder test (CX2)
After `deploy-staging` from `main` has run, on the US test number, between 09:00 and 21:00 Beirut (the new hours; outside them the first
message gets the "closed, your order is saved" message instead, in the new layout):
1. **«بدي كرتونة مي تنورين ونسكافيه ونص كفة»** (typed or as a voice note). Expect: «which one?» as a list (tap *اختار*, each row a name with
   its full name and price), the kafta found (no silence about it), then the card: one line per item with its price, the totals block, the
   sections 📍 ⏱️ 💵 🔁 with «منسألك قبل ما نبدّل», the consent line in italics, and the buttons ✅ ✏️ ❌. Tap ✅ to confirm.
2. **«وين طلبي؟»** a minute later. Expect: 📦 with the order number in bold; when the test rider takes it, «🛵 *طلبك … عالطريق*» with the
   cash to have ready; after delivery the question «📦 *وصلك طلبك … مزبوط؟*» with ✅ / ⚠️, in the language you wrote in.
3. **«بتوصلو على صيدا؟»**. Expect: «📍 *لهلّق ما منوصّل على صيدا*» and the location button, with no list of villages.
Send back, per message, "as written" or what differed, with a screenshot.
