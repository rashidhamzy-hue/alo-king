-- STAGING ONLY. Run by deploy-staging after the seeds (scripts/ci/load-seeds.sh). Idempotent: safe on every deploy.
-- Never run on production. Nothing here is a business decision: it is demo data so a real phone can place a test order
-- (build plan 0.13) and the hourly probe can run (4.10).
--   * exchange rate: one row if there is none (89,500 LBP per USD, the rate used in every test). The daily rate owner replaces it.
--   * the hub: the dark store's village is set to Baakline if it is unset. The real hub is undecided (HANDOFF, rule 3);
--     staging needs one somewhere so dispatch can work. Data, not code: change it in the database.
--   * stock: 5,000 of every product, only if the whole store is empty. Staging has no real count.
--   * the probe: a test customer and a test rider (is_probe), their identities, a pinned address, the rider on shift.
--     Messages to them never reach WhatsApp (can_send answers probe_sink). PROBE_MODE=on in the staging Worker turns the cron's probe on.
\set ON_ERROR_STOP on
insert into fx_rates(lbp_per_usd) select 89500 where not exists (select 1 from fx_rates);

update sources set village_id = (select id from villages where name_en = 'Baakline')
 where kind = 'dark_store' and village_id is null;

update stock_levels set on_hand = 5000 where (select coalesce(sum(on_hand), 0) from stock_levels) = 0;

do $$
declare
  v_village uuid := (select id from villages where name_en = 'Baakline');
  c uuid; r uuid;
  lat constant double precision := 33.6789; lng constant double precision := 35.5778;   -- Baakline, approximately
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
  -- test rider
  select party_id into r from party_identities where line = 'ops' and wa_user_id = 'PR.0000000000000002';
  if r is null then
    insert into parties(role, display_name, is_probe) values ('driver', 'Probe rider', true) returning id into r;
    insert into party_identities(party_id, line, wa_user_id) values (r, 'ops', 'PR.0000000000000002');
  end if;
  perform start_shift(r);                                     -- keeps an open shift open; opens one otherwise
  perform record_driver_position(r, lat::numeric, lng::numeric, 'probe_setup');
  update settings set value = value || jsonb_build_object('enabled', true, 'pin', jsonb_build_object('lat', lat, 'lng', lng)) where key = 'probe';
end $$;

select 'staging prepared: fx ' || (select count(*) from fx_rates) || ', hub ' || coalesce((select v.name_en from sources s join villages v on v.id = s.village_id where s.kind = 'dark_store'), 'none')
    || ', stocked products ' || (select count(*) from stock_levels where on_hand > 0)
    || ', probe parties ' || (select count(*) from parties where is_probe)
    || ', probe enabled ' || (select value->>'enabled' from settings where key = 'probe');
