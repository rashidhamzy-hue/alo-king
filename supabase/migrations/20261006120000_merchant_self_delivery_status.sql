-- P0-3: a kitchen that delivers itself (or the demo vendor, which has no driver) can move its own order on to out_for_delivery and delivered
-- from the /merchant screen, in order only (ready -> out_for_delivery -> delivered) and only while NO driver is assigned: once a driver owns the order, only the driver moves it. Nothing else in the guard changes
-- (staff still cannot touch totals, items, phone or vendor; the COD cap and timestamps are unchanged).
create or replace function public.orders_guard() returns trigger
language plpgsql set search_path = public as $$
declare held numeric; r text;
begin
  new.updated_at := now();
  r := public.my_role();  -- null for service role / no session
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if r = 'merchant' and new.status not in ('accepted','preparing','ready','rejected')
         and not (old.driver_id is null and ((new.status = 'out_for_delivery' and old.status = 'ready') or (new.status = 'delivered' and old.status = 'out_for_delivery'))) then
        raise exception 'merchants cannot set status %', new.status;
      end if;
      if r = 'driver' and new.status not in ('out_for_delivery','delivered') then
        raise exception 'drivers cannot set status %', new.status;
      end if;
      if new.status = 'accepted'         and new.accepted_at  is null then new.accepted_at  := now(); end if;
      if new.status = 'ready'            and new.ready_at     is null then new.ready_at     := now(); end if;
      if new.status = 'out_for_delivery' and new.picked_up_at is null then new.picked_up_at := now(); end if;
      if new.status = 'delivered'        and new.delivered_at is null then new.delivered_at := now(); end if;
    end if;
    if r in ('merchant','driver') and (
         new.total_usd is distinct from old.total_usd or new.subtotal_usd is distinct from old.subtotal_usd
         or new.items is distinct from old.items or new.customer_phone is distinct from old.customer_phone
         or new.vendor_id is distinct from old.vendor_id) then
      raise exception 'order financials and contents are read-only for staff';
    end if;
    if new.driver_id is not null and new.driver_id is distinct from old.driver_id and new.payment_method = 'cod' then
      select coalesce(sum(total_usd),0) into held from public.orders
        where driver_id = new.driver_id and payment_method = 'cod' and cod_settled_at is null
          and status not in ('cancelled','rejected') and id <> new.id;
      if held + new.total_usd > 150 then
        raise exception 'COD cap of $150 exceeded for this driver (holding %)', held;
      end if;
    end if;
  end if;
  return new;
end $$;
