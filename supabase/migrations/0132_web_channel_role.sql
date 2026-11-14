-- Alo King Chouf, session C4 (commerce core): the website's database role (docs/SYSTEM_PLAN.md section 1; audit G1-12).
--
-- The website Worker must not be a fourth holder of the service key. It reaches the database as web_channel, which may execute
-- the website's functions below and nothing else: no table, no view, no sequence, no staff function, no money function, not
-- confirm_order_checked or claim_link_code directly (each of those takes a party id; the website's functions take the session
-- token and find the party themselves). The functions run as their owner (security definer, fixed search_path), which is how
-- they read the catalog and write the cart without the role holding a single table grant.
--
-- How the Worker becomes web_channel is the website session's to set up (WEB1): through PostgREST, a JWT whose role claim is
-- web_channel (the grant to authenticator below lets PostgREST switch to it), signed with the project's JWT secret held as a
-- Worker secret. The role has no password and no login here; nothing in this repository can sign in as it.
--
-- scripts/check_permissions.sh (section "web_channel") fails if the role can execute anything outside this list, holds any table
-- or sequence privilege, is a member of another role, or if one of these functions is not security definer with a fixed path.
-- A later migration that adds a website function must grant it here by name and add it to that list.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'web_channel') then
    create role web_channel nologin noinherit;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    begin
      grant web_channel to authenticator;
    exception when insufficient_privilege then
      -- Never block a deploy on this: the role and its grants stand; WEB1 adds the membership with the dashboard's admin.
      raise warning 'web_channel: could not grant it to authenticator (%); PostgREST cannot switch to it yet', sqlerrm;
    end;
  end if;
  -- The role that applies migrations (postgres on Supabase, not a superuser) may SET ROLE web_channel, so the permission check
  -- can probe as it (since Postgres 16 creating a role does not give that by itself). This gives web_channel nothing.
  if not exists (select 1 from pg_roles where rolname = current_user and rolsuper) then
    begin
      execute format('grant web_channel to %I', current_user);
    exception when others then
      raise warning 'web_channel: could not grant it to % (%); the permission check skips its probes as the role', current_user, sqlerrm;
    end;
  end if;
end $$;

grant usage on schema public to web_channel;
revoke all on all tables in schema public from web_channel;
revoke all on all sequences in schema public from web_channel;
revoke all on all functions in schema public from web_channel;

grant execute on function web_session_start(text)                 to web_channel;
grant execute on function web_session_state(text)                 to web_channel;
grant execute on function web_session_end(text)                   to web_channel;
grant execute on function web_link_code(text)                     to web_channel;
grant execute on function cart_set_line(text, text, int, numeric) to web_channel;
grant execute on function cart_view(text)                         to web_channel;
grant execute on function checkout_quote(text, uuid, uuid, uuid)  to web_channel;
grant execute on function checkout_order(text, text, uuid, uuid, payment_method, numeric, text) to web_channel;
grant execute on function web_confirm_order(text, uuid, text)     to web_channel;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
