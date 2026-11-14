-- Alo King Chouf, session I1: the daily spot check of automatic approvals (SYSTEM_PLAN 4; C6 approved 14 Nov).
--
--   auto_approval_daily_sample()   for every finished hub day (Beirut) not sampled yet: a random tenth of that day's log
--                                  (at least one when there was any), applied or would-be, goes on the spot-check list.
--                                  intake.yml calls it every run; a day is sampled once.
--   record_spot_check()            a person says right or wrong.
--                                  right: when every check of a field's first sample day is right and that field has never
--                                         been wrong, its rule switches on (the "first passing spot check" of C6);
--                                  wrong: the rule switches off at once, and the approval is undone (the picture withdrawn,
--                                         the earlier name put back, the fact set aside, the words put on their review list).
--   set_auto_approval_rule()       a person switches a rule off, or back on after a failure. Never on without a passing
--                                  spot-check sample (after a failure: one sampled on or after the day it went off).
--   record_arabic_reader_sample()  a reader of Arabic records a checked sample of model-written names; 50 or more with no
--                                  error lets names with model-written Arabic be approved by the rule.

create or replace function auto_approval_daily_sample(p_before date default null) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_tz text := coalesce(setting('hours')->>'tz', 'Asia/Beirut'); v_before date := coalesce(p_before, hub_today());
        v_share numeric := coalesce((setting('auto_approval')->>'sample_share')::numeric, 0.1); d record; v_n int; v_take int; v_out jsonb := '[]';
begin
  for d in select (a.created_at at time zone v_tz)::date as day, count(*) as n
             from auto_approvals a
            where (a.created_at at time zone v_tz)::date < v_before
              and not exists (select 1 from auto_approval_sample_days s where s.day = (a.created_at at time zone v_tz)::date)
            group by 1 order by 1 loop
    v_take := greatest(1, ceil(d.n * v_share)::int);
    insert into auto_approval_spot_checks(approval_id, sample_day)
      select a.id, d.day from auto_approvals a where (a.created_at at time zone v_tz)::date = d.day order by random() limit v_take
      on conflict (approval_id) do nothing;
    get diagnostics v_n = row_count;
    insert into auto_approval_sample_days(day, approvals, sampled) values (d.day, d.n, v_n);
    v_out := v_out || jsonb_build_object('day', d.day, 'approvals', d.n, 'sampled', v_n);
  end loop;
  return v_out;
end $$;

-- Undo one approval a spot check found wrong. Only what the rule itself wrote, and only while it still stands.
create or replace function auto_approval_undo(p_approval uuid, p_by uuid, p_note text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare a auto_approvals%rowtype; v_id uuid; n product_name_proposals%rowtype; p products%rowtype; v_done text := 'nothing_to_undo';
begin
  select * into a from auto_approvals where id = p_approval for update;
  if not a.applied or a.reverted_at is not null then return jsonb_build_object('undone', false, 'reason', case when a.applied then 'already_undone' else 'never_applied' end); end if;
  if a.kind = 'picture' then
    update product_images set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = 'spot check: ' || coalesce(p_note, 'wrong')
     where id = a.proposal_id::uuid and status = 'approved' and reviewed_by = auto_approval_party();
    if found then v_done := 'picture_withdrawn'; end if;
  elsif a.kind = 'name' then
    select * into n from product_name_proposals where id = a.proposal_id::uuid for update;
    select * into p from products where sku = n.sku for update;
    if n.status = 'approved' and n.decided_by = auto_approval_party() then
      if p.name_en = n.applied_name_en and p.name_ar is not distinct from n.applied_name_ar then
        update products set name_en = n.previous_name_en, name_ar = n.previous_name_ar where id = p.id;
        v_done := 'earlier_name_back';
      else v_done := 'name_changed_since_left_as_is'; end if;
      update product_name_proposals set status = 'rejected', decided_by = p_by, decided_at = now(), review_note = 'spot check: ' || coalesce(p_note, 'wrong'),
             applied_name_en = null, applied_name_ar = null, previous_name_en = null, previous_name_ar = null where id = n.id;
    end if;
  elsif a.kind = 'fact' then
    v_id := (a.result->>'fact_id')::uuid;
    update product_facts set superseded_at = now(), rejected_by = p_by, rejected_at = now(), review_note = 'spot check: ' || coalesce(p_note, 'wrong')
     where id = v_id and approved_by = auto_approval_party() and superseded_at is null;
    if found then v_done := 'fact_set_aside'; end if;
  elsif a.kind = 'search_words' then
    insert into search_word_reviews(sku, phrasing, got) values (split_part(a.proposal_id, '@', 1), 'spot check: the words were marked wrong', jsonb_build_object('note', p_note))
      on conflict (sku, phrasing) do update set status = 'open', resolved_by = null, resolved_at = null;
    v_done := 'words_on_the_review_list';
  end if;
  update auto_approvals set reverted_at = now(), reverted_by = p_by where id = a.id;
  return jsonb_build_object('undone', v_done <> 'nothing_to_undo', 'what', v_done);
end $$;

create or replace function record_spot_check(p_check uuid, p_by uuid, p_verdict text, p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare c auto_approval_spot_checks%rowtype; a auto_approvals%rowtype; r auto_approval_rules%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
        v_undo jsonb; v_on boolean := false;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_verdict not in ('correct', 'wrong') then raise exception 'SPOT_CHECK_VERDICT %', p_verdict; end if;
  if p_verdict = 'wrong' and v_note is null then raise exception 'SPOT_CHECK_NOTE_REQUIRED: say what was wrong'; end if;
  select * into c from auto_approval_spot_checks where id = p_check for update;
  if not found then raise exception 'SPOT_CHECK_NOT_FOUND %', p_check; end if;
  if c.status <> 'waiting' then return jsonb_build_object('ok', true, 'already', true, 'status', c.status); end if;
  select * into a from auto_approvals where id = c.approval_id;
  select * into r from auto_approval_rules where field = a.field for update;
  update auto_approval_spot_checks set status = p_verdict, checked_by = p_by, checked_at = now(), note = v_note where id = c.id;

  if p_verdict = 'wrong' then
    update auto_approval_rules set enabled = false, disabled_at = now(), changed_by = p_by, changed_at = now(),
           disabled_reason = left('spot check of ' || c.sample_day || ' found an error: ' || v_note, 500)
     where field = a.field;
    v_undo := auto_approval_undo(a.id, p_by, v_note);
    return jsonb_build_object('ok', true, 'already', false, 'status', 'wrong', 'field', a.field, 'rule', 'off', 'undo', v_undo);
  end if;

  -- The first passing spot check: every check of this field on this sample day is decided and right, and the field was never wrong.
  if not r.enabled and r.first_passed_at is null
     and not exists (select 1 from auto_approval_spot_checks x join auto_approvals y on y.id = x.approval_id
                      where y.field = a.field and (x.status = 'wrong' or (x.sample_day = c.sample_day and x.status = 'waiting'))) then
    update auto_approval_rules set enabled = true, first_passed_at = now(), changed_by = p_by, changed_at = now(), disabled_at = null, disabled_reason = null
     where field = a.field;
    v_on := true;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'status', 'correct', 'field', a.field, 'rule', case when v_on then 'switched_on' when r.enabled then 'on' else 'off' end);
end $$;

create or replace function set_auto_approval_rule(p_field text, p_enabled boolean, p_by uuid, p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare r auto_approval_rules%rowtype;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  select * into r from auto_approval_rules where field = p_field for update;
  if not found then raise exception 'NO_SUCH_RULE %: allergens, diet labels, prices and costs are never automatic', p_field; end if;
  if r.enabled = p_enabled then return jsonb_build_object('ok', true, 'already', true, 'enabled', r.enabled); end if;
  -- On only after a passing spot check: a sample day of this field whose checks were all decided and all right. After a
  -- failure that means a later day (the rule keeps logging what it would approve while it is off, so samples go on).
  if p_enabled and not exists (
       select 1 from auto_approval_spot_checks x join auto_approvals y on y.id = x.approval_id
        where y.field = p_field and x.sample_day >= coalesce((r.disabled_at at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut'))::date, '-infinity'::date)
        group by x.sample_day having bool_and(x.status = 'correct')) then
    raise exception 'PASSING_SPOT_CHECK_NEEDED: a rule goes on only after a spot-check sample that was all right';
  end if;
  update auto_approval_rules set enabled = p_enabled, changed_by = p_by, changed_at = now(),
         disabled_at = case when p_enabled then null else now() end,
         disabled_reason = case when p_enabled then null else left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'switched off by a person'), 500) end
   where field = p_field;
  return jsonb_build_object('ok', true, 'already', false, 'enabled', p_enabled);
end $$;

create or replace function record_arabic_reader_sample(p_by uuid, p_checked int, p_errors int, p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_need int := coalesce((setting('auto_approval')->'arabic_reader'->>'sample_needed')::int, 50); v_pass boolean;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_checked is null or p_checked < 0 or p_errors is null or p_errors < 0 or p_errors > p_checked then raise exception 'SAMPLE_FIGURES'; end if;
  v_pass := p_checked >= v_need and p_errors = 0;
  update settings set value = jsonb_set(value, '{arabic_reader}', jsonb_build_object('passed', v_pass, 'sample_needed', v_need, 'checked', p_checked,
           'errors', p_errors, 'by', p_by, 'at', now(), 'note', nullif(btrim(coalesce(p_note, '')), ''))), updated_by = p_by, updated_at = now()
   where key = 'auto_approval';
  return jsonb_build_object('ok', true, 'passed', v_pass, 'sample_needed', v_need);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
