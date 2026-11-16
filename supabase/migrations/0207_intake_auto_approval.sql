-- Alo King Chouf, session PD1, pull request 2, part (d): the intake pipeline of docs/PRODUCT_DATA_STANDARD.md ("How every new item and
-- vendor gets filled") on the existing steps (0122, 0127) and the existing approval rules (0124 to 0126), for every item, current and future.
--
--   1 start        intake_start(): a barcode scan, a supplier line or an unmet-demand row (0022) becomes a new item, inactive, with its
--                  template from the category, and its intake jobs (enqueue_product_intake, 0122)
--   2 lookup       the barcode lookup (Open Food Facts, 0073; retailer and brand pages, 0071 and 0123): proposals, as today
--   3 read the pack record_label_scan() now reads into the template's own fields: food facts for a food item only; for a cleaning
--                  product its hazard warnings and active ingredient; for beauty the ingredient list and the age; for baby the age range;
--                  for a pet food the species and life stage; printed claims for any item (product_field_values, product_claims)
--   4 compare      sources that agree are approved by the rules below; sources that disagree always go to a person
--   5 propose      names, kind, tags, search words (0110, 0076; tags and kind by rules here)
--   6 approve      automatic where a rule allows, a person for everything else
--   7 re-check     facts expire after 12 months without a re-check (0204, 0206); facts_due_for_recheck() lists them
--
-- New rows in auto_approval_rules (the table now takes them):
--   two_published_sources   nutrition numbers and ingredients go live when two independent published sources for the same market,
--                           each tied to the item's barcode, agree exactly. The coordinator's rule of 16 November: ON, one row the
--                           founder can switch off (set_auto_approval_rule, 0126)
--   printed_claims          a printed claim read from the intake label photo (its barcode matches) or the brand's own page; never one
--                           that sounds medical. OFF until its spot check passes, like every rule of 0124
--   rule_fields             kind, tags, storage and search words proposed by rules: ON (deterministic rules, not a model's reading)
-- Always a person, enforced here in SQL and never in a prompt: allergens and diet labels (0124's lock 3 stays), halal and every
-- certificate (0204), hazard warnings and every field whose template says "person" (below), a claim that sounds medical (0204), and any
-- field where the sources disagree (below). The automatic party is refused by triggers, whatever function calls them.

-- ---------- the rules table takes the new rows ----------
alter table auto_approval_rules drop constraint if exists auto_approval_rules_field_check;
alter table auto_approval_rules add constraint auto_approval_rules_field_check
  check (field in ('picture', 'name_size_category', 'search_words', 'ingredients_nutrition', 'two_published_sources', 'printed_claims', 'rule_fields'));
alter table auto_approvals drop constraint if exists auto_approvals_kind_check;
alter table auto_approvals add constraint auto_approvals_kind_check check (kind in ('picture', 'name', 'search_words', 'fact', 'fact_web', 'claim', 'field'));
alter table auto_approvals drop constraint if exists auto_approvals_check;
alter table auto_approvals add constraint auto_approvals_check check ((field, kind) in (('picture', 'picture'), ('name_size_category', 'name'),
  ('search_words', 'search_words'), ('ingredients_nutrition', 'fact'), ('two_published_sources', 'fact_web'), ('printed_claims', 'claim'), ('rule_fields', 'field')));

insert into auto_approval_rules(field, enabled, first_passed_at, changed_at, checks) values
  ('two_published_sources', true, now(), now(), 'Coordinator''s rule of 16 November (docs/DECISIONS.md, decision 6), on until the founder switches it off: nutrition numbers or the ingredient list, proposed from a published source tied to the item''s barcode (Open Food Facts, or a page whose barcode matched exactly), and a second, independent published source (another host) for the same market and the same barcode, say exactly the same: the same ingredient list letter for letter, or the same energy, fat, carbohydrate and protein per 100 g. A label reading that disagrees, or any third source that disagrees, sends it to a person. Never allergens, diet labels or claims.'),
  ('printed_claims', false, null, null, 'A printed claim ("no added sugar", "fragrance-free") read from the intake label photo whose barcode matches the item, or quoted from the brand''s own page (a host a person listed). Never a claim that sounds medical; never a claim from a shop''s page, Open Food Facts or a research file.'),
  ('rule_fields', true, now(), now(), 'Fields a deterministic rule proposed (kind, storage, tags, search words), for a field whose template says automatic, when no other source disagrees.')
on conflict (field) do nothing;

-- ---------- always a person, in SQL ----------
create or replace function field_values_person_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_t text; v_approval text;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then return new; end if;
  if new.approved_at is null then new.approved_at := now(); end if;
  if new.approved_by is distinct from auto_approval_party() then return new; end if;
  v_t := product_template(new.product_id);
  select tf.approval into v_approval from template_fields tf
   where tf.key = new.field_key and (tf.template_code = v_t or tf.template_code = 'core') order by (tf.template_code = v_t) desc limit 1;
  if v_approval is distinct from 'automatic' then
    raise exception 'NEVER_AUTOMATIC: % needs a person (template %)', new.field_key, v_t;
  end if;
  if exists (select 1 from product_field_values o where o.product_id = new.product_id and o.field_key = new.field_key and o.id <> new.id
               and o.status in ('proposed', 'approved') and o.value is distinct from new.value) then
    raise exception 'SOURCES_DISAGREE: % has another reading; a person decides', new.field_key;
  end if;
  return new;
end $$;
create trigger product_field_values_person before insert or update on product_field_values for each row execute function field_values_person_rules();

-- A fact the automatic party approves: no open proposal for the same field may say otherwise (label, web or any other source).
create or replace function auto_facts_no_disagreement() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.approved_by is distinct from auto_approval_party() or new.approved_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.approved_at is not null then return new; end if;
  if exists (select 1 from product_facts o where o.product_id = new.product_id and o.attribute = new.attribute and o.id <> new.id
               and o.approved_at is null and o.superseded_at is null and o.status <> 'unknown'
               and o.id is distinct from (new.detail->>'confirmed_from')::uuid
               and not (o.id::text = any(array(select jsonb_array_elements_text(coalesce(new.detail->'agreeing', '[]'::jsonb)))))
               and not auto_fact_same(new.attribute, new.detail, o.detail)) then
    raise exception 'SOURCES_DISAGREE: another source says otherwise about %; a person decides', new.attribute;
  end if;
  return new;
end $$;
-- Named to fire after 0124's lock (product_facts_auto_party_only): a never-automatic field is refused as such first.
create trigger product_facts_auto_sources_agree before insert or update on product_facts for each row execute function auto_facts_no_disagreement();

-- ---------- two independent published sources for the same market ----------
-- What the rule approves is a new record with its own source, 'published_sources': a web page or Open Food Facts alone stays never
-- approved (0071, 0073); the two proposals it rests on are kept, superseded by it, and named in its detail.
alter table product_facts drop constraint product_facts_source_check;
alter table product_facts add constraint product_facts_source_check
  check (source in ('label', 'supplier', 'certificate', 'lab', 'calculation', 'merchant', 'open_food_facts', 'staff', 'web_page', 'published_sources'));
alter table product_facts add constraint product_facts_published_sources_by_the_rule
  check (source <> 'published_sources' or (approved_by = '00000000-0000-4000-8000-0000000000a1' and attribute in ('ingredients', 'nutrition')));

-- Exactly the same: the ingredient list letter for letter (case, spaces and punctuation aside), or the same per-100 g energy, fat,
-- carbohydrate and protein (and the same sugars and salt where both give them).
create or replace function facts_exactly_same(p_attribute text, p_a jsonb, p_b jsonb) returns boolean language plpgsql stable set search_path = public, pg_temp as $$
declare k text;
begin
  if p_attribute = 'ingredients' then
    return intake_text_key(coalesce(p_a->>'text', p_a->>'source_text')) <> ''
       and intake_text_key(coalesce(p_a->>'text', p_a->>'source_text')) = intake_text_key(coalesce(p_b->>'text', p_b->>'source_text'));
  elsif p_attribute = 'nutrition' then
    if coalesce(p_a->>'per', '100g') <> coalesce(p_b->>'per', '100g') then return false; end if;
    foreach k in array array['energy_kcal', 'fat', 'carbohydrates', 'proteins'] loop
      if json_num(p_a->'values'->k) is null or json_num(p_a->'values'->k) is distinct from json_num(p_b->'values'->k) then return false; end if;
    end loop;
    foreach k in array array['sugars', 'salt', 'saturated_fat', 'fiber'] loop
      if json_num(p_a->'values'->k) is not null and json_num(p_b->'values'->k) is not null and json_num(p_a->'values'->k) <> json_num(p_b->'values'->k) then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

-- Where a published proposal came from (host) and whether it is tied to the item's barcode; its market (a two-letter country).
create or replace function published_source_of(f product_facts, p_key text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case f.source
    when 'open_food_facts' then jsonb_build_object('host', 'openfoodfacts.org', 'tied', intake_barcode_key(f.detail->>'off_code') = p_key,
                                                   'market', lower(nullif(coalesce(f.detail->>'market', f.detail->>'country'), '')))
    when 'web_page' then jsonb_build_object('host', lower(substring(coalesce(f.detail->>'page_url', '') from '^https://(?:www\.)?([^/:?#]+)')),
                                            'tied', intake_barcode_key(f.detail->'matched'->>'barcode') = p_key and f.detail->'matched'->>'confidence' = 'exact',
                                            'market', lower(nullif(coalesce(f.detail->>'market', f.detail->>'country'), '')))
  end $$;

create or replace function auto_check_fact_web(p_fact uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare f product_facts%rowtype; p products%rowtype; v_key text; a jsonb; s product_facts%rowtype; b jsonb; v_second jsonb; v_label_disagrees boolean;
begin
  select * into f from product_facts where id = p_fact;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  if f.attribute not in ('ingredients', 'nutrition') then return jsonb_build_object('ok', false, 'failed', '["never_automatic"]'::jsonb); end if;
  select * into p from products where id = f.product_id;
  v_key := intake_barcode_key(p.barcode);
  a := published_source_of(f, v_key);
  for s in select * from product_facts x where x.product_id = f.product_id and x.attribute = f.attribute and x.id <> f.id and x.superseded_at is null
              and x.approved_at is null and x.source in ('open_food_facts', 'web_page') order by x.proposed_at loop
    b := published_source_of(s, v_key);
    if coalesce((b->>'tied')::boolean, false) and b->>'host' is distinct from a->>'host' and b->>'market' is not null and b->>'market' = a->>'market'
       and facts_exactly_same(f.attribute, f.detail, s.detail) then
      v_second := jsonb_build_object('fact_id', s.id, 'source', s.source, 'host', b->>'host'); exit;
    end if;
  end loop;
  v_label_disagrees := exists (select 1 from product_facts l where l.product_id = f.product_id and l.attribute = f.attribute and l.source = 'label'
                                 and l.superseded_at is null and not auto_fact_same(f.attribute, l.detail, f.detail));
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', f.approved_at is null and f.superseded_at is null,
    'item_active', p.is_active,
    'item_has_a_product_barcode', v_key is not null,
    'first_source_tied_to_the_barcode', coalesce((a->>'tied')::boolean, false),
    'first_source_names_its_market', a->>'market' is not null,
    'second_independent_source_same_market_agrees_exactly', v_second is not null,
    'no_label_reading_disagrees', not v_label_disagrees,
    'nothing_approved_for_this_field_yet', not exists (select 1 from product_facts x where x.product_id = f.product_id and x.attribute = f.attribute
                                                          and x.approved_at is not null and x.superseded_at is null)),
    p.id, f.id::text, jsonb_build_object('attribute', f.attribute, 'second_source', v_second, 'sku', p.sku, 'host', a->>'host'));
end $$;

create or replace function auto_apply_fact_web(p_fact uuid, p_second jsonb) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare f product_facts%rowtype; v_new uuid; v_detail jsonb;
begin
  select * into f from product_facts where id = p_fact for update;
  if not found or f.approved_at is not null or f.superseded_at is not null then return null; end if;
  if f.attribute not in ('ingredients', 'nutrition') then raise exception 'NEVER_AUTOMATIC %', f.attribute; end if;
  v_detail := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(f.detail) x(k, v) where k in ('text', 'values', 'per', 'units', 'lang', 'market'))
              || jsonb_build_object('confirmed_from', f.id, 'agreeing', jsonb_build_array(f.id, p_second->>'fact_id'), 'proposal_source', f.source,
                                    'automatic', true, 'rule', 'two_published_sources', 'second_source', p_second);
  insert into product_facts(product_id, attribute, value, detail, status, source, proposed_by, approved_by, approved_at)
    values (f.product_id, f.attribute, null, v_detail, 'declared', 'published_sources', auto_approval_party(), auto_approval_party(), now())
    returning id into v_new;
  update product_facts set superseded_at = now(), superseded_by = v_new where id in (f.id, (p_second->>'fact_id')::uuid);
  return jsonb_build_object('fact_id', v_new, 'attribute', f.attribute);
end $$;

-- ---------- printed claims ----------
create or replace function auto_check_claim(p_claim uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare c product_claims%rowtype; p products%rowtype; cc claim_codes%rowtype; v_key text; v_scan text;
begin
  select * into c from product_claims where id = p_claim;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  select * into p from products where id = c.product_id;
  select * into cc from claim_codes where code = c.claim_code;
  v_key := intake_barcode_key(p.barcode);
  if c.source = 'label_photo' and c.evidence_id is not null then
    select intake_barcode_key(ls.reading->>'barcode') into v_scan from label_scans ls where c.evidence_id = any(ls.evidence_ids) and ls.product_id = c.product_id limit 1;
  end if;
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', c.status = 'proposed',
    'item_active', p.is_active,
    'not_medical', not cc.medical,
    'printed_words_quoted', btrim(c.quote) <> '',
    'from_the_label_photo_with_the_barcode_or_the_brand_page',
      (c.source = 'label_photo' and v_key is not null and v_scan = v_key) or (c.source = 'brand_site' and auto_brand_host_ok(p.brand, c.page_url))),
    p.id, c.id::text, jsonb_build_object('claim', c.claim_code, 'sku', p.sku));
end $$;

-- ---------- fields proposed by rules ----------
create or replace function auto_check_field(p_value uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v product_field_values%rowtype; p products%rowtype; v_t text; v_approval text;
begin
  select * into v from product_field_values where id = p_value;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  select * into p from products where id = v.product_id;
  v_t := product_template(v.product_id);
  select tf.approval into v_approval from template_fields tf where tf.key = v.field_key and (tf.template_code = v_t or tf.template_code = 'core')
   order by (tf.template_code = v_t) desc limit 1;
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', v.status = 'proposed',
    'proposed_by_a_rule', v.source = 'rules',
    'field_is_automatic_in_its_template', v_approval = 'automatic',
    'no_other_source_disagrees', not exists (select 1 from product_field_values o where o.product_id = v.product_id and o.field_key = v.field_key
                                                and o.id <> v.id and o.status in ('proposed', 'approved') and o.value is distinct from v.value)),
    p.id, v.id::text, jsonb_build_object('field', v.field_key, 'sku', p.sku));
end $$;

-- ---------- try_auto_approve (0125) with the new kinds ----------
alter function try_auto_approve(text, text) rename to try_auto_approve_base;
create or replace function try_auto_approve(p_kind text, p_proposal text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_field text; v_rule auto_approval_rules%rowtype; v jsonb; v_applied jsonb; v_id uuid;
begin
  v_field := case p_kind when 'fact_web' then 'two_published_sources' when 'claim' then 'printed_claims' when 'field' then 'rule_fields' end;
  if v_field is null then
    -- 0125's kinds. A source that disagrees with the approval (the trigger above) is a refusal, never an error: a person decides.
    begin
      return try_auto_approve_base(p_kind, p_proposal);
    exception when others then
      if sqlerrm like 'SOURCES_DISAGREE%' then return jsonb_build_object('approved', false, 'reason', 'sources_disagree', 'kind', p_kind); end if;
      raise;
    end;
  end if;
  if coalesce(p_proposal, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('approved', false, 'reason', 'not_found', 'kind', p_kind);
  end if;
  select * into v_rule from auto_approval_rules where field = v_field;
  v := case p_kind when 'fact_web' then auto_check_fact_web(p_proposal::uuid) when 'claim' then auto_check_claim(p_proposal::uuid)
                   else auto_check_field(p_proposal::uuid) end;
  if not coalesce((v->>'ok')::boolean, false) then
    return jsonb_build_object('approved', false, 'reason', 'checks_failed', 'field', v_field, 'failed', v->'failed', 'checks', v->'checks');
  end if;
  if not v_rule.enabled then
    insert into auto_approvals(field, kind, proposal_id, product_id, applied, checks, result)
      values (v_field, p_kind, v->>'proposal_id', (v->>'product_id')::uuid, false, v->'checks', jsonb_build_object('detail', v->'detail'))
      on conflict (kind, proposal_id, applied) do nothing;
    return jsonb_build_object('approved', false, 'shadow', true, 'reason', 'rule_off_logged_for_the_spot_check', 'field', v_field);
  end if;
  if p_kind = 'fact_web' then
    begin
      v_applied := auto_apply_fact_web(p_proposal::uuid, v->'detail'->'second_source');
    exception when others then
      if sqlerrm like 'SOURCES_DISAGREE%' then return jsonb_build_object('approved', false, 'reason', 'sources_disagree', 'field', v_field); end if;
      raise;
    end;
  elsif p_kind = 'claim' then
    update product_claims set status = 'approved', approved_by = auto_approval_party(), approved_at = now(), reviewed_at = now()
     where id = p_proposal::uuid and status = 'proposed' returning jsonb_build_object('claim_id', id) into v_applied;
  else
    update product_field_values set status = 'approved', approved_by = auto_approval_party(), approved_at = now(), reviewed_at = now()
     where id = p_proposal::uuid and status = 'proposed' returning jsonb_build_object('value_id', id) into v_applied;
  end if;
  if v_applied is null then return jsonb_build_object('approved', false, 'reason', 'not_waiting_any_more', 'field', v_field); end if;
  insert into auto_approvals(field, kind, proposal_id, product_id, applied, checks, result)
    values (v_field, p_kind, v->>'proposal_id', (v->>'product_id')::uuid, true, v->'checks', v_applied || jsonb_build_object('detail', v->'detail'))
    on conflict (kind, proposal_id, applied) do nothing returning id into v_id;
  return jsonb_build_object('approved', v_id is not null, 'already', v_id is null, 'field', v_field, 'approval_id', v_id, 'result', v_applied);
end $$;

-- intake_try_auto (0127) also tries the new kinds.
alter function intake_try_auto(uuid) rename to intake_try_auto_base;
create or replace function intake_try_auto(p_product uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_out jsonb := intake_try_auto_base(p_product); x record; r jsonb; k text;
begin
  for x in
    select 'fact_web' as kind, f.id::text as id from product_facts f join products p on p.id = f.product_id
     where f.attribute in ('ingredients', 'nutrition') and f.source in ('open_food_facts', 'web_page') and f.approved_at is null and f.superseded_at is null
       and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
    union all
    select 'claim', c.id::text from product_claims c join products p on p.id = c.product_id
     where c.status = 'proposed' and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
    union all
    select 'field', v.id::text from product_field_values v join products p on p.id = v.product_id
     where v.status = 'proposed' and v.source = 'rules' and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
  loop
    r := try_auto_approve(x.kind, x.id);
    k := x.kind || ':' || case when (r->>'approved')::boolean then 'approved' when (r->>'shadow')::boolean then 'logged_rule_off' else coalesce(r->>'reason', 'no') end;
    v_out := jsonb_set(v_out, array[k], to_jsonb(coalesce((v_out->>k)::int, 0) + 1));
  end loop;
  return v_out;
end $$;

-- ---------- 3: the label read into the template's own fields ----------
-- record_label_scan (0049) keeps its arguments. A reading's food facts are recorded only for a food item; its template fields
-- (reading.fields: {key: value}) become proposals of product_field_values, and its printed claims (reading.claims: [{code, value, quote}])
-- proposals of product_claims, all with the label photo as evidence. A field the template does not have is dropped, not refused.
alter function record_label_scan(uuid, text[], jsonb, text, uuid) rename to record_label_scan_base;
create or replace function record_label_scan(p_product uuid, p_photos text[], p_reading jsonb, p_model text, p_by uuid) returns jsonb language plpgsql as $$
declare v_t text; v_food boolean; v_reading jsonb := p_reading; r jsonb; k text; v jsonb; c jsonb; v_ev uuid; v_fields jsonb := '{}'; v_claims jsonb := '[]';
        v_dropped jsonb := '[]'; v_id uuid;
begin
  v_t := product_template(p_product);
  v_food := coalesce((select is_food from product_templates where code = v_t), false);
  if not v_food and p_reading is not null then
    if jsonb_array_length(coalesce(p_reading->'facts', '[]'::jsonb)) > 0 then
      v_dropped := jsonb_build_array(jsonb_build_object('facts', 'not a food item: food facts do not apply'));
    end if;
    v_reading := p_reading - 'facts';
  end if;
  r := record_label_scan_base(p_product, p_photos, v_reading, p_model, p_by);
  v_ev := (r->'evidence'->>0)::uuid;
  for k, v in select * from jsonb_each(coalesce(p_reading->'fields', '{}'::jsonb)) loop
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then continue; end if;
    if not exists (select 1 from template_fields tf where tf.key = k and tf.store = 'values'
                    and (tf.template_code = v_t or (tf.template_code = 'core' and (select includes_core from product_templates where code = v_t)))) then
      v_dropped := v_dropped || jsonb_build_object('field', k, 'reason', 'not a field of template ' || coalesce(v_t, '?')); continue;
    end if;
    begin
      update product_field_values set status = 'superseded' where product_id = p_product and field_key = k and status = 'proposed' and source = 'label_photo';
      insert into product_field_values(product_id, field_key, value, source, evidence_id, detail, proposed_by)
        values (p_product, k, v, 'label_photo', v_ev, jsonb_build_object('scan_id', r->>'scan_id', 'read_by', 'model', 'model', p_model), p_by) returning id into v_id;
      v_fields := v_fields || jsonb_build_object(k, v_id);
    exception when others then
      v_dropped := v_dropped || jsonb_build_object('field', k, 'reason', sqlerrm);
    end;
  end loop;
  for c in select * from jsonb_array_elements(coalesce(p_reading->'claims', '[]'::jsonb)) loop
    begin
      insert into product_claims(product_id, claim_code, value, quote, source, evidence_id, proposed_by)
        values (p_product, c->>'code', nullif(btrim(c->>'value'), ''), c->>'quote', 'label_photo', v_ev, p_by) returning id into v_id;
      v_claims := v_claims || to_jsonb(v_id);
    exception when others then
      v_dropped := v_dropped || jsonb_build_object('claim', c->>'code', 'reason', sqlerrm);
    end;
  end loop;
  return r || jsonb_build_object('template', v_t, 'fields', v_fields, 'claims', v_claims, 'dropped', coalesce(r->'dropped', '[]'::jsonb) || v_dropped);
end $$;

-- ---------- 1: where an item starts ----------
-- A barcode scan, a supplier invoice line, or a customer request logged as unmet demand becomes a new item, inactive (it goes live only
-- once sellable, 0206), with its intake jobs. Only the ops lead or an admin. The category decides the template; no template, no item.
create or replace function intake_start(p_origin text, p_payload jsonb, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_cat text := nullif(btrim(p_payload->>'category'), ''); v_name text; v_demand demand_signals%rowtype; v_sku text;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_origin not in ('barcode', 'supplier_line', 'demand') then raise exception 'INTAKE_ORIGIN: barcode, supplier_line or demand'; end if;
  if p_origin = 'demand' then
    select * into v_demand from demand_signals where id = (p_payload->>'demand_id')::uuid;
    if not found then raise exception 'DEMAND_NOT_FOUND'; end if;
  end if;
  v_name := coalesce(nullif(btrim(p_payload->>'name_en'), ''), nullif(btrim(p_payload->>'supplier_text'), ''), v_demand.query);
  if v_name is null then raise exception 'INTAKE_NAME: a name, the supplier''s line or the request''s words'; end if;
  if v_cat is null or template_for(v_cat, p_payload->>'sub_type', null) is null then
    raise exception 'TEMPLATE_MISSING: category "%" has no template', coalesce(v_cat, '');
  end if;
  if p_origin = 'barcode' and intake_barcode_key(p_payload->>'barcode') is null then raise exception 'INTAKE_BARCODE: not a product barcode'; end if;
  if p_origin = 'barcode' and exists (select 1 from products where intake_barcode_key(barcode) = intake_barcode_key(p_payload->>'barcode')) then
    raise exception 'INTAKE_DUPLICATE: an item with this barcode exists';
  end if;
  v_sku := 'AK-N' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  insert into products(sku, name_en, name_ar, brand, category, sub_type, sell_unit, barcode, is_active)
    values (v_sku, v_name, nullif(btrim(p_payload->>'name_ar'), ''), nullif(btrim(p_payload->>'brand'), ''), v_cat, nullif(btrim(p_payload->>'sub_type'), ''),
            coalesce(nullif(btrim(p_payload->>'sell_unit'), ''), 'each'), nullif(btrim(p_payload->>'barcode'), ''), false)
    returning id into v_id;
  perform enqueue_product_intake(v_id, 'trigger');
  update product_intake_jobs set result = result || jsonb_build_object('started_from', p_origin, 'demand_id', v_demand.id, 'supplier_text', p_payload->>'supplier_text')
   where product_id = v_id and step = 'new_item';
  return jsonb_build_object('ok', true, 'product_id', v_id, 'sku', v_sku, 'template', product_template(v_id));
end $$;

-- ---------- the console's overview (0127) with the new rows ----------
alter function auto_approvals_overview(int) rename to auto_approvals_overview_base;
create or replace function auto_approvals_overview(p_limit int default 60) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select b || jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(r order by array_position(array['picture', 'name_size_category', 'search_words', 'ingredients_nutrition',
                'two_published_sources', 'printed_claims', 'rule_fields'], r->>'field')), '[]'::jsonb) from jsonb_array_elements(b->'rules') r),
    'never_automatic', '["allergens", "diet labels", "halal and every certificate", "hazard warnings", "claims that sound medical", "fields where sources disagree", "price", "cost"]'::jsonb)
    from (select auto_approvals_overview_base(p_limit) as b) x $$;

-- ---------- 7: re-check ----------
-- Approved facts and field values whose 12 months run out within p_days (or already have): the label photo is taken again.
create or replace function facts_due_for_recheck(p_days int default 30) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'due'), '[]'::jsonb) from (
    select jsonb_build_object('product_id', f.product_id, 'kind', 'fact', 'field', f.attribute,
                              'due', least(coalesce(f.expires_at, 'infinity'), coalesce(f.reviewed_at, f.approved_at) + interval '12 months')) as x
      from product_facts f join products p on p.id = f.product_id and p.is_active
     where f.approved_at is not null and f.superseded_at is null
       and least(coalesce(f.expires_at, 'infinity'), coalesce(f.reviewed_at, f.approved_at) + interval '12 months') < now() + make_interval(days => p_days)
    union all
    select jsonb_build_object('product_id', v.product_id, 'kind', 'field', 'field', v.field_key, 'due', v.expires_at)
      from product_field_values v join products p on p.id = v.product_id and p.is_active
     where v.status = 'approved' and v.expires_at < now() + make_interval(days => p_days)) y $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
