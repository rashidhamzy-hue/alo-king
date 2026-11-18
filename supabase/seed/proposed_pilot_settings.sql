-- Applied once per database by scripts/ci/load-seeds.sh (marker row `seed_applied:proposed_pilot_settings`); the founder approved it on 14 November 2026
-- (docs/DECISIONS.md, "Founder answers, 14 November"). After that the console owns these values. Current values: docs/RULES.md.
-- Both are data, so either can be changed again from the console (the Settings page) without a deploy.

-- 1. Launch zone: serve the core and mid rings (25 villages); keep the outer ring (17 villages) off for now.
update villages v set is_served = (z.name in ('core', 'mid')) from zones z where z.id = v.zone_id;

-- 2. Small-order fee: none at launch (founder decision, 15 November 2026: a 5 USD minimum order and no small-order fee; was 0.50 USD
--    under 10 USD). A database where this file already ran gets the decision from supabase/seed/minimum_order_2026_11_15.sql.
update settings set value = '{"below_subtotal_usd": 0, "fee_usd": 0}' where key = 'small_order_fee';
