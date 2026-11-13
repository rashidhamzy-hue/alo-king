-- Alo King Chouf, session C1, build plan 1.11: food facts.
-- Allergen, diet, ingredient and nutrition statements come only from approved records, always with their status
-- (CLAUDE.md invariants 14-16). This migration is the store for those records and the one function that answers
-- "does this product meet these restrictions". Unknown is never safe: no record, an unapproved record, an expired record,
-- a record whose status is partial or unknown, and a restriction we do not recognise all fail the check.
-- Nothing here reads a product name, a category, a brand or a paid placement: only approved facts decide.

create type fact_status as enum ('certified', 'declared', 'calculated', 'partial', 'unknown');

-- The vocabulary. What can be stated about a product, and how its value is read.
--   allergen: value 'free' | 'may_contain' | 'contains'. A restriction on it means "free of it"; may_contain fails.
--   diet:     value 'yes' | 'no'. A restriction on it means "yes".
--   ingredients, nutrition: shown with their status, never used as a restriction. The text or panel lives in `detail`.
create table food_attributes (
  code    text primary key,
  kind    text not null check (kind in ('allergen', 'diet', 'ingredients', 'nutrition')),
  name_en text not null,
  name_ar text
);
insert into food_attributes(code, kind, name_en, name_ar) values
  ('gluten',      'allergen', 'Cereals containing gluten', 'غلوتين'),
  ('crustaceans', 'allergen', 'Crustaceans', 'قشريات'),
  ('eggs',        'allergen', 'Eggs', 'بيض'),
  ('fish',        'allergen', 'Fish', 'سمك'),
  ('peanuts',     'allergen', 'Peanuts', 'فول سوداني'),
  ('soy',         'allergen', 'Soy', 'صويا'),
  ('milk',        'allergen', 'Milk', 'حليب'),
  ('tree_nuts',   'allergen', 'Tree nuts', 'مكسرات'),
  ('celery',      'allergen', 'Celery', 'كرفس'),
  ('mustard',     'allergen', 'Mustard', 'خردل'),
  ('sesame',      'allergen', 'Sesame', 'سمسم'),
  ('sulphites',   'allergen', 'Sulphites', 'كبريتيت'),
  ('lupin',       'allergen', 'Lupin', 'ترمس'),
  ('molluscs',    'allergen', 'Molluscs', 'رخويات'),
  ('halal',       'diet', 'Halal', 'حلال'),
  ('vegetarian',  'diet', 'Vegetarian', 'نباتي'),
  ('vegan',       'diet', 'Vegan', 'نباتي صرف'),
  ('fasting',     'diet', 'Fasting (siyami)', 'صيامي'),
  ('ingredients', 'ingredients', 'Ingredients', 'المكوّنات'),
  ('nutrition',   'nutrition', 'Nutrition per 100 g', 'القيم الغذائية لكل ١٠٠ غ');

-- What a fact rests on. Photos and scans go in the private `media` bucket (path only, never a public link).
create table evidence_documents (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('label_photo', 'supplier_spec', 'certificate', 'lab_report', 'manufacturer', 'calculation', 'other')),
  product_id  uuid references products(id),        -- null when one document covers many products (a supplier's halal certificate)
  media_path  text,
  url         text,
  issuer      text,
  reference   text,
  issued_on   date,
  valid_until date,
  note        text,
  uploaded_by uuid references parties(id),
  created_at  timestamptz not null default now(),
  check (media_path is not null or url is not null or reference is not null)
);

create table product_facts (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  attribute     text not null references food_attributes(code),
  value         text,
  detail        jsonb not null default '{}',
  status        fact_status not null,
  source        text not null check (source in ('label', 'supplier', 'certificate', 'lab', 'calculation', 'merchant', 'open_food_facts', 'staff')),
  evidence_id   uuid references evidence_documents(id),
  proposed_by   uuid references parties(id),
  proposed_at   timestamptz not null default now(),
  approved_by   uuid references parties(id),
  approved_at   timestamptz,
  reviewed_at   timestamptz,                         -- last time a person checked it against the pack or the document
  expires_at    timestamptz,
  superseded_at timestamptz,
  superseded_by uuid references product_facts(id),
  check ((approved_by is null) = (approved_at is null)),
  check (status <> 'certified' or evidence_id is not null),
  check (status <> 'calculated' or source = 'calculation')
);
-- One current approved fact per product and attribute.
create unique index product_facts_current on product_facts(product_id, attribute) where approved_at is not null and superseded_at is null;
create index product_facts_product on product_facts(product_id);

-- Value shape follows the attribute's kind.
create or replace function product_fact_shape() returns trigger language plpgsql as $$
declare v_kind text;
begin
  select kind into v_kind from food_attributes where code = new.attribute;
  if v_kind = 'allergen' and new.status <> 'unknown' and coalesce(new.value, '') not in ('free', 'may_contain', 'contains') then
    raise exception 'FACT_VALUE allergen % takes free, may_contain or contains, not %', new.attribute, new.value;
  elsif v_kind = 'diet' and new.status <> 'unknown' and coalesce(new.value, '') not in ('yes', 'no') then
    raise exception 'FACT_VALUE diet % takes yes or no, not %', new.attribute, new.value;
  elsif v_kind in ('ingredients', 'nutrition') and new.status <> 'unknown' and new.detail = '{}'::jsonb then
    raise exception 'FACT_VALUE % needs its text or panel in detail', new.attribute;
  end if;
  return new;
end $$;
create trigger product_facts_shape before insert or update on product_facts for each row execute function product_fact_shape();

-- A person (or the label-scan function of 5.15, as a proposal) records what a pack or document says. Nothing is used until approved.
create or replace function propose_product_fact(
  p_product uuid, p_attribute text, p_value text, p_status fact_status, p_source text, p_by uuid,
  p_evidence uuid default null, p_detail jsonb default '{}', p_expires_at timestamptz default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_by is not null and not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin')) then
    raise exception 'NOT_AUTHORISED';
  end if;
  insert into product_facts(product_id, attribute, value, detail, status, source, evidence_id, proposed_by, expires_at)
    values (p_product, p_attribute, nullif(lower(btrim(p_value)), ''), coalesce(p_detail, '{}'), p_status, p_source, p_evidence, p_by, p_expires_at)
    returning id into v_id;
  return v_id;
end $$;

-- The ops lead or an admin approves a fact. It replaces the current approved fact for the same attribute, which is kept as history.
-- Open Food Facts is a second opinion only (5.15): a person confirms the field against the pack and records it as 'label'.
create or replace function approve_product_fact(p_fact uuid, p_by uuid) returns jsonb language plpgsql as $$
declare f product_facts%rowtype; v_old uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into f from product_facts where id = p_fact for update;
  if not found then raise exception 'FACT_NOT_FOUND %', p_fact; end if;
  if f.approved_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if f.superseded_at is not null then raise exception 'FACT_SUPERSEDED %', p_fact; end if;
  if f.source = 'open_food_facts' then raise exception 'SECOND_OPINION_ONLY: confirm it against the pack and record it as label'; end if;
  select id into v_old from product_facts where product_id = f.product_id and attribute = f.attribute
     and approved_at is not null and superseded_at is null for update;
  if v_old is not null then update product_facts set superseded_at = now(), superseded_by = p_fact where id = v_old; end if;
  update product_facts set approved_by = p_by, approved_at = now(), reviewed_at = now() where id = p_fact;
  return jsonb_build_object('ok', true, 'already', false, 'replaced', v_old);
end $$;

-- Does this product meet these restrictions? Restrictions are attribute codes: an allergen code means "free of it",
-- a diet code means "it is that". Every restriction gets a check with its result:
--   pass     an approved, unexpired fact with status certified, declared or calculated says so
--   fails    an approved fact says it does not (contains, may contain, or not halal / vegan / ...)
--   unknown  anything else: no approved record, expired, status partial or unknown, or a restriction we do not know
-- meets is true only when every check passes. Sponsorship, popularity and the product's name play no part.
create or replace function product_meets_restrictions(p_product uuid, p_restrictions text[]) returns jsonb language sql stable as $$
  with r as (
    select distinct lower(btrim(x)) as code from unnest(coalesce(p_restrictions, '{}'::text[])) x where btrim(x) <> ''
  ), c as (
    select r.code, a.kind, f.value, f.status, f.source, f.reviewed_at, f.expires_at,
      case
        when a.code is null then 'unknown'
        when a.kind not in ('allergen', 'diet') then 'unknown'
        when f.id is null then 'unknown'
        when f.expires_at is not null and f.expires_at <= now() then 'unknown'
        when f.status not in ('certified', 'declared', 'calculated') then 'unknown'
        when a.kind = 'allergen' and f.value = 'free' then 'pass'
        when a.kind = 'diet' and f.value = 'yes' then 'pass'
        else 'fails'
      end as result,
      case
        when a.code is null then 'unknown_restriction'
        when a.kind not in ('allergen', 'diet') then 'not_a_restriction'
        when f.id is null then 'no_approved_record'
        when f.expires_at is not null and f.expires_at <= now() then 'expired'
        when f.status not in ('certified', 'declared', 'calculated') then 'status_' || f.status
        when a.kind = 'allergen' and f.value = 'free' then null
        when a.kind = 'diet' and f.value = 'yes' then null
        else f.value
      end as reason
    from r left join food_attributes a on a.code = r.code
    left join product_facts f on f.product_id = p_product and f.attribute = a.code and f.approved_at is not null and f.superseded_at is null
  )
  select jsonb_build_object('product_id', p_product,
    'meets', coalesce(bool_and(result = 'pass'), true),
    'checks', coalesce(jsonb_agg(jsonb_build_object('restriction', code, 'kind', kind, 'result', result, 'reason', reason,
                 'status', status, 'value', value, 'source', source, 'reviewed_at', reviewed_at) order by code), '[]'::jsonb))
  from c $$;

-- What may be said about a product: its current approved facts, each with its status, source and review date.
-- Expired facts are listed with expired = true so nobody repeats them as current.
create or replace function product_food_facts(p_product uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('attribute', f.attribute, 'kind', a.kind, 'name_en', a.name_en, 'name_ar', a.name_ar,
           'value', f.value, 'detail', f.detail, 'status', f.status, 'source', f.source, 'reviewed_at', f.reviewed_at,
           'expired', f.expires_at is not null and f.expires_at <= now()) order by a.kind, f.attribute), '[]'::jsonb)
    from product_facts f join food_attributes a on a.code = f.attribute
   where f.product_id = p_product and f.approved_at is not null and f.superseded_at is null $$;

-- New tables: row level security on, no client grants (Supabase gives anon and authenticated default table grants).
do $$ declare t text; r text;
begin
  foreach t in array array['food_attributes', 'evidence_documents', 'product_facts'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
