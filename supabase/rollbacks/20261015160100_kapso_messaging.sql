-- Rollback for 20261015160100_kapso_messaging.sql (session 5b). Run by hand on staging only if that migration must be
-- undone: restores the five functions it replaced (as in 20261011090200, 20261015120100 and 20261015140100), the ai_calls
-- purpose check, and drops what it added. Template statuses, broadcasts and windows recorded meanwhile are lost (they are
-- re-synced from Kapso by kapso-number, and no broadcast is sent before the pilot gate). Its config rows stay (dated rows
-- are never deleted); nothing reads them once the functions are gone. Enum values added by 20261015160000 stay (Postgres
-- cannot drop them; nothing uses them after this).
begin;

create or replace function public.whatsapp_sender(p_audience text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select w.phone_number_id from public.whatsapp_numbers w
  where w.active and w.role = any (case when p_audience = 'merchant' then array['merchant', 'sandbox']
                                        else array['customer', 'sandbox'] end::public.whatsapp_number_role[])
  order by (w.role = 'sandbox'), w.created_at limit 1;
$$;


create or replace function app_private.customer_notify(p_order_id uuid, p_kind text, p_extra jsonb default '{}', p_dedupe text default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_c public.customers%rowtype;
  v_id bigint;
  v_budget jsonb := public.config_value('customer_message_budget');
  v_extra jsonb := coalesce(p_extra, '{}');
  v_link text;
begin
  select * into v_o from public.orders where id = p_order_id;
  select * into v_c from public.customers where id = v_o.customer_id;
  if v_c.id is null then
    return null;
  end if;
  -- Consolidated: the delivered message carries the rating (§38.3), so a separate rating message is never sent after it.
  if p_kind = 'rating' and exists (select 1 from public.outbound_messages m where m.dedupe_key = 'cust:' || p_order_id || ':delivered') then
    return null;
  end if;
  -- Budget: above the target only essential kinds go; at the hard cap nothing but a money decision.
  if v_o.customer_messages >= (v_budget ->> 'cap')::int and p_kind not in ('weight_confirm', 'substitution', 'cancelled', 'rejected') then
    return null;
  end if;
  if v_o.customer_messages >= (v_budget ->> 'target')::int and not app_private.customer_message_essential(p_kind) then
    return null;
  end if;
  -- "On the way + tracking" in one message, once the public site exists (config site_url).
  if p_kind = 'on_the_way' and public.config_value('site_url') is not null then
    begin
      v_link := public.order_tracking_link_create(p_order_id);
      v_extra := v_extra || jsonb_build_object('track_url', v_link);
    exception when others then
      v_link := null;
    end;
  end if;
  -- An order that could not go ahead: up to three open shops that deliver there.
  if p_kind in ('cancelled', 'rejected') and coalesce(v_o.cancel_reason::text, '') <> 'customer' then
    v_extra := v_extra || jsonb_build_object('alternatives', app_private.offer_alternatives(p_order_id));
  end if;
  v_id := app_private.outbox_add('cust:' || p_order_id || ':' || coalesce(p_dedupe, p_kind), p_order_id, v_o.vendor_id,
    'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', p_kind, 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id,
      'ask_delivery', v_o.driver_member_id is not null) || v_extra);
  if v_id is not null then
    if v_c.last_inbound_at is null or v_c.last_inbound_at < now() - interval '24 hours' then
      update public.outbound_messages set status = 'skipped', last_error = 'outside the 24-hour window: needs an approved utility template'
      where id = v_id;
    else
      update public.orders set customer_messages = customer_messages + 1 where id = p_order_id;
    end if;
  end if;
  return v_id;
end;
$$;


create or replace function public.gift_request_create(p_customer_id uuid, p_basket_id uuid, p_menu_version bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_r public.customers%rowtype;
  v_q jsonb;
  v_id uuid;
  v_sender public.customers%rowtype;
  v_fp text;
  v_pending public.gift_requests%rowtype;
begin
  select * into v_b from public.baskets where id = p_basket_id and customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null or not v_b.is_gift then
    return jsonb_build_object('status', 'not_gift');
  end if;
  if v_b.priced_menu_version is distinct from p_menu_version then
    return jsonb_build_object('status', 'repriced');
  end if;
  v_q := public.basket_quote(p_customer_id);
  if v_q ->> 'status' <> 'ok' then
    return jsonb_build_object('status', v_q ->> 'status');
  end if;
  if (v_q ->> 'over_cod_cap')::boolean then
    return jsonb_build_object('status', 'cod_cap');
  end if;
  select * into v_r from public.customers where phone_e164 = v_b.recipient_phone;
  if v_r.gift_blocked_at is not null then
    return jsonb_build_object('status', 'blocked');
  end if;
  -- Outside WhatsApp's 24-hour window only an approved utility template reaches the recipient (5b, §22.3).
  if v_r.id is null or v_r.last_inbound_at is null or v_r.last_inbound_at < now() - interval '24 hours' then
    return jsonb_build_object('status', 'unreachable', 'recipient_name', v_b.recipient_name);
  end if;
  v_fp := app_private.gift_fingerprint(v_b.id, v_q);
  select * into v_pending from public.gift_requests
  where basket_id = v_b.id and status = 'pending' and expires_at > now() for update;
  if v_pending.id is not null and v_pending.fingerprint = v_fp then
    return jsonb_build_object('status', 'asked', 'gift_id', v_pending.id, 'recipient_name', v_pending.recipient_name,
      'minutes', greatest(1, ceil(extract(epoch from v_pending.expires_at - now()) / 60)), 'again', true);
  end if;
  if (select count(*) from public.gift_requests
      where sender_id = p_customer_id and recipient_phone = v_b.recipient_phone
        and created_at > now() - interval '24 hours') >= public.config_numeric('gift_requests_per_day') then
    return jsonb_build_object('status', 'too_many', 'recipient_name', v_b.recipient_name);
  end if;
  update public.gift_requests set status = 'expired', decided_at = now() where basket_id = v_b.id and status = 'pending';
  select * into v_sender from public.customers where id = p_customer_id;
  insert into public.gift_requests (basket_id, sender_id, recipient_phone, recipient_name, menu_version, total_usd, fingerprint, expires_at)
  values (v_b.id, p_customer_id, v_b.recipient_phone, v_b.recipient_name, p_menu_version, (v_q ->> 'total_usd')::numeric, v_fp,
          now() + make_interval(mins => public.config_numeric('gift_accept_minutes')::int))
  returning id into v_id;
  perform app_private.outbox_add('gift:' || v_id, null, v_b.vendor_id, 'whatsapp', 'customer_message', v_b.recipient_phone,
    jsonb_build_object('kind', 'gift_request', 'lang', coalesce(v_r.language::text, 'ar'), 'gift_id', v_id,
      'sender', coalesce(v_sender.display_name, ''), 'vendor', v_q -> 'basket' ->> 'vendor', 'vendor_en', v_q -> 'basket' ->> 'vendor_en',
      'lines', (select jsonb_agg(jsonb_build_object('q', l -> 'quantity', 'name', l ->> 'name', 'name_en', l ->> 'name_en'))
                from jsonb_array_elements(v_q -> 'basket' -> 'lines') l),
      'total_usd', v_q -> 'total_usd', 'total_lbp', v_q -> 'total_lbp', 'usd_lbp_rate', v_q -> 'usd_lbp_rate',
      'place', v_q -> 'address' ->> 'place', 'place_en', v_q -> 'address' ->> 'place_en'));
  return jsonb_build_object('status', 'asked', 'gift_id', v_id, 'recipient_name', v_b.recipient_name,
    'minutes', public.config_numeric('gift_accept_minutes'));
end;
$$;


create or replace function app_private.merchant_suggest(p_vendor_id uuid, p_key text, p_kind public.proposal_kind, p_payload jsonb, p_summary text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Beirut')::date;
  v_id uuid;
  v_to text := (select p.owner_mobile from public.vendor_private p where p.vendor_id = p_vendor_id);
begin
  if v_to is null or v_to !~ '^\+[1-9][0-9]{6,14}$' then
    return null;
  end if;
  -- A free-form card reaches the owner only inside WhatsApp's 24-hour window (no template for suggestions).
  if not exists (select 1 from app_private.whatsapp_last_inbound w where w.phone_e164 = v_to and w.at > now() - interval '23 hours') then
    return null;
  end if;
  insert into app_private.merchant_suggestions (vendor_id, key, day) values (p_vendor_id, p_key, v_day) on conflict do nothing;
  if not found then
    return null;
  end if;
  begin
    v_id := app_private.merchant_proposal_create(p_vendor_id, p_kind, p_payload, 'rules', null);
  exception when check_violation then
    return null; -- the suggestion no longer fits (the item left the menu, nothing to switch off)
  when others then
    -- One shop's unexpected error never stops the run for the others; the operators see it.
    perform app_private.ops_alert('suggest:' || p_vendor_id || ':' || p_key, 'copilot_error', 'warning',
      format('Copilot suggestion %s failed (%s: %s)', p_key, sqlstate, left(sqlerrm, 200)), null, p_vendor_id, '{}'::jsonb);
    return null;
  end;
  update public.merchant_proposals set expires_at = now() + make_interval(mins => public.config_numeric('merchant_suggestion_ttl_min')::int)
  where id = v_id;
  update app_private.merchant_suggestions set proposal_id = v_id where vendor_id = p_vendor_id and key = p_key and day = v_day;
  perform app_private.outbox_add('suggest:' || v_id, null, p_vendor_id, 'whatsapp', 'proposal', v_to,
    jsonb_build_object('proposal_id', v_id, 'summary', p_summary));
  return v_id;
end;
$$;


create or replace function app_private.merchant_weekly_summary() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  r jsonb;
  n integer := 0;
  v_to text;
begin
  perform set_config('app.actor_kind', 'system', true);
  for v in select x.id, coalesce(x.name_ar, x.name_en) as name from public.vendors x where x.orderable and not x.is_test loop
    v_to := (select p.owner_mobile from public.vendor_private p where p.vendor_id = v.id);
    continue when v_to is null or v_to !~ '^\+[1-9][0-9]{6,14}$';
    -- Free-form text needs the owner's 24-hour window; outside it the summary waits for next week.
    continue when not exists (select 1 from app_private.whatsapp_last_inbound w where w.phone_e164 = v_to and w.at > now() - interval '23 hours');
    r := public.merchant_report(v.id, null, 'week');
    continue when coalesce((r ->> 'orders')::int, 0) = 0;
    perform app_private.outbox_add('weekly:' || v.id || ':' || to_char(now() at time zone 'Asia/Beirut', 'IYYY-IW'), null, v.id, 'whatsapp', 'reply', v_to,
      jsonb_build_object('text', format(
        E'📊 أسبوعك على Alo King / Your week:\n• طلبات / orders: %s (وصل / delivered %s)\n• مبيعات الأكل / food sales: $%s\n• تقييم / rating: %s (%s)%s',
        r ->> 'orders', r ->> 'delivered', to_char((r ->> 'food_sales_usd')::numeric, 'FM999990.00'),
        coalesce(r ->> 'rating_avg', '–'), r ->> 'ratings',
        case when coalesce((r ->> 'acceptance_median_s')::numeric, 0) > 180
             then format(E'\n⏱ القبول بطيء (%s د) / Slow acceptance (%s min): «capacity 6» بيساعد', round((r ->> 'acceptance_median_s')::numeric / 60), round((r ->> 'acceptance_median_s')::numeric / 60))
             else '' end)));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function app_private.customer_notify(uuid, text, jsonb, text) from public;

-- Menu-model calls keep their spend record under the closest older purpose.
update public.ai_calls set purpose = 'merchant' where purpose = 'menu';
alter table public.ai_calls drop constraint if exists ai_calls_purpose_check;
alter table public.ai_calls add constraint ai_calls_purpose_check
  check (purpose in ('customer_turn', 'voice_transcribe', 'voice_normalise', 'eval', 'merchant'));

drop function if exists public.customer_marketing_stop_by_phone(text, boolean);
drop function if exists public.broadcast_finish(uuid, boolean, text[], text, text[], text[]);
drop function if exists public.broadcast_template_id(text, text);
drop function if exists public.broadcast_claim();
drop function if exists public.broadcasts_pause(uuid);
drop function if exists public.broadcast_approve(uuid, uuid);
drop function if exists public.broadcast_create(uuid, text, text, jsonb, jsonb);
drop function if exists app_private.broadcast_audience(jsonb, integer);
drop table if exists public.broadcast_recipients;
drop table if exists public.broadcasts;
drop function if exists app_private.whatsapp_reachable(text, text, text, text);
drop function if exists public.whatsapp_template_for(text, text, text, text);
drop function if exists app_private.template_for(text, text, text, text);
drop function if exists app_private.template_category(text);
drop function if exists public.whatsapp_template_sync(text, jsonb);
drop function if exists public.whatsapp_reply_number(text, text);
drop function if exists public.whatsapp_sender_for(text, text);
drop function if exists app_private.whatsapp_sender_rank(public.whatsapp_number_role, text);
drop table if exists public.whatsapp_templates;
drop function if exists public.whatsapp_window_open(text, text);
drop function if exists public.whatsapp_seen(text, text);
drop table if exists app_private.whatsapp_windows;
-- The US test number row, if kapso-number recorded one (the sandbox stays the only sender again).
delete from public.whatsapp_numbers where role = 'test';

commit;
