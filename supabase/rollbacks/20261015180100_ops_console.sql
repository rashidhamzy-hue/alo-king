-- Rollback for 20261015180100_ops_console.sql (session 5b). Run by hand on staging only if that migration must be undone:
-- keeps the dispute_decide fix (it only corrects a schema name), restores customer_handoff as in 20261012180000 (the owner's WhatsApp note), customer_handoff_end and dispute_open, stops the recovery tick and drops the console's
-- tables and functions. Lost on purpose: support cases and their messages, order exceptions, the Slack queue and the
-- operator mappings recorded meanwhile (Slack keeps its own copy of what was posted; ops_actions is the audit and is
-- dropped with them, so export it first). Config rows stay (dated rows are never deleted). Enum values added by
-- 20261015180000 stay (Postgres cannot drop them).
begin;

-- customer_handoff_end and dispute_open as in their earlier migrations (20261011100100, 20261015120100).
create or replace function public.customer_handoff_end(p_customer_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bot_sessions set handoff_until = null, handoff_reason = null where customer_id = p_customer_id;
end;
$$;
create or replace function public.dispute_open(p_customer_id uuid, p_order_id uuid, p_kind text, p_order_item_id uuid default null,
  p_quantity integer default 1)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_r jsonb := public.config_value('dispute_rules');
  v_line public.order_items%rowtype;
  v_amount numeric := 0;
  v_payer text;
  v_decision text;
  v_rule text;
  v_rate numeric;
  v_delivered integer;
  v_prior integer;
  v_leg_min numeric;
  v_expected_min numeric;
  v_prep_late numeric;
  v_id uuid;
  v_booked jsonb;
  v_promised timestamptz;
begin
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id;
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if v_o.status <> 'delivered' then
    return jsonb_build_object('status', 'not_delivered', 'order_status', v_o.status);
  end if;
  if v_o.delivered_at < now() - make_interval(days => (v_r ->> 'report_days')::int) then
    return jsonb_build_object('status', 'too_late', 'days', (v_r ->> 'report_days')::int);
  end if;
  if p_kind not in ('missing_item', 'wrong_item', 'cold_food', 'late', 'damaged', 'other') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_kind in ('missing_item', 'wrong_item') then
    select * into v_line from public.order_items where id = p_order_item_id and order_id = v_o.id;
    if v_line.id is null then
      return jsonb_build_object('status', 'pick_line');
    end if;
  end if;
  if exists (select 1 from public.order_disputes d where d.order_id = v_o.id and d.kind = p_kind
             and d.order_item_id is not distinct from v_line.id) then
    return jsonb_build_object('status', 'already_reported');
  end if;

  select count(*) into v_delivered from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered'
    and o.delivered_at > now() - make_interval(days => (v_r ->> 'rate_window_days')::int);
  select count(*) into v_prior from public.order_disputes d where d.customer_id = p_customer_id
    and d.created_at > now() - make_interval(days => (v_r ->> 'rate_window_days')::int)
    and d.decision in ('auto_credit', 'approved', 'review', 'owner_review');
  v_rate := v_prior::numeric / greatest(v_delivered, 1);

  case p_kind
    when 'missing_item', 'wrong_item' then
      -- Per unit reported (one unless the customer says more), never more than the line.
      v_amount := round(v_line.line_total_usd / greatest(v_line.quantity, 1) * least(greatest(coalesce(p_quantity, 1), 1), v_line.quantity), 2);
      v_payer := 'merchant';
      v_rule := format('%s: %s of %s, merchant pays', p_kind, least(greatest(coalesce(p_quantity, 1), 1), v_line.quantity), v_line.quantity);
    when 'cold_food' then
      -- The delivery leg (out for delivery → delivered) against 1.5 x the expected road time: the cached route's
      -- duration, else 25 km/h over the road distance.
      if v_o.picked_up_at is null or v_o.delivered_at is null or v_o.road_km is null or v_o.delivery_pin is null then
        v_rule := 'cold_food: no delivery times to check';
      else
        v_leg_min := extract(epoch from (v_o.delivered_at - v_o.picked_up_at)) / 60.0;
        select r.duration_s / 60.0 into v_expected_min
        from public.vendors v, public.route_cache_lookup(extensions.st_y(v.location::extensions.geometry), extensions.st_x(v.location::extensions.geometry),
          array[extensions.st_y(v_o.delivery_pin::extensions.geometry)], array[extensions.st_x(v_o.delivery_pin::extensions.geometry)]) r
        where v.id = v_o.vendor_id;
        v_expected_min := greatest(5, coalesce(v_expected_min, v_o.road_km / 25.0 * 60.0));
        if v_leg_min > (v_r ->> 'cold_factor')::numeric * v_expected_min then
          v_amount := round(v_o.food_subtotal_usd * (v_r ->> 'cold_credit_pct')::numeric / 100.0, 2);
          v_payer := case when v_o.delivery_mode = 'merchant' then 'merchant' else 'alo_king' end;
          v_rule := format('cold_food: delivery took %s min against %s expected', round(v_leg_min), round(v_expected_min));
        else
          v_rule := format('cold_food: delivery took %s min, within 1.5 x %s', round(v_leg_min), round(v_expected_min));
        end if;
      end if;
    when 'late' then
      v_promised := v_o.accepted_at + make_interval(mins => coalesce(v_o.prep_minutes, 20)::int);
      if v_o.ready_marked_at is not null and v_o.ready_marked_at > v_promised + make_interval(mins => (v_r ->> 'late_prep_min')::int) then
        v_prep_late := extract(epoch from (v_o.ready_marked_at - v_promised)) / 60.0;
        v_amount := v_o.delivery_fee_usd;
        v_payer := 'merchant';
        v_rule := format('late: ready %s min after the promised time, merchant pays', round(v_prep_late));
      else
        v_rule := 'late: preparation within 15 min of the promise';
      end if;
    when 'damaged' then
      v_rule := 'damaged: photo needed, a person decides (remake or credit)';
    else
      v_rule := 'other: a person decides';
  end case;

  if p_kind in ('damaged', 'other') or v_amount = 0 and p_kind not in ('cold_food', 'late') then
    v_decision := 'review';
  elsif v_amount = 0 then
    v_decision := 'rejected';
  elsif v_o.payment_method <> 'cod' then
    v_decision := 'review'; -- refunded to the original payment (Phase 6), never a credit
  elsif v_amount > (v_r ->> 'owner_over_usd')::numeric then
    v_decision := 'owner_review';
  elsif v_amount <= (v_r ->> 'auto_max_usd')::numeric and v_rate < (v_r ->> 'max_dispute_rate')::numeric then
    v_decision := 'auto_credit'; -- up to $8 and a low dispute rate; between $8 and $20 a person, above $20 Rasheed
  else
    v_decision := 'review';
  end if;

  insert into public.order_disputes (order_id, customer_id, kind, order_item_id, amount_usd, payer, decision, rule)
  values (v_o.id, p_customer_id, p_kind, v_line.id, v_amount, v_payer, v_decision, v_rule || format(' (dispute rate %s)', round(v_rate, 2)))
  returning id into v_id;
  update public.orders set customer_problem_at = coalesce(customer_problem_at, now()) where id = v_o.id;

  if v_decision = 'auto_credit' then
    v_booked := app_private.dispute_book(v_id);
  elsif v_decision in ('review', 'owner_review') then
    perform app_private.ops_alert('dispute:' || v_id, 'customer_dispute',
      case when v_decision = 'owner_review' then 'urgent' else 'warning' end,
      format('Order %s: customer reports %s%s; %s', v_o.code, replace(p_kind, '_', ' '),
             case when v_amount > 0 then format(' ($%s)', v_amount) else '' end,
             case when v_decision = 'owner_review' then 'over $20: Rasheed decides' else 'a person decides' end),
      v_o.id, v_o.vendor_id, jsonb_build_object('dispute_id', v_id, 'rule', v_rule, 'amount_usd', v_amount));
  end if;
  return jsonb_build_object('status', v_decision, 'dispute_id', v_id, 'amount_usd', v_amount, 'payer', v_payer,
    'code', v_o.code, 'credit_days', (v_r ->> 'credit_days')::int, 'rule', v_rule,
    'usd_lbp_rate', v_o.usd_lbp_rate, 'amount_lbp', round(v_amount * v_o.usd_lbp_rate, 0));
end;
$$;
drop function if exists app_private.support_case_close(uuid, text);

select cron.unschedule('recovery-tick');

create or replace function public.customer_handoff(p_customer_id uuid, p_reason text, p_summary text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric := public.config_numeric('handoff_minutes');
  v_phone text;
  v_owner record;
  v_open boolean := app_private.beirut_hour() >= (public.config_value('support_hours') ->> 'from')::int
                    and app_private.beirut_hour() < (public.config_value('support_hours') ->> 'to')::int;
begin
  insert into public.bot_sessions (customer_id) values (p_customer_id) on conflict (customer_id) do nothing;
  update public.bot_sessions set handoff_until = now() + make_interval(mins => v_minutes::int), handoff_reason = left(p_reason, 300),
    low_confidence = 0
  where customer_id = p_customer_id;
  perform app_private.ops_alert('handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24'), 'customer_handoff', 'warning',
    left('Customer needs a person: ' || coalesce(p_summary, p_reason), 300), null, null,
    jsonb_build_object('customer_id', p_customer_id, 'reason', left(p_reason, 300)));
  select c.phone_e164 into v_phone from public.customers c where c.id = p_customer_id;
  if app_private.is_sim_phone(v_phone) then
    -- A simulated customer (DECISIONS §36): the alert row above is the record; no real phone is messaged.
    return jsonb_build_object('status', 'handed_off', 'support_open', v_open);
  end if;
  for v_owner in select o.phone_e164 from app_private.owner_phones o loop
    begin
      perform public.app_reply(v_owner.phone_e164,
        jsonb_build_object('text', '🙋 Alo King: ' || coalesce(v_phone, 'a customer') || ' needs a person: ' || left(coalesce(p_summary, p_reason), 200)
          || E'\nThe bot stays quiet for ' || v_minutes::int || ' minutes, or until they send "menu".'),
        'handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    exception when others then
      null; -- the handoff itself is stored whatever happens to the note
    end;
  end loop;
  return jsonb_build_object('status', 'handed_off', 'support_open', v_open);
end;
$$;


drop trigger if exists ops_alerts_to_slack on public.ops_alerts;
drop trigger if exists orders_to_slack on public.orders;
drop function if exists app_private.ops_alerts_to_slack();
drop function if exists app_private.orders_to_slack();
drop function if exists public.vendor_hours_after_resume(uuid);
drop function if exists public.ops_status(uuid);
drop function if exists public.ops_action_decide(uuid, uuid, boolean);
drop function if exists public.ops_action_propose(uuid, text, jsonb);
drop function if exists public.ops_driver(uuid, text);
drop function if exists public.ops_alert_ack(uuid, bigint);
drop function if exists public.ops_finance(uuid);
drop function if exists public.ops_place(uuid, text, boolean);
drop function if exists public.ops_credit(uuid, uuid, numeric, text, text, text);
drop function if exists public.ops_refund(uuid, text, numeric, text, text);
drop function if exists public.ops_claim_decide(uuid, uuid, boolean, text);
drop function if exists public.ops_claims(uuid);
drop function if exists public.ops_merchant_resume(uuid, uuid, text);
drop function if exists public.ops_merchant_pause(uuid, uuid, integer, text);
drop function if exists public.ops_merchant(uuid, text);
drop function if exists public.ops_order(uuid, text);
drop function if exists app_private.ops_log(uuid, text, text, jsonb, jsonb);
drop function if exists app_private.ops_require(uuid, boolean);
drop function if exists app_private.recovery_tick();
drop function if exists app_private.recovery_failed(uuid, text, text, text);
drop function if exists app_private.order_exception_open(uuid, text, text, jsonb, boolean, text);
drop table if exists public.order_exceptions;
drop function if exists public.support_case_for_thread(text);
drop function if exists public.support_resolve(uuid, uuid);
drop function if exists public.support_pending(uuid);
drop function if exists public.support_shown(uuid, bigint[]);
drop function if exists public.support_message_status(bigint, text);
drop function if exists public.support_reply(uuid, uuid, text, text, text);
drop function if exists public.support_inbound(uuid, text);
drop function if exists app_private.support_case_open(uuid, text, text);
drop table if exists public.support_messages;
drop table if exists public.support_cases;
drop function if exists public.slack_finish(bigint, boolean, text, text, text, boolean);
drop function if exists public.slack_claim(integer);
drop function if exists app_private.slack_post(text, text, text, jsonb, text, bigint);
drop table if exists app_private.slack_threads;
drop table if exists public.slack_messages;
drop table if exists public.ops_actions;
drop function if exists public.ops_operator(text, text, text);
drop table if exists public.operator_phones;
drop table if exists public.operator_slack;
drop function if exists public.slack_channel_set(text, text, text);
drop table if exists app_private.slack_channels;

commit;
