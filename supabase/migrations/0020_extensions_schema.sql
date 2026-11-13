-- Alo King Chouf, session C1: move pg_trgm (and pgcrypto, where it sits in public) out of the public schema.
-- A1's finding under task 0.4 (docs/HANDOFF.md, section F): on Supabase pg_trgm was installed in public, and its 31 functions,
-- owned by supabase_admin, kept their default EXECUTE grant to PUBLIC, so anon and authenticated could reach them and PostgREST
-- listed them under /rpc. A migration cannot revoke a grant on a function it does not own, but it can move the extension.
--
-- Probed on staging on 13 Nov 2026 inside a transaction that was rolled back: as `postgres`, ALTER EXTENSION pg_trgm SET SCHEMA
-- extensions succeeds (supautils lets the privileged role do it) and the functions stay owned by supabase_admin.
--
-- What keeps working, and why:
--   * Trigram indexes reference their operator class by oid, so they move with the extension and need no rebuild.
--   * The four functions that call similarity(), word_similarity() or the % operator get `search_path = public, extensions,
--     pg_temp`, so they resolve the moved functions whatever the caller's search_path is (PGlite, psql, PostgREST).
--     A later CREATE OR REPLACE of one of them must repeat that clause; test/db/extensions-schema.test.ts fails if it does not.
--   * The server role gets USAGE on the schema. The client roles get none, so the trigram functions are no longer callable by
--     anon or authenticated, through the API or otherwise (scripts/check_permissions.sh now checks this and fails on it).

create schema if not exists extensions;

do $$ declare e text;
begin
  foreach e in array array['pg_trgm', 'pgcrypto'] loop
    if exists (select 1 from pg_extension where extname = e and extnamespace = 'public'::regnamespace) then
      execute format('alter extension %I set schema extensions', e);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant usage on schema extensions to service_role; end if;
  -- On Supabase the extensions schema is owned by postgres and grants USAGE to the client roles. Nothing of ours needs it:
  -- every client grant was revoked in 0007, and the Worker and the console reach the database as service_role.
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke usage on schema extensions from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke usage on schema extensions from authenticated; end if;
  revoke usage on schema extensions from public;
end $$;

alter function search_products(text, uuid, integer) set search_path = public, extensions, pg_temp;
alter function search_catalog(text, text, integer) set search_path = public, extensions, pg_temp;
alter function resolve_place(uuid, text, text) set search_path = public, extensions, pg_temp;
alter function plan_order(uuid, jsonb, uuid, jsonb) set search_path = public, extensions, pg_temp;
