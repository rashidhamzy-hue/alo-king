-- Rollback of 20261017110000_web_menu.sql (session 5g part A). The migration deletes nothing at load: its `delete`
-- statements run inside functions (a customer's links that ended a week ago; a shop's basket lines when the web menu
-- saves the whole basket again). Rolling back removes what it added; the links table holds only short-lived tokens.
drop function if exists public.web_menu(text, text);
drop function if exists public.web_basket_save(text, text, jsonb, boolean);
drop function if exists public.site_photo(uuid, uuid);
drop function if exists app_private.web_basket_save(text, text, jsonb, boolean);
drop function if exists app_private.web_basket_notify(uuid, uuid);
drop function if exists app_private.web_menu(text, text);
drop function if exists app_private.web_item_shown(uuid);
drop function if exists app_private.web_delivery(uuid, uuid);
drop function if exists public.web_link_create(uuid, text, uuid, text);
drop function if exists app_private.web_link(text);
drop function if exists app_private.web_menu_shop(uuid, uuid);
drop table if exists app_private.web_links;
-- The dated config rows web_link_hours and web_link_max_saves stay (config rows are never edited or deleted).
