-- Alo King Chouf, session I1: the research step's output and what each run of intake.yml spent.
--
-- The identity step (scripts/intake/) asks the fast model, with web search, for one item's research file in the shape of
-- data/research/README.md, under that README's rules. The file is stored here exactly as written (text and its sha-256), so
-- the picture and food-facts steps hand it to P2's loader unchanged, and anyone can read what the model said and what code
-- dropped from it (a page the search never returned, a value with no page). Nothing in a research file is approved: it is a
-- proposal source, as R1-R3's files were.
--
-- Spend: every run records its minutes and its model spend, priced from model_prices (0092) and the web-search price below.
-- A model with no price row is not priced as free: the run refuses to start (intake_prices returns null).

create table if not exists intake_research (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  run_id        text not null,
  file_text     text not null check (length(file_text) between 2 and 200000),
  file_sha      text not null check (file_sha ~ '^[0-9a-f]{64}$'),
  file          jsonb not null,
  model         text not null,
  input_tokens  int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  web_searches  int not null default 0 check (web_searches >= 0),
  cost_usd      numeric(12,6) not null default 0 check (cost_usd >= 0),
  dropped       jsonb not null default '[]',          -- what code took out of the model's file, and why
  pages_seen    int not null default 0,               -- addresses the web search returned
  created_at    timestamptz not null default now()
);
create index if not exists intake_research_product on intake_research(product_id, created_at desc);

create or replace function record_intake_research(p_product uuid, p_run text, p_file_text text, p_file_sha text, p_model text,
  p_input_tokens int, p_output_tokens int, p_web_searches int, p_cost_usd numeric, p_dropped jsonb default '[]', p_pages_seen int default 0)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_file jsonb;
begin
  if not exists (select 1 from products where id = p_product) then raise exception 'PRODUCT_NOT_FOUND %', p_product; end if;
  begin v_file := p_file_text::jsonb; exception when others then raise exception 'RESEARCH_NOT_JSON'; end;
  if jsonb_typeof(v_file) <> 'object' or v_file->>'sku' is distinct from (select sku from products where id = p_product) then
    raise exception 'RESEARCH_SKU_MISMATCH';
  end if;
  if encode(sha256(convert_to(p_file_text, 'UTF8')), 'hex') <> p_file_sha then raise exception 'RESEARCH_SHA_MISMATCH'; end if;
  insert into intake_research(product_id, run_id, file_text, file_sha, file, model, input_tokens, output_tokens, web_searches, cost_usd, dropped, pages_seen)
    values (p_product, p_run, p_file_text, p_file_sha, v_file, p_model, coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
            coalesce(p_web_searches, 0), coalesce(p_cost_usd, 0), coalesce(p_dropped, '[]'), coalesce(p_pages_seen, 0))
    returning id into v_id;
  return v_id;
end $$;

-- The latest research file of an item, as the loader reads it.
create or replace function latest_intake_research(p_product uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('research_id', r.id, 'file_text', r.file_text, 'file_sha', r.file_sha, 'run_id', r.run_id, 'created_at', r.created_at)
    from intake_research r where r.product_id = p_product order by r.created_at desc, r.id desc limit 1 $$;

create table if not exists intake_runs (
  run_id      text primary key,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  minutes     numeric(10,2) not null check (minutes >= 0),
  spend_usd   numeric(12,6) not null check (spend_usd >= 0),
  jobs_taken  int not null default 0,
  jobs_done   int not null default 0,
  stopped     text,                                   -- why the run stopped early (spend cap, a refused key), or null
  detail      jsonb not null default '{}'
);

create or replace function record_intake_run(p_run text, p_started timestamptz, p_minutes numeric, p_spend numeric, p_taken int, p_done int,
  p_stopped text default null, p_detail jsonb default '{}') returns void language sql set search_path = public, pg_temp as $$
  insert into intake_runs(run_id, started_at, minutes, spend_usd, jobs_taken, jobs_done, stopped, detail)
    values (p_run, p_started, p_minutes, p_spend, p_taken, p_done, p_stopped, coalesce(p_detail, '{}'))
  on conflict (run_id) do update set finished_at = now(), minutes = excluded.minutes, spend_usd = excluded.spend_usd, jobs_taken = excluded.jobs_taken,
    jobs_done = excluded.jobs_done, stopped = excluded.stopped, detail = excluded.detail $$;

-- Anthropic's list price for web search: 10 USD per 1,000 searches (checked 14 Nov 2026), and the tool version the fast
-- model takes (the dynamic-filtering 20260209 version is for the larger models; Haiku takes the basic one). Data, not code.
insert into settings(key, value) values ('intake', '{"web_search_usd_per_search": 0.01, "web_search_tool": "web_search_20250305", "max_searches_per_item": 5}')
on conflict (key) do nothing;

-- The prices a run counts with, for one model: null when the model has no price row (the run then does not start).
create or replace function intake_prices(p_model text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('model', mp.model, 'input_usd_per_mtok', mp.input_usd_per_mtok, 'output_usd_per_mtok', mp.output_usd_per_mtok,
           'long_context_above_tokens', mp.long_context_above_tokens, 'long_input_usd_per_mtok', mp.long_input_usd_per_mtok,
           'long_output_usd_per_mtok', mp.long_output_usd_per_mtok,
           'web_search_usd_per_search', (setting('intake')->>'web_search_usd_per_search')::numeric,
           'web_search_tool', setting('intake')->>'web_search_tool',
           'max_searches_per_item', (setting('intake')->>'max_searches_per_item')::int)
    from model_prices mp
   where mp.model = p_model and mp.effective_from <= current_date and setting('intake') ? 'web_search_usd_per_search'
   order by mp.effective_from desc limit 1 $$;

do $$ declare t text; r text;
begin
  foreach t in array array['intake_research', 'intake_runs'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
