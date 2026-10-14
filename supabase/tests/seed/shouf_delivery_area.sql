-- The delivery area (DECISIONS §39.2), run by scripts/db-test.sh after the places and Shouf seeds and the boundary
-- files are loaded: the dated `pilot_place_ids` row is Rasheed's boundary, every place in it is within road distance
-- of a pilot merchant (the proposal is boundary ∩ road distance), and every deny-listed place is off.
begin;

select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from jsonb_array_elements_text(public.config_value('pilot_place_ids')) a(id)
  where not exists (select 1 from public.delivery_area_proposal() d where d.place_id = a.id)),
  'pilot_place_ids ⊆ proposal: every delivered-to place is in the boundary, not deny-listed and within road distance');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or (
  select array_agg(x order by x) from jsonb_array_elements_text(public.config_value('pilot_place_ids')) x)
  = (select array_agg(place_id order by place_id) from app_private.delivery_boundary),
  'pilot_place_ids is exactly the boundary file (shouf_delivery_boundary.csv)');
select tests.ok(not exists (select 1 from app_private.delivery_denylist) or not exists (
  select 1 from app_private.delivery_denylist x join public.places p on p.id = x.place_id where p.service_status = 'on'),
  'every deny-listed place is off');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or (select count(*) from public.places
  where service_status = 'on' and id <> 'LB-TST-LOCATION') = jsonb_array_length(public.config_value('pilot_place_ids')),
  'exactly the delivery area is switched on');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from public.places where service_status = 'on' and id <> 'LB-TST-LOCATION' and district_code <> 'CHF'),
  'nothing outside the Chouf district is on (Aley, Baabda, West Bekaa, Zahle)');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from unnest(array['LB-CHF-NIHA', 'LB-CHF-JBAA', 'LB-CHF-MRESTI', 'LB-CHF-EL-KHRAIBE', 'LB-CHF-BAADARAN',
    'LB-CHF-BOUTMEH', 'LB-CHF-BATER', 'LB-CHF-AIN-QANI', 'LB-CHF-AMMATOUR', 'LB-CHF-HARET-JANDAL', 'LB-CHF-KAHLOUNIYEH',
    'LB-CHF-MAZRAAT-AL-SHOUF', 'LB-CHF-AIN-ZHALTA', 'LB-CHF-AINBAL', 'LB-CHF-AATHRINE', 'LB-CHF-GHARIFE',
    'LB-CHF-DEIR-DOURIT', 'LB-CHF-DEIR-AL-QAMAR', 'LB-CHF-BEITEDDINE', 'LB-CHF-KFARHIM', 'LB-CHF-DAMIT',
    'LB-CHF-JAHLIYEH', 'LB-CHF-KFAR-KATRA', 'LB-CHF-KFAR-FAQOUD', 'LB-CHF-DEIR-KOUCHEH', 'LB-CHF-BCHETFINE',
    'LB-CHF-MOUKHTARA', 'LB-CHF-SEMQANIEH']) n(id)
  where (select service_status from public.places p where p.id = n.id) is distinct from 'on'),
  'the villages Rasheed named (§39.2) and the places between them are on');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from unnest(array['LB-CHF-DAMOUR', 'LB-CHF-NAAMEH', 'LB-CHF-NABAA-AL-SAFA', 'LB-CHF-SHAHIM', 'LB-CHF-BARJA',
    'LB-CHF-KETERMAYA', 'LB-CHF-MAZBOUD', 'LB-CHF-ES-SAADIYAT', 'LB-CHF-JIEH', 'LB-CHF-DEBBIEH', 'LB-CHF-SIBLINE',
    'LB-CHF-JOUN', 'LB-CHF-JADRA', 'LB-CHF-WARDANIYEH', 'LB-CHF-DEIR-EL-MKHALLES']) n(id)
  where (select service_status from public.places p where p.id = n.id) = 'on'),
  'the hard stops are off: Damour, the coast, the Iqlim el Kharroub, Nabaa el Safa');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from unnest(array['LB-CHF-BAAKLINE', 'LB-CHF-BAKAATA', 'LB-CHF-BAROUK', 'LB-CHF-DEIR-AL-QAMAR', 'LB-CHF-SEMQANIEH',
    'LB-CHF-BATLOUN', 'LB-CHF-KFAR-NABRAKH', 'LB-CHF-KFARHIM', 'LB-CHF-DAMIT', 'LB-CHF-AIN-OUZAIN', 'LB-CHF-MAASSER-EL-SHOUF',
    'LB-CHF-JDEIDET-EL-CHOUF']) n(id)
  where not exists (select 1 from app_private.delivery_boundary b where b.place_id = n.id and b.role = 'shop_village')),
  'the 12 shop villages (§38.1) are in the boundary as shop villages');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from public.places p
  where (p.parent_id in (select place_id from app_private.delivery_boundary)
         or p.zone_pcode in (select q.zone_pcode from public.places q join app_private.delivery_boundary b on b.place_id = q.id))
    and not exists (select 1 from app_private.delivery_boundary b where b.place_id = p.id)
    and not exists (select 1 from app_private.delivery_denylist x where x.place_id = p.id)),
  'every hamlet or zone-mate of a delivered village is in the boundary or deny-listed (a pin snaps to the nearest place in its zone)');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from public.places where service_status = 'on' and district_code = 'JZN'),
  'paused places (Jezzine) stay paused');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from public.landmarks l where l.source = 'osm' and (l.place_id is null
    or not (l.place_id = any (array(select jsonb_array_elements_text(public.config_value('pilot_place_ids'))))))),
  'OSM landmarks only in delivered-to places');
select tests.ok(not exists (select 1 from app_private.delivery_boundary) or not exists (
  select 1 from public.place_aliases a where a.source = 'osm'
    and not (a.place_id = any (array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')))))),
  'OSM place names only on delivered-to places');

rollback;
