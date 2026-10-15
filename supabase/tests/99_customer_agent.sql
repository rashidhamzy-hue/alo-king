-- Session 5c (DECISIONS §38.3, §39.6): the customer agent's server side. Search index and dictionary, memory with consent
-- and one-tap delete, the address on every order, "for you or someone else?", gift orders accepted by the recipient,
-- the stairs rule, disputes and credits with their ledger entries, the message budget and consolidation, outbound
-- pacing, the dead-letter queue, allergen hints, and that memory is never readable for marketing.
begin;

-- Fixtures ------------------------------------------------------------------------------------------------------
insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-AGT', 'CHF', 'Agenttown', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-AGENTTOWN', 'TZ-AGT', 'أجنتاون', 'Agenttown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test');
select public.place_set_service_status('LB-CHF-AGENTTOWN', 'on', 'test: in the delivery area');
update public.vendors set live_since = now() - interval '40 days', name_ar = 'مطعم أ', stairs_fee_per_floor_usd = 0.50
where id = '20000000-0000-0000-0000-00000000000a';
insert into public.menu_items (id, vendor_id, name_ar, name_en, price_usd, spicy_level, container_deposit_usd) values
  ('71000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'منقوشة كشك', 'Kishk manoushe', 2.50, 0, null),
  ('71000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000a', 'منقوشة زعتر', 'Zaatar manoushe', 1.50, 0, null),
  ('71000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 'بيبسي دايت', 'Pepsi diet 330ml', 1.00, 0, null),
  ('71000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a', 'سندويش طاووق حار', 'Spicy tawouk sandwich', 4.00, 2, null),
  ('71000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-00000000000a', 'حمص بطحينة', 'Hummus', 3.00, 0, null),
  ('71000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-00000000000a', 'دجاج مع توم', 'Chicken with toum', 9.00, 0, null),
  ('71000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-00000000000a', 'غالون مياه', 'Water gallon', 2.00, 0, 3.00),
  ('71000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-00000000000a', 'مشاوي مشكلة', 'Mixed grill', 30.00, 0, null);
-- Vendor C is unclaimed: its items never reach a search.
insert into public.menu_items (id, vendor_id, name_en, price_usd) values
  ('71000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-00000000000c', 'Kishk manoushe C', 1.00);
insert into public.customers (id, phone_e164, display_name) values
  ('17000000-0000-0000-0000-000000000001', '+96176100001', 'Rami'),
  ('17000000-0000-0000-0000-000000000002', '+96176100002', 'Mom'),
  ('17000000-0000-0000-0000-000000000003', '+96176100003', null);
update public.customers set last_inbound_at = now() where id in ('17000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002');

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set rami '17000000-0000-0000-0000-000000000001'
\set mom '17000000-0000-0000-0000-000000000002'

-- 1. Config ------------------------------------------------------------------------------------------------------
select tests.ok(public.config_value('ai_free_text_enabled') = 'false'::jsonb and public.config_value('ai_voice_enabled') = 'false'::jsonb,
  'free text and voice model turns are off until the evals pass (§32.4)');
select tests.ok(public.config_numeric('escalation_give_up_s') = 180, 'an unanswered order is given up at 180 s (§38.3)');
select tests.ok(public.config_value('ai_customer_model') #>> '{}' = 'claude-haiku-4-5-20251001'
  and public.config_value('ai_customer_model_candidate') #>> '{}' = 'claude-haiku-5-5',
  'Haiku 5.5 is the candidate in config, not the model, until it wins the eval');
select tests.ok((public.config_value('ai_model_prices') -> 'claude-haiku-5-5' ->> 'in')::numeric = 0.10, 'Haiku 5.5 prices are in the cost table first');

-- 2. Search ------------------------------------------------------------------------------------------------------
select tests.ok(public.search_expand('manoushe kishk') -> 'terms' ? 'كشك' and public.search_expand('manoushe kishk') -> 'terms' ? 'منقوشه',
  'Arabizi dish words expand to the Arabic menu words');
select tests.ok(public.search_expand('Pepsi diet 2') -> 'terms' ? 'pepsi' and public.search_expand('Pepsi diet 2') -> 'attributes' ? 'diet'
  and not (public.search_expand('Pepsi diet 2') -> 'terms' ? '2'), 'a brand word and "diet"; the number is a quantity, never a search word');
select tests.ok(public.search_expand('bade shi 7arr w rkhis') -> 'attributes' @> '["spicy", "cheap"]'::jsonb
  and jsonb_array_length(public.search_expand('bade shi 7arr w rkhis') -> 'terms') = 0, '"bade shi 7arr w rkhis" = something spicy and cheap');
select tests.ok(public.search_expand('akel lal wled') -> 'attributes' ? 'kids', '"akel lal wled" = food for the kids');
select tests.ok(public.search_expand('ta2ouk') -> 'terms' ? 'طاووق', 'ta2ouk → طاووق');

select public.address_save_pin(:'rami', 33.6821, 35.5861) as pin1 \gset
select public.route_cache_store(33.68, 35.58, array[33.6821], array[35.5861], array[2400], array[300], 'ors');
select public.catalog_search(:'rami', 'manoushe kishk', 10) as s1 \gset
select tests.ok(:'s1'::jsonb ->> 'status' = 'ok' and :'s1'::jsonb #>> '{items,0,item_id}' = '71000000-0000-0000-0000-000000000001'
  and (:'s1'::jsonb #>> '{items,0,price_usd}')::numeric = 2.50, '"manoushe kishk" finds the kishk manoushe with its server price');
select tests.ok(not exists (select 1 from jsonb_array_elements(:'s1'::jsonb -> 'items') x where x ->> 'vendor_id' = '20000000-0000-0000-0000-00000000000c'),
  'an unclaimed shop''s draft items are never in the search');
select tests.ok(public.catalog_search(:'rami', 'Pepsi diet 2', 10) #>> '{items,0,item_id}' = '71000000-0000-0000-0000-000000000003',
  '"Pepsi diet 2" finds the diet Pepsi');
select public.catalog_search(:'rami', 'bade shi 7arr w rkhis', 10) as s3 \gset
select tests.ok(:'s3'::jsonb #>> '{items,0,item_id}' = '71000000-0000-0000-0000-000000000004'
  and jsonb_array_length(:'s3'::jsonb -> 'items') = 1, 'something spicy: only the spicy item');
select tests.ok(public.catalog_search(:'rami', 'ta2ouk', 10) #>> '{items,0,item_id}' = '71000000-0000-0000-0000-000000000004', 'ta2ouk finds the tawouk');
select tests.ok(public.catalog_search(:'rami', 'sushi omakase', 10) ->> 'status' = 'none', 'nothing invented when nothing matches');
-- Beyond the shop's own radius nothing is offered.
reset role;
update public.vendors set delivery_radius_km = 0.2 where id = '20000000-0000-0000-0000-00000000000a';
set local role service_role;
select tests.ok(public.catalog_search(:'rami', 'manoushe kishk', 10) ->> 'status' = 'none', 'a shop whose radius does not reach the pin offers nothing');
reset role;
update public.vendors set delivery_radius_km = 5 where id = '20000000-0000-0000-0000-00000000000a';
set local role service_role;

-- 3. Memory -----------------------------------------------------------------------------------------------------
select tests.ok(public.customer_fact_set(:'rami', 'vegetarian', 'yes') ->> 'status' = 'saved', 'a stated preference is kept');
select tests.ok(public.customer_fact_set(:'rami', 'allergy', 'nuts') ->> 'status' = 'needs_consent', 'an allergy is not kept without consent');
select tests.ok(not exists (select 1 from public.customer_preferences where customer_id = :'rami' and key = 'allergy'), '…and nothing was stored');
select public.customer_preference_set(:'rami', 'gluten_free', 'yes');
select tests.ok(not exists (select 1 from public.customer_preferences where customer_id = :'rami' and key = 'gluten_free'),
  'the old setter never stores a health note');
select tests.ok(public.customer_fact_set(:'rami', 'allergy', 'nuts', 'said', true) ->> 'status' = 'saved', 'with consent it is kept');
select tests.ok((select consented_at is not null from public.customer_preferences where customer_id = :'rami' and key = 'allergy'),
  'the consent time is recorded');
reset role;
select tests.throws($$insert into public.customer_preferences (customer_id, key, value) values ('17000000-0000-0000-0000-000000000003', 'allergy', 'x')$$,
  'customer_preferences_health_consent', 'the table itself refuses a health note without consent');
set local role service_role;
select public.customer_memory(:'rami') as mem \gset
select tests.ok(:'mem'::jsonb ->> 'name' = 'Rami' and jsonb_array_length(:'mem'::jsonb -> 'facts') = 2
  and (select bool_or((f ->> 'health')::boolean) from jsonb_array_elements(:'mem'::jsonb -> 'facts') f),
  '"what do you remember?" lists the name and both facts, the allergy marked as health');
select tests.ok(public.customer_memory_forget(:'rami', 'fact', 'allergy') ->> 'status' = 'forgotten', 'one tap deletes one fact');
select tests.ok(not exists (select 1 from public.customer_preferences where customer_id = :'rami' and key = 'allergy'), '…and it is gone');
select tests.ok(public.customer_memory_forget(:'rami', 'name') ->> 'status' = 'forgotten', 'one tap deletes the name');
select tests.ok((select display_name is null from public.customers where id = :'rami'), '…and it is gone');
select tests.ok(exists (select 1 from public.audit_log where table_name = 'customers' and row_id = :'rami' and reason like 'memory forget:%'),
  'each deletion is in the audit log');
select tests.ok(public.customer_memory_forget(:'rami', 'nonsense') ->> 'status' = 'invalid', 'an unknown part changes nothing');
-- Memory is never readable for marketing: no function that builds an audience, broadcast or campaign reads it, and no
-- signed-in role can read another customer's facts.
reset role;
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private') and p.proname ~ '(broadcast|campaign|marketing|audience|segment|promo)'
    and p.prosrc ~ '(customer_preferences|customer_memory|customer_profile)'), 'no marketing function reads customer memory (§39.6)');
select tests.ok(not has_function_privilege('authenticated', 'public.customer_memory(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.customer_memory(uuid)', 'execute'), 'memory is readable by the service role only');
set local role service_role;

-- 4. Address on every order, and who it is for -------------------------------------------------------------------
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000001', 2) as b1 \gset
select tests.ok(public.basket_address_state(:'rami') ->> 'status' = 'for_whom',
  'a fresh pin confirms the address, and a new address asks "for you or someone else?" (§22.1)');
select (:'pin1'::jsonb #>> '{address,address_id}') as a1 \gset
select tests.ok(public.address_set_for_whom(:'rami', :'a1', 'self', true) ->> 'status' = 'saved', 'for me, keep it');
select tests.ok(public.basket_address_state(:'rami') ->> 'status' = 'ok', 'then checkout goes on');
select tests.ok((public.customer_profile(:'rami') -> 'addresses' -> 0 ->> 'address_id') = :'a1', 'the kept address is a saved address now');
-- Next order, an hour later: the saved address must be confirmed again (§39.6).
update public.addresses set pinned_at = now() - interval '2 hours' where id = :'a1';
update public.baskets set created_at = now() - interval '1 hour', address_confirmed_at = null where customer_id = :'rami' and status = 'open';
select public.basket_address_state(:'rami') as st \gset
select tests.ok(:'st'::jsonb ->> 'status' = 'confirm' and :'st'::jsonb ->> 'address_id' = :'a1', 'a saved address is confirmed on every order');
select b.id as bid, b.priced_menu_version as ver from public.baskets b where b.customer_id = :'rami' and b.status = 'open' \gset
select tests.ok(public.order_place(:'bid', :'ver', 'test:agent:unconfirmed') ->> 'status' = 'address_unconfirmed',
  'order_place refuses an address nobody confirmed');
select tests.ok(public.basket_confirm_address(:'rami', :'a1') ->> 'status' = 'confirmed' and public.basket_address_state(:'rami') ->> 'status' = 'ok',
  'the "deliver here" tap confirms it');

-- 5. Stairs rule (§38.3) -----------------------------------------------------------------------------------------
select public.basket_set_checkout(:'rami', 'delivery', null, 5::smallint, null);
select tests.ok((public.basket_quote(:'rami') ->> 'stairs_fee_usd')::numeric = 0.75, '5th floor, no lift known: $0.25 x 3 floors above the 2nd');
update public.addresses set has_elevator = true where id = :'a1';
select tests.ok((public.basket_quote(:'rami') ->> 'stairs_fee_usd')::numeric = 0, 'a working lift: no stairs fee');
update public.addresses set has_elevator = false where id = :'a1';
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000007', 3) as gal \gset
select public.basket_set_checkout(:'rami', 'delivery', null, 12::smallint, null);
select tests.ok((public.basket_quote(:'rami') ->> 'stairs_fee_usd')::numeric = 3.00,
  '12th floor with 3 water gallons: min($2, $2.50) + $0.50 x 2 heavy = $3.00');
select public.basket_set_quantity(:'rami', (:'gal'::jsonb ->> 'line_id')::uuid, 0);
select public.basket_set_checkout(:'rami', 'delivery', null, 0::smallint, null);

-- 6. Disputes, credits and the ledger ---------------------------------------------------------------------------
select public.basket_set_cash_currency(:'rami', 'USD');
select public.basket_quote(:'rami') as q1 \gset
select b.priced_menu_version as ver from public.baskets b where b.customer_id = :'rami' and b.status = 'open' \gset
select public.order_place(:'bid', :'ver', 'test:agent:o1') as o1 \gset
select tests.ok(:'o1'::jsonb ->> 'status' = 'placed', 'the confirmed order is placed');
select (:'o1'::jsonb ->> 'order_id') as oid1 \gset
select tests.ok(public.dispute_open(:'rami', :'oid1', 'missing_item', null) ->> 'status' = 'not_delivered', 'a dispute needs a delivered order');
reset role;
update public.orders set status = 'accepted' where id = :'oid1';
update public.orders set status = 'ready' where id = :'oid1';
update public.orders set status = 'picked_up' where id = :'oid1';
update public.orders set delivery_code_confirmed_at = now() where id = :'oid1';
update public.orders set status = 'delivered' where id = :'oid1';
update public.orders set accepted_at = now() - interval '50 minutes', ready_marked_at = now() - interval '30 minutes',
  picked_up_at = now() - interval '25 minutes', delivered_at = now() - interval '5 minutes' where id = :'oid1';
set local role service_role;
select id as line1 from public.order_items where order_id = :'oid1' limit 1 \gset
select public.dispute_open(:'rami', :'oid1', 'missing_item', :'line1', 2) as d1 \gset
select tests.ok(:'d1'::jsonb ->> 'status' = 'auto_credit' and (:'d1'::jsonb ->> 'amount_usd')::numeric = 5.00 and :'d1'::jsonb ->> 'payer' = 'merchant',
  'both manoushes missing ($5.00, under $8): automatic credit, the merchant pays (§38.3)');
select tests.ok(public.dispute_open(:'rami', :'oid1', 'missing_item', :'line1') ->> 'status' = 'already_reported', 'the same line once');
select tests.ok((select count(*) = 2 and sum(e.amount) = 0 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                 where t.idempotency_key = 'dispute:' || (:'d1'::jsonb ->> 'dispute_id')),
  'the credit is one balanced ledger transaction');
select tests.ok((select e.amount = 5.00 from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
                 join public.ledger_accounts a on a.id = e.account_id
                 where t.idempotency_key = 'dispute:' || (:'d1'::jsonb ->> 'dispute_id') and a.kind = 'merchant_payable'),
  'debited from what Alo King owes the merchant');
select tests.ok((public.customer_profile(:'rami') ->> 'credit_usd')::numeric = 5.00, 'the customer has $5.00 of credit');
select public.dispute_open(:'rami', :'oid1', 'cold_food', null) as d2 \gset
select tests.ok(:'d2'::jsonb ->> 'status' = 'review' and (:'d2'::jsonb ->> 'amount_usd')::numeric = 1.50,
  'cold food: a 20-minute leg against a 5-minute route is over 1.5 x, so 30% of the $5.00 food; a second claim on one order goes to a person');
select tests.ok(public.dispute_open(:'rami', :'oid1', 'damaged', null) ->> 'status' = 'review'
  and exists (select 1 from public.ops_alerts where kind = 'customer_dispute'), 'damaged: a person decides, the operators are alerted');
-- A $30 missing line is above $20: Rasheed decides.
reset role;
insert into public.order_items (order_id, item_id, name_en, quantity, pricing_unit, unit_price_usd, line_total_usd)
values (:'oid1', '71000000-0000-0000-0000-000000000008', 'Mixed grill', 1, 'each', 30.00, 30.00);
set local role service_role;
select id as line2 from public.order_items where order_id = :'oid1' and name_en = 'Mixed grill' \gset
select tests.ok(public.dispute_open(:'rami', :'oid1', 'wrong_item', :'line2') ->> 'status' = 'owner_review', 'above $20: Rasheed''s tap');
-- Deciding a dispute in review needs an active operator, an admin above $20, and never more than the line.
select id as d3 from public.order_disputes where order_id = :'oid1' and kind = 'wrong_item' \gset
select tests.throws(format('select public.dispute_decide(%L, true, null)', :'d3'), 'an active operator', 'no actor, no decision');
select tests.throws(format('select public.dispute_decide(%L, true, %L)', :'d3', '00000000-0000-0000-0000-00000000000b'),
  'over the owner limit', 'an operator cannot approve above $20');
select tests.ok(public.dispute_decide(:'d3', true, '00000000-0000-0000-0000-00000000000a', 31) ->> 'status' = 'invalid',
  'never more than the line');
select tests.ok(public.dispute_decide(:'d3', false, '00000000-0000-0000-0000-00000000000a') ->> 'status' = 'rejected', 'the admin decides');
select tests.ok((select decided_by = '00000000-0000-0000-0000-00000000000a' from public.order_disputes where id = :'d3'), '…and it is recorded');
-- Cold food above $8 is never automatic: a $30 basket delivered late by a fresh customer goes to a person (§38.3).
reset role;
update public.order_disputes set decision = 'rejected' where order_id = :'oid1';
update public.order_disputes set created_at = now() - interval '200 days' where order_id = :'oid1';
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_cols from information_schema.columns
  where table_schema = 'public' and table_name = 'orders' and is_generated = 'NEVER' and column_default is distinct from 'now()'
    and column_name not in ('id', 'code', 'idempotency_key', 'status', 'food_subtotal_usd', 'total_usd', 'basket_id',
      'accepted_at', 'ready_marked_at', 'picked_up_at', 'delivered_at', 'delivery_code_confirmed_at', 'created_at', 'updated_at');
  execute format('insert into public.orders (id, code, idempotency_key, status, food_subtotal_usd, total_usd, %s)
    select %L, %L, %L, %L, food_subtotal_usd + 35, total_usd + 35, %s from public.orders where idempotency_key = %L',
    v_cols, '72000000-0000-0000-0000-000000000001', 'CQLDZZ', 'test:cold01', 'placed', v_cols, 'test:agent:o1');
end;
$$;
update public.orders set status = 'accepted' where id = '72000000-0000-0000-0000-000000000001';
update public.orders set status = 'ready' where id = '72000000-0000-0000-0000-000000000001';
update public.orders set status = 'picked_up' where id = '72000000-0000-0000-0000-000000000001';
update public.orders set delivery_code_confirmed_at = now() where id = '72000000-0000-0000-0000-000000000001';
update public.orders set status = 'delivered' where id = '72000000-0000-0000-0000-000000000001';
update public.orders o set accepted_at = x.accepted_at, ready_marked_at = x.ready_marked_at, picked_up_at = x.picked_up_at,
  delivered_at = x.delivered_at
from public.orders x where x.id = :'oid1' and o.id = '72000000-0000-0000-0000-000000000001';
set local role service_role;
select public.dispute_open(:'rami', '72000000-0000-0000-0000-000000000001', 'cold_food', null) as d4 \gset
select tests.ok(:'d4'::jsonb ->> 'status' = 'review' and (:'d4'::jsonb ->> 'amount_usd')::numeric = 12.00,
  'cold food worth $12 is over the $8 automatic limit: a person decides');
-- The consented allergy reaches the kitchen on the customer's own orders, from memory, with no per-session step.
select public.customer_fact_set(:'rami', 'allergy', 'sesame', 'said', true);
-- The credit pays part of the next order; on delivery the ledger records it for the merchant.
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000004', 2) as b2 \gset
select public.basket_confirm_address(:'rami', :'a1');
select public.basket_set_cash_currency(:'rami', 'USD');
select public.basket_quote(:'rami') as q2 \gset
select tests.ok((:'q2'::jsonb ->> 'credit_usd')::numeric = 5.00
  and (:'q2'::jsonb ->> 'total_usd')::numeric = (:'q2'::jsonb ->> 'subtotal_usd')::numeric + (:'q2'::jsonb ->> 'delivery_fee_usd')::numeric - 5.00,
  'the quote shows the credit taken off the total');
select b.id as bid2, b.priced_menu_version as ver2 from public.baskets b where b.customer_id = :'rami' and b.status = 'open' \gset
select public.order_place(:'bid2', :'ver2', 'test:agent:o2') as o2 \gset
select (:'o2'::jsonb ->> 'order_id') as oid2 \gset
select tests.ok((select allergy_note = 'sesame' from public.orders where id = :'oid2'), 'the consented allergy is on the order for the kitchen');
select tests.ok((select credit_usd = 5.00 from public.orders where id = :'oid2')
  and exists (select 1 from public.customer_credits where used_order_id = :'oid2'), 'the order uses the credit');
reset role;
update public.orders set status = 'cancelled', cancel_reason = 'operator' where id = :'oid2';
set local role service_role;
select tests.ok(not exists (select 1 from public.customer_credits where used_order_id = :'oid2'), 'a cancelled order gives the credit back');
-- An unused credit that expires goes back to whoever funded it, once (§20).
reset role;
update public.customer_credits set expires_at = now() - interval '1 minute' where customer_id = :'rami';
select tests.ok(app_private.credits_expire() = 1 and app_private.credits_expire() = 0, 'an expired credit is reversed once');
select tests.ok((select sum(e.amount) = 0 from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
                 join public.ledger_transactions t on t.id = e.transaction_id
                 where a.kind = 'customer_refund_payable' and t.idempotency_key like any (array['dispute:%', 'credit-expired:%'])),
  'nothing is left owed to the customer on the ledger');
-- The soonest-expiring credit too big for the basket is skipped; a smaller one still applies.
insert into public.customer_credits (customer_id, amount_usd, reason, expires_at) values
  (:'rami', 50.00, 'test big credit', now() + interval '1 day'), (:'rami', 1.00, 'test small credit', now() + interval '2 days');
select tests.ok((select sum(amount_usd) = 1.00 from app_private.credits_for(:'rami', 10)), 'a credit that fits is used even after one that does not');
delete from public.customer_credits where reason like 'test % credit';
set local role service_role;

-- 7. Gift orders ---------------------------------------------------------------------------------------------------
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000002', 2) as b3 \gset
select public.address_save_pin(:'rami', 33.6880, 35.5900) as pin2 \gset
select public.route_cache_store(33.68, 35.58, array[33.6880], array[35.5900], array[2000], array[250], 'ors');
select (:'pin2'::jsonb #>> '{address,address_id}') as a2 \gset
select tests.ok(public.basket_address_state(:'rami') ->> 'status' = 'for_whom', 'a new address: for you or someone else?');
select public.address_set_for_whom(:'rami', :'a2', 'other', false);
select tests.ok(public.basket_address_state(:'rami') ->> 'status' = 'recipient', 'someone else: who is it for?');
select tests.ok(public.address_set_recipient(:'rami', :'a2', 'Mom', '+96176100001') ->> 'status' = 'own_number', 'not the sender''s own number');
select tests.ok(public.address_set_recipient(:'rami', :'a2', 'Mom', '+96176100002') ->> 'status' = 'saved', 'Mom and her number');
select tests.ok(public.basket_address_state(:'rami') ->> 'status' = 'ok' and (public.basket_quote(:'rami') ->> 'is_gift')::boolean,
  'the basket is a gift for Mom');
select public.basket_set_cash_currency(:'rami', 'USD');
select public.basket_quote(:'rami') as q3 \gset
select b.id as bid3, b.priced_menu_version as ver3 from public.baskets b where b.customer_id = :'rami' and b.status = 'open' \gset
select tests.ok(public.order_place(:'bid3', :'ver3', 'wa:' || :'bid3') ->> 'status' = 'gift_needs_recipient',
  'the sender''s own Confirm never places a gift');
select public.gift_request_create(:'rami', :'bid3', :'ver3') as g1 \gset
select tests.ok(:'g1'::jsonb ->> 'status' = 'asked', 'the recipient is asked');
select tests.ok(exists (select 1 from public.outbound_messages where target = '+96176100002' and payload ->> 'kind' = 'gift_request'),
  'Mom gets "accept and pay on delivery"');
select tests.ok(public.gift_respond('+96176100003', (:'g1'::jsonb ->> 'gift_id')::uuid, true) ->> 'status' = 'unknown', 'only Mom can answer');
select tests.ok(public.gift_request_create(:'rami', :'bid3', :'ver3') ->> 'gift_id' = :'g1'::jsonb ->> 'gift_id', 'a second Confirm tap returns the same request');
select tests.ok((select count(*) = 1 from public.outbound_messages where target = '+96176100002' and payload ->> 'kind' = 'gift_request'),
  'tapping Confirm again does not message Mom again');
select public.gift_respond('+96176100002', (:'g1'::jsonb ->> 'gift_id')::uuid, true) as g2 \gset
select tests.ok(:'g2'::jsonb ->> 'status' = 'placed', 'Mom accepts: the order is placed');
select tests.ok((select is_gift and recipient_name = 'Mom' and recipient_phone = '+96176100002' and customer_id = :'rami'
                 from public.orders where id = (:'g2'::jsonb ->> 'order_id')::uuid), 'the order is Rami''s, a gift for Mom');
select tests.ok(exists (select 1 from public.outbound_messages where target = '+96176100001' and payload ->> 'kind' = 'gift_accepted'),
  'Rami hears Mom accepted');
select tests.ok(public.gift_respond('+96176100002', (:'g1'::jsonb ->> 'gift_id')::uuid, true) ->> 'status' = 'already_accepted', 'once');
select tests.ok((select allergy_note is null from public.orders where id = (:'g2'::jsonb ->> 'order_id')::uuid),
  'the sender''s own allergy never goes on a gift for someone else');
-- A basket changed after Mom was asked is never ordered on her tap.
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000002', 1) as b5 \gset
select public.basket_confirm_address(:'rami', :'a2');
select public.basket_set_cash_currency(:'rami', 'USD');
select public.basket_quote(:'rami');
select b.id as bid5, b.priced_menu_version as ver5 from public.baskets b where b.customer_id = :'rami' and b.status = 'open' \gset
select public.gift_request_create(:'rami', :'bid5', :'ver5') as g5 \gset
select tests.ok(:'g5'::jsonb ->> 'status' = 'asked', 'a second gift for Mom is asked');
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000002', 3);
select tests.ok(public.gift_respond('+96176100002', (:'g5'::jsonb ->> 'gift_id')::uuid, true) ->> 'status' = 'changed', 'a changed basket is refused');
select tests.ok((select status = 'failed' from public.gift_requests where id = (:'g5'::jsonb ->> 'gift_id')::uuid)
  and (select status = 'open' from public.baskets where id = :'bid5'),
  'the sender added items after asking: Mom''s tap orders nothing, and Rami hears it failed');
select tests.ok(exists (select 1 from public.outbound_messages where target = '+96176100001' and payload ->> 'kind' = 'gift_failed'), '…told to the sender');
-- At most three requests a day from one sender to one number.
reset role;
update public.gift_requests set created_at = now() - interval '1 hour', status = 'expired' where sender_id = :'rami';
insert into public.gift_requests (basket_id, sender_id, recipient_phone, recipient_name, menu_version, total_usd, fingerprint, status, expires_at)
values (:'bid5', :'rami', '+96176100002', 'Mom', :'ver5', 1, 'x', 'expired', now());
set local role service_role;
select tests.ok(public.gift_request_create(:'rami', :'bid5', :'ver5') ->> 'status' = 'too_many', 'a fourth request in a day is refused');
reset role;
delete from public.gift_requests where fingerprint = 'x';
set local role service_role;
-- STOP from the recipient blocks gift messages.
select public.customer_marketing_set(:'mom', false);
select public.basket_add_item(:'rami', '71000000-0000-0000-0000-000000000002', 1) as b4 \gset
select public.basket_confirm_address(:'rami', :'a2');
select public.basket_set_cash_currency(:'rami', 'USD');
select public.basket_quote(:'rami');
select b.id as bid4, b.priced_menu_version as ver4 from public.baskets b where b.customer_id = :'rami' and b.status = 'open' \gset
select tests.ok(public.gift_request_create(:'rami', :'bid4', :'ver4') ->> 'status' = 'blocked', 'after STOP no gift message reaches her (§22.3)');

-- 8. Messages: budget and "delivered + rate" ---------------------------------------------------------------------------
reset role;
update public.orders set customer_messages = 12 where id = :'oid1';
select tests.ok(app_private.customer_notify(:'oid1', 'near_drop') is null, 'at the cap a non-essential message is not sent');
select tests.ok(app_private.customer_notify(:'oid1', 'weight_confirm', '{}', 'weight-test') is not null, 'a money decision always goes');
update public.orders set customer_messages = 9 where id = :'oid1';
select tests.ok(app_private.customer_notify(:'oid1', 'near_drop', '{}', 'nd2') is null, 'above the target only essential kinds go');
select tests.ok(app_private.customer_notify(:'oid1', 'delivered', '{}', 'delivered-again') is not null, 'delivered is essential');
select tests.ok(app_private.customer_notify(:'oid1', 'rating') is null, 'no separate rating after the delivered message (§38.3)');
select tests.ok((select customer_messages = 10 from public.orders where id = :'oid1'), 'each message sent counts against the budget');
set local role service_role;
select tests.ok((public.customer_message_report(7) ->> 'target')::int = 8, 'the report reads the target');

-- 9. Pacing ------------------------------------------------------------------------------------------------------------
reset role;
update public.outbound_messages set status = 'sent', sent_at = now() where target = '+96176100001' and status = 'queued';
select app_private.outbox_add('pace-test', null, null, 'whatsapp', 'customer_message', '+96176100001', '{"kind": "basket_reminder"}') as pace \gset
set local role service_role;
select tests.ok(not exists (select 1 from public.outbox_claim(100, 30) where id = :'pace'),
  'a non-urgent message to someone messaged a second ago waits (6 s gap)');
select tests.ok((select available_at > now() from public.outbound_messages where id = :'pace'), 'it is pushed back, not lost');

-- 10. Dead letter -------------------------------------------------------------------------------------------------------
reset role;
insert into public.webhook_events (provider, event_key, event_type, payload, status, attempts)
values ('kapso', 'dead-test-1', 'whatsapp.message.received', '{}', 'processing', 5) returning id as evid \gset
select pgmq.send('webhook_inbound', jsonb_build_object('event_id', :'evid')) as mid \gset
set local role service_role;
select public.webhook_finish(:'mid', :'evid', 'failed', 'boom', 5, 5);
select tests.ok((select dead_lettered_at is not null from public.webhook_events where id = :'evid'), 'the 5th failure puts the event on the dead-letter queue');
reset role;
select tests.ok(exists (select 1 from pgmq.read('webhook_dead', 1, 10) m where (m.message ->> 'event_id')::bigint = :'evid'
  and m.message ->> 'error' = 'boom'), '…with its error');
set local role service_role;
select tests.ok(exists (select 1 from public.ops_alerts where kind = 'dead_letter'), 'the operators are alerted');
select tests.throws(format('select public.webhook_dead_replay(%s, null)', :'evid'), 'an active operator', 'only an operator replays');
select tests.ok(public.webhook_dead_replay(:'evid', '00000000-0000-0000-0000-00000000000b') ->> 'status' = 'requeued', 'an operator replays it');
select tests.ok((select attempts = 1 and status = 'queued' from public.webhook_events where id = :'evid'),
  'an operator replays it as a retry (attempt 2 next), so an unfinished turn runs again');
reset role;
select tests.ok(not exists (select 1 from pgmq.q_webhook_dead m where (m.message ->> 'event_id')::bigint = :'evid'),
  'a replayed event leaves the dead-letter queue');
set local role service_role;

-- 11. Allergen hints (§38.3) ---------------------------------------------------------------------------------------------
select public.menu_item_hints(array['71000000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000006',
  '71000000-0000-0000-0000-000000000002']::uuid[]) as h \gset
select tests.ok(:'h'::jsonb -> '71000000-0000-0000-0000-000000000005' -> 'may_contain' ? 'sesame', 'hummus: ≈ may contain sesame (tahini)');
select tests.ok(:'h'::jsonb -> '71000000-0000-0000-0000-000000000006' -> 'may_contain' ? 'eggs', 'toum: ≈ may contain egg');
select tests.ok(jsonb_array_length(:'h'::jsonb -> '71000000-0000-0000-0000-000000000002' -> 'may_contain') = 0, 'zaatar: no hint');
reset role;
update public.menu_items set allergens = '{sesame}' where id = '71000000-0000-0000-0000-000000000005';
set local role service_role;
select tests.ok(not (public.menu_item_hints(array['71000000-0000-0000-0000-000000000005']::uuid[]) -> '71000000-0000-0000-0000-000000000005' -> 'may_contain' ? 'sesame'),
  'once the merchant declares sesame it is no longer a hint');

-- 12. Grants ---------------------------------------------------------------------------------------------------------------
reset role;
select tests.ok(not exists (
  select 1 from (values ('public.catalog_search(uuid,text,integer)'), ('public.customer_memory_forget(uuid,text,text)'),
    ('public.gift_respond(text,uuid,boolean)'), ('public.dispute_open(uuid,uuid,text,uuid,integer)'), ('public.dispute_decide(uuid,boolean,uuid,numeric)'),
    ('public.webhook_dead_replay(bigint,uuid)'), ('public.gift_request_create(uuid,uuid,bigint)'),
    ('public.customer_fact_set(uuid,text,text,text,boolean)')) f(sig)
  where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'none of the new functions is reachable without the service role');

rollback;
