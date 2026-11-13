-- PROPOSED, NOT A MIGRATION. Written by session D1 (console), 13 November 2026.
--
-- The console writes only through SQL functions. Five of its steps have no function yet, and D1 owns no migration number
-- (BUILD_PLAN "Build sessions"), so they are written here, and the console's tests apply this file on top of every migration
-- to prove the pages against it. Until a migration carries it, those steps show "Not available yet" on staging.
--
-- To ship: copy this file, unchanged, into the next free migration of the lane that owns it (D2 holds 0045-0049), and delete
-- this file in the same pull request. `quote_order` must then refuse to quote while fx_quoting_paused() is true (lane B
-- owns quote_order: see 0052's note on redefining it).
--
--   release_handoff(conversation, by)                        3.5  give a chat back to the Concierge
--   set_offer(product, price_usd, available, by, reason)     3.7  price and availability of a hub item, with a reason
--   set_fx_rate(lbp_per_usd, by)                             3.8  the daily rate; a move above settings.fx.pause_move_pct
--   confirm_fx_rate(pending, by)                                  within the day waits, and pauses quoting, until confirmed
--   fx_quoting_paused()
--   set_zone(zone, fee_usd, eta_minutes, active, by, reason) 3.9  a zone's delivery fee and ETA
--   set_village(village, zone, served, by, reason)                which villages are served, and in which zone
-- Every one checks the acting party's role and writes who, when, what before and after, and why to config_changes.

create table if not exists config_changes (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('offer', 'zone', 'village', 'fx', 'handoff')),
  ref        uuid,
  before     jsonb,
  after      jsonb,
  reason     text,
  changed_by uuid not null references parties(id),
  created_at timestamptz not null default now()
);
create index if not exists config_changes_ref on config_changes(kind, ref, created_at desc);

create or replace function require_role(p_party uuid, p_roles text[]) returns text language plpgsql stable as $$
declare v text := party_role(p_party);                     -- null when the party is blocked or unknown
begin
  if v is null or not (v = any(p_roles)) then raise exception 'NOT_AUTHORISED'; end if;
  return v;
end $$;

-- ---------- 3.5 ----------
create or replace function release_handoff(p_conversation uuid, p_by uuid) returns jsonb language plpgsql as $$
declare c conversations%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into c from conversations where id = p_conversation and line = 'customer' for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if not c.human_handoff then return jsonb_build_object('ok', true, 'already', true); end if;
  update conversations set human_handoff = false, updated_at = now() where id = p_conversation;
  update handoffs set status = 'resolved', resolved_at = now(), assigned_to = coalesce(assigned_to, p_by)
   where conversation_id = p_conversation and status <> 'resolved';
  insert into config_changes(kind, ref, before, after, changed_by) values ('handoff', p_conversation, '{"human_handoff": true}', '{"human_handoff": false}', p_by);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- ---------- 3.7 ----------
create or replace function set_offer(p_product uuid, p_price_usd numeric, p_available boolean, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare v_src uuid; o offers%rowtype; v_before jsonb;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_price_usd is not null and (p_price_usd <= 0 or p_price_usd > 10000) then raise exception 'PRICE_INVALID'; end if;
  select id into v_src from sources where kind = 'dark_store' order by id limit 1;
  if v_src is null then raise exception 'NO_HUB'; end if;
  if not exists (select 1 from products where id = p_product and owner_source_id is null) then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select * into o from offers where source_id = v_src and product_id = p_product for update;
  if not found then
    if p_price_usd is null then raise exception 'PRICE_INVALID'; end if;
    insert into offers(source_id, product_id, price_usd, is_available) values (v_src, p_product, p_price_usd, coalesce(p_available, true)) returning * into o;
    v_before := null;
  else
    v_before := jsonb_build_object('price_usd', o.price_usd, 'is_available', o.is_available);
    update offers set price_usd = coalesce(p_price_usd, price_usd), is_available = coalesce(p_available, is_available) where id = o.id returning * into o;
  end if;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('offer', p_product, v_before, jsonb_build_object('price_usd', o.price_usd, 'is_available', o.is_available), btrim(p_reason), p_by);
  return jsonb_build_object('ok', true, 'price_usd', o.price_usd, 'is_available', o.is_available, 'before', v_before);
end $$;

-- ---------- 3.8 ----------
insert into settings(key, value) values ('fx', '{"pause_move_pct": 3, "tz": "Asia/Beirut"}') on conflict (key) do nothing;

create table if not exists fx_pending (
  id           uuid primary key default gen_random_uuid(),
  lbp_per_usd  numeric(12,2) not null check (lbp_per_usd > 0),
  base_rate    numeric(12,2) not null,
  move_pct     numeric(8,2) not null,
  proposed_by  uuid not null references parties(id),
  proposed_at  timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'withdrawn')),
  confirmed_by uuid references parties(id),
  confirmed_at timestamptz
);
create unique index if not exists fx_pending_one on fx_pending((true)) where status = 'pending';

create or replace function fx_quoting_paused() returns boolean language sql stable as
$$ select exists (select 1 from fx_pending where status = 'pending') $$;

-- The first rate of the day (Beirut) is the morning rate and is set as typed. A later rate that moves more than
-- pause_move_pct from it is held, and quoting pauses, until a person confirms it.
create or replace function set_fx_rate(p_lbp_per_usd numeric, p_by uuid) returns jsonb language plpgsql as $$
declare v_tz text := coalesce(setting('fx')->>'tz', 'Asia/Beirut'); v_pct numeric := coalesce((setting('fx')->>'pause_move_pct')::numeric, 3);
        v_midnight timestamptz; v_first numeric; v_move numeric; v_id uuid;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_lbp_per_usd is null or p_lbp_per_usd <= 0 or p_lbp_per_usd > 10000000 then raise exception 'FX_RATE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fx_rates', 0));
  v_midnight := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  select lbp_per_usd into v_first from fx_rates where effective_from >= v_midnight and effective_from <= now() order by effective_from limit 1;
  update fx_pending set status = 'withdrawn' where status = 'pending';
  if v_first is not null then
    v_move := round(abs(p_lbp_per_usd / v_first - 1) * 100, 2);
    if v_move > v_pct then
      insert into fx_pending(lbp_per_usd, base_rate, move_pct, proposed_by) values (p_lbp_per_usd, v_first, v_move, p_by) returning id into v_id;
      insert into config_changes(kind, ref, before, after, reason, changed_by)
        values ('fx', v_id, jsonb_build_object('lbp_per_usd', v_first), jsonb_build_object('lbp_per_usd', p_lbp_per_usd, 'status', 'pending'), 'move ' || v_move || '%', p_by);
      return jsonb_build_object('ok', true, 'status', 'paused', 'pending_id', v_id, 'move_pct', v_move, 'base_rate', v_first);
    end if;
  end if;
  insert into fx_rates(lbp_per_usd, set_by) values (p_lbp_per_usd, p_by) returning id into v_id;
  insert into config_changes(kind, ref, before, after, changed_by)
    values ('fx', v_id, jsonb_build_object('lbp_per_usd', current_fx()), jsonb_build_object('lbp_per_usd', p_lbp_per_usd), p_by);
  return jsonb_build_object('ok', true, 'status', 'set', 'rate_id', v_id, 'move_pct', v_move);
end $$;

create or replace function confirm_fx_rate(p_pending uuid, p_by uuid) returns jsonb language plpgsql as $$
declare f fx_pending%rowtype; v_id uuid;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into f from fx_pending where id = p_pending for update;
  if not found then raise exception 'FX_PENDING_NOT_FOUND'; end if;
  if f.status <> 'pending' then return jsonb_build_object('ok', true, 'already', f.status); end if;
  insert into fx_rates(lbp_per_usd, set_by) values (f.lbp_per_usd, p_by) returning id into v_id;
  update fx_pending set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = p_pending;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('fx', v_id, jsonb_build_object('lbp_per_usd', f.base_rate), jsonb_build_object('lbp_per_usd', f.lbp_per_usd, 'status', 'confirmed'), 'confirmed move ' || f.move_pct || '%', p_by);
  return jsonb_build_object('ok', true, 'already', null, 'rate_id', v_id);
end $$;

-- ---------- 3.9 ----------
create or replace function set_zone(p_zone uuid, p_fee_usd numeric, p_eta_minutes int, p_active boolean, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare z zones%rowtype; v_before jsonb;
begin
  perform require_role(p_by, array['admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_fee_usd is null or p_fee_usd < 0 or p_fee_usd > 100 then raise exception 'FEE_INVALID'; end if;
  if p_eta_minutes is null or p_eta_minutes < 5 or p_eta_minutes > 480 then raise exception 'ETA_INVALID'; end if;
  select * into z from zones where id = p_zone for update;
  if not found then raise exception 'ZONE_NOT_FOUND'; end if;
  v_before := jsonb_build_object('delivery_fee_usd', z.delivery_fee_usd, 'base_eta_minutes', z.base_eta_minutes, 'is_active', z.is_active);
  update zones set delivery_fee_usd = p_fee_usd, base_eta_minutes = p_eta_minutes, is_active = coalesce(p_active, is_active) where id = p_zone returning * into z;
  insert into config_changes(kind, ref, before, after, reason, changed_by) values ('zone', p_zone, v_before,
    jsonb_build_object('delivery_fee_usd', z.delivery_fee_usd, 'base_eta_minutes', z.base_eta_minutes, 'is_active', z.is_active), btrim(p_reason), p_by);
  return jsonb_build_object('ok', true, 'before', v_before);
end $$;

create or replace function set_village(p_village uuid, p_zone uuid, p_served boolean, p_by uuid, p_reason text) returns jsonb language plpgsql as $$
declare v villages%rowtype; v_before jsonb;
begin
  perform require_role(p_by, array['admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if p_zone is not null and not exists (select 1 from zones where id = p_zone) then raise exception 'ZONE_NOT_FOUND'; end if;
  select * into v from villages where id = p_village for update;
  if not found then raise exception 'VILLAGE_NOT_FOUND'; end if;
  if coalesce(p_served, v.is_served) and coalesce(p_zone, v.zone_id) is null then raise exception 'ZONE_REQUIRED'; end if;
  v_before := jsonb_build_object('zone_id', v.zone_id, 'is_served', v.is_served);
  update villages set zone_id = coalesce(p_zone, zone_id), is_served = coalesce(p_served, is_served) where id = p_village returning * into v;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('village', p_village, v_before, jsonb_build_object('zone_id', v.zone_id, 'is_served', v.is_served), btrim(p_reason), p_by);
  return jsonb_build_object('ok', true, 'before', v_before);
end $$;

-- Locked like everything else: the worker's server role only.
do $$ declare r text;
begin
  revoke execute on all functions in schema public from public;
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table config_changes, fx_pending from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table config_changes, fx_pending to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
alter table config_changes enable row level security;
alter table fx_pending enable row level security;
