-- Alo King, session B1f, migration 0253 (the number its prompt gave; recorded in docs/STATUS.md, section 5). Search and product data
-- before the friends' test. docs/log/b1f.md says what each part fixes and how it was found.
--
--   1. labneh's spellings: "labne", "labneh", "labni", "lebneh" (and the rest below) share one form, as the size words do (0053), so every
--      spelling finds what the others find. «لبنة» and «لبنه» were one word already (ة folds to ه).
--   2. a word that names one kind (search_word_owners): «لبنة» and "labneh" are kept as a search term only on an item whose own name says
--      labneh. On staging the search-words job (packages/agents/src/search-words.ts, version auto-2026-11-16) had written «لبنة» as a kind
--      word of two laban items and an apricot yoghurt (AK-0048, AK-0056, AK-0057), so «لبنة» found six items where "labneh" found three.
--      A trigger refuses such a term on every write (the job, a migration, a person); the ones already written are removed here and the
--      items' search documents rebuilt. «لبن» (laban) is not owned: «لبن عيران» (ayran) and «لبن يوناني» (Greek yoghurt) are what people say.
--   3. Talaya: «طلاية» and «تالايا» are its brand words, «مياه فوارة» and «مياه غازية» its kind, «تالايا ليمون وليم» its name (sim-006 of
--      CX2's run asked «مياه فوارة طلاية» and was offered oranges, then told we do not carry it: «ليمون» named the lemon). «قنينات» and
--      "2anenin" are container words (filler), as «قناني» is.
--   4. price basis to confirm (price_basis_checks): the supplier sheet's price for an item sold by weight is "per average sale, not per
--      pack" (supabase/seed/catalog.csv, its note), so whether a price is for the pack or for a kilo is a question for a person, never a
--      guess. Every such item gets an open check, listed on the console's "Weights to record on label day" page. A check that blocks the
--      sale keeps the item unsellable (its hub offer unavailable, held by a trigger) until an ops lead or admin answers it.
--      The eggs AK-0049: its barcode 5283001700604 is a maker's code (528, Lebanon's GS1 prefix), not an in-store weight code (2...) as every other
--      "by weight" item has, so it is a fixed pack: its sell unit becomes "Each". How many eggs and whether 4.56 is that pack's price the
--      data cannot say (the research matched a 30-egg tray as "likely", not exact): its check blocks the sale.
--   5. weights_to_record(): the console's list (item, aisle, what the price is said to be for, the open check).
--   6. delivery windows: a window is offered only inside the rider shifts (settings.join.rider.shifts): never a time no rider works. The
--      shifts are data (invariant 13); nothing here names an hour. The hours are the time guard's (output-guard.ts).
-- Prices are not changed anywhere here (invariant 7).

-- ---------- 1: labneh's spellings share one form ----------
create or replace function catalog_token_forms(t text) returns text[] language sql immutable as $$
  select array_agg(distinct f) from (
    select t as f
    -- size words in every number and spelling people use: big and small, singular and plural, with or without the article
    union all select 'kbir' where t ~ '^(el|l)?(kbir|kbire|kbireh|kbiri|kbar|kebir|kbeer)$' or t ~ '^(ال)?(كبير|كبيره|كبار)$'
    union all select 'zghir' where t ~ '^(el|l)?(zghir|zghire|zghireh|zghar|z8ir|z8ire|z8ar|zgher|zghire)$' or t ~ '^(ال)?(صغير|صغيره|صغار|زغير|زغيره|زغار)$'
    -- B1f: labneh as people write it in Latin letters (never laban: "laban", "leben" stay apart)
    union all select 'labneh' where t ~ '^(el|l)?(labne|labneh|labni|labnee|labnie|labnih|lebne|lebneh|lebni|labnah|labneah)$'
    union all select substr(t, 4) where t ~ '^(وال|بال|عال|فال|كال)' and length(t) >= 6
    union all select substr(t, 3) where t ~ '^(ال|لل)' and length(t) >= 5
    union all select substr(t, 2) where t ~ '^[وبعف]' and length(t) >= 4
    union all select substr(t, 4) where t ~ '^[وبعف]ال' and length(t) >= 6
  ) x where f = t or length(f) >= 3
$$;

-- The stored forms of every term and document that holds one of these spellings, recomputed with the new function.
update language_pack set forms = catalog_term_forms(term)
 where tokens && array['labne','labneh','labni','labnee','labnie','labnih','lebne','lebneh','lebni','labnah','labneah',
                       'ellabne','ellabneh','llabne','llabneh','ellebneh','lelabneh'];
update product_search_forms f set forms = catalog_term_forms(d.document)
  from product_search_documents d
 where d.product_id = f.product_id
   and catalog_term_forms(d.document) && array['labneh'] and not (f.forms && array['labneh']);

-- ---------- 2: a word that names one kind ----------
create table if not exists search_word_owners (
  word        text primary key,        -- a folded form (catalog_term_forms)
  owner_forms text[] not null,         -- the item's own name must hold one of these forms
  note        text
);
insert into search_word_owners(word, owner_forms, note) values
  ('لبنه', array['لبنه', 'labneh'], 'B1f: labneh is not laban or yoghurt (staging, 18 Nov 2026)'),
  ('labneh', array['لبنه', 'labneh'], 'B1f: every Latin spelling of labneh (catalog_token_forms)')
on conflict (word) do nothing;

create table if not exists search_word_drops (
  id         bigint generated always as identity primary key,
  sku        text not null,
  term       text not null,
  level      text not null,
  reason     text not null,
  dropped_at timestamptz not null default now()
);

-- The forms of an item's own names (English, Arabic, the approved French), for the owner check.
create or replace function product_name_forms(p_sku text) returns text[] language sql stable set search_path = public, pg_temp as $$
  select catalog_term_forms(concat_ws(' ', p.name_en, p.name_ar,
           (select v.value #>> '{}' from product_field_values v where v.product_id = p.id and v.field_key = 'name_fr' and v.status = 'approved' limit 1)))
    from products p where p.sku = p_sku $$;

-- The owned word a term holds that the item's own name does not: null when the term may stay. An item not loaded yet: null (the check
-- runs again when the job writes its terms; the pack of 0054 has no such term).
create or replace function search_word_not_owned(p_sku text, p_term text) returns text language sql stable set search_path = public, pg_temp as $$
  select o.word from search_word_owners o, (select product_name_forms(p_sku) as nf) n
   where n.nf is not null and o.word = any(catalog_term_forms(p_term)) and not (o.owner_forms && n.nf)
   limit 1 $$;

create or replace function language_pack_owner_check() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare w text := search_word_not_owned(new.sku, new.term);
begin
  if w is null then return new; end if;
  insert into search_word_drops(sku, term, level, reason) values (new.sku, new.term, new.level, 'owned_word:' || w);
  return null;                                     -- not written: «لبنة» is never a search word of laban
end $$;
drop trigger if exists language_pack_owner_check on language_pack;
-- named after language_pack_fill, so it fires after it (triggers fire in name order)
create trigger language_pack_owner_check before insert or update of term on language_pack for each row execute function language_pack_owner_check();

-- The ones already written (staging: AK-0048 «لبنة», AK-0056 «لبنة» and «لبنة كاملة», AK-0057 «لبنة»), logged, then the documents.
with gone as (
  delete from language_pack lp where search_word_not_owned(lp.sku, lp.term) is not null
  returning lp.sku, lp.term, lp.level, search_word_not_owned(lp.sku, lp.term) as w
), logged as (
  insert into search_word_drops(sku, term, level, reason) select sku, term, level, 'owned_word:' || w || ' (0253 cleanup)' from gone returning sku
)
select count(*) from (select refresh_search_documents(p.id) from products p where p.sku in (select distinct sku from logged)) x;

-- ---------- 3b: «مش هيك» negates «هيك» only ----------
-- sim-006 (CX2's run, turn 4): «لا مش هيك، بدي مياه تالايا الفوارة …» ("no, not like that, I want Talaya sparkling water"). A negation covered
-- the next two words that are not filler, so «مياه» was negated and the very item asked for ruled out. A word that stands for what was said
-- or offered («هيك», "like that", "this one", «هيدا») is the whole thing negated: the negation stops there. 0053's text otherwise.
create table if not exists catalog_negation_stop (word text primary key);   -- folded, one token each
insert into catalog_negation_stop(word) select unnest(catalog_tokens(w)) from unnest(array[
  'هيك','هيدا','هيدي','هيدول','هاي','هاد','هادا','هيداك','هيديك','هالشي',
  'hek','heik','hayk','haik','hayda','haida','hayde','haide','heda','hedi','hedeke','comme','ça','cela','this','that','those','these'
]) w on conflict do nothing;
alter table catalog_negation_stop enable row level security;

create or replace function catalog_negated(p_tokens text[]) returns int[] language plpgsql stable as $$
declare i int; j int; left_ int; out int[] := '{}';
begin
  for i in 1 .. coalesce(array_length(p_tokens, 1), 0) loop
    if exists (select 1 from catalog_negation where word = p_tokens[i]) then
      left_ := 2; j := i + 1;
      while j <= array_length(p_tokens, 1) and left_ > 0 loop
        exit when exists (select 1 from catalog_negation where word = p_tokens[j]);
        exit when left_ < 2 and p_tokens[j] ~ '^[0-9]+$';      -- «mesh el kbire (l 400g)»: the 400 g is what they want
        out := out || j;
        exit when exists (select 1 from catalog_negation_stop where word = p_tokens[j]);   -- B1f: «مش هيك»: that, and nothing after
        if not exists (select 1 from catalog_filler where word = any(catalog_token_forms(p_tokens[j]))) then left_ := left_ - 1; end if;
        j := j + 1;
      end loop;
    end if;
  end loop;
  return out;
end $$;

-- ---------- 3: Talaya ----------
insert into language_pack(sku, term, level, lang, version) values
  ('AK-0106', 'طلاية', 'brand', 'ar', 'b1f-2026-11-18'),
  ('AK-0106', 'تالايا', 'brand', 'ar', 'b1f-2026-11-18'),
  ('AK-0106', 'مياه فوارة', 'kind', 'ar', 'b1f-2026-11-18'),
  ('AK-0106', 'مياه غازية', 'kind', 'ar', 'b1f-2026-11-18'),
  ('AK-0106', 'تالايا ليمون وليم', 'exact', 'ar', 'b1f-2026-11-18')
on conflict do nothing;
-- container words in the plural, never a product («3 قنينات», "7 2anenin"), as «قناني» already is (0053)
insert into catalog_filler(word) select unnest(catalog_tokens(w)) from unnest(array['قنينات', 'قنانيات', '2anenin', 'anenin', '2nenin']) w on conflict do nothing;
select refresh_search_documents(p.id) from products p where p.sku = 'AK-0106';

-- ---------- 4: price basis to confirm ----------
create table if not exists price_basis_checks (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id),
  question     text not null,                   -- what a person must settle, in plain words (English; the console shows it)
  blocks_sale  boolean not null default false,  -- true: the item is not sold until the answer
  prior_offers jsonb not null default '[]',     -- [{source_id, is_available}] as they were, given back on the answer
  opened_by    text not null default 'B1f',
  opened_at    timestamptz not null default now(),
  resolved_by  uuid references parties(id),
  resolved_at  timestamptz,
  resolution   text check (resolution in ('per_pack', 'per_kg')),
  note         text
);
create unique index if not exists price_basis_checks_open on price_basis_checks(product_id) where resolved_at is null;

create or replace function price_basis_open(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from price_basis_checks where product_id = p_product and resolved_at is null) $$;
create or replace function price_basis_blocks(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from price_basis_checks where product_id = p_product and resolved_at is null and blocks_sale) $$;

-- A check that blocks the sale makes the item not orderable: the one question every read asks (quote_order says "coming soon", the cart,
-- the website, the catalogue feed). Wrapped by name, so whatever product_orderable is underneath (0226's label gate, 0245's places) stays.
alter function product_orderable(uuid) rename to product_orderable_before_b1f;
create or replace function product_orderable(p_product uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select product_orderable_before_b1f(p_product) and not price_basis_blocks(p_product) $$;
alter function product_orderable_for(uuid, uuid) rename to product_orderable_for_before_b1f;
create or replace function product_orderable_for(p_product uuid, p_party uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select product_orderable_for_before_b1f(p_product, p_party) and not price_basis_blocks(p_product) $$;

-- While a check blocks the sale, no path makes the hub's offer available (receiving, a price change, a hold released).
create or replace function offers_price_basis_hold() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_available and price_basis_blocks(new.product_id)
     and exists (select 1 from sources s where s.id = new.source_id and s.kind = 'dark_store') then
    new.is_available := false;
  end if;
  return new;
end $$;
drop trigger if exists offers_price_basis_hold on offers;
create trigger offers_price_basis_hold before insert or update of is_available on offers for each row execute function offers_price_basis_hold();

-- Opens a check (idempotent: an item with an open check keeps it, and an answered one is not asked again by the same opener). A blocking check takes the hub's offer off sale, remembering it.
create or replace function open_price_basis_check(p_sku text, p_question text, p_blocks boolean, p_by text default 'B1f') returns uuid
language plpgsql set search_path = public, pg_temp as $$
declare v_id uuid; v_product uuid := (select id from products where sku = p_sku); v_prior jsonb;
begin
  if v_product is null then return null; end if;
  -- an open check stays; one this opener asked before and a person answered is never asked again
  select id into v_id from price_basis_checks where product_id = v_product and (resolved_at is null or opened_by = p_by)
   order by resolved_at nulls first limit 1;
  if v_id is not null then return v_id; end if;
  select coalesce(jsonb_agg(jsonb_build_object('source_id', o.source_id, 'is_available', o.is_available)), '[]'::jsonb) into v_prior
    from offers o join sources s on s.id = o.source_id and s.kind = 'dark_store' where o.product_id = v_product;
  insert into price_basis_checks(product_id, question, blocks_sale, prior_offers, opened_by) values (v_product, p_question, p_blocks, v_prior, p_by)
    returning id into v_id;
  if p_blocks then
    update offers o set is_available = false from sources s where s.id = o.source_id and s.kind = 'dark_store' and o.product_id = v_product;
  end if;
  return v_id;
end $$;

-- The answer, by an ops lead or admin: the price is for the pack, or per kilo (the item's sell unit becomes "kg", so every page says "per
-- kg"). The offer the check took off sale comes back as it was. The price itself is not touched here.
create or replace function resolve_price_basis(p_check uuid, p_resolution text, p_note text, p_by uuid) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare c price_basis_checks%rowtype; x jsonb;
begin
  if not exists (select 1 from parties where id = p_by and role in ('ops_lead', 'admin') and not is_blocked) then raise exception 'NOT_AUTHORISED'; end if;
  if p_resolution not in ('per_pack', 'per_kg') then raise exception 'BAD_RESOLUTION'; end if;
  select * into c from price_basis_checks where id = p_check for update;
  if not found then raise exception 'CHECK_NOT_FOUND'; end if;
  if c.resolved_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_answered'); end if;
  update price_basis_checks set resolved_at = now(), resolved_by = p_by, resolution = p_resolution, note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_check;
  if p_resolution = 'per_kg' then update products set sell_unit = 'kg' where id = c.product_id; end if;
  if c.blocks_sale then
    for x in select * from jsonb_array_elements(c.prior_offers) loop
      update offers set is_available = (x->>'is_available')::boolean where product_id = c.product_id and source_id = (x->>'source_id')::uuid;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'product_id', c.product_id, 'resolution', p_resolution);
end $$;

-- B1f's checks, returning how many it opened: the eggs (blocking) and every hub item sold by weight whose price basis is the sheet's (not blocking: the customer reads
-- "per pack, weight not confirmed yet" until a weight is approved, WEB4a 12). Called here, and by a test after its seeds.
create or replace function b1f_price_basis_checks() returns int language plpgsql set search_path = public, pg_temp as $$
declare n int := (select count(*) from price_basis_checks where resolved_at is null); r record;
begin
  -- the eggs: a fixed pack by its barcode, so not sold by weight; the count and the pack's price are for a person
  update products set sell_unit = 'Each' where sku = 'AK-0049' and sell_unit ilike 'by weight%' and coalesce(barcode, '') !~ '^2[0-9]';
  perform open_price_basis_check('AK-0049',
       'A fixed pack (its barcode is the maker''s), not sold by weight. How many eggs are in the pack, and is the sheet''s price (an average sale) the price of one pack? Check the tray and the invoice.',
       true);
  for r in select p.sku from products p
            where p.is_active and p.owner_source_id is null and p.sell_unit ilike 'by weight%' and p.sku <> 'AK-0049' order by p.sku loop
    perform open_price_basis_check(r.sku,
         'The sheet''s price is for an average sale, not a pack. Is our price for the pack or per kg? Weigh one pack on label day and check the invoice.',
         false);
  end loop;
  return (select count(*) from price_basis_checks where resolved_at is null) - n;   -- how many were opened now
end $$;
select b1f_price_basis_checks();

-- ---------- 5: the console's list ----------
-- Every active hub item whose price is for a pack of a weight we have not approved, or that has an open price-basis check: its aisle,
-- what the pages say the price is for (catalog_price_for, 0244), the price and the check. Read only.
create or replace function weights_to_record() returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', x.id, 'sku', x.sku, 'name_en', x.name_en, 'name_ar', x.name_ar, 'sell_unit', x.sell_unit,
           'aisle_en', x.aisle_en, 'aisle_ar', x.aisle_ar, 'price_usd', x.price_usd, 'price_for', x.pf,
           'weight_missing', x.pf is not null and x.pf->>'per' = 'pack' and x.pf->>'about_g' is null,
           'check', x.chk) order by x.aisle_sort nulls last, x.sku), '[]'::jsonb)
    from (
      select p.id, p.sku, p.name_en, p.name_ar, p.sell_unit, catalog_price_for(p.id) as pf,
             c.name_en as aisle_en, c.name_ar as aisle_ar, c.sort_order as aisle_sort,
             (select o.price_usd from offers o join sources s on s.id = o.source_id and s.kind = 'dark_store' where o.product_id = p.id order by o.price_usd limit 1) as price_usd,
             (select jsonb_build_object('id', k.id, 'question', k.question, 'blocks_sale', k.blocks_sale, 'opened_at', k.opened_at)
                from price_basis_checks k where k.product_id = p.id and k.resolved_at is null) as chk
        from products p
        left join catalog_placements pl on pl.sku = p.sku
        left join catalog_categories c on c.code = pl.category_code
       where p.is_active and p.owner_source_id is null
    ) x
   where (x.pf is not null and x.pf->>'per' = 'pack' and x.pf->>'about_g' is null) or x.chk is not null $$;

-- ---------- 6: delivery windows inside the rider shifts ----------
-- Whether a rider shift covers every quarter hour of [from, to). No shifts set: true. The hours are not checked here: the windows are the
-- founder's data on the /windows page (seeded 09:00 to 21:00, inside the hours), and the model's words are checked against the hours by
-- the time guard (output-guard.ts, time_claim).
create or replace function service_covers(p_from time, p_to time) returns boolean language sql stable set search_path = public, pg_temp as $$
  with sh as (select (x->>'from')::time as f, (x->>'to')::time as t from jsonb_array_elements(coalesce(setting('join')->'rider'->'shifts', '[]'::jsonb)) x)
  select p_from is not null and p_to is not null and p_to > p_from
     and (not exists (select 1 from sh)
          or not exists (select 1 from generate_series(0, greatest(0, (extract(epoch from (p_to - p_from)) / 60)::int - 1), 15) m
                          where not exists (select 1 from sh where p_from + make_interval(mins => m) >= sh.f and p_from + make_interval(mins => m) < sh.t))) $$;

alter function open_delivery_windows(uuid, boolean, int) rename to open_delivery_windows_unchecked;
create or replace function open_delivery_windows(p_village uuid default null, p_fresh boolean default false, p_limit int default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_all jsonb := open_delivery_windows_unchecked(p_village, p_fresh, 100);
begin
  return coalesce((select jsonb_agg(v order by o) from (
    select v, o from jsonb_array_elements(v_all) with ordinality e(v, o)
     where service_covers((v->>'starts')::time, (v->>'ends')::time)
     order by o limit coalesce(p_limit, (setting('scheduling')->>'offer_max')::int, 6)) y), '[]'::jsonb);
end $$;

-- New tables: row level security on, no client grants.
do $$ declare t text; r text;
begin
  foreach t in array array['search_word_owners', 'search_word_drops', 'price_basis_checks'] loop
    execute format('alter table %I enable row level security', t);
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
