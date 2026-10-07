-- Ledger: balanced posting, idempotency, locked rates, append-only, reversals, balances, access.
begin;

create temporary table acct as
select
  public.ledger_account('platform_whish', 'USD') as whish,
  public.ledger_account('merchant_payable', 'USD', '20000000-0000-0000-0000-00000000000a') as payable_a,
  public.ledger_account('merchant_credit', 'USD', '20000000-0000-0000-0000-00000000000a') as credit_a,
  public.ledger_account('merchant_credit', 'USD', '20000000-0000-0000-0000-00000000000b') as credit_b,
  public.ledger_account('revenue_order_fee', 'USD') as fee_rev,
  public.ledger_account('platform_whish', 'LBP') as whish_lbp;
grant select on acct to authenticated;

select tests.ok((select whish from acct) = public.ledger_account('platform_whish', 'USD'), 'ledger_account is get-or-create');
select tests.throws($$select public.ledger_account('merchant_payable', 'USD')$$, 'ledger_accounts_vendor_kinds',
  'merchant accounts need a vendor');
select tests.throws($$select public.ledger_account('platform_whish', 'USD', '20000000-0000-0000-0000-00000000000a')$$,
  'ledger_accounts_vendor_kinds', 'platform accounts cannot belong to a vendor');

-- Before anything is posted (pending deferred checks would block TRUNCATE for another reason).
select tests.throws($$truncate public.ledger_entries, public.ledger_transactions, public.ledger_accounts cascade$$, 'append-only', 'the ledger cannot be truncated');

-- A customer pays $12.50 by Whish for an order at the locked rate 89,500.
select public.ledger_post(
  'customer_payment', 'test:payment:order-1',
  jsonb_build_array(
    jsonb_build_object('account_id', (select whish from acct), 'amount', 12.50),
    jsonb_build_object('account_id', (select payable_a from acct), 'amount', -12.50)
  ),
  '30000000-0000-0000-0000-000000000001', 89500
) as tx \gset
select tests.ok(tests.count_of($$select id from public.ledger_entries$$) = 2, 'a payment writes two entries');
select tests.ok((select amount_lbp from public.ledger_entries where amount > 0) = 1118750, 'LBP value uses the locked rate ($12.50 = 1,118,750 LBP)');
select tests.ok((select balance from public.ledger_account_balances where account_id = (select payable_a from acct)) = 12.50,
  'the merchant is owed $12.50');
select tests.ok((select balance from public.ledger_account_balances where account_id = (select whish from acct)) = 12.50,
  'Alo King Whish holds $12.50');

-- Idempotency.
select tests.ok(public.ledger_post(
  'customer_payment', 'test:payment:order-1',
  jsonb_build_array(
    jsonb_build_object('account_id', (select whish from acct), 'amount', 12.50),
    jsonb_build_object('account_id', (select payable_a from acct), 'amount', -12.50)
  )
) = :'tx', 'a repeated idempotency key returns the first transaction');
select tests.ok(tests.count_of($$select id from public.ledger_entries$$) = 2, 'a repeated key writes nothing');
select tests.throws($$select public.ledger_post('refund', 'test:payment:order-1',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 1),
                    jsonb_build_object('account_id', (select payable_a from acct), 'amount', -1)))$$,
  'already used', 'a key reused for another kind is rejected');

-- Balance rules.
select tests.throws($$select public.ledger_post('order_fee', 'test:unbalanced',
  jsonb_build_array(jsonb_build_object('account_id', (select payable_a from acct), 'amount', 1),
                    jsonb_build_object('account_id', (select fee_rev from acct), 'amount', -0.99)))$$,
  'do not balance', 'an unbalanced transaction is rejected');
select tests.throws($$select public.ledger_post('order_fee', 'test:mixed-currency',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 1),
                    jsonb_build_object('account_id', (select whish_lbp from acct), 'amount', -1)))$$,
  'do not balance', 'currencies balance separately');
select tests.throws($$select public.ledger_post('order_fee', 'test:one-line',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 0)))$$,
  'at least two lines', 'a single line is rejected');
select tests.throws($$select public.ledger_post('admin_adjustment', 'test:no-reason',
  jsonb_build_array(jsonb_build_object('account_id', (select credit_a from acct), 'amount', -5),
                    jsonb_build_object('account_id', (select fee_rev from acct), 'amount', 5)))$$,
  'reason_required', 'an admin adjustment needs a reason');
-- The balance check is deferred to commit; tests roll back, so run it immediately here.
set constraints all immediate;
select tests.throws($$insert into public.ledger_entries (transaction_id, account_id, currency, amount, usd_lbp_rate)
  select id, (select whish from acct), 'USD', 1, 89500 from public.ledger_transactions limit 1$$,
  'does not balance', 'a direct extra entry cannot slip past the balance check');
set constraints all deferred;

-- The order fee nets from the merchant's payable.
select public.ledger_post('order_fee', 'test:order-fee:order-1',
  jsonb_build_array(jsonb_build_object('account_id', (select payable_a from acct), 'amount', 1.00),
                    jsonb_build_object('account_id', (select fee_rev from acct), 'amount', -1.00)),
  '30000000-0000-0000-0000-000000000001', 89500);
select tests.ok((select balance from public.ledger_account_balances where account_id = (select payable_a from acct)) = 11.50,
  'after the $1 fee the merchant is owed $11.50');

-- Credit top-up for both merchants.
select public.ledger_post('credit_topup', 'test:topup:a',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 20),
                    jsonb_build_object('account_id', (select credit_a from acct), 'amount', -20)));
select public.ledger_post('credit_topup', 'test:topup:b',
  jsonb_build_array(jsonb_build_object('account_id', (select whish from acct), 'amount', 10),
                    jsonb_build_object('account_id', (select credit_b from acct), 'amount', -10)));
select tests.ok((select available from public.merchant_credit_balances where vendor_id = '20000000-0000-0000-0000-00000000000a') = 20,
  'merchant A has $20 of credit');
select tests.ok((select usd_lbp_rate from public.ledger_transactions where idempotency_key = 'test:topup:a') = 89500,
  'without a locked rate the rate in force is recorded');

-- Append-only, even for the table owner.
select tests.throws($$update public.ledger_entries set amount = 0$$, 'append-only', 'entries cannot be edited');
select tests.throws($$delete from public.ledger_entries$$, 'append-only', 'entries cannot be deleted');
select tests.throws($$update public.ledger_transactions set reason = 'x'$$, 'append-only', 'transactions cannot be edited');

-- Reversal: once, at the original rate.
select public.ledger_reverse((select id from public.ledger_transactions where idempotency_key = 'test:topup:a'),
  'test:reverse:topup-a', 'test reversal') as rev \gset
select tests.ok((select available from public.merchant_credit_balances where vendor_id = '20000000-0000-0000-0000-00000000000a') = 0,
  'the reversal brings credit back to zero');
select tests.ok((select usd_lbp_rate from public.ledger_transactions where id = :'rev') = 89500, 'the reversal uses the original rate');
select tests.throws($$select public.ledger_reverse((select id from public.ledger_transactions where idempotency_key = 'test:topup:a'),
  'test:reverse:topup-a-again', 'again')$$, 'reverses_id', 'a transaction is reversed at most once');
select tests.throws(format($$select public.ledger_reverse(%L, 'test:reverse:reversal', 'nope')$$, :'rev'),
  'cannot be reversed', 'a reversal cannot be reversed');

-- Access ------------------------------------------------------------------------------------------------
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000e');
select tests.throws($$select public.ledger_post('credit_topup', 'test:client-post',
  jsonb_build_array(jsonb_build_object('account_id', gen_random_uuid(), 'amount', 1)))$$,
  'permission denied', 'clients cannot post to the ledger');
select tests.throws($$select public.ledger_account('platform_whish', 'USD')$$, 'permission denied', 'clients cannot create accounts');
select tests.throws($$insert into public.ledger_transactions (kind, idempotency_key, usd_lbp_rate, actor_kind) values ('credit_topup', 'test:direct', 1, 'user')$$,
  'permission denied', 'clients cannot insert transactions');
select tests.ok(tests.count_of('select account_id from public.ledger_account_balances') = 2, 'owner of A sees only A accounts (payable and credit)');
select tests.ok(tests.count_of('select vendor_id from public.merchant_credit_balances') = 1, 'owner of A sees only A credit');
select tests.ok(tests.count_of($$select id from public.ledger_transactions where idempotency_key = 'test:topup:b'$$) = 0,
  'owner of A cannot see B transactions');
select tests.ok(tests.count_of($$select id from public.ledger_entries$$) > 0, 'owner of A reads its entries');
select tests.ok(tests.count_of($$select e.id from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.vendor_id is distinct from '20000000-0000-0000-0000-00000000000a'$$) = 0,
  'owner of A reads no platform or other-vendor entries');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000f');
select tests.ok(tests.count_of('select account_id from public.ledger_account_balances') = 0, 'cashier sees no money');
select tests.ok(tests.count_of('select id from public.ledger_entries') = 0, 'cashier sees no entries');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000c');
select tests.ok(tests.count_of('select id from public.ledger_transactions') = 0, 'customers see no ledger');
reset role;

set local role anon;
select tests.act_as(null);
select tests.throws('select * from public.ledger_entries', 'permission denied', 'anon cannot read the ledger');
select tests.throws('select * from public.merchant_credit_balances', 'permission denied', 'anon cannot read balances');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.count_of('select account_id from public.ledger_account_balances') = 6, 'operators see every account');
reset role;

rollback;
