-- Rollback of 20261017180000_flow_app.sql (session 5h part 2, DECISIONS §39.15.13). The migration deletes nothing at load:
-- its `delete` statements run inside functions (a customer's links that ended a week ago; a basket line the customer
-- removes in the app; images whose photo is gone), and it replaces web_links' kind check to add `flow`. Rolling back
-- removes what it added: the Flow app's functions, keys and images, its links, the two new columns, and the web_link
-- form that reads a flow link; web_link(text) goes back to the 20261017110000 version.
drop function if exists public.flow_thumb_prune();
drop function if exists public.flow_thumb_put(text, text, text, text);
drop function if exists public.flow_thumb_sources();
drop function if exists public.flow_app_thumbs(text, text[]);
drop function if exists public.flow_app_enabled();
drop function if exists public.flow_app_stats();
drop function if exists public.flow_app_complete(text);
drop function if exists public.flow_app_remove(text, uuid[]);
drop function if exists public.flow_app_basket(text);
drop function if exists public.flow_app_add(text, uuid, integer, uuid[], text, boolean);
drop function if exists public.flow_app_menu(text, text);
drop function if exists public.flow_app_explore(text, text, text, integer);
drop function if exists app_private.flow_app_customer(text);
drop function if exists public.flow_app_session(text);
drop function if exists public.flow_app_open(uuid, text, boolean);
drop function if exists app_private.flow_app_sign(text);
drop function if exists public.flow_app_proxy_key();
drop table if exists app_private.flow_thumbs;
drop table if exists app_private.flow_app_keys;

create or replace function app_private.web_link(p_token text) returns setof app_private.web_links
language sql stable security definer set search_path = ''
as $$
  select w.* from app_private.web_links w
  join public.customers c on c.id = w.customer_id
  where p_token ~ '^[A-Za-z0-9_-]{24}$'
    and w.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and w.expires_at > now()
    and w.created_at > coalesce(c.profile_reset_at, '-infinity'::timestamptz)
    and not (c.blocked_until is not null and c.blocked_until > now());
$$;
revoke all on function app_private.web_link(text) from public;
drop function if exists app_private.web_link(text, boolean);

delete from app_private.web_links where kind = 'flow';
drop index if exists app_private.web_links_flow_idx;
alter table app_private.web_links drop column if exists test;
alter table app_private.web_links drop column if exists completed_at;
alter table app_private.web_links drop constraint web_links_kind_check;
alter table app_private.web_links add constraint web_links_kind_check check (kind in ('menu', 'explore'));
-- The dated config rows flow_app_live, flow_app_token_hours and flow_app_page_size stay (config rows are never edited or
-- deleted).
