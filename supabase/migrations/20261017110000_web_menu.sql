-- Session 5g (CUSTOMER-EXPERIENCE §4, DECISIONS §39.15.11): the web shop menu, opened from an "Open menu" button in the
-- chat inside WhatsApp's own browser.
--
-- 1. Signed links: web_link_create(customer, kind, shop, lang) makes a random token (24 URL-safe characters, only its
--    SHA-256 is stored) bound to the customer's phone, valid web_link_hours (24, dated config), and returns the page's
--    address <public_site_url>/<lang>/m/<slug>?t=<token> (or /<lang>/e for Explore, session 5g part B). No login: the token
--    is the customer. A link never carries or shows the phone, the address or the pin.
-- 2. web_menu(token, slug): what the page shows, for the customer the token names: the shop (cover, cuisine, village, open
--    now, hours today), the delivery fee and ETA range to the customer's point (customer_delivery_check: the exact cached
--    route, else the shop → place distance of shop_place_routes; zero routing calls), every item the shop takes now in its
--    own sections and order (sold-out, removed and medicine-held items hidden, §38.3), with its required choices and
--    add-ons, declared allergens only, estimated nutrition, one "Goes well with" from the shop's own bought-together
--    delivered orders (two or more, never pretend orders), and the customer's current basket for that shop. A demo tester's
--    point is the demo address they picked (customer_search_point, §39.15.3): the page never says "we don't deliver to you".
-- 3. web_basket_save(token, slug, lines, replace): "Continue in WhatsApp". Every line is checked on the server (the shop's
--    item, orderable in that quantity, each option one of the item's own and available, every group within its min and
--    max, the note cleaned and cut), then the shop's basket is replaced by these lines through basket_add_item, which
--    prices nothing itself: basket_view and basket_quote price from the menu (product rules). Prices from the page are
--    never read. A basket from another shop is replaced only when the customer says so. Then one synthetic inbound event
--    (a "c:web" tap, marked alo_synthetic) is queued so the bot sends the checkout summary in the chat (§3.6); dispatch
--    never counts it as the customer writing (no 24-hour window from it).
-- 4. site_photo(item | shop): the photo route for the site (the web menu, the item page, Explore) by item or by shop
--    cover, for shops whose items have pages (item_page_visible). The catalogue image route keeps its hash check for Meta.

-- 1. Config and links ---------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('web_link_hours', '24', '2026-10-17 06:00+03',
   'CUSTOMER-EXPERIENCE §4: a signed web menu or Explore link works this many hours'),
  ('web_link_max_saves', '40', '2026-10-17 06:00+03',
   'CUSTOMER-EXPERIENCE §4: basket saves one web link may make (a guard against a stuck or abused page)')
on conflict do nothing;

create table app_private.web_links (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 (hex) of the token; the token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind text not null check (kind in ('menu', 'explore')),
  vendor_id uuid references public.vendors (id) on delete cascade,
  -- The customer's open basket when the link was made (for the record; the page always reads the basket as it is now).
  basket_id uuid references public.baskets (id) on delete set null,
  lang text not null check (lang in ('ar', 'en', 'fr')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  saves integer not null default 0,
  last_saved_at timestamptz,
  constraint web_links_menu_has_shop check (kind <> 'menu' or vendor_id is not null)
);
create index web_links_customer_idx on app_private.web_links (customer_id, created_at desc);
alter table app_private.web_links enable row level security;
revoke all on app_private.web_links from public, anon, authenticated;

-- A shop whose web menu this customer may open and order from: claimed, active, taking orders, not hidden from this
-- customer (test shops in demo mode, demo shops for a simulated customer who did not opt in), and a demo shop for a demo
-- tester (basket_add_item refuses anything else for them). "Not on Alo King yet" shops never get a web menu (spec §4).
create function app_private.web_menu_shop(p_vendor_id uuid, p_customer_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select v.claim_status = 'claimed' and v.listing_status = 'active' and v.orderable
      and not (v.id = any (app_private.customer_hidden_vendors(p_customer_id)))
      and (not app_private.is_demo_tester(p_customer_id) or app_private.vendor_is_demo(v.id))
    from public.vendors v where v.id = p_vendor_id), false);
$$;
revoke all on function app_private.web_menu_shop(uuid, uuid) from public;

-- The valid (unexpired) link a token names; nothing for any other string.
create function app_private.web_link(p_token text) returns setof app_private.web_links
language sql stable security definer set search_path = ''
as $$
  select w.* from app_private.web_links w
  where p_token ~ '^[A-Za-z0-9_-]{24}$'
    and w.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and w.expires_at > now();
$$;
revoke all on function app_private.web_link(text) from public;

-- The page's address with a new token, or null (no public site address yet, an unknown kind, or a shop this customer may
-- not order from). The dispatch function calls it when it shows an "Open menu" or "Explore" button.
create function public.web_link_create(p_customer_id uuid, p_kind text, p_vendor_id uuid default null,
  p_lang text default 'ar') returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_site text := app_private.public_site_url();
  v_lang text := case when p_lang in ('en', 'fr') then p_lang else 'ar' end;
  v_slug text;
  v_token text;
begin
  if v_site is null or p_customer_id is null or p_kind is null or p_kind not in ('menu', 'explore') then
    return null;
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    return null;
  end if;
  if p_kind = 'menu' then
    select v.slug into v_slug from public.vendors v where v.id = p_vendor_id and app_private.web_menu_shop(v.id, p_customer_id);
    if v_slug is null then
      return null;
    end if;
  end if;
  -- 18 random bytes: 24 URL-safe base64 characters, no padding.
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  -- A customer's links that ended a week ago go (the table holds a few rows per customer).
  delete from app_private.web_links w where w.customer_id = p_customer_id and w.expires_at < now() - interval '7 days';
  insert into app_private.web_links (token_hash, customer_id, kind, vendor_id, basket_id, lang, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_customer_id, p_kind,
    case when p_kind = 'menu' then p_vendor_id end,
    (select b.id from public.baskets b where b.customer_id = p_customer_id and b.status = 'open'),
    v_lang, now() + make_interval(hours => public.config_numeric('web_link_hours')::int));
  return v_site || '/' || v_lang || case when p_kind = 'menu' then '/m/' || v_slug else '/e' end || '?t=' || v_token;
end;
$$;
revoke all on function public.web_link_create(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.web_link_create(uuid, text, uuid, text) to service_role;

-- 2. Delivery to the customer's point, for a page ------------------------------------------------------------------------
-- The fee and an ETA range for one shop to the customer's point, with the place's names (never the pin or the address).
-- The fee is customer_delivery_check's (zero routing calls); the ETA is the shop's prep time plus the road minutes to the
-- place (shop_place_routes, corrected by eta_travel_s), widened at the top by eta_range_extra_min, as order_eta_range does.
create function app_private.web_delivery(p_customer_id uuid, p_vendor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_place record;
  v_chk jsonb;
  v_q jsonb;
  v_min numeric;
  v_prep integer;
  v_town text;
  v_travel integer;
  v_low integer;
begin
  if v_pt is null then
    return jsonb_build_object('status', 'no_address');
  end if;
  select p.id, p.name_ar, p.name_en, p.name_fr into v_place
  from public.addresses a join public.places p on p.id = a.place_id where a.id = (v_pt ->> 'address_id')::uuid;
  v_chk := public.customer_delivery_check(p_customer_id, array[p_vendor_id]);
  v_q := v_chk -> 'vendors' -> 0;
  select v.default_prep_minutes, v.town_id into v_prep, v_town from public.vendors v where v.id = p_vendor_id;
  select r.minutes into v_min from public.shop_place_routes r
  where r.vendor_id = p_vendor_id and r.place_id = v_place.id and r.minutes is not null;
  v_travel := case when v_min is not null then public.eta_travel_s(round(v_min * 60)::integer, v_town, v_place.id) end;
  v_low := ceil((coalesce(v_prep, 20) * 60 + coalesce(v_travel, 0)) / 60.0)::integer;
  return jsonb_build_object(
    'status', coalesce(v_q ->> 'status', v_chk ->> 'status', 'no_route'),
    'fee_usd', case when v_q ->> 'status' = 'ok' then (v_q ->> 'fee_usd')::numeric end,
    'road_km', (v_q ->> 'road_km')::numeric,
    'eta_min', greatest(v_low, 1),
    'eta_max', greatest(v_low, 1) + public.config_numeric('eta_range_extra_min')::integer,
    'place_ar', v_place.name_ar, 'place_en', coalesce(v_place.name_en, v_place.name_ar),
    'place_fr', coalesce(v_place.name_fr, v_place.name_en, v_place.name_ar),
    'demo_address', exists (select 1 from public.addresses a where a.id = (v_pt ->> 'address_id')::uuid and a.demo_key is not null));
end;
$$;
revoke all on function app_private.web_delivery(uuid, uuid) from public;

-- 3. The web menu ------------------------------------------------------------------------------------------------------------
-- An item the web menu shows: not removed, orderable now, and not held by the medicine rule (§38.3: never delivered).
create function app_private.web_item_shown(p_item_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.menu_items i where i.id = p_item_id and i.removed_at is null)
    and app_private.menu_item_orderable(p_item_id, 1)
    and not exists (select 1 from public.catalog_item_holds h where h.item_id = p_item_id and 'policy_medicine' = any (h.codes));
$$;
revoke all on function app_private.web_item_shown(uuid) from public;

create function app_private.web_menu(p_token text, p_slug text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  w app_private.web_links%rowtype;
  v_id uuid;
  v_basket public.baskets%rowtype;
begin
  select * into w from app_private.web_link(p_token);
  if w.id is null then
    return jsonb_build_object('status', 'expired');
  end if;
  select v.id into v_id from public.vendors v
  where p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p_slug) <= 120 and v.slug = p_slug;
  if v_id is null or not app_private.web_menu_shop(v_id, w.customer_id) then
    return jsonb_build_object('status', 'unavailable', 'lang', w.lang);
  end if;
  select * into v_basket from public.baskets b where b.customer_id = w.customer_id and b.status = 'open';
  return (
    with it as (
      select i.* from public.menu_items i where i.vendor_id = v_id and app_private.web_item_shown(i.id)
    ),
    -- Bought together in two or more delivered orders of this shop (never pretend orders, §39.15.3), the best pair first.
    pairs as (
      select oi.item_id as a, oi2.item_id as b, count(distinct o.id) as n
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      join public.order_items oi2 on oi2.order_id = o.id and oi2.item_id <> oi.item_id
      where o.vendor_id = v_id and o.status = 'delivered' and not o.is_demo
        and oi.item_id in (select id from it) and oi2.item_id in (select id from it)
      group by oi.item_id, oi2.item_id
      having count(distinct o.id) >= 2
    ),
    best as (select distinct on (p.a) p.a, p.b from pairs p order by p.a, p.n desc, p.b),
    items as (
      select i.section_id, i.sort_order, i.id, jsonb_build_object(
        'id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'name_fr', i.name_fr,
        'description', nullif(btrim(left(i.description, 300)), ''),
        'price_usd', i.price_usd, 'per_kg', i.pricing_unit = 'kg', 'est_weight_kg', i.est_weight_kg,
        'vegetarian', i.vegetarian, 'vegan', i.vegan, 'spicy', i.spicy_level,
        'photo', exists (select 1 from public.menu_item_photos p where p.item_id = i.id),
        'photo_source', (select p.source from public.menu_item_photos p where p.item_id = i.id),
        -- Only what the shop declared (§38.3): never "none", never "safe".
        'allergens', case when i.allergens_confirmed_at is not null and cardinality(i.allergens) > 0
                          then to_jsonb(i.allergens) end,
        'nutrition', (select jsonb_build_object('kcal', round(nu.kcal), 'protein_g', round(nu.protein_g, 1),
              'carbs_g', round(nu.carbs_g, 1), 'fat_g', round(nu.fat_g, 1), 'status', nu.status)
            from public.menu_item_nutrition nu
            where nu.item_id = i.id and nu.status in ('merchant_verified', 'estimated') and nu.kcal is not null),
        'goes_well', (select b.b from best b where b.a = i.id),
        'groups', coalesce((
          select jsonb_agg(jsonb_build_object('id', g.id, 'name_ar', g.name_ar, 'name_en', g.name_en, 'name_fr', g.name_fr,
              'min', g.min_select, 'max', g.max_select,
              'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name_ar', o.name_ar, 'name_en', o.name_en,
                  'name_fr', o.name_fr, 'price_usd', o.price_delta_usd) order by o.sort_order, o.name_en, o.id), '[]'::jsonb)
                from public.menu_options o where o.group_id = g.id and o.available))
            order by g.sort_order, g.name_en, g.id)
          from public.menu_option_groups g where g.item_id = i.id
            and exists (select 1 from public.menu_options o where o.group_id = g.id and o.available)), '[]'::jsonb)
      ) as j
      from it i
    ),
    secs as (
      select x.section_id, min(coalesce(s.sort_order, 100000)) as so,
        jsonb_build_object('id', x.section_id, 'name_ar', max(s.name_ar), 'name_en', max(s.name_en), 'name_fr', max(s.name_fr),
          'items', jsonb_agg(x.j order by x.sort_order, x.id)) as j
      from items x left join public.menu_sections s on s.id = x.section_id
      group by x.section_id
    )
    select jsonb_build_object(
      'status', 'ok',
      'lang', w.lang,
      'shop', (select jsonb_build_object('vendor_id', v.id, 'slug', v.slug, 'name_ar', v.name_ar, 'name_en', v.name_en,
          'name_fr', v.name_fr, 'branch_label', v.branch_label,
          'cuisine_ar', sc ->> 'cuisine_ar', 'cuisine_en', sc ->> 'cuisine_en', 'cuisine_fr', sc ->> 'cuisine_fr',
          'village_ar', sc ->> 'village_ar', 'village_en', sc ->> 'village_en',
          'village_fr', coalesce(pl.name_fr, pl.name_en, pl.name_ar),
          'open_now', (sc ->> 'open_now')::boolean, 'hours_today', sc ->> 'hours_today',
          'paused', public.vendor_is_paused(v.id),
          'cover', exists (select 1 from public.vendor_covers c where c.vendor_id = v.id),
          'demo', app_private.vendor_is_demo(v.id),
          'delivery', v.delivery_enabled, 'pickup', v.pickup_enabled,
          'min_order_usd', (select o.min_order_usd from public.vendor_ops o where o.vendor_id = v.id))
        from public.vendors v
        cross join lateral (select public.shop_card(v.id) as sc) c
        left join public.places pl on pl.id = v.town_id
        where v.id = v_id),
      'delivery', app_private.web_delivery(w.customer_id, v_id),
      'sections', coalesce((select jsonb_agg(s.j order by s.so, s.section_id nulls last) from secs s), '[]'::jsonb),
      'basket', case
        when v_basket.id is null then null
        when v_basket.vendor_id <> v_id then jsonb_build_object('other_vendor', true,
          'vendor_ar', (select x.name_ar from public.vendors x where x.id = v_basket.vendor_id),
          'vendor_en', (select coalesce(x.name_en, x.name_ar) from public.vendors x where x.id = v_basket.vendor_id))
        else jsonb_build_object('other_vendor', false, 'lines', coalesce((
          select jsonb_agg(jsonb_build_object('item_id', bi.item_id, 'quantity', bi.quantity,
              'option_ids', to_jsonb(bi.option_ids), 'note', bi.note) order by bi.created_at, bi.id)
          from public.basket_items bi where bi.basket_id = v_basket.id and app_private.web_item_shown(bi.item_id)), '[]'::jsonb))
        end,
      'note_max', app_private.item_note_max(),
      'rate', public.usd_lbp_rate(),
      'expires_at', w.expires_at)
  );
end;
$$;
revoke all on function app_private.web_menu(text, text) from public;
grant execute on function app_private.web_menu(text, text) to anon, authenticated, service_role;

-- 4. Continue in WhatsApp ----------------------------------------------------------------------------------------------------
-- The bot hears a "c:web" tap from the customer, as if they had tapped it in the chat: one synthetic inbound event on the
-- customer number, marked alo_synthetic = web (dispatch neither counts it as the customer writing nor lets the merchant
-- side take it). Then dispatch is kicked so the summary arrives while the customer goes back to the chat.
create function app_private.web_basket_notify(p_customer_id uuid, p_link_id uuid) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := (select c.phone_e164 from public.customers c where c.id = p_customer_id);
  v_id bigint;
begin
  if v_phone is null then
    return null;
  end if;
  insert into public.webhook_events (provider, event_key, event_type, phone_number_id, payload)
  values ('kapso', 'web:' || p_link_id || ':' || gen_random_uuid(), 'whatsapp.message.received',
    public.whatsapp_sender('customer'),
    jsonb_build_object(
      'alo_synthetic', 'web',
      'message', jsonb_build_object('id', 'web.' || gen_random_uuid(), 'from', ltrim(v_phone, '+'), 'type', 'interactive',
        'timestamp', extract(epoch from now())::bigint::text,
        'interactive', jsonb_build_object('type', 'button_reply',
          'button_reply', jsonb_build_object('id', 'c:web', 'title', 'Continue')),
        'kapso', jsonb_build_object('direction', 'inbound')),
      'conversation', jsonb_build_object('phone_number', v_phone)))
  returning id into v_id;
  perform pgmq.send('webhook_inbound', jsonb_build_object('event_id', v_id));
  begin
    perform app_private.dispatch_kick();
  exception when others then
    -- The 30-second tick picks the event up; the save never fails on the kick.
    null;
  end;
  return v_id;
end;
$$;
revoke all on function app_private.web_basket_notify(uuid, uuid) from public;

create function app_private.web_basket_save(p_token text, p_slug text, p_lines jsonb, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  w app_private.web_links%rowtype;
  v_id uuid;
  v_basket public.baskets%rowtype;
  l jsonb;
  v_item uuid;
  v_qty integer;
  v_opts uuid[];
  v_lines jsonb := '[]';
  v_r jsonb;
  v_name text;
  v_view jsonb;
  v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into w from app_private.web_link(p_token);
  if w.id is null then
    return jsonb_build_object('status', 'expired');
  end if;
  if w.saves >= public.config_numeric('web_link_max_saves') then
    return jsonb_build_object('status', 'too_many');
  end if;
  select v.id into v_id from public.vendors v
  where p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p_slug) <= 120 and v.slug = p_slug;
  if v_id is null or not app_private.web_menu_shop(v_id, w.customer_id) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Every line first, nothing written until all pass: the item, the quantity, the choices, the note.
  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or coalesce(l ->> 'item_id', '') !~ v_uuid
       or coalesce(l ->> 'quantity', '') !~ '^[0-9]{1,2}$' or (l ->> 'quantity')::int not between 1 and 50
       or (l ? 'option_ids' and jsonb_typeof(l -> 'option_ids') <> 'array')
       or (l ? 'note' and jsonb_typeof(l -> 'note') not in ('string', 'null')) then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_item := (l ->> 'item_id')::uuid;
    v_qty := (l ->> 'quantity')::int;
    if exists (select 1 from jsonb_array_elements(coalesce(l -> 'option_ids', '[]')) x
               where jsonb_typeof(x) <> 'string' or x #>> '{}' !~ v_uuid) then
      return jsonb_build_object('status', 'invalid');
    end if;
    v_opts := coalesce((select array_agg(distinct (x #>> '{}')::uuid) from jsonb_array_elements(coalesce(l -> 'option_ids', '[]')) x), '{}');
    select coalesce(i.name_ar, i.name_en) into v_name from public.menu_items i where i.id = v_item and i.vendor_id = v_id;
    if v_name is null then
      return jsonb_build_object('status', 'invalid');
    end if;
    if not app_private.web_item_shown(v_item) or not app_private.menu_item_orderable(v_item, v_qty) then
      return jsonb_build_object('status', 'unavailable', 'item_id', v_item);
    end if;
    -- Each choice is one of this item's own, available now.
    if exists (select 1 from unnest(v_opts) o where not exists (
                 select 1 from public.menu_options mo join public.menu_option_groups g on g.id = mo.group_id
                 where mo.id = o and g.item_id = v_item and mo.available)) then
      return jsonb_build_object('status', 'invalid');
    end if;
    -- Every group within its rule: a required size chosen, never more add-ons than allowed. A group with no option
    -- available now asks nothing (the page does not show it).
    if exists (select 1 from public.menu_option_groups g
               where g.item_id = v_item
                 and exists (select 1 from public.menu_options o where o.group_id = g.id and o.available)
                 and (select count(*) from public.menu_options mo where mo.group_id = g.id and mo.id = any (v_opts))
                     not between least(g.min_select, (select count(*) from public.menu_options o where o.group_id = g.id and o.available))
                             and g.max_select) then
      return jsonb_build_object('status', 'choices', 'item_id', v_item);
    end if;
    v_lines := v_lines || jsonb_build_object('item_id', v_item, 'quantity', v_qty, 'option_ids', to_jsonb(v_opts),
      'note', nullif(l ->> 'note', ''));
  end loop;
  select * into v_basket from public.baskets b where b.customer_id = w.customer_id and b.status = 'open' for update;
  if v_basket.id is not null and v_basket.vendor_id <> v_id and not coalesce(p_replace, false) then
    return jsonb_build_object('status', 'other_vendor',
      'vendor_ar', (select x.name_ar from public.vendors x where x.id = v_basket.vendor_id),
      'vendor_en', (select coalesce(x.name_en, x.name_ar) from public.vendors x where x.id = v_basket.vendor_id));
  end if;
  begin
    -- The page holds the whole basket for this shop: its lines replace the shop's basket lines.
    if v_basket.id is not null and v_basket.vendor_id = v_id then
      delete from public.basket_items bi where bi.basket_id = v_basket.id;
    end if;
    for l in select * from jsonb_array_elements(v_lines) loop
      v_r := public.basket_add_item(w.customer_id, (l ->> 'item_id')::uuid, (l ->> 'quantity')::int,
        coalesce((select array_agg((x #>> '{}')::uuid) from jsonb_array_elements(l -> 'option_ids') x), '{}'),
        l ->> 'note', true, null);
      if v_r ->> 'status' is distinct from 'added' then
        raise exception 'web basket line refused: %', coalesce(v_r ->> 'status', 'unknown') using errcode = 'P0001';
      end if;
    end loop;
  exception when sqlstate 'P0001' then
    -- Nothing of this save is kept (the block rolls back): the basket stays as it was.
    return jsonb_build_object('status', 'unavailable');
  end;
  update app_private.web_links set saves = saves + 1, last_saved_at = now() where id = w.id;
  v_view := public.basket_view(w.customer_id);
  perform app_private.web_basket_notify(w.customer_id, w.id);
  return jsonb_build_object('status', 'saved',
    'items', (select coalesce(sum((x ->> 'quantity')::int), 0) from jsonb_array_elements(v_view -> 'lines') x),
    'subtotal_usd', v_view -> 'subtotal_usd');
end;
$$;
revoke all on function app_private.web_basket_save(text, text, jsonb, boolean) from public;
grant execute on function app_private.web_basket_save(text, text, jsonb, boolean) to anon, authenticated, service_role;

-- 5. The site's photo route ----------------------------------------------------------------------------------------------------
-- The storage path of an item's photo, or of a shop's cover, for a shop whose items have pages (item_page_visible). The
-- dispatch function's ?route=site-photo signs it; the catalogue's ?route=catalog-image keeps serving only the version Meta
-- was given.
create function public.site_photo(p_item_id uuid default null, p_vendor_id uuid default null) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p_item_id is not null then (
      select p.storage_path from public.menu_item_photos p join public.menu_items i on i.id = p.item_id
      where p.item_id = p_item_id and i.removed_at is null and app_private.item_page_visible(i.vendor_id))
    when p_vendor_id is not null then (
      select c.storage_path from public.vendor_covers c where c.vendor_id = p_vendor_id and app_private.item_page_visible(c.vendor_id))
  end;
$$;
revoke all on function public.site_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.site_photo(uuid, uuid) to service_role;

-- 6. The website's API: security-invoker wrappers in public (no security-definer function in public is executable by anon,
-- 50_review_hardening.sql) ---------------------------------------------------------------------------------------------------
create function public.web_menu(p_token text, p_slug text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.web_menu(p_token, p_slug) $$;
create function public.web_basket_save(p_token text, p_slug text, p_lines jsonb, p_replace boolean default false) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select app_private.web_basket_save(p_token, p_slug, p_lines, p_replace) $$;
revoke all on function public.web_menu(text, text), public.web_basket_save(text, text, jsonb, boolean) from public;
grant execute on function public.web_menu(text, text), public.web_basket_save(text, text, jsonb, boolean)
  to anon, authenticated, service_role;
