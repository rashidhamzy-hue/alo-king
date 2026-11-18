-- Alo King Chouf, session WH1a: bins, the shelf place of each item (docs/strategy/02-journeys.md, section 4, "Shelf locations").
-- A bin is a place on a shelf with a short code the staff write on it (A1, A2, C1...), in one storage zone, and a walk order: its place
-- in the walk through that zone. Each item has at most one bin at the hub, in its own zone (a chilled item lives in a chilled bin).
-- The pick list (0239) walks the zones in UX2a's order (0227: ambient, fresh, chilled, frozen) and, inside a zone, the bins in their walk
-- order; an item with no bin yet comes at the end of its zone, by name. Bins are data (invariant 13): made by an ops lead or an admin;
-- an item is moved to another bin by anyone who picks (the strategy's recovery: "item in the wrong bin: corrected at the next count").
-- Every move is kept in product_bin_log.

create table bins (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references sources(id),
  code        text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,11}$'),
  zone        storage_zone not null,
  walk_order  int not null check (walk_order > 0),
  is_active   boolean not null default true,
  created_by  uuid not null references parties(id),
  created_at  timestamptz not null default now()
);
create unique index bins_code_once on bins(source_id, upper(code));

create table product_bins (
  source_id   uuid not null references sources(id),
  product_id  uuid not null references products(id),
  bin_id      uuid not null references bins(id),
  set_by      uuid not null references parties(id),
  set_at      timestamptz not null default now(),
  primary key (source_id, product_id)
);
create index product_bins_bin on product_bins(bin_id);

create table product_bin_log (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references sources(id),
  product_id  uuid not null references products(id),
  from_bin    uuid references bins(id),
  to_bin      uuid references bins(id),
  by_party    uuid not null references parties(id),
  at          timestamptz not null default now()
);

-- The walk through the zones (0227's order). One place, so the pick list and the bins page agree.
create or replace function zone_walk_rank(p_zone storage_zone) returns int language sql immutable as $$
  select case p_zone when 'ambient' then 0 when 'fresh' then 1 when 'chilled' then 2 else 3 end $$;

create or replace function create_bin(p_source uuid, p_code text, p_zone text, p_by uuid, p_walk_order int default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_zone storage_zone; v_id uuid; v_order int;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_source and kind = 'dark_store') then raise exception 'NOT_A_STOCKED_SOURCE'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,11}$' then raise exception 'BIN_CODE letters, digits and a dash, up to 12'; end if;
  if p_zone is null or p_zone not in ('ambient', 'fresh', 'chilled', 'frozen') then raise exception 'UNKNOWN_ZONE %', p_zone; end if;
  v_zone := p_zone::storage_zone;
  if exists (select 1 from bins where source_id = p_source and upper(code) = v_code) then raise exception 'BIN_EXISTS %', v_code; end if;
  if p_walk_order is not null and p_walk_order < 1 then raise exception 'BAD_WALK_ORDER'; end if;
  v_order := coalesce(p_walk_order, (select coalesce(max(walk_order), 0) + 1 from bins where source_id = p_source and zone = v_zone));
  insert into bins(source_id, code, zone, walk_order, created_by) values (p_source, v_code, v_zone, v_order, p_by) returning id into v_id;
  return jsonb_build_object('ok', true, 'bin_id', v_id, 'code', v_code, 'walk_order', v_order);
end $$;

-- p_bin null takes the item off its bin.
create or replace function set_product_bin(p_source uuid, p_product uuid, p_bin uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_storage storage_zone; b bins%rowtype; v_from uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select storage into v_storage from products where id = p_product and owner_source_id is null;
  if v_storage is null then raise exception 'UNKNOWN_PRODUCT'; end if;
  select bin_id into v_from from product_bins where source_id = p_source and product_id = p_product for update;
  if p_bin is null then
    if v_from is null then return jsonb_build_object('ok', true, 'changed', false); end if;
    delete from product_bins where source_id = p_source and product_id = p_product;
  else
    select * into b from bins where id = p_bin and source_id = p_source and is_active;
    if not found then raise exception 'UNKNOWN_BIN'; end if;
    if b.zone <> v_storage then raise exception 'BIN_ZONE the item is %, the bin is %', v_storage, b.zone; end if;
    if v_from = p_bin then return jsonb_build_object('ok', true, 'changed', false, 'code', b.code); end if;
    insert into product_bins(source_id, product_id, bin_id, set_by) values (p_source, p_product, p_bin, p_by)
      on conflict (source_id, product_id) do update set bin_id = excluded.bin_id, set_by = excluded.set_by, set_at = now();
  end if;
  insert into product_bin_log(source_id, product_id, from_bin, to_bin, by_party) values (p_source, p_product, v_from, p_bin, p_by);
  return jsonb_build_object('ok', true, 'changed', true, 'code', b.code);
end $$;

create or replace function product_bin_code(p_source uuid, p_product uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select b.code from product_bins pb join bins b on b.id = pb.bin_id where pb.source_id = p_source and pb.product_id = p_product $$;

-- The bins in walking order with their items, and per zone how many active items have no bin yet.
create or replace function bins_overview(p_source uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'bins', coalesce((select jsonb_agg(jsonb_build_object('bin_id', b.id, 'code', b.code, 'zone', b.zone, 'walk_order', b.walk_order,
               'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', coalesce(p.name_ar, p.name_en))
                                    order by p.name_en) from product_bins pb join products p on p.id = pb.product_id
                                 where pb.bin_id = b.id), '[]'::jsonb))
             order by zone_walk_rank(b.zone), b.walk_order, b.code)
             from bins b where b.source_id = p_source and b.is_active), '[]'::jsonb),
    'unplaced', coalesce((select jsonb_object_agg(z.zone, z.n) from (
               select p.storage::text as zone, count(*) as n from products p
                where p.is_active and p.owner_source_id is null
                  and exists (select 1 from stock_levels sl where sl.source_id = p_source and sl.product_id = p.id)
                  and not exists (select 1 from product_bins pb where pb.source_id = p_source and pb.product_id = p.id)
                group by p.storage) z), '{}'::jsonb)) $$;

do $$ declare t text; r text;
begin
  foreach t in array array['bins', 'product_bins', 'product_bin_log'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
