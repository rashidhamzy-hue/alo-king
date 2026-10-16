-- Session 5e (16 October, Rasheed): no drawn text tiles any more. Every demo item photo is a real photo, in this order:
-- the shop's own (merchant_site), an Open Food Facts packshot for shelf items (packshot), or one real food photo per
-- dish from a free library that allows commercial use (illustrative). Each photo records its license, credit and source.
-- The catalogue shows only items that have a photo (no generated tile); an illustrative photo says so in the product's
-- description. Illustrative, packshot and merchant_site photos go when the shop is claimed (the merchant confirms their
-- own, §15). Rollback: supabase/rollbacks/20261016120000_photo_sources.sql.
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

-- The catalogue: only items with a photo of their own kind (nothing is drawn any more); an illustrative photo says so.
create or replace function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(case when i.name_ar is not null and i.name_en is not null and i.name_ar <> i.name_en
                        then i.name_ar || ' · ' || i.name_en else coalesce(i.name_ar, i.name_en, i.name_fr) end, 150),
      'name_en', i.name_en,
      'description', left(coalesce(nullif(i.description, ''), s.name_en, s.name_ar, coalesce(v.name_en, v.name_ar)),
                          case when i.pricing_unit = 'kg' then 400 else 450 end)
                     || case when i.pricing_unit = 'kg' then ' (≈ ' || i.est_weight_kg || ' kg, final by weight)' else '' end
                     || case when p.source = 'illustrative' then ' · Photo for illustration' else '' end,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', p.storage_path)
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active';
$$;
