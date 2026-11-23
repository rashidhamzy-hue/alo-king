-- Alo King Chouf, session TEST1, migration 0272: the WhatsApp catalogue's product link (RUNBOOK "WhatsApp catalog", step A3, done by code).
-- docs/DECISIONS.md, "TEST1, 23 November 2026".
--
-- Meta's feed wants a link per product; ours opens the customer line's chat with the product's code typed (`{sku}` is replaced per row by
-- the gateway, apps/gateway/src/catalog-feed.ts). The same setting gives the website its WhatsApp buttons. The number is the staging
-- customer line, Alo King's own US test number on Kapso (a company line).
-- STAGING ONLY: applied only to a database marked as staging (0271's deployment_marker). Production, and every test database, are left
-- as they are: production's link is the +961 customer line's, set by its own deploy (session A3). On staging the value was already this
-- one (set by hand in QA1); scripts/staging/prepare-staging.sql sets it too when it is missing (a rebuilt staging is marked after its
-- migrations run).
update settings set value = coalesce(value, '{}'::jsonb) || '{"product_link": "https://wa.me/12036602328?text={sku}"}'::jsonb
 where key = 'catalog' and db_is_staging();
