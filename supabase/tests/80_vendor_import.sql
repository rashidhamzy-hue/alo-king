-- Vendor import from the seed (§15): unclaimed and private, seed provenance, merchant data never overwritten.
begin;

insert into public.vendor_removed_places (place_id, reason) values ('gpRemoved', 'owner asked for removal');
insert into app_private.seed_vendors (place_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags,
  lat, lon, phone_seed, phone_seed_mobile, address_seed, brand_slug, brand_name_en, brand_name_ar, links, import_labels) values
  ('gpNew1', 'wooden-bakery-hazmieh', null, 'Wooden Bakery', 'Hazmieh', 'bakery_manakish', '{manakish,martian}', 33.853, 35.539,
   '+96170111111', true, 'Hazmieh', 'wooden-bakery', 'Wooden Bakery', null,
   '[{"kind":"website","url":"https://woodenbakery.example.com/","status":"unchecked"}]', '{"google_primary_type":"bakery"}'),
  ('gpNew2', 'wooden-bakery-jounieh', null, 'Wooden Bakery', 'Jounieh', 'bakery_manakish', '{manakish}', 33.98, 35.617,
   '+96170111111', true, 'Jounieh', 'wooden-bakery', 'Wooden Bakery', null, '[]', '{}'),
  ('gpNew3', 'vendor-a', 'مطعم', 'Vendor A clone', null, 'restaurant', '{lebanese}', 33.6821, 35.5861, '+9611345678', false, 'Beirut',
   null, null, null, '[{"kind":"website","url":"https://gialacucinadamore.com/","status":"unsafe"}]', '{}'),
  ('gpC', 'vendor-c', null, 'Vendor C Renamed', null, 'cafe', '{specialty_coffee}', 33.70, 35.60, '+9615999999', false, 'New address',
   null, null, null, '[]', '{}'),
  ('gpA', 'vendor-a', null, 'Vendor A from seed', null, 'restaurant', '{}', 33.68, 35.58, '+9615000000', false, 'x', null, null, null, '[]', '{}'),
  ('gpRemoved', 'removed', null, 'Removed Place', null, 'restaurant', '{}', 33.7, 35.6, null, null, null, null, null, null, '[]', '{}');
insert into app_private.seed_vendor_exclusions values ('gpX', 'TotalEnergies', 'fuel station'), ('gpNew1', 'dup', 'duplicate place_id');

select tests.ok((app_private.vendors_load_seed('vsha-1') ->> 'vendors_new')::int = 3, 'three new vendors (the removed place and existing ones are not new)');
select tests.ok(not exists (select 1 from public.vendors where place_id = 'gpRemoved'), 'a removed place is never imported again');
select tests.ok((select bool_and(claim_status = 'unclaimed' and not orderable and not public_page and source = 'seed_2026_10')
  from public.vendors where place_id in ('gpNew1', 'gpNew2', 'gpNew3')), 'imported vendors are unclaimed, not orderable, not public');
select tests.ok((select field_sources ->> 'name_en' = 'seed' and field_sources ->> 'location' = 'seed' from public.vendors where place_id = 'gpNew1'),
  'every imported field is marked seed');
select tests.ok((select cuisine_tags from public.vendors where place_id = 'gpNew1') = '{manakish}', 'unknown tags are dropped, never invented');
select tests.ok((select count(distinct brand_id) = 1 and bool_and(brand_id is not null) from public.vendors where place_id in ('gpNew1', 'gpNew2')),
  'chain branches share one brand');
select tests.ok((select slug from public.vendors where place_id = 'gpNew3') ~ '^vendor-a-[a-z0-9]+$', 'a taken slug gets a unique suffix');
select tests.ok((select phone_seed = '+96170111111' and phone_seed_mobile from public.vendor_private p join public.vendors v on v.id = p.vendor_id
  where v.place_id = 'gpNew1'), 'seed phone and mobile flag are stored privately');
select tests.ok((select status from public.vendor_links l join public.vendors v on v.id = l.vendor_id where v.place_id = 'gpNew3') = 'unsafe',
  'an unsafe link is stored flagged');
select tests.ok((select name_en from public.vendors where place_id = 'gpC') = 'Vendor C Renamed', 'an unclaimed seed vendor is refreshed');
select tests.ok((select name_en from public.vendors where place_id = 'gpA') = 'Vendor A', 'a claimed vendor is never touched by the seed');
select tests.ok((select phone_seed from public.vendor_private p join public.vendors v on v.id = p.vendor_id where v.place_id = 'gpA') = '+9615111111',
  'a claimed vendor''s private fields are never touched');
select tests.ok(exists (select 1 from public.vendor_import_exclusions where place_id = 'gpX' and reason = 'fuel station'), 'exclusions are kept with their reason');
select tests.ok(not exists (select 1 from public.vendor_import_exclusions where place_id = 'gpNew1'), 'a duplicate row of an imported place is not an exclusion');

-- A merchant confirms its name: later imports keep it.
update public.vendors set name_en = 'Wooden Bakery Hazmieh (own)', field_sources = field_sources || '{"name_en": "merchant"}' where place_id = 'gpNew1';
update app_private.seed_vendors set name_en = 'Wooden Bakery v2', branch_label = 'Hazmieh v2' where place_id = 'gpNew1';
select app_private.vendors_load_seed('vsha-2');
select tests.ok((select name_en = 'Wooden Bakery Hazmieh (own)' and branch_label = 'Hazmieh v2' from public.vendors where place_id = 'gpNew1'),
  'a re-import keeps the merchant''s field and refreshes the fields still seed');
select tests.ok((select counts ->> 'vendors_new' from app_private.seed_loads where name = 'vendors') = '0', 'a re-import creates nothing twice');

-- Access.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.count_of('select id from public.vendor_links') = 0, 'customers see no vendor links');
select tests.ok(tests.count_of('select place_id from public.vendor_import_exclusions') = 0, 'customers see no exclusions');
select tests.ok(tests.count_of($$select id from public.vendors where name_en like 'Wooden%'$$) = 0, 'customers cannot see unclaimed imported vendors');
select tests.throws($$select place_id from public.vendors$$, 'permission denied', 'customers never read place_id');
reset role;
set local role anon;
select tests.act_as(null);
select tests.throws($$select * from public.vendor_links$$, 'permission denied', 'anon cannot read vendor links');
select tests.throws($$select app_private.vendors_load_seed('x')$$, 'permission denied', 'clients cannot load a seed');
reset role;
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.count_of('select place_id from public.vendor_import_exclusions') = 1, 'operators read the exclusions');
reset role;

rollback;
