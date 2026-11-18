-- Alo King Chouf, session WH1a: receiving against a purchase order (docs/strategy/02-journeys.md, section 4, "Receiving").
-- Each line of the order is counted: how many came, how many of those are damaged (they do not go on the shelf), the lot and the expiry
-- date where the pack has one (chilled, frozen and fresh goods always need one: receive_goods's rule). Short (fewer came than ordered) and
-- damaged units are recorded on the receiving, for the credit note with the supplier (0025). The good units go on the shelf through
-- receive_goods (0024, 0081: cost, average cost, the ledger, the drawer check when paid from the drawer), which writes each receipt line
-- with its lot and expiry; 0239 turns each receipt line into a lot. Stock enters only through receiving: the console's form without an
-- order is gone (docs/DECISIONS.md, WH1a), and goods that arrive with no order get one written on the spot by the ops lead.
-- After receiving, the items that are packaged and not label-ready (0226) are named, and the label day's capture list (0211) puts the
-- received items that are not yet photographed first, so the label day can start the same day.

alter table purchase_orders add column if not exists received_by uuid references parties(id);
alter table purchase_orders add column if not exists received_at timestamptz;
alter table purchase_orders add column if not exists receipt_id uuid references goods_receipts(id);

create table receiving_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references purchase_orders(id),
  po_line_id      uuid not null unique references purchase_order_lines(id),
  product_id      uuid not null references products(id),
  ordered         numeric(10,3) not null,
  counted         numeric(10,3) not null check (counted >= 0),            -- how many came
  damaged         numeric(10,3) not null default 0 check (damaged >= 0),  -- of those, not fit for the shelf
  received        numeric(10,3) not null check (received >= 0),           -- counted less damaged: what went on the shelf
  short           numeric(10,3) not null check (short >= 0),              -- ordered less counted, when fewer came
  lot             text,
  expiry_date     date,
  unit_cost_usd   numeric(12,4),
  note            text,
  received_by     uuid not null references parties(id),
  received_at     timestamptz not null default now(),
  check (damaged <= counted)
);
create index receiving_lines_product on receiving_lines(product_id) where received > 0;

-- Items of a receiving that the label day still needs: packaged and not label-ready. photographed: front and back are in (0211);
-- such an item waits for its reading or a person's approval, not for a photo.
create or replace function receiving_label_capture(p_po uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name_en', x.name_en, 'name_ar', x.name_ar, 'photographed', x.done)
                            order by x.done, x.name_en), '[]'::jsonb)
    from (select distinct p.id as product_id, p.name_en, coalesce(p.name_ar, p.name_en) as name_ar, coalesce(s.done, false) as done
            from receiving_lines rl join products p on p.id = rl.product_id
            left join label_capture_status s on s.product_id = p.id
           where rl.po_id = p_po and rl.received > 0 and product_is_packaged(p.id) and not product_label_ready(p.id)) x $$;

-- p_lines: [{line_id, counted, damaged?, lot?, expiry_date?, unit_cost_usd?, note?}, ...], one per line of the order.
-- Received once: a second call answers with the first receiving. p_supplier_ref: the supplier's invoice or delivery-note number
-- (the order's number when there is none); a number already used for another receipt of this supplier is refused.
create or replace function receive_purchase_order(p_po uuid, p_lines jsonb, p_by uuid, p_paid_from text default 'credit',
                                                  p_supplier_ref text default null, p_note text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o purchase_orders%rowtype; l record; ln jsonb; v_counted numeric; v_damaged numeric; v_good numeric; v_cost numeric; v_exp date;
        v_goods jsonb := '[]'::jsonb; v_rows jsonb := '[]'::jsonb; r jsonb := null; v_ref text; v_today date := (now() at time zone scheduling_tz())::date;
        v_role party_role;
begin
  select * into o from purchase_orders where id = p_po for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  if o.status = 'received' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'po_id', o.id, 'receipt_id', o.receipt_id,
      'total_usd', coalesce((select total_usd from goods_receipts where id = o.receipt_id), 0)) || receiving_summary(o.id);
  end if;
  if o.status = 'cancelled' then raise exception 'PO_CANCELLED'; end if;
  select role into v_role from parties where id = p_by and not is_blocked;
  if v_role is null or v_role not in ('picker', 'ops_lead', 'admin') then raise exception 'NOT_AUTHORISED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'NO_LINES'; end if;

  for l in select pl.*, p.name_en, p.storage from purchase_order_lines pl join products p on p.id = pl.product_id where pl.po_id = o.id order by pl.position loop
    select x into ln from jsonb_array_elements(p_lines) x where x->>'line_id' = l.id::text limit 1;
    if ln is null or nullif(ln->>'counted', '') is null then raise exception 'LINE_NOT_COUNTED %', l.name_en; end if;
    v_counted := (ln->>'counted')::numeric;
    v_damaged := coalesce(nullif(ln->>'damaged', '')::numeric, 0);
    if v_counted < 0 then raise exception 'BAD_COUNT %', l.name_en; end if;
    if v_damaged < 0 or v_damaged > v_counted then raise exception 'BAD_DAMAGED %', l.name_en; end if;
    v_good := v_counted - v_damaged;
    v_cost := coalesce(nullif(ln->>'unit_cost_usd', '')::numeric, l.unit_cost_usd);
    v_exp := nullif(ln->>'expiry_date', '')::date;
    if v_good > 0 then
      if v_cost is null or v_cost < 0 then raise exception 'COST_REQUIRED %', l.name_en; end if;
      if v_exp is null and l.storage <> 'ambient' then raise exception 'EXPIRY_REQUIRED % is %', l.name_en, l.storage; end if;
      if v_exp is not null and v_exp < v_today then raise exception 'EXPIRED_ON_ARRIVAL % %', l.name_en, v_exp; end if;
      v_goods := v_goods || jsonb_build_object('product_id', l.product_id, 'qty', v_good, 'unit_cost_usd', v_cost, 'expiry_date', v_exp,
                                               'lot', nullif(btrim(coalesce(ln->>'lot', '')), ''));
    end if;
    v_rows := v_rows || jsonb_build_object('po_line_id', l.id, 'product_id', l.product_id, 'ordered', l.qty, 'counted', v_counted, 'damaged', v_damaged,
                          'received', v_good, 'short', greatest(l.qty - v_counted, 0), 'lot', nullif(btrim(coalesce(ln->>'lot', '')), ''),
                          'expiry_date', v_exp, 'unit_cost_usd', v_cost, 'note', nullif(btrim(coalesce(ln->>'note', '')), ''));
  end loop;

  if jsonb_array_length(v_goods) > 0 then
    v_ref := coalesce(nullif(btrim(coalesce(p_supplier_ref, '')), ''), o.number);
    r := receive_goods(o.supplier_id, o.source_id, v_goods, p_by, v_ref, coalesce(p_paid_from, 'credit'),
                       coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Purchase order ' || o.number));
    if (r->>'duplicate')::boolean then raise exception 'SUPPLIER_REF_USED %', v_ref; end if;
  elsif p_paid_from = 'hub_cash' and v_role = 'picker' then
    raise exception 'NEEDS_OPS_LEAD to pay from the till';
  end if;

  insert into receiving_lines(po_id, po_line_id, product_id, ordered, counted, damaged, received, short, lot, expiry_date, unit_cost_usd, note, received_by)
    select o.id, (x->>'po_line_id')::uuid, (x->>'product_id')::uuid, (x->>'ordered')::numeric, (x->>'counted')::numeric, (x->>'damaged')::numeric,
           (x->>'received')::numeric, (x->>'short')::numeric, x->>'lot', nullif(x->>'expiry_date', '')::date, nullif(x->>'unit_cost_usd', '')::numeric,
           x->>'note', p_by
      from jsonb_array_elements(v_rows) x;
  update purchase_orders set status = 'received', received_by = p_by, received_at = now(), receipt_id = (r->>'receipt_id')::uuid where id = o.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'po_id', o.id, 'number', o.number, 'receipt_id', r->>'receipt_id',
           'total_usd', coalesce((r->>'total_usd')::numeric, 0), 'margins', coalesce(r->'lines', '[]'::jsonb)) || receiving_summary(o.id);
end $$;

-- What a receiving recorded: short and damaged lines, and the label day's list.
create or replace function receiving_summary(p_po uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'short', coalesce((select jsonb_agg(jsonb_build_object('product_id', rl.product_id, 'name_en', p.name_en, 'name_ar', coalesce(p.name_ar, p.name_en),
                 'ordered', rl.ordered, 'counted', rl.counted, 'short', rl.short) order by p.name_en)
               from receiving_lines rl join products p on p.id = rl.product_id where rl.po_id = p_po and rl.short > 0), '[]'::jsonb),
    'damaged', coalesce((select jsonb_agg(jsonb_build_object('product_id', rl.product_id, 'name_en', p.name_en, 'name_ar', coalesce(p.name_ar, p.name_en),
                 'damaged', rl.damaged, 'note', rl.note) order by p.name_en)
               from receiving_lines rl join products p on p.id = rl.product_id where rl.po_id = p_po and rl.damaged > 0), '[]'::jsonb),
    'label_capture', receiving_label_capture(p_po)) $$;

-- The document, with what was received (0236's text, plus the receiving).
create or replace function purchase_order_doc(p_po uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('po_id', o.id, 'number', o.number, 'status', o.status, 'expected_date', o.expected_date, 'created_at', o.created_at,
           'created_by', cb.display_name, 'note', o.note, 'cancel_reason', o.cancel_reason, 'hub', s.name,
           'received_at', o.received_at, 'received_by', rb.display_name, 'receipt_id', o.receipt_id,
           'supplier_ref', (select g.supplier_ref from goods_receipts g where g.id = o.receipt_id),
           'supplier', jsonb_build_object('id', su.id, 'name', su.name, 'phone', su.phone, 'terms', su.terms),
           'lines', coalesce((select jsonb_agg(jsonb_build_object('n', l.position, 'line_id', l.id, 'product_id', p.id, 'sku', p.sku, 'barcode', p.barcode,
                       'name_en', p.name_en, 'name_ar', coalesce(p.name_ar, p.name_en), 'qty', l.qty, 'unit', p.sell_unit, 'storage', p.storage,
                       'unit_cost_usd', l.unit_cost_usd,
                       'received', (select jsonb_build_object('counted', rl.counted, 'damaged', rl.damaged, 'received', rl.received, 'short', rl.short,
                                      'lot', rl.lot, 'expiry_date', rl.expiry_date, 'unit_cost_usd', rl.unit_cost_usd, 'note', rl.note)
                                      from receiving_lines rl where rl.po_line_id = l.id)) order by l.position)
                     from purchase_order_lines l join products p on p.id = l.product_id where l.po_id = o.id), '[]'::jsonb))
         || case when o.status = 'received' then receiving_summary(o.id) else '{}'::jsonb end
    from purchase_orders o join suppliers su on su.id = o.supplier_id join sources s on s.id = o.source_id
    left join parties cb on cb.id = o.created_by left join parties rb on rb.id = o.received_by
   where o.id = p_po $$;

-- The label day (0211): items received on a purchase order and not yet photographed come first, then the shelf order as before.
create or replace function label_capture_received(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from receiving_lines rl where rl.product_id = p_product and rl.received > 0) $$;

create or replace function label_capture_next(p_after uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with o as (select s.*, row_number() over (order by label_capture_received(s.product_id) desc, s.sort_order, s.aisle, s.name_en, s.product_id) as rn
               from label_capture_status s),
       cur as (select rn from o where product_id = p_after)
  select label_capture_json(coalesce(
    (select product_id from o where not done and rn > coalesce((select rn from cur), 0) order by rn limit 1),
    (select product_id from o where not done order by rn limit 1))) $$;

create or replace function label_capture_items(p_only_missing boolean default true, p_no_barcode boolean default false, p_limit int default 400)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(label_capture_json(x.product_id) order by x.received desc, x.sort_order, x.aisle, x.name_en, x.product_id), '[]'::jsonb)
    from (select s.*, label_capture_received(s.product_id) as received from label_capture_status s
           where (not p_only_missing or not s.done) and (not p_no_barcode or not s.has_barcode)
           order by label_capture_received(s.product_id) desc, s.sort_order, s.aisle, s.name_en, s.product_id limit greatest(p_limit, 1)) x $$;

do $$ declare r text;
begin
  alter table receiving_lines enable row level security;
  foreach r in array array['anon', 'authenticated', 'web_channel'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table receiving_lines from %I', r); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
