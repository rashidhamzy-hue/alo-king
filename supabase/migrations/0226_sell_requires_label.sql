-- Alo King Chouf, session SELL1 (nothing packaged sells before its label), migration 0226.
-- docs/DECISIONS.md, "Founder decision, 17 November 2026": every item with a pack is photographed on the label day, and no packaged item can be
-- sold until it is fact-complete from its label. Loose produce, meat and unpacked bakery sell on the core. What this migration adds:
--
--   1 packaged         product_templates.pack_rule (always | with_barcode | never) and product_is_packaged(): true for the packaged-food, baby-food,
--                      water, cleaning, beauty, baby and pet templates, and for a bakery or meat item with a REAL barcode (web_real_gtin, 0218: a
--                      right check digit, and not a number a store prints for its own use); false for produce, a restaurant dish, and a bakery or
--                      meat item with no real barcode. Data, not code: a new template says how it counts (invariant 13).
--   2 the label status product_label_status(): fact-complete (PD1, 0206) AND every record the template requires for fact-complete is a READING OF
--                      THE LABEL (facts with source label, field values with source label_photo), and a field that is approved by a person is not
--                      approved by the automatic party. A fact from the barcode database, a web page, a supplier sheet or a rule alone is not enough.
--                      It lists what is missing, so the readiness page and the label day can say what to read next.
--   3 the setting      settings.sell_requires_label {"enabled": false}, off. sell_requires_label() reads it; product_orderable() is
--                      "not (setting on and packaged and not label-ready)". Nothing in code switches it on: a person does, in settings.
--   4 the gate         When on, a packaged item that is not label-ready:
--                        quote_order            issue coming_soon, the line not ok, nothing added to the subtotal (0118's text with that
--                                               branch; a substitute is never one that is coming soon). create_order_from_quote and every card,
--                                               the website's cart and "same as last time" go through quote_order, so none is made for it;
--                                               order_quote_issues: a card made before the switch is sent back to draft at the confirm tap
--                        find_products          each match says orderable and coming_soon; orderable matches come first (the chat's search
--                        search_catalog         and the website's search, which both end here)
--                        catalog_web_card       in_stock false, coming_soon true (the website's lists and search); web_catalog_product says the
--                                               same for the page (the two stay one read, and the website shows "Coming soon")
--                        catalog_feed           listed out of stock in the WhatsApp catalogue
--                        plan_cart              a line of a catalogue cart that is coming soon is left out and named, reason coming_soon
--                        substitutes_for, dish_basket, basket_candidates, substitute_candidates
--                                               never offer it
--                      Loose items are unaffected: product_is_packaged is false, so product_orderable is true.
--   5 the numbers      product_readiness() carries packaged, label_ready and missing_label per item; readiness_summary() carries, per template,
--                      packaged items and how many are label-ready, the packaged total, and packaged_not_ready: each with what it misses.
--
-- Wrappers (rename, then a function of the same name that calls it) are used where the original is long and only its result changes
-- (find_products, search_catalog, web_catalog_product, product_readiness); the rest are the original text with the one
-- condition added, as every migration that changed them before did. The old signatures are kept. Nothing here writes an order, a payment, stock or
-- the ledger (invariant 3); the gate only removes a line, it never adds one.

-- ---------- 1 ----------
alter table product_templates add column pack_rule text not null default 'never' check (pack_rule in ('always', 'with_barcode', 'never'));
update product_templates set pack_rule = 'always' where code in ('packaged_food', 'baby_food', 'water', 'cleaning_household', 'beauty_personal_care', 'baby_child', 'pet');
update product_templates set pack_rule = 'with_barcode' where code in ('bakery', 'meat_poultry');
comment on column product_templates.pack_rule is 'SELL1 (0226). always: every item has a pack. with_barcode: a pack only when the item has a real barcode (loose bakery and meat have none). never: loose produce, a dish, a service.';

create or replace function product_is_packaged(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select case t.pack_rule when 'always' then true when 'with_barcode' then web_real_gtin(p.barcode) is not null else false end
                     from products p join product_templates t on t.code = product_template(p.id) where p.id = p_product), false) $$;

-- ---------- 3 (the setting comes before the functions that read it) ----------
insert into settings(key, value) values ('sell_requires_label', '{"enabled": false}') on conflict (key) do nothing;
create or replace function sell_requires_label() returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((setting('sell_requires_label')->>'enabled')::boolean, false) $$;

-- ---------- 2 ----------
-- What the item has of a label reading. For each field its template requires for fact-complete: the current, approved, unexpired record must be the
-- label's (facts: source label; values: source label_photo), and where the standard says a person approves the field it is not the automatic party
-- (0124's party). Ingredients and nutrition are "automatic" in the standard, so a rule's approval of a label reading counts for them; the 14
-- allergens are approved by a person by the database's own rule. A non-packaged item has no label requirement (required false, label_ready false).
-- p_status: the item's product_template_status when the caller already has it (the readiness page reads it for every item once).
create or replace function product_label_status(p_product uuid, p_status jsonb default null) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare st jsonb; v_t text; t product_templates%rowtype; f record; v_ok boolean; v_packaged boolean; v_auto uuid := auto_approval_party();
        v_recent timestamptz := now() - interval '12 months'; v_notlabel text[] := '{}'; v_missing text[]; v_k text;
begin
  st := coalesce(p_status, product_template_status(p_product));
  if st is null then return null; end if;
  v_packaged := product_is_packaged(p_product);
  v_t := st->>'template';
  if not v_packaged then
    return jsonb_build_object('product_id', p_product, 'template', v_t, 'packaged', false, 'required', false, 'sellable', (st->>'sellable')::boolean,
                              'fact_complete', (st->>'fact_complete')::boolean, 'label_ready', false, 'missing', '[]'::jsonb, 'not_from_label', '[]'::jsonb);
  end if;
  select * into t from product_templates where code = v_t;
  for f in select distinct on (tf.key) tf.* from template_fields tf
            where tf.required_for = 'fact_complete' and (tf.template_code = v_t or (tf.template_code = 'core' and t.includes_core))
            order by tf.key, (tf.template_code = v_t) desc loop
    v_ok := case f.store
      when 'facts' then case f.key
        when 'ingredients' then exists (select 1 from product_facts x where x.product_id = p_product and x.attribute = 'ingredients' and x.source = 'label'
                                          and x.approved_at is not null and x.superseded_at is null and x.status in ('certified', 'declared', 'calculated')
                                          and (x.expires_at is null or x.expires_at > now()) and coalesce(x.reviewed_at, x.approved_at) > v_recent)
        when 'allergens' then (select count(distinct x.attribute) from product_facts x join food_attributes a on a.code = x.attribute and a.kind = 'allergen'
                                where x.product_id = p_product and x.source = 'label' and x.approved_at is not null and x.superseded_at is null and x.status <> 'unknown'
                                  and x.approved_by is distinct from v_auto and (x.expires_at is null or x.expires_at > now()) and coalesce(x.reviewed_at, x.approved_at) > v_recent)
                              = (select count(*) from food_attributes where kind = 'allergen')
        when 'nutrition' then exists (select 1 from product_facts x where x.product_id = p_product and x.attribute = 'nutrition' and x.source = 'label'
                                        and x.approved_at is not null and x.superseded_at is null and x.status in ('certified', 'declared', 'calculated')
                                        and (x.expires_at is null or x.expires_at > now()) and coalesce(x.reviewed_at, x.approved_at) > v_recent)
        else false end
      when 'values' then exists (select 1 from product_field_values v where v.product_id = p_product and v.field_key = f.key and v.status = 'approved'
                                   and v.source = 'label_photo' and (v.expires_at is null or v.expires_at > now())
                                   and (f.approval <> 'person' or v.approved_by is distinct from v_auto))
      else true end;
    if not v_ok then v_notlabel := v_notlabel || f.key; end if;
  end loop;
  -- Meat: a halal status shown needs the supplier's certificate; that already counts against fact-complete (0206) and is in the missing list below.
  v_missing := array(select distinct k from (select jsonb_array_elements_text(st->'missing_sellable') as k union all
                                             select jsonb_array_elements_text(st->'missing_fact_complete') union all select unnest(v_notlabel)) z order by 1);
  return jsonb_build_object('product_id', p_product, 'template', v_t, 'packaged', true, 'required', true, 'sellable', (st->>'sellable')::boolean,
    'fact_complete', (st->>'fact_complete')::boolean, 'label_ready', (st->>'fact_complete')::boolean and cardinality(v_notlabel) = 0,
    'missing', to_jsonb(v_missing), 'not_from_label', to_jsonb(v_notlabel));
end $$;

create or replace function product_label_ready(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((product_label_status(p_product)->>'label_ready')::boolean, false) $$;

-- The one question every read asks. The setting first, so with it off nothing here costs a template check.
create or replace function product_orderable(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select case when not sell_requires_label() then true
              when not product_is_packaged(p_product) then true
              else product_label_ready(p_product) end $$;

-- ---------- 4: quote_order (0118's text, with the gate) ----------

create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false, p_slot uuid default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric := 0; v_eta int; v_small numeric := 0; v_sof jsonb := setting('small_order_fee');
        v_fx numeric := current_fx(); v_hours jsonb := setting('hours'); v_now time; v_min numeric := (setting('min_order_usd'))::text::numeric;
        o record; v_free numeric; v_qty numeric; v_ok boolean; v_subs jsonb; v_served boolean;
        v_later boolean := p_slot is not null; v_fresh boolean := false; v_restaurant boolean := false; v_state text;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 1);
    select p.id, p.sku, p.name_en, p.name_ar, p.category, p.sub_type, p.sell_unit, ofr.price_usd, ofr.is_available,
           s.id as source_id, s.name as source_name, s.kind, s.is_open,
           coalesce(l.on_hand - l.reserved, 0) as free,
           (s.kind = 'dark_store' and p.storage::text = any(bought_to_order_zones())) as bto
      into o
      from products p join offers ofr on ofr.product_id = p.id join sources s on s.id = ofr.source_id
      left join stock_levels l on l.product_id = p.id and l.source_id = s.id
     where p.id = (ln->>'product_id')::uuid and p.is_active
       and ((ln->>'source_id') is null or s.id = (ln->>'source_id')::uuid)
     order by (s.kind = 'dark_store') desc, ofr.price_usd limit 1;
    if not found then
      v_issues := v_issues || jsonb_build_object('code', 'unknown_product', 'product_id', ln->>'product_id');
      continue;
    end if;
    -- SELL1 (0226): a packaged item that is not fact-complete from a label reading cannot be sold while sell_requires_label is on. It is named
    -- (coming_soon), its line is not ok, nothing is added to the subtotal, and no stock or substitute is looked at: it is not for sale at all.
    if not product_orderable(o.id) then
      v_issues := v_issues || jsonb_build_object('code', 'coming_soon', 'product_id', o.id, 'name', o.name_en);
      v_lines := v_lines || jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                   'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', o.price_usd, 'line_total_usd', round(o.price_usd * v_qty, 2),
                   'source_id', o.source_id, 'source', o.source_name, 'ok', false, 'coming_soon', true, 'bought_to_order', false,
                   'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', ln->>'note', 'raw', ln->>'raw');
      continue;
    end if;
    if o.kind <> 'dark_store' then v_restaurant := true; end if;
    if o.bto then v_fresh := true; end if;
    v_free := case when o.kind = 'dark_store' and v_later and o.bto and o.is_available then greatest(o.free, v_qty)   -- bought for the window
                   when o.kind = 'dark_store' then o.free when o.is_available and o.is_open then 999 else 0 end;
    v_ok := v_free >= v_qty;
    v_subs := '[]'::jsonb;
    if not v_ok then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_subs from (
        select p2.id as product_id, p2.name_en, p2.name_ar, p2.brand, o2.price_usd
        from products p2 join offers o2 on o2.product_id = p2.id and o2.source_id = o.source_id
        join stock_levels l2 on l2.product_id = p2.id and l2.source_id = o.source_id
        where p2.id <> o.id and p2.is_active and p2.category = o.category and p2.sub_type is not distinct from o.sub_type
          and l2.on_hand - l2.reserved >= v_qty and product_orderable(p2.id)
        order by p2.velocity_tier nulls last, o2.price_usd limit 3) x;
      v_issues := v_issues || jsonb_build_object('code', case when v_free > 0 then 'insufficient_stock' else 'out_of_stock' end,
                    'product_id', o.id, 'name', o.name_en, 'available', v_free, 'substitutes', v_subs, 'bought_to_order', o.bto);
    else
      v_sub := v_sub + round(o.price_usd * v_qty, 2);
    end if;
    v_lines := v_lines || jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                 'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', o.price_usd, 'line_total_usd', round(o.price_usd * v_qty, 2),
                 'source_id', o.source_id, 'source', o.source_name, 'ok', v_ok, 'bought_to_order', o.bto,
                 'modifiers', coalesce(ln->'modifiers', '[]'::jsonb), 'note', ln->>'note', 'raw', ln->>'raw');
  end loop;

  if jsonb_array_length(v_lines) = 0 then v_issues := v_issues || jsonb_build_object('code', 'empty_order'); end if;

  if not p_pickup then
    if p_village is null then
      v_issues := v_issues || jsonb_build_object('code', 'no_delivery_village');
    else
      select z.delivery_fee_usd, z.base_eta_minutes, vi.is_served into v_fee, v_eta, v_served
        from villages vi left join zones z on z.id = vi.zone_id where vi.id = p_village;
      if not coalesce(v_served, false) or v_fee is null then
        v_issues := v_issues || jsonb_build_object('code', 'village_not_served'); v_fee := 0;
      end if;
    end if;
  end if;

  -- Small-order fee (1.16): company income on a small basket, its own line, never part of the rider's delivery fee.
  -- Off while either number is 0 (the default until the founder sets them).
  if coalesce((v_sof->>'fee_usd')::numeric, 0) > 0 and v_sub > 0 and v_sub < coalesce((v_sof->>'below_subtotal_usd')::numeric, 0) then
    v_small := round((v_sof->>'fee_usd')::numeric, 2);
  end if;
  if v_sub > 0 and v_sub < v_min then
    v_issues := v_issues || jsonb_build_object('code', 'below_minimum', 'minimum_usd', v_min, 'subtotal_usd', v_sub);
  end if;
  if v_later then
    -- W1: the window, checked as the tap will check it (confirm_order_checked, 0040). The hours do not apply to it.
    v_state := case when p_pickup then 'pickup' when v_restaurant then 'restaurant' else slot_state(p_slot, v_fresh) end;
    if v_state = 'ok' and exists (select 1 from delivery_slots s where s.id = p_slot and s.zone_id is not null
                                     and s.zone_id is distinct from (select zone_id from villages where id = p_village)) then
      v_state := 'zone';
    end if;
    if v_state <> 'ok' then v_issues := v_issues || jsonb_build_object('code', 'slot_' || v_state, 'slot_id', p_slot); end if;
  else
    v_now := (now() at time zone coalesce(v_hours->>'tz', 'Asia/Beirut'))::time;
    if v_now < (v_hours->>'open')::time or v_now >= (v_hours->>'close')::time then
      v_issues := v_issues || jsonb_build_object('code', 'closed', 'opens', v_hours->>'open', 'closes', v_hours->>'close');
    end if;
  end if;
  if v_fx is null then v_issues := v_issues || jsonb_build_object('code', 'no_exchange_rate'); end if;
  -- D1 (3.8): a rate that moved more than settings.fx.pause_move_pct within the day waits for a person, and quoting pauses
  -- until then. Nothing is priced on a rate nobody has confirmed (B4).
  if fx_quoting_paused() then v_issues := v_issues || jsonb_build_object('code', 'fx_paused'); end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'lines', v_lines,
    'subtotal_usd', v_sub, 'delivery_fee_usd', v_fee, 'small_order_fee_usd', v_small, 'total_usd', v_sub + v_fee + v_small,
    'fx_rate_lbp', v_fx, 'total_lbp', case when v_fx is null then null else round((v_sub + v_fee + v_small) * v_fx / 1000) * 1000 end,
    'eta_minutes', case when p_pickup then null else v_eta end, 'pickup', p_pickup, 'village_id', p_village,
    'village', (select name_en from villages where id = p_village),
    'village_ar', (select name_ar from villages where id = p_village),
    'slot_id', p_slot, 'window', case when v_later then window_json(p_slot) end, 'bought_to_order', v_fresh);
end $$;

-- order_quote_issues (0007's text, one condition added): the confirm tap re-checks a card (confirm_order_checked, 0040 and 0131). A card made
-- before the setting was switched on, whose line is now coming soon, goes back to draft like any other change (stale_quote): it is never confirmed.
create or replace function order_quote_issues(p_order uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('item', i.name_snapshot, 'issue',
           case when not product_orderable(i.product_id) then 'coming_soon'
                when ofr.id is null or not ofr.is_available then 'unavailable'
                when not s.is_open then 'source_closed'
                else 'price_changed' end, 'was_usd', i.unit_price_usd, 'now_usd', ofr.price_usd)), '[]'::jsonb)
    from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
    left join offers ofr on ofr.source_id = f.source_id and ofr.product_id = i.product_id
   where i.order_id = p_order
     and (not product_orderable(i.product_id) or ofr.id is null or not ofr.is_available or not s.is_open or ofr.price_usd <> i.unit_price_usd) $$;

-- plan_cart (0085's text): a catalogue cart's line that is coming soon is left out and named with its own reason.
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
        select jsonb_build_object('sku', l->>'sku', 'name', l->>'name', 'name_ar', l->>'name_ar',
                 'reason', case when exists (select 1 from jsonb_array_elements(v_quote->'lines') ql where ql->>'product_id' = l->>'product_id'
                                              and coalesce((ql->>'coming_soon')::boolean, false)) then 'coming_soon' else 'out_of_stock' end)
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

-- find_products (0214) and search_catalog (0053): the same result, each match saying whether it can be ordered. Orderable matches come first
-- (the fused rank is kept within each group); the chat says "coming soon" for the others, the website prints "Coming soon".
alter function find_products(text, jsonb, int, text, text, text) rename to find_products_unflagged;
create or replace function find_products(p_query text, p_filters jsonb default '{}', p_limit int default 8, p_embedding text default null,
                                         p_model text default null, p_cache_key text default null)
returns jsonb language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare r jsonb := find_products_unflagged(p_query, p_filters, p_limit, p_embedding, p_model, p_cache_key);
begin
  return r || jsonb_build_object('matches', coalesce((
    select jsonb_agg(y.m || jsonb_build_object('orderable', y.o, 'coming_soon', not y.o) order by (not y.o), y.n)
      from (select x.m, x.n, product_orderable((x.m->>'product_id')::uuid) as o from jsonb_array_elements(coalesce(r->'matches', '[]'::jsonb)) with ordinality x(m, n)) y), '[]'::jsonb));
end $$;

alter function search_catalog(text, text, int) rename to search_catalog_unflagged;
create or replace function search_catalog(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare r jsonb := search_catalog_unflagged(p_query, p_source_hint, p_limit);
begin
  return r || jsonb_build_object('matches', coalesce((
    select jsonb_agg(y.m || jsonb_build_object('orderable', y.o, 'coming_soon', not y.o) order by (not y.o), y.n)
      from (select x.m, x.n, coalesce(product_orderable(nullif(x.m->>'product_id', '')::uuid), true) as o
              from jsonb_array_elements(coalesce(r->'matches', '[]'::jsonb)) with ordinality x(m, n)) y), '[]'::jsonb));
end $$;

-- The website: the card of a list (0154's text) and the page (a wrapper: one read, the same words in the page and in the list).
create or replace function catalog_web_card(p_product uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('sku', w.sku, 'name_en', w.name_en, 'name_ar', w.name_ar, 'brand', w.brand, 'sell_unit', w.sell_unit,
                            'price_usd', w.price_usd, 'in_stock', w.in_stock and o.ok, 'orderable', o.ok, 'coming_soon', not o.ok,
                            'picture', catalog_web_picture(w.product_id))
    from catalog_web_items() w cross join lateral (select product_orderable(w.product_id) as ok) o where w.product_id = p_product $$;

alter function web_catalog_product(text) rename to web_catalog_product_unflagged;
create or replace function web_catalog_product(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb := web_catalog_product_unflagged(p_sku); v_id uuid; v_o boolean;
begin
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select product_id into v_id from catalog_web_items() i where i.sku = btrim(coalesce(p_sku, ''));
  v_o := product_orderable(v_id);
  return jsonb_set(r, '{product}', (r->'product') || jsonb_build_object('in_stock', coalesce((r->'product'->>'in_stock')::boolean, false) and v_o,
                                                                           'orderable', v_o, 'coming_soon', not v_o));
end $$;

-- The WhatsApp catalogue (0115's text): an item that is coming soon is listed out of stock.
create or replace function catalog_feed() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
           'brand', coalesce(nullif(p.brand, ''), 'Alo King'),
           'price_usd', o.price_usd, 'in_stock', coalesce(l.on_hand - l.reserved, 0) > 0 and product_orderable(p.id),
           'media_path', i.media_path, 'public_path', cp.public_path, 'attribution', i.attribution, 'licence', i.licence,
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
    join product_images i on i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence)
    left join catalog_public_pictures cp on cp.image_id = i.id $$;

-- Code-built offers never include what cannot be sold (0208, 0215, 0032: the original text with the one condition added).
create or replace function substitutes_for(p_product uuid, p_restrictions text[] default '{}') returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by (x->'unit_price'->>'price_usd')::numeric nulls last, x->>'name_en'), '[]'::jsonb) from (
    select distinct on (o.id) jsonb_build_object('product_id', o.id, 'name_en', o.name_en, 'name_ar', o.name_ar, 'group', g.group_code,
             'unit_price', product_unit_price(o.id)) as x
      from product_substitutes g join product_substitutes g2 on g2.group_code = g.group_code and g2.product_id <> g.product_id
      join products o on o.id = g2.product_id and o.is_active and product_orderable(o.id)
     where g.product_id = p_product
       and (coalesce(cardinality(p_restrictions), 0) = 0 or (product_meets_restrictions(o.id, p_restrictions)->>'meets')::boolean)) y $$;

create or replace function dish_basket(p_dish text, p_people int, p_restrictions text[] default '{}') returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('dish', d.code, 'name_en', d.name_en, 'name_ar', d.name_ar, 'people', p_people,
    'kinds', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'qty', k.qty_per_person * p_people, 'unit', k.unit, 'optional', k.optional,
        'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'unit_price', product_unit_price(p.id))
                                            order by (product_unit_price(p.id)->>'price_usd')::numeric nulls last)
                             from products p where p.is_active and p.owner_source_id is null and product_orderable(p.id) and product_kind(p.id) = lower(k.kind)
                              and (coalesce(cardinality(p_restrictions), 0) = 0 or (product_meets_restrictions(p.id, p_restrictions)->>'meets')::boolean)), '[]'::jsonb))
        order by k.optional, k.kind) from dish_kinds k where k.dish_code = d.code), '[]'::jsonb))
    from dishes d where d.code = p_dish and p_people between 1 and 50 $$;

create or replace function basket_candidates(p_filters jsonb) returns table (product_id uuid, kind text, price_usd numeric, available numeric, name_en text)
language sql stable set search_path = public, pg_temp as $$
  select p.id, product_kind(p.id), o.price_usd, coalesce(l.on_hand - l.reserved, 0), p.name_en
    from products p
    join lateral (select x.source_id, x.price_usd, x.is_available from offers x join sources s on s.id = x.source_id and s.kind = 'dark_store'
                   where x.product_id = p.id order by x.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
   where p.is_active and p.owner_source_id is null and o.is_available and o.price_usd > 0 and product_orderable(p.id)
     and (coalesce(p_filters, '{}'::jsonb) - 'prefer_tags' - 'sort' = '{}'::jsonb
          or (product_passes_filters(p.id, coalesce(p_filters, '{}'::jsonb) - 'prefer_tags' - 'sort')->>'pass')::boolean) $$;

create or replace function substitute_candidates(p_missing uuid) returns jsonb language plpgsql stable as $$
declare i order_items%rowtype; p products%rowtype; v_src uuid; v_paid boolean; v_cap numeric; v jsonb;
begin
  select * into i from order_items where id = p_missing;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into p from products where id = i.product_id;
  select f.source_id into v_src from fulfilments f where f.id = i.fulfilment_id;
  if order_has_restrictions(i.order_id) then
    return jsonb_build_object('candidates', '[]'::jsonb, 'blocked', 'customer_restrictions');
  end if;
  v_paid := exists (select 1 from payments where order_id = i.order_id and status = 'confirmed');
  v_cap := case when v_paid then round(i.qty * i.unit_price_usd, 2) else null end;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank), '[]'::jsonb) into v from (
    select p2.id as product_id, coalesce(p2.name_ar, p2.name_en) as name, p2.brand, ofr.price_usd as unit_price_usd,
           round(ofr.price_usd * i.qty, 2) as line_total_usd, round(ofr.price_usd * i.qty, 2) - round(i.qty * i.unit_price_usd, 2) as diff_usd,
           row_number() over (order by abs(ofr.price_usd - i.unit_price_usd), p2.velocity_tier nulls last, p2.name_en) as rank
      from products p2 join offers ofr on ofr.product_id = p2.id and ofr.source_id = v_src
      join stock_levels l on l.product_id = p2.id and l.source_id = v_src
     where p2.id <> i.product_id and p2.is_active and ofr.is_available and not product_on_hold(p2.id) and product_orderable(p2.id)
       and p2.category = p.category and p2.sub_type is not distinct from p.sub_type
       and l.on_hand - l.reserved >= i.qty
       and (v_cap is null or round(ofr.price_usd * i.qty, 2) <= v_cap)
     order by 7 limit 3) x;
  return jsonb_build_object('candidates', v, 'blocked', case when jsonb_array_length(v) = 0 then 'none_in_stock' end);
end $$;

-- ---------- 5: the readiness page's numbers ----------
alter function product_readiness(uuid) rename to product_readiness_levels;
create or replace function product_readiness(p_product uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r || jsonb_build_object('packaged', coalesce((l->>'packaged')::boolean, false), 'label_ready', coalesce((l->>'label_ready')::boolean, false),
                                                    'missing_label', case when (l->>'packaged')::boolean then l->'missing' else '[]'::jsonb end) order by n), '[]'::jsonb)
    from jsonb_array_elements(product_readiness_levels(p_product)) with ordinality x(r, n)
    cross join lateral (select product_label_status((r->>'product_id')::uuid, r) as l) y $$;

-- readiness_summary (0206's numbers, one pass over the items, plus the label numbers): active, sellable and fact_complete overall and per template,
-- and per template the packaged items and how many are label-ready; packaged_not_ready lists the packaged items without a label reading, each with
-- what it misses. The numbers are facts about the items, not about the switch; sell_requires_label says whether the switch is on.
create or replace function readiness_summary() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with items as (
    select p.id, p.sku, p.name_en, coalesce(s->>'template', 'none') as tpl, s, product_label_status(p.id, s) as ls
      from products p cross join lateral (select product_template_status(p.id) as s) x
     where p.is_active and p.owner_source_id is null),
  per as (select tpl, count(*)::int as n, (count(*) filter (where (s->>'sellable')::boolean))::int as ns, (count(*) filter (where (s->>'fact_complete')::boolean))::int as nf,
                 (count(*) filter (where (ls->>'packaged')::boolean))::int as packaged, (count(*) filter (where (ls->>'label_ready')::boolean))::int as label_ready
            from items group by tpl)
  select jsonb_build_object(
    'active', (select count(*) from items),
    'sellable', (select count(*) from items where (s->>'sellable')::boolean),
    'fact_complete', (select count(*) from items where (s->>'fact_complete')::boolean),
    'sell_requires_label', sell_requires_label(),
    'packaged', (select coalesce(sum(packaged), 0) from per), 'label_ready', (select coalesce(sum(label_ready), 0) from per),
    'by_template', (select coalesce(jsonb_object_agg(tpl, jsonb_build_object('active', n, 'sellable', ns, 'fact_complete', nf, 'packaged', packaged, 'label_ready', label_ready)), '{}'::jsonb) from per),
    'packaged_not_ready', (select coalesce(jsonb_agg(jsonb_build_object('product_id', i.id, 'sku', i.sku, 'name_en', i.name_en, 'template', i.tpl,
                                                                          'missing', i.ls->'missing', 'sellable', (i.ls->>'sellable')::boolean) order by i.tpl, i.sku), '[]'::jsonb)
                             from items i where (i.ls->>'packaged')::boolean and not (i.ls->>'label_ready')::boolean)) $$;

select pin_search_paths();

-- ---------- access ----------
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  -- the website's role keeps exactly the functions it had (0155, 0218). The renamed original of the page read is reached only through its
  -- wrapper (which runs as its owner): the grant it carried is taken away, so the unflagged page can never be read directly.
  if exists (select 1 from pg_roles where rolname = 'web_channel') then
    revoke execute on function web_catalog_product_unflagged(text) from web_channel;
    grant execute on function web_catalog_product(text) to web_channel;
  end if;
end $$;
