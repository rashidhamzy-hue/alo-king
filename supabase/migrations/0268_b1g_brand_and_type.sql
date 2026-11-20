-- Alo King, session B1g, migration 0268 (the number its prompt gave; recorded in docs/STATUS.md, section 5).
-- "Al Forno bread": the staging probe's «ربطة خبز الفورنو» found the Al Forno pita AK-0080 on 19 November and was "not carried" on 20
-- November, with the same words and the same data (docs/log/b1g.md; evals/cases/b1g_brand_and_type.json). Two causes, both fixed here:
--
--   1. Data. The search-words job (version auto-2026-11-16) writes each item's brand words alone, so a brand's items disagree: it wrote
--      Al Forno's one-word spellings («الفورنو», «فورنو», "forno") on the piston bread AK-0083 only, and «آل فورنو» (two words, from the
--      approved Arabic name) on the pita AK-0080; «اليماما» on Yamama's vinegar only; «التانمية» on one Tanmia mortadella only. On staging 45
--      brands had an item missing a brand word another item of the same brand has. A word the customer says that names the brand then
--      reaches only some of its items. The rule now: **a spelling of the brand belongs to every item of the brand**. A brand term is a
--      spelling of the brand when every word of it has the consonant skeleton (brand_skeleton) of a word of the brand's name or of a brand
--      term most of its items already hold; a product's own word written as a brand word ("pepsi max", "tanmia chicken", "metro" on Ulker,
--      «تنمية فراخ») is not one and is never spread. Shared once here, for every brand, and again whenever the job writes an item
--      (save_search_words), so a later run cannot split them again. Refused terms (0252) and owned words (0253) keep their triggers.
--
--   2. Logic. CX2's guard (0256/0257, b4 'other_kind') turns a «which one?» into "not carried" when a word the customer said, which none of
--      the offered items explains, is another product's brand or kind word ("cafe mate" under Najjar coffees). It threw the line away
--      even when the product that word names was sellable: «خبز الفورنو» under three other breads became "we don't have it" while the Al
--      Forno breads were on the shelf. The rule now (B1g): **never "not carried" while an item matching the brand or the type is
--      sellable; ask which one instead**. The line becomes a «which one?» of the sellable items that word names (the brand's items; the
--      kind's owners), those that also fit the line's other words first; one that alone fits both is chosen. Only when none is sellable
--      does the line stay "not carried", as before. Prices and stock come from the database (catalog_web_card), never from a prompt.
-- No price, stock, order or ledger row is touched (invariants 3, 7). Hub, villages and fees are untouched (13).

-- ---------- 1: a spelling of the brand belongs to every item of the brand ----------

-- One word's consonant skeleton, for telling a spelling of a name from another word. Arabic (already folded by catalog_tokens: ة→ه,
-- ى→ي, أإآ→ا): without a leading article, without alef and hamza, without a final ه. Latin: without vowels (y included) and a final h.
-- «التانمية», «تنمية», «تنميه» → «تنمي»; «اليماما», «ياماما», «يامامة» → «يمم»; tanmia, tanmeya, tanmiyeh → tnm; metro → mtr (not Ulker's).
create or replace function brand_skeleton(p_token text) returns text language sql immutable as $$
  select case
    when p_token ~ '[ء-ي]' then
      regexp_replace(translate(case when p_token ~ '^ال' and length(p_token) >= 5 then substr(p_token, 3) else p_token end, 'اء', ''), 'ه$', '')
    else regexp_replace(regexp_replace(lower(p_token), '[aeiouy]', '', 'g'), 'h$', '')
  end
$$;

-- The skeletons of a brand's own spellings: the words of its name, and the words of every brand term more than half of its active items
-- already hold (by words, so "Al Forno" and "al forno" are one).
create or replace function brand_core_skeletons(p_brand text) returns text[] language sql stable set search_path = public, pg_temp as $$
  with items as (select sku from products where brand = p_brand and is_active),
       held as (select lp.tokens, count(distinct lp.sku) as n from language_pack lp join items i on i.sku = lp.sku
                 where lp.level = 'brand' group by lp.tokens)
  select coalesce(array_agg(distinct s) filter (where s <> ''), '{}') from (
    select brand_skeleton(t) as s from unnest(catalog_tokens(p_brand)) t
    union all
    select brand_skeleton(t) from held, unnest(held.tokens) t where held.n * 2 > (select count(*) from items)
  ) x
$$;

-- A brand term is a spelling of the brand when it has one to three words, no digit, and every word's skeleton is one of the brand's own.
create or replace function brand_spelling(p_brand text, p_term text, p_core text[]) returns boolean language sql immutable as $$
  select coalesce(array_length(catalog_tokens(p_term), 1), 0) between 1 and 3
     and p_term !~ '[0-9]'
     and not exists (select 1 from unnest(catalog_tokens(p_term)) t where brand_skeleton(t) = '' or not brand_skeleton(t) = any(p_core))
$$;

-- Every spelling of the brand any of its items holds, written on each of its active items that lacks it (by words). Returns the products
-- that gained one, so their search documents can be rebuilt. A term refused for any item of the brand (0252) is never spread.
create or replace function share_brand_spellings(p_brand text) returns uuid[] language plpgsql set search_path = public, pg_temp as $$
declare v_core text[]; v_ids uuid[];
begin
  if coalesce(btrim(p_brand), '') = '' then return '{}'; end if;
  v_core := brand_core_skeletons(p_brand);
  with items as (select id, sku from products where brand = p_brand and is_active),
       spell as (select distinct on (lp.tokens) lp.term, lp.tokens, lp.lang from language_pack lp join items i on i.sku = lp.sku
                  where lp.level = 'brand' and brand_spelling(p_brand, lp.term, v_core)
                    and not exists (select 1 from items i2 where search_term_is_refused(i2.sku, lp.term))
                  order by lp.tokens, lp.term),
       added as (
         insert into language_pack(sku, term, level, lang, version)
         select i.sku, s.term, 'brand', s.lang, 'b1g-shared' from items i cross join spell s
          where not exists (select 1 from language_pack x where x.sku = i.sku and x.level = 'brand' and x.tokens = s.tokens)
         on conflict (sku, term, level) do nothing
         returning sku)
  select coalesce(array_agg(distinct i.id), '{}') into v_ids from added a join items i on i.sku = a.sku;
  return v_ids;
end $$;

-- The job's door: the item's words as before (0076), then its brand's spellings shared both ways, and the documents of the other items
-- that gained one rebuilt (the job rebuilds the item's own).
alter function save_search_words(text, jsonb, text) rename to save_search_words_0076;
create or replace function save_search_words(p_sku text, p_rows jsonb, p_version text) returns jsonb language plpgsql as $$
declare r jsonb := save_search_words_0076(p_sku, p_rows, p_version); v_ids uuid[]; v_self uuid; x uuid;
begin
  select id into v_self from products where sku = p_sku;
  v_ids := share_brand_spellings((select brand from products where sku = p_sku));
  foreach x in array v_ids loop
    if x <> v_self then perform refresh_search_documents(x); end if;
  end loop;
  return r || jsonb_build_object('brand_shared', coalesce(array_length(v_ids, 1), 0));
end $$;

-- Once, for every brand, then every changed item's search document.
do $$ declare b text; v_ids uuid[] := '{}'; x uuid;
begin
  for b in select distinct brand from products where is_active and coalesce(btrim(brand), '') <> '' order by 1 loop
    v_ids := v_ids || share_brand_spellings(b);
  end loop;
  foreach x in array (select coalesce(array_agg(distinct y), '{}') from unnest(v_ids) y) loop perform refresh_search_documents(x); end loop;
end $$;

-- For the search-words review: an item that still lacks a brand term another item of its brand holds, and why it was not shared
-- (not a spelling of the brand by the rule above). Read only.
create or replace function brand_word_gaps() returns table(brand text, sku text, term text) language sql stable set search_path = public, pg_temp as $$
  select p.brand, p.sku, t.term
    from products p
    join (select distinct p2.brand, lp.term, lp.tokens from language_pack lp join products p2 on p2.sku = lp.sku
           where lp.level = 'brand' and p2.is_active) t on t.brand = p.brand
   where p.is_active and coalesce(btrim(p.brand), '') <> ''
     and not exists (select 1 from language_pack x where x.sku = p.sku and x.level = 'brand' and x.tokens = t.tokens)
   order by 1, 2, 3
$$;

-- ---------- 2: never "not carried" while the brand or the kind it names is sellable ----------

-- The sellable items a word names, for one line: the items of every brand whose brand term holds the word, and the items whose kind term
-- holds it. Each as a plan candidate (catalog_web_card: the database's price and stock). Those that also fit the line's other words come
-- first (fit = 1), then the ones the planner had found for the line, then the faster sellers, then the cheaper.
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
       -- the line's other words: what it is («خبز», «رب البندورة», «صدر دجاج»), without the named word and filler
       other as (select distinct f from unnest(catalog_tokens(coalesce(p_line->>'raw', '') || ' ' || coalesce(p_line->>'query', ''))) t,
                   unnest(catalog_token_forms(t)) f
                  where not exists (select 1 from words where words.w = f or words.w = any(catalog_token_forms(t)))
                    and not exists (select 1 from catalog_filler cf where cf.word = f) and f !~ '^[0-9]+$'),
       tied as (select (x->>'product_id')::uuid as id from jsonb_array_elements(case when jsonb_typeof(p_line->'tied') = 'array' then p_line->'tied' else '[]'::jsonb end) x),
       c as (
         select n.id, catalog_web_card(n.id) as card, p.velocity_tier,
                exists (select 1 from other, language_pack lp where lp.sku = p.sku and lp.level in ('kind', 'exact') and other.f = any(lp.forms))
                  or exists (select 1 from other where other.f = any(catalog_term_forms(concat_ws(' ', p.name_en, p.name_ar)))) as fit,
                exists (select 1 from tied where tied.id = n.id) as was_found
           from named n join products p on p.id = n.id
          where case when p_party is null then product_orderable(n.id) else product_orderable_for(n.id, p_party) end)
  select coalesce(jsonb_agg(jsonb_build_object('product_id', c.id, 'name', c.card->>'name_en', 'name_ar', c.card->>'name_ar',
                                               'brand', c.card->>'brand', 'price_usd', c.card->'price_usd', 'in_stock', true, 'fit', c.fit)
                            order by c.fit desc, c.was_found desc, c.velocity_tier nulls last, (c.card->>'price_usd')::numeric), '[]'::jsonb)
    from c where c.card is not null and coalesce((c.card->>'in_stock')::boolean, false)
$$;

alter function plan_order_core(uuid, jsonb, uuid, jsonb) rename to plan_order_core_0257;

-- The planner (CX2's wrapper, unchanged, now plan_order_core_0257), then B1g's rule on every line it made "not carried" for another
-- product's word: the items that word names, when any is sellable. One that alone fits the line's other words is chosen (the line is
-- planned again with it); more, a «which one?» of those that fit (or, when none fits the other words, of all the word names).
create or replace function plan_order_core(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare res jsonb := plan_order_core_0257(p_party, p_intent, p_village, p_choices); x jsonb; o int; named jsonb; fitting jsonb; offer jsonb;
        again jsonb; ln jsonb; changed boolean := false;
begin
  for x, o in select e.x, e.o::int from jsonb_array_elements(coalesce(res->'lines', '[]'::jsonb)) with ordinality e(x, o) loop
    if x->>'status' <> 'not_found' or coalesce(x->>'b4', '') <> 'other_kind' then continue; end if;
    named := catalog_named_items(p_party, x->'unexplained', x);
    if jsonb_array_length(named) = 0 then continue; end if;                        -- nothing it names is sellable: "not carried" stands
    select coalesce(jsonb_agg(c), '[]'::jsonb) into fitting from jsonb_array_elements(named) c where (c->>'fit')::boolean;
    offer := case when jsonb_array_length(fitting) > 0 then fitting else named end;
    if jsonb_array_length(fitting) = 1 then
      -- one item is both the word's and the line's: the line planned again with it chosen (its count, unit and price from the planner)
      again := plan_order_core_0257(p_party, p_intent, p_village, coalesce(p_choices, '{}'::jsonb) || jsonb_build_object(x->>'idx', fitting->0->>'product_id'));
      select l into ln from jsonb_array_elements(again->'lines') l where l->>'idx' = x->>'idx' limit 1;
      if ln->>'status' = 'matched' and ln->'chosen'->>'product_id' = fitting->0->>'product_id' then
        return again;                                                             -- the whole plan, with its quote, from the planner
      end if;
    end if;
    res := jsonb_set(res, array['lines', (o - 1)::text],
             x || jsonb_build_object('status', 'ambiguous', 'b4', 'named_other', 'chosen', null,
                                     'candidates', (select jsonb_agg(c - 'fit') from (select c from jsonb_array_elements(offer) c limit 10) t),
                                     'tied', (select jsonb_agg(jsonb_build_object('product_id', c->>'product_id')) from (select c from jsonb_array_elements(offer) c limit 12) t)));
    changed := true;
  end loop;
  return res;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
