-- Loads supabase/seed/product_aliases.csv (written by scripts/enrich_catalog_aliases.ts). Run after load_catalog.sql.
create temp table _al (sku text, alias text, lang text);
\copy _al from 'supabase/seed/product_aliases.csv' with (format csv, header true)
insert into product_aliases(product_id, alias, lang)
select p.id, a.alias, a.lang from _al a join products p on p.sku = a.sku
on conflict (product_id, alias, lang) do nothing;
