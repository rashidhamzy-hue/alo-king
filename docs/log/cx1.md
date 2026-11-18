<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### CX1: the customer pack, 16 November 2026 (Opus 5.5); migrations 0143 to 0146
Customer lane, branch `claude/gallant-carson-s6c89y`. `docs/strategy/02-journeys.md` section 1 and `03` section B. The words are in
`packages/agents/src/messages/` (`cx`, and six `ops` lines for the rider); the logic is `packages/agents/src/customer-pack.ts` and the four
migrations; `apps/gateway/src/turn.ts` and `ops-turn.ts` call them. No website or console screen changed (design is paused).

| Item | What CX1 built | Tested by |
| --- | --- | --- |
| The first-ever welcome | On a customer's first message ever (no earlier message, no order: `claim_welcome`, 0143), before anything else: what we do, the hours (`service_info`), three buttons (Order, Browse, Do you deliver to me?) and one privacy line. The privacy line's exact words, the language and the message it answered are kept per customer in `customer_welcomes`: that is the record of the consent the line carries. It is not the transactional opt-in (still the customer's own Confirm tap) and not a marketing opt-in. A first message that only says hello is answered by the welcome alone (no model call); one that already orders gets the welcome, then its card as usual; STOP gets none. Customers who wrote before CX1 never get it. Switch: `settings.welcome.enabled` (on) | `test/db/customer-pack-cx1.test.ts`, `customer-pack-flow-cx1.test.ts` |
| The card's two choices | The card now says what happens if an item is missing ("we ask you" by default). The card keeps WhatsApp's three buttons, so the choices are one tap away in the answer to Confirm: that answer is now one list (the same words as before as its body) with rows: closest match / ask me / take it off; for cash, "exact amount" and the notes above the total (`settings.card_choices.notes_usd`); "keep the change as credit"; and Cancel. Still one message. `set_order_choice` (0144) takes a tap only from the order's customer: the missing-item choice until picking starts, the note until the order is handed over. **At the shelf** (`pick_decide_missing`, copied from 0107): "take it off" removes the line with no question; "closest match" keeps the closest substitute the database already allows (same kind, in stock, never dearer on a paid order, never anything when the customer has stated restrictions) if it costs at most `best_match_max_extra_usd` ($0.50) more, otherwise the line is taken off; "ask me" is the old behaviour. The customer hears what changed once, with the shelf message. **Keep the change** (`rider_collect`, copied from 0006): the rider gives no change (their drop card says so); the note is booked, the order's own lines stay exactly its total, and the rest goes to the customer's credit account in one balanced transaction | SQL and flow tests above; the console's pick page and the ops line say "kept for the customer" for a closest-match swap |
| Self-service cancel | `customer_cancel_order` and `cancel_terms` (0145); `handle_order_button`'s Cancel goes through them. Before picking starts (no pick session: D4b's queue and the ops line both start one) and before a rider accepted: the tap cancels, the stock goes back, a rider's open offer is withdrawn, and anything paid becomes credit (goods, fee, small-order fee). "Cancel my order" in words (Arabic, Arabizi, English, French; `cancelWords`) about a confirmed order gets what a cancel gives back and one button. After picking started: nothing is cancelled by the tap; the customer is told plainly, with **the exact refundable amount** for a paid order (goods whose storage zone can go back on the shelf, `settings.self_cancel.returnable_zones`, plus the fee while the order has not left the hub) and the lines that cannot, and a case opens for a person (B1a's path). On its way: a person. A scheduled order keeps its cut-off (0040) | SQL and flow tests; B1a's cancel test now expects the new line |
| Handover code | A four-digit code made by the database when a prepaid order is confirmed or waits for its transfer (`orders.handover_code`, trigger, 0146); `orders.handover_required` marks a gift order for SH1. The code is under the answer to Confirm. At the door the rider's Delivered tap is refused until the code is typed (`rider_delivered` raises `HANDOVER_CODE_REQUIRED`; the ops line asks for it; `rider_handover` checks it; `rider_code_pending` finds the order). Five wrong tries lock it and raise `handover_locked` for ops. The drop card says a code will be asked | SQL tests and an ops-line test (tap Delivered, wrong code, right code, closed) |
| Pickup at the hub | `quote_order` already quoted a pickup with no fee. Added: where to collect, as data (`settings.pickup`: off, no place, until a person names it; `pickup_place()`); the card names the place; "I'll pick it up" in words (`pickupWords`) turns the basket in hand, or the card waiting for its tap, into a pickup card (`switchToPickup`, through `resumeBasket`); "ready for pickup at ..." is a customer notice (`customer_notices_due`, kind `pickup_ready`); `hub_handover` (picker or ops lead) checks a prepaid order's code, or records cash received and change given into the hub's till (booked through `post_cod_collection`, then moved to `hub_cash`), and closes the order. No delivery fee, nothing to a rider | SQL tests (fee 0, notice, till, code) and a flow test (off: one line; on: the pickup card) |
| At most four messages per order | `claim_order_message` (0143) before every message code starts about an order: `sendCodeStarted` (the shelf, the substitute question, delay, call-off, on the way, rider at the door), the gateway's notices (cancelled, at the door, payment received, pickup ready) and the feedback card. One the customer must act on or must know (`settings.message_budget.essential`) always goes; anything else goes only while the order has had fewer than four. A refused one is written to `agent_runs` (reason `over_budget`); a refused feedback card is not asked again. A normal cash order uses three (on the way, at the door, feedback); a prepaid one four (payment received too). The new CX1 lines add none: the code rides with the confirmation, the choices are the confirmation | SQL test of the budget |

Files outside `packages/agents/src/` and the migrations, and why: `apps/gateway/src/turn.ts` (the welcome, the confirmation list, the choice
and cancel taps, the words), `apps/gateway/src/ops-turn.ts` (the rider's code at the door; the closest-match line to the picker),
`apps/gateway/src/index.ts` (the notice budget and the pickup notice), `apps/console/src/pages/pick.ts` (one result line, no layout
change), `test/db/harness.ts` (the welcome is off unless a test asks for it, so older tests' fresh customers are answered as before;
`evals/sim/world.ts` turns it on), `test/db/hub-kit.ts` (a prepaid order is delivered with its code), two assertions in `basket-b1a` and
`ordering-b2` (the new cancel line; the confirmation is a list). No reading, planner (`plan_order`) or kept-basket code changed (B1c's).

**Not built, and why.** The console has no field for the handover code or for a pickup handover (design is paused): "act for a rider" on a
prepaid order is refused with `HANDOVER_CODE_REQUIRED`, and a pickup is handed over by `hub_handover` only from SQL until UX2 adds the two
forms (the functions are tested). Gift orders: nothing sets `handover_required` until SH1. A `pickup_ready` utility template does not
exist, so after 24 hours that notice is skipped and recorded (as every notice without one is). The note choice is in dollars only.

**Not proven here.** WhatsApp and Kapso (a list under the confirmation on a real phone; the welcome's buttons); a rider typing a code on a
real phone; the Arabic, read by a person (`docs/ARABIC_REVIEW.md`, "CX1"); 0143 to 0146 on staging.

**The gates.** The language gate holds on the merged code ([language-pack 43766716990](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43766716990),
second run; CX1 changes no reading code): 990 readings, **F1 0.914, wrong products 0**, the 0.13 demo right, the live evals **103 of 103**. The first
run (43765862681) had one wrong product (`g0958`, «الأكوا» read as a second line) and the known `addr-13nov-voice` miss, both model variance.

**The simulated customers on `main`** ([sim-test 43772497024](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43772497024), limit 150,
budget USD 4, spent **$3.53**; main at 5d43392, #90), against B1c's run on the commit just before it ([43771268952](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43771268952),
2bd4080, $3.48), the same 150 scenarios, all judged in both:

| class | B1c (before CX1) | CX1 on main | what it was |
| --- | --- | --- | --- |
| wrong_language (code) | 1 | **15** | **New, CX1's**: all 15 were the welcome in Arabic to an English (12) or French (3) customer whose first message was a voice note. The welcome was sent before the note was read. Fixed in the follow-up pull request (the welcome now goes once the turn's words, typed or spoken, are read); tests: the first voice note in English and in French |
| message_rules (code) | 4 | 8 | B1c's «...»: أي واحد بدك؟ question quoting the customer's Arabic-Indic digits (sim-147, sim-099, sim-014); not CX1's code; B1c fixed it in #93 |
| turn_error, no_reply (code) | 1, 1 | 0, 1 | |
| judge: goal not reached, repeated question, dead end | 50, 28, 25 | 45, 18, 15 | |
| judge: unnatural dialect, wrong product, invented fact | 33, 23, 10 | 37, 25, 13 | model variance on the same code paths (CX1 changed no reading, planner or model text) |
| passed | 88 | 70 | the 15 welcome conversations fail on their first turn |

Silences after a hand-off: 0 (25 hand-offs, 25 alerted). Address 0, off-topic 3, minimum-order loops 0, lost baskets 1.

**The follow-up's own run on `main`** ([sim-test 43781701377](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43781701377), limit 150,
budget USD 4, spent **$3.47**; main at 861788a: CX1, the welcome fix #94 and B1c's #93), the same 150 scenarios, all judged:
**no new failure class; CX1's "Done when" is met.**

| class | B1c (before CX1) | CX1 + fix on main | note |
| --- | --- | --- | --- |
| wrong_language (code) | 1 | **1** | back to B1c's level; the one left (sim-138) is the memory opt-out line in Arabic to an English customer, not CX1's |
| message_rules (code) | 4 | **2** | sim-029 (another line, «...»: حطّينالك ..., still quoting the customer's «٤ ربطات خبز» in Arabic-Indic digits; B1c's #93 fixed the question line only) and sim-138 (the same opt-out line, 125 characters); neither is CX1's |
| turn_error, no_reply (code) | 1, 1 | 0, 0 | |
| judge: goal not reached, repeated question, dead end | 50, 28, 25 | 49, 13, 15 | |
| judge: unnatural dialect, wrong product, invented fact | 33, 23, 10 | 24, 29, 8 | the same classes as before; wrong product varies run to run (23, 25, 29) on code CX1 did not change |
| passed | 88 | **89** | |

Silences after a hand-off: 0 (22 hand-offs, 22 alerted). Address 0, off-topic 1, minimum-order loops 0, lost baskets 0. Seen by the judge, for a
later session and not a new class: a first message that asks for a person gets the welcome above the hand-off line (sim-007, sim-018, both
Arabizi; the welcome is by design first on a first message ever, and Arabizi customers get Arabic script throughout, as before CX1).

**The simulated customers after pull request 1** ([sim-test 43814118255](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43814118255),
main at 2d10ca1 (#96), limit 150, budget USD 4, spent **$3.47**), against CX1's final run (43781701377), the same 150 scenarios, all judged:
**no new failure class.**

| class | CX1 + fix on main | PD1 (1) on main | note |
| --- | --- | --- | --- |
| passed | 89 | **90** | |
| silences after a hand-off | 0 (22) | **0** (26 hand-offs, 26 alerted) | |
| message_rules (code) | 2 | **0** | |
| wrong_language (code) | 1 | 1 | sim-014, an English line in an Arabic conversation after a swap; not PD1's |
| turn_error (code) | 0 | 1 | sim-014 turn 11, an edit («السكر الكبير 5 كيلو شيلوه من الطلب»): the class existed before (B1c: 1); no PD1 path in that turn (no fact asked, no honest answer); left to B1d |
| judge: goal not reached, repeated question, dead end | 49, 13, 15 | 51, 19, 11 | run-to-run variance on code PD1 did not change |
| judge: unnatural dialect, wrong product, invented fact | 24, 29, 8 | 23, **26**, **6** | |

**The gates on `main` after all three pull requests** (main at 0c78a19, #99):
- **Language gate** ([language-pack 43819297527](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43819297527), step "after",
  USD 0.19): 990 readings, **F1 0.917, wrong products 0**, the 0.13 demo right. **Holds.** The live evals step: **102 of 103**; the one miss
  is `addr-13nov-voice` (a village read from a voice note), the known model-variance miss CX1's first run also had; PD1 changed no reading
  code. The run is red only for that step.
- **Simulated customers** ([sim-test 43819301131](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43819301131), limit 150, budget
  USD 4, spent **$3.49**): passed 87; **silences after a hand-off 0** (25 hand-offs, 25 alerted); turn errors 0; wrong language 1 (sim-114,
  the memory line in Arabic to an English customer, as in CX1's run); message rules 2 (sim-122, the restriction line quoting a long
  Arabizi phrase, 121 characters: an existing line, not PD1's); judge: goal not reached 49, wrong product 26, unnatural dialect 25,
  repeated question 20, dead end 17, invented fact 8. **No new failure class** against CX1's run and PD1's first.
- **Not run: the enrichment run** (`enrich`, cap USD 15) and every staging proof, because staging cannot deploy (founder action 0).

### Founder actions (CX1)
- Pickup stays off until the hub's place is named. When it is: Supabase, SQL editor on staging, run
  `update settings set value = '{"enabled": true, "place_ar": "<the place in Arabic>", "place_en": "<the place in English>"}' where key = 'pickup';`
  (a place a customer can find, e.g. the building and the street; never a private address).
- The Arabic lines of CX1 wait for a reader (`docs/ARABIC_REVIEW.md`, "CX1"), the privacy line first: its words are what each new customer agrees to.
