-- Alo King Chouf: session B4, the lane B requests recorded in docs/HANDOFF.md.
--   * D1 (3.8): quote_order refuses while the exchange-rate pause is on. fx_quoting_paused() is D1's function; D1 wrote it in
--     apps/console/sql/proposed_functions.sql, which D2 moves into a migration (0045-0049) with the fx_pending table. Defined here
--     so quote_order can call it before that: it reads fx_pending only when the table exists, and says "not paused" otherwise.
--     D2's sql version may replace it unchanged in meaning (same name, no arguments, boolean). quote_order is 0052's text with
--     the one check added (the small-order fee lines stay: a tripwire test reads them).
--   * C2: learn_from_order counts each product the customer asked for once, from the lines that left the hub as asked.
--   * B3: the staging probe releases its own handoff. A probe conversation handed to a person stays with the person and every
--     hourly probe then goes nowhere (13 Nov, 12:36-17:20 UTC). probe_due() now gives it back to the Concierge when no probe order
--     is open, and opens one ops exception naming why it was handed off, so the alarm says what happened.
--   * settings.probe.fresh_place (default false): when true, each hourly probe order starts as a first-time customer (its saved
--     places are cleared), so the probe walks the whole first-order path: pin, address, card. Staging only (probes are).

create or replace function fx_quoting_paused() returns boolean language plpgsql stable as $$
declare v boolean;
begin
  if to_regclass('public.fx_pending') is null then return false; end if;
  execute 'select exists (select 1 from fx_pending where status = ''pending'')' into v;
  return coalesce(v, false);
end $$;

create or replace function quote_order(p_lines jsonb, p_village uuid default null, p_pickup boolean default false)
returns jsonb language plpgsql stable as $$
declare ln jsonb; v_lines jsonb := '[]'::jsonb; v_issues jsonb := '[]'::jsonb; v_sub numeric := 0; v_fee numeric := 0; v_eta int; v_small numeric := 0; v_sof jsonb := setting('small_order_fee');
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

  -- Small-order fee (1.16): company income on a small basket, its own line, never part of the rider's delivery fee.
  -- Off while either number is 0 (the default until the founder sets them).
  if coalesce((v_sof->>'fee_usd')::numeric, 0) > 0 and v_sub > 0 and v_sub < coalesce((v_sof->>'below_subtotal_usd')::numeric, 0) then
    v_small := round((v_sof->>'fee_usd')::numeric, 2);
  end if;
  if v_sub > 0 and v_sub < v_min then
    v_issues := v_issues || jsonb_build_object('code', 'below_minimum', 'minimum_usd', v_min, 'subtotal_usd', v_sub);
  end if;
  v_now := (now() at time zone coalesce(v_hours->>'tz', 'Asia/Beirut'))::time;
  if v_now < (v_hours->>'open')::time or v_now >= (v_hours->>'close')::time then
    v_issues := v_issues || jsonb_build_object('code', 'closed', 'opens', v_hours->>'open', 'closes', v_hours->>'close');
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
    'village_ar', (select name_ar from villages where id = p_village));
end $$;

create or replace function learn_from_order(p_order uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; L jsonb := setting('learning'); v_ready int := 0; v_fold text; v_on boolean;
begin
  select * into o from orders where id = p_order;
  if o.status not in ('delivered','closed') then return jsonb_build_object('learned', false); end if;
  if exists (select 1 from order_events where order_id = p_order and reason = 'learned') then return jsonb_build_object('learned', false, 'already', true); end if;
  v_on := memory_on(o.customer_id);
  -- C2's request (B4): only what left the hub as asked. Since 0031 an order holds lines that were removed or replaced at the
  -- shelf, a split line twice, and kept substitutes (substitution_of): none is what the customer wants next time, and the
  -- words they used named the product they asked for, not its substitute. Each product once, with its delivered quantity.
  for r in select i.product_id, sum(i.qty) as qty, min(i.raw_phrase) as raw_phrase, p.sub_type, p.brand, p.name_en
             from order_items i join products p on p.id = i.product_id
            where i.order_id = p_order and i.status = 'ok' and i.substitution_of is null
            group by i.product_id, p.sub_type, p.brand, p.name_en loop
    if v_on then
      insert into customer_memory(party_id, kind, key, value, origin) values (o.customer_id, 'usual_item', r.product_id::text, jsonb_build_object('name', r.name_en, 'last_qty', r.qty), 'observed')
        on conflict (party_id, kind, key) do update set weight = customer_memory.weight + 1, value = excluded.value, updated_at = now();
      if r.sub_type is not null and r.brand is not null then
        insert into customer_memory(party_id, kind, key, value, origin) values (o.customer_id, 'brand_pref', r.sub_type, jsonb_build_object('brand', r.brand, 'product_id', r.product_id), 'observed')
          on conflict (party_id, kind, key) do update set weight = customer_memory.weight + 1, value = excluded.value, updated_at = now();
      end if;
      -- The words people use are evidence for a person to review. They no longer go live by themselves.
      v_fold := fold_text(coalesce(r.raw_phrase, ''));
      if length(v_fold) between 3 and 40 and not exists (select 1 from product_aliases a where a.product_id = r.product_id and a.alias_folded = v_fold) then
        insert into alias_candidates(alias_folded, product_id, alias, customers) values (v_fold, r.product_id, r.raw_phrase, array[o.customer_id])
          on conflict (alias_folded, product_id) do update set hits = alias_candidates.hits + 1, updated_at = now(),
            customers = case when o.customer_id = any(alias_candidates.customers) then alias_candidates.customers else alias_candidates.customers || o.customer_id end;
        update alias_candidates set status = 'ready'
         where alias_folded = v_fold and product_id = r.product_id and status = 'candidate'
           and hits >= (L->>'alias_min_hits')::int and cardinality(customers) >= (L->>'alias_min_customers')::int;
        if found then v_ready := v_ready + 1; end if;
      end if;
    end if;
  end loop;
  if v_on then
    insert into customer_memory(party_id, kind, key, value, origin) values (o.customer_id, 'payment_pref', 'method', to_jsonb(o.payment_method::text), 'observed')
      on conflict (party_id, kind, key) do update set value = excluded.value, weight = customer_memory.weight + 1, updated_at = now();
  end if;
  insert into order_events(order_id, from_status, to_status, actor, reason) values (p_order, o.status, o.status, 'system', 'learned');
  return jsonb_build_object('learned', true, 'memory_on', v_on, 'aliases_awaiting_approval', v_ready, 'aliases_promoted', 0);
end $$;

-- The hourly probe order (0063's text, plus the two B4 steps). Volatile now: it may release a handoff and clear places.
create or replace function probe_due() returns jsonb language plpgsql volatile as $$
declare p record; v_conv uuid; v_why text; v_every int := coalesce((setting('probe')->>'every_minutes')::int, 60);
        v_stuck int := coalesce((setting('probe')->>'stuck_after_minutes')::int, 30);
begin
  if coalesce(setting('probe')->>'enabled', 'false') <> 'true' then return null; end if;
  select pa.id, i.wa_user_id into p from parties pa join party_identities i on i.party_id = pa.id and i.line = 'customer'
   where pa.is_probe and pa.role = 'customer' limit 1;
  if not found then return null; end if;
  -- the last test order message, whether or not it became an order yet (a turn can ask a question instead)
  if exists (select 1 from wa_inbound_events e where e.idempotency_key like 'probe:%' and e.line = 'customer'
              and e.payload->'message'->>'type' = 'text' and e.received_at > now() - make_interval(mins => v_every)) then return null; end if;
  if exists (select 1 from orders o where o.customer_id = p.id
              and (o.created_at > now() - make_interval(mins => v_every)
                   or (o.status not in ('closed','cancelled','failed_delivery','returned') and o.created_at > now() - make_interval(mins => 3 * v_stuck)))) then
    return null;
  end if;
  -- B4: a probe stuck with a person gets its conversation back, and the reason is put where ops will see it.
  select c.id into v_conv from conversations c where c.party_id = p.id and c.line = 'customer' and c.human_handoff;
  if v_conv is not null then
    select h.reason into v_why from handoffs h where h.conversation_id = v_conv order by h.created_at desc limit 1;
    update conversations set human_handoff = false, updated_at = now() where id = v_conv;
    update handoffs set status = 'resolved', resolved_at = now() where conversation_id = v_conv and status = 'open';
    perform raise_ops_exception('probe_handoff_released', v_conv::text || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24'),
                                jsonb_build_object('conversation_id', v_conv, 'reason', coalesce(v_why, 'unknown')));
  end if;
  -- B4: with fresh_place, every probe order is a first order: no saved place, so the pin and the address are asked.
  if coalesce(setting('probe')->>'fresh_place', 'false') = 'true' then
    update customer_places set village_id = null, lat = null, lng = null, building = null, floor = null, directions = null
     where party_id = p.id;
  end if;
  return jsonb_build_object('party_id', p.id, 'wa_user_id', p.wa_user_id, 'text', setting('probe')->>'order_text');
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
