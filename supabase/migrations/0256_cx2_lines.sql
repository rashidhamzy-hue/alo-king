-- Alo King, session CX2, migration 0256: two words from the founder's staging chat of 18 November (docs/log/cx2.md;
-- evals/cases/cx2_founder_chat.json).
--   1 «نص كفة» (half a kilo of kafta, in a voice note at 07:37): the transcript writes kafta «كفة». The word was no product's, the line was
--     not found, and nothing said so. «كفة» and «كفته» are kafta's words now (AK-0028). The turn now names any line it could not find
--     (packages/agents/src/pipeline.ts), whatever the words.
--   2 "cafe mate" (Coffee-mate creamer, 08:39) was asked as «which one?» over three Najjar coffees: "cafe" fit them and "mate" fit none.
--     (a) "cafe mate", "café mate", «كافي ميت», «كفي ميت» and "coffeemate" are Coffee Mate's words now (AK-0132).
--     (b) The rule, for every product: a «which one?» never offers products when a word the customer said, which none of them explains,
--     names another product's brand or kind. Such a line is a kind we cannot show (b4 'other_kind'): the turn answers it with PD1's
--     honest answer, never with a different kind. Sizes and describing words keep their question (B1c).

insert into language_pack(sku, term, level, lang, version)
select v.sku, v.term, v.level, v.lang, 'cx2-2026-11-18' from (values
  ('AK-0028', 'كفة', 'exact', 'ar'), ('AK-0028', 'كفته', 'exact', 'ar'), ('AK-0028', 'kafta', 'exact', 'arabizi'),
  ('AK-0132', 'cafe mate', 'exact', 'en'), ('AK-0132', 'café mate', 'exact', 'fr'), ('AK-0132', 'coffeemate', 'exact', 'en'),
  ('AK-0132', 'كافي ميت', 'exact', 'ar'), ('AK-0132', 'كفي ميت', 'exact', 'ar'), ('AK-0132', 'kafe mate', 'exact', 'arabizi')
) v(sku, term, level, lang)
on conflict (sku, term, level) do nothing;

alter function plan_order_core(uuid, jsonb, uuid, jsonb) rename to plan_order_core_0138;

-- A word the customer said that names another product's brand (a word of a 'brand' term of the language pack: "mate" of Coffee Mate) or
-- its kind (a whole 'kind' term: "labneh"), when no candidate explains it, by its terms or its own name: "mate" under Najjar coffees. A size or a describing word («صغيرة», "big") names no brand or kind and keeps
-- its question, as before (B1c, 1.22). A mixed-word question (0133) offers each item's best match on purpose and is left as it is.
create or replace function catalog_other_kind(p_words jsonb, p_candidates jsonb) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from jsonb_array_elements_text(coalesce(p_words, '[]'::jsonb)) w
      join language_pack lp on w = any(lp.forms)
                           and (lp.level = 'brand'
                                or lp.level = 'kind' and lp.forms <@ (select array_agg(x) from jsonb_array_elements_text(p_words) x))
     where not exists (select 1 from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) c      -- the word is in a candidate's own name
                        where w = any(catalog_term_forms(coalesce(c->>'name', '') || ' ' || coalesce(c->>'name_ar', ''))))
       and lp.sku not in (select p.sku from products p
                           where p.id::text in (select c->>'product_id' from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) c)))
$$;

-- The planner (0138's wrapper, unchanged, now plan_order_core_0138), then the rule of (2b) on its lines.
create or replace function plan_order_core(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare res jsonb := plan_order_core_0138(p_party, p_intent, p_village, p_choices);
begin
  if not exists (select 1 from jsonb_array_elements(coalesce(res->'lines', '[]'::jsonb)) x
                  where x->>'status' = 'ambiguous' and coalesce(x->>'b4', '') <> 'mixed_word'
                    and jsonb_typeof(x->'unexplained') = 'array' and catalog_other_kind(x->'unexplained', x->'candidates')) then
    return res;
  end if;
  return jsonb_set(res, '{lines}', (select jsonb_agg(case
      when x->>'status' = 'ambiguous' and coalesce(x->>'b4', '') <> 'mixed_word'
           and jsonb_typeof(x->'unexplained') = 'array' and catalog_other_kind(x->'unexplained', x->'candidates')
        then x || jsonb_build_object('status', 'not_found', 'b4', 'other_kind', 'chosen', null, 'candidates', null)
      else x end order by o) from jsonb_array_elements(res->'lines') with ordinality e(x, o)));
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
