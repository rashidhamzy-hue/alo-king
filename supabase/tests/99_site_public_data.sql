-- Session 6a (DECISIONS §37, §5, §3): what the public website reads, and the signed tracking link.
-- Visibility: only a claimed, public, active vendor appears; menus show available items only; allergens only when the
-- merchant confirmed them. Tracking: unguessable token, hash stored, expiry, and nothing personal in the answer.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-SITE', 'CHF', 'Sitetown', 'SRID=4326;MULTIPOLYGON(((35.57 33.67,35.60 33.67,35.60 33.695,35.57 33.695,35.57 33.67)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, name_fr, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-SITETOWN', 'TZ-SITE', 'سايتتاون', 'Sitetown', 'Sitetown', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.5861 33.6821)', 'test'),
  ('LB-CHF-SITEOFF', null, null, 'Siteoff', null, 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.59 33.69)', 'test');
select public.place_set_service_status('LB-CHF-SITETOWN', 'on', 'test');

-- Vendor A (public, claimed, orderable) lives in Sitetown; B (claimed, not public) and C (unclaimed) must never show.
update public.vendors set town_id = 'LB-CHF-SITETOWN', cuisine_tags = '{lebanese}', name_ar = 'المحل أ' where id = '20000000-0000-0000-0000-00000000000a';
update public.vendors set town_id = 'LB-CHF-SITETOWN', cuisine_tags = '{lebanese}' where id in ('20000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000c');
insert into public.menu_sections (id, vendor_id, name_en, name_ar, sort_order) values
  ('40000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000000a', 'Mains', 'أطباق', 1);
insert into public.menu_items (id, vendor_id, section_id, name_en, price_usd, available, vegetarian, allergens, allergens_confirmed_at, sort_order) values
  ('41000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a1', 'Falafel', 3.00, true, true, '{sesame}', now(), 1),
  ('41000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a1', 'Hummus', 4.00, true, true, '{sesame}', null, 2),
  ('41000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a1', 'Sold out dish', 9.00, false, false, '{}', null, 3),
  ('41000000-0000-0000-0000-0000000000a4', '20000000-0000-0000-0000-00000000000a', null, 'Loose item', 1.00, true, false, '{}', null, 4);
insert into public.vendor_hours (vendor_id, weekday, opens, closes) values
  ('20000000-0000-0000-0000-00000000000a', 1, '09:00', '22:00');

set local role anon;

-- Overview -------------------------------------------------------------------------------------------------------
select public.site_overview() as ov \gset
select tests.ok((:'ov'::jsonb -> 'places') @> '[{"id": "LB-CHF-SITETOWN", "slug": "chf-sitetown", "merchants": 1}]'::jsonb,
  'the overview lists a place that is switched on, with its one live merchant');
select tests.ok(not ((:'ov'::jsonb -> 'places') @> '[{"id": "LB-CHF-SITEOFF"}]'::jsonb), 'a place that is off is not listed');
select tests.ok((:'ov'::jsonb ->> 'merchants')::int = 1, 'only vendor A is a live public merchant (B is not public, C is unclaimed)');
select tests.ok((:'ov'::jsonb -> 'fees' ->> 'min_usd')::numeric = public.delivery_fee_usd(0)
  and (:'ov'::jsonb ->> 'order_fee_usd')::numeric = public.price_usd('order_fee')
  and (:'ov'::jsonb ->> 'rate')::numeric = public.usd_lbp_rate(), 'fees, order fee and rate come from the dated tables, not from the page');
select tests.ok((:'ov'::jsonb -> 'cuisines') @> '[{"tag": "lebanese", "vendors": 1}]'::jsonb, 'a cuisine counts only public vendors');
select tests.ok(public.site_vendor_slugs()::text like '%vendor-a%' and public.site_vendor_slugs()::text not like '%vendor-b%'
  and public.site_vendor_slugs()::text not like '%vendor-c%', 'the sitemap list holds public vendors only');

-- Place page -----------------------------------------------------------------------------------------------------
select tests.ok(public.site_place('chf-siteoff') is null, 'a place that is off has no page');
select tests.ok(public.site_place('nope-nope') is null and public.site_place('x; drop table') is null, 'unknown or malformed slugs return null');
select public.site_place('chf-sitetown') as pl \gset
select tests.ok(:'pl'::jsonb #>> '{place,name_en}' = 'Sitetown' and jsonb_array_length(:'pl'::jsonb -> 'vendors') = 1
  and :'pl'::jsonb #>> '{vendors,0,slug}' = 'vendor-a', 'the place page lists its public vendor only');
select tests.ok(not (:'pl'::text like '%35.58%') and not (:'pl'::text like '%Seed address%') and not (:'pl'::text like '%+96%'),
  'no vendor coordinates, seed address or phone in the place document');

-- Cuisine page ---------------------------------------------------------------------------------------------------
select public.site_cuisine('lebanese') as cu \gset
select tests.ok(jsonb_array_length(:'cu'::jsonb -> 'vendors') = 1, 'the cuisine page lists public vendors only');
select tests.ok(public.site_cuisine('does_not_exist') is null, 'an unknown cuisine returns null');

-- Vendor page ----------------------------------------------------------------------------------------------------
select tests.ok(public.site_vendor('vendor-b') is null, 'a claimed but non-public vendor has no page');
select tests.ok(public.site_vendor('vendor-c') is null, 'an unclaimed vendor has no page');
select public.site_vendor('vendor-a') as vp \gset
select tests.ok(:'vp'::jsonb #>> '{vendor,name_en}' = 'Vendor A' and :'vp'::jsonb #>> '{vendor,place_en}' = 'Sitetown', 'the vendor page has its name and area');
select tests.ok(jsonb_array_length(:'vp'::jsonb -> 'sections') = 2, 'two sections: Mains and the loose items');
select tests.ok(:'vp'::text like '%Falafel%' and :'vp'::text like '%Hummus%' and :'vp'::text not like '%Sold out dish%',
  'available items only');
select tests.ok((:'vp'::jsonb #> '{sections,0,items,0,allergens}') = '["sesame"]'::jsonb
  and (:'vp'::jsonb #> '{sections,0,items,1,allergens}') = 'null'::jsonb, 'allergens show only when the merchant confirmed them');
select tests.ok(jsonb_array_length(:'vp'::jsonb -> 'hours') = 1, 'hours are returned');
select tests.ok(not (:'vp'::text like '%location%') and not (:'vp'::text like '%phone%') and not (:'vp'::text like '%Seed address%')
  and not (:'vp'::text like '%gpA%'), 'no coordinates, phones or seed fields leak into the vendor document');
select tests.ok(public.site_vendor('Vendor A; --') is null, 'a malformed slug returns null');

reset role;

-- Tracking link --------------------------------------------------------------------------------------------------
select tests.ok(not has_function_privilege('anon', 'public.order_tracking_link_create(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.order_tracking_link_create(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.order_tracking_link_create(uuid)', 'execute'),
  'only the service role makes tracking links');
select tests.ok(not has_table_privilege('anon', 'public.order_tracking_links', 'select')
  and not has_table_privilege('authenticated', 'public.order_tracking_links', 'select'), 'the link table is closed to clients');
select public.order_tracking_link_create('30000000-0000-0000-0000-000000000001') as tok \gset
select tests.ok(length(:'tok') between 40 and 60 and :'tok' ~ '^[A-Za-z0-9_-]+$', 'the token is long, URL-safe and unpadded');
select tests.ok((select count(*) from public.order_tracking_links where encode(token_hash, 'escape') = :'tok') = 0
  and (select count(*) from public.order_tracking_links) = 1, 'the table stores a hash, never the token');
select tests.ok(public.order_tracking_link_create('99999999-0000-0000-0000-000000000000') is null, 'no link for an unknown order');
select tests.ok((select expires_at - created_at from public.order_tracking_links limit 1) = make_interval(hours => public.config_numeric('tracking_link_hours')::int),
  'the link lasts the configured hours');

set local role anon;
select public.order_track_public(:'tok') as tr \gset
select tests.ok(:'tr'::jsonb ->> 'code' = 'TESTA2' and :'tr'::jsonb ->> 'status' = 'placed' and :'tr'::jsonb ->> 'fulfilment' = 'pickup'
  and (:'tr'::jsonb ->> 'total_usd')::numeric = 12.50, 'a valid link shows code, status, fulfilment and total');
select tests.ok(:'tr'::jsonb ->> 'area_en' is null, 'a pickup order has no area');
select tests.ok(not (:'tr'::text ~* '(customer|phone|address|pin|lat|lon|item|delivery_code)'), 'nothing personal or itemised is in the answer');
select tests.ok(public.order_track_public('A' || repeat('b', 42)) is null and public.order_track_public(null) is null
  and public.order_track_public('short') is null and public.order_track_public(:'tok' || 'x') is null, 'wrong, short, null or altered tokens return null');
reset role;

update public.order_tracking_links set expires_at = now() - interval '1 minute';
set local role anon;
select tests.ok(public.order_track_public(:'tok') is null, 'an expired link returns null, the same as an unknown one');
reset role;

rollback;
