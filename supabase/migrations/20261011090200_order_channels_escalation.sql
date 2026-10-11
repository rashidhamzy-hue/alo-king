-- Phase 2, part 2 (DECISIONS §13, §23, §27.9, §29.4, §29.6, §30.2.1-30.2.2, §30.3.5): how merchants
-- receive orders and what happens when they do not answer.
--   * order_channel router: each vendor has a primary and a backup channel (portal, WhatsApp, call,
--     printer; email only as a copy). An order counts as received only when a channel acknowledges it.
--   * four-layer escalation on every order: primary at 0 s, backup at 15 s, automated cellular call at
--     45 s, operator at 75 s (config). A tick every 5 seconds moves each order one layer at a time.
--   * auto-pause after 3 orders in a row not acknowledged through all four layers (§30.2.2)
--   * outbound outbox the dispatch function drains (one row per message, deduplicated)
--   * ops alerts for the operator (Telegram, §30.3.5) and the monitoring tick of §27.5 for merchant mode
--   * merchant proposals: a pause, sold-out or price change proposed by rules or the AI applies only
--     after the merchant's confirming tap (§18.2, §29.4, §30.2.1)
--   * WhatsApp number quality and restriction events (§29.6)
-- No SQL from the reports is used (§30).

-- 1. Config ------------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §13, §23, §27.5, §30.2, 11 October 2026', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('escalation_backup_s', '15', '2026-10-11 00:00+03', 'Backup channel fires if the primary has not acknowledged (DECISIONS §13, §23)', null),
  ('escalation_call_s', '45', '2026-10-11 00:00+03', 'Automated cellular call to the owner mobile (DECISIONS §13, §23)', null),
  ('escalation_operator_s', '75', '2026-10-11 00:00+03', 'Operator steps in (DECISIONS §13: 75-90 s)', null),
  ('escalation_give_up_s', '300', '2026-10-11 00:00+03', 'No acknowledgement through all four layers: the order is cancelled with an apology (LOG 2026-10-11)', null),
  ('acceptance_alert_s', '90', '2026-10-11 00:00+03', 'Acknowledged but not accepted after this: operator alert (DECISIONS §13 90-second target)', null),
  ('auto_pause_missed_streak', '3', '2026-10-11 00:00+03', 'Orders in a row missed through all four layers before the merchant auto-pauses (DECISIONS §30.2.2)', null),
  ('channel_failures_per_hour', '3', '2026-10-11 00:00+03', 'Channel failures in an hour that switch a merchant to its backup for the day (DECISIONS §23.2 scenario 8)', null),
  ('monitor_not_ready_grace_s', '300', '2026-10-11 00:00+03', 'Merchant not ready this long after ready_at: "ready in?" ping (DECISIONS §27.5)', null),
  ('monitor_need_driver_s', '300', '2026-10-11 00:00+03', 'Ready and unassigned this long in merchant mode: "Need a driver?" (DECISIONS §27.4)', null),
  ('monitor_food_age_s', '2400', '2026-10-11 00:00+03', 'Food age after pickup that triggers the apology and an alert (DECISIONS §27.5)', null),
  ('monitor_arrived_s', '180', '2026-10-11 00:00+03', 'Arrived without delivered this long: customer live-location prompt (DECISIONS §27.5)', null),
  ('merchant_proposal_ttl_s', '900', '2026-10-11 00:00+03', 'A proposed merchant change not tapped within this expires', null),
  ('active_customer_number', '"customer"', '2026-10-11 00:00+03', 'Which number serves customers: customer (A) or standby (B) (DECISIONS §29.6)', null),
  ('voice_calls_enabled', 'false', '2026-10-11 00:00+03', 'Twilio voice layer stays off until the per-minute price to Lebanese mobiles is checked and the account exists (DECISIONS §13)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Channels ---------------------------------------------------------------------------------------------
create type public.order_channel_kind as enum ('portal', 'whatsapp', 'call', 'printer', 'email', 'deliverect', 'pos');
create type public.channel_role as enum ('primary', 'backup', 'copy');
create type public.dispatch_stage as enum ('primary', 'backup', 'call', 'operator', 'acknowledged', 'gave_up', 'closed');
create type public.outbox_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');
create type public.outbox_purpose as enum (
  'new_order', 'call', 'copy', 'order_cancelled', 'ready_check', 'need_driver', 'low_stock', 'driver_job',
  'proposal', 'reactivate', 'reply'
);
create type public.ops_alert_kind as enum (
  'merchant_not_answering', 'acknowledged_not_accepted', 'order_given_up', 'merchant_auto_paused',
  'channel_down', 'not_ready', 'food_age', 'arrived_not_delivered', 'number_quality', 'sos', 'money_incident',
  'cash_over_limit', 'partner_late', 'driver_requested'
);
create type public.ops_alert_status as enum ('open', 'acknowledged', 'resolved');
create type public.proposal_kind as enum ('pause', 'resume', 'sold_out', 'back_in_stock', 'price', 'stock_add');
create type public.proposal_status as enum ('proposed', 'confirmed', 'rejected', 'expired');

alter table public.vendors add column missed_orders_streak smallint not null default 0 check (missed_orders_streak >= 0);

-- A vendor's channels. Without rows the defaults apply: primary portal, backup WhatsApp to the kitchen
-- number (else the owner mobile), call to the owner mobile.
create table public.vendor_order_channels (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  channel public.order_channel_kind not null,
  role public.channel_role not null,
  -- E.164 phone for WhatsApp and call, printer id for CloudPRNT, address for email.
  target text check (char_length(target) <= 200),
  enabled boolean not null default true,
  -- Integration down (§23.2 scenario 8): use the backup until this time.
  use_backup_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_order_channels_email_copy check (channel <> 'email' or role = 'copy'),
  constraint vendor_order_channels_phone check (channel not in ('whatsapp', 'call') or target is null or target ~ '^\+[1-9][0-9]{6,14}$')
);
create unique index vendor_order_channels_one_per_role on public.vendor_order_channels (vendor_id, role)
  where role in ('primary', 'backup') and enabled;
create trigger vendor_order_channels_touch before update on public.vendor_order_channels
  for each row execute function app_private.touch_updated_at();
create trigger vendor_order_channels_audit after insert or update or delete on public.vendor_order_channels
  for each row execute function app_private.audit_row();

-- The channels in force for a vendor now.
create function app_private.vendor_channels(p_vendor_id uuid)
returns table (primary_channel public.order_channel_kind, primary_target text,
               backup_channel public.order_channel_kind, backup_target text, call_target text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_priv public.vendor_private%rowtype;
  v_primary public.vendor_order_channels%rowtype;
  v_backup public.vendor_order_channels%rowtype;
begin
  select * into v_priv from public.vendor_private where vendor_id = p_vendor_id;
  select * into v_primary from public.vendor_order_channels c where c.vendor_id = p_vendor_id and c.role = 'primary' and c.enabled;
  select * into v_backup from public.vendor_order_channels c where c.vendor_id = p_vendor_id and c.role = 'backup' and c.enabled;
  primary_channel := coalesce(v_primary.channel, 'portal');
  primary_target := v_primary.target;
  backup_channel := coalesce(v_backup.channel, 'whatsapp');
  backup_target := coalesce(v_backup.target, v_priv.kitchen_whatsapp, v_priv.owner_mobile);
  call_target := v_priv.owner_mobile;
  if primary_channel in ('whatsapp', 'call') and primary_target is null then
    primary_target := coalesce(v_priv.kitchen_whatsapp, v_priv.owner_mobile);
  end if;
  -- Integration down: the backup becomes primary for the rest of the day.
  if v_primary.use_backup_until is not null and v_primary.use_backup_until > now() then
    primary_channel := backup_channel;
    primary_target := backup_target;
  end if;
  if backup_channel = primary_channel and backup_target is not distinct from primary_target then
    backup_channel := null;
    backup_target := null;
  end if;
  return next;
end;
$$;
revoke all on function app_private.vendor_channels(uuid) from public;

-- 3. Dispatch state and outbox ------------------------------------------------------------------------
create table public.order_dispatch (
  order_id uuid primary key references public.orders (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  stage public.dispatch_stage not null default 'primary',
  started_at timestamptz not null default now(),
  primary_channel public.order_channel_kind not null,
  backup_channel public.order_channel_kind,
  backup_at timestamptz,
  call_at timestamptz,
  operator_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_via public.order_channel_kind,
  closed_at timestamptz
);
create index order_dispatch_open_idx on public.order_dispatch (started_at) where stage in ('primary', 'backup', 'call', 'operator', 'acknowledged');

create table public.outbound_messages (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 200),
  order_id uuid references public.orders (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete cascade,
  channel public.order_channel_kind not null,
  purpose public.outbox_purpose not null,
  -- Phone (E.164), printer id or email. Personal data: service role and operators only.
  target text,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  status public.outbox_status not null default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_ref text,
  last_error text check (char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_messages_queue_idx on public.outbound_messages (available_at) where status in ('queued', 'sending');
create index outbound_messages_order_idx on public.outbound_messages (order_id) where order_id is not null;
create index outbound_messages_failures_idx on public.outbound_messages (vendor_id, channel, created_at) where status = 'failed';

create function app_private.outbox_add(
  p_dedupe_key text,
  p_order_id uuid,
  p_vendor_id uuid,
  p_channel public.order_channel_kind,
  p_purpose public.outbox_purpose,
  p_target text,
  p_payload jsonb default '{}'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.outbound_messages (dedupe_key, order_id, vendor_id, channel, purpose, target, payload)
  values (p_dedupe_key, p_order_id, p_vendor_id, p_channel, p_purpose, p_target, coalesce(p_payload, '{}'))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  -- Wake the dispatch function now instead of at the next tick.
  if v_id is not null then
    perform pg_notify('outbox', v_id::text);
  end if;
  return v_id;
end;
$$;
revoke all on function app_private.outbox_add(text, uuid, uuid, public.order_channel_kind, public.outbox_purpose, text, jsonb) from public;

-- 4. Ops alerts -------------------------------------------------------------------------------------------
create table public.ops_alerts (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique check (char_length(dedupe_key) between 3 and 200),
  kind public.ops_alert_kind not null,
  severity text not null check (severity in ('info', 'warning', 'urgent')),
  order_id uuid references public.orders (id) on delete set null,
  vendor_id uuid references public.vendors (id) on delete set null,
  -- One line, no customer phone or address (it is sent to Telegram).
  summary text not null check (char_length(summary) between 3 and 300),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  status public.ops_alert_status not null default 'open',
  sent_at timestamptz,
  send_attempts integer not null default 0,
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index ops_alerts_open_idx on public.ops_alerts (created_at desc) where status <> 'resolved';
create index ops_alerts_unsent_idx on public.ops_alerts (created_at) where sent_at is null;

create function app_private.ops_alert(
  p_dedupe_key text,
  p_kind public.ops_alert_kind,
  p_severity text,
  p_summary text,
  p_order_id uuid default null,
  p_vendor_id uuid default null,
  p_detail jsonb default '{}'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.ops_alerts (dedupe_key, kind, severity, summary, order_id, vendor_id, detail)
  values (p_dedupe_key, p_kind, p_severity, left(p_summary, 300), p_order_id, p_vendor_id, coalesce(p_detail, '{}'))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform pg_notify('ops_alert', v_id::text);
  end if;
  return v_id;
end;
$$;
revoke all on function app_private.ops_alert(text, public.ops_alert_kind, text, text, uuid, uuid, jsonb) from public;

-- The operator acknowledges or resolves an alert from the admin page.
create function app_private.ops_alert_set_status(p_alert_id bigint, p_status public.ops_alert_status) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.is_operator() then
    raise exception 'operators only' using errcode = 'insufficient_privilege';
  end if;
  update public.ops_alerts set status = p_status,
    acknowledged_by = coalesce(acknowledged_by, (select auth.uid())),
    acknowledged_at = coalesce(acknowledged_at, now()),
    resolved_at = case when p_status = 'resolved' then now() else resolved_at end
  where id = p_alert_id;
end;
$$;
create function public.ops_alert_set_status(p_alert_id bigint, p_status public.ops_alert_status) returns void
language sql security invoker set search_path = ''
as $$ select app_private.ops_alert_set_status(p_alert_id, p_status) $$;

-- 5. Starting and closing the dispatch of an order --------------------------------------------------------
-- A short summary for cards and calls: no customer phone or exact address, broad area only (§23 card).
create function app_private.order_card_payload(p_order_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id, 'code', o.code, 'status', o.status, 'fulfilment', o.fulfilment,
    'payment_method', o.payment_method, 'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'), 'is_new_customer', o.is_new_customer,
    'customer_note', o.customer_note, 'prep_minutes', o.prep_minutes,
    'area_en', p.name_en, 'area_ar', p.name_ar,
    'vendor_name', coalesce(v.name_ar, v.name_en),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', i.name_en,
        'quantity', i.quantity, 'options', (select coalesce(jsonb_agg(coalesce(x ->> 'name_ar', x ->> 'name_en')), '[]') from jsonb_array_elements(i.options) x),
        'kg', i.est_weight_kg, 'has_empty', i.has_empty, 'note', i.note) order by i.created_at, i.id)
      from public.order_items i where i.order_id = o.id), '[]')
  )
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  left join public.places p on p.id = o.delivery_place_id
  where o.id = p_order_id;
$$;
revoke all on function app_private.order_card_payload(uuid) from public;

create function app_private.dispatch_start(p_order_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_ch record;
  v_copy record;
begin
  select * into v_order from public.orders where id = p_order_id;
  select * into v_ch from app_private.vendor_channels(v_order.vendor_id);
  insert into public.order_dispatch (order_id, vendor_id, primary_channel, backup_channel)
  values (p_order_id, v_order.vendor_id, v_ch.primary_channel, v_ch.backup_channel)
  on conflict (order_id) do nothing;
  if not found then
    return;
  end if;
  -- The portal is always alerted (its queue and alarm read the order itself); a non-portal primary also
  -- gets a message now.
  if v_ch.primary_channel <> 'portal' then
    perform app_private.outbox_add('order:' || p_order_id || ':primary', p_order_id, v_order.vendor_id,
      v_ch.primary_channel, case when v_ch.primary_channel = 'call' then 'call' else 'new_order' end::public.outbox_purpose,
      v_ch.primary_target);
  end if;
  for v_copy in
    select c.channel, c.target from public.vendor_order_channels c
    where c.vendor_id = v_order.vendor_id and c.role = 'copy' and c.enabled
  loop
    perform app_private.outbox_add('order:' || p_order_id || ':copy:' || v_copy.channel, p_order_id, v_order.vendor_id,
      v_copy.channel, 'copy', v_copy.target);
  end loop;
end;
$$;
revoke all on function app_private.dispatch_start(uuid) from public;

-- Fires the backup now (primary failed, or the 15 s timer). Idempotent through the dedupe key.
create function app_private.dispatch_fire_backup(p_order_id uuid, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.order_dispatch%rowtype;
  v_ch record;
begin
  select * into v_d from public.order_dispatch where order_id = p_order_id for update;
  if v_d.order_id is null or v_d.stage not in ('primary') then
    return false;
  end if;
  select * into v_ch from app_private.vendor_channels(v_d.vendor_id);
  if v_ch.backup_channel is not null then
    perform app_private.outbox_add('order:' || p_order_id || ':backup', p_order_id, v_d.vendor_id, v_ch.backup_channel,
      case when v_ch.backup_channel = 'call' then 'call' else 'new_order' end::public.outbox_purpose,
      v_ch.backup_target, jsonb_build_object('reason', p_reason));
  end if;
  update public.order_dispatch set stage = 'backup', backup_at = now() where order_id = p_order_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, channel, detail)
  values (p_order_id, 'placed', 'placed', 'escalation_backup', 'system', v_ch.backup_channel::text, jsonb_build_object('reason', p_reason));
  return true;
end;
$$;
revoke all on function app_private.dispatch_fire_backup(uuid, text) from public;

create function app_private.orders_dispatch_trigger() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'placed' and (tg_op = 'INSERT' or old.status is distinct from 'placed') then
    perform app_private.dispatch_start(new.id);
  elsif tg_op = 'UPDATE' and old.status = 'placed' and new.status <> 'placed' then
    update public.order_dispatch set
      stage = case when new.status = 'accepted' then 'acknowledged'::public.dispatch_stage
                   when stage = 'gave_up' then stage else 'closed'::public.dispatch_stage end,
      acknowledged_at = case when new.status = 'accepted' then coalesce(acknowledged_at, now()) else acknowledged_at end,
      closed_at = now()
    where order_id = new.id;
    -- Messages not yet sent for this order's alert are dropped.
    update public.outbound_messages set status = 'skipped', last_error = 'order ' || new.status
    where order_id = new.id and status = 'queued' and purpose in ('new_order', 'call');
    if new.status = 'accepted' then
      update public.vendors set missed_orders_streak = 0 where id = new.vendor_id and missed_orders_streak <> 0;
    end if;
    -- A merchant that already got the card hears that it was cancelled.
    if new.status = 'cancelled' and exists (
      select 1 from public.outbound_messages m where m.order_id = new.id and m.purpose = 'new_order' and m.channel = 'whatsapp' and m.status = 'sent'
    ) then
      perform app_private.outbox_add('order:' || new.id || ':cancelled', new.id, new.vendor_id, 'whatsapp', 'order_cancelled',
        (select m.target from public.outbound_messages m where m.order_id = new.id and m.purpose = 'new_order' and m.channel = 'whatsapp'
         and m.status = 'sent' order by m.id limit 1),
        jsonb_build_object('code', new.code, 'reason', new.cancel_reason));
    end if;
  elsif tg_op = 'UPDATE' and new.status in ('delivered', 'failed', 'rejected', 'cancelled') then
    update public.order_dispatch set stage = 'closed', closed_at = coalesce(closed_at, now())
    where order_id = new.id and stage <> 'closed' and stage <> 'gave_up';
  end if;
  return null;
end;
$$;
create trigger orders_dispatch after insert or update of status on public.orders
  for each row execute function app_private.orders_dispatch_trigger();

-- 6. Acknowledgement -----------------------------------------------------------------------------------------
-- Received = a channel acknowledged it (§23): the portal opened on the order, a WhatsApp button tap,
-- a call keypress, a printer job confirmed printed, or a POS acknowledgement. Stops the escalation.
create function app_private.order_acknowledge(
  p_order_id uuid,
  p_channel public.order_channel_kind,
  p_member_id uuid default null,
  p_provider_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  -- The printer and POS acknowledge as the server; people acknowledge as members.
  v_member := app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  if v_order.acknowledged_at is not null then
    return jsonb_build_object('status', 'already_acknowledged', 'via', v_order.acknowledged_via);
  end if;
  update public.orders set acknowledged_at = now(), acknowledged_via = p_channel::text where id = p_order_id;
  update public.order_dispatch set stage = case when stage in ('closed', 'gave_up') then stage else 'acknowledged' end,
    acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_via = coalesce(acknowledged_via, p_channel)
  where order_id = p_order_id;
  update public.vendors set missed_orders_streak = 0 where id = v_order.vendor_id and missed_orders_streak <> 0;
  update public.outbound_messages set status = 'skipped', last_error = 'acknowledged'
  where order_id = p_order_id and status = 'queued' and purpose in ('new_order', 'call');
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, channel, detail)
  values (p_order_id, v_order.status, v_order.status, 'acknowledged', app_private.current_actor_kind(), (select auth.uid()),
          p_channel::text, jsonb_build_object('member_id', v_member, 'provider_ref', p_provider_ref));
  return jsonb_build_object('status', 'acknowledged');
end;
$$;
create function public.order_acknowledge(
  p_order_id uuid,
  p_channel public.order_channel_kind,
  p_member_id uuid default null,
  p_provider_ref text default null
) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.order_acknowledge(p_order_id, p_channel, p_member_id, p_provider_ref) $$;

-- Accepting also acknowledges.
create function app_private.orders_ack_on_accept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'accepted' and old.status = 'placed' and new.acknowledged_at is null then
    new.acknowledged_at := now();
  end if;
  return new;
end;
$$;
create trigger orders_ack_on_accept before update of status on public.orders
  for each row execute function app_private.orders_ack_on_accept();

-- 7. Pause and auto-pause --------------------------------------------------------------------------------
create function app_private.vendor_set_pause(p_vendor_id uuid, p_until timestamptz, p_reason text, p_event text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_reason', coalesce(p_reason, p_event), true);
  update public.vendors set paused_until = p_until, pause_reason = case when p_until is null then null else left(p_reason, 200) end
  where id = p_vendor_id;
end;
$$;
revoke all on function app_private.vendor_set_pause(uuid, timestamptz, text, text) from public;

-- An order nobody acknowledged through all four layers. Counts toward the auto-pause (§30.2.2).
create function app_private.dispatch_give_up(p_order_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_streak integer;
  v_limit integer := public.config_numeric('auto_pause_missed_streak')::integer;
  v_other record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status <> 'placed' then
    return;
  end if;
  update public.order_dispatch set stage = 'gave_up', closed_at = now() where order_id = p_order_id;
  update public.orders set cancel_reason = 'merchant_unreachable' where id = p_order_id;
  perform app_private.order_set_status(p_order_id, 'cancelled', array['placed']::public.order_status[],
    'cancelled_merchant_unreachable', 'system', '{}');
  update public.vendors set missed_orders_streak = missed_orders_streak + 1 where id = v_order.vendor_id
  returning missed_orders_streak into v_streak;
  perform app_private.ops_alert('given_up:' || p_order_id, 'order_given_up', 'warning',
    'Order ' || v_order.code || ' cancelled: merchant did not answer through all four layers', p_order_id, v_order.vendor_id);

  if v_streak >= v_limit then
    perform app_private.vendor_set_pause(v_order.vendor_id, 'infinity', 'missed_orders', 'auto_pause');
    perform app_private.ops_alert('auto_pause:' || v_order.vendor_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), 'merchant_auto_paused', 'urgent',
      'Merchant auto-paused after ' || v_streak || ' missed orders in a row', null, v_order.vendor_id);
    perform app_private.outbox_add('reactivate:' || v_order.vendor_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), null, v_order.vendor_id,
      'whatsapp', 'reactivate', (select c.call_target from app_private.vendor_channels(v_order.vendor_id) c),
      jsonb_build_object('missed', v_streak));
    -- Its other waiting orders are cancelled; customers get apologies and alternatives (session 4 bot).
    for v_other in select o.id from public.orders o where o.vendor_id = v_order.vendor_id and o.status = 'placed' loop
      update public.orders set cancel_reason = 'merchant_paused' where id = v_other.id;
      perform app_private.order_set_status(v_other.id, 'cancelled', array['placed']::public.order_status[], 'cancelled_merchant_paused', 'system', '{}');
    end loop;
  end if;
end;
$$;
revoke all on function app_private.dispatch_give_up(uuid) from public;

-- The merchant's "🟢 Reactivate when ready" tap, or the dashboard's resume.
create function app_private.vendor_reactivate(p_vendor_id uuid, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager', 'cashier']::public.member_role[], p_member_id);
  perform app_private.vendor_set_pause(p_vendor_id, null, null, 'reactivate');
  update public.vendors set missed_orders_streak = 0 where id = p_vendor_id;
  return jsonb_build_object('status', 'active');
end;
$$;
create function public.vendor_reactivate(p_vendor_id uuid, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.vendor_reactivate(p_vendor_id, p_member_id) $$;

-- 8. The escalation tick (every 5 seconds) -------------------------------------------------------------------
create function app_private.order_escalation_tick() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backup numeric := public.config_numeric('escalation_backup_s');
  v_call numeric := public.config_numeric('escalation_call_s');
  v_operator numeric := public.config_numeric('escalation_operator_s');
  v_give_up numeric := public.config_numeric('escalation_give_up_s');
  v_accept_alert numeric := public.config_numeric('acceptance_alert_s');
  v_calls_on boolean := coalesce((public.config_value('voice_calls_enabled') #>> '{}')::boolean, false);
  v_d record;
  v_age numeric;
  v_ch record;
  v_moved integer := 0;
begin
  for v_d in
    select d.*, o.code, o.status as order_status
    from public.order_dispatch d join public.orders o on o.id = d.order_id
    where d.stage in ('primary', 'backup', 'call', 'operator', 'acknowledged') and o.status = 'placed'
    order by d.started_at
    for update of d skip locked
  loop
    v_age := extract(epoch from now() - v_d.started_at);
    if v_d.stage = 'acknowledged' then
      if v_age >= v_accept_alert then
        perform app_private.ops_alert('ack_not_accepted:' || v_d.order_id, 'acknowledged_not_accepted', 'warning',
          'Order ' || v_d.code || ' seen by the merchant but not accepted after ' || round(v_age) || ' s', v_d.order_id, v_d.vendor_id);
      end if;
      continue;
    end if;
    if v_d.stage = 'primary' and v_age >= v_backup then
      perform app_private.dispatch_fire_backup(v_d.order_id, 'timeout');
      v_moved := v_moved + 1;
    elsif v_d.stage = 'backup' and v_age >= v_call then
      select * into v_ch from app_private.vendor_channels(v_d.vendor_id);
      if v_calls_on and v_ch.call_target is not null then
        perform app_private.outbox_add('order:' || v_d.order_id || ':call', v_d.order_id, v_d.vendor_id, 'call', 'call',
          v_ch.call_target);
      end if;
      update public.order_dispatch set stage = 'call', call_at = now() where order_id = v_d.order_id;
      insert into public.order_events (order_id, from_status, to_status, event, actor_kind, channel, detail)
      values (v_d.order_id, 'placed', 'placed', 'escalation_call', 'system', 'call',
              jsonb_build_object('placed', v_calls_on and v_ch.call_target is not null));
      v_moved := v_moved + 1;
    elsif v_d.stage = 'call' and v_age >= v_operator then
      perform app_private.ops_alert('not_answering:' || v_d.order_id, 'merchant_not_answering', 'urgent',
        'Order ' || v_d.code || ' not acknowledged after ' || round(v_age) || ' s: phone the merchant', v_d.order_id, v_d.vendor_id);
      update public.order_dispatch set stage = 'operator', operator_at = now() where order_id = v_d.order_id;
      insert into public.order_events (order_id, from_status, to_status, event, actor_kind, channel, detail)
      values (v_d.order_id, 'placed', 'placed', 'escalation_operator', 'system', null, '{}');
      v_moved := v_moved + 1;
    elsif v_d.stage = 'operator' and v_age >= v_give_up then
      perform app_private.dispatch_give_up(v_d.order_id);
      v_moved := v_moved + 1;
    end if;
  end loop;

  -- Expired merchant proposals.
  update public.merchant_proposals set status = 'expired', decided_at = now() where status = 'proposed' and expires_at < now();
  return jsonb_build_object('moved', v_moved);
end;
$$;
revoke all on function app_private.order_escalation_tick() from public;

-- 9. The monitoring tick (every 15 seconds): §27.5 signals that apply in merchant mode -----------------------
create function app_private.order_monitor_tick() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_not_ready numeric := public.config_numeric('monitor_not_ready_grace_s');
  v_need_driver numeric := public.config_numeric('monitor_need_driver_s');
  v_food_age numeric := public.config_numeric('monitor_food_age_s');
  v_arrived numeric := public.config_numeric('monitor_arrived_s');
  v_o record;
  v_n integer := 0;
begin
  -- Not ready 5 minutes after ready_at: "ready in?" to the merchant (once per order).
  for v_o in
    select o.id, o.code, o.vendor_id from public.orders o
    where o.status in ('accepted', 'preparing') and o.ready_at + make_interval(secs => v_not_ready) < now()
  loop
    if app_private.outbox_add('ready_check:' || v_o.id, v_o.id, v_o.vendor_id, 'whatsapp', 'ready_check',
         (select c.backup_target from app_private.vendor_channels(v_o.vendor_id) c), jsonb_build_object('order_id', v_o.id, 'code', v_o.code)) is not null then
      perform app_private.ops_alert('not_ready:' || v_o.id, 'not_ready', 'info', 'Order ' || v_o.code || ' not ready 5 min after its ready time', v_o.id, v_o.vendor_id);
      v_n := v_n + 1;
    end if;
  end loop;
  -- Merchant mode, ready and no driver: "Need a driver?" (§27.4).
  for v_o in
    select o.id, o.code, o.vendor_id from public.orders o
    where o.status = 'ready' and o.fulfilment = 'delivery' and o.delivery_mode = 'merchant' and o.driver_member_id is null
      and o.ready_marked_at + make_interval(secs => v_need_driver) < now()
  loop
    if app_private.outbox_add('need_driver:' || v_o.id, v_o.id, v_o.vendor_id, 'whatsapp', 'need_driver',
         (select c.backup_target from app_private.vendor_channels(v_o.vendor_id) c), jsonb_build_object('order_id', v_o.id, 'code', v_o.code)) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  -- Food age over 40 minutes after pickup.
  for v_o in
    select o.id, o.code, o.vendor_id from public.orders o
    where o.status in ('picked_up', 'near_drop', 'arrived') and o.picked_up_at + make_interval(secs => v_food_age) < now()
  loop
    if app_private.ops_alert('food_age:' || v_o.id, 'food_age', 'warning', 'Order ' || v_o.code || ' on the road over 40 min', v_o.id, v_o.vendor_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  -- Arrived for 3 minutes without delivered.
  for v_o in
    select o.id, o.code, o.vendor_id from public.orders o
    where o.status = 'arrived'
      and (select max(e.at) from public.order_events e where e.order_id = o.id and e.to_status = 'arrived') + make_interval(secs => v_arrived) < now()
  loop
    if app_private.ops_alert('arrived:' || v_o.id, 'arrived_not_delivered', 'info', 'Order ' || v_o.code || ' arrived 3 min ago, not delivered', v_o.id, v_o.vendor_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('signals', v_n);
end;
$$;
revoke all on function app_private.order_monitor_tick() from public;

-- 10. Outbox consumer API (dispatch edge function, service role) ---------------------------------------------
-- Claims messages to send. `card` is the order summary built now (items, totals, area), so a card is
-- never stale and never built before the order's items exist.
create function public.outbox_claim(p_limit integer default 20, p_lock_s integer default 30)
returns table (id bigint, order_id uuid, vendor_id uuid, channel public.order_channel_kind, purpose public.outbox_purpose,
  target text, payload jsonb, attempts integer, card jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    update public.outbound_messages m set status = 'sending', attempts = m.attempts + 1,
      locked_until = now() + make_interval(secs => greatest(p_lock_s, 5))
    where m.id in (
      select x.id from public.outbound_messages x
      where (x.status = 'queued' or (x.status = 'sending' and x.locked_until < now())) and x.available_at <= now()
      order by x.available_at, x.id
      limit least(greatest(p_limit, 1), 100)
      for update skip locked
    )
    returning m.*
  )
  select c.id, c.order_id, c.vendor_id, c.channel, c.purpose, c.target, c.payload, c.attempts,
    case when c.order_id is not null then app_private.order_card_payload(c.order_id) end
  from claimed c order by c.id;
end;
$$;

-- Records a send. A failed or skipped new-order message on the primary fires the backup at once (§23.2
-- scenario 8); 3 channel failures in an hour switch the merchant to its backup for the day.
create function public.outbox_finish(
  p_id bigint,
  p_status public.outbox_status,
  p_provider_ref text default null,
  p_error text default null,
  p_retry_in_s integer default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.outbound_messages%rowtype;
  v_failures integer;
begin
  if p_status not in ('sent', 'failed', 'skipped', 'queued') then
    raise exception 'outbox_finish takes sent, failed, skipped or queued (retry)' using errcode = 'invalid_parameter_value';
  end if;
  update public.outbound_messages set
    status = p_status,
    provider_ref = coalesce(p_provider_ref, provider_ref),
    last_error = left(p_error, 1000),
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    available_at = case when p_status = 'queued' then now() + make_interval(secs => coalesce(p_retry_in_s, 10)) else available_at end,
    locked_until = null
  where id = p_id
  returning * into v_m;
  if v_m.id is null then
    raise exception 'unknown outbox message %', p_id using errcode = 'no_data_found';
  end if;
  if p_status in ('failed', 'skipped') and v_m.purpose = 'new_order' and v_m.dedupe_key like '%:primary' then
    perform app_private.dispatch_fire_backup(v_m.order_id, 'primary_' || p_status::text);
  end if;
  if p_status = 'failed' and v_m.vendor_id is not null then
    select count(*) into v_failures from public.outbound_messages m
    where m.vendor_id = v_m.vendor_id and m.channel = v_m.channel and m.status = 'failed' and m.created_at > now() - interval '1 hour';
    if v_failures >= public.config_numeric('channel_failures_per_hour') then
      update public.vendor_order_channels set use_backup_until = date_trunc('day', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut' + interval '1 day'
      where vendor_id = v_m.vendor_id and role = 'primary' and channel = v_m.channel and enabled
        and (use_backup_until is null or use_backup_until < now());
      perform app_private.ops_alert('channel_down:' || v_m.vendor_id || ':' || v_m.channel || ':' || to_char(now() at time zone 'Asia/Beirut', 'YYYYMMDD'),
        'channel_down', 'warning', 'Merchant ' || v_m.channel || ' channel failed ' || v_failures || ' times in an hour: on backup for today',
        null, v_m.vendor_id, jsonb_build_object('channel', v_m.channel, 'last_error', left(p_error, 200)));
    end if;
  end if;
end;
$$;

create function public.ops_alerts_claim(p_limit integer default 20)
returns setof public.ops_alerts
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.ops_alerts a set send_attempts = a.send_attempts + 1
  where a.id in (
    select x.id from public.ops_alerts x where x.sent_at is null and x.send_attempts < 10
    order by x.created_at limit least(greatest(p_limit, 1), 50) for update skip locked
  )
  returning a.*;
end;
$$;

create function public.ops_alert_sent(p_id bigint) returns void
language sql
security definer
set search_path = ''
as $$
  update public.ops_alerts set sent_at = now() where id = p_id;
$$;

-- 11. Merchant proposals: AI or rules propose, the merchant taps, the server applies --------------------------
create table public.merchant_proposals (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  member_id uuid references public.vendor_members (id) on delete set null,
  kind public.proposal_kind not null,
  -- pause: {"until"}; sold_out/back_in_stock: {"item_id"}; price: {"item_id", "price_usd"}; stock_add: {"item_id", "add"}
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  source text not null check (source in ('rules', 'ai', 'dashboard', 'button')),
  status public.proposal_status not null default 'proposed',
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index merchant_proposals_vendor_idx on public.merchant_proposals (vendor_id, created_at desc);
create trigger merchant_proposals_audit after insert or update on public.merchant_proposals
  for each row execute function app_private.audit_row();

create function app_private.merchant_proposal_create(
  p_vendor_id uuid,
  p_kind public.proposal_kind,
  p_payload jsonb,
  p_source text,
  p_member_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_roles public.member_role[];
  v_id uuid;
  v_item uuid := nullif(p_payload ->> 'item_id', '')::uuid;
begin
  -- Prices are owner and manager only (§18.1 H); availability and pause also cashier and kitchen.
  v_roles := case when p_kind = 'price' then array['owner', 'manager']::public.member_role[]
                  else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end;
  v_member := app_private.order_actor(p_vendor_id, v_roles, p_member_id);
  if p_kind in ('sold_out', 'back_in_stock', 'price', 'stock_add') and not exists (
    select 1 from public.menu_items i where i.id = v_item and i.vendor_id = p_vendor_id
  ) then
    raise exception 'unknown item for this merchant' using errcode = 'check_violation';
  end if;
  if p_kind = 'price' and ((p_payload ->> 'price_usd')::numeric is null or (p_payload ->> 'price_usd')::numeric < 0
                           or (p_payload ->> 'price_usd')::numeric > 10000) then
    raise exception 'price must be between 0 and 10000 USD' using errcode = 'check_violation';
  end if;
  if p_kind = 'pause' and ((p_payload ->> 'until')::timestamptz is null or (p_payload ->> 'until')::timestamptz <= now()
                           or (p_payload ->> 'until')::timestamptz > now() + interval '7 days') then
    raise exception 'a pause ends in the next 7 days' using errcode = 'check_violation';
  end if;
  if p_kind = 'stock_add' and coalesce((p_payload ->> 'add')::int, 0) not between 1 and 1000 then
    raise exception 'stock to add must be 1-1000' using errcode = 'check_violation';
  end if;
  insert into public.merchant_proposals (vendor_id, member_id, kind, payload, source, expires_at)
  values (p_vendor_id, v_member, p_kind, coalesce(p_payload, '{}'), p_source,
          now() + make_interval(secs => public.config_numeric('merchant_proposal_ttl_s')))
  returning id into v_id;
  return v_id;
end;
$$;

-- The confirming tap. Applies the change and returns what happened.
create function app_private.merchant_proposal_decide(p_proposal_id uuid, p_confirm boolean, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.merchant_proposals%rowtype;
  v_member uuid;
  v_item uuid;
begin
  select * into v_p from public.merchant_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    raise exception 'unknown proposal' using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_p.vendor_id,
    case when v_p.kind = 'price' then array['owner', 'manager']::public.member_role[]
         else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end, p_member_id);
  if v_p.status <> 'proposed' then
    return jsonb_build_object('status', v_p.status);
  end if;
  if v_p.expires_at < now() then
    update public.merchant_proposals set status = 'expired', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not p_confirm then
    update public.merchant_proposals set status = 'rejected', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'merchant proposal ' || p_proposal_id || ' confirmed', true);
  v_item := nullif(v_p.payload ->> 'item_id', '')::uuid;
  case v_p.kind
    when 'pause' then perform app_private.vendor_set_pause(v_p.vendor_id, (v_p.payload ->> 'until')::timestamptz, 'merchant pause', 'pause');
    when 'resume' then
      perform app_private.vendor_set_pause(v_p.vendor_id, null, null, 'resume');
      update public.vendors set missed_orders_streak = 0 where id = v_p.vendor_id;
    when 'sold_out' then update public.menu_items set available = false where id = v_item and vendor_id = v_p.vendor_id;
    when 'back_in_stock' then update public.menu_items set available = true where id = v_item and vendor_id = v_p.vendor_id;
    when 'price' then update public.menu_items set price_usd = (v_p.payload ->> 'price_usd')::numeric where id = v_item and vendor_id = v_p.vendor_id;
    when 'stock_add' then
      update public.menu_items set
        daily_quantity = case when daily_date = current_date then daily_quantity else 0 end + (v_p.payload ->> 'add')::int,
        daily_remaining = case when daily_date = current_date then daily_remaining else 0 end + (v_p.payload ->> 'add')::int,
        daily_date = current_date
      where id = v_item and vendor_id = v_p.vendor_id;
  end case;
  update public.merchant_proposals set status = 'confirmed', decided_at = now(), member_id = coalesce(v_member, member_id)
  where id = p_proposal_id;
  return jsonb_build_object('status', 'confirmed', 'kind', v_p.kind);
end;
$$;

create function public.merchant_proposal_create(
  p_vendor_id uuid, p_kind public.proposal_kind, p_payload jsonb, p_source text, p_member_id uuid default null
) returns uuid
language sql security invoker set search_path = ''
as $$ select app_private.merchant_proposal_create(p_vendor_id, p_kind, p_payload, p_source, p_member_id) $$;
create function public.merchant_proposal_decide(p_proposal_id uuid, p_confirm boolean, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.merchant_proposal_decide(p_proposal_id, p_confirm, p_member_id) $$;

-- The merchant identified by a WhatsApp number: active memberships of that phone (one per vendor).
create function public.merchant_members_by_phone(p_phone_e164 text)
returns table (member_id uuid, vendor_id uuid, role public.member_role, vendor_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.vendor_id, m.role, coalesce(v.name_ar, v.name_en)
  from public.vendor_members m join public.vendors v on v.id = m.vendor_id
  where m.phone_e164 = p_phone_e164 and m.status = 'active'
  order by m.created_at;
$$;

-- 12. WhatsApp number quality and restrictions (§29.6) --------------------------------------------------------
alter table public.whatsapp_numbers
  add column quality_status text check (quality_status in ('GREEN', 'YELLOW', 'RED', 'UNKNOWN')),
  add column messaging_limit text check (char_length(messaging_limit) <= 40),
  add column restricted boolean not null default false,
  add column marketing_paused boolean not null default false,
  add column quality_updated_at timestamptz;

create table public.whatsapp_number_events (
  id bigint generated always as identity primary key,
  webhook_event_id bigint unique references public.webhook_events (id) on delete set null,
  phone_number_id text,
  display_phone text,
  field text not null check (field in ('phone_number_quality_update', 'account_update')),
  event text,
  messaging_limit text,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  received_at timestamptz not null default now()
);
create index whatsapp_number_events_number_idx on public.whatsapp_number_events (phone_number_id, received_at desc);
create trigger whatsapp_number_events_append_only before update on public.whatsapp_number_events
  for each row execute function app_private.forbid_change();

-- Classifies a stored webhook event: Meta's `phone_number_quality_update` and `account_update` changes,
-- wherever Kapso nests them. FLAGGED or DOWNGRADE (quality RED / lower limit) and a restriction or
-- disable pause marketing on that number at once and alert the admin (§29.6).
create function app_private.whatsapp_number_event_from_webhook() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change jsonb;
  v_value jsonb;
  v_event text;
  v_bad boolean;
  v_number public.whatsapp_numbers%rowtype;
begin
  for v_change in
    select distinct c from jsonb_path_query(new.payload,
      'lax $.** ? (@.field == "phone_number_quality_update" || @.field == "account_update")') c
    where jsonb_typeof(c) = 'object'
  loop
    v_value := coalesce(v_change -> 'value', '{}');
    v_event := upper(coalesce(v_value ->> 'event', v_value ->> 'ban_info', ''));
    insert into public.whatsapp_number_events (webhook_event_id, phone_number_id, display_phone, field, event, messaging_limit, detail)
    values (new.id, coalesce(v_value ->> 'phone_number_id', new.phone_number_id), v_value ->> 'display_phone_number',
            v_change ->> 'field', nullif(v_event, ''), v_value ->> 'current_limit', v_value)
    on conflict (webhook_event_id) do nothing;
    v_bad := v_event in ('FLAGGED', 'DOWNGRADE', 'ACCOUNT_RESTRICTION', 'DISABLED_UPDATE', 'ACCOUNT_VIOLATION');
    select * into v_number from public.whatsapp_numbers w
    where w.phone_number_id = coalesce(v_value ->> 'phone_number_id', new.phone_number_id)
       or (v_value ->> 'display_phone_number' is not null and w.display_phone = '+' || regexp_replace(v_value ->> 'display_phone_number', '[^0-9]', '', 'g'))
    limit 1;
    if v_number.id is not null then
      update public.whatsapp_numbers set
        quality_status = case when v_event = 'FLAGGED' then 'RED' when v_event = 'UNFLAGGED' then 'GREEN' else quality_status end,
        messaging_limit = coalesce(v_value ->> 'current_limit', messaging_limit),
        restricted = case when v_event in ('ACCOUNT_RESTRICTION', 'DISABLED_UPDATE') then true else restricted end,
        marketing_paused = marketing_paused or v_bad,
        quality_updated_at = now()
      where id = v_number.id;
    end if;
    if v_bad then
      perform app_private.ops_alert('number_quality:' || new.id, 'number_quality', 'urgent',
        'WhatsApp ' || coalesce(v_number.role::text, 'unknown') || ' number: ' || v_event
          || '. Marketing paused; switch active_customer_number to standby if the customer number is restricted',
        null, null, jsonb_build_object('field', v_change ->> 'field', 'event', v_event, 'limit', v_value ->> 'current_limit'));
    end if;
  end loop;
  return null;
exception when others then
  -- Never break the webhook acknowledgement (§4); the raw event stays stored for a later replay.
  raise warning 'number quality classification failed for webhook event %: %', new.id, sqlerrm;
  return null;
end;
$$;
create trigger webhook_events_number_quality after insert on public.webhook_events
  for each row execute function app_private.whatsapp_number_event_from_webhook();

-- 13. Merchant portal queue --------------------------------------------------------------------------------
-- Active orders for the signed-in member's vendors, newest waiting first, with the escalation stage.
-- Security invoker: the orders policies decide what each member sees.
create view public.merchant_order_queue with (security_invoker = true) as
select o.id, o.code, o.vendor_id, o.status, o.fulfilment, o.payment_method, o.total_usd, o.total_lbp, o.usd_lbp_rate,
  o.weight_status, o.is_new_customer, o.customer_note, o.prep_minutes, o.ready_at, o.placed_at, o.accepted_at,
  o.acknowledged_at, o.driver_member_id, o.cancel_request_status, o.delivery_place_id,
  extract(epoch from now() - o.placed_at)::integer as waiting_s,
  (o.status = 'placed' and o.acknowledged_at is null) as alarm
from public.orders o
where o.status not in ('delivered', 'failed', 'rejected', 'cancelled');
grant select on public.merchant_order_queue to authenticated;

-- 14. Access ----------------------------------------------------------------------------------------------
alter table public.vendor_order_channels enable row level security;
alter table public.order_dispatch enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.ops_alerts enable row level security;
alter table public.merchant_proposals enable row level security;
alter table public.whatsapp_number_events enable row level security;
revoke all on table public.vendor_order_channels, public.order_dispatch, public.outbound_messages, public.ops_alerts,
  public.merchant_proposals, public.whatsapp_number_events from public, anon, authenticated;
grant all on table public.vendor_order_channels, public.order_dispatch, public.merchant_proposals to service_role;
grant select, insert, update on table public.outbound_messages, public.ops_alerts to service_role;
grant select on table public.whatsapp_number_events to service_role;
grant select on table public.vendor_order_channels, public.order_dispatch, public.merchant_proposals,
  public.ops_alerts, public.outbound_messages, public.whatsapp_number_events to authenticated;

create policy vendor_order_channels_read on public.vendor_order_channels for select to authenticated
  using ((select app_private.is_operator()) or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[]));
create policy order_dispatch_read on public.order_dispatch for select to authenticated
  using ((select app_private.is_operator())
         or app_private.has_vendor_role(vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[]));
create policy merchant_proposals_read on public.merchant_proposals for select to authenticated
  using ((select app_private.is_operator())
         or app_private.has_vendor_role(vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[]));
create policy ops_alerts_operator_read on public.ops_alerts for select to authenticated using ((select app_private.is_operator()));
create policy outbound_messages_operator_read on public.outbound_messages for select to authenticated using ((select app_private.is_operator()));
create policy whatsapp_number_events_operator_read on public.whatsapp_number_events for select to authenticated using ((select app_private.is_operator()));

do $$
declare
  f text;
begin
  -- Caller-checking functions behind invoker wrappers.
  foreach f in array array[
    'order_acknowledge(uuid, public.order_channel_kind, uuid, text)',
    'vendor_reactivate(uuid, uuid)',
    'merchant_proposal_create(uuid, public.proposal_kind, jsonb, text, uuid)',
    'merchant_proposal_decide(uuid, boolean, uuid)',
    'ops_alert_set_status(bigint, public.ops_alert_status)'
  ]
  loop
    execute format('revoke all on function app_private.%s from public, anon', f);
    execute format('grant execute on function app_private.%s to authenticated, service_role', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- Server only.
  foreach f in array array[
    'outbox_claim(integer, integer)',
    'outbox_finish(bigint, public.outbox_status, text, text, integer)',
    'ops_alerts_claim(integer)',
    'ops_alert_sent(bigint)',
    'merchant_members_by_phone(text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- 16. Fixes from the review of #101 ----------------------------------------------------------------------
-- order_place: an idempotency key belongs to one basket; a container line needs the customer's answer.
-- order_set_weight: a final cash total above the COD cap waits for the customer's tap.
-- order_progress: merchant staff move delivery states only on merchant-delivered or pickup orders.
create or replace function public.order_place(
  p_basket_id uuid,
  p_expected_menu_version bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders%rowtype;
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_place_status public.service_status;
  v_priced jsonb;
  v_rate numeric := public.usd_lbp_rate();
  v_road_km numeric;
  v_quote record;
  v_delivery_fee numeric := 0;
  v_deposit numeric := 0;
  v_stairs numeric := 0;
  v_subtotal numeric;
  v_total numeric;
  v_cap numeric;
  v_new_customer boolean;
  v_weighted boolean;
  v_order public.orders%rowtype;
  v_line record;
  v_low_threshold integer := public.config_numeric('daily_qty_low_threshold')::integer;
  v_low jsonb := '[]';
  v_remaining integer;
begin
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if v_existing.id is not null and v_existing.basket_id is distinct from p_basket_id then
    raise exception 'idempotency key already used for another basket' using errcode = 'unique_violation';
  end if;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
      'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
      'estimated', v_existing.weight_status <> 'none', 'repeat', true);
  end if;

  select * into v_basket from public.baskets where id = p_basket_id for update;
  if v_basket.id is null then
    raise exception 'unknown basket %', p_basket_id using errcode = 'no_data_found';
  end if;
  if v_basket.status <> 'open' then
    -- A duplicate confirmation that waited on the basket lock returns the order the first one created.
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
        'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
        'estimated', v_existing.weight_status <> 'none', 'repeat', true);
    end if;
    raise exception 'basket % is %', p_basket_id, v_basket.status using errcode = 'check_violation';
  end if;
  -- Placements for one vendor run one at a time: a pause or menu change cannot slip in between the checks
  -- and the insert, and selling the last unit (which bumps the menu version on this row) cannot deadlock
  -- against another placement holding a share lock. Orders per vendor are few; the wait is milliseconds.
  select * into v_vendor from public.vendors where id = v_basket.vendor_id for no key update;

  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if v_vendor.paused_until is not null and v_vendor.paused_until > now() then
    return jsonb_build_object('status', 'vendor_paused', 'until', v_vendor.paused_until);
  end if;
  if (v_basket.fulfilment = 'delivery' and not v_vendor.delivery_enabled)
     or (v_basket.fulfilment = 'pickup' and not v_vendor.pickup_enabled) then
    return jsonb_build_object('status', 'fulfilment_unavailable');
  end if;
  if v_basket.payment_method <> 'cod' and not coalesce((public.config_value('online_payments_enabled') #>> '{}')::boolean, false) then
    return jsonb_build_object('status', 'online_payment_off');
  end if;

  -- Menu version check (§30.1.1): a stale summary is never charged.
  if v_vendor.menu_version <> p_expected_menu_version or v_basket.priced_menu_version is distinct from p_expected_menu_version then
    v_priced := public.basket_price(p_basket_id);
    return jsonb_build_object('status', case when jsonb_array_length(v_priced -> 'unavailable') > 0 then 'unavailable' else 'repriced' end,
      'summary', v_priced);
  end if;
  v_priced := public.basket_price(p_basket_id);
  if jsonb_array_length(v_priced -> 'unavailable') > 0 then
    return jsonb_build_object('status', 'unavailable', 'summary', v_priced);
  end if;
  if jsonb_array_length(v_priced -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  -- Container exchange (§29.2): the customer must answer "do you have an empty to return?" first.
  if exists (
    select 1 from public.basket_items bi join public.menu_items i on i.id = bi.item_id
    where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null
  ) then
    return jsonb_build_object('status', 'needs_empty_answer', 'items', (
      select jsonb_agg(bi.item_id) from public.basket_items bi join public.menu_items i on i.id = bi.item_id
      where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null));
  end if;
  v_subtotal := (v_priced ->> 'subtotal_usd')::numeric;
  select coalesce(sum((l ->> 'container_deposit_usd')::numeric), 0), bool_or((l ->> 'estimated')::boolean)
    into v_deposit, v_weighted from jsonb_array_elements(v_priced -> 'lines') l;

  -- Delivery: an address with a place that takes orders, a cached road route, and the vendor's radius.
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id and customer_id = v_basket.customer_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address');
    end if;
    select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
    if v_place_status = 'paused' then
      return jsonb_build_object('status', 'place_paused');
    end if;
    select c.distance_m / 1000.0 into v_road_km
    from public.route_cache_lookup(
      extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
      array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]) c;
    select * into v_quote from public.delivery_quote(v_vendor.id, round(v_road_km, 2));
    if not v_quote.deliverable then
      return jsonb_build_object('status', v_quote.reason);
    end if;
    v_delivery_fee := v_quote.fee_usd;
    if v_basket.stairs_floors is not null and v_vendor.stairs_fee_per_floor_usd is not null then
      v_stairs := v_basket.stairs_floors * v_vendor.stairs_fee_per_floor_usd;
    end if;
  end if;

  v_total := v_subtotal + v_delivery_fee + v_deposit + v_stairs;

  -- COD caps: the per-order cap, and $50 until the number has one delivered order (§29.4).
  v_new_customer := not exists (
    select 1 from public.orders o where o.customer_id = v_basket.customer_id and o.status = 'delivered'
  );
  if v_basket.payment_method = 'cod' then
    v_cap := public.config_numeric('cod_cap_usd');
    if v_new_customer then
      v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
    end if;
    if v_total > v_cap then
      return jsonb_build_object('status', 'cod_cap', 'cap_usd', v_cap, 'total_usd', v_total, 'new_customer', v_new_customer);
    end if;
  end if;

  -- Daily quantities are decremented atomically; a race for the last units leaves the loser unavailable.
  for v_line in
    select bi.item_id, bi.quantity from public.basket_items bi where bi.basket_id = p_basket_id
    union all
    select c.component_item_id, c.quantity * bi.quantity from public.basket_items bi
    join public.menu_combo_components c on c.combo_item_id = bi.item_id where bi.basket_id = p_basket_id
  loop
    update public.menu_items i
    set daily_remaining = i.daily_remaining - v_line.quantity
    where i.id = v_line.item_id and i.daily_remaining is not null and i.daily_date = current_date
      and i.daily_remaining >= v_line.quantity
    returning i.daily_remaining into v_remaining;
    if not found then
      if exists (select 1 from public.menu_items i where i.id = v_line.item_id and i.daily_remaining is not null
                 and i.daily_date = current_date) then
        -- Lost the race for the last units: the whole placement rolls back.
        raise exception 'sold_out: item %', v_line.item_id using errcode = 'check_violation';
      end if;
    else
      if v_remaining <= v_low_threshold then
        v_low := v_low || jsonb_build_object('item_id', v_line.item_id, 'remaining', v_remaining);
      end if;
    end if;
  end loop;

  insert into public.orders (
    code, idempotency_key, basket_id, customer_id, vendor_id, status, fulfilment, delivery_mode, payment_method,
    address_id, delivery_place_id, delivery_pin, road_km, menu_version, usd_lbp_rate, food_subtotal_usd,
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_total,
    public.order_fee_usd(v_vendor.id, v_subtotal), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
    case when v_weighted then v_total end, v_new_customer, v_basket.customer_note, v_vendor.default_prep_minutes,
    case when v_basket.payment_method = 'cod' then now() end
  ) returning * into v_order;

  insert into public.order_items (order_id, item_id, name_ar, name_en, name_fr, quantity, pricing_unit, unit_price_usd,
    options, options_total_usd, est_weight_kg, price_per_kg_usd, line_total_usd, container_deposit_usd, has_empty, note)
  select v_order.id, i.id, i.name_ar, i.name_en, i.name_fr, bi.quantity, i.pricing_unit,
    case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name_ar', o.name_ar, 'name_en', o.name_en,
      'price_delta_usd', o.price_delta_usd) order by o.sort_order) from public.menu_options o where o.id = any (bi.option_ids)), '[]'),
    coalesce((select sum(o.price_delta_usd) from public.menu_options o where o.id = any (bi.option_ids)), 0),
    case when i.pricing_unit = 'kg' then i.est_weight_kg * bi.quantity end,
    case when i.pricing_unit = 'kg' then i.price_usd end,
    bi.line_total_usd,
    case when i.container_deposit_usd is not null and bi.has_empty is false then i.container_deposit_usd * bi.quantity else 0 end,
    case when i.container_deposit_usd is not null then bi.has_empty end,
    bi.note
  from public.basket_items bi join public.menu_items i on i.id = bi.item_id
  where bi.basket_id = p_basket_id;

  update public.baskets set status = 'ordered' where id = p_basket_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, detail)
  values (v_order.id, null, v_order.status, 'placed', app_private.current_actor_kind(),
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low);
end;
$$;

create or replace function app_private.order_set_weight(
  p_order_item_id uuid,
  p_actual_kg numeric,
  p_member_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_food numeric;
  v_total numeric;
  v_share numeric := public.config_numeric('weighted_increase_confirm_share');
  v_status public.weight_status;
  v_cap numeric;
begin
  select * into v_item from public.order_items where id = p_order_item_id;
  if v_item.id is null or v_item.pricing_unit <> 'kg' then
    raise exception 'not a weighed order line' using errcode = 'check_violation';
  end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  perform app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  if v_order.status not in ('accepted', 'preparing', 'ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup')
     or v_order.weight_status not in ('awaiting_weight', 'awaiting_customer') then
    raise exception 'weights are entered after acceptance and before pickup' using errcode = 'check_violation';
  end if;
  if p_actual_kg <= 0 or p_actual_kg > v_item.est_weight_kg * 5 then
    raise exception 'weight % kg is not plausible for this line', p_actual_kg using errcode = 'check_violation';
  end if;
  update public.order_items
  set actual_weight_kg = p_actual_kg,
      line_total_usd = round(price_per_kg_usd * p_actual_kg, 2) + options_total_usd * quantity
  where id = p_order_item_id;

  if exists (select 1 from public.order_items i where i.order_id = v_order.id and i.pricing_unit = 'kg' and i.actual_weight_kg is null) then
    return jsonb_build_object('status', 'awaiting_weight');
  end if;
  select sum(i.line_total_usd) into v_food from public.order_items i where i.order_id = v_order.id;
  v_total := v_food + v_order.delivery_fee_usd + v_order.container_deposit_usd + v_order.stairs_fee_usd - v_order.discount_usd;
  v_status := case when v_total > v_order.estimated_total_usd * (1 + v_share) then 'awaiting_customer' else 'final' end;
  -- A final cash total above the COD cap in force for this customer also waits for the customer's tap.
  if v_order.payment_method = 'cod' then
    v_cap := public.config_numeric('cod_cap_usd');
    if v_order.is_new_customer then
      v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
    end if;
    if v_total > v_cap then
      v_status := 'awaiting_customer';
    end if;
  end if;
  update public.orders set food_subtotal_usd = v_food, total_usd = v_total, weight_status = v_status,
    order_fee_usd = public.order_fee_usd(vendor_id, v_food, placed_at)
  where id = v_order.id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, detail)
  values (v_order.id, v_order.status, v_order.status, 'weights_entered', app_private.current_actor_kind(), (select auth.uid()),
          jsonb_build_object('estimated_total_usd', v_order.estimated_total_usd, 'final_total_usd', v_total, 'weight_status', v_status));
  return jsonb_build_object('status', v_status, 'estimated_total_usd', v_order.estimated_total_usd, 'final_total_usd', v_total,
    'over_cod_cap', v_cap is not null and v_total > v_cap);
end;
$$;

create or replace function app_private.order_progress(
  p_order_id uuid,
  p_to public.order_status,
  p_member_id uuid default null,
  p_channel text default 'portal'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
  v_roles public.member_role[];
begin
  if p_to not in ('preparing', 'ready', 'heading_to_pickup', 'at_pickup', 'picked_up', 'near_drop', 'arrived', 'delivered', 'failed') then
    raise exception 'use the dedicated function for %', p_to using errcode = 'check_violation';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status = p_to then
    return jsonb_build_object('status', 'unchanged', 'order_status', v_order.status);
  end if;
  v_roles := case when p_to in ('preparing', 'ready') then array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[]
                  else array['owner', 'manager', 'cashier', 'driver']::public.member_role[] end;
  v_member := app_private.order_actor(v_order.vendor_id, v_roles, p_member_id);
  -- A merchant driver moves only orders assigned to them.
  if v_member is not null and exists (select 1 from public.vendor_members m where m.id = v_member and m.role = 'driver')
     and v_order.driver_member_id is distinct from v_member then
    raise exception 'this order is not assigned to you' using errcode = 'insufficient_privilege';
  end if;
  -- Fleet and partner orders move past "ready" through their own adapters (§21), never by merchant staff.
  if p_to not in ('preparing', 'ready') and v_order.fulfilment = 'delivery' and v_order.delivery_mode <> 'merchant'
     and v_member is not null then
    raise exception 'this order is delivered by % and moves through its adapter', v_order.delivery_mode using errcode = 'insufficient_privilege';
  end if;
  if v_order.weight_status in ('awaiting_weight', 'awaiting_customer') and p_to in ('picked_up', 'delivered') then
    raise exception 'enter the final weights first' using errcode = 'check_violation';
  end if;
  perform app_private.order_set_status(p_order_id, p_to, null, p_to::text, p_channel, jsonb_build_object('member_id', v_member));
  return jsonb_build_object('status', p_to);
end;
$$;

-- 17. Dispatch function wiring ---------------------------------------------------------------------------
-- The `dispatch` edge function drains the inbound queue (merchant taps and commands), the outbox and the
-- ops alerts. pg_cron kicks it every 5 seconds through pg_net when there is work; the webhook function
-- kicks it right after each intake. The kick carries a random secret created here, which the function
-- checks with dispatch_secret_ok(); the base URL is written by the deploy job (it differs per project).
create extension if not exists pg_net;

create table app_private.runtime_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on table app_private.runtime_settings from public, anon, authenticated, service_role;
insert into app_private.runtime_settings (key, value) values ('dispatch_secret', encode(extensions.gen_random_bytes(32), 'hex'));

create function public.dispatch_secret_ok(p_secret text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(char_length(p_secret) = 64
    and extensions.digest(p_secret, 'sha256') = extensions.digest((select value from app_private.runtime_settings where key = 'dispatch_secret'), 'sha256'), false);
$$;

-- The deploy job records where the functions live (https://<ref>.supabase.co/functions/v1).
create function public.runtime_setting_set(p_key text, p_value text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key not in ('functions_base_url') then
    raise exception 'unknown runtime setting %', p_key using errcode = 'invalid_parameter_value';
  end if;
  if p_value !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1$' then
    raise exception 'functions_base_url must be https://<ref>.supabase.co/functions/v1' using errcode = 'invalid_parameter_value';
  end if;
  insert into app_private.runtime_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

create function app_private.dispatch_kick() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select value from app_private.runtime_settings where key = 'functions_base_url');
  v_secret text := (select value from app_private.runtime_settings where key = 'dispatch_secret');
begin
  if v_url is null then
    return null;
  end if;
  if not exists (select 1 from public.outbound_messages where status in ('queued', 'sending') and available_at <= now())
     and not exists (select 1 from public.ops_alerts where sent_at is null and send_attempts < 10)
     and not exists (select 1 from public.webhook_events where status in ('queued', 'failed') and attempts < 5) then
    return null;
  end if;
  return net.http_post(
    url := v_url || '/dispatch?forceFunctionRegion=eu-central-1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function app_private.dispatch_kick() from public;
select cron.schedule('dispatch-kick', '5 seconds', 'select app_private.dispatch_kick()');

-- The sending number for merchant messages: the Merchant number, else the sandbox (§3).
create function public.whatsapp_sender(p_audience text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select w.phone_number_id from public.whatsapp_numbers w
  where w.active and w.role = any (case when p_audience = 'merchant' then array['merchant', 'sandbox']
                                        else array['customer', 'sandbox'] end::public.whatsapp_number_role[])
  order by (w.role = 'sandbox'), w.created_at limit 1;
$$;

-- Which membership of this WhatsApp number may act on the record a tap names (order, item, proposal, vendor).
create function public.merchant_member_for(
  p_phone_e164 text,
  p_order_id uuid default null,
  p_item_id uuid default null,
  p_proposal_id uuid default null,
  p_vendor_id uuid default null
) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.vendor_members m
  where m.phone_e164 = p_phone_e164 and m.status = 'active'
    and m.vendor_id = coalesce(
      p_vendor_id,
      (select o.vendor_id from public.orders o where o.id = p_order_id),
      (select i.vendor_id from public.menu_items i where i.id = p_item_id),
      (select p.vendor_id from public.merchant_proposals p where p.id = p_proposal_id))
  order by (m.role = 'driver') limit 1;
$$;

-- Menu items of a vendor matching a merchant's words ("knefe", "الكنافة"), best first.
create function public.menu_item_match(p_vendor_id uuid, p_query text, p_limit integer default 3)
returns table (item_id uuid, name text, score real)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, coalesce(i.name_ar, i.name_en, i.name_fr),
    greatest(extensions.similarity(app_private.normalize_place_name(coalesce(i.name_ar, '')), app_private.normalize_place_name(p_query)),
             extensions.similarity(app_private.normalize_place_name(coalesce(i.name_en, '')), app_private.normalize_place_name(p_query)),
             extensions.similarity(app_private.normalize_place_name(coalesce(i.name_fr, '')), app_private.normalize_place_name(p_query))) as score
  from public.menu_items i
  where i.vendor_id = p_vendor_id
  order by score desc, i.sort_order, i.id
  limit least(greatest(p_limit, 1), 10);
$$;

-- "ready in 10": the merchant moves its own ready time (§27.5).
create function app_private.order_set_ready_eta(p_order_id uuid, p_minutes integer, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_member uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[], p_member_id);
  if v_order.status not in ('accepted', 'preparing') or p_minutes not between 1 and 120 then
    raise exception 'a ready time is set for an order being prepared, 1-120 minutes ahead' using errcode = 'check_violation';
  end if;
  update public.orders set ready_at = now() + make_interval(mins => p_minutes) where id = p_order_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, actor_id, detail)
  values (p_order_id, v_order.status, v_order.status, 'ready_eta_moved', app_private.current_actor_kind(), (select auth.uid()),
          jsonb_build_object('minutes', p_minutes, 'member_id', v_member));
  return jsonb_build_object('status', 'moved', 'ready_at', now() + make_interval(mins => p_minutes));
end;
$$;
create function public.order_set_ready_eta(p_order_id uuid, p_minutes integer, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.order_set_ready_eta(p_order_id, p_minutes, p_member_id) $$;

-- "Need a driver?" (§27.4): with no fleet or partner open yet, the operator is alerted.
create function app_private.order_request_driver(p_order_id uuid, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'unknown order %', p_order_id using errcode = 'no_data_found';
  end if;
  perform app_private.order_actor(v_order.vendor_id, array['owner', 'manager', 'cashier']::public.member_role[], p_member_id);
  perform app_private.ops_alert('driver_requested:' || p_order_id, 'driver_requested', 'warning',
    'Merchant asks for a driver for order ' || v_order.code || ' (no fleet or partner open yet)', p_order_id, v_order.vendor_id);
  return jsonb_build_object('status', 'operator_alerted');
end;
$$;
create function public.order_request_driver(p_order_id uuid, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.order_request_driver(p_order_id, p_member_id) $$;

-- "رصيدي / my balance": Alo King Credit from the ledger view (§20.3), owner and manager only.
create function public.merchant_balance(p_vendor_id uuid, p_member_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id);
  return jsonb_build_object('credit_usd', coalesce((
    select sum(b.balance) from public.ledger_account_balances b
    join public.ledger_accounts a on a.id = b.account_id
    where a.vendor_id = p_vendor_id and a.kind = 'merchant_credit' and a.currency = 'USD'), 0));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['order_set_ready_eta(uuid, integer, uuid)', 'order_request_driver(uuid, uuid)']
  loop
    execute format('revoke all on function app_private.%s from public, anon', f);
    execute format('grant execute on function app_private.%s to authenticated, service_role', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['dispatch_secret_ok(text)', 'runtime_setting_set(text, text)', 'whatsapp_sender(text)',
    'merchant_member_for(text, uuid, uuid, uuid, uuid)', 'menu_item_match(uuid, text, integer)', 'merchant_balance(uuid, uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- A reply to a merchant (button confirmation, proposal card, help). One per inbound message and content.
create function public.app_reply(p_to text, p_payload jsonb, p_ref text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_to !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'reply target must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  return app_private.outbox_add('reply:' || left(coalesce(p_ref, ''), 120) || ':' || md5(p_payload::text), null, null, 'whatsapp', 'reply', p_to, p_payload);
end;
$$;

create function public.menu_item_vendor(p_item_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.vendor_id from public.menu_items i where i.id = p_item_id;
$$;
revoke all on function public.app_reply(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.menu_item_vendor(uuid) from public, anon, authenticated;
grant execute on function public.app_reply(text, jsonb, text) to service_role;
grant execute on function public.menu_item_vendor(uuid) to service_role;

-- The call script reads the order summary again when the merchant presses 3 (repeat).
create function public.order_call_card(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$ select app_private.order_card_payload(p_order_id) $$;
revoke all on function public.order_call_card(uuid) from public, anon, authenticated;
grant execute on function public.order_call_card(uuid) to service_role;

-- 15. Schedules --------------------------------------------------------------------------------------------
select cron.schedule('order-escalation', '5 seconds', 'select app_private.order_escalation_tick()');
select cron.schedule('order-monitor', '15 seconds', 'select app_private.order_monitor_tick()');
