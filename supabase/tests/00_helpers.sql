-- Test helpers, loaded once after the migrations into a throwaway database (scripts/db-test.sh).
-- Never applied to staging: this folder is not a migrations folder.
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAILED: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end;
$$;

-- Runs p_sql as the current role and expects it to fail with a message matching p_pattern.
create function tests.throws(p_sql text, p_pattern text, p_msg text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~* p_pattern then
      raise notice 'ok - %', p_msg;
      return;
    end if;
    raise exception 'FAILED: % (wrong error: %)', p_msg, sqlerrm;
  end;
  raise exception 'FAILED: % (no error raised)', p_msg;
end;
$$;

create function tests.count_of(p_sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into n;
  return n;
end;
$$;

-- Act as a signed-in user (null = anonymous), the way PostgREST sets the request.
create function tests.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_user is null then '{"role":"anon"}'
         else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Fixed people and vendors used by every test file.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'operator@test.invalid'),
  ('00000000-0000-0000-0000-00000000000c', 'customer@test.invalid'),
  ('00000000-0000-0000-0000-00000000000d', 'customer2@test.invalid'),
  ('00000000-0000-0000-0000-00000000000e', 'owner@test.invalid'),
  ('00000000-0000-0000-0000-00000000000f', 'cashier@test.invalid'),
  ('00000000-0000-0000-0000-000000000010', 'owner2@test.invalid');

insert into public.operators (user_id, role, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', 'operator', 'Operator');

insert into public.customers (id, phone_e164, user_id, display_name) values
  ('10000000-0000-0000-0000-000000000001', '+96170000001', '00000000-0000-0000-0000-00000000000c', 'Customer One'),
  ('10000000-0000-0000-0000-000000000002', '+96170000002', '00000000-0000-0000-0000-00000000000d', 'Customer Two');

-- Vendor A: claimed and public. Vendor B: claimed, not public. Vendor C: unclaimed seed.
insert into public.vendors (id, slug, name_en, business_type, claim_status, public_page, orderable, source, place_id, location, delivery_radius_km) values
  ('20000000-0000-0000-0000-00000000000a', 'vendor-a', 'Vendor A', 'restaurant', 'claimed', true, true, 'merchant', 'gpA', 'SRID=4326;POINT(35.58 33.68)', 5),
  ('20000000-0000-0000-0000-00000000000b', 'vendor-b', 'Vendor B', 'bakery_manakish', 'claimed', false, false, 'merchant', 'gpB', 'SRID=4326;POINT(35.59 33.69)', 3),
  ('20000000-0000-0000-0000-00000000000c', 'vendor-c', 'Vendor C', 'cafe', 'unclaimed', false, false, 'seed_2026_10', 'gpC', 'SRID=4326;POINT(35.60 33.70)', null);

insert into public.vendor_private (vendor_id, phone_seed, address_seed) values
  ('20000000-0000-0000-0000-00000000000a', '+9615111111', 'Seed address A'),
  ('20000000-0000-0000-0000-00000000000b', '+9615222222', 'Seed address B'),
  ('20000000-0000-0000-0000-00000000000c', '+9615333333', 'Seed address C');

insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e', '+96171000001', 'owner', 'active'),
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000f', '+96171000002', 'cashier', 'active'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000010', '+96171000003', 'owner', 'active');

-- A fixture order the ledger tests post against (orders exist from Phase 2; ledger_transactions.order_id
-- has a foreign key). Pickup, so it needs no address.
update public.vendors set pickup_enabled = true where id = '20000000-0000-0000-0000-00000000000a';
insert into public.orders (id, code, idempotency_key, customer_id, vendor_id, status, fulfilment, payment_method,
  menu_version, usd_lbp_rate, food_subtotal_usd, total_usd, order_fee_usd, placed_at) values
  ('30000000-0000-0000-0000-000000000001', 'TESTA2', 'tests:fixture-order-1', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-00000000000a', 'placed', 'pickup', 'cod', 1, 89500, 12.50, 12.50, 1.00, now());
