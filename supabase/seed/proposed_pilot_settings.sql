-- NOT APPLIED AUTOMATICALLY. These values were proposed on 12 November 2026 and are waiting for the founder's yes
-- (docs/DECISIONS.md, "Proposed, not yet confirmed"). Run this file by hand on staging only after he confirms.
-- Both are data, so either can be changed again from the console (task 3.9) without a deploy.

-- 1. Launch zone: serve the core and mid rings (25 villages); keep the outer ring (17 villages) off for now.
update villages v set is_served = (z.name in ('core', 'mid')) from zones z where z.id = v.zone_id;

-- 2. Small-order fee: 0.50 USD on baskets under 10 USD. Company income, a separate line, never the rider's.
--    Has no effect until task 1.16 teaches quote_order to read it.
update settings set value = '{"below_subtotal_usd": 10, "fee_usd": 0.50}' where key = 'small_order_fee';
