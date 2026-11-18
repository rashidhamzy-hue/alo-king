-- Alo King Chouf, session FD2 (ordering food from places, end to end), migration 0249 of 0249 to 0251.
-- docs/DECISIONS.md, "FD2, ordering food from places, 18 November 2026". FD1 (0245 to 0247) made places, their approved dishes with option
-- groups, the tester list and place_orderable_for(). This migration lets a customer order a dish the same way they order groceries:
--
--   1 the quote knows the customer   quote_order gains p_party (last, default null). With a party, a dish is orderable when its place is
--                                    orderable for that customer (product_orderable_for, 0245); without one, only public places, as before.
--                                    Every caller that has a customer passes it: the order, the turn's card, the basket of an order, the
--                                    confirm tap's re-check (order_quote_issues), and the chat (packages/agents).
--   2 a dish's choices               a dish line carries options: [option ids]. dish_choice() checks them against the dish's own groups
--                                    (0205, FD1): every required group answered (at least min, at most max), no unknown option. The unit
--                                    price is the dish's price plus the chosen options' price changes, all from the database (invariant 7).
--                                    A required choice not made is issue choice_required with the group and its options: no card goes out
--                                    until it is answered. The chosen options are stored on the order item (order_items.options).
--   3 one shop per order             our store is a shop and each place is a shop. A quote whose lines come from two shops is issue
--                                    mixed_shops (no card). A new card cancels only the waiting cards of the SAME shop, so a grocery card
--                                    and a food card can wait side by side as two orders.
--   4 the place's hours              place_open_now(): approved and open, not a day off, not marked closed today (sources.closed_on, set when
--                                    staff find it closed, 0250), inside its opening and closing time (Asia/Beirut, a close past midnight
--                                    allowed). Closed means not orderable: issue place_closed, also re-checked at the confirm tap.
--   5 the arrival estimate           a food quote's eta_minutes is the place's preparation time plus the ride from the place's village to the
--                                    customer's (travel_minutes), else the zone's own estimate. Status messages use it.
--   6 the food service fee           settings.food.service_fee_usd (0 today; FD1) on a food order: its own column (orders.service_fee_usd),
--                                    its own line on the card when above 0, in the total, and company income in the ledger
--                                    (revenue_food_service). The delivery fee stays the zone's and belongs to whoever delivers (invariant 10).
--   7 cash for food                  a food order is cash on delivery (FD2 decision 7): issue food_cash_only otherwise.
--   8 finding dishes                 place aliases (the names customers use, set on the Places page), food_places_named() (a place named in
--                                    the customer's words, orderable for them or not), place_menu() and food_match() (a dish by its name on
--                                    one place's approved menu, with the options named in the same words). Never another shop's product.
-- Models propose, the database disposes (invariant 3): nothing here writes stock or the ledger outside post_cod_collection; the order is made
-- by create_order_from_quote as before; the agent still only reaches awaiting_confirmation (invariant 4).

alter type account_kind add value if not exists 'revenue_food_service';

-- ---------- 6: the fee's column, in the total (0052's generated column, with the fee) ----------
alter table orders add column if not exists service_fee_usd numeric(8,2) not null default 0 check (service_fee_usd >= 0);
alter table orders drop column total_usd;
alter table orders add column total_usd numeric(10,2) generated always as
  (subtotal_usd + delivery_fee_usd + small_order_fee_usd + service_fee_usd + tip_usd + dues_usd) stored;
comment on column orders.service_fee_usd is 'FD2. The food service fee (settings.food.service_fee_usd) on a food order: company income (revenue_food_service), never the rider''s.';

-- ---------- 2: the options chosen, on the item ----------
alter table order_items add column if not exists options jsonb not null default '[]';
comment on column order_items.options is 'FD2. The dish options chosen: [{id, group_id, group_en, group_ar, name_en, name_ar, price_delta_usd}] as quoted; unit_price_usd includes their price changes.';

-- ---------- 4 and 8: the place's own columns ----------
alter table sources add column if not exists closed_on date;
alter table sources add column if not exists place_aliases text[] not null default '{}';
comment on column sources.closed_on is 'FD2. Staff found the place closed on this day (the call ahead, 0250): not orderable for the rest of that day.';
comment on column sources.place_aliases is 'FD2. Other names customers use for a place («صفا», "safa"), set on the Places page. Matching only; never shown as its name.';

-- ---------- 4 ----------
create or replace function place_open_now(p_source uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare s sources%rowtype; v_tz text := coalesce(setting('hours')->>'tz', 'Asia/Beirut'); v_local timestamp; v_t time; v_day text;
        v_open time; v_close time; v_ok boolean;
begin
  select * into s from sources where id = p_source;
  if not found then return jsonb_build_object('open', false, 'reason', 'unknown'); end if;
  v_local := now() at time zone v_tz;
  v_day := lower(to_char(v_local, 'dy'));
  v_t := v_local::time;
  v_open := nullif(s.hours->>'open', '')::time;
  v_close := nullif(s.hours->>'close', '')::time;
  if not s.is_open or s.approved_at is null then
    return jsonb_build_object('open', false, 'reason', 'not_open', 'opens', s.hours->>'open', 'closes', s.hours->>'close');
  end if;
  if s.closed_on = v_local::date then
    return jsonb_build_object('open', false, 'reason', 'closed_today', 'opens', s.hours->>'open', 'closes', s.hours->>'close');
  end if;
  if coalesce(s.hours->'days_off', '[]'::jsonb) ? v_day then
    return jsonb_build_object('open', false, 'reason', 'day_off', 'opens', s.hours->>'open', 'closes', s.hours->>'close');
  end if;
  v_ok := case when v_open is not null and v_close is not null then
                 case when v_open = v_close then true                -- the same time: open all day
                      when v_open < v_close then v_t >= v_open and v_t < v_close else v_t >= v_open or v_t < v_close end
               when v_open is not null then v_t >= v_open
               when v_close is not null then v_t < v_close
               else true end;
  return jsonb_build_object('open', v_ok, 'reason', case when v_ok then null else 'hours' end, 'opens', s.hours->>'open', 'closes', s.hours->>'close');
end $$;

-- ---------- 2 ----------
-- One option group with its options, as the chat asks it and the website will show it.
create or replace function dish_group_json(p_group uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('group_id', g.id, 'name_en', g.name_en, 'name_ar', g.name_ar, 'required', g.required,
           'min', g.min_choices, 'max', g.max_choices,
           'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name_en', o.name_en, 'name_ar', o.name_ar,
                                                                    'price_delta_usd', o.price_delta_usd) order by o.sort_order, o.name_en)
                                  from dish_options o where o.group_id = g.id), '[]'::jsonb))
    from dish_option_groups g where g.id = p_group $$;

-- The options chosen for one dish, checked against its own groups. needs: required groups not yet answered (each with its options);
-- open: optional groups nothing was chosen from (the chat may offer each once); unknown: ids that are not this dish's options; too_many: a
-- group with more than its maximum. ok only when needs, unknown and too_many are all empty. delta_usd: the sum of the chosen price changes.
create or replace function dish_choice(p_product uuid, p_options jsonb) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_ids uuid[]; v_unknown int; v_chosen jsonb; v_delta numeric; g record; v_needs jsonb := '[]'::jsonb; v_open jsonb := '[]'::jsonb;
        v_many jsonb := '[]'::jsonb;
begin
  select coalesce(array_agg(distinct x::uuid), '{}') into v_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) x
   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  select count(*) into v_unknown from unnest(v_ids) i
   where not exists (select 1 from dish_options o join dish_option_groups gg on gg.id = o.group_id where o.id = i and gg.product_id = p_product);
  v_unknown := v_unknown + coalesce((select count(*) from jsonb_array_elements_text(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) x
                                      where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), 0);
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group_id', gg.id, 'group_en', gg.name_en, 'group_ar', gg.name_ar,
                                               'name_en', o.name_en, 'name_ar', o.name_ar, 'price_delta_usd', o.price_delta_usd)
                            order by gg.sort_order, o.sort_order, o.name_en), '[]'::jsonb),
         coalesce(sum(o.price_delta_usd), 0)
    into v_chosen, v_delta
    from dish_options o join dish_option_groups gg on gg.id = o.group_id where gg.product_id = p_product and o.id = any(v_ids);
  for g in select gg.id, gg.min_choices, gg.max_choices,
                  (select count(*) from dish_options o where o.group_id = gg.id and o.id = any(v_ids)) as n
             from dish_option_groups gg where gg.product_id = p_product order by gg.sort_order, gg.name_en loop
    if g.n < g.min_choices then v_needs := v_needs || dish_group_json(g.id);
    elsif g.n = 0 then v_open := v_open || dish_group_json(g.id);
    end if;
    if g.n > g.max_choices then v_many := v_many || jsonb_build_object('group_id', g.id, 'max', g.max_choices, 'chosen', g.n); end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_needs) = 0 and v_unknown = 0 and jsonb_array_length(v_many) = 0,
    'chosen', v_chosen, 'delta_usd', v_delta, 'needs', v_needs, 'open', v_open, 'unknown', v_unknown, 'too_many', v_many);
end $$;

-- The canonical key of a line: the product and its chosen options, sorted. Two lines of one dish with different options are two lines.
create or replace function line_key(p_product text, p_options jsonb) returns text language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_product, '') || ':' || coalesce((select string_agg(x, ',' order by x)
                                                       from jsonb_array_elements_text(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) x), '') $$;

-- ---------- 1, 2, 3, 4, 5, 6: quote_order (0226's text, with the customer, the dish's choices, one shop, the place's hours, the arrival
-- estimate and the food service fee). The old signature is replaced by one with p_party last, so every existing call still works. ----------
drop function if exists quote_order(jsonb, uuid, boolean, uuid);
create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false, p_slot uuid default null,
                                       p_party uuid default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric := 0; v_eta int; v_small numeric := 0; v_sof jsonb := setting('small_order_fee');
        v_fx numeric := current_fx(); v_hours jsonb := setting('hours'); v_now time; v_min numeric := (setting('min_order_usd'))::text::numeric;
        o record; v_free numeric; v_qty numeric; v_ok boolean; v_subs jsonb; v_served boolean;
        v_later boolean := p_slot is not null; v_fresh boolean := false; v_restaurant boolean := false; v_state text;
        v_shops jsonb := '{}'::jsonb; v_place uuid; c jsonb; v_unit numeric; v_svc numeric := 0; v_open jsonb; v_ride numeric; v_prep int;
        v_food boolean := false;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 1);
    select p.id, p.sku, p.name_en, p.name_ar, p.category, p.sub_type, p.sell_unit, ofr.price_usd, ofr.is_available,
           s.id as source_id, s.name as source_name, s.kind, s.is_open, s.buys_for_customer,
           coalesce(l.on_hand - l.reserved, 0) as free,
           (s.kind = 'dark_store' and p.storage::text = any(bought_to_order_zones())) as bto
      into o
      from products p join offers ofr on ofr.product_id = p.id join sources s on s.id = ofr.source_id
      left join stock_levels l on l.product_id = p.id and l.source_id = s.id
     where p.id = (ln->>'product_id')::uuid and p.is_active
       and ((ln->>'source_id') is null or s.id = (ln->>'source_id')::uuid)
     order by (s.kind = 'dark_store') desc, ofr.price_usd limit 1;
    if not found then
      v_issues := v_issues || jsonb_build_object('code', 'unknown_product', 'product_id', ln->>'product_id');
      continue;
    end if;
    -- FD2 (3): every shop the basket draws on, by id.
    v_shops := v_shops || jsonb_build_object(o.source_id::text, jsonb_build_object('source_id', o.source_id, 'name', o.source_name,
                 'kind', case when o.kind = 'dark_store' then 'hub' when o.buys_for_customer then 'place' else 'merchant' end));
    -- SELL1 (0226), FD1 and FD2 (1): not for sale to this customer (a packaged item without its label, or a dish of a place this customer
    -- cannot order from): named (coming_soon), not ok, nothing added, no stock or substitute looked at.
    if not product_orderable_for(o.id, p_party) then
      v_issues := v_issues || jsonb_build_object('code', 'coming_soon', 'product_id', o.id, 'name', o.name_en);
      v_lines := v_lines || jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                   'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', o.price_usd, 'line_total_usd', round(o.price_usd * v_qty, 2),
                   'source_id', o.source_id, 'source', o.source_name, 'ok', false, 'coming_soon', true, 'bought_to_order', false,
                   'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', ln->>'note', 'raw', ln->>'raw', 'options', '[]'::jsonb);
      continue;
    end if;
    if o.kind <> 'dark_store' then v_restaurant := true; end if;
    if o.bto then v_fresh := true; end if;
    -- FD2 (2): a dish's price is its own plus the options chosen; a required choice not made holds the card.
    v_unit := o.price_usd; c := null;
    if o.kind = 'merchant' then
      c := dish_choice(o.id, coalesce(ln->'options', '[]'::jsonb));
      v_unit := o.price_usd + coalesce((c->>'delta_usd')::numeric, 0);
      if jsonb_array_length(c->'needs') > 0 then
        v_issues := v_issues || jsonb_build_object('code', 'choice_required', 'product_id', o.id, 'name', o.name_en, 'name_ar', o.name_ar,
                                                   'key', line_key(o.id::text, coalesce(ln->'options', '[]'::jsonb)), 'groups', c->'needs');
      end if;
      if (c->>'unknown')::int > 0 or jsonb_array_length(c->'too_many') > 0 then
        v_issues := v_issues || jsonb_build_object('code', 'option_invalid', 'product_id', o.id, 'name', o.name_en, 'too_many', c->'too_many');
      end if;
      if o.buys_for_customer then v_food := true; v_place := o.source_id; end if;
    end if;
    v_free := case when o.kind = 'dark_store' and v_later and o.bto and o.is_available then greatest(o.free, v_qty)   -- bought for the window
                   when o.kind = 'dark_store' then o.free when o.is_available and o.is_open then 999 else 0 end;
    v_ok := v_free >= v_qty;
    v_subs := '[]'::jsonb;
    if not v_ok then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_subs from (
        select p2.id as product_id, p2.name_en, p2.name_ar, p2.brand, o2.price_usd
        from products p2 join offers o2 on o2.product_id = p2.id and o2.source_id = o.source_id
        join stock_levels l2 on l2.product_id = p2.id and l2.source_id = o.source_id
        where p2.id <> o.id and p2.is_active and p2.category = o.category and p2.sub_type is not distinct from o.sub_type
          and l2.on_hand - l2.reserved >= v_qty and product_orderable_for(p2.id, p_party)
        order by p2.velocity_tier nulls last, o2.price_usd limit 3) x;
      v_issues := v_issues || jsonb_build_object('code', case when v_free > 0 then 'insufficient_stock' else 'out_of_stock' end,
                    'product_id', o.id, 'name', o.name_en, 'available', v_free, 'substitutes', v_subs, 'bought_to_order', o.bto);
    else
      v_sub := v_sub + round(v_unit * v_qty, 2);
    end if;
    v_lines := v_lines || (jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                 'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', v_unit, 'line_total_usd', round(v_unit * v_qty, 2),
                 'source_id', o.source_id, 'source', o.source_name, 'ok', v_ok, 'bought_to_order', o.bto,
                 'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', ln->>'note', 'raw', ln->>'raw',
                 'options', coalesce(c->'chosen', '[]'::jsonb), 'base_price_usd', o.price_usd,
                 'key', line_key(o.id::text, coalesce(ln->'options', '[]'::jsonb)))
               || case when c is not null then jsonb_build_object('needs', c->'needs', 'open_groups', c->'open') else '{}'::jsonb end);
  end loop;

  if jsonb_array_length(v_lines) = 0 then v_issues := v_issues || jsonb_build_object('code', 'empty_order'); end if;
  -- FD2 (3): one shop per order.
  if (select count(*) from jsonb_object_keys(v_shops)) > 1 then
    v_issues := v_issues || jsonb_build_object('code', 'mixed_shops', 'shops', (select jsonb_agg(value order by value->>'kind', value->>'name') from jsonb_each(v_shops)));
  end if;
  -- FD2 (4): the place's own hours.
  if v_place is not null then
    v_open := place_open_now(v_place);
    if not (v_open->>'open')::boolean then
      v_issues := v_issues || jsonb_build_object('code', 'place_closed', 'source_id', v_place, 'name', (select name from sources where id = v_place),
                                                 'reason', v_open->>'reason', 'opens', v_open->>'opens', 'closes', v_open->>'closes');
    end if;
  end if;
  -- FD2 (7): food is cash on delivery; checked where the payment is known (create_order_from_quote).

  if not p_pickup then
    if p_village is null then
      v_issues := v_issues || jsonb_build_object('code', 'no_delivery_village');
    else
      select z.delivery_fee_usd, z.base_eta_minutes, vi.is_served into v_fee, v_eta, v_served
        from villages vi left join zones z on z.id = vi.zone_id where vi.id = p_village;
      if not coalesce(v_served, false) or v_fee is null then
        v_issues := v_issues || jsonb_build_object('code', 'village_not_served'); v_fee := 0;
      end if;
    end if;
  end if;
  -- FD2 (5): the place's preparation time plus the ride from the place to the customer's village; the zone's estimate when the ride is unknown.
  if v_place is not null and not p_pickup and p_village is not null then
    select prep_minutes, travel_minutes(village_id, p_village) into v_prep, v_ride from sources where id = v_place;
    v_eta := coalesce(v_prep, 0) + coalesce(round(v_ride)::int, v_eta, 0);
  end if;
  -- FD2 (6): the food service fee, company income, its own line.
  if v_food then v_svc := round(greatest(coalesce((setting('food')->>'service_fee_usd')::numeric, 0), 0), 2); end if;

  -- Small-order fee (1.16): company income on a small basket, its own line, never part of the rider's delivery fee.
  -- Off while either number is 0 (the default until the founder sets them).
  if coalesce((v_sof->>'fee_usd')::numeric, 0) > 0 and v_sub > 0 and v_sub < coalesce((v_sof->>'below_subtotal_usd')::numeric, 0) then
    v_small := round((v_sof->>'fee_usd')::numeric, 2);
  end if;
  if v_sub > 0 and v_sub < v_min then
    v_issues := v_issues || jsonb_build_object('code', 'below_minimum', 'minimum_usd', v_min, 'subtotal_usd', v_sub);
  end if;
  if v_later then
    -- W1: the window, checked as the tap will check it (confirm_order_checked, 0040). The hours do not apply to it.
    v_state := case when p_pickup then 'pickup' when v_restaurant then 'restaurant' else slot_state(p_slot, v_fresh) end;
    if v_state = 'ok' and exists (select 1 from delivery_slots s where s.id = p_slot and s.zone_id is not null
                                     and s.zone_id is distinct from (select zone_id from villages where id = p_village)) then
      v_state := 'zone';
    end if;
    if v_state <> 'ok' then v_issues := v_issues || jsonb_build_object('code', 'slot_' || v_state, 'slot_id', p_slot); end if;
  else
    v_now := (now() at time zone coalesce(v_hours->>'tz', 'Asia/Beirut'))::time;
    if v_now < (v_hours->>'open')::time or v_now >= (v_hours->>'close')::time then
      v_issues := v_issues || jsonb_build_object('code', 'closed', 'opens', v_hours->>'open', 'closes', v_hours->>'close');
    end if;
  end if;
  if v_fx is null then v_issues := v_issues || jsonb_build_object('code', 'no_exchange_rate'); end if;
  -- D1 (3.8): a rate that moved more than settings.fx.pause_move_pct within the day waits for a person, and quoting pauses
  -- until then. Nothing is priced on a rate nobody has confirmed (B4).
  if fx_quoting_paused() then v_issues := v_issues || jsonb_build_object('code', 'fx_paused'); end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'lines', v_lines,
    'subtotal_usd', v_sub, 'delivery_fee_usd', v_fee, 'small_order_fee_usd', v_small, 'service_fee_usd', v_svc,
    'total_usd', v_sub + v_fee + v_small + v_svc,
    'fx_rate_lbp', v_fx, 'total_lbp', case when v_fx is null then null else round((v_sub + v_fee + v_small + v_svc) * v_fx / 1000) * 1000 end,
    'eta_minutes', case when p_pickup then null else v_eta end, 'pickup', p_pickup, 'village_id', p_village,
    'village', (select name_en from villages where id = p_village),
    'village_ar', (select name_ar from villages where id = p_village),
    'slot_id', p_slot, 'window', case when v_later then window_json(p_slot) end, 'bought_to_order', v_fresh,
    'food', v_food,
    'shop', case when (select count(*) from jsonb_object_keys(v_shops)) = 1 then (select value from jsonb_each(v_shops) limit 1)
                   || case when v_place is not null then (select jsonb_build_object('prep_minutes', prep_minutes, 'village_id', village_id) from sources where id = v_place)
                           else '{}'::jsonb end end);
end $$;

-- The shop of an order (its one fulfilment's source), as the card and the status messages name it.
create or replace function order_shop(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('source_id', s.id, 'name', s.name,
           'kind', case when s.kind = 'dark_store' then 'hub' when s.buys_for_customer then 'place' else 'merchant' end,
           'prep_minutes', s.prep_minutes, 'village_id', s.village_id)
    from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled'
   order by (s.kind = 'dark_store'), s.name limit 1 $$;

-- A food order's arrival estimate from now: the place's preparation (or the ready-in minutes staff recorded, 0250) plus the ride.
create or replace function food_eta_minutes(p_order uuid) returns int language sql stable set search_path = public, pg_temp as $$
  select coalesce(s.prep_minutes, 0) + coalesce(round(travel_minutes(s.village_id, o.village_id))::int,
                                                (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id), 0)
    from orders o join fulfilments f on f.order_id = o.id join sources s on s.id = f.source_id
   where o.id = p_order and s.buys_for_customer limit 1 $$;

-- The lines of an order as a basket (0119's text, with the options).
create or replace function order_lines_json(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'source_id', f.source_id, 'qty', i.qty,
                                               'options', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(i.options) x), '[]'::jsonb))
                            order by i.id), '[]'::jsonb)
    from order_items i join fulfilments f on f.id = i.fulfilment_id where i.order_id = p_order and i.status = 'ok' $$;

-- ---------- the order: 0118's text, with the customer's quote, the options, one shop and the food rules ----------
create or replace function create_order_from_quote(
  p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null, p_slot uuid default null
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare q jsonb := quote_order(p_lines, p_village, p_pickup, p_slot, p_customer); v_order uuid; v_code text; ln jsonb; v_ful uuid; v_stale uuid;
        v_dues numeric := customer_dues_usd(p_customer); v_total numeric; v_fx numeric;
        v_cap numeric := coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0); v_shop uuid;
begin
  -- FD2 (7): food is cash on delivery.
  if coalesce((q->>'food')::boolean, false) and p_payment <> 'cod' then
    q := jsonb_set(jsonb_set(q, '{ok}', 'false'), '{issues}', (q->'issues') || jsonb_build_object('code', 'food_cash_only'));
  end if;
  if (q->>'ok')::boolean and v_dues > 0 and p_payment = 'cod' then
    q := jsonb_set(jsonb_set(q, '{ok}', 'false'), '{issues}', (q->'issues') || jsonb_build_object('code', 'prepay_required', 'dues_usd', v_dues));
  end if;
  -- First-order cash cap (1.16): a customer with no delivered order pays a large first order in advance. Off while the cap is 0.
  if (q->>'ok')::boolean and p_payment = 'cod' and v_cap > 0 and (q->>'total_usd')::numeric + v_dues > v_cap
     and not exists (select 1 from orders where customer_id = p_customer and status in ('delivered','closed')) then
    q := jsonb_set(jsonb_set(q, '{ok}', 'false'), '{issues}', (q->'issues') || jsonb_build_object('code', 'first_order_cod_cap', 'max_cod_usd', v_cap));
  end if;
  if not (q->>'ok')::boolean then return jsonb_build_object('created', false, 'quote', q); end if;
  -- FD2 (3): a new card replaces the waiting cards of the same shop only; a card of another shop is another order and stays.
  v_shop := nullif(q->'shop'->>'source_id', '')::uuid;
  for v_stale in select o.id from orders o where o.conversation_id = p_conversation and o.status in ('awaiting_confirmation', 'draft')
                    and (v_shop is null
                         or not exists (select 1 from fulfilments f where f.order_id = o.id)
                         or exists (select 1 from fulfilments f where f.order_id = o.id and f.source_id = v_shop)) loop
    perform transition_order(v_stale, 'cancelled', 'system', null, 'superseded_by_new_card');
  end loop;

  v_code := 'AK-' || nextval('order_code_seq');
  insert into orders(short_code, customer_id, conversation_id, village_id, place_id, is_pickup, subtotal_usd, delivery_fee_usd,
                     small_order_fee_usd, service_fee_usd, dues_usd, payment_method, change_for_usd, customer_notes, delivery_slot_id)
    values (v_code, p_customer, p_conversation, p_village, p_place, p_pickup, (q->>'subtotal_usd')::numeric,
            (q->>'delivery_fee_usd')::numeric, coalesce((q->>'small_order_fee_usd')::numeric, 0), coalesce((q->>'service_fee_usd')::numeric, 0),
            v_dues, p_payment, p_change_for, p_notes, p_slot)
    returning id into v_order;
  for ln in select * from jsonb_array_elements(q->'lines') loop
    insert into fulfilments(order_id, source_id) values (v_order, (ln->>'source_id')::uuid)
      on conflict (order_id, source_id) do update set source_id = excluded.source_id returning id into v_ful;
    update fulfilments set subtotal_usd = subtotal_usd + (ln->>'line_total_usd')::numeric where id = v_ful;
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note, raw_phrase, options)
      values (v_order, v_ful, (ln->>'product_id')::uuid, ln->>'name', (ln->>'qty')::numeric, (ln->>'unit_price_usd')::numeric,
              coalesce(ln->'modifiers', '[]'::jsonb), ln->>'note', nullif(ln->>'raw', ''), coalesce(ln->'options', '[]'::jsonb));
  end loop;
  perform transition_order(v_order, 'awaiting_confirmation', 'agent');
  update conversations set active_order_id = v_order, updated_at = now() where id = p_conversation;
  v_total := (q->>'total_usd')::numeric + v_dues; v_fx := (q->>'fx_rate_lbp')::numeric;
  q := q || jsonb_build_object('dues_usd', v_dues, 'total_usd', v_total,
                               'total_lbp', case when v_fx is null then null else round(v_total * v_fx / 1000) * 1000 end);
  return jsonb_build_object('created', true, 'order_id', v_order, 'short_code', v_code, 'payment_method', p_payment,
                            'change_for_usd', p_change_for, 'quote', q);
end $$;

-- ---------- one card per turn: 0118's text, the same basket compared with its options ----------
create or replace function create_order_for_turn(
  p_turn_key text, p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null, p_slot uuid default null
) returns jsonb language plpgsql set search_path = public, extensions, pg_temp as $$
declare o orders%rowtype; q jsonb; v_credit numeric; v_dues numeric; v_total numeric; v_fx numeric; r jsonb; v_same boolean;
begin
  if p_turn_key is not null then
    select * into o from orders where turn_key = p_turn_key and conversation_id = p_conversation and customer_id = p_customer
       and status = 'awaiting_confirmation' order by created_at desc limit 1 for update;
    if found then
      q := quote_order(p_lines, p_village, p_pickup, p_slot, p_customer);
      -- the same basket: the same products, with the same options, in the same quantities
      v_same := (select coalesce(jsonb_agg(jsonb_build_array(k, qty) order by k, qty), '[]'::jsonb)
                   from (select line_key(l->>'product_id', coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(l->'options') x), '[]'::jsonb)) as k,
                                sum((l->>'qty')::numeric) as qty from jsonb_array_elements(q->'lines') l group by 1) a)
              = (select coalesce(jsonb_agg(jsonb_build_array(k, qty) order by k, qty), '[]'::jsonb)
                   from (select line_key(product_id::text, coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(options) x), '[]'::jsonb)) as k,
                                sum(qty) as qty from order_items where order_id = o.id group by 1) b);
      if (q->>'ok')::boolean and v_same
         and o.subtotal_usd = (q->>'subtotal_usd')::numeric and o.delivery_fee_usd = (q->>'delivery_fee_usd')::numeric
         and o.service_fee_usd = coalesce((q->>'service_fee_usd')::numeric, 0)
         and o.village_id is not distinct from p_village and o.is_pickup = p_pickup
         and o.delivery_slot_id is not distinct from p_slot
         and (o.place_id is not distinct from p_place or exists (     -- a retried pin is saved again as a new row: the same place
               select 1 from customer_places a, customer_places b where a.id = o.place_id and b.id = p_place and a.party_id = b.party_id
                  and a.lat is not distinct from b.lat and a.lng is not distinct from b.lng and a.village_id is not distinct from b.village_id))
         and o.payment_method = p_payment and o.change_for_usd is not distinct from p_change_for
         and o.customer_notes is not distinct from p_notes then
        -- What create_order_from_quote returned the first time: the dues as they were before any credit came off them.
        select coalesce(sum(amount_usd), 0) into v_credit from credit_applications where order_id = o.id;
        v_dues := o.dues_usd + v_credit; v_total := (q->>'total_usd')::numeric + v_dues; v_fx := (q->>'fx_rate_lbp')::numeric;
        q := q || jsonb_build_object('dues_usd', v_dues, 'total_usd', v_total,
                                     'total_lbp', case when v_fx is null then null else round(v_total * v_fx / 1000) * 1000 end);
        return jsonb_build_object('created', true, 'reused', true, 'order_id', o.id, 'short_code', o.short_code,
                                  'payment_method', o.payment_method, 'change_for_usd', o.change_for_usd, 'quote', q);
      end if;
    end if;
  end if;
  r := create_order_from_quote(p_customer, p_conversation, p_lines, p_village, p_place, p_pickup, p_payment, p_change_for, p_notes, p_slot);
  if (r->>'created')::boolean and p_turn_key is not null then
    update orders set turn_key = p_turn_key where id = (r->>'order_id')::uuid;
  end if;
  return r;
end $$;

-- ---------- the basket of an order: 0118's text, with the options and the customer's own quote ----------
create or replace function basket_from_order(p_party uuid, p_order uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare o orders%rowtype; ln record; v_all jsonb := '[]'::jsonb; v_ok jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb;
        q jsonb; v_pay text; v_good boolean; v_slot uuid;
begin
  select * into o from orders where id = p_order and customer_id = p_party;
  if not found then return jsonb_build_object('found', false); end if;
  v_slot := case when o.status in ('draft', 'awaiting_confirmation', 'confirmed', 'awaiting_payment') then o.delivery_slot_id end;

  for ln in select i.product_id, f.source_id, i.qty, i.modifiers, i.note, i.raw_phrase,
                   coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(i.options) x), '[]'::jsonb) as options
              from order_items i join fulfilments f on f.id = i.fulfilment_id
             where i.order_id = o.id and i.status = 'ok' order by i.id loop
    v_all := v_all || jsonb_build_object('product_id', ln.product_id, 'source_id', ln.source_id, 'qty', ln.qty,
                                         'modifiers', ln.modifiers, 'note', ln.note, 'raw', ln.raw_phrase, 'options', ln.options);
  end loop;
  q := quote_order(v_all, o.village_id, o.is_pickup, v_slot, p_party);

  for ln in select x.value as line, p.name_en, p.name_ar from jsonb_array_elements(v_all) x join products p on p.id = (x.value->>'product_id')::uuid loop
    select coalesce(bool_or((y->>'ok')::boolean and coalesce((y->>'coming_soon')::boolean, false) = false), false) into v_good
      from jsonb_array_elements(q->'lines') y where y->>'product_id' = ln.line->>'product_id';
    if v_good then v_ok := v_ok || ln.line;
    else v_missing := v_missing || jsonb_build_object('product_id', ln.line->>'product_id', 'name', ln.name_en, 'name_ar', ln.name_ar);
    end if;
  end loop;
  if jsonb_array_length(v_missing) > 0 and jsonb_array_length(v_ok) > 0 then q := quote_order(v_ok, o.village_id, o.is_pickup, v_slot, p_party); end if;

  v_pay := o.payment_method::text;
  if customer_requires_prepay(p_party) and v_pay = 'cod' and not coalesce((q->>'food')::boolean, false) then v_pay := 'whish'; end if;
  return jsonb_build_object('found', true, 'order_id', o.id, 'short_code', o.short_code, 'status', o.status,
    'lines', v_ok, 'missing', v_missing, 'village_id', o.village_id, 'place_id', o.place_id, 'pickup', o.is_pickup,
    'payment_method', v_pay, 'change_for_usd', o.change_for_usd, 'notes', o.customer_notes, 'slot_id', v_slot,
    'quote', case when jsonb_array_length(v_ok) > 0 then q else null end);
end $$;

-- ---------- the confirm tap's re-check (0226's text): the customer's own orderable, the dish's options in the price, the place's hours ----------
create or replace function order_quote_issues(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('item', i.name_snapshot, 'issue',
           case when not product_orderable_for(i.product_id, o.customer_id) then 'coming_soon'
                when ofr.id is null or not ofr.is_available then 'unavailable'
                when not s.is_open then 'source_closed'
                when s.buys_for_customer and not (place_open_now(s.id)->>'open')::boolean then 'source_closed'
                else 'price_changed' end, 'was_usd', i.unit_price_usd, 'now_usd', ofr.price_usd + x.delta)), '[]'::jsonb)
    from order_items i join orders o on o.id = i.order_id join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
    left join offers ofr on ofr.source_id = f.source_id and ofr.product_id = i.product_id
    cross join lateral (select coalesce(sum(d.price_delta_usd), 0) as delta from dish_options d
                         where d.id in (select (e->>'id')::uuid from jsonb_array_elements(i.options) e)) x
   where i.order_id = p_order and i.status = 'ok'
     and (not product_orderable_for(i.product_id, o.customer_id) or ofr.id is null or not ofr.is_available or not s.is_open
          or (s.buys_for_customer and not (place_open_now(s.id)->>'open')::boolean)
          or ofr.price_usd + x.delta <> i.unit_price_usd) $$;

-- ---------- the stored card (0229's text): the options on each line, the service fee, the shop, a food order's estimate ----------
create or replace function order_card(p_order uuid, p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'payment_method', o.payment_method,
    'change_for_usd', o.change_for_usd, 'window', window_json(o.delivery_slot_id),
    'cash_currency', o.cash_currency, 'change_for_lbp', o.change_for_lbp, 'missing_pref', o.missing_pref, 'keep_change', o.keep_change_credit,
    'missing_items', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', i.name_snapshot, 'name_ar', p.name_ar, 'pref', i.missing_pref) order by i.id), '[]'::jsonb)
                        from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok' and i.missing_pref is not null),
    'replaces', (select r.short_code from orders r where r.id = o.replaces_order_id),
    'reopened_from', (select r.short_code from orders r where r.id = o.reopened_from),
    'prepay', case when o.payment_method <> 'cod' and coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0) > 0
                        and o.total_usd > (setting('first_order')->>'max_cod_usd')::numeric
                        and not exists (select 1 from orders d where d.customer_id = o.customer_id and d.status in ('delivered', 'closed'))
                   then jsonb_build_object('reason', 'first_order', 'maxCodUsd', (setting('first_order')->>'max_cod_usd')::numeric) end,
    'quote', jsonb_build_object('ok', true, 'issues', '[]'::jsonb,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty, 'unit', p.sell_unit,
                                  'line_total_usd', round(i.qty * i.unit_price_usd, 2), 'modifiers', i.modifiers, 'note', i.note, 'options', i.options) order by i.id), '[]'::jsonb)
                  from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok'),
      'subtotal_usd', o.subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'small_order_fee_usd', o.small_order_fee_usd,
      'service_fee_usd', o.service_fee_usd,
      'dues_usd', o.dues_usd + c.credit, 'credit_usd', c.credit, 'total_usd', o.total_usd,
      'fx_rate_lbp', coalesce(o.fx_rate_lbp, current_fx()),
      'total_lbp', case when coalesce(o.fx_rate_lbp, current_fx()) is null then null else round(o.total_usd * coalesce(o.fx_rate_lbp, current_fx()) / 1000) * 1000 end,
      'eta_minutes', coalesce(food_eta_minutes(o.id), (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id)),
      'pickup', o.is_pickup, 'village_id', o.village_id,
      'village', (select name_en from villages where id = o.village_id), 'village_ar', (select name_ar from villages where id = o.village_id),
      'shop', order_shop(o.id), 'food', exists (select 1 from fulfilments f join sources s on s.id = f.source_id where f.order_id = o.id and s.buys_for_customer)))
    from orders o, lateral (select coalesce(sum(amount_usd), 0) as credit from credit_applications where order_id = o.id) c
   where o.id = p_order and o.customer_id = p_party $$;

-- ---------- 6: the cash at the door (0104's text, with the food service fee as company income) ----------
create or replace function post_cod_collection(
  p_order uuid, p_driver uuid, p_usd numeric, p_lbp numeric, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns numeric language plpgsql as $$
declare o orders%rowtype; v_fx numeric; v_net_usd numeric; v_net_lbp numeric; v_equiv numeric;
        v_txn uuid := gen_random_uuid(); v_cash uuid; v_goods numeric := 0; v_merch numeric := 0; v_net numeric; r record;
        v_os jsonb := coalesce(setting('over_short'), '{}'::jsonb);
        v_tol numeric := coalesce((v_os->>'cod_tolerance_usd')::numeric, 0.25);
        v_max numeric := coalesce((v_os->>'cod_max_usd')::numeric, 1.00);
        v_diff numeric; v_rest numeric; v_short_to_rider boolean;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method <> 'cod' then raise exception 'NOT_COD'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return driver_cash_usd(p_driver); end if;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  v_net_usd := p_usd - p_change_usd;  v_net_lbp := p_lbp - p_change_lbp;
  v_equiv := round(v_net_usd + v_net_lbp / v_fx, 2);
  v_diff := v_equiv - o.total_usd;
  if abs(v_diff) > v_max + 0.005 then raise exception 'AMOUNT_MISMATCH expected % got %', o.total_usd, v_equiv; end if;   -- G1-01
  v_short_to_rider := v_diff < -(v_tol + 0.005);

  v_cash := ensure_account('driver_cash:' || p_driver, 'driver_cash', p_driver);
  if v_net_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
      values (v_txn, v_cash, v_net_usd, 'USD', v_net_usd, p_order, 'COD collected');
  end if;
  if v_net_lbp <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
      values (v_txn, v_cash, v_net_lbp, 'LBP', v_equiv - v_net_usd, p_order, 'COD collected');
  end if;
  for r in select f.subtotal_usd, s.id as source_id, s.kind, s.commission_pct
           from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled' loop
    if r.kind = 'dark_store' then v_goods := v_goods + r.subtotal_usd;
    else
      v_net := round(r.subtotal_usd * (1 - r.commission_pct / 100), 2);
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
        (v_txn, ensure_account('merchant_payable:' || r.source_id, 'merchant_payable', null, r.source_id), -v_net, 'USD', -v_net, p_order, 'Owed to merchant'),
        (v_txn, ensure_account('revenue_commission', 'revenue_commission'), -(r.subtotal_usd - v_net), 'USD', -(r.subtotal_usd - v_net), p_order, 'Commission');
      v_merch := v_merch + r.subtotal_usd;
    end if;
  end loop;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account('revenue_goods', 'revenue_goods'), -v_goods, 'USD', -v_goods, p_order, 'Goods'),
    (v_txn, ensure_account('revenue_delivery', 'revenue_delivery'), -o.delivery_fee_usd, 'USD', -o.delivery_fee_usd, p_order, 'Delivery fee'),
    (v_txn, ensure_account('tips_payable:' || p_driver, 'tips_payable', p_driver), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip');
  -- G1-01: what is left over is rounding (the company's) within the tolerance; a shortfall beyond it is owed by the rider.
  v_rest := v_equiv - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd - o.service_fee_usd;
  if v_short_to_rider then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('rider_receivable:' || p_driver, 'rider_receivable'::account_kind, p_driver), -v_rest, 'USD', -v_rest, p_order,
       'Cash short at the door, owed by the rider');
    insert into risk_flags(subject_kind, subject_id, rule, severity, details)
      values ('driver', p_driver, 'cod_short', 2, jsonb_build_object('order_id', p_order, 'short_code', o.short_code, 'short_usd', -v_diff,
                                                                     'tolerance_usd', v_tol, 'usd', p_usd, 'lbp', p_lbp));
  else
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('cash_over_short', 'cash_over_short'), -v_rest, 'USD', -v_rest, p_order,
       case when v_diff > v_tol + 0.005 then 'Cash over at the door' else 'Rounding and FX difference' end);
    if v_diff > v_tol + 0.005 then
      insert into risk_flags(subject_kind, subject_id, rule, severity, details)
        values ('driver', p_driver, 'cod_over', 1, jsonb_build_object('order_id', p_order, 'short_code', o.short_code, 'over_usd', v_diff,
                                                                      'tolerance_usd', v_tol, 'usd', p_usd, 'lbp', p_lbp));
    end if;
  end if;
  if o.small_order_fee_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_small_order', 'revenue_small_order'::account_kind), -o.small_order_fee_usd, 'USD', -o.small_order_fee_usd, p_order, 'Small-order fee');
  end if;
  -- FD2 (6): the food service fee, company income.
  if o.service_fee_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_food_service', 'revenue_food_service'::account_kind), -o.service_fee_usd, 'USD', -o.service_fee_usd, p_order, 'Food service fee');
  end if;
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  insert into payments(order_id, method, status, amount_usd, received_usd, received_lbp, change_usd, change_lbp, confirmed_by, confirmed_at, over_short_usd)
    values (p_order, 'cod', 'confirmed', o.total_usd, p_usd, p_lbp, p_change_usd, p_change_lbp, p_driver, now(), round(v_diff, 2));
  return driver_cash_usd(p_driver);
end $$;

-- ---------- 8: finding a place and its dishes ----------
-- Every place, orderable for this customer or not, whose name or one of its aliases is in the words (folded, as whole words or a close
-- trigram match on the name's words). orderable says whether this customer may order from it; a place they may not is answered as "not on
-- Alo King yet" by code, the same reply an unapproved restaurant gets (0013). Never its phone.
create or replace function food_places_named(p_party uuid, p_text text) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  with t as (select ' ' || regexp_replace(fold_text(coalesce(p_text, '')), '[^[:alnum:][:space:]]', ' ', 'g') || ' ' as w),
  names as (
    select s.id, s.name, n as said
      from sources s cross join lateral unnest(array[s.name] || s.place_aliases) n
     where s.kind = 'merchant' and s.buys_for_customer and s.visibility <> 'off' and btrim(coalesce(n, '')) <> ''
  ), hits as (
    select distinct on (names.id) names.id, names.name,
           greatest(case when t.w like '% ' || regexp_replace(fold_text(names.said), '[^[:alnum:][:space:]]', ' ', 'g') || ' %' then 1.0 else 0 end,
                    word_similarity(regexp_replace(fold_text(names.said), '[^[:alnum:][:space:]]', ' ', 'g'), t.w)) as score
      from names, t
     order by names.id, score desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('source_id', h.id, 'name', h.name, 'score', round(h.score::numeric, 2),
                                               'orderable', place_orderable_for(h.id, p_party)) order by h.score desc, h.name), '[]'::jsonb)
    from hits h where h.score >= 0.8 $$;

-- One place's approved menu for one customer: every dish on sale with its price (the database's), section and option groups, and the food
-- facts status of each (FD1's dish_facts_status: declared by the vendor, or not confirmed yet). A place this customer cannot order from: no
-- dishes, reason not_on_alo_king.
create or replace function place_menu(p_party uuid, p_source uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare s sources%rowtype;
begin
  select * into s from sources where id = p_source and kind = 'merchant' and buys_for_customer;
  if not found or not place_orderable_for(p_source, p_party) then
    return jsonb_build_object('ok', false, 'reason', 'not_on_alo_king', 'dishes', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'source_id', s.id, 'name', s.name, 'prep_minutes', s.prep_minutes, 'open', place_open_now(s.id),
    'village_id', s.village_id,
    'dishes', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'price_usd', ofr.price_usd,
                                 'section', p.sub_type,
                                 'groups', coalesce((select jsonb_agg(dish_group_json(g.id) order by g.sort_order, g.name_en) from dish_option_groups g where g.product_id = p.id), '[]'::jsonb))
                               order by p.sub_type nulls last, p.name_en)
                          from products p join offers ofr on ofr.product_id = p.id and ofr.source_id = s.id
                         where p.owner_source_id = s.id and p.is_active and ofr.is_available and ofr.price_usd > 0), '[]'::jsonb));
end $$;

-- The options of one dish named in the words («كبير مع ثوم», "large, extra garlic"): whole-word matches of an option's name, folded.
create or replace function dish_options_in_text(p_product uuid, p_text text) returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  with t as (select ' ' || regexp_replace(fold_text(coalesce(p_text, '')), '[^[:alnum:][:space:]]', ' ', 'g') || ' ' as w)
  select coalesce(jsonb_agg(distinct o.id), '[]'::jsonb)
    from dish_options o join dish_option_groups g on g.id = o.group_id, t
   where g.product_id = p_product and btrim(coalesce(p_text, '')) <> ''
     and exists (select 1 from unnest(array[o.name_en, o.name_ar]) n
                  where btrim(coalesce(n, '')) <> '' and length(fold_text(n)) >= 2
                    and t.w like '% ' || regexp_replace(fold_text(n), '[^[:alnum:][:space:]]', ' ', 'g') || ' %') $$;

-- The customer's lines against ONE place's approved menu: matched (one dish clearly best), ambiguous (several close: the candidates, at most
-- ten, for a list), not_found. A matched line carries the options its words named. Only dishes of that place, on sale.
create or replace function food_match(p_party uuid, p_source uuid, p_lines jsonb) returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare ln jsonb; i int := 0; v_out jsonb := '[]'::jsonb; v_q text; v_c jsonb; v_top numeric; v_second numeric; v_best jsonb; v_status text;
begin
  if not place_orderable_for(p_source, p_party) then return jsonb_build_object('ok', false, 'reason', 'not_on_alo_king', 'lines', '[]'::jsonb); end if;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_q := regexp_replace(fold_text(coalesce(nullif(ln->>'query', ''), ln->>'raw', '')), '[^[:alnum:][:space:]]', ' ', 'g');
    select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc, x->>'name_en'), '[]'::jsonb) into v_c from (
      select jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'price_usd', ofr.price_usd,
               'score', round(greatest(word_similarity(v_q, regexp_replace(fold_text(p.name_en), '[^[:alnum:][:space:]]', ' ', 'g')),
                                       word_similarity(regexp_replace(fold_text(p.name_en), '[^[:alnum:][:space:]]', ' ', 'g'), v_q),
                                       coalesce(word_similarity(v_q, regexp_replace(fold_text(p.name_ar), '[^[:alnum:][:space:]]', ' ', 'g')), 0),
                                       coalesce(word_similarity(regexp_replace(fold_text(p.name_ar), '[^[:alnum:][:space:]]', ' ', 'g'), v_q), 0))::numeric, 2)) as x
        from products p join offers ofr on ofr.product_id = p.id and ofr.source_id = p_source
       where p.owner_source_id = p_source and p.is_active and ofr.is_available and ofr.price_usd > 0 and btrim(v_q) <> ''
      ) y where (x->>'score')::numeric >= 0.45
      limit 10;
    v_top := coalesce((v_c->0->>'score')::numeric, 0); v_second := coalesce((v_c->1->>'score')::numeric, 0);
    v_status := case when jsonb_array_length(v_c) = 0 then 'not_found'
                     when v_top >= 0.75 and (jsonb_array_length(v_c) = 1 or v_second < v_top - 0.15) then 'matched'
                     when jsonb_array_length(v_c) = 1 and v_top >= 0.6 then 'matched'
                     else 'ambiguous' end;
    v_best := case when v_status = 'matched' then v_c->0 end;
    v_out := v_out || jsonb_build_object('idx', i, 'raw', ln->>'raw', 'query', ln->>'query', 'qty', coalesce((ln->>'qty')::numeric, 1),
      'status', v_status, 'chosen', v_best, 'candidates', case when v_status = 'ambiguous' then v_c else '[]'::jsonb end,
      'options', case when v_best is not null then dish_options_in_text((v_best->>'product_id')::uuid,
                        concat_ws(' ', ln->>'raw', (select string_agg(m, ' ') from jsonb_array_elements_text(coalesce(ln->'modifiers', '[]'::jsonb)) m)))
                      else '[]'::jsonb end);
    i := i + 1;
  end loop;
  return jsonb_build_object('ok', true, 'lines', v_out);
end $$;

-- Where a food order goes when the words name no village: the customer's usual place (the planner's rule, 0078), with its village.
create or replace function customer_usual_place(p_party uuid, p_village uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('place_id', c.id, 'village_id', c.village_id)
    from customer_places c where c.party_id = p_party and c.village_id is not null and (p_village is null or c.village_id = p_village)
   order by c.last_used_at desc nulls last limit 1 $$;

-- Which of these products are dishes of a place (the chat's food facts and its quote tool ask it).
create or replace function dish_places(p_ids uuid[]) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'place', s.name, 'name_en', p.name_en, 'name_ar', p.name_ar)), '[]'::jsonb)
    from products p join sources s on s.id = p.owner_source_id where p.id = any(p_ids) and s.buys_for_customer $$;

-- ---------- 8: the names customers use, on the Places page (FD1's set_place_details, with aliases) ----------
create or replace function set_place_details(p_source uuid, p_by uuid, p_details jsonb) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare s sources%rowtype; v_village uuid; v_prep int; v_name text; v_aliases text[];
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into s from sources where id = p_source and buys_for_customer for update;
  if not found then raise exception 'NOT_A_PLACE'; end if;
  v_name := nullif(left(btrim(coalesce(p_details->>'name', '')), 120), '');
  v_village := nullif(p_details->>'village_id', '')::uuid;
  if v_village is not null and not exists (select 1 from villages where id = v_village) then raise exception 'VILLAGE_REQUIRED: choose the place''s village'; end if;
  v_prep := nullif(p_details->>'prep_minutes', '')::int;
  if v_prep is not null and (v_prep < 0 or v_prep > 180) then raise exception 'PREP_MINUTES: 0 to 180'; end if;
  if p_details ? 'hours' and not place_hours_ok(p_details->'hours') then raise exception 'HOURS_INVALID: opening and closing as HH:MM, days off as mon..sun'; end if;
  if p_details ? 'aliases' then
    select coalesce(array_agg(distinct left(btrim(a), 60)) filter (where btrim(a) <> ''), '{}') into v_aliases
      from unnest(case when jsonb_typeof(p_details->'aliases') = 'array' then array(select jsonb_array_elements_text(p_details->'aliases'))
                       else string_to_array(coalesce(p_details->>'aliases', ''), ',') end) a;
    if cardinality(v_aliases) > 12 then raise exception 'ALIASES_TOO_MANY: at most 12 other names'; end if;
  end if;
  update sources set name = coalesce(v_name, name), village_id = coalesce(v_village, village_id), prep_minutes = coalesce(v_prep, prep_minutes),
         hours = case when p_details ? 'hours' then coalesce(p_details->'hours', '{}'::jsonb) else hours end,
         place_aliases = case when p_details ? 'aliases' then v_aliases else place_aliases end
   where id = p_source;
  perform place_contact_set(p_source, case when p_details ? 'phone' then coalesce(p_details->>'phone', '') else null end, p_by);
  insert into place_log(source_id, action, by_party, detail) values (p_source, 'details', p_by, p_details - 'phone' || jsonb_build_object('phone_changed', p_details ? 'phone'));
  return jsonb_build_object('ok', true);
end $$;

-- The console's list (0245's text), with the aliases and the stamp and menu counts it already read.
alter function places_console() rename to places_console_0245;
create or replace function places_console() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x || jsonb_build_object('aliases', to_jsonb(s.place_aliases), 'closed_on', s.closed_on)), '[]'::jsonb)
    from jsonb_array_elements(places_console_0245()) x join sources s on s.id = (x->>'source_id')::uuid $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
