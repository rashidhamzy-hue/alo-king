-- Session 5b (DECISIONS §12, §38.3, §39.8): the address Flow with the landmark and the lift, the checkout Flow and the
-- merchant's menu-section Flow, all behind config flows_enabled and re-checked by the server.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-F5B', 'CHF', 'Flowville', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-FLOWVILLE', 'TZ-F5B', 'فلوفيل', 'Flowville', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test');
insert into public.addresses (id, customer_id, place_id, pin, source) values
  ('57000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LB-CHF-FLOWVILLE', 'SRID=4326;POINT(35.5861 33.6821)', 'pin');
insert into public.landmarks (id, place_id, name_en, name_ar, point, source, status, shared) values
  ('57100000-0000-0000-0000-000000000001', 'LB-CHF-FLOWVILLE', 'Flowville church', 'كنيسة فلوفيل', 'SRID=4326;POINT(35.5863 33.6822)', 'seed', 'unconfirmed', true),
  ('57100000-0000-0000-0000-000000000002', 'LB-CHF-FLOWVILLE', 'Old pharmacy', null, 'SRID=4326;POINT(35.5870 33.6830)', 'seed', 'confirmed', false),
  ('57100000-0000-0000-0000-000000000003', 'LB-CHF-FLOWVILLE', 'Private guess', null, 'SRID=4326;POINT(35.5862 33.6821)', 'learned', 'unconfirmed', false),
  ('57100000-0000-0000-0000-000000000004', 'LB-CHF-FLOWVILLE', 'Far away', null, 'SRID=4326;POINT(35.70 33.80)', 'seed', 'confirmed', true);
insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd, available) values
  ('57200000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Wrap', 'لفّة', 4.00, true);
update public.vendors set pickup_enabled = true, delivery_enabled = true where id = '20000000-0000-0000-0000-00000000000a';

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select id as owner_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'owner' \gset
select id as cashier_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'cashier' \gset

select tests.ok(public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001') ->> 'status' = 'off',
  'the new Flows are off until published');
reset role;
insert into public.app_config (key, value, effective_from, note) values ('flows_enabled', 'true', now() - interval '1 second', 'test');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 1. Address with the landmark and the lift ------------------------------------------------------------------------
select public.flow_open('address_capture', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"address_id": "57000000-0000-0000-0000-000000000001"}') as fa \gset
select tests.ok(:'fa'::jsonb #> '{data,landmarks}' = '[{"id": "l1", "title": "Flowville church"}, {"id": "none", "title": "Not listed"}]',
  'only shared landmarks (§28), nearest first, then "not listed"; a confirmed but unshared one, a private guess and a far one are not offered');
select public.flow_submit('+96170000001', :'fa'::jsonb ->> 'token', jsonb_build_object('address_id', '57000000-0000-0000-0000-000000000001',
  'building', 'Bnayet Saad', 'floor', '4', 'has_elevator', 'no', 'landmark_id', 'l1', 'landmark_relation', 'opposite')) as sa \gset
reset role;
select tests.ok((select building_text = 'Bnayet Saad' and floor = '4' and has_elevator = false
  and landmark_id = '57100000-0000-0000-0000-000000000001' and landmark_relation = 'opposite'
  from public.addresses where id = '57000000-0000-0000-0000-000000000001'), 'the landmark, where from it and the lift are saved');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flow_open('address_capture', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"address_id": "57000000-0000-0000-0000-000000000001"}') as fb \gset
select public.flow_submit('+96170000001', :'fb'::jsonb ->> 'token', jsonb_build_object('address_id', '57000000-0000-0000-0000-000000000001',
  'building', 'Bnayet Saad', 'landmark_id', 'l9', 'landmark_relation', 'behind', 'has_elevator', 'maybe'));
reset role;
select tests.ok((select landmark_id = '57100000-0000-0000-0000-000000000001' and landmark_relation = 'opposite' and has_elevator = false
  from public.addresses where id = '57000000-0000-0000-0000-000000000001'), 'a landmark key the Flow never offered changes nothing');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 2. Checkout --------------------------------------------------------------------------------------------------------
select tests.ok(public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001') ->> 'status' = 'no_basket',
  'no open basket, no checkout Flow');
select public.basket_add_item('10000000-0000-0000-0000-000000000001', '57200000-0000-0000-0000-000000000001', 2, '{}', null, false);
select public.basket_set_checkout('10000000-0000-0000-0000-000000000001', 'pickup', null, null, null);
select public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001') as fc \gset
select tests.ok(:'fc'::jsonb ->> 'screen' = 'CHECKOUT' and :'fc'::jsonb #>> '{data,lines}' like '2 × Wrap  $8.00%'
  and :'fc'::jsonb #>> '{data,total}' ~ '^Items: \$8\.00 = [0-9,]+ LBP$'
  and :'fc'::jsonb #> '{data,fulfilment_options}' @> '[{"id": "delivery"}, {"id": "pickup"}]'
  and :'fc'::jsonb #> '{data,cash_options}' @> '[{"id": "USD"}, {"id": "LBP"}]',
  'checkout shows the server''s priced lines and the items in USD and LBP, the ways and the cash this shop takes');
select tests.ok((public.flow_submit('+96170000001', :'fc'::jsonb ->> 'token', jsonb_build_object('basket_id', :'fc'::jsonb #>> '{data,basket_id}',
  'fulfilment', 'drone', 'cash', 'USD')) ->> 'reason') = 'choices', 'a way the shop does not offer is refused');
reset role;
update public.vendors set cash_currencies = '{USD}' where id = '20000000-0000-0000-0000-00000000000a';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001') as fc3 \gset
select tests.ok(:'fc3'::jsonb #> '{data,cash_options}' = '[{"id": "USD", "title": "US dollars (USD)"}]'
  and (public.flow_submit('+96170000001', :'fc3'::jsonb ->> 'token', jsonb_build_object('basket_id', :'fc3'::jsonb #>> '{data,basket_id}',
  'fulfilment', 'pickup', 'cash', 'LBP')) ->> 'reason') = 'choices', 'only the currencies the shop takes are offered and accepted');
reset role;
update public.vendors set cash_currencies = '{USD,LBP}' where id = '20000000-0000-0000-0000-00000000000a';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) as orders_before from public.orders where customer_id = '10000000-0000-0000-0000-000000000001' \gset
select public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001') as fc2 \gset
select tests.ok(public.flow_submit('+96170000001', :'fc2'::jsonb ->> 'token', jsonb_build_object('basket_id', :'fc2'::jsonb #>> '{data,basket_id}',
  'fulfilment', 'pickup', 'cash', 'LBP', 'note', 'no onions', 'total_usd', 0.01)) ->> 'status' = 'saved', 'the choices are saved');
reset role;
select tests.ok((select cash_currency = 'LBP' and fulfilment = 'pickup' from public.baskets
  where customer_id = '10000000-0000-0000-0000-000000000001' and status = 'open'), 'the basket carries them; a price sent by the Flow is ignored');
select tests.ok((select count(*) from public.orders o where o.customer_id = '10000000-0000-0000-0000-000000000001') = :orders_before,
  'the Flow places no order: the Confirm tap does');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001') as fc4 \gset
reset role;
update public.baskets set status = 'abandoned' where customer_id = '10000000-0000-0000-0000-000000000001' and status = 'open';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((public.flow_submit('+96170000001', :'fc4'::jsonb ->> 'token', jsonb_build_object('basket_id', :'fc4'::jsonb #>> '{data,basket_id}',
  'fulfilment', 'delivery', 'cash', 'USD')) ->> 'reason') = 'basket changed', 'a Flow for a basket that is no longer open saves nothing');

-- 3. Menu section -----------------------------------------------------------------------------------------------------
select (public.menu_draft_create('20000000-0000-0000-0000-00000000000a', 'text',
  '[{"name_en": "Grills", "items": [{"name_en": "Shish taouk", "price": 4.5, "currency": "USD"}, {"name_en": "Kafta", "price": 4, "currency": "USD"},
    {"name_en": "Not ours", "price": 9, "currency": "USD"}]}]', '[]', 'rules', :'owner_a')) ->> 'draft_id' as did \gset
select tests.ok(public.flow_open('menu_section', 'en', '+96171000002', null, :'cashier_a', jsonb_build_object('draft_id', :'did', 'index', 0)) ->> 'status' = 'not_allowed',
  'a cashier cannot confirm a menu section');
select public.flow_open('menu_section', 'en', '+96171000001', null, :'owner_a', jsonb_build_object('draft_id', :'did', 'index', 0)) as fm \gset
select tests.ok(:'fm'::jsonb #> '{data,all_items}' = '["i1", "i2", "i3"]' and :'fm'::jsonb #>> '{data,items,0,description}' = 'USD 4.5',
  'every item ticked to start, with its price exactly as read');
select public.flow_submit('+96171000001', :'fm'::jsonb ->> 'token', jsonb_build_object('draft_id', :'did', 'keep', jsonb_build_array('i1', 'i2', 'i2', 'i7'))) as sm \gset
select tests.ok((:'sm'::jsonb ->> 'left_out')::int = 1, 'one left out (a key it never offered, or sent twice, is ignored)');
reset role;
select tests.ok((select count(*) from public.menu_items where vendor_id = '20000000-0000-0000-0000-00000000000a' and name_en in ('Shish taouk', 'Kafta')) = 2
  and not exists (select 1 from public.menu_items where vendor_id = '20000000-0000-0000-0000-00000000000a' and name_en = 'Not ours'),
  'the kept items are on the menu at the read price; the unticked one is not');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flow_open('menu_section', 'en', '+96171000001', null, :'owner_a', jsonb_build_object('draft_id', :'did', 'index', 0)) as fm2 \gset
select tests.ok(:'fm2'::jsonb ->> 'status' = 'unknown_section', 'an approved section cannot be opened again');
select tests.ok(public.flow_open('menu_section', 'en', '+96171000001', null, :'owner_a', jsonb_build_object('draft_id', :'did', 'index', -1)) ->> 'status' = 'unknown_section',
  'a negative index is refused');
-- A section approved by the chat card while the Flow was open: the Flow changes nothing.
select (public.menu_draft_create('20000000-0000-0000-0000-00000000000a', 'text',
  '[{"name_en": "Sweets", "items": [{"name_en": "Knefe", "price": 3, "currency": "USD"}, {"name_en": "Maamoul", "price": 2, "currency": "USD"}]}]',
  '[]', 'rules', :'owner_a')) ->> 'draft_id' as did2 \gset
select public.flow_open('menu_section', 'en', '+96171000001', null, :'owner_a', jsonb_build_object('draft_id', :'did2', 'index', 0)) as fm3 \gset
select public.menu_draft_approve_section(:'did2', 0, :'owner_a');
select tests.ok((public.flow_submit('+96171000001', :'fm3'::jsonb ->> 'token', jsonb_build_object('draft_id', :'did2', 'keep', jsonb_build_array('i1'))) ->> 'reason') = 'section changed'
  and (select jsonb_array_length(sections -> 0 -> 'items') from public.menu_drafts where id = :'did2') = 2,
  'a section approved meanwhile is left exactly as read');

-- 4. Grants -------------------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.flow_open('checkout', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001')$$, 'permission denied',
  'a signed-in customer cannot open Flows directly');
select tests.throws($$select app_private.flow_submit_base('+96170000001', 'x', '{}')$$, 'permission denied', 'nor reach the base functions');

rollback;
