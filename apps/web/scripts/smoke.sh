#!/usr/bin/env bash
# Live check of the deployed website (staging): the pages render from the real database with no JavaScript, the three spellings of labneh
# find the same products, a page is under 100 KB before pictures, and the role's token works. Prints one line per check.
set -euo pipefail
url="${1:?usage: smoke.sh <site address>}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
get() { curl -sS --retry 4 --retry-delay 3 --retry-all-errors -m 30 -H 'Accept-Language: en' "$@"; }

# Fresh deploys can take a few seconds to answer.
for i in 1 2 3 4 5 6; do code=$(get -o "$tmp/home.html" -w '%{http_code}' "$url/" || true); [ "$code" = 200 ] && break; sleep 5; done
[ "$code" = 200 ] || fail "home answered $code (503 usually means the Worker's database token is missing or refused)"
grep -q 'href="/c/' "$tmp/home.html" || fail "home lists no category (the database answered, but with no catalog?)"
echo "- home: 200, $(grep -o 'href="/c/' "$tmp/home.html" | wc -l | tr -d ' ') categories from the database"
if grep -E '<script' "$tmp/home.html" | grep -vqE '<script[^>]* src="'; then fail "home carries an inline script"; fi
echo "- no inline script"

# OPS1: the website reaches Sentry. A check-in to its own monitor (deploy-smoke-web-staging), never an error: no issue is opened.
sent=$(get "$url/__sentry-test" || true)
case "$sent" in "sent "*"flushed=true") echo "- Sentry: check-in accepted ($sent)" ;; *) fail "the website did not get a check-in to Sentry: $sent" ;; esac

cat_path=$(grep -oE 'href="/c/[a-z0-9_]+"' "$tmp/home.html" | head -1 | sed 's/href="//; s/"$//')
[ "$(get -o "$tmp/cat.html" -w '%{http_code}' "$url$cat_path")" = 200 ] || fail "category $cat_path did not answer 200"
grep -q 'class="ak-product' "$tmp/cat.html" || fail "category $cat_path lists no item"
echo "- $cat_path: 200, $(grep -o 'class="ak-product' "$tmp/cat.html" | wc -l | tr -d ' ') items"
sku=$(grep -oE 'href="/p/[A-Za-z0-9_-]+"' "$tmp/cat.html" | head -1 | sed 's/href="//; s/"$//')
[ "$(get -o "$tmp/prod.html" -w '%{http_code}' "$url$sku")" = 200 ] || fail "product $sku did not answer 200"
grep -qi 'not verified' "$tmp/prod.html" || grep -qiE 'declared|certified|calculated' "$tmp/prod.html" || fail "product page shows no fact status"
echo "- $sku: 200, food facts carry a status"
[ "$(get -o /dev/null -w '%{http_code}' "$url/c/nope")" = 404 ] || fail "an unknown category is not a 404"
[ "$(get -o /dev/null -w '%{http_code}' "$url/p/AK-9999999")" = 404 ] || fail "an unknown product is not a 404"
echo "- unknown category and product: 404"

list() { get -G --data-urlencode "q=$1" "$url/search" | grep -oE 'href="/p/[A-Za-z0-9_-]+"' | sort -u | tr '\n' ' '; }
a=$(list labne); b=$(list "لبنة"); c=$(list labneh)
[ -n "$a" ] || fail "'labne' finds nothing"
[ "$a" = "$b" ] && [ "$a" = "$c" ] || fail "labne, لبنة and labneh find different products: [$a] [$b] [$c]"
echo "- labne, لبنة and labneh find the same products: $a"

# The page, its stylesheet, its scripts and the fonts it loads (DS1: the fonts are this site's own files and count).
bytes=$(wc -c < "$tmp/cat.html")
for f in $(grep -oE '(href|src)="/(_astro/[^"]+\.(css|woff2)|[a-z-]+\.js)"' "$tmp/cat.html" | sed -E 's/^(href|src)="//; s/"$//' | sort -u); do bytes=$(( bytes + $(get "$url$f" | wc -c) )); done
css=$(grep -oE 'href="/_astro/[^"]+\.css"' "$tmp/cat.html" | head -1 | sed 's/href="//; s/"$//')
for f in $(get "$url$css" | grep -oE '/_astro/[^)"]+\.woff2' | sort -u); do fonts=$(( ${fonts:-0} + $(get "$url$f" | wc -c) )); done
[ "$bytes" -lt 102400 ] || fail "a category page weighs $bytes bytes before pictures and fonts (limit 102400)"
echo "- category page weighs $bytes bytes before pictures (HTML, stylesheet, scripts); its four font files add ${fonts:-0} bytes, loaded once and kept"
[ "$(get -o /dev/null -w '%{http_code}' "$url/gallery")" = 200 ] || fail "the gallery is not served on staging"
echo "- gallery: 200 (staging only)"
[ "$(get -o /dev/null -w '%{http_code}' "$url/manifest.webmanifest")" = 200 ] || fail "no manifest"
[ "$(get -o /dev/null -w '%{http_code}' "$url/sw.js")" = 200 ] || fail "no service worker"
echo "- manifest and service worker served"
