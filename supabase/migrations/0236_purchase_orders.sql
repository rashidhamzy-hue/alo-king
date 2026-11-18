-- Alo King Chouf, session WH1a (warehouse basics; docs/strategy/02-journeys.md, section 4): simple purchase orders.
-- A purchase order is what we ask a supplier for: the supplier, the items, the quantities and the day we expect them; a cost per unit
-- may be written when it is known (the invoice's cost is typed at receiving otherwise). Written by an ops lead or an admin; printed in
-- Arabic or English from one document (purchase_order_doc); received once, against its lines (0237). Nothing here moves stock or money:
-- stock enters only through receiving (receive_purchase_order calls receive_goods, 0024 and 0081, which posts the ledger).
-- Statuses: open -> received, or open -> cancelled (with a reason). A short delivery closes the order as received, with the short
-- units recorded; what is still wanted goes on a new order (docs/DECISIONS.md, WH1a).

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,                       -- PO-0001: what the supplier and the paper see
  supplier_id   uuid not null references suppliers(id),
  source_id     uuid not null references sources(id),
  expected_date date not null,
  status        text not null default 'open' check (status in ('open', 'received', 'cancelled')),
  note          text,
  created_by    uuid not null references parties(id),
  created_at    timestamptz not null default now(),
  request_key   text unique,                                -- a form sent twice is one order
  cancelled_by  uuid references parties(id),
  cancelled_at  timestamptz,
  cancel_reason text
);
create index purchase_orders_open on purchase_orders(source_id, expected_date) where status = 'open';
create sequence purchase_order_number;

create table purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  product_id    uuid not null references products(id),
  qty           numeric(10,3) not null check (qty > 0),
  unit_cost_usd numeric(12,4) check (unit_cost_usd >= 0),  -- known at ordering, or typed at receiving
  position      int not null,
  unique (po_id, product_id)
);

-- p_lines: [{product_id, qty, unit_cost_usd?}, ...]. Items of the hub only (a restaurant's dish is never bought on a purchase order).
create or replace function create_purchase_order(p_supplier uuid, p_source uuid, p_expected date, p_lines jsonb, p_by uuid,
                                                 p_note text default null, p_key text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v purchase_orders%rowtype; ln jsonb; p products%rowtype; v_qty numeric; v_cost numeric; v_pos int := 0; v_seen uuid[] := '{}';
begin
  if p_key is not null then
    select * into v from purchase_orders where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'po_id', v.id, 'number', v.number); end if;
  end if;
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from suppliers where id = p_supplier and is_active) then raise exception 'UNKNOWN_SUPPLIER'; end if;
  if not exists (select 1 from sources where id = p_source and kind = 'dark_store') then raise exception 'NOT_A_STOCKED_SOURCE'; end if;
  if p_expected is null then raise exception 'EXPECTED_DATE_REQUIRED'; end if;
  if p_expected < (now() at time zone scheduling_tz())::date then raise exception 'EXPECTED_DATE_PAST %', p_expected; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'NO_LINES'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'TOO_MANY_LINES'; end if;

  -- every line is checked before a number is taken (a number is never spent on a refused order)
  for ln in select * from jsonb_array_elements(p_lines) loop
    select * into p from products where id = nullif(ln->>'product_id', '')::uuid;
    if not found then raise exception 'UNKNOWN_PRODUCT %', ln->>'product_id'; end if;
    if p.owner_source_id is not null then raise exception 'NOT_A_HUB_ITEM %', p.name_en; end if;
    if p.id = any(v_seen) then raise exception 'DUPLICATE_ITEM %', p.name_en; end if;
    v_seen := v_seen || p.id;
    v_qty := nullif(ln->>'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'BAD_QTY %', p.name_en; end if;
    v_cost := nullif(ln->>'unit_cost_usd', '')::numeric;
    if v_cost is not null and v_cost < 0 then raise exception 'BAD_COST %', p.name_en; end if;
  end loop;
  insert into purchase_orders(number, supplier_id, source_id, expected_date, note, created_by, request_key)
    values ('PO-' || lpad(nextval('purchase_order_number')::text, 4, '0'), p_supplier, p_source, p_expected,
            nullif(btrim(coalesce(p_note, '')), ''), p_by, p_key)
    returning * into v;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    insert into purchase_order_lines(po_id, product_id, qty, unit_cost_usd, position)
      values (v.id, (ln->>'product_id')::uuid, (ln->>'qty')::numeric, nullif(ln->>'unit_cost_usd', '')::numeric, v_pos);
  end loop;
  return jsonb_build_object('ok', true, 'duplicate', false, 'po_id', v.id, 'number', v.number);
end $$;

create or replace function cancel_purchase_order(p_po uuid, p_by uuid, p_reason text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v purchase_orders%rowtype;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v from purchase_orders where id = p_po for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  if v.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v.status <> 'open' then raise exception 'PO_NOT_OPEN %', v.status; end if;
  update purchase_orders set status = 'cancelled', cancelled_by = p_by, cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_po;
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- The one document a purchase order is printed from, in either language: the page picks name_ar or name_en per line.
-- 0237 adds what was received and what goes to the label day's capture list.
create or replace function purchase_order_doc(p_po uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('po_id', o.id, 'number', o.number, 'status', o.status, 'expected_date', o.expected_date, 'created_at', o.created_at,
           'created_by', cb.display_name, 'note', o.note, 'cancel_reason', o.cancel_reason, 'hub', s.name,
           'supplier', jsonb_build_object('id', su.id, 'name', su.name, 'phone', su.phone, 'terms', su.terms),
           'lines', coalesce((select jsonb_agg(jsonb_build_object('n', l.position, 'line_id', l.id, 'product_id', p.id, 'sku', p.sku, 'barcode', p.barcode,
                       'name_en', p.name_en, 'name_ar', coalesce(p.name_ar, p.name_en), 'qty', l.qty, 'unit', p.sell_unit, 'storage', p.storage,
                       'unit_cost_usd', l.unit_cost_usd) order by l.position)
                     from purchase_order_lines l join products p on p.id = l.product_id where l.po_id = o.id), '[]'::jsonb))
    from purchase_orders o join suppliers su on su.id = o.supplier_id join sources s on s.id = o.source_id
    left join parties cb on cb.id = o.created_by
   where o.id = p_po $$;

-- Open and recent orders, for the console's list.
create or replace function purchase_orders_list(p_source uuid, p_limit int default 60) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.j order by x.open_first, x.expected_date, x.created_at desc), '[]'::jsonb)
    from (select (o.status <> 'open') as open_first, o.expected_date, o.created_at,
                 jsonb_build_object('po_id', o.id, 'number', o.number, 'status', o.status, 'expected_date', o.expected_date, 'supplier', su.name,
                   'lines', (select count(*) from purchase_order_lines l where l.po_id = o.id), 'created_at', o.created_at) as j
            from purchase_orders o join suppliers su on su.id = o.supplier_id
           where o.source_id = p_source and (o.status = 'open' or o.created_at > now() - interval '30 days')
           order by (o.status <> 'open'), o.expected_date, o.created_at desc limit greatest(p_limit, 1)) x $$;

do $$ declare t text; r text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_lines'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated', 'web_channel'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on sequence purchase_order_number from %I', r); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
