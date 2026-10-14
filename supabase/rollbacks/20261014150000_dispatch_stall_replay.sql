-- Rollback of 20261014150000_dispatch_stall_replay.sql: the earlier webhook_finish, customer_turn_begin and
-- basket_add_item (from 20261007120400 and 20261011100100), without keyed adds or turn leases. Deletes nothing a customer made.
select cron.unschedule('basket-add-ops-prune');
drop function app_private.basket_add_ops_prune();
drop function public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean, text);
drop table app_private.basket_add_ops;
drop function public.customer_turn_release(text);
drop function public.customer_turn_begin(text, text, text, text, integer);
alter table public.bot_turns drop column lease_until;
drop function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer, integer);

create function public.webhook_finish(
  p_msg_id bigint,
  p_event_id bigint,
  p_status public.webhook_status,
  p_error text default null,
  p_max_attempts integer default 5
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_status not in ('done', 'failed', 'ignored') then
    raise exception 'webhook_finish takes done, failed or ignored' using errcode = 'invalid_parameter_value';
  end if;
  update public.webhook_events e
    set status = p_status,
        last_error = case when p_status = 'failed' then left(p_error, 1000) else e.last_error end,
        processed_at = case when p_status in ('done', 'ignored') then now() else e.processed_at end
    where e.id = p_event_id
    returning e.attempts into v_attempts;
  if not found then
    raise exception 'webhook event % does not exist', p_event_id using errcode = 'no_data_found';
  end if;
  if p_status <> 'failed' or v_attempts >= p_max_attempts then
    perform pgmq.archive('webhook_inbound', p_msg_id);
  end if;
end;
$$;
revoke all on function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer) from public, anon, authenticated;
grant execute on function public.webhook_finish(bigint, bigint, public.webhook_status, text, integer) to service_role;

create function public.customer_turn_begin(
  p_phone_e164 text,
  p_message_id text,
  p_kind text,
  p_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_session public.bot_sessions%rowtype;
  v_first boolean := false;
begin
  if p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone must be E.164' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.customers (phone_e164, display_name, last_inbound_at)
  values (p_phone_e164, left(nullif(trim(p_display_name), ''), 80), now())
  on conflict (phone_e164) do update set last_inbound_at = now(),
    display_name = coalesce(public.customers.display_name, excluded.display_name)
  returning * into v_customer;
  v_first := v_customer.created_at > now() - interval '5 seconds';

  insert into public.bot_turns (message_id, customer_id, kind) values (p_message_id, v_customer.id, left(p_kind, 40))
  on conflict (message_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
  end if;

  insert into public.bot_sessions (customer_id) values (v_customer.id) on conflict (customer_id) do nothing;
  select * into v_session from public.bot_sessions where customer_id = v_customer.id for update;
  if v_session.last_turn_at is not null and v_session.last_turn_at < now() - interval '24 hours' then
    update public.bot_sessions set history = '[]', pending = '{}', refs = '{}', low_confidence = 0, focus_vendor_id = null
    where customer_id = v_customer.id returning * into v_session;
  end if;
  update public.bot_sessions set last_turn_at = now() where customer_id = v_customer.id;

  return jsonb_build_object(
    'duplicate', false,
    'first_contact', v_first,
    'customer', jsonb_build_object('id', v_customer.id, 'language', v_customer.language, 'name', v_customer.display_name,
      'marketing_opt_in', v_customer.marketing_opt_in,
      'blocked', v_customer.blocked_until is not null and v_customer.blocked_until > now()),
    'session', jsonb_build_object('lang', v_session.lang, 'focus_vendor_id', v_session.focus_vendor_id,
      'pending', v_session.pending, 'refs', v_session.refs, 'history', v_session.history,
      'low_confidence', v_session.low_confidence,
      'handoff', v_session.handoff_until is not null and v_session.handoff_until > now()),
    'basket', public.basket_view(v_customer.id),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'status', o.status, 'vendor', coalesce(v.name_ar, v.name_en),
        'vendor_en', coalesce(v.name_en, v.name_ar), 'weight_status', o.weight_status) order by o.created_at desc)
      from public.orders o join public.vendors v on v.id = o.vendor_id
      where o.customer_id = v_customer.id and o.status not in ('delivered', 'failed', 'rejected', 'cancelled')
        and o.created_at > now() - interval '2 days'), '[]'),
    'profile', public.customer_profile(v_customer.id),
    'bot_enabled', app_private.config_bool('customer_bot_enabled'),
    'support_open', app_private.beirut_hour() >= (public.config_value('support_hours') ->> 'from')::int
                    and app_private.beirut_hour() < (public.config_value('support_hours') ->> 'to')::int
  );
end;
$$;
revoke all on function public.customer_turn_begin(text, text, text, text) from public, anon, authenticated;
grant execute on function public.customer_turn_begin(text, text, text, text) to service_role;

create function public.basket_add_item(
  p_customer_id uuid,
  p_item_id uuid,
  p_quantity integer default 1,
  p_option_ids uuid[] default '{}',
  p_note text default null,
  p_replace boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.menu_items%rowtype;
  v_vendor public.vendors%rowtype;
  v_basket public.baskets%rowtype;
  v_qty integer := least(greatest(coalesce(p_quantity, 1), 1), 50);
  v_line uuid;
  v_opts uuid[] := coalesce((select array_agg(x order by x) from unnest(coalesce(p_option_ids, '{}')) x), '{}');
begin
  select * into v_item from public.menu_items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('status', 'unknown_item');
  end if;
  select * into v_vendor from public.vendors where id = v_item.vendor_id;
  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if not app_private.menu_item_orderable(p_item_id, v_qty) then
    return jsonb_build_object('status', 'unavailable', 'item', coalesce(v_item.name_ar, v_item.name_en));
  end if;
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is not null and v_basket.vendor_id <> v_vendor.id then
    if not p_replace then
      return jsonb_build_object('status', 'other_vendor',
        'basket_vendor', (select coalesce(v.name_ar, v.name_en) from public.vendors v where v.id = v_basket.vendor_id));
    end if;
    update public.baskets set status = 'abandoned' where id = v_basket.id;
    v_basket := null;
  end if;
  if v_basket.id is null then
    insert into public.baskets (customer_id, vendor_id, address_id)
    values (p_customer_id, v_vendor.id,
      (select a.id from public.addresses a where a.customer_id = p_customer_id order by a.is_default desc, a.last_used_at desc nulls last limit 1))
    returning * into v_basket;
  end if;
  select bi.id into v_line from public.basket_items bi
  where bi.basket_id = v_basket.id and bi.item_id = p_item_id and bi.option_ids = v_opts
    and bi.note is not distinct from nullif(trim(p_note), '');
  if v_line is not null then
    update public.basket_items set quantity = least(quantity + v_qty, 50) where id = v_line;
  else
    insert into public.basket_items (basket_id, item_id, quantity, option_ids, note)
    values (v_basket.id, p_item_id, v_qty, v_opts, left(nullif(trim(p_note), ''), 200))
    returning id into v_line;
  end if;
  update public.baskets set last_activity_at = now(), reminded_at = null where id = v_basket.id;
  return jsonb_build_object('status', 'added', 'line_id', v_line, 'basket', public.basket_view(p_customer_id));
end;
$$;
revoke all on function public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean) from public, anon, authenticated;
grant execute on function public.basket_add_item(uuid, uuid, integer, uuid[], text, boolean) to service_role;
