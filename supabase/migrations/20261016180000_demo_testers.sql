-- Session 5f part 6 (DECISIONS §39.15.3): testers anywhere in the world. Friends outside the Shouf live the whole experience
-- on staging, with the shop side played by the demo autopilot when Rasheed does not tap. Safe on production, where demo mode
-- is off (config demo_shops empty): nothing here acts there, and the cut-over asserts it.
--
-- 1. Invite code: dated config demo_invite_code, made here in the database (never written in the repo, which may be public),
--    only where demo mode is on and no row exists; demo_tester_days, demo_tester_max.
-- 2. Testers: app_private.demo_testers; demo_tester_enrol (the bot calls it on a message that carries something like a code),
--    app_private.is_demo_tester. A simulator number is never enrolled.
-- 3. Removal: the owner's phone (`tester remove +…`, demo_tester_remove_by_owner) and Slack (`/ak tester remove +…`,
--    `/ak testers`).
-- 4. Demo addresses: config demo_addresses (Baakleen, Deir el Qamar, Beiteddine, with their places' ids). A tester's or an
--    owner's pin outside the delivery area is not stored; they pick a demo address (demo_address_pick), quoted from
--    shop_place_routes like any address, and never sent to a live routing call.
-- 5. The demo autopilot (app_private.demo_autopilot_tick, in tick-30s): a tester's or an owner's order at a demo shop that
--    nobody tapped within demo_autopilot_after_s is accepted with a demo_autopilot_prep_min prep through order_accept, then
--    marked ready, out for delivery and delivered (the delivery code confirmed as a driver would) every demo_autopilot_step_s,
--    through order_progress, so the customer gets every normal message. Any human touch stops it for that order.
--    Config demo_autopilot_enabled: on only where demo mode is on.
-- 6. is_demo on orders, order ratings and ledger rows (set on insert, never changed); demo rows never count in a shop's
--    figures: the merchant report and weekly summary, the merchant's learned facts, the shift handover's low ratings, best
--    sellers, the shop menu's ranking and the "goes well with" suggestion. Messages about a demo order never reach a real shop.
-- 7. A demo tester orders only from the demo shops: they see only those, a basket elsewhere is refused (basket_add_item:
--    demo_only) and so is the order itself (orders insert trigger); a demo address serves only while its customer is in the
--    test; a demo order nobody answered never counts against the shop (dispatch_give_up: no streak, no auto-pause); "Same
--    again" is refused there too (basket_reorder), and a pretend order is offered as a gift only to someone in the test
--    (gift_request_create: demo_recipient; the outbound guard skips anyone else).

-- 1. Config ----------------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note) values
  ('demo_tester_days', '14', '2026-10-16 13:00+03', 'DECISIONS §39.15.3: a demo tester stays enrolled this many days'),
  ('demo_tester_max', '30', '2026-10-16 13:00+03', 'DECISIONS §39.15.3: at most this many active demo testers'),
  ('demo_autopilot_after_s', '60', '2026-10-16 13:00+03',
   'DECISIONS §39.15.3: the demo autopilot accepts a tester''s order nobody tapped after this many seconds'),
  ('demo_autopilot_step_s', '60', '2026-10-16 13:00+03',
   'DECISIONS §39.15.3: then marks it ready, out for delivery and delivered at this interval'),
  ('demo_autopilot_prep_min', '15', '2026-10-16 13:00+03', 'DECISIONS §39.15.3: the prep time the demo autopilot accepts with'),
  ('demo_addresses', '[
     {"key": "baakleen", "place_id": "LB-CHF-BAAKLINE", "name_en": "Baakleen", "name_ar": "بعقلين", "name_fr": "Baakline", "lat": 33.677392, "lon": 35.563548},
     {"key": "deir_el_qamar", "place_id": "LB-CHF-DEIR-AL-QAMAR", "name_en": "Deir el Qamar", "name_ar": "دير القمر", "name_fr": "Deir el Qamar", "lat": 33.697969, "lon": 35.564743},
     {"key": "beiteddine", "place_id": "LB-CHF-BEITEDDINE", "name_en": "Beiteddine", "name_ar": "بيت الدين", "name_fr": "Beiteddine", "lat": 33.694184, "lon": 35.581201}
   ]', '2026-10-16 13:00+03',
   'DECISIONS §39.15.3: the fixed points (place centres) a demo tester outside the delivery area picks from')
on conflict do nothing;

-- The invite code and the autopilot switch exist only where demo mode is on. Called here and by the staging demo fixture
-- (supabase/test-fixtures/demo-shops.sql), so a staging database that turns demo mode on later gets them too. The code is
-- never written in the repo: anyone with it could enrol. It is read from the database to build Rasheed's link.
create function app_private.demo_config_ensure() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_added text[] := '{}';
begin
  if cardinality(app_private.demo_vendor_ids()) = 0 then
    return jsonb_build_object('status', 'off');
  end if;
  if not exists (select 1 from public.app_config c where c.key = 'demo_invite_code') then
    insert into public.app_config (key, value, effective_from, note)
    values ('demo_invite_code', to_jsonb('ALO' || upper(encode(extensions.gen_random_bytes(4), 'hex'))), now(),
      'DECISIONS §39.15.3: the code in Rasheed''s tester link wa.me/<number>?text=<code>; made in the database, never in the repo');
    v_added := v_added || 'demo_invite_code'::text;
  end if;
  if not exists (select 1 from public.app_config c where c.key = 'demo_autopilot_enabled') then
    insert into public.app_config (key, value, effective_from, note)
    values ('demo_autopilot_enabled', 'true', now(),
      'DECISIONS §39.15.3: the demo autopilot plays the shop side on staging; the cut-over asserts it is off');
    v_added := v_added || 'demo_autopilot_enabled'::text;
  end if;
  return jsonb_build_object('status', 'ok', 'added', to_jsonb(v_added));
end;
$$;
revoke all on function app_private.demo_config_ensure() from public, anon, authenticated;
select app_private.demo_config_ensure();

-- 2. Testers ---------------------------------------------------------------------------------------------------------------
create table app_private.demo_testers (
  id bigint generated always as identity primary key,
  customer_id uuid not null unique references public.customers (id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  enrolled_at timestamptz not null default now(),
  expires_at timestamptz not null,
  removed_at timestamptz,
  removed_by text check (char_length(removed_by) <= 80),
  constraint demo_testers_expiry check (expires_at > enrolled_at),
  constraint demo_testers_removed check ((removed_at is null) = (removed_by is null))
);
create index demo_testers_phone_idx on app_private.demo_testers (phone_e164);
alter table app_private.demo_testers enable row level security;
revoke all on table app_private.demo_testers from public, anon, authenticated;
create trigger demo_testers_audit after insert or update or delete on app_private.demo_testers
  for each row execute function app_private.audit_row();

-- Active: enrolled, not removed, not expired.
create function app_private.is_demo_tester(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from app_private.demo_testers t
                 where t.customer_id = p_customer_id and t.removed_at is null and t.expires_at > now());
$$;

-- A phone inside the test: an active tester's, an owner's, or a simulator number (it never leaves the sink). A gift of a
-- pretend order goes only to such a phone (§39.15.3).
create function app_private.demo_phone_in_test(p_phone text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_phone is not null and (
    app_private.is_sim_phone(p_phone)
    or exists (select 1 from app_private.owner_phones o where o.phone_e164 = p_phone)
    or exists (select 1 from app_private.demo_testers t
               where t.phone_e164 = p_phone and t.removed_at is null and t.expires_at > now()));
$$;

-- Who the demo addresses and the autopilot serve: an active tester, or an owner (app_private.owner_phones).
create function app_private.demo_player(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app_private.is_demo_tester(p_customer_id) or exists (
    select 1 from public.customers c join app_private.owner_phones o on o.phone_e164 = c.phone_e164 where c.id = p_customer_id);
$$;

-- The first message carrying the invite code enrols the number for demo_tester_days, up to demo_tester_max active testers.
-- Statuses: enrolled, already (still active), full, removed (an owner removed it: the code does not bring it back),
-- off (demo mode off, no code, or a simulator number), no_code (the text does not carry the code).
create function public.demo_tester_enrol(p_customer_id uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(public.config_value('demo_invite_code') #>> '{}', '')));
  v_phone text;
  v_t app_private.demo_testers%rowtype;
  v_active integer;
  v_until timestamptz;
begin
  if cardinality(app_private.demo_vendor_ids()) = 0 or char_length(v_code) < 6 then
    return jsonb_build_object('status', 'off');
  end if;
  if p_text is null or position(v_code in upper(p_text)) = 0 then
    return jsonb_build_object('status', 'no_code');
  end if;
  select c.phone_e164 into v_phone from public.customers c where c.id = p_customer_id;
  -- A simulator number (§36) is never a tester: its scenarios opt into the demo shops with sim_demo.
  if v_phone is null or app_private.is_sim_phone(v_phone) then
    return jsonb_build_object('status', 'off');
  end if;
  -- One enrolment at a time, so the cap holds.
  perform pg_advisory_xact_lock(hashtext('demo_tester_enrol'));
  select * into v_t from app_private.demo_testers t where t.customer_id = p_customer_id for update;
  if v_t.id is not null and v_t.removed_at is not null then
    return jsonb_build_object('status', 'removed');
  end if;
  if v_t.id is not null and v_t.expires_at > now() then
    return jsonb_build_object('status', 'already', 'expires_at', v_t.expires_at);
  end if;
  select count(*) into v_active from app_private.demo_testers t where t.removed_at is null and t.expires_at > now();
  if v_active >= public.config_numeric('demo_tester_max') then
    return jsonb_build_object('status', 'full');
  end if;
  v_until := now() + make_interval(days => public.config_numeric('demo_tester_days')::integer);
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'demo tester enrolled with the invite code (DECISIONS §39.15.3)', true);
  -- An expired tester who sends the code again starts a new period (still within the cap).
  insert into app_private.demo_testers (customer_id, phone_e164, enrolled_at, expires_at)
  values (p_customer_id, v_phone, now(), v_until)
  on conflict (customer_id) do update set phone_e164 = excluded.phone_e164, enrolled_at = excluded.enrolled_at,
    expires_at = excluded.expires_at;
  return jsonb_build_object('status', 'enrolled', 'expires_at', v_until);
end;
$$;

-- 3. Removal -------------------------------------------------------------------------------------------------------------
create function app_private.demo_tester_remove(p_phone_e164 text, p_by text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('status', 'bad_phone');
  end if;
  perform set_config('app.audit_reason', 'demo tester removed by ' || left(p_by, 60) || ' (DECISIONS §39.15.3)', true);
  update app_private.demo_testers set removed_at = now(), removed_by = left(p_by, 80)
  where phone_e164 = p_phone_e164 and removed_at is null
  returning id into v_id;
  return jsonb_build_object('status', case when v_id is null then 'not_found' else 'removed' end, 'phone', p_phone_e164);
end;
$$;

-- `tester remove +…` from an owner's phone (app_private.owner_phones); anyone else gets not_owner and the message carries on
-- as a normal one.
create function public.demo_tester_remove_by_owner(p_owner_phone text, p_phone_e164 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from app_private.owner_phones o where o.phone_e164 = p_owner_phone) then
    return jsonb_build_object('status', 'not_owner');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  return app_private.demo_tester_remove(p_phone_e164, 'owner ' || p_owner_phone);
end;
$$;

-- Slack (§32.1): `/ak testers` and `/ak tester remove +…`. Slack is not the record: phone numbers are masked in the list.
create function app_private.mask_phone(p_phone text) returns text
language sql immutable set search_path = ''
as $$
  select case when p_phone is null then null
              else left(p_phone, 4) || repeat('•', greatest(char_length(p_phone) - 7, 1)) || right(p_phone, 3) end;
$$;

create function public.ops_demo_testers(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_require(p_actor_id);
  return jsonb_build_object(
    'demo_on', cardinality(app_private.demo_vendor_ids()) > 0,
    'autopilot', app_private.demo_autopilot_on(),
    'max', public.config_numeric('demo_tester_max'),
    'days', public.config_numeric('demo_tester_days'),
    'testers', coalesce((select jsonb_agg(jsonb_build_object(
        'phone', app_private.mask_phone(t.phone_e164),
        'name', coalesce(split_part(nullif(trim(c.display_name), ''), ' ', 1), 'tester'),
        'enrolled_at', t.enrolled_at, 'expires_at', t.expires_at,
        'orders', (select count(*) from public.orders o where o.customer_id = t.customer_id and o.created_at >= t.enrolled_at))
      order by t.enrolled_at)
      from app_private.demo_testers t join public.customers c on c.id = t.customer_id
      where t.removed_at is null and t.expires_at > now()), '[]'));
end;
$$;

create function public.ops_demo_tester_remove(p_actor_id uuid, p_phone_e164 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r jsonb;
begin
  perform app_private.ops_require(p_actor_id);
  perform set_config('app.actor_kind', 'operator', true);
  v_r := app_private.demo_tester_remove(p_phone_e164, 'operator ' || p_actor_id);
  perform app_private.ops_log(p_actor_id, 'slack', 'demo_tester_remove',
    jsonb_build_object('phone', app_private.mask_phone(p_phone_e164)), jsonb_build_object('status', v_r ->> 'status'));
  return v_r;
end;
$$;

-- 4. Demo addresses ----------------------------------------------------------------------------------------------------------
-- A demo address is the tester's own address row at a fixed point; it never asks for a live route (zero ORS calls).
alter table public.addresses add column demo_key text check (demo_key ~ '^[a-z][a-z_]{1,20}$');
comment on column public.addresses.demo_key is
  'DECISIONS §39.15.3: set when a demo tester picked this fixed demo address (config demo_addresses); quoted from shop_place_routes only';
create unique index addresses_demo_key_idx on public.addresses (customer_id, demo_key) where demo_key is not null;

-- The (up to three) choices shown to a tester outside the delivery area, only places delivered to now:
-- [{key, name_en, name_ar, name_fr}].
create function app_private.demo_address_choices() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', y.e ->> 'key', 'name_en', y.e ->> 'name_en',
      'name_ar', coalesce(y.e ->> 'name_ar', y.e ->> 'name_en'), 'name_fr', coalesce(y.e ->> 'name_fr', y.e ->> 'name_en'))
      order by y.ord), '[]')
  from (
    select x.e, x.ord
    from jsonb_array_elements(case when jsonb_typeof(public.config_value('demo_addresses')) = 'array'
                                   then public.config_value('demo_addresses') else '[]'::jsonb end) with ordinality x (e, ord)
    where x.e ->> 'key' ~ '^[a-z][a-z_]{1,20}$' and app_private.place_delivered_to(x.e ->> 'place_id')
    order by x.ord
    limit 3) y;
$$;

-- Demo addresses apply while demo mode is on, to testers and owners.
create function app_private.demo_addresses_for(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select cardinality(app_private.demo_vendor_ids()) > 0
    and jsonb_array_length(app_private.demo_address_choices()) > 0
    and app_private.demo_player(p_customer_id);
$$;

-- As in 20261015120100_customer_agent.sql, with §39.15.3 first: a tester's or an owner's pin outside the delivery area (no
-- place, a place not delivered to, or the staging "Test location") is answered with the demo addresses and stored nowhere.
create or replace function public.address_save_pin(p_customer_id uuid, p_lat double precision, p_lon double precision,
  p_label text default null, p_building text default null, p_floor text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pt extensions.geography;
  v_place record;
  v_place_id text;
  v_test_place text := (select p.id from public.places p where p.id = 'LB-TST-LOCATION' and p.source = 'test'
                          and exists (select 1 from public.vendors v where v.is_test));
  v_id uuid;
  v_new boolean := false;
  v_demo_place text;
begin
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  if app_private.demo_addresses_for(p_customer_id) then
    if p_lat between 33.0 and 34.8 and p_lon between 35.0 and 36.7 then
      select f.place_id into v_demo_place from public.place_for_point(app_private.lat_lon_point(p_lat, p_lon)) f;
    end if;
    if v_demo_place is null or v_demo_place = 'LB-TST-LOCATION' or not app_private.place_delivered_to(v_demo_place) then
      return jsonb_build_object('status', 'demo_outside', 'choices', app_private.demo_address_choices(),
        'place', (select jsonb_build_object('name_en', p.name_en, 'name_ar', p.name_ar) from public.places p
                  where p.id = v_demo_place and p.id <> 'LB-TST-LOCATION'));
    end if;
  end if;
  if (p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7) and v_test_place is null then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  v_pt := app_private.lat_lon_point(p_lat, p_lon);
  select a.id into v_id from public.addresses a
  where a.customer_id = p_customer_id and a.pin is not null and extensions.st_dwithin(a.pin, v_pt, 30)
  order by a.saved desc, a.pin operator(extensions.<->) v_pt limit 1;
  if v_id is null then
    if p_lat between 33.0 and 34.8 and p_lon between 35.0 and 36.7 then
      select * into v_place from public.place_for_point(v_pt);
      v_place_id := v_place.place_id;
    end if;
    if v_test_place is not null and v_place_id is not null
       and (select p.service_status from public.places p where p.id = v_place_id) = 'paused' then
      v_place_id := null;
    end if;
    v_place_id := coalesce(v_place_id, v_test_place);
    if v_place_id is null then
      return jsonb_build_object('status', 'no_place');
    end if;
    insert into public.addresses (customer_id, label, place_id, pin, source, building_text, floor, note, is_default, saved)
    values (p_customer_id, left(nullif(trim(p_label), ''), 40), v_place_id, v_pt, 'pin', left(nullif(trim(p_building), ''), 120),
      left(nullif(trim(p_floor), ''), 20), left(nullif(trim(p_note), ''), 300), false, false)
    returning id into v_id;
    v_new := true;
  end if;
  update public.addresses set last_used_at = now(), pinned_at = now() where id = v_id;
  -- Sending a pin while ordering is the confirmation of the address for that basket (§39.6).
  update public.baskets set address_id = v_id, last_activity_at = now(), address_confirmed_at = now()
  where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', 'saved', 'new', v_new, 'address', public.address_card(v_id));
end;
$$;

-- A tap on a demo address: the tester's address at that fixed point, made once and reused, then everything as after a pin.
create function public.demo_address_pick(p_customer_id uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a jsonb;
  v_place text;
  v_id uuid;
  v_new boolean := false;
begin
  if not app_private.demo_addresses_for(p_customer_id) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  select x.e into v_a from jsonb_array_elements(public.config_value('demo_addresses')) x (e) where x.e ->> 'key' = p_key;
  select p.id into v_place from public.places p where p.id = v_a ->> 'place_id';
  if v_a is null or v_place is null or jsonb_typeof(v_a -> 'lat') <> 'number' or jsonb_typeof(v_a -> 'lon') <> 'number' then
    return jsonb_build_object('status', 'unknown');
  end if;
  -- Only a place delivered to now (an old button of a place switched off since is refused).
  if not exists (select 1 from jsonb_array_elements(app_private.demo_address_choices()) c where c ->> 'key' = p_key) then
    return jsonb_build_object('status', 'not_delivered');
  end if;
  select a.id into v_id from public.addresses a where a.customer_id = p_customer_id and a.demo_key = p_key;
  if v_id is null then
    insert into public.addresses (customer_id, place_id, pin, source, is_default, saved, demo_key)
    values (p_customer_id, v_place, app_private.lat_lon_point((v_a ->> 'lat')::double precision, (v_a ->> 'lon')::double precision),
      'pin', false, false, p_key)
    returning id into v_id;
    v_new := true;
  end if;
  update public.addresses set last_used_at = now(), pinned_at = now() where id = v_id;
  update public.baskets set address_id = v_id, last_activity_at = now(), address_confirmed_at = now()
  where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', 'saved', 'new', v_new, 'demo', true, 'address', public.address_card(v_id));
end;
$$;

-- As in 20261016130100_routing_never_blocks.sql: a demo address never asks for the one live route at checkout (its distance
-- is the shop → place distance, zero ORS calls).
create or replace function app_private.route_pair(p_vendor_id uuid, p_address_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'origin', jsonb_build_object('lat', extensions.st_y(v.location::extensions.geometry), 'lon', extensions.st_x(v.location::extensions.geometry)),
    'dest', jsonb_build_object('lat', extensions.st_y(a.pin::extensions.geometry), 'lon', extensions.st_x(a.pin::extensions.geometry)))
  from public.vendors v, public.addresses a
  where v.id = p_vendor_id and a.id = p_address_id and v.location is not null and a.pin is not null and a.demo_key is null;
$$;

-- 6. is_demo (before the autopilot, which reads it) -------------------------------------------------------------------------
alter table public.orders add column is_demo boolean not null default false;
alter table public.order_ratings add column is_demo boolean not null default false;
alter table public.ledger_transactions add column is_demo boolean not null default false;
alter table public.ledger_entries add column is_demo boolean not null default false;
comment on column public.orders.is_demo is
  'DECISIONS §39.15.3: a pretend order (a demo shop''s, or a demo tester''s): never shown publicly, never in a shop''s figures';
comment on column public.order_ratings.is_demo is 'DECISIONS §39.15.3: the rating of a demo order (its order''s flag)';
comment on column public.ledger_transactions.is_demo is 'DECISIONS §39.15.3: a demo order''s money (its order''s flag)';
comment on column public.ledger_entries.is_demo is 'DECISIONS §39.15.3: its transaction''s flag';

-- Orders already placed at a demo shop on staging are demo orders (zero rows on production). Ratings follow. The ledger is
-- append-only and is never edited: earlier staging rows keep false (accepted staging side effect, §39.12).
update public.orders set is_demo = true where vendor_id = any (app_private.demo_vendor_ids()) and not is_demo;
update public.order_ratings r set is_demo = true from public.orders o where o.id = r.order_id and o.is_demo and not r.is_demo;

-- Set on insert from the shop and the customer, and never changed afterwards. On insert it is also the last gate for every
-- way an order is made (order_place, a gift's acceptance): a demo tester orders only from the demo shops (a pretend order
-- must never reach a real shop), and a demo address serves only while its customer is in the test. order_place's
-- transaction is undone and the bot answers with the buttons (turn.ts, confirm).
create function app_private.orders_is_demo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if app_private.is_demo_tester(new.customer_id) and not app_private.vendor_is_demo(new.vendor_id) then
      raise exception 'demo_only: a demo tester orders only from the demo shops' using errcode = 'check_violation';
    end if;
    if new.address_id is not null
       and exists (select 1 from public.addresses a where a.id = new.address_id and a.demo_key is not null)
       and not app_private.demo_addresses_for(new.customer_id) then
      raise exception 'demo_address: a demo address serves only during the test' using errcode = 'check_violation';
    end if;
    new.is_demo := app_private.vendor_is_demo(new.vendor_id) or app_private.is_demo_tester(new.customer_id);
  else
    new.is_demo := old.is_demo;
  end if;
  return new;
end;
$$;
revoke all on function app_private.orders_is_demo() from public;
create trigger orders_is_demo before insert or update of is_demo on public.orders
  for each row execute function app_private.orders_is_demo();

create function app_private.order_ratings_is_demo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.is_demo := coalesce((select o.is_demo from public.orders o where o.id = new.order_id), false);
  return new;
end;
$$;
revoke all on function app_private.order_ratings_is_demo() from public;
create trigger order_ratings_is_demo before insert or update on public.order_ratings
  for each row execute function app_private.order_ratings_is_demo();

create function app_private.ledger_transactions_is_demo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.is_demo := coalesce((select o.is_demo from public.orders o where o.id = new.order_id), false);
  return new;
end;
$$;
revoke all on function app_private.ledger_transactions_is_demo() from public;
create trigger ledger_transactions_is_demo before insert on public.ledger_transactions
  for each row execute function app_private.ledger_transactions_is_demo();

create function app_private.ledger_entries_is_demo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.is_demo := coalesce((select t.is_demo from public.ledger_transactions t where t.id = new.transaction_id), false);
  return new;
end;
$$;
revoke all on function app_private.ledger_entries_is_demo() from public;
create trigger ledger_entries_is_demo before insert on public.ledger_entries
  for each row execute function app_private.ledger_entries_is_demo();

-- As in 20261015220000_demo_mode.sql, with demo orders: a demo tester's order at any shop is pretend too, so nothing about it
-- reaches that shop's numbers either.
create or replace function app_private.outbound_demo_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor uuid := new.vendor_id;
  v_order_vendor uuid;
  v_demo_order boolean := false;
  v_customer text;
  v_recipient text;
  v_gift text;
  v_to text;
begin
  if new.order_id is not null then
    select o.vendor_id, o.is_demo into v_order_vendor, v_demo_order from public.orders o where o.id = new.order_id;
    v_vendor := coalesce(v_vendor, v_order_vendor);
  end if;
  if not (app_private.vendor_is_demo(v_vendor) or coalesce(v_demo_order, false))
     or (new.channel = 'portal' and app_private.vendor_is_demo(v_vendor)) then
    return new;
  end if;
  -- A demo order at a shop that is not a demo shop never reaches that shop, its portal included.
  if new.channel = 'portal' then
    new.status := 'skipped';
    new.last_error := 'demo order: never shown to a shop that is not a demo shop';
    return new;
  end if;
  if new.channel not in ('whatsapp', 'call') then
    new.status := 'skipped';
    new.last_error := 'demo shop: ' || new.channel || ' copies are never sent';
    return new;
  end if;
  if new.order_id is not null then
    select c.phone_e164, o.recipient_phone into v_customer, v_recipient
    from public.orders o join public.customers c on c.id = o.customer_id where o.id = new.order_id;
  end if;
  if new.payload ->> 'gift_id' ~ '^[0-9a-f-]{36}$' then
    select g.recipient_phone into v_gift from public.gift_requests g where g.id = (new.payload ->> 'gift_id')::uuid;
  end if;
  if new.target is not null and new.target = v_customer then
    return new;
  end if;
  -- A gift's recipient hears about a pretend order only when they are in the test themselves; anyone else hears nothing.
  if new.target is not null and new.target in (v_recipient, v_gift) then
    if not app_private.demo_phone_in_test(new.target) then
      new.status := 'skipped';
      new.last_error := 'demo order: never sent to a recipient outside the test';
    end if;
    return new;
  end if;
  if app_private.is_sim_phone(v_customer) then
    -- A simulated customer's order (§36): only the scenario's simulated merchant, never a real phone (the owner's included).
    if app_private.is_sim_phone(new.target) then
      return new;
    end if;
    select s.merchant_phone into v_to from app_private.sim_demo_customers s where s.phone_e164 = v_customer;
  else
    -- An owner's phone, or a simulator number (it never leaves the sink: a scenario's merchant, e.g. a copilot proposal).
    if app_private.is_sim_phone(new.target) or exists (select 1 from app_private.owner_phones o where o.phone_e164 = new.target) then
      return new;
    end if;
    select o.phone_e164 into v_to from app_private.owner_phones o order by o.created_at, o.phone_e164 limit 1;
  end if;
  if v_to is null then
    new.status := 'skipped';
    new.last_error := 'demo shop: nobody to route to (never sent to a shop''s number)';
  else
    new.target := v_to;
  end if;
  return new;
end;
$$;

-- Shop figures leave demo rows out -------------------------------------------------------------------------------------------
-- As in 20261015140100_merchant_copilot.sql, without demo orders and ratings (also feeds the weekly summary).
create or replace function public.merchant_report(p_vendor_id uuid, p_member_id uuid, p_period text default 'day') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from timestamptz;
  v_r jsonb;
begin
  perform app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id);
  v_from := case when p_period = 'week' then now() - interval '7 days'
                 else ((now() at time zone 'Asia/Beirut')::date)::timestamp at time zone 'Asia/Beirut' end;
  select jsonb_build_object(
    'period', case when p_period = 'week' then 'week' else 'day' end,
    'orders', count(*),
    'delivered', count(*) filter (where o.status = 'delivered'),
    'rejected', count(*) filter (where o.status = 'rejected'),
    'cancelled', count(*) filter (where o.status = 'cancelled'),
    'food_sales_usd', coalesce(sum(o.food_subtotal_usd - o.offer_usd) filter (where o.status = 'delivered'), 0),
    'offers_usd', coalesce(sum(o.offer_usd) filter (where o.status = 'delivered'), 0),
    'order_fees_usd', coalesce(sum(o.order_fee_usd) filter (where o.status = 'delivered'), 0),
    'acceptance_median_s', (select percentile_cont(0.5) within group (order by extract(epoch from (x.accepted_at - x.placed_at)))
                             from public.orders x where x.vendor_id = p_vendor_id and x.placed_at >= v_from and x.accepted_at is not null
                               and not x.is_demo),
    'top_items', coalesce((select jsonb_agg(t) from (
        select jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', coalesce(i.name_en, i.name_ar), 'quantity', sum(i.quantity)) as t
        from public.order_items i join public.orders x on x.id = i.order_id
        where x.vendor_id = p_vendor_id and x.placed_at >= v_from and x.status = 'delivered' and not x.is_demo
        group by coalesce(i.name_ar, i.name_en), coalesce(i.name_en, i.name_ar) order by sum(i.quantity) desc limit 3) s), '[]'),
    'rating_avg', (select round(avg(r.food_score), 1) from public.order_ratings r
                   where r.vendor_id = p_vendor_id and r.rated_at >= v_from and not r.is_demo),
    'ratings', (select count(*) from public.order_ratings r where r.vendor_id = p_vendor_id and r.rated_at >= v_from and not r.is_demo)
  ) into v_r
  from public.orders o where o.vendor_id = p_vendor_id and o.placed_at >= v_from and not o.status = 'awaiting_payment'
    and not o.is_demo;
  return v_r;
end;
$$;

-- As in 20261015140100_merchant_copilot.sql, the order-based facts without demo orders (an autopilot accept is not the shop's).
create or replace function app_private.merchant_facts_refresh(p_vendor_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_since timestamptz := now() - interval '28 days';
begin
  -- Items that usually sell out, and at what Beirut hour (confirmed "sold out" changes, 2+ in 4 weeks).
  perform app_private.merchant_fact_put(p_vendor_id, 'usual_sellouts', coalesce((
    select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'hour', x.hour, 'times', x.n) order by x.n desc) from (
      select (p.payload ->> 'item_id')::uuid as item_id, count(*) as n,
        mode() within group (order by extract(hour from p.decided_at at time zone 'Asia/Beirut')::int) as hour
      from public.merchant_proposals p
      where p.vendor_id = p_vendor_id and p.kind = 'sold_out' and p.status = 'confirmed' and p.decided_at > v_since
      group by 1 having count(*) >= 2 limit 5) x), '[]'), 'changes');
  -- Weekdays the shop usually closes: paused by the merchant (or closed) on that weekday at least 3 of the last 4 weeks.
  perform app_private.merchant_fact_put(p_vendor_id, 'usual_closed_weekdays', coalesce((
    select jsonb_agg(d order by d) from (
      select extract(dow from (c.day))::int as d from public.vendor_closures c
      where c.vendor_id = p_vendor_id and c.day > (now() - interval '28 days')::date
      group by 1 having count(*) >= 3) z), '[]'), 'hours');
  -- Acceptance speed and the quietest weekday (28 days, with enough orders to mean something).
  perform app_private.merchant_fact_put(p_vendor_id, 'acceptance_median_s', to_jsonb((
    select round(percentile_cont(0.5) within group (order by extract(epoch from (o.accepted_at - o.placed_at)))::numeric)
    from public.orders o where o.vendor_id = p_vendor_id and o.placed_at > v_since and o.accepted_at is not null
      and not o.is_demo)), 'orders');
  perform app_private.merchant_fact_put(p_vendor_id, 'quiet_weekday', to_jsonb((
    select d from (
      select extract(dow from o.placed_at at time zone 'Asia/Beirut')::int as d, count(*) as n
      from public.orders o where o.vendor_id = p_vendor_id and o.placed_at > v_since and o.status = 'delivered' and not o.is_demo
      group by 1) w
    where (select count(*) from public.orders o where o.vendor_id = p_vendor_id and o.placed_at > v_since
             and o.status = 'delivered' and not o.is_demo) >= 20
    order by n, d limit 1)), 'orders');
  -- Past decisions: the last ten confirmed changes, by kind.
  perform app_private.merchant_fact_put(p_vendor_id, 'recent_changes', coalesce((
    select jsonb_agg(jsonb_build_object('kind', p.kind, 'at', p.decided_at) order by p.decided_at desc) from (
      select * from public.merchant_proposals p where p.vendor_id = p_vendor_id and p.status = 'confirmed'
      order by p.decided_at desc limit 10) p), '[]'), 'changes');
end;
$$;

-- As in 20261011170100_merchant_extras.sql: the handover's complaints count no demo rating.
create or replace function public.staff_shift_touch(p_phone_e164 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_m record;
  v_last timestamptz;
  v_out jsonb := '[]';
  v_gap interval := make_interval(hours => public.config_numeric('shift_gap_hours')::int);
begin
  for v_m in
    select m.id, m.vendor_id, m.role, coalesce(v.name_ar, v.name_en) as vendor_name from public.vendor_members m
    join public.vendors v on v.id = m.vendor_id
    where m.phone_e164 = p_phone_e164 and m.status = 'active' and m.role in ('manager', 'cashier', 'kitchen')
  loop
    select s.last_seen_at into v_last from app_private.member_shifts s where s.member_id = v_m.id for update;
    insert into app_private.member_shifts (member_id, last_seen_at, shift_started_at) values (v_m.id, now(), now())
    on conflict (member_id) do update set last_seen_at = now(),
      shift_started_at = case when app_private.member_shifts.last_seen_at < now() - v_gap then now() else app_private.member_shifts.shift_started_at end;
    if v_last is null or v_last < now() - v_gap then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'vendor_id', v_m.vendor_id, 'vendor_name', v_m.vendor_name, 'role', v_m.role,
        'pending', (select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'status', o.status,
                      'minutes', floor(extract(epoch from now() - coalesce(o.placed_at, o.created_at)) / 60)::int) order by o.placed_at), '[]')
                    from (select * from public.orders o where o.vendor_id = v_m.vendor_id and o.status in ('placed', 'accepted', 'preparing', 'ready')
                          order by o.placed_at limit 10) o),
        'pending_count', (select count(*) from public.orders o where o.vendor_id = v_m.vendor_id and o.status in ('placed', 'accepted', 'preparing', 'ready')),
        'sold_out', (select coalesce(jsonb_agg(x.name order by x.name), '[]') from (
                      select coalesce(i.name_ar, i.name_en, i.name_fr) as name from public.menu_items i
                      where i.vendor_id = v_m.vendor_id and (not i.available or (i.daily_date = current_date and i.daily_remaining = 0))
                      order by i.updated_at desc limit 10) x),
        'complaints', (select count(*) from public.orders o where o.vendor_id = v_m.vendor_id and o.cancel_request_status = 'pending')
                      + (select count(*) from public.order_ratings r where r.vendor_id = v_m.vendor_id and r.rated_at > now() - interval '24 hours'
                         and (r.food_score <= 2 or r.delivery_ok is false) and not r.is_demo)));
    end if;
  end loop;
  return v_out;
end;
$$;

-- As in 20261015200000_meta_catalogue.sql: best sellers from real orders only.
create or replace function public.catalog_best_sellers(p_vendor_id uuid, p_limit integer default 10) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(x.id order by x.n desc, x.sort_order, x.id), '{}') from (
    select i.id, i.sort_order, coalesce(sum(oi.quantity) filter (where o.created_at > now()
      - make_interval(days => public.config_numeric('catalog_best_sellers_days')::int)), 0) as n
    from public.menu_items i
    left join public.order_items oi on oi.item_id = i.id
    left join public.orders o on o.id = oi.order_id and o.status not in ('cancelled', 'rejected') and not o.is_demo
    where i.vendor_id = p_vendor_id and app_private.menu_item_orderable(i.id, 1)
    group by i.id, i.sort_order
    order by n desc, i.sort_order, i.id
    limit least(greatest(coalesce(p_limit, 10), 1), 30)
  ) x;
$$;

-- As in 20261016140000_catalogue_truth.sql: units sold count real orders only.
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
    where o.vendor_id = p_vendor_id and o.status not in ('cancelled', 'rejected') and not o.is_demo
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

-- As in 20261011100100_customer_bot.sql: "goes well with" learns from real orders only.
create or replace function public.basket_upsell(p_customer_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_pick record;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null or v_basket.upsell_shown_at is not null or v_basket.source = 'reorder' then
    return null;
  end if;
  select oi2.item_id, count(*) as n into v_pick
  from public.basket_items bi
  join public.order_items oi on oi.item_id = bi.item_id
  join public.orders o on o.id = oi.order_id and o.status = 'delivered' and o.vendor_id = v_basket.vendor_id and not o.is_demo
  join public.order_items oi2 on oi2.order_id = o.id and oi2.item_id <> bi.item_id
  where bi.basket_id = v_basket.id
    and oi2.item_id not in (select item_id from public.basket_items where basket_id = v_basket.id)
    and app_private.menu_item_orderable(oi2.item_id, 1)
  group by oi2.item_id
  order by count(*) desc, oi2.item_id
  limit 1;
  update public.baskets set upsell_shown_at = now() where id = v_basket.id;
  if v_pick.item_id is null or v_pick.n < 2 then
    return null;
  end if;
  return (select jsonb_build_object('item_id', i.id, 'name', coalesce(i.name_ar, i.name_en), 'name_en', coalesce(i.name_en, i.name_ar),
    'price_usd', i.price_usd) from public.menu_items i where i.id = v_pick.item_id);
end;
$$;

-- 5. The demo autopilot -------------------------------------------------------------------------------------------------------
create function app_private.demo_autopilot_on() returns boolean
language sql stable security definer set search_path = ''
as $$
  select cardinality(app_private.demo_vendor_ids()) > 0
    and public.config_value('demo_autopilot_enabled') is not distinct from 'true'::jsonb;
$$;

-- The orders the autopilot took, and where it stopped: done (delivered), taken_over (someone else acted), error.
create table app_private.demo_autopilot (
  order_id uuid primary key references public.orders (id) on delete cascade,
  -- The status the autopilot set last (placed when it never acted).
  step public.order_status not null,
  acted_at timestamptz not null default now(),
  stopped_at timestamptz,
  -- not_eligible: no longer a tester's or an owner's order at a demo shop (removed, expired, demo mode off).
  stop_reason text check (stop_reason in ('done', 'taken_over', 'not_eligible', 'error')),
  last_error text check (char_length(last_error) <= 300),
  constraint demo_autopilot_stopped check ((stopped_at is null) = (stop_reason is null))
);
create index demo_autopilot_running_idx on app_private.demo_autopilot (acted_at) where stopped_at is null;
alter table app_private.demo_autopilot enable row level security;
revoke all on table app_private.demo_autopilot from public, anon, authenticated;

-- Did anyone but the autopilot act on the order (since p_since, or since it was placed)? A merchant's tap, a call keypress,
-- the portal, an operator, or the customer: any order event that is not the system's (escalation layers, timers), not the
-- autopilot's and not the placement itself. A member's action counts even when it ran as the system.
create function app_private.demo_autopilot_touched(p_order_id uuid, p_since timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.order_events e
    where e.order_id = p_order_id and (p_since is null or e.at > p_since)
      and e.event <> 'placed' and e.channel is distinct from 'autopilot'
      and (e.actor_kind <> 'system' or nullif(e.detail ->> 'member_id', '') is not null));
$$;

-- An autopilot that stopped on an error tells the operators (Slack), once per order: the order now waits for a person.
create function app_private.demo_autopilot_alert(p_order_id uuid, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.ops_alert('demo_autopilot:' || p_order_id, 'tick_failed', 'warning',
    left(format('Demo autopilot stopped on order %s: %s. The order waits for a tap.',
      (select o.code from public.orders o where o.id = p_order_id), p_error), 300),
    p_order_id, (select o.vendor_id from public.orders o where o.id = p_order_id), jsonb_build_object('error', left(p_error, 300)));
end;
$$;

-- One pass (tick-30s): only while demo mode and demo_autopilot_enabled are on, only for testers' and owners' orders at demo
-- shops. Every change goes through the functions a merchant's tap uses, so the customer hears exactly what a real order says.
create function app_private.demo_autopilot_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_after numeric;
  v_step numeric;
  v_prep integer;
  v_o record;
  v_next public.order_status;
  n_accepted integer := 0;
  n_steps integer := 0;
  n_stopped integer := 0;
begin
  if not app_private.demo_autopilot_on() then
    return jsonb_build_object('status', 'off');
  end if;
  v_after := public.config_numeric('demo_autopilot_after_s');
  v_step := public.config_numeric('demo_autopilot_step_s');
  v_prep := public.config_numeric('demo_autopilot_prep_min')::integer;
  perform set_config('app.audit_reason', 'demo autopilot (DECISIONS §39.15.3)', true);

  -- 1. Placed and untouched for demo_autopilot_after_s: accepted, as Rasheed's Accept tap would.
  for v_o in
    select o.id, o.acknowledged_at from public.orders o
    where o.status = 'placed' and o.is_demo and app_private.vendor_is_demo(o.vendor_id)
      and app_private.demo_player(o.customer_id)
      and o.placed_at <= now() - make_interval(secs => v_after::double precision)
      and not exists (select 1 from app_private.demo_autopilot a where a.order_id = o.id)
    order by o.placed_at
    limit 20
    for update of o skip locked
  loop
    if v_o.acknowledged_at is not null or app_private.demo_autopilot_touched(v_o.id, null) then
      insert into app_private.demo_autopilot (order_id, step, stopped_at, stop_reason) values (v_o.id, 'placed', now(), 'taken_over');
      n_stopped := n_stopped + 1;
      continue;
    end if;
    begin
      perform app_private.order_accept(v_o.id, v_prep, null, 'autopilot');
      insert into app_private.demo_autopilot (order_id, step) values (v_o.id, 'accepted');
      n_accepted := n_accepted + 1;
    exception when others then
      insert into app_private.demo_autopilot (order_id, step, stopped_at, stop_reason, last_error)
      values (v_o.id, 'placed', now(), 'error', left(sqlerrm, 300));
      perform app_private.demo_autopilot_alert(v_o.id, sqlerrm);
      n_stopped := n_stopped + 1;
    end;
  end loop;

  -- 2. Every demo_autopilot_step_s: ready, out for delivery (picked_up), delivered; a pickup order goes from ready to collected.
  for v_o in
    select a.order_id, a.step, a.acted_at, o.status, o.fulfilment, o.delivery_code_required, o.delivery_code_confirmed_at,
      o.is_demo and app_private.vendor_is_demo(o.vendor_id) and app_private.demo_player(o.customer_id) as eligible
    from app_private.demo_autopilot a join public.orders o on o.id = a.order_id
    where a.stopped_at is null and a.acted_at <= now() - make_interval(secs => v_step::double precision)
    order by a.acted_at
    limit 50
    for update of a, o skip locked
  loop
    -- Checked at every step, not only at the accept: a tester removed or expired, or demo mode off, ends it here.
    if not v_o.eligible then
      update app_private.demo_autopilot set stopped_at = now(), stop_reason = 'not_eligible' where order_id = v_o.order_id;
      n_stopped := n_stopped + 1;
      continue;
    end if;
    if v_o.status is distinct from v_o.step or app_private.demo_autopilot_touched(v_o.order_id, v_o.acted_at) then
      update app_private.demo_autopilot set stopped_at = now(), stop_reason = 'taken_over' where order_id = v_o.order_id;
      n_stopped := n_stopped + 1;
      continue;
    end if;
    v_next := case v_o.step
      when 'accepted' then 'ready'
      when 'ready' then case when v_o.fulfilment = 'pickup' then 'delivered' else 'picked_up' end
      when 'picked_up' then 'delivered' end;
    if v_next is null then
      update app_private.demo_autopilot set stopped_at = now(), stop_reason = 'done' where order_id = v_o.order_id;
      continue;
    end if;
    begin
      if v_next = 'delivered' and v_o.delivery_code_required and v_o.delivery_code_confirmed_at is null then
        -- At the door the driver types the customer's code (§27.6); on a pretend order the autopilot is the driver.
        update public.orders set delivery_code_confirmed_at = now() where id = v_o.order_id;
        insert into public.order_events (order_id, from_status, to_status, event, actor_kind, channel, detail)
        values (v_o.order_id, v_o.status, v_o.status, 'delivery_code_autopilot', 'system', 'autopilot', '{}');
      end if;
      perform app_private.order_progress(v_o.order_id, v_next, null, 'autopilot');
      update app_private.demo_autopilot set step = v_next, acted_at = now(),
        stopped_at = case when v_next = 'delivered' then now() end,
        stop_reason = case when v_next = 'delivered' then 'done' end
      where order_id = v_o.order_id;
      n_steps := n_steps + 1;
    exception when others then
      update app_private.demo_autopilot set stopped_at = now(), stop_reason = 'error', last_error = left(sqlerrm, 300)
      where order_id = v_o.order_id;
      perform app_private.demo_autopilot_alert(v_o.order_id, sqlerrm);
      n_stopped := n_stopped + 1;
    end;
  end loop;
  -- The tick's other steps run in the same transaction: the reason is not theirs.
  perform set_config('app.audit_reason', '', true);
  return jsonb_build_object('status', 'ok', 'accepted', n_accepted, 'steps', n_steps, 'stopped', n_stopped);
end;
$$;

-- As in 20261016100000_staging_load.sql, with the autopilot before the dispatch kick (its messages go out in the same tick).
create or replace function app_private.tick_30s() returns jsonb
language sql security definer set search_path = ''
as $$
  select app_private.tick_steps('tick-30s', array['order_escalation_tick', 'order_monitor_tick', 'recovery_tick',
    'customer_bot_tick', 'demo_autopilot_tick', 'dispatch_kick']);
$$;

-- 7. Testers order only from the demo shops; a demo order never counts against a shop (review of this PR) ----------------
-- As in 20261015220000_demo_mode.sql, with demo testers: while demo mode is on a tester sees only the demo shops (search,
-- browse, the dish search, pickup, alternatives), so a pretend order never starts at a real shop.
create or replace function app_private.customer_hidden_vendors(p_customer_id uuid) returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case
      when cardinality(app_private.demo_vendor_ids()) = 0 then '{}'::uuid[]
      when app_private.is_sim_phone(c.phone_e164) then
        case when exists (select 1 from app_private.sim_demo_customers s where s.phone_e164 = c.phone_e164)
             then '{}'::uuid[] else app_private.demo_vendor_ids() end
      when exists (select 1 from app_private.owner_phones o where o.phone_e164 = c.phone_e164) then '{}'::uuid[]
      when app_private.is_demo_tester(c.id) then
        coalesce((select array_agg(v.id) from public.vendors v
                  where (v.orderable or v.is_test) and not (v.id = any (app_private.demo_vendor_ids()))), '{}')
      else coalesce((select array_agg(v.id) from public.vendors v where v.is_test), '{}')
    end
    from public.customers c where c.id = p_customer_id), '{}');
$$;

-- As in 20261014150000_dispatch_stall_replay.sql, with §39.15.3: a demo tester's basket is only ever a demo shop's
-- (status demo_only; the bot offers the demo shops). A tap, a catalogue cart, a saved cart and the model's tools come through
-- here; a reorder fills its basket itself (basket_reorder, below, has the same check).
create or replace function public.basket_add_item(
  p_customer_id uuid,
  p_item_id uuid,
  p_quantity integer default 1,
  p_option_ids uuid[] default '{}',
  p_note text default null,
  p_replace boolean default false,
  p_op_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items%rowtype;
  v_vendor public.vendors%rowtype;
  v_basket public.baskets%rowtype;
  v_qty integer := least(greatest(coalesce(p_quantity, 1), 1), 50);
  v_line uuid;
  v_opts uuid[] := coalesce((select array_agg(x order by x) from unnest(coalesce(p_option_ids, '{}')) x), '{}');
begin
  if p_op_key is not null and exists (select 1 from app_private.basket_add_ops o where o.op_key = p_op_key) then
      -- Already added by an earlier attempt of the same turn: the basket as it is now.
      return jsonb_build_object('status', 'added', 'replayed', true,
        'line_id', (select bi.id from public.basket_items bi join public.baskets b on b.id = bi.basket_id
                    where b.customer_id = p_customer_id and b.status = 'open' and bi.item_id = p_item_id
                    order by bi.created_at desc limit 1),
        'basket', public.basket_view(p_customer_id));
  end if;
  select * into v_item from public.menu_items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('status', 'unknown_item');
  end if;
  select * into v_vendor from public.vendors where id = v_item.vendor_id;
  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if app_private.is_demo_tester(p_customer_id) and not app_private.vendor_is_demo(v_vendor.id) then
    return jsonb_build_object('status', 'demo_only', 'item', coalesce(v_item.name_ar, v_item.name_en),
      'item_en', coalesce(v_item.name_en, v_item.name_ar));
  end if;
  if not app_private.menu_item_orderable(p_item_id, v_qty) then
    return jsonb_build_object('status', 'unavailable', 'item', coalesce(v_item.name_ar, v_item.name_en));
  end if;
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is not null and v_basket.vendor_id <> v_vendor.id then
    if not p_replace then
      return jsonb_build_object('status', 'other_vendor',
        'basket_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id));
    end if;
    update public.baskets set status = 'abandoned' where id = v_basket.id;
    v_basket := null;
  end if;
  if v_basket.id is null then
    insert into public.baskets (customer_id, vendor_id, address_id)
    values (p_customer_id, v_vendor.id,
      (select a.id from public.addresses a where a.customer_id = p_customer_id order by a.is_default desc, a.last_used_at desc nulls last limit 1))
    returning * into v_basket;
  end if;
  select bi.id into v_line from public.basket_items bi
  where bi.basket_id = v_basket.id and bi.item_id = p_item_id and bi.option_ids = v_opts
    and bi.note is not distinct from nullif(trim(p_note), '');
  if v_line is not null then
    update public.basket_items set quantity = least(quantity + v_qty, 50) where id = v_line;
  else
    insert into public.basket_items (basket_id, item_id, quantity, option_ids, note)
    values (v_basket.id, p_item_id, v_qty, v_opts, left(nullif(trim(p_note), ''), 200))
    returning id into v_line;
  end if;
  update public.baskets set last_activity_at = now(), reminded_at = null where id = v_basket.id;
  -- Recorded only now: an add that was refused (unknown, closed, unavailable, other shop) is answered again. Two
  -- calls with one key at the same moment cannot both add: the second hits the primary key and rolls back.
  if p_op_key is not null then
    insert into app_private.basket_add_ops (op_key, customer_id) values (p_op_key, p_customer_id);
  end if;
  return jsonb_build_object('status', 'added', 'line_id', v_line, 'basket', public.basket_view(p_customer_id));
end;
$$;

-- As in 20261011100200_customer_bot_voice.sql: a demo address is not the customer's point once they are out of the test.
create or replace function public.customer_search_point(p_customer_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('lat', extensions.st_y(a.pin::extensions.geometry), 'lon', extensions.st_x(a.pin::extensions.geometry),
    'address_id', a.id)
  from public.addresses a
  where a.customer_id = p_customer_id and a.pin is not null
    and (a.demo_key is null or app_private.demo_addresses_for(p_customer_id))
  order by (a.id = (select b.address_id from public.baskets b where b.customer_id = p_customer_id and b.status = 'open')) desc nulls last,
    a.is_default desc, a.last_used_at desc nulls last
  limit 1;
$$;

-- As in 20261015120100_customer_agent.sql: a basket on a demo address whose customer is out of the test asks for a pin
-- again, and demo addresses are not offered among the saved ones then.
create or replace function public.basket_address_state(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_a public.addresses%rowtype;
  v_demo boolean := app_private.demo_addresses_for(p_customer_id);
begin
  select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if v_b.fulfilment <> 'delivery' then
    return jsonb_build_object('status', 'ok', 'reason', 'pickup');
  end if;
  select * into v_a from public.addresses where id = v_b.address_id and customer_id = p_customer_id;
  if v_a.id is null or v_a.pin is null or (v_a.demo_key is not null and not v_demo) then
    return jsonb_build_object('status', 'no_address');
  end if;
  if v_b.address_confirmed_at is null and app_private.basket_address_confirmed(v_b.id) then
    update public.baskets set address_confirmed_at = now() where id = v_b.id;
    v_b.address_confirmed_at := now();
  end if;
  if v_b.address_confirmed_at is null then
    return jsonb_build_object('status', 'confirm', 'address', public.address_card(v_a.id), 'address_id', v_a.id,
      'label', v_a.label, 'recipient_name', v_a.recipient_name,
      'others', coalesce((select jsonb_agg(jsonb_build_object('address_id', a.id, 'card', public.address_card(a.id), 'label', a.label,
          'recipient_name', a.recipient_name) order by a.last_used_at desc nulls last)
        from (select * from public.addresses a where a.customer_id = p_customer_id and a.saved and a.id <> v_a.id and a.pin is not null
                and (a.demo_key is null or v_demo)
              order by a.last_used_at desc nulls last limit 8) a), '[]'));
  end if;
  -- §22.1: who is it for, asked once per address that is not one of the customer's own saved ones.
  if v_a.for_whom is null and not v_a.saved then
    return jsonb_build_object('status', 'for_whom', 'address', public.address_card(v_a.id), 'address_id', v_a.id);
  end if;
  if v_a.for_whom = 'other' and not v_b.is_gift then
    if v_a.recipient_phone is null then
      return jsonb_build_object('status', 'recipient', 'address_id', v_a.id);
    end if;
    update public.baskets set is_gift = true, recipient_name = v_a.recipient_name, recipient_phone = v_a.recipient_phone
    where id = v_b.id;
  end if;
  return jsonb_build_object('status', 'ok', 'gift', v_a.for_whom = 'other', 'recipient_name', v_a.recipient_name,
    'address_id', v_a.id, 'address', public.address_card(v_a.id));
end;
$$;

-- As in 20261011090200_order_channels_escalation.sql: a demo order nobody answered is cancelled with the apology as before,
-- but it never counts against the shop: no missed-order streak, no auto-pause, no reactivation message, and the shop's
-- other waiting orders are left alone.
create or replace function app_private.dispatch_give_up(p_order_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_streak integer;
  v_limit integer := public.config_numeric('auto_pause_missed_streak')::integer;
  v_other record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status <> 'placed' then
    return;
  end if;
  update public.order_dispatch set stage = 'gave_up', closed_at = now() where order_id = p_order_id;
  update public.orders set cancel_reason = 'merchant_unreachable' where id = p_order_id;
  perform app_private.order_set_status(p_order_id, 'cancelled', array['placed']::public.order_status[],
    'cancelled_merchant_unreachable', 'system', '{}');
  if v_order.is_demo then
    perform app_private.ops_alert('given_up:' || p_order_id, 'order_given_up', 'info',
      'Demo order ' || v_order.code || ' cancelled: nobody answered it (it does not count against the shop)', p_order_id,
      v_order.vendor_id);
    return;
  end if;
  update public.vendors set missed_orders_streak = missed_orders_streak + 1 where id = v_order.vendor_id
  returning missed_orders_streak into v_streak;
  perform app_private.ops_alert('given_up:' || p_order_id, 'order_given_up', 'warning',
    'Order ' || v_order.code || ' cancelled: merchant did not answer through all four layers', p_order_id, v_order.vendor_id);

  if v_streak >= v_limit then
    perform app_private.vendor_set_pause(v_order.vendor_id, 'infinity', 'missed_orders', 'auto_pause');
    perform app_private.ops_alert('auto_pause:' || v_order.vendor_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), 'merchant_auto_paused', 'urgent',
      'Merchant auto-paused after ' || v_streak || ' missed orders in a row', null, v_order.vendor_id);
    perform app_private.outbox_add('reactivate:' || v_order.vendor_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'), null, v_order.vendor_id,
      'whatsapp', 'reactivate', (select c.call_target from app_private.vendor_channels(v_order.vendor_id) c),
      jsonb_build_object('missed', v_streak));
    -- Its other waiting orders are cancelled; customers get apologies and alternatives (session 4 bot).
    for v_other in select o.id from public.orders o where o.vendor_id = v_order.vendor_id and o.status = 'placed' loop
      update public.orders set cancel_reason = 'merchant_paused' where id = v_other.id;
      perform app_private.order_set_status(v_other.id, 'cancelled', array['placed']::public.order_status[], 'cancelled_merchant_paused', 'system', '{}');
    end loop;
  end if;
end;
$$;

-- As in 20261011100100_customer_bot.sql, with §39.15.3: "Same again" is refused for a demo tester whose order was at a shop
-- that is not a demo shop (an order from before the test): no basket is made there.
create or replace function public.basket_reorder(p_customer_id uuid, p_order_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_basket uuid;
  v_skipped jsonb := '[]';
  v_line record;
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = p_customer_id;
  if v_order.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if not exists (select 1 from public.vendors v where v.id = v_order.vendor_id and v.orderable and v.listing_status = 'active') then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if app_private.is_demo_tester(p_customer_id) and not app_private.vendor_is_demo(v_order.vendor_id) then
    return jsonb_build_object('status', 'demo_only');
  end if;
  update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
  insert into public.baskets (customer_id, vendor_id, address_id, fulfilment, source, upsell_shown_at)
  values (p_customer_id, v_order.vendor_id, v_order.address_id, v_order.fulfilment, 'reorder', now())
  returning id into v_basket;
  for v_line in
    select i.item_id, i.quantity, i.note, i.has_empty,
      coalesce((select array_agg((x ->> 'id')::uuid order by (x ->> 'id')) from jsonb_array_elements(i.options) x), '{}') as opts,
      coalesce(i.name_ar, i.name_en) as name
    from public.order_items i where i.order_id = p_order_id
  loop
    if v_line.item_id is not null and app_private.menu_item_orderable(v_line.item_id, v_line.quantity) then
      insert into public.basket_items (basket_id, item_id, quantity, option_ids, note, has_empty)
      values (v_basket, v_line.item_id, v_line.quantity, v_line.opts, v_line.note, v_line.has_empty);
    else
      v_skipped := v_skipped || to_jsonb(v_line.name);
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'skipped', v_skipped, 'basket', public.basket_view(p_customer_id));
end;
$$;

-- As in 20261015160100_kapso_messaging.sql, with §39.15.3: a pretend order (a demo tester's, or at a demo shop) is offered as
-- a gift only to someone inside the test (another tester, an owner, a simulator number); otherwise demo_recipient and
-- nothing is sent (the outbound guard holds the same line).
create or replace function public.gift_request_create(p_customer_id uuid, p_basket_id uuid, p_menu_version bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_r public.customers%rowtype;
  v_q jsonb;
  v_id uuid;
  v_sender public.customers%rowtype;
  v_fp text;
  v_pending public.gift_requests%rowtype;
begin
  select * into v_b from public.baskets where id = p_basket_id and customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null or not v_b.is_gift then
    return jsonb_build_object('status', 'not_gift');
  end if;
  if (app_private.is_demo_tester(p_customer_id) or app_private.vendor_is_demo(v_b.vendor_id))
     and not app_private.demo_phone_in_test(v_b.recipient_phone) then
    return jsonb_build_object('status', 'demo_recipient', 'recipient_name', v_b.recipient_name);
  end if;
  if v_b.priced_menu_version is distinct from p_menu_version then
    return jsonb_build_object('status', 'repriced');
  end if;
  v_q := public.basket_quote(p_customer_id);
  if v_q ->> 'status' <> 'ok' then
    return jsonb_build_object('status', v_q ->> 'status');
  end if;
  if (v_q ->> 'over_cod_cap')::boolean then
    return jsonb_build_object('status', 'cod_cap');
  end if;
  select * into v_r from public.customers where phone_e164 = v_b.recipient_phone;
  if v_r.gift_blocked_at is not null then
    return jsonb_build_object('status', 'blocked');
  end if;
  -- Inside the recipient's window on our number, or through the approved gift template (5b, §22.3).
  if not app_private.whatsapp_reachable(v_b.recipient_phone, 'customer', 'gift_request', coalesce(v_r.language::text, 'ar')) then
    return jsonb_build_object('status', 'unreachable', 'recipient_name', v_b.recipient_name);
  end if;
  v_fp := app_private.gift_fingerprint(v_b.id, v_q);
  select * into v_pending from public.gift_requests
  where basket_id = v_b.id and status = 'pending' and expires_at > now() for update;
  if v_pending.id is not null and v_pending.fingerprint = v_fp then
    return jsonb_build_object('status', 'asked', 'gift_id', v_pending.id, 'recipient_name', v_pending.recipient_name,
      'minutes', greatest(1, ceil(extract(epoch from v_pending.expires_at - now()) / 60)), 'again', true);
  end if;
  if (select count(*) from public.gift_requests
      where sender_id = p_customer_id and recipient_phone = v_b.recipient_phone
        and created_at > now() - interval '24 hours') >= public.config_numeric('gift_requests_per_day') then
    return jsonb_build_object('status', 'too_many', 'recipient_name', v_b.recipient_name);
  end if;
  update public.gift_requests set status = 'expired', decided_at = now() where basket_id = v_b.id and status = 'pending';
  select * into v_sender from public.customers where id = p_customer_id;
  insert into public.gift_requests (basket_id, sender_id, recipient_phone, recipient_name, menu_version, total_usd, fingerprint, expires_at)
  values (v_b.id, p_customer_id, v_b.recipient_phone, v_b.recipient_name, p_menu_version, (v_q ->> 'total_usd')::numeric, v_fp,
          now() + make_interval(mins => public.config_numeric('gift_accept_minutes')::int))
  returning id into v_id;
  perform app_private.outbox_add('gift:' || v_id, null, v_b.vendor_id, 'whatsapp', 'customer_message', v_b.recipient_phone,
    jsonb_build_object('kind', 'gift_request', 'lang', coalesce(v_r.language::text, 'ar'), 'gift_id', v_id,
      'sender', coalesce(v_sender.display_name, ''), 'vendor', v_q -> 'basket' ->> 'vendor', 'vendor_en', v_q -> 'basket' ->> 'vendor_en',
      'lines', (select jsonb_agg(jsonb_build_object('q', l -> 'quantity', 'name', l ->> 'name', 'name_en', l ->> 'name_en'))
                from jsonb_array_elements(v_q -> 'basket' -> 'lines') l),
      'total_usd', v_q -> 'total_usd', 'total_lbp', v_q -> 'total_lbp', 'usd_lbp_rate', v_q -> 'usd_lbp_rate',
      'place', v_q -> 'address' ->> 'place', 'place_en', v_q -> 'address' ->> 'place_en'));
  return jsonb_build_object('status', 'asked', 'gift_id', v_id, 'recipient_name', v_b.recipient_name,
    'minutes', public.config_numeric('gift_accept_minutes'));
end;
$$;

-- Grants --------------------------------------------------------------------------------------------------------------------
revoke all on function app_private.is_demo_tester(uuid), app_private.demo_player(uuid), app_private.demo_tester_remove(text, text),
  app_private.mask_phone(text), app_private.demo_address_choices(), app_private.demo_addresses_for(uuid),
  app_private.demo_autopilot_on(), app_private.demo_autopilot_touched(uuid, timestamptz), app_private.demo_autopilot_tick(),
  app_private.demo_autopilot_alert(uuid, text), app_private.demo_phone_in_test(text)
  from public, anon, authenticated;
revoke all on function public.demo_tester_enrol(uuid, text), public.demo_tester_remove_by_owner(text, text),
  public.ops_demo_testers(uuid), public.ops_demo_tester_remove(uuid, text), public.demo_address_pick(uuid, text)
  from public, anon, authenticated;
grant execute on function public.demo_tester_enrol(uuid, text), public.demo_tester_remove_by_owner(text, text),
  public.ops_demo_testers(uuid), public.ops_demo_tester_remove(uuid, text), public.demo_address_pick(uuid, text)
  to service_role;

-- The public item page's "Goes well with" (20261016160000_item_pages.sql) leaves demo orders out: they are pretend
-- orders and the page is public. Otherwise as there.
create or replace function app_private.site_item(p_item_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'item', jsonb_build_object(
      'id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'name_fr', i.name_fr,
      'description', nullif(btrim(i.description), ''),
      'price_usd', i.price_usd, 'per_kg', i.pricing_unit = 'kg', 'est_weight_kg', i.est_weight_kg,
      'available', app_private.menu_item_orderable(i.id, 1),
      'vegetarian', i.vegetarian, 'vegan', i.vegan, 'spicy', i.spicy_level,
      'pork', i.contains_pork, 'alcohol', i.contains_alcohol,
      'photo', p.item_id is not null,
      'photo_source', p.source,
      -- The shop's own photo needs no credit; every other photo carries its license and author (§38.1, §39.13).
      'credit', case when p.source is not null and p.source <> 'merchant'
                     then jsonb_build_object('credit', p.credit, 'license', p.license, 'source_url', p.source_url) end),
    'vendor', jsonb_build_object(
      'slug', v.slug, 'name_ar', v.name_ar, 'name_en', v.name_en, 'name_fr', v.name_fr,
      'place_slug', case when pl.service_status = 'on' then app_private.place_slug(v.town_id) end, 'place_ar', pl.name_ar, 'place_en', pl.name_en, 'place_fr', pl.name_fr,
      'orderable', v.orderable, 'paused', public.vendor_is_paused(v.id),
      'open_now', app_private.vendor_open_at(v.id) and not public.vendor_is_paused(v.id),
      'demo', app_private.vendor_is_demo(v.id), 'public_page', v.public_page,
      -- The shop has its own page to link to (site_vendor answers for public_page, site_vendor_demo for a demo shop).
      'has_page', v.public_page or app_private.vendor_is_demo(v.id)),
    'nutrition', case when nu.status in ('merchant_verified', 'estimated') and nu.kcal is not null then jsonb_build_object(
      'kcal', round(nu.kcal), 'protein_g', round(nu.protein_g, 1), 'carbs_g', round(nu.carbs_g, 1), 'fat_g', round(nu.fat_g, 1),
      'status', nu.status) end,
    'allergens', case when i.allergens_confirmed_at is not null then to_jsonb(coalesce(i.allergens, '{}')) end,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object('name_ar', g.name_ar, 'name_en', g.name_en, 'name_fr', g.name_fr,
          'min', g.min_select, 'max', g.max_select,
          'options', coalesce((
            select jsonb_agg(jsonb_build_object('name_ar', o.name_ar, 'name_en', o.name_en, 'name_fr', o.name_fr,
                'price_usd', o.price_delta_usd) order by o.sort_order, o.name_en)
            from public.menu_options o where o.group_id = g.id and o.available), '[]'::jsonb))
        order by g.sort_order, g.name_en)
      from public.menu_option_groups g where g.item_id = i.id), '[]'::jsonb),
    'goes_well', (
      select jsonb_build_object('id', w.id, 'name_ar', w.name_ar, 'name_en', w.name_en, 'name_fr', w.name_fr,
        'price_usd', w.price_usd, 'per_kg', w.pricing_unit = 'kg',
        'photo', exists (select 1 from public.menu_item_photos wp where wp.item_id = w.id))
      from (
        -- Orders, not lines: an order holding the item on two lines (two sizes) counts once. Ranked first, then only the
        -- top few are checked for being orderable now (the check runs per candidate, never per order line).
        select c.item_id from (
          select oi2.item_id, count(distinct o.id) as n
          from public.order_items oi
          join public.orders o on o.id = oi.order_id and o.status = 'delivered' and o.vendor_id = v.id and not o.is_demo
          join public.order_items oi2 on oi2.order_id = o.id and oi2.item_id <> oi.item_id
          where oi.item_id = i.id
          group by oi2.item_id
          having count(distinct o.id) >= 2
          order by count(distinct o.id) desc, oi2.item_id
          limit 5) c
        where app_private.menu_item_orderable(c.item_id, 1)
        order by c.n desc, c.item_id
        limit 1
      ) b join public.menu_items w on w.id = b.item_id and w.removed_at is null),
    'rate', public.usd_lbp_rate())
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.places pl on pl.id = v.town_id
  left join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_item_nutrition nu on nu.item_id = i.id
  where i.id = p_item_id and i.removed_at is null and app_private.item_page_visible(v.id);
$$;
