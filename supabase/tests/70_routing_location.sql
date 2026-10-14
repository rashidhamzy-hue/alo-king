-- Route cache, delivery quote and the location knowledge base (§3, §28).
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-BAAKLINE', 'CHF', 'Baakline', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-BAAKLINE', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test'),
  ('LB-CHF-BEITEDDINE', null, 'بيت الدين', 'Beiteddine', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5800 33.6950)', 'test');

set local role service_role;
select tests.act_as(null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Route cache -------------------------------------------------------------------------------------------
select tests.ok(app_private.route_point_key('SRID=4326;POINT(35.58614 33.68213)') = '33.6821,35.5861', 'points key to 4 decimals');
select tests.ok(public.route_cache_store(33.6821, 35.5861, array[33.6950, 33.6738], array[35.5800, 35.6175],
  array[2100, 4800], array[300, 540], 'ors') = 2, 'two routes stored');
select tests.ok((select array_agg(distance_m order by idx) from public.route_cache_lookup(33.68211, 35.58612,
  array[33.6738, 33.70, 33.6950], array[35.6175, 35.70, 35.5800])) = array[4800, null, 2100],
  'lookup returns cached routes in order, null for a miss, for pins within ~11 m');
select tests.ok((select expires_at between now() + interval '11 hours 59 minutes' and now() + interval '12 hours 1 minute'
  from public.route_cache limit 1), 'routes expire after the configured 12 hours');
select tests.ok(public.route_cache_store(33.6821, 35.5861, array[33.6950], array[35.5800], array[2200], array[310], 'ors') = 1
  and (select count(*) from public.route_cache) = 2, 'storing again refreshes, not duplicates');
update public.route_cache set expires_at = now() - interval '1 minute' where distance_m = 4800;
select tests.ok((select distance_m from public.route_cache_lookup(33.6821, 35.5861, array[33.6738], array[35.6175])) is null,
  'an expired route is a miss');
select tests.throws($$select public.route_cache_store(33.6, 35.5, array[33.6], array[35.6], array[1, 2], array[1], 'ors')$$,
  'same length', 'mismatched arrays are rejected');

-- Delivery quote: vendor A has a 5 km radius, vendor C none (capped by the 20 km band).
select tests.ok((select (deliverable, reason, fee_usd, limit_km) = (true, 'ok', 2.00::numeric, 5::numeric)
  from public.delivery_quote('20000000-0000-0000-0000-00000000000a', 2.4)), '2.4 road km from A: $2.00');
select tests.ok((select (deliverable, fee_usd) = (true, 3.00::numeric) from public.delivery_quote('20000000-0000-0000-0000-00000000000a', 4.9)), '4.9 km: $3.00');
select tests.ok((select (deliverable, reason) = (false, 'beyond_radius') from public.delivery_quote('20000000-0000-0000-0000-00000000000a', 5.1)),
  'beyond the vendor''s own radius: no delivery');
select tests.ok((select (deliverable, fee_usd, limit_km) = (true, 4.50::numeric, 20::numeric) from public.delivery_quote('20000000-0000-0000-0000-00000000000c', 9.5)),
  'no radius set: the largest band is the limit');
select tests.ok((select (deliverable, fee_usd) = (true, 6.00::numeric) from public.delivery_quote('20000000-0000-0000-0000-00000000000c', 18.3)),
  '18.3 road km (Jbaa from the nearest shop): $6.00');
select tests.ok((select (deliverable, reason) = (false, 'beyond_radius') from public.delivery_quote('20000000-0000-0000-0000-00000000000c', 20.5)), 'never beyond 20 km');
select tests.ok((select (deliverable, reason) = (false, 'no_route') from public.delivery_quote('20000000-0000-0000-0000-00000000000a', null)),
  'no road distance means no quote (never straight line)');
reset role;

-- Access: clients cannot use the server functions or read the cache.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.throws($$select * from public.delivery_quote('20000000-0000-0000-0000-00000000000a', 2)$$, 'permission denied', 'customers cannot call delivery_quote');
select tests.throws($$select * from public.route_cache$$, 'permission denied', 'customers cannot read the route cache');
select tests.ok(tests.count_of('select id from public.location_evidence') = 0, 'customers read no raw evidence');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.landmarks$$, 'permission denied', 'anon cannot read landmarks');
select tests.throws($$select * from public.addresses$$, 'permission denied', 'anon cannot read addresses');
reset role;

-- Addresses -------------------------------------------------------------------------------------------
insert into public.addresses (id, customer_id, place_id, pin, source, note) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5861 33.6821)', 'pin', 'green gate'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5870 33.6830)', 'pin', null),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'LB-CHF-BEITEDDINE', null, 'list', null);
select tests.throws($$insert into public.addresses (customer_id, place_id, source) values ('10000000-0000-0000-0000-000000000001', 'LB-CHF-BAAKLINE', 'pin')$$,
  'addresses_pin_from_pin', 'a pin address needs its pin');
select tests.throws($$insert into public.addresses (customer_id, pin, source) values ('10000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.5 33.6)', 'pin')$$,
  'null value in column "place_id"', 'every address has a place (free text alone is never an address)');

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.count_of('select id from public.addresses') = 1, 'a customer sees only its own addresses');
update public.addresses set note = 'blue gate' where id = '30000000-0000-0000-0000-000000000001';
update public.addresses set note = 'hijack' where id = '30000000-0000-0000-0000-000000000002';
select tests.throws($$update public.addresses set place_id = 'LB-CHF-BEITEDDINE'$$, 'permission denied', 'a customer cannot move its address to another place directly');
reset role;
select tests.ok((select note from public.addresses where id = '30000000-0000-0000-0000-000000000001') = 'blue gate', 'a customer edits its own note');
select tests.ok((select note from public.addresses where id = '30000000-0000-0000-0000-000000000002') is null, 'a customer cannot edit another customer''s note');
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.count_of('select id from public.addresses') = 3, 'operators read all addresses');
reset role;

-- Door points: two agreeing deliveries confirm; one bad fix and one inaccurate fix are ignored.
insert into public.location_evidence (kind, supporter_kind, supporter_user_id, address_id, customer_id, point, accuracy_m) values
  ('door_gps', 'driver', '00000000-0000-0000-0000-00000000000f', '30000000-0000-0000-0000-000000000001', null, 'SRID=4326;POINT(35.58650 33.68230)', 8);
select public.location_promote_all();
select tests.ok((select status = 'unconfirmed' and support_deliveries = 1 from public.door_points where address_id = '30000000-0000-0000-0000-000000000001'),
  'one delivery gives a candidate door point');
insert into public.location_evidence (kind, supporter_kind, supporter_user_id, address_id, point, accuracy_m) values
  ('door_gps', 'driver', '00000000-0000-0000-0000-00000000000f', '30000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.58660 33.68236)', 12),
  ('door_gps', 'driver', '00000000-0000-0000-0000-00000000000f', '30000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.59000 33.68500)', 5),
  ('door_gps', 'driver', '00000000-0000-0000-0000-00000000000f', '30000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.58655 33.68233)', 80);
select public.location_promote_all();
select tests.ok((select status = 'confirmed' and support_deliveries = 2
    and extensions.st_distance(point, 'SRID=4326;POINT(35.58655 33.68233)') < 2
  from public.door_points where address_id = '30000000-0000-0000-0000-000000000001'),
  'two agreeing deliveries confirm the median as the door point; outliers and inaccurate fixes do not count');

-- Buildings: 3 distinct customers, or 1 customer + 1 driver.
insert into public.buildings (id, place_id, name_en, entrance_point) values
  ('40000000-0000-0000-0000-000000000001', 'LB-CHF-BAAKLINE', 'Abou Fadi building', 'SRID=4326;POINT(35.58655 33.68233)');
insert into public.location_evidence (kind, supporter_kind, customer_id, building_id, point) values
  ('building_name', 'customer', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.58657 33.68234)'),
  ('building_name', 'customer', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.58656 33.68232)');
select public.location_promote_all();
select tests.ok((select status from public.buildings) = 'unconfirmed', 'one customer alone never confirms a building');
insert into public.location_evidence (kind, supporter_kind, supporter_user_id, building_id, point) values
  ('confirmation', 'driver', '00000000-0000-0000-0000-00000000000f', '40000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.58654 33.68233)');
select public.location_promote_all();
select tests.ok((select status = 'confirmed' and not shared and support_people = 2 from public.buildings),
  '1 customer + 1 driver confirms a building, but 2 people do not make it shared');
insert into public.location_evidence (kind, supporter_kind, customer_id, building_id, point) values
  ('building_name', 'customer', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.58655 33.68235)');
select public.location_promote_all();
select tests.ok((select shared and support_people = 3 from public.buildings), '3 distinct people make a building shared knowledge');

-- Landmarks: 2 distinct customers within 150 m, or a merchant confirmation; contradictions are demoted.
insert into public.landmarks (id, place_id, name_en, point) values
  ('50000000-0000-0000-0000-000000000001', 'LB-CHF-BAAKLINE', 'Saint Elias church', 'SRID=4326;POINT(35.5850 33.6815)'),
  ('50000000-0000-0000-0000-000000000002', 'LB-CHF-BAAKLINE', 'The old school', 'SRID=4326;POINT(35.5880 33.6800)');
insert into public.landmarks (place_id, name_en, point, source) values
  ('LB-CHF-BAAKLINE', 'Baakline municipality', 'SRID=4326;POINT(35.5860 33.6820)', 'seed');
insert into public.location_evidence (kind, supporter_kind, customer_id, landmark_id, point) values
  ('landmark_name', 'customer', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.5855 33.6818)'),
  ('landmark_name', 'customer', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.5845 33.6810)');
insert into public.location_evidence (kind, supporter_kind, vendor_id, landmark_id) values
  ('confirmation', 'merchant', '20000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000002');
select public.location_promote_all();
select tests.ok((select status from public.landmarks where id = '50000000-0000-0000-0000-000000000001') = 'confirmed', '2 customers within 150 m confirm a landmark');
select tests.ok((select status from public.landmarks where id = '50000000-0000-0000-0000-000000000002') = 'confirmed', 'a merchant confirmation confirms a landmark');
select tests.ok((select status = 'confirmed' and shared from public.landmarks where source = 'seed'), 'seed landmarks are confirmed and shared');
insert into public.location_evidence (kind, supporter_kind, customer_id, landmark_id, point) values
  ('landmark_name', 'customer', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.6100 33.7000)'),
  ('landmark_name', 'customer', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'SRID=4326;POINT(35.6110 33.7010)');
select public.location_promote_all();
select tests.ok((select status from public.landmarks where id = '50000000-0000-0000-0000-000000000001') = 'unconfirmed', 'contradicting pins demote a landmark');
select tests.ok(exists (select 1 from public.location_review_items where subject_table = 'landmarks' and subject_id = '50000000-0000-0000-0000-000000000001' and resolved_at is null),
  'a contradiction opens one review item');
select public.location_promote_all();
select tests.ok((select count(*) from public.location_review_items) = 1, 'a second run does not duplicate the review item');

-- Place aliases and street aliases.
insert into public.place_aliases (id, place_id, alias, lang) values ('60000000-0000-0000-0000-000000000001', 'LB-CHF-BAAKLINE', 'ba3aleen', 'arabizi');
insert into public.customers (id, phone_e164) values ('10000000-0000-0000-0000-000000000003', '+96170000003');
insert into public.location_evidence (kind, supporter_kind, customer_id, place_alias_id) values
  ('place_alias', 'customer', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'),
  ('place_alias', 'customer', '10000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001'),
  ('place_alias', 'customer', '10000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001');
select public.location_promote_all();
select tests.ok((select status from public.place_aliases) = 'unconfirmed', 'the same customer twice counts once: 2 of 3');
insert into public.location_evidence (kind, supporter_kind, customer_id, place_alias_id) values
  ('place_alias', 'customer', '10000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001');
select public.location_promote_all();
select tests.ok((select status = 'confirmed' and shared from public.place_aliases), '3 distinct customers confirm a place alias');

insert into public.street_aliases (id, place_id, name, road) values
  ('70000000-0000-0000-0000-000000000001', 'LB-CHF-BAAKLINE', 'طريق الجامع', 'SRID=4326;LINESTRING(35.5850 33.6800,35.5850 33.6850)');
insert into public.location_evidence (kind, supporter_kind, customer_id, street_alias_id, order_id, point) values
  ('street_name', 'customer', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', gen_random_uuid(), 'SRID=4326;POINT(35.5852 33.6820)'),
  ('street_name', 'customer', '10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', gen_random_uuid(), 'SRID=4326;POINT(35.5853 33.6825)'),
  ('street_name', 'customer', '10000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', gen_random_uuid(), 'SRID=4326;POINT(35.5900 33.6825)');
select public.location_promote_all();
select tests.ok((select status = 'unconfirmed' and support_orders = 2 from public.street_aliases), 'a mention 450 m from the road does not count');
insert into public.location_evidence (kind, supporter_kind, customer_id, street_alias_id, order_id, point) values
  ('street_name', 'customer', '10000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', gen_random_uuid(), 'SRID=4326;POINT(35.5849 33.6830)');
select public.location_promote_all();
select tests.ok((select status from public.street_aliases) = 'confirmed', '3 orders within 40 m confirm a street name');

-- Delete my data (§28.3).
select tests.ok((select (public.location_forget_customer('10000000-0000-0000-0000-000000000003') -> 'evidence')::int) = 3, 'forget removes the customer''s evidence');
select tests.ok((select status from public.place_aliases) = 'unconfirmed' and (select status from public.street_aliases) = 'unconfirmed',
  'shared entities below their threshold after a forget are demoted');
select public.location_forget_customer('10000000-0000-0000-0000-000000000001');
select tests.ok(not exists (select 1 from public.addresses where customer_id = '10000000-0000-0000-0000-000000000001'), 'forget removes addresses');
select tests.ok(not exists (select 1 from public.door_points where address_id = '30000000-0000-0000-0000-000000000001'), 'forget removes door points');

-- Estimates: below the threshold the defaults apply.
insert into public.travel_time_stats (origin_place_id, dest_place_id, hour, weekday, winter, trips, correction_factor) values
  ('LB-CHF-BAAKLINE', 'LB-CHF-BEITEDDINE', 13, 3, false, 19, 1.5);
select tests.ok(public.eta_travel_s(600, 'LB-CHF-BAAKLINE', 'LB-CHF-BEITEDDINE', '2026-07-08 13:30+03') = 600, '19 trips: the default factor (1.0) applies');
update public.travel_time_stats set trips = 20;
select tests.ok(public.eta_travel_s(600, 'LB-CHF-BAAKLINE', 'LB-CHF-BEITEDDINE', '2026-07-08 13:30+03') = 900, '20 trips: the learned factor applies');
select tests.ok(public.eta_travel_s(600, 'LB-CHF-BAAKLINE', 'LB-CHF-BEITEDDINE', '2026-01-07 13:30+02') = 600, 'a summer cell is not used in winter');
insert into public.handover_time_stats (place_id, deliveries, p50_s) values ('LB-CHF-BAAKLINE', 4, 120);
select tests.ok(public.handover_estimate_s('LB-CHF-BAAKLINE') is null, 'handover estimate needs 5 deliveries');

-- Road incidents: a re-report nearby extends, a new one elsewhere is separate.
select public.road_incident_report('snow', 'SRID=4326;POINT(35.5861 33.6821)');
select public.road_incident_report('snow', 'SRID=4326;POINT(35.5870 33.6825)');
select public.road_incident_report('closure', 'SRID=4326;POINT(35.5870 33.6825)');
select tests.ok((select reports from public.road_incidents where kind = 'snow') = 2 and (select count(*) from public.road_incidents) = 2,
  'a nearby re-report of the same kind extends the incident');
select tests.ok((select expires_at between now() + interval '5 hours 59 minutes' and now() + interval '6 hours 1 minute'
  from public.road_incidents where kind = 'snow'), 'incidents expire 6 hours after the last report');
select tests.ok((select place_id from public.road_incidents where kind = 'closure') = 'LB-CHF-BAAKLINE', 'incidents are placed by their pin');

-- Nightly job exists and runs.
select tests.ok(exists (select 1 from cron.job where jobname = 'location-nightly'), 'the nightly location job is scheduled');
select tests.ok(app_private.location_nightly() ? 'route_cache_purged', 'the nightly job runs');

rollback;
