-- Rollback for 20261008090100_routing_and_location.sql. The migration itself deletes no data: the guard
-- matches the DELETE statements inside location_forget_customer() and location_nightly(), which run
-- later (delete-my-data, expired route cache). This file removes everything the migration created.
select cron.unschedule('location-nightly');

drop function if exists app_private.location_nightly();
drop function if exists public.road_incident_report(public.road_incident_kind, extensions.geography, text);
drop function if exists public.handover_estimate_s(text, uuid, timestamptz);
drop function if exists public.prep_time_estimate_s(uuid, smallint, timestamptz);
drop function if exists public.eta_travel_s(integer, text, text, timestamptz);
drop function if exists public.location_forget_customer(uuid);
drop function if exists public.location_promote_all();
drop function if exists app_private.promote_place_aliases();
drop function if exists app_private.promote_street_aliases();
drop function if exists app_private.promote_landmarks();
drop function if exists app_private.promote_buildings();
drop function if exists app_private.flag_for_review(text, text, text);
drop function if exists app_private.promote_door_points();
drop function if exists public.delivery_quote(uuid, numeric, timestamptz);
drop function if exists public.route_cache_store(double precision, double precision, double precision[], double precision[], integer[], integer[], text, text);
drop function if exists public.route_cache_lookup(double precision, double precision, double precision[], double precision[], text);
drop function if exists app_private.lat_lon_point(double precision, double precision);
drop function if exists app_private.route_point_key(extensions.geography);

drop table if exists public.road_incidents, public.handover_time_stats, public.prep_time_stats, public.travel_time_stats,
  public.location_review_items, public.location_evidence, public.door_points, public.addresses, public.place_aliases,
  public.street_aliases, public.landmarks, public.buildings, public.route_cache;

drop type if exists public.road_incident_kind, public.address_source, public.location_evidence_kind,
  public.supporter_kind, public.knowledge_status;

-- Config rows are dated and append-only; rows that are already in force stay (their keys are unused).
