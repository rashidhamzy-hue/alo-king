-- Alo King Chouf, session PD1 (product data standard), pull request 2, part (a): category templates as data.
-- docs/PRODUCT_DATA_STANDARD.md, "The product data standard: every item, by category". Every item follows the common core plus the
-- fields of its own category's template: food fields never appear on a cleaning product; a shampoo or a pet food gets its own fields.
--
--   product_templates      one row per template: packaged food and drinks, fresh produce, meat and poultry, bakery, water, cleaning and
--                          household, beauty and personal care, baby and child, baby food, pet, gas (future, no items), vendor dish, and
--                          the common core every grocery template includes
--   template_fields        each template's fields: key, type, unit, what it is required for ("sellable", "fact_complete" or nothing),
--                          the sources allowed to fill it, who approves it (automatic or a person) and where it is kept
--   category_templates     products.category (and optionally its sub_type) -> template. A dish (a product a restaurant owns) is always
--                          the vendor dish template
--   product_field_values   the values of template fields that are not food facts (food facts stay in product_facts, 0021): scent, age
--                          range, species, hazard warnings as printed, origin, supply fields ... each with its source, evidence and approval
--
-- Two rules in SQL, each with a test:
--   1. Food facts exist only on food templates: product_facts refuses a new row for an item whose template is not food (and an approval
--      of an old one). The chat answers "doesn't apply" to a food question about such an item (product_facts_for_chat, 0205).
--   2. A category with no template cannot hold an active item: a product inserted active, or switched to active, needs its template.
--      Inserting it also needs a name, a sale unit and a storage zone. Items active today all have a template (seeded below), so the
--      catalogue does not freeze. The rest of "sellable" (the Arabic name, a price at the hub) is listed per item (0205).
-- Field values follow their template too: a value for a field the item's template does not have is refused.

create table product_templates (
  code     text primary key,
  name_en  text not null,
  name_ar  text not null,
  is_food  boolean not null,                       -- food facts (ingredients, allergens, nutrition, diet) belong only here
  future   boolean not null default false,         -- gas: defined now, no items yet
  includes_core boolean not null default true,     -- grocery templates include the common core; a vendor dish has its own fields
  note     text
);
insert into product_templates(code, name_en, name_ar, is_food, future, includes_core, note) values
  ('core',               'Common core',                  'الأساس المشترك',            false, false, false, 'Every grocery item: identity, selling, pictures, category and kind, audience and occasion, storage, supply, search words'),
  ('packaged_food',      'Packaged food and drinks',     'أكل ومشروبات معلّبة',       true,  false, true,  null),
  ('fresh_produce',      'Fresh produce',                'خضرة وفواكه',               true,  false, true,  'No barcode: origin and sale unit by rules and the supplier; no nutrition expected'),
  ('meat_poultry',       'Meat and poultry',             'لحوم ودجاج',                true,  false, true,  'Halal always a person, with the supplier''s certificate'),
  ('bakery',             'Bakery and daily bread',       'مخبوزات وخبز',              true,  false, true,  'Allergens as declared by the bakery, approved by a person'),
  ('water',              'Water',                        'مي',                         true,  false, true,  null),
  ('cleaning_household', 'Cleaning and household',       'تنظيف ومنزل',               false, false, true,  'Packed apart from food; hazard warnings as printed, approved by a person'),
  ('beauty_personal_care','Beauty and personal care',    'عناية شخصية',               false, false, true,  'A claim that sounds medical needs a person'),
  ('baby_child',         'Baby and child',               'أطفال',                      false, false, true,  'Nappies, wipes, baby care. Baby food is the baby food template'),
  ('baby_food',          'Baby food',                    'أكل أطفال',                  true,  false, true,  'The packaged food template plus the age printed'),
  ('pet',                'Pet zone',                     'حيوانات أليفة',             false, false, true,  'Pet food has its own analytical constituents, never human food facts'),
  ('gas',                'Gas and household services',   'غاز وخدمات منزلية',         false, true,  true,  'Future: no items yet'),
  ('vendor_dish',        'Vendor dish',                  'طبق من مطعم',               true,  false, false, 'A restaurant dish: food facts are declared by the vendor, with their date (0204)');

create table template_fields (
  template_code   text not null references product_templates(code),
  key             text not null,
  field_group     text not null,
  label_en        text not null,
  type            text not null check (type in ('text', 'number', 'boolean', 'enum', 'list', 'range', 'evidence', 'facts')),
  unit            text,
  allowed         text[],                         -- for an enum: the allowed values
  required_for    text check (required_for in ('sellable', 'fact_complete')),
  allowed_sources text[] not null,
  approval        text not null check (approval in ('automatic', 'person')),
  store           text not null check (store in ('products', 'offers', 'cost', 'facts', 'values', 'images', 'tags', 'claims', 'certificates', 'search')),
  primary key (template_code, key)
);

-- The common core (every grocery template includes it). Sellable = every field "required for sellable" is there.
insert into template_fields(template_code, key, field_group, label_en, type, unit, allowed, required_for, allowed_sources, approval, store) values
  ('core', 'barcode',         'identity', 'Barcode (GTIN)',                    'text',    null, null, null,       '{barcode_lookup,supplier_sheet,label_photo}', 'automatic', 'products'),
  ('core', 'brand',           'identity', 'Brand',                             'text',    null, null, null,       '{barcode_lookup,supplier_sheet,label_photo}', 'automatic', 'products'),
  ('core', 'name_en',         'identity', 'Name in English',                   'text',    null, null, 'sellable', '{barcode_lookup,supplier_sheet,label_photo}', 'automatic', 'products'),
  ('core', 'name_ar',         'identity', 'Name in Arabic',                    'text',    null, null, 'sellable', '{label_photo,model,person}',                 'person',    'products'),
  ('core', 'name_fr',         'identity', 'Name in French',                    'text',    null, null, null,       '{label_photo,model,person}',                 'automatic', 'values'),
  ('core', 'spoken_name',     'identity', 'Spoken Lebanese name',              'list',    null, null, null,       '{model,rules,person}',                       'automatic', 'search'),
  ('core', 'size',            'identity', 'Size and unit',                     'text',    null, null, null,       '{barcode_lookup,supplier_sheet,label_photo}', 'automatic', 'values'),
  ('core', 'pack_count',      'identity', 'Pack count',                        'number',  null, null, null,       '{barcode_lookup,supplier_sheet,label_photo}', 'automatic', 'values'),
  ('core', 'variant',         'identity', 'Variant',                           'text',    null, null, null,       '{barcode_lookup,label_photo}',               'automatic', 'values'),
  ('core', 'price_usd',       'selling',  'Price in USD at the hub',           'number',  'USD', null, 'sellable', '{supplier_invoice,person}',                 'person',    'offers'),
  ('core', 'cost_usd',        'selling',  'Cost',                              'number',  'USD', null, null,      '{supplier_invoice,person}',                  'person',    'cost'),
  ('core', 'sell_unit',       'selling',  'Sell unit',                         'text',    null, null, 'sellable', '{supplier_sheet,person,rules}',              'automatic', 'products'),
  ('core', 'case_size',       'selling',  'Case size',                         'number',  null, null, null,       '{supplier_sheet,person}',                    'person',    'values'),
  ('core', 'order_limit',     'selling',  'Limit per order',                   'number',  null, null, null,       '{person}',                                   'person',    'values'),
  ('core', 'picture_front',   'pictures', 'Front pack shot',                   'evidence', null, null, null,      '{open_food_facts,brand_site,own_photo,supplier}', 'automatic', 'images'),
  ('core', 'picture_back',    'pictures', 'Back of pack where it carries facts or warnings', 'evidence', null, null, null, '{own_photo,supplier}', 'automatic', 'images'),
  ('core', 'category',        'category', 'Category',                          'text',    null, null, 'sellable', '{rules,model,person}',                       'automatic', 'products'),
  ('core', 'sub_category',    'category', 'Sub-category',                      'text',    null, null, null,       '{rules,model,person}',                       'automatic', 'products'),
  ('core', 'kind',            'category', 'Product kind ("protein bar", "dish soap")', 'text', null, null, null,   '{rules,model}',                              'automatic', 'values'),
  ('core', 'audience',        'audience', 'Audience (kids, toddlers, lunchbox ...)', 'list', null, null, null,    '{model,rules}',                              'automatic', 'tags'),
  ('core', 'occasion',        'audience', 'Occasion (breakfast, party, Ramadan ...)', 'list', null, null, null,   '{model,rules}',                              'automatic', 'tags'),
  ('core', 'storage_zone',    'storage',  'Storage zone',                      'enum',    null, '{ambient,chilled,frozen,fresh}', 'sellable', '{rules,label_photo,person}', 'automatic', 'products'),
  ('core', 'temperature',     'storage',  'Temperature',                       'text',    'C',  null, null,       '{rules,label_photo}',                        'automatic', 'values'),
  ('core', 'fragile',         'storage',  'Fragile',                           'boolean', null, null, null,       '{rules,person}',                             'automatic', 'values'),
  ('core', 'heavy',           'storage',  'Heavy',                             'boolean', null, null, null,       '{rules,person}',                             'automatic', 'values'),
  ('core', 'chilled_bag',     'storage',  'Goes in the chilled bag',           'boolean', null, null, null,       '{rules}',                                    'automatic', 'values'),
  ('core', 'packed_apart',    'storage',  'Packed apart from food',            'boolean', null, null, null,       '{rules}',                                    'automatic', 'values'),
  ('core', 'supplier',        'supply',   'Supplier',                          'text',    null, null, null,       '{supplier_sheet,person}',                    'person',    'values'),
  ('core', 'supplier_code',   'supply',   'Supplier code',                     'text',    null, null, null,       '{supplier_sheet,person}',                    'person',    'values'),
  ('core', 'lead_time_days',  'supply',   'Lead time',                         'number',  'days', null, null,     '{supplier_sheet,person}',                    'person',    'values'),
  ('core', 'case_pack',       'supply',   'Case pack',                         'number',  null, null, null,       '{supplier_sheet,person}',                    'person',    'values'),
  ('core', 'reorder_point',   'supply',   'Reorder point',                     'number',  null, null, null,       '{person}',                                   'person',    'values'),
  ('core', 'origin',          'supply',   'Origin (country as printed)',       'text',    null, null, null,       '{label_photo,supplier_sheet,brand_site}',    'person',    'values'),
  ('core', 'search_words',    'search',   'Search words in four languages',    'list',    null, null, null,       '{model,rules}',                              'automatic', 'search');

-- Packaged food and drinks; baby food and the bakery share the food fields below.
insert into template_fields(template_code, key, field_group, label_en, type, unit, allowed, required_for, allowed_sources, approval, store)
select t, k, g, l, ty, u, a::text[], r, s::text[], ap, st from (values
  ('ingredients',     'food', 'Ingredients as printed',               'facts',    null, null, 'fact_complete', '{label_photo,barcode_lookup,brand_site,retailer_page}', 'automatic', 'facts'),
  ('allergens',       'food', 'The 14 allergen groups (contains, may contain, free)', 'facts', null, null, 'fact_complete', '{label_photo,supplier_sheet}', 'person', 'facts'),
  ('nutrition',       'food', 'Nutrition per 100 g or 100 ml (numbers)', 'facts', null, null, 'fact_complete', '{label_photo,barcode_lookup,brand_site,retailer_page}', 'automatic', 'facts'),
  ('serving_size',    'food', 'Serving size',                         'number',   'g',  null, null,            '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('printed_claims',  'food', 'Printed claims ("no added sugar", "high protein")', 'list', null, null, null,  '{label_photo,brand_site}',     'automatic', 'claims'),
  ('caffeine_mg',     'food', 'Caffeine per 100 ml (drinks)',         'number',   'mg', null, null,            '{label_photo,brand_site}',     'automatic', 'values'),
  ('certifications',  'food', 'Certifications with evidence',         'evidence', null, null, null,            '{certificate,label_photo}',    'person',    'certificates')
) v(k, g, l, ty, u, a, r, s, ap, st)
cross join (values ('packaged_food'), ('baby_food')) x(t);

insert into template_fields(template_code, key, field_group, label_en, type, unit, allowed, required_for, allowed_sources, approval, store) values
  ('baby_food',          'age_range',          'baby',     'Age range as printed',              'range',  'months', null, 'fact_complete', '{label_photo}', 'automatic', 'values'),
  ('fresh_produce',      'variety',            'produce',  'Variety',                           'text',   null, null, null,            '{supplier_sheet,person}', 'automatic', 'values'),
  ('fresh_produce',      'origin',             'produce',  'Origin',                            'text',   null, null, 'fact_complete', '{supplier_sheet,person}', 'automatic', 'values'),
  ('fresh_produce',      'sale_unit',          'produce',  'Sold by kg or fixed pack',          'enum',   null, '{kg,pack,bunch,piece}', 'fact_complete', '{rules,supplier_sheet}', 'automatic', 'values'),
  ('fresh_produce',      'average_weight_g',   'produce',  'Average weight of a pack',          'number', 'g',  null, null,            '{supplier_sheet,person}', 'automatic', 'values'),
  ('fresh_produce',      'season',             'produce',  'Season',                            'list',   null, null, null,            '{rules,model}', 'automatic', 'values'),
  ('meat_poultry',       'animal',             'meat',     'Animal',                            'enum',   null, '{beef,lamb,chicken,turkey,veal,goat,fish,other}', null, '{supplier_sheet,label_photo}', 'automatic', 'values'),
  ('meat_poultry',       'cut',                'meat',     'Cut',                               'text',   null, null, 'fact_complete', '{supplier_sheet,label_photo}', 'automatic', 'values'),
  ('meat_poultry',       'fresh_or_frozen',    'meat',     'Fresh or frozen',                   'enum',   null, '{fresh,frozen}', null, '{supplier_sheet,label_photo,rules}', 'automatic', 'values'),
  ('meat_poultry',       'weight_per_pack_g',  'meat',     'Weight per pack',                   'number', 'g',  null, 'fact_complete', '{supplier_sheet,label_photo}', 'automatic', 'values'),
  ('meat_poultry',       'use_by_days',        'meat',     'Use by (days)',                     'number', 'days', null, null,          '{supplier_sheet}', 'automatic', 'values'),
  ('meat_poultry',       'halal_certificate',  'meat',     'Halal certificate of the supplier', 'evidence', null, null, null,          '{certificate}', 'person', 'certificates'),
  ('meat_poultry',       'ingredients',        'food',     'Ingredients as printed (packed meat)', 'facts', null, null, null,          '{label_photo,barcode_lookup}', 'automatic', 'facts'),
  ('meat_poultry',       'allergens',          'food',     'Allergens (packed meat)',           'facts',  null, null, null,            '{label_photo,supplier_sheet}', 'person', 'facts'),
  ('bakery',             'baked_by',           'bakery',   'Baked by',                          'text',   null, null, null,            '{supplier_sheet,label_photo}', 'automatic', 'values'),
  ('bakery',             'baked_daily',        'bakery',   'Baked daily or packaged',           'enum',   null, '{daily,packaged}', null, '{supplier_sheet}', 'automatic', 'values'),
  ('bakery',             'ingredients',        'food',     'Ingredients as declared by the bakery', 'facts', null, null, null,         '{supplier_sheet,label_photo}', 'person', 'facts'),
  ('bakery',             'allergens',          'food',     'Allergens as declared by the bakery', 'facts', null, null, 'fact_complete', '{supplier_sheet,label_photo}', 'person', 'facts'),
  ('bakery',             'best_before_days',   'bakery',   'Best before (days)',                'number', 'days', null, null,          '{supplier_sheet,label_photo}', 'automatic', 'values'),
  ('water',              'volume_ml',          'water',    'Volume',                            'number', 'ml', null, 'fact_complete', '{label_photo,barcode_lookup,rules}', 'automatic', 'values'),
  ('water',              'water_type',         'water',    'Type (mineral, drinking, sparkling)', 'enum', null, '{mineral,drinking,sparkling}', 'fact_complete', '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('water',              'gallon_exchange',    'water',    'Gallon exchange',                   'boolean', null, null, null,           '{rules,person}', 'automatic', 'values'),
  ('water',              'deposit_usd',        'water',    'Deposit',                           'number', 'USD', null, null,           '{person}', 'person', 'values'),
  ('cleaning_household', 'use_surface',        'cleaning', 'Use and surface',                   'text',   null, null, null,            '{label_photo,brand_site}', 'automatic', 'values'),
  ('cleaning_household', 'active_ingredient',  'cleaning', 'Active ingredient as printed',      'text',   null, null, null,            '{label_photo}', 'automatic', 'values'),
  ('cleaning_household', 'hazard_warnings',    'cleaning', 'Hazard warnings as printed ("none printed" is a value)', 'list', null, null, 'fact_complete', '{label_photo}', 'person', 'values'),
  ('cleaning_household', 'pictograms',         'cleaning', 'Hazard pictograms as printed',      'list',   null, '{corrosive,flammable,irritant,toxic,environment,oxidising,gas_under_pressure,health_hazard,explosive}', null, '{label_photo}', 'person', 'values'),
  ('cleaning_household', 'keep_from_children', 'cleaning', '"Keep away from children" printed', 'boolean', null, null, null,           '{label_photo}', 'person', 'values'),
  ('cleaning_household', 'scent',              'cleaning', 'Scent',                             'text',   null, null, null,            '{label_photo,brand_site}', 'automatic', 'values'),
  ('cleaning_household', 'dilution',           'cleaning', 'Dilution',                          'text',   null, null, null,            '{label_photo}', 'automatic', 'values'),
  ('cleaning_household', 'count',              'cleaning', 'Count (rolls, sheets, pieces)',     'number', null, null, null,            '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('beauty_personal_care','inci_ingredients',  'beauty',   'Ingredients as printed (INCI list)', 'text',  null, null, 'fact_complete', '{label_photo,brand_site}', 'automatic', 'values'),
  ('beauty_personal_care','hair_skin_type',    'beauty',   'Hair or skin type',                 'text',   null, null, null,            '{label_photo,brand_site}', 'automatic', 'values'),
  ('beauty_personal_care','printed_claims',    'beauty',   'Printed claims (fragrance-free, paraben-free, SPF)', 'list', null, null, null, '{label_photo,brand_site}', 'automatic', 'claims'),
  ('beauty_personal_care','age_group',         'beauty',   'Age (adult or kids)',               'enum',   null, '{adult,kids,baby,all}', 'fact_complete', '{label_photo,brand_site}', 'automatic', 'values'),
  ('beauty_personal_care','period_after_opening','beauty', 'Period after opening',              'number', 'months', null, null,        '{label_photo}', 'automatic', 'values'),
  ('baby_child',         'age_range',          'baby',     'Age range as printed',              'range',  'months', null, 'fact_complete', '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('baby_child',         'size_weight_range',  'baby',     'Nappy size and weight range',       'text',   null, null, null,            '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('baby_child',         'count',              'baby',     'Count',                             'number', null, null, null,            '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('baby_child',         'printed_claims',     'baby',     'Printed claims (fragrance-free ...)', 'list', null, null, null,            '{label_photo,brand_site}', 'automatic', 'claims'),
  ('pet',                'species',            'pet',      'Species',                           'enum',   null, '{cat,dog,bird,fish,small_animal}', 'fact_complete', '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('pet',                'life_stage',         'pet',      'Life stage',                        'enum',   null, '{baby,young,adult,senior,all,not_food}', 'fact_complete', '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('pet',                'pet_weight_range',   'pet',      'Pet weight range',                  'text',   null, null, null,            '{label_photo}', 'automatic', 'values'),
  ('pet',                'pet_ingredients',    'pet',      'Ingredients as printed',            'text',   null, null, null,            '{label_photo}', 'automatic', 'values'),
  ('pet',                'analytical_constituents', 'pet', 'Analytical constituents (protein %, fat %) as printed', 'text', null, null, null, '{label_photo}', 'automatic', 'values'),
  ('pet',                'pack_weight_g',      'pet',      'Pack weight',                       'number', 'g',  null, null,            '{label_photo,barcode_lookup}', 'automatic', 'values'),
  ('gas',                'cylinder_size',      'gas',      'Cylinder size',                     'number', 'kg', null, 'fact_complete', '{person}', 'person', 'values'),
  ('gas',                'exchange_or_new',    'gas',      'Exchange or new',                   'enum',   null, '{exchange,new}', 'fact_complete', '{person}', 'person', 'values'),
  ('gas',                'rider_safety_rules', 'gas',      'Safety rules for the rider',        'text',   null, null, null,            '{person}', 'person', 'values'),
  -- A vendor dish: its own fields (docs/PRODUCT_DATA_STANDARD.md, "The standard for vendor menu items"). Food facts are the vendor's
  -- declarations with their date (dish_declarations, 0204), never product_facts.
  ('vendor_dish',        'name_en',            'identity', 'Dish name',                         'text',   null, null, 'sellable',      '{menu,vendor}', 'person', 'products'),
  ('vendor_dish',        'name_ar',            'identity', 'Dish name in Arabic',               'text',   null, null, null,            '{menu,vendor}', 'person', 'products'),
  ('vendor_dish',        'section',            'identity', 'Menu section',                      'text',   null, null, null,            '{menu,vendor}', 'person', 'products'),
  ('vendor_dish',        'description',        'identity', 'What is in it (never praise)',      'text',   null, null, null,            '{menu,vendor}', 'person', 'values'),
  ('vendor_dish',        'price_usd',          'selling',  'Base price',                        'number', 'USD', null, 'sellable',     '{menu,vendor}', 'person', 'offers'),
  ('vendor_dish',        'sell_unit',          'selling',  'Sell unit',                         'text',   null, null, 'sellable',      '{menu,vendor,rules}', 'automatic', 'products'),
  ('vendor_dish',        'option_groups',      'selling',  'Option groups',                     'list',   null, null, null,            '{menu,vendor}', 'person', 'values'),
  ('vendor_dish',        'picture',            'pictures', 'A real photo of the dish, or none', 'evidence', null, null, null,          '{vendor,own_photo}', 'person', 'images'),
  ('vendor_dish',        'serves',             'portion',  'Serves how many',                   'number', null, null, null,            '{vendor}', 'person', 'values'),
  ('vendor_dish',        'declared_facts',     'food',     'Declared food facts (vendor, dated)', 'facts', null, null, 'fact_complete', '{vendor}', 'person', 'facts'),
  ('vendor_dish',        'audience',           'audience', 'Audience and occasion',             'list',   null, null, null,            '{model,rules}', 'automatic', 'tags'),
  ('vendor_dish',        'search_words',       'search',   'Search words',                      'list',   null, null, null,            '{model,rules}', 'automatic', 'search');

create table category_templates (
  category      text not null,                   -- products.category, as the catalogue writes it
  sub_type      text not null default '',        -- '' = every sub-type of the category
  template_code text not null references product_templates(code),
  primary key (category, sub_type)
);
insert into category_templates(category, template_code) values
  ('Beverages', 'packaged_food'), ('Canned Food, Jars & Packets', 'packaged_food'), ('Cooking Ingredients', 'packaged_food'),
  ('Dairy & Eggs', 'packaged_food'), ('Deli Cold Cuts', 'packaged_food'), ('Dry Foods & Pantry', 'packaged_food'), ('Frozen Food', 'packaged_food'),
  ('Healthy', 'packaged_food'), ('Home Bake', 'packaged_food'), ('Hot Beverages', 'packaged_food'), ('Milk & Cereals', 'packaged_food'),
  ('Ready to Eat & Catering', 'packaged_food'), ('Snacks & Candy', 'packaged_food'),
  ('Fruits & Vegetables', 'fresh_produce'), ('Meat & Poultry', 'meat_poultry'), ('Bakery', 'bakery'), ('Water', 'water'),
  ('Cleaning & Household', 'cleaning_household'), ('Beauty & Personal Care', 'beauty_personal_care'),
  ('Baby & Child', 'baby_child'), ('Pet Zone', 'pet'), ('Restaurant', 'vendor_dish');
insert into category_templates(category, sub_type, template_code) values ('Baby & Child', 'baby food', 'baby_food');

-- The template an item follows: a dish a restaurant owns is a vendor dish; otherwise its category (and sub-type, when mapped).
create or replace function product_template(p_product uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select case when p.owner_source_id is not null then 'vendor_dish' else
           coalesce((select ct.template_code from category_templates ct where ct.category = p.category and ct.sub_type = lower(coalesce(p.sub_type, ''))),
                    (select ct.template_code from category_templates ct where ct.category = p.category and ct.sub_type = '')) end
    from products p where p.id = p_product $$;
create or replace function template_for(p_category text, p_sub_type text, p_owner uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select case when p_owner is not null then 'vendor_dish' else
           coalesce((select ct.template_code from category_templates ct where ct.category = p_category and ct.sub_type = lower(coalesce(p_sub_type, ''))),
                    (select ct.template_code from category_templates ct where ct.category = p_category and ct.sub_type = '')) end $$;

-- Rule 2: an active item needs its template; a new one needs a name, a sale unit and a storage zone too.
create or replace function product_needs_template() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_t text;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.category is not distinct from new.category and old.sub_type is not distinct from new.sub_type
     and old.owner_source_id is not distinct from new.owner_source_id then return new; end if;
  v_t := template_for(new.category, new.sub_type, new.owner_source_id);
  if v_t is null then
    raise exception 'TEMPLATE_MISSING: category "%" has no template; add one to category_templates before an item in it goes live', new.category;
  end if;
  if (select future from product_templates where code = v_t) then
    raise exception 'TEMPLATE_FUTURE: template % has no items yet; a person switches it on first', v_t;
  end if;
  if tg_op = 'INSERT' or not old.is_active then
    if coalesce(btrim(new.name_en), '') = '' and coalesce(btrim(new.name_ar), '') = '' then raise exception 'CORE_MISSING: a name'; end if;
    if coalesce(btrim(new.sell_unit), '') = '' then raise exception 'CORE_MISSING: a sale unit'; end if;
  end if;
  return new;
end $$;
create trigger products_need_template before insert or update on products for each row execute function product_needs_template();

-- Rule 1: food facts only on food templates.
create or replace function food_facts_only_on_food() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_t text;
begin
  if tg_op = 'UPDATE' and not (old.approved_at is null and new.approved_at is not null) then return new; end if;
  v_t := product_template(new.product_id);
  if v_t is not null and not (select is_food from product_templates where code = v_t) then
    raise exception 'NOT_FOOD: % is not a food item (template %); food facts do not apply', new.product_id, v_t;
  end if;
  return new;
end $$;
create trigger product_facts_food_only before insert or update on product_facts for each row execute function food_facts_only_on_food();

-- Values of template fields that are not food facts, with their source and approval. Facts expire after 12 months without a re-check.
create table product_field_values (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  field_key     text not null,
  value         jsonb not null,
  source        text not null check (source in ('label_photo', 'barcode_lookup', 'open_food_facts', 'brand_site', 'retailer_page', 'supplier_sheet',
                                                'certificate', 'rules', 'model', 'person', 'vendor', 'menu', 'research_file')),
  evidence_id   uuid references evidence_documents(id),
  detail        jsonb not null default '{}',
  status        text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  proposed_by   uuid references parties(id),
  proposed_at   timestamptz not null default now(),
  approved_by   uuid references parties(id),
  approved_at   timestamptz,
  reviewed_at   timestamptz,
  expires_at    timestamptz,
  check ((status = 'approved') = (approved_at is not null) or status = 'superseded')
);
create unique index product_field_values_current on product_field_values(product_id, field_key) where status = 'approved';
create index product_field_values_product on product_field_values(product_id, field_key);

-- A value belongs to a field of the item's own template (or the core, for a grocery template), and an enum takes only its values.
create or replace function field_value_fits() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_t text; f template_fields%rowtype;
begin
  v_t := product_template(new.product_id);
  if v_t is null then raise exception 'TEMPLATE_MISSING for %', new.product_id; end if;
  select tf.* into f from template_fields tf
   where tf.key = new.field_key and (tf.template_code = v_t or (tf.template_code = 'core' and (select includes_core from product_templates where code = v_t)))
   order by (tf.template_code = v_t) desc limit 1;
  if not found then raise exception 'FIELD_NOT_IN_TEMPLATE: % is not a field of template %', new.field_key, v_t; end if;
  if f.store <> 'values' then raise exception 'FIELD_STORED_ELSEWHERE: % is kept in %', new.field_key, f.store; end if;
  if f.type = 'enum' and f.allowed is not null and not (new.value #>> '{}' = any(f.allowed)) then
    raise exception 'FIELD_VALUE: % takes one of %, not %', new.field_key, f.allowed, new.value #>> '{}';
  end if;
  if new.status = 'approved' and new.expires_at is null then new.expires_at := coalesce(new.approved_at, now()) + interval '12 months'; end if;
  return new;
end $$;
create trigger product_field_values_fit before insert or update on product_field_values for each row execute function field_value_fits();

do $$ declare t text; r text;
begin
  foreach t in array array['product_templates', 'template_fields', 'category_templates', 'product_field_values'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
