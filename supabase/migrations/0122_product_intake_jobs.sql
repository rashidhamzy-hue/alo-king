-- Alo King Chouf, session I1 (intake pipeline): one queue for every product, the eight steps of the brief (SYSTEM_PLAN 4).
--
-- Every hub product gets one row per step in product_intake_jobs. A trigger on products starts it for a new item; the items
-- that already exist are enqueued once by intake_enqueue_existing() (called at the end of this file, guarded by a settings
-- marker), so item 292 and item 1 take the same road. Vendor menu items (owner_source_id set) go through the menu pipeline
-- (class B, E1), not this one.
--
--   step              who moves it                                     done when
--   1 new_item        this file                                        the row exists
--   2 identity        intake.yml: one fast-model call with web search,  the research file (data/research/README.md shape) is
--                     under data/research/README.md's rules            stored in intake_research (0123)
--   3 search_words    0076's Worker cron (unchanged); intake_advance   the words are built and every test phrasing resolves
--   4 picture         intake.yml: P2's loader, picture part, unchanged  a picture was proposed, or there was none to propose
--   5 food_facts      intake.yml: P2's loader, facts part, unchanged    the facts the file states are proposed
--   6 price_cost      a person (never automatic)                       the hub has a price and a cost
--   7 person_approves a person, or a rule of auto_approval_rules (0124) name, picture and food facts are approved
--   8 live            intake_advance (0127)                            the item can be ordered (in the catalog once its
--                                                                       picture is approved and copied to the public bucket)
--
-- Status: waiting (an earlier step is not done, or nothing to do yet), ready (intake.yml may take it), running, done,
-- needs_person (waits for a person's approval or a figure), listed (failed three times: on the review list with the reason).
-- Invariants 3, 14, 15, 21: a step proposes, a person or a written rule approves, code executes, a failure lands on a list.
-- No step is an agent: each AI step is one narrow function call whose output code checks.

create table if not exists product_intake_jobs (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  step       text not null check (step in ('new_item', 'identity', 'search_words', 'picture', 'food_facts', 'price_cost', 'person_approves', 'live')),
  step_no    int  not null check (step_no between 1 and 8),
  status     text not null default 'waiting' check (status in ('waiting', 'ready', 'running', 'done', 'needs_person', 'listed')),
  attempts   int  not null default 0 check (attempts >= 0),
  last_error text,
  result     jsonb not null default '{}',
  origin     text not null check (origin in ('trigger', 'backfill')),
  run_id     text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, step),
  check (step_no = array_position(array['new_item', 'identity', 'search_words', 'picture', 'food_facts', 'price_cost', 'person_approves', 'live'], step))
);
create index if not exists product_intake_jobs_ready on product_intake_jobs (step_no, created_at) where status in ('ready', 'running');
create index if not exists product_intake_jobs_listed on product_intake_jobs (updated_at) where status = 'listed';

-- The steps intake.yml runs. The others are moved by the database (intake_advance, 0127) or by a person.
create or replace function intake_workflow_steps() returns text[] language sql immutable as $$ select array['identity', 'picture', 'food_facts'] $$;

-- One product into the queue: eight rows, once. A second call adds nothing (unique (product, step)). Returns rows added.
create or replace function enqueue_product_intake(p_product uuid, p_origin text) returns int language plpgsql set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not exists (select 1 from products where id = p_product and owner_source_id is null) then return 0; end if;
  insert into product_intake_jobs(product_id, step, step_no, status, origin, result)
  select p_product, s.step, s.n, case s.step when 'new_item' then 'done' when 'identity' then 'ready' else 'waiting' end, p_origin,
         case s.step when 'new_item' then jsonb_build_object('origin', p_origin, 'at', now()) else '{}'::jsonb end
    from unnest(array['new_item', 'identity', 'search_words', 'picture', 'food_facts', 'price_cost', 'person_approves', 'live']) with ordinality s(step, n)
  on conflict (product_id, step) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function products_intake_enqueue() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.owner_source_id is null then perform enqueue_product_intake(new.id, 'trigger'); end if;
  return new;
end $$;
drop trigger if exists products_intake_enqueue on products;
create trigger products_intake_enqueue after insert on products for each row execute function products_intake_enqueue();

-- The items that existed before this migration: enqueued once. The marker in settings records when and how many; a second
-- call does nothing. (On a database whose catalog is loaded after the migrations, the trigger enqueues each item instead.)
create or replace function intake_enqueue_existing() returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_items int := 0; v_rows int := 0; p record;
begin
  if exists (select 1 from settings where key = 'intake_backfill') then
    return (select value || jsonb_build_object('already', true) from settings where key = 'intake_backfill');
  end if;
  for p in select id from products where owner_source_id is null and is_active order by sku loop
    v_rows := v_rows + enqueue_product_intake(p.id, 'backfill');
    v_items := v_items + 1;
  end loop;
  insert into settings(key, value) values ('intake_backfill', jsonb_build_object('items', v_items, 'rows', v_rows, 'at', now()));
  return jsonb_build_object('items', v_items, 'rows', v_rows, 'already', false);
end $$;

-- A few jobs for one run of intake.yml, oldest step first. A job left running for three hours (a run that died) is taken
-- again. Each comes with the item as the picture check must see it, and, for picture and food_facts, the research file.
create or replace function claim_intake_jobs(p_limit int, p_run text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if coalesce(btrim(p_run), '') = '' then raise exception 'RUN_ID_REQUIRED'; end if;
  with picked as (
    select j.id from product_intake_jobs j join products p on p.id = j.product_id
     where j.step = any(intake_workflow_steps()) and p.is_active
       and ((j.status = 'ready' and j.run_id is distinct from p_run)          -- a job that failed in this run waits for the next one
            or (j.status = 'running' and j.claimed_at < now() - interval '3 hours'))
     order by j.step_no, j.created_at, p.sku
     limit greatest(0, least(coalesce(p_limit, 0), 50))
     for update of j skip locked
  ), upd as (
    update product_intake_jobs j set status = 'running', run_id = p_run, claimed_at = now(), updated_at = now()
      from picked where j.id = picked.id returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', u.id, 'step', u.step, 'attempts', u.attempts,
           'item', jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
                     'sell_unit', p.sell_unit, 'category', p.category, 'barcode', nullif(btrim(p.barcode), ''),
                     'has_usable_picture', exists (select 1 from product_images i where i.product_id = p.id and i.status in ('approved', 'proposed')
                                                     and product_image_licence_usable(i.licence)),
                     'loads', (select coalesce(jsonb_agg(jsonb_build_object('part', l.part, 'file_sha', l.file_sha, 'outcome', l.outcome)), '[]'::jsonb)
                                 from research_loads l where l.product_id = p.id)))
         order by u.step_no, p.sku), '[]'::jsonb)
    into v
    from upd u join products p on p.id = u.product_id;
  return v;
end $$;

-- The end of one try. done: the next steps open (identity done -> picture and food_facts ready). failed: tried again next run,
-- and after the third failure the job is listed with the reason. needs_person / waiting: as said. A run may only finish the
-- jobs it claimed (a late answer from a dead run changes nothing). released: the run stopped before the job could be tried
-- (a refused key, the spend cap): back to ready, no attempt counted.
create or replace function finish_intake_job(p_job uuid, p_run text, p_outcome text, p_result jsonb default '{}', p_error text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare j product_intake_jobs%rowtype; v_status text; v_attempts int;
begin
  if p_outcome not in ('done', 'failed', 'needs_person', 'waiting', 'released') then raise exception 'INTAKE_OUTCOME %', p_outcome; end if;
  select * into j from product_intake_jobs where id = p_job for update;
  if not found then raise exception 'INTAKE_JOB_NOT_FOUND %', p_job; end if;
  if j.status <> 'running' or j.run_id is distinct from p_run then
    return jsonb_build_object('ok', false, 'reason', 'not_claimed_by_this_run', 'status', j.status);
  end if;
  v_attempts := j.attempts + case when p_outcome = 'failed' then 1 else 0 end;
  v_status := case p_outcome when 'failed' then case when v_attempts >= 3 then 'listed' else 'ready' end when 'released' then 'ready' else p_outcome end;
  update product_intake_jobs
     set status = v_status, attempts = v_attempts, updated_at = now(), claimed_at = null,
         result = case when p_outcome in ('failed', 'released') then result else coalesce(p_result, '{}') end,
         last_error = case when p_outcome in ('failed', 'released') then left(coalesce(nullif(btrim(p_error), ''), 'failed without a reason'), 500) else null end
   where id = j.id;
  if j.step = 'identity' and p_outcome = 'done' then
    update product_intake_jobs set status = 'ready', updated_at = now()
     where product_id = j.product_id and step in ('picture', 'food_facts') and status in ('waiting', 'done', 'needs_person');
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'attempts', v_attempts);
end $$;

-- The review list: jobs that failed three times, each with its reason.
create or replace function intake_review_list(p_limit int default 200) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'step', j.step,
           'attempts', j.attempts, 'reason', j.last_error, 'since', j.updated_at) order by j.updated_at desc), '[]'::jsonb)
    from (select * from product_intake_jobs where status = 'listed' order by updated_at desc limit p_limit) j join products p on p.id = j.product_id $$;

-- A person puts a listed job back in the queue (after fixing what its reason says). Ops lead or admin.
create or replace function retry_intake_job(p_job uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare j product_intake_jobs%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into j from product_intake_jobs where id = p_job for update;
  if not found then raise exception 'INTAKE_JOB_NOT_FOUND %', p_job; end if;
  if j.status <> 'listed' then return jsonb_build_object('ok', true, 'already', true, 'status', j.status); end if;
  update product_intake_jobs set status = case when step = any(intake_workflow_steps()) then 'ready' else 'waiting' end,
         attempts = 0, updated_at = now(), result = result || jsonb_build_object('retried_by', p_by, 'retried_at', now(), 'last_reason', last_error)
   where id = j.id;
  return jsonb_build_object('ok', true, 'already', false, 'step', j.step);
end $$;

select intake_enqueue_existing();

alter table product_intake_jobs enable row level security;
do $$ declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table product_intake_jobs from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table product_intake_jobs to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
