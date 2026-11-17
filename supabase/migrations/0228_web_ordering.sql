-- Alo King Chouf, session WEB2 (the website's day-one ordering; docs/WEBSITE.md, "Day one"). Migrations 0228 to 0230.
--
-- 0228: placing an order from the website, and the card the gateway sends for it.
--
-- (1) The page never confirms. C1 as decided for WEB2 (docs/DECISIONS.md, "WEB2, 17 November 2026"): the site sends the order card to the
--     customer's WhatsApp, and the tap there confirms, exactly as for a chat order (invariant 4 unchanged). settings.web.confirm_on_page is
--     set false here, so web_confirm_order (0131) answers 'confirm_on_whatsapp' and changes nothing even if called.
-- (2) web_place_order(token, ...) is checkout_order (0130) with the chat's own choices on the card:
--       payment   cash in dollars, with the note from settings.card_choices.notes_usd that is more than the total (the chat's "which note" rule,
--                 set_order_choice, 0144); cash in lira at today's rate, with a round amount above the lira total (a multiple of the smallest
--                 of settings.card_choices.lbp_steps, at most the largest step above it); or a Whish or OMT transfer a person confirms.
--                 The lira amount is also written on the order's note, so the picker and the rider read it where they read every note.
--       missing   the missing-item choice for the order (best_match, ask, remove), and an optional choice per item (order_items.missing_pref)
--                 that pick_decide_missing reads first.
--     It never confirms. It asks the gateway to send the card (web_card_requests): the website never sends a message itself (invariant 1).
-- (3) The gateway's minute cron reads web_cards_due() and sends each card through the gateway (packages/agents/src/web-orders.ts), then
--     web_card_done(). "Card AK-xxxx" typed by the website on WhatsApp sends the waiting card again (web_card_again, read by code in turn.ts):
--     it never confirms; only the card's button does.
-- (4) The order page's link is signed and expires: order_link(order) is '<expiry, unix seconds>.<HMAC-SHA256 of order and expiry, 128 bits>',
--     with a key that lives only in this database (web_link_key; no role but the owner reads it). It expires after settings.web.order_link_days,
--     and the page shows nothing 48 hours (settings.web.order_link_after_end_hours) after the order ended, whatever the link.

update settings set value = value || jsonb_build_object('confirm_on_page', false, 'order_link_days', 7, 'order_link_after_end_hours', 48),
       updated_at = now() where key = 'web';
update settings set value = jsonb_build_object('lbp_steps', jsonb_build_array(100000, 500000, 1000000)) || value, updated_at = now()
 where key = 'card_choices';

alter table orders add column if not exists cash_currency text check (cash_currency in ('usd', 'lbp'));
alter table orders add column if not exists change_for_lbp numeric(14,0) check (change_for_lbp > 0);
alter table order_items add column if not exists missing_pref text check (missing_pref in ('best_match', 'ask', 'remove'));

-- ---------- the signed link ----------
create table if not exists web_link_key (
  id     int primary key default 1 check (id = 1),
  secret bytea not null
);
insert into web_link_key(id, secret)
  values (1, decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'))
  on conflict (id) do nothing;
alter table web_link_key enable row level security;

-- HMAC-SHA256 (RFC 2104) with the database's own key, in hex. Internal: no role but the owner may call it.
create or replace function web_sign(p_msg text) returns text language plpgsql stable as $$
declare k bytea; ipad bytea; opad bytea; i int;
begin
  select secret into k from web_link_key where id = 1;
  if k is null then raise exception 'NO_LINK_KEY'; end if;
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k; opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);
    opad := set_byte(opad, i, get_byte(k, i) # 92);
  end loop;
  return encode(sha256(opad || sha256(ipad || convert_to(p_msg, 'UTF8'))), 'hex');
end $$;

-- A link for an order's page: '<expiry>.<signature>'. p_expires defaults to settings.web.order_link_days from now.
create or replace function order_link(p_order uuid, p_expires timestamptz default null) returns text language plpgsql stable as $$
declare v_exp bigint := floor(extract(epoch from coalesce(p_expires, now() + make_interval(days => coalesce((setting('web')->>'order_link_days')::int, 7)))));
begin
  return v_exp::text || '.' || left(web_sign(p_order::text || ':' || v_exp::text), 32);
end $$;

-- Is this the order's own link, and not expired? Compared in full; any other text is simply not the link.
create or replace function order_link_ok(p_order uuid, p_link text) returns boolean language plpgsql stable as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_link, ''), '^([0-9]{10})\.([0-9a-f]{32})$');
  if m is null then return false; end if;
  if to_timestamp(m[1]::bigint) <= now() then return false; end if;
  return left(web_sign(p_order::text || ':' || m[1]), 32) = m[2];
end $$;

-- ---------- the card the gateway sends ----------
create table if not exists web_card_requests (
  order_id      uuid primary key references orders(id) on delete cascade,
  session_id    uuid references web_sessions(id) on delete set null,
  lang          text not null default 'ar' check (lang in ('ar', 'en', 'fr')),
  requested_at  timestamptz not null default now(),
  done_at       timestamptz,
  outcome       text
);
create index if not exists web_card_requests_due on web_card_requests(requested_at) where done_at is null;
alter table web_card_requests enable row level security;

-- The cards to send now: the order still waits for its Confirm. One that no longer waits is closed here, never sent.
create or replace function web_cards_due(p_limit int default 20) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  update web_card_requests r set done_at = now(), outcome = 'not_waiting:' || o.status
    from orders o where o.id = r.order_id and r.done_at is null and o.status <> 'awaiting_confirmation';
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'customer_id', o.customer_id, 'conversation_id', o.conversation_id,
                                               'short_code', o.short_code, 'lang', r.lang) order by r.requested_at), '[]'::jsonb) into v
    from (select * from web_card_requests where done_at is null order by requested_at limit greatest(coalesce(p_limit, 20), 1)) r
    join orders o on o.id = r.order_id;
  return v;
end $$;

create or replace function web_card_done(p_order uuid, p_outcome text) returns void language sql as $$
  update web_card_requests set done_at = now(), outcome = left(coalesce(p_outcome, 'done'), 80) where order_id = p_order and done_at is null
$$;

-- "Card AK-xxxx" from the customer's own chat (the website types it): the sender's own card that still waits, to send again. Never confirms.
create or replace function web_card_again(p_party uuid, p_code text) returns jsonb language plpgsql stable as $$
declare o orders%rowtype; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into o from orders where short_code = v_code and customer_id = p_party;
  if not found then return jsonb_build_object('ok', false, 'status', 'unknown'); end if;
  if o.status <> 'awaiting_confirmation' then
    return jsonb_build_object('ok', false, 'status', 'not_waiting', 'order_status', o.status, 'short_code', o.short_code);
  end if;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'short_code', o.short_code);
end $$;

-- ---------- placing the order (the website's door; 0230 grants it to web_channel) ----------
create or replace function web_place_order(p_token text, p_request_key text, p_place uuid, p_slot uuid default null,
  p_payment payment_method default 'cod', p_cash text default null, p_note numeric default null, p_missing text default null,
  p_items jsonb default '{}'::jsonb, p_notes text default null, p_lang text default 'ar')
returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype; q jsonb; r jsonb; v_total numeric; v_fx numeric; v_lbp numeric; v_steps jsonb; v_min numeric; v_max numeric;
        v_cash text := nullif(btrim(coalesce(p_cash, '')), ''); v_notes text := nullif(btrim(coalesce(p_notes, '')), ''); v_change numeric;
        v_order uuid; k text; v text; v_lang text := case when p_lang in ('ar', 'en', 'fr') then p_lang else 'ar' end;
begin
  s := web_session_of(p_token);
  if s.party_id is null then return jsonb_build_object('created', false, 'error', 'not_linked'); end if;
  if p_missing is not null and p_missing not in ('best_match', 'ask', 'remove') then raise exception 'UNKNOWN_VALUE %', p_missing; end if;
  for k, v in select * from jsonb_each_text(coalesce(p_items, '{}'::jsonb)) loop
    if v not in ('best_match', 'ask', 'remove') then raise exception 'UNKNOWN_VALUE %', v; end if;
  end loop;
  if p_payment <> 'cod' then v_cash := null; end if;
  if v_cash is not null and v_cash not in ('usd', 'lbp') then raise exception 'UNKNOWN_VALUE %', v_cash; end if;
  v_notes := left(v_notes, 300);

  -- The note is checked against the card's total before any order is made, so a refused note never leaves an order behind.
  if v_cash is not null and p_note is not null then
    q := checkout_quote(p_token, p_place, p_slot, null);
    if not coalesce((q->>'ready')::boolean, false) then
      return jsonb_build_object('created', false, 'error', coalesce(q->>'error', 'not_ready'), 'quote', q->'quote',
                                'issues', coalesce(q->'issues', '[]'::jsonb), 'removed', coalesce(q->'removed', '[]'::jsonb));
    end if;
    v_total := (q->'quote'->>'total_usd')::numeric + customer_dues_usd(s.party_id);
    if v_cash = 'usd' then
      if not (coalesce(setting('card_choices')->'notes_usd', '[]'::jsonb) @> to_jsonb(p_note)
              or coalesce(setting('card_choices')->'notes_usd', '[]'::jsonb) @> to_jsonb(p_note::int)) then
        return jsonb_build_object('created', false, 'error', 'unknown_note');
      end if;
      if p_note <= v_total then return jsonb_build_object('created', false, 'error', 'note_too_small', 'total_usd', v_total); end if;
      v_change := p_note;
    else
      v_fx := coalesce((q->'quote'->>'fx_rate_lbp')::numeric, current_fx());
      if v_fx is null then return jsonb_build_object('created', false, 'error', 'no_exchange_rate'); end if;
      v_lbp := round(v_total * v_fx / 1000) * 1000;
      v_steps := coalesce(setting('card_choices')->'lbp_steps', '[100000, 500000, 1000000]'::jsonb);
      select min(x::numeric), max(x::numeric) into v_min, v_max from jsonb_array_elements_text(v_steps) x;
      if p_note <= v_lbp then return jsonb_build_object('created', false, 'error', 'note_too_small', 'total_lbp', v_lbp); end if;
      if mod(p_note, v_min) <> 0 or p_note > v_lbp + v_max then return jsonb_build_object('created', false, 'error', 'unknown_note'); end if;
      -- Staff read the order's note in Arabic (the picker and the rider): the amount the customer will hand over, in lira.
      v_notes := concat_ws(' | ', v_notes, 'الدفع بالليرة: معه ' || to_char(p_note, 'FM999,999,999,990') || ' ل.ل.');
    end if;
  elsif v_cash = 'lbp' then
    v_notes := concat_ws(' | ', v_notes, 'الدفع بالليرة');
  end if;

  r := checkout_order(p_token, p_request_key, p_place, p_slot, p_payment, v_change, v_notes);
  if not coalesce((r->>'created')::boolean, false) then
    return r || jsonb_build_object('issues', coalesce(r->'quote'->'issues', r->'issues', '[]'::jsonb));
  end if;
  v_order := (r->>'order_id')::uuid;

  if not coalesce((r->>'reused')::boolean, false) then
    update orders set missing_pref = coalesce(p_missing, missing_pref), cash_currency = case when p_payment = 'cod' then coalesce(v_cash, 'usd') end,
           change_for_lbp = case when v_cash = 'lbp' then p_note end
     where id = v_order;
    update order_items i set missing_pref = x.value
      from jsonb_each_text(coalesce(p_items, '{}'::jsonb)) x join products p on p.sku = x.key
     where i.order_id = v_order and i.product_id = p.id;
    -- What we owe the customer comes off the order, as on a chat card (issueCard calls the same function).
    perform apply_customer_credit(v_order, null);
  end if;
  if (select status from orders where id = v_order) = 'awaiting_confirmation' then
    insert into web_card_requests(order_id, session_id, lang) values (v_order, s.id, v_lang) on conflict (order_id) do nothing;
  end if;
  return r || jsonb_build_object('status', (select status from orders where id = v_order), 'link', order_link(v_order),
                                 'card', order_card(v_order, s.party_id));
end $$;

-- ---------- the picker follows the item's own choice first (copied from 0144; "ask" or none is 0107's behaviour unchanged) ----------
create or replace function pick_decide_missing(p_missing uuid, p_by uuid) returns jsonb language plpgsql as $$
declare c jsonb; v_pref text; v_order uuid; v_party uuid; v_max numeric; x jsonb; v_offer jsonb; v_kept jsonb;
begin
  if p_by is not null then perform require_role(p_by, array['picker', 'ops_lead', 'admin']); end if;   -- G1-07
  select coalesce(i.missing_pref, o.missing_pref), o.id, o.customer_id into v_pref, v_order, v_party
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

do $$ declare r text; t text;
begin
  foreach t in array array['web_link_key', 'web_card_requests'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  -- The link key is read by its functions only (they run as their owner); not even the service role reads it as a table.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table web_link_key from service_role';
    execute 'grant select, insert, update on table web_card_requests to service_role';
  end if;
end $$;
