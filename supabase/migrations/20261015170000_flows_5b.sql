-- Session 5b (DECISIONS §12, §38.3, §39.8): three more WhatsApp Flows on the company number, all switched off until each is
-- published there (config flows_enabled), validated with Flowso in CI.
--   - address_capture gains the landmark (a list of the known landmarks around the pin, "where from it", or a typed one)
--     and the lift, which feed addresses.landmark_id / landmark_relation / has_elevator (§38.3) and the stairs fee;
--   - checkout: delivery or pickup, the cash currency, the missing-item preference at groceries and a note, on one
--     screen over the server's priced basket; the Confirm tap after it still places the order (prices re-checked);
--   - menu_section: a merchant confirms a draft menu section, unticking what is not theirs; prices are exactly as read.
-- The merchant profile Flow (merchant_claim, also opened by "settings") is unchanged: it already offers 12, 15 and 20 km.
-- flow_open and flow_submit keep their contract: the 7 October bodies become app_private.*_base and these wrappers add
-- the new Flows and the landmark fields around them.

insert into public.app_config (key, value, effective_from, note, created_by) values
  ('flows_enabled', '{"address_capture": false, "item_options": false, "merchant_claim": false, "merchant_hours": false, "checkout": false, "menu_section": false}',
   now(), 'Per Flow: send it once it is published on the sending number (§12, §39.8); checkout and menu_section added in 5b', null);

alter table public.flow_sends drop constraint flow_sends_flow_check;
alter table public.flow_sends add constraint flow_sends_flow_check
  check (flow in ('address_capture', 'item_options', 'merchant_claim', 'merchant_hours', 'checkout', 'menu_section'));

alter function public.flow_open(text, text, text, uuid, uuid, jsonb) rename to flow_open_base;
alter function public.flow_open_base(text, text, text, uuid, uuid, jsonb) set schema app_private;
alter function public.flow_submit(text, text, jsonb) rename to flow_submit_base;
alter function public.flow_submit_base(text, text, jsonb) set schema app_private;
revoke all on function app_private.flow_open_base(text, text, text, uuid, uuid, jsonb), app_private.flow_submit_base(text, text, jsonb)
  from public, anon, authenticated;

-- The landmarks a customer can pick for an address: the 20 nearest shared or confirmed ones within 2 km of the pin, named
-- in the customer's language, then "not listed". Ids in the Flow are short keys (l1…), mapped back on submit.
create function app_private.flow_landmarks(p_address_id uuid, p_lang text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with near as (
    select l.id, coalesce(case when p_lang = 'ar' then l.name_ar end, l.name_en, l.name_ar) as name,
           row_number() over (order by extensions.st_distance(l.point, a.pin), l.id) as k
    from public.addresses a
    join public.landmarks l on a.pin is not null and extensions.st_dwithin(l.point, a.pin, 2000)
    where a.id = p_address_id and (l.shared or l.status = 'confirmed')
    order by extensions.st_distance(l.point, a.pin), l.id
    limit 20)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', 'l' || k, 'title', left(name, 30)) order by k) from near), '[]')
             || jsonb_build_array(jsonb_build_object('id', 'none', 'title', case when p_lang = 'ar' then 'مش بالليستة' else 'Not listed' end)),
    'map', coalesce((select jsonb_object_agg('l' || k, id) from near), '{}'));
$$;

create function public.flow_open(p_flow text, p_lang text, p_phone text, p_customer_id uuid default null,
  p_member_id uuid default null, p_context jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := p_flow || ':' || encode(extensions.gen_random_bytes(16), 'hex');
  v_lang text := case when p_lang = 'ar' then 'ar' else 'en' end;
  v_r jsonb;
  v_lm jsonb;
  v_q jsonb;
  v_b public.baskets%rowtype;
  v_v public.vendors%rowtype;
  v_opts jsonb := '[]';
  v_member public.vendor_members%rowtype;
  v_d public.menu_drafts%rowtype;
  v_sec jsonb;
  v_items jsonb := '[]';
  v_keys jsonb := '[]';
  v_i int := 0;
  it jsonb;
begin
  if p_flow not in ('checkout', 'menu_section') then
    v_r := app_private.flow_open_base(p_flow, p_lang, p_phone, p_customer_id, p_member_id, p_context);
    if p_flow = 'address_capture' and v_r ->> 'status' = 'ok' then
      v_lm := app_private.flow_landmarks((v_r -> 'data' ->> 'address_id')::uuid, v_lang);
      update public.flow_sends set context = context || jsonb_build_object('landmarks', v_lm -> 'map') where token = v_r ->> 'token';
      v_r := jsonb_set(v_r, '{data,landmarks}', v_lm -> 'items');
    end if;
    return v_r;
  end if;
  if not app_private.flow_enabled(p_flow) then
    return jsonb_build_object('status', 'off');
  end if;
  if p_flow = 'checkout' then
    -- The customer's own open basket, priced by the server now; the Flow shows it, it never sets a price.
    select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open'
      and id = coalesce((p_context ->> 'basket_id')::uuid, id);
    if v_b.id is null then
      return jsonb_build_object('status', 'no_basket');
    end if;
    v_q := public.basket_quote(p_customer_id);
    if v_q ->> 'status' <> 'ok' then
      return jsonb_build_object('status', 'not_ready', 'reason', v_q ->> 'status');
    end if;
    select * into v_v from public.vendors where id = v_b.vendor_id;
    if v_v.delivery_enabled then
      v_opts := v_opts || jsonb_build_array(jsonb_build_object('id', 'delivery', 'title', case when v_lang = 'ar' then 'توصيل' else 'Delivery' end));
    end if;
    if v_v.pickup_enabled then
      v_opts := v_opts || jsonb_build_array(jsonb_build_object('id', 'pickup', 'title', case when v_lang = 'ar' then 'استلام من المحل' else 'Pickup at the shop' end));
    end if;
    insert into public.flow_sends (token, flow, lang, phone_e164, customer_id, vendor_id, context)
    values (v_token, p_flow, v_lang, p_phone, p_customer_id, v_v.id,
      jsonb_build_object('basket_id', v_b.id, 'version', v_b.priced_menu_version, 'fulfilments', (select jsonb_agg(x ->> 'id') from jsonb_array_elements(v_opts) x)));
    return jsonb_build_object('status', 'ok', 'token', v_token, 'flow', p_flow, 'lang', v_lang, 'screen', 'CHECKOUT', 'data', jsonb_build_object(
      'basket_id', v_b.id, 'version', coalesce(v_b.priced_menu_version, 0)::text,
      'vendor', left(coalesce(case when v_lang = 'ar' then v_v.name_ar end, v_v.name_en, v_v.name_ar), 60),
      'lines', left((select string_agg(format('%s × %s  $%s', l ->> 'quantity',
                     case when v_lang = 'ar' then l ->> 'name' else coalesce(l ->> 'name_en', l ->> 'name') end,
                     to_char((l ->> 'line_total_usd')::numeric, 'FM999990.00')), E'\n')
                   from jsonb_array_elements(v_q -> 'basket' -> 'lines') l), 1000),
      -- Both currencies at today's rate; the order locks the rate when it is placed (§13).
      'total', format('$%s = %s LBP', to_char((v_q ->> 'total_usd')::numeric, 'FM999990.00'),
                 to_char(round((v_q ->> 'total_usd')::numeric * (v_q ->> 'usd_lbp_rate')::numeric), 'FM999,999,999,990')),
      'fulfilment_options', v_opts,
      'fulfilment', coalesce(v_b.fulfilment::text, v_opts -> 0 ->> 'id'),
      'cash', coalesce(v_b.cash_currency, 'USD'),
      'show_sub', v_v.business_type::text in ('grocery_supermarket', 'minimarket', 'produce', 'butcher', 'poultry', 'fish_market', 'home_essentials')));
  end if;
  -- menu_section: an owner or manager of the draft's branch confirms one section.
  select * into v_member from public.vendor_members where id = p_member_id and phone_e164 = p_phone and status = 'active'
    and role in ('owner', 'manager');
  select * into v_d from public.menu_drafts where id = (p_context ->> 'draft_id')::uuid;
  if v_member.id is null or v_d.id is null or v_d.vendor_id <> v_member.vendor_id then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  v_sec := v_d.sections -> ((p_context ->> 'index')::int);
  if v_sec is null or coalesce((v_sec ->> 'approved')::boolean, false) then
    return jsonb_build_object('status', 'unknown_section');
  end if;
  for it in select * from jsonb_array_elements(v_sec -> 'items') loop
    v_i := v_i + 1;
    exit when v_i > 20; -- Meta's checkbox limit; a longer section uses the chat cards
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'i' || v_i,
      'title', left(coalesce(case when v_lang = 'ar' then it ->> 'name_ar' end, it ->> 'name_en', it ->> 'name_ar', it ->> 'name_fr', '?'), 30),
      'description', case when it ->> 'price' is not null then
        coalesce(it ->> 'currency', '') || ' ' || (it ->> 'price') else case when v_lang = 'ar' then 'بلا سعر' else 'no price' end end)));
    v_keys := v_keys || to_jsonb('i' || v_i);
  end loop;
  if v_i = 0 or v_i > 20 then
    return jsonb_build_object('status', 'unsuited');
  end if;
  insert into public.flow_sends (token, flow, lang, phone_e164, vendor_id, member_id, context)
  values (v_token, p_flow, v_lang, p_phone, v_member.vendor_id, v_member.id,
    jsonb_build_object('draft_id', v_d.id, 'index', (p_context ->> 'index')::int, 'count', v_i));
  return jsonb_build_object('status', 'ok', 'token', v_token, 'flow', p_flow, 'lang', v_lang, 'screen', 'SECTION', 'data', jsonb_build_object(
    'draft_id', v_d.id, 'section_key', 's' || (p_context ->> 'index'),
    'section_name', left(coalesce(case when v_lang = 'ar' then v_sec ->> 'name_ar' end, v_sec ->> 'name_en', v_sec ->> 'name_ar', '-'), 60),
    'items', v_items, 'all_items', v_keys));
end;
$$;

create function public.flow_submit(p_phone text, p_token text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.flow_sends%rowtype;
  v_r jsonb;
  v_lm uuid;
  v_rel text;
  v_keep int[];
  v_sec jsonb;
  v_n int;
begin
  select * into v_s from public.flow_sends where token = p_token;
  if v_s.token is null or v_s.flow not in ('checkout', 'menu_section') then
    v_r := app_private.flow_submit_base(p_phone, p_token, p_payload);
    -- The landmark and the lift (§38.3), only once the base saved the address for this person.
    if v_s.flow = 'address_capture' and v_r ->> 'status' not in ('rejected', 'unknown', 'duplicate') then
      v_lm := (v_s.context -> 'landmarks' ->> (p_payload ->> 'landmark_id'))::uuid;
      v_rel := case when v_lm is not null and p_payload ->> 'landmark_relation' in ('at', 'next_to', 'opposite', 'behind', 'above', 'below', 'near', 'after', 'before')
                    then p_payload ->> 'landmark_relation' end;
      update public.addresses set
        landmark_id = coalesce(v_lm, landmark_id),
        landmark_relation = case when v_lm is not null then v_rel::public.landmark_relation else landmark_relation end,
        has_elevator = case p_payload ->> 'has_elevator' when 'yes' then true when 'no' then false else has_elevator end
      where id = (v_s.context ->> 'address_id')::uuid and customer_id = v_s.customer_id;
    end if;
    return v_r;
  end if;
  perform 1 from public.flow_sends where token = p_token for update;
  select * into v_s from public.flow_sends where token = p_token;
  if v_s.phone_e164 <> p_phone then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_s.submitted_at is not null then
    return coalesce((select f.result || jsonb_build_object('status', 'duplicate', 'flow', f.flow, 'lang', v_s.lang)
                     from public.flow_submissions f where f.token = p_token),
      jsonb_build_object('status', 'duplicate', 'flow', v_s.flow, 'lang', v_s.lang));
  end if;
  update public.flow_sends set submitted_at = now() where token = p_token;
  p_payload := coalesce(p_payload, '{}');
  if v_s.sent_at < now() - make_interval(mins => coalesce(public.config_numeric('flow_token_ttl_min'), 1440)::int) then
    v_r := jsonb_build_object('status', 'rejected', 'reason', 'expired');
  elsif v_s.flow = 'checkout' then
    if (p_payload ->> 'basket_id') is distinct from (v_s.context ->> 'basket_id') then
      v_r := jsonb_build_object('status', 'rejected', 'reason', 'basket mismatch');
    elsif not coalesce((v_s.context -> 'fulfilments') ? (p_payload ->> 'fulfilment'), false)
          or coalesce(p_payload ->> 'cash', '') not in ('USD', 'LBP') then
      v_r := jsonb_build_object('status', 'rejected', 'reason', 'choices');
    else
      -- The same setters the chat buttons use; the summary with the Confirm button follows (re-priced, §30.1.1).
      perform public.basket_set_checkout(v_s.customer_id, (p_payload ->> 'fulfilment')::public.fulfilment_kind, null, null,
        left(nullif(trim(p_payload ->> 'note'), ''), 200));
      perform public.basket_set_cash_currency(v_s.customer_id, p_payload ->> 'cash');
      if p_payload ->> 'sub_pref' in ('call', 'replace', 'remove') then
        perform public.basket_set_substitution(v_s.customer_id, p_payload ->> 'sub_pref');
      end if;
      v_r := jsonb_build_object('status', 'saved', 'fulfilment', p_payload ->> 'fulfilment');
    end if;
  else
    -- menu_section: the kept items by their short keys; at least one; prices untouched.
    v_keep := array(select substr(x, 2)::int from jsonb_array_elements_text(
      case when jsonb_typeof(p_payload -> 'keep') = 'array' then p_payload -> 'keep' else '[]' end) x
      where x ~ '^i[0-9]{1,2}$' and substr(x, 2)::int between 1 and (v_s.context ->> 'count')::int);
    if (p_payload ->> 'draft_id') is distinct from (v_s.context ->> 'draft_id') or cardinality(v_keep) = 0 then
      v_r := jsonb_build_object('status', 'rejected', 'reason', 'nothing kept');
    else
      select d.sections -> ((v_s.context ->> 'index')::int) into v_sec from public.menu_drafts d where d.id = (v_s.context ->> 'draft_id')::uuid
      for update;
      v_n := jsonb_array_length(v_sec -> 'items');
      update public.menu_drafts set sections = jsonb_set(sections, array[(v_s.context ->> 'index'), 'items'],
        (select coalesce(jsonb_agg(e order by o), '[]') from jsonb_array_elements(v_sec -> 'items') with ordinality t(e, o) where o = any (v_keep)))
      where id = (v_s.context ->> 'draft_id')::uuid;
      v_r := public.menu_draft_approve_section((v_s.context ->> 'draft_id')::uuid, (v_s.context ->> 'index')::int, v_s.member_id)
        || jsonb_build_object('left_out', v_n - cardinality(v_keep));
    end if;
  end if;
  v_r := coalesce(v_r, '{}');
  if v_s.vendor_id is not null then
    v_r := v_r || jsonb_build_object('vendor_id', v_s.vendor_id, 'member_id', v_s.member_id);
  end if;
  insert into public.flow_submissions (token, flow, payload, status, result)
  values (p_token, v_s.flow, p_payload, case when v_r ->> 'status' = 'rejected' then 'rejected' else 'applied' end, v_r);
  return jsonb_build_object('flow', v_s.flow, 'lang', v_s.lang) || v_r;
end;
$$;

revoke all on function app_private.flow_landmarks(uuid, text), public.flow_open(text, text, text, uuid, uuid, jsonb),
  public.flow_submit(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.flow_open(text, text, text, uuid, uuid, jsonb), public.flow_submit(text, text, jsonb) to service_role;
