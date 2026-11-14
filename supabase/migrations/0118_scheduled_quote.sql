-- Alo King Chouf, session W1 (ordering lane), C3's request 5: a lane B overflow migration for quote_order.
--
-- A scheduled order (2.8, migration 0040) is quoted for its window, not for now:
--   * its bought-to-order lines (settings.scheduling.bought_to_order zones, fresh goods by default, at the hub) need no stock now:
--     they are bought for the order and reserved when it comes due (reserve_due_lines, 0040). Their offer must still be on sale.
--   * the opening hours do not apply: a card may be made after closing time for a window (K1's kept order, 0087, is the other
--     answer: "send it when we open").
--   * the window itself is checked as the confirmation will check it: open, before its cut-off (the earlier one when a line is
--     bought to order), with room, in the village's zone; hub goods to the door only (no pickup, no restaurant, Phase 8). A window
--     the quote refuses is an issue 'slot_<state>' (slot_full, slot_closed, slot_cutoff, slot_fresh_cutoff, slot_zone, slot_unknown,
--     slot_pickup, slot_restaurant), so no card is made for it.
-- Every other check is the same: prices, stock of shelf goods, the minimum, the village, the rate.
--
-- quote_order gains p_slot (default null: now, exactly as before). It is 0077's text with those lines added; each line also says
-- whether it is bought to order (bought_to_order), so the ordering lane can offer a window when only fresh goods are short now.
-- create_order_from_quote (0052's text) and create_order_for_turn (0101's text) gain p_slot too and store it as the order's
-- window; a retried turn reuses its draft only for the same window. basket_from_order (0015's text) quotes an open scheduled
-- order for its own window, so a stale scheduled card is rebuilt for its window and not for now.
-- The old signatures are dropped (a call with fewer arguments resolves to the new ones through the defaults). Nothing in a money
-- function changes; plan_order_core still quotes for now.

drop function if exists create_order_for_turn(text, uuid, uuid, jsonb, uuid, uuid, boolean, payment_method, numeric, text);
drop function if exists create_order_from_quote(uuid, uuid, jsonb, uuid, uuid, boolean, payment_method, numeric, text);
drop function if exists quote_order(jsonb, uuid, boolean);

create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false, p_slot uuid default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric := 0; v_eta int; v_small numeric := 0; v_sof jsonb := setting('small_order_fee');
        v_fx numeric := current_fx(); v_hours jsonb := setting('hours'); v_now time; v_min numeric := (setting('min_order_usd'))::text::numeric;
        o record; v_free numeric; v_qty numeric; v_ok boolean; v_subs jsonb; v_served boolean;
        v_later boolean := p_slot is not null; v_fresh boolean := false; v_restaurant boolean := false; v_state text;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 1);
    select p.id, p.sku, p.name_en, p.name_ar, p.category, p.sub_type, p.sell_unit, ofr.price_usd, ofr.is_available,
           s.id as source_id, s.name as source_name, s.kind, s.is_open,
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
    if o.kind <> 'dark_store' then v_restaurant := true; end if;
    if o.bto then v_fresh := true; end if;
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
          and l2.on_hand - l2.reserved >= v_qty
        order by p2.velocity_tier nulls last, o2.price_usd limit 3) x;
      v_issues := v_issues || jsonb_build_object('code', case when v_free > 0 then 'insufficient_stock' else 'out_of_stock' end,
                    'product_id', o.id, 'name', o.name_en, 'available', v_free, 'substitutes', v_subs, 'bought_to_order', o.bto);
    else
      v_sub := v_sub + round(o.price_usd * v_qty, 2);
    end if;
    v_lines := v_lines || jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                 'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', o.price_usd, 'line_total_usd', round(o.price_usd * v_qty, 2),
                 'source_id', o.source_id, 'source', o.source_name, 'ok', v_ok, 'bought_to_order', o.bto,
                 'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', ln->>'note', 'raw', ln->>'raw');
  end loop;

  if jsonb_array_length(v_lines) = 0 then v_issues := v_issues || jsonb_build_object('code', 'empty_order'); end if;

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
    'subtotal_usd', v_sub, 'delivery_fee_usd', v_fee, 'small_order_fee_usd', v_small, 'total_usd', v_sub + v_fee + v_small,
    'fx_rate_lbp', v_fx, 'total_lbp', case when v_fx is null then null else round((v_sub + v_fee + v_small) * v_fx / 1000) * 1000 end,
    'eta_minutes', case when p_pickup then null else v_eta end, 'pickup', p_pickup, 'village_id', p_village,
    'village', (select name_en from villages where id = p_village),
    'village_ar', (select name_ar from villages where id = p_village),
    'slot_id', p_slot, 'window', case when v_later then window_json(p_slot) end, 'bought_to_order', v_fresh);
end $$;

-- ---------- the order: 0052's text, with the window stored ----------
create or replace function create_order_from_quote(
  p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null, p_slot uuid default null
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare q jsonb := quote_order(p_lines, p_village, p_pickup, p_slot); v_order uuid; v_code text; ln jsonb; v_ful uuid; v_stale uuid;
        v_dues numeric := customer_dues_usd(p_customer); v_total numeric; v_fx numeric;
        v_cap numeric := coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0);
begin
  if (q->>'ok')::boolean and v_dues > 0 and p_payment = 'cod' then
    q := jsonb_set(jsonb_set(q, '{ok}', 'false'), '{issues}', (q->'issues') || jsonb_build_object('code', 'prepay_required', 'dues_usd', v_dues));
  end if;
  -- First-order cash cap (1.16): a customer with no delivered order pays a large first order in advance. Off while the cap is 0.
  if (q->>'ok')::boolean and p_payment = 'cod' and v_cap > 0 and (q->>'total_usd')::numeric + v_dues > v_cap
     and not exists (select 1 from orders where customer_id = p_customer and status in ('delivered','closed')) then
    q := jsonb_set(jsonb_set(q, '{ok}', 'false'), '{issues}', (q->'issues') || jsonb_build_object('code', 'first_order_cod_cap', 'max_cod_usd', v_cap));
  end if;
  if not (q->>'ok')::boolean then return jsonb_build_object('created', false, 'quote', q); end if;
  for v_stale in select id from orders where conversation_id = p_conversation and status in ('awaiting_confirmation', 'draft') loop
    perform transition_order(v_stale, 'cancelled', 'system', null, 'superseded_by_new_card');
  end loop;

  v_code := 'AK-' || nextval('order_code_seq');
  insert into orders(short_code, customer_id, conversation_id, village_id, place_id, is_pickup, subtotal_usd, delivery_fee_usd,
                     small_order_fee_usd, dues_usd, payment_method, change_for_usd, customer_notes, delivery_slot_id)
    values (v_code, p_customer, p_conversation, p_village, p_place, p_pickup, (q->>'subtotal_usd')::numeric,
            (q->>'delivery_fee_usd')::numeric, coalesce((q->>'small_order_fee_usd')::numeric, 0), v_dues, p_payment, p_change_for, p_notes, p_slot)
    returning id into v_order;
  for ln in select * from jsonb_array_elements(q->'lines') loop
    insert into fulfilments(order_id, source_id) values (v_order, (ln->>'source_id')::uuid)
      on conflict (order_id, source_id) do update set source_id = excluded.source_id returning id into v_ful;
    update fulfilments set subtotal_usd = subtotal_usd + (ln->>'line_total_usd')::numeric where id = v_ful;
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note, raw_phrase)
      values (v_order, v_ful, (ln->>'product_id')::uuid, ln->>'name', (ln->>'qty')::numeric, (ln->>'unit_price_usd')::numeric,
              coalesce(ln->'modifiers', '[]'::jsonb), ln->>'note', nullif(ln->>'raw', ''));
  end loop;
  perform transition_order(v_order, 'awaiting_confirmation', 'agent');
  update conversations set active_order_id = v_order, updated_at = now() where id = p_conversation;
  v_total := (q->>'total_usd')::numeric + v_dues; v_fx := (q->>'fx_rate_lbp')::numeric;
  q := q || jsonb_build_object('dues_usd', v_dues, 'total_usd', v_total,
                               'total_lbp', case when v_fx is null then null else round(v_total * v_fx / 1000) * 1000 end);
  return jsonb_build_object('created', true, 'order_id', v_order, 'short_code', v_code, 'payment_method', p_payment,
                            'change_for_usd', p_change_for, 'quote', q);
end $$;

-- ---------- one card per turn: 0101's text, with the window ----------
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
      q := quote_order(p_lines, p_village, p_pickup, p_slot);
      -- the same basket: the same products in the same quantities
      v_same := (select coalesce(jsonb_agg(jsonb_build_array(pid, qty) order by pid, qty), '[]'::jsonb)
                   from (select l->>'product_id' as pid, sum((l->>'qty')::numeric) as qty from jsonb_array_elements(q->'lines') l group by 1) a)
              = (select coalesce(jsonb_agg(jsonb_build_array(pid, qty) order by pid, qty), '[]'::jsonb)
                   from (select product_id::text as pid, sum(qty) as qty from order_items where order_id = o.id group by 1) b);
      if (q->>'ok')::boolean and v_same
         and o.subtotal_usd = (q->>'subtotal_usd')::numeric and o.delivery_fee_usd = (q->>'delivery_fee_usd')::numeric
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

-- ---------- the basket of an order: 0015's text; an open scheduled order is quoted for its own window ----------
create or replace function basket_from_order(p_party uuid, p_order uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare o orders%rowtype; ln record; v_all jsonb := '[]'::jsonb; v_ok jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb;
        q jsonb; v_pay text; v_good boolean; v_slot uuid;
begin
  select * into o from orders where id = p_order and customer_id = p_party;
  if not found then return jsonb_build_object('found', false); end if;
  v_slot := case when o.status in ('draft', 'awaiting_confirmation', 'confirmed', 'awaiting_payment') then o.delivery_slot_id end;

  for ln in select i.product_id, f.source_id, i.qty, i.modifiers, i.note, i.raw_phrase
              from order_items i join fulfilments f on f.id = i.fulfilment_id
             where i.order_id = o.id and i.status = 'ok' order by i.id loop
    v_all := v_all || jsonb_build_object('product_id', ln.product_id, 'source_id', ln.source_id, 'qty', ln.qty,
                                         'modifiers', ln.modifiers, 'note', ln.note, 'raw', ln.raw_phrase);
  end loop;
  q := quote_order(v_all, o.village_id, o.is_pickup, v_slot);

  for ln in select x.value as line, p.name_en, p.name_ar from jsonb_array_elements(v_all) x join products p on p.id = (x.value->>'product_id')::uuid loop
    select coalesce(bool_or((y->>'ok')::boolean), false) into v_good from jsonb_array_elements(q->'lines') y
     where y->>'product_id' = ln.line->>'product_id';
    if v_good then v_ok := v_ok || ln.line;
    else v_missing := v_missing || jsonb_build_object('product_id', ln.line->>'product_id', 'name', ln.name_en, 'name_ar', ln.name_ar);
    end if;
  end loop;
  if jsonb_array_length(v_missing) > 0 and jsonb_array_length(v_ok) > 0 then q := quote_order(v_ok, o.village_id, o.is_pickup, v_slot); end if;

  v_pay := o.payment_method::text;
  if customer_requires_prepay(p_party) and v_pay = 'cod' then v_pay := 'whish'; end if;
  return jsonb_build_object('found', true, 'order_id', o.id, 'short_code', o.short_code, 'status', o.status,
    'lines', v_ok, 'missing', v_missing, 'village_id', o.village_id, 'place_id', o.place_id, 'pickup', o.is_pickup,
    'payment_method', v_pay, 'change_for_usd', o.change_for_usd, 'notes', o.customer_notes, 'slot_id', v_slot,
    'quote', case when jsonb_array_length(v_ok) > 0 then q else null end);
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
