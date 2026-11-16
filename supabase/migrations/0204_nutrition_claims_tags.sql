-- Alo King Chouf, session PD1, pull request 2, part (b): the fields that answer what customers ask (docs/PRODUCT_DATA_STANDARD.md,
-- "Why the two voice notes failed", cause 4: no field for "no added sugar", no sugar figure that can be filtered, no audience tag).
--
--   product_nutrition()     nutrition per 100 g or 100 ml as numbers, built from the approved, current nutrition record (0021's panel in
--                           detail.values): energy, fat, saturated fat, carbohydrate, sugars, added sugars where printed, protein, fibre,
--                           salt, serving size. Nothing is computed by a model; a value not printed is null, never 0.
--   claim_codes, product_claims   printed claims as a list, each with the printed words (quote) and where it was read. A claim is
--                           approved only from a label photo or the brand's own page (or a person with evidence). A claim that sounds
--                           medical needs a person. A food claim only on a food item.
--   product_certificates    certifications with their evidence (a halal, organic or other certificate): always approved by a person.
--   tag_codes, product_tags audience and occasion tags (kids, lunchbox, breakfast, Ramadan, cleaning day ...): shopping tags for search
--                           and baskets, never a health or safety claim, and never said in a reply as advice (invariant 14).
-- Hazard warnings and pictograms as printed, caffeine and the supply fields are template fields (product_field_values, 0203).

-- ---------- nutrition as numbers ----------
-- A JSON number as numeric; anything else is null (a value not printed is unknown, never zero).
create or replace function json_num(p jsonb) returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$' then replace(btrim(p #>> '{}'), ',', '.')::numeric end $$;

create or replace function product_nutrition(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case when f.id is null then null else jsonb_build_object(
      'per', coalesce(f.detail->>'per', '100g'),
      'energy_kcal', json_num(f.detail->'values'->'energy_kcal'), 'fat_g', json_num(f.detail->'values'->'fat'),
      'saturated_fat_g', json_num(f.detail->'values'->'saturated_fat'), 'carbohydrate_g', json_num(f.detail->'values'->'carbohydrates'),
      'sugars_g', json_num(f.detail->'values'->'sugars'), 'added_sugars_g', json_num(f.detail->'values'->'added_sugars'),
      'protein_g', json_num(f.detail->'values'->'proteins'), 'fibre_g', json_num(coalesce(f.detail->'values'->'fiber', f.detail->'values'->'fibre')),
      'salt_g', json_num(f.detail->'values'->'salt'), 'serving_size_g', json_num(coalesce(f.detail->'serving_size_g', f.detail->'values'->'serving_size')),
      'status', f.status, 'source', f.source, 'approved_at', f.approved_at, 'reviewed_at', f.reviewed_at) end
    from (select null::int) one
    left join lateral (select x.* from product_facts x where x.product_id = p_product and x.attribute = 'nutrition' and x.approved_at is not null
                         and x.superseded_at is null and x.status in ('certified', 'declared', 'calculated')
                         and (x.expires_at is null or x.expires_at > now())
                         and coalesce(x.reviewed_at, x.approved_at) > now() - interval '12 months' limit 1) f on true $$;

-- ---------- printed claims ----------
create table claim_codes (
  code      text primary key,
  name_en   text not null,
  name_ar   text not null,
  food      boolean not null,           -- a food claim exists only on a food item
  medical   boolean not null default false,   -- sounds medical: always a person
  has_value boolean not null default false    -- SPF 30, "made in Lebanon" (the place)
);
insert into claim_codes(code, name_en, name_ar, food, medical, has_value) values
  ('no_added_sugar',   'No added sugar',      'بدون سكر مضاف',        true,  false, false),
  ('sugar_free',       'Sugar free',          'خالي من السكر',         true,  false, false),
  ('low_sugar',        'Low sugar',           'قليل السكر',            true,  false, false),
  ('high_protein',     'High protein',        'غني بالبروتين',         true,  false, false),
  ('source_of_fibre',  'Source of fibre',     'مصدر للألياف',          true,  false, false),
  ('gluten_free',      'Gluten free',         'خالي من الغلوتين',      true,  false, false),
  ('lactose_free',     'Lactose free',        'خالي من اللاكتوز',      true,  false, false),
  ('low_fat',          'Low fat',             'قليل الدسم',            true,  false, false),
  ('fat_free',         'Fat free',            'خالي من الدسم',         true,  false, false),
  ('low_salt',         'Low salt',            'قليل الملح',            true,  false, false),
  ('unsalted',         'Unsalted',            'بدون ملح',              true,  false, false),
  ('caffeine_free',    'Caffeine free',       'خالي من الكافيين',      true,  false, false),
  ('wholegrain',       'Wholegrain',          'حبوب كاملة',            true,  false, false),
  ('organic',          'Organic',             'عضوي',                  true,  false, false),
  ('made_in',          'Made in (as printed)', 'صنع في',               false, false, true),
  ('fragrance_free',   'Fragrance free',      'بدون عطر',              false, false, false),
  ('paraben_free',     'Paraben free',        'خالي من البارابين',     false, false, false),
  ('spf',              'SPF (as printed)',    'عامل حماية من الشمس',   false, false, true),
  ('tear_free',        'Tear free (as printed)', 'لا يدمع العيون',     false, false, false),
  ('hypoallergenic',   'Hypoallergenic',      'مضاد للحساسية',         false, true,  false),
  ('dermatologically_tested', 'Dermatologically tested', 'مختبر من أطباء الجلد', false, true, false),
  ('for_sensitive_skin', 'For sensitive skin', 'للبشرة الحساسة',       false, true,  false),
  ('anti_dandruff',    'Anti-dandruff',       'ضد القشرة',             false, true,  false),
  ('antibacterial',    'Antibacterial',       'مضاد للبكتيريا',        false, true,  false);

create table product_claims (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  claim_code  text not null references claim_codes(code),
  value       text,                                  -- SPF 30; the place for made_in
  quote       text not null check (btrim(quote) <> ''),   -- the printed words, copied exactly
  source      text not null check (source in ('label_photo', 'brand_site', 'open_food_facts', 'retailer_page', 'research_file', 'person')),
  page_url    text,
  evidence_id uuid references evidence_documents(id),
  status      text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  proposed_by uuid references parties(id),
  proposed_at timestamptz not null default now(),
  approved_by uuid references parties(id),
  approved_at timestamptz,
  reviewed_at timestamptz,
  expires_at  timestamptz
);
create unique index product_claims_current on product_claims(product_id, claim_code) where status = 'approved';
create index product_claims_product on product_claims(product_id);

create or replace function product_claim_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare c claim_codes%rowtype; v_t text; v_food boolean;
begin
  select * into c from claim_codes where code = new.claim_code;
  v_t := product_template(new.product_id);
  v_food := coalesce((select is_food from product_templates where code = v_t), false);
  if c.food and not v_food then raise exception 'NOT_FOOD: claim % is a food claim and % is not a food item', new.claim_code, new.product_id; end if;
  if c.has_value and coalesce(btrim(new.value), '') = '' then raise exception 'CLAIM_VALUE: % needs its printed value', new.claim_code; end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    -- Printed claims only from a label photo or the brand's own page (a person may approve with evidence in hand).
    if not (new.source in ('label_photo', 'brand_site') or (new.source = 'person' and new.evidence_id is not null)) then
      raise exception 'CLAIM_SOURCE: a printed claim is approved only from a label photo or the brand''s own page, not %', new.source;
    end if;
    if new.approved_by = auto_approval_party() and c.medical then
      raise exception 'NEVER_AUTOMATIC: % sounds medical; a person approves it', new.claim_code;
    end if;
    if new.approved_at is null then new.approved_at := now(); end if;
    if new.expires_at is null then new.expires_at := new.approved_at + interval '12 months'; end if;
  end if;
  return new;
end $$;
create trigger product_claims_rules before insert or update on product_claims for each row execute function product_claim_rules();

-- ---------- certificates ----------
create table product_certificates (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products(id) on delete cascade,   -- null with supplier: one certificate covers a supplier's items
  supplier      text,
  kind          text not null check (kind in ('halal', 'organic', 'iso_22000', 'haccp', 'kosher', 'other')),
  issuer        text,
  reference     text,
  evidence_id   uuid not null references evidence_documents(id),
  valid_until   date,
  status        text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  proposed_by   uuid references parties(id),
  proposed_at   timestamptz not null default now(),
  approved_by   uuid references parties(id),
  approved_at   timestamptz,
  check (product_id is not null or supplier is not null)
);
create index product_certificates_product on product_certificates(product_id);
create or replace function certificates_by_a_person() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    if new.approved_by is null or new.approved_by = auto_approval_party()
       or not exists (select 1 from parties where id = new.approved_by and role in ('ops_lead', 'admin') and not is_blocked) then
      raise exception 'NEVER_AUTOMATIC: a certificate is approved by a person (ops lead or admin)';
    end if;
    if new.approved_at is null then new.approved_at := now(); end if;
  end if;
  return new;
end $$;
create trigger product_certificates_person before insert or update on product_certificates for each row execute function certificates_by_a_person();

-- ---------- audience and occasion tags ----------
create table tag_codes (
  code    text primary key,
  kind    text not null check (kind in ('audience', 'occasion', 'taste', 'format')),
  name_en text not null,
  name_ar text not null
);
insert into tag_codes(code, kind, name_en, name_ar) values
  ('kids', 'audience', 'Kids', 'ولاد'), ('toddlers', 'audience', 'Toddlers', 'أطفال صغار'), ('family', 'audience', 'Family', 'عيلة'),
  ('lunchbox', 'occasion', 'Lunchbox', 'زوادة المدرسة'), ('breakfast', 'occasion', 'Breakfast', 'ترويقة'), ('party', 'occasion', 'Party', 'سهرة'),
  ('ramadan', 'occasion', 'Ramadan', 'رمضان'), ('iftar', 'occasion', 'Iftar', 'إفطار'), ('back_to_school', 'occasion', 'Back to school', 'رجعة المدارس'),
  ('summer', 'occasion', 'Summer', 'صيف'), ('christmas', 'occasion', 'Christmas', 'الميلاد'), ('cleaning_day', 'occasion', 'Cleaning day', 'يوم التنظيف'),
  ('late_night', 'occasion', 'Late night', 'آخر الليل'), ('bbq', 'occasion', 'Barbecue', 'مشاوي'),
  ('sweet', 'taste', 'Sweet', 'حلو'), ('salty', 'taste', 'Salty', 'مالح'), ('spicy', 'taste', 'Spicy', 'حار'), ('crunchy', 'taste', 'Crunchy', 'مقرمش'),
  ('chocolate', 'taste', 'Chocolate', 'شوكولا'), ('plain', 'taste', 'Plain', 'سادة'),
  ('single_serve', 'format', 'Single serve', 'حصة وحدة'), ('family_pack', 'format', 'Family pack', 'حجم عائلي'), ('multipack', 'format', 'Multipack', 'باكيت متعدد');

create table product_tags (
  product_id  uuid not null references products(id) on delete cascade,
  tag_code    text not null references tag_codes(code),
  source      text not null check (source in ('rules', 'model', 'person')),
  approved    boolean not null default true,      -- shopping tags are automatic; a person may switch one off
  created_at  timestamptz not null default now(),
  removed_by  uuid references parties(id),
  primary key (product_id, tag_code)
);

do $$ declare t text; r text;
begin
  foreach t in array array['claim_codes', 'product_claims', 'product_certificates', 'tag_codes', 'product_tags'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
