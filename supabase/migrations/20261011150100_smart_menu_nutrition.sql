-- Session 5 (DECISIONS §18.3, §32.3): the smart menu and nutrition. Contents:
--   1. config: model for menu extraction, derived-tag thresholds, match threshold, kill-gate numbers
--   2. the Lebanese dish library over a USDA FoodData Central ingredient table (data generated from
--      supabase/seed/nutrition/ by scripts/nutrition/library.ts; a test keeps them identical)
--   3. per-item nutrition with an honest source per value (merchant_verified / estimated / unknown)
--   4. merchant-declared allergens and diet tags (never set by the AI), derived tags, filters for search
--   5. menu drafts from photos, PDFs, links or text, approved section by section by the merchant
-- Estimates are computed by the server from the recipe and the merchant's portion answer, never guessed
-- by a model from a dish name. Prices in drafts are never invented. No SQL from the reports (§30, §32).

-- 1. Config ------------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §18.3, §32.3, 11 October 2026 (session 5)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('ai_menu_model', '"claude-sonnet-5-5"', '2026-10-11 00:00+03', 'Model that reads menu photos, PDFs and links into a draft (DECISIONS §18.3)', null),
  ('nutrition_tag_thresholds', '{"high_protein_min_g": 25, "low_carb_max_g": 20, "low_fat_max_g": 10, "low_sodium_max_mg": 600, "sugar_free_max_g": 0.5}', '2026-10-11 00:00+03', 'Derived tags per serving (DECISIONS §32.3)', null),
  ('dish_match_min_score', '0.45', '2026-10-11 00:00+03', 'Lowest name similarity for a menu item to take a dish-library recipe', null),
  ('nutrition_kill_gate', '{"after_claimed": 30, "min_confirm_share": 0.5, "min_search_share": 0.03}', '2026-10-11 00:00+03', 'If fewer merchants confirm estimates or searches use filters, the prompt moves out of setup (DECISIONS §32.3)', null),
  ('menu_draft_max_items', '400', '2026-10-11 00:00+03', 'Largest menu draft accepted at once', null),
  ('menu_drafts_daily_per_vendor', '10', '2026-10-11 00:00+03', 'Menu drafts one vendor may create per day', null),
  ('menu_model_calls_daily_per_vendor', '15', '2026-10-11 00:00+03', 'Menu-model reads (photos, PDFs) one vendor may use per Beirut day; checked before each call', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Dish library ------------------------------------------------------------------------------------------
create table public.nutrition_ingredients (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name_en text not null,
  -- The FoodData Central description the values come from; nutrition-library.yml re-checks them on a runner.
  fdc_query text not null,
  fdc_id integer,
  source text not null check (source in ('usda_sr_legacy', 'typical_label')),
  allergens public.allergen[] not null default '{}',   -- "may contain" suggestions only
  kcal numeric(7, 1) not null check (kcal >= 0),
  protein_g numeric(6, 2) not null check (protein_g >= 0),
  carbs_g numeric(6, 2) not null check (carbs_g >= 0),
  fat_g numeric(6, 2) not null check (fat_g >= 0),
  sugar_g numeric(6, 2) not null check (sugar_g >= 0),
  fibre_g numeric(6, 2) not null check (fibre_g >= 0),
  sat_fat_g numeric(6, 2) not null check (sat_fat_g >= 0),
  sodium_mg numeric(8, 1) not null check (sodium_mg >= 0),
  verified_at timestamptz
);
comment on table public.nutrition_ingredients is 'Per 100 g, from USDA FoodData Central (SR Legacy) or a typical label where FDC has no entry.';

create table public.dish_library (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name_ar text not null,
  name_en text not null,
  name_fr text not null,
  aliases text[] not null default '{}',
  category text not null check (category in ('sandwich', 'burger', 'plate', 'mezze', 'salad', 'soup', 'side', 'bakery',
    'pizza', 'pasta', 'breakfast', 'sweets', 'drink')),
  unit text not null check (unit in ('portion', 'piece')),
  -- Grams for S, M and L; the recipe is for M and scales linearly.
  portion_g jsonb not null check (jsonb_typeof(portion_g) = 'object' and (portion_g ->> 'M')::numeric > 0),
  recipe jsonb not null check (jsonb_typeof(recipe) = 'object'),
  salt_g numeric(5, 2) not null default 0 check (salt_g >= 0)
);

alter table public.nutrition_ingredients enable row level security;
alter table public.dish_library enable row level security;
revoke all on table public.nutrition_ingredients, public.dish_library from public, anon, authenticated;
grant all on table public.nutrition_ingredients, public.dish_library to service_role;
-- Reference data: anyone may read it (the site explains how estimates are made).
grant select on table public.nutrition_ingredients, public.dish_library to anon, authenticated;
create policy nutrition_ingredients_read on public.nutrition_ingredients for select to anon, authenticated using (true);
create policy dish_library_read on public.dish_library for select to anon, authenticated using (true);

-- BEGIN LIBRARY (generated by scripts/nutrition/library.ts; do not edit by hand)
insert into public.nutrition_ingredients (id, name_en, fdc_query, source, allergens, kcal, protein_g, carbs_g, fat_g, sugar_g, fibre_g, sat_fat_g, sodium_mg) values
  ('chicken_breast_cooked', 'Chicken breast, meat only, roasted', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'usda_sr_legacy', array[]::text[]::public.allergen[], 165, 31, 0, 3.6, 0, 0, 1, 74),
  ('chicken_thigh_cooked', 'Chicken thigh, meat only, roasted', 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted', 'usda_sr_legacy', array[]::text[]::public.allergen[], 209, 26, 0, 10.9, 0, 0, 3, 95),
  ('chicken_wing_cooked', 'Chicken wing, meat and skin, roasted', 'Chicken, broilers or fryers, wing, meat and skin, cooked, roasted', 'usda_sr_legacy', array[]::text[]::public.allergen[], 290, 26.9, 0, 19.5, 0, 0, 5.5, 82),
  ('chicken_liver_cooked', 'Chicken liver, simmered', 'Chicken, liver, all classes, cooked, simmered', 'usda_sr_legacy', array[]::text[]::public.allergen[], 167, 24.5, 0.9, 6.5, 0, 0, 2.1, 76),
  ('beef_lean_cooked', 'Beef, lean, grilled', 'Beef, top sirloin, steak, separable lean only, trimmed to 1/8" fat, choice, cooked, broiled', 'usda_sr_legacy', array[]::text[]::public.allergen[], 190, 29, 0, 7.4, 0, 0, 2.9, 64),
  ('beef_ground_cooked', 'Beef, ground 85% lean, pan-browned', 'Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned', 'usda_sr_legacy', array[]::text[]::public.allergen[], 250, 25.9, 0, 15.4, 0, 0, 5.9, 72),
  ('lamb_cooked', 'Lamb leg, roasted', 'Lamb, domestic, leg, whole (shank and sirloin), separable lean and fat, trimmed to 1/4" fat, choice, cooked, roasted', 'usda_sr_legacy', array[]::text[]::public.allergen[], 258, 25.6, 0, 16.5, 0, 0, 6.9, 66),
  ('lamb_raw_lean', 'Lamb, lean, raw (kibbeh nayyeh)', 'Lamb, domestic, leg, whole (shank and sirloin), separable lean only, trimmed to 1/4" fat, choice, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 134, 20.6, 0, 5.3, 0, 0, 1.9, 66),
  ('fish_white_cooked', 'White fish (cod), baked', 'Fish, cod, Atlantic, cooked, dry heat', 'usda_sr_legacy', array['fish']::text[]::public.allergen[], 105, 22.8, 0, 0.9, 0, 0, 0.2, 78),
  ('shrimp_cooked', 'Shrimp, cooked', 'Crustaceans, shrimp, mixed species, cooked, moist heat', 'usda_sr_legacy', array['shellfish']::text[]::public.allergen[], 99, 24, 0.2, 0.3, 0, 0, 0.1, 111),
  ('tuna_oil_drained', 'Tuna, canned in oil, drained', 'Fish, tuna, light, canned in oil, drained solids', 'usda_sr_legacy', array['fish']::text[]::public.allergen[], 198, 29.1, 0, 8.2, 0, 0, 1.5, 354),
  ('egg_cooked', 'Egg, whole, hard-boiled', 'Egg, whole, cooked, hard-boiled', 'usda_sr_legacy', array['eggs']::text[]::public.allergen[], 155, 12.6, 1.1, 10.6, 1.1, 0, 3.3, 124),
  ('sausage_beef_cooked', 'Beef sausage, cooked (sujuk, makanek)', 'Sausage, beef, fresh, cooked', 'usda_sr_legacy', array['sulphites']::text[]::public.allergen[], 332, 18.2, 0.4, 28, 0, 0, 10.9, 646),
  ('cured_beef', 'Cured beef (basterma)', 'Beef, cured, dried', 'usda_sr_legacy', array[]::text[]::public.allergen[], 153, 31.1, 2.8, 1.9, 0, 0, 0.8, 2790),
  ('cheese_mozzarella', 'Mozzarella, whole milk (akkawi stand-in)', 'Cheese, mozzarella, whole milk', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 300, 22.2, 2.2, 22.4, 1, 0, 13.2, 627),
  ('cheese_feta', 'Feta (white cheese)', 'Cheese, feta', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 264, 14.2, 4.1, 21.3, 4.1, 0, 14.9, 917),
  ('cheese_cheddar', 'Cheddar (kashkaval stand-in)', 'Cheese, cheddar', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 403, 24.9, 1.3, 33.1, 0.5, 0, 21.1, 621),
  ('cheese_halloumi', 'Halloumi', 'Cheese, halloumi', 'typical_label', array['dairy']::text[]::public.allergen[], 321, 21, 2.2, 25, 2.2, 0, 17, 1200),
  ('labneh', 'Labneh (strained yogurt)', 'Yogurt, Greek, plain, whole milk', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 97, 9, 4, 5, 4, 0, 2.4, 35),
  ('yogurt_whole', 'Yogurt, plain, whole milk', 'Yogurt, plain, whole milk', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 61, 3.5, 4.7, 3.3, 4.7, 0, 2.1, 46),
  ('milk_whole', 'Milk, whole', 'Milk, whole, 3.25% milkfat, with added vitamin D', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 61, 3.2, 4.8, 3.3, 5.1, 0, 1.9, 43),
  ('cream_heavy', 'Cream, heavy', 'Cream, fluid, heavy whipping', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 340, 2.8, 2.7, 36.1, 2.9, 0, 23, 27),
  ('ashta', 'Ashta (thickened milk cream)', 'Ashta', 'typical_label', array['dairy']::text[]::public.allergen[], 140, 4, 15, 7, 10, 0, 4.5, 50),
  ('butter', 'Butter, unsalted', 'Butter, without salt', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 717, 0.9, 0.1, 81.1, 0.1, 0, 51.4, 11),
  ('ghee', 'Ghee (clarified butter)', 'Butter oil, anhydrous', 'usda_sr_legacy', array['dairy']::text[]::public.allergen[], 876, 0.3, 0, 99.5, 0, 0, 61.9, 2),
  ('olive_oil', 'Olive oil', 'Oil, olive, salad or cooking', 'usda_sr_legacy', array[]::text[]::public.allergen[], 884, 0, 0, 100, 0, 0, 13.8, 2),
  ('vegetable_oil', 'Vegetable oil (frying)', 'Oil, canola', 'usda_sr_legacy', array[]::text[]::public.allergen[], 884, 0, 0, 100, 0, 0, 7.4, 0),
  ('mayonnaise', 'Mayonnaise', 'Salad dressing, mayonnaise, regular', 'usda_sr_legacy', array['eggs', 'mustard']::text[]::public.allergen[], 680, 1, 0.6, 74.9, 0.6, 0, 11.7, 635),
  ('toum', 'Toum (garlic sauce)', 'Toum garlic sauce', 'typical_label', array[]::text[]::public.allergen[], 700, 0.7, 3.5, 76, 0.1, 0.2, 6, 400),
  ('tahini', 'Tahini', 'Seeds, sesame butter, tahini, from roasted and toasted kernels', 'usda_sr_legacy', array['sesame']::text[]::public.allergen[], 595, 17, 21.2, 53.8, 0.5, 9.3, 7.5, 115),
  ('ketchup', 'Ketchup', 'Catsup', 'usda_sr_legacy', array[]::text[]::public.allergen[], 101, 1, 27.4, 0.1, 22.8, 0.3, 0, 907),
  ('chickpeas_cooked', 'Chickpeas, boiled', 'Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 164, 8.9, 27.4, 2.6, 4.8, 7.6, 0.3, 7),
  ('fava_cooked', 'Fava beans, boiled', 'Broadbeans (fava beans), mature seeds, cooked, boiled, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 110, 7.6, 19.7, 0.4, 1.8, 5.4, 0.1, 5),
  ('lentils_cooked', 'Lentils, boiled', 'Lentils, mature seeds, cooked, boiled, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 116, 9, 20.1, 0.4, 1.8, 7.9, 0.1, 2),
  ('bulgur_cooked', 'Bulgur, cooked', 'Bulgur, cooked', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 83, 3.1, 18.6, 0.2, 0.1, 4.5, 0, 5),
  ('bulgur_dry', 'Bulgur, dry (kibbeh, tabbouleh)', 'Bulgur, dry', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 342, 12.3, 75.9, 1.3, 0.4, 12.5, 0.2, 17),
  ('rice_cooked', 'White rice, cooked', 'Rice, white, long-grain, regular, enriched, cooked', 'usda_sr_legacy', array[]::text[]::public.allergen[], 130, 2.7, 28.2, 0.3, 0.1, 0.4, 0.1, 1),
  ('freekeh_cooked', 'Freekeh, cooked', 'Freekeh cooked', 'typical_label', array['gluten']::text[]::public.allergen[], 120, 4.5, 24, 0.9, 0.3, 4, 0.1, 5),
  ('pasta_dry', 'Pasta / vermicelli, dry', 'Pasta, dry, enriched', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 371, 13, 74.7, 1.5, 2.7, 3.2, 0.3, 6),
  ('pasta_cooked', 'Pasta, cooked', 'Pasta, cooked, enriched, without added salt', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 158, 5.8, 30.9, 0.9, 0.6, 1.8, 0.2, 1),
  ('moghrabieh_cooked', 'Moghrabieh (pearl couscous), cooked', 'Couscous, cooked', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 112, 3.8, 23.2, 0.2, 0.1, 1.4, 0, 5),
  ('pita_bread', 'Pita / Arabic bread, white', 'Bread, pita, white, enriched', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 275, 9.1, 55.7, 1.2, 1.3, 2.2, 0.2, 536),
  ('bun', 'Burger bun', 'Rolls, hamburger or hotdog, plain', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 279, 9.7, 49.4, 4.3, 5.3, 2.4, 1, 495),
  ('baguette', 'French bread / sub roll', 'Bread, french or vienna (includes sourdough)', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 272, 10.8, 51.9, 2.4, 4.3, 2.2, 0.5, 602),
  ('flour_white', 'Wheat flour, white', 'Wheat flour, white, all-purpose, enriched, bleached', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 364, 10.3, 76.3, 1, 0.3, 2.7, 0.2, 2),
  ('semolina', 'Semolina', 'Semolina, enriched', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 360, 12.7, 72.8, 1.1, 0, 3.9, 0.2, 1),
  ('phyllo', 'Phyllo / kataifi dough', 'Phyllo dough', 'usda_sr_legacy', array['gluten']::text[]::public.allergen[], 299, 7.1, 52.6, 6, 0.2, 1.9, 1.5, 483),
  ('croissant_plain', 'Croissant, butter', 'Croissants, butter', 'usda_sr_legacy', array['gluten', 'dairy', 'eggs']::text[]::public.allergen[], 406, 8.2, 45.8, 21, 11.3, 2.6, 11.7, 467),
  ('zaatar_mix', 'Za''atar mix (thyme, sumac, sesame)', 'Zaatar spice mix', 'typical_label', array['sesame']::text[]::public.allergen[], 300, 10, 35, 15, 2, 25, 2, 800),
  ('kishk_powder', 'Kishk (fermented yogurt and bulgur)', 'Kishk', 'typical_label', array['gluten', 'dairy']::text[]::public.allergen[], 380, 16, 64, 5, 6, 8, 3, 1500),
  ('sesame_seeds', 'Sesame seeds', 'Seeds, sesame seeds, whole, dried', 'usda_sr_legacy', array['sesame']::text[]::public.allergen[], 573, 17.7, 23.5, 49.7, 0.3, 11.8, 7, 11),
  ('pine_nuts', 'Pine nuts', 'Nuts, pine nuts, dried', 'usda_sr_legacy', array['nuts']::text[]::public.allergen[], 673, 13.7, 13.1, 68.4, 3.6, 3.7, 4.9, 2),
  ('walnuts', 'Walnuts', 'Nuts, walnuts, english', 'usda_sr_legacy', array['nuts']::text[]::public.allergen[], 654, 15.2, 13.7, 65.2, 2.6, 6.7, 6.1, 2),
  ('pistachios', 'Pistachios', 'Nuts, pistachio nuts, raw', 'usda_sr_legacy', array['nuts']::text[]::public.allergen[], 560, 20.2, 27.2, 45.3, 7.7, 10.6, 5.9, 1),
  ('almonds', 'Almonds', 'Nuts, almonds', 'usda_sr_legacy', array['nuts']::text[]::public.allergen[], 579, 21.2, 21.6, 49.9, 4.4, 12.5, 3.8, 1),
  ('tomato', 'Tomato, raw', 'Tomatoes, red, ripe, raw, year round average', 'usda_sr_legacy', array[]::text[]::public.allergen[], 18, 0.9, 3.9, 0.2, 2.6, 1.2, 0, 5),
  ('tomato_paste', 'Tomato paste', 'Tomato products, canned, paste, without salt added', 'usda_sr_legacy', array[]::text[]::public.allergen[], 82, 4.3, 18.9, 0.5, 12.2, 4.1, 0.1, 59),
  ('tomato_sauce', 'Tomato sauce', 'Tomato products, canned, sauce', 'usda_sr_legacy', array[]::text[]::public.allergen[], 24, 1.2, 5.3, 0.3, 3.6, 1.5, 0, 474),
  ('cucumber', 'Cucumber, raw', 'Cucumber, with peel, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 15, 0.7, 3.6, 0.1, 1.7, 0.5, 0, 2),
  ('onion', 'Onion, raw', 'Onions, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 40, 1.1, 9.3, 0.1, 4.2, 1.7, 0, 4),
  ('garlic', 'Garlic, raw', 'Garlic, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 149, 6.4, 33.1, 0.5, 1, 2.1, 0.1, 17),
  ('parsley', 'Parsley, raw', 'Parsley, fresh', 'usda_sr_legacy', array[]::text[]::public.allergen[], 36, 3, 6.3, 0.8, 0.9, 3.3, 0.1, 56),
  ('mint', 'Mint, raw', 'Spearmint, fresh', 'usda_sr_legacy', array[]::text[]::public.allergen[], 44, 3.3, 8.4, 0.7, 0, 6.8, 0.2, 30),
  ('lettuce', 'Lettuce, romaine', 'Lettuce, cos or romaine, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 17, 1.2, 3.3, 0.3, 1.2, 2.1, 0, 8),
  ('cabbage', 'Cabbage, raw', 'Cabbage, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 25, 1.3, 5.8, 0.1, 3.2, 2.5, 0, 18),
  ('radish', 'Radish, raw', 'Radishes, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 16, 0.7, 3.4, 0.1, 1.9, 1.6, 0, 39),
  ('bell_pepper', 'Bell pepper, raw', 'Peppers, sweet, red, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 31, 1, 6, 0.3, 4.2, 2.1, 0, 4),
  ('eggplant_cooked', 'Eggplant, cooked', 'Eggplant, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 35, 0.8, 8.7, 0.2, 3.2, 2.5, 0, 1),
  ('zucchini_cooked', 'Zucchini, cooked', 'Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 15, 1.1, 2.7, 0.4, 1.7, 1, 0.1, 3),
  ('okra_cooked', 'Okra, cooked', 'Okra, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 22, 1.9, 4.5, 0.2, 2.4, 2.5, 0, 6),
  ('green_beans_cooked', 'Green beans, cooked', 'Beans, snap, green, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 35, 1.9, 7.9, 0.3, 3.6, 3.2, 0.1, 1),
  ('peas_cooked', 'Green peas, cooked', 'Peas, green, frozen, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 78, 5.2, 14.3, 0.3, 4.6, 4.5, 0, 72),
  ('spinach_cooked', 'Spinach, cooked', 'Spinach, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 23, 3, 3.8, 0.3, 0.4, 2.4, 0, 70),
  ('jute_leaves_cooked', 'Jute leaves (mloukhieh), cooked', 'Jute, potherb, cooked, boiled, drained, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 37, 3.7, 7.3, 0.2, 0, 2, 0, 11),
  ('grape_leaves', 'Grape leaves, canned', 'Grape leaves, canned', 'usda_sr_legacy', array[]::text[]::public.allergen[], 69, 4.3, 11.7, 2, 0, 0, 0.3, 2853),
  ('carrot', 'Carrot, raw', 'Carrots, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 41, 0.9, 9.6, 0.2, 4.7, 2.8, 0, 69),
  ('mushrooms', 'Mushrooms, raw', 'Mushrooms, white, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 22, 3.1, 3.3, 0.3, 2, 1, 0.1, 5),
  ('potato_boiled', 'Potato, boiled', 'Potatoes, boiled, cooked without skin, flesh, without salt', 'usda_sr_legacy', array[]::text[]::public.allergen[], 86, 1.7, 20, 0.1, 0.9, 2, 0, 5),
  ('fries', 'French fries, restaurant', 'Potatoes, french fried, all types, salt added in processing, frozen, oven-heated', 'usda_sr_legacy', array[]::text[]::public.allergen[], 312, 3.4, 41.4, 14.7, 0.3, 3.8, 2.3, 210),
  ('pickles', 'Pickled cucumber', 'Pickles, cucumber, dill or kosher dill', 'usda_sr_legacy', array['sulphites']::text[]::public.allergen[], 12, 0.5, 2.4, 0.2, 1.3, 1, 0, 809),
  ('pickled_turnip', 'Pickled turnip', 'Pickled turnips', 'typical_label', array['sulphites']::text[]::public.allergen[], 20, 0.5, 4, 0.1, 2.5, 1.5, 0, 1000),
  ('olives', 'Olives', 'Olives, ripe, canned (small-extra large)', 'usda_sr_legacy', array[]::text[]::public.allergen[], 115, 0.8, 6.3, 10.7, 0, 3.2, 1.4, 735),
  ('lemon_juice', 'Lemon juice', 'Lemon juice, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 22, 0.4, 6.9, 0.2, 2.5, 0.3, 0, 1),
  ('pomegranate_molasses', 'Pomegranate molasses', 'Pomegranate molasses', 'typical_label', array[]::text[]::public.allergen[], 270, 0, 67, 0, 60, 0, 0, 20),
  ('red_pepper_paste', 'Red pepper paste (muhammara base)', 'Red pepper paste', 'typical_label', array[]::text[]::public.allergen[], 90, 2, 15, 2.5, 9, 3, 0.3, 1200),
  ('sugar', 'Sugar', 'Sugars, granulated', 'usda_sr_legacy', array[]::text[]::public.allergen[], 387, 0, 100, 0, 99.8, 0, 0, 1),
  ('ater_syrup', 'Ater (sugar syrup)', 'Ater sugar syrup', 'typical_label', array[]::text[]::public.allergen[], 255, 0, 66, 0, 66, 0, 0, 1),
  ('honey', 'Honey', 'Honey', 'usda_sr_legacy', array[]::text[]::public.allergen[], 304, 0.3, 82.4, 0, 82.1, 0.2, 0, 4),
  ('dates', 'Dates, medjool', 'Dates, medjool', 'usda_sr_legacy', array[]::text[]::public.allergen[], 277, 1.8, 75, 0.2, 66.5, 6.7, 0, 1),
  ('chocolate_spread', 'Chocolate hazelnut spread', 'Chocolate-flavored hazelnut spread', 'usda_sr_legacy', array['nuts', 'dairy', 'soy']::text[]::public.allergen[], 539, 6.3, 57.5, 30.9, 56.3, 3.4, 10.6, 41),
  ('ice_cream', 'Ice cream, vanilla', 'Ice creams, vanilla', 'usda_sr_legacy', array['dairy', 'eggs']::text[]::public.allergen[], 207, 3.5, 23.6, 11, 21.2, 0.7, 6.8, 80),
  ('banana', 'Banana', 'Bananas, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 89, 1.1, 22.8, 0.3, 12.2, 2.6, 0.1, 1),
  ('strawberry', 'Strawberries', 'Strawberries, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 32, 0.7, 7.7, 0.3, 4.9, 2, 0, 1),
  ('avocado', 'Avocado', 'Avocados, raw, all commercial varieties', 'usda_sr_legacy', array[]::text[]::public.allergen[], 160, 2, 8.5, 14.7, 0.7, 6.7, 2.1, 7),
  ('orange_juice', 'Orange juice, fresh', 'Orange juice, raw', 'usda_sr_legacy', array[]::text[]::public.allergen[], 45, 0.7, 10.4, 0.2, 8.4, 0.2, 0, 1),
  ('coffee_brewed', 'Coffee, brewed', 'Beverages, coffee, brewed, prepared with tap water', 'usda_sr_legacy', array[]::text[]::public.allergen[], 1, 0.1, 0, 0, 0, 0, 0, 2),
  ('espresso', 'Espresso', 'Beverages, coffee, brewed, espresso, restaurant-prepared', 'usda_sr_legacy', array[]::text[]::public.allergen[], 9, 0.1, 1.7, 0.2, 0, 0, 0.1, 14),
  ('tea_brewed', 'Tea, brewed', 'Beverages, tea, black, brewed, prepared with tap water', 'usda_sr_legacy', array[]::text[]::public.allergen[], 1, 0, 0.3, 0, 0, 0, 0, 3),
  ('water', 'Water', 'Water', 'usda_sr_legacy', array[]::text[]::public.allergen[], 0, 0, 0, 0, 0, 0, 0, 0),
  ('salt', 'Salt', 'Salt, table', 'usda_sr_legacy', array[]::text[]::public.allergen[], 0, 0, 0, 0, 0, 0, 0, 38758);
insert into public.dish_library (id, name_ar, name_en, name_fr, aliases, category, unit, portion_g, recipe, salt_g) values
  ('chicken_shawarma_sandwich', 'سندويش شاورما دجاج', 'Chicken shawarma sandwich', 'Sandwich chawarma poulet', array['shawarma djej', 'chawarma poulet', 'shawarma dajaj', 'شاورما دجاج']::text[], 'sandwich', 'portion', '{"S":190,"M":250,"L":340}', '{"pita_bread":80,"chicken_thigh_cooked":110,"toum":18,"pickles":20,"fries":15,"tomato":7}', 1),
  ('beef_shawarma_sandwich', 'سندويش شاورما لحمة', 'Beef shawarma sandwich', 'Sandwich chawarma viande', array['shawarma lahme', 'chawarma viande', 'شاورما لحمة']::text[], 'sandwich', 'portion', '{"S":190,"M":250,"L":340}', '{"pita_bread":80,"beef_lean_cooked":100,"tahini":15,"tomato":20,"onion":15,"parsley":5,"pickled_turnip":15}', 1),
  ('chicken_tawouk_sandwich', 'سندويش طاووق', 'Chicken tawouk sandwich', 'Sandwich taouk', array['tawook', 'taouk', 'ta2ouk', 'tawou2', 'طاووق', 'طاوق']::text[], 'sandwich', 'portion', '{"S":190,"M":250,"L":330}', '{"pita_bread":80,"chicken_breast_cooked":110,"toum":20,"pickles":20,"fries":15,"lettuce":5}', 0.8),
  ('kafta_sandwich', 'سندويش كفتة', 'Kafta sandwich', 'Sandwich kafta', array['kafta', 'kefta', 'كفتا', 'كفتة مشوية']::text[], 'sandwich', 'portion', '{"S":190,"M":240,"L":320}', '{"pita_bread":80,"beef_ground_cooked":100,"onion":15,"parsley":8,"tomato":20,"tahini":10,"pickles":10}', 1),
  ('falafel_sandwich', 'سندويش فلافل', 'Falafel sandwich', 'Sandwich falafel', array['falafel', 'flafel', 'فلافل']::text[], 'sandwich', 'portion', '{"S":190,"M":250,"L":330}', '{"pita_bread":80,"chickpeas_cooked":80,"vegetable_oil":14,"tahini":20,"tomato":20,"parsley":8,"pickled_turnip":15,"radish":10,"mint":3}', 1.2),
  ('sujuk_sandwich', 'سندويش سجق', 'Sujuk sandwich', 'Sandwich soujouk', array['sujuk', 'soujouk', 'sojok', 'سجق']::text[], 'sandwich', 'portion', '{"S":170,"M":220,"L":300}', '{"pita_bread":80,"sausage_beef_cooked":90,"tomato":20,"pickles":15,"toum":10,"lemon_juice":5}', 0.5),
  ('makanek_sandwich', 'سندويش مقانق', 'Makanek sandwich', 'Sandwich makanek', array['makanek', 'ma2anek', 'مقانق']::text[], 'sandwich', 'portion', '{"S":170,"M":220,"L":300}', '{"pita_bread":80,"sausage_beef_cooked":90,"tomato":20,"pickles":15,"lemon_juice":5,"pomegranate_molasses":5}', 0.5),
  ('escalope_sandwich', 'سندويش اسكالوب', 'Chicken escalope sandwich', 'Sandwich escalope', array['escalope', 'eskalop', 'اسكالوب']::text[], 'sandwich', 'portion', '{"S":220,"M":290,"L":380}', '{"baguette":100,"chicken_breast_cooked":100,"flour_white":15,"vegetable_oil":14,"mayonnaise":15,"lettuce":10,"tomato":20,"pickles":15}', 0.8),
  ('francisco_sandwich', 'سندويش فرانسيسكو', 'Francisco sandwich', 'Sandwich Francisco', array['francisco', 'فرنسيسكو']::text[], 'sandwich', 'portion', '{"S":230,"M":300,"L":390}', '{"baguette":100,"chicken_breast_cooked":100,"cheese_mozzarella":30,"mushrooms":20,"mayonnaise":15,"lettuce":10,"pickles":15,"vegetable_oil":5}', 0.6),
  ('fajita_sandwich', 'سندويش فاهيتا', 'Chicken fajita sandwich', 'Sandwich fajita', array['fajita', 'fahita', 'فاهيتا']::text[], 'sandwich', 'portion', '{"S":230,"M":300,"L":390}', '{"baguette":100,"chicken_breast_cooked":100,"bell_pepper":35,"onion":25,"cheese_mozzarella":25,"mayonnaise":10,"vegetable_oil":5}', 0.8),
  ('crispy_chicken_sandwich', 'سندويش كريسبي', 'Crispy chicken sandwich', 'Sandwich poulet crispy', array['crispy', 'كريسبي']::text[], 'sandwich', 'portion', '{"S":230,"M":300,"L":390}', '{"baguette":100,"chicken_breast_cooked":100,"flour_white":25,"vegetable_oil":20,"mayonnaise":15,"lettuce":10,"pickles":15,"cheese_cheddar":15}', 0.8),
  ('chicken_sub', 'سندويش تشيكن سب', 'Chicken sub', 'Sub poulet', array['chicken sub', 'تشكن سب']::text[], 'sandwich', 'portion', '{"S":230,"M":300,"L":390}', '{"baguette":110,"chicken_breast_cooked":100,"cheese_mozzarella":25,"mayonnaise":15,"lettuce":15,"tomato":20,"pickles":15}', 0.6),
  ('philly_steak_sandwich', 'سندويش فيلادلفيا', 'Philly steak sandwich', 'Sandwich Philly steak', array['philadelphia', 'philly', 'فيلادلفيا']::text[], 'sandwich', 'portion', '{"S":230,"M":300,"L":390}', '{"baguette":100,"beef_lean_cooked":100,"bell_pepper":25,"onion":25,"cheese_mozzarella":35,"mushrooms":15,"vegetable_oil":5}', 0.8),
  ('roast_beef_sandwich', 'سندويش روستو', 'Roast beef sandwich', 'Sandwich rosbif', array['rosto', 'roast beef', 'روستو']::text[], 'sandwich', 'portion', '{"S":210,"M":270,"L":350}', '{"baguette":100,"beef_lean_cooked":90,"mayonnaise":15,"pickles":20,"lettuce":10,"tomato":25}', 0.8),
  ('hamburger', 'همبرغر', 'Hamburger', 'Hamburger', array['burger', 'hamburger', 'برغر']::text[], 'burger', 'portion', '{"S":180,"M":230,"L":320}', '{"bun":70,"beef_ground_cooked":110,"lettuce":10,"tomato":20,"onion":10,"pickles":10,"ketchup":10}', 0.6),
  ('cheeseburger', 'تشيز برغر', 'Cheeseburger', 'Cheeseburger', array['cheese burger', 'تشيزبرغر']::text[], 'burger', 'portion', '{"S":200,"M":250,"L":340}', '{"bun":70,"beef_ground_cooked":110,"cheese_cheddar":20,"lettuce":10,"tomato":20,"pickles":10,"ketchup":10}', 0.6),
  ('chicken_burger', 'برغر دجاج', 'Chicken burger', 'Burger poulet', array['chicken burger', 'برغر دجاج']::text[], 'burger', 'portion', '{"S":200,"M":250,"L":340}', '{"bun":70,"chicken_breast_cooked":100,"flour_white":15,"vegetable_oil":15,"mayonnaise":15,"lettuce":15,"tomato":20}', 0.6),
  ('club_sandwich', 'كلوب ساندويش', 'Club sandwich', 'Club sandwich', array['club', 'كلوب']::text[], 'sandwich', 'portion', '{"S":250,"M":330,"L":420}', '{"bun":90,"chicken_breast_cooked":80,"egg_cooked":30,"cheese_cheddar":20,"mayonnaise":20,"lettuce":15,"tomato":30,"fries":60}', 0.6),
  ('fries_sandwich', 'سندويش بطاطا', 'Fries sandwich', 'Sandwich frites', array['batata sandwich', 'سندويش بطاطا']::text[], 'sandwich', 'portion', '{"S":170,"M":220,"L":290}', '{"pita_bread":80,"fries":110,"toum":15,"ketchup":10,"pickles":10}', 0.5),
  ('labneh_sandwich', 'سندويش لبنة', 'Labneh sandwich', 'Sandwich labneh', array['labne', 'labneh', 'لبنة']::text[], 'sandwich', 'portion', '{"S":150,"M":200,"L":260}', '{"pita_bread":80,"labneh":70,"olive_oil":8,"cucumber":20,"tomato":15,"mint":3,"olives":10}', 0.6),
  ('halloumi_sandwich', 'سندويش حلوم', 'Halloumi sandwich', 'Sandwich halloumi', array['halloum', 'حلوم']::text[], 'sandwich', 'portion', '{"S":160,"M":210,"L":270}', '{"pita_bread":80,"cheese_halloumi":70,"tomato":30,"mint":3,"cucumber":20,"olive_oil":5}', 0),
  ('akkawi_sandwich', 'سندويش جبنة عكاوي', 'Akkawi cheese sandwich', 'Sandwich fromage akkawi', array['jebne', 'akkawi', 'jibne', 'جبنة']::text[], 'sandwich', 'portion', '{"S":150,"M":200,"L":260}', '{"pita_bread":80,"cheese_mozzarella":70,"tomato":30,"cucumber":15,"mint":3}', 0.8),
  ('tuna_sandwich', 'سندويش تونا', 'Tuna sandwich', 'Sandwich thon', array['tuna', 'تونا']::text[], 'sandwich', 'portion', '{"S":180,"M":240,"L":310}', '{"baguette":100,"tuna_oil_drained":80,"mayonnaise":15,"lettuce":10,"tomato":20,"olives":10}', 0.3),
  ('egg_sandwich', 'سندويش بيض', 'Egg sandwich', 'Sandwich aux œufs', array['bayd', 'beid', 'بيض']::text[], 'sandwich', 'portion', '{"S":160,"M":210,"L":270}', '{"pita_bread":80,"egg_cooked":100,"vegetable_oil":5,"tomato":20,"parsley":3}', 0.6),
  ('liver_sandwich', 'سندويش سودة دجاج', 'Chicken liver sandwich', 'Sandwich foie de volaille', array['sawda', 'soda djej', 'سودة']::text[], 'sandwich', 'portion', '{"S":170,"M":220,"L":290}', '{"pita_bread":80,"chicken_liver_cooked":100,"garlic":5,"lemon_juice":8,"pomegranate_molasses":8,"vegetable_oil":8,"toum":10}', 0.8),
  ('basterma_sandwich', 'سندويش بسطرما', 'Basterma sandwich', 'Sandwich basterma', array['basterma', 'pastirma', 'بسطرما']::text[], 'sandwich', 'portion', '{"S":150,"M":200,"L":260}', '{"baguette":100,"cured_beef":50,"tomato":25,"cheese_mozzarella":20,"pickles":5}', 0),
  ('kibbeh_sandwich', 'سندويش كبة', 'Kibbeh sandwich', 'Sandwich kebbe', array['kebbe sandwich', 'سندويش كبة']::text[], 'sandwich', 'portion', '{"S":180,"M":240,"L":310}', '{"pita_bread":80,"bulgur_dry":30,"beef_ground_cooked":60,"onion":15,"pine_nuts":5,"vegetable_oil":12,"yogurt_whole":25,"mint":2,"cucumber":15}', 0.8),
  ('chicken_shawarma_plate', 'صحن شاورما دجاج', 'Chicken shawarma plate', 'Assiette chawarma poulet', array['shawarma plate', 'صحن شاورما']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"chicken_thigh_cooked":200,"fries":120,"toum":35,"pickles":40,"pita_bread":60,"tomato":25}', 1.4),
  ('beef_shawarma_plate', 'صحن شاورما لحمة', 'Beef shawarma plate', 'Assiette chawarma viande', array['shawarma lahme plate', 'صحن شاورما لحمة']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"beef_lean_cooked":190,"fries":110,"tahini":30,"tomato":40,"onion":30,"parsley":10,"pickled_turnip":30,"pita_bread":60}', 1.4),
  ('tawouk_plate', 'صحن طاووق', 'Chicken tawouk plate', 'Assiette taouk', array['tawook plate', 'صحن طاووق', 'taouk']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"chicken_breast_cooked":200,"fries":120,"toum":35,"pickles":30,"pita_bread":60,"tomato":20,"olive_oil":5}', 1.4),
  ('kafta_plate', 'صحن كفتة مشوية', 'Grilled kafta plate', 'Assiette kafta grillée', array['kafta meshwi', 'كفتة مشوية']::text[], 'plate', 'portion', '{"S":360,"M":460,"L":600}', '{"beef_ground_cooked":200,"onion":40,"parsley":15,"tomato":60,"fries":80,"pita_bread":60,"tahini":10}', 1.6),
  ('mixed_grill', 'مشاوي مشكلة', 'Mixed grill', 'Grillades mixtes', array['mashewe mshakale', 'mixed grill', 'مشاوي']::text[], 'plate', 'portion', '{"S":420,"M":550,"L":750}', '{"chicken_breast_cooked":110,"beef_ground_cooked":100,"lamb_cooked":100,"tomato":50,"onion":40,"fries":80,"toum":25,"pita_bread":45}', 1.8),
  ('lamb_skewers', 'لحم مشوي', 'Lamb skewers (lahm meshwi)', 'Brochettes d''agneau', array['lahm meshwi', 'shish kebab', 'لحم مشوي']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"lamb_cooked":200,"onion":40,"tomato":50,"bell_pepper":30,"pita_bread":60,"parsley":10,"olive_oil":5}', 1.4),
  ('lamb_chops', 'ريش غنم', 'Lamb chops', 'Côtelettes d''agneau', array['riyash', 'ريش']::text[], 'plate', 'portion', '{"S":300,"M":400,"L":540}', '{"lamb_cooked":220,"fries":90,"tomato":40,"onion":20,"pita_bread":30}', 1.2),
  ('chicken_wings', 'جوانح دجاج', 'Grilled chicken wings', 'Ailes de poulet grillées', array['jawaneh', 'jawane7', 'جوانح']::text[], 'plate', 'portion', '{"S":300,"M":400,"L":540}', '{"chicken_wing_cooked":220,"toum":30,"lemon_juice":15,"garlic":5,"fries":90,"pickles":30,"olive_oil":10}', 1.4),
  ('half_grilled_chicken', 'نص فروج مشوي', 'Half grilled chicken', 'Demi-poulet grillé', array['farrouj meshwi', 'فروج', 'half chicken']::text[], 'plate', 'portion', '{"S":420,"M":550,"L":720}', '{"chicken_thigh_cooked":160,"chicken_breast_cooked":130,"toum":40,"fries":100,"pickles":40,"pita_bread":60,"lemon_juice":10}', 1.6),
  ('whole_grilled_chicken', 'فروج مشوي كامل', 'Whole grilled chicken', 'Poulet grillé entier', array['farrouj kamel', 'فروج كامل']::text[], 'plate', 'portion', '{"S":850,"M":1100,"L":1300}', '{"chicken_thigh_cooked":320,"chicken_breast_cooked":260,"toum":70,"fries":200,"pickles":80,"pita_bread":120,"lemon_juice":20}', 3.2),
  ('grilled_fish_fillet', 'فيليه سمك مشوي', 'Grilled fish fillet', 'Filet de poisson grillé', array['samak meshwi', 'سمك مشوي']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"fish_white_cooked":200,"tahini":25,"lemon_juice":15,"olive_oil":10,"rice_cooked":120,"onion":20,"parsley":5}', 1),
  ('fried_fish', 'سمك مقلي', 'Fried fish', 'Poisson frit', array['samak ma2li', 'سمك مقلي']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"fish_white_cooked":200,"flour_white":20,"vegetable_oil":25,"tahini":25,"lemon_juice":15,"pita_bread":60,"fries":60}', 1.2),
  ('sayadieh', 'صيادية', 'Sayadieh (fish and rice)', 'Sayadieh (poisson et riz)', array['sayadiyeh', 'صيادية']::text[], 'plate', 'portion', '{"S":350,"M":450,"L":600}', '{"fish_white_cooked":150,"rice_cooked":220,"onion":40,"vegetable_oil":15,"pine_nuts":8,"tahini":15}', 1.4),
  ('shrimp_plate', 'صحن قريدس', 'Shrimp plate', 'Assiette de crevettes', array['2rides', 'قريدس', 'jambari']::text[], 'plate', 'portion', '{"S":300,"M":400,"L":540}', '{"shrimp_cooked":180,"garlic":10,"lemon_juice":15,"olive_oil":15,"rice_cooked":150,"parsley":5}', 1.2),
  ('kibbeh_fried_piece', 'كبة مقلية (قطعة)', 'Fried kibbeh (piece)', 'Kebbe frite (pièce)', array['kebbe', 'kibbeh', 'كبة', 'kebbe ma2liye']::text[], 'mezze', 'piece', '{"S":40,"M":50,"L":70}', '{"bulgur_dry":12,"beef_ground_cooked":24,"onion":5,"pine_nuts":2,"vegetable_oil":6}', 0.25),
  ('kibbeh_bil_saynieh', 'كبة بالصينية', 'Baked kibbeh (tray)', 'Kebbe au four', array['kebbe bil saniyeh', 'كبة بالصينية']::text[], 'plate', 'portion', '{"S":200,"M":260,"L":350}', '{"bulgur_dry":55,"beef_ground_cooked":120,"onion":30,"pine_nuts":10,"ghee":12,"yogurt_whole":30}', 1),
  ('kibbeh_nayyeh', 'كبة نية', 'Kibbeh nayyeh (raw)', 'Kebbe nayyeh (crue)', array['kebbe nayye', 'كبة نية']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"lamb_raw_lean":120,"bulgur_dry":45,"onion":15,"mint":4,"olive_oil":12}', 1),
  ('kibbeh_labanieh', 'كبة لبنية', 'Kibbeh in yogurt', 'Kebbe au yaourt', array['kebbe labniyeh', 'كبة لبنية']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"yogurt_whole":250,"bulgur_dry":40,"beef_ground_cooked":70,"rice_cooked":40,"garlic":5,"mint":3,"ghee":8,"flour_white":4}', 1.2),
  ('kafta_bil_saynieh', 'كفتة بالصينية', 'Kafta with potatoes (tray)', 'Kafta au four aux pommes de terre', array['kafta bil saniyeh', 'كفتة بالصينية']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"beef_ground_cooked":150,"potato_boiled":150,"tomato":60,"tomato_paste":15,"onion":30,"vegetable_oil":12,"parsley":5}', 1.4),
  ('shish_barak', 'شيش برك', 'Shish barak', 'Chich barak', array['shishbarak', 'chich barak', 'شيش برك']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"yogurt_whole":220,"flour_white":60,"beef_ground_cooked":70,"onion":20,"pine_nuts":5,"ghee":8,"garlic":5,"mint":2,"water":30}', 1.2),
  ('mloukhieh', 'ملوخية بالدجاج والرز', 'Mloukhieh with chicken and rice', 'Mloukhieh au poulet et riz', array['mlou5iye', 'molokhia', 'ملوخية']::text[], 'plate', 'portion', '{"S":400,"M":520,"L":680}', '{"jute_leaves_cooked":180,"chicken_breast_cooked":100,"rice_cooked":180,"garlic":10,"vegetable_oil":12,"lemon_juice":10,"onion":20}', 1.6),
  ('mujaddara', 'مجدرة', 'Mujaddara (lentils and rice)', 'Moujaddara', array['mjadra', 'mjaddara', 'مجدرة']::text[], 'plate', 'portion', '{"S":280,"M":360,"L":480}', '{"lentils_cooked":160,"rice_cooked":120,"onion":50,"olive_oil":20}', 1),
  ('mdardara', 'مدردرة', 'Mdardara', 'Mdardara', array['mudardara', 'مدردرة']::text[], 'plate', 'portion', '{"S":280,"M":360,"L":480}', '{"lentils_cooked":140,"rice_cooked":150,"onion":50,"olive_oil":20}', 1),
  ('rice_vermicelli', 'رز بشعيرية', 'Rice with vermicelli', 'Riz aux vermicelles', array['riz bi sh3iriye', 'رز', 'rice']::text[], 'side', 'portion', '{"S":150,"M":200,"L":280}', '{"rice_cooked":175,"pasta_dry":12,"butter":8,"water":5}', 0.6),
  ('riz_a_djej', 'رز عا دجاج', 'Rice with chicken', 'Riz au poulet', array['riz 3a djej', 'رز ع دجاج']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"rice_cooked":250,"chicken_breast_cooked":130,"beef_ground_cooked":40,"almonds":12,"pine_nuts":8,"ghee":12,"onion":15}', 1.6),
  ('loubieh_bi_zeit', 'لوبية بزيت', 'Green beans in olive oil', 'Haricots verts à l''huile', array['loubye', 'لوبية']::text[], 'plate', 'portion', '{"S":220,"M":300,"L":400}', '{"green_beans_cooked":200,"tomato":60,"onion":25,"olive_oil":15,"garlic":5}', 1),
  ('fasolia_rice', 'فاصوليا ورز', 'White bean stew with rice', 'Ragoût de haricots blancs et riz', array['fasolia', 'فاصوليا']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"chickpeas_cooked":120,"beef_lean_cooked":60,"tomato_sauce":100,"rice_cooked":180,"onion":20,"vegetable_oil":10}', 1.4),
  ('bamieh_rice', 'بامية ورز', 'Okra stew with rice', 'Ragoût de gombos et riz', array['bamye', 'bamieh', 'بامية']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"okra_cooked":150,"beef_lean_cooked":70,"tomato_sauce":90,"rice_cooked":180,"garlic":8,"vegetable_oil":10}', 1.4),
  ('bazella_rice', 'بازيلا ورز', 'Peas and carrot stew with rice', 'Petits pois carottes et riz', array['bazella', 'بازيلا']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"peas_cooked":120,"carrot":50,"beef_lean_cooked":70,"tomato_sauce":80,"rice_cooked":180,"vegetable_oil":10}', 1.4),
  ('mahshi_koussa', 'كوسا محشي', 'Stuffed zucchini', 'Courgettes farcies', array['koussa mahshi', 'كوسا']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"zucchini_cooked":220,"rice_cooked":80,"beef_ground_cooked":60,"tomato_sauce":80,"mint":2,"vegetable_oil":5}', 1.4),
  ('warak_enab_zeit', 'ورق عنب بزيت', 'Stuffed vine leaves (vegetarian)', 'Feuilles de vigne farcies (végétarien)', array['warak 3enab', 'yalanji', 'ورق عنب', 'يالنجي']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"grape_leaves":50,"rice_cooked":90,"tomato":25,"parsley":10,"onion":10,"olive_oil":15,"lemon_juice":10,"mint":2}', 0.4),
  ('warak_enab_lahme', 'ورق عنب باللحمة', 'Stuffed vine leaves with meat', 'Feuilles de vigne à la viande', array['warak enab bil lahme', 'ورق عنب باللحمة']::text[], 'plate', 'portion', '{"S":300,"M":400,"L":540}', '{"grape_leaves":80,"rice_cooked":130,"beef_ground_cooked":80,"lamb_cooked":60,"lemon_juice":15,"garlic":5,"vegetable_oil":10}', 0.6),
  ('fatteh_hummus', 'فتة حمص', 'Chickpea fatteh', 'Fatteh aux pois chiches', array['fatte', 'fatteh', 'فتة']::text[], 'plate', 'portion', '{"S":280,"M":360,"L":480}', '{"chickpeas_cooked":120,"yogurt_whole":130,"pita_bread":45,"vegetable_oil":10,"tahini":15,"garlic":4,"pine_nuts":8,"ghee":8}', 1),
  ('fatteh_shawarma', 'فتة شاورما', 'Shawarma fatteh', 'Fatteh chawarma', array['fatteh shawarma', 'فتة شاورما']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"chicken_thigh_cooked":120,"yogurt_whole":120,"pita_bread":50,"vegetable_oil":10,"toum":20,"pickles":20,"chickpeas_cooked":40,"fries":40}', 1.2),
  ('maqluba', 'مقلوبة', 'Maqluba', 'Maqlouba', array['ma2loube', 'مقلوبة']::text[], 'plate', 'portion', '{"S":360,"M":460,"L":600}', '{"rice_cooked":200,"eggplant_cooked":100,"vegetable_oil":20,"chicken_breast_cooked":110,"almonds":10,"pine_nuts":5}', 1.4),
  ('freekeh_chicken', 'فريكة بالدجاج', 'Freekeh with chicken', 'Freekeh au poulet', array['freekeh', 'فريكة']::text[], 'plate', 'portion', '{"S":360,"M":460,"L":600}', '{"freekeh_cooked":240,"chicken_breast_cooked":130,"almonds":10,"ghee":10,"onion":20}', 1.4),
  ('moghrabieh', 'مغربية', 'Moghrabieh with chicken', 'Moghrabieh au poulet', array['moghrabiye', 'مغربية']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"moghrabieh_cooked":200,"chicken_breast_cooked":110,"chickpeas_cooked":60,"onion":60,"butter":12}', 1.4),
  ('chicken_liver_plate', 'سودة دجاج', 'Chicken livers with pomegranate molasses', 'Foies de volaille à la mélasse de grenade', array['sawda djej', 'سودة دجاج']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"chicken_liver_cooked":150,"pomegranate_molasses":15,"garlic":6,"lemon_juice":10,"olive_oil":15,"parsley":4}', 0.8),
  ('makanek_plate', 'صحن مقانق', 'Makanek (sausages)', 'Makanek (saucisses)', array['makanek', 'مقانق']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"sausage_beef_cooked":160,"lemon_juice":15,"pomegranate_molasses":10,"pine_nuts":5,"olive_oil":10}', 0),
  ('sujuk_plate', 'صحن سجق', 'Sujuk (spicy sausage)', 'Soujouk', array['sujuk', 'سجق']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"sausage_beef_cooked":160,"tomato":25,"lemon_juice":5,"olive_oil":10}', 0),
  ('arayes_kafta', 'عرايس كفتة', 'Arayes (kafta in grilled bread)', 'Arayes kafta', array['arayes', 'عرايس']::text[], 'mezze', 'portion', '{"S":180,"M":240,"L":320}', '{"pita_bread":90,"beef_ground_cooked":110,"onion":20,"parsley":8,"olive_oil":10}', 0.8),
  ('sfiha_piece', 'صفيحة (قطعة)', 'Sfiha (piece)', 'Sfiha (pièce)', array['sfeeha', 'lahm bi ajeen piece', 'صفيحة']::text[], 'bakery', 'piece', '{"S":40,"M":50,"L":70}', '{"flour_white":22,"beef_ground_cooked":15,"tomato":6,"onion":5,"vegetable_oil":3,"pomegranate_molasses":1}', 0.25),
  ('batata_harra', 'بطاطا حرة', 'Batata harra (spicy potatoes)', 'Batata harra (pommes de terre épicées)', array['batata 7arra', 'بطاطا حرة']::text[], 'mezze', 'portion', '{"S":180,"M":240,"L":320}', '{"potato_boiled":160,"vegetable_oil":25,"garlic":8,"parsley":10,"lemon_juice":10,"bell_pepper":10}', 1),
  ('hummus', 'حمص بطحينة', 'Hummus', 'Houmous', array['hommos', 'hommus', 'houmous', '7ommos', 'حمص']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"chickpeas_cooked":130,"tahini":35,"lemon_juice":15,"garlic":4,"olive_oil":12,"water":4}', 1),
  ('hummus_meat', 'حمص باللحمة', 'Hummus with meat', 'Houmous à la viande', array['hommos bil lahme', 'حمص باللحمة']::text[], 'mezze', 'portion', '{"S":200,"M":260,"L":350}', '{"chickpeas_cooked":120,"tahini":30,"lemon_juice":12,"garlic":4,"beef_lean_cooked":60,"pine_nuts":8,"ghee":10,"olive_oil":6}', 1),
  ('baba_ghanouj', 'بابا غنوج', 'Baba ghanouj', 'Baba ghanouj', array['baba ghanoush', 'بابا غنوج']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"eggplant_cooked":140,"tomato":20,"bell_pepper":10,"onion":10,"parsley":5,"pomegranate_molasses":5,"olive_oil":12}', 0.8),
  ('moutabal', 'متبل', 'Moutabal', 'Moutabal', array['mtabbal', 'متبل']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"eggplant_cooked":140,"tahini":30,"yogurt_whole":10,"lemon_juice":10,"garlic":3,"olive_oil":7}', 0.8),
  ('muhammara', 'محمرة', 'Muhammara', 'Mouhammara', array['mhammara', 'محمرة']::text[], 'mezze', 'portion', '{"S":120,"M":160,"L":220}', '{"red_pepper_paste":60,"walnuts":40,"pita_bread":20,"pomegranate_molasses":12,"olive_oil":20,"garlic":3,"lemon_juice":5}', 0),
  ('labneh_plate', 'صحن لبنة', 'Labneh plate', 'Assiette de labneh', array['labne', 'لبنة']::text[], 'mezze', 'portion', '{"S":120,"M":160,"L":220}', '{"labneh":130,"olive_oil":15,"mint":2,"olives":13}', 0.6),
  ('tabbouleh', 'تبولة', 'Tabbouleh', 'Taboulé', array['tabbouli', 'tabboule', 'تبولة']::text[], 'salad', 'portion', '{"S":180,"M":240,"L":330}', '{"parsley":120,"tomato":60,"bulgur_dry":15,"onion":15,"mint":8,"lemon_juice":20,"olive_oil":20}', 1),
  ('fattoush', 'فتوش', 'Fattoush', 'Fattouche', array['fatoush', 'fattouche', 'فتوش']::text[], 'salad', 'portion', '{"S":200,"M":280,"L":380}', '{"lettuce":60,"tomato":60,"cucumber":50,"radish":20,"onion":15,"parsley":15,"mint":5,"pita_bread":25,"vegetable_oil":8,"olive_oil":15,"lemon_juice":15,"pomegranate_molasses":8}', 1.2),
  ('rocca_salad', 'سلطة روكا', 'Rocca salad', 'Salade de roquette', array['roka', 'روكا']::text[], 'salad', 'portion', '{"S":150,"M":200,"L":280}', '{"lettuce":110,"onion":20,"tomato":30,"olive_oil":20,"lemon_juice":15,"pomegranate_molasses":5}', 0.8),
  ('shanklish_salad', 'سلطة شنكليش', 'Shanklish salad', 'Salade de chanklich', array['shankleesh', 'شنكليش']::text[], 'salad', 'portion', '{"S":150,"M":200,"L":280}', '{"cheese_feta":80,"tomato":60,"onion":20,"zaatar_mix":5,"olive_oil":20,"parsley":5}', 0),
  ('cabbage_salad', 'سلطة ملفوف', 'Cabbage salad', 'Salade de chou', array['salatet malfouf', 'ملفوف']::text[], 'salad', 'portion', '{"S":150,"M":200,"L":280}', '{"cabbage":150,"tomato":20,"garlic":3,"mint":2,"lemon_juice":15,"olive_oil":15}', 0.8),
  ('lentil_soup', 'شوربة عدس', 'Lentil soup', 'Soupe de lentilles', array['shorbet 3adas', 'عدس']::text[], 'soup', 'portion', '{"S":250,"M":350,"L":450}', '{"lentils_cooked":150,"onion":30,"carrot":20,"vegetable_oil":10,"lemon_juice":10,"water":130}', 1.2),
  ('vegetable_soup', 'شوربة خضرة', 'Vegetable soup', 'Soupe de légumes', array['shorba khodra', 'شوربة خضار']::text[], 'soup', 'portion', '{"S":250,"M":350,"L":450}', '{"carrot":40,"potato_boiled":50,"zucchini_cooked":40,"onion":20,"tomato":30,"pasta_dry":10,"vegetable_oil":8,"water":152}', 1.2),
  ('chicken_soup', 'شوربة دجاج', 'Chicken soup', 'Soupe de poulet', array['shorbet djej', 'شوربة دجاج']::text[], 'soup', 'portion', '{"S":250,"M":350,"L":450}', '{"chicken_breast_cooked":60,"rice_cooked":40,"carrot":25,"onion":15,"lemon_juice":5,"water":205}', 1.2),
  ('fries_portion', 'بطاطا مقلية', 'French fries', 'Frites', array['batata', 'fries', 'بطاطا']::text[], 'side', 'portion', '{"S":100,"M":150,"L":220}', '{"fries":150}', 0.3),
  ('cheese_rakakat_piece', 'رقاقات جبنة (قطعة)', 'Cheese rakakat (piece)', 'Rakakat au fromage (pièce)', array['ra2a2at', 'rakakat', 'رقاقات']::text[], 'mezze', 'piece', '{"S":20,"M":25,"L":35}', '{"phyllo":10,"cheese_feta":8,"cheese_mozzarella":3,"vegetable_oil":3,"parsley":1}', 0),
  ('sambousek_meat_piece', 'سمبوسك لحمة (قطعة)', 'Meat sambousek (piece)', 'Sambousek à la viande (pièce)', array['sambousik', 'سمبوسك']::text[], 'mezze', 'piece', '{"S":30,"M":40,"L":55}', '{"flour_white":14,"beef_ground_cooked":13,"onion":4,"pine_nuts":2,"vegetable_oil":5,"water":2}', 0.15),
  ('sambousek_cheese_piece', 'سمبوسك جبنة (قطعة)', 'Cheese sambousek (piece)', 'Sambousek au fromage (pièce)', array['sambousek jebne', 'سمبوسك جبنة']::text[], 'mezze', 'piece', '{"S":30,"M":40,"L":55}', '{"flour_white":14,"cheese_feta":10,"cheese_mozzarella":5,"parsley":1,"vegetable_oil":5,"water":5}', 0),
  ('spinach_fatayer_piece', 'فطاير سبانخ (قطعة)', 'Spinach fatayer (piece)', 'Fatayer aux épinards (pièce)', array['fatayer sbenegh', 'فطاير سبانخ']::text[], 'bakery', 'piece', '{"S":50,"M":65,"L":90}', '{"flour_white":28,"spinach_cooked":22,"onion":5,"lemon_juice":3,"olive_oil":4,"water":3}', 0.3),
  ('falafel_piece', 'فلافل (حبة)', 'Falafel (piece)', 'Falafel (pièce)', array['falafel', 'حبة فلافل']::text[], 'mezze', 'piece', '{"S":15,"M":20,"L":28}', '{"chickpeas_cooked":13,"fava_cooked":2,"onion":1,"parsley":1,"vegetable_oil":3}', 0.1),
  ('falafel_plate', 'صحن فلافل', 'Falafel plate', 'Assiette de falafels', array['falafel plate', 'صحن فلافل']::text[], 'plate', 'portion', '{"S":280,"M":360,"L":480}', '{"chickpeas_cooked":120,"fava_cooked":20,"vegetable_oil":30,"tahini":35,"tomato":40,"radish":20,"pickled_turnip":25,"parsley":10,"mint":5,"pita_bread":55}', 1.4),
  ('foul_moudammas', 'فول مدمس', 'Foul moudammas', 'Foul moudammas', array['foul', 'fool', 'فول']::text[], 'breakfast', 'portion', '{"S":220,"M":300,"L":400}', '{"fava_cooked":200,"chickpeas_cooked":40,"garlic":5,"lemon_juice":15,"olive_oil":20,"tomato":15,"parsley":5}', 1),
  ('balila', 'بليلة', 'Balila (warm chickpeas)', 'Balila (pois chiches chauds)', array['balila', 'بليلة']::text[], 'breakfast', 'portion', '{"S":220,"M":300,"L":400}', '{"chickpeas_cooked":240,"garlic":5,"lemon_juice":15,"olive_oil":20,"pine_nuts":5,"water":15}', 1),
  ('msabbaha', 'مسبحة', 'Msabbaha', 'Msabbaha', array['msab7a', 'مسبحة']::text[], 'breakfast', 'portion', '{"S":220,"M":300,"L":400}', '{"chickpeas_cooked":200,"tahini":40,"lemon_juice":15,"garlic":5,"olive_oil":20,"water":20}', 1),
  ('eggs_awarma', 'بيض بقاورما', 'Eggs with awarma', 'Œufs à l''awarma', array['bayd b awarma', 'بيض بقاورما']::text[], 'breakfast', 'portion', '{"S":150,"M":200,"L":270}', '{"egg_cooked":120,"lamb_cooked":50,"ghee":20,"onion":10}', 0.6),
  ('shakshuka', 'شكشوكة', 'Shakshuka', 'Chakchouka', array['shakshouka', 'شكشوكة']::text[], 'breakfast', 'portion', '{"S":220,"M":300,"L":400}', '{"egg_cooked":110,"tomato":120,"onion":30,"bell_pepper":25,"olive_oil":15}', 0.8),
  ('omelette', 'عجة', 'Omelette with herbs (ijjeh)', 'Omelette aux herbes (ijjeh)', array['3ejje', 'ijje', 'عجة']::text[], 'breakfast', 'portion', '{"S":120,"M":160,"L":220}', '{"egg_cooked":110,"parsley":15,"onion":15,"flour_white":5,"vegetable_oil":15}', 0.5),
  ('manousheh_zaatar', 'منقوشة زعتر', 'Za''atar manousheh', 'Manouché zaatar', array['man2oushe zaatar', 'manakish zaatar', 'zaatar', 'منقوشة زعتر', 'زعتر']::text[], 'bakery', 'piece', '{"S":110,"M":140,"L":190}', '{"flour_white":80,"zaatar_mix":15,"olive_oil":18,"water":27}', 0.8),
  ('manousheh_cheese', 'منقوشة جبنة', 'Cheese manousheh', 'Manouché fromage', array['man2oushe jebne', 'manakish cheese', 'jibne', 'منقوشة جبنة']::text[], 'bakery', 'piece', '{"S":130,"M":170,"L":230}', '{"flour_white":80,"cheese_mozzarella":60,"vegetable_oil":5,"water":25}', 0.6),
  ('manousheh_half_half', 'منقوشة نص نص', 'Half za''atar half cheese manousheh', 'Manouché moitié zaatar moitié fromage', array['nos nos', 'نص نص', 'half half']::text[], 'bakery', 'piece', '{"S":120,"M":155,"L":210}', '{"flour_white":80,"zaatar_mix":8,"olive_oil":10,"cheese_mozzarella":30,"water":27}', 0.7),
  ('manousheh_kishk', 'منقوشة كشك', 'Kishk manousheh', 'Manouché kichk', array['kechek', 'kishk', 'كشك']::text[], 'bakery', 'piece', '{"S":130,"M":165,"L":220}', '{"flour_white":80,"kishk_powder":25,"tomato":15,"onion":8,"olive_oil":12,"water":25}', 0.6),
  ('lahm_bi_ajeen', 'لحم بعجين', 'Lahm bi ajeen', 'Lahm bi ajine', array['la7m b 3ajin', 'lahm b3ajeen', 'لحم بعجين']::text[], 'bakery', 'piece', '{"S":130,"M":170,"L":230}', '{"flour_white":70,"beef_ground_cooked":50,"tomato":20,"onion":10,"vegetable_oil":5,"water":15}', 0.8),
  ('manousheh_cheese_sujuk', 'منقوشة جبنة وسجق', 'Cheese and sujuk manousheh', 'Manouché fromage et soujouk', array['jebne w sujuk', 'جبنة وسجق']::text[], 'bakery', 'piece', '{"S":150,"M":195,"L":260}', '{"flour_white":80,"cheese_mozzarella":50,"sausage_beef_cooked":35,"water":25,"vegetable_oil":5}', 0.4),
  ('manousheh_cocktail', 'منقوشة كوكتيل', 'Cocktail manousheh', 'Manouché cocktail', array['cocktail', 'كوكتيل']::text[], 'bakery', 'piece', '{"S":140,"M":180,"L":240}', '{"flour_white":80,"zaatar_mix":8,"olive_oil":8,"cheese_mozzarella":30,"tomato":15,"olives":10,"water":25,"mint":4}', 0.6),
  ('zaatar_wrap_veg', 'زعتر وخضرة', 'Za''atar wrap with vegetables', 'Wrap zaatar aux légumes', array['zaatar w khodra', 'زعتر وخضرة']::text[], 'bakery', 'piece', '{"S":150,"M":200,"L":260}', '{"flour_white":80,"zaatar_mix":15,"olive_oil":18,"tomato":25,"cucumber":20,"mint":4,"olives":8,"water":30}', 0.6),
  ('labneh_wrap', 'لبنة وخضرة (مرقوق)', 'Labneh wrap with vegetables', 'Wrap labneh et légumes', array['labne w khodra', 'لبنة وخضرة']::text[], 'bakery', 'piece', '{"S":160,"M":210,"L":270}', '{"pita_bread":80,"labneh":70,"tomato":25,"cucumber":20,"mint":4,"olives":10,"olive_oil":5}', 0.6),
  ('croissant_plain', 'كرواسون سادة', 'Plain croissant', 'Croissant nature', array['croissant', 'kroasan', 'كرواسان']::text[], 'bakery', 'piece', '{"S":45,"M":60,"L":80}', '{"croissant_plain":60}', 0),
  ('croissant_zaatar', 'كرواسون زعتر', 'Za''atar croissant', 'Croissant zaatar', array['croissant zaatar', 'كرواسان زعتر']::text[], 'bakery', 'piece', '{"S":60,"M":80,"L":100}', '{"croissant_plain":65,"zaatar_mix":7,"olive_oil":8}', 0),
  ('croissant_cheese', 'كرواسون جبنة', 'Cheese croissant', 'Croissant au fromage', array['croissant jebne', 'كرواسان جبنة']::text[], 'bakery', 'piece', '{"S":65,"M":85,"L":110}', '{"croissant_plain":60,"cheese_mozzarella":25}', 0),
  ('croissant_chocolate', 'كرواسون شوكولا', 'Chocolate croissant', 'Pain au chocolat', array['croissant choco', 'كرواسان شوكولا']::text[], 'bakery', 'piece', '{"S":65,"M":85,"L":110}', '{"croissant_plain":65,"chocolate_spread":20}', 0),
  ('kaak_sesame', 'كعكة بسمسم', 'Ka''ak (sesame bread ring)', 'Kaak au sésame', array['ka3ke', 'kaak', 'كعكة']::text[], 'bakery', 'piece', '{"S":90,"M":120,"L":160}', '{"flour_white":80,"sesame_seeds":10,"sugar":3,"vegetable_oil":3,"water":24}', 0.6),
  ('kaak_cheese', 'كعكة جبنة', 'Ka''ak with cheese', 'Kaak au fromage', array['ka3ke jebne', 'كعكة جبنة']::text[], 'bakery', 'piece', '{"S":130,"M":170,"L":220}', '{"flour_white":80,"sesame_seeds":10,"cheese_mozzarella":50,"water":30}', 0.6),
  ('kaak_zaatar', 'كعكة زعتر', 'Ka''ak with za''atar', 'Kaak au zaatar', array['ka3ke zaatar', 'كعكة زعتر']::text[], 'bakery', 'piece', '{"S":110,"M":145,"L":190}', '{"flour_white":80,"sesame_seeds":10,"zaatar_mix":12,"olive_oil":15,"water":28}', 0.6),
  ('arabic_bread_loaf', 'رغيف خبز عربي', 'Arabic bread (loaf)', 'Pain libanais (galette)', array['khebez', 'khibz', 'خبز']::text[], 'bakery', 'piece', '{"S":45,"M":60,"L":90}', '{"pita_bread":60}', 0),
  ('pizza_margherita', 'بيتزا مرغريتا', 'Pizza margherita (medium)', 'Pizza margherita (moyenne)', array['margarita', 'margherita', 'مارغريتا']::text[], 'pizza', 'portion', '{"S":280,"M":400,"L":560}', '{"flour_white":170,"tomato_sauce":70,"cheese_mozzarella":100,"olive_oil":12,"water":48}', 1.4),
  ('pizza_vegetarian', 'بيتزا خضرة', 'Vegetarian pizza (medium)', 'Pizza végétarienne (moyenne)', array['veggie pizza', 'بيتزا خضار']::text[], 'pizza', 'portion', '{"S":300,"M":430,"L":600}', '{"flour_white":170,"tomato_sauce":70,"cheese_mozzarella":80,"mushrooms":30,"bell_pepper":25,"olives":15,"onion":15,"olive_oil":10,"water":15}', 1.4),
  ('pizza_chicken', 'بيتزا دجاج', 'Chicken pizza (medium)', 'Pizza au poulet (moyenne)', array['chicken pizza', 'بيتزا دجاج']::text[], 'pizza', 'portion', '{"S":310,"M":450,"L":620}', '{"flour_white":170,"tomato_sauce":60,"cheese_mozzarella":90,"chicken_breast_cooked":70,"mushrooms":20,"olive_oil":10,"water":30}', 1.4),
  ('pizza_pepperoni', 'بيتزا ببروني', 'Pepperoni pizza (medium)', 'Pizza pepperoni (moyenne)', array['pepperoni', 'ببروني']::text[], 'pizza', 'portion', '{"S":290,"M":420,"L":580}', '{"flour_white":170,"tomato_sauce":60,"cheese_mozzarella":90,"sausage_beef_cooked":50,"olive_oil":10,"water":40}', 1),
  ('penne_arrabbiata', 'بيني أرابياتا', 'Penne arrabbiata', 'Penne all''arrabbiata', array['penne', 'arabiata', 'بيني']::text[], 'pasta', 'portion', '{"S":280,"M":380,"L":500}', '{"pasta_cooked":260,"tomato_sauce":90,"garlic":5,"olive_oil":15,"cheese_cheddar":10}', 1),
  ('fettuccine_alfredo', 'فيتوتشيني ألفريدو', 'Fettuccine alfredo with chicken', 'Fettuccine alfredo au poulet', array['alfredo', 'ألفريدو']::text[], 'pasta', 'portion', '{"S":300,"M":400,"L":520}', '{"pasta_cooked":230,"cream_heavy":70,"chicken_breast_cooked":70,"mushrooms":20,"cheese_cheddar":10}', 1),
  ('crispy_chicken_plate', 'صحن كريسبي', 'Crispy chicken plate', 'Assiette de poulet crispy', array['crispy plate', 'صحن كريسبي']::text[], 'plate', 'portion', '{"S":350,"M":450,"L":600}', '{"chicken_breast_cooked":180,"flour_white":40,"vegetable_oil":30,"fries":130,"cabbage":40,"mayonnaise":20,"ketchup":10}', 1.4),
  ('escalope_plate', 'صحن اسكالوب', 'Chicken escalope plate', 'Assiette escalope de poulet', array['escalope plate', 'صحن اسكالوب']::text[], 'plate', 'portion', '{"S":350,"M":450,"L":600}', '{"chicken_breast_cooked":180,"flour_white":30,"egg_cooked":10,"vegetable_oil":25,"fries":130,"cabbage":45,"mayonnaise":20,"lemon_juice":10}', 1.4),
  ('chicken_nuggets', 'ناغتس دجاج', 'Chicken nuggets', 'Nuggets de poulet', array['nuggets', 'ناغتس']::text[], 'plate', 'portion', '{"S":150,"M":220,"L":300}', '{"chicken_breast_cooked":130,"flour_white":35,"vegetable_oil":25,"ketchup":30}', 0.8),
  ('knefe_jebne', 'كنافة بالجبنة', 'Knefe with cheese', 'Knefé au fromage', array['knefe', 'kunafa', 'knafeh', 'kanafe', 'كنافة', 'كنافه']::text[], 'sweets', 'portion', '{"S":150,"M":200,"L":280}', '{"semolina":45,"butter":25,"cheese_mozzarella":80,"ater_syrup":45,"pistachios":5}', 0),
  ('knefe_kaak', 'كعكة كنافة', 'Knefe in ka''ak bread', 'Knefé en kaak', array['ka3ke knefe', 'knefe sandwich', 'كعكة كنافة']::text[], 'sweets', 'piece', '{"S":200,"M":260,"L":330}', '{"flour_white":70,"sesame_seeds":8,"semolina":30,"butter":18,"cheese_mozzarella":70,"ater_syrup":45,"water":19}', 0.4),
  ('knefe_ashta', 'كنافة بالقشطة', 'Knefe with ashta', 'Knefé à l''achta', array['knefe ashta', 'كنافة قشطة']::text[], 'sweets', 'portion', '{"S":150,"M":200,"L":280}', '{"semolina":45,"butter":25,"ashta":85,"ater_syrup":40,"pistachios":5}', 0),
  ('baklava_piece', 'بقلاوة (قطعة)', 'Baklava (piece)', 'Baklava (pièce)', array['baklawa', 'ba2lawa', 'بقلاوة']::text[], 'sweets', 'piece', '{"S":20,"M":25,"L":35}', '{"phyllo":9,"ghee":4,"pistachios":5,"ater_syrup":7}', 0),
  ('maamoul_dates_piece', 'معمول تمر (حبة)', 'Maamoul with dates (piece)', 'Maamoul aux dattes (pièce)', array['ma3moul', 'maamoul', 'معمول']::text[], 'sweets', 'piece', '{"S":30,"M":40,"L":55}', '{"semolina":15,"ghee":7,"dates":15,"sugar":2,"milk_whole":1}', 0),
  ('maamoul_walnut_piece', 'معمول جوز (حبة)', 'Maamoul with walnuts (piece)', 'Maamoul aux noix (pièce)', array['maamoul jowz', 'معمول جوز']::text[], 'sweets', 'piece', '{"S":30,"M":40,"L":55}', '{"semolina":15,"ghee":7,"walnuts":10,"sugar":6,"milk_whole":2}', 0),
  ('namoura_piece', 'نمورة (قطعة)', 'Namoura (piece)', 'Namoura (pièce)', array['basbousa', 'nammoura', 'نمورة', 'بسبوسة']::text[], 'sweets', 'piece', '{"S":45,"M":60,"L":80}', '{"semolina":22,"yogurt_whole":8,"sugar":6,"butter":6,"ater_syrup":16,"almonds":2}', 0),
  ('halawet_el_jibn', 'حلاوة الجبن', 'Halawet el jibn', 'Halawet el jebn', array['7alawet el jeben', 'حلاوة الجبن']::text[], 'sweets', 'portion', '{"S":120,"M":160,"L":220}', '{"semolina":35,"cheese_mozzarella":40,"ashta":50,"ater_syrup":30,"pistachios":5}', 0),
  ('mafroukeh', 'مفروكة', 'Mafroukeh', 'Mafroukeh', array['mafrouke', 'مفروكة']::text[], 'sweets', 'portion', '{"S":120,"M":160,"L":220}', '{"semolina":45,"butter":20,"sugar":15,"ashta":60,"pistachios":10,"almonds":5,"ater_syrup":5}', 0),
  ('atayef_ashta_piece', 'قطايف بالقشطة (حبة)', 'Atayef with ashta (piece)', 'Atayef à l''achta (pièce)', array['2tayef', 'qatayef', 'قطايف']::text[], 'sweets', 'piece', '{"S":45,"M":60,"L":80}', '{"flour_white":15,"semolina":5,"milk_whole":10,"ashta":20,"ater_syrup":8,"pistachios":2}', 0),
  ('atayef_walnut_piece', 'قطايف بالجوز (حبة)', 'Fried atayef with walnuts (piece)', 'Atayef frits aux noix (pièce)', array['2tayef jowz', 'قطايف جوز']::text[], 'sweets', 'piece', '{"S":45,"M":60,"L":80}', '{"flour_white":15,"semolina":5,"milk_whole":8,"walnuts":10,"sugar":4,"vegetable_oil":8,"ater_syrup":10}', 0),
  ('layali_lubnan', 'ليالي لبنان', 'Layali Lubnan', 'Layali Loubnan', array['layali lebnen', 'ليالي لبنان']::text[], 'sweets', 'portion', '{"S":150,"M":200,"L":270}', '{"milk_whole":110,"semolina":20,"sugar":12,"ashta":40,"pistachios":5,"ater_syrup":13}', 0),
  ('mouhalabieh', 'مهلبية', 'Mouhalabieh (milk pudding)', 'Mouhalabié', array['mhallabiye', 'مهلبية']::text[], 'sweets', 'portion', '{"S":120,"M":160,"L":220}', '{"milk_whole":130,"sugar":14,"semolina":10,"pistachios":4,"water":2}', 0),
  ('riz_bi_haleeb', 'رز بحليب', 'Rice pudding', 'Riz au lait', array['riz b 7alib', 'رز بحليب']::text[], 'sweets', 'portion', '{"S":150,"M":200,"L":270}', '{"milk_whole":140,"rice_cooked":40,"sugar":16,"water":4}', 0),
  ('meghli', 'مغلي', 'Meghli (spiced rice pudding)', 'Meghli', array['meghle', 'مغلي']::text[], 'sweets', 'portion', '{"S":150,"M":200,"L":270}', '{"rice_cooked":40,"sugar":20,"water":110,"walnuts":10,"pistachios":8,"almonds":6,"pine_nuts":6}', 0),
  ('sfouf_piece', 'صفوف (قطعة)', 'Sfouf (turmeric cake, piece)', 'Sfouf (pièce)', array['sfouf', 'صفوف']::text[], 'sweets', 'piece', '{"S":45,"M":60,"L":80}', '{"semolina":20,"flour_white":7,"sugar":15,"vegetable_oil":8,"milk_whole":9,"sesame_seeds":1}', 0.1),
  ('booza_ashta', 'بوظة عربية', 'Arabic ice cream (booza)', 'Glace arabe (bouza)', array['booza', 'bouza', 'بوظة']::text[], 'sweets', 'portion', '{"S":100,"M":150,"L":200}', '{"ice_cream":140,"pistachios":10}', 0),
  ('osmalieh', 'عصملية', 'Osmalieh', 'Osmalié', array['osmaliye', 'عصملية']::text[], 'sweets', 'portion', '{"S":120,"M":160,"L":220}', '{"phyllo":50,"ghee":20,"ashta":60,"ater_syrup":25,"pistachios":5}', 0),
  ('znoud_el_sit_piece', 'زنود الست (حبة)', 'Znoud el sit (piece)', 'Znoud el sett (pièce)', array['znoud el set', 'زنود الست']::text[], 'sweets', 'piece', '{"S":40,"M":55,"L":75}', '{"phyllo":15,"vegetable_oil":8,"ashta":20,"ater_syrup":10,"pistachios":2}', 0),
  ('chocolate_crepe', 'كريب شوكولا', 'Chocolate crêpe', 'Crêpe au chocolat', array['crepe', 'كريب']::text[], 'sweets', 'portion', '{"S":150,"M":200,"L":260}', '{"flour_white":45,"milk_whole":70,"egg_cooked":20,"butter":8,"chocolate_spread":45,"banana":12}', 0.2),
  ('ice_cream_scoop', 'بوظة (طابة)', 'Ice cream (scoop)', 'Glace (boule)', array['ice cream', 'glace', 'بوظة']::text[], 'sweets', 'piece', '{"S":50,"M":70,"L":100}', '{"ice_cream":70}', 0),
  ('fruit_cocktail_ashta', 'كوكتيل فواكه بالقشطة', 'Fruit cocktail with ashta', 'Cocktail de fruits à l''achta', array['cocktail', 'كوكتيل']::text[], 'drink', 'portion', '{"S":300,"M":400,"L":550}', '{"strawberry":80,"banana":80,"avocado":40,"orange_juice":120,"ashta":50,"honey":15,"pistachios":5,"pine_nuts":10}', 0),
  ('fresh_orange_juice', 'عصير ليمون (برتقال)', 'Fresh orange juice', 'Jus d''orange frais', array['3asir lemon', 'orange juice', 'عصير برتقال']::text[], 'drink', 'portion', '{"S":250,"M":350,"L":500}', '{"orange_juice":350}', 0),
  ('lemonade_mint', 'ليموناضة بالنعنع', 'Mint lemonade', 'Citronnade à la menthe', array['limonada', 'ليموناضة']::text[], 'drink', 'portion', '{"S":250,"M":350,"L":500}', '{"lemon_juice":50,"sugar":35,"mint":5,"water":260}', 0),
  ('jallab', 'جلاب', 'Jallab', 'Jallab', array['jallab', 'جلاب']::text[], 'drink', 'portion', '{"S":250,"M":350,"L":500}', '{"dates":20,"sugar":30,"water":285,"pine_nuts":10,"pistachios":5}', 0),
  ('ayran', 'عيران', 'Ayran (salted yogurt drink)', 'Ayran', array['laban ayran', 'عيران']::text[], 'drink', 'portion', '{"S":200,"M":250,"L":350}', '{"yogurt_whole":150,"water":100}', 0.8),
  ('turkish_coffee', 'قهوة عربية', 'Turkish / Arabic coffee', 'Café turc', array['ahwe', '2ahwe', 'قهوة']::text[], 'drink', 'portion', '{"S":60,"M":80,"L":120}', '{"coffee_brewed":75,"sugar":5}', 0),
  ('espresso', 'إسبريسو', 'Espresso', 'Espresso', array['espresso', 'اسبرسو']::text[], 'drink', 'portion', '{"S":30,"M":40,"L":60}', '{"espresso":40}', 0),
  ('cappuccino', 'كابوتشينو', 'Cappuccino', 'Cappuccino', array['cappuccino', 'كابتشينو']::text[], 'drink', 'portion', '{"S":200,"M":280,"L":380}', '{"espresso":60,"milk_whole":220}', 0),
  ('latte', 'لاتيه', 'Caffè latte', 'Café latte', array['latte', 'لاتيه']::text[], 'drink', 'portion', '{"S":250,"M":350,"L":450}', '{"espresso":60,"milk_whole":290}', 0),
  ('tea', 'شاي', 'Tea', 'Thé', array['shay', 'chai', 'شاي']::text[], 'drink', 'portion', '{"S":200,"M":250,"L":350}', '{"tea_brewed":240,"sugar":10}', 0),
  ('smoothie_banana_strawberry', 'سموذي موز وفريز', 'Banana strawberry smoothie', 'Smoothie banane fraise', array['smoothie', 'سموذي']::text[], 'drink', 'portion', '{"S":300,"M":400,"L":500}', '{"banana":120,"strawberry":100,"milk_whole":150,"honey":15,"water":15}', 0),
  ('avocado_juice', 'عصير أفوكا', 'Avocado juice', 'Jus d''avocat', array['avocado', 'أفوكا']::text[], 'drink', 'portion', '{"S":300,"M":400,"L":500}', '{"avocado":120,"milk_whole":220,"honey":20,"sugar":10,"pistachios":5,"water":25}', 0),
  ('shawarma_wrap_saj', 'شاورما عالصاج', 'Chicken shawarma on saj', 'Chawarma poulet au saj', array['shawarma saj', 'شاورما صاج']::text[], 'sandwich', 'portion', '{"S":220,"M":290,"L":380}', '{"flour_white":70,"chicken_thigh_cooked":120,"toum":20,"pickles":25,"fries":30,"water":25}', 1),
  ('saj_cheese', 'صاج جبنة', 'Cheese saj', 'Saj au fromage', array['saj jebne', 'صاج جبنة']::text[], 'bakery', 'piece', '{"S":150,"M":190,"L":250}', '{"flour_white":80,"cheese_mozzarella":60,"tomato":15,"mint":3,"water":32}', 0.6),
  ('saj_zaatar', 'صاج زعتر', 'Za''atar saj', 'Saj au zaatar', array['saj zaatar', 'صاج زعتر']::text[], 'bakery', 'piece', '{"S":130,"M":165,"L":220}', '{"flour_white":80,"zaatar_mix":15,"olive_oil":18,"tomato":15,"water":37}', 0.8),
  ('saj_labneh', 'صاج لبنة', 'Labneh saj', 'Saj au labneh', array['saj labne', 'صاج لبنة']::text[], 'bakery', 'piece', '{"S":160,"M":200,"L":260}', '{"flour_white":80,"labneh":70,"cucumber":15,"mint":3,"olive_oil":5,"water":27}', 0.6),
  ('saj_chocolate', 'صاج شوكولا', 'Chocolate saj', 'Saj au chocolat', array['saj nutella', 'صاج شوكولا']::text[], 'sweets', 'piece', '{"S":130,"M":160,"L":210}', '{"flour_white":80,"chocolate_spread":45,"banana":10,"water":25}', 0.3),
  ('musakhan_roll', 'مسخن رول', 'Musakhan roll', 'Rouleau musakhan', array['msakhan', 'مسخن']::text[], 'sandwich', 'piece', '{"S":90,"M":120,"L":160}', '{"flour_white":35,"chicken_thigh_cooked":45,"onion":20,"olive_oil":12,"pine_nuts":3,"water":5}', 0.4),
  ('chicken_fatteh_rice', 'فتة دجاج', 'Chicken fatteh with rice', 'Fatteh au poulet et riz', array['fattet djej', 'فتة دجاج']::text[], 'plate', 'portion', '{"S":360,"M":460,"L":600}', '{"chicken_breast_cooked":120,"rice_cooked":120,"yogurt_whole":120,"pita_bread":40,"vegetable_oil":10,"garlic":5,"pine_nuts":8,"ghee":8,"water":27}', 1.2),
  ('stuffed_cabbage', 'ملفوف محشي', 'Stuffed cabbage rolls', 'Rouleaux de chou farcis', array['malfouf mahshi', 'ملفوف محشي']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"cabbage":160,"rice_cooked":110,"beef_ground_cooked":70,"garlic":8,"lemon_juice":15,"mint":2,"vegetable_oil":5,"water":49}', 1.4),
  ('stuffed_eggplant', 'باذنجان محشي', 'Stuffed eggplant', 'Aubergines farcies', array['batenjen mahshi', 'باذنجان محشي']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"eggplant_cooked":180,"rice_cooked":80,"beef_ground_cooked":70,"tomato_sauce":80,"vegetable_oil":10}', 1.4),
  ('sheikh_el_mehshi', 'شيخ المحشي', 'Sheikh el mehshi (stuffed eggplant with yogurt)', 'Cheikh el mehchi', array['sheikh el me7she', 'شيخ المحشي']::text[], 'plate', 'portion', '{"S":320,"M":420,"L":560}', '{"eggplant_cooked":180,"beef_ground_cooked":90,"pine_nuts":8,"vegetable_oil":20,"tomato_sauce":70,"rice_cooked":52}', 1.4),
  ('potato_kibbeh', 'كبة بطاطا', 'Potato kibbeh', 'Kebbe de pommes de terre', array['kebbet batata', 'كبة بطاطا']::text[], 'plate', 'portion', '{"S":200,"M":260,"L":350}', '{"potato_boiled":150,"bulgur_dry":40,"onion":25,"olive_oil":25,"mint":3,"water":17}', 1),
  ('pumpkin_kibbeh', 'كبة يقطين', 'Pumpkin kibbeh', 'Kebbe de potiron', array['kebbet la2tin', 'كبة يقطين']::text[], 'plate', 'portion', '{"S":200,"M":260,"L":350}', '{"carrot":120,"bulgur_dry":45,"flour_white":10,"spinach_cooked":30,"onion":25,"olive_oil":25,"water":5}', 1),
  ('mjadra_hamra', 'مجدرة حمرا', 'Red mujaddara (lentils and bulgur)', 'Moujaddara rouge', array['mjadra hamra', 'مجدرة حمرا']::text[], 'plate', 'portion', '{"S":280,"M":360,"L":480}', '{"lentils_cooked":150,"bulgur_cooked":130,"onion":50,"olive_oil":20,"tomato_paste":10}', 1),
  ('bulgur_banadoura', 'برغل ببندورة', 'Bulgur with tomato', 'Boulgour à la tomate', array['burghol bi banadoura', 'برغل ببندورة']::text[], 'plate', 'portion', '{"S":250,"M":330,"L":440}', '{"bulgur_cooked":200,"tomato":80,"onion":25,"olive_oil":20,"tomato_paste":5}', 1),
  ('hindbeh', 'هندبة بزيت', 'Dandelion greens in olive oil (hindbeh)', 'Hindbé (chicorée à l''huile)', array['hindbe', 'هندبة']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"spinach_cooked":150,"onion":30,"olive_oil":20}', 0.8),
  ('fried_eggplant_mezze', 'باذنجان مقلي', 'Fried eggplant', 'Aubergines frites', array['batenjen ma2le', 'باذنجان مقلي']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"eggplant_cooked":150,"vegetable_oil":35,"garlic":3,"lemon_juice":10,"parsley":2}', 0.6),
  ('fried_cauliflower', 'قرنبيط مقلي', 'Fried cauliflower', 'Chou-fleur frit', array['arnabit', 'قرنبيط']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"cabbage":150,"vegetable_oil":30,"tahini":15,"lemon_juice":5}', 0.6),
  ('olives_pickles_plate', 'صحن زيتون وكبيس', 'Olives and pickles', 'Olives et pickles', array['zaytoun w kabis', 'كبيس']::text[], 'mezze', 'portion', '{"S":80,"M":120,"L":160}', '{"olives":60,"pickles":30,"pickled_turnip":30}', 0),
  ('vegetable_plate', 'صحن خضرة', 'Fresh vegetable plate', 'Assiette de crudités', array['khodra', 'صحن خضرة']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":280}', '{"tomato":60,"cucumber":60,"radish":20,"mint":10,"lettuce":30,"onion":20}', 0),
  ('rice_side', 'رز أبيض', 'White rice', 'Riz blanc', array['riz', 'rice']::text[], 'side', 'portion', '{"S":150,"M":200,"L":280}', '{"rice_cooked":190,"butter":5,"water":5}', 0.5),
  ('garlic_sauce_side', 'توم (صحن صغير)', 'Garlic sauce (side)', 'Sauce à l''ail (portion)', array['toum', 'توم']::text[], 'side', 'portion', '{"S":30,"M":50,"L":80}', '{"toum":50}', 0),
  ('chicken_breast_grilled_plain', 'صدر دجاج مشوي', 'Grilled chicken breast (plain)', 'Blanc de poulet grillé', array['sader djej', 'chicken breast', 'صدر دجاج']::text[], 'plate', 'portion', '{"S":150,"M":200,"L":280}', '{"chicken_breast_cooked":190,"olive_oil":5,"lemon_juice":5}', 0.6),
  ('healthy_bowl_chicken', 'بول دجاج صحي', 'Chicken quinoa-style healthy bowl', 'Bowl santé au poulet', array['healthy bowl', 'بول']::text[], 'plate', 'portion', '{"S":300,"M":400,"L":520}', '{"chicken_breast_cooked":150,"bulgur_cooked":100,"lettuce":40,"tomato":40,"cucumber":40,"avocado":20,"olive_oil":8,"lemon_juice":2}', 0.8),
  ('fajita_plate', 'صحن فاهيتا', 'Chicken fajita plate', 'Assiette fajita', array['fajita plate', 'صحن فاهيتا']::text[], 'plate', 'portion', '{"S":350,"M":450,"L":600}', '{"chicken_breast_cooked":170,"bell_pepper":60,"onion":50,"cheese_mozzarella":30,"rice_cooked":120,"vegetable_oil":12,"water":8}', 1.4),
  ('chicken_caesar_salad', 'سلطة سيزر بالدجاج', 'Chicken caesar salad', 'Salade César au poulet', array['caesar', 'سيزر']::text[], 'salad', 'portion', '{"S":250,"M":330,"L":440}', '{"lettuce":130,"chicken_breast_cooked":110,"cheese_cheddar":15,"pita_bread":20,"mayonnaise":30,"lemon_juice":10,"olive_oil":10,"garlic":5}', 0.6),
  ('greek_salad', 'سلطة يونانية', 'Greek salad', 'Salade grecque', array['greek salad', 'سلطة يونانية']::text[], 'salad', 'portion', '{"S":220,"M":300,"L":400}', '{"tomato":90,"cucumber":80,"cheese_feta":50,"olives":20,"onion":20,"bell_pepper":20,"olive_oil":20}', 0.3),
  ('tuna_salad', 'سلطة تونا', 'Tuna salad', 'Salade de thon', array['salata tuna', 'سلطة تونا']::text[], 'salad', 'portion', '{"S":220,"M":300,"L":400}', '{"tuna_oil_drained":100,"lettuce":80,"tomato":50,"cucumber":40,"olives":15,"lemon_juice":5,"olive_oil":10}', 0.3),
  ('arayes_cheese', 'عرايس جبنة', 'Cheese arayes', 'Arayes au fromage', array['arayes jebne', 'عرايس جبنة']::text[], 'mezze', 'portion', '{"S":150,"M":200,"L":270}', '{"pita_bread":90,"cheese_mozzarella":90,"olive_oil":10,"tomato":10}', 0.4),
  ('fatayer_zaatar_piece', 'فطاير زعتر (قطعة)', 'Za''atar fatayer (piece)', 'Fatayer au zaatar (pièce)', array['fatayer zaatar', 'فطاير زعتر']::text[], 'bakery', 'piece', '{"S":35,"M":45,"L":60}', '{"flour_white":26,"zaatar_mix":5,"olive_oil":6,"water":8}', 0.25),
  ('manousheh_spinach', 'منقوشة سبانخ', 'Spinach manousheh', 'Manouché aux épinards', array['man2oushe sbenegh', 'منقوشة سبانخ']::text[], 'bakery', 'piece', '{"S":140,"M":180,"L":240}', '{"flour_white":80,"spinach_cooked":60,"onion":10,"lemon_juice":5,"olive_oil":10,"water":15}', 0.7),
  ('halloumi_grilled_plate', 'حلوم مشوي', 'Grilled halloumi', 'Halloumi grillé', array['halloum meshwi', 'حلوم مشوي']::text[], 'breakfast', 'portion', '{"S":100,"M":140,"L":200}', '{"cheese_halloumi":110,"tomato":20,"olive_oil":5,"mint":5}', 0),
  ('eggs_fried', 'بيض مقلي', 'Fried eggs', 'Œufs au plat', array['bayd ma2le', 'بيض مقلي']::text[], 'breakfast', 'portion', '{"S":100,"M":130,"L":180}', '{"egg_cooked":110,"butter":10,"olive_oil":10}', 0.5),
  ('labneh_balls', 'لبنة مكعزلة', 'Labneh balls in oil', 'Boules de labneh à l''huile', array['labne mkaazle', 'لبنة مدعبلة']::text[], 'mezze', 'portion', '{"S":80,"M":110,"L":150}', '{"labneh":80,"olive_oil":25,"zaatar_mix":5}', 0.4),
  ('lebanese_breakfast_plate', 'ترويقة لبنانية', 'Lebanese breakfast plate', 'Petit-déjeuner libanais', array['tarwi2a', 'ترويقة']::text[], 'breakfast', 'portion', '{"S":300,"M":400,"L":550}', '{"labneh":60,"cheese_halloumi":40,"egg_cooked":50,"olives":20,"tomato":50,"cucumber":40,"mint":5,"olive_oil":15,"pita_bread":80,"zaatar_mix":5,"water":35}', 0.6),
  ('chicken_mandi', 'مندي دجاج', 'Chicken mandi', 'Mandi au poulet', array['mandi', 'مندي']::text[], 'plate', 'portion', '{"S":420,"M":550,"L":720}', '{"rice_cooked":280,"chicken_thigh_cooked":200,"ghee":15,"onion":20,"almonds":10,"tomato":25}', 1.8),
  ('kallaj_piece', 'كلاج (قطعة)', 'Kallaj (piece)', 'Kallaj (pièce)', array['kellej', 'كلاج']::text[], 'sweets', 'piece', '{"S":70,"M":90,"L":120}', '{"phyllo":25,"vegetable_oil":15,"ashta":30,"ater_syrup":20}', 0),
  ('awwamat', 'عوامات', 'Awwamat (syrup dumplings)', 'Awwamat (beignets au sirop)', array['3awwamet', 'luqaimat', 'عوامات']::text[], 'sweets', 'portion', '{"S":80,"M":110,"L":150}', '{"flour_white":35,"vegetable_oil":20,"ater_syrup":50,"water":5}', 0.1),
  ('ghraybeh_piece', 'غريبة (حبة)', 'Ghraybeh (butter cookie)', 'Ghraybé (sablé)', array['ghraybe', 'غريبة']::text[], 'sweets', 'piece', '{"S":15,"M":20,"L":30}', '{"flour_white":9,"ghee":6,"sugar":4,"pistachios":1}', 0),
  ('barazek_piece', 'برازق (حبة)', 'Barazek (sesame cookie)', 'Barazek (biscuit au sésame)', array['barazek', 'برازق']::text[], 'sweets', 'piece', '{"S":12,"M":16,"L":24}', '{"flour_white":7,"butter":3,"sugar":3,"sesame_seeds":2,"pistachios":1}', 0),
  ('karabij_piece', 'كرابيج حلب (حبة)', 'Karabij with natef (piece)', 'Karabij au natef (pièce)', array['karabij', 'كرابيج']::text[], 'sweets', 'piece', '{"S":25,"M":35,"L":45}', '{"semolina":15,"ghee":5,"walnuts":6,"sugar":7,"water":2}', 0),
  ('ashta_honey', 'قشطة بالعسل', 'Ashta with honey', 'Achta au miel', array['2eshta w 3asal', 'قشطة وعسل']::text[], 'sweets', 'portion', '{"S":100,"M":140,"L":190}', '{"ashta":100,"honey":30,"pistachios":10}', 0),
  ('chocolate_cake_slice', 'قطعة كاتو شوكولا', 'Chocolate cake (slice)', 'Gâteau au chocolat (part)', array['gateau', 'cake', 'كاتو']::text[], 'sweets', 'piece', '{"S":80,"M":110,"L":150}', '{"flour_white":25,"sugar":30,"butter":15,"egg_cooked":12,"chocolate_spread":20,"milk_whole":8}', 0.2),
  ('cheesecake_slice', 'قطعة تشيز كيك', 'Cheesecake (slice)', 'Cheesecake (part)', array['cheesecake', 'تشيز كيك']::text[], 'sweets', 'piece', '{"S":90,"M":120,"L":160}', '{"cream_heavy":35,"labneh":35,"sugar":20,"flour_white":12,"butter":10,"egg_cooked":8}', 0.2),
  ('hot_chocolate', 'هوت شوكولا', 'Hot chocolate', 'Chocolat chaud', array['hot choco', 'هوت شوكليت']::text[], 'drink', 'portion', '{"S":200,"M":280,"L":380}', '{"milk_whole":240,"chocolate_spread":25,"sugar":15}', 0),
  ('iced_coffee', 'قهوة مثلجة', 'Iced latte', 'Latte glacé', array['iced coffee', 'ايس كوفي']::text[], 'drink', 'portion', '{"S":300,"M":400,"L":500}', '{"espresso":60,"milk_whole":200,"sugar":15,"water":125}', 0),
  ('chickpea_salad', 'سلطة حمص', 'Chickpea salad', 'Salade de pois chiches', array['salata 7ommos', 'سلطة حمص']::text[], 'salad', 'portion', '{"S":200,"M":270,"L":360}', '{"chickpeas_cooked":130,"tomato":50,"cucumber":40,"parsley":15,"onion":10,"lemon_juice":10,"olive_oil":15}', 0.8),
  ('kafta_hindiyeh', 'كفتة هندية', 'Kafta in tomato sauce with rice', 'Kafta à la sauce tomate et riz', array['kafta hindiye', 'كفتة هندية']::text[], 'plate', 'portion', '{"S":380,"M":480,"L":620}', '{"beef_ground_cooked":140,"tomato_sauce":100,"onion":30,"rice_cooked":190,"vegetable_oil":10,"water":10}', 1.6);
-- END LIBRARY

-- Nutrition of a library dish at a portion size (S/M/L) with optional extras the merchant mentioned
-- ({"extra_oil_g": 10, "extra_sauce_g": 20}). Sodium includes the recipe's salt (38.758% sodium).
create function public.dish_nutrition(p_dish_id text, p_size text default 'M', p_extras jsonb default '{}')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with d as (
    select dl.*, coalesce((dl.portion_g ->> p_size)::numeric, (dl.portion_g ->> 'M')::numeric) / (dl.portion_g ->> 'M')::numeric as k
    from public.dish_library dl where dl.id = p_dish_id
  ),
  parts as (
    select r.key as ingredient, r.value::numeric * d.k as grams from d, jsonb_each_text(d.recipe) r
    union all select 'vegetable_oil', least(greatest(coalesce((p_extras ->> 'extra_oil_g')::numeric, 0), 0), 60) from d
    union all select 'toum', least(greatest(coalesce((p_extras ->> 'extra_sauce_g')::numeric, 0), 0), 80) from d
  ),
  t as (
    select
      sum(p.grams * i.kcal / 100) as kcal, sum(p.grams * i.protein_g / 100) as protein_g,
      sum(p.grams * i.carbs_g / 100) as carbs_g, sum(p.grams * i.fat_g / 100) as fat_g,
      sum(p.grams * i.sugar_g / 100) as sugar_g, sum(p.grams * i.fibre_g / 100) as fibre_g,
      sum(p.grams * i.sat_fat_g / 100) as sat_fat_g, sum(p.grams * i.sodium_mg / 100) as sodium_mg
    from parts p join public.nutrition_ingredients i on i.id = p.ingredient
  )
  select jsonb_build_object(
    'dish_id', d.id, 'size', p_size, 'portion_g', round(coalesce((d.portion_g ->> p_size)::numeric, (d.portion_g ->> 'M')::numeric)),
    'kcal', round(t.kcal), 'protein_g', round(t.protein_g, 1), 'carbs_g', round(t.carbs_g, 1), 'fat_g', round(t.fat_g, 1),
    'sugar_g', round(t.sugar_g, 1), 'fibre_g', round(t.fibre_g, 1), 'sat_fat_g', round(t.sat_fat_g, 1),
    'sodium_mg', round(t.sodium_mg + d.salt_g * d.k * 387.58),
    'may_contain', (select coalesce(jsonb_agg(distinct a order by a), '[]') from jsonb_object_keys(d.recipe) k
                     join public.nutrition_ingredients i on i.id = k, unnest(i.allergens) a))
  from d, t;
$$;
grant execute on function public.dish_nutrition(text, text, jsonb) to anon, authenticated, service_role;

-- Library dishes a menu item's name may be: best first. Names, aliases and Arabizi spellings, normalised.
create function public.dish_match(p_name text, p_limit integer default 3)
returns table (dish_id text, name_en text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select app_private.normalize_place_name(coalesce(p_name, '')) as n)
  select d.id, d.name_en,
    greatest(
      extensions.similarity(app_private.normalize_place_name(d.name_en), q.n),
      extensions.similarity(app_private.normalize_place_name(d.name_ar), q.n),
      extensions.similarity(app_private.normalize_place_name(d.name_fr), q.n),
      coalesce((select max(extensions.similarity(app_private.normalize_place_name(a), q.n)) from unnest(d.aliases) a), 0)
    )::real as score
  from public.dish_library d, q
  where char_length(q.n) >= 2
  order by score desc, d.id
  limit least(greatest(coalesce(p_limit, 3), 1), 10);
$$;
grant execute on function public.dish_match(text, integer) to anon, authenticated, service_role;

-- 3. Per-item nutrition -------------------------------------------------------------------------------------
create type public.nutrition_source as enum ('merchant_verified', 'estimated', 'unknown');

create table public.menu_item_nutrition (
  item_id uuid primary key references public.menu_items (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  dish_id text references public.dish_library (id) on delete set null,
  portion_g numeric(7, 1) check (portion_g > 0),
  kcal numeric(7, 1) check (kcal >= 0),
  protein_g numeric(6, 1) check (protein_g >= 0),
  carbs_g numeric(6, 1) check (carbs_g >= 0),
  fat_g numeric(6, 1) check (fat_g >= 0),
  sugar_g numeric(6, 1) check (sugar_g >= 0),
  fibre_g numeric(6, 1) check (fibre_g >= 0),
  sat_fat_g numeric(6, 1) check (sat_fat_g >= 0),
  sodium_mg numeric(8, 1) check (sodium_mg >= 0),
  -- Per value: {"kcal": "estimated", "protein_g": "merchant_verified", ...}; a missing key is unknown.
  value_sources jsonb not null default '{}' check (jsonb_typeof(value_sources) = 'object'),
  status public.nutrition_source not null default 'unknown',
  confidence numeric(3, 2) check (confidence between 0 and 1),
  -- What the estimate assumed: dish, size, extras, match score. Shown to the merchant, never to customers as fact.
  assumptions jsonb not null default '{}' check (jsonb_typeof(assumptions) = 'object'),
  -- "May contain" from the recipe: a prompt for the merchant ("please check"), never a declaration.
  may_contain public.allergen[] not null default '{}',
  estimated_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.vendor_members (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index menu_item_nutrition_vendor_idx on public.menu_item_nutrition (vendor_id, status);
create trigger menu_item_nutrition_touch before update on public.menu_item_nutrition
  for each row execute function app_private.touch_updated_at();
create trigger menu_item_nutrition_audit after insert or update or delete on public.menu_item_nutrition
  for each row execute function app_private.audit_row();
alter table public.menu_item_nutrition enable row level security;
revoke all on table public.menu_item_nutrition from public, anon, authenticated;
grant all on table public.menu_item_nutrition to service_role;
-- Clients read values, their sources and the status. Assumptions, may-contain suggestions and who confirmed
-- stay with the merchant's dashboard (server-side), so a suggestion never reads like a declaration.
grant select (item_id, vendor_id, dish_id, portion_g, kcal, protein_g, carbs_g, fat_g, sugar_g, fibre_g, sat_fat_g,
  sodium_mg, value_sources, status, updated_at) on table public.menu_item_nutrition to anon, authenticated;
create policy menu_item_nutrition_read on public.menu_item_nutrition for select to anon, authenticated
  using (app_private.menu_vendor_visible(vendor_id));

-- 4. Merchant-declared allergens and diet tags -------------------------------------------------------------
-- The existing flags (allergens, vegetarian, vegan, fasting_friendly) stay merchant-declared (§17); these
-- columns record that the merchant actually declared them, so an empty allergen list is never read as
-- "free from". Adding columns with defaults is allowed during the data freeze (§31); menu_items is not frozen.
-- `diets_declared` lists exactly which flags the merchant declared (vegetarian, vegan, siyami, halal,
-- no_added_sugar), so declaring one never makes the others count.
alter table public.menu_items
  add column allergens_confirmed_at timestamptz,
  add column diets_declared text[] not null default '{}'
    check (diets_declared <@ array['vegetarian', 'vegan', 'siyami', 'halal', 'no_added_sugar']),
  add column halal boolean not null default false,
  add column no_added_sugar boolean not null default false;
grant select (allergens_confirmed_at, diets_declared, halal, no_added_sugar) on table public.menu_items to anon, authenticated;

-- Who may change an item's declarations or nutrition: owner and manager (§18.1 H), operators, or the server
-- acting for such a member.
create function app_private.menu_editor(p_vendor_id uuid, p_member_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select app_private.order_actor(p_vendor_id, array['owner', 'manager']::public.member_role[], p_member_id) $$;
revoke all on function app_private.menu_editor(uuid, uuid) from public;
grant execute on function app_private.menu_editor(uuid, uuid) to authenticated, service_role;

-- The merchant declares allergens and diet tags for an item (dashboard or WhatsApp tap). This is the only
-- writer of these flags; the AI may only suggest (`may_contain`).
create function app_private.menu_item_dietary_set(p_item_id uuid, p_allergens public.allergen[], p_vegetarian boolean,
  p_vegan boolean, p_siyami boolean, p_halal boolean, p_no_added_sugar boolean, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor uuid;
  v_declared text[];
begin
  select i.vendor_id into v_vendor from public.menu_items i where i.id = p_item_id;
  if v_vendor is null then
    raise exception 'unknown item' using errcode = 'no_data_found';
  end if;
  perform app_private.menu_editor(v_vendor, p_member_id);
  if coalesce(p_vegan, false) and p_vegetarian is not null and not p_vegetarian then
    raise exception 'a vegan item is also vegetarian' using errcode = 'check_violation';
  end if;
  -- Only the flags given (not null) become declared; a vegan declaration also declares vegetarian.
  v_declared := array_remove(array[
    case when p_vegetarian is not null or coalesce(p_vegan, false) then 'vegetarian' end,
    case when p_vegan is not null then 'vegan' end,
    case when p_siyami is not null then 'siyami' end,
    case when p_halal is not null then 'halal' end,
    case when p_no_added_sugar is not null then 'no_added_sugar' end], null);
  perform set_config('app.audit_reason', 'merchant declared allergens and diet tags', true);
  update public.menu_items set
    allergens = case when p_allergens is null then allergens else (select coalesce(array_agg(distinct a order by a), '{}') from unnest(p_allergens) a) end,
    allergens_confirmed_at = case when p_allergens is null then allergens_confirmed_at else now() end,
    vegetarian = coalesce(p_vegetarian, vegetarian) or coalesce(p_vegan, false),
    vegan = coalesce(p_vegan, vegan),
    fasting_friendly = coalesce(p_siyami, fasting_friendly),
    halal = coalesce(p_halal, halal),
    no_added_sugar = coalesce(p_no_added_sugar, no_added_sugar),
    diets_declared = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(diets_declared || v_declared) d)
  where id = p_item_id;
  return jsonb_build_object('status', 'saved');
end;
$$;

-- Estimates for every item of a vendor that the merchant has not verified: match a library dish, compute at
-- the portion the merchant chose (S/M/L, one question for the batch) with any extras (the second question).
-- Returns what the merchant confirms: "≈ 450 kcal · 38 g protein (estimated)".
create function app_private.menu_nutrition_estimate(p_vendor_id uuid, p_size text default null, p_extras jsonb default '{}',
  p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_item record;
  v_match record;
  v_n jsonb;
  v_size text := case when p_size in ('S', 'M', 'L') then p_size else 'M' end;
  v_est int := 0;
  v_unknown int := 0;
  v_rows jsonb := '[]';
  v_min real := public.config_numeric('dish_match_min_score');
begin
  perform app_private.menu_editor(p_vendor_id, p_member_id);
  perform set_config('app.audit_reason', 'nutrition estimate from the dish library', true);
  for v_item in
    select i.id, coalesce(i.name_en, i.name_ar, i.name_fr) as name, i.name_ar, i.name_en, i.name_fr
    from public.menu_items i
    left join public.menu_item_nutrition n on n.item_id = i.id
    -- Rows with any value the merchant entered or confirmed are left alone (never overwritten or nulled).
    where i.vendor_id = p_vendor_id
      and coalesce(n.status, 'unknown') <> 'merchant_verified'
      and not exists (select 1 from jsonb_each_text(coalesce(n.value_sources, '{}')) e where e.value = 'merchant_verified')
    order by i.sort_order, i.id
  loop
    select m.* into v_match from (
      select * from public.dish_match(v_item.name_en, 1)
      union all select * from public.dish_match(v_item.name_ar, 1)
      union all select * from public.dish_match(v_item.name_fr, 1)
    ) m order by m.score desc limit 1;
    if v_match.dish_id is null or v_match.score < v_min then
      insert into public.menu_item_nutrition (item_id, vendor_id, status, assumptions)
      values (v_item.id, p_vendor_id, 'unknown', jsonb_build_object('reason', 'no library dish matched'))
      on conflict (item_id) do update set status = 'unknown', dish_id = null, value_sources = '{}',
        assumptions = excluded.assumptions, kcal = null, protein_g = null, carbs_g = null, fat_g = null,
        sugar_g = null, fibre_g = null, sat_fat_g = null, sodium_mg = null, portion_g = null, confidence = null;
      v_unknown := v_unknown + 1;
      continue;
    end if;
    v_n := public.dish_nutrition(v_match.dish_id, v_size, coalesce(p_extras, '{}'));
    insert into public.menu_item_nutrition (item_id, vendor_id, dish_id, portion_g, kcal, protein_g, carbs_g, fat_g, sugar_g,
      fibre_g, sat_fat_g, sodium_mg, value_sources, status, confidence, assumptions, may_contain, estimated_at)
    values (v_item.id, p_vendor_id, v_match.dish_id, (v_n ->> 'portion_g')::numeric, (v_n ->> 'kcal')::numeric,
      (v_n ->> 'protein_g')::numeric, (v_n ->> 'carbs_g')::numeric, (v_n ->> 'fat_g')::numeric, (v_n ->> 'sugar_g')::numeric,
      (v_n ->> 'fibre_g')::numeric, (v_n ->> 'sat_fat_g')::numeric, (v_n ->> 'sodium_mg')::numeric,
      '{"kcal": "estimated", "protein_g": "estimated", "carbs_g": "estimated", "fat_g": "estimated", "sugar_g": "estimated", "fibre_g": "estimated", "sat_fat_g": "estimated", "sodium_mg": "estimated"}',
      'estimated', round((v_match.score * case when p_size is null then 0.8 else 1 end)::numeric, 2),
      jsonb_build_object('dish_id', v_match.dish_id, 'size', v_size, 'size_answered', p_size is not null,
        'extras', coalesce(p_extras, '{}'), 'match_score', round(v_match.score::numeric, 2), 'library', 'v1'),
      (select coalesce(array_agg(a::public.allergen), '{}') from jsonb_array_elements_text(v_n -> 'may_contain') a),
      now())
    on conflict (item_id) do update set dish_id = excluded.dish_id, portion_g = excluded.portion_g, kcal = excluded.kcal,
      protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, sugar_g = excluded.sugar_g,
      fibre_g = excluded.fibre_g, sat_fat_g = excluded.sat_fat_g, sodium_mg = excluded.sodium_mg,
      value_sources = excluded.value_sources, status = 'estimated', confidence = excluded.confidence,
      assumptions = excluded.assumptions, may_contain = excluded.may_contain, estimated_at = now();
    v_est := v_est + 1;
    if jsonb_array_length(v_rows) < 10 then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'name', v_item.name,
        'dish', v_match.name_en, 'kcal', v_n -> 'kcal', 'protein_g', v_n -> 'protein_g'));
    end if;
  end loop;
  return jsonb_build_object('estimated', v_est, 'unknown', v_unknown, 'size', v_size, 'items', v_rows);
end;
$$;

-- The merchant's Confirm tap: estimates become merchant_verified (all of the vendor's, or the listed items).
create function app_private.menu_nutrition_confirm(p_vendor_id uuid, p_item_ids uuid[] default null, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid := app_private.menu_editor(p_vendor_id, p_member_id);
  v_n int;
begin
  perform set_config('app.audit_reason', 'merchant confirmed nutrition', true);
  with x as (
    update public.menu_item_nutrition n set status = 'merchant_verified', confirmed_at = now(), confirmed_by = v_member,
      value_sources = (select coalesce(jsonb_object_agg(k, 'merchant_verified'), '{}') from jsonb_object_keys(n.value_sources) k)
    where n.vendor_id = p_vendor_id and n.status = 'estimated' and (p_item_ids is null or n.item_id = any (p_item_ids))
    returning 1
  )
  select count(*) into v_n from x;
  return jsonb_build_object('confirmed', v_n);
end;
$$;

-- The merchant edits values (dashboard): each value given becomes merchant_verified; the row is verified
-- once calories, protein, carbohydrates and fat all are.
create function app_private.menu_nutrition_set(p_item_id uuid, p_values jsonb, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor uuid;
  v_member uuid;
  v_key text;
  v_val numeric;
  v_row public.menu_item_nutrition%rowtype;
  v_limits jsonb := '{"portion_g": 5000, "kcal": 5000, "protein_g": 500, "carbs_g": 1000, "fat_g": 500, "sugar_g": 500, "fibre_g": 200, "sat_fat_g": 300, "sodium_mg": 20000}';
begin
  select i.vendor_id into v_vendor from public.menu_items i where i.id = p_item_id;
  if v_vendor is null then
    raise exception 'unknown item' using errcode = 'no_data_found';
  end if;
  v_member := app_private.menu_editor(v_vendor, p_member_id);
  insert into public.menu_item_nutrition (item_id, vendor_id) values (p_item_id, v_vendor) on conflict (item_id) do nothing;
  for v_key in select jsonb_object_keys(coalesce(p_values, '{}')) loop
    if not v_limits ? v_key then
      raise exception 'unknown nutrition field %', v_key using errcode = 'invalid_parameter_value';
    end if;
    v_val := (p_values ->> v_key)::numeric;
    if v_val is null or v_val < 0 or v_val > (v_limits ->> v_key)::numeric then
      raise exception '% must be between 0 and %', v_key, v_limits ->> v_key using errcode = 'check_violation';
    end if;
    execute format('update public.menu_item_nutrition set %I = $1, value_sources = value_sources || jsonb_build_object(%L, ''merchant_verified'') where item_id = $2',
      v_key, v_key) using v_val, p_item_id;
  end loop;
  select * into v_row from public.menu_item_nutrition where item_id = p_item_id;
  if v_row.value_sources ->> 'kcal' = 'merchant_verified' and v_row.value_sources ->> 'protein_g' = 'merchant_verified'
     and v_row.value_sources ->> 'carbs_g' = 'merchant_verified' and v_row.value_sources ->> 'fat_g' = 'merchant_verified' then
    update public.menu_item_nutrition set status = 'merchant_verified', confirmed_at = now(), confirmed_by = v_member
    where item_id = p_item_id;
  end if;
  return jsonb_build_object('status', (select status from public.menu_item_nutrition where item_id = p_item_id));
end;
$$;

-- Derived tags per serving with fixed thresholds (config). Sugar-free comes from the numbers; "no added
-- sugar" only from the merchant's declaration, and the two are kept apart.
create function app_private.nutrition_tags(p_item_id uuid) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when n.protein_g >= (t ->> 'high_protein_min_g')::numeric then 'high_protein' end,
    case when n.carbs_g <= (t ->> 'low_carb_max_g')::numeric then 'low_carb' end,
    case when n.fat_g <= (t ->> 'low_fat_max_g')::numeric then 'low_fat' end,
    case when n.sodium_mg <= (t ->> 'low_sodium_max_mg')::numeric then 'low_sodium' end,
    case when n.sugar_g <= (t ->> 'sugar_free_max_g')::numeric then 'sugar_free' end,
    case when i.no_added_sugar and 'no_added_sugar' = any (i.diets_declared) then 'no_added_sugar' end
  ], null)
  from public.menu_items i
  left join public.menu_item_nutrition n on n.item_id = i.id and n.status <> 'unknown'
  cross join (select public.config_value('nutrition_tag_thresholds') as t) c
  where i.id = p_item_id;
$$;
revoke all on function app_private.nutrition_tags(uuid) from public;
grant execute on function app_private.nutrition_tags(uuid) to service_role;

-- How often searches use nutrition filters (kill-gate, §32.3). Counts only, no search text (§32.5: no raw
-- health searches kept).
create table app_private.nutrition_filter_usage (
  day date primary key,
  searches integer not null default 0,
  filtered integer not null default 0
);
revoke all on table app_private.nutrition_filter_usage from public, anon, authenticated;

-- Items of a vendor that fit a customer's needs. Hard filters (allergens, diets) use only what the merchant
-- declared; macro filters may use estimates, and every row says which ("≈ estimated").
create function public.menu_items_filter(p_vendor_id uuid, p_free_from public.allergen[] default null,
  p_diets text[] default null, p_max_kcal numeric default null, p_min_protein_g numeric default null,
  p_tags text[] default null, p_limit integer default 10)
returns table (item_id uuid, name_ar text, name_en text, name_fr text, price_usd numeric, kcal numeric, protein_g numeric,
  carbs_g numeric, fat_g numeric, nutrition_source public.nutrition_source, tags text[], allergens public.allergen[],
  allergens_declared boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filtered boolean := p_free_from is not null or p_diets is not null or p_max_kcal is not null
    or p_min_protein_g is not null or p_tags is not null;
begin
  insert into app_private.nutrition_filter_usage (day, searches, filtered)
  values ((now() at time zone 'Asia/Beirut')::date, 1, case when v_filtered then 1 else 0 end)
  on conflict (day) do update set searches = app_private.nutrition_filter_usage.searches + 1,
    filtered = app_private.nutrition_filter_usage.filtered + excluded.filtered;
  return query
  select i.id, i.name_ar, i.name_en, i.name_fr, i.price_usd,
    case when n.status <> 'unknown' then n.kcal end, case when n.status <> 'unknown' then n.protein_g end,
    case when n.status <> 'unknown' then n.carbs_g end, case when n.status <> 'unknown' then n.fat_g end,
    coalesce(n.status, 'unknown'::public.nutrition_source), app_private.nutrition_tags(i.id),
    case when i.allergens_confirmed_at is not null then i.allergens end, i.allergens_confirmed_at is not null
  from public.menu_items i
  left join public.menu_item_nutrition n on n.item_id = i.id
  where i.vendor_id = p_vendor_id
    and app_private.menu_item_orderable(i.id, 1)
    and exists (select 1 from public.vendors v where v.id = p_vendor_id and v.orderable and v.listing_status = 'active')
    -- Allergens: only a merchant declaration counts; an undeclared item never passes a free-from filter.
    and (p_free_from is null or (i.allergens_confirmed_at is not null and not (i.allergens && p_free_from)))
    -- Diets: each asked flag must itself be declared by the merchant and true.
    and (p_diets is null or (i.diets_declared @> p_diets
      and (not 'vegan' = any (p_diets) or i.vegan)
      and (not 'vegetarian' = any (p_diets) or i.vegetarian)
      and (not 'siyami' = any (p_diets) or i.fasting_friendly)
      and (not 'halal' = any (p_diets) or i.halal)))
    and (p_max_kcal is null or (n.status <> 'unknown' and n.kcal <= p_max_kcal))
    and (p_min_protein_g is null or (n.status <> 'unknown' and n.protein_g >= p_min_protein_g))
    and (p_tags is null or app_private.nutrition_tags(i.id) @> p_tags)
  order by (n.status = 'merchant_verified') desc nulls last, i.sort_order, i.id
  limit least(greatest(coalesce(p_limit, 10), 1), 30);
end;
$$;

-- The kill-gate numbers for the admin (§32.3): claimed merchants, the share that confirmed estimates, and the
-- share of menu searches that used a nutrition filter over the last 30 days.
create function public.nutrition_kill_gate() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'claimed_merchants', (select count(*) from public.vendors where claim_status = 'claimed'),
    'merchants_with_estimates', (select count(distinct vendor_id) from public.menu_item_nutrition where estimated_at is not null),
    'merchants_confirmed', (select count(distinct vendor_id) from public.menu_item_nutrition where status = 'merchant_verified'),
    'searches_30d', (select coalesce(sum(searches), 0) from app_private.nutrition_filter_usage where day > current_date - 30),
    'filtered_30d', (select coalesce(sum(filtered), 0) from app_private.nutrition_filter_usage where day > current_date - 30),
    'thresholds', public.config_value('nutrition_kill_gate'));
$$;

-- 5. Menu drafts (smart menu import) ------------------------------------------------------------------------
-- A draft is what the model (or Claude Code, for test menus) read from photos, a PDF, a link or text. It is
-- data only: nothing reaches the menu until the merchant approves a section, and prices are stored exactly
-- as read with their currency (or none). The server converts LBP at today's rate and shows it before saving.
create table public.menu_drafts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  created_by uuid references public.vendor_members (id) on delete set null,
  source text not null check (source in ('photo', 'pdf', 'link', 'instagram', 'text', 'fixture')),
  status text not null default 'draft' check (status in ('draft', 'partly_approved', 'approved', 'discarded')),
  -- [{"name_ar","name_en","name_fr","approved":bool,"items":[{"name_ar","name_en","name_fr","description",
  --   "price":number|null,"currency":"USD"|"LBP"|null,"confidence":0-1,"options":[{"name","min","max",
  --   "choices":[{"name","price":number|null}]}]}]}]
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_drafts_vendor_idx on public.menu_drafts (vendor_id, created_at desc);
create trigger menu_drafts_touch before update on public.menu_drafts
  for each row execute function app_private.touch_updated_at();
alter table public.menu_drafts enable row level security;
revoke all on table public.menu_drafts from public, anon, authenticated;
grant all on table public.menu_drafts to service_role;
grant select on table public.menu_drafts to authenticated;
create policy menu_drafts_read on public.menu_drafts for select to authenticated
  using ((select app_private.is_operator()) or app_private.has_vendor_role(vendor_id, array['owner', 'manager']::public.member_role[]));

-- Shape checks on a draft (the TypeScript validator does the same before calling; the database is the gate).
create function app_private.menu_draft_check(p_sections jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
declare
  s jsonb;
  i jsonb;
  n int := 0;
begin
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) not between 1 and 60 then
    raise exception 'a draft has 1-60 sections' using errcode = 'invalid_parameter_value';
  end if;
  for s in select * from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(s -> 'items') <> 'array' then
      raise exception 'each section needs an items array' using errcode = 'invalid_parameter_value';
    end if;
    for i in select * from jsonb_array_elements(s -> 'items') loop
      n := n + 1;
      if char_length(coalesce(i ->> 'name_ar', i ->> 'name_en', i ->> 'name_fr', '')) not between 1 and 120 then
        raise exception 'every item needs a name of 1-120 characters' using errcode = 'invalid_parameter_value';
      end if;
      if i ? 'price' and jsonb_typeof(i -> 'price') not in ('number', 'null') then
        raise exception 'a price is a number or null' using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_typeof(i -> 'price') = 'number' and ((i ->> 'price')::numeric < 0 or (i ->> 'price')::numeric > 100000000) then
        raise exception 'price out of range' using errcode = 'check_violation';
      end if;
      if coalesce(i ->> 'currency', 'USD') not in ('USD', 'LBP') then
        raise exception 'currency must be USD, LBP or null' using errcode = 'invalid_parameter_value';
      end if;
      if exists (select 1 from jsonb_array_elements(coalesce(i -> 'options', '[]')) o, jsonb_array_elements(coalesce(o -> 'choices', '[]')) c
                 where (c ? 'price' and jsonb_typeof(c -> 'price') not in ('number', 'null'))
                    or (jsonb_typeof(c -> 'price') = 'number' and ((c ->> 'price')::numeric < 0 or (c ->> 'price')::numeric > 100000000))
                    or coalesce(c ->> 'currency', 'USD') not in ('USD', 'LBP')) then
        raise exception 'option prices are numbers in USD or LBP' using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  end loop;
  if n > public.config_numeric('menu_draft_max_items') then
    raise exception 'a draft has at most % items', public.config_numeric('menu_draft_max_items') using errcode = 'check_violation';
  end if;
end;
$$;

create function app_private.menu_draft_create(p_vendor_id uuid, p_source text, p_sections jsonb, p_warnings jsonb default '[]',
  p_model text default null, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid := app_private.menu_editor(p_vendor_id, p_member_id);
  v_id uuid;
begin
  perform app_private.menu_draft_check(p_sections);
  if (select count(*) from public.menu_drafts d where d.vendor_id = p_vendor_id and d.created_at > now() - interval '1 day')
     >= public.config_numeric('menu_drafts_daily_per_vendor') then
    raise exception 'at most % menu drafts a day', public.config_numeric('menu_drafts_daily_per_vendor') using errcode = 'check_violation';
  end if;
  insert into public.menu_drafts (vendor_id, created_by, source, sections, warnings, model)
  values (p_vendor_id, v_member, p_source,
    (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(p_sections) s),
    coalesce(p_warnings, '[]'), left(p_model, 80))
  returning id into v_id;
  return app_private.menu_draft_summary(v_id);
end;
$$;

-- Per section: how many items, how many have a usable price (USD, or LBP converted at today's rate).
create function app_private.menu_draft_summary(p_draft_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('draft_id', d.id, 'vendor_id', d.vendor_id, 'status', d.status, 'usd_lbp_rate', public.usd_lbp_rate(),
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
      'index', s.ord - 1,
      'name', coalesce(s.v ->> 'name_ar', s.v ->> 'name_en', s.v ->> 'name_fr', 'Menu'),
      'approved', coalesce((s.v ->> 'approved')::boolean, false),
      'items', jsonb_array_length(s.v -> 'items'),
      'priced', (select count(*) from jsonb_array_elements(s.v -> 'items') i
                 where jsonb_typeof(i -> 'price') = 'number' and i ->> 'currency' in ('USD', 'LBP')),
      'preview', (select jsonb_agg(left(coalesce(i ->> 'name_ar', i ->> 'name_en', i ->> 'name_fr'), 40)
                                   || coalesce(' · ' || case i ->> 'currency' when 'USD' then '$' || (i ->> 'price')
                                     when 'LBP' then '≈ $' || round((i ->> 'price')::numeric / public.usd_lbp_rate(), 2)::text end, ''))
                  from (select i from jsonb_array_elements(s.v -> 'items') i limit 8) x)
    ) order by s.ord) from jsonb_array_elements(d.sections) with ordinality s (v, ord)), '[]'))
  from public.menu_drafts d where d.id = p_draft_id;
$$;

-- The merchant approves one section: it becomes a menu section with its items. Items without a clear
-- price (none, or a bare number with no currency) are not created; they come back as "needs a price".
create function app_private.menu_draft_approve_section(p_draft_id uuid, p_index integer, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.menu_drafts%rowtype;
  v_s jsonb;
  v_item jsonb;
  v_opt jsonb;
  v_choice jsonb;
  v_section uuid;
  v_new_item uuid;
  v_group uuid;
  v_price numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_inserted int := 0;
  v_needs jsonb := '[]';
  v_sort int;
begin
  select * into v_d from public.menu_drafts where id = p_draft_id for update;
  if v_d.id is null or v_d.status in ('approved', 'discarded') then
    return jsonb_build_object('status', coalesce(v_d.status, 'unknown'));
  end if;
  perform app_private.menu_editor(v_d.vendor_id, p_member_id);
  v_s := case when p_index >= 0 then v_d.sections -> p_index end;
  if v_s is null then
    raise exception 'no section %', p_index using errcode = 'invalid_parameter_value';
  end if;
  if coalesce((v_s ->> 'approved')::boolean, false) then
    return jsonb_build_object('status', 'already_approved');
  end if;
  perform set_config('app.actor_kind', case when (select auth.uid()) is null then 'whatsapp' else 'user' end, true);
  perform set_config('app.audit_reason', 'menu draft ' || p_draft_id || ' section ' || p_index || ' approved by the merchant', true);
  select coalesce(max(sort_order), 0) + 10 into v_sort from public.menu_sections where vendor_id = v_d.vendor_id;
  for v_item in select * from jsonb_array_elements(v_s -> 'items') loop
    v_price := case
      when jsonb_typeof(v_item -> 'price') <> 'number' then null
      when v_item ->> 'currency' = 'USD' then round((v_item ->> 'price')::numeric, 2)
      when v_item ->> 'currency' = 'LBP' then round((v_item ->> 'price')::numeric / v_rate, 2)
      else null end;
    -- A positive price that rounds to $0.00 is a misread (e.g. a USD price marked LBP): ask, never sell at 0.
    if v_price = 0 and (v_item ->> 'price')::numeric > 0 then
      v_price := null;
    end if;
    -- An option with a price but no currency (its own or the item's) is as unclear as the item's own price.
    if v_price is null or exists (
      select 1 from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) o, jsonb_array_elements(coalesce(o -> 'choices', '[]')) c
      where jsonb_typeof(c -> 'price') = 'number' and (c ->> 'price')::numeric > 0
        and coalesce(c ->> 'currency', v_item ->> 'currency') is null) then
      v_needs := v_needs || jsonb_build_array(left(coalesce(v_item ->> 'name_ar', v_item ->> 'name_en', v_item ->> 'name_fr'), 60));
      continue;
    end if;
    if v_section is null then
      insert into public.menu_sections (vendor_id, name_ar, name_en, name_fr, sort_order)
      values (v_d.vendor_id, left(v_s ->> 'name_ar', 80), left(v_s ->> 'name_en', 80),
              coalesce(left(v_s ->> 'name_fr', 80), case when v_s ->> 'name_ar' is null and v_s ->> 'name_en' is null then 'Menu' end), v_sort)
      returning id into v_section;
    end if;
    insert into public.menu_items (vendor_id, section_id, name_ar, name_en, name_fr, description, price_usd, sort_order)
    values (v_d.vendor_id, v_section, left(v_item ->> 'name_ar', 120), left(v_item ->> 'name_en', 120), left(v_item ->> 'name_fr', 120),
            left(v_item ->> 'description', 500), v_price, v_inserted * 10)
    returning id into v_new_item;
    v_inserted := v_inserted + 1;
    for v_opt in select * from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) loop
      insert into public.menu_option_groups (item_id, name_ar, name_en, min_select, max_select)
      values (v_new_item, case when (v_opt ->> 'name') ~ '[؀-ۿ]' then left(v_opt ->> 'name', 60) end,
              case when (v_opt ->> 'name') !~ '[؀-ۿ]' then left(coalesce(v_opt ->> 'name', 'Options'), 60) end,
              least(greatest(coalesce((v_opt ->> 'min')::int, 0), 0), 10),
              least(greatest(coalesce((v_opt ->> 'max')::int, 1), greatest(coalesce((v_opt ->> 'min')::int, 0), 1)), 20))
      returning id into v_group;
      for v_choice in select * from jsonb_array_elements(coalesce(v_opt -> 'choices', '[]')) loop
        insert into public.menu_options (group_id, name_ar, name_en, price_delta_usd)
        values (v_group, case when (v_choice ->> 'name') ~ '[؀-ۿ]' then left(v_choice ->> 'name', 60) end,
                case when (v_choice ->> 'name') !~ '[؀-ۿ]' then left(coalesce(v_choice ->> 'name', '?'), 60) end,
                case when jsonb_typeof(v_choice -> 'price') <> 'number' then 0
                     when coalesce(v_choice ->> 'currency', v_item ->> 'currency') = 'LBP' then round((v_choice ->> 'price')::numeric / v_rate, 2)
                     when coalesce(v_choice ->> 'currency', v_item ->> 'currency') = 'USD' then round((v_choice ->> 'price')::numeric, 2)
                     else 0 end);
      end loop;
    end loop;
  end loop;
  update public.menu_drafts set
    sections = jsonb_set(sections, array[p_index::text, 'approved'], 'true'),
    status = case when (select bool_and(coalesce((s ->> 'approved')::boolean, false) or ord - 1 = p_index)
                        from jsonb_array_elements(sections) with ordinality x (s, ord)) then 'approved' else 'partly_approved' end
  where id = p_draft_id;
  return jsonb_build_object('status', 'approved', 'section_id', v_section, 'inserted', v_inserted, 'needs_price', v_needs);
end;
$$;

create function app_private.menu_draft_discard(p_draft_id uuid, p_member_id uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_vendor uuid;
begin
  select vendor_id into v_vendor from public.menu_drafts where id = p_draft_id;
  if v_vendor is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  perform app_private.menu_editor(v_vendor, p_member_id);
  update public.menu_drafts set status = 'discarded' where id = p_draft_id and status <> 'approved';
  return jsonb_build_object('status', 'discarded');
end;
$$;

-- One menu-model read for this vendor today, taken before the call (bounds spend; §29.5 style atomic take).
create table app_private.menu_model_usage (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (vendor_id, day)
);
revoke all on table app_private.menu_model_usage from public, anon, authenticated;

create function public.menu_model_take(p_vendor_id uuid, p_member_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_ok boolean;
begin
  perform app_private.menu_editor(p_vendor_id, p_member_id);
  insert into app_private.menu_model_usage (vendor_id, day, calls)
  values (p_vendor_id, (now() at time zone 'Asia/Beirut')::date, 1)
  on conflict (vendor_id, day) do update set calls = app_private.menu_model_usage.calls + 1
  where app_private.menu_model_usage.calls < public.config_numeric('menu_model_calls_daily_per_vendor')
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;
revoke all on function public.menu_model_take(uuid, uuid) from public, anon, authenticated;
grant execute on function public.menu_model_take(uuid, uuid) to service_role;

-- A merchant sent menu photos while the menu model is unavailable (no credit, §32.7) or could not read
-- them: Rasheed is asked to help (one alert per vendor per day); nothing is guessed.
create function public.merchant_menu_help(p_vendor_id uuid, p_member_id uuid, p_media_ref text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.menu_editor(p_vendor_id, p_member_id);
  perform app_private.ops_alert('menu-help:' || p_vendor_id || ':' || to_char(now() at time zone 'Asia/Beirut', 'YYYY-MM-DD'),
    'menu_help', 'info', 'A merchant sent menu photos to set up: '
      || coalesce((select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = p_vendor_id), 'unknown'),
    null, p_vendor_id, jsonb_build_object('media', left(p_media_ref, 300)));
end;
$$;
revoke all on function public.merchant_menu_help(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.merchant_menu_help(uuid, uuid, text) to service_role;

-- Client-callable wrappers (security invoker over the definer functions that check the caller).
create function public.menu_item_dietary_set(p_item_id uuid, p_allergens public.allergen[], p_vegetarian boolean,
  p_vegan boolean, p_siyami boolean, p_halal boolean, p_no_added_sugar boolean, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_item_dietary_set(p_item_id, p_allergens, p_vegetarian, p_vegan, p_siyami, p_halal, p_no_added_sugar, p_member_id) $$;
create function public.menu_nutrition_estimate(p_vendor_id uuid, p_size text default null, p_extras jsonb default '{}',
  p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_nutrition_estimate(p_vendor_id, p_size, p_extras, p_member_id) $$;
create function public.menu_nutrition_confirm(p_vendor_id uuid, p_item_ids uuid[] default null, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_nutrition_confirm(p_vendor_id, p_item_ids, p_member_id) $$;
create function public.menu_nutrition_set(p_item_id uuid, p_values jsonb, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_nutrition_set(p_item_id, p_values, p_member_id) $$;
create function public.menu_draft_create(p_vendor_id uuid, p_source text, p_sections jsonb, p_warnings jsonb default '[]',
  p_model text default null, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_draft_create(p_vendor_id, p_source, p_sections, p_warnings, p_model, p_member_id) $$;
create function public.menu_draft_summary(p_draft_id uuid) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_draft_summary(p_draft_id) $$;
create function public.menu_draft_approve_section(p_draft_id uuid, p_index integer, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_draft_approve_section(p_draft_id, p_index, p_member_id) $$;
create function public.menu_draft_discard(p_draft_id uuid, p_member_id uuid default null) returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.menu_draft_discard(p_draft_id, p_member_id) $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'menu_item_dietary_set(uuid, public.allergen[], boolean, boolean, boolean, boolean, boolean, uuid)',
    'menu_nutrition_estimate(uuid, text, jsonb, uuid)',
    'menu_nutrition_confirm(uuid, uuid[], uuid)',
    'menu_nutrition_set(uuid, jsonb, uuid)',
    'menu_draft_create(uuid, text, jsonb, jsonb, text, uuid)',
    'menu_draft_approve_section(uuid, integer, uuid)',
    'menu_draft_discard(uuid, uuid)'
  ] loop
    execute format('revoke all on function app_private.%s from public, anon', f);
    execute format('grant execute on function app_private.%s to authenticated, service_role', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;
-- The summary reads only drafts the caller may see through the definer: members check through the dashboard
-- server; clients read menu_drafts under RLS instead.
revoke all on function app_private.menu_draft_summary(uuid) from public, anon, authenticated;
grant execute on function app_private.menu_draft_summary(uuid) to service_role;
revoke all on function public.menu_draft_summary(uuid) from public, anon, authenticated;
grant execute on function public.menu_draft_summary(uuid) to service_role;
revoke all on function app_private.menu_draft_check(jsonb) from public;
revoke all on function public.menu_items_filter(uuid, public.allergen[], text[], numeric, numeric, text[], integer) from public, anon, authenticated;
grant execute on function public.menu_items_filter(uuid, public.allergen[], text[], numeric, numeric, text[], integer) to service_role;
revoke all on function public.nutrition_kill_gate() from public, anon, authenticated;
grant execute on function public.nutrition_kill_gate() to service_role;
