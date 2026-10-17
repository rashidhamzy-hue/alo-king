-- Session 5g part 0f (DECISIONS §39.15.3, Rasheed 17 October: friends in Dubai, Riyadh and Beirut live the whole
-- experience): a demo tester (or an owner) who taps or types "Change address" gets the demo addresses at once, as one card,
-- not a pin request whose answer would only bring the same card back. The choices are the ones address_save_pin offers
-- outside the area (demo_address_choices: places delivered to now, three at most); nobody else gets any (null).
create function public.demo_address_choices_for(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when app_private.demo_addresses_for(p_customer_id) then app_private.demo_address_choices() end;
$$;
revoke all on function public.demo_address_choices_for(uuid) from public, anon, authenticated;
grant execute on function public.demo_address_choices_for(uuid) to service_role;
