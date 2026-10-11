-- Phase 2 orders: menus, menu version, combos, daily quantities, fee rules, placement checks, the state
-- machine, cancellation, weights, container exchange, merchant drivers and access (§27, §29, §30).
begin;

-- Fixtures ------------------------------------------------------------------------------------------------
insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-ORD', 'CHF', 'Ordertown', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-ORDTOWN', 'TZ-ORD', 'Ordertown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test'),
  ('LB-CHF-ORDPAUSE', null, 'Pausedtown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.59 33.69)', 'test');
select public.place_set_service_status('LB-CHF-ORDPAUSE', 'paused', 'test pause');

-- Vendor A (restaurant, 5 km) went live 40 days ago: past its 30 free days.
update public.vendors set live_since = now() - interval '40 days', pickup_enabled = true, stairs_fee_per_floor_usd = 0.50
where id = '20000000-0000-0000-0000-00000000000a';

insert into public.menu_sections (id, vendor_id, name_en) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Mains');
insert into public.menu_items (id, vendor_id, section_id, name_en, price_usd, pricing_unit, est_weight_kg, daily_quantity, daily_remaining, daily_date, container_deposit_usd, is_combo) values
  ('41000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'Shawarma', 5.00, 'each', null, null, null, null, null, false),
  ('41000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'Knefe', 3.00, 'each', null, 5, 5, current_date, null, false),
  ('41000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'Lamb', 20.00, 'kg', 0.5, null, null, null, null, false),
  ('41000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'Gas cylinder', 12.00, 'each', null, null, null, null, 25.00, false),
  ('41000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 'Shawarma + Knefe', 7.00, 'each', null, null, null, null, null, true);
insert into public.menu_combo_components (combo_item_id, component_item_id) values
  ('41000000-0000-0000-0000-000000000005', '41000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000005', '41000000-0000-0000-0000-000000000002');
insert into public.menu_option_groups (id, item_id, name_en, min_select, max_select) values
  ('42000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'Size', 1, 1);
insert into public.menu_options (id, group_id, name_en, price_delta_usd) values
  ('43000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', 'Regular', 0),
  ('43000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000001', 'Large', 1.50);

insert into public.addresses (id, customer_id, place_id, pin, source) values
  ('44000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LB-CHF-ORDTOWN', 'SRID=4326;POINT(35.5861 33.6821)', 'pin'),
  ('44000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'LB-CHF-ORDPAUSE', 'SRID=4326;POINT(35.59 33.69)', 'pin'),
  ('44000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'LB-CHF-ORDTOWN', 'SRID=4326;POINT(35.5700 33.6700)', 'pin');
-- Road routes from vendor A (33.68, 35.58): 2.4 km to address 1, 7.5 km to address 3 (beyond 5 km).
select public.route_cache_store(33.68, 35.58, array[33.6821, 33.67], array[35.5861, 35.57], array[2400, 7500], array[300, 700], 'ors');

-- A merchant driver for vendor A.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000011', 'driver@test.invalid');
insert into public.vendor_members (id, vendor_id, user_id, phone_e164, role, status) values
  ('45000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000011', '+96171000009', 'driver', 'active');

-- Helper: an open basket with lines [(item, qty, options, has_empty)].
create function pg_temp.basket(p_customer uuid, p_lines jsonb, p_fulfilment public.fulfilment_kind default 'pickup',
  p_address uuid default null, p_floors smallint default null) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  l jsonb;
begin
  update public.baskets set status = 'abandoned' where customer_id = p_customer and status = 'open';
  insert into public.baskets (customer_id, vendor_id, fulfilment, address_id, stairs_floors)
  values (p_customer, '20000000-0000-0000-0000-00000000000a', p_fulfilment, p_address, p_floors) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.basket_items (basket_id, item_id, quantity, option_ids, has_empty)
    values (v_id, (l ->> 'item')::uuid, (l ->> 'qty')::int,
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(l -> 'options') x), '{}'),
            (l ->> 'has_empty')::boolean);
  end loop;
  return v_id;
end;
$$;
create function pg_temp.place(p_basket uuid, p_key text) returns jsonb
language sql as $$
  select public.order_place(p_basket, (public.basket_price(p_basket) ->> 'menu_version')::bigint, p_key);
$$;

-- Fee rules (§29.1) ---------------------------------------------------------------------------------------
select tests.ok(public.order_fee_usd('20000000-0000-0000-0000-00000000000a', 40) = 1.00, 'restaurant: $1.00 flat after the free days');
update public.vendors set business_type = 'grocery_supermarket' where id = '20000000-0000-0000-0000-00000000000b';
update public.vendors set live_since = now() - interval '40 days' where id = '20000000-0000-0000-0000-00000000000b';
select tests.ok(public.order_fee_usd('20000000-0000-0000-0000-00000000000b', 20) = 1.00, 'grocery 2.5% of $20 = $0.50, raised to the $1 minimum');
select tests.ok(public.order_fee_usd('20000000-0000-0000-0000-00000000000b', 80) = 2.00, 'grocery 2.5% of $80 = $2.00');
select tests.ok(public.order_fee_usd('20000000-0000-0000-0000-00000000000b', 200) = 3.00, 'grocery capped at $3.00');
update public.vendors set business_type = 'home_essentials' where id = '20000000-0000-0000-0000-00000000000b';
select tests.ok(public.order_fee_usd('20000000-0000-0000-0000-00000000000b', 30) = 0.50, 'home essentials: $0.50 flat');
update public.vendors set live_since = now() - interval '5 days' where id = '20000000-0000-0000-0000-00000000000b';
select tests.ok(public.order_fee_usd('20000000-0000-0000-0000-00000000000b', 30) = 0, 'free during the first 30 days');

-- Menu version (§30.1.1) and combos (§30.1.3) ---------------------------------------------------------------
select menu_version as v0 from public.vendors where id = '20000000-0000-0000-0000-00000000000a' \gset
update public.menu_items set daily_remaining = 4 where id = '41000000-0000-0000-0000-000000000002';
select tests.ok((select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a') = :v0,
  'a daily countdown that stays above zero does not change the menu version');
update public.menu_items set price_usd = 5.50 where id = '41000000-0000-0000-0000-000000000001';
select tests.ok((select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a') = :v0 + 1,
  'a price change bumps the menu version');
update public.menu_items set price_usd = 5.00 where id = '41000000-0000-0000-0000-000000000001';
update public.menu_options set available = false where id = '43000000-0000-0000-0000-000000000002';
select tests.ok((select menu_version from public.vendors where id = '20000000-0000-0000-0000-00000000000a') = :v0 + 3,
  'an option change bumps the menu version');
update public.menu_options set available = true where id = '43000000-0000-0000-0000-000000000002';
update public.menu_items set daily_remaining = 5 where id = '41000000-0000-0000-0000-000000000002';

select tests.ok(app_private.menu_item_orderable('41000000-0000-0000-0000-000000000005'), 'the combo is orderable while its parts are');
update public.menu_items set available = false where id = '41000000-0000-0000-0000-000000000001';
select tests.ok(not app_private.menu_item_orderable('41000000-0000-0000-0000-000000000005'), 'a sold-out component hides the combo');
update public.menu_items set available = true where id = '41000000-0000-0000-0000-000000000001';
select tests.ok(not app_private.menu_item_orderable('41000000-0000-0000-0000-000000000002', 6), 'more than the daily quantity left is not orderable');
select tests.throws($$insert into public.menu_combo_components values ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002', 1)$$,
  'not a combo', 'only combo items take components');

-- Placement --------------------------------------------------------------------------------------------
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Pickup: 2 large shawarma ($6.50 each) = $13.00.
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 2, "options": ["43000000-0000-0000-0000-000000000002"]}]') as b1 \gset
select public.basket_price(:'b1') as s1 \gset
select tests.ok((:'s1'::jsonb ->> 'subtotal_usd')::numeric = 13.00, 'basket priced from the menu: 2 × ($5.00 + $1.50) = $13.00');

-- Price changes between the summary and the tap: nothing is created, the basket is re-priced.
update public.menu_items set price_usd = 6.00 where id = '41000000-0000-0000-0000-000000000001';
select public.order_place(:'b1', (:'s1'::jsonb ->> 'menu_version')::bigint, 'test:place:b1') as r1 \gset
select tests.ok(:'r1'::jsonb ->> 'status' = 'repriced'
  and (:'r1'::jsonb #>> '{summary,subtotal_usd}')::numeric = 15.00
  and jsonb_array_length(:'r1'::jsonb #> '{summary,changed}') = 1, 'a stale menu version re-prices and shows the difference (§30.1.1)');
select tests.ok(not exists (select 1 from public.orders where idempotency_key = 'test:place:b1'), 'no order is created on a stale version');
select public.order_place(:'b1', (:'r1'::jsonb #>> '{summary,menu_version}')::bigint, 'test:place:b1') as r1b \gset
select tests.ok(:'r1b'::jsonb ->> 'status' = 'placed', 'confirming the new summary places the order');
select tests.ok((select (status, total_usd, usd_lbp_rate, total_lbp, order_fee_usd, is_new_customer)
                 = ('placed'::public.order_status, 15.00::numeric, 89500::numeric, 1342500::numeric, 1.00::numeric, true)
                 from public.orders where idempotency_key = 'test:place:b1'),
  'order keeps total, locked rate, LBP total, fee snapshot and the new-customer flag');
select tests.ok(public.order_place(:'b1', 0, 'test:place:b1') ->> 'repeat' = 'true', 'a repeated confirmation returns the first order');
select tests.ok((select count(*) from public.order_items i join public.orders o on o.id = i.order_id
                 where o.idempotency_key = 'test:place:b1' and i.options -> 0 ->> 'name_en' = 'Large') = 1, 'options are snapshotted');
select tests.ok((select status from public.baskets where id = :'b1') = 'ordered', 'the basket is closed');

-- Option rules: a required group needs a choice.
select pg_temp.basket('10000000-0000-0000-0000-000000000001', '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 1}]') as b2 \gset
select tests.ok(pg_temp.place(:'b2', 'test:place:b2') ->> 'status' = 'unavailable', 'a missing required option is not orderable');

-- New-number COD cap $50 (§29.4): 9 × $6.00 = $54.
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 9, "options": ["43000000-0000-0000-0000-000000000001"]}]') as b3 \gset
select pg_temp.place(:'b3', 'test:place:b3') as r3 \gset
select tests.ok(:'r3'::jsonb ->> 'status' = 'cod_cap' and (:'r3'::jsonb ->> 'cap_usd')::numeric = 50, 'a number without a delivered order is capped at $50 COD');

-- Paused vendor.
update public.vendors set paused_until = now() + interval '30 minutes' where id = '20000000-0000-0000-0000-00000000000a';
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 1, "options": ["43000000-0000-0000-0000-000000000001"]}]') as b4 \gset
select tests.ok(pg_temp.place(:'b4', 'test:place:b4') ->> 'status' = 'vendor_paused', 'a paused vendor takes no order');
update public.vendors set paused_until = null where id = '20000000-0000-0000-0000-00000000000a';

-- Delivery: fee band from the road route, stairs, paused place, beyond radius.
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 1, "options": ["43000000-0000-0000-0000-000000000001"]}]',
  'delivery', '44000000-0000-0000-0000-000000000001', 3::smallint) as b5 \gset
select pg_temp.place(:'b5', 'test:place:b5') as r5 \gset
select tests.ok((select (fulfilment, delivery_mode, road_km, delivery_fee_usd, stairs_fee_usd, total_usd)
                 = ('delivery'::public.fulfilment_kind, 'merchant'::public.delivery_mode, 2.40::numeric, 2.00::numeric, 1.50::numeric, 9.50::numeric)
                 from public.orders where idempotency_key = 'test:place:b5'),
  'delivery: $2.00 band for 2.4 road km, 3 floors × $0.50 stairs, total $9.50');
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 1, "options": ["43000000-0000-0000-0000-000000000001"]}]',
  'delivery', '44000000-0000-0000-0000-000000000002') as b6 \gset
select tests.ok(pg_temp.place(:'b6', 'test:place:b6') ->> 'status' = 'place_paused', 'no orders to a paused place (South/Nabatieh rule)');
select pg_temp.basket('10000000-0000-0000-0000-000000000002',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 1, "options": ["43000000-0000-0000-0000-000000000001"]}]',
  'delivery', '44000000-0000-0000-0000-000000000003') as b7 \gset
select tests.ok(pg_temp.place(:'b7', 'test:place:b7') ->> 'status' = 'beyond_radius', '7.5 road km is beyond vendor A''s 5 km');
delete from public.route_cache;
select tests.throws(format($$select public.order_place(%L, 1, 'test:place:b5x')$$, :'b5'), 'is ordered', 'an ordered basket cannot be placed again under a new key');
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000001", "qty": 1, "options": ["43000000-0000-0000-0000-000000000001"]}]',
  'delivery', '44000000-0000-0000-0000-000000000001') as b8 \gset
select tests.ok(pg_temp.place(:'b8', 'test:place:b8') ->> 'status' = 'no_route', 'no cached road route: no_route, never a straight-line guess');
reset role;

-- Container exchange (§29.2): no empty to return adds the deposit.
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.basket('10000000-0000-0000-0000-000000000001',
  '[{"item": "41000000-0000-0000-0000-000000000004", "qty": 1, "has_empty": false}]') as b9 \gset
select pg_temp.place(:'b9', 'test:place:b9') as r9 \gset
select tests.ok((select (container_deposit_usd, total_usd) = (25.00::numeric, 37.00::numeric) from public.orders where idempotency_key = 'test:place:b9'),
  'no empty to return: the $25 deposit is added');

-- Daily quantity: low-stock signal (§30.1.4).
select pg_temp.basket('10000000-0000-0000-0000-000000000001', '[{"item": "41000000-0000-0000-0000-000000000002", "qty": 2}]') as b10 \gset
select pg_temp.place(:'b10', 'test:place:b10') as r10 \gset
select tests.ok((:'r10'::jsonb -> 'low_stock' -> 0 ->> 'remaining')::int = 3
  and (select daily_remaining from public.menu_items where id = '41000000-0000-0000-0000-000000000002') = 3,
  'placing decrements the daily quantity and flags "last few" at 3');
reset role;

-- State machine ----------------------------------------------------------------------------------------
select id as o1 from public.orders where idempotency_key = 'test:place:b1' \gset
select id as o5 from public.orders where idempotency_key = 'test:place:b5' \gset
select id as o9 from public.orders where idempotency_key = 'test:place:b9' \gset
select id as o10 from public.orders where idempotency_key = 'test:place:b10' \gset

select tests.throws(format($$update public.orders set status = 'delivered' where id = %L$$, :'o1'), 'cannot go from placed to delivered',
  'the transition guard binds every writer, including the service role and the owner of the table');
select tests.throws(format($$update public.orders set usd_lbp_rate = 1 where id = %L$$, :'o1'), 'never change', 'the locked rate never changes');

-- The cashier accepts from the portal; a second tap is harmless.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000f');
select tests.ok(public.order_accept(:'o1', 15) ->> 'status' = 'accepted', 'the cashier accepts with a 15-minute prep time');
select tests.ok(public.order_accept(:'o1', 15) ->> 'status' = 'already_accepted', 'a duplicate accept is idempotent');
select tests.throws(format($$select public.order_reject(%L, 'busy')$$, :'o1'), 'stale_status', 'a reject after the accept loses (stale status)');
select tests.ok((select count(*) from public.order_events where order_id = :'o1' and event = 'accepted') = 1, 'one accepted event');
select tests.throws(format($$update public.orders set status = 'ready' where id = %L$$, :'o1'), 'permission denied', 'clients cannot update orders directly');
reset role;

-- Another merchant cannot touch vendor A's order; a driver cannot accept.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-000000000010');
select tests.throws(format($$select public.order_accept(%L)$$, :'o5'), 'not allowed', 'vendor B''s owner cannot accept vendor A''s order');
select tests.ok(tests.count_of(format($$select id from public.orders where id = %L$$, :'o5')) = 0, 'vendor B''s owner cannot read it');
select tests.act_as('00000000-0000-0000-0000-000000000011');
select tests.throws(format($$select public.order_accept(%L)$$, :'o5'), 'not allowed', 'a merchant driver cannot accept orders');
select tests.ok(tests.count_of('select id from public.orders') = 0, 'a driver sees no unassigned order');
reset role;

-- The service role acts for a member identified by the WhatsApp number (member id).
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.order_accept(:'o5', null, (select id from public.vendor_members where phone_e164 = '+96171000001'), 'whatsapp') ->> 'status' = 'accepted',
  'the owner accepts by WhatsApp button');
select tests.ok((select prep_minutes = 20 and acknowledged_via = 'whatsapp' from public.orders where id = :'o5'), 'default prep time and acknowledgement channel recorded');
select tests.throws(format($$select public.order_accept(%L, null, '45000000-0000-0000-0000-000000000001')$$, :'o9'), 'not allowed',
  'the service role cannot accept on behalf of a driver');
select tests.ok(public.order_assign_driver(:'o5', '45000000-0000-0000-0000-000000000001') ->> 'status' = 'assigned', 'the merchant assigns its driver');
select tests.ok((select status from public.orders where id = :'o5') = 'driver_assigned', 'status moves to driver_assigned');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-000000000011');
select tests.ok(tests.count_of('select id from public.orders') = 1, 'the driver sees only the order assigned to them');
select tests.ok(public.order_progress(:'o5', 'picked_up') ->> 'status' = 'picked_up', 'the driver picks it up');
select tests.throws(format($$select public.order_progress(%L, 'preparing')$$, :'o5'), 'not allowed', 'a driver cannot set kitchen states');
-- A new customer's first COD order needs the 4-digit code at handover (§27.6, session 4).
select tests.throws(format($$select public.order_progress(%L, 'delivered')$$, :'o5'), 'delivery_code_required',
  'delivered without the customer''s code is refused');
reset role;
update public.orders set delivery_code_confirmed_at = now() where id = :'o5';
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-000000000011');
select tests.ok(public.order_progress(:'o5', 'delivered') ->> 'status' = 'delivered', 'the driver delivers');
reset role;
select tests.act_as(null);
select tests.ok((select delivered_at is not null and closed_at is not null from public.orders where id = :'o5'), 'delivery and close times recorded');
select tests.throws(format($$select public.order_progress(%L, 'preparing')$$, :'o5'), 'cannot go from delivered to preparing', 'a delivered order is final');

-- Customer cancellation (§30.3.6) -----------------------------------------------------------------------
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.order_cancel_by_customer(:'o10', '10000000-0000-0000-0000-000000000001') ->> 'status' = 'cancelled', 'free cancel before acceptance');
select tests.ok(public.order_accept(:'o9', 10, (select id from public.vendor_members where phone_e164 = '+96171000002')) ->> 'status' = 'accepted', 'accepted');
select tests.ok(public.order_cancel_by_customer(:'o9', '10000000-0000-0000-0000-000000000001') ->> 'status' = 'cancelled', 'free cancel within 60 s of acceptance');
select tests.throws(format($$select public.order_cancel_by_customer(%L, '10000000-0000-0000-0000-000000000002')$$, :'o1'), 'unknown order',
  'another customer cannot cancel the order');
update public.orders set accepted_at = now() - interval '2 minutes' where id = :'o1';
select tests.ok(public.order_cancel_by_customer(:'o1', '10000000-0000-0000-0000-000000000001') ->> 'status' = 'request_sent', 'later, a cancel is a request');
select tests.ok(public.order_cancel_request_respond(:'o1', false, (select id from public.vendor_members where phone_e164 = '+96171000001')) ->> 'status' = 'continues',
  'the merchant refuses: the order continues');
select tests.ok((select status from public.orders where id = :'o1') = 'accepted', 'still accepted');
reset role;

-- Variable weight (§29.2) -------------------------------------------------------------------------------
set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- 2 × lamb at 0.5 kg estimated = 1 kg × $20 = $20 (estimate).
select pg_temp.basket('10000000-0000-0000-0000-000000000002', '[{"item": "41000000-0000-0000-0000-000000000003", "qty": 2}]') as bw \gset
select pg_temp.place(:'bw', 'test:place:bw') as rw \gset
select id as ow from public.orders where idempotency_key = 'test:place:bw' \gset
select tests.ok((select (weight_status, estimated_total_usd) = ('awaiting_weight'::public.weight_status, 20.00::numeric) from public.orders where id = :'ow')
  and (:'rw'::jsonb ->> 'estimated')::boolean, 'a weighed order is an estimate ("about $20, final by weight")');
select public.order_accept(:'ow', 10, (select id from public.vendor_members where phone_e164 = '+96171000001'));
select tests.throws(format($$select public.order_progress(%L, 'picked_up', (select id from public.vendor_members where phone_e164 = '+96171000001'))$$, :'ow'),
  'final weights first', 'no pickup before the weights are in');
select public.order_set_weight((select id from public.order_items where order_id = :'ow'), 1.05,
  (select id from public.vendor_members where phone_e164 = '+96171000001')) as rw2 \gset
select tests.ok(:'rw2'::jsonb ->> 'status' = 'final' and (select total_usd from public.orders where id = :'ow') = 21.00,
  '1.05 kg: $21.00, within 10% of the estimate, final without asking');
reset role;

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.basket('10000000-0000-0000-0000-000000000002', '[{"item": "41000000-0000-0000-0000-000000000003", "qty": 1}]') as bw2 \gset
select pg_temp.place(:'bw2', 'test:place:bw2');
select id as ow2 from public.orders where idempotency_key = 'test:place:bw2' \gset
select public.order_accept(:'ow2', 10, (select id from public.vendor_members where phone_e164 = '+96171000001'));
select public.order_set_weight((select id from public.order_items where order_id = :'ow2'), 0.7,
  (select id from public.vendor_members where phone_e164 = '+96171000001')) as rw3 \gset
select tests.ok(:'rw3'::jsonb ->> 'status' = 'awaiting_customer', '0.7 kg for 0.5 estimated (+40%) waits for the customer''s tap');
select tests.ok(public.order_weight_respond(:'ow2', '10000000-0000-0000-0000-000000000002', false) ->> 'status' = 'cancelled',
  'the customer declines: the order is cancelled');
select tests.ok((select cancel_reason from public.orders where id = :'ow2') = 'weight_declined', 'with the weight reason');
reset role;

-- Access for customers and anon -------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.count_of('select id from public.orders where customer_id <> ''10000000-0000-0000-0000-000000000001''') = 0
  and tests.count_of('select id from public.orders') > 0, 'a customer reads only its own orders');
select tests.throws($$select public.order_cancel_by_customer('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  'permission denied', 'customers cannot call the server-only cancel directly');
select tests.throws($$select public.order_place(gen_random_uuid(), 1, 'test:client:place')$$, 'permission denied', 'clients cannot place orders directly');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.orders$$, 'permission denied', 'anon reads no orders');
select tests.ok(tests.count_of('select id from public.menu_items') = 5, 'anon reads the menu of a public vendor');
reset role;
update public.vendors set public_page = false where id = '20000000-0000-0000-0000-00000000000a';
set local role anon;
select tests.act_as(null);
select tests.ok(tests.count_of('select id from public.menu_items') = 0, 'a vendor without a public page shows no menu to anon');
reset role;

-- Ledger foreign key.
select tests.throws($$select public.ledger_post('order_fee', 'test:fk:order',
  jsonb_build_array(jsonb_build_object('account_id', public.ledger_account('platform_whish', 'USD'), 'amount', 1),
                    jsonb_build_object('account_id', public.ledger_account('revenue_order_fee', 'USD'), 'amount', -1)),
  gen_random_uuid(), 89500)$$, 'ledger_transactions_order_fk', 'ledger entries reference real orders');

rollback;
