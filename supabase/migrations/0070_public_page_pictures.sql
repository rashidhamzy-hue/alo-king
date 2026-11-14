-- 0070 (session P2): product pictures from public pages. Founder decision of 14 November 2026 (docs/DECISIONS.md,
-- "Product pictures from public pages"): a customer-facing picture may come from any public web page (a brand's site, a
-- retailer, Open Food Facts), with the recorded licence value `public_page`. The founder accepts the risk.
--
-- What changes: a new source kind and licence, both `public_page`, and product_image_licence_usable() accepts it.
-- What does not change:
--   - a person approves every picture before a customer sees it (review_product_image; product_image_for_customer returns
--     approved pictures only). Nothing in this migration, or in the loader, approves anything;
--   - the picture's own address AND the page it was on are stored with every public_page picture (a check constraint);
--   - a withdrawn picture is gone at once: rejecting an approved picture takes it away (0050);
--   - licence `unknown` (P1's web search results) stays off the customer side. Only pictures a research file names, with
--     its page, are filed as public_page (scripts/product-data/load-research.mjs);
--   - invariant 2: nothing here adds `image` to the gateway allowlist.

-- 0050 wrote its three licence checks inline, so Postgres named them. Find them by what they say and replace them.
do $$ declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'product_images'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%web_search%' or pg_get_constraintdef(oid) like '%''unknown''%') loop
    execute format('alter table product_images drop constraint %I', c.conname);
  end loop;
end $$;

alter table product_images add constraint product_images_source_kind_check
  check (source_kind in ('open_food_facts', 'brand_site', 'web_search', 'intake_photo', 'public_page'));
alter table product_images add constraint product_images_licence_check
  check (licence in ('cc_by_sa', 'brand_own', 'own_photo', 'unknown', 'public_page'));
-- The source still decides the licence.
alter table product_images add constraint product_images_source_licence_check
  check ((source_kind = 'open_food_facts' and licence = 'cc_by_sa')
      or (source_kind = 'brand_site'      and licence = 'brand_own')
      or (source_kind = 'web_search'      and licence = 'unknown')
      or (source_kind = 'intake_photo'    and licence = 'own_photo')
      or (source_kind = 'public_page'     and licence = 'public_page'));
-- "The source address is stored with every picture": the picture's address and the page it was shown on.
alter table product_images add constraint product_images_public_page_has_page
  check (licence <> 'public_page' or (coalesce(source_url, '') ~ '^https://' and coalesce(page_url, '') ~ '^https://'));

-- The one list of licences a customer may see. public_page joins it by the founder's decision; unknown is still not in it.
create or replace function product_image_licence_usable(p_licence text) returns boolean language sql immutable as $$
  select p_licence in ('cc_by_sa', 'brand_own', 'own_photo', 'public_page') $$;

-- Same function as 0050, with the new source kind. The licence follows from the source kind; a person's earlier rejection
-- of the same bytes is respected; a second proposal replaces the first only when asked to.
create or replace function propose_product_image(
  p_product uuid, p_source_kind text, p_source_url text, p_page_url text, p_attribution text,
  p_media_path text, p_sha256 text, p_width int, p_height int, p_bytes int, p_vision jsonb default '{}',
  p_by uuid default null, p_replace boolean default false)
returns jsonb language plpgsql as $$
declare v_licence text; v_old product_images%rowtype; v_id uuid;
begin
  if p_by is not null and not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then
    raise exception 'NOT_AUTHORISED';
  end if;
  v_licence := case p_source_kind when 'open_food_facts' then 'cc_by_sa' when 'brand_site' then 'brand_own'
                                  when 'web_search' then 'unknown' when 'intake_photo' then 'own_photo'
                                  when 'public_page' then 'public_page' end;
  if v_licence is null then raise exception 'IMAGE_SOURCE_KIND %', p_source_kind; end if;
  if v_licence = 'public_page' and (coalesce(p_source_url, '') !~ '^https://' or coalesce(p_page_url, '') !~ '^https://') then
    raise exception 'PUBLIC_PAGE_NEEDS_ADDRESSES: the picture''s address and its page, both https';
  end if;
  if exists (select 1 from product_images where product_id = p_product and sha256 = p_sha256 and status = 'rejected') then
    return jsonb_build_object('ok', false, 'skipped', 'rejected_before');
  end if;
  select * into v_old from product_images where product_id = p_product and status = 'proposed' for update;
  if found then
    if not p_replace then return jsonb_build_object('ok', false, 'skipped', 'proposal_exists', 'image_id', v_old.id); end if;
    update product_images set status = 'superseded' where id = v_old.id;
  end if;
  insert into product_images(product_id, source_kind, licence, source_url, page_url, attribution, media_path, sha256,
                             width_px, height_px, bytes, vision, proposed_by)
    values (p_product, p_source_kind, v_licence, p_source_url, p_page_url, p_attribution, p_media_path, p_sha256,
            p_width, p_height, p_bytes, coalesce(p_vision, '{}'), p_by) returning id into v_id;
  return jsonb_build_object('ok', true, 'image_id', v_id, 'licence', v_licence, 'customer_licence', product_image_licence_usable(v_licence));
end $$;

-- Counts for the run report: 0050's, plus the public-page pictures.
create or replace function product_image_coverage() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'items', count(*),
    'approved', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence))),
    'proposed_usable', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed' and product_image_licence_usable(i.licence))),
    'open_food_facts', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'open_food_facts')),
    'brand_site', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'brand_site')),
    'public_page', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'public_page')),
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
