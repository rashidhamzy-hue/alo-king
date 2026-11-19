-- Alo King Chouf, session AUTO1, migration 0264 (the number its prompt gave): pictures decided by a rule a person approved; one-tap undo; the
-- weekly kill-gate; the day's list of automatic decisions. docs/DECISIONS.md, "AUTO1, approvals by rule, 19 November 2026".
--
--   1 pictures       the founder's imports (founder_upload, 0242) and the label day's front photos (proposed here as intake_photo, own_photo)
--                    are checked by a vision function (claude-haiku-5-5 through the Batch API, the photo-check workflow, cap USD 1, model_costs):
--                    does the picture show this item's brand, product type, size or count, and flavour? The DATABASE decides from that answer
--                    (record_photo_check), never the model:
--                      approved   every field matches (size and flavour may be "not applicable"), the answer is "match", its confidence at or
--                                 above settings.automation.photos.min_confidence (0.9), and none of the never-approve marks;
--                      rejected   a confident "mismatch" with a field that does not match, or a never-approve mark (Hebrew text, a health or
--                                 organic claim, another shop's branding, a price tag), with the exact reason ("shows Masafi, not Nejmeh");
--                      left       anything else: the picture stays in Photos for a person, marked "needs review" with the check's words.
--                    A re-check of pictures already approved is recorded only (never changes them): photo_recheck_report lists where the
--                    check disagrees, for the founder.
--   2 undo           automation_undo: one tap puts back what the rule did (a dish back in the queue and off sale or at its earlier price, a
--                    picture back in the queue and the earlier picture back, the stamp as it was). An undone decision is never taken again
--                    by the rule: a person decides that item.
--   3 kill-gate      each week 50 automatic decisions of each kind (fewer when there were fewer) go to the Approvals inbox (automation_checks).
--                    A person says right or wrong; a wrong one is undone at once. More than settings.automation.max_wrong (1) wrong in a
--                    week's sample switches that rule off by itself (settings.automation.<kind>.enabled false, with the reason, logged in
--                    config_changes by the automation party); Today says why; only a person switches it on again (the Settings page).
--   4 the day's list automation_today: what was approved or rejected automatically on a day, with undo; also for the console assistant (AST1),
--                    read only.
-- Label readings stay with a person for allergens (no change: 0124's locks stand). Nothing here writes an order, a payment, stock or the
-- ledger (invariant 3).

-- ---------- the photo rule ----------
insert into automation_rules(kind, version, words, approved_on, approved_by) values
  ('photo', 'photo-vision-1',
   'A picture is approved when a vision check finds the item''s brand, product type, size or count and flavour (size and flavour may not apply) with confidence 0.9 or more, and none of these: Hebrew text, a health or organic claim, another shop''s branding, a price tag. It is rejected, with the exact reason, when the check is that confident that it shows something else, or one of those marks is on it. Anything else waits for a person. Approved pictures are re-checked once and the disagreements listed for the founder; nothing approved is changed by a re-check.',
   date '2026-11-19', 'Rashid (founder decision of 19 November 2026: a person approves the rule; the rule approves the item)')
on conflict do nothing;

create table if not exists product_image_checks (
  id          uuid primary key default gen_random_uuid(),
  image_id    uuid not null references product_images(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  mode        text not null check (mode in ('decide', 'recheck')),
  version     text not null,
  model       text not null,
  run_id      text,
  verdict     text not null check (verdict in ('match', 'mismatch', 'uncertain')),
  confidence  numeric not null check (confidence between 0 and 1),
  fields      jsonb not null default '{}',              -- brand, product_type, size, flavour: {seen, match: yes | no | unsure | n/a}
  marks       text[] not null default '{}',             -- hebrew_text, health_claim, other_shop_branding, price_tag
  reason      text not null check (char_length(reason) between 1 and 300),
  outcome     text not null check (outcome in ('approved', 'rejected', 'left', 'off', 'agrees', 'disagrees', 'unsure', 'not_waiting')),
  created_at  timestamptz not null default now()
);
create index if not exists product_image_checks_image on product_image_checks(image_id, mode);

-- The label day's front photos into the picture queue: an item with a current front photo and no approved or waiting picture, whose front
-- photo was never queued before (a rejected one is not queued again).
create or replace function photo_front_queue(p_limit int default 100) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('capture_id', c.id, 'product_id', c.product_id, 'sku', p.sku, 'media_path', c.media_path) order by p.sku), '[]'::jsonb)
    from (select c.* from label_captures c join products p on p.id = c.product_id
           where c.shot = 'front' and c.superseded_at is null and p.is_active
             and not exists (select 1 from product_images i where i.product_id = c.product_id and i.status in ('approved', 'proposed'))
             and not exists (select 1 from product_images i where i.media_path = c.media_path)
           order by p.sku limit greatest(coalesce(p_limit, 100), 0)) c join products p on p.id = c.product_id $$;

create or replace function propose_front_photo(p_capture uuid, p_sha256 text, p_width int, p_height int, p_bytes int) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare c label_captures%rowtype; v_id uuid;
begin
  select * into c from label_captures where id = p_capture and shot = 'front' and superseded_at is null;
  if not found then raise exception 'CAPTURE_NOT_FOUND: a current front photo'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' or coalesce(p_width, 0) <= 0 or coalesce(p_height, 0) <= 0 or coalesce(p_bytes, 0) <= 0 then raise exception 'PICTURE_FACTS'; end if;
  select id into v_id from product_images where media_path = c.media_path;
  if v_id is not null then return jsonb_build_object('ok', true, 'already', true, 'image_id', v_id); end if;
  if exists (select 1 from product_images where product_id = c.product_id and status in ('approved', 'proposed')) then
    return jsonb_build_object('ok', true, 'skipped', 'the item already has a picture approved or waiting');
  end if;
  insert into product_images(product_id, status, source_kind, licence, media_path, sha256, width_px, height_px, bytes, source_note)
    values (c.product_id, 'proposed', 'intake_photo', 'own_photo', c.media_path, p_sha256, p_width, p_height, p_bytes, 'the label day''s front photo')
    returning id into v_id;
  return jsonb_build_object('ok', true, 'image_id', v_id);
end $$;

-- What the check is asked about each picture: the item's own record (prices and facts are never asked).
create or replace function photo_check_queue(p_mode text default 'decide', p_limit int default 300) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('image_id', i.id, 'product_id', p.id, 'sku', p.sku, 'name_en', p.name_en, 'name_ar', p.name_ar, 'brand', p.brand,
                                               'category', p.category, 'sub_type', p.sub_type, 'sell_unit', p.sell_unit, 'media_path', i.media_path,
                                               'source_kind', i.source_kind) order by p.sku), '[]'::jsonb)
    from (select * from product_images i
           where i.status = case when p_mode = 'recheck' then 'approved' else 'proposed' end
             and not exists (select 1 from product_image_checks k where k.image_id = i.id and k.mode = case when p_mode = 'recheck' then 'recheck' else 'decide' end
                               and k.version = automation_version('photo'))
             and not exists (select 1 from automation_decisions a where a.target_id = i.id and a.undone_at is not null)
           order by i.fetched_at limit greatest(coalesce(p_limit, 300), 0)) i join products p on p.id = i.product_id $$;

-- One check's answer, decided here. p_result: {verdict, confidence, brand|product_type|size|flavour: {seen, match}, marks: [...], reason}.
create or replace function record_photo_check(p_image uuid, p_mode text, p_result jsonb, p_model text, p_run text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare i product_images%rowtype; pr products%rowtype; v_ver text := automation_version('photo'); v_min numeric := coalesce((setting('automation')->'photos'->>'min_confidence')::numeric, 0.9);
        v_verdict text := p_result->>'verdict'; v_conf numeric; v_fields jsonb := '{}'; f text; m text; v_marks text[]; v_reason text := menu_text(p_result->'reason', 300);
        all_yes boolean := true; any_no boolean := false; v_out text; v_old uuid; v_check uuid; v_mark_words text;
begin
  if p_mode not in ('decide', 'recheck') then raise exception 'PHOTO_CHECK_MODE %', p_mode; end if;
  if v_verdict is null or v_verdict not in ('match', 'mismatch', 'uncertain') then raise exception 'PHOTO_CHECK_VERDICT'; end if;
  v_conf := least(greatest(coalesce(nullif(p_result->>'confidence', '')::numeric, 0), 0), 1);
  select * into i from product_images where id = p_image for update;
  if not found then raise exception 'IMAGE_NOT_FOUND'; end if;
  select * into pr from products where id = i.product_id;
  foreach f in array array['brand', 'product_type', 'size', 'flavour'] loop
    m := coalesce(p_result->f->>'match', 'unsure');
    if m not in ('yes', 'no', 'unsure', 'n/a') then m := 'unsure'; end if;
    if f in ('brand', 'product_type') and m = 'n/a' and not (f = 'brand' and coalesce(pr.brand, '') ~* '^(local|unbranded|local \(unbranded\))?$') then m := 'unsure'; end if;
    v_fields := v_fields || jsonb_build_object(f, jsonb_build_object('seen', menu_text(p_result->f->'seen', 120), 'match', m));
    if m = 'no' then any_no := true; end if;
    if m not in ('yes', 'n/a') then all_yes := false; end if;
  end loop;
  select coalesce(array_agg(distinct x order by x), '{}') into v_marks from jsonb_array_elements_text(case when jsonb_typeof(p_result->'marks') = 'array' then p_result->'marks' else '[]'::jsonb end) x
   where x in ('hebrew_text', 'health_claim', 'other_shop_branding', 'price_tag');
  v_mark_words := (select string_agg(case x when 'hebrew_text' then 'Hebrew text on the picture' when 'health_claim' then 'a health or organic claim the product cannot make'
                                            when 'other_shop_branding' then 'another shop''s branding' when 'price_tag' then 'a price tag' end, '; ') from unnest(v_marks) x);
  v_reason := coalesce(v_reason, v_mark_words, 'no reason given');

  if p_mode = 'recheck' then
    v_out := case when cardinality(v_marks) > 0 or (v_verdict = 'mismatch' and any_no and v_conf >= v_min) then 'disagrees'
                  when v_verdict = 'match' and all_yes and v_conf >= v_min then 'agrees' else 'unsure' end;
  elsif i.status <> 'proposed' then v_out := 'not_waiting';
  elsif v_verdict = 'match' and all_yes and cardinality(v_marks) = 0 and v_conf >= v_min then v_out := 'approved';
  elsif v_conf >= v_min and (cardinality(v_marks) > 0 or (v_verdict = 'mismatch' and any_no)) then v_out := 'rejected';
  else v_out := 'left'; end if;
  if v_out in ('approved', 'rejected') and not automation_on('photo') then v_out := 'off'; end if;

  insert into product_image_checks(image_id, product_id, mode, version, model, run_id, verdict, confidence, fields, marks, reason, outcome)
    values (i.id, i.product_id, p_mode, v_ver, left(coalesce(p_model, '?'), 80), left(p_run, 80), v_verdict, v_conf, v_fields, v_marks, v_reason, v_out) returning id into v_check;

  if v_out = 'approved' then
    select id into v_old from product_images where product_id = i.product_id and status = 'approved' for update;
    if v_old is not null then update product_images set status = 'superseded' where id = v_old; end if;
    update product_images set status = 'approved', reviewed_by = automation_party(), reviewed_at = now(),
           review_note = left('automatic: rule ' || v_ver || ': ' || v_reason, 500) where id = i.id;
    insert into automation_decisions(kind, version, action, target_id, product_id, title, reason, detail)
      values ('photo', v_ver, 'approved', i.id, i.product_id, left(coalesce(pr.sku || ' ', '') || pr.name_en, 200), v_reason,
              jsonb_build_object('replaced', v_old, 'check_id', v_check, 'confidence', v_conf, 'fields', v_fields, 'model', p_model));
  elsif v_out = 'rejected' then
    update product_images set status = 'rejected', reviewed_by = automation_party(), reviewed_at = now(),
           review_note = left('automatic: rule ' || v_ver || ': ' || v_reason, 500) where id = i.id;
    insert into automation_decisions(kind, version, action, target_id, product_id, title, reason, detail)
      values ('photo', v_ver, 'rejected', i.id, i.product_id, left(coalesce(pr.sku || ' ', '') || pr.name_en, 200), v_reason,
              jsonb_build_object('check_id', v_check, 'confidence', v_conf, 'fields', v_fields, 'marks', v_marks, 'model', p_model));
  elsif v_out in ('left', 'off') then
    update product_images set needs_review = true,
           check_notes = array(select distinct x from unnest(check_notes || array[left('vision check: ' || v_reason, 200)]) x) where id = i.id;
  end if;
  return jsonb_build_object('ok', true, 'outcome', v_out, 'reason', v_reason, 'check_id', v_check);
end $$;

-- Approved pictures the re-check disagrees with (never changed by it; the founder decides), and the counts.
create or replace function photo_recheck_report(p_version text default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with k as (select distinct on (k.image_id) k.*, p.sku, p.name_en, p.name_ar, i.status as image_status, i.media_path
               from product_image_checks k join products p on p.id = k.product_id join product_images i on i.id = k.image_id
              where k.mode = 'recheck' and k.version = coalesce(p_version, automation_version('photo')) order by k.image_id, k.created_at desc)
  select jsonb_build_object(
    'checked', (select count(*) from k), 'agrees', (select count(*) from k where outcome = 'agrees'),
    'disagrees', (select count(*) from k where outcome = 'disagrees'), 'unsure', (select count(*) from k where outcome = 'unsure'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('image_id', image_id, 'sku', sku, 'name_en', name_en, 'name_ar', name_ar, 'outcome', outcome,
                                                          'reason', reason, 'confidence', confidence, 'marks', marks, 'still_approved', image_status = 'approved')
                                       order by outcome, sku) from k where outcome <> 'agrees'), '[]'::jsonb)) $$;

-- ---------- 2 undo, one tap ----------
create or replace function automation_undo(p_decision uuid, p_by uuid, p_note text default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare a automation_decisions%rowtype; d menu_dish_proposals%rowtype; o jsonb; v_prod uuid; v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
        v_done text := 'nothing'; v_old uuid;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into a from automation_decisions where id = p_decision for update;
  if not found then raise exception 'DECISION_NOT_FOUND'; end if;
  if a.undone_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if a.kind = 'dish' then
    select * into d from menu_dish_proposals where id = a.target_id for update;
    if d.status = 'approved' and d.reviewed_by = automation_party() then
      v_prod := d.product_id; o := a.detail->'offer_before';
      if o is null or jsonb_typeof(o) = 'null' then
        update offers set is_available = false where source_id = d.source_id and product_id = v_prod;
      else
        update offers set price_usd = (o->>'price_usd')::numeric, is_available = (o->>'is_available')::boolean where source_id = d.source_id and product_id = v_prod;
      end if;
      update menu_dish_proposals set status = 'waiting', reviewed_by = null, reviewed_at = null, product_id = null, review_note = null,
             description = case when a.detail ? 'description_before' then a.detail->>'description_before' else description end where id = d.id;
      insert into place_log(source_id, action, by_party, detail) values (d.source_id, 'dish_back', p_by, jsonb_build_object('dish', d.id, 'decision', a.id, 'note', v_note));
      v_done := 'dish_back_in_the_queue';
    else v_done := 'dish_changed_since_left_as_is'; end if;
  elsif a.kind = 'photo' then
    if a.action = 'approved' and exists (select 1 from product_images where id = a.target_id and status = 'approved' and reviewed_by = automation_party()) then
      update product_images set status = 'superseded' where id = a.target_id;   -- out of the way of the one-approved index
      v_old := (a.detail->>'replaced')::uuid;
      if v_old is not null and exists (select 1 from product_images where id = v_old and status = 'superseded') then
        update product_images set status = 'approved' where id = v_old;
      end if;
      if not exists (select 1 from product_images where product_id = a.product_id and status = 'proposed') then
        update product_images set status = 'proposed', reviewed_by = null, reviewed_at = null, review_note = null, needs_review = true,
               check_notes = array(select distinct x from unnest(check_notes || array['automatic approval undone by a person']) x) where id = a.target_id;
      else
        update product_images set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = 'automatic approval undone: ' || coalesce(v_note, 'by a person') where id = a.target_id;
      end if;
      v_done := 'picture_back_in_the_queue';
    elsif a.action = 'rejected' and exists (select 1 from product_images where id = a.target_id and status = 'rejected' and reviewed_by = automation_party())
          and not exists (select 1 from product_images where product_id = a.product_id and status = 'proposed') then
      update product_images set status = 'proposed', reviewed_by = null, reviewed_at = null, review_note = null, needs_review = true,
             check_notes = array(select distinct x from unnest(check_notes || array['automatic rejection undone by a person']) x) where id = a.target_id;
      v_done := 'picture_back_in_the_queue';
    else v_done := 'picture_changed_since_left_as_is'; end if;
  elsif a.kind = 'menu' then
    if exists (select 1 from sources where id = a.target_id and menu_checked_by = automation_party()) then
      update sources set menu_checked_on = nullif(a.detail->'before'->>'menu_checked_on', '')::date, menu_checked_by = nullif(a.detail->'before'->>'menu_checked_by', '')::uuid
       where id = a.target_id;
      insert into place_log(source_id, action, by_party, detail) values (a.target_id, 'stamp_back', p_by, jsonb_build_object('decision', a.id, 'note', v_note));
      v_done := 'stamp_put_back';
    else v_done := 'stamp_changed_since_left_as_is'; end if;
  end if;
  update automation_decisions set undone_at = now(), undone_by = p_by, undo_note = v_note where id = a.id;
  return jsonb_build_object('ok', true, 'already', false, 'what', v_done);
end $$;

-- ---------- 3 the weekly kill-gate ----------
create table if not exists automation_checks (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references automation_decisions(id) on delete cascade,
  kind        text not null check (kind in ('dish', 'photo')),
  week        date not null,                           -- the Monday of the sampled week (Beirut)
  status      text not null default 'waiting' check (status in ('waiting', 'correct', 'wrong')),
  checked_by  uuid references parties(id),
  checked_at  timestamptz,
  note        text,
  check ((status = 'waiting') = (checked_by is null))
);
create index if not exists automation_checks_waiting on automation_checks(week) where status = 'waiting';
create table if not exists automation_sample_weeks (
  kind      text not null check (kind in ('dish', 'photo')),
  week      date not null,
  decisions int not null,
  sampled   int not null,
  created_at timestamptz not null default now(),
  primary key (kind, week)
);

-- The week before p_today's week (Monday to Sunday, Beirut): at most sample_size decisions of each kind, at random, never one undone.
-- Once per kind and week; the automation-weekly workflow calls it every Monday, and calling it again does nothing.
create or replace function automation_weekly_sample(p_today date default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_tz text := coalesce(setting('hours')->>'tz', 'Asia/Beirut'); v_today date := coalesce(p_today, hub_today());
        v_week date := (date_trunc('week', v_today::timestamp) - interval '7 days')::date; v_size int := coalesce((setting('automation')->>'sample_size')::int, 50);
        k text; n int; s int; out_ jsonb := '[]';
begin
  foreach k in array array['dish', 'photo'] loop
    continue when exists (select 1 from automation_sample_weeks where kind = k and week = v_week);
    select count(*) into n from automation_decisions a where a.kind = k and a.action in ('approved', 'rejected')
       and (a.created_at at time zone v_tz)::date between v_week and v_week + 6;
    insert into automation_checks(decision_id, kind, week)
      select a.id, k, v_week from automation_decisions a
       where a.kind = k and a.action in ('approved', 'rejected') and a.undone_at is null and (a.created_at at time zone v_tz)::date between v_week and v_week + 6
       order by random() limit v_size
      on conflict (decision_id) do nothing;
    get diagnostics s = row_count;
    insert into automation_sample_weeks(kind, week, decisions, sampled) values (k, v_week, n, s);
    out_ := out_ || jsonb_build_object('kind', k, 'week', v_week, 'decisions', n, 'sampled', s);
  end loop;
  return out_;
end $$;

-- The rule switches itself off: the setting, with its reason, through the books (config_changes, by the automation party).
create or replace function automation_switch_off(p_kind text, p_reason text) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_key text := case p_kind when 'dish' then 'dishes' when 'photo' then 'photos' end; v_before jsonb;
begin
  if v_key is null then raise exception 'AUTOMATION_KIND %', p_kind; end if;
  v_before := setting('automation')->v_key;
  update settings set value = jsonb_set(jsonb_set(jsonb_set(value, array[v_key, 'enabled'], 'false'::jsonb, true),
                                                  array[v_key, 'off_reason'], to_jsonb(left(p_reason, 300)), true),
                                        array[v_key, 'off_at'], to_jsonb(now()), true), updated_at = now()
   where key = 'automation';
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('setting', null, jsonb_build_object('key', 'automation', 'field', v_key || '.enabled', 'value', v_before->'enabled'),
            jsonb_build_object('key', 'automation', 'field', v_key || '.enabled', 'value', false), left('the weekly check: ' || p_reason, 500), automation_party());
end $$;

create or replace function record_automation_check(p_check uuid, p_by uuid, p_verdict text, p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare c automation_checks%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_wrong int; v_total int; v_max int := coalesce((setting('automation')->>'max_wrong')::int, 1);
        v_undo jsonb; v_off boolean := false; v_reason text;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_verdict not in ('correct', 'wrong') then raise exception 'CHECK_VERDICT %', p_verdict; end if;
  if p_verdict = 'wrong' and v_note is null then raise exception 'CHECK_NOTE_REQUIRED: say what was wrong'; end if;
  select * into c from automation_checks where id = p_check for update;
  if not found then raise exception 'CHECK_NOT_FOUND'; end if;
  if c.status <> 'waiting' then return jsonb_build_object('ok', true, 'already', true, 'status', c.status); end if;
  update automation_checks set status = p_verdict, checked_by = p_by, checked_at = now(), note = left(v_note, 300) where id = c.id;
  if p_verdict = 'wrong' then
    v_undo := automation_undo(c.decision_id, p_by, 'weekly check: ' || v_note);
    select count(*) filter (where status = 'wrong'), count(*) into v_wrong, v_total from automation_checks where kind = c.kind and week = c.week;
    if v_wrong > v_max and automation_on(c.kind) then
      v_reason := v_wrong || ' of the ' || v_total || ' automatic ' || case c.kind when 'dish' then 'dish' else 'picture' end || ' decisions checked for the week of '
                  || to_char(c.week, 'DD Mon') || ' were wrong (the most allowed is ' || v_max || '); the last: ' || v_note;
      perform automation_switch_off(c.kind, v_reason);
      v_off := true;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', p_verdict, 'undo', v_undo, 'switched_off', v_off);
end $$;

-- ---------- 4 the day's list, the inbox's checks, the state of each rule ----------
create or replace function automation_today(p_day date default null) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with d as (select coalesce(p_day, hub_today()) as day, coalesce(setting('hours')->>'tz', 'Asia/Beirut') as tz)
  select jsonb_build_object(
    'day', (select day from d),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'action', a.action, 'version', a.version, 'title', a.title,
                                                               'reason', a.reason, 'place', s.name, 'source_id', a.source_id, 'product_id', a.product_id,
                                                               'at', a.created_at, 'undone', a.undone_at is not null, 'undone_at', a.undone_at,
                                                               'undone_by', (select display_name from parties where id = a.undone_by))
                                            order by a.created_at desc)
                             from automation_decisions a left join sources s on s.id = a.source_id, d
                            where (a.created_at at time zone d.tz)::date = d.day), '[]'::jsonb),
    'counts', (select jsonb_build_object('dishes_approved', count(*) filter (where a.kind = 'dish' and a.action = 'approved'),
                                         'photos_approved', count(*) filter (where a.kind = 'photo' and a.action = 'approved'),
                                         'photos_rejected', count(*) filter (where a.kind = 'photo' and a.action = 'rejected'),
                                         'menus_stamped', count(*) filter (where a.kind = 'menu'), 'undone', count(*) filter (where a.undone_at is not null))
                 from automation_decisions a, d where (a.created_at at time zone d.tz)::date = d.day)) $$;

create or replace function automation_overview(p_limit int default 60) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'rules', jsonb_build_object(
       'dish', jsonb_build_object('enabled', automation_on('dish'), 'version', automation_version('dish'), 'off_reason', setting('automation')->'dishes'->>'off_reason',
                                  'off_at', setting('automation')->'dishes'->>'off_at'),
       'photo', jsonb_build_object('enabled', automation_on('photo'), 'version', automation_version('photo'), 'off_reason', setting('automation')->'photos'->>'off_reason',
                                   'off_at', setting('automation')->'photos'->>'off_at')),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('check_id', c.id, 'kind', c.kind, 'week', c.week, 'decision_id', a.id, 'action', a.action, 'title', a.title,
                                                            'reason', a.reason, 'version', a.version, 'at', a.created_at, 'target_id', a.target_id, 'product_id', a.product_id,
                                                            'media_path', (select media_path from product_images where id = a.target_id),
                                                            'place', (select name from sources where id = a.source_id)) order by c.week, c.kind, a.created_at)
                          from (select * from automation_checks where status = 'waiting' order by week, kind limit greatest(coalesce(p_limit, 60), 0)) c
                          join automation_decisions a on a.id = c.decision_id), '[]'::jsonb),
    'checks_waiting', (select count(*) from automation_checks where status = 'waiting'),
    'today', automation_today(null)) $$;

do $$ declare t text; r text;
begin
  foreach t in array array['product_image_checks', 'automation_checks', 'automation_sample_weeks'] loop
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
