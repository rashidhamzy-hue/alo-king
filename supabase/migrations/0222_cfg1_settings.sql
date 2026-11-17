-- CFG1 (settings and small rules from the design review, 17 November 2026), part 1. docs/DECISIONS.md, "Design reference, 17 November 2026, settings".
--
-- 1. One reminder for an unconfirmed order card. settings.timers.confirm_reminder_min (20): a card still waiting on the customer's tap
--    that long gets one notice, in the same chat, about the customer's own order (customer_notices_due kind 'confirm_reminder'). Once
--    per order (the notice key), and once per customer in 24 hours (an edited card is a new order: the customer is working on it, not
--    gone). It has no template: inside the 24-hour window it goes as a free service message through the gateway (can_send, STOP and the
--    outbox hold); outside it nothing is sent and the skip is recorded (template_not_utility), as for every notice without a template
--    that may be sent. It counts against the order's four code-started messages (0143) and is not essential: over budget it is not sent.
--    The lapsed-order notice (order_cancelled after the awaiting_confirmation timer) now says "reopenable", so the gateway can put the
--    "reopen" button under it (0223 does the reopening).
-- 3. Every pickup order needs the handover code (0146 made it for prepaid and gift orders only). The hub asks for it (hub_handover,
--    check_handover_code, both unchanged). Pickup itself stays off in settings.pickup.
-- 4. settings.approvals: refund_usd 10, price_change_pct 10, and fx_rate_second_person true (0223 makes a rate change wait for a second
--    person through decide_approval).
-- 5. settings.cash_cap: soft_usd 100, hard_usd 150 (driver_can_take and offer_delivery read it; nothing in code changes).
-- 6. The inbox escalation timers are already a setting (settings.support: claim_alert_min 3, founder_alert_min 5, late_min 15; 0135),
--    read by case_timers_due (0136) and the console's Inbox. CFG1 changes no value; test/db/cfg1.test.ts pins that the steps follow it.

update settings set value = value || '{"confirm_reminder_min": 20}'::jsonb where key = 'timers';
update settings set value = '{"soft_usd": 100, "hard_usd": 150}'::jsonb where key = 'cash_cap';
update settings set value = value || '{"refund_usd": 10, "price_change_pct": 10, "fx_rate_second_person": true}'::jsonb where key = 'approvals';

-- 0062's check names three kinds; 0146's 'pickup_ready' was never added to it (an insert would have failed once pickup is on), and
-- 'confirm_reminder' is new. The list is the kinds customer_notices_due can return.
alter table customer_notices drop constraint if exists customer_notices_kind_check;
alter table customer_notices add constraint customer_notices_kind_check
  check (kind in ('order_cancelled', 'rider_at_door', 'payment_received', 'pickup_ready', 'confirm_reminder'));

-- ---------- 3. the pickup code ----------
create or replace function orders_handover_code() returns trigger language plpgsql as $$
begin
  if new.handover_code is null and new.status in ('awaiting_payment', 'confirmed')
     and (new.payment_method <> 'cod' or new.handover_required or new.is_pickup) then
    new.handover_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  end if;
  return new;
end $$;

-- Whether an order is a pickup: what the confirmation says about whom the code is given to.
create or replace function order_is_pickup(p_order uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select is_pickup from orders where id = p_order), false) $$;

-- ---------- 1. the reminder, and what 0146 had ----------
-- Copied from 0146 with two changes: a 'confirm_reminder' notice, and 'reopenable' on a cancelled-by-timer notice.
create or replace function customer_notices_due() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with due as (
    select 'order_cancelled' as kind, o.id as order_id, o.short_code, o.customer_id, customer_language(o.customer_id) as lang,
           e.reason as reason, null::payments as p, e.created_at as at
      from order_events e join orders o on o.id = e.order_id
     where e.to_status = 'cancelled' and e.actor <> 'customer' and e.created_at > now() - interval '2 hours'
       and coalesce(e.reason, '') <> 'superseded_by_new_card'      -- a newer card replaced it; the customer is looking at that one
    union all
    select 'rider_at_door', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, null::payments, s.arrived_at
      from delivery_stops s join orders o on o.id = s.order_id
     where s.kind = 'dropoff' and s.arrived_at > now() - interval '2 hours' and s.completed_at is null and o.status = 'arrived'
    union all
    select 'payment_received', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, p, p.confirmed_at
      from payments p join orders o on o.id = p.order_id
     where p.status = 'confirmed' and p.confirmed_at > now() - interval '2 hours'
       and not (o.is_pickup and o.status in ('delivered', 'closed'))   -- paid at the hub counter: the customer is standing there
    union all
    select 'pickup_ready', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), pickup_place(customer_language(o.customer_id)),
           null::payments, e.created_at
      from order_events e join orders o on o.id = e.order_id
     where e.to_status = 'ready' and o.is_pickup and o.status = 'ready' and e.created_at > now() - interval '12 hours'
    union all
    -- CFG1: the card has waited settings.timers.confirm_reminder_min for the tap. The card's time is its latest awaiting_confirmation
    -- event. Not for a customer already reminded in the last 24 hours (an edited card is a new order, and the customer is at it).
    select 'confirm_reminder', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, null::payments, c.at
      from orders o
      join lateral (select max(ev.created_at) as at from order_events ev where ev.order_id = o.id and ev.to_status = 'awaiting_confirmation') c on true
     where o.status = 'awaiting_confirmation'
       and c.at <= now() - make_interval(mins => coalesce((setting('timers')->>'confirm_reminder_min')::int, 20))
       and c.at > now() - interval '2 hours'
       and not exists (select 1 from customer_notices n join orders o2 on o2.id = n.order_id
                        where n.kind = 'confirm_reminder' and o2.customer_id = o.customer_id and o2.id <> o.id and n.created_at > now() - interval '24 hours')),
  filled as (
    select d.*, case d.kind
      when 'order_cancelled' then jsonb_build_array(d.short_code, case
        when d.reason like 'timeout:awaiting_payment%' then case d.lang when 'en' then 'we did not receive the payment in time'
                                                                       when 'fr' then 'le paiement n''est pas arrivé à temps'
                                                                       else 'ما وصلنا الدفع بالوقت المحدد' end
        when d.reason like 'timeout:%' then case d.lang when 'en' then 'the order was not confirmed in time'
                                                        when 'fr' then 'la commande n''a pas été confirmée à temps'
                                                        else 'ما تأكّد الطلب بالوقت المحدد' end
        else case d.lang when 'en' then 'we could not complete it' when 'fr' then 'nous n''avons pas pu la terminer' else 'ما قدرنا نكمّلو' end end)
      when 'rider_at_door' then jsonb_build_array(d.short_code)
      when 'confirm_reminder' then jsonb_build_array(d.short_code)
      when 'pickup_ready' then jsonb_build_array(d.short_code, coalesce(d.reason, ''))
      else jsonb_build_array(d.short_code, trim(both ' +' from concat_ws(' + ',
             case when (d.p).received_usd > 0 then to_char((d.p).received_usd - (d.p).change_usd, 'FM999990.00') || '$' end,
             case when (d.p).received_lbp > 0 then to_char((d.p).received_lbp - (d.p).change_lbp, 'FM999,999,990') || case d.lang when 'ar' then ' ل.ل.' else ' LBP' end end,
             case when (d.p).received_usd = 0 and (d.p).received_lbp = 0 then to_char((d.p).amount_usd, 'FM999990.00') || '$' end)
             || case (d.p).method
                  when 'cod' then case d.lang when 'en' then ' cash' when 'fr' then ' en espèces' else ' نقداً' end
                  when 'whish' then case d.lang when 'en' then ' via Whish' when 'fr' then ' par Whish' else ' عبر Whish' end
                  when 'omt' then case d.lang when 'en' then ' via OMT' when 'fr' then ' par OMT' else ' عبر OMT' end
                  else '' end))
    end as params from due d)
  select coalesce(jsonb_agg(jsonb_build_object('key', 'notice:' || f.kind || ':' || f.order_id, 'kind', f.kind, 'order_id', f.order_id,
           'short_code', f.short_code, 'customer_id', f.customer_id, 'params', f.params, 'lang', f.lang,
           'reopenable', f.kind = 'order_cancelled' and f.reason = 'timeout:awaiting_confirmation',
           'template', t.name, 'template_approved', template_sendable(t.name), 'template_status', t.status, 'template_category', t.category) order by f.at), '[]'::jsonb)
    from filled f
    left join wa_templates t on t.name = event_template(f.kind, f.lang)
   where not exists (select 1 from customer_notices n where n.key = 'notice:' || f.kind || ':' || f.order_id) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
