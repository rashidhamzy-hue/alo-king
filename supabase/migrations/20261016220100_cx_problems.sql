-- Session 5f part 8b: the basket, the shop that cannot take an order, notes to the shop and problems after delivery
-- (CUSTOMER-EXPERIENCE §3.5 #28-29, §3.7 #41 and #45, §3.8 #49-50; DECISIONS §20.1, §27.8, §29.3, §30.4, §39.14,
-- §39.15.1). Every amount comes from the database; the bot only shows it. Contents:
--   1. dated config: discount_expiry_days, late_discount_usd, late_threshold_min, order_note_max_per_order
--   2. #28 a second shop's item: both shops' names for "Your basket is from Eatout. Start a new one from SEVEN?"
--   3. #29 under the shop's minimum order: up to 3 of that shop's items that close the gap, server-priced
--   4. #41 a shop rejects or does not answer: the 3 closest shops with the same dish (recorded distances only, zero routing
--      calls), and the basket rebuilt at the one tapped where the dishes match (an item without a match is named)
--   5. #45 a message during an active order goes to the shop as an order note (never the shop's number), rate-limited
--   6. #49-50 problems: the optional photo and the customer's words kept on the report; the top of the ETA range the
--      customer was given kept on the order; cold, spilled or very late cash orders get one late_discount_usd discount line
--      on the next order per order; every next-order discount expires after discount_expiry_days. The discount is the
--      existing customer credit: ledger entries charged to the merchant only when the merchant caused it, otherwise to Alo
--      King (§20.1), no cash value, never stored money, reversed to whoever funded it when it expires unused.
-- Places and vendor tables are only read (§31).

select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'CUSTOMER-EXPERIENCE §3.5, §3.7, §3.8: session 5f part 8b, 16 October 2026', true);

-- 1. Config ---------------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('discount_expiry_days', '60', '2026-10-16 12:00+03',
   'DECISIONS §39.14, spec §3.8 #49-50: a next-order discount line from a problem with a cash order expires after this many days (no cash value, not stored money)'),
  ('late_discount_usd', '2.00', '2026-10-16 12:00+03',
   'DECISIONS §39.14, spec §3.8 #50: the discount line on the next order for a cash order that arrived cold, spilled or very late; once per order'),
  ('late_threshold_min', '15', '2026-10-16 12:00+03',
   'DECISIONS §39.14, spec §3.8 #50: very late = delivered this many minutes after the top of the ETA range the customer was given'),
  ('order_note_max_per_order', '5', '2026-10-16 12:00+03',
   'Spec §3.7 #45: messages a customer may pass to the shop as notes on one active order')
on conflict do nothing;

-- The same dish at other shops is found through this index (dish first, then the shop), never by scanning menus.
create index if not exists menu_item_nutrition_dish_idx on public.menu_item_nutrition (dish_id, vendor_id);

-- 2. #28 A second shop's item ---------------------------------------------------------------------------------------------
-- The open basket's shop and the tapped item's shop, for "Your basket is from Eatout. Start a new one from SEVEN?".
create function public.basket_switch_names(p_customer_id uuid, p_item_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'basket_vendor', coalesce(bv.name_ar, bv.name_en), 'basket_vendor_en', coalesce(bv.name_en, bv.name_ar),
    'item_vendor', coalesce(iv.name_ar, iv.name_en), 'item_vendor_en', coalesce(iv.name_en, iv.name_ar))
  from public.menu_items i
  join public.vendors iv on iv.id = i.vendor_id
  left join public.baskets b on b.customer_id = p_customer_id and b.status = 'open'
  left join public.vendors bv on bv.id = b.vendor_id
  where i.id = p_item_id
  limit 1;
$$;

-- 3. #29 Under the minimum order ------------------------------------------------------------------------------------------
-- Up to three of the basket shop's orderable items that close the gap to its minimum order, priced by the server: first the
-- items priced at or above the gap, the closest first; then the shop's best sellers. Items not yet in the basket and items
-- that need no choice go first among equals. Read only; the tap adds the item through basket_add_item.
create function public.basket_gap_items(p_customer_id uuid, p_limit integer default 3) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_view jsonb;
  v_min numeric;
  v_sub numeric;
  v_gap numeric;
  v_best uuid[];
  v_items jsonb;
  v_n integer := least(greatest(coalesce(p_limit, 3), 1), 3);
begin
  select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_b.id is null then
    return jsonb_build_object('status', 'no_basket', 'items', '[]'::jsonb);
  end if;
  select o.min_order_usd into v_min from public.vendor_ops o where o.vendor_id = v_b.vendor_id;
  v_view := public.basket_view(p_customer_id);
  v_sub := coalesce((v_view ->> 'subtotal_usd')::numeric, 0);
  if v_min is null or v_sub >= v_min then
    return jsonb_build_object('status', 'not_below', 'items', '[]'::jsonb);
  end if;
  v_gap := v_min - v_sub;
  v_best := public.catalog_best_sellers(v_b.vendor_id, 30);
  with c as (
    select i.id, coalesce(i.name_ar, i.name_en) as name_ar, coalesce(i.name_en, i.name_ar) as name_en, i.sort_order,
      case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end as price,
      exists (select 1 from public.basket_items bi where bi.basket_id = v_b.id and bi.item_id = i.id) as in_basket,
      exists (select 1 from public.menu_option_groups g where g.item_id = i.id and g.min_select > 0) as needs_choice
    from public.menu_items i
    where i.vendor_id = v_b.vendor_id and app_private.menu_item_orderable(i.id, 1)
  ),
  ranked as (
    select c.*, row_number() over (order by (c.price >= v_gap) desc,
        case when c.price >= v_gap then c.price end asc nulls last,
        c.in_basket, c.needs_choice, coalesce(array_position(v_best, c.id), 1000), c.price desc, c.sort_order, c.id) as rk
    from c where c.price > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en, 'price_usd', r.price,
      'closes_gap', r.price >= v_gap, 'needs_choice', r.needs_choice) order by r.rk), '[]')
    into v_items
  from ranked r where r.rk <= v_n;
  return jsonb_build_object('status', 'below_minimum', 'min_order_usd', v_min, 'subtotal_usd', v_sub, 'missing_usd', v_gap,
    'vendor', v_view ->> 'vendor', 'vendor_en', v_view ->> 'vendor_en', 'items', v_items);
end;
$$;

-- 4. #41 A shop rejects or does not answer ---------------------------------------------------------------------------------
-- The closest open shops that deliver to the order's address with the same dish (the dish library's id) as the order's lines:
-- the dish index finds the shops that have it, a straight-line prefilter keeps those within the largest delivery distance,
-- and then at most 20 of them get the delivery check browse uses (the recorded distances customer_delivery_check reads: the
-- exact cached route, else the shop → place distance; never a routing call, §39.15.1). Most dishes matched first, then the
-- shortest road. p_vendor_id checks one shop (the tapped one) the same way.
create function app_private.order_same_dish_shops(p_order_id uuid, p_limit integer default 3, p_vendor_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_a public.addresses%rowtype;
  v_dishes text[];
  v_hidden uuid[];
  v_max numeric := public.max_delivery_km();
  v_paused boolean;
  v_c record;
  v_rk record;
  v_q record;
  v_rows jsonb := '[]';
  v_out jsonb;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.id is null or v_o.fulfilment <> 'delivery' or v_o.address_id is null then
    return '[]';
  end if;
  select * into v_a from public.addresses where id = v_o.address_id;
  if v_a.id is null or v_a.pin is null then
    return '[]';
  end if;
  select coalesce(array_agg(distinct nu.dish_id), '{}') into v_dishes
  from public.order_items oi join public.menu_item_nutrition nu on nu.item_id = oi.item_id
  where oi.order_id = v_o.id and nu.dish_id is not null;
  if cardinality(v_dishes) = 0 then
    return '[]';
  end if;
  v_hidden := app_private.customer_hidden_vendors(v_o.customer_id);
  v_paused := not app_private.place_delivered_to(v_a.place_id);
  for v_c in
    select v.id, v.name_ar, v.name_en, v.is_test, count(distinct nu.dish_id) as matched
    from public.menu_item_nutrition nu
    join public.vendors v on v.id = nu.vendor_id
    where nu.dish_id = any (v_dishes) and nu.vendor_id <> v_o.vendor_id
      and (p_vendor_id is null or nu.vendor_id = p_vendor_id)
      and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active' and v.delivery_enabled
      and (v.paused_until is null or v.paused_until <= now())
      and not (v.id = any (v_hidden))
      and (v.is_test or extensions.st_dwithin(v.location, v_a.pin, (v_max * 1000)::double precision))
      and app_private.menu_item_orderable(nu.item_id, 1)
    group by v.id
    order by count(distinct nu.dish_id) desc, extensions.st_distance(v.location, v_a.pin), v.id
    limit 20
  loop
    continue when not app_private.vendor_open_at(v_c.id);
    if v_c.is_test then
      select * into v_q from public.delivery_quote(v_c.id, 0);
    else
      continue when v_paused;
      select * into v_rk from app_private.shop_road_km(v_c.id, v_a.id);
      continue when v_rk.road_km is null;
      select * into v_q from public.delivery_quote(v_c.id, v_rk.road_km);
    end if;
    continue when not coalesce(v_q.deliverable, false);
    v_rows := v_rows || jsonb_build_object('vendor_id', v_c.id, 'name_ar', coalesce(v_c.name_ar, v_c.name_en),
      'name_en', coalesce(v_c.name_en, v_c.name_ar), 'matched', v_c.matched, 'dishes', cardinality(v_dishes),
      'road_km', v_q.road_km, 'fee_usd', v_q.fee_usd);
  end loop;
  select coalesce(jsonb_agg(s.x order by s.m desc, s.km nulls last), '[]') into v_out from (
    select x, (x ->> 'matched')::int as m, (x ->> 'road_km')::numeric as km from jsonb_array_elements(v_rows) x
    order by 2 desc, 3 nulls last
    limit least(greatest(coalesce(p_limit, 3), 1), 20)) s;
  return v_out;
end;
$$;

-- As in 20261015220000_demo_mode.sql, with one change (spec #41): when the shop rejected the order or did not answer (or
-- paused), the shops offered are the closest ones with the same dish, each with its id so one tap rebuilds the basket
-- there. Otherwise, or when no shop has the dish, the open shops that deliver there, as before. Looking for them never
-- stops the rejection or the cancellation itself.
create or replace function app_private.offer_alternatives(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_rows jsonb;
  v_refs jsonb := '{}';
  v_i integer := 0;
  v_v record;
  v_same jsonb := '[]';
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.id is null or v_o.delivery_pin is null then
    return '[]';
  end if;
  v_rows := '[]';
  if v_o.status = 'rejected' or (v_o.status = 'cancelled' and v_o.cancel_reason in ('merchant_unreachable', 'merchant_paused')) then
    begin
      v_same := app_private.order_same_dish_shops(p_order_id, 3);
    exception when others then
      v_same := '[]';
    end;
  end if;
  if jsonb_array_length(v_same) > 0 then
    for v_v in select x from jsonb_array_elements(v_same) x
    loop
      v_i := v_i + 1;
      v_refs := v_refs || jsonb_build_object('v' || v_i, jsonb_build_object('id', v_v.x ->> 'vendor_id',
        'label', left(coalesce(v_v.x ->> 'name_en', v_v.x ->> 'name_ar'), 60)));
      v_rows := v_rows || (v_v.x || jsonb_build_object('ref', 'v' || v_i, 'same_dish', true));
    end loop;
  else
    for v_v in
      select s.vendor_id, s.name_ar, s.name_en from public.vendor_search(null, extensions.st_y(v_o.delivery_pin::extensions.geometry),
        extensions.st_x(v_o.delivery_pin::extensions.geometry),
        (select v.business_type from public.vendors v where v.id = v_o.vendor_id), null, 10, v_o.customer_id) s
      where s.vendor_id <> v_o.vendor_id and s.is_open
      limit 3
    loop
      v_i := v_i + 1;
      v_refs := v_refs || jsonb_build_object('v' || v_i, jsonb_build_object('id', v_v.vendor_id, 'label', left(coalesce(v_v.name_en, v_v.name_ar), 60)));
      v_rows := v_rows || jsonb_build_object('ref', 'v' || v_i, 'name_ar', v_v.name_ar, 'name_en', v_v.name_en);
    end loop;
  end if;
  if v_i > 0 then
    update public.bot_sessions s set refs = (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(s.refs) e(k, v) where k !~ '^v\d+$') || v_refs
    where s.customer_id = v_o.customer_id;
  end if;
  return v_rows;
end;
$$;

-- The order a shop could not take, rebuilt at another shop: each line's dish becomes that shop's item with the same dish
-- (the one priced closest to the line), in the same quantity; a line without a match is named, never dropped silently.
-- Only the customer's own order that a shop rejected or did not answer (p_order_id null: the latest one within
-- basket_keep_hours, for the agent's tool), and only a shop that is open, delivers there and has one of its dishes now.
-- Read only: the bot adds the lines through cart_merge, which prices them.
create function public.order_rebuild_at(p_customer_id uuid, p_order_id uuid, p_vendor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_v public.vendors%rowtype;
  v_l record;
  v_pick uuid;
  v_lines jsonb := '[]';
  v_missing jsonb := '[]';
begin
  select * into v_o from public.orders o
  where o.customer_id = p_customer_id
    and (o.id = p_order_id
         or (p_order_id is null
             and o.created_at > now() - make_interval(hours => public.config_numeric('basket_keep_hours')::int)))
    and (o.status = 'rejected' or (o.status = 'cancelled' and o.cancel_reason in ('merchant_unreachable', 'merchant_paused')))
  order by o.created_at desc
  limit 1;
  if v_o.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_vendor_id is null or jsonb_array_length(app_private.order_same_dish_shops(v_o.id, 1, p_vendor_id)) = 0 then
    return jsonb_build_object('status', 'vendor_unavailable', 'code', v_o.code);
  end if;
  select * into v_v from public.vendors where id = p_vendor_id;
  for v_l in
    select oi.quantity, oi.unit_price_usd, coalesce(oi.name_ar, oi.name_en) as name_ar, coalesce(oi.name_en, oi.name_ar) as name_en,
      nu.dish_id
    from public.order_items oi left join public.menu_item_nutrition nu on nu.item_id = oi.item_id
    where oi.order_id = v_o.id
    order by oi.created_at, oi.id
  loop
    v_pick := null;
    if v_l.dish_id is not null then
      select i.id into v_pick
      from public.menu_item_nutrition n2 join public.menu_items i on i.id = n2.item_id
      where n2.dish_id = v_l.dish_id and n2.vendor_id = p_vendor_id and app_private.menu_item_orderable(i.id, v_l.quantity)
      order by abs(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end - v_l.unit_price_usd),
        i.sort_order, i.id
      limit 1;
    end if;
    if v_pick is null then
      v_missing := v_missing || jsonb_build_object('name_ar', v_l.name_ar, 'name_en', v_l.name_en, 'quantity', v_l.quantity);
    else
      v_lines := v_lines || jsonb_build_object('item_id', v_pick, 'quantity', v_l.quantity);
    end if;
  end loop;
  return jsonb_build_object('status', case when jsonb_array_length(v_lines) = 0 then 'nothing' else 'ok' end,
    'order_id', v_o.id, 'code', v_o.code, 'vendor_id', v_v.id, 'vendor', coalesce(v_v.name_ar, v_v.name_en),
    'vendor_en', coalesce(v_v.name_en, v_v.name_ar), 'lines', v_lines, 'missing', v_missing);
end;
$$;

-- 5. #45 A message to the shop during an active order -----------------------------------------------------------------------
-- What the customer typed while an order is under way, passed to the shop as a note on that order: to the number that got
-- the order card, else the shop's WhatsApp order channel. The customer never sees the shop's number, and the shop never
-- sees the customer's. A note never changes the order or its price.
create table public.order_customer_notes (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  -- The WhatsApp message it came in: a replayed turn passes it once.
  source_message_id text not null check (char_length(source_message_id) between 1 and 200),
  outbox_id bigint,
  created_at timestamptz not null default now(),
  unique (customer_id, source_message_id)
);
create index order_customer_notes_order_idx on public.order_customer_notes (order_id, created_at);
alter table public.order_customer_notes enable row level security;
revoke all on table public.order_customer_notes from public, anon, authenticated;
grant select, insert, update on table public.order_customer_notes to service_role;
grant select on table public.order_customer_notes to authenticated;
create policy order_customer_notes_read on public.order_customer_notes for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and app_private.can_read_order(o.vendor_id, o.customer_id, o.driver_member_id)));
comment on table public.order_customer_notes is
  'Messages a customer passed to the shop during an active order (spec §3.7 #45); at most order_note_max_per_order per order.';

create function public.order_note_send(p_customer_id uuid, p_text text, p_message_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_v public.vendors%rowtype;
  v_text text := left(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g'), 300);
  -- No dated row: no notes are passed (never a number written here).
  v_max integer := coalesce(public.config_numeric('order_note_max_per_order'), 0)::int;
  v_n integer;
  v_note public.order_customer_notes%rowtype;
  v_ch record;
  v_target text;
  v_outbox bigint;
begin
  if v_text = '' or p_message_id is null or char_length(p_message_id) not between 1 and 200 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_o from public.orders o
  where o.customer_id = p_customer_id
    and o.status in ('placed', 'accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup',
                     'picked_up', 'near_drop', 'arrived')
  order by o.created_at desc
  limit 1
  for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'no_order');
  end if;
  select * into v_v from public.vendors where id = v_o.vendor_id;
  select * into v_note from public.order_customer_notes where customer_id = p_customer_id and source_message_id = p_message_id;
  if v_note.id is not null then
    return jsonb_build_object('status', 'sent', 'repeat', true, 'code', v_o.code,
      'vendor', coalesce(v_v.name_ar, v_v.name_en), 'vendor_en', coalesce(v_v.name_en, v_v.name_ar));
  end if;
  select count(*) into v_n from public.order_customer_notes where order_id = v_o.id;
  if v_n >= v_max then
    return jsonb_build_object('status', 'limit', 'code', v_o.code, 'max', v_max,
      'vendor', coalesce(v_v.name_ar, v_v.name_en), 'vendor_en', coalesce(v_v.name_en, v_v.name_ar));
  end if;
  -- The number that got this order's card, else the shop's WhatsApp order channel.
  select m.target into v_target from public.outbound_messages m
  where m.order_id = v_o.id and m.channel = 'whatsapp' and m.purpose in ('new_order', 'copy') and m.status = 'sent'
  order by m.id
  limit 1;
  if v_target is null then
    select * into v_ch from app_private.vendor_channels(v_o.vendor_id);
    v_target := case when v_ch.primary_channel = 'whatsapp' then v_ch.primary_target
                     when v_ch.backup_channel = 'whatsapp' then v_ch.backup_target end;
  end if;
  insert into public.order_customer_notes (order_id, customer_id, body, source_message_id)
  values (v_o.id, p_customer_id, v_text, p_message_id)
  returning * into v_note;
  if v_target is null then
    -- No WhatsApp number for the shop: kept on the order, and a person passes it on (the customer is told exactly that).
    perform app_private.ops_alert('note:' || v_note.id, 'customer_problem', 'warning',
      'A customer''s message for order ' || v_o.code || ' has no WhatsApp channel to reach the shop', v_o.id, v_o.vendor_id,
      jsonb_build_object('text', v_text));
    return jsonb_build_object('status', 'no_channel', 'code', v_o.code, 'note_id', v_note.id,
      'vendor', coalesce(v_v.name_ar, v_v.name_en), 'vendor_en', coalesce(v_v.name_en, v_v.name_ar));
  end if;
  v_outbox := app_private.outbox_add('note:' || v_note.id, v_o.id, v_o.vendor_id, 'whatsapp', 'customer_note', v_target,
    jsonb_build_object('code', v_o.code, 'text', v_text, 'n', v_n + 1));
  update public.order_customer_notes set outbox_id = v_outbox where id = v_note.id;
  return jsonb_build_object('status', 'sent', 'code', v_o.code, 'note_id', v_note.id, 'left', v_max - v_n - 1,
    'vendor', coalesce(v_v.name_ar, v_v.name_en), 'vendor_en', coalesce(v_v.name_en, v_v.name_ar));
end;
$$;

-- 6. #49-50 Problems after delivery ----------------------------------------------------------------------------------------
-- The customer's optional photo (a WhatsApp media reference, never the picture itself) and their own words, on the report.
alter table public.order_disputes
  add column photo_ref text check (photo_ref ~ '^wa-media:[A-Za-z0-9._-]{1,200}$'),
  add column photo_at timestamptz,
  add column customer_note text check (char_length(customer_note) <= 300);

-- The top of the ETA range the customer was given when the shop accepted (spec #50: "very late" is measured from it).
alter table public.orders add column eta_max_at timestamptz;
comment on column public.orders.eta_max_at is
  'The top of the ETA range told to the customer at acceptance; delivered later than this by late_threshold_min is very late (spec §3.8 #50).';

create function app_private.orders_eta_promise() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.eta_max_at is null then
    v_max := (public.order_eta_range(new.id) ->> 'max')::integer;
    if v_max is not null then
      update public.orders set eta_max_at = now() + make_interval(mins => v_max) where id = new.id;
    end if;
  end if;
  return null;
end;
$$;
create trigger orders_eta_promise after update of status on public.orders
  for each row execute function app_private.orders_eta_promise();

-- As in 20261015120100_customer_agent.sql, with one change: the discount expires after discount_expiry_days (dated config,
-- DECISIONS §39.14), else dispute_rules.credit_days as before.
create or replace function app_private.dispute_book(p_dispute_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.order_disputes%rowtype;
  v_o public.orders%rowtype;
  v_r jsonb := public.config_value('dispute_rules');
  v_tx uuid;
  v_credit uuid;
begin
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  select * into v_o from public.orders where id = v_d.order_id;
  if v_d.ledger_tx is not null or v_d.amount_usd <= 0 then
    return jsonb_build_object('status', 'booked', 'amount_usd', v_d.amount_usd);
  end if;
  -- An online order is refunded to its original payment (§20.1), never with a discount line or stored money: no online
  -- payment is live yet, so nothing is booked here and the approval stays with a person for the refund.
  if v_o.payment_method is distinct from 'cod' then
    return jsonb_build_object('status', 'refund_pending', 'amount_usd', v_d.amount_usd);
  end if;
  v_tx := public.ledger_post('refund', 'dispute:' || v_d.id,
    jsonb_build_array(
      jsonb_build_object('account_id', case when v_d.payer = 'merchant'
                                            then public.ledger_account('merchant_payable', 'USD', v_o.vendor_id)
                                            else public.ledger_account('expense_refunds', 'USD') end,
        'amount', v_d.amount_usd, 'memo', v_d.kind || ' on order ' || v_o.code),
      jsonb_build_object('account_id', public.ledger_account('customer_refund_payable', 'USD'), 'amount', -v_d.amount_usd,
        'memo', 'customer credit, order ' || v_o.code)),
    v_o.id, v_o.usd_lbp_rate, 'dispute ' || v_d.kind || ' (' || v_d.rule || ')');
  insert into public.customer_credits (customer_id, amount_usd, reason, dispute_id, expires_at)
  values (v_d.customer_id, v_d.amount_usd, v_d.kind || ' on order ' || v_o.code, v_d.id,
          now() + make_interval(days => coalesce(public.config_numeric('discount_expiry_days'), (v_r ->> 'credit_days')::numeric)::int))
  returning id into v_credit;
  update public.order_disputes set ledger_tx = v_tx, credit_id = v_credit, decided_at = coalesce(decided_at, now())
  where id = v_d.id;
  return jsonb_build_object('status', 'booked', 'amount_usd', v_d.amount_usd, 'credit_id', v_credit);
end;
$$;

-- Cold, spilled or very late (spec #50), one discount line per order whichever is reported first. The server decides:
--   very late  = delivered more than late_threshold_min after the top of the ETA range given at acceptance (eta_max_at;
--                for an order accepted before that column existed: the shop's prep time, the road at 25 km/h and the
--                range's width);
--   cold       = the delivery leg took more than cold_factor x the expected road time (as dispute_open), or very late;
--   spilled    = a person decides from the photo (photo classification waits for AI credit), as before.
-- A cash order gets late_discount_usd off its next order (never more than the food), automatically within dispute_rules;
-- an online order goes to a person for a refund to the original payment (§20.1). The merchant pays when it caused it (its
-- own driver delivered, a pickup, or it was ready more than late_prep_min after its own promise); otherwise Alo King.
create function app_private.dispute_late(p_customer_id uuid, p_order_id uuid, p_kind text, p_photo_ref text, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_r jsonb := public.config_value('dispute_rules');
  v_late_usd numeric := public.config_numeric('late_discount_usd');
  -- No dated row: nothing counts as very late (never a number written here).
  v_threshold numeric := public.config_numeric('late_threshold_min');
  v_amount numeric := 0;
  v_eligible boolean := false;
  v_very_late boolean := false;
  v_payer text;
  v_decision text;
  v_rule text;
  v_rate numeric;
  v_delivered integer;
  v_prior integer;
  v_leg_min numeric;
  v_expected_min numeric;
  v_promise timestamptz;
  v_merchant_late boolean;
  v_id uuid;
begin
  if p_kind not in ('cold_food', 'late', 'damaged') then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if v_o.status <> 'delivered' then
    return jsonb_build_object('status', 'not_delivered', 'order_status', v_o.status);
  end if;
  if v_o.delivered_at < now() - make_interval(days => (v_r ->> 'report_days')::int) then
    return jsonb_build_object('status', 'too_late', 'days', (v_r ->> 'report_days')::int);
  end if;
  -- One report of each kind, and one discount line per order for cold, spilled and very late together.
  if exists (select 1 from public.order_disputes d where d.order_id = v_o.id and d.kind = p_kind and d.order_item_id is null)
     or exists (select 1 from public.order_disputes d where d.order_id = v_o.id and d.kind in ('cold_food', 'late', 'damaged')
                and d.decision in ('auto_credit', 'approved', 'review', 'owner_review', 'remake')) then
    return jsonb_build_object('status', 'already_reported');
  end if;

  select count(*) into v_delivered from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered'
    and o.delivered_at > now() - make_interval(days => (v_r ->> 'rate_window_days')::int);
  select count(*) into v_prior from public.order_disputes d where d.customer_id = p_customer_id
    and d.created_at > now() - make_interval(days => (v_r ->> 'rate_window_days')::int)
    and d.decision in ('auto_credit', 'approved', 'review', 'owner_review')
    and d.rule not like 'operator %';
  v_rate := v_prior::numeric / greatest(v_delivered, 1);

  v_merchant_late := v_o.accepted_at is not null and v_o.ready_marked_at is not null
    and v_o.ready_marked_at > v_o.accepted_at + make_interval(mins => coalesce(v_o.prep_minutes, (select v.default_prep_minutes from public.vendors v where v.id = v_o.vendor_id))::int)
                              + make_interval(mins => (v_r ->> 'late_prep_min')::int);
  v_payer := case when v_o.fulfilment = 'pickup' or v_o.delivery_mode = 'merchant' or v_merchant_late then 'merchant'
                  else 'alo_king' end;
  v_promise := coalesce(v_o.eta_max_at,
    v_o.accepted_at + make_interval(mins => ceil(coalesce(v_o.prep_minutes, (select v.default_prep_minutes from public.vendors v where v.id = v_o.vendor_id)) + coalesce(v_o.road_km, 0) / 25.0 * 60
                                                 + coalesce(public.config_numeric('eta_range_extra_min'), 10))::int));
  v_very_late := v_o.delivered_at is not null and v_promise is not null
    and v_o.delivered_at > v_promise + make_interval(mins => v_threshold::int);

  case p_kind
    when 'late' then
      v_eligible := v_very_late;
      v_rule := case when v_promise is null then 'late: no promised time to check'
                     when v_very_late then format('late: delivered %s min after the top of the ETA range',
                                                  round(extract(epoch from (v_o.delivered_at - v_promise)) / 60.0))
                     else format('late: delivered within %s min of the top of the ETA range', v_threshold) end;
    when 'cold_food' then
      if v_o.picked_up_at is not null and v_o.delivered_at is not null and v_o.road_km is not null and v_o.delivery_pin is not null then
        v_leg_min := extract(epoch from (v_o.delivered_at - v_o.picked_up_at)) / 60.0;
        select r.duration_s / 60.0 into v_expected_min
        from public.vendors v, public.route_cache_lookup(extensions.st_y(v.location::extensions.geometry), extensions.st_x(v.location::extensions.geometry),
          array[extensions.st_y(v_o.delivery_pin::extensions.geometry)], array[extensions.st_x(v_o.delivery_pin::extensions.geometry)]) r
        where v.id = v_o.vendor_id;
        v_expected_min := greatest(5, coalesce(v_expected_min, v_o.road_km / 25.0 * 60.0));
      end if;
      v_eligible := v_very_late or coalesce(v_leg_min > (v_r ->> 'cold_factor')::numeric * v_expected_min, false);
      v_rule := case when v_eligible and v_leg_min is not null and v_leg_min > (v_r ->> 'cold_factor')::numeric * v_expected_min
                       then format('cold_food: delivery took %s min against %s expected', round(v_leg_min), round(v_expected_min))
                     when v_eligible then 'cold_food: delivered very late'
                     when v_leg_min is null then 'cold_food: no delivery times to check'
                     else format('cold_food: delivery took %s min, within %s x %s', round(v_leg_min), v_r ->> 'cold_factor',
                                 round(v_expected_min)) end;
    else
      v_rule := 'damaged: the photo decides, a person looks (remake or discount)';
  end case;

  if p_kind = 'damaged' or v_eligible then
    v_amount := least(coalesce(v_late_usd, 0), v_o.food_subtotal_usd);
  end if;
  if p_kind = 'damaged' then
    v_decision := 'review';
  elsif not v_eligible or v_amount <= 0 then
    v_decision := 'rejected';
    v_amount := 0;
  elsif v_o.payment_method <> 'cod' then
    v_decision := 'review'; -- refunded to the original payment (§20.1), never a discount line
  elsif v_amount > (v_r ->> 'owner_over_usd')::numeric then
    v_decision := 'owner_review';
  elsif v_amount <= (v_r ->> 'auto_max_usd')::numeric and v_rate < (v_r ->> 'max_dispute_rate')::numeric then
    v_decision := 'auto_credit';
  else
    v_decision := 'review';
  end if;

  insert into public.order_disputes (order_id, customer_id, kind, amount_usd, payer, decision, rule, photo_ref, photo_at, customer_note)
  values (v_o.id, p_customer_id, p_kind, v_amount, case when v_amount > 0 then v_payer end, v_decision,
          v_rule || format(' (dispute rate %s)', round(v_rate, 2)), p_photo_ref, case when p_photo_ref is not null then now() end,
          p_note)
  returning id into v_id;
  update public.orders set customer_problem_at = coalesce(customer_problem_at, now()) where id = v_o.id;
  if v_decision = 'auto_credit' then
    perform app_private.dispute_book(v_id);
  elsif v_decision in ('review', 'owner_review') then
    perform app_private.ops_alert('dispute:' || v_id, 'customer_dispute',
      case when v_decision = 'owner_review' then 'urgent' else 'warning' end,
      format('Order %s: customer reports %s%s%s; %s', v_o.code, replace(p_kind, '_', ' '),
             case when v_amount > 0 then format(' ($%s)', v_amount) else '' end,
             case when p_photo_ref is not null then ', photo attached' else '' end,
             case when v_decision = 'owner_review' then 'over the owner limit: Rasheed decides' else 'a person decides' end),
      v_o.id, v_o.vendor_id, jsonb_build_object('dispute_id', v_id, 'rule', v_rule, 'amount_usd', v_amount,
        'photo_ref', p_photo_ref, 'customer_note', p_note));
  end if;
  return jsonb_build_object('status', v_decision, 'dispute_id', v_id, 'amount_usd', v_amount, 'payer', v_payer,
    'code', v_o.code, 'rule', v_rule, 'usd_lbp_rate', v_o.usd_lbp_rate, 'amount_lbp', round(v_amount * v_o.usd_lbp_rate, 0));
end;
$$;

-- The bot's report (spec #49-50): missing, wrong and other as dispute_open decides them (with the photo and the customer's
-- words added to the report and its alert), cold, spilled and very late by dispute_late. The answer says how many days the
-- discount lasts.
create function public.dispute_report(p_customer_id uuid, p_order_id uuid, p_kind text, p_order_item_id uuid default null,
  p_quantity integer default 1, p_photo_ref text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_photo text := case when p_photo_ref ~ '^wa-media:[A-Za-z0-9._-]{1,200}$' then p_photo_ref end;
  v_note text := nullif(left(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), 300), '');
  v_days integer := coalesce(public.config_numeric('discount_expiry_days'),
                             (public.config_value('dispute_rules') ->> 'credit_days')::numeric)::int;
  v_res jsonb;
  v_id uuid;
begin
  if p_kind in ('cold_food', 'late', 'damaged') then
    v_res := app_private.dispute_late(p_customer_id, p_order_id, p_kind, v_photo, v_note);
  else
    v_res := public.dispute_open(p_customer_id, p_order_id, p_kind, p_order_item_id, p_quantity);
    v_id := (v_res ->> 'dispute_id')::uuid;
    if v_id is not null and (v_photo is not null or v_note is not null) then
      update public.order_disputes set photo_ref = v_photo, photo_at = case when v_photo is not null then now() end,
        customer_note = v_note
      where id = v_id;
      -- The alert a person reads carries them (it is sent after this transaction commits).
      update public.ops_alerts set detail = detail || jsonb_build_object('photo_ref', v_photo, 'customer_note', v_note),
        summary = left(summary || case when v_photo is not null then ' (photo attached)' else '' end, 300)
      where dedupe_key = 'dispute:' || v_id and sent_at is null;
    end if;
  end if;
  return v_res || jsonb_build_object('credit_days', v_days, 'photo', v_photo is not null);
end;
$$;

-- A photo the customer sends after a report went to a person: kept on their latest open report, and the operators hear of it.
create function public.dispute_photo_add(p_customer_id uuid, p_photo_ref text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.order_disputes%rowtype;
  v_o public.orders%rowtype;
begin
  if p_photo_ref is null or p_photo_ref !~ '^wa-media:[A-Za-z0-9._-]{1,200}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_d from public.order_disputes d
  where d.customer_id = p_customer_id and d.decision in ('review', 'owner_review') and d.photo_ref is null
    and d.created_at > now() - make_interval(days => (public.config_value('dispute_rules') ->> 'report_days')::int)
  order by d.created_at desc
  limit 1
  for update;
  if v_d.id is null then
    return jsonb_build_object('status', 'none');
  end if;
  select * into v_o from public.orders where id = v_d.order_id;
  update public.order_disputes set photo_ref = p_photo_ref, photo_at = now() where id = v_d.id;
  perform app_private.ops_alert('dispute-photo:' || v_d.id, 'customer_dispute', 'info',
    format('Order %s: the customer sent a photo for the %s report', v_o.code, replace(v_d.kind, '_', ' ')),
    v_o.id, v_o.vendor_id, jsonb_build_object('dispute_id', v_d.id, 'photo_ref', p_photo_ref));
  return jsonb_build_object('status', 'attached', 'dispute_id', v_d.id, 'code', v_o.code);
end;
$$;

-- Grants -------------------------------------------------------------------------------------------------------------------
revoke all on function app_private.order_same_dish_shops(uuid, integer, uuid), app_private.offer_alternatives(uuid),
  app_private.orders_eta_promise(), app_private.dispute_book(uuid),
  app_private.dispute_late(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.basket_switch_names(uuid, uuid), public.basket_gap_items(uuid, integer),
  public.order_rebuild_at(uuid, uuid, uuid), public.order_note_send(uuid, text, text),
  public.dispute_report(uuid, uuid, text, uuid, integer, text, text), public.dispute_photo_add(uuid, text)
  from public, anon, authenticated;
grant execute on function public.basket_switch_names(uuid, uuid), public.basket_gap_items(uuid, integer),
  public.order_rebuild_at(uuid, uuid, uuid), public.order_note_send(uuid, text, text),
  public.dispute_report(uuid, uuid, text, uuid, integer, text, text), public.dispute_photo_add(uuid, text)
  to service_role;
