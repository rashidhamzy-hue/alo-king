-- Session 5: the merchant WhatsApp extras (§32.5): capacity, generator mode, staff, shift handover,
-- substitutions, the visual order card data and the same-price badge.
begin;

insert into public.menu_items (id, vendor_id, name_en, name_ar, price_usd, needs_power) values
  ('57000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'Pizza', 'بيتزا', 8.00, true),
  ('57000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'Fattoush', 'فتوش', 4.00, false),
  ('57000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'Pepsi', 'بيبسي', 1.00, false),
  ('57000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', '7up', 'سفن اب', 1.25, false),
  ('57000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-00000000000a', 'Fries', 'بطاطا', 3.00, true);
update public.menu_items set available = false where id = '57000000-0000-0000-0000-000000000005'; -- already sold out

create function pg_temp.new_order(p_key text) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.orders (code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method,
    menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at, prep_minutes)
  values (app_private.new_order_code(), 'tests:extras:' || p_key, '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-00000000000a', 'placed', 'pickup', 'cod', 1, 89500, 2, 2, 0.2, now(), 15)
  returning id into v_id;
  return v_id;
end;
$$;

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select id as owner_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'owner' \gset
select id as cashier_a from public.vendor_members where vendor_id = '20000000-0000-0000-0000-00000000000a' and role = 'cashier' \gset

-- Roles (§18.1 H) ------------------------------------------------------------------------------------------
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'staff_add',
  '{"name": "Ali", "role": "kitchen", "phone": "+9613123456"}', 'rules', '$$ || :'cashier_a' || $$')$$, 'not allowed',
  'only the owner adds staff');
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'capacity', '{"max": 5}', 'rules', '$$
  || :'cashier_a' || $$')$$, 'not allowed', 'a cashier does not set the kitchen capacity');
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'staff_add',
  '{"name": "Boss", "role": "owner", "phone": "+9613123456"}', 'rules', '$$ || :'owner_a' || $$')$$, 'staff needs',
  'owners are not added by message');

-- Generator mode ---------------------------------------------------------------------------------------------
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'power_off', '{}', 'rules', :'cashier_a') as p_off \gset
select tests.ok((public.merchant_proposal_decide(:'p_off', true, :'cashier_a') ->> 'hidden')::int = 1,
  'a power cut hides the available items that need power (a cashier may confirm it)');
reset role;
select tests.ok((select not available from public.menu_items where id = '57000000-0000-0000-0000-000000000001')
  and (select available from public.menu_items where id = '57000000-0000-0000-0000-000000000002'), 'only the items that need power are hidden');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'power_on', '{}', 'rules', :'owner_a') as p_on \gset
select tests.ok((public.merchant_proposal_decide(:'p_on', true, :'owner_a') ->> 'restored')::int = 1, 'power back restores what it hid');
reset role;
select tests.ok((select available from public.menu_items where id = '57000000-0000-0000-0000-000000000001')
  and (select not available from public.menu_items where id = '57000000-0000-0000-0000-000000000005'),
  'an item that was already sold out before the cut stays sold out');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Kitchen capacity: the fixture order TESTA2 is already in the queue ------------------------------------------
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'capacity', '{"max": 2}', 'rules', :'owner_a') as p_cap \gset
select public.merchant_proposal_decide(:'p_cap', true, :'owner_a');
reset role;
select pg_temp.new_order('c1') as o1 \gset
select tests.ok((select prep_minutes = 15 from public.orders where id = :'o1'), 'under the capacity the prep time is the vendor''s own');
select pg_temp.new_order('c2') as o2 \gset
select tests.ok((select prep_minutes = 20 from public.orders where id = :'o2'), 'at the capacity a new order''s prep time grows by one step');
select pg_temp.new_order('c3') as o3 \gset
select tests.ok((select prep_minutes = 25 from public.orders where id = :'o3'), 'and by one more step per order above it');
select tests.ok((select pause_reason = 'kitchen full (auto)' and paused_until > now() from public.vendors where id = '20000000-0000-0000-0000-00000000000a')
  and (select capacity_paused from public.vendor_ops where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'at twice the capacity new orders pause');
select tests.ok((select count(*) >= 1 from public.outbound_messages where purpose = 'reply' and target = '+96171000001'
  and payload ->> 'text' like '%Kitchen full%'), 'the owner is told the kitchen is full');
select tests.ok((select payload ->> 'kind' = 'kitchen_full' and (payload ->> 'queue')::int >= 4 and payload ->> 'max' = '2'
  and payload ->> 'shop' is not null from public.outbound_messages where purpose = 'reply' and target = '+96171000001'
  and payload ->> 'text' like '%Kitchen full%' order by id desc limit 1),
  'the kitchen-full reply carries what its template needs outside the 24-hour window (§32.5)');
-- "Open" while full: the merchant's choice holds until the queue drops below the limit.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'resume', '{}', 'rules', :'owner_a') as p_res \gset
select public.merchant_proposal_decide(:'p_res', true, :'owner_a');
reset role;
select pg_temp.new_order('c4') as o4 \gset
select tests.ok((select paused_until is null from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'after the merchant reopens a full kitchen, the next order does not pause it again');
update public.orders set status = 'rejected', reject_reason = 'busy' where id = :'o4';
update public.vendors set paused_until = now() + interval '2 hours', pause_reason = 'kitchen full (auto)' where id = '20000000-0000-0000-0000-00000000000a';
update public.vendor_ops set capacity_paused = true, capacity_override = false where vendor_id = '20000000-0000-0000-0000-00000000000a';
update public.orders set status = 'rejected', reject_reason = 'busy' where id in (:'o1', :'o2', :'o3');
select tests.ok((select paused_until is null from public.vendors where id = '20000000-0000-0000-0000-00000000000a')
  and (select not capacity_paused from public.vendor_ops where vendor_id = '20000000-0000-0000-0000-00000000000a'),
  'below the capacity the automatic pause lifts');
update public.vendors set paused_until = now() + interval '1 hour', pause_reason = 'merchant pause' where id = '20000000-0000-0000-0000-00000000000a';
update public.vendor_ops set capacity_paused = true where vendor_id = '20000000-0000-0000-0000-00000000000a';
update public.orders set status = 'accepted' where id = '30000000-0000-0000-0000-000000000001';
select tests.ok((select pause_reason = 'merchant pause' from public.vendors where id = '20000000-0000-0000-0000-00000000000a'),
  'the queue never lifts the merchant''s own pause');
update public.vendors set paused_until = null, pause_reason = null where id = '20000000-0000-0000-0000-00000000000a';
update public.vendor_ops set max_active_orders = null, capacity_paused = false where vendor_id = '20000000-0000-0000-0000-00000000000a';

-- Staff by WhatsApp ------------------------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'staff_add',
  '{"name": "Ali", "role": "kitchen", "phone": "+9613123456"}', 'rules', :'owner_a') as p_staff \gset
select public.merchant_proposal_decide(:'p_staff', true, :'owner_a');
select tests.ok((select count(*) = 1 from public.merchant_members_by_phone('+9613123456') m where m.role = 'kitchen'),
  'the new staff member is active with the role the owner gave');
reset role;
select tests.ok((select count(*) = 1 from public.outbound_messages where purpose = 'reply' and target = '+9613123456'),
  'the new staff member is told on the Merchant number');
select tests.ok((select payload ->> 'kind' = 'staff_welcome' and payload ->> 'role' = 'kitchen' and payload ->> 'shop' is not null
  from public.outbound_messages where purpose = 'reply' and target = '+9613123456'),
  'the welcome carries what its template needs: they have never written to us (§32.5)');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select member_id as ali from public.vendor_staff_find('20000000-0000-0000-0000-00000000000a', 'ali') limit 1 \gset
select tests.throws($$select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'staff_remove',
  '{"member_id": "$$ || :'owner_a' || $$"}', 'rules', '$$ || :'owner_a' || $$')$$, 'owner', 'an owner is not removed by message');

-- Shift handover ---------------------------------------------------------------------------------------------------
select tests.ok((select jsonb_array_length(h) = 1 and h -> 0 ->> 'role' = 'kitchen' and (h -> 0 ->> 'pending_count')::int >= 1
  and h -> 0 -> 'sold_out' ? 'بطاطا' from public.staff_shift_touch('+9613123456') h), 'the first message of a shift brings the handover');
select tests.ok(jsonb_array_length(public.staff_shift_touch('+9613123456')) = 0, 'the next message in the same shift does not');
select tests.ok(jsonb_array_length(public.staff_shift_touch('+96171000001')) = 0, 'the owner gets no handover');
reset role;
update app_private.member_shifts set last_seen_at = now() - interval '7 hours' where member_id = :'ali';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(jsonb_array_length(public.staff_shift_touch('+9613123456')) = 1, 'after a long gap a new shift starts');
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'staff_remove', jsonb_build_object('member_id', :'ali'), 'rules', :'owner_a') as p_rm \gset
select public.merchant_proposal_decide(:'p_rm', true, :'owner_a');
select tests.ok((select count(*) = 0 from public.merchant_members_by_phone('+9613123456')), 'a removed staff member stops being a member');

-- Substitutions ----------------------------------------------------------------------------------------------------
reset role;
update public.vendors set business_type = 'minimarket' where id = '20000000-0000-0000-0000-00000000000a';
insert into public.baskets (id, customer_id, vendor_id, fulfilment) values
  ('58000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'pickup');
insert into public.basket_items (basket_id, item_id, quantity, unit_price_usd, line_total_usd) values
  ('58000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000003', 2, 1, 2);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((public.basket_substitution_needed('10000000-0000-0000-0000-000000000001') ->> 'needed')::boolean,
  'checkout at a grocery-type shop asks the substitution preference');
select public.basket_set_substitution('10000000-0000-0000-0000-000000000001', 'replace');
select tests.ok(not (public.basket_substitution_needed('10000000-0000-0000-0000-000000000001') ->> 'needed')::boolean,
  'and asks it once');
reset role;
insert into public.orders (id, code, idempotency_key, basket_id, customer_id, vendor_id, status, fulfilment, payment_method,
  menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at) values
  ('59000000-0000-0000-0000-000000000001', 'SUBTS2', 'tests:extras:sub', '58000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'placed', 'pickup', 'cod', 1, 89500, 6, 6, 0.6, now());
insert into public.order_items (id, order_id, item_id, name_ar, name_en, quantity, pricing_unit, unit_price_usd, line_total_usd) values
  ('59100000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000003', 'بيبسي', 'Pepsi', 2, 'each', 1, 2),
  ('59100000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000002', 'فتوش', 'Fattoush', 1, 'each', 4, 4);
select tests.ok((select substitution_pref = 'replace' and substitution_max_usd = 2 from public.orders where id = '59000000-0000-0000-0000-000000000001'),
  'the order carries the basket''s preference');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'subts2', 'pepsi', '57000000-0000-0000-0000-000000000004', :'cashier_a') as so \gset
select tests.ok(:'so'::jsonb ->> 'status' = 'offered' and (:'so'::jsonb ->> 'diff_usd')::numeric = 0.50 and :'so'::jsonb ->> 'pref' = 'replace',
  'the substitute is priced from the menu (2 × $1.25 against 2 × $1.00)');
reset role;
select tests.ok((select (payload ->> 'diff_lbp')::numeric = 44750 and payload ->> 'kind' = 'substitution' from public.outbound_messages
  where purpose = 'customer_message' and order_id = '59000000-0000-0000-0000-000000000001' order by id desc limit 1),
  'the customer is asked with the difference in LBP at the order''s locked rate');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.order_substitution_decide('10000000-0000-0000-0000-000000000002', (:'so'::jsonb ->> 'substitution_id')::uuid, true) ->> 'status' = 'unknown',
  'another customer cannot answer');
-- A second offer for the same line gets a new id; a tap on the first card never accepts the second price.
select public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'SUBTS2', 'pepsi', '57000000-0000-0000-0000-000000000002', :'cashier_a') as so_b \gset
select tests.ok((:'so_b'::jsonb ->> 'substitution_id') <> (:'so'::jsonb ->> 'substitution_id')
  and public.order_substitution_decide('10000000-0000-0000-0000-000000000001', (:'so'::jsonb ->> 'substitution_id')::uuid, true) ->> 'status' = 'gone',
  'a newer offer supersedes the open one, and the old card answers that it is gone');
select public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'SUBTS2', 'pepsi', '57000000-0000-0000-0000-000000000004', :'cashier_a') as so \gset
select tests.ok((select (r ->> 'total_usd')::numeric = 6.50 from public.order_substitution_decide('10000000-0000-0000-0000-000000000001',
  (:'so'::jsonb ->> 'substitution_id')::uuid, true) r), 'accepting swaps the line and the server recomputes the total');
reset role;
select tests.ok((select food_subtotal_usd = 6.50 and total_lbp = round(6.50 * 89500) from public.orders where id = '59000000-0000-0000-0000-000000000001')
  and (select item_id = '57000000-0000-0000-0000-000000000004' and line_total_usd = 2.50 from public.order_items where id = '59100000-0000-0000-0000-000000000001'),
  'the order line and totals follow, LBP at the locked rate');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'SUBTS2', 'fattoush', '57000000-0000-0000-0000-000000000003', :'cashier_a') as so2 \gset
select tests.ok((select r ->> 'status' = 'declined' and (r ->> 'total_usd')::numeric = 2.50 from public.order_substitution_decide('10000000-0000-0000-0000-000000000001',
  (:'so2'::jsonb ->> 'substitution_id')::uuid, false) r), 'declining removes the missing line');
select public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'SUBTS2', '7up', '57000000-0000-0000-0000-000000000003', :'cashier_a') as so3 \gset
select tests.ok(public.order_substitution_decide('10000000-0000-0000-0000-000000000001', (:'so3'::jsonb ->> 'substitution_id')::uuid, false) ->> 'status' = 'last_item',
  'the last line is never removed by a tap');
select tests.ok(public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'NOPE22', 'x', '57000000-0000-0000-0000-000000000003', :'cashier_a') ->> 'status' = 'unknown_order',
  'an unknown order code is refused');

-- Deposit items are not substituted by message.
reset role;
update public.menu_items set container_deposit_usd = 5 where id = '57000000-0000-0000-0000-000000000002';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok(public.order_substitution_offer('20000000-0000-0000-0000-00000000000a', 'SUBTS2', '7up', '57000000-0000-0000-0000-000000000002', :'cashier_a') ->> 'status' = 'deposit_item',
  'a substitute with a container deposit is refused');
-- Staff changes are never confirmed by the server without a member.
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'staff_add',
  '{"name": "Ziad", "role": "cashier", "phone": "+96176555444"}', 'rules', :'owner_a') as p_z \gset
select tests.throws($$select public.merchant_proposal_decide('$$ || :'p_z' || $$', true, null)$$, 'not allowed',
  'a staff change needs the owner''s own tap, never the system');

-- Visual order card and the same-price badge --------------------------------------------------------------------------
select tests.ok(public.order_card_image('59000000-0000-0000-0000-000000000001') is null, 'the order card stays off until switched on');
reset role;
insert into public.app_config (key, value, effective_from, note) values ('order_card_image_enabled', 'true', now(), 'test');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select tests.ok((select c ->> 'code' = 'SUBTS2' and (c ->> 'total_lbp')::numeric = round(2.50 * 89500) and (c ->> 'usd_lbp_rate')::numeric = 89500
  and jsonb_array_length(c -> 'lines') = 1 and not (c ->> 'same_price')::boolean from public.order_card_image('59000000-0000-0000-0000-000000000001') c),
  'the card data: items and the total in USD and LBP at the locked rate');
select tests.ok(not public.vendor_same_price('20000000-0000-0000-0000-00000000000a'), 'no badge without the merchant''s confirmation');
select public.merchant_proposal_create('20000000-0000-0000-0000-00000000000a', 'same_price', '{"on": true}', 'rules', :'owner_a') as p_sp \gset
select public.merchant_proposal_decide(:'p_sp', true, :'owner_a');
select tests.ok(public.vendor_same_price('20000000-0000-0000-0000-00000000000a'), 'the badge after the owner''s tap');

-- Access ---------------------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws('select public.staff_shift_touch(''+9613123456'')', 'permission denied', 'clients cannot read handovers');
select tests.throws('select public.order_card_image(''59000000-0000-0000-0000-000000000001'')', 'permission denied', 'clients cannot read card data directly');
select tests.ok((select count(*) = 0 from public.vendor_ops), 'a customer sees no merchant operating state');
select tests.ok((select count(*) = 5 from public.order_substitutions), 'a customer sees the substitutions on their own order');

rollback;
