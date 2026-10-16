-- Session 5f part 8a (CUSTOMER-EXPERIENCE.md §3.1 #1-7, §3.2 #11, §3.3 #21; DECISIONS §39.14, §39.15.3): first contact.
--
-- 1. Config (dated): the 2-second debounce of a burst of typed messages and its cap, and the waitlist template in the
--    template map.
-- 2. Five messages in a row get one reply (#6): `customer_burst` decides, under a per-customer lock, whether a typed
--    message waits (until inbound_debounce_ms after the customer's latest one), leads the burst (folding every other
--    waiting text of that customer into itself: their events are marked done with `folded_into`), or was folded already.
--    `webhook_defer` puts a waiting event back on the queue for exactly that long without spending one of its attempts.
--    Taps, pins, voice notes and photos never wait.
-- 3. Opening times (#7, #21): `vendor_opens_at` (the next opening from the pause, vendor_hours and vendor_closures),
--    `vendor_opening` for the shops a list shows, `shops_closed_near` for "every shop near you is closed".
-- 4. "Remind me when it opens" (#7, #21): one reminder per customer and shop (or "any shop near me"), due at the shop's
--    next opening, sent by a step of the minute tick as one service message only while the customer's 24-hour window is open;
--    otherwise dropped silently. Never a template, never marketing.
-- 5. A shop link from the website or a QR on a shop (#2): `shop_for_link` resolves the slug the link carries.
-- 6. Outside the delivery area (#11): the waitlist. A tap stores a dated opt-in for the place; when the place switches on
--    (places.service_status = 'on') one approved UTILITY template the customer asked for goes out once
--    (alo_waitlist_open; the template map gates it: nothing is sent until Meta approves it in that category, §39.14 nit 3).
--    STOP after joining is honoured; the opt-in never sets marketing_opt_in and is never read by broadcasts.
-- 7. "Delete my data" removes reminders and waitlist rows (`customer_waits_forget`).

-- 1. Config ------------------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('inbound_debounce_ms', '2000', now(),
   'CUSTOMER-EXPERIENCE §3.1 #6: a customer''s typed message waits until this long after their latest one, so five messages in a row get one reply; 0 switches the debounce off. Taps, pins and voice notes never wait'),
  ('inbound_debounce_max_ms', '8000', now(),
   'CUSTOMER-EXPERIENCE §3.1 #6: a burst of typed messages is answered at most this long after its first message, however fast the customer keeps typing');

insert into public.app_config (key, value, effective_from, note)
select 'whatsapp_template_map',
  public.config_value('whatsapp_template_map') || '{"waitlist_open": "alo_waitlist_open"}',
  now(), 'Adds the waitlist notice (CUSTOMER-EXPERIENCE §3.2 #11, DECISIONS §39.14 nit 3); names and texts in _shared/whatsapp-templates.ts';

-- 2. One reply to a burst of messages ------------------------------------------------------------------------------------------
alter table public.webhook_events add column folded_into bigint references public.webhook_events (id) on delete set null;
comment on column public.webhook_events.folded_into is
  'CUSTOMER-EXPERIENCE §3.1 #6: this typed message was answered with the burst led by that event (one reply to all of them)';

-- The sender of an inbound Kapso event, digits only (conversation.phone_number, else message.from).
create function app_private.inbound_phone(p_payload jsonb) returns text
language sql immutable set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_payload -> 'conversation' ->> 'phone_number', p_payload -> 'message' ->> 'from', ''),
                               '[^0-9]', '', 'g'), '');
$$;
revoke all on function app_private.inbound_phone(jsonb) from public;
-- The index below calls it, so every role that writes webhook_events must be able to run it.
grant execute on function app_private.inbound_phone(jsonb) to service_role;

-- Waiting typed messages, by sender: the burst lookup reads only these rows (never a scan of the event log).
create index webhook_events_pending_text_idx on public.webhook_events (app_private.inbound_phone(payload), received_at)
  where status in ('queued', 'processing', 'failed') and (payload -> 'message' ->> 'type') = 'text';
create index webhook_events_folded_idx on public.webhook_events (folded_into) where folded_into is not null;
alter table public.webhook_events add column burst_led_at timestamptz;
comment on column public.webhook_events.burst_led_at is
  'CUSTOMER-EXPERIENCE §3.1 #6: when customer_burst told this typed message to lead its burst; from then on no newer message folds it (unless its turn failed), so a burst is never answered twice';

-- A customer's typed message that has not been answered: inbound, text, not folded, received in the last 10 minutes, and
-- no bot turn has begun for it (a turn that began is replayed as it was, never merged into a new burst).
create function app_private.burst_candidate(p_event public.webhook_events) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_event.status in ('queued', 'processing', 'failed')
    and (p_event.payload -> 'message' ->> 'type') = 'text'
    and p_event.folded_into is null
    -- A message already told to lead is being answered: never folded into a newer burst, unless its turn failed.
    and (p_event.burst_led_at is null or p_event.status = 'failed')
    and p_event.received_at > now() - interval '10 minutes'
    and (p_event.event_type like '%message.received' or (p_event.payload #>> '{message,kapso,direction}') = 'inbound')
    and coalesce(p_event.payload #>> '{message,kapso,direction}', 'inbound') = 'inbound'
    and not exists (select 1 from public.bot_turns t where t.message_id = p_event.payload #>> '{message,id}');
$$;
revoke all on function app_private.burst_candidate(public.webhook_events) from public;

-- What dispatch does with one claimed typed message (§3.1 #6):
--   {status: 'single'}                         answer it alone (not a text, or the debounce is off)
--   {status: 'wait', wait_s}                   the customer typed within inbound_debounce_ms: put it back for wait_s
--   {status: 'folded', into}                   another message of the burst answers it: nothing to do
--   {status: 'burst' | 'single', texts, count} it leads: its own text and the texts it folded, oldest first
create function public.customer_burst(p_event_id bigint, p_alone boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_e public.webhook_events%rowtype;
  v_phone text;
  v_quiet interval := make_interval(secs => greatest(coalesce(public.config_numeric('inbound_debounce_ms'), 0), 0) / 1000.0);
  v_max interval := make_interval(secs => greatest(coalesce(public.config_numeric('inbound_debounce_max_ms'), 0), 0) / 1000.0);
  v_latest timestamptz;
  v_first timestamptz;
  v_due timestamptz;
  v_texts jsonb;
  v_n integer;
begin
  select * into v_e from public.webhook_events where id = p_event_id;
  if v_e.id is null or (v_e.payload -> 'message' ->> 'type') is distinct from 'text' then
    return jsonb_build_object('status', 'single');
  end if;
  v_phone := app_private.inbound_phone(v_e.payload);
  if v_phone is null then
    return jsonb_build_object('status', 'single');
  end if;
  -- One worker decides a customer's burst at a time; the others wait here and then see what it folded.
  perform pg_advisory_xact_lock(hashtextextended('customer_burst:' || v_phone, 0));
  select * into v_e from public.webhook_events where id = p_event_id;
  if v_e.folded_into is not null then
    return jsonb_build_object('status', 'folded', 'into', v_e.folded_into);
  end if;
  -- STOP and deletion are answered alone (dispatch): marked as leading, so no burst led at the same moment folds them.
  if p_alone then
    update public.webhook_events set burst_led_at = clock_timestamp() where id = p_event_id;
    return jsonb_build_object('status', 'single');
  end if;
  if v_quiet > interval '0' and app_private.burst_candidate(v_e) then
    select max(w.received_at), min(w.received_at) into v_latest, v_first
    from public.webhook_events w
    where app_private.inbound_phone(w.payload) = v_phone and w.status in ('queued', 'processing', 'failed')
      and w.phone_number_id is not distinct from v_e.phone_number_id
      and (w.payload -> 'message' ->> 'type') = 'text' and app_private.burst_candidate(w);
    v_first := least(v_first, v_e.received_at,
                     (select min(w.received_at) from public.webhook_events w where w.folded_into = p_event_id));
    v_due := least(v_latest + v_quiet, v_first + greatest(v_max, v_quiet));
    if v_due > clock_timestamp() + interval '50 milliseconds' then
      return jsonb_build_object('status', 'wait',
        'wait_s', round(extract(epoch from (v_due - clock_timestamp()))::numeric, 2));
    end if;
    -- Quiet long enough: this message leads, and every other waiting text of the customer is answered with it. Messages
    -- an earlier leader folded come along (a leader that was itself held back can be folded into a newer one).
    with f as (
      update public.webhook_events w set folded_into = p_event_id, status = 'done', processed_at = now()
      where app_private.inbound_phone(w.payload) = v_phone and w.status in ('queued', 'processing', 'failed')
        and w.phone_number_id is not distinct from v_e.phone_number_id
        and (w.payload -> 'message' ->> 'type') = 'text' and w.id <> p_event_id and app_private.burst_candidate(w)
      returning w.id
    )
    update public.webhook_events w set folded_into = p_event_id where w.folded_into in (select f.id from f);
    update public.webhook_events set burst_led_at = clock_timestamp() where id = p_event_id;
  end if;
  select jsonb_agg(left(coalesce(w.payload #>> '{message,text,body}', ''), 2000) order by w.received_at, w.id), count(*)
  into v_texts, v_n
  from public.webhook_events w where w.id = p_event_id or w.folded_into = p_event_id;
  return jsonb_build_object('status', case when v_n > 1 then 'burst' else 'single' end, 'texts', v_texts, 'count', v_n);
end;
$$;
revoke all on function public.customer_burst(bigint, boolean) from public, anon, authenticated;
grant execute on function public.customer_burst(bigint, boolean) to service_role;

-- Puts a claimed event back on the queue for p_delay_s seconds (at most 30), as if it had not been claimed: the claim's
-- attempt is given back, so waiting never pushes a message towards the dead-letter queue. Only the attempt that claimed it
-- can defer it (a late repeat changes nothing).
create function public.webhook_defer(p_msg_id bigint, p_event_id bigint, p_attempt integer, p_delay_s numeric)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.webhook_events e set status = 'queued', attempts = greatest(e.attempts - 1, 0)
  where e.id = p_event_id and e.attempts = p_attempt and e.status = 'processing';
  if not found then
    return false;
  end if;
  update pgmq.q_webhook_inbound q
  set vt = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_delay_s, 0), 0.1), 30))
  where q.msg_id = p_msg_id;
  return true;
end;
$$;
revoke all on function public.webhook_defer(bigint, bigint, integer, numeric) from public, anon, authenticated;
grant execute on function public.webhook_defer(bigint, bigint, integer, numeric) to service_role;

-- 3. Opening times ----------------------------------------------------------------------------------------------------------
-- When a closed shop opens next: the end of its pause (the hours tick pauses a shop outside its hours until its next opening),
-- else its next open half-hour by vendor_hours and vendor_closures. Null when it is open now, or nothing is known within 8
-- days (an indefinite pause, no opening hours ahead).
create function app_private.vendor_opens_at(p_vendor_id uuid, p_at timestamptz default now()) returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_until timestamptz;
  v_from timestamptz;
begin
  select v.paused_until into v_until from public.vendors v where v.id = p_vendor_id;
  if not found then
    return null;
  end if;
  v_from := case when v_until > p_at then v_until else p_at end;
  if not isfinite(v_from) or v_from > p_at + interval '8 days' then
    return null;
  end if;
  if app_private.vendor_open_at(p_vendor_id, v_from) then
    return case when v_from > p_at then v_from end;
  end if;
  return app_private.vendor_next_open(p_vendor_id, v_from);
end;
$$;
revoke all on function app_private.vendor_opens_at(uuid, timestamptz) from public;

-- Open now: not paused and inside its hours (no hours means always open).
create function app_private.vendor_open_now(p_vendor_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not coalesce((select v.paused_until > now() from public.vendors v where v.id = p_vendor_id), false)
    and app_private.vendor_open_at(p_vendor_id);
$$;
revoke all on function app_private.vendor_open_now(uuid) from public;

-- An opening as the bot words it, in Beirut time: {opens_at, hm "12:00", in_days 0 today / 1 tomorrow, dow 0 = Sunday}.
create function app_private.opening_json(p_at timestamptz) returns jsonb
language sql stable set search_path = ''
as $$
  select case when p_at is not null and isfinite(p_at) then jsonb_build_object(
    'opens_at', p_at,
    'hm', to_char(p_at at time zone 'Asia/Beirut', 'HH24:MI'),
    'in_days', (p_at at time zone 'Asia/Beirut')::date - (now() at time zone 'Asia/Beirut')::date,
    'dow', extract(dow from p_at at time zone 'Asia/Beirut')::int) end;
$$;
revoke all on function app_private.opening_json(timestamptz) from public;

-- Open now, or when each shop opens, for the shops a list or a card shows (at most 20).
create function public.vendor_opening(p_vendor_ids uuid[]) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('vendor_id', x.id, 'open_now', x.open_now,
           'opens', case when not x.open_now then app_private.opening_json(app_private.vendor_opens_at(x.id)) end)
         order by x.ord), '[]')
  from (select v.id, k.ord, app_private.vendor_open_now(v.id) as open_now
        from unnest(coalesce(p_vendor_ids, '{}')) with ordinality k (id, ord)
        join public.vendors v on v.id = k.id
        where k.ord <= 20) x;
$$;
revoke all on function public.vendor_opening(uuid[]) from public, anon, authenticated;
grant execute on function public.vendor_opening(uuid[]) to service_role;

-- The orderable shops that may deliver to the customer's saved pin (the browse rule: within their delivery radius in a
-- straight line, test shops anywhere), every one of them, nearest first. Read through the location index; whether each is
-- open is asked by the caller, which stops at the first open one (§39.14 rule 2: no cap on how many are looked at).
create function app_private.near_shops(p_customer_id uuid)
returns table (vendor_id uuid, name_ar text, name_en text, is_test boolean, dist_m double precision)
language sql stable security definer set search_path = ''
as $$
  with pt as (
    select a.pin from public.addresses a
    where a.id = (public.customer_search_point(p_customer_id) ->> 'address_id')::uuid and a.pin is not null
  ),
  q as (select public.max_delivery_km() as max_km, app_private.customer_hidden_vendors(p_customer_id) as hidden),
  ids as (
    select v.id from public.vendors v, pt, q where extensions.st_dwithin(v.location, pt.pin, q.max_km * 1000)
    union
    select v.id from public.vendors v where v.is_test
  )
  select v.id, v.name_ar, v.name_en, v.is_test, extensions.st_distance(v.location, pt.pin)
  from ids join public.vendors v on v.id = ids.id cross join pt cross join q
  where v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.delivery_enabled
    and not (v.id = any (q.hidden))
    and (v.is_test or extensions.st_distance(v.location, pt.pin) <= least(coalesce(v.delivery_radius_km, q.max_km), q.max_km) * 1000)
  order by extensions.st_distance(v.location, pt.pin);
$$;
revoke all on function app_private.near_shops(uuid) from public;

-- Near the customer's pin: how many shops, whether any is open now (stops at the first open one), and, when none is, the
-- one that opens first (each shop's next opening computed once; most are paused by the hours tick until it, one read).
create function app_private.near_open_state(p_customer_id uuid)
returns table (shops integer, any_open boolean, first_vendor_id uuid, first_name_ar text, first_name_en text,
  first_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  select count(*)::int into shops from app_private.near_shops(p_customer_id);
  any_open := shops > 0 and exists (select 1 from app_private.near_shops(p_customer_id) n
                                    where app_private.vendor_open_now(n.vendor_id));
  if shops > 0 and not any_open then
    select n.vendor_id, n.name_ar, n.name_en, o.at into first_vendor_id, first_name_ar, first_name_en, first_at
    from app_private.near_shops(p_customer_id) n
    cross join lateral (select app_private.vendor_opens_at(n.vendor_id) as at) o
    order by o.at nulls last, n.dist_m
    limit 1;
  end if;
  return next;
end;
$$;
revoke all on function app_private.near_open_state(uuid) from public;

-- "Shops near you are closed now. Eatout opens at 12:00." (§3.1 #7): no_point (no saved pin), outside (the pin's place is
-- not delivered to), none (no shop near), open (at least one is open), or all_closed with the shop that opens first.
create function public.shops_closed_near(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_place text;
  v_s record;
begin
  if v_pt is null then
    return jsonb_build_object('status', 'no_point');
  end if;
  select a.place_id into v_place from public.addresses a where a.id = (v_pt ->> 'address_id')::uuid;
  if not app_private.place_delivered_to(v_place)
     and not exists (select 1 from app_private.near_shops(p_customer_id) n where n.is_test) then
    return jsonb_build_object('status', 'outside');
  end if;
  select * into v_s from app_private.near_open_state(p_customer_id);
  if v_s.shops = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  if v_s.any_open then
    return jsonb_build_object('status', 'open', 'shops', v_s.shops);
  end if;
  return jsonb_build_object('status', 'all_closed', 'shops', v_s.shops,
    'first', jsonb_build_object('vendor_id', v_s.first_vendor_id, 'name_ar', v_s.first_name_ar,
      'name_en', v_s.first_name_en, 'opens', app_private.opening_json(v_s.first_at)));
end;
$$;
revoke all on function public.shops_closed_near(uuid) from public, anon, authenticated;
grant execute on function public.shops_closed_near(uuid) to service_role;

-- 4. "Remind me when it opens" -----------------------------------------------------------------------------------------------
create table app_private.shop_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  -- Null: the first shop near the customer to open.
  vendor_id uuid references public.vendors (id) on delete cascade,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  dropped_at timestamptz,
  drop_reason text check (drop_reason in ('window', 'closed', 'gone', 'blocked', 'forgotten', 'stopped')),
  check (sent_at is null or dropped_at is null)
);
alter table app_private.shop_reminders enable row level security;
revoke all on table app_private.shop_reminders from public, anon, authenticated;
comment on table app_private.shop_reminders is
  'CUSTOMER-EXPERIENCE §3.1 #7, §3.3 #21: one service message when a closed shop opens, sent only inside the customer''s 24-hour window, never a template, never marketing';
-- One waiting reminder per customer and shop (and one for "any shop near me").
create unique index shop_reminders_one_idx on app_private.shop_reminders
  (customer_id, coalesce(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)) where sent_at is null and dropped_at is null;
create index shop_reminders_due_idx on app_private.shop_reminders (due_at) where sent_at is null and dropped_at is null;

-- When the customer's 24-hour window closes: their last message to any of our numbers, plus the window (with the same ten
-- minutes to spare as whatsapp_window_open).
create function app_private.customer_window_end(p_customer_id uuid) returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select greatest(c.last_inbound_at, (select max(w.last_inbound_at) from app_private.whatsapp_windows w where w.phone_e164 = c.phone_e164))
         + interval '23 hours 50 minutes'
  from public.customers c where c.id = p_customer_id;
$$;
revoke all on function app_private.customer_window_end(uuid) from public;

-- The customer's tap (or the agent's remind_when_open). The opening time is the server's, never the tap's or the model's.
-- set | open_now | no_time (no opening known) | beyond_window (it opens after the customer's 24-hour window closes, so the
-- message could not be sent) | no_point (any shop: no saved pin) | none (any shop: no shop near) | unknown.
create function public.shop_reminder_set(p_customer_id uuid, p_vendor_id uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.vendors%rowtype;
  v_at timestamptz;
  v_id uuid;
  v_new boolean;
  v_n integer;
  v_any boolean;
begin
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    return jsonb_build_object('status', 'unknown');
  end if;
  if p_vendor_id is not null then
    select * into v_v from public.vendors v
    where v.id = p_vendor_id and v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed'
      and not (v.id = any (app_private.customer_hidden_vendors(p_customer_id)));
    if v_v.id is null then
      return jsonb_build_object('status', 'unknown');
    end if;
    if app_private.vendor_open_now(v_v.id) then
      return jsonb_build_object('status', 'open_now', 'vendor_id', v_v.id, 'name_ar', v_v.name_ar, 'name_en', v_v.name_en);
    end if;
    v_at := app_private.vendor_opens_at(v_v.id);
  else
    if public.customer_search_point(p_customer_id) is null then
      return jsonb_build_object('status', 'no_point');
    end if;
    select s.shops, s.any_open, s.first_at into v_n, v_any, v_at from app_private.near_open_state(p_customer_id) s;
    if v_n = 0 then
      return jsonb_build_object('status', 'none');
    end if;
    if v_any then
      return jsonb_build_object('status', 'open_now');
    end if;
  end if;
  if v_at is null then
    return jsonb_build_object('status', 'no_time', 'name_ar', v_v.name_ar, 'name_en', v_v.name_en);
  end if;
  if v_at > app_private.customer_window_end(p_customer_id) then
    return jsonb_build_object('status', 'beyond_window', 'name_ar', v_v.name_ar, 'name_en', v_v.name_en,
      'opens', app_private.opening_json(v_at));
  end if;
  insert into app_private.shop_reminders as r (customer_id, vendor_id, due_at)
  values (p_customer_id, p_vendor_id, v_at)
  on conflict (customer_id, coalesce(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where sent_at is null and dropped_at is null
  do update set due_at = excluded.due_at
  returning r.id, (r.xmax = 0) into v_id, v_new;
  return jsonb_build_object('status', 'set', 'reminder_id', v_id, 'new', v_new, 'vendor_id', p_vendor_id,
    'name_ar', v_v.name_ar, 'name_en', v_v.name_en, 'opens', app_private.opening_json(v_at));
end;
$$;
revoke all on function public.shop_reminder_set(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_reminder_set(uuid, uuid) to service_role;

-- 5. A shop link (the website's "Order on WhatsApp" on a shop page, a QR on the shop) --------------------------------------------
-- By slug (the link's "shop:<slug>"), or by id (the "See the menu" button of a reminder). orderable (with open_now),
-- unclaimed ("Not on Alo King yet", §39.3: names and village only), or unknown (no such shop, or hidden from this customer).
create function public.shop_for_link(p_customer_id uuid, p_slug text, p_vendor_id uuid default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case
      when v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active' then
        jsonb_build_object('status', 'orderable', 'vendor_id', v.id, 'name_ar', v.name_ar, 'name_en', v.name_en,
          'open_now', app_private.vendor_open_now(v.id))
      when u.id is not null then
        jsonb_build_object('status', 'unclaimed', 'vendor_id', v.id, 'slug', v.slug, 'name_ar', v.name_ar,
          'name_en', v.name_en, 'business_type', v.business_type, 'place_ar', p.name_ar, 'place_en', coalesce(p.name_en, p.name_ar))
    end
    from public.vendors v
    left join app_private.unclaimed_listings u on u.id = v.id
    left join public.places p on p.id = v.town_id
    where ((p_vendor_id is not null and v.id = p_vendor_id) or (p_vendor_id is null and v.slug = lower(trim(p_slug))))
      and not (v.id = any (app_private.customer_hidden_vendors(p_customer_id)))
  ), '{"status": "unknown"}'::jsonb);
$$;
revoke all on function public.shop_for_link(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.shop_for_link(uuid, text, uuid) to service_role;

-- 6. Outside the delivery area: the waitlist ---------------------------------------------------------------------------------
create table app_private.place_waitlist (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  place_id text not null references public.places (id) on delete cascade,
  -- The customer's tap: the dated opt-in for this one notice.
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  opted_out_at timestamptz,
  -- Last time the tick found the notice could not reach the customer yet (no approved template, window closed).
  checked_at timestamptz,
  unique (customer_id, place_id)
);
alter table app_private.place_waitlist enable row level security;
revoke all on table app_private.place_waitlist from public, anon, authenticated;
comment on table app_private.place_waitlist is
  'CUSTOMER-EXPERIENCE §3.2 #11: "Tell me when you do". One utility notice the customer asked for when the place switches on; STOP honoured; never marketing (it never sets marketing_opt_in and broadcasts never read it)';
create index place_waitlist_pending_idx on app_private.place_waitlist (place_id) where notified_at is null and opted_out_at is null;

-- The customer's address place (p_address_id or p_place_id when it is one of theirs; else their saved pin's) and what
-- the "We don't deliver to <place> yet" card offers: delivered (the place is on), outside (with pickup when a shop that takes
-- pickup is within pickup_search_km), demo_outside (a demo tester or owner: the demo addresses instead, §39.15.3), no_point.
create function public.waitlist_state(p_customer_id uuid, p_place_id text default null, p_address_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_a record;
begin
  select a.place_id, a.pin, p.name_ar, p.name_en, p.name_fr, p.service_status into v_a
  from public.addresses a join public.places p on p.id = a.place_id
  where a.customer_id = p_customer_id
    and (case when p_address_id is not null then a.id = p_address_id
              when p_place_id is not null then a.place_id = p_place_id
              else a.id = (public.customer_search_point(p_customer_id) ->> 'address_id')::uuid end)
  order by a.last_used_at desc nulls last limit 1;
  if v_a.place_id is null then
    return jsonb_build_object('status', 'no_point');
  end if;
  if v_a.service_status = 'on' then
    return jsonb_build_object('status', 'delivered', 'place_id', v_a.place_id, 'place', coalesce(v_a.name_ar, v_a.name_en),
      'place_en', coalesce(v_a.name_en, v_a.name_ar));
  end if;
  if app_private.demo_addresses_for(p_customer_id) then
    return jsonb_build_object('status', 'demo_outside', 'choices', app_private.demo_address_choices());
  end if;
  -- The test shop takes any pin (DECISIONS §35): while one this customer can see is orderable, nothing is "outside".
  if exists (select 1 from public.vendors v where v.is_test and v.orderable
             and not (v.id = any (app_private.customer_hidden_vendors(p_customer_id)))) then
    return jsonb_build_object('status', 'test_shop', 'place_id', v_a.place_id);
  end if;
  return jsonb_build_object('status', 'outside', 'place_id', v_a.place_id, 'place', coalesce(v_a.name_ar, v_a.name_en),
    'place_en', coalesce(v_a.name_en, v_a.name_ar), 'place_fr', coalesce(v_a.name_fr, v_a.name_en, v_a.name_ar),
    'pickup', v_a.pin is not null and exists (
      select 1 from public.vendors v
      where extensions.st_dwithin(v.location, v_a.pin, public.config_numeric('pickup_search_km') * 1000)
        and v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.pickup_enabled
        and not (v.id = any (app_private.customer_hidden_vendors(p_customer_id)))),
    'joined', exists (select 1 from app_private.place_waitlist w where w.customer_id = p_customer_id
                      and w.place_id = v_a.place_id and w.notified_at is null and w.opted_out_at is null));
end;
$$;
revoke all on function public.waitlist_state(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.waitlist_state(uuid, text, uuid) to service_role;

-- "Tell me when you do": joined | already | delivered (the place is on already) | demo_outside | no_point. Tapping again after
-- STOP, or after an earlier notice, is a new opt-in dated now.
create function public.waitlist_join(p_customer_id uuid, p_place_id text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s jsonb := public.waitlist_state(p_customer_id, p_place_id);
  v_new boolean;
begin
  if v_s ->> 'status' <> 'outside' then
    return v_s;
  end if;
  insert into app_private.place_waitlist as w (customer_id, place_id) values (p_customer_id, v_s ->> 'place_id')
  on conflict (customer_id, place_id) do update
    -- A join after STOP is a new opt-in (the tick reads STOP after created_at as an opt-out), even before the tick ran.
    set created_at = case when w.notified_at is null and w.opted_out_at is null
                            and not coalesce((select c.marketing_opt_out_at > w.created_at from public.customers c
                                              where c.id = w.customer_id), false)
                          then w.created_at else now() end,
        notified_at = null, opted_out_at = null, checked_at = null
  returning (w.xmax = 0) into v_new;
  return v_s || jsonb_build_object('status', case when v_new or not (v_s ->> 'joined')::boolean then 'joined' else 'already' end);
end;
$$;
revoke all on function public.waitlist_join(uuid, text) from public, anon, authenticated;
grant execute on function public.waitlist_join(uuid, text) to service_role;

-- 7. "Delete my data" removes both --------------------------------------------------------------------------------------------
create function public.customer_waits_forget(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  n_r integer;
  n_w integer;
begin
  delete from app_private.shop_reminders where customer_id = p_customer_id;
  get diagnostics n_r = row_count;
  delete from app_private.place_waitlist where customer_id = p_customer_id;
  get diagnostics n_w = row_count;
  return jsonb_build_object('reminders', n_r, 'waitlist', n_w);
end;
$$;
revoke all on function public.customer_waits_forget(uuid) from public, anon, authenticated;
grant execute on function public.customer_waits_forget(uuid) to service_role;

-- 8. The tick: due reminders and places that switched on ------------------------------------------------------------------------
-- A reminder goes when it is due, the shop (or a shop near the customer) is open, and the customer's 24-hour window is open
-- on the number that would send it; a shop still closed moves it to the next opening while that is inside the window; anything
-- else drops it silently. A waitlist notice goes once its place is on, unless the customer said STOP after joining, and only
-- when it can reach them now (inside the window, or by the approved alo_waitlist_open template in its UTILITY category);
-- otherwise it waits (checked_at rotates the backlog). Both are keyed outbox rows, so a repeated tick sends nothing twice.
create function app_private.customer_waits_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_open boolean;
  v_next timestamptz;
  n_sent integer := 0;
  n_moved integer := 0;
  n_dropped integer := 0;
  n_notified integer := 0;
  n_out integer := 0;
begin
  perform set_config('app.actor_kind', 'system', true);
  for r in
    select s.id, s.customer_id, s.vendor_id, s.created_at, c.phone_e164, c.language, c.blocked_until, c.profile_reset_at,
      c.marketing_opt_out_at,
      v.name_ar, v.name_en, (v.id is null or (v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed')) as listed
    from app_private.shop_reminders s
    join public.customers c on c.id = s.customer_id
    left join public.vendors v on v.id = s.vendor_id
    where s.sent_at is null and s.dropped_at is null and s.due_at <= now()
    order by s.due_at
    limit 200
    for update of s skip locked
  loop
    if r.blocked_until > now() then
      update app_private.shop_reminders set dropped_at = now(), drop_reason = 'blocked' where id = r.id;
      n_dropped := n_dropped + 1;
      continue;
    end if;
    if r.profile_reset_at > r.created_at then
      update app_private.shop_reminders set dropped_at = now(), drop_reason = 'forgotten' where id = r.id;
      n_dropped := n_dropped + 1;
      continue;
    end if;
    -- STOP after "Remind me": no message, not even the one asked for.
    if r.marketing_opt_out_at > r.created_at then
      update app_private.shop_reminders set dropped_at = now(), drop_reason = 'stopped' where id = r.id;
      n_dropped := n_dropped + 1;
      continue;
    end if;
    if not r.listed then
      update app_private.shop_reminders set dropped_at = now(), drop_reason = 'gone' where id = r.id;
      n_dropped := n_dropped + 1;
      continue;
    end if;
    if not public.whatsapp_window_open(r.phone_e164, public.whatsapp_sender_for('customer', r.phone_e164)) then
      update app_private.shop_reminders set dropped_at = now(), drop_reason = 'window' where id = r.id;
      n_dropped := n_dropped + 1;
      continue;
    end if;
    if r.vendor_id is not null then
      v_open := app_private.vendor_open_now(r.vendor_id);
      v_next := case when not v_open then app_private.vendor_opens_at(r.vendor_id) end;
    else
      select s.any_open, s.first_at into v_open, v_next from app_private.near_open_state(r.customer_id) s;
      v_open := coalesce(v_open, false);
    end if;
    if not v_open then
      if v_next is not null and v_next > now() and v_next <= app_private.customer_window_end(r.customer_id) then
        update app_private.shop_reminders set due_at = v_next where id = r.id;
        n_moved := n_moved + 1;
      else
        update app_private.shop_reminders set dropped_at = now(), drop_reason = 'closed' where id = r.id;
        n_dropped := n_dropped + 1;
      end if;
      continue;
    end if;
    perform app_private.outbox_add('shop_reminder:' || r.id, null, null, 'whatsapp', 'customer_message', r.phone_e164,
      jsonb_build_object('kind', 'shop_open', 'lang', coalesce(r.language::text, 'ar'), 'customer_id', r.customer_id,
        'vendor_id', r.vendor_id, 'vendor', coalesce(r.name_ar, r.name_en), 'vendor_en', coalesce(r.name_en, r.name_ar)));
    update app_private.shop_reminders set sent_at = now() where id = r.id;
    n_sent := n_sent + 1;
  end loop;

  for r in
    select w.id, w.customer_id, w.created_at, c.phone_e164, c.language, c.blocked_until, c.marketing_opt_out_at,
      p.name_ar, p.name_en, p.name_fr
    from app_private.place_waitlist w
    join public.places p on p.id = w.place_id
    join public.customers c on c.id = w.customer_id
    where w.notified_at is null and w.opted_out_at is null and p.service_status = 'on'
    order by w.checked_at nulls first, w.created_at
    limit 200
    for update of w skip locked
  loop
    -- STOP (or "delete my data") after joining: honoured, never sent.
    if r.marketing_opt_out_at > r.created_at then
      update app_private.place_waitlist set opted_out_at = r.marketing_opt_out_at where id = r.id;
      n_out := n_out + 1;
      continue;
    end if;
    if r.blocked_until > now()
       or not app_private.whatsapp_reachable(r.phone_e164, 'customer', 'waitlist_open', coalesce(r.language::text, 'ar')) then
      update app_private.place_waitlist set checked_at = now() where id = r.id;
      continue;
    end if;
    perform app_private.outbox_add('waitlist:' || r.id, null, null, 'whatsapp', 'customer_message', r.phone_e164,
      jsonb_build_object('kind', 'waitlist_open', 'lang', coalesce(r.language::text, 'ar'), 'customer_id', r.customer_id,
        'place', coalesce(r.name_ar, r.name_en), 'place_en', coalesce(r.name_en, r.name_ar),
        'place_fr', coalesce(r.name_fr, r.name_en, r.name_ar)));
    update app_private.place_waitlist set notified_at = now() where id = r.id;
    n_notified := n_notified + 1;
  end loop;
  return jsonb_build_object('reminders_sent', n_sent, 'reminders_moved', n_moved, 'reminders_dropped', n_dropped,
    'waitlist_notified', n_notified, 'waitlist_opted_out', n_out);
end;
$$;
revoke all on function app_private.customer_waits_tick() from public;

-- A step of the minute tick (one cron job, each step isolated, a failing step alerts ops), as in
-- 20261016100000_staging_load.sql with customer_waits_tick added. Outbox rows wake dispatch through dispatch_kick.
create or replace function app_private.tick_minute() returns jsonb
language sql security definer set search_path = ''
as $$
  select app_private.tick_steps('tick-minute', array['claims_tick', 'hours_tick', 'availability_tick', 'gift_requests_expire',
    'customer_waits_tick']);
$$;
revoke all on function app_private.tick_minute() from public;

-- 9. "Delete my data" also forgets reminders and waitlist rows, in the same transaction (otherwise as in
-- 20261016170000_split_carts.sql).
create or replace function public.customer_forget(p_customer_id uuid, p_scope text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loc jsonb := null;
begin
  if p_scope not in ('history', 'all') then
    raise exception 'scope must be history or all' using errcode = 'invalid_parameter_value';
  end if;
  update public.customers set profile_reset_at = now() where id = p_customer_id;
  delete from public.customer_preferences where customer_id = p_customer_id;
  update public.bot_sessions set history = '[]', refs = '{}', pending = '{}', focus_vendor_id = null where customer_id = p_customer_id;
  if p_scope = 'all' then
    update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
    delete from public.saved_carts where customer_id = p_customer_id;
    perform public.customer_waits_forget(p_customer_id);
    v_loc := public.location_forget_customer(p_customer_id);
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now(), display_name = null
    where id = p_customer_id;
  end if;
  return jsonb_build_object('status', 'forgotten', 'scope', p_scope, 'location', v_loc);
end;
$$;
