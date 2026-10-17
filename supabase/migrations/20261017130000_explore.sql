-- Session 5g part B (DECISIONS §39.15.11, §39.14 rule 2): Explore, /<lang>/e?t=<token>, opened from an "Explore" button in
-- the chat. Every view is filtered to the customer's point, so it works for 10 shops or 10,000:
--   * the shops that deliver to the customer's place, from shop_place_routes (zero routing calls, §39.15.1), each with its
--     cover, cuisine, village, open now, delivery fee, ETA range and road distance; open shops first, nearest first, 20 a
--     page (infinite scroll); a page's fees come from customer_delivery_check (the exact cached route or the doorstep when
--     there is one, else the place distance), so Explore and checkout agree;
--   * the categories with shops delivering here (vendor_browse_categories), search by shop, cuisine or dish;
--   * "Popular near you": the best seller of each shop near the customer (units sold over catalog_best_sellers_days, real
--     orders only, never pretend ones, §39.15.3); while nothing has sold yet, each open shop's first dish of its best
--     section stands in, titled "Dishes near you", never "popular";
--   * "New on Alo King": shops delivering here that went live in the last explore_new_days (dated config);
--   * "Not on Alo King yet" last (§39.3): the place's shops that are not on Alo King, never orderable, no ratings.
-- A demo tester's point is the demo address they picked (customer_search_point, §39.15.3): nothing here says "we don't
-- deliver to you".

insert into public.app_config (key, value, effective_from, note) values
  ('explore_new_days', '30', '2026-10-17 06:00+03',
   'Session 5g Explore: a shop shows under "New on Alo King" for this many days after it went live'),
  ('explore_page_size', '20', '2026-10-17 06:00+03', 'Session 5g Explore: shops per page (infinite scroll)')
on conflict do nothing;

-- The shops that deliver to a place for a customer: orderable, claimed, active, delivering, not hidden from this customer,
-- demo shops only for a demo tester, within the shop's radius by the road distance to the place. One row per shop with
-- what a card shows. Called by web_explore only.
create function app_private.explore_shops(p_customer_id uuid, p_place_id text) returns table (
  vendor_id uuid, slug text, name_ar text, name_en text, name_fr text, road_km numeric, minutes numeric, is_open boolean,
  prep integer, town_id text, live_at timestamptz, cuisine_ar text, cuisine_en text, cuisine_fr text, village_ar text,
  village_en text, village_fr text, cover boolean, demo boolean)
language sql stable security definer set search_path = ''
as $$
  with q as (
    select app_private.customer_hidden_vendors(p_customer_id) as hidden, public.max_delivery_km() as max_km,
      app_private.is_demo_tester(p_customer_id) as tester
  )
  select v.id, v.slug, v.name_ar, v.name_en, v.name_fr, r.road_km, r.minutes,
    app_private.vendor_open_at(v.id) and not public.vendor_is_paused(v.id),
    v.default_prep_minutes, v.town_id, coalesce(v.live_since, v.created_at),
    coalesce(ct.name_ar, bt.name_ar), coalesce(ct.name_en, bt.name_en), coalesce(ct.name_fr, bt.name_fr),
    pl.name_ar, coalesce(pl.name_en, pl.name_ar), coalesce(pl.name_fr, pl.name_en, pl.name_ar),
    exists (select 1 from public.vendor_covers c where c.vendor_id = v.id),
    app_private.vendor_is_demo(v.id)
  from public.shop_place_routes r
  join public.vendors v on v.id = r.vendor_id
  cross join q
  left join public.places pl on pl.id = v.town_id
  left join public.business_type_labels bt on bt.business_type = v.business_type
  left join lateral (select t.name_ar, t.name_en, t.name_fr from public.cuisine_tags t
                     where t.tag = any (v.cuisine_tags) order by t.sort_order limit 1) ct on true
  where r.place_id = p_place_id and r.road_km is not null
    and v.orderable and v.claim_status = 'claimed' and v.listing_status = 'active' and v.delivery_enabled
    and not (v.id = any (q.hidden))
    and (not q.tester or app_private.vendor_is_demo(v.id))
    and r.road_km <= least(coalesce(v.delivery_radius_km, q.max_km), q.max_km);
$$;
revoke all on function app_private.explore_shops(uuid, text) from public;

-- A card for each shop of a page, with the fee from customer_delivery_check (one call for the page) and an ETA range as
-- web_delivery computes it. A shop the check says cannot come here (beyond its radius by the exact route) is left out.
create function app_private.explore_cards(p_customer_id uuid, p_place_id text, p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with chk as (select public.customer_delivery_check(p_customer_id, p_ids) -> 'vendors' as v),
  f as (
    select (x ->> 'vendor_id')::uuid as vendor_id, x ->> 'status' as status, (x ->> 'fee_usd')::numeric as fee,
      (x ->> 'road_km')::numeric as km
    from chk, jsonb_array_elements(coalesce(chk.v, '[]')) x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'vendor_id', s.vendor_id, 'slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en, 'name_fr', s.name_fr,
      'cuisine_ar', s.cuisine_ar, 'cuisine_en', s.cuisine_en, 'cuisine_fr', s.cuisine_fr,
      'village_ar', s.village_ar, 'village_en', s.village_en, 'village_fr', s.village_fr,
      'cover', s.cover, 'demo', s.demo, 'open_now', s.is_open,
      'fee_usd', case when f.status = 'ok' then f.fee end,
      'road_km', round(coalesce(f.km, s.road_km), 1),
      'eta_min', greatest(ceil((coalesce(s.prep, 20) * 60
                   + coalesce(public.eta_travel_s(round(s.minutes * 60)::integer, s.town_id, p_place_id), 0)) / 60.0)::int, 1),
      'eta_max', greatest(ceil((coalesce(s.prep, 20) * 60
                   + coalesce(public.eta_travel_s(round(s.minutes * 60)::integer, s.town_id, p_place_id), 0)) / 60.0)::int, 1)
                 + public.config_numeric('eta_range_extra_min')::int)
    order by array_position(p_ids, s.vendor_id)), '[]'::jsonb)
  from app_private.explore_shops(p_customer_id, p_place_id) s
  left join f on f.vendor_id = s.vendor_id
  where s.vendor_id = any (p_ids) and coalesce(f.status, 'ok') not in ('beyond_radius', 'place_paused');
$$;
revoke all on function app_private.explore_cards(uuid, text, uuid[]) from public;

-- "Popular near you": each nearby shop's best seller over catalog_best_sellers_days (real orders only, never pretend ones,
-- §39.15.3), the shops' top five sellers checked for being orderable now and for a photo, 10 at most. Without sales, each
-- open nearby shop's first photo dish of its own menu order (drinks and sauces left out) stands in, and the page titles it
-- "Dishes near you" (by_sales false), never "popular".
create function app_private.explore_popular(p_customer_id uuid, p_place_id text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_items jsonb;
begin
  with near as (
    select s.vendor_id, s.slug, s.name_ar, s.name_en, s.name_fr from app_private.explore_shops(p_customer_id, p_place_id) s
    order by s.is_open desc, s.road_km limit 40
  ),
  sold as (
    select oi.item_id, o.vendor_id, sum(oi.quantity) as n,
      row_number() over (partition by o.vendor_id order by sum(oi.quantity) desc, oi.item_id) as rk
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.vendor_id in (select vendor_id from near) and not o.is_demo and oi.item_id is not null
      and o.status not in ('cancelled', 'rejected', 'failed')
      and o.created_at > now() - make_interval(days => public.config_numeric('catalog_best_sellers_days')::int)
    group by oi.item_id, o.vendor_id
  ),
  best as (
    select distinct on (s.vendor_id) s.vendor_id, s.item_id, s.n from sold s
    where s.rk <= 5 and app_private.web_item_shown(s.item_id)
      and exists (select 1 from public.menu_item_photos p where p.item_id = s.item_id)
    order by s.vendor_id, s.n desc, s.item_id
  )
  select jsonb_agg(app_private.explore_dish(b.item_id, n.slug, n.name_ar, n.name_en, n.name_fr) order by b.n desc, b.item_id)
  into v_items
  from (select * from best order by n desc, item_id limit 10) b join near n on n.vendor_id = b.vendor_id;
  if v_items is not null then
    return jsonb_build_object('by_sales', true, 'items', v_items);
  end if;
  select jsonb_agg(app_private.explore_dish(f.item_id, f.slug, f.name_ar, f.name_en, f.name_fr) order by f.km, f.item_id)
  into v_items
  from (
    select s.slug, s.name_ar, s.name_en, s.name_fr, s.road_km as km,
      (select i.id from public.menu_items i
       left join public.menu_sections sc on sc.id = i.section_id
       where i.vendor_id = s.vendor_id and app_private.web_item_shown(i.id)
         and exists (select 1 from public.menu_item_photos p where p.item_id = i.id)
         and coalesce(sc.name_en, '') || ' ' || coalesce(sc.name_ar, '')
             !~* '(drink|beverage|soft|water|juice|dip|sauce|add.?on|extra|مشروب|صلص)'
       order by coalesce(sc.sort_order, 1000), i.sort_order, i.id limit 1) as item_id
    from app_private.explore_shops(p_customer_id, p_place_id) s
    where s.is_open order by s.road_km limit 10
  ) f
  where f.item_id is not null;
  return jsonb_build_object('by_sales', false, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;
revoke all on function app_private.explore_popular(uuid, text) from public;

-- One dish card of Explore: the item and its shop, its menu price (a kilo item at its usual weight).
create function app_private.explore_dish(p_item_id uuid, p_slug text, p_vendor_ar text, p_vendor_en text, p_vendor_fr text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'name_fr', i.name_fr,
    'price_usd', case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
    'slug', p_slug, 'vendor_ar', p_vendor_ar, 'vendor_en', p_vendor_en, 'vendor_fr', p_vendor_fr)
  from public.menu_items i where i.id = p_item_id;
$$;
revoke all on function app_private.explore_dish(uuid, text, text, text, text) from public;

create function app_private.web_explore(p_token text, p_q text default null, p_category text default null,
  p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  w app_private.web_links%rowtype;
  v_pt jsonb;
  v_place record;
  -- A search is words, never a pattern: % and _ match only themselves.
  v_q text := nullif(replace(replace(replace(btrim(left(coalesce(p_q, ''), 60)), '\', '\\'), '%', '\%'), '_', '\_'), '');
  v_cat text := case when p_category ~ '^[a-z][a-z_]{0,30}$' then p_category end;
  v_off integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_size integer := public.config_numeric('explore_page_size')::int;
  v_ids uuid[];
  v_more boolean;
  v_first boolean;
  v_out jsonb;
begin
  select * into w from app_private.web_link(p_token);
  if w.id is null then
    return jsonb_build_object('status', 'expired');
  end if;
  v_pt := public.customer_search_point(w.customer_id);
  if v_pt is null then
    return jsonb_build_object('status', 'no_address', 'lang', w.lang);
  end if;
  select p.id, p.name_ar, p.name_en, p.name_fr into v_place
  from public.addresses a join public.places p on p.id = a.place_id where a.id = (v_pt ->> 'address_id')::uuid;
  v_first := v_off = 0;
  -- The page of shops: the filter, then open first and nearest first; one more than a page tells whether more follow.
  select array_agg(x.vendor_id order by x.rk) into v_ids from (
    select s.vendor_id, row_number() over (order by s.is_open desc, s.road_km, s.vendor_id) as rk
    from app_private.explore_shops(w.customer_id, v_place.id) s
    where (v_cat is null or exists (select 1 from app_private.vendor_browse_categories c
                                    where c.vendor_id = s.vendor_id and c.category = v_cat))
      and (v_q is null
           or concat_ws(' ', s.name_ar, s.name_en, s.name_fr, s.cuisine_ar, s.cuisine_en, s.cuisine_fr) ilike '%' || v_q || '%'
           or exists (select 1 from public.menu_items i where i.vendor_id = s.vendor_id and i.removed_at is null
                        and i.available and concat_ws(' ', i.name_ar, i.name_en, i.name_fr) ilike '%' || v_q || '%'))
    order by s.is_open desc, s.road_km, s.vendor_id
    offset v_off limit v_size + 1
  ) x;
  v_more := coalesce(cardinality(v_ids), 0) > v_size;
  if v_more then
    v_ids := v_ids[1:v_size];
  end if;
  v_out := jsonb_build_object(
    'status', 'ok', 'lang', w.lang,
    'place', jsonb_build_object('name_ar', v_place.name_ar, 'name_en', coalesce(v_place.name_en, v_place.name_ar),
      'name_fr', coalesce(v_place.name_fr, v_place.name_en, v_place.name_ar)),
    'shops', app_private.explore_cards(w.customer_id, v_place.id, coalesce(v_ids, '{}')),
    'next_offset', case when v_more then v_off + v_size end);
  -- The home of Explore (no search, no category, first page): categories, popular dishes, new shops.
  if v_first and v_q is null and v_cat is null then
    v_out := v_out || jsonb_build_object(
      'categories', (
        select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'emoji', c.emoji, 'name_ar', c.name_ar, 'name_en', c.name_en,
            'name_fr', c.name_fr, 'shops', c.n) order by c.n desc, c.sort_order), '[]'::jsonb)
        from (select bc.key, bc.emoji, bc.name_ar, bc.name_en, bc.name_fr, bc.sort_order, count(*) as n
              from app_private.explore_shops(w.customer_id, v_place.id) s
              join app_private.vendor_browse_categories vc on vc.vendor_id = s.vendor_id
              join public.browse_categories bc on bc.key = vc.category and bc.active
              group by bc.key, bc.emoji, bc.name_ar, bc.name_en, bc.name_fr, bc.sort_order) c),
      'new', app_private.explore_cards(w.customer_id, v_place.id, coalesce((
        select array_agg(s.vendor_id order by s.live_at desc, s.vendor_id)
        from (select * from app_private.explore_shops(w.customer_id, v_place.id) s
              where s.live_at > now() - make_interval(days => public.config_numeric('explore_new_days')::int)
              order by s.live_at desc, s.vendor_id limit 10) s), '{}')));
    v_out := v_out || jsonb_build_object('popular', app_private.explore_popular(w.customer_id, v_place.id));
  end if;
  -- "Not on Alo King yet" last (§39.3): after the last page of shops, the shops near the customer's place that are not on
  -- Alo King (the one rule, app_private.unclaimed_listings, within listing_radius_km of the place), as the site lists them.
  if not v_more and v_q is null and v_cat is null then
    v_out := v_out || jsonb_build_object('unclaimed', (
      select coalesce(jsonb_agg(app_private.site_unclaimed_card(x.id) order by x.m, x.id), '[]'::jsonb)
      from (select u.id, extensions.st_distance(u.location, p.centroid) as m
            from app_private.unclaimed_listings u, public.places p
            where p.id = v_place.id
              and extensions.st_dwithin(u.location, p.centroid, public.config_numeric('listing_radius_km') * 1000)
            order by 2, 1 limit 30) x));
  end if;
  return v_out;
end;
$$;
revoke all on function app_private.web_explore(text, text, text, integer) from public;
grant execute on function app_private.web_explore(text, text, text, integer) to anon, authenticated, service_role;

create function public.web_explore(p_token text, p_q text default null, p_category text default null,
  p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.web_explore(p_token, p_q, p_category, p_offset) $$;
revoke all on function public.web_explore(text, text, text, integer) from public;
grant execute on function public.web_explore(text, text, text, integer) to anon, authenticated, service_role;
