-- Alo King Chouf, session VOICE1, migration 0276: voice notes read by our own speech-to-text, place names we do not know, and dishes
-- that are not on sale. docs/DECISIONS.md, "VOICE1, voice notes understood properly, 23 November 2026".
--
-- Staging, 23 November 10:34 UTC: a tester's voice note «I want one whole chicken from Safa Chicken» came through Kapso's transcript as
-- «بدي أطلب من عنفطة Chicken Tin، جوج واحد، okay؟», and the bot answered «عنفطة مش متوفّر بعد على ألو كينغ». Only Kapso's transcript had
-- ever been read (settings.stt.second_provider null, no key, no keyterms); an unknown place name was echoed as a real place; and Safa's
-- whole chicken is one of the dishes rejected for a price range, so it could not be ordered even when understood.
--
--   1 settings.stt   primary_provider 'elevenlabs_scribe' (ElevenLabs Scribe, used when the Worker has ELEVENLABS_API_KEY; Kapso's
--                    transcript is the fallback and judge() decides), its model and price, the keyterm cap (100: above it every note bills
--                    at least 20 s), a daily cap (USD 1; over it Kapso's transcript alone), and the everyday words given as keyterms.
--   2 stt_context()  one call per voice note: the settings, the keyterms (place names and the names customers use for them, the words
--                    above, the served villages, then the brands most ordered), and today's speech-to-text spend.
--   3 record_stt_cost()  one model_costs row per note (workflow 'stt', run id the WhatsApp message id): a retried turn records nothing twice.
--   4 food_place_choices()  the places one customer may order from, with every name they go by (the guess is made in code, food.ts).
--     place_hint_known()    whether a place name is a real place we know of (an LV1 listing or any place row), so "not on Alo King yet"
--                           is said only of a real place, never of a name the speech model made up.
--   5 food_match()   0249's, plus: a line that finds no dish on sale but names one of the place's menu dishes that is not on sale (rejected,
--                    waiting, a price to confirm, or off sale) is `not_on_sale`, with that dish's name and up to five dishes of the place
--                    that are on sale (the same section first). Never its price: an unapproved price is never shown (invariant 7).
-- Nothing here writes an order, a payment, stock or the ledger (invariant 3).

-- ---------- 1 ----------
update settings set value = value || jsonb_build_object(
    'primary_provider', 'elevenlabs_scribe',
    'scribe', jsonb_build_object('model', 'scribe_v2', 'usd_per_hour', 0.20, 'keyterms_usd_per_hour', 0.05),
    'keyterms_max', 100,
    'daily_cap_usd', 1.00,
    'keyterms_extra', jsonb_build_array(
      'ألو كينغ', 'Alo King', 'فروج', 'نص فروج', 'شاورما', 'شاورما دجاج', 'شاورما لحمة', 'طاووق', 'فلافل', 'سندويش', 'صحن', 'تشيكن',
      'بطاطا', 'كرتونة مي', 'ربطة خبز', 'خبز', 'لبنة', 'حمص', 'كبيس', 'جبنة', 'بيض', 'كرتونة بيض', 'حليب', 'كيلو', 'نص كيلو', 'وقية',
      'علبة', 'قنينة', 'ربطة', 'دزينة', 'كبير', 'وسط', 'صغير', 'بلا', 'زيادة', 'ثوم', 'مخلل', 'كاتشب', 'مايونيز', 'كولا', 'عصير')
  ) where key = 'stt';

-- ---------- 2 ----------
create or replace function stt_keyterms() returns text[] language sql stable set search_path = public, pg_temp as $$
  with cap as (select least(greatest(coalesce((setting('stt')->>'keyterms_max')::int, 100), 0), 100) as n),
  terms as (
    -- the places' names and the names customers use for them (never a place that is off)
    select btrim(n) as t, 1 as pri, o as rk from sources s cross join lateral unnest(array[s.name] || s.place_aliases) with ordinality u(n, o)
     where s.kind = 'merchant' and s.buys_for_customer and s.visibility <> 'off'
    union all
    select btrim(w), 2, o::bigint from jsonb_array_elements_text(coalesce(setting('stt')->'keyterms_extra', '[]'::jsonb)) with ordinality x(w, o)
    union all
    select btrim(v.name_ar), 3, 0 from villages v where v.is_served and coalesce(btrim(v.name_ar), '') <> ''
    union all
    -- the brands most ordered over 90 days, then those with the most items
    select b.brand, 4, row_number() over (order by b.sold desc, b.items desc, b.brand) from (
      select p.brand, count(*) as items,
             coalesce((select sum(oi.qty) from order_items oi join orders o on o.id = oi.order_id join products p2 on p2.id = oi.product_id
                        where p2.brand = p.brand and o.created_at > now() - interval '90 days' and o.status::text <> 'cancelled'), 0) as sold
        from products p where p.is_active and coalesce(btrim(p.brand), '') <> '' group by p.brand) b
  ), clean as (
    select distinct on (lower(t)) t, pri, rk from terms
     where t <> '' and char_length(t) <= 50 and array_length(regexp_split_to_array(t, '\s+'), 1) <= 5 and t !~ '[<>{}\[\]\\]'
     order by lower(t), pri, rk
  )
  select coalesce(array_agg(t order by pri, rk, t), '{}') from (select * from clean order by pri, rk, t limit (select n from cap)) x $$;

create or replace function stt_context(p_party uuid default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('settings', coalesce(setting('stt'), '{}'::jsonb), 'keyterms', to_jsonb(stt_keyterms()),
    'spent_today_usd', coalesce((select sum(usd) from model_costs where workflow = 'stt' and day = (now() at time zone 'Asia/Beirut')::date), 0)) $$;

-- ---------- 3 ----------
create or replace function record_stt_cost(p_wamid text, p_model text, p_seconds numeric, p_usd numeric) returns void
language sql set search_path = public, pg_temp as $$
  insert into model_costs(workflow, run_id, model, step, calls, usd)
  values ('stt', p_wamid, p_model, 'voice_note', 1, greatest(coalesce(p_usd, 0), 0))
  on conflict (workflow, run_id, model, step) do nothing $$;

-- ---------- 4 ----------
create or replace function food_place_choices(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('source_id', s.id, 'name', s.name, 'names', to_jsonb(array[s.name] || s.place_aliases)) order by s.name), '[]'::jsonb)
    from sources s where s.kind = 'merchant' and s.buys_for_customer and place_orderable_for(s.id, p_party) $$;

create or replace function place_hint_known(p_hint text) returns boolean language sql stable set search_path = public, extensions, pg_temp as $$
  select coalesce(btrim(p_hint), '') <> '' and (
    exists (select 1 from listings l where l.hidden_at is null and similarity(fold_text(l.name), fold_text(p_hint)) >= 0.6)
    or exists (select 1 from sources s cross join lateral unnest(array[s.name] || coalesce(s.place_aliases, '{}')) n
                where s.kind in ('merchant', 'dark_store') and similarity(fold_text(n), fold_text(p_hint)) >= 0.6)) $$;

-- ---------- 5 ----------
create or replace function food_match(p_party uuid, p_source uuid, p_lines jsonb) returns jsonb language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare ln jsonb; i int := 0; v_out jsonb := '[]'::jsonb; v_q text; v_c jsonb; v_top numeric; v_second numeric; v_best jsonb; v_status text;
        v_off jsonb; v_alts jsonb; v_exact_on boolean;
begin
  if not place_orderable_for(p_source, p_party) then return jsonb_build_object('ok', false, 'reason', 'not_on_alo_king', 'lines', '[]'::jsonb); end if;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_q := regexp_replace(fold_text(coalesce(nullif(ln->>'query', ''), ln->>'raw', '')), '[^[:alnum:][:space:]]', ' ', 'g');
    select coalesce(jsonb_agg(x order by (x->>'score')::numeric desc, x->>'name_en'), '[]'::jsonb) into v_c from (
      select jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'price_usd', ofr.price_usd,
               'score', round(greatest(word_similarity(v_q, regexp_replace(fold_text(p.name_en), '[^[:alnum:][:space:]]', ' ', 'g')),
                                       word_similarity(regexp_replace(fold_text(p.name_en), '[^[:alnum:][:space:]]', ' ', 'g'), v_q),
                                       coalesce(word_similarity(v_q, regexp_replace(fold_text(p.name_ar), '[^[:alnum:][:space:]]', ' ', 'g')), 0),
                                       coalesce(word_similarity(regexp_replace(fold_text(p.name_ar), '[^[:alnum:][:space:]]', ' ', 'g'), v_q), 0))::numeric, 2)) as x
        from products p join offers ofr on ofr.product_id = p.id and ofr.source_id = p_source
       where p.owner_source_id = p_source and p.is_active and ofr.is_available and ofr.price_usd > 0 and btrim(v_q) <> ''
      ) y where (x->>'score')::numeric >= 0.45
      limit 10;
    v_top := coalesce((v_c->0->>'score')::numeric, 0); v_second := coalesce((v_c->1->>'score')::numeric, 0);
    v_status := case when jsonb_array_length(v_c) = 0 then 'not_found'
                     when v_top >= 0.75 and (jsonb_array_length(v_c) = 1 or v_second < v_top - 0.15) then 'matched'
                     when jsonb_array_length(v_c) = 1 and v_top >= 0.6 then 'matched'
                     else 'ambiguous' end;
    v_best := case when v_status = 'matched' then v_c->0 end;
    v_off := null; v_alts := '[]'::jsonb;
    -- VOICE1: a dish on the place's menu that is not on sale (rejected, waiting, a price to confirm, or its item off sale). It answers a line
    -- that found nothing on sale, and a line that names it exactly while only a longer name is on sale («فروج» when «نص فروج» is).
    v_exact_on := exists (select 1 from jsonb_array_elements(v_c) e where btrim(regexp_replace(regexp_replace(fold_text(coalesce(e->>'name_ar', '')), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+', ' ', 'g')) = btrim(regexp_replace(v_q, '\s+', ' ', 'g'))
                                                                     or btrim(regexp_replace(regexp_replace(fold_text(coalesce(e->>'name_en', '')), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+', ' ', 'g')) = btrim(regexp_replace(v_q, '\s+', ' ', 'g')));
    if v_status <> 'matched' or not v_exact_on then
      select x into v_off from (
        select jsonb_build_object('name_ar', mp.name_ar, 'name_en', mp.name_en, 'section_ar', mp.section_ar, 'section_en', mp.section_en,
                 'exact', btrim(regexp_replace(v_q, '\s+', ' ', 'g')) in (btrim(regexp_replace(regexp_replace(fold_text(coalesce(mp.name_ar, '')), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+', ' ', 'g')),
                                                                       btrim(regexp_replace(regexp_replace(fold_text(coalesce(mp.name_en, '')), '[^[:alnum:][:space:]]', ' ', 'g'), '\s+', ' ', 'g'))),
                 'score', round(greatest(coalesce(word_similarity(v_q, regexp_replace(fold_text(mp.name_ar), '[^[:alnum:][:space:]]', ' ', 'g')), 0),
                                         coalesce(word_similarity(regexp_replace(fold_text(mp.name_ar), '[^[:alnum:][:space:]]', ' ', 'g'), v_q), 0),
                                         coalesce(word_similarity(v_q, regexp_replace(fold_text(mp.name_en), '[^[:alnum:][:space:]]', ' ', 'g')), 0),
                                         coalesce(word_similarity(regexp_replace(fold_text(mp.name_en), '[^[:alnum:][:space:]]', ' ', 'g'), v_q), 0))::numeric, 2)) as x
          from menu_dish_proposals mp
         where mp.source_id = p_source
           and not exists (select 1 from products p join offers ofr on ofr.product_id = p.id and ofr.source_id = p_source
                            where p.id = coalesce(mp.product_id, mp.matched_product_id) and p.is_active and ofr.is_available and ofr.price_usd > 0)
      ) z where btrim(v_q) <> '' and (x->>'score')::numeric >= 0.6 order by (x->>'exact')::boolean desc, (x->>'score')::numeric desc, x->>'name_ar' limit 1;
      if v_off is not null and (v_status = 'not_found' or ((v_off->>'exact')::boolean and not v_exact_on)) then
        v_best := null;
        v_status := 'not_on_sale';
        select coalesce(jsonb_agg(c order by rk), '[]'::jsonb) into v_alts from (
          select jsonb_build_object('product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar, 'price_usd', ofr.price_usd) as c,
                 row_number() over (order by (sec.section_ar is not distinct from v_off->>'section_ar' and sec.section_en is not distinct from v_off->>'section_en') desc,
                   greatest(coalesce(similarity(v_q, fold_text(p.name_ar)), 0), similarity(v_q, fold_text(p.name_en))) desc, p.name_en) as rk
            from products p join offers ofr on ofr.product_id = p.id and ofr.source_id = p_source
            left join lateral (select mp2.section_ar, mp2.section_en from menu_dish_proposals mp2 where mp2.product_id = p.id order by mp2.position desc limit 1) sec on true
           where p.owner_source_id = p_source and p.is_active and ofr.is_available and ofr.price_usd > 0) y
         where rk <= 5;
      end if;
    end if;
    v_out := v_out || jsonb_build_object('idx', i, 'raw', ln->>'raw', 'query', ln->>'query', 'qty', coalesce((ln->>'qty')::numeric, 1),
      'status', v_status, 'chosen', v_best, 'candidates', case when v_status = 'ambiguous' then v_c when v_status = 'not_on_sale' then v_alts else '[]'::jsonb end,
      'dish', case when v_status = 'not_on_sale' then v_off - 'score' - 'exact' end,
      'options', case when v_best is not null then dish_options_in_text((v_best->>'product_id')::uuid,
                        concat_ws(' ', ln->>'raw', (select string_agg(m, ' ') from jsonb_array_elements_text(coalesce(ln->'modifiers', '[]'::jsonb)) m)))
                      else '[]'::jsonb end);
    i := i + 1;
  end loop;
  return jsonb_build_object('ok', true, 'lines', v_out);
end $$;

select pin_search_paths();
do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
