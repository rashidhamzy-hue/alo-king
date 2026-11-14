-- 0100 (session SP1, reply speed): the adaptive burst buffer as a setting, and one database round trip before the model.
--
-- A4 measured a typed reply at p50 15.9 s on staging; 8.3 s of it passed before the turn started: the 6-second burst buffer on
-- every text (BUFFER_SECONDS) and about 2.3 s of separate calls (begin_turn, touch_conversation, record_first_contact, the
-- wa_messages insert), then two more before the model (model_turn_budget, customer_context).
--
-- settings.burst: how long the conversation object waits for the rest of a burst (apps/gateway/src/index.ts, burstDeadline).
--   quiet_ms  a text starts its turn after this much silence; each new text inside it extends the wait
--   max_ms    ...but never past this from the burst's first message
--   media_ms  a burst with a voice note or a picture waits this long after its last message (the old 6 s)
--   Buttons and pins never wait. The Worker reads this at most once a minute per conversation; unreadable means these defaults.
--
-- open_turn(): what the four calls did, in the same order and with the same rules, in one transaction, plus the two reads the
-- turn needs before the model. Built from the latest definitions (begin_turn 0008, touch_conversation 0003,
-- record_first_contact 0056, model_turn_budget 0055, customer_context 0019), which it calls; none of them changes.
--   1. begin_turn. 'done' or 'give_up': returned at once, nothing else touched (runTurn answers "duplicate").
--   2. touch_conversation. Unknown on the ops line, or blocked: returned with what it said; no message is stored (as before).
--   3. record_first_contact, before the messages are stored (it looks for earlier inbound messages). Its failure never stops
--      the turn: it runs in its own block, as the Worker ignored its error before.
--   4. the inbound messages into wa_messages. A retried turn finds them there: on conflict do nothing (before, the whole insert
--      failed on the first duplicate and the error was ignored: the same rows either way).
--   5. model_turn_budget and customer_context, read now so the turn needs no other call before the model.
-- One behaviour is stricter: before, a failed begin_turn was ignored and the turn ran; now any failure fails the turn, which the
-- conversation object retries (and gives up on loudly after three attempts).

insert into settings(key, value) values ('burst', '{"quiet_ms": 1200, "max_ms": 4000, "media_ms": 6000}')
on conflict (key) do nothing;

create or replace function open_turn(p_key text, p_line wa_line, p_wa_user_id text, p_phone text, p_name text, p_messages jsonb)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare v_turn text; v_conv jsonb; v_party uuid; v_head jsonb := p_messages->0;
begin
  v_turn := begin_turn(p_key, p_line, null);
  if v_turn in ('done', 'give_up') then return jsonb_build_object('turn', v_turn); end if;

  v_conv := touch_conversation(p_line, p_wa_user_id, p_phone, p_name);
  if not coalesce((v_conv->>'known')::boolean, false) or coalesce((v_conv->>'blocked')::boolean, false) then
    return v_conv || jsonb_build_object('turn', v_turn);
  end if;
  v_party := (v_conv->>'party_id')::uuid;

  if v_head is not null then
    begin
      perform record_first_contact(v_party, v_head->>'wa_message_id', v_head->>'body_text', nullif(v_head->'referral', 'null'::jsonb));
    exception when others then null;                                 -- where a customer came from is data, never a reason to fail
    end;
  end if;

  begin
    insert into wa_messages(line, direction, party_id, conversation_id, wa_message_id, type, status, body, transcript)
    select p_line, 'inbound', v_party, (v_conv->>'conversation_id')::uuid, m->>'wa_message_id', m->>'type', 'received',
           m->>'body', nullif(m->'transcript', 'null'::jsonb)
      from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) m
    on conflict (wa_message_id) do nothing;
  exception when others then null;                                   -- as before: the turn does not depend on this copy
  end;

  return v_conv || jsonb_build_object('turn', v_turn, 'budget', model_turn_budget(v_party), 'customer_context', customer_context(v_party));
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
