-- Alo King Chouf, session PD1, pull request 3, part (h): what the enrichment run over the catalogue needs in the database.
--
--   market_code()        a market as code compares it: "Lebanon", "LB", "en:lebanon" are all lb; "UAE" and "United Arab Emirates" are ae.
--                        An Open Food Facts record has no market of its own: it is the market of its barcode's GS1 prefix (528 is lb),
--                        so a Turkish-registered item sold here and a Lebanese page never count as the same market. Conservative.
--   published_source_of  (0207) now compares markets by code.
--   apply_rule_fields()  the rules pass: fields a deterministic rule can set from what the catalogue already holds (the sale unit of
--                        produce, a meat's fresh or frozen, water's volume and type as printed in the name, a nappy's size and weight
--                        range as printed, a pet item's species, packed apart from food, the chilled bag, the pack count, the format
--                        tags). Each is a proposal with source 'rules', approved by the rule_fields row when nothing disagrees (0207).
--   enrichment_report()  per active hub item: its template and level, what it misses, and the route that fills each missing field:
--                        a page already on file (waiting for a second source or a person), the supplier sheet, a label photo at a shop
--                        shelf before stock arrives, or the label photo at the first receiving; and the shelf-visit list by aisle.

create or replace function market_code(p text) returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when x is null or x = '' then null
    when x in ('lb', 'lebanon', 'liban', 'لبنان', 'leb') then 'lb'
    when x in ('ae', 'uae', 'united arab emirates', 'emirates', 'dubai', 'الإمارات') then 'ae'
    when x in ('sa', 'ksa', 'saudi arabia', 'saudi', 'السعودية') then 'sa'
    when x in ('eg', 'egypt', 'مصر') then 'eg'
    when x in ('jo', 'jordan', 'الأردن') then 'jo'
    when x in ('kw', 'kuwait') then 'kw'
    when x in ('qa', 'qatar') then 'qa'
    when x in ('bh', 'bahrain') then 'bh'
    when x in ('om', 'oman') then 'om'
    when x in ('tr', 'turkey', 'türkiye', 'turkiye') then 'tr'
    when x in ('fr', 'france') then 'fr'
    when x in ('gb', 'uk', 'united kingdom') then 'gb'
    when x in ('us', 'usa', 'united states') then 'us'
    when x ~ '^[a-z]{2}$' then x
    else null end
  from (select lower(btrim(regexp_replace(coalesce(p, ''), '^en:', ''))) as x) y $$;

-- The GS1 prefix of a barcode, as a market (the country where the code was issued). Only the prefixes this catalogue meets.
create or replace function barcode_market(p_code text) returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when d is null or length(d) < 8 then null
    when left(d, 3) = '528' then 'lb' when left(d, 3) = '622' then 'eg' when left(d, 3) = '628' then 'sa' when left(d, 3) = '629' then 'ae'
    when left(d, 3) = '625' then 'jo' when left(d, 3) = '627' then 'kw' when left(d, 3) = '869' then 'tr' when left(d, 3) = '529' then 'cy'
    when left(d, 3) between '300' and '379' then 'fr' when left(d, 3) between '400' and '440' then 'de' when left(d, 3) between '500' and '509' then 'gb'
    when left(d, 3) between '800' and '839' then 'it' when left(d, 3) between '840' and '849' then 'es' when left(d, 3) between '870' and '879' then 'nl'
    when length(d) = 12 or left(d, 1) = '0' then 'us'
    else null end
  from (select nullif(regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g'), '') as d) x $$;

create or replace function published_source_of(f product_facts, p_key text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case f.source
    when 'open_food_facts' then jsonb_build_object('host', 'openfoodfacts.org', 'tied', intake_barcode_key(f.detail->>'off_code') = p_key,
                                                   'market', coalesce(market_code(f.detail->>'market'), barcode_market(f.detail->>'off_code')))
    when 'web_page' then jsonb_build_object('host', lower(substring(coalesce(f.detail->>'page_url', '') from '^https://(?:www\.)?([^/:?#]+)')),
                                            'tied', intake_barcode_key(f.detail->'matched'->>'barcode') = p_key and f.detail->'matched'->>'confidence' = 'exact',
                                            'market', market_code(coalesce(f.detail->>'market', f.detail->>'country')))
  end $$;

-- ---------- the rules pass ----------
-- One proposal by rules; nothing when the same value is already proposed or approved. Returns 1 when a proposal was written.
create or replace function propose_rule_value(p_product uuid, p_field text, p_value jsonb, p_basis text) returns int language plpgsql set search_path = public, pg_temp as $$
begin
  if p_value is null or p_value = 'null'::jsonb then return 0; end if;
  if exists (select 1 from product_field_values where product_id = p_product and field_key = p_field and value = p_value and status in ('proposed', 'approved')) then return 0; end if;
  begin
    insert into product_field_values(product_id, field_key, value, source, detail) values (p_product, p_field, p_value, 'rules', jsonb_build_object('basis', p_basis));
    return 1;
  exception when others then return 0;                    -- a field the item's template does not have: not this item's rule
  end;
end $$;

create or replace function apply_rule_fields(p_product uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare p record; v_t text; k text; m text[]; n int := 0; tags int := 0; v_auto jsonb;
begin
  for p in select * from products where is_active and owner_source_id is null and (p_product is null or id = p_product) loop
    v_t := product_template(p.id);
    k := intake_size_key(p.name_en);
    m := case when k is null then null else regexp_match(k, '^([0-9.]+)(g|ml)(?:x([0-9]+))?$') end;
    -- every grocery item: packed apart from food (cleaning), the chilled bag (chilled or frozen), the pack count printed in the name
    if v_t = 'cleaning_household' then n := n + propose_rule_value(p.id, 'packed_apart', 'true', 'cleaning products are packed apart from food'); end if;
    if p.storage in ('chilled', 'frozen') then n := n + propose_rule_value(p.id, 'chilled_bag', 'true', 'storage zone ' || p.storage); end if;
    if m is not null and m[3] is not null then n := n + propose_rule_value(p.id, 'pack_count', to_jsonb(m[3]::int), 'printed in the name: ' || p.name_en); end if;
    if k is not null then n := n + propose_rule_value(p.id, 'size', to_jsonb(k), 'printed in the name: ' || p.name_en); end if;
    -- format tags (shopping tags): a multipack, a single serve (50 g or ml or less), a family pack (2 kg or 2 l or more)
    if m is not null and m[3] is not null then insert into product_tags(product_id, tag_code, source) values (p.id, 'multipack', 'rules') on conflict do nothing; tags := tags + 1;
    elsif m is not null and m[1]::numeric <= 50 then insert into product_tags(product_id, tag_code, source) values (p.id, 'single_serve', 'rules') on conflict do nothing; tags := tags + 1;
    elsif m is not null and m[1]::numeric >= 2000 then insert into product_tags(product_id, tag_code, source) values (p.id, 'family_pack', 'rules') on conflict do nothing; tags := tags + 1;
    end if;
    if v_t = 'fresh_produce' then
      n := n + propose_rule_value(p.id, 'sale_unit', to_jsonb(case when lower(p.sell_unit) = 'kg' then 'kg' when lower(p.sell_unit) = 'bunch' then 'bunch'
                                                                   when lower(p.sell_unit) = 'piece' then 'piece' else 'pack' end), 'sell unit ' || p.sell_unit);
    elsif v_t = 'meat_poultry' then
      n := n + propose_rule_value(p.id, 'fresh_or_frozen', to_jsonb(case when p.storage = 'frozen' then 'frozen' else 'fresh' end), 'storage zone ' || p.storage);
    elsif v_t = 'water' then
      if m is not null then n := n + propose_rule_value(p.id, 'volume_ml', to_jsonb(m[1]::numeric), 'printed in the name: ' || p.name_en); end if;
      if p.name_en ~* 'sparkling' then n := n + propose_rule_value(p.id, 'water_type', '"sparkling"', 'printed in the name');
      elsif p.name_en ~* 'mineral' then n := n + propose_rule_value(p.id, 'water_type', '"mineral"', 'printed in the name');
      elsif p.name_en ~* 'drinking|pure life' then n := n + propose_rule_value(p.id, 'water_type', '"drinking"', 'printed in the name'); end if;
      if p.name_en ~* 'gallon|10 ?l\M' then n := n + propose_rule_value(p.id, 'gallon_exchange', 'true', 'a large format'); end if;
    elsif v_t = 'baby_child' then
      if p.name_en ~* 'size [0-9]+' then
        n := n + propose_rule_value(p.id, 'size_weight_range', to_jsonb(substring(p.name_en from '(?i)(size [0-9]+(?: [0-9]+-[0-9]+ ?kg)?)')), 'printed in the name');
      end if;
      if p.name_en ~* '([0-9]+) ?(pieces|pcs|sheets)' then
        n := n + propose_rule_value(p.id, 'count', to_jsonb((regexp_match(p.name_en, '(?i)([0-9]+) ?(?:pieces|pcs|sheets)'))[1]::int), 'printed in the name');
      end if;
    elsif v_t = 'pet' then
      if lower(coalesce(p.sub_type, '')) ~ 'cat' or p.name_en ~* '\mcat|gatto' then n := n + propose_rule_value(p.id, 'species', '"cat"', 'sub-type ' || coalesce(p.sub_type, '')); end if;
      if lower(coalesce(p.sub_type, '')) ~ 'dog' then n := n + propose_rule_value(p.id, 'species', '"dog"', 'sub-type ' || coalesce(p.sub_type, '')); end if;
      if lower(coalesce(p.sub_type, '')) ~ 'litter' then n := n + propose_rule_value(p.id, 'life_stage', '"not_food"', 'litter is not food'); end if;
    elsif v_t = 'cleaning_household' and p.name_en ~* '([0-9]+) ?(pieces|pcs|rolls|sheets)' then
      n := n + propose_rule_value(p.id, 'count', to_jsonb((regexp_match(p.name_en, '(?i)([0-9]+) ?(?:pieces|pcs|rolls|sheets)'))[1]::int), 'printed in the name');
    end if;
  end loop;
  v_auto := intake_try_auto(p_product);
  return jsonb_build_object('proposed', n, 'tags', tags, 'auto', v_auto);
end $$;

-- The items the run works on: active hub items with what the script needs to propose and to look up pictures.
create or replace function enrichment_items() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'brand', p.brand, 'category', p.category,
           'sub_type', p.sub_type, 'barcode', p.barcode, 'template', product_template(p.id), 'kind', product_kind(p.id),
           'has_usable_picture', exists (select 1 from product_images i where i.product_id = p.id and i.status in ('approved', 'proposed'))) order by p.sku), '[]'::jsonb)
    from products p where p.is_active and p.owner_source_id is null $$;

-- ---------- the report ----------
-- Which route fills a missing field, for one item. The order of preference: a page already on file, the supplier sheet, a label photo at
-- a shop shelf before stock arrives (an item with a barcode no page states), or the label photo at the first receiving.
create or replace function missing_field_route(p_product uuid, p_field text) returns text language plpgsql stable set search_path = public, pg_temp as $$
declare v_t text := product_template(p_product); p products%rowtype; f template_fields%rowtype;
begin
  select * into p from products where id = p_product;
  if p_field = 'name_ar' then return 'names_page'; end if;
  if p_field = 'price_usd' then return 'person_sets_the_price'; end if;
  if p_field = 'halal_certificate' then return 'supplier_sheet'; end if;
  select tf.* into f from template_fields tf where tf.key = p_field and (tf.template_code = v_t or tf.template_code = 'core') order by (tf.template_code = v_t) desc limit 1;
  if p_field in ('ingredients', 'nutrition') and exists (select 1 from product_facts x where x.product_id = p_product and x.attribute = p_field
      and x.source in ('open_food_facts', 'web_page') and x.approved_at is null and x.superseded_at is null) then return 'page_on_file'; end if;
  if p_field = 'allergens' and exists (select 1 from product_facts x join food_attributes a on a.code = x.attribute and a.kind = 'allergen'
      where x.product_id = p_product and x.source in ('open_food_facts', 'web_page') and x.approved_at is null and x.superseded_at is null) then
    return 'page_on_file_person_confirms_against_the_pack';
  end if;
  if v_t in ('fresh_produce', 'meat_poultry', 'bakery') or (f.key is not null and 'supplier_sheet' = any(f.allowed_sources) and not ('label_photo' = any(f.allowed_sources))) then
    return 'supplier_sheet';
  end if;
  if intake_barcode_key(p.barcode) is not null then return 'shelf_label_photo_before_stock'; end if;
  return 'label_photo_at_first_receiving';
end $$;

create or replace function enrichment_report() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with items as (
    select p.id, p.sku, p.name_en, p.name_ar, p.barcode, s, coalesce(cc.name_en, p.category) as aisle, cc.sort_order
      from products p cross join lateral (select product_template_status(p.id) as s) x
      left join catalog_placements pl on pl.sku = p.sku left join catalog_categories cc on cc.code = pl.category_code
     where p.is_active and p.owner_source_id is null),
  rows as (
    select i.*, (select coalesce(jsonb_object_agg(f, missing_field_route(i.id, f)), '{}'::jsonb)
                   from jsonb_array_elements_text((i.s->'missing_sellable') || (i.s->'missing_fact_complete')) f) as routes
      from items i)
  select jsonb_build_object(
    'summary', readiness_summary(),
    'routes', (select coalesce(jsonb_object_agg(route, n), '{}'::jsonb) from (select v as route, count(*) as n from rows, jsonb_each_text(rows.routes) e(k, v) group by v) r),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'name_en', name_en, 'template', s->>'template',
                'level', case when (s->>'fact_complete')::boolean then 'fact_complete' when (s->>'sellable')::boolean then 'sellable' else 'not_sellable' end,
                'missing', (s->'missing_sellable') || (s->'missing_fact_complete'), 'routes', routes, 'aisle', aisle) order by sku), '[]'::jsonb) from rows),
    'shelf_list', (select coalesce(jsonb_agg(jsonb_build_object('aisle', aisle, 'sku', sku, 'name_en', name_en, 'name_ar', name_ar, 'barcode', barcode,
                     'photograph', 'front and back (ingredients, allergens, nutrition panel, claims, warnings)') order by sort_order nulls last, aisle, name_en), '[]'::jsonb)
                    from rows where exists (select 1 from jsonb_each_text(rows.routes) e(k, v) where v = 'shelf_label_photo_before_stock')),
    'supplier_sheet', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'name_en', name_en, 'template', s->>'template',
                         'fields', (select jsonb_agg(k) from jsonb_each_text(rows.routes) e(k, v) where v = 'supplier_sheet')) order by sku), '[]'::jsonb)
                        from rows where exists (select 1 from jsonb_each_text(rows.routes) e(k, v) where v = 'supplier_sheet'))) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
