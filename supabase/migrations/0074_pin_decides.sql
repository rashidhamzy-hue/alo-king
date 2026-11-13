-- Alo King Chouf: session B4, the founder's first live order (13 Nov 2026, 18:43-18:58 UTC; docs/HANDOFF.md, "0.13 first real attempt").
-- He sent a pin in Khraibeh and the bot said Baakline: save_customer_pin took the village the conversation already had from the
-- text (p_village) and never looked at the pin, and no village had coordinates to look at anyway. From here the pin decides:
--   * Village centres are data (invariant 13): village_coords holds them, from OpenStreetMap (Nominatim, ODbL, looked up on
--     13 Nov 2026 with scripts/fetch_village_coords.mjs, then by Arabic name for the ones it missed). A row fills villages.lat/lng
--     when they are empty, now and whenever a village is inserted later (the seed loads after the migrations). Correct a centre
--     by updating villages; this table is only the first fill. Jdeidet ech Chouf has no OpenStreetMap node: it stays empty
--     until someone drops its pin, and a pin near it is never placed alone (below).
--   * locate_pin() places a pin in the nearest village centre when that centre is within settings.pin_locate.max_km and clearly
--     nearer than the next one (margin_km). Otherwise it is "unsure" and the customer chooses between the nearest villages,
--     by button. A village the customer named that has no centre makes it "unsure" too: unknown is never safe.
--   * save_customer_pin() keeps the pin's village, never the text's. What the text said comes back as said_village_id so the
--     reply can say which one wins.
--   * set_pin_village() records the customer's own tap when the pin was unsure; set_place_details() keeps the house, floor and
--     the customer's own words on the place, for the rider.
--   * village_in_text() finds a village written in the message («عبعقلين», "3a b3aklin") when the model did not put it in
--     address.village. It is only a hint for pricing before the pin; it never overrides a pin.

create table if not exists village_coords (
  name_en text primary key,
  lat     double precision not null,
  lng     double precision not null,
  source  text not null default 'openstreetmap/nominatim 2026-11-13'
);

insert into village_coords(name_en, lat, lng) values
  ('Baakline', 33.67739, 35.56355), ('Baqaata', 33.66658, 35.59975), ('Semqaniyeh', 33.67786, 35.58985),
  ('Ain w Zein', 33.68100, 35.61056), ('Aainbal', 33.66229, 35.56184), ('Beiteddine', 33.69403, 35.58067),
  ('Deir el Qamar', 33.69797, 35.56474), ('Moukhtara', 33.65738, 35.61336), ('Botmeh', 33.66126, 35.62234),
  ('Ain Qani', 33.65104, 35.61408), ('Mazraat ech Chouf', 33.64614, 35.58010), ('Kahlouniyeh', 33.64977, 35.59037),
  ('Gharifeh', 33.63051, 35.55663), ('Aatrine', 33.66463, 35.56826), ('Kfarnabrakh', 33.69470, 35.63329),
  ('Batloun', 33.69550, 35.65221), ('Maasser Beiteddine', 33.69830, 35.59858), ('Kfarhim', 33.68803, 35.52322),
  ('Deir Dourit', 33.67688, 35.53520), ('Deir Baba', 33.69795, 35.51880), ('Kfarfaqoud', 33.70119, 35.53796),
  ('Bchetfine', 33.71446, 35.55196), ('Fouara', 33.71143, 35.64086), ('Warhaniyeh', 33.72125, 35.67419),
  ('Barouk', 33.70411, 35.68119), ('Fraidis', 33.71096, 35.67738), ('Maasser ech Chouf', 33.66832, 35.67062),
  ('Khraibeh', 33.64820, 35.64497), ('Baadarane', 33.63712, 35.62025), ('Aammatour', 33.64277, 35.60832),
  ('Haret Jandal', 33.62871, 35.60671), ('Jbaa', 33.60426, 35.64355), ('Mristi', 33.62069, 35.65619),
  ('Niha', 33.59632, 35.62640), ('Ain Zhalta', 33.74064, 35.69889), ('Brih', 33.71470, 35.65729),
  ('Kfar Qatra', 33.70990, 35.58873), ('Wadi es Sitt', 33.71480, 35.62838), ('Serjbal', 33.68459, 35.51179),
  ('Dmit', 33.69267, 35.50596), ('Kfarnis', 33.73808, 35.64153)
on conflict (name_en) do nothing;

update villages v set lat = c.lat, lng = c.lng from village_coords c where c.name_en = v.name_en and v.lat is null and v.lng is null;

create or replace function villages_fill_coords() returns trigger language plpgsql as $$
begin
  if new.lat is null and new.lng is null then
    select c.lat, c.lng into new.lat, new.lng from village_coords c where c.name_en = new.name_en;
  end if;
  return new;
end $$;
drop trigger if exists villages_fill_coords on villages;
create trigger villages_fill_coords before insert on villages for each row execute function villages_fill_coords();

insert into settings(key, value) values ('pin_locate', '{"max_km": 2.5, "margin_km": 0.4, "ask_candidates": 3}') on conflict (key) do nothing;

create or replace function geo_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
           + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Where is this pin? located: one village, clearly. unsure: the customer chooses from `candidates`. outside: no village near.
create or replace function locate_pin(p_lat double precision, p_lng double precision, p_said uuid default null) returns jsonb
language plpgsql stable as $$
declare s jsonb := coalesce(setting('pin_locate'), '{}'); v_max numeric := coalesce((s->>'max_km')::numeric, 2.5);
        v_margin numeric := coalesce((s->>'margin_km')::numeric, 0.4); v_n int := coalesce((s->>'ask_candidates')::int, 3);
        near jsonb; d1 numeric; d2 numeric; v_status text; v_said_has_coords boolean;
begin
  select coalesce(jsonb_agg(x order by x.km), '[]') into near from (
    select v.id as village_id, v.name_en, v.name_ar, v.is_served, round(geo_km(p_lat, p_lng, v.lat, v.lng)::numeric, 2) as km
      from villages v where v.lat is not null and v.lng is not null
     order by geo_km(p_lat, p_lng, v.lat, v.lng) limit greatest(v_n, 2)) x;
  d1 := (near->0->>'km')::numeric; d2 := coalesce((near->1->>'km')::numeric, 1e9);
  v_said_has_coords := p_said is null or exists (select 1 from villages where id = p_said and lat is not null);
  v_status := case when d1 is null or d1 > 2 * v_max then 'outside'
                   when d1 <= v_max and d2 - d1 >= v_margin and v_said_has_coords then 'located'
                   else 'unsure' end;
  return jsonb_build_object('status', v_status,
    'village_id', case when v_status = 'located' then near->0->>'village_id' end,
    'km', d1,
    -- What the customer chooses from when unsure: the nearest centres, and the village they named if it has no centre.
    'candidates', case when v_status = 'located' then '[]'::jsonb else (
      select coalesce(jsonb_agg(c), '[]') from (
        select c from (select c, 0 as o from jsonb_array_elements(near) c where (c->>'km')::numeric <= 2 * v_max
               union all select jsonb_build_object('village_id', v.id, 'name_en', v.name_en, 'name_ar', v.name_ar, 'is_served', v.is_served, 'km', null), -1
                 from villages v where v.id = p_said and v.lat is null) u
        order by o, (c->>'km')::numeric nulls first limit v_n) t) end);
end $$;

-- Same signature as 0003. p_village is what the conversation believed before the pin (usually from the text): it never decides.
create or replace function save_customer_pin(p_party uuid, p_lat double precision, p_lng double precision, p_village uuid default null)
returns jsonb language plpgsql as $$
declare loc jsonb := locate_pin(p_lat, p_lng, p_village); v_village uuid := (loc->>'village_id')::uuid; v_place uuid;
begin
  insert into customer_places(party_id, village_id, lat, lng, last_used_at) values (p_party, v_village, p_lat, p_lng, now())
    returning id into v_place;
  return jsonb_build_object('place_id', v_place, 'village_id', v_village, 'status', loc->>'status', 'km', loc->'km',
    'village', (select name_en from villages where id = v_village), 'village_ar', (select name_ar from villages where id = v_village),
    'served', (select is_served from villages where id = v_village),
    'said_village_id', p_village, 'said_village_ar', (select name_ar from villages where id = p_village),
    'candidates', loc->'candidates');
end $$;

-- The customer's tap when the pin was unsure. Only on their own place, only a village that was near the pin (or the one they named).
create or replace function set_pin_village(p_party uuid, p_place uuid, p_village uuid) returns jsonb language plpgsql as $$
declare cp customer_places%rowtype; v villages%rowtype;
begin
  select * into cp from customer_places where id = p_place and party_id = p_party for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_your_place'); end if;
  select * into v from villages where id = p_village;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_village'); end if;
  if cp.lat is not null and v.lat is not null and geo_km(cp.lat, cp.lng, v.lat, v.lng) > 2 * coalesce((setting('pin_locate')->>'max_km')::numeric, 2.5) then
    return jsonb_build_object('ok', false, 'reason', 'too_far_from_pin');
  end if;
  update customer_places set village_id = p_village, last_used_at = now() where id = p_place;
  return jsonb_build_object('ok', true, 'village_id', v.id, 'village', v.name_en, 'village_ar', v.name_ar, 'served', v.is_served);
end $$;

-- The house, floor and the customer's own words, kept on their place for the rider. Never overwrites with nothing.
create or replace function set_place_details(p_party uuid, p_place uuid, p_building text default null, p_floor text default null,
                                             p_directions text default null) returns boolean language plpgsql as $$
begin
  update customer_places set building = coalesce(nullif(btrim(p_building), ''), building), floor = coalesce(nullif(btrim(p_floor), ''), floor),
         directions = coalesce(nullif(left(btrim(p_directions), 500), ''), directions), last_used_at = now()
   where id = p_place and party_id = p_party;
  return found;
end $$;

-- Has the rider more than a pin to go on? A first delivery to a place with no house or directions gets one question.
create or replace function place_has_details(p_place uuid) returns boolean language sql stable as $$
  select coalesce((select length(coalesce(cp.building, '') || coalesce(cp.directions, '')) >= 3 from customer_places cp where cp.id = p_place), false)
$$;

-- A village named in the message, as a whole word, with the Arabic proclitics people write onto it (ع، ب، ل، و، من، عال، بال).
-- One village or nothing: two different villages in one message is a question for the pin, not a guess.
create or replace function village_in_text(p_text text) returns jsonb language plpgsql stable as $$
declare t text := ' ' || regexp_replace(fold_text(p_text), '[^[:alnum:][:space:]]', ' ', 'g') || ' '; hit uuid; n int;
begin
  t := regexp_replace(t, '\s+', ' ', 'g');
  select count(distinct v.id), min(v.id::text)::uuid into n, hit from villages v,
    lateral (select fold_text(f) as f from unnest(array[v.name_ar, v.name_en, regexp_replace(v.name_ar, '^ال', '')] || v.aliases) f
              where f is not null and length(fold_text(f)) >= 3) names
   where t ~ ('\s(و|ف)?(من|ع|ب|ل|عال|بال|لل|ال|el |al |3a |3al |b |bi |fi |la )?' || names.f || '\s')
     -- "حي X" / "7ay X" is a neighbourhood called X, never the village X.
     and t !~ ('\s(حي|حاره|7ay|hay|7ayy)\s' || names.f || '\s');
  if n = 1 then
    return (select jsonb_build_object('village_id', id, 'name_en', name_en, 'name_ar', name_ar, 'is_served', is_served) from villages where id = hit);
  end if;
  return null;
end $$;

do $$ declare r text;
begin
  alter table village_coords enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table village_coords from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
