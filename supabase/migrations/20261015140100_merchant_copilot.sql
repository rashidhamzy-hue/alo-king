-- Session 5c (DECISIONS §39.7, §38.3 "kitchen station availability"): the merchant copilot's server side. Every change to
-- price, availability or money is a merchant_proposals row applied only by the merchant's confirming tap (§18.2); the copilot
-- (rules now, the model once its eval passes) only proposes. Contents:
--   1. config
--   2. availability: stations, sections and items off for a while, restored by pg_cron (§38.3 "fryer off 15 min")
--   3. stock counts that carry over from day to day for groceries
--   4. offers (percent off, bundle, free item, happy hour, first order), priced by the server into the order's discount
--   5. hours, closures, minimum order, own-delivery radius
--   6. Boost and sponsored placement: budgets recorded; nothing is charged until the ad system runs (session 12)
--   7. proposals: who may propose and confirm each new kind, checks, and applying them
--   8. daily and weekly reports from the orders
--   9. merchant memory (dated facts) and proactive suggestions, each a proposal that needs a tap
--  10. the customer side: basket_quote and order_place apply the offer and the minimum order
-- The vendors table is untouched (§31): new settings live in vendor_ops, menu_items and new tables.

select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'DECISIONS §39.7: session 5c merchant copilot, 15 October 2026', true);

-- 1. Config -------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('ai_merchant_model', '"claude-haiku-4-5-20251001"', now(),
   'The merchant copilot''s model for messages the rules do not read; Haiku 5.5 replaces it only after winning the merchant eval (DECISIONS §32.6)', null),
  ('ai_merchant_text_enabled', 'false', now(),
   'Model turns for merchant text the rules do not read (the copilot''s typed tools). Off until the merchant eval passes (DECISIONS §32.4, §39.7)', null),
  ('availability_max_minutes', '1440', now(), 'Longest "off for N minutes" before the copilot restores a station, section or item (DECISIONS §38.3)', null),
  ('merchant_suggestion_ttl_min', '180', now(), 'A proactive suggestion card stays tappable this long (DECISIONS §39.7)', null),
  ('merchant_suggestions_enabled', 'true', now(), 'Proactive copilot suggestions (sell-outs, usual closures, quiet-day offers, weekly summary); each needs a tap (DECISIONS §39.7)', null),
  ('offer_max_percent', '50', now(), 'Largest percent off a merchant offer may give (DECISIONS §20.4: offers are merchant-funded, server-validated)', null),
  ('offer_max_days', '30', now(), 'Longest an offer runs before the merchant renews it', null);

-- 2. Availability (§38.3, §39.7) ------------------------------------------------------------------------------------------
-- Items carry the kitchen station they come from; "fryer off 15 min" hides that station's items and the tick brings back
-- exactly the items it hid, unless the merchant changed them meanwhile.
alter table public.menu_items
  add column station text check (station in ('fryer', 'oven', 'grill', 'saj', 'espresso', 'cold', 'bar')),
  add column stock_tracked boolean not null default false,
  add column removed_at timestamptz;
comment on column public.menu_items.removed_at is 'Removed from the menu by the merchant''s tap (§39.7): kept for order history, never shown or switched back on.';
comment on column public.menu_items.station is 'Kitchen station (DECISIONS §38.3): availability can switch a whole station off for a while.';
comment on column public.menu_items.stock_tracked is 'A counted grocery item: the day''s remaining stock carries over to the next day (DECISIONS §39.7).';

create table public.availability_holds (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  scope text not null check (scope in ('station', 'section', 'item')),
  target text not null check (char_length(target) between 1 and 80),
  item_ids uuid[] not null default '{}',
  until timestamptz,
  reason text check (char_length(reason) <= 120),
  member_id uuid references public.vendor_members (id) on delete set null,
  restored_at timestamptz,
  created_at timestamptz not null default now()
);
create index availability_holds_due_idx on public.availability_holds (until) where restored_at is null;
alter table public.availability_holds enable row level security;
revoke all on table public.availability_holds from public, anon, authenticated;
grant all on table public.availability_holds to service_role;
grant select on table public.availability_holds to authenticated;
create policy availability_holds_read on public.availability_holds for select to authenticated
  using ((select app_private.is_operator()) or app_private.has_vendor_role(vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[]));

-- The items a scope names, on this branch: a station, a section (by id) or one item (by id).
create function app_private.availability_items(p_vendor_id uuid, p_scope text, p_target text) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(i.id order by i.id), '{}')
  from public.menu_items i
  where i.vendor_id = p_vendor_id and i.removed_at is null and case p_scope
    when 'station' then i.station = p_target
    when 'section' then i.section_id::text = p_target
    when 'item' then i.id::text = p_target
    else false end;
$$;

create function app_private.availability_off(p_vendor_id uuid, p_scope text, p_target text, p_until timestamptz,
  p_reason text, p_member_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  -- Only items that are on now are recorded, so the restore never switches on something the merchant had off.
  select coalesce(array_agg(i.id), '{}') into v_ids from public.menu_items i
  where i.id = any (app_private.availability_items(p_vendor_id, p_scope, p_target)) and i.available;
  update public.menu_items set available = false where id = any (v_ids);
  insert into public.availability_holds (vendor_id, scope, target, item_ids, until, reason, member_id)
  values (p_vendor_id, p_scope, p_target, v_ids, p_until, left(p_reason, 120), p_member_id)
  returning id into v_id;
  return jsonb_build_object('hold_id', v_id, 'hidden', cardinality(v_ids), 'until', p_until);
end;
$$;

-- Restores a hold: the items it hid that are still off and not held by another open hold come back.
create function app_private.availability_restore(p_hold_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_h public.availability_holds%rowtype;
  v_n integer;
begin
  select * into v_h from public.availability_holds where id = p_hold_id and restored_at is null for update;
  if v_h.id is null then
    return 0;
  end if;
  update public.availability_holds set restored_at = now() where id = v_h.id;
  update public.menu_items i set available = true
  where i.id = any (v_h.item_ids) and not i.available and i.removed_at is null
    and not exists (select 1 from public.availability_holds o where o.restored_at is null and o.id <> v_h.id and i.id = any (o.item_ids))
    and not exists (select 1 from app_private.power_hidden_items p where p.item_id = i.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function app_private.availability_tick() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_h record;
  v_n integer := 0;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'availability back on schedule (DECISIONS §38.3)', true);
  for v_h in select id from public.availability_holds where restored_at is null and until is not null and until <= now() loop
    v_n := v_n + app_private.availability_restore(v_h.id);
  end loop;
  return v_n;
end;
$$;
select cron.schedule('availability-restore', '* * * * *', $$select app_private.availability_tick()$$);

-- 3. Stock counts that carry over (groceries, §39.7) ---------------------------------------------------------------------
create function app_private.stock_carry_over() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
  v_today date := (now() at time zone 'Asia/Beirut')::date;
begin
  perform set_config('app.actor_kind', 'system', true);
  update public.menu_items set daily_date = v_today, daily_quantity = daily_remaining
  where stock_tracked and daily_date is not null and daily_date < v_today;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
select cron.schedule('stock-carry-over', '1 0 * * *', $$select app_private.stock_carry_over()$$);

-- 4. Offers (§20.4: free to create, merchant-funded, server-validated; §39.7) ---------------------------------------------
create table public.vendor_offers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  kind text not null check (kind in ('percent', 'bundle', 'free_item', 'happy_hour', 'first_order')),
  percent numeric(5, 2) check (percent > 0 and percent <= 100),
  item_ids uuid[] not null default '{}',
  free_item_id uuid references public.menu_items (id) on delete cascade,
  min_quantity integer not null default 1 check (min_quantity between 1 and 50),
  weekdays smallint[] check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  from_time time,
  to_time time,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'stopped')),
  proposal_id uuid references public.merchant_proposals (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (kind <> 'free_item' or free_item_id is not null),
  check (kind = 'free_item' or percent is not null),
  check (kind <> 'bundle' or cardinality(item_ids) >= 2),
  check (kind <> 'happy_hour' or (from_time is not null and to_time is not null))
);
create index vendor_offers_active_idx on public.vendor_offers (vendor_id) where status = 'active';
-- An offer changes prices: baskets priced before it are re-priced before an order (the menu version, §18.2).
create function app_private.vendor_offers_bump_version() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.vendors set menu_version = menu_version + 1 where id = coalesce(new.vendor_id, old.vendor_id);
  return coalesce(new, old);
end;
$$;
create trigger vendor_offers_version after insert or update or delete on public.vendor_offers
  for each row execute function app_private.vendor_offers_bump_version();
create trigger vendor_offers_audit after insert or update or delete on public.vendor_offers
  for each row execute function app_private.audit_row();
alter table public.vendor_offers enable row level security;
revoke all on table public.vendor_offers from public, anon, authenticated;
grant all on table public.vendor_offers to service_role;
grant select on table public.vendor_offers to anon, authenticated;
-- Offers are public facts about orderable shops (the website and the bot may show them).
create policy vendor_offers_read on public.vendor_offers for select to anon, authenticated
  using (status = 'active' and app_private.menu_vendor_visible(vendor_id));

alter table public.orders
  add column offer_id uuid references public.vendor_offers (id) on delete set null,
  add column offer_usd numeric(10, 2) not null default 0 check (offer_usd >= 0);
comment on column public.orders.offer_usd is 'The merchant offer''s part of discount_usd (DECISIONS §20.4); credit_usd is the customer-credit part.';

-- The best offer for a basket and its amount, from the server's line prices. One offer per order.
create function app_private.offer_for_basket(p_basket_id uuid) returns table (offer_id uuid, amount_usd numeric)
language sql stable security definer set search_path = ''
as $$
  with b as (select * from public.baskets where id = p_basket_id),
  lines as (
    select bi.item_id, bi.quantity, bi.line_total_usd, coalesce(bi.unit_price_usd, 0) as unit
    from public.basket_items bi where bi.basket_id = p_basket_id and bi.line_total_usd is not null
  ),
  t as (select (now() at time zone 'Asia/Beirut') as l),
  o as (
    select f.* from public.vendor_offers f, b, t
    where f.vendor_id = b.vendor_id and f.status = 'active' and f.starts_at <= now() and f.ends_at > now()
      and (f.weekdays is null or extract(dow from t.l)::smallint = any (f.weekdays))
      and (f.kind <> 'happy_hour' or (t.l::time >= f.from_time and t.l::time < f.to_time))
      and (f.kind <> 'first_order' or not exists (
        select 1 from public.orders x where x.customer_id = b.customer_id and x.vendor_id = b.vendor_id
          and x.status not in ('cancelled', 'rejected', 'failed')))
  ),
  scored as (
    select o.id,
      case
        when o.kind in ('percent', 'happy_hour', 'first_order') then round(coalesce((
          select sum(l.line_total_usd) from lines l
          where cardinality(o.item_ids) = 0 or l.item_id = any (o.item_ids)), 0) * o.percent / 100.0, 2)
        when o.kind = 'bundle' then case
          when (select count(distinct l.item_id) from lines l where l.item_id = any (o.item_ids)) = cardinality(o.item_ids)
          then round((select sum(l.line_total_usd) from lines l where l.item_id = any (o.item_ids)) * o.percent / 100.0, 2) else 0 end
        when o.kind = 'free_item' then case
          when coalesce((select sum(l.quantity) from lines l where cardinality(o.item_ids) = 0 or l.item_id = any (o.item_ids)), 0) >= o.min_quantity
          then coalesce((select min(l.unit) from lines l where l.item_id = o.free_item_id), 0) else 0 end
        else 0 end as amount
    from o
  )
  select s.id, s.amount from scored s where s.amount > 0 order by s.amount desc, s.id limit 1;
$$;

-- 5. Hours, closures, minimum order (§39.7) ------------------------------------------------------------------------------
create table public.vendor_closures (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  day date not null,
  reason text check (char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  primary key (vendor_id, day)
);
alter table public.vendor_closures enable row level security;
revoke all on table public.vendor_closures from public, anon, authenticated;
grant all on table public.vendor_closures to service_role;
grant select on table public.vendor_closures to anon, authenticated;
create policy vendor_closures_read on public.vendor_closures for select to anon, authenticated using (app_private.menu_vendor_visible(vendor_id));

-- A closure day is closed whatever the weekly hours say (and for a shop without hours, all day).
create or replace function app_private.vendor_open_at(p_vendor_id uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  with t as (select (p_at at time zone 'Asia/Beirut') as l)
  select case
    when exists (select 1 from public.vendor_closures c, t where c.vendor_id = p_vendor_id and c.day = t.l::date) then false
    when not exists (select 1 from public.vendor_hours h where h.vendor_id = p_vendor_id) then true
    else exists (
      select 1 from public.vendor_hours h, t
      where h.vendor_id = p_vendor_id and (
        (h.opens < h.closes and h.weekday = extract(dow from t.l) and t.l::time >= h.opens and t.l::time < h.closes)
        or (h.opens >= h.closes and h.weekday = extract(dow from t.l) and t.l::time >= h.opens)
        or (h.opens >= h.closes and h.weekday = (extract(dow from t.l)::int + 6) % 7 and t.l::time < h.closes)))
    end;
$$;

-- The hours tick also covers shops that only have a closure day.
create or replace function app_private.hours_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  n_paused int := 0;
  n_resumed int := 0;
  v_next timestamptz;
begin
  perform set_config('app.actor_kind', 'system', true);
  for v in
    select x.id, x.paused_until, x.pause_reason from public.vendors x
    where x.orderable and (exists (select 1 from public.vendor_hours h where h.vendor_id = x.id)
                           or exists (select 1 from public.vendor_closures c where c.vendor_id = x.id
                                      and c.day >= (now() at time zone 'Asia/Beirut')::date - 1))
  loop
    if app_private.vendor_open_at(v.id) then
      if v.pause_reason = 'closed (hours)' and v.paused_until > now() then
        perform app_private.vendor_set_pause(v.id, null, null, 'opened (hours)');
        n_resumed := n_resumed + 1;
      end if;
    elsif v.paused_until is null or v.paused_until <= now() then
      v_next := app_private.vendor_next_open(v.id);
      if v_next is not null then
        perform app_private.vendor_set_pause(v.id, v_next, 'closed (hours)', 'closed (hours)');
        n_paused := n_paused + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('paused', n_paused, 'resumed', n_resumed);
end;
$$;

alter table public.vendor_ops add column min_order_usd numeric(10, 2) check (min_order_usd > 0 and min_order_usd <= 500);
comment on column public.vendor_ops.min_order_usd is 'Smallest food subtotal the shop takes (DECISIONS §39.7, §29.1 "the merchant''s minimum order").';

-- 6. Boost and sponsored placement (§20.4, §30.2.5, §39.7) ---------------------------------------------------------------
-- The merchant's budget and audience are recorded on its tap. Nothing is reserved or charged: sponsored placement and the
-- paid broadcast run with the ad system (session 12), which reserves from Alo King Credit when a campaign starts (§20.3).
create table public.merchant_campaigns (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  kind text not null check (kind in ('sponsored', 'broadcast')),
  audience text not null check (audience in ('nearby', 'past_customers')),
  budget_usd numeric(10, 2) not null check (budget_usd >= 5 and budget_usd <= 500),
  status text not null default 'waiting' check (status in ('waiting', 'running', 'stopped')),
  proposal_id uuid references public.merchant_proposals (id) on delete set null,
  created_at timestamptz not null default now(),
  stopped_at timestamptz
);
alter table public.merchant_campaigns enable row level security;
revoke all on table public.merchant_campaigns from public, anon, authenticated;
grant all on table public.merchant_campaigns to service_role;
grant select on table public.merchant_campaigns to authenticated;
create policy merchant_campaigns_read on public.merchant_campaigns for select to authenticated
  using ((select app_private.is_operator()) or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[]));

-- 7. Proposals ----------------------------------------------------------------------------------------------------------
create or replace function app_private.proposal_roles(p_kind public.proposal_kind) returns public.member_role[]
language sql immutable set search_path = ''
as $$
  select case
    when p_kind in ('staff_add', 'staff_remove') then array['owner']::public.member_role[]
    when p_kind in ('price', 'capacity', 'same_price', 'needs_power', 'item_add', 'item_edit', 'item_remove', 'offer_create',
                    'offer_stop', 'hours_set', 'closure', 'min_order', 'radius', 'boost_start', 'boost_stop')
      then array['owner', 'manager']::public.member_role[]
    else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end;
$$;

-- Checks for the new kinds, before anything is shown to the merchant to confirm.
create function app_private.proposal_check_copilot(p_vendor_id uuid, p_kind public.proposal_kind, p_payload jsonb) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_item uuid := nullif(p_payload ->> 'item_id', '')::uuid;
  v_until timestamptz := nullif(p_payload ->> 'until', '')::timestamptz;
begin
  if p_kind in ('stock_set', 'item_edit', 'item_remove') and not exists (
    select 1 from public.menu_items i where i.id = v_item and i.vendor_id = p_vendor_id) then
    raise exception 'unknown item for this merchant' using errcode = 'check_violation';
  end if;
  if v_item is not null and exists (select 1 from public.menu_items i where i.id = v_item and i.removed_at is not null) then
    raise exception 'that item was removed from the menu' using errcode = 'check_violation';
  end if;
  if p_kind in ('availability_off', 'availability_on') then
    if coalesce(p_payload ->> 'scope', '') not in ('station', 'section', 'item') or nullif(p_payload ->> 'target', '') is null then
      raise exception 'availability needs a station, section or item' using errcode = 'check_violation';
    end if;
    if p_kind = 'availability_off' and v_until is not null
       and (v_until <= now() or v_until > now() + make_interval(mins => public.config_numeric('availability_max_minutes')::int)) then
      raise exception 'an availability change ends within the configured maximum' using errcode = 'check_violation';
    end if;
    if p_kind = 'availability_off' and cardinality(app_private.availability_items(p_vendor_id, p_payload ->> 'scope', p_payload ->> 'target')) = 0 then
      raise exception 'no items in that station, section or item' using errcode = 'check_violation';
    end if;
  end if;
  if p_kind = 'stock_set' and coalesce((p_payload ->> 'quantity')::int, -1) not between 0 and 10000 then
    raise exception 'stock is 0-10000' using errcode = 'check_violation';
  end if;
  if p_kind = 'item_add' and (char_length(trim(coalesce(p_payload ->> 'name', ''))) not between 1 and 80
       or coalesce((p_payload ->> 'price_usd')::numeric, -1) not between 0.01 and 10000) then
    raise exception 'a new item needs a name and a price between 0.01 and 10000 USD' using errcode = 'check_violation';
  end if;
  if p_kind = 'item_edit' and nullif(trim(coalesce(p_payload ->> 'name', '')), '') is null
     and nullif(trim(coalesce(p_payload ->> 'description', '')), '') is null and nullif(p_payload ->> 'station', '') is null then
    raise exception 'an edit changes the name, the description or the station' using errcode = 'check_violation';
  end if;
  if p_kind = 'item_edit' and nullif(p_payload ->> 'station', '') is not null
     and p_payload ->> 'station' not in ('fryer', 'oven', 'grill', 'saj', 'espresso', 'cold', 'bar') then
    raise exception 'unknown station' using errcode = 'check_violation';
  end if;
  if p_kind = 'offer_create' then
    if coalesce(p_payload ->> 'kind', '') not in ('percent', 'bundle', 'free_item', 'happy_hour', 'first_order') then
      raise exception 'unknown offer kind' using errcode = 'check_violation';
    end if;
    if p_payload ->> 'kind' <> 'free_item' and coalesce((p_payload ->> 'percent')::numeric, 0)
       not between 1 and public.config_numeric('offer_max_percent') then
      raise exception 'an offer is 1-% percent off', public.config_numeric('offer_max_percent') using errcode = 'check_violation';
    end if;
    if nullif(p_payload ->> 'section_id', '') is not null and not exists (select 1 from public.menu_sections s
         where s.id = (p_payload ->> 'section_id')::uuid and s.vendor_id = p_vendor_id) then
      raise exception 'offer section must be on this menu' using errcode = 'check_violation';
    end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'item_ids', '[]')) x
               where not exists (select 1 from public.menu_items i where i.id = x::uuid and i.vendor_id = p_vendor_id))
       or (p_payload ->> 'kind' = 'free_item' and not exists (select 1 from public.menu_items i
            where i.id = nullif(p_payload ->> 'free_item_id', '')::uuid and i.vendor_id = p_vendor_id)) then
      raise exception 'offer items must be on this menu' using errcode = 'check_violation';
    end if;
    if coalesce((p_payload ->> 'days')::int, 7) not between 1 and public.config_numeric('offer_max_days') then
      raise exception 'an offer runs 1-% days', public.config_numeric('offer_max_days') using errcode = 'check_violation';
    end if;
  end if;
  if p_kind = 'offer_stop' and not exists (select 1 from public.vendor_offers o where o.vendor_id = p_vendor_id and o.status = 'active'
      and (nullif(p_payload ->> 'offer_id', '') is null or o.id = (p_payload ->> 'offer_id')::uuid)) then
    raise exception 'no running offer to stop' using errcode = 'check_violation';
  end if;
  if p_kind = 'hours_set' then
    if jsonb_typeof(p_payload -> 'weekdays') <> 'array' or jsonb_array_length(p_payload -> 'weekdays') = 0
       or exists (select 1 from jsonb_array_elements_text(p_payload -> 'weekdays') d where d !~ '^[0-6]$') then
      raise exception 'hours need weekdays 0-6' using errcode = 'check_violation';
    end if;
    if not coalesce((p_payload ->> 'closed')::boolean, false)
       and (coalesce(p_payload ->> 'opens', '') !~ '^\d{2}:\d{2}$' or coalesce(p_payload ->> 'closes', '') !~ '^\d{2}:\d{2}$'
            or p_payload ->> 'opens' = p_payload ->> 'closes') then
      raise exception 'hours need an opening and a closing time' using errcode = 'check_violation';
    end if;
  end if;
  if p_kind = 'closure' and (nullif(p_payload ->> 'day', '')::date is null
       or (p_payload ->> 'day')::date < (now() at time zone 'Asia/Beirut')::date
       or (p_payload ->> 'day')::date > (now() at time zone 'Asia/Beirut')::date + 60) then
    raise exception 'a closure is a day in the next 60 days' using errcode = 'check_violation';
  end if;
  if p_kind = 'min_order' and p_payload ? 'usd' and jsonb_typeof(p_payload -> 'usd') <> 'null'
     and coalesce((p_payload ->> 'usd')::numeric, 0) not between 1 and 500 then
    raise exception 'a minimum order is $1-$500, or none' using errcode = 'check_violation';
  end if;
  if p_kind = 'radius' and coalesce((p_payload ->> 'km')::numeric, 0) not between 0.5 and public.max_delivery_km() then
    raise exception 'the delivery radius is 0.5-% km', public.max_delivery_km() using errcode = 'check_violation';
  end if;
  if p_kind = 'boost_start' and (coalesce((p_payload ->> 'budget_usd')::numeric, 0) not between 5 and 500
       or coalesce(p_payload ->> 'audience', '') not in ('nearby', 'past_customers')
       or coalesce(p_payload ->> 'kind', 'sponsored') not in ('sponsored', 'broadcast')) then
    raise exception 'Boost needs a budget of $5-$500 and an audience (nearby or past customers)' using errcode = 'check_violation';
  end if;
end;
$$;

-- Proposal creation: the existing checks, then the copilot's.
alter function app_private.merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid) rename to merchant_proposal_create_base;
create function app_private.merchant_proposal_create(p_vendor_id uuid, p_kind public.proposal_kind, p_payload jsonb, p_source text,
  p_member_id uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.proposal_check_copilot(p_vendor_id, p_kind, coalesce(p_payload, '{}'));
  return app_private.merchant_proposal_create_base(p_vendor_id, p_kind, p_payload, p_source, p_member_id);
end;
$$;
-- Same grants as before the rename: the caller-checking function behind the invoker wrapper (20261011090200).
revoke all on function app_private.merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid) from public, anon;
grant execute on function app_private.merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid) to authenticated, service_role;
revoke all on function app_private.merchant_proposal_create_base(uuid, public.proposal_kind, jsonb, text, uuid) from public, anon, authenticated;

-- Applying the new kinds on the merchant's tap. The existing kinds keep their code (merchant_proposal_decide_base).
create function app_private.proposal_apply_copilot(p_p public.merchant_proposals, p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_item uuid := nullif(p_p.payload ->> 'item_id', '')::uuid;
  v_r jsonb := '{}';
  v_n integer;
  v_id uuid;
  v_section uuid;
  v_wd text;
  v_h record;
begin
  case p_p.kind
    when 'availability_off' then
      v_r := app_private.availability_off(p_p.vendor_id, p_p.payload ->> 'scope', p_p.payload ->> 'target',
        nullif(p_p.payload ->> 'until', '')::timestamptz, p_p.payload ->> 'reason', p_member);
    when 'availability_on' then
      v_n := 0;
      for v_h in select h.id from public.availability_holds h where h.vendor_id = p_p.vendor_id and h.restored_at is null
                   and h.scope = p_p.payload ->> 'scope' and h.target = p_p.payload ->> 'target' loop
        v_n := v_n + app_private.availability_restore(v_h.id);
      end loop;
      -- Nothing held: switch the named items on directly (e.g. an item marked sold out yesterday).
      if v_n = 0 then
        update public.menu_items set available = true
        where id = any (app_private.availability_items(p_p.vendor_id, p_p.payload ->> 'scope', p_p.payload ->> 'target')) and not available
          and not exists (select 1 from app_private.power_hidden_items p where p.item_id = menu_items.id);
        get diagnostics v_n = row_count;
      end if;
      v_r := jsonb_build_object('restored', v_n);
    when 'stock_set' then
      update public.menu_items set daily_quantity = (p_p.payload ->> 'quantity')::int, daily_remaining = (p_p.payload ->> 'quantity')::int,
        daily_date = (now() at time zone 'Asia/Beirut')::date, stock_tracked = true,
        available = case when (p_p.payload ->> 'quantity')::int > 0 then true else available end
      where id = v_item and vendor_id = p_p.vendor_id;
    when 'item_add' then
      select s.id into v_section from public.menu_sections s where s.vendor_id = p_p.vendor_id
        and nullif(p_p.payload ->> 'section', '') is not null
        and extensions.similarity(lower(coalesce(s.name_en, s.name_ar, '')), lower(p_p.payload ->> 'section')) >= 0.4
      order by extensions.similarity(lower(coalesce(s.name_en, s.name_ar, '')), lower(p_p.payload ->> 'section')) desc limit 1;
      insert into public.menu_items (vendor_id, section_id, name_ar, name_en, price_usd, station, sort_order)
      values (p_p.vendor_id, v_section,
        case when p_p.payload ->> 'name' ~ '[؀-ۿ]' then left(trim(p_p.payload ->> 'name'), 80) end,
        case when p_p.payload ->> 'name' !~ '[؀-ۿ]' then left(trim(p_p.payload ->> 'name'), 80) end,
        (p_p.payload ->> 'price_usd')::numeric, nullif(p_p.payload ->> 'station', ''),
        coalesce((select max(sort_order) + 1 from public.menu_items where vendor_id = p_p.vendor_id), 0))
      returning id into v_id;
      v_r := jsonb_build_object('item_id', v_id, 'section_id', v_section);
    when 'item_edit' then
      update public.menu_items set
        name_ar = case when nullif(trim(coalesce(p_p.payload ->> 'name', '')), '') is not null and p_p.payload ->> 'name' ~ '[؀-ۿ]'
                       then left(trim(p_p.payload ->> 'name'), 80) else name_ar end,
        name_en = case when nullif(trim(coalesce(p_p.payload ->> 'name', '')), '') is not null and p_p.payload ->> 'name' !~ '[؀-ۿ]'
                       then left(trim(p_p.payload ->> 'name'), 80) else name_en end,
        description = coalesce(left(nullif(trim(coalesce(p_p.payload ->> 'description', '')), ''), 500), description),
        station = coalesce(nullif(p_p.payload ->> 'station', ''), station)
      where id = v_item and vendor_id = p_p.vendor_id;
    when 'item_remove' then
      -- Ordered items stay in the order history: the item leaves the menu (off, marked removed), never deleted.
      update public.menu_items set available = false, removed_at = now(), daily_quantity = null, daily_remaining = null,
        daily_date = null, stock_tracked = false
      where id = v_item and vendor_id = p_p.vendor_id;
    when 'offer_create' then
      insert into public.vendor_offers (vendor_id, kind, percent, item_ids, free_item_id, min_quantity, weekdays, from_time, to_time,
        starts_at, ends_at, proposal_id)
      values (p_p.vendor_id, p_p.payload ->> 'kind', nullif(p_p.payload ->> 'percent', '')::numeric,
        case when nullif(p_p.payload ->> 'section_id', '') is not null
             then coalesce((select array_agg(i.id) from public.menu_items i where i.section_id = (p_p.payload ->> 'section_id')::uuid
                            and i.removed_at is null), '{}')
             else coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_p.payload -> 'item_ids', '[]')) x), '{}') end,
        nullif(p_p.payload ->> 'free_item_id', '')::uuid, coalesce((p_p.payload ->> 'min_quantity')::int, 1),
        (select array_agg(x::smallint) from jsonb_array_elements_text(p_p.payload -> 'weekdays') x),
        nullif(p_p.payload ->> 'from', '')::time, nullif(p_p.payload ->> 'to', '')::time,
        coalesce(nullif(p_p.payload ->> 'starts_at', '')::timestamptz, now()),
        coalesce(nullif(p_p.payload ->> 'starts_at', '')::timestamptz, now()) + make_interval(days => coalesce((p_p.payload ->> 'days')::int, 7)),
        p_p.id)
      returning id into v_id;
      v_r := jsonb_build_object('offer_id', v_id);
    when 'offer_stop' then
      update public.vendor_offers set status = 'stopped'
      where vendor_id = p_p.vendor_id and status = 'active'
        and (nullif(p_p.payload ->> 'offer_id', '') is null or id = (p_p.payload ->> 'offer_id')::uuid);
      get diagnostics v_n = row_count;
      v_r := jsonb_build_object('stopped', v_n);
    when 'hours_set' then
      -- A shop without hours is open every day; closing one weekday keeps the others open all day (00:00 to 00:00).
      if coalesce((p_p.payload ->> 'closed')::boolean, false)
         and not exists (select 1 from public.vendor_hours h where h.vendor_id = p_p.vendor_id) then
        insert into public.vendor_hours (vendor_id, weekday, opens, closes)
        select p_p.vendor_id, d, '00:00', '00:00' from generate_series(0, 6) d;
      end if;
      for v_wd in select jsonb_array_elements_text(p_p.payload -> 'weekdays') loop
        if coalesce((p_p.payload ->> 'closed')::boolean, false) then
          delete from public.vendor_hours where vendor_id = p_p.vendor_id and weekday = v_wd::smallint;
        else
          insert into public.vendor_hours (vendor_id, weekday, opens, closes)
          values (p_p.vendor_id, v_wd::smallint, (p_p.payload ->> 'opens')::time, (p_p.payload ->> 'closes')::time)
          on conflict (vendor_id, weekday) do update set opens = excluded.opens, closes = excluded.closes, updated_at = now();
        end if;
      end loop;
      perform app_private.hours_tick();
    when 'closure' then
      insert into public.vendor_closures (vendor_id, day, reason) values (p_p.vendor_id, (p_p.payload ->> 'day')::date, left(p_p.payload ->> 'reason', 120))
      on conflict (vendor_id, day) do nothing;
      perform app_private.hours_tick();
    when 'min_order' then
      insert into public.vendor_ops (vendor_id, min_order_usd) values (p_p.vendor_id, nullif(p_p.payload ->> 'usd', '')::numeric)
      on conflict (vendor_id) do update set min_order_usd = excluded.min_order_usd;
    when 'radius' then
      update public.vendors set delivery_radius_km = least((p_p.payload ->> 'km')::numeric, public.max_delivery_km()) where id = p_p.vendor_id;
    when 'boost_start' then
      insert into public.merchant_campaigns (vendor_id, kind, audience, budget_usd, proposal_id)
      values (p_p.vendor_id, coalesce(p_p.payload ->> 'kind', 'sponsored'), p_p.payload ->> 'audience', (p_p.payload ->> 'budget_usd')::numeric, p_p.id)
      returning id into v_id;
      v_r := jsonb_build_object('campaign_id', v_id, 'status', 'waiting');
    when 'boost_stop' then
      update public.merchant_campaigns set status = 'stopped', stopped_at = now()
      where vendor_id = p_p.vendor_id and status in ('waiting', 'running');
      get diagnostics v_n = row_count;
      v_r := jsonb_build_object('stopped', v_n);
    else
      return null;
  end case;
  return coalesce(v_r, '{}');
end;
$$;

alter function app_private.merchant_proposal_decide(uuid, boolean, uuid) rename to merchant_proposal_decide_base;
create function app_private.merchant_proposal_decide(p_proposal_id uuid, p_confirm boolean, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.merchant_proposals%rowtype;
  v_member uuid;
  v_r jsonb;
begin
  select * into v_p from public.merchant_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    raise exception 'unknown proposal' using errcode = 'no_data_found';
  end if;
  if v_p.kind not in ('availability_off', 'availability_on', 'stock_set', 'item_add', 'item_edit', 'item_remove', 'offer_create',
                      'offer_stop', 'hours_set', 'closure', 'min_order', 'radius', 'boost_start', 'boost_stop') then
    return app_private.merchant_proposal_decide_base(p_proposal_id, p_confirm, p_member_id);
  end if;
  v_member := app_private.order_actor(v_p.vendor_id, app_private.proposal_roles(v_p.kind), p_member_id);
  -- A suggestion the copilot made (no member) is applied only by a member's own tap.
  if v_member is null and not app_private.is_operator() then
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
    return jsonb_build_object('status', 'rejected', 'kind', v_p.kind);
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'merchant proposal ' || p_proposal_id || ' confirmed', true);
  v_r := app_private.proposal_apply_copilot(v_p, v_member);
  update public.merchant_proposals set status = 'confirmed', decided_at = now(), member_id = coalesce(v_member, member_id)
  where id = p_proposal_id;
  return jsonb_build_object('status', 'confirmed', 'kind', v_p.kind) || coalesce(v_r, '{}');
end;
$$;
revoke all on function app_private.merchant_proposal_decide(uuid, boolean, uuid) from public, anon;
grant execute on function app_private.merchant_proposal_decide(uuid, boolean, uuid) to authenticated, service_role;
revoke all on function app_private.merchant_proposal_decide_base(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function app_private.proposal_apply_copilot(public.merchant_proposals, uuid), app_private.proposal_check_copilot(uuid, public.proposal_kind, jsonb),
  app_private.availability_items(uuid, text, text), app_private.availability_off(uuid, text, text, timestamptz, text, uuid),
  app_private.availability_restore(uuid), app_private.availability_tick(), app_private.stock_carry_over(),
  app_private.offer_for_basket(uuid) from public;

-- The branch's sections and stations, for the copilot's lists and the rules ("grill off", "sandwiches off 1h").
create function public.merchant_menu_parts(p_vendor_id uuid, p_member_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  return jsonb_build_object(
    'sections', coalesce((select jsonb_agg(jsonb_build_object('section_id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en,
        'items', (select count(*) from public.menu_items i where i.section_id = s.id)) order by s.sort_order, s.id)
      from public.menu_sections s where s.vendor_id = p_vendor_id), '[]'),
    'stations', coalesce((select jsonb_agg(jsonb_build_object('station', x.station, 'items', x.n)) from (
        select i.station, count(*) as n from public.menu_items i where i.vendor_id = p_vendor_id and i.station is not null group by i.station) x), '[]'),
    'holds', coalesce((select jsonb_agg(jsonb_build_object('scope', h.scope, 'target', h.target, 'until', h.until, 'items', cardinality(h.item_ids)))
      from public.availability_holds h where h.vendor_id = p_vendor_id and h.restored_at is null and h.until is not null), '[]'),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('offer_id', o.id, 'kind', o.kind, 'percent', o.percent, 'ends_at', o.ends_at))
      from public.vendor_offers o where o.vendor_id = p_vendor_id and o.status = 'active' and o.ends_at > now()), '[]'),
    'min_order_usd', (select min_order_usd from public.vendor_ops where vendor_id = p_vendor_id),
    'radius_km', (select delivery_radius_km from public.vendors where id = p_vendor_id),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'audience', c.audience, 'budget_usd', c.budget_usd, 'status', c.status))
      from public.merchant_campaigns c where c.vendor_id = p_vendor_id and c.status <> 'stopped'), '[]'));
end;
$$;

-- The branch's people, for "staff" (owner and manager).
create function public.vendor_staff_list(p_vendor_id uuid, p_member_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id);
  return coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(m.display_name, ''), 'role', m.role, 'phone', m.phone_e164)
    order by m.role, m.display_name) from public.vendor_members m where m.vendor_id = p_vendor_id and m.status = 'active'), '[]');
end;
$$;

-- 8. Reports (§39.7): the day or the last 7 days, from the orders and ratings only ----------------------------------------
create function public.merchant_report(p_vendor_id uuid, p_member_id uuid, p_period text default 'day') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from timestamptz;
  v_r jsonb;
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id);
  v_from := case when p_period = 'week' then now() - interval '7 days'
                 else ((now() at time zone 'Asia/Beirut')::date)::timestamp at time zone 'Asia/Beirut' end;
  select jsonb_build_object(
    'period', case when p_period = 'week' then 'week' else 'day' end,
    'orders', count(*),
    'delivered', count(*) filter (where o.status = 'delivered'),
    'rejected', count(*) filter (where o.status = 'rejected'),
    'cancelled', count(*) filter (where o.status = 'cancelled'),
    'food_sales_usd', coalesce(sum(o.food_subtotal_usd - o.offer_usd) filter (where o.status = 'delivered'), 0),
    'offers_usd', coalesce(sum(o.offer_usd) filter (where o.status = 'delivered'), 0),
    'order_fees_usd', coalesce(sum(o.order_fee_usd) filter (where o.status = 'delivered'), 0),
    'acceptance_median_s', (select percentile_cont(0.5) within group (order by extract(epoch from (x.accepted_at - x.placed_at)))
                             from public.orders x where x.vendor_id = p_vendor_id and x.placed_at >= v_from and x.accepted_at is not null),
    'top_items', coalesce((select jsonb_agg(t) from (
        select jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', coalesce(i.name_en, i.name_ar), 'quantity', sum(i.quantity)) as t
        from public.order_items i join public.orders x on x.id = i.order_id
        where x.vendor_id = p_vendor_id and x.placed_at >= v_from and x.status = 'delivered'
        group by coalesce(i.name_ar, i.name_en), coalesce(i.name_en, i.name_ar) order by sum(i.quantity) desc limit 3) s), '[]'),
    'rating_avg', (select round(avg(r.food_score), 1) from public.order_ratings r where r.vendor_id = p_vendor_id and r.rated_at >= v_from),
    'ratings', (select count(*) from public.order_ratings r where r.vendor_id = p_vendor_id and r.rated_at >= v_from)
  ) into v_r
  from public.orders o where o.vendor_id = p_vendor_id and o.placed_at >= v_from and not o.status = 'awaiting_payment';
  return v_r;
end;
$$;

-- 9. Merchant memory and suggestions (§39.7) -------------------------------------------------------------------------
-- Dated facts learned from the shop's own data (orders, confirmed changes, hours) and how its people write; never
-- prompt text. Refreshed nightly; suggestions read them.
create table public.merchant_facts (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  key text not null check (key ~ '^[a-z_]+$'),
  value jsonb not null,
  source text not null check (source in ('orders', 'changes', 'hours', 'messages')),
  learned_at timestamptz not null default now(),
  primary key (vendor_id, key)
);
alter table public.merchant_facts enable row level security;
revoke all on table public.merchant_facts from public, anon, authenticated;
grant all on table public.merchant_facts to service_role;
grant select on table public.merchant_facts to authenticated;
create policy merchant_facts_read on public.merchant_facts for select to authenticated
  using ((select app_private.is_operator()) or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[]));

create function app_private.merchant_fact_put(p_vendor_id uuid, p_key text, p_value jsonb, p_source text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.merchant_facts (vendor_id, key, value, source) values (p_vendor_id, p_key, coalesce(p_value, 'null'::jsonb), p_source)
  on conflict (vendor_id, key) do update set value = excluded.value, source = excluded.source, learned_at = now()
$$;

-- The language the shop's people write their commands in (the copilot answers in it).
create function public.merchant_fact_writes_in(p_vendor_id uuid, p_lang text) returns void
language sql security definer set search_path = ''
as $$
  select app_private.merchant_fact_put(p_vendor_id, 'writes_in', to_jsonb(p_lang), 'messages')
  where p_lang in ('ar', 'en', 'fr', 'arabizi')
$$;

create function app_private.merchant_facts_refresh(p_vendor_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_since timestamptz := now() - interval '28 days';
begin
  -- Items that usually sell out, and at what Beirut hour (confirmed "sold out" changes, 2+ in 4 weeks).
  perform app_private.merchant_fact_put(p_vendor_id, 'usual_sellouts', coalesce((
    select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'hour', x.hour, 'times', x.n) order by x.n desc) from (
      select (p.payload ->> 'item_id')::uuid as item_id, count(*) as n,
        mode() within group (order by extract(hour from p.decided_at at time zone 'Asia/Beirut')::int) as hour
      from public.merchant_proposals p
      where p.vendor_id = p_vendor_id and p.kind = 'sold_out' and p.status = 'confirmed' and p.decided_at > v_since
      group by 1 having count(*) >= 2 limit 5) x), '[]'), 'changes');
  -- Weekdays the shop usually closes: paused by the merchant (or closed) on that weekday at least 3 of the last 4 weeks.
  perform app_private.merchant_fact_put(p_vendor_id, 'usual_closed_weekdays', coalesce((
    select jsonb_agg(d order by d) from (
      select extract(dow from (c.day))::int as d from public.vendor_closures c
      where c.vendor_id = p_vendor_id and c.day > (now() - interval '28 days')::date
      group by 1 having count(*) >= 3) z), '[]'), 'hours');
  -- Acceptance speed and the quietest weekday (28 days, with enough orders to mean something).
  perform app_private.merchant_fact_put(p_vendor_id, 'acceptance_median_s', to_jsonb((
    select round(percentile_cont(0.5) within group (order by extract(epoch from (o.accepted_at - o.placed_at)))::numeric)
    from public.orders o where o.vendor_id = p_vendor_id and o.placed_at > v_since and o.accepted_at is not null)), 'orders');
  perform app_private.merchant_fact_put(p_vendor_id, 'quiet_weekday', to_jsonb((
    select d from (
      select extract(dow from o.placed_at at time zone 'Asia/Beirut')::int as d, count(*) as n
      from public.orders o where o.vendor_id = p_vendor_id and o.placed_at > v_since and o.status = 'delivered'
      group by 1) w
    where (select count(*) from public.orders o where o.vendor_id = p_vendor_id and o.placed_at > v_since and o.status = 'delivered') >= 20
    order by n, d limit 1)), 'orders');
  -- Past decisions: the last ten confirmed changes, by kind.
  perform app_private.merchant_fact_put(p_vendor_id, 'recent_changes', coalesce((
    select jsonb_agg(jsonb_build_object('kind', p.kind, 'at', p.decided_at) order by p.decided_at desc) from (
      select * from public.merchant_proposals p where p.vendor_id = p_vendor_id and p.status = 'confirmed'
      order by p.decided_at desc limit 10) p), '[]'), 'changes');
end;
$$;

create function app_private.merchant_facts_refresh_all() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  n integer := 0;
begin
  for v in select id from public.vendors where orderable loop
    perform app_private.merchant_facts_refresh(v.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
select cron.schedule('merchant-facts', '23 2 * * *', $$select app_private.merchant_facts_refresh_all()$$);

-- "What do you remember about my shop?": the facts, the settings and the last changes (owner and manager).
create function public.merchant_memory(p_vendor_id uuid, p_member_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id);
  return jsonb_build_object(
    'facts', coalesce((select jsonb_object_agg(f.key, jsonb_build_object('value', f.value, 'learned_at', f.learned_at))
                       from public.merchant_facts f where f.vendor_id = p_vendor_id), '{}'),
    'sellout_names', coalesce((select jsonb_agg(coalesce(i.name_ar, i.name_en)) from public.merchant_facts f,
        jsonb_array_elements(f.value) x join public.menu_items i on i.id = (x ->> 'item_id')::uuid
      where f.vendor_id = p_vendor_id and f.key = 'usual_sellouts'), '[]'),
    'parts', public.merchant_menu_parts(p_vendor_id, p_member_id));
end;
$$;

-- Suggestions: every 15 minutes, each at most once a day per shop and kind, each a proposal card the merchant taps (or
-- lets expire). They never change anything by themselves (§39.7).
create table app_private.merchant_suggestions (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  key text not null,
  day date not null,
  proposal_id uuid,
  primary key (vendor_id, key, day)
);
revoke all on table app_private.merchant_suggestions from public, anon, authenticated;

create function app_private.merchant_suggest(p_vendor_id uuid, p_key text, p_kind public.proposal_kind, p_payload jsonb, p_summary text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Beirut')::date;
  v_id uuid;
  v_to text := (select p.owner_mobile from public.vendor_private p where p.vendor_id = p_vendor_id);
begin
  if v_to is null or v_to !~ '^\+[1-9][0-9]{6,14}$' then
    return null;
  end if;
  insert into app_private.merchant_suggestions (vendor_id, key, day) values (p_vendor_id, p_key, v_day) on conflict do nothing;
  if not found then
    return null;
  end if;
  begin
    v_id := app_private.merchant_proposal_create(p_vendor_id, p_kind, p_payload, 'rules', null);
  exception when check_violation then
    return null; -- the suggestion no longer fits (the item left the menu, nothing to switch off)
  end;
  update public.merchant_proposals set expires_at = now() + make_interval(mins => public.config_numeric('merchant_suggestion_ttl_min')::int)
  where id = v_id;
  update app_private.merchant_suggestions set proposal_id = v_id where vendor_id = p_vendor_id and key = p_key and day = v_day;
  perform app_private.outbox_add('suggest:' || v_id, null, p_vendor_id, 'whatsapp', 'proposal', v_to,
    jsonb_build_object('proposal_id', v_id, 'summary', p_summary));
  return v_id;
end;
$$;

create function app_private.merchant_suggest_tick() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  s record;
  n integer := 0;
  v_now timestamp := now() at time zone 'Asia/Beirut';
  v_tomorrow date := (now() at time zone 'Asia/Beirut')::date + 1;
  v_quiet int;
begin
  if not coalesce((public.config_value('merchant_suggestions_enabled') #>> '{}')::boolean, false) then
    return 0;
  end if;
  perform set_config('app.actor_kind', 'system', true);
  for v in select x.id from public.vendors x where x.orderable and not x.is_test loop
    -- An item that usually sells out around this hour (within the next 30 minutes) and is still on.
    for s in
      select (e ->> 'item_id')::uuid as item_id, (e ->> 'hour')::int as hour, coalesce(i.name_ar, i.name_en) as name
      from public.merchant_facts f, jsonb_array_elements(f.value) e
      join public.menu_items i on i.id = (e ->> 'item_id')::uuid
      where f.vendor_id = v.id and f.key = 'usual_sellouts' and i.available
        and extract(hour from v_now + interval '30 minutes')::int = (e ->> 'hour')::int
    loop
      if app_private.merchant_suggest(v.id, 'sellout:' || s.item_id, 'sold_out', jsonb_build_object('item_id', s.item_id),
           format('💡 «%s» عادةً بيخلص هالوقت. نعلّمو خالص؟ / "%s" usually sells out around now. Mark it sold out?', s.name, s.name)) is not null then
        n := n + 1;
      end if;
    end loop;
    -- The evening before a usual closing weekday (20:00-20:15 Beirut).
    if extract(hour from v_now) = 20 and extract(minute from v_now) < 15 and exists (
      select 1 from public.merchant_facts f, jsonb_array_elements_text(f.value) d
      where f.vendor_id = v.id and f.key = 'usual_closed_weekdays' and d::int = extract(dow from v_tomorrow)::int)
      and not exists (select 1 from public.vendor_closures c where c.vendor_id = v.id and c.day = v_tomorrow) then
      if app_private.merchant_suggest(v.id, 'closure:' || v_tomorrow, 'closure', jsonb_build_object('day', v_tomorrow, 'reason', 'usual closing day'),
           '💡 بكرا عادةً مسكّرين. نسكّر الطلبات بكرا؟ / You usually close tomorrow. Close orders for tomorrow?') is not null then
        n := n + 1;
      end if;
    end if;
    -- Monday 18:00-18:15: the quietest weekday of the last 4 weeks gets a happy-hour offer to confirm.
    select (f.value #>> '{}')::int into v_quiet from public.merchant_facts f where f.vendor_id = v.id and f.key = 'quiet_weekday'
      and jsonb_typeof(f.value) = 'number';
    if v_quiet is not null and extract(dow from v_now) = 1 and extract(hour from v_now) = 18 and extract(minute from v_now) < 15
       and not exists (select 1 from public.vendor_offers o where o.vendor_id = v.id and o.status = 'active' and o.ends_at > now()) then
      if app_private.merchant_suggest(v.id, 'quiet_offer', 'offer_create',
           jsonb_build_object('kind', 'happy_hour', 'percent', 10, 'weekdays', jsonb_build_array(v_quiet), 'from', '15:00', 'to', '18:00', 'days', 7),
           '💡 يوم الهدوء عندك: خصم ١٠٪ من ٣ لـ ٦ هالأسبوع؟ / Your quiet day: 10% off from 3 to 6 pm this week?') is not null then
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end;
$$;
select cron.schedule('merchant-suggestions', '*/15 * * * *', $$select app_private.merchant_suggest_tick()$$);

-- The weekly summary every Monday at 09:00 Beirut, as text to the owner (no tap: it changes nothing), with a slow-acceptance
-- flag when the median is over 3 minutes.
create function app_private.merchant_weekly_summary() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  r jsonb;
  n integer := 0;
  v_to text;
begin
  perform set_config('app.actor_kind', 'system', true);
  for v in select x.id, coalesce(x.name_ar, x.name_en) as name from public.vendors x where x.orderable and not x.is_test loop
    v_to := (select p.owner_mobile from public.vendor_private p where p.vendor_id = v.id);
    continue when v_to is null or v_to !~ '^\+[1-9][0-9]{6,14}$';
    r := public.merchant_report(v.id, null, 'week');
    continue when coalesce((r ->> 'orders')::int, 0) = 0;
    perform app_private.outbox_add('weekly:' || v.id || ':' || to_char(now() at time zone 'Asia/Beirut', 'IYYY-IW'), null, v.id, 'whatsapp', 'reply', v_to,
      jsonb_build_object('text', format(
        E'📊 أسبوعك على Alo King / Your week:\n• طلبات / orders: %s (وصل / delivered %s)\n• مبيعات الأكل / food sales: $%s\n• تقييم / rating: %s (%s)%s',
        r ->> 'orders', r ->> 'delivered', to_char((r ->> 'food_sales_usd')::numeric, 'FM999990.00'),
        coalesce(r ->> 'rating_avg', '–'), r ->> 'ratings',
        case when coalesce((r ->> 'acceptance_median_s')::numeric, 0) > 180
             then format(E'\n⏱ القبول بطيء (%s د) / Slow acceptance (%s min): «capacity 6» بيساعد', round((r ->> 'acceptance_median_s')::numeric / 60), round((r ->> 'acceptance_median_s')::numeric / 60))
             else '' end)));
    n := n + 1;
  end loop;
  return n;
end;
$$;
select cron.schedule('merchant-weekly-summary', '0 6 * * 1', $$select app_private.merchant_weekly_summary()$$);

revoke all on function app_private.merchant_fact_put(uuid, text, jsonb, text), app_private.merchant_facts_refresh(uuid),
  app_private.merchant_facts_refresh_all(), app_private.merchant_suggest(uuid, text, public.proposal_kind, jsonb, text),
  app_private.merchant_suggest_tick(), app_private.merchant_weekly_summary() from public;
revoke all on function public.merchant_menu_parts(uuid, uuid), public.merchant_report(uuid, uuid, text), public.merchant_memory(uuid, uuid),
  public.merchant_fact_writes_in(uuid, text), public.vendor_staff_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merchant_menu_parts(uuid, uuid), public.merchant_report(uuid, uuid, text), public.merchant_memory(uuid, uuid),
  public.merchant_fact_writes_in(uuid, text), public.vendor_staff_list(uuid, uuid) to service_role;
revoke all on function app_private.vendor_offers_bump_version() from public;

-- 10. The customer side (§20.4, §39.7): the best running offer comes off the food (merchant-funded: with cash on
-- delivery the merchant simply collects less) before any customer credit; the commission is on the food after the
-- offer; a basket under the minimum order is refused with what is missing. Both functions as in 20261015120100
-- with these steps added.

create or replace function public.basket_quote(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_view jsonb;
  v_route record;
  v_quote record;
  v_subtotal numeric;
  v_offer_id uuid;
  v_offer_usd numeric := 0;
  v_min numeric;
  v_deposit numeric;
  v_stairs numeric := 0;
  v_fee numeric := 0;
  v_credit numeric := 0;
  v_total numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_new boolean;
  v_cap numeric;
  v_road numeric;
  v_test boolean;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  v_view := public.basket_view(p_customer_id);
  if jsonb_array_length(v_view -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  select * into v_vendor from public.vendors where id = v_basket.vendor_id;
  v_test := app_private.vendor_is_test(v_vendor.id);
  v_subtotal := (v_view ->> 'subtotal_usd')::numeric;
  -- The merchant's minimum order (§39.7), on the food before any offer.
  select o.min_order_usd into v_min from public.vendor_ops o where o.vendor_id = v_basket.vendor_id;
  if v_min is not null and v_subtotal < v_min then
    return jsonb_build_object('status', 'below_minimum', 'basket', v_view, 'min_order_usd', v_min, 'subtotal_usd', v_subtotal,
      'missing_usd', v_min - v_subtotal);
  end if;
  -- The best running merchant offer (§20.4: merchant-funded, priced here from the server's lines).
  select f.offer_id, f.amount_usd into v_offer_id, v_offer_usd from app_private.offer_for_basket(v_basket.id) f;
  v_offer_usd := coalesce(v_offer_usd, 0);
  select coalesce(sum(case when (l ->> 'has_empty')::boolean is false then (l ->> 'deposit_usd')::numeric * (l ->> 'quantity')::int else 0 end), 0)
    into v_deposit from jsonb_array_elements(v_view -> 'lines') l;
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address', 'basket', v_view);
    end if;
    if v_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road := 0;
      v_fee := v_quote.fee_usd;
    else
      if not app_private.place_delivered_to(v_address.place_id) then
        return jsonb_build_object('status', 'place_paused', 'basket', v_view);
      end if;
      select * into v_route from public.route_cache_lookup(
        extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
        array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]);
      if v_route.distance_m is null then
        return jsonb_build_object('status', 'no_route', 'basket', v_view,
          'origin', jsonb_build_object('lat', extensions.st_y(v_vendor.location::extensions.geometry), 'lon', extensions.st_x(v_vendor.location::extensions.geometry)),
          'dest', jsonb_build_object('lat', extensions.st_y(v_address.pin::extensions.geometry), 'lon', extensions.st_x(v_address.pin::extensions.geometry)));
      end if;
      select * into v_quote from public.delivery_quote(v_vendor.id, round(v_route.distance_m / 1000.0, 2));
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason, 'basket', v_view, 'limit_km', v_quote.limit_km,
          'road_km', v_quote.road_km, 'pickup_enabled', v_vendor.pickup_enabled);
      end if;
      v_road := round(v_route.distance_m / 1000.0, 2);
      v_fee := v_quote.fee_usd;
    end if;
    v_stairs := app_private.stairs_fee_usd(v_basket.id);
  end if;
  select coalesce(sum(c.amount_usd), 0) into v_credit from app_private.credits_for(p_customer_id, v_subtotal - v_offer_usd) c;
  v_total := v_subtotal - v_offer_usd + v_fee + v_deposit + v_stairs - v_credit;
  v_new := not exists (select 1 from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered');
  v_cap := public.config_numeric('cod_cap_usd');
  if v_new then
    v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
  end if;
  return jsonb_build_object('status', 'ok', 'basket', v_view, 'subtotal_usd', v_subtotal, 'delivery_fee_usd', v_fee,
    'deposit_usd', v_deposit, 'stairs_fee_usd', v_stairs, 'offer_usd', v_offer_usd, 'offer_id', v_offer_id,
    'offer', (select jsonb_build_object('kind', f.kind, 'percent', f.percent) from public.vendor_offers f where f.id = v_offer_id),
    'credit_usd', v_credit, 'total_usd', v_total, 'usd_lbp_rate', v_rate,
    'total_lbp', round(v_total * v_rate, 0), 'road_km', v_road,
    'cod_cap_usd', v_cap, 'over_cod_cap', v_basket.payment_method = 'cod' and v_total > v_cap,
    'estimated', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'estimated')::boolean),
    'needs_empty_answer', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'needs_empty_answer')::boolean),
    'stairs_fee_per_floor_usd', v_vendor.stairs_fee_per_floor_usd,
    'is_gift', v_basket.is_gift, 'recipient_name', v_basket.recipient_name, 'allergy_note', app_private.basket_allergy_note(v_basket.id),
    'address', case when v_address.id is not null then public.address_card(v_address.id) end);
end;
$function$;

create or replace function public.order_place(p_basket_id uuid, p_expected_menu_version bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.orders%rowtype;
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_place_status public.service_status;
  v_priced jsonb;
  v_rate numeric := public.usd_lbp_rate();
  v_road_km numeric;
  v_quote record;
  v_delivery_fee numeric := 0;
  v_deposit numeric := 0;
  v_stairs numeric := 0;
  v_credit numeric := 0;
  v_credit_ids uuid[] := '{}';
  v_subtotal numeric;
  v_offer_id uuid;
  v_offer_usd numeric := 0;
  v_min numeric;
  v_total numeric;
  v_cap numeric;
  v_new_customer boolean;
  v_weighted boolean;
  v_order public.orders%rowtype;
  v_line record;
  v_low_threshold integer := public.config_numeric('daily_qty_low_threshold')::integer;
  v_low jsonb := '[]';
  v_remaining integer;
begin
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if v_existing.id is not null and v_existing.basket_id is distinct from p_basket_id then
    raise exception 'idempotency key already used for another basket' using errcode = 'unique_violation';
  end if;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
      'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
      'estimated', v_existing.weight_status <> 'none', 'repeat', true);
  end if;

  select * into v_basket from public.baskets where id = p_basket_id for update;
  if v_basket.id is null then
    raise exception 'unknown basket %', p_basket_id using errcode = 'no_data_found';
  end if;
  if v_basket.status <> 'open' then
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
        'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
        'estimated', v_existing.weight_status <> 'none', 'repeat', true);
    end if;
    raise exception 'basket % is %', p_basket_id, v_basket.status using errcode = 'check_violation';
  end if;
  select * into v_vendor from public.vendors where id = v_basket.vendor_id for no key update;

  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if v_vendor.paused_until is not null and v_vendor.paused_until > now() then
    return jsonb_build_object('status', 'vendor_paused', 'until', v_vendor.paused_until);
  end if;
  if (v_basket.fulfilment = 'delivery' and not v_vendor.delivery_enabled)
     or (v_basket.fulfilment = 'pickup' and not v_vendor.pickup_enabled) then
    return jsonb_build_object('status', 'fulfilment_unavailable');
  end if;
  if v_basket.payment_method <> 'cod' and not coalesce((public.config_value('online_payments_enabled') #>> '{}')::boolean, false) then
    return jsonb_build_object('status', 'online_payment_off');
  end if;
  -- A gift is placed only from the recipient's acceptance (gift_respond), never from the sender's own Confirm tap.
  if v_basket.is_gift and p_idempotency_key not like 'gift:%' then
    return jsonb_build_object('status', 'gift_needs_recipient');
  end if;
  -- The delivery address is confirmed on every order (§39.6).
  if v_basket.fulfilment = 'delivery' and not app_private.basket_address_confirmed(v_basket.id) then
    return jsonb_build_object('status', 'address_unconfirmed');
  end if;

  if v_vendor.menu_version <> p_expected_menu_version or v_basket.priced_menu_version is distinct from p_expected_menu_version then
    v_priced := public.basket_price(p_basket_id);
    return jsonb_build_object('status', case when jsonb_array_length(v_priced -> 'unavailable') > 0 then 'unavailable' else 'repriced' end,
      'summary', v_priced);
  end if;
  v_priced := public.basket_price(p_basket_id);
  if jsonb_array_length(v_priced -> 'unavailable') > 0 then
    return jsonb_build_object('status', 'unavailable', 'summary', v_priced);
  end if;
  if jsonb_array_length(v_priced -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  if exists (
    select 1 from public.basket_items bi join public.menu_items i on i.id = bi.item_id
    where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null
  ) then
    return jsonb_build_object('status', 'needs_empty_answer', 'items', (
      select jsonb_agg(bi.item_id) from public.basket_items bi join public.menu_items i on i.id = bi.item_id
      where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null));
  end if;
  v_subtotal := (v_priced ->> 'subtotal_usd')::numeric;
  select o.min_order_usd into v_min from public.vendor_ops o where o.vendor_id = v_basket.vendor_id;
  if v_min is not null and v_subtotal < v_min then
    return jsonb_build_object('status', 'below_minimum', 'min_order_usd', v_min, 'missing_usd', v_min - v_subtotal);
  end if;
  select f.offer_id, f.amount_usd into v_offer_id, v_offer_usd from app_private.offer_for_basket(v_basket.id) f;
  v_offer_usd := coalesce(v_offer_usd, 0);
  select coalesce(sum((l ->> 'container_deposit_usd')::numeric), 0), bool_or((l ->> 'estimated')::boolean)
    into v_deposit, v_weighted from jsonb_array_elements(v_priced -> 'lines') l;

  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id and customer_id = v_basket.customer_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address');
    end if;
    if v_vendor.is_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road_km := 0;
    else
      select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
      if v_place_status is distinct from 'on' then
        return jsonb_build_object('status', 'place_paused');
      end if;
      select c.distance_m / 1000.0 into v_road_km
      from public.route_cache_lookup(
        extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
        array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]) c;
      select * into v_quote from public.delivery_quote(v_vendor.id, round(v_road_km, 2));
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason);
      end if;
    end if;
    v_delivery_fee := v_quote.fee_usd;
    -- §38.3 rule from config; the merchant's per-floor field only says that it carries upstairs.
    v_stairs := app_private.stairs_fee_usd(v_basket.id);
  end if;

  -- Customer credits (disputes, §38.3): a discount on this order, each credit used whole.
  select coalesce(sum(c.amount_usd), 0), coalesce(array_agg(c.credit_id), '{}') into v_credit, v_credit_ids
  from app_private.credits_for(v_basket.customer_id, v_subtotal - v_offer_usd) c;

  v_total := v_subtotal - v_offer_usd + v_delivery_fee + v_deposit + v_stairs - v_credit;

  v_new_customer := not exists (
    select 1 from public.orders o where o.customer_id = v_basket.customer_id and o.status = 'delivered'
  );
  if v_basket.payment_method = 'cod' then
    v_cap := public.config_numeric('cod_cap_usd');
    if v_new_customer then
      v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
    end if;
    if v_total > v_cap then
      return jsonb_build_object('status', 'cod_cap', 'cap_usd', v_cap, 'total_usd', v_total, 'new_customer', v_new_customer);
    end if;
  end if;

  for v_line in
    select q.item_id, sum(q.quantity)::integer as quantity
    from (
      select bi.item_id, bi.quantity from public.basket_items bi where bi.basket_id = p_basket_id
      union all
      select c.component_item_id, c.quantity * bi.quantity from public.basket_items bi
      join public.menu_combo_components c on c.combo_item_id = bi.item_id where bi.basket_id = p_basket_id
    ) q
    group by q.item_id
    order by q.item_id
  loop
    update public.menu_items i
    set daily_remaining = i.daily_remaining - v_line.quantity
    where i.id = v_line.item_id and i.daily_remaining is not null and i.daily_date = current_date
      and i.daily_remaining >= v_line.quantity
    returning i.daily_remaining into v_remaining;
    if not found then
      if exists (select 1 from public.menu_items i where i.id = v_line.item_id and i.daily_remaining is not null
                 and i.daily_date = current_date) then
        raise exception 'sold_out: item %', v_line.item_id using errcode = 'check_violation';
      end if;
    else
      if v_remaining <= v_low_threshold then
        v_low := v_low || jsonb_build_object('item_id', v_line.item_id, 'remaining', v_remaining);
      end if;
    end if;
  end loop;

  insert into public.orders (
    code, idempotency_key, basket_id, customer_id, vendor_id, status, fulfilment, delivery_mode, payment_method,
    address_id, delivery_place_id, delivery_pin, road_km, menu_version, usd_lbp_rate, food_subtotal_usd,
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, credit_usd, offer_id, offer_usd, discount_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_credit, v_offer_id, v_offer_usd, v_credit + v_offer_usd, v_total,
    -- The commission is on the food the merchant actually sells, after its own offer.
    public.order_fee_usd(v_vendor.id, v_subtotal - v_offer_usd), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
    case when v_weighted then v_total end, v_new_customer, v_basket.customer_note, v_vendor.default_prep_minutes,
    case when v_basket.payment_method = 'cod' then now() end
  ) returning * into v_order;

  if cardinality(v_credit_ids) > 0 then
    update public.customer_credits set used_order_id = v_order.id where id = any (v_credit_ids);
  end if;

  insert into public.order_items (order_id, item_id, name_ar, name_en, name_fr, quantity, pricing_unit, unit_price_usd,
    options, options_total_usd, est_weight_kg, price_per_kg_usd, line_total_usd, container_deposit_usd, has_empty, note)
  select v_order.id, i.id, i.name_ar, i.name_en, i.name_fr, bi.quantity, i.pricing_unit,
    case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name_ar', o.name_ar, 'name_en', o.name_en,
      'price_delta_usd', o.price_delta_usd) order by o.sort_order) from public.menu_options o where o.id = any (bi.option_ids)), '[]'),
    coalesce((select sum(o.price_delta_usd) from public.menu_options o where o.id = any (bi.option_ids)), 0),
    case when i.pricing_unit = 'kg' then i.est_weight_kg * bi.quantity end,
    case when i.pricing_unit = 'kg' then i.price_usd end,
    bi.line_total_usd,
    case when i.container_deposit_usd is not null and bi.has_empty is false then i.container_deposit_usd * bi.quantity else 0 end,
    case when i.container_deposit_usd is not null then bi.has_empty end,
    bi.note
  from public.basket_items bi join public.menu_items i on i.id = bi.item_id
  where bi.basket_id = p_basket_id;

  update public.baskets set status = 'ordered' where id = p_basket_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, detail)
  values (v_order.id, null, v_order.status, 'placed', app_private.current_actor_kind(),
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low, 'credit_usd', v_credit, 'offer_usd', v_offer_usd));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low, 'credit_usd', v_credit);
end;
$function$;
