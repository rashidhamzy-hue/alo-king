-- Alo King Chouf, session C2, build plan 2.2: a missing item and its substitute.
-- The picker may offer one substitute for a missing line; the customer taps keep or remove, with the price difference shown;
-- no answer by the deadline means remove. Nothing is ever substituted without the customer's tap.
--   * substitute_candidates: same shelf, same category and kind, in stock, sellable, not held. None when the customer has a
--     stated restriction (kept, or written on the order): restrictions are free text and no approved record says a substitute
--     meets them, and unknown is never safe (invariants 15, 16). A paid prepaid order is offered nothing dearer than the line
--     it replaces (the customer cannot be charged after paying).
--   * pick_offer_substitute: reserves the substitute at once, so it is not sold while the customer decides.
--   * answer_substitution:   the customer keeps it (a new ok line, substitution_of the missing one, at the price shown) or removes
--     it; an answer after the deadline changes nothing. A cheaper kept substitute on a paid order is owed back as credit (0030).
--   * expire_substitution_offers: overdue offers are removed. Run when the picker finishes and before any answer is applied.
-- Switched by settings.picking.offer_substitutes, off until the customer line routes the keep and remove taps
-- (handleSubstitutionButton in apps/gateway/src/ops-turn.ts, called from turn.ts by lane B). While off, a missing line is removed.
-- Totals are recalculated on every change, before the order is ready, so the rider never collects a stale figure.
-- Functions redefined here are copied from 0031 with the 2.2 lines added: pick_item_missing, pick_found_held, finish_pick, pick_changes.

insert into settings(key, value) values ('picking', '{"offer_substitutes": false, "substitute_answer_min": 5}')
on conflict (key) do update set value = excluded.value || settings.value;

create table substitution_offers (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id),
  missing_item_id    uuid not null references order_items(id),
  product_id         uuid not null references products(id),
  source_id          uuid not null references sources(id),
  qty                numeric(10,3) not null check (qty > 0),
  unit_price_usd     numeric(10,2) not null,
  line_total_usd     numeric(10,2) not null,
  replaced_total_usd numeric(10,2) not null,
  status             text not null default 'open' check (status in ('open', 'kept', 'removed', 'expired', 'withdrawn')),
  offered_by         uuid not null references parties(id),
  offered_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  answered_at        timestamptz,
  answer_wamid       text,
  substitute_item_id uuid references order_items(id)
);
create unique index substitution_offers_one_open on substitution_offers(missing_item_id) where status = 'open';
create index substitution_offers_due on substitution_offers(expires_at) where status = 'open';

create or replace function order_has_restrictions(p_order uuid) returns boolean language sql stable as $$
  select exists (select 1 from orders o where o.id = p_order
                 and (coalesce(o.customer_notes, '') like '%' || 'قيود الزبون' || '%'
                      or jsonb_array_length(customer_restrictions(o.customer_id)) > 0)) $$;

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
     where p2.id <> i.product_id and p2.is_active and ofr.is_available and not product_on_hold(p2.id)
       and p2.category = p.category and p2.sub_type is not distinct from p.sub_type
       and l.on_hand - l.reserved >= i.qty
       and (v_cap is null or round(ofr.price_usd * i.qty, 2) <= v_cap)
     order by 7 limit 3) x;
  return jsonb_build_object('candidates', v, 'blocked', case when jsonb_array_length(v) = 0 then 'none_in_stock' end);
end $$;

-- After a line comes up missing: keep it open for the picker to offer a substitute when that is switched on and possible,
-- otherwise take it off at once (as 2.1 did).
create or replace function pick_decide_missing(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare c jsonb;
begin
  if coalesce((setting('picking')->>'offer_substitutes')::boolean, false) then
    c := substitute_candidates(p_missing);
    if jsonb_array_length(c->'candidates') > 0 then
      return jsonb_build_object('decision', 'pending', 'candidates', c->'candidates', 'removed_usd', 0, 'credit_usd', 0);
    end if;
    return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed', 'blocked', c->'blocked');
  end if;
  return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed');
end $$;

create or replace function pick_found_held(p_item uuid, p_by uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := pick_short_line(p_item, p_by, 0, 'on_hold');
  perform pick_decide_missing(v, p_by);
  return v;
end $$;

create or replace function pick_item_missing(p_item uuid, p_by uuid, p_found numeric default 0) returns jsonb language plpgsql as $$
declare v_order uuid; v_status order_status; v_missing uuid; r jsonb;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select i.order_id, o.status into v_order, v_status from order_items i join orders o on o.id = i.order_id where i.id = p_item;
  if v_order is null then raise exception 'ITEM_NOT_FOUND'; end if;
  perform 1 from orders where id = v_order for update;
  if v_status <> 'preparing' or not exists (select 1 from pick_sessions where order_id = v_order and finished_at is null) then
    raise exception 'NOT_BEING_PICKED %', v_status;
  end if;
  v_missing := pick_short_line(p_item, p_by, coalesce(p_found, 0), 'not_on_shelf');
  r := pick_decide_missing(v_missing, p_by);
  return r || jsonb_build_object('order_id', v_order, 'missing_item', v_missing,
                                 'total_usd', (select total_usd from orders where id = v_order));
end $$;

-- The picker takes a missing line off instead of offering a substitute (or withdraws an offer the customer has not answered).
create or replace function pick_remove_missing(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare i order_items%rowtype; s substitution_offers%rowtype;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into i from order_items where id = p_missing;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  perform 1 from orders where id = i.order_id for update;
  select * into s from substitution_offers where missing_item_id = p_missing and status = 'open' for update;
  if found then perform substitution_release(s.id, 'withdrawn', null); end if;
  return pick_remove_line(p_missing, p_by) || jsonb_build_object('order_id', i.order_id, 'total_usd', (select total_usd from orders where id = i.order_id));
end $$;

create or replace function pick_offer_substitute(p_missing uuid, p_product uuid, p_by uuid) returns jsonb language plpgsql as $$
declare i order_items%rowtype; o orders%rowtype; c jsonb; v_src uuid; v_price numeric; v_upd int; v_id uuid; v_min int;
        v_name text; v_sub_name text;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if not coalesce((setting('picking')->>'offer_substitutes')::boolean, false) then raise exception 'SUBSTITUTES_OFF'; end if;
  select * into i from order_items where id = p_missing;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into o from orders where id = i.order_id for update;
  if o.status <> 'preparing' then raise exception 'NOT_BEING_PICKED %', o.status; end if;
  if i.status <> 'missing' then raise exception 'LINE_NOT_MISSING %', i.status; end if;
  if exists (select 1 from substitution_offers where missing_item_id = p_missing and status = 'open') then raise exception 'OFFER_ALREADY_OPEN'; end if;
  c := substitute_candidates(p_missing);
  select (x->>'unit_price_usd')::numeric into v_price from jsonb_array_elements(c->'candidates') x where (x->>'product_id')::uuid = p_product;
  if v_price is null then raise exception 'NOT_A_CANDIDATE %', coalesce(c->>'blocked', 'not in the list'); end if;
  select f.source_id into v_src from fulfilments f where f.id = i.fulfilment_id;
  update stock_levels set reserved = reserved + i.qty where source_id = v_src and product_id = p_product and on_hand - reserved >= i.qty;
  get diagnostics v_upd = row_count;
  if v_upd = 0 then raise exception 'OUT_OF_STOCK %', p_product; end if;
  insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, actor_id, note)
    values (v_src, p_product, -i.qty, 'reserve', o.id, p_by, 'substitute offered');
  v_min := coalesce((setting('picking')->>'substitute_answer_min')::int, 5);
  insert into substitution_offers(order_id, missing_item_id, product_id, source_id, qty, unit_price_usd, line_total_usd, replaced_total_usd, offered_by, expires_at)
    values (o.id, p_missing, p_product, v_src, i.qty, v_price, round(v_price * i.qty, 2), round(i.qty * i.unit_price_usd, 2), p_by,
            now() + make_interval(mins => v_min))
    returning id into v_id;
  select coalesce(name_ar, name_en) into v_name from products where id = i.product_id;
  select coalesce(name_ar, name_en) into v_sub_name from products where id = p_product;
  return jsonb_build_object('offer_id', v_id, 'order_id', o.id, 'short_code', o.short_code, 'customer_id', o.customer_id,
    'missing_name', v_name, 'substitute_name', v_sub_name, 'qty', i.qty,
    'replaced_total_usd', round(i.qty * i.unit_price_usd, 2), 'line_total_usd', round(v_price * i.qty, 2),
    'diff_usd', round(v_price * i.qty, 2) - round(i.qty * i.unit_price_usd, 2), 'answer_min', v_min);
end $$;

-- Internal: give the substitute back to the shelf and close the offer.
create or replace function substitution_release(p_offer uuid, p_status text, p_wamid text) returns void language plpgsql as $$
declare s substitution_offers%rowtype;
begin
  select * into s from substitution_offers where id = p_offer for update;
  if s.status <> 'open' then return; end if;
  -- An order cancelled while the customer was deciding has had every reservation released already (settle_stock).
  if (select status from orders where id = s.order_id) <> 'preparing' then
    update substitution_offers set status = 'withdrawn', answered_at = now() where id = p_offer;
    return;
  end if;
  update stock_levels set reserved = greatest(reserved - s.qty, 0) where source_id = s.source_id and product_id = s.product_id;
  insert into stock_movements(source_id, product_id, qty_delta, reason, order_id, note)
    values (s.source_id, s.product_id, s.qty, 'release', s.order_id, 'substitute not taken');
  update substitution_offers set status = p_status, answered_at = now(), answer_wamid = p_wamid where id = p_offer;
end $$;

-- Overdue offers are removed: no answer means remove. p_order limits it to one order (null: all).
create or replace function expire_substitution_offers(p_order uuid default null) returns int language plpgsql as $$
declare s record; n int := 0;
begin
  for s in select so.id, so.missing_item_id, o.status from substitution_offers so join orders o on o.id = so.order_id
            where so.status = 'open' and so.expires_at <= now() and (p_order is null or so.order_id = p_order)
            order by so.expires_at for update of so skip locked loop
    perform substitution_release(s.id, 'expired', null);
    if s.status = 'preparing' then perform pick_remove_line(s.missing_item_id, null); end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- The customer answers. Only the order's customer; once only; nothing after the deadline.
create or replace function answer_substitution(p_offer uuid, p_party uuid, p_keep boolean, p_wamid text default null) returns jsonb language plpgsql as $$
declare s substitution_offers%rowtype; o orders%rowtype; i order_items%rowtype; v_item uuid; v_diff numeric; v_result text;
begin
  select * into s from substitution_offers where id = p_offer;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;
  select * into o from orders where id = s.order_id for update;
  if o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  select * into s from substitution_offers where id = p_offer for update;
  if s.status = 'open' and s.expires_at <= now() then perform expire_substitution_offers(s.order_id); select * into s from substitution_offers where id = p_offer; end if;
  if s.status <> 'open' then
    return jsonb_build_object('changed', false, 'status', s.status, 'short_code', o.short_code, 'total_usd', (select total_usd from orders where id = o.id),
                              'order_id', o.id, 'offered_by', s.offered_by,
                              'substitute_name', (select coalesce(name_ar, name_en) from products where id = s.product_id));
  end if;
  select * into i from order_items where id = s.missing_item_id for update;
  if p_keep then
    insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd, modifiers, note, substitution_of, status)
      select s.order_id, i.fulfilment_id, s.product_id, p.name_en, s.qty, s.unit_price_usd, '[]'::jsonb, i.note, i.id, 'ok'
        from products p where p.id = s.product_id
      returning id into v_item;
    update order_items set status = 'substituted' where id = i.id;
    update substitution_offers set status = 'kept', answered_at = now(), answer_wamid = p_wamid, substitute_item_id = v_item where id = s.id;
    perform recalc_order_lines(s.order_id);
    v_diff := s.replaced_total_usd - s.line_total_usd;
    if v_diff > 0 and exists (select 1 from payments where order_id = s.order_id and status = 'confirmed') then
      perform grant_customer_credit(s.order_id, v_diff, 'goods', 'substitute_cheaper', null, null, i.id, 'sub:' || s.id);
    end if;
    v_result := 'kept';
  else
    perform substitution_release(s.id, 'removed', p_wamid);
    perform pick_remove_line(i.id, null);
    v_result := 'removed';
  end if;
  return jsonb_build_object('changed', true, 'status', v_result, 'short_code', o.short_code, 'order_id', o.id, 'offered_by', s.offered_by,
                            'substitute_name', (select coalesce(name_ar, name_en) from products where id = s.product_id),
                            'total_usd', (select total_usd from orders where id = o.id),
                            'fx_rate_lbp', o.fx_rate_lbp, 'payment_method', o.payment_method);
end $$;

-- Picked: overdue offers are removed first; an open offer is waited for, with the time left.
create or replace function finish_pick(p_order uuid, p_by uuid) returns jsonb language plpgsql as $$
declare o orders%rowtype; r record; v_waiting jsonb; v_changed boolean;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  if o.status <> 'preparing' then
    return jsonb_build_object('status', case when o.status in ('ready', 'out_for_delivery', 'arrived', 'delivered', 'closed') then 'already' else 'not_pickable' end,
                              'order_status', o.status, 'short_code', o.short_code);
  end if;
  if not exists (select 1 from pick_sessions where order_id = p_order and finished_at is null) then
    return jsonb_build_object('status', 'not_started', 'short_code', o.short_code);
  end if;
  perform expire_substitution_offers(p_order);
  for r in select i.id from order_items i join fulfilments f on f.id = i.fulfilment_id join sources sr on sr.id = f.source_id
            where i.order_id = p_order and i.status = 'ok' and sr.kind = 'dark_store' and product_on_hold(i.product_id) loop
    perform pick_found_held(r.id, p_by);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'name', coalesce(p.name_ar, i.name_snapshot),
           'offer_open', s.id is not null, 'seconds_left', greatest(0, ceil(extract(epoch from s.expires_at - now()))))), '[]'::jsonb) into v_waiting
    from order_items i join products p on p.id = i.product_id left join substitution_offers s on s.missing_item_id = i.id and s.status = 'open'
   where i.order_id = p_order and i.status = 'missing';
  if jsonb_array_length(v_waiting) > 0 then
    return jsonb_build_object('status', 'waiting', 'short_code', o.short_code, 'lines', v_waiting, 'list', pick_list(p_order));
  end if;
  if not exists (select 1 from order_items where order_id = p_order and status = 'ok') then
    perform raise_ops_exception('pick_empty', o.short_code, jsonb_build_object('order_id', p_order, 'picker', p_by));
    return jsonb_build_object('status', 'empty', 'short_code', o.short_code);
  end if;
  perform transition_order(p_order, 'ready', 'picker', p_by, 'picked');
  update pick_sessions set finished_at = now(), finished_by = p_by where order_id = p_order;
  v_changed := exists (select 1 from order_items where order_id = p_order and missing_at is not null);
  return jsonb_build_object('status', 'ready', 'short_code', o.short_code, 'customer_id', o.customer_id, 'changed', v_changed,
                            'changes', pick_changes(p_order));
end $$;

create or replace function pick_changes(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('short_code', o.short_code, 'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'payment_method', o.payment_method,
    'removed', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.name_ar, i.name_snapshot), 'qty', i.qty,
                          'line_total_usd', round(i.qty * i.unit_price_usd, 2)) order by i.missing_at)
                        from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'removed'), '[]'::jsonb),
    'substituted', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.name_ar, i.name_snapshot), 'by', coalesce(ps.name_ar, si.name_snapshot),
                          'qty', si.qty, 'line_total_usd', round(si.qty * si.unit_price_usd, 2)) order by i.missing_at)
                        from order_items i join products p on p.id = i.product_id join order_items si on si.substitution_of = i.id and si.status = 'ok'
                        join products ps on ps.id = si.product_id where i.order_id = o.id and i.status = 'substituted'), '[]'::jsonb),
    'credit_usd', coalesce((select sum(amount_usd) from refunds where order_id = o.id and reason in ('missing_at_pick', 'substitute_cheaper')), 0))
  from orders o where o.id = p_order $$;

do $$ declare r text;
begin
  alter table substitution_offers enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table substitution_offers from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
