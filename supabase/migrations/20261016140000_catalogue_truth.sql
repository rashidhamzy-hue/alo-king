-- Session 5f (DECISIONS §39.15.2): Meta's review status is the truth. On 16 October INDINER time (102 items synced as
-- visible) opened with 3, and "Burgers · 9 items" opened one: the sync took "batch accepted" for "shown", and Meta had
-- not approved (or had dropped) the rest. Items without a photo could not be reached once a section opened as a product
-- message.
--
-- 1. catalog_item_status: each product's review status (column meta_status: no public column may be named rating or
--    review, supabase/tests/seed), visibility, availability and errors as Meta reports them
--    (GET /{catalog}/products), read after every batch and by a sweep of the whole catalogue (every 15 minutes while
--    anything is pending or unknown, else nightly); a product Meta does not list at all is 'missing'.
-- 2. Product messages and their counts use only items Meta approved and shows (app_private.catalog_item_shown).
-- 3. A shop's sections count every orderable item; a section opens as a product message of its shown items, and its
--    other items follow as a list (catalog_section_rest), so every count equals what opens and nothing is unreachable.
-- 4. A shop with fewer than browse_min_catalog_items shown items opens with the list menu (config, default 6).
-- 5. catalog_status_report(): per shop, items, with a photo, synced, approved, pending, rejected (the PR's table).

insert into public.app_config (key, value, effective_from, note) values
  ('browse_min_catalog_items', '6', '2026-10-16 12:00+03', 'DECISIONS §39.15.2: a shop with fewer Meta-approved photo items opens with the list menu'),
  ('catalog_status_sweep_minutes', '15', '2026-10-16 12:00+03', 'Session 5f: a catalogue status sweep at most this often while items are pending or unknown'),
  ('catalog_status_full_hours', '20', '2026-10-16 12:00+03', 'Session 5f: otherwise one full status sweep at least this often (nightly)')
on conflict do nothing;

-- 1. What Meta says about each product ---------------------------------------------------------------------------------
create table public.catalog_item_status (
  item_id uuid primary key references public.menu_items (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  catalog_id text not null,
  -- approved, pending, rejected, outdated, or '' (Meta has not reviewed it yet)
  meta_status text not null default '' check (meta_status ~ '^[a-z_]{0,30}$'),
  visibility text check (visibility ~ '^[a-z_]{1,30}$'),
  availability text check (char_length(availability) <= 40),
  -- Meta's list of problems for the product: [{error_type, priority, title, description}]
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  checked_at timestamptz not null default now()
);
create index catalog_item_status_vendor_idx on public.catalog_item_status (vendor_id);
alter table public.catalog_item_status enable row level security;
revoke all on public.catalog_item_status from public, anon, authenticated;
grant all on public.catalog_item_status to service_role;

-- Records Meta's answer for products we synced: [{retailer_id, review_status, visibility, availability, errors}].
-- Ids that are not our menu items (a stray product in the catalogue) are skipped.
create function public.catalog_status_record(p_catalog_id text, p_rows jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  -- Meta's words are cleaned to the table's shape (a value we have never seen never breaks a page).
  insert into public.catalog_item_status (item_id, vendor_id, catalog_id, meta_status, visibility, availability, errors, checked_at)
  select distinct on (i.id) i.id, i.vendor_id, p_catalog_id,
    left(regexp_replace(lower(coalesce(r ->> 'review_status', '')), '[^a-z_]', '_', 'g'), 30),
    nullif(left(regexp_replace(lower(coalesce(r ->> 'visibility', '')), '[^a-z_]', '_', 'g'), 30), ''),
    nullif(left(lower(coalesce(r ->> 'availability', '')), 40), ''),
    case jsonb_typeof(r -> 'errors')
      when 'array' then r -> 'errors'
      when 'object' then coalesce(case when jsonb_typeof(r -> 'errors' -> 'data') = 'array' then r -> 'errors' -> 'data' end, '[]')
      else '[]' end,
    now()
  from jsonb_array_elements(p_rows) r
  join public.menu_items i on i.id::text = r ->> 'retailer_id'
  where (r ->> 'retailer_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  order by i.id
  on conflict (item_id) do update
    set vendor_id = excluded.vendor_id, catalog_id = excluded.catalog_id, meta_status = excluded.meta_status,
        visibility = excluded.visibility, availability = excluded.availability, errors = excluded.errors,
        checked_at = excluded.checked_at;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.catalog_status_record(text, jsonb) from public, anon, authenticated;
grant execute on function public.catalog_status_record(text, jsonb) to service_role;

-- The whole-catalogue sweep: one page per call, the cursor kept between dispatch runs. next_due_at says when the next
-- page is wanted, so deciding costs one row read (DECISIONS §39.14 rule 2: no catalogue scan per tap): 15 s between pages,
-- then catalog_status_sweep_minutes when something stayed unsure, else catalog_status_full_hours; a sync of new or changed
-- products brings it forward to catalog_status_sweep_minutes. A failing page is retried after 2, then 4 minutes; the third
-- failure restarts the sweep from the first page in 30 minutes and an operator alert says so.
create table app_private.catalog_status_sweeps (
  catalog_id text primary key,
  after_cursor text,
  started_at timestamptz,
  page_at timestamptz,
  finished_at timestamptz,
  next_due_at timestamptz not null default now(),
  failures integer not null default 0
);
alter table app_private.catalog_status_sweeps enable row level security;
revoke all on app_private.catalog_status_sweeps from public, anon, authenticated;

-- Is a page of the sweep due now, and from which cursor? The catalogue is the one the sync writes to (the newest with a
-- transport) unless one is named. A due page is claimed for a minute, so two dispatch runs never ask for it together.
-- The catalogue the sweep reads when none is named: the one the sync writes to (the newest with a transport), only while
-- the catalogue is on. dispatch_kick asks the same question, so it never wakes dispatch for a sweep nothing would serve.
create function app_private.catalog_sweep_target() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.catalog_id from public.whatsapp_catalogs c
  where c.transport is not null and coalesce((public.config_value('catalog_enabled') #>> '{}')::boolean, false)
  order by c.checked_at desc limit 1;
$$;
revoke all on function app_private.catalog_sweep_target() from public, anon, authenticated;

create function public.catalog_status_sweep_next(p_catalog_id text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.whatsapp_catalogs%rowtype;
  v_s app_private.catalog_status_sweeps%rowtype;
begin
  select * into v_cat from public.whatsapp_catalogs c
  where c.catalog_id = coalesce(p_catalog_id, app_private.catalog_sweep_target()) and c.transport is not null;
  if v_cat.catalog_id is null then
    return jsonb_build_object('due', false);
  end if;
  insert into app_private.catalog_status_sweeps (catalog_id) values (v_cat.catalog_id) on conflict do nothing;
  select * into v_s from app_private.catalog_status_sweeps where catalog_id = v_cat.catalog_id for update;
  if v_s.next_due_at > now() then
    return jsonb_build_object('due', false);
  end if;
  update app_private.catalog_status_sweeps
  set next_due_at = now() + interval '1 minute', page_at = now(),
      started_at = case when after_cursor is null then now() else started_at end
  where catalog_id = v_cat.catalog_id;
  return jsonb_build_object('due', true, 'after', v_s.after_cursor, 'catalog_id', v_cat.catalog_id,
    'transport', v_cat.transport);
end;
$$;
revoke all on function public.catalog_status_sweep_next(text) from public, anon, authenticated;
grant execute on function public.catalog_status_sweep_next(text) to service_role;

-- After a page: the next cursor; or the sweep is finished (p_next null): products Meta did not list although they were
-- synced well before the sweep started are recorded as 'missing' and their shops re-sent once; then the next sweep is
-- planned. p_failed: backoff, and after three failures a restart from the first page.
create function public.catalog_status_sweep_done(p_catalog_id text, p_next text, p_failed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s app_private.catalog_status_sweeps%rowtype;
  v_missing integer := 0;
  v_vendor uuid;
  v_unsure boolean;
begin
  select * into v_s from app_private.catalog_status_sweeps where catalog_id = p_catalog_id for update;
  if v_s.catalog_id is null then
    return jsonb_build_object('status', 'unknown_catalogue');
  end if;
  if coalesce(p_failed, false) then
    if v_s.failures + 1 >= 3 then
      update app_private.catalog_status_sweeps
      set after_cursor = null, failures = 0, next_due_at = now() + interval '30 minutes'
      where catalog_id = p_catalog_id;
      perform app_private.ops_alert('catalog_status:' || p_catalog_id || ':' || to_char(now(), 'YYYY-MM-DD'),
        'catalog_sync_failed', 'warning',
        'Meta catalogue status could not be read three times in a row; product messages keep the last statuses we have',
        null, null, jsonb_build_object('catalog_id', p_catalog_id));
      return jsonb_build_object('status', 'restart');
    end if;
    update app_private.catalog_status_sweeps
    set failures = failures + 1, next_due_at = now() + make_interval(mins => (2 ^ (failures + 1))::integer)
    where catalog_id = p_catalog_id;
    return jsonb_build_object('status', 'backoff');
  end if;
  if p_next is not null then
    update app_private.catalog_status_sweeps
    set after_cursor = p_next, failures = 0, next_due_at = now() + interval '15 seconds'
    where catalog_id = p_catalog_id;
    return jsonb_build_object('status', 'next_page');
  end if;
  -- Finished. Meta lists every product it holds; one we synced (more than 10 minutes before the sweep began) that it did
  -- not list is missing: shown nowhere, re-sent once (the next nightly full sync sends it again anyway).
  for v_vendor in
    with cand as (
      select c.item_id, c.vendor_id, s.meta_status as prev
      from public.catalog_sync_items c
      left join public.catalog_item_status s on s.item_id = c.item_id
      where c.visible and c.catalog_id = p_catalog_id and c.synced_at < v_s.started_at - interval '10 minutes'
        and (s.item_id is null or s.checked_at < v_s.started_at or s.catalog_id <> p_catalog_id)
    ), up as (
      insert into public.catalog_item_status (item_id, vendor_id, catalog_id, meta_status, checked_at)
      select item_id, vendor_id, p_catalog_id, 'missing', now() from cand
      on conflict (item_id) do update
        set meta_status = 'missing', catalog_id = excluded.catalog_id, visibility = null, availability = null,
            errors = '[]', checked_at = excluded.checked_at
      returning item_id
    )
    -- Re-sent once: a product already missing at the last sweep waits for the nightly full sync.
    select distinct cand.vendor_id from cand join up on up.item_id = cand.item_id
    where cand.prev is distinct from 'missing'
  loop
    v_missing := v_missing + 1;
    perform app_private.catalog_enqueue(v_vendor, 'missing at Meta', true);
  end loop;
  v_unsure := exists (
    select 1 from public.catalog_sync_items c
    left join public.catalog_item_status s on s.item_id = c.item_id
    where c.visible and c.catalog_id = p_catalog_id
      and (s.item_id is null or s.catalog_id <> p_catalog_id or s.meta_status in ('', 'pending', 'outdated')
           or c.synced_at > v_s.started_at));
  update app_private.catalog_status_sweeps
  set after_cursor = null, failures = 0, finished_at = now(),
      next_due_at = now() + case when v_unsure
        then make_interval(mins => public.config_numeric('catalog_status_sweep_minutes')::integer)
        else make_interval(hours => public.config_numeric('catalog_status_full_hours')::integer) end
  where catalog_id = p_catalog_id;
  return jsonb_build_object('status', 'finished', 'shops_resent', v_missing, 'unsure', v_unsure);
end;
$$;
revoke all on function public.catalog_status_sweep_done(text, text, boolean) from public, anon, authenticated;
grant execute on function public.catalog_status_sweep_done(text, text, boolean) to service_role;

-- New or changed products bring the next sweep forward (one statement, whatever the batch size).
create function app_private.catalog_sync_items_sweep_soon() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.catalog_status_sweeps
  set next_due_at = least(next_due_at, now() + make_interval(mins => public.config_numeric('catalog_status_sweep_minutes')::integer))
  where after_cursor is null;
  return null;
end;
$$;
revoke all on function app_private.catalog_sync_items_sweep_soon() from public, anon, authenticated;
create trigger catalog_sync_items_sweep_soon after insert or update on public.catalog_sync_items
  for each statement execute function app_private.catalog_sync_items_sweep_soon();

-- dispatch is woken for a due sweep page too (as in 20261015200000_meta_catalogue.sql, with the sweep added).
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
                     and coalesce(leased_until, '-infinity') < now())
     and not exists (select 1 from app_private.catalog_status_sweeps s where s.next_due_at <= now()
                     and s.catalog_id = app_private.catalog_sweep_target()) then
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

-- 2. Shown in WhatsApp = synced as visible, approved by Meta and published. The simulator's catalogue ('sim') has no
-- Meta behind it: every synced-looking item counts there, as before.
create function app_private.catalog_item_shown(p_item_id uuid, p_catalog_id text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_catalog_id = 'sim' or exists (
    select 1 from public.catalog_sync_items c
    join public.catalog_item_status s on s.item_id = c.item_id
    where c.item_id = p_item_id and c.visible and c.catalog_id = p_catalog_id and s.catalog_id = p_catalog_id
      and s.meta_status = 'approved' and coalesce(s.visibility, 'published') = 'published'
      and coalesce(s.availability, 'in stock') = 'in stock');
$$;
revoke all on function app_private.catalog_item_shown(uuid, text) from public, anon, authenticated;

-- 3. A shop's menu for the bot: every orderable item counts, only shown items go into product messages -------------------
-- As in 20261016110000_browse.sql, with the counts over every orderable item: sections[].total is what the section's
-- row says and what opens (its shown items as a product message, the rest as a list); 'shown' decides a thin shop.
create or replace function public.catalog_shop_menu(p_vendor_id uuid, p_catalog_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sold as (
    select oi.item_id, sum(oi.quantity) as n from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.vendor_id = p_vendor_id and o.status not in ('cancelled', 'rejected')
      and o.created_at > now() - make_interval(days => public.config_numeric('catalog_best_sellers_days')::int)
    group by oi.item_id
  ),
  items as (
    select i.id, i.name_ar, i.name_en, i.section_id, i.sort_order, coalesce(sd.n, 0) as sold,
      case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end as price_usd,
      app_private.catalog_item_shown(i.id, p_catalog_id) as shown
    from public.menu_items i
    join public.vendors v on v.id = i.vendor_id
    left join sold sd on sd.item_id = i.id
    where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
      and app_private.menu_item_orderable(i.id, 1)
  ),
  secs as (
    select s.id, coalesce(s.name_ar, s.name_en, 'المنيو') as name_ar, coalesce(s.name_en, s.name_ar, 'Menu') as name_en,
      coalesce(s.sort_order, 1000) as sort_order,
      case
        when coalesce(s.name_en, '') || ' ' || coalesce(s.name_ar, '') ~* '(drink|beverage|soft|water|juice|dip|sauce|add.?on|extra|side cup|make it|مشروب|صلص)' then 3
        when coalesce(s.name_en, '') || ' ' || coalesce(s.name_ar, '') ~* '(dessert|sweet|side|appeti|starter|salad|kids|shake|ice cream|حلو|مقبلات|سلط)' then 2
        else 1 end as tier
    from public.menu_sections s where s.vendor_id = p_vendor_id
  ),
  grouped as (
    select x.section_id, count(*) as total, count(*) filter (where x.shown) as shown, sum(x.sold) as sold,
      coalesce(jsonb_agg(jsonb_build_object('retailer_id', x.id, 'name_ar', x.name_ar, 'name_en', x.name_en, 'price_usd', x.price_usd)
                order by x.sold desc, x.sort_order, x.id) filter (where x.shown), '[]') as products
    from items x group by x.section_id
  )
  select jsonb_build_object('total', (select count(*) from items), 'shown', (select count(*) from items where shown),
    'sections', coalesce(jsonb_agg(jsonb_build_object('section_id', g.section_id,
        'name_ar', coalesce(sc.name_ar, 'المنيو'), 'name_en', coalesce(sc.name_en, 'Menu'), 'total', g.total, 'shown', g.shown,
        'sold', g.sold, 'products', g.products)
      order by coalesce(sc.tier, 1), g.sold desc, coalesce(sc.sort_order, 1000), g.section_id), '[]'))
  from grouped g left join secs sc on sc.id = g.section_id;
$$;

-- A section's orderable items that are not shown in WhatsApp's catalogue: the list after its product message, in the
-- shape of vendor_menu (so the same list renders them), nine at a time with a total.
create function public.catalog_section_rest(p_vendor_id uuid, p_catalog_id text, p_section_id uuid,
  p_limit integer default 10, p_offset integer default 0)
returns table (item_id uuid, section_id uuid, section_name text, name_ar text, name_en text, name_fr text, price_usd numeric,
  pricing_unit public.pricing_unit, est_weight_kg numeric, orderable boolean, last_few boolean, has_options boolean,
  container_deposit_usd numeric, vegetarian boolean, vegan boolean, contains_pork boolean, contains_alcohol boolean,
  spicy_level smallint, allergens public.allergen[], score real, total_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.section_id, coalesce(s.name_ar, s.name_en), i.name_ar, i.name_en, i.name_fr, i.price_usd, i.pricing_unit,
    i.est_weight_kg, true,
    i.daily_remaining is not null and i.daily_date = current_date and i.daily_remaining <= public.config_numeric('daily_qty_low_threshold'),
    exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
    i.container_deposit_usd, i.vegetarian, i.vegan, i.contains_pork, i.contains_alcohol, i.spicy_level, i.allergens, 1::real,
    count(*) over ()
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and i.section_id = p_section_id
    and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
    and app_private.menu_item_orderable(i.id, 1)
    and not app_private.catalog_item_shown(i.id, p_catalog_id)
  order by i.sort_order, i.id
  limit least(greatest(coalesce(p_limit, 10), 1), 30) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.catalog_section_rest(uuid, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.catalog_section_rest(uuid, text, uuid, integer, integer) to service_role;

-- Search results and one-shop pages through product messages: only shown items (as in 20261016110000).
create or replace function public.catalog_products_for(p_item_ids uuid[], p_catalog_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('retailer_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en,
      'price_usd', case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
      'vendor_id', v.id, 'section', coalesce(v.name_ar, v.name_en), 'section_en', coalesce(v.name_en, v.name_ar),
      -- How many of the shop's items Meta shows: a thin shop's results go in the list, as its menu does (§39.15.2).
      'shop_shown', case when p_catalog_id = 'sim' then 999 else (
        select count(*) from public.catalog_item_status st
        join public.catalog_sync_items c on c.item_id = st.item_id and c.visible and c.catalog_id = p_catalog_id
        where st.vendor_id = v.id and st.catalog_id = p_catalog_id and st.meta_status = 'approved'
          and coalesce(st.visibility, 'published') = 'published' and coalesce(st.availability, 'in stock') = 'in stock'
          and app_private.menu_item_orderable(st.item_id, 1)) end)
    order by array_position(p_item_ids, i.id)), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  where i.id = any (p_item_ids[1:30]) and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
    and app_private.menu_item_orderable(i.id, 1)
    and app_private.catalog_item_shown(i.id, p_catalog_id);
$$;

create or replace function public.catalog_products(p_vendor_id uuid, p_catalog_id text, p_section_id uuid default null,
  p_item_ids uuid[] default null, p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
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
      and app_private.catalog_item_shown(x.id, p_catalog_id)
    order by case when p_item_ids is null then 0 else array_position(p_item_ids, x.id) end, x.s_sort nulls last, x.sort_order, x.id
    limit least(greatest(coalesce(p_limit, 30), 1), 30)
  )
  select jsonb_build_object('total', (select count(*) from items),
    'section_total', (select count(*) from items x where p_section_id is not null and x.section_id = p_section_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('retailer_id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en,
      'price_usd', case when s.pricing_unit = 'kg' then round(s.price_usd * s.est_weight_kg, 2) else s.price_usd end,
      'section', s.section, 'section_en', s.section_en)) from shown s), '[]'));
$$;

-- 5. Per shop: what the catalogue holds and what Meta shows (the session's PR table, and a daily check) -----------------
create function public.catalog_status_report(p_catalog_id text default null)
returns table (vendor_id uuid, shop text, items bigint, with_photo bigint, synced bigint, approved bigint, pending bigint,
  rejected bigint, missing bigint, unknown bigint, top_error text)
language sql
stable
security definer
set search_path = ''
as $$
  with cat as (
    select coalesce(p_catalog_id, (select c.catalog_id from public.whatsapp_catalogs c where c.transport is not null
      order by c.checked_at desc limit 1)) as id
  )
  select v.id, coalesce(v.name_en, v.name_ar),
    count(*) filter (where app_private.menu_item_orderable(i.id, 1)),
    count(p.item_id),
    count(c.item_id) filter (where c.visible),
    count(*) filter (where c.visible and s.meta_status = 'approved' and coalesce(s.visibility, 'published') = 'published'
      and coalesce(s.availability, 'in stock') = 'in stock'),
    count(*) filter (where c.visible and s.meta_status in ('', 'pending', 'outdated')),
    count(*) filter (where c.visible and s.meta_status = 'rejected'),
    count(*) filter (where c.visible and s.meta_status = 'missing'),
    count(*) filter (where c.visible and s.item_id is null),
    (select e ->> 'title' from public.catalog_item_status s2 cross join jsonb_array_elements(s2.errors) e
      where s2.vendor_id = v.id group by e ->> 'title' order by count(*) desc limit 1)
  from public.vendors v
  cross join cat
  join public.menu_items i on i.vendor_id = v.id
  left join public.menu_item_photos p on p.item_id = i.id
  left join public.catalog_sync_items c on c.item_id = i.id and c.catalog_id = cat.id
  left join public.catalog_item_status s on s.item_id = i.id and s.catalog_id = cat.id
  where v.claim_status = 'claimed' and v.orderable and not v.is_test
  group by v.id, v.name_en, v.name_ar
  order by coalesce(v.name_en, v.name_ar);
$$;
revoke all on function public.catalog_status_report(text) from public, anon, authenticated;
grant execute on function public.catalog_status_report(text) to service_role;
