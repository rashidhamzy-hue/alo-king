-- Rollback of 20261016170000_split_carts.sql: no saved carts. A cart from several shops goes back to the session 5e
-- behaviour (cart_merge takes the first shop's items and reports the others as other_branch), and "delete my data" is as
-- in 20261011100100. Redeploy the dispatch function from before session 5f PR 5 together with it (that one never calls
-- cart_split or saved_cart_*). The app_config row basket_keep_hours stays: config rows are dated and never deleted, and
-- nothing reads it without this migration. What is lost: the saved carts (customers can send their carts again).
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: split carts (session 5f)', true);

select cron.unschedule('saved-carts-prune') where exists (select 1 from cron.job where jobname = 'saved-carts-prune');
drop function if exists app_private.saved_carts_prune();
drop function if exists public.saved_cart_swap(uuid, uuid, uuid);
drop function if exists public.saved_cart_drop(uuid, uuid);
drop function if exists public.saved_cart_next(uuid, uuid, boolean);
drop function if exists public.saved_cart_take(uuid, uuid, text);
drop function if exists public.saved_cart_save(uuid, text, jsonb);
drop function if exists public.cart_split(uuid, text, jsonb);
drop function if exists app_private.cart_delivers(text);
drop function if exists app_private.cart_alternative(uuid, uuid, jsonb, uuid[]);
drop function if exists app_private.cart_groups(jsonb);
drop index if exists public.menu_item_nutrition_dish_idx;
drop table if exists public.saved_carts;

CREATE OR REPLACE FUNCTION public.customer_forget(p_customer_id uuid, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_loc jsonb := null;
begin
  if p_scope not in ('history', 'all') then
    raise exception 'scope must be history or all' using errcode = 'invalid_parameter_value';
  end if;
  update public.customers set profile_reset_at = now() where id = p_customer_id;
  delete from public.customer_preferences where customer_id = p_customer_id;
  update public.bot_sessions set history = '[]', refs = '{}', pending = '{}', focus_vendor_id = null where customer_id = p_customer_id;
  if p_scope = 'all' then
    update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
    v_loc := public.location_forget_customer(p_customer_id);
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now(), display_name = null
    where id = p_customer_id;
  end if;
  return jsonb_build_object('status', 'forgotten', 'scope', p_scope, 'location', v_loc);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cart_merge(p_customer_id uuid, p_message_id text, p_lines jsonb, p_replace boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l jsonb;
  r jsonb;
  v_item public.menu_items%rowtype;
  v_cart_vendor uuid;
  v_basket public.baskets%rowtype;
  v_added int := 0;
  v_first boolean := true;
  v_now numeric;
  v_skipped jsonb := '[]';
  v_needs jsonb := '[]';
  v_diffs jsonb := '[]';
begin
  if p_message_id is null or char_length(p_message_id) > 200 then
    raise exception 'cart_merge needs the message id' using errcode = 'invalid_parameter_value';
  end if;
  -- The cart's shop: the first line that is one of our items.
  select i.vendor_id into v_cart_vendor from jsonb_array_elements(coalesce(p_lines, '[]')) with ordinality x(v, n)
  join public.menu_items i on i.id = (x.v ->> 'item_id')::uuid order by x.n limit 1;
  if v_cart_vendor is null then
    return jsonb_build_object('status', 'unknown_items', 'added', 0);
  end if;
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is not null and v_basket.vendor_id <> v_cart_vendor and not coalesce(p_replace, false)
     -- a replay of a merge that already replaced the basket finds the cart's shop in it
     and not exists (select 1 from app_private.basket_add_ops o where o.op_key like p_message_id || '#cart:%') then
    return jsonb_build_object('status', 'other_vendor',
      'basket_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id),
      'basket_vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_basket.vendor_id),
      'cart_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_cart_vendor),
      'cart_vendor_en', (select coalesce(v.name_en, v.name_ar) from public.vendors v where v.id = v_cart_vendor));
  end if;
  for l in select x from jsonb_array_elements(coalesce(p_lines, '[]')) x limit 30 loop
    select * into v_item from public.menu_items where id = (l ->> 'item_id')::uuid;
    if v_item.id is null or v_item.vendor_id <> v_cart_vendor then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('item_id', l ->> 'item_id',
        'status', case when v_item.id is null then 'unknown_item' else 'other_branch' end,
        'item', coalesce(v_item.name_ar, v_item.name_en)));
      continue;
    end if;
    if exists (select 1 from public.menu_option_groups g where g.item_id = v_item.id and g.min_select > 0) then
      v_needs := v_needs || jsonb_build_array(jsonb_build_object('item_id', v_item.id,
        'quantity', least(greatest(coalesce((l ->> 'quantity')::int, 1), 1), 50)));
      continue;
    end if;
    r := public.basket_add_item(p_customer_id, v_item.id, least(greatest(coalesce((l ->> 'quantity')::int, 1), 1), 50), '{}',
      null, v_first and coalesce(p_replace, false), p_message_id || '#cart:' || v_item.id);
    if r ->> 'status' = 'added' then
      -- Only an added line has replaced the old basket; until then the next line still carries the replace.
      v_first := false;
      v_added := v_added + 1;
      v_now := case when v_item.pricing_unit = 'kg' then round(v_item.price_usd * v_item.est_weight_kg, 2) else v_item.price_usd end;
      if jsonb_typeof(l -> 'shown_usd') = 'number' and abs((l ->> 'shown_usd')::numeric - v_now) >= 0.005 then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('item_id', v_item.id,
          'item', coalesce(v_item.name_ar, v_item.name_en), 'item_en', coalesce(v_item.name_en, v_item.name_ar),
          'shown_usd', round((l ->> 'shown_usd')::numeric, 2), 'now_usd', v_now));
      end if;
    else
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'status', r ->> 'status',
        'item', coalesce(v_item.name_ar, v_item.name_en)));
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'added', v_added, 'skipped', v_skipped, 'needs_options', v_needs,
    'diffs', v_diffs, 'basket', case when v_added > 0 or v_basket.id is not null then public.basket_view(p_customer_id) end);
end;
$function$
;
