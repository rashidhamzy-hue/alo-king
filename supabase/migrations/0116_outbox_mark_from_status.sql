-- Alo King Chouf, session A5 (infra): a message that went out and could not be marked sent (AUDIT-G1 G1-18).
--
-- The gateway marks the outbox row sent after Kapso takes the message, trying three times. If all three fail the message is out
-- and the row still says "pending"; after the 60-second lease a retried turn claims it again and the customer gets the message
-- twice (at-least-once, accepted, and now loud: the gateway raises a Sentry event). This migration closes it where it can be
-- closed: Kapso's status webhook for that message ("sent", "delivered", "read") carries the message id, and when the gateway has
-- logged the message (wa_messages, which it writes right after the marks) the row can be found from it and marked sent.
--
-- The match is strict, so that a message is never marked sent that was not: the outbox row is unmarked (pending, no message id),
-- on the same line, for the same party, and its payload is the logged message's body (a text's body, or the JSON of anything else).
-- If several rows match (the same words sent to the same person under different keys, none marked) the oldest is taken; each
-- status marks one row. A row marked this way records where the mark came from in last_error. A "failed" status never marks
-- anything sent. If the log row is missing too (the database was down for both writes) nothing matches, and the Sentry event is
-- the only record: that case is left to a person on purpose, because a guess here could drop a message.

create or replace function outbox_mark_from_status(p_wamid text, p_status text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare w wa_messages%rowtype; v_key text;
begin
  if p_wamid is null or p_status not in ('sent', 'delivered', 'read') then return null; end if;
  select * into w from wa_messages where wa_message_id = p_wamid and direction = 'outbound';
  if not found or w.party_id is null or coalesce(w.status, '') = 'sink' then return null; end if;
  -- already known to the outbox under this id: nothing to find
  if exists (select 1 from wa_outbox where wa_message_id = p_wamid) then return null; end if;
  select o.dedupe_key into v_key
    from wa_outbox o
   where o.status = 'pending' and o.wa_message_id is null and o.line = w.line and o.party_id = w.party_id
     and o.created_at >= w.created_at - interval '1 day'
     and case when w.type = 'text' then o.payload->>'type' = 'text' and o.payload->'text'->>'body' = w.body
              else o.payload->>'type' = w.type and o.payload::text = (w.body::jsonb)::text end
   order by o.claimed_at nulls first, o.created_at
   limit 1
   for update skip locked;
  if v_key is null then return null; end if;
  update wa_outbox set status = 'sent', wa_message_id = p_wamid, sent_at = now(), last_error = 'marked_from_status_webhook' where dedupe_key = v_key;
  return v_key;
end $$;

-- 0061's function, with one call added at the end. Same arguments, same answer (was a wa_messages row updated).
create or replace function record_message_status(p_wamid text, p_status text, p_billable boolean default null,
  p_category text default null, p_type text default null, p_error_code text default null) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare rank_of constant jsonb := '{"sent":1,"delivered":2,"read":3,"failed":9}'; v_found boolean;
begin
  update wa_messages set
      status = case when status = 'sink' then status
                    when coalesce((rank_of->>p_status)::int, 0) >= coalesce((rank_of->>status)::int, 0) then p_status else status end,
      billable = coalesce(p_billable, billable),
      pricing_category = coalesce(p_category, pricing_category),
      pricing_type = coalesce(p_type, pricing_type),
      error_code = coalesce(p_error_code, error_code)
   where wa_message_id = p_wamid;
  v_found := found;
  perform outbox_mark_from_status(p_wamid, p_status);
  return v_found;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
