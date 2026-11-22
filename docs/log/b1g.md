# B1g: the "Al Forno bread" miss (20 November 2026)

Branch `claude/busy-maxwell-7822b3`, pull request [rashidhamzy-hue/alo-king#153](https://github.com/rashidhamzy-hue/alo-king/pull/153). Migration
**0268** (the number the prompt gave). Decisions: `docs/DECISIONS.md`, "B1g, the "Al Forno bread" miss, 20 November 2026" (six rows). Nobody
was asked. No write to orders, payments, stock or the ledger; no new agent; Kabsi and PERF1's photo and storage work not touched.

## 1. What happened, read from staging
The probe sends the same words every hour: «بدي كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار، عبعقلين». Read on staging (`agent_runs`,
`order_items`, `language_pack`, `product_aliases`; the planner `plan_order_core` rerun read-only with the probe's own reading):

| When (UTC) | Reading's query | Path | What the customer saw | Order |
|---|---|---|---|---|
| 19 Nov 13:02, 15:04, 17:07 | «خبز الفورنو» | `ask` (the model's tool loop, 2 to 4 calls) | the Al Forno pita added | AK-1074 to AK-1076 with AK-0080 |
| 19 Nov, most other hours | «خبز» or «خبز الفورنو» | `which` / `ask` | three other breads, or «لسّا ما عنّا ربطة خبز الفورنو» | — |
| 20 Nov 07:17 | «خبز الفورنو» | `ask` | «ربطة خبز الفورنو ما عنّا» (the model), **while the card AK-1077 carried AK-0080** | AK-1077 with AK-0080 |
| 20 Nov 08:19 | «خبز الفورنو» | `ask_pin` (code) | «لسّا ما عنّا ربطة خبز الفورنو» | AK-1078 without bread |
| 20 Nov 09:22 to 18:40 | «خبز» | `which` | Wooden Bakery 400 g, Wooden Bakery 800 g, Tannour El Asser; the probe takes the first | AK-1079 to AK-1088 with Wooden Bakery |

Nothing changed between the two days: AK-0080's name and words date from 16 November (the names approval and the search-words job, version
`auto-2026-11-16`); stock was 4,941; it was orderable throughout.

## 2. Why
- **The planner never found it.** With «خبز الفورنو» the search's best item for the brand word was the Al Forno **piston** AK-0083
  (brand only, «خبز» unexplained), and the breads that fit «خبز» left «الفورنو» unexplained; CX2's guard (0256/0257, b4 `other_kind`) read
  «الفورنو» as another product's brand and made the line "not carried". With «خبز» the brand was ignored and three other breads were asked.
- **Why the brand word missed the pita: data.** The job writes brand words item by item. On AK-0083 it wrote «الفورنو», «فورنو», "forno";
  on AK-0080 only "al forno", "alforno", «آل فورنو», «ال فورنو» (two words, from the approved Arabic name «آل فورنو خبز بيتا…»). A customer's
  one-word «الفورنو» does not complete the two-word term. The seed pack (0054) had it right; the job's run replaced it on staging.
  **45 brands** on staging have an item missing a brand word another item of the brand holds (`brand_word_gaps()`).
- **Why the 19th "found" it: the model.** On the `ask` path the model searched again with its own words and added AK-0080. That rescue was
  model variance: sometimes it found it, sometimes it said «ما عنّا» while adding it, and when code answered the turn (`ask_pin`, `which`)
  nobody rescued it.
- **Not the cause:** the B1f and WEB4b brand-word clean-ups (checked below), a ranking tie, or the "not carried" guard alone.

The same fault elsewhere, found by running the planner read-only on staging: «رب البندورة اليماما» ("not carried": «اليماما» only on the
vinegar AK-0209, not on the two tomato pastes), «صدر دجاج التانمية» ("not carried": «التانمية» only on a mortadella), «لبنة ليبان»
("not carried").

## 3. Eval cases first
`evals/cases/b1g_brand_and_type.json` (staging's names and words for Al Forno, Yamama and Tanmia, exactly as read) and
`test/db/b1g-brand-and-type.test.ts` (15 tests). Before 0268 (same file, `without: ["0268"]`) the fault shows as on staging: «خبز الفورنو»
not found (`other_kind`), «خبز» offers no Al Forno, Yamama's paste and Tanmia's breast "not carried". The cases: the probe's two readings
(AK-0080 chosen or first, every row Al Forno), "Al Forno bread", «خبز الفورنو», "al forno pita" (chosen), «خبز» alone (a question, every row
bread, never "not carried"), «رب البندورة اليماما» (pantry: a Yamama tomato paste, never the vinegar or molasses), «صدر دجاج التانمية»
(chicken: a Tanmia fillet, never the mortadella or luncheon); added after the sim-test, «تلاتة مرتديلا بقر مع زيتون من تنمية» (cold cuts: Tanmia's mortadella with olives, never Al Mouna's). Seven failed before the fix (the eighth failed before its own fix).

## 4. The fix (0268)
1. **A spelling of the brand belongs to every item of the brand.** A brand term is a spelling when every word's consonant skeleton
   (`brand_skeleton`) is one of the brand name's or of a brand term most of its items already hold: «الفورنو» = «ال فورنو», «اليماما» =
   «ياماما», «التانمية» = «تنمية». "pepsi max", "tanmia chicken", "yamama tomato", «تنمية فراخ», "metro" on Ulker are product words, never
   spread. Shared once for every brand, and again on every `save_search_words` (the job cannot split them again). Preview on staging (read
   only, the same rule as SQL): 43 brands gain 381 rows, every one a spelling of its brand (Plein Soleil 76, Tanmia 52, Deroni 51,
   Candia 31, …, Al Forno 3: «الفورنو», «فورنو», "Forno" on the pita).
2. **Never "not carried" while the brand or type is sellable.** The guard now looks up what the word names (the sellable items of that
   brand; the owners of that kind word): one that alone fits the line's other words is chosen (the line planned again with it); more, a
   «which one?» of those that fit (b4 `named_other`); none fits, all of them. Only when nothing it names is sellable does "not carried"
   stand. Shown separately: with the brand's words split again, the guard alone still asks with the Al Forno breads.

**Tests changed on purpose:** CX2's `cx2-other-kind` ("nescafe vanilla": now a «which one?» of the Nescafe items, never the vanilla items of
another brand, never "not carried"; DECISIONS B1g 4); B1f's and WEB4b's exact word lists of one item read the job's own rows (the item also
gets its brand's shared spellings); WEB4b's "before 0252" world also leaves out 0268, which uses 0252's refusals.

## 5. The clean-ups checked (nothing restored)
B1f's drops (`search_word_drops` 1 to 5, 13): «لبنة» and "lebneh" on laban and the apricot yoghurt, «كبة بلبنة» on a dish: each wrong for its
item. WEB4b's six refused brand words: Liban Lait four times on Halloum (brand Leentaanayel), «ماي سترو» on Maestro, "tanour al asir",
"indomie mee": each wrong, and each item keeps its right brand words (Maestro «مايسترو», «ميسترو»; Tannour El Asser «تنور العصر»; Indomie
«اندومي»). **No correct brand word was removed; none restored.**

## Tested (free)
`npm run typecheck` clean. `npm test`: every file passes except the seven `test/pg` files (pgvector, CI only, as before). Personal-data
guard clean (the commit hook).

## The model runs (once each, at the end)
| Run | Result | Spend |
|---|---|---|
| Language gate, `language-pack` `after,live`, run [44804386000](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44804386000), claude-haiku-5-5, 990 cases | **holds**: wrong products **0** (precision 1.000), F1 **0.919** (B1f 0.919, CX2 0.911); Lebanese Arabic 0.921, Arabizi 0.894, English 0.975, mixed 0.943; the 0.13 demo right. The other live evals **103 of 103** | USD 0.22 (cap 5) |
| Sim-test, limit 50, budget 2, repeats 0, run [44804389597](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44804389597) | 50 run and judged, **26 passed** (B1f 27, CX2 23; the judge drifts by about 8 a run). Code-checked classes: **0 turn errors, 0 silences after a hand-off, 0 replies in another language, 0 message-rule breaks, 0 no-reply**. Judge: goal not reached 22, wrong product 14, repeated question 8, unnatural dialect 8, dead end 6, invented fact 3. Each "wrong product" read: quantities, edits, windows and the minimum-order loop, none a brand «which one?», **except sim-028** (below) | USD 1.20 (cap 2): Concierge 0.15, customer 0.61, judge 0.43 |

Both were dispatched once, on the branch, after CI passed (commit aff7149).

**What the sim-test showed, and the change after it.** sim-028 asked «تلاتة مرتديلا بقر مع زيتون من تنمية». On staging today (without 0268) that line is "not carried" (`other_kind`), the B1g fault in the cold-cuts aisle. Run locally with 0268 as dispatched, the «which one?» offered Al Mouna's mortadella *first* and Tanmia's second, because «بقر» and «زيتون» are Al Mouna's kind words too. Fixed before the merge, with a case first (`tanmia-mortadella-olives`: Tanmia's mortadella with olives offered, never Al Mouna's or a pepperoni): **a brand the line names keeps only that brand's items; the owners of a kind word count only when no brand is named.** (In the sim itself the kept-order path at night showed "pepperoni beef" for that line, the model's reading of a line the planner had refused; with 0268 the planner now answers it.) The gate and the sim were not run again for this narrowing (the prompt allows one of each): it touches only lines that were "not carried" before, and only makes their «which one?» smaller.

## On staging
STAGING_PLACEHOLDER

## Not proven here
- The model's own wording when it writes «ما عنّا» beside a line it added (20 Nov 07:17): not reached once the planner finds the item; no
  output guard was added for it (the cause was the planner). If it is seen again with a found line, it becomes an `evals/` case.
- The 45 split brands' other spellings on real customers' words: only the cases above and the gate.

## Founder actions (B1g)
None.
