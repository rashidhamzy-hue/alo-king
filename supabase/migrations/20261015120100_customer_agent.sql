-- Session 5c (DECISIONS §38.3 rows for 5c, §39.6): the customer agent's server side. The AI interprets; everything a
-- reply states (items, prices, fees, times, policies, refunds) comes from a function below. Contents:
--   1. config: free text and voice switches (off until the evals pass, §32.4), the Haiku 5.5 candidate behind the eval,
--      180 s auto-cancel, message budget, outbound pacing, stairs rule, gift and address timings, dispute rules
--   2. one search index across every orderable menu in the customer's area plus the normalisation dictionary
--      (Arabic, Arabizi, French, English, brand words) and the dish library's names and aliases
--   3. customer memory: facts with source and date, health notes only with consent, "what do you remember", one-tap delete
--   4. the delivery address confirmed on every order; "for you or someone else?" per §22.1, remembered per address
--   5. gift orders (§22.2 scenarios 5 and 7): the recipient accepts and pays cash, or nothing is ordered
--   6. order_place and basket_quote: the §38.3 stairs rule, customer credits, gift and allergy notes
--   7. disputes and refunds: deterministic rules (§38.3) inside §20's limits, ledger entries, credits on the next order
--   8. customer messages: budget (target 8, cap 12 per order), consolidated "delivered + rate", alternatives after an
--      unanswered order, the tracking link once the site exists
--   9. outbound pacing (60 per second per number, 6 s between non-urgent messages to one person)
--  10. dead-letter queue for webhook events that failed every attempt
--  11. estimated allergen hints from the dish library (sesame/tahini, toum with egg), siyami and halal estimates
-- Places and vendor tables are only read (§31).

select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'DECISIONS §38.3, §39.6: session 5c customer agent, 15 October 2026', true);

-- 1. Config -------------------------------------------------------------------------------------------------------
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('ai_free_text_enabled', 'false', now(),
   'Model turns for typed text. Off until the text eval passes on real messages (DECISIONS §32.4, §39.6); taps, rules and the catalogue search work without it', null),
  ('ai_voice_enabled', 'false', now(),
   'Voice notes through transcription and the model. Off until the voice eval passes on the real notes (DECISIONS §32.4, §39.6)', null),
  ('ai_customer_model_candidate', '"claude-haiku-5-5"', now(),
   'Challenger for ai_customer_model in the evals workflow; it replaces the model only after winning the eval (DECISIONS §32.6, §38.3)', null),
  ('ai_model_prices', '{"claude-haiku-4-5-20251001": {"in": 1.00, "out": 5.00}, "claude-haiku-5-5": {"in": 0.10, "out": 0.50}, "claude-sonnet-5-5": {"in": 2.00, "out": 10.00}, "gpt-4o-transcribe": {"in": 2.50, "out": 10.00, "audio_min": 0.006}, "gpt-4o-mini-transcribe": {"in": 1.25, "out": 5.00, "audio_min": 0.003}}', now(),
   'USD per million tokens (and per audio minute); Haiku 5.5 added before any eval runs it (DECISIONS §32.6)', null),
  ('escalation_give_up_s', '180', now(),
   'No acknowledgement through all four layers: cancelled and rerouted with alternatives at 180 s (DECISIONS §38.3; was 300)', null),
  ('customer_message_budget', '{"target": 8, "cap": 12}', now(),
   'WhatsApp messages to the customer per order: target 8, hard cap 12 (DECISIONS §38.3)', null),
  ('outbound_pacing', '{"per_number_per_s": 60, "same_person_gap_s": 6}', now(),
   'Outbox pacing per sending number and per person for non-urgent messages (DECISIONS §38.3, Meta error 131056)', null),
  ('stairs_fee_rule', '{"per_floor_usd": 0.25, "free_floors": 2, "cap_usd": 2.00, "heavy_unit_usd": 0.50, "heavy_free_units": 1}', now(),
   'min(cap, per_floor x max(0, floors - free) x E) + heavy_unit x max(0, heavy - free_units); E = 0 with a working lift (DECISIONS §38.3)', null),
  ('gift_accept_minutes', '30', now(),
   'How long a gift order waits for the recipient''s "accept and pay cash" tap (DECISIONS §22.2 scenario 7)', null),
  ('gift_requests_per_day', '3', now(),
   'Gift requests one sender may send one number in 24 hours (no harassment, DECISIONS §22.2 scenario 7)', null),
  ('address_fresh_minutes', '30', now(),
   'A pin sent this recently counts as the address confirmed for the basket (DECISIONS §39.6)', null),
  ('dispute_rules', '{"auto_max_usd": 8, "owner_over_usd": 20, "max_dispute_rate": 0.10, "rate_window_days": 90, "cold_factor": 1.5, "cold_credit_pct": 30, "late_prep_min": 15, "credit_days": 60, "report_days": 2}', now(),
   'Deterministic dispute rules: automatic up to $8, Rasheed''s tap above $20, credits valid 60 days (DECISIONS §20.1, §20.2, §38.3)', null);

-- 2. Search index ---------------------------------------------------------------------------------------------------
-- The normalisation dictionary (§32.4 asset 2): Arabizi and spelling variants, brand words and descriptive words, each
-- mapped to the canonical words the menus use. Grows with every eval batch; a row is code-owned data, not a seed.
create table public.search_lexicon (
  term text primary key check (term = app_private.normalize_place_name(term)),
  kind text not null check (kind in ('dish', 'brand', 'attribute', 'category')),
  canonical text[] not null default '{}',
  attribute text check (attribute in ('spicy', 'cheap', 'kids', 'diet', 'sweet', 'hot_drink', 'cold_drink')),
  note text,
  check (kind <> 'attribute' or attribute is not null)
);
alter table public.search_lexicon enable row level security;
revoke all on table public.search_lexicon from public, anon, authenticated;
grant all on table public.search_lexicon to service_role;

insert into public.search_lexicon (term, kind, canonical, attribute, note)
select app_private.normalize_place_name(t), k, c, a, n from (values
  -- Dishes, Arabizi and French spellings
  ('man2oushe', 'dish', array['منقوشة', 'manakish', 'manousheh'], null::text, null::text),
  ('manoushe', 'dish', array['منقوشة', 'manakish'], null, null),
  ('mana2ish', 'dish', array['مناقيش', 'منقوشة', 'manakish'], null, null),
  ('manakish', 'dish', array['منقوشة', 'manakish'], null, null),
  ('man2ouche', 'dish', array['منقوشة', 'manakish'], null, null),
  ('kishk', 'dish', array['كشك', 'kishk'], null, null),
  ('kechek', 'dish', array['كشك', 'kishk'], null, null),
  ('za3tar', 'dish', array['زعتر', 'zaatar', 'thyme'], null, null),
  ('zaatar', 'dish', array['زعتر', 'zaatar', 'thyme'], null, null),
  ('ta2ouk', 'dish', array['طاووق', 'tawouk', 'taouk'], null, null),
  ('tawook', 'dish', array['طاووق', 'tawouk', 'taouk'], null, null),
  ('chawarma', 'dish', array['شاورما', 'shawarma'], null, null),
  ('shawerma', 'dish', array['شاورما', 'shawarma'], null, null),
  ('flafel', 'dish', array['فلافل', 'falafel'], null, null),
  ('7ommos', 'dish', array['حمص', 'hummus'], null, null),
  ('hommos', 'dish', array['حمص', 'hummus'], null, null),
  ('knefe', 'dish', array['كنافة', 'knefeh', 'kunafa'], null, null),
  ('kenefe', 'dish', array['كنافة', 'knefeh', 'kunafa'], null, null),
  ('lahm b3ajin', 'dish', array['لحم بعجين', 'lahm bi ajeen'], null, null),
  ('jebne', 'dish', array['جبنة', 'cheese'], null, null),
  ('jebneh', 'dish', array['جبنة', 'cheese'], null, null),
  ('djej', 'dish', array['دجاج', 'chicken'], null, null),
  ('farrouj', 'dish', array['فروج', 'chicken'], null, null),
  ('lahme', 'dish', array['لحمة', 'meat', 'beef'], null, null),
  ('batata', 'dish', array['بطاطا', 'fries', 'potato'], null, null),
  ('frites', 'dish', array['بطاطا', 'fries'], null, null),
  ('poulet', 'dish', array['دجاج', 'chicken'], null, null),
  ('fromage', 'dish', array['جبنة', 'cheese'], null, null),
  ('mai', 'dish', array['مياه', 'water'], null, null),
  ('may', 'dish', array['مياه', 'water'], null, null),
  ('eau', 'dish', array['مياه', 'water'], null, null),
  ('ghaz', 'dish', array['غاز', 'gas'], null, null),
  ('ahwe', 'dish', array['قهوة', 'coffee'], null, null),
  ('2ahwe', 'dish', array['قهوة', 'coffee'], null, null),
  -- Brand words (§38.3)
  ('picon', 'brand', array['picon', 'بيكون'], null, 'cheese triangles'),
  ('بيكون', 'brand', array['picon', 'بيكون'], null, null),
  ('bonjus', 'brand', array['bonjus', 'بونجوس'], null, 'juice'),
  ('بونجوس', 'brand', array['bonjus', 'بونجوس'], null, null),
  ('nido', 'brand', array['nido', 'نيدو'], null, 'milk powder'),
  ('نيدو', 'brand', array['nido', 'نيدو'], null, null),
  ('pepsi', 'brand', array['pepsi', 'بيبسي'], null, null),
  ('بيبسي', 'brand', array['pepsi', 'بيبسي'], null, null),
  ('7up', 'brand', array['7up', 'سفن اب'], null, null),
  ('seven up', 'brand', array['7up', 'سفن اب'], null, null),
  ('miranda', 'brand', array['mirinda', 'ميرندا'], null, null),
  ('mirinda', 'brand', array['mirinda', 'ميرندا'], null, null),
  ('coca', 'brand', array['coca cola', 'كوكا كولا'], null, null),
  ('coke', 'brand', array['coca cola', 'كوكا كولا'], null, null),
  ('kinza', 'brand', array['kinza', 'كينزا'], null, null),
  ('kiri', 'brand', array['kiri', 'كيري'], null, null),
  ('nescafe', 'brand', array['nescafe', 'نسكافيه'], null, null),
  ('tannourine', 'brand', array['tannourine', 'تنورين', 'water'], null, null),
  ('sohat', 'brand', array['sohat', 'صحة', 'water'], null, null),
  ('rim', 'brand', array['rim', 'ريم', 'water'], null, null),
  ('sannine', 'brand', array['sannine', 'صنين', 'water'], null, null),
  ('president', 'brand', array['president', 'بريزيدان'], null, null),
  ('lipton', 'brand', array['lipton', 'ليبتون'], null, null),
  -- Descriptive words: they filter or sort, never become items
  ('7arr', 'attribute', '{}', 'spicy', null),
  ('7ar', 'attribute', '{}', 'spicy', null),
  ('harr', 'attribute', '{}', 'spicy', null),
  ('حار', 'attribute', '{}', 'spicy', null),
  ('spicy', 'attribute', '{}', 'spicy', null),
  ('epice', 'attribute', '{}', 'spicy', null),
  ('piquant', 'attribute', '{}', 'spicy', null),
  ('rkhis', 'attribute', '{}', 'cheap', null),
  ('rkhees', 'attribute', '{}', 'cheap', null),
  ('رخيص', 'attribute', '{}', 'cheap', null),
  ('cheap', 'attribute', '{}', 'cheap', null),
  ('cher', 'attribute', '{}', 'cheap', 'as in "pas cher"'),
  ('diet', 'attribute', '{}', 'diet', null),
  ('دايت', 'attribute', '{}', 'diet', null),
  ('zero', 'attribute', '{}', 'diet', null),
  ('light', 'attribute', '{}', 'diet', null),
  ('wled', 'category', array['sandwich', 'burger', 'pizza', 'side'], 'kids', 'akel lal wled: food for the kids'),
  ('wlad', 'category', array['sandwich', 'burger', 'pizza', 'side'], 'kids', null),
  ('ولاد', 'category', array['sandwich', 'burger', 'pizza', 'side'], 'kids', null),
  ('kids', 'category', array['sandwich', 'burger', 'pizza', 'side'], 'kids', null),
  ('enfants', 'category', array['sandwich', 'burger', 'pizza', 'side'], 'kids', null),
  ('helo', 'category', array['sweets'], 'sweet', 'something sweet'),
  ('7elo', 'category', array['sweets'], 'sweet', null),
  ('حلو', 'category', array['sweets'], 'sweet', null),
  ('sweet', 'category', array['sweets'], 'sweet', null),
  ('dessert', 'category', array['sweets'], 'sweet', null)
) as x(t, k, c, a, n)
on conflict (term) do nothing;

-- Words that carry no meaning for search in any of the four languages ("bade shi", "I want", "je voudrais").
create function app_private.search_stopword(p_word text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_word = any (array['bade', 'badde', 'baddi', 'bde', 'bidde', 'shi', 'chi', 'shway', 'w', 'wa', 'u', 'aw', 'ma3',
    'lal', 'la', 'l', 'al', 'el', 'akel', 'akl', 'i', 'want', 'would', 'like', 'some', 'something', 'please', 'a', 'an', 'the',
    'for', 'with', 'and', 'or', 'of', 'je', 'veux', 'voudrais', 'du', 'de', 'des', 'un', 'une', 'avec', 'pour', 'et', 'svp',
    'pas', 'بدي', 'بدنا', 'شي', 'و', 'مع', 'لل', 'ل', 'اكل', 'please', 'plz', 'pls'])
$$;

-- Every orderable item with the words a customer may use for it: its names in three languages, the description, the
-- section, the matched dish library entry with its aliases (Arabizi included), the brand words. One row per item.
create view app_private.catalog_docs with (security_invoker = true) as
select i.id as item_id, i.vendor_id, i.name_ar, i.name_en, i.name_fr, i.price_usd, i.spicy_level, i.section_id,
  d.category as dish_category,
  app_private.normalize_place_name(concat_ws(' ', i.name_ar, i.name_en, i.name_fr)) as names,
  app_private.normalize_place_name(concat_ws(' ', i.name_ar, i.name_en, i.name_fr, i.description, s.name_ar, s.name_en,
    d.name_ar, d.name_en, d.name_fr, array_to_string(d.aliases, ' '))) as doc
from public.menu_items i
join public.vendors v on v.id = i.vendor_id
left join public.menu_sections s on s.id = i.section_id
left join public.menu_item_nutrition n on n.item_id = i.id
left join public.dish_library d on d.id = n.dish_id
where v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and i.available;
revoke all on app_private.catalog_docs from public, anon, authenticated;

-- The words a query stands for, as groups: each dictionary word and the rest of the query ("core") is one concept, with
-- its canonical spellings and the dish library names whose aliases match; plus the attributes asked for. An item
-- must answer every concept to rank first ("manoushe kishk" is the kishk one, not every manoushe).
create function public.search_expand(p_query text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_n text := app_private.normalize_place_name(coalesce(p_query, ''));
  v_words text[];
  v_groups jsonb := '[]';
  v_attrs text[] := '{}';
  v_cats text[] := '{}';
  v_core text;
  v_core_terms text[];
  v_l record;
  v_d record;
begin
  if v_n is null then
    return jsonb_build_object('core', null, 'groups', '[]'::jsonb, 'terms', '[]'::jsonb, 'attributes', '[]'::jsonb, 'categories', '[]'::jsonb);
  end if;
  -- Bare numbers are quantities ("Pepsi diet 2"), read by the bot; they never search.
  select array_agg(w order by o) into v_words
  from unnest(string_to_array(v_n, ' ')) with ordinality as x(w, o)
  where w !~ '^[0-9٠-٩]+$' and not app_private.search_stopword(w);
  -- Two-word dictionary terms first ("lahm b3ajin", "seven up"), then single words.
  for v_l in
    select l.* from public.search_lexicon l
    where (position(' ' in l.term) > 0 and (' ' || v_n || ' ') like '% ' || l.term || ' %')
       or (position(' ' in l.term) = 0 and l.term = any (coalesce(v_words, '{}')))
    order by position(' ' in l.term) > 0 desc, l.term
  loop
    if v_l.kind = 'attribute' then
      v_attrs := v_attrs || v_l.attribute;
    elsif v_l.kind = 'category' then
      v_attrs := v_attrs || v_l.attribute;
      v_cats := v_cats || v_l.canonical;
    else
      v_groups := v_groups || jsonb_build_array((select jsonb_agg(distinct app_private.normalize_place_name(t))
        from unnest(v_l.canonical || v_l.term) t where app_private.normalize_place_name(t) is not null));
    end if;
    v_words := array_remove(v_words, v_l.term);
    foreach v_core in array string_to_array(v_l.term, ' ') loop
      v_words := array_remove(v_words, v_core);
    end loop;
  end loop;
  v_core := nullif(array_to_string(v_words, ' '), '');
  if v_core is not null then
    v_core_terms := array[v_core];
    -- Dish library names and aliases ("shawarma djej" → Chicken shawarma).
    for v_d in
      select d.name_ar, d.name_en from public.dish_library d
      where exists (select 1 from unnest(d.aliases || array[d.name_ar, d.name_en, d.name_fr]) a
                    where extensions.word_similarity(v_core, app_private.normalize_place_name(a)) >= 0.8)
      order by d.id limit 5
    loop
      v_core_terms := v_core_terms || app_private.normalize_place_name(v_d.name_ar) || app_private.normalize_place_name(v_d.name_en);
    end loop;
    v_groups := jsonb_build_array((select jsonb_agg(distinct t) from unnest(v_core_terms) t where t is not null)) || v_groups;
  end if;
  return jsonb_build_object(
    'core', v_core,
    'groups', v_groups,
    'terms', coalesce((select jsonb_agg(distinct t) from jsonb_array_elements(v_groups) g, jsonb_array_elements_text(g) t), '[]'::jsonb),
    'attributes', coalesce((select jsonb_agg(distinct a) from unnest(v_attrs) a), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(distinct c) from unnest(v_cats) c), '[]'::jsonb));
end;
$$;

-- One search across every orderable item that reaches the customer (DECISIONS §39.6): the straight-line prefilter
-- of vendor_search, the delivery area, then the words. Each row is a real item with its server price.
create function public.catalog_search(p_customer_id uuid, p_query text, p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_x jsonb := public.search_expand(p_query);
  v_terms text[];
  v_groups jsonb := v_x -> 'groups';
  v_attrs text[];
  v_cats text[];
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_point extensions.geography;
  v_place text;
  v_max numeric := public.max_delivery_km();
  v_items jsonb;
begin
  select coalesce(array_agg(t), '{}') into v_terms from jsonb_array_elements_text(v_x -> 'terms') t;
  select coalesce(array_agg(t), '{}') into v_attrs from jsonb_array_elements_text(v_x -> 'attributes') t;
  select coalesce(array_agg(t), '{}') into v_cats from jsonb_array_elements_text(v_x -> 'categories') t;
  if cardinality(v_terms) = 0 and cardinality(v_cats) = 0 and cardinality(v_attrs) = 0 then
    return jsonb_build_object('status', 'no_words', 'expand', v_x, 'items', '[]'::jsonb);
  end if;
  if v_pt is not null then
    v_point := app_private.lat_lon_point((v_pt ->> 'lat')::float8, (v_pt ->> 'lon')::float8);
    select a.place_id into v_place from public.addresses a where a.id = (v_pt ->> 'address_id')::uuid;
  end if;
  with cand as (
    select c.*, v.name_ar as v_ar, v.name_en as v_en, v.is_test,
      not (v.paused_until is not null and v.paused_until > now()) as is_open,
      case when v_point is not null then extensions.st_distance(v.location, v_point) / 1000.0 end as km,
      least(coalesce(v.delivery_radius_km, v_max), v_max) as limit_km,
      greatest(
        -- Every concept counts: the mean over the query's groups of the best match in each (names first, the wider doc
        -- at 0.9), so an item answering one word of two scores about half.
        coalesce((select avg(greatest(
            coalesce((select max(extensions.word_similarity(t, c.names)) from jsonb_array_elements_text(g) t), 0),
            0.9 * coalesce((select max(extensions.word_similarity(t, c.doc)) from jsonb_array_elements_text(g) t), 0)))
          from jsonb_array_elements(v_groups) g), 0),
        -- Descriptive words alone ("bade shi 7arr w rkhis", "akel lal wled"): every item that fits them.
        case when cardinality(v_terms) = 0 and (cardinality(v_cats) = 0 or c.dish_category = any (v_cats)
               or ('kids' = any (v_attrs) and c.names ~ '(sandwich|burger|pizza|fries|nuggets|سندويش|برغر|بيتزا|بطاطا|ناغتس)')
               or ('sweet' = any (v_attrs) and c.doc ~ '(sweet|dessert|حلو|حلويات|كنافه|knefe|cake|كيك)')) then 0.6 else 0 end
      )::real as score
    from app_private.catalog_docs c
    join public.vendors v on v.id = c.vendor_id
    where app_private.menu_item_orderable(c.item_id, 1)
  ),
  kept as (
    select * from cand
    where score >= 0.5
      and (v_point is null or is_test or (km <= limit_km and (v_place is null or app_private.place_delivered_to(v_place))))
      and (not ('spicy' = any (v_attrs)) or spicy_level > 0 or doc ~ '(حار|spicy|piquant|harr)')
      and (not ('diet' = any (v_attrs)) or doc ~ '(diet|zero|light|دايت)')

  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', k.item_id, 'vendor_id', k.vendor_id,
      'name_ar', k.name_ar, 'name_en', coalesce(k.name_en, k.name_fr, k.name_ar), 'price_usd', k.price_usd,
      'vendor_ar', k.v_ar, 'vendor_en', coalesce(k.v_en, k.v_ar), 'is_open', k.is_open,
      'km', round(k.km::numeric, 1), 'score', round(k.score::numeric, 3))
      order by k.is_open desc,
        case when 'cheap' = any (v_attrs) then k.price_usd end asc nulls last,
        k.score desc, k.km nulls last, k.price_usd, k.item_id), '[]'::jsonb)
    into v_items
  from (select * from kept order by is_open desc, case when 'cheap' = any (v_attrs) then price_usd end asc nulls last,
          score desc, km nulls last, price_usd, item_id
        limit least(greatest(coalesce(p_limit, 10), 1), 10)) k;
  return jsonb_build_object('status', case when jsonb_array_length(v_items) > 0 then 'ok' else 'none' end,
    'expand', v_x, 'items', v_items, 'has_point', v_pt is not null);
end;
$$;

-- 3. Customer memory (§39.6, Law 81/2018) ----------------------------------------------------------------------------
-- Facts are rows with their source and date, never prompt text. Health-related notes (an allergy, gluten-free, no sugar)
-- are kept only with the customer's consent (consented_at); a preference ("vegetarian") is kept from what they said.
alter table public.customer_preferences drop constraint customer_preferences_key_check;
alter table public.customer_preferences
  add constraint customer_preferences_key_check check (key in ('vegetarian', 'vegan', 'no_pork', 'no_alcohol', 'fasting',
    'halal', 'allergy', 'gluten_free', 'no_sugar', 'spice', 'note')),
  add column source text not null default 'said' check (source in ('said', 'tapped')),
  add column consented_at timestamptz;
-- Rows saved before this rule without consent are health notes nobody agreed to keep: removed (Law 81/2018).
delete from public.customer_preferences where key in ('allergy', 'gluten_free', 'no_sugar') and consented_at is null;
alter table public.customer_preferences
  add constraint customer_preferences_health_consent check (key not in ('allergy', 'gluten_free', 'no_sugar') or consented_at is not null);
comment on table public.customer_preferences is
  'What the customer said about themselves (DECISIONS §39.6). Health notes need consented_at. Used only to help this customer order: never for marketing, never shown to merchants beyond an order''s allergy note.';

create function app_private.fact_is_health(p_key text) returns boolean
language sql immutable set search_path = ''
as $$ select p_key in ('allergy', 'gluten_free', 'no_sugar') $$;

-- Saves one fact. A health note without consent is not stored: the caller asks first and calls again with consent.
create function public.customer_fact_set(p_customer_id uuid, p_key text, p_value text, p_source text default 'said',
  p_consent boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_key is null or p_value is null or char_length(trim(p_value)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if app_private.fact_is_health(p_key) and not coalesce(p_consent, false) then
    return jsonb_build_object('status', 'needs_consent', 'key', p_key, 'value', left(trim(p_value), 120));
  end if;
  insert into public.customer_preferences (customer_id, key, value, source, consented_at)
  values (p_customer_id, p_key, left(trim(p_value), 120), coalesce(p_source, 'said'),
          case when app_private.fact_is_health(p_key) then now() end)
  on conflict (customer_id, key) do update set value = excluded.value, stated_at = now(), source = excluded.source,
    consented_at = coalesce(excluded.consented_at, public.customer_preferences.consented_at);
  return jsonb_build_object('status', 'saved', 'key', p_key);
end;
$$;

-- The old setter keeps working for non-health keys and never stores a health note.
create or replace function public.customer_preference_set(p_customer_id uuid, p_key text, p_value text) returns void
language sql security definer set search_path = ''
as $$ select public.customer_fact_set(p_customer_id, p_key, p_value, 'said', false); $$;

-- Saved addresses are the ones the customer agreed to keep; a one-time pin is kept only for its orders.
alter table public.addresses
  add column saved boolean not null default true,
  add column for_whom text check (for_whom in ('self', 'other')),
  add column recipient_name text check (char_length(recipient_name) between 1 and 60),
  add column recipient_phone text check (recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column pinned_at timestamptz not null default now(),
  add constraint addresses_recipient_for_other check ((recipient_name is null and recipient_phone is null) or for_whom = 'other');
-- Existing addresses were pinned when last used, not at this migration (else every address would read as just pinned).
update public.addresses set pinned_at = coalesce(last_used_at, created_at);
comment on column public.addresses.pinned_at is 'When the customer last sent this pin: a pin sent while ordering confirms the address (DECISIONS §39.6).';
comment on column public.addresses.saved is 'The customer agreed to keep this address (DECISIONS §39.6); false = used for one order.';
comment on column public.addresses.for_whom is 'Answer to "for you or someone else?" (§22.1), remembered per address.';

-- Goodwill credits from disputes (section 7), read by the profile.
create table public.customer_credits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  reason text not null check (char_length(reason) between 3 and 200),
  dispute_id uuid,
  expires_at timestamptz not null,
  used_order_id uuid references public.orders (id) on delete set null,
  expired_tx uuid,
  created_at timestamptz not null default now()
);
create index customer_credits_open_idx on public.customer_credits (customer_id, expires_at) where used_order_id is null;
alter table public.customer_credits enable row level security;
revoke all on table public.customer_credits from public, anon, authenticated;
grant all on table public.customer_credits to service_role;
grant select on table public.customer_credits to authenticated;
create policy customer_credits_read on public.customer_credits for select to authenticated
  using ((select app_private.is_operator())
         or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())));
comment on table public.customer_credits is
  'Goodwill credits from disputes on cash orders (DECISIONS §38.3): a discount on a later order, no cash value, expire. The ledger carries the money; this table says which order used them.';

-- The profile the model and the greeting see (§30.1.5): saved addresses only, preferences with consent rules applied.
create or replace function public.customer_profile(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with c as (select * from public.customers where id = p_customer_id),
  o as (
    select o.* from public.orders o, c
    where o.customer_id = c.id and o.status = 'delivered' and (c.profile_reset_at is null or o.created_at > c.profile_reset_at)
  )
  select jsonb_build_object(
    'name', (select display_name from c),
    'delivered_orders', (select count(*) from o),
    'usual_vendors', coalesce((
      select jsonb_agg(x order by x ->> 'n' desc) from (
        select jsonb_build_object('vendor_id', v.id, 'name', coalesce(v.name_ar, v.name_en), 'name_en', coalesce(v.name_en, v.name_ar),
          'n', count(*)) as x
        from o join public.vendors v on v.id = o.vendor_id group by v.id order by count(*) desc limit 3) s), '[]'),
    'usual_items', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('item_id', i.item_id, 'name', coalesce(i.name_ar, i.name_en), 'name_en', coalesce(i.name_en, i.name_ar),
          'n', sum(i.quantity)) as x
        from o join public.order_items i on i.order_id = o.id group by i.item_id, coalesce(i.name_ar, i.name_en), coalesce(i.name_en, i.name_ar)
        order by sum(i.quantity) desc limit 5) s), '[]'),
    'last_order_id', (select o.id from o order by o.created_at desc limit 1),
    'last_order', (select jsonb_build_object('order_id', o.id, 'vendor', coalesce(v.name_ar, v.name_en), 'vendor_en', coalesce(v.name_en, v.name_ar),
        'items', (select string_agg(i.quantity || '× ' || coalesce(i.name_en, i.name_ar), ', ' order by i.created_at)
                  from public.order_items i where i.order_id = o.id),
        'items_ar', (select string_agg(i.quantity || '× ' || coalesce(i.name_ar, i.name_en), '، ' order by i.created_at)
                  from public.order_items i where i.order_id = o.id))
      from o join public.vendors v on v.id = o.vendor_id order by o.created_at desc limit 1),
    'usual_hour', (select mode() within group (order by extract(hour from o.created_at at time zone 'Asia/Beirut')::int) from o),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object('address_id', a.id, 'label', a.label, 'place', coalesce(p.name_ar, p.name_en),
        'place_en', coalesce(p.name_en, p.name_ar), 'default', a.is_default, 'for_whom', a.for_whom,
        'recipient_name', a.recipient_name) order by a.is_default desc, a.last_used_at desc nulls last)
      from public.addresses a join public.places p on p.id = a.place_id where a.customer_id = p_customer_id and a.saved), '[]'),
    'language', (select language from c),
    'preferences', coalesce((select jsonb_object_agg(key, value) from public.customer_preferences
                              where customer_id = p_customer_id and (not app_private.fact_is_health(key) or consented_at is not null)), '{}'),
    'credit_usd', (select coalesce(sum(amount_usd), 0) from public.customer_credits cc
                   where cc.customer_id = p_customer_id and cc.used_order_id is null and cc.expires_at > now())
  );
$$;

-- "What do you remember about me?" (§39.6): everything kept, each part with what it is and when it was learned.
create function public.customer_memory(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'name', c.display_name,
    'language', c.language,
    'addresses', coalesce((select jsonb_agg(jsonb_build_object('address_id', a.id, 'label', a.label,
        'place_ar', p.name_ar, 'place_en', coalesce(p.name_en, p.name_ar), 'for_whom', a.for_whom,
        'recipient_name', a.recipient_name, 'since', a.created_at) order by a.is_default desc, a.last_used_at desc nulls last)
      from public.addresses a join public.places p on p.id = a.place_id where a.customer_id = c.id and a.saved), '[]'),
    'usual', (public.customer_profile(c.id) -> 'usual_items'),
    'orders', (public.customer_profile(c.id) -> 'delivered_orders'),
    'facts', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'value', f.value, 'source', f.source,
        'since', f.stated_at, 'health', app_private.fact_is_health(f.key)) order by f.stated_at)
      from public.customer_preferences f where f.customer_id = c.id), '[]'),
    'marketing_opt_in', c.marketing_opt_in
  )
  from public.customers c where c.id = p_customer_id;
$$;

-- One tap deletes one part or everything (§39.6). Orders stay (the merchant's and the ledger's records); "orders"
-- forgets them for memory: usual orders and reorder start again from now.
create function public.customer_memory_forget(p_customer_id uuid, p_part text, p_ref text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  case p_part
    when 'name' then
      update public.customers set display_name = null where id = p_customer_id;
      get diagnostics v_n = row_count;
    when 'language' then
      update public.customers set language = null where id = p_customer_id;
      update public.bot_sessions set lang = null where customer_id = p_customer_id;
      get diagnostics v_n = row_count;
    when 'fact' then
      delete from public.customer_preferences where customer_id = p_customer_id and key = p_ref;
      get diagnostics v_n = row_count;
    when 'facts' then
      delete from public.customer_preferences where customer_id = p_customer_id;
      get diagnostics v_n = row_count;
    when 'address' then
      -- An address on an open basket or a running order stays until that order ends, but is no longer saved.
      update public.addresses set saved = false, label = null, recipient_name = null, recipient_phone = null,
        for_whom = null, is_default = false
      where customer_id = p_customer_id and id::text = p_ref;
      get diagnostics v_n = row_count;
    when 'addresses' then
      update public.addresses set saved = false, label = null, recipient_name = null, recipient_phone = null,
        for_whom = null, is_default = false
      where customer_id = p_customer_id;
      get diagnostics v_n = row_count;
    when 'orders' then
      update public.customers set profile_reset_at = now() where id = p_customer_id;
      update public.bot_sessions set history = '[]' where customer_id = p_customer_id;
      get diagnostics v_n = row_count;
    when 'all' then
      perform public.customer_forget(p_customer_id, 'all');
      update public.addresses set saved = false, label = null, recipient_name = null, recipient_phone = null,
        for_whom = null, is_default = false
      where customer_id = p_customer_id;
      update public.customers set language = null where id = p_customer_id;
      v_n := 1;
    else
      return jsonb_build_object('status', 'invalid');
  end case;
  insert into public.audit_log (table_name, row_id, action, actor_kind, reason, new_row)
  values ('customers', p_customer_id::text, 'UPDATE', 'whatsapp', 'memory forget: ' || p_part, jsonb_build_object('part', p_part));
  return jsonb_build_object('status', 'forgotten', 'part', p_part, 'rows', v_n);
end;
$$;

-- 4. The delivery address on every order (§39.6) and "for you or someone else?" (§22.1) --------------------------------
alter table public.baskets
  add column address_confirmed_at timestamptz,
  add column is_gift boolean not null default false,
  add column recipient_name text check (char_length(recipient_name) between 1 and 60),
  add column recipient_phone text check (recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column allergy_note text check (char_length(allergy_note) <= 200),
  add constraint baskets_gift_has_recipient check (not is_gift or (recipient_name is not null and recipient_phone is not null));

alter table public.orders
  add column is_gift boolean not null default false,
  add column recipient_name text check (char_length(recipient_name) between 1 and 60),
  add column recipient_phone text check (recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column allergy_note text check (char_length(allergy_note) <= 200),
  add column credit_usd numeric(10, 2) not null default 0 check (credit_usd >= 0), -- the part of discount_usd paid by customer credits
  add column customer_messages smallint not null default 0 check (customer_messages >= 0);

-- The basket's address counts as confirmed by a tap, or by a pin sent after the basket opened or within address_fresh_minutes.
create function app_private.basket_address_confirmed(p_basket_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select b.address_confirmed_at is not null
    or coalesce(a.pinned_at >= least(b.created_at, now() - make_interval(mins => public.config_numeric('address_fresh_minutes')::int)), false)
  from public.baskets b left join public.addresses a on a.id = b.address_id
  where b.id = p_basket_id
$$;

-- What checkout must ask before the quote: nothing, "deliver here or somewhere else?", or "for you or someone else?".
-- A pin sent while ordering (within address_fresh_minutes, or after the basket opened) is the confirmation itself.
create function public.basket_address_state(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_a public.addresses%rowtype;
begin
  select * into v_b from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if v_b.fulfilment <> 'delivery' then
    return jsonb_build_object('status', 'ok', 'reason', 'pickup');
  end if;
  select * into v_a from public.addresses where id = v_b.address_id and customer_id = p_customer_id;
  if v_a.id is null or v_a.pin is null then
    return jsonb_build_object('status', 'no_address');
  end if;
  if v_b.address_confirmed_at is null and app_private.basket_address_confirmed(v_b.id) then
    update public.baskets set address_confirmed_at = now() where id = v_b.id;
    v_b.address_confirmed_at := now();
  end if;
  if v_b.address_confirmed_at is null then
    return jsonb_build_object('status', 'confirm', 'address', public.address_card(v_a.id), 'address_id', v_a.id,
      'label', v_a.label, 'recipient_name', v_a.recipient_name,
      'others', coalesce((select jsonb_agg(jsonb_build_object('address_id', a.id, 'card', public.address_card(a.id), 'label', a.label,
          'recipient_name', a.recipient_name) order by a.last_used_at desc nulls last)
        from (select * from public.addresses a where a.customer_id = p_customer_id and a.saved and a.id <> v_a.id and a.pin is not null
              order by a.last_used_at desc nulls last limit 8) a), '[]'));
  end if;
  -- §22.1: who is it for, asked once per address that is not one of the customer's own saved ones.
  if v_a.for_whom is null and not v_a.saved then
    return jsonb_build_object('status', 'for_whom', 'address', public.address_card(v_a.id), 'address_id', v_a.id);
  end if;
  if v_a.for_whom = 'other' and not v_b.is_gift then
    if v_a.recipient_phone is null then
      return jsonb_build_object('status', 'recipient', 'address_id', v_a.id);
    end if;
    update public.baskets set is_gift = true, recipient_name = v_a.recipient_name, recipient_phone = v_a.recipient_phone
    where id = v_b.id;
  end if;
  return jsonb_build_object('status', 'ok', 'gift', v_a.for_whom = 'other', 'recipient_name', v_a.recipient_name,
    'address_id', v_a.id, 'address', public.address_card(v_a.id));
end;
$$;

-- The customer's tap on "deliver here" or on another saved address.
create function public.basket_confirm_address(p_customer_id uuid, p_address_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.addresses%rowtype;
begin
  select * into v_a from public.addresses where id = p_address_id and customer_id = p_customer_id and pin is not null;
  if v_a.id is null then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  update public.baskets set address_id = v_a.id, address_confirmed_at = now(), last_activity_at = now(),
    is_gift = coalesce(v_a.for_whom = 'other' and v_a.recipient_phone is not null, false),
    recipient_name = case when v_a.for_whom = 'other' then v_a.recipient_name end,
    recipient_phone = case when v_a.for_whom = 'other' then v_a.recipient_phone end
  where customer_id = p_customer_id and status = 'open';
  if not found then
    return jsonb_build_object('status', 'no_basket');
  end if;
  update public.addresses set last_used_at = now() where id = v_a.id;
  return jsonb_build_object('status', 'confirmed', 'address', public.address_card(v_a.id));
end;
$$;

-- The answer to "for you or someone else?": for me (keep the address or not), or someone else (asks who next).
create function public.address_set_for_whom(p_customer_id uuid, p_address_id uuid, p_for_whom text, p_save boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_for_whom not in ('self', 'other') then
    return jsonb_build_object('status', 'invalid');
  end if;
  update public.addresses set for_whom = p_for_whom, saved = coalesce(p_save, saved),
    is_default = case when p_save and p_for_whom = 'self'
                      then not exists (select 1 from public.addresses x where x.customer_id = p_customer_id and x.saved and x.is_default and x.id <> p_address_id)
                      else is_default end
  where id = p_address_id and customer_id = p_customer_id;
  if not found then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  if p_for_whom = 'self' then
    update public.baskets set is_gift = false, recipient_name = null, recipient_phone = null
    where customer_id = p_customer_id and status = 'open';
  end if;
  return jsonb_build_object('status', 'saved', 'for_whom', p_for_whom);
end;
$$;

-- Who the order is for: a name and a WhatsApp number (§22.1). The address is kept in the sender's address book with
-- them (§22.2 scenario 11). The recipient's number is never used for anything but their orders (§22.3).
create function public.address_set_recipient(p_customer_id uuid, p_address_id uuid, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text;
begin
  select phone_e164 into v_me from public.customers where id = p_customer_id;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('status', 'bad_phone');
  end if;
  if p_phone = v_me then
    return jsonb_build_object('status', 'own_number');
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('status', 'no_name');
  end if;
  update public.addresses set for_whom = 'other', saved = true, recipient_name = left(trim(p_name), 60),
    recipient_phone = p_phone, label = left(trim(p_name), 40)
  where id = p_address_id and customer_id = p_customer_id;
  if not found then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  update public.baskets set is_gift = true, recipient_name = left(trim(p_name), 60), recipient_phone = p_phone,
    address_id = p_address_id, address_confirmed_at = coalesce(address_confirmed_at, now())
  where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', 'saved', 'name', left(trim(p_name), 60));
end;
$$;

-- A consented allergy note travels to the merchant on that order only (§39.6); the customer sees it on the summary.
create function public.basket_set_allergy_note(p_customer_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  update public.baskets set allergy_note = left(nullif(trim(coalesce(p_note, '')), ''), 200)
  where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', case when found then 'saved' else 'no_basket' end);
end;
$$;

-- An address chosen explicitly at checkout is confirmed for this basket.
create or replace function public.basket_set_checkout(p_customer_id uuid, p_fulfilment public.fulfilment_kind default null,
  p_address_id uuid default null, p_stairs_floors integer default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open' for update;
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  if p_address_id is not null and not exists (select 1 from public.addresses a where a.id = p_address_id and a.customer_id = p_customer_id) then
    return jsonb_build_object('status', 'unknown_address');
  end if;
  update public.baskets set
    fulfilment = coalesce(p_fulfilment, fulfilment),
    address_id = coalesce(p_address_id, address_id),
    address_confirmed_at = case when p_address_id is not null then now() else address_confirmed_at end,
    stairs_floors = case when p_stairs_floors is null then stairs_floors when p_stairs_floors <= 0 then null else least(p_stairs_floors, 30) end,
    customer_note = coalesce(left(nullif(trim(p_note), ''), 300), customer_note),
    last_activity_at = now()
  where id = v_basket.id;
  if p_address_id is not null then
    update public.addresses set last_used_at = now() where id = p_address_id;
  end if;
  return jsonb_build_object('status', 'updated', 'basket', public.basket_view(p_customer_id));
end;
$$;

-- A new pin is a one-time address until the customer says to keep it (§39.6); the rest is address_save_pin as in T3.
create or replace function public.address_save_pin(p_customer_id uuid, p_lat double precision, p_lon double precision,
  p_label text default null, p_building text default null, p_floor text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pt extensions.geography;
  v_place record;
  v_place_id text;
  v_test_place text := (select p.id from public.places p where p.id = 'LB-TST-LOCATION' and p.source = 'test'
                          and exists (select 1 from public.vendors v where v.is_test));
  v_id uuid;
  v_new boolean := false;
begin
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  if (p_lat not between 33.0 and 34.8 or p_lon not between 35.0 and 36.7) and v_test_place is null then
    return jsonb_build_object('status', 'outside_lebanon');
  end if;
  v_pt := app_private.lat_lon_point(p_lat, p_lon);
  select a.id into v_id from public.addresses a
  where a.customer_id = p_customer_id and a.pin is not null and extensions.st_dwithin(a.pin, v_pt, 30)
  order by a.saved desc, a.pin operator(extensions.<->) v_pt limit 1;
  if v_id is null then
    if p_lat between 33.0 and 34.8 and p_lon between 35.0 and 36.7 then
      select * into v_place from public.place_for_point(v_pt);
      v_place_id := v_place.place_id;
    end if;
    if v_test_place is not null and v_place_id is not null
       and (select p.service_status from public.places p where p.id = v_place_id) = 'paused' then
      v_place_id := null;
    end if;
    v_place_id := coalesce(v_place_id, v_test_place);
    if v_place_id is null then
      return jsonb_build_object('status', 'no_place');
    end if;
    insert into public.addresses (customer_id, label, place_id, pin, source, building_text, floor, note, is_default, saved)
    values (p_customer_id, left(nullif(trim(p_label), ''), 40), v_place_id, v_pt, 'pin', left(nullif(trim(p_building), ''), 120),
      left(nullif(trim(p_floor), ''), 20), left(nullif(trim(p_note), ''), 300), false, false)
    returning id into v_id;
    v_new := true;
  end if;
  update public.addresses set last_used_at = now(), pinned_at = now() where id = v_id;
  -- Sending a pin while ordering is the confirmation of the address for that basket (§39.6).
  update public.baskets set address_id = v_id, last_activity_at = now(), address_confirmed_at = now()
  where customer_id = p_customer_id and status = 'open';
  return jsonb_build_object('status', 'saved', 'new', v_new, 'address', public.address_card(v_id));
end;
$$;

-- 5. Gift orders (§22.2 scenarios 5 and 7) --------------------------------------------------------------------------------
-- Payment from abroad (card, Whish) is Phase 6. Until then a gift order is cash on delivery and starts only when the
-- recipient taps "Accept and pay on delivery" on WhatsApp; this prevents prank and harassment orders (§22.2 scenario 7).
alter table public.customers add column gift_blocked_at timestamptz;
comment on column public.customers.gift_blocked_at is 'STOP from this number also blocks gift messages from other senders (DECISIONS §22.3).';

create table public.gift_requests (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.baskets (id) on delete cascade,
  sender_id uuid not null references public.customers (id) on delete cascade,
  recipient_phone text not null check (recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  recipient_name text not null check (char_length(recipient_name) between 1 and 60),
  menu_version bigint not null,
  total_usd numeric(10, 2) not null,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'failed', 'unreachable')),
  order_id uuid references public.orders (id) on delete set null,
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index gift_requests_one_pending on public.gift_requests (basket_id) where status = 'pending';
create index gift_requests_recipient_idx on public.gift_requests (recipient_phone, status);
create index gift_requests_sender_idx on public.gift_requests (sender_id, recipient_phone, created_at);
alter table public.gift_requests enable row level security;
revoke all on table public.gift_requests from public, anon, authenticated;
grant all on table public.gift_requests to service_role;
grant select on table public.gift_requests to authenticated;
create policy gift_requests_operator_read on public.gift_requests for select to authenticated using ((select app_private.is_operator()));

-- What the recipient is shown and accepts: the quoted lines, total, address, recipient and payment. gift_respond places the
-- order only when the basket still quotes to the same fingerprint, so the sender cannot change it after asking.
create function app_private.gift_fingerprint(p_basket_id uuid, p_quote jsonb) returns text
language sql stable security definer set search_path = ''
as $$
  select md5(jsonb_build_object('lines', p_quote -> 'basket' -> 'lines', 'total', p_quote -> 'total_usd',
    'address', b.address_id, 'fulfilment', b.fulfilment, 'stairs', b.stairs_floors, 'pay', b.payment_method,
    'currency', b.cash_currency, 'gift', b.is_gift, 'recipient', b.recipient_phone, 'name', b.recipient_name)::text)
  from public.baskets b where b.id = p_basket_id;
$$;

-- The sender's Confirm tap on a gift basket: checks the order could be placed now (same rules as order_place, by quoting),
-- then asks the recipient. Nothing is ordered or charged yet. A repeated tap on an unchanged basket does not ask again,
-- and one sender asks one number at most gift_requests_per_day times a day (no harassment, §22.2 scenario 7).
create function public.gift_request_create(p_customer_id uuid, p_basket_id uuid, p_menu_version bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_r public.customers%rowtype;
  v_q jsonb;
  v_id uuid;
  v_sender public.customers%rowtype;
  v_fp text;
  v_pending public.gift_requests%rowtype;
begin
  select * into v_b from public.baskets where id = p_basket_id and customer_id = p_customer_id and status = 'open' for update;
  if v_b.id is null or not v_b.is_gift then
    return jsonb_build_object('status', 'not_gift');
  end if;
  if v_b.priced_menu_version is distinct from p_menu_version then
    return jsonb_build_object('status', 'repriced');
  end if;
  v_q := public.basket_quote(p_customer_id);
  if v_q ->> 'status' <> 'ok' then
    return jsonb_build_object('status', v_q ->> 'status');
  end if;
  if (v_q ->> 'over_cod_cap')::boolean then
    return jsonb_build_object('status', 'cod_cap');
  end if;
  select * into v_r from public.customers where phone_e164 = v_b.recipient_phone;
  if v_r.gift_blocked_at is not null then
    return jsonb_build_object('status', 'blocked');
  end if;
  -- Outside WhatsApp's 24-hour window only an approved utility template reaches the recipient (5b, §22.3).
  if v_r.id is null or v_r.last_inbound_at is null or v_r.last_inbound_at < now() - interval '24 hours' then
    return jsonb_build_object('status', 'unreachable', 'recipient_name', v_b.recipient_name);
  end if;
  v_fp := app_private.gift_fingerprint(v_b.id, v_q);
  select * into v_pending from public.gift_requests
  where basket_id = v_b.id and status = 'pending' and expires_at > now() for update;
  if v_pending.id is not null and v_pending.fingerprint = v_fp then
    return jsonb_build_object('status', 'asked', 'gift_id', v_pending.id, 'recipient_name', v_pending.recipient_name,
      'minutes', greatest(1, ceil(extract(epoch from v_pending.expires_at - now()) / 60)), 'again', true);
  end if;
  if (select count(*) from public.gift_requests
      where sender_id = p_customer_id and recipient_phone = v_b.recipient_phone
        and created_at > now() - interval '24 hours') >= public.config_numeric('gift_requests_per_day') then
    return jsonb_build_object('status', 'too_many', 'recipient_name', v_b.recipient_name);
  end if;
  update public.gift_requests set status = 'expired', decided_at = now() where basket_id = v_b.id and status = 'pending';
  select * into v_sender from public.customers where id = p_customer_id;
  insert into public.gift_requests (basket_id, sender_id, recipient_phone, recipient_name, menu_version, total_usd, fingerprint, expires_at)
  values (v_b.id, p_customer_id, v_b.recipient_phone, v_b.recipient_name, p_menu_version, (v_q ->> 'total_usd')::numeric, v_fp,
          now() + make_interval(mins => public.config_numeric('gift_accept_minutes')::int))
  returning id into v_id;
  perform app_private.outbox_add('gift:' || v_id, null, v_b.vendor_id, 'whatsapp', 'customer_message', v_b.recipient_phone,
    jsonb_build_object('kind', 'gift_request', 'lang', coalesce(v_r.language::text, 'ar'), 'gift_id', v_id,
      'sender', coalesce(v_sender.display_name, ''), 'vendor', v_q -> 'basket' ->> 'vendor', 'vendor_en', v_q -> 'basket' ->> 'vendor_en',
      'lines', (select jsonb_agg(jsonb_build_object('q', l -> 'quantity', 'name', l ->> 'name', 'name_en', l ->> 'name_en'))
                from jsonb_array_elements(v_q -> 'basket' -> 'lines') l),
      'total_usd', v_q -> 'total_usd', 'total_lbp', v_q -> 'total_lbp', 'usd_lbp_rate', v_q -> 'usd_lbp_rate',
      'place', v_q -> 'address' ->> 'place', 'place_en', v_q -> 'address' ->> 'place_en'));
  return jsonb_build_object('status', 'asked', 'gift_id', v_id, 'recipient_name', v_b.recipient_name,
    'minutes', public.config_numeric('gift_accept_minutes'));
end;
$$;

-- The recipient's tap. Only the number the gift was sent to can answer; "accept" places the sender's order exactly as
-- quoted: the basket must still be open, still a gift and still quote to the fingerprint the recipient was shown, and
-- order_place re-checks everything else (menu version, cash cap). Any failure ends the request as failed and tells the
-- sender; it never aborts the recipient's turn.
create function public.gift_respond(p_phone_e164 text, p_gift_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_g public.gift_requests%rowtype;
  v_r jsonb;
  v_sender text;
  v_b public.baskets%rowtype;
  v_q jsonb;
begin
  select * into v_g from public.gift_requests where id = p_gift_id for update;
  if v_g.id is null or v_g.recipient_phone <> p_phone_e164 then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_g.status <> 'pending' then
    return jsonb_build_object('status', 'already_' || v_g.status);
  end if;
  select phone_e164 into v_sender from public.customers where id = v_g.sender_id;
  if v_g.expires_at <= now() then
    update public.gift_requests set status = 'expired', decided_at = now() where id = v_g.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if not p_accept then
    update public.gift_requests set status = 'declined', decided_at = now() where id = v_g.id;
    perform app_private.outbox_add('gift-answer:' || v_g.id, null, null, 'whatsapp', 'customer_message', v_sender,
      jsonb_build_object('kind', 'gift_declined', 'lang', (select coalesce(language::text, 'ar') from public.customers where id = v_g.sender_id),
        'recipient_name', v_g.recipient_name));
    return jsonb_build_object('status', 'declined');
  end if;
  select * into v_b from public.baskets where id = v_g.basket_id for update;
  if v_b.id is null or v_b.status <> 'open' or not v_b.is_gift then
    v_r := jsonb_build_object('status', 'changed');
  else
    v_q := public.basket_quote(v_g.sender_id);
    if v_q ->> 'status' <> 'ok' then
      v_r := jsonb_build_object('status', v_q ->> 'status');
    elsif app_private.gift_fingerprint(v_b.id, v_q) <> v_g.fingerprint then
      v_r := jsonb_build_object('status', 'changed');
    else
      begin
        v_r := public.order_place(v_g.basket_id, v_g.menu_version, 'gift:' || v_g.id);
      exception when others then
        v_r := jsonb_build_object('status', 'failed');
      end;
    end if;
  end if;
  if v_r ->> 'status' = 'placed' then
    update public.gift_requests set status = 'accepted', decided_at = now(), order_id = (v_r ->> 'order_id')::uuid where id = v_g.id;
    perform app_private.outbox_add('gift-answer:' || v_g.id, (v_r ->> 'order_id')::uuid, null, 'whatsapp', 'customer_message', v_sender,
      jsonb_build_object('kind', 'gift_accepted', 'lang', (select coalesce(language::text, 'ar') from public.customers where id = v_g.sender_id),
        'recipient_name', v_g.recipient_name, 'code', v_r ->> 'code'));
  else
    update public.gift_requests set status = 'failed', decided_at = now() where id = v_g.id;
    perform app_private.outbox_add('gift-answer:' || v_g.id, null, null, 'whatsapp', 'customer_message', v_sender,
      jsonb_build_object('kind', 'gift_failed', 'lang', (select coalesce(language::text, 'ar') from public.customers where id = v_g.sender_id),
        'recipient_name', v_g.recipient_name, 'reason', v_r ->> 'status'));
  end if;
  return v_r || jsonb_build_object('recipient', true,
    'sender', coalesce((select display_name from public.customers where id = v_g.sender_id), ''));
end;
$$;

-- Unanswered gift requests expire; the sender hears it once. Runs with the monitor tick.
create function app_private.gift_requests_expire() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_g record;
  v_n integer := 0;
begin
  for v_g in
    update public.gift_requests set status = 'expired', decided_at = now()
    where status = 'pending' and expires_at <= now()
    returning *
  loop
    perform app_private.outbox_add('gift-answer:' || v_g.id, null, null, 'whatsapp', 'customer_message',
      (select phone_e164 from public.customers where id = v_g.sender_id),
      jsonb_build_object('kind', 'gift_expired', 'lang', (select coalesce(language::text, 'ar') from public.customers where id = v_g.sender_id),
        'recipient_name', v_g.recipient_name));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
select cron.schedule('gift-expire', '* * * * *', $$select app_private.gift_requests_expire()$$);

-- The kitchen's allergy note for a basket: one typed on the basket, else the customer's consented allergy from memory.
-- Never the sender's own allergy on a gift for someone else (health data only where the order needs it, §39.6).
create function app_private.basket_allergy_note(p_basket_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(b.allergy_note,
    case when not b.is_gift then (select p.value from public.customer_preferences p
      where p.customer_id = b.customer_id and p.key = 'allergy' and p.consented_at is not null) end)
  from public.baskets b where b.id = p_basket_id;
$$;

-- Gift and allergy details travel from the basket to the order (no money here; order_place prices).
create function app_private.orders_copy_customer_agent() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.basket_id is not null then
    select b.is_gift, b.recipient_name, b.recipient_phone, app_private.basket_allergy_note(b.id)
      into new.is_gift, new.recipient_name, new.recipient_phone, new.allergy_note
    from public.baskets b where b.id = new.basket_id;
    new.is_gift := coalesce(new.is_gift, false);
  end if;
  return new;
end;
$$;
create trigger orders_copy_customer_agent before insert on public.orders
  for each row execute function app_private.orders_copy_customer_agent();

-- The merchant's order card shows a gift's recipient (the driver reaches them, §22.2 scenario 12) and the allergy note.
create or replace function app_private.order_card_payload(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id, 'code', o.code, 'status', o.status, 'fulfilment', o.fulfilment,
    'payment_method', o.payment_method, 'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'), 'is_new_customer', o.is_new_customer,
    'customer_note', o.customer_note, 'prep_minutes', o.prep_minutes,
    'is_gift', o.is_gift, 'recipient_name', o.recipient_name, 'recipient_phone', o.recipient_phone, 'allergy_note', o.allergy_note,
    'area_en', p.name_en, 'area_ar', p.name_ar,
    'vendor_name', coalesce(v.name_ar, v.name_en),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', i.name_en,
        'quantity', i.quantity, 'options', (select coalesce(jsonb_agg(coalesce(x ->> 'name_ar', x ->> 'name_en')), '[]') from jsonb_array_elements(i.options) x),
        'kg', i.est_weight_kg, 'has_empty', i.has_empty, 'note', i.note) order by i.created_at, i.id)
      from public.order_items i where i.order_id = o.id), '[]')
  )
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  left join public.places p on p.id = o.delivery_place_id
  where o.id = p_order_id;
$$;

-- STOP also blocks gift messages to this number (§22.3); START lifts it.
create or replace function public.customer_marketing_set(p_customer_id uuid, p_opt_in boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_opt_in then
    update public.customers set marketing_opt_in = true, marketing_opt_in_at = now(), gift_blocked_at = null where id = p_customer_id;
  else
    update public.customers set marketing_opt_in = false, marketing_opt_out_at = now(), gift_blocked_at = now() where id = p_customer_id;
  end if;
  return jsonb_build_object('marketing_opt_in', p_opt_in);
end;
$$;

-- 6. Stairs rule and credits in the quote and the order --------------------------------------------------------------------
-- The §38.3 stairs surcharge, charged only when the shop offers carrying upstairs (stairs_fee_per_floor_usd set) and the
-- customer gave the floors (so it is always on the summary before Confirm, §29.2). E = 0 with a working lift.
create function app_private.stairs_fee_usd(p_basket_id uuid) returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_b public.baskets%rowtype;
  v_r jsonb := public.config_value('stairs_fee_rule');
  v_lift boolean;
  v_heavy integer;
begin
  select * into v_b from public.baskets where id = p_basket_id;
  if v_b.id is null or v_b.fulfilment <> 'delivery' or v_b.stairs_floors is null
     or (select v.stairs_fee_per_floor_usd from public.vendors v where v.id = v_b.vendor_id) is null then
    return 0;
  end if;
  select a.has_elevator into v_lift from public.addresses a where a.id = v_b.address_id;
  select coalesce(sum(bi.quantity), 0) into v_heavy from public.basket_items bi join public.menu_items i on i.id = bi.item_id
  where bi.basket_id = v_b.id and i.container_deposit_usd is not null;
  return round(
    least((v_r ->> 'cap_usd')::numeric,
          (v_r ->> 'per_floor_usd')::numeric * greatest(0, v_b.stairs_floors - (v_r ->> 'free_floors')::int)
            * case when coalesce(v_lift, false) then 0 else 1 end)
    + (v_r ->> 'heavy_unit_usd')::numeric * greatest(0, v_heavy - (v_r ->> 'heavy_free_units')::int), 2);
end;
$$;

-- Credits that fit in a basket's food subtotal, soonest to expire first, each used whole; a credit too large for what
-- is left is skipped, and a smaller later one still applies.
create function app_private.credits_for(p_customer_id uuid, p_subtotal numeric) returns table (credit_id uuid, amount_usd numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_left numeric := coalesce(p_subtotal, 0);
  v_c record;
begin
  for v_c in
    select cc.id, cc.amount_usd from public.customer_credits cc
    where cc.customer_id = p_customer_id and cc.used_order_id is null and cc.expires_at > now()
    order by cc.expires_at, cc.id
  loop
    if v_c.amount_usd <= v_left then
      credit_id := v_c.id;
      amount_usd := v_c.amount_usd;
      v_left := v_left - v_c.amount_usd;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.basket_quote(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_view jsonb;
  v_route record;
  v_quote record;
  v_subtotal numeric;
  v_deposit numeric;
  v_stairs numeric := 0;
  v_fee numeric := 0;
  v_credit numeric := 0;
  v_total numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_new boolean;
  v_cap numeric;
  v_road numeric;
  v_test boolean;
begin
  select * into v_basket from public.baskets where customer_id = p_customer_id and status = 'open';
  if v_basket.id is null then
    return jsonb_build_object('status', 'no_basket');
  end if;
  v_view := public.basket_view(p_customer_id);
  if jsonb_array_length(v_view -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  select * into v_vendor from public.vendors where id = v_basket.vendor_id;
  v_test := app_private.vendor_is_test(v_vendor.id);
  v_subtotal := (v_view ->> 'subtotal_usd')::numeric;
  select coalesce(sum(case when (l ->> 'has_empty')::boolean is false then (l ->> 'deposit_usd')::numeric * (l ->> 'quantity')::int else 0 end), 0)
    into v_deposit from jsonb_array_elements(v_view -> 'lines') l;
  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address', 'basket', v_view);
    end if;
    if v_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road := 0;
      v_fee := v_quote.fee_usd;
    else
      if not app_private.place_delivered_to(v_address.place_id) then
        return jsonb_build_object('status', 'place_paused', 'basket', v_view);
      end if;
      select * into v_route from public.route_cache_lookup(
        extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
        array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]);
      if v_route.distance_m is null then
        return jsonb_build_object('status', 'no_route', 'basket', v_view,
          'origin', jsonb_build_object('lat', extensions.st_y(v_vendor.location::extensions.geometry), 'lon', extensions.st_x(v_vendor.location::extensions.geometry)),
          'dest', jsonb_build_object('lat', extensions.st_y(v_address.pin::extensions.geometry), 'lon', extensions.st_x(v_address.pin::extensions.geometry)));
      end if;
      select * into v_quote from public.delivery_quote(v_vendor.id, round(v_route.distance_m / 1000.0, 2));
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason, 'basket', v_view, 'limit_km', v_quote.limit_km,
          'road_km', v_quote.road_km, 'pickup_enabled', v_vendor.pickup_enabled);
      end if;
      v_road := round(v_route.distance_m / 1000.0, 2);
      v_fee := v_quote.fee_usd;
    end if;
    v_stairs := app_private.stairs_fee_usd(v_basket.id);
  end if;
  select coalesce(sum(c.amount_usd), 0) into v_credit from app_private.credits_for(p_customer_id, v_subtotal) c;
  v_total := v_subtotal + v_fee + v_deposit + v_stairs - v_credit;
  v_new := not exists (select 1 from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered');
  v_cap := public.config_numeric('cod_cap_usd');
  if v_new then
    v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
  end if;
  return jsonb_build_object('status', 'ok', 'basket', v_view, 'subtotal_usd', v_subtotal, 'delivery_fee_usd', v_fee,
    'deposit_usd', v_deposit, 'stairs_fee_usd', v_stairs, 'credit_usd', v_credit, 'total_usd', v_total, 'usd_lbp_rate', v_rate,
    'total_lbp', round(v_total * v_rate, 0), 'road_km', v_road,
    'cod_cap_usd', v_cap, 'over_cod_cap', v_basket.payment_method = 'cod' and v_total > v_cap,
    'estimated', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'estimated')::boolean),
    'needs_empty_answer', exists (select 1 from jsonb_array_elements(v_view -> 'lines') l where (l ->> 'needs_empty_answer')::boolean),
    'stairs_fee_per_floor_usd', v_vendor.stairs_fee_per_floor_usd,
    'is_gift', v_basket.is_gift, 'recipient_name', v_basket.recipient_name, 'allergy_note', app_private.basket_allergy_note(v_basket.id),
    'address', case when v_address.id is not null then public.address_card(v_address.id) end);
end;
$$;

create or replace function public.order_place(p_basket_id uuid, p_expected_menu_version bigint, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.orders%rowtype;
  v_basket public.baskets%rowtype;
  v_vendor public.vendors%rowtype;
  v_address public.addresses%rowtype;
  v_place_status public.service_status;
  v_priced jsonb;
  v_rate numeric := public.usd_lbp_rate();
  v_road_km numeric;
  v_quote record;
  v_delivery_fee numeric := 0;
  v_deposit numeric := 0;
  v_stairs numeric := 0;
  v_credit numeric := 0;
  v_credit_ids uuid[] := '{}';
  v_subtotal numeric;
  v_total numeric;
  v_cap numeric;
  v_new_customer boolean;
  v_weighted boolean;
  v_order public.orders%rowtype;
  v_line record;
  v_low_threshold integer := public.config_numeric('daily_qty_low_threshold')::integer;
  v_low jsonb := '[]';
  v_remaining integer;
begin
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if v_existing.id is not null and v_existing.basket_id is distinct from p_basket_id then
    raise exception 'idempotency key already used for another basket' using errcode = 'unique_violation';
  end if;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
      'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
      'estimated', v_existing.weight_status <> 'none', 'repeat', true);
  end if;

  select * into v_basket from public.baskets where id = p_basket_id for update;
  if v_basket.id is null then
    raise exception 'unknown basket %', p_basket_id using errcode = 'no_data_found';
  end if;
  if v_basket.status <> 'open' then
    select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object('status', 'placed', 'order_id', v_existing.id, 'code', v_existing.code,
        'total_usd', v_existing.total_usd, 'total_lbp', v_existing.total_lbp, 'usd_lbp_rate', v_existing.usd_lbp_rate,
        'estimated', v_existing.weight_status <> 'none', 'repeat', true);
    end if;
    raise exception 'basket % is %', p_basket_id, v_basket.status using errcode = 'check_violation';
  end if;
  select * into v_vendor from public.vendors where id = v_basket.vendor_id for no key update;

  if not v_vendor.orderable or v_vendor.listing_status <> 'active' then
    return jsonb_build_object('status', 'vendor_closed');
  end if;
  if v_vendor.paused_until is not null and v_vendor.paused_until > now() then
    return jsonb_build_object('status', 'vendor_paused', 'until', v_vendor.paused_until);
  end if;
  if (v_basket.fulfilment = 'delivery' and not v_vendor.delivery_enabled)
     or (v_basket.fulfilment = 'pickup' and not v_vendor.pickup_enabled) then
    return jsonb_build_object('status', 'fulfilment_unavailable');
  end if;
  if v_basket.payment_method <> 'cod' and not coalesce((public.config_value('online_payments_enabled') #>> '{}')::boolean, false) then
    return jsonb_build_object('status', 'online_payment_off');
  end if;
  -- A gift is placed only from the recipient's acceptance (gift_respond), never from the sender's own Confirm tap.
  if v_basket.is_gift and p_idempotency_key not like 'gift:%' then
    return jsonb_build_object('status', 'gift_needs_recipient');
  end if;
  -- The delivery address is confirmed on every order (§39.6).
  if v_basket.fulfilment = 'delivery' and not app_private.basket_address_confirmed(v_basket.id) then
    return jsonb_build_object('status', 'address_unconfirmed');
  end if;

  if v_vendor.menu_version <> p_expected_menu_version or v_basket.priced_menu_version is distinct from p_expected_menu_version then
    v_priced := public.basket_price(p_basket_id);
    return jsonb_build_object('status', case when jsonb_array_length(v_priced -> 'unavailable') > 0 then 'unavailable' else 'repriced' end,
      'summary', v_priced);
  end if;
  v_priced := public.basket_price(p_basket_id);
  if jsonb_array_length(v_priced -> 'unavailable') > 0 then
    return jsonb_build_object('status', 'unavailable', 'summary', v_priced);
  end if;
  if jsonb_array_length(v_priced -> 'lines') = 0 then
    return jsonb_build_object('status', 'empty_basket');
  end if;
  if exists (
    select 1 from public.basket_items bi join public.menu_items i on i.id = bi.item_id
    where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null
  ) then
    return jsonb_build_object('status', 'needs_empty_answer', 'items', (
      select jsonb_agg(bi.item_id) from public.basket_items bi join public.menu_items i on i.id = bi.item_id
      where bi.basket_id = p_basket_id and i.container_deposit_usd is not null and bi.has_empty is null));
  end if;
  v_subtotal := (v_priced ->> 'subtotal_usd')::numeric;
  select coalesce(sum((l ->> 'container_deposit_usd')::numeric), 0), bool_or((l ->> 'estimated')::boolean)
    into v_deposit, v_weighted from jsonb_array_elements(v_priced -> 'lines') l;

  if v_basket.fulfilment = 'delivery' then
    select * into v_address from public.addresses where id = v_basket.address_id and customer_id = v_basket.customer_id;
    if v_address.id is null or v_address.pin is null then
      return jsonb_build_object('status', 'no_address');
    end if;
    if v_vendor.is_test then
      select * into v_quote from public.delivery_quote(v_vendor.id, 0);
      v_road_km := 0;
    else
      select p.service_status into v_place_status from public.places p where p.id = v_address.place_id;
      if v_place_status is distinct from 'on' then
        return jsonb_build_object('status', 'place_paused');
      end if;
      select c.distance_m / 1000.0 into v_road_km
      from public.route_cache_lookup(
        extensions.st_y(v_vendor.location::extensions.geometry), extensions.st_x(v_vendor.location::extensions.geometry),
        array[extensions.st_y(v_address.pin::extensions.geometry)], array[extensions.st_x(v_address.pin::extensions.geometry)]) c;
      select * into v_quote from public.delivery_quote(v_vendor.id, round(v_road_km, 2));
      if not v_quote.deliverable then
        return jsonb_build_object('status', v_quote.reason);
      end if;
    end if;
    v_delivery_fee := v_quote.fee_usd;
    -- §38.3 rule from config; the merchant's per-floor field only says that it carries upstairs.
    v_stairs := app_private.stairs_fee_usd(v_basket.id);
  end if;

  -- Customer credits (disputes, §38.3): a discount on this order, each credit used whole.
  select coalesce(sum(c.amount_usd), 0), coalesce(array_agg(c.credit_id), '{}') into v_credit, v_credit_ids
  from app_private.credits_for(v_basket.customer_id, v_subtotal) c;

  v_total := v_subtotal + v_delivery_fee + v_deposit + v_stairs - v_credit;

  v_new_customer := not exists (
    select 1 from public.orders o where o.customer_id = v_basket.customer_id and o.status = 'delivered'
  );
  if v_basket.payment_method = 'cod' then
    v_cap := public.config_numeric('cod_cap_usd');
    if v_new_customer then
      v_cap := least(v_cap, public.config_numeric('cod_cap_new_number_usd'));
    end if;
    if v_total > v_cap then
      return jsonb_build_object('status', 'cod_cap', 'cap_usd', v_cap, 'total_usd', v_total, 'new_customer', v_new_customer);
    end if;
  end if;

  for v_line in
    select q.item_id, sum(q.quantity)::integer as quantity
    from (
      select bi.item_id, bi.quantity from public.basket_items bi where bi.basket_id = p_basket_id
      union all
      select c.component_item_id, c.quantity * bi.quantity from public.basket_items bi
      join public.menu_combo_components c on c.combo_item_id = bi.item_id where bi.basket_id = p_basket_id
    ) q
    group by q.item_id
    order by q.item_id
  loop
    update public.menu_items i
    set daily_remaining = i.daily_remaining - v_line.quantity
    where i.id = v_line.item_id and i.daily_remaining is not null and i.daily_date = current_date
      and i.daily_remaining >= v_line.quantity
    returning i.daily_remaining into v_remaining;
    if not found then
      if exists (select 1 from public.menu_items i where i.id = v_line.item_id and i.daily_remaining is not null
                 and i.daily_date = current_date) then
        raise exception 'sold_out: item %', v_line.item_id using errcode = 'check_violation';
      end if;
    else
      if v_remaining <= v_low_threshold then
        v_low := v_low || jsonb_build_object('item_id', v_line.item_id, 'remaining', v_remaining);
      end if;
    end if;
  end loop;

  insert into public.orders (
    code, idempotency_key, basket_id, customer_id, vendor_id, status, fulfilment, delivery_mode, payment_method,
    address_id, delivery_place_id, delivery_pin, road_km, menu_version, usd_lbp_rate, food_subtotal_usd,
    delivery_fee_usd, container_deposit_usd, stairs_floors, stairs_fee_usd, credit_usd, discount_usd, total_usd, order_fee_usd, weight_status,
    estimated_total_usd, is_new_customer, customer_note, prep_minutes, placed_at
  ) values (
    app_private.new_order_code(), p_idempotency_key, v_basket.id, v_basket.customer_id, v_vendor.id,
    case when v_basket.payment_method = 'cod' then 'placed' else 'awaiting_payment' end::public.order_status,
    v_basket.fulfilment, case when v_basket.fulfilment = 'delivery' then 'merchant'::public.delivery_mode end,
    v_basket.payment_method, v_address.id, v_address.place_id, v_address.pin, round(v_road_km, 2), v_vendor.menu_version,
    v_rate, v_subtotal, v_delivery_fee, v_deposit, case when v_stairs > 0 then v_basket.stairs_floors end, v_stairs, v_credit, v_credit, v_total,
    public.order_fee_usd(v_vendor.id, v_subtotal), case when v_weighted then 'awaiting_weight' else 'none' end::public.weight_status,
    case when v_weighted then v_total end, v_new_customer, v_basket.customer_note, v_vendor.default_prep_minutes,
    case when v_basket.payment_method = 'cod' then now() end
  ) returning * into v_order;

  if cardinality(v_credit_ids) > 0 then
    update public.customer_credits set used_order_id = v_order.id where id = any (v_credit_ids);
  end if;

  insert into public.order_items (order_id, item_id, name_ar, name_en, name_fr, quantity, pricing_unit, unit_price_usd,
    options, options_total_usd, est_weight_kg, price_per_kg_usd, line_total_usd, container_deposit_usd, has_empty, note)
  select v_order.id, i.id, i.name_ar, i.name_en, i.name_fr, bi.quantity, i.pricing_unit,
    case when i.pricing_unit = 'kg' then round(i.price_usd * i.est_weight_kg, 2) else i.price_usd end,
    coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name_ar', o.name_ar, 'name_en', o.name_en,
      'price_delta_usd', o.price_delta_usd) order by o.sort_order) from public.menu_options o where o.id = any (bi.option_ids)), '[]'),
    coalesce((select sum(o.price_delta_usd) from public.menu_options o where o.id = any (bi.option_ids)), 0),
    case when i.pricing_unit = 'kg' then i.est_weight_kg * bi.quantity end,
    case when i.pricing_unit = 'kg' then i.price_usd end,
    bi.line_total_usd,
    case when i.container_deposit_usd is not null and bi.has_empty is false then i.container_deposit_usd * bi.quantity else 0 end,
    case when i.container_deposit_usd is not null then bi.has_empty end,
    bi.note
  from public.basket_items bi join public.menu_items i on i.id = bi.item_id
  where bi.basket_id = p_basket_id;

  update public.baskets set status = 'ordered' where id = p_basket_id;
  insert into public.order_events (order_id, from_status, to_status, event, actor_kind, detail)
  values (v_order.id, null, v_order.status, 'placed', app_private.current_actor_kind(),
          jsonb_build_object('menu_version', v_order.menu_version, 'low_stock', v_low, 'credit_usd', v_credit));

  return jsonb_build_object('status', 'placed', 'order_id', v_order.id, 'code', v_order.code,
    'total_usd', v_order.total_usd, 'total_lbp', v_order.total_lbp, 'usd_lbp_rate', v_order.usd_lbp_rate,
    'estimated', v_weighted, 'new_customer', v_new_customer, 'low_stock', v_low, 'credit_usd', v_credit);
end;
$$;

-- Credits used by an order that never reaches the customer come back; on delivery the ledger records that Alo King
-- owes the merchant the part the customer did not pay (the merchant collected the reduced cash total).
create function app_private.orders_credit_settle() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.credit_usd > 0 and new.status is distinct from old.status then
    if new.status in ('cancelled', 'rejected', 'failed') then
      update public.customer_credits set used_order_id = null where used_order_id = new.id;
    elsif new.status = 'delivered' then
      perform public.ledger_post('refund', 'credit-used:' || new.id,
        jsonb_build_array(
          jsonb_build_object('account_id', public.ledger_account('customer_refund_payable', 'USD'), 'amount', new.credit_usd,
            'memo', 'customer credit used on order ' || new.code),
          jsonb_build_object('account_id', public.ledger_account('merchant_payable', 'USD', new.vendor_id), 'amount', -new.credit_usd,
            'memo', 'credit paid on the customer''s behalf, order ' || new.code)),
        new.id, new.usd_lbp_rate, 'customer credit used');
    end if;
  end if;
  return null;
end;
$$;
create trigger orders_credit_settle after update of status on public.orders
  for each row execute function app_private.orders_credit_settle();

-- 7. Disputes and refunds (§20.1, §38.3) -------------------------------------------------------------------------------
-- Deterministic rules, inside §20's limits: automatic up to $8 when the customer's dispute rate is under 10%; cold food
-- by the delivery leg's time against 1.5 x the expected → 30% of the food as credit; preparation more than 15 min late
-- → the merchant pays; a damaged order → photo and a person (photo classification waits for API credit); anything
-- else → a person. Rasheed's tap above $20. Cash orders get a credit on a later order; online-paid orders are refunded to
-- the original payment in Phase 6, so they always go to a person now.
create table public.order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind text not null check (kind in ('missing_item', 'wrong_item', 'cold_food', 'late', 'damaged', 'other')),
  order_item_id uuid references public.order_items (id) on delete set null,
  amount_usd numeric(10, 2) not null default 0 check (amount_usd >= 0),
  payer text check (payer in ('merchant', 'alo_king')),
  decision text not null check (decision in ('auto_credit', 'review', 'owner_review', 'rejected', 'approved', 'remake')),
  rule text not null,
  ledger_tx uuid,
  credit_id uuid references public.customer_credits (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index order_disputes_one_per_line on public.order_disputes (order_id, kind, coalesce(order_item_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index order_disputes_customer_idx on public.order_disputes (customer_id, created_at desc);
alter table public.order_disputes enable row level security;
revoke all on table public.order_disputes from public, anon, authenticated;
grant all on table public.order_disputes to service_role;
grant select on table public.order_disputes to authenticated;
create policy order_disputes_operator_read on public.order_disputes for select to authenticated using ((select app_private.is_operator()));

-- Books an approved dispute: the ledger first (who pays), then the customer's credit.
create function app_private.dispute_book(p_dispute_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.order_disputes%rowtype;
  v_o public.orders%rowtype;
  v_r jsonb := public.config_value('dispute_rules');
  v_tx uuid;
  v_credit uuid;
begin
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  select * into v_o from public.orders where id = v_d.order_id;
  if v_d.ledger_tx is not null or v_d.amount_usd <= 0 then
    return jsonb_build_object('status', 'booked', 'amount_usd', v_d.amount_usd);
  end if;
  v_tx := public.ledger_post('refund', 'dispute:' || v_d.id,
    jsonb_build_array(
      jsonb_build_object('account_id', case when v_d.payer = 'merchant'
                                            then public.ledger_account('merchant_payable', 'USD', v_o.vendor_id)
                                            else public.ledger_account('expense_refunds', 'USD') end,
        'amount', v_d.amount_usd, 'memo', v_d.kind || ' on order ' || v_o.code),
      jsonb_build_object('account_id', public.ledger_account('customer_refund_payable', 'USD'), 'amount', -v_d.amount_usd,
        'memo', 'customer credit, order ' || v_o.code)),
    v_o.id, v_o.usd_lbp_rate, 'dispute ' || v_d.kind || ' (' || v_d.rule || ')');
  insert into public.customer_credits (customer_id, amount_usd, reason, dispute_id, expires_at)
  values (v_d.customer_id, v_d.amount_usd, v_d.kind || ' on order ' || v_o.code, v_d.id,
          now() + make_interval(days => (v_r ->> 'credit_days')::int))
  returning id into v_credit;
  update public.order_disputes set ledger_tx = v_tx, credit_id = v_credit, decided_at = coalesce(decided_at, now())
  where id = v_d.id;
  return jsonb_build_object('status', 'booked', 'amount_usd', v_d.amount_usd, 'credit_id', v_credit);
end;
$$;

-- A credit that expires unused goes back to whoever funded it, so customer_refund_payable never carries a dead liability:
-- one reversal of the dispute's transaction per credit (a credit is always the whole dispute amount, §20). Daily.
create function app_private.credits_expire() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_c record;
  v_tx uuid;
  v_n integer := 0;
begin
  for v_c in
    select cc.id, cc.amount_usd, d.payer, d.ledger_tx, o.vendor_id, o.id as order_id, o.code, o.usd_lbp_rate
    from public.customer_credits cc
    join public.order_disputes d on d.id = cc.dispute_id
    join public.orders o on o.id = d.order_id
    where cc.used_order_id is null and cc.expired_tx is null and cc.expires_at <= now() and d.ledger_tx is not null
    for update of cc skip locked
  loop
    v_tx := public.ledger_post('reversal', 'credit-expired:' || v_c.id,
      jsonb_build_array(
        jsonb_build_object('account_id', public.ledger_account('customer_refund_payable', 'USD'), 'amount', v_c.amount_usd,
          'memo', 'expired customer credit, order ' || v_c.code),
        jsonb_build_object('account_id', case when v_c.payer = 'merchant'
                                              then public.ledger_account('merchant_payable', 'USD', v_c.vendor_id)
                                              else public.ledger_account('expense_refunds', 'USD') end,
          'amount', -v_c.amount_usd, 'memo', 'credit expired unused, order ' || v_c.code)),
      v_c.order_id, v_c.usd_lbp_rate, 'customer credit expired unused', p_reverses_id => v_c.ledger_tx);
    update public.customer_credits set expired_tx = v_tx where id = v_c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
select cron.schedule('credits-expire', '17 3 * * *', $$select app_private.credits_expire()$$);

-- The customer's report (a problem tapped on the list). The server decides eligibility and amount.
create function public.dispute_open(p_customer_id uuid, p_order_id uuid, p_kind text, p_order_item_id uuid default null,
  p_quantity integer default 1)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_r jsonb := public.config_value('dispute_rules');
  v_line public.order_items%rowtype;
  v_amount numeric := 0;
  v_payer text;
  v_decision text;
  v_rule text;
  v_rate numeric;
  v_delivered integer;
  v_prior integer;
  v_leg_min numeric;
  v_expected_min numeric;
  v_prep_late numeric;
  v_id uuid;
  v_booked jsonb;
  v_promised timestamptz;
begin
  select * into v_o from public.orders where id = p_order_id and customer_id = p_customer_id;
  if v_o.id is null then
    return jsonb_build_object('status', 'unknown_order');
  end if;
  if v_o.status <> 'delivered' then
    return jsonb_build_object('status', 'not_delivered', 'order_status', v_o.status);
  end if;
  if v_o.delivered_at < now() - make_interval(days => (v_r ->> 'report_days')::int) then
    return jsonb_build_object('status', 'too_late', 'days', (v_r ->> 'report_days')::int);
  end if;
  if p_kind not in ('missing_item', 'wrong_item', 'cold_food', 'late', 'damaged', 'other') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_kind in ('missing_item', 'wrong_item') then
    select * into v_line from public.order_items where id = p_order_item_id and order_id = v_o.id;
    if v_line.id is null then
      return jsonb_build_object('status', 'pick_line');
    end if;
  end if;
  if exists (select 1 from public.order_disputes d where d.order_id = v_o.id and d.kind = p_kind
             and d.order_item_id is not distinct from v_line.id) then
    return jsonb_build_object('status', 'already_reported');
  end if;

  select count(*) into v_delivered from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered'
    and o.delivered_at > now() - make_interval(days => (v_r ->> 'rate_window_days')::int);
  select count(*) into v_prior from public.order_disputes d where d.customer_id = p_customer_id
    and d.created_at > now() - make_interval(days => (v_r ->> 'rate_window_days')::int)
    and d.decision in ('auto_credit', 'approved', 'review', 'owner_review');
  v_rate := v_prior::numeric / greatest(v_delivered, 1);

  case p_kind
    when 'missing_item', 'wrong_item' then
      -- Per unit reported (one unless the customer says more), never more than the line.
      v_amount := round(v_line.line_total_usd / greatest(v_line.quantity, 1) * least(greatest(coalesce(p_quantity, 1), 1), v_line.quantity), 2);
      v_payer := 'merchant';
      v_rule := format('%s: %s of %s, merchant pays', p_kind, least(greatest(coalesce(p_quantity, 1), 1), v_line.quantity), v_line.quantity);
    when 'cold_food' then
      -- The delivery leg (out for delivery → delivered) against 1.5 x the expected road time: the cached route's
      -- duration, else 25 km/h over the road distance.
      if v_o.picked_up_at is null or v_o.delivered_at is null or v_o.road_km is null or v_o.delivery_pin is null then
        v_rule := 'cold_food: no delivery times to check';
      else
        v_leg_min := extract(epoch from (v_o.delivered_at - v_o.picked_up_at)) / 60.0;
        select r.duration_s / 60.0 into v_expected_min
        from public.vendors v, public.route_cache_lookup(extensions.st_y(v.location::extensions.geometry), extensions.st_x(v.location::extensions.geometry),
          array[extensions.st_y(v_o.delivery_pin::extensions.geometry)], array[extensions.st_x(v_o.delivery_pin::extensions.geometry)]) r
        where v.id = v_o.vendor_id;
        v_expected_min := greatest(5, coalesce(v_expected_min, v_o.road_km / 25.0 * 60.0));
        if v_leg_min > (v_r ->> 'cold_factor')::numeric * v_expected_min then
          v_amount := round(v_o.food_subtotal_usd * (v_r ->> 'cold_credit_pct')::numeric / 100.0, 2);
          v_payer := case when v_o.delivery_mode = 'merchant' then 'merchant' else 'alo_king' end;
          v_rule := format('cold_food: delivery took %s min against %s expected', round(v_leg_min), round(v_expected_min));
        else
          v_rule := format('cold_food: delivery took %s min, within 1.5 x %s', round(v_leg_min), round(v_expected_min));
        end if;
      end if;
    when 'late' then
      v_promised := v_o.accepted_at + make_interval(mins => coalesce(v_o.prep_minutes, 20)::int);
      if v_o.ready_marked_at is not null and v_o.ready_marked_at > v_promised + make_interval(mins => (v_r ->> 'late_prep_min')::int) then
        v_prep_late := extract(epoch from (v_o.ready_marked_at - v_promised)) / 60.0;
        v_amount := v_o.delivery_fee_usd;
        v_payer := 'merchant';
        v_rule := format('late: ready %s min after the promised time, merchant pays', round(v_prep_late));
      else
        v_rule := 'late: preparation within 15 min of the promise';
      end if;
    when 'damaged' then
      v_rule := 'damaged: photo needed, a person decides (remake or credit)';
    else
      v_rule := 'other: a person decides';
  end case;

  if p_kind in ('damaged', 'other') or v_amount = 0 and p_kind not in ('cold_food', 'late') then
    v_decision := 'review';
  elsif v_amount = 0 then
    v_decision := 'rejected';
  elsif v_o.payment_method <> 'cod' then
    v_decision := 'review'; -- refunded to the original payment (Phase 6), never a credit
  elsif v_amount > (v_r ->> 'owner_over_usd')::numeric then
    v_decision := 'owner_review';
  elsif v_amount <= (v_r ->> 'auto_max_usd')::numeric and v_rate < (v_r ->> 'max_dispute_rate')::numeric then
    v_decision := 'auto_credit'; -- up to $8 and a low dispute rate; between $8 and $20 a person, above $20 Rasheed
  else
    v_decision := 'review';
  end if;

  insert into public.order_disputes (order_id, customer_id, kind, order_item_id, amount_usd, payer, decision, rule)
  values (v_o.id, p_customer_id, p_kind, v_line.id, v_amount, v_payer, v_decision, v_rule || format(' (dispute rate %s)', round(v_rate, 2)))
  returning id into v_id;
  update public.orders set customer_problem_at = coalesce(customer_problem_at, now()) where id = v_o.id;

  if v_decision = 'auto_credit' then
    v_booked := app_private.dispute_book(v_id);
  elsif v_decision in ('review', 'owner_review') then
    perform app_private.ops_alert('dispute:' || v_id, 'customer_dispute',
      case when v_decision = 'owner_review' then 'urgent' else 'warning' end,
      format('Order %s: customer reports %s%s; %s', v_o.code, replace(p_kind, '_', ' '),
             case when v_amount > 0 then format(' ($%s)', v_amount) else '' end,
             case when v_decision = 'owner_review' then 'over $20: Rasheed decides' else 'a person decides' end),
      v_o.id, v_o.vendor_id, jsonb_build_object('dispute_id', v_id, 'rule', v_rule, 'amount_usd', v_amount));
  end if;
  return jsonb_build_object('status', v_decision, 'dispute_id', v_id, 'amount_usd', v_amount, 'payer', v_payer,
    'code', v_o.code, 'credit_days', (v_r ->> 'credit_days')::int, 'rule', v_rule,
    'usd_lbp_rate', v_o.usd_lbp_rate, 'amount_lbp', round(v_amount * v_o.usd_lbp_rate, 0));
end;
$$;

-- The operator role of a user (null when not an active operator). The service-role callers (ops console, Slack
-- actions) pass the acting person's id, so the role check never depends on auth.uid().
create function app_private.operator_role(p_user_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select o.role::text from public.operators o where o.user_id = p_user_id and o.active;
$$;

-- An operator's decision on a dispute in review (the ops console and Slack actions call this, 5b). The acting person is
-- required; above $20 only an admin (Rasheed) approves; the amount never exceeds the order (or the line).
create function public.dispute_decide(p_dispute_id uuid, p_approve boolean, p_actor_id uuid, p_amount_usd numeric default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.order_disputes%rowtype;
  v_amount numeric;
  v_role text := app_private.operator_role(p_actor_id);
  v_max numeric;
begin
  if v_role is null then
    raise exception 'not allowed: an active operator decides disputes' using errcode = 'insufficient_privilege';
  end if;
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  if v_d.id is null or v_d.decision not in ('review', 'owner_review') then
    return jsonb_build_object('status', 'not_open');
  end if;
  v_amount := coalesce(p_amount_usd, v_d.amount_usd);
  select coalesce((select i.line_total_usd from public.order_items i where i.id = v_d.order_item_id), o.total_usd)
    into v_max from public.orders o where o.id = v_d.order_id;
  if v_amount < 0 or v_amount > v_max then
    return jsonb_build_object('status', 'invalid', 'max_usd', v_max);
  end if;
  if p_approve and v_amount > (public.config_value('dispute_rules') ->> 'owner_over_usd')::numeric and v_role <> 'admin' then
    raise exception 'not allowed: over the owner limit' using errcode = 'insufficient_privilege';
  end if;
  update public.order_disputes set decision = case when p_approve then 'approved' else 'rejected' end,
    amount_usd = v_amount, payer = coalesce(payer, 'alo_king'), decided_by = p_actor_id, decided_at = now()
  where id = v_d.id;
  if p_approve and v_amount > 0 then
    return public.dispute_book(v_d.id) || jsonb_build_object('decision', 'approved');
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end;
$$;

-- The order's lines for the "what was missing?" list (own orders only).
create function public.order_lines_for_customer(p_customer_id uuid, p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id', i.id, 'name_ar', coalesce(i.name_ar, i.name_en),
    'name_en', coalesce(i.name_en, i.name_ar), 'quantity', i.quantity, 'line_total_usd', i.line_total_usd) order by i.created_at, i.id), '[]')
  from public.order_items i join public.orders o on o.id = i.order_id
  where o.id = p_order_id and o.customer_id = p_customer_id;
$$;

-- The customer's latest delivered order (the problem button and the model's report_problem tool).
create function public.customer_last_delivered(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('order_id', o.id, 'code', o.code, 'delivered_at', o.delivered_at)
  from public.orders o where o.customer_id = p_customer_id and o.status = 'delivered'
  order by o.delivered_at desc nulls last limit 1;
$$;

-- 8. Customer messages: budget and consolidation (§38.3) --------------------------------------------------------------------
-- Kinds the customer must get whatever the count (a money decision or the end of the order).
create function app_private.customer_message_essential(p_kind text) returns boolean
language sql immutable set search_path = ''
as $$ select p_kind in ('accepted', 'rejected', 'cancelled', 'weight_confirm', 'substitution', 'delivered', 'ready_for_pickup') $$;

-- Up to three shops that deliver to the order's address and are open, for an order that could not go ahead (§38.3).
-- They become the customer's session refs v1..v3, so the buttons open their menus without a model.
create function app_private.offer_alternatives(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_rows jsonb;
  v_refs jsonb := '{}';
  v_i integer := 0;
  v_v record;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.id is null or v_o.delivery_pin is null then
    return '[]';
  end if;
  v_rows := '[]';
  for v_v in
    select s.vendor_id, s.name_ar, s.name_en from public.vendor_search(null, extensions.st_y(v_o.delivery_pin::extensions.geometry),
      extensions.st_x(v_o.delivery_pin::extensions.geometry),
      (select v.business_type from public.vendors v where v.id = v_o.vendor_id), null, 10) s
    where s.vendor_id <> v_o.vendor_id and s.is_open
    limit 3
  loop
    v_i := v_i + 1;
    v_refs := v_refs || jsonb_build_object('v' || v_i, jsonb_build_object('id', v_v.vendor_id, 'label', left(coalesce(v_v.name_en, v_v.name_ar), 60)));
    v_rows := v_rows || jsonb_build_object('ref', 'v' || v_i, 'name_ar', v_v.name_ar, 'name_en', v_v.name_en);
  end loop;
  if v_i > 0 then
    update public.bot_sessions s set refs = (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(s.refs) e(k, v) where k !~ '^v\d+$') || v_refs
    where s.customer_id = v_o.customer_id;
  end if;
  return v_rows;
end;
$$;

create or replace function app_private.customer_notify(p_order_id uuid, p_kind text, p_extra jsonb default '{}', p_dedupe text default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_c public.customers%rowtype;
  v_id bigint;
  v_budget jsonb := public.config_value('customer_message_budget');
  v_extra jsonb := coalesce(p_extra, '{}');
  v_link text;
begin
  select * into v_o from public.orders where id = p_order_id;
  select * into v_c from public.customers where id = v_o.customer_id;
  if v_c.id is null then
    return null;
  end if;
  -- Consolidated: the delivered message carries the rating (§38.3), so a separate rating message is never sent after it.
  if p_kind = 'rating' and exists (select 1 from public.outbound_messages m where m.dedupe_key = 'cust:' || p_order_id || ':delivered') then
    return null;
  end if;
  -- Budget: above the target only essential kinds go; at the hard cap nothing but a money decision.
  if v_o.customer_messages >= (v_budget ->> 'cap')::int and p_kind not in ('weight_confirm', 'substitution', 'cancelled', 'rejected') then
    return null;
  end if;
  if v_o.customer_messages >= (v_budget ->> 'target')::int and not app_private.customer_message_essential(p_kind) then
    return null;
  end if;
  -- "On the way + tracking" in one message, once the public site exists (config site_url).
  if p_kind = 'on_the_way' and public.config_value('site_url') is not null then
    begin
      v_link := public.order_tracking_link_create(p_order_id);
      v_extra := v_extra || jsonb_build_object('track_url', v_link);
    exception when others then
      v_link := null;
    end;
  end if;
  -- An order that could not go ahead: up to three open shops that deliver there.
  if p_kind in ('cancelled', 'rejected') and coalesce(v_o.cancel_reason::text, '') <> 'customer' then
    v_extra := v_extra || jsonb_build_object('alternatives', app_private.offer_alternatives(p_order_id));
  end if;
  v_id := app_private.outbox_add('cust:' || p_order_id || ':' || coalesce(p_dedupe, p_kind), p_order_id, v_o.vendor_id,
    'whatsapp', 'customer_message', v_c.phone_e164,
    jsonb_build_object('kind', p_kind, 'lang', coalesce(v_c.language::text, 'ar'), 'customer_id', v_c.id,
      'ask_delivery', v_o.driver_member_id is not null) || v_extra);
  if v_id is not null then
    if v_c.last_inbound_at is null or v_c.last_inbound_at < now() - interval '24 hours' then
      update public.outbound_messages set status = 'skipped', last_error = 'outside the 24-hour window: needs an approved utility template'
      where id = v_id;
    else
      update public.orders set customer_messages = customer_messages + 1 where id = p_order_id;
    end if;
  end if;
  return v_id;
end;
$$;

-- Bot replies about an order count too (the summary, "placed", tracking answers): dispatch adds them after sending.
create function public.order_messages_add(p_order_id uuid, p_n integer) returns void
language sql security definer set search_path = ''
as $$ update public.orders set customer_messages = least(customer_messages + greatest(p_n, 0), 32000) where id = p_order_id $$;

-- Messages per delivered order over the last 7 days against the target; above it an ops alert (and a LOG line, §38.3).
create function public.customer_message_report(p_days integer default 7) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('orders', count(*), 'avg', round(avg(o.customer_messages), 2), 'max', max(o.customer_messages),
    'over_target', count(*) filter (where o.customer_messages > (public.config_value('customer_message_budget') ->> 'target')::int),
    'target', (public.config_value('customer_message_budget') ->> 'target')::int,
    'cap', (public.config_value('customer_message_budget') ->> 'cap')::int)
  from public.orders o
  where o.status = 'delivered' and o.delivered_at > now() - make_interval(days => greatest(p_days, 1));
$$;
create function app_private.message_budget_check() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb := public.customer_message_report(7);
begin
  if (v ->> 'orders')::int >= 10 and (v ->> 'avg')::numeric > (v ->> 'target')::numeric then
    perform app_private.ops_alert('message_budget:' || to_char(now() at time zone 'Asia/Beirut', 'YYYYMMDD'), 'message_budget', 'warning',
      format('Customer messages per order averaged %s over 7 days (target %s): open a LOG item and consolidate', v ->> 'avg', v ->> 'target'),
      null, null, v);
  end if;
end;
$$;
select cron.schedule('message-budget-check', '7 6 * * *', $$select app_private.message_budget_check()$$);

-- 9. Outbound pacing (§38.3: 60 messages a second per number; at least 6 s between non-urgent messages to one person) ----
create function app_private.outbox_non_urgent(p_purpose public.outbox_purpose, p_payload jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select p_purpose = 'customer_message' and coalesce(p_payload ->> 'kind', '') in ('rating', 'basket_reminder', 'near_drop', 'gift_expired') $$;

create index if not exists outbound_messages_sent_idx on public.outbound_messages (sent_at) where channel = 'whatsapp';
create index if not exists outbound_messages_target_sent_idx on public.outbound_messages (target, sent_at);

create or replace function public.outbox_claim(p_limit integer default 20, p_lock_s integer default 30)
returns table (id bigint, order_id uuid, vendor_id uuid, channel public.order_channel_kind, purpose public.outbox_purpose,
  target text, payload jsonb, attempts integer, card jsonb)
language plpgsql security definer set search_path = ''
as $$
declare
  v_pacing jsonb := public.config_value('outbound_pacing');
  v_room integer;
  v_gap interval := make_interval(secs => coalesce((v_pacing ->> 'same_person_gap_s')::int, 6));
begin
  -- Room in this second for the WhatsApp channel (one sending number per audience in the pilot), counting what
  -- another worker has claimed and not sent yet.
  select greatest(0, coalesce((v_pacing ->> 'per_number_per_s')::int, 60) - count(*))::int into v_room
  from public.outbound_messages m where m.channel = 'whatsapp'
    and (m.sent_at > now() - interval '1 second' or (m.status = 'sending' and m.locked_until > now()));
  -- Non-urgent messages to someone who got a message a moment ago wait their turn (Meta error 131056).
  update public.outbound_messages x set available_at = now() + v_gap
  where x.status = 'queued' and x.available_at <= now() and app_private.outbox_non_urgent(x.purpose, x.payload)
    and exists (select 1 from public.outbound_messages y where y.target = x.target and y.id <> x.id
                and y.sent_at > now() - v_gap);
  return query
  with claimed as (
    update public.outbound_messages m set status = 'sending', attempts = m.attempts + 1,
      locked_until = now() + make_interval(secs => greatest(p_lock_s, 5))
    where m.id in (
      select x.id from public.outbound_messages x
      where (x.status = 'queued' or (x.status = 'sending' and x.locked_until < now())) and x.available_at <= now()
        and (x.channel <> 'whatsapp' or v_room > 0)
      order by x.available_at, x.id
      limit least(greatest(p_limit, 1), 100, case when v_room > 0 then v_room else 100 end)
      for update skip locked
    )
    returning m.*
  )
  select c.id, c.order_id, c.vendor_id, c.channel, c.purpose, c.target, c.payload, c.attempts,
    case when c.order_id is not null then app_private.order_card_payload(c.order_id) end
  from claimed c order by c.id;
end;
$$;

-- 10. Dead-letter queue (§38.3) ---------------------------------------------------------------------------------------
-- An inbound event that failed every attempt is kept on `webhook_dead` with its error, alerts the operators, and can be
-- replayed once fixed (webhook_dead_replay). Nothing is lost silently.
select pgmq.create('webhook_dead');
alter table public.webhook_events add column dead_lettered_at timestamptz;

create or replace function public.webhook_finish(p_msg_id bigint, p_event_id bigint, p_status public.webhook_status,
  p_error text default null, p_max_attempts integer default 5, p_attempt integer default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_status not in ('done', 'failed', 'ignored') then
    raise exception 'webhook_finish takes done, failed or ignored' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.webhook_events where id = p_event_id) then
    raise exception 'webhook event % does not exist', p_event_id using errcode = 'no_data_found';
  end if;
  update public.webhook_events e
    set status = p_status,
        last_error = case when p_status = 'failed' then left(p_error, 1000) else e.last_error end,
        processed_at = case when p_status in ('done', 'ignored') then now() else e.processed_at end
    where e.id = p_event_id and (p_attempt is null or e.attempts = p_attempt)
    returning e.attempts into v_attempts;
  if not found then
    return;
  end if;
  if p_status <> 'failed' then
    perform pgmq.archive('webhook_inbound', p_msg_id);
  elsif v_attempts >= p_max_attempts then
    perform pgmq.archive('webhook_inbound', p_msg_id);
    perform pgmq.send('webhook_dead', jsonb_build_object('event_id', p_event_id, 'attempts', v_attempts, 'error', left(p_error, 500)));
    update public.webhook_events set dead_lettered_at = now() where id = p_event_id;
    perform app_private.ops_alert('dead_letter:' || p_event_id, 'dead_letter', 'warning',
      format('An inbound WhatsApp event failed %s times and is on the dead-letter queue: %s', v_attempts, left(coalesce(p_error, ''), 160)),
      null, null, jsonb_build_object('event_id', p_event_id));
  else
    perform pgmq.set_vt('webhook_inbound', p_msg_id, least(5 * greatest(v_attempts, 1), 60));
  end if;
end;
$$;

-- Puts a dead-lettered event back on the inbound queue (operators, after a fix). The event keeps its id, so the bot's
-- dedupe still applies.
create function public.webhook_dead_replay(p_event_id bigint, p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if app_private.operator_role(p_actor_id) is null then
    raise exception 'not allowed: an active operator replays dead letters' using errcode = 'insufficient_privilege';
  end if;
  -- attempts = 1, so the next claim is attempt 2: the bot's turn guard treats attempt 1 on a known message as Kapso
  -- delivering it twice (skipped), and attempt 2+ as a retry of a turn that never finished (run again). A turn that
  -- did finish stays a duplicate, so a replay never answers the customer twice.
  update public.webhook_events set status = 'queued', attempts = 1, dead_lettered_at = null
  where id = p_event_id and dead_lettered_at is not null;
  if not found then
    return jsonb_build_object('status', 'not_dead');
  end if;
  perform pgmq.send('webhook_inbound', jsonb_build_object('event_id', p_event_id));
  return jsonb_build_object('status', 'requeued');
end;
$$;

-- 11. Food knowledge (§38.3): estimates from the dish library, never merchant declarations -------------------------------
-- Per item: allergens the recipe or the name suggests that the merchant has not declared ("≈ may contain"), and siyami /
-- halal estimates. Sesame for tahini dishes (hummus, mutabbal, tarator…), egg for toum (some kitchens use egg white),
-- siyami excludes meat, poultry, dairy and eggs; seafood is flagged (traditions differ) and honey allowed; halal is only
-- "no pork, no alcohol" (slaughter cannot be read from a recipe).
create function public.menu_item_hints(p_item_ids uuid[]) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with it as (
    select i.id, i.allergens, i.allergens_confirmed_at, n.dish_id,
      app_private.normalize_place_name(concat_ws(' ', i.name_ar, i.name_en, i.name_fr, i.description)) as words
    from public.menu_items i left join public.menu_item_nutrition n on n.item_id = i.id
    where i.id = any (p_item_ids)
  ),
  ing as (
    select it.id, x.allergens, x.food_group, x.animal_product, x.pork, x.alcohol, x.id as ing_id
    from it join public.dish_library d on d.id = it.dish_id
    cross join lateral jsonb_object_keys(d.recipe) k(ing)
    join public.nutrition_ingredients x on x.id = k.ing
  ),
  est as (
    select it.id,
      array(select distinct a from (
        select unnest(g.allergens) as a from ing g where g.id = it.id
        union all select 'sesame'::public.allergen where it.words ~ '(طحين|tahin|حمص|hummus|hommos|متبل|mutabbal|moutabal|طرطور|tarator|بابا غنوج|baba ghanouj|سمسم|sesame)'
        union all select 'eggs'::public.allergen where it.words ~ '(توم|toum|garlic sauce|toumeh)'
      ) s where not (s.a = any (it.allergens))) as may_contain,
      case when it.dish_id is null then null
           else not exists (select 1 from ing g where g.id = it.id
                            and (g.food_group in ('red_meat', 'poultry', 'offal', 'processed_meat', 'dairy', 'egg')
                                 or (g.animal_product and g.ing_id !~ 'honey' and g.food_group not in ('fish', 'seafood'))))
                and it.words !~ '(توم|toum)' end as siyami_est,
      case when it.dish_id is null then null
           else exists (select 1 from ing g where g.id = it.id and g.food_group in ('fish', 'seafood')) end as has_seafood,
      case when it.dish_id is null then null
           else not exists (select 1 from ing g where g.id = it.id and (g.pork or g.alcohol)) end as no_pork_alcohol_est
    from it
  )
  select coalesce(jsonb_object_agg(e.id, jsonb_build_object('may_contain', to_jsonb(e.may_contain), 'siyami_est', e.siyami_est,
    'seafood', e.has_seafood, 'no_pork_alcohol_est', e.no_pork_alcohol_est)), '{}')
  from est e;
$$;

-- 12. Grants: every function above is for the service role (the bot and, for dispute_decide and webhook_dead_replay, the
-- operators' console through its edge function, 5b); none is reachable by anon or authenticated.
revoke all on function public.search_expand(text), public.catalog_search(uuid, text, integer), public.customer_fact_set(uuid, text, text, text, boolean),
  public.customer_memory(uuid), public.customer_memory_forget(uuid, text, text), public.basket_address_state(uuid),
  public.basket_confirm_address(uuid, uuid), public.address_set_for_whom(uuid, uuid, text, boolean),
  public.address_set_recipient(uuid, uuid, text, text), public.basket_set_allergy_note(uuid, text),
  public.gift_request_create(uuid, uuid, bigint), public.gift_respond(text, uuid, boolean), public.dispute_open(uuid, uuid, text, uuid, integer),
  public.dispute_decide(uuid, boolean, uuid, numeric), public.order_lines_for_customer(uuid, uuid), public.customer_last_delivered(uuid),
  public.order_messages_add(uuid, integer), public.customer_message_report(integer), public.webhook_dead_replay(bigint, uuid),
  public.menu_item_hints(uuid[])
  from public, anon, authenticated;
grant execute on function public.search_expand(text), public.catalog_search(uuid, text, integer), public.customer_fact_set(uuid, text, text, text, boolean),
  public.customer_memory(uuid), public.customer_memory_forget(uuid, text, text), public.basket_address_state(uuid),
  public.basket_confirm_address(uuid, uuid), public.address_set_for_whom(uuid, uuid, text, boolean),
  public.address_set_recipient(uuid, uuid, text, text), public.basket_set_allergy_note(uuid, text),
  public.gift_request_create(uuid, uuid, bigint), public.gift_respond(text, uuid, boolean), public.dispute_open(uuid, uuid, text, uuid, integer),
  public.dispute_decide(uuid, boolean, uuid, numeric), public.order_lines_for_customer(uuid, uuid), public.customer_last_delivered(uuid),
  public.order_messages_add(uuid, integer), public.customer_message_report(integer), public.webhook_dead_replay(bigint, uuid),
  public.menu_item_hints(uuid[])
  to service_role;
revoke all on function app_private.search_stopword(text), app_private.fact_is_health(text), app_private.basket_address_confirmed(uuid), app_private.stairs_fee_usd(uuid),
  app_private.credits_for(uuid, numeric), app_private.dispute_book(uuid), app_private.customer_message_essential(text),
  app_private.offer_alternatives(uuid), app_private.message_budget_check(), app_private.outbox_non_urgent(public.outbox_purpose, jsonb),
  app_private.gift_requests_expire(), app_private.orders_copy_customer_agent(), app_private.orders_credit_settle(),
  app_private.gift_fingerprint(uuid, jsonb), app_private.basket_allergy_note(uuid), app_private.operator_role(uuid), app_private.credits_expire()
  from public;
