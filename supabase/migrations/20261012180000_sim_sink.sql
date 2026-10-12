-- Session 11-lite (DECISIONS §36): the staging conversation simulator.
--   1. Config `sim_sink_enabled` (false). Only the staging fixture turns it on; the cut-over checklist asserts it
--      is false on production. While it is false a +999 number is refused, never sent anywhere.
--   2. `sim_outbox`: what the bot would have sent to a +999 test number (dispatch records it instead of calling Kapso).
--   3. `sim_prepare` / `sim_restore`: the simulated merchant becomes the test merchant's order channel for the length
--      of an e2e run, and the owner's own setting is put back afterwards.
--   4. `customer_handoff` does not WhatsApp the owner's phones about a simulated customer (a real number must
--      never be touched by a simulation).
-- Real numbers are never affected: every function here looks at the +999 prefix.

-- 1. Config ---------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §36, 12 October 2026 (session 11-lite)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('sim_sink_enabled', 'false', '2026-10-12 00:00+03', 'Simulator sink for +999 test numbers; on in staging only (DECISIONS §36), must be false in production', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

create function app_private.is_sim_phone(p_phone text) returns boolean
language sql
immutable
set search_path = ''
as $$ select coalesce(p_phone ~ '^\+?999[0-9]{6,12}$', false) $$;
revoke all on function app_private.is_sim_phone(text) from public, anon, authenticated;

create function app_private.sim_sink_on() returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((public.config_value('sim_sink_enabled') #>> '{}')::boolean, false) $$;
revoke all on function app_private.sim_sink_on() from public, anon, authenticated;

-- 2. The sink -------------------------------------------------------------------------------------------
create table public.sim_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  phone_number_id text,
  to_phone text not null check (to_phone ~ '^\+999[0-9]{6,12}$'),
  kind text not null,
  body text,
  payload jsonb not null
);
create index sim_outbox_to_idx on public.sim_outbox (to_phone, id);
alter table public.sim_outbox enable row level security;
revoke all on table public.sim_outbox from public, anon, authenticated;
grant all on table public.sim_outbox to service_role;

-- Records one outbound payload for a +999 number. False (nothing recorded) when the sink is off.
create function public.sim_sink_record(p_phone_number_id text, p_payload jsonb) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text := '+' || ltrim(coalesce(p_payload ->> 'to', ''), '+');
  v_kind text := coalesce(p_payload ->> 'type', 'text');
  v_body text;
begin
  if not app_private.sim_sink_on() or not app_private.is_sim_phone(v_to) then
    return false;
  end if;
  v_body := coalesce(
    p_payload #>> '{text,body}',
    p_payload #>> '{interactive,body,text}',
    p_payload #>> '{image,caption}',
    ''
  );
  insert into public.sim_outbox (phone_number_id, to_phone, kind, body, payload)
  values (p_phone_number_id, v_to, case when v_kind = 'interactive' then 'interactive:' || coalesce(p_payload #>> '{interactive,type}', '?') else v_kind end, v_body, p_payload);
  return true;
end;
$$;
revoke all on function public.sim_sink_record(text, jsonb) from public, anon, authenticated;
grant execute on function public.sim_sink_record(text, jsonb) to service_role;

-- 3. Persona setup --------------------------------------------------------------------------------------
create table app_private.sim_state (
  id boolean primary key default true check (id),
  vendor_id uuid not null,
  channel_target text,
  channel_kind public.order_channel_kind,
  owner_mobile text,
  kitchen_whatsapp text,
  saved_at timestamptz not null default now()
);
revoke all on table app_private.sim_state from public, anon, authenticated;

-- Makes the simulated merchant (+999...) the owner and the WhatsApp order channel of the test merchant, saving the
-- owner's setting once. Refuses unless the sink is on and the vendor is the staging test merchant.
create function public.sim_prepare(p_merchant_phone text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor public.vendors%rowtype;
  v_user uuid;
  v_ch public.vendor_order_channels%rowtype;
  v_priv public.vendor_private%rowtype;
begin
  if not app_private.sim_sink_on() then
    return jsonb_build_object('status', 'sink_off');
  end if;
  if not app_private.is_sim_phone(p_merchant_phone) then
    return jsonb_build_object('status', 'not_a_sim_phone');
  end if;
  select * into v_vendor from public.vendors v where v.is_test order by v.created_at limit 1;
  if v_vendor.id is null then
    return jsonb_build_object('status', 'no_test_vendor');
  end if;
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'simulator persona setup (DECISIONS §36)', true);
  if not exists (select 1 from app_private.sim_state) then
    select * into v_ch from public.vendor_order_channels c where c.vendor_id = v_vendor.id and c.role = 'primary' and c.enabled limit 1;
    select * into v_priv from public.vendor_private p where p.vendor_id = v_vendor.id;
    insert into app_private.sim_state (vendor_id, channel_target, channel_kind, owner_mobile, kitchen_whatsapp)
    values (v_vendor.id, v_ch.target, v_ch.channel, v_priv.owner_mobile, v_priv.kitchen_whatsapp);
  end if;
  v_user := app_private.auth_user_for_phone(p_merchant_phone);
  insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status, display_name)
  values (v_vendor.id, v_user, p_merchant_phone, 'owner', 'active', 'Simulated merchant')
  on conflict (vendor_id, phone_e164) do update set status = 'active', role = 'owner', user_id = excluded.user_id;
  insert into public.vendor_private (vendor_id, owner_mobile, kitchen_whatsapp)
  values (v_vendor.id, p_merchant_phone, p_merchant_phone)
  on conflict (vendor_id) do update set owner_mobile = excluded.owner_mobile, kitchen_whatsapp = excluded.kitchen_whatsapp;
  update public.vendor_order_channels set target = p_merchant_phone, channel = 'whatsapp'
  where vendor_id = v_vendor.id and role = 'primary' and enabled;
  if not found then
    insert into public.vendor_order_channels (vendor_id, channel, role, target)
    values (v_vendor.id, 'whatsapp', 'primary', p_merchant_phone);
  end if;
  return jsonb_build_object('status', 'ok', 'vendor_id', v_vendor.id);
end;
$$;
revoke all on function public.sim_prepare(text) from public, anon, authenticated;
grant execute on function public.sim_prepare(text) to service_role;

-- Puts the owner's setting back and revokes the simulated merchant.
create function public.sim_restore() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s app_private.sim_state%rowtype;
begin
  select * into s from app_private.sim_state;
  if s.id is null then
    return jsonb_build_object('status', 'nothing_saved');
  end if;
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'simulator persona teardown (DECISIONS §36)', true);
  update public.vendor_members set status = 'revoked'
  where vendor_id = s.vendor_id and app_private.is_sim_phone(phone_e164);
  if s.channel_kind is not null then
    update public.vendor_order_channels set target = s.channel_target, channel = s.channel_kind
    where vendor_id = s.vendor_id and role = 'primary' and enabled;
  else
    -- There was no primary channel before the run: switch off the one the run made.
    update public.vendor_order_channels set enabled = false
    where vendor_id = s.vendor_id and role = 'primary' and enabled and app_private.is_sim_phone(target);
  end if;
  if s.owner_mobile is not null or s.kitchen_whatsapp is not null then
    update public.vendor_private set owner_mobile = s.owner_mobile, kitchen_whatsapp = s.kitchen_whatsapp where vendor_id = s.vendor_id;
  else
    update public.vendor_private set owner_mobile = null, kitchen_whatsapp = null where vendor_id = s.vendor_id;
  end if;
  delete from app_private.sim_state;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.sim_restore() from public, anon, authenticated;
grant execute on function public.sim_restore() to service_role;

-- 4. Handoff: no WhatsApp note to the owner's phones about a simulated customer ----------------------------
create or replace function public.customer_handoff(p_customer_id uuid, p_reason text, p_summary text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minutes numeric := public.config_numeric('handoff_minutes');
  v_phone text;
  v_owner record;
  v_open boolean := app_private.beirut_hour() >= (public.config_value('support_hours') ->> 'from')::int
                    and app_private.beirut_hour() < (public.config_value('support_hours') ->> 'to')::int;
begin
  insert into public.bot_sessions (customer_id) values (p_customer_id) on conflict (customer_id) do nothing;
  update public.bot_sessions set handoff_until = now() + make_interval(mins => v_minutes::int), handoff_reason = left(p_reason, 300),
    low_confidence = 0
  where customer_id = p_customer_id;
  perform app_private.ops_alert('handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24'), 'customer_handoff', 'warning',
    left('Customer needs a person: ' || coalesce(p_summary, p_reason), 300), null, null,
    jsonb_build_object('customer_id', p_customer_id, 'reason', left(p_reason, 300)));
  select c.phone_e164 into v_phone from public.customers c where c.id = p_customer_id;
  if app_private.is_sim_phone(v_phone) then
    -- A simulated customer (DECISIONS §36): the alert row above is the record; no real phone is messaged.
    return jsonb_build_object('status', 'handed_off', 'support_open', v_open);
  end if;
  for v_owner in select o.phone_e164 from app_private.owner_phones o loop
    begin
      perform public.app_reply(v_owner.phone_e164,
        jsonb_build_object('text', '🙋 Alo King: ' || coalesce(v_phone, 'a customer') || ' needs a person: ' || left(coalesce(p_summary, p_reason), 200)
          || E'\nThe bot stays quiet for ' || v_minutes::int || ' minutes, or until they send "menu".'),
        'handoff:' || p_customer_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    exception when others then
      null; -- the handoff itself is stored whatever happens to the note
    end;
  end loop;
  return jsonb_build_object('status', 'handed_off', 'support_open', v_open);
end;
$$;
