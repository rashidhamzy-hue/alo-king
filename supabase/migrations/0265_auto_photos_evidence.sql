-- Alo King Chouf, session AUTO1, migration 0265 (the next number after the prompt's two: a fix the live run showed; docs/DECISIONS.md,
-- "AUTO1", row 19). Rule photo-vision-2: the same words the founder approved, read more carefully.
--
-- The live re-check of the 246 approved pictures (photo-check run 44582994731, USD 0.0622) found that the model sets the never-approve marks far
-- too easily: "Hebrew text" on 103 pictures (it reads Arabic as Hebrew; once it set the mark while its own reason said "not Hebrew") and "a
-- health claim" on 89 (the brand's own printed "low fat", "no preservatives", which the product does make). Under photo-vision-1 most good
-- pictures would have been rejected. No picture was waiting, so nothing was decided wrongly; a re-check changes nothing.
-- photo-vision-2, decided here, never on the model's word alone:
--   * a mark counts only with evidence code can check, given by the model in `evidence`: Hebrew = the Hebrew letters it copied (they must be
--     Hebrew letters, U+0590 to U+05FF); a health or organic claim = the claim's words AND where it is: an overlay or a sticker (not printed by
--     the brand on its own pack), or "organic"/"bio" when the item's own name does not say so; another shop's branding = the shop's name, not
--     the item's brand; a price tag = the price seen (a digit);
--   * a counted mark blocks approval and leaves the picture for a person, with its evidence; it never rejects by itself;
--   * rejected by rule only when confident (≥ min_confidence) that a field is another (brand, product type, size or count, flavour): "shows
--     Masafi, not Nejmeh";
--   * the re-check: "disagrees" only for such a confident mismatch; a counted mark is "unsure" (for a person to look).
-- Nothing here writes an order, a payment, stock or the ledger.

insert into automation_rules(kind, version, words, approved_on, approved_by) values
  ('photo', 'photo-vision-2',
   'As photo-vision-1, with the marks read from evidence: a picture is approved when a vision check finds the item''s brand, product type, size or count and flavour (size and flavour may not apply) with confidence 0.9 or more and no mark with evidence (Hebrew letters copied from the picture; a health or organic claim on an overlay or sticker, or "organic" when the item is not; another shop''s name; a price). A mark with evidence leaves the picture for a person. It is rejected, with the exact reason, only when the check is that confident that it shows another brand, product, size or flavour. Anything else waits for a person.',
   date '2026-11-19', 'Rashid (founder decision of 19 November 2026; the same words, the marks read from evidence after the live re-check, AUTO1)')
on conflict do nothing;

update settings set value = jsonb_set(value, '{photos,version}', '"photo-vision-2"', true), updated_at = now() where key = 'automation';

-- The marks that count: each with its evidence. p_ev: {hebrew, claim, claim_where (pack | overlay | sticker), shop, price}.
create or replace function photo_marks_counted(p_marks text[], p_ev jsonb, p_name text, p_brand text) returns text[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(m order by m), '{}') from unnest(coalesce(p_marks, '{}')) m
   where (m = 'hebrew_text' and coalesce(p_ev->>'hebrew', '') ~ '[֐-׿]{2,}')
      or (m = 'health_claim' and coalesce(btrim(p_ev->>'claim'), '') <> ''
          and (p_ev->>'claim_where' in ('overlay', 'sticker')
               or (p_ev->>'claim' ~* '\m(organic|bio|biologique)\M|عضوي' and coalesce(p_name, '') !~* '\m(organic|bio)\M|عضوي')))
      or (m = 'other_shop_branding' and coalesce(btrim(p_ev->>'shop'), '') <> ''
          and position(lower(btrim(p_ev->>'shop')) in lower(coalesce(p_brand, ''))) = 0 and position(lower(coalesce(p_brand, '-')) in lower(btrim(p_ev->>'shop'))) = 0)
      or (m = 'price_tag' and coalesce(p_ev->>'price', '') ~ '[0-9٠-٩]') $$;

-- 0264's text, with the marks read from evidence (above) and never rejecting on a mark alone.
create or replace function record_photo_check(p_image uuid, p_mode text, p_result jsonb, p_model text, p_run text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare i product_images%rowtype; pr products%rowtype; v_ver text := automation_version('photo'); v_min numeric := coalesce((setting('automation')->'photos'->>'min_confidence')::numeric, 0.9);
        v_verdict text := p_result->>'verdict'; v_conf numeric; v_fields jsonb := '{}'; f text; m text; v_said text[]; v_marks text[]; v_reason text := menu_text(p_result->'reason', 300);
        all_yes boolean := true; any_no boolean := false; v_out text; v_old uuid; v_check uuid; v_mark_words text; v_ev jsonb := coalesce(p_result->'evidence', '{}'::jsonb);
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
  select coalesce(array_agg(distinct x order by x), '{}') into v_said from jsonb_array_elements_text(case when jsonb_typeof(p_result->'marks') = 'array' then p_result->'marks' else '[]'::jsonb end) x
   where x in ('hebrew_text', 'health_claim', 'other_shop_branding', 'price_tag');
  v_marks := photo_marks_counted(v_said, v_ev, pr.name_en || ' ' || coalesce(pr.name_ar, ''), pr.brand);
  v_mark_words := (select string_agg(case x when 'hebrew_text' then 'Hebrew text («' || left(v_ev->>'hebrew', 40) || '»)'
                                            when 'health_claim' then 'a claim on an ' || coalesce(v_ev->>'claim_where', 'overlay') || ': «' || left(v_ev->>'claim', 60) || '»'
                                            when 'other_shop_branding' then 'another shop''s branding (' || left(v_ev->>'shop', 40) || ')'
                                            when 'price_tag' then 'a price tag (' || left(v_ev->>'price', 20) || ')' end, '; ') from unnest(v_marks) x);
  v_reason := coalesce(v_reason, 'no reason given');
  if v_mark_words is not null then v_reason := left(v_reason || ' [' || v_mark_words || ']', 300); end if;

  if p_mode = 'recheck' then
    v_out := case when v_verdict = 'mismatch' and any_no and v_conf >= v_min then 'disagrees'
                  when v_verdict = 'match' and all_yes and v_conf >= v_min and cardinality(v_marks) = 0 then 'agrees' else 'unsure' end;
  elsif i.status <> 'proposed' then v_out := 'not_waiting';
  elsif v_verdict = 'match' and all_yes and cardinality(v_marks) = 0 and v_conf >= v_min then v_out := 'approved';
  elsif v_conf >= v_min and v_verdict = 'mismatch' and any_no then v_out := 'rejected';
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
  return jsonb_build_object('ok', true, 'outcome', v_out, 'reason', v_reason, 'check_id', v_check, 'marks', to_jsonb(v_marks));
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
