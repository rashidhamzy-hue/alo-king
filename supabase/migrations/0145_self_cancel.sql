-- CX1 (customer pack), part 3: self-service cancel until picking starts, and the exact refundable amount after
-- (docs/strategy/02-journeys.md section 1, "Cancel"; 03 section B, "Cancellations").
--
-- Before picking starts (no pick session: D4b's pick queue and the ops line both start one through start_pick), the customer's own
-- Cancel tap cancels the order: the stock goes back (transition_order), a rider's open offer is withdrawn, and what was paid becomes
-- their credit (goods, delivery fee, small-order fee), as a cancelled scheduled order's already does (0040). A rider who accepted the
-- job, or has it in hand, means the order is on its way: that is too late too. A scheduled order keeps its cut-off (0040).
-- After that the tap cancels nothing. The customer is told exactly what a cancel would give back (cancel_terms) and a person decides
-- (the case B1a opens). What is refundable is computed here from the order's own lines and payments, by rules in
-- settings.self_cancel (data, not code): goods whose storage zone can go back on the shelf, and the delivery fee while the order has
-- not left the hub (once it has, the fee belongs to the rider: invariant 10).

-- The handover code (0146) is read back with the confirm tap's answer below; the column is added here so this function compiles against it.
alter table orders add column if not exists handover_code text;

insert into settings(key, value) values ('self_cancel', '{"returnable_zones": ["ambient", "chilled", "frozen"]}') on conflict (key) do nothing;

-- What a cancel now would do. cancellable: the customer's tap cancels it. Otherwise reason says why, and refundable_usd is the exact
-- amount a person would give back as credit if they cancel it (paid orders), with the lines that could not go back.
create or replace function cancel_terms(p_order uuid) returns jsonb language plpgsql stable as $$
declare o orders%rowtype; v_paid numeric; v_refunded numeric; v_goods numeric; v_kept numeric; v_names jsonb; v_fee numeric := 0;
        v_reason text; v_zones jsonb := coalesce(setting('self_cancel')->'returnable_zones', '["ambient"]'::jsonb);
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  select coalesce(sum(amount_usd), 0) into v_paid from payments where order_id = p_order and status = 'confirmed';
  select coalesce(sum(amount_usd), 0) into v_refunded from refunds where order_id = p_order;
  v_paid := greatest(v_paid - v_refunded, 0);
  v_reason := case
    when o.status in ('cancelled', 'closed', 'delivered', 'returned', 'failed_delivery') then 'finished'
    when o.status in ('draft', 'awaiting_confirmation') then null
    when o.status in ('out_for_delivery', 'arrived') then 'on_the_way'
    when exists (select 1 from pick_sessions where order_id = p_order) or o.status in ('preparing', 'ready') then 'picking_started'
    when exists (select 1 from delivery_stops s join deliveries d on d.id = s.delivery_id
                  where s.order_id = p_order and s.kind = 'dropoff' and d.status in ('accepted', 'in_progress')) then 'with_rider'
    when o.delivery_slot_id is not null and o.status in ('confirmed', 'awaiting_payment') and not coalesce(order_changeable(p_order), false) then 'cut_off'
    else null end;
  select coalesce(sum(round(i.qty * i.unit_price_usd, 2)) filter (where v_zones ? p.storage::text), 0),
         coalesce(sum(round(i.qty * i.unit_price_usd, 2)) filter (where not v_zones ? p.storage::text), 0),
         coalesce(jsonb_agg(coalesce(p.name_ar, i.name_snapshot)) filter (where not v_zones ? p.storage::text), '[]'::jsonb)
    into v_goods, v_kept, v_names
    from order_items i join products p on p.id = i.product_id where i.order_id = p_order and i.status = 'ok';
  if o.status not in ('out_for_delivery', 'arrived', 'delivered', 'closed') then v_fee := o.delivery_fee_usd + coalesce(o.small_order_fee_usd, 0); end if;
  return jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'payment_method', o.payment_method,
    'cancellable', v_reason is null, 'reason', v_reason, 'paid_usd', v_paid,
    'refundable_usd', case when v_reason is null then v_paid else least(v_paid, round(v_goods + v_fee, 2)) end,
    'kept_usd', case when v_reason is null then 0 else v_kept end, 'kept', case when v_reason is null then '[]'::jsonb else v_names end);
end $$;

-- The customer's own Cancel (the card's button, the row under the confirmation, or "cancel my order" answered with a button).
-- Only the order's customer. Never a model: the Concierge has no tool that calls this.
create or replace function customer_cancel_order(p_order uuid, p_party uuid, p_wamid text default null) returns jsonb language plpgsql as $$
declare o orders%rowtype; t jsonb; v_amt numeric; v_credit numeric := 0; c record; r jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id is distinct from p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status = 'cancelled' then return jsonb_build_object('status', 'cancelled', 'short_code', o.short_code, 'changed', false, 'credit_usd', 0); end if;
  t := cancel_terms(p_order);
  if not (t->>'cancellable')::boolean then
    return t || jsonb_build_object('status', 'too_late', 'changed', false);
  end if;
  if o.delivery_slot_id is not null and o.status in ('confirmed', 'awaiting_payment') then
    r := cancel_scheduled_order(p_order, 'customer', p_party, 'card_cancel');
    return (r - 'customer_id') || jsonb_build_object('status', coalesce(r->>'status', 'cancelled'));
  end if;
  -- A rider offered the job (not yet accepted): the offer is withdrawn, so nobody comes for a cancelled order. An offer that carries
  -- other orders too keeps them and loses this one's stop.
  update deliveries d set status = 'cancelled'
   where d.status = 'offered' and exists (select 1 from delivery_stops s where s.delivery_id = d.id and s.order_id = p_order)
     and not exists (select 1 from delivery_stops s where s.delivery_id = d.id and s.kind = 'dropoff' and s.order_id is distinct from p_order);
  delete from delivery_stops s using deliveries d
   where d.id = s.delivery_id and d.status = 'offered' and s.order_id = p_order and s.kind = 'dropoff';
  perform transition_order(p_order, 'cancelled', 'customer', p_party, 'card_cancel', jsonb_build_object('wamid', p_wamid));
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    for c in select * from (values ('goods', 'revenue_goods'), ('delivery_fee', 'revenue_delivery'), ('small_order_fee', 'revenue_small_order')) x(charge, code) loop
      v_amt := order_revenue_usd(p_order, c.code);
      if v_amt > 0 then
        perform grant_customer_credit(p_order, v_amt, c.charge, 'order_cancelled', null, 'cancelled by the customer before picking', null,
                                      'selfcancel:' || p_order || ':' || c.charge);
        v_credit := v_credit + v_amt;
      end if;
    end loop;
  end if;
  return jsonb_build_object('status', 'cancelled', 'short_code', o.short_code, 'changed', true, 'credit_usd', v_credit,
                            'payment_method', o.payment_method, 'total_usd', o.total_usd);
end $$;

-- Copied from 0040, with Cancel going through customer_cancel_order. Confirm and edit are unchanged.
create or replace function handle_order_button(p_order uuid, p_action text, p_party uuid, p_wamid text default null)
returns jsonb language plpgsql as $$
declare o orders%rowtype; v_to order_status;
begin
  select * into o from orders where id = p_order;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if p_action = 'confirm' then
    if o.status <> 'awaiting_confirmation' then
      return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', false, 'window', window_json(o.delivery_slot_id));
    end if;
    -- The card states that confirming means agreeing to order updates on this chat. The tap is the opt-in.
    insert into consent_events(party_id, line, kind, action, source, wording, evidence_message_id)
      values (p_party, 'customer', 'transactional', 'opt_in', 'order_card_confirm',
              'بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة', p_wamid);
    v_to := case when o.payment_method = 'cod' then 'confirmed' else 'awaiting_payment' end;
    perform transition_order(p_order, v_to, 'customer', p_party, 'card_confirm', jsonb_build_object('wamid', p_wamid));
  elsif p_action = 'edit' then
    if o.status = 'awaiting_confirmation' then perform transition_order(p_order, 'draft', 'customer', p_party, 'card_edit');
    elsif o.delivery_slot_id is not null and o.status in ('confirmed', 'awaiting_payment') then
      return jsonb_build_object('status', case when coalesce(order_changeable(p_order), false) then 'change_open' else 'too_late' end,
                                'short_code', o.short_code, 'changed', false, 'window', window_json(o.delivery_slot_id));
    end if;
  elsif p_action = 'cancel' then
    return customer_cancel_order(p_order, p_party, p_wamid) || jsonb_build_object('window', window_json(o.delivery_slot_id));
  else
    raise exception 'UNKNOWN_ACTION %', p_action;
  end if;
  select * into o from orders where id = p_order;
  return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', true, 'payment_method', o.payment_method,
                            'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'window', window_json(o.delivery_slot_id),
                            'handover_code', o.handover_code);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
