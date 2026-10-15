-- Session 5b (DECISIONS §3, §6, §18.3, §32.1, §39.8): WhatsApp templates, the 24-hour window per business number,
-- broadcasts to opted-in customers, the US test number, and the menu model under the daily AI budget.
--
-- 1. The 24-hour window is per (person, business number): a customer who wrote to the sandbox has no window on the US
--    test number or, later, on the company number. `whatsapp_seen(phone, phone_number_id)` records it on every inbound
--    message; `whatsapp_window_open` reads it. The phone-only table stays for the older readers.
-- 2. Templates: `whatsapp_templates` mirrors what Meta approved per WhatsApp business account (the kapso-number
--    workflow writes it from Kapso; nothing here talks to Meta). The registry of names, texts and buttons is
--    supabase/functions/_shared/whatsapp-templates.ts; config `whatsapp_template_map` says which template replaces which
--    message outside the window. `app_private.template_for` answers "can this message reach this person now?":
--    an approved template on the sending number's account, or, for a simulator number while the sink is on, a dry run.
-- 3. Outside the window a customer message, a gift request, a copilot suggestion or the weekly summary is kept when a
--    template can carry it (dispatch sends the template); otherwise it is skipped as before.
-- 4. Broadcasts (§39.8, §18.3): marketing templates only, to customers who opted in, never after STOP, switched off by
--    config `broadcasts_enabled` until the pilot gate; Kapso's broadcast API sends and paces them (dispatch).
-- 5. The menu model (photos and PDFs, §18.3) reserves its call against the daily AI budget like every other model call.

-- 0. Config ------------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('whatsapp_template_map', '{"accepted": "alo_order_confirmed", "on_the_way": "alo_order_on_the_way", "delivered": "alo_order_delivered",
     "gift_request": "alo_gift_request", "gift_accepted": "alo_send_home_receipt", "payment_link": "alo_payment_link",
     "support_reply": "alo_support_reply", "new_order": "alo_merchant_new_order", "proposal": "alo_copilot_suggestion",
     "merchant_weekly": "alo_merchant_weekly", "claim_code": "alo_claim_code",
     "marketing_offer": "alo_offer_nearby", "marketing_new_shop": "alo_new_shop_nearby"}', now(),
   'Which approved template carries which message outside the 24-hour window, and the marketing templates broadcasts may use (DECISIONS §39.8); names and texts in _shared/whatsapp-templates.ts', null),
  ('broadcasts_enabled', 'false', now(),
   'Marketing broadcasts: off until the pilot gate (DECISIONS §39.8, §18.3). "/ak broadcast pause" inserts a newer false row', null),
  ('broadcast_max_recipients', '500', now(), 'At most this many customers in one broadcast (opted in, never after STOP)', null),
  ('marketing_per_week', '2', now(), 'At most this many promotional messages per customer in 7 days, across all merchants (DECISIONS §20.4)', null),
  ('broadcast_daily_usd', '10', now(), 'Marketing broadcasts may spend at most this much a day at the dated Meta marketing rate (§6)', null),
  ('ai_menu_est_usd', '0.05', now(), 'Reserved per menu-model call (one photo or PDF) against the daily AI budget; the real cost is booked after the call', null);

-- 1. The window per business number ------------------------------------------------------------------------------------
create table app_private.whatsapp_windows (
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{3,30}$'),
  last_inbound_at timestamptz not null,
  primary key (phone_e164, phone_number_id)
);
revoke all on table app_private.whatsapp_windows from public, anon, authenticated;
-- Until today every inbound message reached the sandbox.
insert into app_private.whatsapp_windows (phone_e164, phone_number_id, last_inbound_at)
select w.phone_e164, n.phone_number_id, w.at
from app_private.whatsapp_last_inbound w
cross join (select phone_number_id from public.whatsapp_numbers where role = 'sandbox' order by created_at limit 1) n
on conflict do nothing;

create function public.whatsapp_seen(p_phone_e164 text, p_phone_number_id text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.whatsapp_seen(p_phone_e164);
  if p_phone_e164 ~ '^\+[1-9][0-9]{6,14}$' and coalesce(p_phone_number_id, '') ~ '^[0-9]{3,30}$' then
    insert into app_private.whatsapp_windows as w (phone_e164, phone_number_id, last_inbound_at)
    values (p_phone_e164, p_phone_number_id, now())
    on conflict (phone_e164, phone_number_id) do update set last_inbound_at = now();
  end if;
end;
$$;

-- Open with ten minutes to spare, so a message queued now is still inside the window when it goes.
create function public.whatsapp_window_open(p_phone_e164 text, p_phone_number_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from app_private.whatsapp_windows w
                 where w.phone_e164 = p_phone_e164 and w.phone_number_id = p_phone_number_id
                   and w.last_inbound_at > now() - interval '23 hours 50 minutes');
$$;

-- The US test number (role 'test') speaks to customers and merchants until cut-over and goes before the sandbox; a
-- company number of the right role goes before both.
create or replace function public.whatsapp_sender(p_audience text) returns text
language sql stable security definer set search_path = ''
as $$
  select w.phone_number_id from public.whatsapp_numbers w
  where w.active and w.role = any (case when p_audience = 'merchant' then array['merchant', 'test', 'sandbox']
                                        else array['customer', 'test', 'sandbox'] end::public.whatsapp_number_role[])
  order by case w.role when 'sandbox' then 2 when 'test' then 1 else 0 end, w.created_at limit 1;
$$;

-- 2. Templates -----------------------------------------------------------------------------------------------------------
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null check (waba_id ~ '^[0-9]{3,30}$'),
  name text not null check (name ~ '^[a-z0-9_]+$' and char_length(name) <= 512),
  language text not null check (language in ('ar', 'en', 'fr')),
  category text not null check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  -- Meta's status as Kapso reports it (lower case); only 'approved' is ever sent.
  status text not null check (status in ('submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'in_appeal', 'deleted')),
  meta_template_id text,
  kapso_template_id text,
  reason text check (char_length(reason) <= 500),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (waba_id, name, language)
);
alter table public.whatsapp_templates enable row level security;
revoke all on table public.whatsapp_templates from public, anon, authenticated;
grant all on table public.whatsapp_templates to service_role;
grant select on table public.whatsapp_templates to authenticated;
create policy whatsapp_templates_operator_read on public.whatsapp_templates for select to authenticated
  using ((select app_private.is_operator()));

-- The kapso-number workflow reports what Kapso says; a change to or from approved raises an ops note.
create function public.whatsapp_template_sync(p_waba_id text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  v_old text;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    select status into v_old from public.whatsapp_templates
    where waba_id = p_waba_id and name = r ->> 'name' and language = r ->> 'language';
    insert into public.whatsapp_templates as t (waba_id, name, language, category, status, meta_template_id, kapso_template_id, reason, synced_at)
    values (p_waba_id, r ->> 'name', r ->> 'language', upper(r ->> 'category'), lower(r ->> 'status'), r ->> 'meta_template_id',
            r ->> 'kapso_template_id', left(r ->> 'reason', 500), now())
    on conflict (waba_id, name, language) do update set category = excluded.category, status = excluded.status,
      meta_template_id = coalesce(excluded.meta_template_id, t.meta_template_id),
      kapso_template_id = coalesce(excluded.kapso_template_id, t.kapso_template_id), reason = excluded.reason, synced_at = now();
    if v_old is distinct from lower(r ->> 'status') and (v_old = 'approved' or lower(r ->> 'status') in ('approved', 'rejected', 'paused', 'disabled')) then
      perform app_private.ops_alert('template:' || p_waba_id || ':' || (r ->> 'name') || ':' || (r ->> 'language') || ':' || lower(r ->> 'status'),
        'template_status', case when lower(r ->> 'status') = 'approved' then 'info' else 'warning' end,
        format('WhatsApp template %s (%s): %s%s', r ->> 'name', r ->> 'language', lower(r ->> 'status'),
          coalesce(' (' || left(r ->> 'reason', 120) || ')', '')));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Which template carries p_key to p_target now, or null. The customer's language first, then Arabic, then English.
-- A simulator number (+999) with the sink on gets a dry run: dispatch records the template instead of sending it, which is
-- how staging proves the out-of-window path without Meta (templates do not exist on the sandbox, §39.8).
create function app_private.template_for(p_key text, p_lang text, p_target text, p_audience text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_name text := public.config_value('whatsapp_template_map') ->> p_key;
  v_lang text := case when p_lang in ('en', 'fr') then p_lang else 'ar' end;
  v_waba text;
  v_t public.whatsapp_templates%rowtype;
begin
  if v_name is null then
    return null;
  end if;
  if app_private.is_sim_phone(p_target) then
    return case when app_private.sim_sink_on() then jsonb_build_object('name', v_name, 'lang', v_lang, 'dry_run', true) end;
  end if;
  select w.waba_id into v_waba from public.whatsapp_numbers w where w.phone_number_id = public.whatsapp_sender(p_audience);
  if v_waba is null then
    return null;
  end if;
  select * into v_t from public.whatsapp_templates t
  where t.waba_id = v_waba and t.name = v_name and t.status = 'approved'
  order by (t.language = v_lang) desc, (t.language = 'ar') desc, (t.language = 'en') desc
  limit 1;
  return case when v_t.id is not null then jsonb_build_object('name', v_t.name, 'lang', v_t.language, 'dry_run', false) end;
end;
$$;

create function public.whatsapp_template_for(p_key text, p_lang text, p_target text, p_audience text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select app_private.template_for(p_key, p_lang, p_target, p_audience) $$;

-- Reachable now: inside the window on the number that would send, or a template can carry it.
create function app_private.whatsapp_reachable(p_phone text, p_audience text, p_key text, p_lang text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_phone is not null
    and (public.whatsapp_window_open(p_phone, public.whatsapp_sender(p_audience))
         or app_private.template_for(p_key, p_lang, p_phone, p_audience) is not null);
$$;

-- 3. Messages that may now go outside the window ----------------------------------------------------------------------------
-- customer_notify (as in 20261015120100) with the per-number window and the template fallback.
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
    if not app_private.whatsapp_reachable(v_c.phone_e164, 'customer', p_kind, coalesce(v_c.language::text, 'ar')) then
      update public.outbound_messages set status = 'skipped', last_error = 'outside the 24-hour window: no approved template for ' || p_kind
      where id = v_id;
    else
      update public.orders set customer_messages = customer_messages + 1 where id = p_order_id;
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function app_private.customer_notify(uuid, text, jsonb, text) from public;

-- gift_request_create (as in 20261015120100): the recipient is reachable inside their window or by the gift template.
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
  -- Inside the recipient's window on our number, or through the approved gift template (5b, §22.3).
  if not app_private.whatsapp_reachable(v_b.recipient_phone, 'customer', 'gift_request', coalesce(v_r.language::text, 'ar')) then
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

-- merchant_suggest (as in 20261015140100): inside the owner's window, or through the copilot-suggestion template.
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
  if not app_private.whatsapp_reachable(v_to, 'merchant', 'proposal', 'ar') then
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
    jsonb_build_object('proposal_id', v_id, 'summary', p_summary,
      'vendor_name', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = p_vendor_id)));
  return v_id;
end;
$$;

-- merchant_weekly_summary (as in 20261015140100): inside the owner's window, or through the weekly template; the payload
-- carries the figures so dispatch can fill the template.
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
    continue when not app_private.whatsapp_reachable(v_to, 'merchant', 'merchant_weekly', 'ar');
    r := public.merchant_report(v.id, null, 'week');
    continue when coalesce((r ->> 'orders')::int, 0) = 0;
    perform app_private.outbox_add('weekly:' || v.id || ':' || to_char(now() at time zone 'Asia/Beirut', 'IYYY-IW'), null, v.id, 'whatsapp', 'reply', v_to,
      jsonb_build_object('kind', 'merchant_weekly', 'shop', v.name, 'orders', r ->> 'orders', 'delivered', r ->> 'delivered',
        'sales', '$' || to_char((r ->> 'food_sales_usd')::numeric, 'FM999990.00'), 'rating', coalesce(r ->> 'rating_avg', '–'),
        'text', format(
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

-- 4. Broadcasts -------------------------------------------------------------------------------------------------------------
-- A broadcast is one marketing template to a segment of opted-in customers, approved by an admin, sent by dispatch through
-- Kapso's broadcast API (one Kapso broadcast per template language) while config broadcasts_enabled is true. The audience
-- is taken at send time, so STOP up to that second is honoured; Kapso also suppresses anyone who stopped marketing on the
-- number in WhatsApp itself.
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  template_key text not null check (template_key in ('marketing_offer', 'marketing_new_shop')),
  -- Template variables by name (shop, offer, village), the same for every recipient.
  template_values jsonb not null default '{}' check (jsonb_typeof(template_values) = 'object'),
  -- {"place_ids": [...], "vendor_id": "...", "ordered_within_days": n}; every key optional, all must match.
  segment jsonb not null default '{}' check (jsonb_typeof(segment) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sending', 'sent', 'cancelled', 'failed')),
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  recipients integer,
  est_usd numeric(10, 4),
  kapso_broadcast_ids text[] not null default '{}',
  last_error text check (char_length(last_error) <= 500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger broadcasts_touch before update on public.broadcasts
  for each row execute function app_private.touch_updated_at();
create trigger broadcasts_audit after insert or update or delete on public.broadcasts
  for each row execute function app_private.audit_row();
create table public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  phone_e164 text not null,
  language text not null check (language in ('ar', 'en', 'fr')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'dry_run', 'suppressed', 'failed')),
  primary key (broadcast_id, customer_id)
);
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
revoke all on table public.broadcasts, public.broadcast_recipients from public, anon, authenticated;
grant all on table public.broadcasts, public.broadcast_recipients to service_role;
grant select on table public.broadcasts to authenticated;
create policy broadcasts_operator_read on public.broadcasts for select to authenticated using ((select app_private.is_operator()));

-- Who would receive a segment now: opted in (and not since stopped), not blocked, under the weekly promotion cap.
create function app_private.broadcast_audience(p_segment jsonb, p_limit integer)
returns table (customer_id uuid, phone_e164 text, language text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.phone_e164, case when c.language::text in ('en', 'fr') then c.language::text else 'ar' end
  from public.customers c
  where c.marketing_opt_in
    and (c.marketing_opt_out_at is null or c.marketing_opt_in_at > c.marketing_opt_out_at)
    and (c.blocked_until is null or c.blocked_until < now())
    -- At most marketing_per_week promotions in 7 days, across all merchants (§20.4); a dry run counts too.
    and (select count(*) from public.broadcast_recipients r join public.broadcasts b on b.id = r.broadcast_id
         where r.customer_id = c.id and r.status in ('queued', 'sent', 'dry_run') and b.sent_at > now() - interval '7 days')
        < public.config_numeric('marketing_per_week')
    and (p_segment -> 'place_ids' is null or exists (
      select 1 from public.addresses a where a.customer_id = c.id
        and a.place_id::text in (select jsonb_array_elements_text(p_segment -> 'place_ids'))))
    and (p_segment ->> 'vendor_id' is null or exists (
      select 1 from public.orders o where o.customer_id = c.id and o.vendor_id = (p_segment ->> 'vendor_id')::uuid and o.status = 'delivered'))
    and (p_segment ->> 'ordered_within_days' is null or exists (
      select 1 from public.orders o where o.customer_id = c.id and o.status = 'delivered'
        and o.created_at > now() - make_interval(days => (p_segment ->> 'ordered_within_days')::int)))
  limit greatest(coalesce(p_limit, 0), 0);
$$;

create function public.broadcast_create(p_actor_id uuid, p_name text, p_template_key text, p_values jsonb, p_segment jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if app_private.operator_role(p_actor_id) is null then
    raise exception 'not allowed: an active operator prepares broadcasts' using errcode = 'insufficient_privilege';
  end if;
  if public.config_value('whatsapp_template_map') ->> p_template_key is null or p_template_key not like 'marketing_%' then
    raise exception 'broadcasts use a marketing template' using errcode = 'check_violation';
  end if;
  insert into public.broadcasts (name, template_key, template_values, segment, created_by)
  values (p_name, p_template_key, coalesce(p_values, '{}'), coalesce(p_segment, '{}'), p_actor_id)
  returning id into v_id;
  return jsonb_build_object('status', 'draft', 'id', v_id,
    'audience', (select count(*) from app_private.broadcast_audience(coalesce(p_segment, '{}'), public.config_numeric('broadcast_max_recipients')::int)));
end;
$$;

-- An admin approves (marketing spends money and speaks for the brand); approval alone sends nothing while the switch is off.
create function public.broadcast_approve(p_actor_id uuid, p_broadcast_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if app_private.operator_role(p_actor_id) is distinct from 'admin' then
    raise exception 'not allowed: an admin approves broadcasts' using errcode = 'insufficient_privilege';
  end if;
  update public.broadcasts set status = 'approved', approved_by = p_actor_id, approved_at = now()
  where id = p_broadcast_id and status = 'draft';
  return jsonb_build_object('status', case when found then 'approved' else 'not_draft' end,
    'enabled', coalesce((public.config_value('broadcasts_enabled') #>> '{}')::boolean, false));
end;
$$;

-- The kill switch ("/ak broadcast pause", §32.1): a newer dated row turns broadcasts off at once; approved ones wait.
create function public.broadcasts_pause(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if app_private.operator_role(p_actor_id) is null then
    raise exception 'not allowed: an active operator pauses broadcasts' using errcode = 'insufficient_privilege';
  end if;
  insert into public.app_config (key, value, effective_from, note, created_by)
  values ('broadcasts_enabled', 'false', now(), 'Paused by an operator (kill switch)', p_actor_id);
  return jsonb_build_object('status', 'paused');
end;
$$;

-- dispatch takes one approved broadcast while the switch is on: the audience is fixed now (opt-in at this second), the cost
-- is checked against the daily cap at the dated marketing rate, and the recipients come back grouped by language.
create function public.broadcast_claim() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.broadcasts%rowtype;
  v_rate numeric := (select r.rate_usd from public.message_rates r
                     where r.market = 'LB' and r.category = 'marketing' and r.effective_from <= now()
                     order by r.effective_from desc limit 1);
  v_n integer;
  v_spent numeric;
begin
  if not coalesce((public.config_value('broadcasts_enabled') #>> '{}')::boolean, false) then
    return null;
  end if;
  select * into v_b from public.broadcasts where status = 'approved' order by approved_at limit 1 for update skip locked;
  if v_b.id is null then
    return null;
  end if;
  insert into public.broadcast_recipients (broadcast_id, customer_id, phone_e164, language)
  select v_b.id, a.customer_id, a.phone_e164, a.language
  from app_private.broadcast_audience(v_b.segment, public.config_numeric('broadcast_max_recipients')::int) a
  on conflict do nothing;
  get diagnostics v_n = row_count;
  select coalesce(sum(b.est_usd), 0) into v_spent from public.broadcasts b
  where b.sent_at > date_trunc('day', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut';
  if v_n = 0 or v_spent + v_n * coalesce(v_rate, 0.05) > public.config_numeric('broadcast_daily_usd') then
    update public.broadcasts set status = 'failed', recipients = v_n,
      last_error = case when v_n = 0 then 'nobody opted in matches the segment' else 'over the daily marketing budget' end
    where id = v_b.id;
    delete from public.broadcast_recipients where broadcast_id = v_b.id;
    perform app_private.ops_alert('broadcast:' || v_b.id, 'broadcast', 'warning',
      format('Broadcast "%s" not sent: %s', v_b.name, case when v_n = 0 then 'nobody opted in matches' else 'over the daily marketing budget' end));
    return null;
  end if;
  update public.broadcasts set status = 'sending', recipients = v_n, est_usd = v_n * coalesce(v_rate, 0.05), sent_at = now()
  where id = v_b.id;
  return jsonb_build_object('id', v_b.id, 'name', v_b.name, 'template_key', v_b.template_key,
    'template', public.config_value('whatsapp_template_map') ->> v_b.template_key, 'values', v_b.template_values,
    'groups', (select jsonb_object_agg(g.language, g.phones) from (
      select r.language, jsonb_agg(r.phone_e164 order by r.phone_e164) as phones
      from public.broadcast_recipients r where r.broadcast_id = v_b.id group by r.language) g));
end;
$$;

-- The template id a Kapso broadcast takes (Meta's id, preferred by Kapso; else Kapso's own) for one language of an approved
-- marketing template on the sending account, or null.
create function public.broadcast_template_id(p_template text, p_lang text) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(t.meta_template_id, t.kapso_template_id) from public.whatsapp_templates t
  join public.whatsapp_numbers w on w.waba_id = t.waba_id and w.phone_number_id = public.whatsapp_sender('customer')
  where t.name = p_template and t.language = p_lang and t.status = 'approved' and t.category = 'MARKETING'
  limit 1;
$$;

create function public.broadcast_finish(p_id uuid, p_ok boolean, p_kapso_ids text[], p_error text, p_dry_run_phones text[] default '{}')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.broadcast_recipients set status = case when phone_e164 = any (coalesce(p_dry_run_phones, '{}')) then 'dry_run'
                                                       when p_ok then 'sent' else 'failed' end
  where broadcast_id = p_id and status = 'queued';
  update public.broadcasts set status = case when p_ok then 'sent' else 'failed' end,
    kapso_broadcast_ids = coalesce(p_kapso_ids, '{}'), last_error = left(p_error, 500)
  where id = p_id and status = 'sending';
  if not p_ok then
    perform app_private.ops_alert('broadcast-failed:' || p_id, 'broadcast', 'warning',
      format('Broadcast %s failed: %s', p_id, left(coalesce(p_error, 'unknown'), 200)));
  end if;
end;
$$;

-- STOP from WhatsApp itself (Meta's marketing opt-out, Kapso event whatsapp.contact.marketing_preference_changed).
create function public.customer_marketing_stop_by_phone(p_phone_e164 text, p_stopped boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := (select id from public.customers where phone_e164 = p_phone_e164);
begin
  if v_id is not null and p_stopped then
    perform public.customer_marketing_set(v_id, false);
  end if;
end;
$$;

-- 5. The menu model under the daily AI budget --------------------------------------------------------------------------------
alter table public.ai_calls drop constraint if exists ai_calls_purpose_check;
alter table public.ai_calls add constraint ai_calls_purpose_check
  check (purpose in ('customer_turn', 'voice_transcribe', 'voice_normalise', 'eval', 'merchant', 'menu'));

-- Grants: service role only, except what the table policies above allow operators to read.
revoke all on function public.whatsapp_seen(text, text), public.whatsapp_window_open(text, text),
  public.whatsapp_template_sync(text, jsonb), app_private.template_for(text, text, text, text),
  public.whatsapp_template_for(text, text, text, text), app_private.whatsapp_reachable(text, text, text, text),
  app_private.broadcast_audience(jsonb, integer), public.broadcast_create(uuid, text, text, jsonb, jsonb),
  public.broadcast_approve(uuid, uuid), public.broadcasts_pause(uuid), public.broadcast_claim(),
  public.broadcast_template_id(text, text), public.broadcast_finish(uuid, boolean, text[], text, text[]),
  public.customer_marketing_stop_by_phone(text, boolean), public.gift_request_create(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.whatsapp_seen(text, text), public.whatsapp_window_open(text, text),
  public.whatsapp_template_sync(text, jsonb), public.whatsapp_template_for(text, text, text, text),
  public.broadcast_create(uuid, text, text, jsonb, jsonb), public.broadcast_approve(uuid, uuid), public.broadcasts_pause(uuid),
  public.broadcast_claim(), public.broadcast_template_id(text, text), public.broadcast_finish(uuid, boolean, text[], text, text[]),
  public.customer_marketing_stop_by_phone(text, boolean), public.gift_request_create(uuid, uuid, bigint)
  to service_role;
