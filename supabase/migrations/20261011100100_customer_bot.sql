-- Session 4 (Phase 3a, DECISIONS §10): the customer bot's server side. The AI interprets; every price,
-- basket line, address, order and message decision below is made here (CLAUDE.md "AI proposes, server
-- decides"). Contents:
--   1. config (models, budgets, timings: DECISIONS §3, §4, §27, §29.3, §30)
--   2. bot sessions and turn log (one RPC to begin a turn; duplicate deliveries are no-ops)
--   3. AI call log and the atomic usage quota (§29.5)
--   4. customer memory profile, stated preferences and "forget my history" (§30.1.5, Law 81/2018)
--   5. discovery: vendor search, menu pages, item options (§29.3 search on full-text, trigram, aliases)
--   6. baskets: add, change, clear, checkout fields, container answer, reorder, upsell (§29.3)
--   7. addresses and the location tools resolve_location, describe_location, observe_location (§28.2)
--   8. tracking: "where is my order?" and the ETA range (§27.9, §28.2)
--   9. the 4-digit delivery code (§27.6)
--  10. customer messages on order changes, the arrived prompt, ratings (§27.3, §27.9, §30.2.3)
--  11. abandoned-basket reminder and basket expiry (§29.3)
--  12. human handoff (§30.6) and the sandbox number (§3)
-- No SQL from the research reports is used (§29, §30). Places and vendor tables are only read (§31).

-- 1. Config ------------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §3, §4, §27, §29.3, §30, 11 October 2026 (session 4)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('ai_customer_model', '"claude-haiku-4-5-20251001"', '2026-10-11 00:00+03', 'Model for ordinary customer turns (DECISIONS §3, §29.3)', null),
  ('ai_escalation_model', '"claude-sonnet-5-5"', '2026-10-11 00:00+03', 'Model for complaints and turns the first model fails (DECISIONS §3)', null),
  ('ai_transcription_model', '"gpt-4o-transcribe"', '2026-10-11 00:00+03', 'Voice-note transcription; replaced by the winner of the voice eval (DECISIONS §3, §30.7)', null),
  ('ai_model_prices', '{"claude-haiku-4-5-20251001": {"in": 1.00, "out": 5.00}, "claude-sonnet-5-5": {"in": 2.00, "out": 10.00}, "gpt-4o-transcribe": {"in": 2.50, "out": 10.00, "audio_min": 0.006}, "gpt-4o-mini-transcribe": {"in": 1.25, "out": 5.00, "audio_min": 0.003}}', '2026-10-11 00:00+03', 'USD per million tokens (and per audio minute) for the cost log; provider list prices on 11 October 2026', null),
  ('ai_turn_max_calls', '2', '2026-10-11 00:00+03', 'Model calls per customer turn: one, plus one escalation retry (DECISIONS §4)', null),
  ('ai_turn_max_ms', '8000', '2026-10-11 00:00+03', 'Time cap per customer turn before a short question or handoff (DECISIONS §4)', null),
  ('ai_turn_max_usd', '0.03', '2026-10-11 00:00+03', 'Cost cap per customer turn (DECISIONS §4)', null),
  ('ai_customer_daily_usd', '0.50', '2026-10-11 00:00+03', 'AI spend per customer per Beirut day before the bot hands off (DECISIONS §4, §29.5)', null),
  ('ai_customer_daily_calls', '80', '2026-10-11 00:00+03', 'Model calls per customer per Beirut day (DECISIONS §29.5)', null),
  ('ai_global_daily_usd', '10', '2026-10-11 00:00+03', 'AI spend across all customers per Beirut day; above it only deterministic paths run and the admin is alerted', null),
  ('voice_max_seconds', '300', '2026-10-11 00:00+03', 'Longest voice note transcribed; notes over 60 s are accepted (DECISIONS §30.1.6)', null),
  ('bot_history_turns', '8', '2026-10-11 00:00+03', 'Recent messages kept for the model per customer (cleared after 24 h idle or on "forget my history")', null),
  ('handoff_hours', '12', '2026-10-11 00:00+03', 'The bot stays quiet this long after a handoff unless an operator ends it (DECISIONS §30.6)', null),
  ('support_hours', '{"from": 9, "to": 23}', '2026-10-11 00:00+03', 'Beirut hours when chat is answered within 15 minutes (DECISIONS §30.6)', null),
  ('ai_low_confidence_handoff', '2', '2026-10-11 00:00+03', 'Low-confidence turns in one conversation before a handoff (DECISIONS §30.6)', null),
  ('abandoned_basket_reminder_min', '30', '2026-10-11 00:00+03', 'One reminder this long after the last basket activity (DECISIONS §29.3)', null),
  ('quiet_hours', '{"from": 23, "to": 8}', '2026-10-11 00:00+03', 'No reminders or ratings between these Beirut hours (DECISIONS §29.3)', null),
  ('rating_delay_min', '30', '2026-10-11 00:00+03', 'The rating message goes this long after delivery (DECISIONS §30.2.3)', null),
  ('delivery_code_over_usd', '50', '2026-10-11 00:00+03', 'Orders above this total need the 4-digit customer code at handover (DECISIONS §27.6)', null),
  ('eta_range_extra_min', '10', '2026-10-11 00:00+03', 'Width added to the top of the ETA range until learned statistics narrow it (DECISIONS §28.2)', null),
  ('customer_bot_enabled', 'true', '2026-10-11 00:00+03', 'Kill switch for the customer bot; when false customers get a short "back soon" reply', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- Small helpers.
create function app_private.config_bool(p_key text) returns boolean
language sql stable set search_path = ''
as $$ select coalesce((public.config_value(p_key) #>> '{}')::boolean, false) $$;

create function app_private.config_text(p_key text) returns text
language sql stable set search_path = ''
as $$ select public.config_value(p_key) #>> '{}' $$;

-- Beirut hour now, for quiet hours and support hours.
create function app_private.beirut_hour(p_at timestamptz default now()) returns integer
language sql stable set search_path = ''
as $$ select extract(hour from p_at at time zone 'Asia/Beirut')::integer $$;

create function app_private.in_quiet_hours(p_at timestamptz default now()) returns boolean
language sql stable set search_path = ''
as $$
  select case when (q ->> 'from')::int > (q ->> 'to')::int
              then app_private.beirut_hour(p_at) >= (q ->> 'from')::int or app_private.beirut_hour(p_at) < (q ->> 'to')::int
              else app_private.beirut_hour(p_at) >= (q ->> 'from')::int and app_private.beirut_hour(p_at) < (q ->> 'to')::int end
  from (select public.config_value('quiet_hours') as q) c
$$;
revoke all on function app_private.config_bool(text), app_private.config_text(text), app_private.beirut_hour(timestamptz),
  app_private.in_quiet_hours(timestamptz) from public;

-- Order columns used below: the 4-digit delivery code (§27.6, section 9) and the customer's feedback (section 10).
alter table public.orders
  add column if not exists delivery_code text check (delivery_code ~ '^[0-9]{4}$'),
  add column if not exists delivery_code_required boolean not null default false,
  add column if not exists delivery_code_confirmed_at timestamptz,
  add column if not exists customer_received_at timestamptz,
  add column if not exists customer_problem_at timestamptz;

-- 2. Bot sessions and turns ---------------------------------------------------------------------------------
-- Conversation state per customer. `refs` maps the short references the model sees (v1, i3, l2, a1, o1)
-- to record ids; a model can only name what the server showed it. `history` holds the last few messages
-- (personal data: cleared after 24 h idle and on "forget my history").
create table public.bot_sessions (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  lang public.lang_code,
  focus_vendor_id uuid references public.vendors (id) on delete set null,
  pending jsonb not null default '{}' check (jsonb_typeof(pending) = 'object'),
  refs jsonb not null default '{}' check (jsonb_typeof(refs) = 'object'),
  history jsonb not null default '[]' check (jsonb_typeof(history) = 'array'),
  low_confidence integer not null default 0 check (low_confidence >= 0),
  handoff_until timestamptz,
  handoff_reason text check (char_length(handoff_reason) <= 300),
  last_turn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger bot_sessions_touch before update on public.bot_sessions
  for each row execute function app_private.touch_updated_at();

-- One row per inbound customer message: dedupe (a queue redelivery is a no-op) and the latency and cost
-- record behind §4's targets. No message text is stored here.
create table public.bot_turns (
  message_id text primary key check (char_length(message_id) between 1 and 200),
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]+$'),
  path text check (path in ('deterministic', 'model', 'voice', 'handoff', 'budget', 'error')),
  model_calls smallint not null default 0,
  tools text[] not null default '{}',
  cost_usd numeric(10, 6) not null default 0,
  latency_ms integer,
  received_at timestamptz not null default now(),
  finished_at timestamptz
);
create index bot_turns_customer_idx on public.bot_turns (customer_id, received_at desc);
create index bot_turns_received_idx on public.bot_turns (received_at);

alter table public.bot_sessions enable row level security;
alter table public.bot_turns enable row level security;
revoke all on table public.bot_sessions, public.bot_turns from public, anon, authenticated;
grant all on table public.bot_sessions, public.bot_turns to service_role;
grant select on table public.bot_sessions, public.bot_turns to authenticated;
create policy bot_sessions_operator_read on public.bot_sessions for select to authenticated using ((select app_private.is_operator()));
create policy bot_turns_operator_read on public.bot_turns for select to authenticated using ((select app_private.is_operator()));

-- Begins a customer turn in one call: the customer (created on first contact), the session (history
-- cleared after 24 h idle), the open basket, active orders and the memory profile. A message id seen
-- before returns duplicate = true and nothing else.
create function public.customer_turn_begin(
  p_phone_e164 text,
  p_message_id text,
  p_kind text,
  p_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_session public.bot_sessions%rowtype;
  v_first boolean := false;
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

  insert into public.bot_turns (message_id, customer_id, kind) values (p_message_id, v_customer.id, left(p_kind, 40))
  on conflict (message_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
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

-- Saves the session after a turn and finishes the turn record. History is trimmed to the configured length.
create function public.customer_turn_end(
  p_customer_id uuid,
  p_message_id text,
  p_session jsonb,
  p_path text,
  p_model_calls integer,
  p_tools text[],
  p_cost_usd numeric,
  p_latency_ms integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep integer := public.config_numeric('bot_history_turns')::integer;
  v_hist jsonb := coalesce(p_session -> 'history', '[]');
begin
  if jsonb_array_length(v_hist) > v_keep then
    select coalesce(jsonb_agg(e order by n), '[]') into v_hist
    from jsonb_array_elements(v_hist) with ordinality as t (e, n)
    where n > jsonb_array_length(v_hist) - v_keep;
  end if;
  update public.bot_sessions set
    lang = coalesce((p_session ->> 'lang')::public.lang_code, lang),
    focus_vendor_id = case when p_session ? 'focus_vendor_id' then (p_session ->> 'focus_vendor_id')::uuid else focus_vendor_id end,
    pending = coalesce(p_session -> 'pending', pending),
    refs = coalesce(p_session -> 'refs', refs),
    history = v_hist,
    low_confidence = coalesce((p_session ->> 'low_confidence')::integer, low_confidence)
  where customer_id = p_customer_id;
  if p_session ? 'lang' then
    update public.customers set language = (p_session ->> 'lang')::public.lang_code
    where id = p_customer_id and language is distinct from (p_session ->> 'lang')::public.lang_code;
  end if;
  update public.bot_turns set path = p_path, model_calls = coalesce(p_model_calls, 0), tools = coalesce(p_tools, '{}'),
    cost_usd = coalesce(p_cost_usd, 0), latency_ms = p_latency_ms, finished_at = now()
  where message_id = p_message_id;
end;
$$;

-- 3. AI calls and the atomic usage quota (§29.5: one database call, never read-then-write) -----------------
create table public.ai_calls (
  id bigint generated always as identity primary key,
  customer_id uuid references public.customers (id) on delete set null,
  purpose text not null check (purpose in ('customer_turn', 'voice_transcribe', 'voice_normalise', 'eval', 'merchant')),
  model text not null check (char_length(model) <= 80),
  reserved_usd numeric(10, 6) not null default 0,
  input_tokens integer,
  output_tokens integer,
  audio_seconds numeric(7, 1),
  cost_usd numeric(10, 6),
  latency_ms integer,
  ok boolean,
  error text check (char_length(error) <= 300),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_calls_created_idx on public.ai_calls (created_at);
create index ai_calls_customer_idx on public.ai_calls (customer_id, created_at desc) where customer_id is not null;

-- Running totals per Beirut day: one row for everyone ('*') and one per customer.
create table public.ai_usage_daily (
  day date not null,
  scope text not null check (char_length(scope) <= 60),
  calls integer not null default 0,
  usd numeric(12, 6) not null default 0,
  primary key (day, scope)
);

alter table public.ai_calls enable row level security;
alter table public.ai_usage_daily enable row level security;
revoke all on table public.ai_calls, public.ai_usage_daily from public, anon, authenticated;
grant all on table public.ai_calls, public.ai_usage_daily to service_role;
grant select on table public.ai_calls, public.ai_usage_daily to authenticated;
create policy ai_calls_operator_read on public.ai_calls for select to authenticated using ((select app_private.is_operator()));
create policy ai_usage_daily_operator_read on public.ai_usage_daily for select to authenticated using ((select app_private.is_operator()));

-- Reserves one model call and its estimated cost against the customer's and the global daily caps, in one
-- call. Each counter moves only inside a conditional upsert, so two concurrent turns cannot both pass the
-- last unit. Returns {"ok": true, "call_id"} or {"ok": false, "reason": "customer_cap" | "global_cap"}.
create function public.ai_quota_take(p_customer_id uuid, p_purpose text, p_model text, p_est_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Beirut')::date;
  v_scope text := coalesce(p_customer_id::text, 'system');
  v_cust_usd numeric := public.config_numeric('ai_customer_daily_usd');
  v_cust_calls numeric := public.config_numeric('ai_customer_daily_calls');
  v_global_usd numeric := public.config_numeric('ai_global_daily_usd');
  v_est numeric := greatest(coalesce(p_est_usd, 0), 0);
  v_hit boolean;
  v_id bigint;
begin
  if p_customer_id is not null then
    insert into public.ai_usage_daily as u (day, scope, calls, usd) values (v_day, v_scope, 1, v_est)
    on conflict (day, scope) do update set calls = u.calls + 1, usd = u.usd + v_est
      where u.calls + 1 <= v_cust_calls and u.usd + v_est <= v_cust_usd
    returning true into v_hit;
    if v_hit is null then
      return jsonb_build_object('ok', false, 'reason', 'customer_cap');
    end if;
  end if;
  v_hit := null;
  insert into public.ai_usage_daily as u (day, scope, calls, usd) values (v_day, '*', 1, v_est)
  on conflict (day, scope) do update set calls = u.calls + 1, usd = u.usd + v_est
    where u.usd + v_est <= v_global_usd
  returning true into v_hit;
  if v_hit is null then
    if p_customer_id is not null then
      update public.ai_usage_daily set calls = calls - 1, usd = usd - v_est where day = v_day and scope = v_scope;
    end if;
    perform app_private.ops_alert('ai_budget:' || v_day, 'ai_budget', 'warning',
      'Daily AI budget reached: only deterministic replies until midnight Beirut time');
    return jsonb_build_object('ok', false, 'reason', 'global_cap');
  end if;
  insert into public.ai_calls (customer_id, purpose, model, reserved_usd) values (p_customer_id, p_purpose, left(p_model, 80), v_est)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'call_id', v_id);
end;
$$;

-- Records the real usage of a reserved call and moves the counters by the difference.
create function public.ai_call_finish(
  p_call_id bigint,
  p_input_tokens integer,
  p_output_tokens integer,
  p_audio_seconds numeric,
  p_latency_ms integer,
  p_ok boolean,
  p_error text default null
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.ai_calls%rowtype;
  v_price jsonb;
  v_cost numeric;
  v_day date;
begin
  select * into v_call from public.ai_calls where id = p_call_id for update;
  if v_call.id is null or v_call.finished_at is not null then
    return null;
  end if;
  v_price := public.config_value('ai_model_prices') -> v_call.model;
  v_cost := round(coalesce(p_input_tokens, 0) * coalesce((v_price ->> 'in')::numeric, 0) / 1e6
    + coalesce(p_output_tokens, 0) * coalesce((v_price ->> 'out')::numeric, 0) / 1e6
    + coalesce(p_audio_seconds, 0) / 60.0 * coalesce((v_price ->> 'audio_min')::numeric, 0), 6);
  update public.ai_calls set input_tokens = p_input_tokens, output_tokens = p_output_tokens, audio_seconds = p_audio_seconds,
    cost_usd = v_cost, latency_ms = p_latency_ms, ok = p_ok, error = left(p_error, 300), finished_at = now()
  where id = p_call_id;
  v_day := (v_call.created_at at time zone 'Asia/Beirut')::date;
  update public.ai_usage_daily set usd = usd + (v_cost - v_call.reserved_usd)
  where day = v_day and scope in ('*', coalesce(v_call.customer_id::text, 'system'));
  return v_cost;
end;
$$;

-- 4. Customer memory profile (§30.1.5) ------------------------------------------------------------------------
alter table public.customers add column if not exists profile_reset_at timestamptz;

-- Dietary and other choices the customer stated themselves ("I'm vegetarian", "no pork"). Never guessed.
create table public.customer_preferences (
  customer_id uuid not null references public.customers (id) on delete cascade,
  key text not null check (key in ('vegetarian', 'vegan', 'no_pork', 'no_alcohol', 'fasting', 'allergy', 'spice', 'note')),
  value text not null check (char_length(value) between 1 and 120),
  stated_at timestamptz not null default now(),
  primary key (customer_id, key)
);
alter table public.customer_preferences enable row level security;
revoke all on table public.customer_preferences from public, anon, authenticated;
grant all on table public.customer_preferences to service_role;
grant select, delete on table public.customer_preferences to authenticated;
create policy customer_preferences_owner on public.customer_preferences for select to authenticated
  using ((select app_private.is_operator())
         or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));
create policy customer_preferences_owner_delete on public.customer_preferences for delete to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));

create function public.customer_preference_set(p_customer_id uuid, p_key text, p_value text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.customer_preferences (customer_id, key, value) values (p_customer_id, p_key, left(trim(p_value), 120))
  on conflict (customer_id, key) do update set value = excluded.value, stated_at = now();
$$;

-- A short structured profile passed to the model, never recited (§30.1.5). Orders before a
-- "forget my history" are ignored.
create function public.customer_profile(p_customer_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from public.customers where id = p_customer_id),
  o as (
    select o.* from public.orders o, c
    where o.customer_id = c.id and o.status = 'delivered' and (c.profile_reset_at is null or o.created_at > c.profile_reset_at)
  )
  select jsonb_build_object(
    'delivered_orders', (select count(*) from o),
    'usual_vendors', coalesce((
      select jsonb_agg(x order by x ->> 'n' desc) from (
        select jsonb_build_object('vendor_id', v.id, 'name', coalesce(v.name_ar, v.name_en), 'n', count(*)) as x
        from o join public.vendors v on v.id = o.vendor_id group by v.id order by count(*) desc limit 3) s), '[]'),
    'usual_items', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('item_id', i.item_id, 'name', coalesce(i.name_ar, i.name_en), 'n', sum(i.quantity)) as x
        from o join public.order_items i on i.order_id = o.id group by i.item_id, coalesce(i.name_ar, i.name_en)
        order by sum(i.quantity) desc limit 5) s), '[]'),
    'last_order_id', (select o.id from o order by o.created_at desc limit 1),
    'usual_hour', (select mode() within group (order by extract(hour from o.created_at at time zone 'Asia/Beirut')::int) from o),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object('address_id', a.id, 'label', a.label, 'place', coalesce(p.name_ar, p.name_en),
        'place_en', coalesce(p.name_en, p.name_ar), 'default', a.is_default) order by a.is_default desc, a.last_used_at desc nulls last)
      from public.addresses a join public.places p on p.id = a.place_id where a.customer_id = p_customer_id), '[]'),
    'language', (select language from c),
    'preferences', coalesce((select jsonb_object_agg(key, value) from public.customer_preferences where customer_id = p_customer_id), '{}')
  );
$$;

-- "Forget my history" clears the profile, preferences and the bot's memory; "delete my data" also removes
-- addresses, door points and location evidence (§28.3) and opts out of marketing. Orders stay: they are
-- the merchant's and the ledger's records. Never depends on the model (alo-ai-tool-safety).
create function public.customer_forget(p_customer_id uuid, p_scope text) returns jsonb
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
    v_loc := public.location_forget_customer(p_customer_id);
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now(), display_name = null
    where id = p_customer_id;
  end if;
  return jsonb_build_object('status', 'forgotten', 'scope', p_scope, 'location', v_loc);
end;
$$;

-- Marketing consent changes only by the customer's own words or tap ("STOP", a consent button), never by
-- the model (§18.3, alo-ai-tool-safety).
create function public.customer_marketing_set(p_customer_id uuid, p_opt_in boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_opt_in then
    update public.customers set marketing_opt_in = true, marketing_opt_in_at = now() where id = p_customer_id;
  else
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now() where id = p_customer_id;
  end if;
  return jsonb_build_object('marketing_opt_in', p_opt_in);
end;
$$;

-- 5. Discovery ----------------------------------------------------------------------------------------------
-- Orderable vendors near a point (straight line within the delivery limit as a prefilter; the road check
-- is the basket quote's), matched by name, cuisine tag, business type or a dish on the menu. Unclaimed
-- and seed vendors are never returned (§15.1). Paused vendors come last with their reopening time.
create function public.vendor_search(
  p_query text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_business_type public.business_type default null,
  p_cuisine text default null,
  p_limit integer default 5
)
returns table (
  vendor_id uuid, name_ar text, name_en text, business_type public.business_type, cuisine_tags text[],
  is_open boolean, paused_until timestamptz, straight_km numeric, vendor_lat double precision, vendor_lon double precision,
  matched text, score real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(app_private.normalize_place_name(coalesce(p_query, '')), '') as n,
           case when p_lat is not null and p_lon is not null then app_private.lat_lon_point(p_lat, p_lon) end as pt,
           public.max_delivery_km() as max_km
  ),
  base as (
    select v.*, q.n, q.pt,
      case when q.pt is not null then extensions.st_distance(v.location, q.pt) / 1000.0 end as km,
      least(coalesce(v.delivery_radius_km, q.max_km), q.max_km) as limit_km
    from public.vendors v cross join q
    where v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.delivery_enabled
      and (p_business_type is null or v.business_type = p_business_type)
      and (p_cuisine is null or p_cuisine = any (v.cuisine_tags))
  ),
  scored as (
    select b.*,
      case when b.n is null then 0.5::real else greatest(
        extensions.word_similarity(b.n, app_private.normalize_place_name(coalesce(b.name_ar, '') || ' ' || coalesce(b.name_en, '') || ' ' || coalesce(b.name_fr, ''))),
        case when exists (select 1 from unnest(b.cuisine_tags) t where b.n like '%' || replace(t, '_', ' ') || '%'
                          or replace(t, '_', ' ') like '%' || b.n || '%') then 0.8 else 0 end,
        0.9 * coalesce((select max(extensions.word_similarity(b.n, app_private.normalize_place_name(
                 coalesce(i.name_ar, '') || ' ' || coalesce(i.name_en, '') || ' ' || coalesce(i.name_fr, ''))))
               from public.menu_items i where i.vendor_id = b.id and i.available), 0)
      )::real end as sc,
      case when b.n is null then 'nearby'
           when extensions.word_similarity(b.n, app_private.normalize_place_name(coalesce(b.name_ar, '') || ' ' || coalesce(b.name_en, ''))) >= 0.6 then 'name'
           when exists (select 1 from unnest(b.cuisine_tags) t where b.n like '%' || replace(t, '_', ' ') || '%') then 'cuisine'
           else 'dish' end as why
    from base b
    where b.pt is null or b.km <= b.limit_km
  )
  select s.id, s.name_ar, s.name_en, s.business_type, s.cuisine_tags,
    not (s.paused_until is not null and s.paused_until > now()), s.paused_until, round(s.km::numeric, 2),
    extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry), s.why, s.sc
  from scored s
  where s.n is null or s.sc >= 0.35
  order by (s.paused_until is not null and s.paused_until > now()), s.sc desc, s.km nulls last, s.id
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

-- One page of a vendor's menu for the bot: orderable items with server prices, "last few", options flag.
create function public.vendor_menu(
  p_vendor_id uuid,
  p_query text default null,
  p_section_id uuid default null,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  item_id uuid, section_id uuid, section_name text, name_ar text, name_en text, name_fr text, price_usd numeric,
  pricing_unit public.pricing_unit, est_weight_kg numeric, orderable boolean, last_few boolean, has_options boolean,
  container_deposit_usd numeric, vegetarian boolean, vegan boolean, contains_pork boolean, contains_alcohol boolean,
  spicy_level smallint, allergens public.allergen[], score real, total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select nullif(app_private.normalize_place_name(coalesce(p_query, '')), '') as n),
  items as (
    select i.*, s.name_ar as s_ar, s.name_en as s_en, s.sort_order as s_sort,
      case when q.n is null then 1::real else extensions.word_similarity(q.n, app_private.normalize_place_name(
        coalesce(i.name_ar, '') || ' ' || coalesce(i.name_en, '') || ' ' || coalesce(i.name_fr, '') || ' ' || coalesce(i.description, ''))) end as sc
    from public.menu_items i
    left join public.menu_sections s on s.id = i.section_id
    cross join q
    where i.vendor_id = p_vendor_id
      and (p_section_id is null or i.section_id = p_section_id)
      and exists (select 1 from public.vendors v where v.id = p_vendor_id and v.orderable and v.listing_status = 'active')
  ),
  kept as (
    select * from items where sc >= case when p_query is null then 0 else 0.3 end
  )
  select k.id, k.section_id, coalesce(k.s_ar, k.s_en), k.name_ar, k.name_en, k.name_fr, k.price_usd, k.pricing_unit, k.est_weight_kg,
    app_private.menu_item_orderable(k.id, 1),
    k.daily_remaining is not null and k.daily_date = current_date and k.daily_remaining <= public.config_numeric('daily_qty_low_threshold'),
    exists (select 1 from public.menu_option_groups g where g.item_id = k.id),
    k.container_deposit_usd, k.vegetarian, k.vegan, k.contains_pork, k.contains_alcohol, k.spicy_level, k.allergens, k.sc,
    count(*) over ()
  from kept k
  order by k.sc desc, k.s_sort nulls last, k.sort_order, k.id
  limit least(greatest(coalesce(p_limit, 10), 1), 30) offset greatest(coalesce(p_offset, 0), 0);
$$;

create function public.menu_item_options(p_item_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('group_id', g.id, 'name', coalesce(g.name_ar, g.name_en, g.name_fr), 'name_en', g.name_en,
    'min', g.min_select, 'max', g.max_select,
    'options', (select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'name', coalesce(o.name_ar, o.name_en, o.name_fr),
      'name_en', o.name_en, 'price_delta_usd', o.price_delta_usd) order by o.sort_order, o.id), '[]')
      from public.menu_options o where o.group_id = g.id and o.available)) order by g.sort_order, g.id), '[]')
  from public.menu_option_groups g where g.item_id = p_item_id;
$$;

-- 6. Baskets ----------------------------------------------------------------------------------------------------
alter table public.baskets
  add column if not exists source text not null default 'chat' check (source in ('chat', 'reorder', 'web')),
  add column if not exists reminded_at timestamptz,
  add column if not exists upsell_shown_at timestamptz;

-- The customer's open basket with names, server prices and the vendor, or null.
create function public.basket_view(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_priced jsonb;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return null;
  end if;
  v_priced := public.basket_price(v_basket.id);
  return jsonb_build_object(
    'basket_id', v_basket.id, 'vendor_id', v_basket.vendor_id,
    'vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id),
    'vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_basket.vendor_id),
    'fulfilment', v_basket.fulfilment, 'address_id', v_basket.address_id, 'payment_method', v_basket.payment_method,
    'stairs_floors', v_basket.stairs_floors, 'note', v_basket.customer_note, 'source', v_basket.source,
    'menu_version', v_priced -> 'menu_version', 'subtotal_usd', v_priced -> 'subtotal_usd',
    'unavailable', v_priced -> 'unavailable', 'changed', v_priced -> 'changed',
    'usd_lbp_rate', public.usd_lbp_rate(),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('line_id', bi.id, 'item_id', bi.item_id, 'name', coalesce(i.name_ar, i.name_en, i.name_fr),
        'name_en', coalesce(i.name_en, i.name_ar), 'quantity', bi.quantity, 'unit_price_usd', bi.unit_price_usd,
        'line_total_usd', bi.line_total_usd, 'estimated', i.pricing_unit = 'kg', 'needs_empty_answer',
        i.container_deposit_usd is not null and bi.has_empty is null, 'deposit_usd', i.container_deposit_usd, 'has_empty', bi.has_empty,
        'options', (select coalesce(jsonb_agg(coalesce(o.name_ar, o.name_en)), '[]') from public.menu_options o where o.id = any (bi.option_ids)))
        order by bi.created_at, bi.id)
      from public.basket_items bi join public.menu_items i on i.id = bi.item_id where bi.basket_id = v_basket.id), '[]')
  );
end;
$$;

-- Adds an item. A basket holds one vendor (§alo-order-flow); an item from another vendor returns
-- other_vendor unless p_replace starts a new basket. The same item with the same options adds quantity.
create function public.basket_add_item(
  p_customer_id uuid,
  p_item_id uuid,
  p_quantity integer default 1,
  p_option_ids uuid[] default '{}',
  p_note text default null,
  p_replace boolean default false
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
  return jsonb_build_object('status', 'added', 'line_id', v_line, 'basket', public.basket_view(p_customer_id));
end;
$$;

-- Sets a line's quantity; 0 removes it. Only the basket's owner can change it.
create function public.basket_set_quantity(p_customer_id uuid, p_line_id uuid, p_quantity integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket_id uuid;
begin
  select b.id into v_basket_id from public.basket_items bi join public.baskets b on b.id = bi.basket_id
  where bi.id = p_line_id and b.customer_id = p_customer_id and b.status = 'open' for update of b;
  if v_basket_id is null then
    return jsonb_build_object('status', 'unknown_line');
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    delete from public.basket_items where id = p_line_id;
  else
    update public.basket_items set quantity = least(p_quantity, 50) where id = p_line_id;
  end if;
  update public.baskets set last_activity_at = now(), reminded_at = null where id = v_basket_id;
  return jsonb_build_object('status', 'updated', 'basket', public.basket_view(p_customer_id));
end;
$$;

create function public.basket_clear(p_customer_id uuid) returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
  select jsonb_build_object('status', 'cleared');
$$;

-- Checkout fields. Payment stays COD until online collection is on (order_place enforces it).
create function public.basket_set_checkout(
  p_customer_id uuid,
  p_fulfilment public.fulfilment_kind default null,
  p_address_id uuid default null,
  p_stairs_floors integer default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if p_address_id is not null and not exists (select 1 from public.addresses a where a.id = p_address_id and a.customer_id = p_customer_id) then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  update public.baskets set
    fulfilment = coalesce(p_fulfilment, fulfilment),
    address_id = coalesce(p_address_id, address_id),
    stairs_floors = case when p_stairs_floors is null then stairs_floors when p_stairs_floors <= 0 then null else least(p_stairs_floors, 30) end,
    customer_note = coalesce(left(nullif(trim(p_note), ''), 300), customer_note),
    last_activity_at = now()
  where id = v_basket.id;
  if p_address_id is not null then
    update public.addresses set last_used_at = now() where id = p_address_id;
  end if;
  return jsonb_build_object('status', 'updated', 'basket', public.basket_view(p_customer_id));
end;
$$;

-- "Do you have an empty to return?" (§29.2), per line.
create function public.basket_set_empty(p_customer_id uuid, p_line_id uuid, p_has_empty boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.basket_items bi set has_empty = p_has_empty
  from public.baskets b where b.id = bi.basket_id and bi.id = p_line_id and b.customer_id = p_customer_id and b.status = 'open';
  if not found then
    return jsonb_build_object('status', 'unknown_line');
  end if;
  return jsonb_build_object('status', 'updated', 'basket', public.basket_view(p_customer_id));
end;
$$;

-- The delivery quote for the open basket. Road distance from the route cache only (§1, §28.6); a missing
-- route returns no_route with both points so the caller can fetch it from OpenRouteService and ask again.
create function public.basket_quote(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_view jsonb;
  v_route record;
  v_quote record;
  v_subtotal numeric;
  v_deposit numeric;
  v_stairs numeric := 0;
  v_fee numeric := 0;
  v_total numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_new boolean;
  v_cap numeric;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  v_view := public.basket_view(p_customer_id);
  if jsonb_array_length(v_view -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  select * into v_vendor from public.vendors where id = v_basket.vendor_id;
  v_subtotal := (v_view ->> 'subtotal_usd')::numeric;
  select coalesce(sum(case when (l ->> 'has_empty')::boolean is false then (l ->> 'deposit_usd')::numeric * (l ->> 'quantity')::int else 0 end), 0)
    into v_deposit from jsonb_array_elements(v_view -> 'lines') l;
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address', 'basket', v_view);
    end if;
    if (select p.service_status from public.places p where p.id = v_address.place_id) = 'paused' then
      return jsonb_build_object('status', 'place_paused', 'basket', v_view);
    end if;
    select * into v_route from public.route_cache_lookup(
      extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
      array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]);
    if v_route.distance_m is null then
      return jsonb_build_object('status', 'no_route', 'basket', v_view,
        'origin', jsonb_build_object('lat', extensions.st_y(v_vendor.location::extensions.geometry), 'lon', extensions.st_x(v_vendor.location::extensions.geometry)),
        'dest', jsonb_build_object('lat', extensions.st_y(v_address.pin::extensions.geometry), 'lon', extensions.st_x(v_address.pin::extensions.geometry)));
    end if;
    select * into v_quote from public.delivery_quote(v_vendor.id, round(v_route.distance_m / 1000.0, 2));
    if not v_quote.deliverable then
      return jsonb_build_object('status', v_quote.reason, 'basket', v_view, 'limit_km', v_quote.limit_km,
        'road_km', v_quote.road_km, 'pickup_enabled', v_vendor.pickup_enabled);
    end if;
    v_fee := v_quote.fee_usd;
    if v_basket.stairs_floors is not null and v_vendor.stairs_fee_per_floor_usd is not null then
      v_stairs := v_basket.stairs_floors * v_vendor.stairs_fee_per_floor_usd;
    end if;
  end if;
  v_total := v_subtotal + v_fee + v_deposit + v_stairs;
  v_new := not exists (select 1 from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered');
  v_cap := public.config_numeric('cod_cap_usd');
  if v_new then
    v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
  end if;
  return jsonb_build_object('status', 'ok', 'basket', v_view, 'subtotal_usd', v_subtotal, 'delivery_fee_usd', v_fee,
    'deposit_usd', v_deposit, 'stairs_fee_usd', v_stairs, 'total_usd', v_total, 'usd_lbp_rate', v_rate,
    'total_lbp', round(v_total * v_rate, 0), 'road_km', round(v_route.distance_m / 1000.0, 2),
    'cod_cap_usd', v_cap, 'over_cod_cap', v_basket.payment_method = 'cod' and v_total > v_cap,
    'estimated', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'estimated')::boolean),
    'needs_empty_answer', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'needs_empty_answer')::boolean),
    'stairs_fee_per_floor_usd', v_vendor.stairs_fee_per_floor_usd,
    'address', case when v_address.id is not null then public.address_card(v_address.id) end);
end;
$$;

-- "The usual" / reorder: a past order's items into a new basket at today's prices (§30.1.5). No upsell on
-- a reorder (§29.3).
create function public.basket_reorder(p_customer_id uuid, p_order_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_basket uuid;
  v_skipped jsonb := '[]';
  v_line record;
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = p_customer_id;
  if v_order.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if not exists (select 1 from public.vendors v where v.id = v_order.vendor_id and v.orderable and v.listing_status = 'active') then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
  insert into public.baskets (customer_id, vendor_id, address_id, fulfilment, source, upsell_shown_at)
  values (p_customer_id, v_order.vendor_id, v_order.address_id, v_order.fulfilment, 'reorder', now())
  returning id into v_basket;
  for v_line in
    select i.item_id, i.quantity, i.note, i.has_empty,
      coalesce((select array_agg((x ->> 'id')::uuid order by (x ->> 'id')) from jsonb_array_elements(i.options) x), '{}') as opts,
      coalesce(i.name_ar, i.name_en) as name
    from public.order_items i where i.order_id = p_order_id
  loop
    if v_line.item_id is not null and app_private.menu_item_orderable(v_line.item_id, v_line.quantity) then
      insert into public.basket_items (basket_id, item_id, quantity, option_ids, note, has_empty)
      values (v_basket, v_line.item_id, v_line.quantity, v_line.opts, v_line.note, v_line.has_empty);
    else
      v_skipped := v_skipped || to_jsonb(v_line.name);
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'skipped', v_skipped, 'basket', public.basket_view(p_customer_id));
end;
$$;

-- At most one suggestion per order, from the merchant's own items bought together in past orders, never
-- on a reorder (§29.3). Marks the basket so it is never offered twice.
create function public.basket_upsell(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_pick record;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null or v_basket.upsell_shown_at is not null or v_basket.source = 'reorder' then
    return null;
  end if;
  select oi2.item_id, count(*) as n into v_pick
  from public.basket_items bi
  join public.order_items oi on oi.item_id = bi.item_id
  join public.orders o on o.id = oi.order_id and o.status = 'delivered' and o.vendor_id = v_basket.vendor_id
  join public.order_items oi2 on oi2.order_id = o.id and oi2.item_id <> bi.item_id
  where bi.basket_id = v_basket.id
    and oi2.item_id not in (select item_id from public.basket_items where basket_id = v_basket.id)
    and app_private.menu_item_orderable(oi2.item_id, 1)
  group by oi2.item_id
  order by count(*) desc, oi2.item_id
  limit 1;
  update public.baskets set upsell_shown_at = now() where id = v_basket.id;
  if v_pick.item_id is null or v_pick.n < 2 then
    return null;
  end if;
  return (select jsonb_build_object('item_id', i.id, 'name', coalesce(i.name_ar, i.name_en), 'name_en', coalesce(i.name_en, i.name_ar),
    'price_usd', i.price_usd) from public.menu_items i where i.id = v_pick.item_id);
end;
$$;

-- 7. Addresses and location tools (§16, §28.2) -----------------------------------------------------------------
-- The nearest confirmed shared landmark and building and the place, to read an address back (§28.2).
create function public.describe_location(p_lat double precision, p_lon double precision) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select app_private.lat_lon_point(p_lat, p_lon) as pt)
  select jsonb_build_object(
    'place', (select jsonb_build_object('place_id', p.id, 'name_ar', p.name_ar, 'name_en', p.name_en, 'status', p.service_status)
              from q cross join lateral public.place_for_point(q.pt) fp join public.places p on p.id = fp.place_id),
    'landmark', (select jsonb_build_object('name_ar', l.name_ar, 'name_en', l.name_en, 'distance_m', round(extensions.st_distance(l.point, q.pt)))
                 from public.landmarks l, q
                 where l.status = 'confirmed' and l.shared
                   and extensions.st_dwithin(l.point, q.pt, public.config_numeric('loc_landmark_describe_radius_m'))
                 order by l.point operator(extensions.<->) q.pt limit 1),
    'building', (select jsonb_build_object('name_ar', b.name_ar, 'name_en', b.name_en, 'floors', b.floors, 'elevator', b.has_elevator)
                 from public.buildings b, q
                 where b.status = 'confirmed' and b.shared and extensions.st_dwithin(b.entrance_point, q.pt, 30)
                 order by b.entrance_point operator(extensions.<->) q.pt limit 1)
  ) from q;
$$;

-- An address read back: place, nearest confirmed landmark and building, the customer's details.
create function public.address_card(p_address_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('address_id', a.id, 'label', a.label, 'place', coalesce(p.name_ar, p.name_en), 'place_en', coalesce(p.name_en, p.name_ar),
    'place_status', p.service_status, 'building', a.building_text, 'floor', a.floor, 'note', a.note,
    'near', case when a.pin is not null then public.describe_location(extensions.st_y(a.pin::extensions.geometry), extensions.st_x(a.pin::extensions.geometry)) end)
  from public.addresses a join public.places p on p.id = a.place_id where a.id = p_address_id;
$$;

-- Saves a WhatsApp location pin as an address: snapped to its place by polygon (§16). Re-sending a pin
-- within 30 m of a saved address reuses it. No place nearby returns no_place (the bot then offers lists).
create function public.address_save_pin(
  p_customer_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_label text default null,
  p_building text default null,
  p_floor text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pt extensions.geography := app_private.lat_lon_point(p_lat, p_lon);
  v_place record;
  v_id uuid;
begin
  if p_lat is null or p_lon is null or p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7 then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  select a.id into v_id from public.addresses a
  where a.customer_id = p_customer_id and a.pin is not null and extensions.st_dwithin(a.pin, v_pt, 30)
  order by a.pin operator(extensions.<->) v_pt limit 1;
  if v_id is null then
    select * into v_place from public.place_for_point(v_pt);
    if v_place.place_id is null then
      return jsonb_build_object('status', 'no_place');
    end if;
    insert into public.addresses (customer_id, label, place_id, pin, source, building_text, floor, note, is_default)
    values (p_customer_id, left(nullif(trim(p_label), ''), 40), v_place.place_id, v_pt, 'pin', left(nullif(trim(p_building), ''), 120),
      left(nullif(trim(p_floor), ''), 20), left(nullif(trim(p_note), ''), 300),
      not exists (select 1 from public.addresses a where a.customer_id = p_customer_id and a.is_default))
    returning id into v_id;
  end if;
  update public.addresses set last_used_at = now() where id = v_id;
  update public.baskets set address_id = v_id, last_activity_at = now() where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', 'saved', 'address', public.address_card(v_id));
end;
$$;

-- Building, floor and directions for an address ("green gate, 3rd floor"). The note is shown to the next
-- driver at once and is also evidence for the knowledge base (§28.1).
create function public.address_set_details(
  p_customer_id uuid,
  p_address_id uuid,
  p_building text default null,
  p_floor text default null,
  p_note text default null,
  p_label text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.addresses set
    building_text = coalesce(left(nullif(trim(p_building), ''), 120), building_text),
    floor = coalesce(left(nullif(trim(p_floor), ''), 20), floor),
    note = coalesce(left(nullif(trim(p_note), ''), 300), note),
    label = coalesce(left(nullif(trim(p_label), ''), 40), label)
  where id = p_address_id and customer_id = p_customer_id;
  if not found then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  if nullif(trim(p_note), '') is not null then
    insert into public.location_evidence (kind, supporter_kind, customer_id, address_id, place_id, point, text_value)
    select 'address_note', 'customer', p_customer_id, a.id, a.place_id, a.pin, left(trim(p_note), 500)
    from public.addresses a where a.id = p_address_id;
  end if;
  return jsonb_build_object('status', 'updated', 'address', public.address_card(p_address_id));
end;
$$;

-- Ranked candidates for an address text, optionally near a pin (§28.2). Never invents coordinates: every
-- candidate is a row the database already has. Personal candidates (saved addresses) are this customer's
-- only; buildings, landmarks and streets are shared or confirmed knowledge only.
create function public.resolve_location(
  p_text text,
  p_lat double precision default null,
  p_lon double precision default null,
  p_customer_id uuid default null,
  p_limit integer default 5
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select app_private.normalize_place_name(coalesce(p_text, '')) as n,
      case when p_lat is not null and p_lon is not null then app_private.lat_lon_point(p_lat, p_lon) end as pt
  ),
  cands as (
    -- the customer's own saved addresses, by label or place name
    select 'saved_address' as kind, a.id::text as id, a.place_id, coalesce(a.label, p.name_ar, p.name_en) as label_ar,
      coalesce(a.label, p.name_en, p.name_ar) as label_en,
      greatest(extensions.word_similarity(q.n, app_private.normalize_place_name(coalesce(a.label, ''))),
               extensions.word_similarity(q.n, p.search_text)) + 0.15 as score
    from public.addresses a join public.places p on p.id = a.place_id cross join q
    where p_customer_id is not null and a.customer_id = p_customer_id and q.n <> ''
    union all
    -- places, with confirmed learned aliases
    select 'place', sp.id, sp.id, sp.label_ar, sp.label_en, sp.score + case when sp.service_status = 'paused' then -0.05 else 0 end
    from q, public.search_places(p_text, null, 5) sp where q.n <> ''
    union all
    select 'place', pa.place_id, pa.place_id, coalesce(p.name_ar, p.name_en), coalesce(p.name_en, p.name_ar),
      extensions.similarity(q.n, pa.normalized_alias)
    from public.place_aliases pa join public.places p on p.id = pa.place_id cross join q
    where pa.status = 'confirmed' and q.n <> '' and q.n operator(extensions.%) pa.normalized_alias
    union all
    -- shared or confirmed landmarks
    -- the landmark's name (any language or alias) found inside the customer's words
    select 'landmark', l.id::text, l.place_id, coalesce(l.name_ar, l.name_en), coalesce(l.name_en, l.name_ar),
      (select max(extensions.word_similarity(app_private.normalize_place_name(x), q.n)) from unnest(array[l.name_ar, l.name_en] || l.aliases) x where x is not null)
        + case when q.pt is not null and extensions.st_dwithin(l.point, q.pt, 2000) then 0.1 else 0 end
    from public.landmarks l cross join q
    where (l.status = 'confirmed' or l.shared) and q.n <> ''
      and (q.pt is null or extensions.st_dwithin(l.point, q.pt, 15000))
    union all
    select 'building', b.id::text, b.place_id, coalesce(b.name_ar, b.name_en), coalesce(b.name_en, b.name_ar),
      (select max(extensions.word_similarity(app_private.normalize_place_name(x), q.n)) from unnest(array[b.name_ar, b.name_en] || b.aliases) x where x is not null)
        + case when q.pt is not null and extensions.st_dwithin(b.entrance_point, q.pt, 1000) then 0.1 else 0 end
    from public.buildings b cross join q
    where (b.status = 'confirmed' or b.shared) and q.n <> ''
      and (q.pt is null or extensions.st_dwithin(b.entrance_point, q.pt, 15000))
    union all
    select 'street', s.id::text, s.place_id, s.name, s.name, extensions.word_similarity(s.normalized_name, q.n)
    from public.street_aliases s cross join q
    where (s.status = 'confirmed' or s.shared) and q.n <> '' and s.normalized_name operator(extensions.<%) q.n
    union all
    -- the pin's own place
    select 'pin_place', fp.place_id, fp.place_id, coalesce(p.name_ar, p.name_en), coalesce(p.name_en, p.name_ar), 0.7
    from q cross join lateral public.place_for_point(q.pt) fp join public.places p on p.id = fp.place_id
    where q.pt is not null
  ),
  best as (
    select distinct on (kind, id) * from cands where score >= 0.45 order by kind, id, score desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', b.kind, 'id', b.id, 'place_id', b.place_id, 'label_ar', b.label_ar,
    'label_en', b.label_en, 'confidence', round(least(b.score, 1)::numeric, 2),
    'place_status', (select p.service_status from public.places p where p.id = b.place_id)) order by b.score desc), '[]')
  from (select * from best order by score desc limit least(greatest(coalesce(p_limit, 5), 1), 10)) b;
$$;


-- The AI proposes an observation (a landmark, building or street name, a spelling); the server stores it
-- as evidence pinned by this customer's own address and the nightly job promotes it (§28.2). One customer
-- alone never confirms anything shared (§28.1 evidence rules).
create function public.observe_location(
  p_customer_id uuid,
  p_kind text,
  p_text text,
  p_address_id uuid default null,
  p_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addr public.addresses%rowtype;
  v_norm text := app_private.normalize_place_name(coalesce(p_text, ''));
  v_id uuid;
  v_r numeric;
begin
  if p_kind not in ('landmark_name', 'building_name', 'street_name', 'place_alias', 'address_note') then
    return jsonb_build_object('status', 'bad_kind');
  end if;
  if v_norm = '' or char_length(p_text) > 120 then
    return jsonb_build_object('status', 'bad_text');
  end if;
  select * into v_addr from public.addresses a
  where a.customer_id = p_customer_id and (p_address_id is null or a.id = p_address_id) and a.pin is not null
  order by (a.id = p_address_id) desc nulls last, a.last_used_at desc nulls last limit 1;
  if v_addr.id is null then
    return jsonb_build_object('status', 'no_pin');
  end if;
  if p_kind = 'landmark_name' then
    v_r := public.config_numeric('loc_landmark_radius_m');
    select l.id into v_id from public.landmarks l
    where l.normalized_name = v_norm and extensions.st_dwithin(l.point, v_addr.pin, v_r) limit 1;
    if v_id is null then
      insert into public.landmarks (place_id, name_ar, name_en, point, source)
      values (v_addr.place_id, case when p_text ~ '[؀-ۿ]' then trim(p_text) end,
              case when p_text !~ '[؀-ۿ]' then trim(p_text) end, v_addr.pin, 'learned')
      returning id into v_id;
    end if;
    insert into public.location_evidence (kind, supporter_kind, customer_id, order_id, address_id, place_id, landmark_id, point, text_value)
    values ('landmark_name', 'customer', p_customer_id, p_order_id, v_addr.id, v_addr.place_id, v_id, v_addr.pin, trim(p_text));
  elsif p_kind = 'building_name' then
    v_r := public.config_numeric('loc_building_radius_m');
    select b.id into v_id from public.buildings b
    where b.normalized_name = v_norm and extensions.st_dwithin(b.entrance_point, v_addr.pin, v_r) limit 1;
    if v_id is null then
      insert into public.buildings (place_id, name_ar, name_en, entrance_point)
      values (v_addr.place_id, case when p_text ~ '[؀-ۿ]' then trim(p_text) end,
              case when p_text !~ '[؀-ۿ]' then trim(p_text) end, v_addr.pin)
      returning id into v_id;
    end if;
    update public.addresses set building_id = coalesce(building_id, v_id) where id = v_addr.id;
    insert into public.location_evidence (kind, supporter_kind, customer_id, order_id, address_id, place_id, building_id, point, text_value)
    values ('building_name', 'customer', p_customer_id, p_order_id, v_addr.id, v_addr.place_id, v_id, v_addr.pin, trim(p_text));
  elsif p_kind = 'street_name' then
    insert into public.street_aliases (place_id, name) values (v_addr.place_id, trim(p_text))
    on conflict (place_id, normalized_name) do update set updated_at = now()
    returning id into v_id;
    insert into public.location_evidence (kind, supporter_kind, customer_id, order_id, address_id, place_id, street_alias_id, point, text_value)
    values ('street_name', 'customer', p_customer_id, p_order_id, v_addr.id, v_addr.place_id, v_id, v_addr.pin, trim(p_text));
  elsif p_kind = 'place_alias' then
    -- A spelling resolved to a place by the pin (§28.1): only when it is not already the place's name.
    if exists (select 1 from public.places p where p.id = v_addr.place_id and p.search_text like '%' || v_norm || '%') then
      return jsonb_build_object('status', 'known');
    end if;
    insert into public.place_aliases (place_id, alias) values (v_addr.place_id, trim(p_text))
    on conflict (place_id, normalized_alias) do update set updated_at = now()
    returning id into v_id;
    insert into public.location_evidence (kind, supporter_kind, customer_id, order_id, address_id, place_id, place_alias_id, text_value)
    values ('place_alias', 'customer', p_customer_id, p_order_id, v_addr.id, v_addr.place_id, v_id, trim(p_text));
  else
    insert into public.location_evidence (kind, supporter_kind, customer_id, order_id, address_id, place_id, point, text_value)
    values ('address_note', 'customer', p_customer_id, p_order_id, v_addr.id, v_addr.place_id, v_addr.pin, trim(p_text));
  end if;
  return jsonb_build_object('status', 'recorded', 'kind', p_kind);
end;
$$;

-- 8. Tracking (§27.9: "where is my order?" through a typed tool) --------------------------------------------
-- ETA range in minutes: time left to ready (learned prep or the merchant's), plus road time corrected by
-- the learned factor (§28.2), widened at the top until statistics exist.
create function public.order_eta_range(p_order_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_v public.vendors%rowtype;
  v_route record;
  v_travel integer;
  v_ready_s numeric;
  v_low integer;
  v_extra numeric := public.config_numeric('eta_range_extra_min');
begin
  select * into v_o from public.orders where id = p_order_id;
  select * into v_v from public.vendors where id = v_o.vendor_id;
  if v_o.status in ('delivered', 'failed', 'rejected', 'cancelled') then
    return null;
  end if;
  v_ready_s := greatest(extract(epoch from (coalesce(v_o.ready_at, coalesce(v_o.accepted_at, v_o.placed_at, now())
    + make_interval(mins => coalesce(v_o.prep_minutes, v_v.default_prep_minutes))) - now())), 0);
  if v_o.status in ('picked_up', 'near_drop', 'arrived') then
    v_ready_s := 0;
  end if;
  if v_o.fulfilment = 'delivery' and v_o.delivery_pin is not null then
    select * into v_route from public.route_cache_lookup(
      extensions.st_y(v_v.location::extensions.geometry), extensions.st_x(v_v.location::extensions.geometry),
      array[extensions.st_y(v_o.delivery_pin::extensions.geometry)], array[extensions.st_x(v_o.delivery_pin::extensions.geometry)]);
    v_travel := public.eta_travel_s(v_route.duration_s, v_v.town_id, v_o.delivery_place_id);
    if v_o.status in ('near_drop', 'arrived') then
      v_travel := least(coalesce(v_travel, 180), 180);
    end if;
  end if;
  v_low := ceil((v_ready_s + coalesce(v_travel, 0)) / 60.0)::integer;
  return jsonb_build_object('min', greatest(v_low, 1), 'max', greatest(v_low, 1) + v_extra::integer,
    'live', false, 'travel_known', v_travel is not null or v_o.fulfilment = 'pickup');
end;
$$;

-- What the customer may see about their order (never another customer's, never coordinates).
create function public.order_track(p_customer_id uuid, p_order_id uuid default null) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'fulfilment', o.fulfilment,
    'vendor', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
    'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'), 'weight_status', o.weight_status,
    'eta', public.order_eta_range(o.id),
    'driver_assigned', o.driver_member_id is not null,
    'delivery_code', case when o.delivery_code_required and o.status not in ('delivered', 'failed', 'rejected', 'cancelled')
                          then o.delivery_code end,
    'cancel_request', o.cancel_request_status, 'placed_at', o.placed_at)
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  where o.customer_id = p_customer_id and (p_order_id is null or o.id = p_order_id)
  order by (o.status in ('delivered', 'failed', 'rejected', 'cancelled')), o.created_at desc
  limit 1;
$$;

-- 9. Delivery code (§27.6) ----------------------------------------------------------------------------------------
-- Orders over the configured total, and a new customer's first COD order, need the customer's 4-digit code
-- at handover (Send Home orders join in Phase 6b). The merchant or driver types it; an operator can override.

create function app_private.orders_delivery_code() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.delivery_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  new.delivery_code_required := new.total_usd > public.config_numeric('delivery_code_over_usd')
    or (new.is_new_customer and new.payment_method = 'cod');
  return new;
end;
$$;
create trigger orders_delivery_code before insert on public.orders
  for each row execute function app_private.orders_delivery_code();

-- A delivered mark without the code is refused unless an operator makes it (§27.6).
create function app_private.orders_delivery_code_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status <> 'delivered' and new.delivery_code_required
     and new.delivery_code_confirmed_at is null and not app_private.is_operator()
     and coalesce(current_setting('app.delivery_code_override', true), '') <> 'on' then
    raise exception 'delivery_code_required: order % needs the customer''s 4-digit code', new.code using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
-- Named to fire after orders_status_guard (triggers run in name order), so an illegal transition reports that first.
create trigger orders_status_guard_delivery_code before update of status on public.orders
  for each row execute function app_private.orders_delivery_code_guard();

-- The merchant (WhatsApp number) types the code: the matching in-progress order of its vendor is confirmed
-- and marked delivered. Wrong codes are counted in the order events.
create function public.order_confirm_delivery_code(p_phone_e164 text, p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_member uuid;
  v_r jsonb;
begin
  select o.* into v_o from public.orders o
  join public.vendor_members m on m.vendor_id = o.vendor_id and m.phone_e164 = p_phone_e164 and m.status = 'active'
    and m.role in ('owner', 'manager', 'cashier', 'driver')
  where o.delivery_code_required and o.delivery_code_confirmed_at is null and o.delivery_code = p_code
    and o.status in ('ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup', 'picked_up', 'near_drop', 'arrived')
    and (m.role <> 'driver' or o.driver_member_id = m.id)
  order by o.placed_at desc limit 1;
  if v_o.id is null then
    -- A wrong code is logged on each order still waiting for one; after 5 the operator is alerted and only
    -- an operator can close the order (no guessing through 10,000 codes).
    v_r := null;
    for v_o in
      select o.* from public.orders o join public.vendor_members m on m.vendor_id = o.vendor_id and m.phone_e164 = p_phone_e164
        and m.status = 'active'
      where o.delivery_code_required and o.delivery_code_confirmed_at is null
        and o.status in ('ready', 'driver_assigned', 'heading_to_pickup', 'at_pickup', 'picked_up', 'near_drop', 'arrived')
    loop
      insert into public.order_events (order_id, from_status, to_status, event, actor_kind, channel, detail)
      values (v_o.id, v_o.status, v_o.status, 'delivery_code_wrong', 'whatsapp', 'whatsapp', '{}');
      if (select count(*) from public.order_events e where e.order_id = v_o.id and e.event = 'delivery_code_wrong') >= 5 then
        perform app_private.ops_alert('code_wrong:' || v_o.id, 'customer_problem', 'warning',
          'Order ' || v_o.code || ': 5 wrong delivery codes; confirm the handover by phone', v_o.id, v_o.vendor_id);
        v_r := jsonb_build_object('status', 'locked');
      end if;
      v_r := coalesce(v_r, jsonb_build_object('status', 'wrong_code'));
    end loop;
    return coalesce(v_r, jsonb_build_object('status', 'no_order'));
  end if;
  if (select count(*) from public.order_events e where e.order_id = v_o.id and e.event = 'delivery_code_wrong') >= 5 then
    return jsonb_build_object('status', 'locked');
  end if;
  update public.orders set delivery_code_confirmed_at = now() where id = v_o.id;
  v_member := public.merchant_member_for(p_phone_e164, v_o.id);
  v_r := public.order_progress(v_o.id, 'delivered', v_member, 'whatsapp');
  return jsonb_build_object('status', 'delivered', 'code', v_o.code, 'result', v_r);
end;
$$;

-- 10. Customer messages ----------------------------------------------------------------------------------------
-- One outbox row per order change the customer hears about, deduplicated per order and kind. Free-form
-- replies are possible only inside the 24-hour window; outside it the row is kept as skipped until the
-- utility templates are approved on the company number (§3: templates do not run on the sandbox).
create function app_private.customer_notify(p_order_id uuid, p_kind text, p_extra jsonb default '{}', p_dedupe text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_c public.customers%rowtype;
  v_id bigint;
begin
  select * into v_o from public.orders where id = p_order_id;
  select * into v_c from public.customers where id = v_o.customer_id;
  if v_c.id is null then
    return null;
  end if;
  v_id := app_private.outbox_add('cust:' || p_order_id || ':' || coalesce(p_dedupe, p_kind), p_order_id, v_o.vendor_id,
    'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', p_kind, 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id) || coalesce(p_extra, '{}'));
  if v_id is not null and (v_c.last_inbound_at is null or v_c.last_inbound_at < now() - interval '24 hours') then
    update public.outbound_messages set status = 'skipped', last_error = 'outside the 24-hour window: needs an approved utility template'
    where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function app_private.customer_notify(uuid, text, jsonb, text) from public;

create function app_private.orders_customer_messages() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver_phone text;
begin
  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform app_private.customer_notify(new.id, 'accepted', jsonb_build_object('eta', public.order_eta_range(new.id)));
    elsif new.status = 'rejected' then
      perform app_private.customer_notify(new.id, 'rejected', jsonb_build_object('reason', new.reject_reason));
    elsif new.status = 'cancelled' and new.cancel_reason is distinct from 'customer' then
      perform app_private.customer_notify(new.id, 'cancelled', jsonb_build_object('reason', new.cancel_reason));
    elsif new.status = 'picked_up' or (new.status in ('near_drop', 'arrived') and old.status not in ('picked_up', 'near_drop', 'arrived')) then
      select m.phone_e164 into v_driver_phone from public.vendor_members m where m.id = new.driver_member_id;
      perform app_private.customer_notify(new.id, 'on_the_way', jsonb_build_object('eta', public.order_eta_range(new.id),
        'driver_phone', v_driver_phone), 'on_the_way');
    end if;
    if new.status = 'near_drop' then
      select m.phone_e164 into v_driver_phone from public.vendor_members m where m.id = new.driver_member_id;
      perform app_private.customer_notify(new.id, 'near_drop', jsonb_build_object('driver_phone', v_driver_phone,
        'door_confirmed', exists (select 1 from public.door_points d where d.address_id = new.address_id and d.status = 'confirmed')));
    end if;
    if new.status = 'ready' and new.fulfilment = 'pickup' then
      perform app_private.customer_notify(new.id, 'ready_for_pickup');
    end if;
    if new.status = 'delivered' then
      perform app_private.customer_notify(new.id, 'delivered');
    end if;
  end if;
  if new.weight_status = 'awaiting_customer' and old.weight_status is distinct from 'awaiting_customer' then
    perform app_private.customer_notify(new.id, 'weight_confirm', jsonb_build_object('total_usd', new.total_usd,
      'estimated_total_usd', new.estimated_total_usd, 'total_lbp', new.total_lbp));
  end if;
  if new.cancel_request_status is distinct from old.cancel_request_status and new.cancel_request_status = 'refused' then
    perform app_private.customer_notify(new.id, 'cancel_refused');
  end if;
  return null;
end;
$$;
create trigger orders_customer_messages after update of status, weight_status, cancel_request_status on public.orders
  for each row execute function app_private.orders_customer_messages();

-- "Received ✅" and "Problem" on the delivered message. A problem opens a handoff to the operator (§30.6).
create function public.order_customer_feedback(p_customer_id uuid, p_order_id uuid, p_ok boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if p_ok then
    update public.orders set customer_received_at = coalesce(customer_received_at, now()) where id = p_order_id;
    return jsonb_build_object('status', 'received');
  end if;
  update public.orders set customer_problem_at = coalesce(customer_problem_at, now()) where id = p_order_id;
  perform app_private.ops_alert('problem:' || p_order_id, 'customer_problem', 'urgent',
    'Customer reports a problem with order ' || v_o.code, p_order_id, v_o.vendor_id);
  perform public.customer_handoff(p_customer_id, 'problem with order ' || v_o.code, null);
  return jsonb_build_object('status', 'problem');
end;
$$;

-- Ratings from real orders (§30.2.3): food 1-5, plus 👍/👎 for the delivery when the vendor's driver or the
-- fleet delivered. One message, no reminder. Never shown for unclaimed vendors; public only after 20 (Phase 4).
create table public.order_ratings (
  order_id uuid primary key references public.orders (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  food_score smallint check (food_score between 1 and 5),
  delivery_ok boolean,
  driver_member_id uuid references public.vendor_members (id) on delete set null,
  rated_at timestamptz not null default now()
);
create index order_ratings_vendor_idx on public.order_ratings (vendor_id, rated_at desc);
alter table public.order_ratings enable row level security;
revoke all on table public.order_ratings from public, anon, authenticated;
grant all on table public.order_ratings to service_role;
grant select on table public.order_ratings to authenticated;
create policy order_ratings_read on public.order_ratings for select to authenticated
  using ((select app_private.is_operator())
         or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid()))
         or exists (select 1 from public.vendor_members m where m.vendor_id = order_ratings.vendor_id and m.user_id = (select auth.uid())
                    and m.status = 'active' and m.role in ('owner', 'manager')));

create function public.order_rate(p_customer_id uuid, p_order_id uuid, p_food_score integer, p_delivery_ok boolean default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id and status = 'delivered';
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if p_food_score is not null and p_food_score not between 1 and 5 then
    return jsonb_build_object('status', 'bad_score');
  end if;
  insert into public.order_ratings (order_id, customer_id, vendor_id, food_score, delivery_ok, driver_member_id)
  values (p_order_id, p_customer_id, v_o.vendor_id, p_food_score, p_delivery_ok, v_o.driver_member_id)
  on conflict (order_id) do update set food_score = coalesce(excluded.food_score, public.order_ratings.food_score),
    delivery_ok = coalesce(excluded.delivery_ok, public.order_ratings.delivery_ok), rated_at = now();
  return jsonb_build_object('status', 'rated');
end;
$$;

-- 11. Timers: rating message, arrived prompt, abandoned-basket reminder, basket expiry, handoff expiry ----------
create function app_private.customer_bot_tick() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rating numeric := public.config_numeric('rating_delay_min');
  v_reminder numeric := public.config_numeric('abandoned_basket_reminder_min');
  v_ttl numeric := public.config_numeric('basket_ttl_hours');
  v_arrived numeric := public.config_numeric('monitor_arrived_s');
  v_quiet boolean := app_private.in_quiet_hours();
  v_r record;
  v_n integer := 0;
begin
  -- Rating 30 min after delivery, once, never in quiet hours (it waits until morning, still inside 24 h).
  if not v_quiet then
    for v_r in
      select o.id, o.driver_member_id is not null as with_driver from public.orders o
      where o.status = 'delivered' and o.delivered_at < now() - make_interval(mins => v_rating::int)
        and o.delivered_at > now() - interval '20 hours' and o.customer_problem_at is null
        and not exists (select 1 from public.order_ratings r where r.order_id = o.id)
        and not exists (select 1 from public.outbound_messages m where m.dedupe_key = 'cust:' || o.id || ':rating')
      limit 50
    loop
      perform app_private.customer_notify(v_r.id, 'rating', jsonb_build_object('ask_delivery', v_r.with_driver));
      v_n := v_n + 1;
    end loop;
  end if;
  -- Arrived 3 minutes without delivered: the live-location button to the customer (§27.5).
  for v_r in
    select o.id, m.phone_e164 as driver_phone from public.orders o
    left join public.vendor_members m on m.id = o.driver_member_id
    where o.status = 'arrived'
      and (select max(e.at) from public.order_events e where e.order_id = o.id and e.to_status = 'arrived') < now() - make_interval(secs => v_arrived)
      and not exists (select 1 from public.outbound_messages x where x.dedupe_key = 'cust:' || o.id || ':arrived_wait')
  loop
    perform app_private.customer_notify(v_r.id, 'arrived_wait', jsonb_build_object('driver_phone', v_r.driver_phone));
    v_n := v_n + 1;
  end loop;
  -- One abandoned-basket reminder 30 min after the last activity, inside the 24-hour window, never twice,
  -- never in quiet hours (§29.3). Sent as a reply with no order.
  if not v_quiet then
    for v_r in
      select b.id, c.phone_e164, c.language, c.id as customer_id from public.baskets b
      join public.customers c on c.id = b.customer_id
      where b.status = 'open' and b.reminded_at is null
        and b.last_activity_at < now() - make_interval(mins => v_reminder::int)
        and b.last_activity_at > now() - make_interval(hours => v_ttl::int)
        and c.last_inbound_at > now() - interval '23 hours'
        and exists (select 1 from public.basket_items bi where bi.basket_id = b.id)
        and not exists (select 1 from public.bot_sessions s where s.customer_id = c.id and s.handoff_until > now())
      limit 50
    loop
      update public.baskets set reminded_at = now() where id = v_r.id;
      perform app_private.outbox_add('basket_reminder:' || v_r.id, null, null, 'whatsapp', 'customer_message', v_r.phone_e164,
        jsonb_build_object('kind', 'basket_reminder', 'lang', coalesce(v_r.language::text, 'ar'), 'customer_id', v_r.customer_id,
          'basket', public.basket_view(v_r.customer_id)));
      v_n := v_n + 1;
    end loop;
  end if;
  -- Baskets idle past their life expire (§29.3, basket_ttl_hours).
  update public.baskets set status = 'expired'
  where status = 'open' and last_activity_at < now() - make_interval(hours => v_ttl::int);
  -- Handoffs end on their own.
  update public.bot_sessions set handoff_until = null, handoff_reason = null where handoff_until is not null and handoff_until < now();
  return jsonb_build_object('signals', v_n);
end;
$$;
revoke all on function app_private.customer_bot_tick() from public;
select cron.schedule('customer-bot-tick', '30 seconds', 'select app_private.customer_bot_tick()');

-- 12. Human handoff (§30.6) and the sandbox number (§3) ------------------------------------------------------------
-- The bot hands the conversation to Rasheed's inbox with a one-line summary (no phone in the alert) and
-- stays quiet until an operator ends the handoff or it expires.
create function public.customer_handoff(p_customer_id uuid, p_reason text, p_summary text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours numeric := public.config_numeric('handoff_hours');
begin
  insert into public.bot_sessions (customer_id) values (p_customer_id) on conflict (customer_id) do nothing;
  update public.bot_sessions set handoff_until = now() + make_interval(hours => v_hours::int), handoff_reason = left(p_reason, 300),
    low_confidence = 0
  where customer_id = p_customer_id;
  perform app_private.ops_alert('handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24'), 'customer_handoff', 'warning',
    left('Customer needs a person: ' || coalesce(p_summary, p_reason), 300), null, null,
    jsonb_build_object('customer_id', p_customer_id, 'reason', left(p_reason, 300)));
  return jsonb_build_object('status', 'handed_off',
    'support_open', app_private.beirut_hour() >= (public.config_value('support_hours') ->> 'from')::int
                    and app_private.beirut_hour() < (public.config_value('support_hours') ->> 'to')::int);
end;
$$;

-- Service role only for now; the admin conversation view (Phase 4b) calls it through the server.
create function public.customer_handoff_end(p_customer_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bot_sessions set handoff_until = null, handoff_reason = null where customer_id = p_customer_id;
end;
$$;

-- Kapso's sandbox number is the only number until the pilot cut-over (§3). It serves customers and merchants.
insert into public.whatsapp_numbers (phone_number_id, role, active)
values ('597907523413541', 'sandbox', true)
on conflict (phone_number_id) do nothing;

-- Grants: every function here is service-role only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'customer_turn_begin(text, text, text, text)',
    'customer_turn_end(uuid, text, jsonb, text, integer, text[], numeric, integer)',
    'ai_quota_take(uuid, text, text, numeric)',
    'ai_call_finish(bigint, integer, integer, numeric, integer, boolean, text)',
    'customer_preference_set(uuid, text, text)',
    'customer_profile(uuid)',
    'customer_forget(uuid, text)',
    'customer_marketing_set(uuid, boolean)',
    'vendor_search(text, double precision, double precision, public.business_type, text, integer)',
    'vendor_menu(uuid, text, uuid, integer, integer)',
    'menu_item_options(uuid)',
    'basket_view(uuid)',
    'basket_add_item(uuid, uuid, integer, uuid[], text, boolean)',
    'basket_set_quantity(uuid, uuid, integer)',
    'basket_clear(uuid)',
    'basket_set_checkout(uuid, public.fulfilment_kind, uuid, integer, text)',
    'basket_set_empty(uuid, uuid, boolean)',
    'basket_quote(uuid)',
    'basket_reorder(uuid, uuid)',
    'basket_upsell(uuid)',
    'address_card(uuid)',
    'address_save_pin(uuid, double precision, double precision, text, text, text, text)',
    'address_set_details(uuid, uuid, text, text, text, text)',
    'resolve_location(text, double precision, double precision, uuid, integer)',
    'describe_location(double precision, double precision)',
    'observe_location(uuid, text, text, uuid, uuid)',
    'order_eta_range(uuid)',
    'order_track(uuid, uuid)',
    'order_confirm_delivery_code(text, text)',
    'order_customer_feedback(uuid, uuid, boolean)',
    'order_rate(uuid, uuid, integer, boolean)',
    'customer_handoff(uuid, text, text)',
    'customer_handoff_end(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
