-- Session 5e (16 October, Rasheed): customers shop through the bot, never through the flat catalogue.
--
-- 1. "What are you craving?": browse categories (burgers, shawarma, pizza, manakish, grills…) from the shops' cuisine tags,
--    business types and their menus (the dish words of the dish library), kept per shop in vendor_browse_categories and
--    refreshed whenever the shop's menu changes. Words, emoji and names live in the browse_categories table, not in code.
-- 2. "Shops near you": every orderable shop that delivers to the customer's pin, with its village, cuisine, categories
--    and cover (browse_shops); the bot adds the road distance and the delivery fee from customer_delivery_check.
-- 3. A shop opens with its cover image and one line (shop_card: cuisine, village, hours today), then its menu as product
--    messages grouped by the shop's sections, the best sections first (catalog_shop_menu: sections ranked by what sells,
--    mains before sides, drinks and dips last; items by what sells, then menu order).
-- 4. Search results come back as one product message grouped by shop (catalog_products_for).
-- 5. vendor_covers: one cover per shop (the shop's own photo, or the photo of its signature dish), filled by the staging
--    demo photos script; a shop without one opens without a picture.

-- 1. Browse categories -------------------------------------------------------------------------------------------------------
create table public.browse_categories (
  key text primary key check (key ~ '^[a-z][a-z_]*$'),
  emoji text not null check (char_length(emoji) <= 8),
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  -- Case-insensitive POSIX regex over an item's Arabic and English names; null: menus do not decide.
  item_pattern text,
  -- How many orderable items must match before a shop counts for the category.
  min_items integer not null default 2 check (min_items >= 1),
  cuisine_tags text[] not null default '{}',
  business_types text[] not null default '{}',
  sort_order smallint not null,
  active boolean not null default true
);
alter table public.browse_categories enable row level security;
create policy browse_categories_read on public.browse_categories for select to anon, authenticated using (active);
grant select on public.browse_categories to anon, authenticated;
grant all on public.browse_categories to service_role;

insert into public.browse_categories (key, emoji, name_ar, name_en, name_fr, item_pattern, min_items, cuisine_tags, business_types, sort_order) values
  ('burgers', '🍔', 'برغر', 'Burgers', 'Burgers', 'burger|برغر|برجر', 2, '{burgers}', '{}', 10),
  ('shawarma', '🌯', 'شاورما', 'Shawarma', 'Chawarma', 'shawarma|شاورما|شاورمة', 1, '{shawarma}', '{}', 20),
  ('pizza', '🍕', 'بيتزا', 'Pizza', 'Pizza', 'pizza|بيتزا|margh?erita|pep+eroni', 2, '{pizza,italian}', '{}', 30),
  ('manakish', '🫓', 'مناقيش', 'Manakish', 'Manakich', 'zaatar|za''atar|manoush|manakish|kish[e]?k|kechek|lahm b|akkawi|kashkawan|fatayer|زعتر|منقوش|مناقيش|كشك|فطاير|لحم بعجين', 2, '{manakish,saj}', '{bakery_manakish}', 40),
  ('grills', '🍢', 'مشاوي', 'Grills', 'Grillades', 'grill|kafta|kofta|kebab|kabab|taouk|tawo+k|tawouk|shish|mashawi|chops|مشاوي|كفتة|كباب|طاووق|ريش', 2, '{grills_mashawi}', '{butcher}', 50),
  ('sandwiches', '🥪', 'سندويشات', 'Sandwiches', 'Sandwichs', 'sandwich|\msubs?\M|wrap|panini|baguette|سندويش|ساندويش|(^|\s)راب(\s|$)', 3, '{sandwiches}', '{}', 60),
  ('chicken', '🍗', 'دجاج مقلي', 'Fried chicken', 'Poulet frit', 'broast|crisp|wings|nugget|tender|strips|زنجر|بروستد|كريسبي|ناجتس|جوانح', 2, '{broasted_chicken}', '{poultry}', 70),
  ('sushi', '🍣', 'سوشي', 'Sushi', 'Sushi', 'sushi|maki|sashimi|nigiri|سوشي', 2, '{sushi_japanese}', '{}', 80),
  ('mezze', '🥙', 'مازة لبنانية', 'Lebanese mezze', 'Mezzés libanais', 'hom+[ou]s|hum+[ou]s|tab+ou?leh|fat+oush|m[ou]?t[a]?b+al|labn[e]?h|keb+[e]?h|kib+[e]?h|vine|حمص|تبولة|فتوش|متبل|لبنة|كبة', 3, '{mezze}', '{}', 90),
  ('desserts', '🍰', 'حلويات', 'Desserts', 'Desserts', 'cake|cookie|brownie|crep|waffle|dessert|muffin|ice ?cream|gelato|كيك|بوظة|كريب|وافل|حلويات', 2, '{lebanese_sweets,booza_ice_cream,cakes,crepes_waffles}', '{sweets_pastry,ice_cream}', 100),
  ('coffee', '☕', 'قهوة', 'Coffee', 'Café', 'coffee|espresso|cappuccino|\mlatte\M|americano|mocha|frapp|قهوة|نسكافيه', 2, '{specialty_coffee}', '{cafe}', 110),
  ('juices', '🥤', 'عصير وشيك', 'Juices & shakes', 'Jus et milkshakes', 'juice|shake|smoothie|cocktail|frisco|عصير|كوكتيل', 3, '{fresh_juices}', '{}', 120),
  ('bakery', '🥐', 'مخبوزات', 'Bakery', 'Boulangerie', 'croissant|baguette|\mbread\M|ciabat|خبز|كرواسان', 2, '{}', '{}', 130),
  ('grocery', '🛒', 'سمانة', 'Grocery', 'Épicerie', null, 1, '{}', '{grocery_supermarket,minimarket,home_essentials}', 140);

-- Which categories each shop serves, with how many of its items match (refreshed on every menu change).
create table app_private.vendor_browse_categories (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  category text not null references public.browse_categories (key) on delete cascade,
  items integer not null,
  primary key (vendor_id, category)
);
alter table app_private.vendor_browse_categories enable row level security;
revoke all on app_private.vendor_browse_categories from public, anon, authenticated;

create function app_private.vendor_browse_refresh(p_vendor_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  delete from app_private.vendor_browse_categories where vendor_id = p_vendor_id;
  insert into app_private.vendor_browse_categories (vendor_id, category, items)
  select v.id, c.key, coalesce(m.n, 0)
  from public.vendors v
  cross join public.browse_categories c
  left join lateral (
    select count(*)::int as n from public.menu_items i
    where c.item_pattern is not null and i.vendor_id = v.id and i.available
      and (coalesce(i.name_en, '') || ' ' || coalesce(i.name_ar, '')) ~* c.item_pattern
  ) m on true
  where v.id = p_vendor_id and c.active and (v.claim_status = 'claimed' or v.orderable)
    and (v.business_type::text = any (c.business_types) or v.cuisine_tags && c.cuisine_tags or coalesce(m.n, 0) >= c.min_items);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function app_private.vendor_browse_refresh(uuid) from public;

-- Deferred to the end of the transaction and run once per shop in it: a menu import bumps menu_version once per item row,
-- and the refresh reads the whole menu. Shops that are neither claimed nor orderable are only cleared (they are never listed).
create function app_private.vendors_browse_refresh() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  k text := 'alo.browse_' || replace(new.id::text, '-', '');
begin
  if current_setting(k, true) is distinct from txid_current()::text then
    perform set_config(k, txid_current()::text, true);
    perform app_private.vendor_browse_refresh(new.id);
  end if;
  return null;
end;
$$;
create constraint trigger vendors_browse_refresh
  after insert or update of menu_version, cuisine_tags, business_type, claim_status, orderable on public.vendors
  deferrable initially deferred for each row execute function app_private.vendors_browse_refresh();

do $$
declare
  v uuid;
begin
  for v in select id from public.vendors where claim_status = 'claimed' or orderable loop
    perform app_private.vendor_browse_refresh(v);
  end loop;
end;
$$;

-- 5. Covers --------------------------------------------------------------------------------------------------------------------
create table public.vendor_covers (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  -- In the private bucket menu-item-photos: cover/<vendor>.jpg
  storage_path text not null unique check (storage_path ~ '^cover/[0-9a-f-]{36}\.(jpg|png)$'),
  -- merchant: the shop's own upload; merchant_site: its own website or online menu; illustrative: its signature dish.
  source text not null check (source in ('merchant', 'merchant_site', 'illustrative')),
  license text check (char_length(license) <= 120),
  credit text check (char_length(credit) <= 200),
  source_url text check (char_length(source_url) <= 1000),
  origin_hash text check (origin_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
alter table public.vendor_covers enable row level security;
revoke all on public.vendor_covers from public, anon, authenticated;
grant all on public.vendor_covers to service_role;
create trigger vendor_covers_audit after insert or update or delete on public.vendor_covers
  for each row execute function app_private.audit_row();

-- 2. Shops that may deliver to the customer's pin --------------------------------------------------------------------------
-- Every orderable, claimed, listed shop within its delivery radius in a straight line (the bot then asks the road check),
-- nearest first, with what the browse cards show, and the active categories (names and emoji) to show them under. Hidden shops (test shops for real customers in demo mode, demo shops
-- for simulated customers who did not opt in) are left out, as in vendor_search.
create function public.browse_shops(p_customer_id uuid, p_lat double precision, p_lon double precision,
  p_limit integer default 40)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with q as (
    select app_private.lat_lon_point(p_lat, p_lon) as pt, public.max_delivery_km() as max_km,
           app_private.customer_hidden_vendors(p_customer_id) as hidden
  ),
  s as (
    select v.id, v.name_ar, v.name_en, v.business_type, v.cuisine_tags, v.town_id, v.is_test,
      not (v.paused_until is not null and v.paused_until > now()) as is_open,
      extensions.st_distance(v.location, q.pt) / 1000.0 as km,
      least(coalesce(v.delivery_radius_km, q.max_km), q.max_km) as limit_km
    from public.vendors v cross join q
    where p_lat is not null and p_lon is not null
      and v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.delivery_enabled
      and not (v.id = any (q.hidden))
  )
  select jsonb_build_object(
    'place', (select jsonb_build_object('name_ar', pl.name_ar, 'name_en', coalesce(pl.name_en, pl.name_ar))
              from public.addresses a join public.places pl on pl.id = a.place_id
              where a.id = (public.customer_search_point(p_customer_id) ->> 'address_id')::uuid),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'emoji', c.emoji, 'name_ar', c.name_ar,
        'name_en', c.name_en, 'name_fr', c.name_fr) order by c.sort_order), '[]') from public.browse_categories c where c.active),
    'shops', coalesce(jsonb_agg(x order by (x ->> 'is_open')::boolean desc, (x ->> 'km')::numeric), '[]')) from (
    select jsonb_build_object(
      'vendor_id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en, 'is_open', s.is_open,
      'km', round(s.km::numeric, 2),
      'village_ar', p.name_ar, 'village_en', coalesce(p.name_en, p.name_ar),
      'cuisine_ar', coalesce(ct.name_ar, bt.name_ar), 'cuisine_en', coalesce(ct.name_en, bt.name_en),
      'cuisine_fr', coalesce(ct.name_fr, bt.name_fr),
      'categories', coalesce((select jsonb_agg(c.category order by bc.sort_order) from app_private.vendor_browse_categories c
                              join public.browse_categories bc on bc.key = c.category where c.vendor_id = s.id), '[]'),
      'has_cover', exists (select 1 from public.vendor_covers vc where vc.vendor_id = s.id)) as x
    from s
    left join public.places p on p.id = s.town_id
    left join public.business_type_labels bt on bt.business_type = s.business_type
    left join lateral (select t.name_ar, t.name_en, t.name_fr from public.cuisine_tags t
                       where t.tag = any (s.cuisine_tags) order by t.sort_order limit 1) ct on true
    where s.km <= s.limit_km or s.is_test
    order by s.is_open desc, s.km
    limit least(greatest(coalesce(p_limit, 40), 1), 60)
  ) t;
$$;
revoke all on function public.browse_shops(uuid, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.browse_shops(uuid, double precision, double precision, integer) to service_role;

-- 3. One shop's card ----------------------------------------------------------------------------------------------------------
-- Today's hours: the shop's own hours when it set them, else the seed listing's line for today (Beirut), e.g. "7 AM to 12 AM".
create function public.shop_card(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with t as (select now() at time zone 'Asia/Beirut' as l),
  v as (select x.* from public.vendors x where x.id = p_vendor_id)
  select jsonb_build_object(
    'vendor_id', v.id, 'name_ar', v.name_ar, 'name_en', v.name_en,
    'village_ar', p.name_ar, 'village_en', coalesce(p.name_en, p.name_ar),
    'cuisine_ar', coalesce(ct.name_ar, bt.name_ar), 'cuisine_en', coalesce(ct.name_en, bt.name_en),
    'cuisine_fr', coalesce(ct.name_fr, bt.name_fr),
    'open_now', app_private.vendor_open_at(v.id) and not (v.paused_until is not null and v.paused_until > now()),
    'hours_today', coalesce(
      (select to_char(h.opens, 'HH24:MI') || '–' || to_char(h.closes, 'HH24:MI') from public.vendor_hours h, t
       where h.vendor_id = v.id and h.weekday = extract(dow from t.l)),
      (select nullif(trim(substr(d, strpos(d, ':') + 1)), '')
       from t, unnest(string_to_array(vp.import_labels ->> 'hours_seed', ' | ')) d
       where d ilike trim(to_char(t.l, 'Day')) || ':%' limit 1)),
    'cover', (select jsonb_build_object('path', c.storage_path, 'source', c.source, 'credit', c.credit, 'license', c.license)
              from public.vendor_covers c where c.vendor_id = v.id))
  from v
  left join public.vendor_private vp on vp.vendor_id = v.id
  left join public.places p on p.id = v.town_id
  left join public.business_type_labels bt on bt.business_type = v.business_type
  left join lateral (select x.name_ar, x.name_en, x.name_fr from public.cuisine_tags x
                     where x.tag = any (v.cuisine_tags) order by x.sort_order limit 1) ct on true;
$$;
revoke all on function public.shop_card(uuid) from public, anon, authenticated;
grant execute on function public.shop_card(uuid) to service_role;

-- 3b. A shop's menu for product messages: sections ranked best first, items ranked within -----------------------------------
-- Only items a product message may show now (orderable, and visible in that catalogue; the simulated catalogue counts every
-- item). Rank: units sold over catalog_best_sellers_days, mains before sides and sweets, drinks, dips and add-ons last,
-- then the shop's own order.
create function public.catalog_shop_menu(p_vendor_id uuid, p_catalog_id text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with sold as (
    select oi.item_id, sum(oi.quantity) as n from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.vendor_id = p_vendor_id and o.status not in ('cancelled', 'rejected')
      and o.created_at > now() - make_interval(days => public.config_numeric('catalog_best_sellers_days')::int)
    group by oi.item_id
  ),
  items as (
    select i.id, i.name_ar, i.name_en, i.section_id, i.sort_order, coalesce(sd.n, 0) as sold,
      case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end as price_usd
    from public.menu_items i
    join public.vendors v on v.id = i.vendor_id
    left join sold sd on sd.item_id = i.id
    where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
      and app_private.menu_item_orderable(i.id, 1)
      and (p_catalog_id = 'sim' or exists (select 1 from public.catalog_sync_items c where c.item_id = i.id and c.visible
                                           and c.catalog_id = p_catalog_id))
  ),
  secs as (
    select s.id, coalesce(s.name_ar, s.name_en, 'المنيو') as name_ar, coalesce(s.name_en, s.name_ar, 'Menu') as name_en,
      coalesce(s.sort_order, 1000) as sort_order,
      case
        when coalesce(s.name_en, '') || ' ' || coalesce(s.name_ar, '') ~* '(drink|beverage|soft|water|juice|dip|sauce|add.?on|extra|side cup|make it|مشروب|صلص)' then 3
        when coalesce(s.name_en, '') || ' ' || coalesce(s.name_ar, '') ~* '(dessert|sweet|side|appeti|starter|salad|kids|shake|ice cream|حلو|مقبلات|سلط)' then 2
        else 1 end as tier
    from public.menu_sections s where s.vendor_id = p_vendor_id
  ),
  grouped as (
    select x.section_id, count(*) as total, sum(x.sold) as sold,
      jsonb_agg(jsonb_build_object('retailer_id', x.id, 'name_ar', x.name_ar, 'name_en', x.name_en, 'price_usd', x.price_usd)
                order by x.sold desc, x.sort_order, x.id) as products
    from items x group by x.section_id
  )
  select jsonb_build_object('total', (select count(*) from items),
    'sections', coalesce(jsonb_agg(jsonb_build_object('section_id', g.section_id,
        'name_ar', coalesce(sc.name_ar, 'المنيو'), 'name_en', coalesce(sc.name_en, 'Menu'), 'total', g.total, 'sold', g.sold,
        'products', g.products)
      order by coalesce(sc.tier, 1), g.sold desc, coalesce(sc.sort_order, 1000), g.section_id), '[]'))
  from grouped g left join secs sc on sc.id = g.section_id;
$$;
revoke all on function public.catalog_shop_menu(uuid, text) from public, anon, authenticated;
grant execute on function public.catalog_shop_menu(uuid, text) to service_role;

-- 4. Search results as product messages: the given items that a product message may show, with their shop -------------------
create function public.catalog_products_for(p_item_ids uuid[], p_catalog_id text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('retailer_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en,
      'price_usd', case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
      'vendor_id', v.id, 'section', coalesce(v.name_ar, v.name_en), 'section_en', coalesce(v.name_en, v.name_ar))
    order by array_position(p_item_ids, i.id)), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  where i.id = any (p_item_ids[1:30]) and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
    and app_private.menu_item_orderable(i.id, 1)
    and (p_catalog_id = 'sim' or exists (select 1 from public.catalog_sync_items c where c.item_id = i.id and c.visible
                                         and c.catalog_id = p_catalog_id));
$$;
revoke all on function public.catalog_products_for(uuid[], text) from public, anon, authenticated;
grant execute on function public.catalog_products_for(uuid[], text) to service_role;

-- Browse settings (dated config rows, DECISIONS §1): the category menu shows when at least this many shops deliver
-- (fewer are listed as shops directly); a shop's first product message shows at most this many items per section.
insert into public.app_config (key, value, effective_from, note) values
  ('browse_categories_min_shops', '4', '2026-10-16 00:00+03', 'Session 5e: "What are you craving?" when 4 or more shops deliver'),
  ('browse_first_section_items', '6', '2026-10-16 00:00+03', 'Session 5e: items per section in a shop''s first product message');
