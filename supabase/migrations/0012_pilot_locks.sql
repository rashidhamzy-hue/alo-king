-- 0012: pilot locks. Two reliability findings from the final review, both confirmed in the code.
--
--   1. Marketing. 0011 seeded the switch with "on conflict do nothing", so a database that already held
--      {"enabled": true} would have kept it. This migration forces it off and then makes "on" impossible to write:
--      a trigger rejects any settings row that enables marketing. Lifting the lock takes a new, reviewed migration
--      that drops the trigger. That is deliberate: it is a founder decision, not a settings edit.
--   2. Outbox lease. outbox_claim compared against settings.outbox.lease_seconds with no fallback. With the setting
--      missing the comparison is NULL and the function re-claimed a message that another worker was still sending.

-- ---------- 1. marketing stays off ----------
insert into settings(key, value) values ('marketing', '{"enabled": false}')
on conflict (key) do update set value = '{"enabled": false}';

create or replace function marketing_locked_during_pilot() returns trigger language plpgsql as $$
begin
  if new.key = 'marketing' and lower(coalesce(new.value->>'enabled', 'false')) not in ('false', '0', 'no', 'off', '') then
    raise exception 'MARKETING_LOCKED: promotional sending is disabled for the pilot. Lifting it needs a reviewed migration.';
  end if;
  return new;
end $$;
drop trigger if exists settings_marketing_lock on settings;
create trigger settings_marketing_lock before insert or update on settings for each row execute function marketing_locked_during_pilot();

-- can_send no longer trusts a cast that could throw on a malformed value; anything but a literal true is "off".
create or replace function can_send(p_party uuid, p_line wa_line, p_category msg_category, p_is_template boolean)
returns text language plpgsql stable as $$
begin
  if p_category = 'marketing' and coalesce(setting('marketing')->>'enabled', 'false') <> 'true' then
    return 'marketing_disabled';
  end if;
  return can_send_checked(p_party, p_line, p_category, p_is_template);
end $$;

-- ---------- 2. outbox lease always has a value ----------
create or replace function outbox_claim(p_key text, p_line wa_line, p_party uuid, p_payload jsonb) returns boolean language plpgsql as $$
declare o wa_outbox%rowtype; v_lease int := coalesce((setting('outbox')->>'lease_seconds')::int, 60);
begin
  insert into wa_outbox(dedupe_key, line, party_id, payload) values (p_key, p_line, p_party, p_payload) on conflict do nothing;
  if found then return true; end if;
  select * into o from wa_outbox where dedupe_key = p_key for update;
  if o.status = 'sent' then return false; end if;
  if o.status = 'pending' and coalesce(o.claimed_at, now()) > now() - make_interval(secs => v_lease) then return false; end if;
  update wa_outbox set status = 'pending', claimed_at = now() where dedupe_key = p_key;
  return true;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
