-- Alo King Chouf, session D2 (console): food facts from the pack, by a person (3.14, 5.15).
-- Works the same whether 0073 (N1, 5.18) is applied before or after it: it needs only C1's tables (0021).
--
-- 3.14 The food-facts editor. A person records what a pack or a document says, with the document itself as evidence
--      (a photo or PDF in the private media bucket). An ops lead or admin who records it approves it in the same step; a
--      picker's entry is a proposal that waits for one of them. Nothing here reads a product's name, brand or category:
--      a fact is what the evidence says, with its status (invariant 15).

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

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
