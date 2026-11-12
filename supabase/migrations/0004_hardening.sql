-- Alo King Chouf: hardening. Fixes the defects found in the system review of 11 November 2026.
--   2. state machine tolerant of lost and late rider taps      -> advance_order_to()
--   3. cash gate counts COD that is assigned but not collected -> driver_pending_cod_usd()
--   4. rider cash kept per currency                             -> driver_cash_native(), confirm_cash_drop()
--   5. timers                                                   -> run_timers()
--   8. indexed catalog search                                   -> folded columns + trigram indexes
-- plus the approved policies: over-short tolerance, damaged notes, customer dues after a failed delivery.

-- New enum values are only used inside function bodies below, which Postgres resolves at run time.
alter type account_kind add value if not exists 'rider_receivable';
alter type account_kind add value if not exists 'customer_receivable';
alter type account_kind add value if not exists 'write_off';

insert into settings(key, value) values
  ('timers',     '{"awaiting_payment_min":30,"awaiting_confirmation_min":60,"draft_min":60,"offer_seconds":90,"dark_after_min":10,"dark_alert_min":20}'),
  ('door_wait',  '{"default_min":8,"outer_min":12}'),
  ('over_short', '{"auto_writeoff_usd":1}'),
  ('fx_breaker', '{"pct":3}')
on conflict (key) do nothing;
update settings set value = '{"max_orders":3,"max_detour_min":8,"max_detour_temp_min":5}' where key = 'batching';

-- Inferred steps are written by the system; drafts can be abandoned.
update order_transitions set actors = array_append(actors, 'system')
 where (from_status, to_status) in (('preparing','ready'), ('ready','out_for_delivery'), ('out_for_delivery','arrived'))
   and not ('system' = any(actors));
insert into order_transitions(from_status, to_status, actors) values ('draft','cancelled','{customer,ops,system}')
on conflict do nothing;

-- ---------- customer dues (failed delivery fee and written-off food, billed to the next order) ----------
alter table orders add column if not exists dues_usd numeric(8,2) not null default 0;
alter table orders drop column total_usd;
alter table orders add column total_usd numeric(10,2) generated always as (subtotal_usd + delivery_fee_usd + tip_usd + dues_usd) stored;

create or replace function customer_dues_usd(p_customer uuid) returns numeric language sql stable as
$$ select coalesce(sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.kind::text = 'customer_receivable' and a.party_id = p_customer $$;

-- Policy: a customer who owes for a failed delivery pays the next order in advance, dues included.
create or replace function customer_requires_prepay(p_customer uuid) returns boolean language sql stable as
$$ select customer_dues_usd(p_customer) > 0 $$;

-- ---------- 2. lost and late taps ----------
-- A rider's tap is a fact about the world, not a step in a wizard. If "Delivered" arrives and "Arrived" never did,
-- the skipped steps are recorded as inferred. A tap for a step already passed is logged and changes nothing.
create or replace function advance_order_to(
  p_order uuid, p_to order_status, p_actor actor_kind, p_actor_id uuid default null, p_meta jsonb default '{}'
) returns order_status language plpgsql as $$
declare path order_status[] := array['confirmed','preparing','ready','out_for_delivery','arrived','delivered']::order_status[];
        cur order_status; i_from int; i_to int; k int;
begin
  select status into cur from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  i_from := array_position(path, cur); i_to := array_position(path, p_to);
  -- a tap that arrives after the order is finished (closed, cancelled, failed, returned) is kept as evidence and changes nothing
  if i_to is not null and cur in ('closed','cancelled','failed_delivery','returned') then
    insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
      values (p_order, cur, cur, p_actor, p_actor_id, 'late_event:' || p_to, p_meta);
    return cur;
  end if;
  if i_from is null or i_to is null then
    return transition_order(p_order, p_to, p_actor, p_actor_id, null, p_meta);
  end if;
  if i_from >= i_to then
    insert into order_events(order_id, from_status, to_status, actor, actor_id, reason, meta)
      values (p_order, cur, cur, p_actor, p_actor_id, 'late_event:' || p_to, p_meta);
    return cur;
  end if;
  for k in (i_from + 1) .. i_to loop
    if k < i_to then
      perform transition_order(p_order, path[k], 'system', p_actor_id, 'inferred_from:' || p_to, p_meta || '{"inferred":true}');
    else
      perform transition_order(p_order, path[k], p_actor, p_actor_id, null, p_meta);
    end if;
  end loop;
  return p_to;
end $$;

-- ---------- 3 and 4. rider cash: per currency, and counting what is still on the road ----------
create or replace function driver_cash_native(p_driver uuid)
returns table (usd numeric, lbp numeric, lbp_carried_usd numeric) language sql stable as $$
  select coalesce(sum(e.amount) filter (where e.currency = 'USD'), 0),
         coalesce(sum(e.amount) filter (where e.currency = 'LBP'), 0),
         coalesce(sum(e.usd_equiv) filter (where e.currency = 'LBP'), 0)
  from ledger_entries e join ledger_accounts a on a.id = e.account_id
  where a.kind = 'driver_cash' and a.party_id = p_driver
$$;

-- Value of the notes in the rider's pocket at today's rate.
create or replace function driver_cash_usd(p_driver uuid) returns numeric language sql stable as $$
  select round(n.usd + case when coalesce(current_fx(), 0) > 0 then n.lbp / current_fx() else n.lbp_carried_usd end, 2)
  from driver_cash_native(p_driver) n
$$;

-- COD the rider has been given but has not yet reported collecting. In a dead zone this can be an hour old.
create or replace function driver_pending_cod_usd(p_driver uuid) returns numeric language sql stable as $$
  select coalesce(sum(o.total_usd), 0)
  from delivery_stops s join deliveries d on d.id = s.delivery_id join orders o on o.id = s.order_id
  where d.driver_id = p_driver and d.status in ('offered','accepted','in_progress') and s.kind = 'dropoff'
    and o.payment_method = 'cod' and o.status not in ('delivered','closed','cancelled','returned','failed_delivery')
    and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')
$$;

create or replace function driver_exposure_usd(p_driver uuid) returns numeric language sql stable as
$$ select driver_cash_usd(p_driver) + driver_pending_cod_usd(p_driver) $$;

create or replace function driver_can_take(p_driver uuid, p_cod_usd numeric) returns text language plpgsql stable as $$
declare v_exposure numeric := driver_exposure_usd(p_driver);
        v_soft numeric := (setting('cash_cap')->>'soft_usd')::numeric;
        v_hard numeric := (setting('cash_cap')->>'hard_usd')::numeric;
begin
  if v_exposure >= v_hard then return 'hard_cap'; end if;
  if p_cod_usd > 0 and v_exposure + p_cod_usd > v_hard then return 'hard_cap'; end if;
  if p_cod_usd > 0 and v_exposure >= v_soft then return 'soft_cap'; end if;
  return 'ok';
end $$;

-- A collection now also settles what the customer owed from a failed delivery.
create or replace function post_cod_collection(
  p_order uuid, p_driver uuid, p_usd numeric, p_lbp numeric, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns numeric language plpgsql as $$
declare o orders%rowtype; v_fx numeric; v_net_usd numeric; v_net_lbp numeric; v_equiv numeric;
        v_txn uuid := gen_random_uuid(); v_cash uuid; v_goods numeric := 0; v_merch numeric := 0; v_net numeric; r record;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method <> 'cod' then raise exception 'NOT_COD'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return driver_cash_usd(p_driver); end if;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  v_net_usd := p_usd - p_change_usd;  v_net_lbp := p_lbp - p_change_lbp;
  v_equiv := round(v_net_usd + v_net_lbp / v_fx, 2);
  if abs(v_equiv - o.total_usd) > 1 then raise exception 'AMOUNT_MISMATCH expected % got %', o.total_usd, v_equiv; end if;

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
    (v_txn, ensure_account('tips_payable:' || p_driver, 'tips_payable', p_driver), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip'),
    (v_txn, ensure_account('cash_over_short', 'cash_over_short'),
     -(v_equiv - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd), 'USD',
     -(v_equiv - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd), p_order, 'Rounding and FX difference');
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  insert into payments(order_id, method, status, amount_usd, received_usd, received_lbp, change_usd, change_lbp, confirmed_by, confirmed_at)
    values (p_order, 'cod', 'confirmed', o.total_usd, p_usd, p_lbp, p_change_usd, p_change_lbp, p_driver, now());
  return driver_cash_usd(p_driver);
end $$;

-- A drop removes the notes actually handed over, each currency from its own balance.
-- LBP leaves at the value it was carried at, so a rider who hands over everything reads exactly zero.
create or replace function confirm_cash_drop(p_drop uuid, p_by uuid) returns numeric language plpgsql as $$
declare d cash_drops%rowtype; n record; v_txn uuid := gen_random_uuid(); v_lbp_equiv numeric; v_to text; v_kind account_kind; v_cash uuid;
begin
  select * into d from cash_drops where id = p_drop for update;
  if not found then raise exception 'DROP_NOT_FOUND'; end if;
  if d.status = 'confirmed' then return driver_cash_usd(d.driver_id); end if;
  select * into n from driver_cash_native(d.driver_id);
  if d.declared_usd > n.usd + 0.005 or d.declared_lbp > n.lbp + 0.5 then raise exception 'DROP_EXCEEDS_BALANCE holds % USD and % LBP', n.usd, n.lbp; end if;
  v_lbp_equiv := case when d.declared_lbp = 0 then 0 when n.lbp > 0 then round(d.declared_lbp * n.lbp_carried_usd / n.lbp, 2)
                      else round(d.declared_lbp / d.fx_rate_lbp, 2) end;
  v_to := case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end;
  v_kind := case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end::account_kind;
  v_cash := ensure_account('driver_cash:' || d.driver_id, 'driver_cash', d.driver_id);
  if d.declared_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_cash, -d.declared_usd, 'USD', -d.declared_usd, 'Cash drop ' || d.method),
      (v_txn, ensure_account(v_to, v_kind), d.declared_usd, 'USD', d.declared_usd, 'Cash drop ' || d.method);
  end if;
  if d.declared_lbp <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_cash, -d.declared_lbp, 'LBP', -v_lbp_equiv, 'Cash drop ' || d.method),
      (v_txn, ensure_account(v_to, v_kind), d.declared_lbp, 'LBP', v_lbp_equiv, 'Cash drop ' || d.method);
  end if;
  update cash_drops set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = p_drop;
  return driver_cash_usd(d.driver_id);
end $$;

create or replace function declare_cash_drop(p_driver uuid, p_method drop_method, p_usd numeric, p_lbp numeric, p_receipt_ref text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into cash_drops(driver_id, shift_id, method, declared_usd, declared_lbp, fx_rate_lbp, receipt_ref)
    values (p_driver, (select id from driver_shifts where driver_id = p_driver and ended_at is null), p_method,
            coalesce(p_usd, 0), coalesce(p_lbp, 0), current_fx(), p_receipt_ref)
    returning id into v_id;
  return v_id;
end $$;

-- Policy: the company absorbs a rider's first damaged note in a calendar month, the rider absorbs the rest.
create or replace function record_damaged_note(p_drop uuid, p_amount_usd numeric, p_by uuid) returns jsonb language plpgsql as $$
declare d cash_drops%rowtype; v_prior int; v_txn uuid := gen_random_uuid(); v_who text; v_acct uuid;
begin
  select * into d from cash_drops where id = p_drop;
  if not found then raise exception 'DROP_NOT_FOUND'; end if;
  select count(*) into v_prior from risk_flags where subject_kind = 'driver' and subject_id = d.driver_id and rule = 'damaged_note'
     and created_at >= date_trunc('month', now());
  v_who := case when v_prior = 0 then 'company' else 'rider' end;
  v_acct := case when v_who = 'company' then ensure_account('write_off', 'write_off'::account_kind)
                 else ensure_account('rider_receivable:' || d.driver_id, 'rider_receivable'::account_kind, d.driver_id) end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, ensure_account(case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end,
                           (case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end)::account_kind), -p_amount_usd, 'USD', -p_amount_usd, 'Damaged note removed'),
    (v_txn, v_acct, p_amount_usd, 'USD', p_amount_usd, 'Damaged note, absorbed by ' || v_who);
  insert into risk_flags(subject_kind, subject_id, rule, severity, details)
    values ('driver', d.driver_id, 'damaged_note', case when v_who = 'rider' then 2 else 1 end,
            jsonb_build_object('drop_id', p_drop, 'amount_usd', p_amount_usd, 'absorbed_by', v_who, 'recorded_by', p_by));
  update cash_drops set status = 'disputed' where id = p_drop and status <> 'confirmed';
  return jsonb_build_object('absorbed_by', v_who, 'amount_usd', p_amount_usd, 'notes_this_month', v_prior + 1);
end $$;

-- ---------- shifts ----------
create or replace function start_shift(p_driver uuid, p_float_usd numeric default 0, p_vehicle uuid default null) returns jsonb language plpgsql as $$
declare v_id uuid; v_new boolean := false;
begin
  if not exists (select 1 from parties where id = p_driver and role = 'driver' and not is_blocked) then raise exception 'NOT_A_DRIVER'; end if;
  select id into v_id from driver_shifts where driver_id = p_driver and ended_at is null;
  if v_id is null then
    insert into driver_shifts(driver_id, vehicle_id, opening_float_usd) values (p_driver, p_vehicle, coalesce(p_float_usd, 0)) returning id into v_id;
    v_new := true;
  end if;
  return jsonb_build_object('shift_id', v_id, 'started', v_new, 'cash_usd', driver_cash_usd(p_driver));
end $$;

-- Policy: a difference of up to 1 USD is written off; anything larger needs the ops lead (p_force_by).
create or replace function close_shift(p_driver uuid, p_force_by uuid default null) returns jsonb language plpgsql as $$
declare v_shift uuid; n record; v_value numeric; v_tol numeric := (setting('over_short')->>'auto_writeoff_usd')::numeric;
        v_txn uuid := gen_random_uuid(); v_cash uuid; v_counter uuid; v_carried numeric;
begin
  select id into v_shift from driver_shifts where driver_id = p_driver and ended_at is null;
  if v_shift is null then return jsonb_build_object('closed', false, 'reason', 'no_open_shift'); end if;
  if exists (select 1 from deliveries where driver_id = p_driver and status in ('accepted','in_progress')) then
    return jsonb_build_object('closed', false, 'reason', 'active_deliveries');
  end if;
  update deliveries set status = 'cancelled' where driver_id = p_driver and status = 'offered';
  select * into n from driver_cash_native(p_driver);
  v_value := driver_cash_usd(p_driver);
  if abs(v_value) > v_tol and p_force_by is null then
    return jsonb_build_object('closed', false, 'reason', 'cash_outstanding', 'usd', n.usd, 'lbp', n.lbp, 'value_usd', v_value);
  end if;
  v_carried := n.usd + n.lbp_carried_usd;
  if n.usd <> 0 or n.lbp <> 0 then
    v_cash := ensure_account('driver_cash:' || p_driver, 'driver_cash', p_driver);
    v_counter := case when abs(v_value) <= v_tol then ensure_account('cash_over_short', 'cash_over_short')
                      else ensure_account('rider_receivable:' || p_driver, 'rider_receivable'::account_kind, p_driver) end;
    if n.usd <> 0 then insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
      values (v_txn, v_cash, -n.usd, 'USD', -n.usd, 'Shift close'); end if;
    if n.lbp <> 0 then insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
      values (v_txn, v_cash, -n.lbp, 'LBP', -n.lbp_carried_usd, 'Shift close'); end if;
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo)
      values (v_txn, v_counter, v_carried, 'USD', v_carried, case when abs(v_value) <= v_tol then 'Over-short within tolerance' else 'Outstanding at shift close' end);
    if abs(v_value) > v_tol then
      insert into risk_flags(subject_kind, subject_id, rule, severity, details)
        values ('driver', p_driver, 'over_short_review', 2, jsonb_build_object('value_usd', v_value, 'usd', n.usd, 'lbp', n.lbp, 'forced_by', p_force_by));
    end if;
  end if;
  update driver_shifts set ended_at = now() where id = v_shift;
  return jsonb_build_object('closed', true, 'written_off_usd', case when abs(v_value) <= v_tol then v_value else 0 end,
                            'outstanding_usd', case when abs(v_value) > v_tol then v_value else 0 end);
end $$;

-- ---------- 5. timers. Called by cron every two minutes; returns what the worker must tell people. ----------
create or replace function run_timers() returns jsonb language plpgsql as $$
declare t jsonb := setting('timers'); r record; v_orders jsonb := '[]'::jsonb; v_offers jsonb := '[]'::jsonb; v_alerts jsonb := '[]'::jsonb;
begin
  for r in select id, short_code, customer_id, status from orders
            where (status = 'awaiting_payment'      and coalesce(confirmed_at, created_at) < now() - make_interval(mins => (t->>'awaiting_payment_min')::int))
               or (status = 'awaiting_confirmation' and created_at < now() - make_interval(mins => (t->>'awaiting_confirmation_min')::int))
               or (status = 'draft'                 and created_at < now() - make_interval(mins => (t->>'draft_min')::int))
            for update skip locked loop
    perform transition_order(r.id, 'cancelled', 'system', null, 'timeout:' || r.status);
    if r.status <> 'draft' then
      v_orders := v_orders || jsonb_build_object('order_id', r.id, 'short_code', r.short_code, 'customer_id', r.customer_id, 'was', r.status);
    end if;
  end loop;

  for r in select d.id, d.driver_id, array_agg(s.order_id) filter (where s.kind = 'dropoff') as orders
             from deliveries d join delivery_stops s on s.delivery_id = d.id
            where d.status = 'offered' and d.offered_at < now() - make_interval(secs => (t->>'offer_seconds')::int)
            group by d.id, d.driver_id loop
    update deliveries set status = 'expired' where id = r.id;
    v_offers := v_offers || jsonb_build_object('delivery_id', r.id, 'driver_id', r.driver_id, 'orders', to_jsonb(r.orders));
  end loop;

  -- riders at a door past the wait limit, and orders on the road far past their expected time
  for r in select o.id, o.short_code, d.driver_id, s.arrived_at from orders o join delivery_stops s on s.order_id = o.id and s.kind = 'dropoff'
             join deliveries d on d.id = s.delivery_id
            where o.status = 'arrived' and s.arrived_at < now() - make_interval(mins => (setting('door_wait')->>'default_min')::int) loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'door_wait_exceeded', 'order_id', r.id, 'short_code', r.short_code, 'driver_id', r.driver_id);
  end loop;
  for r in select d.id, d.driver_id, max(e.created_at) as last_event from deliveries d
             join delivery_stops s on s.delivery_id = d.id and s.kind = 'dropoff' join order_events e on e.order_id = s.order_id
            where d.status = 'in_progress' group by d.id, d.driver_id
           having max(e.created_at) < now() - make_interval(mins => 25 + (t->>'dark_alert_min')::int) loop
    v_alerts := v_alerts || jsonb_build_object('kind', 'rider_dark', 'delivery_id', r.id, 'driver_id', r.driver_id, 'last_event', r.last_event);
  end loop;
  return jsonb_build_object('cancelled_orders', v_orders, 'expired_offers', v_offers, 'alerts', v_alerts);
end $$;

-- ---------- 8. indexed search ----------
alter table product_aliases add column if not exists alias_folded text generated always as (fold_text(alias)) stored;
create index if not exists product_aliases_folded_trgm on product_aliases using gin (alias_folded gin_trgm_ops);
alter table products add column if not exists search_folded text
  generated always as (fold_text(coalesce(name_en, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(name_ar, ''))) stored;
create index if not exists products_folded_trgm on products using gin (search_folded gin_trgm_ops);

create or replace function search_catalog(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable as $$
declare q text := fold_text(p_query); v_sources uuid[]; v_matches jsonb;
begin
  if p_source_hint is not null and btrim(p_source_hint) <> '' then
    select array_agg(id) into v_sources from sources
     where kind = 'merchant' and similarity(fold_text(name), fold_text(p_source_hint)) > 0.35;
    if v_sources is null then
      return jsonb_build_object('matches', '[]'::jsonb, 'reason', 'merchant_not_onboarded', 'source_hint', p_source_hint);
    end if;
  end if;

  with candidates as (            -- the trigram indexes do the narrowing
    select product_id as id from product_aliases where alias_folded % q
    union select id from products where search_folded % q
  ), scored as (
    select p.id, greatest(
             similarity(p.search_folded, q),
             coalesce((select max(greatest(similarity(a.alias_folded, q), word_similarity(a.alias_folded, q) * 0.9))
                       from product_aliases a where a.product_id = p.id), 0)) as score
    from products p join candidates c on c.id = p.id where p.is_active
  ), ranked as (
    select p.id as product_id, p.sku, p.name_en, p.name_ar, p.brand, p.category, p.sub_type, p.sell_unit, p.velocity_tier,
           s.id as source_id, s.name as source_name, s.kind as source_kind, o.price_usd, o.sponsored_rank,
           case when s.kind = 'dark_store' then coalesce(l.on_hand - l.reserved, 0)
                when o.is_available and s.is_open then 999 else 0 end as available,
           sc.score
    from scored sc join products p on p.id = sc.id
    join offers o on o.product_id = p.id join sources s on s.id = o.source_id
    left join stock_levels l on l.product_id = p.id and l.source_id = s.id
    where sc.score >= 0.5 and (v_sources is null or s.id = any(v_sources))
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc, (r.available > 0) desc, r.sponsored_rank nulls last, r.velocity_tier nulls last, r.price_usd), '[]'::jsonb)
    into v_matches
  from (select * from ranked order by score desc, (available > 0) desc, sponsored_rank nulls last, velocity_tier nulls last, price_usd limit p_limit) r;

  return jsonb_build_object('matches', v_matches,
    'reason', case when jsonb_array_length(v_matches) = 0 then 'no_match' else null end);
end $$;
