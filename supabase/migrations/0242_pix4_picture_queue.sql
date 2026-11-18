-- 0242 (session PIX4): the founder's own product pictures into PIX3's approval queue.
-- The founder supplied the pictures (release "pictures-1"); the report that came with them records no picture address and no page
-- address for any of them. They cannot be filed as `public_page` (that needs both addresses, 0070), as `intake_photo` (our own photograph:
-- not known) or as `web_search` (never shown). So:
--   * a new source kind `founder_upload` with licence `founder_supplied`. It joins the licences a customer may see **only because a person
--     approves each picture** (review_product_image, unchanged) and the founder accepted the risk of public pictures on 14 November
--     (docs/RULES.md, "Pictures"); withdrawn at once on objection (reject). Nothing here approves anything.
--   * the queue learns three things a person needs: why a picture needs a second look (`needs_review`, `check_notes`), where it came from
--     when there is no address (`source_note`), and "Later" (`deferred_at`: a picture put aside, shown after the others).
--   * `pictures_missing()`: active items with no approved or proposed picture, by aisle (the console's "needs a photo" list; the front
--     photo on label day closes each one).
--   * `storage_bucket_bytes()`: the size of a bucket, for the import's report and its 40 MB ceiling.

alter table product_images add column if not exists source_note  text;
alter table product_images add column if not exists needs_review boolean not null default false;
alter table product_images add column if not exists check_notes  text[] not null default '{}';
alter table product_images add column if not exists deferred_at  timestamptz;

-- The checks of 0050 and 0070 learn the new kind. Found by what they say, as 0070 did.
do $$ declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'product_images'::regclass and contype = 'c'
              and (conname in ('product_images_source_kind_check', 'product_images_licence_check', 'product_images_source_licence_check')
                   or pg_get_constraintdef(oid) ilike '%source_url IS NOT NULL%') loop
    execute format('alter table product_images drop constraint %I', c.conname);
  end loop;
end $$;
alter table product_images add constraint product_images_source_kind_check
  check (source_kind in ('open_food_facts', 'brand_site', 'web_search', 'intake_photo', 'public_page', 'founder_upload'));
alter table product_images add constraint product_images_licence_check
  check (licence in ('cc_by_sa', 'brand_own', 'own_photo', 'unknown', 'public_page', 'founder_supplied'));
alter table product_images add constraint product_images_source_licence_check
  check ((source_kind = 'open_food_facts' and licence = 'cc_by_sa')
      or (source_kind = 'brand_site'      and licence = 'brand_own')
      or (source_kind = 'web_search'      and licence = 'unknown')
      or (source_kind = 'intake_photo'    and licence = 'own_photo')
      or (source_kind = 'public_page'     and licence = 'public_page')
      or (source_kind = 'founder_upload'  and licence = 'founder_supplied'));
-- A picture has an address, unless it is our own photograph or the founder's upload (then the note says where it came from).
alter table product_images add constraint product_images_has_source
  check (source_kind in ('intake_photo', 'founder_upload') or source_url is not null);
alter table product_images add constraint product_images_founder_upload_has_note
  check (source_kind <> 'founder_upload' or coalesce(btrim(source_note), '') <> '');

create or replace function product_image_licence_usable(p_licence text) returns boolean language sql immutable as $$
  select p_licence in ('cc_by_sa', 'brand_own', 'own_photo', 'public_page', 'founder_supplied') $$;

-- The import: one picture proposed, never approved. The licence follows from the kind (as in 0070). An addressed source keeps both addresses.
-- A picture the person rejected before (same bytes) is not proposed again; an existing proposal or approval is never replaced here.
create or replace function propose_picture_import(
  p_product uuid, p_media_path text, p_sha256 text, p_width int, p_height int, p_bytes int,
  p_source_note text, p_source_url text default null, p_page_url text default null,
  p_needs_review boolean default false, p_check_notes text[] default '{}', p_vision jsonb default '{}')
returns jsonb language plpgsql as $$
declare v_id uuid; v_old product_images%rowtype;
begin
  if coalesce(btrim(p_source_note), '') = '' then raise exception 'PICTURE_IMPORT_NEEDS_A_SOURCE_NOTE'; end if;
  if p_source_url is not null and p_source_url !~ '^https://' then raise exception 'PICTURE_IMPORT_ADDRESS_NOT_HTTPS'; end if;
  if p_page_url   is not null and p_page_url   !~ '^https://' then raise exception 'PICTURE_IMPORT_ADDRESS_NOT_HTTPS'; end if;
  if exists (select 1 from product_images where product_id = p_product and status = 'approved') then
    return jsonb_build_object('ok', false, 'skipped', 'already_approved');
  end if;
  if exists (select 1 from product_images where product_id = p_product and sha256 = p_sha256 and status = 'rejected') then
    return jsonb_build_object('ok', false, 'skipped', 'rejected_before');
  end if;
  select * into v_old from product_images where product_id = p_product and status = 'proposed' for update;
  if found then
    if v_old.source_kind = 'founder_upload' then
      -- Run again: the earlier import's proposal is replaced by this one (history kept), unless it is the same picture.
      if v_old.sha256 = p_sha256 then return jsonb_build_object('ok', false, 'skipped', 'same_picture', 'image_id', v_old.id); end if;
      update product_images set status = 'superseded' where id = v_old.id;
    else
      return jsonb_build_object('ok', false, 'skipped', 'proposal_exists', 'image_id', v_old.id);
    end if;
  end if;
  insert into product_images(product_id, source_kind, licence, source_url, page_url, attribution, media_path, sha256,
                             width_px, height_px, bytes, vision, source_note, needs_review, check_notes)
    values (p_product, 'founder_upload', 'founder_supplied', p_source_url, p_page_url, null, p_media_path, p_sha256,
            p_width, p_height, p_bytes, coalesce(p_vision, '{}'), btrim(p_source_note), coalesce(p_needs_review, false), coalesce(p_check_notes, '{}'))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'image_id', v_id, 'needs_review', coalesce(p_needs_review, false));
end $$;

-- "Later": the picture stays proposed and goes to the back of the line; asking again with p_undo brings it back. Any staff lead.
create or replace function defer_product_image(p_image uuid, p_by uuid, p_undo boolean default false)
returns jsonb language plpgsql as $$
declare i product_images%rowtype;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into i from product_images where id = p_image for update;
  if not found then raise exception 'IMAGE_NOT_FOUND %', p_image; end if;
  if i.status <> 'proposed' then return jsonb_build_object('ok', true, 'already', true, 'status', i.status); end if;
  update product_images set deferred_at = case when p_undo then null else now() end where id = p_image;
  return jsonb_build_object('ok', true, 'already', false, 'status', i.status, 'deferred', not p_undo);
end $$;

-- The console's review list (0050) with the new columns. Same order, same keys, plus four.
create or replace function product_images_review(p_status text default 'proposed', p_limit int default 100) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'image_id', i.id, 'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
           'barcode', p.barcode, 'sell_unit', p.sell_unit, 'status', i.status, 'media_path', i.media_path,
           'source_kind', i.source_kind, 'source_url', i.source_url, 'page_url', i.page_url, 'licence', i.licence,
           'attribution', i.attribution, 'width_px', i.width_px, 'height_px', i.height_px, 'bytes', i.bytes, 'vision', i.vision,
           'customer_visible', product_image_licence_usable(i.licence),
           'fetched_at', i.fetched_at, 'reviewed_at', i.reviewed_at, 'review_note', i.review_note,
           'source_note', i.source_note, 'needs_review', i.needs_review, 'check_notes', to_jsonb(i.check_notes), 'deferred_at', i.deferred_at)
         order by (not product_image_licence_usable(i.licence)), p.sku), '[]'::jsonb)
    from (select * from product_images where status = p_status order by fetched_at limit p_limit) i join products p on p.id = i.product_id $$;

-- Active items with no approved and no proposed picture, by aisle: the "needs a photo" list. Aisle order is the shop's own.
create or replace function pictures_missing() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand, 'sell_unit', p.sell_unit,
           'aisle_code', coalesce(c.code, ''), 'aisle_en', coalesce(c.name_en, 'No aisle yet'), 'aisle_ar', coalesce(c.name_ar, 'بلا ممر بعد'),
           'rejected_before', exists (select 1 from product_images r where r.product_id = p.id and r.status = 'rejected'))
         order by coalesce(c.sort_order, 1000000), pl.sort_in_category nulls last, p.sku), '[]'::jsonb)
    from products p
    left join catalog_placements pl on pl.sku = p.sku
    left join catalog_categories c on c.code = pl.category_code
   where p.is_active and not exists (
           select 1 from product_images i where i.product_id = p.id and i.status in ('approved', 'proposed')
              and product_image_licence_usable(i.licence)) $$;

-- Bytes held by a bucket (the import's ceiling and report). Null where there is no storage schema (the test database).
create or replace function storage_bucket_bytes(p_bucket text) returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  if to_regclass('storage.objects') is null then return null; end if;
  execute 'select coalesce(sum((metadata->>''size'')::bigint), 0)::bigint from storage.objects where bucket_id = $1' into n using p_bucket;
  return n;
end $$;

-- Counts for the run report: 0070's, plus the founder's uploads and the ones waiting for a second look.
create or replace function product_image_coverage() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'items', count(*),
    'approved', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence))),
    'proposed_usable', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed' and product_image_licence_usable(i.licence))),
    'open_food_facts', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'open_food_facts')),
    'brand_site', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'brand_site')),
    'public_page', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'public_page')),
    'founder_upload', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'founder_upload')),
    'needs_review', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed' and i.needs_review)),
    'unknown_licence_only', count(*) filter (where not exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and product_image_licence_usable(i.licence))
                                               and exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved'))),
    'photograph_at_intake', jsonb_array_length(photograph_at_intake()))
    from products p where p.is_active $$;

-- Functions: service role only (see 0021).
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
