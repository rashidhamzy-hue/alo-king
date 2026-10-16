-- Session 5f part 9 (DECISIONS §39.15.4): catalogue rules the merchant agent learns.
--
-- 1. public.catalog_rules: every rule Meta's catalogue applies that we know of, in plain words in Arabic, English, French
--    and Arabizi. The rules live in one file, supabase/functions/_shared/catalog-rules.json: the validator
--    (catalog-rules.ts) reads it, docs/catalog/META-CATALOG-RULES.md is generated from it (scripts/catalog/rules-doc.ts),
--    and this migration seeds the table from it (source meta_published; checked_here false for the ones only Meta's own
--    review can see: writing on the photo, a watermark, a collage). A later session adds or rewords a rule in the JSON
--    and in a new migration (insert into public.catalog_rules … on conflict (code) do update); rules-doc.test.ts reads
--    every catalog_rules upsert in supabase/migrations in filename order and checks the result equals the JSON.
-- 2. The learning loop: whenever Meta's answer for products is stored in catalog_item_status (catalog_status_record,
--    after every batch and in the paced sweep), every error whose error_type and title no rule knows becomes a `learned`
--    rule with Meta's words, an example item and a count; a known one gets its count (new occurrences: items that did
--    not carry it at their last read) and last_seen (at most hourly). Statement-level triggers do it in one set-based
--    upsert per status page, so catalog_status_record keeps its own definition (20261016141000_catalogue_unreviewed.sql)
--    and learning never blocks the status write. The next build session reviews learned rules: it writes the other three
--    languages and links each to a published rule or turns it into a check.
-- 3. Holds: the sync runs the validator before every batch; an item that fails is held out of Meta's catalogue (hidden
--    there if it was shown) and stays orderable through the chat lists and the web menu. catalog_hold_record keeps each
--    shop's held items and the codes of the rules they break; app_private.catalog_item_shown leaves them out of product
--    messages at once (they open in the list after the section's product message); catalog_status_report counts them
--    ("held") and names the commonest reason.
-- 4. catalog_desired hands the validator what it needs: the merchant's alcohol flag, the shop's business type and the
--    photo's measured size (menu_item_photos.width, height, bytes: recorded by the demo pipeline and by a merchant's photo).
-- 5. A merchant's own item photo by WhatsApp (the copilot): a photo captioned "photo <item>" that the validator passed
--    is uploaded to a fresh path and waits in app_private.merchant_item_photo_pending for the merchant's tap on a card
--    naming the item; merchant_item_photo_confirm records it as the item's photo (source merchant), replacing any photo
--    before it. Owner or manager only, never a demo shop; a pending photo nobody taps expires and its file is deleted.
-- Rollback: supabase/rollbacks/20261016200000_catalog_rules.sql.

select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'catalogue rules (DECISIONS §39.15.4, session 5f part 9)', true);

-- 1. The rules ---------------------------------------------------------------------------------------------------------
create table public.catalog_rules (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  -- What the rule is about; a learned rule is 'other' until the review session places it.
  field text not null check (field in ('image', 'title', 'price', 'description', 'policy', 'other')),
  rule_en text not null check (char_length(rule_en) between 1 and 500),
  rule_ar text check (char_length(rule_ar) between 1 and 500),
  rule_fr text check (char_length(rule_fr) between 1 and 500),
  rule_arabizi text check (char_length(rule_arabizi) between 1 and 500),
  source text not null check (source in ('meta_published', 'learned')),
  -- validateCatalogItem checks it before anything is sent; false: only Meta's own review can see it.
  checked_here boolean not null default false,
  -- Where a published rule comes from (Meta's requirements, or a decision of ours).
  basis text check (char_length(basis) <= 200),
  -- Meta's words for it, as GET /{catalog}/products reports them in a product's errors (exact, compared without case).
  meta_error_title text check (char_length(meta_error_title) <= 200),
  meta_error_type text check (char_length(meta_error_type) <= 100),
  example_item_id uuid references public.menu_items (id) on delete set null,
  -- When Meta first and last reported it; null: never yet.
  first_seen timestamptz,
  last_seen timestamptz,
  -- How many times an item newly carried this error (a status read that repeats it only moves last_seen).
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  constraint catalog_rules_published_words check (
    source <> 'meta_published' or (rule_ar is not null and rule_fr is not null and rule_arabizi is not null and basis is not null)),
  constraint catalog_rules_learned_words check (source <> 'learned' or meta_error_title is not null or meta_error_type is not null)
);
create index catalog_rules_meta_type_idx on public.catalog_rules (lower(meta_error_type)) where meta_error_type is not null;
create index catalog_rules_meta_title_idx on public.catalog_rules (lower(meta_error_title)) where meta_error_title is not null;
alter table public.catalog_rules enable row level security;
revoke all on public.catalog_rules from public, anon, authenticated;
grant all on public.catalog_rules to service_role;
comment on table public.catalog_rules is
  'DECISIONS §39.15.4: the rules of Meta''s catalogue in four languages. meta_published rows are the seed of 20261016200000 (and docs/catalog/META-CATALOG-RULES.md); learned rows are Meta''s refusals no rule knew, added by the status read, for the next build session to review.';

-- The published rules, generated from supabase/functions/_shared/catalog-rules.json (scripts/catalog/rules-doc.ts --seed);
-- rules-doc.test.ts checks every catalog_rules upsert in supabase/migrations, in order, adds up to that file.
insert into public.catalog_rules (code, field, source, checked_here, basis, rule_en, rule_ar, rule_fr, rule_arabizi) values
  ('image_too_small', 'image', 'meta_published', true,
   'Meta: product images at least 500 × 500 pixels',
   'Photos are at least 500 × 500 pixels.',
   'الصورة لازم تكون 500 × 500 بيكسل عالأقل.',
   'Les photos font au moins 500 × 500 pixels.',
   'El soura lezim tkoun 500 × 500 pixel 3al a2all.'),
  ('image_not_square', 'image', 'meta_published', true,
   'Meta shows products square; the 2:1 limit is ours (DECISIONS §39.15.4)',
   'A square crop of the photo still shows the item: the long side is at most twice the short side.',
   'لازم الصورة تنقصّ مربّعة ويضل الصنف باين: الطول مش أكتر من ضعف العرض.',
   'Un recadrage carré montre encore l''article : le grand côté fait au plus deux fois le petit.',
   'Lezim el soura tenn2ass mrabba3a w yedal el sanf bayyen: el tool mish aktar men d3ef el 3ard.'),
  ('image_not_https', 'image', 'meta_published', true,
   'Meta fetches image_link itself; https only (DECISIONS §39.15.4)',
   'Photos are served from a secure (https) address.',
   'الصورة لازم تكون على عنوان آمن (https).',
   'Les photos sont servies depuis une adresse sécurisée (https).',
   'El soura lezim tkoun 3a 3enwen amen (https).'),
  ('image_placeholder', 'image', 'meta_published', true,
   'Meta: the image shows the actual item, never a placeholder',
   'A real photo of the item: never a placeholder, a blank or an empty image.',
   'صورة حقيقية للصنف: مش صورة بديلة أو فاضية.',
   'Une vraie photo de l''article : jamais une image d''attente, vide ou blanche.',
   'Soura 7a2i2iye lal sanf: mish soura badile aw fadye.'),
  ('image_unreadable', 'image', 'meta_published', true,
   'Meta: JPEG or PNG product images (WebP read here too)',
   'Photos are JPEG, PNG or WebP files.',
   'الصورة لازم تكون JPEG أو PNG أو WebP.',
   'Les photos sont des fichiers JPEG, PNG ou WebP.',
   'El soura lezim tkoun JPEG aw PNG aw WebP.'),
  ('image_text_overlay', 'image', 'meta_published', false,
   'Meta: no text overlay on product images (Meta''s review decides)',
   'No writing, prices or logos on the photo.',
   'ما في كتابة أو أسعار أو لوغو عالصورة.',
   'Pas de texte, de prix ni de logo sur la photo.',
   'Ma fi ktebe aw as3ar aw logo 3al soura.'),
  ('image_watermark', 'image', 'meta_published', false,
   'Meta: no watermarks on product images (Meta''s review decides)',
   'No watermarks on the photo.',
   'ما في علامة مائية (watermark) عالصورة.',
   'Pas de filigrane sur la photo.',
   'Ma fi watermark 3al soura.'),
  ('image_collage', 'image', 'meta_published', false,
   'Meta: one item per image, no collages (Meta''s review decides)',
   'One item per photo: no collages and no several pictures in one.',
   'صنف واحد بالصورة: ما في كولاج أو كذا صورة بصورة وحدة.',
   'Un article par photo : pas de collage ni plusieurs images en une.',
   'Sanf wa7ad bel soura: ma fi collage aw kaza soura b soura wa7de.'),
  ('title_missing', 'title', 'meta_published', true,
   'Meta: every product has a title',
   'Every item has a name.',
   'كل صنف إلو اسم.',
   'Chaque article a un nom.',
   'Kel sanf elo esem.'),
  ('title_too_long', 'title', 'meta_published', true,
   'Meta''s title limit as item-text.ts builds titles (DECISIONS §39.15.2)',
   'The name, with the shop''s, fits in 150 characters.',
   'الاسم مع اسم المحل ما بيزيد عن 150 حرف.',
   'Le nom, avec celui du commerce, tient en 150 caractères.',
   'El esem ma3 esem el ma7al ma byezid 3an 150 7aref.'),
  ('title_all_caps', 'title', 'meta_published', true,
   'DECISIONS §39.15.2 title rules; Meta: no all-capital titles',
   'Names are never written in capital letters only.',
   'الأسماء ما بتنكتب كلها بأحرف كبيرة (CAPS).',
   'Les noms ne sont jamais écrits tout en majuscules.',
   'El asami ma btenketeb kella CAPS.'),
  ('title_mixed_language', 'title', 'meta_published', true,
   'DECISIONS §39.15.2 title rules (one language)',
   'A name is in one language: Arabic letters or Latin letters, not both.',
   'الاسم بلغة وحدة: يا عربي يا أحرف لاتينية، مش الاتنين سوا.',
   'Un nom est dans une seule langue : lettres arabes ou latines, pas les deux.',
   'El esem b lougha wa7de: ya 3arabe ya a7ref latine, mish el tnen sawa.'),
  ('title_promotional', 'title', 'meta_published', true,
   'Meta: no prices, promotional text or contact details in titles',
   'Names carry no prices, offers, phone numbers or links.',
   'ما في أسعار أو عروض أو أرقام تلفون أو روابط بالاسم.',
   'Les noms ne contiennent ni prix, ni offre, ni numéro de téléphone, ni lien.',
   'Ma fi as3ar aw 3orod aw ar2am telephone aw links bel esem.'),
  ('price_not_positive', 'price', 'meta_published', true,
   'Meta: every product has a price',
   'Every item has a price above zero.',
   'كل صنف إلو سعر أكتر من صفر.',
   'Chaque article a un prix supérieur à zéro.',
   'Kel sanf elo se3er aktar men sefer.'),
  ('description_contact', 'description', 'meta_published', true,
   'Meta: no phone numbers, links or emails in descriptions',
   'Descriptions have no phone numbers, links or email addresses.',
   'ما في أرقام تلفون أو روابط أو إيميل بالوصف.',
   'Les descriptions ne contiennent ni numéro de téléphone, ni lien, ni e-mail.',
   'Ma fi ar2am telephone aw links aw email bel wasf.'),
  ('description_promotional', 'description', 'meta_published', true,
   'Meta: no promotional text in descriptions',
   'Descriptions have no promotional text: no “free”, “discount”, “best price”, “!!!” or rows of emoji.',
   'ما في كلام دعاية بالوصف: لا «ببلاش» ولا «خصم» ولا «أفضل سعر» ولا «!!!» ولا إيموجي كتير.',
   'Les descriptions n''ont pas de texte promotionnel : ni « gratuit », ni « remise », ni « meilleur prix », ni « !!! », ni rangées d''emoji.',
   'Ma fi kalem de3aye bel wasf: la «bbalesh» wala «5asem» wala «a7san se3er» wala «!!!» wala emoji ktir.'),
  ('policy_medicine', 'policy', 'meta_published', true,
   'DECISIONS §38.3 (Order of Pharmacists, 2 June 2026); Meta commerce policy',
   'No medicines or pharmacy products: selling them through delivery apps is illegal in Lebanon (Order of Pharmacists, 2 June 2026).',
   'ما في أدوية أو منتجات صيدلية: بيعها عبر تطبيقات التوصيل ممنوع بلبنان (نقابة الصيادلة، 2 حزيران 2026).',
   'Pas de médicaments ni de produits de pharmacie : les vendre par une application de livraison est illégal au Liban (Ordre des pharmaciens, 2 juin 2026).',
   'Ma fi adwye aw montajet saydaliye: bey3a 3abr apps el tawsil mamnou3 b Lebnen (Ne2abet el sayedle, 2 7zayran 2026).'),
  ('policy_alcohol', 'policy', 'meta_published', true,
   'Meta commerce policy; Alo King never lists alcohol (alcohol.ts)',
   'No alcohol in the WhatsApp catalogue (Meta''s commerce policy; Alo King never lists alcohol).',
   'ما في كحول بكاتالوج واتساب (سياسة Meta؛ وAlo King ما بيعرض كحول أبداً).',
   'Pas d''alcool dans le catalogue WhatsApp (politique commerciale de Meta ; Alo King ne liste jamais d''alcool).',
   'Ma fi ko7ol b catalogue WhatsApp (siyaset Meta; w Alo King ma bi3red ko7ol abadan).'),
  ('policy_tobacco', 'policy', 'meta_published', true,
   'Meta commerce policy',
   'No tobacco, cigarettes, shisha tobacco or vapes in the WhatsApp catalogue (Meta''s commerce policy).',
   'ما في دخان أو سجائر أو تنباك أو فيب بكاتالوج واتساب (سياسة Meta).',
   'Pas de tabac, cigarettes, tabac à chicha ni vapoteuses dans le catalogue WhatsApp (politique commerciale de Meta).',
   'Ma fi dekhan aw sigara aw tombak aw vape b catalogue WhatsApp (siyaset Meta).');

-- 2. The learning loop -------------------------------------------------------------------------------------------------
-- One Meta error as a key: its error_type and its title, without case and with spaces folded (a repeat is the same key).
create function app_private.catalog_error_key(p_error jsonb) returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_error ->> 'error_type', ''))) || '|'
    || lower(btrim(regexp_replace(coalesce(p_error ->> 'title', ''), '\s+', ' ', 'g')));
$$;
revoke all on function app_private.catalog_error_key(jsonb) from public, anon, authenticated;

-- After a statement stores Meta's answer for products (one status page is one statement, up to 500 rows): every error
-- is matched to a rule by its error_type, else by its title, without case; an unknown one becomes a learned rule (Meta's
-- words, an item as its example). One set-based upsert per statement, rows in code order (so two writers lock rules in
-- the same order), one exception block per statement. A rule is touched only when its count grows (an item that did
-- not carry the error at its last read) or its last sighting is over an hour old, so the 2-hourly sweep re-reading the
-- same refusals writes nothing (§39.14 rule 2). A failure here is a warning, never a failed status write.
create function app_private.catalog_rules_learn() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text[] := '{}';
  v_now timestamptz := now();
begin
  if not exists (select 1 from new_rows n where jsonb_typeof(n.errors) = 'array' and n.errors <> '[]'::jsonb) then
    return null;
  end if;
  begin
    -- What the updated items carried before: (item, error key) pairs, so a repeat is not a new occurrence.
    if tg_op = 'UPDATE' then
      select coalesce(array_agg(distinct o.item_id::text || '#' || app_private.catalog_error_key(x)), '{}') into v_old
      from old_rows o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.errors) = 'array' then o.errors else '[]' end) x
      where jsonb_typeof(x) = 'object';
    end if;
    with seen as (
      select distinct on (n.item_id, app_private.catalog_error_key(x)) n.item_id, app_private.catalog_error_key(x) as k,
        nullif(left(btrim(regexp_replace(coalesce(x ->> 'title', ''), '\s+', ' ', 'g')), 200), '') as title,
        nullif(left(btrim(coalesce(x ->> 'error_type', '')), 100), '') as etype,
        nullif(left(btrim(regexp_replace(coalesce(x ->> 'description', ''), '\s+', ' ', 'g')), 500), '') as descr
      from new_rows n
      cross join lateral jsonb_array_elements(case when jsonb_typeof(n.errors) = 'array' then n.errors else '[]' end) x
      where jsonb_typeof(x) = 'object'
        and (nullif(btrim(coalesce(x ->> 'title', '')), '') is not null or nullif(btrim(coalesce(x ->> 'error_type', '')), '') is not null)
    ), matched as (
      select s.*, coalesce(
          (select r.code from public.catalog_rules r where s.etype is not null and lower(r.meta_error_type) = lower(s.etype)
           order by r.source = 'meta_published' desc, r.code limit 1),
          (select r.code from public.catalog_rules r where s.title is not null and lower(r.meta_error_title) = lower(s.title)
           order by r.source = 'meta_published' desc, r.code limit 1),
          'learned_' || left(coalesce(nullif(trim(both '_' from regexp_replace(lower(coalesce(s.etype, s.title)), '[^a-z0-9]+', '_', 'g')), ''),
            'meta_error'), 40) || '_'
            || left(md5(lower(coalesce(s.etype, '')) || '|' || case when s.etype is null then lower(s.title) else '' end), 8)) as code,
        (s.item_id::text || '#' || s.k) <> all (v_old) as is_new
      from seen s
    ), per_rule as (
      select m.code, count(*) filter (where m.is_new) as n_new,
        (array_agg(m.item_id order by m.item_id))[1] as example,
        (array_agg(m.title order by m.item_id) filter (where m.title is not null))[1] as title,
        (array_agg(m.etype order by m.item_id) filter (where m.etype is not null))[1] as etype,
        (array_agg(m.descr order by m.item_id) filter (where m.descr is not null))[1] as descr
      from matched m group by m.code
    )
    insert into public.catalog_rules as r (code, field, rule_en, source, checked_here, meta_error_title, meta_error_type,
      example_item_id, first_seen, last_seen, count)
    select p.code, 'other', left(coalesce(p.descr, p.title, p.etype), 500), 'learned', false, p.title, p.etype, p.example,
      v_now, v_now, p.n_new
    from per_rule p
    order by p.code
    on conflict (code) do update
      set count = r.count + excluded.count, last_seen = excluded.last_seen,
          first_seen = coalesce(r.first_seen, excluded.first_seen),
          example_item_id = coalesce(r.example_item_id, excluded.example_item_id),
          -- A learned rule first seen by its title learns its type when Meta gives one.
          meta_error_type = case when r.source = 'learned' then coalesce(r.meta_error_type, excluded.meta_error_type)
                                 else r.meta_error_type end
      where excluded.count > 0 or r.last_seen is null or r.last_seen < excluded.last_seen - interval '1 hour'
         or (r.source = 'learned' and r.meta_error_type is null and excluded.meta_error_type is not null);
  exception when others then
    raise warning 'catalogue rule learning skipped for % status rows: %', (select count(*) from new_rows), sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function app_private.catalog_rules_learn() from public, anon, authenticated;
-- Transition tables need one trigger per event (an upsert fires both: its inserted rows, then its updated ones).
create trigger catalog_item_status_learn_insert after insert on public.catalog_item_status
  referencing new table as new_rows for each statement execute function app_private.catalog_rules_learn();
create trigger catalog_item_status_learn_update after update on public.catalog_item_status
  referencing old table as old_rows new table as new_rows for each statement execute function app_private.catalog_rules_learn();

-- 3. Holds: what the sync leaves out of Meta's catalogue, and why ------------------------------------------------------
create table public.catalog_item_holds (
  item_id uuid primary key references public.menu_items (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  -- The codes of the rules the item breaks (catalog_rules.code).
  codes text[] not null check (cardinality(codes) between 1 and 20),
  held_since timestamptz not null default now(),
  checked_at timestamptz not null default now()
);
create index catalog_item_holds_vendor_idx on public.catalog_item_holds (vendor_id);
alter table public.catalog_item_holds enable row level security;
revoke all on public.catalog_item_holds from public, anon, authenticated;
grant all on public.catalog_item_holds to service_role;

-- The sync's answer for one shop: every item it held back, with its rule codes ([{item_id, codes}]). The list replaces
-- the shop's holds (an empty list clears them); ids that are not this shop's items are skipped.
create function public.catalog_hold_record(p_vendor_id uuid, p_holds jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_holds) is distinct from 'array' then
    raise exception 'p_holds must be a json array' using errcode = 'invalid_parameter_value';
  end if;
  with h as (
    select distinct on (i.id) i.id as item_id,
      array(select distinct c from jsonb_array_elements_text(case when jsonb_typeof(x -> 'codes') = 'array' then x -> 'codes' else '[]' end) c
            where c ~ '^[a-z][a-z0-9_]{2,63}$' order by c limit 20) as codes
    from jsonb_array_elements(p_holds) x
    join public.menu_items i on i.id::text = x ->> 'item_id' and i.vendor_id = p_vendor_id
    where jsonb_typeof(x) = 'object'
      and (x ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by i.id
  ), cleared as (
    delete from public.catalog_item_holds k
    where k.vendor_id = p_vendor_id and not exists (select 1 from h where h.item_id = k.item_id and cardinality(h.codes) > 0)
  )
  insert into public.catalog_item_holds (item_id, vendor_id, codes)
  select h.item_id, p_vendor_id, h.codes from h where cardinality(h.codes) > 0
  on conflict (item_id) do update set vendor_id = excluded.vendor_id, codes = excluded.codes, checked_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.catalog_hold_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.catalog_hold_record(uuid, jsonb) to service_role;

-- Shown in WhatsApp = synced as visible, approved by Meta, published, and not held back (as in 20261016140000, with the
-- hold added: a held item leaves product messages at once, before Meta applies the hide). The simulator's catalogue has
-- no Meta behind it, but it holds the same items, so a simulated customer sees what a real one would.
create or replace function app_private.catalog_item_shown(p_item_id uuid, p_catalog_id text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_catalog_id = 'sim' or exists (
      select 1 from public.catalog_sync_items c
      join public.catalog_item_status s on s.item_id = c.item_id
      where c.item_id = p_item_id and c.visible and c.catalog_id = p_catalog_id and s.catalog_id = p_catalog_id
        and s.meta_status = 'approved' and coalesce(s.visibility, 'published') = 'published'
        and coalesce(s.availability, 'in stock') = 'in stock'))
    and not exists (select 1 from public.catalog_item_holds h where h.item_id = p_item_id);
$$;

-- The per-shop report (as in 20261016140000) with what the rules hold back: held, and the commonest reason.
drop function public.catalog_status_report(text);
create function public.catalog_status_report(p_catalog_id text default null)
returns table (vendor_id uuid, shop text, items bigint, with_photo bigint, synced bigint, approved bigint, pending bigint,
  rejected bigint, missing bigint, unknown bigint, held bigint, top_error text, top_hold text)
language sql
stable
security definer
set search_path = ''
as $$
  with cat as (
    select coalesce(p_catalog_id, (select c.catalog_id from public.whatsapp_catalogs c where c.transport is not null
      order by c.checked_at desc limit 1)) as id
  )
  select v.id, coalesce(v.name_en, v.name_ar),
    count(*) filter (where app_private.menu_item_orderable(i.id, 1)),
    count(p.item_id),
    count(c.item_id) filter (where c.visible),
    count(*) filter (where c.visible and s.meta_status = 'approved' and coalesce(s.visibility, 'published') = 'published'
      and coalesce(s.availability, 'in stock') = 'in stock'),
    count(*) filter (where c.visible and s.meta_status in ('', 'pending', 'outdated')),
    count(*) filter (where c.visible and s.meta_status = 'rejected'),
    count(*) filter (where c.visible and s.meta_status = 'missing'),
    count(*) filter (where c.visible and s.item_id is null),
    count(h.item_id),
    (select e ->> 'title' from public.catalog_item_status s2 cross join jsonb_array_elements(s2.errors) e
      where s2.vendor_id = v.id group by e ->> 'title' order by count(*) desc limit 1),
    (select x from public.catalog_item_holds h2 cross join unnest(h2.codes) x
      where h2.vendor_id = v.id group by x order by count(*) desc, x limit 1)
  from public.vendors v
  cross join cat
  join public.menu_items i on i.vendor_id = v.id
  left join public.menu_item_photos p on p.item_id = i.id
  left join public.catalog_sync_items c on c.item_id = i.id and c.catalog_id = cat.id
  left join public.catalog_item_status s on s.item_id = i.id and s.catalog_id = cat.id
  left join public.catalog_item_holds h on h.item_id = i.id
  where v.claim_status = 'claimed' and v.orderable and not v.is_test
  group by v.id, v.name_en, v.name_ar
  order by coalesce(v.name_en, v.name_ar);
$$;
revoke all on function public.catalog_status_report(text) from public, anon, authenticated;
grant execute on function public.catalog_status_report(text) to service_role;

-- 4. What the validator needs from the database --------------------------------------------------------------------
alter table public.menu_item_photos
  add column width integer check (width between 1 and 20000),
  add column height integer check (height between 1 and 20000),
  add column bytes integer check (bytes >= 0);
comment on column public.menu_item_photos.width is
  'The stored image''s width in pixels when it was measured (the demo pipeline, a merchant''s WhatsApp photo); null: not measured. The catalogue validator (§39.15.4) checks it.';

-- A photo whose file changes without a new size (menu_item_photo_set, the demo upsert, any later writer) loses the old
-- size, so the validator never judges a new file by the old one's measure; the demo pipeline measures it again.
create function app_private.menu_item_photos_size_reset() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- A merchant's photo carries the SHA-256 of its stored bytes: the same hash is the same file, whose size still holds
  -- (the same photo sent again and confirmed lands at a new path).
  if (new.storage_path, new.origin_hash) is distinct from (old.storage_path, old.origin_hash)
     and (new.width, new.height, new.bytes) is not distinct from (old.width, old.height, old.bytes)
     and not (new.source = 'merchant' and old.source = 'merchant' and coalesce(new.origin_hash = old.origin_hash, false)) then
    new.width := null;
    new.height := null;
    new.bytes := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.menu_item_photos_size_reset() from public;
create trigger menu_item_photos_size_reset before update on public.menu_item_photos
  for each row execute function app_private.menu_item_photos_size_reset();

-- As in 20261016160000_item_pages.sql, with the merchant's alcohol flag, the shop's business type and the photo's
-- measured size for the validator (catalog-rules.ts); none of them changes what Meta is sent.
create or replace function public.catalog_desired(p_vendor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      -- The sync turns these parts into the title and the description (item-text.ts); 'name' and 'description' are what
      -- an older dispatch would show meanwhile.
      'name', left(coalesce(i.name_en, i.name_fr, i.name_ar), 150),
      'description', left(coalesce(nullif(i.description, ''), coalesce(i.name_en, i.name_ar)), 500),
      'name_en', i.name_en,
      'name_ar', i.name_ar,
      'name_fr', i.name_fr,
      'menu_text', nullif(btrim(i.description), ''),
      'shop_en', v.name_en,
      'shop_ar', v.name_ar,
      'village_en', pl.name_en,
      'village_ar', pl.name_ar,
      'kcal', case when nu.status in ('merchant_verified', 'estimated') then round(nu.kcal) end,
      'protein_g', case when nu.status in ('merchant_verified', 'estimated') then round(nu.protein_g, 1) end,
      'allergens_declared', case when i.allergens_confirmed_at is not null then to_jsonb(coalesce(i.allergens, '{}')) end,
      'usually', case when nu.dish_id is not null then to_jsonb(app_private.item_usual_ingredients(nu.dish_id)) end,
      'weight_kg', case when i.pricing_unit = 'kg' then i.est_weight_kg end,
      'illustrative', p.source = 'illustrative',
      'link', case when cfg.site is not null and cfg.page then cfg.site || '/en/i/' || i.id end,
      -- While the item has no page, a CC BY photo's credit stays in the description (the page credits it later).
      'photo_credit', case when p.license ~* '^CC BY' then left(regexp_replace(p.credit, '\s+', ' ', 'g'), 80) || ' · ' || p.license end,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', p.storage_path,
      'photo_hash', p.origin_hash,
      -- For the catalogue rules (§39.15.4).
      'contains_alcohol', i.contains_alcohol,
      'business_type', v.business_type,
      'photo_width', p.width,
      'photo_height', p.height,
      'photo_bytes', p.bytes)
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  -- offset 0 keeps the subquery from being flattened: the address and the shop's page rule are read once per call, not
  -- once per product.
  cross join (select app_private.public_site_url() as site, app_private.item_page_visible(p_vendor_id) as page offset 0) cfg
  join public.vendors v on v.id = i.vendor_id
  join public.menu_item_photos p on p.item_id = i.id
  left join public.menu_sections s on s.id = i.section_id
  left join public.places pl on pl.id = v.town_id
  left join public.menu_item_nutrition nu on nu.item_id = i.id
  -- A removed item is never shown (menu_items.removed_at): it leaves the desired set, so the sync hides it at Meta.
  where i.vendor_id = p_vendor_id and i.removed_at is null and v.claim_status = 'claimed' and v.orderable
    and v.listing_status = 'active';
$$;

-- The demo pipeline records the size of a photo it just stored (always the processed file Meta will fetch).
create function public.menu_item_photo_measure(p_item_id uuid, p_storage_path text, p_width integer, p_height integer,
  p_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_width, 0) not between 1 and 20000 or coalesce(p_height, 0) not between 1 and 20000 or coalesce(p_bytes, -1) < 0 then
    return jsonb_build_object('status', 'bad_size');
  end if;
  update public.menu_item_photos set width = p_width, height = p_height, bytes = p_bytes
  where item_id = p_item_id and storage_path = p_storage_path;
  return jsonb_build_object('status', case when found then 'ok' else 'no_photo' end);
end;
$$;
revoke all on function public.menu_item_photo_measure(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.menu_item_photo_measure(uuid, text, integer, integer, integer) to service_role;

-- 5. A merchant's own item photo, sent on WhatsApp -------------------------------------------------------------------
-- A photo captioned "photo <item>" that the validator passed is uploaded to a fresh path and waits here for the
-- merchant's tap on a card naming the item (dispatch/merchant/photo.ts); only the tap makes it the item's photo, so a
-- photo never lands on the wrong item unseen. One pending photo per member and item (a newer one replaces it); a
-- pending photo nobody taps expires after merchant_photo_pending_hours and its file is deleted the next time a merchant
-- photo or tap is handled (merchant_item_photo_pending_expired).
insert into public.app_config (key, value, effective_from, note) values
  ('merchant_photo_pending_hours', '24', '2026-10-16 12:00+03',
   'Session 5f part 9 review: a merchant''s item photo waits this long for its confirming tap, then its file is deleted')
-- The rollback keeps config rows (dated, never deleted), so applying this file again after it must not fail here.
on conflict on constraint app_config_unique do nothing;

create table app_private.merchant_item_photo_pending (
  id uuid primary key,
  member_id uuid not null references public.vendor_members (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id) on delete cascade,
  item_id uuid not null references public.menu_items (id) on delete cascade,
  -- JPEG or PNG only: Meta's catalogue takes no WebP (dispatch/merchant/photo.ts refuses one before any upload).
  storage_path text not null unique check (storage_path ~ '^merchant/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg)$'),
  origin_hash text not null check (origin_hash ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  bytes integer not null check (bytes >= 0),
  -- The language of the caption: the tap's answer is in it.
  lang text not null check (lang in ('ar', 'en', 'fr', 'arabizi')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (member_id, item_id)
);
create index merchant_item_photo_pending_expiry_idx on app_private.merchant_item_photo_pending (expires_at);
alter table app_private.merchant_item_photo_pending enable row level security;
revoke all on app_private.merchant_item_photo_pending from public, anon, authenticated;

-- Who may set an item's photo: an active owner or manager of the item's shop (as for every menu change), an item still
-- on the menu, a shop that is not a demo shop (their photos come from the demo pipeline and go at the claim, §39.12).
-- Answers {status: ok, vendor_id, item_name}, or no_item, not_allowed, demo_shop.
create function app_private.merchant_item_photo_check(p_member_id uuid, p_item_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_removed timestamptz;
  v_name text;
begin
  select i.vendor_id, i.removed_at, coalesce(i.name_ar, i.name_en, i.name_fr) into v_vendor, v_removed, v_name
  from public.menu_items i where i.id = p_item_id;
  if v_vendor is null or v_removed is not null then
    return jsonb_build_object('status', 'no_item');
  end if;
  if p_member_id is null or not exists (select 1 from public.vendor_members m where m.id = p_member_id and m.vendor_id = v_vendor
      and m.status = 'active' and m.role in ('owner', 'manager')) then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  if app_private.vendor_is_demo(v_vendor) then
    return jsonb_build_object('status', 'demo_shop');
  end if;
  return jsonb_build_object('status', 'ok', 'vendor_id', v_vendor, 'item_name', v_name);
end;
$$;
revoke all on function app_private.merchant_item_photo_check(uuid, uuid) from public, anon, authenticated;

-- Where a new photo is uploaded: a fresh name under the shop, merchant/<shop>/<pending id>.<ext>. Answers
-- {status: ok, vendor_id, item_name, pending_id, path}, or a refusal of merchant_item_photo_check, or bad_format.
create function public.merchant_item_photo_path(p_member_id uuid, p_item_id uuid, p_ext text) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v jsonb := app_private.merchant_item_photo_check(p_member_id, p_item_id);
  v_id uuid := gen_random_uuid();
begin
  if v ->> 'status' <> 'ok' then
    return v;
  end if;
  if coalesce(p_ext, '') not in ('jpg', 'png') then
    return jsonb_build_object('status', 'bad_format');
  end if;
  return v || jsonb_build_object('pending_id', v_id, 'path', 'merchant/' || (v ->> 'vendor_id') || '/' || v_id || '.' || p_ext);
end;
$$;
revoke all on function public.merchant_item_photo_path(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.merchant_item_photo_path(uuid, uuid, text) to service_role;

-- The uploaded photo, waiting for the tap. Answers {status: ok, replaced} (the file of a photo of the same item this
-- member sent before and never confirmed, for the caller to delete), or a refusal (bad_path, bad_hash, bad_size, bad_lang
-- or one of merchant_item_photo_check's).
create function public.merchant_item_photo_pending(p_member_id uuid, p_pending_id uuid, p_item_id uuid, p_storage_path text,
  p_origin_hash text, p_width integer, p_height integer, p_bytes integer, p_lang text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := app_private.merchant_item_photo_check(p_member_id, p_item_id);
  v_old text;
begin
  if v ->> 'status' <> 'ok' then
    return v;
  end if;
  if p_pending_id is null or p_storage_path is null
     or p_storage_path !~ ('^merchant/' || (v ->> 'vendor_id') || '/' || p_pending_id || '\.(png|jpg)$') then
    return jsonb_build_object('status', 'bad_path');
  end if;
  if p_origin_hash is null or p_origin_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'bad_hash');
  end if;
  if coalesce(p_width, 0) not between 1 and 20000 or coalesce(p_height, 0) not between 1 and 20000 or coalesce(p_bytes, -1) < 0 then
    return jsonb_build_object('status', 'bad_size');
  end if;
  if coalesce(p_lang, '') not in ('ar', 'en', 'fr', 'arabizi') then
    return jsonb_build_object('status', 'bad_lang');
  end if;
  select storage_path into v_old from app_private.merchant_item_photo_pending
  where member_id = p_member_id and item_id = p_item_id for update;
  insert into app_private.merchant_item_photo_pending (id, member_id, vendor_id, item_id, storage_path, origin_hash, width,
    height, bytes, lang, expires_at)
  values (p_pending_id, p_member_id, (v ->> 'vendor_id')::uuid, p_item_id, p_storage_path, p_origin_hash, p_width, p_height,
    p_bytes, p_lang, now() + make_interval(hours => public.config_numeric('merchant_photo_pending_hours')::integer))
  on conflict (member_id, item_id) do update
    set id = excluded.id, storage_path = excluded.storage_path, origin_hash = excluded.origin_hash, width = excluded.width,
        height = excluded.height, bytes = excluded.bytes, lang = excluded.lang, created_at = now(),
        expires_at = excluded.expires_at;
  return jsonb_build_object('status', 'ok', 'replaced', case when v_old is distinct from p_storage_path then v_old end);
end;
$$;
revoke all on function public.merchant_item_photo_pending(uuid, uuid, uuid, text, text, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.merchant_item_photo_pending(uuid, uuid, uuid, text, text, integer, integer, integer, text)
  to service_role;

-- The merchant's tap: the pending photo becomes the item's own (source merchant), replacing any photo before it (a demo
-- photo, or the merchant's earlier one); the photo trigger queues the shop's catalogue sync, which runs the validator
-- again. p_member_ids: the tapping phone's owner and manager memberships; only the member who sent the photo confirms
-- it. Answers {status: ok, item_name, lang, previous} (the replaced file, for the caller to delete), or not_found,
-- not_allowed (the photo waits), expired / no_item / demo_shop with the photo's path (the row is gone, the caller
-- deletes the file).
create function public.merchant_item_photo_confirm(p_pending_id uuid, p_member_ids uuid[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p app_private.merchant_item_photo_pending%rowtype;
  v jsonb;
  v_prev text;
begin
  select * into v_p from app_private.merchant_item_photo_pending where id = p_pending_id for update;
  if v_p.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not (v_p.member_id = any (coalesce(p_member_ids, '{}'))) then
    return jsonb_build_object('status', 'not_allowed', 'lang', v_p.lang);
  end if;
  delete from app_private.merchant_item_photo_pending where id = v_p.id;
  if v_p.expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'lang', v_p.lang, 'path', v_p.storage_path);
  end if;
  v := app_private.merchant_item_photo_check(v_p.member_id, v_p.item_id);
  if v ->> 'status' <> 'ok' then
    return v || jsonb_build_object('lang', v_p.lang, 'path', v_p.storage_path);
  end if;
  perform set_config('app.actor_kind', 'whatsapp', true);
  perform set_config('app.audit_reason', 'merchant item photo by WhatsApp, confirmed (DECISIONS §39.15.4)', true);
  select storage_path into v_prev from public.menu_item_photos where item_id = v_p.item_id;
  insert into public.menu_item_photos (item_id, vendor_id, storage_path, source, origin_hash, license, credit, source_url,
    width, height, bytes)
  values (v_p.item_id, v_p.vendor_id, v_p.storage_path, 'merchant', v_p.origin_hash, null, null, null,
    v_p.width, v_p.height, v_p.bytes)
  on conflict (item_id) do update set storage_path = excluded.storage_path, source = 'merchant', origin_hash = excluded.origin_hash,
    license = null, credit = null, source_url = null, width = excluded.width, height = excluded.height, bytes = excluded.bytes;
  return jsonb_build_object('status', 'ok', 'item_name', v ->> 'item_name', 'lang', v_p.lang,
    'previous', case when v_prev is distinct from v_p.storage_path and v_prev like 'merchant/%' then v_prev end);
end;
$$;
revoke all on function public.merchant_item_photo_confirm(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.merchant_item_photo_confirm(uuid, uuid[]) to service_role;

-- Pending photos nobody tapped in time: the rows go and their files' paths are returned for the caller to delete.
create function public.merchant_item_photo_pending_expired(p_limit integer default 20) returns text[]
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from app_private.merchant_item_photo_pending p
    where p.id in (select x.id from app_private.merchant_item_photo_pending x where x.expires_at <= now()
                   order by x.expires_at limit least(greatest(coalesce(p_limit, 20), 1), 100)
                   for update skip locked)
    returning p.storage_path
  )
  select coalesce(array_agg(storage_path), '{}') from gone;
$$;
revoke all on function public.merchant_item_photo_pending_expired(integer) from public, anon, authenticated;
grant execute on function public.merchant_item_photo_pending_expired(integer) to service_role;

-- Every shop is checked once against the rules: each shop is queued (not forced: only what changed is sent, so Meta
-- does not review every product again), its holds are recorded and what breaks a rule is hidden. Like the item-content
-- re-sync it waits 15 minutes, so the dispatch that knows the rules is deployed before it runs (the deploy applies
-- migrations before functions).
select app_private.catalog_enqueue_all(false, 'catalogue rules (session 5f part 9)');
update app_private.catalog_sync_queue set next_at = greatest(next_at, now() + interval '15 minutes')
where reason = 'catalogue rules (session 5f part 9)';
