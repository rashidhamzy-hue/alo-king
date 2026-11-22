-- 0267 (session PERF1): fast photos, clean storage, a cheap probe.
--
-- 1. Two small copies of every public product picture, for the website (storage image transforms are a paid feature, so the cards were
--    loading the 1000 px originals). The hourly catalog-jpegs workflow (scripts/images/feed-jpegs.mjs, sharp) makes, for each picture that
--    is public (catalog_public_expected: approved, a licence a customer may see, an active item), a 400 px WebP (at most 25,000 bytes) and
--    an 800 px WebP (at most 80,000 bytes), metadata stripped, in the public `catalog` bucket under a CONTENT-HASHED name
--    <sku>-<image id>-w<400|800>-<12 hex of the file's sha256>.webp, uploaded "public, max-age=31536000, immutable". The books follow
--    0115 and 0252 exactly:
--      catalog_variant_work()     what to make (public, a width missing) and what to remove (made, and the picture is no longer public)
--      catalog_variant_made()     the copy is in the bucket; from now the website's picture names it
--      catalog_variant_removed()  the copy is gone
--    catalog_web_picture (0154) gives the two paths as w400 and w800, and only for a picture that is public at this moment: a withdrawn
--    picture leaves every page the moment the database learns of it; its files leave the bucket on the gateway's next minute (it removes,
--    which costs no CPU) or the workflow's next run.
-- 2. The media clean-up (storage-clean workflow): the stored file of a picture rejected or withdrawn more than 3 days ago is deleted through
--    the Storage API; its row, reason and sha256 stay (product_images.file_deleted_at says when the file went). Never a path under labels/
--    or menus/, never a path another row of any table still names, and never the file of a rule's rejection that a person can still undo
--    in the weekly check (8 days).
-- 3. The staging probe's model spend: its turns are priced in agent_run_costs (0102) but were not in model_costs. record_probe_cost()
--    writes them there as workflow 'probe', one run per day. The probe orders every 3 open hours (was hourly) and stops for the day before
--    settings.probe.daily_cap_usd (0.10) would be passed; probe_silent expects an order every probe period plus 30 minutes, and says the
--    period, and is quiet on a day the cap stopped the probe.

-- ---------- 1. picture variants ----------
create table if not exists catalog_picture_variants (
  image_id    uuid not null,                    -- product_images.id. No foreign key, as catalog_feed_jpegs: it outlives a deleted image until removed
  width       int  not null check (width in (400, 800)),
  public_path text not null unique check (public_path ~ '^[A-Za-z0-9_-]+-[0-9a-f-]{36}-w(400|800)-[0-9a-f]{12}\.webp$'),
  bytes       int  not null check (bytes > 0),
  made_at     timestamptz not null default now(),
  primary key (image_id, width),
  check ((width = 400 and bytes <= 25000) or (width = 800 and bytes <= 80000))
);
alter table catalog_picture_variants enable row level security;

create or replace function catalog_variant_work() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'make', coalesce((select jsonb_agg(jsonb_build_object('image_id', e.image_id, 'media_path', e.media_path, 'prefix', e.sku || '-' || e.image_id::text,
                                                          'widths', (select jsonb_agg(w order by w) from unnest(array[400, 800]) w
                                                                      where not exists (select 1 from catalog_picture_variants v where v.image_id = e.image_id and v.width = w)))
                                        order by e.sku)
                        from catalog_public_expected() e
                       where (select count(*) from catalog_picture_variants v where v.image_id = e.image_id) < 2), '[]'::jsonb),
    'remove', coalesce((select jsonb_agg(jsonb_build_object('image_id', v.image_id, 'width', v.width, 'public_path', v.public_path) order by v.made_at)
                          from catalog_picture_variants v
                         where not exists (select 1 from catalog_public_expected() e where e.image_id = v.image_id)), '[]'::jsonb)) $$;

-- Recorded even when the picture was withdrawn while it was being made: the next work list then removes it (as catalog_feed_jpeg_made).
create or replace function catalog_variant_made(p_image uuid, p_width int, p_path text, p_bytes int) returns text language plpgsql set search_path = public, pg_temp as $$
declare v_prefix text; v_cap int := case p_width when 400 then 25000 when 800 then 80000 end;
begin
  if v_cap is null then raise exception 'VARIANT_WIDTH: % (400 or 800)', p_width; end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > v_cap then raise exception 'VARIANT_TOO_BIG: % bytes at % px (at most %)', p_bytes, p_width, v_cap; end if;
  select p.sku || '-' || i.id::text into v_prefix from product_images i join products p on p.id = i.product_id where i.id = p_image;
  if v_prefix is null then raise exception 'IMAGE_NOT_FOUND %', p_image; end if;
  if p_path is null or left(p_path, length(v_prefix) + 6) <> v_prefix || '-w' || p_width || '-' or p_path !~ '-w(400|800)-[0-9a-f]{12}\.webp$' then
    raise exception 'VARIANT_PATH: % is not %-w%-<hash>.webp', p_path, v_prefix, p_width;
  end if;
  insert into catalog_picture_variants(image_id, width, public_path, bytes) values (p_image, p_width, p_path, p_bytes)
  on conflict (image_id, width) do nothing;
  return (select public_path from catalog_picture_variants where image_id = p_image and width = p_width);
end $$;

create or replace function catalog_variant_removed(p_path text) returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  delete from catalog_picture_variants where public_path = p_path;
  return found;
end $$;

-- 0252's text: a variant the books know is not a stray either.
create or replace function catalog_picture_strays(p_listed text[]) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(coalesce(p_listed, '{}'::text[])) x
   where not exists (select 1 from catalog_public_pictures c where c.public_path = x)
     and not exists (select 1 from catalog_feed_jpegs j where j.public_path = x)
     and not exists (select 1 from catalog_picture_variants v where v.public_path = x) $$;

-- 0252's text, and the same for the variants: a book entry whose object is gone is forgotten, so it is made again.
create or replace function catalog_picture_forget(p_listed text[]) returns int language plpgsql set search_path = public, pg_temp as $$
declare n int; m int; k int;
begin
  delete from catalog_public_pictures c
   where c.copied_at < now() - interval '10 minutes' and not (c.public_path = any (coalesce(p_listed, '{}'::text[])));
  get diagnostics n = row_count;
  delete from catalog_feed_jpegs j
   where j.made_at < now() - interval '10 minutes' and not (j.public_path = any (coalesce(p_listed, '{}'::text[])));
  get diagnostics m = row_count;
  delete from catalog_picture_variants v
   where v.made_at < now() - interval '10 minutes' and not (v.public_path = any (coalesce(p_listed, '{}'::text[])));
  get diagnostics k = row_count;
  return n + m + k;
end $$;

-- 0252's numbers, with the variants.
create or replace function catalog_public_report() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'expected', (select count(*) from catalog_public_expected()),
    'recorded', (select count(*) from catalog_public_pictures),
    'to_copy', jsonb_array_length(catalog_picture_work()->'copy'),
    'to_remove', jsonb_array_length(catalog_picture_work()->'remove'),
    'recorded_not_expected', (select count(*) from catalog_public_pictures c where not exists (select 1 from catalog_public_expected() e where e.image_id = c.image_id)),
    'feed_jpegs', (select count(*) from catalog_feed_jpegs),
    'feed_jpegs_to_make', jsonb_array_length(catalog_feed_jpeg_work()->'make'),
    'feed_jpegs_to_remove', jsonb_array_length(catalog_feed_jpeg_work()->'remove'),
    'variants', (select count(*) from catalog_picture_variants),
    'variants_to_make', (select coalesce(sum(jsonb_array_length(x->'widths')), 0) from jsonb_array_elements(catalog_variant_work()->'make') x),
    'variants_to_remove', jsonb_array_length(catalog_variant_work()->'remove')) $$;

-- Every original copy (with the private file it came from) and every feed JPEG the books know: the one-off pass that uploads them again
-- with the long-lived header (REHEADER=1 of the catalog-jpegs workflow). Variants are made with it from the start.
create or replace function catalog_known_objects() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'public_path'), '[]'::jsonb) from (
    select jsonb_build_object('public_path', c.public_path, 'media_path', i.media_path) x
      from catalog_public_pictures c join product_images i on i.id = c.image_id
    union all
    select jsonb_build_object('public_path', j.public_path, 'media_path', null) from catalog_feed_jpegs j) k $$;

-- 0154's text, plus w400 and w800: the small copies, when made (null until then; the page then shows the original, as before).
create or replace function catalog_web_picture(p_product uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('path', c.public_path, 'licence', i.licence, 'source_kind', i.source_kind, 'attribution', i.attribution,
                            'source_url', i.source_url, 'width_px', i.width_px, 'height_px', i.height_px,
                            'w400', (select v.public_path from catalog_picture_variants v where v.image_id = e.image_id and v.width = 400),
                            'w800', (select v.public_path from catalog_picture_variants v where v.image_id = e.image_id and v.width = 800))
    from catalog_public_expected() e
    join catalog_public_pictures c on c.image_id = e.image_id
    join product_images i on i.id = e.image_id
   where e.product_id = p_product
   order by i.fetched_at desc limit 1 $$;

-- ---------- 2. the media clean-up ----------
alter table product_images add column if not exists file_deleted_at timestamptz;

-- The files to delete: pictures rejected (or withdrawn, which is a rejection of an approved picture, 0050) more than p_days ago. Every
-- text column of the public schema whose name ends in "path" (label photos, menus, receipts, payment proofs, the thermometer, any later
-- one) is read: a file still named anywhere else is left, as is anything under labels/ or menus/.
create or replace function media_cleanup_work(p_days int default 3, p_rule_days int default 8) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare cand text[]; held text[] := '{}'; c record; got text[];
begin
  select coalesce(array_agg(distinct i.media_path), '{}') into cand
    from product_images i
   where i.status = 'rejected' and i.file_deleted_at is null
     and coalesce(i.reviewed_at, i.fetched_at) < now() - make_interval(days => p_days)
     and i.media_path !~ '^(labels|menus)/'
     and not exists (select 1 from automation_decisions a where a.target_id = i.id and a.action = 'rejected' and a.undone_at is null
                        and a.created_at > now() - make_interval(days => p_rule_days));
  if cardinality(cand) = 0 then return '[]'::jsonb; end if;
  -- the same file under another picture that is not rejected
  select coalesce(array_agg(distinct j.media_path), '{}') into got from product_images j where j.media_path = any (cand) and j.status <> 'rejected';
  held := held || got;
  for c in select table_name, column_name from information_schema.columns col
            where col.table_schema = 'public' and col.data_type = 'text' and col.column_name ~ 'path$'
              and not (col.table_name = 'product_images' and col.column_name = 'media_path')
              and col.table_name not in ('catalog_public_pictures', 'catalog_feed_jpegs', 'catalog_picture_variants')
              and exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = col.table_name and t.table_type = 'BASE TABLE')
  loop
    execute format('select coalesce(array_agg(distinct %I), ''{}'') from %I where %I = any ($1)', c.column_name, c.table_name, c.column_name) into got using cand;
    held := held || got;
  end loop;
  return coalesce((select jsonb_agg(jsonb_build_object('media_path', p) order by p) from unnest(cand) p where not (p = any (held))), '[]'::jsonb);
end $$;

-- The file is gone; the rows (status, reason, sha256) stay.
create or replace function media_file_deleted(p_path text) returns int language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  update product_images set file_deleted_at = now() where media_path = p_path and status = 'rejected' and file_deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 3. the probe's spend, recorded and capped ----------
update settings set value = value || '{"every_minutes": 180, "daily_cap_usd": 0.10}'::jsonb where key = 'probe';

-- What the probe's own turns cost on a day (Beirut), as agent_run_costs prices them. Unpriced turns count as nothing here and are
-- visible as unpriced_runs in ai_cost_daily (0139), as before.
create or replace function probe_cost_day(p_day date default (now() at time zone 'Asia/Beirut')::date) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(k.usd), 0) from agent_run_costs k join conversations cv on cv.id = k.conversation_id join parties pa on pa.id = cv.party_id
   where pa.is_probe and k.day = p_day $$;

-- One model_costs run per day: workflow 'probe', run 'probe-<day>', a line per model (step 'gateway turns').
create or replace function record_probe_cost(p_day date default (now() at time zone 'Asia/Beirut')::date) returns int
language plpgsql set search_path = public, pg_temp as $$
declare v_lines jsonb; v_cap numeric := (setting('probe')->>'daily_cap_usd')::numeric;
begin
  select coalesce(jsonb_agg(jsonb_build_object('model', k.model, 'step', 'gateway turns', 'calls', n, 'input_tokens', it, 'output_tokens', ot,
                                               'cache_read_tokens', rd, 'cache_write_tokens', wr, 'usd', usd)), '[]'::jsonb) into v_lines
    from (select k.model, count(*) as n, sum(k.input_tokens) it, sum(k.output_tokens) ot, sum(k.cache_read_tokens) rd, sum(k.cache_write_tokens) wr,
                 coalesce(sum(k.usd), 0) usd
            from agent_run_costs k join conversations cv on cv.id = k.conversation_id join parties pa on pa.id = cv.party_id
           where pa.is_probe and k.day = p_day group by k.model) k;
  if jsonb_array_length(v_lines) = 0 then return 0; end if;
  return record_model_cost('probe', 'probe-' || p_day::text, v_cap, probe_capped(p_day), v_lines);
end $$;

-- The day's cap is reached when the spend so far and one more order (the day's average, or 0.01 before the first) would pass it.
create or replace function probe_capped(p_day date default (now() at time zone 'Asia/Beirut')::date) returns boolean
language sql stable set search_path = public, pg_temp as $$
  with s as (select (setting('probe')->>'daily_cap_usd')::numeric cap, probe_cost_day(p_day) spent,
                    (select count(*) from orders o join parties pa on pa.id = o.customer_id
                      where pa.is_probe and (o.created_at at time zone 'Asia/Beirut')::date = p_day) n)
  select cap is not null and spent + case when n > 0 then spent / n else 0.01 end > cap from s $$;

-- 0266's text, plus: the day's spend recorded (today and yesterday) before each new order, and no order once the day's cap is near.
create or replace function probe_due() returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
declare p record; v_conv uuid; v_why text; v_every int := coalesce((setting('probe')->>'every_minutes')::int, 60);
        v_stuck int := coalesce((setting('probe')->>'stuck_after_minutes')::int, 30);
        v_today date := (now() at time zone 'Asia/Beirut')::date;
begin
  if coalesce(setting('probe')->>'enabled', 'false') <> 'true' then return null; end if;
  if not shop_open_now() then return null; end if;
  select pa.id, i.wa_user_id into p from parties pa join party_identities i on i.party_id = pa.id and i.line = 'customer'
   where pa.is_probe and pa.role = 'customer' limit 1;
  if not found then return null; end if;
  if exists (select 1 from wa_inbound_events e where e.idempotency_key like 'probe:%' and e.line = 'customer'
              and e.payload->'message'->>'type' = 'text' and e.received_at > now() - make_interval(mins => v_every)) then return null; end if;
  if exists (select 1 from orders o where o.customer_id = p.id
              and (o.created_at > now() - make_interval(mins => v_every)
                   or (o.status not in ('closed','cancelled','failed_delivery','returned') and o.created_at > now() - make_interval(mins => 3 * v_stuck)))) then
    return null;
  end if;
  -- PERF1: the spend is recorded before each new order (and yesterday's, so the evening's last turns are counted), and the probe
  -- rests for the day once one more order would pass the cap.
  perform record_probe_cost(v_today - 1);
  perform record_probe_cost(v_today);
  if probe_capped(v_today) then return null; end if;
  select c.id into v_conv from conversations c where c.party_id = p.id and c.line = 'customer' and c.human_handoff;
  if v_conv is not null then
    select h.reason into v_why from handoffs h where h.conversation_id = v_conv order by h.created_at desc limit 1;
    update conversations set human_handoff = false, updated_at = now() where id = v_conv;
    update handoffs set status = 'resolved', resolved_at = now() where conversation_id = v_conv and status = 'open';
    perform raise_ops_exception('probe_handoff_released', v_conv::text || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24'),
                                jsonb_build_object('conversation_id', v_conv, 'reason', coalesce(v_why, 'unknown')));
  end if;
  if coalesce(setting('probe')->>'fresh_place', 'false') = 'true' then
    update customer_places set village_id = null, lat = null, lng = null, building = null, floor = null, directions = null
     where party_id = p.id;
  end if;
  return jsonb_build_object('party_id', p.id, 'wa_user_id', p.wa_user_id, 'text', setting('probe')->>'order_text');
end $$;

-- 0266's text; probe_silent now expects an order every probe period plus 30 minutes (was three periods: at 3 hours that would be nine),
-- says the period (every_minutes) so the message can name it, and is quiet on a day the cap stopped the probe.
create or replace function heartbeat_alerts() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with s as (select setting('heartbeat') h, setting('probe') p),
  open_now as (select shop_open_now() as is_open, shop_opened_at() as opened_at),
  a as (
    select 'probe_stuck' as kind, o.id::text as ref, jsonb_build_object('order', o.short_code, 'status', o.status,
             'minutes', round(extract(epoch from now() - o.created_at) / 60),
             'riders_on_shift', (select count(*) from driver_shifts sh where sh.ended_at is null),
             'riders_with_room', (select count(*) from driver_shifts sh
                                   where sh.ended_at is null
                                     and not exists (select 1 from deliveries d where d.driver_id = sh.driver_id and d.status in ('offered', 'accepted', 'in_progress'))
                                     and driver_can_take(sh.driver_id, case when o.payment_method = 'cod' then o.total_usd else 0 end) = 'ok')) as detail
      from orders o join parties p on p.id = o.customer_id, s
     where p.is_probe and (s.p->>'enabled') = 'true' and o.status not in ('closed','cancelled','failed_delivery','returned')
       and o.created_at < now() - make_interval(mins => (s.p->>'stuck_after_minutes')::int)
    union all
    select 'probe_silent', 'probe', jsonb_build_object('last_order_at', max(o.created_at), 'opened_at', max(open_now.opened_at),
                                                       'every_minutes', (s.p->>'every_minutes')::int)
      from s, open_now, parties p left join orders o on o.customer_id = p.id
     where p.is_probe and p.role = 'customer' and (s.p->>'enabled') = 'true' and open_now.is_open and not probe_capped()
     group by s.p, p.created_at
    having greatest(coalesce(max(o.created_at), p.created_at), max(open_now.opened_at))
           < now() - make_interval(mins => (s.p->>'every_minutes')::int + 30)
    union all
    select 'inbound_silent', 'customer_line', jsonb_build_object('last', max(e.received_at), 'week', count(*), 'opened_at', max(open_now.opened_at))
      from s, open_now, wa_inbound_events e
     where open_now.is_open and e.line = 'customer' and e.event = 'whatsapp.message.received' and e.idempotency_key not like 'probe:%'
       and e.received_at > now() - interval '7 days'
     group by s.h having count(*) >= (s.h->>'inbound_min_week')::int
                    and greatest(max(e.received_at), max(open_now.opened_at)) < now() - make_interval(hours => (s.h->>'inbound_silence_hours')::int)
    union all
    select 'cron_gap', 'cron', jsonb_build_object('gap_minutes', round(extract(epoch from (b.at - (b.detail->>'previous')::timestamptz)) / 60))
      from heartbeats b, s
     where b.name = 'cron' and b.detail ? 'previous'
       and b.at - (b.detail->>'previous')::timestamptz > make_interval(mins => (s.h->>'cron_gap_minutes')::int))
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'ref', ref, 'detail', detail)), '[]'::jsonb) from a $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table catalog_picture_variants from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table catalog_picture_variants from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select, insert, delete on table catalog_picture_variants to service_role; end if;
end $$;
