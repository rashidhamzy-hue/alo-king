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
  files=$(git diff --name-only "$base...$head")
fi

if [ -z "$files" ]; then
  echo skip
  exit 0
fi

# Paths that carry money, row-level security, webhooks or personal data, plus the CI gate itself:
# - supabase/migrations, rollbacks, tests: schema, RLS, ledger, rates and fees all live there
# - supabase/functions: webhooks and every server path that sends or prices
# - supabase/seed: phones and addresses of businesses
# - supabase/config.toml: verify_jwt and auth settings
# - .github/, .claude/: the review gate, secrets wiring and guard hooks
# - scripts/*.sh that reach the staging database
# - front-end files named for money, orders, tracking, auth or contact data
sensitive_re='^(supabase/(migrations|rollbacks|tests|functions|seed)/|supabase/config\.toml$|\.github/|\.claude/|scripts/[^/]*\.sh$)'
sensitive_src_re='^src/.*(pay|ledger|money|fee|price|checkout|order|basket|cart|wallet|credit|settle|track|phone|address|auth|login|otp|webhook|claim|admin|merchant|driver)'

if ! printf '%s\n' "$files" | grep -qvE '^(docs|evals)/'; then
  echo skip
elif printf '%s\n' "$files" | grep -qiE "$sensitive_re|$sensitive_src_re"; then
  echo sensitive
else
  echo normal
fi
