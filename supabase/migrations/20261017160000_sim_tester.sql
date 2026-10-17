-- Session 5g part E (DECISIONS §36, §39.15.3): the friends' path on the staging simulator. A simulator number is never enrolled
-- by the invite code (demo_tester_enrol), so a scenario that walks a tester's path (a pin in Dubai, Riyadh or Beirut, the demo
-- addresses, the demo autopilot) enrols its +999 persona here. Staging only: it answers sink_off where the simulator sink is
-- off (production), and refuses any number that is not a simulator number.
-- The enrolment lasts an hour (the e2e job's limit is 40 minutes): a run that stops before its closing step never keeps a
-- tester slot (demo_tester_max) from a real friend past that hour.
create function public.sim_tester(p_customer_phone text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
begin
  if not app_private.sim_sink_on() then
    return jsonb_build_object('status', 'sink_off');
  end if;
  if not app_private.is_sim_phone(p_customer_phone) then
    return jsonb_build_object('status', 'not_a_sim_phone');
  end if;
  select c.id into v_customer from public.customers c where c.phone_e164 = p_customer_phone;
  if v_customer is null then
    return jsonb_build_object('status', 'no_customer');
  end if;
  perform set_config('app.actor_kind', 'system', true);
  perform set_config('app.audit_reason', 'simulator demo tester (DECISIONS §36, §39.15.3)', true);
  if p_on then
    insert into app_private.demo_testers (customer_id, phone_e164, enrolled_at, expires_at)
    values (v_customer, p_customer_phone, now(), now() + interval '1 hour')
    on conflict (customer_id) do update set enrolled_at = excluded.enrolled_at, expires_at = excluded.expires_at,
      removed_at = null, removed_by = null;
  else
    update app_private.demo_testers set removed_at = now(), removed_by = 'simulator'
    where customer_id = v_customer and removed_at is null;
  end if;
  return jsonb_build_object('status', 'ok', 'tester', p_on);
end;
$$;
revoke all on function public.sim_tester(text, boolean) from public, anon, authenticated;
grant execute on function public.sim_tester(text, boolean) to service_role;
