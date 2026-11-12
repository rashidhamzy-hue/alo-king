-- 0008: second independent review.
--   A. outbox claim is a lease, so two overlapping retries cannot both send
--   B. goods coming back from a failed delivery are received, restocked or written off
--   C. anything the system gives up on stays in an exception queue until a person closes it
--   D. explicit grants for the server role (the revoke in 0007 relied on Supabase's defaults)

-- ---------- A ----------
alter table wa_outbox add column if not exists claimed_at timestamptz not null default now();
insert into settings(key, value) values ('outbox', '{"lease_seconds": 60}') on conflict (key) do nothing;

-- true  = you hold the message, send it now.
-- false = it was sent, or another attempt took it less than a lease ago and may still be sending.
-- A claim whose holder died is taken over after the lease. That resend can, rarely, duplicate a message the provider
-- had already accepted: the choice is deliberate, because a customer left without a reply is worse than a repeated card,
-- and every button on a repeated card is a no-op the second time.
create or replace function outbox_claim(p_key text, p_line wa_line, p_party uuid, p_payload jsonb) returns boolean language plpgsql as $$
declare o wa_outbox%rowtype;
begin
  insert into wa_outbox(dedupe_key, line, party_id, payload) values (p_key, p_line, p_party, p_payload) on conflict do nothing;
  if found then return true; end if;
  select * into o from wa_outbox where dedupe_key = p_key for update;
  if o.status = 'sent' then return false; end if;
  if o.status = 'pending' and o.claimed_at > now() - make_interval(secs => (setting('outbox')->>'lease_seconds')::int) then return false; end if;
  update wa_outbox set status = 'pending', claimed_at = now() where dedupe_key = p_key;
  return true;
end $$;

-- ---------- B ----------
-- The picker counts what the rider brought back. Shelf-stable goods go back on the shelf by default.
-- Chilled, frozen and fresh goods are written off unless the picker says, item by item, that they are fit to sell.
-- p_restock: {"<product_id>": qty_fit_to_sell, ...}; omit a product to use the default for its storage zone.
create or replace function receive_return(p_order uuid, p_by uuid, p_restock jsonb default '{}') returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; v_ok numeric; v_back numeric := 0; v_waste numeric := 0; v_waste_usd numeric := 0;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.status = 'returned' or exists (select 1 from order_events where order_id = p_order and reason = 'return_received') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if o.status <> 'failed_delivery' then raise exception 'NOT_A_FAILED_DELIVERY %', o.status; end if;
  if not exists (select 1 from parties where id = p_by and role in ('picker','ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  for r in select i.product_id, i.qty, i.unit_price_usd, f.source_id, p.storage
             from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
             join products p on p.id = i.product_id where i.order_id = p_order and s.kind = 'dark_store' loop
    v_ok := least(r.qty, greatest(0, coalesce((p_restock->>r.product_id::text)::numeric, case when r.storage = 'ambient' then r.qty else 0 end)));
    insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id) values (r.source_id, r.product_id, r.qty, 'return', p_order, p_by);
    update stock_levels set on_hand = on_hand + v_ok where source_id = r.source_id and product_id = r.product_id;
    if r.qty - v_ok > 0 then
      insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id) values (r.source_id, r.product_id, -(r.qty - v_ok), 'waste', p_order, p_by);
    end if;
    v_back := v_back + v_ok; v_waste := v_waste + r.qty - v_ok; v_waste_usd := v_waste_usd + (r.qty - v_ok) * r.unit_price_usd;
  end loop;
  perform transition_order(p_order, 'returned', 'ops', p_by, 'return_received', jsonb_build_object('restocked', v_back, 'wasted', v_waste));
  perform transition_order(p_order, 'closed', 'system', null, 'returned_and_reconciled');
  return jsonb_build_object('ok', true, 'restocked_units', v_back, 'wasted_units', v_waste, 'wasted_at_sell_price_usd', round(v_waste_usd, 2));
end $$;

-- Failed deliveries whose goods nobody has received back yet. The cron raises these.
create or replace function returns_pending() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'short_code', o.short_code)), '[]'::jsonb) from orders o
   where o.status = 'failed_delivery' and exists (select 1 from fulfilments f join sources s on s.id = f.source_id where f.order_id = o.id and s.kind = 'dark_store') $$;

-- ---------- C ----------
create table if not exists ops_exceptions (
  id uuid primary key default gen_random_uuid(), kind text not null, ref text not null, detail jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at timestamptz not null default now(), last_alert_at timestamptz, resolved_by uuid references parties(id), resolved_at timestamptz);
create unique index if not exists ops_exceptions_one_open on ops_exceptions(kind, ref) where status <> 'resolved';
alter table ops_exceptions enable row level security;

create or replace function raise_ops_exception(p_kind text, p_ref text, p_detail jsonb default '{}') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into ops_exceptions(kind, ref, detail) values (p_kind, p_ref, p_detail) on conflict (kind, ref) where status <> 'resolved' do nothing returning id into v;
  if v is null then select id into v from ops_exceptions where kind = p_kind and ref = p_ref and status <> 'resolved'; end if;
  return v;
end $$;

-- Open cases due an alert (never alerted, or not for ten minutes). Marks them alerted. Acknowledged cases stay listed but quiet.
create or replace function ops_exceptions_due() returns setof ops_exceptions language sql as $$
  update ops_exceptions set last_alert_at = now()
   where status = 'open' and (last_alert_at is null or last_alert_at < now() - interval '10 minutes') returning * $$;

create or replace function resolve_ops_exception(p_id uuid, p_by uuid, p_status text default 'resolved') returns void language sql as $$
  update ops_exceptions set status = p_status, resolved_by = p_by, resolved_at = case when p_status = 'resolved' then now() end where id = p_id $$;

-- A turn the database gave up on is an exception too, whatever the worker manages to do afterwards.
create or replace function begin_turn(p_key text, p_line wa_line, p_conversation uuid default null) returns text language plpgsql as $$
declare t turns%rowtype;
begin
  insert into turns(turn_key, line, conversation_id) values (p_key, p_line, p_conversation) on conflict do nothing;
  if found then return 'run'; end if;
  select * into t from turns where turn_key = p_key for update;
  if t.status = 'done' then return 'done'; end if;
  if t.attempts >= 4 then
    update turns set status = 'failed', finished_at = now() where turn_key = p_key;
    perform raise_ops_exception('turn_failed', p_key, jsonb_build_object('line', p_line, 'attempts', t.attempts));
    return 'give_up';
  end if;
  update turns set attempts = attempts + 1, status = 'running' where turn_key = p_key;
  return 'retry';
end $$;

-- ---------- D ----------
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant execute on all functions in schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
    alter default privileges in schema public grant all on tables to service_role;
  end if;
end $$;
