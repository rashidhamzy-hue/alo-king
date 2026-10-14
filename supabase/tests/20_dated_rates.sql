-- Dated rates, VAT, fee bands, prices and config: lookups, append-only rules, admin-only writes.
begin;

select tests.ok(public.usd_lbp_rate() = 89500, 'USD/LBP rate in force is the seeded 89,500');
select tests.ok(public.vat_rate() = 0.11, 'VAT in force is 11%');
select tests.ok(public.delivery_fee_usd(0) = 2.00, '0 km costs $2.00');
select tests.ok(public.delivery_fee_usd(3) = 2.00, '3 km is still the first band');
select tests.ok(public.delivery_fee_usd(3.01) = 3.00, 'just over 3 km is $3.00');
select tests.ok(public.delivery_fee_usd(6) = 3.00, '6 km is $3.00');
select tests.ok(public.delivery_fee_usd(9.99) = 4.50, '9.99 km is $4.50');
select tests.ok(public.delivery_fee_usd(10) = 4.50, '10 km is $4.50');
select tests.ok(public.delivery_fee_usd(10.01) = 6.00, 'just over 10 km is $6.00 (§39.2, 15 October set)');
select tests.ok(public.delivery_fee_usd(20) = 6.00, '20 km is $6.00');
select tests.ok(public.delivery_fee_usd(20.01) is null, 'beyond 20 km there is no delivery');
select tests.ok(public.delivery_fee_usd(15, '2026-10-10') is null and public.delivery_fee_usd(10, '2026-10-10') = 4.50,
  'the 7 October set still answers for its own dates: 10 km was the limit');
select tests.ok((select count(*) = 3 from public.delivery_fee_bands where effective_from = '2026-10-07 00:00+03'),
  'the 7 October rows are untouched');
select tests.ok(public.delivery_fee_usd(-1) is null, 'a negative distance has no fee');
select tests.ok(public.max_delivery_km() = 20, 'max delivery distance comes from the bands');
select tests.ok(public.config_numeric('listing_radius_km') = 10, 'the listing radius has its own key, 10 km');
select tests.ok(public.price_usd('order_fee') = 1.00, 'order fee is $1.00');
select tests.ok(public.price_usd('send_home_fee') = 1.50, 'Send Home fee is $1.50');
select tests.ok(public.config_numeric('cod_cap_usd') = 150, 'COD cap is $150');
select tests.throws($$select public.config_numeric('no_such_key')$$, 'no numeric value', 'unknown config key raises');
select tests.throws($$select public.usd_lbp_rate('2020-01-01')$$, 'no USD/LBP rate', 'no rate before the first row raises');

-- A newer band set replaces the old one from its effective date; history still answers for the past.
insert into public.delivery_fee_bands (effective_from, max_km, fee_usd) values
  (now() + interval '1 day', 4, 2.50), (now() + interval '1 day', 8, 3.50);
select tests.ok(public.delivery_fee_usd(5) = 3.00, 'future band set is not yet in force');
select tests.ok(public.delivery_fee_usd(5, now() + interval '2 days') = 3.50, 'future band set applies from its date');
select tests.ok(public.delivery_fee_usd(9, now() + interval '2 days') is null, 'the new set ends at 8 km');
select tests.ok(public.max_delivery_km(now() + interval '2 days') = 8, 'max distance follows the band set in force');

-- Append-only rules.
select tests.throws($$update public.exchange_rates set rate = 1$$, 'never edited', 'rates in force cannot be edited');
select tests.throws($$delete from public.exchange_rates$$, 'already in force', 'rates in force cannot be deleted');
select tests.throws($$truncate public.app_config$$, 'append-only', 'config cannot be truncated');
delete from public.delivery_fee_bands where effective_from > now();
select tests.ok(public.max_delivery_km(now() + interval '2 days') = 20, 'a band set not yet in force can be withdrawn');

-- Who may read and write.
set local role anon;
select tests.act_as(null);
select tests.ok(public.delivery_fee_usd(2) = 2.00, 'anon can price a delivery');
select tests.ok(tests.count_of('select id from public.exchange_rates') >= 1, 'anon reads the exchange rate');
select tests.throws($$select public.config_value('cod_cap_usd')$$, 'permission denied', 'anon cannot call config_value');
select tests.throws($$insert into public.exchange_rates (rate, effective_from, source) values (1, now(), 'x')$$,
  'permission denied', 'anon cannot insert rates');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.throws($$insert into public.exchange_rates (rate, effective_from, source) values (90000, now() + interval '1 hour', 'x')$$,
  'row-level security', 'a non-admin operator cannot insert rates');
select tests.ok(tests.count_of('select id from public.app_config') > 0, 'operators read config');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000e');
select tests.ok(tests.count_of('select id from public.app_config') = 0, 'merchants do not read internal config');
select tests.ok(tests.count_of('select id from public.message_rates') = 0, 'merchants do not read message rates');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000a');
insert into public.exchange_rates (rate, effective_from, source) values (90000, now() - interval '1 second', 'test');
reset role;
select tests.ok(public.usd_lbp_rate() = 90000, 'the admin inserts a new rate and it is in force');
select tests.ok(public.usd_lbp_rate(now() - interval '1 day') = 89500, 'the old rate still answers for the past');
select tests.ok(exists (
  select 1 from public.audit_log where table_name = 'exchange_rates' and action = 'insert'
    and actor_id = '00000000-0000-0000-0000-00000000000a'
), 'the new rate is audited with the admin as actor');

rollback;
