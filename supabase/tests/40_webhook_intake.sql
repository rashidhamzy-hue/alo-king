-- Webhook intake: dedupe, persist, enqueue; claim and finish; access.
begin;

select tests.ok(
  (select count(*) from public.webhook_intake('kapso', '[
    {"event_key": "whatsapp.message.received:wamid.1", "event_type": "whatsapp.message.received", "phone_number_id": "111", "payload": {"message": {"id": "wamid.1"}}},
    {"event_key": "whatsapp.message.delivered:wamid.2", "event_type": "whatsapp.message.delivered", "phone_number_id": "111", "payload": {"message": {"id": "wamid.2"}}}
  ]') where not duplicate) = 2,
  'two new events are accepted');
select tests.ok(
  (select bool_and(duplicate) from public.webhook_intake('kapso', '[
    {"event_key": "whatsapp.message.received:wamid.1", "event_type": "whatsapp.message.received", "payload": {}}
  ]')),
  'a retried delivery is reported as a duplicate');
select tests.ok((select count(*) from public.webhook_events) = 2, 'a duplicate writes no new row');
select tests.ok(
  (select not duplicate from public.webhook_intake('meta', '[
    {"event_key": "whatsapp.message.received:wamid.1", "event_type": "messages", "payload": {}}
  ]')),
  'the same key from another provider is a separate event');
select tests.ok((select count(*) from pgmq.q_webhook_inbound) = 3, 'each new event is queued once');
select tests.throws($$select * from public.webhook_intake('kapso', '[]')$$, 'non-empty', 'an empty batch is rejected');
select tests.throws($$select * from public.webhook_intake('kapso', '[{"event_type": "x", "payload": {}}]')$$,
  'event_key', 'an event without a key is rejected');

-- Claim and finish.
create temporary table claimed as select * from public.webhook_claim(10, 30);
select tests.ok((select count(*) from claimed) = 3, 'a consumer claims the three queued events');
select tests.ok((select count(*) from public.webhook_claim(10, 30)) = 0, 'claimed events are hidden from other consumers');
select tests.ok((select bool_and(status = 'processing' and attempts = 1) from public.webhook_events), 'claimed events are processing');

select public.webhook_finish(msg_id, event_id, 'done') from claimed where event_type = 'whatsapp.message.received';
select public.webhook_finish(msg_id, event_id, 'failed', 'provider timeout') from claimed where event_type = 'whatsapp.message.delivered';
select public.webhook_finish(msg_id, event_id, 'ignored') from claimed where event_type = 'messages';
select tests.ok((select status from public.webhook_events where event_type = 'whatsapp.message.received') = 'done', 'done is recorded');
select tests.ok((select processed_at is not null from public.webhook_events where event_type = 'whatsapp.message.received'), 'done has a processed time');
select tests.ok((select last_error from public.webhook_events where event_type = 'whatsapp.message.delivered') = 'provider timeout',
  'failure reason is recorded');
select tests.ok((select count(*) from pgmq.q_webhook_inbound) = 1, 'done and ignored are archived; failed stays queued for retry');
select tests.ok((select count(*) from pgmq.a_webhook_inbound) = 2, 'archived messages are kept');
select tests.throws($$select public.webhook_finish(1, 1, 'processing')$$, 'done, failed or ignored', 'finish rejects other states');

-- Access.
set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000e');
select tests.throws($$select * from public.webhook_intake('kapso', '[{"event_key": "k", "event_type": "t", "payload": {}}]')$$,
  'permission denied', 'clients cannot inject webhook events');
select tests.throws($$select * from public.webhook_claim()$$, 'permission denied', 'clients cannot claim events');
select tests.ok(tests.count_of('select id from public.webhook_events') = 0, 'merchants cannot read webhook payloads');
reset role;

set local role anon;
select tests.act_as(null);
select tests.throws('select * from public.webhook_events', 'permission denied', 'anon cannot read webhook events');
select tests.throws('select * from pgmq.q_webhook_inbound', 'permission denied', 'anon cannot read the queue');
reset role;

set local role authenticated;
select tests.act_as('00000000-0000-0000-0000-00000000000b');
select tests.ok(tests.count_of('select id from public.webhook_events') = 3, 'operators read webhook events');
reset role;

rollback;
