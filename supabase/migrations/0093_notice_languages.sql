-- 0093 (session A4, audit 14 Nov item 8): the three utility templates in English and French, and notices in the customer's language.
--
-- Submitted to Meta through Kapso on 14 November 2026 (WABA 1086076707594153, customer line), category UTILITY,
-- allow_category_change false, each with its own name (wa_templates is keyed by name, and wa_messages points at it). Meta ids:
--   ak_order_cancelled_en_v1   1140802498307803        ak_order_cancelled_fr_v1   3028860460791723
--   ak_rider_at_door_en_v1     1666280571821443        ak_rider_at_door_fr_v1     1465972848934487
--   ak_payment_received_en_v1  3080758412302974        ak_payment_received_fr_v1  2393796074742173
-- Same variables and the same wording rules as 0062: transactional only, no offer, no praise (invariant 17).
--
-- customer_language(party): how the customer last wrote, from the Concierge's own reading (agent_runs.trace.intent.language,
--   recorded on every turn): 'en' or 'fr' when that reading said so; otherwise parties.language_pref when it is 'en' or 'fr';
--   otherwise 'ar' (Lebanese Arabic, Arabizi, mixed, or never read). Nothing is inferred from a name or a number.
-- customer_notices_due(): 0062's text, plus the language: the template of that language, and the words that fill it
--   (the reason, the payment summary) in that language too. Each notice now carries 'lang'.

insert into wa_templates(name, line, category, language, body, variables, status) values
  ('ak_order_cancelled_en_v1', 'customer', 'utility', 'en',
   'Your order {{1}} has been cancelled. Reason: {{2}}. If you still want it, reply to this message.', '["order_code","reason"]', 'submitted'),
  ('ak_rider_at_door_en_v1', 'customer', 'utility', 'en',
   'The rider has arrived at your address with order {{1}} and is waiting for you now.', '["order_code"]', 'submitted'),
  ('ak_payment_received_en_v1', 'customer', 'utility', 'en',
   'We received your payment for order {{1}}: {{2}}. This is your receipt.', '["order_code","paid_summary"]', 'submitted'),
  ('ak_order_cancelled_fr_v1', 'customer', 'utility', 'fr',
   'Votre commande {{1}} a été annulée. Motif : {{2}}. Si vous la voulez toujours, répondez à ce message.', '["order_code","reason"]', 'submitted'),
  ('ak_rider_at_door_fr_v1', 'customer', 'utility', 'fr',
   'Le livreur est arrivé à votre adresse avec la commande {{1}} et vous attend maintenant.', '["order_code"]', 'submitted'),
  ('ak_payment_received_fr_v1', 'customer', 'utility', 'fr',
   'Nous avons reçu votre paiement pour la commande {{1}} : {{2}}. Ceci est votre reçu.', '["order_code","paid_summary"]', 'submitted')
on conflict (name) do nothing;

create or replace function customer_language(p_party uuid) returns text language sql stable as $$
  select coalesce(
    (select case r.trace->'intent'->>'language' when 'en' then 'en' when 'fr' then 'fr' else 'ar' end
       from agent_runs r join conversations c on c.id = r.conversation_id
      where c.party_id = p_party and c.line = 'customer' and r.agent = 'concierge' and r.trace->'intent'->>'language' is not null
      order by r.created_at desc limit 1),
    (select case when language_pref in ('en', 'fr') then language_pref end from parties where id = p_party),
    'ar') $$;

create or replace function customer_notices_due() returns jsonb language sql stable as $$
  with due as (
    select 'order_cancelled' as kind, o.id as order_id, o.short_code, o.customer_id, customer_language(o.customer_id) as lang,
           e.reason as reason, null::payments as p, e.created_at as at
      from order_events e join orders o on o.id = e.order_id
     where e.to_status = 'cancelled' and e.actor <> 'customer' and e.created_at > now() - interval '2 hours'
       and coalesce(e.reason, '') <> 'superseded_by_new_card'      -- a newer card replaced it; the customer is looking at that one
    union all
    select 'rider_at_door', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, null::payments, s.arrived_at
      from delivery_stops s join orders o on o.id = s.order_id
     where s.kind = 'dropoff' and s.arrived_at > now() - interval '2 hours' and s.completed_at is null and o.status = 'arrived'
    union all
    select 'payment_received', o.id, o.short_code, o.customer_id, customer_language(o.customer_id), null, p, p.confirmed_at
      from payments p join orders o on o.id = p.order_id
     where p.status = 'confirmed' and p.confirmed_at > now() - interval '2 hours'),
  filled as (
    select d.*, case d.kind
      when 'order_cancelled' then jsonb_build_array(d.short_code, case
        when d.reason like 'timeout:awaiting_payment%' then case d.lang when 'en' then 'we did not receive the payment in time'
                                                                       when 'fr' then 'le paiement n''est pas arrivé à temps'
                                                                       else 'ما وصلنا الدفع بالوقت المحدد' end
        when d.reason like 'timeout:%' then case d.lang when 'en' then 'the order was not confirmed in time'
                                                        when 'fr' then 'la commande n''a pas été confirmée à temps'
                                                        else 'ما تأكّد الطلب بالوقت المحدد' end
        else case d.lang when 'en' then 'we could not complete it' when 'fr' then 'nous n''avons pas pu la terminer' else 'ما قدرنا نكمّلو' end end)
      when 'rider_at_door' then jsonb_build_array(d.short_code)
      else jsonb_build_array(d.short_code, trim(both ' +' from concat_ws(' + ',
             case when (d.p).received_usd > 0 then to_char((d.p).received_usd - (d.p).change_usd, 'FM999990.00') || '$' end,
             case when (d.p).received_lbp > 0 then to_char((d.p).received_lbp - (d.p).change_lbp, 'FM999,999,990') || case d.lang when 'ar' then ' ل.ل.' else ' LBP' end end,
             case when (d.p).received_usd = 0 and (d.p).received_lbp = 0 then to_char((d.p).amount_usd, 'FM999990.00') || '$' end)
             || case (d.p).method
                  when 'cod' then case d.lang when 'en' then ' cash' when 'fr' then ' en espèces' else ' نقداً' end
                  when 'whish' then case d.lang when 'en' then ' via Whish' when 'fr' then ' par Whish' else ' عبر Whish' end
                  when 'omt' then case d.lang when 'en' then ' via OMT' when 'fr' then ' par OMT' else ' عبر OMT' end
                  else '' end))
    end as params from due d)
  select coalesce(jsonb_agg(jsonb_build_object('key', 'notice:' || f.kind || ':' || f.order_id, 'kind', f.kind, 'order_id', f.order_id,
           'short_code', f.short_code, 'customer_id', f.customer_id, 'params', f.params, 'lang', f.lang,
           'template', t.name, 'template_approved', t.status = 'approved') order by f.at), '[]'::jsonb)
    from filled f
    left join wa_templates t on t.name = 'ak_' || f.kind || case f.lang when 'ar' then '' else '_' || f.lang end || '_v1'
   where not exists (select 1 from customer_notices n where n.key = 'notice:' || f.kind || ':' || f.order_id) $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
