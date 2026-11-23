-- Alo King Chouf, session TEST1, migration 0272: the WhatsApp catalogue's product link (RUNBOOK "WhatsApp catalog", step A3, done by code).
-- docs/DECISIONS.md, "TEST1, 23 November 2026".
--
-- Meta's feed wants a link per product; ours opens the customer line's chat with the product's code typed (`{sku}` is replaced per row by
-- the gateway, apps/gateway/src/catalog-feed.ts). The number is the staging customer line, Alo King's own US test number on Kapso
-- (a company line). Until the link is set the feed answers 503.
-- PRODUCTION: this is the test number. The production deploy (session A3) must set the +961 customer line's link before Meta reads its
-- feed; the feed is only read by a catalogue that someone connects to it, and none is connected to production.
update settings set value = coalesce(value, '{}'::jsonb) || '{"product_link": "https://wa.me/12036602328?text={sku}"}'::jsonb
 where key = 'catalog';
