-- Session W (DECISIONS §39.11): the "Where we deliver" page is an interactive map of the §39.2 zone with the villages, the
-- shops in each village and the "Not on Alo King yet" shops (§39.3). The polygons and names are a static file built from
-- the places seed (scripts/web/build-chouf-map.mjs); what changes lives here, read-only, for anonymous callers:
--   * site_delivery_map(): for every place that is on, how many orderable shops and how many "Not on Alo King yet" shops
--     have their home there (one call for the whole map);
--   * site_village_unclaimed(slug): the "Not on Alo King yet" cards of the shops whose home is that village, for the panel
--     a visitor opens by tapping it (the orderable ones come from site_place, unchanged).
-- Same pattern as 20261014170000: public security-invoker wrappers over security-definer functions in app_private
-- (anonymous callers cannot read unclaimed vendors), strict input checks, public fields only (the card of
-- app_private.site_unclaimed_card: never a price, rating, photo, phone, address or coordinates). Nothing is written; no
-- table changes (§31).

create function app_private.site_delivery_map() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('slug', app_private.place_slug(pl.id),
        'shops', (select count(*) from public.vendors v
                  where v.town_id = pl.id and v.public_page and v.listing_status = 'active' and v.claim_status = 'claimed'
                    and v.orderable),
        'unclaimed', (select count(*) from app_private.unclaimed_listings u where u.town_id = pl.id))
        order by pl.id)
      from public.places pl where pl.service_status = 'on'), '[]'::jsonb),
    'unclaimed_total', (select count(*) from app_private.unclaimed_listings u
                        join public.places pl on pl.id = u.town_id and pl.service_status = 'on'));
$$;
revoke all on function app_private.site_delivery_map() from public;
grant execute on function app_private.site_delivery_map() to anon, authenticated, service_role;

-- The "Not on Alo King yet" shops whose home is one village that is on, by name. Null for an unknown place or one that is off.
create function app_private.site_village_unclaimed(p_slug text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max constant integer := 80;
  v_id text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80 then
    return null;
  end if;
  select p.id into v_id from public.places p where p.id = upper('LB-' || p_slug) and p.service_status = 'on';
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'total', (select count(*) from app_private.unclaimed_listings u where u.town_id = v_id),
    'vendors', coalesce((
      select jsonb_agg(app_private.site_unclaimed_card(x.id) order by x.name, x.id)
      from (select u.id, coalesce(u.name_en, u.name_ar) as name from app_private.unclaimed_listings u
            where u.town_id = v_id order by 2, 1 limit c_max) x), '[]'::jsonb));
end;
$$;
revoke all on function app_private.site_village_unclaimed(text) from public;
grant execute on function app_private.site_village_unclaimed(text) to anon, authenticated, service_role;

create function public.site_delivery_map() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_delivery_map() $$;
create function public.site_village_unclaimed(p_slug text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.site_village_unclaimed(p_slug) $$;
revoke all on function public.site_delivery_map() from public;
revoke all on function public.site_village_unclaimed(text) from public;
grant execute on function public.site_delivery_map() to anon, authenticated, service_role;
grant execute on function public.site_village_unclaimed(text) to anon, authenticated, service_role;
