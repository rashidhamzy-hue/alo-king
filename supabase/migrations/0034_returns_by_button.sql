-- Alo King Chouf, session C2, build plan 2.5: returns by button.
-- Goods back from a failed delivery are counted on the ops line: the picker or ops lead opens the return, sees each line with
-- its default (shelf-stable goods back on the shelf, chilled, frozen and fresh written off), and taps one of three buttons:
-- as shown, all fit to sell, or all written off. receive_return (0008) does the stock, the valuation (0024) and the close.
-- receive_return is copied from 0008 with one line changed: only lines that actually left the hub (status ok) come back.
-- Since 0031 an order can also carry the lines that came up missing at the shelf; those never left and must not be restocked.

-- What the person receiving the return sees, line by line, with what happens to it if they accept the defaults.
create or replace function return_card(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', coalesce(p.name_ar, i.name_snapshot), 'qty', i.qty,
                         'storage', p.storage, 'default', case when p.storage = 'ambient' then 'restock' else 'write_off' end) order by p.storage, i.name_snapshot)
                       from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                       join products p on p.id = i.product_id
                      where i.order_id = o.id and i.status = 'ok' and s.kind = 'dark_store'), '[]'::jsonb))
  from orders o where o.id = p_order $$;

-- p_choice: 'default' (as shown), 'all_fit' (everything back on the shelf), 'all_waste' (everything written off).
create or replace function receive_return_by_button(p_order uuid, p_by uuid, p_choice text) returns jsonb language plpgsql as $$
declare v_restock jsonb := '{}'::jsonb; r record;
begin
  if p_choice not in ('default', 'all_fit', 'all_waste') then raise exception 'UNKNOWN_CHOICE %', p_choice; end if;
  if p_choice <> 'default' then
    for r in select i.product_id, sum(i.qty) as qty from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
              where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store' group by i.product_id loop
      v_restock := v_restock || jsonb_build_object(r.product_id::text, case when p_choice = 'all_fit' then r.qty else 0 end);
    end loop;
  end if;
  return receive_return(p_order, p_by, v_restock) || jsonb_build_object('short_code', (select short_code from orders where id = p_order));
end $$;

create or replace function receive_return(p_order uuid, p_by uuid, p_restock jsonb default '{}') returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; v_ok numeric; v_back numeric := 0; v_waste numeric := 0; v_waste_usd numeric := 0;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.status = 'returned' or exists (select 1 from order_events where order_id = p_order and reason = 'return_received') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if o.status <> 'failed_delivery' then raise exception 'NOT_A_FAILED_DELIVERY %', o.status; end if;
  if not exists (select 1 from parties where id = p_by and role in ('picker','ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  for r in select i.product_id, i.qty, i.unit_price_usd, f.source_id, p.storage
             from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
             join products p on p.id = i.product_id where i.order_id = p_order and s.kind = 'dark_store' and i.status = 'ok' loop
    v_ok := least(r.qty, greatest(0, coalesce((p_restock->>r.product_id::text)::numeric, case when r.storage = 'ambient' then r.qty else 0 end)));
    insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id) values (r.source_id, r.product_id, r.qty, 'return', p_order, p_by);
    update stock_levels set on_hand = on_hand + v_ok where source_id = r.source_id and product_id = r.product_id;
    if r.qty - v_ok > 0 then
      insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id) values (r.source_id, r.product_id, -(r.qty - v_ok), 'waste', p_order, p_by);
    end if;
    v_back := v_back + v_ok; v_waste := v_waste + r.qty - v_ok; v_waste_usd := v_waste_usd + (r.qty - v_ok) * r.unit_price_usd;
  end loop;
  perform transition_order(p_order, 'returned', 'ops', p_by, 'return_received', jsonb_build_object('restocked', v_back, 'wasted', v_waste));
  perform transition_order(p_order, 'closed', 'system', null, 'returned_and_reconciled');
  return jsonb_build_object('ok', true, 'restocked_units', v_back, 'wasted_units', v_waste, 'wasted_at_sell_price_usd', round(v_waste_usd, 2));
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
