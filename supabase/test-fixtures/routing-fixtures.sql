-- Staging only (DECISIONS §39.15.1): every road route OpenRouteService has given us becomes a recorded fixture, so the
-- simulator numbers (+999, config routing_provider_sim = fixture) never spend the ORS quota. Run by the staging deploy
-- after the demo shops; idempotent (a recorded pair is never overwritten). The production cut-over (session 14) checks
-- that public.routing_fixtures is empty there.
do $$
begin
  raise notice 'routing fixtures: % new recorded routes', app_private.routing_fixtures_record();
end;
$$;
