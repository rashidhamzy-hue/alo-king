-- Alo King, session FIX1 (Sentry fix, Khraibeh, Safa Chicken, limits), migration 0241. Docs: docs/DECISIONS.md, "FIX1, 18 November 2026".
--   1 temperature_log_check: p_now has a default of now(). 0240 already declared it so; it is stated again here (the body is 0240's, unchanged)
--     so an environment that applied an earlier 0240 gets the default too. The Sentry event ALO-KING-GATEWAY-6 ("Could not find the function
--     public.temperature_log_check without parameters in the schema cache") was the Worker calling it with no arguments: the Worker now
--     passes p_now (apps/console/src/temperature-check.ts).
--   2 Khraibeh (الخريبة) is served, in the "mid" zone ($1.50, 30 minutes). The coordinator set this by hand on staging; this makes production
--     match. Only the village's zone and served flag change: its name and place do not.
--   3 Safa Chicken, Baqaata (listed as Boqaata, as the other 54 places there are), with LV1's fields and nothing else.
--   4 settings.sim_monthly_cap_usd: 55 for 2026-11, 10 a month otherwise.
--   5 usage_size_check: the weekly size check's staff alert (usage_near_limit) at 600 MB of storage or 350 MB of database; the limits are
--     settings.usage_alerts. The free plan holds 1 GB of storage and 500 MB of database.

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


-- 2
update villages set zone_id = (select id from zones where name = 'mid'), is_served = true where name_en = 'Khraibeh';

-- 3  (the place id is the one Google gave as 0x151f207a3c04bfb1:0xdf311a9f1d199c8a; the distance is the straight line from the hub, in Baakleen)
insert into listings(listing_id, name, kind, village, km_from_hub, maps_url) values
  ('safa-chicken-boqaata', 'Safa Chicken', 'restaurant', 'Boqaata', 3.5, 'https://www.google.com/maps/search/?api=1&query=Safa%20Chicken&query_place_id=ChIJsb8EPHogHxURipwZHZ8aMd8')
on conflict (listing_id) do nothing;

-- 4
update settings set value = '{"default_usd": 10, "months": {"2026-11": 55}}' where key = 'sim_monthly_cap_usd';

-- 5
insert into settings(key, value) values ('usage_alerts', '{"storage_mb": 600, "database_mb": 350}') on conflict (key) do nothing;

-- The weekly check reads the sizes (psql) and passes them here. Over a limit: one open staff alert per metric (a repeat is the same alert);
-- back under: the alert closes. Returns what it raised and what it closed.
create or replace function usage_size_check(p_storage_bytes bigint, p_database_bytes bigint) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare s jsonb := coalesce((select value from settings where key = 'usage_alerts'), '{}'::jsonb);
        m record; v_raised jsonb := '[]'::jsonb; v_resolved jsonb := '[]'::jsonb; v_limit numeric; v_ref text;
begin
  for m in select * from (values ('storage', p_storage_bytes, 'storage_mb'), ('database', p_database_bytes, 'database_mb')) t(metric, bytes, key) loop
    v_limit := (s->>m.key)::numeric;
    if v_limit is null or m.bytes is null then continue; end if;
    v_ref := m.metric;
    if m.bytes >= v_limit * 1024 * 1024 then
      if not exists (select 1 from ops_exceptions where kind = 'usage_near_limit' and ref = v_ref and status <> 'resolved') then v_raised := v_raised || to_jsonb(m.metric); end if;
      perform raise_ops_exception('usage_near_limit', v_ref, jsonb_build_object('metric', m.metric, 'used_mb', round(m.bytes / 1048576.0, 1), 'limit_mb', v_limit));
    else
      update ops_exceptions set status = 'resolved', resolved_at = now() where kind = 'usage_near_limit' and ref = v_ref and status <> 'resolved';
      if found then v_resolved := v_resolved || to_jsonb(m.metric); end if;
    end if;
  end loop;
  return jsonb_build_object('raised', v_raised, 'resolved', v_resolved);
end $$;

update settings set value = jsonb_set(value, '{high_priority_kinds}',
  (select coalesce(jsonb_agg(distinct k), '[]'::jsonb) from jsonb_array_elements_text(coalesce(value->'high_priority_kinds', '[]'::jsonb) || '["usage_near_limit"]'::jsonb) k))
 where key = 'push_alerts';

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
