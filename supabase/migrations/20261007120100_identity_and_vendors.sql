-- Phase 1a identity and tenancy (DECISIONS §3, §15, §17, §18): operators, customers, brands, vendors,
-- the vendors' private fields, merchant staff roles, and the helpers every row-level policy uses.
-- Session 2 (Phase 1b) adds places, town links and the seed import on top of these tables.

-- Enums -------------------------------------------------------------------------------------------------
create type public.business_type as enum (
  'restaurant', 'fast_food', 'cafe', 'bakery_manakish', 'sweets_pastry', 'ice_cream',
  'grocery_supermarket', 'minimarket', 'butcher', 'poultry', 'fish_market', 'produce',
  'roastery_nuts', 'home_essentials', 'other_food'
);
create type public.claim_status as enum ('unclaimed', 'pending', 'claimed', 'frozen');
create type public.listing_status as enum ('active', 'closed', 'moved', 'hidden');
create type public.member_status as enum ('invited', 'active', 'revoked');

-- Operators (Alo King staff: admin and operators) -------------------------------------------------------
create table public.operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.operator_role not null default 'operator',
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger operators_touch before update on public.operators
  for each row execute function app_private.touch_updated_at();
create trigger operators_audit after insert or update or delete on public.operators
  for each row execute function app_private.audit_row();

-- Policy helpers. Security definer so policies on one table can read another without recursion.
create function app_private.is_operator() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.operators o
    where o.user_id = (select auth.uid()) and o.active
  );
$$;

create function app_private.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.operators o
    where o.user_id = (select auth.uid()) and o.active and o.role = 'admin'
  );
$$;

-- Customers ---------------------------------------------------------------------------------------------
-- A customer is a WhatsApp number. `user_id` links the website login after phone verification.
-- The phone number never decides location or nationality (§22).
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  user_id uuid unique references auth.users (id) on delete set null,
  display_name text check (char_length(display_name) <= 80),
  language public.lang_code,
  marketing_opt_in boolean not null default false,
  marketing_opt_in_at timestamptz,
  marketing_opt_out_at timestamptz,
  last_inbound_at timestamptz,
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_opt_in_has_time check (not marketing_opt_in or marketing_opt_in_at is not null)
);
create trigger customers_touch before update on public.customers
  for each row execute function app_private.touch_updated_at();

-- Brands and vendors ------------------------------------------------------------------------------------
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text,
  name_en text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_has_name check (coalesce(name_ar, name_en) is not null)
);
create trigger brands_touch before update on public.brands
  for each row execute function app_private.touch_updated_at();
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function app_private.audit_row();

-- No rating or review columns exist anywhere (§15.1). Unclaimed vendors can never be public or orderable.
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar text,
  name_en text,
  name_fr text,
  branch_label text,
  business_type public.business_type not null,
  cuisine_tags text[] not null default '{}',
  claim_status public.claim_status not null default 'unclaimed',
  listing_status public.listing_status not null default 'active',
  orderable boolean not null default false,
  public_page boolean not null default false,
  -- Where the record came from: `seed_<yyyy>_<mm>` for imports, `google_live` for claim-time lookups,
  -- `merchant` or `admin` for records created by people.
  source text not null check (source ~ '^(seed_[0-9]{4}_[0-9]{2}|google_live|merchant|admin)$'),
  -- Per-field provenance: {"name_ar": "seed", "location": "merchant", ...}. A field stays "seed"
  -- until the merchant confirms or edits it (§15.1, §18.2).
  field_sources jsonb not null default '{}' check (jsonb_typeof(field_sources) = 'object'),
  place_id text unique,
  location extensions.geography(point, 4326),
  delivery_radius_km numeric(4, 1) check (delivery_radius_km > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_has_name check (coalesce(name_ar, name_en) is not null),
  constraint vendors_public_needs_claim check (not public_page or claim_status = 'claimed'),
  constraint vendors_orderable_needs_claim check (not orderable or (claim_status = 'claimed' and listing_status = 'active'))
);
create index vendors_brand_idx on public.vendors (brand_id) where brand_id is not null;
create index vendors_location_idx on public.vendors using gist (location);
create index vendors_public_idx on public.vendors (business_type) where public_page;
create trigger vendors_touch before update on public.vendors
  for each row execute function app_private.touch_updated_at();
create trigger vendors_audit after insert or update or delete on public.vendors
  for each row execute function app_private.audit_row();

-- Internal vendor fields: seed phone (used only to send a claim code), seed address, owner and kitchen
-- numbers. Never public (§15.2).
create table public.vendor_private (
  vendor_id uuid primary key references public.vendors (id) on delete cascade,
  phone_seed text check (phone_seed ~ '^\+[1-9][0-9]{6,14}$'),
  address_seed text,
  owner_mobile text check (owner_mobile ~ '^\+[1-9][0-9]{6,14}$'),
  kitchen_whatsapp text check (kitchen_whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger vendor_private_touch before update on public.vendor_private
  for each row execute function app_private.touch_updated_at();
create trigger vendor_private_audit after insert or update or delete on public.vendor_private
  for each row execute function app_private.audit_row();

-- A business that asked to be removed: only the place_id is kept, so it is never re-imported (§15.1, §18.1 K).
create table public.vendor_removed_places (
  place_id text primary key,
  removed_at timestamptz not null default now(),
  reason text not null
);

-- Merchant staff (§18.1 H). A row exists from the invitation (by phone) before the person has a login.
create table public.vendor_members (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  role public.member_role not null,
  status public.member_status not null default 'invited',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_members_phone_unique unique (vendor_id, phone_e164),
  constraint vendor_members_active_has_user check (status <> 'active' or user_id is not null)
);
create unique index vendor_members_user_unique on public.vendor_members (vendor_id, user_id) where user_id is not null;
create index vendor_members_user_idx on public.vendor_members (user_id) where status = 'active';
create trigger vendor_members_touch before update on public.vendor_members
  for each row execute function app_private.touch_updated_at();
create trigger vendor_members_audit after insert or update or delete on public.vendor_members
  for each row execute function app_private.audit_row();

create function app_private.has_vendor_role(p_vendor_id uuid, p_roles public.member_role[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vendor_members m
    where m.vendor_id = p_vendor_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create function app_private.is_vendor_member(p_vendor_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_vendor_role(p_vendor_id, enum_range(null::public.member_role));
$$;

revoke all on function app_private.is_operator() from public;
revoke all on function app_private.is_admin() from public;
revoke all on function app_private.has_vendor_role(uuid, public.member_role[]) from public;
revoke all on function app_private.is_vendor_member(uuid) from public;
grant execute on function app_private.is_operator() to anon, authenticated, service_role;
grant execute on function app_private.is_admin() to anon, authenticated, service_role;
grant execute on function app_private.has_vendor_role(uuid, public.member_role[]) to anon, authenticated, service_role;
grant execute on function app_private.is_vendor_member(uuid) to anon, authenticated, service_role;

-- Row-level security ------------------------------------------------------------------------------------
alter table public.operators enable row level security;
alter table public.customers enable row level security;
alter table public.brands enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_private enable row level security;
alter table public.vendor_removed_places enable row level security;
alter table public.vendor_members enable row level security;

revoke all on table public.operators, public.customers, public.brands, public.vendors, public.vendor_private,
  public.vendor_removed_places, public.vendor_members from public, anon, authenticated;
grant all on table public.operators, public.customers, public.brands, public.vendors, public.vendor_private,
  public.vendor_removed_places, public.vendor_members to service_role;

-- audit_log: operators read; nobody but triggers and the service role writes.
create policy audit_log_operator_read on public.audit_log for select to authenticated
  using ((select app_private.is_operator()));

-- operators: each operator sees itself; the admin manages the list.
grant select, insert, update, delete on table public.operators to authenticated;
create policy operators_self_read on public.operators for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.is_operator()));
create policy operators_admin_insert on public.operators for insert to authenticated
  with check ((select app_private.is_admin()));
create policy operators_admin_update on public.operators for update to authenticated
  using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy operators_admin_delete on public.operators for delete to authenticated
  using ((select app_private.is_admin()) and user_id <> (select auth.uid()));

-- customers: a logged-in customer reads its own row and may change only name and language.
-- Consent changes go through server RPCs that record the time (marketing rules, §18.3).
grant select on table public.customers to authenticated;
grant update (display_name, language) on table public.customers to authenticated;
create policy customers_self_read on public.customers for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.is_operator()));
create policy customers_self_update on public.customers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- brands: members of any branch and operators.
grant select on table public.brands to authenticated;
create policy brands_member_read on public.brands for select to authenticated
  using (
    (select app_private.is_operator())
    or exists (
      select 1 from public.vendors v
      where v.brand_id = brands.id and app_private.is_vendor_member(v.id)
    )
  );

-- vendors: clients read only these columns (never `select *`): no place_id, no coordinates.
-- Anyone sees vendors with a public page; members see their own vendor; operators see all.
-- Writes go through server RPCs with the merchant's confirming tap (§18.2), or operators.
grant select (id, brand_id, slug, name_ar, name_en, name_fr, branch_label, business_type, cuisine_tags,
  claim_status, listing_status, orderable, public_page, field_sources, delivery_radius_km, created_at, updated_at)
  on table public.vendors to anon, authenticated;
create policy vendors_public_read on public.vendors for select to anon, authenticated
  using (public_page and listing_status = 'active');
create policy vendors_member_read on public.vendors for select to authenticated
  using ((select app_private.is_operator()) or app_private.is_vendor_member(id));

-- vendor_private: owner and manager of that vendor, and operators. Read only from clients.
grant select on table public.vendor_private to authenticated;
create policy vendor_private_read on public.vendor_private for select to authenticated
  using (
    (select app_private.is_operator())
    or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[])
  );

-- vendor_removed_places: operators only.
grant select on table public.vendor_removed_places to authenticated;
create policy vendor_removed_places_operator_read on public.vendor_removed_places for select to authenticated
  using ((select app_private.is_operator()));

-- vendor_members: each person sees its own memberships; owner and manager see the vendor's team.
-- Invitations and role changes go through server RPCs (owner only, §18.1 H) or operators.
grant select on table public.vendor_members to authenticated;
create policy vendor_members_read on public.vendor_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select app_private.is_operator())
    or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[])
  );
