-- Alo King Chouf, session C1, build plan 1.12: demand signals.
-- One log of what customers asked for and could not get: an unknown product, something out of stock, a restaurant that
-- has not signed, a village we do not serve, and (from 2.8) a full delivery slot. It feeds purchasing, the onboarding of
-- restaurants and the choice of zones. It is a record of facts, not a ranking: nothing here is shown to customers.
--
-- The four misses session B1 named (docs/HANDOFF.md, "For other sessions") are logged inside the database, by the
-- functions that find them, so every channel that calls them (WhatsApp today, the website in Phase 9) logs the same way:
--   plan_order(): unavailable lines (unsigned restaurant), lines with status not_found (unknown product), matched lines not
--                 in stock (out of stock), and the village_not_served / village_not_recognised issues (out of area)
--   repeat_plan(): the `missing` items of the last order
-- Both were STABLE; PostgREST runs a stable function in a read-only transaction, so each is renamed to *_core (unchanged)
-- and a VOLATILE wrapper with the same name and arguments returns the core's result after logging it. The same pattern as
-- can_send in 0011. A later change to the planner must redefine plan_order_core / repeat_plan_core, not the wrappers;
-- test/db/demand-signals.test.ts fails if the wrapper stops logging.
-- Logging never breaks a turn: any error inside it becomes a warning, and the plan is returned as computed.
-- A retried turn does not count twice: one row per customer, kind and subject per hour (dedupe_key).

create type demand_kind as enum ('unknown_product', 'out_of_stock', 'unsigned_restaurant', 'out_of_area', 'no_slot');

create table demand_signals (
  id           uuid primary key default gen_random_uuid(),
  kind         demand_kind not null,
  origin       text not null,                 -- plan_order | repeat | console | ... : which path saw it
  party_id     uuid references parties(id),
  query        text,                          -- the customer's words for the item, as read
  subject      text not null,                 -- what is grouped on: a product id, the folded words, a shop or a village
  product_id   uuid references products(id),
  source_hint  text,                          -- the restaurant the customer named
  village_id   uuid references villages(id),
  village_said text,
  detail       jsonb not null default '{}',
  dedupe_key   text not null unique,
  created_at   timestamptz not null default now()
);
create index demand_signals_kind_time on demand_signals(kind, created_at);
create index demand_signals_product on demand_signals(product_id) where product_id is not null;

-- The one way in. Returns true when a row was written, false when it was already logged this hour.
create or replace function log_demand(
  p_kind demand_kind, p_origin text, p_party uuid default null, p_query text default null, p_product uuid default null,
  p_source_hint text default null, p_village uuid default null, p_village_said text default null, p_detail jsonb default '{}')
returns boolean language plpgsql as $$
declare v_subject text; v_key text; n int;
begin
  v_subject := coalesce(p_product::text,
                        case p_kind when 'unsigned_restaurant' then nullif(fold_text(p_source_hint), '')
                                    when 'out_of_area' then coalesce(p_village::text, nullif(fold_text(p_village_said), '')) end,
                        nullif(fold_text(p_query), ''), '?');
  v_key := p_kind || ':' || coalesce(p_party::text, '-') || ':' || v_subject || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24');
  insert into demand_signals(kind, origin, party_id, query, subject, product_id, source_hint, village_id, village_said, detail, dedupe_key)
    values (p_kind, p_origin, p_party, nullif(btrim(p_query), ''), v_subject, p_product, nullif(btrim(p_source_hint), ''),
            p_village, nullif(btrim(p_village_said), ''), coalesce(p_detail, '{}'), v_key)
    on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Everything a plan says the customer could not have.
create or replace function log_plan_demand(p_party uuid, p_plan jsonb) returns int language plpgsql as $$
declare x jsonb; n int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_plan->'unavailable', '[]')) loop
    n := n + log_demand('unsigned_restaurant', 'plan_order', p_party, x->>'raw', null, x->>'source_hint')::int;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_plan->'lines', '[]')) loop
    if x->>'status' = 'not_found' then
      n := n + log_demand('unknown_product', 'plan_order', p_party, coalesce(nullif(x->>'query', ''), x->>'raw'), null, null, null, null,
                          jsonb_build_object('raw', x->>'raw'))::int;
    elsif x->>'status' = 'matched' and (x->'chosen'->>'in_stock')::boolean is false then
      n := n + log_demand('out_of_stock', 'plan_order', p_party, x->>'raw', (x->'chosen'->>'product_id')::uuid, null, null, null,
                          jsonb_build_object('qty', x->'qty'))::int;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_plan->'quote'->'issues', '[]')) loop
    if x->>'code' = 'insufficient_stock' then
      n := n + log_demand('out_of_stock', 'plan_order', p_party, x->>'name', (x->>'product_id')::uuid, null, null, null,
                          jsonb_build_object('available', x->'available'))::int;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_plan->'issues', '[]')) loop
    if x->>'code' in ('village_not_served', 'village_not_recognised') then
      n := n + log_demand('out_of_area', 'plan_order', p_party, null, null, null,
                          (select id from villages where name_en = x->>'village' limit 1), x->>'said',
                          jsonb_build_object('recognised', x->>'code' = 'village_not_served', 'village', x->>'village'))::int;
    end if;
  end loop;
  return n;
end $$;

alter function plan_order(uuid, jsonb, uuid, jsonb) rename to plan_order_core;
create function plan_order(p_party uuid, p_intent jsonb, p_village uuid default null, p_choices jsonb default '{}')
returns jsonb language plpgsql volatile as $$
declare res jsonb := plan_order_core(p_party, p_intent, p_village, p_choices);
begin
  begin
    perform log_plan_demand(p_party, res);
  exception when others then
    raise warning 'demand log skipped (plan_order): % %', sqlstate, sqlerrm;
  end;
  return res;
end $$;

alter function repeat_plan(uuid, uuid) rename to repeat_plan_core;
create function repeat_plan(p_party uuid, p_order uuid default null) returns jsonb language plpgsql volatile as $$
declare res jsonb := repeat_plan_core(p_party, p_order); x jsonb;
begin
  begin
    for x in select * from jsonb_array_elements(coalesce(res->'missing', '[]')) loop
      perform log_demand('out_of_stock', 'repeat', p_party, coalesce(x->>'name_ar', x->>'name'), (x->>'product_id')::uuid, null, null, null,
                         jsonb_build_object('order_id', res->>'order_id'));
    end loop;
  exception when others then
    raise warning 'demand log skipped (repeat_plan): % %', sqlstate, sqlerrm;
  end;
  return res;
end $$;

-- What was asked for and not had, grouped, for purchasing and onboarding. Customers = distinct people, the fairer weight.
create or replace function unmet_demand(p_since timestamptz default now() - interval '7 days', p_until timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(g) order by g.customers desc, g.asks desc, g.kind, g.label), '[]'::jsonb) from (
    select d.kind, d.subject,
           coalesce(p.name_en, max(d.source_hint), max(v.name_en), max(d.village_said), max(d.query)) as label,
           p.name_ar, d.product_id, max(d.village_id::text)::uuid as village_id,
           count(*) as asks, count(distinct d.party_id) as customers, min(d.created_at) as first_seen, max(d.created_at) as last_seen,
           (select jsonb_agg(distinct q) from (select d2.query as q from demand_signals d2
              where d2.kind = d.kind and d2.subject = d.subject and d2.query is not null and d2.created_at >= p_since and d2.created_at < p_until limit 5) s) as said
      from demand_signals d left join products p on p.id = d.product_id left join villages v on v.id = d.village_id
     where d.created_at >= p_since and d.created_at < p_until
     group by d.kind, d.subject, d.product_id, p.name_en, p.name_ar) g $$;

do $$ declare r text;
begin
  alter table demand_signals enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table demand_signals from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
