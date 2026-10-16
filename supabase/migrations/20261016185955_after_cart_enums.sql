-- Session 5f part 7 (CUSTOMER-EXPERIENCE #38, DECISIONS §20.3, §27.8 #18): a tip is a ledger entry. New enum values are
-- committed in their own migration before 20261016190000_after_cart.sql uses them (a value added in a transaction cannot be
-- used in that same transaction).
--   - ledger_tx_kind 'tip': the tip's transaction, through the order's payment path.
--   - ledger_account_kind 'tips_payable': what is owed to whoever delivered (a liability, credit-normal), one account per
--     deliverer (external_ref), netted when the tip is handed over.
alter type public.ledger_tx_kind add value if not exists 'tip';
alter type public.ledger_account_kind add value if not exists 'tips_payable';
--   - outbox_purpose 'tip': "The customer added a $2 tip on #CODE" to whoever delivered, with "✅ Got it" (the only tap
--     that books a cash tip).
alter type public.outbox_purpose add value if not exists 'tip';
