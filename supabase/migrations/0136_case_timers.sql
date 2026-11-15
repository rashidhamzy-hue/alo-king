-- Alo King Chouf, session HO1 (the never-stranded hand-off), section D. The alert ladder, the unanswered-message alarm, the
-- Inbox's read, the measures, and the day-open list.
--
-- case_timers_due() (the gateway's minute cron), during open hours only (outside them no timer runs):
--   after hours, at opening    the case's ladder starts: ops exception support_case (the staff line, a push)
--   claim_alert_min unclaimed  support_case_unclaimed: a second push, for the ops lead
--   founder_alert_min          support_case_founder: a push for the founder and the deputy; the customer is told "we are still
--                              on it" (Keep ordering, Call me back, Leave a voice note), once per round
--   late_min                   the case is marked late (the daily summary shows it)
--   a claim gone quiet         the pause ran out with no staff reply: the bot resumes and says the request is still open, and the
--                              case goes back to the start of the ladder (a new round)
--   Each step closes the one before it, so one case has one open exception; a claim or a reply closes it (0135).
-- customer_unanswered(min): customer messages with no reply of any kind for that long, during open hours, that we could have
--   answered (can_send). The cron raises one high-priority exception each (customer_unanswered). Target: zero.
-- cases_inbox(staff), case_context(case, staff): the Inbox's list and one case, read only. case_metrics is in 0137.
-- settings.push_alerts gains the new high-priority kinds. 0158 inserts the same key on conflict do nothing, so on a fresh
-- database (where 0136 runs first) this row, with 0158's kinds in it, is the one kept.

insert into settings(key, value) values ('push_alerts', jsonb_build_object(
  'high_priority_kinds', jsonb_build_array('allergen_complaint', 'rider_off', 'pick_empty', 'delivery_problem', 'payment_proof',
                                           'scheduled_stock_short', 'turn_failed', 'support_case', 'support_case_unclaimed',
                                           'support_case_founder', 'customer_unanswered', 'technical'),
  'max_age_minutes', 120))
on conflict (key) do update set value = jsonb_set(settings.value, '{high_priority_kinds}',
  (select jsonb_agg(distinct k) from (
     select jsonb_array_elements_text(coalesce(settings.value->'high_priority_kinds', '[]'::jsonb)) as k
     union select unnest(array['support_case', 'support_case_unclaimed', 'support_case_founder', 'customer_unanswered', 'technical'])) x));

create or replace function case_raise(h handoffs, p_kind text) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update ops_exceptions set status = 'resolved', resolved_at = now()
   where ref = h.id::text and kind like 'support_case%' and kind <> p_kind and status <> 'resolved';
  perform raise_ops_exception(p_kind, h.id::text, jsonb_build_object('case_id', h.id, 'conversation_id', h.conversation_id,
    'kind', h.kind, 'topic', h.topic, 'order', (select short_code from orders where id = h.order_id), 'round', h.rounds));
end $$;

create or replace function case_timers_due() returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare h handoffs%rowtype; v_out jsonb := '[]'::jsonb; v_party uuid; v_claim int := support_min('claim_alert_min', 3);
        v_founder int := support_min('founder_alert_min', 5); v_late int := support_min('late_min', 15);
begin
  if not support_open_now() then return v_out; end if;

  -- A claim that went quiet: the pause ran out with no staff reply. Back to the ladder, a new round; the customer is told.
  for h in select * from handoffs where state = 'claimed' and pause_until is not null and pause_until <= now() for update skip locked loop
    update handoffs set state = 'open', pause_until = null, ladder_from = now(), alert_step = 0, rounds = rounds + 1, late = late
     where id = h.id returning * into h;
    perform case_pause(h.id, null);
    perform case_raise(h, 'support_case');
    select party_id into v_party from conversations where id = h.conversation_id;
    v_out := v_out || jsonb_build_object('action', 'resumed', 'case_id', h.id, 'kind', h.kind, 'round', h.rounds,
                                         'party_id', v_party, 'lang', customer_language(v_party));
  end loop;

  -- Opened after hours: the ladder starts at opening.
  for h in select * from handoffs where state = 'open' and alert_step < 0 and ladder_from <= now() for update skip locked loop
    update handoffs set alert_step = 0, ladder_from = now() where id = h.id returning * into h;
    perform case_raise(h, 'support_case');
  end loop;

  for h in select * from handoffs where state = 'open' and alert_step between 0 and 1 and ladder_from <= now() - make_interval(mins => v_claim)
           for update skip locked loop
    if h.alert_step = 0 then
      update handoffs set alert_step = 1 where id = h.id returning * into h;
      perform case_raise(h, 'support_case_unclaimed');
    end if;
    if h.ladder_from <= now() - make_interval(mins => v_founder) then
      update handoffs set alert_step = 2, still_on_it_round = rounds where id = h.id returning * into h;
      perform case_raise(h, 'support_case_founder');
      select party_id into v_party from conversations where id = h.conversation_id;
      v_out := v_out || jsonb_build_object('action', 'still_on_it', 'case_id', h.id, 'kind', h.kind, 'round', h.rounds,
                                           'party_id', v_party, 'lang', customer_language(v_party));
    end if;
  end loop;

  update handoffs set late = true
   where state = 'open' and not late and alert_step >= 0 and ladder_from <= now() - make_interval(mins => v_late);
  return v_out;
end $$;

-- Customer messages nobody answered: no outbound message of any kind on the customer line after it, for p_minutes or more,
-- sent during today's open hours, to a customer we may write to. Reactions and stickers need no answer. Each message once.
create or replace function customer_unanswered(p_minutes int default null) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('wa_message_id', x.wa_message_id, 'party_id', x.party_id, 'conversation_id', x.conversation_id,
                                               'type', x.type, 'received_at', x.created_at, 'minutes', x.minutes) order by x.created_at), '[]'::jsonb)
  from (
  with o as (select now() - make_interval(mins => coalesce(p_minutes, support_min('unanswered_min', 2))) as cutoff,
                    support_next_open() - interval '1 day' as opened)
  select m.wa_message_id, m.party_id, m.conversation_id, m.type, m.created_at, (extract(epoch from now() - m.created_at) / 60)::int as minutes
    from wa_messages m, o
   where support_open_now() and m.line = 'customer' and m.direction = 'inbound' and m.wa_message_id is not null
     and m.created_at <= o.cutoff and m.created_at >= greatest(o.opened, now() - interval '2 hours')
     and m.type not in ('reaction', 'sticker', 'unsupported', 'system')
     and not exists (select 1 from wa_messages r where r.line = 'customer' and r.direction = 'outbound' and r.party_id = m.party_id
                       and r.created_at >= m.created_at)
     and not exists (select 1 from ops_exceptions e where e.kind = 'customer_unanswered' and e.ref = m.wa_message_id)
     and can_send(m.party_id, 'customer', 'service', false) in ('ok', 'probe_sink')) x $$;

-- The Inbox (console): open and claimed cases, the oldest timer first, with what a row shows. Read only.
create or replace function cases_inbox(p_staff uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform require_role(p_staff, array['ops_lead', 'admin']);
  return coalesce((select jsonb_agg(x order by (x->>'state') = 'claimed', x->>'ladder_from') from (
    select jsonb_build_object('case_id', h.id, 'kind', h.kind, 'topic', h.topic, 'state', h.state, 'order_code', o.short_code,
      'conversation_id', h.conversation_id, 'customer', coalesce(p.display_name, 'Customer'),
      'ladder_from', h.ladder_from, 'opened_at', h.created_at, 'minutes', greatest(0, (extract(epoch from now() - h.ladder_from) / 60)::int),
      'late', h.late, 'after_hours', h.after_hours, 'callback_requested', h.callback_requested, 'rounds', h.rounds,
      'claimed_by', (select display_name from parties where id = h.claimed_by), 'pause_until', h.pause_until,
      'last_message', (select jsonb_build_object('direction', m.direction, 'type', m.type, 'body', left(m.body, 200), 'at', m.created_at)
                         from wa_messages m where m.party_id = c.party_id and m.line = 'customer' order by m.created_at desc limit 1)) as x
      from handoffs h join conversations c on c.id = h.conversation_id join parties p on p.id = c.party_id
      left join orders o on o.id = h.order_id
     where h.state <> 'resolved') s), '[]'::jsonb);
end $$;

-- One case for the Inbox: the case, its chat (last 30 messages), its order or the customer's latest, and the language. Read only:
-- the drafted reply is built from this by code (apps/console/src/pages/inbox.ts), never by a model, and never sent by itself.
create or replace function case_context(p_case uuid, p_staff uuid) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare h handoffs%rowtype; c conversations%rowtype; v_order uuid;
begin
  perform require_role(p_staff, array['ops_lead', 'admin']);
  select * into h from handoffs where id = p_case;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  select * into c from conversations where id = h.conversation_id;
  v_order := coalesce(h.order_id, (select id from orders where customer_id = c.party_id order by created_at desc limit 1));
  return case_json(h) || jsonb_build_object('party_id', c.party_id, 'customer', (select display_name from parties where id = c.party_id),
    'lang', customer_language(c.party_id), 'late', h.late, 'rounds', h.rounds, 'claimed_by', (select display_name from parties where id = h.claimed_by),
    'pause_until', h.pause_until, 'outcome', h.outcome, 'opened_at', h.created_at, 'ladder_from', h.ladder_from,
    'window_open', c.last_inbound_at > now() - interval '24 hours',
    'order', (select jsonb_build_object('id', o.id, 'short_code', o.short_code, 'status', o.status, 'total_usd', o.total_usd,
                     'payment_method', o.payment_method, 'created_at', o.created_at) from orders o where o.id = v_order),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'type', m.type, 'body', left(m.body, 1000), 'at', m.created_at) order by m.created_at)
                            from (select * from wa_messages m where m.party_id = c.party_id and m.line = 'customer' order by m.created_at desc limit 30) m), '[]'::jsonb));
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
