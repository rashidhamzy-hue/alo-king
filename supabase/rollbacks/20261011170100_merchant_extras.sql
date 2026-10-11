-- Rollback for 20261011170100_merchant_extras.sql. The migration deletes no data itself: its DELETE statements
-- run later, inside vendor_power_on() (the generator list) and order_substitution_decide() (a declined line).
-- This file removes what the migration created and restores the proposal functions. It keeps menu_items.needs_power, the substitution columns on
-- baskets and orders and the dated config rows (dated rows are never deleted once in effect); nothing reads
-- them afterwards. Items still hidden by generator mode are made available again first.
update public.menu_items i set available = true from app_private.power_hidden_items h where h.item_id = i.id;
update public.vendors v set paused_until = null, pause_reason = null where pause_reason = 'kitchen full (auto)';
drop trigger if exists orders_capacity_eta on public.orders;
drop trigger if exists orders_capacity_after on public.orders;
drop trigger if exists orders_copy_substitution on public.orders;
drop function if exists public.vendor_same_price(uuid);
drop function if exists public.order_card_image(uuid);
drop function if exists public.order_substitution_decide(uuid, uuid, boolean);
drop function if exists public.order_substitution_offer(uuid, text, text, uuid, uuid);
drop function if exists app_private.order_substitution_offer(uuid, text, text, uuid, uuid);
drop table if exists public.order_substitutions;
drop function if exists public.basket_set_substitution(uuid, text);
drop function if exists public.basket_substitution_needed(uuid);
drop function if exists app_private.orders_copy_substitution();
drop function if exists public.staff_shift_touch(text);
drop table if exists app_private.member_shifts;
drop function if exists public.vendor_staff_find(uuid, text);
drop function if exists app_private.vendor_power_on(uuid);
drop function if exists app_private.vendor_power_off(uuid);
drop table if exists app_private.power_hidden_items;
drop function if exists app_private.orders_capacity_after();
drop function if exists app_private.orders_capacity_eta();
-- Pending proposals of the new kinds can no longer be applied.
update public.merchant_proposals set status = 'expired', decided_at = now()
where status = 'proposed' and kind::text in ('power_off', 'power_on', 'needs_power', 'capacity', 'staff_add', 'staff_remove', 'same_price');
-- The proposal functions as they were in 20261011090200 (the new enum values stay; these bodies refuse them).
create or replace function app_private.merchant_proposal_create(
  p_vendor_id uuid,
  p_kind public.proposal_kind,
  p_payload jsonb,
  p_source text,
  p_member_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_roles public.member_role[];
  v_id uuid;
  v_item uuid := nullif(p_payload ->> 'item_id', '')::uuid;
begin
  -- Prices are owner and manager only (§18.1 H); availability and pause also cashier and kitchen.
  v_roles := case when p_kind = 'price' then array['owner', 'manager']::public.member_role[]
                  else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end;
  v_member := app_private.order_actor(p_vendor_id, v_roles, p_member_id);
  if p_kind in ('sold_out', 'back_in_stock', 'price', 'stock_add') and not exists (
    select 1 from public.menu_items i where i.id = v_item and i.vendor_id = p_vendor_id
  ) then
    raise exception 'unknown item for this merchant' using errcode = 'check_violation';
  end if;
  if p_kind = 'price' and ((p_payload ->> 'price_usd')::numeric is null or (p_payload ->> 'price_usd')::numeric < 0
                           or (p_payload ->> 'price_usd')::numeric > 10000) then
    raise exception 'price must be between 0 and 10000 USD' using errcode = 'check_violation';
  end if;
  if p_kind = 'pause' and ((p_payload ->> 'until')::timestamptz is null or (p_payload ->> 'until')::timestamptz <= now()
                           or (p_payload ->> 'until')::timestamptz > now() + interval '7 days') then
    raise exception 'a pause ends in the next 7 days' using errcode = 'check_violation';
  end if;
  if p_kind = 'stock_add' and coalesce((p_payload ->> 'add')::int, 0) not between 1 and 1000 then
    raise exception 'stock to add must be 1-1000' using errcode = 'check_violation';
  end if;
  insert into public.merchant_proposals (vendor_id, member_id, kind, payload, source, expires_at)
  values (p_vendor_id, v_member, p_kind, coalesce(p_payload, '{}'), p_source,
          now() + make_interval(secs => public.config_numeric('merchant_proposal_ttl_s')))
  returning id into v_id;
  return v_id;
end;
$$;

-- The confirming tap. Applies the change and returns what happened.
create or replace function app_private.merchant_proposal_decide(p_proposal_id uuid, p_confirm boolean, p_member_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.merchant_proposals%rowtype;
  v_member uuid;
  v_item uuid;
begin
  select * into v_p from public.merchant_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    raise exception 'unknown proposal' using errcode = 'no_data_found';
  end if;
  v_member := app_private.order_actor(v_p.vendor_id,
    case when v_p.kind = 'price' then array['owner', 'manager']::public.member_role[]
         else array['owner', 'manager', 'cashier', 'kitchen']::public.member_role[] end, p_member_id);
  if v_p.status <> 'proposed' then
    return jsonb_build_object('status', v_p.status);
  end if;
  if v_p.expires_at < now() then
    update public.merchant_proposals set status = 'expired', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not p_confirm then
    update public.merchant_proposals set status = 'rejected', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'merchant proposal ' || p_proposal_id || ' confirmed', true);
  v_item := nullif(v_p.payload ->> 'item_id', '')::uuid;
  case v_p.kind
    when 'pause' then perform app_private.vendor_set_pause(v_p.vendor_id, (v_p.payload ->> 'until')::timestamptz, 'merchant pause', 'pause');
    when 'resume' then
      perform app_private.vendor_set_pause(v_p.vendor_id, null, null, 'resume');
      update public.vendors set missed_orders_streak = 0 where id = v_p.vendor_id;
    when 'sold_out' then update public.menu_items set available = false where id = v_item and vendor_id = v_p.vendor_id;
    when 'back_in_stock' then update public.menu_items set available = true where id = v_item and vendor_id = v_p.vendor_id;
    when 'price' then update public.menu_items set price_usd = (v_p.payload ->> 'price_usd')::numeric where id = v_item and vendor_id = v_p.vendor_id;
    when 'stock_add' then
      update public.menu_items set
        daily_quantity = case when daily_date = current_date then daily_quantity else 0 end + (v_p.payload ->> 'add')::int,
        daily_remaining = case when daily_date = current_date then daily_remaining else 0 end + (v_p.payload ->> 'add')::int,
        daily_date = current_date
      where id = v_item and vendor_id = v_p.vendor_id;
  end case;
  update public.merchant_proposals set status = 'confirmed', decided_at = now(), member_id = coalesce(v_member, member_id)
  where id = p_proposal_id;
  return jsonb_build_object('status', 'confirmed', 'kind', v_p.kind);
end;
$$;

drop function if exists app_private.kitchen_capacity_check(uuid);
drop function if exists app_private.kitchen_queue(uuid);
drop function if exists app_private.order_cod_cap(uuid);
drop function if exists app_private.proposal_roles(public.proposal_kind);
drop table if exists public.vendor_ops;
