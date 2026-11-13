-- Alo King Chouf: build plan 1.3. Questions the database can answer on its own: where is my order, when are you open,
-- do you deliver to my village, and "same as last time". The gateway words the answer from these results with fixed text;
-- no model writes a status, an hour, a fee or a price.

-- Opening hours, whether we are open now, and the villages we deliver to, with their fee and usual time.
-- Everything here is data (settings, zones, villages): nothing is hard-coded.
create or replace function service_info() returns jsonb language sql stable as $$
  with h as (select setting('hours') as v),
       n as (select (now() at time zone coalesce((select v->>'tz' from h), 'Asia/Beirut'))::time as t)
  select jsonb_build_object(
    'open', (select v->>'open' from h), 'close', (select v->>'close' from h), 'tz', (select v->>'tz' from h),
    'open_now', (select n.t >= (h.v->>'open')::time and n.t < (h.v->>'close')::time from h, n),
    'served', (select coalesce(jsonb_agg(jsonb_build_object('name_en', vi.name_en, 'name_ar', vi.name_ar, 'fee_usd', z.delivery_fee_usd,
                                                            'eta_minutes', z.base_eta_minutes) order by z.base_eta_minutes, vi.name_en), '[]'::jsonb)
                 from villages vi join zones z on z.id = vi.zone_id where vi.is_served and z.is_active)) $$;

-- Where is my order: the latest open order, with the minutes left on the zone's usual time when it is on its way to being made.
create or replace function order_status_for(p_party uuid) returns jsonb language sql stable as $$
  select to_jsonb(x) from (
    select o.id as order_id, o.short_code, o.status, o.total_usd, o.payment_method, o.is_pickup,
           (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id) as eta_minutes,
           case when o.status in ('confirmed','preparing','ready','out_for_delivery') and o.confirmed_at is not null and not o.is_pickup then
             greatest(0, ceil((select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id)
                              - extract(epoch from now() - o.confirmed_at) / 60))::int end as eta_remaining_minutes
    from orders o where o.customer_id = p_party and o.status not in ('draft', 'closed', 'cancelled', 'returned')
    order by o.created_at desc limit 1) x
$$;

-- "Same as last time": the customer's last closed order (or the one named, if it is theirs and closed), re-priced now.
-- Lines that cannot be supplied today are listed in `missing` by name and left out; the rest are priced by quote_order.
-- A closed order is one that was delivered and paid. A customer with none gets found = false, never a guess.
create or replace function repeat_plan(p_party uuid, p_order uuid default null) returns jsonb language plpgsql stable as $$
declare o orders%rowtype; ln record; v_all jsonb := '[]'::jsonb; v_ok jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb;
        q jsonb; v_pay text; v_good boolean;
begin
  select * into o from orders where customer_id = p_party and status = 'closed' and (p_order is null or id = p_order)
   order by coalesce(delivered_at, created_at) desc limit 1;
  if not found then return jsonb_build_object('found', false); end if;

  for ln in select i.product_id, f.source_id, i.qty, i.modifiers, i.note, i.raw_phrase, i.name_snapshot, p.name_ar
              from order_items i join fulfilments f on f.id = i.fulfilment_id join products p on p.id = i.product_id
             where i.order_id = o.id and i.status = 'ok' order by i.id loop
    v_all := v_all || jsonb_build_object('product_id', ln.product_id, 'source_id', ln.source_id, 'qty', ln.qty,
                                         'modifiers', ln.modifiers, 'note', ln.note, 'raw', ln.raw_phrase);
  end loop;
  q := quote_order(v_all, o.village_id, o.is_pickup);

  for ln in select x.value as line, p.name_en, p.name_ar from jsonb_array_elements(v_all) x join products p on p.id = (x.value->>'product_id')::uuid loop
    select coalesce(bool_or((y->>'ok')::boolean), false) into v_good from jsonb_array_elements(q->'lines') y
     where y->>'product_id' = ln.line->>'product_id';
    if v_good then v_ok := v_ok || ln.line;
    else v_missing := v_missing || jsonb_build_object('product_id', ln.line->>'product_id', 'name', ln.name_en, 'name_ar', ln.name_ar);
    end if;
  end loop;
  if jsonb_array_length(v_missing) > 0 and jsonb_array_length(v_ok) > 0 then q := quote_order(v_ok, o.village_id, o.is_pickup); end if;

  v_pay := o.payment_method::text;
  if customer_requires_prepay(p_party) and v_pay = 'cod' then v_pay := 'whish'; end if;
  return jsonb_build_object('found', true, 'order_id', o.id, 'short_code', o.short_code, 'lines', v_ok, 'missing', v_missing,
    'village_id', o.village_id, 'place_id', o.place_id, 'pickup', o.is_pickup, 'payment_method', v_pay,
    'quote', case when jsonb_array_length(v_ok) > 0 then q else null end);
end $$;

-- Can a rider find this place? The same test confirm_order_checked applies at the tap, so the gateway asks for a pin
-- before the card exactly when the tap would otherwise ask for one.
create or replace function place_is_locatable(p_place uuid) returns boolean language sql stable as $$
  select coalesce((select cp.lat is not null or cp.verified_by_driver or length(coalesce(cp.directions, '') || coalesce(cp.building, '')) >= 8
                     from customer_places cp where cp.id = p_place), false) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
