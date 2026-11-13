-- Evidence for one order, read-only. Run on STAGING after the WhatsApp demo order (build plan task 0.13), normally through
-- the `staging-evidence` workflow, which picks the order and saves this output under docs/evidence/:
--   psql "$STAGING_DATABASE_URL" -v code="'AK-1001'" -f scripts/staging_evidence.sql > docs/evidence/order_AK-1001.txt
-- It answers four questions: did the order walk only allowed states, did stock leave the store by exactly what was sold,
-- do the books balance, and was every message sent exactly once. Section 9 is the conversation, in place of screenshots.
-- No phone number, user id or address is printed.
-- Corrected 13 Nov (session A2): a same-state row is a note (a late tap, the learning job), not a move; stock is checked on the
-- pick (a reservation and its pick net to zero in stock_movements by design, so the old check flagged every delivered order);
-- messages are counted for this order's conversation, not the last two hours of everything.
\pset pager off
\echo '== 1. order'
select short_code, status, subtotal_usd, delivery_fee_usd, tip_usd, total_usd, payment_method, created_at, confirmed_at, delivered_at
from orders where short_code = :code;

\echo '== 2. state trail (every move must be allowed; same-state rows are notes)'
select e.created_at, e.from_status, e.to_status, e.actor, e.reason,
       case when e.from_status is null then 'start'
            when e.from_status = e.to_status then 'note'
            when exists (select 1 from order_transitions t where t.from_status = e.from_status and t.to_status = e.to_status) then 'allowed'
            else 'NOT ALLOWED' end as verdict
from order_events e join orders o on o.id = e.order_id where o.short_code = :code order by e.created_at;
select count(*) as moves_not_allowed_must_be_zero from order_events e join orders o on o.id = e.order_id
 where o.short_code = :code and e.from_status is not null and e.from_status <> e.to_status
   and not exists (select 1 from order_transitions t where t.from_status = e.from_status and t.to_status = e.to_status);

\echo '== 3. stock: picked out of the store against sold (difference must be 0 on every line once the order is closed)'
select i.name_snapshot, i.qty as sold,
       coalesce((select sum(m.qty_delta) from stock_movements m where m.order_id = o.id and m.product_id = i.product_id and m.reason = 'pick'), 0) as picked,
       i.qty - coalesce((select sum(m.qty_delta) from stock_movements m where m.order_id = o.id and m.product_id = i.product_id and m.reason = 'pick'), 0) as difference
from order_items i join orders o on o.id = i.order_id where o.short_code = :code and i.status = 'ok';

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

\echo '== 7. messages for this order: one outbox row per message, none stuck, none duplicated'
select o2.line, o2.status, count(*) from wa_outbox o2
 where o2.party_id in (select customer_id from orders where short_code = :code
                       union select d.driver_id from deliveries d join delivery_stops s on s.delivery_id = d.id join orders o on o.id = s.order_id where o.short_code = :code)
   and o2.created_at between (select created_at - interval '1 hour' from orders where short_code = :code) and (select coalesce(delivered_at, now()) + interval '1 hour' from orders where short_code = :code)
 group by 1, 2 order by 1, 2;
select dedupe_key, count(*) as duplicated from wa_outbox group by dedupe_key having count(*) > 1;

\echo '== 8. marketing is off'
select value from settings where key = 'marketing';

\echo '== 9. the conversation (customer line), in place of screenshots'
select m.created_at, m.direction, m.type, m.status, left(regexp_replace(regexp_replace(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'), '\+?\d[\d ]{6,}\d', '[number]', 'g'), '[A-Z]{2}\.\d{10,}', '[user-id]', 'g'), 220) as text
from wa_messages m
where m.line = 'customer' and m.party_id = (select customer_id from orders where short_code = :code)
  and m.created_at between (select created_at - interval '1 hour' from orders where short_code = :code) and (select coalesce(delivered_at, now()) + interval '1 hour' from orders where short_code = :code)
order by m.created_at;

\echo '== 10. the rider side (ops line; a probe rider on staging, its messages never leave the building)'
select m.created_at, m.direction, m.type, m.status, left(regexp_replace(regexp_replace(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'), '\+?\d[\d ]{6,}\d', '[number]', 'g'), '[A-Z]{2}\.\d{10,}', '[user-id]', 'g'), 160) as text
from wa_messages m
where m.line = 'ops' and m.party_id in (select d.driver_id from deliveries d join delivery_stops s on s.delivery_id = d.id join orders o on o.id = s.order_id where o.short_code = :code)
  and m.created_at between (select created_at from orders where short_code = :code) and (select coalesce(delivered_at, now()) + interval '30 minutes' from orders where short_code = :code)
order by m.created_at;
