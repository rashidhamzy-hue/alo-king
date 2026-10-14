-- DECISIONS §39.2 "Road distance and fees inside the boundary" (decided 15 October, after session F): the boundary decides
-- where we deliver; road distance only sets the fee.
--   1. A new dated `delivery_fee_bands` set (its own effective_from): 3 km $2.00, 6 km $3.00 and 10 km $4.50 restated,
--      20 km $6.00 added. The 7 October rows are never updated or deleted (the dated guard forbids it anyway); the bands
--      are read from the latest set, so max_delivery_km() becomes 20. With it, without further code:
--        * the per-order check (delivery_quote) refuses only more than 20 km by road from the chosen shop, or the shop's
--          own smaller radius; a vendor with no radius gets 20 km;
--        * a merchant may set its own-delivery radius up to 20 km (vendors_check_radius, the hours/profile Flow);
--        * the website shows fees up to $6.00 and 20 km (site_overview, site_place, site_vendor);
--        * the delivery-area road rule (app_private.delivery_area_ids) keeps the places *between* that are within 20 km by
--          road, so Delghani (15.6 km) and El Bireh come back on; scripts/load-seed.sh re-runs the area load because
--          max_delivery_km() is part of its checksum.
--   2. The merchant profile Flow's distance dropdown (whatsapp/flows/merchant_claim.*.json) gains 12, 15 and 20 km, and
--      app_private.merchant_flow_data starts it from the shop's radius up to max_delivery_km() (it was capped at 10, so
--      a 20 km shop saving its form unchanged would have dropped to 10).
--   3. Config `listing_radius_km` = 10 (new dated key): the straight-line radius of the "Not on Alo King yet" listings on
--      place pages (§39.3) stays 10 km, read from its own key instead of the fee bands.
-- Rollback: supabase/rollbacks/20261014230000_fee_bands_20km.sql (a newer set restating 3/6/10, nothing deleted).

select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'DECISIONS §39.2: 20 km band inside the boundary, 15 October 2026', true);

insert into public.delivery_fee_bands (effective_from, max_km, fee_usd, created_by) values
  (now(), 3, 2.00, null),
  (now(), 6, 3.00, null),
  (now(), 10, 4.50, null),
  (now(), 20, 6.00, null);

insert into public.app_config (key, value, effective_from, note, created_by) values
  ('listing_radius_km', '10', now(),
   'Straight-line radius of the "Not on Alo King yet" listings on place pages (DECISIONS §39.2, §39.3); not the fee bands', null);

-- The place page's unclaimed list: within listing_radius_km of the place's centre (was max_delivery_km()).
create or replace function app_private.site_place_unclaimed(p_slug text, p_page integer default 1) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_size constant integer := 24;
  v_id text;
  v_centre extensions.geography;
  v_m numeric := public.config_numeric('listing_radius_km') * 1000;
  v_total integer;
  v_vendors jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80
     or p_page is null or p_page < 1 or p_page > 100 then
    return null;
  end if;
  select p.id, p.centroid into v_id, v_centre from public.places p
  where p.id = upper('LB-' || p_slug) and p.service_status = 'on';
  if v_id is null or v_centre is null or v_m is null then
    return null;
  end if;
  select count(*) into v_total from app_private.unclaimed_listings u where extensions.st_dwithin(u.location, v_centre, v_m);
  select coalesce(jsonb_agg(app_private.site_unclaimed_card(x.id) order by x.km, x.name, x.id), '[]'::jsonb) into v_vendors
  from (
    select u.id, extensions.st_distance(u.location, v_centre) as km, coalesce(u.name_en, u.name_ar) as name
    from app_private.unclaimed_listings u
    where extensions.st_dwithin(u.location, v_centre, v_m)
    order by 2, 3, 1
    offset (p_page - 1) * c_size limit c_size
  ) x;
  return jsonb_build_object('total', v_total, 'page', p_page, 'page_size', c_size, 'vendors', v_vendors);
end;
$$;
revoke all on function app_private.site_place_unclaimed(text, integer) from public;
grant execute on function app_private.site_place_unclaimed(text, integer) to anon, authenticated, service_role;

-- The merchant Flows' starting data: the radius is no longer capped at a fixed 10 (copy of 20261011160000 otherwise).
create or replace function app_private.merchant_flow_data(p_vendor_id uuid, p_lang text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with h as (select * from public.vendor_hours where vendor_id = p_vendor_id order by weekday limit 1),
  b as (
    select b.max_km, b.fee_usd from public.delivery_fee_bands b
    where b.effective_from = (select max(x.effective_from) from public.delivery_fee_bands x where x.effective_from <= now())
    order by b.max_km)
  select jsonb_build_object('vendor_id', v.id,
    'hours_set', exists (select 1 from public.vendor_hours x where x.vendor_id = v.id),
    'opens', coalesce((select to_char(opens, 'HH24:MI') from h), '09:00'),
    'closes', coalesce((select to_char(closes, 'HH24:MI') from h), '23:00'),
    'closed_days', case when exists (select 1 from public.vendor_hours x where x.vendor_id = v.id)
      then (select coalesce(jsonb_agg(d::text order by d), '[]') from generate_series(0, 6) d
            where not exists (select 1 from public.vendor_hours x where x.vendor_id = v.id and x.weekday = d))
      else '[]'::jsonb end,
    -- The form's dropdown has whole kilometres 1-10, then 12, 15 and 20 (§39.2); a radius snaps down to an option and
    -- never above max_delivery_km().
    'radius_km', (select case when r <= 10 then greatest(round(r), 1)::int when r < 12 then 10 when r < 15 then 12
                              when r < 20 then 15 else 20 end
                  from (select least(coalesce(v.delivery_radius_km, 3), public.max_delivery_km()) as r) x)::text,
    'cash', to_jsonb(v.cash_currencies),
    'fee_note', case when p_lang = 'ar' then 'رسوم التوصيل حسب جدول Alo King: ' else 'Delivery fees follow Alo King''s bands: ' end
      || coalesce((select string_agg('$' || to_char(b.fee_usd, 'FM9990.00') || case when p_lang = 'ar' then ' لحد ' else ' up to ' end
                                     || trim_scale(b.max_km)::text || case when p_lang = 'ar' then ' كم' else ' km' end, ' · ' order by b.max_km) from b), '-'))
  from public.vendors v where v.id = p_vendor_id;
$$;
revoke all on function app_private.merchant_flow_data(uuid, text) from public;
