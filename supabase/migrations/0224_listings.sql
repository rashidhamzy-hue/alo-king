-- Alo King Chouf, session LV1 (Chouf places listed before they sign), migrations 0224 and 0225.
-- Founder decision of 17 November 2026: docs/DECISIONS.md, "Listings before they sign, 17 November 2026".
--
-- A listing is a food place in the Chouf that is on the website before it has signed, so that customers can ask for it and owners can
-- claim it or have it removed. It is NOT a merchant and is never orderable (invariant 11 is unchanged): the table has no link to
-- merchants, sources, offers, products or orders, and nothing in this file writes any of them. A restaurant still opens only through
-- approve_merchant(). Nobody phones an order in to a listing.
--
-- What a listing holds: a name, a kind, a village, the distance from the hub in km, a map link. Nothing else: no phone, no rating, no
-- review count, no menu, no hours, no photo. The file it is loaded from (0225) has none of them by design, so there is nothing to
-- message and nothing to rank by (invariant 14: the website sorts by distance or name only).
--
--   listings                    the places (hidden_at set: the page is gone, from the list and from its own address)
--   listing_removal_requests    "Remove this listing": who asked (owner, manager, staff, someone else), why, when, and whether the page was hidden
--   listing_log                 every hide, restore, claim and decision, with its time and reason (append-only)
--   listing_claims              "Claim <listing_id>" read on the customer line, with the sender and the staff case it opened
--
-- The website's functions (granted to web_channel by name below; scripts/check_permissions.sh lists them):
--   web_food_list      the Food page: by kind and village, sorted by distance or name only, paged
--   web_food_place     one place
--   web_listing_want   "I want to order from here": demand (log_demand, kind listing), once per anonymous session or signed-in customer
--   web_listing_remove "Remove this listing": hides the page at once, logs it, raises a staff case (an ops exception)
-- Staff and the customer-line turn (service role only; never granted to the website):
--   restore_listing, keep_listing_hidden, hide_listing   ops lead and admin only, with a reason, each logged
--   claim_listing                                        the customer-line turn, by code and before any model
--   listings_console, listing_claims_console             what the console's Listings page reads
-- Limits are data (settings.listings, invariant 13): want_per_session_hour, removal_per_session_day, removal_per_hour.

alter type demand_kind add value if not exists 'listing';

create table if not exists listings (
  listing_id   text primary key check (listing_id ~ '^[^[:space:]]+$'),
  name         text not null check (btrim(name) <> ''),
  kind         text not null check (kind ~ '^[a-z][a-z_]*$'),
  village      text,
  km_from_hub  numeric(5,1) not null check (km_from_hub >= 0),
  maps_url     text not null check (maps_url ~ '^https://www\.google\.com/maps/'),
  hidden_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists listings_visible_kind on listings(kind, km_from_hub) where hidden_at is null;
create index if not exists listings_visible_village on listings(village, km_from_hub) where hidden_at is null;
create index if not exists listings_name_fold on listings(fold_text(name));

create table if not exists listing_removal_requests (
  id            uuid primary key default gen_random_uuid(),
  listing_id    text not null references listings(listing_id),
  who           text not null check (who in ('owner', 'manager', 'staff', 'other')),
  reason        text check (reason is null or char_length(reason) <= 500),
  session_id    uuid references web_sessions(id),
  hidden        boolean not null,                      -- the page was hidden at once (false: over a limit, left for staff)
  status        text not null default 'open' check (status in ('open', 'closed')),
  requested_at  timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references parties(id),
  closed_note   text
);
create index if not exists listing_removal_requests_open on listing_removal_requests(listing_id) where status = 'open';
create index if not exists listing_removal_requests_session on listing_removal_requests(session_id, requested_at);

create table if not exists listing_log (
  id          bigint generated always as identity primary key,
  listing_id  text not null references listings(listing_id),
  action      text not null check (action in ('hide', 'removal_request', 'restore', 'keep_hidden', 'claim')),
  at          timestamptz not null default now(),
  by_party    uuid references parties(id),             -- staff for hide/restore/keep, the sender for a claim, null for a visitor's request
  request_id  uuid references listing_removal_requests(id),
  reason      text,
  detail      jsonb not null default '{}'
);
create index if not exists listing_log_listing on listing_log(listing_id, id);

create or replace function listing_log_append_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'listing_log is append-only'; end $$;
drop trigger if exists listing_log_no_change on listing_log;
create trigger listing_log_no_change before update or delete on listing_log for each row execute function listing_log_append_only();

create table if not exists listing_claims (
  id               uuid primary key default gen_random_uuid(),
  listing_id       text not null references listings(listing_id),
  party_id         uuid not null references parties(id),
  conversation_id  uuid references conversations(id),
  case_id          uuid references handoffs(id),
  wamid            text,
  created_at       timestamptz not null default now(),
  unique (listing_id, party_id)
);

insert into settings(key, value) values ('listings', jsonb_build_object(
  'want_per_session_hour', 30, 'removal_per_session_day', 5, 'removal_per_hour', 20))
on conflict (key) do nothing;

-- ---------- the demand log: a listing is counted once per anonymous session or signed-in customer, ever ----------
-- log_demand (0022) dedupes per customer, subject and hour, which for a visitor with no party would collapse every anonymous visitor into
-- one row an hour. For kind listing the key is the person (detail.who: 'session:<id>' or 'party:<id>') and the place, with no hour; the
-- subject is the listing id, so the console's count per place is a plain count. Every other kind is exactly as in 0022.
create or replace function log_demand(
  p_kind demand_kind, p_origin text, p_party uuid default null, p_query text default null, p_product uuid default null,
  p_source_hint text default null, p_village uuid default null, p_village_said text default null, p_detail jsonb default '{}')
returns boolean language plpgsql as $$
declare v_subject text; v_key text; n int;
begin
  v_subject := coalesce(p_product::text,
                        case p_kind when 'unsigned_restaurant' then nullif(fold_text(p_source_hint), '')
                                    when 'out_of_area' then coalesce(p_village::text, nullif(fold_text(p_village_said), ''))
                                    when 'listing' then nullif(p_detail->>'listing_id', '') end,
                        nullif(fold_text(p_query), ''), '?');
  v_key := case when p_kind = 'listing'
                then 'listing:' || coalesce(p_detail->>'who', coalesce(p_party::text, '-')) || ':' || v_subject
                else p_kind || ':' || coalesce(p_party::text, '-') || ':' || v_subject || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24') end;
  insert into demand_signals(kind, origin, party_id, query, subject, product_id, source_hint, village_id, village_said, detail, dedupe_key)
    values (p_kind, p_origin, p_party, nullif(btrim(p_query), ''), v_subject, p_product, nullif(btrim(p_source_hint), ''),
            p_village, nullif(btrim(p_village_said), ''), coalesce(p_detail, '{}'), v_key)
    on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------- helpers (not granted to the website) ----------
-- The village as Arabic, where the delivery village list knows it by name or by one of its spellings. Nothing is invented: no match, no Arabic.
create or replace function listing_village_ar(p_village text) returns text language sql stable set search_path = public, pg_temp as $$
  select v.name_ar from villages v
   where p_village is not null and v.name_ar is not null
     and (fold_text(v.name_en) = fold_text(p_village) or exists (select 1 from unnest(v.aliases) a where fold_text(a) = fold_text(p_village)))
   order by v.is_served desc, v.name_en limit 1 $$;

-- The chat's address without its query, as the home page reads it (settings.catalog.product_link, set by a person).
create or replace function listing_chat_link() returns text language sql stable set search_path = public, pg_temp as $$
  select nullif(regexp_replace(coalesce(setting('catalog')->>'product_link', ''), '\?.*$', ''), '') $$;

create or replace function listing_json(l listings) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('listing_id', l.listing_id, 'name', l.name, 'kind', l.kind, 'village', l.village,
                            'village_ar', listing_village_ar(l.village), 'km_from_hub', l.km_from_hub) $$;

-- A staff member who may act on a listing: an ops lead or an admin, not blocked.
create or replace function listing_staff_check(p_by uuid) returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
end $$;

-- ---------- the website's reads ----------
-- The Food page: the places that are not hidden, by kind and village, sorted by distance (the default, and anything that is not 'name') or by name.
-- A village of '-' is the places with no village in the file. The kinds and villages to choose from come back with their counts.
create or replace function web_food_list(p_kind text default null, p_village text default null, p_sort text default 'distance', p_limit int default 24, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_kind text := nullif(lower(btrim(coalesce(p_kind, ''))), ''); v_vil text := nullif(btrim(coalesce(p_village, '')), '');
        v_by_name boolean := coalesce(p_sort = 'name', false); v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60); v_off int := least(greatest(coalesce(p_offset, 0), 0), 100000);
        v_total int; v_rows jsonb; v_kinds jsonb; v_villages jsonb;
begin
  select count(*) into v_total from listings l
   where l.hidden_at is null and (v_kind is null or l.kind = v_kind) and (v_vil is null or (v_vil = '-' and l.village is null) or l.village = v_vil);
  select coalesce(jsonb_agg(x.j order by x.rn), '[]'::jsonb) into v_rows
    from (select listing_json(l) as j, row_number() over (order by case when v_by_name then lower(l.name) end, case when not v_by_name then l.km_from_hub end, lower(l.name), l.listing_id) as rn
            from listings l
           where l.hidden_at is null and (v_kind is null or l.kind = v_kind) and (v_vil is null or (v_vil = '-' and l.village is null) or l.village = v_vil)) x
   where x.rn > v_off and x.rn <= v_off + v_limit;
  select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'count', k.n) order by k.n desc, k.kind), '[]'::jsonb) into v_kinds
    from (select kind, count(*)::int as n from listings where hidden_at is null group by kind) k;
  select coalesce(jsonb_agg(jsonb_build_object('village', v.village, 'village_ar', listing_village_ar(v.village), 'count', v.n) order by v.village nulls last), '[]'::jsonb) into v_villages
    from (select village, count(*)::int as n from listings where hidden_at is null group by village) v;
  return jsonb_build_object('ok', true, 'total', v_total, 'rows', v_rows, 'kinds', v_kinds, 'villages', v_villages, 'whatsapp', listing_chat_link());
end $$;

-- One place. A hidden or unknown one is not found: the page is gone at once.
create or replace function web_food_place(p_id text) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l listings%rowtype;
begin
  select * into l from listings where listing_id = p_id and hidden_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_listing'); end if;
  return jsonb_build_object('ok', true, 'listing', listing_json(l) || jsonb_build_object('maps_url', l.maps_url), 'whatsapp', listing_chat_link());
end $$;

-- ---------- the website's writes: one tap, and one short form ----------
-- "I want to order from here": demand, once per anonymous session or signed-in customer and place. No contact detail is asked for or kept.
create or replace function web_listing_want(p_token text, p_listing text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare s web_sessions%rowtype; l listings%rowtype; v_who text; v_cap int := coalesce((setting('listings')->>'want_per_session_hour')::int, 30); v_counted boolean;
begin
  begin s := web_session_of(p_token);
  exception when raise_exception then return jsonb_build_object('ok', false, 'error', 'no_session'); end;
  select * into l from listings where listing_id = p_listing and hidden_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_listing'); end if;
  v_who := case when s.party_id is not null then 'party:' || s.party_id else 'session:' || s.id end;
  if exists (select 1 from demand_signals where dedupe_key = 'listing:' || v_who || ':' || l.listing_id) then
    return jsonb_build_object('ok', true, 'counted', false);
  end if;
  if (select count(*) from demand_signals where kind = 'listing' and detail->>'who' = v_who and created_at > now() - interval '1 hour') >= v_cap then
    return jsonb_build_object('ok', true, 'counted', false, 'capped', true);
  end if;
  v_counted := log_demand('listing', 'web_listing', s.party_id, l.name, null, null, null, null,
                          jsonb_build_object('listing_id', l.listing_id, 'who', v_who, 'channel', 'web'));
  update web_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'counted', v_counted);
end $$;

-- "Remove this listing": the page is hidden at once, the request is logged with its time, and a staff case is raised. Hiding is the safe side, so
-- nobody is checked first. Past a session's daily limit or the hourly limit for everyone the request is still recorded and still raises the case,
-- but the page is left up for staff to decide (hide_listing): a script cannot empty the map.
create or replace function web_listing_remove(p_token text, p_listing text, p_who text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare s web_sessions%rowtype; l listings%rowtype; v_who text := lower(btrim(coalesce(p_who, ''))); v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
        v_hide boolean; v_req uuid;
begin
  begin s := web_session_of(p_token);
  exception when raise_exception then return jsonb_build_object('ok', false, 'error', 'no_session'); end;
  if v_who not in ('owner', 'manager', 'staff', 'other') then return jsonb_build_object('ok', false, 'error', 'bad_who'); end if;
  select * into l from listings where listing_id = p_listing for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_listing'); end if;
  if l.hidden_at is not null then return jsonb_build_object('ok', true, 'hidden', true, 'already', true); end if;
  v_hide := (select count(*) from listing_removal_requests where session_id = s.id and requested_at > now() - interval '1 day')
              < coalesce((setting('listings')->>'removal_per_session_day')::int, 5)
        and (select count(*) from listing_removal_requests where hidden and requested_at > now() - interval '1 hour')
              < coalesce((setting('listings')->>'removal_per_hour')::int, 20);
  insert into listing_removal_requests(listing_id, who, reason, session_id, hidden) values (l.listing_id, v_who, v_reason, s.id, v_hide) returning id into v_req;
  if v_hide then update listings set hidden_at = now() where listing_id = l.listing_id; end if;
  insert into listing_log(listing_id, action, request_id, reason, detail)
    values (l.listing_id, case when v_hide then 'hide' else 'removal_request' end, v_req, v_reason, jsonb_build_object('who', v_who, 'channel', 'web'));
  perform raise_ops_exception('listing_removal', l.listing_id,
            jsonb_build_object('listing_id', l.listing_id, 'name', l.name, 'who', v_who, 'hidden', v_hide, 'request_id', v_req));
  update web_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'hidden', v_hide, 'request_id', v_req);
end $$;

-- ---------- staff: restore, keep hidden, hide (service role; ops lead and admin only) ----------
create or replace function close_listing_requests(p_listing text, p_by uuid, p_note text) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update listing_removal_requests set status = 'closed', closed_at = now(), closed_by = p_by, closed_note = p_note where listing_id = p_listing and status = 'open';
  update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now() where kind = 'listing_removal' and ref = p_listing and status <> 'resolved';
end $$;

create or replace function restore_listing(p_listing text, p_by uuid, p_reason text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare l listings%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_req uuid;
begin
  perform listing_staff_check(p_by);
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into l from listings where listing_id = p_listing for update;
  if not found then raise exception 'UNKNOWN_LISTING'; end if;
  if l.hidden_at is null then raise exception 'NOT_HIDDEN'; end if;
  select id into v_req from listing_removal_requests where listing_id = l.listing_id and status = 'open' order by requested_at desc limit 1;
  update listings set hidden_at = null where listing_id = l.listing_id;
  insert into listing_log(listing_id, action, by_party, request_id, reason) values (l.listing_id, 'restore', p_by, v_req, left(v_reason, 500));
  perform close_listing_requests(l.listing_id, p_by, 'restored: ' || left(v_reason, 480));
  return jsonb_build_object('ok', true, 'listing_id', l.listing_id);
end $$;

-- The request is closed and the page stays hidden: a person looked, and the answer is to leave it.
create or replace function keep_listing_hidden(p_request uuid, p_by uuid, p_note text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r listing_removal_requests%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform listing_staff_check(p_by);
  select * into r from listing_removal_requests where id = p_request for update;
  if not found or r.status <> 'open' then raise exception 'REQUEST_NOT_OPEN'; end if;
  update listing_removal_requests set status = 'closed', closed_at = now(), closed_by = p_by, closed_note = left(v_note, 500) where id = r.id;
  insert into listing_log(listing_id, action, by_party, request_id, reason) values (r.listing_id, 'keep_hidden', p_by, r.id, left(v_note, 500));
  if not exists (select 1 from listing_removal_requests where listing_id = r.listing_id and status = 'open') then
    update ops_exceptions set status = 'resolved', resolved_by = p_by, resolved_at = now() where kind = 'listing_removal' and ref = r.listing_id and status <> 'resolved';
  end if;
  return jsonb_build_object('ok', true, 'listing_id', r.listing_id);
end $$;

-- Staff hide a page themselves (an owner phoned; a request was over the limit). Closes the open requests for it.
create or replace function hide_listing(p_listing text, p_by uuid, p_reason text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare l listings%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_req uuid;
begin
  perform listing_staff_check(p_by);
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into l from listings where listing_id = p_listing for update;
  if not found then raise exception 'UNKNOWN_LISTING'; end if;
  if l.hidden_at is not null then raise exception 'ALREADY_HIDDEN'; end if;
  select id into v_req from listing_removal_requests where listing_id = l.listing_id and status = 'open' order by requested_at desc limit 1;
  update listings set hidden_at = now() where listing_id = l.listing_id;
  insert into listing_log(listing_id, action, by_party, request_id, reason) values (l.listing_id, 'hide', p_by, v_req, left(v_reason, 500));
  perform close_listing_requests(l.listing_id, p_by, 'hidden by staff: ' || left(v_reason, 470));
  return jsonb_build_object('ok', true, 'listing_id', l.listing_id);
end $$;

-- ---------- the customer line: "Claim <listing_id>" (service role; the turn calls it by code, before any model) ----------
-- Only the exact words "Claim" and a known listing id are a claim: "claim my refund" is not, and falls through to the Concierge. A claim opens a staff
-- case (open_case, kind other) with the listing and the sender; the sender's number is the conversation's. It changes nothing about the listing and
-- sends nothing: the turn replies "we will be in touch" through the gateway. We never message a listed number (there is none), and two people may each
-- claim the same place: staff sort it out, arriving first decides nothing. Verification is the owner's own message or a visit (Phase 8 decides the rest).
create or replace function claim_listing(p_party uuid, p_conversation uuid, p_text text, p_wamid text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_id text; l listings%rowtype; c conversations%rowtype; k listing_claims%rowtype; h handoffs%rowtype; v_case jsonb; v_topic text; v_open jsonb;
begin
  v_id := substring(btrim(coalesce(p_text, '')) from '(?i)^claim[[:space:]]+([^[:space:]]+)$');
  if v_id is null then return jsonb_build_object('ok', false, 'status', 'not_a_claim'); end if;
  select * into l from listings where lower(listing_id) = lower(v_id);
  if not found then return jsonb_build_object('ok', false, 'status', 'unknown'); end if;
  select * into c from conversations where id = p_conversation and party_id = p_party and line = 'customer';
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  v_topic := left('Claim: ' || l.name || ' (' || l.listing_id || ')', 300);
  select * into k from listing_claims where listing_id = l.listing_id and party_id = p_party for update;
  if found then
    select * into h from handoffs where id = k.case_id;
    if found and h.state <> 'resolved' then
      return jsonb_build_object('ok', true, 'status', 'claimed', 'again', true, 'listing_id', l.listing_id, 'name', l.name,
                                'hidden', l.hidden_at is not null, 'case', case_json(h) || jsonb_build_object('opened', false));
    end if;
  end if;
  v_case := open_case(p_conversation, 'other', v_topic, null, 'listing_claim');
  if not (v_case->>'opened')::boolean then
    update handoffs set topic = left(coalesce(topic, '') || case when topic is null or topic = '' then '' else '; ' end || v_topic, 600) where id = (v_case->>'case_id')::uuid;
  end if;
  if k.id is null then
    insert into listing_claims(listing_id, party_id, conversation_id, case_id, wamid) values (l.listing_id, p_party, p_conversation, (v_case->>'case_id')::uuid, p_wamid);
  else
    update listing_claims set case_id = (v_case->>'case_id')::uuid, conversation_id = p_conversation, wamid = p_wamid where id = k.id;
  end if;
  insert into listing_log(listing_id, action, by_party, reason, detail)
    values (l.listing_id, 'claim', p_party, null, jsonb_build_object('case_id', v_case->>'case_id', 'wamid', p_wamid));
  return jsonb_build_object('ok', true, 'status', 'claimed', 'again', false, 'listing_id', l.listing_id, 'name', l.name, 'hidden', l.hidden_at is not null, 'case', v_case);
end $$;

-- ---------- what the console's Listings page reads (service role) ----------
-- p_state: 'all' (every place), 'hidden' (hidden ones), 'review' (hidden, or with a request still open). p_q searches the name and the village.
-- Each row: the place, its demand count (people who tapped "I want to order from here"), its claims, and its latest removal request.
create or replace function listings_console(p_q text default '', p_state text default 'all', p_limit int default 50) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare v_q text := fold_text(left(coalesce(p_q, ''), 80)); v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('listing_id', x.listing_id, 'name', x.name, 'kind', x.kind, 'village', x.village, 'km_from_hub', x.km_from_hub,
             'maps_url', x.maps_url, 'hidden_at', x.hidden_at,
             'wants', (select count(*)::int from demand_signals d where d.kind = 'listing' and d.subject = x.listing_id),
             'claims', (select count(*)::int from listing_claims c where c.listing_id = x.listing_id),
             'request', (select jsonb_build_object('id', r.id, 'who', r.who, 'reason', r.reason, 'status', r.status, 'hidden', r.hidden,
                                                   'requested_at', r.requested_at, 'closed_note', r.closed_note)
                           from listing_removal_requests r where r.listing_id = x.listing_id order by r.requested_at desc limit 1),
             'open_requests', (select count(*)::int from listing_removal_requests r where r.listing_id = x.listing_id and r.status = 'open'))
           order by x.ord)
    from (select l.*, row_number() over (order by (v_q <> '' and fold_text(l.name) = v_q) desc, l.hidden_at desc nulls last, lower(l.name), l.listing_id) as ord
            from listings l
           where (v_q = '' or fold_text(l.name) like '%' || v_q || '%' or fold_text(coalesce(l.village, '')) like '%' || v_q || '%' or lower(l.listing_id) = v_q)
             and (p_state = 'all' or (p_state = 'hidden' and l.hidden_at is not null)
                  or (p_state = 'review' and (l.hidden_at is not null or exists (select 1 from listing_removal_requests r where r.listing_id = l.listing_id and r.status = 'open'))))
           order by ord limit v_limit) x), '[]'::jsonb);
end $$;

create or replace function listing_claims_console(p_limit int default 100) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'listing_id', c.listing_id, 'name', l.name, 'village', l.village, 'party_id', c.party_id,
           'phone', (select i.phone_e164 from party_identities i where i.party_id = c.party_id and i.line = 'customer' and i.phone_e164 is not null limit 1),
           'case_id', c.case_id, 'state', coalesce(h.state, 'open'), 'conversation_id', c.conversation_id, 'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
    from (select * from listing_claims order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) c
    join listings l on l.listing_id = c.listing_id left join handoffs h on h.id = c.case_id $$;

-- ---------- access ----------
alter table listings enable row level security;
alter table listing_removal_requests enable row level security;
alter table listing_log enable row level security;
alter table listing_claims enable row level security;
do $$ declare r text; t text;
begin
  foreach t in array array['listings', 'listing_removal_requests', 'listing_log', 'listing_claims'] loop
    foreach r in array array['anon', 'authenticated', 'web_channel'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table %I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;

grant execute on function web_food_list(text, text, text, int, int) to web_channel;
grant execute on function web_food_place(text)                      to web_channel;
grant execute on function web_listing_want(text, text)              to web_channel;
grant execute on function web_listing_remove(text, text, text, text) to web_channel;
