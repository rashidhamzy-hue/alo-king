-- Alo King Chouf, session F1 (G1 fixes): no function takes the hub drawer below zero (G1-02); damaged notes (G1-03);
-- paying a supplier (G1-08).
--
-- G1-02. D3 (0081) checked the drawer in the console's wrappers only. The check is now inside the base functions, so no caller
--   can take hub_cash below zero by the books:
--     * pay_supplier (0024): always paid from the drawer.
--     * pay_out_credit (0030): a cash payout.
--     * pay_rider_earnings (0010): step 3, "the hub pays the rest" (refused whole: nothing is kept from the rider's cash either,
--       so ops drops cash at the hub first and pays again).
--     * record_damaged_note (0004): a note removed from a hub drop.
--   pay_supplier_checked and pay_out_credit_checked (0081) still work unchanged; their check now runs twice under the same lock.
-- G1-03. record_damaged_note wrote the ledger with no role check, no request key and no bound: a double tap posted twice and a
--   negative amount added cash. It now takes a request key (required), is for the ops lead or an admin (require_role, so a
--   blocked party is refused), and refuses an amount that is not positive or that, with earlier notes on the same drop, exceeds it.
--   Each note is a row in damaged_notes.
-- G1-08. pay_supplier recognised a repeat by matching the ledger memo, and never compared the payment with what is owed. It now
--   takes a request key (each payment is a row in supplier_payments; without a key the supplier and reference stand in), still
--   answers a repeated reference as a repeat (payments made before this migration are found by their memo, as before), and refuses
--   more than is owed (EXCEEDS_OWED) unless the payment is marked as an advance.
-- Anyone redefining pay_supplier, pay_out_credit, pay_rider_earnings or record_damaged_note: start from here.

create table if not exists supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  amount_usd  numeric(12,2) not null check (amount_usd > 0),
  reference   text not null,
  advance     boolean not null default false,
  request_key text not null unique,
  ledger_txn  uuid not null,
  by_party    uuid not null references parties(id),
  created_at  timestamptz not null default now());
create index if not exists supplier_payments_supplier on supplier_payments(supplier_id, created_at);

create table if not exists damaged_notes (
  id          uuid primary key default gen_random_uuid(),
  drop_id     uuid not null references cash_drops(id),
  driver_id   uuid not null references parties(id),
  amount_usd  numeric(10,2) not null check (amount_usd > 0),
  absorbed_by text not null check (absorbed_by in ('company', 'rider')),
  request_key text not null unique,
  ledger_txn  uuid not null,
  by_party    uuid not null references parties(id),
  created_at  timestamptz not null default now());
create index if not exists damaged_notes_drop on damaged_notes(drop_id);

-- ---------- G1-08: pay_supplier, a request key and what is owed; G1-02: the drawer ----------
drop function if exists pay_supplier(uuid, numeric, uuid, text);
create or replace function pay_supplier(p_supplier uuid, p_amount_usd numeric, p_by uuid, p_ref text, p_key text default null,
                                        p_advance boolean default false) returns jsonb language plpgsql as $$
declare v_txn uuid := gen_random_uuid(); v_acct uuid; v_amt numeric := round(p_amount_usd, 2); v_key text; v_owed numeric; sp supplier_payments%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if length(btrim(coalesce(p_ref, ''))) < 3 then raise exception 'REFERENCE_REQUIRED'; end if;
  if not exists (select 1 from suppliers where id = p_supplier) then raise exception 'UNKNOWN_SUPPLIER'; end if;
  v_key := coalesce(nullif(btrim(p_key), ''), 'supplier:' || p_supplier || ':' || upper(btrim(p_ref)));
  perform pg_advisory_xact_lock(hashtextextended('supplier_pay:' || p_supplier, 0));      -- one payment at a time per supplier
  select * into sp from supplier_payments where request_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'owed_usd', supplier_balance(sp.supplier_id), 'advance', sp.advance);
  end if;
  v_acct := supplier_account(p_supplier);
  -- The same reference is the same payment, whatever the key (a payment from before supplier_payments is found by its memo).
  if exists (select 1 from ledger_entries where account_id = v_acct and memo = 'Supplier paid ' || btrim(p_ref)) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'owed_usd', supplier_balance(p_supplier));
  end if;
  v_owed := supplier_balance(p_supplier);
  if not coalesce(p_advance, false) and v_amt > v_owed + 0.005 then
    raise exception 'EXCEEDS_OWED we owe % USD; asked to pay % USD (mark it as an advance to pay ahead)', v_owed, v_amt;
  end if;
  perform drawer_can_pay(v_amt);                                                         -- G1-02
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, v_acct, v_amt, 'USD', v_amt, 'Supplier paid ' || btrim(p_ref)),
    (v_txn, ensure_account('hub_cash', 'hub_cash'), -v_amt, 'USD', -v_amt, 'Supplier paid ' || btrim(p_ref));
  insert into supplier_payments(supplier_id, amount_usd, reference, advance, request_key, ledger_txn, by_party)
    values (p_supplier, v_amt, btrim(p_ref), coalesce(p_advance, false), v_key, v_txn, p_by);
  return jsonb_build_object('ok', true, 'duplicate', false, 'owed_usd', supplier_balance(p_supplier), 'advance', coalesce(p_advance, false));
end $$;

-- ---------- G1-02: pay_out_credit (0030), a cash payout checks the drawer ----------
create or replace function pay_out_credit(p_party uuid, p_amount numeric, p_method text, p_by uuid, p_ref text default null, p_key text default null)
returns jsonb language plpgsql as $$
declare v_id uuid; v_txn uuid := gen_random_uuid(); v_amt numeric := round(p_amount, 2); v_free numeric; v_code text;
begin
  if p_key is not null then
    select id into v_id from credit_payouts where request_key = p_key;
    if v_id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'payout_id', v_id); end if;
  end if;
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_method not in ('cash', 'whish', 'omt') then raise exception 'UNKNOWN_METHOD %', p_method; end if;
  if p_method <> 'cash' and (p_ref is null or length(btrim(p_ref)) < 4) then raise exception 'REFERENCE_REQUIRED'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  perform 1 from parties where id = p_party for update;              -- one payout at a time per customer
  v_free := customer_credit_usd(p_party);
  if v_amt > v_free + 0.005 then raise exception 'EXCEEDS_CREDIT available %', v_free; end if;
  if p_method = 'cash' then perform drawer_can_pay(v_amt); end if;                          -- G1-02
  v_code := case p_method when 'cash' then 'hub_cash' when 'whish' then 'whish_clearing' else 'omt_clearing' end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, customer_credit_account(p_party), v_amt, 'USD', v_amt, 'Refund paid out (' || p_method || ')'),
    (v_txn, ensure_account(v_code, v_code::account_kind), -v_amt, 'USD', -v_amt, 'Refund paid out' || coalesce(' ' || btrim(p_ref), ''));
  insert into credit_payouts(customer_id, amount_usd, method, external_ref, ledger_txn, by_party, request_key)
    values (p_party, v_amt, p_method, nullif(btrim(p_ref), ''), v_txn, p_by, p_key) returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'payout_id', v_id, 'credit_left_usd', customer_credit_usd(p_party));
end $$;

-- ---------- G1-02, G1-06: pay_rider_earnings (0010), require_role and the drawer when the hub pays the rest ----------
create or replace function pay_rider_earnings(p_driver uuid, p_by uuid) returns jsonb language plpgsql as $$
declare v_txn uuid := gen_random_uuid(); r record; n record; v_left numeric; v_take numeric; v_usd numeric; v_lbp numeric; v_lbp_val numeric;
        v_lbp_take numeric; v_cash uuid; v_kept_usd numeric := 0; v_kept_lbp numeric := 0; v_kept_lbp_val numeric := 0; v_hub numeric := 0;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);                                 -- G1-06: a blocked party is refused
  perform pg_advisory_xact_lock(hashtextextended('rider:' || p_driver, 0));
  select * into n from driver_cash_native(p_driver);
  v_usd := greatest(coalesce(n.usd, 0), 0); v_lbp := greatest(coalesce(n.lbp, 0), 0); v_lbp_val := greatest(coalesce(n.lbp_carried_usd, 0), 0);
  v_cash := ensure_account('driver_cash:' || p_driver, 'driver_cash', p_driver);
  for r in select a.id, -sum(e.usd_equiv) as owed from ledger_entries e join ledger_accounts a on a.id = e.account_id
            where a.code in ('rider_payable:' || p_driver, 'tips_payable:' || p_driver) group by a.id having -sum(e.usd_equiv) > 0 loop
    v_left := r.owed;
    v_take := least(v_left, v_usd);                                  -- 1. dollars in hand
    if v_take > 0 then
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, r.id, v_take, 'USD', v_take, 'Rider earnings kept from cash'),
        (v_txn, v_cash, -v_take, 'USD', -v_take, 'Rider earnings kept from cash');
      v_usd := v_usd - v_take; v_left := v_left - v_take; v_kept_usd := v_kept_usd + v_take;
    end if;
    if v_left > 0 and v_lbp > 0 and v_lbp_val > 0 then               -- 2. lira in hand, at the value it was collected at
      v_take := least(v_left, v_lbp_val);
      v_lbp_take := case when v_take = v_lbp_val then v_lbp else least(v_lbp, round(v_take * v_lbp / v_lbp_val / 1000) * 1000) end;
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, r.id, v_take, 'USD', v_take, 'Rider earnings kept from cash'),
        (v_txn, v_cash, -v_lbp_take, 'LBP', -v_take, 'Rider earnings kept from cash');
      v_lbp := v_lbp - v_lbp_take; v_lbp_val := v_lbp_val - v_take; v_left := v_left - v_take;
      v_kept_lbp := v_kept_lbp + v_lbp_take; v_kept_lbp_val := v_kept_lbp_val + v_take;
    end if;
    if v_left > 0 then                                               -- 3. the hub pays the rest
      perform drawer_can_pay(v_left);                                -- G1-02: never below zero; refused whole
      insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
        (v_txn, r.id, v_left, 'USD', v_left, 'Rider earnings paid from hub'),
        (v_txn, ensure_account('hub_cash', 'hub_cash'), -v_left, 'USD', -v_left, 'Rider earnings paid from hub');
      v_hub := v_hub + v_left;
    end if;
  end loop;
  select * into n from driver_cash_native(p_driver);
  return jsonb_build_object('kept_from_cash_usd', v_kept_usd + v_kept_lbp_val, 'kept_usd', v_kept_usd, 'kept_lbp', v_kept_lbp,
                            'paid_from_hub_usd', v_hub, 'to_hand_over_usd', n.usd, 'to_hand_over_lbp', n.lbp,
                            'cash_still_held_usd', driver_cash_usd(p_driver));
end $$;

-- ---------- G1-03: record_damaged_note, a request key, the ops lead, a bound; G1-02: the drawer ----------
drop function if exists record_damaged_note(uuid, numeric, uuid);
create or replace function record_damaged_note(p_drop uuid, p_amount_usd numeric, p_by uuid, p_key text) returns jsonb language plpgsql as $$
declare d cash_drops%rowtype; v_prior int; v_txn uuid := gen_random_uuid(); v_who text; v_acct uuid; v_amt numeric := round(p_amount_usd, 2);
        v_value numeric; v_taken numeric; dn damaged_notes%rowtype;
begin
  if length(btrim(coalesce(p_key, ''))) = 0 then raise exception 'REQUEST_KEY_REQUIRED'; end if;
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into dn from damaged_notes where request_key = p_key;
  if found then
    return jsonb_build_object('duplicate', true, 'absorbed_by', dn.absorbed_by, 'amount_usd', dn.amount_usd, 'note_id', dn.id);
  end if;
  if v_amt is null or v_amt <= 0 then raise exception 'BAD_AMOUNT'; end if;
  select * into d from cash_drops where id = p_drop for update;
  if not found then raise exception 'DROP_NOT_FOUND'; end if;
  v_value := d.declared_usd + case when d.declared_lbp > 0 then round(d.declared_lbp / d.fx_rate_lbp, 2) else 0 end;
  select coalesce(sum(amount_usd), 0) into v_taken from damaged_notes where drop_id = p_drop;
  if v_taken + v_amt > v_value + 0.005 then
    raise exception 'EXCEEDS_DROP the drop is worth % USD, % already recorded as damaged, % asked', v_value, v_taken, v_amt;
  end if;
  if d.method = 'hub' then perform drawer_can_pay(v_amt); end if;                         -- G1-02
  select count(*) into v_prior from risk_flags where subject_kind = 'driver' and subject_id = d.driver_id and rule = 'damaged_note'
     and created_at >= date_trunc('month', now());
  v_who := case when v_prior = 0 then 'company' else 'rider' end;
  v_acct := case when v_who = 'company' then ensure_account('write_off', 'write_off'::account_kind)
                 else ensure_account('rider_receivable:' || d.driver_id, 'rider_receivable'::account_kind, d.driver_id) end;
  insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
    (v_txn, ensure_account(case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end,
                           (case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end)::account_kind), -v_amt, 'USD', -v_amt, 'Damaged note removed'),
    (v_txn, v_acct, v_amt, 'USD', v_amt, 'Damaged note, absorbed by ' || v_who);
  insert into risk_flags(subject_kind, subject_id, rule, severity, details)
    values ('driver', d.driver_id, 'damaged_note', case when v_who = 'rider' then 2 else 1 end,
            jsonb_build_object('drop_id', p_drop, 'amount_usd', v_amt, 'absorbed_by', v_who, 'recorded_by', p_by));
  insert into damaged_notes(drop_id, driver_id, amount_usd, absorbed_by, request_key, ledger_txn, by_party)
    values (p_drop, d.driver_id, v_amt, v_who, p_key, v_txn, p_by) returning * into dn;
  update cash_drops set status = 'disputed' where id = p_drop and status <> 'confirmed';
  return jsonb_build_object('duplicate', false, 'absorbed_by', v_who, 'amount_usd', v_amt, 'notes_this_month', v_prior + 1, 'note_id', dn.id);
end $$;

do $$ declare r text; t text; begin
  foreach t in array array['supplier_payments', 'damaged_notes'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
