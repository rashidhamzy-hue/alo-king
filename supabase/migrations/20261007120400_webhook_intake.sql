-- Phase 1a webhook intake (DECISIONS §3, §4, §13): the first phase of every webhook.
-- The edge function verifies the signature over the raw body, then calls `webhook_intake`, which
-- dedupes on (provider, event key), persists the event and queues it in pgmq, all in one round trip.
-- The function returns 200 right after. Processing happens later from the queue (Phase 2 and 3
-- consumers use `webhook_claim` and `webhook_finish`).

create extension if not exists pgmq;

create type public.webhook_provider as enum ('kapso', 'meta', 'whish', 'tap');
create type public.webhook_status as enum ('queued', 'processing', 'done', 'failed', 'ignored');
create type public.whatsapp_number_role as enum ('customer', 'merchant', 'standby', 'sandbox');

-- Alo King's own WhatsApp numbers. Both Meta account IDs are stored (account-model change, §6).
create table public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text not null unique,
  display_phone text check (display_phone ~ '^\+[1-9][0-9]{6,14}$'),
  role public.whatsapp_number_role not null,
  waba_id text,
  messaging_account_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger whatsapp_numbers_touch before update on public.whatsapp_numbers
  for each row execute function app_private.touch_updated_at();
create trigger whatsapp_numbers_audit after insert or update or delete on public.whatsapp_numbers
  for each row execute function app_private.audit_row();

create table public.webhook_events (
  id bigint generated always as identity primary key,
  provider public.webhook_provider not null,
  -- Dedupe key chosen by the intake function (for Kapso: event type plus WhatsApp message id).
  event_key text not null check (char_length(event_key) between 1 and 300),
  event_type text not null check (char_length(event_type) between 1 and 100),
  phone_number_id text,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  status public.webhook_status not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  constraint webhook_events_dedupe unique (provider, event_key)
);
create index webhook_events_status_idx on public.webhook_events (status, received_at)
  where status in ('queued', 'processing', 'failed');
create index webhook_events_received_idx on public.webhook_events (received_at);

select pgmq.create('webhook_inbound');

-- Persist and enqueue a batch of verified events. p_events: [{"event_key", "event_type",
-- "phone_number_id", "payload"}]. Returns one row per input: the event id and whether it was a duplicate.
create function public.webhook_intake(p_provider public.webhook_provider, p_events jsonb)
returns table (event_key text, event_id bigint, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_id bigint;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'webhook_intake needs a non-empty array of events' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_events) > 100 then
    raise exception 'webhook_intake accepts at most 100 events per call' using errcode = 'invalid_parameter_value';
  end if;
  for v_event in select * from jsonb_array_elements(p_events) loop
    v_id := null;
    insert into public.webhook_events (provider, event_key, event_type, phone_number_id, payload)
    values (
      p_provider,
      v_event ->> 'event_key',
      v_event ->> 'event_type',
      nullif(v_event ->> 'phone_number_id', ''),
      coalesce(v_event -> 'payload', 'null'::jsonb)
    )
    on conflict on constraint webhook_events_dedupe do nothing
    returning id into v_id;

    if v_id is null then
      select e.id into v_id from public.webhook_events e
      where e.provider = p_provider and e.event_key = v_event ->> 'event_key';
      event_key := v_event ->> 'event_key'; event_id := v_id; duplicate := true;
    else
      perform pgmq.send('webhook_inbound', jsonb_build_object('event_id', v_id));
      event_key := v_event ->> 'event_key'; event_id := v_id; duplicate := false;
    end if;
    return next;
  end loop;
end;
$$;

-- Consumers: take up to p_limit queued events, hidden from other consumers for p_visibility_s seconds.
-- A message whose event is already finished is archived and skipped (at-least-once delivery from pgmq).
create function public.webhook_claim(p_limit integer default 10, p_visibility_s integer default 30)
returns table (msg_id bigint, event_id bigint, provider public.webhook_provider, event_type text,
  phone_number_id text, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg record;
  v_event public.webhook_events;
begin
  for v_msg in select * from pgmq.read('webhook_inbound', greatest(p_visibility_s, 1), least(greatest(p_limit, 1), 100)) loop
    update public.webhook_events e
      set status = 'processing', attempts = e.attempts + 1
      where e.id = (v_msg.message ->> 'event_id')::bigint and e.status in ('queued', 'processing', 'failed')
      returning * into v_event;
    if not found then
      perform pgmq.archive('webhook_inbound', v_msg.msg_id);
      continue;
    end if;
    msg_id := v_msg.msg_id;
    event_id := v_event.id;
    provider := v_event.provider;
    event_type := v_event.event_type;
    phone_number_id := v_event.phone_number_id;
    payload := v_event.payload;
    attempts := v_event.attempts;
    return next;
  end loop;
end;
$$;

-- Consumers: record the outcome. done and ignored archive the message; failed leaves it in the queue to
-- reappear after its visibility timeout, until p_max_attempts, then archives it as failed for an operator.
create function public.webhook_finish(
  p_msg_id bigint,
  p_event_id bigint,
  p_status public.webhook_status,
  p_error text default null,
  p_max_attempts integer default 5
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_status not in ('done', 'failed', 'ignored') then
    raise exception 'webhook_finish takes done, failed or ignored' using errcode = 'invalid_parameter_value';
  end if;
  update public.webhook_events e
    set status = p_status,
        last_error = case when p_status = 'failed' then left(p_error, 1000) else e.last_error end,
        processed_at = case when p_status in ('done', 'ignored') then now() else e.processed_at end
    where e.id = p_event_id
    returning e.attempts into v_attempts;
  if not found then
    raise exception 'webhook event % does not exist', p_event_id using errcode = 'no_data_found';
  end if;
  if p_status <> 'failed' or v_attempts >= p_max_attempts then
    perform pgmq.archive('webhook_inbound', p_msg_id);
  end if;
end;
$$;

revoke all on function public.webhook_intake(public.webhook_provider, jsonb) from public, anon, authenticated;
revoke all on function public.webhook_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer) from public, anon, authenticated;
grant execute on function public.webhook_intake(public.webhook_provider, jsonb) to service_role;
grant execute on function public.webhook_claim(integer, integer) to service_role;
grant execute on function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer) to service_role;

-- Row-level security: payloads hold phone numbers and message text, so operators only.
alter table public.whatsapp_numbers enable row level security;
alter table public.webhook_events enable row level security;
revoke all on table public.whatsapp_numbers, public.webhook_events from public, anon, authenticated;
grant all on table public.whatsapp_numbers to service_role;
grant select on table public.webhook_events to service_role;
grant select on table public.whatsapp_numbers, public.webhook_events to authenticated;
create policy whatsapp_numbers_operator_read on public.whatsapp_numbers for select to authenticated
  using ((select app_private.is_operator()));
create policy webhook_events_operator_read on public.webhook_events for select to authenticated
  using ((select app_private.is_operator()));
