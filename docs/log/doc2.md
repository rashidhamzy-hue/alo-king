# DOC2: status and repository clean-up, 18 November 2026 (Sonnet 5.5, high); no migration

Branch `claude/vigilant-knuth-gtjznc`, one pull request. Docs, one console page, a workflow and a CI check. **No simulation, no live model call, no migration** (0241 is next).

## Built
| Part | What | Where |
|---|---|---|
| Decisions | "Founder decisions, 18 November 2026" (first commit), and two superseded rows of the 12 November table marked | `docs/DECISIONS.md` |
| STATUS | The one file every session reads: the critical path to the friends' test as a table (step, owner, state, exact clicks), what is live on staging, open founder actions, the session table, migration numbers. Under 400 lines | `docs/STATUS.md` |
| RULES | One table of every current rule and setting value (read from a database built from every migration, the workflows and the decisions), each with the decision that set it | `docs/RULES.md` |
| Session logs | Every session section of the old HANDOFF moved unchanged to `docs/log/<session>.md` (42 files; a check confirmed no line was lost); HANDOFF is a pointer. NEXT_SESSIONS and BUILD_PLAN keep rules, gates and open rows; finished rows, prompts, status notes and the old run-order tables are in `docs/log/next-sessions-*` and `docs/log/build-plan-sessions-2026-11-18.md` | `docs/log/`, `docs/HANDOFF.md`, `docs/NEXT_SESSIONS.md`, `docs/BUILD_PLAN.md` |
| Entry files | README and START_HERE rewritten (current, short); CLAUDE.md and the rules block tell every session to read STATUS and RULES in full, open a log only when needed, write its report to `docs/log/`, and update STATUS only where its facts changed | `README.md`, `START_HERE.md`, `CLAUDE.md`, `docs/NEXT_SESSIONS.md` |
| Stale lines fixed | HANDOFF's 12 November header and business rules (now RULES), cash cap 150/200 (D12 marked; RULES says 100/150), "website is Phase 9" (BUILD_PLAN, DECISIONS marked: only card payment is Phase 9), the 100 KB budget (ui README, WEBSITE.md, RULES), the seed file's "not applied" header, `docs/HANDOFF.md, <session>` references in living docs now point to `docs/log/` | various |
| Screens | Private bucket `screens`; `.github/workflows/screens.yml` (actions `shoot`, `move`, `verify`); `scripts/screens/` and `packages/core/src/screens.mjs` (one reader of file names: page, width, language, theme; the "latest set per page" prune; the reference match); the console's **Screens** page (any staff role, read only, signed links); every image under `docs/screens/` removed from the repository (379 webp, 54 png); the READMEs and weight files kept as `docs/log/screens-*` | see files |
| CI | `scripts/ci/repo-hygiene.mjs` in the `secrets-and-dependencies` job: no file over 300 KB, no image under `docs/` | `scripts/ci/repo-hygiene.mjs`, `scripts/ci/size-allow.json`, `.github/workflows/ci.yml` |

## Decisions inside the brief
1. **The 300 KB rule has a closed list.** Seven tracked files were already over 300 KB and are not text a person writes: five recorded eval results and data files under `evals/`, `evals/sim/scenarios.json`, and the applied migration `0054_language_pack.sql` (migrations are append-only). Each is in `scripts/ci/size-allow.json` with a reason and a ceiling equal to its size: it may shrink, never grow, and the check fails on a stale line. The brief's allow-list wording ("only for icons and fonts the site serves") was read as the allow-list for images under `docs/` (none is needed: the site's icons live under `apps/web/public` and `packages/ui`). Shrinking those data files is a separate job (they are test inputs).
2. **"Latest set per page".** A page is a file name without its width, language and theme. An upload deletes every older screenshot of the same page in any session, and files of the same session that the new set no longer has. Pages whose names carry a session prefix (`ux2b-approve`) are different pages from a differently named screenshot of the same screen; that is a naming habit, not a rule, and the Screens page shows both.
3. **"A page beside the reference's matching screen"** is by name: the page's name without its session prefix, shortened from the end until a `ref-ops-<page>` or `ref-web-<page>` exists, the same width class (1440 beside 1280), with two aliases (`rider` is `join-rider`, `vendor` is `for-vendors`). A console page never takes a website reference. A page with no match says so.
4. **Screenshot tests "upload there from now on, never commit".** The tests still write to the folder `SCREENS` names; their headers now say so. A session without storage keys cannot upload by hand, so the `screens` workflow runs the test in Chromium on the runner and uploads with the existing service secret (action `shoot`: test file and session name). The move of the existing images is the workflow's action `move`, run once from a commit that still has them.
5. **The old images.** Removed from the working tree only; git history is untouched (no rewrite until the repository goes private, decision 6).

## Tested
`npm run typecheck` and `npm test` (see the pull request). New: `test/ci/screens-doc2.test.ts` (file-name reading, prune plan, reference match, grouping, upload and move against a fake Storage), `apps/console/test/screens.test.ts` (the page: any role, newest session first, signed links in one call, the reference beside, read only, missing or down bucket, Arabic), `test/ci/repo-hygiene.test.ts` (300 KB, ceilings, images under `docs/`, and this repository passes).

## Not proven, and what only a live account can prove
- **The bucket exists only after the `screens` workflow has run once** (`ensure-screens-bucket.sh` creates it private and proves it). Until then the Screens page says "cannot be read".
- **The move itself** (uploading the existing 433 images and opening each through a signed link) runs in the workflow, `action move`, `from_ref` = the commit before the images were removed (see the pull request). Its summary says how many opened. The Screens page on staging is deployed by the `console` workflow on the pull request and again on `main`.
- Playwright in the workflow (`npm i --no-save playwright@1.63.0`, `playwright install --with-deps chromium`) has not been run on a runner.

## Founder actions
None new. Look at the Screens page once (console, More, Screens): `docs/STATUS.md`, section 3, e.
