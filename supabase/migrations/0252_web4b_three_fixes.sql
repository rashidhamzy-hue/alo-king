-- Alo King, session WEB4b, migration 0252 (the next free number; recorded in docs/STATUS.md, section 5). Three small fixes; the website's food
-- pages themselves need no migration (they call FD2's API, 0251): (1) the rider shifts, (2) brand words that are another item's kind word,
-- (3) a JPEG copy of each public picture for the WhatsApp catalogue's feed. docs/log/web4b.md says what each part fixes and how it was found.
--
-- NOTE ON ORDER: 0253 and 0255 to 0257 were merged before this number was used. On a database built from the files, 0252 runs before 0253;
-- on staging it runs after 0257 (deploy-staging pushes with --include-all). Everything below works in both orders: it reads nothing 0253
-- made, creates search_word_drops exactly as 0253 does (if not exists), and its trigger has its own name and function, which 0253 never
-- redefines.
--
--   1. The rider shifts, through the console's own audited door. settings.join.rider.shifts was 08:00 to 15:30 and 15:30 to 23:00 (UX3's
--      draft, 0233), outside the hours (09:00 to 21:00, 0255). The founder decided on 18 November: morning 09:00 to 15:00, evening 15:00
--      to 21:00. The Settings page could not change them (editable_settings named top-level fields only), so:
--        a. a field of editable_settings may now be a path ("rider.shifts.0.from"): setting_field and change_setting_now read and write it
--           with #> and jsonb_set. Every existing field is one word, so nothing about them changes;
--        b. the four shift edges are editable times (admin, one person), and a shift must start before it ends (change_setting_check);
--        c. the change itself goes through change_setting_now (the function the console's change_setting calls), so it is logged like any
--           console change: who, when, before, after and why, in config_changes, shown at the foot of the Settings page. "Who" is a party
--           made for it, "The founder's decision of 18 November (applied by migration 0252)", admin only for the length of this migration
--           and blocked afterwards: no account signs in as it, and a blocked party passes no role check.
--
--   2. Brand words that are another item's kind word. The search-words job (version auto-2026-11-16) wrote, on staging:
--        AK-0044 Halloum (brand Leentaanayel): «لبن ليت», «ليبن ليت», "Liban Lait", "liban lait": another company's name, misspelt in
--          Arabic; «لبن» (laban) found the halloum (B1f's "left for a later session").
--        AK-0143 Maestro Ceylon Tea: «ماي سترو» (Maestro split in two): «ماي» (water) found the tea.
--        AK-0088 Tannour El Asser bread: "tanour al asir": "asir" (juice) found the bread.
--        AK-0174 Indomie noodles: "indomie mee": "mee" (water, in Arabizi) found the noodles.
--      Found by brand_word_collisions() below, run on staging (read only) on 19 November: a brand word one of whose words is another item's
--      one-word kind word and is in neither the item's own names, its brand nor its own kind or exact words. It listed nine; the other two are
--      right and stay: "nes cafe" on Nescafe 3in1 ("cafe" is what it is) and "neskafeh" on Nescafe Gold (another Nescafe's kind word).
--      The seven are removed and the items' search documents rebuilt; search_term_refused holds them, and a trigger refuses them on every
--      later write (the job, a migration, a person), logging the refusal in search_word_drops, as B1f's owned words are.
--   3. The feed's JPEG copies: see part 3 below.
-- No price, stock, order or ledger row is touched (invariants 3, 7).

-- ---------- 1a: a field may be a path ----------
create or replace function setting_field(p_key text, p_field text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case when p_field = '' then value else value #> string_to_array(p_field, '.') end from settings where key = p_key
$$;

-- 0231's text; the write is by path (a one-word field is a path of one).
create or replace function change_setting_now(p_key text, p_field text, p_value jsonb, p_by uuid, p_reason text, p_second uuid default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v jsonb; v_before jsonb; v_second text;
begin
  perform require_role(p_by, array['admin']);
  v := change_setting_check(p_key, p_field, p_value);
  v_before := coalesce(setting_field(p_key, p_field), 'null'::jsonb);
  if v_before = v then return jsonb_build_object('ok', true, 'status', 'unchanged', 'value', v); end if;
  update settings set value = case when p_field = '' then v else jsonb_set(value, string_to_array(p_field, '.'), v, true) end, updated_by = p_by, updated_at = now() where key = p_key;
  select display_name into v_second from parties where id = p_second;
  insert into config_changes(kind, ref, before, after, reason, changed_by)
    values ('setting', null, jsonb_build_object('key', p_key, 'field', p_field, 'value', v_before),
            jsonb_build_object('key', p_key, 'field', p_field, 'value', v) || case when p_second is not null then jsonb_build_object('approved_by', p_second) else '{}'::jsonb end,
            btrim(p_reason) || case when p_second is not null then ' (approved by ' || coalesce(v_second, 'a second person') || ')' else '' end, p_by);
  return jsonb_build_object('ok', true, 'status', 'set', 'before', v_before, 'value', v);
end $$;

-- 0231's text, with one rule more: a rider shift starts before it ends.
create or replace function change_setting_check(p_key text, p_field text, p_value jsonb) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare e editable_settings%rowtype; v jsonb := p_value; n numeric; t text; v_soft numeric; v_hard numeric; m text[]; v_from text; v_to text;
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
  -- WEB4b: a rider shift starts before it ends (the other edge as it is now)
  m := regexp_match(p_field, '^rider\.shifts\.([0-9]+)\.(from|to)$');
  if p_key = 'join' and m is not null then
    v_from := case when m[2] = 'from' then v #>> '{}' else setting('join') #>> array['rider', 'shifts', m[1], 'from'] end;
    v_to   := case when m[2] = 'to'   then v #>> '{}' else setting('join') #>> array['rider', 'shifts', m[1], 'to'] end;
    if v_from is not null and v_to is not null and v_from >= v_to then
      raise exception 'SHIFT_ORDER: a shift must start (%) before it ends (%)', v_from, v_to;
    end if;
  end if;
  return v;
end $$;

-- ---------- 1b: the four shift edges are editable ----------
insert into editable_settings(key, field, kind, min_value, max_value, max_len, choices, two_person, two_person_when) values
  ('join', 'rider.shifts.0.from', 'time', null, null, null, null, false, null),
  ('join', 'rider.shifts.0.to',   'time', null, null, null, null, false, null),
  ('join', 'rider.shifts.1.from', 'time', null, null, null, null, false, null),
  ('join', 'rider.shifts.1.to',   'time', null, null, null, null, false, null)
on conflict (key, field) do nothing;

-- ---------- 1c: the founder's decision, through the console's door ----------
insert into parties(id, role, display_name, is_blocked, notes)
values ('00000000-0000-4000-8000-0000000000d1', 'admin', 'The founder''s decision of 18 November (applied by migration 0252)', false,
        'Session WEB4b. Recorded as the one who changed a setting a founder decision set, through change_setting_now. Admin only while 0252 runs; blocked after it, so it passes no role check and no account signs in as it.')
on conflict (id) do update set is_blocked = false;

do $$
declare by_ uuid := '00000000-0000-4000-8000-0000000000d1'; why text := 'match the 09:00–21:00 hours (founder decision 18 Nov)';
        j jsonb := setting('join');
begin
  -- the shifts are morning then evening (0233): the order of the array is what the paths name
  if j #>> '{rider,shifts,0,id}' = 'morning' and j #>> '{rider,shifts,1,id}' = 'evening' then
    -- the evening's end first, then the morning's: each step keeps start before end
    perform change_setting_now('join', 'rider.shifts.1.to',   '"21:00"', by_, why);
    perform change_setting_now('join', 'rider.shifts.0.from', '"09:00"', by_, why);
    perform change_setting_now('join', 'rider.shifts.0.to',   '"15:00"', by_, why);
    perform change_setting_now('join', 'rider.shifts.1.from', '"15:00"', by_, why);
  else
    raise notice 'WEB4b: settings.join.rider.shifts is not morning then evening; the shifts were left for the Settings page';
  end if;
end $$;

update parties set is_blocked = true where id = '00000000-0000-4000-8000-0000000000d1';

-- ---------- 2: brand words that are another item's kind word ----------
create table if not exists search_word_drops (
  id         bigint generated always as identity primary key,
  sku        text not null,
  term       text not null,
  level      text not null,
  reason     text not null,
  dropped_at timestamptz not null default now()
);

create table if not exists search_term_refused (
  sku      text not null,
  term_key text not null,              -- the term's tokens (catalog_tokens), joined by one space: case and marks do not matter
  note     text,
  primary key (sku, term_key)
);
alter table search_term_refused enable row level security;
alter table search_word_drops enable row level security;

insert into search_term_refused(sku, term_key, note)
select x.sku, array_to_string(catalog_tokens(x.term), ' '), x.note from (values
  ('AK-0044', 'لبن ليت',        'WEB4b: Liban Lait is not this item''s brand (Leentaanayel); «لبن» found the halloum'),
  ('AK-0044', 'ليبن ليت',       'WEB4b: Liban Lait is not this item''s brand (Leentaanayel)'),
  ('AK-0044', 'liban lait',     'WEB4b: Liban Lait is not this item''s brand (Leentaanayel); "lait" found the halloum'),
  ('AK-0143', 'ماي سترو',       'WEB4b: Maestro split in two; «ماي» (water) found the tea. «مايسترو» stays'),
  ('AK-0088', 'tanour al asir', 'WEB4b: "asir" (juice) found the bread; the brand is Tannour El Asser'),
  ('AK-0174', 'indomie mee',    'WEB4b: "mee" (water) found the noodles; the brand is Indomie')
) as x(sku, term, note)
on conflict (sku, term_key) do nothing;

create or replace function search_term_is_refused(p_sku text, p_term text) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from search_term_refused r where r.sku = p_sku and r.term_key = array_to_string(catalog_tokens(p_term), ' '))
$$;

create or replace function language_pack_refused_check() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not search_term_is_refused(new.sku, new.term) then return new; end if;
  insert into search_word_drops(sku, term, level, reason) values (new.sku, new.term, new.level, 'refused_term');
  return null;                                     -- not written: «لبن ليت» is never Halloum's brand again
end $$;
drop trigger if exists language_pack_refused_check on language_pack;
create trigger language_pack_refused_check before insert or update of term on language_pack for each row execute function language_pack_refused_check();

-- The ones already written (staging), logged, then the items' search documents.
with gone as (
  delete from language_pack lp where search_term_is_refused(lp.sku, lp.term) returning lp.sku, lp.term, lp.level
), logged as (
  insert into search_word_drops(sku, term, level, reason) select sku, term, level, 'refused_term (0252 cleanup)' from gone returning sku
)
select count(*) from (select refresh_search_documents(p.id) from products p where p.sku in (select distinct sku from logged)) x;

-- The check that found them, for the search-words review: every brand word one of whose words is another item's one-word kind word, and
-- is in neither the item's own names, its brand, nor its own kind or exact words. A row here is a question for a person, not a fault by
-- itself ("nes cafe" on a Nescafe is right).
create or replace function brand_word_collisions() returns table(sku text, term text, word text, kind_of text[]) language sql stable set search_path = public, pg_temp as $$
  with k as (select t as tok, array_agg(distinct lp.sku order by lp.sku) skus from language_pack lp, unnest(lp.forms) t
              where lp.level = 'kind' and array_length(lp.tokens, 1) = 1 group by t),
       own as (select p.sku, catalog_term_forms(concat_ws(' ', p.name_en, p.name_ar, p.brand))
                      || coalesce((select array_agg(distinct f) from language_pack l2, unnest(l2.forms) f where l2.sku = p.sku and l2.level in ('kind', 'exact')), '{}') nf
                 from products p)
  select b.sku, b.term, t, k.skus
    from language_pack b join own o on o.sku = b.sku, unnest(b.forms) t join k on k.tok = t
   where b.level = 'brand' and not (t = any(o.nf)) and not (b.sku = any(k.skus))
   order by b.sku, b.term, t
$$;

-- ---------- 4: the website's menu read gives a section's name in both languages ----------
-- FD1 keeps one section name on a dish (products.sub_type: the English one, or the Arabic when the menu printed no English). The menu
-- page shows sections in the page's language, so web_food_menu (0251's text) adds each dish's section as the approved proposal printed it
-- (menu_dish_proposals.section_ar / section_en). Nothing else changes: the same dishes, prices, choices and facts, for the same visitors.
create or replace function web_food_menu(p_token text, p_place uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m jsonb := place_menu(web_food_party(p_token), p_place);
begin
  if not coalesce((m->>'ok')::boolean, false) then return m; end if;
  return m || jsonb_build_object('dishes', (select coalesce(jsonb_agg(d || jsonb_build_object('facts', dish_facts_status((d->>'product_id')::uuid))
                                                                         || coalesce((select jsonb_build_object('section_ar', mp.section_ar, 'section_en', mp.section_en)
                                                                                        from menu_dish_proposals mp
                                                                                       where mp.product_id = (d->>'product_id')::uuid and mp.status = 'approved'
                                                                                       order by mp.reviewed_at desc limit 1), '{}'::jsonb)
                                                         order by ord), '[]'::jsonb)
                                              from jsonb_array_elements(m->'dishes') with ordinality x(d, ord)));
end $$;

-- ---------- 3: a JPEG copy of each picture for the WhatsApp catalogue's feed ----------
-- Meta documents JPEG and PNG for a catalogue picture; the founder's pictures (PIX4) are WebP, and the public copy the website shows stays
-- as stored (0115). So each picture that is public (catalog_public_expected: approved, a licence a customer may see, an active item) also
-- gets one JPEG copy for the feed: 1000 x 1000, white around it, under 150 KB, made ONCE by the catalog-jpegs workflow
-- (scripts/images/feed-jpegs.mjs, sharp: a Worker on the free plan has 10 ms of CPU, too little to decode and encode a picture) and kept
-- in the same public `catalog` bucket at <sku>-<image id>.feed.jpg. The books follow 0115's rule exactly:
--   catalog_feed_jpeg_work()     what to make (public and not made yet) and what to remove (made and no longer public)
--   catalog_feed_jpeg_made()     the copy is in the bucket (its size, at most 150,000 bytes); from now the feed gives its address
--   catalog_feed_jpeg_removed()  the copy is gone
-- The feed's image_link is the JPEG's address, and only while the picture is approved (the feed's own join): a rejected or withdrawn
-- picture leaves the feed the moment the database learns of it, and its JPEG leaves the bucket on the Worker's next minute (it removes,
-- which costs no CPU) or the workflow's next run. A new approved picture has a new image id, so a new address. The hourly pass treats a
-- JPEG the books know as known (strays) and forgets one whose object has gone (forget), so it is made again.

create table if not exists catalog_feed_jpegs (
  image_id    uuid primary key,                 -- product_images.id. No foreign key, as catalog_public_pictures: it outlives a deleted image until removed
  product_id  uuid not null,
  public_path text not null unique,
  bytes       int not null check (bytes > 0 and bytes <= 150000),
  made_at     timestamptz not null default now()
);
alter table catalog_feed_jpegs enable row level security;

create or replace function catalog_feed_jpeg_path(p_sku text, p_image uuid) returns text language sql immutable set search_path = public, pg_temp as $$
  select p_sku || '-' || p_image::text || '.feed.jpg' $$;

create or replace function catalog_feed_jpeg_work() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'make', coalesce((select jsonb_agg(jsonb_build_object('image_id', e.image_id, 'media_path', e.media_path, 'public_path', catalog_feed_jpeg_path(e.sku, e.image_id)) order by e.sku)
                        from catalog_public_expected() e
                       where not exists (select 1 from catalog_feed_jpegs j where j.image_id = e.image_id)), '[]'::jsonb),
    'remove', coalesce((select jsonb_agg(jsonb_build_object('image_id', j.image_id, 'public_path', j.public_path) order by j.made_at)
                          from catalog_feed_jpegs j
                         where not exists (select 1 from catalog_public_expected() e where e.image_id = j.image_id)), '[]'::jsonb)) $$;

-- Recorded even when the picture was withdrawn while it was being made: the next work list then removes it (as catalog_picture_copied).
create or replace function catalog_feed_jpeg_made(p_image uuid, p_bytes int) returns text language plpgsql set search_path = public, pg_temp as $$
declare v_path text;
begin
  if p_bytes is null or p_bytes <= 0 or p_bytes > 150000 then raise exception 'JPEG_TOO_BIG: % bytes (at most 150000)', p_bytes; end if;
  select catalog_feed_jpeg_path(p.sku, i.id) into v_path from product_images i join products p on p.id = i.product_id where i.id = p_image;
  if v_path is null then raise exception 'IMAGE_NOT_FOUND %', p_image; end if;
  insert into catalog_feed_jpegs(image_id, product_id, public_path, bytes)
    select i.id, i.product_id, v_path, p_bytes from product_images i where i.id = p_image
  on conflict (image_id) do nothing;
  return v_path;
end $$;

create or replace function catalog_feed_jpeg_removed(p_image uuid) returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  delete from catalog_feed_jpegs where image_id = p_image;
  return found;
end $$;

-- 0115's text: a feed JPEG the books know is not a stray.
create or replace function catalog_picture_strays(p_listed text[]) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(coalesce(p_listed, '{}'::text[])) x
   where not exists (select 1 from catalog_public_pictures c where c.public_path = x)
     and not exists (select 1 from catalog_feed_jpegs j where j.public_path = x) $$;

-- 0115's text, and the same for the feed JPEGs: a book entry whose object is gone is forgotten, so it is made again.
create or replace function catalog_picture_forget(p_listed text[]) returns int language plpgsql set search_path = public, pg_temp as $$
declare n int; m int;
begin
  delete from catalog_public_pictures c
   where c.copied_at < now() - interval '10 minutes' and not (c.public_path = any (coalesce(p_listed, '{}'::text[])));
  get diagnostics n = row_count;
  delete from catalog_feed_jpegs j
   where j.made_at < now() - interval '10 minutes' and not (j.public_path = any (coalesce(p_listed, '{}'::text[])));
  get diagnostics m = row_count;
  return n + m;
end $$;

-- 0115's numbers, with the feed JPEGs.
create or replace function catalog_public_report() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'expected', (select count(*) from catalog_public_expected()),
    'recorded', (select count(*) from catalog_public_pictures),
    'to_copy', jsonb_array_length(catalog_picture_work()->'copy'),
    'to_remove', jsonb_array_length(catalog_picture_work()->'remove'),
    'recorded_not_expected', (select count(*) from catalog_public_pictures c where not exists (select 1 from catalog_public_expected() e where e.image_id = c.image_id)),
    'feed_jpegs', (select count(*) from catalog_feed_jpegs),
    'feed_jpegs_to_make', jsonb_array_length(catalog_feed_jpeg_work()->'make'),
    'feed_jpegs_to_remove', jsonb_array_length(catalog_feed_jpeg_work()->'remove')) $$;

-- 0226's text (the latest), plus `feed_jpeg_path`: set only for a picture that is currently approved (the join) and whose JPEG is made.
create or replace function catalog_feed() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
           'brand', coalesce(nullif(p.brand, ''), 'Alo King'),
           'price_usd', o.price_usd, 'in_stock', coalesce(l.on_hand - l.reserved, 0) > 0 and product_orderable(p.id),
           'media_path', i.media_path, 'public_path', cp.public_path, 'feed_jpeg_path', fj.public_path, 'attribution', i.attribution, 'licence', i.licence,
           'category_code', c.code, 'category_en', c.name_en, 'category_ar', c.name_ar,
           'subgroup_en', sg.name_en, 'subgroup_ar', sg.name_ar)
         order by c.sort_order, pl.sort_in_category), '[]'::jsonb)
    from catalog_placements pl
    join catalog_categories c on c.code = pl.category_code and c.is_active
    left join catalog_subgroups sg on sg.category_code = pl.category_code and sg.code = pl.subgroup_code
    join products p on p.sku = pl.sku and p.is_active
    join lateral (select ofr.price_usd, ofr.source_id from offers ofr join sources s on s.id = ofr.source_id
                   where ofr.product_id = p.id and s.kind = 'dark_store' order by ofr.price_usd limit 1) o on true
    left join stock_levels l on l.product_id = p.id and l.source_id = o.source_id
    join product_images i on i.product_id = p.id and i.status = 'approved' and product_image_licence_usable(i.licence)
    left join catalog_public_pictures cp on cp.image_id = i.id
    left join catalog_feed_jpegs fj on fj.image_id = i.id $$;

select pin_search_paths();

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table catalog_feed_jpegs from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table catalog_feed_jpegs from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select, insert, delete on table catalog_feed_jpegs to service_role; end if;
end $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table search_term_refused from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table search_term_refused from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on table search_term_refused to service_role; end if;
end $$;
