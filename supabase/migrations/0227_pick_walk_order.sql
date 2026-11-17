-- Alo King Chouf, session UX2a (coordinator's decision, 17 November 2026): the picker's walking order.
-- pick_list (0031) numbered the lines ambient, chilled, frozen, fresh: the storage enum's own order, so fresh goods came last, after the frozen ones.
-- The hub is walked ambient first, then fresh, then chilled, then frozen, so the cold goods are taken last and stay cold. This copies pick_list as it
-- was, with that one ordering changed (the line numbers, "missing 2" on the ops line and the console's runner follow it). Nothing else changes.

create or replace function pick_list(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'notes', o.customer_notes,
    'picker_id', ps.picker_id, 'started_at', ps.started_at, 'finished_at', ps.finished_at, 'total_usd', o.total_usd, 'payment_method', o.payment_method,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'item_id', x.id, 'product_id', x.product_id, 'name', x.name, 'qty', x.qty,
                         'unit', x.sell_unit, 'storage', x.storage, 'on_hold', x.on_hold, 'note', x.note) order by x.n)
                       from (select i.id, i.product_id, coalesce(p.name_ar, i.name_snapshot) as name, i.qty, p.sell_unit, p.storage, i.note,
                                    product_on_hold(i.product_id) as on_hold,
                                    row_number() over (order by case p.storage when 'ambient' then 0 when 'fresh' then 1 when 'chilled' then 2 else 3 end, i.name_snapshot, i.id) as n
                               from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                               join products p on p.id = i.product_id
                              where i.order_id = o.id and i.status = 'ok' and s.kind = 'dark_store') x), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name', coalesce(p.name_ar, i.name_snapshot), 'qty', i.qty,
                           'status', i.status, 'reason', i.missing_reason, 'line_total_usd', round(i.qty * i.unit_price_usd, 2)) order by i.missing_at)
                         from order_items i join products p on p.id = i.product_id
                        where i.order_id = o.id and i.missing_at is not null), '[]'::jsonb))
  from orders o left join pick_sessions ps on ps.order_id = o.id where o.id = p_order $$;
