-- Session 5f part 8b (CUSTOMER-EXPERIENCE §3.5 #28-29, §3.7 #41 and #45, §3.8 #49-50): a second shop's item, the minimum
-- order's gap items, the same dish at the closest shops after a rejection, notes to the shop during an order, and problems
-- after delivery decided by the server with a discount line on the next order recorded in the ledger.
begin;

-- Fixtures: one delivered-to place, six shops around it, a dish library with two dishes ---------------------------------
insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-CXP', 'CHF', 'CX test zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source, service_status) values
  ('LB-CHF-CXTOWN', 'TZ-CXP', 'ضيعة', 'Cx Town', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5700 33.6800)', 'test', 'on');
-- A new place loads off (§16); this one is in the delivery area.
update public.places set service_status = 'on' where id = 'LB-CHF-CXTOWN';
insert into public.dish_library (id, name_ar, name_en, name_fr, category, unit, portion_g, recipe) values
  ('cx_shawarma', 'شاورما', 'Shawarma', 'Shawarma', 'sandwich', 'piece', '{"M": 250}', '{}'),
  ('cx_fries', 'بطاطا', 'Fries', 'Frites', 'side', 'portion', '{"M": 150}', '{}');

insert into public.vendors (id, slug, name_en, name_ar, business_type, cuisine_tags, claim_status, public_page, orderable, source,
  place_id, location, delivery_radius_km, paused_until) values
  ('8b000000-0000-0000-0000-0000000000a1', 'cx-a', 'Cx Eatout', 'إيت أوت', 'fast_food', '{}', 'claimed', true, true, 'merchant',
   'gp8bA', 'SRID=4326;POINT(35.5650 33.6780)', 10, null),
  ('8b000000-0000-0000-0000-0000000000b1', 'cx-b', 'Cx Seven', 'سفن', 'fast_food', '{}', 'claimed', true, true, 'merchant',
   'gp8bB', 'SRID=4326;POINT(35.5750 33.6820)', 10, null),
  ('8b000000-0000-0000-0000-0000000000c1', 'cx-c', 'Cx Corner', null, 'fast_food', '{}', 'claimed', true, true, 'merchant',
   'gp8bC', 'SRID=4326;POINT(35.5720 33.6790)', 10, null),
  ('8b000000-0000-0000-0000-0000000000d1', 'cx-d', 'Cx Paused', null, 'fast_food', '{}', 'claimed', true, true, 'merchant',
   'gp8bD', 'SRID=4326;POINT(35.5710 33.6810)', 10, now() + interval '1 hour'),
  ('8b000000-0000-0000-0000-0000000000e1', 'cx-e', 'Cx Far Away', null, 'fast_food', '{}', 'claimed', true, true, 'merchant',
   'gp8bE', 'SRID=4326;POINT(36.2000 34.3000)', 10, null),
  ('8b000000-0000-0000-0000-0000000000f1', 'cx-f', 'Cx No Road', null, 'fast_food', '{}', 'claimed', true, true, 'merchant',
   'gp8bF', 'SRID=4326;POINT(35.5690 33.6790)', 10, null);
insert into public.vendor_private (vendor_id, kitchen_whatsapp) values ('8b000000-0000-0000-0000-0000000000a1', '+96170000399');

insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd, sort_order, available) values
  ('8b000000-0000-0000-0000-00000000a001', '8b000000-0000-0000-0000-0000000000a1', 'Chicken Shawarma', 'شاورما دجاج', 8.00, 1, true),
  ('8b000000-0000-0000-0000-00000000a002', '8b000000-0000-0000-0000-0000000000a1', 'Fries', 'بطاطا', 3.00, 2, true),
  ('8b000000-0000-0000-0000-00000000a003', '8b000000-0000-0000-0000-0000000000a1', 'Knefe', 'كنافة', 4.00, 3, true),
  ('8b000000-0000-0000-0000-00000000a004', '8b000000-0000-0000-0000-0000000000a1', 'Burger', null, 7.50, 4, true),
  ('8b000000-0000-0000-0000-00000000a005', '8b000000-0000-0000-0000-0000000000a1', 'Mixed Platter', null, 12.00, 5, true),
  ('8b000000-0000-0000-0000-00000000a006', '8b000000-0000-0000-0000-0000000000a1', 'Pepsi', null, 1.00, 6, true),
  ('8b000000-0000-0000-0000-00000000a007', '8b000000-0000-0000-0000-0000000000a1', 'Sold Out Wrap', null, 7.25, 7, false),
  ('8b000000-0000-0000-0000-00000000a008', '8b000000-0000-0000-0000-0000000000a1', 'Meal With A Choice', null, 7.10, 8, true),
  ('8b000000-0000-0000-0000-00000000b001', '8b000000-0000-0000-0000-0000000000b1', 'Shawarma Sandwich', null, 6.00, 1, true),
  ('8b000000-0000-0000-0000-00000000b002', '8b000000-0000-0000-0000-0000000000b1', 'Shawarma Plate', null, 11.00, 2, true),
  ('8b000000-0000-0000-0000-00000000b003', '8b000000-0000-0000-0000-0000000000b1', 'Seven Fries', null, 2.50, 3, true),
  ('8b000000-0000-0000-0000-00000000c001', '8b000000-0000-0000-0000-0000000000c1', 'Corner Shawarma', null, 7.00, 1, true),
  ('8b000000-0000-0000-0000-00000000d001', '8b000000-0000-0000-0000-0000000000d1', 'Paused Shawarma', null, 7.00, 1, true),
  ('8b000000-0000-0000-0000-00000000e001', '8b000000-0000-0000-0000-0000000000e1', 'Far Shawarma', null, 7.00, 1, true),
  ('8b000000-0000-0000-0000-00000000f001', '8b000000-0000-0000-0000-0000000000f1', 'Roadless Shawarma', null, 7.00, 1, true);
insert into public.menu_option_groups (id, item_id, name_en, min_select, max_select) values
  ('8b000000-0000-0000-0000-0000000a0801', '8b000000-0000-0000-0000-00000000a008', 'Side', 1, 1);
insert into public.menu_options (group_id, name_en, price_delta_usd) values ('8b000000-0000-0000-0000-0000000a0801', 'Salad', 0);
insert into public.menu_item_nutrition (item_id, vendor_id, dish_id) values
  ('8b000000-0000-0000-0000-00000000a001', '8b000000-0000-0000-0000-0000000000a1', 'cx_shawarma'),
  ('8b000000-0000-0000-0000-00000000a002', '8b000000-0000-0000-0000-0000000000a1', 'cx_fries'),
  ('8b000000-0000-0000-0000-00000000b001', '8b000000-0000-0000-0000-0000000000b1', 'cx_shawarma'),
  ('8b000000-0000-0000-0000-00000000b002', '8b000000-0000-0000-0000-0000000000b1', 'cx_shawarma'),
  ('8b000000-0000-0000-0000-00000000b003', '8b000000-0000-0000-0000-0000000000b1', 'cx_fries'),
  ('8b000000-0000-0000-0000-00000000c001', '8b000000-0000-0000-0000-0000000000c1', 'cx_shawarma'),
  ('8b000000-0000-0000-0000-00000000d001', '8b000000-0000-0000-0000-0000000000d1', 'cx_shawarma'),
  ('8b000000-0000-0000-0000-00000000e001', '8b000000-0000-0000-0000-0000000000e1', 'cx_shawarma'),
  ('8b000000-0000-0000-0000-00000000f001', '8b000000-0000-0000-0000-0000000000f1', 'cx_shawarma');

-- Recorded shop → place road distances (the route-matrix workflow's table): every shop but the one with no road.
select public.shop_place_routes_save(jsonb_build_array(
  jsonb_build_object('vendor_id', '8b000000-0000-0000-0000-0000000000a1', 'place_id', 'LB-CHF-CXTOWN', 'road_km', 2.0, 'minutes', 5,
    'origin_lat', 33.6780, 'origin_lon', 35.5650, 'dest_lat', 33.6800, 'dest_lon', 35.5700),
  jsonb_build_object('vendor_id', '8b000000-0000-0000-0000-0000000000b1', 'place_id', 'LB-CHF-CXTOWN', 'road_km', 3.0, 'minutes', 7,
    'origin_lat', 33.6820, 'origin_lon', 35.5750, 'dest_lat', 33.6800, 'dest_lon', 35.5700),
  jsonb_build_object('vendor_id', '8b000000-0000-0000-0000-0000000000c1', 'place_id', 'LB-CHF-CXTOWN', 'road_km', 1.5, 'minutes', 4,
    'origin_lat', 33.6790, 'origin_lon', 35.5720, 'dest_lat', 33.6800, 'dest_lon', 35.5700),
  jsonb_build_object('vendor_id', '8b000000-0000-0000-0000-0000000000d1', 'place_id', 'LB-CHF-CXTOWN', 'road_km', 1.0, 'minutes', 3,
    'origin_lat', 33.6810, 'origin_lon', 35.5710, 'dest_lat', 33.6800, 'dest_lon', 35.5700),
  jsonb_build_object('vendor_id', '8b000000-0000-0000-0000-0000000000e1', 'place_id', 'LB-CHF-CXTOWN', 'road_km', 1.0, 'minutes', 3,
    'origin_lat', 34.3000, 'origin_lon', 36.2000, 'dest_lat', 33.6800, 'dest_lon', 35.5700)));

-- The customer, their pin in the town, and an order helper (basket → quote → Confirm) ----------------------------------------
select public.customer_turn_begin('+96170000801', 'wamid.cx.1', 'text', 'CX tester') as t1 \gset
select (:'t1'::jsonb #>> '{customer,id}') as cid \gset
select public.address_save_pin(:'cid', 33.6801, 35.5701, 'Home') as pin \gset
select (:'pin'::jsonb #>> '{address,address_id}') as aid \gset
select public.address_set_for_whom(:'cid', :'aid', 'self', true);

create function tests.cx_place(p_customer uuid, p_items uuid[], p_key text, p_pickup boolean default false) returns uuid
language plpgsql as $$
declare
  v_item uuid;
  v_q jsonb;
  v_b record;
  v_r jsonb;
begin
  foreach v_item in array p_items loop
    perform public.basket_add_item(p_customer, v_item, 1, '{}', null, true);
  end loop;
  if p_pickup then
    perform public.basket_set_checkout(p_customer, 'pickup'::public.fulfilment_kind);
  end if;
  v_q := public.basket_quote(p_customer);
  if v_q ->> 'status' <> 'ok' then
    raise exception 'quote: %', v_q ->> 'status';
  end if;
  select b.id, b.priced_menu_version into v_b from public.baskets b where b.customer_id = p_customer and b.status = 'open';
  v_r := public.order_place(v_b.id, v_b.priced_menu_version, p_key);
  if v_r ->> 'status' <> 'placed' then
    raise exception 'order_place: %', v_r ->> 'status';
  end if;
  return (v_r ->> 'order_id')::uuid;
end;
$$;
-- Accepted, ready, out and delivered, as the shop and the driver would.
create function tests.cx_deliver(p_order uuid) returns void
language plpgsql as $$
begin
  update public.orders set status = 'accepted' where id = p_order;
  update public.orders set status = 'ready' where id = p_order;
  update public.orders set status = 'picked_up' where id = p_order;
  update public.orders set delivery_code_confirmed_at = now() where id = p_order;
  update public.orders set status = 'delivered' where id = p_order;
end;
$$;

-- #28 A second shop's item: both names for the question ----------------------------------------------------------------------
select public.basket_add_item(:'cid', '8b000000-0000-0000-0000-00000000a001', 1, '{}', null, true);
select public.basket_switch_names(:'cid', '8b000000-0000-0000-0000-00000000b003') as sw \gset
select tests.ok(:'sw'::jsonb ->> 'basket_vendor_en' = 'Cx Eatout' and :'sw'::jsonb ->> 'item_vendor_en' = 'Cx Seven'
  and :'sw'::jsonb ->> 'basket_vendor' = 'إيت أوت', '#28: "Your basket is from Cx Eatout. Start a new one from Cx Seven?" in both scripts');
select tests.ok(public.basket_add_item(:'cid', '8b000000-0000-0000-0000-00000000b003', 1) ->> 'status' = 'other_vendor',
  '#28: one shop per order: the item from the second shop is not added without the customer''s Start new');

-- #29 Under the minimum order: up to 3 of the shop's items that close the gap -----------------------------------------------
select tests.ok(public.basket_gap_items(:'cid') ->> 'status' = 'not_below', '#29: no minimum, nothing to close');
insert into public.vendor_ops (vendor_id, min_order_usd) values ('8b000000-0000-0000-0000-0000000000a1', 15);
select public.basket_gap_items(:'cid') as g1 \gset
select tests.ok(:'g1'::jsonb ->> 'status' = 'below_minimum' and (:'g1'::jsonb ->> 'missing_usd')::numeric = 7.00
  and (:'g1'::jsonb ->> 'min_order_usd')::numeric = 15 and :'g1'::jsonb ->> 'vendor_en' = 'Cx Eatout',
  '#29: $8 of food against a $15 minimum: add $7.00 more to order from Cx Eatout');
select tests.ok((select array_agg(x ->> 'item_id' order by n) from jsonb_array_elements(:'g1'::jsonb -> 'items') with ordinality t(x, n))
  = array['8b000000-0000-0000-0000-00000000a008', '8b000000-0000-0000-0000-00000000a004', '8b000000-0000-0000-0000-00000000a001'],
  '#29: the items priced at or above the gap, the closest first ($7.10, $7.50, $8.00); never the sold-out $7.25');
select tests.ok((select bool_and((x ->> 'closes_gap')::boolean) and sum((x ->> 'price_usd')::numeric) = 22.60
  from jsonb_array_elements(:'g1'::jsonb -> 'items') x), '#29: each closes the gap, at the server''s prices');
select tests.ok((:'g1'::jsonb -> 'items' -> 0 ->> 'needs_choice')::boolean, '#29: an item with a required choice says so (the tap asks it)');
update public.vendor_ops set min_order_usd = 40 where vendor_id = '8b000000-0000-0000-0000-0000000000a1';
select public.basket_gap_items(:'cid', 10) as g2 \gset
select tests.ok(jsonb_array_length(:'g2'::jsonb -> 'items') = 3, '#29: never more than three, whatever is asked');
select tests.ok((select bool_and(not (x ->> 'closes_gap')::boolean and not (x ->> 'needs_choice')::boolean
  and x ->> 'item_id' <> '8b000000-0000-0000-0000-00000000a001') from jsonb_array_elements(:'g2'::jsonb -> 'items') x),
  '#29: a gap nothing closes: the shop''s best sellers not in the basket, without a choice to make');
update public.vendor_ops set min_order_usd = null where vendor_id = '8b000000-0000-0000-0000-0000000000a1';

-- #45 A message to the shop during an active order ---------------------------------------------------------------------------
select tests.ok(public.order_note_send(:'cid', 'no onions please', 'wamid.n0') ->> 'status' = 'no_order',
  '#45: without an active order nothing is passed to anyone');
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a002'::uuid, '8b000000-0000-0000-0000-00000000a003'::uuid],
  'test:cx:o1') as o1 \gset
-- The shop's 24-hour window is closed (its order card went as a template): a free-form note cannot reach it.
select public.order_note_send(:'cid', 'ring twice', 'wamid.n0b') as n0b \gset
select tests.ok(:'n0b'::jsonb ->> 'status' = 'no_channel'
  and exists (select 1 from public.ops_alerts where dedupe_key = 'note:' || (:'n0b'::jsonb ->> 'note_id') and summary ~ 'window is closed')
  and not exists (select 1 from public.outbound_messages where dedupe_key = 'note:' || (:'n0b'::jsonb ->> 'note_id')),
  '#45: outside the shop''s window the note is kept and a person passes it on; never "passed" when it was not');
insert into app_private.whatsapp_windows (phone_e164, phone_number_id, last_inbound_at)
select '+96170000399', w.phone_number_id, now() from public.whatsapp_numbers w where w.active
on conflict (phone_e164, phone_number_id) do update set last_inbound_at = excluded.last_inbound_at;
select tests.ok(public.order_note_send(:'cid', 'ring twice', 'wamid.n0c', '8b000000-0000-0000-0000-0000000000ff') ->> 'status' = 'no_order',
  '#45: the order the card named must be the customer''s own active order');
select public.order_note_send(:'cid', '  no onions   please ', 'wamid.n1', :'o1') as n1 \gset
select tests.ok(:'n1'::jsonb ->> 'status' = 'sent' and :'n1'::jsonb ->> 'vendor_en' = 'Cx Eatout' and (:'n1'::jsonb ->> 'left')::int = 3,
  '#45: the note goes with the active order the card named; 3 more allowed (order_note_max_per_order 5)');
select tests.ok((select m.target = '+96170000399' and m.purpose = 'customer_note' and m.payload ->> 'text' = 'no onions please'
  and m.payload ->> 'code' = (select code from public.orders where id = :'o1')
  and m.payload::text !~ '96170000801' from public.outbound_messages m where m.dedupe_key = 'note:' || (:'n1'::jsonb ->> 'note_id')),
  '#45: to the shop''s WhatsApp order number, with the order code, never the customer''s number');
select tests.ok(not (:'n1'::jsonb)::text ~ '96170000399', '#45: the customer never gets the shop''s number');
select tests.ok(public.order_note_send(:'cid', 'no onions please', 'wamid.n1') ->> 'repeat' = 'true'
  and (select count(*) from public.order_customer_notes where order_id = :'o1' and source_message_id = 'wamid.n1') = 1,
  '#45: a replayed message is passed once');
select public.order_note_send(:'cid', 'note ' || n, 'wamid.n' || (n + 1)) from generate_series(1, 3) n;
select tests.ok(public.order_note_send(:'cid', 'one too many', 'wamid.n9') ->> 'status' = 'limit'
  and (select count(*) from public.order_customer_notes where order_id = :'o1') = 5, '#45: rate-limited per order (config)');
select tests.ok(public.order_note_send(:'cid', '   ', 'wamid.n10') ->> 'status' = 'invalid', '#45: an empty note is not sent');

-- #41 The shop rejects: the closest shops with the same dish, the basket rebuilt there ------------------------------------
reset role;
-- The order itself: shawarma, fries and a knefe no other shop has.
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a001'::uuid, '8b000000-0000-0000-0000-00000000a002'::uuid,
  '8b000000-0000-0000-0000-00000000a003'::uuid], 'test:cx:o1b') as o1b \gset
update public.orders set status = 'rejected', reject_reason = 'busy' where id = :'o1b';
select app_private.order_same_dish_shops(:'o1b') as same \gset
select tests.ok((select array_agg(x ->> 'vendor_id' order by n) from jsonb_array_elements(:'same'::jsonb) with ordinality t(x, n))
  = array['8b000000-0000-0000-0000-0000000000b1', '8b000000-0000-0000-0000-0000000000c1'],
  '#41: Cx Seven (both dishes) before Cx Corner (one dish, closer); never the paused shop, the one beyond the delivery distance or one with no recorded road');
select tests.ok((:'same'::jsonb -> 0 ->> 'fee_usd') is not null and (:'same'::jsonb -> 0 ->> 'road_km')::numeric = 3.0,
  '#41: from the recorded shop → place distance (zero routing calls)');
select tests.ok((select payload -> 'alternatives' -> 0 ->> 'vendor_id' = '8b000000-0000-0000-0000-0000000000b1'
  and (payload -> 'alternatives' -> 0 ->> 'same_dish')::boolean and payload -> 'alternatives' -> 0 ->> 'ref' = 'v1'
  from public.outbound_messages where dedupe_key = 'cust:' || :'o1b' || ':rejected'),
  '#41: the rejection message carries them, apology and reason built by the bot');
select tests.ok((select refs -> 'v1' ->> 'id' = '8b000000-0000-0000-0000-0000000000b1' from public.bot_sessions where customer_id = :'cid'),
  '#41: and the agent can name them (session refs v1, v2)');
select public.order_rebuild_at(:'cid', :'o1b', '8b000000-0000-0000-0000-0000000000b1') as rb \gset
select tests.ok(:'rb'::jsonb ->> 'status' = 'ok' and jsonb_array_length(:'rb'::jsonb -> 'lines') = 2
  and :'rb'::jsonb -> 'lines' @> jsonb_build_array(
    jsonb_build_object('item_id', '8b000000-0000-0000-0000-00000000b001', 'quantity', 1),
    jsonb_build_object('item_id', '8b000000-0000-0000-0000-00000000b003', 'quantity', 1)),
  '#41: one tap rebuilds it at Cx Seven: its shawarma priced closest to the $8 one, its fries');
select tests.ok(:'rb'::jsonb -> 'missing' = jsonb_build_array(jsonb_build_object('name_ar', 'كنافة', 'name_en', 'Knefe', 'quantity', 1)),
  '#41: the knefe it does not have is named, never dropped silently');
select tests.ok(public.order_rebuild_at(:'cid', null, '8b000000-0000-0000-0000-0000000000c1') -> 'lines' -> 0 ->> 'item_id'
  = '8b000000-0000-0000-0000-00000000c001', '#41: the agent''s tool (no order id) finds the latest order a shop could not take');
select tests.ok(public.order_rebuild_at(:'cid', :'o1b', '8b000000-0000-0000-0000-0000000000d1') ->> 'status' = 'vendor_unavailable'
  and public.order_rebuild_at(:'cid', :'o1b', '8b000000-0000-0000-0000-0000000000a1') ->> 'status' = 'vendor_unavailable',
  '#41: a paused shop, or the shop that rejected it, is never the rebuild''s shop');
select tests.ok(public.order_rebuild_at('10000000-0000-0000-0000-000000000002', :'o1b', '8b000000-0000-0000-0000-0000000000b1') ->> 'status'
  = 'not_found', '#41: only the customer''s own order');
update public.orders set status = 'cancelled', cancel_reason = 'customer' where id = :'o1';
select tests.ok(public.order_rebuild_at(:'cid', :'o1', '8b000000-0000-0000-0000-0000000000b1') ->> 'status' = 'not_found'
  and (select payload -> 'alternatives' is null from public.outbound_messages where dedupe_key = 'cust:' || :'o1' || ':cancelled') is not false,
  '#41: an order the customer cancelled is not offered elsewhere');

-- #49-50 Problems after delivery -----------------------------------------------------------------------------------------------
-- O2: very late, delivered by the fleet.
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a001'::uuid, '8b000000-0000-0000-0000-00000000a002'::uuid],
  'test:cx:o2') as o2 \gset
update public.orders set status = 'accepted' where id = :'o2';
select tests.ok((select eta_max_at is not null and eta_max_at > now() from public.orders where id = :'o2'),
  '#50: the top of the ETA range told at acceptance is kept on the order');
update public.orders set status = 'ready' where id = :'o2';
update public.orders set status = 'picked_up' where id = :'o2';
update public.orders set delivery_code_confirmed_at = now() where id = :'o2';
update public.orders set status = 'delivered' where id = :'o2';
update public.orders set delivery_mode = 'fleet', accepted_at = now() - interval '90 minutes', prep_minutes = 20,
  ready_marked_at = now() - interval '70 minutes', picked_up_at = now() - interval '45 minutes', eta_max_at = now() - interval '50 minutes',
  delivered_at = now() - interval '20 minutes' where id = :'o2';

-- Two more delivered orders (before any discount exists, so none of it is used on them).
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a005'::uuid], 'test:cx:o3') as o3 \gset
select tests.cx_deliver(:'o3');
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a004'::uuid], 'test:cx:o4') as o4 \gset
select tests.cx_deliver(:'o4');
select public.dispute_report(:'cid', :'o2', 'late') as d1 \gset
select tests.ok(:'d1'::jsonb ->> 'status' = 'auto_credit' and (:'d1'::jsonb ->> 'amount_usd')::numeric = 2.00
  and :'d1'::jsonb ->> 'payer' = 'alo_king' and (:'d1'::jsonb ->> 'credit_days')::int = 60,
  '#50: 30 min past the ETA range (threshold 15): late_discount_usd off the next order, Alo King pays (its fleet, the shop was on time)');
select tests.ok((select count(*) = 2 and sum(e.amount) = 0
    and bool_or(a.kind = 'expense_refunds' and e.amount = 2.00) and bool_or(a.kind = 'customer_refund_payable' and e.amount = -2.00)
  from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id join public.ledger_accounts a on a.id = e.account_id
  where t.idempotency_key = 'dispute:' || (:'d1'::jsonb ->> 'dispute_id') and t.kind = 'refund'),
  '#50: one balanced ledger transaction: Alo King''s expense, owed to the customer as a discount (no cash value)');
select tests.ok((select expires_at between now() + interval '59 days 23 hours' and now() + interval '60 days 1 hour'
  from public.customer_credits where dispute_id = (:'d1'::jsonb ->> 'dispute_id')::uuid), '#50: it expires after discount_expiry_days');
select tests.ok(public.dispute_report(:'cid', :'o2', 'cold_food') ->> 'status' = 'already_reported'
  and public.dispute_report(:'cid', :'o2', 'damaged') ->> 'status' = 'already_reported'
  and public.dispute_report(:'cid', :'o2', 'late') ->> 'status' = 'already_reported', '#50: once per order, cold, spilled or late');

-- #49: a missing item with a photo and the customer's words. The customer's second report: a person decides.
select id as o2_fries from public.order_items where order_id = :'o2' and name_en = 'Fries' \gset
select public.dispute_report(:'cid', :'o2', 'missing_item', :'o2_fries', 1, 'wa-media:1234567890', 'the fries were not in the bag') as d2 \gset
select tests.ok(:'d2'::jsonb ->> 'status' = 'review' and (:'d2'::jsonb ->> 'amount_usd')::numeric = 3.00
  and :'d2'::jsonb ->> 'payer' = 'merchant' and (:'d2'::jsonb ->> 'photo')::boolean,
  '#49: missing fries: $3.00, the shop caused it so the shop pays; a second report goes to a person');
select tests.ok((select photo_ref = 'wa-media:1234567890' and customer_note = 'the fries were not in the bag' and photo_at is not null
  from public.order_disputes where id = (:'d2'::jsonb ->> 'dispute_id')::uuid), '#49: the optional photo and the words are on the report');
select tests.ok((select detail ->> 'photo_ref' = 'wa-media:1234567890' and summary ~ 'photo attached'
  from public.ops_alerts where dedupe_key = 'dispute:' || (:'d2'::jsonb ->> 'dispute_id')), '#49: the person deciding sees the photo');
select tests.ok(public.dispute_report(:'cid', :'o2', 'wrong_item', :'o2_fries', 1, 'javascript:alert(1)') ->> 'photo' = 'false',
  '#49: anything but a WhatsApp media reference is not kept as a photo');
-- (Reports in one transaction share a timestamp; this one was made a minute earlier.)
update public.order_disputes set created_at = now() - interval '1 minute' where order_id = :'o2' and kind = 'wrong_item';
-- The discount's lifetime is a dated value: a shorter one applies to discounts booked from now on.
insert into public.app_config (key, value, effective_from, note) values
  ('discount_expiry_days', '30', now() - interval '1 second', 'test: a shorter discount lifetime');
select public.dispute_decide((:'d2'::jsonb ->> 'dispute_id')::uuid, true, '00000000-0000-0000-0000-00000000000a') as dd \gset
select tests.ok(:'dd'::jsonb ->> 'status' = 'booked' and (select expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
  from public.customer_credits where dispute_id = (:'d2'::jsonb ->> 'dispute_id')::uuid), '#49: approved, booked, expiring after the new discount_expiry_days');
select tests.ok((select bool_or(a.kind = 'merchant_payable' and a.vendor_id = '8b000000-0000-0000-0000-0000000000a1' and e.amount = 3.00)
  from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id join public.ledger_accounts a on a.id = e.account_id
  where t.idempotency_key = 'dispute:' || (:'d2'::jsonb ->> 'dispute_id')), '#49: charged to the merchant who caused it');

-- O3: delivered within the ETA range: no late discount; spilled with a photo goes to a person with late_discount_usd proposed.
update public.orders set eta_max_at = now() + interval '5 minutes', delivered_at = now() - interval '2 minutes' where id = :'o3';
select public.dispute_report(:'cid', :'o3', 'late') as d3 \gset
select tests.ok(:'d3'::jsonb ->> 'status' = 'rejected' and (:'d3'::jsonb ->> 'amount_usd')::numeric = 0
  and not exists (select 1 from public.ledger_transactions where idempotency_key = 'dispute:' || (:'d3'::jsonb ->> 'dispute_id')),
  '#50: on time: no discount and nothing in the ledger');
select public.dispute_report(:'cid', :'o3', 'damaged', null, 1, 'wa-media:spill-1') as d4 \gset
select tests.ok(:'d4'::jsonb ->> 'status' = 'review' and (:'d4'::jsonb ->> 'amount_usd')::numeric = 2.00
  and exists (select 1 from public.ops_alerts where dedupe_key = 'dispute:' || (:'d4'::jsonb ->> 'dispute_id') and detail ->> 'photo_ref' = 'wa-media:spill-1'),
  '#50: spilled: the photo decides, a person looks, late_discount_usd proposed');

-- O4: very late but paid online: a refund to the original payment, decided by a person, never a discount line.
update public.orders set payment_method = 'whish', eta_max_at = now() - interval '40 minutes', delivered_at = now() - interval '5 minutes'
where id = :'o4';
select public.dispute_report(:'cid', :'o4', 'late') as d5 \gset
select tests.ok(:'d5'::jsonb ->> 'status' = 'review'
  and not exists (select 1 from public.customer_credits where dispute_id = (:'d5'::jsonb ->> 'dispute_id')::uuid),
  '#50: an online order very late: a person refunds the original payment (§20.1), no discount line');
-- A photo sent after the report reaches its report and the operators.
select public.dispute_photo_add(:'cid', 'wa-media:late-photo') as ph \gset
select tests.ok(:'ph'::jsonb ->> 'status' = 'attached' and :'ph'::jsonb ->> 'dispute_id' = :'d5'::jsonb ->> 'dispute_id'
  and exists (select 1 from public.ops_alerts where dedupe_key = 'dispute-photo:' || (:'d5'::jsonb ->> 'dispute_id')),
  '#49: a photo sent later joins the latest report a person is deciding');
select tests.ok(public.dispute_photo_add(:'cid', 'wa-media:another') ->> 'status' = 'attached'
  and public.dispute_photo_add(:'cid', 'https://evil.example/x.jpg') ->> 'status' = 'invalid', '#49: only media references are kept');
-- Approved: nothing booked, and the refund still owed is an operator alert, so it is never lost.
select public.dispute_decide((:'d5'::jsonb ->> 'dispute_id')::uuid, true, '00000000-0000-0000-0000-00000000000a') as dd5 \gset
select tests.ok(:'dd5'::jsonb ->> 'status' = 'refund_pending'
  and (select ledger_tx is null from public.order_disputes where id = (:'d5'::jsonb ->> 'dispute_id')::uuid)
  and not exists (select 1 from public.customer_credits where dispute_id = (:'d5'::jsonb ->> 'dispute_id')::uuid)
  and exists (select 1 from public.ops_alerts where dedupe_key = 'refund_pending:' || (:'d5'::jsonb ->> 'dispute_id')),
  '#50: an approved online refund books nothing and tells the operators the refund is owed (§20.1)');

-- The discount lines on the next order: off the total at the summary, recorded for the merchant on delivery ------------
select public.ledger_account('customer_refund_payable', 'USD') as crp \gset
select balance as crp_before from public.ledger_account_balances where account_id = :'crp' \gset
select public.basket_add_item(:'cid', '8b000000-0000-0000-0000-00000000a005', 1, '{}', null, true);
select public.basket_quote(:'cid') as q5 \gset
select tests.ok((:'q5'::jsonb ->> 'credit_usd')::numeric = 5.00
  and (:'q5'::jsonb ->> 'total_usd')::numeric = (:'q5'::jsonb ->> 'subtotal_usd')::numeric + (:'q5'::jsonb ->> 'delivery_fee_usd')::numeric - 5.00
  and (:'q5'::jsonb ->> 'total_lbp')::numeric = round((:'q5'::jsonb ->> 'total_usd')::numeric * (:'q5'::jsonb ->> 'usd_lbp_rate')::numeric, 0),
  '#49-50: both discount lines ($2 late, $3 missing) come off the next order''s total, in USD and LBP at the rate');
select b.id as b5, b.priced_menu_version as v5 from public.baskets b where b.customer_id = :'cid' and b.status = 'open' \gset
select public.order_place(:'b5', :'v5', 'test:cx:o5') as o5 \gset
select (:'o5'::jsonb ->> 'order_id') as o5id \gset
select tests.ok((select credit_usd = 5.00 and discount_usd >= 5.00 from public.orders where id = :'o5id'), 'the order keeps the discount');
select tests.cx_deliver(:'o5id');
select tests.ok((select count(*) = 2 and sum(e.amount) = 0
    and bool_or(a.kind = 'customer_refund_payable' and e.amount = 5.00) and bool_or(a.kind = 'merchant_payable' and e.amount = -5.00)
  from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id join public.ledger_accounts a on a.id = e.account_id
  where t.idempotency_key = 'credit-used:' || :'o5id'),
  'on delivery the ledger records that Alo King owes the merchant the discount the customer did not pay');
select tests.ok((select balance from public.ledger_account_balances where account_id = :'crp') = :'crp_before'::numeric - 5.00
  and (select balance from public.ledger_account_balances where account_id = :'crp')
      = -(select coalesce(sum(e.amount), 0) from public.ledger_entries e where e.account_id = :'crp'),
  'the balance is a view over the entries: the $5 owed is gone, nothing edited');
select tests.ok((public.customer_profile(:'cid') ->> 'credit_usd')::numeric = 0, 'nothing left to use');

-- An unused discount expires back to whoever funded it, as a reversal ------------------------------------------------------
select public.dispute_decide((:'d4'::jsonb ->> 'dispute_id')::uuid, true, '00000000-0000-0000-0000-00000000000a') as dd4 \gset
select id as c4 from public.customer_credits where dispute_id = (:'d4'::jsonb ->> 'dispute_id')::uuid \gset
update public.customer_credits set expires_at = now() - interval '1 minute' where id = :'c4';
select app_private.credits_expire();
select tests.ok((select t.kind = 'reversal' and t.reverses_id = (select ledger_tx from public.order_disputes where id = (:'d4'::jsonb ->> 'dispute_id')::uuid)
  from public.ledger_transactions t where t.idempotency_key = 'credit-expired:' || :'c4'), 'an expired discount is reversed, not deleted');
select tests.ok((select balance from public.ledger_account_balances where account_id = :'crp') = :'crp_before'::numeric - 5.00,
  'and what was owed for it is back to zero');
select tests.throws($$update public.ledger_entries set amount = amount + 1 where id = (select max(id) from public.ledger_entries)$$,
  'append-only|not allowed|cannot', 'a ledger entry is never edited');
select tests.throws($$delete from public.ledger_transactions where idempotency_key like 'dispute:%'$$,
  'append-only|not allowed|cannot', 'or deleted');

-- Lateness is the shop's or the driver's, never the customer's own -------------------------------------------------------------
-- The merchant's own prep time sets the promise: accepted at 45 minutes where the shop's default is shorter.
update public.vendors set pickup_enabled = true where id = '8b000000-0000-0000-0000-0000000000a1';
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a005'::uuid], 'test:cx:o6', true) as o6 \gset
select app_private.order_accept(:'o6', 45, null, 'whatsapp');
select tests.ok((select prep_minutes = 45 and eta_max_at >= now() + interval '45 minutes' from public.orders where id = :'o6'),
  '#50: the promise uses the prep time the merchant chose, never the shop''s default');
-- A pickup the shop had ready on time, collected 40 minutes late: not late, nothing charged to the merchant.
update public.orders set status = 'ready' where id = :'o6';
update public.orders set status = 'delivered' where id = :'o6';
update public.orders set ready_marked_at = now() - interval '60 minutes', eta_max_at = now() - interval '55 minutes',
  delivered_at = now() - interval '15 minutes' where id = :'o6';
select public.dispute_report(:'cid', :'o6', 'late') as d6 \gset
select tests.ok(:'d6'::jsonb ->> 'status' = 'rejected'
  and not exists (select 1 from public.ledger_transactions where idempotency_key = 'dispute:' || (:'d6'::jsonb ->> 'dispute_id')),
  '#50: a pickup is measured on when the shop had it ready, never when the customer came: no discount, no ledger row');
select tests.ok(public.dispute_report(:'cid', :'o6', 'cold_food') ->> 'status' = 'rejected',
  '#50: and its food is not cold by the collection time either');
-- A pickup never marked ready: a person decides, never automatic.
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a005'::uuid], 'test:cx:o7', true) as o7 \gset
update public.orders set status = 'accepted' where id = :'o7';
update public.orders set status = 'ready' where id = :'o7';
update public.orders set status = 'delivered' where id = :'o7';
update public.orders set ready_marked_at = null, eta_max_at = now() - interval '55 minutes', delivered_at = now() - interval '5 minutes'
where id = :'o7';
select public.dispute_report(:'cid', :'o7', 'late') as d7 \gset
select tests.ok(:'d7'::jsonb ->> 'status' = 'review'
  and not exists (select 1 from public.ledger_transactions where idempotency_key = 'dispute:' || (:'d7'::jsonb ->> 'dispute_id')),
  '#50: a pickup never marked ready cannot be judged: a person decides');
-- A delivery: the driver reached the door on time and waited for the customer; delivered 40 minutes after the promise.
select tests.cx_place(:'cid', array['8b000000-0000-0000-0000-00000000a005'::uuid], 'test:cx:o8') as o8 \gset
select tests.cx_deliver(:'o8');
update public.orders set delivery_mode = 'merchant', eta_max_at = now() - interval '45 minutes', delivered_at = now() - interval '5 minutes'
where id = :'o8';
insert into public.order_events (order_id, at, from_status, to_status, event, actor_kind)
values (:'o8', now() - interval '50 minutes', 'picked_up', 'arrived', 'arrived', 'system');
select public.dispute_report(:'cid', :'o8', 'late') as d8 \gset
select tests.ok(:'d8'::jsonb ->> 'status' = 'rejected' and :'d8'::jsonb ->> 'rule' ~ 'at the door within',
  '#50: lateness is measured at the door: time waiting for a customer who does not answer never earns a discount');

-- Access: the service role only ----------------------------------------------------------------------------------------------
set local role authenticated;
select tests.throws($$select public.order_note_send('10000000-0000-0000-0000-000000000001', 'x', 'y')$$, 'permission denied',
  'a client cannot pass notes');
select tests.throws($$select public.dispute_report('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'late')$$,
  'permission denied', 'or report problems');
select tests.throws($$select public.basket_gap_items('10000000-0000-0000-0000-000000000001')$$, 'permission denied', 'or read gap items');
select tests.throws($$select public.order_rebuild_at('10000000-0000-0000-0000-000000000001', null, null)$$, 'permission denied',
  'or rebuild an order');
select tests.ok((select count(*) = 0 from public.order_customer_notes), 'notes are not readable without a right to the order');
reset role;
set local role anon;
select tests.throws($$select public.basket_switch_names('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  'permission denied', 'anon calls nothing');
select tests.throws($$select public.dispute_photo_add('10000000-0000-0000-0000-000000000001', 'wa-media:x')$$, 'permission denied',
  'anon calls nothing at all');
reset role;

rollback;
