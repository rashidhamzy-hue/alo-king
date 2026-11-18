-- Alo King, session CX2 (WhatsApp replies, the founder's test), migration 0255. Docs: docs/log/cx2.md.
--   1 One card for a website order (AK-1063, 18 November 08:52: the card went twice, in Arabic from "Card AK-1063" and in English from the
--     cron three seconds later). A card request is claimed before it is sent, by whichever sends it first: the minute cron
--     (web_card_claim) or "Card AK-xxxx" typed by the website (web_card_again). The other then sends nothing. The card goes in the language
--     the customer chose on the page (web_card_requests.lang), whichever sends it. A "Card AK-xxxx" after the card has gone is the
--     customer's own ask and sends it again (never confirms: invariant 4).
--   2 settings.hours: 09:00 to 21:00, the recorded decision (F15 9; docs/RULES.md "Launch hours"). Rider shifts (join.rider.shifts) are
--     the founder's to set and are not changed here.

-- The minute cron's claim: true once, for the first caller; the language the page was in.
create or replace function web_card_claim(p_order uuid, p_by text default 'cron') returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_lang text;
begin
  update web_card_requests set done_at = now(), outcome = 'sending:' || left(coalesce(p_by, 'cron'), 20)
   where order_id = p_order and done_at is null
  returning lang into v_lang;
  return jsonb_build_object('claimed', v_lang is not null, 'lang', v_lang);
end $$;

-- The outcome of a send: closes a request still open, or one claimed for sending ("sending:…").
create or replace function web_card_done(p_order uuid, p_outcome text) returns void language sql set search_path = public, pg_temp as $$
  update web_card_requests set done_at = coalesce(done_at, now()), outcome = left(coalesce(p_outcome, 'done'), 80)
   where order_id = p_order and (done_at is null or outcome like 'sending:%')
$$;

-- "Card AK-xxxx": the sender's own card that still waits. A request the cron has not sent yet is claimed here, so the cron sends none;
-- `lang` is the page's language when the order came from the website (null for a chat order: the conversation's language then).
create or replace function web_card_again(p_party uuid, p_code text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; v_code text := upper(btrim(coalesce(p_code, ''))); v_lang text; v_claimed boolean := false;
begin
  select * into o from orders where short_code = v_code and customer_id = p_party;
  if not found then return jsonb_build_object('ok', false, 'status', 'unknown'); end if;
  if o.status <> 'awaiting_confirmation' then
    return jsonb_build_object('ok', false, 'status', 'not_waiting', 'order_status', o.status, 'short_code', o.short_code);
  end if;
  update web_card_requests set done_at = now(), outcome = 'sending:card_again'
   where order_id = o.id and done_at is null
  returning lang into v_lang;
  v_claimed := v_lang is not null;
  if v_lang is null then select lang into v_lang from web_card_requests where order_id = o.id; end if;
  return jsonb_build_object('ok', true, 'order_id', o.id, 'short_code', o.short_code, 'lang', v_lang, 'claimed', v_claimed);
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

update settings set value = jsonb_set(jsonb_set(value, '{open}', '"09:00"'), '{close}', '"21:00"') where key = 'hours';
