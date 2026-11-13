-- Alo King Chouf, session D2 (console): who may act, checked in SQL.
--
-- 1. D1's findings. confirm_cash_drop (0004) and resolve_ops_exception (0008) took any party id as the actor. Both now refuse
--    anyone who is not the ops lead or an admin (NOT_AUTHORISED), and resolve_ops_exception refuses a status it does not know.
--    The console already allowed only those roles; now the database does too, whatever calls it.
--    receive_rider_cash (0035) calls confirm_cash_drop with its own checked ops lead, so it is unchanged.
-- 2. Task 3.13: a second approval for a price change above settings.approvals.price_change_pct and for a refund above
--    settings.approvals.refund_usd. set_offer (0045) and refund_order (0030) check everything they checked before, then queue the
--    change in pending_approvals instead of making it; another ops lead or admin (never the one who asked) approves or rejects it
--    with decide_approval. Their old bodies are now set_offer_now and refund_order_now, unchanged, called only from here.

-- ---------- 1. confirm_cash_drop: 0004's text, with the role check first ----------
create or replace function confirm_cash_drop(p_drop uuid, p_by uuid) returns numeric language plpgsql as $$
declare d cash_drops%rowtype; n record; v_txn uuid := gen_random_uuid(); v_lbp_equiv numeric; v_to text; v_kind account_kind; v_cash uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into d from cash_drops where id = p_drop for update;
  if not found then raise exception 'DROP_NOT_FOUND'; end if;
  if d.status = 'confirmed' then return driver_cash_usd(d.driver_id); end if;
  select * into n from driver_cash_native(d.driver_id);
  if d.declared_usd > n.usd + 0.005 or d.declared_lbp > n.lbp + 0.5 then raise exception 'DROP_EXCEEDS_BALANCE holds % USD and % LBP', n.usd, n.lbp; end if;
  v_lbp_equiv := case when d.declared_lbp = 0 then 0 when n.lbp > 0 then round(d.declared_lbp * n.lbp_carried_usd / n.lbp, 2)
                      else round(d.declared_lbp / d.fx_rate_lbp, 2) end;
  v_to := case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end;
  v_kind := case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end::account_kind;
  v_cash := ensure_account('driver_cash:' || d.driver_id, 'driver_cash', d.driver_id);
  if d.declared_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_cash, -d.declared_usd, 'USD', -d.declared_usd, 'Cash drop ' || d.method),
      (v_txn, ensure_account(v_to, v_kind), d.declared_usd, 'USD', d.declared_usd, 'Cash drop ' || d.method);
  end if;
  if d.declared_lbp <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_cash, -d.declared_lbp, 'LBP', -v_lbp_equiv, 'Cash drop ' || d.method),
      (v_txn, ensure_account(v_to, v_kind), d.declared_lbp, 'LBP', v_lbp_equiv, 'Cash drop ' || d.method);
  end if;
  update cash_drops set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = p_drop;
  return driver_cash_usd(d.driver_id);
end $$;

-- ---------- 1. resolve_ops_exception: same signature and result, now checked ----------
create or replace function resolve_ops_exception(p_id uuid, p_by uuid, p_status text default 'resolved') returns void language plpgsql as $$
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_status is null or p_status not in ('acknowledged', 'resolved') then raise exception 'UNKNOWN_STATUS %', p_status; end if;
  update ops_exceptions set status = p_status, resolved_by = p_by, resolved_at = case when p_status = 'resolved' then now() end
   where id = p_id and status <> 'resolved';
end $$;

-- ---------- 2. second approval (3.13) ----------
insert into settings(key, value) values ('approvals', '{"price_change_pct": 10, "refund_usd": 20}') on conflict (key) do nothing;

create table pending_approvals (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('price', 'refund')),
  ref          uuid not null,                         -- the product, or the order
  payload      jsonb not null,                        -- the call's arguments, as asked
  summary      text not null,
  requested_by uuid not null references parties(id),
  requested_at timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by   uuid references parties(id),
  decided_at   timestamptz,
  note         text,
  result       jsonb,
  request_key  text unique
);
create index pending_approvals_open on pending_approvals(requested_at) where status = 'pending';

-- 0045's set_offer, renamed, body unchanged.
create or replace function set_offer_now(p_product uuid, p_price_usd numeric, p_available boolean, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare v_src uuid; o offers%rowtype; v_before jsonb;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_price_usd is not null and (p_price_usd <= 0 or p_price_usd > 10000) then raise exception 'PRICE_INVALID'; end if;
  select id into v_src from sources where kind = 'dark_store' order by id limit 1;
  if v_src is null then raise exception 'NO_HUB'; end if;
  if not exists (select 1 from products where id = p_product and owner_source_id is null) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select * into o from offers where source_id = v_src and product_id = p_product for update;
  if not found then
    if p_price_usd is null then raise exception 'PRICE_INVALID'; end if;
    insert into offers(source_id, product_id, price_usd, is_available) values (v_src, p_product, p_price_usd, coalesce(p_available, true)) returning * into o;
    v_before := null;
  else
    v_before := jsonb_build_object('price_usd', o.price_usd, 'is_available', o.is_available);
    update offers set price_usd = coalesce(p_price_usd, price_usd), is_available = coalesce(p_available, is_available) where id = o.id returning * into o;
  end if;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('offer', p_product, v_before, jsonb_build_object('price_usd', o.price_usd, 'is_available', o.is_available), btrim(p_reason), p_by);
  return jsonb_build_object('ok', true, 'price_usd', o.price_usd, 'is_available', o.is_available, 'before', v_before);
end $$;

-- A price that moves more than price_change_pct from the current one waits for a second person. Availability alone, and the first
-- price of a new item, do not.
create or replace function set_offer(p_product uuid, p_price_usd numeric, p_available boolean, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare v_old numeric; v_pct numeric := coalesce((setting('approvals')->>'price_change_pct')::numeric, 10); v_move numeric; v_id uuid; v_name text;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_price_usd is not null and (p_price_usd <= 0 or p_price_usd > 10000) then raise exception 'PRICE_INVALID'; end if;
  select o.price_usd into v_old from offers o where o.product_id = p_product and o.source_id = (select id from sources where kind = 'dark_store' order by id limit 1);
  if p_price_usd is not null and v_old is not null and v_old > 0 then
    v_move := round(abs(p_price_usd / v_old - 1) * 100, 2);
    if v_move > v_pct then
      select name_en into v_name from products where id = p_product;
      -- One waiting price per item: the same price asked again is the same request; a different one replaces it.
      select id into v_id from pending_approvals where kind = 'price' and ref = p_product and status = 'pending'
         and (payload->>'price_usd')::numeric = p_price_usd and requested_by = p_by;
      if v_id is not null then
        return jsonb_build_object('ok', true, 'status', 'awaiting_approval', 'approval_id', v_id, 'move_pct', v_move, 'duplicate', true,
                                  'before', jsonb_build_object('price_usd', v_old));
      end if;
      update pending_approvals set status = 'rejected', decided_by = p_by, decided_at = now(), note = 'replaced by a newer price'
       where kind = 'price' and ref = p_product and status = 'pending';
      insert into pending_approvals(kind, ref, payload, summary, requested_by)
        values ('price', p_product, jsonb_build_object('price_usd', p_price_usd, 'available', p_available, 'reason', btrim(p_reason)),
                coalesce(v_name, 'item') || ': ' || v_old || ' to ' || p_price_usd || ' USD (' || v_move || '%), ' || btrim(p_reason), p_by)
        returning id into v_id;
      return jsonb_build_object('ok', true, 'status', 'awaiting_approval', 'approval_id', v_id, 'move_pct', v_move,
                                'before', jsonb_build_object('price_usd', v_old));
    end if;
  end if;
  return set_offer_now(p_product, p_price_usd, p_available, p_by, p_reason);
end $$;

-- 0030's refund_order, renamed, body unchanged.
create or replace function refund_order_now(p_order uuid, p_by uuid, p_amount_usd numeric, p_charged_to text, p_reason text,
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

-- A refund above refund_usd waits for a second person. Every check refund_order_now and grant_customer_credit make before moving
-- money is made here first, so a refund that could never be made is refused now, not after someone approves it.
create or replace function refund_order(p_order uuid, p_by uuid, p_amount_usd numeric, p_charged_to text, p_reason text,
                                        p_settle text default 'credit', p_ref text default null, p_note text default null,
                                        p_item uuid default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_limit numeric := coalesce((setting('approvals')->>'refund_usd')::numeric, 20); r refunds%rowtype; a pending_approvals%rowtype;
        v_amt numeric := round(p_amount_usd, 2); v_paid numeric; v_refunded numeric; v_code text; v_cap numeric; v_id uuid; v_code_o text;
begin
  if p_key is not null then
    select * into r from refunds where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'refund_id', r.id, 'settle', r.settle); end if;
    select * into a from pending_approvals where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'awaiting_approval', 'approval_id', a.id); end if;
  end if;
  if v_amt is null or v_amt <= v_limit then
    return refund_order_now(p_order, p_by, p_amount_usd, p_charged_to, p_reason, p_settle, p_ref, p_note, p_item, p_key);
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_settle not in ('credit', 'cash', 'whish', 'omt') then raise exception 'UNKNOWN_SETTLE %', p_settle; end if;
  if p_settle in ('whish', 'omt') and (p_ref is null or length(btrim(p_ref)) < 4) then raise exception 'REFERENCE_REQUIRED'; end if;
  if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  if p_item is not null and not exists (select 1 from order_items where id = p_item and order_id = p_order) then raise exception 'ITEM_NOT_ON_ORDER'; end if;
  select short_code into v_code_o from orders where id = p_order;
  if v_code_o is null then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
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
      raise exception 'REFUND_EXCEEDS_REVENUE % still booked for this order on %: %', v_code, v_cap, case when p_charged_to = 'delivery_fee'
        then 'the fee belongs to the rider; charge compensation to goodwill' else 'nothing more to refund' end;
    end if;
  end if;
  insert into pending_approvals(kind, ref, payload, summary, requested_by, request_key)
    values ('refund', p_order, jsonb_build_object('amount_usd', v_amt, 'charged_to', p_charged_to, 'reason', p_reason, 'settle', p_settle,
                                                  'ref', p_ref, 'note', p_note, 'item', p_item),
            v_code_o || ': refund ' || v_amt || ' USD charged to ' || p_charged_to || ' (' || p_reason || '), ' || p_settle, p_by, p_key)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'awaiting_approval', 'approval_id', v_id, 'limit_usd', v_limit);
end $$;

-- The second person. Approving runs the change exactly as it was asked, in the asker's name, and records who approved it.
-- The asker cannot approve their own request; anyone of the two roles may reject one, the asker included (to withdraw it).
create or replace function decide_approval(p_id uuid, p_by uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql as $$
declare a pending_approvals%rowtype; v_result jsonb; v_name text;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into a from pending_approvals where id = p_id for update;
  if not found then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'pending' then return jsonb_build_object('ok', true, 'already', a.status); end if;
  if not p_approve then
    update pending_approvals set status = 'rejected', decided_by = p_by, decided_at = now(), note = nullif(btrim(p_note), '') where id = p_id;
    return jsonb_build_object('ok', true, 'already', null, 'status', 'rejected');
  end if;
  if p_by = a.requested_by then raise exception 'SAME_PERSON: a second person must approve'; end if;
  select display_name into v_name from parties where id = p_by;
  if a.kind = 'price' then
    v_result := set_offer_now(a.ref, (a.payload->>'price_usd')::numeric, (a.payload->>'available')::boolean, a.requested_by,
                              (a.payload->>'reason') || ' (approved by ' || coalesce(v_name, 'staff') || ')');
  else
    v_result := refund_order_now(a.ref, a.requested_by, (a.payload->>'amount_usd')::numeric, a.payload->>'charged_to', a.payload->>'reason',
                                 a.payload->>'settle', a.payload->>'ref', a.payload->>'note', nullif(a.payload->>'item', '')::uuid,
                                 coalesce(a.request_key, 'approval:' || a.id));
  end if;
  update pending_approvals set status = 'approved', decided_by = p_by, decided_at = now(), note = nullif(btrim(p_note), ''), result = v_result where id = p_id;
  return jsonb_build_object('ok', true, 'already', null, 'status', 'approved', 'result', v_result);
end $$;

alter table pending_approvals enable row level security;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table pending_approvals from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table pending_approvals to service_role; end if;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
