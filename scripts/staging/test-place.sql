-- STAGING AND TESTS ONLY (FD2). The seeded test place: an invented kitchen with an invented menu, so testers, the tests and the simulated
-- customers can order food without touching a real place. Never a listed (scraped) place, never a real phone: the place's phone is an
-- invented number in the probe range, and nothing ever sends to a place's phone anyway (FD1). Idempotent: safe on every deploy.
-- It goes through FD1's own functions (a place from a listing, a menu photo record, a reading, a person's approval of each dish, the stamp,
-- testers-only visibility, approve_merchant), exactly as staff would, as the probe ops lead (prepare-staging.sql). Its listing is hidden at
-- once, so the website's Food page never shows it; a testers-only place never shows on the website anyway (0245).
do $$
declare
  v_lead uuid; v_village uuid := (select id from villages where name_en = 'Baqaata'); v_src uuid; v_photo uuid; d record;
  v_listing constant text := 'ak-test-kitchen-staging';
begin
  if v_village is null then raise notice 'test place: no village Baqaata, skipped'; return; end if;
  select id into v_lead from parties where is_probe and role = 'ops_lead' order by id limit 1;
  if v_lead is null then
    insert into parties(role, display_name, is_probe) values ('ops_lead', 'Probe ops lead', true) returning id into v_lead;
  end if;
  select id into v_src from sources where listing_id = v_listing;
  if v_src is not null and exists (select 1 from sources where id = v_src and approved_at is not null) then return; end if;
  if v_src is null then
    insert into listings(listing_id, name, kind, village, km_from_hub, maps_url)
      values (v_listing, 'Alo King test kitchen', 'restaurant', 'Baqaata', 1.0, 'https://www.google.com/maps/search/?api=1&query=Baqaata')
      on conflict (listing_id) do update set hidden_at = null;
    v_src := (create_place_from_listing(v_listing, v_lead, jsonb_build_object('village_id', v_village, 'name', 'Alo King test kitchen',
               'phone', '+96100000090', 'prep_minutes', 20, 'hours', jsonb_build_object('open', '09:00', 'close', '23:00'))) ->> 'source_id')::uuid;
    update listings set hidden_at = now() where listing_id = v_listing;
    perform set_place_details(v_src, v_lead, jsonb_build_object('aliases', jsonb_build_array('test kitchen', 'مطبخ التجربة', 'مطبخ الاختبار')));
  end if;
  v_photo := (record_menu_photo(v_src, 'menus/' || v_src || '/invented-test-menu.jpg', v_lead) ->> 'photo_id')::uuid;
  perform record_menu_reading(v_photo, $j${"sections": [
    {"name_ar": "سندويشات", "name_en": "Sandwiches", "dishes": [
      {"name_ar": "سندويش شاورما دجاج", "name_en": "Chicken shawarma sandwich", "price": 4, "currency": "USD", "price_text": "$4",
       "sizes": [{"name_ar": "عادي", "name_en": "Regular", "price": 4, "currency": "USD"}, {"name_ar": "كبير", "name_en": "Large", "price": 6, "currency": "USD"}],
       "options": [{"group_ar": "الخبز", "group_en": "Bread", "required": true, "min": 1, "max": 1,
                    "choices": [{"name_ar": "عربي", "name_en": "Arabic bread", "price_delta": 0}, {"name_ar": "صاج", "name_en": "Saj", "price_delta": 0.5}]}],
       "addons": [{"name_ar": "ثوم إضافي", "name_en": "Extra garlic", "price": 0.5, "currency": "USD"}, {"name_ar": "بطاطا", "name_en": "Fries inside", "price": 1, "currency": "USD"}]},
      {"name_ar": "سندويش فلافل", "name_en": "Falafel sandwich", "price": 2.5, "currency": "USD", "price_text": "$2.50", "sizes": [], "options": [], "addons": []}]},
    {"name_ar": "صحون", "name_en": "Plates", "dishes": [
      {"name_ar": "صحن طاووق", "name_en": "Taouk plate", "price": 8, "currency": "USD", "price_text": "$8", "sizes": [], "addons": [],
       "options": [{"group_ar": "الصلصة", "group_en": "Sauce", "required": true, "min": 1, "max": 1,
                    "choices": [{"name_ar": "ثوم", "name_en": "Garlic", "price_delta": 0}, {"name_ar": "حار", "name_en": "Spicy", "price_delta": 0}]}]},
      {"name_ar": "بطاطا مقلية", "name_en": "French fries", "price": 2, "currency": "USD", "price_text": "$2", "sizes": [], "options": [], "addons": []}]}
  ]}$j$::jsonb, 'invented', v_lead);
  for d in select id from menu_dish_proposals where source_id = v_src and status = 'waiting' loop
    perform review_menu_dish(d.id, v_lead, true);
  end loop;
  perform stamp_menu_checked(v_src, v_lead);
  perform set_place_visibility(v_src, v_lead, 'testers', 'the seeded test place (staging and tests only)');
  perform approve_merchant(v_src, v_lead, 0);
end $$;
