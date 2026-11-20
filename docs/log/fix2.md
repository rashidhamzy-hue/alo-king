# FIX2: four small fixes (20 November 2026)

Session FIX2. Prompt: the coordinator's four fixes from Sentry and the storage report, and a fifth if quick. Choices: `docs/DECISIONS.md`,
"FIX2, four small fixes, 20 November 2026" (7 rows; nobody was asked). Migration **0266** (one file, two parts). No write to orders, payments,
stock or the ledger; no new agent, no new way to send; Kabsi not touched. Free tests only, plus the one digest run on staging.

## 1. The nightly digest's permission error (Sentry ALO-KING-GATEWAY-8)
- **Cause**: `assistant_digest_facts` runs every tool as `assistant_reader`. The products tool reaches `readiness_not_sellable()` →
  `product_template_status()` (security invoker), which reads `dish_declarations` only for an item of template `vendor_dish`. Staging has
  dishes (Safa's, the test kitchen); AST1's invented day had none, so its 15 tests never took the branch.
- **Fix** (0266 A): SELECT on `dish_declarations` for `assistant_reader` and its read-only row policy; client roles keep no grant on it.
- **Search for others**: a static walk from every `assistant_*` function through every security-invoker function it names (38 functions
  reached, AUTO1's and FD's included) found this one table and nothing else: no other table, view, row policy or function missing.
- **Proof** (`test/db/fix2-assistant-reach.test.ts`, 4): the static walk; `assistant_digest_facts` and the real `writeDigest` (scripted
  model) end to end on the AST1 world plus the test kitchen, a declared allergen and AUTO1's run, writing a row; the role holds no write
  privilege and a write as it is refused (`dish_declarations`, `automation_decisions`, `settings`, `assistant_digests`). Without 0266 three of
  the four fail with exactly staging's error, "permission denied for table dish_declarations" (checked by moving the file away).

## 2. The heartbeat, made honest (Sentry ALO-KING-GATEWAY-3 and -5)
Read on staging (the probe customer's outbox, 19 November 06:30 to 20 November 05:30 UTC): the probe wrote every hour and placed only two test
orders (AK-1074, AK-1075 in the day; AK-1076 at 17:07). Three stalls, each fixed; the alarms themselves still fire when the probe really fails:
1. "Which one?" is a list since CX2; the probe tapped buttons only (6 of the 12 open hours). Now it picks the first product row and answers as
   a `list_reply` (`packages/wa/src/probe.ts`).
2. The pin request followed by a "not found yet" line: only the newest message was offered, so the pin was never sent (3 of 12). Now
   `probe_pending` (0266 B) gives every unanswered message of the last hour, and the probe answers the newest one it can on each line.
3. At night it ordered anyway, a model turn an hour into "closed, send your pin". `probe_due` now orders only while the shop is open.
-5 is `inbound_silent`: it fired at each opening after a quiet night. It now counts from the later of the last message and today's opening,
as `probe_silent` does; six quiet open hours still fire it.
Tests (`test/db/heartbeat.test.ts`, 4 new): the list answered and parsed as a real webhook; the pin answered with a later line after it; no
order while closed; `inbound_silent` after a quiet night versus seven quiet open hours. The older heartbeat, alarm and B4 suites pass (30). `test/pg/prepare-staging.test.ts` asked for a probe order at whatever hour CI ran (it failed at 08:00 Beirut on the first CI run): it now opens the shop for that check.

**Running the digest by hand**: there was no way to run it but the 21:40 cron, so a by-hand workflow `assistant-digest` runs the same
`writeDigest` on staging once (`scripts/assistant/digest-once.test.ts`, skipped unless `ALO_DIGEST_ONCE=1`; the assistant's caps apply; cost
in `model_costs`, workflow `assistant-digest`; it sends nothing).

## 3. The screens bucket's retention
Read on staging (`storage.objects`, read only): **681 files, 165 MB, 16 sessions; every file from 18 or 19 November** (web4a alone 82
files, 94.8 MB of full-page PNGs). The new step (`planRetention`, `run.mjs retain`, the `screens` workflow after every shoot and as action
`retain`) keeps the newest upload of each screen name per session and everything from the last 7 days, and deletes the rest through the
Storage API. Today that deletes nothing: see "On staging" for the run's before and after. Tests (`test/ci/screens-doc2.test.ts`, 3 new): the
rule, every chip, page and reference screen kept, the DELETE through the API and the summary line.

## 4. AST1's follow-ups
- No gender from a name: a prompt rule in English and Arabic.
- "Now" figures: `riders` and `money` asked about another day add `now_only` and a note; the prompt says to say "as of now".
- Eval cases (`evals/assistant/questions.json`, 23 now): `rider_neutral_en`, `rider_neutral_ar`, `cash_other_day`; the scripted test checks
  each, the prompt's words and the mark reaching the model. **No live eval run** (`request.json` untouched).

## 5. Source maps to Sentry: skipped
No workflow uses `SENTRY_AUTH_TOKEN`, and a session cannot read the repository's secrets, so by the prompt's rule it was not added (DECISIONS
row 7). Founder action: a Sentry token with `project:releases` as the repository secret `SENTRY_AUTH_TOKEN`; then a session adds the upload.

## Checks
Locally: `npm run typecheck`, the personal-data guard (gitleaks 8.21.2) and the hygiene check pass; `npm test` 3508 passed (the 7 `test/pg`
files need pgvector, which this container lacks). CI on [rashidhamzy-hue/alo-king#150](https://github.com/rashidhamzy-hue/alo-king/pull/150):
the first run failed one `test/pg` check (above), the third run was green (10 of 10), and so was `main`'s CI after the merge (run 44689261092).

## On staging (20 November, from `main` at 8138bbd)
- **deploy-staging run 44689343899** (green): 0266 applied, 180 migrations recorded. Read afterwards: `assistant_reader` may read
  `dish_declarations`; `probe_due` orders only while open. **console run 44689343825** (green).
- **The digest, once** (`assistant-digest` run 44689660516, for 19 November, the night that failed): row written, claude-haiku-5-5, one call,
  **USD 0.0014** (in `model_costs`, workflow `assistant-digest`), English 373 and Arabic 381 characters, 3 fix candidates.
- **Sentry**: ALO-KING-GATEWAY-8, -3 and -5 marked resolved, each with the reason. -3 and -5 reopen if the alarm fires again while open.
- **Screens retention** (`screens` run 44689841667, action `retain`): before **681 files, 165.1 MB, 16 sessions**; deleted **0**; after
  **681 files, 165.1 MB, 16 sessions** (every file is from 18 or 19 November, inside the 7 days); all 681 open through a signed link, every
  chip present. The first deletions can come from 25 November; web4a's 82 full-page PNGs (94.8 MB) are most of the size.

## What only time on staging can prove
- That the probe completes its order through a whole open day (the fix is tested against its three stalls; staging opened at 07:00 UTC on
  the 20th, after the deploy). If it does not, ALO-KING-GATEWAY-3 reopens by itself.
- The first nightly digest from the cron (21:40 Beirut, 20 November).
- The assistant's neutral wording and "as of now" with the real model (no live eval was run; scripted only).

## Founder actions (FIX2)
1. **Nothing needed** for items 1 to 4.
2. **Optional, for readable Sentry traces**: sentry.io, Settings, Auth Tokens (organisation `alo-king`), a token with scope
   `project:releases`; GitHub, the repository, Settings, Secrets and variables, Actions, **New repository secret** `SENTRY_AUTH_TOKEN`. Then
   a session adds the source-map upload to the gateway and console deploys.
