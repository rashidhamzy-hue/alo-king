-- Evidence for one order, read-only. Run on STAGING after the WhatsApp demo order (build plan task 0.13):
--   psql "$STAGING_DATABASE_URL" -v code="'A1B2'" -f scripts/staging_evidence.sql > docs/evidence/order_A1B2.txt
-- It answers four questions: did the order walk only allowed states, did stock move by exactly what was sold,
-- do the books balance, and was every message sent exactly once.
\pset pager off
\echo '== 1. order'
select short_code, status, subtotal_usd, delivery_fee_usd, tip_usd, total_usd, payment_method, created_at, confirmed_at, delivered_at
from orders where short_code = :code;

\echo '== 2. state trail (every row must be an allowed transition)'
select e.created_at, e.from_status, e.to_status, e.actor, e.reason,
       exists (select 1 from order_transitions t where t.from_status = e.from_status and t.to_status = e.to_status) as allowed
from order_events e join orders o on o.id = e.order_id where o.short_code = :code order by e.created_at;

\echo '== 3. stock: sold against moved (difference must be 0 on every line once the order is closed)'
select i.name_snapshot, i.qty as sold,
       coalesce(-(select sum(m.qty_delta) from stock_movements m where m.order_id = o.id and m.product_id = i.product_id), 0) as left_stock,
       i.qty - coalesce(-(select sum(m.qty_delta) from stock_movements m where m.order_id = o.id and m.product_id = i.product_id), 0) as difference
from order_items i join orders o on o.id = i.order_id where o.short_code = :code and i.status is distinct from 'removed';

\echo '== 4. payment'
select p.method, p.status, p.amount_usd, p.received_usd, p.received_lbp, p.change_usd, p.change_lbp, p.confirmed_at
from payments p join orders o on o.id = p.order_id where o.short_code = :code;

\echo '== 5. ledger for this order (each transaction must sum to 0 in USD equivalent)'
select l.txn_id, a.code as account, l.amount, l.currency, l.usd_equiv, l.memo
from ledger_entries l join ledger_accounts a on a.id = l.account_id join orders o on o.id = l.order_id
where o.short_code = :code order by l.created_at, l.txn_id;
select l.txn_id, round(sum(l.usd_equiv), 4) as txn_sum_must_be_zero
from ledger_entries l join orders o on o.id = l.order_id where o.short_code = :code group by l.txn_id;

\echo '== 6. whole ledger (must be 0)'
select round(coalesce(sum(usd_equiv), 0), 4) as ledger_total_must_be_zero from ledger_entries;

\echo '== 7. messages: one outbox row per message, none stuck, none duplicated'
select status, count(*) from wa_outbox where created_at > now() - interval '2 hours' group by status;
select dedupe_key, count(*) from wa_outbox group by dedupe_key having count(*) > 1;

\echo '== 8. marketing is off'
select value from settings where key = 'marketing';
