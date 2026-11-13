-- Alo King Chouf: build plan 1.22 (session B3). The catalog is searched in the customer's own words.
-- Found live on 13 Nov 2026: the model wrote catalog queries in English ("bread", "Nassar coffee"), English generic words match
-- no catalog name, and brand-only matches tied, so the brand rule took the first product of the brand (labneh became laban).
--
--   1. language_pack: search terms per product (by SKU), generated offline (evals/language/gen-pack.mjs, migration 0054 and
--      later ones carry the data). Three levels: `exact` names this one product (a term that pointed at more than one product
--      was dropped when the pack was built), `kind` is what people call the thing (خبز، بيض، لبنة، mayy, bread), `brand` is
--      the maker as people say it (نجار، najjar). catalog_filler holds words that never describe a product (quantities,
--      units, politeness), so they count neither for nor against a product.
--   2. catalog_pack_search(text): the words of the text are matched against the terms, token by token, with Arabic clitics
--      (و، ب، ع، ال) allowed on either side. A product is a candidate when one of its terms is fully present; one found by its
--      brand alone («نوتيلا») ranks below any found by what it is. Candidates rank by how much of the text their terms explain
--      (characters), then by level (exact, kind, brand). The words a candidate leaves
--      unexplained are returned, so the planner never assumes a product when the customer said something it does not cover.
--      The curated aliases (product_aliases) count as kind terms, except an alias that is only the product's brand.
--   3. catalog_lookup(raw, query, source_hint): the customer's words first (raw), then the model's phrase, then the old
--      trigram search (search_catalog_legacy, unchanged from 0013) for restaurant menus only. A named merchant still goes
--      through the legacy search, so 1.2's merchant_not_onboarded answer is unchanged. Negations («مش البانيه»,
--      «bala zaytoun») rule a product out instead of counting for it.
--   4. search_catalog (the ask loop's tool) uses the same order. plan_order_core uses catalog_lookup and new tie rules:
--      choice, single best (only if nothing the customer said is left unexplained), bought before, the one product the model's phrase names if the customer's words allow it,
--      named brand (narrows, never picks blindly), then the best seller only when the
--      tied products share a brand or a kind, cost within 2x of each other, and the customer's words have nothing left over.
-- Prices, stock and the card are untouched: this changes which product a line resolves to, never what it costs.

-- The words of a text, folded. The letters fold_text maps oddly (0003 maps ة to ي and ى to ا) are mapped first as people
-- write them interchangeably (ة/ه, ى/ي, أ/إ/آ/ا), so «قهوة» and «قهوه» are the same word. Digits are Western. A number is split
-- from Arabic letters and from a unit ("2ليتر", "500ml", "x6"), but not from Latin letters otherwise: Arabizi writes sounds with
-- digits ("7alib", "a7mar", "3adas"). Anything that is not a letter or a digit separates words.
create or replace function catalog_tokens(p text) returns text[] language sql immutable as $$
  select coalesce(array_agg(t order by o), '{}'::text[])
  from unnest(regexp_split_to_array(btrim(
         regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           translate(fold_text(translate(p, 'أإآىةؤئ', 'ااايهوي')), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
           '([0-9])([ء-يٱ-ۓ])', '\1 \2', 'g'),
           '([ء-يٱ-ۓ])([0-9])', '\1 \2', 'g'),
           '([0-9])(ml|cl|l|lt|ltr|litre|liter|g|gr|kg|cm|pcs|pc|x)\y', '\1 \2', 'g'),
           '\yx([0-9])', 'x \1', 'g'),
           '[^0-9a-zÀ-ɏء-يٱ-ۓ]+', ' ', 'g')), '\s+')) with ordinality u(t, o)
  where t <> ''
$$;

-- A token and the same token without one leading clitic: و (and), ب (with/in), ع (to/on), ف, and the article ال in any of
-- its joined forms. Stripped forms shorter than three letters are not kept, so short words never match by accident.
create or replace function catalog_token_forms(t text) returns text[] language sql immutable as $$
  select array_agg(distinct f) from (
    select t as f
    union all select substr(t, 4) where t ~ '^(وال|بال|عال|فال|كال)' and length(t) >= 6
    union all select substr(t, 3) where t ~ '^(ال|لل)' and length(t) >= 5
    union all select substr(t, 2) where t ~ '^[وبعف]' and length(t) >= 4
    union all select substr(t, 4) where t ~ '^[وبعف]ال' and length(t) >= 6
  ) x where f = t or length(f) >= 3
$$;

-- Every form of every token of a term, for the index.
create or replace function catalog_term_forms(p text) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct f), '{}'::text[]) from unnest(catalog_tokens(p)) t, unnest(catalog_token_forms(t)) f
$$;

create table if not exists language_pack (
  id       bigint generated always as identity primary key,
  sku      text not null,
  term     text not null,
  level    text not null check (level in ('exact', 'kind', 'brand')),
  lang     text not null default 'ar' check (lang in ('ar', 'arabizi', 'en', 'fr')),
  version  text not null,
  tokens   text[] generated always as (catalog_tokens(term)) stored,
  forms    text[] generated always as (catalog_term_forms(term)) stored,
  unique (sku, term, level)
);
create index if not exists language_pack_forms on language_pack using gin (forms);
create index if not exists language_pack_sku on language_pack (sku);

alter table product_aliases add column if not exists tokens text[] generated always as (catalog_tokens(alias)) stored;
alter table product_aliases add column if not exists forms text[] generated always as (catalog_term_forms(alias)) stored;
create index if not exists product_aliases_forms on product_aliases using gin (forms);

create table if not exists catalog_filler (word text primary key);   -- folded, one token each
insert into catalog_filler(word) select unnest(catalog_tokens(w)) from unnest(array[
  'بدي','بدنا','عطيني','اعطيني','ابعتلي','ابعتلنا','بعتلي','جيبلي','جبلي','عذبك','بليز','لو سمحت','اذا بتريد','من فضلك','يعطيك العافية','مرحبا','هلا',
  'كمان','مع','و','او','من','عند','الى','لعند','شي','شوية','واحد','وحدة','تنين','اتنين','تلاتة','تلات','اربعة','خمسة','ستة','عشرة','نص','ربع',
  'حبة','حبتين','علبة','علبتين','كيس','كيسين','ربطة','ربطتين','كيلو','كيلوين','قنينة','قنينتين','كرتونة','كرتونتين','باكيت','باكو','صحن','دزينة',
  'baddi','badde','bade','3tine','a3tine','please','pls','plz','send','me','i','want','need','and','with','a','an','the','of','some','one','two','three',
  'w','ma3','kamen','kaman','men','3and','wa7de','wa7ad','tnein','tleteh','kilo','kg','pack','packet','bottle','box','can','bag',
  'je','veux','voudrais','svp','stp','et','avec','un','une','des','du','de','la','le','les','paquet','boite','bouteille','sac',
  'el','l','al','il','lal','lel','bel','bil','min','ta3','tab3','ya','3al','merci','thanks','shukran','hi','hello','marhaba','bonjour',
  'زيادة','كمان','بعد','تبع','تبعيت','يا','لو','اذا','بس','extra','more','another','also','too','encore','aussi','zyede','ziyadeh',
  'مش','مو','بلا','بدون','غير','msh','mesh','mish','bala','bidun','bidoun','not','no','without','pas','sans'
]) w on conflict do nothing;

-- Unit words. Inside a term they are optional ("pepsi diet 1.25L" matches "pepsi diet 1.25"), and in a message they are never
-- left unexplained.
create or replace function catalog_is_unit(t text) returns boolean language sql immutable as $$
  select t ~ '^(g|gr|gm|gram|grams|gramme|kg|kilo|kilos|ml|cl|l|lt|ltr|litre|liter|litres|liters|pcs|pc|pieces|x|غ|غرام|غم|كغ|كيلو|مل|ملل|ل|لتر|ليتر|ليترات|حبه|حبات|قطعه|قطع)$'
$$;

-- Words that negate what follows: «مش البانيه», «bala zaytoun», «not the big one». What they negate never counts for a product,
-- and a product whose term needs a negated word is not offered.
create table if not exists catalog_negation (word text primary key);
insert into catalog_negation(word) select unnest(catalog_tokens(w)) from unnest(array[
  'مش','مو','بلا','بدون','غير','msh','mesh','mish','mush','bala','bidun','bidoun','not','no','without','pas','sans','non'
]) w on conflict do nothing;

-- Positions (1-based) of the tokens a negation word covers: the next tokens up to and including two that are not filler.
create or replace function catalog_negated(p_tokens text[]) returns int[] language plpgsql stable as $$
declare i int; j int; left_ int; out int[] := '{}';
begin
  for i in 1 .. coalesce(array_length(p_tokens, 1), 0) loop
    if exists (select 1 from catalog_negation where word = p_tokens[i]) then
      left_ := 2; j := i + 1;
      while j <= array_length(p_tokens, 1) and left_ > 0 loop
        exit when exists (select 1 from catalog_negation where word = p_tokens[j]);
        out := out || j;
        if not exists (select 1 from catalog_filler where word = any(catalog_token_forms(p_tokens[j]))) then left_ := left_ - 1; end if;
        j := j + 1;
      end loop;
    end if;
  end loop;
  return out;
end $$;

-- New tables: row level security on, no client grants (as 0050).
do $$ declare t text; r text;
begin
  foreach t in array array['language_pack', 'catalog_filler', 'catalog_negation'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

-- Candidates for one piece of customer text, best first. cover = characters of the text the product's terms explain.
-- A product whose term needs a negated word is left out. unexplained = the words no term of the product explains (filler,
-- units, numbers, negated words and p_explained aside: the planner passes the words of the line's modifiers there).
create or replace function catalog_pack_search(p_text text, p_limit int default 6, p_explained text[] default '{}')
returns jsonb language sql stable set search_path = public, extensions, pg_temp as $$
  with toks as (select catalog_tokens(p_text) as a), neg as (select catalog_negated(a) as n from toks),
  q as (
    select o as ord, t as tok, catalog_token_forms(t) as f, o::int = any(neg.n) as negated
      from toks, neg, unnest(toks.a) with ordinality u(t, o)
  ), qall as (select coalesce(array_agg(distinct x), '{}'::text[]) as forms from q, unnest(q.f) x),
  terms as (
    select row_number() over () as tid, product_id, lvl, tokens,
           greatest(1, (select count(*) from unnest(tokens) t where not catalog_is_unit(t)))::int as n_req from (
      select p.id as product_id, case lp.level when 'exact' then 3 when 'kind' then 2 else 1 end as lvl, lp.tokens
        from language_pack lp join products p on p.sku = lp.sku, qall where lp.forms && qall.forms and p.is_active
      union all
      select a.product_id, 2, a.tokens from product_aliases a join products pa on pa.id = a.product_id, qall
       where a.forms && qall.forms
         and a.tokens <> catalog_tokens(pa.brand)                    -- a brand alone is not a kind of product
         and not exists (select 1 from language_pack lb where lb.sku = pa.sku and lb.level = 'brand' and lb.tokens = a.tokens)
    ) x
  ), hits as (
    select t.tid, t.product_id, t.lvl, t.n_req as n, tt.pos, q.ord, q.negated, catalog_is_unit(tt.tok) and t.n_req < cardinality(t.tokens) as optional
      from terms t cross join lateral unnest(t.tokens) with ordinality tt(tok, pos)
      join q on catalog_token_forms(tt.tok) && q.f
  ), matched as (            -- a term matches when each of its words is found; it is negated when one of them is found only negated
    select tid, product_id, max(lvl) as lvl, array_agg(distinct ord) filter (where not negated) as ords,
           bool_or(pos_negated) as negated
      from (select h.*, bool_and(h.negated) over (partition by h.tid, h.pos) as pos_negated from hits h) h
     group by tid, product_id having count(distinct pos) filter (where not optional) = max(n)
  ), per_product as (
    select product_id, max(lvl) filter (where not negated) as lvl, bool_or(negated) as excluded,
           array_agg(distinct o) filter (where not negated) as ords
      from matched left join lateral unnest(ords) o on true group by product_id
  ), scored as (
    select pp.product_id, pp.lvl,
           (select coalesce(sum(length(q.tok)), 0) from q where q.ord = any(pp.ords))::int as cover,
           (select coalesce(array_agg(q.tok order by q.ord), '{}'::text[]) from q
             where not q.ord = any(pp.ords) and not q.negated and q.tok !~ '^[0-9]+$' and not catalog_is_unit(q.tok)
               and not q.tok = any(coalesce(p_explained, '{}'))
               and not exists (select 1 from catalog_filler cf where cf.word = any(q.f))) as unexplained
      from per_product pp where not pp.excluded and pp.lvl >= 1
  ), ranked as (
    select p.id as product_id, p.sku, p.name_en, p.name_ar, p.brand, p.category, p.sub_type, p.sell_unit, p.velocity_tier,
           s.id as source_id, s.name as source_name, s.kind as source_kind, o.price_usd, o.sponsored_rank,
           case when s.kind = 'dark_store' then coalesce(l.on_hand - l.reserved, 0)
                when o.is_available and s.is_open then 999 else 0 end as available,
           sc.cover, sc.lvl as level, sc.unexplained, (sc.cover + sc.lvl * 0.1)::numeric as score
      from scored sc join products p on p.id = sc.product_id
      join offers o on o.product_id = p.id join sources s on s.id = o.source_id
      left join stock_levels l on l.product_id = p.id and l.source_id = s.id
     where p.is_active and (s.kind = 'dark_store' or s.approved_at is not null)
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc, (r.available > 0) desc, r.sponsored_rank nulls last, r.velocity_tier nulls last, r.price_usd), '[]'::jsonb)
    from (select * from ranked order by score desc, (available > 0) desc, sponsored_rank nulls last, velocity_tier nulls last, price_usd limit p_limit) r
$$;

-- The 0013 search, kept as the fallback for what the pack does not cover (restaurant menus, items without terms).
create or replace function search_catalog_legacy(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare q text := fold_text(p_query); v_sources uuid[]; v_matches jsonb;
begin
  if p_source_hint is not null and btrim(p_source_hint) <> '' then
    select array_agg(id) into v_sources from sources
     where kind = 'merchant' and approved_at is not null and similarity(fold_text(name), fold_text(p_source_hint)) > 0.35;
    if v_sources is null then
      return jsonb_build_object('matches', '[]'::jsonb, 'reason', 'merchant_not_onboarded', 'source_hint', p_source_hint);
    end if;
  end if;

  with candidates as (
    select product_id as id from product_aliases where alias_folded % q
    union select id from products where search_folded % q
  ), scored as (
    select p.id, greatest(
             similarity(p.search_folded, q),
             coalesce((select max(greatest(similarity(a.alias_folded, q), word_similarity(a.alias_folded, q) * 0.9))
                       from product_aliases a where a.product_id = p.id), 0)) as score
    from products p join candidates c on c.id = p.id where p.is_active
  ), ranked as (
    select p.id as product_id, p.sku, p.name_en, p.name_ar, p.brand, p.category, p.sub_type, p.sell_unit, p.velocity_tier,
           s.id as source_id, s.name as source_name, s.kind as source_kind, o.price_usd, o.sponsored_rank,
           case when s.kind = 'dark_store' then coalesce(l.on_hand - l.reserved, 0)
                when o.is_available and s.is_open then 999 else 0 end as available,
           sc.score
    from scored sc join products p on p.id = sc.id
    join offers o on o.product_id = p.id join sources s on s.id = o.source_id
    left join stock_levels l on l.product_id = p.id and l.source_id = s.id
    where sc.score >= 0.5 and (v_sources is null or s.id = any(v_sources))
      and (s.kind = 'dark_store' or s.approved_at is not null)
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc, (r.available > 0) desc, r.sponsored_rank nulls last, r.velocity_tier nulls last, r.price_usd), '[]'::jsonb)
    into v_matches
  from (select * from ranked order by score desc, (available > 0) desc, sponsored_rank nulls last, velocity_tier nulls last, price_usd limit p_limit) r;

  return jsonb_build_object('matches', v_matches,
    'reason', case when jsonb_array_length(v_matches) = 0 then 'no_match' else null end);
end $$;

-- True when the first word that is not filler negates: the line excludes something, it does not ask for anything.
create or replace function catalog_negation_only(p_raw text) returns boolean language sql stable as $$
  select coalesce((select exists (select 1 from catalog_negation n where n.word = t)
                     from unnest(catalog_tokens(p_raw)) with ordinality u(t, o)
                    where t = any(array(select word from catalog_negation))
                       or not exists (select 1 from catalog_filler f where f.word = any(catalog_token_forms(t)))
                    order by o limit 1), false)
$$;

-- Is this name one of the brands in the catalog (a pack brand term, or the brand field itself)?
create or replace function catalog_is_brand(p_name text) returns boolean
language sql stable set search_path = public, extensions, pg_temp as $$
  select nullif(btrim(coalesce(p_name, '')), '') is not null and (
    exists (select 1 from language_pack lb where lb.level = 'brand' and lb.forms && catalog_term_forms(p_name)
              and not exists (select 1 from unnest(lb.tokens) t where not catalog_token_forms(t) && catalog_term_forms(p_name)))
    or exists (select 1 from products p where p.is_active and p.owner_source_id is null and similarity(fold_text(p.brand), fold_text(p_name)) > 0.6))
$$;

-- One line. A reading is decisive when its best candidate leaves none of the customer's words unexplained.
--   pack_raw: the customer's words, decisive.
--   pack_query: the model's phrase is decisive and its best product is one of the best for the customer's own words. The
--     model's phrase can narrow what the customer said; it is never trusted to widen it (on 13 Nov it wrote "ground coffee"
--     for «طحين», flour).
--   pack_raw (indecisive): the customer's words, with something left over: the planner shows candidates and never chooses alone.
--   pack_query_only: only the model's phrase found anything. Shown as candidates, never chosen alone.
--   legacy: the old trigram search, for restaurant menus only (the dark-store catalog is never matched by it any more: its
--     brand-only ties were what turned labneh into laban).
create or replace function catalog_lookup(p_raw text, p_query text, p_source_hint text default null, p_limit int default 5,
                                          p_explained text[] default '{}')
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare mr jsonb := '[]'::jsonb; mq jsonb := '[]'::jsonb; lg jsonb; v_query text := nullif(btrim(coalesce(p_query, '')), '');
        v_raw text := nullif(btrim(coalesce(p_raw, '')), '');
begin
  if nullif(btrim(coalesce(p_source_hint, '')), '') is not null then
    -- «من بان دور» names a brand we stock, not a shop: search it as words of the item. A shop goes the 1.2 way.
    if not catalog_is_brand(p_source_hint) then
      return search_catalog_legacy(coalesce(v_query, v_raw), p_source_hint, p_limit) || jsonb_build_object('via', 'legacy');
    end if;
    v_raw := btrim(coalesce(v_raw, '') || ' ' || p_source_hint);
    v_query := nullif(btrim(coalesce(v_query, '') || ' ' || p_source_hint), '');
  end if;
  if v_raw is not null then
    mr := catalog_pack_search(v_raw, p_limit, p_explained);
    if jsonb_array_length(mr) > 0 and jsonb_array_length(mr->0->'unexplained') = 0 then
      return jsonb_build_object('matches', mr, 'reason', null, 'via', 'pack_raw');
    end if;
  end if;
  if v_query is not null and v_query is distinct from v_raw then
    mq := catalog_pack_search(v_query, p_limit, p_explained);
    if jsonb_array_length(mq) > 0 and jsonb_array_length(mq->0->'unexplained') = 0 and exists (
         select 1 from jsonb_array_elements(mr) x where (x->>'score')::numeric = (mr->0->>'score')::numeric
            and x->>'product_id' = mq->0->>'product_id') then
      return jsonb_build_object('matches', mq, 'reason', null, 'via', 'pack_query');
    end if;
  end if;
  if jsonb_array_length(mr) > 0 then return jsonb_build_object('matches', mr, 'reason', null, 'via', 'pack_raw'); end if;
  if jsonb_array_length(mq) > 0 then return jsonb_build_object('matches', mq, 'reason', null, 'via', 'pack_query_only'); end if;
  lg := search_catalog_legacy(coalesce(v_query, v_raw), null, p_limit);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into mr from jsonb_array_elements(lg->'matches') x where x->>'source_kind' = 'merchant';
  return jsonb_build_object('matches', mr, 'reason', case when jsonb_array_length(mr) = 0 then 'no_match' end, 'via', 'legacy');
end $$;

-- The ask loop's tool: same order, one phrase.
create or replace function search_catalog(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
begin
  return catalog_lookup(p_query, null, p_source_hint, p_limit);
end $$;

-- The one product the model's phrase names, if it names exactly one: a pack reading with a single best candidate. The planner
-- uses it only to choose among products the customer's own words already allow, so it can narrow a choice, never widen one.
create or replace function catalog_query_pick(p_query text) returns uuid
language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare m jsonb;
begin
  if nullif(btrim(coalesce(p_query, '')), '') is null then return null; end if;
  m := catalog_pack_search(p_query, 3);
  if jsonb_array_length(m) > 0 and coalesce((m->1->>'score')::numeric, -1) < (m->0->>'score')::numeric then
    return (m->0->>'product_id')::uuid;
  end if;
  return null;
end $$;

-- Does a brand the customer or the model named fit this product? By the brand field, or by the pack's brand terms.
create or replace function catalog_brand_fits(p_sku text, p_brand text, p_hint text) returns boolean
language sql stable set search_path = public, extensions, pg_temp as $$
  select nullif(btrim(coalesce(p_hint, '')), '') is not null and (
    similarity(fold_text(p_brand), fold_text(p_hint)) > 0.4
    or exists (select 1 from language_pack lp where lp.sku = p_sku and lp.level = 'brand'
                and lp.forms && catalog_term_forms(p_hint)
                and not exists (select 1 from unnest(lp.tokens) t
                                 where not catalog_token_forms(t) && catalog_term_forms(p_hint))))
$$;

-- As 0013 (renamed plan_order_core by 0022), with catalog_lookup and the tie rules above.
create or replace function plan_order_core(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare ln jsonb; idx int := -1; v_lines jsonb := '[]'::jsonb; v_quote_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb;
        res jsonb; top jsonb; ties jsonb; narrowed jsonb; chosen jsonb; v_assumed boolean; v_status text; v_qty numeric; v_note text;
        v_village uuid := p_village; v_place uuid; pl jsonb; v_pickup boolean := coalesce(p_intent->>'fulfilment', '') = 'pickup';
        v_quote jsonb; v_unavailable jsonb := '[]'::jsonb; v_unmatched int := 0; v_n int := 0; v_min numeric; v_max numeric; v_subs int; v_brands int;
        v_prepay boolean := customer_requires_prepay(p_party); v_pay text := coalesce(p_intent->>'payment_hint', 'cod'); v_pack boolean; v_loose boolean;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_intent->'lines', '[]'::jsonb)) loop
    idx := idx + 1; chosen := null; v_assumed := false;
    -- a line that is only a negation («مش البانيه», "msh l kbir") excludes something said before; it is not an item
    if catalog_negation_only(ln->>'raw') then continue; end if;
    res := catalog_lookup(ln->>'raw', ln->>'query', nullif(ln->>'source_hint', ''), 5,
                          (select coalesce(array_agg(t), '{}') from jsonb_array_elements_text(coalesce(ln->'modifiers', '[]'::jsonb)) m,
                                  unnest(catalog_tokens(m)) t));
    if res->>'reason' = 'merchant_not_onboarded' then
      v_unavailable := v_unavailable || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'source_hint', ln->>'source_hint');
      v_lines := v_lines || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'query', ln->>'query', 'status', 'merchant_not_onboarded',
                   'qty', coalesce((ln->>'qty')::numeric, 1), 'assumed', false, 'chosen', null, 'candidates', null,
                   'source_hint', ln->>'source_hint');
      continue;
    end if;
    v_n := v_n + 1;
    v_pack := res->>'via' like 'pack%';
    if jsonb_array_length(res->'matches') = 0 then
      v_status := 'not_found';
    else
      top := res->'matches'->0;
      -- pack scores are exact (characters explained + level); legacy trigram scores tie within 0.05 as before
      select coalesce(jsonb_agg(x), '[]'::jsonb) into ties from jsonb_array_elements(res->'matches') x
       where case when v_pack then (x->>'score')::numeric = (top->>'score')::numeric
                  else (x->>'score')::numeric >= (top->>'score')::numeric - 0.05 end;
      if p_choices ? idx::text then
        select x into chosen from jsonb_array_elements(res->'matches') x where x->>'product_id' = p_choices->>idx::text limit 1;
      end if;
      -- the customer said more than the terms explain, or only the model's phrase found anything: show, never choose alone
      v_loose := (v_pack and jsonb_array_length(coalesce(top->'unexplained', '[]'::jsonb)) > 0) or res->>'via' = 'pack_query_only';
      if chosen is null and jsonb_array_length(ties) = 1 and not v_loose then chosen := top; end if;
      if chosen is null and not v_loose then        -- 1. bought before
        select x into chosen from jsonb_array_elements(ties) x
         where exists (select 1 from order_items i join orders o on o.id = i.order_id
                        where o.customer_id = p_party and i.product_id = (x->>'product_id')::uuid and o.status in ('delivered','closed'))
         limit 1;
      end if;
      if chosen is null and v_pack and nullif(ln->>'query', '') is not null then   -- 2. the model's phrase names one of them
        select x into chosen from jsonb_array_elements(ties) x
         where (x->>'product_id')::uuid = catalog_query_pick(ln->>'query') limit 1;
      end if;
      if chosen is null and nullif(ln->>'brand_hint', '') is not null then   -- 3. named brand: keeps only that brand's products
        select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x
         where catalog_brand_fits(x->>'sku', x->>'brand', ln->>'brand_hint');
        if jsonb_array_length(narrowed) = 1 and not v_loose then chosen := narrowed->0;
        elsif jsonb_array_length(narrowed) > 1 then ties := narrowed; end if;
      end if;
      if chosen is null and not v_loose then
        -- 4. the best seller, if the candidates are interchangeable: one brand or one kind, within 2x on price,
        --    and (pack) nothing the customer said is left unexplained
        select min((x->>'price_usd')::numeric), max((x->>'price_usd')::numeric), count(distinct x->>'sub_type'), count(distinct x->>'brand')
          into v_min, v_max, v_subs, v_brands from jsonb_array_elements(ties) x;
        -- named by brand alone («نوتيلا»): only products of one kind are interchangeable, never across kinds (Hawa's eggs and legs)
        if (v_subs = 1 or (v_pack and v_brands = 1 and coalesce((top->>'level')::int, 2) >= 2))
           and v_min > 0 and v_max / v_min <= 2 then chosen := ties->0; v_assumed := true; end if;
      end if;
      v_status := case when chosen is null then 'ambiguous' else 'matched' end;
    end if;

    v_qty := coalesce((ln->>'qty')::numeric, 1); v_note := null;
    if chosen is not null then
      if ln->>'unit' in ('kg', 'half_kg') then
        if lower(chosen->>'sell_unit') = 'kg' then
          v_qty := v_qty * case when ln->>'unit' = 'half_kg' then 0.5 else 1 end;
        else
          v_note := case when ln->>'unit' = 'half_kg' then 'طلب نص كيلو' else 'طلب ' || v_qty || ' كيلو' end;   -- packs are sold whole: tell the picker what was asked
          v_qty := greatest(1, ceil(v_qty * case when ln->>'unit' = 'half_kg' then 0.5 else 1 end));
        end if;
      end if;
      v_quote_lines := v_quote_lines || jsonb_build_object('product_id', chosen->>'product_id', 'source_id', chosen->>'source_id',
                         'qty', v_qty, 'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', v_note, 'raw', ln->>'raw');
    else
      v_unmatched := v_unmatched + 1;
    end if;
    v_lines := v_lines || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'query', ln->>'query', 'status', v_status, 'qty', v_qty,
                 'assumed', v_assumed, 'via', res->>'via',
                 'chosen', case when chosen is null then null else
                    jsonb_build_object('product_id', chosen->>'product_id', 'name', chosen->>'name_en', 'name_ar', chosen->>'name_ar',
                                       'brand', chosen->>'brand', 'price_usd', chosen->'price_usd', 'in_stock', (chosen->>'available')::numeric > 0) end,
                 'candidates', case when v_status = 'ambiguous' then
                    (select jsonb_agg(jsonb_build_object('product_id', x->>'product_id', 'name', x->>'name_en', 'name_ar', x->>'name_ar',
                                                         'brand', x->>'brand', 'price_usd', x->'price_usd', 'in_stock', (x->>'available')::numeric > 0))
                       from (select x from jsonb_array_elements(ties) x limit 3) t)
                    else null end,
                 'unexplained', case when v_pack then top->'unexplained' else null end);
  end loop;

  -- where to (unchanged from 0013)
  if not v_pickup then
    if nullif(p_intent->'address'->>'village', '') is not null then
      pl := resolve_place(p_party, p_intent->'address'->>'village', p_intent->'address'->>'landmark');
      if pl->'village' is not null and (pl->>'served')::boolean then v_village := (pl->'village'->>'village_id')::uuid;
      else v_issues := v_issues || jsonb_build_object('code', coalesce(pl->>'reason', 'village_not_recognised'), 'said', p_intent->'address'->>'village',
                                                      'village', pl->'village'->>'name_en', 'village_ar', pl->'village'->>'name_ar');
           v_village := null;
      end if;
    end if;
    if v_village is not null then
      select id into v_place from customer_places where party_id = p_party and village_id = v_village order by last_used_at desc nulls last limit 1;
    elsif not (v_issues @> '[{"code":"village_not_recognised"}]' or v_issues @> '[{"code":"village_not_served"}]') then
      select id, village_id into v_place, v_village from customer_places where party_id = p_party and village_id is not null
        order by last_used_at desc nulls last limit 1;      -- "the usual place"
    end if;
  end if;

  if v_n = 0 and jsonb_array_length(v_unavailable) = 0 then v_issues := v_issues || jsonb_build_object('code', 'empty_order'); end if;
  if v_unmatched = 0 and v_n > 0 then
    v_quote := quote_order(v_quote_lines, v_village, v_pickup);
    v_issues := v_issues || (v_quote->'issues');
  elsif jsonb_array_length(v_quote_lines) > 0 then
    v_quote := quote_order(v_quote_lines, v_village, v_pickup);      -- price what we can, for the question
  end if;
  if v_prepay and v_pay = 'cod' then v_pay := 'whish'; end if;

  return jsonb_build_object(
    'next', case when v_n = 0 and jsonb_array_length(v_unavailable) > 0 then 'not_available'
                 when v_n > 0 and v_unmatched = 0 and jsonb_array_length(v_issues) = 0 then 'card' else 'ask' end,
    'handoff_reason', null, 'unavailable', v_unavailable,
    'lines', v_lines, 'quote_lines', v_quote_lines, 'quote', v_quote, 'issues', v_issues,
    'village_id', v_village, 'place_id', v_place, 'pickup', v_pickup,
    'needs_pin', (not v_pickup and v_village is not null and not exists (
                    select 1 from customer_places where party_id = p_party and village_id = v_village and lat is not null)),
    'payment_method', v_pay, 'prepay_required', v_prepay, 'dues_usd', customer_dues_usd(p_party),
    'change_for_usd', p_intent->'change_for_usd');
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
