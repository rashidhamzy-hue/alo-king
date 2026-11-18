-- Alo King Chouf, session WH1a: the temperature log by photo (docs/strategy/02-journeys.md, section 4, "Cold chain"; docs/DECISIONS.md,
-- strategy decision 6 of 15 November: chilled goods stay, with a twice-daily temperature log; frozen waits).
-- Twice a day a person photographs the chilled zone's thermometer and types what it shows. The photo is the proof (private media bucket,
-- under temperature/<hub>/<day>/); the number is typed by the person (no model reads it: rule 12). The range, the zones and the two
-- reading times are data (settings.temperature_log). A staff alert (an ops exception, pushed to phones and sent to the ops line) is raised:
--   * at once when a reading is out of range (temperature_out_of_range), and
--   * when a reading time has passed with no reading (temperature_missed), checked by the console's two-minute cron
--     (temperature_log_check). A reading taken late closes that alert; the day's log still shows it as late.
-- Alerts for missed readings start the day a zone's first reading is recorded (the log has started): before the fridge is in use,
-- nothing is raised.

insert into settings(key, value) values ('temperature_log', jsonb_build_object(
  'zones', jsonb_build_object('chilled', jsonb_build_object('min_c', 0, 'max_c', 5)),
  'slots', jsonb_build_array(
    jsonb_build_object('id', 'morning', 'from', '08:30', 'by', '12:00'),
    jsonb_build_object('id', 'evening', 'from', '16:00', 'by', '20:00'))))
on conflict (key) do nothing;

-- Both alerts wake a phone (OPS1's push list).
update settings set value = jsonb_set(value, '{high_priority_kinds}',
  (select coalesce(jsonb_agg(distinct k), '[]'::jsonb) from jsonb_array_elements_text(coalesce(value->'high_priority_kinds', '[]'::jsonb) || '["temperature_out_of_range", "temperature_missed"]'::jsonb) k))
 where key = 'push_alerts';

create table temperature_readings (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references sources(id),
  zone        text not null,
  reading_c   numeric(5,1) not null check (reading_c between -40 and 60),
  in_range    boolean not null,
  photo_path  text not null,
  note        text,
  slot_day    date not null,                    -- the hub's day
  slot        text,                             -- the reading time it counts for; null before the first one of the day
  taken_by    uuid not null references parties(id),
  taken_at    timestamptz not null default now(),
  request_key text unique
);
create index temperature_readings_day on temperature_readings(source_id, zone, slot_day);

-- The slot a moment falls in: the last one whose "from" has passed that day.
create or replace function temperature_slot_at(p_at timestamptz) returns text language sql stable set search_path = public, pg_temp as $$
  select s->>'id' from jsonb_array_elements(coalesce(setting('temperature_log')->'slots', '[]'::jsonb)) s
   where (s->>'from')::time <= (p_at at time zone scheduling_tz())::time
   order by (s->>'from')::time desc limit 1 $$;

create or replace function record_temperature(p_source uuid, p_zone text, p_reading_c numeric, p_photo text, p_by uuid,
                                              p_note text default null, p_key text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare cfg jsonb := setting('temperature_log'); z jsonb; v temperature_readings%rowtype; v_in boolean; v_day date := hub_today();
        v_slot text := temperature_slot_at(now());
begin
  if p_key is not null then
    select * into v from temperature_readings where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'reading_id', v.id, 'in_range', v.in_range, 'slot', v.slot); end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_source and kind = 'dark_store') then raise exception 'NOT_A_STOCKED_SOURCE'; end if;
  z := cfg->'zones'->p_zone;
  if z is null then raise exception 'UNKNOWN_ZONE %', p_zone; end if;
  if p_photo is null or btrim(p_photo) = '' then raise exception 'PHOTO_REQUIRED'; end if;
  if p_photo not like 'temperature/' || p_source::text || '/%' or p_photo ~ '\.\.' then raise exception 'PHOTO_PATH: stored under temperature/<hub>/'; end if;
  if p_reading_c is null or p_reading_c < -40 or p_reading_c > 60 then raise exception 'BAD_READING %', p_reading_c; end if;
  v_in := p_reading_c between (z->>'min_c')::numeric and (z->>'max_c')::numeric;
  insert into temperature_readings(source_id, zone, reading_c, in_range, photo_path, note, slot_day, slot, taken_by, request_key)
    values (p_source, p_zone, round(p_reading_c, 1), v_in, p_photo, nullif(btrim(coalesce(p_note, '')), ''), v_day, v_slot, p_by, p_key)
    returning * into v;
  if not v_in then
    perform raise_ops_exception('temperature_out_of_range', v.id::text, jsonb_build_object('zone', p_zone, 'reading_c', v.reading_c,
      'min_c', z->'min_c', 'max_c', z->'max_c', 'note', v.note, 'taken_at', v.taken_at));
  end if;
  -- a reading in a slot whose alert was raised closes it
  if v_slot is not null then
    update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
     where kind = 'temperature_missed' and ref = p_source || ':' || p_zone || ':' || v_day || ':' || v_slot and status <> 'resolved';
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'reading_id', v.id, 'in_range', v_in, 'slot', v_slot,
                            'min_c', z->'min_c', 'max_c', z->'max_c');
end $$;

-- Each configured zone's slots on a day, for one hub: done (a reading in time), late (taken after the slot's time), missed (time passed,
-- none yet), due (not yet time), not_started (time passed before the zone's first reading ever: the log had not begun), with the readings.
create or replace function temperature_log_day(p_source uuid, p_day date default null, p_now timestamptz default now())
returns jsonb language sql stable set search_path = public, pg_temp as $$
  with d as (select coalesce(p_day, (p_now at time zone scheduling_tz())::date) as day),
       z as (select key as zone, value as rng from jsonb_each(coalesce(setting('temperature_log')->'zones', '{}'::jsonb))),
       s as (select x->>'id' as slot, (x->>'from')::time as t_from, (x->>'by')::time as t_by, n
               from jsonb_array_elements(coalesce(setting('temperature_log')->'slots', '[]'::jsonb)) with ordinality as a(x, n))
  select jsonb_build_object('day', (select day from d),
    'zones', (select coalesce(jsonb_object_agg(zone, rng), '{}'::jsonb) from z),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('zone', z.zone, 'slot', s.slot, 'from', to_char(s.t_from, 'HH24:MI'), 'by', to_char(s.t_by, 'HH24:MI'),
               'state', case when r.id is not null then case when (r.taken_at at time zone scheduling_tz())::time > s.t_by then 'late' else 'done' end
                             when ((select day from d) + s.t_by) at time zone scheduling_tz() >= p_now then 'due'
                             when not exists (select 1 from temperature_readings t0 where t0.source_id = p_source and t0.zone = z.zone
                                                and t0.taken_at <= ((select day from d) + s.t_by) at time zone scheduling_tz()) then 'not_started'
                             else 'missed' end,
               'reading_c', r.reading_c, 'in_range', r.in_range, 'taken_at', r.taken_at, 'reading_id', r.id)
             order by z.zone, s.n)
             from z cross join s
             left join lateral (select * from temperature_readings t where t.source_id = p_source and t.zone = z.zone and t.slot_day = (select day from d)
                                  and t.slot = s.slot order by t.taken_at limit 1) r on true), '[]'::jsonb),
    'readings', coalesce((select jsonb_agg(jsonb_build_object('reading_id', t.id, 'zone', t.zone, 'reading_c', t.reading_c, 'in_range', t.in_range,
                 'slot', t.slot, 'taken_at', t.taken_at, 'taken_by', p.display_name, 'note', t.note, 'photo_path', t.photo_path) order by t.taken_at)
               from temperature_readings t left join parties p on p.id = t.taken_by
              where t.source_id = p_source and t.slot_day = (select day from d)), '[]'::jsonb)) $$;

-- The cron's check (every two minutes from the console's Worker): a slot whose time has passed today with no reading raises one alert;
-- a slot that has its reading closes an alert left open. Only for zones whose log has started (any reading ever).
create or replace function temperature_log_check(p_now timestamptz default now()) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h record; d jsonb; sl jsonb; v_missed jsonb := '[]'::jsonb; v_day date := (p_now at time zone scheduling_tz())::date; v_ref text;
begin
  for h in select id from sources where kind = 'dark_store' loop
    d := temperature_log_day(h.id, v_day, p_now);
    for sl in select * from jsonb_array_elements(d->'slots') loop
      v_ref := h.id || ':' || (sl->>'zone') || ':' || v_day || ':' || (sl->>'slot');
      if sl->>'state' = 'missed' then
        perform raise_ops_exception('temperature_missed', v_ref, jsonb_build_object('zone', sl->>'zone', 'slot', sl->>'slot', 'day', v_day, 'by', sl->>'by'));
        v_missed := v_missed || jsonb_build_object('source_id', h.id, 'zone', sl->>'zone', 'slot', sl->>'slot', 'day', v_day);
      elsif sl->>'state' in ('done', 'late') then
        update ops_exceptions set status = 'resolved', resolved_at = now(),
               resolved_by = (select taken_by from temperature_readings where id = (sl->>'reading_id')::uuid)
         where kind = 'temperature_missed' and ref = v_ref and status <> 'resolved';
      end if;
    end loop;
  end loop;
  return jsonb_build_object('missed', v_missed);
end $$;

-- The last p_days days, newest first, for the page.
create or replace function temperature_log_recent(p_source uuid, p_days int default 14, p_now timestamptz default now()) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(temperature_log_day(p_source, d::date, p_now) order by d desc), '[]'::jsonb)
    from generate_series((p_now at time zone scheduling_tz())::date - greatest(least(p_days, 60), 1) + 1, (p_now at time zone scheduling_tz())::date, interval '1 day') d $$;

do $$ declare r text;
begin
  alter table temperature_readings enable row level security;
  foreach r in array array['anon', 'authenticated', 'web_channel'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table temperature_readings from %I', r); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
