# Strategy of 15 November 2026

The planning chat of 15 November 2026 (Fable 5.2) audited `main` at 711c2ca and staging read-only, then wrote the plan below.
The founder accepted part 1 on the same day; his changes are marked in the files. Session DOC1 put the files here.

| File | What it is | Read it when |
| --- | --- | --- |
| [`01-verdict-gates.md`](01-verdict-gates.md) | The verdict, 21 ranked blind spots, the three stop conditions, the founder's decisions of the day | Before deciding anything about scope, money or the pilot |
| [`02-journeys.md`](02-journeys.md) | The five journeys (customers, vendors, riders, hub, owner) with readiness and the gap that matters most | Building anything a customer, rider, picker or ops lead touches (CX1, D4b, RD1, WH1a, OPS2) |
| [`03-learning-experience.md`](03-learning-experience.md) | Part A, the learning system (event log, measured times, nightly checks); part B, the experience strategy | L1, N2, CX1 |
| [`05-console-website-design-handoff.md`](05-console-website-design-handoff.md) | Part A, the console page by page; B, the website; C, design direction; D, the never-stranded hand-off specification | HO1, OPS1, DS1, UX2, WEB2, UX3, AN1 |
| [`06-session-plan.md`](06-session-plan.md) | The rules for every session, gates A to C, every session in run order, the staff line during testing, the January Meta paths, every prompt | Picking the next session. The live copies are `docs/NEXT_SESSIONS.md` and `docs/BUILD_PLAN.md` |

There is no `04`. Numbering follows the planning chat, which wrote five parts besides the audit.

## What stays out of the repository
- **Part 4, the systems audit** (what the planning chat read in GitHub, Supabase, Cloudflare, Sentry and Kapso). It names accounts and settings of live systems. The audit session AUD1 writes the repository's own version, `docs/AUDIT-2026-11.md`, from read-only checks.
- **The founder's action drafts** (messages, forms and requests written for him to send). Anything only he can do goes into `docs/HANDOFF.md`, "Founder actions", with exact clicks.

Both stay out until the repository is private (last step of the plan, session PRIV). Until then this repository is public: nothing personal or secret may enter it (rule 4 in `docs/NEXT_SESSIONS.md`).

## Which file wins
`docs/DECISIONS.md` and `CLAUDE.md` outrank these files. Where a strategy file and an older plan disagree (`docs/BUILD_PLAN.md` before "Strategy revision, 15 November 2026", the old queue in `docs/history/`), the strategy wins.

## Known deviation from the bundle
The files are the bundle verbatim. One number is corrected in the live plan, not here: `06-session-plan.md` reserves migrations 0153 to 0157 for WH1a, but WEB1 already shipped 0154 and 0155 on `main`. `docs/BUILD_PLAN.md` and `docs/NEXT_SESSIONS.md` give WH1a 0153, 0156, 0157, 0188 and 0189 (recorded in `docs/DECISIONS.md`).

## Not here yet
The founder's design brief (`docs/DESIGN_BRIEF.md`), which DS1 reads, was not in the DOC1 hand-over: see `docs/HANDOFF.md`, "Strategy of 15 November".
