-- 0009: founder decisions of 12 November 2026.
--   1. Riders keep the delivery fee and tips. Alo King pays no hourly wage. The fee is money collected on the
--      rider's behalf, not company revenue.
--   2. Only restaurants that have accepted the terms, with an approved menu and a contracted commission, are orderable.
--   (3. The service area is undecided: villages and zones stay as draft seed data. No schema change.)

-- ---------- 1. rider earnings ----------
alter type account_kind add value if not exists 'rider_payable';
insert into settings(key, value) values
  ('rider_pay', '{"fee_share": 1.0, "tip_share": 1.0, "min_guarantee_per_hour_usd": 0}') on conflict (key) do nothing;

-- When an order is paid and delivered, the delivery fee stops being ours and becomes owed to the rider who carried it.
-- COD tips are already posted to that rider; a tip on a prepaid order is moved to them here. Runs once per order.
create or replace function settle_rider_earnings(p_order uuid, p_driver uuid) returns numeric language plpgsql as $$
declare o orders%rowtype; rp jsonb := setting('rider_pay'); v_fee numeric; v_tip numeric := 0; v_txn uuid := gen_random_uuid();
begin
  if exists (select 1 from ledger_entries where order_id = p_order and memo = 'Delivery fee to rider') then return 0; end if;
  select * into o from orders where id = p_order;
  v_fee := round(o.delivery_fee_usd * (rp->>'fee_share')::numeric, 2);
  if o.payment_method <> 'cod' then v_tip := round(o.tip_usd * (rp->>'tip_share')::numeric, 2); end if;
  if v_fee > 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('revenue_delivery', 'revenue_delivery'), v_fee, 'USD', v_fee, p_order, 'Delivery fee to rider'),
      (v_txn, ensure_account('rider_payable:' || p_driver, 'rider_payable'::account_kind, p_driver), -v_fee, 'USD', -v_fee, p_order, 'Delivery fee to rider');
  end if;
  if v_tip > 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('tips_payable', 'tips_payable'), v_tip, 'USD', v_tip, p_order, 'Tip to rider'),
      (v_txn, ensure_account('tips_payable:' || p_driver, 'tips_payable', p_driver), -v_tip, 'USD', -v_tip, p_order, 'Tip to rider');
  end if;
  return v_fee + v_tip;
end $$;

create or replace function settle_rider_on_close() returns trigger language plpgsql as $$
declare v_driver uuid;
begin
  if new.to_status = 'closed' and new.reason = 'paid_and_delivered' then
    select d.driver_id into v_driver from delivery_stops s join deliveries d on d.id = s.delivery_id
     where s.order_id = new.order_id and s.kind = 'dropoff' and d.status in ('in_progress','completed') order by d.offered_at desc limit 1;
    if v_driver is not null then perform settle_rider_earnings(new.order_id, v_driver); end if;
  end if;
  return new;
end $$;
drop trigger if exists order_events_rider_earnings on order_events;
create trigger order_events_rider_earnings after insert on order_events for each row execute function settle_rider_on_close();

create or replace function rider_earnings_usd(p_driver uuid) returns numeric language sql stable as $$
  select coalesce(-sum(e.usd_equiv), 0) from ledger_entries e join ledger_accounts a on a.id = e.account_id
   where a.code in ('rider_payable:' || p_driver, 'tips_payable:' || p_driver) $$;

-- What the rider sees at the end of a shift: cash carried, what of it is theirs, what they hand over.
create or replace function rider_statement(p_driver uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('cash_held_usd', driver_cash_usd(p_driver), 'earnings_usd', rider_earnings_usd(p_driver),
                            'to_hand_over_usd', driver_cash_usd(p_driver) - rider_earnings_usd(p_driver)) $$;

-- Pays the rider what they earned. First out of the dollars they are already carrying (they simply keep them);
-- anything beyond that is paid from the hub till. Ops confirms it, like a cash drop.
create or replace function pay_rider_earnings(p_driver uuid, p_by uuid) returns jsonb language plpgsql as $$
declare v_txn uuid := gen_random_uuid(); r record; v_left numeric; v_take numeric; v_usd numeric; v_kept numeric := 0; v_hub numeric := 0;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rider:' || p_driver, 0));
  select usd into v_usd from driver_cash_native(p_driver);
  v_usd := greatest(coalesce(v_usd, 0), 0);
  for r in select a.id, -sum(e.usd_equiv) as owed from ledger_entries e join ledger_accounts a on a.id = e.account_id
            where a.code in ('rider_payable:' || p_driver, 'tips_payable:' || p_driver) group by a.id having -sum(e.usd_equiv) > 0 loop
    v_left := r.owed;
    v_take := least(v_left, v_usd);
    if v_take > 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, r.id, v_take, 'USD', v_take, 'Rider earnings kept from cash'),
        (v_txn, ensure_account('driver_cash:' || p_driver, 'driver_cash', p_driver), -v_take, 'USD', -v_take, 'Rider earnings kept from cash');
      v_usd := v_usd - v_take; v_left := v_left - v_take; v_kept := v_kept + v_take;
    end if;
    if v_left > 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, r.id, v_left, 'USD', v_left, 'Rider earnings paid from hub'),
        (v_txn, ensure_account('hub_cash', 'hub_cash'), -v_left, 'USD', -v_left, 'Rider earnings paid from hub');
      v_hub := v_hub + v_left;
    end if;
  end loop;
  return jsonb_build_object('kept_from_cash_usd', v_kept, 'paid_from_hub_usd', v_hub, 'cash_still_held_usd', driver_cash_usd(p_driver));
end $$;

-- ---------- 2. restaurants: onboarded or not orderable ----------
alter table sources add column if not exists terms_accepted_at timestamptz;
alter table sources add column if not exists approved_by uuid references parties(id);
alter table sources add column if not exists approved_at timestamptz;
update sources set tier = 'assisted' where tier = 'manual';
alter table sources drop constraint if exists sources_tier_check;
alter table sources add constraint sources_tier_check check (tier in ('integrated','assisted'));
comment on column sources.tier is 'integrated: takes orders by button or POS. assisted: ops phones the order in. Both are onboarded partners; there is no un-onboarded tier.';

-- A restaurant cannot be open for orders until a person has approved it. This holds whatever code tries to open it.
create or replace function merchant_must_be_approved() returns trigger language plpgsql as $$
begin
  if new.kind = 'merchant' and new.approved_at is null then new.is_open := false; end if;
  return new;
end $$;
drop trigger if exists sources_approval on sources;
create trigger sources_approval before insert or update on sources for each row execute function merchant_must_be_approved();
update sources set is_open = false where kind = 'merchant' and approved_at is null;

-- The one way a restaurant becomes orderable: terms accepted, commission agreed, and an approved menu with prices.
create or replace function approve_merchant(p_source uuid, p_by uuid, p_commission_pct numeric, p_terms_accepted_at timestamptz default now()) returns jsonb language plpgsql as $$
declare v_items int;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_source and kind = 'merchant') then raise exception 'NOT_A_MERCHANT'; end if;
  if p_commission_pct is null or p_commission_pct <= 0 or p_commission_pct > 40 then raise exception 'COMMISSION_REQUIRED'; end if;
  select count(*) into v_items from offers where source_id = p_source and is_available and price_usd > 0;
  if v_items = 0 then raise exception 'NO_APPROVED_MENU'; end if;
  update sources set commission_pct = p_commission_pct, terms_accepted_at = p_terms_accepted_at, approved_by = p_by, approved_at = now(), is_open = true
   where id = p_source;
  return jsonb_build_object('ok', true, 'items', v_items, 'commission_pct', p_commission_pct);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
