#!/usr/bin/env bash
# Permission smoke test. Builds a database the way Supabase does (anon, authenticated and service_role get default
# grants on everything in public), applies every migration, then proves: the server role can call functions and
# read tables; the two client roles can do neither. Run it against a scratch Postgres, and again against a real
# Supabase branch before launch:  DATABASE_URL=postgres://... scripts/check_permissions.sh
set -euo pipefail
PSQL="psql ${DATABASE_URL:?set DATABASE_URL} -v ON_ERROR_STOP=1 -q -At"
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
$PSQL <<'SQL'
insert into fx_rates(lbp_per_usd) values (89500);
set role service_role;
select 'service_role can call a function: ' || (current_fx() > 0);
select 'service_role can read a table: ' || (count(*) >= 0) from settings;
select 'service_role can write through a function: ' || begin_turn('perm-check', 'customer');
reset role;
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
select 'functions still callable by PUBLIC: ' || count(*) from pg_proc p where pronamespace = 'public'::regnamespace and has_function_privilege('public', p.oid, 'execute');
SQL
