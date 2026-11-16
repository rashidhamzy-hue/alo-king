-- Alo King Chouf, session SR1 (search by meaning and facts), part 1 of 5: pgvector and the embeddings.
-- docs/PRODUCT_DATA_STANDARD.md, "Search by meaning": pgvector in the existing Postgres, beside the built word search and the language pack.
--
--   vector               the extension, in the extensions schema (as pg_trgm and pgcrypto, 0020): never in public, no client grant.
--   product_embeddings   one embedding per item and model, from PD1's search document (product_search_documents, 0208). digest is the
--                        document's digest when it was embedded: an item whose document changed is embedded again (embedding_jobs).
--                        The column has no fixed size, so two models (1024 dimensions each today) can sit side by side while they are
--                        compared; a search only ever compares vectors of one model. With about 300 items an exact scan takes well under
--                        a millisecond, so there is no approximate index (one can be added per model when the catalogue grows).
--   query_embeddings     the cache of query embeddings, by model and a key (md5 of the folded query). The customer's words are not kept:
--                        only the key and the vector.
--   settings.search      the switch, the model, the daily cap in dollars, and the ranking numbers (0213 adds the fact thresholds).
--   embedding_allowed()  whether a query may be embedded now: switched on, and today's spend (model_costs, workflow 'search') under the cap.
--   record_embedding_cost() adds a call's tokens and dollars to today's row in model_costs (COST1's table, 0139): workflow 'search', run
--                        the day, the model, the step ('query' or 'documents'). Priced from model_prices; a model with no price is refused.
-- If the embedding call fails or the cap is reached, the search runs on words alone and the turn still answers (find_products, 0214).

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists product_embeddings (
  product_id uuid not null references products(id) on delete cascade,
  model      text not null check (model <> ''),
  digest     text not null,                         -- product_search_documents.digest it was built from
  dims       int not null check (dims > 0),
  embedding  extensions.vector not null,
  built_at   timestamptz not null default now(),
  primary key (product_id, model)
);

create table if not exists query_embeddings (
  model       text not null,
  key         text not null check (key ~ '^[0-9a-f]{32}$'),
  embedding   extensions.vector not null,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  hits        int not null default 0,
  primary key (model, key)
);

insert into settings(key, value) values ('search', jsonb_build_object(
  'embeddings', 'off',                 -- 'on' once product_embeddings holds the model's vectors (the search-embed workflow)
  'model', '@cf/baai/bge-m3',
  'daily_cap_usd', 0.5,                -- query embeddings, per day (about 40 million tokens at the list price)
  'rrf_k', 60,                         -- reciprocal rank fusion
  'meaning_top', 40,                   -- the nearest items the meaning list takes
  'meaning_max_distance', 0.55,        -- cosine distance; farther items are not a meaning match
  'cache_days', 30))
on conflict (key) do nothing;

-- Workers AI list prices (developers.cloudflare.com/workers-ai/platform/pricing, "Embeddings model pricing", read 16 Nov 2026).
insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, long_context_above_tokens, long_input_usd_per_mtok,
                         long_output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok, source) values
  ('@cf/baai/bge-m3', '2026-11-16', 0.012, 0, null, null, null, null, null, 'Cloudflare Workers AI list price, read 16 Nov 2026 (session SR1)'),
  ('@cf/qwen/qwen3-embedding-0.6b', '2026-11-16', 0.012, 0, null, null, null, null, null, 'Cloudflare Workers AI list price, read 16 Nov 2026 (session SR1)')
on conflict (model, effective_from) do nothing;

-- The documents to embed for a model: active items whose document is new or changed since their embedding.
create or replace function embedding_jobs(p_model text, p_limit int default 100) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', d.product_id, 'digest', d.digest, 'document', d.document) order by d.product_id), '[]'::jsonb)
    from (select d.* from product_search_documents d join products p on p.id = d.product_id and p.is_active
            left join product_embeddings e on e.product_id = d.product_id and e.model = p_model
           where e.product_id is null or e.digest <> d.digest
           order by d.product_id limit greatest(1, least(coalesce(p_limit, 100), 500))) d $$;

-- Saves embeddings: p_rows [{product_id, digest, embedding: [numbers]}]. Returns how many were written.
create or replace function save_product_embeddings(p_model text, p_rows jsonb) returns int
language plpgsql set search_path = public, extensions, pg_temp as $$
declare r jsonb; n int := 0; v extensions.vector;
begin
  if coalesce(p_model, '') = '' then raise exception 'EMBEDDING_NEEDS_A_MODEL'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v := (r->'embedding')::text::extensions.vector;
    insert into product_embeddings(product_id, model, digest, dims, embedding)
      values ((r->>'product_id')::uuid, p_model, r->>'digest', extensions.vector_dims(v), v)
      on conflict (product_id, model) do update set digest = excluded.digest, dims = excluded.dims, embedding = excluded.embedding, built_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- The key of a query: md5 of its folded words (case, spacing and Arabic letter forms do not make a new key).
create or replace function query_embedding_key(p_text text) returns text language sql immutable set search_path = public, pg_temp as $$
  select md5(array_to_string(catalog_tokens(coalesce(p_text, '')), ' ')) $$;

create or replace function save_query_embedding(p_model text, p_key text, p_embedding text) returns void
language sql set search_path = public, extensions, pg_temp as $$
  insert into query_embeddings(model, key, embedding) values (p_model, p_key, p_embedding::extensions.vector)
  on conflict (model, key) do update set embedding = excluded.embedding, last_used_at = now() $$;

-- Cached query embeddings older than settings.search.cache_days are dropped (the nightly job or anyone may call it).
create or replace function prune_query_embeddings() returns int language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  delete from query_embeddings where last_used_at < now() - make_interval(days => coalesce((setting('search')->>'cache_days')::int, 30));
  get diagnostics n = row_count;
  return n;
end $$;

-- Today's spend on query embeddings, Beirut day (as model_costs.day).
create or replace function embedding_spend_today() returns numeric language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(usd), 0) from model_costs where workflow = 'search' and run_id = ((now() at time zone 'Asia/Beirut')::date)::text $$;

create or replace function embedding_allowed() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('allowed', coalesce(s->>'embeddings', 'off') = 'on' and embedding_spend_today() < coalesce((s->>'daily_cap_usd')::numeric, 0),
                            'enabled', coalesce(s->>'embeddings', 'off') = 'on', 'model', s->>'model',
                            'spent_usd', embedding_spend_today(), 'cap_usd', coalesce((s->>'daily_cap_usd')::numeric, 0))
    from (select coalesce(setting('search'), '{}'::jsonb) as s) x $$;

-- One or more calls' tokens added to today's row. A model with no price row is refused (never counted as free, as COST1).
create or replace function record_embedding_cost(p_model text, p_step text, p_calls int, p_tokens bigint) returns numeric
language plpgsql set search_path = public, pg_temp as $$
declare pr model_prices%rowtype; v_usd numeric; v_day text := ((now() at time zone 'Asia/Beirut')::date)::text;
begin
  select * into pr from model_prices_in_force() where model = p_model;
  if not found then raise exception 'NO_PRICE: % has no model_prices row', p_model; end if;
  if coalesce(p_calls, 0) < 0 or coalesce(p_tokens, 0) < 0 then raise exception 'MODEL_COST_NEGATIVE'; end if;
  v_usd := round(coalesce(p_tokens, 0) * pr.input_usd_per_mtok / 1000000.0, 6);
  insert into model_costs(workflow, run_id, model, step, calls, input_tokens, usd, cap_usd)
    values ('search', v_day, p_model, coalesce(p_step, 'query'), coalesce(p_calls, 0), coalesce(p_tokens, 0), v_usd,
            (setting('search')->>'daily_cap_usd')::numeric)
    on conflict (workflow, run_id, model, step) do update set
      calls = model_costs.calls + excluded.calls, input_tokens = model_costs.input_tokens + excluded.input_tokens,
      -- priced on the day's tokens, not summed call by call: one query is about a ten-millionth of a dollar and would round to nothing
      usd = round((model_costs.input_tokens + excluded.input_tokens) * pr.input_usd_per_mtok / 1000000.0, 6), cap_usd = excluded.cap_usd;
  return v_usd;
end $$;

do $$ declare t text; r text; f text;
begin
  foreach t in array array['product_embeddings', 'query_embeddings'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  foreach f in array array['embedding_jobs(text,int)', 'save_product_embeddings(text,jsonb)', 'query_embedding_key(text)',
                           'save_query_embedding(text,text,text)', 'prune_query_embeddings()', 'embedding_spend_today()', 'embedding_allowed()',
                           'record_embedding_cost(text,text,int,bigint)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant usage on schema extensions to service_role; end if;
end $$;
