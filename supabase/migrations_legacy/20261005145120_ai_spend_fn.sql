-- Sum of estimated AI spend for a budget day. Service role only: used by the kapso-brain budget guard.
create or replace function public.ai_spend(p_day date) returns numeric
  language sql stable security definer set search_path = public as
$$ select coalesce(sum(est_usd), 0) from public.ai_call_log where day = p_day $$;
revoke all on function public.ai_spend(date) from public, anon, authenticated;
grant execute on function public.ai_spend(date) to service_role;
