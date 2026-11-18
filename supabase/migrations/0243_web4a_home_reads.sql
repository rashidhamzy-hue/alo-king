-- Alo King Chouf, session WEB4a (the website looks like the founder's design reference, stage 1): the two reads the reference's home and
-- its village picker need and the website did not have. Read only: nothing here prices, reserves, stores a position or writes an order.
--
--   web_home_extras(p_per)        the home page's product rails, from the catalogue (the same cards as an aisle, catalog_web_card):
--                                 per category, its first items in aisle order, in stock first. "Most ordered" exists only once the
--                                 shop has 30 days of orders (the founder's rule: never "popular" before 30 days of orders); before
--                                 that it is null and no such rail is drawn. Also the switch for the "Ask Alo King" strip
--                                 (settings.web.ask_alo_king, absent = off: WEB3 builds the assistant; the strip stays off until then).
--   web_locate_village(lat, lng)  "Use my location": the phone's position, once, to a village (locate_pin, 0074, the checkout's rule).
--                                 Returns the village, or the nearby villages to choose from when unsure, or "outside". Nothing is
--                                 stored and no distance is returned: the website keeps the village only (a cookie with its id).
--
-- Neutral and factual (invariant 14): a rail is a category's own items in the aisle's order, or a count of orders; no score, no "best".
-- Villages, zones, fees and times are rows (invariant 13): nothing here names one.

create or replace function web_home_extras(p_per int default 12) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_per int := least(greatest(coalesce(p_per, 12), 1), 20);
        v_first timestamptz; v_most jsonb := null; v_rails jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name_en', c.name_en, 'name_ar', c.name_ar, 'items', r.items) order by c.sort_order), '[]'::jsonb)
    into v_rails
    from catalog_categories c
    join lateral (select jsonb_agg(catalog_web_card(x.product_id) order by x.rank) as items
                    from (select w.product_id, row_number() over (order by (not w.in_stock), w.ord) as rank
                            from catalog_web_items() w where w.category_code = c.code) x
                   where x.rank <= v_per) r on r.items is not null
   where c.is_active;
  -- The first order the shop ever confirmed. Drafts and cards never confirmed are not orders a customer made.
  select min(o.created_at) into v_first from orders o where o.confirmed_at is not null;
  if v_first is not null and v_first <= now() - interval '30 days' then
    select coalesce(jsonb_agg(catalog_web_card(m.product_id) order by m.n desc, m.ord), '[]'::jsonb) into v_most
      from (select w.product_id, w.ord, count(distinct i.order_id) as n
              from order_items i
              join orders o on o.id = i.order_id and o.confirmed_at is not null and o.created_at > now() - interval '30 days'
                           and o.status not in ('cancelled')
              join catalog_web_items() w on w.product_id = i.product_id
             group by w.product_id, w.ord
             order by n desc, w.ord limit v_per) m;
  end if;
  return jsonb_build_object('rails', v_rails, 'most_ordered', v_most,
                            'ask', coalesce((setting('web')->>'ask_alo_king')::boolean, false));
end $$;

create or replace function web_locate_village(p_lat double precision, p_lng double precision) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare loc jsonb; v uuid;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return jsonb_build_object('ok', false, 'error', 'bad_position');
  end if;
  loc := locate_pin(p_lat, p_lng, null);
  v := (loc->>'village_id')::uuid;
  return jsonb_build_object('ok', true, 'status', loc->>'status',
    'village', (select jsonb_build_object('village_id', vi.id, 'name_en', vi.name_en, 'name_ar', vi.name_ar,
                                          'served', vi.is_served and z.is_active, 'fee_usd', z.delivery_fee_usd, 'eta_minutes', z.base_eta_minutes)
                  from villages vi left join zones z on z.id = vi.zone_id where vi.id = v),
    -- When unsure: the nearby villages that are served, to tap. Never the distance.
    'choices', (select coalesce(jsonb_agg(jsonb_build_object('village_id', vi.id, 'name_en', vi.name_en, 'name_ar', vi.name_ar,
                                                             'fee_usd', z.delivery_fee_usd, 'eta_minutes', z.base_eta_minutes)), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(loc->'candidates', '[]'::jsonb)) c
                  join villages vi on vi.id = (c->>'village_id')::uuid and vi.is_served
                  join zones z on z.id = vi.zone_id and z.is_active));
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

grant execute on function web_home_extras(int)                                   to web_channel;
grant execute on function web_locate_village(double precision, double precision) to web_channel;
