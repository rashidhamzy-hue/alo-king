-- Alo King Chouf: session K1, docs/AUDIT-2026-11-14.md item 5. Saved places from before "the pin decides" (0074).
-- On 13 Nov the founder's place was saved as Baakline (from his text) with a pin in Khraibeh. Every saved place with a pin and a
-- village is checked once against locate_pin(): where the pin is clearly in another village, outside every village, or between
-- villages none of which is the saved one, the place is set aside: its village and pin are cleared (so plan_order never picks
-- it as "the usual place" and no path treats it as pinned) and what it said is kept in place_rechecks. The next order asks for
-- the pin again, and the pin decides. The building, floor and directions stay on the place for the rider's record.

create table if not exists place_rechecks (
  place_id       uuid primary key references customer_places(id) on delete cascade,
  party_id       uuid not null references parties(id) on delete cascade,
  old_village_id uuid references villages(id),
  pin_village_id uuid references villages(id),
  status         text not null,                -- what locate_pin said: located (elsewhere), unsure, outside
  lat            double precision not null,
  lng            double precision not null,
  km             numeric,
  checked_at     timestamptz not null default now()
);

create or replace function recheck_places() returns jsonb language plpgsql as $$
declare n int;
begin
  with chk as (
    select cp.id, cp.party_id, cp.village_id, cp.lat, cp.lng, locate_pin(cp.lat, cp.lng) as loc
      from customer_places cp where cp.lat is not null and cp.lng is not null and cp.village_id is not null),
  bad as (
    select * from chk
     where case chk.loc->>'status'
             when 'located' then (chk.loc->>'village_id')::uuid <> chk.village_id
             when 'unsure'  then not (chk.loc->'candidates' @> jsonb_build_array(jsonb_build_object('village_id', chk.village_id)))
             else true end),
  kept as (
    insert into place_rechecks(place_id, party_id, old_village_id, pin_village_id, status, lat, lng, km)
    select id, party_id, village_id, (loc->>'village_id')::uuid, loc->>'status', lat, lng, (loc->>'km')::numeric from bad
    on conflict (place_id) do nothing returning place_id)
  update customer_places set village_id = null, lat = null, lng = null where id in (select place_id from kept);
  get diagnostics n = row_count;
  return jsonb_build_object('set_aside', n);
end $$;

select recheck_places();

do $$ declare r text;
begin
  alter table place_rechecks enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table place_rechecks from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
