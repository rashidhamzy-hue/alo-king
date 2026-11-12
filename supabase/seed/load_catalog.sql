-- Loads supabase/seed/catalog.csv into products, one dark-store source, offers and empty stock rows.
-- Run with psql from the repo root:  psql "$DATABASE_URL" -f supabase/seed/load_catalog.sql
-- Prices are the Tawfeer reference averages, as placeholders. Replace with your own price list before launch.
create temp table _cat (
  sku text, item text, brand text, category text, sub_type text, tier text, storage text, source text,
  sell_unit text, units text, ref_price text, item_ar text, barcode text, note text
);
\copy _cat from 'supabase/seed/catalog.csv' with (format csv, header true)

insert into sources(kind, name) select 'dark_store', 'Alo King Hub'
  where not exists (select 1 from sources where kind = 'dark_store');

insert into products(sku, name_en, name_ar, brand, category, sub_type, storage, sell_unit, barcode, velocity_tier)
select sku, item, nullif(item_ar, ''), brand, category, sub_type,
       (case when storage ilike 'chilled%' then 'chilled' when storage ilike 'frozen%' then 'frozen'
             when storage ilike 'cool%' then 'fresh' else 'ambient' end)::storage_zone,
       sell_unit, nullif(barcode, ''), nullif(tier, '')
from _cat on conflict (sku) do nothing;

insert into product_aliases(product_id, alias, lang)
select p.id, c.item_ar, 'ar' from _cat c join products p on p.sku = c.sku where coalesce(c.item_ar, '') <> '';

insert into offers(source_id, product_id, price_usd, is_available)
select s.id, p.id, coalesce(nullif(c.ref_price, '')::numeric, 0), nullif(c.ref_price, '') is not null
from _cat c join products p on p.sku = c.sku cross join (select id from sources where kind = 'dark_store' limit 1) s
on conflict (source_id, product_id) do nothing;

insert into stock_levels(source_id, product_id)
select o.source_id, o.product_id from offers o join sources s on s.id = o.source_id and s.kind = 'dark_store'
on conflict do nothing;
