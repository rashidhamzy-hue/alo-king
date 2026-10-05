
-- ===== vendors: go-live gate =====
alter table public.vendors add column if not exists is_live boolean not null default false;

-- ===== orders: lifecycle columns =====
alter table public.orders
  add column if not exists driver_id uuid references auth.users(id),
  add column if not exists customer_name text,
  add column if not exists customer_lat numeric,
  add column if not exists customer_lng numeric,
  add column if not exists driver_lat numeric,
  add column if not exists driver_lng numeric,
  add column if not exists driver_location_at timestamptz,
  add column if not exists prep_minutes int,
  add column if not exists accepted_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists picked_up_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists cod_settled_at timestamptz,
  add column if not exists notes text,
  add column if not exists crowns_earned int not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists short_code text generated always as (upper(substr(replace(id::text,'-',''),1,6))) stored;

alter table public.orders drop constraint if exists orders_status_chk;
alter table public.orders add constraint orders_status_chk
  check (status in ('pending','accepted','preparing','ready','out_for_delivery','delivered','cancelled','rejected'));
alter table public.orders drop constraint if exists orders_payment_status_chk;
alter table public.orders add constraint orders_payment_status_chk
  check (payment_status in ('unpaid','collected','paid','refunded'));
alter table public.orders drop constraint if exists orders_payment_method_chk;
alter table public.orders add constraint orders_payment_method_chk
  check (payment_method in ('cod','card','whish','crowns'));
alter table public.orders drop constraint if exists orders_vendor_fk;
alter table public.orders add constraint orders_vendor_fk foreign key (vendor_id) references public.vendors(vendor_id);

create index if not exists orders_vendor_status_idx on public.orders(vendor_id, status);
create index if not exists orders_driver_idx on public.orders(driver_id) where driver_id is not null;
create index if not exists menu_items_vendor_idx on public.menu_items(vendor_id);
create index if not exists vendors_village_idx on public.vendors(village_canonical);

-- ===== staff roles =====
create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('merchant','driver','admin')),
  vendor_id text references public.vendors(vendor_id),
  display_name text,
  created_at timestamptz not null default now(),
  check (role <> 'merchant' or vendor_id is not null)
);
alter table public.staff_profiles enable row level security;
create policy "staff read own profile" on public.staff_profiles
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.staff_profiles where user_id = (select auth.uid()) $$;
create or replace function public.my_vendor() returns text
language sql stable security definer set search_path = public as
$$ select vendor_id from public.staff_profiles where user_id = (select auth.uid()) $$;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.my_vendor() from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.my_vendor() to authenticated;

-- ===== bot memory (service role only, RLS on, no policies) =====
create table if not exists public.conversations (
  id bigserial primary key,
  phone text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversations_phone_idx on public.conversations(phone, id desc);
alter table public.conversations enable row level security;

create table if not exists public.processed_messages (
  message_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.processed_messages enable row level security;

-- ===== orders trigger: timestamps, transition guard, COD cap =====
create or replace function public.orders_guard() returns trigger
language plpgsql set search_path = public as $$
declare held numeric; r text;
begin
  new.updated_at := now();
  r := public.my_role();  -- null for service role / no session
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if r = 'merchant' and new.status not in ('accepted','preparing','ready','rejected') then
        raise exception 'merchants cannot set status %', new.status;
      end if;
      if r = 'driver' and new.status not in ('out_for_delivery','delivered') then
        raise exception 'drivers cannot set status %', new.status;
      end if;
      if new.status = 'accepted'         and new.accepted_at  is null then new.accepted_at  := now(); end if;
      if new.status = 'ready'            and new.ready_at     is null then new.ready_at     := now(); end if;
      if new.status = 'out_for_delivery' and new.picked_up_at is null then new.picked_up_at := now(); end if;
      if new.status = 'delivered'        and new.delivered_at is null then new.delivered_at := now(); end if;
    end if;
    if r in ('merchant','driver') and (
         new.total_usd is distinct from old.total_usd or new.subtotal_usd is distinct from old.subtotal_usd
         or new.items is distinct from old.items or new.customer_phone is distinct from old.customer_phone
         or new.vendor_id is distinct from old.vendor_id) then
      raise exception 'order financials and contents are read-only for staff';
    end if;
    if new.driver_id is not null and new.driver_id is distinct from old.driver_id and new.payment_method = 'cod' then
      select coalesce(sum(total_usd),0) into held from public.orders
        where driver_id = new.driver_id and payment_method = 'cod' and cod_settled_at is null
          and status not in ('cancelled','rejected') and id <> new.id;
      if held + new.total_usd > 150 then
        raise exception 'COD cap of $150 exceeded for this driver (holding %)', held;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_guard_trg on public.orders;
create trigger orders_guard_trg before insert or update on public.orders
  for each row execute function public.orders_guard();

-- ===== RLS: public catalog (column-limited) =====
revoke select on public.vendors from anon, authenticated;
grant select (vendor_id,name_en,name_ar,category_canonical,village_canonical,address,latitude,longitude,
              open_days,open_time,close_time,menu_available,is_live,is_active)
  on public.vendors to anon, authenticated;
create policy "public read active vendors" on public.vendors
  for select to anon, authenticated using (is_active);

create policy "public read available menu" on public.menu_items
  for select to anon, authenticated
  using (available and exists (select 1 from public.vendors v where v.vendor_id = menu_items.vendor_id and v.is_active));

-- ===== RLS: orders by role =====
revoke all on public.orders from anon;
revoke update on public.orders from authenticated;
grant select on public.orders to authenticated;
grant update (status, prep_minutes, notes, driver_id, driver_lat, driver_lng, driver_location_at, payment_status, cod_settled_at)
  on public.orders to authenticated;

create policy "merchant reads own orders" on public.orders for select to authenticated
  using (public.my_role() = 'merchant' and vendor_id = public.my_vendor());
create policy "merchant updates own orders" on public.orders for update to authenticated
  using (public.my_role() = 'merchant' and vendor_id = public.my_vendor())
  with check (public.my_role() = 'merchant' and vendor_id = public.my_vendor());
create policy "driver reads open or own orders" on public.orders for select to authenticated
  using (public.my_role() = 'driver' and ((status = 'ready' and driver_id is null) or driver_id = (select auth.uid())));
create policy "driver updates claimed orders" on public.orders for update to authenticated
  using (public.my_role() = 'driver' and ((status = 'ready' and driver_id is null) or driver_id = (select auth.uid())))
  with check (public.my_role() = 'driver' and driver_id = (select auth.uid()));
create policy "admin all orders" on public.orders for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ===== public order tracking by unguessable uuid (no phone / address leaked) =====
create or replace function public.track_order(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'short_code', o.short_code, 'status', o.status, 'items', o.items,
    'subtotal_usd', o.subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'total_usd', o.total_usd,
    'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'delivery_village', o.delivery_village, 'is_expat_gift', o.is_expat_gift,
    'gift_sender_name', o.gift_sender_name, 'gift_message', o.gift_message,
    'prep_minutes', o.prep_minutes, 'created_at', o.created_at, 'accepted_at', o.accepted_at,
    'ready_at', o.ready_at, 'picked_up_at', o.picked_up_at, 'delivered_at', o.delivered_at,
    'vendor_name', v.name_en, 'vendor_lat', v.latitude, 'vendor_lng', v.longitude,
    'customer_lat', o.customer_lat, 'customer_lng', o.customer_lng,
    'driver_lat', case when o.status = 'out_for_delivery' then o.driver_lat end,
    'driver_lng', case when o.status = 'out_for_delivery' then o.driver_lng end,
    'driver_location_at', o.driver_location_at)
  from public.orders o left join public.vendors v on v.vendor_id = o.vendor_id
  where o.id = p_order_id $$;
grant execute on function public.track_order(uuid) to anon, authenticated;

-- ===== driver cash gauge =====
create or replace function public.driver_cash_on_hand() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(total_usd),0) from public.orders
  where driver_id = (select auth.uid()) and payment_method = 'cod' and cod_settled_at is null
    and status not in ('cancelled','rejected') $$;
revoke execute on function public.driver_cash_on_hand() from public, anon;
grant execute on function public.driver_cash_on_hand() to authenticated;

-- ===== realtime =====
alter table public.orders replica identity full;
