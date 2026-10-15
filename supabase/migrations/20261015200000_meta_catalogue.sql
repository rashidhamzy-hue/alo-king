-- Session 5d (DECISIONS §39.12, §30.1.2 as amended): the Meta catalogue and the native WhatsApp cart on the US test number.
-- The server stays the source of truth: the catalogue is a synced mirror of the database, and every cart is re-priced here
-- before the normal checkout. Contents:
--   1. config: the catalogue on (it still needs a connected catalogue per business account), the reconcile cadence
--   2. public.whatsapp_catalogs: the catalogue connected to each WhatsApp business account, and the route that writes items
--   3. sync state: catalog_sync_items keeps hidden items (an item that leaves the menu is hidden, never deleted on Meta)
--   4. the desired catalogue per shop (claimed, orderable, active; drafts never reach menu_items, so they never sync)
--   5. the sync queue: every menu, price, availability or stock change (vendors.menu_version), a claim, pause or listing
--      change and a photo decision queues the shop; a reconcile every 10 minutes and a nightly full sync
--   6. what a customer is shown: the catalogue for the sending number, catalogue products of a shop or section, best sellers
--   7. cart_merge: an inbound cart added to the one basket (with button taps), re-priced, differences reported, idempotent
--   8. staging simulator: a simulated customer can be given the simulated catalogue for one scenario (+999 numbers only)
--   9. the dispatch kick also wakes for queued catalogue syncs

-- 1. Config ---------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('catalog_enabled', 'true', '2026-10-15 19:00+03',
   'Native WhatsApp cart from the Meta catalogue, built now on the US test number (DECISIONS §39.12); a number shows it only once its business account has a connected catalogue (public.whatsapp_catalogs)'),
  ('catalog_reconcile_min', '10', '2026-10-15 19:00+03',
   'Minutes between catalogue reconciles of every synced shop (time-based availability: station restores, daily stock, hours); the nightly full sync re-sends everything (§39.12)'),
  ('catalog_best_sellers_days', '60', '2026-10-15 19:00+03',
   'Days of orders that rank a shop''s best sellers for the catalogue message (§39.12)');

-- 2. The catalogue per WhatsApp business account --------------------------------------------------------------------
create table public.whatsapp_catalogs (
  waba_id text primary key check (waba_id ~ '^[0-9]{3,30}$'),
  catalog_id text not null check (catalog_id ~ '^[0-9]{5,30}$'),
  -- Which route writes catalogue items (kapso-catalog probes it): Kapso's Meta proxy or the Graph API with a token.
  transport text check (transport in ('kapso', 'graph')),
  commerce_on boolean not null default false,
  -- The step left for the owner (an `owner` issue carries it), or null.
  blocked text check (char_length(blocked) <= 300),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create trigger whatsapp_catalogs_audit after insert or update or delete on public.whatsapp_catalogs
  for each row execute function app_private.audit_row();
alter table public.whatsapp_catalogs enable row level security;
revoke all on table public.whatsapp_catalogs from public, anon, authenticated;
grant all on table public.whatsapp_catalogs to service_role;

create function public.whatsapp_catalog_record(p_waba_id text, p_catalog_id text, p_transport text, p_commerce_on boolean,
  p_blocked text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before public.whatsapp_catalogs%rowtype;
begin
  select * into v_before from public.whatsapp_catalogs where waba_id = p_waba_id;
  insert into public.whatsapp_catalogs (waba_id, catalog_id, transport, commerce_on, blocked, checked_at)
  values (p_waba_id, p_catalog_id, nullif(p_transport, ''), coalesce(p_commerce_on, false), nullif(left(p_blocked, 300), ''), now())
  on conflict (waba_id) do update set catalog_id = excluded.catalog_id, transport = excluded.transport,
    commerce_on = excluded.commerce_on, blocked = excluded.blocked, checked_at = now();
  -- A catalogue that became writable (new, another catalogue, another route) gets every shop queued for a full sync; the
  -- daily re-check of an unchanged catalogue queues nothing.
  if nullif(p_transport, '') is not null and (v_before.waba_id is null or v_before.catalog_id is distinct from p_catalog_id
     or v_before.transport is distinct from nullif(p_transport, '')) then
    perform app_private.catalog_enqueue_all(true, 'catalogue connected');
  end if;
end;
$$;

-- 3. Sync state ------------------------------------------------------------------------------------------------------
-- An item that leaves the menu (or is deleted) stays here as hidden, so the sync hides it on Meta once and never again: no
-- foreign key to menu_items any more.
alter table public.catalog_sync_items drop constraint catalog_sync_items_item_id_fkey;
alter table public.catalog_sync_items
  add column visible boolean not null default true,
  add column catalog_id text check (catalog_id ~ '^[0-9]{5,30}$');

-- Records what was pushed: [{retailer_id, hash, visible?}], the whole state of the shop (rows not listed are dropped).
-- An id is accepted when it is this shop's item, or already in this shop's sync state (a removed item being hidden).
create or replace function public.catalog_sync_record(p_vendor_id uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  v_catalog text := (select c.catalog_id from public.whatsapp_catalogs c where c.transport is not null order by c.checked_at desc limit 1);
begin
  insert into public.catalog_sync_items (item_id, vendor_id, content_hash, synced_at, visible, catalog_id)
  select (x ->> 'retailer_id')::uuid, p_vendor_id, x ->> 'hash', now(), coalesce((x ->> 'visible')::boolean, true), v_catalog
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  where exists (select 1 from public.menu_items i where i.id = (x ->> 'retailer_id')::uuid and i.vendor_id = p_vendor_id)
     or exists (select 1 from public.catalog_sync_items c where c.item_id = (x ->> 'retailer_id')::uuid and c.vendor_id = p_vendor_id)
  on conflict (item_id) do update set content_hash = excluded.content_hash, synced_at = now(), visible = excluded.visible,
    catalog_id = coalesce(excluded.catalog_id, public.catalog_sync_items.catalog_id)
  where public.catalog_sync_items.vendor_id = p_vendor_id;
  get diagnostics n = row_count;
  delete from public.catalog_sync_items c where c.vendor_id = p_vendor_id
    and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]')) x where (x ->> 'retailer_id')::uuid = c.item_id);
  return n;
end;
$$;

-- Visible items and their hashes (what the customer can get in a product message).
create or replace function public.catalog_synced(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.item_id, c.content_hash), '{}') from public.catalog_sync_items c
  where c.vendor_id = p_vendor_id and c.visible;
$$;

-- The whole sync state, hidden items included: {item_id: {"hash", "visible"}}.
create function public.catalog_sync_state(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.item_id, jsonb_build_object('hash', c.content_hash, 'visible', c.visible)), '{}')
  from public.catalog_sync_items c where c.vendor_id = p_vendor_id;
$$;

-- 4. The desired catalogue -------------------------------------------------------------------------------------------
-- A shop is in the catalogue when it is claimed, orderable and listed (the staging test shops included); its items are
-- the published menu (menu_items: drafts and unconfirmed sections live in menu_drafts and never sync). Price in USD from
-- the menu, display only (every cart is re-priced here); a weighed item shows its estimated price per piece. One product
-- set per shop (custom_label_0 = the shop's id). The image is the shop's confirmed photo, else a generated tile.
create or replace function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(case when i.name_ar is not null and i.name_en is not null and i.name_ar <> i.name_en
                        then i.name_ar || ' · ' || i.name_en else coalesce(i.name_ar, i.name_en, i.name_fr) end, 150),
      'name_en', i.name_en,
      'description', left(coalesce(nullif(i.description, ''), s.name_en, s.name_ar, coalesce(v.name_en, v.name_ar)),
                          case when i.pricing_unit = 'kg' then 450 else 500 end)
                     || case when i.pricing_unit = 'kg' then ' (≈ ' || i.est_weight_kg || ' kg, final by weight)' else '' end,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', (select p.storage_path from public.vendor_photos p where p.vendor_id = v.id and p.status = 'confirmed'
                order by p.sort_order, p.created_at limit 1))
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active';
$$;

-- What the product image shows (dispatch renders it; the URL carries the content hash so Meta fetches it again on change).
create function public.catalog_image(p_item_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name_ar', i.name_ar, 'name_en', coalesce(i.name_en, i.name_fr),
    'vendor', coalesce(v.name_en, v.name_ar), 'vendor_ar', v.name_ar,
    'hash', (select c.content_hash from public.catalog_sync_items c where c.item_id = i.id),
    'vendor_id', v.id,
    'photo', (select p.storage_path from public.vendor_photos p where p.vendor_id = v.id and p.status = 'confirmed'
              order by p.sort_order, p.created_at limit 1))
  from public.menu_items i join public.vendors v on v.id = i.vendor_id
  -- Only an item of the catalogue (synced, or of a shop that syncs) is ever drawn: nothing else is reachable here.
  where i.id = p_item_id and v.claim_status = 'claimed' and v.listing_status = 'active'
    and (v.orderable or exists (select 1 from public.catalog_sync_items c where c.item_id = i.id));
$$;

-- 5. The sync queue ----------------------------------------------------------------------------------------------------
create table app_private.catalog_sync_queue (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  reason text not null check (char_length(reason) <= 80),
  force boolean not null default false,
  queued_at timestamptz not null default now(),
  next_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text check (char_length(last_error) <= 500),
  -- Taken by a dispatch worker until then (longer than a worker lives); a change meanwhile only marks the row queued again.
  leased_until timestamptz
);
create index catalog_sync_queue_next_idx on app_private.catalog_sync_queue (next_at);
alter table app_private.catalog_sync_queue enable row level security;
revoke all on table app_private.catalog_sync_queue from public, anon, authenticated;

-- A shop is queued only while some catalogue can be written; a shop that leaves the catalogue is queued too (its items
-- are hidden). Repeated changes collapse into one row; `force` is kept until the sync runs.
create function app_private.catalog_enqueue(p_vendor_id uuid, p_reason text, p_force boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.whatsapp_catalogs c where c.transport is not null) then
    return;
  end if;
  -- A shop being deleted (its photos cascade first) is never queued.
  if not exists (select 1 from public.vendors v where v.id = p_vendor_id) then
    return;
  end if;
  -- A taken row (lease) or one in backoff after a failure keeps its time; queued_at moving on makes it run again after.
  -- clock_timestamp: a change in the same transaction as a claim still counts as newer than that claim.
  insert into app_private.catalog_sync_queue (vendor_id, reason, force, queued_at)
  values (p_vendor_id, left(p_reason, 80), coalesce(p_force, false), clock_timestamp())
  on conflict (vendor_id) do update set reason = excluded.reason, force = app_private.catalog_sync_queue.force or excluded.force,
    queued_at = clock_timestamp(),
    next_at = case when coalesce(app_private.catalog_sync_queue.leased_until, '-infinity') < now()
                        and app_private.catalog_sync_queue.last_error is null
                   then least(app_private.catalog_sync_queue.next_at, now()) else app_private.catalog_sync_queue.next_at end;
end;
$$;

-- Every shop that is in the catalogue or has items there.
create function app_private.catalog_enqueue_all(p_force boolean, p_reason text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int := 0;
  v uuid;
begin
  for v in
    select x.id from public.vendors x where x.claim_status = 'claimed' and x.orderable and x.listing_status = 'active'
    union
    select distinct c.vendor_id from public.catalog_sync_items c
  loop
    perform app_private.catalog_enqueue(v, p_reason, p_force);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function app_private.catalog_vendor_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.menu_version is distinct from old.menu_version or new.claim_status is distinct from old.claim_status
     or new.orderable is distinct from old.orderable or new.listing_status is distinct from old.listing_status
     or new.name_ar is distinct from old.name_ar or new.name_en is distinct from old.name_en then
    perform app_private.catalog_enqueue(new.id, case when new.menu_version is distinct from old.menu_version
      then 'menu change' else 'shop change' end);
  end if;
  return null;
end;
$$;
create trigger vendors_catalog_sync after update on public.vendors
  for each row execute function app_private.catalog_vendor_changed();

create function app_private.catalog_photo_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.catalog_enqueue(coalesce(new.vendor_id, old.vendor_id), 'photo');
  return null;
end;
$$;
create trigger vendor_photos_catalog_sync after insert or update of status or delete on public.vendor_photos
  for each row execute function app_private.catalog_photo_changed();

-- The worker (dispatch) takes due shops with a lease, and reports each one back.
create function public.catalog_sync_claim(p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_out jsonb;
begin
  with due as (
    select q.vendor_id from app_private.catalog_sync_queue q
    where q.next_at <= now() and coalesce(q.leased_until, '-infinity') < now()
    order by q.next_at limit least(greatest(coalesce(p_limit, 1), 1), 20) for update skip locked
  ), taken as (
    -- The lease outlives any worker (an edge function lives at most 150 s), so one shop never syncs twice at once.
    update app_private.catalog_sync_queue q set leased_until = now() + interval '170 seconds', attempts = q.attempts + 1
    from due where q.vendor_id = due.vendor_id
    returning q.vendor_id, q.force, q.queued_at, q.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('vendor_id', t.vendor_id, 'force', t.force, 'queued_at', t.queued_at,
    'attempts', t.attempts)), '[]') into v_out from taken t;
  return jsonb_build_object('items', v_out, 'catalog', (
    select jsonb_build_object('catalog_id', c.catalog_id, 'transport', c.transport) from public.whatsapp_catalogs c
    where c.transport is not null order by c.checked_at desc limit 1));
end;
$$;

-- Done: the row goes unless the shop changed again after it was taken (then it runs again at once). Failed: backoff, and an
-- ops alert on the fifth failure in a row.
create function public.catalog_sync_finish(p_vendor_id uuid, p_queued_at timestamptz, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  q app_private.catalog_sync_queue%rowtype;
begin
  select * into q from app_private.catalog_sync_queue where vendor_id = p_vendor_id for update;
  if q.vendor_id is null then
    return;
  end if;
  if p_error is null then
    if q.queued_at <= p_queued_at then
      delete from app_private.catalog_sync_queue where vendor_id = p_vendor_id;
    else
      update app_private.catalog_sync_queue set next_at = now(), attempts = 0, last_error = null, leased_until = null
      where vendor_id = p_vendor_id;
    end if;
    return;
  end if;
  update app_private.catalog_sync_queue
  set last_error = left(p_error, 500), leased_until = null,
      next_at = now() + make_interval(secs => least(3600, 30 * power(2, least(q.attempts, 7))))
  where vendor_id = p_vendor_id;
  if q.attempts = 5 then
    insert into public.ops_alerts (kind, severity, vendor_id, message)
    values ('catalog_sync_failed', 'warning', p_vendor_id, left('Catalogue sync failed 5 times: ' || p_error, 500));
  end if;
end;
$$;

-- Reconcile every 10 minutes (config) and a nightly full sync at 03:20 Beirut.
create function app_private.catalog_reconcile() returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((public.config_value('catalog_enabled') #>> '{}')::boolean, false) then
    return 0;
  end if;
  if (extract(minute from now())::int % greatest(1, public.config_numeric('catalog_reconcile_min')::int)) <> 0 then
    return 0;
  end if;
  return app_private.catalog_enqueue_all(false, 'reconcile');
end;
$$;
select cron.schedule('catalog-reconcile', '* * * * *', 'select app_private.catalog_reconcile()');
select cron.schedule('catalog-nightly', '20 0 * * *', $c$select app_private.catalog_enqueue_all(true, 'nightly full sync')$c$);

-- One product set per shop in the catalogue (custom_label_0 = the shop's id), created once by the sync.
create table app_private.catalog_product_sets (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  catalog_id text not null check (catalog_id ~ '^[0-9]{5,30}$'),
  product_set_id text not null check (product_set_id ~ '^[0-9]{5,30}$'),
  created_at timestamptz not null default now()
);
alter table app_private.catalog_product_sets enable row level security;
revoke all on table app_private.catalog_product_sets from public, anon, authenticated;

create function public.catalog_product_set(p_vendor_id uuid, p_catalog_id text, p_product_set_id text default null) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if p_product_set_id is not null then
    insert into app_private.catalog_product_sets (vendor_id, catalog_id, product_set_id) values (p_vendor_id, p_catalog_id, p_product_set_id)
    on conflict (vendor_id) do update set catalog_id = excluded.catalog_id, product_set_id = excluded.product_set_id;
  end if;
  return (select s.product_set_id from app_private.catalog_product_sets s where s.vendor_id = p_vendor_id and s.catalog_id = p_catalog_id);
end;
$$;

-- 6. What the customer is shown ---------------------------------------------------------------------------------------
-- The catalogue a reply from this number may use: the one connected to the number's business account, when the catalogue
-- is on. A simulated customer in a catalogue scenario gets the simulated catalogue (staging only, +999 numbers only).
create table app_private.sim_catalog_customers (
  phone_e164 text primary key check (phone_e164 ~ '^\+999[0-9]{6,12}$'),
  created_at timestamptz not null default now()
);
alter table app_private.sim_catalog_customers enable row level security;
revoke all on table app_private.sim_catalog_customers from public, anon, authenticated;

create function public.catalog_for_number(p_phone_number_id text, p_to text) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when not coalesce((public.config_value('catalog_enabled') #>> '{}')::boolean, false) then null
    when app_private.is_sim_phone(p_to) then
      case when app_private.sim_sink_on() and exists (select 1 from app_private.sim_catalog_customers s where s.phone_e164 = p_to)
           then 'sim' end
    else (select c.catalog_id from public.whatsapp_catalogs c join public.whatsapp_numbers w on w.waba_id = c.waba_id
          where w.phone_number_id = p_phone_number_id and w.active and c.transport is not null limit 1)
  end;
$$;

-- Catalogue products of a shop that a product message may show now: orderable items that are visible in that catalogue
-- (the simulated catalogue counts every desired item as synced), optionally one section or given items, in menu order.
-- `total` is how many orderable items the shop has, so the caller can choose the catalogue (<= 30) or the list.
create function public.catalog_products(p_vendor_id uuid, p_catalog_id text, p_section_id uuid default null,
  p_item_ids uuid[] default null, p_limit integer default 30) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with items as (
    select i.id, i.name_ar, i.name_en, i.price_usd, i.pricing_unit, i.est_weight_kg, i.section_id,
      coalesce(s.name_ar, s.name_en, 'Menu') as section, coalesce(s.name_en, s.name_ar, 'Menu') as section_en,
      s.sort_order as s_sort, i.sort_order
    from public.menu_items i
    join public.vendors v on v.id = i.vendor_id
    left join public.menu_sections s on s.id = i.section_id
    where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
      and app_private.menu_item_orderable(i.id, 1)
  ), shown as (
    select x.* from items x
    where (p_section_id is null or x.section_id = p_section_id)
      and (p_item_ids is null or x.id = any (p_item_ids))
      and (p_catalog_id = 'sim' or exists (select 1 from public.catalog_sync_items c where c.item_id = x.id and c.visible
                                           and c.catalog_id = p_catalog_id))
    order by case when p_item_ids is null then 0 else array_position(p_item_ids, x.id) end, x.s_sort nulls last, x.sort_order, x.id
    limit least(greatest(coalesce(p_limit, 30), 1), 30)
  )
  select jsonb_build_object('total', (select count(*) from items),
    'section_total', (select count(*) from items x where p_section_id is not null and x.section_id = p_section_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('retailer_id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en,
      'price_usd', case when s.pricing_unit = 'kg' then round(s.price_usd * s.est_weight_kg, 2) else s.price_usd end,
      'section', s.section, 'section_en', s.section_en)) from shown s), '[]'));
$$;

-- A shop's best sellers: the items most ordered over catalog_best_sellers_days, then the menu order.
create function public.catalog_best_sellers(p_vendor_id uuid, p_limit integer default 10) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(x.id order by x.n desc, x.sort_order, x.id), '{}') from (
    select i.id, i.sort_order, coalesce(sum(oi.quantity) filter (where o.created_at > now()
      - make_interval(days => public.config_numeric('catalog_best_sellers_days')::int)), 0) as n
    from public.menu_items i
    left join public.order_items oi on oi.item_id = i.id
    left join public.orders o on o.id = oi.order_id and o.status not in ('cancelled', 'rejected')
    where i.vendor_id = p_vendor_id and app_private.menu_item_orderable(i.id, 1)
    group by i.id, i.sort_order
    order by n desc, i.sort_order, i.id
    limit least(greatest(coalesce(p_limit, 10), 1), 30)
  ) x;
$$;

-- 7. An inbound cart in the one basket ------------------------------------------------------------------------------------
-- p_lines: [{item_id, quantity, shown_usd?}] from the `order` message (our item ids only). Each line that needs no choice is
-- added to the open basket through basket_add_item, keyed by the message (a replayed turn never adds twice); lines with
-- required choices come back in `needs_options`; lines of another shop than the cart's are skipped. A basket from another
-- shop is kept unless p_replace (the customer chose to replace it). Every added line is priced by the server; `diffs` lists
-- each line whose catalogue price differs from the server's (the customer sees them before checkout). Nothing is charged
-- from a catalogue price.
create function public.cart_merge(p_customer_id uuid, p_message_id text, p_lines jsonb, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  l jsonb;
  r jsonb;
  v_item public.menu_items%rowtype;
  v_cart_vendor uuid;
  v_basket public.baskets%rowtype;
  v_added int := 0;
  v_first boolean := true;
  v_now numeric;
  v_skipped jsonb := '[]';
  v_needs jsonb := '[]';
  v_diffs jsonb := '[]';
begin
  if p_message_id is null or char_length(p_message_id) > 200 then
    raise exception 'cart_merge needs the message id' using errcode = 'invalid_parameter_value';
  end if;
  -- The cart's shop: the first line that is one of our items.
  select i.vendor_id into v_cart_vendor from jsonb_array_elements(coalesce(p_lines, '[]')) with ordinality x(v, n)
  join public.menu_items i on i.id = (x.v ->> 'item_id')::uuid order by x.n limit 1;
  if v_cart_vendor is null then
    return jsonb_build_object('status', 'unknown_items', 'added', 0);
  end if;
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is not null and v_basket.vendor_id <> v_cart_vendor and not coalesce(p_replace, false)
     -- a replay of a merge that already replaced the basket finds the cart's shop in it
     and not exists (select 1 from app_private.basket_add_ops o where o.op_key like p_message_id || '#cart:%') then
    return jsonb_build_object('status', 'other_vendor',
      'basket_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id),
      'basket_vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_basket.vendor_id),
      'cart_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_cart_vendor),
      'cart_vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_cart_vendor));
  end if;
  for l in select x from jsonb_array_elements(coalesce(p_lines, '[]')) x limit 30 loop
    select * into v_item from public.menu_items where id = (l ->> 'item_id')::uuid;
    if v_item.id is null or v_item.vendor_id <> v_cart_vendor then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('item_id', l ->> 'item_id',
        'status', case when v_item.id is null then 'unknown_item' else 'other_branch' end,
        'item', coalesce(v_item.name_ar, v_item.name_en)));
      continue;
    end if;
    if exists (select 1 from public.menu_option_groups g where g.item_id = v_item.id and g.min_select > 0) then
      v_needs := v_needs || jsonb_build_array(jsonb_build_object('item_id', v_item.id,
        'quantity', least(greatest(coalesce((l ->> 'quantity')::int, 1), 1), 50)));
      continue;
    end if;
    r := public.basket_add_item(p_customer_id, v_item.id, least(greatest(coalesce((l ->> 'quantity')::int, 1), 1), 50), '{}',
      null, v_first and coalesce(p_replace, false), p_message_id || '#cart:' || v_item.id);
    if r ->> 'status' = 'added' then
      -- Only an added line has replaced the old basket; until then the next line still carries the replace.
      v_first := false;
      v_added := v_added + 1;
      v_now := case when v_item.pricing_unit = 'kg' then round(v_item.price_usd * v_item.est_weight_kg, 2) else v_item.price_usd end;
      if jsonb_typeof(l -> 'shown_usd') = 'number' and abs((l ->> 'shown_usd')::numeric - v_now) >= 0.005 then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('item_id', v_item.id,
          'item', coalesce(v_item.name_ar, v_item.name_en), 'item_en', coalesce(v_item.name_en, v_item.name_ar),
          'shown_usd', round((l ->> 'shown_usd')::numeric, 2), 'now_usd', v_now));
      end if;
    else
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'status', r ->> 'status',
        'item', coalesce(v_item.name_ar, v_item.name_en)));
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'added', v_added, 'skipped', v_skipped, 'needs_options', v_needs,
    'diffs', v_diffs, 'basket', case when v_added > 0 or v_basket.id is not null then public.basket_view(p_customer_id) end);
end;
$$;

-- 8. Staging simulator: give a simulated customer the simulated catalogue (one scenario at a time) --------------------------
create function public.sim_catalog(p_phone text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private.sim_sink_on() then
    return jsonb_build_object('status', 'sink_off');
  end if;
  if not app_private.is_sim_phone(p_phone) then
    return jsonb_build_object('status', 'not_a_sim_phone');
  end if;
  if p_on then
    insert into app_private.sim_catalog_customers (phone_e164) values (p_phone) on conflict do nothing;
  else
    delete from app_private.sim_catalog_customers where phone_e164 = p_phone;
  end if;
  delete from app_private.sim_catalog_customers where created_at < now() - interval '1 day';
  return jsonb_build_object('status', 'ok');
end;
$$;

-- 9. The dispatch kick also wakes for due catalogue syncs ---------------------------------------------------------------------
create or replace function app_private.dispatch_kick() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select value from app_private.runtime_settings where key = 'functions_base_url');
  v_secret text := (select value from app_private.runtime_settings where key = 'dispatch_secret');
begin
  if v_url is null then
    return null;
  end if;
  if not exists (select 1 from public.outbound_messages where status in ('queued', 'sending') and available_at <= now())
     and not exists (select 1 from public.ops_alerts where sent_at is null and send_attempts < 10)
     and not exists (select 1 from public.webhook_events where status in ('queued', 'failed') and attempts < 5)
     and not exists (select 1 from app_private.catalog_sync_queue where next_at <= now()
                     and coalesce(leased_until, '-infinity') < now()) then
    return null;
  end if;
  return net.http_post(
    url := v_url || '/dispatch?forceFunctionRegion=eu-central-1',
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function app_private.dispatch_kick() from public;

-- Grants -------------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.whatsapp_catalog_record(text, text, text, boolean, text)',
    'public.catalog_sync_record(uuid, jsonb)',
    'public.catalog_synced(uuid)',
    'public.catalog_sync_state(uuid)',
    'public.catalog_desired(uuid)',
    'public.catalog_image(uuid)',
    'public.catalog_sync_claim(integer)',
    'public.catalog_sync_finish(uuid, timestamptz, text)',
    'public.catalog_product_set(uuid, text, text)',
    'public.catalog_for_number(text, text)',
    'public.catalog_products(uuid, text, uuid, uuid[], integer)',
    'public.catalog_best_sellers(uuid, integer)',
    'public.cart_merge(uuid, text, jsonb, boolean)',
    'public.sim_catalog(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'app_private.catalog_enqueue(uuid, text, boolean)',
    'app_private.catalog_enqueue_all(boolean, text)',
    'app_private.catalog_vendor_changed()',
    'app_private.catalog_photo_changed()',
    'app_private.catalog_reconcile()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
