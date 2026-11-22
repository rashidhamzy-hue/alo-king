-- 0270 (AUD1): row security on the eight tables that never had it, and no client grants on catalog_negation_stop.
-- Read on staging 22 November 2026: 199 public tables have RLS on; eight did not (market_settings, markets, eval_cases,
-- source_integrations, turns, wa_outbox, customer_memory, alias_candidates): migration 0001 switched RLS on for the tables that
-- existed then, and these were created later without it. None of them gives anon or authenticated any privilege (so no client could
-- reach them), but RLS is the second lock. The server roles (postgres, service_role) bypass RLS, so no worker or job changes.
-- catalog_negation_stop (0253) was made after the default privileges gave anon and authenticated everything; RLS with no policy
-- already reaches no row, so this only tidies the grant. Both statements are idempotent and reversible.
alter table if exists market_settings      enable row level security;
alter table if exists markets              enable row level security;
alter table if exists eval_cases           enable row level security;
alter table if exists source_integrations  enable row level security;
alter table if exists turns                enable row level security;
alter table if exists wa_outbox            enable row level security;
alter table if exists customer_memory      enable row level security;
alter table if exists alias_candidates     enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table catalog_negation_stop from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table catalog_negation_stop from authenticated; end if;
end $$;
