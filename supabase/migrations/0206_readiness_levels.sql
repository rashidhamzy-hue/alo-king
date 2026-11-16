-- Alo King Chouf, session PD1, pull request 2, part (c): two readiness levels, extending product_readiness (0111).
--   sellable       the core is complete: every field of the item's template (with the core) marked "required for sellable" is there:
--                  names in English and Arabic, a category with a template, a storage zone, a sale unit, a price at the hub. The item
--                  can be ordered; its facts read "not confirmed yet".
--   fact_complete  sellable, and every field marked "required for fact-complete" is approved and current (re-checked within 12 months):
--                  for packaged food the ingredients, the 14 allergens and the nutrition panel; for a cleaning product its hazard warnings
--                  as printed; for a pet food its species and life stage; and so on (template_fields, 0203). Only these items can pass a
--                  fact filter or have a fact stated.
--
-- The catalogue does not freeze: nothing here pauses an item that is active today. From now on, an item going live for the first time
-- needs it sellable (inserting one needs its template, a name and a sale unit, 0203: the price and the Arabic name come in later rows);
-- an item that was live before comes back after a recall or a hold as it was (product_went_live). Active
-- items that are not sellable are listed with what they miss (readiness_not_sellable). The console's readiness page shows both levels.
--
-- product_food_facts and product_meets_restrictions (0021) keep their names and shapes; each now answers by level:
--   not a food item   no food facts at all ("doesn't apply"); every restriction check is unknown with reason does_not_apply
--   sellable only     every fact reads status not_confirmed_yet (the recorded status kept as recorded_status); a check that would pass is
--                     unknown with reason not_fact_complete (a check that fails still fails: excluding is always safe)
--   fact_complete     as before

-- ---------- what an item has of its template ----------
create or replace function product_template_status(p_product uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare p products%rowtype; v_t text; t product_templates%rowtype; f record; v_has boolean;
        v_sell text[] := '{}'; v_fc text[] := '{}'; v_row jsonb; v_recent timestamptz := now() - interval '12 months';
begin
  select * into p from products where id = p_product;
  if not found then return null; end if;
  v_t := product_template(p_product);
  if v_t is null then
    return jsonb_build_object('template', null, 'is_food', false, 'sellable', false, 'fact_complete', false,
                              'missing_sellable', jsonb_build_array('template'), 'missing_fact_complete', '[]'::jsonb);
  end if;
  select * into t from product_templates where code = v_t;
  v_row := to_jsonb(p);
  for f in select distinct on (tf.key) tf.* from template_fields tf
            where tf.required_for is not null and (tf.template_code = v_t or (tf.template_code = 'core' and t.includes_core))
            order by tf.key, (tf.template_code = v_t) desc loop
    v_has := case f.store
      when 'products' then coalesce(btrim(v_row->>(case f.key when 'storage_zone' then 'storage' when 'sub_category' then 'sub_type' else f.key end)), '') <> ''
      when 'offers' then exists (select 1 from offers o join sources s on s.id = o.source_id
                                  where o.product_id = p.id and (case when p.owner_source_id is null then s.kind = 'dark_store' else s.id = p.owner_source_id end))
      when 'values' then exists (select 1 from product_field_values v where v.product_id = p.id and v.field_key = f.key and v.status = 'approved'
                                  and (v.expires_at is null or v.expires_at > now()))
      when 'facts' then case f.key
        when 'ingredients' then exists (select 1 from product_facts x where x.product_id = p.id and x.attribute = 'ingredients' and x.approved_at is not null
                                         and x.superseded_at is null and x.status in ('certified', 'declared', 'calculated')
                                         and (x.expires_at is null or x.expires_at > now()) and coalesce(x.reviewed_at, x.approved_at) > v_recent)
        when 'allergens' then (select count(distinct x.attribute) from product_facts x join food_attributes a on a.code = x.attribute and a.kind = 'allergen'
                                where x.product_id = p.id and x.approved_at is not null and x.superseded_at is null and x.status <> 'unknown'
                                  and (x.expires_at is null or x.expires_at > now()) and coalesce(x.reviewed_at, x.approved_at) > v_recent)
                              = (select count(*) from food_attributes where kind = 'allergen')
        when 'nutrition' then product_nutrition(p.id) is not null
        when 'declared_facts' then exists (select 1 from dish_declarations d join food_attributes a on a.code = d.attribute and a.kind = 'allergen'
                                            where d.product_id = p.id and d.superseded_at is null)
        else false end
      else false end;
    if not v_has then
      if f.required_for = 'sellable' then v_sell := v_sell || f.key; else v_fc := v_fc || f.key; end if;
    end if;
  end loop;
  -- Meat: a halal status shown needs the supplier's certificate, approved by a person.
  if v_t = 'meat_poultry' and exists (select 1 from product_facts x where x.product_id = p.id and x.attribute = 'halal' and x.value = 'yes'
                                        and x.approved_at is not null and x.superseded_at is null)
     and not exists (select 1 from product_certificates c where c.kind = 'halal' and c.status = 'approved'
                      and (c.valid_until is null or c.valid_until >= current_date) and (c.product_id = p.id)) then
    v_fc := v_fc || 'halal_certificate'::text;
  end if;
  return jsonb_build_object('template', v_t, 'is_food', t.is_food, 'sellable', cardinality(v_sell) = 0,
    'fact_complete', cardinality(v_sell) = 0 and cardinality(v_fc) = 0,
    'missing_sellable', to_jsonb(v_sell), 'missing_fact_complete', to_jsonb(v_fc));
end $$;

create or replace function product_fact_complete(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((product_template_status(p_product)->>'fact_complete')::boolean, false) $$;

-- ---------- product_readiness (0111) with the two levels ----------
alter function product_readiness(uuid) rename to product_readiness_base;
create or replace function product_readiness(p_product uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r || jsonb_build_object('level', case when (s->>'fact_complete')::boolean then 'fact_complete'
                                                                  when (s->>'sellable')::boolean then 'sellable' else 'not_sellable' end)
                              || s order by n), '[]'::jsonb)
    from jsonb_array_elements(product_readiness_base(p_product)) with ordinality x(r, n)
    cross join lateral (select product_template_status((r->>'product_id')::uuid) as s) st $$;

-- Active items that are not sellable, with what each misses. Nothing is paused; this is the list a person works through.
create or replace function readiness_not_sellable() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'template', s->>'template',
                                               'missing', s->'missing_sellable') order by p.sku), '[]'::jsonb)
    from products p cross join lateral (select product_template_status(p.id) as s) x
   where p.is_active and not coalesce((s->>'sellable')::boolean, false) $$;

-- Counts per template, for the report and the gate ("every active item at least sellable").
create or replace function readiness_summary() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'active', count(*),
    'sellable', count(*) filter (where (s->>'sellable')::boolean),
    'fact_complete', count(*) filter (where (s->>'fact_complete')::boolean),
    'by_template', (select coalesce(jsonb_object_agg(tpl, jsonb_build_object('active', n, 'sellable', ns, 'fact_complete', nf)), '{}'::jsonb) from (
        select coalesce(s2->>'template', 'none') as tpl, count(*) as n, count(*) filter (where (s2->>'sellable')::boolean) as ns,
               count(*) filter (where (s2->>'fact_complete')::boolean) as nf
          from products p2 cross join lateral (select product_template_status(p2.id) as s2) y
         where p2.is_active and p2.owner_source_id is null group by 1) g))
    from products p cross join lateral (select product_template_status(p.id) as s) x
   where p.is_active and p.owner_source_id is null $$;

-- ---------- switching an item on for the first time needs it sellable ----------
-- An item that has been live before (every item active today, and each one once it goes live) comes back after a recall, a hold or a
-- pause as it was: those are operations, not a new item going live. An item going live for the first time must be sellable.
create table product_went_live (
  product_id uuid primary key references products(id) on delete cascade,
  at         timestamptz not null default now(),
  how        text not null check (how in ('active_before_pd1', 'inserted_active', 'activated_sellable'))
);
insert into product_went_live(product_id, how) select id, 'active_before_pd1' from products where is_active on conflict do nothing;
alter table product_went_live enable row level security;

create or replace function product_went_live_on_insert() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_active then insert into product_went_live(product_id, how) values (new.id, 'inserted_active') on conflict do nothing; end if;
  return new;
end $$;
create trigger products_went_live_on_insert after insert on products for each row execute function product_went_live_on_insert();

create or replace function product_activation_needs_sellable() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare s jsonb;
begin
  if new.is_active and not old.is_active and not exists (select 1 from product_went_live where product_id = new.id) then
    s := product_template_status(new.id);
    if not coalesce((s->>'sellable')::boolean, false) then
      raise exception 'NOT_SELLABLE: % misses %', coalesce(new.sku, new.id::text), s->'missing_sellable';
    end if;
    insert into product_went_live(product_id, how) values (new.id, 'activated_sellable') on conflict do nothing;
  end if;
  return new;
end $$;
-- After the row is written, so product_template_status reads the new values (a name added in the same update counts).
create constraint trigger products_activation_sellable after update of is_active on products
  for each row execute function product_activation_needs_sellable();

-- ---------- facts by level ----------
alter function product_food_facts(uuid) rename to product_food_facts_base;
create or replace function product_food_facts(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case
    when not coalesce((st->>'is_food')::boolean, false) then '[]'::jsonb
    when (st->>'fact_complete')::boolean then product_food_facts_base(p_product)
    else coalesce((select jsonb_agg(e || jsonb_build_object('status', 'not_confirmed_yet', 'recorded_status', e->>'status', 'level', 'sellable') order by n)
                     from jsonb_array_elements(product_food_facts_base(p_product)) with ordinality y(e, n)), '[]'::jsonb) end
    from (select product_template_status(p_product) as st) x $$;

alter function product_meets_restrictions(uuid, text[]) rename to product_meets_restrictions_base;
create or replace function product_meets_restrictions(p_product uuid, p_restrictions text[]) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with b as (select product_meets_restrictions_base(p_product, p_restrictions) as r, product_template_status(p_product) as st),
  c as (
    select case
             when not coalesce((st->>'is_food')::boolean, false) then e || '{"result": "unknown", "reason": "does_not_apply"}'::jsonb
             when not coalesce((st->>'fact_complete')::boolean, false) and e->>'result' = 'pass' then e || '{"result": "unknown", "reason": "not_fact_complete"}'::jsonb
             else e end as e, n
      from b cross join lateral jsonb_array_elements(b.r->'checks') with ordinality z(e, n))
  select (select r from b) || jsonb_build_object(
           'meets', coalesce((select bool_and(e->>'result' = 'pass') from c), true),
           'checks', coalesce((select jsonb_agg(e order by n) from c), '[]'::jsonb),
           'level', (select case when (st->>'fact_complete')::boolean then 'fact_complete' when (st->>'sellable')::boolean then 'sellable' else 'not_sellable' end from b),
           'applies', (select coalesce((st->>'is_food')::boolean, false) from b)) $$;

-- What the Concierge's food_facts tool reads: whether food facts apply at all, the item's level, and the facts by level, with the
-- typed nutrition, the approved printed claims and certificates of a fact-complete item. A dish: the vendor's declarations.
create or replace function product_facts_for_chat(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'product_id', p_product, 'template', st->>'template', 'applies', coalesce((st->>'is_food')::boolean, false),
    'level', case when (st->>'fact_complete')::boolean then 'fact_complete' when (st->>'sellable')::boolean then 'sellable' else 'not_sellable' end,
    'facts', case when st->>'template' = 'vendor_dish' then dish_food_facts(p_product) else product_food_facts(p_product) end,
    'nutrition', case when (st->>'fact_complete')::boolean then product_nutrition(p_product) end,
    'claims', case when (st->>'fact_complete')::boolean then coalesce((select jsonb_agg(jsonb_build_object('claim', c.claim_code, 'value', c.value, 'quote', c.quote,
                       'source', c.source) order by c.claim_code) from product_claims c where c.product_id = p_product and c.status = 'approved'
                       and (c.expires_at is null or c.expires_at > now())), '[]'::jsonb) else '[]'::jsonb end,
    'note', case when not coalesce((st->>'is_food')::boolean, false) then 'Food facts do not apply to this item: say so.'
                 when (st->>'fact_complete')::boolean then 'State only these facts, each with its source ("the pack says ...").'
                 else 'Not confirmed yet: no fact about this item may be stated.' end)
    from (select product_template_status(p_product) as st) x $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
