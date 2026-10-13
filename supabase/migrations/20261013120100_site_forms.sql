-- Session 6b: what the website's claim, registration and driver forms need on the database side (DECISIONS §18, §24.3,
-- §37.4). The forms talk to the `site-claim` edge function, which holds the service role; nothing here is callable by
-- anonymous visitors or signed-in users except the operator read of driver applications.

-- 1. A small rate limiter for the website's anonymous forms ------------------------------------------------------
-- One counter per key (a hashed visitor address plus the action) in a sliding window that restarts when it expires.
-- The per-phone limit of claims (`claim_rate_ok`) stays; this one stops one visitor from sweeping the whole list.
create table app_private.web_rate (
  key text primary key check (char_length(key) between 3 and 120),
  window_start timestamptz not null default now(),
  hits integer not null default 1 check (hits >= 1)
);
revoke all on table app_private.web_rate from public, anon, authenticated;

create function public.web_rate_hit(p_key text, p_max integer, p_window_s integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_max < 1 or p_window_s < 1 then
    raise exception 'limit and window must be positive' using errcode = 'invalid_parameter_value';
  end if;
  insert into app_private.web_rate as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_s) then now() else r.window_start end,
    hits = case when r.window_start < now() - make_interval(secs => p_window_s) then 1 else r.hits + 1 end
  returning hits into v_hits;
  -- Housekeeping, one call in a hundred: counters older than two days mean nothing.
  if random() < 0.01 then
    delete from app_private.web_rate where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.web_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.web_rate_hit(text, integer, integer) to service_role;

-- One business the claimant has picked: the same columns as vendor_claim_search, plus whether it belongs to a brand
-- (a chain can be claimed as a whole). No phone beyond its last two digits, no coordinates.
create function public.vendor_claim_lookup(p_vendor_id uuid)
returns table (vendor_id uuid, name text, branch_label text, town text, claim_status public.claim_status,
  seed_phone_tail text, in_brand boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, coalesce(v.name_ar, v.name_en), v.branch_label, coalesce(p.name_ar, p.name_en), v.claim_status,
    app_private.phone_tail(vp.phone_seed), v.brand_id is not null
  from public.vendors v
  left join public.vendor_private vp on vp.vendor_id = v.id
  left join public.places p on p.id = v.town_id
  where v.id = p_vendor_id and v.listing_status <> 'hidden';
$$;
revoke all on function public.vendor_claim_lookup(uuid) from public, anon, authenticated;
grant execute on function public.vendor_claim_lookup(uuid) to service_role;

-- 2. Driver applications ------------------------------------------------------------------------------------------
-- Someone who wants to deliver for Alo King fills in the website's driver page. Rasheed reads the queue in the admin
-- page and replies on WhatsApp; nothing is automatic and no driver account exists until he approves (§21.3 is later).
create table public.driver_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 80),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  place text not null check (char_length(place) between 2 and 80),
  vehicle text not null check (vehicle in ('motorbike', 'car', 'bicycle', 'van')),
  has_licence boolean not null,
  languages text[] not null default '{}' check (languages <@ array['ar', 'en', 'fr']::text[]),
  availability text[] not null default '{}'
    check (availability <@ array['mornings', 'afternoons', 'evenings', 'nights', 'weekends']::text[]),
  note text check (note is null or char_length(note) <= 400),
  lang public.lang_code,
  status text not null default 'new' check (status in ('new', 'contacted', 'approved', 'rejected')),
  consent_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open application per number: applying again updates it instead of adding a row.
create unique index driver_applications_open_phone on public.driver_applications (phone_e164)
  where status in ('new', 'contacted');
create trigger driver_applications_touch before update on public.driver_applications
  for each row execute function app_private.touch_updated_at();
create trigger driver_applications_audit after insert or update or delete on public.driver_applications
  for each row execute function app_private.audit_row();

alter table public.driver_applications enable row level security;
revoke all on table public.driver_applications from public, anon, authenticated;
grant all on table public.driver_applications to service_role;
grant select on table public.driver_applications to authenticated;
create policy driver_applications_operator_read on public.driver_applications for select to authenticated
  using ((select app_private.is_operator()));

create function public.driver_apply(p_name text, p_phone text, p_place text, p_vehicle text, p_licence boolean,
  p_languages text[] default '{}', p_availability text[] default '{}', p_note text default null,
  p_lang public.lang_code default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing boolean;
begin
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.actor_kind', 'service', true);
  perform set_config('app.audit_reason', 'driver application (website)', true);
  v_existing := exists (select 1 from public.driver_applications a
    where a.phone_e164 = p_phone and a.status in ('new', 'contacted'));
  insert into public.driver_applications as d (full_name, phone_e164, place, vehicle, has_licence, languages,
    availability, note, lang)
  values (left(trim(p_name), 80), p_phone, left(trim(p_place), 80), p_vehicle, coalesce(p_licence, false),
    coalesce(p_languages, '{}'), coalesce(p_availability, '{}'), nullif(left(trim(p_note), 400), ''), p_lang)
  on conflict (phone_e164) where status in ('new', 'contacted') do update set
    full_name = excluded.full_name, place = excluded.place, vehicle = excluded.vehicle,
    has_licence = excluded.has_licence, languages = excluded.languages, availability = excluded.availability,
    note = excluded.note, lang = excluded.lang
  returning d.id into v_id;
  -- One line, no phone number: alerts are sent to chat apps.
  perform app_private.ops_alert('driver-application:' || v_id, 'driver_application', 'info',
    'Driver application: ' || left(trim(p_name), 40) || ' (' || p_vehicle || ', ' || left(trim(p_place), 40) || ')',
    null, null, jsonb_build_object('application_id', v_id));
  return jsonb_build_object('status', 'received', 'id', v_id, 'updated', v_existing);
end;
$$;
revoke all on function public.driver_apply(text, text, text, text, boolean, text[], text[], text, public.lang_code)
  from public, anon, authenticated;
grant execute on function public.driver_apply(text, text, text, text, boolean, text[], text[], text, public.lang_code)
  to service_role;

-- Rasheed moves an application along from the admin page.
create function app_private.driver_application_set_status(p_id uuid, p_status text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.is_operator() then
    raise exception 'operators only' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('new', 'contacted', 'approved', 'rejected') then
    raise exception 'unknown status' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.actor_kind', 'operator', true);
  update public.driver_applications set status = p_status, decided_by = (select auth.uid()), decided_at = now()
  where id = p_id;
end;
$$;
revoke all on function app_private.driver_application_set_status(uuid, text) from public, anon;
grant execute on function app_private.driver_application_set_status(uuid, text) to authenticated, service_role;
create function public.driver_application_set_status(p_id uuid, p_status text) returns void
language sql security invoker set search_path = ''
as $$ select app_private.driver_application_set_status(p_id, p_status) $$;
revoke all on function public.driver_application_set_status(uuid, text) from public, anon;
grant execute on function public.driver_application_set_status(uuid, text) to authenticated, service_role;

-- 3. Operators read claim documents from the admin page --------------------------------------------------------------
-- The documents sit in the private `claim-documents` bucket. Operators (and nobody else) may read them, through signed
-- URLs made by the admin page. Skipped where the storage schema does not exist (the CI database).
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "operators read claim documents" on storage.objects';
    execute $q$create policy "operators read claim documents" on storage.objects for select to authenticated
      using (bucket_id = 'claim-documents' and (select app_private.is_operator()))$q$;
  end if;
end;
$$;
