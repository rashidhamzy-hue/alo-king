-- Rollback of 20261016210000_first_contact.sql (session 5f part 8a): no burst debounce, no opening times or "every shop near
-- you is closed", no "Remind me", no shop links by slug, no waitlist. tick_minute and customer_forget return to their
-- definitions in 20261016100000_staging_load.sql and 20261016170000_split_carts.sql. Redeploy the dispatch function from
-- before part 8a together with it (that one never calls these RPCs).
-- What is lost: the reminders and waitlist rows (the customers asked for one service message each; nothing else depends on
-- them) and which typed messages were folded into a burst (their events stay done). The config rows inbound_debounce_ms,
-- inbound_debounce_max_ms and the template map's waitlist_open stay (config rows are dated, never deleted); nothing reads
-- them once this file has run.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback: first contact (session 5f part 8a)', true);

-- As in 20261016100000_staging_load.sql.
create or replace function app_private.tick_minute() returns jsonb
language sql security definer set search_path = ''
as $$
  select app_private.tick_steps('tick-minute', array['claims_tick', 'hours_tick', 'availability_tick', 'gift_requests_expire']);
$$;
revoke all on function app_private.tick_minute() from public;

-- As in 20261016170000_split_carts.sql.
create or replace function public.customer_forget(p_customer_id uuid, p_scope text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loc jsonb := null;
begin
  if p_scope not in ('history', 'all') then
    raise exception 'scope must be history or all' using errcode = 'invalid_parameter_value';
  end if;
  update public.customers set profile_reset_at = now() where id = p_customer_id;
  delete from public.customer_preferences where customer_id = p_customer_id;
  update public.bot_sessions set history = '[]', refs = '{}', pending = '{}', focus_vendor_id = null where customer_id = p_customer_id;
  if p_scope = 'all' then
    update public.baskets set status = 'abandoned' where customer_id = p_customer_id and status = 'open';
    delete from public.saved_carts where customer_id = p_customer_id;
    v_loc := public.location_forget_customer(p_customer_id);
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now(), display_name = null
    where id = p_customer_id;
  end if;
  return jsonb_build_object('status', 'forgotten', 'scope', p_scope, 'location', v_loc);
end;
$$;

drop function app_private.customer_waits_tick();
drop function public.customer_waits_forget(uuid);
drop function public.waitlist_join(uuid, text);
drop function public.waitlist_state(uuid, text, uuid);
drop table app_private.place_waitlist;
drop function public.shop_for_link(uuid, text, uuid);
drop function public.shop_reminder_set(uuid, uuid);
drop function app_private.customer_window_end(uuid);
drop table app_private.shop_reminders;
drop function public.shops_closed_near(uuid);
drop function app_private.near_open_state(uuid);
drop function app_private.near_shops(uuid);
drop function public.vendor_opening(uuid[]);
drop function app_private.opening_json(timestamptz);
drop function app_private.vendor_open_now(uuid);
drop function app_private.vendor_opens_at(uuid, timestamptz);
drop function public.webhook_defer(bigint, bigint, integer, numeric);
drop function public.customer_burst(bigint);
drop function app_private.burst_candidate(public.webhook_events);
drop index public.webhook_events_pending_text_idx;
drop index public.webhook_events_folded_idx;
drop function app_private.inbound_phone(jsonb);
alter table public.webhook_events drop column burst_led_at, drop column folded_into;
