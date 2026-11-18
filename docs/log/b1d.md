<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### B1d: counts and edits, 16 November 2026 (Opus 5.5); no migration
Ordering lane, branch `claude/gracious-ptolemy-bk1ldr`, #97. The 25 wrong-product conversations of CX1's run on main ([sim-test
43781701377](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43781701377); B1c's run 43776071899 before it had 18), read one by one
into `evals/cases/b1d_counts_edits.json`: what was wrong, what must happen, and the test that holds it. Each class with failing cases first
(all 26 behaviour cases fail on `main`): `evals/test/b1d-counts.test.ts` (the readings, code only), `test/db/ordering-b1d.test.ts` (13 flows),
`evals/language/zero-wrong.json` (+2). Migration 0217 was not needed: the planner is unchanged; the fixes are in `packages/agents/src/`.

| Class (cases) | What B1d built |
| --- | --- |
| A count against a pack's measure (sim-008, sim-015, sim-135, sim-137; «٣ كيلو» sugar in run 43776071899) | `reading.ts`: a line that is only a weight or a volume («خمس غرام», «تنين وخمسين غرام», «واحدة وتلاتة مية ملل», "400 grams") joins the line before it; «مية» before a unit or after a number is a hundred, never water. `packSizeCount`: a number that is the chosen pack's own count of pieces with the count of packs said too («2 pocket wipes arba3in» is 2, not 40), or an end of the size range its name carries («١٦-٣٠ كيلو» of "16-30Kg" is a size), is not the count; `weightCount`: a count said in kilos of a pack of another weight is the nearest number of packs, at least one (3 kilo of the 5 kg bag is 1; of the 900 g bag 3). Applied after the plan and on the tap |
| «3tine», «wa7de tene» (sim-046, sim-023, run 43776071899) | «3tine», «عطيني» is "give me", never a count; «wa7de tene», «وحدة تانية», «X tenye» is one more; a line that starts with its count has that count («3 Snickers ...» carded as 2, sim-136) |
| A complaint or a question is not an edit (sim-023, sim-010, sim-093) | Without a word that says more («كمان», «زيد», «ضيف», "more", "add", «tenye», "encore"; said in the negative it does not count: «ma baddi zid shi»), a count said for a basket item is its count, never added; «X bas» at the end sets. A line that is a question («...هيك؟») is never asked as a product to choose (`choice.ts`) |
| A swap or a correction never doubles or drops a line (sim-107, sim-135, sim-042) | «3 Germex badal 2, w 1 Domo» keeps the 1 Domo; a size said («مقاس 5») never names the basket's product of another size (`basket.ts`, `sizeIn`); «ناقص» ("missing") never takes an item off; a complaint or a question that marks what to change is an edit made by code (before, the loop said «shilt el sukkar» four times and the sugar stayed); «Shilo» ("take it off") read as cancel never empties the basket: only words that cancel do |
| Out of stock never drops or adds an item unasked (sim-082, sim-145, sim-042) | `pipeline.ts`, `ownProducts`: when the planner chose a product the customer's words do not fit (`tied`), or asks only about others while the words fit one, the line is that one product: out of stock, the quote says so and the loop offers what is like it (before: «which one? • Chicken Legs» for the tenders; Gold Medal flour for Domo corn flour). When the words fit several («Deroni 3adas ahmar ... 900g»: the red and the green lentils; the planner chose Deroni's sugar), the line is asked with them. On the gate's 2,970 recorded readings with everything in stock, the planner never matched outside `tied`; eight right questions had two others in `tied`, so a question is replaced only when the words fit one |
| A product picker that loops (sim-137) | A message that is one product's full English name (a button's title sent back as words, «Toulkarem Pepperoni») is that product, never the same question again |
| An edit after the card (sim-032) | The edited basket replaces the card it came from (`state.editing`); «can I keep it like this?» answers with that basket, never the old card with the Pepsi taken off |
| The reading prompt | One line on counts (a number that is part of the size is never the count; «3tine», «wa7de tene») and one on questions about a count; the code above holds without them |

Not changed, and why: a brand with one product (sim-016 Gorosti, sim-140 Rim, sim-047 Coffee Joy) is still that product (B1c's rule; the judge
asks for a question: the founder may decide, one line in `plan_order`'s brand rule). sim-006: «طلعاية» does not search to Talaya (no Arabic
name on the product; a catalogue word, not a reading). sim-017 (one add left out) did not reproduce with any reading code can see. Seven of the
25 were the customer's own additions that the judge counted (sim-080, sim-109, sim-139, sim-143, sim-067, sim-010, sim-040).
**The gate counts these:** with about seven such conversations in each run of 150, "wrong products at most 8" needs the judge to stop
counting them or the simulated customer to stop adding.

**Tested here (CI, no key):** `npm run typecheck` clean; `npm test` green (2,402 passed, 111 skipped, on the follow-up merged with main).
**The language gate** (`language-pack` on the branch, "after" and "live"): first run ([43812039544](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43812039544)):
F1 0.909, the demo right, live evals 103 of 103, but **two wrong products**: hz0377 and g0377, «بدي خبز تنور العصر، مش الكبير، التاني تبع الخمس
رغفان», read in two lines with «مش الكبير» as a modifier, which the planner does not read, so the large loaf was chosen. A size ruled out
(«مش الكبير», "not the big one") now stays in the line's words, where the planner reads it and asks; a line that only points back with its pack
(«التاني تبع الخمس رغفان») joins the line before; both readings are in `zero-wrong.json`. **The gate holds** on the second run
([43813545023](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43813545023), head d9b0317): 990 readings, **F1 0.908, wrong products
0**, the 0.13 demo right, the live evals **103 of 103**.
**The simulated customers on `main`, run 1** ([sim-test 43824481535](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43824481535),
limit 150, budget USD 4, spent **$3.47**; main at 78e2011, #97 on top of PD1's #99), first attempts, against CX1's run and PD1's run on the
code just before B1d ([43819301131](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43819301131)):

| class | CX1 (43781701377) | PD1 (43819301131) | B1d run 1 | target |
| --- | --- | --- | --- | --- |
| wrong or uninvited product (judge) | 29 | 26 | **21** | at most 8: **not met** |
| goal not reached | 49 | 49 | **42** | no worse: held |
| unnatural dialect | 24 | 25 | **21** | held |
| repeated question | 13 | 20 | **13** | held |
| dead end | 15 | 17 | **10** | held |
| invented fact | 8 | 8 | **6** | held |
| wrong language (code) | 1 | 1 | **0** | held |
| message rules (code) | 2 | 2 | **4** | **not held**: three are B1c's house-default line quoting the customer's «٣ ربطات خبز» in Arabic-Indic digits (sim-069, sim-143, sim-045; CX1's run had one, sim-029), fixed in the follow-up; one is the restriction line at 126 characters (sim-002), an existing line PD1's run also had |
| passed | 89 | 87 | **93** | |

The 21, read: count doublings where a question or "also" was read as more (sim-051 «بدي بس اتنين ثوم، شو فيني زيد؟», 4 garlic; sim-036
«كمان بدي علبتين شاي», 4 tea), and a count of bottles or cans that is the pack's own («Rim 2L, 6 2anenne» became 6 six-packs, sim-140;
«تلات علب» of the three-can tuna pack became 3 packs, sim-043): all four fixed in the follow-up with failing cases first (`run3-` in
`b1d_counts_edits.json`). The customer's own additions the judge counted (sim-054 «كمان تنتين», sim-080, sim-052), a brand with one product
(sim-016, sim-047), swaps and edits the model read across several lines (sim-057, sim-021, sim-010, sim-079), night and window handling
(sim-067, sim-110, sim-139), a cancel during picking (sim-149) and sim-082 (the tenders now said out of stock; a later «not on Alo King»
line twice) make up the rest. **Wrong products 29 to 21 is not the target of 8**: about a third of each run is the customer's own additions
and readings spread over several lines that no code rule sees whole.

**B1d follow-up** (second pull request): «شو فيني زيد؟» ("what can I add?") and «كمان بدي X» ("also I want X") are not more of X, and «بدي بس»
wins over a "more" elsewhere in the message; bottles and cans of a pack of that many are one pack; the house default's line quotes the
customer's words as the question does (Latin digits, no amount, at most 40 characters; B1c's test that held the Arabic-Indic digits now holds
the Latin ones). Merged as #101; its language gate ([43827184655](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43827184655)):
F1 0.915, wrong products 0, the demo right, live 103 of 103.

**The simulated customers on `main`, run 2** ([sim-test 43829590880](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43829590880),
limit 150, budget USD 4, spent **$3.47**; main at 06309cb, #101):

| class | CX1 | PD1 | B1d run 1 | **B1d run 2** |
| --- | --- | --- | --- | --- |
| wrong or uninvited product (judge) | 29 | 26 | 21 | **30** |
| goal not reached | 49 | 49 | 42 | **48** |
| unnatural dialect | 24 | 25 | 21 | **27** |
| repeated question | 13 | 20 | 13 | **19** |
| dead end | 15 | 17 | 10 | **12** |
| invented fact | 8 | 8 | 6 | **5** |
| wrong language (code) | 1 | 1 | 0 | **0** |
| message rules (code) | 2 | 2 | 4 | **0** |
| passed | 89 | 87 | 93 | **92** |

**Done when, honestly:** the new cases pass (34 reading and pack cases, 14 flows); the language gate holds (F1 0.908 and 0.915, wrong 0,
live 103 of 103, on both pull requests). **Not met:** wrong products at most 8 (21 and 30 on two runs of the same code), and "no class worse
than CX1's run" holds on run 1 except message rules (fixed: 0 on run 2) but not on run 2 for three judge classes (wrong product +1, unnatural
dialect +3, repeated question +6). The judge classes move this much between runs of unchanged code (wrong products: CX1's code 25 and 29,
B1c's 23 and 18, B1d's 21 and 30; repeated question: CX1 13, PD1 20 on code B1d did not touch), so one run of 150 cannot show a change
smaller than about eight in a judge class. The code-checked classes (message rules, wrong language) are at 0.

Run 2's 30, read: none comes from B1d's new code (sim-029, sim-017, sim-099 checked against it); about ten are the customer's own counts or
choices the judge counted (sim-047, sim-078, sim-080, sim-110, sim-104, sim-017's own tap on the 5 kg sugar), three are a brand with one
product chosen (sim-016, sim-035, sim-047), and the rest are the loop's paths: an out-of-stock first message that drops the other line
(sim-099), a question that offers only what is in stock when the product the words name is out of stock (sim-029: «عدس أحمر دروني» asked
with only the green lentils; `questionsFor` filters the out-of-stock ones), the night and window flows (sim-014, sim-028, sim-040, sim-067,
sim-103), and Whish (sim-052).

**For the next ordering session** (B1e, or whoever takes wrong products next): (1) the judge cannot tell the customer's own additions from
the shop's: about a third of every run; either the simulated customer stops piling up counts to reach the minimum, or the judge is given the
basket after each turn (a measurement change, decided by the coordinator, not by the ordering lane); (2) a question whose in-stock candidates
leave out the product the words name exactly should say it is out of stock (sim-029); (3) an out-of-stock first message keeps its other lines
(sim-099); (4) a brand with one product (sim-016, sim-035, sim-047, three in each run): ask, or keep B1c's rule, is the founder's call; (5)
«طلعاية» needs an Arabic name or a search word for Talaya (sim-006). **A CI flake seen twice:** `openTestDb` in a `beforeAll` timed out at
10 s on the shared runner (extensions-schema, food-facts, console sign-in, image list; passed on re-run): worth `hookTimeout` 60 s for the
PGlite suites (CI lane).

**Session ended here, by instruction** (16 November): sim-test 43829590880 is the last run; no further sim-test or language-pack run was
started. Wrong products stay above 8 (21 and 30), so what is left is handed to **T1, the friends' test, as cases to measure** on real
customers. For each one T1's daily report counts how often it happens and whether the order was right in the end. The simulator cannot settle
these, because its judge moves by about eight between runs:

| # | Case to measure in the friends' test | What counts as wrong | Seen in |
| --- | --- | --- | --- |
| F1 | A count said for an item already in the basket: does the card carry the count the friend meant (set, not added) | a card count the friend corrects | sim-051, sim-036, sim-023 |
| F2 | A count that is part of the pack («6 قناني» of a six-pack, «32 حبة», «كيلو» of a 900 g or 5 kg bag) | packs × the pack's own count | sim-140, sim-043, sim-135, sim-017 |
| F3 | A product out of stock in the first message: said as out of stock, the other lines kept | another product put in its place, or a line dropped | sim-082, sim-145, sim-099 |
| F4 | A question by code whose in-stock buttons leave out the product named («عدس أحمر» when the red lentils are out) | a button for a product the friend did not name, tapped | sim-029 |
| F5 | A brand said alone with one product («بدي غوروستي»): taken as that product (B1c's rule) | the friend says it is not what they meant | sim-016, sim-035, sim-047 |
| F6 | An edit or a swap spread over a long message (two items changed, one added) | a line doubled, dropped or landed on another product | sim-057, sim-021, sim-010, sim-079 |
| F7 | A basket built up to reach the $5 minimum by several "add more" messages | the final card's counts against what the friend says they wanted | sim-080, sim-139, sim-143, sim-067 (the judge counts these against the shop) |
| F8 | A product name the catalogue does not know in Arabic («طلعاية» for Talaya) | a question that offers other products | sim-006 |
| F9 | Kept at night or for a later window: the counts and the window on the card in the morning | a count or a window the friend did not choose | sim-028, sim-103, sim-040, sim-110 |

Each row has the simulated conversations in `evals/cases/sim_judge_wrong_product.json` of runs 43824481535 and 43829590880 (artifacts) and,
where code changed, a case in `evals/cases/b1d_counts_edits.json`. Real orders replace the judge as the measure: an order is wrong when the
friend corrects the card or the delivered basket.
