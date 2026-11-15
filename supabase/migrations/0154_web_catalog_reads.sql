-- Alo King Chouf, session WEB1 (website, read side): the catalog pages' read functions (docs/WEBSITE.md "Day one";
-- docs/HANDOFF.md C4 "Requests for other sessions", WEB1).
--
-- The website reads the catalog as the database role web_channel, which holds no table privilege. So each page has one function
-- that runs as its owner (security definer, fixed search_path), takes no party and no token (the catalog is public), and returns
-- only what a visitor may see. 0155 grants them by name. Nothing here prices, reserves or writes an order: price and stock are
-- read from the same offers and stock levels the chat and the WhatsApp catalog read (invariant 7); the cart and checkout re-read
-- them through quote_order (0130).
--
--   web_catalog_home()                       hours, served villages, categories with their counts, the WhatsApp link
--   web_catalog_category(p_code)             one category in sections, each item a card
--   web_catalog_product(p_sku)               one item: picture, price, stock, food facts with status and source
--   web_catalog_search(p_text, p_limit)      catalog_lookup (the chat's matcher), restricted to what the site shows; logs a miss
--
-- What a visitor may see (the rules the tests pin):
--   item     active, a shared dark-store item (no merchant item: a restaurant opens only through approve_merchant, invariant 11),
--            placed in an active category, with a dark-store offer.
--   picture  only one catalog_public_expected() names (approved, a licence a customer may see, active item) AND that the Worker has
--            copied to the public `catalog` bucket (catalog_public_pictures). Never a proposed, rejected, superseded or
--            licence-unknown picture, and never an address for a file that is not in the bucket.
--   fact     only a current approved fact (0021), not expired, with a status of certified, declared or calculated. Anything else
--            (no record, partial, unknown, expired) comes back as verified = false with no value: the page says "not verified"
--            (invariant 15: unknown is never safe). A web-page source is never approved (0071) and is excluded here as well.
--   words    no rating, no score, nothing about health: only names, sizes, prices, stock and approved facts (invariant 14).

-- ---------- helpers (not granted to web_channel; the website functions below call them as their owner) ----------

-- The items the site shows, in display order, with the cheapest dark-store price (as catalog_feed) and whether any is free to sell.
create or replace function catalog_web_items()
returns table (product_id uuid, sku text, name_en text, name_ar text, brand text, sell_unit text, price_usd numeric, in_stock boolean,
               category_code text, subgroup_en text, subgroup_ar text, ord bigint)
language sql stable set search_path = public, pg_temp as $$
  select p.id, p.sku, p.name_en, p.name_ar, nullif(p.brand, ''), p.sell_unit, o.price_usd,
         (o.is_available and coalesce(l.on_hand - l.reserved, 0) > 0),
         c.code, sg.name_en, sg.name_ar,
         row_number() over (order by c.sort_order, coalesce(sg.sort_order, 0), pl.sort_in_category, p.sku)
    from catalog_placements pl
    join catalog_categories c on c.code = pl.category_code and c.is_active
    left join catalog_subgroups sg on sg.category_code = pl.category_code and sg.code = pl.subgroup_code
    join products p on p.sku = pl.sku and p.is_active and p.owner_source_id is null
    join lateral (select ofr.price_usd, ofr.is_available, ofr.source_id from offers ofr join sources s on s.id = ofr.source_id
                   where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id $$;

-- The item's picture a visitor may see, or null: expected (approved, usable licence, active) and already in the public bucket.
create or replace function catalog_web_picture(p_product uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('path', c.public_path, 'licence', i.licence, 'source_kind', i.source_kind, 'attribution', i.attribution,
                            'source_url', i.source_url, 'width_px', i.width_px, 'height_px', i.height_px)
    from catalog_public_expected() e
    join catalog_public_pictures c on c.image_id = e.image_id
    join product_images i on i.id = e.image_id
   where e.product_id = p_product
   order by i.fetched_at desc limit 1 $$;

-- A card for a list: the item, its price and stock, its picture or null.
create or replace function catalog_web_card(p_product uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('sku', w.sku, 'name_en', w.name_en, 'name_ar', w.name_ar, 'brand', w.brand, 'sell_unit', w.sell_unit,
                            'price_usd', w.price_usd, 'in_stock', w.in_stock, 'picture', catalog_web_picture(w.product_id))
    from catalog_web_items() w where w.product_id = p_product $$;

-- ---------- the website's functions ----------

create or replace function web_catalog_home() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'service', service_info(),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name_en', c.name_en, 'name_ar', c.name_ar, 'count', n.n) order by c.sort_order)
                              from catalog_categories c
                              join lateral (select count(*) as n from catalog_web_items() w where w.category_code = c.code) n on n.n > 0
                             where c.is_active), '[]'::jsonb),
    -- The customer number's wa.me link (a person sets it, RUNBOOK 1.21). The text after "?" is the catalog feed's per-item prefill.
    'whatsapp', jsonb_build_object('home', nullif(regexp_replace(coalesce(setting('catalog')->>'product_link', ''), '\?.*$', ''), ''),
                                   'product', nullif(setting('catalog')->>'product_link', ''))) $$;

create or replace function web_catalog_category(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c catalog_categories%rowtype;
begin
  select * into c from catalog_categories where is_active and code = lower(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_category'); end if;
  return jsonb_build_object('ok', true,
    'category', jsonb_build_object('code', c.code, 'name_en', c.name_en, 'name_ar', c.name_ar),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('title_en', s.subgroup_en, 'title_ar', s.subgroup_ar, 'items', s.items) order by s.first_ord)
        from (select w.subgroup_en, w.subgroup_ar, min(w.ord) as first_ord, jsonb_agg(catalog_web_card(w.product_id) order by w.ord) as items
                from catalog_web_items() w where w.category_code = c.code group by 1, 2) s), '[]'::jsonb),
    'whatsapp', setting('catalog')->>'product_link');
end $$;

create or replace function web_catalog_product(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare w record; v_pic jsonb; v_facts jsonb; v_cat catalog_categories%rowtype;
begin
  select * into w from catalog_web_items() i where i.sku = btrim(coalesce(p_sku, ''));
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_product'); end if;
  select * into v_cat from catalog_categories where code = w.category_code;
  v_pic := catalog_web_picture(w.product_id);
  -- One row per attribute in the vocabulary. A value leaves only for a current approved fact, not expired, whose status says it was
  -- checked. The detail keys are the printed text or panel; nothing about the evidence or the reviewer.
  select coalesce(jsonb_agg(jsonb_build_object(
           'attribute', a.code, 'kind', a.kind, 'name_en', a.name_en, 'name_ar', a.name_ar,
           'verified', ok.ok,
           'value', case when ok.ok then f.value end,
           'detail', case when ok.ok then (select coalesce(jsonb_object_agg(k, f.detail->k), '{}'::jsonb)
                                             from unnest(array['text', 'values', 'per', 'units', 'ar', 'lang']) k where f.detail ? k) end,
           'status', case when ok.ok then f.status::text else 'not_verified' end,
           'source', case when ok.ok then f.source end,
           'reviewed_at', case when ok.ok then f.reviewed_at end)
         order by a.kind, a.code), '[]'::jsonb)
    into v_facts
    from food_attributes a
    left join product_facts f on f.product_id = w.product_id and f.attribute = a.code and f.approved_at is not null and f.superseded_at is null
    cross join lateral (select f.id is not null and f.source <> 'web_page' and f.status in ('certified', 'declared', 'calculated')
                               and (f.expires_at is null or f.expires_at > now()) as ok) ok;
  return jsonb_build_object('ok', true,
    'product', jsonb_build_object('sku', w.sku, 'name_en', w.name_en, 'name_ar', w.name_ar, 'brand', w.brand, 'sell_unit', w.sell_unit,
                                  'price_usd', w.price_usd, 'in_stock', w.in_stock),
    'category', jsonb_build_object('code', v_cat.code, 'name_en', v_cat.name_en, 'name_ar', v_cat.name_ar),
    'picture', v_pic,
    'facts', v_facts,
    -- Open Food Facts must be credited next to anything that came from it: a fact shown, or a picture shown.
    'credit_open_food_facts', coalesce(v_pic->>'source_kind' = 'open_food_facts', false)
        or exists (select 1 from jsonb_array_elements(v_facts) x where (x->>'verified')::boolean and x->>'source' = 'open_food_facts'),
    'whatsapp', setting('catalog')->>'product_link');
end $$;

-- Search with the chat's matcher (catalog_lookup: the language pack, folded Arabic, Arabizi, the same ranking). Not written again:
-- «لبنة», "labneh" and "labne" are the same words to it. Restricted to what the site shows, so a link from a result always opens.
-- A search that finds nothing is demand (log_demand, origin web_search), once per hour per phrase, and never more than
-- settings.web.miss_log_per_hour rows an hour (default 300) so a script cannot fill the table; the Worker rate-limits as well.
create or replace function web_catalog_search(p_text text, p_limit int default 12) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare v_text text := left(btrim(coalesce(p_text, '')), 80); v_limit int := least(greatest(coalesce(p_limit, 12), 1), 30);
        v_found jsonb; v_cap int := coalesce((setting('web')->>'miss_log_per_hour')::int, 300);
begin
  if length(v_text) < 2 then return jsonb_build_object('ok', true, 'q', v_text, 'matches', '[]'::jsonb, 'reason', 'too_short'); end if;
  with m as (select distinct on (x->>'sku') x->>'sku' as sku, ord
               from jsonb_array_elements(catalog_lookup(v_text, null, null, 30)->'matches') with ordinality as t(x, ord)
              where x->>'source_kind' = 'dark_store' order by x->>'sku', ord),
       r as (select w.product_id, m.ord from m join catalog_web_items() w on w.sku = m.sku order by m.ord limit v_limit)
  select coalesce(jsonb_agg(catalog_web_card(r.product_id) order by r.ord), '[]'::jsonb) into v_found from r;
  if jsonb_array_length(v_found) = 0 then
    if (select count(*) from demand_signals where origin = 'web_search' and created_at > now() - interval '1 hour') < v_cap then
      perform log_demand('unknown_product', 'web_search', null, v_text, null, null, null, null, jsonb_build_object('channel', 'web'));
    end if;
    return jsonb_build_object('ok', true, 'q', v_text, 'matches', '[]'::jsonb, 'reason', 'no_match');
  end if;
  return jsonb_build_object('ok', true, 'q', v_text, 'matches', v_found, 'reason', null);
end $$;

select pin_search_paths();
