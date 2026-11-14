-- Alo King Chouf, session F1 (G1 fixes): a transfer after the payment timer (G1-04); an overpaid transfer (G1-05); who confirms (G1-06).
--
-- G1-04. run_timers (0004) cancels an order still awaiting a transfer after 30 minutes. payment_expected (0018) then returned
--   nothing, so the customer's screenshot was not queued, and confirm_payment refuses a cancelled order: money that arrived in
--   Whish or OMT was recorded nowhere. Now:
--     * payment_expected also returns, when nothing is awaiting payment, the customer's latest transfer order that the payment
--       timer cancelled in the last settings.payment_proofs.late_hours (24) hours, marked late. The gateway needs no change: a
--       screenshot is stored and acknowledged as before, and submit_payment_proof queues it as a late payment (payment_proofs.late,
--       ops exception 'late_payment'). The order stays cancelled; its stock is not held again.
--     * accept_late_payment(proof, by, reference, amount): the ops lead or an admin, after checking the account, books the money to
--       the clearing account and the customer's credit (customer_credit:<party>), once per proof (late_payments). The customer
--       spends it on a next order (apply_customer_credit) or is paid it out (pay_out_credit). review_payment_proof's accept on a
--       late screenshot does the same; reject moves nothing.
-- G1-05. confirm_payment booked any surplus to cash_over_short, as income, and accepted a mistyped amount. Now the surplus is owed
--   to the customer (customer_credit:<party>); only a shortfall of at most a cent stays rounding. A transfer more than
--   settings.approvals.overpay_pct (5) percent over the total waits for a second person (pending_approvals kind 'payment'):
--   confirm_payment answers {status: 'awaiting_approval', approval_id} and books nothing; the screenshot stays open; decide_approval
--   confirms it in the asker's name. The old body is confirm_payment_now.
-- G1-06. confirm_payment, review_payment_proof (and accept_late_payment) check the person with require_role (0045): role and not blocked.
-- A reference used for a late payment cannot confirm another order, and the reverse.
-- Anyone redefining payment_expected, submit_payment_proof, payment_proofs_open, review_payment_proof, confirm_payment,
-- confirm_payment_now or decide_approval: start from here.

alter table payment_proofs add column if not exists late boolean not null default false;
update settings set value = value || '{"late_hours": 24}' where key = 'payment_proofs' and not (value ? 'late_hours');
update settings set value = value || '{"overpay_pct": 5}' where key = 'approvals' and not (value ? 'overpay_pct');

create table if not exists late_payments (
  id           uuid primary key default gen_random_uuid(),
  proof_id     uuid not null unique references payment_proofs(id),
  order_id     uuid not null references orders(id),
  customer_id  uuid not null references parties(id),
  method       payment_method not null check (method in ('whish', 'omt')),
  external_ref text not null,
  amount_usd   numeric(10,2) not null check (amount_usd > 0),
  ledger_txn   uuid not null,
  by_party     uuid not null references parties(id),
  created_at   timestamptz not null default now(),
  unique (method, external_ref));

alter table pending_approvals drop constraint if exists pending_approvals_kind_check;
alter table pending_approvals add constraint pending_approvals_kind_check check (kind in ('price', 'refund', 'payment'));

-- ---------- G1-04: was this order cancelled by the payment timer? ----------
create or replace function cancelled_by_payment_timer(p_order uuid) returns boolean language sql stable as $$
  select exists (select 1 from orders o where o.id = p_order and o.status = 'cancelled')
     and exists (select 1 from order_events e where e.order_id = p_order and e.to_status = 'cancelled' and e.reason = 'timeout:awaiting_payment') $$;

-- ---------- G1-04: the order a screenshot pays for, late or not ----------
create or replace function payment_expected(p_party uuid) returns jsonb language sql stable as $$
  select coalesce(
    (select to_jsonb(x) || '{"late": false}'::jsonb from (
       select o.id as order_id, o.short_code, o.total_usd, o.payment_method from orders o
        where o.customer_id = p_party and o.status = 'awaiting_payment' and o.payment_method in ('whish','omt')
          and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')
        order by o.created_at desc limit 1) x),
    -- Nothing waiting: a transfer order the payment timer cancelled lately. Its screenshot is a late payment, not just a picture.
    (select to_jsonb(y) || '{"late": true}'::jsonb from (
       select o.id as order_id, o.short_code, o.total_usd, o.payment_method from orders o
        where o.customer_id = p_party and o.status = 'cancelled' and o.payment_method in ('whish','omt')
          and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed')
          and not exists (select 1 from late_payments l where l.order_id = o.id)
          and exists (select 1 from order_events e where e.order_id = o.id and e.to_status = 'cancelled' and e.reason = 'timeout:awaiting_payment'
                        and e.created_at > now() - make_interval(hours => coalesce((setting('payment_proofs')->>'late_hours')::int, 24)))
        order by o.created_at desc limit 1) y)) $$;

create or replace function submit_payment_proof(p_party uuid, p_wamid text, p_media_path text, p_sha256 text, p_mime text default null)
returns jsonb language plpgsql as $$
declare v_pay jsonb := payment_expected(p_party); v_order uuid := (v_pay->>'order_id')::uuid; v_id uuid; v_reused boolean; o orders%rowtype; v_prior jsonb;
        v_late boolean := coalesce((v_pay->>'late')::boolean, false);
begin
  select jsonb_build_object('proof_id', p.id, 'order_id', p.order_id, 'short_code', x.short_code, 'total_usd', x.total_usd,
                            'method', x.payment_method, 'reused_image', p.reused_image, 'late', p.late, 'already', true)
    into v_prior from payment_proofs p join orders x on x.id = p.order_id where p.wa_message_id = p_wamid;
  if v_prior is not null then return v_prior; end if;
  if v_order is null then return jsonb_build_object('proof_id', null, 'order_id', null, 'reason', 'no_order_awaiting_payment'); end if;
  select * into o from orders where id = v_order for update;
  -- The same picture for a different order is a flag for the person reviewing. The customer is not accused of anything.
  v_reused := exists (select 1 from payment_proofs where media_sha256 = p_sha256 and order_id is distinct from v_order);
  insert into payment_proofs(party_id, order_id, wa_message_id, media_path, media_sha256, mime_type, reused_image, late)
    values (p_party, v_order, p_wamid, p_media_path, p_sha256, p_mime, v_reused, v_late) returning id into v_id;
  if v_late then
    -- G1-04: the order was cancelled by the payment timer. The payment row is left alone; a person books the money as credit.
    if v_reused then
      insert into risk_flags(subject_kind, subject_id, rule, severity, details)
        values ('customer', p_party, 'payment_proof_reused', 2, jsonb_build_object('proof_id', v_id, 'order_id', v_order));
    end if;
    perform raise_ops_exception('late_payment', v_id::text,
      jsonb_build_object('order_id', v_order, 'short_code', o.short_code, 'expected_usd', o.total_usd, 'method', o.payment_method,
                         'reused_image', v_reused, 'cancelled', 'payment timer'));
    return jsonb_build_object('proof_id', v_id, 'order_id', v_order, 'short_code', o.short_code, 'total_usd', o.total_usd,
                              'method', o.payment_method, 'reused_image', v_reused, 'late', true, 'already', false);
  end if;
  -- payments_hash_once (0001) lets one picture back one payment only: a reused picture is recorded and flagged, not attached.
  update payments set status = 'proof_submitted', proof_media_path = p_media_path, proof_hash = case when v_reused then null else p_sha256 end
   where order_id = v_order and status in ('pending','proof_submitted');
  if not found then
    insert into payments(order_id, method, status, amount_usd, proof_media_path, proof_hash)
      values (v_order, o.payment_method, 'proof_submitted', o.total_usd, p_media_path, case when v_reused then null else p_sha256 end);
  end if;
  if v_reused then
    insert into risk_flags(subject_kind, subject_id, rule, severity, details)
      values ('customer', p_party, 'payment_proof_reused', 2, jsonb_build_object('proof_id', v_id, 'order_id', v_order));
  end if;
  perform raise_ops_exception('payment_proof', v_id::text,
    jsonb_build_object('order_id', v_order, 'short_code', o.short_code, 'expected_usd', o.total_usd, 'method', o.payment_method, 'reused_image', v_reused));
  return jsonb_build_object('proof_id', v_id, 'order_id', v_order, 'short_code', o.short_code, 'total_usd', o.total_usd,
                            'method', o.payment_method, 'reused_image', v_reused, 'late', false, 'already', false);
end $$;


create or replace function payment_proofs_open() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('proof_id', p.id, 'order_id', p.order_id, 'short_code', o.short_code,
           'expected_usd', o.total_usd, 'method', o.payment_method, 'media_path', p.media_path, 'reading', p.extracted,
           'reused_image', p.reused_image, 'received_at', p.created_at,
           'late', p.late or cancelled_by_payment_timer(o.id), 'order_status', o.status,          -- G1-04
           'approval_id', (select a.id from pending_approvals a where a.kind = 'payment' and a.status = 'pending'
                            and a.payload->>'proof_id' = p.id::text order by a.requested_at desc limit 1)) order by p.created_at), '[]'::jsonb)
    from payment_proofs p join orders o on o.id = p.order_id where p.status = 'pending' $$;


-- ---------- G1-05, G1-06: confirm_payment_now is 0052's confirm_payment, with require_role, the reference also checked against late
-- payments, and the surplus owed to the customer ----------
create or replace function confirm_payment_now(p_order uuid, p_by uuid, p_external_ref text, p_amount_usd numeric) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_txn uuid := gen_random_uuid(); v_goods numeric := 0; v_merch numeric := 0; v_net numeric; r record; v_kind account_kind;
        v_rest numeric;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method = 'cod' then raise exception 'COD_ORDER'; end if;
  perform require_role(p_by, array['ops_lead', 'admin']);                                 -- G1-06
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if o.status = 'cancelled' then raise exception 'ORDER_CANCELLED_REFUND_NEEDED'; end if;
  if p_external_ref is null or length(trim(p_external_ref)) < 4 then raise exception 'REFERENCE_REQUIRED'; end if;
  if exists (select 1 from payments where method = o.payment_method and external_ref = p_external_ref and status = 'confirmed')
     or exists (select 1 from late_payments where method = o.payment_method and external_ref = btrim(p_external_ref)) then
    raise exception 'REFERENCE_ALREADY_USED %', p_external_ref; end if;
  if p_amount_usd < o.total_usd - 0.01 then raise exception 'UNDERPAID expected % got %', o.total_usd, p_amount_usd; end if;

  v_kind := case when o.payment_method = 'whish' then 'whish_clearing' else 'omt_clearing' end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo)
    values (v_txn, ensure_account(v_kind::text, v_kind), p_amount_usd, 'USD', p_amount_usd, p_order, 'Transfer ' || p_external_ref);
  for r in select f.subtotal_usd, s.id as source_id, s.kind, s.commission_pct
           from fulfilments f join sources s on s.id = f.source_id where f.order_id = p_order and f.status <> 'cancelled' loop
    if r.kind = 'dark_store' then v_goods := v_goods + r.subtotal_usd;
    else
      v_net := round(r.subtotal_usd * (1 - r.commission_pct / 100), 2);
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
        (v_txn, ensure_account('merchant_payable:' || r.source_id, 'merchant_payable', null, r.source_id), -v_net, 'USD', -v_net, p_order, 'Owed to merchant'),
        (v_txn, ensure_account('revenue_commission', 'revenue_commission'), -(r.subtotal_usd - v_net), 'USD', -(r.subtotal_usd - v_net), p_order, 'Commission');
      v_merch := v_merch + r.subtotal_usd;
    end if;
  end loop;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account('revenue_goods', 'revenue_goods'), -v_goods, 'USD', -v_goods, p_order, 'Goods'),
    (v_txn, ensure_account('revenue_delivery', 'revenue_delivery'), -o.delivery_fee_usd, 'USD', -o.delivery_fee_usd, p_order, 'Delivery fee'),
    (v_txn, ensure_account('tips_payable', 'tips_payable'), -o.tip_usd, 'USD', -o.tip_usd, p_order, 'Tip');
  -- G1-05: a surplus is the customer's money, owed back as credit; only a shortfall of a cent or less is rounding.
  v_rest := p_amount_usd - v_goods - v_merch - o.delivery_fee_usd - o.tip_usd - o.dues_usd - o.small_order_fee_usd;
  if v_rest > 0.005 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, customer_credit_account(o.customer_id), -v_rest, 'USD', -v_rest, p_order, 'Overpaid transfer, owed to the customer');
  elsif v_rest <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('cash_over_short', 'cash_over_short'), -v_rest, 'USD', -v_rest, p_order, 'Rounding');
  end if;
  if o.small_order_fee_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_small_order', 'revenue_small_order'::account_kind), -o.small_order_fee_usd, 'USD', -o.small_order_fee_usd, p_order, 'Small-order fee');
  end if;
  if o.dues_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('customer_receivable:' || o.customer_id, 'customer_receivable'::account_kind, o.customer_id), -o.dues_usd, 'USD', -o.dues_usd, p_order, 'Dues settled');
  end if;
  update payments set status = 'confirmed', external_ref = p_external_ref, received_usd = p_amount_usd, confirmed_by = p_by, confirmed_at = now()
   where order_id = p_order and status in ('pending','proof_submitted');
  if not found then
    insert into payments(order_id, method, status, amount_usd, received_usd, external_ref, confirmed_by, confirmed_at)
      values (p_order, o.payment_method, 'confirmed', o.total_usd, p_amount_usd, p_external_ref, p_by, now());
  end if;
  if o.status = 'awaiting_payment' then perform transition_order(p_order, 'confirmed', 'ops', p_by, 'payment_confirmed'); end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'confirmed', 'credit_usd', greatest(round(v_rest, 2), 0));
end $$;


create or replace function review_payment_proof(p_proof uuid, p_by uuid, p_accept boolean, p_external_ref text default null,
                                                p_amount_usd numeric default null, p_note text default null)
returns jsonb language plpgsql as $$
declare pr payment_proofs%rowtype; r jsonb;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);                                 -- G1-06
  select * into pr from payment_proofs where id = p_proof for update;
  if not found then raise exception 'PROOF_NOT_FOUND'; end if;
  if pr.status <> 'pending' then return jsonb_build_object('ok', true, 'already', pr.status); end if;
  if p_accept then
    if p_amount_usd is null then raise exception 'AMOUNT_REQUIRED'; end if;
    if pr.late or cancelled_by_payment_timer(pr.order_id) then                              -- G1-04: the order was cancelled
      r := accept_late_payment(p_proof, p_by, p_external_ref, p_amount_usd);
      if p_note is not null then update payment_proofs set review_note = p_note where id = p_proof; end if;
      return r || jsonb_build_object('proof_id', p_proof, 'order_id', pr.order_id);
    end if;
    r := confirm_payment(pr.order_id, p_by, p_external_ref, p_amount_usd);
    if r->>'status' = 'awaiting_approval' then                                              -- G1-05: the screenshot stays open
      update pending_approvals set payload = payload || jsonb_build_object('proof_id', p_proof) where id = (r->>'approval_id')::uuid;
      return r || jsonb_build_object('proof_id', p_proof, 'order_id', pr.order_id);
    end if;
    update payment_proofs set status = 'confirmed', reviewed_by = p_by, reviewed_at = now(), review_note = p_note where id = p_proof;
  else
    update payment_proofs set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = p_note where id = p_proof;
    update payments set status = 'pending' where order_id = pr.order_id and status = 'proof_submitted'
      and not exists (select 1 from payment_proofs q where q.order_id = pr.order_id and q.status = 'pending');
    r := jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
   where kind in ('payment_proof', 'late_payment') and ref = p_proof::text and status <> 'resolved';
  return r || jsonb_build_object('proof_id', p_proof, 'order_id', pr.order_id);
end $$;


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
  elsif a.kind = 'payment' then                                                            -- G1-05 (F1)
    v_result := confirm_payment_now(a.ref, a.requested_by, a.payload->>'external_ref', (a.payload->>'amount_usd')::numeric);
    if a.payload ? 'proof_id' then
      update payment_proofs set status = 'confirmed', reviewed_by = a.requested_by, reviewed_at = now(),
             review_note = 'overpayment approved by ' || coalesce(v_name, 'staff')
       where id = (a.payload->>'proof_id')::uuid and status = 'pending';
      update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
       where kind = 'payment_proof' and ref = a.payload->>'proof_id' and status <> 'resolved';
    end if;
  else
    v_result := refund_order_now(a.ref, a.requested_by, (a.payload->>'amount_usd')::numeric, a.payload->>'charged_to', a.payload->>'reason',
                                 a.payload->>'settle', a.payload->>'ref', a.payload->>'note', nullif(a.payload->>'item', '')::uuid,
                                 coalesce(a.request_key, 'approval:' || a.id));
  end if;
  update pending_approvals set status = 'approved', decided_by = p_by, decided_at = now(), note = nullif(btrim(p_note), ''), result = v_result where id = p_id;
  return jsonb_build_object('ok', true, 'already', null, 'status', 'approved', 'result', v_result);
end $$;


-- ---------- G1-05: confirm_payment, a large overpayment waits for a second person ----------
create or replace function confirm_payment(p_order uuid, p_by uuid, p_external_ref text, p_amount_usd numeric) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_pct numeric := coalesce((setting('approvals')->>'overpay_pct')::numeric, 5); v_amt numeric := round(p_amount_usd, 2);
        a pending_approvals%rowtype; v_id uuid; v_over numeric;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into o from orders where id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.payment_method <> 'cod' and o.status <> 'cancelled' and v_amt is not null and o.total_usd > 0
     and v_amt > round(o.total_usd * (1 + v_pct / 100), 2) + 0.005
     and not exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    if p_external_ref is null or length(trim(p_external_ref)) < 4 then raise exception 'REFERENCE_REQUIRED'; end if;
    if exists (select 1 from payments where method = o.payment_method and external_ref = p_external_ref and status = 'confirmed')
       or exists (select 1 from late_payments where method = o.payment_method and external_ref = btrim(p_external_ref)) then
      raise exception 'REFERENCE_ALREADY_USED %', p_external_ref; end if;
    v_over := round((v_amt / o.total_usd - 1) * 100, 1);
    select * into a from pending_approvals where kind = 'payment' and ref = p_order and status = 'pending' and requested_by = p_by
       and payload->>'external_ref' = btrim(p_external_ref) and (payload->>'amount_usd')::numeric = v_amt;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'awaiting_approval', 'approval_id', a.id, 'over_pct', v_over);
    end if;
    insert into pending_approvals(kind, ref, payload, summary, requested_by)
      values ('payment', p_order, jsonb_build_object('external_ref', btrim(p_external_ref), 'amount_usd', v_amt, 'total_usd', o.total_usd),
              o.short_code || ': ' || o.payment_method || ' transfer of ' || v_amt || ' USD for a total of ' || o.total_usd || ' USD (' || v_over
              || '% over; the surplus becomes the customer''s credit), reference ' || btrim(p_external_ref), p_by)
      returning id into v_id;
    return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'awaiting_approval', 'approval_id', v_id, 'over_pct', v_over, 'limit_pct', v_pct);
  end if;
  return confirm_payment_now(p_order, p_by, p_external_ref, p_amount_usd);
end $$;

-- ---------- G1-04: accept_late_payment, the money to the clearing account and the customer's credit, once ----------
create or replace function accept_late_payment(p_proof uuid, p_by uuid, p_reference text, p_amount_usd numeric) returns jsonb language plpgsql as $$
declare pr payment_proofs%rowtype; o orders%rowtype; lp late_payments%rowtype; v_txn uuid := gen_random_uuid(); v_amt numeric := round(p_amount_usd, 2);
        v_kind account_kind; v_ref text := btrim(coalesce(p_reference, ''));
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into pr from payment_proofs where id = p_proof for update;
  if not found then raise exception 'PROOF_NOT_FOUND'; end if;
  select * into lp from late_payments where proof_id = p_proof;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'late', true, 'late_payment_id', lp.id, 'order_id', lp.order_id,
                              'credit_usd', customer_credit_usd(lp.customer_id));
  end if;
  -- Late: sent after the timer, or sent in time and reviewed after the timer cancelled the order.
  if not pr.late and not cancelled_by_payment_timer(pr.order_id) then raise exception 'NOT_A_LATE_PAYMENT: confirm it as a payment'; end if;
  if pr.status <> 'pending' then return jsonb_build_object('ok', true, 'already', pr.status); end if;
  if length(v_ref) < 4 then raise exception 'REFERENCE_REQUIRED'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  select * into o from orders where id = pr.order_id for update;
  if exists (select 1 from payments where order_id = o.id and status = 'confirmed') then raise exception 'ORDER_ALREADY_PAID'; end if;
  if exists (select 1 from payments where method = o.payment_method and external_ref = v_ref)
     or exists (select 1 from late_payments where method = o.payment_method and external_ref = v_ref) then
    raise exception 'REFERENCE_ALREADY_USED %', v_ref; end if;
  v_kind := case when o.payment_method = 'whish' then 'whish_clearing' else 'omt_clearing' end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
    (v_txn, ensure_account(v_kind::text, v_kind), v_amt, 'USD', v_amt, o.id, 'Late transfer ' || v_ref),
    (v_txn, customer_credit_account(o.customer_id), -v_amt, 'USD', -v_amt, o.id, 'Late transfer for cancelled order ' || o.short_code || ', owed to the customer');
  insert into late_payments(proof_id, order_id, customer_id, method, external_ref, amount_usd, ledger_txn, by_party)
    values (p_proof, o.id, o.customer_id, o.payment_method, v_ref, v_amt, v_txn, p_by) returning * into lp;
  update payment_proofs set status = 'confirmed', reviewed_by = p_by, reviewed_at = now(),
         review_note = coalesce(review_note, 'late payment: booked to the customer''s credit') where id = p_proof;
  update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
   where kind in ('late_payment', 'payment_proof') and ref = p_proof::text and status <> 'resolved';
  update payments set status = 'rejected' where order_id = o.id and status = 'proof_submitted';   -- the order's own payment never came
  return jsonb_build_object('ok', true, 'duplicate', false, 'late', true, 'late_payment_id', lp.id, 'order_id', o.id, 'short_code', o.short_code,
                            'amount_usd', v_amt, 'credit_usd', customer_credit_usd(o.customer_id));
end $$;

do $$ declare r text; begin
  alter table late_payments enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table late_payments from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table late_payments to service_role; end if;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
