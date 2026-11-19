-- 0262 (session AST1): the assistant's daily digest, its settings, what it spends and what it answered.
--
--   settings.assistant      enabled (the panel answers only when true), daily_cap_usd 0.50, monthly_cap_usd 10 (both counted in model_costs,
--                           workflows 'assistant' and 'assistant-digest'), model claude-sonnet-5-5, digest_model claude-haiku-5-5,
--                           max_tool_rounds 4. The three first are on the Settings page (admin). Over a cap the panel says so and stops.
--   assistant_digests       one row per Beirut day: the facts (from assistant_digest_facts, numbers only from the tools of 0261) and the short
--                           text in English and Arabic written from them by the digest model. Today shows the latest; the assistant reads them for
--                           "what happened yesterday / this week". Never sent anywhere (no WhatsApp in this session).
--   assistant_turns         what was asked, the answer shown, the tools it read, its cost: the assistant's own log (service role only).
--   ast_record_cost()       one model call's tokens priced from model_prices_in_force() (a model with no price is refused, as COST1) and added
--                           to today's row of model_costs (workflow, run_id = the Beirut day, model, step). Returns the call's dollars.
--   ast_spend()             today's and this month's spend against the caps, and whether one more answer is allowed.
--   ast_digest_save()       the nightly job's one writer.
-- Read functions here (assistant_digest_facts, assistant_digests) belong to assistant_reader, as 0261's. The writers (ast_*) do not: they
-- write the assistant's own report rows only, never an order, payment, stock level or ledger entry (invariant 3), and only the console
-- Worker (service role) may call them.

insert into settings(key, value) values
  ('assistant', '{"enabled": false, "daily_cap_usd": 0.5, "monthly_cap_usd": 10, "model": "claude-sonnet-5-5", "digest_model": "claude-haiku-5-5", "max_tool_rounds": 4}')
on conflict (key) do nothing;

insert into editable_settings(key, field, kind, min_value, max_value, max_len, choices, two_person, two_person_when) values
  ('assistant', 'enabled',         'bool',   null, null, null, null, false, null),
  ('assistant', 'daily_cap_usd',   'number', 0,    5,    null, null, false, null),
  ('assistant', 'monthly_cap_usd', 'number', 0,    100,  null, null, false, null)
on conflict (key, field) do nothing;

create table if not exists assistant_digests (
  day        date primary key,
  facts      jsonb not null,
  text_en    text,
  text_ar    text,
  model      text,
  usd        numeric(12,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assistant_turns (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid references parties(id),
  role       text not null,
  lang       text not null default 'en',
  question   text not null check (length(question) <= 1000),
  answer     text,
  tools      jsonb not null default '[]'::jsonb,
  model      text,
  usd        numeric(12,6) not null default 0,
  outcome    text not null check (outcome in ('answered', 'unverified', 'over_cap', 'off', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists assistant_turns_party on assistant_turns(party_id, created_at desc);

-- ---------- the digest's facts: numbers only from 0261's tools ----------
create or replace function assistant_digest_facts(p_day date default null, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := coalesce(p_day, (p_now at time zone scheduling_tz())::date);
  v_end timestamptz := least(p_now, ((v_day + 1)::timestamp at time zone scheduling_tz()));
  o jsonb := assistant_orders(v_day, v_end, 5);
  pl jsonb := assistant_places(v_day, v_end);
  st jsonb := assistant_stock(v_end, 3, 5);
  pr jsonb := assistant_products(v_end, 1, 5);
  cu jsonb := assistant_customers(v_day, 1, v_end, 5);
  ap jsonb := assistant_approvals(v_end);
  fix jsonb := '[]'::jsonb;
  v_waiting int := (select coalesce(sum(value::int), 0) from jsonb_each_text(ap->'waiting'));
begin
  -- Candidates for "the top things to fix", each with the figure behind it, most urgent first by a fixed order. The digest model chooses
  -- three of them and words them; it never adds one.
  if (o->>'late_total')::int > 0 then fix := fix || jsonb_build_object('what', 'late orders', 'count', (o->>'late_total')::int, 'by_stage', o->'slowest_stage_counts', 'page', '/orders'); end if;
  if (pl->>'slowest_place_avg_answer_min')::int >= coalesce((pl->>'call_ahead_limit_min')::int, 10) then
    fix := fix || jsonb_build_object('what', 'slow food place', 'place', pl->>'slowest_place', 'avg_answer_min', (pl->>'slowest_place_avg_answer_min')::int, 'page', '/food'); end if;
  if (st->>'temperature_missed_last_7_days')::int > 0 then fix := fix || jsonb_build_object('what', 'temperature readings missed', 'count', (st->>'temperature_missed_last_7_days')::int, 'page', '/temperature'); end if;
  if (st->>'expired')::int > 0 then fix := fix || jsonb_build_object('what', 'expired lots on the shelf', 'count', (st->>'expired')::int, 'page', '/stock'); end if;
  if (cu->>'complaints')::int > 0 then fix := fix || jsonb_build_object('what', 'complaints', 'count', (cu->>'complaints')::int, 'page', '/inbox'); end if;
  if jsonb_array_length(pr->'searches_found_nothing') > 0 then fix := fix || jsonb_build_object('what', 'searches that found nothing', 'count', (pr->>'searches_found_nothing_total')::int, 'top', pr->'searches_found_nothing'->0->>'said', 'page', '/search-words'); end if;
  if jsonb_array_length(cu->'asked_for_and_not_sold') > 0 then fix := fix || jsonb_build_object('what', 'asked for and not sold', 'count', jsonb_array_length(cu->'asked_for_and_not_sold'), 'top', cu->'asked_for_and_not_sold'->0->>'said', 'page', '/catalog'); end if;
  if (st->>'out_of_stock')::int > 0 then fix := fix || jsonb_build_object('what', 'items out of stock', 'count', (st->>'out_of_stock')::int, 'page', '/stock'); end if;
  if v_waiting > 0 then fix := fix || jsonb_build_object('what', 'approvals waiting', 'count', v_waiting, 'page', '/approve'); end if;
  if (pr->>'not_sellable')::int > 0 then fix := fix || jsonb_build_object('what', 'items not sellable', 'count', (pr->>'not_sellable')::int, 'page', '/readiness'); end if;
  return jsonb_build_object(
    'day', v_day,
    'orders', jsonb_build_object('orders', o->'orders', 'cancelled', o->'cancelled', 'grocery', o->'grocery', 'food', o->'food', 'delivered', o->'delivered',
                                 'delivered_on_time', o->'delivered_on_time', 'delivered_late', o->'delivered_late', 'avg_delivery_min', o->'avg_delivery_min',
                                 'late_total', o->'late_total', 'slowest_stage_counts', o->'slowest_stage_counts', 'late', o->'late'),
    'places', jsonb_build_object('calls', pl->'calls', 'accepted', pl->'accepted', 'slowest_place', pl->'slowest_place',
                                 'slowest_place_avg_answer_min', pl->'slowest_place_avg_answer_min', 'closed_today', pl->'closed_today', 'prices_to_confirm', pl->'prices_to_confirm'),
    'stock', jsonb_build_object('out_of_stock', st->'out_of_stock', 'low', st->'low', 'expired', st->'expired', 'expiring', st->'expiring',
                                'receiving_short_units', st->'receiving_short_units', 'receiving_damaged_units', st->'receiving_damaged_units',
                                'temperature_missed_last_7_days', st->'temperature_missed_last_7_days'),
    'searches_found_nothing', pr->'searches_found_nothing',
    'customers', jsonb_build_object('handoffs', cu->'handoffs', 'complaints', cu->'complaints', 'complaints_by_kind', cu->'complaints_by_kind',
                                    'asked_for_and_not_sold', cu->'asked_for_and_not_sold', 'feedback_fine', cu->'feedback_fine', 'feedback_problem', cu->'feedback_problem'),
    'approvals_waiting', ap->'waiting', 'approved_automatically_today', ap->'approved_automatically_today',
    'fix_candidates', fix);
end $$;

-- The digests between two days, newest first (at most 31).
create or replace function assistant_digests(p_from date default null, p_to date default null, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('from', f, 'to', t, 'digests', coalesce((
    select jsonb_agg(jsonb_build_object('day', d.day, 'facts', d.facts, 'text_en', d.text_en, 'text_ar', d.text_ar) order by d.day desc)
      from (select * from assistant_digests where day between f and t order by day desc limit 31) d), '[]'::jsonb),
    'note', case when not exists (select 1 from assistant_digests where day between f and t) then 'no digest was written for these days' end)
  from (select coalesce(p_to, (p_now at time zone scheduling_tz())::date) as t,
               coalesce(p_from, coalesce(p_to, (p_now at time zone scheduling_tz())::date) - 6) as f) x $$;

-- ---------- writers (service role only; not the read-only role) ----------
create or replace function ast_record_cost(p_workflow text, p_model text, p_step text, p_in bigint, p_out bigint, p_cache_read bigint, p_cache_write bigint)
returns numeric language plpgsql set search_path = public, pg_temp as $$
declare pr model_prices%rowtype; v_usd numeric; v_day date := (now() at time zone scheduling_tz())::date; v_long boolean;
begin
  if p_workflow not in ('assistant', 'assistant-digest') then raise exception 'AST_WORKFLOW %', p_workflow; end if;
  select * into pr from model_prices_in_force(v_day) where model = p_model;
  if not found then raise exception 'NO_PRICE: % has no model_prices row', p_model; end if;
  if least(coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_cache_read, 0), coalesce(p_cache_write, 0)) < 0 then raise exception 'MODEL_COST_NEGATIVE'; end if;
  v_long := pr.long_context_above_tokens is not null and coalesce(p_in, 0) + coalesce(p_cache_read, 0) + coalesce(p_cache_write, 0) > pr.long_context_above_tokens;
  v_usd := round((coalesce(p_in, 0) * (case when v_long then coalesce(pr.long_input_usd_per_mtok, pr.input_usd_per_mtok) else pr.input_usd_per_mtok end)
               + coalesce(p_out, 0) * (case when v_long then coalesce(pr.long_output_usd_per_mtok, pr.output_usd_per_mtok) else pr.output_usd_per_mtok end)
               + coalesce(p_cache_read, 0) * coalesce(pr.cache_read_usd_per_mtok, pr.input_usd_per_mtok)
               + coalesce(p_cache_write, 0) * coalesce(pr.cache_write_usd_per_mtok, pr.input_usd_per_mtok * 1.25)) / 1000000.0, 6);
  insert into model_costs(workflow, run_id, model, step, day, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd, cap_usd)
    values (p_workflow, v_day::text, p_model, coalesce(p_step, ''), v_day, 1, coalesce(p_in, 0), coalesce(p_out, 0), coalesce(p_cache_read, 0), coalesce(p_cache_write, 0),
            v_usd, (setting('assistant')->>'daily_cap_usd')::numeric)
    on conflict (workflow, run_id, model, step) do update set
      calls = model_costs.calls + 1, input_tokens = model_costs.input_tokens + excluded.input_tokens,
      output_tokens = model_costs.output_tokens + excluded.output_tokens, cache_read_tokens = model_costs.cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = model_costs.cache_write_tokens + excluded.cache_write_tokens, usd = model_costs.usd + excluded.usd, cap_usd = excluded.cap_usd;
  return v_usd;
end $$;

create or replace function ast_spend(p_now timestamptz default now()) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with a as (select coalesce(setting('assistant'), '{}'::jsonb) as s, (p_now at time zone scheduling_tz())::date as d),
  sp as (select (select coalesce(sum(usd), 0) from model_costs, a where workflow in ('assistant', 'assistant-digest') and day = a.d) as day_usd,
                (select coalesce(sum(usd), 0) from model_costs, a where workflow in ('assistant', 'assistant-digest') and day >= date_trunc('month', a.d)::date and day <= a.d) as month_usd)
  select jsonb_build_object('enabled', coalesce((a.s->>'enabled')::boolean, false),
    'day_usd', round(sp.day_usd, 6), 'month_usd', round(sp.month_usd, 6),
    'daily_cap_usd', coalesce((a.s->>'daily_cap_usd')::numeric, 0), 'monthly_cap_usd', coalesce((a.s->>'monthly_cap_usd')::numeric, 0),
    'model', coalesce(a.s->>'model', 'claude-sonnet-5-5'), 'digest_model', coalesce(a.s->>'digest_model', 'claude-haiku-5-5'),
    'max_tool_rounds', least(greatest(coalesce((a.s->>'max_tool_rounds')::int, 4), 1), 6),
    'allowed', coalesce((a.s->>'enabled')::boolean, false) and sp.day_usd < coalesce((a.s->>'daily_cap_usd')::numeric, 0)
               and sp.month_usd < coalesce((a.s->>'monthly_cap_usd')::numeric, 0),
    'reason', case when not coalesce((a.s->>'enabled')::boolean, false) then 'off'
                   when sp.day_usd >= coalesce((a.s->>'daily_cap_usd')::numeric, 0) then 'daily_cap'
                   when sp.month_usd >= coalesce((a.s->>'monthly_cap_usd')::numeric, 0) then 'monthly_cap' end)
  from a, sp $$;

create or replace function ast_turn_log(p_party uuid, p_role text, p_lang text, p_question text, p_answer text, p_tools jsonb, p_model text, p_usd numeric, p_outcome text)
returns uuid language sql set search_path = public, pg_temp as $$
  insert into assistant_turns(party_id, role, lang, question, answer, tools, model, usd, outcome)
  values (p_party, p_role, coalesce(p_lang, 'en'), left(coalesce(p_question, ''), 1000), left(p_answer, 8000), coalesce(p_tools, '[]'::jsonb), p_model, coalesce(p_usd, 0), p_outcome)
  returning id $$;

-- This person's own recent turns, for the panel (newest last).
create or replace function ast_turns_recent(p_party uuid, p_limit int default 6) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('question', question, 'answer', answer, 'usd', usd, 'outcome', outcome, 'at', created_at) order by created_at), '[]'::jsonb)
    from (select * from assistant_turns where party_id = p_party and created_at >= now() - interval '12 hours' order by created_at desc limit least(greatest(p_limit, 1), 20)) t $$;

create or replace function ast_digest_save(p_day date, p_facts jsonb, p_text_en text, p_text_ar text, p_model text, p_usd numeric)
returns date language sql set search_path = public, pg_temp as $$
  insert into assistant_digests(day, facts, text_en, text_ar, model, usd) values (p_day, p_facts, left(p_text_en, 4000), left(p_text_ar, 4000), p_model, coalesce(p_usd, 0))
  on conflict (day) do update set facts = excluded.facts, text_en = excluded.text_en, text_ar = excluded.text_ar, model = excluded.model,
     usd = assistant_digests.usd + excluded.usd, updated_at = now()
  returning day $$;

-- ---------- rights ----------
do $$ declare t text; r text; f record; begin
  foreach t in array array['assistant_digests', 'assistant_turns'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  grant select on table assistant_digests to assistant_reader;
  drop policy if exists assistant_read on assistant_digests;
  create policy assistant_read on assistant_digests for select to assistant_reader using (true);

  execute 'grant create on schema public to assistant_reader';
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('assistant_digest_facts', 'assistant_digests') loop
    execute format('alter function %s owner to assistant_reader', f.sig);
  end loop;
  execute 'revoke create on schema public from assistant_reader';

  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('assistant_digest_facts', 'assistant_digests', 'ast_record_cost', 'ast_spend', 'ast_turn_log', 'ast_turns_recent', 'ast_digest_save') loop
    execute format('revoke all on function %s from public', f.sig);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f.sig, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
