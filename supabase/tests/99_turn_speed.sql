-- Session 5g part 0c (§39.15.6): basket_checkout_view answers what the checkout's own calls answer, in one call, and stops
-- where the bot stops.
begin;

insert into public.cadastral_zones (pcode, district_code, name_en, boundary, source) values
  ('TZ-TS', 'CHF', 'Turn speed zone', 'SRID=4326;MULTIPOLYGON(((35.55 33.66,35.60 33.66,35.60 33.70,35.55 33.70,35.55 33.66)))', 'test');
insert into public.places (id, zone_pcode, name_ar, name_en, kind, governorate_code, district_code, centroid, source) values
  ('LB-CHF-BAAKLINE', 'TZ-TS', 'بعقلين', 'Baakline', 'town', 'mount_lebanon', 'CHF', 'SRID=4326;POINT(35.56355 33.67739)', 'test')
on conflict (id) do nothing;
select set_config('app.fixture_owner_phone', '+96170000191', false);
\i supabase/test-fixtures/alo-test-grill.sql
select id as tv from public.vendors where slug = 'alo-test-grill' \gset
update public.vendors set town_id = 'LB-CHF-BAAKLINE' where id = :'tv';
select (select i.id from public.menu_items i where i.vendor_id = :'tv' and i.name_en = 'Pepsi') as pepsi \gset
select (public.customer_turn_begin('+96170000192', 'wamid.ts.1', 'text', 'Hi') #>> '{customer,id}') as cu \gset

select tests.ok(not has_function_privilege('anon', 'public.basket_checkout_view(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.basket_checkout_view(uuid)', 'execute'),
  'only the service role reads the checkout view');

select tests.ok(public.basket_checkout_view(:'cu') -> 'address' = public.basket_address_state(:'cu')
  and not (public.basket_checkout_view(:'cu') ? 'quote'),
  'no basket or address yet: the address state, and nothing after it');

select public.basket_add_item(:'cu', :'pepsi', 2, '{}'::uuid[], null) is not null as added \gset
insert into public.addresses (customer_id, place_id, pin, source, is_default, last_used_at) values
  (:'cu', 'LB-CHF-BAAKLINE', 'SRID=4326;POINT(35.5641 33.6771)', 'pin', true, now());
update public.baskets set address_id = (select a.id from public.addresses a where a.customer_id = :'cu'),
  address_confirmed_at = now()
where customer_id = :'cu' and status = 'open';

select public.basket_checkout_view(:'cu') as v \gset
select tests.ok(:'v'::jsonb -> 'quote' ->> 'status' = 'ok', 'the fixture reaches a ready quote, so every step of the view runs');
select tests.ok(:'v'::jsonb -> 'address' ->> 'status' = public.basket_address_state(:'cu') ->> 'status',
  'the address step is basket_address_state''s own answer');
select tests.ok(:'v'::jsonb -> 'quote' ->> 'status' = public.basket_quote(:'cu') ->> 'status'
  and :'v'::jsonb -> 'quote' -> 'total_usd' = public.basket_quote(:'cu') -> 'total_usd',
  'the quote is basket_quote''s own answer');
select tests.ok(case when :'v'::jsonb -> 'quote' ->> 'status' = 'ok'
    then :'v'::jsonb -> 'substitution' = public.basket_substitution_needed(:'cu')
     and (coalesce((:'v'::jsonb -> 'substitution' ->> 'needed')::boolean, false)
          or :'v'::jsonb -> 'cash' ->> 'status' = public.basket_cash_state(:'cu') ->> 'status')
    else not (:'v'::jsonb ? 'substitution') and not (:'v'::jsonb ? 'cash') end,
  'a ready quote goes on to the substitution question and the cash state; anything else stops at the quote');

rollback;
