-- Session 5f part 7: the chat after the native cart and at checkout (CUSTOMER-EXPERIENCE #25, #26, #34, #35, #38 and the
-- product carousel of DECISIONS §39.15.2). The server owns every amount here; the bot only shows what these functions return.
--   1. Choices after a native cart (#25): an item's choice groups with its name (item_choice_groups); a basket line's optional
--      add-ons, offered once per line (basket_line_extras, basket_items.extras_offered_at); add-ons added to a line and
--      priced by the server (basket_line_add_options).
--   2. Item notes (#26): one note per basket line, up to item_note_max_chars (80) characters, never a price (basket_line_note).
--      basket_view shows it; order_place already copies basket_items.note to order_items.note, which the order card shows.
--      The AI's notes (basket_add_item) go through the same cleaning and limit (app_private.clean_item_note).
--   3. Change for cash (#35): "Do you need change?" with the note amounts of dated config (cash_change_options_usd,
--      cash_change_options_lbp) above the total; the answer is kept on the basket and copied to the order
--      (orders.cash_change_for + cash_change_currency), and the order card shows the change to bring.
--   4. Tips (#38, §27.8 #18): at checkout from tip_amounts_usd (DECISIONS §39.14), after delivery from the same amounts or
--      "Other" up to tip_max_usd. A tip is its own amount on the order (orders.tip_usd), outside total_usd, and goes 100%
--      to whoever delivered. A cash tip is first PROMISED (orders.tip_status): whoever delivered is told on WhatsApp
--      (outbox purpose 'tip', "✅ Got it"), and only their tap (order_tip_confirm) books it: one 'tip' ledger transaction,
--      received in cash and kept by them. Nothing is booked on the customer's word alone.
--   5. Product carousel (§39.15.2): "Popular near you" (each delivering shop's best seller) and the one "Goes well with" of
--      an order (the basket_upsell rule: the shop's items bought together in delivered orders, never on a reorder), with
--      config carousel_enabled (false until one carousel is verified on the US number).

-- 0. Dated config (DECISIONS §1: no business number in code) ---------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('item_note_max_chars', '80', '2026-10-16 00:00+03',
   'CUSTOMER-EXPERIENCE #26: a note per basket line ("no onions"), at most this many characters'),
  ('cash_change_options_usd', '[20, 50, 100]', '2026-10-16 00:00+03',
   'CUSTOMER-EXPERIENCE #35: "Do you need change?" note amounts in USD (only those above the total are offered)'),
  ('cash_change_options_lbp', '[1000000, 2000000, 5000000]', '2026-10-16 00:00+03',
   'CUSTOMER-EXPERIENCE #35: the same question for cash in lira, amounts in LBP (only those above the total are offered)'),
  ('tip_amounts_usd', '[1, 2, 3]', '2026-10-16 00:00+03',
   'DECISIONS §39.14, CUSTOMER-EXPERIENCE #38: tip buttons at checkout (default none) and after delivery'),
  ('tip_max_usd', '10', '2026-10-16 00:00+03',
   'CUSTOMER-EXPERIENCE #38: the most an "Other" tip after delivery may be'),
  ('tip_after_delivery_minutes', '120', '2026-10-16 00:00+03',
   'CUSTOMER-EXPERIENCE #38: how long after delivery a tip may be added (it is cash handed over at the door)'),
  ('goes_well_max_items', '3', '2026-10-16 00:00+03',
   'DECISIONS §29.3, §39.15.2: items in the one "Goes well with" message of an order'),
  ('carousel_enabled', 'false', '2026-10-16 00:00+03',
   'DECISIONS §39.15.2: product carousels stay off until one is verified on the US number; a later session sets true')
on conflict do nothing;

-- Positive amounts of a config list, distinct and ascending ([] when the row is missing or not a list).
create function app_private.config_amounts(p_key text) returns numeric[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct (x #>> '{}')::numeric order by (x #>> '{}')::numeric), '{}')
  from jsonb_array_elements(coalesce(case when jsonb_typeof(public.config_value(p_key)) = 'array'
                                          then public.config_value(p_key) end, '[]'::jsonb)) x
  where jsonb_typeof(x) = 'number' and (x #>> '{}')::numeric > 0;
$$;
revoke all on function app_private.config_amounts(text) from public;

-- 1. Columns -------------------------------------------------------------------------------------------------------------
alter table public.baskets
  -- One of tip_amounts_usd, chosen at checkout; null = no tip (the default).
  add column tip_usd numeric(10, 2) check (tip_usd > 0),
  -- The note the customer pays with, in cash_change_currency; currency set and amount null = exact cash. An answer for
  -- another currency than the basket's cash_currency, or not above the total any more, is asked again.
  add column cash_change_for numeric(14, 2) check (cash_change_for > 0),
  add column cash_change_currency text check (cash_change_currency in ('USD', 'LBP'));

alter table public.basket_items
  -- The line's add-ons were offered (#25: once per line, never twice).
  add column extras_offered_at timestamptz;

alter table public.orders
  -- 100% to whoever delivered (§27.8 #18), outside total_usd: what the customer pays at the door is total_usd + tip_usd.
  add column tip_usd numeric(10, 2) not null default 0 check (tip_usd >= 0),
  add column tip_source text check (tip_source in ('checkout', 'after_delivery')),
  add column tip_at timestamptz,
  -- The after-delivery tip question was asked (once per order).
  add column tip_offered_at timestamptz,
  add column cash_change_for numeric(14, 2) check (cash_change_for > 0),
  add column cash_change_currency text check (cash_change_currency in ('USD', 'LBP')),
  -- promised: the customer chose it (at checkout or after delivery); collected: whoever delivered confirmed they have it
  -- (their "Got it" tap), the only moment the ledger books it.
  add column tip_status text check (tip_status in ('promised', 'collected')),
  add column tip_collected_at timestamptz,
  add column tip_collected_by uuid references public.vendor_members (id) on delete set null,
  add constraint orders_tip_has_source check ((tip_usd > 0) = (tip_source is not null)),
  add constraint orders_tip_has_status check ((tip_usd > 0) = (tip_status is not null)),
  add constraint orders_tip_collected_at check ((tip_status = 'collected') = (tip_collected_at is not null));
comment on column public.orders.tip_usd is
  'Tip for whoever delivered (CUSTOMER-EXPERIENCE #38), not part of total_usd; the customer pays total_usd + tip_usd.';
comment on column public.orders.cash_change_for is
  'The note the customer pays with, in cash_change_currency (#35); currency set and amount null = exact cash.';

-- 2. Choices after a native cart (#25) -----------------------------------------------------------------------------------
-- An item's name and its choice groups with the available options and their server prices.
create function public.item_choice_groups(p_item_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('item_id', i.id, 'name', coalesce(i.name_ar, i.name_en, i.name_fr),
    'name_en', coalesce(i.name_en, i.name_ar, i.name_fr),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', g.id, 'name', coalesce(g.name_ar, g.name_en, g.name_fr),
        'name_en', coalesce(g.name_en, g.name_ar, g.name_fr), 'min', g.min_select, 'max', g.max_select,
        'options', (select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'name', coalesce(o.name_ar, o.name_en, o.name_fr),
            'name_en', coalesce(o.name_en, o.name_ar, o.name_fr), 'price_delta_usd', o.price_delta_usd) order by o.sort_order, o.id), '[]')
          from public.menu_options o where o.group_id = g.id and o.available))
      order by g.sort_order, g.id)
      from public.menu_option_groups g where g.item_id = i.id), '[]'))
  from public.menu_items i where i.id = p_item_id;
$$;

-- A line's optional groups that can take more, with the options not chosen yet ([] when there is nothing to add).
create function app_private.line_extra_groups(p_line_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('group_id', g.id, 'name', coalesce(g.name_ar, g.name_en, g.name_fr),
      'name_en', coalesce(g.name_en, g.name_ar, g.name_fr), 'room', g.max_select - x.chosen, 'options', x.options)
    order by g.sort_order, g.id), '[]')
  from public.basket_items bi
  join public.menu_option_groups g on g.item_id = bi.item_id and g.min_select = 0
  cross join lateral (
    select (select count(*) from public.menu_options o where o.group_id = g.id and o.id = any (bi.option_ids)) as chosen,
      (select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'name', coalesce(o.name_ar, o.name_en, o.name_fr),
          'name_en', coalesce(o.name_en, o.name_ar, o.name_fr), 'price_delta_usd', o.price_delta_usd) order by o.sort_order, o.id), '[]')
       from public.menu_options o where o.group_id = g.id and o.available and not (o.id = any (bi.option_ids))) as options
  ) x
  where bi.id = p_line_id and x.chosen < g.max_select and jsonb_array_length(x.options) > 0;
$$;
revoke all on function app_private.line_extra_groups(uuid) from public;

-- The open basket's lines of these items whose add-ons have not been offered and that have some to offer (a cart's lines
-- that were added at once because they need no choice).
create function public.basket_lines_with_extras(p_customer_id uuid, p_item_ids uuid[]) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('line_id', bi.id, 'item_id', bi.item_id) order by bi.created_at, bi.id), '[]')
  from public.baskets b
  join public.basket_items bi on bi.basket_id = b.id
  where b.customer_id = p_customer_id and b.status = 'open' and bi.item_id = any (p_item_ids[1:30])
    and bi.extras_offered_at is null and jsonb_array_length(app_private.line_extra_groups(bi.id)) > 0;
$$;

-- The add-ons of one line, offered once: 'offer' with the groups (and the line marked), 'offered' when they were offered
-- before, 'none' when the item has nothing to add, 'not_found' for a line not in the customer's open basket.
create function public.basket_line_extras(p_customer_id uuid, p_line_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_line public.basket_items%rowtype;
  v_groups jsonb;
begin
  select bi.* into v_line from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where bi.id = p_line_id and b.customer_id = p_customer_id and b.status = 'open'
  for update of bi;
  if v_line.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_line.extras_offered_at is not null then
    return jsonb_build_object('status', 'offered');
  end if;
  v_groups := app_private.line_extra_groups(v_line.id);
  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  update public.basket_items set extras_offered_at = now() where id = v_line.id;
  return jsonb_build_object('status', 'offer', 'line_id', v_line.id, 'groups', v_groups,
    'item', (select coalesce(i.name_ar, i.name_en, i.name_fr) from public.menu_items i where i.id = v_line.item_id),
    'item_en', (select coalesce(i.name_en, i.name_ar, i.name_fr) from public.menu_items i where i.id = v_line.item_id));
end;
$$;

-- Adds optional add-ons to a line of the open basket. Each must be an available option of one of the item's optional
-- groups, and no group may go above its maximum. The line is priced by the server (basket_view), never from the tap.
create function public.basket_line_add_options(p_customer_id uuid, p_line_id uuid, p_option_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_line public.basket_items%rowtype;
  v_opts uuid[];
begin
  select bi.* into v_line from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where bi.id = p_line_id and b.customer_id = p_customer_id and b.status = 'open'
  for update of bi;
  if v_line.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_option_ids is null or cardinality(p_option_ids) not between 1 and 10 or exists (
       select 1 from unnest(p_option_ids) x(id) where not exists (
         select 1 from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
         where o.id = x.id and g.item_id = v_line.item_id and g.min_select = 0 and o.available)) then
    return jsonb_build_object('status', 'invalid_option');
  end if;
  v_opts := (select array_agg(distinct x order by x) from unnest(v_line.option_ids || p_option_ids) x);
  if exists (select 1 from public.menu_option_groups g where g.item_id = v_line.item_id
             and (select count(*) from public.menu_options o where o.group_id = g.id and o.id = any (v_opts)) > g.max_select) then
    return jsonb_build_object('status', 'group_full', 'extras', app_private.line_extra_groups(v_line.id));
  end if;
  update public.basket_items set option_ids = v_opts, extras_offered_at = coalesce(extras_offered_at, now())
  where id = v_line.id;
  update public.baskets set last_activity_at = now() where id = v_line.basket_id;
  return jsonb_build_object('status', 'added', 'line_id', v_line.id, 'basket', public.basket_view(p_customer_id),
    'extras', app_private.line_extra_groups(v_line.id));
end;
$$;

-- 3. Item notes (#26) ----------------------------------------------------------------------------------------------------
-- One rule for every note, typed or from the AI: control characters (line breaks, tabs) become one space, the ends are
-- trimmed, an empty note is none.
create function app_private.clean_item_note(p_note text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]+', ' ', 'g')), '');
$$;
revoke all on function app_private.clean_item_note(text) from public;

-- The longest note a line takes (config item_note_max_chars; the column's own limit of 200 stays the hard ceiling).
create function app_private.item_note_max() returns integer
language sql stable security definer set search_path = ''
as $$
  select least(coalesce((public.config_value('item_note_max_chars') #>> '{}')::integer, 200), 200);
$$;
revoke all on function app_private.item_note_max() from public;

-- The note of one line: cleaned, at most item_note_max_chars characters (a longer one is refused, so the customer can
-- shorten it), empty clears it. A note never changes a price (basket_price does not read it).
create function public.basket_line_note(p_customer_id uuid, p_line_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_line uuid;
  v_max integer := app_private.item_note_max();
  v_note text := app_private.clean_item_note(p_note);
begin
  select bi.id into v_line from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where bi.id = p_line_id and b.customer_id = p_customer_id and b.status = 'open'
  for update of bi;
  if v_line is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if char_length(v_note) > v_max then
    return jsonb_build_object('status', 'too_long', 'max', v_max, 'length', char_length(v_note));
  end if;
  update public.basket_items set note = v_note where id = v_line;
  return jsonb_build_object('status', 'saved', 'note', v_note, 'basket', public.basket_view(p_customer_id));
end;
$$;

-- basket_add_item as in 20261016180000_demo_testers.sql (its latest body, with the demo tester check), with the note through the same rule as
-- basket_line_note: cleaned, then cut to item_note_max_chars (a note from the AI is cut, never refused, so the item is
-- still added).
create or replace function public.basket_add_item(
  p_customer_id uuid,
  p_item_id uuid,
  p_quantity integer default 1,
  p_option_ids uuid[] default '{}',
  p_note text default null,
  p_replace boolean default false,
  p_op_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items%rowtype;
  v_vendor public.vendors%rowtype;
  v_basket public.baskets%rowtype;
  v_qty integer := least(greatest(coalesce(p_quantity, 1), 1), 50);
  v_line uuid;
  v_opts uuid[] := coalesce((select array_agg(x order by x) from unnest(coalesce(p_option_ids, '{}')) x), '{}');
  v_note text := left(app_private.clean_item_note(p_note), app_private.item_note_max());
begin
  if p_op_key is not null and exists (select 1 from app_private.basket_add_ops o where o.op_key = p_op_key) then
      -- Already added by an earlier attempt of the same turn: the basket as it is now.
      return jsonb_build_object('status', 'added', 'replayed', true,
        'line_id', (select bi.id from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                    where b.customer_id = p_customer_id and b.status = 'open' and bi.item_id = p_item_id
                    order by bi.created_at desc limit 1),
        'basket', public.basket_view(p_customer_id));
  end if;
  select * into v_item from public.menu_items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('status', 'unknown_item');
  end if;
  select * into v_vendor from public.vendors where id = v_item.vendor_id;
  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if app_private.is_demo_tester(p_customer_id) and not app_private.vendor_is_demo(v_vendor.id) then
    return jsonb_build_object('status', 'demo_only', 'item', coalesce(v_item.name_ar, v_item.name_en),
      'item_en', coalesce(v_item.name_en, v_item.name_ar));
  end if;
  if not app_private.menu_item_orderable(p_item_id, v_qty) then
    return jsonb_build_object('status', 'unavailable', 'item', coalesce(v_item.name_ar, v_item.name_en));
  end if;
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is not null and v_basket.vendor_id <> v_vendor.id then
    if not p_replace then
      return jsonb_build_object('status', 'other_vendor',
        'basket_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id));
    end if;
    update public.baskets set status = 'abandoned' where id = v_basket.id;
    v_basket := null;
  end if;
  if v_basket.id is null then
    insert into public.baskets (customer_id, vendor_id, address_id)
    values (p_customer_id, v_vendor.id,
      (select a.id from public.addresses a where a.customer_id = p_customer_id order by a.is_default desc, a.last_used_at desc nulls last limit 1))
    returning * into v_basket;
  end if;
  select bi.id into v_line from public.basket_items bi
  where bi.basket_id = v_basket.id and bi.item_id = p_item_id and bi.option_ids = v_opts
    and bi.note is not distinct from v_note;
  if v_line is not null then
    update public.basket_items set quantity = least(quantity + v_qty, 50) where id = v_line;
  else
    insert into public.basket_items (basket_id, item_id, quantity, option_ids, note)
    values (v_basket.id, p_item_id, v_qty, v_opts, v_note)
    returning id into v_line;
  end if;
  update public.baskets set last_activity_at = now(), reminded_at = null where id = v_basket.id;
  -- Recorded only now: an add that was refused (unknown, closed, unavailable, other shop) is answered again. Two
  -- calls with one key at the same moment cannot both add: the second hits the primary key and rolls back.
  if p_op_key is not null then
    insert into app_private.basket_add_ops (op_key, customer_id) values (p_op_key, p_customer_id);
  end if;
  return jsonb_build_object('status', 'added', 'line_id', v_line, 'basket', public.basket_view(p_customer_id));
end;
$$;

-- basket_view as in 20261011100100_customer_bot.sql, with each line's note (shown on the basket and the summary) and the
-- longest note allowed.
create or replace function public.basket_view(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_priced jsonb;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return null;
  end if;
  v_priced := public.basket_price(v_basket.id);
  return jsonb_build_object(
    'basket_id', v_basket.id, 'vendor_id', v_basket.vendor_id,
    'vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id),
    'vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_basket.vendor_id),
    'fulfilment', v_basket.fulfilment, 'address_id', v_basket.address_id, 'payment_method', v_basket.payment_method,
    'stairs_floors', v_basket.stairs_floors, 'note', v_basket.customer_note, 'source', v_basket.source,
    'menu_version', v_priced -> 'menu_version', 'subtotal_usd', v_priced -> 'subtotal_usd',
    'unavailable', v_priced -> 'unavailable', 'changed', v_priced -> 'changed',
    'usd_lbp_rate', public.usd_lbp_rate(),
    -- The longest note a line takes (#26), for the bot's question.
    'note_max', app_private.item_note_max(),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('line_id', bi.id, 'item_id', bi.item_id, 'name', coalesce(i.name_ar, i.name_en, i.name_fr),
        'name_en', coalesce(i.name_en, i.name_ar), 'quantity', bi.quantity, 'unit_price_usd', bi.unit_price_usd,
        'line_total_usd', bi.line_total_usd, 'estimated', i.pricing_unit = 'kg', 'needs_empty_answer',
        i.container_deposit_usd is not null and bi.has_empty is null, 'deposit_usd', i.container_deposit_usd, 'has_empty', bi.has_empty,
        'options', (select coalesce(jsonb_agg(coalesce(o.name_ar, o.name_en)), '[]') from public.menu_options o where o.id = any (bi.option_ids)),
        'note', bi.note)
        order by bi.created_at, bi.id)
      from public.basket_items bi join public.menu_items i on i.id = bi.item_id where bi.basket_id = v_basket.id), '[]')
  );
end;
$$;

-- 4. Change for cash (#35) and the tip at checkout (#38) -----------------------------------------------------------------
-- A tip goes to whoever delivers, and this pilot takes it in cash at the door: a delivery paid cash, not a gift (the
-- recipient pays a gift, §22.2).
create function app_private.basket_tip_applies(p_basket_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select b.payment_method = 'cod' and b.fulfilment = 'delivery' and not coalesce(b.is_gift, false)
  from public.baskets b where b.id = p_basket_id;
$$;
revoke all on function app_private.basket_tip_applies(uuid) from public;

-- What checkout shows after the cash currency, from the server's quote: the tip and the total with it in USD and LBP at
-- today's rate (locked at order), the tip amounts to offer, and the change question. change: null = not asked (not cash,
-- pickup, a gift, no currency yet, or no configured note above the total); 'ask' with the note amounts above the total;
-- 'set' with the answer (change_for null = exact cash) and the change to bring. p_total_usd and p_usd_lbp_rate are the
-- total and rate of the basket_quote the dispatch function made a moment before in the same checkout, so the basket is not
-- quoted twice; without them it quotes. They only shape what is shown: the order's tip and change are re-checked against
-- the order's own total when it is placed (orders_copy_after_cart).
create function public.basket_checkout_extras(p_customer_id uuid, p_total_usd numeric default null,
  p_usd_lbp_rate numeric default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_q jsonb;
  v_rate numeric;
  v_applies boolean;
  v_tip numeric := 0;
  v_total numeric;
  v_total_cur numeric;
  v_opts numeric[];
  v_change jsonb;
begin
  select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_b.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if p_total_usd is not null and p_total_usd >= 0 and p_usd_lbp_rate > 0 then
    v_q := jsonb_build_object('status', 'ok', 'total_usd', p_total_usd, 'usd_lbp_rate', p_usd_lbp_rate);
  else
    v_q := public.basket_quote(p_customer_id);
  end if;
  if v_q ->> 'status' is distinct from 'ok' then
    return jsonb_build_object('status', coalesce(v_q ->> 'status', 'unknown'));
  end if;
  v_rate := (v_q ->> 'usd_lbp_rate')::numeric;
  v_applies := app_private.basket_tip_applies(v_b.id);
  if v_applies then
    v_tip := coalesce(v_b.tip_usd, 0);
  end if;
  v_total := (v_q ->> 'total_usd')::numeric + v_tip;
  if v_applies and v_b.cash_currency is not null then
    v_total_cur := case v_b.cash_currency when 'USD' then v_total else round(v_total * v_rate, 0) end;
    v_opts := (select coalesce(array_agg(x order by x), '{}')
               from unnest(app_private.config_amounts(case v_b.cash_currency when 'USD' then 'cash_change_options_usd'
                                                                           else 'cash_change_options_lbp' end)) x
               where x > v_total_cur);
    if v_b.cash_change_currency = v_b.cash_currency
       and (v_b.cash_change_for is null or v_b.cash_change_for > v_total_cur) then
      v_change := jsonb_build_object('status', 'set', 'currency', v_b.cash_currency, 'total', v_total_cur,
        'change_for', v_b.cash_change_for, 'change_due', v_b.cash_change_for - v_total_cur);
    elsif cardinality(v_opts) > 0 then
      v_change := jsonb_build_object('status', 'ask', 'currency', v_b.cash_currency, 'total', v_total_cur,
        'options', to_jsonb(v_opts));
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'tip_usd', v_tip,
    'tip_amounts', case when v_applies then to_jsonb(app_private.config_amounts('tip_amounts_usd')) else '[]'::jsonb end,
    'total_usd', v_total, 'total_lbp', round(v_total * v_rate, 0), 'usd_lbp_rate', v_rate, 'change', v_change);
end;
$$;

-- "Do you need change?": exact (p_amount null) or one of the configured note amounts of the basket's cash currency. A tap
-- for another currency than the basket's (the customer changed it since) is stale.
create function public.basket_set_cash_change(p_customer_id uuid, p_currency text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
begin
  select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if not app_private.basket_tip_applies(v_b.id) or v_b.cash_currency is null then
    return jsonb_build_object('status', 'not_applicable');
  end if;
  if p_currency is distinct from v_b.cash_currency then
    return jsonb_build_object('status', 'stale', 'currency', v_b.cash_currency);
  end if;
  if p_amount is not null and not (p_amount = any (app_private.config_amounts(
       case p_currency when 'USD' then 'cash_change_options_usd' else 'cash_change_options_lbp' end))) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  update public.baskets set cash_change_for = p_amount, cash_change_currency = p_currency, last_activity_at = now()
  where id = v_b.id;
  return jsonb_build_object('status', 'ok', 'currency', p_currency, 'change_for', p_amount);
end;
$$;

-- The tip at checkout: one of tip_amounts_usd, or 0 for none. Only when the tip applies.
create function public.basket_set_tip(p_customer_id uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
begin
  select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if not app_private.basket_tip_applies(v_b.id) then
    return jsonb_build_object('status', 'not_applicable');
  end if;
  if coalesce(p_amount, 0) = 0 then
    update public.baskets set tip_usd = null, last_activity_at = now() where id = v_b.id;
    return jsonb_build_object('status', 'ok', 'tip_usd', 0);
  end if;
  if not (p_amount = any (app_private.config_amounts('tip_amounts_usd'))) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  update public.baskets set tip_usd = p_amount, last_activity_at = now() where id = v_b.id;
  return jsonb_build_object('status', 'ok', 'tip_usd', p_amount);
end;
$$;

-- The order carries the basket's tip and change answer (read from the basket itself: this trigger may run before the
-- ones that copy the gift and the cash currency). A tip that no longer applies or is no longer configured, and a change
-- answer for another currency or not above what the customer pays, are left behind.
create function app_private.orders_copy_after_cart() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_pay numeric;
begin
  if new.basket_id is null then
    return new;
  end if;
  select * into v_b from public.baskets where id = new.basket_id;
  if v_b.id is null or not app_private.basket_tip_applies(v_b.id) then
    return new;
  end if;
  if coalesce(v_b.tip_usd, 0) > 0 and v_b.tip_usd = any (app_private.config_amounts('tip_amounts_usd')) then
    new.tip_usd := v_b.tip_usd;
    new.tip_source := 'checkout';
    new.tip_status := 'promised';
    new.tip_at := now();
  end if;
  if v_b.cash_change_currency is not null and v_b.cash_change_currency = v_b.cash_currency then
    v_pay := case v_b.cash_change_currency when 'USD' then new.total_usd + new.tip_usd
                                           else round((new.total_usd + new.tip_usd) * new.usd_lbp_rate, 0) end;
    if v_b.cash_change_for is null or v_b.cash_change_for > v_pay then
      new.cash_change_for := v_b.cash_change_for;
      new.cash_change_currency := v_b.cash_change_currency;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.orders_copy_after_cart() from public;
create trigger orders_copy_after_cart before insert on public.orders
  for each row execute function app_private.orders_copy_after_cart();

-- 5. The tip in the ledger (§20.3: one append-only ledger, balances are views) --------------------------------------------
-- Whoever delivered: the merchant in merchant mode (§27.8 #18), else the driver on the order. (A fleet or partner order
-- without a driver gets an account of its own; the fleet session gives drivers their own identity, LOG.)
create function app_private.tip_deliverer(p_order_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case when o.delivery_mode is null or o.delivery_mode = 'merchant' then 'vendor:' || o.vendor_id
              when o.driver_member_id is not null then 'driver:' || o.driver_member_id
              else 'delivery:' || o.delivery_mode || ':' || o.id end
  from public.orders o where o.id = p_order_id;
$$;
revoke all on function app_private.tip_deliverer(uuid) from public;

-- One 'tip' transaction per order, at the order's locked rate, booked only once whoever delivered confirmed they have the
-- cash (tip_status 'collected'). Cash (the only way to pay in the pilot): they received it (driver_cash), it is owed to
-- them in full (tips_payable), and they keep it (both legs net to zero, so no custody balance is left open). The online
-- path (Whish or Tap, §20.1) books it against the gateway when it goes live. Idempotent on 'tip:<order>'.
create function app_private.tip_book(p_order_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_ref text;
  v_cash uuid;
  v_owed uuid;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.id is null or v_o.tip_usd <= 0 or v_o.tip_status is distinct from 'collected' or v_o.status <> 'delivered'
     or v_o.payment_method <> 'cod' then
    return null;
  end if;
  v_ref := app_private.tip_deliverer(v_o.id);
  v_cash := public.ledger_account('driver_cash', 'USD', null, v_ref);
  v_owed := public.ledger_account('tips_payable', 'USD', null, v_ref);
  return public.ledger_post('tip', 'tip:' || v_o.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'amount', v_o.tip_usd,
        'memo', 'tip received in cash by whoever delivered order ' || v_o.code || ' (they confirmed it)'),
      jsonb_build_object('account_id', v_owed, 'amount', -v_o.tip_usd, 'memo', 'tip owed in full to whoever delivered order ' || v_o.code),
      jsonb_build_object('account_id', v_owed, 'amount', v_o.tip_usd, 'memo', 'tip kept by whoever delivered order ' || v_o.code),
      jsonb_build_object('account_id', v_cash, 'amount', -v_o.tip_usd, 'memo', 'the tip cash stays with them, order ' || v_o.code)),
    v_o.id, v_o.usd_lbp_rate, 'tip (' || v_o.tip_source || ', confirmed by whoever delivered)',
    jsonb_build_object('deliverer', v_ref, 'source', v_o.tip_source, 'method', v_o.payment_method,
      'confirmed_by', v_o.tip_collected_by));
end;
$$;
revoke all on function app_private.tip_book(uuid) from public;

-- Tells whoever delivered about a promised tip on WhatsApp, with "✅ Got it" (outbox purpose 'tip'): the order's driver when
-- one is assigned, else the merchant's WhatsApp channel (merchant mode). Once per order (dedupe key).
create function app_private.tip_notify(p_order_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_to text;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.id is null or v_o.tip_status is distinct from 'promised' then
    return null;
  end if;
  if v_o.driver_member_id is not null then
    select m.phone_e164 into v_to from public.vendor_members m where m.id = v_o.driver_member_id and m.status = 'active';
  end if;
  if v_to is null then
    select c.backup_target into v_to from app_private.vendor_channels(v_o.vendor_id) c;
  end if;
  if v_to is null then
    return null;
  end if;
  return app_private.outbox_add('tip:' || v_o.id, v_o.id, v_o.vendor_id, 'whatsapp', 'tip', v_to,
    jsonb_build_object('order_id', v_o.id, 'code', v_o.code, 'tip_usd', v_o.tip_usd, 'source', v_o.tip_source));
end;
$$;
revoke all on function app_private.tip_notify(uuid) from public;

-- A checkout tip comes with the cash at the door: when the order is delivered, whoever delivered is asked to confirm they
-- have it (the delivered tap records no cash, so the tip is never booked from it). A cancelled or failed order takes none.
create function app_private.orders_tip_at_delivery() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.tip_status = 'promised' then
    perform app_private.tip_notify(new.id);
  end if;
  return null;
end;
$$;
revoke all on function app_private.orders_tip_at_delivery() from public;
create trigger orders_tip_at_delivery after update of status on public.orders
  for each row execute function app_private.orders_tip_at_delivery();

-- "✅ Got it" from whoever delivered: the caller (by the WhatsApp number the tap came from) must be an active member of the
-- order's shop or the order's driver. Books the tip once; a second tap books nothing more.
create function public.order_tip_confirm(p_order_id uuid, p_phone_e164 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_member uuid;
  v_tx uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select m.id into v_member from public.vendor_members m
  where m.phone_e164 = p_phone_e164 and m.status = 'active'
    and (m.vendor_id = v_o.vendor_id or m.id = v_o.driver_member_id)
  order by (m.id = v_o.driver_member_id) desc limit 1;
  if v_member is null then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  if v_o.tip_status = 'collected' then
    return jsonb_build_object('status', 'already', 'tip_usd', v_o.tip_usd, 'code', v_o.code);
  end if;
  if v_o.tip_status is distinct from 'promised' then
    return jsonb_build_object('status', 'no_tip', 'code', v_o.code);
  end if;
  if v_o.status <> 'delivered' then
    return jsonb_build_object('status', 'not_delivered', 'code', v_o.code);
  end if;
  update public.orders set tip_status = 'collected', tip_collected_at = now(), tip_collected_by = v_member
  where id = v_o.id;
  v_tx := app_private.tip_book(v_o.id);
  return jsonb_build_object('status', 'collected', 'tip_usd', v_o.tip_usd, 'code', v_o.code, 'ledger_tx', v_tx);
end;
$$;

-- 6. The tip after delivery (#38) ----------------------------------------------------------------------------------------
-- Whether a delivered order may still take a tip: delivered to the door, paid cash, not a gift, no tip yet, within
-- tip_after_delivery_minutes. With p_mark the question counts as asked (once per order).
create function public.order_tip_offer(p_customer_id uuid, p_order_id uuid, p_mark boolean default true) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_amounts numeric[] := app_private.config_amounts('tip_amounts_usd');
begin
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_o.tip_usd > 0 then
    return jsonb_build_object('status', 'tipped', 'tip_usd', v_o.tip_usd);
  end if;
  if v_o.status <> 'delivered' or v_o.fulfilment <> 'delivery' or v_o.payment_method <> 'cod' or v_o.is_gift then
    return jsonb_build_object('status', 'not_applicable');
  end if;
  if now() > coalesce(v_o.delivered_at, v_o.closed_at, v_o.updated_at)
             + make_interval(mins => public.config_numeric('tip_after_delivery_minutes')::integer) then
    return jsonb_build_object('status', 'too_late');
  end if;
  if cardinality(v_amounts) = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  if p_mark then
    if v_o.tip_offered_at is not null then
      return jsonb_build_object('status', 'offered');
    end if;
    update public.orders set tip_offered_at = now() where id = v_o.id;
  end if;
  return jsonb_build_object('status', 'offer', 'order_id', v_o.id, 'code', v_o.code, 'amounts', to_jsonb(v_amounts),
    'max_usd', public.config_numeric('tip_max_usd'));
end;
$$;

-- The tip after delivery: one of tip_amounts_usd, or "Other" above zero, in cents, up to tip_max_usd. It is PROMISED: the
-- customer hands it over in cash, so whoever delivered is told at once and the ledger books it only on their "Got it".
create function public.order_tip_set(p_customer_id uuid, p_order_id uuid, p_amount numeric, p_other boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_state jsonb := public.order_tip_offer(p_customer_id, p_order_id, false);
  v_max numeric := public.config_numeric('tip_max_usd');
begin
  if v_state ->> 'status' = 'tipped' then
    return jsonb_build_object('status', 'already_tipped', 'tip_usd', v_state -> 'tip_usd');
  end if;
  if v_state ->> 'status' <> 'offer' then
    return v_state;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or not (p_amount = any (app_private.config_amounts('tip_amounts_usd')) or (coalesce(p_other, false) and p_amount <= v_max)) then
    return jsonb_build_object('status', 'not_allowed', 'max_usd', v_max);
  end if;
  update public.orders set tip_usd = p_amount, tip_source = 'after_delivery', tip_status = 'promised', tip_at = now()
  where id = p_order_id;
  return jsonb_build_object('status', 'promised', 'tip_usd', p_amount,
    'told', app_private.tip_notify(p_order_id) is not null);
end;
$$;

-- 7. The order card: the tip, what to collect and the change to bring ----------------------------------------------------
-- As in 20261015220000_demo_mode.sql, plus the tip (§27.8 #18), the cash to collect (total + tip, both currencies at the
-- locked rate) and the change answer with the change to bring (§27.8 #17), all computed here.
create or replace function app_private.order_card_payload(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id, 'code', o.code, 'status', o.status, 'fulfilment', o.fulfilment,
    'payment_method', o.payment_method, 'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'), 'is_new_customer', o.is_new_customer,
    'customer_note', o.customer_note, 'prep_minutes', o.prep_minutes,
    'is_gift', o.is_gift, 'recipient_name', o.recipient_name, 'recipient_phone', o.recipient_phone, 'allergy_note', o.allergy_note,
    'area_en', p.name_en, 'area_ar', p.name_ar,
    'vendor_name', coalesce(v.name_ar, v.name_en),
    'demo', app_private.vendor_is_demo(v.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', i.name_en,
        'quantity', i.quantity, 'options', (select coalesce(jsonb_agg(coalesce(x ->> 'name_ar', x ->> 'name_en')), '[]') from jsonb_array_elements(i.options) x),
        'kg', i.est_weight_kg, 'has_empty', i.has_empty, 'note', i.note) order by i.created_at, i.id)
      from public.order_items i where i.order_id = o.id), '[]')
  ) || jsonb_build_object(
    'tip_usd', o.tip_usd,
    'collect_usd', o.total_usd + o.tip_usd,
    'collect_lbp', round((o.total_usd + o.tip_usd) * o.usd_lbp_rate, 0),
    'cash_currency', o.cash_currency,
    'cash_change_for', o.cash_change_for,
    'cash_change_currency', o.cash_change_currency,
    'change_due', case when o.cash_change_for is not null then o.cash_change_for - case o.cash_change_currency
        when 'USD' then o.total_usd + o.tip_usd else round((o.total_usd + o.tip_usd) * o.usd_lbp_rate, 0) end end)
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  left join public.places p on p.id = o.delivery_place_id
  where o.id = p_order_id;
$$;

-- 8. Product carousel (§39.15.2) ---------------------------------------------------------------------------------------------
-- "Popular near you": the best seller of each of these shops (the delivering shops the bot just listed) over
-- catalog_best_sellers_days, the shops with the most-ordered first, only items the catalogue shows, at most 10 (Meta's
-- carousel). carousel: whether a carousel may be sent (config carousel_enabled).
create function public.popular_near_you(p_vendor_ids uuid[], p_catalog_id text, p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with sold as (
    select oi.item_id, o.vendor_id, sum(oi.quantity) as n
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.vendor_id = any (p_vendor_ids[1:40]) and o.status not in ('cancelled', 'rejected', 'failed')
      and o.created_at > now() - make_interval(days => public.config_numeric('catalog_best_sellers_days')::int)
      and oi.item_id is not null
    group by oi.item_id, o.vendor_id
  ),
  best as (
    select distinct on (s.vendor_id) s.vendor_id, s.item_id, s.n
    from sold s
    join public.vendors v on v.id = s.vendor_id
    where v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
      and app_private.menu_item_orderable(s.item_id, 1) and app_private.catalog_item_shown(s.item_id, p_catalog_id)
    order by s.vendor_id, s.n desc, s.item_id
  ),
  picked as (
    select * from best order by n desc, item_id limit least(greatest(coalesce(p_limit, 10), 1), 10)
  )
  select jsonb_build_object(
    'carousel', coalesce(public.config_value('carousel_enabled') = 'true'::jsonb, false),
    'products', coalesce((select jsonb_agg(jsonb_build_object('retailer_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'price_usd', case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
        'vendor_id', v.id, 'section', coalesce(v.name_ar, v.name_en), 'section_en', coalesce(v.name_en, v.name_ar))
        order by t.n desc, t.item_id)
      from picked t join public.menu_items i on i.id = t.item_id join public.vendors v on v.id = t.vendor_id), '[]'));
$$;

-- "Goes well with" after a cart arrives: the one chat upsell of an order (§29.3), by basket_upsell's rule (the shop's items
-- bought together with the basket's in at least two delivered orders, not in the basket, orderable; never on a reorder),
-- only items the catalogue shows, at most goes_well_max_items. The basket counts as offered (basket_upsell then offers
-- nothing more) only when something is returned.
create function public.basket_goes_well(p_customer_id uuid, p_catalog_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_products jsonb;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null or v_basket.upsell_shown_at is not null or v_basket.source = 'reorder' then
    return jsonb_build_object('status', 'none');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('retailer_id', i.id, 'name', coalesce(i.name_ar, i.name_en),
      'name_en', coalesce(i.name_en, i.name_ar), 'name_ar', i.name_ar,
      'price_usd', case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end)
      order by p.n desc, p.item_id), '[]')
    into v_products
  from (
    select oi2.item_id, count(*) as n
    from public.basket_items bi
    join public.order_items oi on oi.item_id = bi.item_id
    join public.orders o on o.id = oi.order_id and o.status = 'delivered' and o.vendor_id = v_basket.vendor_id
    join public.order_items oi2 on oi2.order_id = o.id and oi2.item_id <> bi.item_id
    where bi.basket_id = v_basket.id
      and oi2.item_id not in (select item_id from public.basket_items where basket_id = v_basket.id)
      and app_private.menu_item_orderable(oi2.item_id, 1)
      and app_private.catalog_item_shown(oi2.item_id, p_catalog_id)
    group by oi2.item_id
    having count(*) >= 2
    order by count(*) desc, oi2.item_id
    limit greatest(public.config_numeric('goes_well_max_items')::int, 1)
  ) p
  join public.menu_items i on i.id = p.item_id;
  if jsonb_array_length(v_products) = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  update public.baskets set upsell_shown_at = now() where id = v_basket.id;
  return jsonb_build_object('status', 'ok', 'products', v_products,
    'carousel', coalesce(public.config_value('carousel_enabled') = 'true'::jsonb, false));
end;
$$;

-- 9. Access: the dispatch function (service role) only --------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.item_choice_groups(uuid)',
    'public.basket_lines_with_extras(uuid, uuid[])',
    'public.basket_line_extras(uuid, uuid)',
    'public.basket_line_add_options(uuid, uuid, uuid[])',
    'public.basket_line_note(uuid, uuid, text)',
    'public.basket_checkout_extras(uuid, numeric, numeric)',
    'public.basket_set_cash_change(uuid, text, numeric)',
    'public.basket_set_tip(uuid, numeric)',
    'public.order_tip_offer(uuid, uuid, boolean)',
    'public.order_tip_set(uuid, uuid, numeric, boolean)',
    'public.order_tip_confirm(uuid, text)',
    'public.popular_near_you(uuid[], text, integer)',
    'public.basket_goes_well(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- The ledger's account rule: tips_payable is per deliverer, like driver_cash (external_ref = 'vendor:<id>' or 'driver:<id>').
alter table public.ledger_accounts drop constraint ledger_accounts_external_kinds;
alter table public.ledger_accounts add constraint ledger_accounts_external_kinds check (
  (kind in ('driver_cash', 'partner_cod_receivable', 'tips_payable')) = (external_ref is not null)
);

-- 10. Scale (DECISIONS §39.14 rule 2): "Popular near you" and "Goes well with" read a shop's recent orders and an item's
-- orders through indexes, never a table scan. (order_items_item_idx has this name and columns in part 4 too.)
create index if not exists orders_vendor_created_idx on public.orders (vendor_id, created_at)
  where status not in ('cancelled', 'rejected', 'failed');
create index if not exists order_items_item_idx on public.order_items (item_id, order_id);
