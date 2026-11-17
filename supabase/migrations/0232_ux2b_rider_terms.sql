-- UX2b, migration 2 of 2: a rider's written terms on file (the Riders page: "written terms on file").
--
-- Before a rider carries cash and fees the hub holds their written terms. Until now nothing in the database said whether it does. This
-- records, per rider: what the document is called (a version and a name), the day it was signed, who recorded it, and (optionally) the scan
-- or photo in the private media bucket under rider_terms/<rider>/. A newer record replaces the current one; the old stays as history and
-- nothing is deleted. It holds no rating, score or ranking of a rider (the reference's rule; the page measures the service, not people).
-- Recording is the ops lead's or an admin's, through record_rider_terms(); the console reads rider_terms_on_file().

create table if not exists rider_terms (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references parties(id),
  reference     text not null check (char_length(reference) between 3 and 120),
  signed_on     date not null,
  document_path text check (document_path is null or document_path like 'rider_terms/%'),
  recorded_by   uuid not null references parties(id),
  recorded_at   timestamptz not null default now(),
  superseded_at timestamptz
);
create unique index if not exists rider_terms_one_current on rider_terms(driver_id) where superseded_at is null;

create or replace function rider_terms_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'APPEND_ONLY: a rider''s terms are history, not deleted'; end if;
  if (new.driver_id, new.reference, new.signed_on, new.document_path, new.recorded_by, new.recorded_at) is distinct from
     (old.driver_id, old.reference, old.signed_on, old.document_path, old.recorded_by, old.recorded_at) then
    raise exception 'APPEND_ONLY: a rider''s terms are history, not edited';
  end if;
  return new;
end $$;
drop trigger if exists rider_terms_guard on rider_terms;
create trigger rider_terms_guard before update or delete on rider_terms for each row execute function rider_terms_append_only();

alter table rider_terms enable row level security;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table rider_terms from %I', r); end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table rider_terms to service_role; end if;
end $$;

create or replace function record_rider_terms(p_driver uuid, p_by uuid, p_reference text, p_signed_on date, p_path text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_replaced boolean; v_id uuid;
begin
  perform require_role(p_by, array['ops_lead', 'admin']);
  if not exists (select 1 from parties where id = p_driver and role = 'driver') then raise exception 'NOT_A_RIDER'; end if;
  if char_length(btrim(coalesce(p_reference, ''))) < 3 then raise exception 'REFERENCE_REQUIRED: name the document and its version'; end if;
  if p_signed_on is null or p_signed_on > (now() at time zone coalesce(setting('hours')->>'tz', 'Asia/Beirut'))::date then raise exception 'SIGNED_ON_FUTURE: the day it was signed cannot be in the future'; end if;
  if p_path is not null and p_path not like 'rider_terms/' || p_driver::text || '/%' then raise exception 'TERMS_PATH: that document does not belong to this rider'; end if;
  update rider_terms set superseded_at = now() where driver_id = p_driver and superseded_at is null;
  v_replaced := found;
  insert into rider_terms(driver_id, reference, signed_on, document_path, recorded_by) values (p_driver, btrim(p_reference), p_signed_on, p_path, p_by) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'replaced', v_replaced);
end $$;

-- The current record of each rider that has one.
create or replace function rider_terms_on_file() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('driver_id', t.driver_id, 'reference', t.reference, 'signed_on', t.signed_on, 'document_path', t.document_path,
           'has_document', t.document_path is not null, 'recorded_by', t.recorded_by, 'recorded_by_name', p.display_name, 'recorded_at', t.recorded_at) order by t.recorded_at), '[]'::jsonb)
    from rider_terms t join parties p on p.id = t.recorded_by where t.superseded_at is null
$$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
