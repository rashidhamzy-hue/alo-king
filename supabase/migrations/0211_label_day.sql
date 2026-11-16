-- Alo King Chouf, session LB1 (label day tooling and test budget), migration 0211: the label day in the database.
-- docs/DECISIONS.md, "Coordinator decisions, 16 November 2026": every pack is photographed (front, back, and the side with nutrition or
-- directions) before the friends' test, so the LABEL, not a web page, is the source of product facts. What this migration adds, each part
-- with a test in test/db/label-day-lb1.test.ts:
--
--   1 the setting sim_monthly_cap_usd       the monthly ceiling the sim-test workflow reads before it starts (60 for November 2026, 20 a
--                                           month after; scripts/ci/sim-ceiling.mjs)
--   2 label_captures                        one row per photo taken on the label day (front, back, side), in the private media bucket;
--                                           record_label_capture() is idempotent, so a photo sent again after a failed upload is one record
--                                           and is never lost; label_capture_progress / _next / _find / _items serve the phone page:
--                                           items done and left by aisle, the next item on the shelf, a scan or a list
--   3 label_reading_queue()                 the items photographed (front and back) and not read since; the reading workflow's work list
--   4 label_reading_settle()                after a reading: the rules approve what they may (0124, 0207), then LABEL BEATS WEB (0114):
--                                           a web or Open Food Facts proposal for a field the label read is set aside (the label's
--                                           proposal records where it disagreed, for a person). The 466 web proposals are replaced this
--                                           way, not approved by hand
--   5 review_field_value / _claim / _certificate   a person's approval of the proposals the label reading makes (field values, printed
--                                           claims, certificates): ops lead or admin only; the automatic party is refused by 0207's
--                                           triggers whatever calls them
--   6 approval_queue()                      what waits for a person, in the order of one sitting: allergens; halal, diet labels and
--                                           certificates; hazard and printed warnings; disagreements between sources; the rest of the
--                                           label readings. A web or Open Food Facts proposal on its own is never in it
--   7 label_day_report()                    items photographed, read and fact-complete per template, and why each other item is not
--
-- Nothing here approves allergens, halal, certificates, hazard warnings or printed warnings: those stay with a person (0124, 0204, 0207,
-- 0210). Nothing here reads a name, a brand or a kind of product to decide a fact (invariants 15 and 16).

-- ---------- 1 ----------
insert into settings(key, value) values ('sim_monthly_cap_usd', '{"default_usd": 20, "months": {"2026-11": 60}}') on conflict (key) do nothing;

-- ---------- 2 ----------
create table label_captures (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  shot          text not null check (shot in ('front', 'back', 'side')),
  media_path    text not null check (btrim(media_path) <> ''),            -- the private media bucket: labels/<product id>/<shot>-<time>.jpg
  captured_by   uuid not null references parties(id),
  captured_at   timestamptz not null default now(),
  superseded_at timestamptz,                                              -- a retake replaces the shot; the earlier photo stays as history
  unique (product_id, shot, media_path)
);
create unique index label_captures_current on label_captures(product_id, shot) where superseded_at is null;
create index label_captures_product on label_captures(product_id);

-- The items the label day covers (active, not a restaurant's dish), with their aisle, in shelf order, and what is captured.
create or replace view label_capture_status as
  select p.id as product_id, p.sku, p.name_en, p.name_ar, p.barcode, intake_barcode_key(p.barcode) is not null as has_barcode,
         coalesce(cc.name_en, p.category, '') as aisle, coalesce(cc.sort_order, 1000000) as sort_order,
         exists (select 1 from label_captures c where c.product_id = p.id and c.shot = 'front' and c.superseded_at is null) as front,
         exists (select 1 from label_captures c where c.product_id = p.id and c.shot = 'back'  and c.superseded_at is null) as back,
         exists (select 1 from label_captures c where c.product_id = p.id and c.shot = 'side'  and c.superseded_at is null) as side,
         exists (select 1 from label_captures c where c.product_id = p.id and c.shot = 'front' and c.superseded_at is null)
           and exists (select 1 from label_captures c where c.product_id = p.id and c.shot = 'back' and c.superseded_at is null) as done
    from products p
    left join catalog_placements pl on pl.sku = p.sku
    left join catalog_categories cc on cc.code = pl.category_code
   where p.is_active and p.owner_source_id is null;

create or replace function label_capture_json(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('product_id', s.product_id, 'sku', s.sku, 'name_en', s.name_en, 'name_ar', s.name_ar, 'barcode', s.barcode,
           'has_barcode', s.has_barcode, 'aisle', s.aisle, 'done', s.done,
           'shots', jsonb_build_object('front', s.front, 'back', s.back, 'side', s.side, 'done', s.done))
    from label_capture_status s where s.product_id = p_product $$;

-- One photo. Idempotent: the same photo sent again (a retry after a failed upload) is the same record, and a retake of a shot replaces
-- the current photo of that shot without deleting it. Only a picker, an ops lead or an admin.
create or replace function record_label_capture(p_product uuid, p_shot text, p_media_path text, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_already boolean := false;
begin
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_shot is null or p_shot not in ('front', 'back', 'side') then raise exception 'CAPTURE_SHOT: front, back or side'; end if;
  if not exists (select 1 from products where id = p_product) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if coalesce(p_media_path, '') not like 'labels/' || p_product::text || '/%' or p_media_path ~ '\.\.' then
    raise exception 'CAPTURE_PATH: the photo must be stored under labels/<the item''s id>/';
  end if;
  select id into v_id from label_captures where product_id = p_product and shot = p_shot and media_path = p_media_path;
  if v_id is not null then
    v_already := true;
  else
    update label_captures set superseded_at = now() where product_id = p_product and shot = p_shot and superseded_at is null;
    insert into label_captures(product_id, shot, media_path, captured_by) values (p_product, p_shot, p_media_path, p_by) returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'capture_id', v_id, 'shot', p_shot, 'already', v_already,
    'done', coalesce((select s.done from label_capture_status s where s.product_id = p_product), false));
end $$;

-- By SKU, or by barcode in any written form (spaces, a leading zero added by the scanner).
create or replace function label_capture_find(p_code text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select label_capture_json(s.product_id) from label_capture_status s
   where s.sku = btrim(coalesce(p_code, ''))
      or (intake_barcode_key(p_code) is not null and intake_barcode_key(s.barcode) = intake_barcode_key(p_code))
   order by (s.sku = btrim(coalesce(p_code, ''))) desc limit 1 $$;

-- The next item not done in shelf order (aisle order, then name), after the one just done; the start of the shelf when none is left after it.
-- Null when every item is done.
create or replace function label_capture_next(p_after uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with o as (select s.*, row_number() over (order by s.sort_order, s.aisle, s.name_en, s.product_id) as rn from label_capture_status s),
       cur as (select rn from o where product_id = p_after)
  select label_capture_json(coalesce(
    (select product_id from o where not done and rn > coalesce((select rn from cur), 0) order by rn limit 1),
    (select product_id from o where not done order by rn limit 1))) $$;

-- The list for a person who cannot scan (the items without a barcode), or for any item not yet captured.
create or replace function label_capture_items(p_only_missing boolean default true, p_no_barcode boolean default false, p_limit int default 400)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(label_capture_json(x.product_id) order by x.sort_order, x.aisle, x.name_en, x.product_id), '[]'::jsonb)
    from (select * from label_capture_status s where (not p_only_missing or not s.done) and (not p_no_barcode or not s.has_barcode)
           order by s.sort_order, s.aisle, s.name_en, s.product_id limit greatest(p_limit, 1)) x $$;

-- Items done and left, overall and by aisle. Done: front and back; the side photo is optional.
create or replace function label_capture_progress() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'total', count(*), 'done', count(*) filter (where done), 'left', count(*) filter (where not done), 'with_side', count(*) filter (where side),
    'by_aisle', (select coalesce(jsonb_agg(jsonb_build_object('aisle', a.aisle, 'total', a.t, 'done', a.d, 'left', a.t - a.d) order by a.sort_order, a.aisle), '[]'::jsonb)
                   from (select aisle, min(sort_order) as sort_order, count(*)::int as t, (count(*) filter (where done))::int as d from label_capture_status group by aisle) a))
    from label_capture_status $$;

-- The party the reading run records as the one who PROPOSED a reading (record_label_scan asks for a picker, an ops lead or an admin).
-- A picker can only propose: it approves nothing (review_* ask for an ops lead or an admin), has no sign-in, and the rule party's trigger
-- list (0124, 0207) still keeps every allergen, halal, certificate and warning for a person.
insert into parties(id, role, display_name, is_blocked, notes)
values ('00000000-0000-4000-8000-0000000000b1', 'picker', 'Label reading run (a model reads the photos; a person approves)', false,
        'Session LB1. Recorded as the proposer of the label-read workflow''s readings. No account can sign in as it.')
on conflict (id) do nothing;
create or replace function label_reader_party() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000b1'::uuid $$;

-- ---------- 3 ----------
-- Photographed (front and back) and not read since the newest current photo. A failed reading leaves the item here.
create or replace function label_reading_queue(p_limit int default 500) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'sku', x.sku, 'name_en', x.name_en, 'template', x.template, 'is_food', x.is_food,
           'photos', x.photos) order by x.sort_order, x.aisle, x.name_en, x.product_id), '[]'::jsonb)
    from (select s.product_id, s.sku, s.name_en, s.sort_order, s.aisle, product_template(s.product_id) as template,
                 coalesce((select t.is_food from product_templates t where t.code = product_template(s.product_id)), false) as is_food,
                 (select jsonb_agg(c.media_path order by case c.shot when 'front' then 1 when 'back' then 2 else 3 end)
                    from label_captures c where c.product_id = s.product_id and c.superseded_at is null) as photos
            from label_capture_status s
           where s.done
             and not exists (select 1 from label_scans l where l.product_id = s.product_id and l.read_by = 'model' and l.reading is not null
                               and l.created_at >= (select max(c.captured_at) from label_captures c where c.product_id = s.product_id and c.superseded_at is null))
           order by s.sort_order, s.aisle, s.name_en, s.product_id limit greatest(p_limit, 1)) x $$;

-- ---------- 4 ----------
-- Do a label reading and a web proposal of the same fact say different things? The values for an allergen or a diet label, the numbers of a
-- nutrition panel (0114's fact_agree), the two ingredient lists letter for letter when both are written in the same script. A label
-- reading carries no language tag, so 0114's own ingredient comparison never fires for it; a list in another script is not compared.
create or replace function label_fact_disagrees(p_attribute text, p_label_value text, p_label jsonb, p_web_value text, p_web jsonb) returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
declare ta text := intake_text_key(coalesce(p_label->>'text', '')); tb text := intake_text_key(coalesce(p_web->>'text', p_web->>'source_text', ''));
begin
  if p_attribute = 'ingredients' then
    return ta <> '' and tb <> '' and (ta ~ '[ء-ي]') = (tb ~ '[ء-ي]') and ta <> tb;
  end if;
  return not fact_agree(p_attribute, p_label_value, p_label, p_web_value, p_web);
end $$;

-- Run after record_label_scan for an item. First the rules (0124, 0207) approve what code may: a label and a second source that agree.
-- Then label beats web (0114): what is still waiting from a web page or Open Food Facts for a field the label read is set aside, and
-- where it said something else the label's proposal keeps it (detail.disagrees_with) so that a person sees both.
create or replace function label_reading_settle(p_product uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_auto jsonb; w record; l product_facts%rowtype; lv product_field_values%rowtype; n_facts int := 0; n_fields int := 0; n_claims int := 0; n_dis int := 0;
begin
  v_auto := intake_try_auto(p_product);
  for w in select * from product_facts where product_id = p_product and source in ('open_food_facts', 'web_page') and approved_at is null and superseded_at is null order by proposed_at loop
    select * into l from label_reading_of(p_product, w.attribute, w.id);
    if l.id is null then continue; end if;
    if l.approved_at is null and label_fact_disagrees(w.attribute, l.value, l.detail, w.value, w.detail) then
      update product_facts set detail = detail || jsonb_build_object('disagrees_with', coalesce(detail->'disagrees_with', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'source', w.source, 'fact_id', w.id, 'value', coalesce(to_jsonb(w.value), w.detail->'text', w.detail->'values'), 'page_url', w.detail->>'page_url'))))
       where id = l.id;
      n_dis := n_dis + 1;
    end if;
    update product_facts set superseded_at = now(), superseded_by = l.id, review_note = 'set aside: the label reading wins over a web source (label beats web, 0114)' where id = w.id;
    n_facts := n_facts + 1;
  end loop;
  for w in select * from product_field_values where product_id = p_product and status = 'proposed'
              and source in ('brand_site', 'retailer_page', 'research_file', 'open_food_facts', 'barcode_lookup') order by proposed_at loop
    select * into lv from product_field_values x where x.product_id = p_product and x.field_key = w.field_key and x.source = 'label_photo' and x.status in ('proposed', 'approved')
     order by (x.status = 'approved') desc, x.proposed_at desc limit 1;
    if not found then continue; end if;
    if lv.status = 'proposed' and lv.value is distinct from w.value then
      update product_field_values set detail = detail || jsonb_build_object('disagrees_with', coalesce(detail->'disagrees_with', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'source', w.source, 'value_id', w.id, 'value', w.value))) where id = lv.id;
      n_dis := n_dis + 1;
    end if;
    update product_field_values set status = 'superseded', detail = detail || jsonb_build_object('set_aside_by', lv.id, 'reason', 'label beats web (0114)') where id = w.id;
    n_fields := n_fields + 1;
  end loop;
  for w in select * from product_claims c where c.product_id = p_product and c.status = 'proposed' and c.source in ('brand_site', 'open_food_facts', 'retailer_page', 'research_file')
              and exists (select 1 from product_claims x where x.product_id = c.product_id and x.claim_code = c.claim_code and x.source = 'label_photo' and x.status in ('proposed', 'approved')) loop
    update product_claims set status = 'superseded' where id = w.id;
    n_claims := n_claims + 1;
  end loop;
  return jsonb_build_object('auto', v_auto, 'facts_set_aside', n_facts, 'fields_set_aside', n_fields, 'claims_set_aside', n_claims, 'disagreements', n_dis);
end $$;

-- ---------- 5 ----------
create or replace function label_reviewer(p_by uuid) returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
end $$;

-- A field value the label reading proposed: confirmed as printed, confirmed with a correction (the pack differs from the reading), or rejected.
-- Confirming replaces the item's current value and sets any other open reading of the same field aside: the person decided.
-- p_corrected, when the pack differs from the reading: {"value": <the corrected value>} (an object, so a list and a text travel the same way).
create or replace function review_field_value(p_value uuid, p_by uuid, p_decision text, p_note text default null, p_corrected jsonb default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v product_field_values%rowtype; v_corrected boolean := p_corrected is not null and jsonb_typeof(p_corrected) = 'object' and p_corrected ? 'value' and p_corrected->'value' <> 'null'::jsonb;
begin
  perform label_reviewer(p_by);
  if p_decision is null or p_decision not in ('confirm', 'reject') then raise exception 'UNKNOWN_DECISION %', p_decision; end if;
  select * into v from product_field_values where id = p_value for update;
  if not found then raise exception 'FIELD_VALUE_NOT_FOUND'; end if;
  if v.status <> 'proposed' then raise exception 'NOT_PENDING'; end if;
  if p_decision = 'reject' then
    update product_field_values set status = 'rejected', reviewed_at = now(), detail = detail || jsonb_strip_nulls(jsonb_build_object('review_note', nullif(btrim(p_note), ''), 'rejected_by', p_by)) where id = p_value;
    return jsonb_build_object('ok', true, 'decision', 'reject');
  end if;
  update product_field_values set status = 'superseded' where product_id = v.product_id and field_key = v.field_key and status = 'approved';
  update product_field_values set status = 'superseded', detail = detail || jsonb_build_object('set_aside_by', v.id, 'reason', 'a person confirmed another reading')
   where product_id = v.product_id and field_key = v.field_key and status = 'proposed' and id <> v.id;
  update product_field_values set status = 'approved', approved_by = p_by, approved_at = now(), reviewed_at = now(), expires_at = null,
         value = case when v_corrected then p_corrected->'value' else value end,
         detail = detail || case when v_corrected then jsonb_build_object('corrected_by_person', true, 'read_value', v.value) else '{}'::jsonb end
   where id = p_value;
  return jsonb_build_object('ok', true, 'decision', 'confirm', 'corrected', v_corrected);
end $$;

create or replace function review_claim(p_claim uuid, p_by uuid, p_decision text, p_note text default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c product_claims%rowtype;
begin
  perform label_reviewer(p_by);
  if p_decision is null or p_decision not in ('confirm', 'reject') then raise exception 'UNKNOWN_DECISION %', p_decision; end if;
  select * into c from product_claims where id = p_claim for update;
  if not found then raise exception 'CLAIM_NOT_FOUND'; end if;
  if c.status <> 'proposed' then raise exception 'NOT_PENDING'; end if;
  if p_decision = 'reject' then
    update product_claims set status = 'rejected', reviewed_at = now() where id = p_claim;
    return jsonb_build_object('ok', true, 'decision', 'reject');
  end if;
  update product_claims set status = 'superseded' where product_id = c.product_id and claim_code = c.claim_code and status = 'approved';
  update product_claims set status = 'approved', approved_by = p_by, approved_at = now(), reviewed_at = now(), expires_at = null where id = p_claim;
  return jsonb_build_object('ok', true, 'decision', 'confirm');
end $$;

create or replace function review_certificate(p_certificate uuid, p_by uuid, p_decision text, p_note text default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c product_certificates%rowtype;
begin
  perform label_reviewer(p_by);
  if p_decision is null or p_decision not in ('confirm', 'reject') then raise exception 'UNKNOWN_DECISION %', p_decision; end if;
  select * into c from product_certificates where id = p_certificate for update;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
  if c.status <> 'proposed' then raise exception 'NOT_PENDING'; end if;
  if p_decision = 'reject' then
    update product_certificates set status = 'rejected' where id = p_certificate;
    return jsonb_build_object('ok', true, 'decision', 'reject');
  end if;
  update product_certificates set status = 'approved', approved_by = p_by, approved_at = now() where id = p_certificate;
  return jsonb_build_object('ok', true, 'decision', 'confirm');
end $$;

-- ---------- 6 ----------
-- What waits for a person, in the order of one sitting. Pure web and Open Food Facts proposals are not here: the label replaces them
-- (label_reading_settle), and nobody approves them by hand. A row whose label reading disagreed with a web source says so (disagrees).
create or replace function approval_queue(p_limit int default 400) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with rows as (
    select case a.kind when 'allergen' then 1 when 'diet' then 2 else 5 end as grp, 'fact'::text as kind, f.id, f.product_id, f.attribute as label,
           case when a.kind in ('allergen', 'diet') then f.value when a.kind = 'ingredients' then f.detail->>'text'
                else (select string_agg(k || ' ' || v, ', ' order by k) from jsonb_each_text(coalesce(f.detail->'values', '{}'::jsonb)) x(k, v)) end as value_text,
           f.detail->>'quote' as quote, f.source::text as source, f.detail->'disagrees_with' as disagrees, f.proposed_at
      from product_facts f join food_attributes a on a.code = f.attribute
     where f.approved_at is null and f.superseded_at is null and f.status <> 'unknown' and f.source not in ('open_food_facts', 'web_page')
    union all
    select case when v.field_key in ('hazard_warnings', 'pictograms', 'keep_from_children', 'warnings_as_printed') then 3 else 5 end, 'field', v.id, v.product_id, v.field_key,
           case when jsonb_typeof(v.value) = 'array' then (select string_agg(e, '; ') from jsonb_array_elements_text(v.value) e) else v.value #>> '{}' end,
           null, v.source, v.detail->'disagrees_with', v.proposed_at
      from product_field_values v
     where v.status = 'proposed' and v.source in ('label_photo', 'supplier_sheet', 'person')
    union all
    select 5, 'claim', c.id, c.product_id, c.claim_code, coalesce(c.value, c.quote), c.quote, c.source, null, c.proposed_at
      from product_claims c where c.status = 'proposed' and c.source in ('label_photo', 'person')
    union all
    select 2, 'certificate', ce.id, ce.product_id, ce.kind, coalesce(ce.reference, ce.issuer, ''), null, 'certificate', null, ce.proposed_at
      from product_certificates ce where ce.status = 'proposed' and ce.product_id is not null),
  graded as (
    select r.*, case when r.grp in (1, 2, 3) then r.grp when jsonb_array_length(coalesce(r.disagrees, '[]'::jsonb)) > 0 then 4 else r.grp end as g
      from rows r),
  shown as (
    select g.*, p.sku, p.name_en, p.name_ar, coalesce(cc.name_en, p.category, '') as aisle, coalesce(cc.sort_order, 1000000) as sort_order,
           jsonb_build_object('front', (select c.media_path from label_captures c where c.product_id = g.product_id and c.shot = 'front' and c.superseded_at is null),
                              'back',  (select c.media_path from label_captures c where c.product_id = g.product_id and c.shot = 'back'  and c.superseded_at is null),
                              'side',  (select c.media_path from label_captures c where c.product_id = g.product_id and c.shot = 'side'  and c.superseded_at is null)) as photos
      from graded g join products p on p.id = g.product_id
      left join catalog_placements pl on pl.sku = p.sku left join catalog_categories cc on cc.code = pl.category_code)
  select coalesce(jsonb_agg(jsonb_build_object(
           'group', s.g, 'group_name', case s.g when 1 then 'Allergens' when 2 then 'Halal, diet labels and certificates' when 3 then 'Hazard and printed warnings'
                                               when 4 then 'Disagreements between sources' else 'The rest of the label readings' end,
           'kind', s.kind, 'id', s.id, 'product_id', s.product_id, 'sku', s.sku, 'name_en', s.name_en, 'name_ar', s.name_ar, 'aisle', s.aisle,
           'label', s.label, 'value_text', coalesce(s.value_text, ''), 'quote', s.quote, 'source', s.source, 'disagrees', s.disagrees, 'photos', s.photos)
         order by s.g, s.sort_order, s.aisle, s.name_en, s.label, s.id), '[]'::jsonb)
    from (select * from shown order by g, sort_order, aisle, name_en, label, id limit greatest(p_limit, 1)) s $$;

-- ---------- 7 ----------
-- The label day in numbers, from the database. Reasons: not_photographed, photos_not_read, reading_failed, waiting_for_a_person (a missing
-- field has a proposal waiting), sellable_data_missing (only core item data, not the label, is missing), not_on_the_label_read (nothing
-- proposed for a field: it was not printed on what was photographed, or not read).
create or replace function label_day_report() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with items as (
    select s.*, product_template(s.product_id) as template, product_template_status(s.product_id) as st,
           exists (select 1 from label_scans l where l.product_id = s.product_id) as tried,
           exists (select 1 from label_scans l where l.product_id = s.product_id and l.read_by = 'model' and l.reading is not null) as read_ok,
           (select count(*) from product_facts f where f.product_id = s.product_id and f.source = 'label' and f.superseded_at is null and f.status <> 'unknown')
           + (select count(*) from product_field_values v where v.product_id = s.product_id and v.source = 'label_photo' and v.status in ('proposed', 'approved'))
           + (select count(*) from product_claims c where c.product_id = s.product_id and c.source = 'label_photo' and c.status in ('proposed', 'approved')) as filled
      from label_capture_status s),
  graded as (
    select i.*, (i.st->>'sellable')::boolean as sellable, (i.st->>'fact_complete')::boolean as fact_complete,
           (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_array_elements_text((i.st->'missing_sellable') || (i.st->'missing_fact_complete')) k) as missing,
           (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_array_elements_text((i.st->'missing_sellable') || (i.st->'missing_fact_complete')) k
             where (k = 'allergens' and exists (select 1 from product_facts f join food_attributes a on a.code = f.attribute and a.kind = 'allergen'
                                                 where f.product_id = i.product_id and f.approved_at is null and f.superseded_at is null and f.status <> 'unknown'))
                or (k in ('ingredients', 'nutrition') and exists (select 1 from product_facts f where f.product_id = i.product_id and f.attribute = k
                                                                    and f.approved_at is null and f.superseded_at is null and f.status <> 'unknown'))
                or exists (select 1 from product_field_values v where v.product_id = i.product_id and v.field_key = k and v.status = 'proposed')) as waiting
      from items i),
  why as (
    select g.*, case when g.fact_complete then null when not g.done then 'not_photographed' when not g.tried then 'photos_not_read' when not g.read_ok then 'reading_failed'
                     when jsonb_array_length(g.waiting) > 0 then 'waiting_for_a_person'
                     when not exists (select 1 from jsonb_array_elements_text(g.missing) k where k not in ('name_en', 'name_ar', 'price_usd', 'sell_unit', 'category', 'storage_zone'))
                       then 'sellable_data_missing' else 'not_on_the_label_read' end as reason_code
      from graded g)
  select jsonb_build_object(
    'items', (select count(*) from why), 'photographed', (select count(*) from why where done), 'not_photographed', (select count(*) from why where not done),
    'read', (select count(*) from why where read_ok), 'sellable', (select count(*) from why where sellable), 'fact_complete', (select count(*) from why where fact_complete),
    'per_template', (select coalesce(jsonb_agg(jsonb_build_object('template', t.template, 'items', t.n, 'photographed', t.ph, 'read', t.rd, 'fields_filled', t.ff,
                       'sellable', t.sl, 'fact_complete', t.fc) order by t.template), '[]'::jsonb)
                       from (select template, count(*)::int as n, (count(*) filter (where done))::int as ph, (count(*) filter (where read_ok))::int as rd, sum(filled)::int as ff,
                                    (count(*) filter (where sellable))::int as sl, (count(*) filter (where fact_complete))::int as fc from why group by template) t),
    'not_fact_complete', (select coalesce(jsonb_agg(jsonb_build_object('sku', w.sku, 'name_en', w.name_en, 'template', w.template, 'aisle', w.aisle, 'reason_code', w.reason_code,
                       'reason', case w.reason_code
                         when 'not_photographed' then 'front and back are not both photographed'
                         when 'photos_not_read' then 'photographed, not read yet'
                         when 'reading_failed' then 'the reading failed: photograph again or type the fields from the pack'
                         when 'waiting_for_a_person' then 'read; waiting for a person: ' || (select string_agg(k, ', ') from jsonb_array_elements_text(w.waiting) k)
                         when 'sellable_data_missing' then 'read; the item data is missing: ' || (select string_agg(k, ', ') from jsonb_array_elements_text(w.missing) k)
                         else 'read; not printed on the photos or not read: ' || (select string_agg(k, ', ') from jsonb_array_elements_text(w.missing) k) end,
                       'missing', w.missing, 'waiting', w.waiting) order by w.sort_order, w.aisle, w.name_en), '[]'::jsonb)
                          from why w where not w.fact_complete)) $$;

-- ---------- access ----------
do $$ declare r text; begin
  alter table label_captures enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table label_captures from %I', r);
      execute format('revoke all on table label_capture_status from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table label_captures to service_role;
    grant select on table label_capture_status to service_role;
  end if;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
