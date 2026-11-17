-- CFG1 (settings and small rules from the design review, 17 November 2026), part 2. docs/DECISIONS.md, "Design reference, 17 November 2026, settings".
--
-- 2. Reopen a lapsed order. A card the customer did not answer in time is cancelled by the timer (run_timers, reason
--    'timeout:awaiting_confirmation'). A customer who then answers that card (taps Confirm or Edit on it, or the "reopen" button under
--    the notice) gets a NEW order from the same basket at today's prices and stock, linked to the old one (orders.reopened_from); its
--    card says "reopened from AK-xxxx". The old order stays cancelled: cancelled is final, nothing here moves it. Only a card the timer
--    cancelled can be reopened; a customer's own cancel, a card a newer card replaced, and any other cancelled order cannot. The new
--    order is made by the same door as every card (create_order_for_turn through issueCard), so the minimum, the stock, the window and
--    the restrictions are checked as always; reopen_check says whether it may be asked, and link_reopened_order records the link.
--    A lapsed card is never opened twice at once: while a reopened order of it is not cancelled, reopen_check says so ('already_reopened',
--    with that order and its status) and the chat shows that order again, never a second copy of the basket.
-- 4. A change to the LBP rate needs a second person (settings.approvals.fx_rate_second_person, 0222). set_fx_rate queues the rate in
--    pending_approvals (kind 'fx') and changes nothing; decide_approval, the same flow as a price or a refund, sets it, and the person
--    who asked cannot approve. The second person's approval is the check the 3% pause (set_fx_rate_now) stood for, so an approved rate
--    is not held again. The first rate ever set is not a change and goes in at once. With the setting false, 0045's behaviour returns.
--    The old body of set_fx_rate is set_fx_rate_now. Anyone redefining decide_approval: start from here (0106's text plus 'fx').

alter table orders add column if not exists reopened_from uuid references orders(id);
create index if not exists orders_reopened_from on orders(reopened_from) where reopened_from is not null;

-- May this cancelled order be opened again by this customer? Read only.
create or replace function reopen_check(p_party uuid, p_order uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare o orders%rowtype; v_open orders%rowtype;
begin
  select * into o from orders where id = p_order;
  if not found or o.customer_id is distinct from p_party then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  if o.status <> 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'not_cancelled', 'short_code', o.short_code, 'status', o.status); end if;
  if not exists (select 1 from order_events e where e.order_id = o.id and e.to_status = 'cancelled' and e.reason = 'timeout:awaiting_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'final', 'short_code', o.short_code);        -- cancelled stays final
  end if;
  select * into v_open from orders where reopened_from = o.id and status <> 'cancelled' order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'already_reopened', 'short_code', o.short_code, 'order_id', v_open.id,
                              'new_short_code', v_open.short_code, 'open_status', v_open.status, 'slot_id', o.delivery_slot_id);
  end if;
  return jsonb_build_object('ok', true, 'short_code', o.short_code, 'slot_id', o.delivery_slot_id);
end $$;

-- The new order was made from the lapsed one's basket: record the link. Refuses what reopen_check refuses, and an order that is not the
-- customer's own, not a card or draft, or already linked.
create or replace function link_reopened_order(p_new uuid, p_old uuid, p_party uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare n orders%rowtype; c jsonb;
begin
  select * into n from orders where id = p_new for update;
  if not found or n.customer_id is distinct from p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if p_new = p_old then raise exception 'CANNOT_REOPEN_ITSELF'; end if;
  if n.reopened_from is not null then return jsonb_build_object('ok', n.reopened_from = p_old, 'already', true, 'reopened_from', (select short_code from orders where id = n.reopened_from)); end if;
  if n.status not in ('draft', 'awaiting_confirmation') then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  c := reopen_check(p_party, p_old);
  if not (c->>'ok')::boolean then return c; end if;
  update orders set reopened_from = p_old where id = p_new;
  return jsonb_build_object('ok', true, 'reopened_from', c->>'short_code');
end $$;

-- ---------- 4. the rate ----------
alter table pending_approvals drop constraint if exists pending_approvals_kind_check;
alter table pending_approvals add constraint pending_approvals_kind_check check (kind in ('price', 'refund', 'payment', 'fx'));

-- 0045's set_fx_rate, with one new argument: p_second, the person who approved it. An approved rate skips the 3% hold.
create or replace function set_fx_rate_now(p_lbp_per_usd numeric, p_by uuid, p_second uuid default null) returns jsonb language plpgsql as $$
declare v_tz text := coalesce(setting('fx')->>'tz', 'Asia/Beirut'); v_pct numeric := coalesce((setting('fx')->>'pause_move_pct')::numeric, 3);
        v_midnight timestamptz; v_first numeric; v_move numeric; v_id uuid; v_name text;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_lbp_per_usd is null or p_lbp_per_usd <= 0 or p_lbp_per_usd > 10000000 then raise exception 'FX_RATE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fx_rates', 0));
  v_midnight := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  select lbp_per_usd into v_first from fx_rates where effective_from >= v_midnight and effective_from <= now() order by effective_from limit 1;
  update fx_pending set status = 'withdrawn' where status = 'pending';
  if v_first is not null and p_second is null then
    v_move := round(abs(p_lbp_per_usd / v_first - 1) * 100, 2);
    if v_move > v_pct then
      insert into fx_pending(lbp_per_usd, base_rate, move_pct, proposed_by) values (p_lbp_per_usd, v_first, v_move, p_by) returning id into v_id;
      insert into config_changes(kind, ref, before, after, reason, changed_by)
        values ('fx', v_id, jsonb_build_object('lbp_per_usd', v_first), jsonb_build_object('lbp_per_usd', p_lbp_per_usd, 'status', 'pending'), 'move ' || v_move || '%', p_by);
      return jsonb_build_object('ok', true, 'status', 'paused', 'pending_id', v_id, 'move_pct', v_move, 'base_rate', v_first);
    end if;
  end if;
  insert into fx_rates(lbp_per_usd, set_by) values (p_lbp_per_usd, p_by) returning id into v_id;
  select display_name into v_name from parties where id = p_second;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('fx', v_id, jsonb_build_object('lbp_per_usd', current_fx()), jsonb_build_object('lbp_per_usd', p_lbp_per_usd),
            case when p_second is not null then 'approved by ' || coalesce(v_name, 'a second person') end, p_by);
  return jsonb_build_object('ok', true, 'status', 'set', 'rate_id', v_id, 'move_pct', v_move);
end $$;

-- The door: with settings.approvals.fx_rate_second_person on (and a rate already in force) the rate waits for a second person.
create or replace function set_fx_rate(p_lbp_per_usd numeric, p_by uuid) returns jsonb language plpgsql as $$
declare v_on boolean := coalesce((setting('approvals')->>'fx_rate_second_person')::boolean, false); v_now numeric; v_id uuid; a pending_approvals%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_lbp_per_usd is null or p_lbp_per_usd <= 0 or p_lbp_per_usd > 10000000 then raise exception 'FX_RATE_INVALID'; end if;
  v_now := current_fx();
  if not v_on or v_now is null then return set_fx_rate_now(p_lbp_per_usd, p_by, null); end if;
  select * into a from pending_approvals where kind = 'fx' and status = 'pending' and requested_by = p_by and (payload->>'lbp_per_usd')::numeric = p_lbp_per_usd;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'awaiting_approval', 'approval_id', a.id, 'lbp_per_usd', p_lbp_per_usd, 'current', v_now);
  end if;
  update pending_approvals set status = 'rejected', decided_by = p_by, decided_at = now(), note = 'replaced by a newer rate'
   where kind = 'fx' and status = 'pending';
  insert into pending_approvals(kind, ref, payload, summary, requested_by)
    values ('fx', gen_random_uuid(), jsonb_build_object('lbp_per_usd', p_lbp_per_usd, 'current', v_now),
            to_char(v_now, 'FM999,999,990') || ' to ' || to_char(p_lbp_per_usd, 'FM999,999,990') || ' LBP per USD ('
            || to_char(round((p_lbp_per_usd / v_now - 1) * 100, 2), 'FM990.00') || '%)', p_by)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'awaiting_approval', 'approval_id', v_id, 'lbp_per_usd', p_lbp_per_usd, 'current', v_now);
end $$;

-- 0106's text, with kind 'fx'.
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
  elsif a.kind = 'fx' then                                                                 -- CFG1: the second person sets the rate
    v_result := set_fx_rate_now((a.payload->>'lbp_per_usd')::numeric, a.requested_by, p_by);
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

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
