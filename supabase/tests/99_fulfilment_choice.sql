-- Session 6a (DECISIONS §37.6): basket_fulfilment_options tells the bot whether the open basket's shop takes
-- delivery, pickup or both, so checkout can offer the Delivery / Pickup buttons. Read-only, service role only.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-TST', 'CHF', 'Testline', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-TST', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test');

select set_config('app.fixture_owner_phone', '+96170000097', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as falafel \gset

select public.customer_turn_begin('+96170000021', 'wamid.fc.1', 'text', 'Fulfilment tester') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as cid \gset

select tests.ok(public.basket_fulfilment_options(:'cid') ->> 'status' = 'no_basket', 'no basket: the answer says so');

select public.basket_add_item(:'cid', :'falafel', 1, '{}', null, true) as added \gset
select tests.ok(public.basket_fulfilment_options(:'cid') ->> 'status' = 'ok'
  and (public.basket_fulfilment_options(:'cid') ->> 'delivery')::boolean
  and (public.basket_fulfilment_options(:'cid') ->> 'pickup')::boolean
  and public.basket_fulfilment_options(:'cid') ->> 'fulfilment' = 'delivery',
  'the test merchant takes both; a new basket is a delivery basket');

update public.vendors set pickup_enabled = false where id = :'tv';
select tests.ok(not (public.basket_fulfilment_options(:'cid') ->> 'pickup')::boolean
  and (public.basket_fulfilment_options(:'cid') ->> 'delivery')::boolean, 'a shop that turned pickup off is delivery only');

update public.vendors set pickup_enabled = true, delivery_enabled = false where id = :'tv';
select tests.ok((public.basket_fulfilment_options(:'cid') ->> 'pickup')::boolean
  and not (public.basket_fulfilment_options(:'cid') ->> 'delivery')::boolean, 'a shop that turned delivery off is pickup only');

select public.basket_set_checkout(:'cid', 'pickup'::public.fulfilment_kind) as co \gset
select tests.ok(public.basket_fulfilment_options(:'cid') ->> 'fulfilment' = 'pickup', 'the stored choice is reported back');

-- Only the service role may call it (the customer's bot runs as the service role).
select tests.ok(not has_function_privilege('anon', 'public.basket_fulfilment_options(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.basket_fulfilment_options(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.basket_fulfilment_options(uuid)', 'execute'),
  'service role only');

rollback;
