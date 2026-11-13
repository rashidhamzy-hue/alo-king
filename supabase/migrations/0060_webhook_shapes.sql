-- 0060 (session A2, task 4.1): webhook events read the way Kapso really sends them.
--
-- Two defects found by checking the parser against Kapso's payloads (test/fixtures/kapso/):
-- 1. whatsapp.contact.marketing_preference_changed carries an OBJECT ({status: stopped|resumed, sequence, ...}).
--    The gateway read it as a string, so every change, a stop included, was recorded as an opt-in.
-- 2. The same handler called touch_conversation(), which creates a party for a stranger and sets last_inbound_at:
--    a preference change looked like the customer had written to us and opened the free 24-hour reply window.
-- Both now go through apply_marketing_preference(), which never creates a party and never touches the conversation.
-- Kapso delivers at least once and out of order; `sequence` decides which change is newer (Kapso docs).
--
-- Also new: whatsapp.contact.identity_changed (a contact got a new business-scoped user id). Without it, the next
-- message from that person would arrive under an id we do not know, and they would become a second, empty customer.

alter table consent_events add column if not exists provider_sequence bigint;

create or replace function identity_party(p_line wa_line, p_wa_user_id text, p_phone text) returns uuid language sql stable as $$
  select party_id from party_identities
   where line = p_line and ((p_wa_user_id is not null and wa_user_id = p_wa_user_id) or (p_phone is not null and phone_e164 = p_phone))
   order by (wa_user_id = p_wa_user_id) desc nulls last limit 1 $$;

create or replace function apply_marketing_preference(p_line wa_line, p_wa_user_id text, p_phone text, p_status text, p_sequence bigint)
returns text language plpgsql as $$
declare v_party uuid := identity_party(p_line, p_wa_user_id, p_phone); v_action consent_action;
begin
  if p_status = 'stopped' then v_action := 'opt_out'; elsif p_status = 'resumed' then v_action := 'opt_in'; else return 'ignored'; end if;
  if v_party is null then return 'unknown_party'; end if;             -- never wrote to us: nothing to record, and nobody is created
  perform 1 from parties where id = v_party for update;               -- two deliveries for one person apply one at a time
  if p_sequence is not null and exists (select 1 from consent_events where party_id = v_party and line = p_line and kind = 'marketing'
      and source = 'meta_preference_webhook' and provider_sequence >= p_sequence) then
    return 'stale';                                                    -- a redelivery, or an older change arriving late
  end if;
  insert into consent_events(party_id, line, kind, action, source, provider_sequence)
    values (v_party, p_line, 'marketing', v_action, 'meta_preference_webhook', p_sequence);
  return 'applied';
end $$;

create or replace function rekey_identity(p_line wa_line, p_old text, p_new text, p_phone text) returns text language plpgsql as $$
declare v_party uuid; v_owner uuid;
begin
  if p_new is null then return 'ignored'; end if;
  select party_id into v_owner from party_identities where line = p_line and wa_user_id = p_new;
  v_party := identity_party(p_line, p_old, p_phone);
  if v_owner is not null then return case when v_owner = v_party then 'already' else 'conflict' end; end if;
  if v_party is null then return 'unknown_party'; end if;
  update party_identities set wa_user_id = p_new
   where party_id = v_party and line = p_line and (wa_user_id is not distinct from p_old or (p_old is null and phone_e164 = p_phone));
  if not found then update party_identities set wa_user_id = p_new where party_id = v_party and line = p_line and wa_user_id is null; end if;
  return 'rekeyed';
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
