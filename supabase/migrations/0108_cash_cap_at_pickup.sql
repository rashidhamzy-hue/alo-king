-- Alo King Chouf, session F1 (G1 fixes): the rider's cash cap, checked again at pickup (G1-09).
--
-- offer_delivery (0002) checks the cap on the order's total before picking. A picked order can cost more (a dearer substitute the
-- customer kept, 0032), and the rider may have collected cash since. rider_picked_up (start: 0033) now checks the hard cap again
-- before anything leaves the hub, on the rider's live exposure (driver_exposure_usd, 0004: cash held plus every unpaid cash stop,
-- this delivery's included, at today's totals). Over it, pickup is refused with CASH_CAP hard_cap and nothing changes: the rider
-- drops cash at the hub, or ops gives the order to another rider. The soft cap only stops new offers, as before.
-- On the ops line the refusal reaches the rider as the generic error and ops gets the error alert with the reason (ops-turn.ts is
-- not F1's file; a plain-words message is a request in docs/HANDOFF.md). Anyone redefining rider_picked_up: start from here.

create or replace function rider_picked_up(p_delivery uuid, p_driver uuid, p_source uuid default null) returns jsonb language plpgsql as $$
declare d deliveries%rowtype; r record; v_left int; v_waiting jsonb; v_exposure numeric; v_hard numeric;
begin
  select * into d from deliveries where id = p_delivery for update;
  if not found or d.driver_id <> p_driver then raise exception 'NOT_YOUR_JOB'; end if;
  -- 2.4: the rider may now arrive while the order is still being picked. Nothing leaves the hub before it is ready.
  select coalesce(jsonb_agg(o.short_code), '[]'::jsonb) into v_waiting from delivery_stops s join orders o on o.id = s.order_id
   where s.delivery_id = p_delivery and s.kind = 'dropoff' and o.status in ('confirmed', 'preparing') and order_waits_for_pick(o.id, true);
  if jsonb_array_length(v_waiting) > 0 then return jsonb_build_object('ok', false, 'status', 'not_ready', 'waiting', v_waiting); end if;
  if d.status = 'offered' then   -- the accept tap was lost; picking up is acceptance
    update deliveries set status = 'accepted', accepted_at = now() where id = p_delivery;
  elsif d.status not in ('accepted','in_progress') then
    return jsonb_build_object('ok', false, 'status', d.status);
  end if;
  -- G1-09: the hard cap again, on the totals after picking. Raised, so nothing above (a lost accept tap) is kept either.
  v_exposure := driver_exposure_usd(p_driver);
  v_hard := (setting('cash_cap')->>'hard_usd')::numeric;
  if v_hard is not null and v_exposure > v_hard + 0.005 then
    raise exception 'CASH_CAP hard_cap at pickup: the rider would carry % USD, the limit is % USD (drop cash at the hub, or give the order to another rider)',
      round(v_exposure, 2), v_hard;
  end if;
  update delivery_stops set arrived_at = coalesce(arrived_at, now()), completed_at = coalesce(completed_at, now())
   where delivery_id = p_delivery and kind = 'pickup' and (p_source is null or source_id = p_source);
  update fulfilments f set status = 'handed_over' from delivery_stops s
   where s.delivery_id = p_delivery and s.kind = 'dropoff' and f.order_id = s.order_id
     and (p_source is null or f.source_id = p_source) and f.status <> 'cancelled';
  select count(*) into v_left from delivery_stops where delivery_id = p_delivery and kind = 'pickup' and completed_at is null;
  if v_left = 0 then
    update deliveries set status = 'in_progress' where id = p_delivery;
    for r in select order_id from delivery_stops where delivery_id = p_delivery and kind = 'dropoff' loop
      perform advance_order_to(r.order_id, 'out_for_delivery', 'driver', p_driver);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'pickups_left', v_left);
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
