-- UX2b (the console's Approve, Intake, Money, Settings and Riders pages, 17 November 2026), migration 1 of 2: the Settings page's write door.
--
-- Until now no console page could change a setting: a person edited the table by hand (SELL1: "there is no console page for the setting
-- yet"). The Settings page changes a setting through change_setting() and nothing else:
--   * admin only (the founder; an ops lead and a picker are refused)
--   * only what is on the editable list below, each with its type and bounds. The list is data (editable_settings), not code: a new
--     setting is a row. Anything not on it (the marketing lock, the simulation ceiling, the push lists, the model keys) cannot be written
--     from the console, and the marketing trigger of 0012 still holds under every path
--   * every change is logged with who, when, before, after and why (config_changes, kind 'setting', 0045's table)
--   * the rules the design review calls two-person do not change at once: they wait in pending_approvals (kind 'setting') and are made by
--     decide_approval, which refuses the person who asked. Those are the approval limits (refund over USD, price change over %, the
--     second-person rule switched off), the cash caps, and selling-requires-a-label switched ON (it takes every unlabelled packaged
--     item off sale; switching it off is a way back and is immediate). A newer request for the same field replaces an older one.
--   * the cash caps keep soft <= hard, checked when asked and again when approved (invariant 5: the cap itself stays in SQL)
--   * the embeddings switch can be turned on only when the model's vectors are in the database (SR1: "once product_embeddings holds
--     the model's vectors")
-- decide_approval is 0223's text plus the kind 'setting'. Anyone redefining it: start from here.
-- Reads for the page: console_settings() (what is editable, its value, bounds, who last changed it, a request waiting) and settings_log().

alter table config_changes drop constraint if exists config_changes_kind_check;
alter table config_changes add constraint config_changes_kind_check check (kind in ('offer', 'zone', 'village', 'fx', 'handoff', 'setting'));
alter table pending_approvals drop constraint if exists pending_approvals_kind_check;
alter table pending_approvals add constraint pending_approvals_kind_check check (kind in ('price', 'refund', 'payment', 'fx', 'setting'));

create table if not exists editable_settings (
  key             text not null,
  field           text not null default '',                 -- '' = the whole value (a scalar setting)
  kind            text not null check (kind in ('int', 'number', 'bool', 'time', 'text', 'enum')),
  min_value       numeric,
  max_value       numeric,
  max_len         int,
  choices         text[],
  two_person      boolean not null default false,
  two_person_when jsonb,                                    -- only this new value needs a second person (null: any change does)
  primary key (key, field)
);

insert into editable_settings(key, field, kind, min_value, max_value, max_len, choices, two_person, two_person_when) values
  ('hours',               'open',                       'time',   null, null, null, null, false, null),
  ('hours',               'close',                      'time',   null, null, null, null, false, null),
  ('min_order_usd',       '',                           'number', 0,    1000, null, null, false, null),
  ('small_order_fee',     'below_subtotal_usd',         'number', 0,    1000, null, null, false, null),
  ('small_order_fee',     'fee_usd',                    'number', 0,    100,  null, null, false, null),
  ('timers',              'awaiting_payment_min',       'int',    1,    1440, null, null, false, null),
  ('timers',              'awaiting_confirmation_min',  'int',    1,    1440, null, null, false, null),
  ('timers',              'confirm_reminder_min',       'int',    1,    1440, null, null, false, null),
  ('timers',              'draft_min',                  'int',    1,    1440, null, null, false, null),
  ('cash_cap',            'soft_usd',                   'number', 0,    100000, null, null, true, null),
  ('cash_cap',            'hard_usd',                   'number', 1,    100000, null, null, true, null),
  ('pickup',              'enabled',                    'bool',   null, null, null, null, false, null),
  ('pickup',              'place_en',                   'text',   null, null, 120,  null, false, null),
  ('pickup',              'place_ar',                   'text',   null, null, 120,  null, false, null),
  ('support',             'claim_alert_min',            'int',    1,    240,  null, null, false, null),
  ('support',             'founder_alert_min',          'int',    1,    240,  null, null, false, null),
  ('support',             'late_min',                   'int',    1,    1440, null, null, false, null),
  ('approvals',           'refund_usd',                 'number', 0,    100000, null, null, true, null),
  ('approvals',           'price_change_pct',           'number', 0,    100,  null, null, true, null),
  ('approvals',           'fx_rate_second_person',      'bool',   null, null, null, null, true, 'false'),
  ('sell_requires_label', 'enabled',                    'bool',   null, null, null, null, true, 'true'),
  ('search',              'embeddings',                 'enum',   null, null, null, array['on', 'off'], false, null)
on conflict (key, field) do nothing;

alter table editable_settings enable row level security;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table editable_settings from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table editable_settings to service_role; end if;
end $$;

-- The current value of one field (null when the row or the field is missing).
create or replace function setting_field(p_key text, p_field text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case when p_field = '' then value else value -> p_field end from settings where key = p_key
$$;

-- Is this value allowed for this field? Returns the value to store (a text is trimmed, an empty one becomes null) or raises.
create or replace function change_setting_check(p_key text, p_field text, p_value jsonb) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare e editable_settings%rowtype; v jsonb := p_value; n numeric; t text; v_soft numeric; v_hard numeric;
begin
  select * into e from editable_settings where key = p_key and field = p_field;
  if not found or not exists (select 1 from settings where key = p_key) then raise exception 'NOT_EDITABLE: % % is not a setting the console changes', p_key, p_field; end if;
  if p_value is null then raise exception 'VALUE_INVALID: a value is needed'; end if;
  if e.kind in ('int', 'number') then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'VALUE_INVALID: a number is needed'; end if;
    n := (p_value #>> '{}')::numeric;
    if e.kind = 'int' and n <> trunc(n) then raise exception 'VALUE_INVALID: a whole number is needed'; end if;
    if n < e.min_value or n > e.max_value then raise exception 'VALUE_INVALID: between % and % is needed', e.min_value, e.max_value; end if;
  elsif e.kind = 'bool' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'VALUE_INVALID: yes or no is needed'; end if;
  elsif e.kind = 'time' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'VALUE_INVALID: a time such as 08:00 is needed'; end if;
  elsif e.kind = 'text' then
    if jsonb_typeof(p_value) not in ('string', 'null') then raise exception 'VALUE_INVALID: words are needed'; end if;
    t := btrim(coalesce(p_value #>> '{}', ''));
    if char_length(t) > e.max_len then raise exception 'VALUE_INVALID: at most % characters', e.max_len; end if;
    v := case when t = '' then 'null'::jsonb else to_jsonb(t) end;
  elsif e.kind = 'enum' then
    if jsonb_typeof(p_value) <> 'string' or not ((p_value #>> '{}') = any(e.choices)) then raise exception 'VALUE_INVALID: one of % is needed', e.choices; end if;
  end if;
  if p_key = 'cash_cap' then                                                    -- invariant 5: the cap stays in SQL; soft never above hard
    v_soft := coalesce((setting('cash_cap')->>'soft_usd')::numeric, 0); v_hard := coalesce((setting('cash_cap')->>'hard_usd')::numeric, 0);
    if p_field = 'soft_usd' then v_soft := (v #>> '{}')::numeric; else v_hard := (v #>> '{}')::numeric; end if;
    if v_soft > v_hard then raise exception 'CAP_ORDER: the soft cap (%) may not be above the hard cap (%)', v_soft, v_hard; end if;
  end if;
  if p_key = 'search' and p_field = 'embeddings' and (v #>> '{}') = 'on'
     and not exists (select 1 from product_embeddings where model = setting('search')->>'model') then
    raise exception 'EMBEDDINGS_NOT_READY: the model''s vectors are not in the database yet';
  end if;
  return v;
end $$;

-- The write itself, once it is allowed. p_by is the admin who asked; p_second the person who approved it, when two were needed.
create or replace function change_setting_now(p_key text, p_field text, p_value jsonb, p_by uuid, p_reason text, p_second uuid default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v jsonb; v_before jsonb; v_second text;
begin
  perform require_role(p_by, array['admin']);
  v := change_setting_check(p_key, p_field, p_value);
  v_before := coalesce(setting_field(p_key, p_field), 'null'::jsonb);
  if v_before = v then return jsonb_build_object('ok', true, 'status', 'unchanged', 'value', v); end if;
  update settings set value = case when p_field = '' then v else jsonb_set(value, array[p_field], v, true) end, updated_by = p_by, updated_at = now() where key = p_key;
  select display_name into v_second from parties where id = p_second;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('setting', null, jsonb_build_object('key', p_key, 'field', p_field, 'value', v_before),
            jsonb_build_object('key', p_key, 'field', p_field, 'value', v) || case when p_second is not null then jsonb_build_object('approved_by', p_second) else '{}'::jsonb end,
            btrim(p_reason) || case when p_second is not null then ' (approved by ' || coalesce(v_second, 'a second person') || ')' else '' end, p_by);
  return jsonb_build_object('ok', true, 'status', 'set', 'before', v_before, 'value', v);
end $$;

-- The door the console calls.
create or replace function change_setting(p_key text, p_field text, p_value jsonb, p_by uuid, p_reason text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare e editable_settings%rowtype; v jsonb; v_before jsonb; a pending_approvals%rowtype; v_id uuid;
begin
  perform require_role(p_by, array['admin']);
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  v := change_setting_check(p_key, p_field, p_value);
  select * into e from editable_settings where key = p_key and field = p_field;
  v_before := coalesce(setting_field(p_key, p_field), 'null'::jsonb);
  if v_before = v then return jsonb_build_object('ok', true, 'status', 'unchanged', 'value', v); end if;
  if not (e.two_person and (e.two_person_when is null or e.two_person_when = v)) then
    return change_setting_now(p_key, p_field, v, p_by, p_reason, null);
  end if;
  select * into a from pending_approvals where kind = 'setting' and status = 'pending' and requested_by = p_by
     and payload->>'key' = p_key and payload->>'field' = p_field and payload->'value' = v;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'awaiting_approval', 'approval_id', a.id);
  end if;
  update pending_approvals set status = 'rejected', decided_by = p_by, decided_at = now(), note = 'replaced by a newer request'
   where kind = 'setting' and status = 'pending' and payload->>'key' = p_key and payload->>'field' = p_field;
  insert into pending_approvals(kind, ref, payload, summary, requested_by)
    values ('setting', gen_random_uuid(), jsonb_build_object('key', p_key, 'field', p_field, 'value', v, 'before', v_before, 'reason', btrim(p_reason)),
            p_key || case when p_field <> '' then '.' || p_field else '' end || ': ' || (v_before #>> '{}') || ' to ' || (v #>> '{}') || ' (' || btrim(p_reason) || ')', p_by)
    returning id into v_id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'awaiting_approval', 'approval_id', v_id);
end $$;

-- 0223's text, with the kind 'setting': the second person makes the change, in the asker's name.
create or replace function decide_approval(p_id uuid, p_by uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql as $$
declare a pending_approvals%rowtype; v_result jsonb; v_name text;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  select * into a from pending_approvals where id = p_id for update;
  if not found then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'pending' then return jsonb_build_object('ok', true, 'already', a.status); end if;
  if not p_approve then
    update pending_approvals set status = 'rejected', decided_by = p_by, decided_at = now(), note = nullif(btrim(p_note), '') where id = p_id;
    return jsonb_build_object('ok', true, 'already', null, 'status', 'rejected');
  end if;
  if p_by = a.requested_by then raise exception 'SAME_PERSON: a second person must approve'; end if;
  select display_name into v_name from parties where id = p_by;
  if a.kind = 'price' then
    v_result := set_offer_now(a.ref, (a.payload->>'price_usd')::numeric, (a.payload->>'available')::boolean, a.requested_by,
                              (a.payload->>'reason') || ' (approved by ' || coalesce(v_name, 'staff') || ')');
  elsif a.kind = 'fx' then                                                                 -- CFG1: the second person sets the rate
    v_result := set_fx_rate_now((a.payload->>'lbp_per_usd')::numeric, a.requested_by, p_by);
  elsif a.kind = 'setting' then                                                            -- UX2b: the second person makes the settings change
    v_result := change_setting_now(a.payload->>'key', a.payload->>'field', a.payload->'value', a.requested_by, a.payload->>'reason', p_by);
  elsif a.kind = 'payment' then                                                            -- G1-05 (F1)
    v_result := confirm_payment_now(a.ref, a.requested_by, a.payload->>'external_ref', (a.payload->>'amount_usd')::numeric);
    if a.payload ? 'proof_id' then
      update payment_proofs set status = 'confirmed', reviewed_by = a.requested_by, reviewed_at = now(),
             review_note = 'overpayment approved by ' || coalesce(v_name, 'staff')
       where id = (a.payload->>'proof_id')::uuid and status = 'pending';
      update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now()
       where kind = 'payment_proof' and ref = a.payload->>'proof_id' and status <> 'resolved';
    end if;
  else
    v_result := refund_order_now(a.ref, a.requested_by, (a.payload->>'amount_usd')::numeric, a.payload->>'charged_to', a.payload->>'reason',
                                 a.payload->>'settle', a.payload->>'ref', a.payload->>'note', nullif(a.payload->>'item', '')::uuid,
                                 coalesce(a.request_key, 'approval:' || a.id));
  end if;
  update pending_approvals set status = 'approved', decided_by = p_by, decided_at = now(), note = nullif(btrim(p_note), ''), result = v_result where id = p_id;
  return jsonb_build_object('ok', true, 'already', null, 'status', 'approved', 'result', v_result);
end $$;

-- What the Settings page edits: one row per editable field, with its value, bounds, who last changed it and a request waiting.
create or replace function console_settings() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', e.key, 'field', e.field, 'kind', e.kind, 'min', e.min_value, 'max', e.max_value, 'max_len', e.max_len, 'choices', e.choices,
           'two_person', e.two_person, 'two_person_when', e.two_person_when,
           'value', setting_field(e.key, e.field),
           'changed_by_name', (select p.display_name from config_changes c join parties p on p.id = c.changed_by
                                where c.kind = 'setting' and c.after->>'key' = e.key and c.after->>'field' = e.field order by c.created_at desc, c.id desc limit 1),
           'changed_at', (select c.created_at from config_changes c where c.kind = 'setting' and c.after->>'key' = e.key and c.after->>'field' = e.field order by c.created_at desc, c.id desc limit 1),
           'pending', (select jsonb_build_object('id', a.id, 'value', a.payload->'value', 'requested_by', a.requested_by, 'requested_by_name', p.display_name, 'requested_at', a.requested_at)
                         from pending_approvals a join parties p on p.id = a.requested_by
                        where a.kind = 'setting' and a.status = 'pending' and a.payload->>'key' = e.key and a.payload->>'field' = e.field limit 1)
         ) order by e.key, e.field), '[]'::jsonb)
    from editable_settings e join settings s on s.key = e.key
$$;

-- The change log of the Settings page: who, when, which setting, before, after and why; newest first.
create or replace function settings_log(p_limit int default 30) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(q.x order by q.at desc, q.id desc), '[]'::jsonb) from (
    select c.created_at as at, c.id,
           jsonb_build_object('at', c.created_at, 'key', c.after->>'key', 'field', c.after->>'field', 'before', c.before->'value', 'after', c.after->'value',
                              'reason', c.reason, 'by', c.changed_by, 'by_name', p.display_name, 'approved_by', c.after->>'approved_by',
                              'approved_by_name', (select z.display_name from parties z where z.id = nullif(c.after->>'approved_by', '')::uuid)) as x
      from config_changes c join parties p on p.id = c.changed_by
     where c.kind = 'setting' order by c.created_at desc, c.id desc limit greatest(1, least(coalesce(p_limit, 30), 200))) q
$$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
