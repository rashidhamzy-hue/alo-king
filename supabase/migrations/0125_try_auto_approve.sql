-- Alo King Chouf, session I1: try_auto_approve(kind, proposal), the one function that reads auto_approval_rules (0124).
--
--   try_auto_approve('picture', product_images.id)
--   try_auto_approve('name', product_name_proposals.id)
--   try_auto_approve('search_words', sku)
--   try_auto_approve('fact', product_facts.id)          only an ingredient list or a nutrition panel read from the intake label photo
--   anything else (an allergen or diet fact, 'price', 'cost', any other word)  ->  { approved: false, reason: 'never_automatic' }
--
-- Each kind has a check function that returns every check it ran by name, true or false, and the list of those that failed.
-- A missing value is a failed check (unknown is never safe). When every check passes:
--   rule on   the approval is made the way a person's is (same columns, same effects: an approved picture is picked up by A5's
--             catalog_public_expected() and copied to the public bucket by the Worker; an approved name re-queues the search
--             words through 0076's trigger), with the rule party as the approver, and logged in auto_approvals (applied = true);
--   rule off  nothing changes; what the rule would have approved is logged (applied = false) for the spot check that can
--             switch it on (0126).

-- A barcode as code compares it: digits only, without leading zeros. Null when it is too short to be a product number, or is
-- a store's own 2xx code (0073): the same number is another item in another shop, so it proves nothing.
create or replace function intake_barcode_key(p_code text) returns text language sql immutable set search_path = public, pg_temp as $$
  select case when d is null or length(d) < 8 or product_data_is_internal_code(d) then null else nullif(ltrim(d, '0'), '') end
    from (select nullif(regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g'), '') as d) x $$;

-- Open Food Facts files a product's pictures under its barcode split into folders: /images/products/800/150/000/5554/1.400.jpg
create or replace function off_barcode_of_url(p_url text) returns text language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(substring(coalesce(p_url, '') from '^https://images\.openfoodfacts\.org/images/products/([0-9/]+)/[^/]+$'), '/', '', 'g') $$;

-- A pack size as code compares it: "1 L", "1000ml" and "1 litre" are all 1000ml; "6x330ml" and "330 ML X6" are 330mlx6.
create or replace function intake_size_key(p_size text) returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := lower(replace(coalesce(p_size, ''), ',', '.')); m text[]; n numeric; u text; k text;
begin
  if btrim(s) = '' then return null; end if;
  m := regexp_match(s, '([0-9]+(?:\.[0-9]+)?)\s*(kgs|kg|grams|gram|grs|gr|gm|g|mg|litres|liters|litre|liter|ltr|lt|l|ml|cl)\y');
  if m is null then return null; end if;
  n := m[1]::numeric; u := m[2];
  if u in ('kgs', 'kg') then n := n * 1000; u := 'g';
  elsif u in ('grams', 'gram', 'grs', 'gr', 'gm', 'g') then u := 'g';
  elsif u = 'mg' then n := n / 1000; u := 'g';
  elsif u in ('litres', 'liters', 'litre', 'liter', 'ltr', 'lt', 'l') then n := n * 1000; u := 'ml';
  elsif u = 'cl' then n := n * 10; u := 'ml';
  end if;
  k := coalesce((regexp_match(s, '([0-9]+)\s*[x×]\s*[0-9]'))[1], (regexp_match(s, '[x×]\s*([0-9]+)\s*(?:pcs|pack|pieces)?\s*$'))[1]);
  return trim_scale(n)::text || u || coalesce('x' || ltrim(k, '0'), '');
end $$;

-- Text as code compares it: case, spacing and punctuation do not count.
create or replace function intake_text_key(p_text text) returns text language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]ء-ي]+', '', 'g') $$;

create or replace function intake_brand_agrees(p_a text, p_b text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select a <> '' and b <> '' and (position(a in b) > 0 or position(b in a) > 0)
    from (select intake_text_key(p_a) as a, intake_text_key(p_b) as b) x $$;

-- Is this page on the brand's own site? Only hosts a person listed (settings.auto_approval.brand_hosts).
create or replace function auto_brand_host_ok(p_brand text, p_url text) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(bool_or(h.host = x.host or x.host like '%.' || h.host), false)
    from (select lower(substring(coalesce(p_url, '') from '^https://([^/:?#]+)')) as host) x
    cross join lateral jsonb_array_elements_text(coalesce(setting('auto_approval')->'brand_hosts'->lower(btrim(coalesce(p_brand, ''))), '[]'::jsonb)) h(host)
   where x.host is not null $$;

-- The verdict: every check by name, failed = those not exactly true (a null is a fail).
create or replace function auto_verdict(p_checks jsonb, p_product uuid, p_proposal text, p_detail jsonb default '{}') returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ok', not exists (select 1 from jsonb_each(p_checks) e where e.value is distinct from 'true'::jsonb),
    'failed', coalesce((select jsonb_agg(e.key order by e.key) from jsonb_each(p_checks) e where e.value is distinct from 'true'::jsonb), '[]'::jsonb),
    'checks', p_checks, 'product_id', p_product, 'proposal_id', p_proposal, 'detail', coalesce(p_detail, '{}'::jsonb)) $$;

-- Picture: barcode exact match, every vision rule a clear answer, a source a customer may see that is not a shop's page.
create or replace function auto_check_picture(p_image uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare i product_images%rowtype; p products%rowtype; r jsonb; v_key text; v_ev text; v_width int;
begin
  select * into i from product_images where id = p_image;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  select * into p from products where id = i.product_id;
  r := case when jsonb_typeof(i.vision->'report') = 'object' then i.vision->'report' else '{}'::jsonb end;
  v_key := intake_barcode_key(p.barcode);
  v_ev := intake_barcode_key(case when i.source_kind = 'open_food_facts' then off_barcode_of_url(i.source_url)
                                  else coalesce(i.vision->>'barcode', i.vision->'matched'->>'barcode') end);
  v_width := case when jsonb_typeof(i.vision->'original_width') = 'number' then (i.vision->>'original_width')::numeric::int else i.width_px end;
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', i.status = 'proposed',
    'item_active', p.is_active,
    'source_is_open_food_facts_brand_or_own_photo', i.source_kind in ('open_food_facts', 'brand_site', 'intake_photo'),
    'not_a_shop_page', i.source_kind <> 'public_page',
    'licence_customer_may_see', product_image_licence_usable(i.licence),
    'same_brand', r->>'same_brand' = 'yes', 'same_product', r->>'same_product' = 'yes', 'same_size', r->>'same_size' = 'yes',
    'one_pack', r->>'one_pack' = 'yes', 'plain_background', r->>'plain_background' = 'yes',
    'no_watermark_or_text', r->>'watermark_or_overlay_text' = 'no', 'no_price_or_shop_logo', r->>'price_tag_or_shop_logo' = 'no',
    'at_least_800_px', v_width >= 800,
    'item_has_a_product_barcode', v_key is not null,
    'barcode_exact_match', v_key is not null and v_ev = v_key),
    p.id, i.id::text, jsonb_build_object('source_kind', i.source_kind, 'evidence_barcode', v_ev, 'sku', p.sku));
end $$;

-- Who says what an item is, with a barcode code can trust: the intake label photo (the label reader read the digits off our pack)
-- and Open Food Facts (looked up by that barcode). A research file's "matched" block is not a source here: the model was given
-- the barcode, so its barcode is its own claim, which no code can check.
create or replace function auto_identity_sources(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    (select jsonb_build_object('source', 'label_photo', 'ref', s.id, 'brand', s.reading->>'brand', 'size', s.reading->>'size',
              'barcode', intake_barcode_key(s.reading->>'barcode')) as x
       from label_scans s where s.product_id = p_product and jsonb_typeof(s.reading) = 'object' order by s.created_at desc limit 1)
    union all
    (select jsonb_build_object('source', 'open_food_facts', 'ref', f.id, 'brand', f.detail->'off'->>'brands', 'size', f.detail->'off'->>'quantity',
              'barcode', intake_barcode_key(f.detail->>'off_code'))
       from product_facts f where f.product_id = p_product and f.source = 'open_food_facts' and jsonb_typeof(f.detail->'off') = 'object'
      order by f.proposed_at desc limit 1)) q $$;

-- Names and size: barcode exact match and two independent sources agree with the proposal on brand and size.
create or replace function auto_check_name(p_proposal uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare n product_name_proposals%rowtype; p products%rowtype; v_key text; v_size text; s jsonb; v_agree text[] := '{}'; v_reader boolean;
begin
  select * into n from product_name_proposals where id = p_proposal;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  select * into p from products where sku = n.sku;
  if not found then return jsonb_build_object('ok', false, 'failed', '["item_not_in_catalog"]'::jsonb); end if;
  v_key := intake_barcode_key(p.barcode);
  v_size := intake_size_key(n.size_en);
  v_reader := coalesce((setting('auto_approval')->'arabic_reader'->>'passed')::boolean, false);
  for s in select * from jsonb_array_elements(auto_identity_sources(p.id)) loop
    if v_key is not null and s->>'barcode' = v_key and intake_brand_agrees(s->>'brand', p.brand)
       and v_size is not null and intake_size_key(s->>'size') = v_size and not (s->>'source' = any(v_agree)) then
      v_agree := v_agree || (s->>'source');
    end if;
  end loop;
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', n.status = 'proposed',
    'item_active', p.is_active,
    'name_unchanged_since_proposal', p.name_en = n.current_name_en and p.name_ar is not distinct from n.current_name_ar,
    'arabic_from_catalog_or_reader_passed', n.ar_source = 'catalog' or n.name_ar is null or v_reader,
    'no_words_added_by_the_generator', coalesce(array_length(n.added_words, 1), 0) = 0,
    'item_has_a_product_barcode', v_key is not null,
    'proposal_states_a_size', v_size is not null,
    'two_independent_sources_agree', coalesce(array_length(v_agree, 1), 0) >= 2),
    p.id, n.id::text, jsonb_build_object('sources_agreeing', to_jsonb(v_agree), 'size_key', v_size, 'sku', p.sku, 'ar_source', n.ar_source));
end $$;

-- Search words: built for the item's current name, every test phrasing resolved (0076's job ended 'done'), nothing open.
create or replace function auto_check_search_words(p_sku text) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare p products%rowtype; j search_word_jobs%rowtype; st search_word_state%rowtype;
begin
  select * into p from products where sku = p_sku;
  if not found then return jsonb_build_object('ok', false, 'failed', '["item_not_in_catalog"]'::jsonb); end if;
  select * into j from search_word_jobs where sku = p_sku;
  select * into st from search_word_state where sku = p_sku;
  return auto_verdict(jsonb_build_object(
    'item_active', p.is_active,
    'words_built', exists (select 1 from language_pack lp where lp.sku = p_sku and lp.level <> 'brand'),
    'built_for_the_current_name', st.sku is not null and st.name_key = product_name_key(p),
    'phrasing_tests_passed', j.sku is null or j.status = 'done',
    'nothing_on_the_review_list', not exists (select 1 from search_word_reviews r where r.sku = p_sku and r.status = 'open')),
    p.id, p_sku || '@' || coalesce(st.version, '') || '@' || coalesce(to_char(st.built_at, 'YYYYMMDDHH24MISSUS'), 'none'),
    jsonb_build_object('sku', p_sku, 'job', j.status));
end $$;

-- Two readings of an ingredient list or a nutrition panel that say the same thing, strictly.
create or replace function auto_fact_same(p_attribute text, p_a jsonb, p_b jsonb) returns boolean language plpgsql stable set search_path = public, pg_temp as $$
declare ka text; kb text; k text;
begin
  if p_attribute = 'ingredients' then
    if coalesce(p_a->>'lang', '') <> '' and coalesce(p_b->>'lang', '') <> '' and p_a->>'lang' <> p_b->>'lang' then return false; end if;
    ka := intake_text_key(coalesce(p_a->>'text', p_a->>'source_text')); kb := intake_text_key(coalesce(p_b->>'text', p_b->>'source_text'));
    return ka <> '' and ka = kb;
  elsif p_attribute = 'nutrition' then
    if coalesce(p_a->>'per', '100g') <> '100g' or coalesce(p_b->>'per', '100g') <> '100g' then return false; end if;
    foreach k in array array['energy_kcal', 'fat', 'carbohydrates', 'proteins'] loop
      if jsonb_typeof(p_a->'values'->k) is distinct from 'number' or jsonb_typeof(p_b->'values'->k) is distinct from 'number' then return false; end if;
    end loop;
    return fact_agree('nutrition', null, p_a, null, p_b);
  end if;
  return false;
end $$;

-- Ingredients and nutrition: the label reader's reading of the intake photo (its barcode matches the item's) and a second source
-- for that barcode (Open Food Facts, or the brand's own page with an exact match) say the same. A web page of a shop does not count.
create or replace function auto_check_fact(p_fact uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare f product_facts%rowtype; p products%rowtype; v_key text; v_scan text; s product_facts%rowtype; v_second jsonb; v_bc boolean;
begin
  select * into f from product_facts where id = p_fact;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  if f.attribute not in ('ingredients', 'nutrition') then return jsonb_build_object('ok', false, 'failed', '["never_automatic"]'::jsonb); end if;
  select * into p from products where id = f.product_id;
  v_key := intake_barcode_key(p.barcode);
  if coalesce(f.detail->>'scan_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select intake_barcode_key(ls.reading->>'barcode') into v_scan from label_scans ls where ls.id = (f.detail->>'scan_id')::uuid and ls.product_id = f.product_id;
  end if;
  for s in select * from product_facts x where x.product_id = f.product_id and x.attribute = f.attribute and x.superseded_at is null
              and x.approved_at is null and x.source in ('open_food_facts', 'web_page') order by x.proposed_at desc loop
    v_bc := case s.source when 'open_food_facts' then intake_barcode_key(s.detail->>'off_code') = v_key
              else intake_barcode_key(s.detail->'matched'->>'barcode') = v_key and s.detail->'matched'->>'confidence' = 'exact'
                   and auto_brand_host_ok(p.brand, s.detail->>'page_url') end;
    if coalesce(v_bc, false) and auto_fact_same(f.attribute, f.detail, s.detail) then
      v_second := jsonb_build_object('fact_id', s.id, 'source', s.source, 'page_url', s.detail->>'page_url'); exit;
    end if;
  end loop;
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', f.approved_at is null and f.superseded_at is null and f.status = 'partial',
    'read_from_the_intake_label_photo', f.source = 'label' and f.detail->>'read_by' = 'model' and f.evidence_id is not null,
    'item_active', p.is_active,
    'item_has_a_product_barcode', v_key is not null,
    'label_photo_barcode_matches', v_key is not null and v_scan = v_key,
    'nothing_approved_for_this_field_yet', not exists (select 1 from product_facts a where a.product_id = f.product_id and a.attribute = f.attribute
                                                          and a.approved_at is not null and a.superseded_at is null),
    'second_source_for_the_barcode_agrees', v_second is not null),
    p.id, f.id::text, jsonb_build_object('attribute', f.attribute, 'second_source', v_second, 'sku', p.sku));
end $$;

-- The approvals themselves, made as a person's are, with the rule party as approver. Each returns null when the proposal is no
-- longer waiting (a person decided first).
create or replace function auto_apply_picture(p_image uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare i product_images%rowtype; v_old uuid;
begin
  select * into i from product_images where id = p_image for update;
  if not found or i.status <> 'proposed' then return null; end if;
  select id into v_old from product_images where product_id = i.product_id and status = 'approved' for update;
  if v_old is not null then update product_images set status = 'superseded' where id = v_old; end if;
  update product_images set status = 'approved', reviewed_by = auto_approval_party(), reviewed_at = now(), review_note = 'automatic: rule picture' where id = i.id;
  return jsonb_build_object('image_id', i.id, 'replaced', v_old);
end $$;

create or replace function auto_apply_name(p_proposal uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare n product_name_proposals%rowtype; p products%rowtype; v_en text; v_ar text;
begin
  select * into n from product_name_proposals where id = p_proposal for update;
  if not found or n.status <> 'proposed' then return null; end if;
  select * into p from products where sku = n.sku for update;
  if not found then return null; end if;
  v_en := btrim(n.name_en || case when n.size_en is not null then ' ' || n.size_en else '' end);
  v_ar := case when n.name_ar is null then p.name_ar else btrim(n.name_ar || case when n.size_ar is not null then ' ' || n.size_ar else '' end) end;
  update products set name_en = v_en, name_ar = v_ar where id = p.id;
  update product_name_proposals set status = 'approved', decided_by = auto_approval_party(), decided_at = now(), review_note = 'automatic: rule name_size_category',
         applied_name_en = v_en, applied_name_ar = v_ar, previous_name_en = p.name_en, previous_name_ar = p.name_ar
   where id = n.id;
  return jsonb_build_object('sku', n.sku, 'name_en', v_en, 'name_ar', v_ar, 'previous_name_en', p.name_en);
end $$;

create or replace function auto_apply_fact(p_fact uuid, p_second jsonb) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare f product_facts%rowtype; v_new uuid; v_detail jsonb;
begin
  select * into f from product_facts where id = p_fact for update;
  if not found or f.approved_at is not null or f.superseded_at is not null then return null; end if;
  if f.attribute not in ('ingredients', 'nutrition') then raise exception 'NEVER_AUTOMATIC %', f.attribute; end if;
  v_detail := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(f.detail) x(k, v) where k in ('text', 'values', 'per', 'units', 'ar', 'lang'))
              || jsonb_build_object('confirmed_from', f.id, 'proposal_source', f.source, 'automatic', true, 'second_source', p_second);
  insert into product_facts(product_id, attribute, value, detail, status, source, evidence_id, proposed_by, approved_by, approved_at)
    values (f.product_id, f.attribute, null, v_detail, 'declared', 'label', f.evidence_id, auto_approval_party(), auto_approval_party(), now())
    returning id into v_new;
  update product_facts set superseded_at = now(), superseded_by = v_new where id = f.id;
  return jsonb_build_object('fact_id', v_new, 'attribute', f.attribute);
end $$;

create or replace function try_auto_approve(p_kind text, p_proposal text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_field text; v_rule auto_approval_rules%rowtype; v jsonb; v_attr text; v_applied jsonb; v_id uuid;
        v_uuid boolean := coalesce(p_proposal, '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Only the four fields of the table. Allergens, diet labels, prices, costs and anything else: never.
  v_field := case p_kind when 'picture' then 'picture' when 'name' then 'name_size_category' when 'search_words' then 'search_words'
                         when 'fact' then 'ingredients_nutrition' end;
  if v_field is null then return jsonb_build_object('approved', false, 'reason', 'never_automatic', 'kind', p_kind); end if;
  if p_kind <> 'search_words' and not v_uuid then return jsonb_build_object('approved', false, 'reason', 'not_found', 'kind', p_kind); end if;
  if p_kind = 'fact' then
    select attribute into v_attr from product_facts where id = p_proposal::uuid;
    if v_attr is null then return jsonb_build_object('approved', false, 'reason', 'not_found', 'kind', p_kind); end if;
    if v_attr not in ('ingredients', 'nutrition') then return jsonb_build_object('approved', false, 'reason', 'never_automatic', 'kind', p_kind, 'attribute', v_attr); end if;
  end if;
  select * into v_rule from auto_approval_rules where field = v_field;
  if not found then return jsonb_build_object('approved', false, 'reason', 'never_automatic', 'kind', p_kind); end if;

  v := case p_kind when 'picture' then auto_check_picture(p_proposal::uuid) when 'name' then auto_check_name(p_proposal::uuid)
                   when 'search_words' then auto_check_search_words(p_proposal) else auto_check_fact(p_proposal::uuid) end;
  if not coalesce((v->>'ok')::boolean, false) then
    return jsonb_build_object('approved', false, 'reason', 'checks_failed', 'field', v_field, 'failed', v->'failed', 'checks', v->'checks');
  end if;

  if not v_rule.enabled then
    insert into auto_approvals(field, kind, proposal_id, product_id, applied, checks, result)
      values (v_field, p_kind, v->>'proposal_id', (v->>'product_id')::uuid, false, v->'checks', jsonb_build_object('detail', v->'detail'))
      on conflict (kind, proposal_id, applied) do nothing;
    return jsonb_build_object('approved', false, 'shadow', true, 'reason', 'rule_off_logged_for_the_spot_check', 'field', v_field);
  end if;

  v_applied := case p_kind when 'picture' then auto_apply_picture(p_proposal::uuid) when 'name' then auto_apply_name(p_proposal::uuid)
                           when 'search_words' then jsonb_build_object('sku', p_proposal, 'words', 'already_live')
                           else auto_apply_fact(p_proposal::uuid, v->'detail'->'second_source') end;
  if v_applied is null then return jsonb_build_object('approved', false, 'reason', 'not_waiting_any_more', 'field', v_field); end if;
  insert into auto_approvals(field, kind, proposal_id, product_id, applied, checks, result)
    values (v_field, p_kind, v->>'proposal_id', (v->>'product_id')::uuid, true, v->'checks', v_applied || jsonb_build_object('detail', v->'detail'))
    on conflict (kind, proposal_id, applied) do nothing
    returning id into v_id;
  return jsonb_build_object('approved', v_id is not null, 'already', v_id is null, 'field', v_field, 'approval_id', v_id, 'result', v_applied);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
