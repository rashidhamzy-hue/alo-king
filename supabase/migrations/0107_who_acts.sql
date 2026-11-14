-- Alo King Chouf, session F1 (G1 fixes): who acts, checked in the base functions (G1-07); the role against the line in can_send (G1-25).
--
-- G1-07. Today only the server role calls these, through callers that check the person; the base functions now check too
--   (defence in depth), with require_role (0045): the role, and that the party is not blocked.
--     * declare_cash_drop (0004) took any party and any amount, negative included. Now the rider declares their own drop
--       (require_role driver), or the ops lead or an admin declares it for them (new p_by: receive_rider_cash, 0035, passes its
--       checked ops lead, so a removed rider's cash still comes back). Amounts are zero or more, and not both zero (BAD_AMOUNT).
--     * grant_customer_credit (0030): a named person must be a picker (for a line missing at the pick only), the ops lead or an
--       admin. With no person, only the reasons code gives itself: substitute_cheaper (0032), order_cancelled (0040) and
--       missing_at_pick (pick_remove_line after the customer's answer or the offer's expiry, 0032).
--     * apply_customer_credit (0030): a named person must be the ops lead or an admin; with none (the Concierge applying the
--       customer's own credit to their new order) as before.
--     * the pick helpers pick_short_line, pick_remove_line (0031), pick_decide_missing, pick_found_held (0032): a named person must
--       be a picker, the ops lead or an admin (with none: the customer's answer or the offer's expiry, as before). Their callers
--       already checked staff_can_pick; open_complaint already checked complaint_staff (0048, not blocked): unchanged.
--   confirm_payment, review_payment_proof and pay_rider_earnings (G1-06) are in 0105 and 0106.
-- G1-25. "Two numbers never cross" held because conversations, consent and addresses are per line. can_send (start: 0063) now also
--   checks it outright: a customer is never sent anything on the ops line, and staff (rider, picker, ops lead, admin, merchant)
--   never on the customer line ('wrong_line'). Marketing is still refused first.
-- Anyone redefining these: start from here.

-- ---------- declare_cash_drop: the rider, or the ops lead for them; never a negative or empty drop ----------
drop function if exists declare_cash_drop(uuid, drop_method, numeric, numeric, text);
create or replace function declare_cash_drop(p_driver uuid, p_method drop_method, p_usd numeric, p_lbp numeric, p_receipt_ref text default null,
                                             p_by uuid default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_by is null then
    perform require_role(p_driver, array['driver']);                    -- the rider declares their own drop
  else
    perform require_role(p_by, array['ops_lead', 'admin']);             -- ops takes it in for them, a removed rider included
    if not exists (select 1 from parties where id = p_driver and role = 'driver') then raise exception 'NOT_AUTHORISED (not a rider)'; end if;
  end if;
  if coalesce(p_usd, 0) < 0 or coalesce(p_lbp, 0) < 0 or (coalesce(p_usd, 0) = 0 and coalesce(p_lbp, 0) = 0) then raise exception 'BAD_AMOUNT'; end if;
  insert into cash_drops(driver_id, shift_id, method, declared_usd, declared_lbp, fx_rate_lbp, receipt_ref)
    values (p_driver, (select id from driver_shifts where driver_id = p_driver and ended_at is null), p_method,
            coalesce(p_usd, 0), coalesce(p_lbp, 0), current_fx(), p_receipt_ref)
    returning id into v_id;
  return v_id;
end $$;

-- ---------- receive_rider_cash (0035): declares the drop as the ops lead ----------
create or replace function receive_rider_cash(p_driver uuid, p_by uuid) returns jsonb language plpgsql as $$
declare n record; v_drop uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into n from driver_cash_native(p_driver);
  if n.usd = 0 and n.lbp = 0 then return jsonb_build_object('ok', true, 'usd', 0, 'lbp', 0, 'nothing', true); end if;
  v_drop := declare_cash_drop(p_driver, 'hub', n.usd, n.lbp, null, p_by);
  perform confirm_cash_drop(v_drop, p_by);
  return jsonb_build_object('ok', true, 'usd', n.usd, 'lbp', n.lbp, 'drop_id', v_drop, 'cash_left_usd', driver_cash_usd(p_driver));
end $$;


-- ---------- grant_customer_credit (0030) ----------
create or replace function grant_customer_credit(p_order uuid, p_amount numeric, p_charged_to text, p_reason text, p_by uuid,
                                                 p_note text default null, p_item uuid default null, p_key text default null)
returns uuid language plpgsql as $$
declare o orders%rowtype; v_id uuid; v_txn uuid := gen_random_uuid(); v_amt numeric := round(p_amount, 2); v_code text; v_kind account_kind;
        v_paid numeric; v_refunded numeric; v_cap numeric; v_role text;
begin
  if p_by is not null then                                                                -- G1-07
    v_role := require_role(p_by, array['picker', 'ops_lead', 'admin']);
    if v_role = 'picker' and p_reason is distinct from 'missing_at_pick' then raise exception 'NOT_AUTHORISED'; end if;
  elsif p_reason is null or p_reason not in ('substitute_cheaper', 'order_cancelled', 'missing_at_pick') then
    raise exception 'NOT_AUTHORISED (a person must grant this credit)';
  end if;
  if p_key is not null then
    select id into v_id from refunds where request_key = p_key;
    if v_id is not null then return v_id; end if;
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  select coalesce(sum(amount_usd), 0) into v_paid from payments where order_id = p_order and status = 'confirmed';
  if v_paid <= 0 then raise exception 'ORDER_NOT_PAID (an unpaid order is corrected, not refunded)'; end if;
  select coalesce(sum(amount_usd), 0) into v_refunded from refunds where order_id = p_order;
  if v_refunded + v_amt > v_paid + 0.005 then raise exception 'REFUND_EXCEEDS_PAID paid % refunded % asked %', v_paid, v_refunded, v_amt; end if;

  v_code := case p_charged_to when 'goods' then 'revenue_goods' when 'delivery_fee' then 'revenue_delivery'
                              when 'small_order_fee' then 'revenue_small_order' when 'goodwill' then 'refund_expense' end;
  if v_code is null then raise exception 'UNKNOWN_CHARGE %', p_charged_to; end if;
  if p_charged_to <> 'goodwill' then
    v_cap := order_revenue_usd(p_order, v_code);
    if v_amt > v_cap + 0.005 then
      -- The delivery fee belongs to the rider once the order closes (0009): it is never taken back from them.
      raise exception 'REFUND_EXCEEDS_REVENUE % still booked for this order on %: %', v_code, v_cap, case when p_charged_to = 'delivery_fee'
        then 'the fee belongs to the rider; charge compensation to goodwill' else 'nothing more to refund' end;
    end if;
  end if;
  v_kind := v_code::account_kind;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account(v_code, v_kind), v_amt, 'USD', v_amt, p_order, 'Refund (' || p_reason || ')'),
    (v_txn, customer_credit_account(o.customer_id), -v_amt, 'USD', -v_amt, p_order, 'Refund owed to customer (' || p_reason || ')');
  insert into refunds(order_id, customer_id, amount_usd, charged_to, reason, note, order_item_id, settle, ledger_txn, by_party, request_key)
    values (p_order, o.customer_id, v_amt, p_charged_to, p_reason, nullif(btrim(p_note), ''), p_item, 'credit', v_txn, p_by, p_key)
    returning id into v_id;
  return v_id;
end $$;


-- ---------- apply_customer_credit (0030) ----------
create or replace function apply_customer_credit(p_order uuid, p_by uuid default null) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_free numeric; v_amt numeric;
begin
  if p_by is not null then perform require_role(p_by, array['ops_lead', 'admin']); end if;     -- G1-07
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if exists (select 1 from credit_applications where order_id = p_order) then
    return jsonb_build_object('applied_usd', (select amount_usd from credit_applications where order_id = p_order), 'total_usd', o.total_usd, 'already', true);
  end if;
  if o.status in ('closed', 'cancelled', 'returned', 'failed_delivery')
     or exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    return jsonb_build_object('applied_usd', 0, 'total_usd', o.total_usd, 'reason', 'order_settled');
  end if;
  perform 1 from parties where id = o.customer_id for update;
  v_free := customer_credit_usd(o.customer_id);
  v_amt := round(least(v_free, o.total_usd), 2);
  if v_amt <= 0 then return jsonb_build_object('applied_usd', 0, 'total_usd', o.total_usd); end if;
  update orders set dues_usd = dues_usd - v_amt where id = p_order;
  insert into credit_applications(order_id, customer_id, amount_usd, applied_by) values (p_order, o.customer_id, v_amt, p_by);
  return jsonb_build_object('applied_usd', v_amt, 'total_usd', o.total_usd - v_amt);
end $$;


-- ---------- the pick helpers (0031, 0032) ----------
create or replace function pick_short_line(p_item uuid, p_by uuid, p_found numeric, p_cause text) returns uuid language plpgsql as $$
declare i order_items%rowtype; v_src uuid; v_short numeric; v_missing uuid; v_free numeric; v_w numeric; v_code text;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  select * into i from order_items where id = p_item for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status <> 'ok' then return case when i.missing_at is not null then i.id end; end if;
  select f.source_id into v_src from fulfilments f join sources s on s.id = f.source_id where f.id = i.fulfilment_id and s.kind = 'dark_store';
  if v_src is null then raise exception 'NOT_A_HUB_LINE'; end if;
  if p_found is null or p_found < 0 or p_found >= i.qty then raise exception 'BAD_FOUND_QTY found % of %', p_found, i.qty; end if;
  v_short := i.qty - p_found;
  if p_found > 0 then
    update order_items set qty = p_found where id = i.id;
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note, raw_phrase,
                            status, missing_reason, missing_by, missing_at)
      values (i.order_id, i.fulfilment_id, i.product_id, i.name_snapshot, v_short, i.unit_price_usd, i.modifiers, i.note, i.raw_phrase,
              'missing', p_cause, p_by, now())
      returning id into v_missing;
  else
    update order_items set status = 'missing', missing_reason = p_cause, missing_by = p_by, missing_at = now() where id = i.id;
    v_missing := i.id;
  end if;
  update stock_levels set reserved = greatest(reserved - v_short, 0) where source_id = v_src and product_id = i.product_id;
  insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id, note)
    values (v_src, i.product_id, v_short, 'release', i.order_id, p_by, 'missing at pick');
  if p_cause = 'not_on_shelf' then
    select on_hand - reserved into v_free from stock_levels where source_id = v_src and product_id = i.product_id for update;
    v_w := least(v_short, greatest(coalesce(v_free, 0), 0));
    if v_w > 0 then
      select short_code into v_code from orders where id = i.order_id;
      update stock_levels set on_hand = on_hand - v_w where source_id = v_src and product_id = i.product_id;
      insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id, adjust_reason, note)
        values (v_src, i.product_id, -v_w, 'adjust', i.order_id, p_by, 'missing_at_pick', 'not on the shelf for ' || v_code);
    end if;
    perform raise_ops_exception('count_needed', v_src || ':' || i.product_id,
      jsonb_build_object('product_id', i.product_id, 'product', i.name_snapshot, 'order', v_code, 'missing_units', v_short));
  end if;
  return v_missing;
end $$;


create or replace function pick_remove_line(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare i order_items%rowtype; v_amt numeric; v_credit numeric := 0;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  select * into i from order_items where id = p_missing for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status = 'removed' then return jsonb_build_object('removed_usd', 0, 'already', true); end if;
  if i.status <> 'missing' then raise exception 'LINE_NOT_MISSING %', i.status; end if;
  update order_items set status = 'removed' where id = i.id;
  perform recalc_order_lines(i.order_id);
  v_amt := round(i.qty * i.unit_price_usd, 2);
  if v_amt > 0 and exists (select 1 from payments where order_id = i.order_id and status = 'confirmed') then
    perform grant_customer_credit(i.order_id, v_amt, 'goods', 'missing_at_pick', p_by, i.name_snapshot, i.id, 'pick:' || i.id);
    v_credit := v_amt;
  end if;
  return jsonb_build_object('removed_usd', v_amt, 'credit_usd', v_credit);
end $$;


create or replace function pick_decide_missing(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare c jsonb;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  if coalesce((setting('picking')->>'offer_substitutes')::boolean, false) then
    c := substitute_candidates(p_missing);
    if jsonb_array_length(c->'candidates') > 0 then
      return jsonb_build_object('decision', 'pending', 'candidates', c->'candidates', 'removed_usd', 0, 'credit_usd', 0);
    end if;
    return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed', 'blocked', c->'blocked');
  end if;
  return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed');
end $$;


create or replace function pick_found_held(p_item uuid, p_by uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  v := pick_short_line(p_item, p_by, 0, 'on_hold');
  perform pick_decide_missing(v, p_by);
  return v;
end $$;


-- ---------- can_send (0063): the role against the line ----------
create or replace function can_send(p_party uuid, p_line wa_line, p_category msg_category, p_is_template boolean)
returns text language plpgsql stable as $$
declare v_role party_role;
begin
  if p_category = 'marketing' and coalesce(setting('marketing')->>'enabled', 'false') <> 'true' then
    return 'marketing_disabled';
  end if;
  -- G1-25: customers only on the customer line, staff only on the ops line. An unknown party falls through to 'unknown_party'.
  select role into v_role from parties where id = p_party;
  if v_role is not null and ((p_line = 'customer') <> (v_role = 'customer')) then return 'wrong_line'; end if;
  if exists (select 1 from parties where id = p_party and is_probe) then
    return case when coalesce(setting('probe')->>'enabled', 'false') = 'true' then 'probe_sink' else 'probe_disabled' end;
  end if;
  return can_send_checked(p_party, p_line, p_category, p_is_template);
end $$;


select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
