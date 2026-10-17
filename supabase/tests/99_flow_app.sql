-- Session 5h part 2 (DECISIONS §39.15.13): the Alo King Flow app's server side. A signed, expiring token bound to the
-- customer; the screens read the site's checked reads for the customer's point; items go into the basket only through the
-- server's checks, priced from the menu; the basket screen carries the server's totals; nothing for anonymous callers.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-FA', 'CHF', 'Flow app zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-FA', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test')
on conflict (id) do nothing;
select set_config('app.fixture_owner_phone', '+96170000191', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Chicken Shawarma') as shaw,
       (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Pepsi') as pepsi \gset
select (select o.id from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
        where g.item_id = :'shaw' and o.name_en = 'Large') as large,
       (select o.id from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
        where g.item_id = :'shaw' and o.name_en = 'Regular') as regular \gset
select (public.customer_turn_begin('+96170000192', 'wamid.fa.1', 'text', 'Hi') #>> '{customer,id}') as cu \gset
select (public.customer_turn_begin('+96170000193', 'wamid.fa.2', 'text', 'Hi') #>> '{customer,id}') as cu2 \gset

-- 1. Tokens -----------------------------------------------------------------------------------------------------------------
select tests.ok(public.flow_app_open(:'cu', 'en', true) is null, 'no delivery point yet: no Flow token (the chat asks for the pin)');
insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at) values
  (:'cu', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5641 33.6771)', 'pin', true, now());
select public.flow_app_open(:'cu', 'en', true) as ft \gset
select split_part(:'ft', '.', 1) as tok \gset
select tests.ok(:'ft' ~ '^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$', 'a token and its signature');
select tests.ok(public.flow_app_session(:'ft') ->> 'status' = 'ok'
  and (public.flow_app_session(:'ft') ->> 'customer_id')::uuid = :'cu'::uuid
  and public.flow_app_session(:'ft') ->> 'phone' = '+96170000192', 'the session names its customer and phone');
select tests.ok(public.flow_app_session(:'tok' || '.' || repeat('A', 43)) ->> 'status' = 'bad_signature',
  'a forged signature is refused before any lookup');
select tests.ok(public.flow_app_session('nonsense') ->> 'status' = 'bad_signature', 'anything else is refused');
select tests.ok(not exists (select 1 from app_private.web_links w where w.token_hash = :'tok'), 'only the token''s hash is stored');
select tests.ok(not has_function_privilege('anon', 'public.flow_app_open(uuid, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.flow_app_session(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.flow_app_proxy_key()', 'execute')
  and not has_function_privilege('anon', 'public.flow_app_add(text, uuid, integer, uuid[], text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.flow_app_thumbs(text, text[])', 'execute'),
  'none of it is callable by anonymous or signed-in users');
select tests.ok(public.flow_app_proxy_key() ~ '^[0-9a-f]{64}$', 'the proxy key exists for the service role');

-- 2. Screens read the site's checked reads through the Flow's own wrappers --------------------------------------------------
select tests.ok(public.flow_app_menu(:'tok', 'alo-test-grill') ->> 'status' = 'ok', 'the shop page reads the web menu');
select tests.ok(public.flow_app_explore(:'tok') ->> 'status' in ('ok', 'outside'), 'the home reads Explore');
set local role anon;
select public.web_menu(:'tok', 'alo-test-grill') ->> 'status' as anon_menu \gset
select public.web_explore(:'tok') ->> 'status' as anon_explore \gset
select public.web_basket_save(:'tok', 'alo-test-grill', jsonb_build_array(jsonb_build_object('item_id', :'pepsi', 'quantity', 1))) ->> 'status' as anon_save \gset
reset role;
select tests.ok(:'anon_menu' = 'expired' and :'anon_explore' = 'expired' and :'anon_save' = 'expired',
  'the Flow token''s first part opens nothing on the public web reads');
select tests.ok(not has_function_privilege('anon', 'public.flow_app_menu(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.flow_app_explore(text, text, text, integer)', 'execute'),
  'the Flow''s reads are the service role''s');

-- 3. Adding an item ----------------------------------------------------------------------------------------------------------
select tests.ok(public.flow_app_add(:'tok', :'shaw', 1, '{}') ->> 'status' = 'choices', 'a required choice must be chosen');
select tests.ok(public.flow_app_add(:'tok', :'shaw', 1, array[:'large', :'regular']::uuid[]) ->> 'status' = 'choices',
  'never more than a group allows');
select tests.ok(public.flow_app_add(:'tok', :'shaw', 1, array[gen_random_uuid()]) ->> 'status' = 'invalid',
  'a choice that is not the item''s own is refused');
select tests.ok(public.flow_app_add(:'tok', :'shaw', 99, array[:'large']::uuid[]) ->> 'status' = 'invalid', 'quantity 1 to 50');
select tests.ok(public.flow_app_add(:'tok', :'shaw', 2, array[:'large']::uuid[], 'no onions') ->> 'status' = 'added', 'added');
select tests.ok(public.flow_app_add(:'tok', :'pepsi', 1) ->> 'status' = 'added', 'a second line');
select tests.ok((select bi.unit_price_usd = i.price_usd + o.price_delta_usd and bi.note = 'no onions'
                 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                 join public.menu_items i on i.id = bi.item_id join public.menu_options o on o.id = :'large'
                 where b.customer_id = :'cu' and b.status = 'open' and bi.item_id = :'shaw'),
  'priced by the server from the menu, with its note');
select tests.ok(public.flow_app_add('AAAAAAAAAAAAAAAAAAAAAAAA', :'pepsi', 1) ->> 'status' = 'expired', 'an unknown token adds nothing');
update public.menu_items set available = false where id = :'pepsi';
select tests.ok(public.flow_app_add(:'tok', :'pepsi', 1) ->> 'status' = 'unavailable', 'a sold-out item cannot be added');
update public.menu_items set available = true where id = :'pepsi';

-- 4. The basket screen ---------------------------------------------------------------------------------------------------------
select public.flow_app_basket(:'tok') as b \gset
select tests.ok(:'b'::jsonb ->> 'status' = 'ok' and jsonb_array_length(:'b'::jsonb -> 'lines') = 2, 'the basket''s lines');
select tests.ok((:'b'::jsonb ->> 'subtotal_usd')::numeric = (select sum(bi.line_total_usd) from public.basket_items bi
                  join public.baskets x on x.id = bi.basket_id where x.customer_id = :'cu' and x.status = 'open'),
  'the subtotal is the server''s');
select tests.ok(:'b'::jsonb ->> 'fee_usd' is null or (:'b'::jsonb ->> 'total_usd')::numeric
  = (:'b'::jsonb ->> 'subtotal_usd')::numeric + (:'b'::jsonb ->> 'fee_usd')::numeric, 'total = subtotal + the delivery fee');
select tests.ok(public.flow_app_basket('AAAAAAAAAAAAAAAAAAAAAAAA') ->> 'status' = 'expired', 'an unknown token reads nothing');
-- Another customer's token cannot remove this customer's lines.
insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at) values
  (:'cu2', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5641 33.6771)', 'pin', true, now());
select split_part(public.flow_app_open(:'cu2', 'ar', true), '.', 1) as tok2 \gset
select public.flow_app_remove(:'tok2', (select array_agg(bi.id) from public.basket_items bi join public.baskets x on x.id = bi.basket_id
  where x.customer_id = :'cu')) ->> 'removed' as stolen \gset
select tests.ok(:'stolen' = '0', 'a token removes only its own customer''s lines');
select public.flow_app_remove(:'tok', array[(select (l ->> 'line_id')::uuid from jsonb_array_elements(:'b'::jsonb -> 'lines') l
  where l ->> 'item_id' = :'pepsi')]) ->> 'removed' as removed \gset
select tests.ok(:'removed' = '1' and jsonb_array_length(public.flow_app_basket(:'tok') -> 'lines') = 1, 'a line removed');

-- 5. Confirm and the kill-gate ---------------------------------------------------------------------------------------------------
select tests.ok(public.flow_app_complete(:'tok2') ->> 'status' = 'empty', 'an empty basket cannot be confirmed');
select public.flow_app_complete(:'tok') ->> 'status' as done \gset
select tests.ok(:'done' = 'ok'
  and (select w.completed_at is not null from app_private.web_links w where w.token_hash = encode(extensions.digest(:'tok', 'sha256'), 'hex')),
  'Confirm marks the Flow completed');
select tests.ok(not public.flow_app_enabled() and public.flow_app_open(:'cu', 'en') is null,
  'off until whatsapp-flows publishes it: the bot gets no token');
insert into public.app_config (key, value, effective_from, note) values ('flow_app_live', 'true', now() - interval '1 second', 'test');
select tests.ok(public.flow_app_enabled() and public.flow_app_open(:'cu', 'en') is not null, 'on once published');
insert into public.app_config (key, value, effective_from, note) values ('flow_kill_gate', '{"min_sends": 2, "min_completion": 0.9}', now() - interval '1 second', 'test');
select public.flow_app_open(:'cu', 'en', true) \gset
select public.flow_app_open(:'cu2', 'en', true) \gset
select public.flow_app_open(:'cu2', 'en', true) \gset
select tests.ok(public.flow_app_enabled(), 'simulator and test opens (p_force) never count');
select public.flow_app_open(:'cu2', 'en') \gset
select tests.ok(not public.flow_app_enabled(), 'the §12 kill-gate stops it when too few opens are completed');

-- 6. Images ---------------------------------------------------------------------------------------------------------------------
select public.flow_thumb_put('item', :'shaw', encode(convert_to('jpeg', 'UTF8'), 'base64'), 'merchant/x/y.jpg');
select tests.ok(public.flow_app_thumbs('item', array[:'shaw']) ->> :'shaw' = encode(convert_to('jpeg', 'UTF8'), 'base64'),
  'a stored image is read back by kind and reference');
select tests.ok(public.flow_thumb_sources() ? 'items' and public.flow_thumb_sources() -> 'made' ? ('item:' || :'shaw'),
  'the job sees what to make and what is made');
select public.flow_thumb_prune() as pruned \gset
select tests.ok(:'pruned'::int >= 1 and public.flow_app_thumbs('item', array[:'shaw']) = '{}'::jsonb,
  'an image whose photo is gone is pruned (the fixture item has no stored photo)');

rollback;
