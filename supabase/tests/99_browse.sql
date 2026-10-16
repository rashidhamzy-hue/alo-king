-- Session 5e: browsing through the bot. Categories per shop from its menu, tags and type; the shops that may deliver to a
-- pin with their village, cuisine and categories; a shop's card with today's hours; its menu ranked best sections first;
-- search results as products with their shop.
begin;

insert into public.vendors (id, slug, name_en, name_ar, business_type, cuisine_tags, claim_status, public_page, orderable, source,
  place_id, location, delivery_radius_km, town_id)
values ('5e000000-0000-0000-0000-0000000000b1', 'browse-burger', 'Browse Burger', 'برغر', 'fast_food', '{}', 'claimed', true, true,
        'merchant', 'gp5eB1', 'SRID=4326;POINT(35.58 33.68)', 10, (select id from public.places limit 1)),
       ('5e000000-0000-0000-0000-0000000000b2', 'browse-far', 'Browse Far', null, 'restaurant', '{sushi_japanese}', 'claimed', true, true,
        'merchant', 'gp5eB2', 'SRID=4326;POINT(35.90 33.90)', 3, null);
insert into public.vendor_private (vendor_id, import_labels) values
  ('5e000000-0000-0000-0000-0000000000b1', jsonb_build_object('hours_seed',
    'Monday: 12 PM to 12 AM | Tuesday: 12 PM to 12 AM | Wednesday: 12 PM to 12 AM | Thursday: 12 PM to 12 AM | Friday: 12 PM to 12 AM | Saturday: 12 PM to 12 AM | Sunday: 12 PM to 12 AM'))
  on conflict (vendor_id) do update set import_labels = excluded.import_labels;
insert into public.menu_sections (id, vendor_id, name_en, sort_order) values
  ('5e000000-0000-0000-0000-0000000000c1', '5e000000-0000-0000-0000-0000000000b1', 'Drinks', 1),
  ('5e000000-0000-0000-0000-0000000000c2', '5e000000-0000-0000-0000-0000000000b1', 'Beef Burgers', 2),
  ('5e000000-0000-0000-0000-0000000000c3', '5e000000-0000-0000-0000-0000000000b1', 'Sides', 3);
insert into public.menu_items (id, vendor_id, section_id, name_en, price_usd, sort_order) values
  ('5e000000-0000-0000-0000-0000000000d1', '5e000000-0000-0000-0000-0000000000b1', '5e000000-0000-0000-0000-0000000000c1', 'Pepsi', 1, 1),
  ('5e000000-0000-0000-0000-0000000000d2', '5e000000-0000-0000-0000-0000000000b1', '5e000000-0000-0000-0000-0000000000c2', 'Classic Burger', 8, 1),
  ('5e000000-0000-0000-0000-0000000000d3', '5e000000-0000-0000-0000-0000000000b1', '5e000000-0000-0000-0000-0000000000c2', 'Cheese Burger', 9, 2),
  ('5e000000-0000-0000-0000-0000000000d4', '5e000000-0000-0000-0000-0000000000b1', '5e000000-0000-0000-0000-0000000000c3', 'Fries', 3, 1);

-- Categories follow the menu (the menu_version bump refreshes them).
select tests.ok(exists (select 1 from app_private.vendor_browse_categories
  where vendor_id = '5e000000-0000-0000-0000-0000000000b1' and category = 'burgers' and items = 2),
  'two burgers on the menu put the shop under Burgers');
select tests.ok(exists (select 1 from app_private.vendor_browse_categories
  where vendor_id = '5e000000-0000-0000-0000-0000000000b2' and category = 'sushi'),
  'a cuisine tag puts a shop under its category without a menu');
select tests.ok(not exists (select 1 from app_private.vendor_browse_categories
  where vendor_id = '5e000000-0000-0000-0000-0000000000b1' and category = 'pizza'), 'no pizza, no Pizza');

-- Shops that may deliver to a pin next to the burger shop: the far shop is beyond its 3 km.
select tests.ok((select exists (select 1 from jsonb_array_elements(r -> 'shops') x
      where x ->> 'vendor_id' = '5e000000-0000-0000-0000-0000000000b1' and (x -> 'categories') ? 'burgers'
        and x ->> 'cuisine_en' = 'Fast food')
    and not exists (select 1 from jsonb_array_elements(r -> 'shops') x where x ->> 'vendor_id' = '5e000000-0000-0000-0000-0000000000b2')
    and jsonb_array_length(r -> 'categories') >= 10
  from public.browse_shops(null, 33.681, 35.581, 40) r),
  'browse_shops: the shop in reach with its categories and cuisine, never the one beyond its radius, and the category names');

-- The card: today's hours from the seed listing when the shop set none.
select tests.ok((public.shop_card('5e000000-0000-0000-0000-0000000000b1') ->> 'hours_today') = '12 PM to 12 AM',
  'shop_card reads today''s hours from the seed listing');
select tests.ok(public.shop_card('5e000000-0000-0000-0000-0000000000b1') -> 'cover' = 'null'::jsonb,
  'no cover yet');

-- The menu for product messages: mains first, drinks last, whatever the menu order says.
select tests.ok((select array_agg(s ->> 'name_en' order by o) = array['Beef Burgers', 'Sides', 'Drinks']
  from jsonb_array_elements(public.catalog_shop_menu('5e000000-0000-0000-0000-0000000000b1', 'sim') -> 'sections') with ordinality t(s, o)),
  'catalog_shop_menu ranks the sections: mains, then sides, then drinks');
select tests.ok((public.catalog_shop_menu('5e000000-0000-0000-0000-0000000000b1', '1234567890') ->> 'total')::int = 0,
  'only items visible in that catalogue (none synced here)');

-- Search results as products with their shop's name as the section.
select tests.ok((select (r -> 0 ->> 'section_en') = 'Browse Burger' and jsonb_array_length(r) = 2
  from public.catalog_products_for(array['5e000000-0000-0000-0000-0000000000d3', '5e000000-0000-0000-0000-0000000000d2']::uuid[], 'sim') r),
  'catalog_products_for keeps the search order and names the shop');

-- Nobody but the server reads these.
set local role anon;
select tests.ok(not has_function_privilege('anon', 'public.browse_shops(uuid, double precision, double precision, integer)', 'execute')
  and not has_function_privilege('anon', 'public.catalog_shop_menu(uuid, text)', 'execute')
  and not has_table_privilege('anon', 'public.vendor_covers', 'select'), 'anonymous callers cannot browse through these');
reset role;

rollback;
