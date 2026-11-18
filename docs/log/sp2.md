<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### SP2: no-reply turns, 15 November 2026 (Opus 5.5)
Ordering lane, branch `claude/tender-clarke-zfo77t`, PR rashidhamzy-hue/alo-king#63. No migration (0200-0201 held, unused).
**The bug** (M1's finding; once on staging, 14 Nov 08:13 Beirut, an address-only message with no basket): a turn of the open-question loop
ended with nothing the customer could act on and the chat went to a person (`handoffs.reason = agent_did_not_finish`). Two causes in
`concierge.ts`: an ask call stopped at `max_tokens` (1024) before any tool; or the model called `extract_order`, was told "already
recorded", and ended the turn with free text («I'll reply once I've checked the catalog») or nothing.

| Item | What SP2 built | Tested by |
| --- | --- | --- |
| Eval cases first | `evals/cases/no_reply.json`: 9 recorded step sequences (stop reason, tools, free text) of both causes, replayed through the real ask loop, and 8 live messages (an address with no basket, orders, allergy, gluten, area and French questions). Invented names and addresses only. 15 of the 17 new tests failed on the loop before the fix | `evals/test/no-reply.test.ts` (13), `test/db/no-reply-sp2.test.ts` (4) |
| The cap | Ask calls get `max_tokens` 4096 (`ASK_MAX_TOKENS`; only produced tokens are billed). A response cut at the cap is dropped and never run (a cut tool call is half written; `capped-mid-tool-call`) and the step is asked again | `capped-before-any-tool`, `capped-mid-tool-call`, `capped-twice`, `address-only-no-basket`, `order-capped-then-pin` |
| `extract_order` then silence | Answered «already recorded, in `reading` (null: use the customer's words); do not call it again; answer the customer now». A step with no tool call is answered `ANSWER_NOW` (only a tool reaches the customer; reply, or the pin, card or catalog; a handoff only if you truly cannot help) | `extract-order-then-silence`, `extract-order-then-nothing`, `extract-order-then-search-then-reply` |
| Stalls | A step that reached nobody (cut, no tool, or only `extract_order`) is a stall. After one, the next call runs at effort low; after two, and on the loop's last step whatever came before, the call is forced to `reply` (`tool_choice` tool, as the reading already is on Haiku 5.5). Normal steps are never forced | `capped-twice`, `never-answers` |
| A handoff when the model truly cannot answer | Still fail closed: after six steps, `handoff_human("agent_did_not_finish")`, which sends the fixed handoff message. `runAskLoop` now returns `outcome: "handoff"` with the reason also when the model calls `handoff_human` itself (it returned `ok` before) | `never-answers`; `no-reply-sp2` (model's own handoff) |
| Ops alerted, console shows it | `turn.ts` raises an `agent_handoff` ops exception (ref the turn key; detail the conversation and reason) for every Concierge handoff: the loop's, the model's own, the planner's (`plan_handoff`). The minute cron (`ops_exceptions_due`, `index.ts`) alerts the ops line; the console's exceptions page lists it beside the handed-off chat. Before SP2 a handoff wrote the row and set `human_handoff`, but nothing alerted ops | `no-reply-sp2`: the exception, its reason, and `ops_exceptions_due()` returning it |

**Gate** (language-pack "after" + "live" on the PR's code, `claude-haiku-5-5`, 990 cases, repeat 1; live is 41 + the 8 SP2 cases):
| Run | Code | item F1 | wrong products | demo | live | no-reply turns |
| --- | --- | --- | --- | --- | --- | --- |
| 43682755490 | 3163a76 | 0.916 | 0 | right | 49/49 | 0 |
| 43682808248 | 3163a76 | 0.913 | 0 | right | 48/49 (see below) | 0 |
| 43683508108 | 3163a76 | 0.911 | 0 | right | 49/49 | 0 |

Three gate runs in a row: zero no-reply turns, F1 at least 0.90, zero wrong products, the demo right, and every live case judged on
the reply sent passed. The one live miss (run 43682808248) is "stay on the job" «شو بتحب تطبخ اليوم؟ بدي أغراض لمجدرة» read as
off-topic: the forced reading call (prompt, schema, tools unchanged by SP2), never the ask loop; lane B item (b) below, failing in 3 of
M1's last 4 runs on main's own prompt. Not a no-reply turn: that customer gets the fixed off-topic line. Left for the lane that owns the
reading prompt. None of the 8 new live cases stalled visibly; run 1 shows 10 `extract_order` calls in the ask loop, each followed by a
reply.

Files outside the row: `docs/BUILD_PLAN.md` (the SP2 row), `evals/run.ts` and `evals/live/concierge.live.test.ts` (the runners). No prompt, schema,
price source, gateway allowlist or money function changed. Locally, after merging main (WEB1): `npm run typecheck` clean; `npm test` 1,402 passed, 51 skipped (live-only), 0 failed.

Only a live account can prove: after merge and deploy, one typed order on the staging customer line gets its card (see below), and an
`agent_handoff` alert reaching the ops line (the cron path is the one every other exception already uses).
