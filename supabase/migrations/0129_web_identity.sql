-- Alo King Chouf, session C4 (commerce core): identity across channels (docs/SYSTEM_PLAN.md section 1, docs/WEBSITE.md
-- "Identity and consent").
--
-- A web visitor gets an anonymous session (browsing and the cart need no identity). At the first checkout the page shows a code
-- (ALO-7K3Q9P) in a wa.me link to our customer number; the customer sends it; the customer-line turn reads it by code, before
-- any model, and calls claim_link_code(party, code, wamid). That one message proves the phone, links the session to the party,
-- opens the 24-hour window (the inbound message itself), and records transactional consent (consent_events, source
-- 'web_link_code', the message as evidence). So invariant 17 holds: we never message someone who has not messaged us.
--
-- Rules:
--   * The token lives only in the visitor's cookie. The database keeps its SHA-256 (web_sessions.token_hash); a leak of the
--     table signs nobody in.
--   * A link code is single use, expires (settings.web.link_code_minutes, 10), and belongs to one session. Once claimed by one
--     phone it can never be claimed by another; the same phone sending it again (a retried turn) gets the same answer.
--   * A session linked to a party stays that party's: web_link_code refuses a linked session (sign out and start again).
--   * Every function the website calls takes the token, never a party id: the party always comes from the server-side session.
--     claim_link_code takes a party because its caller is the customer-line turn (service role), never the website (0132).

create table if not exists web_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,                    -- hex SHA-256 of the cookie token; the token is never stored
  party_id      uuid references parties(id),             -- set only by claim_link_code
  link_code_id  uuid,                                    -- the claimed code that linked it (0131 requires it to confirm on the page)
  device        text,                                    -- what the website says about the device, for the account page
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  linked_at     timestamptz,
  revoked_at    timestamptz,
  revoked_reason text
);
create index if not exists web_sessions_party on web_sessions(party_id) where party_id is not null;

create table if not exists link_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                      -- 'ALO-' and six characters without 0, O, 1, I
  session_id  uuid not null references web_sessions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references parties(id),
  used_wamid  text,
  check ((used_at is null) = (used_by is null))
);
create index if not exists link_codes_session on link_codes(session_id, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'web_sessions_link_code' and conrelid = 'web_sessions'::regclass) then
    alter table web_sessions add constraint web_sessions_link_code foreign key (link_code_id) references link_codes(id);
  end if;
end $$;

-- ---------- helpers (service role only; 0132 grants none of them to the website) ----------
create or replace function web_token_hash(p_token text) returns text language sql immutable as
$$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

-- The live session behind a token, or an exception the website shows as "start again". Expired and revoked sessions are gone.
create or replace function web_session_of(p_token text) returns web_sessions language plpgsql stable as $$
declare s web_sessions%rowtype;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'NO_SESSION'; end if;
  select * into s from web_sessions where token_hash = web_token_hash(p_token);
  if not found or s.revoked_at is not null or s.expires_at <= now() then raise exception 'NO_SESSION'; end if;
  return s;
end $$;

-- ---------- the website's functions (0132 grants these to web_channel) ----------
-- A new anonymous session. Returns the token once; only its hash is kept.
create or replace function web_session_start(p_device text default null) returns jsonb language plpgsql security definer as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        v_exp timestamptz := now() + make_interval(days => coalesce((setting('web')->>'anonymous_session_days')::int, 30));
        v_id uuid;
begin
  insert into web_sessions(token_hash, device, expires_at) values (web_token_hash(v_token), left(p_device, 200), v_exp) returning id into v_id;
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'linked', false);
end $$;

-- What the page needs to know about its session: linked or not, until when, and whether a code is waiting.
create or replace function web_session_state(p_token text) returns jsonb language plpgsql stable security definer as $$
declare s web_sessions%rowtype; c link_codes%rowtype;
begin
  begin s := web_session_of(p_token);
  exception when raise_exception then return jsonb_build_object('valid', false, 'linked', false); end;
  select * into c from link_codes where session_id = s.id and used_at is null and expires_at > now() order by created_at desc limit 1;
  return jsonb_build_object('valid', true, 'linked', s.party_id is not null, 'expires_at', s.expires_at, 'linked_at', s.linked_at,
                            'code_waiting', case when c.id is not null then jsonb_build_object('code', c.code, 'expires_at', c.expires_at) end);
end $$;

-- Sign out (the account page). The session can never be used again.
create or replace function web_session_end(p_token text) returns jsonb language plpgsql security definer as $$
begin
  update web_sessions set revoked_at = now(), revoked_reason = 'sign_out'
   where token_hash = web_token_hash(p_token) and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- A code for "Confirm your number on WhatsApp". A new code replaces the session's earlier unused one.
create or replace function web_link_code(p_token text) returns jsonb language plpgsql security definer as $$
declare s web_sessions%rowtype; v_code text; v_exp timestamptz; v_alpha text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; v_raw bytea; i int;
begin
  s := web_session_of(p_token);
  if s.party_id is not null then
    return jsonb_build_object('ok', false, 'error', 'already_linked');
  end if;
  update link_codes set expires_at = now() where session_id = s.id and used_at is null and expires_at > now();
  v_exp := now() + make_interval(mins => coalesce((setting('web')->>'link_code_minutes')::int, 10));
  loop
    v_raw := sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8'));
    v_code := 'ALO-';
    for i in 0..5 loop v_code := v_code || substr(v_alpha, get_byte(v_raw, i) % 32 + 1, 1); end loop;   -- 32 symbols: uniform
    begin
      insert into link_codes(code, session_id, expires_at) values (v_code, s.id, v_exp);
      exit;
    exception when unique_violation then null;   -- a used code is never issued again
    end;
  end loop;
  update web_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_exp);
end $$;

-- ---------- the customer-line turn's function (service role; never the website) ----------
-- p_code may be the whole message: the first ALO-xxxxxx in it is read. Answers:
--   linked (also when the same phone sends the same code again), not_a_code, unknown, used (claimed by another phone, or the
--   session is someone else's), expired (the code or its session), not_customer.
create or replace function claim_link_code(p_party uuid, p_code text, p_wamid text default null) returns jsonb language plpgsql as $$
declare v_code text; c link_codes%rowtype; s web_sessions%rowtype; v_role party_role;
begin
  v_code := upper(substring(coalesce(p_code, '') from '(?i)ALO[- ]?([23456789A-HJ-NP-Z]{6})(?![0-9A-Z])'));
  if v_code is null then return jsonb_build_object('ok', false, 'status', 'not_a_code'); end if;
  v_code := 'ALO-' || v_code;
  select * into c from link_codes where code = v_code for update;
  if not found then return jsonb_build_object('ok', false, 'status', 'unknown'); end if;
  if c.used_at is not null then
    if c.used_by = p_party then
      return jsonb_build_object('ok', true, 'status', 'linked', 'again', true, 'session_id', c.session_id);
    end if;
    return jsonb_build_object('ok', false, 'status', 'used');
  end if;
  if c.expires_at <= now() then return jsonb_build_object('ok', false, 'status', 'expired'); end if;
  select role into v_role from parties where id = p_party;
  if v_role is distinct from 'customer' then return jsonb_build_object('ok', false, 'status', 'not_customer'); end if;
  select * into s from web_sessions where id = c.session_id for update;
  if s.revoked_at is not null or s.expires_at <= now() then return jsonb_build_object('ok', false, 'status', 'expired'); end if;
  if s.party_id is not null and s.party_id <> p_party then return jsonb_build_object('ok', false, 'status', 'used'); end if;

  update link_codes set used_at = now(), used_by = p_party, used_wamid = p_wamid where id = c.id;
  update web_sessions set party_id = p_party, link_code_id = c.id, linked_at = now(), last_seen_at = now(),
         expires_at = now() + make_interval(days => coalesce((setting('web')->>'session_days')::int, 90))
   where id = s.id;
  -- The page said what sending the code means; the message is the evidence (as the card's confirm tap is, 0040).
  insert into consent_events(party_id, line, kind, action, source, wording, evidence_message_id)
    values (p_party, 'customer', 'transactional', 'opt_in', 'web_link_code',
            'بإرسال الرمز بتأكد رقمك وبتوافق نبعتلك تحديثات طلباتك على هالمحادثة', p_wamid);
  return jsonb_build_object('ok', true, 'status', 'linked', 'again', false, 'session_id', s.id);
end $$;

-- "Sign out everywhere": from the account page of any of the party's sessions, or from WhatsApp (the turn, by code).
create or replace function web_sessions_revoke(p_party uuid, p_reason text default 'sign_out_everywhere') returns int language plpgsql as $$
declare n int;
begin
  update web_sessions set revoked_at = now(), revoked_reason = left(coalesce(p_reason, 'sign_out_everywhere'), 80)
   where party_id = p_party and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

alter table web_sessions enable row level security;
alter table link_codes enable row level security;
do $$ declare r text; t text;
begin
  foreach t in array array['web_sessions', 'link_codes'] loop
    foreach r in array array['anon', 'authenticated'] loop
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
