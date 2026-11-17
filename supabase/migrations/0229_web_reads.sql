-- Alo King Chouf, session WEB2 (the website's day-one ordering), migration 2 of 3: what the website reads, and the account's few writes.
--
-- Every function here that the website calls takes the session token (or, for the order page, the order's code and its signed link) and
-- finds the party itself, never from the page (0129's rule). 0230 grants them to web_channel by name.
--   order_card           0120's text, plus the choices WEB2 puts on the card (cash in lira and its amount, the missing-item choice for the
--                        order and per item), so a card sent again and the website's card say the same as the first card.
--   web_order_page       the order page (/o/<code>): status and its times, the window or the time, the lines and totals, what changed at the
--                        shelf (lines taken off, substitutes kept), the handover code while it is needed. No address, no phone, no party.
--                        Nothing at all for a wrong or expired link, or 48 hours after the order ended.
--   web_orders           history: the person's orders from every channel (WhatsApp and web share one history), each with a fresh link.
--   web_order_again      "order again": the order's basket at today's prices into the cart (basket_from_order, 0118); what cannot be sold
--                        now is named and left out.
--   web_account, web_memory_forget, web_memory_pref, web_sign_out_everywhere
--                        the account page: saved places, what we remember (0019's view, without the contact phone), forget, stop or start
--                        remembering, and sign out on every device (0129's web_sessions_revoke).
--   web_save_pin, web_pin_village, web_place_details
--                        the checkout's place: the pin decides the village and the fee (save_customer_pin, 0074), then house and floor.
--   web_windows          the delivery windows for a village (open_delivery_windows, 0040).
--   web_service_facts    hours, minimum, fees, today's rate, payment ways, notes and timers, all from settings (the "How it works" page and
--                        the checkout's words).
--   web_cart_count       the header's basket count.

create or replace function order_card(p_order uuid, p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'payment_method', o.payment_method,
    'change_for_usd', o.change_for_usd, 'window', window_json(o.delivery_slot_id),
    'cash_currency', o.cash_currency, 'change_for_lbp', o.change_for_lbp, 'missing_pref', o.missing_pref, 'keep_change', o.keep_change_credit,
    'missing_items', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', i.name_snapshot, 'name_ar', p.name_ar, 'pref', i.missing_pref) order by i.id), '[]'::jsonb)
                        from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok' and i.missing_pref is not null),
    'replaces', (select r.short_code from orders r where r.id = o.replaces_order_id),
    'reopened_from', (select r.short_code from orders r where r.id = o.reopened_from),
    'prepay', case when o.payment_method <> 'cod' and coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0) > 0
                        and o.total_usd > (setting('first_order')->>'max_cod_usd')::numeric
                        and not exists (select 1 from orders d where d.customer_id = o.customer_id and d.status in ('delivered', 'closed'))
                   then jsonb_build_object('reason', 'first_order', 'maxCodUsd', (setting('first_order')->>'max_cod_usd')::numeric) end,
    'quote', jsonb_build_object('ok', true, 'issues', '[]'::jsonb,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty, 'unit', p.sell_unit,
                                  'line_total_usd', round(i.qty * i.unit_price_usd, 2), 'modifiers', i.modifiers, 'note', i.note) order by i.id), '[]'::jsonb)
                  from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok'),
      'subtotal_usd', o.subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'small_order_fee_usd', o.small_order_fee_usd,
      'dues_usd', o.dues_usd + c.credit, 'credit_usd', c.credit, 'total_usd', o.total_usd,
      'fx_rate_lbp', coalesce(o.fx_rate_lbp, current_fx()),
      'total_lbp', case when coalesce(o.fx_rate_lbp, current_fx()) is null then null else round(o.total_usd * coalesce(o.fx_rate_lbp, current_fx()) / 1000) * 1000 end,
      'eta_minutes', (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id),
      'pickup', o.is_pickup, 'village_id', o.village_id,
      'village', (select name_en from villages where id = o.village_id), 'village_ar', (select name_ar from villages where id = o.village_id)))
    from orders o, lateral (select coalesce(sum(amount_usd), 0) as credit from credit_applications where order_id = o.id) c
   where o.id = p_order and o.customer_id = p_party $$;

-- When an order ended (delivered, closed, cancelled, failed or returned), or null while it is still going.
create or replace function order_ended_at(p_order uuid) returns timestamptz language sql stable as $$
  select case when o.status in ('delivered', 'closed', 'cancelled', 'failed_delivery', 'returned')
              then greatest(o.delivered_at, (select max(e.created_at) from order_events e where e.order_id = o.id)) end
    from orders o where o.id = p_order $$;

-- ---------- the order page: the code and its signed link; no session needed (it can be opened on another phone) ----------
create or replace function web_order_page(p_code text, p_link text) returns jsonb language plpgsql stable security definer as $$
declare o orders%rowtype; v_end timestamptz; v_credit numeric; v_fx numeric;
begin
  select * into o from orders where short_code = upper(btrim(coalesce(p_code, '')));
  if not found or not order_link_ok(o.id, p_link) then return jsonb_build_object('ok', false); end if;
  v_end := order_ended_at(o.id);
  if v_end is not null and v_end < now() - make_interval(hours => coalesce((setting('web')->>'order_link_after_end_hours')::int, 48)) then
    return jsonb_build_object('ok', false);
  end if;
  select coalesce(sum(amount_usd), 0) into v_credit from credit_applications where order_id = o.id;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  return jsonb_build_object('ok', true, 'short_code', o.short_code, 'status', o.status, 'channel', o.channel, 'pickup', o.is_pickup,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'window', window_json(o.delivery_slot_id),
    'eta_minutes', case when o.delivery_slot_id is null and not o.is_pickup
                        then (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id) end,
    'payment_method', o.payment_method, 'cash_currency', o.cash_currency,
    'cancel_reason', case when o.status = 'cancelled' then o.cancel_reason end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
                 from order_events e where e.order_id = o.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name_en', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty, 'unit', p.sell_unit,
                                 'line_total_usd', round(i.qty * i.unit_price_usd, 2)) order by i.id), '[]'::jsonb)
                from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok'),
    'removed', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name_en', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty) order by i.id), '[]'::jsonb)
                  from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'removed'
                   and not exists (select 1 from order_items s where s.substitution_of = i.id and s.status = 'ok')),
    'substituted', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name_en', s.name_snapshot, 'name_ar', p.name_ar,
                                      'for_sku', fp.sku, 'for_name_en', f.name_snapshot, 'for_name_ar', fp.name_ar) order by s.id), '[]'::jsonb)
                      from order_items s join products p on p.id = s.product_id join order_items f on f.id = s.substitution_of join products fp on fp.id = f.product_id
                     where s.order_id = o.id and s.status = 'ok'),
    'totals', jsonb_build_object('subtotal_usd', o.subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'small_order_fee_usd', o.small_order_fee_usd,
                                 'credit_usd', v_credit, 'dues_usd', o.dues_usd + v_credit, 'total_usd', o.total_usd,
                                 'total_lbp', case when v_fx is null then null else round(o.total_usd * v_fx / 1000) * 1000 end),
    'handover_code', case when o.handover_verified_at is null and o.status in ('awaiting_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived')
                          then o.handover_code end,
    'card', case when o.status = 'awaiting_confirmation' then order_card(o.id, o.customer_id) end,
    'card_sent', (select r.outcome from web_card_requests r where r.order_id = o.id));
end $$;

-- ---------- history ----------
create or replace function web_orders(p_token text) returns jsonb language plpgsql stable security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  return jsonb_build_object('ok', true, 'orders', (select coalesce(jsonb_agg(x order by x.created_at desc, x.short_code desc), '[]'::jsonb) from (
    select o.id as order_id, o.short_code, o.status, o.channel, o.is_pickup as pickup, o.created_at, o.total_usd, o.cancel_reason,
           (select count(*) from order_items i where i.order_id = o.id and i.status = 'ok') as items,
           (select coalesce(jsonb_agg(jsonb_build_object('name_en', i.name_snapshot, 'name_ar', p.name_ar) order by i.id), '[]'::jsonb)
              from (select * from order_items where order_id = o.id and status = 'ok' order by id limit 3) i join products p on p.id = i.product_id) as names,
           case when order_ended_at(o.id) is null
                  or order_ended_at(o.id) >= now() - make_interval(hours => coalesce((setting('web')->>'order_link_after_end_hours')::int, 48))
                then order_link(o.id) end as link
      from orders o where o.customer_id = s.party_id and o.status <> 'draft'
     order by o.created_at desc limit 50) x));
end $$;

-- ---------- order again ----------
create or replace function web_order_again(p_token text, p_order uuid) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype; b jsonb; ln jsonb; v_sku text; v_added jsonb := '[]'::jsonb; v_missing jsonb := '[]'::jsonb; v_qty int;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  b := basket_from_order(s.party_id, p_order);
  if not coalesce((b->>'found')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar)), '[]'::jsonb) into v_missing
    from jsonb_array_elements(b->'missing') m join products p on p.id = (m->>'product_id')::uuid;
  for ln in select * from jsonb_array_elements(b->'lines') loop
    select sku into v_sku from products where id = (ln->>'product_id')::uuid;
    select coalesce(max(l.qty), 0) into v_qty from cart_lines l join products p on p.id = l.product_id
     where l.cart_id = web_cart_live(s.id) and p.sku = v_sku;
    perform cart_set_line(p_token, v_sku, greatest(v_qty, least(99, greatest(1, ceil((ln->>'qty')::numeric)::int))), null);
    v_added := v_added || to_jsonb(v_sku);
  end loop;
  return jsonb_build_object('ok', true, 'short_code', b->>'short_code', 'added', v_added, 'missing', v_missing);
end $$;

-- ---------- the account ----------
create or replace function web_account(p_token text) returns jsonb language plpgsql stable security definer as $$
declare s web_sessions%rowtype; m jsonb;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  m := customer_memory_view(s.party_id) - 'contact_phone' - 'places';
  return jsonb_build_object('ok', true, 'linked_at', s.linked_at, 'expires_at', s.expires_at,
    'sessions', (select count(*) from web_sessions w where w.party_id = s.party_id and w.revoked_at is null and w.expires_at > now()),
    'places', (select coalesce(jsonb_agg(jsonb_build_object('place_id', cp.id, 'label', cp.label, 'village', v.name_en, 'village_ar', v.name_ar,
                                                            'served', v.is_served, 'building', cp.building, 'floor', cp.floor, 'has_pin', cp.lat is not null)
                                         order by cp.last_used_at desc nulls last), '[]'::jsonb)
                 from customer_places cp left join villages v on v.id = cp.village_id where cp.party_id = s.party_id),
    'memory', m);
end $$;

create or replace function web_memory_forget(p_token text) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  return forget_customer_memory(s.party_id);
end $$;

create or replace function web_memory_pref(p_token text, p_remember boolean) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  return set_memory_pref(s.party_id, coalesce(p_remember, true));
end $$;

create or replace function web_sign_out_everywhere(p_token text) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return web_session_end(p_token) || jsonb_build_object('ended', 1); end if;
  return jsonb_build_object('ok', true, 'ended', web_sessions_revoke(s.party_id, 'sign_out_everywhere'));
end $$;

-- ---------- the checkout's place ----------
create or replace function web_save_pin(p_token text, p_lat double precision, p_lng double precision) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype; r jsonb;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return jsonb_build_object('ok', false, 'error', 'bad_position');
  end if;
  r := save_customer_pin(s.party_id, p_lat, p_lng, null);
  return jsonb_build_object('ok', true) || (r - 'km' - 'said_village_id' - 'said_village_ar')
      || jsonb_build_object('fee_usd', (select z.delivery_fee_usd from villages v join zones z on z.id = v.zone_id where v.id = (r->>'village_id')::uuid and z.is_active),
                            'eta_minutes', (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = (r->>'village_id')::uuid and z.is_active));
end $$;

create or replace function web_pin_village(p_token text, p_place uuid, p_village uuid) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  return set_pin_village(s.party_id, p_place, p_village);
end $$;

create or replace function web_place_details(p_token text, p_place uuid, p_building text default null, p_floor text default null, p_directions text default null)
returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_linked'); end if;
  return jsonb_build_object('ok', set_place_details(s.party_id, p_place, left(p_building, 120), left(p_floor, 40), p_directions));
end $$;

create or replace function web_windows(p_token text, p_village uuid, p_fresh boolean default false) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  return coalesce(open_delivery_windows(p_village, coalesce(p_fresh, false)), '[]'::jsonb);
end $$;

-- ---------- what the pages say about the service: all of it from settings ----------
create or replace function web_service_facts() returns jsonb language sql stable security definer as $$
  select jsonb_build_object(
    'hours', jsonb_build_object('open', setting('hours')->>'open', 'close', setting('hours')->>'close', 'tz', setting('hours')->>'tz'),
    'open_now', service_info()->'open_now',
    'served', (select coalesce(jsonb_agg(jsonb_build_object('village_id', vi.id, 'name_en', vi.name_en, 'name_ar', vi.name_ar, 'fee_usd', z.delivery_fee_usd,
                                                            'eta_minutes', z.base_eta_minutes) order by z.base_eta_minutes, vi.name_en), '[]'::jsonb)
                 from villages vi join zones z on z.id = vi.zone_id where vi.is_served and z.is_active),
    'session_days', coalesce((setting('web')->>'session_days')::int, 90),
    'link_code_minutes', coalesce((setting('web')->>'link_code_minutes')::int, 10),
    'min_order_usd', (setting('min_order_usd'))::text::numeric,
    'small_order_fee', jsonb_build_object('below_subtotal_usd', coalesce((setting('small_order_fee')->>'below_subtotal_usd')::numeric, 0),
                                          'fee_usd', coalesce((setting('small_order_fee')->>'fee_usd')::numeric, 0)),
    'fx_rate_lbp', current_fx(),
    'payments', jsonb_build_array('cod_usd', 'cod_lbp', 'whish', 'omt'),
    'first_order_max_cod_usd', coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0),
    'notes_usd', coalesce(setting('card_choices')->'notes_usd', '[]'::jsonb),
    'lbp_steps', coalesce(setting('card_choices')->'lbp_steps', '[]'::jsonb),
    'confirm_reminder_min', coalesce((setting('timers')->>'confirm_reminder_min')::int, 20),
    'confirm_lapse_min', coalesce((setting('timers')->>'awaiting_confirmation_min')::int, 60),
    'pickup', coalesce((setting('pickup')->>'enabled')::boolean, false),
    'whatsapp', nullif(regexp_replace(coalesce(setting('catalog')->>'product_link', ''), '\?.*$', ''), '')) $$;

create or replace function web_cart_count(p_token text) returns int language plpgsql stable security definer as $$
declare s web_sessions%rowtype;
begin
  begin s := web_session_of(p_token);
  exception when raise_exception then return 0; end;
  return coalesce((select sum(qty) from cart_lines where cart_id = web_cart_live(s.id)), 0)::int;
end $$;
