-- Alo King Chouf, session D4 (console): what each catalog item still lacks, and what that stops.
-- One answer per active hub item (the shared dark-store catalog, not a restaurant's menu line), read by the console's readiness page.
--
-- What each part means (a person reads this on the page, so the words are fixed here):
--   name          approved | waiting | rejected | none     the 5.18 name proposal (0110); none = never proposed (the nine the checks refused, new items)
--   picture       approved | guide_only | waiting | none   an approved picture a customer may see (0050's licence list) is "approved";
--                                                          approved with an unknown licence is a guide for the intake photo only
--   facts         ingredients approved, allergens answered from the pack (of 14), approved and waiting counts; facts_ok needs the
--                                                          ingredient list and all 14 allergens from the pack (status other than unknown)
--   cost          the hub holds a cost for it (receiving, 0024), so its margin is known
--   search_words  built | queued | failed | none           (0076)
--   placement     it sits in a catalog category (0085)
--   price         the hub has an offer for it, and it is available
--
-- What blocks what:
--   blocks_catalog   the catalog feed (catalog_feed(), 0085) leaves the item out: no approved picture a customer may see, no
--                    placement in a category, no price at the hub. No picture blocks the catalog, not ordering.
--   blocks_ordering  a customer cannot order it at all: no price at the hub, or the hub marked it unavailable.
--   missing          everything else that is not done: a name waiting for a person, facts, cost, search words. None of it stops a sale.
-- ready = nothing blocks and nothing is missing.

create or replace function product_readiness(p_product uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.r order by x.r->>'sku'), '[]'::jsonb) from (
    select jsonb_build_object(
      'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
      'name', coalesce(case np.n_status when 'proposed' then 'waiting' else np.n_status end, 'none'),
      'picture', case when pic.usable then 'approved' when pic.approved then 'guide_only' when pic.proposed then 'waiting' else 'none' end,
      'facts', jsonb_build_object('approved', f.approved, 'waiting', f.waiting, 'ingredients', f.ingredients, 'allergens', f.allergens, 'allergens_of', f.allergens_of,
                                  'ok', f.ingredients and f.allergens = f.allergens_of),
      'cost', cost.known,
      'search_words', case when w.built then 'built' when w.job = 'failed' then 'failed' when w.job in ('pending', 'running') then 'queued' else 'none' end,
      'placement', pl.category_code is not null, 'category', pl.category_code,
      'price', o.price_usd is not null and o.is_available, 'price_usd', o.price_usd, 'available', coalesce(o.is_available, false),
      'blocks_catalog', to_jsonb(array_remove(array[
          case when not pic.usable then 'no approved picture a customer may see' end,
          case when pl.category_code is null then 'not placed in a catalog category' end,
          case when o.price_usd is null then 'no price at the hub' end], null)),
      'blocks_ordering', to_jsonb(array_remove(array[
          case when o.price_usd is null then 'no price at the hub' when not o.is_available then 'marked unavailable at the hub' end], null)),
      'missing', to_jsonb(array_remove(array[
          case when np.n_status = 'proposed' then 'name waiting for a person' end,
          case when not (f.ingredients and f.allergens = f.allergens_of) then 'food facts from the pack' end,
          case when not cost.known then 'cost' end,
          case when not w.built then 'search words' end], null))
    ) || jsonb_build_object('ready',
          pic.usable and pl.category_code is not null and o.price_usd is not null and o.is_available and coalesce(np.n_status, '') <> 'proposed'
          and f.ingredients and f.allergens = f.allergens_of and cost.known and w.built) as r
    from products p
    left join lateral (select status as n_status from product_name_proposals where sku = p.sku) np on true
    cross join lateral (select exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence)) as usable,
                               exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved') as approved,
                               exists (select 1 from product_images i where i.product_id = p.id and i.status = 'proposed') as proposed) pic
    cross join lateral (select count(*) filter (where pf.approved_at is not null) as approved,
                               count(*) filter (where pf.approved_at is null) as waiting,
                               coalesce(bool_or(pf.approved_at is not null and pf.attribute = 'ingredients' and pf.status <> 'unknown'), false) as ingredients,
                               count(distinct pf.attribute) filter (where pf.approved_at is not null and pf.status <> 'unknown' and fa.kind = 'allergen') as allergens,
                               (select count(*) from food_attributes where kind = 'allergen') as allergens_of
                          from product_facts pf join food_attributes fa on fa.code = pf.attribute
                         where pf.product_id = p.id and pf.superseded_at is null) f
    cross join lateral (select exists (select 1 from stock_levels l join sources s on s.id = l.source_id
                                        where l.product_id = p.id and s.kind = 'dark_store' and l.avg_cost_usd is not null) as known) cost
    cross join lateral (select exists (select 1 from language_pack lp where lp.sku = p.sku and lp.level <> 'brand') as built,
                               (select j.status from search_word_jobs j where j.sku = p.sku) as job) w
    left join lateral (select c.category_code from catalog_placements c where c.sku = p.sku) pl on true
    left join lateral (select ofr.price_usd, ofr.is_available from offers ofr join sources s on s.id = ofr.source_id
                        where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
   where p.is_active and p.owner_source_id is null and (p_product is null or p.id = p_product)) x $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
