-- Row-level security for people and vendors, as anonymous, customer, merchant staff, operator and admin.
begin;

-- Anonymous ---------------------------------------------------------------------------------------------
set local role anon;
select tests.act_as(null);
select tests.ok(tests.count_of('select id from public.vendors') = 1, 'anon sees only the public vendor');
select tests.ok((select slug from public.vendors) = 'vendor-a', 'anon sees vendor-a');
select tests.throws('select * from public.vendors', 'permission denied', 'anon cannot select * on vendors (no location, no place_id)');
select tests.throws('select location from public.vendors', 'permission denied', 'anon cannot read vendor coordinates');
select tests.throws('select * from public.customers', 'permission denied', 'anon cannot read customers');
select tests.throws('select * from public.vendor_private', 'permission denied', 'anon cannot read vendor_private');
select tests.throws('select * from public.vendor_members', 'permission denied', 'anon cannot read vendor_members');
select tests.throws('select * from public.operators', 'permission denied', 'anon cannot read operators');
select tests.throws('select * from public.audit_log', 'permission denied', 'anon cannot read the audit log');
select tests.throws('select * from public.app_config', 'permission denied', 'anon cannot read config');
select tests.throws('select * from public.message_rates', 'permission denied', 'anon cannot read message rates');
select tests.throws($$insert into public.vendors (slug, name_en, business_type, source) values ('x', 'X', 'cafe', 'merchant')$$,
  'permission denied', 'anon cannot insert vendors');
select tests.throws($$update public.vendors set public_page = true$$, 'permission denied', 'anon cannot update vendors');
reset role;

-- Customer ----------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.count_of('select id from public.customers') = 1, 'customer sees exactly one customer row');
select tests.ok((select phone_e164 from public.customers) = '+96170000001', 'customer sees its own row');
update public.customers set display_name = 'Renamed' where id = '10000000-0000-0000-0000-000000000001';
select tests.ok((select display_name from public.customers) = 'Renamed', 'customer can rename itself');
select tests.throws($$update public.customers set marketing_opt_in = true, marketing_opt_in_at = now()$$,
  'permission denied', 'customer cannot set marketing consent directly');
select tests.throws($$update public.customers set phone_e164 = '+96170000009'$$, 'permission denied', 'customer cannot change its phone');
update public.customers set display_name = 'Hijack' where id = '10000000-0000-0000-0000-000000000002';
reset role;
select tests.ok((select display_name from public.customers where id = '10000000-0000-0000-0000-000000000002') = 'Customer Two',
  'customer cannot rename another customer');
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.count_of('select id from public.vendors') = 1, 'customer sees only public vendors');
select tests.ok(tests.count_of('select vendor_id from public.vendor_private') = 0, 'customer sees no vendor_private rows');
select tests.ok(tests.count_of('select id from public.vendor_members') = 0, 'customer sees no vendor members');
select tests.ok(tests.count_of('select user_id from public.operators') = 0, 'customer sees no operators');
select tests.ok(tests.count_of('select id from public.audit_log') = 0, 'customer sees no audit rows');
select tests.throws($$insert into public.operators (user_id, role, display_name) values ('00000000-0000-0000-0000-00000000000c', 'admin', 'Me')$$,
  'row-level security', 'customer cannot make itself an operator');
reset role;

-- Merchant owner ----------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000e');
select tests.ok(tests.count_of('select id from public.vendors') = 1, 'owner of A sees vendor A only (A is public; B and C hidden)');
select tests.ok(tests.count_of($$select vendor_id from public.vendor_private$$) = 1, 'owner reads its own vendor_private only');
select tests.ok((select address_seed from public.vendor_private) = 'Seed address A', 'owner reads vendor A private fields');
select tests.ok(tests.count_of('select id from public.vendor_members') = 2, 'owner sees its team (owner and cashier)');
select tests.throws($$insert into public.vendor_members (vendor_id, phone_e164, role) values ('20000000-0000-0000-0000-00000000000a', '+96171999999', 'owner')$$,
  'permission denied', 'owner cannot insert members directly (server RPC only)');
select tests.throws($$update public.vendor_members set role = 'owner'$$, 'permission denied', 'members cannot change roles directly');
select tests.throws($$update public.vendors set orderable = true$$, 'permission denied', 'owner cannot write vendors directly');
reset role;

-- Owner of B sees B although B has no public page.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-000000000010');
select tests.ok(tests.count_of($$select id from public.vendors where slug = 'vendor-b'$$) = 1, 'owner of B sees its non-public vendor');
select tests.ok(tests.count_of($$select vendor_id from public.vendor_private$$) = 1, 'owner of B sees only B private fields');
select tests.ok(tests.count_of($$select id from public.vendor_members$$) = 1, 'owner of B does not see A team');
reset role;

-- Merchant cashier --------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000f');
select tests.ok(tests.count_of('select vendor_id from public.vendor_private') = 0, 'cashier cannot read vendor_private');
select tests.ok(tests.count_of('select id from public.vendor_members') = 1, 'cashier sees only its own membership');
reset role;

-- Operator and admin ------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.count_of('select id from public.vendors') = 3, 'operator sees every vendor');
select tests.ok(tests.count_of('select id from public.customers') = 2, 'operator sees every customer');
select tests.ok(tests.count_of('select vendor_id from public.vendor_private') = 3, 'operator sees every vendor_private row');
select tests.ok(tests.count_of('select id from public.audit_log') > 0, 'operator reads the audit log');
-- Row-level security filters the update to zero rows instead of raising; the result is checked below.
update public.operators set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
reset role;
select tests.ok((select role from public.operators where user_id = '00000000-0000-0000-0000-00000000000b') = 'operator',
  'operator promotion was not applied');

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000a');
update public.operators set display_name = 'Operator Renamed' where user_id = '00000000-0000-0000-0000-00000000000b';
reset role;
select tests.ok((select display_name from public.operators where user_id = '00000000-0000-0000-0000-00000000000b') = 'Operator Renamed',
  'admin can manage operators');

-- Vendor rules ------------------------------------------------------------------------------------------
select tests.throws($$update public.vendors set public_page = true where slug = 'vendor-c'$$,
  'vendors_public_needs_claim', 'an unclaimed vendor cannot get a public page');
select tests.throws($$update public.vendors set orderable = true where slug = 'vendor-c'$$,
  'vendors_orderable_needs_claim', 'an unclaimed vendor cannot be orderable');
select tests.throws($$update public.vendors set delivery_radius_km = 21 where slug = 'vendor-a'$$,
  'exceeds the 20', 'delivery radius above the largest fee band is rejected');
select tests.throws($$insert into public.customers (phone_e164) values ('70123456')$$, 'customers_phone_e164_check', 'customer phone must be E.164');

-- Audit log ---------------------------------------------------------------------------------------------
select tests.act_as('00000000-0000-0000-0000-00000000000a');
update public.vendors set name_fr = 'Vendeur A' where slug = 'vendor-a';
select tests.ok(exists (
  select 1 from public.audit_log
  where table_name = 'vendors' and action = 'update' and actor_id = '00000000-0000-0000-0000-00000000000a'
    and new_row ->> 'name_fr' = 'Vendeur A' and old_row ->> 'name_fr' is null
), 'vendor update is audited with the actor and old and new values');
select tests.throws($$update public.audit_log set reason = 'x'$$, 'append-only', 'audit log rows cannot be edited');
select tests.throws($$delete from public.audit_log$$, 'append-only', 'audit log rows cannot be deleted');
select tests.throws($$truncate public.audit_log$$, 'append-only', 'audit log cannot be truncated');

rollback;
