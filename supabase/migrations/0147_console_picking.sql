-- Alo King Chouf, session D4b (docs/strategy/02-journeys.md, section 4; docs/strategy/06-session-plan.md, section 4):
-- the pick queue on the console, so a picker needs no WhatsApp. Nothing here changes a picking rule. start_pick, pick_item_missing,
-- pick_offer_substitute, pick_remove_missing and finish_pick (0031, 0032, 0041) are called as they are; this adds what the page needs:
--
--   * console_pick_board(): the orders to pick, in the order they were promised. A scheduled order is promised at the start of its
--     window, any other at confirmation plus its zone's ETA (zones.base_eta_minutes). Orders already being picked, and orders packed in
--     the last 12 hours that wait for a rider, are on it too so a picker sees the whole shelf side of the day. Read only.
--   * settings.packing_checklist: the packing steps the picker confirms on "done", as data (invariant 13). Each step has a key, the
--     words in both languages, and when it applies (always, or only when the order has chilled, frozen or fresh lines).
--   * pick_line_marks and pick_mark_line(item, by, picked): "picked" line by line, kept in the database so a refresh, a second phone or
--     another picker sees the same list. A line that comes up missing is not marked: it is recorded through pick_item_missing as before.
--   * finish_pick_packed(order, by, packing): refused (LINES_NOT_CHECKED) while a line is neither marked picked nor recorded missing;
--     then finish_pick, and when that ends in "ready" the packing steps the picker confirmed are stored on the pick session with who and
--     when. finish_pick itself is unchanged and keeps every one of its refusals. A pick finished on the ops line does not use this.
--   * settings.picking.console_queue: when on, the hub counts as picking through a queue (hub_uses_pick_flow), so the rider is offered
--     when picking starts and nothing leaves the hub before it is packed (0033). Off by default: nothing changes until a lead turns it
--     on from the pick queue page (set_console_pick_queue). hub_uses_pick_flow is copied from 0033 with the one setting added.

alter table pick_sessions add column if not exists packing jsonb;
comment on column pick_sessions.packing is 'D4b: the packing steps the picker confirmed on done: {checked: [keys], checked_by, checked_at}. Null for a pick finished on the ops line.';

insert into settings(key, value) values ('packing_checklist', jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('key', 'cold_bag', 'when', 'chilled',
    'en', 'Chilled, frozen and fresh items are in the cold bag.',
    'ar', 'المنتجات المبرّدة والمجمّدة والطازجة في الحقيبة الباردة.'),
  jsonb_build_object('key', 'eggs_bread_top', 'when', 'always',
    'en', 'Eggs and bread are on top, nothing heavy on them.',
    'ar', 'البيض والخبز في الأعلى ولا شيء ثقيل فوقهما.'),
  jsonb_build_object('key', 'bag_label', 'when', 'always',
    'en', 'The bag label shows the order code and the village.',
    'ar', 'ملصق الكيس عليه رمز الطلب واسم القرية.'))))
on conflict (key) do nothing;

insert into settings(key, value) values ('picking', '{"console_queue": false}')
on conflict (key) do update set value = excluded.value || settings.value;

-- Copied from 0033: a hub that picks through a queue offers the rider when picking starts. A queue is a picker registered on the ops
-- line (0033) or, new here, the console's pick queue switched on.
create or replace function hub_uses_pick_flow() returns boolean language sql stable as $$
  select coalesce((setting('picking')->>'console_queue')::boolean, false)
      or exists (select 1 from parties p join party_identities i on i.party_id = p.id and i.line = 'ops'
                 where p.role = 'picker' and not p.is_blocked) $$;

create or replace function set_console_pick_queue(p_by uuid, p_on boolean) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_before boolean := coalesce((setting('picking')->>'console_queue')::boolean, false);
begin
  perform require_role(p_by, array['admin', 'ops_lead']);
  update settings set value = value || jsonb_build_object('console_queue', coalesce(p_on, false)), updated_by = p_by, updated_at = now() where key = 'picking';
  return jsonb_build_object('ok', true, 'before', v_before, 'console_queue', coalesce(p_on, false));
end $$;

-- What the pick queue page lists. Same rules as pick_queue (0041): hub goods only, a scheduled order only once released.
create or replace function console_pick_board() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'promise_at')::timestamptz nulls last, x->>'short_code'), '[]'::jsonb) from (
    select jsonb_build_object(
      'order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'is_pickup', o.is_pickup,
      'confirmed_at', coalesce(o.released_at, o.confirmed_at),
      'promise_at', case when o.delivery_slot_id is not null then (select ds.starts_at from delivery_slots ds where ds.id = o.delivery_slot_id)
                         when z.base_eta_minutes is not null then coalesce(o.released_at, o.confirmed_at) + make_interval(mins => z.base_eta_minutes) end,
      'promise_min', z.base_eta_minutes,
      'window', window_json(o.delivery_slot_id),
      'village_ar', v.name_ar, 'village_en', v.name_en,
      'items', (select count(*) from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                 where i.order_id = o.id and i.status = 'ok' and s.kind = 'dark_store'),
      'chilled', (select count(*) from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
                    join products p on p.id = i.product_id
                   where i.order_id = o.id and i.status = 'ok' and s.kind = 'dark_store' and p.storage <> 'ambient'),
      'has_note', btrim(coalesce(o.customer_notes, '')) <> '',
      'picker_id', ps.picker_id, 'picker', pk.display_name, 'started_at', ps.started_at, 'finished_at', ps.finished_at) as x
      from orders o
      left join pick_sessions ps on ps.order_id = o.id
      left join parties pk on pk.id = ps.picker_id
      left join villages v on v.id = o.village_id
      left join zones z on z.id = v.zone_id
     where ((o.status = 'confirmed' and ps.order_id is null)
         or (o.status = 'preparing' and ps.order_id is not null and ps.finished_at is null)
         or (o.status = 'ready' and ps.finished_at > now() - interval '12 hours'))
       and order_has_hub_goods(o.id) and (o.delivery_slot_id is null or o.released_at is not null)) q $$;

create table if not exists pick_line_marks (
  item_id   uuid primary key references order_items(id) on delete cascade,
  order_id  uuid not null references orders(id) on delete cascade,
  picked_by uuid not null references parties(id),
  picked_at timestamptz not null default now()
);
create index if not exists pick_line_marks_order on pick_line_marks(order_id);

-- Hub lines of an order still to be picked: ok, from the dark store, not yet marked.
create or replace function pick_unmarked_lines(p_order uuid) returns int language sql stable as $$
  select count(*)::int from order_items i join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
   where i.order_id = p_order and i.status = 'ok' and s.kind = 'dark_store'
     and not exists (select 1 from pick_line_marks m where m.item_id = i.id) $$;

create or replace function pick_mark_line(p_item uuid, p_by uuid, p_picked boolean default true) returns jsonb language plpgsql as $$
declare v_order uuid; v_status order_status;
begin
  if not staff_can_pick(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select i.order_id, o.status into v_order, v_status
    from order_items i join orders o on o.id = i.order_id join fulfilments f on f.id = i.fulfilment_id join sources s on s.id = f.source_id
   where i.id = p_item and i.status = 'ok' and s.kind = 'dark_store';
  if v_order is null then raise exception 'ITEM_NOT_FOUND'; end if;
  perform 1 from orders where id = v_order for update;
  if v_status <> 'preparing' or not exists (select 1 from pick_sessions where order_id = v_order and finished_at is null) then
    raise exception 'NOT_BEING_PICKED %', v_status;
  end if;
  if coalesce(p_picked, true) then
    insert into pick_line_marks(item_id, order_id, picked_by) values (p_item, v_order, p_by) on conflict (item_id) do nothing;
  else
    delete from pick_line_marks where item_id = p_item;
  end if;
  return jsonb_build_object('order_id', v_order, 'picked', coalesce(p_picked, true), 'unmarked', pick_unmarked_lines(v_order));
end $$;

create or replace function finish_pick_packed(p_order uuid, p_by uuid, p_packing jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare r jsonb; v_left int;
begin
  v_left := pick_unmarked_lines(p_order);
  if v_left > 0 and exists (select 1 from orders where id = p_order and status = 'preparing') then raise exception 'LINES_NOT_CHECKED %', v_left; end if;
  r := finish_pick(p_order, p_by);
  if r->>'status' = 'ready' then
    update pick_sessions set packing = jsonb_build_object(
        'checked', case when jsonb_typeof(p_packing->'checked') = 'array' then p_packing->'checked' else '[]'::jsonb end,
        'checked_by', p_by, 'checked_at', now())
     where order_id = p_order;
  end if;
  return r;
end $$;

do $$ declare r text;
begin
  alter table pick_line_marks enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table pick_line_marks from %I', r); end if;
  end loop;
end $$;

-- A function created here is callable by the server role only (as every function since 0124): not by PUBLIC, and so not by web_channel.
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
