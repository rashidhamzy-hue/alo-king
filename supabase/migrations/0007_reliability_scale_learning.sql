-- 0007: what the independent review got right, plus the pieces needed to grow past one hub.
--   A. end-to-end idempotency: turns, outbox, inbound reconciliation
--   B. the database rejects stale or invalid quotes on its own
--   C. markets (one per region) so a second city is configuration, not a rewrite
--   D. memory and learning: customer memory, alias learning from delivered orders, automatic eval capture
--   E. merchant channels: menu links, POS/aggregator connections, three merchant tiers
--   F. lock every function away from client roles

-- ---------- A. idempotency ----------
-- A turn is keyed by the WhatsApp message ids it answers. Running the same turn twice is a no-op.
create table if not exists turns (
  turn_key text primary key, line wa_line not null, conversation_id uuid references conversations(id),
  status text not null default 'running' check (status in ('running','done','failed')),
  attempts int not null default 1, started_at timestamptz not null default now(), finished_at timestamptz, outcome jsonb);

create or replace function begin_turn(p_key text, p_line wa_line, p_conversation uuid default null) returns text language plpgsql as $$
declare t turns%rowtype;
begin
  insert into turns(turn_key, line, conversation_id) values (p_key, p_line, p_conversation) on conflict do nothing;
  if found then return 'run'; end if;
  select * into t from turns where turn_key = p_key for update;
  if t.status = 'done' then return 'done'; end if;
  if t.attempts >= 4 then update turns set status = 'failed', finished_at = now() where turn_key = p_key; return 'give_up'; end if;
  update turns set attempts = attempts + 1, status = 'running' where turn_key = p_key;
  return 'retry';
end $$;

create or replace function finish_turn(p_key text, p_outcome jsonb default '{}') returns void language sql as
$$ update turns set status = 'done', finished_at = now(), outcome = p_outcome where turn_key = p_key $$;

-- Every outbound message is claimed here before it is sent. A retried turn finds its messages already sent and skips them.
create table if not exists wa_outbox (
  dedupe_key text primary key, line wa_line not null, party_id uuid references parties(id), payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  wa_message_id text, attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(), sent_at timestamptz);

create or replace function outbox_claim(p_key text, p_line wa_line, p_party uuid, p_payload jsonb) returns boolean language plpgsql as $$
declare v text;
begin
  insert into wa_outbox(dedupe_key, line, party_id, payload) values (p_key, p_line, p_party, p_payload) on conflict do nothing;
  if found then return true; end if;
  select status into v from wa_outbox where dedupe_key = p_key for update;
  return v <> 'sent';
end $$;

create or replace function outbox_mark(p_key text, p_wamid text, p_error text default null) returns void language sql as $$
  update wa_outbox set status = case when p_error is null then 'sent' else 'failed' end, wa_message_id = p_wamid,
         attempts = attempts + 1, last_error = p_error, sent_at = case when p_error is null then now() end where dedupe_key = p_key $$;

-- The webhook stores an event, then hands it on. If the hand-off dies, the event is stored but never processed,
-- and the provider's retry is swallowed as a duplicate. The cron picks these up and re-delivers them.
alter table wa_inbound_events add column if not exists attempts int not null default 0;
create index if not exists wa_inbound_unprocessed on wa_inbound_events(received_at) where processed_at is null;

create or replace function stale_inbound_events(p_older_than_secs int default 45, p_limit int default 50)
returns setof wa_inbound_events language sql as $$
  update wa_inbound_events e set attempts = e.attempts + 1
   where e.idempotency_key in (select idempotency_key from wa_inbound_events
                                where processed_at is null and attempts < 5 and received_at < now() - make_interval(secs => p_older_than_secs)
                                order by received_at limit p_limit for update skip locked)
  returning e.* $$;

create or replace function mark_inbound_processed(p_key text, p_error text default null) returns void language sql as
$$ update wa_inbound_events set processed_at = now(), error = p_error where idempotency_key = p_key $$;

-- ---------- B. quotes the database can refuse ----------
alter table order_items drop constraint if exists order_items_qty_positive;
alter table order_items add constraint order_items_qty_positive check (qty > 0 and qty <= 200 and unit_price_usd >= 0);
alter table offers drop constraint if exists offers_price_positive;
alter table offers add constraint offers_price_positive check (price_usd > 0 or not is_available);
alter table orders add column if not exists quote_expires_at timestamptz;
insert into settings(key, value) values ('quote', '{"valid_min": 20}') on conflict (key) do nothing;

-- What changed between the card and the tap: price moved, item switched off, kitchen closed.
create or replace function order_quote_issues(p_order uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('item', i.name_snapshot, 'issue',
           case when ofr.id is null or not ofr.is_available then 'unavailable'
                when not s.is_open then 'source_closed'
                else 'price_changed' end, 'was_usd', i.unit_price_usd, 'now_usd', ofr.price_usd)), '[]'::jsonb)
    from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
    left join offers ofr on ofr.source_id = f.source_id and ofr.product_id = i.product_id
   where i.order_id = p_order
     and (ofr.id is null or not ofr.is_available or not s.is_open or ofr.price_usd <> i.unit_price_usd) $$;

-- The confirm tap goes through here. A card older than the validity window is re-checked; if anything moved,
-- the order drops back to draft and the customer gets a fresh card instead of a surprise at the door.
create or replace function confirm_order_checked(p_order uuid, p_party uuid, p_wamid text) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_issues jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status = 'awaiting_confirmation' then
    v_issues := order_quote_issues(p_order);
    if jsonb_array_length(v_issues) > 0 then
      perform transition_order(p_order, 'draft', 'customer', p_party, 'stale_quote', jsonb_build_object('issues', v_issues));
      return jsonb_build_object('status', 'stale_quote', 'changed', false, 'issues', v_issues, 'short_code', o.short_code);
    end if;
    if not o.is_pickup and not exists (select 1 from customer_places cp where cp.id = o.place_id
          and (cp.lat is not null or cp.verified_by_driver or length(coalesce(cp.directions, '') || coalesce(cp.building, '')) >= 8)) then
      return jsonb_build_object('status', 'needs_location', 'changed', false, 'short_code', o.short_code);
    end if;
  end if;
  return handle_order_button(p_order, 'confirm', p_party, p_wamid);
end $$;

-- ---------- C. markets ----------
create table if not exists markets (
  id uuid primary key default gen_random_uuid(), code text unique not null, name text not null,
  tz text not null default 'Asia/Beirut', is_live boolean not null default false, created_at timestamptz not null default now());
insert into markets(code, name, is_live) values ('chouf', 'Chouf', true) on conflict (code) do nothing;

do $$ declare m uuid := (select id from markets where code = 'chouf'); t text;
begin
  foreach t in array array['zones','sources','driver_shifts','orders','campaigns'] loop
    execute format('alter table %I add column if not exists market_id uuid references markets(id)', t);
    execute format('update %I set market_id = %L where market_id is null', t, m);
    execute format('alter table %I alter column market_id set default %L', t, m);
    execute format('create index if not exists %I on %I(market_id)', t || '_market', t);
  end loop;
end $$;

-- Per-market overrides: fees, hours, cash caps, commission floors. Anything not overridden falls back to the global value.
create table if not exists market_settings (market_id uuid references markets(id), key text, value jsonb not null, primary key (market_id, key));
create or replace function setting_for(p_market uuid, p_key text) returns jsonb language sql stable as
$$ select coalesce((select value from market_settings where market_id = p_market and key = p_key), setting(p_key)) $$;

alter table sources add column if not exists tier text not null default 'integrated' check (tier in ('integrated','assisted','manual'));
comment on column sources.tier is 'integrated: menu in catalog, takes orders by button or POS. assisted: menu in catalog, ops phones the order in. manual: not onboarded, every order is a handoff.';

-- ---------- D. memory and learning ----------
create table if not exists customer_memory (
  party_id uuid references parties(id), kind text check (kind in ('usual_item','brand_pref','note','payment_pref')),
  key text, value jsonb not null default '{}', weight numeric not null default 1, updated_at timestamptz not null default now(),
  primary key (party_id, kind, key));

create table if not exists alias_candidates (
  alias_folded text, product_id uuid references products(id), alias text not null, hits int not null default 1,
  customers uuid[] not null default '{}', status text not null default 'candidate' check (status in ('candidate','promoted','rejected')),
  updated_at timestamptz not null default now(), primary key (alias_folded, product_id));

create table if not exists eval_cases (
  id uuid primary key default gen_random_uuid(), kind text not null, input jsonb not null, expected jsonb, got jsonb,
  source text not null, order_id uuid references orders(id), reviewed boolean not null default false, created_at timestamptz not null default now());

insert into settings(key, value) values ('learning', '{"alias_min_hits": 3, "alias_min_customers": 2}') on conflict (key) do nothing;

-- Runs once per delivered order. Three things are learned, all from what the customer confirmed and received:
--   their usuals, their brand per sub-type, and which of their own words mean which product.
create or replace function learn_from_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; L jsonb := setting('learning'); v_promoted int := 0; v_fold text;
begin
  select * into o from orders where id = p_order;
  if o.status not in ('delivered','closed') then return jsonb_build_object('learned', false); end if;
  if exists (select 1 from order_events where order_id = p_order and reason = 'learned') then return jsonb_build_object('learned', false, 'already', true); end if;
  for r in select i.product_id, i.qty, i.raw_phrase, p.sub_type, p.brand, p.name_en from order_items i join products p on p.id = i.product_id where i.order_id = p_order loop
    insert into customer_memory(party_id, kind, key, value) values (o.customer_id, 'usual_item', r.product_id::text, jsonb_build_object('name', r.name_en, 'last_qty', r.qty))
      on conflict (party_id, kind, key) do update set weight = customer_memory.weight + 1, value = excluded.value, updated_at = now();
    if r.sub_type is not null and r.brand is not null then
      insert into customer_memory(party_id, kind, key, value) values (o.customer_id, 'brand_pref', r.sub_type, jsonb_build_object('brand', r.brand, 'product_id', r.product_id))
        on conflict (party_id, kind, key) do update set weight = customer_memory.weight + 1, value = excluded.value, updated_at = now();
    end if;
    v_fold := fold_text(coalesce(r.raw_phrase, ''));
    if length(v_fold) between 3 and 40 and not exists (select 1 from product_aliases a where a.product_id = r.product_id and a.alias_folded = v_fold) then
      insert into alias_candidates(alias_folded, product_id, alias, customers) values (v_fold, r.product_id, r.raw_phrase, array[o.customer_id])
        on conflict (alias_folded, product_id) do update set hits = alias_candidates.hits + 1, updated_at = now(),
          customers = case when o.customer_id = any(alias_candidates.customers) then alias_candidates.customers else alias_candidates.customers || o.customer_id end;
      update alias_candidates set status = 'promoted'
       where alias_folded = v_fold and product_id = r.product_id and status = 'candidate'
         and hits >= (L->>'alias_min_hits')::int and cardinality(customers) >= (L->>'alias_min_customers')::int;
      if found then
        insert into product_aliases(product_id, alias, lang, learned) values (r.product_id, r.raw_phrase, 'ar', true) on conflict do nothing;
        v_promoted := v_promoted + 1;
      end if;
    end if;
  end loop;
  insert into customer_memory(party_id, kind, key, value) values (o.customer_id, 'payment_pref', 'method', to_jsonb(o.payment_method::text))
    on conflict (party_id, kind, key) do update set value = excluded.value, weight = customer_memory.weight + 1, updated_at = now();
  insert into order_events(order_id, from_status, to_status, actor, reason) values (p_order, o.status, o.status, 'system', 'learned');
  return jsonb_build_object('learned', true, 'aliases_promoted', v_promoted);
end $$;

-- A card the customer edited or cancelled right after the agent built it is a free, labelled failure case.
create or replace function capture_eval_from_event() returns trigger language plpgsql as $$
begin
  if new.actor = 'customer' and new.reason in ('card_edit','card_cancel','stale_quote') then
    insert into eval_cases(kind, input, got, source, order_id)
    select 'order_parse', jsonb_build_object('conversation_id', o.conversation_id),
           (select jsonb_agg(jsonb_build_object('raw', i.raw_phrase, 'product', i.name_snapshot, 'qty', i.qty)) from order_items i where i.order_id = o.id),
           new.reason, o.id from orders o where o.id = new.order_id;
  end if;
  return new;
end $$;
drop trigger if exists order_events_eval on order_events;
create trigger order_events_eval after insert on order_events for each row execute function capture_eval_from_event();

-- What the Concierge is told about a returning customer. Small on purpose: facts, not a transcript.
create or replace function customer_context(p_party uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name', (select display_name from parties where id = p_party),
    'orders', (select count(*) from orders where customer_id = p_party and status in ('delivered','closed')),
    'usuals', (select coalesce(jsonb_agg(x.value || jsonb_build_object('times', x.weight) order by x.weight desc), '[]'::jsonb)
                 from (select value, weight from customer_memory where party_id = p_party and kind = 'usual_item' order by weight desc limit 8) x),
    'brands', (select coalesce(jsonb_object_agg(key, value->>'brand'), '{}'::jsonb) from customer_memory where party_id = p_party and kind = 'brand_pref'),
    'notes', (select coalesce(jsonb_agg(value->>'text'), '[]'::jsonb) from customer_memory where party_id = p_party and kind = 'note'),
    'payment', (select value from customer_memory where party_id = p_party and kind = 'payment_pref' and key = 'method'),
    'places', (select coalesce(jsonb_agg(jsonb_build_object('place_id', cp.id, 'label', cp.label, 'village', v.name_ar, 'verified', cp.verified_by_driver)
                         order by cp.last_used_at desc nulls last), '[]'::jsonb)
                 from customer_places cp left join villages v on v.id = cp.village_id where cp.party_id = p_party),
    'dues_usd', customer_dues_usd(p_party)) $$;

-- "Same as last time" / "same as Friday": real past lines, re-priced by quote_order, never re-interpreted by a model.
create or replace function repeat_order_lines(p_party uuid, p_order uuid default null) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'source_id', f.source_id, 'qty', i.qty,
                                               'modifiers', i.modifiers, 'note', i.note)), '[]'::jsonb)
    from order_items i join fulfilments f on f.id = i.fulfilment_id
   where i.order_id = coalesce(p_order, (select id from orders where customer_id = p_party and status in ('delivered','closed')
                                          order by delivered_at desc nulls last limit 1)) $$;

-- ---------- E. merchant channels ----------
create table if not exists source_integrations (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references sources(id),
  kind text not null check (kind in ('menu_url','pos_webhook','deliverect','whatsapp')),
  config jsonb not null default '{}', is_active boolean not null default true,
  last_sync_at timestamptz, last_hash text, last_error text, unique (source_id, kind));
comment on table source_integrations is 'menu_url: {url} fetched nightly and on demand. pos_webhook: {url, secret} we POST new orders. deliverect: {channel_link_id}. whatsapp: default, order card with buttons on the ops line.';

alter table merchant_menu_imports add column if not exists source_url text;
alter table merchant_menu_imports add column if not exists content_hash text;
alter table merchant_menu_imports alter column media_path drop not null;

-- Applies an approved menu extraction: new items appear, prices update, items missing from the menu are switched off.
-- Prices and new items never go live without a person approving the import (merchant 86 and prep time are immediate elsewhere).
create or replace function apply_menu_import(p_import uuid, p_by uuid) returns jsonb language plpgsql as $$
declare m merchant_menu_imports%rowtype; it jsonb; v_prod uuid; v_new int := 0; v_upd int := 0; v_off int; v_seen uuid[] := '{}'; v_name text; v_price numeric;
begin
  select * into m from merchant_menu_imports where id = p_import for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if m.status = 'applied' then return jsonb_build_object('ok', true, 'already', true); end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  -- items follow the MenuExtraction schema: {name_ar, name_en, section, price, currency, options, confidence}
  for it in select * from jsonb_array_elements(coalesce(m.extracted->'items', '[]'::jsonb)) loop
    v_name := coalesce(nullif(trim(it->>'name_en'), ''), nullif(trim(it->>'name_ar'), ''));
    v_price := case when it->>'currency' = 'LBP' then round((it->>'price')::numeric / current_fx(), 2) else (it->>'price')::numeric end;
    continue when v_name is null or coalesce(v_price, 0) <= 0 or coalesce((it->>'confidence')::numeric, 1) < 0.6;
    select p.id into v_prod from products p where p.owner_source_id = m.source_id
       and fold_text(coalesce(p.name_ar, '') || ' ' || p.name_en) = fold_text(coalesce(it->>'name_ar', '') || ' ' || v_name) limit 1;
    if v_prod is null then
      insert into products(sku, owner_source_id, name_en, name_ar, category, sub_type, storage, sell_unit, modifiers)
        values ('M-' || left(m.source_id::text, 8) || '-' || substr(md5(v_name), 1, 8), m.source_id, v_name, nullif(it->>'name_ar', ''),
                'Restaurant', it->>'section', 'ambient', 'piece', coalesce(it->'options', '[]'::jsonb))
        returning id into v_prod;
      insert into offers(source_id, product_id, price_usd) values (m.source_id, v_prod, v_price);
      if nullif(it->>'name_ar', '') is not null then
        insert into product_aliases(product_id, alias, lang) values (v_prod, it->>'name_ar', 'ar') on conflict do nothing;
      end if;
      v_new := v_new + 1;
    else
      update offers set price_usd = v_price, is_available = true where source_id = m.source_id and product_id = v_prod;
      v_upd := v_upd + 1;
    end if;
    v_seen := v_seen || v_prod;
  end loop;
  update offers set is_available = false where source_id = m.source_id and not (product_id = any(v_seen)) and is_available;
  get diagnostics v_off = row_count;
  update merchant_menu_imports set status = 'applied', reviewed_by = p_by where id = p_import;
  return jsonb_build_object('ok', true, 'new', v_new, 'updated', v_upd, 'switched_off', v_off);
end $$;

-- ---------- F. no client role can call a function or read a table directly ----------
do $$ declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('alter default privileges in schema public revoke execute on functions from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
end $$;

create or replace function learn_from_recent_orders() returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select o.id from orders o where o.status in ('delivered','closed') and o.delivered_at > now() - interval '2 days'
             and not exists (select 1 from order_events e where e.order_id = o.id and e.reason = 'learned') limit 100 loop
    perform learn_from_order(r.id); n := n + 1;
  end loop;
  return n;
end $$;
