-- Alo King Chouf, session TEST1, migration 0273 (after the stage stop): the WhatsApp catalogue's id, and the probe's exemption from the
-- friends' test gate narrowed to the probe itself. docs/DECISIONS.md, "TEST1, 23 November 2026", rows 16 and 17.
--
-- 1. The catalogue the founder made in Commerce Manager on 23 November ("Alo King Chouf (staging)", fed hourly by GET /catalog/feed.csv)
--    and connected to the staging customer line in WhatsApp Manager, with the catalogue icon and the cart on. The Concierge's catalogue
--    messages name it, and a cart from any other catalogue is refused (plan_cart, 0226). STAGING ONLY (a database marked as staging,
--    0271): production connects its own catalogue to the +961 line.
update settings set value = coalesce(value, '{}'::jsonb) || '{"catalog_id": "1178584524839853"}'::jsonb
 where key = 'catalog' and db_is_staging();

-- 2. 0271 let every probe party through the gate. The hourly probe's customer has no phone number (a WhatsApp user id only); the
--    scripted customers TEST1 uses to prove the journeys on staging are probe parties too (so nothing is ever sent to a real phone) but
--    carry an invented phone number, so the gate treats them as anyone else: a tester by the list, a stranger refused.
create or replace function test_mode_gate(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('on', test_mode_on(),
           'tester', coalesce(is_tester(p_party), false),
           'allowed', not test_mode_on() or coalesce(is_tester(p_party), false)
                      or (coalesce((select is_probe from parties where id = p_party), false)
                          and not exists (select 1 from party_identities pi where pi.party_id = p_party and pi.phone_e164 is not null))) $$;

select pin_search_paths();
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
