-- Alo King Chouf, session C3: B3's request (docs/HANDOFF.md, session B3): a rider's or staff member's voice note on the ops
-- line is answered and passed to ops (processOpsTurn calls voiceOnOpsLine, 1.17). The alert names the sender as registered,
-- not by their WhatsApp profile name. This is the one read the ops line needs for that.

create or replace function party_display_name(p_party uuid) returns text language sql stable as
$$ select display_name from parties where id = p_party $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
