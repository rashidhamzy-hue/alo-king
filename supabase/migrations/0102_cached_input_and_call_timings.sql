-- 0102 (session SP1, reply speed): what each model call takes, and cached input priced as cached input.
--
-- Since SP1 the Worker records in agent_runs.trace (apps/gateway/src/turn.ts):
--   calls                         one entry per model call: kind (reading | ask), ms, input, output, cache_read, cache_write
--   cache_read_input_tokens       the turn's input read from the prompt cache
--   cache_creation_input_tokens   the turn's input written to the prompt cache
-- input_tokens stays the API's input_tokens: the input that was neither read from nor written to the cache. Before SP1 the
-- cached part was not recorded at all, so 0092's cost left it out (A4 called it "priced as input"; it was not counted).
--
-- model_prices.cache_write_usd_per_mtok: new column. New rows from 14 Nov (dated, as 0092 asks; no row is edited), same input
-- and output prices as 0092, with the cache prices: Anthropic's published multipliers on the input price, a read at 0.1 times
-- and a five-minute write at 1.25 times (Haiku 5.5: 0.01 and 0.125; Sonnet 5.5: 0.10, as 0092 had, and 2.50). Checked 14 Nov
-- 2026 (session SP1). A model with no cache price prices its cached tokens as input: an upper bound for reads.
-- agent_run_costs: 0092's columns, in their order, then cache_read_tokens and cache_write_tokens. usd adds the cached tokens.
--   The long-context rate applies when the whole prompt (uncached, read and written) is above the threshold.
-- agent_call_timings: one row per model call, so a turn's time splits into its calls (agent_latency stays per turn).

alter table model_prices add column if not exists cache_write_usd_per_mtok numeric(12,6);

insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, long_context_above_tokens, long_input_usd_per_mtok,
                         long_output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok, source) values
  ('claude-haiku-5-5',  '2026-11-14', 0.10, 0.50, 100000, 0.50, 2.50, 0.010, 0.125, 'Anthropic list price and cache multipliers, checked 14 Nov 2026 (session SP1)'),
  ('claude-sonnet-5-5', '2026-11-14', 2.00, 10.00, null, null, null, 0.10, 2.50, 'Anthropic list price and cache multipliers, checked 14 Nov 2026 (session SP1)')
on conflict (model, effective_from) do nothing;

create or replace view agent_run_costs as
  select r.id as run_id, r.agent, r.model, r.conversation_id, r.order_id, r.created_at,
         (r.created_at at time zone 'Asia/Beirut')::date as day,
         coalesce(r.input_tokens, 0) as input_tokens, coalesce(r.output_tokens, 0) as output_tokens,
         p.effective_from is not null as priced,
         case when p.effective_from is null then null
              when p.long_context_above_tokens is not null and coalesce(r.input_tokens, 0) + k.rd + k.wr > p.long_context_above_tokens
                then round(coalesce(r.input_tokens, 0) * coalesce(p.long_input_usd_per_mtok, p.input_usd_per_mtok) / 1e6
                         + coalesce(r.output_tokens, 0) * coalesce(p.long_output_usd_per_mtok, p.output_usd_per_mtok) / 1e6
                         + k.rd * coalesce(p.cache_read_usd_per_mtok, p.long_input_usd_per_mtok, p.input_usd_per_mtok) / 1e6
                         + k.wr * coalesce(p.cache_write_usd_per_mtok, p.long_input_usd_per_mtok, p.input_usd_per_mtok) / 1e6, 10)
              else round(coalesce(r.input_tokens, 0) * p.input_usd_per_mtok / 1e6 + coalesce(r.output_tokens, 0) * p.output_usd_per_mtok / 1e6
                         + k.rd * coalesce(p.cache_read_usd_per_mtok, p.input_usd_per_mtok) / 1e6
                         + k.wr * coalesce(p.cache_write_usd_per_mtok, p.input_usd_per_mtok) / 1e6, 10)
         end as usd,
         k.rd as cache_read_tokens, k.wr as cache_write_tokens
    from agent_runs r
    cross join lateral (select coalesce((r.trace->>'cache_read_input_tokens')::bigint, 0) as rd,
                               coalesce((r.trace->>'cache_creation_input_tokens')::bigint, 0) as wr) k
    left join lateral (select * from model_prices m where m.model = r.model and m.effective_from <= (r.created_at at time zone 'Asia/Beirut')::date
                        order by m.effective_from desc limit 1) p on true
   where r.model is not null;

create or replace view agent_call_timings as
  select r.id as run_id, r.created_at, (r.created_at at time zone 'Asia/Beirut')::date as day, r.model, r.trace->>'path' as path,
         c.ord::int as call_no, c.v->>'kind' as kind, (c.v->>'ms')::int as ms, (c.v->>'input')::int as input,
         (c.v->>'output')::int as output, (c.v->>'cache_read')::int as cache_read, (c.v->>'cache_write')::int as cache_write
    from agent_runs r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.trace->'calls') = 'array' then r.trace->'calls' else '[]'::jsonb end)
         with ordinality as c(v, ord);

do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table agent_run_costs from %I', r);
      execute format('revoke all on table agent_call_timings from %I', r);
    end if;
  end loop;
end $$;
