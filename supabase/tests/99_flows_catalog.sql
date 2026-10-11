-- Session 5: WhatsApp Flows (§12), opening hours and the catalogue (§30.1.2).
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-FLW', 'CHF', 'Flowtown', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-FLOWTOWN', 'TZ-FLW', 'فلوتاون', 'Flowtown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test');
insert into public.addresses (id, customer_id, place_id, pin, source) values
  ('56000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LB-CHF-FLOWTOWN', 'SRID=4326;POINT(35.5861 33.6821)', 'pin');
insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd) values
  ('53000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Shawarma', 'شاورما', 5.00);
insert into public.menu_option_groups (id, item_id, name_en, min_select, max_select, sort_order) values
  ('53100000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'Size', 1, 1, 1),
  ('53100000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000001', 'Extras', 0, 2, 2);
insert into public.menu_options (id, group_id, name_en, price_delta_usd, sort_order) values
  ('53200000-0000-0000-0000-000000000001', '53100000-0000-0000-0000-000000000001', 'Small', 0, 1),
  ('53200000-0000-0000-0000-000000000002', '53100000-0000-0000-0000-000000000001', 'Large', 1.00, 2),
  ('53200000-0000-0000-0000-000000000003', '53100000-0000-0000-0000-000000000002', 'Cheese', 0.50, 1),
  ('53200000-0000-0000-0000-000000000004', '53100000-0000-0000-0000-000000000002', 'Fries', 0.50, 2),
  ('53200000-0000-0000-0000-000000000005', '53100000-0000-0000-0000-000000000002', 'Pickles', 0, 3);

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select id as owner_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'owner' \gset
select id as cashier_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'cashier' \gset

-- Off until published --------------------------------------------------------------------------------------
select tests.ok(public.flow_open('address_capture', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"address_id": "56000000-0000-0000-0000-000000000001"}') ->> 'status' = 'off', 'Flows stay off until published (text paths run)');
reset role;
insert into public.app_config (key, value, effective_from, note) values ('flows_enabled', 'true', now() - interval '1 second', 'test');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- address_capture -----------------------------------------------------------------------------------------
select public.flow_open('address_capture', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"address_id": "56000000-0000-0000-0000-000000000001"}') as fa \gset
select tests.ok(:'fa'::jsonb ->> 'screen' = 'ADDRESS' and :'fa'::jsonb #>> '{data,place_name}' = 'Flowtown'
  and (:'fa'::jsonb ->> 'token') ~ '^address_capture:[0-9a-f]{32}$', 'address_capture opens with the place from the pin and a random token');
select tests.ok(public.flow_open('address_capture', 'en', '+96170000002', '10000000-0000-0000-0000-000000000002', null,
  '{"address_id": "56000000-0000-0000-0000-000000000001"}') ->> 'status' = 'unknown_address', 'nobody opens a Flow on someone else''s address');
select tests.ok(public.flow_submit('+96170000009', :'fa'::jsonb ->> 'token', '{}') ->> 'status' = 'unknown', 'a token works only for its own number');
select public.flow_submit('+96170000001', :'fa'::jsonb ->> 'token', jsonb_build_object('address_id', '56000000-0000-0000-0000-000000000001',
  'building', 'Bnayet Abou Fadi', 'floor', '3', 'apartment', '5', 'landmark', 'facing the pharmacy', 'driver_phone', '71 234 567', 'notes', 'ring twice')) as sa \gset
reset role;
select tests.ok((select building_text = 'Bnayet Abou Fadi' and floor = '3' and apartment = '5' and phone_for_driver = '+96171234567'
  and note like 'facing the pharmacy%ring twice' from public.addresses where id = '56000000-0000-0000-0000-000000000001'),
  'the submission fills the address (local driver number normalised to E.164)');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.flow_submit('+96170000001', :'fa'::jsonb ->> 'token', '{}') ->> 'status' = 'duplicate', 'a token is used once (redelivery is a no-op)');

-- item_options: the server maps choices, enforces min/max and prices ---------------------------------------
select public.flow_open('item_options', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"item_id": "53000000-0000-0000-0000-000000000001"}') as fi \gset
select tests.ok(:'fi'::jsonb #>> '{data,g1_label}' = 'Size' and (:'fi'::jsonb #>> '{data,g1_required}')::boolean
  and jsonb_array_length(:'fi'::jsonb #> '{data,g2_items}') = 3 and :'fi'::jsonb #>> '{data,g1_items,1,description}' = '+$1.00'
  and not (:'fi'::jsonb #>> '{data,g3_visible}')::boolean, 'item_options carries groups, short option ids and price labels only');
select tests.ok(public.flow_submit('+96170000001', :'fi'::jsonb ->> 'token', jsonb_build_object('item_id', '53000000-0000-0000-0000-000000000001',
  'g1', 'o2', 'g2', jsonb_build_array('o3', 'o4', 'o5'), 'quantity', '2')) ->> 'reason' = 'choices', 'more extras than the group allows are refused');
select public.flow_open('item_options', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"item_id": "53000000-0000-0000-0000-000000000001"}') as fi2 \gset
select tests.ok(public.flow_submit('+96170000001', :'fi2'::jsonb ->> 'token', jsonb_build_object('item_id', '53000000-0000-0000-0000-000000000001',
  'g1', 'o9', 'quantity', '1')) ->> 'status' = 'rejected', 'an option id the Flow never offered is refused');
select public.flow_open('item_options', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"item_id": "53000000-0000-0000-0000-000000000001"}') as fi3 \gset
select public.flow_submit('+96170000001', :'fi3'::jsonb ->> 'token', jsonb_build_object('item_id', '53000000-0000-0000-0000-000000000001',
  'g1', 'o2', 'g2', jsonb_build_array('o3'), 'quantity', '2', 'note', 'no garlic', 'price', 0.01));
select tests.ok((select bi.quantity = 2 and bi.unit_price_usd = 6.50 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where b.customer_id = '10000000-0000-0000-0000-000000000001' and bi.item_id = '53000000-0000-0000-0000-000000000001'),
  'the basket line is priced by the server ($5 + $1 + $0.50), whatever the Flow sent');

-- merchant Flows -------------------------------------------------------------------------------------------
select tests.ok(public.flow_open('merchant_hours', 'ar', '+96171000002', null, :'cashier_a') ->> 'status' = 'not_allowed',
  'a cashier cannot open the hours Flow');
select public.flow_open('merchant_claim', 'ar', '+96171000001', null, :'owner_a') as fc \gset
select tests.ok(:'fc'::jsonb #>> '{data,name_en}' = 'Vendor A' and :'fc'::jsonb #> '{data,closed_days}' = '[]'
  and :'fc'::jsonb #>> '{data,fee_note}' like '%$%km%' and :'fc'::jsonb #>> '{data,fee_note}' not like '%-' and (:'fc'::jsonb #> '{data}') ? 'cash',
  'merchant_claim is pre-filled from the profile, its hours, cash and the current fee bands (no fixed numbers)');
-- A profile saved with the form's starting hours does not give an always-open branch fixed hours.
select public.flow_open('merchant_claim', 'en', '+96171000001', null, :'owner_a') as fc0 \gset
select public.flow_submit('+96171000001', :'fc0'::jsonb ->> 'token', (:'fc0'::jsonb -> 'data') || '{"owner_name": "Samir"}');
reset role;
select tests.ok((select count(*) = 0 from public.vendor_hours where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'saving the profile unchanged leaves a branch without hours always open');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flow_submit('+96171000001', :'fc'::jsonb ->> 'token', jsonb_build_object('vendor_id', '20000000-0000-0000-0000-00000000000a',
  'name_ar', 'مطعم أ', 'name_en', 'Vendor A', 'owner_name', 'Samir', 'opens', '11:00', 'closes', '01:00', 'radius_km', '25',
  'cash', jsonb_build_array('USD'), 'menu_photos', true)) as sc \gset
select tests.ok((:'sc'::jsonb ->> 'menu_photos')::boolean, 'the merchant asked to send menu photos next');
reset role;
select tests.ok((select name_ar = 'مطعم أ' and cash_currencies = '{USD}' and delivery_radius_km = public.max_delivery_km()
  and field_sources ->> 'name_ar' = 'merchant' from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'profile saved; the radius is capped by the bands; confirmed fields are the merchant''s');
select tests.ok((select count(*) = 7 from public.vendor_hours where vendor_id = '20000000-0000-0000-0000-00000000000a' and opens = '11:00' and closes = '01:00'),
  'hours saved for every day');
select tests.ok((select display_name = 'Samir' from public.vendor_members where id = :'owner_a'), 'the owner name is kept on the membership');
-- Hours and closed days come back into both merchant Flows, so a save without changes keeps them.
delete from public.vendor_hours where vendor_id = '20000000-0000-0000-0000-00000000000a' and weekday = 0;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flow_open('merchant_claim', 'en', '+96171000001', null, :'owner_a') as fc2 \gset
select tests.ok(:'fc2'::jsonb #>> '{data,opens}' = '11:00' and :'fc2'::jsonb #>> '{data,closes}' = '01:00'
  and :'fc2'::jsonb #> '{data,closed_days}' = '["0"]' and :'fc2'::jsonb #> '{data,cash}' = '["USD"]', 'merchant_claim starts from the real hours, closed days and cash');
select public.flow_submit('+96171000001', :'fc2'::jsonb ->> 'token', (:'fc2'::jsonb -> 'data') || '{"owner_name": "Samir"}');
select public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') as fh0 \gset
select tests.ok(:'fh0'::jsonb #> '{data,closed_days}' = '["0"]', 'merchant_hours starts from the real closed days');
select tests.ok(public.flow_submit('+96171000001', :'fh0'::jsonb ->> 'token', (:'fh0'::jsonb -> 'data') || '{"opens": "29:00", "pause": "none"}') ->> 'reason' = 'hours',
  'an impossible time is a rejection, not an error');
select public.flow_open('merchant_claim', 'en', '+96171000001', null, :'owner_a') as fc3 \gset
select tests.ok(public.flow_submit('+96171000001', :'fc3'::jsonb ->> 'token', (:'fc3'::jsonb -> 'data') || '{"radius_km": "far", "owner_name": "S"}') ->> 'reason' = 'invalid',
  'a malformed number is a rejection, not an error');
select public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') as fh9 \gset
reset role;
update public.flow_sends set sent_at = now() - interval '2 days' where token = :'fh9'::jsonb ->> 'token';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.flow_submit('+96171000001', :'fh9'::jsonb ->> 'token', :'fh9'::jsonb -> 'data') ->> 'reason' = 'expired',
  'a Flow submitted after the token lifetime is refused');
reset role;
select tests.ok((select count(*) = 6 and bool_and(opens = '11:00' and closes = '01:00') from public.vendor_hours where vendor_id = '20000000-0000-0000-0000-00000000000a')
  and (select delivery_radius_km = public.max_delivery_km() from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'after unchanged saves and rejections the hours, closed day and radius are as the merchant set them');
-- "Closed until tomorrow" for a shop open past midnight reopens at the next evening, not inside tonight.
select tests.ok(app_private.vendor_next_window('20000000-0000-0000-0000-00000000000a', '2026-10-14 22:00 Asia/Beirut') = '2026-10-15 11:00 Asia/Beirut',
  'the next opening window skips the rest of tonight''s window');
-- Hours: open at 23:30 and 00:30 (past midnight), closed at 05:00.
select tests.ok(app_private.vendor_open_at('20000000-0000-0000-0000-00000000000a', '2026-10-14 23:30 Asia/Beirut')
  and app_private.vendor_open_at('20000000-0000-0000-0000-00000000000a', '2026-10-15 00:30 Asia/Beirut')
  and not app_private.vendor_open_at('20000000-0000-0000-0000-00000000000a', '2026-10-15 05:00 Asia/Beirut'),
  'a closing time after midnight keeps the vendor open into the next day');
update public.vendors set paused_until = null, pause_reason = null, orderable = true where id = '20000000-0000-0000-0000-00000000000a';
delete from public.vendor_hours where vendor_id = '20000000-0000-0000-0000-00000000000a';
insert into public.vendor_hours (vendor_id, weekday, opens, closes)
select '20000000-0000-0000-0000-00000000000a', d,
  ((now() at time zone 'Asia/Beirut') + interval '2 hours')::time, ((now() at time zone 'Asia/Beirut') + interval '3 hours')::time
from generate_series(0, 6) d;
select app_private.hours_tick();
select tests.ok((select pause_reason = 'closed (hours)' and paused_until > now() from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'outside its hours a vendor is paused until it opens');
update public.vendors set paused_until = now() + interval '30 minutes', pause_reason = 'merchant pause' where id = '20000000-0000-0000-0000-00000000000a';
update public.vendor_hours set opens = '00:00', closes = '23:59' where vendor_id = '20000000-0000-0000-0000-00000000000a';
select app_private.hours_tick();
select tests.ok((select pause_reason = 'merchant pause' from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'the tick never lifts the merchant''s own pause');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') as fh \gset
select tests.ok(public.flow_submit('+96171000001', :'fh'::jsonb ->> 'token', jsonb_build_object('vendor_id', '20000000-0000-0000-0000-00000000000a',
  'opens', '09:00', 'closes', '22:00', 'closed_days', jsonb_build_array('0','1','2','3','4','5','6'), 'pause', 'none')) ->> 'reason' = 'closed every day',
  'closing every day is refused (that is a listing change, not hours)');
select public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') as fh2 \gset
select tests.ok(public.flow_submit('+96171000001', :'fh2'::jsonb ->> 'token', jsonb_build_object('vendor_id', '20000000-0000-0000-0000-00000000000a',
  'opens', '09:00', 'closes', '22:00', 'closed_days', jsonb_build_array('1'), 'pause', '2h')) ->> 'status' = 'saved', 'hours and a closure are saved');
reset role;
select tests.ok((select count(*) = 6 from public.vendor_hours where vendor_id = '20000000-0000-0000-0000-00000000000a')
  and (select paused_until between now() + interval '119 minutes' and now() + interval '121 minutes' from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'a closed day has no row and the 2-hour closure is a pause');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((public.flow_kill_gate() -> 'item_options' ->> 'sends')::int = 3, 'sends and submissions are counted per Flow (kill-gate)');
-- An item whose groups do not fit the Flow's shape uses the text path.
reset role;
insert into public.menu_option_groups (id, item_id, name_en, min_select, max_select, sort_order) values
  ('53100000-0000-0000-0000-000000000003', '53000000-0000-0000-0000-000000000001', 'Sauces', 2, 3, 3);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.flow_open('item_options', 'en', '+96170000001', '10000000-0000-0000-0000-000000000001', null,
  '{"item_id": "53000000-0000-0000-0000-000000000001"}') ->> 'status' = 'unsuited', 'a third group with several choices is not sent as a Flow');
-- Per-Flow switch and the kill-gate: a Flow under the completion floor is no longer sent.
select public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') ->> 'status' = 'ok' as opened \gset
select public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') ->> 'status' = 'ok' as opened \gset
reset role;
insert into public.app_config (key, value, effective_from, note) values
  ('flows_enabled', '{"address_capture": true, "item_options": true, "merchant_claim": false, "merchant_hours": true}', now(), 'test'),
  ('flow_kill_gate', '{"min_sends": 3, "min_completion": 0.9}', now(), 'test');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.flow_open('merchant_claim', 'en', '+96171000001', null, :'owner_a') ->> 'status' = 'off'
  and public.flow_open('merchant_hours', 'en', '+96171000001', null, :'owner_a') ->> 'status' = 'off',
  'each Flow has its own switch, and one under its kill-gate floor stops being sent');

-- Catalogue ------------------------------------------------------------------------------------------------
select tests.ok((select bool_and((x ->> 'retailer_id')::uuid is not null and (x ->> 'currency') = 'USD' and (x ->> 'product_set') = '20000000-0000-0000-0000-00000000000a')
  from jsonb_array_elements(public.catalog_desired('20000000-0000-0000-0000-00000000000a')) x), 'the desired catalogue uses our item ids and one set per branch');
select tests.ok(jsonb_array_length(public.catalog_desired('20000000-0000-0000-0000-00000000000c')) = 0, 'an unclaimed vendor has no catalogue');
select public.catalog_sync_record('20000000-0000-0000-0000-00000000000a', '[{"retailer_id": "53000000-0000-0000-0000-000000000001", "hash": "h1"}, {"retailer_id": "51000000-0000-0000-0000-000000000009", "hash": "foreign"}]');
select tests.ok(public.catalog_synced('20000000-0000-0000-0000-00000000000a') = '{"53000000-0000-0000-0000-000000000001": "h1"}',
  'sync state keeps only this vendor''s items');
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws('select public.flow_open(''merchant_hours'', ''en'', ''+1'')', 'permission denied', 'clients cannot open Flows directly');
select tests.ok((select count(*) = 0 from public.flow_sends), 'a customer sees no Flow tokens');

rollback;
