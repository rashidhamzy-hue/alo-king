-- Session 5f (DECISIONS §39.15.1): routing never blocks an order. Shop → place road distances are the fallback for the
-- browse screens and the checkout, the order records where its distance came from, the route cache keeps 30 days, the
-- daily OpenRouteService budget keeps a reserve for checkout, simulator numbers read recorded routes, and a customer's
-- pin leaves the cache with the address.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-RNB', 'CHF', 'Routing test zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source, service_status) values
  ('LB-CHF-BAAKLINE', 'TZ-RNB', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test', 'on');

select set_config('app.fixture_owner_phone', '+96170000151', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset
-- The grill stands in for a real Baakline shop: real shops need a road distance, the test merchant never does.
update public.vendors set is_test = false, town_id = 'LB-CHF-BAAKLINE', location = 'SRID=4326;POINT(35.5640 33.6770)'
where id = :'tv';

select public.customer_turn_begin('+96170000152', 'wamid.rnb.1', 'text', 'Routing tester') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as cid \gset
select public.address_save_pin(:'cid', 33.6775, 35.5645, 'Home') as pin \gset
select (:'pin'::jsonb #>> '{address,address_id}') as aid \gset
select tests.ok(public.basket_add_item(:'cid', :'falafel', 2, '{}', null, true) ->> 'status' = 'added', 'a basket from the shop');
select public.address_set_for_whom(:'cid', :'aid', 'self', true);

-- Neither a cached route nor a shop → place distance ------------------------------------------------------------------
select tests.ok(public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'no_route'
  and public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,origin}' is null,
  'browse: no_route, and never pins to fetch a route with (zero routing calls)');
select public.basket_quote(:'cid') as q0 \gset
select tests.ok(:'q0'::jsonb ->> 'status' = 'no_route' and :'q0'::jsonb #>> '{origin,lat}' is not null
  and :'q0'::jsonb #>> '{dest,lon}' is not null, 'checkout: no_route with both pins for the one live call');

-- The route-matrix workflow fills shop_place_routes ----------------------------------------------------------------------
select tests.ok(exists (select 1 from public.shop_place_routes_needed('active') where vendor_id = :'tv' and place_id = 'LB-CHF-BAAKLINE'),
  'an orderable shop × a delivered-to place is needed');
select tests.ok(not exists (select 1 from public.shop_place_routes_needed('active') n join public.places p on p.id = n.place_id
  where p.service_status <> 'on'), 'only delivered-to places');
select tests.ok(public.shop_place_routes_save(jsonb_build_array(jsonb_build_object('vendor_id', :'tv', 'place_id', 'LB-CHF-BAAKLINE',
  'road_km', 4.2, 'minutes', 9.5, 'origin_lat', 33.6770, 'origin_lon', 35.5640, 'dest_lat', 33.67739, 'dest_lon', 35.56355))) = 1,
  'the workflow saves a pair');
select tests.ok(not exists (select 1 from public.shop_place_routes_needed('active') where vendor_id = :'tv' and place_id = 'LB-CHF-BAAKLINE'),
  'a computed pair is not needed again');

-- Browse and checkout fall back to the place distance -------------------------------------------------------------------
select public.customer_delivery_check(:'cid', array[:'tv'::uuid]) as c1 \gset
select tests.ok(:'c1'::jsonb #>> '{vendors,0,status}' = 'ok' and (:'c1'::jsonb #>> '{vendors,0,fee_usd}')::numeric = 3.00
  and :'c1'::jsonb #>> '{vendors,0,route_source}' = 'place_fallback', 'browse: the fee from the shop → place distance (4.2 km, $3)');
select public.basket_quote(:'cid') as q1 \gset
select tests.ok(:'q1'::jsonb ->> 'status' = 'ok' and (:'q1'::jsonb ->> 'delivery_fee_usd')::numeric = 3.00
  and :'q1'::jsonb ->> 'route_source' = 'place_fallback' and (:'q1'::jsonb ->> 'road_km')::numeric = 4.20,
  'checkout quotes from the place distance');
select tests.ok(:'q1'::jsonb #>> '{origin,lat}' is not null, 'and hands back the pins: the exact route is still worth one live call');
select b.id as bid, b.priced_menu_version as ver from public.baskets b where b.customer_id = :'cid' and b.status = 'open' \gset
select public.order_place(:'bid', :'ver', 'test:rnb:1') as o1 \gset
select tests.ok(:'o1'::jsonb ->> 'status' = 'placed', 'the order goes through on the place distance');
select tests.ok((select route_source = 'place_fallback' and road_km = 4.20 and delivery_fee_usd = 3.00 from public.orders
  where id = (:'o1'::jsonb ->> 'order_id')::uuid), 'and records route_source = place_fallback');

-- The exact route wins once cached ---------------------------------------------------------------------------------------
select tests.ok(public.basket_add_item(:'cid', :'falafel', 1, '{}', null, true) ->> 'status' = 'added', 'a second basket');
select public.route_cache_store(33.6770, 35.5640, array[33.6775], array[35.5645], array[2100], array[300], 'ors');
select public.basket_quote(:'cid') as q2 \gset
select tests.ok(:'q2'::jsonb ->> 'route_source' = 'ors' and (:'q2'::jsonb ->> 'delivery_fee_usd')::numeric = 2.00
  and :'q2'::jsonb -> 'origin' is null, 'with the exact route cached: its distance, and no live call asked for');
select tests.ok((select expires_at between now() + interval '719 hours' and now() + interval '721 hours' from public.route_cache
  where provider = 'ors' limit 1), 'a stored route lives 30 days (route_cache_ttl_hours 720)');

-- A shop that moved: its old place distance no longer counts ------------------------------------------------------------
update public.vendors set location = 'SRID=4326;POINT(35.5740 33.6770)' where id = :'tv';
select tests.ok(public.customer_delivery_check(:'cid', array[:'tv'::uuid]) #>> '{vendors,0,status}' = 'no_route',
  'a shop pin moved about 900 m: the old distance is not used');
select tests.ok(exists (select 1 from public.shop_place_routes_needed('active') where vendor_id = :'tv' and place_id = 'LB-CHF-BAAKLINE'), 'and the pair is needed again');
update public.vendors set location = 'SRID=4326;POINT(35.5640 33.6770)' where id = :'tv';
-- No road found: kept as such, asked again only after a week, never used.
select public.shop_place_routes_save(jsonb_build_array(jsonb_build_object('vendor_id', :'tv', 'place_id', 'LB-CHF-BAAKLINE',
  'road_km', null, 'minutes', null, 'origin_lat', 33.6770, 'origin_lon', 35.5640, 'dest_lat', 33.67739, 'dest_lon', 35.56355)));
select tests.ok(not exists (select 1 from public.shop_place_routes_needed('active') where vendor_id = :'tv' and place_id = 'LB-CHF-BAAKLINE'), 'no road: not asked again today');
update public.shop_place_routes set computed_on = now() - interval '8 days' where vendor_id = :'tv';
select tests.ok(exists (select 1 from public.shop_place_routes_needed('active') where vendor_id = :'tv' and place_id = 'LB-CHF-BAAKLINE'), 'but after a week');

-- A customer's pin leaves the cache with the address --------------------------------------------------------------------
select tests.ok((select count(*) from public.route_cache where dest_key = '33.6775,35.5645') = 1, 'the customer''s pin is in the cache');
update public.baskets set address_id = null where address_id = :'aid';
update public.orders set address_id = null where address_id = :'aid';
delete from public.addresses where id = :'aid';
select tests.ok(not exists (select 1 from public.route_cache where dest_key = '33.6775,35.5645'), 'deleting the address deletes its cached routes');

-- The daily budget ---------------------------------------------------------------------------------------------------------
insert into public.routing_usage (day, requests) values ((now() at time zone 'utc')::date, 239);
select tests.ok((public.routing_take('browse', 33.67, 35.56, 33.68, 35.57) ->> 'ok')::boolean, 'below the reserve anyone may call');
select tests.ok(exists (select 1 from public.ops_alerts where kind = 'routing_budget'), 'crossing 60% of the budget raises an operator alert');
select tests.ok(public.routing_take('browse', 33.67, 35.56, 33.69, 35.57) ->> 'reason' = 'reserved', 'past it, only checkout');
select tests.ok((public.routing_take('checkout', 33.67, 35.56, 33.69, 35.57) ->> 'ok')::boolean, 'checkout still may');
select tests.ok(public.routing_take('checkout', 33.67, 35.56, 33.69, 35.57) ->> 'reason' = 'recent_attempt',
  'the same shop and pin are not asked twice in a row');
select tests.ok((public.routing_take('checkout', 33.67, 35.56, 33.69, 35.57, true) ->> 'ok')::boolean, 'unless the customer tapped Try again');
select tests.ok(public.routing_matrix_take(10) = 0, 'the matrix workflow never eats into checkout''s share');
update public.routing_usage set requests = 400 where day = (now() at time zone 'utc')::date;
select tests.ok(public.routing_take('checkout', 33.67, 35.56, 33.70, 35.57) ->> 'reason' = 'budget', 'at the budget nobody calls');
select tests.ok((select refused >= 2 and checkout = 2 from public.routing_usage where day = (now() at time zone 'utc')::date),
  'calls made and refused are counted');
update public.routing_usage set requests = 230 where day = (now() at time zone 'utc')::date;
select tests.ok(public.routing_matrix_take(25) = 10, 'the workflow gets what is left below the reserve');
select tests.ok((select count(*) from public.ops_alerts where kind = 'routing_budget') = 1, 'one alert a day');
select tests.throws($$select public.routing_take('matrix', 33.67, 35.56, 33.70, 35.57)$$, 'unknown routing purpose',
  'the matrix share is taken only through routing_matrix_take');

-- Recorded routes for simulator numbers ---------------------------------------------------------------------------------
select public.route_cache_store(33.6770, 35.5640, array[33.6775], array[35.5645], array[2100], array[300], 'ors');
select tests.ok(app_private.routing_fixtures_record() >= 1, 'the staging fixture records every route ORS gave us');
select tests.ok((select distance_m from public.routing_fixture_lookup(33.6770, 35.5640, array[33.6775], array[35.5645])) = 2100,
  'a simulator route comes from the fixture');
select tests.ok((select distance_m from public.routing_fixture_lookup(33.6770, 35.5640, array[33.9], array[35.9])) is null,
  'and a pair never recorded is unknown (the place distance then applies)');

-- Access -------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.routing_take('checkout', 33.67, 35.56, 33.70, 35.57)$$, 'permission denied', 'clients cannot spend the routing budget');
select tests.throws($$select * from public.shop_place_routes$$, 'permission denied', 'clients cannot read shop → place distances');
select tests.throws($$select * from public.routing_usage$$, 'permission denied', 'or the routing usage');
reset role;

rollback;
