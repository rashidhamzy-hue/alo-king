-- CX1 (customer pack), part 1. docs/strategy/02-journeys.md section 1, 03 section B.
--
-- (a) The first-ever welcome. One welcome on a customer's first message ever: what we do, the hours, three buttons and one privacy
--     line. The privacy line carries the customer's consent to us keeping their messages and orders to serve them; the exact words
--     shown, their language and the message they answered are kept here, once per customer. It is not a marketing opt-in (0012's
--     lock stands) and not the transactional opt-in, which stays the customer's own Confirm tap on a card (0003).
-- (b) At most four customer messages per order (settings.message_budget.customer_per_order, 0001). Every message code starts about
--     an order (a notice, a question from the shelf, the feedback card) claims a place here first. A message the customer must
--     act on or must know (a substitute question, a cancellation, a delay, what changed at the shelf, the rider at the door, the
--     order ready for pickup, a payment received) always goes; anything else goes only while the order is under the budget.
--     A refused claim is kept with its reason, so nothing is dropped in silence.

-- ---------- (a) the welcome ----------
create table if not exists customer_welcomes (
  party_id        uuid primary key references parties(id),
  wa_message_id   text,
  lang            text not null,
  privacy_wording text not null,
  sent_at         timestamptz not null default now()
);

insert into settings(key, value) values ('welcome', '{"enabled": true}') on conflict (key) do nothing;

-- True once per customer, and only on their first message ever: no inbound message of theirs other than this turn's, and no order.
-- A customer who wrote before CX1 shipped never gets a welcome. The caller sends the welcome only when this returns true; the
-- outbox key of the send makes a retried turn send it once.
create or replace function claim_welcome(p_party uuid, p_turn_ids text[], p_lang text, p_privacy text) returns boolean language plpgsql as $$
begin
  if p_party is null or not coalesce((setting('welcome')->>'enabled')::boolean, false) then return false; end if;
  if exists (select 1 from customer_welcomes where party_id = p_party) then
    -- The same turn asking again (a retried turn) gets the same answer.
    return exists (select 1 from customer_welcomes where party_id = p_party and wa_message_id = any(p_turn_ids));
  end if;
  if exists (select 1 from parties where id = p_party and role <> 'customer') then return false; end if;
  if exists (select 1 from wa_messages where party_id = p_party and line = 'customer' and direction = 'inbound'
               and not (wa_message_id = any(coalesce(p_turn_ids, '{}')))) then return false; end if;
  if exists (select 1 from orders where customer_id = p_party) then return false; end if;
  insert into customer_welcomes(party_id, wa_message_id, lang, privacy_wording)
    values (p_party, p_turn_ids[1], coalesce(nullif(p_lang, ''), 'ar'), p_privacy)
    on conflict (party_id) do nothing;
  return found;
end $$;

-- Whether the welcome is due, without claiming it: open_turn returns it, so a turn asks claim_welcome only on a first message and
-- the typed order still reaches the model after one database call (SP1).
create or replace function welcome_due(p_party uuid, p_turn_ids text[]) returns boolean language sql stable as $$
  select coalesce((setting('welcome')->>'enabled')::boolean, false)
     and exists (select 1 from parties where id = p_party and role = 'customer')
     and not exists (select 1 from customer_welcomes where party_id = p_party and not (wa_message_id = any(coalesce(p_turn_ids, '{}'))))
     and not exists (select 1 from wa_messages where party_id = p_party and line = 'customer' and direction = 'inbound'
                       and not (wa_message_id = any(coalesce(p_turn_ids, '{}'))))
     and not exists (select 1 from orders where customer_id = p_party) $$;

-- Copied from 0135, with welcome_due added to what it returns.
create or replace function open_turn(p_key text, p_line wa_line, p_wa_user_id text, p_phone text, p_name text, p_messages jsonb)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare v_turn text; v_conv jsonb; v_party uuid; v_head jsonb := p_messages->0; v_cid uuid; v_ids text[];
begin
  v_turn := begin_turn(p_key, p_line, null);
  if v_turn in ('done', 'give_up') then return jsonb_build_object('turn', v_turn); end if;

  v_conv := touch_conversation(p_line, p_wa_user_id, p_phone, p_name);
  if not coalesce((v_conv->>'known')::boolean, false) or coalesce((v_conv->>'blocked')::boolean, false) then
    return v_conv || jsonb_build_object('turn', v_turn);
  end if;
  v_party := (v_conv->>'party_id')::uuid;
  v_cid := (v_conv->>'conversation_id')::uuid;
  select coalesce(array_agg(m->>'wa_message_id'), '{}') into v_ids from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) m;

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
                         from handoffs h where h.conversation_id = v_cid and h.state <> 'resolved'), '[]'::jsonb),
    'welcome_due', p_line = 'customer' and welcome_due(v_party, v_ids));
end $$;

-- ---------- (b) the message budget per order ----------
create table if not exists order_message_claims (
  key        text primary key,
  order_id   uuid not null references orders(id),
  kind       text not null,
  essential  boolean not null,
  allowed    boolean not null,
  reason     text,
  at         timestamptz not null default now()
);
create index if not exists order_message_claims_order on order_message_claims(order_id);

update settings set value = value || '{"essential": ["substitute_question", "order_cancelled", "order_delayed", "delivery_called_off",
  "shelf_changes", "rider_at_door", "pickup_ready", "payment_received"]}'::jsonb where key = 'message_budget';

-- One place for one message about one order. Idempotent on the key: a retried send gets the decision it got the first time.
create or replace function claim_order_message(p_order uuid, p_kind text, p_key text) returns jsonb language plpgsql as $$
declare c order_message_claims%rowtype; b jsonb := coalesce(setting('message_budget'), '{}'::jsonb); v_cap int; v_used int; v_ess boolean;
begin
  select * into c from order_message_claims where key = p_key;
  if found then return jsonb_build_object('allowed', c.allowed, 'reason', c.reason, 'again', true); end if;
  perform 1 from orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND %', p_order; end if;
  v_cap := coalesce((b->>'customer_per_order')::int, 4);
  v_ess := coalesce(b->'essential', '[]'::jsonb) ? p_kind;
  select count(*) into v_used from order_message_claims where order_id = p_order and allowed;
  insert into order_message_claims(key, order_id, kind, essential, allowed, reason)
    values (p_key, p_order, p_kind, v_ess, v_ess or v_used < v_cap, case when not v_ess and v_used >= v_cap then 'over_budget' end)
    returning * into c;
  return jsonb_build_object('allowed', c.allowed, 'reason', c.reason, 'used', v_used + case when c.allowed then 1 else 0 end, 'cap', v_cap);
end $$;

-- How many messages code started about each order, for the console and the daily report.
create or replace function order_message_count(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('sent', count(*) filter (where allowed), 'skipped', count(*) filter (where not allowed),
                            'cap', coalesce((setting('message_budget')->>'customer_per_order')::int, 4))
    from order_message_claims where order_id = p_order $$;

do $$ declare r text; t text;
begin
  foreach t in array array['customer_welcomes', 'order_message_claims'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
