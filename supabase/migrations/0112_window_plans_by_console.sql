-- Alo King Chouf, session D4 (console): entering delivery windows and calendar dates from the console.
-- C3's tables (0040) are rows a person edits, but nothing let a person write them except SQL. These are the functions the
-- console's windows page calls. Every one needs the ops lead or an admin, checks its figures, and leaves the rest to 0040:
-- a change to a plan or the calendar regenerates the future slots nobody holds, and raises `scheduled_day_changed` for a held
-- slot on a day that changed (delivery_slots_refresh). Nothing here cancels or moves an order that was promised a time.
-- One slot's capacity, closing and note is edit_delivery_slot (0040); moving and cancelling an order is reschedule_order and
-- cancel_scheduled_order (0040). Nothing in this file names a day, a time or a number: the page and the person do.

-- A plan: create it (p_id null) or change it. Weekdays are ISO numbers, 1 Monday to 7 Sunday, as text so any client can send them.
create or replace function save_window_plan(p_by uuid, p_id uuid, p_name text, p_weekdays text[], p_starts time, p_ends time, p_capacity int,
                                            p_order_by_min int default 120, p_fresh_order_by_min int default 720, p_calendar_kind text default null,
                                            p_zone uuid default null, p_active boolean default true)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_days smallint[]; v_id uuid; v_created boolean := p_id is null;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  begin
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days from unnest(coalesce(p_weekdays, '{}')) d;
  exception when others then raise exception 'WEEKDAYS_INVALID: days are 1 (Monday) to 7 (Sunday)'; end;
  if coalesce(array_length(v_days, 1), 0) = 0 or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then raise exception 'WEEKDAYS_INVALID: days are 1 (Monday) to 7 (Sunday)'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'WINDOW_ENDS_BEFORE_START'; end if;
  if p_capacity is null or p_capacity < 0 then raise exception 'CAPACITY_INVALID'; end if;
  if p_order_by_min is null or p_order_by_min < 0 or p_fresh_order_by_min is null or p_fresh_order_by_min < p_order_by_min then raise exception 'CUTOFF_INVALID: fresh goods close at least as early as the rest'; end if;
  if p_calendar_kind is not null and p_calendar_kind not in ('ramadan', 'lent', 'holiday', 'other') then raise exception 'CALENDAR_KIND_INVALID %', p_calendar_kind; end if;
  if p_zone is not null and not exists (select 1 from zones where id = p_zone) then raise exception 'UNKNOWN_ZONE'; end if;
  if v_created then
    insert into delivery_window_plans(name, weekdays, starts, ends, capacity, order_by_min, fresh_order_by_min, calendar_kind, zone_id, active, created_by)
      values (btrim(p_name), v_days, p_starts, p_ends, p_capacity, p_order_by_min, p_fresh_order_by_min, p_calendar_kind, p_zone, coalesce(p_active, true), p_by)
      returning id into v_id;
  else
    update delivery_window_plans set name = btrim(p_name), weekdays = v_days, starts = p_starts, ends = p_ends, capacity = p_capacity, order_by_min = p_order_by_min,
           fresh_order_by_min = p_fresh_order_by_min, calendar_kind = p_calendar_kind, zone_id = p_zone, active = coalesce(p_active, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'UNKNOWN_PLAN'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_created,
    'slots_ahead', (select count(*) from delivery_slots where plan_id = v_id and slot_date >= (now() at time zone scheduling_tz())::date));
end $$;

-- A calendar entry: Ramadan, Lent, a holiday or any other dates; closed means no deliveries at all on those days.
create or replace function save_calendar_entry(p_by uuid, p_id uuid, p_kind text, p_name text, p_starts_on date, p_ends_on date,
                                               p_closed boolean default false, p_note text default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_created boolean := p_id is null;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if p_kind is null or p_kind not in ('ramadan', 'lent', 'holiday', 'other') then raise exception 'CALENDAR_KIND_INVALID %', p_kind; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then raise exception 'DATES_INVALID: the last day is before the first'; end if;
  if v_created then
    insert into delivery_calendar(kind, name, starts_on, ends_on, closed, note, created_by)
      values (p_kind, btrim(p_name), p_starts_on, p_ends_on, coalesce(p_closed, false), nullif(btrim(coalesce(p_note, '')), ''), p_by) returning id into v_id;
  else
    update delivery_calendar set kind = p_kind, name = btrim(p_name), starts_on = p_starts_on, ends_on = p_ends_on, closed = coalesce(p_closed, false),
           note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id returning id into v_id;
    if v_id is null then raise exception 'UNKNOWN_ENTRY'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_created);
end $$;

create or replace function remove_calendar_entry(p_by uuid, p_id uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  delete from delivery_calendar where id = p_id;
  return jsonb_build_object('ok', true, 'removed', found);
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
