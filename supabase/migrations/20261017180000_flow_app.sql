-- Session 5h part 2 (DECISIONS §39.15.13, amends §12's "static Flows only"): the Alo King app as a dynamic WhatsApp Flow.
-- Home, Shops, Shop page, Item page and Basket are native screens filled live from this database through the `flow-app`
-- edge function (eu-central-1). Kapso keeps the Flow encryption (§39.8) and forwards each decrypted request to flow-app,
-- signed with a key only Kapso's data-endpoint function and this database hold.
--
-- 1. Keys: app_private.flow_app_keys holds two random keys made here, never printed: `token` signs Flow tokens, `proxy`
--    signs the requests Kapso forwards. flow_app_proxy_key() gives the proxy key to the service role only (the edge
--    function, the whatsapp-flows workflow that stores it as the Kapso function's secret, the simulator).
-- 2. Flow tokens: flow_app_open(customer, lang) makes a web link of kind `flow` (a random 24-character token, only its
--    SHA-256 stored, bound to the customer's phone (the open basket is recorded with it; every read and write acts on that
--    customer's basket as it is now), valid flow_app_token_hours) and returns `<token>.<signature>`, the signature an
--    HMAC-SHA256 of the token with the `token` key. flow_app_session(flow_token) checks the signature, then the link
--    (unexpired, not reset by "delete my data", not blocked). The screens reuse the site's checked reads (web_explore for
--    home, shops and search; web_menu for the shop and item pages; filtered to the customer's point, a demo tester's demo
--    address, §39.15.3; zero routing calls) through service-role wrappers, flow_app_explore and flow_app_menu: a link of
--    kind `flow` never opens the public web reads (web_link leaves it out unless a wrapper asks for it), so its first part
--    alone is worth nothing.
-- 3. flow_app_add: one item into the basket, checked like web_basket_save (the shop's own item, orderable now, each choice
--    the item's own and available, every group within its rule), added through basket_add_item, which prices nothing:
--    basket_view prices from the menu. A Flow never carries a price the server did not compute.
-- 4. flow_app_basket / flow_app_remove: the basket screen (lines, notes, subtotal, the delivery fee to the customer's point,
--    totals in USD and LBP at today's rate; the order locks its own rate at checkout) and removing lines.
-- 5. flow_app_complete: Confirm. The link is marked completed (the §12 kill-gate counts opens and completions); the chat
--    sends the §3.6 summary when the Flow's reply reaches the bot.
-- 6. app_private.flow_thumbs: images for the Flow (base64 JPEG under 100 KB, Meta's limit for list images), made by the
--    flow-thumbs workflow from the item photos and shop covers already in Storage. Read by flow_app_thumbs.
-- 7. Config: flow_app_live (false until whatsapp-flows publishes both languages, then it inserts a newer row), the token
--    lifetime and the page size.

insert into public.app_config (key, value, effective_from, note) values
  ('flow_app_live', 'false', '2026-10-17 18:00+03',
   'DECISIONS §39.15.13: the bot opens the Alo King Flow app; set true by whatsapp-flows the day Meta publishes it'),
  ('flow_app_token_hours', '24', '2026-10-17 18:00+03',
   'DECISIONS §39.15.13: a Flow app token works this many hours'),
  ('flow_app_page_size', '19', '2026-10-17 18:00+03',
   'DECISIONS §39.15.13: rows per Flow list page (Meta allows 20 per list; the 20th is "More")')
on conflict do nothing;

-- 1. Keys ------------------------------------------------------------------------------------------------------------------
create table app_private.flow_app_keys (
  name text primary key check (name in ('token', 'proxy')),
  key bytea not null check (octet_length(key) = 32),
  created_at timestamptz not null default now()
);
alter table app_private.flow_app_keys enable row level security;
revoke all on app_private.flow_app_keys from public, anon, authenticated;
insert into app_private.flow_app_keys (name, key)
values ('token', extensions.gen_random_bytes(32)), ('proxy', extensions.gen_random_bytes(32))
on conflict do nothing;

-- The proxy key (hex), for the edge function and the workflows that store it in Kapso. Service role only.
create function public.flow_app_proxy_key() returns text
language sql stable security definer set search_path = ''
as $$ select encode(k.key, 'hex') from app_private.flow_app_keys k where k.name = 'proxy' $$;
revoke all on function public.flow_app_proxy_key() from public, anon, authenticated;
grant execute on function public.flow_app_proxy_key() to service_role;

-- 2. Flow tokens -------------------------------------------------------------------------------------------------------------
alter table app_private.web_links drop constraint web_links_kind_check;
alter table app_private.web_links add constraint web_links_kind_check check (kind in ('menu', 'explore', 'flow'));
-- When the Flow app ended with Confirm (the §12 kill-gate's completions).
alter table app_private.web_links add column completed_at timestamptz;
-- A Flow token the simulator or a test send made before the app is live (p_force): never counted by the kill-gate.
alter table app_private.web_links add column test boolean not null default false;

-- The valid link a token names. A link of kind `flow` only for the Flow app's own reads (p_flow), never for the public
-- web pages: the Flow token's first part alone opens nothing there. The one-argument form (web_menu, web_explore,
-- web_basket_save) reads p_flow from the transaction setting the Flow wrappers set (app.flow_link), which no web caller
-- can set (each PostgREST request is its own transaction, and set_config is not in an exposed schema).
create function app_private.web_link(p_token text, p_flow boolean) returns setof app_private.web_links
language sql stable security definer set search_path = ''
as $$
  select w.* from app_private.web_links w
  join public.customers c on c.id = w.customer_id
  where p_token ~ '^[A-Za-z0-9_-]{24}$'
    and w.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and w.expires_at > now()
    and (w.kind <> 'flow' or coalesce(p_flow, false))
    -- "Delete my data" (customer_forget sets profile_reset_at) and a block end every link made before.
    and w.created_at > coalesce(c.profile_reset_at, '-infinity'::timestamptz)
    and not (c.blocked_until is not null and c.blocked_until > now());
$$;
revoke all on function app_private.web_link(text, boolean) from public;

create or replace function app_private.web_link(p_token text) returns setof app_private.web_links
language sql stable security definer set search_path = ''
as $$ select * from app_private.web_link(p_token, current_setting('app.flow_link', true) = 'on') $$;
revoke all on function app_private.web_link(text) from public;
create index web_links_flow_idx on app_private.web_links (created_at) where kind = 'flow';

create function app_private.flow_app_sign(p_token text) returns text
language sql stable security definer set search_path = ''
as $$
  select rtrim(translate(encode(extensions.hmac(convert_to(p_token, 'UTF8'), k.key, 'sha256'), 'base64'), '+/', '-_'), '=')
  from app_private.flow_app_keys k where k.name = 'token';
$$;
revoke all on function app_private.flow_app_sign(text) from public;

-- A Flow app token for a customer who has a delivery point, or null: no point yet (the chat asks for the pin first), or
-- the app is not live or its kill-gate stopped it (flow_app_enabled), unless p_force (the simulator and the whatsapp-flows
-- test send, which drive the endpoint before Meta publishes the Flow).
create function public.flow_app_open(p_customer_id uuid, p_lang text default 'ar', p_force boolean default false) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_lang text := case when p_lang = 'en' then 'en' else 'ar' end;
  v_token text;
begin
  if p_customer_id is null or public.customer_search_point(p_customer_id) is null
     or not (coalesce(p_force, false) or public.flow_app_enabled()) then
    return null;
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  delete from app_private.web_links w where w.customer_id = p_customer_id and w.expires_at < now() - interval '7 days';
  insert into app_private.web_links (token_hash, customer_id, kind, basket_id, lang, expires_at, test)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_customer_id, 'flow',
    (select b.id from public.baskets b where b.customer_id = p_customer_id and b.status = 'open'),
    v_lang, now() + make_interval(hours => public.config_numeric('flow_app_token_hours')::int), coalesce(p_force, false));
  return v_token || '.' || app_private.flow_app_sign(v_token);
end;
$$;
revoke all on function public.flow_app_open(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.flow_app_open(uuid, text, boolean) to service_role;

-- The session a Flow token names: its web-link token, customer, language and phone; or a status (bad_signature,
-- expired). The signature is checked before any lookup.
create function public.flow_app_session(p_flow_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tok text := split_part(coalesce(p_flow_token, ''), '.', 1);
  v_sig text := split_part(coalesce(p_flow_token, ''), '.', 2);
  w app_private.web_links%rowtype;
begin
  if p_flow_token !~ '^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$' or v_sig is distinct from app_private.flow_app_sign(v_tok) then
    return jsonb_build_object('status', 'bad_signature');
  end if;
  select * into w from app_private.web_link(v_tok, true) x where x.kind = 'flow';
  if w.id is null then
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object('status', 'ok', 'token', v_tok, 'customer_id', w.customer_id, 'lang', w.lang,
    'phone', (select c.phone_e164 from public.customers c where c.id = w.customer_id),
    'completed', w.completed_at is not null);
end;
$$;
revoke all on function public.flow_app_session(text) from public, anon, authenticated;
grant execute on function public.flow_app_session(text) to service_role;

-- The customer a valid web-link token of kind flow names (null for anything else).
create function app_private.flow_app_customer(p_token text) returns uuid
language sql stable security definer set search_path = ''
as $$ select x.customer_id from app_private.web_link(p_token, true) x where x.kind = 'flow' $$;
revoke all on function app_private.flow_app_customer(text) from public;

-- The Flow app's screens: the site's reads (Explore, the shop menu) for a Flow token's link, service role only.
create function public.flow_app_explore(p_token text, p_q text default null, p_category text default null,
  p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if app_private.flow_app_customer(p_token) is null then
    return jsonb_build_object('status', 'expired');
  end if;
  perform set_config('app.flow_link', 'on', true);
  v := app_private.web_explore(p_token, p_q, p_category, p_offset);
  -- Off again at once: nothing else in this transaction reads a flow link as a web link.
  perform set_config('app.flow_link', '', true);
  return v;
end;
$$;
revoke all on function public.flow_app_explore(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.flow_app_explore(text, text, text, integer) to service_role;

create function public.flow_app_menu(p_token text, p_slug text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if app_private.flow_app_customer(p_token) is null then
    return jsonb_build_object('status', 'expired');
  end if;
  perform set_config('app.flow_link', 'on', true);
  v := app_private.web_menu(p_token, p_slug);
  -- Off again at once: nothing else in this transaction reads a flow link as a web link.
  perform set_config('app.flow_link', '', true);
  return v;
end;
$$;
revoke all on function public.flow_app_menu(text, text) from public, anon, authenticated;
grant execute on function public.flow_app_menu(text, text) to service_role;

-- 3. One item into the basket ------------------------------------------------------------------------------------------------
create function public.flow_app_add(p_token text, p_item_id uuid, p_quantity integer, p_option_ids uuid[] default '{}',
  p_note text default null, p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid := app_private.flow_app_customer(p_token);
  v_item public.menu_items%rowtype;
  v_qty integer := coalesce(p_quantity, 1);
  v_opts uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_option_ids, '{}')) x), '{}');
  v_r jsonb;
begin
  if v_customer is null then
    return jsonb_build_object('status', 'expired');
  end if;
  select * into v_item from public.menu_items i where i.id = p_item_id;
  if v_item.id is null or not app_private.web_menu_shop(v_item.vendor_id, v_customer) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_qty not between 1 and 50 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not app_private.web_item_shown(v_item.id) or not app_private.menu_item_orderable(v_item.id, v_qty) then
    return jsonb_build_object('status', 'unavailable', 'item_id', v_item.id);
  end if;
  -- Each choice is one of this item's own, available now; every group within its rule (as web_basket_save).
  if exists (select 1 from unnest(v_opts) o where not exists (
               select 1 from public.menu_options mo join public.menu_option_groups g on g.id = mo.group_id
               where mo.id = o and g.item_id = v_item.id and mo.available)) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.menu_option_groups g
             where g.item_id = v_item.id
               and exists (select 1 from public.menu_options o where o.group_id = g.id and o.available)
               and (select count(*) from public.menu_options mo where mo.group_id = g.id and mo.id = any (v_opts))
                   not between least(g.min_select, (select count(*) from public.menu_options o where o.group_id = g.id and o.available))
                           and g.max_select) then
    return jsonb_build_object('status', 'choices', 'item_id', v_item.id);
  end if;
  v_r := public.basket_add_item(v_customer, v_item.id, v_qty, v_opts, nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_replace, false), null);
  if v_r ->> 'status' = 'added' then
    return jsonb_build_object('status', 'added', 'line_id', v_r -> 'line_id');
  end if;
  return v_r - 'basket';
end;
$$;
revoke all on function public.flow_app_add(text, uuid, integer, uuid[], text, boolean) from public, anon, authenticated;
grant execute on function public.flow_app_add(text, uuid, integer, uuid[], text, boolean) to service_role;

-- 4. The basket screen --------------------------------------------------------------------------------------------------------
create function public.flow_app_basket(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_customer uuid := app_private.flow_app_customer(p_token);
  v_view jsonb;
  v_del jsonb;
  v_rate numeric := public.usd_lbp_rate();
  v_sub numeric;
  v_fee numeric;
begin
  if v_customer is null then
    return jsonb_build_object('status', 'expired');
  end if;
  v_view := public.basket_view(v_customer);
  if v_view is null or v_view ->> 'basket_id' is null or jsonb_array_length(coalesce(v_view -> 'lines', '[]')) = 0 then
    return jsonb_build_object('status', 'empty', 'rate', v_rate);
  end if;
  v_del := app_private.web_delivery(v_customer, (v_view ->> 'vendor_id')::uuid);
  v_sub := (v_view ->> 'subtotal_usd')::numeric;
  v_fee := (v_del ->> 'fee_usd')::numeric;
  return jsonb_build_object('status', 'ok',
    'basket_id', v_view -> 'basket_id', 'vendor_id', v_view -> 'vendor_id',
    'vendor_ar', v_view -> 'vendor', 'vendor_en', v_view -> 'vendor_en',
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('line_id', l -> 'line_id', 'item_id', l -> 'item_id',
        'name_ar', l -> 'name', 'name_en', l -> 'name_en', 'quantity', l -> 'quantity', 'line_total_usd', l -> 'line_total_usd',
        'estimated', l -> 'estimated', 'options', l -> 'options', 'note', l -> 'note')), '[]'::jsonb)
      from jsonb_array_elements(v_view -> 'lines') l),
    'unavailable', v_view -> 'unavailable',
    'subtotal_usd', v_sub,
    'fee_usd', v_fee,
    'delivery_status', v_del ->> 'status',
    'eta_min', v_del -> 'eta_min', 'eta_max', v_del -> 'eta_max',
    'total_usd', case when v_fee is not null then v_sub + v_fee end,
    'total_lbp', case when v_fee is not null then round((v_sub + v_fee) * v_rate, -3) end,
    'rate', v_rate);
end;
$$;
revoke all on function public.flow_app_basket(text) from public, anon, authenticated;
grant execute on function public.flow_app_basket(text) to service_role;

create function public.flow_app_remove(p_token text, p_line_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid := app_private.flow_app_customer(p_token);
  v_n integer;
begin
  if v_customer is null then
    return jsonb_build_object('status', 'expired');
  end if;
  delete from public.basket_items bi using public.baskets b
  where b.id = bi.basket_id and b.customer_id = v_customer and b.status = 'open' and bi.id = any (coalesce(p_line_ids, '{}'));
  get diagnostics v_n = row_count;
  update public.baskets b set last_activity_at = now() where b.customer_id = v_customer and b.status = 'open';
  return jsonb_build_object('status', 'removed', 'removed', v_n);
end;
$$;
revoke all on function public.flow_app_remove(text, uuid[]) from public, anon, authenticated;
grant execute on function public.flow_app_remove(text, uuid[]) to service_role;

-- 5. Confirm --------------------------------------------------------------------------------------------------------------------
create function public.flow_app_complete(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid := app_private.flow_app_customer(p_token);
  v_basket uuid;
begin
  if v_customer is null then
    return jsonb_build_object('status', 'expired');
  end if;
  select b.id into v_basket from public.baskets b
  where b.customer_id = v_customer and b.status = 'open' and exists (select 1 from public.basket_items bi where bi.basket_id = b.id);
  if v_basket is null then
    return jsonb_build_object('status', 'empty');
  end if;
  update app_private.web_links w set completed_at = coalesce(w.completed_at, now())
  where w.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and w.kind = 'flow';
  return jsonb_build_object('status', 'ok', 'basket_id', v_basket);
end;
$$;
revoke all on function public.flow_app_complete(text) from public, anon, authenticated;
grant execute on function public.flow_app_complete(text) to service_role;

-- The §12 kill-gate for the app: opens and completions since flow_app_live last changed.
create function public.flow_app_stats() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('opened', count(*), 'completed', count(w.completed_at))
  from app_private.web_links w
  where w.kind = 'flow' and not w.test
    and w.created_at >= (select max(c.effective_from) from public.app_config c where c.key = 'flow_app_live' and c.effective_from <= now());
$$;
revoke all on function public.flow_app_stats() from public, anon, authenticated;
grant execute on function public.flow_app_stats() to service_role;

-- Whether the bot opens the Flow app: live, and not stopped by the kill-gate (after min_sends opens, fewer than
-- min_completion of them completed).
create function public.flow_app_enabled() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_gate jsonb := public.config_value('flow_kill_gate');
  v_s jsonb;
begin
  if coalesce((public.config_value('flow_app_live') #>> '{}')::boolean, false) is not true then
    return false;
  end if;
  v_s := public.flow_app_stats();
  return not ((v_s ->> 'opened')::int >= coalesce((v_gate ->> 'min_sends')::int, 100)
    and (v_s ->> 'completed')::numeric / greatest((v_s ->> 'opened')::numeric, 1) < coalesce((v_gate ->> 'min_completion')::numeric, 0.6));
end;
$$;
revoke all on function public.flow_app_enabled() from public, anon, authenticated;
grant execute on function public.flow_app_enabled() to service_role;

-- 6. Images ------------------------------------------------------------------------------------------------------------------------
create table app_private.flow_thumbs (
  -- item: a list row's photo (small); item_large: the item page's photo; cover: a shop's cover (small); category: a
  -- craving category's picture (a dish of that category near the shops, small).
  kind text not null check (kind in ('item', 'item_large', 'cover', 'category')),
  ref text not null check (char_length(ref) between 1 and 60),
  -- Base64 JPEG; Meta takes list images up to 100 KB, so the job keeps every image well under it.
  b64 text not null check (char_length(b64) <= 136000),
  bytes integer not null check (bytes between 1 and 100000),
  -- The Storage path it was made from, so an unchanged photo is not made again.
  source_path text not null,
  made_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table app_private.flow_thumbs enable row level security;
revoke all on app_private.flow_thumbs from public, anon, authenticated;

create function public.flow_app_thumbs(p_kind text, p_refs text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.ref, t.b64), '{}'::jsonb)
  from app_private.flow_thumbs t where t.kind = p_kind and t.ref = any (coalesce(p_refs, '{}'));
$$;
revoke all on function public.flow_app_thumbs(text, text[]) from public, anon, authenticated;
grant execute on function public.flow_app_thumbs(text, text[]) to service_role;

-- What the flow-thumbs job makes: every photo of an item a customer can order (web_item_shown) and every shop cover, with
-- its Storage path; one picture per craving category (the most common photo dish among its shops' first sections).
create function public.flow_thumb_sources() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('ref', p.item_id, 'path', p.storage_path)), '[]'::jsonb)
              from public.menu_item_photos p join public.vendors v on v.id = p.vendor_id
              where v.orderable and v.claim_status = 'claimed' and app_private.web_item_shown(p.item_id)),
    'covers', (select coalesce(jsonb_agg(jsonb_build_object('ref', c.vendor_id, 'path', c.storage_path)), '[]'::jsonb)
               from public.vendor_covers c join public.vendors v on v.id = c.vendor_id
               where v.orderable and v.claim_status = 'claimed'),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('ref', x.category, 'path', x.storage_path)), '[]'::jsonb)
                   from (select distinct on (vc.category) vc.category, c.storage_path
                         from app_private.vendor_browse_categories vc
                         join public.vendors v on v.id = vc.vendor_id and v.orderable and v.claim_status = 'claimed'
                         join public.vendor_covers c on c.vendor_id = v.id
                         order by vc.category, (c.source = 'illustrative'), v.id) x),
    'made', (select coalesce(jsonb_object_agg(t.kind || ':' || t.ref, t.source_path), '{}'::jsonb) from app_private.flow_thumbs t));
$$;
revoke all on function public.flow_thumb_sources() from public, anon, authenticated;
grant execute on function public.flow_thumb_sources() to service_role;

create function public.flow_thumb_put(p_kind text, p_ref text, p_b64 text, p_source_path text) returns void
language sql security definer set search_path = ''
as $$
  insert into app_private.flow_thumbs (kind, ref, b64, bytes, source_path)
  values (p_kind, p_ref, p_b64, octet_length(decode(p_b64, 'base64')), p_source_path)
  on conflict (kind, ref) do update set b64 = excluded.b64, bytes = excluded.bytes, source_path = excluded.source_path,
    made_at = now();
$$;
revoke all on function public.flow_thumb_put(text, text, text, text) from public, anon, authenticated;
grant execute on function public.flow_thumb_put(text, text, text, text) to service_role;

-- Images whose photo or cover is gone (deleted on request, §38.1; replaced; or the shop no longer claimed and orderable) go
-- too: the job calls this first, so the endpoint never serves an image of something it can no longer show.
create function public.flow_thumb_prune() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_s jsonb := public.flow_thumb_sources();
  v_n integer;
begin
  delete from app_private.flow_thumbs t
  where not exists (
    select 1 from jsonb_array_elements(case when t.kind in ('item', 'item_large') then v_s -> 'items'
                                            when t.kind = 'cover' then v_s -> 'covers' else v_s -> 'categories' end) x
    where x ->> 'ref' = t.ref and x ->> 'path' = t.source_path);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.flow_thumb_prune() from public, anon, authenticated;
grant execute on function public.flow_thumb_prune() to service_role;
