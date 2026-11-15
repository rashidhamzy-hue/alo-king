-- Alo King Chouf: session B1c (wrong products, part 3). The planner never chooses one product for a generic word or a brand
-- alone, and never a size the customer did not say.
--
-- B1b's second simulated run on main (sim-test 43756167947) had 34 conversations the judge called a wrong or uninvited product.
-- Read one by one (evals/cases/b1c_wrong_products.json), the planner's own share was a choice made for the customer: «عدس» became
-- Zain lentils and «لبن» Mazaraana laban 1 kg (the best seller among one kind), «ورق حمام، ربطة صغيرة» a 12-roll pack, "wet wipes"
-- Wellplus (the model's phrase), «Gorosti» its turkey breast (a brand alone), and «سيكس باك بيرة» the brand Puck heard in «باك».
--
--   1. products.house_default: the product the shop gives for a generic word. Data, set by a person (the console or SQL); none is
--      set here. Tied products with exactly one default among them take it, and the turn says which (the line's pick = 'house').
--   2. plan_order_core_0078 (the planner's rules; 0133's wrapper calls it): a line whose best match names only the kind, with more
--      than one product of that kind fitting the words, or only a brand, is generic. Bought before, the model's phrase and the
--      best seller no longer choose for it: the house default, or a question whose candidates are the products that fit, best fit
--      first, then the fastest sellers (velocity tier), at most three. Tied products of different sizes are the same question
--      unless the customer's words tell them apart (catalog_size_of). A brand heard inside other words, with the customer's words
--      left over and nothing naming what they are, is not found. Every line also returns `tied` (the products its words fit), so
--      an edit to the basket finds the one already in it.
--   3. plan_order_core (0133's mixed-word wrapper): B1b's gate run 43746499760 read hz0815 «baddi bazella w jazar mkhalta, plein
--      soleil» as «bazella» / «jazar» / «mkhalta, plein soleil». 0133 joined only the line before the mixed word, so «bazella»
--      matched the peas on its own. Every neighbouring line that carries the span's words is joined now (at most two).
--
-- Cases: test/db/planner-b1c.test.ts, evals/language/zero-wrong.json (hz0815, the new reading). Append-only: 0078 and 0133 are
-- applied on staging. Anyone changing the planner's rules: start from this file's plan_order_core_0078.

alter table products add column if not exists house_default boolean not null default false;
comment on column products.house_default is
  'B1c: the product given for a generic word («ربطة خبز») among the products the words fit. At most one per kind; the turn says which. Set by a person.';

-- The house defaults proposed from the founder's own hand cases (evals/language/hand.json: h0002 «ربطتين خبز», h0003 «قهوة نجار»,
-- h0004 «كرتونة بيض هوا», h0005 «لبنة ليبان ليه», h0006 «مي تنورين»), the products he expects for those words. Data: the founder or
-- ops changes them (update products set house_default = ...); docs/HANDOFF.md, B1c, says so.
update products set house_default = true where sku in ('AK-0080', 'AK-0133', 'AK-0049', 'AK-0046', 'AK-0103') and not house_default;

-- The reading's count is also written in the line as a size: the same number right before a unit of volume («٢ ليتر», "2 L"),
-- on a line not sold by weight. Then the number is the product's size, not something the count explains.
create or replace function catalog_qty_is_size(p_raw text, p_qty text, p_unit text) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_unit, 'each') not in ('kg', 'half_kg') and nullif(btrim(coalesce(p_qty, '')), '') is not null and exists (
    select 1 from unnest(catalog_tokens(coalesce(p_raw, ''))) with ordinality u(t, o)
     where t = any(catalog_tokens(p_qty))
       and (catalog_tokens(coalesce(p_raw, '')))[o + 1] ~ '^(ml|cl|l|lt|ltr|litre|liter|litres|liters|مل|ملل|ل|لتر|ليتر|ليترات)$')
$$;

-- The sizes in a product's name, folded ("125Ml" -> "125ml", "2L X6" -> "2l x6"); null when the name carries none.
create or replace function catalog_size_of(p_name text) returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(btrim(coalesce(array_to_string(array(
      select lower(replace(m[1], ',', '.')) || lower(m[2])
        from regexp_matches(coalesce(p_name, ''), '(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|ltr|lt|l|pieces|pcs|piece|rolls|sheets|loaves|bags|sachets|capsules|caps)(?![a-z])', 'gi') m
       order by 1), ' '), '') || coalesce(' x' || (regexp_match(coalesce(p_name, ''), '(?:^|\s)[xX]\s?(\d+)(?![0-9])'))[1], '')), '')
$$;

create or replace function plan_order_core_0078(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare ln jsonb; idx int := -1; v_lines jsonb := '[]'::jsonb; v_quote_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb;
        res jsonb; top jsonb; ties jsonb; narrowed jsonb; chosen jsonb; v_assumed boolean; v_status text; v_qty numeric; v_note text;
        v_village uuid := p_village; v_place uuid; pl jsonb; v_pickup boolean := coalesce(p_intent->>'fulfilment', '') = 'pickup';
        v_quote jsonb; v_unavailable jsonb := '[]'::jsonb; v_unmatched int := 0; v_n int := 0; v_min numeric; v_max numeric; v_subs int; v_brands int;
        v_prepay boolean := customer_requires_prepay(p_party); v_pay text := coalesce(p_intent->>'payment_hint', 'cod'); v_pack boolean; v_loose boolean;
        v_in jsonb := '[]'::jsonb; i int; v_merged text; v_msg text := nullif(btrim(coalesce(p_intent->>'_message', '')), '');
        v_ev_exact uuid[] := '{}'; v_ev_excl uuid[] := '{}'; v_ev_brand uuid[] := '{}';
        v_doubt boolean; v_neg int[]; v_split jsonb; v_cover_top int; k int; v_scan jsonb := '[]'::jsonb; v_msg_forms text[] := '{}'; v_rule text; v_orphan_size boolean := false;
        v_generic boolean; v_sizes boolean; v_fit jsonb; v_pick text; v_nobrand boolean; v_shared boolean;
begin
  -- The fast model sometimes cuts one item into two lines ("3tine kinder" / "tronky wa7de", "wet wipes oui oui" / "aqua").
  -- A line whose words name no kind of product is joined to the next line, or else to the one before, when the joined words
  -- are fully explained; otherwise it stays as it is.
  for ln in select x || jsonb_build_object('_idx', o - 1) from jsonb_array_elements(coalesce(p_intent->'lines', '[]'::jsonb)) with ordinality t(x, o) loop
    v_in := v_in || ln;
  end loop;
  i := 0;
  while i < jsonb_array_length(v_in) loop
    ln := v_in->i;
    if nullif(ln->>'source_hint', '') is null and not catalog_negation_only(ln->>'raw') and jsonb_array_length(v_in) > 1
       and not exists (select 1 from catalog_pack_scan(ln->>'raw') sc where sc.lvl >= 2 and not sc.excluded) then
      if i + 1 < jsonb_array_length(v_in) and nullif(v_in->(i+1)->>'source_hint', '') is null then
        v_merged := (ln->>'raw') || ' ' || (v_in->(i+1)->>'raw');
        if catalog_decisive(v_merged) then
          v_in := jsonb_set(v_in, array[(i+1)::text], (v_in->(i+1)) || jsonb_build_object('raw', v_merged,
                    'query', btrim(coalesce(ln->>'query', '') || ' ' || coalesce(v_in->(i+1)->>'query', '')),
                    'brand_hint', coalesce(v_in->(i+1)->'brand_hint', ln->'brand_hint'),
                    'qty', greatest(coalesce((ln->>'qty')::numeric, 1), coalesce((v_in->(i+1)->>'qty')::numeric, 1))));
          v_in := v_in - i; continue;
        end if;
      end if;
      if i > 0 and nullif(v_in->(i-1)->>'source_hint', '') is null then
        v_merged := (v_in->(i-1)->>'raw') || ' ' || (ln->>'raw');
        if catalog_decisive(v_merged) then
          v_in := jsonb_set(v_in, array[(i-1)::text], (v_in->(i-1)) || jsonb_build_object('raw', v_merged,
                    'query', btrim(coalesce(v_in->(i-1)->>'query', '') || ' ' || coalesce(ln->>'query', '')),
                    'brand_hint', coalesce(v_in->(i-1)->'brand_hint', ln->'brand_hint')));
          v_in := v_in - i; continue;
        end if;
      end if;
    end if;
    i := i + 1;
  end loop;
  -- The whole message is evidence too: a word the model left out of a line ("l kbar", "mish diet") still counts when it
  -- decides between products the line's own words left tied.
  if v_msg is not null then
    select coalesce(array_agg(product_id) filter (where lvl = 3 and not excluded), '{}'), coalesce(array_agg(product_id) filter (where excluded), '{}'),
           coalesce(array_agg(product_id) filter (where brand_hit and not excluded), '{}'),
           coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'lvl', lvl, 'excluded', excluded, 'cover', cover)), '[]'::jsonb)
      into v_ev_exact, v_ev_excl, v_ev_brand, v_scan from catalog_pack_scan(v_msg);       -- B4: kept, so the message is scanned once
    v_msg_forms := coalesce((select array_agg(distinct f) from unnest(catalog_tokens(v_msg)) t, unnest(catalog_token_forms(t)) f), '{}');
    -- B4: a size the customer said that no line carries («... wooden bakery l kbar» with the size left in source_hint)
    v_orphan_size := exists (select 1 from unnest(catalog_tokens(v_msg)) t where catalog_token_forms(t) && array['kbir', 'zghir']
                               and not exists (select 1 from jsonb_array_elements(v_in) l, unnest(catalog_tokens(l->>'raw')) lt where lt = t));
  end if;

  for ln in select * from jsonb_array_elements(v_in) loop
    idx := (ln->>'_idx')::int; chosen := null; v_assumed := false; v_rule := null;
    v_generic := false; v_sizes := false; v_fit := '[]'::jsonb; v_pick := null; v_nobrand := false; v_shared := false;
    -- a line that is only a negation («مش البانيه», "msh l kbir") excludes something said before; it is not an item
    if catalog_negation_only(ln->>'raw') then continue; end if;
    -- the quantity explains its own number («٦ علب»). Modifiers do not: the model files "wasat" (medium) there too
    -- B1c: not when the number is said as a size («تنتين مي تنورين ٢ ليتر»: the «٢» before «ليتر» is the bottle, sim-139)
    res := catalog_lookup(ln->>'raw', ln->>'query', nullif(ln->>'source_hint', ''), 8,
                          case when catalog_qty_is_size(ln->>'raw', ln->>'qty', ln->>'unit') then '{}'::text[] else catalog_tokens(coalesce(ln->>'qty', '')) end);
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
      -- B4: a negation in the line that rules out none of the tied products («مش الكبير» when no loaf carries «كبير») leaves the
      -- customer's meaning unknown: nothing below may choose between them alone. A question, not a guess.
      v_neg := catalog_negated(catalog_tokens(ln->>'raw'));
      v_doubt := false;
      -- what the message rules out («mish diet») leaves the tie; one tied product the message names exactly is the one
      select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x where not (x->>'product_id')::uuid = any(v_ev_excl);
      if jsonb_array_length(narrowed) > 0 then ties := narrowed; top := ties->0;
      elsif jsonb_array_length(ties) > 0 and v_pack then ties := '[]'::jsonb; end if;
      -- a brand the message names («mn Hamra») keeps only that brand's products when the line's own words left brands tied
      -- (and when the best one's brand is not in the message at all, the candidates whose brand is: the model dropped "mn Hamra")
      select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x where (x->>'product_id')::uuid = any(v_ev_brand);
      if jsonb_array_length(narrowed) > 0 and jsonb_array_length(narrowed) < jsonb_array_length(ties) then ties := narrowed; top := ties->0;
      elsif v_pack and jsonb_array_length(narrowed) = 0 and not exists (select 1 from products p where p.id = (top->>'product_id')::uuid
                                                                         and exists (select 1 from unnest(v_ev_brand) b join products pb on pb.id = b where pb.brand = p.brand)) then
        select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(res->'matches') x
         where (x->>'product_id')::uuid = any(v_ev_brand) and (x->>'level')::int >= 2;
        if jsonb_array_length(narrowed) > 0 then
          select coalesce(jsonb_agg(x), '[]'::jsonb) into ties from jsonb_array_elements(narrowed) x where (x->>'score')::numeric = (narrowed->0->>'score')::numeric;
          top := ties->0;
        end if;
      end if;
      select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x where (x->>'product_id')::uuid = any(v_ev_exact);
      if chosen is null and not v_doubt and jsonb_array_length(ties) > 1 and jsonb_array_length(narrowed) = 1 then chosen := narrowed->0;
      elsif jsonb_array_length(narrowed) > 1 then ties := narrowed; top := ties->0;
      elsif v_pack and jsonb_array_length(narrowed) = 0 and jsonb_array_length(ties) > 0 then
        -- the message names exactly one product this line could be, and not the line's best: that one («bazella w jazar» cut
        -- into «bazella» and «jazar» is the mixed bag, once)
        select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(res->'matches') x
         where (x->>'product_id')::uuid = any(v_ev_exact) and (x->>'level')::int >= 2;
        if chosen is null and not v_doubt and jsonb_array_length(narrowed) = 1 then chosen := narrowed->0; end if;
      end if;
      -- the customer said more than the terms explain, or only the model's phrase found anything: show, never choose alone
      v_loose := (v_pack and jsonb_array_length(coalesce(top->'unexplained', '[]'::jsonb)) > 0) or res->>'via' = 'pack_query_only'
                 -- a size the best one leaves out and another explains («١٢٥ مل» against the litre): a question, not a guess
                 or (v_pack and exists (select 1 from jsonb_array_elements(res->'matches') m, jsonb_array_elements_text(coalesce(top->'loose_numbers', '[]'::jsonb)) w
                                         where m->>'product_id' <> top->>'product_id' and not (coalesce(m->'loose_numbers', '[]'::jsonb) ? w)));
      -- a word only one of the tied products has in its exact terms, said (not negated) in the line, decides between them
      -- («l kbar» for the big Wooden Bakery bread, «wasat» for the medium)
      if chosen is null and v_pack and not v_loose and not v_doubt and jsonb_array_length(ties) > 1 then
        select x into chosen from jsonb_array_elements(ties) x where (x->>'product_id')::uuid = (
          with t as (select (y->>'product_id')::uuid as pid from jsonb_array_elements(ties) y),
          tok as (select distinct t.pid, f from t join products p on p.id = t.pid join language_pack lp on lp.sku = p.sku and lp.level = 'exact',
                  unnest(lp.forms) f where f !~ '^[0-9]+$' and not catalog_is_unit(f)
                    and not exists (select 1 from catalog_filler cf where cf.word = f)
                    -- B1c: a word of what the thing is («wet» of "wet wipes") is not one product's own, even when only its exact
                    -- term spells it (sim-021: "wet wipes" chose Wellplus by it)
                    and not exists (select 1 from t t2 join products p2 on p2.id = t2.pid join language_pack lk on lk.sku = p2.sku and lk.level = 'kind'
                                     where lk.forms @> array[f])),
          own as (select a.pid, a.f from tok a where not exists (select 1 from tok b where b.pid <> a.pid and b.f = a.f)),
          said as (select coalesce(array_agg(f), '{}') as fs from (select catalog_tokens(ln->>'raw') as a) k, catalog_negated(k.a) n,
                   unnest(k.a) with ordinality u(w, o), unnest(catalog_token_forms(w)) f where not o::int = any(n)),
          hit as (select distinct own.pid from own, said where own.f = any(said.fs))
          select case when count(*) = 1 then min(pid::text)::uuid end from hit);
      end if;
      -- a product named by its brand alone («3tine kinder») is never chosen alone: which one is a question
      if v_pack and coalesce((top->>'level')::int, 2) = 1 then v_loose := true; end if;
      -- B1c (0138): what fits the customer's words: every candidate that names the kind or the product itself (not the brand alone)
      -- and leaves none of their words unexplained; when some of them carry the numbers said, only those. Best fit first, then the
      -- fastest sellers (velocity tier), then the cheaper.
      if v_pack then
        select coalesce(jsonb_agg(m order by (m->>'score')::numeric desc, m->>'velocity_tier' nulls last, (m->>'price_usd')::numeric), '[]'::jsonb) into v_fit
          from jsonb_array_elements(res->'matches') m
         where (m->>'level')::int >= 2 and jsonb_array_length(coalesce(m->'unexplained', '[]'::jsonb)) = 0
           and not (m->>'product_id')::uuid = any(v_ev_excl);
        if exists (select 1 from jsonb_array_elements(v_fit) m where jsonb_array_length(coalesce(m->'loose_numbers', '[]'::jsonb)) = 0)
           and exists (select 1 from jsonb_array_elements(v_fit) m where jsonb_array_length(coalesce(m->'loose_numbers', '[]'::jsonb)) > 0) then
          select jsonb_agg(m) into v_fit from jsonb_array_elements(v_fit) m where jsonb_array_length(coalesce(m->'loose_numbers', '[]'::jsonb)) = 0;
        end if;
        -- a brand the message names keeps only its products, as it does for the tie (gate run 43766779770, g0370: «pain d'or» and
        -- «khebez 3arabe, 900g» cut into two lines; the bread line took the house loaf)
        select coalesce(jsonb_agg(m), '[]'::jsonb) into narrowed from jsonb_array_elements(v_fit) m where (m->>'product_id')::uuid = any(v_ev_brand);
        if jsonb_array_length(narrowed) > 0 then v_fit := narrowed; end if;
        -- The customer named only what kind of thing it is («ربطة خبز», «قنينة مي», "wet wipes") and more than one product is that
        -- kind, or only a brand ("Pepsi", «Gorosti»): generic. No rule below chooses for them (bought before, the model's phrase, the
        -- best seller): the house default if there is exactly one, else a question. sim-test 43756167947 put the best seller or
        -- the model's pick in the basket for «عدس», «ورق حمام», "wet wipes", «لبن», «Gorosti».
        v_generic := chosen is null and ((coalesce((top->>'level')::int, 2) = 1 and jsonb_array_length(coalesce(top->'unexplained', '[]'::jsonb)) = 0
                                           and jsonb_array_length(ties) > 1)
                                          or (coalesce((top->>'level')::int, 2) = 2 and jsonb_array_length(v_fit) > 1));
        -- A brand with one product, named alone ("Snickers", «كيري», «Gorosti»): the brand is that product's name.
        -- Not when the brand word is a word of another product the message names exactly («الأكوا» beside «محارم مبللة وي وي» is the Oui
        -- Oui Aqua Pure, «اكوا بيور», never Aqua's water; gate run 43767961138, g0958). Then neither this nor the model's phrase chooses.
        v_shared := coalesce((top->>'level')::int, 2) = 1 and exists (
          select 1 from unnest(v_ev_exact) e join products p on p.id = e join language_pack lp on lp.sku = p.sku and lp.level <> 'brand'
           where e <> (top->>'product_id')::uuid
             and lp.forms && array(select f from unnest(catalog_tokens(ln->>'raw')) t, unnest(catalog_token_forms(t)) f
                                    where not exists (select 1 from catalog_filler cf where cf.word = f)));
        if chosen is null and coalesce((top->>'level')::int, 2) = 1 and jsonb_array_length(coalesce(top->'unexplained', '[]'::jsonb)) = 0
           and jsonb_array_length(ties) = 1 and not v_shared then
          chosen := top; v_pick := 'only';
        end if;
        -- A brand heard inside other words («باك» in «سيكس باك بيرة» is the brand Puck), with the customer's own words left over and
        -- nothing that names what they are: not that brand. Not found (sim-093 put cooking cream in the basket for beer).
        -- Only a short brand word (three letters at most: «باك»): a longer one ("Gold Medal", "Aflora") with a word the pack does not know
        -- («6a7in» for flour) is the brand, and the model's phrase may still name its product.
        v_nobrand := chosen is null and coalesce((top->>'level')::int, 2) = 1 and jsonb_array_length(coalesce(top->'unexplained', '[]'::jsonb)) > 0
                     and coalesce((top->>'cover')::int, 0) <= 3
                     and not exists (select 1 from jsonb_array_elements(res->'matches') m where (m->>'level')::int >= 2);
      end if;
      -- B1c: the products still tied differ in size, and nothing the customer said tells which: never a size they did not say.
      v_sizes := chosen is null and jsonb_array_length(ties) > 1
                 and (select count(distinct coalesce(catalog_size_of(x->>'name_en'), '')) from jsonb_array_elements(ties) x) > 1;
      -- B4: products the line leaves tied, and a size in the message no line took: which size is a question, not the best seller
      if v_orphan_size and chosen is null and jsonb_array_length(ties) > 1 then v_loose := true; v_rule := coalesce(v_rule, 'orphan_size'); end if;

      if chosen is null and jsonb_array_length(ties) = 1 and not v_loose and not v_generic then chosen := top; end if;
      if chosen is null and not v_loose and not v_generic and not v_sizes then        -- 1. bought before
        select x into chosen from jsonb_array_elements(ties) x
         where exists (select 1 from order_items i join orders o on o.id = i.order_id
                        where o.customer_id = p_party and i.product_id = (x->>'product_id')::uuid and o.status in ('delivered','closed'))
         limit 1;
      end if;
      -- 2. the model's phrase names one of them. When the customer's words left something over, only if no other candidate
      --    explains what was left over (the model drops noise like "lal wled"; it must not drop "herbal")
      -- B4: never while a word left over could name another kind of the same brand («Wilco sodour djej»: sodour is breasts)
      --     the word left over looks like one of that other product's own words («sodour», «sdour djej»)
      if chosen is null and v_pack and v_loose and exists (
           select 1 from jsonb_array_elements(res->'matches') m join products pm on pm.id = (m->>'product_id')::uuid
                    join products pt on pt.id = (top->>'product_id')::uuid
                    join language_pack lp on lp.sku = pm.sku and lp.level <> 'brand',
                    jsonb_array_elements_text(coalesce(top->'unexplained', '[]'::jsonb)) w, unnest(lp.forms) f
            where pm.id <> pt.id and pm.brand = pt.brand and pm.sub_type is distinct from pt.sub_type
              and length(w) >= 4 and length(f) >= 4 and similarity(w, f) >= 0.4) then
        v_doubt := true; v_rule := coalesce(v_rule, 'same_brand_other_kind');
      end if;
      if chosen is null and v_pack and not v_doubt and not v_generic and not v_sizes and not v_nobrand and not v_shared and nullif(ln->>'query', '') is not null and not (v_loose and exists (
           select 1 from jsonb_array_elements(res->'matches') m,
                         jsonb_array_elements_text(coalesce(top->'unexplained', '[]'::jsonb) || coalesce(top->'loose_numbers', '[]'::jsonb)) w
            where m->>'product_id' <> top->>'product_id' and not (coalesce(m->'unexplained', '[]'::jsonb) || coalesce(m->'loose_numbers', '[]'::jsonb)) ? w)) then
        select x into chosen from jsonb_array_elements(ties) x
         where (x->>'product_id')::uuid = catalog_query_pick(ln->>'query') limit 1;
      end if;
      if chosen is null and not v_nobrand and nullif(ln->>'brand_hint', '') is not null then   -- 3. named brand: keeps only that brand's products
        select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x
         where catalog_brand_fits(x->>'sku', x->>'brand', ln->>'brand_hint');
        if jsonb_array_length(narrowed) = 1 and not v_loose then chosen := narrowed->0;
        elsif jsonb_array_length(narrowed) > 1 then ties := narrowed; end if;
      end if;
      if chosen is null and not v_loose and not v_generic and not v_sizes then
        -- 4. the best seller, if the candidates are interchangeable: one brand or one kind, within 2x on price,
        --    and (pack) nothing the customer said is left unexplained
        select min((x->>'price_usd')::numeric), max((x->>'price_usd')::numeric), count(distinct x->>'sub_type'), count(distinct x->>'brand')
          into v_min, v_max, v_subs, v_brands from jsonb_array_elements(ties) x;
        -- named by brand alone («نوتيلا»): only products of one kind are interchangeable, never across kinds (Hawa's eggs and legs)
        if (v_subs = 1 or (v_pack and v_brands = 1 and coalesce((top->>'level')::int, 2) >= 2))
           and v_min > 0 and v_max / v_min <= 2 then chosen := ties->0; v_assumed := true; end if;
      end if;
      -- B1c: the house default. A generic word, or tied sizes, that fits exactly one product the shop marked as its default
      -- (products.house_default, data the console sets) takes it, and the turn says which (pick = house). A brand the customer named
      -- keeps only its own products. Otherwise the question: the products that fit, best fit and fastest sellers first.
      if chosen is null and (v_generic or v_sizes) and not v_nobrand and not v_doubt then
        if v_generic and jsonb_array_length(v_fit) > 0 then ties := v_fit;
        -- (only what names the thing as well as the best does: never a product found by its brand alone beside it, Liban Lait's laban
        -- for «لبنة صغيرة»)
        else select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc, x->>'velocity_tier' nulls last, (x->>'price_usd')::numeric), '[]'::jsonb)
               into ties from jsonb_array_elements(ties) x
              where coalesce((x->>'level')::int, 2) >= (select max(coalesce((y->>'level')::int, 2)) from jsonb_array_elements(ties) y);
        end if;
        if nullif(ln->>'brand_hint', '') is not null then
          select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x where catalog_brand_fits(x->>'sku', x->>'brand', ln->>'brand_hint');
          if jsonb_array_length(narrowed) > 0 then ties := narrowed; end if;
        end if;
        -- among the products that fit best only: «قنينة مي» fits the single bottle best, so a 6-pack default is never given for it
        select coalesce(jsonb_agg(x), '[]'::jsonb) into narrowed from jsonb_array_elements(ties) x join products p on p.id = (x->>'product_id')::uuid
         where p.house_default and (x->>'score')::numeric >= (select max((y->>'score')::numeric) from jsonb_array_elements(ties) y)
           -- and only when it leaves nothing the customer said unexplained: no word («خستين كبار» is lettuce, not the big loaf) and no
           -- number («33cl, pack de 12» is never the 2 L x6) (replay of the gate's readings: g0151, g0426)
           and jsonb_array_length(coalesce(x->'unexplained', '[]'::jsonb)) = 0 and jsonb_array_length(coalesce(x->'loose_numbers', '[]'::jsonb)) = 0;
        -- never on the model's phrase alone: «خستين كبار» (lettuce) read as «خبز» found the loaves only by the model's word (g0151)
        if jsonb_array_length(narrowed) = 1 and not v_loose then chosen := narrowed->0; v_assumed := true; v_pick := 'house'; end if;
        v_rule := coalesce(v_rule, case when v_pick = 'house' then 'house_default' when v_generic then 'generic' else 'sizes' end);
        top := coalesce(ties->0, top);
      end if;
      v_status := case when v_nobrand then 'not_found' when chosen is null then 'ambiguous' else 'matched' end;
      if v_nobrand then ties := '[]'::jsonb; v_rule := coalesce(v_rule, 'brand_in_other_words'); end if;
    end if;

    -- Doubt: the message names another product exactly, one that shares this line's words and no other line took, and the
    -- message does not name the one chosen. The model cut or stripped the line («كيس بازيلا وجزر مفرزة» read as «جزر مفرزة»):
    -- ask between the two rather than guess.
    -- B4 (0078): the line says big or small, the chosen product's own words never do, and the line's search found another
    -- product of the same brand: which size is a question («بيبسي دايت الكبيرة، تنين ليتر وربع» chose the 1.25 L bottle).
    if chosen is not null and v_pack and exists (
         select 1 from unnest(catalog_tokens(ln->>'raw')) with ordinality u(t, o), unnest(catalog_token_forms(t)) f
          where f in ('kbir', 'zghir') and not o::int = any(coalesce(v_neg, '{}'))
            and not exists (select 1 from products p join language_pack lp on lp.sku = p.sku
                             where p.id = (chosen->>'product_id')::uuid and lp.forms @> array[f]))
       and exists (select 1 from jsonb_array_elements(res->'matches') m join products pm on pm.id = (m->>'product_id')::uuid
                    join products pc on pc.id = (chosen->>'product_id')::uuid where pm.id <> pc.id and pm.brand = pc.brand)
       -- a number in the line that is one of the chosen product's own words («... el kbire 900g») already says which size
       and not exists (select 1 from unnest(catalog_tokens(ln->>'raw')) t join products p on p.id = (chosen->>'product_id')::uuid
                         join language_pack lp on lp.sku = p.sku
                        where t ~ '^[0-9]+$' and lp.forms @> array[t]) then
      ties := jsonb_build_array(chosen) || coalesce((select jsonb_agg(m) from jsonb_array_elements(res->'matches') m
                 join products pm on pm.id = (m->>'product_id')::uuid join products pc on pc.id = (chosen->>'product_id')::uuid
                where pm.id <> pc.id and pm.brand = pc.brand), '[]'::jsonb);
      chosen := null; v_status := 'ambiguous'; v_assumed := false; v_rule := coalesce(v_rule, 'size_not_its_own');
    end if;
    -- B4: the customer said not the big one (or not the small one), and the one chosen is it: «مش الكبير» chose «... Large».
    if chosen is not null and coalesce(array_length(v_neg, 1), 0) > 0 and exists (
         select 1 from unnest(catalog_tokens(ln->>'raw')) with ordinality u(t, o), products p
          where o::int = any(v_neg) and p.id = (chosen->>'product_id')::uuid
            and (('kbir' = any(catalog_token_forms(t)) and p.name_en ~* '\m(large|big|maxi|family|jumbo|xl)\M')
                 or ('zghir' = any(catalog_token_forms(t)) and p.name_en ~* '\m(small|mini|petit)\M')
                 or exists (select 1 from unnest(catalog_tokens(p.name_en) || catalog_tokens(coalesce(p.name_ar, ''))) n
                             where length(n) >= 3 and n = any(catalog_token_forms(t))))) then
      ties := jsonb_build_array(chosen) || coalesce((select jsonb_agg(x) from jsonb_array_elements(ties) x where x->>'product_id' <> chosen->>'product_id'), '[]'::jsonb);
      chosen := null; v_status := 'ambiguous'; v_assumed := false; v_rule := 'negated_choice';
    end if;
    v_cover_top := null;
    if chosen is not null and v_pack and v_msg is not null then
      select (sc->>'cover')::int into v_cover_top from jsonb_array_elements(v_scan) sc where sc->>'product_id' = chosen->>'product_id';
    end if;
    -- B4: also when the message names the chosen one exactly, if the other one explains more of the message («bazella w jazar
    -- mkhalta» names the carrot, but the mixed bag explains more)
    if chosen is not null and v_pack then
      select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
                                                   'price_usd', null, 'available', 1)), '[]'::jsonb) into narrowed
        from products p where p.id = any(v_ev_exact) and p.id <> (chosen->>'product_id')::uuid
         and (not (chosen->>'product_id')::uuid = any(v_ev_exact)
              -- B4: the line is not in the customer's words (the model translated «jazar» into «جزر»), and the other product
              -- explains more of what the customer did write
              or (not exists (select 1 from unnest(catalog_tokens(ln->>'raw')) t where catalog_token_forms(t) && v_msg_forms
                                and t !~ '^[0-9]+$' and not exists (select 1 from catalog_filler cf where cf.word = t))
                  and (select (sc->>'cover')::int from jsonb_array_elements(v_scan) sc where (sc->>'product_id')::uuid = p.id) > coalesce(v_cover_top, 0)))
         and not exists (select 1 from jsonb_array_elements(v_quote_lines) q where (q->>'product_id')::uuid = p.id)
         and exists (select 1 from language_pack lp where lp.sku = p.sku and lp.level <> 'brand'
                       and lp.forms && array(select f from unnest(catalog_tokens(ln->>'raw')) t, unnest(catalog_token_forms(t)) f
                                              where not exists (select 1 from catalog_filler cf where cf.word = f)));
      if jsonb_array_length(narrowed) > 0 then
        if (chosen->>'product_id')::uuid = any(v_ev_exact) then v_rule := 'cover_doubt'; end if;
        ties := jsonb_build_array(chosen) || narrowed; chosen := null; v_status := 'ambiguous'; v_assumed := false;
      end if;
    end if;

    v_qty := coalesce((ln->>'qty')::numeric, 1); v_note := null;
    -- the same product twice is one line said twice ("cherry tomatoes please, البندورة الزغيرة"): keep the larger quantity
    if chosen is not null and exists (select 1 from jsonb_array_elements(v_quote_lines) q where q->>'product_id' = chosen->>'product_id') then
      select jsonb_agg(case when q->>'product_id' = chosen->>'product_id' then q || jsonb_build_object('qty', greatest((q->>'qty')::numeric, v_qty)) else q end)
        into v_quote_lines from jsonb_array_elements(v_quote_lines) q;
      v_lines := v_lines || jsonb_build_object('idx', idx, 'raw', ln->>'raw', 'query', ln->>'query', 'status', 'same_as_before', 'qty', v_qty,
                   'assumed', v_assumed, 'via', res->>'via', 'chosen', null, 'candidates', null);
      v_n := v_n - 1;
      continue;
    end if;
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
                 'unexplained', case when v_pack then top->'unexplained' else null end, 'b4', v_rule, 'pick', v_pick,
                 -- B1c: every product these words fit, so an edit finds the one already in the basket («wet wipes» is the Oui Oui in it)
                 'tied', (select jsonb_agg(jsonb_build_object('product_id', x->>'product_id')) from (select x from jsonb_array_elements(
                            case when jsonb_array_length(v_fit) > 1 then v_fit else ties end) x limit 12) t));
  end loop;

  -- B4: one product said across two lines. The fast model cuts «كيس بازيلا وجزر مفرزة» into peas and carrots; the mixed bag's
  -- own term «بازيلا وجزر» spans both. When a product no line chose has a kind or exact term found whole in the message, made of
  -- words from two neighbouring lines (each giving a different word), both lines become one question with that product first.
  if v_msg is not null and jsonb_array_length(v_lines) > 1 then
    for k in 0 .. jsonb_array_length(v_lines) - 2 loop
      if (v_lines->k->>'status') not in ('matched', 'ambiguous', 'not_found') or (v_lines->(k+1)->>'status') not in ('matched', 'ambiguous', 'not_found') then continue; end if;
      select jsonb_build_object('product_id', p.id, 'name', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand, 'price_usd', null, 'in_stock', true)
        into v_split
        from products p join language_pack lp on lp.sku = p.sku and lp.level <> 'brand',
             lateral (select array(select f from unnest(catalog_tokens(v_lines->k->>'raw')) t, unnest(catalog_token_forms(t)) f
                                    where not exists (select 1 from catalog_filler cf where cf.word = f)) as a,
                             array(select f from unnest(catalog_tokens(v_lines->(k+1)->>'raw')) t, unnest(catalog_token_forms(t)) f
                                    where not exists (select 1 from catalog_filler cf where cf.word = f)) as b) w
       where p.is_active and lp.forms && w.a and lp.forms && w.b
         and not (lp.forms && w.a and lp.forms && w.b and (select array(select unnest(lp.forms) intersect select unnest(w.a))) = (select array(select unnest(lp.forms) intersect select unnest(w.b))))
         and exists (select 1 from jsonb_array_elements(v_scan) sc where (sc->>'product_id')::uuid = p.id and not (sc->>'excluded')::boolean and (sc->>'lvl')::int >= 2)
         -- the whole term, word after word, in the message
         and exists (select 1 from generate_series(1, coalesce(array_length(catalog_tokens(v_msg), 1), 0) - cardinality(lp.tokens) + 1) st
                      where not exists (select 1 from generate_subscripts(lp.tokens, 1) j
                                         where not (catalog_token_forms((catalog_tokens(v_msg))[st + j - 1]) && catalog_token_forms(lp.tokens[j]))))
         and not exists (select 1 from jsonb_array_elements(v_lines) l where l->'chosen'->>'product_id' = p.id::text)
       limit 1;
      if v_split is null then continue; end if;
      for i in k .. k + 1 loop
        if v_lines->i->>'status' = 'matched' then
          v_unmatched := v_unmatched + 1;
          select coalesce(jsonb_agg(q), '[]'::jsonb) into v_quote_lines from jsonb_array_elements(v_quote_lines) q
           where not (q->>'product_id' = v_lines->i->'chosen'->>'product_id' and q->>'raw' = v_lines->i->>'raw');
        end if;
        v_lines := jsonb_set(v_lines, array[i::text], (v_lines->i) || jsonb_build_object('status', 'ambiguous', 'assumed', false, 'chosen', null,
                     'candidates', jsonb_build_array(v_split) || coalesce(case when v_lines->i->'chosen' <> 'null'::jsonb then jsonb_build_array(v_lines->i->'chosen') end, '[]'::jsonb),
                     'split_of', v_split->>'product_id'));
      end loop;
    end loop;
  end if;

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

create or replace function plan_order_core(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare v_msg text := nullif(btrim(coalesce(p_intent->>'_message', '')), ''); ms jsonb; ls jsonb := coalesce(p_intent->'lines', '[]'::jsonb);
        n int; i int; k int := null; lo int := null; hi int := null; a_forms text[]; b_forms text[];
        fl text[]; has_mark boolean[] := '{}'; only_mark boolean[] := '{}'; hit_a boolean[] := '{}'; hit_b boolean[] := '{}';
        merged jsonb; res jsonb; ln jsonb; cand jsonb; extra jsonb := '[]'::jsonb; part text; v_rest text;
begin
  if v_msg is null then return plan_order_core_0078(p_party, p_intent, p_village, p_choices); end if;
  ms := mixed_span(v_msg);
  n := jsonb_array_length(ls);
  if ms is null or n = 0 then return plan_order_core_0078(p_party, p_intent, p_village, p_choices); end if;

  select coalesce(array_agg(f), '{}') into a_forms from jsonb_array_elements_text(ms->'a') w, unnest(catalog_token_forms(w)) f;
  select coalesce(array_agg(f), '{}') into b_forms from jsonb_array_elements_text(ms->'b') w, unnest(catalog_token_forms(w)) f;
  -- each line: does it carry a mixed word, only that, or the span's own words for A or B
  for i in 0 .. n - 1 loop
    select coalesce(array_agg(f), '{}') into fl
      from unnest(catalog_tokens(coalesce(ls->i->>'raw', '') || ' ' || coalesce(ls->i->>'query', ''))) t, unnest(catalog_token_forms(t)) f
     where not exists (select 1 from catalog_filler cf where cf.word = t);
    has_mark := has_mark || (fl && catalog_mixed_line_words());
    only_mark := only_mark || (cardinality(fl) > 0 and not exists (select 1 from unnest(fl) f where not f = any(catalog_mixed_line_words())));
    hit_a := hit_a || (fl && a_forms);
    hit_b := hit_b || (fl && b_forms);
  end loop;
  for i in 1 .. n loop if has_mark[i] then k := i; exit; end if; end loop;     -- 1-based
  if k is not null then
    if only_mark[k] then                                                        -- the mixed word read as a line of its own
      if (ms->>'mixed_first')::boolean then lo := k; hi := least(n, k + 2); else hi := k; lo := greatest(1, k - 2); end if;
    elsif (ms->>'mixed_first')::boolean then
      lo := k; hi := case when hit_b[k] or k = n then k else k + 1 end;
      -- B1c (0138): the span's words on more than one line after the mixed word: join them all (at most two lines on)
      while hi < n and hi < k + 2 and not ((hit_a[k] or hit_a[hi]) and (hit_b[k] or hit_b[hi])) and (hit_a[hi + 1] or hit_b[hi + 1]) loop hi := hi + 1; end loop;
    else
      hi := k; lo := case when hit_a[k] or k = 1 then k else k - 1 end;
      -- B1c (0138): «bazella» / «jazar» / «mkhalta, plein soleil» (B1b's gate run 43746499760, hz0815): A and B on the two lines
      -- before the mixed word. Join back every neighbouring line that carries the span's words (at most two lines back), so A is
      -- never left as a line of its own (it matched the peas).
      while lo > 1 and lo > k - 2 and not (hit_a[lo] or hit_a[k]) and (hit_a[lo - 1] or hit_b[lo - 1]) loop lo := lo - 1; end loop;
    end if;
  else
    -- the model dropped the mixed word: the lines that carry the span's own words, and the neighbour of a lone one
    for i in 1 .. n loop
      if hit_a[i] or hit_b[i] then lo := coalesce(lo, i); hi := i; end if;
    end loop;
    if lo is not null and lo = hi and not (hit_a[lo] and hit_b[lo]) then
      if hit_b[lo] and not (ms->>'mixed_first')::boolean and lo > 1 then lo := lo - 1;
      elsif hit_a[lo] and hi < n then hi := hi + 1;
      else lo := null; end if;
    end if;
    if lo is not null and hi - lo > 1 then lo := null; end if;                   -- the span's words far apart: not one item
  end if;
  -- a line that names a shop is never folded into another
  if lo is not null and exists (select 1 from generate_series(lo, hi) g where nullif(ls->(g - 1)->>'source_hint', '') is not null) then lo := null; end if;
  if lo is null then return plan_order_core_0078(p_party, p_intent, p_village, p_choices); end if;

  merged := (ls->(hi - 1)) || jsonb_build_object('raw', ms->>'span', 'query', ms->>'span', 'source_hint', null,
    'brand_hint', (select x->'brand_hint' from jsonb_array_elements(ls) with ordinality e(x, o) where o between lo and hi and nullif(x->>'brand_hint', '') is not null order by o limit 1),
    'qty', (select max(coalesce((x->>'qty')::numeric, 1)) from jsonb_array_elements(ls) with ordinality e(x, o) where o between lo and hi),
    'modifiers', coalesce((select jsonb_agg(distinct m) from jsonb_array_elements(ls) with ordinality e(x, o), jsonb_array_elements(coalesce(x->'modifiers', '[]'::jsonb)) m
                            where o between lo and hi), '[]'::jsonb));
  ls := coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(ls) with ordinality e(x, o) where o < lo), '[]'::jsonb)
        || jsonb_build_array(merged)
        || coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(ls) with ordinality e(x, o) where o > hi), '[]'::jsonb);
  -- The span is a line now. The planner's message evidence (words the model dropped from a line) must not read the span's own
  -- words again: «jazar» in «bazella w jazar mkhalta» names the carrots exactly and would beat the mixed bag on its own line.
  -- The rest of the message («plein soleil», a size, a "not that one") still counts.
  v_rest := nullif(btrim((select string_agg(t, ' ' order by o) from unnest(catalog_tokens(v_msg)) with ordinality u(t, o)
                          where not exists (select 1 from jsonb_array_elements_text(ms->'cut') c where c::int = o))), '');
  res := plan_order_core_0078(p_party, jsonb_set(p_intent, '{lines}', ls) || jsonb_build_object('_message', v_rest), p_village, p_choices);

  -- No product explains both items: a question, and it offers each item's best match too ("which one do you mean?").
  select x into ln from jsonb_array_elements(res->'lines') x where (x->>'idx')::int = lo - 1 and strpos(x->>'raw', ms->>'span') > 0 limit 1;
  if ln is not null and ln->>'status' in ('ambiguous', 'not_found') then
    foreach part in array array[(select string_agg(w, ' ') from jsonb_array_elements_text(ms->'a') w), (select string_agg(w, ' ') from jsonb_array_elements_text(ms->'b') w)] loop
      cand := (catalog_lookup(part, part, null, 3, '{}')->'matches')->0;
      if cand is not null then
        extra := extra || jsonb_build_object('product_id', cand->>'product_id', 'name', cand->>'name_en', 'name_ar', cand->>'name_ar', 'brand', cand->>'brand',
                                             'price_usd', cand->'price_usd', 'in_stock', coalesce((cand->>'available')::numeric, 0) > 0);
      end if;
    end loop;
    ln := ln || jsonb_build_object('status', 'ambiguous', 'b4', 'mixed_word',
      'candidates', (select jsonb_agg(c) from (select distinct on (c->>'product_id') c, o from jsonb_array_elements(coalesce(ln->'candidates', '[]'::jsonb) || extra) with ordinality e(c, o)
                                              order by c->>'product_id', o) d limit 3));
    res := jsonb_set(res, '{lines}', (select jsonb_agg(case when (x->>'idx')::int = lo - 1 and strpos(x->>'raw', ms->>'span') > 0 then ln else x end) from jsonb_array_elements(res->'lines') x));
    if res->>'next' = 'card' then res := res || jsonb_build_object('next', 'ask'); end if;
  elsif ln is not null then
    res := jsonb_set(res, '{lines}', (select jsonb_agg(case when (x->>'idx')::int = lo - 1 and strpos(x->>'raw', ms->>'span') > 0 then x || jsonb_build_object('b4', coalesce(x->>'b4', 'mixed_word')) else x end)
                                      from jsonb_array_elements(res->'lines') x));
  end if;
  return res;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
