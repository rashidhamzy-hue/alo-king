-- 0010: a rider who was paid in lira keeps their earnings in lira.
-- Earnings are kept from the cash the rider is carrying: dollars first, then lira at the value they were collected at.
-- Only what the rider's cash cannot cover is paid from the hub till.
create or replace function pay_rider_earnings(p_driver uuid, p_by uuid) returns jsonb language plpgsql as $$
declare v_txn uuid := gen_random_uuid(); r record; n record; v_left numeric; v_take numeric; v_usd numeric; v_lbp numeric; v_lbp_val numeric;
        v_lbp_take numeric; v_cash uuid; v_kept_usd numeric := 0; v_kept_lbp numeric := 0; v_kept_lbp_val numeric := 0; v_hub numeric := 0;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
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

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
