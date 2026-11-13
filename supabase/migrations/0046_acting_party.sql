-- Alo King Chouf, session D2 (console): who may act, checked in SQL.
--
-- 1. D1's findings. confirm_cash_drop (0004) and resolve_ops_exception (0008) took any party id as the actor. Both now refuse
--    anyone who is not the ops lead or an admin (NOT_AUTHORISED), and resolve_ops_exception refuses a status it does not know.
--    The console already allowed only those roles; now the database does too, whatever calls it.
--    receive_rider_cash (0035) calls confirm_cash_drop with its own checked ops lead, so it is unchanged.

-- ---------- 1. confirm_cash_drop: 0004's text, with the role check first ----------
create or replace function confirm_cash_drop(p_drop uuid, p_by uuid) returns numeric language plpgsql as $$
declare d cash_drops%rowtype; n record; v_txn uuid := gen_random_uuid(); v_lbp_equiv numeric; v_to text; v_kind account_kind; v_cash uuid;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into d from cash_drops where id = p_drop for update;
  if not found then raise exception 'DROP_NOT_FOUND'; end if;
  if d.status = 'confirmed' then return driver_cash_usd(d.driver_id); end if;
  select * into n from driver_cash_native(d.driver_id);
  if d.declared_usd > n.usd + 0.005 or d.declared_lbp > n.lbp + 0.5 then raise exception 'DROP_EXCEEDS_BALANCE holds % USD and % LBP', n.usd, n.lbp; end if;
  v_lbp_equiv := case when d.declared_lbp = 0 then 0 when n.lbp > 0 then round(d.declared_lbp * n.lbp_carried_usd / n.lbp, 2)
                      else round(d.declared_lbp / d.fx_rate_lbp, 2) end;
  v_to := case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end;
  v_kind := case d.method when 'hub' then 'hub_cash' else 'omt_clearing' end::account_kind;
  v_cash := ensure_account('driver_cash:' || d.driver_id, 'driver_cash', d.driver_id);
  if d.declared_usd <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_cash, -d.declared_usd, 'USD', -d.declared_usd, 'Cash drop ' || d.method),
      (v_txn, ensure_account(v_to, v_kind), d.declared_usd, 'USD', d.declared_usd, 'Cash drop ' || d.method);
  end if;
  if d.declared_lbp <> 0 then
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, memo) values
      (v_txn, v_cash, -d.declared_lbp, 'LBP', -v_lbp_equiv, 'Cash drop ' || d.method),
      (v_txn, ensure_account(v_to, v_kind), d.declared_lbp, 'LBP', v_lbp_equiv, 'Cash drop ' || d.method);
  end if;
  update cash_drops set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = p_drop;
  return driver_cash_usd(d.driver_id);
end $$;

-- ---------- 1. resolve_ops_exception: same signature and result, now checked ----------
create or replace function resolve_ops_exception(p_id uuid, p_by uuid, p_status text default 'resolved') returns void language plpgsql as $$
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_status is null or p_status not in ('acknowledged', 'resolved') then raise exception 'UNKNOWN_STATUS %', p_status; end if;
  update ops_exceptions set status = p_status, resolved_by = p_by, resolved_at = case when p_status = 'resolved' then now() end
   where id = p_id and status <> 'resolved';
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
