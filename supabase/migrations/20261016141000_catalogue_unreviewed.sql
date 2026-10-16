-- Session 5f hotfix (DECISIONS §39.15.2). The first status sweep on staging (16 October, 10:30 UTC) read 1,701 products
-- of the WhatsApp catalogue: Meta reported an empty review_status for every one of them (the field is filled for Shops
-- and ads catalogues, not for a WhatsApp-only one). 1,228 were published, in stock and without errors; one carried a
-- "Policy violations" refusal; 472 were the products we hide (archived, out of stock). Requiring "approved" therefore
-- showed nothing: every shop opened with the list menu.
--
-- An empty review status now reads as Meta's answer through the other fields, failing safe: an error that says the
-- product was refused (in its title, description or error_type) is rejected; published with its errors read and none
-- left is approved; anything else (an error we do not know, no visibility, a read without the errors field) stays unsure,
-- so the product waits in the list and its error shows in catalog_status_report. Stock is not review: catalog_item_shown
-- checks it on its own. Rows already recorded are read the same way at once. Because an empty status can no longer mean
-- "pending", the full read runs every 2 hours instead of every 20, so a refusal Meta posts later is seen within 2 hours.

-- p_errors is null when the read did not include the errors field (Meta refused it): no evidence, so unsure.
create function app_private.catalog_meta_status(p_raw text, p_visibility text, p_errors jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_raw, '') <> '' then p_raw
    when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_errors) = 'array' then p_errors else '[]' end) e
                 where (coalesce(e ->> 'title', '') || ' ' || coalesce(e ->> 'description', '') || ' ' || coalesce(e ->> 'error_type', ''))
                       ~* '(polic|reject|not.?approved|violat|prohibit|restrict|eligib|refus)') then 'rejected'
    when p_visibility = 'published' and jsonb_typeof(p_errors) = 'array' and jsonb_array_length(p_errors) = 0 then 'approved'
    else '' end;
$$;
revoke all on function app_private.catalog_meta_status(text, text, jsonb) from public, anon, authenticated;

create or replace function public.catalog_status_record(p_catalog_id text, p_rows jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  -- Meta's words are cleaned to the table's shape (a value we have never seen never breaks a page), then read as one
  -- status: an empty review status (what this WhatsApp catalogue reports) goes through app_private.catalog_meta_status.
  insert into public.catalog_item_status (item_id, vendor_id, catalog_id, meta_status, visibility, availability, errors, checked_at)
  select x.item_id, x.vendor_id, p_catalog_id,
    app_private.catalog_meta_status(x.raw, x.visibility, x.errors_read), x.visibility, x.availability,
    coalesce(x.errors_read, '[]'), now()
  from (
    select distinct on (i.id) i.id as item_id, i.vendor_id,
      left(regexp_replace(lower(coalesce(r ->> 'review_status', '')), '[^a-z_]', '_', 'g'), 30) as raw,
      nullif(left(regexp_replace(lower(coalesce(r ->> 'visibility', '')), '[^a-z_]', '_', 'g'), 30), '') as visibility,
      nullif(left(lower(coalesce(r ->> 'availability', '')), 40), '') as availability,
      -- Null when the read did not ask for errors (the field refused): the status then stays unsure.
      case when r ? 'errors' then case jsonb_typeof(r -> 'errors')
        when 'array' then r -> 'errors'
        when 'object' then coalesce(case when jsonb_typeof(r -> 'errors' -> 'data') = 'array' then r -> 'errors' -> 'data' end, '[]')
        else '[]' end end as errors_read
    from jsonb_array_elements(p_rows) r
    join public.menu_items i on i.id::text = r ->> 'retailer_id'
    where (r ->> 'retailer_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by i.id
  ) x
  on conflict (item_id) do update
    set vendor_id = excluded.vendor_id, catalog_id = excluded.catalog_id, meta_status = excluded.meta_status,
        visibility = excluded.visibility, availability = excluded.availability, errors = excluded.errors,
        checked_at = excluded.checked_at;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.catalog_status_record(text, jsonb) from public, anon, authenticated;
grant execute on function public.catalog_status_record(text, jsonb) to service_role;

update public.catalog_item_status
set meta_status = app_private.catalog_meta_status(meta_status, visibility, errors)
where meta_status = '';

comment on column public.catalog_item_status.meta_status is
  'Meta''s review status from GET /{catalog}/products: approved, rejected, pending, outdated, missing (not listed in a whole sweep) or empty (unsure). Meta reports an empty review_status for this WhatsApp catalogue; app_private.catalog_meta_status then reads it from the errors and the visibility (approved = published with its errors read and none left; rejected = an error that says so).';

insert into public.app_config (key, value, effective_from, note) values
  ('catalog_status_full_hours', '2', '2026-10-16 13:00+03',
   'Session 5f hotfix: an empty review status cannot mean pending, so a refusal Meta posts later is read within 2 hours (4 page reads a sweep)');
