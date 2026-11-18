<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

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
