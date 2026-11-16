-- Alo King Chouf, session SR1, part 2 of 5: filters by approved facts only (invariants 15 and 16).
--
--   settings.search.thresholds  what "no sugar", "low fat", "high protein" mean in numbers per 100 g or 100 ml, when the pack prints no claim:
--                        the definitions of the nutrition claims (EU regulation 1924/2006, annex). Data, never code.
--   product_field_value() an item's approved, current value of a template field (scent, age range, species, life stage ...).
--   product_passes_filters(product, filters)  pass or not, the reason, and the evidence: each approved record that made it pass, with its
--                        source, so the chat states it with its source ("the pack says no added sugar"). Rules:
--     * a filter that asks a fact passes only on a fact-complete item (PD1's level, 0206); unknown never passes;
--     * a food filter (sugar, protein, fat, salt, a nutrient, an allergen, a diet) never passes on a non-food item;
--     * allergens and diets go through product_meets_restrictions (0206): a stated allergy is a restriction, never a preference;
--     * a printed claim passes only when it is approved and current; a number only when the approved panel prints it;
--     * a filter key this function does not know fails (closed), so a misspelt filter never lets everything through;
--     * an audience ("kids") is a hard filter only for a template that has an age field (beauty, baby and child, baby food); on any other item
--       it is a shopping preference that ranks (find_products), never a fact.
--   Filters, as find_products takes them (the reading step returns the same shape, packages/agents/src/search-reading.ts):
--     {"sugar": "none"|"low", "protein": "high", "fat": "low"|"none", "salt": "low"|"none",
--      "nutrients": [{"key": "sugars_g", "max": 5}], "claims": ["lactose_free"], "free_of": ["peanuts"], "diet": ["vegan"],
--      "species": "dog", "life_stage": ["baby", "young"], "age_months": 24, "audience": "kids",
--      "tags": ["lunchbox"] (hard, shopping tags), "prefer_tags": ["kids"] (ranks only), "max_price_usd": 3}
--   kind_families, family_words  "snacks" or "drinks" said for a whole family of kinds (chips, nuts, rice cakes ...): data, as kind_words (0202).
--   product_search_forms  the folded words of each search document, kept beside it for the word search (a trigger keeps them current).

update settings set value = value || jsonb_build_object('thresholds', jsonb_build_object(
    'sugar_none_g', 0.5, 'sugar_low_g', 5, 'fat_none_g', 0.5, 'fat_low_g', 3, 'salt_none_g', 0.0125, 'salt_low_g', 0.3,
    'protein_high_energy_share', 0.2, 'kids_months', jsonb_build_array(12, 144)))
 where key = 'search' and not (value ? 'thresholds');

-- ---------- an item's approved template field ----------
create or replace function product_field_value(p_product uuid, p_key text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select v.value from product_field_values v
   where v.product_id = p_product and v.field_key = p_key and v.status = 'approved' and (v.expires_at is null or v.expires_at > now())
   order by v.approved_at desc nulls last limit 1 $$;

-- A range as printed ("12-36", "0-3", {"min": 12, "max": 36}), in its own unit; null when it cannot be read.
create or replace function range_of(p jsonb) returns numeric[] language sql immutable set search_path = public, pg_temp as $$
  select case
    when jsonb_typeof(p) = 'object' and json_num(p->'min') is not null and json_num(p->'max') is not null then array[json_num(p->'min'), json_num(p->'max')]
    when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*-\s*[0-9]+(\.[0-9]+)?\s*$' then
      array[(regexp_match(p #>> '{}', '^\s*([0-9.]+)'))[1]::numeric, (regexp_match(p #>> '{}', '-\s*([0-9.]+)\s*$'))[1]::numeric]
  end $$;

-- ---------- does an item pass the filters ----------
create or replace function filters_ask_facts(p_filters jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select exists (select 1 from jsonb_each(coalesce(p_filters, '{}'::jsonb)) e
                  where e.key not in ('tags', 'prefer_tags', 'max_price_usd', 'sort')
                    and e.value not in ('null'::jsonb, '[]'::jsonb, '""'::jsonb)) $$;

create or replace function product_passes_filters(p_product uuid, p_filters jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); st jsonb; v_food boolean; v_t text; n jsonb; th jsonb; ev jsonb := '[]'::jsonb;
        k text; x jsonb; v numeric; c record; r jsonb; v_restr text[]; rg numeric[]; v_age numeric; v_kids numeric[];
        known text[] := array['sugar', 'protein', 'fat', 'salt', 'nutrients', 'claims', 'free_of', 'diet', 'species', 'life_stage', 'age_months',
                              'audience', 'tags', 'prefer_tags', 'max_price_usd', 'sort'];
begin
  for k in select jsonb_object_keys(f) loop
    if not k = any(known) then return jsonb_build_object('pass', false, 'reason', 'unknown_filter:' || k); end if;
  end loop;
  -- shopping filters first (not facts): hard tags and a price ceiling
  if jsonb_array_length(coalesce(f->'tags', '[]'::jsonb)) > 0 and exists (
       select 1 from jsonb_array_elements_text(f->'tags') t where not exists (
         select 1 from product_tags pt where pt.product_id = p_product and pt.tag_code = t and pt.approved)) then
    return jsonb_build_object('pass', false, 'reason', 'tag');
  end if;
  if json_num(f->'max_price_usd') is not null
     and (select min(o.price_usd) from offers o join sources s on s.id = o.source_id and s.kind = 'dark_store' where o.product_id = p_product) > json_num(f->'max_price_usd') then
    return jsonb_build_object('pass', false, 'reason', 'price');
  end if;
  if not filters_ask_facts(f) then return jsonb_build_object('pass', true, 'evidence', ev); end if;

  st := product_template_status(p_product);
  v_t := st->>'template'; v_food := coalesce((st->>'is_food')::boolean, false);
  -- an audience alone on a food item is a preference, not a fact
  if v_food and not filters_ask_facts(f - 'audience') then return jsonb_build_object('pass', true, 'evidence', ev); end if;
  if not coalesce((st->>'fact_complete')::boolean, false) then return jsonb_build_object('pass', false, 'reason', 'not_fact_complete'); end if;
  if not v_food and (f ? 'sugar' or f ? 'protein' or f ? 'fat' or f ? 'salt' or jsonb_array_length(coalesce(f->'nutrients', '[]')) > 0
                     or jsonb_array_length(coalesce(f->'free_of', '[]')) > 0 or jsonb_array_length(coalesce(f->'diet', '[]')) > 0) then
    return jsonb_build_object('pass', false, 'reason', 'not_food');
  end if;
  th := coalesce(setting('search')->'thresholds', '{}'::jsonb);
  n := product_nutrition(p_product);

  -- the printed claim if there is one, else the number on the approved panel
  for k, x in select key, value from jsonb_each(f) where key in ('sugar', 'fat', 'salt', 'protein') and value <> 'null'::jsonb loop
    select cl.claim_code, cl.quote, cl.source into c from product_claims cl
     where cl.product_id = p_product and cl.status = 'approved' and (cl.expires_at is null or cl.expires_at > now())
       and cl.claim_code = any(case k || ':' || (x #>> '{}')
             when 'sugar:none' then array['sugar_free', 'no_added_sugar'] when 'sugar:low' then array['sugar_free', 'no_added_sugar', 'low_sugar']
             when 'fat:none' then array['fat_free'] when 'fat:low' then array['fat_free', 'low_fat']
             when 'salt:none' then array['unsalted'] when 'salt:low' then array['unsalted', 'low_salt']
             when 'protein:high' then array['high_protein'] else array[]::text[] end)
     order by cl.claim_code limit 1;
    if found then
      ev := ev || jsonb_build_object('kind', 'claim', 'code', c.claim_code, 'quote', c.quote, 'source', c.source);
      continue;
    end if;
    if k = 'protein' then
      if (x #>> '{}') = 'high' and json_num(n->'protein_g') is not null and coalesce(json_num(n->'energy_kcal'), 0) > 0
         and json_num(n->'protein_g') * 4 / json_num(n->'energy_kcal') >= coalesce(json_num(th->'protein_high_energy_share'), 0.2) then
        ev := ev || jsonb_build_object('kind', 'nutrition', 'key', 'protein_g', 'value', json_num(n->'protein_g'), 'per', n->>'per', 'source', n->>'source');
        continue;
      end if;
      return jsonb_build_object('pass', false, 'reason', 'protein');
    end if;
    v := json_num(n->(case k when 'sugar' then 'sugars_g' when 'fat' then 'fat_g' else 'salt_g' end));
    if v is not null and v <= json_num(th->(k || '_' || (x #>> '{}') || '_g')) then
      ev := ev || jsonb_build_object('kind', 'nutrition', 'key', case k when 'sugar' then 'sugars_g' when 'fat' then 'fat_g' else 'salt_g' end,
                                     'value', v, 'per', n->>'per', 'source', n->>'source');
    else
      return jsonb_build_object('pass', false, 'reason', k);
    end if;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(f->'nutrients', '[]'::jsonb)) loop
    v := json_num(n->(x->>'key'));
    if v is null or (json_num(x->'max') is not null and v > json_num(x->'max')) or (json_num(x->'min') is not null and v < json_num(x->'min')) then
      return jsonb_build_object('pass', false, 'reason', coalesce(x->>'key', 'nutrient'));
    end if;
    ev := ev || jsonb_build_object('kind', 'nutrition', 'key', x->>'key', 'value', v, 'per', n->>'per', 'source', n->>'source');
  end loop;

  for k in select jsonb_array_elements_text(coalesce(f->'claims', '[]'::jsonb)) loop
    select cl.claim_code, cl.quote, cl.source into c from product_claims cl
     where cl.product_id = p_product and cl.claim_code = k and cl.status = 'approved' and (cl.expires_at is null or cl.expires_at > now()) limit 1;
    if not found then return jsonb_build_object('pass', false, 'reason', 'claim:' || k); end if;
    ev := ev || jsonb_build_object('kind', 'claim', 'code', c.claim_code, 'quote', c.quote, 'source', c.source);
  end loop;

  -- a stated allergy or diet: the restriction check of 0206 (fact-complete items only can pass; "contains" and "may contain" fail)
  v_restr := array(select jsonb_array_elements_text(coalesce(f->'free_of', '[]'::jsonb)) union select jsonb_array_elements_text(coalesce(f->'diet', '[]'::jsonb)));
  if cardinality(v_restr) > 0 then
    r := product_meets_restrictions(p_product, v_restr);
    if not coalesce((r->>'meets')::boolean, false) then
      return jsonb_build_object('pass', false, 'reason', 'restriction', 'checks', r->'checks');
    end if;
    ev := ev || coalesce((select jsonb_agg(jsonb_build_object('kind', case when e->>'kind' = 'diet' then 'diet' else 'allergen' end,
                                                              'code', e->>'restriction', 'value', case when e->>'kind' = 'diet' then 'yes' else 'free' end,
                                                              'source', coalesce(e->>'source', 'label')))
                            from jsonb_array_elements(r->'checks') e), '[]'::jsonb);
  end if;

  -- the template's own fields
  if f ? 'species' and f->>'species' is not null then
    if coalesce(product_field_value(p_product, 'species') #>> '{}', '') <> f->>'species' then return jsonb_build_object('pass', false, 'reason', 'species'); end if;
    ev := ev || jsonb_build_object('kind', 'field', 'key', 'species', 'value', f->>'species', 'source', 'label');
  end if;
  if jsonb_array_length(coalesce(f->'life_stage', '[]'::jsonb)) > 0 then
    if not coalesce(product_field_value(p_product, 'life_stage') #>> '{}', '') in (select jsonb_array_elements_text(f->'life_stage')) then
      return jsonb_build_object('pass', false, 'reason', 'life_stage');
    end if;
    ev := ev || jsonb_build_object('kind', 'field', 'key', 'life_stage', 'value', product_field_value(p_product, 'life_stage'), 'source', 'label');
  end if;
  if json_num(f->'age_months') is not null then
    v_age := json_num(f->'age_months'); rg := range_of(product_field_value(p_product, 'age_range'));
    if rg is null or v_age < rg[1] or v_age > rg[2] then return jsonb_build_object('pass', false, 'reason', 'age'); end if;
    ev := ev || jsonb_build_object('kind', 'field', 'key', 'age_range', 'value', product_field_value(p_product, 'age_range'), 'source', 'label');
  end if;
  if f->>'audience' is not null and not v_food then
    v_kids := array[coalesce(json_num(th->'kids_months'->0), 12), coalesce(json_num(th->'kids_months'->1), 144)];
    rg := range_of(product_field_value(p_product, 'age_range'));
    if f->>'audience' = 'kids' and not (case when rg is not null then rg[1] <= v_kids[2] and rg[2] >= v_kids[1]
                                             else coalesce(product_field_value(p_product, 'age_group') #>> '{}', '') in ('kids', 'baby', 'all') end) then
      return jsonb_build_object('pass', false, 'reason', 'audience');
    elsif f->>'audience' = 'baby' and not (case when rg is not null then rg[1] < 12 else coalesce(product_field_value(p_product, 'age_group') #>> '{}', '') in ('baby', 'all') end) then
      return jsonb_build_object('pass', false, 'reason', 'audience');
    elsif f->>'audience' = 'adult' and coalesce(product_field_value(p_product, 'age_group') #>> '{}', '') not in ('adult', 'all') then
      return jsonb_build_object('pass', false, 'reason', 'audience');
    end if;
    ev := ev || jsonb_build_object('kind', 'field', 'key', case when rg is not null then 'age_range' else 'age_group' end,
                                   'value', coalesce(product_field_value(p_product, 'age_range'), product_field_value(p_product, 'age_group')), 'source', 'label');
  end if;
  return jsonb_build_object('pass', true, 'evidence', ev);
end $$;

-- ---------- families of kinds, said as one word ----------
create table if not exists kind_families (
  family text not null,
  kind   text not null,
  primary key (family, kind)
);
create table if not exists family_words (
  word_folded text primary key,                 -- catalog_tokens(word), one token
  word        text not null,
  lang        text not null check (lang in ('ar', 'arabizi', 'en', 'fr')),
  family      text not null
);
insert into kind_families(family, kind) values
  ('snack', 'chips'), ('snack', 'nuts'), ('snack', 'wafer'), ('snack', 'biscuits'), ('snack', 'chocolate bar'), ('snack', 'rice cake'),
  ('snack', 'crackers'), ('snack', 'protein bar'), ('snack', 'cereal bar'), ('snack', 'popcorn'), ('snack', 'candy'),
  ('drink', 'cola'), ('drink', 'juice'), ('drink', 'iced tea'), ('drink', 'soft drink'), ('drink', 'energy drink'), ('drink', 'sparkling water'),
  ('cleaning', 'dish soap'), ('cleaning', 'bleach'), ('cleaning', 'floor cleaner'), ('cleaning', 'sponge'), ('cleaning', 'laundry detergent'),
  ('cleaning', 'fabric softener'), ('cleaning', 'toilet cleaner')
on conflict do nothing;
insert into family_words(word_folded, word, lang, family)
select (catalog_tokens(w))[1], w, l, f from (values
  ('snack', 'en', 'snack'), ('snacks', 'en', 'snack'), ('سناك', 'ar', 'snack'), ('سناكس', 'ar', 'snack'), ('سناكات', 'ar', 'snack'),
  ('تسالي', 'ar', 'snack'), ('تسلاية', 'ar', 'snack'), ('snaks', 'arabizi', 'snack'), ('sneks', 'arabizi', 'snack'), ('tasali', 'arabizi', 'snack'),
  ('grignotage', 'fr', 'snack'), ('grignotages', 'fr', 'snack'), ('goûter', 'fr', 'snack'), ('goûters', 'fr', 'snack'), ('encas', 'fr', 'snack'),
  ('drink', 'en', 'drink'), ('drinks', 'en', 'drink'), ('beverages', 'en', 'drink'), ('مشروب', 'ar', 'drink'), ('مشروبات', 'ar', 'drink'),
  ('mashroubat', 'arabizi', 'drink'), ('mashrou3at', 'arabizi', 'drink'), ('boisson', 'fr', 'drink'), ('boissons', 'fr', 'drink'),
  ('cleaning', 'en', 'cleaning'), ('تنظيف', 'ar', 'cleaning'), ('tanzif', 'arabizi', 'cleaning'), ('ménage', 'fr', 'cleaning'), ('nettoyage', 'fr', 'cleaning')
) v(w, l, f)
on conflict (word_folded) do nothing;

-- ---------- the folded words of each search document ----------
create table if not exists product_search_forms (
  product_id uuid primary key references products(id) on delete cascade,
  digest     text not null,
  forms      text[] not null
);
create index if not exists product_search_forms_gin on product_search_forms using gin (forms);
create or replace function product_search_forms_fill() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  insert into product_search_forms(product_id, digest, forms) values (new.product_id, new.digest, catalog_term_forms(new.document))
    on conflict (product_id) do update set digest = excluded.digest, forms = excluded.forms;
  return new;
end $$;
drop trigger if exists product_search_forms_fill on product_search_documents;
create trigger product_search_forms_fill after insert or update of document on product_search_documents
  for each row execute function product_search_forms_fill();
insert into product_search_forms(product_id, digest, forms)
  select product_id, digest, catalog_term_forms(document) from product_search_documents on conflict (product_id) do nothing;

do $$ declare t text; r text; f text;
begin
  foreach t in array array['kind_families', 'family_words', 'product_search_forms'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  foreach f in array array['product_field_value(uuid,text)', 'range_of(jsonb)', 'filters_ask_facts(jsonb)', 'product_passes_filters(uuid,jsonb)',
                           'product_search_forms_fill()'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
