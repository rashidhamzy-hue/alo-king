-- Alo King Chouf, session WEB4a stage 2 (aisles, an aisle, the product page, search): what a price is for, and the aisle of a card.
-- The founder's test (18 November 2026): an item sold by weight ("By weight (pre-pack)") must say what its price is for: a pack of about
-- X g, or a kilo. Same on the card, the product page and the basket. Read only; nothing here prices or changes an item.
--
--   catalog_price_for(product)   {per: 'kg'} or {per: 'pack', about_g: n | null}, or null for an item sold as a piece (the price is for it).
--                                'kg': the sell unit is the kilo, or the item's own name says so ("Halloum /Kg", "Double Creme /Kg").
--                                'pack': sold by weight in packs, or a "500 g pack"; about_g is the pack's weight from an approved field
--                                (weight per pack, average weight of a pack, pack weight, or the size), else the sell unit's own figure
--                                ("500 g pack"), else null: the page says the weight is not confirmed yet, never a guess (invariant 7).
--   catalog_web_card             + 'price_for' and 'category_code' (the card's placeholder shows its aisle's icon, not the name twice).
--   web_catalog_product          + 'price_for' on the product.
--   web_price_for(skus)          the basket's lines: sku -> price_for, for items the site shows (role web_channel).
-- Items whose data is wrong (eggs sold "by weight") are not corrected here: data is B1f's (docs/log/web4a.md, "For B1f").

create or replace function catalog_price_for(p_product uuid) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare p products%rowtype; s text; g numeric; k text;
begin
  select * into p from products where id = p_product;
  if not found then return null; end if;
  s := lower(btrim(coalesce(p.sell_unit, '')));
  if s in ('kg', 'per kg', 'kilo') or p.name_en ~* '(/\s*kg\M|\mper\s+kg\M)' then
    return jsonb_build_object('per', 'kg', 'about_g', null);
  end if;
  if s ~ '(by weight|\mpack\M)' then
    select nullif(regexp_replace(v.value #>> '{}', '[^0-9.]', '', 'g'), '')::numeric into g
      from product_field_values v
     where v.product_id = p.id and v.status = 'approved' and v.field_key in ('weight_per_pack_g', 'average_weight_g', 'pack_weight_g')
     order by v.approved_at desc nulls last limit 1;
    if g is null then
      select intake_size_key(v.value #>> '{}') into k from product_field_values v
       where v.product_id = p.id and v.status = 'approved' and v.field_key = 'size' order by v.approved_at desc nulls last limit 1;
      k := coalesce(k, intake_size_key(p.sell_unit));
      if k ~ '^[0-9.]+g$' then g := regexp_replace(k, 'g$', '')::numeric; end if;
    end if;
    return jsonb_build_object('per', 'pack', 'about_g', case when g > 0 then round(g) end);
  end if;
  return null;
end $$;

create or replace function catalog_web_card(p_product uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('sku', w.sku, 'name_en', w.name_en, 'name_ar', w.name_ar, 'brand', w.brand, 'sell_unit', w.sell_unit,
                            'price_usd', w.price_usd, 'in_stock', w.in_stock and o.ok, 'orderable', o.ok, 'coming_soon', not o.ok,
                            'picture', catalog_web_picture(w.product_id),
                            'price_for', catalog_price_for(w.product_id), 'category_code', w.category_code)
    from catalog_web_items() w cross join lateral (select product_orderable(w.product_id) as ok) o where w.product_id = p_product $$;

create or replace function web_catalog_product(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb := web_catalog_product_unflagged(p_sku); v_id uuid; v_o boolean;
begin
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select product_id into v_id from catalog_web_items() i where i.sku = btrim(coalesce(p_sku, ''));
  v_o := product_orderable(v_id);
  return jsonb_set(r, '{product}', (r->'product') || jsonb_build_object('in_stock', coalesce((r->'product'->>'in_stock')::boolean, false) and v_o,
                                                                           'orderable', v_o, 'coming_soon', not v_o,
                                                                           'price_for', catalog_price_for(v_id)));
end $$;

create or replace function web_price_for(p_skus text[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(w.sku, catalog_price_for(w.product_id)) filter (where catalog_price_for(w.product_id) is not null), '{}'::jsonb)
    from catalog_web_items() w where w.sku = any((coalesce(p_skus, '{}'::text[]))[1:100]) $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

grant execute on function web_price_for(text[]) to web_channel;
