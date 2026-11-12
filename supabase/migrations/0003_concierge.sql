-- Alo King Chouf: what the Concierge tools and the conversation worker call.
-- Same rule as 0002: the logic lives here, the TypeScript tools are thin wrappers.

create unique index if not exists product_aliases_once on product_aliases(product_id, alias, lang);
create sequence if not exists order_code_seq start 1001;

-- Fold the Arabic spellings people mix freely, and lowercase Latin. Used on both sides of every match.
create or replace function fold_text(p text) returns text language sql immutable as $$
  select lower(btrim(regexp_replace(translate(coalesce(p, ''), 'أإآىةؤئ', 'اااايهوي'), '[ً-ْـ]', '', 'g')))
$$;

-- ---------- identity and conversation ----------
create or replace function touch_conversation(p_line wa_line, p_wa_user_id text, p_phone text, p_name text default null)
returns jsonb language plpgsql as $$
declare v_party uuid; v_conv conversations%rowtype; v_new boolean := false;
begin
  select party_id into v_party from party_identities
   where line = p_line and ((p_wa_user_id is not null and wa_user_id = p_wa_user_id) or (p_phone is not null and phone_e164 = p_phone))
   order by (wa_user_id = p_wa_user_id) desc nulls last limit 1;
  if v_party is null then
    if p_line = 'ops' then return jsonb_build_object('known', false); end if;   -- staff are onboarded, never auto-created
    insert into parties(role, display_name) values ('customer', p_name) returning id into v_party;
    insert into party_identities(party_id, line, wa_user_id, phone_e164) values (v_party, p_line, p_wa_user_id, p_phone);
    v_new := true;
  else
    update party_identities set wa_user_id = coalesce(wa_user_id, p_wa_user_id), phone_e164 = coalesce(phone_e164, p_phone)
     where party_id = v_party and line = p_line;
  end if;
  insert into conversations(line, party_id, last_inbound_at) values (p_line, v_party, now())
    on conflict (line, party_id) do update set last_inbound_at = now(), updated_at = now()
    returning * into v_conv;
  return jsonb_build_object('known', true, 'is_new', v_new, 'party_id', v_party, 'conversation_id', v_conv.id,
    'human_handoff', v_conv.human_handoff, 'active_order_id', v_conv.active_order_id,
    'blocked', (select is_blocked from parties where id = v_party),
    'role', (select role from parties where id = v_party));
end $$;

create or replace function record_consent_signal(p_party uuid, p_line wa_line, p_action consent_action, p_source text, p_wamid text default null)
returns void language plpgsql as $$
begin
  insert into consent_events(party_id, line, kind, action, source, evidence_message_id)
    values (p_party, p_line, 'marketing', p_action, p_source, p_wamid);
  -- STOP silences order updates too. A plain START restores marketing only: order updates return with the next order.
  if p_action = 'opt_out' then
    insert into consent_events(party_id, line, kind, action, source, evidence_message_id)
      values (p_party, p_line, 'transactional', 'opt_out', p_source, p_wamid);
  end if;
end $$;

-- ---------- catalog search ----------
create or replace function search_catalog(p_query text, p_source_hint text default null, p_limit int default 6)
returns jsonb language plpgsql stable as $$
declare q text := fold_text(p_query); v_sources uuid[]; v_matches jsonb;
begin
  if p_source_hint is not null and btrim(p_source_hint) <> '' then
    select array_agg(id) into v_sources from sources
     where kind = 'merchant' and similarity(fold_text(name), fold_text(p_source_hint)) > 0.35;
    if v_sources is null then
      return jsonb_build_object('matches', '[]'::jsonb, 'reason', 'merchant_not_onboarded', 'source_hint', p_source_hint);
    end if;
  end if;

  with scored as (
    select p.id, greatest(
             similarity(fold_text(coalesce(p.name_en, '') || ' ' || coalesce(p.brand, '')), q),
             similarity(fold_text(p.name_ar), q),
             coalesce((select max(greatest(similarity(fold_text(a.alias), q), word_similarity(fold_text(a.alias), q) * 0.9))
                       from product_aliases a where a.product_id = p.id), 0)) as score
    from products p where p.is_active
  ), ranked as (
    select p.id as product_id, p.sku, p.name_en, p.name_ar, p.brand, p.sell_unit, p.velocity_tier,
           s.id as source_id, s.name as source_name, s.kind as source_kind, o.price_usd, o.sponsored_rank,
           case when s.kind = 'dark_store' then coalesce(l.on_hand - l.reserved, 0)
                when o.is_available and s.is_open then 999 else 0 end as available,
           sc.score
    from scored sc join products p on p.id = sc.id
    join offers o on o.product_id = p.id
    join sources s on s.id = o.source_id
    left join stock_levels l on l.product_id = p.id and l.source_id = s.id
    where sc.score >= 0.5 and (v_sources is null or s.id = any(v_sources))
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc, (r.available > 0) desc, r.sponsored_rank nulls last, r.velocity_tier nulls last), '[]'::jsonb)
    into v_matches
  from (select * from ranked order by score desc, (available > 0) desc, sponsored_rank nulls last, velocity_tier nulls last limit p_limit) r;

  return jsonb_build_object('matches', v_matches,
    'reason', case when jsonb_array_length(v_matches) = 0 then 'no_match' else null end);
end $$;

-- ---------- places ----------
create or replace function resolve_place(p_party uuid, p_village text default null, p_landmark text default null)
returns jsonb language plpgsql stable as $$
declare qv text := fold_text(p_village); ql text := fold_text(p_landmark); v jsonb; l jsonb; saved jsonb; v_id uuid;
begin
  select coalesce(jsonb_agg(jsonb_build_object('place_id', cp.id, 'label', cp.label, 'village_id', cp.village_id,
           'village', vv.name_en, 'building', cp.building, 'floor', cp.floor, 'verified', cp.verified_by_driver,
           'delivery_count', cp.delivery_count) order by cp.last_used_at desc nulls last), '[]'::jsonb)
    into saved from customer_places cp left join villages vv on vv.id = cp.village_id where cp.party_id = p_party;

  if qv <> '' then
    select to_jsonb(x) into v from (
      select vi.id as village_id, vi.name_en, vi.name_ar, vi.is_served, z.name as zone, z.delivery_fee_usd, z.base_eta_minutes,
             round(greatest(similarity(fold_text(vi.name_en), qv), similarity(fold_text(vi.name_ar), qv),
                   similarity(regexp_replace(fold_text(vi.name_ar), '^ال', ''), regexp_replace(qv, '^ال', '')),
                   coalesce((select max(similarity(fold_text(a), qv)) from unnest(vi.aliases) a), 0))::numeric, 2) as confidence
      from villages vi left join zones z on z.id = vi.zone_id
      order by 8 desc limit 1) x;
    if (v->>'confidence')::numeric < 0.45 then v := null; end if;
  end if;
  v_id := (v->>'village_id')::uuid;

  if ql <> '' then
    select to_jsonb(x) into l from (
      select lm.id as landmark_id, lm.name, lm.village_id, lm.lat, lm.lng, lm.confidence as data_confidence,
             round(greatest(similarity(fold_text(lm.name), ql),
                   coalesce((select max(similarity(fold_text(la.alias), ql)) from landmark_aliases la where la.landmark_id = lm.id), 0))::numeric, 2) as confidence
      from landmarks lm where v_id is null or lm.village_id = v_id
      order by 7 desc limit 1) x;
    if (l->>'confidence')::numeric < 0.45 then l := null; end if;
  end if;

  return jsonb_build_object('village', v, 'landmark', l, 'saved_places', saved,
    'served', coalesce((v->>'is_served')::boolean, false),
    'needs_pin', (l is null and not exists (select 1 from customer_places cp where cp.party_id = p_party
                                             and cp.village_id = v_id and cp.lat is not null)),
    'reason', case when qv <> '' and v is null then 'village_not_recognised'
                   when v is not null and not (v->>'is_served')::boolean then 'village_not_served' else null end);
end $$;

create or replace function save_customer_pin(p_party uuid, p_lat double precision, p_lng double precision, p_village uuid default null)
returns jsonb language plpgsql as $$
declare v_village uuid := p_village; v_place uuid; v_km numeric;
begin
  if v_village is null then   -- nearest village that has coordinates, within 6 km
    select id, km into v_village, v_km from (
      select id, 6371 * 2 * asin(sqrt(power(sin(radians(lat - p_lat) / 2), 2)
               + cos(radians(p_lat)) * cos(radians(lat)) * power(sin(radians(lng - p_lng) / 2), 2))) as km
      from villages where lat is not null) d
    where km <= 6 order by km limit 1;
  end if;
  insert into customer_places(party_id, village_id, lat, lng, last_used_at) values (p_party, v_village, p_lat, p_lng, now())
    returning id into v_place;
  return jsonb_build_object('place_id', v_place, 'village_id', v_village,
    'village', (select name_en from villages where id = v_village));
end $$;

-- ---------- quote ----------
create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false)
returns jsonb language plpgsql stable as $$
declare ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric := 0; v_eta int;
        v_fx numeric := current_fx(); v_hours jsonb := setting('hours'); v_now time; v_min numeric := (setting('min_order_usd'))::text::numeric;
        o record; v_free numeric; v_qty numeric; v_ok boolean; v_subs jsonb; v_served boolean;
begin
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((ln->>'qty')::numeric, 1);
    select p.id, p.sku, p.name_en, p.name_ar, p.category, p.sub_type, p.sell_unit, ofr.price_usd, ofr.is_available,
           s.id as source_id, s.name as source_name, s.kind, s.is_open,
           coalesce(l.on_hand - l.reserved, 0) as free
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
    v_free := case when o.kind = 'dark_store' then o.free when o.is_available and o.is_open then 999 else 0 end;
    v_ok := v_free >= v_qty;
    v_subs := '[]'::jsonb;
    if not v_ok then
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_subs from (
        select p2.id as product_id, p2.name_en, p2.name_ar, p2.brand, o2.price_usd
        from products p2 join offers o2 on o2.product_id = p2.id and o2.source_id = o.source_id
        join stock_levels l2 on l2.product_id = p2.id and l2.source_id = o.source_id
        where p2.id <> o.id and p2.is_active and p2.category = o.category and p2.sub_type is not distinct from o.sub_type
          and l2.on_hand - l2.reserved >= v_qty
        order by p2.velocity_tier nulls last, o2.price_usd limit 3) x;
      v_issues := v_issues || jsonb_build_object('code', case when v_free > 0 then 'insufficient_stock' else 'out_of_stock' end,
                    'product_id', o.id, 'name', o.name_en, 'available', v_free, 'substitutes', v_subs);
    else
      v_sub := v_sub + round(o.price_usd * v_qty, 2);
    end if;
    v_lines := v_lines || jsonb_build_object('product_id', o.id, 'sku', o.sku, 'name', o.name_en, 'name_ar', o.name_ar,
                 'qty', v_qty, 'unit', o.sell_unit, 'unit_price_usd', o.price_usd, 'line_total_usd', round(o.price_usd * v_qty, 2),
                 'source_id', o.source_id, 'source', o.source_name, 'ok', v_ok,
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

  if v_sub > 0 and v_sub < v_min then
    v_issues := v_issues || jsonb_build_object('code', 'below_minimum', 'minimum_usd', v_min, 'subtotal_usd', v_sub);
  end if;
  v_now := (now() at time zone coalesce(v_hours->>'tz', 'Asia/Beirut'))::time;
  if v_now < (v_hours->>'open')::time or v_now >= (v_hours->>'close')::time then
    v_issues := v_issues || jsonb_build_object('code', 'closed', 'opens', v_hours->>'open', 'closes', v_hours->>'close');
  end if;
  if v_fx is null then v_issues := v_issues || jsonb_build_object('code', 'no_exchange_rate'); end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'lines', v_lines,
    'subtotal_usd', v_sub, 'delivery_fee_usd', v_fee, 'total_usd', v_sub + v_fee,
    'fx_rate_lbp', v_fx, 'total_lbp', case when v_fx is null then null else round((v_sub + v_fee) * v_fx / 1000) * 1000 end,
    'eta_minutes', case when p_pickup then null else v_eta end, 'pickup', p_pickup, 'village_id', p_village,
    'village', (select name_en from villages where id = p_village),
    'village_ar', (select name_ar from villages where id = p_village));
end $$;

-- ---------- draft order -> awaiting_confirmation ----------
create or replace function create_order_from_quote(
  p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null
) returns jsonb language plpgsql as $$
declare q jsonb := quote_order(p_lines, p_village, p_pickup); v_order uuid; v_code text; ln jsonb; v_ful uuid; v_stale uuid;
begin
  if not (q->>'ok')::boolean then
    return jsonb_build_object('created', false, 'quote', q);     -- the caller shows the issues; nothing is written
  end if;
  -- one open proposal per conversation: an older unconfirmed card is withdrawn
  for v_stale in select id from orders where conversation_id = p_conversation and status = 'awaiting_confirmation' loop
    perform transition_order(v_stale, 'cancelled', 'system', null, 'superseded_by_new_card');
  end loop;

  v_code := 'AK-' || nextval('order_code_seq');
  insert into orders(short_code, customer_id, conversation_id, village_id, place_id, is_pickup, subtotal_usd, delivery_fee_usd,
                     payment_method, change_for_usd, customer_notes)
    values (v_code, p_customer, p_conversation, p_village, p_place, p_pickup, (q->>'subtotal_usd')::numeric,
            (q->>'delivery_fee_usd')::numeric, p_payment, p_change_for, p_notes)
    returning id into v_order;
  for ln in select * from jsonb_array_elements(q->'lines') loop
    insert into fulfilments(order_id, source_id) values (v_order, (ln->>'source_id')::uuid)
      on conflict (order_id, source_id) do update set source_id = excluded.source_id returning id into v_ful;
    update fulfilments set subtotal_usd = subtotal_usd + (ln->>'line_total_usd')::numeric where id = v_ful;
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note)
      values (v_order, v_ful, (ln->>'product_id')::uuid, ln->>'name', (ln->>'qty')::numeric, (ln->>'unit_price_usd')::numeric,
              coalesce(ln->'modifiers', '[]'::jsonb), ln->>'note');
  end loop;
  perform transition_order(v_order, 'awaiting_confirmation', 'agent');
  update conversations set active_order_id = v_order, updated_at = now() where id = p_conversation;
  return jsonb_build_object('created', true, 'order_id', v_order, 'short_code', v_code, 'payment_method', p_payment,
                            'change_for_usd', p_change_for, 'quote', q);
end $$;

-- ---------- the buttons on the order card. No model is involved. ----------
create or replace function handle_order_button(p_order uuid, p_action text, p_party uuid, p_wamid text default null)
returns jsonb language plpgsql as $$
declare o orders%rowtype; v_to order_status;
begin
  select * into o from orders where id = p_order;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if p_action = 'confirm' then
    if o.status <> 'awaiting_confirmation' then
      return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', false);
    end if;
    -- The card states that confirming means agreeing to order updates on this chat. The tap is the opt-in.
    insert into consent_events(party_id, line, kind, action, source, wording, evidence_message_id)
      values (p_party, 'customer', 'transactional', 'opt_in', 'order_card_confirm',
              'بتأكيد الطلب بتوافق نبعتلك تحديثات طلباتك على هالمحادثة', p_wamid);
    v_to := case when o.payment_method = 'cod' then 'confirmed' else 'awaiting_payment' end;
    perform transition_order(p_order, v_to, 'customer', p_party, 'card_confirm', jsonb_build_object('wamid', p_wamid));
  elsif p_action = 'edit' then
    if o.status = 'awaiting_confirmation' then perform transition_order(p_order, 'draft', 'customer', p_party, 'card_edit'); end if;
  elsif p_action = 'cancel' then
    perform transition_order(p_order, 'cancelled', 'customer', p_party, 'card_cancel');
  else
    raise exception 'UNKNOWN_ACTION %', p_action;
  end if;
  select * into o from orders where id = p_order;
  return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', true, 'payment_method', o.payment_method,
                            'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp);
end $$;

-- ---------- travel time with a fallback through the hub ----------
-- Direct pair in either direction first; otherwise the cheapest route through one intermediate village (in practice a hub).
create or replace function travel_minutes(p_from uuid, p_to uuid) returns numeric language sql stable as $$
  with sym as (
    select from_village as a, to_village as b, minutes from travel_times
    union all select to_village, from_village, minutes from travel_times)
  select case when p_from = p_to then 0 else coalesce(
    (select min(minutes) from sym where a = p_from and b = p_to),
    (select min(x.minutes + y.minutes) from sym x join sym y on y.a = x.b where x.a = p_from and y.b = p_to)) end
$$;

-- ---------- consent ordering ----------
-- Two consent events can land in one transaction. Order by wall clock, and let an opt-out win an exact tie.
alter table consent_events alter column created_at set default clock_timestamp();
create or replace view consent_current as
  select distinct on (party_id, line, kind) party_id, line, kind, action, source, created_at
  from consent_events order by party_id, line, kind, created_at desc, (action = 'opt_out') desc;
