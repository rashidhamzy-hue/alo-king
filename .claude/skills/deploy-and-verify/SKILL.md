---
name: deploy-and-verify
description: Ship Alo King changes to alo-king-staging and verify they are live (CI automerge, migrations, edge functions listed in supabase/functions-deploy.txt, verify_jwt, Vercel preview). Use after a PR touching supabase/ or src/ merges, or when a deploy fails.
---

# Deploy and verify

There is no manual deploy. Every PR into `rebuild/lebanon` runs `.github/workflows/ci.yml`; when all checks pass and the branch is up to date, the `automerge` job squash-merges it and `deploy-staging` runs in the same workflow run. Production does not exist yet; it deploys only from `main` after the pilot gate (DECISIONS §1, §10).

## What deploy-staging does
1. Applies `supabase/migrations/*` to `alo-king-staging` (`tzugbbatfbvrfzxuacqx`) through the session pooler (`scripts/staging-db-url.sh`).
2. Deploys each function named in `supabase/functions-deploy.txt` (`verify_jwt` from `supabase/config.toml`). A function not listed there is not deployed.
3. Runs the simulator suite (`pnpm run sim`) once it exists (Phase 7).

## Verify after a merge
1. The PR's CI run: `automerge` and `deploy to alo-king-staging` both green (GitHub MCP `pull_request_read` → `get_check_runs`).
2. Migrations: Supabase MCP `list_migrations` with `project_id: tzugbbatfbvrfzxuacqx` shows the new version.
3. Functions: `list_edge_functions` on the same project; the edited function's `version` rose and `verify_jwt` matches `config.toml`. Webhook functions are called with `?forceFunctionRegion=eu-central-1`.
4. Front end: the Vercel preview link on the PR (Vercel project `alo-king`, functions in `fra1`). Post phone-size screenshots in Arabic and English for changed screens (§10).
5. If CI went red after the merge (deploy step), fix it in a new PR at once; never deploy by hand with `deploy_edge_function` or `apply_migration`.

## When automerge refuses
- "Branch is N commit(s) behind": `git merge origin/rebuild/lebanon`, push; CI reruns.
- Claude review `VERDICT: FAIL`: read its PR comment, fix, push.
- A PR that must not merge yet: add the `no-automerge` label.

## Checks to run before pushing
`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Secrets
Only GitHub Actions secrets and Supabase/Vercel settings. `check-setup` (daily and on demand) proves each one works without printing it.
