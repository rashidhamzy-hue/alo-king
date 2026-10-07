-- Hardening after the PR #79 review: no backdated dated rows through the API, strict ledger idempotency
-- and precision, audited customer identity and consent.
begin;

-- Backdating.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000a');
select tests.throws($$insert into public.exchange_rates (rate, effective_from, source) values (95000, now() - interval '1 day', 'backdated')$$,
  'cannot start in the past', 'the admin cannot backdate an exchange rate');
select tests.throws($$insert into public.app_config (key, value, effective_from, note) values ('cod_cap_usd', '500', now() - interval '1 hour', 'x')$$,
  'cannot start in the past', 'the admin cannot backdate config');
insert into public.price_list (product, amount_usd, effective_from, note) values ('order_fee', 1.25, now() + interval '1 day', 'future price');
reset role;
select tests.ok(public.price_usd('order_fee', now() + interval '2 days') = 1.25, 'the admin can still schedule a future price');
select tests.ok(public.price_usd('order_fee') = 1.00, 'the current price is unchanged');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '', true);
select tests.throws($$insert into public.vat_rates (rate, effective_from, note) values (0.12, now() - interval '1 day', 'x')$$,
  'cannot start in the past', 'the service role cannot backdate VAT either');
reset role;
select set_config('request.jwt.claims', '', true);

-- Ledger idempotency with different lines, and precision.
create temporary table acct as
select public.ledger_account('platform_whish', 'USD') as whish,
       public.ledger_account('merchant_credit', 'USD', '20000000-0000-0000-0000-00000000000a') as credit_a;
select public.ledger_post('credit_topup', 'test:hardening:topup',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 10),
                    jsonb_build_object('account_id', (select credit_a from acct), 'amount', -10)));
select tests.ok(public.ledger_post('credit_topup', 'test:hardening:topup',
  jsonb_build_array(jsonb_build_object('account_id', (select credit_a from acct), 'amount', '-10.00'),
                    jsonb_build_object('account_id', (select whish from acct), 'amount', 10)))
  = (select id from public.ledger_transactions where idempotency_key = 'test:hardening:topup'),
  'the same lines in another order and format are the same request');
select tests.throws($$select public.ledger_post('credit_topup', 'test:hardening:topup',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 100),
                    jsonb_build_object('account_id', (select credit_a from acct), 'amount', -100)))$$,
  'different lines', 'a reused key with different amounts is rejected');
select tests.throws($$select public.ledger_post('credit_topup', 'test:hardening:precision',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 0.00001),
                    jsonb_build_object('account_id', (select credit_a from acct), 'amount', -0.00001)))$$,
  'at most 4 decimals', 'amounts with more than 4 decimals are rejected');

-- Customer identity and consent are audited; ordinary activity is not.
select tests.act_as('00000000-0000-0000-0000-00000000000a');
update public.customers set marketing_opt_in = true, marketing_opt_in_at = now() where id = '10000000-0000-0000-0000-000000000001';
update public.customers set last_inbound_at = now() where id = '10000000-0000-0000-0000-000000000001';
select tests.ok((select count(*) from public.audit_log
  where table_name = 'customers' and action = 'update' and row_id = '10000000-0000-0000-0000-000000000001') = 1,
  'a consent change is audited once; a last_inbound_at update is not');

-- The public lookups still work for anonymous callers as invokers.
set local role anon;
select tests.act_as(null);
select tests.ok(public.delivery_fee_usd(4) = 3.00 and public.usd_lbp_rate() > 0 and public.price_usd('order_fee') = 1.00
  and public.vat_rate() = 0.11 and public.max_delivery_km() = 10, 'public lookups work for anon as security invoker');
reset role;
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
), 'no security-definer function in public is executable by anon or authenticated');

rollback;
