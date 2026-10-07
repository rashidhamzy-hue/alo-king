-- customers holds PII (phones, locations, consent flags, ad-click ids) and is only ever used by edge functions with the service role.
-- RLS is on with no policies already; also drop the table-level grants as defence in depth.
alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
