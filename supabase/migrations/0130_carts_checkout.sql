-- Alo King Chouf, session C4 (commerce core): the server-side cart and the checkout (docs/SYSTEM_PLAN.md section 1).
--
-- Nothing here prices anything. A cart is a list of (product, quantity, the price the page showed). Every view of it goes
-- through plan_cart (0085), the same function a WhatsApp catalog cart goes through, and plan_cart prices with quote_order (0118).
-- So a cart on the website and the same items sent from the WhatsApp catalog give the same lines, the same removals (unknown,
-- out of stock), the same "price changed" notes and the same totals. No stock is held by a cart.
--
--   cart_set_line(token, sku, qty, price_seen)  qty 0 removes the line; returns cart_view
--   cart_view(token)                             plan_cart for the session's party (or nobody yet): lines, quote, removed, price_changed
--   checkout_quote(token, place, slot, village)  plan_cart, then quote_order with W1's window parameter when a window is chosen.
--                                                A place must be the session party's own; a village alone (a visitor not linked yet)
--                                                quotes the fee for that village.
--   checkout_order(token, request_key, place, slot, payment, change_for, notes)
--                                                the card: create_order_for_turn (0118) with the turn key 'web:' || request key,
--                                                on the party's customer-line conversation, so a retried submit makes one card.
--                                                Only for a linked session (no anonymous cash order). channel = 'web'. The order
--                                                waits for the customer's confirm action (0131); this function never confirms.
-- One cart per session is open at a time. Once its order is confirmed (or further), the next line starts a new cart.

create table if not exists carts (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references web_sessions(id) on delete cascade,
  party_id    uuid references parties(id),                -- the session's party once linked
  status      text not null default 'open' check (status in ('open', 'ordered')),
  order_id    uuid references orders(id),                 -- the latest card made from this cart
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists carts_one_open on carts(session_id) where status = 'open';

create table if not exists cart_lines (
  cart_id        uuid not null references carts(id) on delete cascade,
  product_id     uuid not null references products(id),
  qty            int not null check (qty between 1 and 99),
  price_seen_usd numeric(10,2),                            -- what the page showed; only compared, never charged
  added_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (cart_id, product_id)
);

-- The session's open cart, unless its card was already confirmed (then the cart is done and reads as none). Read-only.
create or replace function web_cart_live(p_session uuid) returns uuid language sql stable as $$
  select c.id from carts c left join orders o on o.id = c.order_id
   where c.session_id = p_session and c.status = 'open'
     and (o.id is null or o.status in ('draft', 'awaiting_confirmation', 'cancelled'))
   limit 1
$$;

-- The cart as plan_cart reads a WhatsApp catalog cart: [{sku, qty, price, currency}].
create or replace function web_cart_items(p_cart uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'qty', l.qty, 'price', l.price_seen_usd, 'currency', 'USD')
                            order by l.added_at, p.sku), '[]'::jsonb)
    from cart_lines l join products p on p.id = l.product_id where l.cart_id = p_cart
$$;

create or replace function cart_view(p_token text) returns jsonb language plpgsql stable security definer as $$
declare s web_sessions%rowtype; v_cart uuid; v_items jsonb;
begin
  s := web_session_of(p_token);
  v_cart := web_cart_live(s.id);
  v_items := case when v_cart is null then '[]'::jsonb else web_cart_items(v_cart) end;
  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', true, 'cart_id', v_cart, 'linked', s.party_id is not null, 'lines', '[]'::jsonb,
                              'quote_lines', '[]'::jsonb, 'quote', null, 'issues', '[]'::jsonb, 'removed', '[]'::jsonb, 'price_changed', '[]'::jsonb);
  end if;
  return plan_cart(s.party_id, v_items, null, null) || jsonb_build_object('cart_id', v_cart, 'linked', s.party_id is not null);
end $$;

create or replace function cart_set_line(p_token text, p_sku text, p_qty int, p_price_seen numeric default null)
returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype; v_cart uuid; v_product uuid; v_qty int := least(greatest(coalesce(p_qty, 0), 0), 99);
begin
  s := web_session_of(p_token);
  select id into v_product from products where sku = p_sku and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_product', 'sku', p_sku); end if;
  v_cart := web_cart_live(s.id);
  if v_cart is null then
    update carts set status = 'ordered', updated_at = now() where session_id = s.id and status = 'open';   -- its card was confirmed
    insert into carts(session_id, party_id) values (s.id, s.party_id) returning id into v_cart;
  end if;
  if v_qty = 0 then
    delete from cart_lines where cart_id = v_cart and product_id = v_product;
  else
    insert into cart_lines(cart_id, product_id, qty, price_seen_usd) values (v_cart, v_product, v_qty, p_price_seen)
      on conflict (cart_id, product_id) do update
        set qty = excluded.qty, price_seen_usd = coalesce(excluded.price_seen_usd, cart_lines.price_seen_usd), updated_at = now();
  end if;
  update carts set updated_at = now(), party_id = coalesce(party_id, s.party_id) where id = v_cart;
  update web_sessions set last_seen_at = now() where id = s.id;
  return cart_view(p_token);
end $$;

create or replace function checkout_quote(p_token text, p_place uuid default null, p_slot uuid default null, p_village uuid default null)
returns jsonb language plpgsql stable security definer as $$
declare s web_sessions%rowtype; v_cart uuid; v_items jsonb; v_village uuid := p_village; plan jsonb; q jsonb;
        v_all jsonb; v_lines jsonb; v_out text[] := '{}'; v_removed jsonb; ln jsonb;
begin
  s := web_session_of(p_token);
  if p_place is not null then
    select village_id into v_village from customer_places where id = p_place and party_id = s.party_id;
    if not found or s.party_id is null then return jsonb_build_object('ok', false, 'error', 'not_your_place'); end if;
  end if;
  v_cart := web_cart_live(s.id);
  v_items := case when v_cart is null then '[]'::jsonb else web_cart_items(v_cart) end;
  if jsonb_array_length(v_items) = 0 then return jsonb_build_object('ok', false, 'error', 'empty_cart', 'cart_id', v_cart); end if;

  plan := plan_cart(s.party_id, v_items, v_village, null);
  if not coalesce((plan->>'ok')::boolean, false) then return plan; end if;
  if p_place is not null then plan := plan || jsonb_build_object('place_id', p_place); end if;

  if p_slot is not null then
    -- W1's window. plan_cart quoted for now and left out what is short now; a window may buy fresh goods for the order
    -- (quote_order, 0118), so every known line is quoted again for the window and only what the window cannot have is left out.
    select coalesce(jsonb_agg(jsonb_build_object('product_id', pid, 'qty', qty) order by pid), '[]'::jsonb) into v_all
      from (select l->>'product_id' as pid, sum((l->>'qty')::int) as qty from jsonb_array_elements(plan->'lines') l group by 1) x;
    q := quote_order(v_all, (plan->>'village_id')::uuid, false, p_slot);
    for ln in select * from jsonb_array_elements(q->'lines') loop
      if not (ln->>'ok')::boolean then v_out := v_out || (ln->>'product_id'); end if;
    end loop;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_removed from (
      select x from jsonb_array_elements(plan->'removed') x where x->>'reason' <> 'out_of_stock'
      union all
      select jsonb_build_object('sku', l->>'sku', 'name', l->>'name', 'name_ar', l->>'name_ar', 'reason', 'out_of_stock')
        from jsonb_array_elements(plan->'lines') l where l->>'product_id' = any(v_out)) y;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_lines from jsonb_array_elements(v_all) x where not (x->>'product_id' = any(v_out));
    q := case when jsonb_array_length(v_lines) > 0 then quote_order(v_lines, (plan->>'village_id')::uuid, false, p_slot) end;
    plan := plan || jsonb_build_object('quote_lines', v_lines, 'quote', q, 'issues', coalesce(q->'issues', '[]'::jsonb), 'removed', v_removed);
  end if;

  return plan || jsonb_build_object('cart_id', v_cart, 'slot_id', p_slot, 'linked', s.party_id is not null,
    'ready', plan->'quote' is not null and jsonb_typeof(plan->'quote') = 'object' and coalesce((plan->'quote'->>'ok')::boolean, false));
end $$;

create or replace function checkout_order(p_token text, p_request_key text, p_place uuid, p_slot uuid default null,
  p_payment payment_method default null, p_change_for numeric default null, p_notes text default null)
returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype; q jsonb; v_conv uuid; v_key text; o orders%rowtype; r jsonb;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('created', false, 'error', 'not_linked'); end if;
  if p_request_key is null or length(btrim(p_request_key)) < 8 then raise exception 'REQUEST_KEY_REQUIRED'; end if;
  if p_place is null then return jsonb_build_object('created', false, 'error', 'no_place'); end if;
  v_key := 'web:' || btrim(p_request_key);

  -- The same submit again after its card was confirmed: that order, never a second one.
  select * into o from orders where turn_key = v_key and customer_id = s.party_id order by created_at desc limit 1;
  if found and o.status not in ('draft', 'awaiting_confirmation', 'cancelled') then
    return jsonb_build_object('created', true, 'reused', true, 'order_id', o.id, 'short_code', o.short_code, 'status', o.status);
  end if;

  q := checkout_quote(p_token, p_place, p_slot, null);
  if not coalesce((q->>'ready')::boolean, false) then
    return jsonb_build_object('created', false, 'error', coalesce(q->>'error', 'not_ready'), 'quote', q->'quote',
                              'issues', coalesce(q->'issues', '[]'::jsonb), 'removed', coalesce(q->'removed', '[]'::jsonb));
  end if;
  select id into v_conv from conversations where party_id = s.party_id and line = 'customer';
  if v_conv is null then return jsonb_build_object('created', false, 'error', 'no_conversation'); end if;

  r := create_order_for_turn(v_key, s.party_id, v_conv, q->'quote_lines', (q->>'village_id')::uuid, p_place, false,
                             coalesce(p_payment, (q->>'payment_method')::payment_method), p_change_for, p_notes, p_slot);
  if coalesce((r->>'created')::boolean, false) then
    update orders set channel = 'web' where id = (r->>'order_id')::uuid and channel <> 'web';
    update carts set order_id = (r->>'order_id')::uuid, updated_at = now() where id = (q->>'cart_id')::uuid;
  end if;
  update web_sessions set last_seen_at = now() where id = s.id;
  return r || jsonb_build_object('removed', coalesce(q->'removed', '[]'::jsonb), 'price_changed', coalesce(q->'price_changed', '[]'::jsonb));
end $$;

alter table carts enable row level security;
alter table cart_lines enable row level security;
do $$ declare r text; t text;
begin
  foreach t in array array['carts', 'cart_lines'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
