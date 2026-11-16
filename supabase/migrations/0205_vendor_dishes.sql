-- Alo King Chouf, session PD1, pull request 2, part (b): the vendor dish standard (docs/PRODUCT_DATA_STANDARD.md, "The standard for
-- vendor menu items"), as schema and functions only. There are no signed vendors: the tests use invented data, and no existing vendor
-- row changes (session rule 9). Invariant 11 holds: nothing here opens a restaurant; approve_merchant() (0013) stays the only way.
-- No send path is added (invariants 1, 2, 20): the vendor's confirmation is a function a channel will call once it exists.
--
-- A dish has no barcode or printed label, so the vendor is the source: every food fact is "declared by the vendor", stored with its
-- date (dish_declarations), never in product_facts. The menu is read into dishes (merchant_menu_imports, 0001 and 0007), the vendor
-- confirms it (vendor_confirm_menu), and ops approves it (ops_approve_vendor_menu, which applies it with apply_menu_import, 0007).

create table dish_details (
  product_id    uuid primary key references products(id) on delete cascade,
  description   text,                      -- what is in it, never praise (invariant 14)
  serves        int check (serves > 0),
  weight_g      numeric check (weight_g > 0),
  pieces        int check (pieces > 0),
  prep_minutes  int check (prep_minutes >= 0),
  hours         jsonb not null default '{}',
  days_off      text[] not null default '{}',
  sold_out      boolean not null default false,
  updated_by    uuid references parties(id),
  updated_at    timestamptz not null default now()
);

create table dish_option_groups (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  name_en      text not null,
  name_ar      text,
  required     boolean not null default false,
  min_choices  int not null default 0 check (min_choices >= 0),
  max_choices  int not null default 1 check (max_choices >= 1),
  sort_order   int not null default 0,
  check (min_choices <= max_choices),
  check (not required or min_choices >= 1)
);
create table dish_options (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references dish_option_groups(id) on delete cascade,
  name_en         text not null,
  name_ar         text,
  price_delta_usd numeric(10,2) not null default 0,
  sort_order      int not null default 0
);

-- What the vendor declares about a dish, with its date. Allergens use 0021's fourteen codes; diets, sugar and spice their own values.
create table dish_declarations (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  attribute     text not null,
  value         text not null,
  declared_by   uuid not null references parties(id),
  declared_at   timestamptz not null default now(),
  import_id     uuid references merchant_menu_imports(id),
  superseded_at timestamptz
);
create unique index dish_declarations_current on dish_declarations(product_id, attribute) where superseded_at is null;

create table menu_import_confirmations (
  import_id    uuid primary key references merchant_menu_imports(id),
  vendor_party uuid not null references parties(id),
  confirmed_at timestamptz not null default now(),
  note         text
);

-- The dish's owner and the party who speaks for it: the merchant who owns the dish's source.
create or replace function dish_vendor_ok(p_dish uuid, p_vendor uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from products p join sources s on s.id = p.owner_source_id
                   join parties pa on pa.id = p_vendor and pa.role = 'merchant' and not pa.is_blocked
                  where p.id = p_dish and s.kind = 'merchant' and s.owner_party_id = p_vendor) $$;

-- The vendor declares one food fact about one of its dishes. The earlier declaration of the same fact is kept as history.
create or replace function vendor_declare(p_dish uuid, p_vendor uuid, p_attribute text, p_value text, p_import uuid default null)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_attr text := lower(btrim(p_attribute)); v_val text := lower(btrim(p_value)); v_kind text;
begin
  if not dish_vendor_ok(p_dish, p_vendor) then raise exception 'NOT_AUTHORISED: only the dish''s own vendor declares its facts'; end if;
  select kind into v_kind from food_attributes where code = v_attr;
  if v_kind = 'allergen' then
    if v_val not in ('contains', 'may_contain', 'free') then raise exception 'DECLARATION_VALUE: % takes contains, may_contain or free', v_attr; end if;
  elsif v_attr in ('halal', 'vegetarian', 'vegan', 'fasting', 'contains_sugar') then
    if v_val not in ('yes', 'no') then raise exception 'DECLARATION_VALUE: % takes yes or no', v_attr; end if;
  elsif v_attr = 'spicy' then
    if v_val not in ('no', 'mild', 'hot') then raise exception 'DECLARATION_VALUE: spicy takes no, mild or hot'; end if;
  else raise exception 'DECLARATION_UNKNOWN: %', v_attr;
  end if;
  update dish_declarations set superseded_at = now() where product_id = p_dish and attribute = v_attr and superseded_at is null;
  insert into dish_declarations(product_id, attribute, value, declared_by, import_id) values (p_dish, v_attr, v_val, p_vendor, p_import)
    returning id into v_id;
  return v_id;
end $$;

-- What may be said about a dish: the vendor's current declarations, each with its date, always as "declared by the vendor".
create or replace function dish_food_facts(p_dish uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('attribute', d.attribute, 'value', d.value, 'status', 'declared', 'source', 'merchant',
           'declared_by_vendor', true, 'declared_at', d.declared_at) order by d.attribute), '[]'::jsonb)
    from dish_declarations d where d.product_id = p_dish and d.superseded_at is null $$;

-- The dish's details, set by its vendor or by ops. Descriptions never praise: a quality word is refused here too.
create or replace function set_dish_details(p_dish uuid, p_by uuid, p_details jsonb) returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  if not (dish_vendor_ok(p_dish, p_by) or exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked)) then
    raise exception 'NOT_AUTHORISED';
  end if;
  if coalesce(p_details->>'description', '') ~* '\m(best|tasty|delicious|healthy|amazing|perfect|famous)\M|أطيب|أحسن|لذيذ|صحي' then
    raise exception 'DESCRIPTION_PRAISE: say what is in it, never how good it is';
  end if;
  insert into dish_details(product_id, description, serves, weight_g, pieces, prep_minutes, updated_by)
    values (p_dish, p_details->>'description', (p_details->>'serves')::int, (p_details->>'weight_g')::numeric, (p_details->>'pieces')::int,
            (p_details->>'prep_minutes')::int, p_by)
    on conflict (product_id) do update set description = coalesce(excluded.description, dish_details.description),
      serves = coalesce(excluded.serves, dish_details.serves), weight_g = coalesce(excluded.weight_g, dish_details.weight_g),
      pieces = coalesce(excluded.pieces, dish_details.pieces), prep_minutes = coalesce(excluded.prep_minutes, dish_details.prep_minutes),
      updated_by = p_by, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- An option group with its options (size, bread, extras, without, spice level): required or optional, minimum and maximum choices.
create or replace function add_dish_option_group(p_dish uuid, p_by uuid, p_group jsonb) returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; o jsonb; n int := 0;
begin
  if not (dish_vendor_ok(p_dish, p_by) or exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked)) then
    raise exception 'NOT_AUTHORISED';
  end if;
  insert into dish_option_groups(product_id, name_en, name_ar, required, min_choices, max_choices)
    values (p_dish, p_group->>'name_en', p_group->>'name_ar', coalesce((p_group->>'required')::boolean, false),
            coalesce((p_group->>'min')::int, case when coalesce((p_group->>'required')::boolean, false) then 1 else 0 end), coalesce((p_group->>'max')::int, 1))
    returning id into v_id;
  for o in select * from jsonb_array_elements(coalesce(p_group->'options', '[]'::jsonb)) loop
    n := n + 1;
    insert into dish_options(group_id, name_en, name_ar, price_delta_usd, sort_order)
      values (v_id, o->>'name_en', o->>'name_ar', coalesce((o->>'price_delta_usd')::numeric, 0), n);
  end loop;
  return v_id;
end $$;

-- The vendor checks the menu as read and confirms it. Only the vendor who owns the menu's source.
create or replace function vendor_confirm_menu(p_import uuid, p_vendor uuid, p_note text default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare m merchant_menu_imports%rowtype;
begin
  select * into m from merchant_menu_imports where id = p_import;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if not exists (select 1 from sources s join parties pa on pa.id = p_vendor where s.id = m.source_id and s.owner_party_id = p_vendor
                  and pa.role = 'merchant' and not pa.is_blocked) then
    raise exception 'NOT_AUTHORISED: only the menu''s own vendor confirms it';
  end if;
  insert into menu_import_confirmations(import_id, vendor_party, note) values (p_import, p_vendor, p_note)
    on conflict (import_id) do update set confirmed_at = now(), note = excluded.note;
  return jsonb_build_object('ok', true);
end $$;

-- Ops approves a menu the vendor confirmed; prices and new dishes go live only then. The restaurant stays as approve_merchant left it.
create or replace function ops_approve_vendor_menu(p_import uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from menu_import_confirmations where import_id = p_import) then
    raise exception 'VENDOR_NOT_CONFIRMED: the vendor confirms the menu before ops approves it';
  end if;
  return apply_menu_import(p_import, p_by);
end $$;

do $$ declare t text; r text;
begin
  foreach t in array array['dish_details', 'dish_option_groups', 'dish_options', 'dish_declarations', 'menu_import_confirmations'] loop
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
