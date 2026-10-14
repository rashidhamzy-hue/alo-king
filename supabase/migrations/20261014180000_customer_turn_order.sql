-- Session E, e2e run 4 (14 October): one customer turn at a time.
--
-- The pin turn sent "Pick a place" (refs v1, v2) at 16:07:27.9; its customer_turn_end stalled (#139), was retried by
-- the RPC client and saved the session at 16:07:36.0. The customer's tap on "Alo Test Market" (pv:v1) reached another
-- worker at 16:07:32, began its own turn, read the session from before the pin turn (no v1) and answered "From which
-- place?". customer_turn_begin now holds a customer's next message back (`busy`, retried by the queue within seconds)
-- while the previous turn is still running, so a tap always reads the session its card was sent with.
-- No data changes; the function keeps its signature.

create index if not exists bot_turns_running_idx on public.bot_turns (customer_id) where finished_at is null;

create or replace function public.customer_turn_begin(
  p_phone_e164 text,
  p_message_id text,
  p_kind text,
  p_display_name text default null,
  p_attempt integer default 1,
  p_lease_id uuid default null,
  p_lease_until timestamptz default null
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
  -- Never longer than an edge function can live, whatever the caller says.
  v_lease timestamptz := least(coalesce(p_lease_until, now() + interval '150 seconds'), now() + interval '155 seconds');
  v_other boolean;
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

  -- One turn at a time per customer. The upsert above locks the customer row, so two workers beginning turns for the
  -- same customer take turns here and the second sees the first one's row. A turn still running (unfinished, lease
  -- held) holds the next message back: its replies may be out while its session is not saved yet, and the next tap
  -- would read the old session and miss the options it answers. `busy` makes the queue try again in 5, 10, 15 s.
  -- A turn older than 30 s no longer holds anyone (its worker is gone or about to be), so a message is never held
  -- past the queue's retries.
  v_other := exists (select 1 from public.bot_turns t
    where t.customer_id = v_customer.id and t.message_id <> p_message_id and t.finished_at is null
      and t.lease_until > now() and t.received_at > now() - interval '30 seconds');
  if v_other and not exists (select 1 from public.bot_turns t where t.message_id = p_message_id) then
    return jsonb_build_object('duplicate', false, 'busy', true);
  end if;

  insert into public.bot_turns (message_id, customer_id, kind, lease_until, lease_id)
  values (p_message_id, v_customer.id, left(p_kind, 40), v_lease, p_lease_id)
  on conflict (message_id) do nothing;
  if not found then
    -- A finished turn, another customer's message id, or Kapso delivering the same message again (attempt 1): duplicate.
    if coalesce(p_attempt, 1) <= 1 or not exists (select 1 from public.bot_turns t
        where t.message_id = p_message_id and t.customer_id = v_customer.id and t.finished_at is null) then
      return jsonb_build_object('duplicate', true);
    end if;
    -- The queue's retry of a turn that never finished: run it again only once nobody holds it (taking the lease is
    -- atomic, so two retries never run it at once); while it is held, `busy` makes the retry try again later.
    if v_other then
      return jsonb_build_object('duplicate', false, 'busy', true);
    end if;
    update public.bot_turns t set lease_until = v_lease, lease_id = p_lease_id
    where t.message_id = p_message_id and t.customer_id = v_customer.id and t.finished_at is null
      and (t.lease_until is null or t.lease_until <= now());
    if not found then
      return jsonb_build_object('duplicate', false, 'busy', true);
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
revoke all on function public.customer_turn_begin(text, text, text, text, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_turn_begin(text, text, text, text, integer, uuid, timestamptz) to service_role;
