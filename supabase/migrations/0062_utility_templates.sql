-- 0062 (session A2, task 4.3): three utility templates and the events they belong to.
-- Submitted to Meta through Kapso on 13 November 2026 (WABA 1086076707594153, customer line), category UTILITY,
-- allow_category_change false (a template Meta wants to call marketing is rejected, never quietly re-filed). Meta ids:
--   ak_order_cancelled_v1   1458006846477073
--   ak_rider_at_door_v1     1786544829266049
--   ak_payment_received_v1  1780600283167217
-- Status starts as 'submitted'. The cron reads Meta's status every hour (apps/gateway/src/index.ts) and writes it here.
-- Until a template is 'approved', the same notice goes out as free text, which the gate allows only inside the 24-hour window.
-- Wording rules: transactional only, no offer, no praise, nothing a reviewer could read as promotion (invariant 17).

insert into wa_templates(name, line, category, language, body, variables, status) values
  ('ak_order_cancelled_v1', 'customer', 'utility', 'ar',
   'تم إلغاء طلبك رقم {{1}}. السبب: {{2}}. إذا بعدك بدّك ياه، ردّ على هالرسالة.', '["order_code","reason"]', 'submitted'),
  ('ak_rider_at_door_v1', 'customer', 'utility', 'ar',
   'السائق وصل عالعنوان بطلبك رقم {{1}} وعم يستناك هلق.', '["order_code"]', 'submitted'),
  ('ak_payment_received_v1', 'customer', 'utility', 'ar',
   'وصلنا دفعك لطلب رقم {{1}}: {{2}}. هيدا إيصالك.', '["order_code","paid_summary"]', 'submitted')
on conflict (name) do nothing;

create or replace function set_template_status(p_name text, p_status text) returns boolean language sql as $$
  update wa_templates set status = lower(p_status) where name = p_name and status is distinct from lower(p_status) returning true $$;

-- Which notices have been dealt with, so the cron never offers the same one twice. The outbox stops a double send;
-- this stops a notice the gate refused (window closed, template not approved yet) from being retried every minute.
create table if not exists customer_notices (
  key        text primary key,                       -- notice:<kind>:<order>  (and the outbox dedupe key)
  kind       text not null check (kind in ('order_cancelled','rider_at_door','payment_received')),
  order_id   uuid not null references orders(id) on delete cascade,
  outcome    text not null,                          -- sent | refused:<reason>
  created_at timestamptz not null default now()
);
alter table customer_notices enable row level security;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table customer_notices from %I', r); end if;
  end loop;
end $$;

-- What the customer should hear about now. Each event is looked at for two hours, then it is history.
--   order_cancelled   any cancellation the customer did not make themselves (they already saw their own tap answered)
--   rider_at_door     the rider tapped "arrived" and the order is still waiting at the door
--   payment_received  a payment was confirmed (cash counted by the rider, Whish or OMT confirmed by the ops lead)
create or replace function customer_notices_due() returns jsonb language sql stable as $$
  with due as (
    select 'order_cancelled' as kind, o.id as order_id, o.short_code, o.customer_id,
           jsonb_build_array(o.short_code, case
             when e.reason like 'timeout:awaiting_payment%' then 'ما وصلنا الدفع بالوقت المحدد'
             when e.reason like 'timeout:%' then 'ما تأكّد الطلب بالوقت المحدد'
             else 'ما قدرنا نكمّلو' end) as params, e.created_at as at
      from order_events e join orders o on o.id = e.order_id
     where e.to_status = 'cancelled' and e.actor <> 'customer' and e.created_at > now() - interval '2 hours'
       and coalesce(e.reason, '') <> 'superseded_by_new_card'      -- a newer card replaced it; the customer is looking at that one
    union all
    select 'rider_at_door', o.id, o.short_code, o.customer_id, jsonb_build_array(o.short_code), s.arrived_at
      from delivery_stops s join orders o on o.id = s.order_id
     where s.kind = 'dropoff' and s.arrived_at > now() - interval '2 hours' and s.completed_at is null and o.status = 'arrived'
    union all
    select 'payment_received', o.id, o.short_code, o.customer_id,
           jsonb_build_array(o.short_code, trim(both ' +' from concat_ws(' + ',
             case when p.received_usd > 0 then to_char(p.received_usd - p.change_usd, 'FM999990.00') || '$' end,
             case when p.received_lbp > 0 then to_char(p.received_lbp - p.change_lbp, 'FM999,999,990') || ' ل.ل.' end,
             case when p.received_usd = 0 and p.received_lbp = 0 then to_char(p.amount_usd, 'FM999990.00') || '$' end)
             || case p.method when 'cod' then ' نقداً' when 'whish' then ' عبر Whish' when 'omt' then ' عبر OMT' else '' end)),
           p.confirmed_at
      from payments p join orders o on o.id = p.order_id
     where p.status = 'confirmed' and p.confirmed_at > now() - interval '2 hours')
  select coalesce(jsonb_agg(jsonb_build_object('key', 'notice:' || d.kind || ':' || d.order_id, 'kind', d.kind, 'order_id', d.order_id,
           'short_code', d.short_code, 'customer_id', d.customer_id, 'params', d.params,
           'template', t.name, 'template_approved', t.status = 'approved') order by d.at), '[]'::jsonb)
    from due d
    left join wa_templates t on t.name = case d.kind when 'order_cancelled' then 'ak_order_cancelled_v1'
                                              when 'rider_at_door' then 'ak_rider_at_door_v1' else 'ak_payment_received_v1' end
   where not exists (select 1 from customer_notices n where n.key = 'notice:' || d.kind || ':' || d.order_id) $$;

create or replace function customer_notice_done(p_key text, p_kind text, p_order uuid, p_outcome text) returns void language sql as $$
  insert into customer_notices(key, kind, order_id, outcome) values (p_key, p_kind, p_order, p_outcome) on conflict (key) do nothing $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
