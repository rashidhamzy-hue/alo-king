<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### B1c: wrong products, part 3, 15 November 2026 (Opus 5.5); migration 0138
Ordering lane, branch `claude/busy-babbage-exhw5e`. The 34 conversations B1b's second run on main (sim-test 43756167947) judged a wrong or
uninvited product, read one by one into `evals/cases/b1c_wrong_products.json` (20 cases, with what must happen instead), each class with a
failing test first. About six of the 34 were the customer's own additions (8 parsley after "add one more" four times); the shop's share was
four causes: a generic word or a brand picked as one product; the basket never shown at the minimum or at night, so customers said their items
again and each time they were added; an edit that landed on another product than the basket's; and a line dropped while another was asked.

| Fix | What B1c built | Tested by |
| --- | --- | --- |
| 1, generic words and sizes | 0138 `plan_order_core_0078`: a line whose best match names only the kind («ربطة خبز», «قنينة مي», «عدس», "wet wipes", «لبن») with more than one product fitting, or only a brand ("Pepsi", «نجار»), is generic: bought before, the model's phrase and the best seller no longer choose for it. Tied products of different sizes the customer did not tell apart (`catalog_size_of`) are the same. A brand with one product ("Snickers", «Gorosti») is that product. A short brand word heard inside other words («باك» in «سيكس باك بيرة» is Puck) with the customer's words left over is not found. `«تنتين ... ٢ ليتر»`: a count written before a unit of volume is the size, not the count (sim-139 chose the 6 L gallon). Each line returns `tied` (every product its words fit) and `pick` (`house`, `only`). **The house default**: `products.house_default` (data). Exactly one default among the products that fit best, leaving none of the customer's words or numbers unexplained and found by their own words, is given; the pin request says which («ربطة خبز»: حطّينالك ...); the minimum line and the card name it. **Proposed defaults** (0138 and `load_catalog.sql`), from the founder's own hand cases h0002 to h0006: Al Forno pita big (AK-0080), Najjar classic 180 g (AK-0133), Hawa eggs (AK-0049), Liban Lait labneh 450 g (AK-0046), Tannourine 2 L x6 (AK-0103). Otherwise **one question by code** (`choice.ts`): «X»: which one?, the products that fit (best fit, then the fastest sellers by velocity tier) with their prices, at most three buttons; the line's words, count and unit wait with it and the other lines stay in the basket; the tap re-plans that one line with the product chosen (`p_choices`). A question answered in words is dropped; one still waiting is asked again. A candidate out of stock leaves the line to the loop (it words the substitute) | `test/db/planner-b1c.test.ts` (27), `test/db/ordering-b1c.test.ts` |
| 2, a basket kept overnight | The night-kept line and the minimum line list the basket ("• 3 × name"), so the customer sees it. A count already in the basket said again («baddi ba3ten el 3», «شكلهن ما انضافوا، ضيفهن») is not added again, unless the customer says more («كمان», "more"); the tap in the morning sends the same counts (`sendKept` re-prices the kept lines unchanged) | `ordering-b1c` (sim-028's words at night, then the tap) |
| 3, same as last time | "Where is my order?" with no open order and nothing in hand, from a customer with a closed order, offers that order as one tap (`answer.noOpenRepeat`), never "no open order" alone. The simulator's past orders under today's $5 minimum were never created (create_order_from_quote refuses them), so sim-073 had no last order at all: `evals/sim/driver.ts` writes such a past order as rows | `ordering-b1c` (sim-073) |
| 4, hz0815 | B1b's gate run 43746499760 read «baddi bazella w jazar mkhalta, plein soleil» as «bazella» / «jazar» / «mkhalta, plein soleil»; 0133 joined only the line before the mixed word, so «bazella» matched the peas. 0138's wrapper joins back every neighbouring line that carries the span's words (two at most) | `evals/language/zero-wrong.json` (the reading, failing first) |
| Edits | `editsFromPlan`: a line names the basket's own product when its words fit exactly one product in the basket (`tied`: «1 wet wipes» is the Oui Oui, sim-021; «mortadelle 1 mech 2» the Tanmia, sim-025); by name or by search only when the words fit nothing; a product the customer named that is not in the basket is a new line («٢ كيس شيبس ماستر» never adds Dolsi, sim-143). Reading (`reading.ts`): «غيّر الكمية لتلاتة», «خليهن ٣» set the count (sim-121 made 4); «بدي بس ...» sets every count said (sim-052); «badal X» takes X off and «khalli bas X w Y» keeps X and Y (sim-065); "three ... thirty pieces" of a 30-piece pack is 3 packs (sim-003) | `evals/cases/reading_tidy.json` (+6), `ordering-b1c` |
| 5, Arabic | The four B1b rows of `docs/ARABIC_REVIEW.md` are marked "RA 15 Nov". B1c's five new or changed lines are a new section there, **not read by a person yet** | `arabic-review.test.ts` |

Files outside `packages/agents/src/` and `evals/`, and why: `supabase/migrations/0138_generic_words.sql` and `supabase/seed/load_catalog.sql`
(the planner, the column, the proposed defaults), `apps/gateway/src/turn.ts` (the tap on a question's button), `docs/ARABIC_REVIEW.md`, the
tests. The flow-test rig (`test/db/flow-kit.ts`, `oldPicks`) uses the labneh and bread the old flows were written for as its defaults; older
tests whose exact text now carries the basket list compare the words around it. No gateway allowlist, price source, order card, welcome,
cancel, pickup or confirmation path changed (CX1's).

**A clock edge seen in CI (not B1c's):** `handoff-ho1`'s 2-minute alarm test failed once on the first push (run 43766808241, 22:10 UTC):
it opens 00:00 to 23:59:59 Beirut and writes a message "3 minutes ago", which at 00:01 to 00:10 Beirut falls before midnight. It passes
at any other time. Worth a fixed clock in that test (hand-off lane).

**For the founder:** the five proposed house defaults are a guess from your own test sentences; change them with
`update products set house_default = (sku in (...))` (one per kind; two defaults among the same words mean the question). With none, the
customer gets the question.

**Tested here (CI, no key):** every row above; `npm run typecheck` clean, `npm test` green (2,130 + the B1c tests).
**The language gate, offline:** the 2,970 recorded readings of `results/after.json` replayed through the planner (`replay.test.ts`): main
F1 0.909, wrong 0; B1c **F1 0.909, wrong 0** (first cut 0.894: brand + an unknown word went not found, and the founder's own generic sentences asked; the brand rule was narrowed and the defaults proposed; two wrong products the replay found, g0151 and g0426, are in `zero-wrong.json`). The founder's demo h0013 («كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار») is right through the defaults.
**The live gate** (`language-pack` on the branch): [run 43766779770](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43766779770), 990 readings, F1 0.913, the 0.13 demo right, live evals 103 of 103, but **one wrong product**: g0370 «please send pain d'or khebez 3arabe, 900g» cut into «pain d'or» and «khebez 3arabe, 900g», whose bread line took the house loaf. The brand the message names now narrows what fits (as it narrows a tie); the reading is in `zero-wrong.json`. The second gate run ([43767961138](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43767961138)): F1 0.909, the demo right, live 103 of 103, one wrong product: g0958 «باكيت محارم مبللة وي وي، الأكوا» with «الأكوا» read as its own line, which the model's phrase (an older rule) and the brand-with-one-product rule took as Aqua's water; «اكوا» is a word of the Oui Oui wipes' own term («اكوا بيور»). Neither rule chooses now when a brand-only line's word belongs to another product the message names exactly (`zero-wrong.json`). **The gate holds** on the third run ([43769093717](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43769093717), head 67d367e): 990 readings, **F1 0.915, wrong products 0**, the 0.13 demo right, the live evals 102 of 103; the one miss is `addr-13nov-voice`, the voice-address variance B1a and B1b recorded (it passed in this branch's two earlier runs).

**The simulated customers on `main`, run 1** ([sim-test 43771268952](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43771268952),
limit 150, budget USD 4, spent **$3.48**; main at 2bd4080, #91; staging deployed with 0138 by run 43770384851):

| | B1b run 2 (#87) | B1c run 1 (#91) | target |
| --- | --- | --- | --- |
| wrong or uninvited product (judge) | 34 | **23** | at most 8: **not met** |
| lost baskets | 1 | **1** | 0: **not met** (below) |
| minimum-order loops | 0 | 0 | no worse: held |
| address / language / message rules / off-topic | 1 / 0 / 2 / 1 | 1 / 1 / 4 / 6 | no worse: **not held** for off-topic (6) and message rules (4) |
| passed | 80 | **88** | |

Read one by one, the 23: about six were the customer's own additions or a correct basket the judge still counted (13 mint after "8 ... ok
13"); the rest, by cause: (1) a question code asked kept being asked after the customer moved on (sim-083: «which cream?» six times after
"no cream, just the 4 Dove soaps"), and «add 2 more Dove cream bars» did not reach the Dove in the basket; (2) «مثلا ربطة خبز أو علبة تونة»,
«chocolate aw chips» (choices) put the house loaf or a third Kit Kat in the basket (sim-043, sim-040, sim-023); (3) the tap on a question
made «٣٢ حبة» 32 packs (sim-147); (4) readings: «wa7de tene» read as 2, a complaint («sar 5?») read as add 2, a swap; (5) a Gorosti still
flagged (one product of the brand, chosen and listed). The lost basket was sim-073: with the simulator's past order now written, «same as last
time» for a past basket under today's $5 minimum got **no reply** on the button and the loop's «it's ready» on the words. The six off-topic
lines were questions the reading called off-topic («fiyon ykouno bil masa?», «ma fi tjibouna?»), and the four message-rule turns model text;
neither path changed in B1c.

**B1c follow-up** (second pull request), each with a failing case first (`ordering-b1c`, "what the B1c run on main showed" and "fix 3 ...
under today's minimum"): a question the customer moves past is dropped, never asked again; a basket product named by its brand is that product;
the tap applies the pack-size count; choices («مثلا», «أو», «aw», "or" between two lines) are never put in the basket by code (the loop answers);
«same as last time» for a past basket that cannot go as it is (under the minimum, an item gone) is routed as any basket: the minimum line with its
lines.

Merged as #92.

**The simulated customers on `main`, run 2** ([sim-test 43776071899](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43776071899),
limit 150, budget USD 4, spent **$3.50**; main at 7eed5f4, #92, CX1's #90 merged before it; staging deployed by 43775235327):

| | B1b run 2 | B1c run 1 | B1c run 2 | target |
| --- | --- | --- | --- | --- |
| wrong or uninvited product (judge) | 34 | 23 | **18** | at most 8: **not met** |
| lost baskets | 1 | 1 | **0** | 0: **met** |
| minimum-order loops | 0 | 0 | **0** | held |
| address / off-topic | 1 / 1 | 1 / 6 | **0 / 1** | held |
| message rules | 2 | 4 | **5** | **not held**: 4 are B1c's question quoting the customer's digits (fixed below) |
| reply in another language | 0 | 1 | **15** | **not held, not B1c's**: CX1's welcome (#90) goes out in Arabic to English customers on turn one (sim-003, sim-022, sim-104, sim-150: «👑 أهلا فيك بألو كينغ! ...») |
| passed | 80 | 88 | **81** | |

**Not met: wrong products 18, against 8.** What the 18 are, from the judge's summaries: quantities read wrong by the model (a sugar «٣
كيلو» read as three 5 kg bags; «wa7de tene» as two; a complaint «sar 5?» as an add; tea 3 for 2; Kinder padded to 10) about 8; a swap or a
correction that doubled a line (salt, chicken legs) 2; a vague request answered by the one product of a brand or a reading the judge still
calls uninvited (Gorosti, «la7me») 3; an item dropped or uninvited on an out-of-stock path (sim-099's chicken filet, sim-145's flour) 2;
the customer's own additions the judge counted 2 (sim-045, sim-047); a product picker loop (sim-126) 1. The planner's generic and size
picks, the night basket's counts, edits landing on another product and «same as last time» no longer appear. What is left is mostly the
reading of counts and edits by the model: the next step is reading cases for counts («wa7de tene», «X kilo» against a pack's weight, a
complaint is not an edit) in `evals/cases/reading_tidy.json` and the language pack, then the same 150-run.

**The last B1c fix** (third pull request): the question quotes the customer's words with Latin digits, no amount, at most 40 characters
(message rules 1 and 7; sim-105, sim-029, sim-076, sim-126 of run 2). Test in `ordering-b1c`. Not run on the simulator again.

**For CX1 (or the session after it):** the welcome is sent in Arabic to an English customer's first message (15 of run 2's language flags). **Fixed by CX1 in #94** (sim-test 43781701377: wrong_language 1).
