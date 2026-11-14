-- 0092 (session A4, audit 14 Nov item 6): what the AI costs, per run and per order. Prices are data, never code.
--
-- model_prices: USD per million tokens, per model, from a date. A new price is a new row with a later effective_from;
--   earlier runs keep the price of their day. long_* applies when a run's input is above long_context_above_tokens
--   (Haiku 5.5 is priced higher for prompts above 100K tokens). A run sums its calls, so this is an upper bound for a
--   run whose calls were each under the threshold; Concierge turns are far below it (max 12,369 on staging, 14 Nov).
--   agent_runs records input and output tokens only (no cache reads or writes), so cached reads are priced as input:
--   again an upper bound. Recording cache tokens is a lane B request (turn.ts), in docs/HANDOFF.md.
-- agent_run_costs: each run with a model, priced with the price in force on its day (Beirut). No price row: priced = false
--   and usd null. Unknown is never shown as free.
-- ai_cost_daily: per day, the runs, the AI cost, the orders created and the cost per order, overall and without the staging
--   probe (parties.is_probe). This is the figure 4.11 (cost per order) reads.
--
-- Seed prices: Anthropic list prices for the two models the Worker uses (MODEL_FAST, MODEL_SMART), checked 14 Nov 2026.

create table if not exists model_prices (
  model                     text not null,
  effective_from            date not null,
  input_usd_per_mtok        numeric(12,6) not null check (input_usd_per_mtok >= 0),
  output_usd_per_mtok       numeric(12,6) not null check (output_usd_per_mtok >= 0),
  long_context_above_tokens int,
  long_input_usd_per_mtok   numeric(12,6),
  long_output_usd_per_mtok  numeric(12,6),
  cache_read_usd_per_mtok   numeric(12,6),
  source                    text not null,
  primary key (model, effective_from)
);
alter table model_prices enable row level security;

insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, long_context_above_tokens, long_input_usd_per_mtok, long_output_usd_per_mtok, cache_read_usd_per_mtok, source) values
  ('claude-haiku-5-5',  '2026-11-01', 0.10, 0.50, 100000, 0.50, 2.50, null, 'Anthropic list price, checked 14 Nov 2026 (session A4)'),
  ('claude-sonnet-5-5', '2026-11-01', 2.00, 10.00, null, null, null, 0.10, 'Anthropic list price, checked 14 Nov 2026 (session A4)')
on conflict (model, effective_from) do nothing;

create or replace view agent_run_costs as
  select r.id as run_id, r.agent, r.model, r.conversation_id, r.order_id, r.created_at,
         (r.created_at at time zone 'Asia/Beirut')::date as day,
         coalesce(r.input_tokens, 0) as input_tokens, coalesce(r.output_tokens, 0) as output_tokens,
         p.effective_from is not null as priced,
         case when p.effective_from is null then null
              when p.long_context_above_tokens is not null and coalesce(r.input_tokens, 0) > p.long_context_above_tokens
                then round(coalesce(r.input_tokens, 0) * coalesce(p.long_input_usd_per_mtok, p.input_usd_per_mtok) / 1e6
                         + coalesce(r.output_tokens, 0) * coalesce(p.long_output_usd_per_mtok, p.output_usd_per_mtok) / 1e6, 10)
              else round(coalesce(r.input_tokens, 0) * p.input_usd_per_mtok / 1e6 + coalesce(r.output_tokens, 0) * p.output_usd_per_mtok / 1e6, 10)
         end as usd
    from agent_runs r
    left join lateral (select * from model_prices m where m.model = r.model and m.effective_from <= (r.created_at at time zone 'Asia/Beirut')::date
                        order by m.effective_from desc limit 1) p on true
   where r.model is not null;

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
      from orders o left join parties pa on pa.id = o.customer_id group by 1)
  select coalesce(r.day, o.day) as day, coalesce(r.runs, 0) as runs, coalesce(r.unpriced_runs, 0) as unpriced_runs,
         coalesce(r.usd, 0) as usd, coalesce(o.orders, 0) as orders,
         case when coalesce(o.orders, 0) > 0 then round(coalesce(r.usd, 0) / o.orders, 10) end as usd_per_order,
         coalesce(r.real_usd, 0) as real_usd, coalesce(o.real_orders, 0) as real_orders,
         case when coalesce(o.real_orders, 0) > 0 then round(coalesce(r.real_usd, 0) / o.real_orders, 10) end as real_usd_per_order
    from runs r full join ords o on o.day = r.day;

do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table model_prices from %I', r);
      execute format('revoke all on table agent_run_costs from %I', r);
      execute format('revoke all on table ai_cost_daily from %I', r);
    end if;
  end loop;
end $$;
