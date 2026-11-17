#!/usr/bin/env bash
# Permission smoke test. Builds a database the way Supabase does (anon, authenticated and service_role get default
# grants on everything in public), applies every migration, then proves: the server role can call functions and
# read tables; the two client roles can do neither. Run it against a scratch Postgres, and again against a real
# Supabase branch before launch:  DATABASE_URL=postgres://... scripts/check_permissions.sh
#
# EXISTING=1 is for a real Supabase project whose migrations are already applied (staging, later production):
# it builds nothing and changes no grant, no role and no data. It skips the role and default-privilege setup and the
# migration loop (Supabase created the roles itself, and the CLI applied the migrations), and it runs the one
# section that writes inside a transaction that is rolled back. The checks themselves are the same ones.
set -euo pipefail
PSQL="psql ${DATABASE_URL:?set DATABASE_URL} -v ON_ERROR_STOP=1 -q -At"
EXISTING="${EXISTING:-0}"
if [ "$EXISTING" = "1" ]; then
  for r in anon authenticated service_role; do
    [ "$($PSQL -c "select count(*) from pg_roles where rolname = '$r'")" = "1" ] || { echo "role $r is missing: this is not a Supabase database"; exit 1; }
  done
  n=$($PSQL -c "select count(*) from pg_proc where proname = 'can_send' and pronamespace = 'public'::regnamespace")
  [ "$n" = "1" ] || { echo "migrations are not applied (can_send() missing)"; exit 1; }
  echo "existing database: no roles, grants, migrations or data will be changed"
else
$PSQL <<'SQL'
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
    execute format('grant usage on schema public to %I', r);
    execute format('alter default privileges in schema public grant all on tables to %I', r);
    execute format('alter default privileges in schema public grant execute on functions to %I', r);
  end loop;
end $$;
SQL
for f in supabase/migrations/*.sql; do $PSQL -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f"; exit 1; }; done
fi
$PSQL <<'SQL'
begin;
insert into fx_rates(lbp_per_usd) values (89500);
set role service_role;
select 'service_role can call a function: ' || (current_fx() > 0);
select 'service_role can read a table: ' || (count(*) >= 0) from settings;
select 'service_role can write through a function: ' || begin_turn('perm-check', 'customer');
set local search_path = public;   -- the trigram functions live in the extensions schema (0020); the search functions find them anyway
select 'service_role can run a trigram search: ' || (search_catalog('labneh') is not null);
reset role;
rollback;   -- nothing the check wrote survives, on any database
do $$ declare r text; ok boolean; begin
  foreach r in array array['anon','authenticated'] loop
    execute format('set role %I', r);
    begin perform current_fx(); ok := false; exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception '% can call functions', r; end if;
    begin perform 1 from settings; ok := false; exception when insufficient_privilege then ok := true; end;
    if not ok then raise exception '% can read tables', r; end if;
    reset role;
    raise notice '% is locked out of functions and tables', r;
  end loop;
end $$;
-- Not just the two probes above: every function and every table in public, for each client role and for PUBLIC.
-- Extension functions: since migration 0020 no extension lives in public. On Supabase they are owned by supabase_admin, so a
-- migration cannot revoke their default PUBLIC grant; moving the extension is the fix, and an extension back in public is a hard failure.
-- In any other schema a client role can call one only with USAGE on that schema too, so both are checked.
do $$ declare n int; t text; begin
  select string_agg(distinct e.extname, ', ') into t from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid
    where p.pronamespace = 'public'::regnamespace;
  if t is not null then raise exception 'extension functions are in the public schema: % (move the extension to the extensions schema, see migration 0020)', t; end if;
  select count(*) into n from pg_proc p where pronamespace = 'public'::regnamespace and has_function_privilege('public', p.oid, 'execute');
  if n > 0 then raise exception '% of our functions are still callable by PUBLIC', n; end if;
  select count(*) into n from pg_proc p, unnest(array['anon','authenticated']) r
    where pronamespace = 'public'::regnamespace and has_function_privilege(r, p.oid, 'execute');
  if n > 0 then raise exception '% function grants to anon or authenticated', n; end if;
  select string_agg(distinct r || ' -> ' || e.extname, ', ') into t
    from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid, unnest(array['anon','authenticated']) r
    where e.extname in ('pg_trgm', 'pgcrypto') and has_schema_privilege(r, p.pronamespace, 'usage') and has_function_privilege(r, p.oid, 'execute');
  if t is not null then raise exception 'client roles can call extension functions: %', t; end if;
  -- A table grant to a client role is a hard failure unless row level security is on with no policy at all
  -- (then the grant is untidy but reaches no row). Those are listed by name as a WARNING so they get fixed by a migration.
  select count(*) into n from pg_class c, unnest(array['anon','authenticated']) r
    where relnamespace = 'public'::regnamespace and relkind in ('r','v','m','p')
      and (has_table_privilege(r, c.oid, 'select') or has_table_privilege(r, c.oid, 'insert') or has_table_privilege(r, c.oid, 'update') or has_table_privilege(r, c.oid, 'delete'))
      and (relkind <> 'r' or not relrowsecurity or exists (select 1 from pg_policy pol where pol.polrelid = c.oid));
  if n > 0 then raise exception '% table grants to anon or authenticated that RLS does not cover', n; end if;
  for t in select distinct c.relname from pg_class c, unnest(array['anon','authenticated']) r
    where relnamespace = 'public'::regnamespace and relkind = 'r'
      and (has_table_privilege(r, c.oid, 'select') or has_table_privilege(r, c.oid, 'insert') or has_table_privilege(r, c.oid, 'update') or has_table_privilege(r, c.oid, 'delete')) loop
    raise warning 'table % still has a grant to anon or authenticated (RLS blocks it; revoke it in a migration)', t;
  end loop;
  raise notice 'none of our functions is callable by PUBLIC, anon or authenticated, and no table grant escapes row level security';
end $$;
-- G1-11 (F1, 0103): every function of ours carries its own search_path, so no caller's path can change what a name means.
-- A migration that creates or redefines a function ends with `select pin_search_paths();` (CREATE OR REPLACE drops a SET clause).
do $$ declare t text; n int; begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname), count(*) into t, n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%');
  if n > 0 then raise exception '% functions have no fixed search_path (end the migration with select pin_search_paths();): %', n, t; end if;
  -- A function that calls a trigram function must find the extensions schema on its own path (C1, 0020).
  select string_agg(p.proname, ', ') into t from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and regexp_replace(p.prosrc, '''[^'']*''', '', 'g') ~* '(similarity|word_similarity|show_trgm)\s*\('
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%extensions%');
  if t is not null then raise exception 'functions that call trigram functions lack the extensions schema on their search_path: %', t; end if;
  raise notice 'every function in public has a fixed search_path';
end $$;
-- web_channel (C4, 0132; audit G1-12): the website's role may execute exactly the website's functions and nothing else. No staff
-- function, no money function, no function that takes a party id, no table, view or sequence, no membership in another role.
-- A new website function is granted by name in a migration and added to web_allowed here (and to WEB_CHANNEL_FUNCTIONS in
-- packages/commerce, which a test keeps equal to this list).
do $$ declare web_allowed text[] := array['web_session_start', 'web_session_state', 'web_session_end', 'web_link_code',
                                           'cart_set_line', 'cart_view', 'checkout_quote', 'checkout_order', 'web_confirm_order',
                                           'web_catalog_home', 'web_catalog_category', 'web_catalog_product', 'web_catalog_search',
                                           'web_food_list', 'web_food_place', 'web_listing_want', 'web_listing_remove',
                                           'web_place_order', 'web_order_page', 'web_orders', 'web_order_again', 'web_account', 'web_memory_forget',
                                           'web_memory_pref', 'web_sign_out_everywhere', 'web_save_pin', 'web_pin_village', 'web_place_details',
                                           'web_windows', 'web_service_facts', 'web_cart_count'];
              t text; n int; begin
  if not exists (select 1 from pg_roles where rolname = 'web_channel') then raise exception 'role web_channel is missing (migration 0132)'; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into t from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('web_channel', p.oid, 'execute') and not (p.proname = any(web_allowed));
  if t is not null then raise exception 'web_channel can execute functions outside its list: %', t; end if;
  -- Other schemas (Supabase's own: auth, storage, ...): only reachable with USAGE on the schema, which 0132 never grants.
  -- Listed as a warning if the platform grants it, so a person looks; the extension check above already covers pg_trgm and pgcrypto.
  for t in select distinct n.nspname from pg_namespace n
     where n.nspname not in ('public', 'pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
       and has_schema_privilege('web_channel', n.oid, 'usage') loop
    raise warning 'web_channel has USAGE on schema % (through PUBLIC or the platform); check what it can call there', t;
  end loop;
  select string_agg(a, ', ') into t from unnest(web_allowed) a
   where not exists (select 1 from pg_proc p where p.proname = a and p.pronamespace = 'public'::regnamespace and has_function_privilege('web_channel', p.oid, 'execute'));
  if t is not null then raise exception 'web_channel cannot execute: %', t; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into t from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = any(web_allowed)
     and (not p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%'));
  if t is not null then raise exception 'website functions that are not security definer with a fixed search_path: %', t; end if;
  select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace and (
      (c.relkind in ('r','v','m','p','f') and (has_table_privilege('web_channel', c.oid, 'select') or has_table_privilege('web_channel', c.oid, 'insert')
        or has_table_privilege('web_channel', c.oid, 'update') or has_table_privilege('web_channel', c.oid, 'delete')))
   or (c.relkind = 'S' and (has_sequence_privilege('web_channel', c.oid, 'usage') or has_sequence_privilege('web_channel', c.oid, 'select'))));
  if n > 0 then raise exception 'web_channel holds % table or sequence privileges', n; end if;
  select string_agg(b.rolname, ', ') into t from pg_auth_members m join pg_roles b on b.oid = m.roleid where m.member = 'web_channel'::regrole;
  if t is not null then raise exception 'web_channel is a member of: %', t; end if;
  if exists (select 1 from pg_roles where rolname = 'web_channel' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) then
    raise exception 'web_channel has an attribute it must not have (superuser, bypassrls, createrole, createdb or replication)';
  end if;
  raise notice 'web_channel can execute only the % website functions and holds no table privilege', array_length(web_allowed, 1);
end $$;
do $$ declare ok boolean; probe text; begin
  begin execute 'set role web_channel';
  exception when insufficient_privilege then
    raise warning 'this connection may not SET ROLE web_channel: the probes as the role are skipped (the privilege checks above ran)';
    return;
  end;
  foreach probe in array array[
      'select confirm_order_checked(null::uuid, null::uuid, ''x''::text)', 'select claim_link_code(null::uuid, ''ALO-222222'')',
      'select transition_order(null::uuid, ''confirmed''::order_status, ''customer''::actor_kind)', 'select plan_cart(null::uuid, ''[]''::jsonb)',
      'select quote_order(''[]''::jsonb)', 'select web_sessions_revoke(null::uuid)', 'select current_fx()',
      'select 1 from orders limit 1', 'select 1 from payments limit 1', 'select 1 from ledger_entries limit 1',
      'select 1 from web_sessions limit 1', 'select 1 from link_codes limit 1', 'select 1 from carts limit 1', 'select 1 from settings limit 1',
      'select 1 from products limit 1', 'select 1 from product_images limit 1', 'select 1 from product_facts limit 1',
      'select 1 from catalog_public_pictures limit 1', 'select 1 from demand_signals limit 1', 'select catalog_web_items()'] loop
    begin execute probe; ok := false; exception when insufficient_privilege then ok := true; end;
    if not ok then reset role; raise exception 'web_channel was allowed: %', probe; end if;
  end loop;
  reset role;
  raise notice 'web_channel is refused staff and money functions, party-id functions and every table';
end $$;
begin;
do $$ begin
  begin execute 'set role web_channel';
  exception when insufficient_privilege then raise warning 'web_channel session probe skipped (no SET ROLE)'; return; end;
  if (web_session_start('perm-check')->>'token') is null then raise exception 'web_channel could not start a session'; end if;
  if (web_catalog_home()->'categories') is null then raise exception 'web_channel could not read the catalog home'; end if;
  if (web_catalog_search('perm-check zz')->>'ok') is distinct from 'true' then raise exception 'web_channel could not search the catalog'; end if;
  reset role;
  raise notice 'web_channel can start a session and read the catalog through its own functions';
end $$;
rollback;   -- the session row does not survive, on any database
SQL
