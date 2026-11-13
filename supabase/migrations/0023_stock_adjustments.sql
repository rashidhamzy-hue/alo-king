-- Alo King Chouf, session C1, build plan 2.6: stock adjustments with a reason and a name.
-- Every change to the count on the shelf that is not an order, a receipt or a return goes through adjust_stock() or
-- count_stock(): who did it (a staff party, never free text), why (a fixed reason), an optional note, and the movement row.
-- A picker can record small adjustments; above settings.stock_adjust.picker_max_units an ops lead or admin must.
-- Stock reserved for confirmed orders cannot be adjusted away: a missing item on an order goes through the pick flow (2.1, 2.2).
-- From 2.7 (migration 0024) each adjustment is also valued at average cost and posted to the ledger.

alter table stock_movements add column if not exists adjust_reason text
  check (adjust_reason in ('count', 'found', 'damaged', 'expired', 'spoiled', 'theft', 'recall', 'sample', 'other'));
alter table stock_movements add column if not exists note text;
alter table stock_movements add column if not exists request_key text;
create unique index if not exists stock_movements_request_once on stock_movements(request_key) where request_key is not null;
create index if not exists stock_movements_product_time on stock_movements(product_id, created_at);

insert into settings(key, value) values ('stock_adjust', '{"picker_max_units": 12}') on conflict (key) do nothing;

-- p_delta: units added (positive) or removed (negative). Reasons that destroy goods (damaged, expired, spoiled, recall)
-- are recorded as waste; the others as adjust. p_key makes a retried request (a double tap in the console) a no-op.
create or replace function adjust_stock(p_source uuid, p_product uuid, p_delta numeric, p_reason text, p_by uuid,
                                        p_note text default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_role party_role; v_lvl stock_levels%rowtype; v_id uuid; v_max numeric := coalesce((setting('stock_adjust')->>'picker_max_units')::numeric, 0);
        v_kind stock_reason;
begin
  if p_key is not null then
    select id into v_id from stock_movements where request_key = p_key;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'movement_id', v_id,
                                'on_hand', (select on_hand from stock_levels where source_id = p_source and product_id = p_product));
    end if;
  end if;
  select role into v_role from parties where id = p_by and not is_blocked;
  if v_role is null or v_role not in ('picker', 'ops_lead', 'admin') then raise exception 'NOT_AUTHORISED'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'NO_CHANGE'; end if;
  if p_reason is null or p_reason not in ('count', 'found', 'damaged', 'expired', 'spoiled', 'theft', 'recall', 'sample', 'other') then
    raise exception 'UNKNOWN_REASON %', p_reason;
  end if;
  if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  if p_reason = 'found' and p_delta < 0 or p_reason in ('damaged', 'expired', 'spoiled', 'theft', 'recall', 'sample') and p_delta > 0 then
    raise exception 'REASON_DOES_NOT_FIT % %', p_reason, p_delta;
  end if;
  if v_role = 'picker' and abs(p_delta) > v_max then raise exception 'NEEDS_OPS_LEAD % units is above the picker limit of %', abs(p_delta), v_max; end if;
  if not exists (select 1 from sources where id = p_source and kind = 'dark_store') then raise exception 'NOT_A_STOCKED_SOURCE'; end if;

  insert into stock_levels(source_id, product_id) values (p_source, p_product) on conflict do nothing;
  select * into v_lvl from stock_levels where source_id = p_source and product_id = p_product for update;
  if v_lvl.on_hand + p_delta < v_lvl.reserved then
    raise exception 'BELOW_RESERVED on hand % reserved % change %', v_lvl.on_hand, v_lvl.reserved, p_delta;
  end if;
  update stock_levels set on_hand = on_hand + p_delta where source_id = p_source and product_id = p_product;
  v_kind := case when p_reason in ('damaged', 'expired', 'spoiled', 'recall') then 'waste' else 'adjust' end;
  insert into stock_movements(source_id, product_id, qty_delta, reason, actor_id, adjust_reason, note, request_key)
    values (p_source, p_product, p_delta, v_kind, p_by, p_reason, nullif(btrim(p_note), ''), p_key)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'movement_id', v_id, 'on_hand', v_lvl.on_hand + p_delta, 'reason', v_kind);
end $$;

-- A shelf count: the difference from the system's figure becomes one adjustment with reason 'count'.
-- An exact count is recorded too (a zero adjustment would say nothing), so the count date is known.
create table if not exists stock_counts (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references sources(id),
  product_id uuid not null references products(id),
  expected   numeric(10,3) not null,
  counted    numeric(10,3) not null check (counted >= 0),
  movement_id uuid references stock_movements(id),
  counted_by uuid not null references parties(id),
  request_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists stock_counts_product on stock_counts(product_id, created_at);

create or replace function count_stock(p_source uuid, p_product uuid, p_counted numeric, p_by uuid, p_note text default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_on_hand numeric; r jsonb := null; c stock_counts%rowtype;
begin
  if p_key is not null then
    select * into c from stock_counts where request_key = p_key;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'expected', c.expected, 'counted', c.counted,
                                'difference', c.counted - c.expected, 'movement_id', c.movement_id);
    end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('picker', 'ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'BAD_COUNT'; end if;
  select on_hand into v_on_hand from stock_levels where source_id = p_source and product_id = p_product for update;
  v_on_hand := coalesce(v_on_hand, 0);
  if p_counted <> v_on_hand then r := adjust_stock(p_source, p_product, p_counted - v_on_hand, 'count', p_by, p_note, p_key); end if;
  insert into stock_counts(source_id, product_id, expected, counted, movement_id, counted_by, request_key)
    values (p_source, p_product, v_on_hand, p_counted, (r->>'movement_id')::uuid, p_by, p_key);
  return jsonb_build_object('ok', true, 'duplicate', false, 'expected', v_on_hand, 'counted', p_counted, 'difference', p_counted - v_on_hand,
                            'movement_id', r->'movement_id');
end $$;

-- Who changed what and why, for the console and the day-close report.
create or replace function stock_adjustments(p_since timestamptz default now() - interval '1 day', p_until timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('movement_id', m.id, 'at', m.created_at, 'product_id', m.product_id, 'product', p.name_en,
           'qty', m.qty_delta, 'reason', m.adjust_reason, 'kind', m.reason, 'note', m.note, 'by', pa.display_name, 'by_id', m.actor_id)
           order by m.created_at), '[]'::jsonb)
    from stock_movements m join products p on p.id = m.product_id left join parties pa on pa.id = m.actor_id
   where m.adjust_reason is not null and m.created_at >= p_since and m.created_at < p_until $$;

do $$ declare r text;
begin
  alter table stock_counts enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table stock_counts from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
