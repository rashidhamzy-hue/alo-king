# Decision log

One line per judgement call made by a build session where DECISIONS.md was silent (DECISIONS §25). Format: `YYYY-MM-DD · PR #n · decision · reason`.

2026-10-07 · PR #61 · check-setup tests Sentry with an org token's releases endpoint when it cannot list projects · Sentry org auth tokens carry only release and source-map scope; that proves the token without needing a wider one.
2026-10-07 · PR #61 · check-setup tests the Google key with Place Details field mask `id` · the IDs-only SKU is free, so the daily run costs nothing.
2026-10-07 · PR #62 · automerge is the last job of `ci.yml`, deploy-staging runs after it in the same run · a separate `workflow_run` workflow only runs from the default branch, so the PR adding it would need a hand merge; one file merges itself and still deploys in the same run (§10).
2026-10-07 · PR #62 · automerge refuses a branch behind `rebuild/lebanon` instead of updating it · an update pushed with GITHUB_TOKEN does not start CI, so the session merges the base and pushes.
2026-10-07 · PR #62 · legacy migrations move to `supabase/migrations_legacy/` in the CI PR, not the reset PR · the deploy job applies `supabase/migrations/` after every merge and must never apply the old schema.
2026-10-07 · PR #62 · staging deploys only the functions listed in `supabase/functions/DEPLOY` (empty now) · the legacy functions need the old schema; each is listed once ported.
2026-10-07 · PR #62 · legacy edge functions are exempt from prettier and a few lint rules; `no-explicit-any` is a warning · their wiring tests match source text, so reformatting breaks them; they are rewritten in Phases 1-3.
2026-10-07 · PR #62 · `numbered` fix: tests pin the daypart and `item_id` is the last tie-breaker · the failure came from the clock (lunch boosts shawarma), not from missing sort keys; section order arrives with the Phase 1 menu schema.
2026-10-07 · PR #62 · edge-function tests run under vitest for now; `deno check` is added when functions are rebuilt · the legacy entry points import the old schema and URLs.
2026-10-07 · reset PR · the hard-coded LBP rate, COD cap and $2 fee in `src/lib/config.ts` stay until Phase 1 adds the dated rate table, fee bands and config · removing them now leaves the UI with no source; Phase 1 replaces each read with the database value.
2026-10-07 · reset PR · the landing-page chat simulator is removed with `demo-chat` · it only called that public AI endpoint; the website AI returns in Phase 4 (§24.4).
2026-10-07 · reset PR · `WHATSAPP_NUMBER` comes from `VITE_WHATSAPP_NUMBER` and is empty until Alo King's own number is connected · Kabsi's +1 201 number must not be used and Kapso "Alo King" has no number yet.
2026-10-07 · reset PR · front-end fallbacks point at alo-king-staging's URL and publishable key; `vite.config.ts` maps Vercel's Supabase integration names · both values are public by design, and Claude cannot read Vercel's env names (403) to map them exactly.
2026-10-07 · reset PR · track map uses OSM tiles and the public OSRM demo router · Mapbox is dropped (§2); routing moves to OpenRouteService in Phase 1/5.
2026-10-07 · reset PR · the Kapso skills become real directories under `.claude/skills/` before `.agents/` is deleted · they were symlinks into `.agents/`.
2026-10-07 · PR #63 · secret-scan checks the lines a PR adds (base...head) instead of every commit · PRs are squash-merged, so a secret removed in a later commit of the same PR never reaches `rebuild/lebanon`; per-commit scanning blocked a fix for a dead key.
2026-10-07 · skills PR · the "five Manus skills" (§7) are the five in `docs/research/Alo King Claude Code Foundation Files`; they are added under `.claude/skills/` rewritten to DECISIONS (no zones, four-layer escalation at 15/45/75-90 s, ledger, dated rates, Flows, staging-only) · the vendored Kapso skills stay unchanged so `skills-lock.json` hashes still match.
