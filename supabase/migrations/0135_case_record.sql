-- Alo King Chouf, session HO1 (the never-stranded hand-off), docs/strategy/05-console-website-design-handoff.md section D.
-- Migrations 0135-0138. This one: the case record, the bot's pause, settings.support, and the functions staff and the turn call.
--
-- Principle: a person is added to a conversation; the bot is never removed from it. A technical failure is not a hand-off.
--   * handoffs becomes the case record (kind, topic, order, state open -> claimed -> resolved, who and when). One open case per
--     conversation and kind. The old `reason` and `status` stay filled for older reads (a trigger keeps `status` in step).
--   * conversations.bot_paused_until: only a staff claim or a staff reply sets it. The turn code skips the model only while it is
--     in the future. conversations.human_handoff is no longer read by the turn code; every existing lock is cleared here.
--   * settings.support: the minutes of the alert ladder and the automatic credit's limits. Data, never code (invariant 13).
--   * open_case, claim_case, staff_replied, release_pause, resolve_case, request_callback, case_remind: the only writers.
--   * open_turn (0100) also returns whether the bot is paused and the conversation's open cases (one round trip, as before).
--   * release_handoff (0045, the console's "hand back") now releases the pause; nothing locks a chat any more.
-- A case at open hours raises an ops exception at once (the staff line within a minute, a push: high priority, 0136). Outside
-- open hours the case is recorded and nothing runs until opening (0136, case_timers_due).

-- ---------- data ----------
alter table handoffs add column if not exists kind text not null default 'other';
alter table handoffs add column if not exists topic text;
alter table handoffs add column if not exists order_id uuid references orders(id);
alter table handoffs add column if not exists source text not null default 'code';
alter table handoffs add column if not exists state text not null default 'open';
alter table handoffs add column if not exists claimed_by uuid references parties(id);
alter table handoffs add column if not exists claimed_at timestamptz;
alter table handoffs add column if not exists first_staff_reply_at timestamptz;
alter table handoffs add column if not exists last_staff_reply_at timestamptz;
alter table handoffs add column if not exists callback_requested boolean not null default false;
alter table handoffs add column if not exists after_hours boolean not null default false;
alter table handoffs add column if not exists late boolean not null default false;
alter table handoffs add column if not exists resolved_by uuid references parties(id);
alter table handoffs add column if not exists outcome text;
alter table handoffs add column if not exists complaint_case_id uuid references complaint_cases(id);
-- The alert ladder's working fields (0136): where the timer counts from, the last step raised (-1: none yet, after hours),
-- how many times a claim went quiet and the case came back, the round "still on it" was sent in, the last topic reminder,
-- and how long the claim or the last staff reply keeps the bot back.
alter table handoffs add column if not exists ladder_from timestamptz;
alter table handoffs add column if not exists alert_step smallint not null default -1;
alter table handoffs add column if not exists rounds int not null default 0;
alter table handoffs add column if not exists still_on_it_round int;
alter table handoffs add column if not exists topic_reminded_at timestamptz;
alter table handoffs add column if not exists pause_until timestamptz;

alter table conversations add column if not exists bot_paused_until timestamptz;

-- Every existing lock is cleared: the bot answers every chat again.
update conversations set human_handoff = false where human_handoff;

-- Older rows become cases. Open ones stay open (a person still owes an answer), flagged late and with the ladder already run, so
-- they show in the Inbox without waking anyone. Two open rows of one chat: the newest stays, the others are merged into it.
update handoffs set state = case when status = 'resolved' then 'resolved' else 'open' end,
                    ladder_from = coalesce(ladder_from, created_at),
                    alert_step = case when status = 'resolved' then alert_step else 2 end,
                    late = case when status = 'resolved' then late else true end,
                    outcome = case when status = 'resolved' then coalesce(outcome, 'resolved before 0135') else outcome end;
update handoffs h set state = 'resolved', status = 'resolved', resolved_at = coalesce(h.resolved_at, now()), outcome = 'merged by 0135'
 where h.state <> 'resolved'
   and exists (select 1 from handoffs n where n.conversation_id = h.conversation_id and n.kind = h.kind and n.state <> 'resolved'
                and (n.created_at, n.id) > (h.created_at, h.id));

do $$ begin
  alter table handoffs add constraint handoffs_kind_check check (kind in ('person_requested', 'order_problem', 'complaint', 'refund', 'payment', 'safety', 'other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table handoffs add constraint handoffs_state_check check (state in ('open', 'claimed', 'resolved'));
exception when duplicate_object then null; end $$;
create unique index if not exists handoffs_one_open_per_kind on handoffs(conversation_id, kind) where state <> 'resolved';
create index if not exists handoffs_open_ladder on handoffs(state, ladder_from) where state <> 'resolved';

-- The old columns follow the new ones, for every older reader (status, resolved_at, assigned_to). An older writer that only sets
-- status = 'resolved' (probe_due, 0077) resolves the case too.
create or replace function handoffs_sync() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.status = 'resolved' and old.status is distinct from 'resolved' and new.state <> 'resolved' then
    new.state := 'resolved';
  end if;
  new.status := case when new.state = 'resolved' then 'resolved' else 'open' end;
  if new.state = 'resolved' then new.resolved_at := coalesce(new.resolved_at, now()); new.pause_until := null; end if;
  if new.claimed_by is not null then new.assigned_to := coalesce(new.assigned_to, new.claimed_by); end if;
  if new.ladder_from is null then new.ladder_from := coalesce(new.created_at, now()); end if;
  return new;
end $$;
drop trigger if exists handoffs_sync on handoffs;
create trigger handoffs_sync before insert or update on handoffs for each row execute function handoffs_sync();

insert into settings(key, value) values ('support', jsonb_build_object(
  'claim_alert_min', 3, 'founder_alert_min', 5, 'late_min', 15, 'pause_min', 10, 'topic_reminder_min', 10, 'unanswered_min', 2,
  'auto_credit', jsonb_build_object('max_usd', 5, 'per_customer_month_usd', 10, 'per_customer_month_count', 2)))
on conflict (key) do nothing;

create or replace function support_min(p_key text, p_default int) returns int language sql stable set search_path = public, pg_temp as
$$ select coalesce((setting('support')->>p_key)::int, p_default) $$;

-- Open hours from settings.hours, as quote_order reads them: open <= local time < close.
create or replace function support_open_now() returns boolean language sql stable set search_path = public, pg_temp as $$
  with h as (select setting('hours') as v)
  select not ((now() at time zone coalesce(v->>'tz', 'Asia/Beirut'))::time < (v->>'open')::time
           or (now() at time zone coalesce(v->>'tz', 'Asia/Beirut'))::time >= (v->>'close')::time) from h $$;

-- The next opening, as a moment: today's opening time if it is still ahead, else tomorrow's.
create or replace function support_next_open() returns timestamptz language sql stable set search_path = public, pg_temp as $$
  with h as (select setting('hours') as v),
       t as (select ((date_trunc('day', now() at time zone coalesce(v->>'tz', 'Asia/Beirut')) + (v->>'open')::time)
                     at time zone coalesce(v->>'tz', 'Asia/Beirut')) as today from h)
  select case when today > now() then today else today + interval '1 day' end from t $$;

create or replace view support_cases as
select h.id, h.conversation_id, c.party_id, h.kind, h.topic, h.order_id, o.short_code as order_code, h.source, h.state,
       h.reason, h.claimed_by, h.claimed_at, h.first_staff_reply_at, h.last_staff_reply_at, h.callback_requested, h.after_hours,
       h.late, h.resolved_by, h.resolved_at, h.outcome, h.complaint_case_id, h.ladder_from, h.alert_step, h.rounds, h.pause_until,
       h.created_at
  from handoffs h join conversations c on c.id = h.conversation_id left join orders o on o.id = h.order_id;

-- Ops exceptions of one case (support_case, support_case_unclaimed, support_case_founder) are closed together.
create or replace function close_case_exceptions(p_case uuid, p_by uuid default null) returns void language sql set search_path = public, pg_temp as $$
  update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
   where ref = p_case::text and kind like 'support_case%' and status <> 'resolved' $$;

-- What the turn code and the console need to word a line: the language, the opening time.
create or replace function case_json(h handoffs) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('case_id', h.id, 'kind', h.kind, 'topic', h.topic, 'state', h.state, 'order_id', h.order_id,
    'conversation_id', h.conversation_id, 'after_hours', not support_open_now(),
    'opens', setting('hours')->>'open', 'callback_requested', h.callback_requested) $$;

-- ---------- functions ----------
-- One open case per conversation and kind. Opening it again returns the open one (opened false). At open hours the case raises
-- its ops exception now (step 0 of the ladder); outside them, the ladder starts at the next opening.
create or replace function open_case(p_conversation uuid, p_kind text, p_topic text default null, p_order uuid default null, p_source text default 'code')
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c conversations%rowtype; h handoffs%rowtype; v_open boolean := support_open_now(); v_topic text := nullif(left(btrim(coalesce(p_topic, '')), 300), '');
begin
  if p_kind is null or p_kind not in ('person_requested', 'order_problem', 'complaint', 'refund', 'payment', 'safety', 'other') then
    raise exception 'CASE_KIND_UNKNOWN %', p_kind;
  end if;
  select * into c from conversations where id = p_conversation and line = 'customer' for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  select * into h from handoffs where conversation_id = p_conversation and kind = p_kind and state <> 'resolved';
  if found then
    update handoffs set topic = coalesce(topic, v_topic), order_id = coalesce(order_id, p_order) where id = h.id returning * into h;
    return case_json(h) || jsonb_build_object('opened', false);
  end if;
  insert into handoffs(conversation_id, reason, kind, topic, order_id, source, state, after_hours, ladder_from, alert_step)
    values (p_conversation, p_kind || coalesce(': ' || v_topic, ''), p_kind, v_topic, p_order, coalesce(p_source, 'code'), 'open',
            not v_open, case when v_open then now() else support_next_open() end, case when v_open then 0 else -1 end)
    returning * into h;
  if v_open then
    perform raise_ops_exception('support_case', h.id::text, jsonb_build_object('case_id', h.id, 'conversation_id', p_conversation,
      'kind', p_kind, 'topic', v_topic, 'order', (select short_code from orders where id = p_order)));
  end if;
  return case_json(h) || jsonb_build_object('opened', true);
end $$;

-- The customer's message is about the open case: true when the short "your request is open" is due (never within
-- settings.support.topic_reminder_min of the last one). Marks it sent in the same statement.
create or replace function case_remind(p_case uuid) returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  update handoffs set topic_reminded_at = now()
   where id = p_case and state <> 'resolved'
     and (topic_reminded_at is null or topic_reminded_at < now() - make_interval(mins => support_min('topic_reminder_min', 10)));
  return found;
end $$;

-- The customer tapped "call me back". Only on their own case.
create or replace function request_callback(p_case uuid, p_party uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h handoffs%rowtype;
begin
  select h0.* into h from handoffs h0 join conversations c on c.id = h0.conversation_id
   where h0.id = p_case and (p_party is null or c.party_id = p_party) for update of h0;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if h.state = 'resolved' then return case_json(h) || jsonb_build_object('ok', false, 'already', false); end if;
  update handoffs set callback_requested = true where id = p_case;
  return case_json(h) || jsonb_build_object('ok', true, 'already', h.callback_requested);
end $$;

-- Pause the bot on a conversation until p_until (never shortens a later pause another case holds).
create or replace function case_pause(p_case uuid, p_until timestamptz) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_conv uuid;
begin
  update handoffs set pause_until = p_until where id = p_case returning conversation_id into v_conv;
  update conversations set bot_paused_until = (select max(pause_until) from handoffs where conversation_id = v_conv and state = 'claimed'),
                           updated_at = now()
   where id = v_conv;
end $$;

create or replace function claim_case(p_case uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h handoffs%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into h from handoffs where id = p_case for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if h.state = 'resolved' then return jsonb_build_object('ok', false, 'why', 'resolved'); end if;
  if h.state = 'claimed' and h.claimed_by <> p_by and h.pause_until > now() then
    return jsonb_build_object('ok', false, 'why', 'taken', 'by', (select display_name from parties where id = h.claimed_by));
  end if;
  update handoffs set state = 'claimed', claimed_by = p_by, claimed_at = coalesce(claimed_at, now()) where id = p_case;
  perform case_pause(p_case, now() + make_interval(mins => support_min('pause_min', 10)));
  perform close_case_exceptions(p_case, p_by);
  return jsonb_build_object('ok', true, 'paused_until', (select pause_until from handoffs where id = p_case));
end $$;

-- A person replied on the case (the console sends through the gateway, then calls this). Claims it if nobody had; renews the pause.
create or replace function staff_replied(p_case uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h handoffs%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into h from handoffs where id = p_case for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if h.state = 'resolved' then return jsonb_build_object('ok', false, 'why', 'resolved'); end if;
  update handoffs set state = 'claimed', claimed_by = coalesce(case when state = 'claimed' then claimed_by end, p_by),
                      claimed_at = coalesce(claimed_at, now()), first_staff_reply_at = coalesce(first_staff_reply_at, now()),
                      last_staff_reply_at = now()
   where id = p_case;
  perform case_pause(p_case, now() + make_interval(mins => support_min('pause_min', 10)));
  perform close_case_exceptions(p_case, p_by);
  return jsonb_build_object('ok', true, 'paused_until', (select pause_until from handoffs where id = p_case));
end $$;

-- The person gives the chat back to the bot now; the case stays theirs.
create or replace function release_pause(p_case uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h handoffs%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into h from handoffs where id = p_case for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  perform case_pause(p_case, null);
  return jsonb_build_object('ok', true, 'already', h.pause_until is null);
end $$;

create or replace function resolve_case(p_case uuid, p_by uuid, p_outcome text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h handoffs%rowtype; v_party uuid;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if length(btrim(coalesce(p_outcome, ''))) < 3 then raise exception 'OUTCOME_REQUIRED'; end if;
  select * into h from handoffs where id = p_case for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  select party_id into v_party from conversations where id = h.conversation_id;
  if h.state = 'resolved' then return jsonb_build_object('ok', true, 'already', true, 'party_id', v_party); end if;
  update handoffs set state = 'resolved', resolved_by = p_by, resolved_at = now(), outcome = left(btrim(p_outcome), 500) where id = p_case;
  perform case_pause(p_case, null);
  perform close_case_exceptions(p_case, p_by);
  return jsonb_build_object('ok', true, 'already', false, 'party_id', v_party, 'conversation_id', h.conversation_id,
                            'lang', customer_language(v_party));
end $$;

-- 0045's "hand back to the Concierge": no chat is locked any more, so it releases every pause on the conversation.
create or replace function release_handoff(p_conversation uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare c conversations%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into c from conversations where id = p_conversation and line = 'customer' for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if not c.human_handoff and (c.bot_paused_until is null or c.bot_paused_until <= now()) then return jsonb_build_object('ok', true, 'already', true); end if;
  update handoffs set pause_until = null where conversation_id = p_conversation and state <> 'resolved';
  update conversations set human_handoff = false, bot_paused_until = null, updated_at = now() where id = p_conversation;
  insert into config_changes(kind, ref, before, after, changed_by)
    values ('handoff', p_conversation, jsonb_build_object('bot_paused_until', c.bot_paused_until), '{"bot_paused_until": null}', p_by);
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- open_turn (0100) plus two reads for the turn: whether a person has the bot paused, and the conversation's open cases.
create or replace function open_turn(p_key text, p_line wa_line, p_wa_user_id text, p_phone text, p_name text, p_messages jsonb)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare v_turn text; v_conv jsonb; v_party uuid; v_head jsonb := p_messages->0; v_cid uuid;
begin
  v_turn := begin_turn(p_key, p_line, null);
  if v_turn in ('done', 'give_up') then return jsonb_build_object('turn', v_turn); end if;

  v_conv := touch_conversation(p_line, p_wa_user_id, p_phone, p_name);
  if not coalesce((v_conv->>'known')::boolean, false) or coalesce((v_conv->>'blocked')::boolean, false) then
    return v_conv || jsonb_build_object('turn', v_turn);
  end if;
  v_party := (v_conv->>'party_id')::uuid;
  v_cid := (v_conv->>'conversation_id')::uuid;

  if v_head is not null then
    begin
      perform record_first_contact(v_party, v_head->>'wa_message_id', v_head->>'body_text', nullif(v_head->'referral', 'null'::jsonb));
    exception when others then null;
    end;
  end if;

  begin
    insert into wa_messages(line, direction, party_id, conversation_id, wa_message_id, type, status, body, transcript)
    select p_line, 'inbound', v_party, v_cid, m->>'wa_message_id', m->>'type', 'received',
           m->>'body', nullif(m->'transcript', 'null'::jsonb)
      from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) m
    on conflict (wa_message_id) do nothing;
  exception when others then null;
  end;

  return v_conv || jsonb_build_object('turn', v_turn, 'budget', model_turn_budget(v_party), 'customer_context', customer_context(v_party),
    'bot_paused', coalesce((select bot_paused_until > now() from conversations where id = v_cid), false),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('case_id', h.id, 'kind', h.kind, 'topic', h.topic, 'state', h.state) order by h.created_at)
                         from handoffs h where h.conversation_id = v_cid and h.state <> 'resolved'), '[]'::jsonb));
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on support_cases from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on support_cases from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select on support_cases to service_role; end if;
end $$;
