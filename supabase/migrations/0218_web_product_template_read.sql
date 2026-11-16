-- Alo King Chouf, session LD1 (website product data): the one read that feeds the product page AND its JSON-LD.
-- docs/PRODUCT_DATA_STANDARD.md ("The product data standard", "Structured data on the website"); docs/WEBSITE.md.
--
-- web_catalog_product (0154) knew nothing of templates: it listed the 14 allergens, the diets and a nutrition panel for every item,
-- so a cleaning, beauty, baby-care or pet item read "allergens: not verified". It is replaced here, same name, same signature, same
-- grant (create or replace keeps it), and everything it returned before is still there. What it adds:
--
--   product.gtin       the barcode only when it is a real GTIN (web_real_gtin): the check digit holds and it is not in the number
--                      ranges GS1 keeps for a store's own use and weighed goods (02, 04, 05, 20 to 29, 98, 99). Never the store's code.
--   product.size       the approved "size" value of the core, or null
--   product.name_fr    the approved French name, or null (the page falls back to the English name as before)
--   product.brand      null when the seed's placeholder "Local (unbranded)" is all there is: no invented brand in the page or its data
--   template           the item's own template, whether it is food, its level (not_sellable, sellable, fact_complete), and the food
--                      groups that template has (ingredients, allergens, diet, nutrition): a template without them shows none
--   facts              as before (an approved, current, checked fact; anything else verified = false, no value), but only the groups
--                      the template has, and the nutrition panel is no longer in it (it comes once, as `nutrition`)
--   nutrition          the typed per-100 g numbers of product_nutrition (0204), only for a fact-complete item of a template with a
--                      nutrition field; otherwise null
--   claims             the approved, unexpired printed claims with the printed words, only for a fact-complete item of a template with
--                      a claims field; otherwise []
--   fields             the item's own template fields kept as values (0203): every one required for a level, plus an optional one only
--                      once approved. Each: verified, the value, its source, when it was checked. An unapproved one has no value.
--   certificates       approved certificates of this item (kind and date only; never the issuer or the reference)
--
-- Nothing about who proposed or approved anything leaves, and no evidence. No price, stock or fee is computed here: price and stock are
-- the same reads as before (invariant 7). The helper below is not granted to web_channel; the read runs as its owner.

-- A barcode as a GTIN, or null. Digits only (spaces are ignored), 8, 12, 13 or 14 long, a correct check digit, and not a number a
-- store prints for its own use: those prefixes mean "this code means something only inside one shop" (weighed goods, internal codes,
-- coupons). A 14-digit code is judged by the 13 digits after its indicator digit; an 8-digit code starting with 2 is restricted too.
create or replace function web_real_gtin(p_code text) returns text language sql immutable set search_path = public, pg_temp as $$
  with c as (select regexp_replace(coalesce(p_code, ''), '\s', '', 'g') as d)
  select case when d ~ '^[0-9]+$' and length(d) in (8, 12, 13, 14)
               and mod(10 - mod(coalesce((select sum(substr(d, length(d) - i, 1)::int * case when mod(i, 2) = 1 then 3 else 1 end)
                                            from generate_series(1, length(d) - 1) i), 0), 10), 10) = right(d, 1)::int
               and not (length(d) = 8 and left(d, 1) = '2')
               and left(substr(lpad(d, 14, '0'), 2), 2) not in ('02', '04', '05', '98', '99')
               and not (left(substr(lpad(d, 14, '0'), 2), 2) between '20' and '29')
              then d end
    from c $$;

create or replace function web_catalog_product(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare w record; v_pic jsonb; v_facts jsonb; v_cat catalog_categories%rowtype; v_st jsonb; v_t product_templates%rowtype;
        v_groups text[] := '{}'; v_fc boolean; v_nutrition jsonb; v_claims jsonb := '[]'::jsonb; v_fields jsonb; v_certs jsonb := '[]'::jsonb;
        v_size text; v_name_fr text; v_barcode text; v_has_claims boolean; v_has_certs boolean; v_level text;
begin
  select * into w from catalog_web_items() i where i.sku = btrim(coalesce(p_sku, ''));
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_product'); end if;
  select * into v_cat from catalog_categories where code = w.category_code;
  v_pic := catalog_web_picture(w.product_id);
  v_st := product_template_status(w.product_id);
  select * into v_t from product_templates where code = v_st->>'template';
  v_fc := coalesce((v_st->>'fact_complete')::boolean, false);
  v_level := case when v_fc then 'fact_complete' when coalesce((v_st->>'sellable')::boolean, false) then 'sellable' else 'not_sellable' end;
  select barcode into v_barcode from products where id = w.product_id;

  -- The food groups this template has. A template with none (produce, water, cleaning, beauty, baby care, pet) shows none.
  select coalesce(array_agg(g order by n), '{}') into v_groups from (values
      (1, 'ingredients', 'ingredients'), (2, 'allergens', 'allergens'), (3, 'diet', 'allergens'), (4, 'nutrition', 'nutrition')) x(n, g, k)
   where exists (select 1 from template_fields f where f.template_code = v_t.code and f.store = 'facts' and f.key = x.k);
  v_has_claims := exists (select 1 from template_fields f where f.store = 'claims' and (f.template_code = v_t.code or (f.template_code = 'core' and v_t.includes_core)));
  v_has_certs := exists (select 1 from template_fields f where f.store = 'certificates' and f.template_code = v_t.code);

  -- One row per attribute of those groups. A value leaves only for a current approved fact, not expired, whose status says it was
  -- checked. The detail keys are the printed text; nothing about the evidence or the reviewer.
  select coalesce(jsonb_agg(jsonb_build_object(
           'attribute', a.code, 'kind', a.kind, 'name_en', a.name_en, 'name_ar', a.name_ar,
           'verified', ok.ok,
           'value', case when ok.ok then f.value end,
           'detail', case when ok.ok then (select coalesce(jsonb_object_agg(k, f.detail->k), '{}'::jsonb)
                                             from unnest(array['text', 'values', 'per', 'units', 'ar', 'lang']) k where f.detail ? k) end,
           'status', case when ok.ok then f.status::text else 'not_verified' end,
           'source', case when ok.ok then f.source end,
           'reviewed_at', case when ok.ok then f.reviewed_at end)
         order by a.kind, a.code), '[]'::jsonb)
    into v_facts
    from food_attributes a
    left join product_facts f on f.product_id = w.product_id and f.attribute = a.code and f.approved_at is not null and f.superseded_at is null
    cross join lateral (select f.id is not null and f.source <> 'web_page' and f.status in ('certified', 'declared', 'calculated')
                               and (f.expires_at is null or f.expires_at > now()) as ok) ok
   where (a.kind = 'allergen' and 'allergens' = any(v_groups)) or (a.kind = 'diet' and 'diet' = any(v_groups))
      or (a.code = 'ingredients' and 'ingredients' = any(v_groups));

  -- The numbers and the printed claims leave only for a fact-complete item: one rule for the page and for the structured data.
  if v_fc and 'nutrition' = any(v_groups) then v_nutrition := product_nutrition(w.product_id) - 'approved_at'; end if;
  if v_fc and v_has_claims then
    select coalesce(jsonb_agg(jsonb_build_object('claim', c.claim_code, 'name_en', cc.name_en, 'name_ar', cc.name_ar, 'value', c.value, 'quote', c.quote,
                                                 'source', c.source, 'reviewed_at', c.reviewed_at) order by c.claim_code), '[]'::jsonb)
      into v_claims
      from product_claims c join claim_codes cc on cc.code = c.claim_code
     where c.product_id = w.product_id and c.status = 'approved' and (c.expires_at is null or c.expires_at > now());
  end if;
  if v_has_certs then
    select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'valid_until', c.valid_until) order by c.kind), '[]'::jsonb) into v_certs
      from product_certificates c
     where c.product_id = w.product_id and c.status = 'approved' and (c.valid_until is null or c.valid_until >= current_date);
  end if;

  -- The core's size and French name, then the template's own fields kept as values.
  select v.value #>> '{}' into v_size from product_field_values v where v.product_id = w.product_id and v.field_key = 'size' and v.status = 'approved'
     and (v.expires_at is null or v.expires_at > now()) limit 1;
  select v.value #>> '{}' into v_name_fr from product_field_values v where v.product_id = w.product_id and v.field_key = 'name_fr' and v.status = 'approved'
     and (v.expires_at is null or v.expires_at > now()) limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'group', f.field_group, 'type', f.type, 'unit', f.unit,
           'verified', v.id is not null, 'value', v.value, 'source', v.source, 'reviewed_at', coalesce(v.reviewed_at, v.approved_at))
         order by (f.required_for is null), f.field_group, f.key), '[]'::jsonb)
    into v_fields
    from (select distinct on (tf.key) tf.* from template_fields tf
           where tf.store = 'values'
             and (tf.template_code = v_t.code or (tf.template_code = 'core' and v_t.includes_core and tf.key in ('pack_count', 'variant', 'origin')))
           order by tf.key, (tf.template_code = v_t.code) desc) f
    left join lateral (select x.* from product_field_values x where x.product_id = w.product_id and x.field_key = f.key and x.status = 'approved'
                          and (x.expires_at is null or x.expires_at > now()) limit 1) v on true
   where f.required_for is not null or v.id is not null;

  return jsonb_build_object('ok', true,
    'product', jsonb_build_object('sku', w.sku, 'name_en', w.name_en, 'name_ar', w.name_ar, 'name_fr', v_name_fr,
                                  'brand', case when w.brand ~* 'unbranded' then null else w.brand end, 'sell_unit', w.sell_unit,
                                  'price_usd', w.price_usd, 'in_stock', w.in_stock, 'gtin', web_real_gtin(v_barcode), 'size', v_size),
    'category', jsonb_build_object('code', v_cat.code, 'name_en', v_cat.name_en, 'name_ar', v_cat.name_ar),
    'template', jsonb_build_object('code', v_t.code, 'name_en', v_t.name_en, 'name_ar', v_t.name_ar, 'is_food', coalesce(v_t.is_food, false),
                                   'level', v_level, 'groups', to_jsonb(v_groups)),
    'picture', v_pic,
    'facts', v_facts,
    'nutrition', v_nutrition,
    'claims', v_claims,
    'fields', v_fields,
    'certificates', v_certs,
    -- Open Food Facts must be credited next to anything that came from it: a fact, a number, a claim, a value or a picture shown.
    'credit_open_food_facts', coalesce(v_pic->>'source_kind' = 'open_food_facts', false)
        or exists (select 1 from jsonb_array_elements(v_facts) x where (x->>'verified')::boolean and x->>'source' = 'open_food_facts')
        or exists (select 1 from jsonb_array_elements(v_fields) x where (x->>'verified')::boolean and x->>'source' = 'open_food_facts')
        or exists (select 1 from jsonb_array_elements(v_claims) x where x->>'source' = 'open_food_facts')
        or coalesce(v_nutrition->>'source' = 'open_food_facts', false),
    'whatsapp', setting('catalog')->>'product_link');
end $$;

select pin_search_paths();

-- The helper is not for the website's role; the read runs as its owner (the rule of 0132 and 0155).
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'web_channel') then grant execute on function web_catalog_product(text) to web_channel; end if;
end $$;
