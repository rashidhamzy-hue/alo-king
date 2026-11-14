-- Alo King Chouf, session W1 (ordering lane): the customer side of scheduled orders (2.8), C3's requests 1 to 4 and 6, and G1-22.
--
--   * settings.scheduling.day_parts: what "the morning", "noon", "the afternoon" and "the evening" mean in hub-local hours. Data,
--     not code (a person may change them); the words themselves are read by code (packages/agents/src/windows.ts).
--   * open_delivery_windows_when(): the open windows (open_delivery_windows, 0040: never a full one, never past its cut-off) that
--     match a time said in words: a day (today, tomorrow, the day after, a weekday), a part of the day, an hour, before or after.
--   * request_delivery_window(): 0040's text. "Now" on a card is refused while the hub is closed or a line is not in stock now
--     ('now_unavailable', with the open windows): a scheduled card made after hours can never be confirmed for now by a tap.
--   * order_card(): what a card showed, from the order as stored (its lines, fees, dues, credit, window, what it replaces), so a
--     card can be sent again with the window the customer chose, without re-pricing and without a new order.
--   * card_in_hand(): the card waiting on this customer's tap in this conversation, for a time said after the card went out.
--   * drop_scheduled_line() (G1-22): the ops lead lets a scheduled order go without a bought-to-order line that never arrived,
--     before picking. The line is removed, what the order held of it released, the totals follow (recalc_order_lines, 0031), a
--     paid order is owed the line back as credit (as at the shelf, 0031/0107), and the order is released again if it is due.
--     Never the last line (cancel the order instead), never after the order left for picking, never by anyone but ops.
-- No migration after 0040 redefines request_delivery_window; it is started from 0040's text.

update settings set value = value || '{"day_parts": {"morning": ["06:00", "12:00"], "noon": ["11:30", "14:30"], "afternoon": ["12:00", "18:00"], "evening": ["17:00", "23:59"]}}'::jsonb
 where key = 'scheduling' and not (value ? 'day_parts');

-- The windows that match words. p_when: {day_offset, dow, part, at, before, after} (any key may be absent; {} or {"any": true}: all).
create or replace function open_delivery_windows_when(p_village uuid, p_fresh boolean, p_when jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_all jsonb := open_delivery_windows(p_village, p_fresh, 100); w jsonb := coalesce(p_when, '{}'::jsonb);
        v_part jsonb := setting('scheduling')->'day_parts'->(w->>'part');
begin
  if w->>'part' is not null and v_part is null then return '[]'::jsonb; end if;      -- a part nobody defined matches nothing
  return coalesce((select jsonb_agg(x.v order by (x.v->>'starts_at')::timestamptz) from (
    select v from jsonb_array_elements(v_all) v
     where (w->>'day_offset' is null or (v->>'day_offset')::int = (w->>'day_offset')::int)
       and (w->>'dow' is null or (v->>'dow')::int = (w->>'dow')::int)
       and (v_part is null or ((v->>'starts')::time < (v_part->>1)::time and (v->>'ends')::time > (v_part->>0)::time))
       and (w->>'at' is null or ((v->>'starts')::time <= (w->>'at')::time and (v->>'ends')::time > (w->>'at')::time))
       and (w->>'before' is null or (v->>'ends')::time <= (w->>'before')::time)
       and (w->>'after' is null or (v->>'starts')::time >= (w->>'after')::time)
     order by (v->>'starts_at')::timestamptz
     limit coalesce((setting('scheduling')->>'offer_max')::int, 6)) x), '[]'::jsonb);
end $$;

-- The lines of an order as quote_order reads them.
create or replace function order_lines_json(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'source_id', f.source_id, 'qty', i.qty) order by i.id), '[]'::jsonb)
    from order_items i join fulfilments f on f.id = i.fulfilment_id where i.order_id = p_order and i.status = 'ok' $$;

-- 0040's text. On a card not yet confirmed. p_slot null: deliver now, which W1 checks can be done now.
create or replace function request_delivery_window(p_order uuid, p_slot uuid, p_party uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; v_state text; v_fresh boolean; q jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status not in ('draft', 'awaiting_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'status', 'status', o.status, 'short_code', o.short_code);
  end if;
  if p_slot is null then
    -- W1: now means now. After closing time, or with a line that is bought for a window and not in stock, now is refused and
    -- the windows are offered: a card made for a window never becomes a promise for tonight.
    q := quote_order(order_lines_json(p_order), o.village_id, o.is_pickup);
    if exists (select 1 from jsonb_array_elements(q->'issues') i where i->>'code' in ('closed', 'out_of_stock', 'insufficient_stock')) then
      v_fresh := order_bought_to_order(p_order);
      return jsonb_build_object('ok', false, 'reason', 'now_unavailable', 'short_code', o.short_code, 'window', window_json(o.delivery_slot_id),
                                'issues', q->'issues', 'windows', case when o.is_pickup then '[]'::jsonb else open_delivery_windows(o.village_id, v_fresh) end);
    end if;
    update orders set delivery_slot_id = null where id = p_order;
    return jsonb_build_object('ok', true, 'window', null, 'short_code', o.short_code);
  end if;
  if o.is_pickup then return jsonb_build_object('ok', false, 'reason', 'pickup', 'short_code', o.short_code); end if;
  if exists (select 1 from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled' and s.kind <> 'dark_store') then
    return jsonb_build_object('ok', false, 'reason', 'restaurant', 'short_code', o.short_code);     -- Phase 8: the kitchen's own timing
  end if;
  perform generate_delivery_slots();
  v_fresh := order_bought_to_order(p_order);
  v_state := slot_state(p_slot, v_fresh);
  if v_state = 'ok' and exists (select 1 from delivery_slots s where s.id = p_slot and s.zone_id is not null
                                   and s.zone_id is distinct from (select zone_id from villages where id = o.village_id)) then
    v_state := 'zone';
  end if;
  if v_state <> 'ok' then
    if v_state = 'full' then
      perform log_demand('no_slot', 'window_request', p_party, 'slot ' || coalesce((select to_char(starts_at at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI') from delivery_slots where id = p_slot), '?'),
                         null, null, o.village_id, null, jsonb_build_object('slot_id', p_slot, 'order_id', p_order));
    end if;
    return jsonb_build_object('ok', false, 'reason', v_state, 'short_code', o.short_code, 'window', window_json(p_slot),
                              'windows', open_delivery_windows(o.village_id, v_fresh));
  end if;
  update orders set delivery_slot_id = p_slot where id = p_order;
  return jsonb_build_object('ok', true, 'window', window_json(p_slot), 'short_code', o.short_code);
end $$;

-- What a card shows, from the order as stored (the quote's shape, order-card.ts). Only the customer's own order.
create or replace function order_card(p_order uuid, p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'payment_method', o.payment_method,
    'change_for_usd', o.change_for_usd, 'window', window_json(o.delivery_slot_id),
    'replaces', (select r.short_code from orders r where r.id = o.replaces_order_id),
    -- A transfer chosen because a first order was over the cash cap (1.16) says so again on the card sent again.
    'prepay', case when o.payment_method <> 'cod' and coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0) > 0
                        and o.total_usd > (setting('first_order')->>'max_cod_usd')::numeric
                        and not exists (select 1 from orders d where d.customer_id = o.customer_id and d.status in ('delivered', 'closed'))
                   then jsonb_build_object('reason', 'first_order', 'maxCodUsd', (setting('first_order')->>'max_cod_usd')::numeric) end,
    'quote', jsonb_build_object('ok', true, 'issues', '[]'::jsonb,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty, 'unit', p.sell_unit,
                                  'line_total_usd', round(i.qty * i.unit_price_usd, 2), 'modifiers', i.modifiers, 'note', i.note) order by i.id), '[]'::jsonb)
                  from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok'),
      'subtotal_usd', o.subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'small_order_fee_usd', o.small_order_fee_usd,
      'dues_usd', o.dues_usd + c.credit, 'credit_usd', c.credit, 'total_usd', o.total_usd,
      'fx_rate_lbp', coalesce(o.fx_rate_lbp, current_fx()),
      'total_lbp', case when coalesce(o.fx_rate_lbp, current_fx()) is null then null else round(o.total_usd * coalesce(o.fx_rate_lbp, current_fx()) / 1000) * 1000 end,
      'eta_minutes', (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id),
      'pickup', o.is_pickup, 'village_id', o.village_id,
      'village', (select name_en from villages where id = o.village_id), 'village_ar', (select name_ar from villages where id = o.village_id)))
    from orders o, lateral (select coalesce(sum(amount_usd), 0) as credit from credit_applications where order_id = o.id) c
   where o.id = p_order and o.customer_id = p_party $$;

-- The card waiting on this customer's tap in this conversation, if any: the order, its place, whether it may take a window.
create or replace function card_in_hand(p_party uuid, p_conversation uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'village_id', o.village_id, 'pickup', o.is_pickup,
           'fresh', order_bought_to_order(o.id), 'window', window_json(o.delivery_slot_id),
           'hub_only', not exists (select 1 from fulfilments f join sources s on s.id = f.source_id
                                    where f.order_id = o.id and f.status <> 'cancelled' and s.kind <> 'dark_store'),
           'open_now', not exists (select 1 from jsonb_array_elements(quote_order(order_lines_json(o.id), o.village_id, o.is_pickup)->'issues') i
                                    where i->>'code' in ('closed', 'out_of_stock', 'insufficient_stock')))
    from orders o where o.customer_id = p_party and o.conversation_id = p_conversation and o.status = 'awaiting_confirmation'
   order by o.created_at desc limit 1 $$;

-- G1-22: a scheduled order goes without a bought-to-order line that never arrived. The ops lead, with a reason, before picking.
create or replace function drop_scheduled_line(p_order uuid, p_product uuid, p_by uuid, p_reason text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; ln record; v_held numeric; v_amt numeric := 0; v_credit numeric := 0; v_paid boolean; v_released text; v_n int := 0;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.delivery_slot_id is null then raise exception 'NOT_SCHEDULED'; end if;
  if o.status not in ('confirmed', 'awaiting_payment') or exists (select 1 from pick_sessions where order_id = p_order) then
    return jsonb_build_object('ok', false, 'reason', 'picking_started', 'short_code', o.short_code, 'status', o.status);
  end if;
  if not exists (select 1 from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                  join products p on p.id = i.product_id
                 where i.order_id = p_order and i.product_id = p_product and i.status = 'ok' and s.kind = 'dark_store'
                   and p.storage::text = any(bought_to_order_zones())) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_line', 'short_code', o.short_code);
  end if;
  if not exists (select 1 from order_items where order_id = p_order and status = 'ok' and product_id <> p_product) then
    return jsonb_build_object('ok', false, 'reason', 'last_line', 'short_code', o.short_code);    -- nothing left: cancel the order instead
  end if;
  v_paid := exists (select 1 from payments where order_id = p_order and status = 'confirmed');
  for ln in select it.*, f.source_id from order_items it join fulfilments f on f.id = it.fulfilment_id
            where it.order_id = p_order and it.product_id = p_product and it.status = 'ok' for update of it loop
    -- What this order already reserved of the product (part of it may have come in): given back to the shelf.
    select coalesce(-sum(m.qty_delta), 0) into v_held from stock_movements m
     where m.order_id = p_order and m.source_id = ln.source_id and m.product_id = p_product and m.reason in ('reserve', 'release');
    if v_held > 0 then
      update stock_levels set reserved = greatest(reserved - v_held, 0) where source_id = ln.source_id and product_id = p_product;
      insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id, note)
        values (ln.source_id, p_product, v_held, 'release', p_order, p_by, 'scheduled line dropped');
    end if;
    update order_items set status = 'removed' where id = ln.id;
    v_amt := v_amt + round(ln.qty * ln.unit_price_usd, 2);
    if v_paid and round(ln.qty * ln.unit_price_usd, 2) > 0 then
      perform grant_customer_credit(p_order, round(ln.qty * ln.unit_price_usd, 2), 'goods', 'missing_item', p_by, ln.name_snapshot, ln.id, 'schedline:' || ln.id);
      v_credit := v_credit + round(ln.qty * ln.unit_price_usd, 2);
    end if;
    v_n := v_n + 1;
  end loop;
  perform recalc_order_lines(p_order);
  insert into order_events(order_id, from_status, to_status, actor, actor_id, reason)
    values (p_order, o.status, o.status, 'ops', p_by, 'scheduled_line_dropped: ' || btrim(p_reason));
  -- Due already and waiting on this line: it goes now (and the stock-short exception closes) if nothing else is short.
  v_released := release_scheduled_order(p_order);
  return jsonb_build_object('ok', true, 'short_code', o.short_code, 'customer_id', o.customer_id, 'lines', v_n, 'removed_usd', v_amt,
                            'credit_usd', v_credit, 'total_usd', (select total_usd from orders where id = p_order), 'released', v_released);
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
