-- Rollback for 20261015180100_ops_console.sql (session 5b). Run by hand on staging only if that migration must be undone:
-- restores customer_handoff as in 20261012180000 (the owner's WhatsApp note), stops the recovery tick and drops the console's
-- tables and functions. Lost on purpose: support cases and their messages, order exceptions, the Slack queue and the
-- operator mappings recorded meanwhile (Slack keeps its own copy of what was posted; ops_actions is the audit and is
-- dropped with them, so export it first). Config rows stay (dated rows are never deleted). Enum values added by
-- 20261015180000 stay (Postgres cannot drop them).
begin;

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
drop function if exists public.ops_credit(uuid, uuid, numeric, text, text);
drop function if exists public.ops_refund(uuid, text, numeric, text);
drop function if exists public.ops_claim_decide(uuid, uuid, boolean, text);
drop function if exists public.ops_claims(uuid);
drop function if exists public.ops_merchant_resume(uuid, uuid, text);
drop function if exists public.ops_merchant_pause(uuid, uuid, integer, text);
drop function if exists public.ops_merchant(uuid, text);
drop function if exists public.ops_order(uuid, text);
drop function if exists app_private.ops_log(uuid, text, text, jsonb, jsonb);
drop function if exists app_private.ops_require(uuid, boolean);
drop function if exists app_private.recovery_tick();
drop function if exists app_private.order_exception_open(uuid, text, text, jsonb, boolean, text);
drop table if exists public.order_exceptions;
drop function if exists public.support_case_for_thread(text);
drop function if exists public.support_resolve(uuid, uuid);
drop function if exists public.support_pending(uuid);
drop function if exists public.support_message_status(bigint, text);
drop function if exists public.support_reply(uuid, uuid, text);
drop function if exists public.support_inbound(uuid, text);
drop function if exists app_private.support_case_open(uuid, text, text);
drop table if exists public.support_messages;
drop table if exists public.support_cases;
drop function if exists public.slack_finish(bigint, boolean, text, text, text);
drop function if exists public.slack_claim(integer);
drop function if exists app_private.slack_post(text, text, text, jsonb, text, bigint);
drop table if exists app_private.slack_threads;
drop table if exists public.slack_messages;
drop table if exists public.ops_actions;
drop function if exists public.ops_operator(text, text);
drop table if exists public.operator_phones;
drop table if exists public.operator_slack;
drop function if exists public.slack_channel_set(text, text, text);
drop table if exists app_private.slack_channels;

commit;
