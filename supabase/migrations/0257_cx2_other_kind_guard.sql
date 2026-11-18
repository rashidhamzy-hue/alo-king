-- Alo King, session CX2 stage 2, migration 0257 (the next number after CX2's 0255 and 0256; recorded in docs/STATUS.md, section 5).
-- 0256's catalog_other_kind() read its two arguments as arrays. A plan line may carry JSON null for `candidates` (or a word list that is
-- not an array), and jsonb_array_elements then failed ("cannot extract elements from a scalar"): the live language gate's run
-- 44303688282 stopped on it before calling the model. Anything that is not an array now counts as empty: no candidates, no words.
-- Same rule as 0256 otherwise.

create or replace function catalog_other_kind(p_words jsonb, p_candidates jsonb) returns boolean language sql stable set search_path = public, pg_temp as $$
  with words as (select case when jsonb_typeof(p_words) = 'array' then p_words else '[]'::jsonb end as v),
       cands as (select case when jsonb_typeof(p_candidates) = 'array' then p_candidates else '[]'::jsonb end as v)
  select exists (
    select 1 from words, jsonb_array_elements_text(words.v) w
      join language_pack lp on w = any(lp.forms)
                           and (lp.level = 'brand'
                                or lp.level = 'kind' and lp.forms <@ (select coalesce(array_agg(x), '{}') from words, jsonb_array_elements_text(words.v) x))
     where not exists (select 1 from cands, jsonb_array_elements(cands.v) c      -- the word is in a candidate's own name
                        where w = any(catalog_term_forms(coalesce(c->>'name', '') || ' ' || coalesce(c->>'name_ar', ''))))
       and lp.sku not in (select p.sku from products p
                           where p.id::text in (select c->>'product_id' from cands, jsonb_array_elements(cands.v) c)))
$$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
