-- Alo King Chouf: build plan 1.8 (session B3). A per-customer cap on model turns an hour, then a person.
-- A customer (or a script on a customer's number) who keeps the model busy costs money and can hide a problem a person
-- should see. Past the cap, the turn goes to a person: the conversation is handed off, an ops exception is raised once per
-- hour, ops are alerted, and the customer is told someone will answer. Answers that need no model (buttons, pins, quick
-- intents, memory commands, the card a pin was waiting for) are never capped.
-- The cap is a setting, not code. Counting reads agent_runs: a turn that called the model has input tokens.

insert into settings(key, value) values ('model_turns', '{"per_customer_per_hour": 20}') on conflict (key) do nothing;

create index if not exists agent_runs_conversation_time on agent_runs (conversation_id, created_at);

create or replace function model_turn_budget(p_party uuid) returns jsonb language sql stable as $$
  with lim as (select coalesce((setting('model_turns')->>'per_customer_per_hour')::int, 20) as n),
  used as (
    select count(*)::int as n from agent_runs r join conversations c on c.id = r.conversation_id
     where c.party_id = p_party and r.agent = 'concierge' and r.input_tokens > 0 and r.created_at > now() - interval '1 hour')
  select jsonb_build_object('allowed', used.n < lim.n, 'used', used.n, 'limit', lim.n) from lim, used
$$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
