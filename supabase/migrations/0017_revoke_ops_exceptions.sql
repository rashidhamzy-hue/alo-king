-- Alo King Chouf: the finding from session A1's permission check (docs/HANDOFF.md, task 0.4).
-- ops_exceptions (0008) was created after 0007 revoked client grants, so on Supabase it kept the default table grants for
-- anon and authenticated. Row level security already blocked every row; this removes the grants themselves.
do $$ declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table ops_exceptions from %I', r); end if;
  end loop;
end $$;
