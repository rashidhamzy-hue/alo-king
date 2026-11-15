-- 0139 (session COST1): what every workflow that calls a model spent, in one table, and a cap on each run.
--
-- Until now only the Worker's own turns were priced (agent_run_costs, 0092 and 0102) and intake kept its own run table (0123).
-- The language-pack, product-data, research-load, images and sim-test workflows spent money that no table recorded.
--
-- model_costs: one row per (workflow, run, model, step). A step is a part of the run, for example "after" in language-pack,
--   "names" in product-data, or the role (concierge, customer, judge) in sim-test. Tokens are the API's own counts:
--   input_tokens is the input that was neither read from nor written to the prompt cache (as agent_runs, 0102).
--   usd is priced in the script, call by call, from the model_prices rows of the run's day (model_prices_in_force below), with the
--   same rule as agent_run_costs: the long-context rate when the whole prompt is above the threshold, cached tokens at their own
--   price, and a model with no price row is refused before the call, never counted as free. web_searches is priced from
--   settings.intake (0123) and included in usd. cap_usd is the dollar cap the run was given; stopped_at_cap says the run
--   refused a model call because of it. Calls already in flight when the cap was reached finish and are counted, so usd can
--   pass the cap by those calls.
-- record_model_cost(): the one writer. It takes the run's lines as json and upserts, so a repeated record of a run replaces it.
-- model_prices_in_force(): the price rows a run starts with (the latest row of each model not after the day).
-- ai_cost_workflow_daily: the totals by workflow and day.
-- ai_cost_daily: two columns added at the end, workflow_usd and workflow_by, the day's workflow spend. They are not in usd or
--   in usd_per_order: building and testing is not what an order costs.
--
-- Service role only, as every cost table (0092, 0123). Nothing here changes a model, a key or an Anthropic workspace.

create table if not exists model_costs (
  id                   bigint generated always as identity primary key,
  workflow             text not null check (workflow <> ''),
  run_id               text not null check (run_id <> ''),
  model                text not null check (model <> ''),
  step                 text not null default '',
  day                  date not null default (now() at time zone 'Asia/Beirut')::date,
  calls                int not null default 0 check (calls >= 0),
  input_tokens         bigint not null default 0 check (input_tokens >= 0),
  output_tokens        bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens    bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens   bigint not null default 0 check (cache_write_tokens >= 0),
  web_searches         int not null default 0 check (web_searches >= 0),
  usd                  numeric(14,6) not null check (usd >= 0),
  cap_usd              numeric(10,4),
  stopped_at_cap       boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (workflow, run_id, model, step)
);
create index if not exists model_costs_day on model_costs(day, workflow);

-- The language-pack generators (evals/language/gen-cases.mjs, gen-pack.mjs) default to Claude Opus 5.5, which had no price row, so a
-- metered run of them would be refused. Anthropic's list price: 4.00 input and 20.00 output per million tokens, cache reads 0.20
-- (the claude-api reference, cached 3 Nov 2026); the cache write is 1.25 times the input price, the multiplier 0102 uses for the other
-- two models. A price row is dated and never edited: a change is a new row with a later effective_from.
insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, long_context_above_tokens, long_input_usd_per_mtok,
                         long_output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok, source) values
  ('claude-opus-5-5', '2026-11-15', 4.00, 20.00, null, null, null, 0.20, 5.00,
   'Anthropic list price (claude-api reference, cached 3 Nov 2026); cache write 1.25 times input as in 0102; checked 15 Nov 2026 (session COST1)')
on conflict (model, effective_from) do nothing;

create or replace function model_prices_in_force(p_day date default (now() at time zone 'Asia/Beirut')::date)
  returns setof model_prices language sql stable set search_path = public, pg_temp as $$
  select distinct on (model) * from model_prices where effective_from <= p_day order by model, effective_from desc $$;

-- p_lines: [{model, step, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, usd}, ...]
-- Returns the number of lines written. A line without a model or with a negative figure is refused, and nothing is written.
create or replace function record_model_cost(p_workflow text, p_run_id text, p_cap_usd numeric, p_stopped boolean, p_lines jsonb)
  returns int language plpgsql set search_path = public, pg_temp as $$
declare l jsonb; n int := 0;
begin
  if coalesce(p_workflow, '') = '' or coalesce(p_run_id, '') = '' then raise exception 'MODEL_COST_NEEDS_WORKFLOW_AND_RUN'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'MODEL_COST_LINES_MUST_BE_AN_ARRAY'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(l->>'model', '') = '' then raise exception 'MODEL_COST_LINE_NEEDS_A_MODEL'; end if;
    if l->>'usd' is null then raise exception 'MODEL_COST_LINE_NEEDS_USD'; end if;
    insert into model_costs(workflow, run_id, model, step, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                            web_searches, usd, cap_usd, stopped_at_cap)
    values (p_workflow, p_run_id, l->>'model', coalesce(l->>'step', ''), coalesce((l->>'calls')::int, 0),
            coalesce((l->>'input_tokens')::bigint, 0), coalesce((l->>'output_tokens')::bigint, 0),
            coalesce((l->>'cache_read_tokens')::bigint, 0), coalesce((l->>'cache_write_tokens')::bigint, 0),
            coalesce((l->>'web_searches')::int, 0), round((l->>'usd')::numeric, 6), p_cap_usd, coalesce(p_stopped, false))
    on conflict (workflow, run_id, model, step) do update set
      calls = excluded.calls, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens,
      web_searches = excluded.web_searches, usd = excluded.usd, cap_usd = excluded.cap_usd, stopped_at_cap = excluded.stopped_at_cap;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace view ai_cost_workflow_daily as
  select day, workflow, count(distinct run_id)::int as runs, sum(calls)::int as calls,
         sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens,
         sum(cache_read_tokens)::bigint as cache_read_tokens, sum(cache_write_tokens)::bigint as cache_write_tokens,
         sum(usd) as usd, count(distinct run_id) filter (where stopped_at_cap)::int as runs_stopped_at_cap
    from model_costs group by day, workflow;

-- ai_cost_daily keeps its columns and their order; the two new ones come last.
create or replace view ai_cost_daily as
  with c as (
    select k.day, k.usd, k.priced, coalesce(pa.is_probe, false) as probe
      from agent_run_costs k left join conversations cv on cv.id = k.conversation_id left join parties pa on pa.id = cv.party_id),
  runs as (
    select day, count(*)::int as runs, count(*) filter (where not priced)::int as unpriced_runs,
           coalesce(sum(usd), 0) as usd, coalesce(sum(usd) filter (where not probe), 0) as real_usd
      from c group by day),
  ords as (
    select (o.created_at at time zone 'Asia/Beirut')::date as day, count(*)::int as orders,
           count(*) filter (where not coalesce(pa.is_probe, false))::int as real_orders
      from orders o left join parties pa on pa.id = o.customer_id group by 1),
  wf as (
    select day, sum(usd) as workflow_usd, jsonb_object_agg(workflow, usd) as workflow_by from ai_cost_workflow_daily group by day)
  select coalesce(r.day, o.day, w.day) as day, coalesce(r.runs, 0) as runs, coalesce(r.unpriced_runs, 0) as unpriced_runs,
         coalesce(r.usd, 0) as usd, coalesce(o.orders, 0) as orders,
         case when coalesce(o.orders, 0) > 0 then round(coalesce(r.usd, 0) / o.orders, 10) end as usd_per_order,
         coalesce(r.real_usd, 0) as real_usd, coalesce(o.real_orders, 0) as real_orders,
         case when coalesce(o.real_orders, 0) > 0 then round(coalesce(r.real_usd, 0) / o.real_orders, 10) end as real_usd_per_order,
         coalesce(w.workflow_usd, 0) as workflow_usd, coalesce(w.workflow_by, '{}'::jsonb) as workflow_by
    from runs r full join ords o on o.day = r.day full join wf w on w.day = coalesce(r.day, o.day);

-- Only this migration's own objects are touched: a blanket revoke over the schema would undo the grants of later migrations
-- (0154, 0155, 0158, 0159) on a database that applied them before this one.
do $$ declare t text; r text; f text;
begin
  alter table model_costs enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['model_costs', 'ai_cost_workflow_daily', 'ai_cost_daily'] loop
        execute format('revoke all on table %I from %I', t, r);
      end loop;
      foreach f in array array['model_prices_in_force(date)', 'record_model_cost(text,text,numeric,boolean,jsonb)'] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
  foreach f in array array['model_prices_in_force(date)', 'record_model_cost(text,text,numeric,boolean,jsonb)'] loop
    execute format('revoke all on function %s from public', f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table model_costs to service_role;
    grant select on ai_cost_workflow_daily, ai_cost_daily to service_role;
    grant execute on function model_prices_in_force(date), record_model_cost(text, text, numeric, boolean, jsonb) to service_role;
  end if;
end $$;
