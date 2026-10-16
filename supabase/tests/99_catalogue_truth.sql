-- Session 5f (DECISIONS §39.15.2): Meta's review status is the truth. Product messages and their counts use only items Meta
-- approved and shows; every count equals what opens (a section's shown items as a product message, the rest as a list);
-- the status sweep is paced; the per-shop report adds up.
begin;

select set_config('app.fixture_owner_phone', '+96170000161', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
insert into public.whatsapp_catalogs (waba_id, catalog_id, transport, commerce_on) values ('1086076707590001', '1684040949970001', 'graph', true);
-- Four items of one section in the catalogue: the grill's sandwiches.
select s.id as sec from public.menu_sections s where s.vendor_id = :'tv' and s.name_en = 'Sandwiches' \gset
select array_agg(i.id order by i.sort_order, i.id) as items from public.menu_items i where i.section_id = :'sec' \gset
select cardinality(:'items'::uuid[]) as n_items \gset
insert into public.catalog_sync_items (item_id, vendor_id, content_hash, visible, catalog_id)
select x, :'tv', 'h', true, '1684040949970001' from unnest(:'items'::uuid[]) x;

-- Synced but not reviewed: nothing is shown -------------------------------------------------------------------------
select public.catalog_shop_menu(:'tv', '1684040949970001') as m0 \gset
select tests.ok((:'m0'::jsonb ->> 'shown')::int = 0 and (:'m0'::jsonb ->> 'total')::int > 0,
  '"batch accepted" is not "shown": with no review status the shop shows nothing in product messages');
select tests.ok((select (s ->> 'total')::int = :n_items and jsonb_array_length(s -> 'products') = 0
  from jsonb_array_elements(:'m0'::jsonb -> 'sections') s where s ->> 'section_id' = :'sec'),
  'the section still counts all its items, and opens them as a list');

-- Meta approves one, rejects one, one is pending ------------------------------------------------------------------------
select public.catalog_status_record('1684040949970001', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[1], 'review_status', 'approved', 'visibility', 'published', 'availability', 'in stock', 'errors', '[]'::jsonb),
  jsonb_build_object('retailer_id', (:'items'::uuid[])[2], 'review_status', 'rejected', 'visibility', 'published',
    'errors', jsonb_build_object('data', jsonb_build_array(jsonb_build_object('title', 'Image has text overlay', 'priority', 'HIGH')))),
  jsonb_build_object('retailer_id', (:'items'::uuid[])[3], 'review_status', 'pending'),
  jsonb_build_object('retailer_id', 'not-ours', 'review_status', 'approved'))) as recorded \gset
select tests.ok(:recorded = 3, 'statuses are recorded for our items only');
select tests.ok((select errors -> 0 ->> 'title' from public.catalog_item_status where item_id = (:'items'::uuid[])[2]) = 'Image has text overlay',
  'Meta''s errors are kept, from either {data: [...]} or a plain list');
select public.catalog_shop_menu(:'tv', '1684040949970001') as m1 \gset
select tests.ok((:'m1'::jsonb ->> 'shown')::int = 1, 'one item is shown: the approved one');
select tests.ok((select (s ->> 'total')::int = :n_items and (s ->> 'shown')::int = 1 and jsonb_array_length(s -> 'products') = 1
    and s -> 'products' -> 0 ->> 'retailer_id' = (:'items'::uuid[])[1]::text
  from jsonb_array_elements(:'m1'::jsonb -> 'sections') s where s ->> 'section_id' = :'sec'),
  'the section''s product message holds the approved item; its count is every item');
select tests.ok((select count(*) from public.catalog_section_rest(:'tv', '1684040949970001', :'sec')) = :n_items - 1
  and (select bool_and(item_id <> (:'items'::uuid[])[1]) from public.catalog_section_rest(:'tv', '1684040949970001', :'sec')),
  'the rest of the section comes as a list: nothing is unreachable, and shown + rest = the count');
select tests.ok((select total_count from public.catalog_section_rest(:'tv', '1684040949970001', :'sec') limit 1) = :n_items - 1,
  'the rest list carries its own total');
select tests.ok(jsonb_array_length(public.catalog_products_for(:'items'::uuid[], '1684040949970001')) = 1,
  'search product messages hold only shown items');
select tests.ok(jsonb_array_length(public.catalog_products(:'tv', '1684040949970001', :'sec') -> 'products') = 1
  and (public.catalog_products(:'tv', '1684040949970001', :'sec') ->> 'section_total')::int = :n_items, 'so do section pages, with the full count');
select tests.ok(jsonb_array_length(public.catalog_products_for(:'items'::uuid[], 'sim') ) = :n_items,
  'the simulator''s catalogue has no Meta behind it: every item counts there, as before');

-- Hidden or out of stock at Meta: not shown ------------------------------------------------------------------------------
select public.catalog_status_record('1684040949970001', jsonb_build_array(jsonb_build_object('retailer_id', (:'items'::uuid[])[1],
  'review_status', 'approved', 'visibility', 'staging')));
select tests.ok((public.catalog_shop_menu(:'tv', '1684040949970001') ->> 'shown')::int = 0, 'an approved item Meta does not publish is not shown');
select public.catalog_status_record('1684040949970001', jsonb_build_array(jsonb_build_object('retailer_id', (:'items'::uuid[])[1],
  'review_status', 'approved', 'visibility', 'published')));
update public.catalog_sync_items set visible = false where item_id = (:'items'::uuid[])[1];
select tests.ok((public.catalog_shop_menu(:'tv', '1684040949970001') ->> 'shown')::int = 0, 'an item we hid is not shown, whatever Meta said');
update public.catalog_sync_items set visible = true where item_id = (:'items'::uuid[])[1];

-- The sweep: paced by next_due_at, one page at a time, backoff on failure, 'missing' for what Meta does not list -------
select public.catalog_status_sweep_next('1684040949970001') as s1 \gset
select tests.ok((:'s1'::jsonb ->> 'due')::boolean and :'s1'::jsonb -> 'after' = 'null'::jsonb and :'s1'::jsonb ->> 'transport' = 'graph',
  'a first sweep starts from the first page, on the catalogue the sync writes to');
select tests.ok(not (public.catalog_status_sweep_next('1684040949970001') ->> 'due')::boolean, 'a page in flight is not asked for twice');
select tests.ok(public.catalog_status_sweep_done('1684040949970001', 'cursor-2') ->> 'status' = 'next_page', 'a page with more after it');
select tests.ok((select next_due_at between now() + interval '14 seconds' and now() + interval '16 seconds'
  from app_private.catalog_status_sweeps), 'the next page is due 15 s later');
update app_private.catalog_status_sweeps set next_due_at = now() - interval '1 second';
select tests.ok(public.catalog_status_sweep_next('1684040949970001') ->> 'after' = 'cursor-2', 'the next page follows the cursor');
-- Failures back off 2, 4 minutes; the third restarts from the first page and tells the operators.
select tests.ok(public.catalog_status_sweep_done('1684040949970001', null, true) ->> 'status' = 'backoff', 'a failed page backs off');
select tests.ok((select next_due_at between now() + interval '119 seconds' and now() + interval '121 seconds' and after_cursor = 'cursor-2'
  from app_private.catalog_status_sweeps), 'and is asked again after 2 minutes, from the same cursor');
select public.catalog_status_sweep_done('1684040949970001', null, true);
select tests.ok(public.catalog_status_sweep_done('1684040949970001', null, true) ->> 'status' = 'restart', 'three failures: a restart');
select tests.ok((select after_cursor is null and failures = 0 from app_private.catalog_status_sweeps)
  and exists (select 1 from public.ops_alerts where kind = 'catalog_sync_failed' and summary like 'Meta catalogue status%'),
  'from the first page in 30 minutes, and the operators are told');
-- A finished sweep: an item synced long before that Meta did not list is missing, and its shop is re-sent once.
update app_private.catalog_status_sweeps set next_due_at = now() - interval '1 second';
select public.catalog_status_sweep_next('1684040949970001');
update public.catalog_sync_items set synced_at = now() - interval '1 hour' where vendor_id = :'tv';
update public.catalog_item_status set checked_at = now() - interval '2 hours' where item_id = (:'items'::uuid[])[3];
delete from app_private.catalog_sync_queue where vendor_id = :'tv';
select public.catalog_status_sweep_done('1684040949970001', null) as fin \gset
select tests.ok(:'fin'::jsonb ->> 'status' = 'finished'
  and (select review_status = 'missing' from public.catalog_item_status where item_id = (:'items'::uuid[])[3]),
  'a product Meta did not list in a whole sweep is missing (not unsure: no sweep every 15 minutes for it)');
select tests.ok((select force from app_private.catalog_sync_queue where vendor_id = :'tv'), 'and its shop is re-sent once');
delete from app_private.catalog_sync_queue where vendor_id = :'tv';
update app_private.catalog_status_sweeps set next_due_at = now() - interval '1 second', started_at = now() - interval '1 minute';
select public.catalog_status_sweep_next('1684040949970001');
update app_private.catalog_status_sweeps set started_at = now() - interval '1 minute';
select public.catalog_status_sweep_done('1684040949970001', null);
select tests.ok(not exists (select 1 from app_private.catalog_sync_queue where vendor_id = :'tv'),
  'still missing at the next sweep: not re-sent again (the nightly full sync sends it)');
-- Pacing: nothing unsure waits for the nightly read; a sync brings it forward.
update public.catalog_item_status set review_status = 'approved', visibility = 'published', availability = 'in stock',
  checked_at = now() where vendor_id = :'tv';
update app_private.catalog_status_sweeps set next_due_at = now() - interval '1 second';
select public.catalog_status_sweep_next('1684040949970001');
select public.catalog_status_sweep_done('1684040949970001', null);
select tests.ok((select next_due_at > now() + interval '19 hours' from app_private.catalog_status_sweeps),
  'everything reviewed: the next sweep is the nightly one');
update public.catalog_sync_items set content_hash = 'h2' where item_id = (:'items'::uuid[])[1];
select tests.ok((select next_due_at <= now() + interval '15 minutes' from app_private.catalog_status_sweeps),
  'a product sent again brings the next sweep within 15 minutes');
select tests.ok((select next_due_at > now() from app_private.catalog_status_sweeps), 'a sweep not due costs one row read');
-- dispatch_kick and the sweep agree on the catalogue: an older catalogue's due row never wakes dispatch, nor does any
-- sweep while the catalogue is off.
insert into public.whatsapp_catalogs (waba_id, catalog_id, transport, commerce_on, checked_at)
values ('1086076707590003', '1684040949970003', 'graph', true, now() - interval '1 day');
insert into app_private.catalog_status_sweeps (catalog_id, next_due_at) values ('1684040949970003', now() - interval '1 hour');
select tests.ok(app_private.catalog_sweep_target() = '1684040949970001', 'the sweep reads the newest catalogue with a transport');
select tests.ok(not (public.catalog_status_sweep_next() ->> 'due')::boolean, 'the newest catalogue is not due yet');
select tests.ok((select next_due_at < now() from app_private.catalog_status_sweeps where catalog_id = '1684040949970003'),
  'an older catalogue''s due row is not served (and so does not wake dispatch)');
savepoint catalogue_off;
insert into public.app_config (key, value, effective_from, note) values ('catalog_enabled', 'false', now(), 'test');
select tests.ok(app_private.catalog_sweep_target() is null, 'catalogue off: nothing to sweep');
select tests.ok(not (public.catalog_status_sweep_next() ->> 'due')::boolean, 'catalogue off: no page is due');
rollback to savepoint catalogue_off;
delete from app_private.catalog_status_sweeps where catalog_id = '1684040949970003';
delete from public.whatsapp_catalogs where catalog_id = '1684040949970003';
-- A status read from another catalogue does not count here.
update public.catalog_item_status set catalog_id = '1684040949970002' where item_id = (:'items'::uuid[])[1];
select tests.ok(not app_private.catalog_item_shown((:'items'::uuid[])[1], '1684040949970001'),
  'approval in another catalogue is not approval in this one');
update public.catalog_item_status set catalog_id = '1684040949970001' where item_id = (:'items'::uuid[])[1];
select tests.ok(public.catalog_status_record('1684040949970001', jsonb_build_array(jsonb_build_object('retailer_id', (:'items'::uuid[])[1],
  'review_status', 'APPROVED-NOW?', 'visibility', 'Published'))) = 1, 'a value never seen before is recorded');
select tests.ok((select review_status = 'approved_now_' and visibility = 'published' from public.catalog_item_status
  where item_id = (:'items'::uuid[])[1]), 'cleaned to the table''s shape, so it never breaks a page');
select public.catalog_status_record('1684040949970001', (select jsonb_agg(jsonb_build_object('retailer_id', x, 'review_status', 'approved',
  'visibility', 'published')) from unnest(:'items'::uuid[]) x));

-- Search's shop count is the menu's: an approved item the shop can't make today does not count towards a full shop.
select (public.catalog_products_for(:'items'::uuid[], '1684040949970001') -> 0 ->> 'shop_shown')::int as ss0 \gset
update public.menu_items set available = false where id = (:'items'::uuid[])[2];
select tests.ok((public.catalog_products_for(:'items'::uuid[], '1684040949970001') -> 0 ->> 'shop_shown')::int = :ss0 - 1,
  'search''s shop count leaves out an item that cannot be ordered, as the menu''s does');
update public.menu_items set available = true where id = (:'items'::uuid[])[2];

update public.vendors set is_test = false where id = :'tv';
-- The report -------------------------------------------------------------------------------------------------------------
select tests.ok((select synced = :n_items and approved = :n_items and rejected = 0 and pending = 0
  from public.catalog_status_report('1684040949970001') where vendor_id = :'tv'), 'the per-shop report adds up');

-- Access -----------------------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select * from public.catalog_item_status$$, 'permission denied', 'clients cannot read Meta''s review status');
select tests.throws($$select public.catalog_status_record('x', '[]')$$, 'permission denied', 'or write it');
reset role;

rollback;
