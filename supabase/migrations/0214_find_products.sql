-- Alo King Chouf, session SR1, part 3 of 5: one search, by words and by meaning, under hard filters by approved facts.
-- One SQL function for every channel (invariant 19): the Concierge's search tool (packages/agents/src/concierge-tools.ts), the honest
-- answer (honest.ts), the baskets (0215) and the website's search page (web_catalog_search, 0216).
--
-- find_products(query, filters, limit, embedding, model, cache_key): the cache key defaults to the folded query's own.
--   1. the word list: the built word search and language pack (catalog_pack_scan, 0053) on the query and on its singular ("bars" -> "bar"),
--      a word for a whole family of kinds ("snacks", «تسالي», 0213), and the words of PD1's search document (names in four languages, kind,
--      template, tags, approved claims, the pack's terms). Ranked by how much of the query each explains.
--   2. the meaning list: the items nearest to the query's embedding (pgvector, 0212), by cosine distance, the nearest settings.search.meaning_top
--      within meaning_max_distance. The embedding comes with the call, or from the cache by cache_key. None: words alone, and the turn still answers.
--   3. the two ranked lists merged by reciprocal rank fusion (1/(k + rank) summed; k = settings.search.rrf_k); a preferred shopping tag
--      (prefer_tags, an audience on food) counts as a third list.
--   4. hard filters (product_passes_filters, 0213): an item that fails one, or that is not fact-complete when a fact is asked, is never returned.
--      When the query names nothing (only facts: "something with no sugar"), every item with an approved record is a candidate.
--   5. order: the fused rank, then in stock, then measurable facts only (the nutrient asked for, how fast it sells, the price): never praise,
--      never a paid placement (invariants 14 and 16). The unit price is returned with each match, not ranked on (per kilo and per piece differ).
-- Returns {matches: [...], reason: null | 'no_match' (nothing named) | 'none_pass' (items named, none passes the filters), failed: {reason: n},
--          meaning: 'given' | 'cache' | 'none', embedding: embedding_allowed()}. Each match carries the evidence that made it pass, with its
-- source, for the chat to state ("the pack says ..."). The hub's catalogue only: a restaurant menu stays with search_catalog (0053).

create or replace function find_products(p_query text, p_filters jsonb default '{}', p_limit int default 8, p_embedding text default null,
                                         p_model text default null, p_cache_key text default null)
returns jsonb language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare s jsonb := coalesce(setting('search'), '{}'::jsonb); k numeric := coalesce((s->>'rrf_k')::numeric, 60);
        f jsonb := coalesce(p_filters, '{}'::jsonb) - 'sort';
        v_sort text := p_filters->>'sort';
        v_q text := left(btrim(coalesce(p_query, '')), 200); v_alt text;
        v_model text := coalesce(nullif(p_model, ''), s->>'model', ''); v_emb extensions.vector; v_meaning text := 'none';
        v_facts boolean := filters_ask_facts(coalesce(p_filters, '{}'::jsonb));
        v_limit int := least(greatest(coalesce(p_limit, 8), 1), 30);
        v_prefer text[] := array(select jsonb_array_elements_text(coalesce(p_filters->'prefer_tags', '[]'::jsonb)));
        v_named boolean; v_out jsonb; v_failed jsonb; v_n int; v_key text;
begin
  -- the cache key: given, or the folded query's own (query_embedding_key, 0212)
  v_key := coalesce(p_cache_key, case when v_q <> '' then query_embedding_key(v_q) end);
  if p_embedding is not null and v_model <> '' then
    v_emb := p_embedding::extensions.vector; v_meaning := 'given';
    if v_key ~ '^[0-9a-f]{32}$' then perform save_query_embedding(v_model, v_key, p_embedding); end if;
  elsif v_key ~ '^[0-9a-f]{32}$' and v_model <> '' then
    update query_embeddings set hits = hits + 1, last_used_at = now() where model = v_model and key = v_key returning embedding into v_emb;
    if v_emb is not null then v_meaning := 'cache'; end if;
  end if;
  -- an audience said on food ranks, never filters: it joins the preferred tags (0213 keeps it hard for templates with an age field)
  if f->>'audience' = 'kids' then v_prefer := v_prefer || 'kids'::text; end if;
  v_alt := regexp_replace(v_q, '([a-zà-ÿ]{3,})s\M', '\1', 'gi');

  create temp table if not exists _fp_cand (product_id uuid primary key, wr int, mr int, dist numeric) on commit drop;
  truncate _fp_cand;
  with toks as (
    -- each word of the query with its forms, and the forms of its singular ("bars" -> "bar"): one word, however it is written
    select distinct t, catalog_token_forms(t) || catalog_token_forms(regexp_replace(t, '^([a-zà-ÿ]{3,})s$', '\1')) as f
      from unnest(catalog_tokens(v_q)) t
     where not exists (select 1 from catalog_filler cf where cf.word = any(catalog_token_forms(t))) and not catalog_is_unit(t) and t !~ '^[0-9]+$'
       and not exists (select 1 from catalog_negation cn where cn.word = t)
  ), qforms as (select coalesce(array_agg(distinct x), '{}'::text[]) as forms, count(distinct t) as n from toks, unnest(toks.f) x),
  pack as (
    select sc.product_id, max(sc.cover + sc.lvl * 0.1 - (cardinality(sc.unexplained) + cardinality(sc.loose_numbers)) * 0.01) as score
      from (select * from catalog_pack_scan(v_q) union all select * from catalog_pack_scan(v_alt) where v_alt <> v_q) sc
     where not sc.excluded and sc.lvl >= 1 group by sc.product_id
  ), negated as (
    select distinct sc.product_id from catalog_pack_scan(v_q) sc where sc.excluded
  ), fam as (
    select distinct v.product_id, 1.0 as score from family_words fw join kind_families kf on kf.family = fw.family
      join product_field_values v on v.field_key = 'kind' and v.status = 'approved' and lower(v.value #>> '{}') = kf.kind, qforms
     where fw.word_folded = any(qforms.forms)
  ), useful as materialized (
    -- a word most documents hold ("food" from a template's name) says nothing about which item: it does not count
    select x.t, x.f from toks x
     where (select count(*) from product_search_forms d where x.f && d.forms) <= greatest(5, 0.25 * (select count(*) from product_search_forms))
  ), docs as (
    -- every useful word of the query in the item's document (two of three for a long query): a half match never stands in for the item
    select d.product_id, 2.0 * x.hit / x.n as score from product_search_forms d
      cross join lateral (select count(*) filter (where u.f && d.forms)::numeric as hit, count(*)::numeric as n from useful u) x
     where x.n > 0 and (x.hit = x.n or (x.n >= 3 and x.hit / x.n >= 2.0 / 3))
  ), words as (
    -- the language pack's match ranks first; a family word or the document only ranks what the pack does not reach
    select x.product_id, (select pk.score from pack pk where pk.product_id = x.product_id) as ps, sum(x.score) as score
      from (select * from pack union all select * from fam union all select * from docs) x
      join products p on p.id = x.product_id and p.is_active and p.owner_source_id is null
     where not exists (select 1 from negated n where n.product_id = x.product_id)
     group by x.product_id having sum(x.score) > 0
  ), wl as (
    -- equal matches share a rank, so the same words in another script give the same order (ties go to stock and unit price below)
    select product_id, rank() over (order by ps desc nulls last, case when ps is null then score else 0 end desc)::int as r from words),
  ml as (
    select e.product_id, (e.embedding <=> v_emb)::numeric as dist, row_number() over (order by e.embedding <=> v_emb, e.product_id)::int as r
      from product_embeddings e join products p on p.id = e.product_id and p.is_active and p.owner_source_id is null
     where v_emb is not null and e.model = v_model and e.dims = extensions.vector_dims(v_emb)
     order by e.embedding <=> v_emb limit coalesce((s->>'meaning_top')::int, 40)
  )
  insert into _fp_cand(product_id, wr, mr, dist)
  select coalesce(wl.product_id, ml.product_id), wl.r, ml.r, ml.dist
    from wl full join (select * from ml where dist <= coalesce((s->>'meaning_max_distance')::numeric, 0.55)) ml on ml.product_id = wl.product_id;

  v_named := exists (select 1 from _fp_cand);
  -- only facts said ("something with no sugar"): every item with an approved record is a candidate
  if not v_named and v_facts and not exists (
       select 1 from unnest(catalog_tokens(v_q)) t
        where not exists (select 1 from catalog_filler cf where cf.word = any(catalog_token_forms(t))) and not catalog_is_unit(t) and t !~ '^[0-9]+$') then
    insert into _fp_cand(product_id) select p.id from products p where p.is_active and p.owner_source_id is null
      and (exists (select 1 from product_facts x where x.product_id = p.id and x.approved_at is not null and x.superseded_at is null)
           or exists (select 1 from product_field_values v where v.product_id = p.id and v.status = 'approved' and v.field_key <> 'kind'));
    v_named := exists (select 1 from _fp_cand);
  end if;

  with c as (
    select c.*, p.sku, p.name_en, p.name_ar, p.brand, p.category, p.sub_type, p.sell_unit, p.velocity_tier,
           o.source_id, src.name as source_name, src.kind as source_kind, o.price_usd,
           coalesce(l.on_hand - l.reserved, 0) as available,
           coalesce(1.0 / (k + c.wr), 0) + coalesce(1.0 / (k + c.mr), 0)
             + case when cardinality(v_prefer) > 0 and not exists (select 1 from unnest(v_prefer) t where not exists (
                      select 1 from product_tags pt where pt.product_id = c.product_id and pt.tag_code = t and pt.approved)) then 0.5 / (k + 1) else 0 end as rrf,
           case when f = '{}'::jsonb then '{"pass": true, "evidence": []}'::jsonb
                -- a cheap necessary condition before the full check: a fact asked needs some approved record
                when v_facts and not (exists (select 1 from product_facts x where x.product_id = c.product_id and x.approved_at is not null and x.superseded_at is null)
                                      or exists (select 1 from product_field_values v where v.product_id = c.product_id and v.status = 'approved' and v.field_key <> 'kind'))
                     and not (f - 'audience' - 'tags' - 'prefer_tags' - 'max_price_usd' = '{}'::jsonb)
                  then '{"pass": false, "reason": "not_fact_complete"}'::jsonb
                else product_passes_filters(c.product_id, f) end as verdict
      from _fp_cand c join products p on p.id = c.product_id
      join lateral (select x.source_id, x.price_usd from offers x join sources s2 on s2.id = x.source_id and s2.kind = 'dark_store'
                     where x.product_id = p.id order by x.price_usd limit 1) o on true
      join sources src on src.id = o.source_id
      left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
  ), passing as (select * from c where (verdict->>'pass')::boolean),
  ranked as (
    select jsonb_build_object('product_id', product_id, 'sku', sku, 'name_en', name_en, 'name_ar', name_ar, 'brand', brand, 'category', category,
             'sub_type', sub_type, 'sell_unit', sell_unit, 'source_id', source_id, 'source_name', source_name, 'source_kind', source_kind,
             'price_usd', price_usd, 'available', available, 'unit_price', product_unit_price(product_id),
             'word_rank', wr, 'meaning_rank', mr, 'distance', round(dist, 4), 'score', round(rrf, 6), 'evidence', coalesce(verdict->'evidence', '[]'::jsonb)) as m,
           row_number() over (order by rrf desc, (available > 0) desc,
             case when v_sort is not null then (select (e->>'value')::numeric from jsonb_array_elements(verdict->'evidence') e where e->>'key' = v_sort limit 1) end nulls last,
             velocity_tier nulls last, price_usd, name_en) as n
      from passing
  )
  select (select coalesce(jsonb_agg(m order by n), '[]'::jsonb) from ranked where n <= v_limit),
         (select coalesce(jsonb_object_agg(r, cnt), '{}'::jsonb) from (select split_part(verdict->>'reason', ':', 1) as r, count(*) as cnt from c
                                                                         where not (verdict->>'pass')::boolean group by 1) z),
         (select count(*) from passing)
    into v_out, v_failed, v_n;

  return jsonb_build_object('matches', v_out,
    'reason', case when not v_named then 'no_match' when v_n = 0 then 'none_pass' end,
    'failed', v_failed, 'filters', f, 'meaning', v_meaning,
    'embedding', case when v_meaning = 'none' then embedding_allowed() end);
end $$;

do $$ declare r text;
begin
  revoke all on function find_products(text, jsonb, int, text, text, text) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function find_products(text, jsonb, int, text, text, text) from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function find_products(text, jsonb, int, text, text, text) to service_role; end if;
end $$;
