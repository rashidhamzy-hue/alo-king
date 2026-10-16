-- Session 5f hotfix (DECISIONS §39.15.2): the WhatsApp catalogue reports an empty review_status for every product
-- (16 October). An empty status reads as Meta's answer through visibility, availability and errors.
begin;

select set_config('app.fixture_owner_phone', '+96170000163', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
insert into public.whatsapp_catalogs (waba_id, catalog_id, transport, commerce_on) values ('1086076707590004', '1684040949970004', 'graph', true);
select array_agg(i.id order by i.sort_order, i.id) as items from public.menu_items i where i.vendor_id = :'tv' \gset
insert into public.catalog_sync_items (item_id, vendor_id, content_hash, visible, catalog_id)
select x, :'tv', 'h', true, '1684040949970004' from unnest(:'items'::uuid[]) x;

-- What Meta returned on 16 October, one product of each kind.
select public.catalog_status_record('1684040949970004', jsonb_build_array(
  jsonb_build_object('retailer_id', (:'items'::uuid[])[1], 'review_status', '', 'visibility', 'published',
    'availability', 'in stock', 'errors', '[]'::jsonb),
  jsonb_build_object('retailer_id', (:'items'::uuid[])[2], 'review_status', '', 'visibility', 'published',
    'availability', 'in stock', 'errors', jsonb_build_array(jsonb_build_object('title', 'Policy violations',
      'description', 'The item was rejected because it doesn''t comply with our Advertising Policies.'))),
  jsonb_build_object('retailer_id', (:'items'::uuid[])[3], 'review_status', '', 'visibility', 'staging',
    'availability', 'out of stock', 'errors', jsonb_build_array(jsonb_build_object('title', 'Archived',
      'description', 'You''ve archived this item and it won''t appear anywhere.'))),
  jsonb_build_object('retailer_id', (:'items'::uuid[])[4], 'review_status', 'pending', 'visibility', 'published',
    'availability', 'in stock')));

select tests.ok((select meta_status = 'approved' from public.catalog_item_status where item_id = (:'items'::uuid[])[1]),
  'published, in stock, nothing refused: approved');
select tests.ok((select meta_status = 'rejected' from public.catalog_item_status where item_id = (:'items'::uuid[])[2]),
  'a policy refusal is a rejection, whatever the empty status says');
select tests.ok((select meta_status = '' from public.catalog_item_status where item_id = (:'items'::uuid[])[3]),
  'hidden at Meta: still unsure (it is not shown either way)');
select tests.ok((select meta_status = 'pending' from public.catalog_item_status where item_id = (:'items'::uuid[])[4]),
  'a status Meta does report is kept as it is');
select tests.ok(app_private.catalog_item_shown((:'items'::uuid[])[1], '1684040949970004')
  and not app_private.catalog_item_shown((:'items'::uuid[])[2], '1684040949970004')
  and not app_private.catalog_item_shown((:'items'::uuid[])[4], '1684040949970004'),
  'product messages show the published product, never the refused or pending one');
select tests.ok((public.catalog_shop_menu(:'tv', '1684040949970004') ->> 'shown')::int = 1, 'the shop shows its one approved item');

-- Rows recorded before this fix are read the same way.
update public.catalog_item_status set meta_status = '' where item_id = (:'items'::uuid[])[1];
update public.catalog_item_status
set meta_status = app_private.catalog_meta_status(meta_status, visibility, availability, errors)
where meta_status = '';
select tests.ok((select meta_status = 'approved' from public.catalog_item_status where item_id = (:'items'::uuid[])[1]),
  'an empty status already stored is read as approved too');

rollback;
