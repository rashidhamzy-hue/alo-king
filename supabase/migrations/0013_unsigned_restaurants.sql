-- Alo King Chouf: build plan 1.2. A restaurant that has not been through approve_merchant() is not available.
-- The customer is told so, plainly. Nobody phones the order in, and the request is not handed to a person as an order.
--   1. search_catalog: a merchant counts only once approved. A named shop that is not approved answers merchant_not_onboarded,
--      and an unapproved merchant's products never appear in a search, named or not.
--   2. plan_order: lines for an unsigned restaurant are set aside and listed in `unavailable`. If nothing else is left the
--      answer is next = 'not_available'; otherwise the rest of the order is planned as usual. There is no restaurant handoff.
-- Logging the request as demand is build plan 1.12 (migrations 0020-0029); it can read `unavailable` from the plan.

create or replace function search_catalog(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable as $$
declare q text := fold_text(p_query); v_sources uuid[]; v_matches jsonb;
begin
  if p_source_hint is not null and btrim(p_source_hint) <> '' then
    select array_agg(id) into v_sources from sources
     where kind = 'merchant' and approved_at is not null and similarity(fold_text(name), fold_text(p_source_hint)) > 0.35;
    if v_sources is null then
      return jsonb_build_object('matches', '[]'::jsonb, 'reason', 'merchant_not_onboarded', 'source_hint', p_source_hint);
    end if;
  end if;

  with candidates as (            -- the trigram indexes do the narrowing
    select product_id as id from product_aliases where alias_folded % q
    union select id from products where search_folded % q
  ), scored as (
    select p.id, greatest(
             similarity(p.search_folded, q),
             coalesce((select max(greatest(similarity(a.alias_folded, q), word_similarity(a.alias_folded, q) * 0.9))
                       from product_aliases a where a.product_id = p.id), 0)) as score
    from products p join candidates c on c.id = p.id where p.is_active
  ), ranked as (
    select p.id as product_id, p.sku, p.name_en, p.name_ar, p.brand, p.category, p.sub_type, p.sell_unit, p.velocity_tier,
           s.id as source_id, s.name as source_name, s.kind as source_kind, o.price_usd, o.sponsored_rank,
           case when s.kind = 'dark_store' then coalesce(l.on_hand - l.reserved, 0)
                when o.is_available and s.is_open then 999 else 0 end as available,
           sc.score
    from scored sc join products p on p.id = sc.id
    join offers o on o.product_id = p.id join sources s on s.id = o.source_id
    left join stock_levels l on l.product_id = p.id and l.source_id = s.id
    where sc.score >= 0.5 and (v_sources is null or s.id = any(v_sources))
      and (s.kind = 'dark_store' or s.approved_at is not null)
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc, (r.available > 0) desc, r.sponsored_rank nulls last, r.velocity_tier nulls last, r.price_usd), '[]'::jsonb)
    into v_matches
  from (select * from ranked order by score desc, (available > 0) desc, sponsored_rank nulls last, velocity_tier nulls last, price_usd limit p_limit) r;

  return jsonb_build_object('matches', v_matches,
    'reason', case when jsonb_array_length(v_matches) = 0 then 'no_match' else null end);
end $$;

-- As 0005, with unsigned restaurants set aside instead of handed off.
create or replace function plan_order(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable as $$
declare ln jsonb; idx int := -1; v_lines jsonb := '[]'::jsonb; v_quote_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb;
        res jsonb; top jsonb; ties jsonb; chosen jsonb; v_assumed boolean; v_status text; v_qty numeric; v_note text;
        v_village uuid := p_village; v_place uuid; pl jsonb; v_pickup boolean := coalesce(p_intent->>'fulfilment', '') = 'pickup';
        v_quote jsonb; v_unavailable jsonb := '[]'::jsonb; v_unmatched int := 0; v_n int := 0; v_min numeric; v_max numeric; v_subs int;
        v_prepay boolean := customer_requires_prepay(p_party); v_pay text := coalesce(p_intent->>'payment_hint', 'cod');
begin
  for ln in select * from jsonb_array_elements(coalesce(p_intent->'lines', '[]'::jsonb)) loop
    idx := idx + 1; chosen := null; v_assumed := false;
    res := search_catalog(coalesce(nullif(ln->>'query', ''), ln->>'raw'), nullif(ln->>'source_hint', ''), 5);
    if res->>'reason' = 'merchant_not_onboarded' then
      v_unavailable := v_unavailable || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'source_hint', ln->>'source_hint');
      v_lines := v_lines || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'query', ln->>'query', 'status', 'merchant_not_onboarded',
                   'qty', coalesce((ln->>'qty')::numeric, 1), 'assumed', false, 'chosen', null, 'candidates', null,
                   'source_hint', ln->>'source_hint');
      continue;
    end if;
    v_n := v_n + 1;
    if jsonb_array_length(res->'matches') = 0 then
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
      else v_issues := v_issues || jsonb_build_object('code', coalesce(pl->>'reason', 'village_not_recognised'), 'said', p_intent->'address'->>'village',
                                                      'village', pl->'village'->>'name_en', 'village_ar', pl->'village'->>'name_ar');
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

  if v_n = 0 and jsonb_array_length(v_unavailable) = 0 then v_issues := v_issues || jsonb_build_object('code', 'empty_order'); end if;
  if v_unmatched = 0 and v_n > 0 then
    v_quote := quote_order(v_quote_lines, v_village, v_pickup);
    v_issues := v_issues || (v_quote->'issues');
  elsif jsonb_array_length(v_quote_lines) > 0 then
    v_quote := quote_order(v_quote_lines, v_village, v_pickup);      -- price what we can, for the question
  end if;
  if v_prepay and v_pay = 'cod' then v_pay := 'whish'; end if;

  return jsonb_build_object(
    'next', case when v_n = 0 and jsonb_array_length(v_unavailable) > 0 then 'not_available'
                 when v_n > 0 and v_unmatched = 0 and jsonb_array_length(v_issues) = 0 then 'card' else 'ask' end,
    'handoff_reason', null, 'unavailable', v_unavailable,
    'lines', v_lines, 'quote_lines', v_quote_lines, 'quote', v_quote, 'issues', v_issues,
    'village_id', v_village, 'place_id', v_place, 'pickup', v_pickup,
    'needs_pin', (not v_pickup and v_village is not null and not exists (
                    select 1 from customer_places where party_id = p_party and village_id = v_village and lat is not null)),
    'payment_method', v_pay, 'prepay_required', v_prepay, 'dues_usd', customer_dues_usd(p_party),
    'change_for_usd', p_intent->'change_for_usd');
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
