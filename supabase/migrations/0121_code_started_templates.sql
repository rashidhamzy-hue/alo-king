-- 0121 (session M1, audit G1-23): utility templates for the messages code or staff start, and the one lookup that picks them.
--
-- Before M1 these events reached a customer only inside the 24-hour window (can_send: window_closed_use_template), so a
-- scheduled order confirmed days before, or an answer the customer took long to give, lost its message. Each event now has a
-- utility template in ar, en and fr. Submitted to Meta through Kapso on 14 November 2026 (WABA 1086076707594153, customer
-- line), category UTILITY, allow_category_change false, all PENDING at submission; the hourly sync (index.ts) reads their status.
-- Same wording rules as 0062 and 0093: transactional only, no offer, no praise (invariant 17). Meta ids:
--   ak_shelf_changes_v1              2985175458495575
--   ak_shelf_changes_en_v1           1485242437088280
--   ak_shelf_changes_fr_v1           1153825180369642
--   ak_substitute_question_v1        1891116352231777
--   ak_substitute_question_en_v1     1734191894705275
--   ak_substitute_question_fr_v1     2273060883426279
--   ak_order_delayed_v1              2320478585469253
--   ak_order_delayed_en_v1           2707776793070816
--   ak_order_delayed_fr_v1           1660667518772687
--   ak_delivery_called_off_v1        1103756309330734
--   ak_delivery_called_off_en_v1     1133666179556943
--   ak_delivery_called_off_fr_v1     2182551912635955
--   ak_kept_order_open_v1            2338090990302135
--   ak_kept_order_open_en_v1         1463060072032210
--   ak_kept_order_open_fr_v1         1492179346097773
--   ak_on_the_way_v1                 1651787763098188
--   ak_on_the_way_en_v1              1813539846428158
--   ak_on_the_way_fr_v1              1789121588982547
--   ak_window_reminder_v1            1287922410175383
--   ak_window_reminder_en_v1         2481898865553734
--   ak_window_reminder_fr_v1         1793609561872491
-- ak_window_reminder_*: submitted for the reminder before a scheduled delivery; no code sends it yet (no such event exists).
-- ak_day_close_*: the founder's nightly report, on the ops line. Kept as drafts, not submitted: the ops line is the Kapso
--   sandbox, which holds no templates, and a template on the customer number would break invariant 9.
--
-- customer_reach(party, event): what packages/agents/src/messages/notify.ts needs to send one code-started message: the address
--   on the customer line, the customer's language (0093's customer_language) and that event's template in that language
--   (ak_<event>[_en|_fr]_v1, as customer_notices_due names them), with whether Meta approved it.

insert into wa_templates(name, line, category, language, body, variables, status) values
  ('ak_shelf_changes_v1', 'customer', 'utility', 'ar',
   'طلبك {{1}} جاهز، والمجموع الجديد {{3}}. شو تغيّر: {{2}}. إذا عندك سؤال ردّ على هالرسالة.', '["order_code", "changes", "new_total"]', 'submitted'),
  ('ak_shelf_changes_en_v1', 'customer', 'utility', 'en',
   'Your order {{1}} is ready, with a new total of {{3}}. What changed: {{2}}. If you have a question, reply to this message.', '["order_code", "changes", "new_total"]', 'submitted'),
  ('ak_shelf_changes_fr_v1', 'customer', 'utility', 'fr',
   'Votre commande {{1}} est prête, avec un nouveau total de {{3}}. Ce qui a changé : {{2}}. Pour toute question, répondez à ce message.', '["order_code", "changes", "new_total"]', 'submitted'),
  ('ak_substitute_question_v1', 'customer', 'utility', 'ar',
   'طلبك {{1}}: ما لقينا {{2}}. عنا بدالو {{3}} بسعر {{4}}. بتحب ناخدو؟ إذا ما جاوبت خلال {{5}} دقايق منشيلو من الطلب.', '["order_code", "missing", "substitute", "substitute_price", "answer_minutes"]', 'submitted'),
  ('ak_substitute_question_en_v1', 'customer', 'utility', 'en',
   'Order {{1}}: we did not find {{2}}. We have {{3}} instead, at {{4}}. Shall we take it? If you do not answer within {{5}} minutes, we remove it from the order.', '["order_code", "missing", "substitute", "substitute_price", "answer_minutes"]', 'submitted'),
  ('ak_substitute_question_fr_v1', 'customer', 'utility', 'fr',
   'Commande {{1}} : nous n''avons pas trouvé {{2}}. Nous avons {{3}} à la place, à {{4}}. Le prenons-nous ? Sans réponse dans {{5}} minutes, nous le retirons de la commande.', '["order_code", "missing", "substitute", "substitute_price", "answer_minutes"]', 'submitted'),
  ('ak_order_delayed_v1', 'customer', 'utility', 'ar',
   'طلبك {{1}} رح يتأخّر شوي بسبب ظرف طارئ مع السائق. رح يوصلك مع سائق تاني.', '["order_code"]', 'submitted'),
  ('ak_order_delayed_en_v1', 'customer', 'utility', 'en',
   'Your order {{1}} will be a little late because of an emergency with the rider. Another rider will bring it.', '["order_code"]', 'submitted'),
  ('ak_order_delayed_fr_v1', 'customer', 'utility', 'fr',
   'Votre commande {{1}} aura un peu de retard à cause d''une urgence du livreur. Un autre livreur vous l''apportera.', '["order_code"]', 'submitted'),
  ('ak_delivery_called_off_v1', 'customer', 'utility', 'ar',
   'ما قدرنا نكمّل توصيل طلبك {{1}} بسبب ظرف طارئ مع السائق. رح يتواصل معك حدا من فريقنا.', '["order_code"]', 'submitted'),
  ('ak_delivery_called_off_en_v1', 'customer', 'utility', 'en',
   'We could not finish delivering your order {{1}} because of an emergency with the rider. Someone from our team will contact you.', '["order_code"]', 'submitted'),
  ('ak_delivery_called_off_fr_v1', 'customer', 'utility', 'fr',
   'Nous n''avons pas pu terminer la livraison de votre commande {{1}} à cause d''une urgence du livreur. Une personne de notre équipe va vous contacter.', '["order_code"]', 'submitted'),
  ('ak_kept_order_open_v1', 'customer', 'utility', 'ar',
   'فتحنا هلّق. الطلب يلي بعتّو وكنّا مسكّرين محفوظ. اكبس الزر تحت لنكمّل.', '[]', 'submitted'),
  ('ak_kept_order_open_en_v1', 'customer', 'utility', 'en',
   'We are open now. The order you sent while we were closed is saved. Tap the button below to carry on.', '[]', 'submitted'),
  ('ak_kept_order_open_fr_v1', 'customer', 'utility', 'fr',
   'Nous sommes ouverts. La commande envoyée pendant la fermeture est gardée. Appuyez sur le bouton ci-dessous pour continuer.', '[]', 'submitted'),
  ('ak_on_the_way_v1', 'customer', 'utility', 'ar',
   'طلبك {{1}} صار عالطريق لعندك.', '["order_code"]', 'submitted'),
  ('ak_on_the_way_en_v1', 'customer', 'utility', 'en',
   'Your order {{1}} is on its way to you.', '["order_code"]', 'submitted'),
  ('ak_on_the_way_fr_v1', 'customer', 'utility', 'fr',
   'Votre commande {{1}} est en route vers vous.', '["order_code"]', 'submitted'),
  ('ak_window_reminder_v1', 'customer', 'utility', 'ar',
   'تذكير: طلبك {{1}} موعود بالتوصيل {{2}}. إذا بدك تغيّر شي ردّ على هالرسالة.', '["order_code", "window"]', 'submitted'),
  ('ak_window_reminder_en_v1', 'customer', 'utility', 'en',
   'A reminder: your order {{1}} is scheduled for delivery {{2}}. If you need to change something, reply to this message.', '["order_code", "window"]', 'submitted'),
  ('ak_window_reminder_fr_v1', 'customer', 'utility', 'fr',
   'Rappel : votre commande {{1}} est prévue pour une livraison {{2}}. Pour changer quelque chose, répondez à ce message.', '["order_code", "window"]', 'submitted'),
  ('ak_day_close_v1', 'ops', 'utility', 'ar',
   'تقرير إقفال يوم {{1}}: {{2}}. التفاصيل على شاشة الإدارة.', '["day", "summary"]', 'draft'),
  ('ak_day_close_en_v1', 'ops', 'utility', 'en',
   'Day-close report for {{1}}: {{2}}. The details are on the console.', '["day", "summary"]', 'draft'),
  ('ak_day_close_fr_v1', 'ops', 'utility', 'fr',
   'Rapport de clôture du {{1}} : {{2}}. Le détail est sur la console.', '["day", "summary"]', 'draft')
on conflict (name) do nothing;

create or replace function customer_reach(p_party uuid, p_event text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('to', party_address(p_party, 'customer'), 'lang', l.lang, 'template', t.name, 'template_approved', coalesce(t.status = 'approved', false))
    from (select customer_language(p_party) as lang) l
    left join wa_templates t on t.line = 'customer' and t.category = 'utility'
                             and t.name = 'ak_' || p_event || case l.lang when 'ar' then '' else '_' || l.lang end || '_v1' $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
