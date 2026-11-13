-- 0050 (session P1, build plan 5.17): product pictures, fetched by the system and approved by a person.
-- A script (scripts/images/, run by .github/workflows/images.yml) proposes at most one picture per catalog item, saved in the
-- private `media` bucket with its source address and licence. A person approves or rejects it (the console page is 3.18).
-- Only approved pictures with a licence we may show leave the database, through product_image_for_customer().
--
-- Licence rules (5.17 step 4), enforced here and not in the script:
--   open_food_facts -> cc_by_sa   (CC BY-SA: the attribution is kept and must travel with the picture)
--   brand_site      -> brand_own  (the brand's own site)
--   web_search      -> unknown    (search results and other shops: may guide the intake photo, never shown to customers)
--   intake_photo    -> own_photo  (our own photograph, taken at intake; goes through the same approval)
-- The source decides the licence (a check constraint), so a search result cannot be filed as usable.
-- product_image_licence_usable() is the single list of licences a customer may see. When the lawyer's line (5.11) allows
-- search pictures, a later migration changes that one function. Nobody changes it by a settings write.
-- Invariant 2: nothing here adds `image` to the gateway allowlist. Using a picture in a message is a later Ordering task.

create table if not exists product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  status       text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  source_kind  text not null check (source_kind in ('open_food_facts', 'brand_site', 'web_search', 'intake_photo')),
  licence      text not null check (licence in ('cc_by_sa', 'brand_own', 'own_photo', 'unknown')),
  source_url   text,                                  -- the picture's address where we got it
  page_url     text,                                  -- the page it was on (the product page, the search hit's page)
  attribution  text,                                  -- required for cc_by_sa
  media_path   text not null,                         -- key in the private `media` bucket
  sha256       text not null,
  width_px     int not null check (width_px > 0),
  height_px    int not null check (height_px > 0),
  bytes        int not null check (bytes > 0),
  vision       jsonb not null default '{}',           -- what the fast-model check said, kept as the reason it was proposed
  fetched_at   timestamptz not null default now(),
  proposed_by  uuid references parties(id),           -- null = the fetch script
  reviewed_by  uuid references parties(id),
  reviewed_at  timestamptz,
  review_note  text,
  check ((source_kind = 'open_food_facts' and licence = 'cc_by_sa')
      or (source_kind = 'brand_site'      and licence = 'brand_own')
      or (source_kind = 'web_search'      and licence = 'unknown')
      or (source_kind = 'intake_photo'    and licence = 'own_photo')),
  check (source_kind = 'intake_photo' or source_url is not null),
  check (licence <> 'cc_by_sa' or attribution is not null),
  check ((reviewed_by is null) = (reviewed_at is null) or status = 'proposed' or status = 'superseded')
);
create unique index if not exists product_images_one_approved on product_images(product_id) where status = 'approved';
create unique index if not exists product_images_one_proposed on product_images(product_id) where status = 'proposed';
create index if not exists product_images_product on product_images(product_id);
create index if not exists product_images_sha on product_images(product_id, sha256);

-- What each run did for each item, so "no picture" has a reason and a second run can be compared with the first.
create table if not exists product_image_attempts (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  run_id        text not null,
  sources_tried text[] not null default '{}',
  seen          int not null default 0,               -- candidates gathered
  kept          int not null default 0,               -- candidates that passed the vision check
  outcome       text not null,                        -- proposed | none_found | none_passed | skipped_rejected | error
  detail        jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  unique (product_id, run_id)
);

insert into settings(key, value) values ('product_images', '{"signed_link_seconds": 300}') on conflict (key) do nothing;

-- The one list of licences a customer may see. Unknown is never in it.
create or replace function product_image_licence_usable(p_licence text) returns boolean language sql immutable as $$
  select p_licence in ('cc_by_sa', 'brand_own', 'own_photo') $$;

-- Items still needing a picture: no approved one a customer may see, and none proposed with a licence a customer may see.
-- p_force lists every active item. Reruns therefore do not repeat the work, or disturb what a person has already looked at.
create or replace function product_images_to_fetch(p_limit int default null, p_force boolean default false) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x->>'sku'), '[]'::jsonb) from (
    select jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
             'sell_unit', p.sell_unit, 'barcode', nullif(btrim(p.barcode), '')) as x
      from products p
     where p.is_active
       and (p_force or not exists (
              select 1 from product_images i where i.product_id = p.id and i.status in ('approved', 'proposed')
                 and product_image_licence_usable(i.licence)))
     order by p.sku limit p_limit) s $$;

-- The fetch script proposes a picture. The licence follows from the source kind. A person's earlier rejection of the same
-- bytes is respected. A second proposal replaces the first only when asked to (p_replace); the first is kept as history.
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
                                  when 'web_search' then 'unknown' when 'intake_photo' then 'own_photo' end;
  if v_licence is null then raise exception 'IMAGE_SOURCE_KIND %', p_source_kind; end if;
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

create or replace function record_product_image_attempt(
  p_product uuid, p_run text, p_sources text[], p_seen int, p_kept int, p_outcome text, p_detail jsonb default '{}')
returns void language sql as $$
  insert into product_image_attempts(product_id, run_id, sources_tried, seen, kept, outcome, detail)
    values (p_product, p_run, coalesce(p_sources, '{}'), p_seen, p_kept, p_outcome, coalesce(p_detail, '{}'))
  on conflict (product_id, run_id) do update
    set sources_tried = excluded.sources_tried, seen = excluded.seen, kept = excluded.kept, outcome = excluded.outcome, detail = excluded.detail $$;

-- The ops lead or an admin approves or rejects a proposed picture (or withdraws an approved one by rejecting it).
-- Approving replaces the item's current approved picture, which is kept as history. Same decision twice changes nothing.
create or replace function review_product_image(p_image uuid, p_by uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql as $$
declare i product_images%rowtype; v_old uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'IMAGE_DECISION %', p_decision; end if;
  select * into i from product_images where id = p_image for update;
  if not found then raise exception 'IMAGE_NOT_FOUND %', p_image; end if;
  if i.status = 'superseded' then raise exception 'IMAGE_SUPERSEDED %', p_image; end if;
  if (p_decision = 'approve' and i.status = 'approved') or (p_decision = 'reject' and i.status = 'rejected') then
    return jsonb_build_object('ok', true, 'already', true, 'status', i.status);
  end if;
  if p_decision = 'approve' then
    if i.status = 'rejected' then raise exception 'IMAGE_REJECTED: propose it again to bring it back'; end if;
    select id into v_old from product_images where product_id = i.product_id and status = 'approved' for update;
    if v_old is not null then update product_images set status = 'superseded' where id = v_old; end if;
    update product_images set status = 'approved', reviewed_by = p_by, reviewed_at = now(), review_note = p_note where id = p_image;
    return jsonb_build_object('ok', true, 'already', false, 'status', 'approved', 'replaced', v_old,
                              'customer_visible', product_image_licence_usable(i.licence));
  end if;
  update product_images set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = p_note where id = p_image;
  return jsonb_build_object('ok', true, 'already', false, 'status', 'rejected');
end $$;

-- The console's review list (3.18): the item and its picture side by side, with source and licence.
-- customer_visible says whether approving it would show it to customers; unknown licence never would.
create or replace function product_images_review(p_status text default 'proposed', p_limit int default 100) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'image_id', i.id, 'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
           'barcode', p.barcode, 'sell_unit', p.sell_unit, 'status', i.status, 'media_path', i.media_path,
           'source_kind', i.source_kind, 'source_url', i.source_url, 'page_url', i.page_url, 'licence', i.licence,
           'attribution', i.attribution, 'width_px', i.width_px, 'height_px', i.height_px, 'bytes', i.bytes, 'vision', i.vision,
           'customer_visible', product_image_licence_usable(i.licence),
           'fetched_at', i.fetched_at, 'reviewed_at', i.reviewed_at, 'review_note', i.review_note)
         order by (not product_image_licence_usable(i.licence)), p.sku), '[]'::jsonb)
    from (select * from product_images where status = p_status order by fetched_at limit p_limit) i join products p on p.id = i.product_id $$;

-- THE customer-side function. An item's picture only when it is approved, its licence is one a customer may see, and the
-- item is active. Never proposed, rejected, superseded or licence-unknown. Returns the storage key, the attribution that must
-- be shown with a CC BY-SA picture, and how long a link may live. The link itself is made from the key with the Storage API's
-- signed-URL call (service role; scripts/images/sign.mjs is a tested example). SQL cannot sign: the key is the project's.
create or replace function product_image_for_customer(p_product uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('image_id', i.id, 'product_id', i.product_id, 'bucket', 'media', 'media_path', i.media_path,
           'licence', i.licence, 'attribution', i.attribution, 'source_url', i.source_url, 'width_px', i.width_px, 'height_px', i.height_px,
           'signed_link_seconds', coalesce((select (value->>'signed_link_seconds')::int from settings where key = 'product_images'), 300))
    from product_images i join products p on p.id = i.product_id
   where i.product_id = p_product and i.status = 'approved' and product_image_licence_usable(i.licence) and p.is_active
   limit 1 $$;

-- The "photograph at intake" list (5.15, 5.17 step 8): active items with no approved, customer-usable picture and no usable
-- proposal waiting. `guide` is a picture that may help the person with the camera (never shown to customers).
create or replace function photograph_at_intake() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand, 'barcode', p.barcode,
           'reason', case when exists (select 1 from product_images r where r.product_id = p.id and r.status = 'rejected') then 'rejected'
                          when g.id is not null then 'unknown_licence_only' else 'none_found' end,
           'guide', case when g.id is null then null else jsonb_build_object('media_path', g.media_path, 'source_url', g.source_url,
                      'page_url', g.page_url, 'licence', g.licence) end) order by p.sku), '[]'::jsonb)
    from products p
    left join lateral (select * from product_images g where g.product_id = p.id and g.status in ('proposed', 'approved')
                          and not product_image_licence_usable(g.licence) order by g.fetched_at desc limit 1) g on true
   where p.is_active and not exists (
           select 1 from product_images i where i.product_id = p.id and i.status in ('approved', 'proposed')
              and product_image_licence_usable(i.licence)) $$;

-- Counts for the run report and the done-when check.
create or replace function product_image_coverage() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'items', count(*),
    'approved', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence))),
    'proposed_usable', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed' and product_image_licence_usable(i.licence))),
    'open_food_facts', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'open_food_facts')),
    'brand_site', count(*) filter (where exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and i.source_kind = 'brand_site')),
    'unknown_licence_only', count(*) filter (where not exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved') and product_image_licence_usable(i.licence))
                                               and exists (select 1 from product_images i where i.product_id = p.id and i.status in ('proposed', 'approved'))),
    'photograph_at_intake', jsonb_array_length(photograph_at_intake()))
    from products p where p.is_active $$;

-- New tables: row level security on, no client grants. Functions: service role only (see 0021).
do $$ declare t text; r text;
begin
  foreach t in array array['product_images', 'product_image_attempts'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
