-- Alo King Chouf, session UX3, migration 0234: deciding a rider application, and what the console's Applicants tab reads.
--
-- The application (0233) is not a rider. A person decides, on the Riders page's Applicants tab:
--   accept_rider_application   ops lead or admin. Creates the rider the way a lead would by hand and nothing more: a party with role driver and an identity
--                              on the ops line from the number the applicant confirmed on the customer line (the ops line never creates staff by itself:
--                              touch_conversation, 0003). It starts no shift, records no terms (a rider carries cash only with their written terms on file,
--                              recorded on the roster, 0232), sends nothing, and never touches the applicant's own customer party.
--   decline_rider_application  ops lead or admin, with a reason. Makes no rider.
-- Both are logged to join_log (who, when, why) and are decided once. There was no function that created a rider before this one: riders were rows a person
-- inserted. This is the single door for the new way in; the old way (a row inserted by hand) is unchanged.
--
-- The case the application opened (0233) is left alone: the applicant is answered from the Inbox, where the case is, and resolved there by the person who
-- answered. A decision does not message anyone: only the gateway sends (invariant 1).
--
-- join_applicants_console is the read: staff only (service role). It returns the applicant's number (staff only, as the Claims tab of Listings does) and
-- the case's state. It carries no rating, score or rank: there is none to carry.

create or replace function accept_rider_application(p_application uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare a join_applications%rowtype; own party_identities%rowtype; v_rider uuid; v_lang text;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into a from join_applications where id = p_application for update;
  if not found then raise exception 'UNKNOWN_APPLICATION'; end if;
  if a.kind <> 'rider' then raise exception 'NOT_A_RIDER_APPLICATION'; end if;
  if a.status <> 'open' then raise exception 'ALREADY_DECIDED'; end if;
  select * into own from party_identities where party_id = a.party_id and line = 'customer' order by created_at limit 1;
  if not found then raise exception 'NO_CONFIRMED_NUMBER'; end if;
  if exists (select 1 from party_identities i where i.line = 'ops'
               and ((own.phone_e164 is not null and i.phone_e164 = own.phone_e164) or (own.wa_user_id is not null and i.wa_user_id = own.wa_user_id))) then
    raise exception 'ALREADY_ON_OPS_LINE';
  end if;
  select language_pref into v_lang from parties where id = a.party_id;
  insert into parties(role, display_name, language_pref) values ('driver', a.name, coalesce(v_lang, 'ar')) returning id into v_rider;
  insert into party_identities(party_id, line, wa_user_id, phone_e164) values (v_rider, 'ops', own.wa_user_id, own.phone_e164);
  update join_applications set status = 'accepted', rider_party_id = v_rider, decided_by = p_by, decided_at = now() where id = a.id;
  insert into join_log(application_id, action, by_party, detail) values (a.id, 'accept', p_by, jsonb_build_object('rider_party_id', v_rider, 'case_id', a.case_id));
  return jsonb_build_object('ok', true, 'application_id', a.id, 'rider_party_id', v_rider);
end $$;

create or replace function decline_rider_application(p_application uuid, p_by uuid, p_reason text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare a join_applications%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into a from join_applications where id = p_application for update;
  if not found then raise exception 'UNKNOWN_APPLICATION'; end if;
  if a.kind <> 'rider' then raise exception 'NOT_A_RIDER_APPLICATION'; end if;
  if a.status <> 'open' then raise exception 'ALREADY_DECIDED'; end if;
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update join_applications set status = 'declined', decision_reason = left(v_reason, 500), decided_by = p_by, decided_at = now() where id = a.id;
  insert into join_log(application_id, action, by_party, reason, detail) values (a.id, 'decline', p_by, left(v_reason, 500), jsonb_build_object('case_id', a.case_id));
  return jsonb_build_object('ok', true, 'application_id', a.id);
end $$;

-- p_state: 'open' (waiting for a person) or 'decided' (accepted or declined, newest decision first). p_kind: 'rider' or 'vendor'.
create or replace function join_applicants_console(p_kind text default 'rider', p_state text default 'open', p_limit int default 100) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'status', a.status, 'name', a.name, 'village', a.village, 'village_ar', (select v.name_ar from villages v where v.id = a.village_id),
           'vehicle', a.vehicle, 'licence', a.licence, 'days', a.days, 'shifts', a.shifts, 'place_kind', a.place_kind, 'listing_id', a.listing_id,
           'phone', (select i.phone_e164 from party_identities i where i.party_id = a.party_id and i.line = 'customer' and i.phone_e164 is not null order by i.created_at limit 1),
           'case_id', a.case_id, 'case_state', coalesce((select h.state from handoffs h where h.id = a.case_id), 'open'),
           'created_at', a.created_at, 'decided_at', a.decided_at, 'decided_by', a.decided_by, 'decided_by_name', (select p.display_name from parties p where p.id = a.decided_by),
           'decision_reason', a.decision_reason, 'rider_party_id', a.rider_party_id)
         order by case when p_state = 'open' then a.created_at end, a.decided_at desc nulls last), '[]'::jsonb)
    from (select * from join_applications x
           where x.kind = coalesce(p_kind, 'rider') and ((coalesce(p_state, 'open') = 'open' and x.status = 'open') or (p_state = 'decided' and x.status <> 'open'))
           order by case when coalesce(p_state, 'open') = 'open' then x.created_at end, x.decided_at desc nulls last
           limit least(greatest(coalesce(p_limit, 100), 1), 500)) a $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
