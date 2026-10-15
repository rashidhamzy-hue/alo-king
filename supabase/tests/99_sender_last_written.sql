-- Session 5d live check (DECISIONS §39.8): with the window open on two of our numbers, an outbox message goes from the one
-- the person wrote to last.
begin;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
\set sandbox '''597907523413541'''

reset role;
insert into public.whatsapp_numbers (phone_number_id, role, waba_id, active) values ('15550002222', 'test', '900000000002', true)
  on conflict do nothing;
insert into app_private.whatsapp_windows (phone_e164, phone_number_id, last_inbound_at) values
  ('+96170000071', :sandbox, now() - interval '3 hours'), ('+96170000071', '15550002222', now() - interval '5 minutes'),
  ('+96170000072', :sandbox, now() - interval '5 minutes'), ('+96170000072', '15550002222', now() - interval '3 hours'),
  ('+96170000073', '15550002222', now() - interval '23 hours 55 minutes');
set local role service_role;

select tests.ok(public.whatsapp_sender_for('merchant', '+96170000071') = '15550002222'
  and public.whatsapp_sender_for('customer', '+96170000071') = '15550002222',
  'wrote to the sandbox, then the test number: sent from the test number, for both sides');
select tests.ok(public.whatsapp_sender_for('merchant', '+96170000072') = :sandbox,
  'wrote to the test number, then the sandbox: sent from the sandbox');
select tests.ok(public.whatsapp_sender_for('customer', '+96170000073') = public.whatsapp_sender('customer'),
  'a window that has closed counts for nothing: the default sender');
select tests.ok(public.whatsapp_sender_for('customer', '+96170000074') = public.whatsapp_sender('customer'),
  'someone who never wrote: the default sender');

rollback;
