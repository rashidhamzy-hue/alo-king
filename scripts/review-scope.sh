#!/usr/bin/env bash
# Classifies a pull request for the Claude review job (DECISIONS §10, LOG 2026-10-11).
#   skip      every changed file is under docs/ or evals/: no review runs
#   sensitive the change touches money, RLS, webhooks or personal data: a review that cannot run blocks
#   normal    anything else: a review that cannot run for an infrastructure reason passes with a warning
# Usage: scripts/review-scope.sh <base-sha> [head-ref]   (prints one word; also reads file names from
# stdin when called with `-`, which the tests use).
set -euo pipefail

if [ "${1:-}" = "-" ]; then
  files=$(cat)
else
  base="${1:?base sha required}"
  head="${2:-HEAD}"
  # --no-renames lists both sides of a move, so moving a sensitive file into docs/ is still sensitive.
  files=$(git diff --name-only --no-renames "$base...$head")
fi

if [ -z "$files" ]; then
  echo skip
  exit 0
fi

# Paths that carry money, row-level security, webhooks or personal data, plus the gate and the build:
# - supabase/: schema, RLS, ledger, rates, fees, edge functions (webhooks), seed data, the deploy list
# - .github/, .claude/: the review gate, secrets wiring and guard hooks
# - scripts/: database loaders and the scripts CI runs
# - package.json, the lockfile, workspace, vite and vercel config: what is built and shipped
# - src/ server entry points, the Supabase client, API routes, and files named for money, orders,
#   tracking, auth or contact data
sensitive_re='^(supabase/|\.github/|\.claude/|scripts/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|vite\.config\.ts$|vercel\.json$|src/(server|start|router)\.tsx?$|src/integrations/|src/routes/api)'
sensitive_src_re='^src/.*(supabase|pay|ledger|money|fee|price|checkout|order|basket|cart|wallet|credit|settle|track|phone|address|auth|login|otp|webhook|claim|admin|merchant|driver)'

if ! printf '%s\n' "$files" | grep -qvE '^(docs|evals)/'; then
  echo skip
elif printf '%s\n' "$files" | grep -qiE "$sensitive_re|$sensitive_src_re"; then
  echo sensitive
else
  echo normal
fi
