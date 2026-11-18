-- Alo King Chouf, session FD1, migration 0246: menus from photos. docs/DECISIONS.md, "FD1, 18 November 2026".
--
--   1 photos     menu_photos: staff photograph a place's menu on the console's Menus page (shrunk on the phone, as LB1's capture page does), each
--                stored in the private media bucket under menus/<place>/<day>/<hash>.jpg and recorded once (record_menu_photo).
--   2 reading    one reading run (the menu-read workflow: MODEL_FAST through the Message Batches API, capped at USD 2, recorded in model_costs)
--                reads each waiting photo into sections and dishes: names in Arabic and English, the price in USD or LBP as printed, sizes,
--                options and add-ons with their prices (record_menu_reading). Each dish is a PROPOSAL (menu_dish_proposals): a model approves
--                nothing (invariant 3). A reading is never a food fact: nothing about allergens, diet or health is kept from it (invariant 15).
--                A failed reading leaves the photo waiting for the next run.
--   3 a person   review_menu_dish: an ops lead or an admin approves (names and price may be corrected first) or rejects (with a reason) each dish.
--                Approving makes the dish: a product the place owns, its offer, the sizes, options and add-ons as option groups (0205's tables).
--                A dish name with a praise or health word is refused until a person changes it (invariant 14).
--   4 prices     the price as printed. An LBP price is converted at today's rate (current_fx) when the dish is approved, and again each time a
--                new rate is recorded (a trigger on fx_rates), so an LBP menu follows the day's rate; a USD price never moves. The printed
--                figures stay on the proposal and on each option (dish_options.printed_price, printed_currency).
--   5 the stamp  stamp_menu_checked: "menu checked on <date>" per place, refused while a photo is unread or a dish waits. approve_merchant (0247)
--                needs it for a place.
--   6 facts      dish_facts_status: for each of the 20 attributes, "declared by the vendor" (0205's declarations, with the date) or "not confirmed
--                yet". Nothing else: never a health claim, never a model's guess.
-- Nothing here opens a place (invariant 11) or writes an order, a payment, stock or the ledger.

-- ---------- 1 ----------
create table if not exists menu_photos (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references sources(id),
  media_path   text not null unique check (media_path ~ '^menus/[A-Za-z0-9_\-./]+$' and media_path !~ '\.\.'),
  uploaded_by  uuid not null references parties(id),
  uploaded_at  timestamptz not null default now(),
  read_status  text not null default 'waiting' check (read_status in ('waiting', 'read')),
  read_at      timestamptz,
  read_model   text,
  failures     int not null default 0,
  last_failure text
);
create index if not exists menu_photos_waiting on menu_photos(uploaded_at) where read_status = 'waiting';
create index if not exists menu_photos_source on menu_photos(source_id, uploaded_at);

alter table sources add column if not exists menu_checked_on date;
alter table sources add column if not exists menu_checked_by uuid references parties(id);

-- The party the reading run records as the proposer (as LB1's label reader, 0211): a picker, so it can approve nothing and cannot sign in.
insert into parties(id, role, display_name, is_blocked, notes)
values ('00000000-0000-4000-8000-0000000000b2', 'picker', 'Menu reading run (a model reads the photos; a person approves)', false,
        'Session FD1. Recorded as the proposer of the menu-read workflow''s readings. No account can sign in as it.')
on conflict (id) do nothing;
create or replace function menu_reader_party() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000b2'::uuid $$;

create or replace function record_menu_photo(p_source uuid, p_media_path text, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_source and buys_for_customer) then raise exception 'NOT_A_PLACE'; end if;
  if p_media_path is null or p_media_path !~ ('^menus/' || p_source::text || '/[A-Za-z0-9_\-./]+$') or p_media_path ~ '\.\.' then
    raise exception 'MENU_PATH: a menu photo lives under menus/<place>/';
  end if;
  select id into v_id from menu_photos where media_path = p_media_path;
  if found then return jsonb_build_object('ok', true, 'photo_id', v_id, 'already', true); end if;
  insert into menu_photos(source_id, media_path, uploaded_by) values (p_source, p_media_path, p_by) returning id into v_id;
  insert into place_log(source_id, action, by_party, detail) values (p_source, 'photo', p_by, jsonb_build_object('photo_id', v_id));
  return jsonb_build_object('ok', true, 'photo_id', v_id, 'already', false);
end $$;

-- ---------- 2 ----------
create table if not exists menu_dish_proposals (
  id           uuid primary key default gen_random_uuid(),
  position     bigint generated always as identity,
  source_id    uuid not null references sources(id),
  photo_id     uuid not null references menu_photos(id),
  section_ar   text,
  section_en   text,
  name_ar      text,
  name_en      text,
  translated   text check (translated in ('ar', 'en')),            -- the name in this language was not printed: the reader gave it
  price        numeric check (price > 0),
  currency     text check (currency in ('USD', 'LBP')),
  price_text   text,                                               -- the price as printed, for the person checking
  sizes        jsonb not null default '[]',                        -- [{name_ar, name_en, price, currency}]
  options      jsonb not null default '[]',                        -- [{group_ar, group_en, required, min, max, choices: [{name_ar, name_en, price_delta}]}]
  addons       jsonb not null default '[]',                        -- [{name_ar, name_en, price, currency}]
  read_model   text,
  status       text not null default 'waiting' check (status in ('waiting', 'approved', 'rejected')),
  reviewed_by  uuid references parties(id),
  reviewed_at  timestamptz,
  review_note  text,
  product_id   uuid references products(id),
  created_at   timestamptz not null default now(),
  check (coalesce(btrim(name_ar), '') <> '' or coalesce(btrim(name_en), '') <> ''),
  check ((status = 'approved') = (product_id is not null)),
  check ((status = 'waiting') = (reviewed_at is null))
);
create index if not exists menu_dish_proposals_waiting on menu_dish_proposals(source_id, position) where status = 'waiting';
create index if not exists menu_dish_proposals_product on menu_dish_proposals(product_id) where product_id is not null;

alter table dish_options add column if not exists printed_price numeric;
alter table dish_options add column if not exists printed_currency text check (printed_currency in ('USD', 'LBP'));

create or replace function menu_reading_queue(p_limit int default 200) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('photo_id', x.id, 'source_id', x.source_id, 'place', x.name, 'media_path', x.media_path) order by x.uploaded_at, x.id), '[]'::jsonb)
    from (select m.id, m.source_id, s.name, m.media_path, m.uploaded_at from menu_photos m join sources s on s.id = m.source_id
           where m.read_status = 'waiting' order by m.uploaded_at, m.id limit greatest(coalesce(p_limit, 200), 0)) x $$;

-- A text of at most n characters, or null.
create or replace function menu_text(p jsonb, n int default 120) returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(left(btrim(coalesce(case when jsonb_typeof(p) = 'string' then p #>> '{}' end, '')), n), '') $$;
create or replace function menu_price(p jsonb) returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric > 0 and (p #>> '{}')::numeric < 1e12
              then case when round((p #>> '{}')::numeric, 2) = (p #>> '{}')::numeric then (p #>> '{}')::numeric else round((p #>> '{}')::numeric, 2) end end $$;
create or replace function menu_currency(p jsonb) returns text language sql immutable set search_path = public, pg_temp as $$
  select case when upper(coalesce(p #>> '{}', '')) in ('USD', 'LBP') then upper(p #>> '{}') end $$;

-- What the run read for one photo (the form of apps/console/src/menu-read.ts). Only names, sections, prices, sizes, options and add-ons are
-- kept; any other key (an allergen, a claim, a description) is ignored. p_reading null: the reading failed; the photo stays waiting.
create or replace function record_menu_reading(p_photo uuid, p_reading jsonb, p_model text, p_by uuid, p_reason text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare m menu_photos%rowtype; sec jsonb; d jsonb; n int := 0; v_sizes jsonb; v_opts jsonb; v_add jsonb;
begin
  if p_by is distinct from menu_reader_party() and not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into m from menu_photos where id = p_photo for update;
  if not found then raise exception 'PHOTO_NOT_FOUND'; end if;
  if m.read_status = 'read' then return jsonb_build_object('ok', true, 'already', true, 'dishes', 0); end if;
  if p_reading is null or jsonb_typeof(p_reading->'sections') is distinct from 'array' then
    update menu_photos set failures = failures + 1, last_failure = left(coalesce(p_reason, 'no reading'), 200) where id = p_photo;
    insert into place_log(source_id, action, by_party, detail) values (m.source_id, 'reading_failed', p_by, jsonb_build_object('photo_id', p_photo, 'reason', left(coalesce(p_reason, 'no reading'), 200)));
    return jsonb_build_object('ok', false, 'dishes', 0);
  end if;
  for sec in select * from jsonb_array_elements(p_reading->'sections') loop
    for d in select * from jsonb_array_elements(case when jsonb_typeof(sec->'dishes') = 'array' then sec->'dishes' else '[]'::jsonb end) loop
      continue when menu_text(d->'name_ar') is null and menu_text(d->'name_en') is null;
      select coalesce(jsonb_agg(jsonb_build_object('name_ar', menu_text(x->'name_ar'), 'name_en', menu_text(x->'name_en'), 'price', menu_price(x->'price'),
               'currency', coalesce(menu_currency(x->'currency'), menu_currency(d->'currency')))), '[]'::jsonb)
        into v_sizes from jsonb_array_elements(case when jsonb_typeof(d->'sizes') = 'array' then d->'sizes' else '[]'::jsonb end) x
       where menu_text(x->'name_ar') is not null or menu_text(x->'name_en') is not null;
      select coalesce(jsonb_agg(jsonb_build_object('group_ar', menu_text(g->'group_ar'), 'group_en', menu_text(g->'group_en'),
               'required', coalesce((g->>'required')::boolean, false), 'min', greatest(coalesce((g->>'min')::int, 0), 0), 'max', greatest(coalesce((g->>'max')::int, 1), 1),
               'choices', coalesce((select jsonb_agg(jsonb_build_object('name_ar', menu_text(c->'name_ar'), 'name_en', menu_text(c->'name_en'),
                                                                    'price_delta', coalesce(menu_price(c->'price_delta'), 0)))
                                      from jsonb_array_elements(case when jsonb_typeof(g->'choices') = 'array' then g->'choices' else '[]'::jsonb end) c
                                     where menu_text(c->'name_ar') is not null or menu_text(c->'name_en') is not null), '[]'::jsonb))), '[]'::jsonb)
        into v_opts from jsonb_array_elements(case when jsonb_typeof(d->'options') = 'array' then d->'options' else '[]'::jsonb end) g
       where menu_text(g->'group_ar') is not null or menu_text(g->'group_en') is not null;
      select coalesce(jsonb_agg(jsonb_build_object('name_ar', menu_text(x->'name_ar'), 'name_en', menu_text(x->'name_en'), 'price', menu_price(x->'price'),
               'currency', coalesce(menu_currency(x->'currency'), menu_currency(d->'currency')))), '[]'::jsonb)
        into v_add from jsonb_array_elements(case when jsonb_typeof(d->'addons') = 'array' then d->'addons' else '[]'::jsonb end) x
       where menu_text(x->'name_ar') is not null or menu_text(x->'name_en') is not null;
      insert into menu_dish_proposals(source_id, photo_id, section_ar, section_en, name_ar, name_en, translated, price, currency, price_text, sizes, options, addons, read_model)
        values (m.source_id, p_photo, menu_text(sec->'name_ar'), menu_text(sec->'name_en'), menu_text(d->'name_ar'), menu_text(d->'name_en'),
                case when d->>'translated' in ('ar', 'en') then d->>'translated' end, menu_price(d->'price'),
                case when menu_price(d->'price') is not null then menu_currency(d->'currency') end, menu_text(d->'price_text', 60), v_sizes, v_opts, v_add, left(p_model, 80));
      n := n + 1;
    end loop;
  end loop;
  update menu_photos set read_status = 'read', read_at = now(), read_model = left(p_model, 80) where id = p_photo;
  insert into place_log(source_id, action, by_party, detail) values (m.source_id, 'reading', p_by, jsonb_build_object('photo_id', p_photo, 'dishes', n));
  return jsonb_build_object('ok', true, 'dishes', n);
end $$;

-- ---------- 4 ----------
create or replace function menu_usd(p_price numeric, p_currency text) returns numeric language plpgsql stable set search_path = public, pg_temp as $$
declare v_fx numeric;
begin
  if p_price is null then return null; end if;
  if p_currency = 'USD' then return round(p_price, 2); end if;
  v_fx := current_fx();
  if v_fx is null or v_fx <= 0 then raise exception 'NO_FX_RATE: record today''s rate before approving a lira price'; end if;
  return round(p_price / v_fx, 2);
end $$;

-- Every approved LBP dish and option at today's rate. Called on each new rate.
create or replace function refresh_place_lbp_prices() returns int language plpgsql set search_path = public, pg_temp as $$
declare n int := 0; k int; v_fx numeric := current_fx();
begin
  if v_fx is null or v_fx <= 0 then return 0; end if;
  update offers o set price_usd = round(d.base / v_fx, 2)
    from (select p.product_id, p.source_id, coalesce(p.price, (select min((s->>'price')::numeric) from jsonb_array_elements(p.sizes) s where s->>'price' is not null)) as base
            from menu_dish_proposals p where p.status = 'approved' and p.currency = 'LBP') d
   where o.product_id = d.product_id and o.source_id = d.source_id and d.base is not null and o.price_usd is distinct from round(d.base / v_fx, 2);
  get diagnostics n = row_count;
  update dish_options set price_delta_usd = round(printed_price / v_fx, 2) where printed_currency = 'LBP' and printed_price is not null
     and price_delta_usd is distinct from round(printed_price / v_fx, 2);
  get diagnostics k = row_count;
  return n + k;
end $$;

create or replace function fx_rates_refresh_places() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin perform refresh_place_lbp_prices(); return null; end $$;
drop trigger if exists fx_rates_places on fx_rates;
create trigger fx_rates_places after insert on fx_rates for each statement execute function fx_rates_refresh_places();

-- ---------- 3 ----------
create or replace function menu_name_claim(p text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p, '') ~* '\m(best|tasty|delicious|healthy|healthier|amazing|perfect|famous|guilt[- ]?free|superfood|number one)\M|أطيب|أحسن|ألذ|لذيذ|صحي' $$;

-- p_edit may correct name_ar, name_en, section_ar, section_en, price, currency before approving. A rejection needs a reason.
create or replace function review_menu_dish(p_dish uuid, p_by uuid, p_approve boolean, p_edit jsonb default '{}', p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare d menu_dish_proposals%rowtype; v_ar text; v_en text; v_sec_ar text; v_sec_en text; v_price numeric; v_cur text; v_base numeric; v_usd numeric;
        v_prod uuid; v_group uuid; x jsonb; c jsonb; i int; g int := 0; v_e jsonb := coalesce(p_edit, '{}'::jsonb);
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into d from menu_dish_proposals where id = p_dish for update;
  if not found then raise exception 'DISH_NOT_FOUND'; end if;
  if d.status <> 'waiting' then raise exception 'DISH_ALREADY_REVIEWED'; end if;
  if not coalesce(p_approve, false) then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'REASON_REQUIRED: say why (at least 3 characters)'; end if;
    update menu_dish_proposals set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = left(btrim(p_note), 500) where id = p_dish;
    insert into place_log(source_id, action, by_party, detail) values (d.source_id, 'dish_reject', p_by, jsonb_build_object('dish', p_dish, 'reason', left(btrim(p_note), 500)));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  v_ar := case when v_e ? 'name_ar' then menu_text(v_e->'name_ar') else d.name_ar end;
  v_en := case when v_e ? 'name_en' then menu_text(v_e->'name_en') else d.name_en end;
  v_sec_ar := case when v_e ? 'section_ar' then menu_text(v_e->'section_ar') else d.section_ar end;
  v_sec_en := case when v_e ? 'section_en' then menu_text(v_e->'section_en') else d.section_en end;
  if v_ar is null and v_en is null then raise exception 'NAME_REQUIRED'; end if;
  if menu_name_claim(v_ar) or menu_name_claim(v_en) then raise exception 'DISH_NAME_CLAIM: a dish name says what it is, never how good or healthy it is; change the name first'; end if;
  v_price := case when v_e ? 'price' then nullif(v_e->>'price', '')::numeric else d.price end;
  v_cur := coalesce(case when v_e ? 'currency' then menu_currency(v_e->'currency') end, d.currency,
                    (select s->>'currency' from jsonb_array_elements(d.sizes) s where s->>'currency' is not null limit 1));
  v_base := coalesce(v_price, (select min((s->>'price')::numeric) from jsonb_array_elements(d.sizes) s where s->>'price' is not null));
  if v_base is null or v_base <= 0 or v_cur is null then raise exception 'PRICE_REQUIRED: type the price as printed, and whether it is USD or LBP'; end if;
  v_usd := menu_usd(v_base, v_cur);
  -- the same dish read again (same place, same names): its price and options are replaced, the product is kept
  select p.id into v_prod from products p where p.owner_source_id = d.source_id
     and fold_text(coalesce(p.name_ar, '') || ' ' || p.name_en) = fold_text(coalesce(v_ar, '') || ' ' || coalesce(v_en, v_ar)) limit 1;
  if v_prod is null then
    insert into products(sku, owner_source_id, name_en, name_ar, category, sub_type, storage, sell_unit)
      values ('D-' || left(d.source_id::text, 8) || '-' || substr(md5(d.id::text), 1, 8), d.source_id, coalesce(v_en, v_ar), v_ar, 'Restaurant',
              coalesce(v_sec_en, v_sec_ar), 'ambient', 'piece')
      returning id into v_prod;
  else
    update products set sub_type = coalesce(v_sec_en, v_sec_ar, sub_type), is_active = true where id = v_prod;
    delete from dish_option_groups where product_id = v_prod;
  end if;
  insert into offers(source_id, product_id, price_usd, is_available) values (d.source_id, v_prod, v_usd, true)
    on conflict (source_id, product_id) do update set price_usd = excluded.price_usd, is_available = true;
  if v_ar is not null then insert into product_aliases(product_id, alias, lang) values (v_prod, v_ar, 'ar') on conflict do nothing; end if;
  -- sizes: one required choice, each priced against the smallest
  if jsonb_array_length(d.sizes) > 0 then
    g := g + 1;
    insert into dish_option_groups(product_id, name_en, name_ar, required, min_choices, max_choices, sort_order) values (v_prod, 'Size', 'الحجم', true, 1, 1, g) returning id into v_group;
    i := 0;
    for x in select * from jsonb_array_elements(d.sizes) loop
      i := i + 1;
      insert into dish_options(group_id, name_en, name_ar, price_delta_usd, sort_order, printed_price, printed_currency)
        values (v_group, coalesce(x->>'name_en', x->>'name_ar'), x->>'name_ar', greatest(menu_usd(coalesce((x->>'price')::numeric, v_base) - v_base, v_cur), 0), i,
                greatest(coalesce((x->>'price')::numeric, v_base) - v_base, 0), v_cur);
    end loop;
  end if;
  for x in select * from jsonb_array_elements(d.options) loop
    continue when jsonb_array_length(coalesce(x->'choices', '[]'::jsonb)) = 0;
    g := g + 1;
    insert into dish_option_groups(product_id, name_en, name_ar, required, min_choices, max_choices, sort_order)
      values (v_prod, coalesce(x->>'group_en', x->>'group_ar'), x->>'group_ar', coalesce((x->>'required')::boolean, false),
              case when coalesce((x->>'required')::boolean, false) then greatest(coalesce((x->>'min')::int, 1), 1) else least(coalesce((x->>'min')::int, 0), greatest(coalesce((x->>'max')::int, 1), 1)) end,
              greatest(coalesce((x->>'max')::int, 1), case when coalesce((x->>'required')::boolean, false) then greatest(coalesce((x->>'min')::int, 1), 1) else 1 end), g)
      returning id into v_group;
    i := 0;
    for c in select * from jsonb_array_elements(x->'choices') loop
      i := i + 1;
      insert into dish_options(group_id, name_en, name_ar, price_delta_usd, sort_order, printed_price, printed_currency)
        values (v_group, coalesce(c->>'name_en', c->>'name_ar'), c->>'name_ar', menu_usd(coalesce((c->>'price_delta')::numeric, 0), v_cur), i,
                coalesce((c->>'price_delta')::numeric, 0), v_cur);
    end loop;
  end loop;
  if jsonb_array_length(d.addons) > 0 then
    g := g + 1;
    insert into dish_option_groups(product_id, name_en, name_ar, required, min_choices, max_choices, sort_order)
      values (v_prod, 'Add-ons', 'إضافات', false, 0, jsonb_array_length(d.addons), g) returning id into v_group;
    i := 0;
    for x in select * from jsonb_array_elements(d.addons) loop
      i := i + 1;
      insert into dish_options(group_id, name_en, name_ar, price_delta_usd, sort_order, printed_price, printed_currency)
        values (v_group, coalesce(x->>'name_en', x->>'name_ar'), x->>'name_ar', menu_usd(coalesce((x->>'price')::numeric, 0), coalesce(x->>'currency', v_cur)), i,
                coalesce((x->>'price')::numeric, 0), coalesce(x->>'currency', v_cur));
    end loop;
  end if;
  update menu_dish_proposals set status = 'approved', reviewed_by = p_by, reviewed_at = now(), product_id = v_prod,
         name_ar = v_ar, name_en = v_en, section_ar = v_sec_ar, section_en = v_sec_en, price = coalesce(v_price, price), currency = v_cur,
         review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_dish;
  insert into place_log(source_id, action, by_party, detail) values (d.source_id, 'dish_approve', p_by, jsonb_build_object('dish', p_dish, 'product_id', v_prod, 'edited', v_e <> '{}'::jsonb));
  return jsonb_build_object('ok', true, 'status', 'approved', 'product_id', v_prod, 'price_usd', v_usd);
end $$;

-- ---------- 5 ----------
create or replace function stamp_menu_checked(p_source uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_day date := (now() at time zone 'Asia/Beirut')::date;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_source and buys_for_customer) then raise exception 'NOT_A_PLACE'; end if;
  if exists (select 1 from menu_photos where source_id = p_source and read_status = 'waiting') then raise exception 'MENU_PHOTOS_UNREAD: a photo waits for the reading run'; end if;
  if exists (select 1 from menu_dish_proposals where source_id = p_source and status = 'waiting') then raise exception 'MENU_DISHES_WAITING: approve or reject every dish first'; end if;
  if not exists (select 1 from offers where source_id = p_source and is_available and price_usd > 0) then raise exception 'NO_APPROVED_MENU: approve at least one dish first'; end if;
  update sources set menu_checked_on = v_day, menu_checked_by = p_by where id = p_source;
  insert into place_log(source_id, action, by_party, detail) values (p_source, 'menu_checked', p_by, jsonb_build_object('on', v_day));
  return jsonb_build_object('ok', true, 'menu_checked_on', v_day::text);
end $$;

-- ---------- 6 ----------
create or replace function dish_facts_status(p_dish uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('attribute', a.code,
           'status', case when d.id is null then 'not_confirmed' else 'declared_by_vendor' end, 'value', d.value, 'declared_at', d.declared_at) order by a.n), '[]'::jsonb)
    from (select code, row_number() over (order by code) as n from food_attributes where kind = 'allergen'
          union all select x, 100 + o from unnest(array['halal', 'vegetarian', 'vegan', 'fasting', 'contains_sugar', 'spicy']) with ordinality u(x, o)) a
    left join dish_declarations d on d.product_id = p_dish and d.attribute = a.code and d.superseded_at is null $$;

-- ---------- the console's Menus page ----------
create or replace function menu_console(p_source uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'place', (select jsonb_build_object('source_id', s.id, 'name', s.name, 'visibility', s.visibility, 'approved', s.approved_at is not null,
                                        'menu_checked_on', s.menu_checked_on, 'menu_checked_by', (select display_name from parties where id = s.menu_checked_by))
                from sources s where s.id = p_source and s.buys_for_customer),
    'fx', current_fx(),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('photo_id', m.id, 'media_path', m.media_path, 'uploaded_at', m.uploaded_at, 'read_status', m.read_status,
                                                            'read_at', m.read_at, 'failures', m.failures, 'last_failure', m.last_failure,
                                                            'dishes', (select count(*) from menu_dish_proposals p where p.photo_id = m.id)) order by m.uploaded_at, m.id)
                          from menu_photos m where m.source_id = p_source), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(to_jsonb(p) - 'source_id' || jsonb_build_object('name_claim', menu_name_claim(p.name_ar) or menu_name_claim(p.name_en)) order by p.position)
                           from menu_dish_proposals p where p.source_id = p_source and p.status = 'waiting'), '[]'::jsonb),
    'dishes', coalesce((select jsonb_agg(jsonb_build_object('product_id', pr.id, 'name_en', pr.name_en, 'name_ar', pr.name_ar, 'section', pr.sub_type,
                                                            'price_usd', o.price_usd, 'is_available', o.is_available, 'printed_price', mp.price, 'printed_currency', mp.currency,
                                                            'groups', (select count(*) from dish_option_groups g where g.product_id = pr.id),
                                                            'declared', (select count(*) from dish_declarations dd where dd.product_id = pr.id and dd.superseded_at is null))
                                         order by pr.sub_type nulls last, pr.name_en)
                          from products pr join offers o on o.product_id = pr.id and o.source_id = p_source
                          left join lateral (select x.price, x.currency from menu_dish_proposals x where x.product_id = pr.id and x.status = 'approved' order by x.reviewed_at desc limit 1) mp on true
                         where pr.owner_source_id = p_source), '[]'::jsonb),
    'rejected', (select count(*) from menu_dish_proposals where source_id = p_source and status = 'rejected')) $$;

-- 0245's list, with each place's menu: photos waiting for the run, dishes waiting for a person, dishes on sale, the stamp.
create or replace function places_console() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_id', s.id, 'listing_id', s.listing_id, 'name', s.name, 'village_id', s.village_id, 'village_en', v.name_en, 'village_ar', v.name_ar,
           'phone', c.phone_e164, 'hours', s.hours, 'prep_minutes', s.prep_minutes, 'visibility', s.visibility, 'is_open', s.is_open,
           'approved', s.approved_at is not null, 'approved_at', s.approved_at, 'owner_on_file', place_owner_on_file(s.listing_id),
           'maps_url', l.maps_url, 'listing_name', l.name, 'listing_village', l.village, 'menu_checked_on', s.menu_checked_on,
           'photos_waiting', (select count(*) from menu_photos m where m.source_id = s.id and m.read_status = 'waiting'),
           'dishes_waiting', (select count(*) from menu_dish_proposals p where p.source_id = s.id and p.status = 'waiting'),
           'dishes', (select count(*) from offers o where o.source_id = s.id and o.is_available and o.price_usd > 0))
         order by s.name), '[]'::jsonb)
    from sources s left join villages v on v.id = s.village_id left join place_contacts c on c.source_id = s.id
    left join listings l on l.listing_id = s.listing_id
   where s.kind = 'merchant' and s.buys_for_customer $$;

-- ---------- grants ----------
do $$ declare t text; r text;
begin
  foreach t in array array['menu_photos', 'menu_dish_proposals'] loop
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
