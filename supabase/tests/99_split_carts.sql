-- Session 5f (DECISIONS §39.15.2): a cart from several shops is split, never dropped. Each shop's items are kept as a
-- saved cart; the customer picks which shop first; the next one is offered after the order; Do both keeps the cart.
begin;

insert into public.vendors (id, slug, name_en, name_ar, business_type, cuisine_tags, claim_status, public_page, orderable, source,
  place_id, location, delivery_radius_km)
values ('5f000000-0000-0000-0000-0000000000b1', 'split-burger', 'Split Burger', 'سبليت برغر', 'fast_food', '{}', 'claimed', true, true,
        'merchant', 'gp5fB1', 'SRID=4326;POINT(35.58 33.68)', 10),
       ('5f000000-0000-0000-0000-0000000000b2', 'split-sushi', 'Split Sushi', null, 'restaurant', '{}', 'claimed', true, true,
        'merchant', 'gp5fB2', 'SRID=4326;POINT(35.60 33.70)', 10);
insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd, sort_order) values
  ('5f000000-0000-0000-0000-0000000000d1', '5f000000-0000-0000-0000-0000000000b1', 'Classic Burger', 'برغر', 8, 1),
  ('5f000000-0000-0000-0000-0000000000d2', '5f000000-0000-0000-0000-0000000000b1', 'Fries', null, 3, 2),
  ('5f000000-0000-0000-0000-0000000000d3', '5f000000-0000-0000-0000-0000000000b2', 'Salmon Roll', null, 12, 1);
insert into public.customers (id, phone_e164) values
  ('5f000000-0000-0000-0000-0000000000e1', '+96170000181'),
  ('5f000000-0000-0000-0000-0000000000e2', '+96170000182');
set constraints all immediate;

-- One shop: nothing to split (the bot merges its lines as before); nothing of ours: unknown.
select public.cart_split('5f000000-0000-0000-0000-0000000000e1', 'wamid.single',
  '[{"item_id": "5f000000-0000-0000-0000-0000000000d1", "quantity": 1}, {"item_id": "not-a-uuid"}]') as one \gset
select tests.ok(:'one'::jsonb ->> 'status' = 'single' and jsonb_array_length(:'one'::jsonb -> 'lines') = 1
  and :'one'::jsonb -> 'lines' -> 0 ->> 'item_id' = '5f000000-0000-0000-0000-0000000000d1'
  and :'one'::jsonb -> 'unavailable' = '[]'::jsonb, 'a cart from one shop is not split: its own lines come back');
select tests.ok(public.cart_split('5f000000-0000-0000-0000-0000000000e1', 'wamid.none',
  '[{"item_id": "00000000-0000-0000-0000-000000000000", "quantity": 1}]') ->> 'status' = 'unknown_items', 'nothing of ours: unknown');
select tests.ok(not exists (select 1 from public.saved_carts), 'neither saves anything');

-- Two shops: split, each shop saved, in the order the cart listed them, with its server subtotal.
select public.cart_split('5f000000-0000-0000-0000-0000000000e1', 'wamid.two', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 2, 'shown_usd', 7.5),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d2', 'quantity', 1),
  jsonb_build_object('item_id', 'not-a-uuid', 'quantity', 1))) as s \gset
select tests.ok(:'s'::jsonb ->> 'status' = 'split' and jsonb_array_length(:'s'::jsonb -> 'shops') = 2, 'a cart from two shops is split');
select tests.ok(:'s'::jsonb -> 'shops' -> 0 ->> 'vendor_en' = 'Split Burger' and (:'s'::jsonb -> 'shops' -> 0 ->> 'items')::int = 3
  and (:'s'::jsonb -> 'shops' -> 0 ->> 'subtotal_usd')::numeric = 19.00,
  'the first shop is the cart''s first, with its items and the server''s subtotal (never the price the cart showed)');
select tests.ok((:'s'::jsonb -> 'shops' -> 1 ->> 'subtotal_usd')::numeric = 12.00 and :'s'::jsonb -> 'shops' -> 0 -> 'delivers' = 'null'::jsonb,
  'the second shop too; without a pin yet, delivery is asked at checkout as for any basket');
select tests.ok((select count(*) = 2 and bool_and(status = 'saved' and expires_at > now() + interval '23 hours')
  from public.saved_carts where customer_id = '5f000000-0000-0000-0000-0000000000e1'), 'both shops are kept for basket_keep_hours');
select public.cart_split('5f000000-0000-0000-0000-0000000000e1', 'wamid.two', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 2),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1)));
select tests.ok((select count(*) from public.saved_carts) = 2, 'the same message again saves nothing twice');
select tests.ok(public.cart_split('5f000000-0000-0000-0000-0000000000e1', 'wamid.two', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 2),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1))) -> 'shops' -> 0 ->> 'saved_cart_id'
  = :'s'::jsonb -> 'shops' -> 0 ->> 'saved_cart_id', 'and a replayed turn shows the same rows');

-- The customer picks the burger shop first: its lines come back once, and only for that customer.
select (:'s'::jsonb -> 'shops' -> 0 ->> 'saved_cart_id') as burger, (:'s'::jsonb -> 'shops' -> 1 ->> 'saved_cart_id') as sushi \gset
select tests.ok(public.saved_cart_take('5f000000-0000-0000-0000-0000000000e2', :'burger', 'wamid.tap') is null,
  'another customer cannot take a saved cart');
select public.saved_cart_take('5f000000-0000-0000-0000-0000000000e1', :'burger', 'wamid.tap') as t \gset
select tests.ok(:'t'::jsonb ->> 'status' = 'ok' and jsonb_array_length(:'t'::jsonb -> 'lines') = 2
  and (:'t'::jsonb -> 'lines' -> 0 ->> 'quantity')::int = 2, 'picking a shop gives its lines');
select tests.ok(public.saved_cart_take('5f000000-0000-0000-0000-0000000000e1', :'burger', 'wamid.tap') -> 'lines' = :'t'::jsonb -> 'lines',
  'a replayed turn (the same tap) gets the same lines back');
select tests.ok(public.saved_cart_take('5f000000-0000-0000-0000-0000000000e1', :'burger', 'wamid.tap2') is null
  and public.saved_cart_take('5f000000-0000-0000-0000-0000000000e1', :'burger', null) is null, 'another tap gets nothing: once only');

-- After the order, the next saved cart is offered (never the shop just ordered from); No thanks drops it.
select tests.ok(public.saved_cart_next('5f000000-0000-0000-0000-0000000000e1') ->> 'saved_cart_id' = :'sushi'
  and (public.saved_cart_next('5f000000-0000-0000-0000-0000000000e1') ->> 'items')::int = 1, 'the next saved cart is the sushi shop''s');
select tests.ok(public.saved_cart_next('5f000000-0000-0000-0000-0000000000e1', '5f000000-0000-0000-0000-0000000000b2') is null,
  'never the shop the customer just ordered from');
select tests.ok(public.saved_cart_drop('5f000000-0000-0000-0000-0000000000e1', :'sushi'), 'No thanks drops it');
select tests.ok(public.saved_cart_next('5f000000-0000-0000-0000-0000000000e1') is null, 'and nothing is left to offer');

-- The customer edits the cart and sends it again: a shop sent again replaces that shop's earlier saved cart.
select public.cart_split('5f000000-0000-0000-0000-0000000000e2', 'wamid.first', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1)));
select public.cart_split('5f000000-0000-0000-0000-0000000000e2', 'wamid.second', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 3),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d2', 'quantity', 1)));
select tests.ok((select bool_and(status = 'dropped') from public.saved_carts where source_message_id = 'wamid.first')
  and (select count(*) = 2 and bool_and(status = 'saved') from public.saved_carts where source_message_id = 'wamid.second'),
  'a cart with the same shops sent again replaces their saved carts');
select tests.ok(public.saved_cart_next('5f000000-0000-0000-0000-0000000000e2') -> 'items' = '3'::jsonb,
  'the new send comes first, in the cart''s own order');
select public.cart_split('5f000000-0000-0000-0000-0000000000e2', 'wamid.third',
  '[{"item_id": "5f000000-0000-0000-0000-0000000000d3", "quantity": 1}]');
select tests.ok((select status = 'dropped' from public.saved_carts where source_message_id = 'wamid.second' and vendor_id = '5f000000-0000-0000-0000-0000000000b2')
  and (select status = 'saved' from public.saved_carts where source_message_id = 'wamid.second' and vendor_id = '5f000000-0000-0000-0000-0000000000b1'),
  'a later cart from one shop replaces only that shop''s saved cart; the other shop''s stays kept (never partly dropped)');
update public.saved_carts set status = 'dropped' where customer_id = '5f000000-0000-0000-0000-0000000000e2';

-- Do both: the cart that met another shop's basket is saved for after this order.
select public.saved_cart_save('5f000000-0000-0000-0000-0000000000e2', 'both:wamid.x', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 2))) as b \gset
select tests.ok(:'b'::jsonb ->> 'status' = 'saved' and :'b'::jsonb ->> 'vendor_en' = 'Split Sushi', 'Do both keeps the cart');
select tests.ok(public.saved_cart_next('5f000000-0000-0000-0000-0000000000e2') ->> 'saved_cart_id' = :'b'::jsonb ->> 'saved_cart_id',
  'and offers it after the order');
-- An expired saved cart is neither offered nor taken.
update public.saved_carts set expires_at = now() - interval '1 minute' where id = (:'b'::jsonb ->> 'saved_cart_id')::uuid;
select tests.ok(public.saved_cart_next('5f000000-0000-0000-0000-0000000000e2') is null
  and public.saved_cart_take('5f000000-0000-0000-0000-0000000000e2', (:'b'::jsonb ->> 'saved_cart_id')::uuid, 'wamid.late') is null,
  'an expired saved cart is gone');

-- The closest shop's same dish: none without a dish library entry or a pin.
select tests.ok(app_private.cart_alternative('5f000000-0000-0000-0000-0000000000e1', '5f000000-0000-0000-0000-0000000000b1',
  '[{"item_id": "5f000000-0000-0000-0000-0000000000d1", "quantity": 1}]', '{}') is null, 'no dish, no pin: no alternative is invented');

-- With a pin in a delivered-to village and the recorded shop → village distances (no routing call, §39.15.1):
-- the burger shop is too far, the sushi shop delivers, and a third shop near the customer has the same dish.
insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-SC', 'CHF', 'Split carts zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source, service_status) values
  ('LB-CHF-SCTEST', 'TZ-SC', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test', 'on');
update public.places set service_status = 'on' where id = 'LB-CHF-SCTEST';  -- places load off
insert into public.vendors (id, slug, name_en, name_ar, business_type, cuisine_tags, claim_status, public_page, orderable, source,
  place_id, location, delivery_radius_km)
values ('5f000000-0000-0000-0000-0000000000b3', 'near-burger', 'Near Burger', null, 'fast_food', '{}', 'claimed', true, true,
        'merchant', 'gp5fB3', 'SRID=4326;POINT(35.565 33.678)', 10),
       ('5f000000-0000-0000-0000-0000000000b4', 'far-burger', 'Far Burger', null, 'fast_food', '{}', 'claimed', true, true,
        'merchant', 'gp5fB4', 'SRID=4326;POINT(35.70 33.80)', 10);
insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd, sort_order) values
  ('5f000000-0000-0000-0000-0000000000d4', '5f000000-0000-0000-0000-0000000000b3', 'Beef Burger', null, 7, 1),
  ('5f000000-0000-0000-0000-0000000000d5', '5f000000-0000-0000-0000-0000000000b4', 'Burger', null, 6, 1),
  ('5f000000-0000-0000-0000-0000000000d6', '5f000000-0000-0000-0000-0000000000b1', 'Double Burger', null, 11, 3);
insert into public.dish_library (id, name_ar, name_en, name_fr, category, unit, portion_g, recipe)
values ('sc_burger', 'برغر', 'Burger', 'Burger', 'sandwich', 'piece', '{"default": 250}', '{"beef_patty": 150}')
on conflict (id) do nothing;
insert into public.menu_item_nutrition (item_id, vendor_id, dish_id, kcal, protein_g, carbs_g, fat_g, value_sources, status,
  assumptions, may_contain)
select x.i, x.v, 'sc_burger', 500, 25, 40, 25, '{}', 'estimated', '{}', '{}'
from (values ('5f000000-0000-0000-0000-0000000000d1'::uuid, '5f000000-0000-0000-0000-0000000000b1'::uuid),
             ('5f000000-0000-0000-0000-0000000000d4', '5f000000-0000-0000-0000-0000000000b3'),
             ('5f000000-0000-0000-0000-0000000000d5', '5f000000-0000-0000-0000-0000000000b4'),
             ('5f000000-0000-0000-0000-0000000000d6', '5f000000-0000-0000-0000-0000000000b1')) x(i, v);
select public.customer_turn_begin('+96170000183', 'wamid.sc.pin', 'text', 'Split tester') as t3 \gset
select (:'t3'::jsonb #>> '{customer,id}') as cid \gset
select public.address_save_pin(:'cid', 33.6775, 35.5645, 'Home') as pin \gset
select public.address_set_for_whom(:'cid', (:'pin'::jsonb #>> '{address,address_id}')::uuid, 'self', true);
update public.addresses set place_id = 'LB-CHF-SCTEST' where id = (:'pin'::jsonb #>> '{address,address_id}')::uuid;
select public.shop_place_routes_save(jsonb_build_array(
  jsonb_build_object('vendor_id', '5f000000-0000-0000-0000-0000000000b1', 'place_id', 'LB-CHF-SCTEST', 'road_km', 24.0, 'minutes', 40,
    'origin_lat', 33.68, 'origin_lon', 35.58, 'dest_lat', 33.67739, 'dest_lon', 35.56355),
  jsonb_build_object('vendor_id', '5f000000-0000-0000-0000-0000000000b2', 'place_id', 'LB-CHF-SCTEST', 'road_km', 4.0, 'minutes', 9,
    'origin_lat', 33.70, 'origin_lon', 35.60, 'dest_lat', 33.67739, 'dest_lon', 35.56355),
  jsonb_build_object('vendor_id', '5f000000-0000-0000-0000-0000000000b3', 'place_id', 'LB-CHF-SCTEST', 'road_km', 1.2, 'minutes', 3,
    'origin_lat', 33.678, 'origin_lon', 35.565, 'dest_lat', 33.67739, 'dest_lon', 35.56355),
  jsonb_build_object('vendor_id', '5f000000-0000-0000-0000-0000000000b4', 'place_id', 'LB-CHF-SCTEST', 'road_km', 30.0, 'minutes', 50,
    'origin_lat', 33.80, 'origin_lon', 35.70, 'dest_lat', 33.67739, 'dest_lon', 35.56355)));
select public.cart_split(:'cid', 'wamid.pin', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 2),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d6', 'quantity', 2),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d2', 'quantity', 1))) as p \gset
select tests.ok(:'p'::jsonb ->> 'place_en' = 'Baakline' and not (:'p'::jsonb ->> 'place_paused')::boolean,
  'the customer''s village is named');
select tests.ok(:'p'::jsonb -> 'shops' -> 0 -> 'delivers' = 'false'::jsonb
  and :'p'::jsonb -> 'shops' -> 0 ->> 'delivery_status' = 'beyond_radius'
  and :'p'::jsonb -> 'shops' -> 1 -> 'delivers' = 'true'::jsonb, 'a shop beyond its radius does not deliver; the other does');
select tests.ok(:'p'::jsonb -> 'shops' -> 0 -> 'alternative' ->> 'item_id' = '5f000000-0000-0000-0000-0000000000d4'
  and :'p'::jsonb -> 'shops' -> 0 -> 'alternative' ->> 'vendor_en' = 'Near Burger'
  and (:'p'::jsonb -> 'shops' -> 0 -> 'alternative' ->> 'quantity')::int = 2
  and (:'p'::jsonb -> 'shops' -> 0 -> 'alternative' ->> 'price_usd')::numeric = 7,
  'the closest open shop that delivers the same dish, with the quantity and its own price (never the far one)');
select tests.ok(:'p'::jsonb -> 'shops' -> 1 -> 'alternative' = 'null'::jsonb, 'a shop that delivers gets no alternative');
-- The customer takes the alternative: the burger leaves the far shop's saved cart, its fries stay kept and are named.
select (:'p'::jsonb -> 'shops' -> 0 ->> 'saved_cart_id') as bsc \gset
select tests.ok(public.saved_cart_swap('5f000000-0000-0000-0000-0000000000e2', :'bsc', '5f000000-0000-0000-0000-0000000000d4', 'wamid.sw') is null,
  'another customer cannot touch it');
select tests.ok(public.saved_cart_swap(:'cid', :'bsc', '5f000000-0000-0000-0000-0000000000d3', 'wamid.sw') is null,
  'a dish that is not the one offered for this cart changes nothing');
select public.saved_cart_swap(:'cid', :'bsc', '5f000000-0000-0000-0000-0000000000d4', 'wamid.sw') as sw \gset
select tests.ok(:'sw'::jsonb ->> 'status' = 'kept' and :'sw'::jsonb -> 'names_en' = '["Double Burger", "Fries"]'::jsonb
  and :'sw'::jsonb ->> 'vendor_en' = 'Split Burger' and :'sw'::jsonb -> 'join_saved_cart_id' = 'null'::jsonb
  and (select status = 'saved' and jsonb_array_length(lines) = 2 from public.saved_carts where id = :'bsc'::uuid),
  'taking the alternative removes only the line it stands in for (not the other burger); the rest stay kept, by name');
select tests.ok(public.saved_cart_swap(:'cid', :'bsc', '5f000000-0000-0000-0000-0000000000d4', 'wamid.sw') = :'sw'::jsonb
  and (select jsonb_array_length(lines) = 2 from public.saved_carts where id = :'bsc'::uuid),
  'a replayed turn gets the same answer and removes nothing more (the second burger stays)');
select tests.ok(public.saved_cart_swap(:'cid', :'bsc', '5f000000-0000-0000-0000-0000000000d4', 'wamid.sw.again') is null,
  'another tap on the same alternative changes nothing');
select (public.saved_cart_save(:'cid', 'both:wamid.sw', '[{"item_id": "5f000000-0000-0000-0000-0000000000d1", "quantity": 1}]')
  ->> 'saved_cart_id') as only_burger \gset
select public.saved_cart_swap(:'cid', :'only_burger', '5f000000-0000-0000-0000-0000000000d4', 'wamid.sw2') ->> 'status' as swapped \gset
select tests.ok(:'swapped' = 'dropped' and (select status = 'dropped' from public.saved_carts where id = :'only_burger'::uuid),
  'a saved cart left empty is dropped');
-- The alternative shop closed today, or hidden from this customer: no alternative, never a shop that cannot take it.
insert into public.vendor_closures (vendor_id, day) values ('5f000000-0000-0000-0000-0000000000b3', (now() at time zone 'Asia/Beirut')::date);
select tests.ok(app_private.cart_alternative(:'cid', '5f000000-0000-0000-0000-0000000000b1',
  '[{"item_id": "5f000000-0000-0000-0000-0000000000d1", "quantity": 1}]', '{}') is null, 'a closed shop is not offered');
delete from public.vendor_closures where vendor_id = '5f000000-0000-0000-0000-0000000000b3';
select tests.ok(app_private.cart_alternative(:'cid', '5f000000-0000-0000-0000-0000000000b1',
  '[{"item_id": "5f000000-0000-0000-0000-0000000000d1", "quantity": 1}]', array['5f000000-0000-0000-0000-0000000000b3'::uuid]) is null,
  'nor one hidden from this customer');
-- No recorded distance: unknown (checkout makes its one live call), never "doesn't deliver".
delete from public.shop_place_routes where vendor_id = '5f000000-0000-0000-0000-0000000000b2';
select public.cart_split(:'cid', 'wamid.pin2', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d4', 'quantity', 1))) as p2 \gset
select tests.ok(:'p2'::jsonb -> 'shops' -> 0 -> 'delivers' = 'null'::jsonb
  and :'p2'::jsonb -> 'shops' -> 0 ->> 'delivery_status' = 'no_route' and :'p2'::jsonb -> 'shops' -> 0 -> 'alternative' = 'null'::jsonb,
  'no recorded distance: no verdict and no alternative');
-- A shop beyond its radius keeps its saved cart (the customer may collect it) but is never the next delivery offer.
select tests.ok(public.saved_cart_next(:'cid') ->> 'vendor_en' in ('Split Sushi', 'Near Burger')
  and exists (select 1 from public.saved_carts sc where sc.customer_id = :'cid'::uuid and sc.status = 'saved'
              and sc.vendor_id = '5f000000-0000-0000-0000-0000000000b1'),
  'a shop beyond its radius keeps its saved cart, and is never the next delivery offer');
-- After a pickup order: any shop the customer can collect from, whatever its delivery radius.
update public.vendors set pickup_enabled = false where id in ('5f000000-0000-0000-0000-0000000000b2', '5f000000-0000-0000-0000-0000000000b3');
update public.vendors set pickup_enabled = true where id = '5f000000-0000-0000-0000-0000000000b1';
select tests.ok(public.saved_cart_next(:'cid', null, true) ->> 'vendor_en' = 'Split Burger',
  'after a pickup order, a shop that takes pickup is offered, even beyond its delivery radius');
-- A village we do not deliver to: the list says so, and nothing is offered after an order.
update public.places set service_status = 'off' where id = 'LB-CHF-SCTEST';
select tests.ok((public.cart_split(:'cid', 'wamid.pin3', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d3', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d4', 'quantity', 1))) ->> 'place_paused')::boolean
  and public.saved_cart_next(:'cid') is null, 'a paused village is named, and no saved cart is offered into it');
select tests.ok(public.saved_cart_next(:'cid', null, true) ->> 'vendor_en' = 'Split Burger',
  'but after a pickup order the customer can still collect the rest');
update public.places set service_status = 'on' where id = 'LB-CHF-SCTEST';

-- The alternative comes from a shop that is in the same cart: its own saved cart comes back to join the basket.
select public.cart_split(:'cid', 'wamid.join', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d4', 'quantity', 1))) as j \gset
select tests.ok(:'j'::jsonb -> 'shops' -> 0 -> 'alternative' ->> 'item_id' = '5f000000-0000-0000-0000-0000000000d4',
  'the far shop''s alternative is the near shop of the same cart');
select public.saved_cart_swap(:'cid', (:'j'::jsonb -> 'shops' -> 0 ->> 'saved_cart_id')::uuid,
  '5f000000-0000-0000-0000-0000000000d4', 'wamid.js') as js \gset
select tests.ok(:'js'::jsonb ->> 'status' = 'dropped'
  and :'js'::jsonb ->> 'join_saved_cart_id' = :'j'::jsonb -> 'shops' -> 1 ->> 'saved_cart_id',
  'the near shop''s own saved cart from the same send comes back, so the customer''s picks from it join the basket');
-- Do both with a shop beyond its radius: kept, and said to be for pickup (never promised as a delivery).
select public.saved_cart_save(:'cid', 'both:wamid.far', '[{"item_id": "5f000000-0000-0000-0000-0000000000d1", "quantity": 1}]') as far \gset
select tests.ok(:'far'::jsonb -> 'delivers' = 'false'::jsonb and not (:'far'::jsonb ->> 'place_paused')::boolean
  and (:'far'::jsonb ->> 'pickup_enabled')::boolean, 'Do both says a kept cart''s shop does not deliver to the pin, and takes pickup');

-- "Delete my data" forgets saved carts; the nightly prune clears used, dropped and expired ones.
select public.customer_forget(:'cid', 'all');
select tests.ok(not exists (select 1 from public.saved_carts where customer_id = :'cid'::uuid), 'delete my data forgets saved carts');
update public.saved_carts set created_at = now() - interval '8 days' where customer_id = '5f000000-0000-0000-0000-0000000000e1';
select app_private.saved_carts_prune() as pruned \gset
select tests.ok(:pruned >= 2
  and not exists (select 1 from public.saved_carts where customer_id = '5f000000-0000-0000-0000-0000000000e1' and status <> 'saved')
  and exists (select 1 from public.saved_carts where source_message_id = 'wamid.second'),
  'used and dropped saved carts go after a week, newer ones stay');
select tests.ok(exists (select 1 from cron.job where jobname = 'saved-carts-prune'), 'nightly');

-- Items a cart cannot take are named in both languages.
update public.menu_items set available = false where id = '5f000000-0000-0000-0000-0000000000d2';
select public.cart_merge('5f000000-0000-0000-0000-0000000000e2', 'wamid.merge', jsonb_build_array(
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d1', 'quantity', 1),
  jsonb_build_object('item_id', '5f000000-0000-0000-0000-0000000000d2', 'quantity', 1))) as m \gset
select tests.ok((select bool_or(x ->> 'item_en' = 'Fries') from jsonb_array_elements(:'m'::jsonb -> 'skipped') x),
  'an unavailable item is named, in English too');

-- Do both when the cart's shop stopped taking orders meanwhile: its items are named, never dropped silently.
update public.vendors set orderable = false, listing_status = 'hidden' where id = '5f000000-0000-0000-0000-0000000000b4';
select public.saved_cart_save('5f000000-0000-0000-0000-0000000000e2', 'both:wamid.y',
  '[{"item_id": "5f000000-0000-0000-0000-0000000000d5", "quantity": 1}]') as un \gset
select tests.ok(:'un'::jsonb ->> 'status' = 'unavailable' and :'un'::jsonb -> 'unavailable_en' = '["Burger"]'::jsonb,
  'Do both with a shop that stopped taking orders names its items');

-- Access: service role only.
set local role authenticated;
select tests.throws($$select * from public.saved_carts$$, 'permission denied', 'clients cannot read saved carts');
select tests.throws($$select public.cart_split('5f000000-0000-0000-0000-0000000000e1', 'x', '[]')$$, 'permission denied',
  'or split a cart');
reset role;

rollback;
