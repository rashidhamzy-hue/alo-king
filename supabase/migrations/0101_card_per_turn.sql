-- 0101 (session SP1, audit G1-21): a retried turn reuses its draft order and card instead of issuing a second one.
--
-- Before: a turn that crashed after its card was sent ran again, create_order_from_quote() withdrew the first order
-- ('superseded_by_new_card') and made a second; the outbox skipped the second card because it had the first one's key, so
-- the customer held a card for a cancelled order. With reply keys by content (G1-19, apps/gateway/src/turn.ts) the second
-- card would even be sent.
--
-- orders.turn_key: the turn that created the order (null for orders made outside a customer turn).
-- create_order_for_turn(): create_order_from_quote() with the turn's key. When the same turn already made an order on this
-- conversation that still awaits the tap, for the same lines, place (a pin saved again by the retry counts as the same place
-- when its coordinates and village are the same), payment and price, it returns that order as it was
-- created (same id, same code, the same totals the card showed), and nothing is cancelled or written. Anything different
-- (another basket, a price that moved between the attempts) goes to create_order_from_quote() unchanged, which withdraws the
-- old card as before. create_order_from_quote() itself is not changed, nor any money function: dues and credit are read only.

alter table orders add column if not exists turn_key text;
create index if not exists orders_turn_key on orders(turn_key) where turn_key is not null;

create or replace function create_order_for_turn(
  p_turn_key text, p_customer uuid, p_conversation uuid, p_lines jsonb, p_village uuid, p_place uuid, p_pickup boolean,
  p_payment payment_method default 'cod', p_change_for numeric default null, p_notes text default null
) returns jsonb language plpgsql set search_path = public, extensions as $$
declare o orders%rowtype; q jsonb; v_credit numeric; v_dues numeric; v_total numeric; v_fx numeric; r jsonb; v_same boolean;
begin
  if p_turn_key is not null then
    select * into o from orders where turn_key = p_turn_key and conversation_id = p_conversation and customer_id = p_customer
       and status = 'awaiting_confirmation' order by created_at desc limit 1 for update;
    if found then
      q := quote_order(p_lines, p_village, p_pickup);
      -- the same basket: the same products in the same quantities
      v_same := (select coalesce(jsonb_agg(jsonb_build_array(pid, qty) order by pid, qty), '[]'::jsonb)
                   from (select l->>'product_id' as pid, sum((l->>'qty')::numeric) as qty from jsonb_array_elements(q->'lines') l group by 1) a)
              = (select coalesce(jsonb_agg(jsonb_build_array(pid, qty) order by pid, qty), '[]'::jsonb)
                   from (select product_id::text as pid, sum(qty) as qty from order_items where order_id = o.id group by 1) b);
      if (q->>'ok')::boolean and v_same
         and o.subtotal_usd = (q->>'subtotal_usd')::numeric and o.delivery_fee_usd = (q->>'delivery_fee_usd')::numeric
         and o.village_id is not distinct from p_village and o.is_pickup = p_pickup
         and (o.place_id is not distinct from p_place or exists (     -- a retried pin is saved again as a new row: the same place
               select 1 from customer_places a, customer_places b where a.id = o.place_id and b.id = p_place and a.party_id = b.party_id
                  and a.lat is not distinct from b.lat and a.lng is not distinct from b.lng and a.village_id is not distinct from b.village_id))
         and o.payment_method = p_payment and o.change_for_usd is not distinct from p_change_for
         and o.customer_notes is not distinct from p_notes then
        -- What create_order_from_quote returned the first time: the dues as they were before any credit came off them.
        select coalesce(sum(amount_usd), 0) into v_credit from credit_applications where order_id = o.id;
        v_dues := o.dues_usd + v_credit; v_total := (q->>'total_usd')::numeric + v_dues; v_fx := (q->>'fx_rate_lbp')::numeric;
        q := q || jsonb_build_object('dues_usd', v_dues, 'total_usd', v_total,
                                     'total_lbp', case when v_fx is null then null else round(v_total * v_fx / 1000) * 1000 end);
        return jsonb_build_object('created', true, 'reused', true, 'order_id', o.id, 'short_code', o.short_code,
                                  'payment_method', o.payment_method, 'change_for_usd', o.change_for_usd, 'quote', q);
      end if;
    end if;
  end if;
  r := create_order_from_quote(p_customer, p_conversation, p_lines, p_village, p_place, p_pickup, p_payment, p_change_for, p_notes);
  if (r->>'created')::boolean and p_turn_key is not null then
    update orders set turn_key = p_turn_key where id = (r->>'order_id')::uuid;
  end if;
  return r;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
