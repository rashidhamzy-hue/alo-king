-- Rollback of 20261016120000_photo_sources.sql: back to merchant / merchant_site / illustrative, no license columns, and the
-- catalogue showing every item (the image route then has no tile to draw for an item without a photo: run the previous
-- demo-photos script, which draws them). Packshot rows are deleted (the previous script makes illustrations instead).
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: item photo sources packshot, license and credit', true);

delete from public.menu_item_photos where source = 'packshot';

alter table public.menu_item_photos
  drop constraint menu_item_photos_path_source,
  drop constraint menu_item_photos_source_check,
  drop constraint menu_item_photos_storage_path_check,
  drop column license,
  drop column credit,
  drop column source_url;

alter table public.menu_item_photos
  add constraint menu_item_photos_storage_path_check
    check (storage_path ~ '^(merchant|merchant_site|illustrative)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  add constraint menu_item_photos_source_check check (source in ('merchant', 'merchant_site', 'illustrative')),
  add constraint menu_item_photos_path_source check (storage_path like source || '/%');

drop function public.menu_item_photo_set(uuid, text, text, text, text, text, text);
create function public.menu_item_photo_set(p_item_id uuid, p_source text, p_storage_path text, p_origin_hash text)
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
  insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash)
  values (p_item_id, v_vendor, p_storage_path, p_source, p_origin_hash)
  on conflict (item_id) do update set storage_path = excluded.storage_path, source = excluded.source,
    origin_hash = excluded.origin_hash
  where menu_item_photos.source <> 'merchant';
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.menu_item_photo_set(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.menu_item_photo_set(uuid, text, text, text) to service_role;

create or replace function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(case when i.name_ar is not null and i.name_en is not null and i.name_ar <> i.name_en
                        then i.name_ar || ' · ' || i.name_en else coalesce(i.name_ar, i.name_en, i.name_fr) end, 150),
      'name_en', i.name_en,
      'description', left(coalesce(nullif(i.description, ''), s.name_en, s.name_ar, coalesce(v.name_en, v.name_ar)),
                          case when i.pricing_unit = 'kg' then 450 else 500 end)
                     || case when i.pricing_unit = 'kg' then ' (≈ ' || i.est_weight_kg || ' kg, final by weight)' else '' end,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', (select p.storage_path from public.menu_item_photos p where p.item_id = i.id))
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active';
$$;
