-- Alo King Chouf: build plan 1.21, the WhatsApp catalog (session K1).
--
-- Customer-facing categories, approved 14 Nov (data/proposals/categories.json, list_approval). Each item's placement was checked
-- by K1 against the catalog's own category and storage zone; seven moved from the proposal (recorded in docs/HANDOFF.md, K1):
--   AK-0064 Puck cooking cream, AK-0066 President whipping cream   cooking_baking   -> dairy_eggs        (chilled cream, with the dairy)
--   AK-0100 Chef Simsum garlic paste                                cooking_baking   -> deli_ready_meals  (chilled, beside Mamig's garlic)
--   AK-0132 Coffee Mate creamer                                     breakfast_cereal -> water_drinks      (with the coffee)
--   AK-0168 El Rashidi strawberry jam                               pantry_staples   -> breakfast_cereal  (with the other breakfast spreads)
--   AK-0214, AK-0215 Dolly's ketchup                                canned_jarred    -> cooking_baking    (with the mayonnaise and hot sauce)
-- Water, drinks and hot beverages holds 42 items, more than one WhatsApp product list (30), so it has three named sub-groups.
-- Placements are keyed by SKU, so they load before or after the catalog seeds (as the language pack, 0054). Categories are data.
--
-- The catalog is a way to browse and choose, never to confirm (1.21): the feed only shows; a cart goes through plan_cart() and
-- quote_order() like a typed order, and the customer still taps Confirm on the card. Invariant 2: no message type is added;
-- catalog, product and product-list messages are `interactive`.

create table if not exists catalog_categories (
  code       text primary key,
  name_en    text not null,
  name_ar    text not null,
  sort_order int  not null,
  is_active  boolean not null default true
);
create table if not exists catalog_subgroups (
  category_code text not null references catalog_categories(code),
  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  sort_order    int  not null,
  primary key (category_code, code)
);
create table if not exists catalog_placements (
  sku              text primary key,
  category_code    text not null references catalog_categories(code),
  subgroup_code    text,
  sort_in_category int  not null,
  foreign key (category_code, subgroup_code) references catalog_subgroups(category_code, code)
);

-- catalog_id: Meta's catalog id, filled once the catalog exists in Commerce Manager (RUNBOOK 1.21). Not a secret.
-- product_link: the feed's `link` for each item, `{sku}` replaced. Meta's feed asks for a link per product; we have no
--   website, so it is the customer number's wa.me link, set by a person (RUNBOOK). Until it is set the feed answers 503.
-- image_link_seconds: how long a picture's signed link in the feed lives. Meta re-reads the feed at most hourly and fetches the
--   pictures after it, so a week; the links are only in the feed, which is behind a password.
insert into settings(key, value) values ('catalog', '{"catalog_id": null, "product_link": null, "image_link_seconds": 604800,
  "currency": "USD", "list_max_products": 30, "list_max_sections": 10}') on conflict (key) do nothing;

-- One row per product Meta may show: active, placed, sold at the hub, and with an approved picture a customer may see (5.17).
-- No picture, no row (1.21 step 2). Availability is the hub's free stock now; the database still refuses a sold-out item at once.
create or replace function catalog_feed() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
           'brand', coalesce(nullif(p.brand, ''), 'Alo King'),
           'price_usd', o.price_usd, 'in_stock', coalesce(l.on_hand - l.reserved, 0) > 0,
           'media_path', i.media_path, 'attribution', i.attribution, 'licence', i.licence,
           'category_code', c.code, 'category_en', c.name_en, 'category_ar', c.name_ar,
           'subgroup_en', sg.name_en, 'subgroup_ar', sg.name_ar)
         order by c.sort_order, pl.sort_in_category), '[]'::jsonb)
    from catalog_placements pl
    join catalog_categories c on c.code = pl.category_code and c.is_active
    left join catalog_subgroups sg on sg.category_code = pl.category_code and sg.code = pl.subgroup_code
    join products p on p.sku = pl.sku and p.is_active
    join lateral (select ofr.price_usd, ofr.source_id from offers ofr join sources s on s.id = ofr.source_id
                   where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
    join product_images i on i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence) $$;

-- What the feed holds and what it leaves out, for the RUNBOOK check and the console.
create or replace function catalog_feed_report() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'active_products', (select count(*) from products where is_active),
    'placed', (select count(*) from catalog_placements pl join products p on p.sku = pl.sku and p.is_active),
    'not_placed', (select coalesce(jsonb_agg(p.sku order by p.sku), '[]'::jsonb) from products p
                    where p.is_active and p.owner_source_id is null and not exists (select 1 from catalog_placements pl where pl.sku = p.sku)),
    'in_feed', jsonb_array_length(catalog_feed()),
    'without_picture', (select count(*) from catalog_placements pl join products p on p.sku = pl.sku and p.is_active
                         where not exists (select 1 from product_images i where i.product_id = p.id and i.status = 'approved'
                                                                              and product_image_licence_usable(i.licence)))) $$;

-- The category a customer or the Concierge named: its code, or its English or Arabic name, folded.
create or replace function catalog_category_find(p_text text) returns jsonb language sql stable as $$
  select to_jsonb(c) from catalog_categories c
   where c.is_active and (lower(c.code) = lower(btrim(p_text)) or lower(c.name_en) = lower(btrim(p_text)) or c.name_ar = btrim(p_text)
         or lower(c.name_en) like '%' || lower(btrim(p_text)) || '%' or c.name_ar like '%' || btrim(p_text) || '%')
   order by (lower(c.code) = lower(btrim(p_text))) desc, c.sort_order limit 1 $$;

-- The products of one category that are in the catalog, in sections (a sub-group each, or one section), in display order.
create or replace function catalog_list(p_category text) returns jsonb language plpgsql stable as $$
declare c jsonb := catalog_category_find(p_category);
begin
  if c is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_category',
      'categories', (select jsonb_agg(jsonb_build_object('code', code, 'name_en', name_en, 'name_ar', name_ar) order by sort_order) from catalog_categories where is_active));
  end if;
  return jsonb_build_object('ok', true, 'category', c, 'sections', coalesce((
    select jsonb_agg(jsonb_build_object('title_en', coalesce(s.subgroup_en, c->>'name_en'), 'title_ar', coalesce(s.subgroup_ar, c->>'name_ar'), 'skus', s.skus) order by s.ord)
      from (select f->>'subgroup_en' as subgroup_en, f->>'subgroup_ar' as subgroup_ar, min(n) as ord, jsonb_agg(f->>'sku' order by n) as skus
              from jsonb_array_elements(catalog_feed()) with ordinality as x(f, n)
             where f->>'category_code' = c->>'code'
             group by 1, 2) s), '[]'::jsonb));
end $$;

-- A cart sent from the catalog (1.21 step 5), turned into the same quote lines a typed order produces and priced by quote_order.
-- p_items: [{sku, qty, price, currency}] as WhatsApp sent them. The cart's prices are what Meta showed; the database's are what
-- counts. An unknown or inactive item, or one out of stock, is left out and named; a price that moved is named. The village and
-- place are the customer's usual ones, as plan_order picks them. Nothing here creates an order.
create or replace function plan_cart(p_party uuid, p_items jsonb, p_village uuid default null, p_catalog text default null)
returns jsonb language plpgsql stable as $$
declare it jsonb; v_lines jsonb := '[]'::jsonb; v_quote_lines jsonb := '[]'::jsonb; v_removed jsonb := '[]'::jsonb; v_changed jsonb := '[]'::jsonb;
        p record; v_qty int; v_quote jsonb; q jsonb; v_village uuid := p_village; v_place uuid; v_ours text := setting('catalog')->>'catalog_id';
        v_pay text := case when customer_requires_prepay(p_party) then 'whish' else 'cod' end; v_out text[] := '{}';
begin
  -- A cart from another catalog is not ours to read.
  if p_catalog is not null and v_ours is not null and p_catalog <> v_ours then
    return jsonb_build_object('ok', false, 'error', 'wrong_catalog');
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := least(greatest(coalesce((it->>'qty')::numeric, 1)::int, 1), 99);
    select pr.id, pr.sku, pr.name_en, pr.name_ar into p from products pr where pr.sku = it->>'sku' and pr.is_active;
    if not found then
      v_removed := v_removed || jsonb_build_object('sku', it->>'sku', 'reason', 'unknown');
      continue;
    end if;
    -- Two lines of the same product in one cart are one line.
    if v_quote_lines @> jsonb_build_array(jsonb_build_object('product_id', p.id)) then
      select coalesce(jsonb_agg(case when x->>'product_id' = p.id::text then x || jsonb_build_object('qty', (x->>'qty')::int + v_qty) else x end), '[]'::jsonb)
        into v_quote_lines from jsonb_array_elements(v_quote_lines) x;
    else
      v_quote_lines := v_quote_lines || jsonb_build_object('product_id', p.id, 'qty', v_qty);
    end if;
    v_lines := v_lines || jsonb_build_object('sku', p.sku, 'product_id', p.id, 'name', p.name_en, 'name_ar', p.name_ar, 'qty', v_qty,
                                             'cart_price', it->'price', 'currency', it->>'currency');
  end loop;

  if v_village is null then
    select id, village_id into v_place, v_village from customer_places where party_id = p_party and village_id is not null
      order by last_used_at desc nulls last limit 1;      -- "the usual place", as plan_order
  else
    select id into v_place from customer_places where party_id = p_party and village_id = v_village order by last_used_at desc nulls last limit 1;
  end if;

  -- Out of stock: named and left out before the card (1.21 test). The rest is priced again without it.
  if jsonb_array_length(v_quote_lines) > 0 then
    v_quote := quote_order(v_quote_lines, v_village, false);
    for q in select * from jsonb_array_elements(v_quote->'lines') loop
      if not (q->>'ok')::boolean then v_out := v_out || (q->>'product_id'); end if;
    end loop;
    if array_length(v_out, 1) > 0 then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_removed from (
        select x from jsonb_array_elements(v_removed) x
        union all
        select jsonb_build_object('sku', l->>'sku', 'name', l->>'name', 'name_ar', l->>'name_ar', 'reason', 'out_of_stock')
          from jsonb_array_elements(v_lines) l where l->>'product_id' = any(v_out)) y;
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_quote_lines from jsonb_array_elements(v_quote_lines) x where not (x->>'product_id' = any(v_out));
      v_quote := case when jsonb_array_length(v_quote_lines) > 0 then quote_order(v_quote_lines, v_village, false) end;
    end if;
  end if;

  -- A price Meta showed that is no longer the database's: named on the way to the card. The card shows the database price.
  if v_quote is not null then
    select coalesce(jsonb_agg(jsonb_build_object('sku', ql->>'sku', 'name', ql->>'name', 'name_ar', ql->>'name_ar',
                                                 'cart_price', (l->>'cart_price')::numeric, 'price_usd', (ql->>'unit_price_usd')::numeric)), '[]'::jsonb)
      into v_changed
      from jsonb_array_elements(v_quote->'lines') ql join jsonb_array_elements(v_lines) l on l->>'product_id' = ql->>'product_id'
     where coalesce(l->>'currency', 'USD') = coalesce(setting('catalog')->>'currency', 'USD')
       and jsonb_typeof(l->'cart_price') = 'number' and abs((l->>'cart_price')::numeric - (ql->>'unit_price_usd')::numeric) >= 0.005;
  end if;

  return jsonb_build_object('ok', true, 'lines', v_lines, 'quote_lines', v_quote_lines, 'quote', v_quote,
    'issues', coalesce(v_quote->'issues', '[]'::jsonb), 'removed', v_removed, 'price_changed', v_changed,
    'village_id', v_village, 'place_id', v_place, 'pickup', false, 'payment_method', v_pay);
end $$;

insert into catalog_categories(code, name_en, name_ar, sort_order) values
('fruits_vegetables','Fruits & Vegetables','فواكه وخضروات',1),
('meat_poultry','Meat & Poultry','لحوم ودواجن',2),
('deli_ready_meals','Deli & Ready Meals','لحوم باردة ووجبات جاهزة',3),
('dairy_eggs','Dairy & Eggs','ألبان وبيض',4),
('frozen_food','Frozen Food','مجمدات',5),
('bakery','Bakery & Bread','مخبوزات وخبز',6),
('water_drinks','Water, Drinks & Hot Beverages','مياه ومشروبات، قهوة وشاي',7),
('breakfast_cereal','Breakfast & Milk Powder','فطور وحليب مجفف',8),
('snacks_sweets','Snacks & Sweets','سناكس وحلويات',9),
('pantry_staples','Pantry Staples','مواد تموين أساسية',10),
('canned_jarred','Canned & Jarred Food','معلبات ومرطبانات',11),
('cooking_baking','Cooking & Baking','مستلزمات الطبخ والحلويات',12),
('cleaning_household','Cleaning & Household','تنظيف ومنزل',13),
('personal_care','Personal Care','العناية الشخصية',14),
('baby_pet','Baby & Pet','أطفال وحيوانات أليفة',15)
on conflict (code) do nothing;
insert into catalog_subgroups(category_code, code, name_en, name_ar, sort_order) values
('water_drinks','water','Water','مياه',1),
('water_drinks','soft_drinks_juice','Soft Drinks & Juice','مشروبات غازية وعصير',2),
('water_drinks','coffee_tea','Coffee & Tea','قهوة وشاي',3)
on conflict (category_code, code) do nothing;
insert into catalog_placements(sku, category_code, subgroup_code, sort_in_category) values
('AK-0001','fruits_vegetables',null,21),
('AK-0002','fruits_vegetables',null,24),
('AK-0003','fruits_vegetables',null,8),
('AK-0004','fruits_vegetables',null,16),
('AK-0005','fruits_vegetables',null,13),
('AK-0006','fruits_vegetables',null,18),
('AK-0007','fruits_vegetables',null,25),
('AK-0008','fruits_vegetables',null,4),
('AK-0009','fruits_vegetables',null,2),
('AK-0010','fruits_vegetables',null,20),
('AK-0011','fruits_vegetables',null,11),
('AK-0012','fruits_vegetables',null,14),
('AK-0013','fruits_vegetables',null,12),
('AK-0014','fruits_vegetables',null,9),
('AK-0015','fruits_vegetables',null,7),
('AK-0016','fruits_vegetables',null,5),
('AK-0017','fruits_vegetables',null,6),
('AK-0018','fruits_vegetables',null,3),
('AK-0019','fruits_vegetables',null,19),
('AK-0020','fruits_vegetables',null,1),
('AK-0021','fruits_vegetables',null,23),
('AK-0022','fruits_vegetables',null,17),
('AK-0023','fruits_vegetables',null,15),
('AK-0024','fruits_vegetables',null,22),
('AK-0025','fruits_vegetables',null,10),
('AK-0026','meat_poultry',null,6),
('AK-0027','meat_poultry',null,3),
('AK-0028','meat_poultry',null,5),
('AK-0029','meat_poultry',null,2),
('AK-0030','meat_poultry',null,7),
('AK-0031','meat_poultry',null,11),
('AK-0032','meat_poultry',null,8),
('AK-0033','meat_poultry',null,10),
('AK-0034','meat_poultry',null,9),
('AK-0035','meat_poultry',null,13),
('AK-0036','meat_poultry',null,12),
('AK-0037','meat_poultry',null,1),
('AK-0038','meat_poultry',null,4),
('AK-0039','dairy_eggs',null,1),
('AK-0040','dairy_eggs',null,8),
('AK-0041','dairy_eggs',null,3),
('AK-0042','dairy_eggs',null,16),
('AK-0043','dairy_eggs',null,14),
('AK-0044','dairy_eggs',null,9),
('AK-0045','dairy_eggs',null,17),
('AK-0046','dairy_eggs',null,20),
('AK-0047','dairy_eggs',null,10),
('AK-0048','dairy_eggs',null,23),
('AK-0049','dairy_eggs',null,12),
('AK-0050','dairy_eggs',null,19),
('AK-0051','dairy_eggs',null,21),
('AK-0052','dairy_eggs',null,6),
('AK-0053','dairy_eggs',null,25),
('AK-0054','dairy_eggs',null,26),
('AK-0055','dairy_eggs',null,13),
('AK-0056','dairy_eggs',null,4),
('AK-0057','dairy_eggs',null,5),
('AK-0058','dairy_eggs',null,11),
('AK-0059','dairy_eggs',null,7),
('AK-0060','dairy_eggs',null,18),
('AK-0061','dairy_eggs',null,22),
('AK-0062','dairy_eggs',null,24),
('AK-0063','dairy_eggs',null,15),
('AK-0064','dairy_eggs',null,28),
('AK-0065','dairy_eggs',null,2),
('AK-0066','dairy_eggs',null,27),
('AK-0067','breakfast_cereal',null,5),
('AK-0068','breakfast_cereal',null,4),
('AK-0069','breakfast_cereal',null,2),
('AK-0070','breakfast_cereal',null,1),
('AK-0071','breakfast_cereal',null,3),
('AK-0072','breakfast_cereal',null,14),
('AK-0073','breakfast_cereal',null,10),
('AK-0074','breakfast_cereal',null,11),
('AK-0075','breakfast_cereal',null,9),
('AK-0076','breakfast_cereal',null,8),
('AK-0077','breakfast_cereal',null,15),
('AK-0078','breakfast_cereal',null,7),
('AK-0079','bakery',null,7),
('AK-0080','bakery',null,2),
('AK-0081','bakery',null,11),
('AK-0082','bakery',null,12),
('AK-0083','bakery',null,1),
('AK-0084','bakery',null,10),
('AK-0085','bakery',null,6),
('AK-0086','bakery',null,4),
('AK-0087','bakery',null,3),
('AK-0088','bakery',null,8),
('AK-0089','bakery',null,9),
('AK-0090','bakery',null,5),
('AK-0091','deli_ready_meals',null,6),
('AK-0092','deli_ready_meals',null,3),
('AK-0093','deli_ready_meals',null,1),
('AK-0094','deli_ready_meals',null,11),
('AK-0095','deli_ready_meals',null,7),
('AK-0096','deli_ready_meals',null,8),
('AK-0097','deli_ready_meals',null,10),
('AK-0098','deli_ready_meals',null,9),
('AK-0099','deli_ready_meals',null,4),
('AK-0100','deli_ready_meals',null,2),
('AK-0101','deli_ready_meals',null,5),
('AK-0102','water_drinks','water',1),
('AK-0103','water_drinks','water',7),
('AK-0104','water_drinks','water',9),
('AK-0105','water_drinks','water',8),
('AK-0106','water_drinks','water',6),
('AK-0107','water_drinks','water',4),
('AK-0108','water_drinks','water',5),
('AK-0109','water_drinks','water',10),
('AK-0110','water_drinks','water',2),
('AK-0111','water_drinks','water',3),
('AK-0112','water_drinks','soft_drinks_juice',23),
('AK-0113','water_drinks','soft_drinks_juice',24),
('AK-0114','water_drinks','soft_drinks_juice',26),
('AK-0115','water_drinks','soft_drinks_juice',21),
('AK-0116','water_drinks','soft_drinks_juice',25),
('AK-0117','water_drinks','soft_drinks_juice',22),
('AK-0118','water_drinks','soft_drinks_juice',14),
('AK-0119','water_drinks','soft_drinks_juice',20),
('AK-0120','water_drinks','soft_drinks_juice',13),
('AK-0121','water_drinks','soft_drinks_juice',12),
('AK-0122','water_drinks','soft_drinks_juice',18),
('AK-0123','water_drinks','soft_drinks_juice',17),
('AK-0124','water_drinks','soft_drinks_juice',11),
('AK-0125','water_drinks','soft_drinks_juice',16),
('AK-0126','water_drinks','soft_drinks_juice',19),
('AK-0127','water_drinks','soft_drinks_juice',27),
('AK-0128','water_drinks','soft_drinks_juice',15),
('AK-0129','water_drinks','soft_drinks_juice',28),
('AK-0130','water_drinks','coffee_tea',29),
('AK-0131','water_drinks','coffee_tea',39),
('AK-0132','water_drinks','coffee_tea',30),
('AK-0133','water_drinks','coffee_tea',36),
('AK-0134','water_drinks','coffee_tea',42),
('AK-0135','water_drinks','coffee_tea',40),
('AK-0136','water_drinks','coffee_tea',41),
('AK-0137','water_drinks','coffee_tea',37),
('AK-0138','water_drinks','coffee_tea',35),
('AK-0139','water_drinks','coffee_tea',38),
('AK-0140','water_drinks','coffee_tea',33),
('AK-0141','water_drinks','coffee_tea',31),
('AK-0142','water_drinks','coffee_tea',32),
('AK-0143','water_drinks','coffee_tea',34),
('AK-0144','snacks_sweets',null,22),
('AK-0145','snacks_sweets',null,15),
('AK-0146','snacks_sweets',null,11),
('AK-0147','snacks_sweets',null,13),
('AK-0148','snacks_sweets',null,12),
('AK-0149','snacks_sweets',null,24),
('AK-0150','snacks_sweets',null,23),
('AK-0151','breakfast_cereal',null,13),
('AK-0152','snacks_sweets',null,25),
('AK-0153','snacks_sweets',null,19),
('AK-0154','snacks_sweets',null,20),
('AK-0155','snacks_sweets',null,26),
('AK-0156','pantry_staples',null,3),
('AK-0157','snacks_sweets',null,9),
('AK-0158','snacks_sweets',null,8),
('AK-0159','snacks_sweets',null,4),
('AK-0160','snacks_sweets',null,6),
('AK-0161','snacks_sweets',null,17),
('AK-0162','breakfast_cereal',null,12),
('AK-0163','snacks_sweets',null,16),
('AK-0164','snacks_sweets',null,5),
('AK-0165','snacks_sweets',null,7),
('AK-0166','snacks_sweets',null,14),
('AK-0167','snacks_sweets',null,3),
('AK-0168','breakfast_cereal',null,6),
('AK-0169','snacks_sweets',null,2),
('AK-0170','snacks_sweets',null,18),
('AK-0171','snacks_sweets',null,21),
('AK-0172','pantry_staples',null,15),
('AK-0173','pantry_staples',null,12),
('AK-0174','pantry_staples',null,13),
('AK-0175','pantry_staples',null,5),
('AK-0176','pantry_staples',null,14),
('AK-0177','pantry_staples',null,17),
('AK-0178','pantry_staples',null,16),
('AK-0179','pantry_staples',null,4),
('AK-0180','pantry_staples',null,9),
('AK-0181','pantry_staples',null,11),
('AK-0182','pantry_staples',null,10),
('AK-0183','pantry_staples',null,2),
('AK-0184','pantry_staples',null,1),
('AK-0185','pantry_staples',null,8),
('AK-0186','pantry_staples',null,7),
('AK-0187','cooking_baking',null,12),
('AK-0188','cooking_baking',null,16),
('AK-0189','pantry_staples',null,18),
('AK-0190','pantry_staples',null,6),
('AK-0191','canned_jarred',null,14),
('AK-0192','canned_jarred',null,5),
('AK-0193','canned_jarred',null,11),
('AK-0194','canned_jarred',null,9),
('AK-0195','canned_jarred',null,15),
('AK-0196','canned_jarred',null,12),
('AK-0197','canned_jarred',null,16),
('AK-0198','canned_jarred',null,7),
('AK-0199','canned_jarred',null,2),
('AK-0200','canned_jarred',null,4),
('AK-0201','canned_jarred',null,6),
('AK-0202','canned_jarred',null,1),
('AK-0203','canned_jarred',null,17),
('AK-0204','canned_jarred',null,8),
('AK-0205','canned_jarred',null,3),
('AK-0206','canned_jarred',null,10),
('AK-0207','cooking_baking',null,23),
('AK-0208','canned_jarred',null,18),
('AK-0209','cooking_baking',null,22),
('AK-0210','canned_jarred',null,19),
('AK-0211','cooking_baking',null,19),
('AK-0212','canned_jarred',null,13),
('AK-0213','cooking_baking',null,20),
('AK-0214','cooking_baking',null,9),
('AK-0215','cooking_baking',null,8),
('AK-0216','cooking_baking',null,17),
('AK-0217','cooking_baking',null,1),
('AK-0218','cooking_baking',null,21),
('AK-0219','cooking_baking',null,2),
('AK-0220','cooking_baking',null,5),
('AK-0221','cooking_baking',null,18),
('AK-0222','cooking_baking',null,15),
('AK-0223','cooking_baking',null,7),
('AK-0224','cooking_baking',null,13),
('AK-0225','cooking_baking',null,14),
('AK-0226','cooking_baking',null,11),
('AK-0227','cooking_baking',null,10),
('AK-0228','cooking_baking',null,6),
('AK-0229','cooking_baking',null,4),
('AK-0230','cooking_baking',null,3),
('AK-0231','frozen_food',null,8),
('AK-0232','frozen_food',null,2),
('AK-0233','frozen_food',null,9),
('AK-0234','frozen_food',null,1),
('AK-0235','frozen_food',null,10),
('AK-0236','frozen_food',null,16),
('AK-0237','frozen_food',null,12),
('AK-0238','frozen_food',null,6),
('AK-0239','frozen_food',null,7),
('AK-0240','frozen_food',null,13),
('AK-0241','frozen_food',null,11),
('AK-0242','frozen_food',null,15),
('AK-0243','frozen_food',null,14),
('AK-0244','frozen_food',null,3),
('AK-0245','frozen_food',null,5),
('AK-0246','frozen_food',null,4),
('AK-0247','snacks_sweets',null,10),
('AK-0248','snacks_sweets',null,1),
('AK-0249','cleaning_household',null,17),
('AK-0250','cleaning_household',null,14),
('AK-0251','cleaning_household',null,19),
('AK-0252','cleaning_household',null,20),
('AK-0253','cleaning_household',null,2),
('AK-0254','cleaning_household',null,1),
('AK-0255','cleaning_household',null,18),
('AK-0256','cleaning_household',null,10),
('AK-0257','cleaning_household',null,4),
('AK-0258','cleaning_household',null,9),
('AK-0259','cleaning_household',null,5),
('AK-0260','cleaning_household',null,7),
('AK-0261','cleaning_household',null,13),
('AK-0262','cleaning_household',null,6),
('AK-0263','cleaning_household',null,16),
('AK-0264','cleaning_household',null,11),
('AK-0265','cleaning_household',null,12),
('AK-0266','cleaning_household',null,3),
('AK-0267','cleaning_household',null,8),
('AK-0268','cleaning_household',null,15),
('AK-0269','personal_care',null,14),
('AK-0270','personal_care',null,10),
('AK-0271','personal_care',null,11),
('AK-0272','personal_care',null,12),
('AK-0273','personal_care',null,13),
('AK-0274','personal_care',null,7),
('AK-0275','personal_care',null,3),
('AK-0276','personal_care',null,4),
('AK-0277','personal_care',null,1),
('AK-0278','personal_care',null,5),
('AK-0279','personal_care',null,6),
('AK-0280','personal_care',null,2),
('AK-0281','personal_care',null,8),
('AK-0282','personal_care',null,9),
('AK-0283','baby_pet',null,1),
('AK-0284','baby_pet',null,8),
('AK-0285','baby_pet',null,2),
('AK-0286','baby_pet',null,7),
('AK-0287','baby_pet',null,3),
('AK-0288','baby_pet',null,6),
('AK-0289','baby_pet',null,5),
('AK-0290','baby_pet',null,4),
('AK-0291','baby_pet',null,9)
on conflict (sku) do nothing;

do $$ declare r text; t text;
begin
  foreach t in array array['catalog_categories', 'catalog_subgroups', 'catalog_placements'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
