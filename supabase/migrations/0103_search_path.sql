-- Alo King Chouf, session F1 (G1 fixes): a fixed search_path on every function in public (G1-11).
--
-- The security advisor listed 322 functions whose search_path follows the caller. None is security definer, so a caller can only
-- confuse its own call today; it becomes a real hole the day one is. Every function now carries its own path:
--   * "public, extensions, pg_temp" for a function that calls a trigram (or pgcrypto) function, which live in the extensions
--     schema since 0020. Those already had it pinned (C1); they are left exactly as they are.
--   * "public, pg_temp" for every other one. pg_temp last, so a temporary object can never shadow one of ours.
--
-- pin_search_paths() does it, and is safe to run again: it touches only functions that have no search_path yet, and returns how
-- many it pinned. CREATE OR REPLACE FUNCTION drops a SET clause that is not repeated, so EVERY LATER MIGRATION THAT CREATES OR
-- REDEFINES A FUNCTION ENDS WITH `select pin_search_paths();` (or writes `set search_path = ...` on the function itself).
-- scripts/check_permissions.sh fails, naming the function, if one is left without it; so does test/db/search-path-f1.test.ts.

create or replace function pin_search_paths() returns int language plpgsql set search_path = public, pg_temp as $$
declare r record; n int := 0; v_path text;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.prokind, p.prosrc from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')          -- not an extension's own
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
  loop
    -- The same test as C1's guard (test/db/extensions-schema.test.ts), on the source with its string literals (raise messages)
    -- taken out, plus the pgcrypto functions. A false positive only adds the extensions schema to a path; a miss would break a search.
    v_path := case when regexp_replace(r.prosrc, '''[^'']*''', '', 'g')
                        ~* '(similarity|word_similarity|strict_word_similarity|show_trgm|show_limit|set_limit|digest|hmac|crypt|gen_salt|gen_random_bytes|pgp_[a-z_]+)\s*\(|\m\w+\s+(%|<%|%>|<<%|%>>)\s'
                   then 'public, extensions, pg_temp' else 'public, pg_temp' end;
    execute format('alter %s %s set search_path = %s', case when r.prokind = 'p' then 'procedure' else 'function' end, r.sig, v_path);
    n := n + 1;
  end loop;
  return n;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
