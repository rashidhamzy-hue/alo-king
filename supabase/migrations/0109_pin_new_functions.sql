-- Alo King Chouf, session F1 (G1 fixes): a function created later gets a fixed search_path too (G1-11, after 0103).
--
-- 0103 pinned every function that existed. CREATE OR REPLACE FUNCTION without a SET clause leaves a function unpinned again, and a
-- migration numbered after 0103 runs after it on a fresh database: D4's 0114 redefines review_proposed_fact that way. (On staging,
-- where 0114 was applied before 0103 arrived, 0103 itself pins it.) Rather than rely on every later session remembering, an event
-- trigger pins each function or procedure created in public without a search_path, as it is created:
--   * the same choice of path as 0103 (search_path_for): "public, extensions, pg_temp" for trigram or pgcrypto callers;
--   * a function that already says `set search_path = ...` is left as it is;
--   * it never blocks the DDL that fired it: a function it may not alter (another owner) is skipped with a warning, and the
--     permission check names it.
-- If the database refuses to create an event trigger (a managed platform may), the migration still applies, says so, and
-- `select pin_search_paths();` at the end of a migration remains the way; scripts/check_permissions.sh fails on any function left
-- without a path either way.

create or replace function search_path_for(p_fn oid) returns text language sql stable set search_path = public, pg_temp as $$
  select case when regexp_replace(p.prosrc, '''[^'']*''', '', 'g')
                   ~* '(similarity|word_similarity|strict_word_similarity|show_trgm|show_limit|set_limit|digest|hmac|crypt|gen_salt|gen_random_bytes|pgp_[a-z_]+)\s*\(|\m\w+\s+(%|<%|%>|<<%|%>>)\s'
              then 'public, extensions, pg_temp' else 'public, pg_temp' end
    from pg_proc p where p.oid = p_fn $$;

-- 0103's function, the path chosen by search_path_for. Returns how many it pinned.
create or replace function pin_search_paths() returns int language plpgsql set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.prokind from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
  loop
    execute format('alter %s %s set search_path = %s', case when r.prokind = 'p' then 'procedure' else 'function' end, r.sig, search_path_for(r.oid));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function pin_new_functions() returns event_trigger language plpgsql set search_path = public, pg_temp as $$
declare r record;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.prokind
      from pg_event_trigger_ddl_commands() c join pg_proc p on p.oid = c.objid
     where c.command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE') and p.pronamespace = 'public'::regnamespace
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) x where x like 'search_path=%')
  loop
    begin
      -- ALTER FUNCTION fires ddl_command_end with its own tag, which this trigger does not listen to: no recursion.
      execute format('alter %s %s set search_path = %s', case when r.prokind = 'p' then 'procedure' else 'function' end, r.sig, search_path_for(r.oid));
    exception when others then
      raise warning 'pin_new_functions: % was not pinned (%); end the migration with select pin_search_paths();', r.sig, sqlerrm;
    end;
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'pin_new_functions') then
    create event trigger pin_new_functions on ddl_command_end when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
      execute function pin_new_functions();
  end if;
exception when insufficient_privilege or feature_not_supported then
  raise notice 'event trigger not created here (%): later migrations end with select pin_search_paths();', sqlerrm;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
