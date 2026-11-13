-- Alo King Chouf, session D2 (console): complaint cases (3.16) and the day-open checklist (3.17).
--
-- 3.16 One record per complaint: the order, the kind (late, missing, wrong, quality, allergen, payment), who owns it, what was
--      done, the refunds it led to, and who closed it. An allergen complaint opens at the top of the queue and holds the product
--      (hold_product, 0025) until a person clears it with release_hold. The money side is refund_order (0030); a case only links it.
-- 3.17 One function for the morning screen: orders waiting, deliveries not closed from before today, stock expiring in three days,
--      rider drops not yet counted and payment proofs not yet reviewed, rider cash and rider payables outstanding, open cases and
--      exceptions, and the cron's last heartbeat.

create table complaint_cases (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id),
  kind        text not null check (kind in ('late', 'missing', 'wrong', 'quality', 'allergen', 'payment')),
  priority    smallint not null,                                -- 0 = allergen, top of the queue; 1 = the rest
  detail      text not null,
  product_id  uuid references products(id),
  hold_id     uuid references product_holds(id),
  owner_id    uuid references parties(id),
  status      text not null default 'open' check (status in ('open', 'closed')),
  actions     jsonb not null default '[]',                      -- [{at, by, note}]: what was done, in order
  refund_ids  uuid[] not null default '{}',
  opened_by   uuid not null references parties(id),
  opened_at   timestamptz not null default now(),
  closed_by   uuid references parties(id),
  closed_at   timestamptz,
  outcome     text,
  request_key text unique,
  check (kind <> 'allergen' or product_id is not null),
  check ((status = 'closed') = (closed_at is not null))
);
create index complaint_cases_open on complaint_cases(priority, opened_at) where status = 'open';
create index complaint_cases_order on complaint_cases(order_id);

create or replace function complaint_staff(p_by uuid) returns void language plpgsql stable as $$
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
end $$;

create or replace function open_complaint(p_order uuid, p_kind text, p_detail text, p_by uuid, p_product uuid default null, p_key text default null)
returns jsonb language plpgsql as $$
declare k complaint_cases%rowtype; o orders%rowtype; v_hold jsonb; v_hold_id uuid;
begin
  if p_key is not null then
    select * into k from complaint_cases where request_key = p_key;
    if found then return jsonb_build_object('ok', true, 'duplicate', true, 'case_id', k.id); end if;
  end if;
  perform complaint_staff(p_by);
  select * into o from orders where id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_kind not in ('late', 'missing', 'wrong', 'quality', 'allergen', 'payment') then raise exception 'UNKNOWN_KIND %', p_kind; end if;
  if length(btrim(coalesce(p_detail, ''))) < 3 then raise exception 'DETAIL_REQUIRED'; end if;
  if p_product is not null and not exists (select 1 from order_items where order_id = p_order and product_id = p_product) then raise exception 'ITEM_NOT_ON_ORDER'; end if;
  if p_kind = 'allergen' then
    if p_product is null then raise exception 'PRODUCT_REQUIRED for an allergen complaint'; end if;
    v_hold := hold_product(p_product, p_by, 'Allergen complaint on ' || o.short_code || ': ' || btrim(p_detail));
    v_hold_id := (v_hold->>'hold_id')::uuid;
  end if;
  insert into complaint_cases(order_id, kind, priority, detail, product_id, hold_id, owner_id, opened_by, request_key, actions)
    values (p_order, p_kind, case when p_kind = 'allergen' then 0 else 1 end, btrim(p_detail), p_product, v_hold_id, p_by, p_by, p_key,
            jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'note', 'Opened' || case when v_hold_id is not null then '; product held' else '' end)))
    returning * into k;
  if p_kind = 'allergen' then
    perform raise_ops_exception('allergen_complaint', k.id::text, jsonb_build_object('order', o.short_code, 'product_id', p_product));
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'case_id', k.id, 'held', v_hold_id is not null,
                            'open_orders', coalesce(v_hold->'open_orders', '[]'::jsonb));
end $$;

-- What was done, in the case's own words. Also: hand the case to another lead; link a refund on the same order.
create or replace function note_complaint(p_case uuid, p_by uuid, p_note text, p_owner uuid default null, p_refund uuid default null)
returns jsonb language plpgsql as $$
declare k complaint_cases%rowtype;
begin
  perform complaint_staff(p_by);
  select * into k from complaint_cases where id = p_case for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if k.status = 'closed' then raise exception 'CASE_CLOSED'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'NOTE_REQUIRED'; end if;
  if p_owner is not null and not exists (select 1 from parties where id = p_owner and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'OWNER_NOT_STAFF'; end if;
  if p_refund is not null and not exists (select 1 from refunds where id = p_refund and order_id = k.order_id) then raise exception 'REFUND_NOT_ON_ORDER'; end if;
  update complaint_cases set owner_id = coalesce(p_owner, owner_id),
         refund_ids = case when p_refund is null or p_refund = any(refund_ids) then refund_ids else refund_ids || p_refund end,
         actions = actions || jsonb_build_object('at', now(), 'by', p_by, 'note', btrim(p_note), 'refund', p_refund, 'owner', p_owner)
   where id = p_case;
  return jsonb_build_object('ok', true);
end $$;

-- Closing says what came of it. An allergen case's hold is cleared only when the person says so (release_hold records who and why);
-- otherwise the product stays off sale after the case is closed.
create or replace function close_complaint(p_case uuid, p_by uuid, p_outcome text, p_release_hold boolean default false) returns jsonb language plpgsql as $$
declare k complaint_cases%rowtype; v_released boolean := false;
begin
  perform complaint_staff(p_by);
  select * into k from complaint_cases where id = p_case for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if k.status = 'closed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if length(btrim(coalesce(p_outcome, ''))) < 3 then raise exception 'OUTCOME_REQUIRED'; end if;
  if p_release_hold and k.product_id is not null and product_on_hold(k.product_id) then
    perform release_hold(k.product_id, p_by, 'Case closed: ' || btrim(p_outcome));
    v_released := true;
  end if;
  update complaint_cases set status = 'closed', closed_by = p_by, closed_at = now(), outcome = btrim(p_outcome),
         actions = actions || jsonb_build_object('at', now(), 'by', p_by, 'note', 'Closed: ' || btrim(p_outcome) || case when v_released then '; hold cleared' else '' end)
   where id = p_case;
  update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
   where kind = 'allergen_complaint' and ref = p_case::text and status <> 'resolved';
  return jsonb_build_object('ok', true, 'already', false, 'hold_released', v_released,
                            'still_held', k.product_id is not null and product_on_hold(k.product_id));
end $$;

do $$ declare r text;
begin
  alter table complaint_cases enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table complaint_cases from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table complaint_cases to service_role;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
