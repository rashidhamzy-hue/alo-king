-- Alo King Chouf, session B1e, migration 0235: the consent a rider or a vendor gives by sending their code, as the coordinator read it (UX3's
-- Arabic, read 18 November 2026; docs/ARABIC_REVIEW.md, UX3, "RA 18 Nov").
--
-- claim_link_code (0233) is copied with one change: the two Lebanese lines it records in consent_events.wording for a rider's and a vendor's
-- code. The checkout's line (0129, read 17 November) is unchanged. Consent rows already recorded keep the words the sender saw then: a row is
-- evidence of what was agreed and is never rewritten. Nothing else changes: no table, no grant, no other function.

create or replace function claim_link_code(p_party uuid, p_code text, p_wamid text default null) returns jsonb language plpgsql as $$
declare v_code text; c link_codes%rowtype; s web_sessions%rowtype; v_role party_role; v_wording text;
begin
  v_code := upper(substring(coalesce(p_code, '') from '(?i)ALO[- ]?([23456789A-HJ-NP-Z]{6})(?![0-9A-Z])'));
  if v_code is null then return jsonb_build_object('ok', false, 'status', 'not_a_code'); end if;
  v_code := 'ALO-' || v_code;
  select * into c from link_codes where code = v_code for update;
  if not found then return jsonb_build_object('ok', false, 'status', 'unknown'); end if;
  if c.used_at is not null then
    if c.used_by = p_party then
      return jsonb_build_object('ok', true, 'status', 'linked', 'again', true, 'session_id', c.session_id);
    end if;
    return jsonb_build_object('ok', false, 'status', 'used');
  end if;
  if c.expires_at <= now() then return jsonb_build_object('ok', false, 'status', 'expired'); end if;
  select role into v_role from parties where id = p_party;
  if v_role is distinct from 'customer' then return jsonb_build_object('ok', false, 'status', 'not_customer'); end if;
  select * into s from web_sessions where id = c.session_id for update;
  if s.revoked_at is not null or s.expires_at <= now() then return jsonb_build_object('ok', false, 'status', 'expired'); end if;
  if s.party_id is not null and s.party_id <> p_party then return jsonb_build_object('ok', false, 'status', 'used'); end if;

  update link_codes set used_at = now(), used_by = p_party, used_wamid = p_wamid where id = c.id;
  update web_sessions set party_id = p_party, link_code_id = c.id, linked_at = now(), last_seen_at = now(),
         expires_at = now() + make_interval(days => coalesce((setting('web')->>'session_days')::int, 90))
   where id = s.id;
  -- The page said what sending the code means; the message is the evidence (as the card's confirm tap is, 0040).
  v_wording := case c.purpose
    when 'rider'  then 'لمّا تبعت الرمز، بتأكّد رقمك وبتوافق إنّو نردّ عليك بهالمحادثة على طلب انضمامك كدليفري.'
    when 'vendor' then 'لمّا تبعت الرمز، بتأكّد رقمك وبتوافق إنّو نردّ عليك بهالمحادثة على طلب انضمام محلّك.'
    else 'بإرسال الرمز بتأكد رقمك وبتوافق نبعتلك تحديثات طلباتك على هالمحادثة' end;
  insert into consent_events(party_id, line, kind, action, source, wording, evidence_message_id)
    values (p_party, 'customer', 'transactional', 'opt_in', 'web_link_code', v_wording, p_wamid);
  return jsonb_build_object('ok', true, 'status', 'linked', 'again', false, 'session_id', s.id);
end $$;
