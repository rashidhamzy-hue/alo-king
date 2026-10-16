-- Session 5f (DECISIONS §39.15.2): a cart from several shops is split, never dropped. The header catalogue is one flat
-- list of every shop, so a customer can send one cart with items from three shops. One order comes from one shop: the
-- customer picks which shop first, and the other shops' items are kept as saved carts for basket_keep_hours; after the
-- order is confirmed the bot offers the next one ("You also picked 2 items from Deli Dough. Order them now?"). A shop that
-- does not deliver to the customer's pin is named ("doesn't deliver to Baakline") with the closest open shop that delivers
-- the same dish. When a cart from shop B meets an open basket from shop A: Switch to B, Keep A, or Do both (A first, B
-- saved). Only items truly unavailable are named, by name. Deciding costs no routing call (§39.15.1: the recorded
-- distances) and no catalogue scan (§39.14 rule 2: the cart's own items by primary key, the dish index for alternatives).

insert into public.app_config (key, value, effective_from, note) values
  ('basket_keep_hours', '24', '2026-10-16 12:00+03',
   'DECISIONS §39.15.2: how long the other shops'' items of a split cart are kept as saved carts')
on conflict do nothing;

create table public.saved_carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  -- [{item_id, quantity, shown_usd}]: what the customer sent; prices are the server's when the cart is ordered.
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 30),
  -- The WhatsApp message the cart came in, so a replayed message saves nothing twice; the shop's place in the cart.
  source_message_id text not null check (char_length(source_message_id) <= 200),
  position integer not null default 0,
  status text not null default 'saved' check (status in ('saved', 'used', 'dropped')),
  -- The message that took it: a replayed turn (§39.13, stall replay) gets the same lines back.
  taken_message_id text check (char_length(taken_message_id) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (customer_id, source_message_id, vendor_id)
);
create index saved_carts_open_idx on public.saved_carts (customer_id, created_at, position) where status = 'saved';
alter table public.saved_carts enable row level security;
revoke all on public.saved_carts from public, anon, authenticated;
grant select, insert, update, delete on public.saved_carts to service_role;

-- Alternatives look shops up by dish, never by scanning every item.
create index if not exists menu_item_nutrition_dish_idx on public.menu_item_nutrition (dish_id, vendor_id) where dish_id is not null;

-- A line set grouped by shop: our items only (by primary key), in the order they came; unknown ids are left out, never
-- guessed. orderable: the shop still takes orders (a shop that stopped is named as unavailable, never saved).
create function app_private.cart_groups(p_lines jsonb)
returns table (vendor_id uuid, lines jsonb, first_at bigint, orderable boolean, names jsonb, names_en jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select i.vendor_id,
    jsonb_agg(jsonb_build_object('item_id', i.id,
      'quantity', least(greatest(coalesce((x.v ->> 'quantity')::int, 1), 1), 50),
      'shown_usd', case when jsonb_typeof(x.v -> 'shown_usd') = 'number' then x.v -> 'shown_usd' end) order by x.n),
    min(x.n),
    bool_and(v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'),
    jsonb_agg(coalesce(i.name_ar, i.name_en) order by x.n),
    jsonb_agg(coalesce(i.name_en, i.name_ar) order by x.n)
  from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]' end) with ordinality x(v, n)
  join public.menu_items i on i.id = case when (x.v ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                          then (x.v ->> 'item_id')::uuid end
  join public.vendors v on v.id = i.vendor_id
  where x.n <= 30
  group by i.vendor_id;
$$;
revoke all on function app_private.cart_groups(jsonb) from public, anon, authenticated;

-- The closest open shop that delivers to the customer's pin with the same dish (the dish library's id) as the first dish
-- of a shop that does not. Candidates come from the dish index (orderable, delivering, not hidden from this customer,
-- within the delivery limit as the crow flies), the 40 nearest by straight line, then open and not paused, then the
-- browse delivery check (recorded distances only). The cost stays the same with thousands of shops (§39.14 rule 2).
create function app_private.cart_alternative(p_customer_id uuid, p_vendor_id uuid, p_lines jsonb, p_hidden uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dish text;
  v_qty int;
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_here extensions.geography;
  v_max_m float8 := coalesce(public.max_delivery_km(), 0) * 1000;
  v_ids uuid[];
  v_check jsonb;
begin
  select nu.dish_id, least(greatest(coalesce((l ->> 'quantity')::int, 1), 1), 50) into v_dish, v_qty
  from jsonb_array_elements(p_lines) with ordinality t(l, n)
  join public.menu_item_nutrition nu on nu.item_id = (t.l ->> 'item_id')::uuid
  where nu.dish_id is not null
  order by t.n limit 1;
  if v_dish is null or v_pt is null then
    return null;
  end if;
  v_here := extensions.st_setsrid(extensions.st_makepoint((v_pt ->> 'lon')::float8, (v_pt ->> 'lat')::float8), 4326)::extensions.geography;
  select array_agg(id) into v_ids from (
    select v.id from (select distinct nu.vendor_id from public.menu_item_nutrition nu where nu.dish_id = v_dish) d
    join public.vendors v on v.id = d.vendor_id
    where v.id <> p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active' and not v.is_test
      and v.delivery_enabled and not (v.id = any (coalesce(p_hidden, '{}')))
      -- A road is never shorter than the straight line: no shop past the delivery limit as the crow flies can deliver.
      and extensions.st_dwithin(v.location, v_here, v_max_m)
    order by v.location operator(extensions.<->) v_here
    limit 40) c
  where not public.vendor_is_paused(c.id) and app_private.vendor_open_at(c.id);
  if v_ids is null then
    return null;
  end if;
  v_check := public.customer_delivery_check(p_customer_id, v_ids);
  return (
    select jsonb_build_object('vendor_id', v.id, 'vendor', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
      'item_id', i.id, 'item', coalesce(i.name_ar, i.name_en), 'item_en', coalesce(i.name_en, i.name_ar), 'quantity', v_qty,
      'price_usd', case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end)
    from jsonb_array_elements(coalesce(v_check -> 'vendors', '[]')) d
    join public.vendors v on v.id = (d ->> 'vendor_id')::uuid
    join lateral (
      select i.* from public.menu_items i join public.menu_item_nutrition nu on nu.item_id = i.id
      where i.vendor_id = v.id and nu.dish_id = v_dish and app_private.menu_item_orderable(i.id, 1)
      order by i.sort_order, i.id limit 1) i on true
    where d ->> 'status' = 'ok'
    order by (d ->> 'road_km')::numeric nulls last
    limit 1);
end;
$$;
revoke all on function app_private.cart_alternative(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;

-- What the customer's pin says for a shop: true (delivers), false (a definite no: beyond its radius), or null (no pin yet,
-- no recorded distance: checkout makes its one live call, §39.15.1).
create function app_private.cart_delivers(p_status text) returns boolean
language sql immutable set search_path = ''
as $$ select case p_status when 'ok' then true when 'beyond_radius' then false end $$;
revoke all on function app_private.cart_delivers(text) from public, anon, authenticated;

-- A cart the customer sent from the catalogue. A shop's saved cart from an earlier send is replaced by this send's items
-- of the same shop; other shops' saved carts stay. One orderable shop: {status: single, lines} (the bot merges those lines
-- as before). Several: every orderable shop's items are kept as a saved cart and the shops come back for the customer to
-- pick which one first, each with its item count, server subtotal, whether it delivers to the customer's pin and, on a
-- definite no, the closest open shop with the same dish (at most 10 rows are shown, so at most 10 are looked up). Items
-- of a shop that stopped taking orders are named as unavailable.
create function public.cart_split(p_customer_id uuid, p_message_id text, p_lines jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_live jsonb;
  v_unavailable jsonb;
  v_unavailable_en jsonb;
  v_check jsonb;
  v_place jsonb;
  v_hidden uuid[];
  v_hours numeric := coalesce(public.config_numeric('basket_keep_hours'), 24);
begin
  if p_message_id is null or char_length(p_message_id) > 200 then
    raise exception 'cart_split needs the message id' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.first_at), '[]') into v_groups from app_private.cart_groups(p_lines) g;
  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('status', 'unknown_items');
  end if;
  select coalesce(jsonb_agg(g order by (g ->> 'first_at')::bigint), '[]') into v_live
  from jsonb_array_elements(v_groups) g where (g ->> 'orderable')::boolean;
  select coalesce(jsonb_agg(n), '[]'), coalesce(jsonb_agg(ne), '[]') into v_unavailable, v_unavailable_en
  from jsonb_array_elements(v_groups) g
  cross join lateral jsonb_array_elements(g -> 'names') with ordinality a(n, k)
  join lateral (select e from jsonb_array_elements(g -> 'names_en') with ordinality b(e, j) where j = k) b2(ne) on true
  where not (g ->> 'orderable')::boolean;
  -- A shop sent again replaces that shop's saved cart from an earlier send (the newer items are what the customer wants
  -- from it); other shops' saved carts stay, and a "Do both" cart is never touched (the customer chose to keep it).
  update public.saved_carts set status = 'dropped'
  where customer_id = p_customer_id and status = 'saved' and source_message_id <> p_message_id
    and source_message_id not like 'both:%'
    and vendor_id in (select (g ->> 'vendor_id')::uuid from jsonb_array_elements(v_groups) g);
  if jsonb_array_length(v_live) <= 1 then
    return jsonb_build_object('status', case when jsonb_array_length(v_live) = 1 then 'single' else 'unavailable' end,
      'lines', coalesce(v_live -> 0 -> 'lines', '[]'), 'unavailable', v_unavailable, 'unavailable_en', v_unavailable_en);
  end if;
  insert into public.saved_carts (customer_id, vendor_id, lines, source_message_id, position, expires_at)
  select p_customer_id, (g ->> 'vendor_id')::uuid, g -> 'lines', p_message_id, (g ->> 'first_at')::int,
    now() + make_interval(hours => v_hours::int)
  from jsonb_array_elements(v_live) g
  on conflict (customer_id, source_message_id, vendor_id) do nothing;
  v_check := public.customer_delivery_check(p_customer_id,
    (select array_agg((g ->> 'vendor_id')::uuid) from jsonb_array_elements(v_live) g));
  v_hidden := app_private.customer_hidden_vendors(p_customer_id);
  select jsonb_build_object('place', p.name_ar, 'place_en', coalesce(p.name_en, p.name_ar)) into v_place
  from public.addresses a join public.places p on p.id = a.place_id
  where a.id = (public.customer_search_point(p_customer_id) ->> 'address_id')::uuid;
  return jsonb_build_object('status', 'split', 'place', v_place -> 'place', 'place_en', v_place -> 'place_en',
    'place_paused', v_check ->> 'status' = 'place_paused',
    'unavailable', v_unavailable, 'unavailable_en', v_unavailable_en,
    'shops', (
      select jsonb_agg(jsonb_build_object(
          'saved_cart_id', sc.id, 'vendor_id', v.id,
          'vendor', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
          'items', (select sum((l ->> 'quantity')::int) from jsonb_array_elements(g.g -> 'lines') l),
          'subtotal_usd', (select round(sum((l ->> 'quantity')::int
              * case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end), 2)
            from jsonb_array_elements(g.g -> 'lines') l join public.menu_items i on i.id = (l ->> 'item_id')::uuid),
          'delivers', case when v_check ->> 'status' = 'ok' then app_private.cart_delivers(d.status) end,
          'pickup_enabled', v.pickup_enabled,
          'delivery_status', coalesce(d.status, v_check ->> 'status'),
          -- Only a definite no gets an alternative, and only for the 10 rows the list can show.
          'alternative', case when v_check ->> 'status' = 'ok' and d.status = 'beyond_radius' and g.n <= 10
                              then app_private.cart_alternative(p_customer_id, v.id, g.g -> 'lines', v_hidden) end)
        order by g.n)
      from jsonb_array_elements(v_live) with ordinality g(g, n)
      join public.vendors v on v.id = (g.g ->> 'vendor_id')::uuid
      join public.saved_carts sc on sc.customer_id = p_customer_id and sc.source_message_id = p_message_id
        and sc.vendor_id = v.id
      left join lateral (select x ->> 'status' as status from jsonb_array_elements(coalesce(v_check -> 'vendors', '[]')) x
                         where (x ->> 'vendor_id')::uuid = v.id limit 1) d on true));
end;
$$;
revoke all on function public.cart_split(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.cart_split(uuid, text, jsonb) to service_role;

-- "Do both" (A first, B saved): the cart that met another shop's basket is kept as a saved cart. A replayed tap returns
-- the same cart and never reopens one already ordered.
create function public.saved_cart_save(p_customer_id uuid, p_message_id text, p_lines jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_vendor uuid;
begin
  if p_message_id is null or char_length(p_message_id) > 200 then
    raise exception 'saved_cart_save needs the message id' using errcode = 'invalid_parameter_value';
  end if;
  with ins as (
    insert into public.saved_carts (customer_id, vendor_id, lines, source_message_id, position, expires_at)
    select p_customer_id, g.vendor_id, g.lines, p_message_id, g.first_at::int,
      now() + make_interval(hours => coalesce(public.config_numeric('basket_keep_hours'), 24)::int)
    from app_private.cart_groups(p_lines) g where g.orderable
    on conflict (customer_id, source_message_id, vendor_id) do update set status = saved_carts.status
    returning id, vendor_id, position)
  select id, vendor_id into v_id, v_vendor from ins order by position limit 1;
  return case when v_id is null then jsonb_build_object('status', 'unavailable',
      'unavailable', (select coalesce(jsonb_agg(n), '[]') from app_private.cart_groups(p_lines) g, jsonb_array_elements(g.names) n
                      where not g.orderable),
      'unavailable_en', (select coalesce(jsonb_agg(n), '[]') from app_private.cart_groups(p_lines) g,
                         jsonb_array_elements(g.names_en) n where not g.orderable))
    else jsonb_build_object('status', 'saved', 'saved_cart_id', v_id,
      'delivers', (select app_private.cart_delivers(x ->> 'status')
                   from jsonb_array_elements(coalesce(public.customer_delivery_check(p_customer_id, array[v_vendor]) -> 'vendors',
                                                      '[]')) x limit 1),
      'vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_vendor),
      'vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_vendor)) end;
end;
$$;
revoke all on function public.saved_cart_save(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.saved_cart_save(uuid, text, jsonb) to service_role;

-- Takes one saved cart for ordering: its lines (the bot merges them as a cart) and marks it used by this message. The same
-- message again (a replayed turn) gets the same lines; another customer's cart, an expired one, one dropped or one taken by
-- another message gives nothing.
create function public.saved_cart_take(p_customer_id uuid, p_saved_cart_id uuid, p_message_id text) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  update public.saved_carts set status = 'used', taken_message_id = p_message_id
  where id = p_saved_cart_id and customer_id = p_customer_id and p_message_id is not null
    and ((status = 'saved' and expires_at > now()) or (status = 'used' and taken_message_id = p_message_id))
  returning jsonb_build_object('status', 'ok', 'lines', lines, 'vendor_id', vendor_id);
$$;
revoke all on function public.saved_cart_take(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.saved_cart_take(uuid, uuid, text) to service_role;

-- The customer's next saved cart (the oldest send first, then the cart's own order), offered after an order is confirmed;
-- never the shop just ordered from, never a shop with an open basket, never one that cannot deliver to the pin (a definite
-- no or a paused place), unless the customer is collecting (after a pickup order, any shop that takes pickup); null when
-- none is left.
create function public.saved_cart_next(p_customer_id uuid, p_exclude_vendor_id uuid default null,
  p_pickup boolean default false) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_check jsonb;
begin
  select array_agg(distinct sc.vendor_id) into v_ids from public.saved_carts sc
  where sc.customer_id = p_customer_id and sc.status = 'saved' and sc.expires_at > now();
  if v_ids is null then
    return null;
  end if;
  v_check := case when coalesce(p_pickup, false) then null else public.customer_delivery_check(p_customer_id, v_ids) end;
  return (
    select jsonb_build_object('saved_cart_id', sc.id, 'vendor_id', v.id,
      'vendor', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
      'items', (select sum((l ->> 'quantity')::int) from jsonb_array_elements(sc.lines) l))
    from public.saved_carts sc join public.vendors v on v.id = sc.vendor_id
    where sc.customer_id = p_customer_id and sc.status = 'saved' and sc.expires_at > now()
      and sc.vendor_id is distinct from p_exclude_vendor_id
      and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active'
      and case when coalesce(p_pickup, false) then v.pickup_enabled
          else coalesce(v_check ->> 'status', '') <> 'place_paused'
            and not exists (select 1 from jsonb_array_elements(coalesce(v_check -> 'vendors', '[]')) x
                            where (x ->> 'vendor_id')::uuid = sc.vendor_id and x ->> 'status' = 'beyond_radius') end
      and not exists (select 1 from public.baskets b where b.customer_id = p_customer_id and b.status = 'open'
                      and b.vendor_id = sc.vendor_id)
    order by sc.created_at, sc.position, sc.id
    limit 1);
end;
$$;
revoke all on function public.saved_cart_next(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.saved_cart_next(uuid, uuid, boolean) to service_role;

-- "No thanks": the saved cart is dropped (the customer can send the cart again from the catalogue).
create function public.saved_cart_drop(p_customer_id uuid, p_saved_cart_id uuid) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (update public.saved_carts set status = 'dropped'
             where id = p_saved_cart_id and customer_id = p_customer_id and status = 'saved' returning 1)
  select exists (select 1 from d);
$$;
revoke all on function public.saved_cart_drop(uuid, uuid) from public, anon, authenticated;
grant execute on function public.saved_cart_drop(uuid, uuid) to service_role;

-- The closest shop's same dish went into the basket in place of a shop that does not deliver: the one line it stands in
-- for (the cart's first line of that dish, the line cart_alternative took the dish and quantity from) leaves the shop's
-- saved cart; the shop's other items stay kept (the customer may collect them) and come back by name. A saved cart left
-- with nothing is dropped. When the alternative's shop has its own saved cart from the same send, its id comes back
-- (join_saved_cart_id) so the customer's own picks from that shop join the same basket.
create function public.saved_cart_swap(p_customer_id uuid, p_saved_cart_id uuid, p_item_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dish text := (select nu.dish_id from public.menu_item_nutrition nu where nu.item_id = p_item_id);
  v_sc public.saved_carts%rowtype;
  v_left jsonb;
  v_first bigint;
  v_join uuid;
begin
  select * into v_sc from public.saved_carts
  where id = p_saved_cart_id and customer_id = p_customer_id and status = 'saved' for update;
  if v_sc.id is null or v_dish is null then
    return null;
  end if;
  select min(t.n) into v_first
  from jsonb_array_elements(v_sc.lines) with ordinality t(l, n)
  join public.menu_item_nutrition nu on nu.item_id = (t.l ->> 'item_id')::uuid and nu.dish_id = v_dish;
  select coalesce(jsonb_agg(l order by n), '[]') into v_left
  from jsonb_array_elements(v_sc.lines) with ordinality t(l, n)
  where v_first is null or t.n <> v_first;
  select sc.id into v_join from public.saved_carts sc join public.menu_items i on i.id = p_item_id
  where sc.customer_id = p_customer_id and sc.source_message_id = v_sc.source_message_id and sc.vendor_id = i.vendor_id
    and sc.id <> v_sc.id and sc.status = 'saved' and sc.expires_at > now();
  if jsonb_array_length(v_left) = 0 then
    update public.saved_carts set status = 'dropped' where id = v_sc.id;
    return jsonb_build_object('status', 'dropped', 'names', '[]'::jsonb, 'names_en', '[]'::jsonb, 'join_saved_cart_id', v_join);
  end if;
  update public.saved_carts set lines = v_left where id = v_sc.id;
  return (
    select jsonb_build_object('status', 'kept', 'join_saved_cart_id', v_join,
      'vendor', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
      'names', jsonb_agg(coalesce(i.name_ar, i.name_en) order by t.n), 'names_en', jsonb_agg(coalesce(i.name_en, i.name_ar) order by t.n))
    from jsonb_array_elements(v_left) with ordinality t(l, n)
    join public.menu_items i on i.id = (t.l ->> 'item_id')::uuid
    join public.vendors v on v.id = v_sc.vendor_id
    group by v.id);
end;
$$;
revoke all on function public.saved_cart_swap(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.saved_cart_swap(uuid, uuid, uuid) to service_role;

-- Used and dropped carts go after a week, expired ones too: nothing is kept that will never be offered.
create function app_private.saved_carts_prune() returns integer
language sql volatile security definer set search_path = ''
as $$
  with d as (delete from public.saved_carts
             where (status <> 'saved' and created_at < now() - interval '7 days') or expires_at < now() - interval '1 day'
             returning 1)
  select count(*)::int from d;
$$;
revoke all on function app_private.saved_carts_prune() from public, anon, authenticated;
select cron.schedule('saved-carts-prune', '23 3 * * *', 'select app_private.saved_carts_prune()');

-- "Delete my data" also forgets the carts kept for later (otherwise as in 20261011100100).
create or replace function public.customer_forget(p_customer_id uuid, p_scope text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loc jsonb := null;
begin
  if p_scope not in ('history', 'all') then
    raise exception 'scope must be history or all' using errcode = 'invalid_parameter_value';
  end if;
  update public.customers set profile_reset_at = now() where id = p_customer_id;
  delete from public.customer_preferences where customer_id = p_customer_id;
  update public.bot_sessions set history = '[]', refs = '{}', pending = '{}', focus_vendor_id = null where customer_id = p_customer_id;
  if p_scope = 'all' then
    update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
    delete from public.saved_carts where customer_id = p_customer_id;
    v_loc := public.location_forget_customer(p_customer_id);
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now(), display_name = null
    where id = p_customer_id;
  end if;
  return jsonb_build_object('status', 'forgotten', 'scope', p_scope, 'location', v_loc);
end;
$$;

-- The items a cart could not take are named in the customer's language (§39.15.2: named, never "couldn't be added").
create or replace function public.cart_merge(p_customer_id uuid, p_message_id text, p_lines jsonb, p_replace boolean default false)
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
        'item', coalesce(v_item.name_ar, v_item.name_en), 'item_en', coalesce(v_item.name_en, v_item.name_ar)));
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
        'item', coalesce(v_item.name_ar, v_item.name_en), 'item_en', coalesce(v_item.name_en, v_item.name_ar)));
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'added', v_added, 'skipped', v_skipped, 'needs_options', v_needs,
    'diffs', v_diffs, 'basket', case when v_added > 0 or v_basket.id is not null then public.basket_view(p_customer_id) end);
end;
$$;
