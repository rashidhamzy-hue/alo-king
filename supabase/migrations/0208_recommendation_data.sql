-- Alo King Chouf, session PD1, pull request 3, part (f): the data that makes recommendations good (docs/PRODUCT_DATA_STANDARD.md,
-- "Data that makes recommendations good"). None of it is a health or safety claim, and the chat never says any of it as advice
-- (invariant 14): it lets code build a basket, offer the closest real swap and compare prices honestly. Proposed by a model or by
-- rules, checked by rules here:
--   substitute groups    products a customer can swap for each other: same template and same kind, always (a trigger)
--   complements         "goes with", kind to kind (hummus with pita, charcoal with meat): one suggestion, never a claim
--   Lebanese dishes      a dish as a basket: its kinds and the quantity per person, as numbers code multiplies
--   portions            how much of a kind per person (bread per person per day, rice per person for a main dish, snacks per child)
--   unit price          per kg, per litre or per piece, computed here from the hub's price and the size printed in the name or the
--                       approved size field; never by a model
--   taste, type, pack format, seasons and occasions: tags (0204); local origin: the origin field and the "made in" claim (0203, 0204)
--   search documents    one text per item from its fields and words, in four languages, for SR1's search by meaning
-- "Nothing crosses a stated restriction": substitutes_for() and dish_basket() return only items that meet the customer's stated
-- restrictions through product_meets_restrictions (0206): with restrictions, an item that is not fact-complete never comes back.

-- ---------- substitute groups ----------
create table substitute_groups (
  code          text primary key,
  name_en       text not null,
  template_code text not null references product_templates(code),
  kind          text not null,                 -- the kind every member has (product_field_values 'kind', approved)
  source        text not null check (source in ('rules', 'model', 'person')),
  created_at    timestamptz not null default now()
);
create table product_substitutes (
  product_id  uuid not null references products(id) on delete cascade,
  group_code  text not null references substitute_groups(code) on delete cascade,
  source      text not null check (source in ('rules', 'model', 'person')),
  created_at  timestamptz not null default now(),
  primary key (product_id, group_code)
);

-- An item's approved, current kind (the core field 'kind', 0203).
create or replace function product_kind(p_product uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select lower(btrim(v.value #>> '{}')) from product_field_values v
   where v.product_id = p_product and v.field_key = 'kind' and v.status = 'approved' and (v.expires_at is null or v.expires_at > now()) limit 1 $$;

create or replace function substitute_same_kind() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare g substitute_groups%rowtype;
begin
  select * into g from substitute_groups where code = new.group_code;
  if product_template(new.product_id) is distinct from g.template_code then
    raise exception 'SUBSTITUTE_MISMATCH: % is not a % item', new.product_id, g.template_code;
  end if;
  if product_kind(new.product_id) is distinct from lower(g.kind) then
    raise exception 'SUBSTITUTE_MISMATCH: % is not of kind "%"', new.product_id, g.kind;
  end if;
  return new;
end $$;
create trigger product_substitutes_same_kind before insert or update on product_substitutes for each row execute function substitute_same_kind();

-- ---------- complements ----------
create table complements (
  kind        text not null,
  goes_with   text not null,
  source      text not null check (source in ('rules', 'model', 'person')),
  primary key (kind, goes_with),
  check (lower(kind) <> lower(goes_with))
);

-- ---------- Lebanese dishes as baskets, and portions ----------
create table dishes (
  code      text primary key,
  name_en   text not null,
  name_ar   text not null,
  words     text[] not null default '{}',       -- how customers say it («مجدرة», "mjadra", "moujaddara")
  source    text not null check (source in ('rules', 'model', 'person'))
);
create table dish_kinds (
  dish_code      text not null references dishes(code) on delete cascade,
  kind           text not null,
  qty_per_person numeric not null check (qty_per_person > 0),
  unit           text not null check (unit in ('g', 'ml', 'piece', 'bunch', 'pack')),
  optional       boolean not null default false,
  primary key (dish_code, kind)
);
create table portions (
  kind        text not null,
  per         text not null check (per in ('person_meal', 'person_day', 'child_day', 'guest')),
  qty         numeric not null check (qty > 0),
  unit        text not null check (unit in ('g', 'ml', 'piece', 'pack')),
  source      text not null check (source in ('rules', 'model', 'person')),
  primary key (kind, per)
);

-- A first set of dishes, written as data (quantities per person for a main dish; a person may change them on the console later).
insert into dishes(code, name_en, name_ar, words, source) values
  ('mjadra',     'Mjadra',             'مجدرة',          '{mjadra,moujaddara,mujaddara,مجدرة,مجدّرة}', 'person'),
  ('tabbouleh',  'Tabbouleh',          'تبولة',          '{tabbouleh,tabouli,tabboule,تبولة,تبّولة}', 'person'),
  ('fattoush',   'Fattoush',           'فتوش',           '{fattoush,fattouch,فتوش,فتّوش}', 'person'),
  ('hummus',     'Hummus plate',       'صحن حمص',        '{hummus,hommos,7ommos,حمص,حمّص}', 'person'),
  ('foul',       'Foul moudammas',     'فول مدمس',       '{foul,ful,فول,فول مدمس}', 'person'),
  ('lentil_soup','Lentil soup',        'شوربة عدس',      '{lentil soup,shorbet 3adas,شوربة عدس}', 'person'),
  ('manakish',   'Manakish at home',   'مناقيش',         '{manakish,man2oushe,mana2ish,مناقيش,منقوشة}', 'person'),
  ('breakfast',  'Lebanese breakfast', 'ترويقة',         '{breakfast,terwi2a,ترويقة,فطور}', 'person');
insert into dish_kinds(dish_code, kind, qty_per_person, unit, optional) values
  ('mjadra', 'lentils', 60, 'g', false), ('mjadra', 'rice', 40, 'g', false), ('mjadra', 'onion', 1, 'piece', false), ('mjadra', 'vegetable oil', 20, 'ml', false),
  ('tabbouleh', 'parsley', 0.5, 'bunch', false), ('tabbouleh', 'tomato', 1, 'piece', false), ('tabbouleh', 'burghul', 15, 'g', false),
  ('tabbouleh', 'lemon', 0.5, 'piece', false), ('tabbouleh', 'olive oil', 15, 'ml', false), ('tabbouleh', 'mint', 0.2, 'bunch', true),
  ('fattoush', 'lettuce', 0.25, 'piece', false), ('fattoush', 'tomato', 1, 'piece', false), ('fattoush', 'cucumber', 1, 'piece', false),
  ('fattoush', 'arabic bread', 0.5, 'piece', false), ('fattoush', 'olive oil', 15, 'ml', false), ('fattoush', 'sumac', 2, 'g', true),
  ('hummus', 'chickpeas', 60, 'g', false), ('hummus', 'tahini', 20, 'g', false), ('hummus', 'lemon', 0.5, 'piece', false), ('hummus', 'arabic bread', 1, 'piece', false),
  ('foul', 'fava beans', 100, 'g', false), ('foul', 'lemon', 0.5, 'piece', false), ('foul', 'olive oil', 15, 'ml', false), ('foul', 'arabic bread', 1, 'piece', false),
  ('lentil_soup', 'lentils', 50, 'g', false), ('lentil_soup', 'onion', 0.5, 'piece', false), ('lentil_soup', 'lemon', 0.25, 'piece', true),
  ('manakish', 'zaatar', 15, 'g', false), ('manakish', 'olive oil', 15, 'ml', false), ('manakish', 'arabic bread', 2, 'piece', false),
  ('breakfast', 'labneh', 50, 'g', false), ('breakfast', 'arabic bread', 1, 'piece', false), ('breakfast', 'eggs', 2, 'piece', false),
  ('breakfast', 'olive oil', 10, 'ml', true), ('breakfast', 'zaatar', 10, 'g', true), ('breakfast', 'tomato', 1, 'piece', true);
insert into portions(kind, per, qty, unit, source) values
  ('arabic bread', 'person_day', 3, 'piece', 'person'), ('rice', 'person_meal', 80, 'g', 'person'), ('pasta', 'person_meal', 100, 'g', 'person'),
  ('lentils', 'person_meal', 60, 'g', 'person'), ('chicken', 'person_meal', 200, 'g', 'person'), ('ground meat', 'person_meal', 150, 'g', 'person'),
  ('snack', 'child_day', 1, 'pack', 'person'), ('juice', 'child_day', 1, 'pack', 'person'), ('water', 'person_day', 1500, 'ml', 'person'),
  ('soft drink', 'guest', 330, 'ml', 'person'), ('chips', 'guest', 30, 'g', 'person');

-- "Goes with", kind to kind: one suggestion at most per order, never a claim (rules for recommending, docs/PRODUCT_DATA_STANDARD.md).
insert into complements(kind, goes_with, source) values
  ('hummus', 'arabic bread', 'person'), ('labneh', 'arabic bread', 'person'), ('zaatar', 'olive oil', 'person'), ('chips', 'soft drink', 'person'),
  ('tea', 'sugar', 'person'), ('coffee', 'sugar', 'person'), ('pasta', 'tomato paste', 'person'), ('chicken', 'garlic paste', 'person'),
  ('ground meat', 'arabic bread', 'person'), ('lentils', 'rice', 'person'), ('tuna', 'arabic bread', 'person');

-- ---------- unit price, computed here ----------
-- The size from the approved 'size' field, or else the name as printed ("Tannourine 2L X6", "Deroni Sugar 5Kg"): intake_size_key (0125).
create or replace function product_unit_price(p_product uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare p products%rowtype; v_price numeric; v_size text; k text; m text[]; n numeric; u text; packs int;
begin
  select * into p from products where id = p_product;
  if not found then return null; end if;
  select o.price_usd into v_price from offers o join sources s on s.id = o.source_id
   where o.product_id = p.id and (case when p.owner_source_id is null then s.kind = 'dark_store' else s.id = p.owner_source_id end) order by o.price_usd limit 1;
  if v_price is null then return null; end if;
  select v.value #>> '{}' into v_size from product_field_values v where v.product_id = p.id and v.field_key = 'size' and v.status = 'approved' limit 1;
  k := intake_size_key(coalesce(v_size, p.name_en));
  if k is null then
    if lower(p.sell_unit) in ('kg') then return jsonb_build_object('per', 'kg', 'price_usd', round(v_price, 2), 'basis', 'sold_by_kg'); end if;
    return jsonb_build_object('per', 'piece', 'price_usd', round(v_price, 2), 'basis', 'one_item');
  end if;
  m := regexp_match(k, '^([0-9.]+)(g|ml)(?:x([0-9]+))?$');
  if m is null then return null; end if;
  n := m[1]::numeric; u := m[2]; packs := coalesce(nullif(m[3], '')::int, 1);
  if n <= 0 or packs <= 0 then return null; end if;
  return jsonb_build_object('per', case u when 'g' then 'kg' else 'litre' end,
    'price_usd', round(v_price / (n * packs / 1000.0), 2), 'size', k, 'basis', case when v_size is not null then 'size_field' else 'name' end);
end $$;

-- ---------- what code may offer, never across a stated restriction ----------
-- The closest real swaps for an item: same substitute group, active, at the hub, cheapest per unit first. With restrictions, only
-- items that meet every one of them (a fact-complete item with approved facts, 0206).
create or replace function substitutes_for(p_product uuid, p_restrictions text[] default '{}') returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by (x->'unit_price'->>'price_usd')::numeric nulls last, x->>'name_en'), '[]'::jsonb) from (
    select distinct on (o.id) jsonb_build_object('product_id', o.id, 'name_en', o.name_en, 'name_ar', o.name_ar, 'group', g.group_code,
             'unit_price', product_unit_price(o.id)) as x
      from product_substitutes g join product_substitutes g2 on g2.group_code = g.group_code and g2.product_id <> g.product_id
      join products o on o.id = g2.product_id and o.is_active
     where g.product_id = p_product
       and (coalesce(cardinality(p_restrictions), 0) = 0 or (product_meets_restrictions(o.id, p_restrictions)->>'meets')::boolean)) y $$;

-- A dish for N people: each kind with the quantity code multiplied, and the items of that kind the hub sells (cheapest per unit first),
-- never one that fails a stated restriction. The basket itself is priced by quote_order and confirmed by the customer (invariants 4, 7).
create or replace function dish_basket(p_dish text, p_people int, p_restrictions text[] default '{}') returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('dish', d.code, 'name_en', d.name_en, 'name_ar', d.name_ar, 'people', p_people,
    'kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'qty', k.qty_per_person * p_people, 'unit', k.unit, 'optional', k.optional,
        'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'unit_price', product_unit_price(p.id))
                                            order by (product_unit_price(p.id)->>'price_usd')::numeric nulls last)
                             from products p where p.is_active and p.owner_source_id is null and product_kind(p.id) = lower(k.kind)
                              and (coalesce(cardinality(p_restrictions), 0) = 0 or (product_meets_restrictions(p.id, p_restrictions)->>'meets')::boolean)), '[]'::jsonb))
        order by k.optional, k.kind) from dish_kinds k where k.dish_code = d.code), '[]'::jsonb))
    from dishes d where d.code = p_dish and p_people between 1 and 50 $$;

-- ---------- one search document per item ----------
create table product_search_documents (
  product_id  uuid primary key references products(id) on delete cascade,
  document    text not null,
  built_at    timestamptz not null default now(),
  digest      text not null
);

-- Everything a customer might say about the item, in one text: names, brand, category, template, kind, tags (English and Arabic),
-- approved claims, origin, the language pack's terms and the aliases. Approved data only; a claim that is waiting is left out.
create or replace function build_search_document(p_product uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select concat_ws(E'\n',
    concat_ws(' | ', p.name_en, p.name_ar, (select v.value #>> '{}' from product_field_values v where v.product_id = p.id and v.field_key = 'name_fr' and v.status = 'approved' limit 1)),
    concat_ws(' | ', p.brand, p.category, p.sub_type, (select t.name_en || ' ' || t.name_ar from product_templates t where t.code = product_template(p.id)), product_kind(p.id)),
    (select string_agg(distinct tc.name_en || ' ' || tc.name_ar, ' | ') from product_tags pt join tag_codes tc on tc.code = pt.tag_code where pt.product_id = p.id and pt.approved),
    (select string_agg(distinct cc.name_en || ' ' || cc.name_ar, ' | ') from product_claims c join claim_codes cc on cc.code = c.claim_code
      where c.product_id = p.id and c.status = 'approved' and (c.expires_at is null or c.expires_at > now())),
    (select 'origin ' || (v.value #>> '{}') from product_field_values v where v.product_id = p.id and v.field_key = 'origin' and v.status = 'approved' limit 1),
    (select string_agg(distinct lp.term, ' | ') from language_pack lp where lp.sku = p.sku),
    (select string_agg(distinct a.alias, ' | ') from product_aliases a where a.product_id = p.id))
  from products p where p.id = p_product $$;

-- Writes the documents that changed (all active items, or one); returns how many were written.
create or replace function refresh_search_documents(p_product uuid default null) returns int language plpgsql set search_path = public, pg_temp as $$
declare r record; v_doc text; n int := 0;
begin
  for r in select id from products where is_active and (p_product is null or id = p_product) loop
    v_doc := build_search_document(r.id);
    if v_doc is null then continue; end if;
    insert into product_search_documents(product_id, document, digest) values (r.id, v_doc, md5(v_doc))
      on conflict (product_id) do update set document = excluded.document, digest = excluded.digest, built_at = now()
      where product_search_documents.digest <> excluded.digest;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------- a model's proposals, checked by rules ----------
-- One item's proposal: {kind, tags: [codes], substitute_group: {code, name_en}}. The kind becomes a proposed field value (approved by the
-- rule_fields row when nothing disagrees); tags only from tag_codes; a substitute group only for the item's template and approved kind.
create or replace function apply_item_proposal(p_product uuid, p_proposal jsonb, p_source text default 'model') returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_kind text := nullif(lower(btrim(p_proposal->>'kind')), ''); t text; v_added int := 0; v_dropped jsonb := '[]'; v_id uuid; g jsonb := p_proposal->'substitute_group';
begin
  if p_source not in ('rules', 'model') then raise exception 'PROPOSAL_SOURCE'; end if;
  if v_kind is not null and length(v_kind) <= 60 and v_kind ~ '^[a-z][a-z &''-]*$' then
    if not exists (select 1 from product_field_values where product_id = p_product and field_key = 'kind' and value = to_jsonb(v_kind) and status in ('proposed', 'approved')) then
      insert into product_field_values(product_id, field_key, value, source, detail) values (p_product, 'kind', to_jsonb(v_kind), p_source, jsonb_build_object('proposal', true))
        returning id into v_id;
      perform try_auto_approve('field', v_id::text);
    end if;
  elsif v_kind is not null then v_dropped := v_dropped || jsonb_build_object('kind', v_kind);
  end if;
  for t in select jsonb_array_elements_text(coalesce(p_proposal->'tags', '[]'::jsonb)) loop
    if exists (select 1 from tag_codes where code = t) then
      insert into product_tags(product_id, tag_code, source) values (p_product, t, p_source) on conflict do nothing;
      v_added := v_added + 1;
    else v_dropped := v_dropped || jsonb_build_object('tag', t); end if;
  end loop;
  if g is not null and product_kind(p_product) is not null and coalesce(g->>'code', '') ~ '^[a-z0-9_]{3,60}$' then
    insert into substitute_groups(code, name_en, template_code, kind, source)
      values (g->>'code', coalesce(g->>'name_en', g->>'code'), product_template(p_product), product_kind(p_product), p_source) on conflict (code) do nothing;
    begin
      insert into product_substitutes(product_id, group_code, source) values (p_product, g->>'code', p_source) on conflict do nothing;
    exception when others then v_dropped := v_dropped || jsonb_build_object('substitute_group', g->>'code', 'reason', sqlerrm);
    end;
  end if;
  return jsonb_build_object('tags', v_added, 'kind', product_kind(p_product), 'dropped', v_dropped);
end $$;

-- 0207's automatic check for a field takes a model's proposal too, for a field whose template allows a model and approves automatically
-- (the kind; never a field a person approves, never one another source contradicts).
create or replace function auto_check_field(p_value uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v product_field_values%rowtype; p products%rowtype; v_t text; f template_fields%rowtype;
begin
  select * into v from product_field_values where id = p_value;
  if not found then return jsonb_build_object('ok', false, 'failed', '["not_found"]'::jsonb); end if;
  select * into p from products where id = v.product_id;
  v_t := product_template(v.product_id);
  select tf.* into f from template_fields tf where tf.key = v.field_key and (tf.template_code = v_t or tf.template_code = 'core')
   order by (tf.template_code = v_t) desc limit 1;
  return auto_verdict(jsonb_build_object(
    'proposal_waiting', v.status = 'proposed',
    'proposed_by_a_rule', v.source = 'rules' or (v.source = 'model' and 'model' = any(f.allowed_sources)),
    'field_is_automatic_in_its_template', f.approval = 'automatic',
    'no_other_source_disagrees', not exists (select 1 from product_field_values o where o.product_id = v.product_id and o.field_key = v.field_key
                                                and o.id <> v.id and o.status in ('proposed', 'approved') and o.value is distinct from v.value)),
    p.id, v.id::text, jsonb_build_object('field', v.field_key, 'sku', p.sku));
end $$;

-- intake_try_auto (0207) also tries a model's proposals of automatic fields.
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
     where v.status = 'proposed' and v.source in ('rules', 'model') and p.owner_source_id is null and p.is_active and (p_product is null or p.id = p_product)
  loop
    r := try_auto_approve(x.kind, x.id);
    k := x.kind || ':' || case when (r->>'approved')::boolean then 'approved' when (r->>'shadow')::boolean then 'logged_rule_off' else coalesce(r->>'reason', 'no') end;
    v_out := jsonb_set(v_out, array[k], to_jsonb(coalesce((v_out->>k)::int, 0) + 1));
  end loop;
  return v_out;
end $$;

do $$ declare t text; r text;
begin
  foreach t in array array['substitute_groups', 'product_substitutes', 'complements', 'dishes', 'dish_kinds', 'portions', 'product_search_documents'] loop
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
