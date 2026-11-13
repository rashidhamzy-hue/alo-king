-- 0073 (session N1, build plan 5.18): product data from Open Food Facts, stored as PROPOSALS.
-- A script (scripts/product-data/, run by .github/workflows/product-data.yml) reads Open Food Facts by barcode and files what
-- it says (ingredients, allergens, nutrition panel, diet labels) as proposed rows in C1's `product_facts` (0021), with the
-- source text beside every value. Nothing here is a fact a customer may hear: only an approved fact leaves the database
-- (product_food_facts, product_meets_restrictions), and an Open Food Facts row can never be approved, by code or by hand.
--
-- Rules, enforced here and not in the script (CLAUDE.md invariant 15, "unknown is never safe"):
--   1. A row whose source is open_food_facts is never approved (a check constraint; approve_product_fact already refused it).
--      A person confirms the field against the pack at intake (5.15) and records it as source `label`.
--   2. Open Food Facts never says "free". An allergen it does not list is unknown, not absent. Allergen values from this
--      path are `contains` or `may_contain`; diet values are `yes` or `no`.
--   3. Every proposal carries the source text it came from, and an allergen or diet value carries a quote that is a
--      literal part of that source text. A value a model "remembered" has no quote in the source and is refused.
--   4. A rerun never touches an approved fact, and never re-proposes what is unchanged.
--
-- Open Food Facts data is available under the Open Database Licence; the attribution travels in `detail`.

alter table product_facts add constraint product_facts_off_never_approved
  check (source <> 'open_food_facts' or approved_at is null);

-- One current (unapproved, unsuperseded) Open Food Facts proposal per product and attribute.
create unique index if not exists product_facts_off_proposal_current
  on product_facts(product_id, attribute)
  where source = 'open_food_facts' and approved_at is null and superseded_at is null;

-- What each run did for each item, so "no data" has a reason and a rerun can be compared with the first.
create table if not exists product_data_attempts (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  run_id     text not null,
  outcome    text not null check (outcome in ('proposed', 'found_nothing_usable', 'not_in_off', 'error')),
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (product_id, run_id)
);
create index if not exists product_data_attempts_product on product_data_attempts(product_id, created_at desc);

-- A barcode of 13 digits starting with 2 is a store's own code (GS1 prefixes 20-29: restricted circulation, used for
-- by-weight and in-store items). It is not a global product number, and the same number means a different item in another
-- shop, so it is never looked up.
create or replace function product_data_is_internal_code(p_code text) returns boolean language sql immutable as $$
  select p_code ~ '^2[0-9]{12}$' $$;

-- The items still to look up: a real product number, and no earlier run that finished with an answer (found it, or it is not there).
-- An error is not an answer: those are always tried again. p_force looks at everything again.
create or replace function product_data_to_fetch(p_limit int default null, p_force boolean default false) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(s.x order by s.sku), '[]'::jsonb)
    from (select c.sku,
                 jsonb_build_object('product_id', c.id, 'sku', c.sku, 'name_en', c.name_en, 'name_ar', c.name_ar, 'brand', c.brand,
                                    'sell_unit', c.sell_unit, 'barcode', c.code) as x
            from (select p.*, regexp_replace(coalesce(p.barcode, ''), '[^0-9]', '', 'g') as code
                    from products p where p.is_active and p.owner_source_id is null) c
           where length(c.code) >= 6 and not product_data_is_internal_code(c.code)
             and (p_force or not exists (select 1 from product_data_attempts a
                                          where a.product_id = c.id and a.outcome in ('proposed', 'found_nothing_usable', 'not_in_off')))
           order by c.sku
           limit p_limit) s $$;

-- The catalog as the names and categories proposals read it (5.18, for 1.21), with what Open Food Facts called the item when a lookup found it.
create or replace function product_data_catalog() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
           'category', p.category, 'sub_type', p.sub_type, 'sell_unit', p.sell_unit, 'barcode', nullif(btrim(p.barcode), ''),
           'off', (select a.detail -> 'off' from product_data_attempts a where a.product_id = p.id and a.detail ? 'off'
                    order by a.created_at desc limit 1)) order by p.sku), '[]'::jsonb)
    from products p where p.is_active and p.owner_source_id is null $$;

create or replace function record_product_data_attempt(p_product uuid, p_run text, p_outcome text, p_detail jsonb default '{}') returns void language sql as $$
  insert into product_data_attempts(product_id, run_id, outcome, detail) values (p_product, p_run, p_outcome, coalesce(p_detail, '{}'))
  on conflict (product_id, run_id) do update set outcome = excluded.outcome, detail = excluded.detail, created_at = now() $$;

-- Files what Open Food Facts says about one product, as proposals, in one transaction. p_facts is an array of
--   { attribute, value, detail }   detail: source_text, off_code, fingerprint (+ quote for an allergen or a diet value)
-- Every fact goes through C1's propose_product_fact (status partial, source open_food_facts, no approver). Returns what was
-- proposed and what was skipped, by attribute. A fact that breaks a rule raises, and nothing for that product is saved.
create or replace function propose_off_facts(p_product uuid, p_run text, p_facts jsonb) returns jsonb language plpgsql as $$
declare
  f jsonb; v_attr text; v_kind text; v_value text; v_detail jsonb; v_text text; v_quote text; v_fp text;
  v_last_fp text; v_old uuid; v_id uuid;
  v_proposed jsonb := '{}'; v_skipped jsonb := '{}';
begin
  if not exists (select 1 from products where id = p_product) then raise exception 'PRODUCT_NOT_FOUND %', p_product; end if;
  if jsonb_typeof(coalesce(p_facts, '[]'::jsonb)) <> 'array' then raise exception 'FACTS_NOT_AN_ARRAY'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) loop
    v_attr := f ->> 'attribute';
    select kind into v_kind from food_attributes where code = v_attr;
    if v_kind is null then raise exception 'FACT_ATTRIBUTE_UNKNOWN %', v_attr; end if;
    v_value := nullif(lower(btrim(f ->> 'value')), '');
    v_detail := coalesce(f -> 'detail', '{}'::jsonb);
    if jsonb_typeof(v_detail) <> 'object' then raise exception 'OFF_DETAIL_NOT_AN_OBJECT %', v_attr; end if;

    if v_kind = 'allergen' then
      if v_value = 'free' then raise exception 'OFF_NEVER_SAYS_FREE %: an allergen it does not list is unknown, not absent', v_attr; end if;
      if v_value is distinct from 'contains' and v_value is distinct from 'may_contain' then raise exception 'OFF_ALLERGEN_VALUE % %', v_attr, v_value; end if;
    elsif v_kind = 'diet' then
      if v_value is distinct from 'yes' and v_value is distinct from 'no' then raise exception 'OFF_DIET_VALUE % %', v_attr, v_value; end if;
    elsif v_value is not null then
      raise exception 'OFF_VALUE_NOT_ALLOWED %', v_attr;
    end if;

    -- The source text beside every value.
    if jsonb_typeof(v_detail -> 'source_text') is distinct from 'string' or btrim(v_detail ->> 'source_text') = '' then raise exception 'OFF_NO_SOURCE_TEXT %', v_attr; end if;
    if coalesce(btrim(v_detail ->> 'off_code'), '') = '' then raise exception 'OFF_NO_CODE %', v_attr; end if;
    v_fp := btrim(coalesce(v_detail ->> 'fingerprint', ''));
    if v_fp = '' then raise exception 'OFF_NO_FINGERPRINT %', v_attr; end if;
    v_text := v_detail ->> 'source_text';
    if v_kind in ('allergen', 'diet') then
      v_quote := btrim(coalesce(v_detail ->> 'quote', ''));
      if v_quote = '' or position(lower(v_quote) in lower(v_text)) = 0 then raise exception 'QUOTE_NOT_IN_SOURCE %', v_attr; end if;
    end if;

    -- A person already approved this attribute from the pack: not touched, not argued with.
    if exists (select 1 from product_facts where product_id = p_product and attribute = v_attr and approved_at is not null and superseded_at is null) then
      v_skipped := v_skipped || jsonb_build_object(v_attr, 'approved_exists'); continue;
    end if;
    -- Unchanged since the last proposal (even one a person has since set aside): not proposed again.
    select detail ->> 'fingerprint' into v_last_fp from product_facts
     where product_id = p_product and attribute = v_attr and source = 'open_food_facts' order by proposed_at desc, id desc limit 1;
    if v_last_fp = v_fp then v_skipped := v_skipped || jsonb_build_object(v_attr, 'unchanged'); continue; end if;

    -- A newer reading replaces the old proposal, which is kept as history.
    select id into v_old from product_facts
     where product_id = p_product and attribute = v_attr and source = 'open_food_facts' and approved_at is null and superseded_at is null for update;
    if v_old is not null then update product_facts set superseded_at = now() where id = v_old; end if;
    v_id := propose_product_fact(p_product, v_attr, v_value, 'partial', 'open_food_facts', null, null,
                                 v_detail || jsonb_build_object('run_id', p_run, 'proposal_only', true));
    if v_old is not null then update product_facts set superseded_by = v_id where id = v_old; end if;
    v_proposed := v_proposed || jsonb_build_object(v_attr, v_id);
  end loop;
  return jsonb_build_object('proposed', v_proposed, 'skipped', v_skipped);
end $$;

-- Counts for the run report: how many items have a proposed fact of each kind. A product with no allergen proposal is
-- UNKNOWN, not allergen-free. Only current proposals count (not approved, not superseded).
create or replace function product_data_coverage() returns jsonb language sql stable as $$
  with prods as (
    select p.id, regexp_replace(coalesce(p.barcode, ''), '[^0-9]', '', 'g') as code from products p where p.is_active and p.owner_source_id is null
  ), cur as (
    select f.product_id, f.attribute, f.value, f.detail, a.kind from product_facts f join food_attributes a on a.code = f.attribute
     where f.source = 'open_food_facts' and f.approved_at is null and f.superseded_at is null
  ), last_try as (
    select distinct on (product_id) product_id, outcome from product_data_attempts order by product_id, created_at desc, id desc
  )
  select jsonb_build_object(
    'products', (select count(*) from prods),
    'without_barcode', (select count(*) from prods where length(code) < 6),
    'internal_codes', (select count(*) from prods where length(code) >= 6 and product_data_is_internal_code(code)),
    'lookup_candidates', (select count(*) from prods where length(code) >= 6 and not product_data_is_internal_code(code)),
    'found_in_open_food_facts', (select count(*) from last_try where outcome in ('proposed', 'found_nothing_usable')),
    'not_in_open_food_facts', (select count(*) from last_try where outcome = 'not_in_off'),
    'errors', (select count(*) from last_try where outcome = 'error'),
    'not_yet_tried', (select count(*) from prods p where length(p.code) >= 6 and not product_data_is_internal_code(p.code)
                        and not exists (select 1 from last_try l where l.product_id = p.id)),
    'products_with_any_proposal', (select count(distinct product_id) from cur),
    'products_with', jsonb_build_object(
      'ingredients',           (select count(*) from cur where attribute = 'ingredients'),
      'ingredients_in_arabic', (select count(*) from cur where attribute = 'ingredients' and coalesce(detail ->> 'ar', '') <> ''),
      'nutrition',             (select count(*) from cur where attribute = 'nutrition'),
      'allergen_any',          (select count(distinct product_id) from cur where kind = 'allergen'),
      'allergen_contains',     (select count(distinct product_id) from cur where kind = 'allergen' and value = 'contains'),
      'allergen_may_contain',  (select count(distinct product_id) from cur where kind = 'allergen' and value = 'may_contain'),
      'diet_any',              (select count(distinct product_id) from cur where kind = 'diet'),
      'halal',                 (select count(*) from cur where attribute = 'halal'),
      'vegetarian',            (select count(*) from cur where attribute = 'vegetarian'),
      'vegan',                 (select count(*) from cur where attribute = 'vegan')),
    'proposals', (select count(*) from cur),
    'approved_from_open_food_facts', (select count(*) from product_facts where source = 'open_food_facts' and approved_at is not null)) $$;

-- New table: row level security on, no client grants. Functions: service role only (see 0021).
do $$ declare r text;
begin
  alter table product_data_attempts enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table product_data_attempts from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
