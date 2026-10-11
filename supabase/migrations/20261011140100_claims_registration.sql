-- Session 5 (DECISIONS §18, §32.8): claims and registration, one backend for the website and the Merchant
-- number. Contents:
--   1. config (code lifetime and attempts, objection window, report threshold)
--   2. tables: vendor_claims (cases A-I, L), merchant onboarding sessions, listing reports (J), business
--      requests from customers (M)
--   3. helpers: Lebanese mobile test, the login behind a WhatsApp number, claim codes (hash only)
--   4. claim search, start (A, B, C, G, I), code check, documents, operator decision, objection, tick
--   5. registration of a business we lack (E) and a live Google place (D); chains (F)
--   6. listing closed/moved/reported (J), removal (K), lost access (L), customer requests (M)
-- The places and vendor tables are only read, except the runtime fields a claim changes (claim_status,
-- listing_status, orderable, public_page) and new rows for registered businesses (§31 allows both: no
-- structure change, no data fix). No SQL from the research reports is used (§30, §32).

-- 1. Config ------------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §18, 11 October 2026 (session 5)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('claim_code_ttl_min', '15', '2026-10-11 00:00+03', 'A claim code sent to the shop''s own number is valid this long (DECISIONS §18.1 A, B)', null),
  ('claim_code_max_attempts', '5', '2026-10-11 00:00+03', 'Wrong claim codes before the claim moves to documents (DECISIONS §18.1 C)', null),
  ('claim_code_resend_s', '60', '2026-10-11 00:00+03', 'Shortest gap between two claim codes for one claim', null),
  ('claim_objection_hours', '72', '2026-10-11 00:00+03', 'The previous owner may object this long after a sale claim is approved (DECISIONS §18.1 I)', null),
  ('claim_stale_days', '14', '2026-10-11 00:00+03', 'An open claim with no progress expires after this many days', null),
  ('listing_report_hide_count', '3', '2026-10-11 00:00+03', 'Distinct customers reporting a listing closed or wrong within 30 days hide it until checked (DECISIONS §18.1 J)', null),
  ('claims_daily_per_phone', '5', '2026-10-11 00:00+03', 'New claims or registrations one WhatsApp number may start per day (abuse guard)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Tables ------------------------------------------------------------------------------------------------
create type public.claim_request_status as enum (
  'code_sent',          -- A/B: a code went to the shop's own number
  'awaiting_documents', -- C, E, F, G, I, L: the claimant sends documents
  'awaiting_member',    -- L: another active owner or manager confirms the new number with a tap
  'pending_review',     -- documents in, Rasheed decides (§18.1 C)
  'objection_window',   -- I: approved, the previous owner has 72 h to object
  'approved',
  'rejected',
  'waitlist',           -- E: a home kitchen without a registration document
  'expired',
  'cancelled'
);
create type public.claim_document_kind as enum ('registration', 'permit', 'company', 'sign_photo', 'id', 'other');

-- One claim or registration attempt. Codes are stored only as salted hashes; documents are WhatsApp or
-- storage media references (personal data: service role and operators only).
create table public.vendor_claims (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  claimant_phone text not null check (claimant_phone ~ '^\+[1-9][0-9]{6,14}$'),
  claimant_name text check (char_length(claimant_name) <= 80),
  claim_case text not null check (claim_case in ('A', 'B', 'C', 'D', 'E', 'F', 'I', 'L')),
  status public.claim_request_status not null,
  contested boolean not null default false,       -- G: two claimants, both frozen until Rasheed decides
  brand_wide boolean not null default false,      -- F: HQ proves the whole brand with a company document
  home_kitchen boolean not null default false,    -- E: needs a registration document, else waitlist
  code_hash text,
  code_salt text,
  code_channel text check (code_channel in ('whatsapp', 'voice')),
  code_expires_at timestamptz,
  code_sent_at timestamptz,
  code_attempts smallint not null default 0,
  documents jsonb not null default '[]' check (jsonb_typeof(documents) = 'array'),
  confirm_member_id uuid references public.vendor_members (id) on delete set null,  -- L
  objection_deadline timestamptz,
  member_id uuid references public.vendor_members (id) on delete set null,         -- created on approval
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  lang public.lang_code,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_claims_code_pair check ((code_hash is null) = (code_salt is null))
);
create index vendor_claims_vendor_idx on public.vendor_claims (vendor_id, created_at desc);
create index vendor_claims_phone_idx on public.vendor_claims (claimant_phone, created_at desc);
create index vendor_claims_open_idx on public.vendor_claims (status, updated_at)
  where status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window');
create unique index vendor_claims_one_open_per_phone on public.vendor_claims (vendor_id, claimant_phone)
  where status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window');
create trigger vendor_claims_touch before update on public.vendor_claims
  for each row execute function app_private.touch_updated_at();
create trigger vendor_claims_audit after insert or update or delete on public.vendor_claims
  for each row execute function app_private.audit_row();

-- The Merchant number's onboarding conversation (claim, registration, staff joining). One row per phone.
create table public.merchant_onboarding_sessions (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  step text not null check (char_length(step) <= 40),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  lang public.lang_code,
  updated_at timestamptz not null default now()
);

-- J: customers report a listing closed, moved or wrong. One row per customer, vendor and kind.
create table public.vendor_listing_reports (
  id bigint generated always as identity primary key,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind text not null check (kind in ('closed', 'moved', 'wrong')),
  created_at timestamptz not null default now(),
  constraint vendor_listing_reports_once unique (vendor_id, customer_id, kind)
);

-- M: a business customers ask for that we lack. A counter only; nobody ever messages the business.
create table public.vendor_requests (
  id bigint generated always as identity primary key,
  query_norm text not null check (char_length(query_norm) between 2 and 120),
  place_id text references public.places (id) on delete set null,
  sample text not null check (char_length(sample) <= 120),
  request_count integer not null default 1 check (request_count >= 1),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create unique index vendor_requests_key on public.vendor_requests (query_norm, coalesce(place_id, ''));

alter table public.vendor_claims enable row level security;
alter table public.merchant_onboarding_sessions enable row level security;
alter table public.vendor_listing_reports enable row level security;
alter table public.vendor_requests enable row level security;
revoke all on table public.vendor_claims, public.merchant_onboarding_sessions, public.vendor_listing_reports,
  public.vendor_requests from public, anon, authenticated;
grant all on table public.vendor_claims, public.merchant_onboarding_sessions, public.vendor_listing_reports,
  public.vendor_requests to service_role;
-- Operators review claims, reports and requests. Claimants see their claim through server functions only
-- (a claimant has no login until the claim is approved). Code hashes are never granted to clients.
grant select (id, vendor_id, claimant_phone, claimant_name, claim_case, status, contested, brand_wide, home_kitchen,
  code_channel, code_expires_at, code_attempts, documents, objection_deadline, member_id, decided_by, decided_at,
  decision_note, lang, created_at, updated_at) on table public.vendor_claims to authenticated;
create policy vendor_claims_operator_read on public.vendor_claims for select to authenticated
  using ((select app_private.is_operator()));
grant select on table public.vendor_listing_reports, public.vendor_requests to authenticated;
create policy vendor_listing_reports_operator_read on public.vendor_listing_reports for select to authenticated
  using ((select app_private.is_operator()));
create policy vendor_requests_operator_read on public.vendor_requests for select to authenticated
  using ((select app_private.is_operator()));

-- 3. Helpers -----------------------------------------------------------------------------------------------
-- Lebanese mobiles (§15.2): +961 3xxxxxx and +961 70/71/76/78/79/81 xxxxxx. Everything else is a landline.
create function app_private.is_lebanese_mobile(p_phone text) returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(p_phone ~ '^\+961(3[0-9]{6}|(70|71|76|78|79|81)[0-9]{6})$', false) $$;

-- The login behind a WhatsApp number: the one already linked to it, else an existing auth user with that
-- phone, else a new phone-confirmed one (the number proved itself by writing to us on WhatsApp). Active
-- members need a user (vendor_members). The link table keeps this working where auth.users has no phone
-- column (the CI database's auth stub).
create table app_private.phone_logins (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on table app_private.phone_logins from public, anon, authenticated;

create function app_private.auth_user_for_phone(p_phone text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_has_phone boolean := exists (select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'phone');
begin
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  select l.user_id into v_id from app_private.phone_logins l where l.phone_e164 = p_phone;
  if v_id is not null then
    return v_id;
  end if;
  if v_has_phone then
    execute 'select id from auth.users where phone = $1 limit 1' into v_id using ltrim(p_phone, '+');
  end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '{"provider": "phone", "providers": ["phone"]}', '{"source": "whatsapp_claim"}', now(), now());
    if v_has_phone then
      execute 'update auth.users set phone = $1, phone_confirmed_at = now() where id = $2' using ltrim(p_phone, '+'), v_id;
    end if;
  end if;
  insert into app_private.phone_logins (phone_e164, user_id) values (p_phone, v_id)
  on conflict (phone_e164) do nothing;
  select l.user_id into v_id from app_private.phone_logins l where l.phone_e164 = p_phone;
  return v_id;
end;
$$;
revoke all on function app_private.auth_user_for_phone(text) from public;

-- A fresh 6-digit code for a claim; only its salted hash is stored. Returns the plain code to the caller
-- (the server function that sends it), never to a client.
create function app_private.claim_new_code(p_claim_id uuid, p_channel text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  v_salt text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  update public.vendor_claims set
    code_salt = v_salt,
    code_hash = encode(extensions.digest(v_salt || v_code, 'sha256'), 'hex'),
    code_channel = p_channel,
    code_sent_at = now(),
    code_expires_at = now() + make_interval(mins => public.config_numeric('claim_code_ttl_min')::int),
    code_attempts = 0,
    status = 'code_sent'
  where id = p_claim_id;
  return v_code;
end;
$$;
revoke all on function app_private.claim_new_code(uuid, text) from public;

-- Masked phone for messages to a claimant ("…12"): never the full seed number (§15.2).
create function app_private.phone_tail(p_phone text) returns text
language sql immutable set search_path = ''
as $$ select case when p_phone is null then null else '…' || right(p_phone, 2) end $$;

-- A claimant may start only a few claims a day from one number.
create function app_private.claim_rate_ok(p_phone text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select count(*) < public.config_numeric('claims_daily_per_phone')
  from public.vendor_claims c where c.claimant_phone = p_phone and c.created_at > now() - interval '1 day';
$$;
revoke all on function app_private.claim_rate_ok(text) from public;

-- What the claimant still has to send (C, E, F, G, I, L): a registration, permit or company document, and
-- for a shop claim a photo of the sign. A home kitchen (E) needs the registration document itself.
create function app_private.claim_documents_missing(p_claim public.vendor_claims) returns text[]
language plpgsql immutable set search_path = ''
as $$
declare
  v_kinds text[] := array(select jsonb_array_elements(p_claim.documents) ->> 'kind');
  v_missing text[] := '{}';
begin
  if p_claim.brand_wide then
    if not 'company' = any (v_kinds) then v_missing := array_append(v_missing, 'company'); end if;
  elsif p_claim.home_kitchen then
    if not 'registration' = any (v_kinds) then v_missing := array_append(v_missing, 'registration'); end if;
  elsif not (v_kinds && array['registration', 'permit', 'company']) then
    v_missing := array_append(v_missing, 'registration');
  end if;
  if not p_claim.home_kitchen and not p_claim.brand_wide and not 'sign_photo' = any (v_kinds) then
    v_missing := array_append(v_missing, 'sign_photo');
  end if;
  return v_missing;
end;
$$;

-- 4. Claims ------------------------------------------------------------------------------------------------
-- Businesses a claimant may mean: name match (trigram on the normalised names), optionally near a town.
-- Returns no phone and no coordinates; `seed_phone_tail` lets the claimant recognise the shop's number.
create function public.vendor_claim_search(p_query text, p_town_id text default null, p_limit integer default 8)
returns table (vendor_id uuid, name text, branch_label text, town text, claim_status public.claim_status,
  seed_phone_tail text, score real)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, coalesce(v.name_ar, v.name_en), v.branch_label, coalesce(p.name_ar, p.name_en), v.claim_status,
    app_private.phone_tail(vp.phone_seed), s.score
  from public.vendors v
  left join public.vendor_private vp on vp.vendor_id = v.id
  left join public.places p on p.id = v.town_id
  cross join lateral (
    select greatest(
      extensions.similarity(app_private.normalize_place_name(coalesce(v.name_ar, '')), app_private.normalize_place_name(p_query)),
      extensions.similarity(app_private.normalize_place_name(coalesce(v.name_en, '')), app_private.normalize_place_name(p_query))
    ) + case when p_town_id is not null and v.town_id = p_town_id then 0.3 else 0 end as score
  ) s
  where v.listing_status <> 'hidden'
    and char_length(trim(coalesce(p_query, ''))) >= 2
    and s.score >= 0.25
  order by s.score desc, v.id
  limit least(greatest(coalesce(p_limit, 8), 1), 10);
$$;

-- Starts a claim on a vendor from a WhatsApp number (or the website, server-side). Decides the case:
--   already an owner -> nothing to do; another open claim by someone else -> G (both frozen, documents);
--   vendor claimed by someone else -> I (sale: documents, then 72 h objection window);
--   seed phone is a mobile -> A (code by WhatsApp to that number); landline -> B (voice call reads the code);
--   no seed phone -> C (documents).
-- Returns {"claim_id", "case", "status", "send": {"channel", "to", "code"}?, "phone_tail"?, "missing"?}.
-- `send` goes only to the calling server function, which delivers the code to the shop's own number.
create function public.claim_start(p_vendor_id uuid, p_phone text, p_name text default null,
  p_lang public.lang_code default null, p_case_hint text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor public.vendors%rowtype;
  v_seed text;
  v_claim public.vendor_claims%rowtype;
  v_other public.vendor_claims%rowtype;
  v_case text;
  v_code text;
  v_channel text;
begin
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id for update;
  if v_vendor.id is null then
    raise exception 'unknown vendor' using errcode = 'no_data_found';
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'claim start', true);

  if exists (select 1 from public.vendor_members m where m.vendor_id = p_vendor_id and m.phone_e164 = p_phone
             and m.status = 'active' and m.role = 'owner') then
    return jsonb_build_object('status', 'already_owner');
  end if;

  -- The same claimant continuing: return the open claim (a fresh code if the old one expired).
  select * into v_claim from public.vendor_claims c
  where c.vendor_id = p_vendor_id and c.claimant_phone = p_phone
    and c.status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window');
  if v_claim.id is not null then
    if v_claim.status = 'code_sent' and v_claim.code_expires_at < now()
       and v_claim.code_sent_at < now() - make_interval(secs => public.config_numeric('claim_code_resend_s')::int) then
      select vp.phone_seed into v_seed from public.vendor_private vp where vp.vendor_id = p_vendor_id;
      v_code := app_private.claim_new_code(v_claim.id, v_claim.code_channel);
      return jsonb_build_object('claim_id', v_claim.id, 'case', v_claim.claim_case, 'status', 'code_sent',
        'phone_tail', app_private.phone_tail(v_seed),
        'send', jsonb_build_object('channel', v_claim.code_channel, 'to', v_seed, 'code', v_code));
    end if;
    return jsonb_build_object('claim_id', v_claim.id, 'case', v_claim.claim_case, 'status', v_claim.status,
      'contested', v_claim.contested, 'missing', to_jsonb(app_private.claim_documents_missing(v_claim)));
  end if;

  if not app_private.claim_rate_ok(p_phone) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- G: someone else is already claiming this place. Both claims freeze and need documents.
  select * into v_other from public.vendor_claims c
  where c.vendor_id = p_vendor_id and c.claimant_phone <> p_phone
    and c.status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review')
  order by c.created_at limit 1;
  if v_other.id is not null or v_vendor.claim_status = 'frozen' then
    update public.vendor_claims set contested = true,
      status = case when status = 'pending_review' then status else 'awaiting_documents' end,
      code_hash = null, code_salt = null, code_expires_at = null
    where vendor_id = p_vendor_id and status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review');
    update public.vendors set claim_status = 'frozen' where id = p_vendor_id and claim_status <> 'claimed';
    insert into public.vendor_claims (vendor_id, claimant_phone, claimant_name, claim_case, status, contested, lang)
    values (p_vendor_id, p_phone, left(p_name, 80), 'C', 'awaiting_documents', true, p_lang)
    returning * into v_claim;
    perform app_private.ops_alert('claim-contested:' || p_vendor_id, 'claim_review', 'warning',
      'Two people are claiming ' || coalesce(v_vendor.name_en, v_vendor.name_ar) || ': both frozen until you decide',
      null, p_vendor_id, jsonb_build_object('claims', (select jsonb_agg(c.id) from public.vendor_claims c
        where c.vendor_id = p_vendor_id and c.contested and c.status not in ('rejected', 'cancelled', 'expired'))));
    return jsonb_build_object('claim_id', v_claim.id, 'case', 'G', 'status', 'awaiting_documents', 'contested', true,
      'missing', to_jsonb(app_private.claim_documents_missing(v_claim)));
  end if;

  -- I: the business is already claimed by someone else (sold, new owner).
  if v_vendor.claim_status = 'claimed' then
    insert into public.vendor_claims (vendor_id, claimant_phone, claimant_name, claim_case, status, lang)
    values (p_vendor_id, p_phone, left(p_name, 80), 'I', 'awaiting_documents', p_lang)
    returning * into v_claim;
    return jsonb_build_object('claim_id', v_claim.id, 'case', 'I', 'status', 'awaiting_documents',
      'missing', to_jsonb(app_private.claim_documents_missing(v_claim)));
  end if;

  select vp.phone_seed into v_seed from public.vendor_private vp where vp.vendor_id = p_vendor_id;
  v_case := case
    when p_case_hint = 'C' or v_seed is null then 'C'
    when app_private.is_lebanese_mobile(v_seed) then 'A'
    else 'B' end;
  -- A business created from a live Google lookup keeps D as its case; the method is still A, B or C.
  insert into public.vendor_claims (vendor_id, claimant_phone, claimant_name, claim_case, status, lang)
  values (p_vendor_id, p_phone, left(p_name, 80),
          case when v_vendor.source = 'google_live' and p_case_hint = 'D' then 'D' else v_case end,
          'awaiting_documents', p_lang)
  returning * into v_claim;
  update public.vendors set claim_status = 'pending' where id = p_vendor_id and claim_status = 'unclaimed';

  if v_case = 'C' then
    return jsonb_build_object('claim_id', v_claim.id, 'case', v_claim.claim_case, 'status', 'awaiting_documents',
      'missing', to_jsonb(app_private.claim_documents_missing(v_claim)));
  end if;
  v_channel := case when v_case = 'A' then 'whatsapp' else 'voice' end;
  v_code := app_private.claim_new_code(v_claim.id, v_channel);
  return jsonb_build_object('claim_id', v_claim.id, 'case', v_claim.claim_case, 'status', 'code_sent',
    'phone_tail', app_private.phone_tail(v_seed),
    'send', jsonb_build_object('channel', v_channel, 'to', v_seed, 'code', v_code));
end;
$$;

-- Approves a claim: the claimant becomes the active owner (with a phone login), the vendor is claimed and
-- every seed field still shows "please confirm" (§18.2: field_sources stay "seed" until confirmed).
create function app_private.claim_approve(p_claim_id uuid, p_operator uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
  v_user uuid;
  v_member uuid;
  v_vendor public.vendors%rowtype;
  v_branch uuid;
begin
  select * into v_claim from public.vendor_claims where id = p_claim_id for update;
  select * into v_vendor from public.vendors where id = v_claim.vendor_id for update;
  v_user := app_private.auth_user_for_phone(v_claim.claimant_phone);
  perform set_config('app.audit_reason', 'claim ' || p_claim_id || ' approved', true);

  -- I and L: the new owner replaces the members the claim names (I: every previous member; L: none).
  if v_claim.claim_case = 'I' then
    update public.vendor_members set status = 'revoked'
    where vendor_id = v_claim.vendor_id and phone_e164 <> v_claim.claimant_phone and status <> 'revoked';
  end if;

  insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status)
  values (v_claim.vendor_id, v_user, v_claim.claimant_phone, 'owner', 'active')
  on conflict (vendor_id, phone_e164) do update set user_id = excluded.user_id, role = 'owner', status = 'active'
  returning id into v_member;

  update public.vendors set claim_status = 'claimed' where id = v_claim.vendor_id;
  -- F: an approved company document makes the claimant owner of every unclaimed branch of the brand.
  if v_claim.brand_wide and v_vendor.brand_id is not null then
    for v_branch in
      select v.id from public.vendors v
      where v.brand_id = v_vendor.brand_id and v.id <> v_vendor.id and v.claim_status in ('unclaimed', 'pending')
    loop
      insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status)
      values (v_branch, v_user, v_claim.claimant_phone, 'owner', 'active')
      on conflict (vendor_id, phone_e164) do update set user_id = excluded.user_id, role = 'owner', status = 'active';
      update public.vendors set claim_status = 'claimed' where id = v_branch;
    end loop;
  end if;

  update public.vendor_claims set status = 'approved', member_id = v_member, decided_at = now(),
    decided_by = coalesce(p_operator, decided_by), code_hash = null, code_salt = null
  where id = p_claim_id;
  -- Every other open claim on this vendor ends here.
  update public.vendor_claims set status = 'rejected', decided_at = now(),
    decision_note = coalesce(decision_note, 'another claim was approved')
  where vendor_id = v_claim.vendor_id and id <> p_claim_id
    and status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window');

  perform public.app_reply(v_claim.claimant_phone, jsonb_build_object('text', case coalesce(v_claim.lang, 'ar')
    when 'en' then '✅ ' || coalesce(v_vendor.name_en, v_vendor.name_ar) || ' is yours on Alo King. Next: confirm your details and add your menu. Reply "menu" to start.'
    when 'fr' then '✅ ' || coalesce(v_vendor.name_en, v_vendor.name_ar) || ' est à vous sur Alo King. Ensuite : confirmez vos infos et ajoutez votre menu. Répondez « menu ».'
    else '✅ صار ' || coalesce(v_vendor.name_ar, v_vendor.name_en) || ' إلك على Alo King. الخطوة الجاية: أكّد المعلومات وزيد المنيو. ابعت «منيو» لنبلّش.' end),
    'claim-approved:' || p_claim_id);
  return jsonb_build_object('status', 'approved', 'claim_id', p_claim_id, 'vendor_id', v_claim.vendor_id,
    'member_id', v_member);
end;
$$;
revoke all on function app_private.claim_approve(uuid, uuid) from public;

-- The claimant types the code. Five wrong codes (config) move the claim to documents (C).
create function public.claim_verify_code(p_phone text, p_code text, p_claim_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
begin
  select * into v_claim from public.vendor_claims c
  where c.claimant_phone = p_phone and c.status = 'code_sent' and (p_claim_id is null or c.id = p_claim_id)
  order by c.code_sent_at desc limit 1
  for update;
  if v_claim.id is null then
    return jsonb_build_object('status', 'no_claim');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  if v_claim.code_expires_at < now() then
    return jsonb_build_object('status', 'expired', 'claim_id', v_claim.id);
  end if;
  if p_code ~ '^[0-9]{6}$'
     and encode(extensions.digest(v_claim.code_salt || p_code, 'sha256'), 'hex') = v_claim.code_hash then
    return app_private.claim_approve(v_claim.id);
  end if;
  update public.vendor_claims set code_attempts = code_attempts + 1 where id = v_claim.id;
  if v_claim.code_attempts + 1 >= public.config_numeric('claim_code_max_attempts') then
    update public.vendor_claims set status = 'awaiting_documents', code_hash = null, code_salt = null,
      code_expires_at = null where id = v_claim.id;
    return jsonb_build_object('status', 'locked', 'claim_id', v_claim.id,
      'missing', to_jsonb(array['registration', 'sign_photo']));
  end if;
  return jsonb_build_object('status', 'wrong_code', 'claim_id', v_claim.id,
    'left', public.config_numeric('claim_code_max_attempts')::int - v_claim.code_attempts - 1);
end;
$$;

-- "The number is wrong / I can't receive it": the claimant switches a code claim to documents (C).
create function public.claim_use_documents(p_phone text, p_claim_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
begin
  update public.vendor_claims set status = 'awaiting_documents', claim_case = case when claim_case in ('A', 'B') then 'C' else claim_case end,
    code_hash = null, code_salt = null, code_expires_at = null
  where id = p_claim_id and claimant_phone = p_phone and status = 'code_sent'
  returning * into v_claim;
  if v_claim.id is null then
    return jsonb_build_object('status', 'no_claim');
  end if;
  return jsonb_build_object('status', 'awaiting_documents', 'claim_id', v_claim.id,
    'missing', to_jsonb(app_private.claim_documents_missing(v_claim)));
end;
$$;

-- A document for the claimant's open claim (media reference from WhatsApp or storage path from the site).
-- When nothing is missing the claim goes to Rasheed (an ops alert; Slack #claims in session 5b).
create function public.claim_add_document(p_phone text, p_kind public.claim_document_kind, p_media_ref text,
  p_mime text default null, p_claim_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
  v_missing text[];
  v_vendor public.vendors%rowtype;
begin
  if p_media_ref is null or char_length(p_media_ref) not between 1 and 300 then
    raise exception 'media reference required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_claim from public.vendor_claims c
  where c.claimant_phone = p_phone and c.status = 'awaiting_documents' and (p_claim_id is null or c.id = p_claim_id)
  order by c.updated_at desc limit 1
  for update;
  if v_claim.id is null then
    return jsonb_build_object('status', 'no_claim');
  end if;
  if jsonb_array_length(v_claim.documents) >= 10 then
    return jsonb_build_object('status', 'too_many', 'claim_id', v_claim.id);
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  update public.vendor_claims set documents = documents || jsonb_build_array(jsonb_build_object(
      'kind', p_kind, 'ref', p_media_ref, 'mime', left(p_mime, 80), 'at', now()))
  where id = v_claim.id
  returning * into v_claim;
  v_missing := app_private.claim_documents_missing(v_claim);
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('status', 'awaiting_documents', 'claim_id', v_claim.id, 'missing', to_jsonb(v_missing));
  end if;
  update public.vendor_claims set status = 'pending_review' where id = v_claim.id;
  select * into v_vendor from public.vendors where id = v_claim.vendor_id;
  perform app_private.ops_alert('claim-review:' || v_claim.id, 'claim_review', 'info',
    'Claim to review: ' || coalesce(v_vendor.name_en, v_vendor.name_ar) || ' (case ' || v_claim.claim_case
      || case when v_claim.contested then ', contested' else '' end || ')',
    null, v_claim.vendor_id, jsonb_build_object('claim_id', v_claim.id));
  return jsonb_build_object('status', 'pending_review', 'claim_id', v_claim.id);
end;
$$;

-- E: a home kitchen that sent everything except a registration document joins the waitlist instead
-- (the lawyer confirms the rule, §18.1 E). Called when the claimant says it has none.
create function public.claim_no_registration(p_phone text, p_claim_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.vendor_claims set status = 'waitlist'
  where id = p_claim_id and claimant_phone = p_phone and home_kitchen and status = 'awaiting_documents'
  returning id into v_id;
  return jsonb_build_object('status', case when v_id is null then 'no_claim' else 'waitlist' end);
end;
$$;

-- Rasheed decides (admin page now; Slack #claims and WhatsApp admin commands in session 5b call the same
-- function). Approving a sale (I) opens the 72-hour objection window and tells the previous owner.
create function app_private.claim_decide(p_claim_id uuid, p_approve boolean, p_note text, p_operator uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
  v_vendor public.vendors%rowtype;
  v_owner record;
begin
  select * into v_claim from public.vendor_claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'unknown claim' using errcode = 'no_data_found';
  end if;
  if v_claim.status not in ('pending_review', 'awaiting_documents', 'awaiting_member', 'code_sent') then
    return jsonb_build_object('status', v_claim.status);
  end if;
  perform set_config('app.actor_kind', 'operator', true);
  perform set_config('app.audit_reason', 'claim ' || p_claim_id || case when p_approve then ' approved' else ' rejected' end
    || coalesce(': ' || left(p_note, 200), ''), true);
  select * into v_vendor from public.vendors where id = v_claim.vendor_id;
  if not p_approve then
    update public.vendor_claims set status = 'rejected', decided_by = p_operator, decided_at = now(),
      decision_note = left(p_note, 500), code_hash = null, code_salt = null
    where id = p_claim_id;
    -- An unfrozen vendor goes back to unclaimed when nobody else is claiming it.
    if not exists (select 1 from public.vendor_claims c where c.vendor_id = v_claim.vendor_id
                   and c.status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window')) then
      update public.vendors set claim_status = 'unclaimed' where id = v_claim.vendor_id and claim_status in ('pending', 'frozen');
    end if;
    perform public.app_reply(v_claim.claimant_phone, jsonb_build_object('text', case coalesce(v_claim.lang, 'ar')
      when 'en' then 'We could not confirm your claim for ' || coalesce(v_vendor.name_en, v_vendor.name_ar) || '. Rasheed from Alo King will explain; reply here with any question.'
      when 'fr' then 'Nous n''avons pas pu confirmer votre demande pour ' || coalesce(v_vendor.name_en, v_vendor.name_ar) || '. Rasheed d''Alo King vous expliquera ; répondez ici.'
      else 'ما قدرنا نأكّد طلبك على ' || coalesce(v_vendor.name_ar, v_vendor.name_en) || '. رشيد من Alo King رح يشرحلك، ابعتلنا هون إذا عندك سؤال.' end),
      'claim-rejected:' || p_claim_id);
    return jsonb_build_object('status', 'rejected');
  end if;
  if v_claim.claim_case = 'I' then
    update public.vendor_claims set status = 'objection_window', decided_by = p_operator, decided_at = now(),
      decision_note = left(p_note, 500),
      objection_deadline = now() + make_interval(hours => public.config_numeric('claim_objection_hours')::int)
    where id = p_claim_id;
    for v_owner in
      select m.phone_e164 from public.vendor_members m
      where m.vendor_id = v_claim.vendor_id and m.status = 'active' and m.role in ('owner', 'manager')
    loop
      perform public.app_reply(v_owner.phone_e164, jsonb_build_object('interactive', jsonb_build_object(
        'type', 'button',
        'body', jsonb_build_object('text', left('⚠️ Someone says they are the new owner of ' || coalesce(v_vendor.name_ar, v_vendor.name_en)
          || '. If this is wrong, tap Object within ' || public.config_numeric('claim_objection_hours')::int
          || ' hours. / حدا عم يقول إنو صار صاحب المحل. إذا مش صحيح، اكبس «اعتراض».', 1024)),
        'action', jsonb_build_object('buttons', jsonb_build_array(jsonb_build_object('type', 'reply',
          'reply', jsonb_build_object('id', 'CLM|OBJ|' || p_claim_id, 'title', 'اعتراض · Object')))))),
        'claim-objection:' || p_claim_id || ':' || v_owner.phone_e164);
    end loop;
    return jsonb_build_object('status', 'objection_window');
  end if;
  return app_private.claim_approve(p_claim_id, p_operator);
end;
$$;
revoke all on function app_private.claim_decide(uuid, boolean, text, uuid) from public;

-- Callable by a signed-in operator, or by the server for an operator it has identified (Slack, WhatsApp).
create function public.claim_decide(p_claim_id uuid, p_approve boolean, p_note text default null,
  p_operator_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op uuid := coalesce((select auth.uid()), p_operator_user_id);
begin
  if (select auth.uid()) is not null and p_operator_user_id is not null then
    raise exception 'a signed-in caller cannot act for another operator' using errcode = 'insufficient_privilege';
  end if;
  if v_op is null or not exists (select 1 from public.operators o where o.user_id = v_op and o.active)
     or ((select auth.uid()) is null and not app_private.caller_is_server()) then
    raise exception 'operators only' using errcode = 'insufficient_privilege';
  end if;
  return app_private.claim_decide(p_claim_id, p_approve, p_note, v_op);
end;
$$;

-- I: the previous owner objects within the window: the claim and the vendor freeze for Rasheed.
create function public.claim_object(p_phone text, p_claim_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
begin
  select * into v_claim from public.vendor_claims where id = p_claim_id for update;
  if v_claim.id is null or v_claim.status <> 'objection_window' or v_claim.objection_deadline < now() then
    return jsonb_build_object('status', 'too_late');
  end if;
  if not exists (select 1 from public.vendor_members m where m.vendor_id = v_claim.vendor_id and m.phone_e164 = p_phone
                 and m.status = 'active' and m.role in ('owner', 'manager')) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'previous owner objected to claim ' || p_claim_id, true);
  update public.vendor_claims set status = 'pending_review', contested = true, objection_deadline = null
  where id = p_claim_id;
  perform app_private.ops_alert('claim-objection:' || p_claim_id, 'claim_review', 'urgent',
    'The owner objected to a sale claim: decide with documents from both sides', null, v_claim.vendor_id,
    jsonb_build_object('claim_id', p_claim_id));
  return jsonb_build_object('status', 'objected');
end;
$$;

-- Every minute: sale claims past their objection window are approved; codes and stale claims expire.
create function app_private.claims_tick() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  n_approved int := 0;
  n_expired int := 0;
begin
  perform set_config('app.actor_kind', 'system', true);
  for v_id in
    select c.id from public.vendor_claims c where c.status = 'objection_window' and c.objection_deadline <= now()
    for update skip locked
  loop
    perform app_private.claim_approve(v_id);
    n_approved := n_approved + 1;
  end loop;
  with x as (
    update public.vendor_claims set status = 'expired', code_hash = null, code_salt = null
    where status in ('code_sent', 'awaiting_documents', 'awaiting_member')
      and updated_at < now() - make_interval(days => public.config_numeric('claim_stale_days')::int)
    returning vendor_id
  )
  select count(*) into n_expired from x;
  update public.vendors v set claim_status = 'unclaimed'
  where v.claim_status = 'pending'
    and not exists (select 1 from public.vendor_claims c where c.vendor_id = v.id
                    and c.status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window'));
  return jsonb_build_object('approved', n_approved, 'expired', n_expired);
end;
$$;
revoke all on function app_private.claims_tick() from public;
select cron.schedule('claims-tick', '* * * * *', 'select app_private.claims_tick()');

-- The claimant's open claims (for the bot and the website status page).
create function public.claims_for_phone(p_phone text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.id, 'vendor_id', c.vendor_id,
    'vendor_name', coalesce(v.name_ar, v.name_en), 'case', c.claim_case, 'status', c.status,
    'contested', c.contested, 'home_kitchen', c.home_kitchen,
    'missing', to_jsonb(app_private.claim_documents_missing(c))) order by c.updated_at desc), '[]')
  from public.vendor_claims c join public.vendors v on v.id = c.vendor_id
  where c.claimant_phone = p_phone
    and c.status in ('code_sent', 'awaiting_documents', 'awaiting_member', 'pending_review', 'objection_window', 'waitlist');
$$;

-- 5. Registration (E), live Google place (D), chains (F) ----------------------------------------------------
create function app_private.new_vendor_slug(p_name text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(coalesce(extensions.unaccent(p_name), '')), '[^a-z0-9]+', '-', 'g'));
  v_slug text;
begin
  if v_base = '' then v_base := 'business'; end if;
  v_base := left(v_base, 40);
  loop
    v_slug := v_base || '-' || encode(extensions.gen_random_bytes(3), 'hex');
    exit when not exists (select 1 from public.vendors where slug = v_slug);
  end loop;
  return v_slug;
end;
$$;

-- E: a business not in our list and not on Google registers itself: name, type, pin, then documents.
-- It starts pending, not orderable and not public; Rasheed approves after the documents.
create function public.vendor_register(p_phone text, p_name_ar text, p_name_en text,
  p_business_type public.business_type, p_lat double precision, p_lon double precision,
  p_home_kitchen boolean default false, p_lang public.lang_code default null, p_brand_wide boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_claim public.vendor_claims%rowtype;
begin
  if p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(nullif(trim(p_name_ar), ''), nullif(trim(p_name_en), '')) is null
     or char_length(coalesce(p_name_ar, '') || coalesce(p_name_en, '')) > 160 then
    raise exception 'a business name (up to 80 characters) is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_lat is null or p_lon is null or p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7 then
    raise exception 'the pin must be in Lebanon' using errcode = 'invalid_parameter_value';
  end if;
  if not app_private.claim_rate_ok(p_phone) then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'registration (case E)', true);
  insert into public.vendors (slug, name_ar, name_en, business_type, claim_status, source, field_sources, location)
  values (app_private.new_vendor_slug(coalesce(nullif(trim(p_name_en), ''), p_name_ar)),
          nullif(left(trim(p_name_ar), 80), ''), nullif(left(trim(p_name_en), 80), ''), p_business_type, 'pending', 'merchant',
          jsonb_build_object('name_ar', 'merchant', 'name_en', 'merchant', 'business_type', 'merchant', 'location', 'merchant'),
          extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography)
  returning id into v_vendor;
  insert into public.vendor_private (vendor_id, owner_mobile) values (v_vendor, p_phone);
  insert into public.vendor_claims (vendor_id, claimant_phone, claim_case, status, home_kitchen, brand_wide, lang)
  values (v_vendor, p_phone, case when p_brand_wide then 'F' else 'E' end, 'awaiting_documents',
          coalesce(p_home_kitchen, false), coalesce(p_brand_wide, false), p_lang)
  returning * into v_claim;
  return jsonb_build_object('status', 'awaiting_documents', 'vendor_id', v_vendor, 'claim_id', v_claim.id,
    'case', v_claim.claim_case, 'missing', to_jsonb(app_private.claim_documents_missing(v_claim)));
end;
$$;

-- D: a business on Google but not in our list. The server function looked it up live with the server key
-- (§15.1); this stores the minimum, marked google_live with every field "please confirm". A place someone
-- asked us to remove (K) is never re-created.
create function public.vendor_from_google(p_place_id text, p_name text, p_lat double precision, p_lon double precision,
  p_business_type public.business_type, p_phone text default null, p_address text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_place_id is null or p_place_id !~ '^[A-Za-z0-9_-]{10,255}$' then
    raise exception 'invalid Google place id' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.vendor_removed_places r where r.place_id = p_place_id) then
    return jsonb_build_object('status', 'removed');
  end if;
  select v.id into v_id from public.vendors v where v.place_id = p_place_id;
  if v_id is not null then
    return jsonb_build_object('status', 'exists', 'vendor_id', v_id);
  end if;
  if p_lat is null or p_lon is null or p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7 then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  perform set_config('app.actor_kind', 'service', true);
  perform set_config('app.audit_reason', 'live Google lookup (case D)', true);
  insert into public.vendors (slug, name_ar, name_en, business_type, source, field_sources, place_id, location)
  values (app_private.new_vendor_slug(p_name),
          case when p_name ~ '[؀-ۿ]' then left(p_name, 80) end,
          case when p_name !~ '[؀-ۿ]' then left(p_name, 80) end,
          p_business_type, 'google_live',
          jsonb_build_object('name_ar', 'seed', 'name_en', 'seed', 'business_type', 'seed', 'location', 'seed', 'town_id', 'seed'),
          p_place_id, extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography)
  returning id into v_id;
  insert into public.vendor_private (vendor_id, phone_seed, address_seed)
  values (v_id, case when p_phone ~ '^\+[1-9][0-9]{6,14}$' then p_phone end, left(p_address, 300));
  return jsonb_build_object('status', 'created', 'vendor_id', v_id);
end;
$$;

-- F: an owner whose brand-wide claim was approved adds a branch (pin, name suffix); it is claimed at once.
create function public.vendor_branch_add(p_member_id uuid, p_branch_label text, p_lat double precision, p_lon double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.vendor_members%rowtype;
  v_src public.vendors%rowtype;
  v_id uuid;
begin
  select * into v_m from public.vendor_members where id = p_member_id and status = 'active' and role = 'owner';
  select * into v_src from public.vendors where id = v_m.vendor_id;
  if v_m.id is null or v_src.brand_id is null or not exists (
    select 1 from public.vendor_claims c join public.vendors v on v.id = c.vendor_id
    where c.status = 'approved' and c.brand_wide and c.claimant_phone = v_m.phone_e164 and v.brand_id = v_src.brand_id) then
    raise exception 'only the brand owner adds branches' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lon is null or p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7 then
    raise exception 'the pin must be in Lebanon' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'brand owner added a branch (case F)', true);
  insert into public.vendors (brand_id, slug, name_ar, name_en, branch_label, business_type, cuisine_tags, claim_status,
    source, field_sources, location)
  values (v_src.brand_id, app_private.new_vendor_slug(coalesce(v_src.name_en, v_src.name_ar) || ' ' || coalesce(p_branch_label, '')),
    v_src.name_ar, v_src.name_en, left(p_branch_label, 60), v_src.business_type, v_src.cuisine_tags, 'claimed', 'merchant',
    jsonb_build_object('location', 'merchant', 'branch_label', 'merchant'),
    extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography)
  returning id into v_id;
  insert into public.vendor_private (vendor_id, owner_mobile) values (v_id, v_m.phone_e164);
  insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status)
  values (v_id, v_m.user_id, v_m.phone_e164, 'owner', 'active');
  return jsonb_build_object('status', 'created', 'vendor_id', v_id);
end;
$$;

-- 6. Listing state (J), removal (K), lost access (L), customer requests (M) --------------------------------
-- J: the owner or a manager marks the business closed or moved (or active again). Not active = not orderable.
create function public.vendor_set_listing(p_vendor_id uuid, p_status public.listing_status, p_member_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('active', 'closed', 'moved') then
    raise exception 'merchants set active, closed or moved' using errcode = 'invalid_parameter_value';
  end if;
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id);
  perform set_config('app.audit_reason', 'merchant set listing ' || p_status, true);
  update public.vendors set listing_status = p_status,
    orderable = case when p_status = 'active' then orderable else false end,
    public_page = case when p_status = 'active' then public_page else false end
  where id = p_vendor_id and listing_status <> 'hidden';
  return jsonb_build_object('status', p_status);
end;
$$;

-- J: a customer reports a listing closed, moved or wrong. Enough distinct customers in 30 days hide it
-- until an operator checks (ops alert).
create function public.vendor_report(p_customer_id uuid, p_vendor_id uuid, p_kind text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  insert into public.vendor_listing_reports (vendor_id, customer_id, kind)
  values (p_vendor_id, p_customer_id, p_kind)
  on conflict (vendor_id, customer_id, kind) do nothing;
  select count(distinct r.customer_id) into v_n from public.vendor_listing_reports r
  where r.vendor_id = p_vendor_id and r.created_at > now() - interval '30 days';
  if v_n >= public.config_numeric('listing_report_hide_count') then
    perform set_config('app.actor_kind', 'system', true);
    perform set_config('app.audit_reason', v_n || ' customers reported the listing', true);
    update public.vendors set listing_status = 'hidden', orderable = false, public_page = false
    where id = p_vendor_id and listing_status = 'active';
    perform app_private.ops_alert('listing-report:' || p_vendor_id || ':' || to_char(now(), 'YYYY-MM-DD'), 'listing_report',
      'warning', v_n || ' customers reported a listing closed or wrong: hidden until checked', null, p_vendor_id, '{}');
    return jsonb_build_object('status', 'hidden', 'reports', v_n);
  end if;
  return jsonb_build_object('status', 'recorded', 'reports', v_n);
end;
$$;

-- K: the owner (or an operator) asks for the listing to be removed. A vendor with no orders is deleted and
-- only its Google place id is kept as "do not re-import" (§15.1, Law 81/2018). A vendor with orders keeps
-- the row the ledger and orders point to, hidden, with its contacts and staff removed.
create function public.vendor_remove_listing(p_vendor_id uuid, p_reason text, p_member_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place text;
begin
  perform app_private.order_actor(p_vendor_id, array['owner']::public.member_role[], p_member_id);
  select v.place_id into v_place from public.vendors v where v.id = p_vendor_id for update;
  perform set_config('app.audit_reason', 'listing removal: ' || left(coalesce(p_reason, ''), 200), true);
  if v_place is not null then
    insert into public.vendor_removed_places (place_id, reason) values (v_place, left(coalesce(p_reason, 'owner request'), 300))
    on conflict (place_id) do nothing;
  end if;
  if not exists (select 1 from public.orders o where o.vendor_id = p_vendor_id)
     and not exists (select 1 from public.ledger_accounts a where a.vendor_id = p_vendor_id) then
    delete from public.vendors where id = p_vendor_id;
    return jsonb_build_object('status', 'deleted');
  end if;
  update public.vendors set listing_status = 'hidden', orderable = false, public_page = false, place_id = null
  where id = p_vendor_id;
  update public.vendor_private set phone_seed = null, address_seed = null, owner_mobile = null, kitchen_whatsapp = null
  where vendor_id = p_vendor_id;
  update public.vendor_members set status = 'revoked' where vendor_id = p_vendor_id and status <> 'revoked';
  return jsonb_build_object('status', 'hidden');
end;
$$;

-- L: an owner lost their phone. Another active owner or manager confirms the new number with one tap;
-- with nobody to confirm, the claim needs documents.
create function public.member_recover_start(p_vendor_id uuid, p_new_phone text, p_lang public.lang_code default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirm public.vendor_members%rowtype;
  v_claim public.vendor_claims%rowtype;
  v_vendor public.vendors%rowtype;
begin
  if p_new_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id and claim_status = 'claimed';
  if v_vendor.id is null then
    return jsonb_build_object('status', 'not_claimed');
  end if;
  if not app_private.claim_rate_ok(p_new_phone) then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  select * into v_claim from public.vendor_claims c where c.vendor_id = p_vendor_id and c.claimant_phone = p_new_phone
    and c.status in ('awaiting_documents', 'awaiting_member', 'pending_review');
  if v_claim.id is not null then
    return jsonb_build_object('status', v_claim.status, 'claim_id', v_claim.id);
  end if;
  select * into v_confirm from public.vendor_members m
  where m.vendor_id = p_vendor_id and m.status = 'active' and m.role in ('owner', 'manager') and m.phone_e164 <> p_new_phone
  order by (m.role = 'owner') desc, m.created_at limit 1;
  insert into public.vendor_claims (vendor_id, claimant_phone, claim_case, status, confirm_member_id, lang)
  values (p_vendor_id, p_new_phone, 'L', (case when v_confirm.id is null then 'awaiting_documents' else 'awaiting_member' end)::public.claim_request_status,
          v_confirm.id, p_lang)
  returning * into v_claim;
  if v_confirm.id is not null then
    perform public.app_reply(v_confirm.phone_e164, jsonb_build_object('interactive', jsonb_build_object(
      'type', 'button',
      'body', jsonb_build_object('text', 'The number ' || p_new_phone || ' asks to become an owner of '
        || coalesce(v_vendor.name_ar, v_vendor.name_en) || ' (lost phone). Approve only if you know them. / رقم جديد عم يطلب يصير صاحب المحل.'),
      'action', jsonb_build_object('buttons', jsonb_build_array(
        jsonb_build_object('type', 'reply', 'reply', jsonb_build_object('id', 'CLM|LOK|' || v_claim.id, 'title', '✅ موافق · Approve')),
        jsonb_build_object('type', 'reply', 'reply', jsonb_build_object('id', 'CLM|LNO|' || v_claim.id, 'title', '❌ لا · Refuse')))))),
      'claim-recover:' || v_claim.id);
  end if;
  return jsonb_build_object('status', v_claim.status, 'claim_id', v_claim.id,
    'missing', case when v_confirm.id is null then to_jsonb(app_private.claim_documents_missing(v_claim)) end);
end;
$$;

-- L: the confirming member's tap.
create function public.member_recover_decide(p_phone text, p_claim_id uuid, p_approve boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.vendor_claims%rowtype;
begin
  select c.* into v_claim from public.vendor_claims c
  join public.vendor_members m on m.id = c.confirm_member_id
  where c.id = p_claim_id and c.status = 'awaiting_member' and m.phone_e164 = p_phone and m.status = 'active'
  for update of c;
  if v_claim.id is null then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  if not p_approve then
    update public.vendor_claims set status = 'rejected', decided_at = now(), decision_note = 'refused by a member'
    where id = p_claim_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  return app_private.claim_approve(p_claim_id);
end;
$$;

-- M: a customer asked for a business we lack. Counted per normalised name and place; never contacted.
create function public.vendor_request_note(p_query text, p_place_id text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := left(app_private.normalize_place_name(coalesce(p_query, '')), 120);
  v_n int;
begin
  if char_length(v_norm) < 2 then
    return jsonb_build_object('status', 'ignored');
  end if;
  insert into public.vendor_requests (query_norm, place_id, sample)
  values (v_norm, p_place_id, left(trim(p_query), 120))
  on conflict (query_norm, coalesce(place_id, '')) do update
    set request_count = public.vendor_requests.request_count + 1, last_at = now()
  returning request_count into v_n;
  return jsonb_build_object('status', 'counted', 'count', v_n);
end;
$$;

-- Onboarding session store for the Merchant number (zero model calls; the steps live in code).
create function public.onboarding_session_get(p_phone text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('step', s.step, 'data', s.data, 'lang', s.lang)
  from public.merchant_onboarding_sessions s
  where s.phone_e164 = p_phone and s.updated_at > now() - interval '24 hours';
$$;
create function public.onboarding_session_set(p_phone text, p_step text, p_data jsonb, p_lang public.lang_code default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_step is null then
    delete from public.merchant_onboarding_sessions where phone_e164 = p_phone;
    return;
  end if;
  insert into public.merchant_onboarding_sessions (phone_e164, step, data, lang, updated_at)
  values (p_phone, p_step, coalesce(p_data, '{}'), p_lang, now())
  on conflict (phone_e164) do update set step = excluded.step, data = excluded.data,
    lang = coalesce(excluded.lang, public.merchant_onboarding_sessions.lang), updated_at = now();
end;
$$;

-- Grants: every function above is server-only, except claim_decide (operators; it checks the caller).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.vendor_claim_search(text, text, integer)',
    'public.claim_start(uuid, text, text, public.lang_code, text)',
    'public.claim_verify_code(text, text, uuid)',
    'public.claim_use_documents(text, uuid)',
    'public.claim_add_document(text, public.claim_document_kind, text, text, uuid)',
    'public.claim_no_registration(text, uuid)',
    'public.claim_object(text, uuid)',
    'public.claims_for_phone(text)',
    'public.vendor_register(text, text, text, public.business_type, double precision, double precision, boolean, public.lang_code, boolean)',
    'public.vendor_from_google(text, text, double precision, double precision, public.business_type, text, text)',
    'public.vendor_branch_add(uuid, text, double precision, double precision)',
    'public.vendor_set_listing(uuid, public.listing_status, uuid)',
    'public.vendor_report(uuid, uuid, text)',
    'public.vendor_remove_listing(uuid, text, uuid)',
    'public.member_recover_start(uuid, text, public.lang_code)',
    'public.member_recover_decide(text, uuid, boolean)',
    'public.vendor_request_note(text, text)',
    'public.onboarding_session_get(text)',
    'public.onboarding_session_set(text, text, jsonb, public.lang_code)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
revoke all on function public.claim_decide(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.claim_decide(uuid, boolean, text, uuid) to authenticated, service_role;
revoke all on function app_private.claim_documents_missing(public.vendor_claims) from public;
grant execute on function app_private.claim_documents_missing(public.vendor_claims) to service_role;
-- vendor_set_listing and vendor_remove_listing check the member themselves (order_actor), so the dashboard
-- may call them signed in.
grant execute on function public.vendor_set_listing(uuid, public.listing_status, uuid) to authenticated;
grant execute on function public.vendor_remove_listing(uuid, text, uuid) to authenticated;
