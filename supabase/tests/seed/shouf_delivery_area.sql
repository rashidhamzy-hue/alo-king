-- The delivery area (DECISIONS §39.2), run by scripts/db-test.sh after the places and Shouf seeds are loaded: the
-- dated `pilot_place_ids` row (authoritative) and the rule computed from the merchants' coordinates agree, and the
-- places Rasheed named are on. A merchant added outside the area makes the first check fail until a new dated row
-- records the change.
begin;

select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from public.delivery_area_proposal() d where not d.in_pilot_place_ids),
  'every place the rule proposes is in pilot_place_ids');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from jsonb_array_elements_text(public.config_value('pilot_place_ids')) a(id)
  where not exists (select 1 from public.delivery_area_proposal() d where d.place_id = a.id)),
  'and pilot_place_ids holds nothing the rule does not propose');
select tests.ok(not exists (select 1 from public.places) or (select count(*) from public.places
  where service_status = 'on' and id <> 'LB-TST-LOCATION') = jsonb_array_length(public.config_value('pilot_place_ids')),
  'exactly the delivery area is switched on');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from unnest(array['LB-CHF-NIHA', 'LB-CHF-BATER', 'LB-CHF-JBAA', 'LB-CHF-MRESTI', 'LB-CHF-EL-KHRAIBE',
    'LB-CHF-MOUKHTARA', 'LB-CHF-AIN-QANI', 'LB-CHF-AMMATOUR', 'LB-CHF-BOUTMEH', 'LB-CHF-MAASSER-EL-SHOUF',
    'LB-CHF-HARET-JANDAL', 'LB-CHF-AINBAL', 'LB-CHF-DEIR-DOURIT', 'LB-CHF-BEITEDDINE']) n(id)
  where (select service_status from public.places p where p.id = n.id) is distinct from 'on'),
  'the places Rasheed named (§39.2) are on, Beiteddine included');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from public.places where service_status = 'on' and district_code = 'JZN'),
  'paused places (Jezzine) stay paused');
select tests.ok(not exists (select 1 from public.places) or not exists (
  select 1 from public.delivery_area_proposal() where nearest_merchant_km > public.max_delivery_km()),
  'no proposed place is beyond the delivery radius of every merchant');

rollback;
