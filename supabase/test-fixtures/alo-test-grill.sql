-- STAGING ONLY (DECISIONS §34). Never applied by the migration job and never run at the production cut-over:
-- the cut-over checklist (LOG.md, session T) lists this file. The staging deploy runs it after the seeds load:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 [-v owner_phone=+961...] -f supabase/test-fixtures/alo-test-grill.sql
-- Safe to run again: it creates the test merchant once, and on every run makes sure the test places are on
-- and the owner's phone may switch sides.
--
-- What it makes:
--   * "Alo Test Grill" in Baakline (brand, branch, kitchen contact filled in at #merchant time): a claimed,
--     orderable, non-public vendor with is_test = true, source = 'admin', 10 km radius on record (not checked: see
--     below), open 24/7, delivery and pickup, cash in USD or LBP, and a menu of 15 items in 4 sections with
--     options and a weighed item.
--   * Session T3: the test merchant accepts a pin anywhere in the world. There is no road route, no radius
--     check and no paused-place block for it, and its delivery fee is the 0-3 km band. A pin outside every
--     place polygon (Dubai, the sea, a gap) is saved against the "Test location" place made in section 1b.
--     Real merchants keep every check. The 30 km test fee band of T2 is retired (section 2b).
--   * Baakline, Bakaata, Semqanieh and Beiteddine switched on (they load "off"; the places data itself is
--     untouched, §31). The test merchant is the only orderable vendor there.
--   * The owner's phone in app_private.owner_phones with the #merchant / #customer switch on. The phone is
--     `-v owner_phone=...` when given; otherwise the only customer on the database when there is exactly one
--     (the owner, who has been writing to the sandbox bot), otherwise nobody and the switch stays off.

\set ON_ERROR_STOP on
\if :{?owner_phone}
select set_config('app.fixture_owner_phone', :'owner_phone', false);
\endif

-- No BEGIN/COMMIT here: the deploy runs this with `psql -1` (one transaction) and the database test wraps it in its own.
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'staging test fixture Alo Test Grill (DECISIONS §34)', false);

-- 1. Test places on -------------------------------------------------------------------------------------
do $$
declare
  v_id text;
begin
  foreach v_id in array array['LB-CHF-BAAKLINE', 'LB-CHF-BAKAATA', 'LB-CHF-SEMQANIEH', 'LB-CHF-BEITEDDINE'] loop
    if exists (select 1 from public.places p where p.id = v_id and p.service_status = 'off') then
      perform public.place_set_service_status(v_id, 'on', 'staging test fixture (DECISIONS §34)');
    end if;
  end loop;
end;
$$;

-- 1b. The "Test location" place (session T3) -------------------------------------------------------------
-- Pins outside every place polygon resolve to this record (address_save_pin). It is made once, copies
-- Baakline's district and centroid (the centroid is never used for routing) and is switched on like the others.
-- `source = 'test'` marks it; nothing under the frozen seeds changes (§31).
do $$
begin
  if not exists (select 1 from public.places where id = 'LB-TST-LOCATION') then
    insert into public.places (id, name_ar, name_en, kind, governorate_code, district_code, centroid, source)
    select 'LB-TST-LOCATION', 'موقع تجريبي', 'Test location', 'village', p.governorate_code, p.district_code, p.centroid, 'test'
    from public.places p where p.id = 'LB-CHF-BAAKLINE';
  end if;
  if exists (select 1 from public.places p where p.id = 'LB-TST-LOCATION' and p.service_status = 'off') then
    perform public.place_set_service_status('LB-TST-LOCATION', 'on', 'staging test fixture (DECISIONS §34)');
  end if;
end;
$$;

-- 2. The test merchant ---------------------------------------------------------------------------------
create or replace function pg_temp.add_item(
  p_vendor uuid, p_section uuid, p_sort integer, p_ar text, p_en text, p_price numeric,
  p_unit public.pricing_unit default 'each', p_kg numeric default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.menu_items (vendor_id, section_id, sort_order, name_ar, name_en, price_usd, pricing_unit, est_weight_kg)
  values (p_vendor, p_section, p_sort, p_ar, p_en, p_price, p_unit, p_kg)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function pg_temp.add_group(p_item uuid, p_ar text, p_en text, p_min integer, p_max integer, p_opts jsonb)
returns void
language plpgsql
as $$
declare
  v_group uuid;
  v_o jsonb;
  v_n integer := 0;
begin
  insert into public.menu_option_groups (item_id, name_ar, name_en, min_select, max_select)
  values (p_item, p_ar, p_en, p_min, p_max) returning id into v_group;
  for v_o in select * from jsonb_array_elements(p_opts) loop
    v_n := v_n + 1;
    insert into public.menu_options (group_id, name_ar, name_en, price_delta_usd, sort_order)
    values (v_group, v_o ->> 0, v_o ->> 1, (v_o ->> 2)::numeric, v_n);
  end loop;
end;
$$;

do $$
declare
  v_brand uuid;
  v_vendor uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_s4 uuid;
  v_item uuid;
  v_size jsonb := '[["عادي", "Regular", 0], ["كبير", "Large", 1.50]]';
begin
  select id into v_vendor from public.vendors where slug = 'alo-test-grill';
  if v_vendor is null then
    insert into public.brands (slug, name_ar, name_en) values ('alo-test-grill', 'ألو تست غريل', 'Alo Test Grill')
    on conflict (slug) do update set name_en = excluded.name_en returning id into v_brand;
    insert into public.vendors (
      brand_id, slug, name_ar, name_en, business_type, cuisine_tags, claim_status, listing_status, orderable, public_page,
      source, field_sources, location, delivery_radius_km, delivery_enabled, pickup_enabled, public_listing,
      default_prep_minutes, is_test
    ) values (
      v_brand, 'alo-test-grill', 'ألو تست غريل', 'Alo Test Grill', 'restaurant',
      array['grills_mashawi', 'shawarma', 'lebanese', 'sandwiches'], 'claimed', 'active', true, false,
      'admin', '{"test": "fixture"}', app_private.lat_lon_point(33.6770, 35.5640), 10.0, true, true, false,
      15, true
    ) returning id into v_vendor;
  end if;
  insert into public.vendor_private (vendor_id) values (v_vendor) on conflict (vendor_id) do nothing;

  if not exists (select 1 from public.menu_items where vendor_id = v_vendor) then
    insert into public.menu_sections (vendor_id, name_ar, name_en, sort_order) values (v_vendor, 'سندويشات', 'Sandwiches', 1) returning id into v_s1;
    insert into public.menu_sections (vendor_id, name_ar, name_en, sort_order) values (v_vendor, 'مشاوي', 'Grills', 2) returning id into v_s2;
    insert into public.menu_sections (vendor_id, name_ar, name_en, sort_order) values (v_vendor, 'مقبلات', 'Sides', 3) returning id into v_s3;
    insert into public.menu_sections (vendor_id, name_ar, name_en, sort_order) values (v_vendor, 'مشروبات', 'Drinks', 4) returning id into v_s4;

    v_item := pg_temp.add_item(v_vendor, v_s1, 1, 'شاورما دجاج', 'Chicken Shawarma', 4.50);
    perform pg_temp.add_group(v_item, 'الحجم', 'Size', 1, 1, v_size);
    v_item := pg_temp.add_item(v_vendor, v_s1, 2, 'شاورما لحمة', 'Beef Shawarma', 5.50);
    perform pg_temp.add_group(v_item, 'الحجم', 'Size', 1, 1, v_size);
    perform pg_temp.add_item(v_vendor, v_s1, 3, 'ساندويش فلافل', 'Falafel Sandwich', 2.50);

    v_item := pg_temp.add_item(v_vendor, v_s2, 1, 'مشاوي مشكل', 'Mixed Grill Plate', 14.00);
    perform pg_temp.add_group(v_item, 'الخبز', 'Bread', 1, 1, '[["خبز عربي", "Pita", 0], ["خبز صاج", "Saj bread", 0.50]]');
    perform pg_temp.add_item(v_vendor, v_s2, 2, 'شيش طاووق', 'Chicken Taouk Plate', 9.00);
    perform pg_temp.add_item(v_vendor, v_s2, 3, 'كفتة مشوية', 'Kafta Plate', 10.00);
    perform pg_temp.add_item(v_vendor, v_s2, 4, 'ريش غنم (بالكيلو)', 'Lamb Chops (per kg)', 28.00, 'kg', 0.400);

    perform pg_temp.add_item(v_vendor, v_s3, 1, 'حمص', 'Hummus', 3.00);
    perform pg_temp.add_item(v_vendor, v_s3, 2, 'تبولة', 'Tabbouleh', 3.50);
    perform pg_temp.add_item(v_vendor, v_s3, 3, 'بطاطا مقلية', 'French Fries', 2.50);
    perform pg_temp.add_item(v_vendor, v_s3, 4, 'ثوم', 'Toum Garlic Sauce', 0.75);

    perform pg_temp.add_item(v_vendor, v_s4, 1, 'بيبسي', 'Pepsi', 1.00);
    perform pg_temp.add_item(v_vendor, v_s4, 2, 'مي', 'Water', 0.50);
    perform pg_temp.add_item(v_vendor, v_s4, 3, 'عيران', 'Ayran', 1.00);
    v_item := pg_temp.add_item(v_vendor, v_s4, 4, 'ليموناضة بالنعنع', 'Mint Lemonade', 2.50);
    perform pg_temp.add_group(v_item, 'الحجم', 'Size', 1, 1, '[["صغير", "Small", 0], ["كبير", "Large", 1.00]]');
  end if;
end;
$$;

-- 2b. Every run (session T3): pickup and delivery on, the T2 test fee band retired ------------------------------
-- Session T2 gave the test merchant a 30 km radius through a 10-30 km fee band of $6.00 (a dated band set). The
-- test merchant now ignores the radius (public.delivery_quote), so that band goes: a new dated band set repeats
-- the three real bands (<= 10 km) and nothing above, and the radius on record returns to 10 km. Dated rows are
-- never edited, so this adds a newer set instead; it changes staging's fee table only, never production's
-- (the file is never run at the cut-over, LOG.md checklist).
do $$
begin
  if public.max_delivery_km() > 10 then
    insert into public.delivery_fee_bands (effective_from, max_km, fee_usd, created_by)
    select now(), b.max_km, b.fee_usd, null
    from public.delivery_fee_bands b
    where b.effective_from = (select max(x.effective_from) from public.delivery_fee_bands x where x.effective_from <= now())
      and b.max_km <= 10;
  end if;
  update public.vendors set delivery_radius_km = 10.0, delivery_enabled = true, pickup_enabled = true
  where slug = 'alo-test-grill' and is_test
    and (delivery_radius_km is distinct from 10.0 or not delivery_enabled or not pickup_enabled);
end;
$$;

-- 3. The owner's phone ----------------------------------------------------------------------------------
do $$
declare
  v_phone text := nullif(current_setting('app.fixture_owner_phone', true), '');
begin
  -- Simulated customers (+999, DECISIONS §36) are not the owner.
  if v_phone is null and (select count(*) from public.customers c where not app_private.is_sim_phone(c.phone_e164)) = 1 then
    select c.phone_e164 into v_phone from public.customers c where not app_private.is_sim_phone(c.phone_e164);
  end if;
  if v_phone is not null then
    insert into app_private.owner_phones (phone_e164, note, test_switch)
    values (v_phone, 'owner (staging test fixture)', true)
    on conflict (phone_e164) do update set test_switch = true;
    insert into app_private.test_sides (phone_e164) values (v_phone) on conflict (phone_e164) do nothing;
  else
    raise notice 'test fixture: no owner phone known; set GitHub secret OWNER_TEST_PHONE (see the owner issue)';
  end if;
end;
$$;

-- 4. The simulator sink (DECISIONS §36) ----------------------------------------------------------------
-- Messages to +999 test numbers are recorded in sim_outbox instead of sent. Staging only: the cut-over checklist
-- asserts config sim_sink_enabled is false on production (this file is never run there).
insert into public.app_config (key, value, effective_from, note, created_by)
select 'sim_sink_enabled', 'true', now(), 'staging fixture: simulator sink on (DECISIONS §36)', null
where not app_private.sim_sink_on();

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
