-- Alo King Chouf, session SR1, part 4 of 5: baskets built by code. A dish for N people, a week of lunchbox snacks and a budget basket
-- are built here from PD1's dishes, portions and unit prices (0208); the turn prices them with quote_order (invariant 7) and the customer
-- confirms the card (invariant 4). Nothing here is a fact about food: an item's kind, a shopping tag and a portion are data, and any
-- filter the customer stated (an allergy, "no sugar") is applied with product_passes_filters (0213), so nothing crosses it.
--
--   kind_piece_weights  grams of one piece of a kind (an onion, a loaf of Arabic bread), to turn "1 onion per person" into kilos or packs.
--   basket_themes       what a budget basket holds when the customer names a theme ("party", "cleaning") or none (staples): data.
--   dish_in_text()      the dish the words name (dishes.words, as said in four languages), longest match first.
--   basket_quantity()   for one product and a need (360 g, 6 pieces, 2 bunches): how many sale units cover it, or null when code cannot tell.
--   build_basket(text, ask, filters)  the lines (product, quantity, the kind and need it covers), the kinds no item could cover and why,
--                       the subtotal at the hub's prices, and whether it is over the budget. ask: {type: dish|lunchbox|budget, people,
--                       children, days, max_usd} from the reading step (search-reading.ts).

create table if not exists kind_piece_weights (
  kind   text primary key,
  grams  numeric not null check (grams > 0),
  source text not null check (source in ('rules', 'model', 'person'))
);
insert into kind_piece_weights(kind, grams, source) values
  ('onion', 150, 'person'), ('tomato', 150, 'person'), ('lemon', 100, 'person'), ('cucumber', 120, 'person'), ('lettuce', 500, 'person'),
  ('arabic bread', 110, 'person'), ('eggs', 60, 'person'), ('potato', 200, 'person'), ('garlic', 50, 'person')
on conflict (kind) do nothing;

create table if not exists basket_themes (
  code     text primary key,
  words    text[] not null default '{}',         -- folded tokens that name the theme
  kinds    text[] not null default '{}',         -- in order: the first kinds are added first
  tag      text references tag_codes(code),
  family   text                                  -- kind_families (0213)
);
insert into basket_themes(code, words, kinds, tag, family) values
  ('staples', '{}', '{arabic bread,eggs,labneh,rice,lentils,tomato,cucumber,milk,olive oil,pasta,tomato paste}', null, null),
  ('party', array(select unnest(catalog_tokens('party soirée fête سهرة حفلة sahra تسالي tasali'))), '{}', 'party', null),
  ('cleaning', array(select unnest(catalog_tokens('cleaning ménage nettoyage تنظيف tanzif'))), '{}', null, 'cleaning')
on conflict (code) do nothing;

-- More ways customers name PD1's dishes (0208), in French and Arabizi.
update dishes set words = words || '{taboulé,taboule,tabbouli}'::text[] where code = 'tabbouleh' and not ('taboulé' = any(words));
update dishes set words = words || '{soupe de lentilles,soupe aux lentilles,shorbet adas}'::text[] where code = 'lentil_soup' and not ('soupe de lentilles' = any(words));
update dishes set words = words || '{mjaddara,mjadra,moujadara}'::text[] where code = 'mjadra' and not ('mjaddara' = any(words));
update dishes set words = words || '{man2ouche,manakeesh,man2ouché}'::text[] where code = 'manakish' and not ('man2ouche' = any(words));
update dishes set words = words || '{petit déjeuner libanais,terwi2ah}'::text[] where code = 'breakfast' and not ('terwi2ah' = any(words));

-- The dish the words name: every token of one of its words is in the text (with Arabic clitics allowed). The longest word wins.
create or replace function dish_in_text(p_text text) returns text language sql stable set search_path = public, pg_temp as $$
  select d.code from dishes d cross join lateral unnest(d.words) w
   where cardinality(catalog_tokens(w)) > 0
     and not exists (select 1 from unnest(catalog_tokens(w)) t
                      where not catalog_token_forms(t) && (select coalesce(array_agg(x), '{}') from unnest(catalog_tokens(p_text)) tt, unnest(catalog_token_forms(tt)) x))
   order by cardinality(catalog_tokens(w)) desc, length(w) desc limit 1 $$;

-- How many sale units of a product cover a need. Null when code cannot tell (no size printed, no count, no piece weight).
--   g / ml: by the size printed (900g, 3L, 185g x3), or by the kilo in half-kilo steps for an item sold by weight
--   piece: by the count printed (30 Pcs, 7 Loaves), else by the piece weight of the kind against the size or the kilo
--   bunch: an item sold by the bunch; pack: one pack each
create or replace function basket_quantity(p_product uuid, p_kind text, p_need numeric, p_unit text) returns numeric
language plpgsql stable set search_path = public, pg_temp as $$
declare p products%rowtype; k text; m text[]; v_size numeric; v_count int; v_w numeric; v_by_kg boolean;
begin
  select * into p from products where id = p_product;
  if not found or coalesce(p_need, 0) <= 0 then return null; end if;
  v_by_kg := lower(coalesce(p.sell_unit, '')) = 'kg';
  k := coalesce(product_unit_price(p_product)->>'size', intake_size_key(p.name_en));
  m := case when k is null then null else regexp_match(k, '^([0-9.]+)(g|ml)(?:x([0-9]+))?$') end;
  if m is not null then v_size := m[1]::numeric * coalesce(nullif(m[3], '')::int, 1); end if;
  v_count := (regexp_match(p.name_en, '(?i)\(?([0-9]+)\s*(?:pcs|pieces|loaves|rolls)\M'))[1]::int;
  v_w := (select grams from kind_piece_weights where kind = lower(p_kind));
  if p_unit in ('g', 'ml') then
    if v_size > 0 then return ceil(p_need / v_size); end if;
    if v_by_kg then return ceil(p_need / 500.0) * 0.5; end if;
    return null;
  elsif p_unit = 'piece' then
    if v_count > 0 then return ceil(p_need / v_count); end if;
    -- an item sold one by one with no size printed is one piece (a lettuce)
    if v_size is null and lower(coalesce(p.sell_unit, '')) in ('each', 'piece') and v_w is not null then return ceil(p_need); end if;
    if v_w is not null and v_size > 0 then return ceil(p_need * v_w / v_size); end if;
    if v_w is not null and v_by_kg then return ceil(p_need * v_w / 500.0) * 0.5; end if;
    return null;
  elsif p_unit = 'bunch' then
    return case when lower(coalesce(p.sell_unit, '')) = 'bunch' then ceil(p_need) end;
  elsif p_unit = 'pack' then
    return ceil(p_need);
  end if;
  return null;
end $$;

-- Products a basket may use: active at the hub, on sale with a price, passing the customer's filters.
create or replace function basket_candidates(p_filters jsonb) returns table (product_id uuid, kind text, price_usd numeric, available numeric, name_en text)
language sql stable set search_path = public, pg_temp as $$
  select p.id, product_kind(p.id), o.price_usd, coalesce(l.on_hand - l.reserved, 0), p.name_en
    from products p
    join lateral (select x.source_id, x.price_usd, x.is_available from offers x join sources s on s.id = x.source_id and s.kind = 'dark_store'
                   where x.product_id = p.id order by x.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
   where p.is_active and p.owner_source_id is null and o.is_available and o.price_usd > 0
     and (coalesce(p_filters, '{}'::jsonb) - 'prefer_tags' - 'sort' = '{}'::jsonb
          or (product_passes_filters(p.id, coalesce(p_filters, '{}'::jsonb) - 'prefer_tags' - 'sort')->>'pass')::boolean) $$;

-- (search_path holds extensions only because the guard of 0020 reads the modulo below as a trigram operator)
create or replace function build_basket(p_text text, p_ask jsonb, p_filters jsonb default '{}') returns jsonb
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare v_type text := coalesce(p_ask->>'type', 'budget'); v_max numeric := json_num(p_ask->'max_usd');
        v_lines jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb; v_sub numeric := 0; v_dish text; v_people int; d record; c record;
        v_best record; v_qty numeric; v_need numeric; v_n int; v_theme basket_themes%rowtype; v_tokens text[]; v_pick uuid[];
        f jsonb := coalesce(p_filters, '{}'::jsonb) - 'audience';
begin
  create temp table if not exists _bk_cand (product_id uuid, kind text, price_usd numeric, available numeric, name_en text) on commit drop;
  truncate _bk_cand;
  insert into _bk_cand select * from basket_candidates(f);

  if v_type = 'dish' then
    v_people := json_num(p_ask->'people')::int;
    v_dish := dish_in_text(p_text);
    if v_dish is null then return jsonb_build_object('ok', false, 'refused', 'no_dish'); end if;
    if v_people is null or v_people < 1 or v_people > 50 then return jsonb_build_object('ok', false, 'refused', 'people', 'dish', v_dish); end if;
    for d in select * from dish_kinds where dish_code = v_dish and not optional order by kind loop
      v_need := d.qty_per_person * v_people;
      select c2.*, q.qty, q.qty * c2.price_usd as cost into v_best
        from _bk_cand c2 cross join lateral (select basket_quantity(c2.product_id, d.kind, v_need, d.unit) as qty) q
       where c2.kind = lower(d.kind) and q.qty is not null
       order by (c2.available > 0) desc, q.qty * c2.price_usd, c2.name_en limit 1;
      if v_best.product_id is null then
        v_missing := v_missing || jsonb_build_object('kind', d.kind,
          'reason', case when not exists (select 1 from products p where p.is_active and product_kind(p.id) = lower(d.kind)) then 'not_carried'
                         when not exists (select 1 from products p join offers o on o.product_id = p.id
                                           where p.is_active and product_kind(p.id) = lower(d.kind) and o.is_available and o.price_usd > 0) then 'not_on_sale'
                         else 'none_passes' end);
        continue;
      end if;
      v_lines := v_lines || jsonb_build_object('product_id', v_best.product_id, 'name_en', v_best.name_en, 'qty', v_best.qty, 'kind', d.kind,
                                               'need', v_need, 'need_unit', d.unit, 'price_usd', v_best.price_usd, 'line_usd', round(v_best.cost, 2));
      v_sub := v_sub + v_best.cost;
      v_best := null;
    end loop;
    return jsonb_build_object('ok', jsonb_array_length(v_lines) > 0, 'type', 'dish', 'dish', v_dish,
      'dish_name', (select jsonb_build_object('en', name_en, 'ar', name_ar) from dishes where code = v_dish), 'people', v_people,
      'lines', v_lines, 'missing', v_missing, 'subtotal_usd', round(v_sub, 2), 'max_usd', v_max, 'over_budget', v_max is not null and v_sub > v_max);
  end if;

  if v_type = 'lunchbox' then
    v_n := greatest(1, least(coalesce(json_num(p_ask->'children'), 1), 10))::int * greatest(1, least(coalesce(json_num(p_ask->'days'), 5), 14))::int
           * coalesce((select qty from portions where kind = 'snack' and per = 'child_day')::int, 1);
    -- lunchbox items (the shopping tag), cheapest first, at most five different ones; one dropped at a time while over the budget
    v_pick := array(select product_id from _bk_cand c2 where exists (select 1 from product_tags pt where pt.product_id = c2.product_id and pt.tag_code = 'lunchbox' and pt.approved)
                     order by (available > 0) desc, price_usd, name_en limit 5);
    loop
      exit when cardinality(v_pick) = 0;
      select coalesce(sum(c2.price_usd * (v_n / cardinality(v_pick) + case when i <= v_n % cardinality(v_pick) then 1 else 0 end)), 0) into v_sub
        from unnest(v_pick) with ordinality u(id, i) join _bk_cand c2 on c2.product_id = u.id;
      exit when v_max is null or v_sub <= v_max or cardinality(v_pick) = 1;
      v_pick := v_pick[1:cardinality(v_pick) - 1];
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('product_id', c2.product_id, 'name_en', c2.name_en,
             'qty', v_n / cardinality(v_pick) + case when i <= v_n % cardinality(v_pick) then 1 else 0 end, 'kind', c2.kind, 'tag', 'lunchbox',
             'price_usd', c2.price_usd) order by i), '[]'::jsonb) into v_lines
      from unnest(v_pick) with ordinality u(id, i) join _bk_cand c2 on c2.product_id = u.id;
    return jsonb_build_object('ok', jsonb_array_length(v_lines) > 0, 'type', 'lunchbox', 'units', v_n, 'lines', v_lines,
      'missing', case when jsonb_array_length(v_lines) = 0 then jsonb_build_array(jsonb_build_object('kind', 'lunchbox snacks', 'reason', 'none_passes')) else '[]'::jsonb end,
      'subtotal_usd', round(coalesce(v_sub, 0), 2), 'max_usd', v_max, 'over_budget', v_max is not null and coalesce(v_sub, 0) > v_max);
  end if;

  -- a budget basket: the theme the words name, else staples; one sale unit of each, cheapest first, while it fits
  if v_max is null or v_max <= 0 then return jsonb_build_object('ok', false, 'refused', 'budget'); end if;
  v_tokens := array(select x from unnest(catalog_tokens(coalesce(p_text, ''))) t, unnest(catalog_token_forms(t)) x);
  select * into v_theme from basket_themes where code <> 'staples' and words && v_tokens order by code limit 1;
  if not found then select * into v_theme from basket_themes where code = 'staples'; end if;
  for c in
    select c2.*, coalesce(array_position(v_theme.kinds, c2.kind), 999) as pos from _bk_cand c2
     where (cardinality(v_theme.kinds) > 0 and c2.kind = any(v_theme.kinds))
        or (v_theme.tag is not null and exists (select 1 from product_tags pt where pt.product_id = c2.product_id and pt.tag_code = v_theme.tag and pt.approved))
        or (v_theme.family is not null and c2.kind in (select kind from kind_families where family = v_theme.family))
     order by pos, (c2.available > 0) desc, c2.price_usd, c2.name_en
  loop
    continue when exists (select 1 from jsonb_array_elements(v_lines) l where l->>'kind' = c.kind);   -- one of each kind
    continue when v_sub + c.price_usd > v_max;
    v_lines := v_lines || jsonb_build_object('product_id', c.product_id, 'name_en', c.name_en, 'qty', 1, 'kind', c.kind, 'price_usd', c.price_usd,
                                             'tag', v_theme.tag);
    v_sub := v_sub + c.price_usd;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(v_lines) > 0, 'type', 'budget', 'theme', v_theme.code, 'lines', v_lines, 'missing', '[]'::jsonb,
    'subtotal_usd', round(v_sub, 2), 'max_usd', v_max, 'over_budget', false);
end $$;

do $$ declare t text; r text; f text;
begin
  foreach t in array array['kind_piece_weights', 'basket_themes'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  foreach f in array array['dish_in_text(text)', 'basket_quantity(uuid,text,numeric,text)', 'basket_candidates(jsonb)', 'build_basket(text,jsonb,jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
