-- Alo King Chouf, session FD1 (the friends' test food: places and menus), migration 0245 of 0245 to 0247 (0248 left unused).
-- docs/DECISIONS.md, "Founder decisions, 18 November 2026" (3) and "FD1, 18 November 2026". Alo King buys for the customer: a rider orders and
-- pays at the counter, or staff call the order in; the restaurant does nothing new. A place is visible and orderable by testers only until
-- its owner agrees. Invariant 11 holds: a place is a merchant source that approve_merchant() alone opens (0247); nothing here opens one.
--
--   1 a place      a sources row of kind merchant made by staff from an LV1 listing (create_place_from_listing): name, village, preparation
--                  time, hours, visibility. sources gains listing_id (the listing it was made from; NO foreign key: LV1's test keeps every table
--                  but listing_* from pointing at listings), visibility (off | testers | public), buys_for_customer (Alo King buys at the counter).
--                  An existing merchant row is public and not a place: the older signed-merchant path is unchanged.
--   2 its phone    the place's public phone, entered by staff, lives in place_contacts (no client role can read it) and is shown only by the
--                  console's places list. Nothing sends to it: there is no send path here (invariants 1, 17).
--   3 visibility   public is refused unless the owner's claim (LV1's listing_claims) or a vendor application (UX3's join_applications) for the
--                  listing is on file. A trigger on sources enforces it, so no path can skip it.
--   4 testers      settings.testers {"numbers": [...]}: customer numbers in E.164, changed by staff (set_tester), each change logged. is_tester().
--   5 orderable    place_orderable_for(place, party): approved (approve_merchant) and public, or testers and the party is a tester.
--                  product_orderable() (0226) now also says no for a dish of a place that is not approved and public, so every read that asks
--                  it (quote_order, plan_cart, the website, the catalogue feed) keeps a testers-only dish out for everyone; product_orderable_for()
--                  is the same question for one customer (FD2 orders with it). search_catalog drops a dish that is not public, and a named
--                  place that is not public answers merchant_not_onboarded, as an unapproved one always has (0013).
--   6 the log      place_log: every create, change, visibility, tester, photo, reading, dish decision, stamp and approval (append-only).
-- Nothing here writes an order, a payment, stock or the ledger (invariant 3), or a listing.

-- ---------- 1 ----------
alter table sources add column if not exists listing_id text;
alter table sources add column if not exists visibility text not null default 'public';
alter table sources add column if not exists buys_for_customer boolean not null default false;
alter table sources add column if not exists created_by uuid references parties(id);
alter table sources drop constraint if exists sources_visibility_check;
alter table sources add constraint sources_visibility_check check (visibility in ('off', 'testers', 'public'));
alter table sources drop constraint if exists sources_place_check;
alter table sources add constraint sources_place_check check (not buys_for_customer or (kind = 'merchant' and listing_id is not null));
create unique index if not exists sources_one_place_per_listing on sources(listing_id) where listing_id is not null;
comment on column sources.visibility is 'FD1. off: nobody. testers: customers whose number is in settings.testers. public: everyone (a place: only with the owner''s claim or application on file). Orderable only once approve_merchant() approved it.';
comment on column sources.buys_for_customer is 'FD1. A place: Alo King buys for the customer (a rider orders and pays at the counter, or staff call the order in). No commission and no terms until the owner agrees.';

-- ---------- 2 ----------
create table if not exists place_contacts (
  source_id   uuid primary key references sources(id),
  phone_e164  text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  set_by      uuid not null references parties(id),
  set_at      timestamptz not null default now()
);
comment on table place_contacts is 'FD1. A place''s public phone, entered by staff, shown only in the console. Never messaged by code.';

-- ---------- 6 ----------
create table if not exists place_log (
  id         bigint generated always as identity primary key,
  source_id  uuid references sources(id),            -- null: the tester list
  action     text not null check (action in ('create', 'details', 'visibility', 'tester_add', 'tester_remove', 'photo', 'reading', 'reading_failed',
                                             'dish_approve', 'dish_reject', 'menu_checked', 'approve')),
  by_party   uuid not null references parties(id),
  at         timestamptz not null default now(),
  detail     jsonb not null default '{}'
);
create index if not exists place_log_source on place_log(source_id, id);
create or replace function place_log_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'place_log is append-only'; end $$;
drop trigger if exists place_log_no_change on place_log;
create trigger place_log_no_change before update or delete on place_log for each row execute function place_log_append_only();

-- ---------- 4 (the setting before the functions that read it) ----------
insert into settings(key, value) values ('testers', '{"numbers": []}') on conflict (key) do nothing;

create or replace function place_staff_ok(p_by uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) $$;

create or replace function place_phone_ok(p_phone text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_phone ~ '^\+[1-9][0-9]{7,14}$', false) $$;

create or replace function is_tester(p_party uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from party_identities pi
                  where pi.party_id = p_party and pi.line = 'customer' and pi.phone_e164 is not null
                    and pi.phone_e164 in (select jsonb_array_elements_text(coalesce(setting('testers')->'numbers', '[]'::jsonb)))) $$;

create or replace function set_tester(p_by uuid, p_phone text, p_on boolean) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_phone text := btrim(coalesce(p_phone, '')); v_now jsonb;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if not place_phone_ok(v_phone) then raise exception 'PHONE_INVALID: a customer number in full, + and the country code (+961...)'; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into v_now from (
    select distinct n from jsonb_array_elements_text(coalesce(setting('testers')->'numbers', '[]'::jsonb)) n where n <> v_phone
    union select v_phone where coalesce(p_on, false)) x;
  insert into settings(key, value) values ('testers', jsonb_build_object('numbers', v_now))
    on conflict (key) do update set value = jsonb_set(coalesce(settings.value, '{}'::jsonb), '{numbers}', v_now);
  insert into place_log(source_id, action, by_party, detail) values (null, case when coalesce(p_on, false) then 'tester_add' else 'tester_remove' end, p_by,
    jsonb_build_object('phone', v_phone));
  return jsonb_build_object('ok', true, 'numbers', v_now);
end $$;

-- ---------- 3 ----------
create or replace function place_owner_on_file(p_listing text) returns boolean language sql stable set search_path = public, pg_temp as $$
  select p_listing is not null and (exists (select 1 from listing_claims where listing_id = p_listing)
      or exists (select 1 from join_applications where kind = 'vendor' and listing_id = p_listing and status <> 'declined')) $$;

create or replace function place_visibility_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.buys_for_customer and new.visibility = 'public' and not place_owner_on_file(new.listing_id) then
    raise exception 'OWNER_NOT_ON_FILE: a place is public only once its owner''s claim or application is on file';
  end if;
  return new;
end $$;
drop trigger if exists sources_place_visibility on sources;
create trigger sources_place_visibility before insert or update on sources for each row execute function place_visibility_guard();

-- ---------- 1: making and changing a place ----------
-- Hours: {"open": "HH:MM", "close": "HH:MM", "days_off": ["mon", ...]} (all optional). Preparation time 0 to 180 minutes.
create or replace function place_hours_ok(p_hours jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(coalesce(p_hours, '{}'::jsonb)) = 'object'
     and coalesce(p_hours->>'open', '00:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and coalesce(p_hours->>'close', '00:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and coalesce(jsonb_typeof(p_hours->'days_off'), 'array') = 'array'
     and not exists (select 1 from jsonb_array_elements_text(coalesce(p_hours->'days_off', '[]'::jsonb)) d where d not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')) $$;

create or replace function place_contact_set(p_source uuid, p_phone text, p_by uuid) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if p_phone is null then return; end if;
  if btrim(p_phone) = '' then delete from place_contacts where source_id = p_source; return; end if;
  if not place_phone_ok(btrim(p_phone)) then raise exception 'PHONE_INVALID: the place''s number in full, + and the country code (+961...)'; end if;
  insert into place_contacts(source_id, phone_e164, set_by) values (p_source, btrim(p_phone), p_by)
    on conflict (source_id) do update set phone_e164 = excluded.phone_e164, set_by = excluded.set_by, set_at = now();
end $$;

create or replace function create_place_from_listing(p_listing text, p_by uuid, p_details jsonb default '{}') returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare l listings%rowtype; v_id uuid; v_village uuid; v_name text; v_prep int; v_hours jsonb := coalesce(p_details->'hours', '{}'::jsonb);
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into l from listings where listing_id = btrim(coalesce(p_listing, '')) and hidden_at is null;
  if not found then raise exception 'LISTING_NOT_FOUND: no visible listing with that id'; end if;
  if exists (select 1 from sources where listing_id = l.listing_id) then raise exception 'PLACE_EXISTS: a place was already made from this listing'; end if;
  v_village := nullif(p_details->>'village_id', '')::uuid;
  if v_village is null or not exists (select 1 from villages where id = v_village) then raise exception 'VILLAGE_REQUIRED: choose the place''s village'; end if;
  v_name := left(btrim(coalesce(nullif(btrim(p_details->>'name'), ''), l.name)), 120);
  v_prep := coalesce(nullif(p_details->>'prep_minutes', '')::int, 20);
  if v_prep < 0 or v_prep > 180 then raise exception 'PREP_MINUTES: 0 to 180'; end if;
  if not place_hours_ok(v_hours) then raise exception 'HOURS_INVALID: opening and closing as HH:MM, days off as mon..sun'; end if;
  if nullif(btrim(coalesce(p_details->>'phone', '')), '') is not null and not place_phone_ok(btrim(p_details->>'phone')) then
    raise exception 'PHONE_INVALID: the place''s number in full, + and the country code (+961...)';
  end if;
  insert into sources(kind, name, village_id, is_open, prep_minutes, hours, tier, listing_id, visibility, buys_for_customer, created_by)
    values ('merchant', v_name, v_village, false, v_prep, v_hours, 'assisted', l.listing_id, 'off', true, p_by)
    returning id into v_id;
  perform place_contact_set(v_id, nullif(btrim(coalesce(p_details->>'phone', '')), ''), p_by);
  insert into place_log(source_id, action, by_party, detail) values (v_id, 'create', p_by, jsonb_build_object('listing_id', l.listing_id, 'name', v_name));
  return jsonb_build_object('ok', true, 'source_id', v_id);
end $$;

-- Only what is given changes. A phone of '' removes it.
create or replace function set_place_details(p_source uuid, p_by uuid, p_details jsonb) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare s sources%rowtype; v_village uuid; v_prep int; v_name text;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into s from sources where id = p_source and buys_for_customer for update;
  if not found then raise exception 'NOT_A_PLACE'; end if;
  v_name := nullif(left(btrim(coalesce(p_details->>'name', '')), 120), '');
  v_village := nullif(p_details->>'village_id', '')::uuid;
  if v_village is not null and not exists (select 1 from villages where id = v_village) then raise exception 'VILLAGE_REQUIRED: choose the place''s village'; end if;
  v_prep := nullif(p_details->>'prep_minutes', '')::int;
  if v_prep is not null and (v_prep < 0 or v_prep > 180) then raise exception 'PREP_MINUTES: 0 to 180'; end if;
  if p_details ? 'hours' and not place_hours_ok(p_details->'hours') then raise exception 'HOURS_INVALID: opening and closing as HH:MM, days off as mon..sun'; end if;
  update sources set name = coalesce(v_name, name), village_id = coalesce(v_village, village_id), prep_minutes = coalesce(v_prep, prep_minutes),
         hours = case when p_details ? 'hours' then coalesce(p_details->'hours', '{}'::jsonb) else hours end
   where id = p_source;
  perform place_contact_set(p_source, case when p_details ? 'phone' then coalesce(p_details->>'phone', '') else null end, p_by);
  insert into place_log(source_id, action, by_party, detail) values (p_source, 'details', p_by, p_details - 'phone' || jsonb_build_object('phone_changed', p_details ? 'phone'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function set_place_visibility(p_source uuid, p_by uuid, p_visibility text, p_reason text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare s sources%rowtype;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if p_visibility is null or p_visibility not in ('off', 'testers', 'public') then raise exception 'VISIBILITY_INVALID: off, testers or public'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED: say why (at least 3 characters)'; end if;
  select * into s from sources where id = p_source and buys_for_customer for update;
  if not found then raise exception 'NOT_A_PLACE'; end if;
  update sources set visibility = p_visibility where id = p_source;          -- the trigger refuses public without the owner on file
  insert into place_log(source_id, action, by_party, detail) values (p_source, 'visibility', p_by,
    jsonb_build_object('from', s.visibility, 'to', p_visibility, 'reason', left(btrim(p_reason), 500)));
  return jsonb_build_object('ok', true, 'visibility', p_visibility);
end $$;

-- ---------- 5 ----------
-- Who may order from a place (or a signed merchant): approved by approve_merchant(), and visible to this customer. is_open, hours and
-- stock are the ordering's own checks (FD2), as they are for every source.
create or replace function place_orderable_for(p_source uuid, p_party uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select s.approved_at is not null and (s.visibility = 'public' or (s.visibility = 'testers' and is_tester(p_party)))
                     from sources s where s.id = p_source and s.kind = 'merchant'), false) $$;

-- A dish (a product a merchant owns) is open to everyone only when its merchant is approved and public. A hub item: always.
create or replace function place_product_public(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select s.kind <> 'merchant' or (s.approved_at is not null and s.visibility = 'public')
                     from products p join sources s on s.id = p.owner_source_id where p.id = p_product), true) $$;

-- 0226's question, with the place first. The label part is unchanged.
create or replace function product_orderable(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select place_product_public(p_product)
     and case when not sell_requires_label() then true
              when not product_is_packaged(p_product) then true
              else product_label_ready(p_product) end $$;

-- The same question for one customer: a testers-only dish is orderable for a tester.
create or replace function product_orderable_for(p_product uuid, p_party uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select place_orderable_for(p.owner_source_id, p_party) from products p where p.id = p_product and p.owner_source_id is not null), true)
     and case when not sell_requires_label() then true
              when not product_is_packaged(p_product) then true
              else product_label_ready(p_product) end $$;

-- The places one customer may order from (FD2 reads it; never the phone).
create or replace function places_for(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('source_id', s.id, 'name', s.name, 'village_id', s.village_id, 'village_en', v.name_en, 'village_ar', v.name_ar,
           'prep_minutes', s.prep_minutes, 'hours', s.hours, 'is_open', s.is_open, 'visibility', s.visibility) order by s.name), '[]'::jsonb)
    from sources s left join villages v on v.id = s.village_id
   where s.kind = 'merchant' and s.buys_for_customer and place_orderable_for(s.id, p_party) $$;

-- search_catalog (0226's wrapper of 0053): a dish that is not public is dropped; a named place that is not public is not onboarded.
alter function search_catalog(text, text, int) rename to search_catalog_any_place;
create or replace function search_catalog(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare r jsonb;
begin
  if p_source_hint is not null and btrim(p_source_hint) <> '' and not exists (
       select 1 from sources where kind = 'merchant' and approved_at is not null and visibility = 'public'
          and similarity(fold_text(name), fold_text(p_source_hint)) > 0.35) then
    return jsonb_build_object('matches', '[]'::jsonb, 'reason', 'merchant_not_onboarded', 'source_hint', p_source_hint);
  end if;
  r := search_catalog_any_place(p_query, p_source_hint, p_limit);
  r := r || jsonb_build_object('matches', coalesce((select jsonb_agg(x.m order by x.n) from jsonb_array_elements(coalesce(r->'matches', '[]'::jsonb)) with ordinality x(m, n)
                                                      where nullif(x.m->>'product_id', '') is null or place_product_public((x.m->>'product_id')::uuid)), '[]'::jsonb));
  if jsonb_array_length(r->'matches') = 0 and r->>'reason' is null then r := r || jsonb_build_object('reason', 'no_match'); end if;
  return r;
end $$;

-- ---------- the console's list ----------
create or replace function places_console() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_id', s.id, 'listing_id', s.listing_id, 'name', s.name, 'village_id', s.village_id, 'village_en', v.name_en, 'village_ar', v.name_ar,
           'phone', c.phone_e164, 'hours', s.hours, 'prep_minutes', s.prep_minutes, 'visibility', s.visibility, 'is_open', s.is_open,
           'approved', s.approved_at is not null, 'approved_at', s.approved_at, 'owner_on_file', place_owner_on_file(s.listing_id),
           'maps_url', l.maps_url, 'listing_name', l.name, 'listing_village', l.village)
         order by s.name), '[]'::jsonb)
    from sources s left join villages v on v.id = s.village_id left join place_contacts c on c.source_id = s.id
    left join listings l on l.listing_id = s.listing_id
   where s.kind = 'merchant' and s.buys_for_customer $$;

-- ---------- grants ----------
do $$ declare t text; r text;
begin
  foreach t in array array['place_contacts', 'place_log'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
