-- Session 5 (DECISIONS §12, §30.1.2, §32.5 Flowso): WhatsApp Flows and the Meta catalogue. Contents:
--   1. config: Flows and catalogue switches (off until they are published on the company number), kill-gates
--   2. opening hours (the merchant_claim and merchant_hours Flows write them; a tick pauses outside them)
--   3. Flow sends and submissions: the server builds each Flow's initial data, gives it a token, and handles
--      the submission deterministically (zero model calls); prices never come from a Flow (§12)
--   4. catalogue sync state and the desired catalogue per branch (built against fixtures; §30.1.2)
-- New columns on frozen tables are added with defaults and touch no existing row (§31): vendors.cash_currencies.

-- 1. Config ------------------------------------------------------------------------------------------------
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'seed from DECISIONS.md §12, §30.1.2, 11 October 2026 (session 5)', false);
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('flows_enabled', 'false', '2026-10-11 00:00+03', 'Send WhatsApp Flows (§12) once they are published on the sending number; until then the text paths run', null),
  ('flow_kill_gate', '{"min_sends": 100, "min_completion": 0.6}', '2026-10-11 00:00+03', 'After 100 sends a Flow completed by fewer than 60% is switched off (§12)', null),
  ('catalog_enabled', 'false', '2026-10-11 00:00+03', 'Native WhatsApp cart from the Meta catalogue (§30.1.2); needs the company business portfolio, switched on at cut-over', null),
  ('catalog_kill_gate', '{"min_opens": 200, "min_sent_share": 0.5, "window_min": 10}', '2026-10-11 00:00+03', 'If fewer than 50% of opened carts are sent within 10 min over 200 opens, list-plus-text becomes primary (§30.1.2)', null);
select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);

-- 2. Opening hours --------------------------------------------------------------------------------------------
-- One row per open weekday (0 = Sunday), in Beirut time. A closing time before the opening time means after
-- midnight. A vendor with no rows is treated as always open (the state before hours existed).
create table public.vendor_hours (
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,
  updated_at timestamptz not null default now(),
  primary key (vendor_id, weekday)
);
create trigger vendor_hours_audit after insert or update or delete on public.vendor_hours
  for each row execute function app_private.audit_row();
alter table public.vendor_hours enable row level security;
revoke all on table public.vendor_hours from public, anon, authenticated;
grant all on table public.vendor_hours to service_role;
grant select on table public.vendor_hours to anon, authenticated;
create policy vendor_hours_read on public.vendor_hours for select to anon, authenticated
  using (app_private.menu_vendor_visible(vendor_id));

-- Cash currencies the merchant accepts at the door (§12 merchant_claim). Default: both.
alter table public.vendors add column cash_currencies text[] not null default '{USD,LBP}'
  check (cash_currencies <@ array['USD', 'LBP'] and cardinality(cash_currencies) >= 1);
grant select (cash_currencies) on table public.vendors to anon, authenticated;

-- A staff member's name as the owner gave it (merchant_claim, staff by WhatsApp).
alter table public.vendor_members add column display_name text check (char_length(display_name) <= 60);

-- Whether the vendor is open at a moment (Beirut time), from its hours.
create function app_private.vendor_open_at(p_vendor_id uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  with t as (select (p_at at time zone 'Asia/Beirut') as l)
  select case when not exists (select 1 from public.vendor_hours h where h.vendor_id = p_vendor_id) then true
    else exists (
      select 1 from public.vendor_hours h, t
      where h.vendor_id = p_vendor_id and (
        -- same-day window
        (h.opens < h.closes and h.weekday = extract(dow from t.l) and t.l::time >= h.opens and t.l::time < h.closes)
        -- window past midnight: the evening part on its day, the early part on the next day
        or (h.opens >= h.closes and h.weekday = extract(dow from t.l) and t.l::time >= h.opens)
        or (h.opens >= h.closes and h.weekday = (extract(dow from t.l)::int + 6) % 7 and t.l::time < h.closes)))
    end;
$$;
revoke all on function app_private.vendor_open_at(uuid, timestamptz) from public;

-- The next opening after a moment (searched in half-hour steps over 8 days), or null when never open.
create function app_private.vendor_next_open(p_vendor_id uuid, p_at timestamptz default now()) returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select min(s) from generate_series(date_trunc('hour', p_at) + interval '30 minutes', p_at + interval '8 days', interval '30 minutes') s
  where app_private.vendor_open_at(p_vendor_id, s) and s > p_at;
$$;
revoke all on function app_private.vendor_next_open(uuid, timestamptz) from public;

-- Every minute: an orderable vendor outside its hours is paused until it opens (the quote then shows the
-- reopening time, as for any pause); one reopened by its hours is resumed. A merchant's own pause is never
-- touched.
create function app_private.hours_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  n_paused int := 0;
  n_resumed int := 0;
  v_next timestamptz;
begin
  perform set_config('app.actor_kind', 'system', true);
  for v in
    select x.id, x.paused_until, x.pause_reason from public.vendors x
    where x.orderable and exists (select 1 from public.vendor_hours h where h.vendor_id = x.id)
  loop
    if app_private.vendor_open_at(v.id) then
      if v.pause_reason = 'closed (hours)' and v.paused_until > now() then
        perform app_private.vendor_set_pause(v.id, null, null, 'opened (hours)');
        n_resumed := n_resumed + 1;
      end if;
    elsif v.paused_until is null or v.paused_until <= now() then
      v_next := app_private.vendor_next_open(v.id);
      if v_next is not null then
        perform app_private.vendor_set_pause(v.id, v_next, 'closed (hours)', 'closed (hours)');
        n_paused := n_paused + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('paused', n_paused, 'resumed', n_resumed);
end;
$$;
revoke all on function app_private.hours_tick() from public;
select cron.schedule('hours-tick', '* * * * *', 'select app_private.hours_tick()');

-- Writes a vendor's weekly hours: the same opening and closing on every day not in p_closed_days.
create function app_private.vendor_hours_set(p_vendor_id uuid, p_opens time, p_closes time, p_closed_days smallint[]) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_opens = p_closes then
    raise exception 'opening and closing times must differ' using errcode = 'check_violation';
  end if;
  perform set_config('app.audit_reason', 'merchant set opening hours', true);
  delete from public.vendor_hours where vendor_id = p_vendor_id;
  insert into public.vendor_hours (vendor_id, weekday, opens, closes)
  select p_vendor_id, d, p_opens, p_closes from generate_series(0, 6) d
  where not d = any (coalesce(p_closed_days, '{}'));
end;
$$;
revoke all on function app_private.vendor_hours_set(uuid, time, time, smallint[]) from public;

-- 3. Flows ---------------------------------------------------------------------------------------------------
create table public.flow_sends (
  token text primary key check (token ~ '^[a-z_]+:[0-9a-f]{32}$'),
  flow text not null check (flow in ('address_capture', 'item_options', 'merchant_claim', 'merchant_hours')),
  lang text not null check (lang in ('ar', 'en')),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  customer_id uuid references public.customers (id) on delete cascade,
  vendor_id uuid references public.vendors (id) on delete cascade,
  member_id uuid references public.vendor_members (id) on delete cascade,
  -- What the Flow was opened for (address, item and its option map); never prices the server would trust.
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object'),
  sent_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index flow_sends_flow_idx on public.flow_sends (flow, sent_at);

create table public.flow_submissions (
  id bigint generated always as identity primary key,
  token text not null unique references public.flow_sends (token) on delete cascade,
  flow text not null,
  flow_version text not null default '7.3',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null check (status in ('applied', 'rejected')),
  result jsonb not null default '{}',
  received_at timestamptz not null default now()
);
alter table public.flow_sends enable row level security;
alter table public.flow_submissions enable row level security;
revoke all on table public.flow_sends, public.flow_submissions from public, anon, authenticated;
grant all on table public.flow_sends, public.flow_submissions to service_role;
grant select on table public.flow_sends, public.flow_submissions to authenticated;
create policy flow_sends_operator_read on public.flow_sends for select to authenticated using ((select app_private.is_operator()));
create policy flow_submissions_operator_read on public.flow_submissions for select to authenticated using ((select app_private.is_operator()));

-- Opens a Flow for a person: checks who may open it, builds its initial data from the database and returns
-- {"token", "flow", "screen", "data"} for the message (or {"status": "off"} while Flows are disabled).
create function public.flow_open(p_flow text, p_lang text, p_phone text, p_customer_id uuid default null,
  p_member_id uuid default null, p_context jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := p_flow || ':' || encode(extensions.gen_random_bytes(16), 'hex');
  v_lang text := case when p_lang = 'ar' then 'ar' else 'en' end;
  v_member public.vendor_members%rowtype;
  v_vendor public.vendors%rowtype;
  v_data jsonb;
  v_ctx jsonb := '{}';
  v_screen text;
  v_addr record;
  v_groups jsonb;
  v_map jsonb := '{}';
  g record;
  o record;
  k int := 0;
  n int := 0;
  v_items jsonb;
  v_note text;
begin
  if not app_private.config_bool('flows_enabled') then
    return jsonb_build_object('status', 'off');
  end if;
  if p_member_id is not null then
    select * into v_member from public.vendor_members where id = p_member_id and phone_e164 = p_phone and status = 'active'
      and role in ('owner', 'manager');
    if v_member.id is null then
      return jsonb_build_object('status', 'not_allowed');
    end if;
    select * into v_vendor from public.vendors where id = v_member.vendor_id;
  end if;
  case p_flow
    when 'address_capture' then
      select a.id, coalesce(case when v_lang = 'ar' then p.name_ar end, p.name_en, p.name_ar) as place into v_addr
      from public.addresses a join public.places p on p.id = a.place_id
      where a.id = (p_context ->> 'address_id')::uuid and a.customer_id = p_customer_id;
      if v_addr.id is null then
        return jsonb_build_object('status', 'unknown_address');
      end if;
      v_screen := 'ADDRESS';
      v_data := jsonb_build_object('address_id', v_addr.id, 'place_name', v_addr.place);
      v_ctx := jsonb_build_object('address_id', v_addr.id);
    when 'item_options' then
      -- Up to three groups: the first and third as single choices, the second as a multiple choice. Option
      -- ids in the Flow are short keys (o1, o2…) mapped back to our ids on submit; prices are only labels.
      v_data := jsonb_build_object('item_id', p_context ->> 'item_id', 'g1_visible', false, 'g1_required', false,
        'g2_visible', false, 'g3_visible', false, 'g3_required', false, 'g1_label', '', 'g2_label', '', 'g3_label', '',
        'g1_items', '[]', 'g2_items', '[]', 'g3_items', '[]');
      select coalesce(case when v_lang = 'ar' then i.name_ar end, i.name_en, i.name_ar, i.name_fr) into v_note
      from public.menu_items i where i.id = (p_context ->> 'item_id')::uuid;
      v_data := v_data || jsonb_build_object('item_name', v_note);
      if v_note is null then
        return jsonb_build_object('status', 'unknown_item');
      end if;
      for g in
        select gg.* from public.menu_option_groups gg where gg.item_id = (p_context ->> 'item_id')::uuid
        order by gg.sort_order, gg.id limit 3
      loop
        k := k + 1;
        v_items := '[]';
        for o in
          select oo.* from public.menu_options oo where oo.group_id = g.id and oo.available order by oo.sort_order, oo.id limit 20
        loop
          n := n + 1;
          v_map := v_map || jsonb_build_object('o' || n, jsonb_build_object('option_id', o.id, 'group', k));
          v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', 'o' || n,
            'title', left(coalesce(case when v_lang = 'ar' then o.name_ar end, o.name_en, o.name_ar, o.name_fr), 30),
            'description', case when o.price_delta_usd > 0 then '+$' || to_char(o.price_delta_usd, 'FM9990.00') end)));
        end loop;
        v_data := v_data || jsonb_build_object('g' || k || '_label',
            left(coalesce(case when v_lang = 'ar' then g.name_ar end, g.name_en, g.name_ar, g.name_fr), 30),
          'g' || k || '_items', v_items, 'g' || k || '_visible', jsonb_array_length(v_items) > 0);
        if k <> 2 then
          v_data := v_data || jsonb_build_object('g' || k || '_required', g.min_select > 0 and jsonb_array_length(v_items) > 0);
        end if;
        v_ctx := v_ctx || jsonb_build_object('g' || k, jsonb_build_object('group_id', g.id, 'min', g.min_select, 'max', g.max_select));
      end loop;
      v_screen := 'OPTIONS';
      v_ctx := v_ctx || jsonb_build_object('item_id', p_context ->> 'item_id', 'map', v_map);
    when 'merchant_claim' then
      if v_member.id is null then return jsonb_build_object('status', 'not_allowed'); end if;
      v_screen := 'PROFILE';
      v_data := jsonb_build_object('vendor_id', v_vendor.id, 'name_ar', coalesce(v_vendor.name_ar, ''), 'name_en', coalesce(v_vendor.name_en, ''));
      v_ctx := jsonb_build_object('vendor_id', v_vendor.id);
    when 'merchant_hours' then
      if v_member.id is null then return jsonb_build_object('status', 'not_allowed'); end if;
      v_screen := 'HOURS';
      v_data := jsonb_build_object('vendor_id', v_vendor.id,
        'opens', coalesce((select to_char(h.opens, 'HH24:MI') from public.vendor_hours h where h.vendor_id = v_vendor.id order by h.weekday limit 1), '09:00'),
        'closes', coalesce((select to_char(h.closes, 'HH24:MI') from public.vendor_hours h where h.vendor_id = v_vendor.id order by h.weekday limit 1), '23:00'));
      v_ctx := jsonb_build_object('vendor_id', v_vendor.id);
    else
      raise exception 'unknown flow %', p_flow using errcode = 'invalid_parameter_value';
  end case;
  insert into public.flow_sends (token, flow, lang, phone_e164, customer_id, vendor_id, member_id, context)
  values (v_token, p_flow, v_lang, p_phone, p_customer_id, v_vendor.id, v_member.id, v_ctx);
  return jsonb_build_object('status', 'ok', 'token', v_token, 'flow', p_flow, 'lang', v_lang, 'screen', v_screen, 'data', v_data);
end;
$$;

-- The submission (an `nfm_reply`): the token must belong to the sender and be unused; the payload is
-- re-validated against the context the server stored, and applied by the same functions the chat uses.
create function public.flow_submit(p_phone text, p_token text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.flow_sends%rowtype;
  v_r jsonb;
  v_opts uuid[] := '{}';
  v_n int;
  v_cnt int;
  v_g jsonb;
  v_note text;
  v_phone text;
  v_closed smallint[];
  v_until timestamptz;
begin
  select * into v_s from public.flow_sends where token = p_token for update;
  if v_s.token is null or v_s.phone_e164 <> p_phone then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_s.submitted_at is not null then
    return coalesce((select f.result || jsonb_build_object('status', 'duplicate') from public.flow_submissions f where f.token = p_token),
      jsonb_build_object('status', 'duplicate'));
  end if;
  update public.flow_sends set submitted_at = now() where token = p_token;
  p_payload := coalesce(p_payload, '{}');
  case v_s.flow
    when 'address_capture' then
      if (p_payload ->> 'address_id') is distinct from (v_s.context ->> 'address_id') then
        v_r := jsonb_build_object('status', 'rejected', 'reason', 'address mismatch');
      else
        v_note := nullif(trim(concat_ws(' · ',
          nullif(trim(p_payload ->> 'landmark'), ''),
          nullif(trim(p_payload ->> 'notes'), ''))), '');
        v_r := public.address_set_details(v_s.customer_id, (v_s.context ->> 'address_id')::uuid,
          p_payload ->> 'building', p_payload ->> 'floor', v_note, null);
        v_phone := regexp_replace(coalesce(p_payload ->> 'driver_phone', ''), '[^0-9+]', '', 'g');
        if v_phone ~ '^0?(3|7[0-9]|81)[0-9]{6}$' then v_phone := '+961' || ltrim(v_phone, '0'); end if;
        update public.addresses set
          apartment = coalesce(left(nullif(trim(p_payload ->> 'apartment'), ''), 20), apartment),
          phone_for_driver = case when v_phone ~ '^\+[1-9][0-9]{6,14}$' then v_phone else phone_for_driver end
        where id = (v_s.context ->> 'address_id')::uuid and customer_id = v_s.customer_id;
        v_r := coalesce(v_r, '{}') || jsonb_build_object('status', coalesce(v_r ->> 'status', 'updated'));
      end if;
    when 'item_options' then
      if (p_payload ->> 'item_id') is distinct from (v_s.context ->> 'item_id') then
        v_r := jsonb_build_object('status', 'rejected', 'reason', 'item mismatch');
      else
        -- Map the short ids back, per group, and enforce each group's minimum and maximum here.
        for v_cnt in 1..3 loop
          v_g := v_s.context -> ('g' || v_cnt);
          continue when v_g is null;
          select count(*) into v_n from (
            select x from jsonb_array_elements_text(case jsonb_typeof(p_payload -> ('g' || v_cnt))
              when 'array' then p_payload -> ('g' || v_cnt) when 'string' then jsonb_build_array(p_payload -> ('g' || v_cnt)) else '[]' end) x
            where nullif(x, '') is not null) q;
          -- Every id sent for this group must be one the Flow offered in this group.
          if exists (select 1 from jsonb_array_elements_text(case jsonb_typeof(p_payload -> ('g' || v_cnt))
                       when 'array' then p_payload -> ('g' || v_cnt) when 'string' then jsonb_build_array(p_payload -> ('g' || v_cnt)) else '[]' end) x
                     where nullif(x, '') is not null and (v_s.context -> 'map' -> x ->> 'group') is distinct from v_cnt::text) then
            v_r := jsonb_build_object('status', 'rejected', 'reason', 'unknown option');
            exit;
          end if;
          if v_n < (v_g ->> 'min')::int or v_n > (v_g ->> 'max')::int then
            v_r := jsonb_build_object('status', 'rejected', 'reason', 'choices', 'group', v_cnt,
              'min', v_g -> 'min', 'max', v_g -> 'max');
            exit;
          end if;
          v_opts := v_opts || array(
            select (v_s.context -> 'map' -> x ->> 'option_id')::uuid
            from jsonb_array_elements_text(case jsonb_typeof(p_payload -> ('g' || v_cnt))
              when 'array' then p_payload -> ('g' || v_cnt) when 'string' then jsonb_build_array(p_payload -> ('g' || v_cnt)) else '[]' end) x
            where nullif(x, '') is not null and (v_s.context -> 'map' -> x ->> 'group')::int = v_cnt);
        end loop;
        if v_r is null then
          if cardinality(array_remove(v_opts, null)) <> cardinality(v_opts) then
            v_r := jsonb_build_object('status', 'rejected', 'reason', 'unknown option');
          else
            v_r := public.basket_add_item(v_s.customer_id, (v_s.context ->> 'item_id')::uuid,
              least(greatest(coalesce(nullif(p_payload ->> 'quantity', '')::int, 1), 1), 10), v_opts,
              left(nullif(trim(p_payload ->> 'note'), ''), 200), false);
          end if;
        end if;
      end if;
    when 'merchant_claim' then
      perform app_private.menu_editor(v_s.vendor_id, v_s.member_id);
      if (p_payload ->> 'vendor_id') is distinct from (v_s.context ->> 'vendor_id') then
        v_r := jsonb_build_object('status', 'rejected', 'reason', 'vendor mismatch');
      else
        perform set_config('app.actor_kind', 'whatsapp', true);
        perform set_config('app.audit_reason', 'merchant_claim Flow submitted by the merchant', true);
        update public.vendors set
          name_ar = coalesce(left(nullif(trim(p_payload ->> 'name_ar'), ''), 80), name_ar),
          name_en = coalesce(left(nullif(trim(p_payload ->> 'name_en'), ''), 80), name_en),
          delivery_radius_km = least(greatest(coalesce(nullif(p_payload ->> 'radius_km', '')::numeric, delivery_radius_km, 3), 0.5), public.max_delivery_km()),
          cash_currencies = coalesce((select array_agg(distinct c order by c) from jsonb_array_elements_text(
            case when jsonb_typeof(p_payload -> 'cash') = 'array' then p_payload -> 'cash' else '[]' end) c where c in ('USD', 'LBP')), cash_currencies),
          field_sources = field_sources || jsonb_build_object('name_ar', 'merchant', 'name_en', 'merchant', 'delivery_radius_km', 'merchant')
        where id = v_s.vendor_id;
        update public.vendor_members set display_name = left(nullif(trim(p_payload ->> 'owner_name'), ''), 60)
        where id = v_s.member_id and nullif(trim(p_payload ->> 'owner_name'), '') is not null;
        if (p_payload ->> 'opens') ~ '^[0-2][0-9]:[0-5][0-9]$' and (p_payload ->> 'closes') ~ '^[0-2][0-9]:[0-5][0-9]$' then
          perform app_private.vendor_hours_set(v_s.vendor_id, (p_payload ->> 'opens')::time, (p_payload ->> 'closes')::time, '{}');
        end if;
        v_r := jsonb_build_object('status', 'saved', 'menu_photos', coalesce((p_payload ->> 'menu_photos')::boolean, false));
      end if;
    when 'merchant_hours' then
      perform app_private.menu_editor(v_s.vendor_id, v_s.member_id);
      if (p_payload ->> 'vendor_id') is distinct from (v_s.context ->> 'vendor_id')
         or coalesce(p_payload ->> 'opens', '') !~ '^[0-2][0-9]:[0-5][0-9]$' or coalesce(p_payload ->> 'closes', '') !~ '^[0-2][0-9]:[0-5][0-9]$' then
        v_r := jsonb_build_object('status', 'rejected', 'reason', 'hours');
      else
        perform set_config('app.actor_kind', 'whatsapp', true);
        v_closed := array(select x::smallint from jsonb_array_elements_text(
          case when jsonb_typeof(p_payload -> 'closed_days') = 'array' then p_payload -> 'closed_days' else '[]' end) x where x ~ '^[0-6]$');
        if cardinality(v_closed) = 7 then
          v_r := jsonb_build_object('status', 'rejected', 'reason', 'closed every day');
        else
          perform app_private.vendor_hours_set(v_s.vendor_id, (p_payload ->> 'opens')::time, (p_payload ->> 'closes')::time, v_closed);
          v_until := case p_payload ->> 'pause'
            when '1h' then now() + interval '1 hour' when '2h' then now() + interval '2 hours' when '4h' then now() + interval '4 hours'
            when 'tomorrow' then app_private.vendor_next_open(v_s.vendor_id, ((now() at time zone 'Asia/Beirut')::date + 1)::timestamp at time zone 'Asia/Beirut')
            end;
          if v_until is not null then
            perform app_private.vendor_set_pause(v_s.vendor_id, v_until, 'merchant pause', 'pause');
          end if;
          v_r := jsonb_build_object('status', 'saved', 'paused_until', v_until);
        end if;
      end if;
  end case;
  insert into public.flow_submissions (token, flow, payload, status, result)
  values (p_token, v_s.flow, p_payload, case when v_r ->> 'status' = 'rejected' then 'rejected' else 'applied' end, coalesce(v_r, '{}'));
  return jsonb_build_object('flow', v_s.flow, 'lang', v_s.lang) || coalesce(v_r, '{}');
end;
$$;

-- Kill-gate numbers per Flow (§12): sends, submissions, completion share.
create function public.flow_kill_gate() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(flow, jsonb_build_object('sends', sends, 'submitted', submitted,
    'completion', case when sends > 0 then round(submitted::numeric / sends, 2) end)), '{}')
  from (select s.flow, count(*) as sends, count(s.submitted_at) as submitted from public.flow_sends s group by s.flow) x;
$$;

-- 4. Catalogue (§30.1.2) ---------------------------------------------------------------------------------------
-- What was last pushed to the Meta catalogue per item; the sync diffs the desired catalogue against it.
create table public.catalog_sync_items (
  item_id uuid primary key references public.menu_items (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  content_hash text not null,
  synced_at timestamptz not null default now()
);
alter table public.catalog_sync_items enable row level security;
revoke all on table public.catalog_sync_items from public, anon, authenticated;
grant all on table public.catalog_sync_items to service_role;

-- The catalogue a claimed, orderable branch should have: one product per item, retailer_id = our item id,
-- price from the menu (display only: every cart is re-priced from the database), one product set per branch.
create function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(coalesce(i.name_ar, i.name_en, i.name_fr), 150),
      'name_en', i.name_en,
      'description', left(coalesce(i.description, ''), 500),
      'price_minor', round(i.price_usd * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'))
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable;
$$;

create function public.catalog_sync_record(p_vendor_id uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  insert into public.catalog_sync_items (item_id, vendor_id, content_hash, synced_at)
  select (x ->> 'retailer_id')::uuid, p_vendor_id, x ->> 'hash', now()
  from jsonb_array_elements(coalesce(p_items, '[]')) x
  where exists (select 1 from public.menu_items i where i.id = (x ->> 'retailer_id')::uuid and i.vendor_id = p_vendor_id)
  on conflict (item_id) do update set content_hash = excluded.content_hash, synced_at = now();
  get diagnostics n = row_count;
  delete from public.catalog_sync_items c where c.vendor_id = p_vendor_id
    and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]')) x where (x ->> 'retailer_id')::uuid = c.item_id);
  return n;
end;
$$;

create function public.catalog_synced(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(c.item_id, c.content_hash), '{}') from public.catalog_sync_items c where c.vendor_id = p_vendor_id;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.flow_open(text, text, text, uuid, uuid, jsonb)',
    'public.flow_submit(text, text, jsonb)',
    'public.flow_kill_gate()',
    'public.catalog_desired(uuid)',
    'public.catalog_sync_record(uuid, jsonb)',
    'public.catalog_synced(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
