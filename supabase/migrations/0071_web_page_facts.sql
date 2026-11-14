-- 0071 (session P2): product facts read from public web pages, stored as PROPOSALS, and the record of what the research
-- loader has already loaded.
--
-- Sessions R1-R3 research each catalog item on the public web and write data/research/AK-nnnn.json (rules and shape in
-- data/research/README.md). The loader (scripts/product-data/load-research.mjs, run by .github/workflows/research-load.yml)
-- files what a file says as proposed rows in C1's `product_facts` (0021): source `web_page`, status `partial`, with the
-- page address and the market beside every value.
--
-- Rules, enforced here and not only in the script (CLAUDE.md invariant 15, "unknown is never safe"):
--   1. A row whose source is web_page is never approved, by code or by hand (a check constraint). A person confirms the
--      field against the pack at intake (5.15, review_proposed_fact), which records a NEW fact from the pack photo.
--   2. A web page never says "free" here. Allergen values are `contains` or `may_contain`; an allergen a page does not list
--      is unknown, not absent. Diet values are `yes` only (the pack's own claim or certificate), and never `fasting`.
--   3. Every proposal carries its page address (https), its market (null when the page does not say) and the source text.
--      An allergen or diet value also carries a quote that is a literal part of that source text.
--   4. A rerun never touches an approved fact and never re-proposes what is unchanged, even after a person set it aside.

-- The source list of 0021, plus web_page. The check was written inline there, so find it by what it says.
do $$ declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'product_facts'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%open_food_facts%' and pg_get_constraintdef(oid) like '%merchant%' loop
    execute format('alter table product_facts drop constraint %I', c.conname);
  end loop;
end $$;
alter table product_facts add constraint product_facts_source_check
  check (source in ('label', 'supplier', 'certificate', 'lab', 'calculation', 'merchant', 'open_food_facts', 'staff', 'web_page'));

alter table product_facts add constraint product_facts_web_page_never_approved
  check (source <> 'web_page' or (approved_at is null and status = 'partial'));

-- One current (unapproved, unsuperseded) web-page proposal per product and attribute.
create unique index if not exists product_facts_web_proposal_current
  on product_facts(product_id, attribute)
  where source = 'web_page' and approved_at is null and superseded_at is null;

-- Storage instructions and country of origin: printed text, like the ingredient list. They take kind `ingredients`, which is
-- the "text as printed" kind everywhere it is read (the shape trigger of 0021, the console's intake and food-facts pages):
-- the text lives in detail.text, the value is null, and it is never a restriction (product_meets_restrictions answers
-- not_a_restriction for it).
insert into food_attributes(code, kind, name_en, name_ar) values
  ('storage', 'ingredients', 'Storage instructions', 'طريقة الحفظ'),
  ('origin',  'ingredients', 'Country of origin', 'بلد المنشأ')
on conflict (code) do nothing;

-- What the loader did with each research file, per item and per part, keyed by the file's content (sha-256). A rerun skips
-- a part whose file is unchanged and already loaded to the end; an edited file is a new sha and is loaded again.
create table if not exists research_loads (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  part       text not null check (part in ('picture', 'facts')),
  file_sha   text not null check (file_sha ~ '^[0-9a-f]{64}$'),
  run_id     text not null,
  outcome    text not null check (outcome in ('proposed', 'none_passed', 'no_candidates', 'skipped_rejected',
                                              'nothing_new', 'nothing_usable', 'no_facts_in_file', 'unsure_match', 'error')),
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (product_id, part, file_sha)
);
create index if not exists research_loads_product on research_loads(product_id, part, created_at desc);

create or replace function record_research_load(p_product uuid, p_part text, p_file_sha text, p_run text, p_outcome text, p_detail jsonb default '{}')
returns void language sql as $$
  insert into research_loads(product_id, part, file_sha, run_id, outcome, detail)
    values (p_product, p_part, p_file_sha, p_run, p_outcome, coalesce(p_detail, '{}'))
  on conflict (product_id, part, file_sha) do update
    set run_id = excluded.run_id, outcome = excluded.outcome, detail = excluded.detail, created_at = now() $$;

-- What the loader needs to know before it opens a file: the catalog item as the vision check must see it, whether the item
-- already has a picture a customer may see (approved, or proposed and waiting for a person), and what was loaded before.
create or replace function research_load_state() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
           'sell_unit', p.sell_unit, 'barcode', nullif(btrim(p.barcode), ''),
           'has_usable_picture', exists (select 1 from product_images i where i.product_id = p.id and i.status in ('approved', 'proposed')
                                           and product_image_licence_usable(i.licence)),
           'loads', (select coalesce(jsonb_agg(jsonb_build_object('part', l.part, 'file_sha', l.file_sha, 'outcome', l.outcome)), '[]'::jsonb)
                       from research_loads l where l.product_id = p.id)) order by p.sku), '[]'::jsonb)
    from products p where p.is_active and p.owner_source_id is null $$;

-- Files what one research file says about one product, as proposals, in one transaction. p_facts is an array of
--   { attribute, value, detail }   detail: page_url, market, source_text, fingerprint (+ quote for an allergen or a diet value)
-- Every fact goes through C1's propose_product_fact (status partial, source web_page, no approver). Returns what was proposed
-- and what was skipped, by attribute. A fact that breaks a rule raises, and nothing for that product is saved.
create or replace function propose_web_facts(p_product uuid, p_run text, p_facts jsonb) returns jsonb language plpgsql as $$
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
    if jsonb_typeof(v_detail) <> 'object' then raise exception 'WEB_DETAIL_NOT_AN_OBJECT %', v_attr; end if;

    if v_kind = 'allergen' then
      if v_value = 'free' then raise exception 'WEB_NEVER_SAYS_FREE %: an allergen a page does not list is unknown, not absent', v_attr; end if;
      if v_value is distinct from 'contains' and v_value is distinct from 'may_contain' then raise exception 'WEB_ALLERGEN_VALUE % %', v_attr, v_value; end if;
    elsif v_kind = 'diet' then
      if v_attr = 'fasting' then raise exception 'WEB_NEVER_SAYS_FASTING'; end if;
      if v_value is distinct from 'yes' then raise exception 'WEB_DIET_VALUE % %: only the pack''s own claim, as yes', v_attr, v_value; end if;
    elsif v_value is not null then
      raise exception 'WEB_VALUE_NOT_ALLOWED %', v_attr;
    end if;

    -- The page address and the market beside every value, and the text the value was read from.
    if coalesce(v_detail ->> 'page_url', '') !~ '^https://[^[:space:]]+$' then raise exception 'WEB_NO_PAGE_ADDRESS %', v_attr; end if;
    if not (v_detail ? 'market') or jsonb_typeof(v_detail -> 'market') not in ('string', 'null') then raise exception 'WEB_NO_MARKET_FIELD %', v_attr; end if;
    if jsonb_typeof(v_detail -> 'source_text') is distinct from 'string' or btrim(v_detail ->> 'source_text') = '' then raise exception 'WEB_NO_SOURCE_TEXT %', v_attr; end if;
    v_fp := btrim(coalesce(v_detail ->> 'fingerprint', ''));
    if v_fp = '' then raise exception 'WEB_NO_FINGERPRINT %', v_attr; end if;
    v_text := v_detail ->> 'source_text';
    if v_kind in ('allergen', 'diet') then
      v_quote := btrim(coalesce(v_detail ->> 'quote', ''));
      if v_quote = '' or position(lower(v_quote) in lower(v_text)) = 0 then raise exception 'QUOTE_NOT_IN_SOURCE %', v_attr; end if;
    end if;

    -- A person already approved this attribute from the pack: not touched, not argued with.
    if exists (select 1 from product_facts where product_id = p_product and attribute = v_attr and approved_at is not null and superseded_at is null) then
      v_skipped := v_skipped || jsonb_build_object(v_attr, 'approved_exists'); continue;
    end if;
    -- Unchanged since the last web-page proposal (even one a person has since set aside): not proposed again.
    select detail ->> 'fingerprint' into v_last_fp from product_facts
     where product_id = p_product and attribute = v_attr and source = 'web_page' order by proposed_at desc, id desc limit 1;
    if v_last_fp = v_fp then v_skipped := v_skipped || jsonb_build_object(v_attr, 'unchanged'); continue; end if;

    -- A newer reading replaces the old web-page proposal, which is kept as history.
    select id into v_old from product_facts
     where product_id = p_product and attribute = v_attr and source = 'web_page' and approved_at is null and superseded_at is null for update;
    if v_old is not null then update product_facts set superseded_at = now() where id = v_old; end if;
    v_id := propose_product_fact(p_product, v_attr, v_value, 'partial', 'web_page', null, null,
                                 v_detail || jsonb_build_object('run_id', p_run, 'proposal_only', true));
    if v_old is not null then update product_facts set superseded_by = v_id where id = v_old; end if;
    v_proposed := v_proposed || jsonb_build_object(v_attr, v_id);
  end loop;
  return jsonb_build_object('proposed', v_proposed, 'skipped', v_skipped);
end $$;

-- The run report: how many items have a proposed picture and a proposed fact of each kind from a web page, and the items
-- with no picture a customer could be shown (approved, or proposed and waiting), each with the reason.
-- A product with no allergen proposal is UNKNOWN, not allergen-free. Only current proposals count.
create or replace function research_load_coverage() returns jsonb language sql stable as $$
  with prods as (
    select p.id, p.sku, p.name_en, p.brand from products p where p.is_active and p.owner_source_id is null
  ), cur as (
    select f.product_id, f.attribute, f.value, a.kind from product_facts f join food_attributes a on a.code = f.attribute
      join prods p on p.id = f.product_id
     where f.source = 'web_page' and f.approved_at is null and f.superseded_at is null
  ), img as (
    select p.id,
           exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence)) as approved,
           exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed' and product_image_licence_usable(i.licence)) as proposed,
           exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed' and i.licence = 'public_page') as proposed_public_page,
           exists (select 1 from product_images i where i.product_id = p.id and i.status = 'rejected') as rejected,
           (select l.outcome from research_loads l where l.product_id = p.id and l.part = 'picture' order by l.created_at desc, l.id desc limit 1) as last_load
      from prods p
  )
  select jsonb_build_object(
    'items', (select count(*) from prods),
    'research_files_loaded', (select count(distinct l.product_id) from research_loads l join prods p on p.id = l.product_id),
    'pictures', jsonb_build_object(
      'proposed', (select count(*) from img where proposed),
      'proposed_public_page', (select count(*) from img where proposed_public_page),
      'approved', (select count(*) from img where approved),
      'none', (select count(*) from img where not proposed and not approved)),
    'items_with_proposed', jsonb_build_object(
      'ingredients',          (select count(*) from cur where attribute = 'ingredients'),
      'allergen_any',         (select count(distinct product_id) from cur where kind = 'allergen'),
      'allergen_contains',    (select count(distinct product_id) from cur where kind = 'allergen' and value = 'contains'),
      'allergen_may_contain', (select count(distinct product_id) from cur where kind = 'allergen' and value = 'may_contain'),
      'nutrition',            (select count(*) from cur where attribute = 'nutrition'),
      'diet_any',             (select count(distinct product_id) from cur where kind = 'diet'),
      'halal',                (select count(*) from cur where attribute = 'halal'),
      'vegetarian',           (select count(*) from cur where attribute = 'vegetarian'),
      'vegan',                (select count(*) from cur where attribute = 'vegan'),
      'storage',              (select count(*) from cur where attribute = 'storage'),
      'origin',               (select count(*) from cur where attribute = 'origin'),
      'any_fact',             (select count(distinct product_id) from cur)),
    'fact_proposals', (select count(*) from cur),
    'approved_from_web_page', (select count(*) from product_facts where source = 'web_page' and approved_at is not null),
    'no_picture', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name_en', p.name_en, 'brand', p.brand,
                      'reason', case when i.rejected then 'rejected_by_a_person'
                                     when i.last_load is null then 'no_research_file_loaded'
                                     when i.last_load = 'no_candidates' then 'research_found_no_picture'
                                     when i.last_load = 'none_passed' then 'no_candidate_passed_the_check'
                                     when i.last_load = 'skipped_rejected' then 'rejected_by_a_person'
                                     else i.last_load end) order by p.sku), '[]'::jsonb)
                     from prods p join img i on i.id = p.id where not i.proposed and not i.approved)) $$;

-- D2's review queue (0049), with the web-page proposals counted on their own instead of as "from staff".
create or replace function food_fact_review_queue(p_limit int default 100) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'fields')::int desc, x->>'name_en'), '[]'::jsonb) from (
    select jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'sku', p.sku, 'barcode', p.barcode, 'fields', count(*),
             'from_open_food_facts', count(*) filter (where f.source = 'open_food_facts'),
             'from_web_page', count(*) filter (where f.source = 'web_page'),
             'from_label_reading', count(*) filter (where f.detail->>'read_by' = 'model'),
             'from_staff', count(*) filter (where f.source not in ('open_food_facts', 'web_page') and coalesce(f.detail->>'read_by', '') <> 'model')) as x
      from product_facts f join products p on p.id = f.product_id
     where f.approved_at is null and f.superseded_at is null
     group by p.id, p.name_en, p.sku, p.barcode
     limit p_limit) q $$;

-- New table: row level security on, no client grants. Functions: service role only (see 0021).
do $$ declare r text;
begin
  alter table research_loads enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table research_loads from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table research_loads to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
