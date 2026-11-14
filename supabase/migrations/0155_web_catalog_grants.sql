-- Alo King Chouf, session WEB1: grant the four catalog read functions of 0154 to web_channel, by name (the rule of 0132).
-- scripts/check_permissions.sh (web_allowed) and WEB_CHANNEL_FUNCTIONS in packages/commerce carry the same four names, and a test
-- keeps the three lists equal. The helpers (catalog_web_items, catalog_web_picture, catalog_web_card) are NOT granted: web_channel
-- reaches them only through these functions, which run as their owner.

grant execute on function web_catalog_home()                 to web_channel;
grant execute on function web_catalog_category(text)         to web_channel;
grant execute on function web_catalog_product(text)          to web_channel;
grant execute on function web_catalog_search(text, int)      to web_channel;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
