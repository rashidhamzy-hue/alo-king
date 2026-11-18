# Alo King Chouf: handoff (a pointer)

**This file no longer holds status or rules.** Since 18 November 2026 (session DOC2) the three things a session needs are:

| Read | For |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | The 21 invariants and the working agreement |
| [`docs/STATUS.md`](STATUS.md) | The critical path to the friends' test, what is live on staging, the open founder actions with exact clicks, the session table, the migration numbers |
| [`docs/RULES.md`](RULES.md) | Every current rule and setting value (caps, limits, timers, the two-person list, budgets, page rules, storage limits), each with the decision that set it. This replaced this file's old "Business rules" (some lines of which were stale: the cash cap 150/200, "website and diaspora orders are Phase 9", the 12 November date) |

Then `docs/BUILD_PLAN.md` (the roadmap by task number) and `docs/NEXT_SESSIONS.md` (session rules, gates, prompts).

**Session reports.** Every session section that used to be here is in `docs/log/<session>.md`, text unchanged, with its "Founder actions" and
"Founder test" sections in the same file. Open one only when you need what that session wrote. A session now writes its own report to
`docs/log/<session>.md` and updates `docs/STATUS.md` only where its facts changed.

Logs: [a5](log/a5.md), [ar1](log/ar1.md), [b1a](log/b1a.md), [b1b](log/b1b.md), [b1c](log/b1c.md), [b1d](log/b1d.md), [b1e](log/b1e.md), [bk0](log/bk0.md), [build-stands-2026-11-14](log/build-stands-2026-11-14.md), [cfg1](log/cfg1.md), [cost1](log/cost1.md), [cx1](log/cx1.md), [d4b](log/d4b.md), [d5](log/d5.md), [doc1](log/doc1.md), [ds1](log/ds1.md), [ds2](log/ds2.md), [FD1](log/FD1.md), [fix1](log/fix1.md), [h1](log/h1.md), [h1-data-files](log/h1-data-files.md), [ho1](log/ho1.md), [inventory-2026-11-13](log/inventory-2026-11-13.md), [lb1](log/lb1.md), [ld1](log/ld1.md), [lv1](log/lv1.md), [m1](log/m1.md), [open-requests-2026-11-14](log/open-requests-2026-11-14.md), [ops1](log/ops1.md), [pd1](log/pd1.md), [pix](log/pix.md), [pix2](log/pix2.md), [pix3](log/pix3.md), [pub1](log/pub1.md), [qa1](log/qa1.md), [sell1](log/sell1.md), [sim1](log/sim1.md), [sp2](log/sp2.md), [sr1](log/sr1.md), [ux2a](log/ux2a.md), [ux2b](log/ux2b.md), [ux3](log/ux3.md), [web1](log/web1.md), [web2](log/web2.md), [web4a](log/web4a.md), [wh1a](log/wh1a.md).

Also in `docs/log/`: `build-stands-2026-11-14` (the 14 November summary), `inventory-2026-11-13` (the old A to F inventory of what was built, what needed a live account and the Meta steps), `open-requests-2026-11-14` (the lane-by-lane list of open requests as H1 collected it), `h1-data-files`, `build-plan-sessions-2026-11-18` (the finished sessions' rows of the build plan) and `next-sessions-*-2026-11-18` (finished prompts, status notes and the old run-order table).

**How to run**

```
npm install             # also installs the pre-commit hook (personal-data check, scripts/ci/no-personal-data.mjs)
npx tsc --noEmit
npx vitest run          # about 3,000 tests (some live-only skipped); apps/console/test/* drive the console's pages; test/db/* run the real migrations in PGlite;
                        # test/pg/* start a throwaway Postgres 16 (or use TEST_DATABASE_URL) and the Worker in workerd
DATABASE_URL=... scripts/check_permissions.sh    # on a scratch Postgres, and on a Supabase branch before launch
```

**The AI architecture, stated once.** One conversational agent facing customers, the Concierge. Around it: narrow AI functions (vision extraction for
labels, menus and receipts; speech-to-text; summaries) and deterministic services in SQL and TypeScript. Staff tools may answer questions from
read-only reports and never act. A new agent is added only when a measured job cannot be done by the Concierge, a function or code (invariant 21).

**The milestone that matters.** A real customer sends a Lebanese WhatsApp order, gets the right card, confirms, receives the right goods, pays, and
inventory, rider cash, rider earnings and the company ledger all reconcile. Costs: `docs/COST_MODEL.md`.
