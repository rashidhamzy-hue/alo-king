-- Session 5b (DECISIONS §32.1, §32.5, §30.6): the Slack operations console, human support through Slack threads, WhatsApp
-- admin commands and the order recovery engine. Slack is for operators only and is never the record: every message,
-- case, exception and action is a row here first; dispatch posts the queue to Slack through the ops_notifier adapter, and
-- the ops-slack edge function turns slash commands, buttons and thread replies into the same server functions the admin
-- pages use, as an operator, with an audit row. Telegram is dropped (§32.1).
--
-- 1. Channels: config `slack_channels` names them; the slack-setup workflow creates them and records their ids here.
-- 2. The Slack queue (`slack_messages`), one thread per order in #orders-live and one per support case in #support.
-- 3. Support cases (§32.1, adopted from gokapso/whatsapp-support-agent): a handoff opens a case and a #support thread
--    with the AI's summary and the last messages; customer messages during the handoff join the thread; a reply in the
--    thread goes to the customer on WhatsApp as "Rasheed, Alo King" (inside the window, else the approved support-reply
--    template, and the held reply is shown when they tap it); Resolve closes the case and hands back to the assistant.
-- 4. The recovery engine (§32.5): `order_exceptions`, one row per detected problem with a rule-chosen recovery, one next
--    action per person, a Slack alert only when a human is needed, and a verified close (the condition is re-checked).
--    The 60-second rule (§38.5 row 5b): an order nobody acknowledged after 60 s is an urgent Slack alert.
-- 5. Operators: Slack users and phone numbers map to `operators` rows; every action is one `ops_actions` row.

-- 0. Config ---------------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('slack_channels', '{"urgent": "ops-urgent", "orders": "orders-live", "claims": "claims", "money": "money", "support": "support", "drivers": "drivers", "brief": "daily-brief"}',
   now(), 'Slack channel names of the ops console (DECISIONS §32.1); slack-setup creates them and records their ids', null),
  ('recovery_rules', '{"no_ack_s": 60, "late_ready_grace_min": 10, "late_ready_human_min": 20, "late_delivery_min": 45, "slack_keep_days": 14}',
   now(), 'Order recovery engine thresholds (DECISIONS §32.5, §38.5 row 5b: Slack alert at 60 s)', null),
  ('ops_money_confirm_usd', '20', now(), 'Money actions above this need a confirm step in Slack and an admin (DECISIONS §32.1)', null),
  ('whatsapp_admin_refund_max_usd', '20', now(), 'Refunds by WhatsApp admin command are capped here; larger ones are done in Slack (DECISIONS §32.1)', null),
  ('ops_credit_max_usd', '500', now(), 'The most one operator credit to a merchant may be (§20.3 admin credit)', null);

-- 1. Channels and operators -------------------------------------------------------------------------------------------------
create table app_private.slack_channels (
  key text primary key check (key ~ '^[a-z]+$'),
  channel_id text not null check (channel_id ~ '^[A-Z0-9]{6,20}$'),
  name text,
  updated_at timestamptz not null default now()
);
revoke all on table app_private.slack_channels from public, anon, authenticated;

create function public.slack_channel_set(p_key text, p_channel_id text, p_name text) returns void
language sql security definer set search_path = ''
as $$
  insert into app_private.slack_channels (key, channel_id, name) values (p_key, p_channel_id, p_name)
  on conflict (key) do update set channel_id = excluded.channel_id, name = excluded.name, updated_at = now();
$$;

create table public.operator_slack (
  slack_user_id text primary key check (slack_user_id ~ '^[UW][A-Z0-9]{6,20}$'),
  operator_user_id uuid not null unique references public.operators (user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.operator_phones (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  operator_user_id uuid not null references public.operators (user_id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.operator_slack enable row level security;
alter table public.operator_phones enable row level security;
revoke all on table public.operator_slack, public.operator_phones from public, anon, authenticated;
grant all on table public.operator_slack, public.operator_phones to service_role;
grant select on table public.operator_slack, public.operator_phones to authenticated;
create policy operator_slack_read on public.operator_slack for select to authenticated using ((select app_private.is_admin()));
create policy operator_phones_read on public.operator_phones for select to authenticated using ((select app_private.is_admin()));
create trigger operator_slack_audit after insert or update or delete on public.operator_slack
  for each row execute function app_private.audit_row();
create trigger operator_phones_audit after insert or update or delete on public.operator_phones
  for each row execute function app_private.audit_row();

-- The operator behind a Slack user or a phone, or null: only an active operators row counts.
-- By phone, only on the Merchant side (§32.1: Rasheed "on the Merchant number"): a message that arrived on the Customer
-- number is a customer's, whoever sends it. The sandbox and the test number carry both sides.
create function public.ops_operator(p_slack_user_id text default null, p_phone_e164 text default null,
  p_phone_number_id text default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('user_id', o.user_id, 'role', o.role, 'name', o.display_name)
  from public.operators o
  where o.active and o.user_id = coalesce(
    (select s.operator_user_id from public.operator_slack s where s.slack_user_id = p_slack_user_id),
    (select p.operator_user_id from public.operator_phones p where p.phone_e164 = p_phone_e164
       and not exists (select 1 from public.whatsapp_numbers w where w.phone_number_id = p_phone_number_id and w.role = 'customer')));
$$;

-- Every operator action from Slack or WhatsApp, proposed (waiting for a confirm), done or refused.
create table public.ops_actions (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references public.operators (user_id),
  source text not null check (source in ('slack', 'whatsapp')),
  action text not null check (action ~ '^[a-z_]{3,40}$'),
  args jsonb not null default '{}' check (jsonb_typeof(args) = 'object'),
  status text not null default 'proposed' check (status in ('proposed', 'done', 'refused', 'cancelled', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index ops_actions_created_idx on public.ops_actions (created_at desc);
alter table public.ops_actions enable row level security;
revoke all on table public.ops_actions from public, anon, authenticated;
grant all on table public.ops_actions to service_role;
grant select on table public.ops_actions to authenticated;
create policy ops_actions_operator_read on public.ops_actions for select to authenticated using ((select app_private.is_operator()));

-- 2. The Slack queue --------------------------------------------------------------------------------------------------------
create table public.slack_messages (
  id bigint generated always as identity primary key,
  dedupe_key text unique check (char_length(dedupe_key) between 3 and 200),
  channel_key text not null check (channel_key in ('urgent', 'orders', 'claims', 'money', 'support', 'drivers', 'brief')),
  -- Messages with the same thread key share one Slack thread; the first one is its root.
  thread_key text check (thread_key ~ '^(order|case|alert):[0-9a-f-]{1,36}$'),
  -- No customer phone or address: Slack is not the record (§32.1). Order codes, shop names and summaries only.
  text text not null check (char_length(text) between 1 and 3000),
  -- Buttons: [{"action_id": "ack_alert", "text": "Acknowledge", "value": "...", "style": "primary"|"danger"}]
  actions jsonb not null default '[]' check (jsonb_typeof(actions) = 'array'),
  alert_id bigint references public.ops_alerts (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0,
  ts text,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index slack_messages_queued_idx on public.slack_messages (id) where status = 'queued';
create table app_private.slack_threads (
  thread_key text primary key,
  channel_id text not null,
  ts text not null,
  created_at timestamptz not null default now()
);
alter table public.slack_messages enable row level security;
revoke all on table public.slack_messages, app_private.slack_threads from public, anon, authenticated;
grant all on table public.slack_messages to service_role;

create function app_private.slack_post(p_channel_key text, p_thread_key text, p_text text, p_actions jsonb default '[]',
  p_dedupe text default null, p_alert_id bigint default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.slack_messages (dedupe_key, channel_key, thread_key, text, actions, alert_id)
  values (p_dedupe, p_channel_key, p_thread_key, left(p_text, 3000), coalesce(p_actions, '[]'), p_alert_id)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform pg_notify('outbox', 'slack:' || v_id);
  end if;
  return v_id;
end;
$$;

-- What dispatch posts next: a channel with a known id, and a thread reply only once its root is in Slack (the root is the
-- first message of its thread key). Returns the parent ts for replies.
create function public.slack_claim(p_limit integer default 20)
returns table (id bigint, channel_id text, thread_ts text, text text, actions jsonb, attempts integer)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with c as (
    select m.id from public.slack_messages m
    join app_private.slack_channels ch on ch.key = m.channel_key
    left join app_private.slack_threads t on t.thread_key = m.thread_key
    where m.status = 'queued' and m.attempts < 5
      and (m.thread_key is null or t.thread_key is not null
           or not exists (select 1 from public.slack_messages e where e.thread_key = m.thread_key and e.id < m.id and e.status <> 'failed'))
    order by m.id
    limit least(greatest(p_limit, 1), 50)
    for update of m skip locked)
  update public.slack_messages m set attempts = m.attempts + 1
  from c, app_private.slack_channels ch
  where m.id = c.id and ch.key = m.channel_key
  returning m.id, ch.channel_id,
    (select t.ts from app_private.slack_threads t where t.thread_key = m.thread_key), m.text, m.actions, m.attempts;
end;
$$;

create function public.slack_finish(p_id bigint, p_ok boolean, p_channel_id text, p_ts text, p_error text, p_retry boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.slack_messages%rowtype;
begin
  update public.slack_messages set status = case when p_ok then 'sent' when attempts >= 5 or not p_retry then 'failed' else 'queued' end,
    ts = p_ts, sent_at = case when p_ok then now() end, last_error = left(p_error, 500)
  where id = p_id returning * into v_m;
  if p_ok and v_m.thread_key is not null and p_ts is not null then
    insert into app_private.slack_threads (thread_key, channel_id, ts) values (v_m.thread_key, p_channel_id, p_ts)
    on conflict (thread_key) do nothing;
  end if;
  if p_ok and v_m.alert_id is not null then
    update public.ops_alerts set sent_at = coalesce(sent_at, now()) where id = v_m.alert_id;
  end if;
end;
$$;

-- Every ops alert goes to Slack, to the channel for its kind (§32.1); the ones that need an action carry buttons.
create function app_private.ops_alerts_to_slack() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_channel text := case
    when new.kind in ('merchant_not_answering', 'order_given_up', 'sos', 'arrived_not_delivered', 'order_exception',
                      'food_age', 'not_ready', 'acknowledged_not_accepted', 'merchant_auto_paused', 'channel_down', 'dead_letter') then 'urgent'
    when new.kind in ('money_incident', 'cash_over_limit', 'customer_dispute', 'broadcast', 'ai_budget', 'message_budget') then 'money'
    when new.kind in ('claim_review', 'listing_report', 'menu_help', 'driver_application') then 'claims'
    when new.kind in ('customer_handoff', 'customer_problem', 'support_case') then 'support'
    when new.kind in ('partner_late', 'driver_requested') then 'drivers'
    else 'urgent' end;
  v_code text := (select o.code from public.orders o where o.id = new.order_id);
  v_icon text := case new.severity when 'urgent' then '🚨' when 'warning' then '⚠️' else 'ℹ️' end;
begin
  -- A handoff has its own case thread (support_case_open); its alert row stays the record only.
  if new.kind = 'customer_handoff' then
    return null;
  end if;
  perform app_private.slack_post(v_channel, case when new.order_id is not null and v_channel = 'urgent' then 'alert:' || new.id end,
    v_icon || ' ' || new.summary || coalesce(' · #' || v_code, ''),
    jsonb_build_array(jsonb_build_object('action_id', 'ack_alert', 'text', 'Acknowledge', 'value', new.id::text))
      || case when v_code is not null then jsonb_build_array(jsonb_build_object('action_id', 'order_show', 'text', 'Order #' || v_code, 'value', v_code)) else '[]' end,
    'alert:' || new.id, new.id);
  return null;
exception when others then
  return null; -- Slack is a mirror: it never blocks the alert it mirrors (the alert row stays the record)
end;
$$;
create trigger ops_alerts_to_slack after insert on public.ops_alerts
  for each row execute function app_private.ops_alerts_to_slack();

-- #orders-live: one line per status change, threaded per order (§32.1).
create function app_private.orders_to_slack() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status not in ('placed', 'accepted', 'rejected', 'ready', 'picked_up', 'arrived', 'delivered', 'cancelled') then
    return null;
  end if;
  select coalesce(v.name_en, v.name_ar) || case when v.is_test then ' (test)' else '' end into v_vendor
  from public.vendors v where v.id = new.vendor_id;
  perform app_private.slack_post('orders', 'order:' || new.id,
    case when new.status = 'placed'
      then format('🧾 #%s · %s · %s · $%s · %s', new.code, v_vendor, new.fulfilment, to_char(new.total_usd, 'FM999990.00'),
                  case when new.is_gift then 'Send Home' else new.payment_method::text end)
      else format('#%s → %s%s', new.code, new.status,
                  case when new.status = 'rejected' then ' (' || coalesce(new.reject_reason::text, '?') || ')'
                       when new.status = 'cancelled' then ' (' || coalesce(new.cancel_reason::text, '?') || ')' else '' end) end,
    '[]', 'order:' || new.id || ':' || new.status);
  return null;
exception when others then
  return null; -- Slack is a mirror: it never blocks an order's state change
end;
$$;
create trigger orders_to_slack after insert or update of status on public.orders
  for each row execute function app_private.orders_to_slack();

-- 3. Support cases ------------------------------------------------------------------------------------------------------------
create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reason text not null check (char_length(reason) between 1 and 300),
  summary text check (char_length(summary) <= 1000),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.operators (user_id)
);
create unique index support_cases_one_open on public.support_cases (customer_id) where status = 'open';
create table public.support_messages (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.support_cases (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null check (char_length(body) between 1 and 2000),
  operator_user_id uuid references public.operators (user_id),
  -- out: queued → sent (free-form inside the window) or held (the template went; shown when the customer taps it).
  status text not null default 'queued' check (status in ('queued', 'sent', 'held', 'shown', 'received')),
  -- The provider's id for an operator reply (Slack's event_id): a retried delivery is recognised, never sent twice.
  ref text unique check (char_length(ref) <= 200),
  created_at timestamptz not null default now()
);
create index support_messages_case_idx on public.support_messages (case_id, id);
alter table public.support_cases enable row level security;
alter table public.support_messages enable row level security;
revoke all on table public.support_cases, public.support_messages from public, anon, authenticated;
grant all on table public.support_cases, public.support_messages to service_role;
grant select on table public.support_cases, public.support_messages to authenticated;
create policy support_cases_operator_read on public.support_cases for select to authenticated using ((select app_private.is_operator()));
create policy support_messages_operator_read on public.support_messages for select to authenticated using ((select app_private.is_operator()));

-- Opens (or reuses) the customer's case and its #support thread: the AI's summary, what they ordered lately and the last
-- turns of the conversation. Names and order codes, never the phone number (§32.1: Slack is not the record).
create function app_private.support_case_open(p_customer_id uuid, p_reason text, p_summary text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_new boolean := false;
  v_c public.customers%rowtype;
  v_hist text;
  v_orders text;
begin
  select id into v_id from public.support_cases where customer_id = p_customer_id and status = 'open';
  if v_id is null then
    insert into public.support_cases (customer_id, reason, summary) values (p_customer_id, left(p_reason, 300), left(p_summary, 1000))
    on conflict do nothing returning id into v_id;
    v_new := v_id is not null;
    if v_id is null then
      select id into v_id from public.support_cases where customer_id = p_customer_id and status = 'open';
    end if;
  end if;
  if v_new then
    select * into v_c from public.customers where id = p_customer_id;
    -- The last 6 turns, in order.
    select string_agg(case when x.h ->> 'r' = 'u' then '› ' else '‹ ' end || left(x.h ->> 't', 200), E'\n' order by x.n)
      into v_hist from (select t.h, t.n from public.bot_sessions s, jsonb_array_elements(s.history) with ordinality t(h, n)
                        where s.customer_id = p_customer_id order by t.n desc limit 6) x;
    select string_agg(format('#%s %s $%s', o.code, o.status, to_char(o.total_usd, 'FM999990.00')), ' · ' order by o.created_at desc)
      into v_orders from (select * from public.orders o where o.customer_id = p_customer_id order by o.created_at desc limit 3) o;
    perform app_private.slack_post('support', 'case:' || v_id,
      format(E'🙋 %s needs a person (%s)\n%s%s%s',
        coalesce(v_c.display_name, 'A customer'), coalesce(v_c.language::text, '?'),
        '*Why:* ' || left(coalesce(p_summary, p_reason), 400),
        coalesce(E'\n*Orders:* ' || v_orders, ''),
        coalesce(E'\n*Last messages:*\n' || v_hist, '')) || E'\nReply in this thread to answer on WhatsApp as Rasheed.',
      jsonb_build_array(jsonb_build_object('action_id', 'case_resolve', 'text', 'Resolve', 'value', v_id::text, 'style', 'primary')),
      'case:' || v_id || ':open');
  end if;
  return v_id;
end;
$$;

-- customer_handoff (as in 20261012180000) with the case: the owner's WhatsApp note stays as the fallback while Slack is not
-- installed, and a simulator customer gets the case and the thread too (that is what the e2e handoff scenario checks).
create or replace function public.customer_handoff(p_customer_id uuid, p_reason text, p_summary text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric := public.config_numeric('handoff_minutes');
  v_phone text;
  v_owner record;
  v_case uuid;
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
  v_case := app_private.support_case_open(p_customer_id, p_reason, p_summary);
  select c.phone_e164 into v_phone from public.customers c where c.id = p_customer_id;
  if app_private.is_sim_phone(v_phone) or exists (select 1 from app_private.slack_channels where key = 'support') then
    -- A simulator customer (§36), or Slack is installed: the case thread is the record and the place to answer.
    return jsonb_build_object('status', 'handed_off', 'support_open', v_open, 'case_id', v_case);
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
  return jsonb_build_object('status', 'handed_off', 'support_open', v_open, 'case_id', v_case);
end;
$$;

-- A customer message while their case is open joins the thread (dispatch calls it during a handoff).
create function public.support_inbound(p_customer_id uuid, p_text text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_case uuid := (select id from public.support_cases where customer_id = p_customer_id and status = 'open');
begin
  if v_case is null or nullif(trim(coalesce(p_text, '')), '') is null then
    return false;
  end if;
  insert into public.support_messages (case_id, direction, body, status) values (v_case, 'in', left(p_text, 2000), 'received');
  perform app_private.slack_post('support', 'case:' || v_case, '› ' || left(p_text, 1500));
  return true;
end;
$$;

-- An operator's reply (a Slack thread reply, or "reply …" on WhatsApp): queued to the customer as "Rasheed, Alo King";
-- the bot stays quiet while a person is talking (the handoff is extended).
create function public.support_reply(p_case_id uuid, p_actor_id uuid, p_text text, p_source text default 'slack',
  p_ref text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
  v_c public.customers%rowtype;
  v_msg bigint;
  v_name text := (select o.display_name from public.operators o where o.user_id = p_actor_id and o.active);
begin
  if v_name is null then
    raise exception 'not allowed: an active operator answers support' using errcode = 'insufficient_privilege';
  end if;
  select * into v_case from public.support_cases where id = p_case_id;
  if v_case.id is null or v_case.status <> 'open' then
    return jsonb_build_object('status', 'not_open');
  end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then
    return jsonb_build_object('status', 'empty');
  end if;
  select * into v_c from public.customers where id = v_case.customer_id;
  insert into public.support_messages (case_id, direction, body, operator_user_id, ref)
  values (p_case_id, 'out', left(trim(p_text), 2000), p_actor_id, nullif(left(p_ref, 200), ''))
  on conflict (ref) do nothing
  returning id into v_msg;
  if v_msg is null then
    return jsonb_build_object('status', 'duplicate');
  end if;
  update public.bot_sessions set handoff_until = greatest(coalesce(handoff_until, now()), now() + make_interval(mins => public.config_numeric('handoff_minutes')::int))
  where customer_id = v_case.customer_id;
  perform app_private.outbox_add('support:' || v_msg, null, null, 'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', 'support_reply', 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id,
      'message_id', v_msg, 'name', v_name, 'text', left(trim(p_text), 2000)));
  -- A WhatsApp reply is already audited by its confirmed ops_actions proposal.
  if coalesce(p_source, 'slack') <> 'whatsapp' then
    perform app_private.ops_log(p_actor_id, coalesce(p_source, 'slack'), 'support_reply',
      jsonb_build_object('case_id', p_case_id, 'message_id', v_msg), '{}');
  end if;
  return jsonb_build_object('status', 'queued', 'message_id', v_msg);
end;
$$;

-- dispatch reports how a reply went: free-form (sent) or the template (held until the customer taps it).
create function public.support_message_status(p_message_id bigint, p_status text) returns void
language sql security definer set search_path = ''
as $$
  update public.support_messages set status = p_status where id = p_message_id and direction = 'out' and p_status in ('sent', 'held');
$$;

-- The customer tapped "Read the reply" on the template: the held replies, oldest first, marked shown.
create function public.support_pending(p_customer_id uuid) returns jsonb
language sql security definer set search_path = ''
as $$
  with h as (
    update public.support_messages m set status = 'shown'
    from public.support_cases c
    where c.id = m.case_id and c.customer_id = p_customer_id and m.direction = 'out' and m.status = 'held'
    returning m.id, m.body, (select o.display_name from public.operators o where o.user_id = m.operator_user_id) as name)
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'text', body) order by id), '[]') from h;
$$;

create function public.support_resolve(p_case_id uuid, p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_case public.support_cases%rowtype;
  v_c public.customers%rowtype;
begin
  if app_private.operator_role(p_actor_id) is null then
    raise exception 'not allowed: an active operator resolves support' using errcode = 'insufficient_privilege';
  end if;
  update public.support_cases set status = 'resolved', resolved_at = now(), resolved_by = p_actor_id
  where id = p_case_id and status = 'open' returning * into v_case;
  if v_case.id is null then
    return jsonb_build_object('status', 'not_open');
  end if;
  perform public.customer_handoff_end(v_case.customer_id);
  select * into v_c from public.customers where id = v_case.customer_id;
  perform app_private.outbox_add('support-closed:' || v_case.id, null, null, 'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', 'support_closed', 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id));
  perform app_private.slack_post('support', 'case:' || v_case.id, '✅ Resolved by '
    || coalesce((select display_name from public.operators where user_id = p_actor_id), 'an operator') || '; the assistant is back.');
  insert into public.ops_actions (operator_user_id, source, action, args, status, result, decided_at)
  values (p_actor_id, 'slack', 'support_resolve', jsonb_build_object('case_id', p_case_id), 'done', '{}', now());
  return jsonb_build_object('status', 'resolved');
end;
$$;

-- The case behind a #support thread (the ops-slack function maps a thread reply to its case).
create function public.support_case_for_thread(p_ts text) returns uuid
language sql stable security definer set search_path = ''
as $$
  select substr(t.thread_key, 6)::uuid from app_private.slack_threads t where t.ts = p_ts and t.thread_key like 'case:%';
$$;

-- 4. The order recovery engine ------------------------------------------------------------------------------------------------
create table public.order_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('no_ack', 'late_ready', 'late_delivery', 'customer_unreached')),
  status text not null default 'open' check (status in ('open', 'closed')),
  -- The rule's recovery and one next action per person (merchant, operator, customer), in plain words.
  recovery text not null,
  next_action jsonb not null default '{}' check (jsonb_typeof(next_action) = 'object'),
  human_needed boolean not null default false,
  alert_id bigint references public.ops_alerts (id) on delete set null,
  detected_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text
);
create unique index order_exceptions_one_open on public.order_exceptions (order_id, kind) where status = 'open';
alter table public.order_exceptions enable row level security;
revoke all on table public.order_exceptions from public, anon, authenticated;
grant all on table public.order_exceptions to service_role;
grant select on table public.order_exceptions to authenticated;
create policy order_exceptions_operator_read on public.order_exceptions for select to authenticated using ((select app_private.is_operator()));

create function app_private.order_exception_open(p_order_id uuid, p_kind text, p_recovery text, p_next jsonb, p_human boolean, p_summary text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_alert bigint;
begin
  insert into public.order_exceptions (order_id, kind, recovery, next_action, human_needed)
  values (p_order_id, p_kind, p_recovery, p_next, p_human)
  on conflict (order_id, kind) where status = 'open' do nothing
  returning id into v_id;
  if v_id is null then
    -- Already open: a recovery that now needs a person raises its alert once.
    select id into v_id from public.order_exceptions where order_id = p_order_id and kind = p_kind and status = 'open';
    if p_human and not (select human_needed from public.order_exceptions where id = v_id) then
      update public.order_exceptions set human_needed = true, next_action = next_action || p_next where id = v_id;
    else
      return v_id;
    end if;
  end if;
  if p_human then
    v_alert := app_private.ops_alert('exception:' || v_id, 'order_exception', 'urgent', left(p_summary, 300), p_order_id,
      (select vendor_id from public.orders where id = p_order_id), jsonb_build_object('exception_id', v_id, 'kind', p_kind));
    update public.order_exceptions set alert_id = coalesce(v_alert, alert_id) where id = v_id;
  end if;
  return v_id;
end;
$$;

-- One pass of the rules, then the verified close: an exception closes only when its condition no longer holds. The state
-- sets cover every active status: not ready yet = accepted, preparing, driver_assigned, heading_to_pickup or at_pickup with
-- no Ready tap; on the road = picked_up, near_drop, arrived. One row that fails never stops the others (ops alert instead).
create function app_private.recovery_tick() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := public.config_value('recovery_rules');
  c_waiting constant public.order_status[] := array['accepted', 'preparing', 'driver_assigned', 'heading_to_pickup', 'at_pickup'];
  c_road constant public.order_status[] := array['picked_up', 'near_drop', 'arrived'];
  c_active constant public.order_status[] := array['accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup',
                                                   'picked_up', 'near_drop', 'arrived'];
  o record;
  e record;
  n integer := 0;
  v_still boolean;
begin
  perform set_config('app.actor_kind', 'system', true);
  -- No acknowledgement after 60 s: urgent in Slack (the 75 s operator layer of §23 still runs after it). The shop's number
  -- stays in the admin page, not in Slack.
  for o in select x.id, x.code, v.name_en, v.name_ar
           from public.orders x join public.vendors v on v.id = x.vendor_id
           where x.status = 'placed' and x.acknowledged_at is null
             and x.placed_at < now() - make_interval(secs => (r ->> 'no_ack_s')::int) and x.placed_at > now() - interval '1 hour' loop
    begin
      perform app_private.order_exception_open(o.id, 'no_ack', 'escalation continues (backup, call, operator)',
        jsonb_build_object('merchant', 'tap Accept on the order card', 'operator', 'call the shop'), true,
        format('#%s: %s has not acknowledged after %s s. Call the shop (number in the admin page).', o.code,
               coalesce(o.name_en, o.name_ar), r ->> 'no_ack_s'));
      n := n + 1;
    exception when others then
      perform app_private.recovery_failed(o.id, 'no_ack', sqlstate, sqlerrm);
    end;
  end loop;
  -- Not ready after the promised prep time: the ready-check card to the shop (the same one order_monitor sends, so the shop
  -- gets it once), a person after more minutes.
  for o in select x.id, x.code, x.vendor_id, x.accepted_at + make_interval(mins => coalesce(x.prep_minutes, 30)) as due
           from public.orders x
           where x.status = any (c_waiting) and x.ready_marked_at is null
             and x.accepted_at + make_interval(mins => coalesce(x.prep_minutes, 30) + (r ->> 'late_ready_grace_min')::int) < now() loop
    begin
      perform app_private.order_exception_open(o.id, 'late_ready', 'ready-check card to the shop',
        jsonb_build_object('merchant', 'tap Ready, or set a new time'), o.due + make_interval(mins => (r ->> 'late_ready_human_min')::int) < now(),
        format('#%s is %s min past its promised time and not ready', o.code, round(extract(epoch from now() - o.due) / 60)));
      perform app_private.outbox_add('ready_check:' || o.id, o.id, o.vendor_id, 'whatsapp', 'ready_check',
        (select c.backup_target from app_private.vendor_channels(o.vendor_id) c), jsonb_build_object('order_id', o.id, 'code', o.code));
      n := n + 1;
    exception when others then
      perform app_private.recovery_failed(o.id, 'late_ready', sqlstate, sqlerrm);
    end;
  end loop;
  -- On the road too long: a person calls the driver.
  for o in select x.id, x.code from public.orders x
           where x.status = any (c_road) and x.picked_up_at < now() - make_interval(mins => (r ->> 'late_delivery_min')::int) loop
    begin
      perform app_private.order_exception_open(o.id, 'late_delivery', 'operator calls the driver',
        jsonb_build_object('operator', 'call the driver', 'customer', 'told the order is on its way'), true,
        format('#%s has been on the road over %s min', o.code, r ->> 'late_delivery_min'));
      n := n + 1;
    exception when others then
      perform app_private.recovery_failed(o.id, 'late_delivery', sqlstate, sqlerrm);
    end;
  end loop;
  -- A status message to the customer failed on an active order.
  for o in select distinct x.id, x.code from public.orders x join public.outbound_messages m on m.order_id = x.id
           where x.status = any (c_active) and m.purpose = 'customer_message' and m.status = 'failed'
             and m.created_at > now() - interval '2 hours' loop
    begin
      perform app_private.order_exception_open(o.id, 'customer_unreached', 'a person reaches the customer',
        jsonb_build_object('operator', 'message or call the customer'), true,
        format('#%s: a status message did not reach the customer', o.code));
      n := n + 1;
    exception when others then
      perform app_private.recovery_failed(o.id, 'customer_unreached', sqlstate, sqlerrm);
    end;
  end loop;
  -- Verified close: the same conditions, re-checked on the order.
  for e in select x.*, ord.status as order_status, ord.acknowledged_at, ord.ready_marked_at, ord.code
           from public.order_exceptions x join public.orders ord on ord.id = x.order_id
           where x.status = 'open' loop
    begin
      v_still := case e.kind
        when 'no_ack' then e.order_status = 'placed' and e.acknowledged_at is null
        when 'late_ready' then e.order_status = any (c_waiting) and e.ready_marked_at is null
        when 'late_delivery' then e.order_status = any (c_road)
        when 'customer_unreached' then e.order_status = any (c_active) end;
      if not v_still then
        update public.order_exceptions set status = 'closed', closed_at = now(), close_reason = 'order ' || e.order_status
        where id = e.id;
        if e.alert_id is not null then
          -- In the alert's own thread (ops_alerts_to_slack threads an order's urgent alert as alert:<id>).
          perform app_private.slack_post('urgent', 'alert:' || e.alert_id,
            format('✅ #%s %s cleared: order %s', e.code, e.kind, e.order_status), '[]', 'exception-closed:' || e.id);
          update public.ops_alerts set status = 'resolved', resolved_at = now() where id = e.alert_id and status <> 'resolved';
        end if;
      end if;
    exception when others then
      perform app_private.recovery_failed(e.order_id, 'close', sqlstate, sqlerrm);
    end;
  end loop;
  -- Old Slack rows (posted or given up) are pruned.
  delete from public.slack_messages where status in ('sent', 'failed') and created_at < now() - make_interval(days => (r ->> 'slack_keep_days')::int);
  return n;
end;
$$;

-- A recovery step that failed for one order: an alert (once per order and step per hour), never a stalled engine.
create function app_private.recovery_failed(p_order_id uuid, p_step text, p_state text, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_alert('recovery-failed:' || p_step || ':' || p_order_id || ':' || to_char(now(), 'YYYYMMDDHH24'),
    'order_exception', 'warning', format('Recovery %s failed for an order (%s: %s)', p_step, p_state, left(p_error, 200)),
    p_order_id, null);
exception when others then
  null; -- the alert itself must never stop the tick
end;
$$;
revoke all on function app_private.recovery_failed(uuid, text, text, text) from public, anon, authenticated;
select cron.schedule('recovery-tick', '15 seconds', $$select app_private.recovery_tick()$$);

-- 5. Operator actions (Slack commands and buttons, WhatsApp admin commands) ---------------------------------------------------
create function app_private.ops_require(p_actor_id uuid, p_admin boolean default false) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := app_private.operator_role(p_actor_id);
begin
  if v_role is null or (p_admin and v_role <> 'admin') then
    raise exception 'not allowed: %', case when p_admin then 'only the admin' else 'an active operator' end using errcode = 'insufficient_privilege';
  end if;
  return v_role;
end;
$$;

create function app_private.ops_log(p_actor_id uuid, p_source text, p_action text, p_args jsonb, p_result jsonb) returns void
language sql security definer set search_path = ''
as $$
  insert into public.ops_actions (operator_user_id, source, action, args, status, result, decided_at)
  values (p_actor_id, coalesce(p_source, 'slack'), p_action, coalesce(p_args, '{}'), 'done', p_result, now());
$$;

-- /ak order <code>: lifecycle, money and audit trail (no customer phone or address).
create function public.ops_order(p_actor_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
begin
  perform app_private.ops_require(p_actor_id);
  select * into v_o from public.orders where code = upper(trim(p_code));
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  return jsonb_build_object('status', 'ok', 'order_id', v_o.id, 'code', v_o.code, 'order_status', v_o.status,
    'vendor', (select coalesce(name_en, name_ar) from public.vendors where id = v_o.vendor_id),
    'fulfilment', v_o.fulfilment, 'payment', v_o.payment_method, 'total_usd', v_o.total_usd, 'total_lbp', v_o.total_lbp,
    'placed_at', v_o.placed_at,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'from', e.from_status, 'to', e.to_status, 'by', e.actor_kind) order by e.at), '[]')
               from public.order_events e where e.order_id = v_o.id),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'status', x.status, 'recovery', x.recovery)), '[]')
                   from public.order_exceptions x where x.order_id = v_o.id));
end;
$$;

-- /ak merchant <name>: status of the best matches.
create function public.ops_merchant(p_actor_id uuid, p_query text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  return (select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object('vendor_id', v.id, 'name', coalesce(v.name_en, v.name_ar), 'claimed', v.claim_status = 'claimed',
      'orderable', v.orderable, 'paused_until', v.paused_until, 'is_test', v.is_test,
      'orders_today', (select count(*) from public.orders o where o.vendor_id = v.id and o.created_at > date_trunc('day', now()))) as x
    from public.vendors v
    where coalesce(v.name_en, '') ilike '%' || trim(p_query) || '%' or coalesce(v.name_ar, '') ilike '%' || trim(p_query) || '%'
    order by v.claim_status = 'claimed' desc, v.orderable desc limit 5) q);
end;
$$;

create function public.ops_merchant_pause(p_actor_id uuid, p_vendor_id uuid, p_minutes integer, p_source text default 'slack') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_until timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 5), 24 * 60));
begin
  perform app_private.ops_require(p_actor_id);
  perform set_config('app.actor_kind', 'operator', true);
  perform app_private.vendor_set_pause(p_vendor_id, v_until, 'paused by an operator', 'pause');
  perform app_private.ops_log(p_actor_id, p_source, 'merchant_pause', jsonb_build_object('vendor_id', p_vendor_id, 'until', v_until), '{}');
  return jsonb_build_object('status', 'paused', 'until', v_until);
end;
$$;

create function public.ops_merchant_resume(p_actor_id uuid, p_vendor_id uuid, p_source text default 'slack') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r jsonb;
begin
  perform app_private.ops_require(p_actor_id);
  perform set_config('app.actor_kind', 'operator', true);
  v_r := app_private.vendor_reactivate(p_vendor_id, null);
  perform app_private.ops_log(p_actor_id, p_source, 'merchant_resume', jsonb_build_object('vendor_id', p_vendor_id), v_r);
  return v_r;
end;
$$;

-- /ak claim: the queue.
create function public.ops_claims(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.id, 'vendor', coalesce(v.name_en, v.name_ar), 'status', c.status,
      'created_at', c.created_at) order by c.created_at), '[]')
    from public.vendor_claims c join public.vendors v on v.id = c.vendor_id
    where c.status in ('pending_review', 'awaiting_documents', 'objection_window'));
end;
$$;

create function public.ops_claim_decide(p_actor_id uuid, p_claim_id uuid, p_approve boolean, p_source text default 'slack') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r jsonb;
begin
  perform app_private.ops_require(p_actor_id);
  v_r := app_private.claim_decide_as(p_claim_id, p_approve, 'decided from ' || coalesce(p_source, 'slack'), p_actor_id);
  perform app_private.ops_log(p_actor_id, p_source, case when p_approve then 'claim_approve' else 'claim_reject' end,
    jsonb_build_object('claim_id', p_claim_id), v_r);
  return v_r;
end;
$$;

-- dispute_decide as in 20261015120100, with one fix: it booked through public.dispute_book, which never existed (the
-- function is app_private.dispute_book), so an operator's approval failed. Operator refunds below go through it.
create or replace function public.dispute_decide(p_dispute_id uuid, p_approve boolean, p_actor_id uuid, p_amount_usd numeric default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.order_disputes%rowtype;
  v_amount numeric;
  v_role text := app_private.operator_role(p_actor_id);
  v_max numeric;
begin
  if v_role is null then
    raise exception 'not allowed: an active operator decides disputes' using errcode = 'insufficient_privilege';
  end if;
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  if v_d.id is null or v_d.decision not in ('review', 'owner_review') then
    return jsonb_build_object('status', 'not_open');
  end if;
  v_amount := coalesce(p_amount_usd, v_d.amount_usd);
  select coalesce((select i.line_total_usd from public.order_items i where i.id = v_d.order_item_id), o.total_usd)
    into v_max from public.orders o where o.id = v_d.order_id;
  if v_amount < 0 or v_amount > v_max then
    return jsonb_build_object('status', 'invalid', 'max_usd', v_max);
  end if;
  if p_approve and v_amount > (public.config_value('dispute_rules') ->> 'owner_over_usd')::numeric and v_role <> 'admin' then
    raise exception 'not allowed: over the owner limit' using errcode = 'insufficient_privilege';
  end if;
  update public.order_disputes set decision = case when p_approve then 'approved' else 'rejected' end,
    amount_usd = v_amount, payer = coalesce(payer, 'alo_king'), decided_by = p_actor_id, decided_at = now()
  where id = v_d.id;
  if p_approve and v_amount > 0 then
    return app_private.dispute_book(v_d.id) || jsonb_build_object('decision', 'approved');
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

-- /ak refund <order> <amount> [shop]: a customer credit for the next order (COD pilot: there is no card to refund to). It is
-- an operator dispute on the order, decided by dispute_decide and booked by dispute_book like every other dispute (§20):
-- the payer is Alo King unless the operator says the shop caused it (§20.1), the credit expires back to whoever funded
-- it, the admin limit is dispute_rules.owner_over_usd, and all credits on an order together never exceed its total.
-- One operator refund per order (the disputes' one-per-line index), so a repeated or retried confirm books nothing twice.
create function public.ops_refund(p_actor_id uuid, p_code text, p_amount_usd numeric, p_source text default 'slack',
  p_payer text default 'alo_king') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_d public.order_disputes%rowtype;
  v_given numeric;
  v_r jsonb;
begin
  perform app_private.ops_require(p_actor_id);
  if p_source = 'whatsapp' and p_amount_usd > public.config_numeric('whatsapp_admin_refund_max_usd') then
    raise exception 'refunds by WhatsApp are at most $%', public.config_numeric('whatsapp_admin_refund_max_usd') using errcode = 'check_violation';
  end if;
  if coalesce(p_payer, '') not in ('alo_king', 'merchant') then
    raise exception 'the payer is alo_king or merchant' using errcode = 'check_violation';
  end if;
  select * into v_o from public.orders where code = upper(trim(p_code)) for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or round(p_amount_usd, 2) <> p_amount_usd then
    raise exception 'the amount must be positive and in cents' using errcode = 'check_violation';
  end if;
  select * into v_d from public.order_disputes
  where order_id = v_o.id and kind = 'other' and order_item_id is null for update;
  if v_d.id is not null and v_d.decision not in ('review', 'owner_review') then
    return jsonb_build_object('status', 'already', 'code', v_o.code, 'amount_usd', v_d.amount_usd, 'decision', v_d.decision);
  end if;
  select coalesce(sum(d.amount_usd), 0) into v_given from public.order_disputes d
  where d.order_id = v_o.id and d.decision in ('auto_credit', 'approved') and d.ledger_tx is not null;
  if v_given + p_amount_usd > v_o.total_usd then
    raise exception 'credits on order % would exceed its total ($% already, $% total)', v_o.code, v_given, v_o.total_usd
      using errcode = 'check_violation';
  end if;
  if v_d.id is null then
    insert into public.order_disputes (order_id, customer_id, kind, amount_usd, payer, decision, rule)
    values (v_o.id, v_o.customer_id, 'other', p_amount_usd, p_payer, 'review', 'operator ' || coalesce(p_source, 'slack'))
    returning * into v_d;
  else
    update public.order_disputes set payer = p_payer, amount_usd = p_amount_usd where id = v_d.id;
  end if;
  v_r := public.dispute_decide(v_d.id, true, p_actor_id, p_amount_usd);
  perform app_private.ops_log(p_actor_id, p_source, 'refund',
    jsonb_build_object('order_id', v_o.id, 'amount_usd', p_amount_usd, 'payer', p_payer, 'dispute_id', v_d.id), v_r);
  return jsonb_build_object('status', case when v_r ->> 'status' = 'booked' then 'credited' else v_r ->> 'status' end,
    'code', v_o.code, 'amount_usd', p_amount_usd, 'payer', p_payer, 'credit_id', v_r ->> 'credit_id');
end;
$$;

-- /ak credit <merchant> <amount> <reason>: Alo King Credit for a merchant (§20.3 admin credit: promotions, compensation),
-- a ledger transaction with a reason; above ops_money_confirm_usd only the admin, never above ops_credit_max_usd. The
-- confirm modal's view id is the idempotency key, so a confirm Slack retries books once.
create function public.ops_credit(p_actor_id uuid, p_vendor_id uuid, p_amount_usd numeric, p_reason text, p_source text default 'slack',
  p_key text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tx uuid;
  v_new boolean;
  v_key text := 'ops-credit:' || coalesce(nullif(left(p_key, 120), ''), gen_random_uuid()::text);
begin
  perform app_private.ops_require(p_actor_id, p_amount_usd > public.config_numeric('ops_money_confirm_usd'));
  if p_amount_usd is null or p_amount_usd <= 0 or round(p_amount_usd, 2) <> p_amount_usd
     or p_amount_usd > public.config_numeric('ops_credit_max_usd') then
    raise exception 'the amount must be positive, in cents, and at most $%', public.config_numeric('ops_credit_max_usd') using errcode = 'check_violation';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a credit needs a reason' using errcode = 'check_violation';
  end if;
  v_new := not exists (select 1 from public.ledger_transactions t where t.idempotency_key = v_key);
  v_tx := public.ledger_post('admin_adjustment', v_key,
    jsonb_build_array(
      jsonb_build_object('account_id', public.ledger_account('expense_refunds', 'USD'), 'amount', p_amount_usd, 'memo', left(trim(p_reason), 200)),
      jsonb_build_object('account_id', public.ledger_account('merchant_credit', 'USD', p_vendor_id), 'amount', -p_amount_usd,
        'memo', 'Alo King Credit: ' || left(trim(p_reason), 180))),
    null, public.usd_lbp_rate(now()), 'operator credit: ' || left(trim(p_reason), 200));
  if v_new then
    perform app_private.ops_log(p_actor_id, p_source, 'merchant_credit',
      jsonb_build_object('vendor_id', p_vendor_id, 'amount_usd', p_amount_usd, 'reason', left(trim(p_reason), 200)), jsonb_build_object('ledger_tx', v_tx));
  end if;
  return jsonb_build_object('status', case when v_new then 'credited' else 'already' end, 'amount_usd', p_amount_usd);
end;
$$;

-- /ak place on|off <place>: the admin switches a place in or out of service (a paused place needs a reason).
create function public.ops_place(p_actor_id uuid, p_query text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p record;
begin
  perform app_private.ops_require(p_actor_id, true);
  select p.id, p.name_en into v_p from public.places p
  where p.id = trim(p_query) or p.name_en ilike trim(p_query) or p.name_ar = trim(p_query)
  order by (p.id = trim(p_query)) desc limit 1;
  if v_p.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  -- This definer function runs as its owner, which place_set_service_status accepts; ops_actions records the operator.
  perform public.place_set_service_status(v_p.id, case when p_on then 'on' else 'paused' end::public.service_status,
    case when p_on then null else 'switched off by an operator from Slack' end);
  perform app_private.ops_log(p_actor_id, 'slack', case when p_on then 'place_on' else 'place_off' end, jsonb_build_object('place_id', v_p.id), '{}');
  return jsonb_build_object('status', case when p_on then 'on' else 'paused' end, 'place', v_p.name_en);
end;
$$;

-- /ak finance: the §30.3.4 snapshot from the ledger balances (read-only).
create function public.ops_finance(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  return (select jsonb_object_agg(kind, total) from (
    select b.kind::text as kind, round(sum(b.balance), 2) as total
    from public.ledger_account_balances b
    where b.currency = 'USD' group by b.kind) x);
end;
$$;

create function public.ops_alert_ack(p_actor_id uuid, p_alert_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  update public.ops_alerts set status = 'acknowledged', acknowledged_by = p_actor_id, acknowledged_at = now()
  where id = p_alert_id and status = 'open';
  perform app_private.ops_log(p_actor_id, 'slack', 'alert_ack', jsonb_build_object('alert_id', p_alert_id), '{}');
  return jsonb_build_object('status', case when found then 'acknowledged' else 'unchanged' end);
end;
$$;

-- /ak driver <name>: merchant drivers by name and their active orders (the fleet comes in session 8).
create function public.ops_driver(p_actor_id uuid, p_query text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'vendor', coalesce(v.name_en, v.name_ar),
      'active_orders', (select coalesce(jsonb_agg(o.code), '[]') from public.orders o where o.driver_member_id = m.id and o.status in ('accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup', 'picked_up', 'near_drop', 'arrived')))), '[]')
    from public.vendor_members m join public.vendors v on v.id = m.vendor_id
    where m.role = 'driver' and m.status = 'active' and coalesce(m.display_name, '') ilike '%' || trim(p_query) || '%');
end;
$$;

-- WhatsApp admin commands (§32.1 mobile fallback): proposed first, done on the confirming tap.
create function public.ops_action_propose(p_actor_id uuid, p_action text, p_args jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app_private.ops_require(p_actor_id);
  if p_action not in ('merchant_pause', 'merchant_resume', 'claim_approve', 'claim_reject', 'support_reply', 'refund') then
    raise exception 'unknown admin action %', p_action using errcode = 'invalid_parameter_value';
  end if;
  insert into public.ops_actions (operator_user_id, source, action, args) values (p_actor_id, 'whatsapp', p_action, coalesce(p_args, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.ops_action_decide(p_action_id uuid, p_actor_id uuid, p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.ops_actions%rowtype;
  v_r jsonb;
begin
  select * into v_a from public.ops_actions where id = p_action_id for update;
  if v_a.id is null or v_a.operator_user_id <> p_actor_id then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_a.status <> 'proposed' then
    return jsonb_build_object('status', 'already_' || v_a.status);
  end if;
  if v_a.created_at < now() - interval '10 minutes' then
    update public.ops_actions set status = 'expired', decided_at = now() where id = v_a.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not p_confirm then
    update public.ops_actions set status = 'cancelled', decided_at = now() where id = v_a.id;
    return jsonb_build_object('status', 'cancelled');
  end if;
  begin
    v_r := case v_a.action
      when 'merchant_pause' then public.ops_merchant_pause(p_actor_id, (v_a.args ->> 'vendor_id')::uuid, (v_a.args ->> 'minutes')::int, 'whatsapp')
      when 'merchant_resume' then public.ops_merchant_resume(p_actor_id, (v_a.args ->> 'vendor_id')::uuid, 'whatsapp')
      when 'claim_approve' then public.ops_claim_decide(p_actor_id, (v_a.args ->> 'claim_id')::uuid, true, 'whatsapp')
      when 'claim_reject' then public.ops_claim_decide(p_actor_id, (v_a.args ->> 'claim_id')::uuid, false, 'whatsapp')
      when 'support_reply' then public.support_reply((v_a.args ->> 'case_id')::uuid, p_actor_id, v_a.args ->> 'text', 'whatsapp')
      when 'refund' then public.ops_refund(p_actor_id, v_a.args ->> 'code', (v_a.args ->> 'amount_usd')::numeric, 'whatsapp') end;
  exception when insufficient_privilege or check_violation then
    update public.ops_actions set status = 'refused', decided_at = now(), result = jsonb_build_object('error', left(sqlerrm, 200)) where id = v_a.id;
    return jsonb_build_object('status', 'refused', 'error', left(sqlerrm, 200));
  end;
  update public.ops_actions set status = 'done', decided_at = now(), result = v_r where id = v_a.id;
  return coalesce(v_r, '{}') || jsonb_build_object('status', 'done', 'action', v_a.action, 'result', v_r ->> 'status');
end;
$$;

-- "status" on WhatsApp: the day in one message.
create function public.ops_status(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  return jsonb_build_object(
    'orders_today', (select count(*) from public.orders where created_at > date_trunc('day', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut'),
    'active', (select count(*) from public.orders where status in ('placed', 'accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup', 'picked_up', 'near_drop', 'arrived')),
    'exceptions_open', (select count(*) from public.order_exceptions where status = 'open'),
    'cases_open', (select count(*) from public.support_cases where status = 'open'),
    'claims_waiting', (select count(*) from public.vendor_claims where status = 'pending_review'),
    -- The open cases a WhatsApp "reply" can go to: id, a short id to type, and the first name the customer gave.
    'open_cases', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'short', left(x.id::text, 4),
                     'name', coalesce(split_part(nullif(trim(c.display_name), ''), ' ', 1), 'customer')) order by x.opened_at desc), '[]')
                   from (select * from public.support_cases where status = 'open' order by opened_at desc limit 10) x
                   join public.customers c on c.id = x.customer_id));
end;
$$;

-- 6. "Open" outside the set hours (session 5 leftover): the reply says the hours check will close the shop again.
create function public.vendor_hours_after_resume(p_proposal_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('has_hours', exists (select 1 from public.vendor_hours h where h.vendor_id = p.vendor_id),
    'open_now', app_private.vendor_open_at(p.vendor_id), 'next_open', app_private.vendor_next_open(p.vendor_id))
  from public.merchant_proposals p where p.id = p_proposal_id;
$$;

-- Grants: everything here is for the service role (dispatch and ops-slack); operators read the tables through RLS.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.slack_channel_set(text, text, text)', 'public.ops_operator(text, text, text)', 'public.slack_claim(integer)',
    'public.slack_finish(bigint, boolean, text, text, text, boolean)', 'public.support_inbound(uuid, text)',
    'public.support_reply(uuid, uuid, text, text, text)', 'public.support_message_status(bigint, text)', 'public.support_pending(uuid)',
    'public.support_resolve(uuid, uuid)', 'public.support_case_for_thread(text)', 'public.ops_order(uuid, text)',
    'public.ops_merchant(uuid, text)', 'public.ops_merchant_pause(uuid, uuid, integer, text)', 'public.ops_merchant_resume(uuid, uuid, text)',
    'public.ops_claims(uuid)', 'public.ops_claim_decide(uuid, uuid, boolean, text)', 'public.ops_refund(uuid, text, numeric, text, text)',
    'public.ops_credit(uuid, uuid, numeric, text, text, text)', 'public.ops_place(uuid, text, boolean)', 'public.ops_finance(uuid)',
    'public.ops_alert_ack(uuid, bigint)', 'public.ops_driver(uuid, text)', 'public.ops_action_propose(uuid, text, jsonb)',
    'public.ops_action_decide(uuid, uuid, boolean)', 'public.ops_status(uuid)', 'public.vendor_hours_after_resume(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'app_private.slack_post(text, text, text, jsonb, text, bigint)', 'app_private.ops_alerts_to_slack()', 'app_private.orders_to_slack()',
    'app_private.support_case_open(uuid, text, text)', 'app_private.order_exception_open(uuid, text, text, jsonb, boolean, text)',
    'app_private.recovery_tick()', 'app_private.ops_require(uuid, boolean)', 'app_private.ops_log(uuid, text, text, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
