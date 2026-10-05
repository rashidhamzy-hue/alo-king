---
name: deploy-and-verify
description: Ship Supabase edge function or frontend changes for Alo King and verify they are live (CI deploy, function version/hash, verify_jwt, smoke test, frontend build). Use after merging any change under supabase/functions or src.
---

# Deploy and verify

## Edge functions
1. Open a PR, merge to `main` (squash). A push touching `supabase/functions/**` or `supabase/config.toml` runs `.github/workflows/deploy-functions.yml` → `supabase functions deploy` for **all** functions (needs the `SUPABASE_ACCESS_TOKEN` repo secret; `verify_jwt` comes from `supabase/config.toml`).
2. Wait for the run to finish (about 30 s once started; it can queue for a minute). Check `actions_list` → `list_workflow_runs`: `status=completed`, `conclusion=success`.
3. Verify on Supabase (`list_edge_functions`, project `hnjkietmwvkgbyrcnweq`):
   - `kapso-brain` and `demo-chat` → `verify_jwt: false`; `claim-vendor` and `merchant-ai` → `verify_jwt: true`.
   - `version` increased and `ezbr_sha256` changed for the function you edited (other functions bump the version on every deploy even when unchanged).
4. Smoke test with the `test-whatsapp-flow` skill (at least one order and one owner message for `kapso-brain`).
5. Never edit functions only in the Supabase dashboard or via `deploy_edge_function`; the repo is the source of truth and CI will overwrite them.

## Database
- Schema/RLS changes go in a new `supabase/migrations/<timestamp>_<name>.sql` and are applied with `apply_migration`; confirm with `list_migrations`. Never create tables from Lovable.

## Frontend
- `bun run lint`, `bun run test`, `bun run build` must pass. Lovable syncs `main`; do not rewrite pushed history.
- In sandboxes where `bun install` fails with 403 on the private npm mirror, install without the lockfile for verification only (`mv bun.lock /tmp; bun install --registry https://registry.npmjs.org; mv /tmp/bun.lock .`) and do not commit lockfile changes.

## Secrets / config reminders
- `KAPSO_OTP_TEMPLATE` stays empty until `alo_verify_code` is APPROVED; `KAPSO_PROMO_TEMPLATE`/`KAPSO_PROMO_LANG` must name an APPROVED marketing template (see `docs/whatsapp-templates.md`).
