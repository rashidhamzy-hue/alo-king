-- Alo King Chouf, session FD1, migration 0247: approve_merchant() for a place, and the food service fee. docs/DECISIONS.md, "FD1, 18 November 2026".
--
--   1 approve_merchant stays the one door (invariant 11). For a signed merchant it is 0009's, word for word: an ops lead or an admin, a
--     commission above 0 and at most 40, the date the terms were accepted, an approved menu with prices. For a PLACE (Alo King buys for the
--     customer at the counter; the restaurant does nothing new) there is no commission and no terms: the owner has agreed to nothing yet, so
--     commission_pct is 0 and terms_accepted_at stays empty. It needs an approved dish with a price AND the "menu checked" stamp (0246).
--     The place is then orderable for its visibility only (0245's place_orderable_for): testers for testers, nobody when off, everyone only
--     when public, and public needs the owner's claim or application on file.
--   2 settings.food.service_fee_usd = 0: a food service fee, company income, off for now; an admin may change it on the Settings page (0 to 5).
--     The delivery fee for food is the zone's fee, as for groceries, and belongs to whoever delivers (invariant 10). FD2 applies both in the quote.

create or replace function approve_merchant(p_source uuid, p_by uuid, p_commission_pct numeric, p_terms_accepted_at timestamptz default now()) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_items int; s sources%rowtype;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead','admin')) then raise exception 'NOT_AUTHORISED'; end if;
  select * into s from sources where id = p_source and kind = 'merchant' for update;
  if not found then raise exception 'NOT_A_MERCHANT'; end if;
  if s.buys_for_customer then
    select count(*) into v_items from offers where source_id = p_source and is_available and price_usd > 0;
    if v_items = 0 then raise exception 'NO_APPROVED_MENU'; end if;
    if s.menu_checked_on is null then raise exception 'MENU_NOT_CHECKED: stamp the menu as checked first'; end if;
    update sources set commission_pct = 0, terms_accepted_at = null, approved_by = p_by, approved_at = now(), is_open = true where id = p_source;
    insert into place_log(source_id, action, by_party, detail) values (p_source, 'approve', p_by, jsonb_build_object('items', v_items, 'visibility', s.visibility));
    return jsonb_build_object('ok', true, 'items', v_items, 'commission_pct', 0, 'visibility', s.visibility, 'buys_for_customer', true);
  end if;
  if p_commission_pct is null or p_commission_pct <= 0 or p_commission_pct > 40 then raise exception 'COMMISSION_REQUIRED'; end if;
  select count(*) into v_items from offers where source_id = p_source and is_available and price_usd > 0;
  if v_items = 0 then raise exception 'NO_APPROVED_MENU'; end if;
  update sources set commission_pct = p_commission_pct, terms_accepted_at = p_terms_accepted_at, approved_by = p_by, approved_at = now(), is_open = true
   where id = p_source;
  return jsonb_build_object('ok', true, 'items', v_items, 'commission_pct', p_commission_pct);
end $$;

insert into settings(key, value) values ('food', '{"service_fee_usd": 0}') on conflict (key) do nothing;
insert into editable_settings(key, field, kind, min_value, max_value, max_len, choices, two_person, two_person_when)
  values ('food', 'service_fee_usd', 'number', 0, 5, null, null, false, null)
  on conflict (key, field) do nothing;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
