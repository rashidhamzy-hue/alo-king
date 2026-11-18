-- Alo King Chouf, session FD2, migration 0251 of 0249 to 0251: the order API for food baskets on the website, so WEB4b can build the pages.
-- docs/DECISIONS.md, "FD2, 18 November 2026". No website page here. One backend (invariant 19): every function below calls the same SQL the chat
-- calls (places_for, place_menu, quote_order with the customer, create_order_for_turn), and the confirmation is the same as a web grocery
-- order (WEB2): the card goes to the customer's WhatsApp and the Confirm tap there confirms (invariant 4; settings.web.confirm_on_page false).
--
--   web_food_places(token)                      the places this visitor may order from: a signed-in tester sees testers-only places; an
--                                               anonymous visitor or anyone else sees public places only (none today). Never a phone.
--   web_food_menu(token, place)                 one place's approved menu: each dish with its price, section, option groups and its food facts
--                                               status (declared by the place, or not confirmed yet). A place this visitor may not order from:
--                                               not_on_alo_king, no dishes.
--   web_food_quote(token, place, lines, at)     a food basket priced for this visitor: lines [{product_id, qty, options: [ids]}], every line a
--                                               dish of that place (one shop per order: another shop's line is refused, one_shop); the
--                                               delivery address `at` (the visitor's saved place) gives the village. The quote says what is
--                                               still to choose (choice_required with the group and its options), place_closed, the fee.
--   web_food_order(token, key, at, place, lines, notes, lang)
--                                               the order, as a card waiting for the WhatsApp tap (web_card_requests): cash on delivery (food
--                                               is cash, 0249), the same request key never makes two orders.
-- Tester-only places never show on the public website: an anonymous visitor's reads are public-only, and nothing here lists listings.

create or replace function web_food_party(p_token text) returns uuid language plpgsql stable set search_path = public, pg_temp as $$
declare s web_sessions%rowtype;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;
  begin s := web_session_of(p_token); exception when others then return null; end;
  return s.party_id;
end $$;

create or replace function web_food_places(p_token text default null) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('source_id', p->>'source_id', 'name', p->>'name', 'village_en', p->>'village_en', 'village_ar', p->>'village_ar',
                                               'prep_minutes', (p->>'prep_minutes')::int, 'open', place_open_now((p->>'source_id')::uuid))
                            order by p->>'name'), '[]'::jsonb)
    from jsonb_array_elements(places_for(web_food_party(p_token))) p $$;

create or replace function web_food_menu(p_token text, p_place uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m jsonb := place_menu(web_food_party(p_token), p_place);
begin
  if not coalesce((m->>'ok')::boolean, false) then return m; end if;
  return m || jsonb_build_object('dishes', (select coalesce(jsonb_agg(d || jsonb_build_object('facts', dish_facts_status((d->>'product_id')::uuid))), '[]'::jsonb)
                                              from jsonb_array_elements(m->'dishes') d));
end $$;

create or replace function web_food_quote(p_token text, p_place uuid, p_lines jsonb, p_at uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_party uuid := web_food_party(p_token); v_village uuid; v_lines jsonb := '[]'::jsonb; ln jsonb;
begin
  if not place_orderable_for(p_place, v_party) then return jsonb_build_object('ok', false, 'error', 'not_on_alo_king'); end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then return jsonb_build_object('ok', false, 'error', 'empty_basket'); end if;
  if jsonb_array_length(p_lines) > 30 then return jsonb_build_object('ok', false, 'error', 'too_many_lines'); end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from products where id = nullif(ln->>'product_id', '')::uuid and owner_source_id = p_place) then
      return jsonb_build_object('ok', false, 'error', 'one_shop', 'product_id', ln->>'product_id');
    end if;
    v_lines := v_lines || jsonb_build_object('product_id', ln->>'product_id', 'source_id', p_place,
                 'qty', greatest(1, least(coalesce((ln->>'qty')::int, 1), 50)),
                 'options', case when jsonb_typeof(ln->'options') = 'array' then ln->'options' else '[]'::jsonb end);
  end loop;
  if p_at is not null then
    select village_id into v_village from customer_places where id = p_at and party_id = v_party;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_your_place'); end if;
  end if;
  return jsonb_build_object('ok', true, 'lines', v_lines, 'quote', quote_order(v_lines, v_village, false, null, v_party));
end $$;

create or replace function web_food_order(p_token text, p_request_key text, p_at uuid, p_place uuid, p_lines jsonb, p_notes text default null, p_lang text default 'ar')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s web_sessions%rowtype; q jsonb; v_conv uuid; v_key text; o orders%rowtype; r jsonb; v_order uuid;
        v_lang text := case when p_lang in ('ar', 'en', 'fr') then p_lang else 'ar' end;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('created', false, 'error', 'not_linked'); end if;
  if p_request_key is null or length(btrim(p_request_key)) < 8 then raise exception 'REQUEST_KEY_REQUIRED'; end if;
  if p_at is null then return jsonb_build_object('created', false, 'error', 'no_place'); end if;
  v_key := 'web:' || btrim(p_request_key);
  -- the same submit again after its card was confirmed: that order, never a second one
  select * into o from orders where turn_key = v_key and customer_id = s.party_id order by created_at desc limit 1;
  if found and o.status not in ('draft', 'awaiting_confirmation', 'cancelled') then
    return jsonb_build_object('created', true, 'reused', true, 'order_id', o.id, 'short_code', o.short_code, 'status', o.status);
  end if;
  q := web_food_quote(p_token, p_place, p_lines, p_at);
  if not coalesce((q->>'ok')::boolean, false) then return jsonb_build_object('created', false, 'error', q->>'error'); end if;
  if not coalesce((q->'quote'->>'ok')::boolean, false) then
    return jsonb_build_object('created', false, 'error', 'not_ready', 'quote', q->'quote', 'issues', q->'quote'->'issues');
  end if;
  select id into v_conv from conversations where party_id = s.party_id and line = 'customer';
  if v_conv is null then return jsonb_build_object('created', false, 'error', 'no_conversation'); end if;
  r := create_order_for_turn(v_key, s.party_id, v_conv, q->'lines', (select village_id from customer_places where id = p_at), p_at, false,
                             'cod', null, nullif(left(btrim(coalesce(p_notes, '')), 300), ''), null);
  if not coalesce((r->>'created')::boolean, false) then return r || jsonb_build_object('issues', coalesce(r->'quote'->'issues', '[]'::jsonb)); end if;
  v_order := (r->>'order_id')::uuid;
  update orders set channel = 'web' where id = v_order and channel <> 'web';
  if (select status from orders where id = v_order) = 'awaiting_confirmation' then
    insert into web_card_requests(order_id, session_id, lang) values (v_order, s.id, v_lang) on conflict (order_id) do nothing;
  end if;
  update web_sessions set last_seen_at = now() where id = s.id;
  return r || jsonb_build_object('status', (select status from orders where id = v_order), 'link', order_link(v_order), 'card', order_card(v_order, s.party_id));
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'web_channel') then
    grant execute on function web_food_places(text) to web_channel;
    grant execute on function web_food_menu(text, uuid) to web_channel;
    grant execute on function web_food_quote(text, uuid, jsonb, uuid) to web_channel;
    grant execute on function web_food_order(text, text, uuid, uuid, jsonb, text, text) to web_channel;
  end if;
end $$;
