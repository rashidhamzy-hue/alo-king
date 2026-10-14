-- Session E (DECISIONS §39.10, issue #139): the intermittent dispatch stall.
--
-- Root cause (edge logs, 14 October): about 1 in 2,000 requests from an edge function to /rest/v1 stalls for
-- 20-100 s between the function and the API gateway while PostgREST and Postgres answer it in milliseconds.
-- dispatch had no deadline on those requests, so one stall held the worker until the 150 s wall clock
-- killed it (nothing logged). The queue retried the event after its 90 s visibility timeout, and the retry
-- found the turn already begun (bot_turns row from the dead attempt), answered "duplicate" and sent nothing:
-- the tap was lost, and with it the options the customer had been shown.
--
-- The function side (supabase/functions/_shared/rest-rpc.ts) now puts a deadline on every request. This
-- migration makes the retry fast and correct:
--   1. webhook_finish: a failed event becomes visible again after 5 s per attempt (was 90 s). It takes the attempt it
--      finishes, so a late repeat of an earlier attempt's finish never touches a later attempt.
--   2. customer_turn_begin: a retry of a turn that never finished replays it (the session it reads is the one
--      the customer saw, because customer_turn_end never ran); a finished turn, or the same message delivered
--      twice by Kapso, is still a duplicate. A turn holds a lease while it runs (released when it stalls), so two
--      copies of one turn never run at once.
--   3. basket_add_item: an optional operation key, recorded only when the add succeeded, so an add that already ran
--      is not added again on replay.

-- 1. Fast retry -------------------------------------------------------------------------------------------
drop function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer);
create function public.webhook_finish(
  p_msg_id bigint,
  p_event_id bigint,
  p_status public.webhook_status,
  p_error text default null,
  p_max_attempts integer default 5,
  p_attempt integer default null
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
  if not exists (select 1 from public.webhook_events where id = p_event_id) then
    raise exception 'webhook event % does not exist', p_event_id using errcode = 'no_data_found';
  end if;
  -- A finish for an attempt that is no longer the latest (a repeated call after a later claim) changes nothing.
  update public.webhook_events e
    set status = p_status,
        last_error = case when p_status = 'failed' then left(p_error, 1000) else e.last_error end,
        processed_at = case when p_status in ('done', 'ignored') then now() else e.processed_at end
    where e.id = p_event_id and (p_attempt is null or e.attempts = p_attempt)
    returning e.attempts into v_attempts;
  if not found then
    return;
  end if;
  if p_status <> 'failed' or v_attempts >= p_max_attempts then
    perform pgmq.archive('webhook_inbound', p_msg_id);
  else
    -- Back on the queue in 5, 10, 15, 20 s instead of after the claim's visibility timeout.
    perform pgmq.set_vt('webhook_inbound', p_msg_id, least(5 * greatest(v_attempts, 1), 60));
  end if;
end;
$$;
revoke all on function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer, integer) from public, anon, authenticated;
grant execute on function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer, integer) to service_role;

-- 2. Replay of an unfinished turn ---------------------------------------------------------------------------
-- While a turn runs it holds a lease (longer than the 150 s an edge function may live); a turn that stalls releases
-- it before failing, and a replay takes it again.
alter table public.bot_turns add column lease_until timestamptz;

drop function public.customer_turn_begin(text, text, text, text);
create function public.customer_turn_begin(
  p_phone_e164 text,
  p_message_id text,
  p_kind text,
  p_display_name text default null,
  p_attempt integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_session public.bot_sessions%rowtype;
  v_first boolean := false;
  v_replay boolean := false;
begin
  if p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.customers (phone_e164, display_name, last_inbound_at)
  values (p_phone_e164, left(nullif(trim(p_display_name), ''), 80), now())
  on conflict (phone_e164) do update set last_inbound_at = now(),
    display_name = coalesce(public.customers.display_name, excluded.display_name)
  returning * into v_customer;
  v_first := v_customer.created_at > now() - interval '5 seconds';

  insert into public.bot_turns (message_id, customer_id, kind, lease_until)
  values (p_message_id, v_customer.id, left(p_kind, 40), now() + interval '170 seconds')
  on conflict (message_id) do nothing;
  if not found then
    -- Only the queue's own retry (attempt 2+) of a turn that never finished, and that nobody is running (its lease
    -- released or expired), may run it again; taking the lease is atomic, so two retries never run it at once.
    update public.bot_turns t set lease_until = now() + interval '170 seconds'
    where t.message_id = p_message_id and t.customer_id = v_customer.id and t.finished_at is null
      and coalesce(p_attempt, 1) > 1 and (t.lease_until is null or t.lease_until <= now());
    if not found then
      return jsonb_build_object('duplicate', true);
    end if;
    v_replay := true;
    v_first := false;
  end if;

  insert into public.bot_sessions (customer_id) values (v_customer.id) on conflict (customer_id) do nothing;
  select * into v_session from public.bot_sessions where customer_id = v_customer.id for update;
  if v_session.last_turn_at is not null and v_session.last_turn_at < now() - interval '24 hours' then
    update public.bot_sessions set history = '[]', pending = '{}', refs = '{}', low_confidence = 0, focus_vendor_id = null
    where customer_id = v_customer.id returning * into v_session;
  end if;
  update public.bot_sessions set last_turn_at = now() where customer_id = v_customer.id;

  return jsonb_build_object(
    'duplicate', false,
    'replay', v_replay,
    'first_contact', v_first,
    'customer', jsonb_build_object('id', v_customer.id, 'language', v_customer.language, 'name', v_customer.display_name,
      'marketing_opt_in', v_customer.marketing_opt_in,
      'blocked', v_customer.blocked_until is not null and v_customer.blocked_until > now()),
    'session', jsonb_build_object('lang', v_session.lang, 'focus_vendor_id', v_session.focus_vendor_id,
      'pending', v_session.pending, 'refs', v_session.refs, 'history', v_session.history,
      'low_confidence', v_session.low_confidence,
      'handoff', v_session.handoff_until is not null and v_session.handoff_until > now()),
    'basket', public.basket_view(v_customer.id),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'status', o.status, 'vendor', coalesce(v.name_ar, v.name_en),
        'vendor_en', coalesce(v.name_en, v.name_ar), 'weight_status', o.weight_status) order by o.created_at desc)
      from public.orders o join public.vendors v on v.id = o.vendor_id
      where o.customer_id = v_customer.id and o.status not in ('delivered', 'failed', 'rejected', 'cancelled')
        and o.created_at > now() - interval '2 days'), '[]'),
    'profile', public.customer_profile(v_customer.id),
    'bot_enabled', app_private.config_bool('customer_bot_enabled'),
    'support_open', app_private.beirut_hour() >= (public.config_value('support_hours') ->> 'from')::int
                    and app_private.beirut_hour() < (public.config_value('support_hours') ->> 'to')::int
  );
end;
$$;
revoke all on function public.customer_turn_begin(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.customer_turn_begin(text, text, text, text, integer) to service_role;

-- A turn that stalled gives its lease back before failing, so the queue's retry can replay it at once.
create function public.customer_turn_release(p_message_id text) returns void
language sql security definer set search_path = ''
as $$ update public.bot_turns set lease_until = now() where message_id = p_message_id and finished_at is null $$;
revoke all on function public.customer_turn_release(text) from public, anon, authenticated;
grant execute on function public.customer_turn_release(text) to service_role;

-- 3. Keyed basket adds ------------------------------------------------------------------------------------
-- One row per add that succeeded (key = WhatsApp message id, the add's number in the turn and the item); pruned
-- after 2 days.
create table app_private.basket_add_ops (
  op_key text primary key check (char_length(op_key) between 1 and 240),
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index basket_add_ops_created_idx on app_private.basket_add_ops (created_at);
alter table app_private.basket_add_ops enable row level security;
revoke all on table app_private.basket_add_ops from public, anon, authenticated;

drop function public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean);
create function public.basket_add_item(
  p_customer_id uuid,
  p_item_id uuid,
  p_quantity integer default 1,
  p_option_ids uuid[] default '{}',
  p_note text default null,
  p_replace boolean default false,
  p_op_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items%rowtype;
  v_vendor public.vendors%rowtype;
  v_basket public.baskets%rowtype;
  v_qty integer := least(greatest(coalesce(p_quantity, 1), 1), 50);
  v_line uuid;
  v_opts uuid[] := coalesce((select array_agg(x order by x) from unnest(coalesce(p_option_ids, '{}')) x), '{}');
begin
  if p_op_key is not null and exists (select 1 from app_private.basket_add_ops o where o.op_key = p_op_key) then
      -- Already added by an earlier attempt of the same turn: the basket as it is now.
      return jsonb_build_object('status', 'added', 'replayed', true,
        'line_id', (select bi.id from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                    where b.customer_id = p_customer_id and b.status = 'open' and bi.item_id = p_item_id
                    order by bi.created_at desc limit 1),
        'basket', public.basket_view(p_customer_id));
  end if;
  select * into v_item from public.menu_items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('status', 'unknown_item');
  end if;
  select * into v_vendor from public.vendors where id = v_item.vendor_id;
  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if not app_private.menu_item_orderable(p_item_id, v_qty) then
    return jsonb_build_object('status', 'unavailable', 'item', coalesce(v_item.name_ar, v_item.name_en));
  end if;
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is not null and v_basket.vendor_id <> v_vendor.id then
    if not p_replace then
      return jsonb_build_object('status', 'other_vendor',
        'basket_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id));
    end if;
    update public.baskets set status = 'abandoned' where id = v_basket.id;
    v_basket := null;
  end if;
  if v_basket.id is null then
    insert into public.baskets (customer_id, vendor_id, address_id)
    values (p_customer_id, v_vendor.id,
      (select a.id from public.addresses a where a.customer_id = p_customer_id order by a.is_default desc, a.last_used_at desc nulls last limit 1))
    returning * into v_basket;
  end if;
  select bi.id into v_line from public.basket_items bi
  where bi.basket_id = v_basket.id and bi.item_id = p_item_id and bi.option_ids = v_opts
    and bi.note is not distinct from nullif(trim(p_note), '');
  if v_line is not null then
    update public.basket_items set quantity = least(quantity + v_qty, 50) where id = v_line;
  else
    insert into public.basket_items (basket_id, item_id, quantity, option_ids, note)
    values (v_basket.id, p_item_id, v_qty, v_opts, left(nullif(trim(p_note), ''), 200))
    returning id into v_line;
  end if;
  update public.baskets set last_activity_at = now(), reminded_at = null where id = v_basket.id;
  -- Recorded only now: an add that was refused (unknown, closed, unavailable, other shop) is answered again.
  if p_op_key is not null then
    insert into app_private.basket_add_ops (op_key, customer_id) values (p_op_key, p_customer_id);
  end if;
  return jsonb_build_object('status', 'added', 'line_id', v_line, 'basket', public.basket_view(p_customer_id));
end;
$$;
revoke all on function public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean, text) from public, anon, authenticated;
grant execute on function public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean, text) to service_role;

-- Keyed adds are only needed while a turn can still be retried: pruned nightly.
create or replace function app_private.basket_add_ops_prune() returns void
language sql security definer set search_path = ''
as $$ delete from app_private.basket_add_ops where created_at < now() - interval '2 days' $$;
revoke all on function app_private.basket_add_ops_prune() from public, anon, authenticated;
select cron.schedule('basket-add-ops-prune', '17 3 * * *', 'select app_private.basket_add_ops_prune()');
