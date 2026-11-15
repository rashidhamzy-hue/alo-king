-- CX1 (customer pack), part 2: two one-tap choices on the order card (docs/strategy/02-journeys.md section 1, "Card and confirm";
-- 03 section B, "Substitutions" and "Cash on delivery").
--
-- (a) If an item is missing at the shelf: best match, ask me, or remove it. orders.missing_pref; null is "ask me", as before CX1.
--     best_match: the closest candidate the database already allows (same category and kind, in stock, never a dearer one on a paid
--     order, never anything when the customer has stated restrictions) is kept for the customer at once, but only when it costs at
--     most settings.card_choices.best_match_max_extra_usd more than the line it replaces; otherwise the line is taken off. A cheaper
--     substitute on a paid order is credited (answer_substitution, 0032). remove: the line is taken off without a question.
-- (b) Which note will you pay with? orders.change_for_usd (0003) holds the note; orders.keep_change_credit says the customer keeps the
--     change as credit. The rider then gives no change: rider_collect books the note, the order's total, and the rest as the
--     customer's credit (a liability, customer_credit:<party>), in one balanced transaction. Without the choice nothing changes.
-- The customer sets either choice by tap (set_order_choice) on their own order: the missing-item choice until picking starts, the
-- note until the rider has handed the order over. Models never set them.

alter table orders add column if not exists missing_pref text check (missing_pref in ('best_match', 'ask', 'remove'));
alter table orders add column if not exists keep_change_credit boolean not null default false;

insert into settings(key, value) values ('card_choices', '{"notes_usd": [10, 20, 50, 100], "best_match_max_extra_usd": 0.5}')
  on conflict (key) do nothing;

create or replace function set_order_choice(p_order uuid, p_party uuid, p_choice text, p_value text) returns jsonb language plpgsql as $$
declare o orders%rowtype; v_note numeric; v_picking boolean;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id is distinct from p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  v_picking := exists (select 1 from pick_sessions where order_id = p_order);
  if p_choice = 'missing' then
    if p_value not in ('best_match', 'ask', 'remove') then raise exception 'UNKNOWN_VALUE %', p_value; end if;
    if o.status not in ('draft', 'awaiting_confirmation', 'awaiting_payment', 'confirmed') or v_picking then
      return jsonb_build_object('ok', false, 'reason', 'too_late', 'short_code', o.short_code, 'status', o.status);
    end if;
    update orders set missing_pref = p_value where id = p_order;
    return jsonb_build_object('ok', true, 'choice', 'missing', 'value', p_value, 'short_code', o.short_code);
  elsif p_choice in ('note', 'keep_change') then
    if o.payment_method <> 'cod' then return jsonb_build_object('ok', false, 'reason', 'not_cash', 'short_code', o.short_code); end if;
    if o.status not in ('draft', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived') then
      return jsonb_build_object('ok', false, 'reason', 'too_late', 'short_code', o.short_code, 'status', o.status);
    end if;
    if p_choice = 'note' then
      if p_value = 'exact' then
        update orders set change_for_usd = null, keep_change_credit = false where id = p_order;
        return jsonb_build_object('ok', true, 'choice', 'note', 'note_usd', null, 'short_code', o.short_code, 'total_usd', o.total_usd);
      end if;
      v_note := p_value::numeric;
      if v_note is null or not (coalesce(setting('card_choices')->'notes_usd', '[]'::jsonb) @> to_jsonb(v_note)
                                or coalesce(setting('card_choices')->'notes_usd', '[]'::jsonb) @> to_jsonb(v_note::int)) then
        raise exception 'UNKNOWN_NOTE %', p_value;
      end if;
      if v_note <= o.total_usd then
        return jsonb_build_object('ok', false, 'reason', 'note_too_small', 'short_code', o.short_code, 'total_usd', o.total_usd);
      end if;
      update orders set change_for_usd = v_note where id = p_order;
      return jsonb_build_object('ok', true, 'choice', 'note', 'note_usd', v_note, 'change_usd', v_note - o.total_usd,
                                'keep_change', o.keep_change_credit, 'short_code', o.short_code, 'total_usd', o.total_usd);
    end if;
    if o.change_for_usd is null or o.change_for_usd <= o.total_usd then
      return jsonb_build_object('ok', false, 'reason', 'needs_note', 'short_code', o.short_code);
    end if;
    update orders set keep_change_credit = coalesce(p_value, 'true')::boolean where id = p_order;
    return jsonb_build_object('ok', true, 'choice', 'keep_change', 'keep_change', coalesce(p_value, 'true')::boolean,
                              'note_usd', o.change_for_usd, 'change_usd', o.change_for_usd - o.total_usd, 'short_code', o.short_code);
  end if;
  raise exception 'UNKNOWN_CHOICE %', p_choice;
end $$;

-- Copied from 0107, with the customer's choice applied first. "ask" (or none) is 0107's behaviour unchanged.
create or replace function pick_decide_missing(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare c jsonb; v_pref text; v_order uuid; v_party uuid; v_max numeric; x jsonb; v_offer jsonb; v_kept jsonb;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  select o.missing_pref, o.id, o.customer_id into v_pref, v_order, v_party
    from order_items i join orders o on o.id = i.order_id where i.id = p_missing;
  if v_pref = 'remove' then
    return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed', 'preference', 'remove');
  end if;
  if coalesce((setting('picking')->>'offer_substitutes')::boolean, false) then
    c := substitute_candidates(p_missing);
    if v_pref = 'best_match' then
      v_max := coalesce((setting('card_choices')->>'best_match_max_extra_usd')::numeric, 0);
      select e into x from jsonb_array_elements(c->'candidates') with ordinality as t(e, n)
       where (e->>'diff_usd')::numeric <= v_max order by n limit 1;
      if x is not null and p_by is not null then
        v_offer := pick_offer_substitute(p_missing, (x->>'product_id')::uuid, p_by);
        v_kept := answer_substitution((v_offer->>'offer_id')::uuid, v_party, true, 'standing_choice:best_match');
        return jsonb_build_object('decision', 'substituted', 'preference', 'best_match', 'offer_id', v_offer->>'offer_id',
                                  'substitute_name', v_offer->>'substitute_name', 'diff_usd', (v_offer->>'diff_usd')::numeric,
                                  'removed_usd', 0, 'credit_usd', greatest(-(v_offer->>'diff_usd')::numeric, 0));
      end if;
      return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed', 'preference', 'best_match',
                                                                     'blocked', coalesce(c->>'blocked', 'no_close_match'));
    end if;
    if jsonb_array_length(c->'candidates') > 0 then
      return jsonb_build_object('decision', 'pending', 'candidates', c->'candidates', 'removed_usd', 0, 'credit_usd', 0);
    end if;
    return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed', 'blocked', c->'blocked');
  end if;
  return pick_remove_line(p_missing, p_by) || jsonb_build_object('decision', 'removed');
end $$;

-- Copied from 0006, with the change kept as credit. The rider types what they received and the change they gave (none, when
-- the customer keeps it). What is left above the total, on an order whose customer chose to keep the change, becomes their
-- credit: the driver's cash holds the whole note, the customer's credit account the rest. Otherwise unchanged: more than a
-- dollar off still raises AMOUNT_MISMATCH.
create or replace function rider_collect(
  p_order uuid, p_driver uuid, p_usd numeric, p_lbp numeric, p_change_usd numeric default 0, p_change_lbp numeric default 0
) returns jsonb language plpgsql as $$
declare s delivery_stops%rowtype; o orders%rowtype; v_fx numeric; v_in numeric; v_out numeric; v_gate text; n record;
        v_extra numeric := 0; v_txn uuid;
begin
  s := rider_owns_stop(p_order, p_driver);
  select * into o from orders where id = p_order for update;
  if exists (select 1 from payments where order_id = p_order and status = 'confirmed') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'cash_usd', driver_cash_usd(p_driver));
  end if;
  if o.status not in ('delivered','arrived','out_for_delivery') then raise exception 'NOT_AT_DOOR %', o.status; end if;
  if least(p_usd, p_lbp, p_change_usd, p_change_lbp) < 0 then raise exception 'NEGATIVE_AMOUNT'; end if;
  v_fx := coalesce(o.fx_rate_lbp, current_fx());
  v_in := p_usd + p_lbp / v_fx;  v_out := p_change_usd + p_change_lbp / v_fx;
  if v_out > v_in then raise exception 'CHANGE_EXCEEDS_RECEIVED'; end if;
  if o.keep_change_credit then
    v_extra := round(v_in - v_out - o.total_usd, 2);
    if v_extra < 0.01 then v_extra := 0; end if;
  end if;
  if o.status <> 'delivered' then perform rider_delivered(p_order, p_driver); end if;
  -- The change the customer kept is booked as if handed back, then received again as their credit: the order's own lines stay
  -- exactly its total, and the driver's cash ends at what they hold.
  perform post_cod_collection(p_order, p_driver, p_usd, p_lbp, p_change_usd + v_extra, p_change_lbp);
  if v_extra > 0 then
    v_txn := gen_random_uuid();
    insert into ledger_entries(txn_id, account_id, amount, currency, usd_equiv, order_id, memo) values
      (v_txn, ensure_account('driver_cash:' || p_driver, 'driver_cash', p_driver), v_extra, 'USD', v_extra, p_order, 'Change kept as credit'),
      (v_txn, customer_credit_account(o.customer_id), -v_extra, 'USD', -v_extra, p_order, 'Change kept as credit');
    update payments set change_usd = change_usd - v_extra where order_id = p_order and status = 'confirmed';
  end if;
  perform transition_order(p_order, 'closed', 'system', null, 'paid_and_delivered');
  select * into n from driver_cash_native(p_driver);
  v_gate := driver_can_take(p_driver, 0);
  return jsonb_build_object('ok', true, 'duplicate', false, 'cash_usd', driver_cash_usd(p_driver), 'usd', n.usd, 'lbp', n.lbp,
                            'gate', v_gate, 'delivery_done', finish_delivery_if_done(s.delivery_id), 'credit_usd', v_extra);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
