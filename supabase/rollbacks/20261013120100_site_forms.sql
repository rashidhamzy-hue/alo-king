-- Rolls back 20261013120100_site_forms.sql (session 6b). Run by hand if the website's forms must come out; it drops the
-- rate-limit counters and any driver applications received so far. The enum value added by the earlier file stays (Postgres
-- cannot remove an enum value) and is harmless.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "operators read claim documents" on storage.objects';
  end if;
end;
$$;
drop function if exists public.driver_application_set_status(uuid, text);
drop function if exists app_private.driver_application_set_status(uuid, text);
drop function if exists public.driver_apply(text, text, text, text, boolean, text[], text[], text, public.lang_code);
drop table if exists public.driver_applications;
drop function if exists public.vendor_claim_lookup(uuid);
drop function if exists public.web_rate_hit(text, integer, integer);
drop table if exists app_private.web_rate;
