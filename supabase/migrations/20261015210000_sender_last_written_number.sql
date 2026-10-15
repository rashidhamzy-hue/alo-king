-- Session 5d live check (DECISIONS §39.8): an outbox message to a person whose window is open on two of our numbers goes
-- from the number they wrote to last. Before, the tie went to the sandbox by rank, so an operator alert to Rasheed went
-- out on the sandbox after his Kapso sandbox session had ended (Kapso 403 "Active sandbox session required") while he was
-- talking to the US test number.
create or replace function public.whatsapp_sender_for(p_audience text, p_target text) returns text
language sql stable security definer set search_path = ''
as $$
  select w.phone_number_id from public.whatsapp_numbers w
  left join app_private.whatsapp_windows x
    on x.phone_e164 = p_target and x.phone_number_id = w.phone_number_id
   and x.last_inbound_at > now() - interval '23 hours 50 minutes'
  where w.active and w.role = any (case when p_audience = 'merchant' then array['merchant', 'test', 'sandbox']
                                        else array['customer', 'test', 'sandbox'] end::public.whatsapp_number_role[])
  order by x.last_inbound_at desc nulls last,
           app_private.whatsapp_sender_rank(w.role, w.waba_id), w.created_at
  limit 1;
$$;
