-- Session 5f (DECISIONS §39.15.7, spec §2 item 2, §3.4 #24): every catalogue item links to its public page,
-- <public_site_url>/<lang>/i/<item id>, and the site credits every photo that is not the shop's own on /credits.
--
-- 1. site_item(id): what the item page shows. The photo (through the catalogue image route), the shop and its village,
--    the Arabic name, the menu's text, energy and macros only as the shop confirmed them or the dish library estimated
--    them, allergens only as the shop declared them (never "safe"), the extras with their prices, one "Goes well with"
--    from the shop's own bought-together orders (the §29.3 rule: at least two delivered orders together), and the photo
--    credit. An item of a shop with a public page, or of a demo shop (§39.12; the page says Demo and is never indexed).
-- 2. site_credits(page): the license and credit of every item photo and cover that is not the shop's own, 100 a page.
-- 3. site_vendor_demo(slug): a demo shop's page (the item page links to it), the same as site_vendor's, marked demo.
--    site_vendor and site_vendor_card let a demo shop through their gate; anonymous callers still cannot read a demo
--    shop's row (vendors_public_read), so only this definer function shows one.

-- A demo shop passes the gate of the shop page and its card (both otherwise as in 20261013090100).
create or replace function app_private.site_vendor_card(p_vendor_id uuid) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', v.slug, 'name_ar', v.name_ar, 'name_en', v.name_en, 'name_fr', v.name_fr, 'branch_label', v.branch_label,
    'business_type', v.business_type,
    'business_type_ar', bt.name_ar, 'business_type_en', bt.name_en, 'business_type_fr', bt.name_fr,
    'cuisine_tags', v.cuisine_tags,
    'delivery', v.delivery_enabled, 'pickup', v.pickup_enabled,
    'open_now', app_private.vendor_open_at(v.id) and not public.vendor_is_paused(v.id),
    'paused', public.vendor_is_paused(v.id),
    'orderable', v.orderable,
    'place_slug', app_private.place_slug(v.town_id),
    'place_ar', pl.name_ar, 'place_en', pl.name_en, 'place_fr', pl.name_fr)
  from public.vendors v
  join public.business_type_labels bt on bt.business_type = v.business_type
  left join public.places pl on pl.id = v.town_id
  where v.id = p_vendor_id and (v.public_page or app_private.vendor_is_demo(v.id)) and v.listing_status = 'active' and v.claim_status = 'claimed';
$$;

create or replace function public.site_vendor(p_slug text) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- Scalars, not `select *` or a rowtype: anonymous callers hold column-level grants on vendors, and a `*` would need all of them.
  v_id uuid;
  v_radius numeric;
  v_paused_until timestamptz;
  v_cash text[];
  v_updated timestamptz;
  v_tags text[];
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120 then
    return null;
  end if;
  select v.id, v.delivery_radius_km, v.paused_until, v.cash_currencies::text[], v.updated_at, v.cuisine_tags
    into v_id, v_radius, v_paused_until, v_cash, v_updated, v_tags
  from public.vendors v
  where v.slug = p_slug and (v.public_page or app_private.vendor_is_demo(v.id)) and v.listing_status = 'active' and v.claim_status = 'claimed';
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'vendor', app_private.site_vendor_card(v_id) || jsonb_build_object(
      'delivery_radius_km', v_radius,
      'paused_until', case when public.vendor_is_paused(v_id) then v_paused_until end,
      'cash_currencies', v_cash,
      'updated_at', v_updated,
      'cuisines', coalesce((
        select jsonb_agg(jsonb_build_object('tag', t.tag, 'name_ar', t.name_ar, 'name_en', t.name_en, 'name_fr', t.name_fr)
                         order by t.sort_order, t.tag)
        from public.cuisine_tags t where t.tag = any (v_tags) and t.active), '[]'::jsonb)),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opens', to_char(h.opens, 'HH24:MI'), 'closes', to_char(h.closes, 'HH24:MI'))
                       order by h.weekday)
      from public.vendor_hours h where h.vendor_id = v_id), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_ar', s.name_ar, 'name_en', s.name_en, 'name_fr', s.name_fr,
        'items', (
          select jsonb_agg(jsonb_build_object(
            'name_ar', i.name_ar, 'name_en', i.name_en, 'name_fr', i.name_fr, 'description', i.description,
            'price_usd', i.price_usd, 'per_kg', i.pricing_unit = 'kg',
            'vegetarian', i.vegetarian, 'vegan', i.vegan, 'spicy', i.spicy_level,
            'pork', i.contains_pork, 'alcohol', i.contains_alcohol,
            'allergens', case when i.allergens_confirmed_at is not null then to_jsonb(i.allergens) end)
            order by i.sort_order, i.name_en, i.name_ar)
          from public.menu_items i
          where i.vendor_id = v_id and i.available and i.section_id is not distinct from s.id))
        order by s.sort_order, s.name_en)
      from (
        select ms.id, ms.name_ar, ms.name_en, ms.name_fr, ms.sort_order
        from public.menu_sections ms where ms.vendor_id = v_id
        union all
        select null::uuid, null, null, null, 2147483647
        where exists (select 1 from public.menu_items x where x.vendor_id = v_id and x.available and x.section_id is null)
      ) s
      where exists (select 1 from public.menu_items x where x.vendor_id = v_id and x.available and x.section_id is not distinct from s.id)), '[]'::jsonb),
    'fees', jsonb_build_object('min_usd', public.delivery_fee_usd(0),
      'max_usd', public.delivery_fee_usd(least(coalesce(v_radius, public.max_delivery_km()), public.max_delivery_km())),
      'max_km', least(coalesce(v_radius, public.max_delivery_km()), public.max_delivery_km())),
    'rate', public.usd_lbp_rate());
end;
$$;

-- Anonymous callers ask whether a shop is a demo shop through the gates below (it says nothing else).
grant execute on function app_private.vendor_is_demo(uuid) to anon, authenticated;

create function app_private.site_item(p_item_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'item', jsonb_build_object(
      'id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'name_fr', i.name_fr,
      'description', nullif(btrim(i.description), ''),
      'price_usd', i.price_usd, 'per_kg', i.pricing_unit = 'kg', 'est_weight_kg', i.est_weight_kg,
      'available', app_private.menu_item_orderable(i.id, 1),
      'vegetarian', i.vegetarian, 'vegan', i.vegan, 'spicy', i.spicy_level,
      'pork', i.contains_pork, 'alcohol', i.contains_alcohol,
      'photo', p.item_id is not null,
      'photo_source', p.source,
      -- The shop's own photo needs no credit; every other photo carries its license and author (§38.1, §39.13).
      'credit', case when p.source is not null and p.source <> 'merchant'
                     then jsonb_build_object('credit', p.credit, 'license', p.license, 'source_url', p.source_url) end),
    'vendor', jsonb_build_object(
      'slug', v.slug, 'name_ar', v.name_ar, 'name_en', v.name_en, 'name_fr', v.name_fr,
      'place_slug', app_private.place_slug(v.town_id), 'place_ar', pl.name_ar, 'place_en', pl.name_en, 'place_fr', pl.name_fr,
      'orderable', v.orderable, 'paused', public.vendor_is_paused(v.id),
      'open_now', app_private.vendor_open_at(v.id) and not public.vendor_is_paused(v.id),
      'demo', app_private.vendor_is_demo(v.id), 'public_page', v.public_page),
    'nutrition', case when nu.status in ('merchant_verified', 'estimated') and nu.kcal is not null then jsonb_build_object(
      'kcal', round(nu.kcal), 'protein_g', round(nu.protein_g, 1), 'carbs_g', round(nu.carbs_g, 1), 'fat_g', round(nu.fat_g, 1),
      'status', nu.status) end,
    'allergens', case when i.allergens_confirmed_at is not null then to_jsonb(coalesce(i.allergens, '{}')) end,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object('name_ar', g.name_ar, 'name_en', g.name_en, 'name_fr', g.name_fr,
          'min', g.min_select, 'max', g.max_select,
          'options', coalesce((
            select jsonb_agg(jsonb_build_object('name_ar', o.name_ar, 'name_en', o.name_en, 'name_fr', o.name_fr,
                'price_usd', o.price_delta_usd) order by o.sort_order, o.name_en)
            from public.menu_options o where o.group_id = g.id and o.available), '[]'::jsonb))
        order by g.sort_order, g.name_en)
      from public.menu_option_groups g where g.item_id = i.id), '[]'::jsonb),
    'goes_well', (
      select jsonb_build_object('id', w.id, 'name_ar', w.name_ar, 'name_en', w.name_en, 'name_fr', w.name_fr,
        'price_usd', w.price_usd, 'per_kg', w.pricing_unit = 'kg',
        'photo', exists (select 1 from public.menu_item_photos wp where wp.item_id = w.id))
      from (
        select oi2.item_id, count(*) as n
        from public.order_items oi
        join public.orders o on o.id = oi.order_id and o.status = 'delivered' and o.vendor_id = v.id
        join public.order_items oi2 on oi2.order_id = o.id and oi2.item_id <> oi.item_id
        where oi.item_id = i.id and app_private.menu_item_orderable(oi2.item_id, 1)
        group by oi2.item_id
        having count(*) >= 2
        order by count(*) desc, oi2.item_id
        limit 1
      ) b join public.menu_items w on w.id = b.item_id),
    'rate', public.usd_lbp_rate())
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.places pl on pl.id = v.town_id
  left join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_item_nutrition nu on nu.item_id = i.id
  where i.id = p_item_id and v.claim_status = 'claimed' and v.listing_status = 'active'
    and (v.public_page or app_private.vendor_is_demo(v.id));
$$;
revoke all on function app_private.site_item(uuid) from public;
grant execute on function app_private.site_item(uuid) to anon, authenticated, service_role;

-- Every photo the site or the catalogue shows that is not the shop's own: what it is, its author and its license.
create function app_private.site_credits(p_page integer default 1) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with shown as (
    select 'item' as kind, p.item_id, v.slug as vendor_slug, v.name_ar as vendor_ar, v.name_en as vendor_en,
      v.name_fr as vendor_fr, i.name_ar as item_ar, i.name_en as item_en, i.name_fr as item_fr,
      p.source, p.credit, p.license, p.source_url
    from public.menu_item_photos p
    join public.menu_items i on i.id = p.item_id
    join public.vendors v on v.id = p.vendor_id
    where p.source <> 'merchant' and v.claim_status = 'claimed' and v.listing_status = 'active'
      and (v.public_page or app_private.vendor_is_demo(v.id))
    union all
    select 'cover', null, v.slug, v.name_ar, v.name_en, v.name_fr, null, null, null,
      c.source, c.credit, c.license, c.source_url
    from public.vendor_covers c
    join public.vendors v on v.id = c.vendor_id
    where c.source <> 'merchant' and v.claim_status = 'claimed' and v.listing_status = 'active'
      and (v.public_page or app_private.vendor_is_demo(v.id))
  ), pg as (select greatest(coalesce(p_page, 1), 1) as n)
  select jsonb_build_object(
    'total', (select count(*) from shown),
    'page', (select n from pg),
    'page_size', 100,
    'photos', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.vendor_en, s.vendor_ar, s.kind desc, s.item_en, s.item_ar)
      from (
        select * from shown
        order by vendor_en, vendor_ar, kind desc, item_en, item_ar, item_id
        offset ((select n from pg) - 1) * 100 limit 100
      ) s), '[]'::jsonb));
$$;
revoke all on function app_private.site_credits(integer) from public;
grant execute on function app_private.site_credits(integer) to anon, authenticated, service_role;

-- A demo shop's page (§39.12): site_vendor's page, read as the owner (a demo shop has no public page, so anonymous
-- callers cannot read its row), marked demo so the site labels it and never indexes it.
create function app_private.site_vendor_demo(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120 then
    return null;
  end if;
  if not exists (select 1 from public.vendors v where v.slug = p_slug and app_private.vendor_is_demo(v.id)) then
    return null;
  end if;
  v_page := public.site_vendor(p_slug);
  return case when v_page is not null then jsonb_set(v_page, '{vendor,demo}', 'true'::jsonb) end;
end;
$$;
revoke all on function app_private.site_vendor_demo(text) from public;
grant execute on function app_private.site_vendor_demo(text) to anon, authenticated, service_role;

-- The website's read API: security-invoker wrappers in public over the definer functions above (no security-definer
-- function in public is executable by anon; 50_review_hardening.sql).
create function public.site_item(p_item_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_item(p_item_id) $$;
create function public.site_credits(p_page integer default 1) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_credits(p_page) $$;
create function public.site_vendor_demo(p_slug text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_vendor_demo(p_slug) $$;
revoke all on function public.site_item(uuid), public.site_credits(integer), public.site_vendor_demo(text) from public;
grant execute on function public.site_item(uuid), public.site_credits(integer), public.site_vendor_demo(text)
  to anon, authenticated, service_role;

-- 4. One address for every link (§39.15.7): the claim link and the tracking link read public_site_url, as the catalogue
--    does (they read config site_url, which has no row on staging; switching domains is one row).
create or replace function public.vendor_join_request(p_slug text, p_channel text, p_visitor text) returns jsonb
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
  v_site text := app_private.public_site_url();
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120
     or p_channel is null or p_channel not in ('web', 'bot')
     or p_visitor is null or p_visitor !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
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
create or replace function app_private.customer_notify(p_order_id uuid, p_kind text, p_extra jsonb default '{}', p_dedupe text default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_c public.customers%rowtype;
  v_id bigint;
  v_budget jsonb := public.config_value('customer_message_budget');
  v_extra jsonb := coalesce(p_extra, '{}');
  v_link text;
begin
  select * into v_o from public.orders where id = p_order_id;
  select * into v_c from public.customers where id = v_o.customer_id;
  if v_c.id is null then
    return null;
  end if;
  -- Consolidated: the delivered message carries the rating (§38.3), so a separate rating message is never sent after it.
  if p_kind = 'rating' and exists (select 1 from public.outbound_messages m where m.dedupe_key = 'cust:' || p_order_id || ':delivered') then
    return null;
  end if;
  -- Budget: above the target only essential kinds go; at the hard cap nothing but a money decision.
  if v_o.customer_messages >= (v_budget ->> 'cap')::int and p_kind not in ('weight_confirm', 'substitution', 'cancelled', 'rejected') then
    return null;
  end if;
  if v_o.customer_messages >= (v_budget ->> 'target')::int and not app_private.customer_message_essential(p_kind) then
    return null;
  end if;
  -- "On the way + tracking" in one message, once the public site has an address (config public_site_url).
  if p_kind = 'on_the_way' and app_private.public_site_url() is not null then
    begin
      v_link := public.order_tracking_link_create(p_order_id);
      v_extra := v_extra || jsonb_build_object('track_url', v_link);
    exception when others then
      v_link := null;
    end;
  end if;
  -- An order that could not go ahead: up to three open shops that deliver there.
  if p_kind in ('cancelled', 'rejected') and coalesce(v_o.cancel_reason::text, '') <> 'customer' then
    v_extra := v_extra || jsonb_build_object('alternatives', app_private.offer_alternatives(p_order_id));
  end if;
  v_id := app_private.outbox_add('cust:' || p_order_id || ':' || coalesce(p_dedupe, p_kind), p_order_id, v_o.vendor_id,
    'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', p_kind, 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id,
      'ask_delivery', v_o.driver_member_id is not null) || v_extra);
  if v_id is not null then
    if not app_private.whatsapp_reachable(v_c.phone_e164, 'customer', p_kind, coalesce(v_c.language::text, 'ar')) then
      update public.outbound_messages set status = 'skipped', last_error = 'outside the 24-hour window: no approved template for ' || p_kind
      where id = v_id;
    else
      update public.orders set customer_messages = customer_messages + 1 where id = p_order_id;
    end if;
  end if;
  return v_id;
end;
$$;
