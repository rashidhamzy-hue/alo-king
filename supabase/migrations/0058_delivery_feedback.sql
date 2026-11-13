-- Alo King Chouf: build plan 2.9 (session B3). One tap after delivery: fine, or a problem. A problem goes to a person.
-- The ask is a reply about the customer's own order, sent minutes after it is delivered, inside the conversation they started:
-- a service message, never a promotion (invariant 17). Neutral: it asks whether the order arrived as it should, never for a
-- rating of a product or a merchant (invariant 14). Timing and the switch are settings.
--   feedback_due(): delivered orders past the delay, within the window, not yet asked. The cron sends the card, then calls
--   mark_feedback_asked() (the gateway's dedupe key `feedback:<order>` makes a resend after a crash harmless).
--   record_feedback(): the customer's tap, once per order and only by its customer. A problem raises an ops exception.

insert into settings(key, value) values ('delivery_feedback', '{"enabled": true, "delay_minutes": 10, "window_hours": 20}')
on conflict (key) do nothing;

create table if not exists order_feedback (
  order_id    uuid primary key references orders(id),
  party_id    uuid not null references parties(id),
  asked_at    timestamptz,
  verdict     text check (verdict in ('fine', 'problem')),
  answered_at timestamptz
);

create or replace function feedback_due(p_limit int default 20) returns jsonb language sql stable as $$
  with s as (select coalesce(setting('delivery_feedback'), '{}'::jsonb) as v)
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'customer_id', o.customer_id) order by o.delivered_at), '[]'::jsonb)
    from (select o.* from orders o, s
           where coalesce((s.v->>'enabled')::boolean, false)
             and o.status in ('delivered', 'closed') and o.delivered_at is not null
             and o.delivered_at < now() - make_interval(mins => coalesce((s.v->>'delay_minutes')::int, 10))
             and o.delivered_at > now() - make_interval(hours => coalesce((s.v->>'window_hours')::int, 20))
             and not exists (select 1 from order_feedback f where f.order_id = o.id and f.asked_at is not null)
           order by o.delivered_at limit p_limit) o
$$;

create or replace function mark_feedback_asked(p_order uuid) returns void language sql as $$
  insert into order_feedback(order_id, party_id, asked_at) select id, customer_id, now() from orders where id = p_order
  on conflict (order_id) do update set asked_at = coalesce(order_feedback.asked_at, excluded.asked_at)
$$;

-- The tap. Returns changed=false for a repeat tap, ok=false for an order that is not this customer's.
create or replace function record_feedback(p_order uuid, p_party uuid, p_verdict text) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_prev text;
begin
  if p_verdict not in ('fine', 'problem') then raise exception 'BAD_VERDICT'; end if;
  select * into o from orders where id = p_order;
  if o.id is null or o.customer_id <> p_party then return jsonb_build_object('ok', false); end if;
  select verdict into v_prev from order_feedback where order_id = p_order;
  if v_prev is not null then return jsonb_build_object('ok', true, 'changed', false, 'verdict', v_prev, 'short_code', o.short_code); end if;
  insert into order_feedback(order_id, party_id, verdict, answered_at) values (p_order, p_party, p_verdict, now())
  on conflict (order_id) do update set verdict = excluded.verdict, answered_at = excluded.answered_at;
  if p_verdict = 'problem' then
    perform raise_ops_exception('delivery_problem', p_order::text, jsonb_build_object('short_code', o.short_code, 'customer_id', p_party));
  end if;
  return jsonb_build_object('ok', true, 'changed', true, 'verdict', p_verdict, 'short_code', o.short_code);
end $$;

do $$ declare r text;
begin
  alter table order_feedback enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table order_feedback from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
