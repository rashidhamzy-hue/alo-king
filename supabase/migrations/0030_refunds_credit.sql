-- Alo King Chouf, session C2, build plan 2.3: refunds and complaints after delivery.
-- Every refund is two facts, each with its own ledger transaction:
--   1. What we give back, and whose money it was. The refund reverses the revenue it came from (goods, the delivery fee while
--      it is still ours, the small-order fee) or, for compensation, is a company cost (refund_expense). The customer's side is a
--      liability: customer_credit:<party>, money we owe them.
--   2. How the customer gets it: kept as credit and taken off a later order (apply_customer_credit), or paid out in cash from
--      the hub till, or by Whish or OMT with the transfer reference (pay_out_credit).
-- Caps come from the ledger itself: a refund charged to goods can never exceed the goods revenue still booked for that order,
-- and the delivery fee can be refunded only while it is still ours. Once an order closes the fee belongs to the rider
-- (invariant 10, 0009); compensating a customer after that is a company cost, never taken from the rider.
-- The pick flow (2.1, 2.2) uses the same credit when a prepaid order comes up short at the shelf.

alter type account_kind add value if not exists 'customer_credit';
alter type account_kind add value if not exists 'refund_expense';

create table refunds (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id),
  customer_id   uuid not null references parties(id),
  amount_usd    numeric(10,2) not null check (amount_usd > 0),
  charged_to    text not null check (charged_to in ('goods', 'delivery_fee', 'small_order_fee', 'goodwill')),
  reason        text not null check (reason in ('missing_item', 'damaged', 'wrong_item', 'late', 'missing_at_pick', 'substitute_cheaper',
                                                 'order_cancelled', 'other')),
  note          text,
  order_item_id uuid references order_items(id),
  settle        text not null check (settle in ('credit', 'cash', 'whish', 'omt')),
  payout_id     uuid,
  ledger_txn    uuid not null,
  by_party      uuid references parties(id),            -- null: recorded by the system (a shortage found at the shelf)
  request_key   text unique,
  created_at    timestamptz not null default now()
);
create index refunds_order on refunds(order_id);
create index refunds_customer on refunds(customer_id, created_at);

create table credit_payouts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references parties(id),
  amount_usd   numeric(10,2) not null check (amount_usd > 0),
  method       text not null check (method in ('cash', 'whish', 'omt')),
  external_ref text,
  ledger_txn   uuid not null,
  by_party     uuid not null references parties(id),
  request_key  text unique,
  created_at   timestamptz not null default now()
);
create unique index credit_payouts_ref_once on credit_payouts(method, external_ref) where external_ref is not null;

-- Credit taken off an order. The order's total drops at once (dues_usd, which every payment path already settles);
-- the credit itself is consumed when the order's payment is recorded, so a cancelled order gives it back untouched.
create table credit_applications (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id),
  customer_id uuid not null references parties(id),
  amount_usd  numeric(10,2) not null check (amount_usd > 0),
  status      text not null default 'applied' check (status in ('applied', 'consumed')),
  applied_by  uuid references parties(id),
  ledger_txn  uuid,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);
create unique index credit_applications_one_per_order on credit_applications(order_id);

create or replace function customer_credit_account(p_party uuid) returns uuid language plpgsql as
$$ begin return ensure_account('customer_credit:' || p_party, 'customer_credit'::account_kind, p_party); end $$;

-- What we owe the customer on the books, and what of it is free to use (not already taken off an open order).
create or replace function customer_credit_balance_usd(p_party uuid) returns numeric language sql stable as
$$ select coalesce(-sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.code = 'customer_credit:' || p_party $$;

create or replace function customer_credit_usd(p_party uuid) returns numeric language sql stable as $$
  select customer_credit_balance_usd(p_party) - coalesce((select sum(c.amount_usd) from credit_applications c join orders o on o.id = c.order_id
                                                          where c.customer_id = p_party and c.status = 'applied' and o.status <> 'cancelled'), 0) $$;

-- Revenue still booked for one order on one account (positive = ours). The cap for a refund charged to that account.
create or replace function order_revenue_usd(p_order uuid, p_code text) returns numeric language sql stable as
$$ select coalesce(-sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where e.order_id = p_order and a.code = p_code $$;

-- The first half of every refund: reverse the revenue (or book the cost) and owe the customer. Internal: refund_order() is the
-- staff entry point; the pick flow calls this with p_by null. Idempotent on p_key.
create or replace function grant_customer_credit(p_order uuid, p_amount numeric, p_charged_to text, p_reason text, p_by uuid,
                                                 p_note text default null, p_item uuid default null, p_key text default null)
returns uuid language plpgsql as $$
declare o orders%rowtype; v_id uuid; v_txn uuid := gen_random_uuid(); v_amt numeric := round(p_amount, 2); v_code text; v_kind account_kind;
        v_paid numeric; v_refunded numeric; v_cap numeric;
begin
  if p_key is not null then
    select id into v_id from refunds where request_key = p_key;
    if v_id is not null then return v_id; end if;
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  select coalesce(sum(amount_usd), 0) into v_paid from payments where order_id = p_order and status = 'confirmed';
  if v_paid <= 0 then raise exception 'ORDER_NOT_PAID (an unpaid order is corrected, not refunded)'; end if;
  select coalesce(sum(amount_usd), 0) into v_refunded from refunds where order_id = p_order;
  if v_refunded + v_amt > v_paid + 0.005 then raise exception 'REFUND_EXCEEDS_PAID paid % refunded % asked %', v_paid, v_refunded, v_amt; end if;

  v_code := case p_charged_to when 'goods' then 'revenue_goods' when 'delivery_fee' then 'revenue_delivery'
                              when 'small_order_fee' then 'revenue_small_order' when 'goodwill' then 'refund_expense' end;
  if v_code is null then raise exception 'UNKNOWN_CHARGE %', p_charged_to; end if;
  if p_charged_to <> 'goodwill' then
    v_cap := order_revenue_usd(p_order, v_code);
    if v_amt > v_cap + 0.005 then
      -- The delivery fee belongs to the rider once the order closes (0009): it is never taken back from them.
      raise exception 'REFUND_EXCEEDS_REVENUE % still booked for this order on %: %', v_code, v_cap, case when p_charged_to = 'delivery_fee'
        then 'the fee belongs to the rider; charge compensation to goodwill' else 'nothing more to refund' end;
    end if;
  end if;
  v_kind := v_code::account_kind;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account(v_code, v_kind), v_amt, 'USD', v_amt, p_order, 'Refund (' || p_reason || ')'),
    (v_txn, customer_credit_account(o.customer_id), -v_amt, 'USD', -v_amt, p_order, 'Refund owed to customer (' || p_reason || ')');
  insert into refunds(order_id, customer_id, amount_usd, charged_to, reason, note, order_item_id, settle, ledger_txn, by_party, request_key)
    values (p_order, o.customer_id, v_amt, p_charged_to, p_reason, nullif(btrim(p_note), ''), p_item, 'credit', v_txn, p_by, p_key)
    returning id into v_id;
  return v_id;
end $$;

-- The second half when the customer wants the money now: cash from the hub till, or a Whish or OMT transfer with its reference.
create or replace function pay_out_credit(p_party uuid, p_amount numeric, p_method text, p_by uuid, p_ref text default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_id uuid; v_txn uuid := gen_random_uuid(); v_amt numeric := round(p_amount, 2); v_free numeric; v_code text;
begin
  if p_key is not null then
    select id into v_id from credit_payouts where request_key = p_key;
    if v_id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'payout_id', v_id); end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_method not in ('cash', 'whish', 'omt') then raise exception 'UNKNOWN_METHOD %', p_method; end if;
  if p_method <> 'cash' and (p_ref is null or length(btrim(p_ref)) < 4) then raise exception 'REFERENCE_REQUIRED'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  perform 1 from parties where id = p_party for update;              -- one payout at a time per customer
  v_free := customer_credit_usd(p_party);
  if v_amt > v_free + 0.005 then raise exception 'EXCEEDS_CREDIT available %', v_free; end if;
  v_code := case p_method when 'cash' then 'hub_cash' when 'whish' then 'whish_clearing' else 'omt_clearing' end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, customer_credit_account(p_party), v_amt, 'USD', v_amt, 'Refund paid out (' || p_method || ')'),
    (v_txn, ensure_account(v_code, v_code::account_kind), -v_amt, 'USD', -v_amt, 'Refund paid out' || coalesce(' ' || btrim(p_ref), ''));
  insert into credit_payouts(customer_id, amount_usd, method, external_ref, ledger_txn, by_party, request_key)
    values (p_party, v_amt, p_method, nullif(btrim(p_ref), ''), v_txn, p_by, p_key) returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'payout_id', v_id, 'credit_left_usd', customer_credit_usd(p_party));
end $$;

-- The staff entry point (console 3.6, the ops lead): a complaint after delivery, settled as credit or paid out at once.
create or replace function refund_order(p_order uuid, p_by uuid, p_amount_usd numeric, p_charged_to text, p_reason text,
                                        p_settle text default 'credit', p_ref text default null, p_note text default null,
                                        p_item uuid default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_refund uuid; v_payout jsonb; r refunds%rowtype; v_customer uuid;
begin
  if p_key is not null then
    select * into r from refunds where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'refund_id', r.id, 'settle', r.settle); end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_settle not in ('credit', 'cash', 'whish', 'omt') then raise exception 'UNKNOWN_SETTLE %', p_settle; end if;
  if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  if p_item is not null and not exists (select 1 from order_items where id = p_item and order_id = p_order) then raise exception 'ITEM_NOT_ON_ORDER'; end if;
  v_refund := grant_customer_credit(p_order, p_amount_usd, p_charged_to, p_reason, p_by, p_note, p_item, p_key);
  if p_settle <> 'credit' then
    select customer_id into v_customer from orders where id = p_order;
    v_payout := pay_out_credit(v_customer, p_amount_usd, p_settle, p_by, p_ref, case when p_key is null then null else p_key || ':payout' end);
    update refunds set settle = p_settle, payout_id = (v_payout->>'payout_id')::uuid where id = v_refund;
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'refund_id', v_refund, 'settle', p_settle,
                            'credit_left_usd', customer_credit_usd((select customer_id from orders where id = p_order)));
end $$;

-- Take free credit off an unpaid order: the total drops at once (what the card, the rider and the transfer all read).
-- Called by the code that builds the card, or by the console. One application per order; a second call changes nothing.
create or replace function apply_customer_credit(p_order uuid, p_by uuid default null) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_free numeric; v_amt numeric;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if exists (select 1 from credit_applications where order_id = p_order) then
    return jsonb_build_object('applied_usd', (select amount_usd from credit_applications where order_id = p_order), 'total_usd', o.total_usd, 'already', true);
  end if;
  if o.status in ('closed', 'cancelled', 'returned', 'failed_delivery')
     or exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    return jsonb_build_object('applied_usd', 0, 'total_usd', o.total_usd, 'reason', 'order_settled');
  end if;
  perform 1 from parties where id = o.customer_id for update;
  v_free := customer_credit_usd(o.customer_id);
  v_amt := round(least(v_free, o.total_usd), 2);
  if v_amt <= 0 then return jsonb_build_object('applied_usd', 0, 'total_usd', o.total_usd); end if;
  update orders set dues_usd = dues_usd - v_amt where id = p_order;
  insert into credit_applications(order_id, customer_id, amount_usd, applied_by) values (p_order, o.customer_id, v_amt, p_by);
  return jsonb_build_object('applied_usd', v_amt, 'total_usd', o.total_usd - v_amt);
end $$;

-- When the order's money is recorded (cash at the door, or a transfer confirmed), the credit is used up. The payment functions
-- post "dues settled" against customer_receivable for the lowered dues; this moves the same amount from what we owed.
create or replace function consume_credit_on_payment() returns trigger language plpgsql as $$
declare c credit_applications%rowtype; v_txn uuid := gen_random_uuid();
begin
  if new.status <> 'confirmed' then return new; end if;
  select * into c from credit_applications where order_id = new.order_id and status = 'applied' for update;
  if not found then return new; end if;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, customer_credit_account(c.customer_id), c.amount_usd, 'USD', c.amount_usd, c.order_id, 'Credit used on this order'),
    (v_txn, ensure_account('customer_receivable:' || c.customer_id, 'customer_receivable'::account_kind, c.customer_id),
     -c.amount_usd, 'USD', -c.amount_usd, c.order_id, 'Credit used on this order');
  update credit_applications set status = 'consumed', consumed_at = now(), ledger_txn = v_txn where id = c.id;
  return new;
end $$;
create trigger payments_consume_credit after insert or update of status on payments
  for each row execute function consume_credit_on_payment();

-- For the console (3.6) and the customer's own question: what we owe them and why.
create or replace function customer_credit_view(p_party uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('balance_usd', customer_credit_balance_usd(p_party), 'available_usd', customer_credit_usd(p_party),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'order', o.short_code, 'amount_usd', r.amount_usd, 'reason', r.reason,
                         'charged_to', r.charged_to, 'settle', r.settle, 'at', r.created_at) order by r.created_at desc)
                         from refunds r join orders o on o.id = r.order_id where r.customer_id = p_party), '[]'::jsonb)) $$;

do $$ declare t text; r text;
begin
  foreach t in array array['refunds', 'credit_payouts', 'credit_applications'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
