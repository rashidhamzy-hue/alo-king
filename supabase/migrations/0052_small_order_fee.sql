-- 0052 (session B2, build plan 1.16; lane B overflow numbers): the small-order fee and the first-order cash cap.
-- Both are read from settings that exist since 0011 and are off (0) until the founder sets them (docs/DECISIONS.md;
-- supabase/seed/proposed_pilot_settings.sql holds the proposal of 0.50 USD under 10 USD).
--   * The small-order fee is company income. It has its own column on the order, its own line on the card and its own
--     ledger account (revenue_small_order). It is never part of the delivery fee, which belongs to the rider (invariant 10),
--     so settle_rider_earnings (0009), which moves only delivery_fee_usd and tips, needs no change.
--   * A customer with no delivered order who would pay cash above settings.first_order.max_cod_usd is asked to pay that first
--     order in advance: create_order_from_quote refuses cash with issue first_order_cod_cap, as it already does for dues.
-- Functions redefined here are copied from their latest versions (quote_order 0003, create_order_from_quote 0005,
-- post_cod_collection 0004, confirm_payment 0006) with only the lines marked 1.16 changed.

alter type account_kind add value if not exists 'revenue_small_order';

alter table orders add column if not exists small_order_fee_usd numeric(8,2) not null default 0 check (small_order_fee_usd >= 0);
alter table orders drop column total_usd;
alter table orders add column total_usd numeric(10,2) generated always as (subtotal_usd + delivery_fee_usd + small_order_fee_usd + tip_usd + dues_usd) stored;

-- ---------- the quote: the fee as its own line, in the total ----------
create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false)
returns jsonb language plpgsql stable as $$
declare ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric := 0; v_eta int; v_small numeric := 0; v_sof jsonb := setting('small_order_fee');
        v_fx numeric := current_fx(); v_hours jsonb := setting('hours'); v_now time; v_min numeric := (setting('min_order_usd'))::text::numeric;
        o record; v_free numeric; v_qty numeric; v_ok boolean; v_subs jsonb; v_served boolean;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 1);
    select p.id, p.sku, p.name_en, p.name_ar, p.category, p.sub_type, p.sell_unit, ofr.price_usd, ofr.is_available,
           s.id as source_id, s.name as source_name, s.kind, s.is_open,
           coalesce(l.on_hand - l.reserved, 0) as free
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
    v_free := case when o.kind = 'dark_store' then o.free when o.is_available and o.is_open then 999 else 0 end;
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
                    'product_id', o.id, 'name', o.name_en, 'available', v_free, 'substitutes', v_subs);
    else
      v_sub := v_sub + round(o.price_usd * v_qty, 2);
    end if;
    v_lines := v_lines || jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                 'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', o.price_usd, 'line_total_usd', round(o.price_usd * v_qty, 2),
                 'source_id', o.source_id, 'source', o.source_name, 'ok', v_ok,
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
  v_now := (now() at time zone coalesce(v_hours->>'tz', 'Asia/Beirut'))::time;
  if v_now < (v_hours->>'open')::time or v_now >= (v_hours->>'close')::time then
    v_issues := v_issues || jsonb_build_object('code', 'closed', 'opens', v_hours->>'open', 'closes', v_hours->>'close');
  end if;
  if v_fx is null then v_issues := v_issues || jsonb_build_object('code', 'no_exchange_rate'); end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'lines', v_lines,
    'subtotal_usd', v_sub, 'delivery_fee_usd', v_fee, 'small_order_fee_usd', v_small, 'total_usd', v_sub + v_fee + v_small,
    'fx_rate_lbp', v_fx, 'total_lbp', case when v_fx is null then null else round((v_sub + v_fee + v_small) * v_fx / 1000) * 1000 end,
    'eta_minutes', case when p_pickup then null else v_eta end, 'pickup', p_pickup, 'village_id', p_village,
    'village', (select name_en from villages where id = p_village),
    'village_ar', (select name_ar from villages where id = p_village));
end $$;

-- ---------- the order: the fee stored; the first-order cap enforced ----------
create or replace function create_order_from_quote(
  p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null
) returns jsonb language plpgsql as $$
declare q jsonb := quote_order(p_lines, p_village, p_pickup); v_order uuid; v_code text; ln jsonb; v_ful uuid; v_stale uuid;
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
                     small_order_fee_usd, dues_usd, payment_method, change_for_usd, customer_notes)
    values (v_code, p_customer, p_conversation, p_village, p_place, p_pickup, (q->>'subtotal_usd')::numeric,
            (q->>'delivery_fee_usd')::numeric, coalesce((q->>'small_order_fee_usd')::numeric, 0), v_dues, p_payment, p_change_for, p_notes)
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

-- ---------- cash collected: the fee to its own revenue account ----------
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
     -(v_equiv - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd), 'USD',
     -(v_equiv - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd), p_order, 'Rounding and FX difference');
  if o.small_order_fee_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_small_order', 'revenue_small_order'::account_kind), -o.small_order_fee_usd, 'USD', -o.small_order_fee_usd, p_order, 'Small-order fee');
  end if;
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  insert into payments(order_id, method, status, amount_usd, received_usd, received_lbp, change_usd, change_lbp, confirmed_by, confirmed_at)
    values (p_order, 'cod', 'confirmed', o.total_usd, p_usd, p_lbp, p_change_usd, p_change_lbp, p_driver, now());
  return driver_cash_usd(p_driver);
end $$;

-- ---------- transfer confirmed: the same ----------
create or replace function confirm_payment(p_order uuid, p_by uuid, p_external_ref text, p_amount_usd numeric) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_txn uuid := gen_random_uuid(); v_goods numeric := 0; v_merch numeric := 0; v_net numeric; r record; v_kind account_kind;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method = 'cod' then raise exception 'COD_ORDER'; end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if o.status = 'cancelled' then raise exception 'ORDER_CANCELLED_REFUND_NEEDED'; end if;
  if p_external_ref is null or length(trim(p_external_ref)) < 4 then raise exception 'REFERENCE_REQUIRED'; end if;
  if exists (select 1 from payments where method = o.payment_method and external_ref = p_external_ref and status = 'confirmed') then
    raise exception 'REFERENCE_ALREADY_USED %', p_external_ref; end if;
  if p_amount_usd < o.total_usd - 0.01 then raise exception 'UNDERPAID expected % got %', o.total_usd, p_amount_usd; end if;

  v_kind := case when o.payment_method = 'whish' then 'whish_clearing' else 'omt_clearing' end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
    values (v_txn, ensure_account(v_kind::text, v_kind), p_amount_usd, 'USD', p_amount_usd, p_order, 'Transfer ' || p_external_ref);
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
    (v_txn, ensure_account('tips_payable', 'tips_payable'), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip'),
    (v_txn, ensure_account('cash_over_short', 'cash_over_short'),
     -(p_amount_usd - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd), 'USD',
     -(p_amount_usd - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd), p_order, 'Overpayment or rounding');
  if o.small_order_fee_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_small_order', 'revenue_small_order'::account_kind), -o.small_order_fee_usd, 'USD', -o.small_order_fee_usd, p_order, 'Small-order fee');
  end if;
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  update payments set status = 'confirmed', external_ref = p_external_ref, received_usd = p_amount_usd, confirmed_by = p_by, confirmed_at = now()
   where order_id = p_order and status in ('pending','proof_submitted');
  if not found then
    insert into payments(order_id, method, status, amount_usd, received_usd, external_ref, confirmed_by, confirmed_at)
      values (p_order, o.payment_method, 'confirmed', o.total_usd, p_amount_usd, p_external_ref, p_by, now());
  end if;
  if o.status = 'awaiting_payment' then perform transition_order(p_order, 'confirmed', 'ops', p_by, 'payment_confirmed'); end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'confirmed');
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
