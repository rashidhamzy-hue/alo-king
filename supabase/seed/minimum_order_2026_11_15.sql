-- Founder decision, 15 November 2026 (docs/DECISIONS.md; session B1a): a 5 USD minimum order and no small-order fee at launch.
-- The minimum is checked by quote_order (below_minimum, on the items' subtotal) and said to the customer by code with the gap
-- (packages/agents/src/basket.ts). Both values stay data: the console can change them later, and scripts/ci/load-seeds.sh runs this
-- file once per database (marker settings key `seed_applied:minimum_order_2026_11_15`), so a later decision is never overwritten.
update settings set value = '5' where key = 'min_order_usd';
update settings set value = '{"below_subtotal_usd": 0, "fee_usd": 0}' where key = 'small_order_fee';
