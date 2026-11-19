-- Alo King Chouf, session MENU2, migration 0260: every source read into the same proposals; approval made fast; re-imports show what changed.
-- docs/DECISIONS.md, "MENU2, menus from any source, 19 November 2026".
--
--   1 the proposal   a dish proposal now comes from a photo (0246) or a source page (0259). It keeps, beside FD1's fields: the description
--                    AS PRINTED (the place's own words, for the person checking; never a food fact, never read for allergens or diet:
--                    invariant 15), the source line it was read from, the PDF page, the reader's flags (cut off, unclear name, unclear
--                    price, a price range, unclear section, other) with a note, and the price status. A price the source does not show
--                    clearly (the reader says so, no price, a size with no price, no currency, a range not turned into sizes) is
--                    "price to confirm": that dish cannot be approved until the person types its price (review_menu_dish).
--   2 re-imports     each dish read is compared with the place's dishes on sale (by its Arabic or English name, folded): a dish on sale
--                    with the same price and sizes is "unchanged" and is kept out of the queue; a different price is "price changed"
--                    (the old price beside the new); a dish not on sale is "new". When every page of a source marked as the whole menu is
--                    read, each dish on sale that the source no longer shows becomes a "removed" proposal: approving it takes the dish off
--                    sale (offers.is_available), rejecting it keeps it. A first import has no "new" badge: everything is new.
--   3 clean          menu_dish_clean: a name, a clear price with its currency (or every size priced), no flag, no praise or health word.
--                    approve_menu_section approves the clean rows a person saw on the page, in one press, each still recorded per dish
--                    with who approved it (review_menu_dish, place_log). A flagged row is approved one by one.
--   4 the console    menu_console: the sources and their pages (the screenshot or the text is the source record), the dishes waiting by
--                    section with their flags, the counts of unchanged and rejected; stamp_menu_checked waits for every source page too.
-- Nothing here writes an order, a payment, stock or the ledger, or opens a place (invariants 3, 11). Prices only from approved dishes.

-- ---------- 1 ----------
alter table menu_dish_proposals alter column photo_id drop not null;
alter table menu_dish_proposals add column if not exists page_id uuid references menu_source_pages(id);
alter table menu_dish_proposals add column if not exists menu_source_id uuid references menu_sources(id);
alter table menu_dish_proposals add column if not exists description text check (description is null or char_length(description) <= 500);
alter table menu_dish_proposals add column if not exists price_status text not null default 'clear' check (price_status in ('clear', 'to_confirm'));
alter table menu_dish_proposals add column if not exists flags text[] not null default '{}';
alter table menu_dish_proposals add column if not exists flag_note text check (flag_note is null or char_length(flag_note) <= 300);
alter table menu_dish_proposals add column if not exists source_text text check (source_text is null or char_length(source_text) <= 400);
alter table menu_dish_proposals add column if not exists pdf_page int check (pdf_page is null or pdf_page between 1 and 1000);
alter table menu_dish_proposals add column if not exists change text check (change in ('new', 'price_changed', 'removed'));
alter table menu_dish_proposals add column if not exists matched_product_id uuid references products(id);
alter table menu_dish_proposals add column if not exists old_price numeric;
alter table menu_dish_proposals add column if not exists old_currency text check (old_currency in ('USD', 'LBP'));
alter table menu_dish_proposals add column if not exists old_sizes jsonb;

-- status gains 'unchanged' (read again, same as on sale: nothing to decide); the two checks that tie status to the review follow it.
do $$ declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'menu_dish_proposals'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) ilike '%status%' or pg_get_constraintdef(oid) ilike '%reviewed_at%' or pg_get_constraintdef(oid) ilike '%product_id%')
              and pg_get_constraintdef(oid) not ilike '%price_status%' loop
    execute format('alter table menu_dish_proposals drop constraint %I', c.conname);
  end loop;
end $$;
alter table menu_dish_proposals add constraint menu_dish_proposals_status_check check (status in ('waiting', 'approved', 'rejected', 'unchanged'));
alter table menu_dish_proposals add constraint menu_dish_proposals_approved_product check ((status = 'approved') = (product_id is not null));
alter table menu_dish_proposals add constraint menu_dish_proposals_open_unreviewed check ((status in ('waiting', 'unchanged')) = (reviewed_at is null));
alter table menu_dish_proposals add constraint menu_dish_proposals_origin check (
  not (photo_id is not null and page_id is not null) and (photo_id is not null or page_id is not null or change = 'removed'));
alter table menu_dish_proposals add constraint menu_dish_proposals_removed_matched check (change is distinct from 'removed' or matched_product_id is not null);
create index if not exists menu_dish_proposals_source on menu_dish_proposals(menu_source_id) where menu_source_id is not null;

create or replace function menu_page_queue(p_limit int default 200) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('page_id', x.id, 'menu_source_id', x.menu_source_id, 'source_id', x.source_id, 'place', x.name, 'kind', x.kind,
                                               'url', x.url, 'title', x.title, 'body', x.body, 'shot_path', x.shot_path, 'doc_path', x.doc_path) order by x.fetched_at, x.position, x.id), '[]'::jsonb)
    from (select p.id, p.menu_source_id, p.source_id, s.name, m.kind, p.url, p.title, p.body, p.shot_path, p.doc_path, p.fetched_at, p.position
            from menu_source_pages p join menu_sources m on m.id = p.menu_source_id join sources s on s.id = p.source_id
           where p.status = 'waiting' order by p.fetched_at, p.position, p.id limit greatest(coalesce(p_limit, 200), 0)) x $$;

-- The reader's flags, kept only from this list.
create or replace function menu_flags(p jsonb) returns text[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct f order by f), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) f
   where f in ('cut_off', 'unclear_name', 'unclear_price', 'price_range', 'unclear_section', 'other') $$;

-- A praise or health word in a description (the names' list, 0246, and the words a menu's blurb uses to sell).
create or replace function menu_text_claim(p text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select menu_name_claim(p) or coalesce(p, '') ~* '\m(juicy|tantaliz\w*|delight\w*|mouth[- ]?watering|irresistible|finest|ultimate|perfectly|heavenly|divine|yummy)\M|شهي|رائع|مميز' $$;

-- Two dishes are the same when their Arabic names fold alike, or (where either has no Arabic name) their English names do.
create or replace function menu_same_dish(a_ar text, a_en text, b_ar text, b_en text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case when a_ar is not null and b_ar is not null then fold_text(a_ar) = fold_text(b_ar)
              else a_en is not null and b_en is not null and fold_text(a_en) = fold_text(b_en) end $$;

-- The prices of a list of sizes, as a sorted array (to compare two readings).
create or replace function menu_size_prices(p jsonb) returns numeric[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg((x->>'price')::numeric order by (x->>'price')::numeric nulls last), '{}')
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x $$;

-- One dish of a reading into a proposal (photo or page). Returns 1 when a row was made.
create or replace function menu_add_dish(p_place uuid, p_photo uuid, p_page uuid, p_msrc uuid, sec jsonb, d jsonb, p_model text) returns int
language plpgsql set search_path = public, pg_temp as $$
declare v_ar text := menu_name_ar(d->'name_ar', d->'name_en'); v_en text := menu_name_en(d->'name_ar', d->'name_en');
        v_sizes jsonb; v_opts jsonb; v_add jsonb; v_price numeric := menu_price(d->'price'); v_cur text; v_flags text[]; v_status text := 'clear';
        v_desc text := menu_text(d->'description', 500); v_ptext text := menu_text(d->'price_text', 60);
        v_prod uuid; v_lp numeric; v_lc text; v_ls jsonb; v_had boolean := false; v_change text; v_state text := 'waiting'; v_onsale boolean;
begin
  if v_ar is null and v_en is null then return 0; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name_ar', menu_name_ar(x->'name_ar', x->'name_en'), 'name_en', menu_name_en(x->'name_ar', x->'name_en'), 'price', menu_price(x->'price'),
           'currency', coalesce(menu_currency(x->'currency'), menu_currency(d->'currency')))), '[]'::jsonb)
    into v_sizes from jsonb_array_elements(case when jsonb_typeof(d->'sizes') = 'array' then d->'sizes' else '[]'::jsonb end) x
   where menu_text(x->'name_ar') is not null or menu_text(x->'name_en') is not null;
  select coalesce(jsonb_agg(jsonb_build_object('group_ar', menu_name_ar(g->'group_ar', g->'group_en'), 'group_en', menu_name_en(g->'group_ar', g->'group_en'),
           'required', coalesce((g->>'required')::boolean, false), 'min', greatest(coalesce((g->>'min')::int, 0), 0), 'max', greatest(coalesce((g->>'max')::int, 1), 1),
           'choices', coalesce((select jsonb_agg(jsonb_build_object('name_ar', menu_name_ar(c->'name_ar', c->'name_en'), 'name_en', menu_name_en(c->'name_ar', c->'name_en'),
                                                                'price_delta', coalesce(menu_price(c->'price_delta'), 0)))
                                  from jsonb_array_elements(case when jsonb_typeof(g->'choices') = 'array' then g->'choices' else '[]'::jsonb end) c
                                 where menu_text(c->'name_ar') is not null or menu_text(c->'name_en') is not null), '[]'::jsonb))), '[]'::jsonb)
    into v_opts from jsonb_array_elements(case when jsonb_typeof(d->'options') = 'array' then d->'options' else '[]'::jsonb end) g
   where menu_text(g->'group_ar') is not null or menu_text(g->'group_en') is not null;
  select coalesce(jsonb_agg(jsonb_build_object('name_ar', menu_name_ar(x->'name_ar', x->'name_en'), 'name_en', menu_name_en(x->'name_ar', x->'name_en'), 'price', menu_price(x->'price'),
           'currency', coalesce(menu_currency(x->'currency'), menu_currency(d->'currency')))), '[]'::jsonb)
    into v_add from jsonb_array_elements(case when jsonb_typeof(d->'addons') = 'array' then d->'addons' else '[]'::jsonb end) x
   where menu_text(x->'name_ar') is not null or menu_text(x->'name_en') is not null;
  v_cur := coalesce(menu_currency(d->'currency'), (select s->>'currency' from jsonb_array_elements(v_sizes) s where s->>'currency' is not null limit 1));
  v_flags := menu_flags(d->'flags');
  -- a range printed as the price (5-7, 3 / 5) and not turned into sizes is never one price
  if jsonb_array_length(v_sizes) = 0 and coalesce(v_ptext, '') ~ '[0-9]\s*([-–~]|/|to|إلى|الى)\s*[0-9]' then v_flags := array(select distinct unnest(v_flags || array['price_range']) order by 1); v_price := null; end if;
  if menu_name_claim(v_ar) or menu_name_claim(v_en) then v_flags := v_flags || array['name_claim']; end if;
  if menu_text_claim(v_desc) then v_flags := v_flags || array['description_claim']; end if;
  if coalesce((d->>'price_clear')::boolean, true) = false or (v_price is null and jsonb_array_length(v_sizes) = 0)
     or exists (select 1 from jsonb_array_elements(v_sizes) s where s->>'price' is null) or v_cur is null
     or 'unclear_price' = any(v_flags) or 'price_range' = any(v_flags) then
    v_status := 'to_confirm';
  end if;
  -- the same dish read twice from one source (two pages showing it): once
  if exists (select 1 from menu_dish_proposals x where x.source_id = p_place and x.status = 'waiting' and x.menu_source_id is not distinct from p_msrc and x.change is distinct from 'removed'
               and menu_same_dish(x.name_ar, x.name_en, v_ar, v_en) and x.price is not distinct from v_price and menu_size_prices(x.sizes) = menu_size_prices(v_sizes)) then
    return 0;
  end if;
  -- compared with what is on sale
  select p.id, coalesce(o.is_available, false) into v_prod, v_onsale from products p left join offers o on o.product_id = p.id and o.source_id = p_place
   where p.owner_source_id = p_place and menu_same_dish(p.name_ar, p.name_en, v_ar, v_en) order by o.is_available desc nulls last limit 1;
  if v_prod is not null and v_onsale then
    select x.price, x.currency, x.sizes, true into v_lp, v_lc, v_ls, v_had from menu_dish_proposals x where x.product_id = v_prod and x.status = 'approved' and x.change is distinct from 'removed'
     order by x.reviewed_at desc limit 1;
    if coalesce(v_had, false) and v_lp is not distinct from v_price and v_lc is not distinct from v_cur and menu_size_prices(v_ls) = menu_size_prices(v_sizes) then
      v_state := 'unchanged';
    else
      v_change := 'price_changed';
    end if;
  elsif exists (select 1 from offers o join products p on p.id = o.product_id where o.source_id = p_place and p.owner_source_id = p_place and o.is_available) then
    v_change := 'new';
  end if;
  insert into menu_dish_proposals(source_id, photo_id, page_id, menu_source_id, section_ar, section_en, name_ar, name_en, translated, price, currency, price_text,
                                  sizes, options, addons, read_model, status, description, price_status, flags, flag_note, source_text, pdf_page, change,
                                  matched_product_id, old_price, old_currency, old_sizes)
    values (p_place, p_photo, p_page, p_msrc, menu_name_ar(sec->'name_ar', sec->'name_en'), menu_name_en(sec->'name_ar', sec->'name_en'), v_ar, v_en,
            case when d->>'translated' in ('ar', 'en') then d->>'translated' end, v_price, v_cur, v_ptext,
            v_sizes, v_opts, v_add, left(p_model, 80), v_state, v_desc, v_status, v_flags, menu_text(d->'flag_note', 300), menu_text(d->'source_text', 400),
            case when jsonb_typeof(d->'page') = 'number' and (d->>'page')::numeric between 1 and 1000 then (d->>'page')::int end, v_change,
            case when v_onsale then v_prod end, case when v_change = 'price_changed' then v_lp end, case when v_change = 'price_changed' then v_lc end,
            case when v_change = 'price_changed' then v_ls end);
  return 1;
end $$;

-- 0246's photo reading, through the same door.
create or replace function record_menu_reading(p_photo uuid, p_reading jsonb, p_model text, p_by uuid, p_reason text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare m menu_photos%rowtype; sec jsonb; d jsonb; n int := 0;
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
      n := n + menu_add_dish(m.source_id, p_photo, null, null, sec, d, p_model);
    end loop;
  end loop;
  update menu_photos set read_status = 'read', read_at = now(), read_model = left(p_model, 80) where id = p_photo;
  insert into place_log(source_id, action, by_party, detail) values (m.source_id, 'reading', p_by, jsonb_build_object('photo_id', p_photo, 'dishes', n));
  return jsonb_build_object('ok', true, 'dishes', n);
end $$;

-- ---------- 2 ----------
-- Once every page of a whole-menu source is read, each dish on sale that it no longer shows is proposed as removed.
create or replace function menu_source_finish(p_msrc uuid) returns int language plpgsql set search_path = public, pg_temp as $$
declare m menu_sources%rowtype; n int := 0;
begin
  select * into m from menu_sources where id = p_msrc for update;
  if not found or m.status <> 'fetched' then return 0; end if;
  if exists (select 1 from menu_source_pages where menu_source_id = p_msrc and status = 'waiting') then return 0; end if;
  update menu_sources set status = 'done' where id = p_msrc;
  if m.full_menu then
    insert into menu_dish_proposals(source_id, menu_source_id, section_ar, section_en, name_ar, name_en, price, currency, read_model, status, change, matched_product_id, price_status)
    select m.source_id, p_msrc, last.section_ar, last.section_en, p.name_ar, coalesce(p.name_en, p.name_ar), last.price, last.currency, 'compare', 'waiting', 'removed', p.id, 'clear'
      from products p join offers o on o.product_id = p.id and o.source_id = m.source_id and o.is_available
      left join lateral (select x.section_ar, x.section_en, x.price, x.currency from menu_dish_proposals x where x.product_id = p.id and x.status = 'approved' order by x.reviewed_at desc limit 1) last on true
     where p.owner_source_id = m.source_id
       and not exists (select 1 from menu_dish_proposals x where x.menu_source_id = p_msrc and x.change is distinct from 'removed'
                         and (x.matched_product_id = p.id or menu_same_dish(x.name_ar, x.name_en, p.name_ar, p.name_en)))
       and not exists (select 1 from menu_dish_proposals x where x.matched_product_id = p.id and x.change = 'removed' and x.status = 'waiting');
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

create or replace function record_menu_page_reading(p_page uuid, p_reading jsonb, p_model text, p_by uuid, p_reason text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare pg menu_source_pages%rowtype; sec jsonb; d jsonb; n int := 0; v_removed int;
begin
  if p_by is distinct from menu_reader_party() and not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into pg from menu_source_pages where id = p_page for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if pg.status <> 'waiting' then return jsonb_build_object('ok', true, 'already', true, 'dishes', 0); end if;
  if p_reading is null or jsonb_typeof(p_reading->'sections') is distinct from 'array' then
    -- the third failure sets the page aside, with its reason on the Menus page, so the rest of the menu is not held up
    update menu_source_pages set failures = failures + 1, last_failure = left(coalesce(p_reason, 'no reading'), 200),
           status = case when failures + 1 >= 3 then 'skipped' else 'waiting' end,
           skip_reason = case when failures + 1 >= 3 then 'could not be read three times: read it by hand' end where id = p_page;
    insert into place_log(source_id, action, by_party, detail) values (pg.source_id, 'reading_failed', p_by, jsonb_build_object('page_id', p_page, 'reason', left(coalesce(p_reason, 'no reading'), 200)));
    perform menu_source_finish(pg.menu_source_id);
    return jsonb_build_object('ok', false, 'dishes', 0);
  end if;
  for sec in select * from jsonb_array_elements(p_reading->'sections') loop
    for d in select * from jsonb_array_elements(case when jsonb_typeof(sec->'dishes') = 'array' then sec->'dishes' else '[]'::jsonb end) loop
      n := n + menu_add_dish(pg.source_id, null, p_page, pg.menu_source_id, sec, d, p_model);
    end loop;
  end loop;
  update menu_source_pages set status = 'read', read_at = now(), read_model = left(p_model, 80) where id = p_page;
  insert into place_log(source_id, action, by_party, detail) values (pg.source_id, 'reading', p_by, jsonb_build_object('page_id', p_page, 'dishes', n));
  v_removed := menu_source_finish(pg.menu_source_id);
  return jsonb_build_object('ok', true, 'dishes', n, 'removed', v_removed);
end $$;

-- ---------- 3 ----------
create or replace function menu_dish_clean(p menu_dish_proposals) returns boolean language sql stable set search_path = public, pg_temp as $$
  select p.status = 'waiting' and p.change is distinct from 'removed' and p.price_status = 'clear' and cardinality(p.flags) = 0
     and (p.name_ar is not null or p.name_en is not null) and not menu_name_claim(p.name_ar) and not menu_name_claim(p.name_en) and not menu_text_claim(p.description)
     and p.currency is not null and (p.price is not null or (jsonb_array_length(p.sizes) > 0 and not exists (select 1 from jsonb_array_elements(p.sizes) s where s->>'price' is null))) $$;

-- p_edit may correct name_ar, name_en, section_ar, section_en, description, price, currency, and size_prices (one typed price per size, in
-- order). A dish whose price is to be confirmed needs the price typed (price, or every size's). A removed dish: approve takes it off sale,
-- reject keeps it on sale. A rejection needs a reason.
create or replace function review_menu_dish(p_dish uuid, p_by uuid, p_approve boolean, p_edit jsonb default '{}', p_note text default null) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare d menu_dish_proposals%rowtype; v_ar text; v_en text; v_sec_ar text; v_sec_en text; v_price numeric; v_cur text; v_base numeric; v_usd numeric;
        v_prod uuid; v_group uuid; x jsonb; c jsonb; i int; g int := 0; v_e jsonb := coalesce(p_edit, '{}'::jsonb); v_desc text; v_sizes jsonb;
        v_typed boolean;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  select * into d from menu_dish_proposals where id = p_dish for update;
  if not found then raise exception 'DISH_NOT_FOUND'; end if;
  if d.status <> 'waiting' then raise exception 'DISH_ALREADY_REVIEWED'; end if;
  if not coalesce(p_approve, false) then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'REASON_REQUIRED: say why (at least 3 characters)'; end if;
    update menu_dish_proposals set status = 'rejected', reviewed_by = p_by, reviewed_at = now(), review_note = left(btrim(p_note), 500) where id = p_dish;
    insert into place_log(source_id, action, by_party, detail) values (d.source_id, 'dish_reject', p_by, jsonb_build_object('dish', p_dish, 'reason', left(btrim(p_note), 500), 'change', d.change));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  if d.change = 'removed' then
    update offers set is_available = false where source_id = d.source_id and product_id = d.matched_product_id;
    update menu_dish_proposals set status = 'approved', reviewed_by = p_by, reviewed_at = now(), product_id = d.matched_product_id,
           review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '') where id = p_dish;
    insert into place_log(source_id, action, by_party, detail) values (d.source_id, 'dish_off', p_by, jsonb_build_object('dish', p_dish, 'product_id', d.matched_product_id));
    return jsonb_build_object('ok', true, 'status', 'approved', 'off_sale', true, 'product_id', d.matched_product_id);
  end if;
  v_ar := case when v_e ? 'name_ar' then menu_text(v_e->'name_ar') else d.name_ar end;
  v_en := case when v_e ? 'name_en' then menu_text(v_e->'name_en') else d.name_en end;
  v_sec_ar := case when v_e ? 'section_ar' then menu_text(v_e->'section_ar') else d.section_ar end;
  v_sec_en := case when v_e ? 'section_en' then menu_text(v_e->'section_en') else d.section_en end;
  v_desc := case when v_e ? 'description' then menu_text(v_e->'description', 500) else d.description end;
  if v_ar is null and v_en is null then raise exception 'NAME_REQUIRED'; end if;
  if menu_name_claim(v_ar) or menu_name_claim(v_en) then raise exception 'DISH_NAME_CLAIM: a dish name says what it is, never how good or healthy it is; change the name first'; end if;
  if menu_text_claim(v_desc) then raise exception 'DISH_DESCRIPTION_CLAIM: a description says what is in the dish, never how good or healthy it is; change it first'; end if;
  -- typed size prices, one per size in order
  v_sizes := d.sizes;
  if coalesce(jsonb_typeof(v_e->'size_prices') = 'array', false) then
    if jsonb_array_length(v_e->'size_prices') <> jsonb_array_length(d.sizes) then raise exception 'SIZE_PRICES: type one price for each size'; end if;
    select coalesce(jsonb_agg(s || jsonb_build_object('price', menu_price(v_e->'size_prices'->(o::int - 1))) order by o), '[]'::jsonb) into v_sizes
      from jsonb_array_elements(d.sizes) with ordinality t(s, o);
    if exists (select 1 from jsonb_array_elements(v_sizes) s where s->>'price' is null) then raise exception 'SIZE_PRICES: type one price for each size'; end if;
  end if;
  v_price := case when v_e ? 'price' then nullif(v_e->>'price', '')::numeric else d.price end;
  v_typed := coalesce(v_e ? 'price' and nullif(v_e->>'price', '') is not null, false) or coalesce(jsonb_typeof(v_e->'size_prices') = 'array', false);
  if d.price_status = 'to_confirm' and not v_typed then
    raise exception 'PRICE_TO_CONFIRM: the source does not show this price clearly; type it as printed (or each size''s) before approving';
  end if;
  v_cur := coalesce(case when v_e ? 'currency' then menu_currency(v_e->'currency') end, d.currency,
                    (select s->>'currency' from jsonb_array_elements(v_sizes) s where s->>'currency' is not null limit 1));
  v_base := coalesce(v_price, (select min((s->>'price')::numeric) from jsonb_array_elements(v_sizes) s where s->>'price' is not null));
  if v_base is null or v_base <= 0 or v_cur is null then raise exception 'PRICE_REQUIRED: type the price as printed, and whether it is USD or LBP'; end if;
  v_usd := menu_usd(v_base, v_cur);
  -- the dish on sale it was matched with when read (a re-import); else the same names (FD1's rule): price and options replaced, product kept
  v_prod := d.matched_product_id;
  if v_prod is null then
    select p.id into v_prod from products p where p.owner_source_id = d.source_id
       and fold_text(coalesce(p.name_ar, '') || ' ' || p.name_en) = fold_text(coalesce(v_ar, '') || ' ' || coalesce(v_en, v_ar)) limit 1;
  end if;
  if v_prod is null then
    insert into products(sku, owner_source_id, name_en, name_ar, category, sub_type, storage, sell_unit)
      values ('D-' || left(d.source_id::text, 8) || '-' || substr(md5(d.id::text), 1, 8), d.source_id, coalesce(v_en, v_ar), v_ar, 'Restaurant',
              coalesce(v_sec_en, v_sec_ar), 'ambient', 'piece')
      returning id into v_prod;
  else
    update products set name_en = coalesce(v_en, v_ar), name_ar = v_ar, sub_type = coalesce(v_sec_en, v_sec_ar, sub_type), is_active = true where id = v_prod;
    delete from dish_option_groups where product_id = v_prod;
  end if;
  insert into offers(source_id, product_id, price_usd, is_available) values (d.source_id, v_prod, v_usd, true)
    on conflict (source_id, product_id) do update set price_usd = excluded.price_usd, is_available = true;
  if v_ar is not null then insert into product_aliases(product_id, alias, lang) values (v_prod, v_ar, 'ar') on conflict do nothing; end if;
  if jsonb_array_length(v_sizes) > 0 then
    g := g + 1;
    insert into dish_option_groups(product_id, name_en, name_ar, required, min_choices, max_choices, sort_order) values (v_prod, 'Size', 'الحجم', true, 1, 1, g) returning id into v_group;
    i := 0;
    for x in select * from jsonb_array_elements(v_sizes) loop
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
         sizes = v_sizes, description = v_desc, review_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_dish;
  insert into place_log(source_id, action, by_party, detail) values (d.source_id, 'dish_approve', p_by, jsonb_build_object('dish', p_dish, 'product_id', v_prod, 'edited', v_e <> '{}'::jsonb, 'change', d.change));
  return jsonb_build_object('ok', true, 'status', 'approved', 'product_id', v_prod, 'price_usd', v_usd);
end $$;

-- "Approve all clean dishes in this section": the rows the person saw (their ids, from the page), each approved by review_menu_dish (so each
-- is recorded per dish, with who approved it). A row that is not clean, not waiting, or not this place's is left for one-by-one review.
create or replace function approve_menu_section(p_place uuid, p_ids uuid[], p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r menu_dish_proposals%rowtype; n int := 0; k int := 0;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'NOTHING_CHOSEN'; end if;
  if cardinality(p_ids) > 200 then raise exception 'TOO_MANY: at most 200 dishes at a time'; end if;
  for r in select * from menu_dish_proposals where id = any(p_ids) order by position loop
    if r.source_id = p_place and menu_dish_clean(r) then
      perform review_menu_dish(r.id, p_by, true, '{}'::jsonb, null);
      n := n + 1;
    else
      k := k + 1;
    end if;
  end loop;
  k := k + (cardinality(p_ids) - n - k);
  insert into place_log(source_id, action, by_party, detail) values (p_place, 'section_approve', p_by, jsonb_build_object('approved', n, 'left', k));
  return jsonb_build_object('ok', true, 'approved', n, 'left', k);
end $$;

-- ---------- 4 ----------
create or replace function stamp_menu_checked(p_source uuid, p_by uuid) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_day date := (now() at time zone 'Asia/Beirut')::date;
begin
  if not place_staff_ok(p_by) then raise exception 'NOT_AUTHORISED'; end if;
  if not exists (select 1 from sources where id = p_source and buys_for_customer) then raise exception 'NOT_A_PLACE'; end if;
  if exists (select 1 from menu_photos where source_id = p_source and read_status = 'waiting') then raise exception 'MENU_PHOTOS_UNREAD: a photo waits for the reading run'; end if;
  if exists (select 1 from menu_sources where source_id = p_source and status = 'waiting')
     or exists (select 1 from menu_source_pages where source_id = p_source and status = 'waiting') then
    raise exception 'MENU_SOURCES_UNREAD: a menu source waits for the reading run';
  end if;
  if exists (select 1 from menu_dish_proposals where source_id = p_source and status = 'waiting') then raise exception 'MENU_DISHES_WAITING: approve or reject every dish first'; end if;
  if not exists (select 1 from offers where source_id = p_source and is_available and price_usd > 0) then raise exception 'NO_APPROVED_MENU: approve at least one dish first'; end if;
  update sources set menu_checked_on = v_day, menu_checked_by = p_by where id = p_source;
  insert into place_log(source_id, action, by_party, detail) values (p_source, 'menu_checked', p_by, jsonb_build_object('on', v_day));
  return jsonb_build_object('ok', true, 'menu_checked_on', v_day::text);
end $$;

create or replace function menu_console(p_source uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'place', (select jsonb_build_object('source_id', s.id, 'name', s.name, 'visibility', s.visibility, 'approved', s.approved_at is not null,
                                        'menu_checked_on', s.menu_checked_on, 'menu_checked_by', (select display_name from parties where id = s.menu_checked_by),
                                        'has_dishes', exists (select 1 from offers o where o.source_id = s.id and o.is_available))
                from sources s where s.id = p_source and s.buys_for_customer),
    'fx', current_fx(),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('photo_id', m.id, 'media_path', m.media_path, 'uploaded_at', m.uploaded_at, 'read_status', m.read_status,
                                                            'read_at', m.read_at, 'failures', m.failures, 'last_failure', m.last_failure,
                                                            'dishes', (select count(*) from menu_dish_proposals p where p.photo_id = m.id)) order by m.uploaded_at, m.id)
                          from menu_photos m where m.source_id = p_source), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('menu_source_id', m.id, 'kind', m.kind, 'url', m.url, 'file_name', m.file_name, 'media_path', m.media_path,
                                                             'full_menu', m.full_menu, 'status', m.status, 'added_at', m.added_at, 'failures', m.failures, 'last_failure', m.last_failure,
                                                             'pages', (select count(*) from menu_source_pages p where p.menu_source_id = m.id),
                                                             'pages_waiting', (select count(*) from menu_source_pages p where p.menu_source_id = m.id and p.status = 'waiting'),
                                                             'dishes', (select count(*) from menu_dish_proposals p where p.menu_source_id = m.id and p.change is distinct from 'removed'))
                                          order by m.added_at, m.id)
                           from menu_sources m where m.source_id = p_source), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('page_id', p.id, 'menu_source_id', p.menu_source_id, 'position', p.position, 'url', p.url, 'title', p.title,
                                                           'shot_path', p.shot_path, 'doc_path', p.doc_path, 'status', p.status, 'skip_reason', p.skip_reason,
                                                           'failures', p.failures, 'chars', char_length(coalesce(p.body, '')),
                                                           'dishes', (select count(*) from menu_dish_proposals x where x.page_id = p.id)) order by p.menu_source_id, p.position)
                         from menu_source_pages p where p.source_id = p_source), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(to_jsonb(p) - 'source_id' || jsonb_build_object('name_claim', menu_name_claim(p.name_ar) or menu_name_claim(p.name_en),
                                                                                         'clean', menu_dish_clean(p)) order by p.position)
                           from menu_dish_proposals p where p.source_id = p_source and p.status = 'waiting'), '[]'::jsonb),
    'dishes', coalesce((select jsonb_agg(jsonb_build_object('product_id', pr.id, 'name_en', pr.name_en, 'name_ar', pr.name_ar, 'section', pr.sub_type,
                                                            'price_usd', o.price_usd, 'is_available', o.is_available, 'printed_price', mp.price, 'printed_currency', mp.currency,
                                                            'groups', (select count(*) from dish_option_groups g where g.product_id = pr.id),
                                                            'declared', (select count(*) from dish_declarations dd where dd.product_id = pr.id and dd.superseded_at is null))
                                         order by pr.sub_type nulls last, pr.name_en)
                          from products pr join offers o on o.product_id = pr.id and o.source_id = p_source and o.is_available
                          left join lateral (select x.price, x.currency from menu_dish_proposals x where x.product_id = pr.id and x.status = 'approved' and x.change is distinct from 'removed'
                                              order by x.reviewed_at desc limit 1) mp on true
                         where pr.owner_source_id = p_source), '[]'::jsonb),
    'unchanged', (select count(*) from menu_dish_proposals where source_id = p_source and status = 'unchanged'),
    'rejected', (select count(*) from menu_dish_proposals where source_id = p_source and status = 'rejected')) $$;

-- the page body of one source page (the text record), for the person checking
create or replace function menu_page_text(p_page uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('page_id', p.id, 'source_id', p.source_id, 'title', p.title, 'url', p.url, 'body', p.body) from menu_source_pages p where p.id = p_page $$;

create or replace function places_console() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_id', s.id, 'listing_id', s.listing_id, 'name', s.name, 'village_id', s.village_id, 'village_en', v.name_en, 'village_ar', v.name_ar,
           'phone', c.phone_e164, 'hours', s.hours, 'prep_minutes', s.prep_minutes, 'visibility', s.visibility, 'is_open', s.is_open,
           'approved', s.approved_at is not null, 'approved_at', s.approved_at, 'owner_on_file', place_owner_on_file(s.listing_id),
           'maps_url', l.maps_url, 'listing_name', l.name, 'listing_village', l.village, 'menu_checked_on', s.menu_checked_on,
           'photos_waiting', (select count(*) from menu_photos m where m.source_id = s.id and m.read_status = 'waiting')
                           + (select count(*) from menu_source_pages p where p.source_id = s.id and p.status = 'waiting')
                           + (select count(*) from menu_sources m where m.source_id = s.id and m.status = 'waiting'),
           'dishes_waiting', (select count(*) from menu_dish_proposals p where p.source_id = s.id and p.status = 'waiting'),
           'dishes', (select count(*) from offers o where o.source_id = s.id and o.is_available and o.price_usd > 0))
         order by s.name), '[]'::jsonb)
    from sources s left join villages v on v.id = s.village_id left join place_contacts c on c.source_id = s.id
    left join listings l on l.listing_id = s.listing_id
   where s.kind = 'merchant' and s.buys_for_customer $$;


-- What a reading run proposed for a place, for the run's summary and the session report: per section the dishes waiting (clean, price to
-- confirm, flagged), the dishes with sizes and their prices, and every flagged row with the reader's note and the source line.
create or replace function menu_place_report(p_place uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  with w as (select p.*, menu_dish_clean(p) as clean, coalesce(p.section_en, p.section_ar, '(no section)') as sec,
                    coalesce(p.name_ar, p.name_en) as dish from menu_dish_proposals p where p.source_id = p_place and p.status = 'waiting')
  select jsonb_build_object(
    'place', (select name from sources where id = p_place),
    'sections', coalesce((select jsonb_agg(jsonb_build_object('section', sec, 'dishes', n, 'clean', c, 'price_to_confirm', t, 'flagged', f) order by first_pos)
                            from (select sec, count(*) n, count(*) filter (where clean) c, count(*) filter (where price_status = 'to_confirm') t,
                                         count(*) filter (where cardinality(flags) > 0) f, min(position) first_pos from w group by sec) x), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('section', sec, 'dish', dish, 'sizes', sizes) order by position) from w where jsonb_array_length(sizes) > 0), '[]'::jsonb),
    'flagged', coalesce((select jsonb_agg(jsonb_build_object('section', sec, 'dish', dish, 'flags', flags, 'note', flag_note, 'price_status', price_status,
                                                             'price_text', price_text, 'source_text', source_text, 'change', change) order by position)
                           from w where not clean), '[]'::jsonb),
    'unchanged', (select count(*) from menu_dish_proposals where source_id = p_place and status = 'unchanged'),
    'waiting', (select count(*) from w), 'clean', (select count(*) from w where clean)) $$;

select pin_search_paths();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
