-- Session E PR 3, DECISIONS §39.3: Shouf merchants that are not on Alo King yet are listed publicly, and customers can
-- ask them to join.
--
--   1. `app_private.unclaimed_listings`: the one rule for "not on Alo King yet": a seed merchant (source seed_*), not
--      claimed (unclaimed, or a claim in progress: a stranger starting a claim must not hide a shop), listing active, not
--      the staging test merchant, placed in one of the pilot merchant villages (`pilot_merchant_place_ids`, §38.1, §39.2).
--   2. Anonymous read functions for the website: public security-invoker wrappers over security-definer functions in
--      app_private (anonymous callers cannot read unclaimed vendors, the seed hours in vendor_private or the seed drafts;
--      the pattern of vendor_open_at), each with the same strict input checks as the site_* functions
--      and returning public fields only: names, category, village, cuisine tags, the seed opening-hours text and the draft
--      menu's item names and descriptions. Never a price, a rating, a photo, a phone, an address or coordinates.
--        * site_place_unclaimed(slug, page): within max_delivery_km() in a straight line of the place's centre, nearest
--          first, 24 a page (the orderable list, site_place, is unchanged and comes first on the page);
--        * site_cuisine_unclaimed(tag, page): merchants with that cuisine tag in the pilot merchant villages;
--        * site_vendor_unclaimed(slug): the noindex page of one such merchant, with its whole draft menu without prices.
--   3. "Ask them to join": the `site-claim` edge function (GET ?action=join) derives the visitor key from the platform's
--      view of the request and calls `vendor_join_request(slug, channel, visitor)` with the service role (never callable by
--      anon: a caller choosing its own key could inflate counts). It records one tap (web or bot) and returns where the
--      function redirects: the customer's own WhatsApp to the shop's seed number when it is a Lebanese mobile, else wa.me
--      with no number (the customer picks the contact). The number leaves the database only inside that wa.me address.
--      Claimed (public) and non-seed vendors are refused. Rate limited per visitor (web_rate_hit), and at most 200 recorded
--      taps per shop a day. Alo King never messages the shop itself (§25, Meta opt-in).
--   4. The claim page shows the merchant "N customers asked for you": vendor_claim_lookup gains `asked` (distinct visitors).
--   5. The bot: `vendor_search_unclaimed(query, lang)` finds such shops by name; its "Ask them to join" button points at the
--      same edge function with ch=bot.
-- No config row is added: the invitation carries the shop's claim link only once a dated `site_url` row exists (the
-- domain, #74). Nothing is deleted or truncated; no table of the frozen places and vendor set changes shape (§31).

-- 1. Who is "not on Alo King yet" ---------------------------------------------------------------------------------------
create view app_private.unclaimed_listings as
select v.id, v.slug, v.name_ar, v.name_en, v.name_fr, v.branch_label, v.business_type, v.cuisine_tags, v.town_id, v.location
from public.vendors v
where v.source like 'seed\_%' and v.claim_status <> 'claimed' and v.listing_status = 'active' and not v.is_test
  and v.town_id = any (array(select jsonb_array_elements_text(coalesce(public.config_value('pilot_merchant_place_ids'), '[]'))));
revoke all on table app_private.unclaimed_listings from public, anon, authenticated;
grant select on table app_private.unclaimed_listings to service_role;

-- The seed draft menu of a vendor (§38.2 item 2, §39.4): one per vendor, still a draft.
create function app_private.seed_draft_sections(p_vendor_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select d.sections from public.menu_drafts d
  where d.vendor_id = p_vendor_id and d.source = 'seed' and d.status = 'draft'
  order by d.created_at desc limit 1;
$$;
revoke all on function app_private.seed_draft_sections(uuid) from public, anon, authenticated;

-- One "Not on Alo King yet" card: public fields only. `hours_seed` is the opening-hours text of the seed file as it is
-- ("Monday: 8 AM to 8 PM | …"); the website formats it. `menu_preview` holds the first four item names, never a price.
create function app_private.site_unclaimed_card(p_vendor_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with d as (select app_private.seed_draft_sections(p_vendor_id) as sections),
  items as (
    select i.value as item, s.ord as s_ord, i.ord as i_ord
    from d, jsonb_array_elements(coalesce(d.sections, '[]')) with ordinality s (value, ord),
         jsonb_array_elements(coalesce(s.value -> 'items', '[]')) with ordinality i (value, ord)
  )
  select jsonb_build_object(
    'slug', u.slug, 'name_ar', u.name_ar, 'name_en', u.name_en, 'name_fr', u.name_fr, 'branch_label', u.branch_label,
    'business_type', u.business_type,
    'business_type_ar', bt.name_ar, 'business_type_en', bt.name_en, 'business_type_fr', bt.name_fr,
    'cuisine_tags', u.cuisine_tags,
    'cuisines', coalesce((
      select jsonb_agg(jsonb_build_object('tag', t.tag, 'name_ar', t.name_ar, 'name_en', t.name_en, 'name_fr', t.name_fr)
                       order by t.sort_order, t.tag)
      from public.cuisine_tags t where t.tag = any (u.cuisine_tags) and t.active), '[]'::jsonb),
    'place_slug', app_private.place_slug(u.town_id),
    'place_ar', pl.name_ar, 'place_en', pl.name_en, 'place_fr', pl.name_fr,
    'hours_seed', nullif(left(trim(vp.import_labels ->> 'hours_seed'), 600), ''),
    'menu_items', (select count(*) from items),
    'menu_preview', coalesce((
      select jsonb_agg(jsonb_build_object('name_ar', left(x.item ->> 'name_ar', 120), 'name_en', left(x.item ->> 'name_en', 120),
                                          'name_fr', left(x.item ->> 'name_fr', 120)) order by x.s_ord, x.i_ord)
      from (select * from items order by s_ord, i_ord limit 4) x), '[]'::jsonb))
  from app_private.unclaimed_listings u
  join public.business_type_labels bt on bt.business_type = u.business_type
  left join public.places pl on pl.id = u.town_id
  left join public.vendor_private vp on vp.vendor_id = u.id
  where u.id = p_vendor_id;
$$;
revoke all on function app_private.site_unclaimed_card(uuid) from public, anon, authenticated;

-- 2. The website's lists ------------------------------------------------------------------------------------------------
-- A place page: merchants within max_delivery_km() in a straight line of the place's centre (the §39.2 rule seen from
-- the customer's side), nearest first. Null for an unknown place, a place that is off, or a bad page number.
create function app_private.site_place_unclaimed(p_slug text, p_page integer default 1) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_size constant integer := 24;
  v_id text;
  v_centre extensions.geography;
  v_m numeric := public.max_delivery_km() * 1000;
  v_total integer;
  v_vendors jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80
     or p_page is null or p_page < 1 or p_page > 100 then
    return null;
  end if;
  select p.id, p.centroid into v_id, v_centre from public.places p
  where p.id = upper('LB-' || p_slug) and p.service_status = 'on';
  if v_id is null or v_centre is null or v_m is null then
    return null;
  end if;
  select count(*) into v_total from app_private.unclaimed_listings u where extensions.st_dwithin(u.location, v_centre, v_m);
  select coalesce(jsonb_agg(app_private.site_unclaimed_card(x.id) order by x.km, x.name, x.id), '[]'::jsonb) into v_vendors
  from (
    select u.id, extensions.st_distance(u.location, v_centre) as km, coalesce(u.name_en, u.name_ar) as name
    from app_private.unclaimed_listings u
    where extensions.st_dwithin(u.location, v_centre, v_m)
    order by 2, 3, 1
    offset (p_page - 1) * c_size limit c_size
  ) x;
  return jsonb_build_object('total', v_total, 'page', p_page, 'page_size', c_size, 'vendors', v_vendors);
end;
$$;
revoke all on function app_private.site_place_unclaimed(text, integer) from public;
grant execute on function app_private.site_place_unclaimed(text, integer) to anon, authenticated, service_role;

-- A cuisine page: merchants with that tag in the pilot merchant villages, by village and name.
create function app_private.site_cuisine_unclaimed(p_tag text, p_page integer default 1) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_size constant integer := 24;
  v_total integer;
  v_vendors jsonb;
begin
  if p_tag is null or p_tag !~ '^[a-z][a-z0-9_]*$' or char_length(p_tag) > 60
     or p_page is null or p_page < 1 or p_page > 100 then
    return null;
  end if;
  if not exists (select 1 from public.cuisine_tags t where t.tag = p_tag and t.active) then
    return null;
  end if;
  select count(*) into v_total from app_private.unclaimed_listings u where p_tag = any (u.cuisine_tags);
  select coalesce(jsonb_agg(app_private.site_unclaimed_card(x.id) order by x.place, x.name, x.id), '[]'::jsonb) into v_vendors
  from (
    select u.id, coalesce(pl.name_en, pl.name_ar, u.town_id) as place, coalesce(u.name_en, u.name_ar) as name
    from app_private.unclaimed_listings u left join public.places pl on pl.id = u.town_id
    where p_tag = any (u.cuisine_tags)
    order by 2, 3, 1
    offset (p_page - 1) * c_size limit c_size
  ) x;
  return jsonb_build_object('total', v_total, 'page', p_page, 'page_size', c_size, 'vendors', v_vendors);
end;
$$;
revoke all on function app_private.site_cuisine_unclaimed(text, integer) from public;
grant execute on function app_private.site_cuisine_unclaimed(text, integer) to anon, authenticated, service_role;

-- The page of one merchant that is not on Alo King yet (served with noindex, never in a sitemap): the card, its id for
-- the claim link, and the whole draft menu as item names and descriptions. No price, no option price, no photo.
create function app_private.site_vendor_unclaimed(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120 then
    return null;
  end if;
  select u.id into v_id from app_private.unclaimed_listings u where u.slug = p_slug;
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'vendor', app_private.site_unclaimed_card(v_id) || jsonb_build_object('vendor_id', v_id),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_ar', left(s.value ->> 'name_ar', 120), 'name_en', left(s.value ->> 'name_en', 120),
        'name_fr', left(s.value ->> 'name_fr', 120),
        'items', (select jsonb_agg(jsonb_build_object(
                    'name_ar', left(i.value ->> 'name_ar', 120), 'name_en', left(i.value ->> 'name_en', 120),
                    'name_fr', left(i.value ->> 'name_fr', 120),
                    'description', nullif(left(trim(i.value ->> 'description'), 300), '')) order by i.ord)
                  from jsonb_array_elements(s.value -> 'items') with ordinality i (value, ord)
                  where coalesce(i.value ->> 'name_ar', i.value ->> 'name_en', i.value ->> 'name_fr', '') <> ''))
        order by s.ord)
      from jsonb_array_elements(coalesce(app_private.seed_draft_sections(v_id), '[]')) with ordinality s (value, ord)
      where jsonb_typeof(s.value -> 'items') = 'array' and jsonb_array_length(s.value -> 'items') > 0), '[]'::jsonb));
end;
$$;
revoke all on function app_private.site_vendor_unclaimed(text) from public;
grant execute on function app_private.site_vendor_unclaimed(text) to anon, authenticated, service_role;

-- 3. "Ask them to join" ---------------------------------------------------------------------------------------------------
-- One row per counted tap. visitor_hash is the keyed hash the `site-claim` edge function made from the visitor's address
-- as the platform saw it (HMAC-SHA256 with the function's secret pepper): never an address, never an unkeyed hash.
create table public.vendor_join_requests (
  id bigint generated always as identity primary key,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  channel text not null check (channel in ('web', 'bot')),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index vendor_join_requests_vendor_idx on public.vendor_join_requests (vendor_id, created_at);
alter table public.vendor_join_requests enable row level security;
revoke all on table public.vendor_join_requests from public, anon, authenticated;
grant all on table public.vendor_join_requests to service_role;
grant select on table public.vendor_join_requests to authenticated;
create policy vendor_join_requests_operator_read on public.vendor_join_requests for select to authenticated
  using ((select app_private.is_operator()));

-- How many different people asked a shop to join (what the claim page shows).
create function app_private.join_request_count(p_vendor_id uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct r.visitor_hash)::integer from public.vendor_join_requests r where r.vendor_id = p_vendor_id;
$$;
revoke all on function app_private.join_request_count(uuid) from public, anon, authenticated;

-- One tap on "Ask them to join", called only by the `site-claim` edge function (service role): the visitor key must come
-- from the platform's view of the request, so neither visitors nor anyone holding the public key can call this (a caller
-- that chose its own key could inflate the count or skip the limit). p_visitor is that function's 64-hex HMAC of the
-- visitor's address; it is both the stored hash and the rate key. Answers:
--   {status: ok, wa_url, vendor_id, name_*, counted, site_url}  wa_url = https://wa.me/<mobile> or https://wa.me/;
--   {status: claimed, site_url}  the shop is on Alo King with a public page: nothing recorded, no number;
--   {status: not_found}     unknown, not a seed merchant, hidden, test, outside the pilot villages, or claimed without a
--                           public page;
--   {status: rate_limited}  this visitor tapped too often (30 an hour);
--   {status: invalid}       malformed input.
-- site_url is the dated config `site_url` (the public website, for the claim link and the shop's page), null while unset.
create function public.vendor_join_request(p_slug text, p_channel text, p_visitor text) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ar text;
  v_en text;
  v_fr text;
  v_phone text;
  v_mobile boolean;
  v_counted boolean := false;
  v_site text := nullif(rtrim(coalesce(public.config_value('site_url') #>> '{}', ''), '/'), '');
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120
     or p_channel is null or p_channel not in ('web', 'bot')
     or p_visitor is null or p_visitor !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_site !~ '^https://[^\s/?#]+$' then
    v_site := null;
  end if;
  select u.id, u.name_ar, u.name_en, u.name_fr into v_id, v_ar, v_en, v_fr
  from app_private.unclaimed_listings u where u.slug = p_slug;
  if v_id is null then
    if exists (select 1 from public.vendors v where v.slug = p_slug and v.claim_status = 'claimed'
               and v.public_page and v.listing_status = 'active') then
      return jsonb_build_object('status', 'claimed', 'site_url', v_site);
    end if;
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Abuse guards, not business numbers: one visitor cannot sweep every shop's number or inflate one shop's count.
  if not public.web_rate_hit('join:' || p_visitor, 30, 3600) then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  if (select count(*) from public.vendor_join_requests r
      where r.vendor_id = v_id and r.created_at > now() - interval '1 day') < 200 then
    insert into public.vendor_join_requests (vendor_id, channel, visitor_hash) values (v_id, p_channel, p_visitor);
    v_counted := true;
  end if;
  select vp.phone_seed, coalesce(vp.phone_seed_mobile, false) into v_phone, v_mobile
  from public.vendor_private vp where vp.vendor_id = v_id;
  return jsonb_build_object('status', 'ok', 'vendor_id', v_id, 'name_ar', v_ar, 'name_en', v_en, 'name_fr', v_fr,
    'counted', v_counted, 'site_url', v_site,
    'wa_url', 'https://wa.me/' || case when v_mobile and v_phone ~ '^\+961[0-9]{7,8}$' then substr(v_phone, 2) else '' end);
end;
$$;
revoke all on function public.vendor_join_request(text, text, text) from public, anon, authenticated;
grant execute on function public.vendor_join_request(text, text, text) to service_role;

-- The website's read API: security-invoker wrappers in public over the definer functions above, the same shape as the
-- other website calls (no security-definer function in public is executable by anon; 50_review_hardening.sql).
create function public.site_place_unclaimed(p_slug text, p_page integer default 1) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_place_unclaimed(p_slug, p_page) $$;
create function public.site_cuisine_unclaimed(p_tag text, p_page integer default 1) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_cuisine_unclaimed(p_tag, p_page) $$;
create function public.site_vendor_unclaimed(p_slug text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_vendor_unclaimed(p_slug) $$;
revoke all on function public.site_place_unclaimed(text, integer) from public;
revoke all on function public.site_cuisine_unclaimed(text, integer) from public;
revoke all on function public.site_vendor_unclaimed(text) from public;
grant execute on function public.site_place_unclaimed(text, integer) to anon, authenticated, service_role;
grant execute on function public.site_cuisine_unclaimed(text, integer) to anon, authenticated, service_role;
grant execute on function public.site_vendor_unclaimed(text) to anon, authenticated, service_role;

-- 4. The claim page: "N customers asked for you" -------------------------------------------------------------------------
-- Same columns as before plus `asked`; the return type changes, so the function is replaced (no data involved).
drop function public.vendor_claim_lookup(uuid);
create function public.vendor_claim_lookup(p_vendor_id uuid)
returns table (vendor_id uuid, name text, branch_label text, town text, claim_status public.claim_status,
  seed_phone_tail text, in_brand boolean, asked integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, coalesce(v.name_ar, v.name_en), v.branch_label, coalesce(p.name_ar, p.name_en), v.claim_status,
    app_private.phone_tail(vp.phone_seed), v.brand_id is not null, app_private.join_request_count(v.id)
  from public.vendors v
  left join public.vendor_private vp on vp.vendor_id = v.id
  left join public.places p on p.id = v.town_id
  where v.id = p_vendor_id and v.listing_status <> 'hidden';
$$;
revoke all on function public.vendor_claim_lookup(uuid) from public, anon, authenticated;
grant execute on function public.vendor_claim_lookup(uuid) to service_role;

-- 5. The bot: a shop the customer names that is not on Alo King yet ----------------------------------------------------------
-- By name only: the words of the query that name a dish, a cuisine, a kind of shop or a place in the delivery area are
-- set aside ("shawarma", "manakish", "supermarket", "Baakline" are requests for food or an area, not for one shop), and
-- what is left must match the shop's normalised name (word similarity 0.6, the orderable search's "name" level). Best
-- first. The bot builds the "Ask them to join" link (the `site-claim` edge function, ch=bot) from the slug.
create function public.vendor_search_unclaimed(p_query text, p_limit integer default 3)
returns table (vendor_id uuid, slug text, name_ar text, name_en text, business_type public.business_type,
  cuisine_tags text[], place_ar text, place_en text, score real)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select app_private.normalize_place_name(left(coalesce(p_query, ''), 120)) as n
  ), generic as (
    select distinct x.w from (
      select regexp_split_to_table(app_private.normalize_place_name(
               concat_ws(' ', t.tag, replace(t.tag, '_', ' '), t.name_ar, t.name_en, t.name_fr)), '\s+') as w
      from public.cuisine_tags t
      union all
      select regexp_split_to_table(app_private.normalize_place_name(
               concat_ws(' ', replace(b.business_type::text, '_', ' '), b.name_ar, b.name_en, b.name_fr)), '\s+')
      from public.business_type_labels b
      union all
      select regexp_split_to_table(app_private.normalize_place_name(
               concat_ws(' ', d.name_ar, d.name_en, d.name_fr, d.category, array_to_string(d.aliases, ' '))), '\s+')
      from public.dish_library d
      union all
      select regexp_split_to_table(app_private.normalize_place_name(concat_ws(' ', p.name_ar, p.name_en, p.name_fr)), '\s+')
      from public.places p
      where p.id = any (array(select jsonb_array_elements_text(coalesce(public.config_value('pilot_place_ids'), '[]'))))
      union all
      -- Words of a request, not of a name.
      select unnest(array['shop', 'store', 'restaurant', 'resto', 'house', 'place', 'best', 'good', 'near', 'nearby',
        'something', 'order', 'delivery', 'the', 'and', 'le', 'la', 'les', 'du', 'des', 'chez', 'mahal', 'matam',
        'badde', 'bade', 'baddi', 'محل', 'مطعم', 'بدي', 'شي'])
    ) x where x.w is not null and x.w <> ''
  ), rest as (
    select string_agg(t.tok, ' ' order by t.ord) as r
    from q, regexp_split_to_table(q.n, '\s+') with ordinality t (tok, ord)
    where not exists (select 1 from generic g where g.w = t.tok or extensions.similarity(g.w, t.tok) >= 0.6)
  ), m as (
    select u.*, app_private.normalize_place_name(
             coalesce(u.name_ar, '') || ' ' || coalesce(u.name_en, '') || ' ' || coalesce(u.name_fr, '')) as nn
    from app_private.unclaimed_listings u
  ), scored as (
    select m.*,
      -- What is left of the query, within the name.
      case when char_length(coalesce(rest.r, '')) >= 3 then extensions.word_similarity(rest.r, m.nn) else 0 end as part,
      -- Or the whole query is (nearly) the shop's name in one language: "Baakline Supermarket", "نية و مشوية".
      case when q.n ~ '\s' then greatest(
        coalesce(extensions.similarity(q.n, app_private.normalize_place_name(m.name_ar)), 0),
        coalesce(extensions.similarity(q.n, app_private.normalize_place_name(m.name_en)), 0),
        coalesce(extensions.similarity(q.n, app_private.normalize_place_name(m.name_fr)), 0)) else 0 end as whole
    from m cross join q cross join rest
    where char_length(coalesce(q.n, '')) >= 3
  )
  select s.id, s.slug, s.name_ar, s.name_en, s.business_type, s.cuisine_tags, pl.name_ar, pl.name_en,
    greatest(s.part, s.whole)::real
  from scored s left join public.places pl on pl.id = s.town_id
  where s.part >= 0.6 or s.whole >= 0.7
  order by greatest(s.part, s.whole) desc, s.whole desc, s.slug
  limit least(greatest(coalesce(p_limit, 3), 1), 5);
$$;
revoke all on function public.vendor_search_unclaimed(text, integer) from public, anon, authenticated;
grant execute on function public.vendor_search_unclaimed(text, integer) to service_role;
