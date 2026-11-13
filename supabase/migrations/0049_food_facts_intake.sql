-- Alo King Chouf, session D2 (console): food facts from the pack, by a person (3.14, 5.15).
-- Works the same whether 0073 (N1, 5.18) is applied before or after it: it needs only C1's tables (0021).
--
-- 3.14 The food-facts editor. A person records what a pack or a document says, with the document itself as evidence
--      (a photo or PDF in the private media bucket). An ops lead or admin who records it approves it in the same step; a
--      picker's entry is a proposal that waits for one of them. Nothing here reads a product's name, brand or category:
--      a fact is what the evidence says, with its status (invariant 15).
-- 5.15 Label scan at intake, and the review of every proposed fact against the pack, field by field. A picker photographs the
--      barcode and the label; the console's narrow vision function may read the photos into proposals (source label, status
--      partial: nobody has checked them yet). Open Food Facts proposals (N1, 0073) are the second opinion. A person then takes
--      each proposed field in turn, with the pack in hand: confirm it (as printed, corrected if the pack differs, with the photo
--      as evidence), or reject it. Confirming records a new fact from the pack and approves it; the proposal is kept as history.
--      An Open Food Facts row itself is never approved (0021, 0073).

-- Where a fact came from follows from what the evidence is.
create or replace function fact_source_for_evidence(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'label_photo' then 'label' when 'supplier_spec' then 'supplier' when 'manufacturer' then 'supplier'
                     when 'certificate' then 'certificate' when 'lab_report' then 'lab' else 'staff' end $$;

-- A document a fact rests on. The file is already in the private bucket (the console stores it); this records what it is.
create or replace function add_evidence_document(p_product uuid, p_kind text, p_media_path text, p_by uuid, p_reference text default null,
                                                 p_issuer text default null, p_valid_until date default null, p_note text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_product is not null and not exists (select 1 from products where id = p_product) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if p_kind not in ('label_photo', 'supplier_spec', 'certificate', 'lab_report', 'manufacturer', 'other') then raise exception 'UNKNOWN_EVIDENCE %', p_kind; end if;
  if nullif(btrim(p_media_path), '') is null and nullif(btrim(p_reference), '') is null then raise exception 'EVIDENCE_REQUIRED'; end if;
  -- The same file for the same product is one document.
  select id into v from evidence_documents where media_path = nullif(btrim(p_media_path), '') and product_id is not distinct from p_product and kind = p_kind;
  if v is not null then return v; end if;
  insert into evidence_documents(kind, product_id, media_path, reference, issuer, valid_until, note, uploaded_by)
    values (p_kind, p_product, nullif(btrim(p_media_path), ''), nullif(btrim(p_reference), ''), nullif(btrim(p_issuer), ''), p_valid_until,
            nullif(btrim(p_note), ''), p_by)
    returning id into v;
  return v;
end $$;

-- 3.14: one fact from the pack or a document. Evidence is required unless the person records that the pack says nothing
-- (status unknown). certified needs a certificate or a lab report. The ops lead or an admin approves it at once; a picker proposes.
create or replace function record_food_fact(p_product uuid, p_attribute text, p_value text, p_status fact_status, p_detail jsonb,
                                            p_evidence uuid, p_by uuid, p_expires_at timestamptz default null)
returns jsonb language plpgsql as $$
declare v_role text; e evidence_documents%rowtype; v_id uuid; v_source text := 'staff'; v_approved jsonb;
begin
  select role::text into v_role from parties where id = p_by and not is_blocked;
  if v_role is null or v_role not in ('picker', 'ops_lead', 'admin') then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from food_attributes where code = p_attribute) then raise exception 'FACT_ATTRIBUTE_UNKNOWN %', p_attribute; end if;
  if p_status = 'calculated' then raise exception 'CALCULATED_NOT_HERE: a calculated fact comes from the calculation'; end if;
  if p_evidence is null and p_status <> 'unknown' then raise exception 'EVIDENCE_REQUIRED'; end if;
  if p_evidence is not null then
    select * into e from evidence_documents where id = p_evidence;
    if not found or (e.product_id is not null and e.product_id <> p_product) then raise exception 'EVIDENCE_NOT_FOR_PRODUCT'; end if;
    if p_status = 'certified' and e.kind not in ('certificate', 'lab_report') then raise exception 'CERTIFIED_NEEDS_CERTIFICATE'; end if;
    v_source := fact_source_for_evidence(e.kind);
  end if;
  v_id := propose_product_fact(p_product, p_attribute, p_value, p_status, v_source, p_by, p_evidence,
                               coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('recorded_in', 'console'), p_expires_at);
  if v_role in ('ops_lead', 'admin') then
    v_approved := approve_product_fact(v_id, p_by);
    return jsonb_build_object('ok', true, 'fact_id', v_id, 'approved', true, 'replaced', v_approved->'replaced');
  end if;
  return jsonb_build_object('ok', true, 'fact_id', v_id, 'approved', false);
end $$;

-- ---------- 5.15 ----------
alter table product_facts add column if not exists rejected_by uuid references parties(id);
alter table product_facts add column if not exists rejected_at timestamptz;
alter table product_facts add column if not exists review_note text;

create table label_scans (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id),
  photos       text[] not null,                     -- media paths, private bucket
  evidence_ids uuid[] not null,
  reading      jsonb,                               -- what the vision function read (name, brand, size, barcode, facts); null when none ran
  read_by      text not null check (read_by in ('model', 'none')),
  model        text,
  scanned_by   uuid not null references parties(id),
  created_at   timestamptz not null default now()
);
create index label_scans_product on label_scans(product_id, created_at desc);

-- A scan: the photos become label_photo evidence; what the model read becomes proposals, one per field, each with the printed
-- words it rests on. Malformed entries are dropped and reported, never guessed into shape. A newer reading of a field replaces
-- the older reading's proposal (kept as history).
create or replace function record_label_scan(p_product uuid, p_photos text[], p_reading jsonb, p_model text, p_by uuid) returns jsonb language plpgsql as $$
declare v_ev uuid[] := '{}'; v_path text; v_scan uuid; f jsonb; v_attr text; v_kind text; v_value text; v_detail jsonb; v_id uuid;
        v_proposed jsonb := '{}'; v_dropped jsonb := '[]'; v_old uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from products where id = p_product) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if coalesce(array_length(p_photos, 1), 0) = 0 then raise exception 'PHOTO_REQUIRED'; end if;
  foreach v_path in array p_photos loop
    v_ev := v_ev || add_evidence_document(p_product, 'label_photo', v_path, p_by);
  end loop;
  insert into label_scans(product_id, photos, evidence_ids, reading, read_by, model, scanned_by)
    values (p_product, p_photos, v_ev, p_reading, case when p_reading is null then 'none' else 'model' end, p_model, p_by) returning id into v_scan;
  for f in select * from jsonb_array_elements(coalesce(p_reading->'facts', '[]'::jsonb)) loop
    v_attr := f->>'attribute';
    select kind into v_kind from food_attributes where code = v_attr;
    v_value := nullif(lower(btrim(f->>'value')), '');
    v_detail := jsonb_strip_nulls(jsonb_build_object('text', nullif(btrim(f->>'text'), ''), 'values', f->'values', 'per', case when f ? 'values' then '100g' end,
                  'quote', nullif(btrim(f->>'quote'), ''), 'read_by', 'model', 'model', p_model, 'scan_id', v_scan));
    if v_kind is null
       or (v_kind = 'allergen' and (v_value is null or v_value not in ('contains', 'may_contain', 'free') or v_detail->>'quote' is null))
       or (v_kind = 'diet' and (v_value is null or v_value not in ('yes', 'no') or v_detail->>'quote' is null or v_attr = 'fasting'))
       or (v_kind = 'ingredients' and v_detail->>'text' is null)
       or (v_kind = 'nutrition' and jsonb_typeof(v_detail->'values') is distinct from 'object') then
      v_dropped := v_dropped || jsonb_build_object('attribute', v_attr, 'value', v_value); continue;
    end if;
    if v_kind in ('ingredients', 'nutrition') then v_value := null; end if;
    select id into v_old from product_facts where product_id = p_product and attribute = v_attr and approved_at is null and superseded_at is null
       and detail->>'read_by' = 'model' for update;
    v_id := propose_product_fact(p_product, v_attr, v_value, 'partial', 'label', p_by, v_ev[1], v_detail);
    if v_old is not null then update product_facts set superseded_at = now(), superseded_by = v_id where id = v_old; end if;
    v_proposed := v_proposed || jsonb_build_object(v_attr, v_id);
  end loop;
  return jsonb_build_object('ok', true, 'scan_id', v_scan, 'evidence', to_jsonb(v_ev), 'proposed', v_proposed, 'dropped', v_dropped);
end $$;

-- One proposed field, checked against the pack by the ops lead or an admin.
--   reject:  set aside, with who and why (a rerun of 5.18 does not propose the same reading again).
--   confirm: a new fact from the pack, with the value, status and evidence the person chose (the proposal's by default; an Open
--            Food Facts proposal has no evidence of ours, so the pack photo is required), approved at once; the proposal is kept,
--            superseded by it. partial and calculated cannot be confirmed: the person read the pack or set it aside.
create or replace function review_proposed_fact(p_fact uuid, p_by uuid, p_decision text, p_value text default null, p_status fact_status default 'declared',
                                                p_detail jsonb default null, p_evidence uuid default null, p_note text default null,
                                                p_expires_at timestamptz default null)
returns jsonb language plpgsql as $$
declare f product_facts%rowtype; v_kind text; v_value text; v_detail jsonb; v_r jsonb; v_new uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into f from product_facts where id = p_fact for update;
  if not found then raise exception 'FACT_NOT_FOUND'; end if;
  if f.approved_at is not null or f.superseded_at is not null then raise exception 'FACT_NOT_PENDING'; end if;
  if p_decision = 'reject' then
    update product_facts set superseded_at = now(), rejected_by = p_by, rejected_at = now(), review_note = nullif(btrim(p_note), '') where id = p_fact;
    return jsonb_build_object('ok', true, 'decision', 'reject');
  elsif p_decision is distinct from 'confirm' then raise exception 'UNKNOWN_DECISION %', p_decision;
  end if;
  if p_status not in ('declared', 'certified', 'unknown') then raise exception 'CONFIRM_STATUS %: the pack either says it or it does not', p_status; end if;
  select kind into v_kind from food_attributes where code = f.attribute;
  v_value := case when v_kind in ('allergen', 'diet') then coalesce(nullif(lower(btrim(p_value)), ''), f.value) end;
  v_detail := coalesce(p_detail, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(f.detail) x(k, v)
                                   where k in ('text', 'values', 'per', 'units', 'ar', 'lang')))
              || jsonb_build_object('confirmed_from', f.id, 'proposal_source', f.source);
  v_r := record_food_fact(f.product_id, f.attribute, v_value, p_status, v_detail, coalesce(p_evidence, f.evidence_id), p_by, p_expires_at);
  v_new := (v_r->>'fact_id')::uuid;
  update product_facts set superseded_at = now(), superseded_by = v_new, reviewed_at = now(), review_note = nullif(btrim(p_note), '') where id = p_fact;
  return jsonb_build_object('ok', true, 'decision', 'confirm', 'fact_id', v_new, 'changed', v_value is distinct from f.value or p_detail is not null);
end $$;

-- What waits for a person: items with proposed fields, most first.
create or replace function food_fact_review_queue(p_limit int default 100) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'fields')::int desc, x->>'name_en'), '[]'::jsonb) from (
    select jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'sku', p.sku, 'barcode', p.barcode, 'fields', count(*),
             'from_open_food_facts', count(*) filter (where f.source = 'open_food_facts'),
             'from_label_reading', count(*) filter (where f.detail->>'read_by' = 'model'),
             'from_staff', count(*) filter (where f.source <> 'open_food_facts' and coalesce(f.detail->>'read_by', '') <> 'model')) as x
      from product_facts f join products p on p.id = f.product_id
     where f.approved_at is null and f.superseded_at is null
     group by p.id, p.name_en, p.sku, p.barcode
     limit p_limit) q $$;

alter table label_scans enable row level security;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table label_scans from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table label_scans to service_role; end if;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
