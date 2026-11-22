-- Alo King, session B1g, migration 0269 (0268 is applied on staging and is never edited; the next number after it; recorded in docs/STATUS.md).
-- What staging showed after 0268 (read 22 November, plan_order_core read only): «تلاتة مرتديلا بقر مع زيتون من تنمية» offered all eight
-- Tanmia items, the mortadella with olives fourth. On staging the planner leaves «تنمية», «بقر» and «زيتون» unexplained for this line, and
-- 0268's catalog_named_items left every unexplained word out of the fit, so no item fitted the line's other words and the «which one?»
-- fell back to all the brand's items. Now: the fit leaves out only the named brand's own words (and filler, numbers); items are ranked by
-- how many of the line's other words they match, and "fits" means matching the most of them. One that alone fits best is chosen (0268's
-- wrapper, unchanged, plans the line again with it); several, a «which one?» of those. Case first: test/db/b1g-brand-and-type.test.ts.

create or replace function catalog_named_items(p_party uuid, p_words jsonb, p_line jsonb) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  with words as (select w from jsonb_array_elements_text(case when jsonb_typeof(p_words) = 'array' then p_words else '[]'::jsonb end) w),
       said as (select distinct f from unnest(catalog_tokens(coalesce(p_line->>'raw', '') || ' ' || coalesce(p_line->>'query', ''))) t,
                  unnest(catalog_token_forms(t)) f where not exists (select 1 from catalog_filler cf where cf.word = f)),
       -- a brand the line names (every brand term whose words are all in the line), and the owners of the unexplained word's kind
       brands as (select distinct o.brand from language_pack lp join products o on o.sku = lp.sku
                   where lp.level = 'brand' and coalesce(btrim(o.brand), '') <> ''
                     and exists (select 1 from words where words.w = any(lp.forms) or words.w in (select f from said))
                     and lp.tokens <@ (select coalesce(array_agg(f), '{}') from said)),
       hits as (
         select p.id, true as by_brand from brands b join products p on p.is_active and p.brand = b.brand
         union all
         select o.id, false from words join language_pack lp on words.w = any(lp.forms) and lp.level = 'kind' join products o on o.sku = lp.sku and o.is_active),
       -- a brand the customer named keeps only that brand's items («مرتديلا بقر مع زيتون من تنمية» is Tanmia's, never Al Mouna's, though
       -- «بقر» and «زيتون» are Al Mouna's kind words too); the owners of a kind word count only when no brand was named
       named as (
         select distinct h.id from hits h
          where h.by_brand or not exists (select 1 from hits b where b.by_brand)),
       -- the line's other words: what it is («خبز», «رب البندورة», «مرتديلا بقر مع زيتون»), without the brand's own words, filler and
       -- numbers. 0268 also left out every word the planner had not explained; on staging that was «بقر» and «زيتون», so nothing fitted
       brandf as (select distinct f from language_pack lp join products o on o.sku = lp.sku join brands b on b.brand = o.brand, unnest(lp.forms) f
                   where lp.level = 'brand'),
       other as (select distinct f from said where f !~ '^[0-9]+$' and not exists (select 1 from brandf where brandf.f = said.f)
                    and (exists (select 1 from brands) or not exists (select 1 from words where words.w = said.f))),
       tied as (select (x->>'product_id')::uuid as id from jsonb_array_elements(case when jsonb_typeof(p_line->'tied') = 'array' then p_line->'tied' else '[]'::jsonb end) x),
       c as (
         select n.id, catalog_web_card(n.id) as card, p.velocity_tier,
                (select count(*) from other where exists (select 1 from language_pack lp where lp.sku = p.sku and lp.level in ('kind', 'exact') and other.f = any(lp.forms))
                                            or other.f = any(catalog_term_forms(concat_ws(' ', p.name_en, p.name_ar)))) as fit_n,
                exists (select 1 from tied where tied.id = n.id) as was_found
           from named n join products p on p.id = n.id
          where case when p_party is null then product_orderable(n.id) else product_orderable_for(n.id, p_party) end),
       ok as (select * from c where c.card is not null and coalesce((c.card->>'in_stock')::boolean, false))
  -- fit: the items that match the most of the line's other words (at least one); the rest follow, as before
  select coalesce(jsonb_agg(jsonb_build_object('product_id', ok.id, 'name', ok.card->>'name_en', 'name_ar', ok.card->>'name_ar',
                                               'brand', ok.card->>'brand', 'price_usd', ok.card->'price_usd', 'in_stock', true,
                                               'fit', ok.fit_n > 0 and ok.fit_n = (select max(fit_n) from ok))
                            order by ok.fit_n desc, ok.was_found desc, ok.velocity_tier nulls last, (ok.card->>'price_usd')::numeric), '[]'::jsonb)
    from ok
$$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
