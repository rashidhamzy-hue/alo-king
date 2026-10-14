-- Rollback of 20261014230000_fee_bands_20km.sql. Dated rows are never deleted: a newer band set restates 3 km $2.00,
-- 6 km $3.00 and 10 km $4.50 (max_delivery_km() back to 10, so the area load takes Delghani and El Bireh off again on
-- the next scripts/load-seed.sh run). The listing_radius_km row stays (it is 10 either way); the place page's unclaimed
-- list keeps reading it.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback of 20261014230000_fee_bands_20km', true);
insert into public.delivery_fee_bands (effective_from, max_km, fee_usd, created_by) values
  (now(), 3, 2.00, null),
  (now(), 6, 3.00, null),
  (now(), 10, 4.50, null);
