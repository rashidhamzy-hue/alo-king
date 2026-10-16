-- Session 5e (16 October, Rasheed): no drawn text tiles any more. Every demo item photo is a real photo, in this order:
-- the shop's own (merchant_site), an Open Food Facts packshot for shelf items (packshot), or one real food photo per
-- dish from a free library that allows commercial use (illustrative). Each photo records its license, credit and source.
-- The catalogue shows only items that have a photo (no generated tile); an illustrative photo says so in the product's
-- description. Illustrative, packshot and merchant_site photos go when the shop is claimed (the merchant confirms their
-- own, §15). The drawn tiles of the previous run (illustrative PNGs without a license) are deleted here; every photo but
-- a merchant's own must carry a license and a credit. Covers go through vendor_cover_set, gated like item photos.
-- Rollback: supabase/rollbacks/20261016120000_photo_sources.sql.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'item photo sources: packshot, license and credit (session 5e)', true);

alter table public.menu_item_photos
  drop constraint menu_item_photos_path_source,
  drop constraint menu_item_photos_source_check,
  drop constraint menu_item_photos_storage_path_check;

alter table public.menu_item_photos
  add constraint menu_item_photos_storage_path_check
    check (storage_path ~ '^(merchant|merchant_site|packshot|illustrative)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  add constraint menu_item_photos_source_check check (source in ('merchant', 'merchant_site', 'packshot', 'illustrative')),
  add constraint menu_item_photos_path_source check (storage_path like source || '/%'),
  add column license text check (char_length(license) <= 120),
  add column credit text check (char_length(credit) <= 200),
  add column source_url text check (char_length(source_url) <= 1000);

-- The shop's own pictures (merchant_site) are credited to the shop; the drawn tiles and anything else without a license go.
update public.menu_item_photos p
set license = coalesce(p.license, 'the shop''s own'),
    credit = coalesce(p.credit, (select left(coalesce(v.name_en, v.name_ar, 'the shop'), 200) from public.vendors v
                                 where v.id = p.vendor_id))
where p.source = 'merchant_site';
delete from public.menu_item_photos
where source <> 'merchant' and (license is null or credit is null or (source = 'illustrative' and storage_path like '%.png'));
alter table public.menu_item_photos
  add constraint menu_item_photos_licensed check (source = 'merchant' or (license is not null and credit is not null));
alter table public.vendor_covers
  add constraint vendor_covers_licensed check (source = 'merchant' or (license is not null and credit is not null));

comment on column public.menu_item_photos.source is
  'merchant: the merchant''s own; merchant_site: copied from the shop''s own online menu or website (demo shops); packshot: the product''s Open Food Facts front image (shelf items, demo shops); illustrative: a real photo of the dish from a free library (demo shops). Never a Google place photo (DECISIONS §38.1).';

drop function public.menu_item_photo_set(uuid, text, text, text);
-- Records a photo the script uploaded (demo shops only), with its license; never replaces a merchant's own.
create function public.menu_item_photo_set(p_item_id uuid, p_source text, p_storage_path text, p_origin_hash text,
  p_license text default null, p_credit text default null, p_source_url text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor uuid;
begin
  select i.vendor_id into v_vendor from public.menu_items i where i.id = p_item_id;
  if v_vendor is null then
    return jsonb_build_object('status', 'no_item');
  end if;
  if p_source <> 'merchant' and not app_private.vendor_is_demo(v_vendor) then
    return jsonb_build_object('status', 'not_demo');
  end if;
  -- The object is this item's own, under its source's folder.
  if p_storage_path is null
     or p_storage_path !~ ('^' || p_source || '/' || v_vendor || '/' || p_item_id || '\.(png|jpg|webp)$') then
    return jsonb_build_object('status', 'bad_path');
  end if;
  if p_source <> 'merchant' and (nullif(trim(p_license), '') is null or nullif(trim(p_credit), '') is null) then
    return jsonb_build_object('status', 'no_license');
  end if;
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'item photo (DECISIONS §39.12 demo mode)', true);
  insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash, license, credit, source_url)
  values (p_item_id, v_vendor, p_storage_path, p_source, p_origin_hash, left(p_license, 120), left(p_credit, 200),
          left(p_source_url, 1000))
  on conflict (item_id) do update set storage_path = excluded.storage_path, source = excluded.source,
    origin_hash = excluded.origin_hash, license = excluded.license, credit = excluded.credit, source_url = excluded.source_url
  where menu_item_photos.source <> 'merchant';
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.menu_item_photo_set(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.menu_item_photo_set(uuid, text, text, text, text, text, text) to service_role;

-- Removes a demo photo that no longer has a pick (never a merchant's own); the script deletes the object after.
create function public.menu_item_photo_clear(p_item_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_path text;
begin
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'item photo without a pick (DECISIONS §39.13)', true);
  delete from public.menu_item_photos p
  where p.item_id = p_item_id and p.source <> 'merchant' and app_private.vendor_is_demo(p.vendor_id)
  returning p.storage_path into v_path;
  return jsonb_build_object('status', case when v_path is null then 'none' else 'ok' end, 'path', v_path);
end;
$$;
revoke all on function public.menu_item_photo_clear(uuid) from public, anon, authenticated;
grant execute on function public.menu_item_photo_clear(uuid) to service_role;

-- A demo shop's cover (its own photo or its signature dish), licensed and credited; a null path removes it. Never
-- replaces or removes a merchant's own.
create function public.vendor_cover_set(p_vendor_id uuid, p_source text, p_storage_path text, p_origin_hash text,
  p_license text, p_credit text, p_source_url text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private.vendor_is_demo(p_vendor_id) then
    return jsonb_build_object('status', 'not_demo');
  end if;
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'shop cover (DECISIONS §39.13 demo mode)', true);
  if p_storage_path is null then
    delete from public.vendor_covers where vendor_id = p_vendor_id and source <> 'merchant';
    return jsonb_build_object('status', 'ok');
  end if;
  if p_source is null or p_source not in ('merchant_site', 'illustrative') then
    return jsonb_build_object('status', 'bad_source');
  end if;
  if p_storage_path !~ ('^cover/' || p_vendor_id || '\.(jpg|png)$') then
    return jsonb_build_object('status', 'bad_path');
  end if;
  if nullif(trim(p_license), '') is null or nullif(trim(p_credit), '') is null then
    return jsonb_build_object('status', 'no_license');
  end if;
  insert into public.vendor_covers (vendor_id, storage_path, source, license, credit, source_url, origin_hash)
  values (p_vendor_id, p_storage_path, p_source, left(p_license, 120), left(p_credit, 200), left(p_source_url, 1000),
          p_origin_hash)
  on conflict (vendor_id) do update set storage_path = excluded.storage_path, source = excluded.source,
    license = excluded.license, credit = excluded.credit, source_url = excluded.source_url,
    origin_hash = excluded.origin_hash, updated_at = now()
  where public.vendor_covers.source <> 'merchant';
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.vendor_cover_set(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.vendor_cover_set(uuid, text, text, text, text, text, text) to service_role;

-- A photo made again under the same path (a new pick, new processing) changes what Meta shows too.
drop trigger menu_item_photos_catalog_sync on public.menu_item_photos;
create trigger menu_item_photos_catalog_sync after insert or update of storage_path, origin_hash or delete
  on public.menu_item_photos for each row execute function app_private.catalog_photo_changed();

create or replace function app_private.vendors_drop_demo_photos() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.claim_status = 'claimed' and old.claim_status is distinct from 'claimed' and not app_private.vendor_is_demo(new.id) then
    delete from public.menu_item_photos where vendor_id = new.id and source in ('illustrative', 'merchant_site', 'packshot');
    delete from public.vendor_covers where vendor_id = new.id and source <> 'merchant';
  end if;
  return new;
end;
$$;
revoke all on function app_private.vendors_drop_demo_photos() from public;

-- The catalogue: only items with a photo (nothing is drawn any more). An illustrative photo says so in Arabic and English;
-- a CC BY or CC BY-SA photo carries its credit and license. The description stays within Meta's 500 characters, the
-- notes kept whole (498 characters, so the two-unit 📷 never pushes the end past 500 UTF-16 units). photo_hash
-- changes when a photo is made again under the same path, so Meta gets the new image.
create or replace function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(case when i.name_ar is not null and i.name_en is not null and i.name_ar <> i.name_en
                        then i.name_ar || ' · ' || i.name_en else coalesce(i.name_ar, i.name_en, i.name_fr) end, 150),
      'name_en', i.name_en,
      'description', left(coalesce(nullif(i.description, ''), s.name_en, s.name_ar, coalesce(v.name_en, v.name_ar)),
                          greatest(60, 498 - char_length(n.note))) || n.note,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', p.storage_path,
      'photo_hash', p.origin_hash)
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_sections s on s.id = i.section_id
  cross join lateral (select
      case when i.pricing_unit = 'kg' then ' (≈ ' || i.est_weight_kg || ' kg, final by weight)' else '' end
      || case when p.source = 'illustrative' then ' · صورة توضيحية · Photo for illustration' else '' end
      || case when p.license ~* '^CC BY' then ' · 📷 ' || left(regexp_replace(p.credit, '\s+', ' ', 'g'), 80) || ' · ' || p.license
              else '' end as note) n
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active';
$$;
