-- Alo King Chouf: build plan 1.20. "Same as last time" as one button for a returning customer.
--   basket_from_order(): any order of this customer, its lines re-priced and re-checked for stock now; what cannot be
--     supplied is named in `missing` and left out. Used for the repeat button and for a card whose quote went stale.
--   repeat_plan(): as 0014, now built on basket_from_order (same result shape).
--   repeat_offer(): what the button offers, or null. Null for anyone without a closed (delivered and paid) order, so the
--     button is never shown to them.

create or replace function basket_from_order(p_party uuid, p_order uuid) returns jsonb language plpgsql stable as $$
declare o orders%rowtype; ln record; v_all jsonb := '[]'::jsonb; v_ok jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb;
        q jsonb; v_pay text; v_good boolean;
begin
  select * into o from orders where id = p_order and customer_id = p_party;
  if not found then return jsonb_build_object('found', false); end if;

  for ln in select i.product_id, f.source_id, i.qty, i.modifiers, i.note, i.raw_phrase
              from order_items i join fulfilments f on f.id = i.fulfilment_id
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
  return jsonb_build_object('found', true, 'order_id', o.id, 'short_code', o.short_code, 'status', o.status,
    'lines', v_ok, 'missing', v_missing, 'village_id', o.village_id, 'place_id', o.place_id, 'pickup', o.is_pickup,
    'payment_method', v_pay, 'change_for_usd', o.change_for_usd, 'notes', o.customer_notes,
    'quote', case when jsonb_array_length(v_ok) > 0 then q else null end);
end $$;

create or replace function last_closed_order(p_party uuid) returns uuid language sql stable as $$
  select id from orders where customer_id = p_party and status = 'closed' order by coalesce(delivered_at, created_at) desc limit 1 $$;

create or replace function repeat_plan(p_party uuid, p_order uuid default null) returns jsonb language plpgsql stable as $$
declare v_order uuid;
begin
  if p_order is null then v_order := last_closed_order(p_party);
  else select id into v_order from orders where id = p_order and customer_id = p_party and status = 'closed';
  end if;
  if v_order is null then return jsonb_build_object('found', false); end if;
  return basket_from_order(p_party, v_order);
end $$;

create or replace function repeat_offer(p_party uuid) returns jsonb language sql stable as $$
  select case when o.id is null then null else jsonb_build_object('order_id', o.id, 'short_code', o.short_code,
           'items', (select coalesce(jsonb_agg(coalesce(p.name_ar, i.name_snapshot) order by i.id), '[]'::jsonb)
                       from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok')) end
  from (select last_closed_order(p_party) as lid) l left join orders o on o.id = l.lid $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
