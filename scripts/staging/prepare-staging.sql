-- STAGING ONLY. Run by deploy-staging after the seeds (scripts/ci/load-seeds.sh). Idempotent: safe on every deploy.
-- Never run on production. Nothing here is a business decision: it is demo data so a real phone can place a test order
-- (build plan 0.13) and the hourly probe can run (4.10).
--   * exchange rate: one row if there is none (89,500 LBP per USD, the rate used in every test). The daily rate owner replaces it.
--   * the hub: the dark store's village is set to Baakline if it is unset. The real hub is undecided (HANDOFF, rule 3);
--     staging needs one somewhere so dispatch can work. Data, not code: change it in the database.
--   * stock: 5,000 of every product, only if the whole store is empty. Staging has no real count.
--   * the probe: a test customer, two test riders and a test ops lead (is_probe), their identities (not the ops lead's: it has none, so
--     nothing can be sent to it), a pinned address, the riders on shift. The ops lead only confirms the riders' cash drops
--     (probe_remit_cash, 0140): without that the riders' cash rose past the cap and the probe orders stopped at "confirmed" (15 Nov).
--     Messages to them never reach WhatsApp (can_send answers probe_sink). PROBE_MODE=on in the staging Worker turns the cron's probe on.
--   * FD2: the seeded test place, "Alo King test kitchen" (invented, testers only), through FD1's own functions (test-place.sql).
--   * TEST1 (0271): this database is marked as staging (deployment_marker), the only way test mode can ever be switched on. The first
--     time it is marked, test mode is switched on (the founder's decision of 23 November); after that the Settings page decides.
\set ON_ERROR_STOP on
insert into fx_rates(lbp_per_usd) select 89500 where not exists (select 1 from fx_rates);

update sources set village_id = (select id from villages where name_en = 'Baakline')
 where kind = 'dark_store' and village_id is null;

update stock_levels set on_hand = 5000 where (select coalesce(sum(on_hand), 0) from stock_levels) = 0;

do $$
declare
  v_village uuid := (select id from villages where name_en = 'Baakline');
  c uuid; r uuid; i int;
  lat constant double precision := 33.67739; lng constant double precision := 35.56355;  -- Baakline's centre (OpenStreetMap): since B4 the pin decides the village
begin
  -- test customer
  select party_id into c from party_identities where line = 'customer' and wa_user_id = 'PR.0000000000000001';
  if c is null then
    insert into parties(role, display_name, is_probe) values ('customer', 'Probe customer', true) returning id into c;
    insert into party_identities(party_id, line, wa_user_id) values (c, 'customer', 'PR.0000000000000001');
    perform save_customer_pin(c, lat, lng, v_village);
    perform set_contact_phone(c, '+96100000001');
    insert into consent_events(party_id, line, kind, action, source, wording)
      values (c, 'customer', 'transactional', 'opt_in', 'probe_setup', 'staging probe party');
  end if;
  -- two test riders: one can be busy with the hourly probe order while the other takes a real test order (0.13)
  for i in 2..3 loop
    select party_id into r from party_identities where line = 'ops' and wa_user_id = 'PR.000000000000000' || i;
    if r is null then
      insert into parties(role, display_name, is_probe) values ('driver', 'Probe rider ' || (i - 1), true) returning id into r;
      insert into party_identities(party_id, line, wa_user_id) values (r, 'ops', 'PR.000000000000000' || i);
    end if;
    perform start_shift(r);                                   -- keeps an open shift open; opens one otherwise
    perform record_driver_position(r, lat::numeric, lng::numeric, 'probe_setup');
  end loop;
  -- the probe's ops lead: confirms the probe riders' hub drops (0140). No identity, no login: it cannot be messaged, pushed or signed in as.
  if not exists (select 1 from parties where is_probe and role = 'ops_lead') then
    insert into parties(role, display_name, is_probe) values ('ops_lead', 'Probe ops lead', true);
  end if;
  -- The hourly order is the founder's 0.13 message, so the live model proves it every hour before he sends it. Brand-led on purpose:
  -- on 13 Nov the live model wrote «خبز» as "bread" (no match), and brand-led labneh and eggs resolved to laban and chicken legs (lane B, HANDOFF).
  update settings set value = value || jsonb_build_object('enabled', true, 'pin', jsonb_build_object('lat', lat, 'lng', lng),
    'order_text', 'بدي كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار، عبعقلين') where key = 'probe';
end $$;

-- TEST1: the staging mark, and test mode on the first time only (a later "off" on the Settings page stays off).
with marked as (insert into deployment_marker(environment) values ('staging') on conflict do nothing returning 1)
update settings set value = value || '{"enabled": true}'::jsonb where key = 'test_mode' and exists (select 1 from marked);

-- FD2: the seeded test place (an invented kitchen, testers only; scripts/staging/test-place.sql). Idempotent.
\ir test-place.sql

select 'staging prepared: fx ' || (select count(*) from fx_rates) || ', hub ' || coalesce((select v.name_en from sources s join villages v on v.id = s.village_id where s.kind = 'dark_store'), 'none')
    || ', stocked products ' || (select count(*) from stock_levels where on_hand > 0)
    || ', probe parties ' || (select count(*) from parties where is_probe)
    || ', probe enabled ' || (select value->>'enabled' from settings where key = 'probe')
    || ', test mode ' || case when test_mode_on() then 'on' else 'off' end
    || ', testers ' || jsonb_array_length(coalesce(setting('testers')->'numbers', '[]'::jsonb));
