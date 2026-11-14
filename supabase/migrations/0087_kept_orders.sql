-- Alo King Chouf: session K1, docs/AUDIT-2026-11-14.md item 4. An order sent after closing time is kept (the basket lives in the
-- conversation, turn.ts and pipeline.ts) and, when the shop opens, offered once with one button, inside the 24-hour window.
-- This table only says who has a kept order and whether it was offered; it holds no basket, no price and no address.
-- The offer is a service message about the customer's own order, never a promotion (invariant 17), and only to someone whose
-- last message to us is less than 23 hours old (the gateway's can_send still decides).

create table if not exists kept_orders (
  id              uuid primary key default gen_random_uuid(),
  party_id        uuid not null references parties(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  opens           text,
  kept_at         timestamptz not null default now(),
  offered_at      timestamptz,
  cleared_at      timestamptz
);
create unique index if not exists kept_orders_one_open on kept_orders(party_id) where cleared_at is null;

-- Open now, by settings.hours (the same rule as quote_order's `closed` issue).
create or replace function shop_open_now() returns boolean language sql stable as $$
  select not ((now() at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut'))::time < (setting('hours')->>'open')::time
           or (now() at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut'))::time >= (setting('hours')->>'close')::time) $$;

-- Kept (again): one open row per customer; keeping again restarts the clock and the offer.
create or replace function keep_order(p_party uuid, p_conversation uuid, p_opens text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  update kept_orders set kept_at = now(), opens = p_opens, conversation_id = coalesce(p_conversation, conversation_id), offered_at = null
   where party_id = p_party and cleared_at is null returning id into v_id;
  if v_id is null then
    insert into kept_orders(party_id, conversation_id, opens) values (p_party, p_conversation, p_opens) returning id into v_id;
  end if;
  return v_id;
end $$;

-- Taken up (the button, a card) or replaced by a new order: nothing to offer any more.
create or replace function clear_kept_order(p_party uuid) returns boolean language plpgsql as $$
begin
  update kept_orders set cleared_at = now() where party_id = p_party and cleared_at is null;
  return found;
end $$;

-- Due: the shop is open, the order was never offered, and it was kept less than 23 hours ago by someone whose last message to
-- us is less than 23 hours old.
create or replace function kept_orders_due(p_limit int default 20) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'party_id', k.party_id) order by k.kept_at), '[]'::jsonb)
    from (select k.* from kept_orders k
           where shop_open_now() and k.cleared_at is null and k.offered_at is null and k.kept_at > now() - interval '23 hours'
             and exists (select 1 from wa_messages m where m.party_id = k.party_id and m.line = 'customer' and m.direction = 'inbound'
                                                     and m.created_at > now() - interval '23 hours')
           order by k.kept_at limit p_limit) k $$;

create or replace function mark_kept_offered(p_id uuid) returns boolean language plpgsql as $$
begin
  update kept_orders set offered_at = now() where id = p_id and offered_at is null;
  return found;
end $$;

do $$ declare r text;
begin
  alter table kept_orders enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table kept_orders from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
