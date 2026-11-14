-- Alo King Chouf, session A5 (infra): the public `catalog` bucket for approved product pictures (AUDIT-G1 point 8).
--
-- Meta wants a stable address for each product picture. The feed used to sign week-long links into the private `media` bucket
-- (catalog-feed.ts); a link that expires is not stable. So the pictures Meta shows live in a second, PUBLIC bucket, `catalog`,
-- and the rule that keeps it safe is written down here, in one place:
--
--   * The bucket holds a copy of a picture if and only if that picture is the item's APPROVED picture, its licence is one a
--     customer may see (product_image_licence_usable), and the item is active. Nothing else is ever copied there: not a proposed
--     picture, not a rejected or superseded one, not a search-result picture of unknown licence, and never anything from
--     payment_proofs/, voice_notes/ or any other folder of `media` (receipts and voice notes stay private: CLAUDE.md).
--   * The copy happens after approval and the removal after withdrawal (review_product_image 'reject', a newer approval that
--     supersedes it, the item going inactive, a licence that stops being usable). The database cannot touch storage, so it keeps
--     the books and the Worker does the copying every minute (apps/gateway/src/catalog-feed.ts, syncCatalogPictures):
--         catalog_picture_work()      what to copy and what to remove, computed from the picture table, never from the bucket
--         catalog_picture_copied()    the copy is in the bucket; from now the feed may give its public address
--         catalog_picture_removed()   the copy is gone
--     An hourly pass also removes anything in the bucket the books do not know (catalog_picture_strays) and forgets a book entry
--     whose object has gone (catalog_picture_forget).
--   * The feed shows a public address only for a picture that is currently approved AND recorded as copied. A withdrawn picture
--     leaves the feed at the same moment as the database learns of the withdrawal (it is not approved any more), before the
--     object is removed; a picture approved a moment ago is not in the feed until its copy is in the bucket.
--   * The address is stable: <sku>-<image id>.<ext> at the bucket's root (flat, so a listing is one call). A new approved
--     picture has a new image id, so Meta never keeps showing an old picture at an address that now means another.
--
-- catalog_feed() keeps its rows and adds `public_path`; the Worker turns it into the address with the project's own URL.

create table if not exists catalog_public_pictures (
  image_id     uuid primary key,                 -- product_images.id. No foreign key: a row must outlive a deleted image until its object is removed
  product_id   uuid not null,
  public_path  text not null unique,             -- key in the public `catalog` bucket
  copied_at    timestamptz not null default now()
);
alter table catalog_public_pictures enable row level security;

-- The one place the public key is made. Extension from the private key; a picture with none or an odd one is stored as .jpg.
create or replace function catalog_public_path(p_sku text, p_image uuid, p_media_path text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select p_sku || '-' || p_image::text || '.' ||
         case when lower(substring(p_media_path from '\.([A-Za-z0-9]{2,5})$')) in ('jpg', 'jpeg', 'png', 'webp')
              then lower(substring(p_media_path from '\.([A-Za-z0-9]{2,5})$')) else 'jpg' end $$;

-- What must be in the public bucket: the single place that decides "public". Everything else (work, feed, strays) reads it.
create or replace function catalog_public_expected() returns table (image_id uuid, product_id uuid, sku text, media_path text, public_path text)
language sql stable set search_path = public, pg_temp as $$
  select i.id, i.product_id, p.sku, i.media_path, catalog_public_path(p.sku, i.id, i.media_path)
    from product_images i join products p on p.id = i.product_id
   where i.status = 'approved' and product_image_licence_usable(i.licence) and p.is_active $$;

-- The Worker's job list. copy: expected and not yet recorded. remove: recorded and no longer expected.
create or replace function catalog_picture_work() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'copy', coalesce((select jsonb_agg(jsonb_build_object('image_id', e.image_id, 'media_path', e.media_path, 'public_path', e.public_path) order by e.sku)
                        from catalog_public_expected() e
                       where not exists (select 1 from catalog_public_pictures c where c.image_id = e.image_id)), '[]'::jsonb),
    'remove', coalesce((select jsonb_agg(jsonb_build_object('image_id', c.image_id, 'public_path', c.public_path) order by c.copied_at)
                          from catalog_public_pictures c
                         where not exists (select 1 from catalog_public_expected() e where e.image_id = c.image_id)), '[]'::jsonb)) $$;

-- The copy is in the bucket. Recorded even when the picture was withdrawn while it was being copied: the next work list then
-- removes it. (Refusing to record would leave a public object that nothing knows about until the hourly pass.)
create or replace function catalog_picture_copied(p_image uuid) returns text language plpgsql set search_path = public, pg_temp as $$
declare v_path text;
begin
  select catalog_public_path(p.sku, i.id, i.media_path) into v_path
    from product_images i join products p on p.id = i.product_id where i.id = p_image;
  if v_path is null then raise exception 'IMAGE_NOT_FOUND %', p_image; end if;
  insert into catalog_public_pictures(image_id, product_id, public_path)
    select i.id, i.product_id, v_path from product_images i where i.id = p_image
  on conflict (image_id) do nothing;
  return v_path;
end $$;

-- The object is gone from the bucket (or was never there). If the picture is expected again the next work list copies it again.
create or replace function catalog_picture_removed(p_image uuid) returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  delete from catalog_public_pictures where image_id = p_image;
  return found;
end $$;

-- The hourly pass. p_listed: the names in the bucket. Strays: in the bucket, in no book entry. (A name just copied and not yet
-- recorded is a stray for a moment: the Worker only removes strays older than ten minutes.)
create or replace function catalog_picture_strays(p_listed text[]) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(coalesce(p_listed, '{}'::text[])) x
   where not exists (select 1 from catalog_public_pictures c where c.public_path = x) $$;

-- Book entries whose object is not in the bucket: forget them, so the next work list copies them again (and the feed stops
-- offering an address that answers 404 in the meantime). Only entries older than ten minutes, so a listing taken just before a copy
-- cannot erase it.
create or replace function catalog_picture_forget(p_listed text[]) returns int language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  delete from catalog_public_pictures c
   where c.copied_at < now() - interval '10 minutes' and not (c.public_path = any (coalesce(p_listed, '{}'::text[])));
  get diagnostics n = row_count;
  return n;
end $$;

-- Numbers for the run summary and the console: what should be public, what is, what waits.
create or replace function catalog_public_report() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'expected', (select count(*) from catalog_public_expected()),
    'recorded', (select count(*) from catalog_public_pictures),
    'to_copy', jsonb_array_length(catalog_picture_work()->'copy'),
    'to_remove', jsonb_array_length(catalog_picture_work()->'remove'),
    'recorded_not_expected', (select count(*) from catalog_public_pictures c where not exists (select 1 from catalog_public_expected() e where e.image_id = c.image_id))) $$;

-- The feed, as 0085 made it, plus `public_path`: set only for a picture that is currently approved (the join below) and recorded as
-- copied. The rows are the same as before; the Worker leaves out a row with no public_path (a row without a picture is refused by Meta).
create or replace function catalog_feed() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
           'brand', coalesce(nullif(p.brand, ''), 'Alo King'),
           'price_usd', o.price_usd, 'in_stock', coalesce(l.on_hand - l.reserved, 0) > 0,
           'media_path', i.media_path, 'public_path', cp.public_path, 'attribution', i.attribution, 'licence', i.licence,
           'category_code', c.code, 'category_en', c.name_en, 'category_ar', c.name_ar,
           'subgroup_en', sg.name_en, 'subgroup_ar', sg.name_ar)
         order by c.sort_order, pl.sort_in_category), '[]'::jsonb)
    from catalog_placements pl
    join catalog_categories c on c.code = pl.category_code and c.is_active
    left join catalog_subgroups sg on sg.category_code = pl.category_code and sg.code = pl.subgroup_code
    join products p on p.sku = pl.sku and p.is_active
    join lateral (select ofr.price_usd, ofr.source_id from offers ofr join sources s on s.id = ofr.source_id
                   where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
    join product_images i on i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence)
    left join catalog_public_pictures cp on cp.image_id = i.id $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table catalog_public_pictures from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table catalog_public_pictures from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select, insert, delete on table catalog_public_pictures to service_role; end if;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
