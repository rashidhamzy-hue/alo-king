-- Alo King Chouf: build plan 1.23 (session B4). Search words for every new product and menu item, automatically.
-- Founder rule (13 Nov): whenever a product is added (console catalog, intake 5.15) or a merchant menu item is imported (3.10,
-- Phase 8; menu items are products with an owner source), the system writes its search words in Lebanese Arabic, Arabizi,
-- English and French, plus the generic words people use, with the builder 1.22 used. Here:
--   * A product inserted without pack terms, or whose name, Arabic name or brand changes (the size is in the name), gets a job in
--     search_word_jobs. A nightly pass (enqueue_stale_search_words) catches anything the trigger missed.
--   * The Worker's minute cron takes a few jobs (claim_search_word_jobs), asks the fast model for the terms and a few test
--     phrasings, drops food-fact words and over-long terms in TypeScript (packages/agents/src/pack-rules.ts, the same rules as
--     evals/language/build-pack.mjs), and writes them with save_search_words(), which applies the rules that need the whole pack:
--     an exact term two products claim names neither (both dropped), an exact term that is another product's kind word is kind
--     for both, and a kind term that is any product's brand is dropped.
--   * check_search_words() runs the phrasings through the planner (plan_order_core, no model). A phrasing that does not resolve
--     to the item puts it on search_word_reviews for a person (the console's review list, D2), instead of being guessed.
-- settings.search_words: enabled, per_tick (jobs per cron minute), phrasings (per item).

insert into settings(key, value) values ('search_words', '{"enabled": true, "per_tick": 2, "phrasings": 4}') on conflict (key) do nothing;

create table if not exists search_word_jobs (
  sku         text primary key,
  reason      text not null check (reason in ('new', 'changed', 'nightly', 'manual')),
  status      text not null default 'pending' check (status in ('pending', 'running', 'done', 'review', 'failed')),
  attempts    int not null default 0,
  enqueued_at timestamptz not null default now(),
  started_at  timestamptz,
  done_at     timestamptz,
  last_error  text,
  result      jsonb
);
create index if not exists search_word_jobs_pending on search_word_jobs (enqueued_at) where status in ('pending', 'running');

-- What the words were last built from, to find items whose name, brand or size changed since.
create table if not exists search_word_state (
  sku      text primary key,
  name_key text not null,
  built_at timestamptz not null default now(),
  version  text not null
);

create table if not exists search_word_reviews (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null,
  phrasing    text not null,
  got         jsonb,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_by uuid references parties(id),
  resolved_at timestamptz,
  unique (sku, phrasing)
);

create or replace function product_name_key(p products) returns text language sql immutable as $$
  select md5(coalesce(p.name_en, '') || '|' || coalesce(p.name_ar, '') || '|' || coalesce(p.brand, ''))
$$;

create or replace function enqueue_search_words(p_sku text, p_reason text) returns void language sql as $$
  insert into search_word_jobs(sku, reason) values (p_sku, p_reason)
  on conflict (sku) do update set status = 'pending', reason = excluded.reason, enqueued_at = now(), attempts = 0, last_error = null
   where search_word_jobs.status <> 'running' or search_word_jobs.started_at < now() - interval '10 minutes'
$$;

-- B3's pack was built for the products that existed: they are recorded as built, so nothing is regenerated for them.
insert into search_word_state(sku, name_key, version)
select p.sku, product_name_key(p), 'lp-1.22' from products p
 where p.sku is not null and exists (select 1 from language_pack lp where lp.sku = p.sku and lp.level <> 'brand')
on conflict (sku) do nothing;

create or replace function products_search_words() returns trigger language plpgsql as $$
begin
  if new.sku is null or not new.is_active then return new; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from language_pack lp where lp.sku = new.sku and lp.level <> 'brand') then
      -- loaded with its words already (the 1.22 pack is keyed by SKU and loads before the catalog seed)
      insert into search_word_state(sku, name_key, version) values (new.sku, product_name_key(new), 'lp-1.22') on conflict (sku) do nothing;
    else
      perform enqueue_search_words(new.sku, 'new');
    end if;
  elsif product_name_key(new) is distinct from product_name_key(old) or (new.is_active and not old.is_active) then
    perform enqueue_search_words(new.sku, 'changed');
  end if;
  return new;
end $$;
drop trigger if exists products_search_words on products;
create trigger products_search_words after insert or update of name_en, name_ar, brand, is_active on products
  for each row execute function products_search_words();

-- Nightly: anything whose name, brand or size changed since its words were built, or that has none, and no job waiting.
create or replace function enqueue_stale_search_words() returns int language plpgsql as $$
declare n int := 0; r record;
begin
  for r in select p.sku, case when s.sku is null then 'new' else 'nightly' end as why from products p left join search_word_state s on s.sku = p.sku
            where p.sku is not null and p.is_active
              and ((s.sku is not null and s.name_key <> product_name_key(p))
                   or (s.sku is null and not exists (select 1 from language_pack lp where lp.sku = p.sku and lp.level <> 'brand')))
              and not exists (select 1 from search_word_jobs j where j.sku = p.sku and j.status in ('pending', 'running')) loop
    perform enqueue_search_words(r.sku, r.why); n := n + 1;
  end loop;
  return n;
end $$;

-- A few jobs for this cron tick, with what the model needs: the item and the shelf it sits on (its category).
create or replace function claim_search_word_jobs(p_limit int default null) returns jsonb language plpgsql as $$
declare v_limit int := coalesce(p_limit, (setting('search_words')->>'per_tick')::int, 2); out jsonb;
begin
  if coalesce(setting('search_words')->>'enabled', 'true') <> 'true' then return '[]'::jsonb; end if;
  with picked as (
    select j.sku from search_word_jobs j
     where (j.status = 'pending' or (j.status = 'running' and j.started_at < now() - interval '10 minutes')) and j.attempts < 3
     order by j.enqueued_at limit v_limit for update skip locked
  ), upd as (
    update search_word_jobs j set status = 'running', started_at = now(), attempts = j.attempts + 1 from picked where j.sku = picked.sku returning j.sku, j.reason
  )
  select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'reason', upd.reason, 'name', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
           'category', p.category, 'sub_type', p.sub_type, 'unit', p.sell_unit, 'merchant', s.name,
           'shelf', (select coalesce(jsonb_agg(jsonb_build_object('sku', o.sku, 'name', o.name_en, 'brand', o.brand, 'sub_type', o.sub_type) order by o.sku), '[]')
                       from (select * from products o where o.category = p.category and o.is_active and o.sku <> p.sku
                               and o.owner_source_id is not distinct from p.owner_source_id order by o.sku limit 80) o))), '[]'::jsonb)
    into out from upd join products p on p.sku = upd.sku left join sources s on s.id = p.owner_source_id;
  return out;
end $$;

-- The item's terms, replacing any it had, with the rules that need the whole pack. Returns what was written and dropped.
create or replace function save_search_words(p_sku text, p_rows jsonb, p_version text) returns jsonb language plpgsql as $$
declare r jsonb; v_tokens text[]; v_level text; n int := 0; dropped jsonb := jsonb_build_object('collision', '[]'::jsonb, 'demoted', '[]'::jsonb, 'brand_as_kind', '[]'::jsonb);
        others text[];
begin
  if not exists (select 1 from products where sku = p_sku) then raise exception 'UNKNOWN_SKU %', p_sku; end if;
  delete from language_pack where sku = p_sku;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_tokens := catalog_tokens(r->>'term'); v_level := r->>'level';
    if v_level not in ('kind', 'brand', 'exact') or coalesce(array_length(v_tokens, 1), 0) = 0 then continue; end if;
    -- a kind word that is a brand would make every product of the brand look like the thing asked for
    if v_level = 'kind' and exists (select 1 from language_pack lb where lb.level = 'brand' and lb.tokens = v_tokens) then
      dropped := jsonb_set(dropped, '{brand_as_kind}', dropped->'brand_as_kind' || to_jsonb(r->>'term')); continue;
    end if;
    if v_level = 'exact' then
      select array_agg(distinct sku) into others from language_pack where level = 'exact' and tokens = v_tokens and sku <> p_sku;
      if others is not null then
        -- an exact term two products claim names neither of them
        delete from language_pack where level = 'exact' and tokens = v_tokens and sku <> p_sku;
        dropped := jsonb_set(dropped, '{collision}', dropped->'collision' || jsonb_build_object('term', r->>'term', 'also', to_jsonb(others))); continue;
      end if;
      if exists (select 1 from language_pack where level = 'kind' and tokens = v_tokens and sku <> p_sku) then
        v_level := 'kind';
        dropped := jsonb_set(dropped, '{demoted}', dropped->'demoted' || to_jsonb(r->>'term'));
      end if;
    end if;
    if v_level = 'kind' then
      -- another product's exact term that is this one's kind word stops being exact (it cannot pick one of them alone)
      update language_pack set level = 'kind' where level = 'exact' and tokens = v_tokens and sku <> p_sku
         and not exists (select 1 from language_pack k where k.sku = language_pack.sku and k.level = 'kind' and k.term = language_pack.term);
    end if;
    insert into language_pack(sku, term, level, lang, version) values (p_sku, r->>'term', v_level, coalesce(nullif(r->>'lang', ''), 'ar'), p_version)
      on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  insert into search_word_state(sku, name_key, version) select p.sku, product_name_key(p), p_version from products p where p.sku = p_sku
    on conflict (sku) do update set name_key = excluded.name_key, built_at = now(), version = excluded.version;
  return jsonb_build_object('written', n, 'dropped', dropped);
end $$;

-- Each phrasing through the planner, as a one-line order. Resolves = matched to this item. Anything else goes on the review list.
create or replace function check_search_words(p_sku text, p_phrasings text[]) returns jsonb language plpgsql as $$
declare v_id uuid := (select id from products where sku = p_sku); ph text; plan jsonb; l jsonb; failed jsonb := '[]'::jsonb; ok int := 0;
begin
  foreach ph in array coalesce(p_phrasings, '{}') loop
    if nullif(btrim(ph), '') is null then continue; end if;
    plan := plan_order_core(null, jsonb_build_object('intent', 'order', '_message', ph,
              'lines', jsonb_build_array(jsonb_build_object('raw', ph, 'query', ph, 'qty', 1, 'unit', 'each', 'modifiers', '[]'::jsonb, 'confidence', 0.8))),
              null, '{}'::jsonb);
    l := plan->'lines'->0;
    if l->>'status' = 'matched' and l->'chosen'->>'product_id' = v_id::text then ok := ok + 1;
    else
      failed := failed || jsonb_build_object('phrasing', ph, 'status', l->>'status', 'chosen', l->'chosen'->>'name',
                                             'candidates', (select jsonb_agg(c->>'name') from jsonb_array_elements(coalesce(l->'candidates', '[]'::jsonb)) c));
      insert into search_word_reviews(sku, phrasing, got) values (p_sku, ph, failed->-1)
        on conflict (sku, phrasing) do update set got = excluded.got, status = 'open', created_at = now(), resolved_by = null, resolved_at = null;
    end if;
  end loop;
  return jsonb_build_object('ok', ok, 'failed', failed);
end $$;

create or replace function finish_search_word_job(p_sku text, p_status text, p_result jsonb default null, p_error text default null) returns void language sql as $$
  update search_word_jobs set status = p_status, done_at = now(), result = p_result, last_error = left(p_error, 500) where sku = p_sku
$$;

-- A failed try goes back to the queue for the next tick, until its third try.
create or replace function enqueue_search_words_retry(p_sku text) returns void language sql as $$
  update search_word_jobs set status = 'pending' where sku = p_sku and status = 'failed' and attempts < 3
$$;

-- For the console (D2's page): items whose phrasings did not resolve to them, with what the planner did instead.
create or replace function search_word_reviews_open() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'sku', r.sku, 'name', p.name_en, 'name_ar', p.name_ar, 'phrasing', r.phrasing,
           'got', r.got, 'created_at', r.created_at) order by r.created_at), '[]'::jsonb)
    from search_word_reviews r left join products p on p.sku = r.sku where r.status = 'open'
$$;
create or replace function resolve_search_word_review(p_review uuid, p_by uuid) returns boolean language plpgsql as $$
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  update search_word_reviews set status = 'resolved', resolved_by = p_by, resolved_at = now() where id = p_review and status = 'open';
  return found;
end $$;

do $$ declare r text; t text;
begin
  foreach t in array array['search_word_jobs', 'search_word_state', 'search_word_reviews'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
