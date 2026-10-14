-- Session E, DECISIONS §39.2: the delivery area. Merchants stay in the 12 pilot villages (§38.1); customers can order
-- to every place whose centre is within max_delivery_km() in a straight line of at least one pilot merchant. Price and
-- the per-order road check stay per order (§29.1): a far address gets the higher band or "too far for this shop".
--
--   * `pilot_merchant_place_ids` (new dated config): the 12 villages merchants are placed in. The Shouf load reads it
--     (a merchant whose row names no village gets the nearest of these), so widening the delivery area never moves a
--     merchant.
--   * `pilot_place_ids` (new dated row, authoritative): every place switched on. `app_private.pilot_places_apply()`
--     switches these on and everything else off, as before (paused places stay paused).
--   * `public.delivery_area_proposal()`: the rule as a query, from the merchants' coordinates. It proposes; a dated
--     `pilot_place_ids` row decides. The seed check `supabase/tests/seed/shouf_delivery_area.sql` fails when the two
--     disagree, so a merchant added outside the area shows up as a pending change.
-- The 259 places below are the proposal on 14 October (315 Shouf merchants, 10 km), Beiteddine included (switched off
-- by mistake in session D). The OSM landmarks and place names are fetched again for the whole area by the deploy job
-- (scripts/shouf/osm-fetch.mjs --margin-km), and the OSM loader already keys its place names on pilot_place_ids.
--
-- Also (§39.4 source 1): the owner's menu photos (04_owner_menu_photos_2026-10-14.json) load as seed drafts with
-- `source_url` and `captured_at`; the Shouf load removes an unclaimed duplicate listing (Nayeh w Meshwiyeh's second
-- place id); the section card shows LBP prices with the dollars they become at approval.

insert into public.app_config (key, value, effective_from, note, created_by) values
  ('pilot_merchant_place_ids', '["LB-CHF-BAAKLINE", "LB-CHF-BAKAATA", "LB-CHF-BAROUK", "LB-CHF-DEIR-AL-QAMAR", "LB-CHF-SEMQANIEH", "LB-CHF-BATLOUN", "LB-CHF-KFAR-NABRAKH", "LB-CHF-KFARHIM", "LB-CHF-DAMIT", "LB-CHF-AIN-OUZAIN", "LB-CHF-MAASSER-EL-SHOUF", "LB-CHF-JDEIDET-EL-CHOUF"]',
   '2026-10-14 12:00+00', 'Shouf pilot: the 12 villages merchants are in (DECISIONS §38.1, §39.2)', null),
  ('pilot_place_ids', '[
     "LB-ALY-AAYNAB", "LB-ALY-ABEY", "LB-ALY-AIN-ANOUB", "LB-ALY-AIN-DARA", "LB-ALY-AIN-DRAFIL", "LB-ALY-AIN-EL-FRAYDIS",
     "LB-ALY-AIN-EL-HALAZOUN", "LB-ALY-AIN-EL-MARJ", "LB-ALY-AIN-KSOUR", "LB-ALY-AIN-TREZ", "LB-ALY-ARAMOUN", "LB-ALY-AYTAT",
     "LB-ALY-BAAOURTA", "LB-ALY-BAYSOUR", "LB-ALY-BEDGHANE", "LB-ALY-BESHAMOUN", "LB-ALY-BHAMDOUN", "LB-ALY-BHAMDOUN-AL-MAHATTA",
     "LB-ALY-BHAMDOUN-ED-DAYAA", "LB-ALY-BHOUARA", "LB-ALY-BMAHRAY", "LB-ALY-BMEKKINE", "LB-ALY-BOU-ZRIDEH", "LB-ALY-BSATINE",
     "LB-ALY-BSERRINE", "LB-ALY-BTALLOUN", "LB-ALY-BTATER", "LB-ALY-CHAROUN", "LB-ALY-CHEMLANE", "LB-ALY-DAQQOUN",
     "LB-ALY-DAWHA-ARAMOUN", "LB-ALY-DFOUN", "LB-ALY-DOUAIR-EL-REMMANEH", "LB-ALY-DOUHA", "LB-ALY-EL-AAZZOUNIYE", "LB-ALY-EL-BINNAY",
     "LB-ALY-GHABOUN", "LB-ALY-HABRAMOUN", "LB-ALY-HARET-CHBIB", "LB-ALY-HOMS-OUA-HAMA", "LB-ALY-IGHMID", "LB-ALY-JISR-EL-QADI",
     "LB-ALY-KEYFOUN", "LB-ALY-KFAR-AMAY", "LB-ALY-KFAR-MATTA", "LB-ALY-KHALDE", "LB-ALY-KHNADIQ-DARTE", "LB-ALY-MAASRITI",
     "LB-ALY-MAJDAL-BAANA", "LB-ALY-MAJDALAYA", "LB-ALY-MANSOURIET-BHAMDOUN", "LB-ALY-MAZRAAT-EN-NAHR", "LB-ALY-MESHAKHTI", "LB-ALY-MESHERFE",
     "LB-ALY-MRAYJAT", "LB-ALY-N13158648782", "LB-ALY-N6956249799", "LB-ALY-QABR-CHAMOUN", "LB-ALY-RAMLIEH", "LB-ALY-RECHMAIYA",
     "LB-ALY-REJMEH", "LB-ALY-RIMHALA", "LB-ALY-ROUAYSSET-EN-NAAMANE", "LB-ALY-RWAISAT-SAWFAR", "LB-ALY-SARHMOUL", "LB-ALY-SAWFAR",
     "LB-ALY-SEBAAL", "LB-ALY-SELFAYA", "LB-ALY-SHAMLIKH", "LB-ALY-SHANAY", "LB-ALY-SHARTOUN", "LB-ALY-SOUK-EL-GHARB",
     "LB-ALY-TAAZANIYEH", "LB-ALY-TOUEIT-AIN-DARA", "LB-BAB-AL-KHURAYBA", "LB-BAB-CHBANIYE", "LB-BAB-DAHR-EL-BAIDAR", "LB-BAB-MDAIREJ",
     "LB-BAB-QOUBBEIAA", "LB-BAB-QRAIYEH", "LB-BAB-RAS-EL-HARF", "LB-CHF-AABDOU-ES-SAHRA", "LB-CHF-AAMMIQ-EL-CHOUF", "LB-CHF-AANOUT",
     "LB-CHF-AAQABEH", "LB-CHF-AATHRINE", "LB-CHF-AIN-OUZAIN", "LB-CHF-AIN-QANI", "LB-CHF-AIN-ZHALTA", "LB-CHF-AINBAL",
     "LB-CHF-AL-MASRAB", "LB-CHF-AL-MUGHAYRIYYA", "LB-CHF-AL-MUTULLA", "LB-CHF-AMMATOUR", "LB-CHF-BAADARAN", "LB-CHF-BAAKLINE",
     "LB-CHF-BAASSIR", "LB-CHF-BAB-EL-MARMA", "LB-CHF-BAIQOUN", "LB-CHF-BAKAATA", "LB-CHF-BAKIFA", "LB-CHF-BARJA",
     "LB-CHF-BAROUK", "LB-CHF-BATER", "LB-CHF-BATLOUN", "LB-CHF-BCHETFINE", "LB-CHF-BEITEDDINE", "LB-CHF-BENOUATI-ECH-CHOUF",
     "LB-CHF-BKECHTINE-OUEL-MCHEIAA", "LB-CHF-BORJEIN", "LB-CHF-BOUTMEH", "LB-CHF-BQAIAA-ECH-CHOUF", "LB-CHF-BRIH", "LB-CHF-BSABA",
     "LB-CHF-CHEMMIS", "LB-CHF-CHMAARINE", "LB-CHF-CHOUALIQ-DEIR-EL-QAMAR", "LB-CHF-CHOURIT", "LB-CHF-DAHR-AIN-EL-HAOUR", "LB-CHF-DAHR-EL-AAQLINE",
     "LB-CHF-DAHR-EL-MAGHARA", "LB-CHF-DALHOUN", "LB-CHF-DAMIT", "LB-CHF-DAMOUR", "LB-CHF-DARAIYA", "LB-CHF-DEBBIEH",
     "LB-CHF-DEIR-AL-QAMAR", "LB-CHF-DEIR-BABA", "LB-CHF-DEIR-DOURIT", "LB-CHF-DEIR-EL-MKHALLES", "LB-CHF-DEIR-KOUCHEH", "LB-CHF-DELGHANI",
     "LB-CHF-EJ-JLEILIYE", "LB-CHF-EL-BIREH", "LB-CHF-EL-BLAYET", "LB-CHF-EL-HAFFE", "LB-CHF-EL-KHERBE", "LB-CHF-EL-KHRAIBE",
     "LB-CHF-EL-MAANIYE", "LB-CHF-EL-MSIL", "LB-CHF-EN-NABI-YOUNES", "LB-CHF-ES-SAADIYAT", "LB-CHF-ES-SAOUANE", "LB-CHF-EZ-ZAAROURIYE",
     "LB-CHF-FAWARA", "LB-CHF-FRAIDIS", "LB-CHF-GHABET-JAAFAR", "LB-CHF-GHARIFE", "LB-CHF-HARET-BEIT-MADI", "LB-CHF-HARET-JANDAL",
     "LB-CHF-HASROUT", "LB-CHF-JAHLIYEH", "LB-CHF-JBAA", "LB-CHF-JDEIDET-EL-CHOUF", "LB-CHF-KAHLOUNIYEH", "LB-CHF-KARM-ECH-CHEIKH-YOUSSEF",
     "LB-CHF-KETERMAYA", "LB-CHF-KFAR-FAQOUD", "LB-CHF-KFAR-HAMEL", "LB-CHF-KFAR-HAY", "LB-CHF-KFAR-KATRA", "LB-CHF-KFAR-NABRAKH",
     "LB-CHF-KFAR-NISS", "LB-CHF-KFARHIM", "LB-CHF-KHALLAT-ACH-CHAAR", "LB-CHF-KHALLAT-AL-KABIRAH", "LB-CHF-KHALLAT-DARAJAT-AL-MISRI", "LB-CHF-KHALLET-ASSOUL",
     "LB-CHF-KHALLET-EL-MAGHARA", "LB-CHF-KHALLET-MAAD", "LB-CHF-KHANDAQ-EL-OUASTA", "LB-CHF-KNAISSEH", "LB-CHF-KROUM-MESREJ", "LB-CHF-KSAR-GHAID",
     "LB-CHF-LE-MAIDAN", "LB-CHF-MAASSER-BEIT-ED-DINE", "LB-CHF-MAASSER-EL-SHOUF", "LB-CHF-MAJDALOUNA", "LB-CHF-MAJDEL-EL-MEOUSH", "LB-CHF-MAQSABEH",
     "LB-CHF-MAZBOUD", "LB-CHF-MAZMOURAH", "LB-CHF-MAZRAAT-AD-DAHR", "LB-CHF-MAZRAAT-AL-SHOUF", "LB-CHF-MAZRAAT-ED-DOUAIR", "LB-CHF-MESHREF",
     "LB-CHF-MOUGHAYRET-ECH-CHOUF", "LB-CHF-MOUKHTARA", "LB-CHF-MRESTI", "LB-CHF-MTAYLEH", "LB-CHF-N11580680704", "LB-CHF-N258400274",
     "LB-CHF-N268119791", "LB-CHF-N268989140", "LB-CHF-N5173469391", "LB-CHF-N5173469392", "LB-CHF-N5173469393", "LB-CHF-N5173554442",
     "LB-CHF-N5173554443", "LB-CHF-N5173554444", "LB-CHF-N5173554450", "LB-CHF-N5173799218", "LB-CHF-N5173799220", "LB-CHF-N5173799535",
     "LB-CHF-N5173799564", "LB-CHF-N5173799565", "LB-CHF-N5173799566", "LB-CHF-N5173799568", "LB-CHF-N5173799594", "LB-CHF-N5173799596",
     "LB-CHF-N5173799617", "LB-CHF-N5173820866", "LB-CHF-N5173820868", "LB-CHF-N5173820869", "LB-CHF-N5173820872", "LB-CHF-N5173820873",
     "LB-CHF-N5176838951", "LB-CHF-N5176838954", "LB-CHF-N5176838956", "LB-CHF-N5176838959", "LB-CHF-N5176838960", "LB-CHF-N5176838961",
     "LB-CHF-N5176838964", "LB-CHF-N5176838966", "LB-CHF-N612463786", "LB-CHF-NAAMEH", "LB-CHF-NABAA-AL-SAFA", "LB-CHF-NAOURA",
     "LB-CHF-NIHA", "LB-CHF-OUADI-ABOU-YOUSSEF", "LB-CHF-OUADI-BNEHLAY", "LB-CHF-OUADI-ED-DEIR", "LB-CHF-QALAAT-ANOUZ", "LB-CHF-QALAAT-BOU-AARIF",
     "LB-CHF-QALAAT-NAOUAOUIS", "LB-CHF-QRAIAA", "LB-CHF-QSOUBA", "LB-CHF-SAHL-EJ-JIYEH", "LB-CHF-SAQIET-EL-HAOUAKIR", "LB-CHF-SEMQANIEH",
     "LB-CHF-SHAHIM", "LB-CHF-SIBLINE", "LB-CHF-SIRJBAL", "LB-CHF-TOUTAT-AL-HAMID", "LB-CHF-WADI-EL-SITT", "LB-CHF-WARDANIYEH",
     "LB-CHF-WARHANIYEH", "LB-WBQ-AAMMIQ", "LB-WBQ-AANA", "LB-WBQ-AIN-ZEBDE", "LB-WBQ-DAYR-TAHNISH", "LB-WBQ-KAFRAYYA",
     "LB-WBQ-KHIRBAT-QANAFAR", "LB-WBQ-OUADI-CHARAF-ED-DINE", "LB-WBQ-SAGHBINE", "LB-WBQ-TALL-ZNOUB", "LB-WBQ-TELL-ZNOUB-EJ-JDIDE", "LB-ZHL-MZARAAT-ZAHLEH",
     "LB-ZHL-TCHEFLIK-EDDE-HAOUCH"
   ]',
   '2026-10-14 12:00+00', 'Delivery area: places within max_delivery_km() of a pilot merchant, 259 places (DECISIONS §39.2)', null);

-- Where a seed menu came from and when (§39.4): a repo path for the seed files, later a menu link.
alter table public.menu_drafts add column source_url text check (char_length(source_url) <= 500),
  add column captured_at date;
alter table app_private.seed_menu_drafts add column source_url text, add column captured_at date;

-- The merchant's section card shows an LBP price as printed and the dollars it becomes at approval (§39.4); menu
-- items keep price_usd only, converted at the dated rate when the section is approved.
create or replace function app_private.menu_draft_summary(p_draft_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('draft_id', d.id, 'vendor_id', d.vendor_id, 'status', d.status, 'usd_lbp_rate', public.usd_lbp_rate(),
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
      'index', s.ord - 1,
      'name', coalesce(s.v ->> 'name_ar', s.v ->> 'name_en', s.v ->> 'name_fr', 'Menu'),
      'approved', coalesce((s.v ->> 'approved')::boolean, false),
      'items', jsonb_array_length(s.v -> 'items'),
      'priced', (select count(*) from jsonb_array_elements(s.v -> 'items') i
                 where jsonb_typeof(i -> 'price') = 'number' and i ->> 'currency' in ('USD', 'LBP')),
      'preview', (select jsonb_agg(left(coalesce(i ->> 'name_ar', i ->> 'name_en', i ->> 'name_fr'), 40)
                                   || coalesce(' · ' || case i ->> 'currency' when 'USD' then '$' || (i ->> 'price')
                                     when 'LBP' then to_char((i ->> 'price')::numeric, 'FM999,999,999') || ' LBP → $'
                                       || round((i ->> 'price')::numeric / public.usd_lbp_rate(), 2)::text end, ''))
                  from (select i from jsonb_array_elements(s.v -> 'items') i limit 8) x)
    ) order by s.ord) from jsonb_array_elements(d.sections) with ordinality s (v, ord)), '[]'))
  from public.menu_drafts d where d.id = p_draft_id;
$$;

-- The rule, from merchant coordinates: every non-test vendor placed in a merchant village counts.
create function public.delivery_area_proposal()
returns table (place_id text, name_en text, name_ar text, district_code text, service_status public.service_status,
  nearest_merchant_km numeric, merchants_within integer, in_pilot_place_ids boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select v.location from public.vendors v
    where not v.is_test and v.location is not null
      and v.town_id = any (array(select jsonb_array_elements_text(public.config_value('pilot_merchant_place_ids'))))
  ), area as (
    select jsonb_array_elements_text(public.config_value('pilot_place_ids')) as id
  )
  select p.id, p.name_en, p.name_ar, p.district_code, p.service_status,
    round((select min(extensions.st_distance(m.location, p.centroid)) from m)::numeric / 1000, 2),
    (select count(*)::integer from m where extensions.st_dwithin(m.location, p.centroid, public.max_delivery_km() * 1000)),
    exists (select 1 from area where area.id = p.id)
  from public.places p
  where p.id <> 'LB-TST-LOCATION' and p.service_status <> 'paused'
    and exists (select 1 from m where extensions.st_dwithin(m.location, p.centroid, public.max_delivery_km() * 1000))
  order by p.id;
$$;
revoke all on function public.delivery_area_proposal() from public, anon, authenticated;
grant execute on function public.delivery_area_proposal() to service_role;

create or replace function app_private.shouf_load_seed(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The villages merchants are placed in (§38.1); the wider delivery area is pilot_place_ids (§39.2).
  v_pilot text[] := array(select jsonb_array_elements_text(public.config_value('pilot_merchant_place_ids')));
  v_vendors jsonb;
  n_towns integer;
  n_drafts integer;
  n_drafts_updated integer;
  n_grocery integer;
  n_duplicates integer;
  v_places jsonb;
  r record;
begin
  v_vendors := app_private.vendors_load_seed(p_sha256, 'seed_shouf_2026_10', 'vendors_shouf');

  -- A merchant whose file row names no pilot village gets the nearest one (by the village's centre).
  update public.vendors v
  set town_id = (select p.id from public.places p where p.id = any (v_pilot)
                 order by p.centroid operator(extensions.<->) v.location limit 1)
  where v.source = 'seed_shouf_2026_10' and v.claim_status = 'unclaimed' and v.location is not null
    and (v.town_id is null or not (v.town_id = any (v_pilot)))
    and coalesce(v.field_sources ->> 'town_id', 'seed') = 'seed';
  get diagnostics n_towns = row_count;

  -- The two catalogue shops are supermarkets (§38.2.3), whatever the type the file gave.
  update public.vendors v set business_type = 'grocery_supermarket'
  where v.source = 'seed_shouf_2026_10' and v.business_type <> 'grocery_supermarket'
    and coalesce(v.field_sources ->> 'business_type', 'seed') = 'seed'
    and exists (select 1 from app_private.seed_menu_drafts d where d.place_id = v.place_id and d.kind = 'supermarket');
  get diagnostics n_grocery = row_count;

  -- Draft menus: one seed draft per unclaimed vendor; refreshed only while nothing in it is approved.
  for r in select d.place_id, d.sections::jsonb as sections from app_private.seed_menu_drafts d loop
    perform app_private.menu_draft_check(r.sections);
  end loop;
  insert into public.menu_drafts (vendor_id, source, status, sections, warnings, model, source_url, captured_at)
  select v.id, 'seed', 'draft',
    (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s),
    '["seed: every price is from a public listing; the merchant confirms each section"]'::jsonb, null,
    d.source_url, d.captured_at
  from app_private.seed_menu_drafts d join public.vendors v on v.place_id = d.place_id
  where v.claim_status = 'unclaimed'
  on conflict (vendor_id) where source = 'seed' do nothing;
  get diagnostics n_drafts = row_count;
  update public.menu_drafts m
  set sections = (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s),
      source_url = d.source_url, captured_at = d.captured_at
  from app_private.seed_menu_drafts d join public.vendors v on v.place_id = d.place_id
  where m.vendor_id = v.id and m.source = 'seed' and m.status = 'draft' and v.claim_status = 'unclaimed'
    and (m.sections is distinct from (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s)
         or (m.source_url, m.captured_at) is distinct from (d.source_url, d.captured_at));
  get diagnostics n_drafts_updated = row_count;

  -- One shop listed twice (§39.4): the duplicate is an exclusion "duplicate of <kept place id>". An unclaimed duplicate
  -- with no order and no ledger account is removed (its seed rows go with it); anything else stays for an operator.
  delete from public.vendors v
  using app_private.seed_vendor_exclusions e
  where v.place_id = e.place_id and e.reason like 'duplicate of %' and v.source = 'seed_shouf_2026_10'
    and v.claim_status = 'unclaimed'
    and not exists (select 1 from public.orders o where o.vendor_id = v.id)
    and not exists (select 1 from public.ledger_accounts a where a.vendor_id = v.id);
  get diagnostics n_duplicates = row_count;
  -- The removed listing is an exclusion from now on (the vendor loader skipped it while the vendor still existed).
  insert into public.vendor_import_exclusions (place_id, name, reason, source)
  select distinct on (e.place_id) e.place_id, e.name, e.reason, 'seed_shouf_2026_10'
  from app_private.seed_vendor_exclusions e
  where e.reason like 'duplicate of %' and not exists (select 1 from public.vendors v where v.place_id = e.place_id)
  order by e.place_id
  on conflict (place_id) do update set name = excluded.name, reason = excluded.reason, source = excluded.source;

  v_places := app_private.pilot_places_apply();

  update app_private.seed_loads
  set counts = counts || jsonb_build_object('towns_nearest_village', n_towns, 'grocery_set', n_grocery, 'duplicates_removed', n_duplicates,
    'drafts_new', n_drafts, 'drafts_updated', n_drafts_updated, 'places', v_places,
    'vendors_total', (select count(*) from public.vendors where source = 'seed_shouf_2026_10'),
    'whatsapp_candidates', (select count(*) from public.vendors v join public.vendor_private p on p.vendor_id = v.id
                            where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile))
  where name = 'vendors_shouf';
  return (select counts from app_private.seed_loads where name = 'vendors_shouf');
end;
$$;
revoke all on function app_private.shouf_load_seed(text) from public, anon, authenticated;

select app_private.pilot_places_apply();
