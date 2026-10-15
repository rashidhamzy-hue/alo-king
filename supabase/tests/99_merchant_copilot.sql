-- Session 5c (DECISIONS §39.7, §38.3): the merchant copilot's server side. Every change is a proposal applied only by a
-- member's confirming tap: availability by station, section or item with automatic restore, stock that carries over,
-- items added, edited and removed, offers priced by the server into the order, hours and closures, minimum order, the
-- delivery radius, Boost budgets (recorded, never charged), reports, merchant memory and suggestions.
begin;

insert into public.menu_sections (id, vendor_id, name_en, name_ar) values
  ('58000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000000a', 'Sandwiches', 'سندويشات');
insert into public.menu_items (id, vendor_id, section_id, name_en, name_ar, price_usd, station) values
  ('58000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '58000000-0000-0000-0000-0000000000a1', 'Fries', 'بطاطا', 3.00, 'fryer'),
  ('58000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', '58000000-0000-0000-0000-0000000000a1', 'Nuggets', 'ناغتس', 5.00, 'fryer'),
  ('58000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '58000000-0000-0000-0000-0000000000a1', 'Tawouk', 'طاووق', 6.00, 'grill'),
  ('58000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', null, 'Rice 1kg', 'رز', 2.00, null);
update public.menu_items set available = false where id = '58000000-0000-0000-0000-000000000002'; -- already off

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select id as owner_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'owner' \gset
select id as cashier_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'cashier' \gset
\set va '20000000-0000-0000-0000-00000000000a'

-- 1. Availability (§38.3 "fryer off 15 min") --------------------------------------------------------------------------
select public.merchant_proposal_create(:'va', 'availability_off',
  jsonb_build_object('scope', 'station', 'target', 'fryer', 'until', now() + interval '15 minutes'), 'rules', :'cashier_a') as p1 \gset
reset role;
select tests.ok((select available from public.menu_items where id = '58000000-0000-0000-0000-000000000001'), 'nothing changes before the tap');
set local role service_role;
select tests.ok((public.merchant_proposal_decide(:'p1', true, :'cashier_a') ->> 'hidden')::int = 1,
  'a cashier switches the fryer off: only the fryer item that was on is hidden');
reset role;
select tests.ok((select not available from public.menu_items where id = '58000000-0000-0000-0000-000000000001')
  and (select available from public.menu_items where id = '58000000-0000-0000-0000-000000000003'), 'the grill item stays on');
update public.availability_holds set until = now() - interval '1 minute' where vendor_id = :'va';
select tests.ok(app_private.availability_tick() = 1, 'when the time is up the tick brings it back');
select tests.ok((select available from public.menu_items where id = '58000000-0000-0000-0000-000000000001')
  and (select not available from public.menu_items where id = '58000000-0000-0000-0000-000000000002'),
  'exactly what it hid: an item that was already off stays off');
set local role service_role;
select tests.throws(format($$select public.merchant_proposal_create(%L, 'availability_off', '{"scope": "station", "target": "fryer", "until": "%s"}', 'rules', %L)$$,
  :'va', (now() + interval '3 days')::text, :'cashier_a'), 'within the configured maximum', 'never off for more than a day');
select tests.throws(format($$select public.merchant_proposal_create(%L, 'availability_off', '{"scope": "station", "target": "saj"}', 'rules', %L)$$,
  :'va', :'cashier_a'), 'no items', 'a station without items is refused before the card');
-- A section off until switched on.
select public.merchant_proposal_create(:'va', 'availability_off', jsonb_build_object('scope', 'section', 'target', '58000000-0000-0000-0000-0000000000a1'),
  'rules', :'owner_a') as p2 \gset
select public.merchant_proposal_decide(:'p2', true, :'owner_a');
select public.merchant_proposal_create(:'va', 'availability_on', jsonb_build_object('scope', 'section', 'target', '58000000-0000-0000-0000-0000000000a1'),
  'rules', :'owner_a') as p3 \gset
select tests.ok((public.merchant_proposal_decide(:'p3', true, :'owner_a') ->> 'restored')::int = 2, 'the section comes back on the tap');

-- 2. Stock and items ----------------------------------------------------------------------------------------------------
select public.merchant_proposal_create(:'va', 'stock_set', '{"item_id": "58000000-0000-0000-0000-000000000004", "quantity": 20}', 'rules', :'cashier_a') as p4 \gset
select public.merchant_proposal_decide(:'p4', true, :'cashier_a');
reset role;
select tests.ok((select daily_remaining = 20 and stock_tracked from public.menu_items where id = '58000000-0000-0000-0000-000000000004'), 'stock set to 20');
update public.menu_items set daily_remaining = 7, daily_date = current_date - 1 where id = '58000000-0000-0000-0000-000000000004';
select app_private.stock_carry_over();
select tests.ok((select daily_remaining = 7 and daily_quantity = 7 and daily_date = (now() at time zone 'Asia/Beirut')::date
                 from public.menu_items where id = '58000000-0000-0000-0000-000000000004'), 'what is left carries over to the next day');
set local role service_role;
select tests.throws(format($$select public.merchant_proposal_create(%L, 'item_add', '{"name": "Wrap", "price_usd": 4}', 'rules', %L)$$, :'va', :'cashier_a'),
  'not allowed', 'a cashier does not add items');
select public.merchant_proposal_create(:'va', 'item_add', '{"name": "Falafel wrap", "price_usd": 4.5, "section": "sandwich", "station": "fryer"}', 'rules', :'owner_a') as p5 \gset
select public.merchant_proposal_decide(:'p5', true, :'owner_a') as r5 \gset
select tests.ok((select name_en = 'Falafel wrap' and price_usd = 4.5 and section_id = '58000000-0000-0000-0000-0000000000a1' and station = 'fryer'
                 from public.menu_items where id = (:'r5'::jsonb ->> 'item_id')::uuid), 'a new item lands in the section it names');
select public.merchant_proposal_create(:'va', 'item_edit', '{"item_id": "58000000-0000-0000-0000-000000000003", "name": "طاووق مشوي", "description": "on charcoal"}',
  'rules', :'owner_a') as p6 \gset
select public.merchant_proposal_decide(:'p6', true, :'owner_a');
select tests.ok((select name_ar = 'طاووق مشوي' and name_en = 'Tawouk' and description = 'on charcoal' from public.menu_items
                 where id = '58000000-0000-0000-0000-000000000003'), 'an Arabic rename changes the Arabic name only');
select public.merchant_proposal_create(:'va', 'item_remove', '{"item_id": "58000000-0000-0000-0000-000000000004"}', 'rules', :'owner_a') as p7 \gset
select public.merchant_proposal_decide(:'p7', true, :'owner_a');
select tests.ok((select not available and removed_at is not null from public.menu_items where id = '58000000-0000-0000-0000-000000000004'),
  'a removed item is off and marked removed, kept for order history');
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'back_in_stock',
  '{"item_id": "58000000-0000-0000-0000-000000000004"}', 'rules', null)$$, 'removed from the menu', 'and nothing switches it back on');
-- Removed during a power cut: "power back" does not bring it back.
reset role;
insert into app_private.power_hidden_items (item_id, vendor_id) values ('58000000-0000-0000-0000-000000000003', :'va');
update public.menu_items set available = false where id = '58000000-0000-0000-0000-000000000003';
set local role service_role;
select public.merchant_proposal_create(:'va', 'item_remove', '{"item_id": "58000000-0000-0000-0000-000000000003"}', 'rules', :'owner_a') as p7b \gset
select public.merchant_proposal_decide(:'p7b', true, :'owner_a');
reset role;
select app_private.vendor_power_on(:'va');
select tests.ok((select not available from public.menu_items where id = '58000000-0000-0000-0000-000000000003'), 'an item removed in a power cut stays off when the power comes back');
update public.menu_items set removed_at = null, available = true where id = '58000000-0000-0000-0000-000000000003';
set local role service_role;

-- 3. Offers, priced by the server into the order (§20.4) -----------------------------------------------------------------
select tests.throws(format($$select public.merchant_proposal_create(%L, 'offer_create', '{"kind": "percent", "percent": 80}', 'rules', %L)$$, :'va', :'owner_a'),
  'percent off', 'no offer above the configured maximum');
select public.merchant_proposal_create(:'va', 'offer_create', '{"kind": "percent", "percent": 10, "section_id": "58000000-0000-0000-0000-0000000000a1", "days": 3}',
  'rules', :'owner_a') as p8 \gset
select public.merchant_proposal_decide(:'p8', true, :'owner_a') as r8 \gset
select tests.ok((select section_id = '58000000-0000-0000-0000-0000000000a1' and cardinality(item_ids) = 0 and ends_at > now() + interval '71 hours'
                 from public.vendor_offers where id = (:'r8'::jsonb ->> 'offer_id')::uuid),
  'a section offer names the section (items added later count) and runs 3 days');
reset role;
insert into public.menu_sections (id, vendor_id, name_en) values ('58000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-00000000000a', 'Desserts');
set local role service_role;
select tests.throws(format($$select public.merchant_proposal_create(%L, 'offer_create', '{"kind": "percent", "percent": 10, "section_id": "58000000-0000-0000-0000-0000000000a2"}', 'rules', %L)$$,
  :'va', :'owner_a'), 'with items', 'an offer on an empty section is refused (it would read as the whole menu)');
select public.basket_add_item('10000000-0000-0000-0000-000000000002', '58000000-0000-0000-0000-000000000003', 2);
select public.basket_add_item('10000000-0000-0000-0000-000000000002', '58000000-0000-0000-0000-000000000001', 1);
select public.basket_set_checkout('10000000-0000-0000-0000-000000000002', 'pickup');
select public.basket_set_cash_currency('10000000-0000-0000-0000-000000000002', 'USD');
select public.basket_quote('10000000-0000-0000-0000-000000000002') as q1 \gset
select tests.ok((:'q1'::jsonb ->> 'offer_usd')::numeric = 1.50 and (:'q1'::jsonb ->> 'total_usd')::numeric = 13.50,
  '10% of $15 of sandwiches: $1.50 off a $15 basket');
select b.id as bid, b.priced_menu_version as ver from public.baskets b where b.customer_id = '10000000-0000-0000-0000-000000000002' and b.status = 'open' \gset
select public.order_place(:'bid', :'ver', 'test:copilot:o1') as o1 \gset
select tests.ok(:'o1'::jsonb ->> 'status' = 'placed', 'the order is placed');
select tests.ok((select quoted_offer_usd = 1.50 from public.baskets where id = :'bid'), 'the basket remembers the offer it was quoted');
select tests.ok((select offer_usd = 1.50 and discount_usd = 1.50 and total_usd = 13.50 and offer_id = (:'r8'::jsonb ->> 'offer_id')::uuid
                        and order_fee_usd = public.order_fee_usd(vendor_id, 13.50)
                 from public.orders where id = (:'o1'::jsonb ->> 'order_id')::uuid),
  'the order carries the offer in its discount, and the commission is on the food after the offer');
-- The commission stays on the food after the offer when the food changes later (a substitution, a weight).
reset role;
update public.orders set food_subtotal_usd = food_subtotal_usd + 3, total_usd = total_usd + 3 where id = (:'o1'::jsonb ->> 'order_id')::uuid;
select tests.ok((select order_fee_usd = public.order_fee_usd(vendor_id, food_subtotal_usd - offer_usd) from public.orders
                 where id = (:'o1'::jsonb ->> 'order_id')::uuid), 'a later change of the food keeps the commission after the offer');
set local role service_role;
-- An offer that changed between the summary and the Confirm tap (a happy hour ending) re-prices, never a surprise total.
select public.basket_add_item('10000000-0000-0000-0000-000000000002', '58000000-0000-0000-0000-000000000003', 1);
select public.basket_set_checkout('10000000-0000-0000-0000-000000000002', 'pickup');
select public.basket_set_cash_currency('10000000-0000-0000-0000-000000000002', 'USD');
select public.basket_quote('10000000-0000-0000-0000-000000000002');
select b.id as bid3, b.priced_menu_version as ver3 from public.baskets b where b.customer_id = '10000000-0000-0000-0000-000000000002' and b.status = 'open' \gset
reset role;
update public.baskets set quoted_offer_usd = 0, quoted_offer_id = null where id = :'bid3';
set local role service_role;
select tests.ok(public.order_place(:'bid3', :'ver3', 'test:copilot:o3') ->> 'status' = 'repriced', 'a different offer than the one shown is a new price');
reset role;
update public.baskets set status = 'abandoned' where id = :'bid3';
set local role service_role;
select public.merchant_proposal_create(:'va', 'offer_stop', '{}', 'rules', :'owner_a') as p9 \gset
select tests.ok((public.merchant_proposal_decide(:'p9', true, :'owner_a') ->> 'stopped')::int = 1, 'stop the offer');

-- 4. Minimum order, radius, hours and closures ---------------------------------------------------------------------------
select public.merchant_proposal_create(:'va', 'min_order', '{"usd": 20}', 'rules', :'owner_a') as p10 \gset
select public.merchant_proposal_decide(:'p10', true, :'owner_a');
select public.basket_add_item('10000000-0000-0000-0000-000000000002', '58000000-0000-0000-0000-000000000003', 1);
select public.basket_set_checkout('10000000-0000-0000-0000-000000000002', 'pickup');
select public.basket_quote('10000000-0000-0000-0000-000000000002') as q2 \gset
select tests.ok(:'q2'::jsonb ->> 'status' = 'below_minimum' and (:'q2'::jsonb ->> 'missing_usd')::numeric = 14,
  'under the minimum: the quote says how much is missing');
select b.id as bid2, b.priced_menu_version as ver2 from public.baskets b where b.customer_id = '10000000-0000-0000-0000-000000000002' and b.status = 'open' \gset
select tests.ok(public.order_place(:'bid2', :'ver2', 'test:copilot:o2') ->> 'status' = 'below_minimum', 'and order_place refuses it');
select public.merchant_proposal_create(:'va', 'min_order', '{"usd": null}', 'rules', :'owner_a') as p11 \gset
select public.merchant_proposal_decide(:'p11', true, :'owner_a');
select tests.ok(public.basket_quote('10000000-0000-0000-0000-000000000002') ->> 'status' = 'ok', '"no minimum" removes it');
select tests.throws(format($$select public.merchant_proposal_create(%L, 'radius', '{"km": 50}', 'rules', %L)$$, :'va', :'owner_a'),
  'delivery radius', 'the radius stays within the delivery area');
select public.merchant_proposal_create(:'va', 'radius', '{"km": 3}', 'rules', :'owner_a') as p12 \gset
select public.merchant_proposal_decide(:'p12', true, :'owner_a');
reset role;
select tests.ok((select delivery_radius_km = 3 from public.vendors where id = :'va'), 'own-delivery radius 3 km');
set local role service_role;
select public.merchant_proposal_create(:'va', 'hours_set', '{"weekdays": [0], "closed": true}', 'rules', :'owner_a') as p13 \gset
select public.merchant_proposal_decide(:'p13', true, :'owner_a');
reset role;
select tests.ok((select count(*) = 6 from public.vendor_hours where vendor_id = :'va')
  and not exists (select 1 from public.vendor_hours where vendor_id = :'va' and weekday = 0),
  'closed every Sunday: a shop without hours stays open all day on the other six');
set local role service_role;
select public.merchant_proposal_create(:'va', 'closure', jsonb_build_object('day', (now() at time zone 'Asia/Beirut')::date), 'rules', :'owner_a') as p14 \gset
select public.merchant_proposal_decide(:'p14', true, :'owner_a');
reset role;
select tests.ok(not app_private.vendor_open_at(:'va'), 'a closure day is closed whatever the hours say');
set local role service_role;
select tests.throws(format($$select public.merchant_proposal_create(%L, 'closure', '{"day": "2020-01-01"}', 'rules', %L)$$, :'va', :'owner_a'),
  'next 60 days', 'no closure in the past');

-- 5. Boost: recorded, never charged (§20.4, session 12) -------------------------------------------------------------------
select public.merchant_proposal_create(:'va', 'boost_start', '{"budget_usd": 20, "audience": "nearby"}', 'rules', :'owner_a') as p15 \gset
select tests.ok(public.merchant_proposal_decide(:'p15', true, :'owner_a') ->> 'status' = 'waiting', 'a Boost budget waits for the ad system');
select tests.ok(not exists (select 1 from public.ledger_transactions t where t.kind = 'sponsored_charge'), 'nothing is charged');

-- 6. Reports, staff, memory and suggestions ---------------------------------------------------------------------------------
select public.merchant_report(:'va', :'owner_a', 'day') as rep \gset
select tests.ok((:'rep'::jsonb ->> 'orders')::int >= 1 and (:'rep'::jsonb ->> 'offers_usd') is not null, 'the day report counts the orders');
select tests.throws(format('select public.merchant_report(%L, %L)', :'va', :'cashier_a'), 'not allowed', 'reports are for the owner and managers');
select tests.ok(jsonb_array_length(public.vendor_staff_list(:'va', :'owner_a')) >= 2, 'the owner sees the staff');
select public.merchant_fact_writes_in(:'va', 'arabizi');
reset role;
select app_private.merchant_facts_refresh(:'va');
set local role service_role;
select tests.ok(public.merchant_memory(:'va', :'owner_a') #>> '{facts,writes_in,value}' = 'arabizi'
  and (public.merchant_memory(:'va', :'owner_a') -> 'facts') ? 'recent_changes', 'merchant memory: how they write and the last changes');
reset role;
update public.vendor_private set owner_mobile = '+96171000001' where vendor_id = :'va';
select tests.ok(app_private.merchant_suggest(:'va', 'test0', 'availability_off',
  '{"scope": "station", "target": "grill", "until": null}', 'grill?') is null, 'no card outside the owner''s 24-hour WhatsApp window');
insert into app_private.whatsapp_last_inbound (phone_e164, at) values ('+96171000001', now())
  on conflict (phone_e164) do update set at = excluded.at;
select app_private.merchant_suggest(:'va', 'test', 'availability_off',
  '{"scope": "station", "target": "grill", "until": null}', 'grill?') as sg \gset
select tests.ok(:'sg' <> '' and exists (select 1 from public.outbound_messages where purpose = 'proposal' and payload ->> 'proposal_id' = :'sg'),
  'a suggestion is a proposal card to the owner');
select tests.ok(app_private.merchant_suggest(:'va', 'test', 'availability_off',
  '{"scope": "station", "target": "grill", "until": null}', 'grill?') is null, 'once a day per kind');
select tests.ok((select status = 'proposed' and member_id is null from public.merchant_proposals where id = :'sg'),
  'nothing changes until a member taps');
select tests.ok((select available from public.menu_items where id = '58000000-0000-0000-0000-000000000003'), '…the grill item is still on');

-- 7. Grants ----------------------------------------------------------------------------------------------------------------
select tests.ok(not exists (
  select 1 from (values ('public.merchant_menu_parts(uuid,uuid)'), ('public.merchant_report(uuid,uuid,text)'), ('public.merchant_memory(uuid,uuid)'),
    ('public.vendor_staff_list(uuid,uuid)'), ('public.merchant_fact_writes_in(uuid,text)')) f(sig)
  where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'the copilot''s readers are for the service role only');

rollback;
