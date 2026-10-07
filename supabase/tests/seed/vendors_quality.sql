-- Quality checks on the real vendor import (DECISIONS §15.2), run by scripts/db-test.sh after loading it.
begin;

select tests.ok((select count(*) from public.vendors where source = 'seed_2026_10') between 1500 and 2087,
  'most of the 2,087 rows are imported (the rest excluded with a reason)');
-- Rows from the file carry Google place IDs (ChIJ...); the test fixtures in 00_helpers.sql do not.
select tests.ok((select count(*) from public.vendors where source = 'seed_2026_10' and place_id like 'ChIJ%')
  + (select count(*) from public.vendor_import_exclusions) = 2087, 'every row is imported or excluded, once');
select tests.ok(not exists (select 1 from public.vendors v join public.vendor_import_exclusions e using (place_id)),
  'nothing is both imported and excluded');
select tests.ok(not exists (select 1 from public.vendors where source = 'seed_2026_10'
  and (claim_status <> 'unclaimed' or orderable or public_page)), 'every imported vendor is unclaimed, not orderable, not public');
select tests.ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
  and column_name ~ '(rating|review)'), 'no rating or review column exists anywhere');
select tests.ok(exists (select 1 from public.vendor_import_exclusions where reason = 'fuel station'), 'fuel stations are excluded');
select tests.ok(exists (select 1 from public.vendors where source = 'seed_2026_10' and business_type = 'home_essentials'),
  'water and gas delivery are kept as home essentials');
select tests.ok((select count(*) from (select brand_id from public.vendors where brand_id is not null group by 1 having count(*) > 1) b) >= 5,
  'chains are grouped into brands');
select tests.ok(not exists (select 1 from public.vendor_links where url ilike '%gialacucinadamore%' and status <> 'unsafe'),
  'the hijacked domain is flagged unsafe');
select tests.ok((select count(*) filter (where v.business_type = 'other_food') * 1.0 / count(*) from public.vendors v where source = 'seed_2026_10') < 0.1,
  'fewer than 10% fall back to other_food');
select tests.ok(not exists (select 1 from public.places) or
  (select count(*) filter (where town_id is not null) * 1.0 / nullif(count(*) filter (where location is not null), 0)
   from public.vendors where source = 'seed_2026_10') >= 0.95, 'at least 95% of located vendors have a town (when places are loaded)');

rollback;
