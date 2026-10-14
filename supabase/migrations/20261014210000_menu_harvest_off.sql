-- Session F, DECISIONS §39.4 sources 2-3 and §39.5.
-- 1. Seed photo classes (source 3): the photo model sorts each seed photo (menu, food, drink, storefront, interior,
--    people, other); `scripts/menus/photos.ts` writes supabase/seed/shouf/harvest/photo_classes.csv and
--    scripts/load-seed.sh loads it with `app_private.photo_classes_load()`. Internal only: the photos stay hidden
--    (§38.1); the class only says which photos the menu reader looked at.
-- 2. The photo model is config (`ai_photo_classify_model`, Haiku 5.5, §38.4); the menu reader stays `ai_menu_model`.
-- 3. Open Food Facts (§39.5): `public.off_products` caches what OFF says about a barcode, with the ODbL attribution,
--    on demand only (a merchant scans or types a barcode). Read and written by the server (service role); operators
--    can read it. Values are shown as estimated until the merchant confirms (§32.3).
-- Harvested and photo-read menus (05_harvested_menus.json, 06_photo_menus.json) load as seed drafts through the
-- existing Shouf load (scripts/vendors/build-shouf.ts), with their source_url and captured_at: no schema change.

select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'session F: menu harvest and Open Food Facts (DECISIONS §39.4, §39.5)', false);

-- 1. Seed photo classes ------------------------------------------------------------------------------------------
alter table public.vendor_photos
  add column content_kind text check (content_kind in ('menu', 'food', 'drink', 'storefront', 'interior', 'people', 'other')),
  add column content_confidence numeric(3, 2) check (content_confidence between 0 and 1),
  add column content_model text check (char_length(content_model) <= 80);
comment on column public.vendor_photos.content_kind is
  'What a seed photo shows, from the photo model (DECISIONS §39.4 source 3); internal, never shown.';

create table app_private.seed_photo_classes (
  origin_hash text, place_id text, kind text, confidence numeric, model text, classified_on date
);
revoke all on table app_private.seed_photo_classes from public, anon, authenticated;

create function app_private.photo_classes_load(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'seed photo classes ' || left(p_sha256, 12) || ' (DECISIONS §39.4)', true);
  update public.vendor_photos ph
  set content_kind = c.kind, content_confidence = least(greatest(c.confidence, 0), 1), content_model = left(c.model, 80)
  from app_private.seed_photo_classes c join public.vendors v on v.place_id = c.place_id
  where ph.vendor_id = v.id and ph.origin_hash = c.origin_hash and ph.source = 'seed'
    and c.kind in ('menu', 'food', 'drink', 'storefront', 'interior', 'people', 'other')
    and (ph.content_kind, ph.content_confidence, ph.content_model)
        is distinct from (c.kind, least(greatest(c.confidence, 0), 1)::numeric(3, 2), left(c.model, 80));
  get diagnostics n = row_count;
  insert into app_private.seed_loads (name, sha256, loaded_at, counts)
  values ('photo_classes', p_sha256, now(), jsonb_build_object('rows', (select count(*) from app_private.seed_photo_classes),
    'updated', n, 'menu_photos', (select count(*) from public.vendor_photos where content_kind = 'menu')))
  on conflict (name) do update set sha256 = excluded.sha256, loaded_at = excluded.loaded_at, counts = excluded.counts;
  return (select counts from app_private.seed_loads where name = 'photo_classes');
end;
$$;
revoke all on function app_private.photo_classes_load(text) from public, anon, authenticated;

-- 2. Models ------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('ai_photo_classify_model', '"claude-haiku-5-5"', now(), 'Model that sorts seed photos (menu or not) before the menu reader (DECISIONS §38.4, §39.4 source 3)', null),
  ('off_cache_days', '30', now(), 'Days an Open Food Facts answer is reused before asking OFF again (DECISIONS §39.5)', null);

-- 3. Open Food Facts cache -----------------------------------------------------------------------------------------
create table public.off_products (
  barcode text primary key check (barcode ~ '^([0-9]{8}|[0-9]{12,14})$'),
  found boolean not null,
  name text check (char_length(name) <= 160),
  brand text check (char_length(brand) <= 80),
  quantity text check (char_length(quantity) <= 40),
  allergens public.allergen[] not null default '{}',
  ingredients_text text check (char_length(ingredients_text) <= 2000),
  nutriscore_grade text check (nutriscore_grade ~ '^[a-e]$'),
  energy_kcal_100g integer check (energy_kcal_100g between 0 and 999),
  image_url text check (image_url ~ '^https://([a-z0-9-]+\.)*openfoodfacts\.org/'),
  -- ODbL: the data stays in this table with its attribution (§39.5).
  license text not null default 'ODbL-1.0' check (license = 'ODbL-1.0'),
  attribution text not null default 'Open Food Facts contributors, https://world.openfoodfacts.org',
  fetched_at timestamptz not null default now()
);
alter table public.off_products enable row level security;
revoke all on table public.off_products from public, anon, authenticated;
grant select on table public.off_products to authenticated;
grant select, insert, update on table public.off_products to service_role;
create policy off_products_operator_read on public.off_products for select to authenticated
  using ((select app_private.is_operator()));

-- The cached answer while it is fresh (off_cache_days), else null (the caller asks OFF and writes it back).
create function public.off_product_get(p_barcode text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(o) - 'license' - 'attribution' - 'fetched_at'
  from public.off_products o
  where o.barcode = p_barcode
    and o.fetched_at > now() - make_interval(days => coalesce(public.config_numeric('off_cache_days'), 30)::integer);
$$;

-- Writes what OFF answered (normalised by supabase/functions/_shared/open-food-facts.ts); unknown allergens are dropped.
create function public.off_product_put(p_product jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allergens public.allergen[] := array(
    select a::public.allergen from jsonb_array_elements_text(coalesce(p_product -> 'allergens', '[]')) a
    where a in (select unnest(enum_range(null::public.allergen))::text));
begin
  insert into public.off_products (barcode, found, name, brand, quantity, allergens, ingredients_text, nutriscore_grade,
    energy_kcal_100g, image_url, fetched_at)
  values (p_product ->> 'barcode', coalesce((p_product ->> 'found')::boolean, false), p_product ->> 'name',
    p_product ->> 'brand', p_product ->> 'quantity', v_allergens, p_product ->> 'ingredients_text',
    p_product ->> 'nutriscore_grade', (p_product ->> 'energy_kcal_100g')::integer, p_product ->> 'image_url', now())
  on conflict (barcode) do update
    set found = excluded.found, name = excluded.name, brand = excluded.brand, quantity = excluded.quantity,
        allergens = excluded.allergens, ingredients_text = excluded.ingredients_text,
        nutriscore_grade = excluded.nutriscore_grade, energy_kcal_100g = excluded.energy_kcal_100g,
        image_url = excluded.image_url, fetched_at = excluded.fetched_at;
end;
$$;
revoke all on function public.off_product_get(text) from public, anon, authenticated;
revoke all on function public.off_product_put(jsonb) from public, anon, authenticated;
grant execute on function public.off_product_get(text) to service_role;
grant execute on function public.off_product_put(jsonb) to service_role;

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
