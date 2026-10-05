
revoke execute on function public.vendor_completeness(text) from public, anon;
revoke execute on function public.vendor_is_open(text) from public, anon;
grant execute on function public.vendor_is_open(text) to authenticated, service_role;
