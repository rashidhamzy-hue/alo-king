-- One round trip at the start of every inbound WhatsApp message (flow latency work). Replaces six sequential queries from kapso-brain:
--   1 dedupe insert (processed_messages)  2 handoff-reply lookup (handoff_log)  3 owner lookup (vendors)
--   4-6 customer upsert / last_inbound_at update / profile select (customers)  + a flag for a live numbered list (quick_menus).
-- Semantics are identical to the old queries: a duplicate message id returns {dup:true} and nothing else happens; the customer is only touched when the caller asked for it
-- AND the sender is neither a linked vendor owner nor a replied-to handoff message; language is set only when none is stored. Service role only.
create or replace function public.bot_begin_turn(p_message_id text, p_phone text, p_norm text, p_context_id text, p_touch boolean, p_lang text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text;
  v_hrow text;
  v_owner jsonb;
  v_cust jsonb;
begin
  if p_message_id is not null and p_message_id <> '' then
    insert into public.processed_messages (message_id) values (p_message_id) on conflict (message_id) do nothing returning message_id into v_new;
    if v_new is null then return jsonb_build_object('dup', true); end if;
  end if;
  if p_context_id is not null and p_context_id <> '' then
    select customer_phone into v_hrow from public.handoff_log where admin_message_id = p_context_id;
  end if;
  if p_norm is not null and p_norm <> '' then
    select jsonb_build_object('vendor_id', vendor_id, 'name_en', name_en) into v_owner from public.vendors where owner_whatsapp_phone = p_norm;
  end if;
  if coalesce(p_touch, false) and v_hrow is null and v_owner is null and p_phone is not null and p_phone <> '' then
    insert into public.customers (phone_number, last_inbound_at) values (p_phone, now())
      on conflict (phone_number) do update set last_inbound_at = now();
    if p_lang is not null and p_lang <> '' then
      update public.customers set language = p_lang, language_set_at = now() where phone_number = p_phone and language is null;
    end if;
    select jsonb_build_object('language', language, 'handoff_until', handoff_until, 'full_name', full_name, 'village', village, 'last_address', last_address, 'last_lat', last_lat, 'last_lng', last_lng)
      into v_cust from public.customers where phone_number = p_phone;
  end if;
  return jsonb_build_object('dup', false, 'hrow', v_hrow, 'owner', v_owner, 'customer', v_cust,
    'has_quick', exists (select 1 from public.quick_menus where customer_phone = p_phone and expires_at > now()));
end;
$$;
revoke all on function public.bot_begin_turn(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.bot_begin_turn(text, text, text, text, boolean, text) to service_role;
