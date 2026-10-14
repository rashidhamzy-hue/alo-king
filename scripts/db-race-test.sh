#!/usr/bin/env bash
# Order race tests (DECISIONS §10 session 3): real concurrent sessions against the throwaway database
# that scripts/db-test.sh prepared. Never point this at staging.
#   1. ten customers race for the last three croissants: exactly three orders, the count never negative
#   2. one confirmation sent ten times at once: one order, every call returns it
#   3. five staff accept while five reject the same order: exactly one wins, one event from `placed`
#   4. accept races an operator cancel: one transition from `placed`, at most one cancel, nothing after it
#   5. deadlock order (session D, §38.3): twenty orders holding the same two limited items, added in opposite
#      orders, placed at once: all placed, no deadlock (stock rows are locked in item-id order)
set -euo pipefail
: "${DB_URL:?set DB_URL to a throwaway database}"
case "$DB_URL" in
  *supabase.co* | *supabase.com* | *pooler*) echo "db-race-test refuses hosted databases"; exit 1 ;;
esac
q() { psql "$DB_URL" -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
# A session acting as the service role, the way edge functions call RPCs.
svc() { psql "$DB_URL" -X -q -tA -c "set role service_role; set request.jwt.claims = '{\"role\":\"service_role\"}'; $1" 2>&1 || true; }
fail=0
check() { if [ "$1" = "$2" ]; then echo "ok - $3"; else echo "FAILED: $3 (got $1, want $2)"; fail=1; fi; }

TMPDIR_RACE=$(mktemp -d)
trap '[ "$fail" = 0 ] && rm -rf "$TMPDIR_RACE" || echo "race outputs kept in $TMPDIR_RACE"' EXIT
q -f supabase/tests/race/setup.sql >/dev/null
version=$(q -c "select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a'")

# 1. Last units.
for g in $(seq -w 1 10); do
  svc "select public.order_place('53000000-0000-0000-0000-0000000000$g', $version, 'race:last-units:$g') ->> 'status'" > "$TMPDIR_RACE/u$g" &
done
wait
placed=$(cat "$TMPDIR_RACE"/u* | grep -c '^placed$' || true)
check "$placed" 3 "ten customers, three croissants: three orders"
check "$(q -c "select daily_remaining from public.menu_items where id = '51000000-0000-0000-0000-000000000001'")" 0 "the daily count ends at zero"
check "$(q -c "select count(*) from public.orders where idempotency_key like 'race:last-units:%'")" 3 "three orders exist"
check "$(cat "$TMPDIR_RACE"/u* | grep -cE 'sold_out|unavailable' || true)" 7 "the seven others are told it sold out"

# 2. Duplicate confirmation (the last croissant changed the menu version).
version=$(q -c "select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a'")
q -c "select public.basket_price(id) from public.baskets where id in ('53000000-0000-0000-0000-000000000011', '53000000-0000-0000-0000-000000000012')" >/dev/null
for i in $(seq 1 10); do
  svc "select public.order_place('53000000-0000-0000-0000-000000000011', $version, 'race:dup') ->> 'order_id'" > "$TMPDIR_RACE/d$i" &
done
wait
check "$(q -c "select count(*) from public.orders where idempotency_key = 'race:dup'")" 1 "a confirmation sent ten times creates one order"
check "$(cat "$TMPDIR_RACE"/d* | sort -u | wc -l | tr -d ' ')" 1 "every duplicate call returns that order"
order=$(q -c "select id from public.orders where idempotency_key = 'race:dup'")

# 3. Accept vs reject by different staff (owner by WhatsApp, cashier on the portal).
owner=$(q -c "select id from public.vendor_members where phone_e164 = '+96171000001'")
cashier=$(q -c "select id from public.vendor_members where phone_e164 = '+96171000002'")
for i in 1 2 3 4 5; do
  svc "select public.order_accept('$order', 10, '$owner', 'whatsapp') ->> 'status'" > "$TMPDIR_RACE/a$i" &
  svc "select public.order_reject('$order', 'busy', null, '$cashier', 'portal') ->> 'status'" > "$TMPDIR_RACE/r$i" &
done
wait
check "$(q -c "select count(*) from public.order_events where order_id = '$order' and from_status = 'placed' and to_status <> 'placed'")" 1 \
  "accept vs reject: exactly one transition from placed"
final=$(q -c "select status from public.orders where id = '$order'")
if [ "$final" = "accepted" ]; then
  check "$(cat "$TMPDIR_RACE"/r* | grep -c 'stale_status' || true)" 5 "every reject lost with stale_status"
else
  check "$final" rejected "the order is accepted or rejected"
  check "$(cat "$TMPDIR_RACE"/a* | grep -c 'stale_status' || true)" 5 "every accept lost with stale_status"
fi

# 4. Accept vs operator cancel.
order2=$(svc "select public.order_place('53000000-0000-0000-0000-000000000012', $version, 'race:cancel') ->> 'order_id'")
for i in 1 2 3 4 5; do
  svc "select public.order_accept('$order2', 10, '$owner') ->> 'status'" > "$TMPDIR_RACE/ca$i" &
  svc "select public.order_cancel_by_system('$order2', 'operator') ->> 'status'" > "$TMPDIR_RACE/cc$i" &
done
wait
final2=$(q -c "select status from public.orders where id = '$order2'")
check "$(q -c "select count(*) from public.order_events where order_id = '$order2' and from_status = 'placed' and to_status <> 'placed'")" 1 \
  "accept vs cancel: exactly one transition from placed"
check "$(q -c "select count(*) <= 1 from public.order_events where order_id = '$order2' and to_status = 'cancelled'")" t \
  "at most one cancel event"
check "$(q -c "select count(*) = 0 from public.order_events e where e.order_id = '$order2' and e.from_status = 'cancelled'")" t \
  "nothing happens after the cancel (final: $final2)"
# 5. Deadlock order: half the baskets hold labneh then zaatar, half zaatar then labneh.
version=$(q -c "select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a'")
q -c "select public.basket_price(('55000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid) from generate_series(1, 20) g" >/dev/null
for g in $(seq -w 1 20); do
  svc "select public.order_place('55000000-0000-0000-0000-0000000000$g', $version, 'race:deadlock:$g') ->> 'status'" > "$TMPDIR_RACE/k$g" &
done
wait
check "$(cat "$TMPDIR_RACE"/k* | grep -ci 'deadlock' || true)" 0 "opposite item orders never deadlock"
check "$(cat "$TMPDIR_RACE"/k* | grep -c '^placed$' || true)" 20 "all twenty orders are placed"
check "$(q -c "select daily_remaining from public.menu_items where id = '51000000-0000-0000-0000-000000000003'")" 80 "labneh: 100 - 20"
check "$(q -c "select daily_remaining from public.menu_items where id = '51000000-0000-0000-0000-000000000004'")" 80 "zaatar: 100 - 20"
# Lock-order probe (deterministic): another session holds labneh (the lower id); basket 21 holds zaatar then labneh. Placing
# it must wait on labneh first without holding zaatar, so zaatar stays free (it would be held by the old, basket-order code).
q -c "select public.basket_price('55000000-0000-0000-0000-000000000021')" >/dev/null
version=$(q -c "select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a'")
psql "$DB_URL" -X -q -tA -c "begin; select 1 from public.menu_items where id = '51000000-0000-0000-0000-000000000003' for update; select pg_sleep(3); commit;" >/dev/null 2>&1 &
holder=$!
q -c "select pg_sleep(0.7)" >/dev/null
# Index scans off: basket lines then come back in storage order (zaatar first), so the probe does not depend on the
# planner happening to read them through an index in item order.
svc "set enable_indexscan = off; set enable_bitmapscan = off; select public.order_place('55000000-0000-0000-0000-000000000021', $version, 'race:deadlock:probe') ->> 'status'" > "$TMPDIR_RACE/probe" &
placer=$!
q -c "select pg_sleep(0.7)" >/dev/null
free=$(psql "$DB_URL" -X -q -tA -c "select 1 from public.menu_items where id = '51000000-0000-0000-0000-000000000004' for update nowait" 2>/dev/null || echo locked)
wait "$holder" "$placer"
check "$free" 1 "a placement waiting on the lower item id holds no higher one (stock locked in item-id order)"
check "$(cat "$TMPDIR_RACE/probe")" placed "the waiting placement goes through once the lock is released"
exit "$fail"
