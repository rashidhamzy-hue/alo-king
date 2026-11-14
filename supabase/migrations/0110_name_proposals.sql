-- Alo King Chouf, session D4 (console): names and sizes, proposed by 5.18 (data/proposals/names.json), reviewed by a person.
--
-- The 282 proposals are loaded below (apps/console/scripts/names-insert.mjs prints that INSERT). Nothing in this file changes
-- a product: a name changes only when a person approves or corrects its proposal in the console, through review_product_name().
-- Keyed by SKU, not product id, so the file loads before or after the catalog seeds (as the language pack, 0054, and 0085).
--
--   approve  the proposal as stored.            correct  the person's own words, saved and applied in one step.
--   reject   a proposal still waiting is set aside; an APPROVED one is undone: the product gets its earlier name back (only if
--            nobody has changed it since). A rejected proposal can be approved or corrected again.
--   Every decision is idempotent (a double tap is one decision) and needs the ops lead or an admin.
--
-- What an approval writes. The catalog's names carry the size inside them today ("Tanmia Fresh Chicken Filet 500G") and the
-- planner, the cards and the search words all read the name, so the product's name is the proposed name WITH its size after it
-- ("Tanmia Fresh Chicken Filet 500 g"), spelled the way the proposal spells it. The size stays separate here, in the proposal.
-- Writing name_en / name_ar fires 0076's trigger, which queues the item's search words again.
-- An Arabic name the proposal does not have leaves the product's Arabic name as it is.
--
-- A person's correction may not add a praise, health, diet or religion word that neither the current name nor the proposal had
-- (invariants 14-16; the list is settings.name_claim_words, the same words 5.18's generator refused).

insert into settings(key, value) values ('name_claim_words', '["best","better","top","premium","finest","delicious","tasty","healthy","health","organic","natural","fresh","pure","light","diet","halal","haram","kosher","vegan","vegetarian","fasting","lent","gluten","sugar","lactose","allergy","popular","favourite","favorite","recommended","quality","افضل","أفضل","ممتاز","لذيذ","صحي","صحية","عضوي","طبيعي","طازج","حلال","نباتي","صيامي","ديت","مميز","فاخر","الأكثر مبيعا","الاكثر مبيعا"]')
on conflict (key) do nothing;

create table product_name_proposals (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,
  -- what the catalog said when 5.18 made the proposal
  current_name_en   text not null,
  current_name_ar   text,
  current_brand     text,
  current_sell_unit text,
  -- the proposal (after a correction: the person's words; `original` keeps the generator's)
  name_en           text not null,
  name_ar           text,
  size_en           text,
  size_ar           text,
  ar_source         text not null check (ar_source in ('catalog', 'model_written')),   -- model_written: an Arabic reader must check it
  added_words       text[] not null default '{}',
  off_hint          jsonb,                                  -- what Open Food Facts calls it, for comparison only
  original          jsonb,
  status            text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  corrected         boolean not null default false,
  decided_by        uuid references parties(id),
  decided_at        timestamptz,
  review_note       text,
  -- what an approval wrote, and what it replaced (rejecting an approved proposal puts the earlier names back)
  applied_name_en   text,
  applied_name_ar   text,
  previous_name_en  text,
  previous_name_ar  text,
  created_at        timestamptz not null default now(),
  check ((status = 'proposed') = (decided_by is null)),
  check (status <> 'approved' or applied_name_en is not null)
);
create index product_name_proposals_status on product_name_proposals(status, sku);

-- Words in `p_new` that are claim words and are not in `p_source`.
create or replace function name_added_claims(p_new text, p_source text) returns text[] language sql stable set search_path = public, pg_temp as $$
  select coalesce(array_agg(w order by w), '{}') from jsonb_array_elements_text(coalesce(setting('name_claim_words'), '[]'::jsonb)) w
   where case when w ~ '^[a-z]+$' then lower(coalesce(p_new, '')) ~ ('(^|[^a-z])' || w || '([^a-z]|$)') and not lower(coalesce(p_source, '')) ~ ('(^|[^a-z])' || w || '([^a-z]|$)')
              else position(w in coalesce(p_new, '')) > 0 and position(w in coalesce(p_source, '')) = 0 end $$;

create or replace function review_product_name(p_proposal uuid, p_by uuid, p_decision text, p_name_en text default null, p_name_ar text default null,
                                               p_size_en text default null, p_size_ar text default null, p_note text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare n product_name_proposals%rowtype; p products%rowtype; v_en text; v_ar text; v_sz_en text; v_sz_ar text; v_final_en text; v_final_ar text;
        v_claims text[]; v_changed boolean; v_prev_en text; v_prev_ar text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_decision not in ('approve', 'correct', 'reject') then raise exception 'UNKNOWN_DECISION %', p_decision; end if;
  select * into n from product_name_proposals where id = p_proposal for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND %', p_proposal; end if;
  select * into p from products where sku = n.sku for update;
  if not found then raise exception 'ITEM_NOT_IN_CATALOG %: the catalog has no such item (yet)', n.sku; end if;

  if p_decision = 'reject' then
    if n.status = 'rejected' then return jsonb_build_object('ok', true, 'already', true, 'status', 'rejected'); end if;
    if n.status = 'approved' then
      -- Undo: only while the product still carries exactly what the approval wrote.
      if p.name_en is distinct from n.applied_name_en or p.name_ar is distinct from n.applied_name_ar then
        raise exception 'NAME_CHANGED_SINCE: the catalog name was changed after this approval, so it is not put back from here';
      end if;
      update products set name_en = n.previous_name_en, name_ar = n.previous_name_ar where id = p.id;
    end if;
    update product_name_proposals set status = 'rejected', decided_by = p_by, decided_at = now(), review_note = v_note,
           applied_name_en = null, applied_name_ar = null, previous_name_en = null, previous_name_ar = null where id = n.id;
    return jsonb_build_object('ok', true, 'already', false, 'status', 'rejected', 'sku', n.sku, 'reverted', n.status = 'approved');
  end if;

  if p_decision = 'approve' then
    v_en := n.name_en; v_ar := n.name_ar; v_sz_en := n.size_en; v_sz_ar := n.size_ar;
  else
    v_en := nullif(btrim(coalesce(p_name_en, '')), ''); v_ar := nullif(btrim(coalesce(p_name_ar, '')), '');
    v_sz_en := nullif(btrim(coalesce(p_size_en, '')), ''); v_sz_ar := nullif(btrim(coalesce(p_size_ar, '')), '');
    if v_en is null then raise exception 'NAME_REQUIRED'; end if;
    if length(v_en) > 160 or length(coalesce(v_ar, '')) > 160 or length(coalesce(v_sz_en, '')) > 40 or length(coalesce(v_sz_ar, '')) > 40 then raise exception 'NAME_TOO_LONG'; end if;
    if v_ar is not null and v_ar !~ '[ء-ي]' then raise exception 'NAME_AR_NOT_ARABIC: the Arabic name has no Arabic letters'; end if;
    if v_sz_ar is not null and v_sz_ar !~ '[ء-ي]' then raise exception 'NAME_AR_NOT_ARABIC: the Arabic size has no Arabic letters'; end if;
    v_claims := name_added_claims(coalesce(v_en, '') || ' ' || coalesce(v_sz_en, '') || ' ' || coalesce(v_ar, '') || ' ' || coalesce(v_sz_ar, ''),
                                  n.current_name_en || ' ' || coalesce(n.current_name_ar, '') || ' ' || p.name_en || ' ' || coalesce(p.name_ar, '') || ' ' ||
                                  n.name_en || ' ' || coalesce(n.name_ar, '') || ' ' || coalesce(n.size_en, '') || ' ' || coalesce(n.size_ar, ''));
    if array_length(v_claims, 1) > 0 then raise exception 'CLAIM_WORDS %: a name may not praise, or make a health, diet or religion claim', array_to_string(v_claims, ', '); end if;
  end if;

  v_final_en := btrim(v_en || case when v_sz_en is not null then ' ' || v_sz_en else '' end);
  v_final_ar := case when v_ar is null then p.name_ar else btrim(v_ar || case when v_sz_ar is not null then ' ' || v_sz_ar else '' end) end;
  if n.status = 'approved' and v_final_en = n.applied_name_en and v_final_ar is not distinct from n.applied_name_ar then
    return jsonb_build_object('ok', true, 'already', true, 'status', 'approved');
  end if;

  v_prev_en := case when n.status = 'approved' then n.previous_name_en else p.name_en end;
  v_prev_ar := case when n.status = 'approved' then n.previous_name_ar else p.name_ar end;
  v_changed := v_final_en is distinct from p.name_en or v_final_ar is distinct from p.name_ar;
  update products set name_en = v_final_en, name_ar = v_final_ar where id = p.id;
  update product_name_proposals set status = 'approved', decided_by = p_by, decided_at = now(), review_note = v_note,
         corrected = corrected or (p_decision = 'correct' and (v_en, v_ar, v_sz_en, v_sz_ar) is distinct from (n.name_en, n.name_ar, n.size_en, n.size_ar)),
         original = case when p_decision = 'correct' and (v_en, v_ar, v_sz_en, v_sz_ar) is distinct from (n.name_en, n.name_ar, n.size_en, n.size_ar)
                         then coalesce(n.original, jsonb_build_object('name_en', n.name_en, 'name_ar', n.name_ar, 'size_en', n.size_en, 'size_ar', n.size_ar)) else n.original end,
         name_en = coalesce(v_en, name_en), name_ar = v_ar, size_en = v_sz_en, size_ar = v_sz_ar,
         applied_name_en = v_final_en, applied_name_ar = v_final_ar, previous_name_en = v_prev_en, previous_name_ar = v_prev_ar
   where id = n.id;
  return jsonb_build_object('ok', true, 'already', false, 'status', 'approved', 'sku', n.sku, 'name_en', v_final_en, 'name_ar', v_final_ar, 'changed', v_changed,
    'words_queued', exists (select 1 from search_word_jobs j where j.sku = n.sku and j.status in ('pending', 'running')));
end $$;

alter table product_name_proposals enable row level security;
do $$ declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table product_name_proposals from %I', r); end if;
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

-- 282 proposals from data/proposals/names.json (run 43503501332, 2026-11-13T20:40:12.111Z).
insert into product_name_proposals(sku, current_name_en, current_name_ar, current_brand, current_sell_unit, name_en, name_ar, size_en, size_ar, ar_source, added_words, off_hint)
values
('AK-0001', 'Potato', 'بطاطا', 'Local (unbranded)', 'kg', 'Potato', 'بطاطا', null, null, 'catalog', '{}'::text[], null),
('AK-0002', 'Tomato', 'بندورة', 'Local (unbranded)', 'kg', 'Tomato', 'بندورة', null, null, 'catalog', '{}'::text[], null),
('AK-0003', 'Cucumber', 'خيار', 'Local (unbranded)', 'kg', 'Cucumber', 'خيار', null, null, 'catalog', '{}'::text[], null),
('AK-0004', 'Onion', 'بصل', 'Local (unbranded)', 'kg', 'Onion', 'بصل', null, null, 'catalog', '{}'::text[], null),
('AK-0005', 'Lemon', 'حامض', 'Local (unbranded)', 'kg', 'Lemon', 'حامض', null, null, 'catalog', '{}'::text[], null),
('AK-0006', 'Orange for juice', 'ليمون للعصير', 'Local (unbranded)', 'kg', 'Orange for juice', 'ليمون للعصير', null, null, 'catalog', '{}'::text[], null),
('AK-0007', 'Zucchini', 'كوسا', 'Local (unbranded)', 'kg', 'Zucchini', 'كوسا', null, null, 'catalog', '{}'::text[], null),
('AK-0008', 'Carrot', 'جزر', 'Local (unbranded)', 'kg', 'Carrot', 'جزر', null, null, 'catalog', '{}'::text[], null),
('AK-0009', 'Banana', 'موز', 'Local (unbranded)', 'kg', 'Banana', 'موز', null, null, 'catalog', '{}'::text[], null),
('AK-0010', 'Parsley (bunch)', 'بقدونس', 'Local (unbranded)', 'bunch', 'Parsley (bunch)', 'بقدونس', null, null, 'catalog', '{}'::text[], null),
('AK-0011', 'Green beans (loubieh)', 'لوبيا', 'Local (unbranded)', 'kg', 'Green beans (loubieh)', 'لوبيا', null, null, 'catalog', '{}'::text[], null),
('AK-0012', 'Lettuce', 'خس', 'Local (unbranded)', 'piece', 'Lettuce', 'خس', null, null, 'catalog', '{}'::text[], null),
('AK-0013', 'Green pepper, sweet', 'فليفلة خضرا حلوة', 'Local (unbranded)', 'kg', 'Green pepper, sweet', 'فليفلة خضرا حلوة', null, null, 'catalog', '{}'::text[], null),
('AK-0014', 'Eggplant', 'باذنجان', 'Local (unbranded)', 'kg', 'Eggplant', 'باذنجان', null, null, 'catalog', '{}'::text[], null),
('AK-0015', 'Coriander (bunch)', 'كزبرة', 'Local (unbranded)', 'bunch', 'Coriander (bunch)', 'كزبرة', null, null, 'catalog', '{}'::text[], null),
('AK-0016', 'Cauliflower', 'زهرة', 'Local (unbranded)', 'kg', 'Cauliflower', 'زهرة', null, null, 'catalog', '{}'::text[], null),
('AK-0017', 'Cherry tomatoes', 'بندورة كرزية', 'Local (unbranded)', 'pack', 'Cherry tomatoes', 'بندورة كرزية', null, null, 'catalog', '{}'::text[], null),
('AK-0018', 'Cabbage', 'ملفوف', 'Local (unbranded)', 'kg', 'Cabbage', 'ملفوف', null, null, 'catalog', '{}'::text[], null),
('AK-0019', 'Orange, Valencia', 'برتقال', 'Local (unbranded)', 'kg', 'Orange, Valencia', 'برتقال', null, null, 'catalog', '{}'::text[], null),
('AK-0020', 'Apple, red local', 'تفاح أحمر', 'Local (unbranded)', 'kg', 'Apple, red local', 'تفاح أحمر', null, null, 'catalog', '{}'::text[], null),
('AK-0021', 'Rocca (bunch)', 'روكا', 'Local (unbranded)', 'bunch', 'Rocca (bunch)', 'روكا', null, null, 'catalog', '{}'::text[], null),
('AK-0022', 'Onion, red', 'بصل أحمر', 'Local (unbranded)', 'kg', 'Onion, red', 'بصل أحمر', null, null, 'catalog', '{}'::text[], null),
('AK-0023', 'Mint (bunch)', 'نعنع', 'Local (unbranded)', 'bunch', 'Mint (bunch)', 'نعنع', null, null, 'catalog', '{}'::text[], null),
('AK-0024', 'Radish (bunch)', 'فجل', 'Local (unbranded)', 'bunch', 'Radish (bunch)', 'فجل', null, null, 'catalog', '{}'::text[], null),
('AK-0025', 'Garlic', 'ثوم', 'Local (unbranded)', 'bag', 'Garlic', 'ثوم', null, null, 'catalog', '{}'::text[], null),
('AK-0029', 'Chicken Legs', 'فخاد دجاج', 'Hawa Chicken', 'By weight (pre-pack)', 'Chicken Legs', 'فخاد دجاج', null, null, 'catalog', '{}'::text[], null),
('AK-0031', 'Tanmia Fresh Chicken Filet 500G', null, 'Tanmia', 'Each', 'Tanmia Fresh Chicken Filet', 'فيليه دجاج طازج تنمية', '500 g', '500 غ', 'model_written', '{}'::text[], null),
('AK-0032', 'Tanmia Breaded Chicken Fillet Loose', null, 'Tanmia', 'By weight (pre-pack)', 'Tanmia Breaded Chicken Fillet, Loose', 'فيليه دجاج مقرمش تنمية', null, null, 'model_written', '{}'::text[], null),
('AK-0033', 'Tanmia Chicken Tender Loose', 'تنمية تندرز دجاج', 'Tanmia', 'By weight (pre-pack)', 'Tanmia Chicken Tender, Loose', 'تنمية تندرز دجاج', null, null, 'catalog', '{}'::text[], null),
('AK-0034', 'Tanmia Chicken Legs 900G', null, 'Tanmia', 'Each', 'Tanmia Chicken Legs', 'فخاد دجاج تنمية', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0035', 'Wilco Packaged Chicken Legs', null, 'Wilco', 'By weight (pre-pack)', 'Wilco Packaged Chicken Legs', 'فخاد دجاج ويلكو', null, null, 'model_written', '{}'::text[], null),
('AK-0036', 'Wilco Packaged Chicken Breast', null, 'Wilco', 'By weight (pre-pack)', 'Wilco Packaged Chicken Breast', 'صدر دجاج ويلكو', null, null, 'model_written', '{}'::text[], null),
('AK-0038', 'Hawa Chicken Sawda Chicken Prepacked', null, 'Hawa Chicken', 'By weight (pre-pack)', 'Hawa Chicken Sawda Chicken, Prepacked', 'دجاج سودا هوا تشكن', null, null, 'model_written', '{}'::text[], null),
('AK-0039', 'Aflora Kashkaval Cow Cheese', 'جبنة قشقوان بقر', 'Aflora', 'By weight (pre-pack)', 'Aflora Kashkaval Cow Cheese', 'جبنة قشقوان بقر أفلورا', null, null, 'model_written', '{}'::text[], null),
('AK-0040', 'Filata Shredded Mozzarella Cheese', null, 'Filata', 'By weight (pre-pack)', 'Filata Shredded Mozzarella Cheese', 'جبنة موزاريلا مبشورة فيلاتا', null, null, 'model_written', '{}'::text[], null),
('AK-0041', 'Candia Ayran 250Ml', null, 'Candia', 'Each', 'Candia Ayran', 'عيران كانديا', '250 ml', '250 مل', 'model_written', '{}'::text[], '{"name":"Ayran","brands":"Candia","quantity":"25cl","last_modified":"2023-08-23T19:45:17.000Z"}'::jsonb),
('AK-0042', 'Leen Taanayel Labneh Premium', null, 'Leentaanayel', 'By weight (pre-pack)', 'Leen Taanayel Labneh Premium', 'لبنة ليون تعنايل بريميوم', null, null, 'model_written', '{}'::text[], null),
('AK-0043', 'Kavallos Cow Kashkaval', null, 'Kavallos', 'By weight (pre-pack)', 'Kavallos Cow Kashkaval', 'قشقوان بقر كافالوس', null, null, 'model_written', '{}'::text[], null),
('AK-0044', 'Halloum /Kg', null, 'Leentaanayel', 'By weight (pre-pack)', 'Halloum', 'حلوم', null, null, 'model_written', '{}'::text[], null),
('AK-0045', 'Leprino Mozzarella Cheese Shredded', null, 'Leprino', 'By weight (pre-pack)', 'Leprino Mozzarella Cheese, Shredded', 'جبنة موزاريلا مبشورة ليبرينو', null, null, 'model_written', '{}'::text[], null),
('AK-0046', 'Liban Lait Labneh Baladieh 450G', null, 'Liban Lait', 'Each', 'Liban Lait Labneh Baladieh', 'لبنة بلدية ليبان لايت', '450 g', '450 غ', 'model_written', '{}'::text[], '{"name":"Labneh","brands":null,"quantity":"450 g","last_modified":"2026-03-13T11:02:37.000Z"}'::jsonb),
('AK-0047', 'Hamra Edam Analogue Cheese', 'جبنة أيدام', 'Hamra', 'By weight (pre-pack)', 'Hamra Edam Analogue Cheese', 'جبنة أيدام هامرا', null, null, 'catalog', '{}'::text[], null),
('AK-0048', 'Mazaraana Laban 1Kg', null, 'Mazaraana', 'Each', 'Mazaraana Laban', 'لبن مزرعتنا', '1 kg', '1 كغ', 'model_written', '{}'::text[], '{"name":"Yogurt","brands":"Mazaraana","quantity":null,"last_modified":"2024-10-12T17:43:56.000Z"}'::jsonb),
('AK-0049', 'Hawa Chicken Red Egg Naylon', null, 'Hawa Chicken', 'By weight (pre-pack)', 'Hawa Chicken Red Egg, Nylon', 'بيض أحمر هوا تشكن', null, null, 'model_written', array['nylon']::text[], '{"name":"hawa eggs","brands":null,"quantity":null,"last_modified":"2025-10-29T08:05:07.000Z"}'::jsonb),
('AK-0050', 'Liban Lait Laban 1Kg', null, 'Liban Lait', 'Each', 'Liban Lait Laban', 'لبن ليبان لايت', '1 kg', '1 كغ', 'model_written', '{}'::text[], null),
('AK-0051', 'Liban Lait Labneh Baladieh 900G', null, 'Liban Lait', 'Each', 'Liban Lait Labneh Baladieh', 'لبنة بلدية ليبان لايت', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0052', 'Dairy Khoury Greek Yogurt Plain Low Fat 175G', null, 'Dairy Khoury', 'Each', 'Dairy Khoury Greek Yogurt Plain Low Fat', 'زبادي يوناني عادي قليل الدسم دايري خوري', '175 g', '175 غ', 'model_written', '{}'::text[], '{"name":"Greek Yogurt Plain","brands":"Dairy Khoury","quantity":null,"last_modified":"2026-05-22T08:42:17.000Z"}'::jsonb),
('AK-0053', 'Plein Soleil Butter Unsalted 200G', null, 'Plein Soleil', 'Each', 'Plein Soleil Butter Unsalted', 'زبدة غير مملحة بلين سوليه', '200 g', '200 غ', 'model_written', '{}'::text[], '{"name":"Beurre","brands":null,"quantity":null,"last_modified":"2023-02-07T13:09:31.000Z"}'::jsonb),
('AK-0054', 'Plein Soleil Edam Cheese Block', 'جبنة أيدام بلوك', 'Plein Soleil', 'By weight (pre-pack)', 'Plein Soleil Edam Cheese Block', 'جبنة أيدام بلوك', null, null, 'catalog', '{}'::text[], null),
('AK-0055', 'Hawa Chicken White Eggs 30Pcs', null, 'Hawa Chicken', 'Each', 'Hawa Chicken White Eggs', 'بيض أبيض هوا تشيكن', '30 pieces', '30 حبة', 'model_written', '{}'::text[], null),
('AK-0056', 'Candia Laban Full Fat 1Kg', null, 'Candia', 'Each', 'Candia Laban Full Fat', 'لبن كاملة الدسم كانديا', '1 kg', '1 كغ', 'model_written', '{}'::text[], '{"name":"Laban entier","brands":"Candia","quantity":"1 kg","last_modified":"2026-03-02T16:34:33.000Z"}'::jsonb),
('AK-0057', 'Dairy Khoury Greek Yogurt Apricot Low Fat 175G', null, 'Dairy Khoury', 'Each', 'Dairy Khoury Greek Yogurt Apricot Low Fat', 'زبادي يوناني مشمش قليل الدسم دايري خوري', '175 g', '175 غ', 'model_written', '{}'::text[], '{"name":"Khoury greek yoghurt","brands":"Dairy Khoury","quantity":null,"last_modified":"2026-03-24T13:42:56.000Z"}'::jsonb),
('AK-0058', 'Happy Basket Red Eggs Naylon 15Pcs', null, 'Happy Basket', 'Each', 'Happy Basket Red Eggs Naylon', 'بيض أحمر happy basket نايلون', '15 pieces', '15 حبة', 'model_written', '{}'::text[], null),
('AK-0059', 'Double Creme /Kg', null, 'Leentaanayel', 'By weight (pre-pack)', 'Leentaanayel Double Cream', 'كريمة دابل ليانتانايل', null, null, 'model_written', array['cream']::text[], null),
('AK-0060', 'Liban Lait Halloum Entier 250G', null, 'Liban Lait', 'Each', 'Liban Lait Halloum Entier', 'حلوم كامل ليبان لايت', '250 g', '250 غ', 'model_written', '{}'::text[], '{"name":"Libanlai halloum","brands":null,"quantity":null,"last_modified":"2026-05-24T07:23:17.000Z"}'::jsonb),
('AK-0061', 'Lurpak Butter Unsalted 200G', null, 'Lurpak', 'Each', 'Lurpak Unsalted Butter', 'زبدة لورباك غير مملحة', '200 g', '200 غ', 'model_written', '{}'::text[], null),
('AK-0062', 'Picon Simply 8 Portions 112G', null, 'Picon', 'Each', 'Picon Simply 8 Portions', 'بيكون سيمبلي 8 حصص', '112 g', '112 غ', 'model_written', '{}'::text[], '{"name":"Simply- picon","brands":"Picon, Bel","quantity":null,"last_modified":"2026-03-25T23:54:58.000Z"}'::jsonb),
('AK-0063', 'Kiri Cream Cheese 12 Portions 200G', null, 'Kiri', 'Each', 'Kiri Cream Cheese 12 Portions', 'جبنة كريمية كيري 12 حصة', '200 g', '200 غ', 'model_written', '{}'::text[], '{"name":"Spreadable cream cheese","brands":"Kiri","quantity":"200 g","last_modified":"2026-09-18T12:05:24.000Z"}'::jsonb),
('AK-0064', 'Puck Cooking Cream 500Ml', null, 'Puck', 'Each', 'Puck Cooking Cream', 'كريمة طبخ بوك', '500 ml', '500 مل', 'model_written', '{}'::text[], null),
('AK-0065', 'Akkawi Balady', 'عكاوي بلدي', 'Leentaanayel', 'By weight (pre-pack)', 'Akkawi Balady', 'عكاوي بلدي', null, null, 'catalog', '{}'::text[], null),
('AK-0066', 'President Uht Whipping Cream 35.1% Fat 20Mml', null, 'Président', 'Each', 'President UHT Whipping Cream 35.1% Fat', 'كريمة خفق UHT بريزيدنت 35.1% دسم', '20 cl', '20 سل', 'model_written', '{}'::text[], '{"name":"Président","brands":"Crème fraîche","quantity":"20 cl","last_modified":"2026-10-21T12:49:13.000Z"}'::jsonb),
('AK-0067', 'Candia Uht Lait Entier 1L', null, 'Candia', 'Each', 'Candia UHT Whole Milk', 'حليب كامل الدسم UHT كانديا', '1 L', '1 ل', 'model_written', array['whole', 'milk']::text[], '{"name":"GrandLait Lait Entier","brands":"Candia","quantity":null,"last_modified":"2025-05-09T08:08:46.000Z"}'::jsonb),
('AK-0068', 'Candia Uht Lait Entier 125Ml', null, 'Candia', 'Each', 'Candia UHT Whole Milk', 'حليب كامل الدسم UHT كانديا', '125 ml', '125 مل', 'model_written', array['whole']::text[], '{"name":"candia milk full fat","brands":"Candia, liban lait","quantity":"125ml","last_modified":"2022-08-31T12:31:59.000Z"}'::jsonb),
('AK-0069', 'Candia Milk Full Fat 180Ml', null, 'Candia', 'Each', 'Candia Milk Full Fat', 'حليب كامل الدسم كانديا', '180 ml', '180 مل', 'model_written', '{}'::text[], '{"name":"Candia grand lait","brands":null,"quantity":null,"last_modified":"2026-01-14T08:43:37.000Z"}'::jsonb),
('AK-0070', 'Candia Grand Lait Demi-Écrémé 1L', null, 'Candia', 'Each', 'Candia Grand Lait Demi-Écrémé', 'كانديا غراند لاي نصف مقشود', '1 L', '1 ل', 'model_written', '{}'::text[], '{"name":"Candia Lait Uht Demi Ecreme","brands":"Candia","quantity":"1litre","last_modified":"2026-02-06T02:03:46.000Z"}'::jsonb),
('AK-0071', 'Candia Silhouette Uht Lait Écrémé 1L', null, 'Candia', 'Each', 'Candia Silhouette UHT Skimmed Milk', 'حليب خالي الدسم UHT سيلويت كانديا', '1 L', '1 ل', 'model_written', array['skimmed']::text[], '{"name":"Candia milk Fat free","brands":"Candia","quantity":null,"last_modified":"2025-11-30T13:12:23.000Z"}'::jsonb),
('AK-0072', 'Poppins Cereal Bar Choco Bits 25G', null, 'Poppins', 'Each', 'Poppins Cereal Bar Choco Bits', 'بار حبوب بوبينز قطع شوكولاتة', '25 g', '25 غ', 'model_written', '{}'::text[], '{"name":"Choco bits","brands":"Poppins - choco bita","quantity":null,"last_modified":"2025-11-22T16:42:49.000Z"}'::jsonb),
('AK-0073', 'Nadec Uht Milk Full Fat 1L', null, 'Nadec', 'Each', 'Nadec UHT Milk Full Fat', 'حليب نادك كامل الدسم UHT', '1 L', '1 ل', 'model_written', '{}'::text[], '{"name":"نادك حليب 1 لتر","brands":"nadec","quantity":"1litre","last_modified":"2026-10-28T14:02:47.000Z"}'::jsonb),
('AK-0074', 'Nadec Uht Milk Low Fat 1L', null, 'Nadec', 'Each', 'Nadec UHT Milk Low Fat', 'حليب نادك قليل الدسم UHT', '1 L', '1 ل', 'model_written', '{}'::text[], '{"name":"Nadec milk low fat","brands":"نادك","quantity":"1 liter","last_modified":"2026-04-30T09:18:50.000Z"}'::jsonb),
('AK-0075', 'Klio Powder Milk 750G', null, 'Klio', 'Each', 'Klio Powder Milk', 'حليب مجفف كليو', '750 g', '750 غ', 'model_written', '{}'::text[], null),
('AK-0076', 'Klim Milk Powder Pouch 750G', null, 'Klim', 'Each', 'Klim Milk Powder Pouch', 'كليم حليب مجفف كيس', '750 g', '750 غ', 'model_written', '{}'::text[], null),
('AK-0077', 'Poppins Corn Flakes 20G', null, 'Poppins', 'Each', 'Poppins Corn Flakes', 'بوبينز رقائق الذرة', '20 g', '20 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2024-01-18T09:44:00.000Z"}'::jsonb),
('AK-0078', 'Kellogg''s Corn Flakes 750G', null, 'Kellogg''s', 'Each', 'Kellogg''s Corn Flakes The Original', 'كيلوغز كورن فليكس', '750 g', '750 غ', 'model_written', '{}'::text[], '{"name":"Kelloggs corn flakes the original","brands":"Kellogg''s Corn Flakes","quantity":"750g","last_modified":"2026-10-22T11:53:08.000Z"}'::jsonb),
('AK-0079', 'Piston White', 'فرنجي بيستون أبيض', 'Wooden Bakery', 'Each', 'Wooden Bakery Piston White', 'فرنجي بيستون أبيض', null, null, 'catalog', '{}'::text[], null),
('AK-0080', 'Al Forno Pita White Bread Big 800G', null, 'Al Forno', 'Each', 'Al Forno Pita White Bread Big', 'آل فورنو خبز بيتا أبيض كبير', '800 g', '800 غ', 'model_written', '{}'::text[], null),
('AK-0081', 'Wooden Bakery Pita White Bread Big 800G', null, 'Wooden Bakery', 'Each', 'Wooden Bakery Pita White Bread Big', 'وودن بيكيري خبز بيتا أبيض كبير', '800 g', '800 غ', 'model_written', '{}'::text[], '{"name":"Pita Big","brands":"Wooden Bakery","quantity":null,"last_modified":"2026-09-15T19:04:51.000Z"}'::jsonb),
('AK-0082', 'Wooden Bakery Pita White Medium 400G', null, 'Wooden Bakery', 'Each', 'Wooden Bakery Pita White Medium', 'وودن بيكيري خبز بيتا أبيض وسط', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"W B Bread Arabic White Big","brands":"Wooden Bakery","quantity":null,"last_modified":"2026-07-26T22:25:28.000Z"}'::jsonb),
('AK-0083', 'Al Forno Piston Plain 5 Pieces', 'خبز فرنجي سادة', 'Al Forno', 'Each', 'Al Forno Piston Plain', 'خبز فرنجي سادة', '5 pieces', '5 حبة', 'catalog', '{}'::text[], null),
('AK-0084', 'Wooden Bakery Mini Guette Rustique White', 'خبز رستيك أبيض', 'Wooden Bakery', 'Each', 'Wooden Bakery Mini Guette Rustique White', 'خبز رستيك أبيض', null, null, 'catalog', '{}'::text[], null),
('AK-0085', 'Pain D''or Pain Au Lait 9 Pieces 300G', null, 'Pain D''Or', 'Each', 'Pain D''Or Pain Au Lait 9 Pieces', 'پان دور خبز بالحليب', '300 g', '300 غ', 'model_written', '{}'::text[], '{"name":"Pain au Lait","brands":"Pain D’or","quantity":null,"last_modified":"2025-07-14T22:52:59.000Z"}'::jsonb),
('AK-0086', 'Pain D''or Arabic Bread 900G (7 Loaves)', null, 'Pain D''Or', 'Each', 'Pain D''Or Arabic Bread', 'پان دور خبز عربي', '900 g (7 loaves)', '900 غ (7 أرغفة)', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2022-10-03T14:23:12.000Z"}'::jsonb),
('AK-0088', 'Tannour El Asser High Fiber Bread Light 5 Pieces', null, 'Tannour El Asser', 'Each', 'Tannour El Asser High Fiber Bread Light', 'تنور العصر خبز light', '5 pieces', '5 حبات', 'model_written', '{}'::text[], '{"name":"tannour alasr light","brands":null,"quantity":null,"last_modified":"2022-10-05T10:28:17.000Z"}'::jsonb),
('AK-0089', 'Tannour El Asser Oat Bread Large 5 Loaves', null, 'Tannour El Asser', 'Each', 'Tannour El Asser Oat Bread Large', 'تنور العصر خبز شوفان كبير', '5 loaves', '5 أرغفة', 'model_written', '{}'::text[], '{"name":"Oat Light Bread","brands":"Tamnour Al ASR","quantity":null,"last_modified":"2026-08-21T10:52:59.000Z"}'::jsonb),
('AK-0090', 'Pain D''or Hot Dog 6 Pieces 330G', null, 'Pain D''Or', 'Each', 'Pain D''Or Hot Dog', 'پان دور خبز هوت دوغ', '6 pieces 330 g', '6 حبات 330 غ', 'model_written', '{}'::text[], '{"name":"Hot Dog Sandwich","brands":"Pain D’Or","quantity":null,"last_modified":"2025-12-06T09:22:19.000Z"}'::jsonb),
('AK-0091', 'Sant Dalmai Turkey Breast', 'صدر حبش', 'Sant Dalmai', 'By weight (pre-pack)', 'Sant Dalmai Turkey Breast', 'صدر حبش', null, null, 'catalog', '{}'::text[], null),
('AK-0092', 'Gorosti Turkey Breast', 'صدر حبش', 'Gorosti', 'By weight (pre-pack)', 'Gorosti Turkey Breast', 'صدر حبش', null, null, 'catalog', '{}'::text[], null),
('AK-0093', 'Al Mouna Mortadella Beef With Olives', null, 'Al Mouna', 'By weight (pre-pack)', 'Al Mouna Mortadella Beef With Olives', 'مورديلا لحم بقر مع زيتون', null, null, 'model_written', '{}'::text[], null),
('AK-0094', 'Toulkarem Smoked Turkey Breast', 'صدر حبش مدخن', 'Toulkarem', 'By weight (pre-pack)', 'Toulkarem Smoked Turkey Breast', 'صدر حبش مدخن', null, null, 'catalog', '{}'::text[], null),
('AK-0095', 'Tanmia Mortadella Beef Plain', null, 'Tanmia', 'By weight (pre-pack)', 'Tanmia Mortadella Beef Plain', 'موردیلا لحم بقر سادة', null, null, 'model_written', '{}'::text[], null),
('AK-0096', 'Tanmia Mortadelle Beef Aux Olives', null, 'Tanmia', 'By weight (pre-pack)', 'Tanmia Mortadella Beef With Olives', 'موردیلا لحم بقر مع زيتون', null, null, 'model_written', array['mortadella', 'with']::text[], null),
('AK-0097', 'Toulkarem Pepperoni', 'بيبيروني', 'Toulkarem', 'By weight (pre-pack)', 'Toulkarem Pepperoni', 'بيبيروني', null, null, 'catalog', '{}'::text[], null),
('AK-0098', 'Toulkarem Beef Pepperoni', null, 'Toulkarem', 'By weight (pre-pack)', 'Toulkarem Beef Pepperoni', 'بيبيروني لحم بقر', null, null, 'model_written', '{}'::text[], null),
('AK-0099', 'Mamig''s Kitchen Garlic Ready To Eat 200G', null, 'Mamig''S', 'Each', 'Mamig''s Kitchen Garlic Ready To Eat', 'ممينغز كيتشن ثوم جاهز للأكل', '200 g', '200 غ', 'model_written', '{}'::text[], '{"name":"Garlic","brands":null,"quantity":null,"last_modified":"2023-04-28T12:08:47.000Z"}'::jsonb),
('AK-0100', 'Chef Simsum Garlic Paste 200G', null, 'Chef Simsum', 'Each', 'Chef Simsum Garlic Paste', 'شيف سمسم معجون ثوم', '200 g', '200 غ', 'model_written', '{}'::text[], null),
('AK-0101', 'Mamig''s Kitchen Hommos Ready 270G', null, 'Mamig''S', 'Each', 'Mamig''s Kitchen Hommos Ready', 'حمص جاهز ممعج كيتشن', '270 g', '270 غ', 'model_written', '{}'::text[], null),
('AK-0102', 'Aqua Family 10L', null, 'Aqua Family', 'Each', 'Aqua Family', 'أكوا فاملي', '10 L', '10 ل', 'model_written', '{}'::text[], null),
('AK-0103', 'Tannourine Mineral Water 2L X6', null, 'Tannourine', 'Each', 'Tannourine Mineral Water', 'مياه معدنية تنورين', '6 x 2 L', '6 × 2 ل', 'model_written', '{}'::text[], null),
('AK-0104', 'Tannourine Mineral Water 500Ml X 12', null, 'Tannourine', 'Each', 'Tannourine Mineral Water', 'مياه معدنية تنورين', '12 x 500 ml', '12 × 500 مل', 'model_written', '{}'::text[], null),
('AK-0105', 'Tannourine Mineral Water 330Ml X 12', null, 'Tannourine', 'Each', 'Tannourine Mineral Water', 'مياه معدنية تنورين', '12 x 330 ml', '12 × 330 مل', 'model_written', '{}'::text[], null),
('AK-0106', 'Talaya Sparkling Water Lemon Lime 330Ml', null, 'Talaya', 'Each', 'Talaya Sparkling Water Lemon Lime', 'مياه تالايا الفوارة بالليمون والليم', '330 ml', '330 مل', 'model_written', '{}'::text[], null),
('AK-0107', 'Rim Mineral Water 2L X 6', null, 'Rim', 'Each', 'Rim Mineral Water', 'مياه معدنية ريم', '6 x 2 L', '6 × 2 ل', 'model_written', '{}'::text[], null),
('AK-0108', 'Sohat Mineral Water 1.5L X6', null, 'Sohat', 'Each', 'Sohat Mineral Water', 'مياه معدنية صحت', '6 x 1.5 L', '6 × 1.5 ل', 'model_written', '{}'::text[], null),
('AK-0109', 'Tannourine Mineral Water Gallon 6L', null, 'Tannourine', 'Each', 'Tannourine Mineral Water Gallon', 'مياه معدنية تنورين غالون', '6 L', '6 ل', 'model_written', '{}'::text[], '{"name":"Tannourine Gallon 6L","brands":null,"quantity":null,"last_modified":"2024-08-11T07:37:45.000Z"}'::jsonb),
('AK-0110', 'Nejmeh Mineral Water 2L', null, 'Nejmeh', 'Each', 'Nejmeh Mineral Water', 'مياه معدنية نجمة', '2 L', '2 ل', 'model_written', '{}'::text[], null),
('AK-0111', 'Nestle Pure Life Water 0.6L X12', null, 'Nestle', 'Each', 'Nestle Pure Life Water', 'مياه نستله بيور لايف', '12 x 0.6 L', '12 × 0.6 ل', 'model_written', '{}'::text[], null),
('AK-0112', 'Pepsi Carbonated Drink Diet 330Ml', null, 'Pepsi', 'Each', 'Pepsi Carbonated Drink Diet', 'مشروب بيبسي غازي دايت', '330 ml', '330 مل', 'model_written', '{}'::text[], '{"name":"Diet Pepsi 330 ml","brands":"Pepsi","quantity":"330 ml","last_modified":"2026-03-21T02:29:50.000Z"}'::jsonb),
('AK-0113', 'Pepsi Soft Drink Bottle Diet 2.25L', null, 'Pepsi', 'Each', 'Pepsi Soft Drink Bottle Diet', 'مشروب بيبسي غازي دايت', '2.25 L', '2.25 ل', 'model_written', '{}'::text[], null),
('AK-0114', 'Top Juice Pineapple 190Ml', null, 'Top', 'Each', 'Top Juice Pineapple', 'عصير توب أناناس', '190 ml', '190 مل', 'model_written', '{}'::text[], '{"name":"Pineapple Flavored Drink","brands":null,"quantity":null,"last_modified":"2022-07-11T21:15:25.000Z"}'::jsonb),
('AK-0115', 'Pepsi Carbonated Drink 2.25L', null, 'Pepsi', 'Each', 'Pepsi Carbonated Drink', 'مشروب بيبسي غازي', '2.25 L', '2.25 ل', 'model_written', '{}'::text[], null),
('AK-0116', 'Pepsi Soft Drink Diet 1.25L', null, 'Pepsi', 'Each', 'Pepsi Soft Drink Diet', 'مشروب بيبسي غازي دايت', '1.25 L', '1.25 ل', 'model_written', '{}'::text[], '{"name":"Pepsi Diet","brands":"Pepsi","quantity":null,"last_modified":"2026-03-26T00:08:56.000Z"}'::jsonb),
('AK-0117', 'Pepsi Carbonated Drink 330Ml', null, 'Pepsi', 'Each', 'Pepsi Carbonated Drink', 'مشروب بيبسي غازي', '330 ml', '330 مل', 'model_written', '{}'::text[], '{"name":"Pepsi","brands":"Pepsi","quantity":null,"last_modified":"2024-01-30T08:53:02.000Z"}'::jsonb),
('AK-0118', 'Dark Blue Energy Drink 330Ml', null, 'Dark Blue', 'Each', 'Dark Blue Energy Drink', 'مشروب الطاقة دارك بلو', '330 ml', '330 مل', 'model_written', '{}'::text[], '{"name":"Energy Drink","brands":"Drak Blue","quantity":null,"last_modified":"2026-03-03T19:02:43.000Z"}'::jsonb),
('AK-0119', 'Mr Juicy Juice Pineapple 180Ml', null, 'Mr Juicy', 'Each', 'Mr Juicy Juice Pineapple', 'عصير مستر جوسي أناناس', '180 ml', '180 مل', 'model_written', '{}'::text[], '{"name":"Mr juicy","brands":null,"quantity":"180ml","last_modified":"2026-03-27T23:21:28.000Z"}'::jsonb),
('AK-0120', 'Candia Juice Fruits Rouges Nectar 180Ml', null, 'Candia', 'Each', 'Candia Juice Fruits Rouges Nectar', 'نكتار كانديا فواكه حمراء', '180 ml', '180 مل', 'model_written', '{}'::text[], null),
('AK-0121', '7Up Soft Drink Bottle 330Ml', null, '7Up', 'Each', '7Up Soft Drink Bottle', 'مشروب 7Up غازي', '330 ml', '330 مل', 'model_written', '{}'::text[], '{"name":"Seven up","brands":"7UP","quantity":"330 ml","last_modified":"2023-06-07T12:10:26.000Z"}'::jsonb),
('AK-0122', 'Lipton Ice Tea Tropical Zero Sugar 320Ml', null, 'Lipton', 'Each', 'Lipton Ice Tea Tropical Zero Sugar', 'شاي مثلج ليبتون استوائي زيرو سكر', '320 ml', '320 مل', 'model_written', '{}'::text[], '{"name":"Ice tea Zero sugar Tropical passionfruit & mango","brands":"Lipton","quantity":"320 mL","last_modified":"2026-05-06T23:12:14.000Z"}'::jsonb),
('AK-0123', 'Lipton Ice Tea Red Fruits Zero Sugar 320Ml', null, 'Lipton', 'Each', 'Lipton Ice Tea Red Fruits Zero Sugar', 'شاي مثلج ليبتون فواكه حمراء زيرو سكر', '320 ml', '320 مل', 'model_written', '{}'::text[], '{"name":"Ice tea red fruits zero sugar","brands":"Lipton","quantity":null,"last_modified":"2023-09-21T15:25:27.000Z"}'::jsonb),
('AK-0124', '7Up Carbonated Soft Drink 2.25L', null, '7Up', 'Each', '7Up Carbonated Soft Drink', 'مشروب 7Up غازي', '2.25 L', '2.25 ل', 'model_written', '{}'::text[], '{"name":"Seven up","brands":"7UP","quantity":null,"last_modified":"2023-07-26T10:20:30.000Z"}'::jsonb),
('AK-0125', 'Joocyz Juice Pineapple 1L', null, 'Joocyz', 'Each', 'Joocyz Juice Pineapple', 'عصير جوسيز أناناس', '1 L', '1 ل', 'model_written', '{}'::text[], null),
('AK-0126', 'Mirinda Carbonated Drink Orange Bottle 330Ml', null, 'Mirinda', 'Each', 'Mirinda Carbonated Drink Orange Bottle', 'ميرندا مشروب غازي برتقال زجاجة', '330 ml', '330 مل', 'model_written', '{}'::text[], '{"name":"Miranda","brands":null,"quantity":null,"last_modified":"2026-03-26T04:27:46.000Z"}'::jsonb),
('AK-0127', 'Uno Juice Mango 1L', null, 'Uno', 'Each', 'Uno Juice Mango', 'أونو عصير مانغو', '1 L', '1 ل', 'model_written', '{}'::text[], '{"name":"MANGO","brands":null,"quantity":null,"last_modified":"2026-03-24T05:30:09.000Z"}'::jsonb),
('AK-0128', 'Joocyz Juice Apple 1L', null, 'Joocyz', 'Each', 'Joocyz Juice Apple', 'جوسيز عصير تفاح', '1 L', '1 ل', 'model_written', '{}'::text[], null),
('AK-0129', 'Vitalis Energy Drink Tropical 250Ml', null, 'Vitalis', 'Each', 'Vitalis Energy Drink Tropical', 'فيتاليس مشروب طاقة استوائي', '250 ml', '250 مل', 'model_written', '{}'::text[], null),
('AK-0130', 'Cafe21 2In1 Instant Coffee No Sugar 12G', null, 'Cafe21', 'Each', 'Cafe21 2in1 Instant Coffee No Sugar', 'كافيه 21 قهوة سريعة التحضير 2 في 1 بدون سكر', '12 g', '12 غ', 'model_written', '{}'::text[], '{"name":"Cafe 21 2in1 Instant Coffeemix Sticks","brands":null,"quantity":null,"last_modified":"2026-05-29T05:56:26.000Z"}'::jsonb),
('AK-0131', 'Nescafe Instant Coffee 3In1 Classic 20G', null, 'Nescafe', 'Each', 'Nescafe Instant Coffee 3in1 Classic', 'نسكافيه قهوة سريعة التحضير 3 في 1 كلاسيك', '20 g', '20 غ', 'model_written', '{}'::text[], '{"name":"Nescafe 3 in 1","brands":"Nescafé","quantity":"20g *24 pcs","last_modified":"2026-07-25T23:44:33.000Z"}'::jsonb),
('AK-0132', 'Coffee Mate Coffee Creamer Original Pouch 450G', null, 'Coffee Mate', 'Each', 'Coffee Mate Coffee Creamer Original Pouch', 'كوفي ميت مبيض قهوة أوريجينال كيس', '450 g', '450 غ', 'model_written', '{}'::text[], '{"name":"Coffee Mate","brands":"Nestlé","quantity":"450 g","last_modified":"2026-03-14T06:04:58.000Z"}'::jsonb),
('AK-0133', 'Najjar Cafe Classic Normal 180G', null, 'Najjar', 'Each', 'Najjar Cafe Classic Normal', 'النجار قهوة كلاسيك عادية', '180 g', '180 غ', 'model_written', '{}'::text[], null),
('AK-0134', 'Tora Bika Cappucino 25G', null, 'Tora Bika', 'Each', 'Tora Bika Cappuccino', 'توراбيكا كابتشينو', '25 g', '25 غ', 'model_written', '{}'::text[], '{"name":"Torabika Cappuccino","brands":"Kopiko","quantity":"25g","last_modified":"2026-10-25T08:05:59.000Z"}'::jsonb),
('AK-0135', 'Nescafe Instant Coffee Gold Pouch 100G', null, 'Nescafe', 'Each', 'Nescafe Instant Coffee Gold Pouch', 'نسكافيه قهوة سريعة التحضير غولد كيس', '100 g', '100 غ', 'model_written', '{}'::text[], '{"name":"nescafe","brands":null,"quantity":null,"last_modified":"2026-05-06T23:12:08.000Z"}'::jsonb),
('AK-0136', 'Tchibo Instant Coffee Gold Selection 200G', null, 'Tchibo', 'Each', 'Tchibo Instant Coffee Gold Selection', 'تشيبو قهوة سريعة التحضير جولد سيلكشن', '200 g', '200 غ', 'model_written', '{}'::text[], '{"name":"Gold Selection","brands":"Tchibo","quantity":"200 g","last_modified":"2026-10-16T10:24:27.000Z"}'::jsonb),
('AK-0137', 'Najjar Instant Coffee Red 190G', null, 'Najjar', 'Each', 'Najjar Instant Coffee Red', 'النجار قهوة سريعة التحضير حمراء', '190 g', '190 غ', 'model_written', '{}'::text[], '{"name":"najar","brands":null,"quantity":null,"last_modified":"2025-08-05T07:22:55.000Z"}'::jsonb),
('AK-0138', 'Najjar Cafe Cardamom 180G', null, 'Najjar', 'Each', 'Najjar Cafe Cardamom', 'النجار قهوة هيل', '180 g', '180 غ', 'model_written', '{}'::text[], null),
('AK-0139', 'Najjar Star Café Coffee Regular 180G', null, 'Najjar', 'Each', 'Najjar Star Café Coffee Regular', 'النجار ستار كافيه قهوة عادية', '180 g', '180 غ', 'model_written', '{}'::text[], null),
('AK-0140', 'Lipton Yellow Label Tea 100 Teabags', null, 'Lipton', 'Each', 'Lipton Yellow Label Tea', 'ليبتون ييلو لايبل شاي', '100 teabags', '100 كيس شاي', 'model_written', '{}'::text[], '{"name":"Yellow label tea","brands":null,"quantity":null,"last_modified":"2020-07-23T00:30:59.000Z"}'::jsonb),
('AK-0141', 'Domo Hot Chocolate Drink Caramel Light 10G', null, 'Domo', 'Each', 'Domo Hot Chocolate Drink Caramel Light', 'دومو مشروب شوكولاتة ساخنة كراميل لايت', '10 g', '10 غ', 'model_written', '{}'::text[], '{"name":"Hot choco drink light","brands":null,"quantity":null,"last_modified":"2026-03-21T17:11:28.000Z"}'::jsonb),
('AK-0142', 'Lipton Yellow Label Black Tea 25 Bags', null, 'Lipton', 'Each', 'Lipton Yellow Label Black Tea', 'ليبتون ييلو لايبل شاي أسود', '25 bags', '25 كيس', 'model_written', '{}'::text[], null),
('AK-0143', 'Maestro Ceylon Tea 140G', null, 'Maestro', 'Each', 'Maestro Ceylon Tea', 'مايسترو شاي سيلان', '140 g', '140 غ', 'model_written', '{}'::text[], null),
('AK-0144', 'Solen Vip Cocoa Coated 25G', null, 'Solen', 'Each', 'Solen Vip Cocoa Coated', 'سولن فيب كاكاو مغلف', '25 g', '25 غ', 'model_written', '{}'::text[], '{"name":"VIP","brands":"Chocolate","quantity":"25g","last_modified":"2025-09-13T23:56:01.000Z"}'::jsonb),
('AK-0145', 'Lu Nouba Wafer 17.5G', null, 'Lu', 'Each', 'Lu Nouba Wafer', 'لو نوبا ويفر', '17.5 g', '17.5 غ', 'model_written', '{}'::text[], '{"name":"Gâteau Nouba","brands":"LU, Mondelez","quantity":"17,5g","last_modified":"2026-11-13T08:26:44.000Z"}'::jsonb),
('AK-0146', 'Kinder Choco Wafer Tronky 18G', null, 'Kinder', 'Each', 'Kinder Choco Wafer Tronky', 'كيندر ويفر تروني بالشوكولاتة', '18 g', '18 غ', 'model_written', '{}'::text[], '{"name":"tronky t1","brands":"Kinder","quantity":null,"last_modified":"2026-11-04T20:04:31.000Z"}'::jsonb),
('AK-0148', 'Kinder Chocolate Barrette Maxi 21G', null, 'Kinder', 'Each', 'Kinder Chocolate Barrette Maxi', 'كيندر بار شوكولاتة ماكسي', '21 g', '21 غ', 'model_written', '{}'::text[], '{"name":"Kinder Riegel Einzelpackung","brands":"Kinder","quantity":"21g","last_modified":"2026-11-04T09:10:55.000Z"}'::jsonb),
('AK-0149', 'Ulker Albeni Chocolate Bar 25G', null, 'Ulker', 'Each', 'Ulker Albeni Chocolate Bar', 'أولكر ألبيني بار شوكولاتة', '25 g', '25 غ', 'model_written', '{}'::text[], null),
('AK-0150', 'Tiffany Wafer Chocolate Break 3 Fingers 23.5G', null, 'Tiffany', 'Each', 'Tiffany Wafer Chocolate Break 3 Fingers', 'تيفاني ويفر شوكولاتة بريك 3 أصابع', '23.5 g', '23.5 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2026-06-06T03:27:55.000Z"}'::jsonb),
('AK-0151', 'Nutella Spread Chocolate Hazelnut 750G', null, 'Nutella', 'Each', 'Nutella Chocolate Hazelnut Spread', 'نوتيلا كريمة البندق بالشوكولاتة', '750 g', '750 غ', 'model_written', '{}'::text[], '{"name":"Nutella","brands":"Ferrero","quantity":"825g","last_modified":"2026-03-12T22:56:44.000Z"}'::jsonb),
('AK-0152', 'Ulker Metro Chocolate 36G', null, 'Ulker', 'Each', 'Ulker Metro Chocolate', 'أولكر ميترو شوكولاتة', '36 g', '36 غ', 'model_written', '{}'::text[], '{"name":"metro klasik","brands":"ULKER","quantity":"36 G","last_modified":"2026-09-26T09:55:26.000Z"}'::jsonb),
('AK-0153', 'Oreo Cookie Biscuit 38G', null, 'Oreo', 'Each', 'Oreo Cookie Biscuit', 'أوريو بسكويت كوكيز', '38 g', '38 غ', 'model_written', '{}'::text[], '{"name":"Oreo Cookies","brands":"Oreo","quantity":"36.8g","last_modified":"2026-11-11T12:14:15.000Z"}'::jsonb),
('AK-0154', 'Snack Jiha Chips Peanuts 25G', null, 'Snack Jiha', 'Each', 'Snack Jiha Chips Peanuts', 'سناك جيها شيبس فول سوداني', '25 g', '25 غ', 'model_written', '{}'::text[], null),
('AK-0155', 'Ulker Ulker Chocolate Baton Pistachio 14G', null, 'Ulker', 'Each', 'Ulker Chocolate Baton Pistachio', 'أولكر بطارية شوكولاتة فستق', '14 g', '14 غ', 'model_written', '{}'::text[], null),
('AK-0156', 'Al Arabiya Tahina 400G', null, 'Al Arabiya', 'Each', 'Al Arabiya Tahina', 'العربية طحينة', '400 g', '400 غ', 'model_written', '{}'::text[], null),
('AK-0157', 'Elegance Stars Biscuits Black Chocolate 34G', null, 'Elegance', 'Each', 'Elegance Stars Biscuits Black Chocolate', 'إليجانس بسكويت ستارز بالشوكولاتة السوداء', '34 g', '34 غ', 'model_written', '{}'::text[], '{"name":"Stars chocolat biscuit","brands":"Elegance","quantity":null,"last_modified":"2022-07-07T06:14:24.000Z"}'::jsonb),
('AK-0159', 'Coffee Joy Biscuits Coffee 45G', null, 'Coffee Joy', 'Each', 'Coffee Joy Biscuits Coffee', 'كوفي جوي بسكويت قهوة', '45 g', '45 غ', 'model_written', '{}'::text[], '{"name":"Coffee Joy","brands":"Mayora","quantity":"39g","last_modified":"2026-09-15T12:37:18.000Z"}'::jsonb),
('AK-0160', 'Dolsi Chips Crunchy Peanuts Puffs 80G', null, 'Dolsi', 'Each', 'Dolsi Chips Crunchy Peanuts Puffs', 'دولسي شيبس فول سوداني منفوخ مقرمش', '80 g', '80 غ', 'model_written', '{}'::text[], '{"name":"crunchy peanuts puffs","brands":null,"quantity":null,"last_modified":"2023-06-03T17:32:16.000Z"}'::jsonb),
('AK-0161', 'Master Chips Salt 65G', null, 'Master', 'Each', 'Master Chips Salt', 'ماستر شيبس ملح', '65 g', '65 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2025-05-31T05:33:51.000Z"}'::jsonb),
('AK-0162', 'Nutella Spread Chocolate Hazelnut 350G', null, 'Nutella', 'Each', 'Nutella Chocolate Hazelnut Spread', 'نوتيلا كريمة البندق بالشوكولاتة', '350 g', '350 غ', 'model_written', '{}'::text[], '{"name":"Nutella +10% Gratuit,","brands":"Ferrero","quantity":null,"last_modified":"2026-03-24T01:43:57.000Z"}'::jsonb),
('AK-0163', 'Master Chips Cocktail 100G', null, 'Master', 'Each', 'Master Chips Cocktail', 'ماستر شيبس كوكتيل', '100 g', '100 غ', 'model_written', '{}'::text[], '{"name":"Cocktail","brands":"Master","quantity":null,"last_modified":"2025-08-21T19:10:58.000Z"}'::jsonb),
('AK-0164', 'Dolsi Chips Cheezy Wizz 80G', null, 'Dolsi', 'Each', 'Dolsi Chips Cheezy Wizz', 'دولسي شيبس تشيزي ويز', '80 g', '80 غ', 'model_written', '{}'::text[], '{"name":"Cheesy wizz","brands":"Dolsi","quantity":null,"last_modified":"2026-08-17T09:07:52.000Z"}'::jsonb),
('AK-0165', 'Dolsi Chips Crunchy Pizza Puffs 80G', null, 'Dolsi', 'Each', 'Dolsi Chips Crunchy Pizza Puffs', 'دولسي شيبس بيتزا منفوخ مقرمش', '80 g', '80 غ', 'model_written', '{}'::text[], '{"name":"Crunchy pizza puffs","brands":null,"quantity":null,"last_modified":"2025-01-30T20:49:26.000Z"}'::jsonb),
('AK-0166', 'Krikita Cashew Pow Fried Salted 14G', null, 'Krikita', 'Each', 'Krikita Cashew Pow Fried Salted', 'كريكيتا كاجو باو مقلي مملح', '14 g', '14 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2026-05-18T07:14:50.000Z"}'::jsonb),
('AK-0167', 'Clorets Gum Original Mint 12 Pieces 16.8G', null, 'Clorets', 'Each', 'Clorets Gum Original Mint 12 Pieces', 'كلورتس علكة نعناع أصلي 12 قطعة', '16.8 g', '16.8 غ', 'model_written', '{}'::text[], '{"name":"Clorets","brands":"Clorets","quantity":"14 g (5 dh )","last_modified":"2026-04-16T16:36:41.000Z"}'::jsonb),
('AK-0168', 'El Rashidi El Mizan Jam Strawberry 340G', null, 'El Rashidi El Mizan', 'Each', 'El Rashidi El Mizan Jam Strawberry', 'الرشيدي الميزان مربى فراولة', '340 g', '340 غ', 'model_written', '{}'::text[], '{"name":"Premium jam","brands":null,"quantity":null,"last_modified":"2023-05-30T21:40:44.000Z"}'::jsonb),
('AK-0169', 'Castania Peanuts 18G', null, 'Castania', 'Each', 'Castania Peanuts', 'كастانيا فول سوداني', '18 g', '18 غ', 'model_written', '{}'::text[], '{"name":"Peanuts","brands":"Castania","quantity":null,"last_modified":"2025-07-04T21:02:53.000Z"}'::jsonb),
('AK-0170', 'Mentos Incredible Chew Strawberry 45G', null, 'Mentos', 'Each', 'Mentos Incredible Chew Strawberry', 'منتوس إنكредибل تشيو فراولة', '45 g', '45 غ', 'model_written', '{}'::text[], '{"name":"Mentos strawberry flavor","brands":"Mentos","quantity":null,"last_modified":"2025-12-10T16:59:51.000Z"}'::jsonb),
('AK-0171', 'Snickers Chocolate Bar Caramel & Peanuts 45G', null, 'Snikers', 'Each', 'Snickers Chocolate Bar Caramel & Peanuts', 'سنيكرز قطعة شوكولاتة كراميل وفول سوداني', '45 g', '45 غ', 'model_written', '{}'::text[], '{"name":"سنكرز","brands":"سنكرز","quantity":"40g","last_modified":"2026-11-10T11:02:05.000Z"}'::jsonb),
('AK-0172', 'Maggi Stock Cubes Chicken 20G', null, 'Maggi', 'Each', 'Maggi Stock Cubes Chicken', 'ماجي مكعبات مرق دجاج', '20 g', '20 غ', 'model_written', '{}'::text[], '{"name":"Maggie Cube Stock 20GM","brands":null,"quantity":null,"last_modified":"2026-03-18T04:40:33.000Z"}'::jsonb),
('AK-0173', 'Indomie Noodles Chicken 70G', null, 'Indomie', 'Each', 'Indomie Noodles Chicken', 'إندومي نودلز دجاج', '70 g', '70 غ', 'model_written', '{}'::text[], '{"name":"Indomie instant noodles baladi chicken flavor","brands":"indomie","quantity":"70g","last_modified":"2026-08-23T22:01:40.000Z"}'::jsonb),
('AK-0174', 'Indomie Noodles Vegetable Flavor 56G', null, 'Indomie', 'Each', 'Indomie Noodles Vegetable Flavor', 'إندومي نودلز بنكهة الخضار', '56 g', '56 غ', 'model_written', '{}'::text[], '{"name":"vegetable instant noodle from indomie","brands":"indomie","quantity":null,"last_modified":"2026-07-17T17:20:19.000Z"}'::jsonb),
('AK-0175', 'Barilla Spaghetti N'' 5 500G', null, 'Barilla', 'Each', 'Barilla Spaghetti N° 5', 'باريلا سباغيتي رقم 5', '500 g', '500 غ', 'model_written', '{}'::text[], '{"name":"Spaghetti Nº5","brands":"Barilla, BARILLA NORGE ASbarilla","quantity":"500 g","last_modified":"2026-11-08T07:22:23.000Z"}'::jsonb),
('AK-0176', 'Maggi Stock Cubes Beef 20G', null, 'Maggi', 'Each', 'Maggi Stock Cubes Beef', 'مرق مكعبات مجي بالبقر', '20 g', '20 غ', 'model_written', '{}'::text[], null),
('AK-0177', 'Taj Stock Cube Chicken 20G', null, 'Taj', 'Each', 'Taj Stock Cube Chicken', 'مكعب مرق تاج بالدجاج', '20 g', '20 غ', 'model_written', '{}'::text[], null),
('AK-0178', 'Ousraty Mixed Aleppo Thyme 400G', null, 'Ossraty', 'Each', 'Ousraty Mixed Aleppo Thyme', 'أسرتي زعتر حلبي مشكل', '400 g', '400 غ', 'model_written', '{}'::text[], null),
('AK-0179', 'Arbella Tagliatelle 400G', null, 'Arbella', 'Each', 'Arbella Tagliatelle', 'أربيلا تاغلياتيلي', '400 g', '400 غ', 'model_written', '{}'::text[], null),
('AK-0180', 'Deroni Red Split Lentils Vacuum 900G', null, 'Deroni', 'Each', 'Deroni Red Split Lentils Vacuum', 'عدس أحمر مقشر دِروني مفرّغ من الهواء', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0181', 'Divella Spaghetti N8 500G', null, 'Divella', 'Each', 'Divella Spaghetti N8', 'سباغيتي ديفيلا رقم 8', '500 g', '500 غ', 'model_written', '{}'::text[], '{"name":"Spaghetti Ristorante 8","brands":"Divella","quantity":"500 g - 17.6 oz","last_modified":"2026-10-30T09:45:42.000Z"}'::jsonb),
('AK-0182', 'Deroni Vermicelli 500G', null, 'Deroni', 'Each', 'Deroni Vermicelli', 'شعيرية دِروني', '500 g', '500 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2025-07-11T19:29:00.000Z"}'::jsonb),
('AK-0183', 'Abu Rashed Indian Basmati Rice 4Kg', null, 'Abo Rashed', 'Each', 'Abu Rashed Indian Basmati Rice', 'أرز بسمتي هندي أبو راشد', '4 kg', '4 كغ', 'model_written', '{}'::text[], null),
('AK-0184', 'Abou Rached Basmati Rice 800G', null, 'Abou Rached', 'Each', 'Abou Rached Basmati Rice', 'أرز بسمتي أبو رشيد', '800 g', '800 غ', 'model_written', '{}'::text[], null),
('AK-0185', 'Deroni Italian Rice 900G', null, 'Deroni', 'Each', 'Deroni Italian Rice', 'أرز إيطالي دِروني', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0186', 'Deroni Green Lentils Vacuum 900G', null, 'Deroni', 'Each', 'Deroni Green Lentils Vacuum', 'عدس أخضر دِروني مفرّغ من الهواء', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0187', 'Domo Corn Flour 200G', null, 'Domo', 'Each', 'Domo Corn Flour', 'طحين ذرة دومو', '200 g', '200 غ', 'model_written', '{}'::text[], '{"name":"Amidon de mais","brands":"Domo","quantity":"200 g","last_modified":"2026-03-26T13:05:45.000Z"}'::jsonb),
('AK-0188', 'Gold Medal Flour 1Kg', null, 'Gold Medal', 'Each', 'Gold Medal Flour', 'طحين غولد ميدال', '1 kg', '1 كغ', 'model_written', '{}'::text[], '{"name":"Gold medal","brands":null,"quantity":null,"last_modified":"2025-12-16T08:22:35.000Z"}'::jsonb),
('AK-0189', 'Zain Lentils Adass Majrouch 900G', null, 'Zain', 'Each', 'Zain Lentils Adass Majrouch', 'زين عدس أصفر مجروش', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0190', 'Burghul, coarse', 'برغل خشن', 'Local (unbranded)', '1 kg bag', 'Burghul, Coarse', 'برغل خشن', null, null, 'catalog', '{}'::text[], null),
('AK-0191', 'Prime Sweet Corn Can 340G', null, 'Prime line', 'Each', 'Prime Sweet Corn Can', 'ذرة حلوة برايم', '340 g', '340 غ', 'model_written', '{}'::text[], null),
('AK-0192', 'Chtoura Garden Fava Beans 400G', null, 'Chtoura Garden', 'Each', 'Chtoura Garden Fava Beans', 'فول شتورة غاردن', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":null,"brands":"Chtoura Garden","quantity":"Nettogewicht 475g, Abtropfgewicht 310g","last_modified":"2026-03-13T03:03:45.000Z"}'::jsonb),
('AK-0193', 'Plein Soleil Sweet Corn 340G', null, 'Plein Soleil', 'Each', 'Plein Soleil Sweet Corn', 'ذرة حلوة بلان سوليه', '340 g', '340 غ', 'model_written', '{}'::text[], '{"name":"Plein Soleil Sweet Corn","brands":"Plein Soleil","quantity":"340g, 250g Drained","last_modified":"2022-02-23T12:21:07.000Z"}'::jsonb),
('AK-0195', 'Siblou White Tuna In Oil 185G X3', null, 'Siblou', 'Each', 'Siblou White Tuna In Oil', 'تونا أبيض سيبلو بالزيت', '3 x 185 g', '3 × 185 غ', 'model_written', '{}'::text[], null),
('AK-0196', 'Plein Soleil White Tuna Oil 185G X3', null, 'Plein Soleil', 'Each', 'Plein Soleil White Tuna In Oil', 'تونا أبيض بلان سوليه بالزيت', '3 x 185 g', '3 × 185 غ', 'model_written', array['in']::text[], '{"name":"White tuna","brands":null,"quantity":null,"last_modified":"2023-02-06T14:29:01.000Z"}'::jsonb),
('AK-0197', 'Siblou White Tuna In Water 185G', null, 'Siblou', 'Each', 'Siblou White Tuna In Water', 'تونا أبيض سيبلو بالماء', '185 g', '185 غ', 'model_written', '{}'::text[], '{"name":"Siblou White Tuna In Water Solid","brands":null,"quantity":null,"last_modified":"2026-03-26T04:49:34.000Z"}'::jsonb),
('AK-0198', 'Cortas Hommos Tahina 400G', null, 'Cortas', 'Each', 'Cortas Hommos Tahina', 'حمص طحينة كورتاس', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"Hummos Tahina","brands":"Cortas","quantity":"400g","last_modified":"2026-09-03T10:56:46.000Z"}'::jsonb),
('AK-0199', 'Al Wadi Al Akhdar Sweet Corn 340G', null, 'Al Wadi Al Akhdar', 'Each', 'Al Wadi Al Akhdar Sweet Corn', 'ذرة حلوة الوادي الأخضر', '340 g', '340 غ', 'model_written', '{}'::text[], '{"name":"Sliced mushrooms","brands":null,"quantity":null,"last_modified":"2020-02-12T14:04:20.000Z"}'::jsonb),
('AK-0200', 'Chtoura Garden Boiled Chick Peas 400G', null, 'Chtoura Garden', 'Each', 'Chtoura Garden Boiled Chick Peas', 'حمص معلب شتورة غاردن', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"حمص معلب","brands":"Chtoura Garden","quantity":"475g","last_modified":"2026-03-13T10:35:12.000Z"}'::jsonb),
('AK-0201', 'Cortas Foul Medammas 400G', null, 'Cortas', 'Each', 'Cortas Foul Medammas', 'فول مدمس كورتاس', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"Foul Medammas","brands":"Cortas","quantity":"400 g","last_modified":"2023-12-04T08:50:51.000Z"}'::jsonb),
('AK-0202', 'Al Taghziah Luncheon Chicken Round 200G', null, 'Al Taghziah', 'Each', 'Al Taghziah Luncheon Chicken Round', 'لانشون دجاج مستدير التغذية', '200 g', '200 غ', 'model_written', '{}'::text[], null),
('AK-0203', 'Tanmia Chicken Luncheon Meat Easy Open Can 200G', null, 'Tanmia', 'Each', 'Tanmia Chicken Luncheon Meat Easy Open Can', 'لحم لانشون دجاج تنمية علبة سهلة الفتح', '200 g', '200 غ', 'model_written', '{}'::text[], '{"name":"Chicken luncheons","brands":null,"quantity":null,"last_modified":"2022-10-04T08:27:08.000Z"}'::jsonb),
('AK-0204', 'Green olives', 'زيتون أخضر', 'Local (unbranded)', 'jar', 'Green Olives', 'زيتون أخضر', null, null, 'catalog', '{}'::text[], null),
('AK-0205', 'Black olives', 'زيتون أسود', 'Local (unbranded)', 'jar', 'Black Olives', 'زيتون أسود', null, null, 'catalog', '{}'::text[], null),
('AK-0206', 'Mixed pickles', 'كبيس مشكل', 'Local (unbranded)', 'jar', 'Mixed Pickles', 'كبيس مشكل', null, null, 'catalog', '{}'::text[], null),
('AK-0207', 'Zer Sunflower Oil 3L', null, 'Zer', 'Each', 'Zer Sunflower Oil', 'زر زيت عباد الشمس', '3 L', '3 ل', 'model_written', '{}'::text[], null),
('AK-0208', 'Yamama Tomato Paste 1325G', null, 'Yamama', 'Each', 'Yamama Tomato Paste', 'معجون طماطم ياماما', '1325 g', '1325 غ', 'model_written', '{}'::text[], '{"name":"Tomato Paste","brands":"Yamama","quantity":"1325 g","last_modified":"2026-09-19T01:01:03.000Z"}'::jsonb),
('AK-0209', 'Yamama White Vinegar 1L', null, 'Yamama', 'Each', 'Yamama White Vinegar', 'خل أبيض ياماما', '1 L', '1 ل', 'model_written', '{}'::text[], '{"name":"white vinegar","brands":"Yamama","quantity":"1l","last_modified":"2026-11-03T04:57:41.000Z"}'::jsonb),
('AK-0210', 'Yamama Tomato Paste 660G', null, 'Yamama', 'Each', 'Yamama Tomato Paste', 'معجون طماطم ياماما', '660 g', '660 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2023-08-19T22:51:41.000Z"}'::jsonb),
('AK-0211', 'Plein Soleil Mayonnaise 250Ml', null, 'Plein Soleil', 'Each', 'Plein Soleil Mayonnaise', 'مايونيز بلاين سوليي', '250 ml', '250 مل', 'model_written', '{}'::text[], null),
('AK-0212', 'Pomi Strained Tomatoes 500G', null, 'Pomi', 'Each', 'Pomi Strained Tomatoes', 'طماطم مصفاة بومي', '500 g', '500 غ', 'model_written', '{}'::text[], '{"name":"Passata di pomodoro","brands":"Pomì","quantity":"500 g","last_modified":"2026-03-17T08:39:09.000Z"}'::jsonb),
('AK-0213', 'Plein Soleil Sunflower Oil 5L', null, 'Plein Soleil', 'Each', 'Plein Soleil Sunflower Oil', 'زيت عباد الشمس بلاين سوليي', '5 L', '5 ل', 'model_written', '{}'::text[], null),
('AK-0214', 'Dolly''s Tomato Ketchup 330G', null, 'Dolly''s', 'Each', 'Dolly''s Tomato Ketchup', 'كاتشب طماطم دولي', '330 g', '330 غ', 'model_written', '{}'::text[], '{"name":"Dollys","brands":null,"quantity":null,"last_modified":"2022-01-29T17:01:33.000Z"}'::jsonb),
('AK-0215', 'Dolly''s Ketchup 900G', null, 'Dolly''s', 'Each', 'Dolly''s Ketchup', 'كاتشب دولي', '900 g', '900 غ', 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":"900 g","last_modified":"2024-04-29T06:40:13.000Z"}'::jsonb),
('AK-0216', 'Lina Sunflower Oil 0.85L', null, 'Lina', 'Each', 'Lina Sunflower Oil', 'زيت عباد الشمس لينا', '0.85 L', '0.85 ل', 'model_written', '{}'::text[], null),
('AK-0217', 'Al Koura Olive Oil 500Ml', null, 'Al Koura Products', 'Each', 'Al Koura Olive Oil', 'زيت زيتون الكورة', '500 ml', '500 مل', 'model_written', '{}'::text[], null),
('AK-0218', 'Yamama Grenadine Molasses 300Ml', null, 'Yamama', 'Each', 'Yamama Grenadine Molasses', 'دبس رمان ياماما', '300 ml', '300 مل', 'model_written', '{}'::text[], '{"name":"Yamama Grenadine Molasses Syrup","brands":"Yamama","quantity":"300 ml","last_modified":"2026-10-12T14:36:27.000Z"}'::jsonb),
('AK-0219', 'Al Wazir Olive Oil 500Ml', null, 'Al Wazir', 'Each', 'Al Wazir Olive Oil', 'زيت زيتون الوزير', '500 ml', '500 مل', 'model_written', '{}'::text[], null),
('AK-0220', 'Deroni Hot Sauce 88Ml', null, 'Deroni', 'Each', 'Deroni Hot Sauce', 'صلصة حارة درونи', '88 ml', '88 مل', 'model_written', '{}'::text[], null),
('AK-0221', 'Maxim''s Salt Iodised 700G', null, 'Maxim''S', 'Each', 'Maxim''s Iodised Salt', 'ملح مكرر مع اليود ماكسيمز', '700 g', '700 غ', 'model_written', '{}'::text[], '{"name":"Sel maxim''s","brands":"Maxim''s","quantity":null,"last_modified":"2026-03-14T17:16:06.000Z"}'::jsonb),
('AK-0222', 'El Hanim Ghee Vegetable 0.7Kg', null, 'El hanim', 'Each', 'El Hanim Ghee Vegetable', 'سمنة الهانم', '0.7 kg', '0.7 كغ', 'model_written', '{}'::text[], null),
('AK-0223', 'Deroni Sugar 900G', null, 'Deroni', 'Each', 'Deroni Sugar', 'سكر درونи', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0224', 'Domo Jelly Strawberry 85G', null, 'Domo', 'Each', 'Domo Strawberry Jelly', 'هلام فراولة دومو', '85 g', '85 غ', 'model_written', '{}'::text[], '{"name":"Domo Gelatin Jelly Strawberry","brands":null,"quantity":null,"last_modified":"2026-03-19T05:48:48.000Z"}'::jsonb),
('AK-0225', 'Domo Sugar Vanillin 5G', null, 'Domo', 'Each', 'Domo Vanillin Sugar', 'سكر فانيلين دومو', '5 g', '5 غ', 'model_written', '{}'::text[], null),
('AK-0226', 'Domo Bicarbonate 85G', null, 'Domo', 'Each', 'Domo Bicarbonate', 'دومو بيكربونات', '85 g', '85 غ', 'model_written', '{}'::text[], null),
('AK-0227', 'Domo Baking Powder Sachet 10G', null, 'Domo', 'Each', 'Domo Baking Powder Sachet', 'دومو بيكنغ باودر ساشيه', '10 g', '10 غ', 'model_written', '{}'::text[], null),
('AK-0228', 'Deroni Sugar 5Kg', null, 'Deroni', 'Each', 'Deroni Sugar', 'دَيروني سكر', '5 kg', '5 كغ', 'model_written', '{}'::text[], null),
('AK-0229', 'Aruba Jelly Strawberry Light 12G', null, 'Aruba', 'Each', 'Aruba Jelly Strawberry Light', 'أروبا هلام فراولة لايت', '12 g', '12 غ', 'model_written', '{}'::text[], null),
('AK-0230', 'Aruba Jelly Forest Fruits Light 12G', null, 'Aruba', 'Each', 'Aruba Jelly Forest Fruits Light', 'أروبا هلام فواكه الغابة لايت', '12 g', '12 غ', 'model_written', '{}'::text[], '{"name":"Light jelly","brands":null,"quantity":null,"last_modified":"2022-10-04T19:08:22.000Z"}'::jsonb),
('AK-0231', 'Lotussweets Ice Cream 1Kg', null, 'Lotussweets', 'Each', 'Lotussweets Ice Cream', 'لوتس سويتس آيس كريم', '1 kg', '1 كغ', 'model_written', '{}'::text[], null),
('AK-0232', 'Dolsi Vegas With Caramel Filling', null, 'Dolsi', 'Each', 'Dolsi Vegas With Caramel Filling', 'دولسي فيغاس بحشوة الكراميل', null, null, 'model_written', '{}'::text[], '{"name":null,"brands":null,"quantity":null,"last_modified":"2026-04-16T15:38:48.000Z"}'::jsonb),
('AK-0233', 'Ocean Crab Sticks Surimi 250G', null, 'Ocean', 'Each', 'Ocean Crab Sticks Surimi', 'أوشن أعواد سرطان سوريمي', '250 g', '250 غ', 'model_written', '{}'::text[], null),
('AK-0234', 'Dolsi Amarena With Natural Strawberry Filling', null, 'Dolsi', 'Each', 'Dolsi Amarena With Natural Strawberry Filling', 'دولسي أمارينا بحشوة الفراولة الطبيعية', null, null, 'model_written', '{}'::text[], null),
('AK-0235', 'Plein Soleil Frozen Green Peas Fine 400G', null, 'Plein Soleil', 'Each', 'Plein Soleil Frozen Green Peas Fine', 'بلين سوليه بازلاء خضراء مجمدة ناعمة', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"Plein soliel green peas","brands":null,"quantity":null,"last_modified":"2025-12-16T14:11:08.000Z"}'::jsonb),
('AK-0236', 'Tanmia Frozen Chicken Nuggets 520G', null, 'Tanmia', 'Each', 'Tanmia Frozen Chicken Nuggets', 'تنمية ناغتس دجاج مجمد', '520 g', '520 غ', 'model_written', '{}'::text[], null),
('AK-0237', 'Plein Soleil Frozen Peas & Carrots Mix Fine & Sweet 400G', null, 'Plein Soleil', 'Each', 'Plein Soleil Frozen Peas & Carrots Mix Fine & Sweet', 'بلين سوليه خليط بازلاء وجزر مجمد ناعم وحلو', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"Peas & Carrots Mix","brands":"Plein Soleil","quantity":"400 g","last_modified":"2026-08-11T17:05:10.000Z"}'::jsonb),
('AK-0238', 'Foody''s Frozen Green Peas 400G', null, 'Foody''s', 'Each', 'Foody''s Frozen Green Peas', 'فودиз بازلاء خضراء مجمدة', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"foody''s green peas","brands":"foody''s","quantity":null,"last_modified":"2026-06-26T19:23:29.000Z"}'::jsonb),
('AK-0239', 'Liban Frites Frz Home French Fries 900G', null, 'Liban Frites', 'Each', 'Liban Frites Frozen Home French Fries', 'ليبان فرايتس بطاطا مقلية منزلية مجمدة', '900 g', '900 غ', 'model_written', array['frozen']::text[], null),
('AK-0240', 'Seafin Frozen White Fish Pangasius Fillet 1Kg', null, 'Seafin', 'Each', 'Seafin Frozen White Fish Pangasius Fillet', 'سيفين فيلية سمك بانغاسيوس أبيض مجمد', '1 kg', '1 كغ', 'model_written', '{}'::text[], '{"name":"Pangasius Fillets","brands":"Seafin","quantity":null,"last_modified":"2024-05-01T05:54:21.000Z"}'::jsonb),
('AK-0241', 'Plein Soleil Frozen Mulukhieh Leaves 400G', null, 'Plein Soleil', 'Each', 'Plein Soleil Frozen Mulukhieh Leaves', 'بلين سوليه ورق ملوخية مجمد', '400 g', '400 غ', 'model_written', '{}'::text[], '{"name":"Mulukhieh leaves","brands":null,"quantity":null,"last_modified":"2025-12-16T14:06:17.000Z"}'::jsonb),
('AK-0242', 'Take N Bake Frozen Pizza Vegetarian Small 350G', null, 'Take N Bake', 'Each', 'Take N Bake Frozen Pizza Vegetarian Small', 'تيك إن بيك بيتزا نباتية صغيرة مجمدة', '350 g', '350 غ', 'model_written', '{}'::text[], null),
('AK-0243', 'Take N Bake Frozen Pizza Pepperoni Small 350G', null, 'Take N Bake', 'Each', 'Take N Bake Frozen Pizza Pepperoni Small', 'تيك إن بيك بيتزا بيبروني صغيرة مجمدة', '350 g', '350 غ', 'model_written', '{}'::text[], null),
('AK-0244', 'Foody''s Crispy French Fries Straight Cut 900G', null, 'Foody''s', 'Each', 'Foody''s Crispy French Fries Straight Cut', 'فودиз بطاطا مقلية مقرمشة قطع مستقيمة', '900 g', '900 غ', 'model_written', '{}'::text[], null),
('AK-0245', 'Foody''s Frozen Crispy Chicken Strips 500G', null, 'Foody''s', 'Each', 'Foody''s Frozen Crispy Chicken Strips', 'فودиз شرائح دجاج مقرمشة مجمدة', '500 g', '500 غ', 'model_written', '{}'::text[], null),
('AK-0246', 'Foody''s Frozen Crispy Chicken Nuggets 500G', null, 'Foody''s', 'Each', 'Foody''s Frozen Crispy Chicken Nuggets', 'فودиз ناغتس دجاج مقرمش مجمد', '500 g', '500 غ', 'model_written', '{}'::text[], null),
('AK-0247', 'Eti Gong Corn & Rice Cake Original 32G', null, 'Eti', 'Each', 'Eti Gong Corn & Rice Cake Original', 'إيتي غونغ كعك الذرة والأرز الأصلي', '32 g', '32 غ', 'model_written', '{}'::text[], '{"name":"Gong original","brands":"Eti","quantity":"32 g","last_modified":"2026-03-29T15:19:21.000Z"}'::jsonb),
('AK-0248', 'Balance Protein Crackers Sour Cream & Onion 70G', null, 'Balance', 'Each', 'Balance Protein Crackers Sour Cream & Onion', 'بالانس مقرمشات بروتين كريمة حامضة وبصل', '70 g', '70 غ', 'model_written', '{}'::text[], '{"name":"Sour Cream & Onions Protein Crackers","brands":"Balance","quantity":null,"last_modified":"2026-10-17T11:44:57.000Z"}'::jsonb),
('AK-0249', 'Spartan Toilet Cleaner Flash 1L', null, 'Spartan', 'Each', 'Spartan Toilet Cleaner Flash', 'سبارتان منظف مراحيض فلاش', '1 L', '1 ل', 'model_written', '{}'::text[], null),
('AK-0250', 'Perla Interfold Prime White', null, 'Perla', 'Each', 'Perla Interfold Prime White', 'بيرلا إنترفولد برايم وايت', null, null, 'model_written', '{}'::text[], null),
('AK-0251', 'Vimax Trash Bags Large Blue 30 Pieces', null, 'Vimax', 'Each', 'Vimax Trash Bags Large Blue', 'أكياس زبالة فيماكس كبيرة زرقاء', '30 pieces', '30 حبة', 'model_written', '{}'::text[], null),
('AK-0252', 'Vimax Trash Bags Medium Black 30 Pieces', null, 'Vimax', 'Each', 'Vimax Trash Bags Medium Black', 'أكياس زبالة فيماكس متوسطة سوداء', '30 pieces', '30 حبة', 'model_written', '{}'::text[], null),
('AK-0253', 'April Interfold 150G', null, 'April', 'Each', 'April Interfold', 'أبريل إنترفولد', '150 g', '150 غ', 'model_written', '{}'::text[], null),
('AK-0254', 'Al Ousra Facial Tissue 200Sh', null, 'Al Ousra', 'Each', 'Al Ousra Facial Tissue', 'العائلة مناديل وجه', '200 sheets', '200 ورقة', 'model_written', '{}'::text[], null),
('AK-0255', 'Vimax Dishwashing Liquid Lemon 700Ml', null, 'Vimax', 'Each', 'Vimax Dishwashing Liquid Lemon', 'فيماكس سائل جلي ليمون', '700 ml', '700 مل', 'model_written', '{}'::text[], null),
('AK-0256', 'Odex Bleach Original 1L', null, 'Odex', 'Each', 'Odex Bleach Original', 'أوديكس بليش أوريجينال', '1 L', '1 ل', 'model_written', '{}'::text[], null),
('AK-0257', 'City Plast Sandwich Bag 100 Pieces', null, 'City Plast', 'Each', 'City Plast Sandwich Bag', 'سيتي بلاست أكياس ساندويش', '100 pieces', '100 حبة', 'model_written', '{}'::text[], null),
('AK-0258', 'Odex Bleach Lemon 1200Ml', null, 'Odex', 'Each', 'Odex Bleach Lemon', 'أوديكس بليش ليمون', '1200 ml', '1200 مل', 'model_written', '{}'::text[], null),
('AK-0259', 'Comfort Fabric Softener Lavender 3L', null, 'Comfort', 'Each', 'Comfort Fabric Softener Lavender', 'كومفورت منعم أقمشة لавندر', '3 L', '3 ل', 'model_written', '{}'::text[], null),
('AK-0260', 'Intaj Kitchen Towel X-Large 500G', null, 'Intaj', 'Each', 'Intaj Kitchen Towel X-Large', 'إنتاج ورق مطبخ إكس لارج', '500 g', '500 غ', 'model_written', '{}'::text[], null),
('AK-0261', 'Omo Gel Liquid Laundry Detergent Wash Comfort 2.5L', null, 'Omo', 'Each', 'Omo Gel Liquid Laundry Detergent Wash Comfort', 'أومو جل سائل غسيل ملابس ويش كومفورت', '2.5 L', '2.5 ل', 'model_written', '{}'::text[], null),
('AK-0262', 'Germex Floor Detergent 1L', null, 'Germex', 'Each', 'Germex Floor Detergent', 'جيرمكس منظف أرضيات', '1 L', '1 ل', 'model_written', '{}'::text[], null),
('AK-0263', 'Sanita Liquid Laundry Detergent Fresh Essence 2.5L', null, 'Sanita', 'Each', 'Sanita Liquid Laundry Detergent Fresh Essence', 'سانيتا سائل غسيل ملابس فريش إيسنس', '2.5 L', '2.5 ل', 'model_written', '{}'::text[], null),
('AK-0264', 'Odex Dishwash Liquid Blue 1300Ml', null, 'Odex', 'Each', 'Odex Dishwash Liquid Blue', 'أوديكس سائل جلي أزرق', '1300 ml', '1300 مل', 'model_written', '{}'::text[], null),
('AK-0265', 'Omo Gel Detergent Lavender 2.5L', null, 'Omo', 'Each', 'Omo Gel Detergent Lavender', 'أومو جل منظف لافندر', '2.5 L', '2.5 ل', 'model_written', '{}'::text[], null),
('AK-0266', 'Britex Sponge Easy Grip Jumbo Euro 5Pcs', null, 'Britex', 'Each', 'Britex Sponge Easy Grip Jumbo Euro', 'بريتكس إسفنج إيزي غريب جامبو يورو', '5 pieces', '5 حبة', 'model_written', '{}'::text[], null),
('AK-0267', 'Intaj Toilet Paper 12 Rolls 1.5Kg', null, 'Intaj', 'Each', 'Intaj Toilet Paper 12 Rolls', 'إنتاج ورق حمام 12 رول', '1.5 kg', '1.5 كغ', 'model_written', '{}'::text[], null),
('AK-0268', 'Rosana Toilet Paper 18 Rolls', null, 'Rosana', 'Each', 'Rosana Toilet Paper 18 Rolls', 'روزانا ورق حمام 18 رول', null, null, 'model_written', '{}'::text[], null),
('AK-0269', 'Wellplus Wet Wipes 100 Sheets', null, 'Well Plus', 'Each', 'Wellplus Wet Wipes', 'ويلبلس مناديل مبللة', '100 sheets', '100 ورقة', 'model_written', '{}'::text[], null),
('AK-0270', 'Private Feminine Pads Extra Thin Night 7 Pieces', null, 'Private', 'Each', 'Private Feminine Pads Extra Thin Night', 'فوط نسائية برايفيت رفيعة جدا للّيل', '7 pieces', '7 حبة', 'model_written', '{}'::text[], null),
('AK-0271', 'Private Feminine Pads Extra Thin Normal 10 Pieces', null, 'Private', 'Each', 'Private Feminine Pads Extra Thin Normal', 'فوط نسائية برايفيت رفيعة جدا عادية', '10 pieces', '10 حبة', 'model_written', '{}'::text[], null),
('AK-0272', 'Wellplus Liquid Soap Marrakesh Mystique 500Ml', null, 'Wellplus', 'Each', 'Wellplus Liquid Soap Marrakesh Mystique', 'ويلبلس صابون سائل مراكش ميستيك', '500 ml', '500 مل', 'model_written', '{}'::text[], null),
('AK-0273', 'Wellplus Liquid Soap Sea Breeze 500Ml', null, 'Wellplus', 'Each', 'Wellplus Liquid Soap Sea Breeze', 'ويلبلس صابون سائل سي بريز', '500 ml', '500 مل', 'model_written', '{}'::text[], null),
('AK-0274', 'Mf Cotton Buds Doria', null, 'Cotton Buds', 'Each', 'Mf Cotton Buds Doria', 'إم إف أعواد قطن دوريا', null, null, 'model_written', '{}'::text[], null),
('AK-0275', 'Colgate Toothpaste Triple Action 125Ml', null, 'Colgate', 'Each', 'Colgate Toothpaste Triple Action', 'كولجيت معجون أسنان تربل أكشن', '125 ml', '125 مل', 'model_written', '{}'::text[], null),
('AK-0276', 'Dove Original Beauty Cream Bar 90G', null, 'Dove', 'Each', 'Dove Original Beauty Cream Bar', 'دوف بار كريم بيوتي أوريجينال', '90 g', '90 غ', 'model_written', '{}'::text[], null),
('AK-0277', 'Amalfi Shampoo Anti Caspa 750Ml', null, 'Amalfi', 'Each', 'Amalfi Shampoo Anti Dandruff', 'أمالفي شامبو مضاد للقشرة', '750 ml', '750 مل', 'model_written', array['dandruff']::text[], null),
('AK-0278', 'Fluff''n White Soft Touch Cotton Round Pads 75 Pieces', null, 'Fluff''N White', 'Each', 'Fluff''n White Soft Touch Cotton Round Pads', 'فلوف إن وايت قطن دائري سوفت تتش', '75 pieces', '75 حبة', 'model_written', '{}'::text[], null),
('AK-0279', 'Head & Shoulders Shampoo Sub Zero Freshness 400Ml', null, 'Head & Shoulders', 'Each', 'Head & Shoulders Shampoo Sub Zero Freshness', 'هيد اند شولدرز شامبو سب زيرو', '400 ml', '400 مل', 'model_written', '{}'::text[], null),
('AK-0280', 'Colgate Toothpaste Herbal 125Ml', null, 'Colgate', 'Each', 'Colgate Toothpaste Herbal', 'كولغيت معجون أسنان هيربال', '125 ml', '125 مل', 'model_written', '{}'::text[], null),
('AK-0281', 'Nivea Roll On For Women Extra Brightening 25Ml', null, 'Nivea', 'Each', 'Nivea Roll On For Women Extra Brightening', 'نيفيا رول أون للنساء إكسترا برايتنينغ', '25 ml', '25 مل', 'model_written', '{}'::text[], null),
('AK-0282', 'Nivea Roll On For Women Pearly & Beauty 25Ml', null, 'Nivea', 'Each', 'Nivea Roll On For Women Pearly & Beauty', 'نيفيا رول أون للنساء بيرلي اند بيوتي', '25 ml', '25 مل', 'model_written', '{}'::text[], null),
('AK-0283', 'Gipsy Wet Wipes 100Pcs + Pocket Wipes 40Pcs', null, 'Gipsy', 'Each', 'Gipsy Wet Wipes + Pocket Wipes', 'جيبسي مناديل مبللة + مناديل جيب', '100 pieces + 40 pieces', '100 حبة + 40 حبة', 'model_written', '{}'::text[], null),
('AK-0284', 'Oui Oui Wet Wipes Aqua Pure 80 Sheets', null, 'Oui Oui', 'Each', 'Oui Oui Wet Wipes Aqua Pure', 'وي وي مناديل مبللة أكوا بيور', '80 sheets', '80 ورقة', 'model_written', '{}'::text[], null),
('AK-0285', 'Johnsons Baby Shampoo 750Ml', null, 'Johnson', 'Each', 'Johnson''s Baby Shampoo', 'جونسونز شامبو للأطفال', '750 ml', '750 مل', 'model_written', array['s']::text[], '{"name":"John sons","brands":null,"quantity":null,"last_modified":"2026-08-30T16:21:53.000Z"}'::jsonb),
('AK-0286', 'Oui Oui Diapers Size 6 16-30Kg 32 Pieces', null, 'Oui Oui', 'Each', 'Oui Oui Diapers Size 6 16-30 kg', 'وي وي حفاضات مقاس 6 من 16 إلى 30 كغ', '32 pieces', '32 حبة', 'model_written', array['30', 'kg']::text[], null),
('AK-0287', 'Loulou Baby Diapers Size 6 16-30Kg 26 Pieces', null, 'Loulou', 'Each', 'Loulou Baby Diapers Size 6 16-30 kg', 'لولو حفاضات أطفال مقاس 6 من 16 إلى 30 كغ', '26 pieces', '26 حبة', 'model_written', array['30', 'kg']::text[], null),
('AK-0288', 'Oui Oui Diapers Size 5 12-25Kg 38 Pieces', null, 'Oui Oui', 'Each', 'Oui Oui Diapers Size 5 12-25 kg', 'وي وي حفاضات مقاس 5 من 12 إلى 25 كغ', '38 pieces', '38 حبة', 'model_written', array['25', 'kg']::text[], null),
('AK-0289', 'Miglior Gatto Pate Agnello 400G', null, 'Miglior', 'Each', 'Miglior Gatto Pate Agnello', 'ميليور غاتو باتيه أنييلو', '400 g', '400 غ', 'model_written', '{}'::text[], null),
('AK-0290', 'Miglior Gatto Alutray Cat Agnello 100G', null, 'Miglior', 'Each', 'Miglior Gatto Alutray Cat Agnello', 'ميليور غاتو ألوتراي طعام قطط أنييلو', '100 g', '100 غ', 'model_written', '{}'::text[], null),
('AK-0291', 'Pro Line Marseille Soap Bentonite Cat Litter 5L', null, 'Proline', 'Each', 'Proline Marseille Soap Bentonite Cat Litter', 'برولاين مارسيليا صابون بنتونايت رمل قطط', '5 L', '5 ل', 'model_written', '{}'::text[], null)
on conflict (sku) do nothing;
