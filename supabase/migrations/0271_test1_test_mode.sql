-- Alo King Chouf, session TEST1, migration 0271: the friends' test mode. docs/DECISIONS.md, "TEST1, a working friends' test on staging,
-- 23 November 2026".
--
-- The founder's decision of 23 November: not launching yet (no stock, van, warehouse or label day); the founder's friends test the whole
-- system on WhatsApp and the website, end to end, now. One setting, `test_mode.enabled`, on for staging and impossible to turn on in
-- production (locked twice: this database refuses it unless it is marked as staging, and the gateway honours it only when its
-- ENVIRONMENT is "staging").
--
--   1 who may order        only numbers on the tester list (`settings.testers`, FD1); everyone else gets "we're not open yet" from the
--                          gateway (test_mode_gate). The probe keeps its own path.
--   2 what testers order   any hour; every active item with a hub price (stock and the label rule not required); dishes of the places a
--                          tester may order from, as before (invariant 11: approve_merchant() still decides), at any hour. Any pin: outside
--                          the served villages, the nearest served village's zone and fee (save_customer_pin), and the card says that no
--                          delivery happens (the test line).
--   3 test orders          `orders.is_test`, set when the order is made. No stock moves (reserve_stock and settle_stock do nothing for
--                          them), no rider is offered one, no picker sees one, no payment or ledger row is ever made (a test order ends at
--                          delivered and never closes: invariant 12 holds, delivered is not paid). The confirmation is still the
--                          customer's own tap (invariant 4): nothing here confirms.
--   4 the walk             after the tap a test order advances by itself, about 1 to 2 minutes a step (test_orders_due,
--                          test_order_advance): being prepared, on the way, at the door, delivered, then the feedback question. The
--                          gateway's cron sends the real customer messages (apps/gateway, test-mode.ts). A food test order's call ahead is
--                          simulated and accepted with the place's preparation time: no task for staff, so nobody phones a real place.
--   5 clearing             clear_test_orders(): test orders only, logged (test_mode_log); open ones cancelled without a customer notice.
--   6 the catalogue feed   in test mode every item in the feed is "in stock" (it lists only items with an approved picture, as before).

-- ---------- 0. this database is staging (written by scripts/staging/prepare-staging.sql only) ----------
create table if not exists deployment_marker (
  environment text primary key check (environment = 'staging'),
  marked_at   timestamptz not null default now()
);
comment on table deployment_marker is 'TEST1. One row, written only by scripts/staging/prepare-staging.sql: this database is staging. Production never has it, so test mode cannot be switched on there.';
alter table deployment_marker enable row level security;

create or replace function db_is_staging() returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from deployment_marker where environment = 'staging') $$;

-- ---------- 1. the setting, and its lock ----------
insert into settings(key, value) values ('test_mode', '{"enabled": false, "step_min_s": 60, "step_max_s": 120}'::jsonb)
  on conflict (key) do nothing;

create or replace function test_mode_staging_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key = 'test_mode' and coalesce((new.value->>'enabled')::boolean, false) and not db_is_staging() then
    raise exception 'TEST_MODE_STAGING_ONLY: test mode can be switched on only in a database marked as staging';
  end if;
  return new;
end $$;
drop trigger if exists settings_test_mode_staging_only on settings;
create trigger settings_test_mode_staging_only before insert or update on settings for each row execute function test_mode_staging_only();

-- On the Settings page (admin; staging only by the trigger above).
insert into editable_settings(key, field, kind, two_person) values ('test_mode', 'enabled', 'bool', false)
  on conflict do nothing;

create or replace function test_mode_on() returns boolean language sql stable set search_path = public, pg_temp as $$
  select db_is_staging() and coalesce((setting('test_mode')->>'enabled')::boolean, false) $$;

create or replace function is_test_party(p_party uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select p_party is not null and test_mode_on() and is_tester(p_party) $$;

-- The gateway asks this before any model on the customer line (after STOP). Allowed: test mode off, a tester, or the staging probe.
create or replace function test_mode_gate(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('on', test_mode_on(),
           'tester', coalesce(is_tester(p_party), false),
           'allowed', not test_mode_on() or coalesce(is_tester(p_party), false)
                      or coalesce((select is_probe from parties where id = p_party), false)) $$;

create table if not exists test_mode_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  action    text not null check (action in ('clear_test_orders')),
  by_party  uuid references parties(id),
  reason    text,
  detail    jsonb not null default '{}'
);
comment on table test_mode_log is 'TEST1. What was done to test orders by staff (Clear test orders on the console), who, when and why.';
alter table test_mode_log enable row level security;

-- ---------- 2. test orders ----------
alter table orders add column if not exists is_test boolean not null default false;
alter table orders add column if not exists test_cleared_at timestamptz;
alter table orders add column if not exists test_cleared_by uuid references parties(id);
create index if not exists orders_test_open on orders(status) where is_test and test_cleared_at is null;
comment on column orders.is_test is 'TEST1. A tester''s order while test mode is on: no stock, rider, payment or ledger; it walks by itself to delivered.';

create or replace function orders_mark_test() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.is_test := coalesce(new.is_test, false) or is_test_party(new.customer_id);
  return new;
end $$;
drop trigger if exists orders_mark_test on orders;
create trigger orders_mark_test before insert on orders for each row execute function orders_mark_test();

create or replace function test_order_line(p_order uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select customer_language(o.customer_id) from orders o where o.id = p_order and o.is_test $$;

-- ---------- 3. what a tester may order ----------
-- A hub item with a price is orderable for a tester (no stock, no label, no price-basis question). Dishes keep FD1's rule: the place
-- must be approved (approve_merchant) and visible to this customer.
alter function product_orderable_for(uuid, uuid) rename to product_orderable_for_before_test1;
create or replace function product_orderable_for(p_product uuid, p_party uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select case when is_test_party(p_party) and exists (
                     select 1 from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id
                      where p.id = p_product and p.is_active and s.kind = 'dark_store' and o.price_usd > 0)
              then true
              else product_orderable_for_before_test1(p_product, p_party) end $$;

-- A place's hours do not stop a tester (any hour). Everyone else: the place's own hours, as before.
create or replace function place_open_for(p_source uuid, p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case when is_test_party(p_party) then place_open_now(p_source) || jsonb_build_object('open', true, 'reason', null, 'test_any_hour', true)
              else place_open_now(p_source) end $$;

-- The quote for a tester: the hours, the place's hours and stock do not stop it; the minimum still does. Everyone else: unchanged.
alter function quote_order(jsonb, uuid, boolean, uuid, uuid) rename to quote_order_before_test1;
create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false, p_slot uuid default null,
                                       p_party uuid default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare q jsonb; ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb; v_sub numeric := 0; v_total numeric; v_fx numeric;
        v_min numeric := (setting('min_order_usd'))::text::numeric;
        -- The planner prices a basket without naming the customer (0053 onward); plan_order (below) names the tester for this
        -- transaction only. Anyone else: p_party as given, unchanged.
        v_party uuid := coalesce(p_party, nullif(current_setting('alo.test_party', true), '')::uuid);
begin
  if not is_test_party(v_party) then return quote_order_before_test1(p_lines, p_village, p_pickup, p_slot, p_party); end if;
  q := quote_order_before_test1(p_lines, p_village, p_pickup, p_slot, v_party);
  for ln in select * from jsonb_array_elements(coalesce(q->'lines', '[]'::jsonb)) loop
    if not coalesce((ln->>'ok')::boolean, false) and not coalesce((ln->>'coming_soon')::boolean, false) then
      ln := ln || jsonb_build_object('ok', true, 'test_no_stock', true);
    end if;
    if coalesce((ln->>'ok')::boolean, false) then v_sub := v_sub + coalesce((ln->>'line_total_usd')::numeric, 0); end if;
    v_lines := v_lines || ln;
  end loop;
  select coalesce(jsonb_agg(i), '[]'::jsonb) into v_issues from jsonb_array_elements(coalesce(q->'issues', '[]'::jsonb)) i
   where i->>'code' not in ('closed', 'place_closed', 'out_of_stock', 'insufficient_stock', 'below_minimum');
  if v_sub > 0 and v_sub < v_min then
    v_issues := v_issues || jsonb_build_object('code', 'below_minimum', 'minimum_usd', v_min, 'subtotal_usd', v_sub);
  end if;
  v_total := v_sub + coalesce((q->>'delivery_fee_usd')::numeric, 0) + coalesce((q->>'small_order_fee_usd')::numeric, 0)
           + coalesce((q->>'service_fee_usd')::numeric, 0);
  v_fx := (q->>'fx_rate_lbp')::numeric;
  return q || jsonb_build_object('ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'lines', v_lines, 'subtotal_usd', v_sub,
    'total_usd', v_total, 'total_lbp', case when v_fx is null then null else round(v_total * v_fx / 1000) * 1000 end, 'test_order', true);
end $$;

-- The planner (plan_order, 0022, over plan_order_core) quotes the basket for nobody. For a tester only, it is told who is asking, for
-- the length of this call (a transaction-local setting, cleared after).
alter function plan_order(uuid, jsonb, uuid, jsonb) rename to plan_order_before_test1;
create or replace function plan_order(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r jsonb; v_test boolean := is_test_party(p_party);
begin
  if v_test then perform set_config('alo.test_party', p_party::text, true); end if;
  r := plan_order_before_test1(p_party, p_intent, p_village, p_choices);
  if v_test then perform set_config('alo.test_party', '', true); end if;
  return r;
end $$;

-- The confirm tap's re-check (0249's text, with the place's hours through place_open_for).
create or replace function order_quote_issues(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('item', i.name_snapshot, 'issue',
           case when not product_orderable_for(i.product_id, o.customer_id) then 'coming_soon'
                when ofr.id is null or not ofr.is_available then 'unavailable'
                when not s.is_open then 'source_closed'
                when s.buys_for_customer and not (place_open_for(s.id, o.customer_id)->>'open')::boolean then 'source_closed'
                else 'price_changed' end, 'was_usd', i.unit_price_usd, 'now_usd', ofr.price_usd + x.delta)), '[]'::jsonb)
    from order_items i join orders o on o.id = i.order_id join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
    left join offers ofr on ofr.source_id = f.source_id and ofr.product_id = i.product_id
    cross join lateral (select coalesce(sum(d.price_delta_usd), 0) as delta from dish_options d
                         where d.id in (select (e->>'id')::uuid from jsonb_array_elements(i.options) e)) x
   where i.order_id = p_order and i.status = 'ok'
     and (not product_orderable_for(i.product_id, o.customer_id) or ofr.id is null or not ofr.is_available or not s.is_open
          or (s.buys_for_customer and not (place_open_for(s.id, o.customer_id)->>'open')::boolean)
          or ofr.price_usd + x.delta <> i.unit_price_usd) $$;

-- A cart from the catalogue is priced for the customer who sent it (0226 quoted it with nobody, so a tester's rules never applied).
alter function plan_cart(uuid, jsonb, uuid, text) rename to plan_cart_before_test1;
create or replace function plan_cart(p_party uuid, p_items jsonb, p_village uuid default null, p_catalog text default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare r jsonb := plan_cart_before_test1(p_party, p_items, p_village, p_catalog); v_lines jsonb; v_quote jsonb; v_removed jsonb; v_soon text[];
begin
  if not is_test_party(p_party) or not coalesce((r->>'ok')::boolean, false) then return r; end if;
  -- Priced again under the tester's rules (0226 quoted the cart for nobody): every known item of the cart, the same product once.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', pid, 'qty', q)), '[]'::jsonb) into v_lines
    from (select l->>'product_id' as pid, least(sum((l->>'qty')::int), 99) as q from jsonb_array_elements(r->'lines') l group by 1) y;
  if jsonb_array_length(v_lines) = 0 then return r; end if;
  v_quote := quote_order(v_lines, (r->>'village_id')::uuid, false, null, p_party);
  -- What is still not for sale to a tester (a dish of a place they may not order from): named and left out, as 0226 does.
  select coalesce(array_agg(ql->>'product_id'), '{}') into v_soon from jsonb_array_elements(v_quote->'lines') ql
   where coalesce((ql->>'coming_soon')::boolean, false);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_removed from (
    select x from jsonb_array_elements(r->'removed') x where x->>'reason' = 'unknown'
    union all
    select jsonb_build_object('sku', l->>'sku', 'name', l->>'name', 'name_ar', l->>'name_ar', 'reason', 'coming_soon')
      from jsonb_array_elements(r->'lines') l where l->>'product_id' = any(v_soon)) y;
  if array_length(v_soon, 1) > 0 then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_lines from jsonb_array_elements(v_lines) x where not (x->>'product_id' = any(v_soon));
    v_quote := case when jsonb_array_length(v_lines) > 0 then quote_order(v_lines, (r->>'village_id')::uuid, false, null, p_party) end;
  end if;
  return r || jsonb_build_object('quote_lines', v_lines, 'quote', v_quote, 'issues', coalesce(v_quote->'issues', '[]'::jsonb), 'removed', v_removed);
end $$;

-- Any pin: outside the served villages, a tester's place takes the nearest served village (its zone's fee). Nothing is delivered.
alter function save_customer_pin(uuid, double precision, double precision, uuid) rename to save_customer_pin_before_test1;
create or replace function save_customer_pin(p_party uuid, p_lat double precision, p_lng double precision, p_village uuid default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r jsonb := save_customer_pin_before_test1(p_party, p_lat, p_lng, p_village); v_near uuid;
begin
  if not is_test_party(p_party) then return r; end if;
  if (r->>'village_id') is not null and coalesce((r->>'served')::boolean, false) then return r; end if;
  select v.id into v_near from villages v join zones z on z.id = v.zone_id
   where v.is_served and v.lat is not null and v.lng is not null and z.delivery_fee_usd is not null
   order by geo_km(p_lat, p_lng, v.lat, v.lng) limit 1;
  if v_near is null then return r; end if;
  update customer_places set village_id = v_near where id = (r->>'place_id')::uuid;
  return r || jsonb_build_object('village_id', v_near, 'status', 'located', 'served', true, 'candidates', '[]'::jsonb, 'test_outside_area', true,
    'village', (select name_en from villages where id = v_near), 'village_ar', (select name_ar from villages where id = v_near));
end $$;

-- ---------- 4. nothing moves for a test order ----------
alter function reserve_stock(uuid) rename to reserve_stock_before_test1;
create or replace function reserve_stock(p_order uuid) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from orders where id = p_order and is_test) then return; end if;
  perform reserve_stock_before_test1(p_order);
end $$;

alter function settle_stock(uuid, boolean) rename to settle_stock_before_test1;
create or replace function settle_stock(p_order uuid, p_picked boolean) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from orders where id = p_order and is_test) then return; end if;
  perform settle_stock_before_test1(p_order, p_picked);
end $$;

-- A test order walks forward by itself (actor system, no rider) and never closes. Every other order and every other move: unchanged
-- (0002's transition_order, the order_transitions rows and packages/core/src/order-machine.ts are not touched).
alter function transition_order(uuid, order_status, actor_kind, uuid, text, jsonb) rename to transition_order_before_test1;
create or replace function transition_order(
  p_order uuid, p_to order_status, p_actor actor_kind,
  p_actor_id uuid default null, p_reason text default null, p_meta jsonb default '{}'
) returns order_status language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order;
  if found and o.is_test then
    if o.status = p_to then return o.status; end if;
    if p_to = 'closed' then raise exception 'TEST_ORDER_NEVER_CLOSES: a test order ends at delivered; nothing was paid'; end if;
    if p_actor = 'system' and (o.status::text || '>' || p_to::text) in
         ('confirmed>preparing', 'preparing>ready', 'ready>out_for_delivery', 'out_for_delivery>arrived', 'arrived>delivered') then
      perform 1 from orders where id = p_order for update;
      update orders set status = p_to, delivered_at = case when p_to = 'delivered' then now() else delivered_at end where id = p_order;
      insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
        values (p_order, o.status, p_to, p_actor, p_actor_id, coalesce(p_reason, 'test_order_walk'), coalesce(p_meta, '{}'::jsonb) || '{"test_order": true}'::jsonb);
      return p_to;
    end if;
  end if;
  return transition_order_before_test1(p_order, p_to, p_actor, p_actor_id, p_reason, p_meta);
end $$;

-- No rider is offered a test order, and no picker sees one.
alter function dispatch_order(uuid) rename to dispatch_order_before_test1;
create or replace function dispatch_order(p_order uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from orders where id = p_order and is_test) then
    return jsonb_build_object('status', 'test_order', 'order_id', p_order);
  end if;
  return dispatch_order_before_test1(p_order);
end $$;

create or replace function orders_waiting_for_rider() returns uuid[] language sql stable set search_path = public, pg_temp as $$
  select coalesce(array_agg(o.id order by coalesce(o.released_at, o.confirmed_at)), '{}') from orders o
   where (o.status in ('confirmed','preparing','ready') or order_stranded(o.id)) and not o.is_pickup and not o.is_test
     and (o.delivery_slot_id is null or o.released_at is not null or order_release_at(o.id) <= now())
     and not exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                      where s.order_id = o.id and d.status in ('offered','accepted','in_progress')) $$;

create or replace function pick_queue(p_limit int default 5) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'status' desc, x->>'confirmed_at'), '[]'::jsonb) from (
    select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'confirmed_at', o.confirmed_at,
             'village', v.name_ar, 'picker_id', ps.picker_id, 'window', window_json(o.delivery_slot_id),
             'items', (select count(*) from order_items i where i.order_id = o.id and i.status = 'ok')) as x
      from orders o left join pick_sessions ps on ps.order_id = o.id and ps.finished_at is null left join villages v on v.id = o.village_id
     where ((o.status = 'confirmed' and ps.order_id is null) or (o.status = 'preparing' and ps.order_id is not null))
       and not o.is_test
       and order_has_hub_goods(o.id) and (o.delivery_slot_id is null or o.released_at is not null)
     order by (o.status = 'preparing') desc, coalesce(o.released_at, o.confirmed_at) limit p_limit) q $$;

-- A food test order's call ahead: simulated and accepted at once with the place's preparation time. No task reaches staff, so nobody
-- phones the place (the founder's rule: never phone, message or contact a real place for a test order). Other orders: 0250 unchanged.
create or replace function place_call_on_confirm() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_src uuid; v_id uuid; v_prep int; v_test boolean;
begin
  if new.to_status = 'confirmed' and new.from_status is distinct from 'confirmed' then
    select s.id, s.prep_minutes into v_src, v_prep from fulfilments f join sources s on s.id = f.source_id
     where f.order_id = new.order_id and s.buys_for_customer and f.status <> 'cancelled' limit 1;
    if v_src is not null then
      select is_test into v_test from orders where id = new.order_id;
      if coalesce(v_test, false) then
        v_prep := least(greatest(coalesce(v_prep, 20), 0), 180);
        insert into place_calls(order_id, source_id, status, ready_in_min, accepted_at, ready_at)
          values (new.order_id, v_src, 'accepted', v_prep, now(), now() + make_interval(mins => v_prep))
          on conflict (order_id) do nothing returning id into v_id;
        if v_id is not null then
          insert into place_call_log(call_id, action, detail) values
            (v_id, 'created', jsonb_build_object('order_id', new.order_id, 'test_order', true)),
            (v_id, 'accepted', jsonb_build_object('order_id', new.order_id, 'ready_in_min', v_prep, 'simulated', true, 'test_order', true));
        end if;
      else
        insert into place_calls(order_id, source_id) values (new.order_id, v_src) on conflict (order_id) do nothing returning id into v_id;
        if v_id is not null then insert into place_call_log(call_id, action, detail) values (v_id, 'created', jsonb_build_object('order_id', new.order_id)); end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- A cleared test order is not told it was cancelled.
alter function customer_notices_due() rename to customer_notices_due_before_test1;
create or replace function customer_notices_due() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(customer_notices_due_before_test1()) x
   where not exists (select 1 from orders o where o.id = (x->>'order_id')::uuid and o.is_test and o.test_cleared_at is not null) $$;

-- ---------- 5. the walk ----------
create table if not exists test_order_steps (
  order_id  uuid not null references orders(id) on delete cascade,
  step      text not null check (step in ('preparing', 'on_the_way', 'at_door', 'delivered', 'feedback')),
  done_at   timestamptz not null default now(),
  sent_at   timestamptz,
  primary key (order_id, step)
);
comment on table test_order_steps is 'TEST1. Each step a test order took by itself, and when its customer message went.';
alter table test_order_steps enable row level security;

create or replace function test_step_gap_s(p_order uuid, p_step text) returns int language sql stable set search_path = public, pg_temp as $$
  select coalesce((setting('test_mode')->>'step_min_s')::int, 60)
       + abs(hashtext(p_order::text || p_step)) % (greatest(coalesce((setting('test_mode')->>'step_max_s')::int, 120)
                                                            - coalesce((setting('test_mode')->>'step_min_s')::int, 60), 0) + 1) $$;

-- The next step of each open test order, when it is due; a step done whose message has not gone yet comes back first.
create or replace function test_orders_due(p_limit int default 20) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with t as (
    select o.id, o.short_code, o.customer_id, o.status, o.confirmed_at, o.village_id,
           (select s.step from test_order_steps s where s.order_id = o.id and s.sent_at is null order by s.done_at limit 1) as unsent,
           (select max(s.sent_at) from test_order_steps s where s.order_id = o.id) as last_sent,
           (select array_agg(s.step) from test_order_steps s where s.order_id = o.id) as done
      from orders o
     where o.is_test and o.test_cleared_at is null and o.confirmed_at is not null
       and o.status in ('confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'delivered')
       and o.confirmed_at > now() - interval '1 day'),
  nxt as (
    select t.*, coalesce(t.unsent, case
             when t.status = 'confirmed' and not ('preparing' = any(coalesce(t.done, '{}'))) then 'preparing'
             when t.status in ('preparing', 'ready') and not ('on_the_way' = any(coalesce(t.done, '{}'))) then 'on_the_way'
             when t.status = 'out_for_delivery' and not ('at_door' = any(coalesce(t.done, '{}'))) then 'at_door'
             when t.status = 'arrived' and not ('delivered' = any(coalesce(t.done, '{}'))) then 'delivered'
             when t.status = 'delivered' and not ('feedback' = any(coalesce(t.done, '{}'))) then 'feedback' end) as step
      from t)
  select coalesce(jsonb_agg(jsonb_build_object('order_id', n.id, 'short_code', n.short_code, 'customer_id', n.customer_id, 'step', n.step,
           'resend', n.unsent is not null, 'lang', customer_language(n.customer_id),
           'food', exists (select 1 from place_calls c where c.order_id = n.id),
           'place', (select s.name from place_calls c join sources s on s.id = c.source_id where c.order_id = n.id),
           'eta_minutes', coalesce((select c.ready_in_min + coalesce(round(travel_minutes(s.village_id, n.village_id))::int, 0)
                                      from place_calls c join sources s on s.id = c.source_id where c.order_id = n.id),
                                   (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = n.village_id)))
           order by n.confirmed_at), '[]'::jsonb)
    from (select * from nxt
           where step is not null
             and (unsent is not null or now() >= coalesce(last_sent, confirmed_at) + make_interval(secs => test_step_gap_s(id, step)))
           order by confirmed_at limit p_limit) n $$;

-- Takes the step (the status moves, actor system) and records it. True when the step is done (now or before); false when the order
-- is not a test order any more or is not where the step starts (cancelled meanwhile, cleared).
create or replace function test_order_advance(p_order uuid, p_step text) returns boolean language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found or not o.is_test or o.test_cleared_at is not null then return false; end if;
  if exists (select 1 from test_order_steps where order_id = p_order and step = p_step) then return true; end if;
  if p_step = 'preparing' and o.status = 'confirmed' then
    perform transition_order(p_order, 'preparing', 'system', null, 'test_order_walk');
  elsif p_step = 'on_the_way' and o.status in ('preparing', 'ready') then
    if o.status = 'preparing' then perform transition_order(p_order, 'ready', 'system', null, 'test_order_walk'); end if;
    perform transition_order(p_order, 'out_for_delivery', 'system', null, 'test_order_walk');
  elsif p_step = 'at_door' and o.status = 'out_for_delivery' then
    perform transition_order(p_order, 'arrived', 'system', null, 'test_order_walk');
  elsif p_step = 'delivered' and o.status = 'arrived' then
    perform transition_order(p_order, 'delivered', 'system', null, 'test_order_walk');
  elsif p_step = 'feedback' and o.status = 'delivered' then
    perform mark_feedback_asked(p_order);
  else
    return false;
  end if;
  insert into test_order_steps(order_id, step) values (p_order, p_step) on conflict do nothing;
  return true;
end $$;

create or replace function test_order_step_sent(p_order uuid, p_step text) returns void language sql set search_path = public, pg_temp as $$
  update test_order_steps set sent_at = coalesce(sent_at, now()) where order_id = p_order and step = p_step $$;

-- ---------- 6. clearing ----------
create or replace function clear_test_orders(p_by uuid, p_reason text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o record; v_codes text[] := '{}'; v_moved int;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  for o in select * from orders where is_test and test_cleared_at is null order by created_at for update loop
    if o.status not in ('cancelled', 'closed', 'delivered') then
      update orders set status = 'cancelled', cancel_reason = 'test_cleared' where id = o.id;
      insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
        values (o.id, o.status, 'cancelled', 'ops', p_by, 'test_cleared', '{"test_order": true}'::jsonb);
    end if;
    update place_calls set status = 'cancelled', updated_at = now(), updated_by = p_by
     where order_id = o.id and status in ('to_call', 'waiting_customer', 'accepted');
    update orders set test_cleared_at = now(), test_cleared_by = p_by where id = o.id;
    v_codes := v_codes || o.short_code;
  end loop;
  -- What must never exist for a test order: said, never hidden.
  select (select count(*) from stock_movements m join orders x on x.id = m.order_id where x.is_test)
       + (select count(*) from payments p join orders x on x.id = p.order_id where x.is_test)
       + (select count(*) from ledger_entries e join orders x on x.id = e.order_id where x.is_test) into v_moved;
  insert into test_mode_log(action, by_party, reason, detail)
    values ('clear_test_orders', p_by, btrim(p_reason), jsonb_build_object('count', coalesce(array_length(v_codes, 1), 0), 'codes', to_jsonb(v_codes),
                                                                         'money_or_stock_rows', v_moved));
  return jsonb_build_object('cleared', coalesce(array_length(v_codes, 1), 0), 'codes', to_jsonb(v_codes), 'money_or_stock_rows', v_moved);
end $$;

-- ---------- 7. the catalogue feed: every listed item is in stock in test mode ----------
create or replace function catalog_feed() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
           'brand', coalesce(nullif(p.brand, ''), 'Alo King'),
           'price_usd', o.price_usd,
           'in_stock', case when test_mode_on() then o.price_usd > 0
                            else coalesce(l.on_hand - l.reserved, 0) > 0 and product_orderable(p.id) end,
           'media_path', i.media_path, 'public_path', cp.public_path, 'feed_jpeg_path', fj.public_path, 'attribution', i.attribution, 'licence', i.licence,
           'category_code', c.code, 'category_en', c.name_en, 'category_ar', c.name_ar,
           'subgroup_en', sg.name_en, 'subgroup_ar', sg.name_ar)
         order by c.sort_order, pl.sort_in_category), '[]'::jsonb)
    from catalog_placements pl
    join catalog_categories c on c.code = pl.category_code and c.is_active
    left join catalog_subgroups sg on sg.category_code = pl.category_code and sg.code = pl.subgroup_code
    join products p on p.sku = pl.sku and p.is_active
    join lateral (select ofr.price_usd, ofr.source_id from offers ofr join sources s on s.id = ofr.source_id
                   where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
    join product_images i on i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence)
    left join catalog_public_pictures cp on cp.image_id = i.id
    left join catalog_feed_jpegs fj on fj.image_id = i.id $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table deployment_marker, test_mode_log, test_order_steps from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table deployment_marker, test_mode_log, test_order_steps from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert on table deployment_marker to service_role;
    grant select, insert on table test_mode_log to service_role;
    grant select, insert, update on table test_order_steps to service_role;
  end if;
end $$;
