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
-- Functions that belong to an extension (pg_trgm and the like) are not ours: on Supabase they are owned by supabase_admin, so a
-- migration cannot revoke their default PUBLIC grant. They are reported by extension name as a WARNING; our own functions are a hard failure.
do $$ declare n int; t text; begin
  select count(*) into n from pg_proc p where pronamespace = 'public'::regnamespace and has_function_privilege('public', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if n > 0 then raise exception '% of our functions are still callable by PUBLIC', n; end if;
  select count(*) into n from pg_proc p, unnest(array['anon','authenticated']) r
    where pronamespace = 'public'::regnamespace and has_function_privilege(r, p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if n > 0 then raise exception '% function grants to anon or authenticated', n; end if;
  for t in select e.extname || ' (' || count(*) || ' functions)' from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_extension e on e.oid = d.refobjid
    where p.pronamespace = 'public'::regnamespace and has_function_privilege('public', p.oid, 'execute') group by e.extname loop
    raise warning 'extension functions in public are callable by PUBLIC: % (move the extension to the extensions schema in a migration)', t;
  end loop;
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
SQL
