#!/usr/bin/env bash
# Does a product page (in English) state the status of its facts? Exit 0 if so. Used by smoke.sh on staging and by the page tests.
# Since LD1 (16 November) a page says "Not confirmed yet" for a field with no approved fact, and names where an approved one came from
# (the src_* words of apps/web/src/lib/i18n.ts). The words before LD1 ("not verified", "declared") left the live check red (QA1).
set -euo pipefail
page="${1:?usage: fact-status.sh <product page html>}"
grep -qiE 'not confirmed yet|from the pack|declared by|from the certificate|from a lab report|calculated by us|checked by our team|from open food facts|from the barcode record|from the brand|from a retailer|set by our rules|from our product research' "$page"
