-- Alo King Chouf, session PD1 (product data standard), pull request 1, part (g): the honest answer when nothing fits.
-- docs/PRODUCT_DATA_STANDARD.md, "Why the two voice notes failed". On staging (15 Nov 22:20) "snacks with no sugar for 5 kids" and
-- "protein bars with no sugar" got "I found no snacks with these specifications, shall I show you the catalogue?". Code now answers:
-- what we do not carry yet (noted), what we cannot confirm yet, and at most three real items by their exact name and price.
--
--  1. demand_kind 'facts_unconfirmed': a request for a kind we carry, with a fact we cannot confirm for any of it (no approved record).
--     A kind we do not carry at all is logged as 'unknown_product', as plan_order does. The detail holds the kind asked, the facts
--     asked, the audience, the quantity and the language (log_demand, 0022).
--  2. kind_words: the words customers use for a whole kind of product ("snacks", «سناكات», "tasali") and the catalogue category they
--     mean. Data, never code. kind_in_catalog() answers "do we carry this kind?" from a category, for words no product name holds.
--  3. items_named_with(): active products sold at the hub, in stock first, whose own printed name holds a phrase ("Zero Sugar", "No Sugar").
--     Quoting a name is not a claim (invariant 15 is about facts, and the names are read as names): the answer says "with 'no sugar'
--     in their name", never "sugar-free".

alter type demand_kind add value if not exists 'facts_unconfirmed';

create table kind_words (
  word_folded   text primary key,                 -- fold_text(word)
  word          text not null,
  lang          text not null check (lang in ('ar', 'arabizi', 'en', 'fr')),
  category_code text not null references catalog_categories(code)
);
insert into kind_words(word_folded, word, lang, category_code)
select fold_text(w), w, l, c from (values
  ('snack', 'en', 'snacks_sweets'), ('snacks', 'en', 'snacks_sweets'), ('sweets', 'en', 'snacks_sweets'), ('candy', 'en', 'snacks_sweets'),
  ('سناك', 'ar', 'snacks_sweets'), ('سناكس', 'ar', 'snacks_sweets'), ('سناكات', 'ar', 'snacks_sweets'), ('تسالي', 'ar', 'snacks_sweets'),
  ('تسلاية', 'ar', 'snacks_sweets'), ('حلويات', 'ar', 'snacks_sweets'), ('سكاكر', 'ar', 'snacks_sweets'),
  ('snaks', 'arabizi', 'snacks_sweets'), ('sneks', 'arabizi', 'snacks_sweets'), ('tasali', 'arabizi', 'snacks_sweets'), ('tsali', 'arabizi', 'snacks_sweets'),
  ('7elwiyet', 'arabizi', 'snacks_sweets'), ('sakakir', 'arabizi', 'snacks_sweets'),
  ('grignotage', 'fr', 'snacks_sweets'), ('grignotages', 'fr', 'snacks_sweets'), ('friandises', 'fr', 'snacks_sweets'), ('bonbons', 'fr', 'snacks_sweets'),
  ('drinks', 'en', 'water_drinks'), ('beverages', 'en', 'water_drinks'), ('مشروبات', 'ar', 'water_drinks'), ('boissons', 'fr', 'water_drinks'),
  ('mashroubat', 'arabizi', 'water_drinks'),
  ('cleaning', 'en', 'cleaning_household'), ('تنظيف', 'ar', 'cleaning_household'), ('nettoyage', 'fr', 'cleaning_household'), ('tanzif', 'arabizi', 'cleaning_household'),
  ('breakfast', 'en', 'breakfast_cereal'), ('فطور', 'ar', 'breakfast_cereal'), ('ftour', 'arabizi', 'breakfast_cereal')
) v(w, l, c)
on conflict (word_folded) do nothing;

-- Do we carry this kind of product? A category whose name or kind word is one of the query's words (a trailing plural "s" dropped too).
-- Returns null when no category fits. product_ids: the category's active products sold at the hub, at most 40.
create or replace function kind_in_catalog(p_query text) returns jsonb language sql stable as $$
  with w as (
    select distinct x from (select unnest(regexp_split_to_array(fold_text(p_query), '[^[:alnum:]؀-ۿ]+')) as x) s where length(x) >= 3
    union select distinct regexp_replace(x, 's$', '') from (select unnest(regexp_split_to_array(fold_text(p_query), '[^[:alnum:]؀-ۿ]+')) as x) s where length(x) >= 4
  ), c as (
    select c.* from catalog_categories c
     where c.is_active and (exists (select 1 from kind_words k join w on w.x = k.word_folded where k.category_code = c.code)
                            or exists (select 1 from w where length(w.x) >= 4 and (lower(c.name_en) ~ ('\m' || w.x) or fold_text(c.name_ar) like '%' || w.x || '%')))
     order by c.sort_order limit 1
  )
  select jsonb_build_object('code', c.code, 'name_en', c.name_en, 'name_ar', c.name_ar,
           'product_ids', coalesce((select jsonb_agg(p.id order by pl.sort_in_category) from catalog_placements pl
                                     join products p on p.sku = pl.sku and p.is_active
                                    where pl.category_code = c.code), '[]'::jsonb))
    from c $$;

-- Products whose own name holds one of these phrases, active at the hub: in stock first, then fastest sellers. At most p_limit.
-- The price and "not available now" are said from quote_order, never from here.
create or replace function items_named_with(p_phrases text[], p_limit int default 3) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.in_stock desc, x.tier, x.name_en), '[]'::jsonb) from (
    select p.id as product_id, p.name_en, p.name_ar, coalesce(p.velocity_tier, 'Z') as tier,
           coalesce(l.on_hand - l.reserved, 0) > 0 as in_stock,
           (select ph from unnest(p_phrases) ph where lower(p.name_en) like '%' || lower(ph) || '%' or coalesce(p.name_ar, '') like '%' || ph || '%' limit 1) as phrase
      from products p
      join lateral (select ofr.source_id from offers ofr join sources s on s.id = ofr.source_id
                     where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
      left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
     where p.is_active
       and exists (select 1 from unnest(p_phrases) ph where btrim(ph) <> ''
                    and (lower(p.name_en) like '%' || lower(ph) || '%' or coalesce(p.name_ar, '') like '%' || ph || '%'))
     order by (coalesce(l.on_hand - l.reserved, 0) > 0) desc, coalesce(p.velocity_tier, 'Z'), p.name_en
     limit greatest(1, least(coalesce(p_limit, 3), 6))) x $$;

do $$ declare r text;
begin
  alter table kind_words enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table kind_words from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
