# AUTO1: approvals by rule, not by hand (19 November 2026)

Session AUTO1 (Opus 5.5). Prompt: the coordinator's, carrying the **founder's decision of 19 November: "a person approves the rule; the rule
approves the item"**. Decisions: `docs/DECISIONS.md`, "AUTO1, approvals by rule, 19 November 2026" (18 rows; nobody was asked). Rules:
`docs/RULES.md` ("Approval by rule", "Dishes by rule", "Pictures by rule", the caps, the migrations). Migrations **0263 and 0264** (the numbers
the prompt gave) and **0265** (the fix the live run showed; DECISIONS row 19). No new agent; no write to orders, payments, stock or the ledger; no place opened; AST1's files untouched (it reads
`automation_today()`). Kabsi was not touched. Pull requests [rashidhamzy-hue/alo-king#145](https://github.com/rashidhamzy-hue/alo-king/pull/145) and [rashidhamzy-hue/alo-king#147](https://github.com/rashidhamzy-hue/alo-king/pull/147).

## Built
1. **The rules as data** (0263, 0264): `automation_rules` (dish `menu-dish-1`, photo `photo-vision-1`, each with its words and the founder's
   approval of 19 November), the switches `settings.automation.dishes.enabled` and `.photos.enabled` (on; Settings page, admin), and one
   dedicated blocked party, "Automation (a rule a person approved)". Every automatic decision is a row of `automation_decisions` with the rule,
   its version, the reason and what an undo needs.
2. **Dishes** (0263): `automation_run_dishes()` approves, through `review_menu_dish` (each dish its own `place_log` line), every waiting dish
   that is clean and whose every printed price is verified: on the dish's own line or block of a text source (`menu_price_line`), or the same
   prices from a second, prices-only reading of a photo, a PDF or a screenshot (`record_menu_second_reading`). Praise words dropped and cut-off
   descriptions trimmed first (`menu_description_fixed`). Never: a price to confirm, an unclear name, other flags, a name with a praise word, a
   re-import's price change or removal, priced choices or extras, an undone one. The menu is stamped by rule once nothing waits. Prices to
   confirm listed with the place's phone (`menu_prices_to_confirm`). Hours and phone read from the source proposed (`place_detail_proposals`).
3. **The menu reading run** (`scripts/menus/batch.mjs`, `read.mjs`, `apps/console/src/menu-read.ts`): the second reading in the same batch
   (`pc_<id>`, the `record_prices` tool, same USD 2 cap, its worst case counted); the reader's form gains `place` (hours, phone as printed;
   E.164 by `lebanesePhone`); `automation_run_dishes()` at the end of every run, with its line in the summary.
4. **Pictures** (0264; `scripts/images/lib/photo-check.mjs`, `photo-check.mjs`, `.github/workflows/photo-check.yml`): label day front photos
   queued as our own photos (`photo_front_queue`, `propose_front_photo`; size from the file's header); every waiting picture checked by
   claude-haiku-5-5 through the Batch API (cap USD 1, `model_costs`); `record_photo_check` decides (approved / rejected with the exact reason /
   left, "needs review"); `mode recheck` records only and `photo_recheck_report` lists the disagreements. Every three hours in Beirut's day,
   and by hand.
5. **Undo and the kill-gate** (0264): `automation_undo` (one tap; an undone item is never retaken); `automation_weekly_sample` (Mondays,
   `.github/workflows/automation-weekly.yml`: at most 50 of each kind), `record_automation_check` (wrong undoes it; more than one wrong in a
   week switches the rule off by itself, with the reason, logged in `config_changes` by the automation party).
6. **Console**: Approvals: the line "Approved automatically today" (and a note when a rule is off); the Auto-approvals tab's weekly-check
   cards (before I1's spot checks); its list: the rules and their state, every automatic decision of the day (or another day) with **Undo**,
   this week's checks, the re-check's disagreements (`pages/automation.ts`, `approve.ts`, `autoapprovals.ts`). The place's page: "Prices to
   confirm" (dish, range shown, the phone as a `tel:` link) and "Read from the menu" (Use these / Not right) (`places.ts`). Today: "Dishes (or
   Pictures) are not approved by rule" with the reason (`today.ts`). Settings: both switches (`settingmeta.ts`). Arabic in
   `docs/ARABIC_REVIEW.md` (AUTO1 section and FD1's "AUTO1 additions"; not yet read by a reader).

## Tested (USD 0)
- `test/db/auto1.test.ts` (23): on **Safa's oddmenu text** (`test/fixtures/menus/safa-oddmenu.txt`, five sections, names and prices only):
  the price on the dish's own line, never a neighbour's ("330ml" and "2mini burgers" are not prices; "Pepsi" is not "Pepsi Plastic"; a misread
  1.75 is not found); praise and cut-off fixes (Supreme, Spicy Chicken Ranch, Alfredo, Vegeterian, Safa Special Burger); the run approves 14
  of 18 and leaves the range, the unclear name and the misread price; the prices to confirm with the phone; **a photo and a PDF with a price
  mismatch** (approved only when the second reading agrees); the stamp, once, and the automation party unable to approve a place; undo (dish,
  stamp; never retaken); the switch; the hours and phone proposed and applied; pictures (approve, reject "shows Masafi, not Nejmeh" and
  "24-can tray, product is one can", Hebrew text, uncertain left, brand n/a only for an unbranded item, switched off, front photos queued,
  re-check changes nothing); the day's list; the weekly sample and the kill-gate; no write to orders, payments, stock or the ledger.
- `test/db/auto1-reading.test.ts` (3): the second reading in one batch against a scripted Batch API (it never sees the first), the rule after
  it, the place's details proposed, `lebanesePhone`.
- `test/db/auto1-photos.test.ts` (5): the picture run against a scripted model: the front photo queued, one batch, the database's decisions,
  an errored answer changes nothing and is asked again, the re-check, the cap (at most USD 1, about USD 0.002 a picture at most).
- `apps/console/test/auto1.test.ts` (3): Approvals' line and Undo, the weekly cards and Today's reason, Settings, the place's page.
- MENU2's `menu2-sources.test.ts`: a tie-breaker in one query (it failed one run in five: two sources added in the same instant).
- `test/ci/model-cost-cost1.test.ts`: the picture run registered as a metered entry point. The personal-data guard (gitleaks 8.21.2) and the
  repository hygiene check pass. Locally every suite passes but `test/pg` (no pgvector in this container); CI runs it.

## On staging
- **0263 and 0264** applied by deploy-staging run 44581961448 (from `main` at a3a864c, the merge of #145; green). Read on staging afterwards:
  `automation_rules` dish `menu-dish-1` and photo `photo-vision-1`; `settings.automation` both on, sample 50, at most 1 wrong.
- **The dish rule on Safa's real menu (read only, nothing changed)**: `menu_rule_view` over Safa's 136 proposals as if waiting again. The rule
  would have approved **105**; the founder had approved **all 105** of them (**0 disagreements**). Of the 15 more he approved, the rule would
  have left 15 for him: 3 flagged "other" (Crispy Meal, Nuggets Meal, Sujuk), 2 unclear names (Protein Plate, Souda Plate) and **10 whose
  price it could not find on the dish's own line** (the reader's name differs from the printed line: Chinese chicken, Vegetarian, Chinese
  meat, Kibbeh bil siniyye, the two smoked-rice taouk, Vegetable Rolls, Chicken Rolls, Taouk bil fakhara, Chicken Alfredo): misses on the
  safe side. The 16 ranges he rejected: never the rule's.
- **The live picture check, rule `photo-vision-1`** (run [44582994731](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44582994731),
  mode both, cap USD 1): no picture waited (release `pictures-2` never reached staging: its zip has neither folder the import reads and no
  report; `pictures-3` was imported and decided by the founder), no front photo exists yet, so it re-checked the **246 approved pictures**:
  **USD 0.0622** for 246 calls (claude-haiku-5-5, half price; in `model_costs`). It agreed on 18, was unsure on 38 and "disagreed" on 190,
  almost all from the marks: **Hebrew text on 103** (Arabic read as Hebrew; once with its own reason saying "not Hebrew"), **a health claim on
  89** (the brand's own printed "low fat", "no preservatives"), another shop's branding 44, a price tag 33; fields: size 63, brand 27, flavour
  17, product type 7. **Had it been deciding, most good pictures would have been rejected.** Nothing was changed (a re-check records only).
  So the rule was corrected before any picture arrived: **`photo-vision-2` (0265)**, marks only with evidence code checks, a mark leaves the
  picture for a person and never rejects (DECISIONS row 19).
- Real catches in that run worth the founder's eye (the re-check list below, after `photo-vision-2`): AK-0099 Mamig's garlic shows
  GoldAlex; AK-0038 Hawa Chicken shows Tanmiah; AK-0238 Foody's peas a 4-pack; AK-0149 Ülker Albeni a multipack box; AK-0283 Gipsy a
  three-pack bundle.

## Not proven (only a live account or a person can)
- The second reading and the place's details read by the live model: the reading run's code is tested against a scripted model; no menu
  waits on staging (Safa's was decided by the founder before this session), so no live menu run was made.
- A label day front photo through the live check: none is on staging yet (the label day has not happened).
- A new founder picture decided by rule on staging: none waited; the decision logic is tested, and the live model's answers are seen only in
  the two re-checks (record only).
- The weekly sample: its first Monday is 23 November (nothing was decided by rule before it, so the first sample may be empty).
- The console pages on a phone by a person (the rig drives them end to end with invented data).

## Founder actions (AUTO1)
1. **Nothing to do for the rules to work.** From now: a menu read by `menu-read` approves its clean dishes whose prices it finds in the source
   by itself (and stamps the menu once nothing waits); a picture imported or photographed on label day is checked every three hours and
   approved, rejected with the reason, or left in Photos for you.
2. **Every day, if you want**: Console, **Approvals**: the line "Approved automatically today" opens the list; **Undo** on any one.
3. **Every Monday from 23 November**: Approvals, **Auto-approvals**: the week's sample (up to 50 dishes and 50 pictures), **Right** or
   **Wrong** with what is wrong. Two wrong in a week switch that rule off; Today says why; switch it on again in **Settings** once the cause
   is fixed.
4. **The 27 pictures above**: decide each (withdraw, keep, or correct the item's name).
5. **On a place's page**: "Prices to confirm" with the place's phone, and "Read from the menu" (hours and phone): **Use these** or **Not right**.
