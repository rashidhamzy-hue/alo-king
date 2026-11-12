-- Alo King Chouf: the rules. Agents and workers change state only through these functions.

-- ---------- helpers ----------
create or replace function setting(p_key text) returns jsonb language sql stable as
$$ select value from settings where key = p_key $$;

create or replace function current_fx() returns numeric language sql stable as
$$ select lbp_per_usd from fx_rates where effective_from <= now() order by effective_from desc limit 1 $$;

create or replace function ensure_account(p_code text, p_kind account_kind, p_party uuid default null, p_source uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from ledger_accounts where code = p_code;
  if v is null then
    insert into ledger_accounts(code, kind, party_id, source_id) values (p_code, p_kind, p_party, p_source) returning id into v;
  end if;
  return v;
end $$;

-- Every ledger transaction must balance. Checked once per transaction at commit.
create or replace function ledger_must_balance() returns trigger language plpgsql as $$
declare v numeric;
begin
  select coalesce(sum(usd_equiv), 0) into v from ledger_entries where txn_id = new.txn_id;
  if abs(v) > 0.005 then
    raise exception 'LEDGER_UNBALANCED txn % off by %', new.txn_id, v;
  end if;
  return null;
end $$;

create constraint trigger ledger_balance_check after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_must_balance();

-- ---------- consent and the compliance gate ----------
create or replace function has_consent(p_party uuid, p_line wa_line, p_kind consent_kind) returns boolean language sql stable as
$$ select coalesce((select action = 'opt_in' from consent_current
                    where party_id = p_party and line = p_line and kind = p_kind), false) $$;

-- The only question the outbound gateway asks before any send. Returns 'ok' or a refusal code.
create or replace function can_send(p_party uuid, p_line wa_line, p_category msg_category, p_is_template boolean)
returns text language plpgsql stable as $$
declare
  v_blocked boolean; v_last timestamptz; v_window_open boolean;
  v_freq jsonb := setting('marketing_frequency'); v_count int; v_latest timestamptz;
begin
  select is_blocked into v_blocked from parties where id = p_party;
  if v_blocked is null then return 'unknown_party'; end if;
  if v_blocked then return 'blocked'; end if;

  select last_inbound_at into v_last from conversations where party_id = p_party and line = p_line;
  v_window_open := v_last is not null and v_last > now() - interval '24 hours';

  if p_category = 'marketing' then
    if p_line <> 'customer' then return 'marketing_wrong_line'; end if;
    if not p_is_template then return 'marketing_needs_template'; end if;
    if not has_consent(p_party, p_line, 'marketing') then return 'no_marketing_opt_in'; end if;
    select count(*), max(created_at) into v_count, v_latest from wa_messages
      where party_id = p_party and direction = 'outbound' and category = 'marketing'
        and created_at > now() - interval '30 days';
    if v_count >= (v_freq->>'max_per_30d')::int then return 'marketing_frequency_cap'; end if;
    if v_latest is not null and v_latest > now() - make_interval(hours => (v_freq->>'min_gap_hours')::int) then
      return 'marketing_min_gap';
    end if;
    return 'ok';
  end if;

  if exists (select 1 from consent_current where party_id = p_party and line = p_line
             and kind = 'transactional' and action = 'opt_out') then
    return 'opted_out';
  end if;

  if p_is_template then
    if not has_consent(p_party, p_line, 'transactional') then return 'no_transactional_opt_in'; end if;
    return 'ok';
  end if;

  if not v_window_open then return 'window_closed_use_template'; end if;
  return 'ok';
end $$;

-- ---------- stock ----------
create or replace function reserve_stock(p_order uuid) returns void language plpgsql as $$
declare r record; v_updated int;
begin
  for r in
    select f.source_id, i.product_id, sum(i.qty) as qty
    from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
    where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store'
    group by f.source_id, i.product_id
  loop
    update stock_levels set reserved = reserved + r.qty
      where source_id = r.source_id and product_id = r.product_id and on_hand - reserved >= r.qty;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then raise exception 'OUT_OF_STOCK %', r.product_id; end if;
    insert into stock_movements(source_id, product_id, qty_delta, reason, order_id)
      values (r.source_id, r.product_id, -r.qty, 'reserve', p_order);
  end loop;
end $$;

create or replace function settle_stock(p_order uuid, p_picked boolean) returns void language plpgsql as $$
declare r record;
begin
  for r in
    select source_id, product_id, -sum(qty_delta) as qty from stock_movements
    where order_id = p_order and reason in ('reserve','release','pick')
    group by source_id, product_id having -sum(qty_delta) > 0
  loop
    update stock_levels
      set reserved = reserved - r.qty, on_hand = on_hand - case when p_picked then r.qty else 0 end
      where source_id = r.source_id and product_id = r.product_id;
    insert into stock_movements(source_id, product_id, qty_delta, reason, order_id)
      values (r.source_id, r.product_id, r.qty, case when p_picked then 'pick' else 'release' end::stock_reason, p_order);
  end loop;
end $$;

-- ---------- the order state machine ----------
create or replace function transition_order(
  p_order uuid, p_to order_status, p_actor actor_kind,
  p_actor_id uuid default null, p_reason text default null, p_meta jsonb default '{}'
) returns order_status language plpgsql as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.status = p_to then return o.status; end if;   -- idempotent: webhooks retry

  if not exists (select 1 from order_transitions
                 where from_status = o.status and to_status = p_to and p_actor = any(actors)) then
    raise exception 'ILLEGAL_TRANSITION % -> % by %', o.status, p_to, p_actor;
  end if;

  if o.status = 'awaiting_confirmation' and p_to in ('confirmed','awaiting_payment') then
    if not exists (select 1 from order_items where order_id = p_order and status = 'ok') then
      raise exception 'EMPTY_ORDER';
    end if;
    if o.village_id is null and not o.is_pickup then raise exception 'NO_DELIVERY_LOCATION'; end if;
    if not has_consent(o.customer_id, 'customer', 'transactional') then raise exception 'NO_CONSENT'; end if;
    if p_to = 'confirmed' and o.payment_method <> 'cod' then raise exception 'PREPAY_REQUIRED'; end if;
    if p_to = 'awaiting_payment' and o.payment_method = 'cod' then raise exception 'COD_NEEDS_NO_PAYMENT_STEP'; end if;
    perform reserve_stock(p_order);
    update orders set fx_rate_lbp = current_fx(), confirmed_at = now() where id = p_order;
  end if;

  if o.status = 'awaiting_payment' and p_to = 'confirmed'
     and not exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    raise exception 'PAYMENT_NOT_CONFIRMED';
  end if;

  if p_to = 'out_for_delivery' and not exists (
       select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
       where s.order_id = p_order and s.kind = 'dropoff' and d.status in ('accepted','in_progress')) then
    raise exception 'NO_ACCEPTED_DELIVERY';
  end if;

  -- Handing over is a logistics fact and may be recorded on its own. Closing is the financial fact:
  -- a delivered order cannot close until its money is recorded (cash counted by the rider, or a transfer confirmed by ops).
  if p_to = 'closed' and o.status = 'delivered'
     and not exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    raise exception 'PAYMENT_NOT_RECORDED';
  end if;

  if p_to = 'ready' then perform settle_stock(p_order, true); end if;
  if p_to = 'cancelled' and o.status in ('awaiting_payment','confirmed','preparing') then
    perform settle_stock(p_order, false);
  end if;

  update orders set status = p_to,
         delivered_at  = case when p_to = 'delivered' then now() else delivered_at end,
         cancel_reason = case when p_to = 'cancelled' then p_reason else cancel_reason end
   where id = p_order;
  insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
    values (p_order, o.status, p_to, p_actor, p_actor_id, p_reason, p_meta);
  return p_to;
end $$;

-- ---------- driver cash ----------
create or replace function driver_cash_usd(p_driver uuid) returns numeric language sql stable as
$$ select coalesce(sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.kind = 'driver_cash' and a.party_id = p_driver $$;

-- 'ok' | 'soft_cap' (no more COD until a drop) | 'hard_cap' (no jobs at all until a drop)
create or replace function driver_can_take(p_driver uuid, p_cod_usd numeric) returns text language plpgsql stable as $$
declare v_cash numeric := driver_cash_usd(p_driver);
        v_soft numeric := (setting('cash_cap')->>'soft_usd')::numeric;
        v_hard numeric := (setting('cash_cap')->>'hard_usd')::numeric;
begin
  if v_cash >= v_hard then return 'hard_cap'; end if;
  if p_cod_usd > 0 and v_cash + p_cod_usd > v_hard then return 'hard_cap'; end if;
  if p_cod_usd > 0 and v_cash >= v_soft then return 'soft_cap'; end if;
  return 'ok';
end $$;

create or replace function offer_delivery(p_driver uuid, p_orders uuid[]) returns uuid language plpgsql as $$
declare v_shift uuid; v_cod numeric; v_gate text; v_delivery uuid; v_seq int := 0; r record;
begin
  select id into v_shift from driver_shifts where driver_id = p_driver and ended_at is null;
  if v_shift is null then raise exception 'DRIVER_NOT_ON_SHIFT'; end if;

  select coalesce(sum(total_usd), 0) into v_cod from orders where id = any(p_orders) and payment_method = 'cod';
  v_gate := driver_can_take(p_driver, v_cod);
  if v_gate <> 'ok' then raise exception 'CASH_CAP %', v_gate; end if;

  insert into deliveries(driver_id, shift_id) values (p_driver, v_shift) returning id into v_delivery;
  for r in select distinct f.source_id from fulfilments f where f.order_id = any(p_orders) loop
    v_seq := v_seq + 1;
    insert into delivery_stops(delivery_id, seq, kind, source_id) values (v_delivery, v_seq, 'pickup', r.source_id);
  end loop;
  for r in select o.id, p.lat, p.lng from unnest(p_orders) with ordinality as u(id, ord)
           join orders o on o.id = u.id left join customer_places p on p.id = o.place_id order by u.ord loop
    v_seq := v_seq + 1;
    insert into delivery_stops(delivery_id, seq, kind, order_id, lat, lng) values (v_delivery, v_seq, 'dropoff', r.id, r.lat, r.lng);
  end loop;
  return v_delivery;
end $$;

-- Driver reports what the customer handed over. Posts the ledger and marks the payment confirmed.
create or replace function post_cod_collection(
  p_order uuid, p_driver uuid, p_usd numeric, p_lbp numeric, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns numeric language plpgsql as $$
declare o orders%rowtype; v_fx numeric; v_net_usd numeric; v_net_lbp numeric; v_equiv numeric; v_diff numeric;
        v_txn uuid := gen_random_uuid(); v_cash uuid; v_goods numeric := 0; v_merch_total numeric := 0; r record;
begin
  select * into o from orders where id = p_order for update;
  if o.payment_method <> 'cod' then raise exception 'NOT_COD'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return 0; end if;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  v_net_usd := p_usd - p_change_usd;  v_net_lbp := p_lbp - p_change_lbp;
  v_equiv := round(v_net_usd + v_net_lbp / v_fx, 2);
  v_diff  := v_equiv - o.total_usd;
  if abs(v_diff) > 1 then raise exception 'AMOUNT_MISMATCH expected % got %', o.total_usd, v_equiv; end if;

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
           from fulfilments f join sources s on s.id = f.source_id
           where f.order_id = p_order and f.status <> 'cancelled' loop
    if r.kind = 'dark_store' then
      v_goods := v_goods + r.subtotal_usd;
    else
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
        (v_txn, ensure_account('merchant_payable:' || r.source_id, 'merchant_payable', null, r.source_id),
         -round(r.subtotal_usd * (1 - r.commission_pct / 100), 2), 'USD', -round(r.subtotal_usd * (1 - r.commission_pct / 100), 2), p_order, 'Owed to merchant'),
        (v_txn, ensure_account('revenue_commission', 'revenue_commission'),
         -(r.subtotal_usd - round(r.subtotal_usd * (1 - r.commission_pct / 100), 2)), 'USD',
         -(r.subtotal_usd - round(r.subtotal_usd * (1 - r.commission_pct / 100), 2)), p_order, 'Commission');
      v_merch_total := v_merch_total + r.subtotal_usd;
    end if;
  end loop;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account('revenue_goods', 'revenue_goods'), -v_goods, 'USD', -v_goods, p_order, 'Goods'),
    (v_txn, ensure_account('revenue_delivery', 'revenue_delivery'), -o.delivery_fee_usd, 'USD', -o.delivery_fee_usd, p_order, 'Delivery fee'),
    (v_txn, ensure_account('tips_payable:' || p_driver, 'tips_payable', p_driver), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip'),
    (v_txn, ensure_account('cash_over_short', 'cash_over_short'),
     -(v_equiv - v_goods - v_merch_total - o.delivery_fee_usd - o.tip_usd), 'USD',
     -(v_equiv - v_goods - v_merch_total - o.delivery_fee_usd - o.tip_usd), p_order, 'Rounding and FX difference');

  insert into payments(order_id, method, status, amount_usd, received_usd, received_lbp, change_usd, change_lbp, confirmed_by, confirmed_at)
    values (p_order, 'cod', 'confirmed', o.total_usd, p_usd, p_lbp, p_change_usd, p_change_lbp, p_driver, now());
  return driver_cash_usd(p_driver);   -- balance after this collection
end $$;

-- Hub drops are confirmed by the ops lead counting the cash. OMT drops by a matched receipt.
create or replace function confirm_cash_drop(p_drop uuid, p_by uuid) returns numeric language plpgsql as $$
declare d cash_drops%rowtype; v_txn uuid := gen_random_uuid(); v_equiv numeric; v_to uuid;
begin
  select * into d from cash_drops where id = p_drop for update;
  if d.status = 'confirmed' then return driver_cash_usd(d.driver_id); end if;
  v_equiv := round(d.declared_usd + d.declared_lbp / d.fx_rate_lbp, 2);
  v_to := case d.method when 'hub' then ensure_account('hub_cash', 'hub_cash')
                        else ensure_account('omt_clearing', 'omt_clearing') end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, ensure_account('driver_cash:' || d.driver_id, 'driver_cash', d.driver_id), -v_equiv, 'USD', -v_equiv, 'Cash drop ' || d.method),
    (v_txn, v_to, v_equiv, 'USD', v_equiv, 'Cash drop ' || d.method);
  update cash_drops set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = p_drop;
  return driver_cash_usd(d.driver_id);
end $$;

-- ---------- catalog search used by the Concierge tool ----------
create or replace function search_products(p_query text, p_source uuid default null, p_limit int default 8)
returns table (product_id uuid, name_en text, name_ar text, brand text, price_usd numeric, available numeric, score real)
language sql stable as $$
  with hits as (
    select p.id, greatest(
             similarity(coalesce(p.name_en,'') || ' ' || coalesce(p.name_ar,'') || ' ' || coalesce(p.brand,''), p_query),
             coalesce((select max(similarity(a.alias, p_query)) from product_aliases a where a.product_id = p.id), 0)) as score
    from products p where p.is_active
  )
  select p.id, p.name_en, p.name_ar, p.brand, o.price_usd,
         coalesce(s.on_hand - s.reserved, case when o.is_available then 999 else 0 end) as available, h.score
  from hits h join products p on p.id = h.id
  join offers o on o.product_id = p.id and (p_source is null or o.source_id = p_source)
  left join stock_levels s on s.product_id = p.id and s.source_id = o.source_id
  where h.score > 0.12
  order by (o.sponsored_rank is not null) desc, h.score desc
  limit p_limit
$$;
