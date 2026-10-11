-- Session 5 (DECISIONS §32.5): the merchant WhatsApp extras. Contents:
--   1. config
--   2. vendor_ops: per-branch operating state (kitchen capacity, generator mode, same-price confirmation),
--      kept off the frozen vendors table (§31)
--   3. proposals: the new kinds confirm through the merchant's tap like every other change (§18.2), with
--      the roles of §18.1 H (staff: owner only; capacity and same-price badge: owner or manager)
--   4. kitchen capacity: above the limit new orders get longer ETAs; at twice the limit new orders pause
--      until the queue drops below the limit
--   5. generator mode: items tagged needs_power are hidden at that branch and restored on "power back"
--   6. staff by WhatsApp
--   7. shift handover
--   8. substitution preference and substitute offers (grocery types, COD orders)
--   9. the visual order card's data and the same-price badge
-- Nothing here changes a price from a message: substitutes are priced from the menu, totals by the server.

-- 1. Config ------------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §32.5, 11 October 2026 (session 5)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('kitchen_eta_step_min', '5', '2026-10-11 00:00+03', 'Minutes added to a new order''s prep time per order above the branch''s capacity (§32.5)', null),
  ('kitchen_pause_factor', '2', '2026-10-11 00:00+03', 'New orders pause at this multiple of the capacity until the queue drops below it (§32.5)', null),
  ('kitchen_pause_max_min', '120', '2026-10-11 00:00+03', 'Longest automatic kitchen-full pause; the next order re-checks', null),
  ('shift_gap_hours', '6', '2026-10-11 00:00+03', 'A staff member silent this long starts a new shift and gets the handover (§32.5)', null),
  ('substitution_business_types', '["grocery_supermarket", "minimarket", "produce", "home_essentials", "roastery_nuts", "butcher", "poultry", "fish_market"]', '2026-10-11 00:00+03', 'Business types whose checkout asks the substitution preference (§32.5)', null),
  ('substitution_default_max_usd', '2', '2026-10-11 00:00+03', 'The "replace if it costs up to $X more" choice at checkout (§32.5)', null),
  ('order_card_image_enabled', 'false', '2026-10-11 00:00+03', 'Send the gold order card image with the confirmation (§32.5); on once the renderer is deployed and checked', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Operating state per branch ------------------------------------------------------------------------------
create table public.vendor_ops (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  max_active_orders integer check (max_active_orders between 1 and 200),
  capacity_paused boolean not null default false,
  -- The merchant reopened ("open") while the kitchen was full: no automatic pause until the queue drops.
  capacity_override boolean not null default false,
  power_off_since timestamptz,
  same_price_confirmed_at timestamptz,
  same_price_member_id uuid references public.vendor_members (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger vendor_ops_touch before update on public.vendor_ops
  for each row execute function app_private.touch_updated_at();
create trigger vendor_ops_audit after insert or update or delete on public.vendor_ops
  for each row execute function app_private.audit_row();
alter table public.vendor_ops enable row level security;
revoke all on table public.vendor_ops from public, anon, authenticated;
grant all on table public.vendor_ops to service_role;
grant select on table public.vendor_ops to authenticated;
create policy vendor_ops_read on public.vendor_ops for select to authenticated
  using ((select app_private.is_operator())
         or exists (select 1 from public.vendor_members m where m.vendor_id = vendor_ops.vendor_id
                    and m.user_id = (select auth.uid()) and m.status = 'active'));

-- Items that need electricity (oven, fryer, grill on the mains): hidden in generator mode.
alter table public.menu_items add column needs_power boolean not null default false;
-- The items generator mode hid, so "power back" restores exactly those.
create table app_private.power_hidden_items (
  item_id uuid primary key references public.menu_items (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  hidden_at timestamptz not null default now()
);
revoke all on table app_private.power_hidden_items from public, anon, authenticated;

-- 3. Proposals -----------------------------------------------------------------------------------------------
-- Who may propose and confirm each kind (§18.1 H).
create function app_private.proposal_roles(p_kind public.proposal_kind) returns public.member_role[]
language sql immutable set search_path = ''
as $$
  select case
    when p_kind in ('staff_add', 'staff_remove') then array['owner']::public.member_role[]
    when p_kind in ('price', 'capacity', 'same_price', 'needs_power') then array['owner', 'manager']::public.member_role[]
    else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end;
$$;
revoke all on function app_private.proposal_roles(public.proposal_kind) from public;

create or replace function app_private.merchant_proposal_create(
  p_vendor_id uuid,
  p_kind public.proposal_kind,
  p_payload jsonb,
  p_source text,
  p_member_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_id uuid;
  v_item uuid := nullif(p_payload ->> 'item_id', '')::uuid;
  v_target public.vendor_members%rowtype;
begin
  v_member := app_private.order_actor(p_vendor_id, app_private.proposal_roles(p_kind), p_member_id);
  if p_kind in ('sold_out', 'back_in_stock', 'price', 'stock_add', 'needs_power') and not exists (
    select 1 from public.menu_items i where i.id = v_item and i.vendor_id = p_vendor_id
  ) then
    raise exception 'unknown item for this merchant' using errcode = 'check_violation';
  end if;
  if p_kind = 'price' and ((p_payload ->> 'price_usd')::numeric is null or (p_payload ->> 'price_usd')::numeric < 0
                           or (p_payload ->> 'price_usd')::numeric > 10000) then
    raise exception 'price must be between 0 and 10000 USD' using errcode = 'check_violation';
  end if;
  if p_kind = 'pause' and ((p_payload ->> 'until')::timestamptz is null or (p_payload ->> 'until')::timestamptz <= now()
                           or (p_payload ->> 'until')::timestamptz > now() + interval '7 days') then
    raise exception 'a pause ends in the next 7 days' using errcode = 'check_violation';
  end if;
  if p_kind = 'stock_add' and coalesce((p_payload ->> 'add')::int, 0) not between 1 and 1000 then
    raise exception 'stock to add must be 1-1000' using errcode = 'check_violation';
  end if;
  if p_kind = 'capacity' and p_payload ? 'max' and jsonb_typeof(p_payload -> 'max') <> 'null'
     and coalesce((p_payload ->> 'max')::int, 0) not between 1 and 200 then
    raise exception 'capacity is 1-200 active orders, or off' using errcode = 'check_violation';
  end if;
  if p_kind in ('same_price', 'needs_power') and jsonb_typeof(p_payload -> 'on') is distinct from 'boolean' then
    raise exception 'on must be true or false' using errcode = 'check_violation';
  end if;
  if p_kind = 'staff_add' then
    if coalesce(p_payload ->> 'phone', '') !~ '^\+[1-9][0-9]{6,14}$'
       or coalesce(p_payload ->> 'role', '') not in ('manager', 'cashier', 'kitchen', 'driver')
       or char_length(trim(coalesce(p_payload ->> 'name', ''))) not between 1 and 60 then
      raise exception 'staff needs a name, a phone in E.164 and a role (manager, cashier, kitchen or driver)' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.vendor_members m where m.vendor_id = p_vendor_id and m.phone_e164 = p_payload ->> 'phone'
               and m.role = 'owner') then
      raise exception 'that number is an owner of this branch' using errcode = 'check_violation';
    end if;
  end if;
  if p_kind = 'staff_remove' then
    select * into v_target from public.vendor_members m where m.id = nullif(p_payload ->> 'member_id', '')::uuid and m.vendor_id = p_vendor_id;
    if v_target.id is null or v_target.status = 'revoked' then
      raise exception 'unknown staff member for this branch' using errcode = 'check_violation';
    end if;
    if v_target.role = 'owner' or v_target.id = v_member then
      raise exception 'an owner is not removed by message' using errcode = 'check_violation';
    end if;
  end if;
  insert into public.merchant_proposals (vendor_id, member_id, kind, payload, source, expires_at)
  values (p_vendor_id, v_member, p_kind, coalesce(p_payload, '{}'), p_source,
          now() + make_interval(secs => public.config_numeric('merchant_proposal_ttl_s')))
  returning id into v_id;
  return v_id;
end;
$$;

-- The confirming tap. Applies the change and returns what happened.
create or replace function app_private.merchant_proposal_decide(p_proposal_id uuid, p_confirm boolean, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.merchant_proposals%rowtype;
  v_member uuid;
  v_item uuid;
  v_n integer;
  v_extra jsonb := '{}';
  v_user uuid;
begin
  select * into v_p from public.merchant_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    raise exception 'unknown proposal' using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_p.vendor_id, app_private.proposal_roles(v_p.kind), p_member_id);
  -- Staff changes are never confirmed as "the system": a member (or an operator) must be the one tapping.
  if v_p.kind in ('staff_add', 'staff_remove') and v_member is null and not app_private.is_operator() then
    raise exception 'not allowed to act on this vendor''s orders' using errcode = 'insufficient_privilege';
  end if;
  if v_p.status <> 'proposed' then
    return jsonb_build_object('status', v_p.status);
  end if;
  if v_p.expires_at < now() then
    update public.merchant_proposals set status = 'expired', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not p_confirm then
    update public.merchant_proposals set status = 'rejected', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'merchant proposal ' || p_proposal_id || ' confirmed', true);
  v_item := nullif(v_p.payload ->> 'item_id', '')::uuid;
  case v_p.kind
    when 'pause' then perform app_private.vendor_set_pause(v_p.vendor_id, (v_p.payload ->> 'until')::timestamptz, 'merchant pause', 'pause');
    when 'resume' then
      perform app_private.vendor_set_pause(v_p.vendor_id, null, null, 'resume');
      update public.vendors set missed_orders_streak = 0 where id = v_p.vendor_id;
      update public.vendor_ops set capacity_override = capacity_paused or capacity_override, capacity_paused = false
      where vendor_id = v_p.vendor_id;
    when 'sold_out' then update public.menu_items set available = false where id = v_item and vendor_id = v_p.vendor_id;
    when 'back_in_stock' then update public.menu_items set available = true where id = v_item and vendor_id = v_p.vendor_id;
    when 'price' then update public.menu_items set price_usd = (v_p.payload ->> 'price_usd')::numeric where id = v_item and vendor_id = v_p.vendor_id;
    when 'stock_add' then
      update public.menu_items set
        daily_quantity = case when daily_date = current_date then daily_quantity else 0 end + (v_p.payload ->> 'add')::int,
        daily_remaining = case when daily_date = current_date then daily_remaining else 0 end + (v_p.payload ->> 'add')::int,
        daily_date = current_date
      where id = v_item and vendor_id = v_p.vendor_id;
    when 'needs_power' then
      update public.menu_items set needs_power = (v_p.payload ->> 'on')::boolean where id = v_item and vendor_id = v_p.vendor_id;
    when 'power_off' then
      v_n := app_private.vendor_power_off(v_p.vendor_id);
      v_extra := jsonb_build_object('hidden', v_n);
    when 'power_on' then
      v_n := app_private.vendor_power_on(v_p.vendor_id);
      v_extra := jsonb_build_object('restored', v_n);
    when 'capacity' then
      insert into public.vendor_ops (vendor_id, max_active_orders) values (v_p.vendor_id, nullif(v_p.payload ->> 'max', '')::int)
      on conflict (vendor_id) do update set max_active_orders = excluded.max_active_orders;
      perform app_private.kitchen_capacity_check(v_p.vendor_id);
    when 'same_price' then
      insert into public.vendor_ops (vendor_id, same_price_confirmed_at, same_price_member_id)
      values (v_p.vendor_id, case when (v_p.payload ->> 'on')::boolean then now() end, case when (v_p.payload ->> 'on')::boolean then v_member end)
      on conflict (vendor_id) do update set same_price_confirmed_at = excluded.same_price_confirmed_at,
        same_price_member_id = excluded.same_price_member_id;
    when 'staff_add' then
      if exists (select 1 from public.vendor_members m where m.vendor_id = v_p.vendor_id and m.phone_e164 = v_p.payload ->> 'phone'
                 and m.role = 'owner') then
        raise exception 'that number is an owner of this branch' using errcode = 'check_violation';
      end if;
      v_user := app_private.auth_user_for_phone(v_p.payload ->> 'phone');
      insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status, display_name)
      values (v_p.vendor_id, v_user, v_p.payload ->> 'phone', (v_p.payload ->> 'role')::public.member_role, 'active',
              left(trim(v_p.payload ->> 'name'), 60))
      on conflict (vendor_id, phone_e164) do update set role = excluded.role, status = 'active',
        user_id = coalesce(public.vendor_members.user_id, excluded.user_id), display_name = excluded.display_name;
      -- The new staff member hears it from us, on the Merchant number.
      perform public.app_reply(v_p.payload ->> 'phone', jsonb_build_object('text',
        '👋 ' || (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_p.vendor_id)
        || ' زادك على Alo King (' || (v_p.payload ->> 'role') || '). الطلبات بتوصلك هون. / added you on Alo King as '
        || (v_p.payload ->> 'role') || '. Orders reach you here.'), 'staff_add:' || p_proposal_id);
    when 'staff_remove' then
      update public.vendor_members set status = 'revoked'
      where id = (v_p.payload ->> 'member_id')::uuid and vendor_id = v_p.vendor_id and role <> 'owner';
  end case;
  update public.merchant_proposals set status = 'confirmed', decided_at = now(), member_id = coalesce(v_member, member_id)
  where id = p_proposal_id;
  return jsonb_build_object('status', 'confirmed', 'kind', v_p.kind) || v_extra;
end;
$$;

-- 4. Kitchen capacity ------------------------------------------------------------------------------------------
-- Orders the kitchen still has to make.
create function app_private.kitchen_queue(p_vendor_id uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.orders o where o.vendor_id = p_vendor_id and o.status in ('placed', 'accepted', 'preparing');
$$;
revoke all on function app_private.kitchen_queue(uuid) from public;

-- At twice the capacity new orders pause (reason "kitchen full (auto)") and the owners and managers are told;
-- below the capacity that pause, and only that pause, is lifted.
create function app_private.kitchen_capacity_check(p_vendor_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_ops public.vendor_ops%rowtype;
  v_vendor public.vendors%rowtype;
  v_queue int;
  v_m record;
begin
  select * into v_ops from public.vendor_ops where vendor_id = p_vendor_id;
  select * into v_vendor from public.vendors where id = p_vendor_id;
  if v_vendor.id is null then
    return;
  end if;
  v_queue := app_private.kitchen_queue(p_vendor_id);
  if v_ops.max_active_orders is not null
     and v_queue >= v_ops.max_active_orders * public.config_numeric('kitchen_pause_factor')
     and not v_ops.capacity_override
     and (v_vendor.paused_until is null or v_vendor.paused_until <= now()) then
    perform app_private.vendor_set_pause(p_vendor_id, now() + make_interval(mins => public.config_numeric('kitchen_pause_max_min')::int),
      'kitchen full (auto)', 'kitchen full');
    update public.vendor_ops set capacity_paused = true where vendor_id = p_vendor_id;
    for v_m in select m.phone_e164 from public.vendor_members m
               where m.vendor_id = p_vendor_id and m.status = 'active' and m.role in ('owner', 'manager')
    loop
      perform public.app_reply(v_m.phone_e164, jsonb_build_object('text',
        '⏸ المطبخ مليان (' || v_queue || ' طلبات). وقّفنا الطلبات الجديدة لحد ما ينزل الدور تحت ' || v_ops.max_active_orders
        || '. ابعت «فتحنا» لترجع هلق. / Kitchen full (' || v_queue || ' orders): new orders are paused until the queue is under '
        || v_ops.max_active_orders || '. Send “open” to reopen now.'), 'kitchen_full:' || p_vendor_id || ':' || extract(epoch from now())::bigint);
    end loop;
  elsif (v_ops.capacity_paused or v_ops.capacity_override) and (v_ops.max_active_orders is null or v_queue < v_ops.max_active_orders) then
    update public.vendor_ops set capacity_paused = false, capacity_override = false where vendor_id = p_vendor_id;
    if v_vendor.pause_reason = 'kitchen full (auto)' and v_vendor.paused_until > now() then
      -- Outside opening hours the branch stays closed until it opens, as the hours tick would do.
      if app_private.vendor_open_at(p_vendor_id) then
        perform app_private.vendor_set_pause(p_vendor_id, null, null, 'kitchen queue cleared');
      else
        perform app_private.vendor_set_pause(p_vendor_id, app_private.vendor_next_open(p_vendor_id), 'closed (hours)', 'closed (hours)');
      end if;
    end if;
  end if;
end;
$$;
revoke all on function app_private.kitchen_capacity_check(uuid) from public;

-- Above the capacity a new order's prep time grows with the queue, so the quoted ETA is honest.
create function app_private.orders_capacity_eta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max int;
  v_queue int;
begin
  select o.max_active_orders into v_max from public.vendor_ops o where o.vendor_id = new.vendor_id;
  if v_max is not null then
    v_queue := app_private.kitchen_queue(new.vendor_id);
    if v_queue >= v_max then
      new.prep_minutes := coalesce(new.prep_minutes, 15) + (v_queue - v_max + 1) * public.config_numeric('kitchen_eta_step_min')::int;
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_capacity_eta before insert on public.orders
  for each row execute function app_private.orders_capacity_eta();

create function app_private.orders_capacity_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.vendor_ops o where o.vendor_id = new.vendor_id
             and (o.max_active_orders is not null or o.capacity_paused or o.capacity_override)) then
    perform app_private.kitchen_capacity_check(new.vendor_id);
  end if;
  return null;
end;
$$;
create trigger orders_capacity_after after insert or update of status on public.orders
  for each row execute function app_private.orders_capacity_after();

-- 5. Generator mode --------------------------------------------------------------------------------------------
create function app_private.vendor_power_off(p_vendor_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  insert into app_private.power_hidden_items (item_id, vendor_id)
  select i.id, i.vendor_id from public.menu_items i where i.vendor_id = p_vendor_id and i.needs_power and i.available
  on conflict (item_id) do nothing;
  update public.menu_items i set available = false
  from app_private.power_hidden_items h where h.item_id = i.id and h.vendor_id = p_vendor_id and i.available;
  get diagnostics n = row_count;
  insert into public.vendor_ops (vendor_id, power_off_since) values (p_vendor_id, now())
  on conflict (vendor_id) do update set power_off_since = coalesce(public.vendor_ops.power_off_since, now());
  return n;
end;
$$;
revoke all on function app_private.vendor_power_off(uuid) from public;

create function app_private.vendor_power_on(p_vendor_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  update public.menu_items i set available = true
  from app_private.power_hidden_items h where h.item_id = i.id and h.vendor_id = p_vendor_id and not i.available;
  get diagnostics n = row_count;
  delete from app_private.power_hidden_items where vendor_id = p_vendor_id;
  update public.vendor_ops set power_off_since = null where vendor_id = p_vendor_id;
  return n;
end;
$$;
revoke all on function app_private.vendor_power_on(uuid) from public;

-- 6. Staff by WhatsApp: the branch's staff by name, for "remove Ali" (owner only, server-side callers).
create function public.vendor_staff_find(p_vendor_id uuid, p_name text) returns table (member_id uuid, display_name text, role public.member_role, score real)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.display_name, m.role,
    extensions.similarity(lower(coalesce(m.display_name, '')), lower(trim(p_name))) as score
  from public.vendor_members m
  where m.vendor_id = p_vendor_id and m.status = 'active' and m.role <> 'owner' and m.display_name is not null
  order by score desc limit 3;
$$;
revoke all on function public.vendor_staff_find(uuid, text) from public, anon, authenticated;
grant execute on function public.vendor_staff_find(uuid, text) to service_role;

-- 7. Shift handover ------------------------------------------------------------------------------------------------
create table app_private.member_shifts (
  member_id uuid primary key references public.vendor_members (id) on delete cascade,
  last_seen_at timestamptz not null,
  shift_started_at timestamptz not null
);
revoke all on table app_private.member_shifts from public, anon, authenticated;

-- Called on every message from a member's phone. A manager, cashier or kitchen member silent for shift_gap_hours,
-- or writing for the first time, starts a shift and gets the handover for each branch: orders the kitchen
-- still has, items switched off, and open complaints (pending cancel requests, low ratings in 24 h).
create function public.staff_shift_touch(p_phone_e164 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_m record;
  v_last timestamptz;
  v_out jsonb := '[]';
  v_gap interval := make_interval(hours => public.config_numeric('shift_gap_hours')::int);
begin
  for v_m in
    select m.id, m.vendor_id, m.role, coalesce(v.name_ar, v.name_en) as vendor_name from public.vendor_members m
    join public.vendors v on v.id = m.vendor_id
    where m.phone_e164 = p_phone_e164 and m.status = 'active' and m.role in ('manager', 'cashier', 'kitchen')
  loop
    select s.last_seen_at into v_last from app_private.member_shifts s where s.member_id = v_m.id for update;
    insert into app_private.member_shifts (member_id, last_seen_at, shift_started_at) values (v_m.id, now(), now())
    on conflict (member_id) do update set last_seen_at = now(),
      shift_started_at = case when app_private.member_shifts.last_seen_at < now() - v_gap then now() else app_private.member_shifts.shift_started_at end;
    if v_last is null or v_last < now() - v_gap then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'vendor_id', v_m.vendor_id, 'vendor_name', v_m.vendor_name, 'role', v_m.role,
        'pending', (select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'status', o.status,
                      'minutes', floor(extract(epoch from now() - coalesce(o.placed_at, o.created_at)) / 60)::int) order by o.placed_at), '[]')
                    from (select * from public.orders o where o.vendor_id = v_m.vendor_id and o.status in ('placed', 'accepted', 'preparing', 'ready')
                          order by o.placed_at limit 10) o),
        'pending_count', (select count(*) from public.orders o where o.vendor_id = v_m.vendor_id and o.status in ('placed', 'accepted', 'preparing', 'ready')),
        'sold_out', (select coalesce(jsonb_agg(x.name order by x.name), '[]') from (
                      select coalesce(i.name_ar, i.name_en, i.name_fr) as name from public.menu_items i
                      where i.vendor_id = v_m.vendor_id and (not i.available or (i.daily_date = current_date and i.daily_remaining = 0))
                      order by i.updated_at desc limit 10) x),
        'complaints', (select count(*) from public.orders o where o.vendor_id = v_m.vendor_id and o.cancel_request_status = 'pending')
                      + (select count(*) from public.order_ratings r where r.vendor_id = v_m.vendor_id and r.rated_at > now() - interval '24 hours'
                         and (r.food_score <= 2 or r.delivery_ok is false))));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.staff_shift_touch(text) from public, anon, authenticated;
grant execute on function public.staff_shift_touch(text) to service_role;

-- 8. Substitutions --------------------------------------------------------------------------------------------------
alter table public.baskets
  add column substitution_pref text check (substitution_pref in ('call', 'replace', 'remove')),
  add column substitution_max_usd numeric(10, 2) check (substitution_max_usd >= 0);
alter table public.orders
  add column substitution_pref text check (substitution_pref in ('call', 'replace', 'remove')),
  add column substitution_max_usd numeric(10, 2) check (substitution_max_usd >= 0);

-- The order carries the preference chosen on its basket.
create function app_private.orders_copy_substitution() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select b.substitution_pref, b.substitution_max_usd into new.substitution_pref, new.substitution_max_usd
  from public.baskets b where b.id = new.basket_id;
  return new;
end;
$$;
create trigger orders_copy_substitution before insert on public.orders
  for each row execute function app_private.orders_copy_substitution();

-- Whether checkout should ask the preference: an open basket at a grocery-type branch with no answer yet.
create function public.basket_substitution_needed(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('needed', coalesce(bool_or(b.substitution_pref is null and b.payment_method = 'cod'
      and public.config_value('substitution_business_types') ? v.business_type::text
      and exists (select 1 from public.basket_items bi where bi.basket_id = b.id)), false),
    'max_usd', public.config_numeric('substitution_default_max_usd'))
  from public.baskets b join public.vendors v on v.id = b.vendor_id
  where b.customer_id = p_customer_id and b.status = 'open';
$$;

create function public.basket_set_substitution(p_customer_id uuid, p_pref text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_pref not in ('call', 'replace', 'remove') then
    raise exception 'unknown substitution preference' using errcode = 'invalid_parameter_value';
  end if;
  update public.baskets set substitution_pref = p_pref,
    substitution_max_usd = case when p_pref = 'replace' then public.config_numeric('substitution_default_max_usd') end
  where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', case when found then 'ok' else 'no_basket' end);
end;
$$;

create table public.order_substitutions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- Kept after a declined offer removes the line (the record stays, the line id goes).
  order_item_id uuid references public.order_items (id) on delete set null,
  substitute_item_id uuid not null references public.menu_items (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 50),
  old_line_usd numeric(10, 2) not null,
  new_line_usd numeric(10, 2) not null,
  diff_usd numeric(10, 2) not null,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'superseded')),
  offered_by uuid references public.vendor_members (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index order_substitutions_one_open on public.order_substitutions (order_item_id) where status = 'offered';
create trigger order_substitutions_audit after insert or update on public.order_substitutions
  for each row execute function app_private.audit_row();
alter table public.order_substitutions enable row level security;
revoke all on table public.order_substitutions from public, anon, authenticated;
grant all on table public.order_substitutions to service_role;
grant select on table public.order_substitutions to authenticated;
create policy order_substitutions_read on public.order_substitutions for select to authenticated
  using ((select app_private.is_operator())
         or exists (select 1 from public.orders o join public.customers c on c.id = o.customer_id
                    where o.id = order_id and c.user_id = (select auth.uid()))
         or exists (select 1 from public.orders o join public.vendor_members m on m.vendor_id = o.vendor_id
                    where o.id = order_id and m.user_id = (select auth.uid()) and m.status = 'active'));

-- The merchant offers a substitute for a line it cannot supply: found by the order code and the line's
-- name, priced from the menu (never from the message), within the COD cap. The customer is asked with the
-- difference in USD and LBP at the order's locked rate, and decides with a tap. A new offer for the same
-- line supersedes the open one with a new id, so a tap on an older card never accepts a newer price.
-- Lines and substitutes with a container deposit are not substituted by message (the deposit would change).
create function app_private.order_substitution_offer(p_vendor_id uuid, p_code text, p_missing text, p_substitute_item_id uuid,
  p_member_id uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid;
  v_o public.orders%rowtype;
  v_line public.order_items%rowtype;
  v_sub public.menu_items%rowtype;
  v_new numeric;
  v_diff numeric;
  v_id uuid;
begin
  v_member := app_private.order_actor(p_vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  select * into v_o from public.orders o where o.vendor_id = p_vendor_id and o.code = upper(trim(p_code)) for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if v_o.status not in ('placed', 'accepted', 'preparing') then
    return jsonb_build_object('status', 'too_late', 'code', v_o.code);
  end if;
  if v_o.payment_method <> 'cod' then
    return jsonb_build_object('status', 'not_cod', 'code', v_o.code);
  end if;
  select i.* into v_line from public.order_items i where i.order_id = v_o.id and i.pricing_unit = 'each'
  order by greatest(extensions.similarity(lower(coalesce(i.name_ar, '')), lower(p_missing)),
                    extensions.similarity(lower(coalesce(i.name_en, '')), lower(p_missing)),
                    extensions.similarity(lower(coalesce(i.name_fr, '')), lower(p_missing))) desc
  limit 1;
  if v_line.id is null or greatest(extensions.similarity(lower(coalesce(v_line.name_ar, '')), lower(p_missing)),
       extensions.similarity(lower(coalesce(v_line.name_en, '')), lower(p_missing)),
       extensions.similarity(lower(coalesce(v_line.name_fr, '')), lower(p_missing))) < 0.3 then
    return jsonb_build_object('status', 'unknown_line', 'code', v_o.code);
  end if;
  select * into v_sub from public.menu_items i where i.id = p_substitute_item_id and i.vendor_id = p_vendor_id;
  if v_sub.id is null or not app_private.menu_item_orderable(v_sub.id, v_line.quantity) or v_sub.pricing_unit <> 'each' then
    return jsonb_build_object('status', 'substitute_unavailable', 'code', v_o.code);
  end if;
  if v_sub.id = v_line.item_id then
    return jsonb_build_object('status', 'same_item', 'code', v_o.code);
  end if;
  if v_line.container_deposit_usd > 0 or v_sub.container_deposit_usd is not null then
    return jsonb_build_object('status', 'deposit_item', 'code', v_o.code);
  end if;
  v_new := v_sub.price_usd * v_line.quantity;
  v_diff := v_new - v_line.line_total_usd;
  if v_o.total_usd + v_diff > app_private.order_cod_cap(v_o.id) then
    return jsonb_build_object('status', 'cod_cap', 'code', v_o.code);
  end if;
  update public.order_substitutions set status = 'superseded', decided_at = now()
  where order_item_id = v_line.id and status = 'offered';
  insert into public.order_substitutions (order_id, order_item_id, substitute_item_id, quantity, old_line_usd, new_line_usd, diff_usd, offered_by)
  values (v_o.id, v_line.id, v_sub.id, v_line.quantity, v_line.line_total_usd, v_new, v_diff, v_member)
  returning id into v_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, channel, detail)
  values (v_o.id, v_o.status, v_o.status, 'substitution_offered', 'whatsapp', v_member, 'whatsapp',
    jsonb_build_object('substitution_id', v_id, 'order_item_id', v_line.id, 'substitute_item_id', v_sub.id, 'diff_usd', v_diff));
  perform app_private.customer_notify(v_o.id, 'substitution', jsonb_build_object(
    'substitution_id', v_id,
    'from_ar', coalesce(v_line.name_ar, v_line.name_en), 'from_en', coalesce(v_line.name_en, v_line.name_ar),
    'to_ar', coalesce(v_sub.name_ar, v_sub.name_en), 'to_en', coalesce(v_sub.name_en, v_sub.name_ar),
    'quantity', v_line.quantity, 'diff_usd', v_diff, 'diff_lbp', round(v_diff * v_o.usd_lbp_rate),
    'new_total_usd', v_o.total_usd + v_diff, 'new_total_lbp', round((v_o.total_usd + v_diff) * v_o.usd_lbp_rate),
    'usd_lbp_rate', v_o.usd_lbp_rate), 'sub:' || v_id);
  return jsonb_build_object('status', 'offered', 'code', v_o.code, 'substitution_id', v_id, 'diff_usd', v_diff,
    'pref', v_o.substitution_pref, 'max_usd', v_o.substitution_max_usd,
    'line', coalesce(v_line.name_ar, v_line.name_en), 'substitute', coalesce(v_sub.name_ar, v_sub.name_en));
end;
$$;
revoke all on function app_private.order_substitution_offer(uuid, text, text, uuid, uuid) from public;
grant execute on function app_private.order_substitution_offer(uuid, text, text, uuid, uuid) to service_role;
create function public.order_substitution_offer(p_vendor_id uuid, p_code text, p_missing text, p_substitute_item_id uuid,
  p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.order_substitution_offer(p_vendor_id, p_code, p_missing, p_substitute_item_id, p_member_id) $$;
revoke all on function public.order_substitution_offer(uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_substitution_offer(uuid, text, text, uuid, uuid) to service_role;

-- The COD cap that applies to an order (§29.4): the per-order cap, and the new-number cap on a first order.
create function app_private.order_cod_cap(p_order_id uuid) returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when o.is_new_customer then least(public.config_numeric('cod_cap_usd'), public.config_numeric('cod_cap_new_number_usd'))
              else public.config_numeric('cod_cap_usd') end
  from public.orders o where o.id = p_order_id;
$$;
revoke all on function app_private.order_cod_cap(uuid) from public;

-- The customer's tap: accept swaps the line and adjusts the totals; decline removes the line (the item is
-- not available). The order is locked first (the same order as an offer), everything is re-checked at the
-- tap (stock, COD cap), daily quantities move like order_place, and the merchant is told either way. The
-- last line of an order is never removed here: the merchant is asked to call the customer.
create function public.order_substitution_decide(p_customer_id uuid, p_substitution_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.order_substitutions%rowtype;
  v_o public.orders%rowtype;
  v_line public.order_items%rowtype;
  v_sub public.menu_items%rowtype;
  v_order_id uuid;
  v_subtotal numeric;
  v_diff numeric;
  v_phone text;
  v_msg text;
begin
  select s.order_id into v_order_id from public.order_substitutions s where s.id = p_substitution_id;
  select * into v_o from public.orders where id = v_order_id and customer_id = p_customer_id for update;
  select * into v_s from public.order_substitutions where id = p_substitution_id for update;
  if v_s.id is null or v_o.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_s.status <> 'offered' then
    return jsonb_build_object('status', 'gone', 'code', v_o.code);
  end if;
  if v_o.status not in ('placed', 'accepted', 'preparing') then
    return jsonb_build_object('status', 'too_late', 'code', v_o.code);
  end if;
  select * into v_line from public.order_items where id = v_s.order_item_id;
  select m.phone_e164 into v_phone from public.vendor_members m where m.id = v_s.offered_by and m.status = 'active';
  perform set_config('app.actor_kind', 'whatsapp', true);
  if p_accept then
    select * into v_sub from public.menu_items where id = v_s.substitute_item_id;
    v_diff := v_s.new_line_usd - v_line.line_total_usd;
    if v_line.id is null or v_sub.pricing_unit <> 'each' or not app_private.menu_item_orderable(v_sub.id, v_s.quantity) then
      update public.order_substitutions set status = 'superseded', decided_at = now() where id = v_s.id;
      return jsonb_build_object('status', 'gone', 'code', v_o.code);
    end if;
    if v_o.total_usd + v_diff > app_private.order_cod_cap(v_o.id) then
      return jsonb_build_object('status', 'cod_cap', 'code', v_o.code);
    end if;
    -- Daily quantities: the substitute's units are taken (or the tap fails), the original's given back.
    update public.menu_items set daily_remaining = daily_remaining - v_s.quantity
    where id = v_sub.id and daily_remaining is not null and daily_date = current_date and daily_remaining >= v_s.quantity;
    if not found and exists (select 1 from public.menu_items where id = v_sub.id and daily_remaining is not null and daily_date = current_date) then
      update public.order_substitutions set status = 'superseded', decided_at = now() where id = v_s.id;
      return jsonb_build_object('status', 'gone', 'code', v_o.code);
    end if;
    update public.order_items set item_id = v_sub.id, name_ar = v_sub.name_ar, name_en = v_sub.name_en, name_fr = v_sub.name_fr,
      unit_price_usd = round(v_s.new_line_usd / v_s.quantity, 2), options = '[]', options_total_usd = 0, line_total_usd = v_s.new_line_usd
    where id = v_line.id;
  else
    if v_line.id is null or (select count(*) from public.order_items where order_id = v_o.id) <= 1 then
      update public.order_substitutions set status = 'declined', decided_at = now() where id = v_s.id;
      if v_phone is not null then
        perform public.app_reply(v_phone, jsonb_build_object('text',
          '📞 #' || v_o.code || ': الزبون ما بدو البديل وهيدا آخر صنف بالطلب. اتصل فيه أو ألغي الطلب. / The customer declined and this is the last item: call them or cancel the order.'),
          'sub_decided:' || v_s.id);
      end if;
      return jsonb_build_object('status', 'last_item', 'code', v_o.code);
    end if;
    v_diff := -v_line.line_total_usd;
    delete from public.order_items where id = v_line.id;
  end if;
  -- The original line's units go back to today's count.
  update public.menu_items set daily_remaining = least(daily_remaining + v_s.quantity, daily_quantity)
  where id = v_line.item_id and daily_remaining is not null and daily_date = current_date;
  v_subtotal := (select coalesce(sum(line_total_usd), 0) from public.order_items where order_id = v_o.id);
  update public.orders set food_subtotal_usd = v_subtotal,
    total_usd = total_usd - food_subtotal_usd + v_subtotal,
    estimated_total_usd = case when estimated_total_usd is not null then estimated_total_usd + v_diff end,
    order_fee_usd = public.order_fee_usd(vendor_id, v_subtotal, placed_at)
  where id = v_o.id returning * into v_o;
  update public.order_substitutions set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
  where id = v_s.id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, channel, detail)
  values (v_o.id, v_o.status, v_o.status, case when p_accept then 'substitution_accepted' else 'substitution_declined' end,
    'whatsapp', 'whatsapp', jsonb_build_object('substitution_id', v_s.id, 'total_usd', v_o.total_usd));
  if v_phone is not null then
    v_msg := case when p_accept then '✅ #' || v_o.code || ': الزبون قبل البديل. المجموع الجديد $' || to_char(v_o.total_usd, 'FM99990.00')
             || ' / the customer accepted the substitute; new total $' || to_char(v_o.total_usd, 'FM99990.00')
           else '❌ #' || v_o.code || ': الزبون ما بدو بديل، شلنا الصنف. المجموع الجديد $' || to_char(v_o.total_usd, 'FM99990.00')
             || ' / no substitute: the item was removed; new total $' || to_char(v_o.total_usd, 'FM99990.00') end;
    perform public.app_reply(v_phone, jsonb_build_object('text', v_msg), 'sub_decided:' || v_s.id);
  end if;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'code', v_o.code,
    'total_usd', v_o.total_usd, 'total_lbp', v_o.total_lbp, 'usd_lbp_rate', v_o.usd_lbp_rate);
end;
$$;

-- 9. The visual order card and the same-price badge ------------------------------------------------------------------
-- What the gold card shows (§32.5): the items, the total in USD and LBP at the order's locked rate. Null
-- while the card is switched off. Server-side callers only; the image is rendered by the dispatch function.
create function public.order_card_image(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when app_private.config_bool('order_card_image_enabled') then jsonb_build_object(
    'code', o.code, 'vendor_ar', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
    'placed_at', o.placed_at, 'fulfilment', o.fulfilment,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('name_ar', coalesce(i.name_ar, i.name_en), 'name_en', coalesce(i.name_en, i.name_ar),
        'quantity', i.quantity, 'line_usd', i.line_total_usd) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'),
    'subtotal_usd', o.food_subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd,
    'extras_usd', o.container_deposit_usd + o.stairs_fee_usd,
    'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'),
    'same_price', ops.same_price_confirmed_at is not null) end
  from public.orders o join public.vendors v on v.id = o.vendor_id
  left join public.vendor_ops ops on ops.vendor_id = o.vendor_id
  where o.id = p_order_id;
$$;
revoke all on function public.order_card_image(uuid) from public, anon, authenticated;
grant execute on function public.order_card_image(uuid) to service_role;

-- The badge is shown only after the merchant's own confirmation; there are no estimated savings claims.
create function public.vendor_same_price(p_vendor_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.vendor_ops o where o.vendor_id = p_vendor_id and o.same_price_confirmed_at is not null) $$;
revoke all on function public.vendor_same_price(uuid) from public, anon, authenticated;
grant execute on function public.vendor_same_price(uuid) to service_role;

revoke all on function public.basket_substitution_needed(uuid) from public, anon, authenticated;
revoke all on function public.basket_set_substitution(uuid, text) from public, anon, authenticated;
revoke all on function public.order_substitution_decide(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.basket_substitution_needed(uuid), public.basket_set_substitution(uuid, text),
  public.order_substitution_decide(uuid, uuid, boolean) to service_role;
