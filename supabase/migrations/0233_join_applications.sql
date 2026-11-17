-- Alo King Chouf, session UX3 (join pages: riders and vendors), migration 0233: the website's side.
--
-- Two pages on the website take an application: /join/rider (someone who wants to ride) and /for-vendors (a kitchen or shop that wants to sell).
-- Both are applications, nothing more:
--   * a rider application creates an application row and a staff case in the Inbox. It never creates a rider, a driver party, a shift or a login
--     (accepting is a person's decision on the console, 0234);
--   * a vendor application creates an application row and a staff case. If the place is one of LV1's listings it links to it and counts as its claim.
--     It never creates a merchant: invariant 11, approve_merchant() is the only door and nothing here calls or imitates it.
--
-- The applicant's WhatsApp number is confirmed the WEB2 way (0129; docs/WEBSITE.md, "Identity and consent"): the page shows a code, the visitor sends it
-- to our customer number, the customer-line turn reads it by code before any model (claim_link_code) and links the session to the sender. They message us
-- first (invariant 17); nothing is sent to a number typed into a form, and the form has no number field. An application is accepted only from a session
-- whose number is confirmed, and the party is read from that session, never from the request.
--
-- claim_link_code is copied with one change: a code has a purpose (checkout, rider, vendor), and the consent it records says what the sender agreed to
-- in the words of that purpose (answers about their application on this chat, not "updates on your orders").
--
-- What is new:
--   link_codes.purpose        checkout (the default, as before), rider, vendor
--   settings.join             the shifts a rider can offer, the vehicles, the vendor kinds, the limits (data, invariant 13)
--   join_applications         one row per application, rider or vendor; one open one per person and kind
--   join_log                  append-only: apply, accept, decline, with who, when and why
-- The website's functions (granted to web_channel by name below; scripts/check_permissions.sh lists them):
--   web_join_options   what the pages show: villages, shifts, vehicles, vendor kinds, cash caps, the delivery fee range (all from data)
--   web_join_state     is the number confirmed, is a code waiting for this purpose, is an application already open
--   web_join_code      a code for rider or vendor
--   web_apply_rider    the rider's application
--   web_apply_vendor   the vendor's application

alter table link_codes add column if not exists purpose text not null default 'checkout';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'link_codes_purpose' and conrelid = 'link_codes'::regclass) then
    alter table link_codes add constraint link_codes_purpose check (purpose in ('checkout', 'rider', 'vendor'));
  end if;
end $$;

-- The shifts are a draft the founder's reference shows (morning 08:00 to 15:30, evening 15:30 to 23:00); they are data, one SQL row to change.
insert into settings(key, value) values ('join', jsonb_build_object(
  'rider', jsonb_build_object(
    'shifts', jsonb_build_array(jsonb_build_object('id', 'morning', 'from', '08:00', 'to', '15:30'), jsonb_build_object('id', 'evening', 'from', '15:30', 'to', '23:00')),
    'vehicles', jsonb_build_array('motorbike', 'car', 'bicycle')),
  'vendor', jsonb_build_object('kinds', jsonb_build_array('restaurant', 'cafe', 'bakery', 'sweets', 'catering', 'butcher', 'shop')),
  'limits', jsonb_build_object('per_session_day', 3, 'per_hour', 30)))
on conflict (key) do nothing;

create table if not exists join_applications (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('rider', 'vendor')),
  status          text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  party_id        uuid not null references parties(id),            -- the sender of the confirmed code: a customer-line party, never staff
  session_id      uuid references web_sessions(id),
  name            text not null check (btrim(name) <> '' and char_length(name) <= 80),   -- the rider's own name, or the place's name
  village         text check (village is null or char_length(village) <= 60),
  village_id      uuid references villages(id),                     -- when the village is one we know
  vehicle         text,                                            -- rider
  licence         boolean,                                         -- rider: yes or no, asked outright
  days            text[],                                          -- rider: mon .. sun
  shifts          text[],                                          -- rider: ids from settings.join
  place_kind      text,                                            -- vendor
  listing_id      text,                                            -- vendor: the LV1 listing this claims (no foreign key: LV1's test keeps every table but listing_* from pointing at listings; web_apply_vendor checks it exists)
  case_id         uuid references handoffs(id),
  rider_party_id  uuid references parties(id),                      -- set only by accept_rider_application (0234)
  decided_by      uuid references parties(id),
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),
  check ((kind = 'rider' and vehicle is not null and licence is not null and coalesce(cardinality(days), 0) > 0 and coalesce(cardinality(shifts), 0) > 0 and place_kind is null and listing_id is null)
      or (kind = 'vendor' and place_kind is not null and vehicle is null and licence is null)),
  check ((status = 'open') = (decided_at is null)),
  check (status <> 'declined' or (decision_reason is not null and char_length(btrim(decision_reason)) >= 3)),
  check ((status = 'accepted') = (rider_party_id is not null))
);
create unique index if not exists join_applications_one_open on join_applications(party_id, kind) where status = 'open';
create index if not exists join_applications_state on join_applications(kind, status, created_at desc);
create index if not exists join_applications_session on join_applications(session_id, created_at);

create table if not exists join_log (
  id             bigint generated always as identity primary key,
  application_id uuid not null references join_applications(id),
  action         text not null check (action in ('apply', 'accept', 'decline')),
  at             timestamptz not null default now(),
  by_party       uuid references parties(id),                       -- the applicant for apply, staff for a decision
  reason         text,
  detail         jsonb not null default '{}'
);
create index if not exists join_log_application on join_log(application_id, id);
create or replace function join_log_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'join_log is append-only'; end $$;
drop trigger if exists join_log_no_change on join_log;
create trigger join_log_no_change before update or delete on join_log for each row execute function join_log_append_only();

-- ---------- the code, with a purpose ----------
-- The same code as web_link_code (0129), issued for the join pages. A linked session needs no code: its number is already confirmed.
create or replace function web_join_code(p_token text, p_purpose text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s web_sessions%rowtype; v_code text; v_exp timestamptz; v_alpha text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; v_raw bytea; i int;
begin
  if p_purpose is null or p_purpose not in ('rider', 'vendor') then return jsonb_build_object('ok', false, 'error', 'bad_purpose'); end if;
  begin s := web_session_of(p_token);
  exception when raise_exception then return jsonb_build_object('ok', false, 'error', 'no_session'); end;
  if s.party_id is not null then return jsonb_build_object('ok', false, 'error', 'already_linked'); end if;
  update link_codes set expires_at = now() where session_id = s.id and used_at is null and expires_at > now();
  v_exp := now() + make_interval(mins => coalesce((setting('web')->>'link_code_minutes')::int, 10));
  loop
    v_raw := sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8'));
    v_code := 'ALO-';
    for i in 0..5 loop v_code := v_code || substr(v_alpha, get_byte(v_raw, i) % 32 + 1, 1); end loop;
    begin
      insert into link_codes(code, session_id, expires_at, purpose) values (v_code, s.id, v_exp, p_purpose);
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  update web_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_exp);
end $$;

-- claim_link_code (0129) with the consent worded by the code's purpose. Everything else is as it was.
create or replace function claim_link_code(p_party uuid, p_code text, p_wamid text default null) returns jsonb language plpgsql as $$
declare v_code text; c link_codes%rowtype; s web_sessions%rowtype; v_role party_role; v_wording text;
begin
  v_code := upper(substring(coalesce(p_code, '') from '(?i)ALO[- ]?([23456789A-HJ-NP-Z]{6})(?![0-9A-Z])'));
  if v_code is null then return jsonb_build_object('ok', false, 'status', 'not_a_code'); end if;
  v_code := 'ALO-' || v_code;
  select * into c from link_codes where code = v_code for update;
  if not found then return jsonb_build_object('ok', false, 'status', 'unknown'); end if;
  if c.used_at is not null then
    if c.used_by = p_party then
      return jsonb_build_object('ok', true, 'status', 'linked', 'again', true, 'session_id', c.session_id);
    end if;
    return jsonb_build_object('ok', false, 'status', 'used');
  end if;
  if c.expires_at <= now() then return jsonb_build_object('ok', false, 'status', 'expired'); end if;
  select role into v_role from parties where id = p_party;
  if v_role is distinct from 'customer' then return jsonb_build_object('ok', false, 'status', 'not_customer'); end if;
  select * into s from web_sessions where id = c.session_id for update;
  if s.revoked_at is not null or s.expires_at <= now() then return jsonb_build_object('ok', false, 'status', 'expired'); end if;
  if s.party_id is not null and s.party_id <> p_party then return jsonb_build_object('ok', false, 'status', 'used'); end if;

  update link_codes set used_at = now(), used_by = p_party, used_wamid = p_wamid where id = c.id;
  update web_sessions set party_id = p_party, link_code_id = c.id, linked_at = now(), last_seen_at = now(),
         expires_at = now() + make_interval(days => coalesce((setting('web')->>'session_days')::int, 90))
   where id = s.id;
  -- The page said what sending the code means; the message is the evidence (as the card's confirm tap is, 0040).
  v_wording := case c.purpose
    when 'rider'  then 'بإرسال الرمز بتأكد رقمك وبتوافق نردّ عليك على هالمحادثة بخصوص طلب انضمامك كمندوب'
    when 'vendor' then 'بإرسال الرمز بتأكد رقمك وبتوافق نردّ عليك على هالمحادثة بخصوص طلب انضمام محلّك'
    else 'بإرسال الرمز بتأكد رقمك وبتوافق نبعتلك تحديثات طلباتك على هالمحادثة' end;
  insert into consent_events(party_id, line, kind, action, source, wording, evidence_message_id)
    values (p_party, 'customer', 'transactional', 'opt_in', 'web_link_code', v_wording, p_wamid);
  return jsonb_build_object('ok', true, 'status', 'linked', 'again', false, 'session_id', s.id);
end $$;

-- ---------- what the pages read ----------
-- Everything the two pages state comes from here: the villages, the shifts, the vehicles and the kinds from data, the cash caps from settings.cash_cap
-- (the same numbers driver_can_take reads), and the range of delivery fees from the active zones of the villages we serve. A rider keeps all of a fee
-- and all tips (invariant 10), so the range is what a delivery pays them. No village, fee or hub is written in the page (invariant 13).
create or replace function web_join_options() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare j jsonb := coalesce(setting('join'), '{}'::jsonb); v_fees jsonb;
begin
  select jsonb_build_object('min_usd', min(z.delivery_fee_usd)::float8, 'max_usd', max(z.delivery_fee_usd)::float8) into v_fees
    from villages v join zones z on z.id = v.zone_id where v.is_served and z.is_active;
  return jsonb_build_object(
    'villages', (select coalesce(jsonb_agg(jsonb_build_object('name_en', x.name_en, 'name_ar', x.name_ar, 'served', x.is_served) order by x.is_served desc, x.name_en), '[]'::jsonb) from villages x),
    'shifts', coalesce(j->'rider'->'shifts', '[]'::jsonb), 'vehicles', coalesce(j->'rider'->'vehicles', '[]'::jsonb),
    'vendor_kinds', coalesce(j->'vendor'->'kinds', '[]'::jsonb),
    'cash_cap', jsonb_build_object('soft_usd', (setting('cash_cap')->>'soft_usd')::numeric, 'hard_usd', (setting('cash_cap')->>'hard_usd')::numeric),
    'fees', case when v_fees->>'min_usd' is null then null else v_fees end,
    'whatsapp', listing_chat_link());
end $$;

-- Is the number confirmed, is a code waiting (only one issued for this purpose), is an application already open. Never returns the number.
create or replace function web_join_state(p_token text, p_purpose text) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s web_sessions%rowtype; c link_codes%rowtype; a join_applications%rowtype;
begin
  if p_purpose is null or p_purpose not in ('rider', 'vendor') then return jsonb_build_object('valid', false, 'linked', false); end if;
  begin s := web_session_of(p_token);
  exception when raise_exception then return jsonb_build_object('valid', false, 'linked', false); end;
  select * into c from link_codes where session_id = s.id and used_at is null and expires_at > now() and purpose = p_purpose order by created_at desc limit 1;
  if s.party_id is not null then
    select * into a from join_applications where party_id = s.party_id and kind = p_purpose and status = 'open';
  end if;
  return jsonb_build_object('valid', true, 'linked', s.party_id is not null,
    'code_waiting', case when c.id is not null then jsonb_build_object('code', c.code, 'expires_at', c.expires_at) end,
    'application', case when a.id is not null then jsonb_build_object('id', a.id, 'name', a.name, 'created_at', a.created_at) end);
end $$;

-- ---------- the applications ----------
-- The village as written, and the village we know it as (by name, Arabic name or a spelling), when we know it. Nothing is invented: no match, no id.
create or replace function join_village(p_text text) returns uuid language sql stable set search_path = public, pg_temp as $$
  select v.id from villages v
   where nullif(btrim(coalesce(p_text, '')), '') is not null
     and (fold_text(v.name_en) = fold_text(p_text) or fold_text(coalesce(v.name_ar, '')) = fold_text(p_text) or exists (select 1 from unnest(v.aliases) a where fold_text(a) = fold_text(p_text)))
   order by v.is_served desc, v.name_en limit 1 $$;

-- The session's confirmed party and its customer-line conversation, or the reason there is none. Shared by the two applications.
create or replace function join_applicant(p_token text, out s web_sessions, out v_conv uuid, out v_error text) returns record language plpgsql stable set search_path = public, pg_temp as $$
begin
  begin s := web_session_of(p_token);
  exception when raise_exception then v_error := 'no_session'; return; end;
  if s.party_id is null then v_error := 'not_confirmed'; return; end if;
  select id into v_conv from conversations where party_id = s.party_id and line = 'customer';
  if v_conv is null then v_error := 'not_confirmed'; end if;
end $$;

create or replace function join_limit_hit(p_session uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select (select count(*) from join_applications where session_id = p_session and created_at > now() - interval '1 day') >= coalesce((setting('join')->'limits'->>'per_session_day')::int, 3)
      or (select count(*) from join_applications where created_at > now() - interval '1 hour') >= coalesce((setting('join')->'limits'->>'per_hour')::int, 30) $$;

create or replace function web_apply_rider(p_token text, p_name text, p_village text, p_vehicle text, p_licence boolean, p_days text[], p_shifts text[]) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare ap record; s web_sessions%rowtype; v_conv uuid; v_name text := left(btrim(coalesce(p_name, '')), 80); v_village text := nullif(left(btrim(coalesce(p_village, '')), 60), '');
        j jsonb := coalesce(setting('join'), '{}'::jsonb); v_days text[]; v_shifts text[]; v_id uuid; v_case jsonb; v_topic text; v_open join_applications%rowtype;
        v_known_days text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
begin
  ap := join_applicant(p_token); s := ap.s; v_conv := ap.v_conv;
  if ap.v_error is not null then return jsonb_build_object('ok', false, 'error', ap.v_error); end if;
  -- one open application per person: sent twice, it is the same one (nothing is overwritten, no second case)
  select * into v_open from join_applications where party_id = s.party_id and kind = 'rider' and status = 'open';
  if found then return jsonb_build_object('ok', true, 'again', true, 'id', v_open.id); end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if v_village is null then return jsonb_build_object('ok', false, 'error', 'bad_village'); end if;
  if p_vehicle is null or not (coalesce(j->'rider'->'vehicles', '[]'::jsonb) @> to_jsonb(p_vehicle)) then return jsonb_build_object('ok', false, 'error', 'bad_vehicle'); end if;
  if p_licence is null then return jsonb_build_object('ok', false, 'error', 'bad_licence'); end if;
  select coalesce(array_agg(d order by array_position(v_known_days, d)), '{}') into v_days from (select distinct d from unnest(coalesce(p_days, '{}')) d) q;
  select coalesce(array_agg(sh order by sh), '{}') into v_shifts from (select distinct sh from unnest(coalesce(p_shifts, '{}')) sh) q;
  if cardinality(v_days) = 0 or cardinality(v_shifts) = 0
     or exists (select 1 from unnest(v_days) d where not (d = any(v_known_days)))
     or exists (select 1 from unnest(v_shifts) sh where not exists (select 1 from jsonb_array_elements(coalesce(j->'rider'->'shifts', '[]'::jsonb)) e where e->>'id' = sh)) then
    return jsonb_build_object('ok', false, 'error', 'bad_hours');
  end if;
  if join_limit_hit(s.id) then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  insert into join_applications(kind, party_id, session_id, name, village, village_id, vehicle, licence, days, shifts)
    values ('rider', s.party_id, s.id, v_name, v_village, join_village(v_village), p_vehicle, p_licence, v_days, v_shifts) returning id into v_id;
  v_topic := left('Rider application: ' || v_name || ', ' || v_village || ', ' || p_vehicle || ', licence ' || case when p_licence then 'yes' else 'no' end, 300);
  v_case := open_case(v_conv, 'other', v_topic, null, 'rider_application');
  if not (v_case->>'opened')::boolean then
    update handoffs set topic = left(coalesce(topic, '') || case when topic is null or topic = '' then '' else '; ' end || v_topic, 600) where id = (v_case->>'case_id')::uuid;
  end if;
  update join_applications set case_id = (v_case->>'case_id')::uuid where id = v_id;
  insert into join_log(application_id, action, by_party, detail) values (v_id, 'apply', s.party_id, jsonb_build_object('case_id', v_case->>'case_id', 'channel', 'web'));
  update web_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'again', false, 'id', v_id);
end $$;

create or replace function web_apply_vendor(p_token text, p_name text, p_kind text, p_village text, p_listing text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare ap record; s web_sessions%rowtype; v_conv uuid; v_name text := left(btrim(coalesce(p_name, '')), 80); v_village text := nullif(left(btrim(coalesce(p_village, '')), 60), '');
        j jsonb := coalesce(setting('join'), '{}'::jsonb); v_id uuid; v_case jsonb; v_topic text; v_open join_applications%rowtype; l listings%rowtype; v_claim jsonb; v_listing text;
begin
  ap := join_applicant(p_token); s := ap.s; v_conv := ap.v_conv;
  if ap.v_error is not null then return jsonb_build_object('ok', false, 'error', ap.v_error); end if;
  select * into v_open from join_applications where party_id = s.party_id and kind = 'vendor' and status = 'open';
  if found then return jsonb_build_object('ok', true, 'again', true, 'id', v_open.id, 'listing', v_open.listing_id); end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if p_kind is null or not (coalesce(j->'vendor'->'kinds', '[]'::jsonb) @> to_jsonb(p_kind)) then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if join_limit_hit(s.id) then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  -- A listing counts only while it is on the website: a hidden or unknown one is not linked (the application stands without it).
  if nullif(btrim(coalesce(p_listing, '')), '') is not null then select * into l from listings where listing_id = btrim(p_listing) and hidden_at is null; end if;
  v_listing := case when l.listing_id is not null then l.listing_id end;
  insert into join_applications(kind, party_id, session_id, name, village, village_id, place_kind, listing_id)
    values ('vendor', s.party_id, s.id, v_name, v_village, join_village(v_village), p_kind, v_listing) returning id into v_id;
  v_topic := left('Vendor application: ' || v_name || ', ' || p_kind || coalesce(', ' || v_village, ''), 300);
  if v_listing is not null then
    -- the application is the claim: LV1's claim_listing opens the case and records the claim and its log line; the application's details join its topic
    v_claim := claim_listing(s.party_id, v_conv, 'Claim ' || v_listing, null);
    v_case := v_claim->'case';
  else
    v_case := open_case(v_conv, 'other', v_topic, null, 'vendor_application');
  end if;
  if v_listing is not null or not (v_case->>'opened')::boolean then
    update handoffs set topic = left(coalesce(topic, '') || case when topic is null or topic = '' then '' else '; ' end || v_topic, 600) where id = (v_case->>'case_id')::uuid;
  end if;
  update join_applications set case_id = (v_case->>'case_id')::uuid where id = v_id;
  insert into join_log(application_id, action, by_party, detail) values (v_id, 'apply', s.party_id, jsonb_build_object('case_id', v_case->>'case_id', 'listing_id', v_listing, 'channel', 'web'));
  update web_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'again', false, 'id', v_id, 'listing', v_listing);
end $$;

-- ---------- access ----------
alter table join_applications enable row level security;
alter table join_log enable row level security;
do $$ declare r text; t text;
begin
  foreach t in array array['join_applications', 'join_log'] loop
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

grant execute on function web_join_options()                                                   to web_channel;
grant execute on function web_join_state(text, text)                                           to web_channel;
grant execute on function web_join_code(text, text)                                            to web_channel;
grant execute on function web_apply_rider(text, text, text, text, boolean, text[], text[])     to web_channel;
grant execute on function web_apply_vendor(text, text, text, text, text)                       to web_channel;
