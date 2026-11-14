-- Alo King Chouf, session D4 (console): when the label photo and a web source disagree, the label wins (audit G1, point 4).
--
-- Web pages and Open Food Facts are second opinions: a recipe sold in the Gulf or in France may differ from the pack on a Lebanese
-- shelf (SYSTEM_BRIEF, "Web research is market-sensitive"). Until now the console showed each proposal on its own. Now:
--   fact_agree()            do two readings of the same field say the same thing?
--   fact_basis_conflicts()  per item, the fields where a label reading (a person's approved fact from the pack, or the label
--                           reader's proposal) and a web or Open Food Facts proposal disagree. The console flags each one.
--   review_proposed_fact()  0049's function, with one added rule: a web or Open Food Facts proposal cannot be confirmed with a value
--                           that disagrees with the label's. Confirm the label's field (corrected where the pack differs), then set
--                           the web proposal aside. Everything else in the function is 0049's text, unchanged.
-- Anyone redefining review_proposed_fact: start from this file.
--
-- What is compared, and what is not:
--   allergen, diet   the value: free, may_contain, contains / yes, no.
--   nutrition        the numbers both sides state: more than 10% apart (or 0.5 for small figures) is a disagreement.
--   ingredients      the two lists, only when both say the same language (a French list and an Arabic one are not compared:
--                    the words differ without the products differing). Spacing, case and punctuation do not count.
--   storage, origin  not compared.

create or replace function fact_agree(p_attribute text, p_value_a text, p_detail_a jsonb, p_value_b text, p_detail_b jsonb)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare v_kind text; k text; a numeric; b numeric; ta text; tb text;
begin
  select kind into v_kind from food_attributes where code = p_attribute;
  if v_kind in ('allergen', 'diet') then
    return p_value_a is not distinct from p_value_b;
  elsif v_kind = 'nutrition' then
    for k in select jsonb_object_keys(coalesce(p_detail_a->'values', '{}'::jsonb)) loop
      if (p_detail_b->'values') ? k and jsonb_typeof(p_detail_a->'values'->k) = 'number' and jsonb_typeof(p_detail_b->'values'->k) = 'number' then
        a := (p_detail_a->'values'->>k)::numeric; b := (p_detail_b->'values'->>k)::numeric;
        if abs(a - b) > greatest(0.5, 0.1 * greatest(abs(a), abs(b))) then return false; end if;
      end if;
    end loop;
    return true;
  elsif p_attribute = 'ingredients' then
    if coalesce(p_detail_a->>'lang', '') = '' or coalesce(p_detail_b->>'lang', '') = '' or p_detail_a->>'lang' <> p_detail_b->>'lang' then return true; end if;
    ta := regexp_replace(lower(coalesce(p_detail_a->>'text', '')), '[^[:alnum:]ء-ي]+', '', 'g');
    tb := regexp_replace(lower(coalesce(p_detail_b->>'text', '')), '[^[:alnum:]ء-ي]+', '', 'g');
    return ta = '' or tb = '' or ta = tb;
  end if;
  return true;
end $$;

-- The label's reading of a field for one item: the approved current fact from the pack if there is one, else the label reader's
-- proposal still waiting. Source 'label' only: a supplier sheet or a certificate is not "the label photo".
create or replace function label_reading_of(p_product uuid, p_attribute text, p_except uuid default null)
returns product_facts language sql stable set search_path = public, pg_temp as $$
  select f.* from product_facts f
   where f.product_id = p_product and f.attribute = p_attribute and f.source = 'label' and f.superseded_at is null and f.id is distinct from p_except
     and (f.approved_at is not null or f.status = 'partial')
   order by (f.approved_at is not null) desc, f.proposed_at desc limit 1 $$;

create or replace function fact_basis_conflicts(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'attribute', w.attribute,
           'label', jsonb_build_object('fact_id', l.id, 'approved', l.approved_at is not null, 'value', l.value, 'detail', l.detail, 'status', l.status),
           'other', jsonb_build_object('fact_id', w.id, 'source', w.source, 'value', w.value, 'detail', w.detail))
         order by w.attribute), '[]'::jsonb)
    from product_facts w
    cross join lateral label_reading_of(w.product_id, w.attribute, w.id) l
   where w.product_id = p_product and w.source in ('open_food_facts', 'web_page') and w.approved_at is null and w.superseded_at is null
     and l.id is not null and not fact_agree(w.attribute, l.value, l.detail, w.value, w.detail) $$;

-- 0049's review_proposed_fact, plus the label rule marked below.
create or replace function review_proposed_fact(p_fact uuid, p_by uuid, p_decision text, p_value text default null, p_status fact_status default 'declared',
                                                p_detail jsonb default null, p_evidence uuid default null, p_note text default null,
                                                p_expires_at timestamptz default null)
returns jsonb language plpgsql as $$
declare f product_facts%rowtype; v_kind text; v_value text; v_detail jsonb; v_r jsonb; v_new uuid; l product_facts%rowtype;
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
  -- D4 (audit G1, point 4): the label photo outranks a web source. A web or Open Food Facts proposal cannot be confirmed with
  -- a value the label's reading contradicts; the person confirms the label's field and sets this one aside.
  if f.source in ('open_food_facts', 'web_page') and p_status <> 'unknown' then
    select * into l from label_reading_of(f.product_id, f.attribute, f.id);
    if l.id is not null and not fact_agree(f.attribute, l.value, l.detail, v_value, v_detail) then
      raise exception 'LABEL_DISAGREES %: the label says otherwise; confirm the label''s field and set this web proposal aside', f.attribute;
    end if;
  end if;
  v_r := record_food_fact(f.product_id, f.attribute, v_value, p_status, v_detail, coalesce(p_evidence, f.evidence_id), p_by, p_expires_at);
  v_new := (v_r->>'fact_id')::uuid;
  update product_facts set superseded_at = now(), superseded_by = v_new, reviewed_at = now(), review_note = nullif(btrim(p_note), '') where id = p_fact;
  return jsonb_build_object('ok', true, 'decision', 'confirm', 'fact_id', v_new, 'changed', v_value is distinct from f.value or p_detail is not null);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
