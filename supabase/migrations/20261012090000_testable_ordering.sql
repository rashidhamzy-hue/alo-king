-- Session T (DECISIONS §34): ordering you can test from one phone, with no API credit. Contents:
--   1. config: handoff length in minutes
--   2. owner phones, and the staging-only #merchant / #customer switch for them
--   3. human handoff that ends on its own and tells the owner's phone (until Slack, session 5b)
--   4. vendors.is_test, for the staging test merchant (a new column with a default on a frozen table, §31)
--   5. the customer's cash currency (USD or LBP) on baskets and orders
--   6. menu sections for the section list
--   7. the rating prompt right after "Received" for test merchants
--   8. order_brief, for the merchant's next-step cards
-- Nothing here creates a test merchant: the fixture is supabase/test-fixtures/alo-test-grill.sql, which only
-- the staging deploy runs. Places and vendor data are only read or given a defaulted column (§31).

-- 1. Config ---------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §34, 12 October 2026 (session T)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('handoff_minutes', '30', '2026-10-11 00:00+03', 'The bot stays quiet this long after a handoff; "menu", "hi" or any button tap ends it sooner (DECISIONS §34)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Owner phones and the test-side switch -------------------------------------------------------------
-- The numbers of the people who run Alo King. Every row gets handoff notes on WhatsApp until the Slack
-- console exists (session 5b). `test_switch` is on only where the staging fixture ran: that number may send
-- #merchant or #customer to choose which side of a conversation the bot treats it as.
create table app_private.owner_phones (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  note text check (char_length(note) <= 200),
  test_switch boolean not null default false,
  created_at timestamptz not null default now()
);
create table app_private.test_sides (
  phone_e164 text primary key references app_private.owner_phones (phone_e164) on delete cascade,
  side text not null default 'customer' check (side in ('customer', 'merchant')),
  updated_at timestamptz not null default now()
);

alter table app_private.owner_phones enable row level security;
alter table app_private.test_sides enable row level security;

-- The side this number plays now, or null when it may not switch (every real phone).
create function public.test_side_get(p_phone_e164 text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.side, 'customer')
  from app_private.owner_phones o
  left join app_private.test_sides s on s.phone_e164 = o.phone_e164
  where o.phone_e164 = p_phone_e164 and o.test_switch;
$$;

-- Switches the side. As merchant the number becomes the active owner of the test merchant and receives its
-- order cards on WhatsApp at once (primary channel), so one phone can place an order and accept it.
create function public.test_side_set(p_phone_e164 text, p_side text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor public.vendors%rowtype;
  v_user uuid;
begin
  if p_side not in ('customer', 'merchant') then
    return jsonb_build_object('status', 'bad_side');
  end if;
  if not exists (select 1 from app_private.owner_phones o where o.phone_e164 = p_phone_e164 and o.test_switch) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  select * into v_vendor from public.vendors v where v.is_test order by v.created_at limit 1;
  if v_vendor.id is null then
    return jsonb_build_object('status', 'no_test_vendor');
  end if;
  insert into app_private.test_sides (phone_e164, side) values (p_phone_e164, p_side)
  on conflict (phone_e164) do update set side = excluded.side, updated_at = now();
  if p_side = 'merchant' then
    perform set_config('app.actor_kind', 'system', true);
    perform set_config('app.audit_reason', 'test side switch (DECISIONS §34)', true);
    v_user := app_private.auth_user_for_phone(p_phone_e164);
    insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status)
    values (v_vendor.id, v_user, p_phone_e164, 'owner', 'active')
    on conflict (vendor_id, phone_e164) do update set status = 'active', role = 'owner', user_id = excluded.user_id;
    insert into public.vendor_private (vendor_id, owner_mobile, kitchen_whatsapp)
    values (v_vendor.id, p_phone_e164, p_phone_e164)
    on conflict (vendor_id) do update set owner_mobile = excluded.owner_mobile, kitchen_whatsapp = excluded.kitchen_whatsapp;
    update public.vendor_order_channels set target = p_phone_e164, channel = 'whatsapp'
    where vendor_id = v_vendor.id and role = 'primary' and enabled;
    if not found then
      insert into public.vendor_order_channels (vendor_id, channel, role, target)
      values (v_vendor.id, 'whatsapp', 'primary', p_phone_e164);
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'side', p_side, 'vendor', coalesce(v_vendor.name_en, v_vendor.name_ar));
end;
$$;

-- 3. Human handoff (§30.6, §34) -----------------------------------------------------------------------
-- The bot stays quiet for `handoff_minutes`, then returns. The customer always gets an answer (the edge code
-- acknowledges every message and ends the handoff on "menu", "hi" or a tap). Every owner phone is told on
-- WhatsApp what the customer needs, because no console exists yet.
create or replace function public.customer_handoff(p_customer_id uuid, p_reason text, p_summary text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric := public.config_numeric('handoff_minutes');
  v_phone text;
  v_owner record;
  v_open boolean := app_private.beirut_hour() >= (public.config_value('support_hours') ->> 'from')::int
                    and app_private.beirut_hour() < (public.config_value('support_hours') ->> 'to')::int;
begin
  insert into public.bot_sessions (customer_id) values (p_customer_id) on conflict (customer_id) do nothing;
  update public.bot_sessions set handoff_until = now() + make_interval(mins => v_minutes::int), handoff_reason = left(p_reason, 300),
    low_confidence = 0
  where customer_id = p_customer_id;
  perform app_private.ops_alert('handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24'), 'customer_handoff', 'warning',
    left('Customer needs a person: ' || coalesce(p_summary, p_reason), 300), null, null,
    jsonb_build_object('customer_id', p_customer_id, 'reason', left(p_reason, 300)));
  select c.phone_e164 into v_phone from public.customers c where c.id = p_customer_id;
  for v_owner in select o.phone_e164 from app_private.owner_phones o loop
    perform public.app_reply(v_owner.phone_e164,
      jsonb_build_object('text', '🙋 Alo King: ' || coalesce(v_phone, 'a customer') || ' needs a person: ' || left(coalesce(p_summary, p_reason), 200)
        || E'\nThe bot stays quiet for ' || v_minutes::int || ' minutes, or until they send "menu".'),
      'handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end loop;
  return jsonb_build_object('status', 'handed_off', 'support_open', v_open);
end;
$$;

-- 4. Test merchants -------------------------------------------------------------------------------------
-- A test merchant (staging fixture) is marked here. `vendors.source` stays 'admin': its check constraint
-- would have to be dropped to add a value, and the data freeze (§31) forbids restructuring that table.
alter table public.vendors add column is_test boolean not null default false;

-- 5. Cash currency (§34 step 8) ------------------------------------------------------------------------
-- The customer says whether they will pay the cash in USD or LBP, so the merchant can have change ready.
-- Totals are always shown in both at the rate locked on the order (§13); this records only the choice.
alter table public.baskets add column cash_currency text check (cash_currency in ('USD', 'LBP'));
alter table public.orders add column cash_currency text check (cash_currency in ('USD', 'LBP'));

create function app_private.orders_set_cash_currency() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cash_currency is null and new.basket_id is not null then
    select b.cash_currency into new.cash_currency from public.baskets b where b.id = new.basket_id;
  end if;
  return new;
end;
$$;
revoke all on function app_private.orders_set_cash_currency() from public;
create trigger orders_set_cash_currency before insert on public.orders
  for each row execute function app_private.orders_set_cash_currency();

-- What the basket's shop takes and what the customer chose. A shop that takes one currency is set at once.
create function public.basket_cash_state(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_allowed text[];
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  select v.cash_currencies into v_allowed from public.vendors v where v.id = v_basket.vendor_id;
  if v_basket.cash_currency is not null and not (v_basket.cash_currency = any (v_allowed)) then
    update public.baskets set cash_currency = null where id = v_basket.id;
    v_basket.cash_currency := null;
  end if;
  if v_basket.cash_currency is null and cardinality(v_allowed) = 1 then
    update public.baskets set cash_currency = v_allowed[1] where id = v_basket.id;
    v_basket.cash_currency := v_allowed[1];
  end if;
  return jsonb_build_object('status', 'ok', 'cash_currency', v_basket.cash_currency, 'allowed', to_jsonb(v_allowed));
end;
$$;

create function public.basket_set_cash_currency(p_customer_id uuid, p_currency text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_allowed text[];
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  select v.cash_currencies into v_allowed from public.vendors v where v.id = v_basket.vendor_id;
  if p_currency is null or not (p_currency = any (v_allowed)) then
    return jsonb_build_object('status', 'not_accepted', 'allowed', to_jsonb(v_allowed));
  end if;
  update public.baskets set cash_currency = p_currency, last_activity_at = now() where id = v_basket.id;
  return jsonb_build_object('status', 'ok', 'cash_currency', p_currency);
end;
$$;

-- 6. Menu sections (§34 step 4) ------------------------------------------------------------------------
-- The sections of an orderable vendor with the number of available items in each, in menu order, and the
-- number of available items that have no section (the bot shows the flat list when there are any).
create function public.vendor_sections(p_vendor_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('section_id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en, 'name_fr', s.name_fr,
        'items', x.n) order by s.sort_order, s.id)
      from public.menu_sections s
      join lateral (select count(*) as n from public.menu_items i where i.section_id = s.id and i.available) x on x.n > 0
      where s.vendor_id = p_vendor_id), '[]'::jsonb),
    'unsectioned', (select count(*) from public.menu_items i where i.vendor_id = p_vendor_id and i.available and i.section_id is null))
  where exists (select 1 from public.vendors v where v.id = p_vendor_id and v.orderable and v.listing_status = 'active');
$$;

-- 7. Rating right after "Received" for a test merchant (§34 "rate it") ---------------------------------
-- Real orders are rated 30 minutes after delivery (§30.2.3). A test order is rated at once, so one test
-- session can finish. The same outbox row (and dedupe key) the timer uses, so it is never sent twice.
create function public.order_rating_prompt_now(p_customer_id uuid, p_order_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id and status = 'delivered';
  if v_o.id is null then
    return jsonb_build_object('status', 'no_order');
  end if;
  if not exists (select 1 from public.vendors v where v.id = v_o.vendor_id and v.is_test) then
    return jsonb_build_object('status', 'later');
  end if;
  if exists (select 1 from public.order_ratings r where r.order_id = v_o.id) then
    return jsonb_build_object('status', 'rated');
  end if;
  perform app_private.customer_notify(v_o.id, 'rating', jsonb_build_object('ask_delivery', v_o.driver_member_id is not null));
  return jsonb_build_object('status', 'sent');
end;
$$;

-- 8. The next-step cards for the merchant (§34 step 10) -------------------------------------------------
-- The code and kind of an order, so "ready?", "out for delivery?" and "delivered?" cards say which order.
create function public.order_brief(p_order_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('code', o.code, 'fulfilment', o.fulfilment, 'status', o.status)
  from public.orders o where o.id = p_order_id;
$$;

-- Grants: service role only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'test_side_get(text)',
    'test_side_set(text, text)',
    'customer_handoff(uuid, text, text)',
    'basket_cash_state(uuid)',
    'basket_set_cash_currency(uuid, text)',
    'vendor_sections(uuid)',
    'order_rating_prompt_now(uuid, uuid)',
    'order_brief(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
