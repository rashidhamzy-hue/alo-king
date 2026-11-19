-- Alo King Chouf, session AUTO1, migration 0263 (the number its prompt gave): dishes approved by a rule a person approved.
-- docs/DECISIONS.md, "AUTO1, approvals by rule, 19 November 2026". The founder's decision of 19 November: "a person approves the rule; the rule
-- approves the item". This replaces "every dish approved by a person" (FD1, MENU2) with: a person approved the rule below (version
-- menu-dish-1, recorded in automation_rules), and the rule approves each dish it can check, recorded per dish under a dedicated automation
-- party with the rule and its version, and undone in one tap (automation_undo, 0264's console). Nothing a person must decide is taken away:
--
--   approved by the rule        a dish read from a menu that is CLEAN (menu_dish_clean's tests: a name, a clear price with its currency or
--                               every size priced, no praise or health word) and whose PRICE IS VERIFIED:
--                                 * text sources (a web page's text, pasted text, a Word file, a sheet): every printed price of the dish (its
--                                   price, or each size's) is found in the source text on the dish's own line or block: the line that starts
--                                   with the dish's name, then the lines under it up to the first line that is only a price (menu_price_line);
--                                 * a photo, a PDF or a page read from its screenshot: a SECOND, independent reading of the same source
--                                   (prices only, no sight of the first) gives the same prices (record_menu_second_reading).
--                               A dish whose only flags are about its DESCRIPTION is fixed by the rule first: praise words dropped, a
--                               description cut off in the source trimmed to its last whole phrase (menu_description_fixed); the
--                               description is never a food fact (invariant 15) and the original stays in the log.
--   never by the rule           a "price to confirm" (a range, no price, an unclear price), an unclear name, a name with a praise word, a
--                               dish whose choices or extras carry prices (not verified in this version), a re-import's price change or
--                               removal (a change to what is already on sale), any other flag. They wait in the Approvals inbox, and the
--                               prices to confirm are listed on the place's page with its phone (menu_prices_to_confirm).
--   the stamp                   once nothing of a place waits (no photo, source, page or dish) and a dish was decided after the last stamp,
--                               the rule stamps "menu checked" (stamp_menu_checked). Visibility and approve_merchant() stay a person's tap
--                               (invariant 11): the rule never opens a place.
--   hours and phone             the reader reports the place's opening hours and phone where the source shows them; they are PROPOSED
--                               (place_detail_proposals) and a person applies them with one tap (use_place_detail_proposal, through
--                               set_place_details). Never applied by the rule.
--
-- How the rule acts: automation_party() is a blocked party (it can never act through a role check). place_staff_ok() accepts it only while
-- the transaction-local flag alo.automation = 'dishes' is set, and only automation_run_dishes() sets it, around each review_menu_dish /
-- stamp_menu_checked call it makes. Every decision is a row of automation_decisions (kind, rule, version, what, why, and what is needed to undo
-- it). The switch is settings.automation.dishes.enabled (on by the founder's decision; an admin turns it off or on on the Settings page; the
-- weekly kill-gate of 0264 turns it off by itself).
-- Nothing here writes an order, a payment, stock or the ledger, or opens a place (invariants 3, 11). Prices on sale only from dishes approved
-- through review_menu_dish (invariant 7).

-- ---------- the automation party, the rules, the switch ----------
insert into parties(id, role, display_name, is_blocked, notes)
values ('00000000-0000-4000-8000-0000000000a2', 'picker', 'Automation (a rule a person approved)', true,
        'Session AUTO1. Recorded as the approver of what an AUTO1 rule (automation_rules) decided, with the rule and its version in automation_decisions. Blocked for ever: it passes no role check; place_staff_ok accepts it only inside automation_run_dishes.')
on conflict (id) do nothing;

create or replace function automation_party() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000a2'::uuid $$;

create or replace function automation_party_stays_blocked() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.id = automation_party() and (not new.is_blocked or new.role is distinct from old.role or new.id is distinct from old.id) then
    raise exception 'AUTOMATION_PARTY_LOCKED: the automation party is blocked for ever';
  end if;
  return new;
end $$;
drop trigger if exists parties_automation_party_locked on parties;
create trigger parties_automation_party_locked before update on parties for each row execute function automation_party_stays_blocked();

-- The rules a person approved, by version. A new version is a new row (a migration), approved again.
create table if not exists automation_rules (
  kind        text not null check (kind in ('dish', 'photo')),
  version     text not null,
  words       text not null,                           -- what the rule does, in words, for the console and the founder
  approved_on date not null,
  approved_by text not null,                           -- who approved the rule (a person, by name and how)
  primary key (kind, version)
);
insert into automation_rules(kind, version, words, approved_on, approved_by) values
  ('dish', 'menu-dish-1',
   'A dish is approved when it is clean (a name, a clear price with its currency or every size priced, no praise or health word in its name) and every printed price of it is verified: found in the source text on the dish''s own line or block, or, for a photo, a PDF or a screenshot, given again by a second independent reading. Praise words in a description are dropped and a description cut off in the source is trimmed to its last whole phrase first. Never: a price to confirm, an unclear name, priced choices or extras, a price change or removal on re-import, any other flag. The menu is stamped checked when nothing of the place waits. Visibility and approving the place stay a person''s.',
   date '2026-11-19', 'Rashid (founder decision of 19 November 2026: a person approves the rule; the rule approves the item)')
on conflict do nothing;

insert into settings(key, value) values ('automation', jsonb_build_object(
  'dishes', jsonb_build_object('enabled', true, 'version', 'menu-dish-1'),
  'photos', jsonb_build_object('enabled', true, 'version', 'photo-vision-1', 'min_confidence', 0.9),
  'sample_size', 50, 'max_wrong', 1))
on conflict (key) do nothing;

-- On the Settings page (admin, one person): each rule's switch. Switching one back on after the kill-gate is a person's decision.
insert into editable_settings(key, field, kind, min_value, max_value, max_len, choices, two_person, two_person_when) values
  ('automation', 'dishes.enabled', 'bool', null, null, null, null, false, null),
  ('automation', 'photos.enabled', 'bool', null, null, null, null, false, null)
on conflict (key, field) do nothing;

create or replace function automation_on(p_kind text) returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((setting('automation') -> (case p_kind when 'dish' then 'dishes' when 'photo' then 'photos' else p_kind end) ->> 'enabled')::boolean, false) $$;
create or replace function automation_version(p_kind text) returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(setting('automation') -> (case p_kind when 'dish' then 'dishes' when 'photo' then 'photos' else p_kind end) ->> 'version',
                  (select max(version) from automation_rules where kind = p_kind)) $$;

-- Every decision a rule made. `detail` keeps what an undo needs (the offer before, the description as printed, the picture it replaced).
create table if not exists automation_decisions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('dish', 'photo', 'menu')),
  version     text not null,
  action      text not null check (action in ('approved', 'rejected', 'stamped')),
  target_id   uuid not null,                           -- menu_dish_proposals.id, product_images.id, or the place (sources.id) for a stamp
  product_id  uuid references products(id) on delete set null,
  source_id   uuid references sources(id),
  title       text not null,                           -- the dish or the item, as the list shows it
  reason      text not null,                           -- why, in plain words ("price 7 found in the source line", "shows Masafi, not Nejmeh")
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  undone_at   timestamptz,
  undone_by   uuid references parties(id),
  undo_note   text,
  check ((undone_at is null) = (undone_by is null))
);
create index if not exists automation_decisions_day on automation_decisions(created_at);
create index if not exists automation_decisions_target on automation_decisions(target_id);

-- The place_log learns the undo and the proposed details.
do $$ declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'place_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%' loop
    execute format('alter table place_log drop constraint %I', c.conname);
  end loop;
  alter table place_log add constraint place_log_action_check check (action in ('create', 'details', 'visibility', 'tester_add', 'tester_remove', 'photo',
    'reading', 'reading_failed', 'dish_approve', 'dish_reject', 'menu_checked', 'approve',
    'menu_source', 'source_fetched', 'source_failed', 'dish_off', 'section_approve',
    'dish_back', 'stamp_back', 'details_proposed', 'details_used', 'details_dismissed'));
end $$;

-- 0245's text, and the automation party while (only while) automation_run_dishes acts.
create or replace function place_staff_ok(p_by uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked)
      or (p_by = automation_party() and coalesce(current_setting('alo.automation', true), '') = 'dishes') $$;

-- ---------- price verification ----------
alter table menu_dish_proposals add column if not exists price_check text check (price_check in ('source_text', 'second_reading', 'mismatch', 'not_found'));
alter table menu_dish_proposals add column if not exists price_check_note text check (price_check_note is null or char_length(price_check_note) <= 300);

-- The values a printed number may mean: Arabic-Indic digits read as digits; 450,000 and 450.000 as thousands; 5,5 as 5.5; 1.500 as 1.5 or 1500.
create or replace function menu_token_values(p text) returns numeric[] language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩٫٬', '0123456789.,'); v numeric[] := '{}';
begin
  if t !~ '^[0-9]+([.,][0-9]+)*$' then return v; end if;
  if t ~ '^[0-9]{1,3}(,[0-9]{3})+$' then v := v || replace(t, ',', '')::numeric;
  elsif t ~ '^[0-9]+,[0-9]+$' then v := v || replace(t, ',', '.')::numeric; end if;
  if t ~ '^[0-9]{1,3}(\.[0-9]{3})+$' then v := v || replace(t, '.', '')::numeric; end if;
  if t ~ '^[0-9]+(\.[0-9]+)?$' then v := v || t::numeric; end if;
  return v;
end $$;

-- The numbers on a line, each with the values it may mean.
create or replace function menu_line_values(p text) returns numeric[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(v), '{}') from regexp_matches(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩٫٬', '0123456789.,'), '[0-9]+(?:[.,][0-9]+)*', 'g') m(tok)
   cross join lateral unnest(menu_token_values(m.tok[1])) v $$;

-- A line that is only a price: a number with a currency mark before or after it, or nothing else ("7", "$7", "7 $", "450,000 ل.ل.").
create or replace function menu_price_only(p text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select btrim(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩٫٬', '0123456789.,'))
         ~* '^(\$|usd|lbp|l\.?\s?l\.?|ل\.?\s?ل\.?|ليرة)?\s*[0-9]+([.,][0-9]+)*\s*(\$|usd|lbp|l\.?\s?l\.?|ل\.?\s?ل\.?|ليرة|ألف|الف|k)?\.?$' $$;

-- A line as compared with a dish name: folded, without a leading heading mark, bullet or number ("# ", "- ", "3. ").
create or replace function menu_line_key(p text) returns text language sql immutable set search_path = public, pg_temp as $$
  select fold_text(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*(#+|[-*•·]|[0-9]{1,3}[.)])\s*', ''), '\s+', ' ', 'g')) $$;

-- Size words a dish's line may carry after its name (folded, as menu_line_key gives them).
create or replace function menu_size_words() returns text language sql immutable as $$
  select '(صغير|كبير|وسط|عادي|دبل|سنجل|ساندويش|سندويش|صحن|نصف|نص|كامل|وجبه|small|medium|large|regular|xl|sandwich|plate|half|whole|double|single|meal|petit|grand|moyen)' $$;

-- The source line or block that shows this price for this dish, or null. The block starts at a line that starts with one of the names; a
-- number at the end of that line is its price (a sheet's row, "Shawarma ... 3$"); otherwise the price is the first line under it that is only
-- a price (at most 6 lines down, never past an empty line). Every occurrence of the name is tried (a dish printed once per size).
create or replace function menu_price_line(p_body text, p_names text[], p_price numeric) returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare l text[] := regexp_split_to_array(replace(coalesce(p_body, ''), E'\r', ''), E'\n'); n int; i int; j int; k text; nm text; hit boolean;
        tail text;
begin
  n := coalesce(array_length(l, 1), 0);
  if p_price is null or n = 0 then return null; end if;
  for i in 1 .. n loop
    k := menu_line_key(l[i]); hit := false;
    foreach nm in array coalesce(p_names, '{}') loop
      nm := fold_text(regexp_replace(coalesce(nm, ''), '\s+', ' ', 'g'));
      -- the line is the name, or the name then only a size word, a separator or the price ("Pepsi" is not "Pepsi Plastic")
      if char_length(nm) >= 3 and (k = nm or (left(k, char_length(nm)) = nm and substr(k, char_length(nm) + 1) ~ '^\s'
           and btrim(substr(k, char_length(nm) + 1)) ~* ('^(\||[-–:.…]|' || menu_size_words() || '(\s|$|\|)|(\$|usd|lbp)?\s*[0-9][0-9.,]*\s*(\$|usd|lbp|l\.?\s?l\.?|ل\.?\s?ل\.?)?\.?\s*$)'))) then
        hit := true; exit;
      end if;
    end loop;
    continue when not hit;
    -- the name's own line ends with a number: that is its price
    tail := substring(translate(l[i], '٠١٢٣٤٥٦٧٨٩٫٬', '0123456789.,') from '([0-9]+(?:[.,][0-9]+)*)\s*(?:\$|usd|lbp|l\.?\s?l\.?|ل\.?\s?ل\.?)?\.?\s*$');
    if tail is not null and k <> fold_text(regexp_replace(tail, '\s', '', 'g')) then
      if p_price = any(menu_token_values(tail)) then return left(l[i], 300); end if;
      continue;
    end if;
    for j in i + 1 .. least(n, i + 6) loop
      exit when btrim(l[j]) = '';
      if menu_price_only(l[j]) then
        if p_price = any(menu_line_values(l[j])) then return left(btrim(l[i]) || ' … ' || btrim(l[j]), 300); end if;
        exit;
      end if;
    end loop;
  end loop;
  return null;
end $$;

-- The prices a dish shows: its price, and each size's.
create or replace function menu_dish_prices(p menu_dish_proposals) returns numeric[] language sql immutable set search_path = public, pg_temp as $$
  select array_remove(array[p.price] || coalesce((select array_agg((s->>'price')::numeric) from jsonb_array_elements(p.sizes) s where s->>'price' is not null), '{}'), null) $$;

-- The names to look for: the printed ones (a name the reader wrote itself, `translated`, is not on the source).
create or replace function menu_dish_names(p menu_dish_proposals) returns text[] language sql immutable set search_path = public, pg_temp as $$
  select array_remove(array[case when p.translated is distinct from 'ar' then p.name_ar end, case when p.translated is distinct from 'en' then p.name_en end], null) $$;

-- Is this dish's every price verified? {ok, how, note}. A text source is checked here, against its text; a photo, a PDF or a screenshot by the
-- second reading recorded on the dish (record_menu_second_reading).
create or replace function menu_price_verified(p menu_dish_proposals) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare pg menu_source_pages%rowtype; v numeric; prices numeric[] := menu_dish_prices(p); lines text[] := '{}'; ln text;
begin
  if cardinality(prices) = 0 then return jsonb_build_object('ok', false, 'how', 'none', 'note', 'no price to check'); end if;
  if p.page_id is not null then select * into pg from menu_source_pages where id = p.page_id; end if;
  if p.page_id is not null and coalesce(btrim(pg.body), '') <> '' and pg.doc_path is null then
    foreach v in array prices loop
      ln := menu_price_line(pg.body, menu_dish_names(p), v);
      if ln is null then return jsonb_build_object('ok', false, 'how', 'source_text', 'note', 'price ' || v || ' not found on the dish''s line in the source text'); end if;
      lines := lines || ln;
    end loop;
    return jsonb_build_object('ok', true, 'how', 'source_text', 'note', 'found in the source: ' || left(array_to_string(lines, ' / '), 240));
  end if;
  if p.price_check = 'second_reading' then return jsonb_build_object('ok', true, 'how', 'second_reading', 'note', coalesce(p.price_check_note, 'a second reading gave the same price')); end if;
  return jsonb_build_object('ok', false, 'how', coalesce(p.price_check, 'second_reading'), 'note', coalesce(p.price_check_note, 'no second reading yet'));
end $$;

-- A second, independent reading of a photo, a PDF or a screenshot page: [{name_ar, name_en, prices: [numbers as printed]}]. Each dish of that
-- source still waiting is marked: the same prices (as a set) under the same name = second_reading; the same name with other prices = mismatch.
create or replace function record_menu_second_reading(p_photo uuid, p_page uuid, p_items jsonb, p_model text, p_by uuid) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare d menu_dish_proposals%rowtype; x jsonb; ok int := 0; bad int := 0; none int := 0; v_seen numeric[]; v_match boolean; v_other text;
begin
  if p_by is distinct from menu_reader_party() and not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if (p_photo is null) = (p_page is null) then raise exception 'ONE_SOURCE: a photo or a page'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'ITEMS_REQUIRED'; end if;
  for d in select * from menu_dish_proposals where status = 'waiting' and change is distinct from 'removed'
             and ((p_photo is not null and photo_id = p_photo) or (p_page is not null and page_id = p_page)) for update loop
    v_match := false; v_other := null;
    for x in select * from jsonb_array_elements(p_items) loop
      continue when not menu_same_dish(menu_name_ar(x->'name_ar', x->'name_en'), menu_name_en(x->'name_ar', x->'name_en'), d.name_ar, d.name_en);
      select coalesce(array_agg(distinct v order by v), '{}') into v_seen
        from jsonb_array_elements(case when jsonb_typeof(x->'prices') = 'array' then x->'prices' else '[]'::jsonb end) e
        cross join lateral (select case when jsonb_typeof(e) = 'string' and cardinality(menu_token_values(e #>> '{}')) = 1 then (menu_token_values(e #>> '{}'))[1]
                                         else menu_price(e) end as v) z where v is not null;
      if v_seen = (select coalesce(array_agg(distinct v order by v), '{}') from unnest(menu_dish_prices(d)) v) then v_match := true; exit; end if;
      v_other := array_to_string(v_seen, ', ');
    end loop;
    if v_match then
      update menu_dish_proposals set price_check = 'second_reading', price_check_note = left('a second reading (' || coalesce(p_model, '?') || ') gave the same price', 300) where id = d.id;
      ok := ok + 1;
    elsif v_other is not null then
      update menu_dish_proposals set price_check = 'mismatch', price_check_note = left('the second reading gave ' || coalesce(nullif(v_other, ''), 'no price') || '; the first ' || array_to_string(menu_dish_prices(d), ', '), 300) where id = d.id;
      bad := bad + 1;
    else
      update menu_dish_proposals set price_check = 'not_found', price_check_note = 'the second reading did not find this dish' where id = d.id;
      none := none + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'same', ok, 'mismatch', bad, 'not_found', none);
end $$;

-- ---------- the description, fixed by rule ----------
-- Words a description may not use (0246's names list and 0260's description list), as whole words.
create or replace function menu_praise_pattern() returns text language sql immutable as $$
  select '\m(best|tasty|delicious|healthy|healthier|amazing|perfect|famous|guilt[- ]?free|superfood|number one|juicy|tantaliz\w*|delight\w*|mouth[- ]?watering|irresistible|finest|ultimate|perfectly|heavenly|divine|yummy)\M' $$;
create or replace function menu_praise_pattern_ar() returns text language sql immutable as $$
  select '(^|\s)[^\s]*(أطيب|أحسن|ألذ|لذيذ|صحي|شهي|رائع|مميز)[^\s]*' $$;

-- Drop the praise words; when cut off, keep up to the last whole phrase (the last , . ; ، ؛ or line). Then tidy. Null when nothing is left.
create or replace function menu_description_fixed(p text, p_cut boolean) returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := coalesce(p, ''); fw text := '(a|an|the|and|or|with|for|of|in|on|to|from|by|made|de|et|avec|au|aux|la|le|les|و|مع|في|على|من|او|أو|ب|بـ|الى|إلى)';
        k int;
begin
  t := regexp_replace(t, menu_praise_pattern(), '', 'gi');
  t := regexp_replace(t, menu_praise_pattern_ar(), '\1', 'g');
  t := regexp_replace(t, '[ \t]+', ' ', 'g');
  t := regexp_replace(t, ' +([,.;!،؛])', '\1', 'g');
  t := regexp_replace(t, '([,;،؛])\s*[,;،؛]', '\1', 'g');
  t := btrim(regexp_replace(t, '\s*\n\s*', ' ', 'g'));
  if p_cut and t !~ '[.!?؟]$' then
    -- the position of the last phrase mark: what follows it is the phrase the source cut
    k := coalesce(char_length(t) - char_length(substring(t from '[,;،؛.][^,;،؛.]*$')) , 0);
    if k > 0 then t := left(t, k); end if;
  end if;
  -- a phrase left hanging on a joining word ("…butter, and", "…for a")
  loop
    exit when t !~* ('(^|\s)' || fw || '\s*$');
    t := btrim(regexp_replace(t, '(^|\s)' || fw || '\s*$', '', 'i'));
  end loop;
  t := btrim(regexp_replace(t, '^[,;،؛.\s]+|[,;،؛\s]+$', '', 'g'));
  return nullif(t, '');
end $$;

-- ---------- the rule ----------
-- Why this dish is not for the rule (null: it is). Price verification is asked separately.
create or replace function menu_rule_refusal(p menu_dish_proposals) returns text language sql stable set search_path = public, pg_temp as $$
  select case
    when p.status <> 'waiting' then 'not waiting'
    when exists (select 1 from automation_decisions a where a.target_id = p.id and a.undone_at is not null) then 'the rule''s approval was undone: a person decides'
    when p.change = 'removed' then 'a removal: a person decides what leaves the menu'
    when p.change = 'price_changed' then 'a price change on re-import: a person decides'
    when p.price_status <> 'clear' then 'price to confirm'
    when p.name_ar is null and p.name_en is null then 'no name'
    when menu_name_claim(p.name_ar) or menu_name_claim(p.name_en) or 'name_claim' = any(p.flags) then 'a praise or health word in the name'
    when exists (select 1 from unnest(p.flags) f where f not in ('cut_off', 'description_claim')) then 'flagged: ' || (select string_agg(f, ', ') from unnest(p.flags) f where f not in ('cut_off', 'description_claim'))
    when 'cut_off' = any(p.flags) and (p.description is null or btrim(p.description) ~ '[.!?؟]$') then 'cut off, and not in the description'
    when p.currency is null then 'no currency'
    when p.price is null and (jsonb_array_length(p.sizes) = 0 or exists (select 1 from jsonb_array_elements(p.sizes) s where s->>'price' is null)) then 'no price'
    when exists (select 1 from jsonb_array_elements(p.addons) a where coalesce((a->>'price')::numeric, 0) <> 0)
      or exists (select 1 from jsonb_array_elements(p.options) g, jsonb_array_elements(coalesce(g->'choices', '[]'::jsonb)) c where coalesce((c->>'price_delta')::numeric, 0) <> 0)
      then 'priced choices or extras: a person checks them'
  end $$;

-- What the rule would do with one dish, without doing it: {eligible, reason, verified, description}.
create or replace function menu_rule_view(p menu_dish_proposals) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare r text := menu_rule_refusal(p); v jsonb; d text;
begin
  if r is not null then return jsonb_build_object('eligible', false, 'reason', r); end if;
  v := menu_price_verified(p);
  if not (v->>'ok')::boolean then return jsonb_build_object('eligible', false, 'reason', v->>'note', 'verified', v); end if;
  d := p.description;
  if 'cut_off' = any(p.flags) or 'description_claim' = any(p.flags) or menu_text_claim(p.description) then
    d := menu_description_fixed(p.description, 'cut_off' = any(p.flags));
    if menu_text_claim(d) then return jsonb_build_object('eligible', false, 'reason', 'the description still praises after the fix'); end if;
  end if;
  return jsonb_build_object('eligible', true, 'reason', v->>'note', 'verified', v, 'description', d, 'description_changed', d is distinct from p.description);
end $$;

-- The run: every waiting dish of a place (or of every place) the rule may approve, approved through review_menu_dish as the automation party,
-- each in its own sub-transaction (one refusal never stops the rest), each recorded; then the stamp where nothing waits.
create or replace function automation_run_dishes(p_place uuid default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare d menu_dish_proposals%rowtype; v jsonb; r jsonb; n int := 0; left_ int := 0; v_prod uuid; v_offer jsonb; v_ver text := automation_version('dish');
        v_places uuid[] := '{}'; s uuid; v_title text; stamped int := 0; v_last timestamptz; v_before jsonb; errs int := 0;
begin
  if not automation_on('dish') then return jsonb_build_object('ok', true, 'enabled', false, 'approved', 0); end if;
  for d in select * from menu_dish_proposals where status = 'waiting' and (p_place is null or source_id = p_place) order by source_id, position loop
    v_places := array(select distinct unnest(v_places || d.source_id));
    v := menu_rule_view(d);
    if not (v->>'eligible')::boolean then left_ := left_ + 1; continue; end if;
    -- the dish on sale it would become (review_menu_dish's own lookup), and that offer before
    select p.id into v_prod from products p where p.owner_source_id = d.source_id
       and fold_text(coalesce(p.name_ar, '') || ' ' || p.name_en) = fold_text(coalesce(d.name_ar, '') || ' ' || coalesce(d.name_en, d.name_ar)) limit 1;
    select jsonb_build_object('price_usd', o.price_usd, 'is_available', o.is_available) into v_offer from offers o where o.source_id = d.source_id and o.product_id = v_prod;
    v_title := coalesce(d.name_ar, d.name_en) || coalesce(' · ' || coalesce(d.section_en, d.section_ar), '');
    begin
      perform set_config('alo.automation', 'dishes', true);
      r := review_menu_dish(d.id, automation_party(), true,
             case when (v->>'description_changed')::boolean then jsonb_build_object('description', v->'description') else '{}'::jsonb end,
             left('automatic: rule ' || v_ver || ': ' || (v->>'reason'), 500));
      perform set_config('alo.automation', '', true);
      insert into automation_decisions(kind, version, action, target_id, product_id, source_id, title, reason, detail)
        values ('dish', v_ver, 'approved', d.id, (r->>'product_id')::uuid, d.source_id, left(v_title, 200),
                left((v->>'reason') || case when (v->>'description_changed')::boolean then '; description fixed by rule' else '' end, 500),
                jsonb_build_object('offer_before', v_offer, 'product_before', v_prod, 'description_before', d.description,
                                   'description_after', v->'description', 'verified', v->'verified', 'price_usd', r->'price_usd'));
      n := n + 1;
    exception when others then
      perform set_config('alo.automation', '', true);
      errs := errs + 1; left_ := left_ + 1;
    end;
  end loop;
  -- the stamp: nothing of the place waits, and something was decided since the last stamp
  if p_place is not null then v_places := array(select distinct unnest(v_places || p_place)); end if;
  foreach s in array v_places loop
    continue when exists (select 1 from menu_dish_proposals where source_id = s and status = 'waiting')
               or exists (select 1 from menu_photos where source_id = s and read_status = 'waiting')
               or exists (select 1 from menu_sources where source_id = s and status = 'waiting')
               or exists (select 1 from menu_source_pages where source_id = s and status = 'waiting')
               or not exists (select 1 from offers where source_id = s and is_available and price_usd > 0);
    select max(at) into v_last from place_log where source_id = s and action = 'menu_checked';
    continue when not exists (select 1 from menu_dish_proposals where source_id = s and reviewed_at > coalesce(v_last, '-infinity'::timestamptz));
    select jsonb_build_object('menu_checked_on', menu_checked_on, 'menu_checked_by', menu_checked_by) into v_before from sources where id = s;
    begin
      perform set_config('alo.automation', 'dishes', true);
      perform stamp_menu_checked(s, automation_party());
      perform set_config('alo.automation', '', true);
      insert into automation_decisions(kind, version, action, target_id, source_id, title, reason, detail)
        values ('menu', v_ver, 'stamped', s, s, left(coalesce((select name from sources where id = s), '?'), 200),
                'every dish of the import is decided: menu checked', jsonb_build_object('before', v_before));
      stamped := stamped + 1;
    exception when others then
      perform set_config('alo.automation', '', true);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'enabled', true, 'version', v_ver, 'approved', n, 'left_for_a_person', left_, 'errors', errs, 'stamped', stamped);
end $$;

-- ---------- prices to confirm, with the place's phone (console only: invariant of FD1, place_contacts) ----------
create or replace function menu_prices_to_confirm(p_place uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'phone', (select phone_e164 from place_contacts where source_id = p_place),
    'dishes', coalesce((select jsonb_agg(jsonb_build_object('dish_id', p.id, 'name_ar', p.name_ar, 'name_en', p.name_en, 'section', coalesce(p.section_en, p.section_ar),
                                                            'price_text', p.price_text, 'note', p.flag_note, 'flags', p.flags) order by p.position)
                          from menu_dish_proposals p where p.source_id = p_place and p.status = 'waiting' and p.price_status = 'to_confirm'), '[]'::jsonb)) $$;

-- ---------- the place's hours and phone, read from the source: proposed, a person applies them ----------
create table if not exists place_detail_proposals (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references sources(id),
  hours       jsonb,                                  -- {open, close, days_off} as place_hours_ok takes it, or null
  hours_text  text check (hours_text is null or char_length(hours_text) <= 200),   -- as printed
  phone       text check (phone is null or place_phone_ok(phone)),
  phone_text  text check (phone_text is null or char_length(phone_text) <= 60),
  photo_id    uuid references menu_photos(id),
  page_id     uuid references menu_source_pages(id),
  status      text not null default 'waiting' check (status in ('waiting', 'used', 'dismissed')),
  decided_by  uuid references parties(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (hours is null or place_hours_ok(hours)),
  check (hours is not null or phone is not null or hours_text is not null)
);
create index if not exists place_detail_proposals_waiting on place_detail_proposals(source_id) where status = 'waiting';

-- From a reading: {hours_text, open, close, days_off, phone}. Kept only when it says something the place's record does not already say.
create or replace function record_menu_place_details(p_place uuid, p_photo uuid, p_page uuid, p_details jsonb, p_by uuid) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare s sources%rowtype; v_hours jsonb; v_phone text; v_htext text := menu_text(p_details->'hours_text', 200); v_ptext text := menu_text(p_details->'phone_text', 60);
        v_cur text; v_id uuid;
begin
  if p_by is distinct from menu_reader_party() and not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into s from sources where id = p_place and buys_for_customer;
  if not found then raise exception 'NOT_A_PLACE'; end if;
  if coalesce(p_details->>'open', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and coalesce(p_details->>'close', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_hours := jsonb_build_object('open', p_details->>'open', 'close', p_details->>'close',
                                  'days_off', coalesce((select jsonb_agg(d) from jsonb_array_elements_text(case when jsonb_typeof(p_details->'days_off') = 'array' then p_details->'days_off' else '[]'::jsonb end) d
                                                         where d in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')), '[]'::jsonb));
    if not place_hours_ok(v_hours) then v_hours := null; end if;
  end if;
  v_phone := case when place_phone_ok(p_details->>'phone') then p_details->>'phone' end;
  select phone_e164 into v_cur from place_contacts where source_id = p_place;
  if v_hours is not null and coalesce(s.hours, '{}'::jsonb) @> v_hours and v_hours @> coalesce(s.hours, '{}'::jsonb) then v_hours := null; end if;
  if v_phone is not distinct from v_cur then v_phone := null; end if;
  if v_hours is null and v_phone is null then return jsonb_build_object('ok', true, 'proposed', false); end if;
  if exists (select 1 from place_detail_proposals where source_id = p_place and status = 'waiting' and hours is not distinct from v_hours and phone is not distinct from v_phone) then
    return jsonb_build_object('ok', true, 'proposed', false, 'already', true);
  end if;
  insert into place_detail_proposals(source_id, hours, hours_text, phone, phone_text, photo_id, page_id)
    values (p_place, v_hours, v_htext, v_phone, v_ptext, p_photo, p_page) returning id into v_id;
  insert into place_log(source_id, action, by_party, detail) values (p_place, 'details_proposed', p_by, jsonb_build_object('proposal', v_id, 'hours', v_hours is not null, 'phone', v_phone is not null));
  return jsonb_build_object('ok', true, 'proposed', true, 'id', v_id);
end $$;

-- One tap: the proposed hours and phone go onto the place (set_place_details: the person's own change, logged), or are dismissed.
create or replace function use_place_detail_proposal(p_id uuid, p_by uuid, p_use boolean default true) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare x place_detail_proposals%rowtype; v jsonb := '{}';
begin
  if not place_staff_ok(p_by) or p_by = automation_party() then raise exception 'NOT_AUTHORISED'; end if;
  select * into x from place_detail_proposals where id = p_id for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if x.status <> 'waiting' then return jsonb_build_object('ok', true, 'already', true, 'status', x.status); end if;
  if coalesce(p_use, true) then
    if x.hours is not null then v := v || jsonb_build_object('hours', x.hours); end if;
    if x.phone is not null then v := v || jsonb_build_object('phone', x.phone); end if;
    perform set_place_details(x.source_id, p_by, v);
    update place_detail_proposals set status = 'used', decided_by = p_by, decided_at = now() where id = p_id;
    insert into place_log(source_id, action, by_party, detail) values (x.source_id, 'details_used', p_by, jsonb_build_object('proposal', p_id));
    return jsonb_build_object('ok', true, 'status', 'used');
  end if;
  update place_detail_proposals set status = 'dismissed', decided_by = p_by, decided_at = now() where id = p_id;
  insert into place_log(source_id, action, by_party, detail) values (x.source_id, 'details_dismissed', p_by, jsonb_build_object('proposal', p_id));
  return jsonb_build_object('ok', true, 'status', 'dismissed');
end $$;

create or replace function place_detail_waiting(p_place uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'hours', x.hours, 'hours_text', x.hours_text, 'phone', x.phone, 'phone_text', x.phone_text, 'created_at', x.created_at)
                            order by x.created_at desc), '[]'::jsonb)
    from place_detail_proposals x where x.source_id = p_place and x.status = 'waiting' $$;

-- What the rule would do with each waiting dish of a place (read only; the run's report and the Menus page's note).
create or replace function menu_rule_preview(p_place uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('dish_id', p.id, 'dish', coalesce(p.name_ar, p.name_en), 'section', coalesce(p.section_en, p.section_ar)) || menu_rule_view(p) order by p.position), '[]'::jsonb)
    from menu_dish_proposals p where p.source_id = p_place and p.status = 'waiting' $$;

do $$ declare t text; r text;
begin
  foreach t in array array['automation_rules', 'automation_decisions', 'place_detail_proposals'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant all on table %I to service_role', t); end if;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
