<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### B1b: ordering fixes from the simulated customers, part 2, 15 November 2026 (Opus 5.5); no migration
Ordering lane, branch `claude/great-noether-rjhpx7`, pull request #85. SIM1's fixes 5, 6, 7 and 8 (`docs/SIM_REPORT_2026-11-15.md`), B1a's
reading leftovers, and the founder's Arabic of 15 November, each from a failing case first. No hand-off logic or minimum-order rule changed.

| Fix | What B1b built | Tested by |
| --- | --- | --- |
| 5, a first order without a pin | Coordinator decision 3. With a basket waiting on the pin, a typed village and a landmark are accepted (`acceptWithoutPin` in `pipeline.ts`). The village goes through the existing path (`village_in_text`, `resolve_place`); one we do not serve is refused as a pin outside is. The address becomes **a place said in words**: a `customer_places` row with the village, building, floor and the customer's own words and no coordinates, which the database already treats as deliverable (`place_is_locatable`, `confirm_order_checked`: directions of eight characters or more). So the confirm tap, an edit to the card and the next order take the usual path (the first branch run, 43746511047, showed the confirm tap asking for the pin again when the order had no place). **It is marked for a rider call:** the order's note carries `fixed.noPinNote` (staff Arabic: "no map pin, the rider must call the customer before leaving") and a `risk_flags` row (subject the order, rule `call_before_dispatch`, details `reason: no_pin`). The customer is told the rider will call (`fixed.noPinCall`). The flag rides with the card terms, and a card made again for an edit carries it by its note, so it is written when the card goes out after a phone number or an edit too. "I can't send a pin" with no village or landmark gets one short question for both (`fixed.askVillageLandmark`). A pin between villages takes the village the customer named before the pin when the pin is near it (`set_pin_village` checks the distance); otherwise one question with at most three buttons. A pin outside is still refused. The list of villages we serve wraps at 120 characters (it was one 257-character line) | `test/db/ordering-b1b.test.ts` (fix 5: 8 tests) |
| 6, the customer's language | `packages/agents/src/language.ts`: the conversation's language (`state.speech`: ar, arabizi, en, fr) is learnt from the customer's own words (typed, spoken), never from a tapped button's title (ours: often an English product name) or a pin's note. Once known, only clear words of another language change it: never "merci", "ok thanks" or the reading alone. Fixed messages for Arabizi are Arabic, as before. The ask loop now gets `reply_language` (Arabizi in Latin letters, Lebanese Arabic in Arabic script, English, French), and `REPLY_RULE` says to write in it. A voice note sets the language before a case's first line (sim-084) | `evals/cases/conversation_language.json` (14 conversations from the transcripts) and `evals/test/conversation-language.test.ts`; flow tests; `messages-m1` updated (clear Arabizi after French now switches to Arabic) |
| 7, message rules in model text | `shapeModelText` (`output-guard.ts`), applied to `reply` and `ask_location_pin` before the guard. Arabic-Indic digits become Latin digits. An emoji outside the allowed set is dropped. A line over 120 characters is split into its sentences, one per line. A sentence still over 120 is refused (`too_long`, the hint now says 120), so the model rewords it. Approved Arabic product names fold their digits too (`productName`), so the card and price lines show Latin digits | `packages/agents/test/model-text-b1b.test.ts` (every model draft of `evals/cases/sim_message_rules.json` that broke a rule is shaped or refused); flow test |
| 8, greetings and thanks | 24 cases added to `evals/cases/off_topic.json` first (SIM1's and B1a's own words; the two older bugs among them). `packages/agents/src/courtesy.ts`: after an off_topic reading, a thank-you or goodbye gets one fixed closing line (`fixed.welcome`). A greeting ("kifkon?", «مرحبا كيفك؟ شو أخبارك؟») takes the greeting path. Shopping for a dish («بدي أغراض لمجدرة»), an address said in answer to the house question (sim-021), or a village alone (sim-121) goes on, never to the off-topic line. Chat about the assistant itself stays off-topic. The live off-topic eval now judges the system's decision (reading, then this check) | `evals/test/off-topic.test.ts` (every off-topic case still off-topic; every B1b case not); flow tests |
| B1a's leftovers | `packages/agents/src/reading.ts`, applied inside `extractOrder`, so the turn, the live evals and the language gate read the same: «البناية البيضا» / "el binaye bayda" / "the white building" is the building, never eggs (an egg line said outside the phrase stays); add versus set («ya3ni 7», "so total 7", «مش ١ بس» are set; «3 kman» is add); a size-only line («l 2annine l z8ire») joins the line before it, in its words, never its search words (g0752, added to `evals/language/zero-wrong.json`). The pack-size check (`packSizeQty`) runs after the planner: "30 حبة" of a product whose own name says 30 pieces is one pack (sim-147), and the plan is made again | `evals/cases/reading_tidy.json` and `evals/test/reading-tidy.test.ts` (18); `zero-wrong` replays readings through `tidyReading`; 4 live cases in `evals/cases/basket_edits.json`; flow tests |
| 10, the founder's Arabic | The nine strings approved on 15 November are in `ar.ts` (support.opened, reminder, stillOnIt, resumed, resolved, voiceNoteAsk, capMenu, browseButton; basket.cancelButton). Every row of the HO1 and B1a sections of `docs/ARABIC_REVIEW.md` is marked "RA 15 Nov". B1b's new Arabic lines (four, and the wrapped village list) are in a new section, **not read by a person yet** | `arabic-review.test.ts`, the message snapshots |

The simulator report gains "Address, language, message rules, off-topic (B1b measures)" (`evals/sim/b1b-measures.ts`), against SIM1's counts
on the same definitions, recomputed by code from run 43696512658's recorded replies: **first 150 scenarios: address 8, language 14, message
rules 70, off-topic 16**; all 463 judged first attempts 28, 51, 246, 55. Target: each down 80% (at most 1, 2, 14 and 3 of 150).
- Address: the pin asked for again after the customer said they cannot send one or gave the address in words; "which village?" asked when
  the customer had already named one of the villages offered, or asked twice; "a first order needs a pin". A pin request repeated after an
  item was added is the basket still waiting, and "which village?" asked once with no village said is the one short question the coordinator's
  decision allows: neither is counted.
- Language: a reply the code check calls another language, recomputed with this tree's check (`evals/sim/checks.ts`), which B1b corrected.
  It dropped every digit before reading a message, so Arabizi «l2it» became "l it" and was read as English "it"; it counted English product
  names on an Arabic card or a price list; and it knew no Arabizi word without a digit («Shu baddak»). SIM1's run had counted 21 and 69 with
  the old check.
- Message rules and off-topic: as SIM1 counted them (the code check; the off-topic line outside the off-topic scenarios).

**For L1 (no migration here):** an order without a pin is marked by its note and a `risk_flags` row (`call_before_dispatch`), and its place is
a `customer_places` row with no coordinates. None of these is a field the rider's job card or the dispatch board reads yet. L1 should add one,
e.g. `orders.call_before_dispatch boolean` (or read "place without coordinates" as the same), and show it on the job card and the console's
order page; dispatch should not offer such an order to a rider before the call is logged. Until then ops sees it on the order's note and in
`risk_flags`.

Files outside `packages/agents/src/` and `evals/`, and why: `apps/gateway/src/turn.ts` (the language is learnt per message, the ask loop's
`reply_language`, the village said before a pin), `docs/ARABIC_REVIEW.md` (fix 10), the tests. No migration, gateway allowlist, price
source or confirmation path changed.

**Not done in B1b, and why:** a generic word («ربطة خبز») picked as one product, wrong sizes from the planner, and a kept overnight basket's
counts are B1c's (they need `plan_order` and `sendKept`). Fixed messages for Arabizi customers stay in Arabic script: the code check accepts
it, and an Arabizi message pack is new copy for a person to write and read. The judge's "unnatural dialect" may still flag it.

**Tested here (CI, no key):** every row above; `npm run typecheck` clean, `npm test` green (2,070 tests).

**The language gate holds** (`language-pack` on the branch, head 980e4c7): [run 43750105245](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43750105245),
990 readings, **F1 0.911, wrong products 0**, the 0.13 demo right, the live evals **97 of 97**. The first gate run (43746499760, the first
head) had one wrong product, hz0815 «bazella w jazar mkhalta», the reading M1's runs flagged before (B1b's corrections do not touch a
three-line reading). It also had three live misses: a reading sent as the bare word "greeting" (now read), the gluten wording and the
13 Nov voice address (both model variance seen before). The second (43748065821) and third runs were clean.

**Two branch runs** on the 36 conversations that failed these classes in B1a's last run (sim-test 43746511047 and 43748069612, $0.84 and
$0.85) found what the first code missed. A typed address with no place made the confirm tap ask for the pin again, so it is now a place
said in words. Other finds: more ways of saying thanks or asking after a person; a French customer read as Arabizi («Ah il ...»); and two
faults in the simulator's language check (above).

**The simulated customers on `main`** ([sim-test 43751120408](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43751120408),
limit 150, budget USD 4, spent **$2.82**; main at 40e2ff7, PR #85), against SIM1's first run on the same 150 scenarios:

| | SIM1 (first 150) | B1b on main | target |
| --- | --- | --- | --- |
| address (fix 5) | 8 | **1** | at most 1: **met** |
| reply in another language (fix 6) | 14 | **0** | at most 2: **met** |
| message rules (fix 7) | 70 | **0** | at most 14: **met** |
| off-topic line outside its scenarios (fix 8) | 16 | **8** | at most 3: **not met** (follow-up below) |
| passed | 35 | **93 (62%)** | |

B1a's measures, against its third run (43736730998): minimum-order loops 0 (0), lost baskets 0 (0), wrong or uninvited product (judge)
32 (34): **no worse**. No code check failed on any turn: no message rule, wrong language, no reply, turn error or silence after a
hand-off (24 hand-offs, 24 alerted). The judge's classes: goal not reached 50, wrong product 32, unnatural dialect 32, repeated question
24, dead end 14, invented fact 9.

The 8 off-topic conversations, read one by one, had four causes:
- a greeting with one word more («مرحبا، كيفكن؟ شو أخباركن اليوم؟», "kif el 2ata3 el yom"): 3;
- a tap on a button the Concierge itself offered ("Eh, hayda", "Rje3 3al taleb", "Ehke ma3 7ada"), whose few words the reading
  called off-topic: 3;
- "when will someone answer?": 1;
- a thank-you of 19 words: 1.

The follow-up pull request adds the six texts to `evals/cases/off_topic.json` first. A message that opens with a greeting is a greeting,
a tap on our own button is never off-topic (`turn.ts`), someone from the shop is on the job, and a thank-you may be 20 words.
Merged as #87; its language gate ([run 43754517550](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43754517550), second attempt):
F1 0.914, wrong products 0, the demo right, every live case passing. The first attempt missed only `addr-13nov-voice`, the model variance
above.

**The second run on `main`** ([sim-test 43756167947](https://github.com/rashidhamzy-hue/alo-king/actions/runs/43756167947), limit 150,
budget USD 4, spent **$3.02**; main at 9848932, #87), against SIM1's first run on the same 150 scenarios:

| | SIM1 (first 150) | run 1 (#85) | run 2 (#87) | target |
| --- | --- | --- | --- | --- |
| address (fix 5) | 8 | 1 | **1** | at most 1: **met** |
| reply in another language (fix 6) | 14 | 0 | **0** (the run's report: 3) | at most 2: **met** |
| message rules (fix 7) | 70 | 0 | **2** | at most 14: **met** |
| off-topic line outside its scenarios (fix 8) | 16 | 8 | **1** | at most 3: **met** |
| passed | 35 | 93 | 80 | |

The run's own report counted 3 replies in another language. All three were the check misreading the right language:
- an Arabic basket line led by a bullet («• 1 × Oui Oui Diapers ...»), whose English name the check counted;
- a French reply that named "900G" and "x2" (counted as Arabizi);
- a French reply in words the check did not know.

The third pull request corrects the check (bulleted lines, sizes, more French words; tests in `evals/sim/test/b1b-measures.test.ts`). It
recomputes both runs and SIM1's baseline from their recorded replies with the same code: SIM1 stays at 14 (first 150) and 51 (all),
and run 2 is 0. The 2 message-rule conversations were the customer's own digits in a card line's words («٥٠٠ مل، ١٢ قنينة»); the card
now shows Latin digits for a line's words and the address (`order-card.ts`, test in `packages/agents/test/model-text-b1b.test.ts`).
The off-topic one left is "Vous pouvez pas la ramener quand meme?" about a product we do not sell, which is fair to call off-topic.

B1a's measures on run 2, against its third run (43736730998): minimum-order loops 0 (0), wrong or uninvited product (judge) 34 (34),
lost baskets **1** (0). The one is sim-073, a "same as last time" scenario: «آخر طلبية كانت من خمس ايام، مش مسجلة عندكن؟» ("my last
order was five days ago, isn't it recorded?") was read as "where is my order", and the status answer "you have no open order" was
given. No basket was in hand. It is B1a's class "same as last time with no earlier order" (its first run's sixth); B1b changed neither
the status answer nor the repeat path. Passed fell from 93 to 80 between the two runs on the same code paths. The judge's classes
(goal not reached 51, wrong product 34, unnatural dialect 34, repeated question 29, dead end 19) moved with model variance, not with a
B1b change. No silence after a hand-off (26 hand-offs, 26 alerted).

**Not proven:** WhatsApp and Kapso; a rider or ops actually calling the customer of an order without a pin (the note and the flag are
written; nothing reads the flag yet, see "For L1"); the Arabic of B1b's four new lines, read by a person.
