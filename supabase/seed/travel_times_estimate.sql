-- PROVISIONAL travel times, by ring, from the two hub seed villages. source = 'ring_estimate', samples = 0.
-- These are placeholders so dispatch and ETAs work on day one. Replace them by running
-- scripts/build_travel_times.mjs (OSRM) once coordinates are filled; observed trips then overwrite both.
insert into travel_times(from_village, to_village, minutes, source, samples)
select h.id, v.id,
       case when v.name_en in ('Baakline', 'Baqaata') then 10       -- hub to hub
            when z.name = 'core' then 7 when z.name = 'mid' then 14 else 25 end,
       'ring_estimate', 0
from villages h join villages v on v.id <> h.id join zones z on z.id = v.zone_id
where h.name_en in ('Baakline', 'Baqaata') and v.is_served
on conflict (from_village, to_village) do nothing;
