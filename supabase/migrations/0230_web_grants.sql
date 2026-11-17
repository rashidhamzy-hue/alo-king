-- Alo King Chouf, session WEB2 (the website's day-one ordering), migration 3 of 3: the search paths, and the website's role may call the
-- new website functions by name and nothing else (0132's rule; scripts/check_permissions.sh's web_allowed and WEB_CHANNEL_FUNCTIONS in
-- packages/commerce list the same names). The gateway's functions (web_cards_due, web_card_done, web_card_again) and the link helpers
-- (web_sign, order_link, order_link_ok, order_ended_at) are not granted: the website cannot sign a link, list cards or send anything.

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

do $$ declare t text; r text;
begin
  foreach t in array array['web_link_key', 'web_card_requests'] loop
    foreach r in array array['web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

grant execute on function web_place_order(text, text, uuid, uuid, payment_method, text, numeric, text, jsonb, text, text) to web_channel;
grant execute on function web_order_page(text, text)                                to web_channel;
grant execute on function web_orders(text)                                          to web_channel;
grant execute on function web_order_again(text, uuid)                               to web_channel;
grant execute on function web_account(text)                                         to web_channel;
grant execute on function web_memory_forget(text)                                   to web_channel;
grant execute on function web_memory_pref(text, boolean)                            to web_channel;
grant execute on function web_sign_out_everywhere(text)                             to web_channel;
grant execute on function web_save_pin(text, double precision, double precision)    to web_channel;
grant execute on function web_pin_village(text, uuid, uuid)                         to web_channel;
grant execute on function web_place_details(text, uuid, text, text, text)           to web_channel;
grant execute on function web_windows(text, uuid, boolean)                          to web_channel;
grant execute on function web_service_facts()                                       to web_channel;
grant execute on function web_cart_count(text)                                      to web_channel;
