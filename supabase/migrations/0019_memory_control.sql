-- 0019 (session B2, build plan 1.14): the customer controls what we remember.
--   1. Every memory says where it came from: 'stated' (the customer told us and said yes to keeping it) or 'observed'
--      (learned from delivered orders).
--   2. "What do you know about me", "forget", "stop remembering" and "remember again" are answered by these functions.
--   3. A stated restriction (an allergy, "no meat") applies to the order it was said for, and is kept for later orders
--      only after the customer says yes.
--   4. Learned aliases no longer go live by themselves: enough evidence makes a candidate ready, and a person approves it.

-- ---------- 1. origin and restrictions ----------
alter table customer_memory add column if not exists origin text not null default 'observed' check (origin in ('stated','observed'));
alter table customer_memory drop constraint if exists customer_memory_kind_check;
alter table customer_memory add constraint customer_memory_kind_check
  check (kind in ('usual_item','brand_pref','note','payment_pref','restriction'));

-- One row per customer who paused memory. No row means memory is on.
create table if not exists customer_memory_prefs (
  party_id   uuid primary key references parties(id) on delete cascade,
  remember   boolean not null default true,
  updated_at timestamptz not null default now());
alter table customer_memory_prefs enable row level security;

create or replace function memory_on(p_party uuid) returns boolean language sql stable as
$$ select coalesce((select remember from customer_memory_prefs where party_id = p_party), true) $$;

-- ---------- 2. the customer's commands ----------
-- Everything we hold about this customer that shapes their orders, in plain terms. No prices.
create or replace function customer_memory_view(p_party uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'remember', memory_on(p_party),
    'orders', (select count(*) from orders where customer_id = p_party and status in ('delivered','closed')),
    'usuals', (select coalesce(jsonb_agg(coalesce(p.name_ar, p.name_en) order by m.weight desc), '[]'::jsonb)
                 from customer_memory m left join products p on p.id::text = m.key
                where m.party_id = p_party and m.kind = 'usual_item'),
    'brands', (select coalesce(jsonb_agg(distinct m.value->>'brand'), '[]'::jsonb) from customer_memory m where m.party_id = p_party and m.kind = 'brand_pref'),
    'payment', (select m.value #>> '{}' from customer_memory m where m.party_id = p_party and m.kind = 'payment_pref' and m.key = 'method'),
    'restrictions', (select coalesce(jsonb_agg(m.value->>'text' order by m.updated_at), '[]'::jsonb) from customer_memory m
                      where m.party_id = p_party and m.kind = 'restriction'),
    'notes', (select coalesce(jsonb_agg(m.value->>'text'), '[]'::jsonb) from customer_memory m where m.party_id = p_party and m.kind = 'note'),
    'places', (select coalesce(jsonb_agg(coalesce(cp.label, v.name_ar, v.name_en)), '[]'::jsonb)
                 from customer_places cp left join villages v on v.id = cp.village_id where cp.party_id = p_party),
    'contact_phone', customer_contact_phone(p_party)) $$;

-- "Forget": every memory row goes, and the customer's id leaves the alias evidence. Saved places that no order points to go
-- too; a place an order points to stays with that order's record, without its label.
create or replace function forget_customer_memory(p_party uuid) returns jsonb language plpgsql as $$
declare v_rows int; v_places int;
begin
  delete from customer_memory where party_id = p_party;
  get diagnostics v_rows = row_count;
  update alias_candidates set customers = array_remove(customers, p_party) where p_party = any(customers);
  delete from customer_places cp where cp.party_id = p_party and not exists (select 1 from orders o where o.place_id = cp.id);
  get diagnostics v_places = row_count;
  update customer_places set label = null where party_id = p_party;
  return jsonb_build_object('ok', true, 'memories_deleted', v_rows, 'places_deleted', v_places);
end $$;

-- "Stop remembering" / "remember again". Paused means: nothing new is learned and nothing learned is used.
-- A restriction the customer asked us to keep is still applied: explicit restrictions outrank everything (invariant 16).
create or replace function set_memory_pref(p_party uuid, p_remember boolean) returns jsonb language sql as $$
  insert into customer_memory_prefs(party_id, remember) values (p_party, p_remember)
    on conflict (party_id) do update set remember = excluded.remember, updated_at = now()
  returning jsonb_build_object('ok', true, 'remember', remember) $$;

-- ---------- 3. stated restrictions ----------
-- Called only after the customer tapped yes. Kept whether or not memory is paused: they asked for this one by name.
create or replace function save_stated_restriction(p_party uuid, p_text text) returns jsonb language plpgsql as $$
declare v_text text := btrim(p_text);
begin
  if v_text is null or length(v_text) < 2 or length(v_text) > 120 then raise exception 'BAD_RESTRICTION'; end if;
  insert into customer_memory(party_id, kind, key, value, origin) values (p_party, 'restriction', fold_text(v_text), jsonb_build_object('text', v_text), 'stated')
    on conflict (party_id, kind, key) do update set value = excluded.value, origin = 'stated', updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function customer_restrictions(p_party uuid) returns jsonb language sql stable as
$$ select coalesce(jsonb_agg(value->>'text' order by updated_at), '[]'::jsonb) from customer_memory where party_id = p_party and kind = 'restriction' $$;

-- What the Concierge is told about a returning customer. With memory paused, only what an order needs (name, places,
-- dues) and the restrictions they asked us to keep.
create or replace function customer_context(p_party uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name', (select display_name from parties where id = p_party),
    'orders', (select count(*) from orders where customer_id = p_party and status in ('delivered','closed')),
    'usuals', case when memory_on(p_party) then (select coalesce(jsonb_agg(x.value || jsonb_build_object('times', x.weight) order by x.weight desc), '[]'::jsonb)
                 from (select value, weight from customer_memory where party_id = p_party and kind = 'usual_item' order by weight desc limit 8) x) else '[]'::jsonb end,
    'brands', case when memory_on(p_party) then (select coalesce(jsonb_object_agg(key, value->>'brand'), '{}'::jsonb) from customer_memory where party_id = p_party and kind = 'brand_pref') else '{}'::jsonb end,
    'notes', case when memory_on(p_party) then (select coalesce(jsonb_agg(value->>'text'), '[]'::jsonb) from customer_memory where party_id = p_party and kind = 'note') else '[]'::jsonb end,
    'payment', case when memory_on(p_party) then (select value from customer_memory where party_id = p_party and kind = 'payment_pref' and key = 'method') end,
    'restrictions', customer_restrictions(p_party),
    'memory_paused', not memory_on(p_party),
    'places', (select coalesce(jsonb_agg(jsonb_build_object('place_id', cp.id, 'label', cp.label, 'village', v.name_ar, 'verified', cp.verified_by_driver)
                         order by cp.last_used_at desc nulls last), '[]'::jsonb)
                 from customer_places cp left join villages v on v.id = cp.village_id where cp.party_id = p_party),
    'dues_usd', customer_dues_usd(p_party)) $$;

-- ---------- 4. learning, with a person approving new words ----------
alter table alias_candidates drop constraint if exists alias_candidates_status_check;
alter table alias_candidates add constraint alias_candidates_status_check check (status in ('candidate','ready','promoted','rejected'));
alter table alias_candidates add column if not exists reviewed_by uuid references parties(id);
alter table alias_candidates add column if not exists reviewed_at timestamptz;

create or replace function learn_from_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; L jsonb := setting('learning'); v_ready int := 0; v_fold text; v_on boolean;
begin
  select * into o from orders where id = p_order;
  if o.status not in ('delivered','closed') then return jsonb_build_object('learned', false); end if;
  if exists (select 1 from order_events where order_id = p_order and reason = 'learned') then return jsonb_build_object('learned', false, 'already', true); end if;
  v_on := memory_on(o.customer_id);
  for r in select i.product_id, i.qty, i.raw_phrase, p.sub_type, p.brand, p.name_en from order_items i join products p on p.id = i.product_id where i.order_id = p_order loop
    if v_on then
      insert into customer_memory(party_id, kind, key, value, origin) values (o.customer_id, 'usual_item', r.product_id::text, jsonb_build_object('name', r.name_en, 'last_qty', r.qty), 'observed')
        on conflict (party_id, kind, key) do update set weight = customer_memory.weight + 1, value = excluded.value, updated_at = now();
      if r.sub_type is not null and r.brand is not null then
        insert into customer_memory(party_id, kind, key, value, origin) values (o.customer_id, 'brand_pref', r.sub_type, jsonb_build_object('brand', r.brand, 'product_id', r.product_id), 'observed')
          on conflict (party_id, kind, key) do update set weight = customer_memory.weight + 1, value = excluded.value, updated_at = now();
      end if;
      -- The words people use are evidence for a person to review. They no longer go live by themselves.
      v_fold := fold_text(coalesce(r.raw_phrase, ''));
      if length(v_fold) between 3 and 40 and not exists (select 1 from product_aliases a where a.product_id = r.product_id and a.alias_folded = v_fold) then
        insert into alias_candidates(alias_folded, product_id, alias, customers) values (v_fold, r.product_id, r.raw_phrase, array[o.customer_id])
          on conflict (alias_folded, product_id) do update set hits = alias_candidates.hits + 1, updated_at = now(),
            customers = case when o.customer_id = any(alias_candidates.customers) then alias_candidates.customers else alias_candidates.customers || o.customer_id end;
        update alias_candidates set status = 'ready'
         where alias_folded = v_fold and product_id = r.product_id and status = 'candidate'
           and hits >= (L->>'alias_min_hits')::int and cardinality(customers) >= (L->>'alias_min_customers')::int;
        if found then v_ready := v_ready + 1; end if;
      end if;
    end if;
  end loop;
  if v_on then
    insert into customer_memory(party_id, kind, key, value, origin) values (o.customer_id, 'payment_pref', 'method', to_jsonb(o.payment_method::text), 'observed')
      on conflict (party_id, kind, key) do update set value = excluded.value, weight = customer_memory.weight + 1, updated_at = now();
  end if;
  insert into order_events(order_id, from_status, to_status, actor, reason) values (p_order, o.status, o.status, 'system', 'learned');
  return jsonb_build_object('learned', true, 'memory_on', v_on, 'aliases_awaiting_approval', v_ready, 'aliases_promoted', 0);
end $$;

-- The review list for the console, and the decision. Only the ops lead or an admin.
create or replace function alias_candidates_ready() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('alias_folded', a.alias_folded, 'product_id', a.product_id, 'alias', a.alias, 'product', p.name_en,
                  'product_ar', p.name_ar, 'hits', a.hits, 'customers', cardinality(a.customers)) order by a.hits desc), '[]'::jsonb)
    from alias_candidates a join products p on p.id = a.product_id where a.status = 'ready' $$;

create or replace function review_alias(p_alias_folded text, p_product uuid, p_by uuid, p_approve boolean) returns jsonb language plpgsql as $$
declare a alias_candidates%rowtype;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  select * into a from alias_candidates where alias_folded = p_alias_folded and product_id = p_product for update;
  if not found then raise exception 'ALIAS_NOT_FOUND'; end if;
  if a.status not in ('candidate','ready') then return jsonb_build_object('ok', true, 'already', a.status); end if;
  update alias_candidates set status = case when p_approve then 'promoted' else 'rejected' end, reviewed_by = p_by, reviewed_at = now()
   where alias_folded = p_alias_folded and product_id = p_product;
  if p_approve then
    insert into product_aliases(product_id, alias, lang, learned) values (a.product_id, a.alias, 'ar', true) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'promoted' else 'rejected' end);
end $$;

-- Locked like everything else.
do $$ declare r text;
begin
  revoke execute on all functions in schema public from public;
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table customer_memory_prefs from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table customer_memory_prefs to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
