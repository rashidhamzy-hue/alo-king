-- Session 5f part 7: the chat after the native cart and at checkout (CUSTOMER-EXPERIENCE #25, #26, #35, #38, DECISIONS
-- §20.3, §27.8 #17-18, §29.3, §39.15.2). Choices and add-ons priced by the server and offered once; notes up to 80
-- characters that never change a price and reach the order; change for cash from the configured notes only, carried to
-- the order and the card; tips from the configured amounts only (or "Other" up to the max), one balanced 'tip' ledger
-- transaction to whoever delivered; "Popular near you" and "Goes well with"; access.
begin;

-- Fixtures ------------------------------------------------------------------------------------------------------------
insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-P7', 'CHF', 'Tiptown', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-TIPTOWN', 'TZ-P7', 'تيبتاون', 'Tiptown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test');
select public.place_set_service_status('LB-CHF-TIPTOWN', 'on', 'test: in the delivery area');
update public.vendors set live_since = now() - interval '40 days', name_ar = 'مطعم أ'
where id = '20000000-0000-0000-0000-00000000000a';
insert into public.menu_items (id, vendor_id, name_ar, name_en, price_usd) values
  ('7f000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'برغر', 'Burger', 8.00),
  ('7f000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'بطاطا', 'Fries', 3.00),
  ('7f000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'كولا', 'Cola', 1.00);
insert into public.menu_option_groups (id, item_id, name_en, min_select, max_select, sort_order) values
  ('7f000000-0000-0000-0000-0000000000a1', '7f000000-0000-0000-0000-000000000001', 'Size', 1, 1, 1),
  ('7f000000-0000-0000-0000-0000000000a2', '7f000000-0000-0000-0000-000000000001', 'Extras', 0, 2, 2);
insert into public.menu_options (id, group_id, name_en, price_delta_usd, sort_order) values
  ('7f000000-0000-0000-0000-0000000000b1', '7f000000-0000-0000-0000-0000000000a1', 'Regular', 0, 1),
  ('7f000000-0000-0000-0000-0000000000b2', '7f000000-0000-0000-0000-0000000000a1', 'Large', 1.50, 2),
  ('7f000000-0000-0000-0000-0000000000b3', '7f000000-0000-0000-0000-0000000000a2', 'Cheese', 0.75, 1),
  ('7f000000-0000-0000-0000-0000000000b4', '7f000000-0000-0000-0000-0000000000a2', 'Bacon', 1.00, 2),
  ('7f000000-0000-0000-0000-0000000000b5', '7f000000-0000-0000-0000-0000000000a2', 'Pickles', 0, 3);
-- The merchant's WhatsApp channel (merchant mode) hears about tips; its owner (+96171000001) and cashier are members.
update public.vendor_private set kitchen_whatsapp = '+96171000001' where vendor_id = '20000000-0000-0000-0000-00000000000a';
insert into public.customers (id, phone_e164, display_name) values
  ('7f000000-0000-0000-0000-0000000000c1', '+96176700001', 'Maya'),
  ('7f000000-0000-0000-0000-0000000000c2', '+96176700002', 'Other');

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set maya '7f000000-0000-0000-0000-0000000000c1'
\set other '7f000000-0000-0000-0000-0000000000c2'
\set burger '7f000000-0000-0000-0000-000000000001'
\set large '7f000000-0000-0000-0000-0000000000b2'
\set cheese '7f000000-0000-0000-0000-0000000000b3'
\set bacon '7f000000-0000-0000-0000-0000000000b4'
\set pickles '7f000000-0000-0000-0000-0000000000b5'

-- 1. Config ---------------------------------------------------------------------------------------------------------------
reset role;
select tests.ok(app_private.config_amounts('tip_amounts_usd') = '{1,2,3}'::numeric[]
  and app_private.config_amounts('cash_change_options_usd') = '{20,50,100}'::numeric[]
  and app_private.config_amounts('cash_change_options_lbp') = '{1000000,2000000,5000000}'::numeric[]
  and public.config_numeric('item_note_max_chars') = 80 and public.config_numeric('tip_max_usd') = 10,
  'tips, change notes and the note length are dated config, never code');
select tests.ok(public.config_value('carousel_enabled') = 'false'::jsonb, 'the product carousel is off until it is verified on the US number');
select tests.ok(app_private.config_amounts('no_such_key') = '{}'::numeric[], 'a missing list is empty');
set local role service_role;

-- 2. Choices and add-ons (#25) ------------------------------------------------------------------------------------------------
select public.item_choice_groups(:'burger') as g \gset
select tests.ok(:'g'::jsonb ->> 'name_en' = 'Burger' and jsonb_array_length(:'g'::jsonb -> 'groups') = 2
  and (:'g'::jsonb #>> '{groups,0,min}')::int = 1 and :'g'::jsonb #>> '{groups,1,name_en}' = 'Extras'
  and (:'g'::jsonb #>> '{groups,0,options,1,price_delta_usd}')::numeric = 1.50,
  'an item''s choice groups come with its name and the server''s option prices');
update public.menu_options set available = false where id = :'pickles';
select tests.ok(jsonb_array_length(public.item_choice_groups(:'burger') #> '{groups,1,options}') = 2, 'an unavailable option is not offered');
update public.menu_options set available = true where id = :'pickles';

select public.address_save_pin(:'maya', 33.6821, 35.5861) as pin \gset
select public.route_cache_store(33.68, 35.58, array[33.6821], array[35.5861], array[2400], array[300], 'ors');
select public.basket_add_item(:'maya', :'burger', 1, array[:'large']::uuid[]) as add1 \gset
select (:'add1'::jsonb ->> 'line_id') as line1 \gset
select tests.ok((public.basket_view(:'maya') #>> '{lines,0,line_total_usd}')::numeric = 9.50, 'Large is priced by the server: $8 + $1.50');
select tests.ok(public.basket_lines_with_extras(:'maya', array[:'burger']::uuid[]) -> 0 ->> 'line_id' = :'line1',
  'a line with add-ons still to offer is found by its item');
select public.basket_line_extras(:'maya', :'line1') as ex \gset
select tests.ok(:'ex'::jsonb ->> 'status' = 'offer' and jsonb_array_length(:'ex'::jsonb -> 'groups') = 1
  and (:'ex'::jsonb #>> '{groups,0,room}')::int = 2 and jsonb_array_length(:'ex'::jsonb #> '{groups,0,options}') = 3
  and :'ex'::jsonb ->> 'item_en' = 'Burger', 'the add-ons are offered with how many may be chosen');
select tests.ok(public.basket_line_extras(:'maya', :'line1') ->> 'status' = 'offered', 'and never offered twice for the same line');
select tests.ok(public.basket_lines_with_extras(:'maya', array[:'burger']::uuid[]) = '[]'::jsonb, 'nor listed again');
select tests.ok(public.basket_line_extras(:'other', :'line1') ->> 'status' = 'not_found', 'another customer cannot read the line');
select public.basket_line_add_options(:'maya', :'line1', array[:'cheese']::uuid[]) as a1 \gset
select tests.ok(:'a1'::jsonb ->> 'status' = 'added' and (:'a1'::jsonb #>> '{basket,lines,0,line_total_usd}')::numeric = 10.25
  and jsonb_array_length(:'a1'::jsonb #> '{extras,0,options}') = 2, 'Cheese is added at the server''s price ($0.75) and the rest can still be added');
select tests.ok(public.basket_line_add_options(:'maya', :'line1', array[:'large']::uuid[]) ->> 'status' = 'invalid_option',
  'a required choice is never added as an add-on');
select tests.ok(public.basket_line_add_options(:'maya', :'line1', array['00000000-0000-0000-0000-000000000000']::uuid[]) ->> 'status' = 'invalid_option',
  'an option of no group of this item is refused');
select tests.ok(public.basket_line_add_options(:'maya', :'line1', array[:'bacon', :'pickles']::uuid[]) ->> 'status' = 'group_full',
  'no group goes above its maximum');
select tests.ok(public.basket_line_add_options(:'other', :'line1', array[:'bacon']::uuid[]) ->> 'status' = 'not_found',
  'another customer cannot change the line');
select tests.ok(public.basket_line_add_options(:'maya', :'line1', array[:'cheese']::uuid[]) ->> 'status' = 'added'
  and (public.basket_view(:'maya') #>> '{lines,0,line_total_usd}')::numeric = 10.25, 'the same add-on again (a replayed turn) changes nothing');

-- 3. Notes (#26) --------------------------------------------------------------------------------------------------------------
select tests.ok(public.basket_line_note(:'maya', :'line1', repeat('x', 81)) ->> 'status' = 'too_long', 'a note of 81 characters is refused');
select tests.ok(public.basket_line_note(:'maya', :'line1', repeat('x', 81)) ->> 'max' = '80', '…saying the limit');
select tests.ok(public.basket_line_note(:'maya', :'line1', repeat('ب', 80)) ->> 'status' = 'saved', '80 characters are fine, in any script');
select public.basket_line_note(:'maya', :'line1', E'  no onions,\nextra   spicy ') as n1 \gset
select tests.ok(:'n1'::jsonb ->> 'note' = 'no onions, extra   spicy' and :'n1'::jsonb #>> '{basket,lines,0,note}' = 'no onions, extra   spicy',
  'the note is trimmed, a line break becomes a space, and the basket shows it');
select tests.ok((public.basket_view(:'maya') #>> '{lines,0,line_total_usd}')::numeric = 10.25, 'a note never changes the price');
select tests.ok(public.basket_line_note(:'other', :'line1', 'mine') ->> 'status' = 'not_found', 'another customer cannot write the note');
-- The AI's note (basket_add_item) follows the same rule: cleaned, then cut to the configured length.
select public.basket_add_item(:'maya', '7f000000-0000-0000-0000-000000000003', 1, '{}', E'  very cold\tplease\n' || repeat('z', 120)) as aiadd \gset
select tests.ok((select note = left('very cold please ' || repeat('z', 120), 80) and char_length(note) = 80
                 from public.basket_items where id = (:'aiadd'::jsonb ->> 'line_id')::uuid),
  'a note from the AI is cleaned and cut to item_note_max_chars, like a typed one');
select tests.ok((public.basket_add_item(:'maya', '7f000000-0000-0000-0000-000000000003', 1, '{}', E'very cold\tplease\n' || repeat('z', 120)) ->> 'line_id')
  = :'aiadd'::jsonb ->> 'line_id', 'the same note again adds to the same line');
select public.basket_set_quantity(:'maya', (:'aiadd'::jsonb ->> 'line_id')::uuid, 0);

-- 4. Change for cash (#35) and the tip at checkout (#38) --------------------------------------------------------------------
select (:'pin'::jsonb #>> '{address,address_id}') as a1 \gset
select public.address_set_for_whom(:'maya', :'a1', 'self', true);
select tests.ok(public.basket_address_state(:'maya') ->> 'status' = 'ok', 'the address is settled');
select tests.ok(public.basket_checkout_extras(:'maya') -> 'change' = 'null'::jsonb, 'no change question before the cash currency');
select public.basket_set_cash_currency(:'maya', 'USD');
select public.basket_checkout_extras(:'maya') as e1 \gset
select tests.ok(:'e1'::jsonb ->> 'status' = 'ok' and (:'e1'::jsonb ->> 'total_usd')::numeric = 12.25
  and :'e1'::jsonb #>> '{change,status}' = 'ask' and :'e1'::jsonb #> '{change,options}' = '[20, 50, 100]'::jsonb
  and :'e1'::jsonb -> 'tip_amounts' = '[1, 2, 3]'::jsonb and (:'e1'::jsonb ->> 'tip_usd')::numeric = 0,
  'after USD: "Do you need change?" with the configured notes above the $12.25 total, and the tip row (default none)');
select tests.ok(public.basket_set_cash_change(:'maya', 'USD', 30) ->> 'status' = 'not_allowed', 'a note amount not in config is refused');
select tests.ok(public.basket_set_cash_change(:'maya', 'LBP', 2000000) ->> 'status' = 'stale', 'an answer for the other currency is stale');
select tests.ok(public.basket_set_tip(:'maya', 5) ->> 'status' = 'not_allowed', 'a tip amount not in config is refused');
select tests.ok(public.basket_set_tip(:'maya', 2) ->> 'status' = 'ok', 'a configured tip is kept on the basket');
select tests.ok(public.basket_set_cash_change(:'maya', 'USD', 20) ->> 'status' = 'ok', 'a configured note is kept');
select public.basket_checkout_extras(:'maya') as e2 \gset
select tests.ok((:'e2'::jsonb ->> 'tip_usd')::numeric = 2 and (:'e2'::jsonb ->> 'total_usd')::numeric = 14.25
  and (:'e2'::jsonb ->> 'total_lbp')::numeric = round(14.25 * (:'e2'::jsonb ->> 'usd_lbp_rate')::numeric, 0),
  'the tip is its own amount, and the total with it is shown in USD and LBP at the rate');
select tests.ok(:'e2'::jsonb #>> '{change,status}' = 'set' and (:'e2'::jsonb #>> '{change,change_for}')::numeric = 20
  and (:'e2'::jsonb #>> '{change,change_due}')::numeric = 5.75, 'paying with $20 for $14.25 brings $5.75 change');
select public.basket_quote(:'maya') as q1 \gset
select tests.ok((:'q1'::jsonb ->> 'total_usd')::numeric = 12.25, 'the order total itself never includes the tip');
select tests.ok(public.basket_checkout_extras(:'maya', 12.25, (:'q1'::jsonb ->> 'usd_lbp_rate')::numeric) = :'e2'::jsonb,
  'given the quote checkout just made, the same answer without quoting again');
-- The answer is asked again once it no longer covers the total (Large burgers x 2: $22.50 > $20).
select public.basket_set_quantity(:'maya', :'line1', 2);
select tests.ok(public.basket_checkout_extras(:'maya') #>> '{change,status}' = 'ask'
  and public.basket_checkout_extras(:'maya') #> '{change,options}' = '[50, 100]'::jsonb, 'a note below the new total is asked again');
select public.basket_set_quantity(:'maya', :'line1', 1);
select tests.ok(public.basket_checkout_extras(:'maya') #>> '{change,status}' = 'set', 'and stands again when it covers it');
-- LBP: the same question in lira, with the configured LBP amounts above the total in LBP.
select public.basket_set_cash_currency(:'maya', 'LBP');
select public.basket_checkout_extras(:'maya') as e3 \gset
select tests.ok(:'e3'::jsonb #>> '{change,status}' = 'ask' and :'e3'::jsonb #>> '{change,currency}' = 'LBP'
  and :'e3'::jsonb #> '{change,options}' = '[2000000, 5000000]'::jsonb, 'cash in LBP asks with the LBP amounts above 14.25 x the rate');
select public.basket_set_cash_currency(:'maya', 'USD');
select tests.ok(public.basket_checkout_extras(:'maya') #>> '{change,status}' = 'set', 'back to USD, the USD answer stands');

-- 5. The order carries the note, the tip and the change; the card shows them ------------------------------------------------
select public.basket_quote(:'maya') as q2 \gset
select b.id as bid, b.priced_menu_version as ver from public.baskets b where b.customer_id = :'maya' and b.status = 'open' \gset
select public.order_place(:'bid', :'ver', 'test:p7:o1') as o1 \gset
select tests.ok(:'o1'::jsonb ->> 'status' = 'placed', 'the order is placed');
select (:'o1'::jsonb ->> 'order_id') as oid1 \gset
select tests.ok((select tip_usd = 2 and tip_source = 'checkout' and total_usd = 12.25 and cash_currency = 'USD'
                 and cash_change_for = 20 and cash_change_currency = 'USD' from public.orders where id = :'oid1'),
  'the order has the $2 tip as its own amount, the $12.25 total and change for $20');
select tests.ok((select note = 'no onions, extra   spicy' and line_total_usd = 10.25 from public.order_items where order_id = :'oid1'),
  'the note reaches the order line, at the server''s price');
select public.order_call_card(:'oid1') as card \gset
select tests.ok(:'card'::jsonb #>> '{items,0,note}' = 'no onions, extra   spicy' and (:'card'::jsonb ->> 'tip_usd')::numeric = 2
  and (:'card'::jsonb ->> 'collect_usd')::numeric = 14.25
  and (:'card'::jsonb ->> 'collect_lbp')::numeric = round(14.25 * (:'card'::jsonb ->> 'usd_lbp_rate')::numeric, 0)
  and (:'card'::jsonb ->> 'cash_change_for')::numeric = 20 and (:'card'::jsonb ->> 'change_due')::numeric = 5.75,
  'the merchant''s and the driver''s card show the note, the tip, what to collect in both currencies and the change to bring');
select tests.ok(not exists (select 1 from public.ledger_transactions where idempotency_key = 'tip:' || :'oid1')
  and (select tip_status = 'promised' from public.orders where id = :'oid1'),
  'a checkout tip is promised; nothing is booked before the order is delivered');
reset role;
update public.orders set status = 'accepted' where id = :'oid1';
update public.orders set status = 'ready' where id = :'oid1';
update public.orders set status = 'picked_up' where id = :'oid1';
update public.orders set delivery_code_confirmed_at = now() where id = :'oid1';
update public.orders set status = 'delivered', delivered_at = now() where id = :'oid1';
set local role service_role;
select tests.ok(not exists (select 1 from public.ledger_transactions where kind = 'tip' and order_id = :'oid1'),
  'delivered: still no tip transaction (the delivered tap records no cash)');
select tests.ok((select count(*) = 1 and bool_and(m.target = '+96171000001' and m.payload ->> 'tip_usd' = '2.00'
                 and m.payload ->> 'source' = 'checkout') from public.outbound_messages m
                 where m.order_id = :'oid1' and m.purpose = 'tip'),
  'whoever delivered (the merchant''s WhatsApp, merchant mode) is asked to confirm the $2 tip, once');
select tests.ok(public.order_tip_confirm(:'oid1', '+96171000003') ->> 'status' = 'not_allowed'
  and public.order_tip_confirm(:'oid1', '+96170000999') ->> 'status' = 'not_allowed',
  'a member of another shop, or a stranger, cannot confirm it');
select tests.ok(not exists (select 1 from public.ledger_transactions where kind = 'tip' and order_id = :'oid1'),
  'and nothing is booked by them');
select public.order_tip_confirm(:'oid1', '+96171000001') as cf1 \gset
select tests.ok(:'cf1'::jsonb ->> 'status' = 'collected' and (select tip_status = 'collected' and tip_collected_by is not null
  from public.orders where id = :'oid1'), 'the shop''s "Got it" confirms it');
select tests.ok(public.order_tip_confirm(:'oid1', '+96171000002') ->> 'status' = 'already', 'a replayed or second confirm is told it is done');
select tests.ok((select count(*) = 4 and sum(e.amount) = 0 and sum(e.amount_usd) filter (where e.amount > 0) = 4
                 and bool_and(t.kind = 'tip' and t.order_id = :'oid1')
                 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                 where t.order_id = :'oid1' and t.kind = 'tip'),
  'confirmed: one balanced tip transaction, booked once (received, owed in full, kept)');
select tests.ok((select bool_and(a.external_ref = 'vendor:20000000-0000-0000-0000-00000000000a')
                 from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
                 join public.ledger_transactions t on t.id = e.transaction_id where t.idempotency_key = 'tip:' || :'oid1')
  and (select balance = 0 from public.ledger_account_balances b where b.kind = 'tips_payable'
       and b.external_ref = 'vendor:20000000-0000-0000-0000-00000000000a'),
  'it goes 100% to whoever delivered (here the merchant, merchant mode) and leaves no balance open');
select tests.ok(public.order_tip_offer(:'maya', :'oid1') ->> 'status' = 'tipped', 'an order tipped at checkout is not asked again after delivery');
select tests.ok(public.order_tip_set(:'maya', :'oid1', 1) ->> 'status' = 'already_tipped', 'nor tipped twice');

-- 6. The tip after delivery (#38) ------------------------------------------------------------------------------------------
select public.basket_add_item(:'maya', '7f000000-0000-0000-0000-000000000002', 2) as add2 \gset
select public.basket_add_item(:'maya', :'burger', 1, array['7f000000-0000-0000-0000-0000000000b1']::uuid[]);
select public.basket_confirm_address(:'maya', :'a1');
select public.basket_set_cash_currency(:'maya', 'USD');
select tests.ok(public.basket_set_cash_change(:'maya', 'USD', null) ->> 'status' = 'ok', 'Exact is an answer too');
select public.basket_quote(:'maya') as q3 \gset
select b.id as bid2, b.priced_menu_version as ver2 from public.baskets b where b.customer_id = :'maya' and b.status = 'open' \gset
select public.order_place(:'bid2', :'ver2', 'test:p7:o2') as o2 \gset
select (:'o2'::jsonb ->> 'order_id') as oid2 \gset
select tests.ok((select tip_usd = 0 and tip_source is null and cash_change_currency = 'USD' and cash_change_for is null
                 from public.orders where id = :'oid2'), 'no tip chosen: none; Exact: the currency with no note amount');
select tests.ok(public.order_tip_offer(:'maya', :'oid2') ->> 'status' = 'not_applicable', 'no tip before the order is delivered');
reset role;
update public.orders set status = 'accepted' where id = :'oid2';
update public.orders set status = 'picked_up' where id = :'oid2';
update public.orders set delivery_code_confirmed_at = now() where id = :'oid2';
update public.orders set status = 'delivered', delivered_at = now() - interval '3 hours' where id = :'oid2';
set local role service_role;
select tests.ok(not exists (select 1 from public.ledger_transactions where idempotency_key = 'tip:' || :'oid2')
  and not exists (select 1 from public.outbound_messages where order_id = :'oid2' and purpose = 'tip'),
  'no tip: no ledger entry and nobody to tell');
select tests.ok(public.order_tip_confirm(:'oid2', '+96171000001') ->> 'status' = 'no_tip', 'nothing to confirm without a tip');
select tests.ok(public.order_tip_offer(:'maya', :'oid2') ->> 'status' = 'too_late', 'after tip_after_delivery_minutes the tip is not asked');
reset role;
update public.orders set delivered_at = now() - interval '5 minutes' where id = :'oid2';
set local role service_role;
select tests.ok(public.order_tip_offer(:'other', :'oid2') ->> 'status' = 'not_found', 'only the order''s customer is asked');
select public.order_tip_offer(:'maya', :'oid2') as t1 \gset
select tests.ok(:'t1'::jsonb ->> 'status' = 'offer' and :'t1'::jsonb -> 'amounts' = '[1, 2, 3]'::jsonb
  and (:'t1'::jsonb ->> 'max_usd')::numeric = 10, 'after delivery: the configured amounts and Other up to the max');
select tests.ok(public.order_tip_offer(:'maya', :'oid2') ->> 'status' = 'offered', 'asked once per order');
select tests.ok(public.order_tip_offer(:'maya', :'oid2', false) ->> 'status' = 'offer', 'while a tap can still answer it');
select tests.ok(public.order_tip_set(:'maya', :'oid2', 7) ->> 'status' = 'not_allowed', 'an amount that is not a button is refused');
select tests.ok(public.order_tip_set(:'maya', :'oid2', 11, true) ->> 'status' = 'not_allowed', '"Other" above tip_max_usd is refused');
select tests.ok(public.order_tip_set(:'maya', :'oid2', 0, true) ->> 'status' = 'not_allowed'
  and public.order_tip_set(:'maya', :'oid2', 1.005, true) ->> 'status' = 'not_allowed', 'zero and fractions of a cent are refused');
select tests.ok(public.order_tip_set(:'other', :'oid2', 2) ->> 'status' = 'not_found', 'another customer cannot tip on this order');
select public.order_tip_set(:'maya', :'oid2', 4.5, true) as t2 \gset
select tests.ok(:'t2'::jsonb ->> 'status' = 'promised' and :'t2'::jsonb -> 'told' = 'true'::jsonb
  and (select tip_usd = 4.5 and tip_source = 'after_delivery' and tip_status = 'promised' from public.orders where id = :'oid2'),
  '"Other" $4.50 is promised on the order, and whoever delivered is told');
select tests.ok(not exists (select 1 from public.ledger_transactions where kind = 'tip' and order_id = :'oid2'),
  'the customer''s word alone books nothing');
select tests.ok((select count(*) = 1 from public.outbound_messages where order_id = :'oid2' and purpose = 'tip'
                 and payload ->> 'source' = 'after_delivery'), 'one "Got it" card');
select tests.ok(public.order_tip_confirm(:'oid2', '+96171000002') ->> 'status' = 'collected', 'the cashier confirms it');
select tests.ok((select count(*) = 4 and sum(e.amount) = 0 and max(e.amount_usd) = 4.5 and min(e.usd_lbp_rate) = max(o.usd_lbp_rate)
                 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                 join public.orders o on o.id = t.order_id
                 where t.idempotency_key = 'tip:' || :'oid2' and t.kind = 'tip'),
  'then it is booked, at the order''s locked rate');
select tests.ok(public.order_tip_confirm(:'oid2', '+96171000002') ->> 'status' = 'already'
  and (select count(*) = 1 from public.ledger_transactions where kind = 'tip' and order_id = :'oid2'), 'a replayed confirm books once');
select tests.ok(public.order_tip_set(:'maya', :'oid2', 1) ->> 'status' = 'already_tipped', 'one tip per order');
reset role;
select tests.throws($$update public.ledger_entries set amount = 1 where transaction_id = (select id from public.ledger_transactions where kind = 'tip' limit 1)$$,
  'append-only|not allowed|forbid|cannot', 'a tip entry is never edited');
set local role service_role;

-- 7. A pickup or a gift takes no tip and no change question ---------------------------------------------------------------
select public.basket_add_item(:'maya', '7f000000-0000-0000-0000-000000000003', 1);
select public.basket_set_checkout(:'maya', 'pickup', null, null, null);
select public.basket_set_cash_currency(:'maya', 'USD');
select tests.ok(public.basket_set_tip(:'maya', 1) ->> 'status' = 'not_applicable', 'pickup: nobody delivers, no tip');
select tests.ok(public.basket_set_cash_change(:'maya', 'USD', 20) ->> 'status' = 'not_applicable', 'pickup: no change question');
select public.basket_checkout_extras(:'maya') as e4 \gset
select tests.ok(:'e4'::jsonb -> 'change' = 'null'::jsonb and :'e4'::jsonb -> 'tip_amounts' = '[]'::jsonb, 'nothing is offered at a pickup checkout');

-- 8. "Goes well with" and "Popular near you" (§29.3, §39.15.2) -----------------------------------------------------------------
-- A second delivered order with fries and a burger (the first such was order 2).
select public.basket_set_checkout(:'maya', 'delivery', :'a1', null, null);
select public.basket_add_item(:'maya', '7f000000-0000-0000-0000-000000000002', 1);
select public.basket_add_item(:'maya', :'burger', 1, array[:'large']::uuid[]);
select public.basket_quote(:'maya') as q4 \gset
select b.id as bid3, b.priced_menu_version as ver3 from public.baskets b where b.customer_id = :'maya' and b.status = 'open' \gset
select public.order_place(:'bid3', :'ver3', 'test:p7:o3') as o3 \gset
select tests.ok(:'o3'::jsonb ->> 'status' = 'placed', 'a third order is placed');
select (:'o3'::jsonb ->> 'order_id') as oid3 \gset
reset role;
update public.orders set status = 'accepted' where id = :'oid3';
update public.orders set status = 'picked_up' where id = :'oid3';
update public.orders set delivery_code_confirmed_at = now() where id = :'oid3';
update public.orders set status = 'delivered' where id = :'oid3';
set local role service_role;
select public.basket_add_item(:'maya', :'burger', 1, array[:'large']::uuid[]);
select public.basket_goes_well(:'maya', 'sim') as gw \gset
select tests.ok(:'gw'::jsonb ->> 'status' = 'ok' and :'gw'::jsonb #>> '{products,0,retailer_id}' = '7f000000-0000-0000-0000-000000000002'
  and (:'gw'::jsonb #>> '{products,0,price_usd}')::numeric = 3.00 and :'gw'::jsonb -> 'carousel' = 'false'::jsonb,
  'fries were bought with the burger in two delivered orders: they go well with it, at the server''s price, carousel off');
select tests.ok(public.basket_goes_well(:'maya', 'sim') ->> 'status' = 'none' and public.basket_upsell(:'maya') is null,
  'one suggestion per order: neither offers it again');
select tests.ok(public.basket_goes_well(:'maya', 'no-such-catalogue') ->> 'status' = 'none', 'only items the catalogue shows');
reset role;
update public.baskets set upsell_shown_at = null, source = 'reorder' where customer_id = :'maya' and status = 'open';
set local role service_role;
select tests.ok(public.basket_goes_well(:'maya', 'sim') ->> 'status' = 'none', 'never on a reorder');
select public.popular_near_you(array['20000000-0000-0000-0000-00000000000a']::uuid[], 'sim') as pop \gset
select tests.ok(jsonb_array_length(:'pop'::jsonb -> 'products') = 1 and :'pop'::jsonb #>> '{products,0,section_en}' = 'Vendor A'
  and :'pop'::jsonb -> 'carousel' = 'false'::jsonb, 'Popular near you: each delivering shop''s best seller, named with its shop');
select tests.ok(public.popular_near_you(array['20000000-0000-0000-0000-00000000000a']::uuid[], 'no-such-catalogue') -> 'products' = '[]'::jsonb,
  'nothing the catalogue does not show');

-- 9. Access: the dispatch function only ---------------------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select public.order_tip_set('7f000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 1)$$, 'permission denied',
  'a signed-in user cannot set a tip');
select tests.throws($$select public.basket_set_tip('7f000000-0000-0000-0000-0000000000c1', 1)$$, 'permission denied', 'or a checkout tip');
select tests.throws($$select public.basket_line_note('7f000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'x')$$, 'permission denied',
  'or a note');
select tests.throws($$select public.basket_set_cash_change('7f000000-0000-0000-0000-0000000000c1', 'USD', 20)$$, 'permission denied',
  'or the change answer');
select tests.throws($$select public.order_tip_confirm(gen_random_uuid(), '+96171000001')$$, 'permission denied',
  'or confirm a tip (only the dispatch function, for the number a tap came from)');
reset role;
select tests.ok(not exists (
  select 1 from unnest(array['public.item_choice_groups(uuid)', 'public.basket_lines_with_extras(uuid, uuid[])',
    'public.basket_line_extras(uuid, uuid)', 'public.basket_line_add_options(uuid, uuid, uuid[])',
    'public.basket_line_note(uuid, uuid, text)', 'public.basket_checkout_extras(uuid, numeric, numeric)',
    'public.basket_set_cash_change(uuid, text, numeric)', 'public.basket_set_tip(uuid, numeric)',
    'public.order_tip_offer(uuid, uuid, boolean)', 'public.order_tip_set(uuid, uuid, numeric, boolean)',
    'public.order_tip_confirm(uuid, text)',
    'public.popular_near_you(uuid[], text, integer)', 'public.basket_goes_well(uuid, text)']) f
  where has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege('authenticated', f::regprocedure, 'execute')
     or not has_function_privilege('service_role', f::regprocedure, 'execute')),
  'every new function is for the service role only');

-- 10. Scale: the reads of "Popular near you" and "Goes well with" have their indexes.
select tests.ok(exists (select 1 from pg_indexes where indexname = 'orders_vendor_created_idx')
  and exists (select 1 from pg_indexes where indexname = 'order_items_item_idx'), 'orders by shop and date, order lines by item');

rollback;
