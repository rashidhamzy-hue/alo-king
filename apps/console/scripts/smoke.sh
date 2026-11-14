#!/usr/bin/env bash
# Proves the deployed console on staging: it answers, it refuses the signed-out and the cross-site, and a real sign-in works
# against the real Supabase Auth and database, with roles enforced. The check account is a staging picker whose password is
# replaced with a random one on every run and never stored, so nobody can use it between runs.
set -euo pipefail
here=$(dirname "$0"); . "$here/lib.sh"
: "${CONSOLE_URL:?}"
u=$CONSOLE_URL
expect() { local what=$1 want=$2 got=$3; echo "$what -> $got (want $want)"; [ "$got" = "$want" ] || { echo "FAIL: $what"; exit 1; }; }

for i in $(seq 1 12); do code=$(curl -sS -o /dev/null -w '%{http_code}' "$u/health" || true); [ "$code" = "200" ] && break; sleep 5; done
expect "GET /health" 200 "$code"
expect "GET / signed out" "303 $u/sign-in" "$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "$u/")"
expect "GET /sign-in" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "$u/sign-in")"
expect "cross-site POST" 403 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -d 'email=a&password=b' "$u/sign-in")"
expect "wrong password" "303 $u/sign-in?e=1" "$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -X POST --data-urlencode 'email=nobody@example.com' --data-urlencode 'password=not the password' "$u/sign-in")"

# The check account: a picker party named for its job, linked to an Auth user on a reserved domain (no mail is ever sent).
email="console-smoke-check@example.com"
party=$(sb GET "/rest/v1/parties?display_name=eq.Console%20smoke%20check%20(staging)&role=eq.picker&select=id" | jq -r '.[0].id // empty')
[ -n "$party" ] || party=$(sb POST "/rest/v1/parties" '{"role":"picker","display_name":"Console smoke check (staging)"}' | jq -r '.[0].id')
pw=$(openssl rand -base64 30)
user=$(find_user "$email")
export SMOKE_PW="$pw"
body=$(jq -n --arg e "$email" --arg p "$party" '{email: $e, email_confirm: true, password: env.SMOKE_PW, app_metadata: {party_id: $p}, ban_duration: "none"}')
if [ -n "$user" ]; then sb PUT "/auth/v1/admin/users/$(jq -r .id <<<"$user")" "$body" >/dev/null; else sb POST "/auth/v1/admin/users" "$body" >/dev/null; fi

jar=$(mktemp)
# Whatever happens below, the account ends the run as a picker with a fresh random password nobody knows.
lock() {
  sb PATCH "/rest/v1/parties?id=eq.$party" '{"role": "picker"}' >/dev/null || true
  export SMOKE_PW=$(openssl rand -base64 30)
  sb PUT "/auth/v1/admin/users/$(find_user "$email" | jq -r .id)" "$(jq -n '{password: env.SMOKE_PW}')" >/dev/null || true
  rm -f "$jar"
}
trap lock EXIT
res=$(printf '%s' "$pw" | curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -c "$jar" -X POST --data-urlencode "email=$email" --data-urlencode "password@-" "$u/sign-in")
expect "real sign-in (picker)" "303 $u/" "$res"
page=$(curl -sS -b "$jar" "$u/")
grep -q "Console smoke check" <<<"$page" || { echo "FAIL: signed-in page does not show the staff name"; exit 1; }
echo "signed-in page shows the staff name"
for p in /payments /riders /pictures; do expect "picker opens $p" 403 "$(curl -sS -o /dev/null -w '%{http_code}' -b "$jar" "$u$p")"; done
for p in /returns /catalog; do expect "picker opens $p" 200 "$(curl -sS -o /dev/null -w '%{http_code}' -b "$jar" "$u$p")"; done
echo "- Smoke test passed on $u: health, signed-out redirect, cross-site refusal, wrong password, a real sign-in, picker roles enforced" >> "$SUMMARY"

# 5.15: does this console read labels? (the ANTHROPIC_API_KEY Worker secret; the intake page says which)
intake=$(curl -sS -b "$jar" "$u/intake" || true)
if grep -q "and read the label" <<<"$intake"; then reader="on (the model reads label photos)"; else reader="off (no model key: typed by hand)"; fi
echo "label reader: $reader"; echo "- Label reader: $reader" >> "$SUMMARY"

