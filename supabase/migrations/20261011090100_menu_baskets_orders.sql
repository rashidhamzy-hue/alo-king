-- Phase 2 core (DECISIONS §7.2, §10 session 3): menus, baskets and orders with a database-enforced state
-- machine, plus the session 3 items of §27.9, §29.8 and §30.1-30.3 that live in the order itself:
--   * status model of §27.5 (merchant `driver` role, merchant assignment)
--   * menu version check at confirmation (§30.1.1), combos follow their parts (§30.1.3),
--     optional daily quantities (§30.1.4)
--   * variable-weight items and empty-container exchange (§29.2), stairs fee option (§29.2, §30.3.2)
--   * per-business_type order fee rules (§29.1), unified $50 COD cap for a number's first order (§29.4)
--   * brand node flags: delivery_enabled, pickup_enabled, public_listing (§30.2.4)
--   * customer cancellation rule (§30.3.6)
-- None of the SQL in the research reports is used (§29, §30): this schema is designed here.
--
-- Every status change goes through app_private.order_set_status(): a conditional update on the expected
-- current status (the race guard), a transition check (also enforced by a trigger for any other writer),
-- and one append-only order_events row. Prices, fees, totals, the COD cap and the exchange rate come from
-- the database only; the client, the model and WhatsApp send item IDs and quantities, never amounts.

-- 1. Enums --------------------------------------------------------------------------------------------
create type public.order_status as enum (
  'awaiting_payment', 'placed', 'accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup',
  'at_pickup', 'picked_up', 'near_drop', 'arrived', 'delivered', 'failed', 'rejected', 'cancelled'
);
create type public.fulfilment_kind as enum ('delivery', 'pickup');
create type public.delivery_mode as enum ('merchant', 'fleet', 'partner');
create type public.payment_method as enum ('cod', 'whish', 'tap');
create type public.pricing_unit as enum ('each', 'kg');
create type public.basket_status as enum ('open', 'ordered', 'expired', 'abandoned');
create type public.reject_reason as enum (
  'busy', 'item_unavailable', 'closed', 'area_unavailable', 'menu_or_price_issue', 'other'
);
create type public.cancel_reason as enum (
  'customer', 'customer_request_accepted', 'merchant_unreachable', 'merchant_paused', 'operator', 'payment_timeout',
  'weight_declined', 'no_delivery'
);
create type public.cancel_request_status as enum ('pending', 'accepted', 'refused');
create type public.weight_status as enum ('none', 'awaiting_weight', 'awaiting_customer', 'final');

-- 2. Config added by this migration ---------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §29-§30, 11 October 2026', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('customer_free_cancel_after_accept_s', '60', '2026-10-11 00:00+03', 'Customer cancels free for this long after acceptance (DECISIONS §30.3.6)', null),
  ('daily_qty_low_threshold', '3', '2026-10-11 00:00+03', 'Daily quantity at which an item shows "last few" and the merchant gets +10/+20/Sold out (DECISIONS §30.1.4)', null),
  ('weighted_increase_confirm_share', '0.10', '2026-10-11 00:00+03', 'A final weight total above the estimate by more than this needs the customer''s tap (DECISIONS §29.2)', null),
  ('basket_ttl_hours', '24', '2026-10-11 00:00+03', 'An open basket expires after this long without activity (24-hour window, DECISIONS §29.3)', null),
  ('online_payments_enabled', 'false', '2026-10-11 00:00+03', 'Whish and Tap stay off until the lawyer''s letter and Phase 6 (DECISIONS §1, §20.1)', null);

-- Per-business_type order fee rules (§29.1): a dated table like the price list. The fee for an order is
-- flat + percent of the food subtotal, clamped to [min, max]. The first free days come from price_list
-- `order_fee` rules (`free_days`).
create table public.order_fee_rules (
  id bigint generated always as identity primary key,
  business_type public.business_type not null,
  flat_usd numeric(10, 4) not null default 0 check (flat_usd >= 0),
  percent numeric(6, 5) not null default 0 check (percent >= 0 and percent < 1),
  min_usd numeric(10, 4) check (min_usd >= 0),
  max_usd numeric(10, 4) check (max_usd >= 0),
  effective_from timestamptz not null,
  note text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint order_fee_rules_unique unique (business_type, effective_from),
  constraint order_fee_rules_min_max check (min_usd is null or max_usd is null or min_usd <= max_usd)
);
create trigger order_fee_rules_dated_guard before update or delete on public.order_fee_rules
  for each row execute function app_private.dated_row_guard();
create trigger order_fee_rules_no_backdate before insert on public.order_fee_rules
  for each row execute function app_private.dated_row_no_backdate();
create trigger order_fee_rules_no_truncate before truncate on public.order_fee_rules
  for each statement execute function app_private.forbid_change();
create trigger order_fee_rules_audit after insert or delete on public.order_fee_rules
  for each row execute function app_private.audit_row();
alter table public.order_fee_rules enable row level security;
revoke all on table public.order_fee_rules from public, anon, authenticated;
grant select, insert, delete on table public.order_fee_rules to service_role;
grant select, insert, delete on table public.order_fee_rules to authenticated;
grant select on table public.order_fee_rules to anon;
create policy order_fee_rules_read on public.order_fee_rules for select to anon, authenticated using (true);
create policy order_fee_rules_admin_insert on public.order_fee_rules for insert to authenticated
  with check ((select app_private.is_admin()));
create policy order_fee_rules_admin_delete on public.order_fee_rules for delete to authenticated
  using ((select app_private.is_admin()));

insert into public.order_fee_rules (business_type, flat_usd, percent, min_usd, max_usd, effective_from, note, created_by)
select bt::public.business_type, r.flat, r.pct, r.mn, r.mx, '2026-10-11 00:00+03', r.note, null
from (values
  ('restaurant', 1.00, 0, null, null, 'prepared food, flat (DECISIONS §29.1)'),
  ('fast_food', 1.00, 0, null, null, 'prepared food, flat (DECISIONS §29.1)'),
  ('cafe', 1.00, 0, null, null, 'prepared food, flat (DECISIONS §29.1)'),
  ('bakery_manakish', 1.00, 0, null, null, 'prepared food, flat (DECISIONS §29.1)'),
  ('sweets_pastry', 1.00, 0, null, null, 'prepared food, flat (DECISIONS §29.1)'),
  ('ice_cream', 1.00, 0, null, null, 'prepared food, flat (DECISIONS §29.1)'),
  ('grocery_supermarket', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('minimarket', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('butcher', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('poultry', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('fish_market', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('produce', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('roastery_nuts', 0, 0.025, 1.00, 3.00, '2.5%, min $1, max $3 (DECISIONS §29.1)'),
  ('home_essentials', 0.50, 0, null, null, 'flat (DECISIONS §29.1)'),
  ('other_food', 1.00, 0, null, null, 'flat (DECISIONS §29.1)')
) as r (bt, flat, pct, mn, mx, note);

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 3. Vendor columns -----------------------------------------------------------------------------------
alter table public.vendors
  add column menu_version bigint not null default 1,
  add column delivery_enabled boolean not null default true,
  add column pickup_enabled boolean not null default false,
  add column public_listing boolean not null default true,
  add column paused_until timestamptz,
  add column pause_reason text check (char_length(pause_reason) <= 200),
  add column stairs_fee_per_floor_usd numeric(6, 2) check (stairs_fee_per_floor_usd >= 0),
  add column default_prep_minutes smallint not null default 20 check (default_prep_minutes between 1 and 240),
  add column live_since timestamptz,
  add constraint vendors_takes_some_orders check (delivery_enabled or pickup_enabled);

-- The first moment a vendor becomes orderable starts its free order-fee days (§20.4).
create function app_private.vendors_set_live_since() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.orderable and new.live_since is null then
    new.live_since := now();
  end if;
  return new;
end;
$$;
create trigger vendors_set_live_since before insert or update of orderable on public.vendors
  for each row execute function app_private.vendors_set_live_since();
update public.vendors set live_since = now() where orderable and live_since is null;

grant select (menu_version, delivery_enabled, pickup_enabled, public_listing, paused_until)
  on table public.vendors to anon, authenticated;

create function public.vendor_is_paused(p_vendor_id uuid, p_at timestamptz default now()) returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select v.paused_until > p_at from public.vendors v where v.id = p_vendor_id), false);
$$;
revoke all on function public.vendor_is_paused(uuid, timestamptz) from public;
grant execute on function public.vendor_is_paused(uuid, timestamptz) to anon, authenticated, service_role;

-- 4. Menus ----------------------------------------------------------------------------------------------
-- One menu per vendor (branch). Brand-shared menus with per-branch prices (§18.1 F) come with Phase 3's
-- menu editor; a branch row is what an order prices against either way.
create table public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  name_ar text,
  name_en text,
  name_fr text,
  sort_order integer not null default 0,
  meal_times public.meal_time[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_sections_has_name check (coalesce(name_ar, name_en, name_fr) is not null)
);
create index menu_sections_vendor_idx on public.menu_sections (vendor_id, sort_order);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  section_id uuid references public.menu_sections (id) on delete set null,
  name_ar text,
  name_en text,
  name_fr text,
  description text check (char_length(description) <= 500),
  -- `each`: price per item. `kg`: price per kilogram with an estimated weight per unit (§29.2).
  pricing_unit public.pricing_unit not null default 'each',
  price_usd numeric(10, 2) not null check (price_usd >= 0),
  est_weight_kg numeric(7, 3) check (est_weight_kg > 0),
  available boolean not null default true,
  -- Optional daily quantity (§30.1.4): null = unlimited. Reset by the merchant each day.
  daily_quantity integer check (daily_quantity >= 0),
  daily_remaining integer check (daily_remaining >= 0),
  daily_date date,
  -- Empty-container exchange (§29.2): non-null for gas cylinders, water gallons and the like.
  container_deposit_usd numeric(10, 2) check (container_deposit_usd >= 0),
  is_combo boolean not null default false,
  -- Merchant-declared flags (§17), never guessed by the AI.
  contains_pork boolean not null default false,
  contains_alcohol boolean not null default false,
  vegetarian boolean not null default false,
  vegan boolean not null default false,
  spicy_level smallint not null default 0 check (spicy_level between 0 and 3),
  allergens public.allergen[] not null default '{}',
  fasting_friendly boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_has_name check (coalesce(name_ar, name_en, name_fr) is not null),
  constraint menu_items_kg_has_weight check ((pricing_unit = 'kg') = (est_weight_kg is not null)),
  constraint menu_items_daily_pair check ((daily_quantity is null) = (daily_remaining is null)),
  constraint menu_items_daily_not_above check (daily_remaining is null or daily_remaining <= daily_quantity),
  constraint menu_items_combo_each check (not is_combo or pricing_unit = 'each')
);
create index menu_items_vendor_idx on public.menu_items (vendor_id, section_id, sort_order, id);

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.menu_items (id) on delete cascade,
  name_ar text,
  name_en text,
  name_fr text,
  min_select smallint not null default 0 check (min_select >= 0),
  max_select smallint not null default 1 check (max_select >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_option_groups_has_name check (coalesce(name_ar, name_en, name_fr) is not null),
  constraint menu_option_groups_range check (min_select <= max_select)
);
create index menu_option_groups_item_idx on public.menu_option_groups (item_id);

create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups (id) on delete cascade,
  name_ar text,
  name_en text,
  name_fr text,
  price_delta_usd numeric(10, 2) not null default 0 check (price_delta_usd >= 0),
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_options_has_name check (coalesce(name_ar, name_en, name_fr) is not null)
);
create index menu_options_group_idx on public.menu_options (group_id);

-- A combo lists its component items; a sold-out component hides the combo (§30.1.3).
create table public.menu_combo_components (
  combo_item_id uuid not null references public.menu_items (id) on delete cascade,
  component_item_id uuid not null references public.menu_items (id) on delete restrict,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  primary key (combo_item_id, component_item_id),
  constraint menu_combo_not_self check (combo_item_id <> component_item_id)
);
create index menu_combo_components_component_idx on public.menu_combo_components (component_item_id);

-- Combos and their components belong to the same vendor; a component is never itself a combo.
create function app_private.menu_combo_check() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_combo public.menu_items%rowtype;
  v_part public.menu_items%rowtype;
begin
  select * into v_combo from public.menu_items where id = new.combo_item_id;
  select * into v_part from public.menu_items where id = new.component_item_id;
  if not v_combo.is_combo then
    raise exception 'item % is not a combo', new.combo_item_id using errcode = 'check_violation';
  end if;
  if v_part.is_combo then
    raise exception 'a combo cannot contain another combo' using errcode = 'check_violation';
  end if;
  if v_combo.vendor_id <> v_part.vendor_id then
    raise exception 'combo components must belong to the same vendor' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger menu_combo_components_check before insert or update on public.menu_combo_components
  for each row execute function app_private.menu_combo_check();

-- An item can be ordered now: available, its daily quantity (if tracked, for today) not used up, and for
-- a combo every component orderable too. Untracked or yesterday's quantities count as unlimited.
create function app_private.menu_item_orderable(p_item_id uuid, p_qty integer default 1) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select i.available
      and (i.daily_remaining is null or i.daily_date is distinct from current_date or i.daily_remaining >= p_qty)
      and not exists (
        select 1 from public.menu_combo_components c
        join public.menu_items p on p.id = c.component_item_id
        where c.combo_item_id = i.id
          and not (p.available
                   and (p.daily_remaining is null or p.daily_date is distinct from current_date
                        or p.daily_remaining >= c.quantity * p_qty))
      )
    from public.menu_items i where i.id = p_item_id
  ), false);
$$;

-- Menu version (§30.1.1): any change to price, availability, options, combos or sections bumps the
-- vendor's version, including a daily quantity reaching zero. A plain countdown does not.
create function app_private.menu_bump_version() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'menu_items' then
    -- Ignore a countdown that does not reach zero and timestamp-only touches.
    if (v_old - 'daily_remaining' - 'updated_at') = (v_new - 'daily_remaining' - 'updated_at')
       and (coalesce((v_old ->> 'daily_remaining')::int, -1) = 0) = (coalesce((v_new ->> 'daily_remaining')::int, -1) = 0) then
      return new;
    end if;
  elsif tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  if tg_table_name in ('menu_sections', 'menu_items') then
    v_vendor := (v_row ->> 'vendor_id')::uuid;
  elsif tg_table_name = 'menu_option_groups' then
    select i.vendor_id into v_vendor from public.menu_items i where i.id = (v_row ->> 'item_id')::uuid;
  elsif tg_table_name = 'menu_options' then
    select i.vendor_id into v_vendor from public.menu_option_groups g
    join public.menu_items i on i.id = g.item_id where g.id = (v_row ->> 'group_id')::uuid;
  elsif tg_table_name = 'menu_combo_components' then
    select i.vendor_id into v_vendor from public.menu_items i where i.id = (v_row ->> 'combo_item_id')::uuid;
  end if;
  if v_vendor is not null then
    update public.vendors set menu_version = menu_version + 1 where id = v_vendor;
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['menu_sections', 'menu_items', 'menu_option_groups', 'menu_options']
  loop
    execute format('create trigger %1$s_touch before update on public.%1$I
      for each row execute function app_private.touch_updated_at()', t);
  end loop;
  foreach t in array array['menu_sections', 'menu_items', 'menu_option_groups', 'menu_options', 'menu_combo_components']
  loop
    execute format('create trigger %1$s_version after insert or update or delete on public.%1$I
      for each row execute function app_private.menu_bump_version()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
      for each row execute function app_private.audit_row()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
  end loop;
end;
$$;

-- Menus are readable for public vendors, by the vendor's members and by operators. Writes go through the
-- server (Phase 3 editor with the merchant's tap, §18.2).
create function app_private.menu_vendor_visible(p_vendor_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vendors v
    where v.id = p_vendor_id
      and ((v.public_page and v.listing_status = 'active')
           or app_private.is_operator()
           or app_private.is_vendor_member(v.id))
  );
$$;
revoke all on function app_private.menu_vendor_visible(uuid) from public;
grant execute on function app_private.menu_vendor_visible(uuid) to anon, authenticated, service_role;

create policy menu_sections_read on public.menu_sections for select to anon, authenticated
  using (app_private.menu_vendor_visible(vendor_id));
create policy menu_items_read on public.menu_items for select to anon, authenticated
  using (app_private.menu_vendor_visible(vendor_id));
create policy menu_option_groups_read on public.menu_option_groups for select to anon, authenticated
  using (exists (select 1 from public.menu_items i where i.id = item_id and app_private.menu_vendor_visible(i.vendor_id)));
create policy menu_options_read on public.menu_options for select to anon, authenticated
  using (exists (
    select 1 from public.menu_option_groups g join public.menu_items i on i.id = g.item_id
    where g.id = group_id and app_private.menu_vendor_visible(i.vendor_id)
  ));
create policy menu_combo_components_read on public.menu_combo_components for select to anon, authenticated
  using (exists (select 1 from public.menu_items i where i.id = combo_item_id and app_private.menu_vendor_visible(i.vendor_id)));

-- 5. Order fee --------------------------------------------------------------------------------------------
-- Alo King's fee to the merchant for one delivered order (§20.4, §29.1). Zero during the vendor's free days.
create function public.order_fee_usd(p_vendor_id uuid, p_food_subtotal_usd numeric, p_at timestamptz default now())
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.business_type;
  v_live timestamptz;
  v_rule public.order_fee_rules%rowtype;
  v_free_days numeric;
  v_fee numeric;
begin
  select v.business_type, v.live_since into v_type, v_live from public.vendors v where v.id = p_vendor_id;
  if v_type is null then
    raise exception 'unknown vendor %', p_vendor_id using errcode = 'no_data_found';
  end if;
  select (p.rules ->> 'free_days')::numeric into v_free_days from public.price_list p
  where p.product = 'order_fee' and p.effective_from <= p_at order by p.effective_from desc limit 1;
  if v_live is not null and v_free_days is not null and p_at < v_live + make_interval(days => v_free_days::int) then
    return 0;
  end if;
  select * into v_rule from public.order_fee_rules r
  where r.business_type = v_type and r.effective_from <= p_at order by r.effective_from desc limit 1;
  if v_rule.id is null then
    raise exception 'no order fee rule for % in force at %', v_type, p_at using errcode = 'no_data_found';
  end if;
  v_fee := v_rule.flat_usd + round(p_food_subtotal_usd * v_rule.percent, 4);
  if v_rule.min_usd is not null then v_fee := greatest(v_fee, v_rule.min_usd); end if;
  if v_rule.max_usd is not null then v_fee := least(v_fee, v_rule.max_usd); end if;
  return round(v_fee, 2);
end;
$$;
revoke all on function public.order_fee_usd(uuid, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.order_fee_usd(uuid, numeric, timestamptz) to service_role;

-- 6. Baskets --------------------------------------------------------------------------------------------
-- One open basket per customer (one vendor per order). Lines carry item IDs and quantities; prices are
-- written only by basket_price() from the menu, with the menu version they were priced at (§30.1.1).
create table public.baskets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  status public.basket_status not null default 'open',
  fulfilment public.fulfilment_kind not null default 'delivery',
  address_id uuid references public.addresses (id) on delete set null,
  payment_method public.payment_method not null default 'cod',
  stairs_floors smallint check (stairs_floors between 1 and 30),
  customer_note text check (char_length(customer_note) <= 300),
  priced_menu_version bigint,
  priced_at timestamptz,
  subtotal_usd numeric(10, 2),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index baskets_one_open on public.baskets (customer_id) where status = 'open';
create index baskets_vendor_idx on public.baskets (vendor_id);
create trigger baskets_touch before update on public.baskets
  for each row execute function app_private.touch_updated_at();

create table public.basket_items (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets (id) on delete cascade,
  item_id uuid not null references public.menu_items (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 50),
  option_ids uuid[] not null default '{}',
  -- Container exchange (§29.2): true = customer returns an empty; false = deposit added; null = not asked.
  has_empty boolean,
  note text check (char_length(note) <= 200),
  unit_price_usd numeric(10, 2),
  line_total_usd numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index basket_items_basket_idx on public.basket_items (basket_id);
create trigger basket_items_touch before update on public.basket_items
  for each row execute function app_private.touch_updated_at();

alter table public.baskets enable row level security;
alter table public.basket_items enable row level security;
revoke all on table public.baskets, public.basket_items from public, anon, authenticated;
grant all on table public.baskets, public.basket_items to service_role;
grant select on table public.baskets, public.basket_items to authenticated;
create policy baskets_owner_read on public.baskets for select to authenticated
  using ((select app_private.is_operator())
         or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));
create policy basket_items_owner_read on public.basket_items for select to authenticated
  using (exists (
    select 1 from public.baskets b join public.customers c on c.id = b.customer_id
    where b.id = basket_id and (c.user_id = (select auth.uid()) or (select app_private.is_operator()))
  ));

-- 7. Orders ---------------------------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Short code read aloud and printed: 6 characters from an unambiguous alphabet.
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  basket_id uuid unique references public.baskets (id) on delete set null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  vendor_id uuid not null references public.vendors (id) on delete restrict,
  status public.order_status not null,
  fulfilment public.fulfilment_kind not null,
  delivery_mode public.delivery_mode,
  payment_method public.payment_method not null,
  -- Delivery point (personal data, §28.3): never in public tracking links (§3).
  address_id uuid references public.addresses (id) on delete set null,
  delivery_place_id text references public.places (id),
  delivery_pin extensions.geography(point, 4326),
  road_km numeric(6, 2) check (road_km >= 0),
  menu_version bigint not null,
  -- Money: USD amounts with the rate locked at placement; LBP derived from that rate only (§13).
  usd_lbp_rate numeric(14, 4) not null check (usd_lbp_rate > 0),
  food_subtotal_usd numeric(10, 2) not null check (food_subtotal_usd >= 0),
  delivery_fee_usd numeric(10, 2) not null default 0 check (delivery_fee_usd >= 0),
  container_deposit_usd numeric(10, 2) not null default 0 check (container_deposit_usd >= 0),
  stairs_floors smallint check (stairs_floors between 1 and 30),
  stairs_fee_usd numeric(10, 2) not null default 0 check (stairs_fee_usd >= 0),
  discount_usd numeric(10, 2) not null default 0 check (discount_usd >= 0),
  total_usd numeric(10, 2) not null check (total_usd >= 0),
  total_lbp numeric(20, 0) generated always as (round(total_usd * usd_lbp_rate, 0)) stored,
  -- Alo King's fee to the merchant, snapshotted at placement; posted to the ledger on delivery (Phase 6).
  order_fee_usd numeric(10, 2) not null check (order_fee_usd >= 0),
  -- Variable-weight orders (§29.2): totals are estimates until every weighed line has its weight.
  weight_status public.weight_status not null default 'none',
  estimated_total_usd numeric(10, 2),
  is_new_customer boolean not null default false,
  customer_note text check (char_length(customer_note) <= 300),
  prep_minutes smallint check (prep_minutes between 1 and 240),
  ready_at timestamptz,
  driver_member_id uuid references public.vendor_members (id) on delete set null,
  reject_reason public.reject_reason,
  reject_note text check (char_length(reject_note) <= 300),
  cancel_reason public.cancel_reason,
  cancel_request_status public.cancel_request_status,
  cancel_requested_at timestamptz,
  placed_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_via text,
  accepted_at timestamptz,
  ready_marked_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_delivery_has_place check (fulfilment <> 'delivery' or delivery_place_id is not null),
  constraint orders_pickup_no_mode check (fulfilment <> 'pickup' or delivery_mode is null),
  constraint orders_delivery_has_mode check (fulfilment <> 'delivery' or delivery_mode is not null),
  -- One direction only: the reason is written in the same transaction just before the status change.
  constraint orders_rejected_has_reason check (status <> 'rejected' or reject_reason is not null),
  constraint orders_cancelled_has_reason check (status <> 'cancelled' or cancel_reason is not null),
  constraint orders_total_adds_up check (
    weight_status in ('awaiting_weight', 'awaiting_customer')
    or total_usd = food_subtotal_usd + delivery_fee_usd + container_deposit_usd + stairs_fee_usd - discount_usd
  )
);
create index orders_vendor_active_idx on public.orders (vendor_id, placed_at)
  where status not in ('delivered', 'failed', 'rejected', 'cancelled');
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_idx on public.orders (status, placed_at);
create index orders_driver_idx on public.orders (driver_member_id) where driver_member_id is not null;
create trigger orders_touch before update on public.orders
  for each row execute function app_private.touch_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid references public.menu_items (id) on delete set null,
  name_ar text,
  name_en text,
  name_fr text,
  quantity integer not null check (quantity between 1 and 50),
  pricing_unit public.pricing_unit not null,
  unit_price_usd numeric(10, 2) not null check (unit_price_usd >= 0),
  -- Snapshot of chosen options: [{"id", "name_ar", "name_en", "price_delta_usd"}].
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  options_total_usd numeric(10, 2) not null default 0 check (options_total_usd >= 0),
  est_weight_kg numeric(8, 3),
  price_per_kg_usd numeric(10, 2) check (price_per_kg_usd >= 0),
  actual_weight_kg numeric(8, 3) check (actual_weight_kg > 0),
  line_total_usd numeric(10, 2) not null check (line_total_usd >= 0),
  container_deposit_usd numeric(10, 2) not null default 0 check (container_deposit_usd >= 0),
  has_empty boolean,
  empty_collected boolean,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  constraint order_items_kg_weight check ((pricing_unit = 'kg') = (est_weight_kg is not null and price_per_kg_usd is not null))
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  from_status public.order_status,
  to_status public.order_status,
  event text not null check (event ~ '^[a-z][a-z0-9_]*$'),
  actor_kind public.actor_kind not null,
  actor_id uuid,
  channel text,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object')
);
create index order_events_order_idx on public.order_events (order_id, id);
create trigger order_events_append_only before update on public.order_events
  for each row execute function app_private.forbid_change();
create trigger order_events_no_truncate before truncate on public.order_events
  for each statement execute function app_private.forbid_change();

-- The ledger's order reference gets its foreign key now that orders exist (LOG, Phase 1a).
alter table public.ledger_transactions
  add constraint ledger_transactions_order_fk foreign key (order_id) references public.orders (id) on delete restrict;

-- 8. The state machine ----------------------------------------------------------------------------------
-- Forward chain for an accepted order (§27.5). Skipping forward is allowed (a merchant without the driver
-- app taps "out for delivery" straight from "preparing"); going back is allowed only from the driver
-- states to the kitchen states (unassign or reassign a driver before pickup).
create function app_private.order_rank(p public.order_status) returns integer
language sql
immutable
set search_path = ''
as $$
  select case p
    when 'accepted' then 1 when 'preparing' then 2 when 'ready' then 3 when 'driver_assigned' then 4
    when 'heading_to_pickup' then 5 when 'at_pickup' then 6 when 'picked_up' then 7 when 'near_drop' then 8
    when 'arrived' then 9 when 'delivered' then 10 else null end;
$$;

create function app_private.order_transition_ok(
  p_from public.order_status,
  p_to public.order_status,
  p_fulfilment public.fulfilment_kind
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then false
    when p_from in ('delivered', 'failed', 'rejected', 'cancelled') then false
    when p_from = 'awaiting_payment' then p_to in ('placed', 'cancelled')
    when p_from = 'placed' then p_to in ('accepted', 'rejected', 'cancelled')
    when p_to = 'cancelled' then p_from in ('accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup')
    when p_to = 'failed' then p_fulfilment = 'delivery' and p_from in ('picked_up', 'near_drop', 'arrived')
    when p_to in ('awaiting_payment', 'placed', 'rejected') then false
    when p_fulfilment = 'pickup' then
      -- Pickup: kitchen states, then the customer collects (delivered).
      (app_private.order_rank(p_to) between 1 and 3 and app_private.order_rank(p_to) > app_private.order_rank(p_from))
      or (p_to = 'delivered' and p_from in ('accepted', 'preparing', 'ready'))
    when p_to = 'delivered' then app_private.order_rank(p_from) >= 7
    when app_private.order_rank(p_to) > app_private.order_rank(p_from) then true
    else p_from in ('driver_assigned', 'heading_to_pickup', 'at_pickup') and p_to in ('accepted', 'preparing', 'ready')
  end;
$$;

-- Any writer, including the service role and operators, goes through this check.
create function app_private.orders_status_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('placed', 'awaiting_payment') then
      raise exception 'an order starts as placed or awaiting_payment, not %', new.status using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     and not app_private.order_transition_ok(old.status, new.status, old.fulfilment) then
    raise exception 'order % cannot go from % to %', old.code, old.status, new.status using errcode = 'check_violation';
  end if;
  if new.vendor_id <> old.vendor_id or new.customer_id <> old.customer_id or new.usd_lbp_rate <> old.usd_lbp_rate
     or new.code <> old.code or new.fulfilment <> old.fulfilment then
    raise exception 'order vendor, customer, code, fulfilment and locked rate never change' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger orders_status_guard before insert or update on public.orders
  for each row execute function app_private.orders_status_guard();

-- The one way a status changes. Returns the order row after the change, or raises:
--   'stale_status' when the order is no longer in p_expected (a concurrent change won the race).
-- p_expected null = any status from which the transition is allowed.
create function app_private.order_set_status(
  p_order_id uuid,
  p_to public.order_status,
  p_expected public.order_status[] default null,
  p_event text default null,
  p_channel text default null,
  p_detail jsonb default '{}',
  p_actor_id uuid default null
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.orders%rowtype;
  v_after public.orders%rowtype;
begin
  select * into v_before from public.orders where id = p_order_id for update;
  if v_before.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  if p_expected is not null and not (v_before.status = any (p_expected)) then
    raise exception 'stale_status: order % is %, expected %', v_before.code, v_before.status, p_expected
      using errcode = 'serialization_failure';
  end if;
  if not app_private.order_transition_ok(v_before.status, p_to, v_before.fulfilment) then
    raise exception 'order % cannot go from % to %', v_before.code, v_before.status, p_to using errcode = 'check_violation';
  end if;

  update public.orders o set
    status = p_to,
    accepted_at = case when p_to = 'accepted' then coalesce(o.accepted_at, now()) else o.accepted_at end,
    ready_marked_at = case when p_to = 'ready' then now() else o.ready_marked_at end,
    picked_up_at = case when p_to = 'picked_up' then now() else o.picked_up_at end,
    delivered_at = case when p_to = 'delivered' then now() else o.delivered_at end,
    placed_at = case when p_to = 'placed' then now() else o.placed_at end,
    closed_at = case when p_to in ('delivered', 'failed', 'rejected', 'cancelled') then now() else o.closed_at end
  where o.id = p_order_id
  returning * into v_after;

  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, channel, detail)
  values (p_order_id, v_before.status, p_to, coalesce(p_event, p_to::text), app_private.current_actor_kind(),
          coalesce(p_actor_id, (select auth.uid())), p_channel, coalesce(p_detail, '{}'));
  return v_after;
end;
$$;
revoke all on function app_private.order_set_status(uuid, public.order_status, public.order_status[], text, text, jsonb, uuid) from public;

-- Is the caller the server (service role, or a direct database session such as a migration or test)?
-- Inside a security-definer function current_user is the owner, so the role PostgREST set is read from
-- the `role` setting and the JWT claims instead.
create function app_private.caller_is_server() returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) is null and (
    current_setting('role', true) = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or (coalesce(nullif(current_setting('role', true), ''), 'none') = 'none' and session_user in ('postgres', 'supabase_admin'))
  );
$$;
revoke all on function app_private.caller_is_server() from public;
grant execute on function app_private.caller_is_server() to authenticated, service_role;

-- Who is acting on a vendor's order. A signed-in member must hold one of p_roles at that vendor. The
-- service role (WhatsApp, call and portal handlers) passes the acting member's id, which must also hold
-- one of p_roles; operators may act on any vendor. Returns the acting member id (null for operators).
create function app_private.order_actor(p_vendor_id uuid, p_roles public.member_role[], p_member_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  if (select auth.uid()) is not null then
    if app_private.is_operator() then
      return null;
    end if;
    select m.id into v_member from public.vendor_members m
    where m.vendor_id = p_vendor_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any (p_roles);
  elsif app_private.caller_is_server() and p_member_id is not null then
    select m.id into v_member from public.vendor_members m
    where m.id = p_member_id and m.vendor_id = p_vendor_id and m.status = 'active' and m.role = any (p_roles);
  elsif app_private.caller_is_server() then
    -- Server-side automation (timers, router) acting as the system.
    return null;
  end if;
  if v_member is null then
    raise exception 'not allowed to act on this vendor''s orders' using errcode = 'insufficient_privilege';
  end if;
  return v_member;
end;
$$;
revoke all on function app_private.order_actor(uuid, public.member_role[], uuid) from public;

-- 9. Basket pricing and order placement -----------------------------------------------------------------
-- Prices every line from the menu and stores the menu version. Returns the summary the bot shows:
-- {"menu_version", "subtotal_usd", "lines": [...], "unavailable": [item ids], "changed": [line diffs]}.
create function public.basket_price(p_basket_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_version bigint;
  v_line record;
  v_unit numeric;
  v_opts numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_lines jsonb := '[]';
  v_unavailable jsonb := '[]';
  v_changed jsonb := '[]';
  v_bad_opts integer;
begin
  select * into v_basket from public.baskets where id = p_basket_id for update;
  if v_basket.id is null then
    raise exception 'unknown basket %', p_basket_id using errcode = 'no_data_found';
  end if;
  select v.menu_version into v_version from public.vendors v where v.id = v_basket.vendor_id;

  for v_line in
    select bi.*, i.vendor_id as item_vendor, i.price_usd, i.pricing_unit, i.est_weight_kg, i.container_deposit_usd,
           i.name_ar, i.name_en
    from public.basket_items bi join public.menu_items i on i.id = bi.item_id
    where bi.basket_id = p_basket_id order by bi.created_at, bi.id
  loop
    -- Options must belong to this item and be available; group min/max are checked too.
    select count(*) into v_bad_opts from unnest(v_line.option_ids) oid
    where not exists (
      select 1 from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
      where o.id = oid and g.item_id = v_line.item_id and o.available
    );
    if v_bad_opts = 0 then
      select count(*) into v_bad_opts from public.menu_option_groups g
      where g.item_id = v_line.item_id
        and (select count(*) from public.menu_options o where o.group_id = g.id and o.id = any (v_line.option_ids))
            not between g.min_select and g.max_select;
    end if;
    if v_line.item_vendor <> v_basket.vendor_id or v_bad_opts > 0
       or not app_private.menu_item_orderable(v_line.item_id, v_line.quantity) then
      v_unavailable := v_unavailable || to_jsonb(v_line.item_id);
      update public.basket_items set unit_price_usd = null, line_total_usd = null where id = v_line.id;
      continue;
    end if;
    select coalesce(sum(o.price_delta_usd), 0) into v_opts from public.menu_options o where o.id = any (v_line.option_ids);
    v_unit := case when v_line.pricing_unit = 'kg' then round(v_line.price_usd * v_line.est_weight_kg, 2) else v_line.price_usd end;
    v_line_total := (v_unit + v_opts) * v_line.quantity;
    if v_line.line_total_usd is not null and v_line.line_total_usd <> v_line_total then
      v_changed := v_changed || jsonb_build_object('item_id', v_line.item_id, 'name_ar', v_line.name_ar, 'name_en', v_line.name_en,
        'was_usd', v_line.line_total_usd, 'now_usd', v_line_total);
    end if;
    update public.basket_items set unit_price_usd = v_unit + v_opts, line_total_usd = v_line_total where id = v_line.id;
    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || jsonb_build_object('line_id', v_line.id, 'item_id', v_line.item_id, 'quantity', v_line.quantity,
      'unit_price_usd', v_unit + v_opts, 'line_total_usd', v_line_total, 'estimated', v_line.pricing_unit = 'kg',
      'container_deposit_usd', case when v_line.container_deposit_usd is not null and v_line.has_empty is false
                                    then v_line.container_deposit_usd * v_line.quantity else 0 end);
  end loop;

  update public.baskets set priced_menu_version = v_version, priced_at = now(), subtotal_usd = v_subtotal,
    last_activity_at = now()
  where id = p_basket_id;
  return jsonb_build_object('menu_version', v_version, 'subtotal_usd', v_subtotal, 'lines', v_lines,
    'unavailable', v_unavailable, 'changed', v_changed);
end;
$$;
revoke all on function public.basket_price(uuid) from public, anon, authenticated;
grant execute on function public.basket_price(uuid) to service_role;

create function app_private.new_order_code() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bytes bytea;
begin
  loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.orders o where o.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Places the order from the customer's explicit confirmation of the summary priced at
-- p_expected_menu_version. Returns {"status": ...}:
--   placed       {"order_id", "code", "total_usd", "total_lbp", "usd_lbp_rate", "estimated"}
--   repriced     the menu changed since the summary: the basket is re-priced and nothing is created;
--                the bot shows the difference with Confirm / Change (§30.1.1)
--   unavailable  an item or option can no longer be ordered (basket re-priced, no order)
--   vendor_closed / vendor_paused / fulfilment_unavailable / no_address / place_paused / no_route /
--   beyond_radius / cod_cap / online_payment_off / empty_basket
-- A repeated p_idempotency_key returns the first result.
create function public.order_place(
  p_basket_id uuid,
  p_expected_menu_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_subtotal numeric;
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
    -- A duplicate confirmation that waited on the basket lock returns the order the first one created.
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
        'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
        'estimated', v_existing.weight_status <> 'none', 'repeat', true);
    end if;
    raise exception 'basket % is %', p_basket_id, v_basket.status using errcode = 'check_violation';
  end if;
  -- Placements for one vendor run one at a time: a pause or menu change cannot slip in between the checks
  -- and the insert, and selling the last unit (which bumps the menu version on this row) cannot deadlock
  -- against another placement holding a share lock. Orders per vendor are few; the wait is milliseconds.
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

  -- Menu version check (§30.1.1): a stale summary is never charged.
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
  v_subtotal := (v_priced ->> 'subtotal_usd')::numeric;
  select coalesce(sum((l ->> 'container_deposit_usd')::numeric), 0), bool_or((l ->> 'estimated')::boolean)
    into v_deposit, v_weighted from jsonb_array_elements(v_priced -> 'lines') l;

  -- Delivery: an address with a place that takes orders, a cached road route, and the vendor's radius.
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id and customer_id = v_basket.customer_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address');
    end if;
    select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
    if v_place_status = 'paused' then
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
    v_delivery_fee := v_quote.fee_usd;
    if v_basket.stairs_floors is not null and v_vendor.stairs_fee_per_floor_usd is not null then
      v_stairs := v_basket.stairs_floors * v_vendor.stairs_fee_per_floor_usd;
    end if;
  end if;

  v_total := v_subtotal + v_delivery_fee + v_deposit + v_stairs;

  -- COD caps: the per-order cap, and $50 until the number has one delivered order (§29.4).
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

  -- Daily quantities are decremented atomically; a race for the last units leaves the loser unavailable.
  for v_line in
    select bi.item_id, bi.quantity from public.basket_items bi where bi.basket_id = p_basket_id
    union all
    select c.component_item_id, c.quantity * bi.quantity from public.basket_items bi
    join public.menu_combo_components c on c.combo_item_id = bi.item_id where bi.basket_id = p_basket_id
  loop
    update public.menu_items i
    set daily_remaining = i.daily_remaining - v_line.quantity
    where i.id = v_line.item_id and i.daily_remaining is not null and i.daily_date = current_date
      and i.daily_remaining >= v_line.quantity
    returning i.daily_remaining into v_remaining;
    if not found then
      if exists (select 1 from public.menu_items i where i.id = v_line.item_id and i.daily_remaining is not null
                 and i.daily_date = current_date) then
        -- Lost the race for the last units: the whole placement rolls back.
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
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_total,
    public.order_fee_usd(v_vendor.id, v_subtotal), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
    case when v_weighted then v_total end, v_new_customer, v_basket.customer_note, v_vendor.default_prep_minutes,
    case when v_basket.payment_method = 'cod' then now() end
  ) returning * into v_order;

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
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low);
end;
$$;
revoke all on function public.order_place(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.order_place(uuid, bigint, text) to service_role;

-- 10. Merchant actions ----------------------------------------------------------------------------------
-- Accept with a prep time. A duplicate or concurrent accept returns the order unchanged (idempotent tap);
-- an accept that lost to a cancel or reject raises stale_status.
create function app_private.order_accept(
  p_order_id uuid,
  p_prep_minutes integer default null,
  p_member_id uuid default null,
  p_channel text default 'portal'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
  v_prep integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  if v_order.status <> 'placed' and v_order.accepted_at is not null and v_order.status not in ('cancelled', 'rejected') then
    return jsonb_build_object('status', 'already_accepted', 'order_status', v_order.status);
  end if;
  v_prep := coalesce(p_prep_minutes, (select v.default_prep_minutes from public.vendors v where v.id = v_order.vendor_id));
  if v_prep not between 1 and 240 then
    raise exception 'prep time must be 1-240 minutes' using errcode = 'check_violation';
  end if;
  v_order := app_private.order_set_status(p_order_id, 'accepted', array['placed']::public.order_status[], 'accepted',
    p_channel, jsonb_build_object('prep_minutes', v_prep, 'member_id', v_member));
  update public.orders set prep_minutes = v_prep, ready_at = now() + make_interval(mins => v_prep),
    acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_via = coalesce(acknowledged_via, p_channel)
  where id = p_order_id;
  return jsonb_build_object('status', 'accepted', 'ready_at', now() + make_interval(mins => v_prep));
end;
$$;

create function app_private.order_reject(
  p_order_id uuid,
  p_reason public.reject_reason,
  p_note text default null,
  p_member_id uuid default null,
  p_channel text default 'portal'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  if v_order.status = 'rejected' then
    return jsonb_build_object('status', 'already_rejected');
  end if;
  if p_reason = 'other' and char_length(coalesce(trim(p_note), '')) < 3 then
    raise exception 'a rejection with reason "other" needs a note' using errcode = 'check_violation';
  end if;
  update public.orders set reject_reason = p_reason, reject_note = p_note where id = p_order_id and status = 'placed';
  perform app_private.order_set_status(p_order_id, 'rejected', array['placed']::public.order_status[], 'rejected',
    p_channel, jsonb_build_object('reason', p_reason, 'member_id', v_member));
  return jsonb_build_object('status', 'rejected');
end;
$$;

-- Kitchen and delivery progress from the merchant side (portal, WhatsApp buttons, merchant driver).
create function app_private.order_progress(
  p_order_id uuid,
  p_to public.order_status,
  p_member_id uuid default null,
  p_channel text default 'portal'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
  v_roles public.member_role[];
begin
  if p_to not in ('preparing', 'ready', 'heading_to_pickup', 'at_pickup', 'picked_up', 'near_drop', 'arrived', 'delivered', 'failed') then
    raise exception 'use the dedicated function for %', p_to using errcode = 'check_violation';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status = p_to then
    return jsonb_build_object('status', 'unchanged', 'order_status', v_order.status);
  end if;
  v_roles := case when p_to in ('preparing', 'ready') then array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[]
                  else array['owner', 'manager', 'cashier', 'driver']::public.member_role[] end;
  v_member := app_private.order_actor(v_order.vendor_id, v_roles, p_member_id);
  -- A merchant driver moves only orders assigned to them.
  if v_member is not null and exists (select 1 from public.vendor_members m where m.id = v_member and m.role = 'driver')
     and v_order.driver_member_id is distinct from v_member then
    raise exception 'this order is not assigned to you' using errcode = 'insufficient_privilege';
  end if;
  if v_order.weight_status in ('awaiting_weight', 'awaiting_customer') and p_to in ('picked_up', 'delivered') then
    raise exception 'enter the final weights first' using errcode = 'check_violation';
  end if;
  perform app_private.order_set_status(p_order_id, p_to, null, p_to::text, p_channel, jsonb_build_object('member_id', v_member));
  return jsonb_build_object('status', p_to);
end;
$$;

-- Merchant assignment of one of its own drivers (§27.4 merchant mode, §27.9).
create function app_private.order_assign_driver(
  p_order_id uuid,
  p_driver_member_id uuid,
  p_member_id uuid default null,
  p_channel text default 'portal'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier']::public.member_role[], p_member_id);
  if v_order.fulfilment <> 'delivery' or v_order.delivery_mode <> 'merchant' then
    raise exception 'only merchant-delivered orders take a merchant driver' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.vendor_members m
    where m.id = p_driver_member_id and m.vendor_id = v_order.vendor_id and m.role = 'driver' and m.status = 'active'
  ) then
    raise exception 'not an active driver of this merchant' using errcode = 'check_violation';
  end if;
  if v_order.driver_member_id = p_driver_member_id then
    return jsonb_build_object('status', 'unchanged');
  end if;
  update public.orders set driver_member_id = p_driver_member_id where id = p_order_id;
  if v_order.status in ('accepted', 'preparing', 'ready') then
    perform app_private.order_set_status(p_order_id, 'driver_assigned', array['accepted', 'preparing', 'ready']::public.order_status[],
      'driver_assigned', p_channel, jsonb_build_object('driver_member_id', p_driver_member_id, 'member_id', v_member));
  elsif v_order.status in ('driver_assigned', 'heading_to_pickup', 'at_pickup') then
    insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, channel, detail)
    values (p_order_id, v_order.status, v_order.status, 'driver_reassigned', app_private.current_actor_kind(), (select auth.uid()),
            p_channel, jsonb_build_object('driver_member_id', p_driver_member_id, 'member_id', v_member));
  else
    raise exception 'a driver can be assigned only before pickup' using errcode = 'check_violation';
  end if;
  return jsonb_build_object('status', 'assigned');
end;
$$;

-- Final weight for a weighed line (§29.2). When every weighed line has a weight the server recomputes
-- the total; an increase above the configured share over the estimate waits for the customer's tap.
create function app_private.order_set_weight(
  p_order_item_id uuid,
  p_actual_kg numeric,
  p_member_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_food numeric;
  v_total numeric;
  v_share numeric := public.config_numeric('weighted_increase_confirm_share');
  v_status public.weight_status;
begin
  select * into v_item from public.order_items where id = p_order_item_id;
  if v_item.id is null or v_item.pricing_unit <> 'kg' then
    raise exception 'not a weighed order line' using errcode = 'check_violation';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  perform app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  if v_order.status not in ('accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup')
     or v_order.weight_status not in ('awaiting_weight', 'awaiting_customer') then
    raise exception 'weights are entered after acceptance and before pickup' using errcode = 'check_violation';
  end if;
  if p_actual_kg <= 0 or p_actual_kg > v_item.est_weight_kg * 5 then
    raise exception 'weight % kg is not plausible for this line', p_actual_kg using errcode = 'check_violation';
  end if;
  update public.order_items
  set actual_weight_kg = p_actual_kg,
      line_total_usd = round(price_per_kg_usd * p_actual_kg, 2) + options_total_usd * quantity
  where id = p_order_item_id;

  if exists (select 1 from public.order_items i where i.order_id = v_order.id and i.pricing_unit = 'kg' and i.actual_weight_kg is null) then
    return jsonb_build_object('status', 'awaiting_weight');
  end if;
  select sum(i.line_total_usd) into v_food from public.order_items i where i.order_id = v_order.id;
  v_total := v_food + v_order.delivery_fee_usd + v_order.container_deposit_usd + v_order.stairs_fee_usd - v_order.discount_usd;
  v_status := case when v_total > v_order.estimated_total_usd * (1 + v_share) then 'awaiting_customer' else 'final' end;
  update public.orders set food_subtotal_usd = v_food, total_usd = v_total, weight_status = v_status,
    order_fee_usd = public.order_fee_usd(vendor_id, v_food, placed_at)
  where id = v_order.id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, detail)
  values (v_order.id, v_order.status, v_order.status, 'weights_entered', app_private.current_actor_kind(), (select auth.uid()),
          jsonb_build_object('estimated_total_usd', v_order.estimated_total_usd, 'final_total_usd', v_total, 'weight_status', v_status));
  return jsonb_build_object('status', v_status, 'estimated_total_usd', v_order.estimated_total_usd, 'final_total_usd', v_total);
end;
$$;

-- The customer's tap on a weight increase above the threshold: accept keeps the order, decline cancels it.
create function public.order_weight_respond(p_order_id uuid, p_customer_id uuid, p_accept boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if v_order.id is null then
    raise exception 'unknown order' using errcode = 'no_data_found';
  end if;
  if v_order.weight_status <> 'awaiting_customer' then
    return jsonb_build_object('status', 'unchanged', 'weight_status', v_order.weight_status);
  end if;
  if p_accept then
    update public.orders set weight_status = 'final' where id = p_order_id;
    insert into public.order_events (order_id, from_status, to_status, event, actor_kind, detail)
    values (p_order_id, v_order.status, v_order.status, 'weight_increase_accepted', 'whatsapp', '{}');
    return jsonb_build_object('status', 'final');
  end if;
  update public.orders set weight_status = 'final', cancel_reason = 'weight_declined' where id = p_order_id;
  perform app_private.order_set_status(p_order_id, 'cancelled', null, 'weight_increase_declined', 'whatsapp');
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- The driver confirms the empty container was collected (§29.2).
create function app_private.order_confirm_empty(p_order_item_id uuid, p_collected boolean, p_member_id uuid default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select o.* into v_order from public.orders o join public.order_items i on i.order_id = o.id where i.id = p_order_item_id;
  perform app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'driver']::public.member_role[], p_member_id);
  update public.order_items set empty_collected = p_collected where id = p_order_item_id and has_empty is true;
  if not found then
    raise exception 'this line has no empty to collect' using errcode = 'check_violation';
  end if;
end;
$$;

-- 11. Customer cancellation (§30.3.6) -------------------------------------------------------------------
-- Free until the merchant accepts and for the configured seconds after; later a request the merchant
-- answers. After pickup a cancel is not possible from the customer side.
create function public.order_cancel_by_customer(p_order_id uuid, p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_window numeric := public.config_numeric('customer_free_cancel_after_accept_s');
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if v_order.id is null then
    raise exception 'unknown order' using errcode = 'no_data_found';
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled');
  end if;
  if v_order.status in ('awaiting_payment', 'placed')
     or (v_order.status = 'accepted' and v_order.accepted_at + make_interval(secs => v_window) > now()) then
    update public.orders set cancel_reason = 'customer' where id = p_order_id;
    perform app_private.order_set_status(p_order_id, 'cancelled', array[v_order.status], 'cancelled_by_customer', 'whatsapp');
    return jsonb_build_object('status', 'cancelled');
  end if;
  if v_order.status in ('accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup') then
    if v_order.cancel_request_status = 'pending' then
      return jsonb_build_object('status', 'request_pending');
    end if;
    update public.orders set cancel_request_status = 'pending', cancel_requested_at = now() where id = p_order_id;
    insert into public.order_events (order_id, from_status, to_status, event, actor_kind, detail)
    values (p_order_id, v_order.status, v_order.status, 'cancel_requested', 'whatsapp', '{}');
    return jsonb_build_object('status', 'request_sent');
  end if;
  return jsonb_build_object('status', 'too_late', 'order_status', v_order.status);
end;
$$;

create function app_private.order_cancel_request_respond(
  p_order_id uuid,
  p_accept boolean,
  p_member_id uuid default null,
  p_channel text default 'portal'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier']::public.member_role[], p_member_id);
  if v_order.cancel_request_status is distinct from 'pending' then
    return jsonb_build_object('status', 'no_pending_request');
  end if;
  if p_accept then
    update public.orders set cancel_request_status = 'accepted', cancel_reason = 'customer_request_accepted' where id = p_order_id;
    perform app_private.order_set_status(p_order_id, 'cancelled', null, 'cancel_request_accepted', p_channel,
      jsonb_build_object('member_id', v_member));
    return jsonb_build_object('status', 'cancelled');
  end if;
  update public.orders set cancel_request_status = 'refused' where id = p_order_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, channel, detail)
  values (p_order_id, v_order.status, v_order.status, 'cancel_request_refused', app_private.current_actor_kind(), (select auth.uid()),
          p_channel, jsonb_build_object('member_id', v_member));
  return jsonb_build_object('status', 'continues');
end;
$$;

-- System and operator cancellation (merchant unreachable, paused, operator decision).
create function app_private.order_cancel_by_system(p_order_id uuid, p_reason public.cancel_reason, p_detail jsonb default '{}') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not (app_private.is_operator() or app_private.caller_is_server()) then
    raise exception 'operators and the server only' using errcode = 'insufficient_privilege';
  end if;
  if p_reason in ('customer', 'customer_request_accepted', 'weight_declined') then
    raise exception 'reason % belongs to the customer flow', p_reason using errcode = 'check_violation';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled');
  end if;
  update public.orders set cancel_reason = p_reason where id = p_order_id;
  perform app_private.order_set_status(p_order_id, 'cancelled', null, 'cancelled_' || p_reason::text, 'system', p_detail);
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- Client-callable RPCs follow the repo pattern: a security-invoker wrapper in public over a definer
-- function in app_private that checks the caller itself (member role, operator or service role).
create function public.order_accept(p_order_id uuid, p_prep_minutes integer default null, p_member_id uuid default null, p_channel text default 'portal') returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_accept(p_order_id, p_prep_minutes, p_member_id, p_channel) $$;
create function public.order_reject(p_order_id uuid, p_reason public.reject_reason, p_note text default null, p_member_id uuid default null, p_channel text default 'portal') returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_reject(p_order_id, p_reason, p_note, p_member_id, p_channel) $$;
create function public.order_progress(p_order_id uuid, p_to public.order_status, p_member_id uuid default null, p_channel text default 'portal') returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_progress(p_order_id, p_to, p_member_id, p_channel) $$;
create function public.order_assign_driver(p_order_id uuid, p_driver_member_id uuid, p_member_id uuid default null, p_channel text default 'portal') returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_assign_driver(p_order_id, p_driver_member_id, p_member_id, p_channel) $$;
create function public.order_set_weight(p_order_item_id uuid, p_actual_kg numeric, p_member_id uuid default null) returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_set_weight(p_order_item_id, p_actual_kg, p_member_id) $$;
create function public.order_confirm_empty(p_order_item_id uuid, p_collected boolean, p_member_id uuid default null) returns void
language sql
security invoker
set search_path = ''
as $$ select app_private.order_confirm_empty(p_order_item_id, p_collected, p_member_id) $$;
create function public.order_cancel_request_respond(p_order_id uuid, p_accept boolean, p_member_id uuid default null, p_channel text default 'portal') returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_cancel_request_respond(p_order_id, p_accept, p_member_id, p_channel) $$;
create function public.order_cancel_by_system(p_order_id uuid, p_reason public.cancel_reason, p_detail jsonb default '{}') returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.order_cancel_by_system(p_order_id, p_reason, p_detail) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'order_accept(uuid, integer, uuid, text)',
    'order_reject(uuid, public.reject_reason, text, uuid, text)',
    'order_progress(uuid, public.order_status, uuid, text)',
    'order_assign_driver(uuid, uuid, uuid, text)',
    'order_set_weight(uuid, numeric, uuid)',
    'order_confirm_empty(uuid, boolean, uuid)',
    'order_cancel_request_respond(uuid, boolean, uuid, text)',
    'order_cancel_by_system(uuid, public.cancel_reason, jsonb)'
  ]
  loop
    execute format('revoke all on function app_private.%s from public, anon', f);
    execute format('grant execute on function app_private.%s to authenticated, service_role', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public.order_weight_respond(uuid, uuid, boolean)',
    'public.order_cancel_by_customer(uuid, uuid)'
  ]
  loop
    -- The customer's identity is the WhatsApp number the server verified: service role only.
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- 12. Row-level security for orders ---------------------------------------------------------------------
-- Customers read their own orders; owner, manager, cashier and kitchen read their vendor's orders; a
-- merchant driver reads only the orders assigned to them; operators read all. Nobody writes from a
-- client: every change is one of the functions above.
create function app_private.can_read_order(p_vendor_id uuid, p_customer_id uuid, p_driver_member_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_operator()
    or app_private.has_vendor_role(p_vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[])
    or exists (select 1 from public.customers c where c.id = p_customer_id and c.user_id = (select auth.uid()))
    or exists (select 1 from public.vendor_members m where m.id = p_driver_member_id and m.user_id = (select auth.uid()) and m.status = 'active');
$$;
revoke all on function app_private.can_read_order(uuid, uuid, uuid) from public;
grant execute on function app_private.can_read_order(uuid, uuid, uuid) to authenticated, service_role;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
revoke all on table public.orders, public.order_items, public.order_events from public, anon, authenticated;
grant all on table public.orders, public.order_items to service_role;
grant select, insert on table public.order_events to service_role;
grant select on table public.orders, public.order_items, public.order_events to authenticated;

create policy orders_read on public.orders for select to authenticated
  using (app_private.can_read_order(vendor_id, customer_id, driver_member_id));
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and app_private.can_read_order(o.vendor_id, o.customer_id, o.driver_member_id)));
create policy order_events_read on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and app_private.can_read_order(o.vendor_id, o.customer_id, o.driver_member_id)));

create trigger orders_audit after insert or update or delete on public.orders
  for each row execute function app_private.audit_row();
