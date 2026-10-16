-- Session 5d: the Meta catalogue and the native cart (DECISIONS §39.12).
begin;

insert into public.menu_sections (id, vendor_id, name_en, name_ar, sort_order) values
  ('54000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Sandwiches', 'سندويش', 1),
  ('54000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Sweets', 'حلو', 2);
insert into public.menu_items (id, vendor_id, section_id, name_en, name_ar, price_usd, available, sort_order) values
  ('55000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '54000000-0000-0000-0000-000000000001', 'Shawarma', 'شاورما', 5.00, true, 1),
  ('55000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '54000000-0000-0000-0000-000000000002', 'Knefe', 'كنافة', 3.00, true, 2),
  ('55000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '54000000-0000-0000-0000-000000000001', 'Taouk', 'طاووق', 4.00, true, 3),
  ('55000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000b', null, 'Manousheh', 'منقوشة', 1.00, true, 1);
insert into public.menu_option_groups (id, item_id, name_en, min_select, max_select, sort_order) values
  ('55100000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000003', 'Bread', 1, 1, 1);
insert into public.menu_options (id, group_id, name_en, price_delta_usd, sort_order) values
  ('55200000-0000-0000-0000-000000000001', '55100000-0000-0000-0000-000000000001', 'Saj', 0, 1);
-- A draft section on the same shop: never part of the catalogue.
insert into public.menu_drafts (vendor_id, source, sections) values
  ('20000000-0000-0000-0000-00000000000a', 'text', '[{"name_en": "Draft", "items": [{"name_en": "Draft dish", "price": 9, "currency": "USD"}], "approved": false}]');
-- Session 5e: only items with a photo of their own are in the catalogue (no drawn tile); Knefe has none.
insert into public.menu_item_photos (item_id, vendor_id, storage_path, source)
select i.id, i.vendor_id, 'merchant/' || i.vendor_id || '/' || i.id || '.jpg', 'merchant' from public.menu_items i
where i.id in ('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000003', '55000000-0000-0000-0000-000000000004');
insert into public.whatsapp_numbers (phone_number_id, role, waba_id, active) values ('1378974041965966', 'test', '1086076707594153', true)
  on conflict (phone_number_id) do update set waba_id = excluded.waba_id, active = true;

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The desired catalogue: published items only, our ids, USD, one set per shop -----------------------------------------
select tests.ok((select count(*) = 2 and bool_and(x ->> 'product_set' = '20000000-0000-0000-0000-00000000000a')
                   and bool_and(x ->> 'currency' = 'USD') and not bool_or(x ->> 'name' like '%Draft%')
                 from jsonb_array_elements(public.catalog_desired('20000000-0000-0000-0000-00000000000a')) x),
  'the desired catalogue is the published menu with photos (no draft item, no item without a photo), one set per shop, prices in USD');
select tests.ok((select (x ->> 'price_minor')::int = 500 and x ->> 'name' = 'شاورما · Shawarma' and x ->> 'brand' = 'Vendor A'
                 from jsonb_array_elements(public.catalog_desired('20000000-0000-0000-0000-00000000000a')) x
                 where x ->> 'retailer_id' = '55000000-0000-0000-0000-000000000001'),
  'a product carries the server price, both names and the shop as brand');
select tests.ok(jsonb_array_length(public.catalog_desired('20000000-0000-0000-0000-00000000000b')) = 0,
  'a claimed shop that is not orderable has no catalogue');

-- No catalogue yet: changes queue nothing ---------------------------------------------------------------------------------
reset role;
update public.menu_items set price_usd = 5.50 where id = '55000000-0000-0000-0000-000000000001';
select tests.ok(not exists (select 1 from app_private.catalog_sync_queue), 'without a writable catalogue nothing is queued');

-- A connected catalogue queues every catalogue shop for a full sync ------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.whatsapp_catalog_record('1086076707594153', '987654321012', 'kapso', true, null);
reset role;
select tests.ok((select force from app_private.catalog_sync_queue where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'connecting the catalogue queues the shop for a full sync');
select tests.ok(not exists (select 1 from app_private.catalog_sync_queue where vendor_id = '20000000-0000-0000-0000-00000000000c'),
  'an unclaimed shop is never queued');

-- The worker takes it with a lease and reports back --------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.catalog_sync_claim(1) as cl \gset
select tests.ok(:'cl'::jsonb #>> '{catalog,catalog_id}' = '987654321012' and :'cl'::jsonb #>> '{catalog,transport}' = 'kapso'
  and jsonb_array_length(:'cl'::jsonb -> 'items') = 1, 'the claim returns the shop and the catalogue route');
select tests.ok(jsonb_array_length(public.catalog_sync_claim(5) -> 'items') = 0, 'a taken shop is not taken twice during its lease');
reset role;
update public.menu_items set price_usd = 5.25 where id = '55000000-0000-0000-0000-000000000001';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(jsonb_array_length(public.catalog_sync_claim(5) -> 'items') = 0,
  'a change during the lease does not make the shop due again (no second worker on the same shop)');
select public.catalog_sync_finish('20000000-0000-0000-0000-00000000000a', (:'cl'::jsonb #>> '{items,0,queued_at}')::timestamptz, null);
reset role;
select tests.ok((select next_at <= now() and leased_until is null from app_private.catalog_sync_queue
                 where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'a shop changed while it synced runs again at once after the lease');
update public.menu_items set price_usd = 5.50 where id = '55000000-0000-0000-0000-000000000001';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.catalog_sync_claim(5) as cl \gset
select public.catalog_sync_record('20000000-0000-0000-0000-00000000000a', '[
  {"retailer_id": "55000000-0000-0000-0000-000000000001", "hash": "h1", "visible": true},
  {"retailer_id": "55000000-0000-0000-0000-000000000002", "hash": "h2", "visible": true},
  {"retailer_id": "55000000-0000-0000-0000-000000000003", "hash": "h3", "visible": true}]');
select public.catalog_sync_finish('20000000-0000-0000-0000-00000000000a', (:'cl'::jsonb #>> '{items,0,queued_at}')::timestamptz, null);
reset role;
select tests.ok(not exists (select 1 from app_private.catalog_sync_queue), 'a finished sync leaves the queue');

-- Every menu, price, availability or stock change queues the shop again ---------------------------------------------------------
update public.menu_items set available = false where id = '55000000-0000-0000-0000-000000000002';
select tests.ok((select reason = 'menu change' and not force from app_private.catalog_sync_queue
                 where vendor_id = '20000000-0000-0000-0000-00000000000a'), 'an availability change queues the shop');
update public.menu_items set price_usd = 4.25 where id = '55000000-0000-0000-0000-000000000003';
update public.menu_items set price_usd = 4.00 where id = '55000000-0000-0000-0000-000000000003';
select tests.ok((select count(*) = 1 from app_private.catalog_sync_queue), 'repeated changes collapse into one queued row');
-- A failure backs off and is counted.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.catalog_sync_claim(5) as cl2 \gset
select public.catalog_sync_finish('20000000-0000-0000-0000-00000000000a', (:'cl2'::jsonb #>> '{items,0,queued_at}')::timestamptz, 'meta 500');
reset role;
select tests.ok((select next_at > now() + interval '20 seconds' and last_error = 'meta 500' from app_private.catalog_sync_queue),
  'a failed sync is retried later with the error kept');

-- An item that leaves the menu is hidden, never deleted -------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.catalog_sync_record('20000000-0000-0000-0000-00000000000a', '[
  {"retailer_id": "55000000-0000-0000-0000-000000000001", "hash": "h1", "visible": true},
  {"retailer_id": "55000000-0000-0000-0000-000000000002", "hash": "hidden", "visible": false},
  {"retailer_id": "55000000-0000-0000-0000-000000000003", "hash": "h3", "visible": true}]');
select tests.ok(public.catalog_sync_state('20000000-0000-0000-0000-00000000000a') -> '55000000-0000-0000-0000-000000000002' = '{"hash": "hidden", "visible": false}'
  and not public.catalog_synced('20000000-0000-0000-0000-00000000000a') ? '55000000-0000-0000-0000-000000000002',
  'a hidden item stays in the sync state and is not offered');
reset role;
delete from public.menu_items where id = '55000000-0000-0000-0000-000000000002';
select tests.ok(exists (select 1 from public.catalog_sync_items where item_id = '55000000-0000-0000-0000-000000000002'),
  'a deleted item keeps its hidden row, so Meta is never left showing it');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Which catalogue a reply may use -------------------------------------------------------------------------------------------------
select tests.ok(public.catalog_for_number('1378974041965966', '+96170000001') = '987654321012', 'the US number uses its account''s catalogue');
select tests.ok(public.catalog_for_number('597907523413541', '+96170000001') is null, 'a number without a catalogue sends lists');
select tests.ok(public.catalog_for_number('1378974041965966', '+99996170000001') is null, 'a simulated customer gets no catalogue unless a scenario asks');
select tests.ok(public.sim_catalog('+99996170000001', true) ->> 'status' = 'sink_off', 'the simulated catalogue needs the staging sink');
reset role;
insert into public.app_config (key, value, effective_from, note) values ('sim_sink_enabled', 'true', now(), 'test');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.sim_catalog('+99996170000001', true);
select tests.ok(public.catalog_for_number('597907523413541', '+99996170000001') = 'sim', 'a catalogue scenario''s customer gets the simulated catalogue');
select tests.ok(public.sim_catalog('+96170000001', true) ->> 'status' = 'not_a_sim_phone', 'a real number can never be given the simulated catalogue');

-- What a product message may show --------------------------------------------------------------------------------------------
-- Meta approved what was synced (§39.15.2: product messages show only approved items).
select public.catalog_status_record('987654321012', (select jsonb_agg(jsonb_build_object('retailer_id', c.item_id,
  'review_status', 'approved', 'visibility', 'published')) from public.catalog_sync_items c where c.catalog_id = '987654321012'));
select tests.ok((select (r ->> 'total')::int = 2 and jsonb_array_length(r -> 'products') = 2
                 from public.catalog_products('20000000-0000-0000-0000-00000000000a', '987654321012') r),
  'orderable items that are visible in that catalogue, with the shop''s orderable total');
select tests.ok((select jsonb_array_length(r -> 'products') = 0
                 from public.catalog_products('20000000-0000-0000-0000-00000000000a', '111111111111') r),
  'nothing from a catalogue the items were not synced to');
select tests.ok((select (r ->> 'section_total')::int = 2 and r #>> '{products,0,section_en}' = 'Sandwiches'
                 from public.catalog_products('20000000-0000-0000-0000-00000000000a', 'sim', '54000000-0000-0000-0000-000000000001') r),
  'one section, with its section names');
select tests.ok((select r #>> '{products,0,retailer_id}' = '55000000-0000-0000-0000-000000000003'
                 from public.catalog_products('20000000-0000-0000-0000-00000000000a', 'sim', null,
                   array['55000000-0000-0000-0000-000000000003', '55000000-0000-0000-0000-000000000001']::uuid[]) r),
  'given items come back in the order asked (best sellers, search results)');
select tests.ok(cardinality(public.catalog_best_sellers('20000000-0000-0000-0000-00000000000a', 10)) = 2, 'best sellers are orderable items');
select tests.ok(public.catalog_image('55000000-0000-0000-0000-000000000001') ->> 'vendor' = 'Vendor A'
  and public.catalog_image('55000000-0000-0000-0000-000000000004') is null, 'the public image route draws only items in the catalogue');

-- An inbound cart joins the one basket -------------------------------------------------------------------------------------------
-- The customer built a basket with a tap first.
select public.basket_add_item('10000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000001', 1, '{}', null, false, 'tap#1');
select public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.CART', '[
  {"item_id": "55000000-0000-0000-0000-000000000001", "quantity": 2, "shown_usd": 5.00},
  {"item_id": "55000000-0000-0000-0000-000000000003", "quantity": 1, "shown_usd": 4.00},
  {"item_id": "55000000-0000-0000-0000-000000000004", "quantity": 1, "shown_usd": 1.00}]') as cm \gset
select tests.ok(:'cm'::jsonb ->> 'status' = 'ok' and (:'cm'::jsonb ->> 'added')::int = 1, 'the cart is merged');
select tests.ok((select bi.quantity = 3 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                 where b.customer_id = '10000000-0000-0000-0000-000000000001' and b.status = 'open'
                   and bi.item_id = '55000000-0000-0000-0000-000000000001'),
  'cart and taps build one basket (1 tapped + 2 from the cart)');
select tests.ok(:'cm'::jsonb #>> '{diffs,0,item_en}' = 'Shawarma' and (:'cm'::jsonb #>> '{diffs,0,shown_usd}')::numeric = 5.00
  and (:'cm'::jsonb #>> '{diffs,0,now_usd}')::numeric = 5.50, 'a catalogue price that differs from the server''s is reported');
select tests.ok((select (l ->> 'unit_price_usd')::numeric = 5.50 or (l ->> 'line_total_usd')::numeric = 16.50
                 from jsonb_array_elements(:'cm'::jsonb #> '{basket,lines}') l where l ->> 'item_id' = '55000000-0000-0000-0000-000000000001'),
  'the basket is priced by the server, never by the catalogue');
select tests.ok(:'cm'::jsonb #>> '{needs_options,0,item_id}' = '55000000-0000-0000-0000-000000000003'
  and :'cm'::jsonb #>> '{skipped,0,status}' = 'other_branch', 'a line with required choices waits, a line of another shop is skipped');
select public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.CART', '[
  {"item_id": "55000000-0000-0000-0000-000000000001", "quantity": 2, "shown_usd": 5.00}]');
select tests.ok((select bi.quantity = 3 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                 where b.customer_id = '10000000-0000-0000-0000-000000000001' and b.status = 'open'
                   and bi.item_id = '55000000-0000-0000-0000-000000000001'),
  'a replayed turn never adds the same cart twice');
-- A cart of another shop asks first; replacing it is the customer's choice.
reset role;
update public.vendors set orderable = true where id = '20000000-0000-0000-0000-00000000000b';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.CART2',
  '[{"item_id": "55000000-0000-0000-0000-000000000004", "quantity": 1}]') ->> 'status' = 'other_vendor',
  'a cart of another shop does not touch the open basket');
select tests.ok((select (r ->> 'added')::int = 1 and r #>> '{basket,vendor_id}' = '20000000-0000-0000-0000-00000000000b'
                 from public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.TAP', '[{"item_id": "55000000-0000-0000-0000-000000000004", "quantity": 1}]', true) r),
  'after the customer chose it, the cart replaces the basket');
select public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.TAP',
  '[{"item_id": "55000000-0000-0000-0000-000000000004", "quantity": 1}]', true);
select tests.ok((select bi.quantity = 1 from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                 where b.customer_id = '10000000-0000-0000-0000-000000000001' and b.status = 'open'
                   and bi.item_id = '55000000-0000-0000-0000-000000000004'),
  'a replayed replace adds nothing twice');
-- Replacing with a cart whose first line is sold out: the next line still replaces the basket (never the old shop's checkout).
reset role;
insert into public.menu_items (id, vendor_id, name_en, price_usd, available) values
  ('55000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-00000000000a', 'Fries', 2.00, true);
update public.menu_items set available = false where id = '55000000-0000-0000-0000-000000000001';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((select (r ->> 'added')::int = 1 and r #>> '{basket,vendor_id}' = '20000000-0000-0000-0000-00000000000a'
                 from public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.TAP3', '[
                   {"item_id": "55000000-0000-0000-0000-000000000001", "quantity": 1},
                   {"item_id": "55000000-0000-0000-0000-000000000005", "quantity": 1}]', true) r),
  'a sold-out first line does not stop the replace');
select tests.ok(public.cart_merge('10000000-0000-0000-0000-000000000001', 'wamid.X', '[{"item_id": "55000000-0000-0000-0000-0000000000ff", "quantity": 1}]') ->> 'status' = 'unknown_items',
  'a cart of unknown ids changes nothing');

-- A shop with photos can still be deleted while a catalogue is connected (its photos cascade first).
reset role;
insert into public.vendors (id, slug, name_en, business_type, claim_status, orderable, public_page, source, place_id, location)
values ('20000000-0000-0000-0000-0000000000dd', 'vendor-dd', 'Vendor DD', 'cafe', 'claimed', true, false, 'merchant', 'gpDD', 'SRID=4326;POINT(35.58 33.68)');
insert into public.vendor_photos (vendor_id, storage_path, source, status)
values ('20000000-0000-0000-0000-0000000000dd', 'merchant/20000000-0000-0000-0000-0000000000dd/0123456789abcdef.jpg', 'merchant', 'confirmed');
delete from public.vendors where id = '20000000-0000-0000-0000-0000000000dd';
select tests.ok(not exists (select 1 from public.vendors where id = '20000000-0000-0000-0000-0000000000dd')
  and not exists (select 1 from app_private.catalog_sync_queue where vendor_id = '20000000-0000-0000-0000-0000000000dd'),
  'deleting a shop with photos works and queues nothing');

-- The fifth failure in a row raises one ops alert (one per shop per day) and the backoff stays --------------------------------
delete from app_private.catalog_sync_queue;
select app_private.catalog_enqueue('20000000-0000-0000-0000-00000000000a', 'test');
do $$
declare
  c jsonb;
begin
  for i in 1..6 loop
    update app_private.catalog_sync_queue set next_at = now(), leased_until = null;
    c := public.catalog_sync_claim(1);
    perform public.catalog_sync_finish('20000000-0000-0000-0000-00000000000a', (c #>> '{items,0,queued_at}')::timestamptz, 'meta 500');
  end loop;
end;
$$;
select tests.ok((select count(*) = 1 from public.ops_alerts where kind = 'catalog_sync_failed'
                   and vendor_id = '20000000-0000-0000-0000-00000000000a' and summary like 'Catalogue sync failed 5 times%'),
  'the fifth failure in a row raises one catalogue alert');
select tests.ok((select attempts = 6 and last_error = 'meta 500' and next_at > now() + interval '20 minutes'
                 from app_private.catalog_sync_queue where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'the failures keep backing off after the alert');
-- A hard failure keeps its backoff when the shop changes; a missing product set does not hold the shop's updates.
select app_private.catalog_enqueue('20000000-0000-0000-0000-00000000000a', 'test');
select tests.ok((select next_at > now() from app_private.catalog_sync_queue where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'a change to a shop in backoff after a failure waits');
update app_private.catalog_sync_queue set last_error = 'catalogue product set not created', next_at = now() + interval '1 hour';
select app_private.catalog_enqueue('20000000-0000-0000-0000-00000000000a', 'test');
select tests.ok((select next_at <= now() from app_private.catalog_sync_queue where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'a change to a shop missing only its product set runs at once');

reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws('select public.cart_merge(''10000000-0000-0000-0000-000000000001'', ''x'', ''[]'')', 'permission denied',
  'clients cannot merge carts directly');
select tests.throws('select public.catalog_sync_claim(1)', 'permission denied', 'clients cannot take sync work');

rollback;
