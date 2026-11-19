-- Alo King Chouf, session MENU2, migration 0259: a place's menu from any source. docs/DECISIONS.md, "MENU2, menus from any source, 19 November 2026".
--
-- FD1 (0246) read photos only. MENU2 adds every other way staff hold a menu, all into the same reading run and the same dish proposals:
--   pdf     a PDF file (stored privately, menus/<place>/src/...): the reader is given the document itself
--   link    a web page (a menu site such as oddmenu.com). The menu-read WORKFLOW fetches it with a headless browser (the Worker and the
--           build sandbox cannot): the page and the section pages it links to on the same site, and its tabs (Drinks), one fetch per page,
--           robots.txt respected, never a sign-in. Each fetched page is kept as the source record: its text and a screenshot.
--   text    text pasted on the Menus page
--   docx    a Word file; its text is taken out by the workflow
--   sheet   an Excel (.xlsx) or CSV file; its rows are taken out by the workflow
-- Several sources may be added for one place. Photos stay in 0246's menu_photos (and record_menu_photo), unchanged.
--
--   1 menu_sources        what staff added: the kind, the file, the link or the text, who added it, whether it is the whole menu (a
--                         later import of a whole menu can say which dishes are gone), and how its fetch went
--   2 menu_source_pages   what is read: one row per fetched web page (a section, a tab), per PDF, per pasted text, per Word file, per sheet.
--                         Each keeps its text (at most 60,000 characters) and, for a web page, the private screenshot's path
--   3 add_menu_source     staff add a source (ops lead, admin). The workflow may add a LINK only, as the menu reading party (0246), when the
--                         person running it gives one: adding something to read approves nothing
--   4 the fetch queue     menu_fetch_queue lists links and files waiting for the workflow; record_menu_source_pages stores what it fetched
--                         (or the failure: three failures and the source is marked failed, and the Menus page says so)
-- Nothing here writes an order, a payment, stock or the ledger, or opens a place (invariants 3, 11). No dish exists until a person approves it.

-- ---------- place_log: the new actions ----------
do $$ declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'place_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%' loop
    execute format('alter table place_log drop constraint %I', c.conname);
  end loop;
  alter table place_log add constraint place_log_action_check check (action in ('create', 'details', 'visibility', 'tester_add', 'tester_remove', 'photo',
    'reading', 'reading_failed', 'dish_approve', 'dish_reject', 'menu_checked', 'approve',
    'menu_source', 'source_fetched', 'source_failed', 'dish_off', 'section_approve'));
end $$;

-- ---------- 1 ----------
create table if not exists menu_sources (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id),
  kind          text not null check (kind in ('pdf', 'link', 'text', 'docx', 'sheet')),
  media_path    text check (media_path is null or (media_path ~ '^menus/[A-Za-z0-9_\-./]+$' and media_path !~ '\.\.')),
  url           text check (url is null or char_length(url) <= 500),
  body          text check (body is null or char_length(body) <= 100000),
  file_name     text check (file_name is null or char_length(file_name) <= 120),
  full_menu     boolean not null default false,
  added_by      uuid not null references parties(id),
  added_at      timestamptz not null default now(),
  status        text not null default 'waiting' check (status in ('waiting', 'fetched', 'failed', 'done')),
  fetched_at    timestamptz,
  failures      int not null default 0,
  last_failure  text,
  check ((kind = 'link') = (url is not null)),
  check ((kind in ('pdf', 'docx', 'sheet')) = (media_path is not null)),
  check ((kind = 'text') = (body is not null))
);
create index if not exists menu_sources_place on menu_sources(source_id, added_at);
create index if not exists menu_sources_waiting on menu_sources(added_at) where status = 'waiting';

-- ---------- 2 ----------
create table if not exists menu_source_pages (
  id              uuid primary key default gen_random_uuid(),
  menu_source_id  uuid not null references menu_sources(id),
  source_id       uuid not null references sources(id),
  position        int not null check (position >= 0),
  url             text check (url is null or char_length(url) <= 500),
  title           text check (title is null or char_length(title) <= 200),
  body            text check (body is null or char_length(body) <= 60000),
  shot_path       text check (shot_path is null or (shot_path ~ '^menus/[A-Za-z0-9_\-./]+$' and shot_path !~ '\.\.')),
  doc_path        text check (doc_path is null or (doc_path ~ '^menus/[A-Za-z0-9_\-./]+$' and doc_path !~ '\.\.')),
  status          text not null default 'waiting' check (status in ('waiting', 'read', 'skipped')),
  skip_reason     text,
  fetched_at      timestamptz not null default now(),
  read_at         timestamptz,
  read_model      text,
  failures        int not null default 0,
  last_failure    text,
  unique (menu_source_id, position),
  check (body is not null or shot_path is not null or doc_path is not null)
);
create index if not exists menu_source_pages_waiting on menu_source_pages(fetched_at) where status = 'waiting';
create index if not exists menu_source_pages_place on menu_source_pages(source_id, menu_source_id, position);

-- A link the workflow may fetch: http(s), a public host name (no user name or password in it, no address of this machine or a private
-- network, no bare IP), at most 500 characters.
create or replace function menu_url_ok(p_url text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(char_length(p_url) <= 500
     and p_url ~ '^https?://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{2,5})?(/[^\s]*)?$'
     and p_url !~* '^https?://([^/]*@|localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)'
     and p_url !~ '^https?://[0-9.]+(:[0-9]+)?(/|$)', false) $$;

-- ---------- 3 ----------
-- p_detail: link {url, full_menu}; text {body, full_menu}; pdf, docx, sheet {media_path, file_name, full_menu}.
-- A pasted text and a PDF need no fetch: their page is made at once and waits for the reading run.
create or replace function add_menu_source(p_place uuid, p_kind text, p_by uuid, p_detail jsonb default '{}') returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_url text := nullif(btrim(coalesce(p_detail->>'url', '')), ''); v_body text := nullif(btrim(coalesce(p_detail->>'body', '')), '');
        v_path text := nullif(btrim(coalesce(p_detail->>'media_path', '')), ''); v_name text := left(nullif(btrim(coalesce(p_detail->>'file_name', '')), ''), 120);
        v_full boolean := coalesce((p_detail->>'full_menu')::boolean, false);
begin
  if not (place_staff_ok(p_by) or (p_by = menu_reader_party() and p_kind = 'link')) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_place and buys_for_customer) then raise exception 'NOT_A_PLACE'; end if;
  if p_kind is null or p_kind not in ('pdf', 'link', 'text', 'docx', 'sheet') then raise exception 'MENU_SOURCE_KIND: a photo, a PDF, a link, pasted text, a Word file, or an Excel or CSV file'; end if;
  if p_kind = 'link' then
    if not menu_url_ok(v_url) then raise exception 'MENU_LINK_INVALID: give the full address of a public web page (https://...)'; end if;
    select id into v_id from menu_sources where source_id = p_place and kind = 'link' and url = v_url and status in ('waiting', 'fetched');
    if found then return jsonb_build_object('ok', true, 'menu_source_id', v_id, 'already', true); end if;
    insert into menu_sources(source_id, kind, url, full_menu, added_by) values (p_place, 'link', v_url, v_full, p_by) returning id into v_id;
  elsif p_kind = 'text' then
    if v_body is null or char_length(v_body) < 10 then raise exception 'MENU_TEXT_SHORT: paste the menu''s text (at least a dish and its price)'; end if;
    if char_length(v_body) > 60000 then raise exception 'MENU_TEXT_LONG: at most 60,000 characters at a time; paste the rest as a second text'; end if;
    select id into v_id from menu_sources where source_id = p_place and kind = 'text' and md5(body) = md5(v_body) and status <> 'failed';
    if found then return jsonb_build_object('ok', true, 'menu_source_id', v_id, 'already', true); end if;
    insert into menu_sources(source_id, kind, body, full_menu, added_by, status, fetched_at) values (p_place, 'text', v_body, v_full, p_by, 'fetched', now()) returning id into v_id;
    insert into menu_source_pages(menu_source_id, source_id, position, title, body) values (v_id, p_place, 0, 'Pasted text', v_body);
  else
    if v_path is null or v_path !~ ('^menus/' || p_place::text || '/[A-Za-z0-9_\-./]+$') or v_path ~ '\.\.' then
      raise exception 'MENU_PATH: a menu file lives under menus/<place>/';
    end if;
    select id into v_id from menu_sources where media_path = v_path;
    if found then return jsonb_build_object('ok', true, 'menu_source_id', v_id, 'already', true); end if;
    if p_kind = 'pdf' then
      insert into menu_sources(source_id, kind, media_path, file_name, full_menu, added_by, status, fetched_at) values (p_place, 'pdf', v_path, v_name, v_full, p_by, 'fetched', now()) returning id into v_id;
      insert into menu_source_pages(menu_source_id, source_id, position, title, doc_path) values (v_id, p_place, 0, coalesce(v_name, 'PDF'), v_path);
    else
      insert into menu_sources(source_id, kind, media_path, file_name, full_menu, added_by) values (p_place, p_kind, v_path, v_name, v_full, p_by) returning id into v_id;
    end if;
  end if;
  insert into place_log(source_id, action, by_party, detail) values (p_place, 'menu_source', p_by, jsonb_build_object('menu_source_id', v_id, 'kind', p_kind, 'full_menu', v_full));
  return jsonb_build_object('ok', true, 'menu_source_id', v_id, 'already', false);
end $$;

-- ---------- 4 ----------
create or replace function menu_fetch_queue(p_limit int default 50) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('menu_source_id', x.id, 'source_id', x.source_id, 'place', x.name, 'kind', x.kind, 'url', x.url,
                                               'media_path', x.media_path, 'file_name', x.file_name) order by x.added_at, x.id), '[]'::jsonb)
    from (select m.id, m.source_id, s.name, m.kind, m.url, m.media_path, m.file_name, m.added_at from menu_sources m join sources s on s.id = m.source_id
           where m.status = 'waiting' and m.kind in ('link', 'docx', 'sheet') order by m.added_at, m.id limit greatest(coalesce(p_limit, 50), 0)) x $$;

-- p_pages: [{position, url, title, body, shot_path, skip_reason}]. Null with a reason: the fetch failed (the source waits for the next run;
-- the third failure marks it failed). A page with a skip_reason is kept as the record but not read (the page showed no item or price).
create or replace function record_menu_source_pages(p_menu_source uuid, p_pages jsonb, p_by uuid, p_reason text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare m menu_sources%rowtype; x jsonb; n int := 0; k int := 0;
begin
  if p_by is distinct from menu_reader_party() and not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into m from menu_sources where id = p_menu_source for update;
  if not found then raise exception 'MENU_SOURCE_NOT_FOUND'; end if;
  if m.status <> 'waiting' then return jsonb_build_object('ok', true, 'already', true, 'pages', 0); end if;
  if p_pages is null or jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) = 0 then
    update menu_sources set failures = failures + 1, last_failure = left(coalesce(p_reason, 'nothing fetched'), 200),
           status = case when failures + 1 >= 3 then 'failed' else 'waiting' end where id = m.id;
    insert into place_log(source_id, action, by_party, detail) values (m.source_id, 'source_failed', p_by, jsonb_build_object('menu_source_id', m.id, 'reason', left(coalesce(p_reason, 'nothing fetched'), 200)));
    return jsonb_build_object('ok', false, 'pages', 0, 'failed', m.failures + 1 >= 3);
  end if;
  if jsonb_array_length(p_pages) > 80 then raise exception 'MENU_PAGES_TOO_MANY: at most 80 pages from one source'; end if;
  for x in select * from jsonb_array_elements(p_pages) loop
    continue when nullif(btrim(coalesce(x->>'body', '')), '') is null and nullif(x->>'shot_path', '') is null;
    if nullif(x->>'shot_path', '') is not null and (x->>'shot_path' !~ ('^menus/' || m.source_id::text || '/[A-Za-z0-9_\-./]+$') or x->>'shot_path' ~ '\.\.') then
      raise exception 'MENU_PATH: a screenshot lives under menus/<place>/';
    end if;
    insert into menu_source_pages(menu_source_id, source_id, position, url, title, body, shot_path, status, skip_reason)
      values (m.id, m.source_id, coalesce((x->>'position')::int, n), case when menu_url_ok(x->>'url') then x->>'url' end, left(nullif(btrim(coalesce(x->>'title', '')), ''), 200),
              left(nullif(btrim(coalesce(x->>'body', '')), ''), 60000), nullif(x->>'shot_path', ''),
              case when nullif(x->>'skip_reason', '') is null then 'waiting' else 'skipped' end, left(nullif(x->>'skip_reason', ''), 200));
    n := n + 1;
    if nullif(x->>'skip_reason', '') is not null then k := k + 1; end if;
  end loop;
  if n = 0 then
    update menu_sources set failures = failures + 1, last_failure = 'every page was empty', status = case when failures + 1 >= 3 then 'failed' else 'waiting' end where id = m.id;
    return jsonb_build_object('ok', false, 'pages', 0);
  end if;
  update menu_sources set status = case when n = k then 'done' else 'fetched' end, fetched_at = now() where id = m.id;
  insert into place_log(source_id, action, by_party, detail) values (m.source_id, 'source_fetched', p_by, jsonb_build_object('menu_source_id', m.id, 'pages', n, 'skipped', k));
  return jsonb_build_object('ok', true, 'pages', n, 'skipped', k);
end $$;

-- ---------- grants ----------
do $$ declare t text; r text;
begin
  foreach t in array array['menu_sources', 'menu_source_pages'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
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
