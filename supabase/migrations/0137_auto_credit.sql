-- Alo King Chouf, session HO1 (the never-stranded hand-off), section D: safe automatic credit, the measures, the day-open list.
--
-- auto_credit_missing_item(order_item, by): a line the picker recorded missing on a PREPAID order is owed back as credit. Before
--   HO1 every such line was credited with no limit (pick_remove_line, 0031/0107). Now it is credited by itself only within the
--   three limits of settings.support.auto_credit: at most max_usd for the line, at most per_customer_month_usd and
--   per_customer_month_count of automatic credits for the customer in the hub's calendar month. Anything over a limit goes to a
--   person: a case of kind refund on the customer's chat (or an ops exception when there is no chat), and no money moves.
--   A cash order needs nothing: its total simply drops (recalc_order_lines). Wrong, damaged or disputed items never come here.
--   Every decision is logged in auto_credits with the picker who recorded the line (the Inbox page lists them for the spot check,
--   counted per picker). The money goes through grant_customer_credit (0030) as before: ledger, cap and request key unchanged.
-- pick_remove_line is 0107's text with that one call changed.
-- case_metrics(from, to): the measures of section D. day_open_checklist (0048) gains the open support cases, oldest first.

create table if not exists auto_credits (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references order_items(id),
  order_id      uuid not null references orders(id),
  customer_id   uuid not null references parties(id),
  picker_id     uuid references parties(id),
  amount_usd    numeric(10,2) not null check (amount_usd > 0),
  decision      text not null check (decision in ('credited', 'to_person')),
  why           text,
  refund_id     uuid references refunds(id),
  case_id       uuid references handoffs(id),
  created_at    timestamptz not null default now()
);
create index if not exists auto_credits_customer on auto_credits(customer_id, created_at);
create index if not exists auto_credits_picker on auto_credits(picker_id, created_at);

create or replace function auto_credit_missing_item(p_item uuid, p_by uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare i order_items%rowtype; o orders%rowtype; a auto_credits%rowtype; cfg jsonb := coalesce(setting('support')->'auto_credit', '{}'::jsonb);
        v_amt numeric; v_month timestamptz; v_used numeric; v_count int; v_why text; v_refund uuid; v_conv uuid; v_case jsonb;
begin
  select * into a from auto_credits where order_item_id = p_item;
  if found then return jsonb_build_object('decision', a.decision, 'credit_usd', case when a.decision = 'credited' then a.amount_usd else 0 end, 'already', true); end if;
  select * into i from order_items where id = p_item for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status not in ('missing', 'removed') or i.missing_at is null then raise exception 'LINE_NOT_MISSING %', i.status; end if;
  select * into o from orders where id = i.order_id;
  v_amt := round(i.qty * i.unit_price_usd, 2);
  if v_amt <= 0 or not exists (select 1 from payments where order_id = o.id and status = 'confirmed') then
    return jsonb_build_object('decision', 'none', 'credit_usd', 0);           -- a cash order: the total already dropped
  end if;
  -- The hub's calendar month (settings.hours.tz), so "this month" means what the customer and ops mean by it.
  v_month := date_trunc('month', now() at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut')) at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut');
  perform pg_advisory_xact_lock(hashtextextended('auto_credit:' || o.customer_id::text, 0));
  select coalesce(sum(amount_usd), 0), count(*) into v_used, v_count from auto_credits
   where customer_id = o.customer_id and decision = 'credited' and created_at >= v_month;
  v_why := case when v_amt > coalesce((cfg->>'max_usd')::numeric, 0) then 'over_max_usd'
                when v_used + v_amt > coalesce((cfg->>'per_customer_month_usd')::numeric, 0) then 'over_month_usd'
                when v_count + 1 > coalesce((cfg->>'per_customer_month_count')::int, 0) then 'over_month_count' end;
  if v_why is null then
    v_refund := grant_customer_credit(o.id, v_amt, 'goods', 'missing_at_pick', p_by, i.name_snapshot, i.id, 'pick:' || i.id);
    insert into auto_credits(order_item_id, order_id, customer_id, picker_id, amount_usd, decision, refund_id)
      values (i.id, o.id, o.customer_id, i.missing_by, v_amt, 'credited', v_refund);
    return jsonb_build_object('decision', 'credited', 'credit_usd', v_amt, 'refund_id', v_refund);
  end if;
  select id into v_conv from conversations where party_id = o.customer_id and line = 'customer';
  if v_conv is not null then
    v_case := open_case(v_conv, 'refund', 'missing at pick: ' || i.name_snapshot || ' (' || v_why || ')', o.id, 'auto_credit');
  else
    perform raise_ops_exception('refund_needs_person', i.id::text, jsonb_build_object('order', o.short_code, 'item', i.name_snapshot, 'usd', v_amt, 'why', v_why));
  end if;
  insert into auto_credits(order_item_id, order_id, customer_id, picker_id, amount_usd, decision, why, case_id)
    values (i.id, o.id, o.customer_id, i.missing_by, v_amt, 'to_person', v_why, (v_case->>'case_id')::uuid);
  return jsonb_build_object('decision', 'to_person', 'credit_usd', 0, 'why', v_why, 'case_id', v_case->>'case_id');
end $$;

create or replace function pick_remove_line(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare i order_items%rowtype; v_amt numeric; v_credit numeric := 0; v_auto jsonb;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  select * into i from order_items where id = p_missing for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if i.status = 'removed' then return jsonb_build_object('removed_usd', 0, 'already', true); end if;
  if i.status <> 'missing' then raise exception 'LINE_NOT_MISSING %', i.status; end if;
  update order_items set status = 'removed' where id = i.id;
  perform recalc_order_lines(i.order_id);
  v_amt := round(i.qty * i.unit_price_usd, 2);
  -- HO1: a prepaid order is credited by itself only within settings.support.auto_credit; over a limit a person decides.
  v_auto := auto_credit_missing_item(i.id, p_by);
  v_credit := coalesce((v_auto->>'credit_usd')::numeric, 0);
  return jsonb_build_object('removed_usd', v_amt, 'credit_usd', v_credit, 'credit', v_auto->>'decision');
end $$;

create or replace function case_metrics(p_from timestamptz, p_to timestamptz) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with c as (select * from handoffs where created_at >= p_from and created_at < p_to)
  select jsonb_build_object(
    'cases', (select count(*) from c),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from c group by kind) k), '{}'::jsonb),
    'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from c group by source) k), '{}'::jsonb),
    'minutes_to_claim_median', (select percentile_cont(0.5) within group (order by extract(epoch from claimed_at - created_at) / 60) from c where claimed_at is not null and not after_hours),
    'minutes_to_first_reply_median', (select percentile_cont(0.5) within group (order by extract(epoch from first_staff_reply_at - created_at) / 60) from c where first_staff_reply_at is not null and not after_hours),
    'late', (select count(*) from c where late),
    'pauses_expired', (select coalesce(sum(rounds), 0) from c),
    'callbacks', (select count(*) from c where callback_requested),
    'open', (select count(*) from c where state <> 'resolved'),
    'auto_credits', (select jsonb_build_object('credited', count(*) filter (where decision = 'credited'),
                                               'credited_usd', coalesce(sum(amount_usd) filter (where decision = 'credited'), 0),
                                               'to_person', count(*) filter (where decision = 'to_person'))
                       from auto_credits where created_at >= p_from and created_at < p_to),
    'unanswered', (select count(*) from ops_exceptions where kind = 'customer_unanswered' and created_at >= p_from and created_at < p_to)) $$;

-- 0048's day-open list, with the open support cases.
create or replace function day_open_checklist() returns jsonb language plpgsql stable as $$
declare b record; v_hub uuid;
begin
  select * into b from hub_day_bounds(hub_today());
  select id into v_hub from sources where kind = 'dark_store' order by id limit 1;
  return jsonb_build_object(
    'day', hub_today(),
    'orders_waiting', coalesce((select jsonb_agg(jsonb_build_object('order', o.short_code, 'status', o.status, 'since', coalesce(o.confirmed_at, o.created_at))
                                  order by coalesce(o.confirmed_at, o.created_at))
                                  from orders o join parties p on p.id = o.customer_id
                                 where not p.is_probe and o.status in ('awaiting_payment', 'confirmed', 'preparing', 'ready')), '[]'::jsonb),
    'not_closed_from_before_today', coalesce((select jsonb_agg(jsonb_build_object('order', o.short_code, 'status', o.status, 'created_at', o.created_at) order by o.created_at)
                                  from orders o join parties p on p.id = o.customer_id
                                 where not p.is_probe and o.created_at < b.since
                                   and o.status in ('awaiting_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'delivered', 'failed_delivery')), '[]'::jsonb),
    'expiring_in_3_days', case when v_hub is null then '[]'::jsonb else expiring_stock(v_hub, 3) end,
    'drops_not_counted', coalesce((select jsonb_agg(jsonb_build_object('rider', p.display_name, 'usd', d.declared_usd, 'lbp', d.declared_lbp, 'at', d.created_at) order by d.created_at)
                                  from cash_drops d join parties p on p.id = d.driver_id where d.status = 'declared'), '[]'::jsonb),
    'payment_proofs_waiting', (select count(*) from payment_proofs where status = 'pending'),
    'riders', coalesce((select jsonb_agg(jsonb_build_object('rider', p.display_name, 'usd', n.usd, 'lbp', n.lbp,
                                  'earnings_usd', (rider_statement(p.id)->>'earnings_usd')::numeric) order by p.display_name)
                          from parties p cross join lateral driver_cash_native(p.id) n
                         where p.role = 'driver' and (n.usd <> 0 or n.lbp <> 0 or (rider_statement(p.id)->>'earnings_usd')::numeric <> 0)), '[]'::jsonb),
    'open_cases', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'order', o.short_code, 'kind', k.kind, 'opened_at', k.opened_at) order by k.priority, k.opened_at)
                              from complaint_cases k join orders o on o.id = k.order_id where k.status = 'open'), '[]'::jsonb),
    -- HO1: open support cases head the list, oldest first (after hours they wait for opening).
    'support_cases', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'topic', h.topic, 'order', o.short_code,
                                 'opened_at', h.created_at, 'after_hours', h.after_hours, 'state', h.state) order by h.created_at)
                                 from handoffs h left join orders o on o.id = h.order_id where h.state <> 'resolved'), '[]'::jsonb),
    'open_exceptions', (select count(*) from ops_exceptions where status <> 'resolved'),
    'products_on_hold', (select count(*) from product_holds where released_at is null),
    'last_cron_at', (select at from heartbeats where name = 'cron'),
    'yesterday_closed', exists (select 1 from day_closes where day = hub_today() - 1));
end $$;

do $$ declare r text;
begin
  alter table auto_credits enable row level security;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table auto_credits from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table auto_credits to service_role; end if;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

select pin_search_paths();
