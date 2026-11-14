-- Alo King Chouf, session C3: C2's request (docs/HANDOFF.md, session C2): count only the lines that left the hub.
-- Since 0031 an order carries the lines that came up missing at the shelf (status missing, then removed or substituted) next to
-- what was actually picked; a kept substitute is its own ok line.
--   recall_orders (0025): it already counted only ok lines. What it still counted wrongly was a failed delivery whose goods
--     came back (receive_return moves the order to returned, then closed): the closed order was listed as "with the customer",
--     so ops would phone someone who never kept the product. Such an order is left out now. Lines are the hub's (dark store).
--   rider_job (0016): the item count on the rider's card counted every line, so a missing line (and the split of a partly
--     found one) made the rider look for more bags than left the hub. It counts ok lines now. Nothing else in rider_job changed
--     (B1's phone line from 0016 is kept).
-- Neither function is redefined by any later migration.

create or replace function recall_orders(p_product uuid, p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status,
           'stage', case when o.status in ('delivered', 'closed') then 'with_customer'
                         when o.status in ('out_for_delivery', 'arrived', 'failed_delivery') then 'on_the_way'
                         else 'at_hub' end,
           'qty', x.qty, 'ordered_at', o.created_at, 'delivered_at', o.delivered_at,
           'customer', pa.display_name, 'phone', customer_contact_phone(o.customer_id))
           order by coalesce(o.delivered_at, o.created_at) desc), '[]'::jsonb)
    from (select i.order_id, sum(i.qty) as qty from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
           where i.product_id = p_product and i.status = 'ok' and s.kind = 'dark_store' group by i.order_id) x
    join orders o on o.id = x.order_id join parties pa on pa.id = o.customer_id
   where o.status in ('awaiting_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'failed_delivery', 'delivered', 'closed')
     and not exists (select 1 from order_events e where e.order_id = o.id and (e.to_status = 'returned' or e.reason = 'return_received'))
     and coalesce(o.delivered_at, o.confirmed_at, o.created_at) >= p_from and coalesce(o.delivered_at, o.confirmed_at, o.created_at) < p_to $$;

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
        'paid', exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed'),
        'items', (select count(*) from order_items i where i.order_id = o.id and i.status = 'ok')) order by s.seq)
      from delivery_stops s left join sources src on src.id = s.source_id left join villages sv on sv.id = src.village_id
      left join orders o on o.id = s.order_id left join parties pa on pa.id = o.customer_id
      left join villages ov on ov.id = o.village_id left join customer_places cp on cp.id = o.place_id
      where s.delivery_id = d.id))
  from deliveries d where d.id = p_delivery $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
