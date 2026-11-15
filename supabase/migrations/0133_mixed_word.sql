-- 0133 (session M1, founder decision of 14 Nov): a "mixed" word joining two items is one mixed product.
--
-- «baddi bazella w jazar mkhalta, plein soleil» (language-pack cases hz0815, g0815) means one bag of mixed peas and carrots
-- (AK-0237). The fast model cuts it into «bazella» / «jazar mkhalta» / «plein soleil», often in Arabic script and sometimes
-- misread («بذرة», «بزل»), and the carrots line then matched loose carrots (AK-0008), or the misread line a seed product: a
-- wrong product in 4 of 8 live readings (runs 43629416444, 43632030063, 43632950715, 43634267959), and in main's own runs.
-- The rule, by the founder: a mixed word (mkhalta, مخلوطة, مشكّل, mix) joining two items means one mixed product when the
-- catalog has one; otherwise ask which. Fixed in the planner, from the customer's own words (_message), not in a prompt.
--
-- How: mixed_span(message) finds, in the customer's words, the two items the mixed word joins ("bazella w jazar"). Before
-- the planner reads the lines, the lines the model cut out of that span (the line with the mixed word and its neighbour, or
-- the lines that carry the span's own words) become one line worded as the customer wrote the span, the mixed word left out.
-- The planner (0078's body, unchanged, now plan_order_core_0078) then matches that line as it matches any other: the mixed
-- product's own term («bazella w jazar», «بازيلا وجزر», "peas and carrots") explains every word and it is chosen; when no
-- product explains both items, it is a question, and the question offers each item's best match as well.
--
-- Anyone changing the planner's rules: redefine plan_order_core_0078 (its text is 0078's). plan_order_core is this wrapper.

alter function plan_order_core(uuid, jsonb, uuid, jsonb) rename to plan_order_core_0078;

-- The words that say "mixed together", as catalog_tokens folds them (ة to ه, accents kept). «مختلطة» is how the fast model
-- also writes mkhalta in Arabic script (gate run 43651509767, hz0815: «بذرة» / «جزر مختلطة»).
create or replace function catalog_mixed_words() returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array['mkhalta', 'mkhalata', 'mkhalat', 'mkhalte', 'mkhalteh', 'mkhaltin', 'm5alta', 'm5alata', 'm5alat', 'mkhaleta',
               'mshakkal', 'mshakal', 'mshakkale', 'mshakale', 'mshakli', 'mix', 'mixed', 'mixte', 'melange', 'mélange',
               'mkhtalta', 'mekhtalta', 'mikhtalta',
               'مخلوطه', 'مخلوط', 'مخلوطين', 'مخلطه', 'مختلطه', 'مختلط', 'مختلطين', 'مشكل', 'مشكله', 'مكس', 'ميكس'] $$;

-- The same, plus how the fast model misreads them in its lines («مخلتة», «مخللة» for mkhalta). Used on the model's lines only,
-- and only when the customer's own words hold a mixed word: «مخلل» said by the customer is pickled and never matches here.
create or replace function catalog_mixed_line_words() returns text[] language sql immutable set search_path = public, pg_temp as $$
  select catalog_mixed_words() || array['مخلته', 'مخلطه', 'مخلط', 'مخلله', 'مخلتي'] $$;

create or replace function catalog_is_conjunction(t text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select t in ('w', 'wa', 'and', 'et', 'و', 'مع', 'ma3') or (t like 'و%' and length(t) > 2) $$;

-- The two items a mixed word joins in the customer's words: «A w B mkhalta», «A وB مخلوطة», "mixed A and B". Null when none.
-- a and b are the item words (at most two each, filler words left out); span is A, the conjunction and B, as written;
-- cut is the token positions (1-based, in catalog_tokens(message)) the span and the mixed word take.
create or replace function mixed_span(p_msg text) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare t text[] := catalog_tokens(coalesce(p_msg, '')); n int := coalesce(array_length(catalog_tokens(coalesce(p_msg, '')), 1), 0);
        m int; c int; j int; a text[]; b text[]; glued boolean;
begin
  for m in 1 .. n loop
    if not (catalog_token_forms(t[m]) && catalog_mixed_words()) then continue; end if;
    -- A w B mixed: the conjunction is at most three words before the mixed word
    c := null;
    for j in reverse m - 1 .. greatest(1, m - 3) loop
      if catalog_is_conjunction(t[j]) then c := j; exit; end if;
    end loop;
    if c is not null then
      glued := t[c] like 'و%' and length(t[c]) > 2;
      b := case when glued then array[t[c]] else '{}' end;
      for j in c + 1 .. m - 1 loop
        if not exists (select 1 from catalog_filler cf where cf.word = t[j]) then b := b || t[j]; end if;
      end loop;
      a := '{}'; j := c - 1;
      while j >= 1 and coalesce(array_length(a, 1), 0) < 2 and not catalog_is_conjunction(t[j])
            and not exists (select 1 from catalog_filler cf where cf.word = t[j])
            and not (catalog_token_forms(t[j]) && catalog_mixed_words()) loop
        a := t[j] || a; j := j - 1;
      end loop;
      if coalesce(array_length(a, 1), 0) > 0 and coalesce(array_length(b, 1), 0) > 0 and coalesce(array_length(b, 1), 0) <= 2 then
        return jsonb_build_object('a', to_jsonb(a), 'b', to_jsonb(b), 'mixed_first', false, 'cut', to_jsonb(array(select g from generate_series(j + 1, m) g)),
          'span', btrim(array_to_string(a, ' ') || ' ' || case when glued then '' else t[c] || ' ' end || array_to_string(b, ' ')));
      end if;
    end if;
    -- mixed A and B: the conjunction is at most three words after the mixed word
    c := null;
    for j in m + 1 .. least(n, m + 3) loop
      if catalog_is_conjunction(t[j]) then c := j; exit; end if;
    end loop;
    if c is not null then
      glued := t[c] like 'و%' and length(t[c]) > 2;
      a := '{}';
      for j in m + 1 .. c - 1 loop
        if not exists (select 1 from catalog_filler cf where cf.word = t[j]) then a := a || t[j]; end if;
      end loop;
      b := case when glued then array[t[c]] else '{}' end; j := c + 1;
      while j <= n and coalesce(array_length(b, 1), 0) < (case when glued then 1 else 2 end) and not catalog_is_conjunction(t[j])
            and not exists (select 1 from catalog_filler cf where cf.word = t[j]) loop
        b := b || t[j]; j := j + 1;
      end loop;
      if coalesce(array_length(a, 1), 0) > 0 and coalesce(array_length(b, 1), 0) > 0 then
        return jsonb_build_object('a', to_jsonb(a), 'b', to_jsonb(b), 'mixed_first', true, 'cut', to_jsonb(array(select g from generate_series(m, j - 1) g)),
          'span', btrim(array_to_string(a, ' ') || ' ' || case when glued then '' else t[c] || ' ' end || array_to_string(b, ' ')));
      end if;
    end if;
  end loop;
  return null;
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
    else
      hi := k; lo := case when hit_a[k] or k = 1 then k else k - 1 end;
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
