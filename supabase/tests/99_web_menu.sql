-- Session 5g (CUSTOMER-EXPERIENCE §4): the web shop menu behind a signed link. The token is the customer (no login), the
-- page reads the server's menu, fee and basket, and "Continue in WhatsApp" saves lines the server checks and prices, then
-- queues the bot's summary. Prices from the page are never read.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-WM', 'CHF', 'Web menu zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-WM', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test')
on conflict (id) do nothing;
select set_config('app.fixture_owner_phone', '+96170000181', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Chicken Shawarma') as shaw,
       (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Falafel Sandwich') as fal,
       (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Pepsi') as pepsi,
       (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Mint Lemonade') as lemon \gset
select (select o.id from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
        where g.item_id = :'shaw' and o.name_en = 'Large') as large,
       (select o.id from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
        where g.item_id = :'shaw' and o.name_en = 'Regular') as regular,
       (select o.id from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
        where g.item_id = :'lemon' and o.name_en = 'Large') as lemon_large \gset
select (public.customer_turn_begin('+96170000182', 'wamid.wm.1', 'text', 'Hi') #>> '{customer,id}') as cu \gset
select (public.customer_turn_begin('+96170000183', 'wamid.wm.2', 'text', 'Hi') #>> '{customer,id}') as cu2 \gset
insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at) values
  (:'cu', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5641 33.6771)', 'pin', true, now());

-- 1. Links ------------------------------------------------------------------------------------------------------------------
delete from public.app_config where key = 'public_site_url';
select tests.ok(public.web_link_create(:'cu', 'menu', :'tv', 'en') is null, 'no public site address yet: no link');
insert into public.app_config (key, value, effective_from, note)
values ('public_site_url', '"https://aloking.test/"', now() - interval '1 minute', 'test');
select public.web_link_create(:'cu', 'menu', :'tv', 'en') as url \gset
select tests.ok(:'url' ~ '^https://aloking\.test/en/m/alo-test-grill\?t=[A-Za-z0-9_-]{24}$', 'a menu link: the page, then the token');
select substring(:'url' from '\?t=(.*)$') as tok \gset
select tests.ok(not exists (select 1 from app_private.web_links w where w.token_hash = :'tok'),
  'only the token''s hash is stored');
select tests.ok(public.web_link_create(:'cu', 'explore', null, 'xx') ~ '^https://aloking\.test/ar/e\?t=', 'an Explore link, Arabic by default');
select tests.ok(public.web_link_create(:'cu', 'menu', null, 'en') is null and public.web_link_create(:'cu', 'other', null, 'en') is null,
  'no shop or an unknown kind: no link');
update public.vendors set orderable = false where id = :'tv';
select tests.ok(public.web_link_create(:'cu', 'menu', :'tv', 'en') is null, 'a shop that does not take orders gets no web menu');
update public.vendors set orderable = true where id = :'tv';
select tests.ok(not has_function_privilege('anon', 'public.web_link_create(uuid, text, uuid, text)', 'execute'),
  'anonymous callers cannot make links');

-- 2. The menu --------------------------------------------------------------------------------------------------------------
set local role anon;
select public.web_menu(:'tok', 'alo-test-grill') as m \gset
select public.web_menu('AAAAAAAAAAAAAAAAAAAAAAAA', 'alo-test-grill') ->> 'status' as bad \gset
select public.web_menu(:'tok', 'no-such-shop') ->> 'status' as other \gset
reset role;
select tests.ok(:'m'::jsonb ->> 'status' = 'ok' and :'m'::jsonb ->> 'lang' = 'en', 'a valid token opens the menu');
select tests.ok(:'bad' = 'expired' and :'other' = 'unavailable', 'an unknown token is expired; an unknown shop is unavailable');
select tests.ok(jsonb_array_length(:'m'::jsonb -> 'sections') = 4
  and :'m'::jsonb #>> '{sections,0,name_en}' = 'Sandwiches'
  and :'m'::jsonb #>> '{sections,0,items,0,name_en}' = 'Chicken Shawarma',
  'every section and item in the shop''s own order');
select tests.ok((select (g ->> 'min')::int = 1 and jsonb_array_length(g -> 'options') = 2
                 from jsonb_array_elements(:'m'::jsonb #> '{sections,0,items,0,groups}') g limit 1),
  'an item carries its required choice and its options with ids and prices');
select tests.ok(:'m'::jsonb -> 'delivery' ->> 'place_en' = 'Baakline' and (:'m'::jsonb -> 'delivery' ->> 'eta_min')::int >= 15
  and not (:'m'::jsonb -> 'delivery' ? 'lat') and not (:'m'::jsonb::text ~ '\+96170000182'),
  'the fee and ETA to the customer''s place, named by its village: never the pin or the phone');
select tests.ok(:'m'::jsonb -> 'basket' = 'null'::jsonb, 'no basket yet');
update public.menu_items set available = false where id = :'pepsi';
select tests.ok(not (public.web_menu(:'tok', 'alo-test-grill')::text ~ :'pepsi'), 'a sold-out item is not shown');
update public.menu_items set available = true where id = :'pepsi';
insert into public.catalog_item_holds (item_id, vendor_id, codes) values (:'fal', :'tv', '{policy_medicine}');
select tests.ok(not (public.web_menu(:'tok', 'alo-test-grill')::text ~ :'fal'), 'an item the medicine rule holds is never shown (§38.3)');
delete from public.catalog_item_holds where item_id = :'fal';
update app_private.web_links set expires_at = now() - interval '1 second'
where token_hash = encode(extensions.digest(:'tok', 'sha256'), 'hex');
select tests.ok(public.web_menu(:'tok', 'alo-test-grill') ->> 'status' = 'expired', 'an expired link answers expired');
update app_private.web_links set expires_at = now() + interval '1 hour'
where token_hash = encode(extensions.digest(:'tok', 'sha256'), 'hex');

-- 3. Continue in WhatsApp ----------------------------------------------------------------------------------------------------
set local role anon;
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'shaw', 'quantity', 1))) ->> 'status' as s1 \gset
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'shaw', 'quantity', 1,
  'option_ids', jsonb_build_array(:'large', :'regular')))) ->> 'status' as s2 \gset
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'shaw', 'quantity', 1,
  'option_ids', jsonb_build_array(:'lemon_large')))) ->> 'status' as s3 \gset
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'shaw', 'quantity', 99,
  'option_ids', jsonb_build_array(:'large')))) ->> 'status' as s4 \gset
select public.web_basket_save(:'tok', 'alo-test-grill', '[]') ->> 'status' as s5 \gset
reset role;
select tests.ok(:'s1' = 'choices' and :'s2' = 'choices', 'a required size missing, or two sizes in a one-size group: refused');
select tests.ok(:'s3' = 'invalid' and :'s4' = 'invalid' and :'s5' = 'invalid',
  'another item''s option, a quantity over 50, or no lines: refused');
select tests.ok(not exists (select 1 from public.baskets b where b.customer_id = :'cu' and b.status = 'open'), 'nothing refused was written');

-- WhatsApp's 24-hour window is closed: the basket is saved, nothing is queued, and the page asks the customer to write.
set local role anon;
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'fal', 'quantity', 1))) as cl \gset
reset role;
select tests.ok(:'cl'::jsonb ->> 'status' = 'saved' and (:'cl'::jsonb ->> 'chat_closed')::boolean
  and not exists (select 1 from public.webhook_events where payload ->> 'alo_synthetic' = 'web'),
  'the window is closed: saved, no summary queued, chat_closed for the page');
-- The customer wrote to our number a moment ago: the window is open on it.
insert into public.whatsapp_numbers (phone_number_id, display_phone, role) values ('5550000101', '+12025550101', 'customer')
on conflict (phone_number_id) do nothing;
select public.whatsapp_seen('+96170000182', '5550000101');
select count(*) as ev0 from public.webhook_events where payload ->> 'alo_synthetic' = 'web' \gset
set local role anon;
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(
  jsonb_build_object('item_id', :'shaw', 'quantity', 2, 'option_ids', jsonb_build_array(:'large'), 'note', 'no onions',
    'price_usd', 0.01, 'unit_price_usd', 0.01),
  jsonb_build_object('item_id', :'pepsi', 'quantity', 1))) as sv \gset
reset role;
select tests.ok(:'sv'::jsonb ->> 'status' = 'saved' and (:'sv'::jsonb ->> 'items')::int = 3
  and not (:'sv'::jsonb ->> 'chat_closed')::boolean, 'saved: two lines, three items');
select public.basket_view(:'cu') as bv \gset
select tests.ok((:'bv'::jsonb ->> 'subtotal_usd')::numeric = 2 * (4.50 + 1.50) + 1.00,
  'the server prices the basket from the menu (the page''s prices are never read)');
select tests.ok((select l ->> 'note' from jsonb_array_elements(:'bv'::jsonb -> 'lines') l where l ->> 'item_id' = :'shaw') = 'no onions',
  'the line''s note is kept');
select tests.ok((select count(*) from public.webhook_events where payload ->> 'alo_synthetic' = 'web') = :'ev0' + 1
  and (select payload #>> '{message,interactive,button_reply,id}' from public.webhook_events
       where payload ->> 'alo_synthetic' = 'web' order by id desc limit 1) = 'c:web'
  and (select payload #>> '{conversation,phone_number}' from public.webhook_events
       where payload ->> 'alo_synthetic' = 'web' order by id desc limit 1) = '+96170000182'
  and (select phone_number_id from public.webhook_events
       where payload ->> 'alo_synthetic' = 'web' order by id desc limit 1) = public.whatsapp_sender_for('customer', '+96170000182'),
  'one synthetic c:web tap is queued for the customer, so the bot sends the summary');

-- The page holds the whole basket for this shop: a second save replaces the lines.
set local role anon;
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'fal', 'quantity', 1))) ->> 'status' as s6 \gset
select public.web_menu(:'tok', 'alo-test-grill') -> 'basket' as b6 \gset
reset role;
select tests.ok(:'s6' = 'saved' and jsonb_array_length(public.basket_view(:'cu') -> 'lines') = 1
  and :'b6'::jsonb #>> '{lines,0,item_id}' = :'fal', 'a second save replaces the shop''s lines, and the page reads them back');

-- Another shop's basket is replaced only when the customer says so.
insert into public.vendors (slug, name_ar, name_en, business_type, claim_status, listing_status, orderable, source, location,
  delivery_radius_km, town_id) values
  ('wm-other-shop', 'محل تاني', 'Other Shop', 'restaurant', 'claimed', 'active', true, 'admin',
   app_private.lat_lon_point(33.6772, 35.5642), 10, 'LB-CHF-BAAKLINE')
returning id as ov \gset
insert into public.menu_items (vendor_id, name_en, price_usd) values (:'ov', 'Other Pie', 3.00) returning id as opie \gset
set local role anon;
select public.web_basket_save(:'tok', 'wm-other-shop', jsonb_build_array(jsonb_build_object('item_id', :'opie', 'quantity', 1))) as s7 \gset
select public.web_basket_save(:'tok', 'wm-other-shop', jsonb_build_array(jsonb_build_object('item_id', :'fal', 'quantity', 1)), true) ->> 'status' as s8 \gset
select public.web_basket_save(:'tok', 'wm-other-shop', jsonb_build_array(jsonb_build_object('item_id', :'opie', 'quantity', 1)), true) ->> 'status' as s9 \gset
reset role;
select tests.ok(:'s7'::jsonb ->> 'status' = 'other_vendor' and :'s7'::jsonb ->> 'vendor_en' = 'Alo Test Grill',
  'a basket from another shop: the page asks first');
select tests.ok(:'s8' = 'invalid', 'an item of another shop is refused');
select tests.ok(:'s9' = 'saved' and public.basket_view(:'cu') ->> 'vendor_id' = :'ov', 'with the customer''s yes, the new shop''s basket');

-- A link saves at most web_link_max_saves times.
update app_private.web_links set saves = public.config_numeric('web_link_max_saves')::int
where token_hash = encode(extensions.digest(:'tok', 'sha256'), 'hex');
set local role anon;
select public.web_basket_save(:'tok', 'wm-other-shop', jsonb_build_array(jsonb_build_object('item_id', :'opie', 'quantity', 2)), true) ->> 'status' as s10 \gset
reset role;
select tests.ok(:'s10' = 'too_many', 'a link that saved too often stops saving');

-- 4. Demo testers see only demo shops (basket_add_item refuses the rest for them).
select tests.ok(app_private.web_menu_shop(:'tv', :'cu2'), 'a customer may open an orderable shop');

-- 5. The site's photo route --------------------------------------------------------------------------------------------------
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash)
values (:'shaw', :'tv', 'merchant/' || :'tv' || '/' || :'shaw' || '.jpg', 'merchant', repeat('e', 64));
select tests.ok(public.site_photo(:'shaw', null) = 'merchant/' || :'tv' || '/' || :'shaw' || '.jpg'
  and public.site_photo(:'fal', null) is null, 'an item''s photo path, nothing for an item without one');
select tests.ok(not has_function_privilege('anon', 'public.site_photo(uuid, uuid)', 'execute'),
  'only the dispatch function reads photo paths');

-- 6. A synthetic turn is not the customer writing: last_inbound_at stays.
update public.customers set last_inbound_at = now() - interval '3 hours' where id = :'cu';
select public.customer_turn_begin('+96170000182', 'web.' || gen_random_uuid(), 'web') is not null as began \gset
select tests.ok((select last_inbound_at < now() - interval '2 hours' from public.customers where id = :'cu'),
  'a web turn leaves last_inbound_at as it was');
select public.customer_turn_begin('+96170000182', 'wamid.wm.9', 'text') is not null as began2 \gset
select tests.ok((select last_inbound_at > now() - interval '1 minute' from public.customers where id = :'cu'),
  'a message the customer sends moves it');

-- 7. "Delete my data" ends every link made before it.
update public.customers set profile_reset_at = now() where id = :'cu';
select tests.ok(public.web_menu(:'tok', 'alo-test-grill') ->> 'status' = 'expired', 'a forgotten customer''s link stops working');

rollback;
