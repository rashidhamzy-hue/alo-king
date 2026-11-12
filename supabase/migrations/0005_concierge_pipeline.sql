-- Alo King Chouf: the Concierge pipeline. The model reads the message once (OrderIntent);
-- plan_order() then does catalog search, the default-choice rule, address resolution and pricing in one round trip.
-- What the customer actually said for each line. The system learns new aliases from it once the order is delivered.
alter table order_items add column if not exists raw_phrase text;


-- Which product does a generic word mean? 1. what this customer bought before, 2. the brand they named,
-- 3. the best seller in stock, but only when the candidates are the same kind of thing at a similar price.
create or replace function plan_order(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable as $$
declare ln jsonb; idx int := -1; v_lines jsonb := '[]'::jsonb; v_quote_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb;
        res jsonb; m jsonb; top jsonb; ties jsonb; chosen jsonb; v_assumed boolean; v_status text; v_qty numeric; v_note text;
        v_village uuid := p_village; v_place uuid; pl jsonb; v_pickup boolean := coalesce(p_intent->>'fulfilment', '') = 'pickup';
        v_quote jsonb; v_restaurant boolean := false; v_unmatched int := 0; v_n int := 0; v_min numeric; v_max numeric; v_subs int;
        v_prepay boolean := customer_requires_prepay(p_party); v_pay text := coalesce(p_intent->>'payment_hint', 'cod');
begin
  for ln in select * from jsonb_array_elements(coalesce(p_intent->'lines', '[]'::jsonb)) loop
    idx := idx + 1; v_n := v_n + 1; chosen := null; v_assumed := false;
    res := search_catalog(coalesce(nullif(ln->>'query', ''), ln->>'raw'), nullif(ln->>'source_hint', ''), 5);
    if res->>'reason' = 'merchant_not_onboarded' then
      v_status := 'merchant_not_onboarded'; v_restaurant := true;
    elsif jsonb_array_length(res->'matches') = 0 then
      v_status := 'not_found';
    else
      top := res->'matches'->0;
      select coalesce(jsonb_agg(x), '[]'::jsonb) into ties from jsonb_array_elements(res->'matches') x
       where (x->>'score')::numeric >= (top->>'score')::numeric - 0.05;
      if p_choices ? idx::text then
        select x into chosen from jsonb_array_elements(res->'matches') x where x->>'product_id' = p_choices->>idx::text limit 1;
      end if;
      if chosen is null and jsonb_array_length(ties) = 1 then chosen := top; end if;
      if chosen is null then        -- 1. bought before
        select x into chosen from jsonb_array_elements(ties) x
         where exists (select 1 from order_items i join orders o on o.id = i.order_id
                        where o.customer_id = p_party and i.product_id = (x->>'product_id')::uuid and o.status in ('delivered','closed'))
         limit 1;
      end if;
      if chosen is null and nullif(ln->>'brand_hint', '') is not null then   -- 2. named brand
        select x into chosen from jsonb_array_elements(ties) x
         where similarity(fold_text(x->>'brand'), fold_text(ln->>'brand_hint')) > 0.4 limit 1;
      end if;
      if chosen is null then        -- 3. best seller, if the candidates are interchangeable
        select min((x->>'price_usd')::numeric), max((x->>'price_usd')::numeric), count(distinct x->>'sub_type')
          into v_min, v_max, v_subs from jsonb_array_elements(ties) x;
        if v_subs = 1 and v_min > 0 and v_max / v_min <= 2 then chosen := ties->0; v_assumed := true; end if;
      end if;
      v_status := case when chosen is null then 'ambiguous' else 'matched' end;
    end if;

    v_qty := coalesce((ln->>'qty')::numeric, 1); v_note := null;
    if chosen is not null then
      if ln->>'unit' in ('kg', 'half_kg') then
        if lower(chosen->>'sell_unit') = 'kg' then
          v_qty := v_qty * case when ln->>'unit' = 'half_kg' then 0.5 else 1 end;
        else
          v_note := case when ln->>'unit' = 'half_kg' then 'طلب نص كيلو' else 'طلب ' || v_qty || ' كيلو' end;   -- packs are sold whole: tell the picker what was asked
          v_qty := greatest(1, ceil(v_qty * case when ln->>'unit' = 'half_kg' then 0.5 else 1 end));
        end if;
      end if;
      v_quote_lines := v_quote_lines || jsonb_build_object('product_id', chosen->>'product_id', 'source_id', chosen->>'source_id',
                         'qty', v_qty, 'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', v_note, 'raw', ln->>'raw');
    else
      v_unmatched := v_unmatched + 1;
    end if;
    v_lines := v_lines || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'query', ln->>'query', 'status', v_status, 'qty', v_qty,
                 'assumed', v_assumed, 'chosen', case when chosen is null then null else
                    jsonb_build_object('product_id', chosen->>'product_id', 'name', chosen->>'name_en', 'name_ar', chosen->>'name_ar',
                                       'brand', chosen->>'brand', 'price_usd', chosen->'price_usd', 'in_stock', (chosen->>'available')::numeric > 0) end,
                 'candidates', case when v_status = 'ambiguous' then
                    (select jsonb_agg(jsonb_build_object('product_id', x->>'product_id', 'name', x->>'name_en', 'name_ar', x->>'name_ar',
                                                         'brand', x->>'brand', 'price_usd', x->'price_usd', 'in_stock', (x->>'available')::numeric > 0))
                       from (select x from jsonb_array_elements(ties) x limit 3) t)
                    else null end);
  end loop;

  -- where to
  if not v_pickup then
    if nullif(p_intent->'address'->>'village', '') is not null then
      pl := resolve_place(p_party, p_intent->'address'->>'village', p_intent->'address'->>'landmark');
      if pl->'village' is not null and (pl->>'served')::boolean then v_village := (pl->'village'->>'village_id')::uuid;
      else v_issues := v_issues || jsonb_build_object('code', coalesce(pl->>'reason', 'village_not_recognised'), 'said', p_intent->'address'->>'village');
           v_village := null;
      end if;
    end if;
    if v_village is not null then
      select id into v_place from customer_places where party_id = p_party and village_id = v_village order by last_used_at desc nulls last limit 1;
    elsif not (v_issues @> '[{"code":"village_not_recognised"}]' or v_issues @> '[{"code":"village_not_served"}]') then
      select id, village_id into v_place, v_village from customer_places where party_id = p_party and village_id is not null
        order by last_used_at desc nulls last limit 1;      -- "the usual place"
    end if;
  end if;

  if v_n = 0 then v_issues := v_issues || jsonb_build_object('code', 'empty_order'); end if;
  if v_unmatched = 0 and v_n > 0 then
    v_quote := quote_order(v_quote_lines, v_village, v_pickup);
    v_issues := v_issues || (v_quote->'issues');
  elsif jsonb_array_length(v_quote_lines) > 0 then
    v_quote := quote_order(v_quote_lines, v_village, v_pickup);      -- price what we can, for the question
  end if;
  if v_prepay and v_pay = 'cod' then v_pay := 'whish'; end if;

  return jsonb_build_object(
    'next', case when v_restaurant then 'handoff'
                 when v_n > 0 and v_unmatched = 0 and jsonb_array_length(v_issues) = 0 then 'card' else 'ask' end,
    'handoff_reason', case when v_restaurant then 'restaurant_order' else null end,
    'lines', v_lines, 'quote_lines', v_quote_lines, 'quote', v_quote, 'issues', v_issues,
    'village_id', v_village, 'place_id', v_place, 'pickup', v_pickup,
    'needs_pin', (not v_pickup and v_village is not null and not exists (
                    select 1 from customer_places where party_id = p_party and village_id = v_village and lat is not null)),
    'payment_method', v_pay, 'prepay_required', v_prepay, 'dues_usd', customer_dues_usd(p_party),
    'change_for_usd', p_intent->'change_for_usd');
end $$;

-- Orders now carry what the customer owes from a failed delivery, and such customers pay in advance.
create or replace function create_order_from_quote(
  p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null
) returns jsonb language plpgsql as $$
declare q jsonb := quote_order(p_lines, p_village, p_pickup); v_order uuid; v_code text; ln jsonb; v_ful uuid; v_stale uuid;
        v_dues numeric := customer_dues_usd(p_customer); v_total numeric; v_fx numeric;
begin
  if (q->>'ok')::boolean and v_dues > 0 and p_payment = 'cod' then
    q := jsonb_set(jsonb_set(q, '{ok}', 'false'), '{issues}', (q->'issues') || jsonb_build_object('code', 'prepay_required', 'dues_usd', v_dues));
  end if;
  if not (q->>'ok')::boolean then return jsonb_build_object('created', false, 'quote', q); end if;
  for v_stale in select id from orders where conversation_id = p_conversation and status in ('awaiting_confirmation', 'draft') loop
    perform transition_order(v_stale, 'cancelled', 'system', null, 'superseded_by_new_card');
  end loop;

  v_code := 'AK-' || nextval('order_code_seq');
  insert into orders(short_code, customer_id, conversation_id, village_id, place_id, is_pickup, subtotal_usd, delivery_fee_usd,
                     dues_usd, payment_method, change_for_usd, customer_notes)
    values (v_code, p_customer, p_conversation, p_village, p_place, p_pickup, (q->>'subtotal_usd')::numeric,
            (q->>'delivery_fee_usd')::numeric, v_dues, p_payment, p_change_for, p_notes)
    returning id into v_order;
  for ln in select * from jsonb_array_elements(q->'lines') loop
    insert into fulfilments(order_id, source_id) values (v_order, (ln->>'source_id')::uuid)
      on conflict (order_id, source_id) do update set source_id = excluded.source_id returning id into v_ful;
    update fulfilments set subtotal_usd = subtotal_usd + (ln->>'line_total_usd')::numeric where id = v_ful;
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note, raw_phrase)
      values (v_order, v_ful, (ln->>'product_id')::uuid, ln->>'name', (ln->>'qty')::numeric, (ln->>'unit_price_usd')::numeric,
              coalesce(ln->'modifiers', '[]'::jsonb), ln->>'note', nullif(ln->>'raw', ''));
  end loop;
  perform transition_order(v_order, 'awaiting_confirmation', 'agent');
  update conversations set active_order_id = v_order, updated_at = now() where id = p_conversation;
  v_total := (q->>'total_usd')::numeric + v_dues; v_fx := (q->>'fx_rate_lbp')::numeric;
  q := q || jsonb_build_object('dues_usd', v_dues, 'total_usd', v_total,
                               'total_lbp', case when v_fx is null then null else round(v_total * v_fx / 1000) * 1000 end);
  return jsonb_build_object('created', true, 'order_id', v_order, 'short_code', v_code, 'payment_method', p_payment,
                            'change_for_usd', p_change_for, 'quote', q);
end $$;

-- Answers "where is my order" without a model.
create or replace function order_status_for(p_party uuid) returns jsonb language sql stable as $$
  select to_jsonb(x) from (
    select o.id as order_id, o.short_code, o.status, o.total_usd, o.payment_method,
           (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id) as eta_minutes
    from orders o where o.customer_id = p_party and o.status not in ('draft', 'closed', 'cancelled', 'returned')
    order by o.created_at desc limit 1) x
$$;
