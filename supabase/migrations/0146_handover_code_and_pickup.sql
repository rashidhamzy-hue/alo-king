-- CX1 (customer pack), part 4 (docs/strategy/02-journeys.md section 1, "Delivery"; 03 section B, "Delivery" and "Fulfilment").
--
-- (a) A four-digit handover code for prepaid and gift orders. Made by the database when the order is confirmed or waits for its
--     transfer, told to the customer with the answer to their Confirm tap, and asked for at the door: the rider types it, and
--     rider_delivered refuses to hand over such an order until the code was right (proof of delivery for an order paid before it
--     arrived). Five wrong tries lock it and raise an ops exception; a person then decides. orders.handover_required marks a gift
--     order (Send Home, SH1, sets it); a prepaid order needs no mark. Cash orders have no code: the cash is the proof.
-- (b) Pickup at the hub with no delivery fee. quote_order already quotes a pickup with no fee (0003). Here: where the hub is, as data
--     (settings.pickup; nothing is written into code, invariant 13, and pickup stays off until a person names the place), the "ready
--     for pickup" notice to the customer, and the handover at the hub: a picker or the ops lead hands the order over, checks the code
--     of a prepaid one, and for cash records what was received into the hub's till. The order closes only with its payment
--     (invariant 12). No delivery fee is charged, so nothing goes to a rider.

alter table orders add column if not exists handover_code text;
alter table orders add column if not exists handover_required boolean not null default false;
alter table orders add column if not exists handover_verified_at timestamptz;
alter table orders add column if not exists handover_attempts int not null default 0;

insert into settings(key, value) values ('handover', '{"max_attempts": 5}') on conflict (key) do nothing;
insert into settings(key, value) values ('pickup', '{"enabled": false, "place_ar": null, "place_en": null}') on conflict (key) do nothing;

-- ---------- (a) the code ----------
create or replace function orders_handover_code() returns trigger language plpgsql as $$
begin
  if new.handover_code is null and new.status in ('awaiting_payment', 'confirmed') and (new.payment_method <> 'cod' or new.handover_required) then
    new.handover_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists orders_handover_code on orders;
create trigger orders_handover_code before update of status on orders for each row execute function orders_handover_code();

-- One try of the code. 'ok' (now, or already), 'wrong' (with tries left), 'locked', or 'none' (the order needs no code).
-- Returns instead of raising, so a wrong try is counted.
create or replace function check_handover_code(p_order uuid, p_code text, p_by uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_max int := coalesce((setting('handover')->>'max_attempts')::int, 5);
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.handover_code is null then return jsonb_build_object('result', 'none', 'short_code', o.short_code); end if;
  if o.handover_verified_at is not null then return jsonb_build_object('result', 'ok', 'short_code', o.short_code); end if;
  if o.handover_attempts >= v_max then return jsonb_build_object('result', 'locked', 'short_code', o.short_code); end if;
  if regexp_replace(coalesce(p_code, ''), '\D', '', 'g') = o.handover_code then
    update orders set handover_verified_at = now() where id = p_order;
    insert into order_events(order_id, from_status, to_status, actor, actor_id, reason)
      values (p_order, o.status, o.status, case when exists (select 1 from parties where id = p_by and role = 'driver') then 'driver' else 'ops' end::actor_kind,
              p_by, 'handover_code_ok');
    return jsonb_build_object('result', 'ok', 'short_code', o.short_code);
  end if;
  update orders set handover_attempts = handover_attempts + 1 where id = p_order;
  if o.handover_attempts + 1 >= v_max then
    perform raise_ops_exception('handover_locked', o.short_code, jsonb_build_object('order_id', p_order, 'by', p_by));
    return jsonb_build_object('result', 'locked', 'short_code', o.short_code);
  end if;
  return jsonb_build_object('result', 'wrong', 'short_code', o.short_code, 'tries_left', v_max - o.handover_attempts - 1);
end $$;

-- Copied from 0006, with the code required first.
create or replace function rider_delivered(p_order uuid, p_driver uuid) returns jsonb language plpgsql as $$
declare s delivery_stops%rowtype; o orders%rowtype; v_paid boolean;
begin
  s := rider_owns_stop(p_order, p_driver);
  select * into o from orders where id = p_order;
  if o.handover_code is not null and o.handover_verified_at is null and o.status not in ('delivered', 'closed') then
    raise exception 'HANDOVER_CODE_REQUIRED %', o.short_code;
  end if;
  if s.arrived_at is null then update delivery_stops set arrived_at = now(), inferred = true where id = s.id; end if;
  update delivery_stops set completed_at = coalesce(completed_at, now()) where id = s.id;
  perform advance_order_to(p_order, 'delivered', 'driver', p_driver);
  select * into o from orders where id = p_order;
  update orders set delivered_at = coalesce(delivered_at, now()) where id = p_order;
  update customer_places set verified_by_driver = true, delivery_count = delivery_count + 1, last_used_at = now() where id = o.place_id;
  v_paid := exists (select 1 from payments where order_id = p_order and status = 'confirmed');
  if v_paid then perform transition_order(p_order, 'closed', 'system', null, 'paid_and_delivered'); end if;
  return jsonb_build_object('ok', true, 'paid', v_paid, 'needs_cash', (not v_paid and o.payment_method = 'cod'),
                            'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'short_code', o.short_code,
                            'delivery_done', finish_delivery_if_done(s.delivery_id));
end $$;

-- The rider typed the customer's code at the door: right, the order is handed over (rider_delivered); wrong, how many tries are left.
create or replace function rider_handover(p_order uuid, p_driver uuid, p_code text) returns jsonb language plpgsql as $$
declare c jsonb;
begin
  perform rider_owns_stop(p_order, p_driver);
  c := check_handover_code(p_order, p_code, p_driver);
  if c->>'result' not in ('ok', 'none') then return c || jsonb_build_object('ok', false); end if;
  return rider_delivered(p_order, p_driver) || jsonb_build_object('result', 'ok');
end $$;

-- The one order of this rider's at the door (or on the way) that waits for its code. Null when none, or more than one.
create or replace function rider_code_pending(p_driver uuid) returns uuid language sql stable as $$
  select case when count(*) = 1 then (array_agg(o.id))[1] end
    from deliveries d join delivery_stops s on s.delivery_id = d.id and s.kind = 'dropoff' and s.completed_at is null
    join orders o on o.id = s.order_id
   where d.driver_id = p_driver and d.status in ('accepted', 'in_progress') and o.status in ('out_for_delivery', 'arrived')
     and o.handover_code is not null and o.handover_verified_at is null $$;

-- Copied from 0042, with what the rider must know at the door: a code to ask for, and change the customer keeps as credit (0144).
create or replace function rider_job(p_delivery uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('delivery_id', d.id, 'driver_id', d.driver_id, 'status', d.status,
    'collect_usd', (select coalesce(sum(o.total_usd), 0) from delivery_stops s join orders o on o.id = s.order_id
                     where s.delivery_id = d.id and o.payment_method = 'cod'),
    'stops', (select jsonb_agg(jsonb_build_object(
        'seq', s.seq, 'kind', s.kind, 'done', s.completed_at is not null, 'arrived', s.arrived_at is not null,
        'source_id', s.source_id, 'source', src.name, 'source_village', sv.name_ar,
        'order_id', o.id, 'short_code', o.short_code, 'order_status', o.status, 'customer', pa.display_name,
        'phone', customer_contact_phone(o.customer_id),
        'village', ov.name_ar, 'lat', coalesce(s.lat, cp.lat), 'lng', coalesce(s.lng, cp.lng),
        'directions', nullif(concat_ws(' - ', cp.building, cp.floor, cp.directions), ''), 'notes', o.customer_notes,
        'payment_method', o.payment_method, 'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'change_for_usd', o.change_for_usd,
        'keep_change', coalesce(o.keep_change_credit, false),
        'code_required', o.handover_code is not null and o.handover_verified_at is null,
        'paid', exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed'),
        'items', (select count(*) from order_items i where i.order_id = o.id and i.status = 'ok')) order by s.seq)
      from delivery_stops s left join sources src on src.id = s.source_id left join villages sv on sv.id = src.village_id
      left join orders o on o.id = s.order_id left join parties pa on pa.id = o.customer_id
      left join villages ov on ov.id = o.village_id left join customer_places cp on cp.id = o.place_id
      where s.delivery_id = d.id))
  from deliveries d where d.id = p_delivery $$;

-- ---------- (b) pickup at the hub ----------
-- Where to collect, in the customer's language, or null while pickup is off or no place is named.
create or replace function pickup_place(p_lang text default 'ar') returns text language sql stable as $$
  select case when coalesce((setting('pickup')->>'enabled')::boolean, false)
              then nullif(btrim(coalesce(case when p_lang = 'ar' then setting('pickup')->>'place_ar' else setting('pickup')->>'place_en' end,
                                         setting('pickup')->>'place_ar', setting('pickup')->>'place_en')), '') end $$;

-- A picker or the ops lead hands a pickup order over at the hub. A prepaid one needs the customer's code (as a rider's does); a cash
-- one records what was received and the change given, booked as a rider's would be (post_cod_collection, 0104) and moved at once
-- into the hub's till, so no rider or delivery fee is involved. Then delivered and closed.
create or replace function hub_handover(p_order uuid, p_by uuid, p_code text default null, p_usd numeric default null, p_lbp numeric default 0,
                                        p_change_usd numeric default 0, p_change_lbp numeric default 0) returns jsonb language plpgsql as $$
declare o orders%rowtype; c jsonb; v_role text; v_actor actor_kind; v_before numeric; v_held numeric; v_txn uuid := gen_random_uuid();
begin
  perform require_role(p_by, array['picker', 'ops_lead', 'admin']);
  select role::text into v_role from parties where id = p_by;
  v_actor := case when v_role = 'picker' then 'picker' else 'ops' end;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if not o.is_pickup then raise exception 'NOT_A_PICKUP %', o.short_code; end if;
  if o.status in ('delivered', 'closed') then return jsonb_build_object('ok', true, 'already', true, 'short_code', o.short_code); end if;
  if o.status <> 'ready' then return jsonb_build_object('ok', false, 'reason', 'not_ready', 'status', o.status, 'short_code', o.short_code); end if;
  c := check_handover_code(p_order, p_code, p_by);
  if c->>'result' not in ('ok', 'none') then return c || jsonb_build_object('ok', false); end if;
  if o.payment_method = 'cod' and not exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    if p_usd is null then raise exception 'AMOUNT_REQUIRED'; end if;
    if least(p_usd, p_lbp, p_change_usd, p_change_lbp) < 0 then raise exception 'NEGATIVE_AMOUNT'; end if;
    v_before := driver_cash_usd(p_by);
    perform post_cod_collection(p_order, p_by, p_usd, p_lbp, p_change_usd, p_change_lbp);
    v_held := driver_cash_usd(p_by) - v_before;
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('driver_cash:' || p_by, 'driver_cash', p_by), -v_held, 'USD', -v_held, p_order, 'Pickup paid at the hub'),
      (v_txn, ensure_account('hub_cash', 'hub_cash'), v_held, 'USD', v_held, p_order, 'Pickup paid at the hub');
  end if;
  if not exists (select 1 from payments where order_id = p_order and status = 'confirmed') then raise exception 'PAYMENT_NOT_RECORDED'; end if;
  perform transition_order(p_order, 'delivered', v_actor, p_by, 'picked_up_at_hub');
  update orders set delivered_at = coalesce(delivered_at, now()) where id = p_order;
  perform transition_order(p_order, 'closed', 'system', null, 'paid_and_collected');
  return jsonb_build_object('ok', true, 'short_code', o.short_code, 'status', 'closed');
end $$;

-- Copied from 0121, with "ready for pickup at the hub": the order is ready and is a pickup. Its two values are the short code and
-- the place (settings.pickup). No template exists for it yet: inside the 24-hour window it goes as text, otherwise it is skipped and
-- recorded (as every notice without an approved utility template is).
create or replace function customer_notices_due() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with due as (
    select 'order_cancelled' as kind, o.id as order_id, o.short_code, o.customer_id, customer_language(o.customer_id) as lang,
           e.reason as reason, null::payments as p, e.created_at as at
      from order_events e join orders o on o.id = e.order_id
     where e.to_status = 'cancelled' and e.actor <> 'customer' and e.created_at > now() - interval '2 hours'
       and coalesce(e.reason, '') <> 'superseded_by_new_card'      -- a newer card replaced it; the customer is looking at that one
    union all
    select 'rider_at_door', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, null::payments, s.arrived_at
      from delivery_stops s join orders o on o.id = s.order_id
     where s.kind = 'dropoff' and s.arrived_at > now() - interval '2 hours' and s.completed_at is null and o.status = 'arrived'
    union all
    select 'payment_received', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, p, p.confirmed_at
      from payments p join orders o on o.id = p.order_id
     where p.status = 'confirmed' and p.confirmed_at > now() - interval '2 hours'
       and not (o.is_pickup and o.status in ('delivered', 'closed'))   -- paid at the hub counter: the customer is standing there
    union all
    select 'pickup_ready', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), pickup_place(customer_language(o.customer_id)),
           null::payments, e.created_at
      from order_events e join orders o on o.id = e.order_id
     where e.to_status = 'ready' and o.is_pickup and o.status = 'ready' and e.created_at > now() - interval '12 hours'),
  filled as (
    select d.*, case d.kind
      when 'order_cancelled' then jsonb_build_array(d.short_code, case
        when d.reason like 'timeout:awaiting_payment%' then case d.lang when 'en' then 'we did not receive the payment in time'
                                                                       when 'fr' then 'le paiement n''est pas arrivé à temps'
                                                                       else 'ما وصلنا الدفع بالوقت المحدد' end
        when d.reason like 'timeout:%' then case d.lang when 'en' then 'the order was not confirmed in time'
                                                        when 'fr' then 'la commande n''a pas été confirmée à temps'
                                                        else 'ما تأكّد الطلب بالوقت المحدد' end
        else case d.lang when 'en' then 'we could not complete it' when 'fr' then 'nous n''avons pas pu la terminer' else 'ما قدرنا نكمّلو' end end)
      when 'rider_at_door' then jsonb_build_array(d.short_code)
      when 'pickup_ready' then jsonb_build_array(d.short_code, coalesce(d.reason, ''))
      else jsonb_build_array(d.short_code, trim(both ' +' from concat_ws(' + ',
             case when (d.p).received_usd > 0 then to_char((d.p).received_usd - (d.p).change_usd, 'FM999990.00') || '$' end,
             case when (d.p).received_lbp > 0 then to_char((d.p).received_lbp - (d.p).change_lbp, 'FM999,999,990') || case d.lang when 'ar' then ' ل.ل.' else ' LBP' end end,
             case when (d.p).received_usd = 0 and (d.p).received_lbp = 0 then to_char((d.p).amount_usd, 'FM999990.00') || '$' end)
             || case (d.p).method
                  when 'cod' then case d.lang when 'en' then ' cash' when 'fr' then ' en espèces' else ' نقداً' end
                  when 'whish' then case d.lang when 'en' then ' via Whish' when 'fr' then ' par Whish' else ' عبر Whish' end
                  when 'omt' then case d.lang when 'en' then ' via OMT' when 'fr' then ' par OMT' else ' عبر OMT' end
                  else '' end))
    end as params from due d)
  select coalesce(jsonb_agg(jsonb_build_object('key', 'notice:' || f.kind || ':' || f.order_id, 'kind', f.kind, 'order_id', f.order_id,
           'short_code', f.short_code, 'customer_id', f.customer_id, 'params', f.params, 'lang', f.lang,
           'template', t.name, 'template_approved', template_sendable(t.name), 'template_status', t.status, 'template_category', t.category) order by f.at), '[]'::jsonb)
    from filled f
    left join wa_templates t on t.name = event_template(f.kind, f.lang)
   where not exists (select 1 from customer_notices n where n.key = 'notice:' || f.kind || ':' || f.order_id) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
