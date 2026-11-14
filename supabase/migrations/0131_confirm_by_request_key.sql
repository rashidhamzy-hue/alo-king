-- Alo King Chouf, session C4 (commerce core): the confirm action on a channel without a WhatsApp message id.
--
-- Invariant 4 (C1, approved 14 Nov): confirmation is a customer's own confirm action on a channel where we verified them: a
-- WhatsApp button, or the confirm button of a signed-in web session. The agent can never confirm.
--
-- confirm_order_checked is 0040's text (C3; no later migration redefines it) with two new, optional parameters:
--   p_request_key  the confirm action's idempotency key, in place of the WhatsApp message id (p_wamid)
--   p_session      the web session that sent it
-- A request key confirms only when ALL of these hold; otherwise the answer is 'confirm_on_whatsapp' and nothing changes (the
-- card goes to the customer's WhatsApp through the gateway and the tap there confirms, as for a chat order):
--   * settings.web.confirm_on_page is true (0128 sets it true);
--   * the session is live (not revoked, not expired) and belongs to the order's customer;
--   * the session was linked by a claimed link code (web_sessions.link_code_id, claimed by that same party, 0129).
-- The same key again returns the order's state with changed = false (a confirm sent twice confirms once); a key already used for
-- another order is refused (REQUEST_KEY_REUSED). The key is stored on the order (orders.request_key) when it confirms.
-- Every check of 0040 then runs unchanged (stale quote, location, window, replacement), and the confirmation itself is
-- handle_order_button's, with actor 'customer' and the evidence 'web:<request key>' where a tap has its message id.
-- A call with a WhatsApp message id is exactly 0040's. A call with neither is refused (CONFIRM_NEEDS_AN_ACTION).
-- Nothing an agent can call reaches this function (packages/agents has no tool for it; test/db/commerce-c4.test.ts), and
-- transition_order still refuses actor 'agent' past awaiting_confirmation.
--
-- web_confirm_order(token, order, request_key) is the website's door to it (0132 grants it to web_channel): the party and the
-- session come from the token, never from the page.

drop function if exists confirm_order_checked(uuid, uuid, text);

-- May this session confirm on the page for this party? Read-only; used by confirm_order_checked.
create or replace function web_session_may_confirm(p_session uuid, p_party uuid) returns boolean language sql stable as $$
  select coalesce((setting('web')->>'confirm_on_page')::boolean, false)
     and exists (select 1 from web_sessions s join link_codes c on c.id = s.link_code_id
                  where s.id = p_session and s.party_id = p_party and s.revoked_at is null and s.expires_at > now()
                    and c.session_id = s.id and c.used_by = p_party and c.used_at is not null)
$$;

create or replace function confirm_order_checked(p_order uuid, p_party uuid, p_wamid text default null,
                                                 p_request_key text default null, p_session uuid default null)
returns jsonb language plpgsql as $$
declare o orders%rowtype; v_issues jsonb; v_state text; v_old orders%rowtype; r jsonb; v_keyed orders%rowtype;
        v_key text := nullif(btrim(coalesce(p_request_key, '')), ''); v_evidence text := p_wamid;
begin
  if p_wamid is not null and (v_key is not null or p_session is not null) then raise exception 'ONE_CONFIRM_ACTION'; end if;
  if p_wamid is null then
    if v_key is null or length(v_key) < 8 then raise exception 'CONFIRM_NEEDS_AN_ACTION'; end if;
    select * into o from orders where id = p_order for update;
    if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
    if not web_session_may_confirm(p_session, p_party) then
      return jsonb_build_object('status', 'confirm_on_whatsapp', 'changed', false, 'short_code', o.short_code,
                                'order_status', o.status, 'window', window_json(o.delivery_slot_id));
    end if;
    select * into v_keyed from orders where request_key = v_key;
    if found then
      if v_keyed.id <> p_order then raise exception 'REQUEST_KEY_REUSED'; end if;
      return jsonb_build_object('status', o.status, 'short_code', o.short_code, 'changed', false, 'payment_method', o.payment_method,
                                'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'window', window_json(o.delivery_slot_id));
    end if;
    v_evidence := 'web:' || v_key;
  end if;

  -- From here: 0040's text, with v_evidence where it passed p_wamid.
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> p_party then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status = 'awaiting_confirmation' then
    v_issues := order_quote_issues(p_order);
    if jsonb_array_length(v_issues) > 0 then
      perform transition_order(p_order, 'draft', 'customer', p_party, 'stale_quote', jsonb_build_object('issues', v_issues));
      return jsonb_build_object('status', 'stale_quote', 'changed', false, 'issues', v_issues, 'short_code', o.short_code);
    end if;
    if not o.is_pickup and not exists (select 1 from customer_places cp where cp.id = o.place_id
          and (cp.lat is not null or cp.verified_by_driver or length(coalesce(cp.directions, '') || coalesce(cp.building, '')) >= 8)) then
      return jsonb_build_object('status', 'needs_location', 'changed', false, 'short_code', o.short_code);
    end if;
    if o.replaces_order_id is not null then
      select * into v_old from orders where id = o.replaces_order_id for update;
      if not coalesce(order_changeable(v_old.id), false) or exists (select 1 from payments where order_id = v_old.id and status = 'confirmed') then
        perform transition_order(p_order, 'draft', 'customer', p_party, 'change_too_late');
        return jsonb_build_object('status', 'change_too_late', 'changed', false, 'short_code', v_old.short_code, 'window', window_json(v_old.delivery_slot_id));
      end if;
    end if;
    if o.delivery_slot_id is not null then
      perform 1 from delivery_slots where id = o.delivery_slot_id for update;
      v_state := slot_state(o.delivery_slot_id, order_bought_to_order(p_order), o.replaces_order_id);
      if v_state <> 'ok' then
        if v_state = 'full' then
          perform log_demand('no_slot', 'confirm', p_party, 'slot ' || (select to_char(starts_at at time zone scheduling_tz(), 'YYYY-MM-DD HH24:MI') from delivery_slots where id = o.delivery_slot_id),
                             null, null, o.village_id, null, jsonb_build_object('slot_id', o.delivery_slot_id, 'order_id', p_order));
        end if;
        perform transition_order(p_order, 'draft', 'customer', p_party, 'slot_' || v_state);
        return jsonb_build_object('status', case when v_state = 'full' then 'slot_full' else 'slot_closed' end, 'changed', false,
                                  'short_code', o.short_code, 'window', window_json(o.delivery_slot_id),
                                  'windows', open_delivery_windows(o.village_id, order_bought_to_order(p_order)));
      end if;
    end if;
    if o.replaces_order_id is not null then
      -- The old order goes in the same transaction as the new one is confirmed: its slot, its stock, its card.
      perform transition_order(v_old.id, 'cancelled', 'customer', p_party, 'replaced_by:' || o.short_code);
      if v_old.delivery_slot_id is distinct from o.delivery_slot_id then
        insert into slot_changes(order_id, from_slot, to_slot, actor, actor_id, reason) values (p_order, v_old.delivery_slot_id, o.delivery_slot_id, 'customer', p_party, 'change');
      end if;
    end if;
  end if;
  r := handle_order_button(p_order, 'confirm', p_party, v_evidence);
  if o.replaces_order_id is not null and o.status = 'awaiting_confirmation' then r := r || jsonb_build_object('replaces', v_old.short_code); end if;
  if p_wamid is null and coalesce((r->>'changed')::boolean, false) then
    update orders set request_key = v_key where id = p_order;
  end if;
  return r;
end $$;

-- The website's confirm button. The party and the session come from the token.
create or replace function web_confirm_order(p_token text, p_order uuid, p_request_key text) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype;
begin
  s := web_session_of(p_token);
  if s.party_id is null then
    return jsonb_build_object('status', 'confirm_on_whatsapp', 'changed', false, 'reason', 'not_linked');
  end if;
  update web_sessions set last_seen_at = now() where id = s.id;
  return confirm_order_checked(p_order, s.party_id, null, p_request_key, s.id);
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
