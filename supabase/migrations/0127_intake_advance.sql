-- Alo King Chouf, session I1: the database's part of the intake pipeline, and the reports.
--
--   intake_try_auto(p_product)   runs try_auto_approve() (0125) over everything waiting for one item, or every item: its name
--                                proposal, its proposed picture, its label readings of ingredients and nutrition, its search
--                                words. A rule that is off only logs (0124). Nothing else is ever tried: no allergen, diet,
--                                price or cost.
--   intake_advance(p_product)    the steps the database moves (search_words, price_cost, person_approves, live), from what is
--                                true now (product_readiness, 0111; 0076's jobs). Never writes a fact, a price or a name itself.
--   intake_report()              counts for intake.yml's step summary and the console.
--   auto_approvals_overview()    what the console's automatic-approvals page shows.

create or replace function intake_try_auto(p_product uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare x record; r jsonb; v_out jsonb := '{}'; k text;
begin
  for x in
    select 'name' as kind, n.id::text as id from product_name_proposals n join products p on p.sku = n.sku
     where n.status = 'proposed' and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
    union all
    select 'picture', i.id::text from product_images i join products p on p.id = i.product_id
     where i.status = 'proposed' and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
    union all
    select 'fact', f.id::text from product_facts f join products p on p.id = f.product_id
     where f.attribute in ('ingredients', 'nutrition') and f.source = 'label' and f.approved_at is null and f.superseded_at is null
       and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
    union all
    select 'search_words', p.sku from products p
     where p.owner_source_id is null and p.is_active and p.sku is not null and (p_product is null or p.id = p_product)
       and exists (select 1 from language_pack lp where lp.sku = p.sku and lp.level <> 'brand')
  loop
    r := try_auto_approve(x.kind, x.id);
    k := x.kind || ':' || case when (r->>'approved')::boolean then 'approved' when (r->>'shadow')::boolean then 'logged_rule_off' else coalesce(r->>'reason', 'no') end;
    v_out := jsonb_set(v_out, array[k], to_jsonb(coalesce((v_out->>k)::int, 0) + 1));
  end loop;
  return v_out;
end $$;

-- Set one database-moved step, only when it changes (updated_at then says when it last moved).
create or replace function intake_set_step(p_product uuid, p_step text, p_status text, p_result jsonb, p_error text default null) returns int
language sql set search_path = public, pg_temp as $$
  with u as (
    update product_intake_jobs set status = p_status, result = coalesce(p_result, '{}'), last_error = p_error, updated_at = now()
     where product_id = p_product and step = p_step and status <> 'running'
       and (status, result, last_error) is distinct from (p_status, coalesce(p_result, '{}'), p_error)
    returning 1)
  select count(*)::int from u $$;

create or replace function intake_advance(p_product uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare rd jsonb; v_auto jsonb; v_moved int := 0; v_id uuid; v_job text; v_open int; v_pa text[];
begin
  v_auto := intake_try_auto(p_product);
  for rd in select * from jsonb_array_elements(product_readiness(p_product)) loop
    v_id := (rd->>'product_id')::uuid;
    if not exists (select 1 from product_intake_jobs where product_id = v_id) then continue; end if;

    -- 3 search words: 0076 builds them; misses wait for a person on the search-words review list; a job that failed three times is listed.
    select j.status into v_job from search_word_jobs j where j.sku = rd->>'sku';
    select count(*) into v_open from search_word_reviews r where r.sku = rd->>'sku' and r.status = 'open';
    v_moved := v_moved + case
      when v_open > 0 then intake_set_step(v_id, 'search_words', 'needs_person', jsonb_build_object('open_reviews', v_open))
      when v_job = 'failed' then intake_set_step(v_id, 'search_words', 'listed', jsonb_build_object('job', v_job), 'search words failed three times (0076): rebuild them on the search-words page')
      when rd->>'search_words' = 'built' and coalesce(v_job, 'done') = 'done' then intake_set_step(v_id, 'search_words', 'done', jsonb_build_object('built', true))
      else intake_set_step(v_id, 'search_words', 'waiting', jsonb_build_object('job', v_job)) end;

    -- 6 price and cost: never automatic. A person enters both (catalog, receiving).
    v_moved := v_moved + case when (rd->>'price')::boolean and (rd->>'cost')::boolean
      then intake_set_step(v_id, 'price_cost', 'done', jsonb_build_object('price_usd', rd->'price_usd'))
      else intake_set_step(v_id, 'price_cost', 'needs_person', jsonb_build_object('price', rd->'price', 'cost', rd->'cost', 'never_automatic', true)) end;

    -- 7 a person (or a rule) approves: the name, the picture and the food facts from the pack.
    v_pa := array_remove(array[
      case when rd->>'name' = 'waiting' then 'name' end,
      case when rd->>'picture' <> 'approved' then 'picture' end,
      case when not coalesce((rd->'facts'->>'ok')::boolean, false) then 'food facts from the pack (allergens always by a person)' end], null);
    v_moved := v_moved + case when cardinality(v_pa) = 0
      then intake_set_step(v_id, 'person_approves', 'done', jsonb_build_object('approved', true))
      else intake_set_step(v_id, 'person_approves', 'needs_person', jsonb_build_object('waiting_for', to_jsonb(v_pa))) end;

    -- 8 live: orderable when nothing blocks ordering; in the WhatsApp catalog when nothing blocks the catalog either.
    v_moved := v_moved + case when jsonb_array_length(rd->'blocks_ordering') = 0
      then intake_set_step(v_id, 'live', 'done', jsonb_build_object('orderable', true, 'in_catalog', jsonb_array_length(rd->'blocks_catalog') = 0, 'blocks_catalog', rd->'blocks_catalog'))
      else intake_set_step(v_id, 'live', 'waiting', jsonb_build_object('orderable', false, 'blocks_ordering', rd->'blocks_ordering')) end;
  end loop;
  return jsonb_build_object('auto', v_auto, 'steps_moved', v_moved);
end $$;

create or replace function intake_report() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'items', (select count(distinct product_id) from product_intake_jobs),
    'steps', (select coalesce(jsonb_object_agg(step, s), '{}'::jsonb) from (
                select step, jsonb_object_agg(status, n) as s from (select step, status, count(*) as n from product_intake_jobs group by 1, 2) a group by step) b),
    'listed', (select count(*) from product_intake_jobs where status = 'listed'),
    'researched', (select count(distinct product_id) from intake_research),
    'research_spend_usd', (select coalesce(sum(cost_usd), 0) from intake_research),
    'live', (select count(*) from product_intake_jobs where step = 'live' and status = 'done'),
    'rules', (select jsonb_object_agg(field, enabled) from auto_approval_rules),
    'auto_approved', (select count(*) from auto_approvals where applied and reverted_at is null),
    'auto_logged_rule_off', (select count(*) from auto_approvals where not applied),
    'spot_checks_waiting', (select count(*) from auto_approval_spot_checks where status = 'waiting')) $$;

create or replace function auto_approvals_overview(p_limit int default 60) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('field', r.field, 'enabled', r.enabled, 'first_passed_at', r.first_passed_at,
                'disabled_at', r.disabled_at, 'disabled_reason', r.disabled_reason, 'checks', r.checks,
                'applied', (select count(*) from auto_approvals a where a.field = r.field and a.applied and a.reverted_at is null),
                'logged_rule_off', (select count(*) from auto_approvals a where a.field = r.field and not a.applied),
                'checked_right', (select count(*) from auto_approval_spot_checks c join auto_approvals a on a.id = c.approval_id where a.field = r.field and c.status = 'correct'),
                'checked_wrong', (select count(*) from auto_approval_spot_checks c join auto_approvals a on a.id = c.approval_id where a.field = r.field and c.status = 'wrong'))
              order by array_position(array['picture', 'name_size_category', 'search_words', 'ingredients_nutrition'], r.field)), '[]'::jsonb) from auto_approval_rules r),
    'never_automatic', '["allergens", "diet labels", "price", "cost"]'::jsonb,
    'arabic_reader', setting('auto_approval')->'arabic_reader',
    'spot_checks', (select coalesce(jsonb_agg(x order by x->>'sample_day', x->>'sku'), '[]'::jsonb) from (
        select jsonb_build_object('check_id', c.id, 'sample_day', c.sample_day, 'field', a.field, 'kind', a.kind, 'applied', a.applied,
                 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand, 'barcode', p.barcode, 'checks', a.checks, 'result', a.result,
                 'proposal_id', a.proposal_id, 'created_at', a.created_at,
                 'picture', case when a.kind = 'picture' then (select jsonb_build_object('source_url', i.source_url, 'page_url', i.page_url, 'source_kind', i.source_kind,
                                   'media_path', i.media_path, 'status', i.status) from product_images i where i.id::text = a.proposal_id) end,
                 'name', case when a.kind = 'name' then (select jsonb_build_object('name_en', n.name_en, 'size_en', n.size_en, 'name_ar', n.name_ar, 'size_ar', n.size_ar,
                                   'current_name_en', n.current_name_en, 'status', n.status) from product_name_proposals n where n.id::text = a.proposal_id) end,
                 'fact', case when a.kind = 'fact' then (select jsonb_build_object('attribute', f.attribute, 'text', f.detail->>'text', 'values', f.detail->'values')
                                   from product_facts f where f.id::text = a.proposal_id) end) as x
          from auto_approval_spot_checks c join auto_approvals a on a.id = c.approval_id join products p on p.id = a.product_id
         where c.status = 'waiting' limit p_limit) q),
    'recent', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('approval_id', a.id, 'field', a.field, 'kind', a.kind, 'applied', a.applied, 'sku', p.sku, 'name_en', p.name_en,
                 'created_at', a.created_at, 'reverted_at', a.reverted_at, 'checks', a.checks) as x
          from auto_approvals a join products p on p.id = a.product_id order by a.created_at desc limit p_limit) q),
    'review_list', intake_review_list(p_limit),
    'intake', intake_report()) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
