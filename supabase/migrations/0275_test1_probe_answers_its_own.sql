-- Alo King Chouf, session TEST1, migration 0275: the staging probe answers only its own parties. docs/DECISIONS.md, "TEST1", row 21.
--
-- The probe (FIX2's probe_pending, 0266) answers every message sent to any probe party in the last hour, as a person would. TEST1's
-- scripted customers are probe parties too (so nothing reaches a phone), and the third journeys run (45141804232) showed the probe tapping
-- their cards' Confirm and their "which one?" rows before the script did (AK-1106: confirmed by `wamid.PROBE…`). The probe's own parties
-- have no phone number (a WhatsApp user id only, prepare-staging.sql); the scripted customers carry an invented one. So the probe now
-- answers only probe parties with no phone number, the same line 0273 drew for the gate. 0266's text otherwise.
create or replace function probe_pending() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.dedupe_key, 'party_id', x.party_id, 'line', x.line, 'payload', x.payload,
           'wa_user_id', (select wa_user_id from party_identities i where i.party_id = x.party_id and i.line = x.line limit 1),
           'role', (select role from parties p where p.id = x.party_id)) order by x.created_at desc), '[]'::jsonb)
    from (select o.* from wa_outbox o join parties p on p.id = o.party_id
           where p.is_probe and o.status = 'sent' and o.created_at > now() - interval '1 hour'
             and not exists (select 1 from party_identities pi where pi.party_id = p.id and pi.phone_e164 is not null)) x
   where coalesce(setting('probe')->>'enabled', 'false') = 'true'
     and not exists (select 1 from probe_answers a where a.dedupe_key = x.dedupe_key) $$;

select pin_search_paths();
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
