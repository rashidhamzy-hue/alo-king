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
