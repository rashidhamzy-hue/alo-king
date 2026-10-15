-- Rollback of 20261015220000_demo_mode.sql: back to the test shop only. Item photos are dropped (their Storage objects
-- in menu-item-photos stay until the bucket is emptied by hand); the search functions get their old signatures back.
begin;
-- Demo mode off first, as the staging fixture does for a shop that leaves the list: the shops go back to unclaimed seed
-- listings (their demo menu removed when they never had an order), so no orderable shop is left without the guard.
select set_config('app.actor_kind', 'system', true);
select set_config('app.audit_reason', 'rollback of demo mode (DECISIONS §39.12)', true);
insert into public.app_config (key, value, effective_from, note, created_by)
select 'demo_shops', '[]', now(), 'rollback of 20261015220000_demo_mode.sql', null
where coalesce(jsonb_array_length(public.config_value('demo_shops')), 0) > 0;
update public.vendor_members m set status = 'revoked'
from public.vendors v where v.id = m.vendor_id and v.field_sources ? 'demo' and m.status <> 'revoked'
  and (m.phone_e164 in (select o.phone_e164 from app_private.owner_phones o) or app_private.is_sim_phone(m.phone_e164));
update public.vendor_order_channels c set enabled = false from public.vendors v where v.id = c.vendor_id and v.field_sources ? 'demo';
update public.vendor_private p set owner_mobile = null, kitchen_whatsapp = null from public.vendors v
where v.id = p.vendor_id and v.field_sources ? 'demo';
delete from public.menu_items i using public.vendors v where v.id = i.vendor_id and v.field_sources ? 'demo'
  and not exists (select 1 from public.order_items oi join public.menu_items x on x.id = oi.item_id where x.vendor_id = v.id);
delete from public.menu_sections s using public.vendors v where v.id = s.vendor_id and v.field_sources ? 'demo'
  and not exists (select 1 from public.menu_items i where i.section_id = s.id);
update public.vendors set orderable = false, claim_status = 'unclaimed', field_sources = field_sources - 'demo' - 'demo_menu'
where field_sources ? 'demo';

drop trigger if exists vendors_drop_demo_photos on public.vendors;
drop trigger if exists outbound_messages_demo_guard on public.outbound_messages;
drop function if exists public.sim_demo(text, text, boolean);
drop function if exists public.sim_demo_reset();
drop function if exists app_private.vendors_drop_demo_photos();
drop function if exists public.menu_item_photo_set(uuid, text, text, text);
drop function if exists public.demo_photos_todo(integer);
drop table if exists app_private.demo_item_sources;
drop function if exists app_private.outbound_demo_guard();

create or replace function public.catalog_desired(p_vendor_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'retailer_id', i.id,
      'name', left(case when i.name_ar is not null and i.name_en is not null and i.name_ar <> i.name_en
                        then i.name_ar || ' · ' || i.name_en else coalesce(i.name_ar, i.name_en, i.name_fr) end, 150),
      'name_en', i.name_en,
      'description', left(coalesce(nullif(i.description, ''), s.name_en, s.name_ar, coalesce(v.name_en, v.name_ar)),
                          case when i.pricing_unit = 'kg' then 450 else 500 end)
                     || case when i.pricing_unit = 'kg' then ' (≈ ' || i.est_weight_kg || ' kg, final by weight)' else '' end,
      'price_minor', round(case when i.pricing_unit = 'kg' then i.price_usd * i.est_weight_kg else i.price_usd end * 100)::int,
      'currency', 'USD',
      'availability', case when app_private.menu_item_orderable(i.id, 1) then 'in stock' else 'out of stock' end,
      'product_set', v.id,
      'brand', left(coalesce(v.name_en, v.name_ar), 100),
      'has_options', exists (select 1 from public.menu_option_groups g where g.item_id = i.id),
      'section', coalesce(s.name_ar, s.name_en, 'Menu'),
      'section_en', coalesce(s.name_en, s.name_ar, 'Menu'),
      'photo', (select p.storage_path from public.vendor_photos p where p.vendor_id = v.id and p.status = 'confirmed'
                order by p.sort_order, p.created_at limit 1))
    order by s.sort_order nulls last, i.sort_order, i.id), '[]')
  from public.menu_items i
  join public.vendors v on v.id = i.vendor_id
  left join public.menu_sections s on s.id = i.section_id
  where i.vendor_id = p_vendor_id and v.claim_status = 'claimed' and v.orderable and v.listing_status = 'active';
$$;

create or replace function public.catalog_image(p_item_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name_ar', i.name_ar, 'name_en', coalesce(i.name_en, i.name_fr),
    'vendor', coalesce(v.name_en, v.name_ar), 'vendor_ar', v.name_ar,
    'hash', (select c.content_hash from public.catalog_sync_items c where c.item_id = i.id),
    'vendor_id', v.id,
    'photo', (select p.storage_path from public.vendor_photos p where p.vendor_id = v.id and p.status = 'confirmed'
              order by p.sort_order, p.created_at limit 1))
  from public.menu_items i join public.vendors v on v.id = i.vendor_id
  -- Only an item of the catalogue (synced, or of a shop that syncs) is ever drawn: nothing else is reachable here.
  where i.id = p_item_id and v.claim_status = 'claimed' and v.listing_status = 'active'
    and (v.orderable or exists (select 1 from public.catalog_sync_items c where c.item_id = i.id));
$$;

drop table if exists public.menu_item_photos;

create or replace function app_private.order_card_payload(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id, 'code', o.code, 'status', o.status, 'fulfilment', o.fulfilment,
    'payment_method', o.payment_method, 'total_usd', o.total_usd, 'total_lbp', o.total_lbp, 'usd_lbp_rate', o.usd_lbp_rate,
    'estimated', o.weight_status in ('awaiting_weight', 'awaiting_customer'), 'is_new_customer', o.is_new_customer,
    'customer_note', o.customer_note, 'prep_minutes', o.prep_minutes,
    'is_gift', o.is_gift, 'recipient_name', o.recipient_name, 'recipient_phone', o.recipient_phone, 'allergy_note', o.allergy_note,
    'area_en', p.name_en, 'area_ar', p.name_ar,
    'vendor_name', coalesce(v.name_ar, v.name_en),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i.name_ar, i.name_en), 'name_en', i.name_en,
        'quantity', i.quantity, 'options', (select coalesce(jsonb_agg(coalesce(x ->> 'name_ar', x ->> 'name_en')), '[]') from jsonb_array_elements(i.options) x),
        'kg', i.est_weight_kg, 'has_empty', i.has_empty, 'note', i.note) order by i.created_at, i.id)
      from public.order_items i where i.order_id = o.id), '[]')
  )
  from public.orders o
  join public.vendors v on v.id = o.vendor_id
  left join public.places p on p.id = o.delivery_place_id
  where o.id = p_order_id;
$$;

create or replace function app_private.menu_draft_approve_section(p_draft_id uuid, p_index integer, p_member_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_d public.menu_drafts%rowtype;
  v_s jsonb;
  v_item jsonb;
  v_opt jsonb;
  v_choice jsonb;
  v_section uuid;
  v_new_item uuid;
  v_group uuid;
  v_price numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_inserted int := 0;
  v_needs jsonb := '[]';
  v_sort int;
begin
  select * into v_d from public.menu_drafts where id = p_draft_id for update;
  if v_d.id is null or v_d.status in ('approved', 'discarded') then
    return jsonb_build_object('status', coalesce(v_d.status, 'unknown'));
  end if;
  perform app_private.menu_editor(v_d.vendor_id, p_member_id);
  v_s := case when p_index >= 0 then v_d.sections -> p_index end;
  if v_s is null then
    raise exception 'no section %', p_index using errcode = 'invalid_parameter_value';
  end if;
  if coalesce((v_s ->> 'approved')::boolean, false) then
    return jsonb_build_object('status', 'already_approved');
  end if;
  perform set_config('app.actor_kind', case when (select auth.uid()) is null then 'whatsapp' else 'user' end, true);
  perform set_config('app.audit_reason', 'menu draft ' || p_draft_id || ' section ' || p_index || ' approved by the merchant', true);
  select coalesce(max(sort_order), 0) + 10 into v_sort from public.menu_sections where vendor_id = v_d.vendor_id;
  for v_item in select * from jsonb_array_elements(v_s -> 'items') loop
    v_price := case
      when jsonb_typeof(v_item -> 'price') <> 'number' then null
      when v_item ->> 'currency' = 'USD' then round((v_item ->> 'price')::numeric, 2)
      when v_item ->> 'currency' = 'LBP' then round((v_item ->> 'price')::numeric / v_rate, 2)
      else null end;
    -- A positive price that rounds to $0.00 is a misread (e.g. a USD price marked LBP): ask, never sell at 0.
    if v_price = 0 and (v_item ->> 'price')::numeric > 0 then
      v_price := null;
    end if;
    -- An option with a price but no currency (its own or the item's) is as unclear as the item's own price.
    if v_price is null or exists (
      select 1 from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) o, jsonb_array_elements(coalesce(o -> 'choices', '[]')) c
      where jsonb_typeof(c -> 'price') = 'number' and (c ->> 'price')::numeric > 0
        and coalesce(c ->> 'currency', v_item ->> 'currency') is null) then
      v_needs := v_needs || jsonb_build_array(left(coalesce(v_item ->> 'name_ar', v_item ->> 'name_en', v_item ->> 'name_fr'), 60));
      continue;
    end if;
    if v_section is null then
      insert into public.menu_sections (vendor_id, name_ar, name_en, name_fr, sort_order)
      values (v_d.vendor_id, left(v_s ->> 'name_ar', 80), left(v_s ->> 'name_en', 80),
              coalesce(left(v_s ->> 'name_fr', 80), case when v_s ->> 'name_ar' is null and v_s ->> 'name_en' is null then 'Menu' end), v_sort)
      returning id into v_section;
    end if;
    insert into public.menu_items (vendor_id, section_id, name_ar, name_en, name_fr, description, price_usd, sort_order)
    values (v_d.vendor_id, v_section, left(v_item ->> 'name_ar', 120), left(v_item ->> 'name_en', 120), left(v_item ->> 'name_fr', 120),
            left(v_item ->> 'description', 500), v_price, v_inserted * 10)
    returning id into v_new_item;
    v_inserted := v_inserted + 1;
    for v_opt in select * from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) loop
      insert into public.menu_option_groups (item_id, name_ar, name_en, min_select, max_select)
      values (v_new_item, case when (v_opt ->> 'name') ~ '[؀-ۿ]' then left(v_opt ->> 'name', 60) end,
              case when (v_opt ->> 'name') !~ '[؀-ۿ]' then left(coalesce(v_opt ->> 'name', 'Options'), 60) end,
              least(greatest(coalesce((v_opt ->> 'min')::int, 0), 0), 10),
              least(greatest(coalesce((v_opt ->> 'max')::int, 1), greatest(coalesce((v_opt ->> 'min')::int, 0), 1)), 20))
      returning id into v_group;
      for v_choice in select * from jsonb_array_elements(coalesce(v_opt -> 'choices', '[]')) loop
        insert into public.menu_options (group_id, name_ar, name_en, price_delta_usd)
        values (v_group, case when (v_choice ->> 'name') ~ '[؀-ۿ]' then left(v_choice ->> 'name', 60) end,
                case when (v_choice ->> 'name') !~ '[؀-ۿ]' then left(coalesce(v_choice ->> 'name', '?'), 60) end,
                case when jsonb_typeof(v_choice -> 'price') <> 'number' then 0
                     when coalesce(v_choice ->> 'currency', v_item ->> 'currency') = 'LBP' then round((v_choice ->> 'price')::numeric / v_rate, 2)
                     when coalesce(v_choice ->> 'currency', v_item ->> 'currency') = 'USD' then round((v_choice ->> 'price')::numeric, 2)
                     else 0 end);
      end loop;
    end loop;
  end loop;
  update public.menu_drafts set
    sections = jsonb_set(sections, array[p_index::text, 'approved'], 'true'),
    status = case when (select bool_and(coalesce((s ->> 'approved')::boolean, false) or ord - 1 = p_index)
                        from jsonb_array_elements(sections) with ordinality x (s, ord)) then 'approved' else 'partly_approved' end
  where id = p_draft_id;
  return jsonb_build_object('status', 'approved', 'section_id', v_section, 'inserted', v_inserted, 'needs_price', v_needs);
end;
$$;

create or replace function app_private.offer_alternatives(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_o public.orders%rowtype;
  v_rows jsonb;
  v_refs jsonb := '{}';
  v_i integer := 0;
  v_v record;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.id is null or v_o.delivery_pin is null then
    return '[]';
  end if;
  v_rows := '[]';
  for v_v in
    select s.vendor_id, s.name_ar, s.name_en from public.vendor_search(null, extensions.st_y(v_o.delivery_pin::extensions.geometry),
      extensions.st_x(v_o.delivery_pin::extensions.geometry),
      (select v.business_type from public.vendors v where v.id = v_o.vendor_id), null, 10) s
    where s.vendor_id <> v_o.vendor_id and s.is_open
    limit 3
  loop
    v_i := v_i + 1;
    v_refs := v_refs || jsonb_build_object('v' || v_i, jsonb_build_object('id', v_v.vendor_id, 'label', left(coalesce(v_v.name_en, v_v.name_ar), 60)));
    v_rows := v_rows || jsonb_build_object('ref', 'v' || v_i, 'name_ar', v_v.name_ar, 'name_en', v_v.name_en);
  end loop;
  if v_i > 0 then
    update public.bot_sessions s set refs = (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(s.refs) e(k, v) where k !~ '^v\d+$') || v_refs
    where s.customer_id = v_o.customer_id;
  end if;
  return v_rows;
end;
$$;

create or replace function public.catalog_search(p_customer_id uuid, p_query text, p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_x jsonb := public.search_expand(p_query);
  v_terms text[];
  v_groups jsonb := v_x -> 'groups';
  v_attrs text[];
  v_cats text[];
  v_pt jsonb := public.customer_search_point(p_customer_id);
  v_point extensions.geography;
  v_place text;
  v_max numeric := public.max_delivery_km();
  v_items jsonb;
begin
  select coalesce(array_agg(t), '{}') into v_terms from jsonb_array_elements_text(v_x -> 'terms') t;
  select coalesce(array_agg(t), '{}') into v_attrs from jsonb_array_elements_text(v_x -> 'attributes') t;
  select coalesce(array_agg(t), '{}') into v_cats from jsonb_array_elements_text(v_x -> 'categories') t;
  if cardinality(v_terms) = 0 and cardinality(v_cats) = 0 and cardinality(v_attrs) = 0 then
    return jsonb_build_object('status', 'no_words', 'expand', v_x, 'items', '[]'::jsonb);
  end if;
  if v_pt is not null then
    v_point := app_private.lat_lon_point((v_pt ->> 'lat')::float8, (v_pt ->> 'lon')::float8);
    select a.place_id into v_place from public.addresses a where a.id = (v_pt ->> 'address_id')::uuid;
  end if;
  with cand as (
    select c.*, v.name_ar as v_ar, v.name_en as v_en, v.is_test,
      not (v.paused_until is not null and v.paused_until > now()) as is_open,
      case when v_point is not null then extensions.st_distance(v.location, v_point) / 1000.0 end as km,
      least(coalesce(v.delivery_radius_km, v_max), v_max) as limit_km,
      greatest(
        -- Every concept counts: the mean over the query's groups of the best match in each (names first, the wider doc
        -- at 0.9), so an item answering one word of two scores about half.
        coalesce((select avg(greatest(
            coalesce((select max(extensions.word_similarity(t, c.names)) from jsonb_array_elements_text(g) t), 0),
            0.9 * coalesce((select max(extensions.word_similarity(t, c.doc)) from jsonb_array_elements_text(g) t), 0)))
          from jsonb_array_elements(v_groups) g), 0),
        -- Descriptive words alone ("bade shi 7arr w rkhis", "akel lal wled"): every item that fits them.
        case when cardinality(v_terms) = 0 and (cardinality(v_cats) = 0 or c.dish_category = any (v_cats)
               or ('kids' = any (v_attrs) and c.names ~ '(sandwich|burger|pizza|fries|nuggets|سندويش|برغر|بيتزا|بطاطا|ناغتس)')
               or ('sweet' = any (v_attrs) and c.doc ~ '(sweet|dessert|حلو|حلويات|كنافه|knefe|cake|كيك)')) then 0.6 else 0 end
      )::real as score
    from app_private.catalog_docs c
    join public.vendors v on v.id = c.vendor_id
    where app_private.menu_item_orderable(c.item_id, 1)
  ),
  kept as (
    select * from cand
    where score >= 0.5
      and (v_point is null or is_test or (km <= limit_km and (v_place is null or app_private.place_delivered_to(v_place))))
      and (not ('spicy' = any (v_attrs)) or spicy_level > 0 or doc ~ '(حار|spicy|piquant|harr)')
      and (not ('diet' = any (v_attrs)) or doc ~ '(diet|zero|light|دايت)')

  )
  select coalesce(jsonb_agg(jsonb_build_object('item_id', k.item_id, 'vendor_id', k.vendor_id,
      'name_ar', k.name_ar, 'name_en', coalesce(k.name_en, k.name_fr, k.name_ar), 'price_usd', k.price_usd,
      'vendor_ar', k.v_ar, 'vendor_en', coalesce(k.v_en, k.v_ar), 'is_open', k.is_open,
      'km', round(k.km::numeric, 1), 'score', round(k.score::numeric, 3))
      order by k.is_open desc,
        case when 'cheap' = any (v_attrs) then k.price_usd end asc nulls last,
        k.score desc, k.km nulls last, k.price_usd, k.item_id), '[]'::jsonb)
    into v_items
  from (select * from kept order by is_open desc, case when 'cheap' = any (v_attrs) then price_usd end asc nulls last,
          score desc, km nulls last, price_usd, item_id
        limit least(greatest(coalesce(p_limit, 10), 1), 10)) k;
  return jsonb_build_object('status', case when jsonb_array_length(v_items) > 0 then 'ok' else 'none' end,
    'expand', v_x, 'items', v_items, 'has_point', v_pt is not null);
end;
$$;

drop function if exists public.vendor_search(text, double precision, double precision, public.business_type, text, integer, uuid);
create function public.vendor_search(
  p_query text default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_business_type public.business_type default null,
  p_cuisine text default null,
  p_limit integer default 5
)
returns table (
  vendor_id uuid, name_ar text, name_en text, business_type public.business_type, cuisine_tags text[],
  is_open boolean, paused_until timestamptz, straight_km numeric, vendor_lat double precision, vendor_lon double precision,
  matched text, score real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select nullif(app_private.normalize_place_name(coalesce(p_query, '')), '') as n,
           case when p_lat is not null and p_lon is not null then app_private.lat_lon_point(p_lat, p_lon) end as pt,
           public.max_delivery_km() as max_km
  ),
  base as (
    select v.*, q.n, q.pt,
      case when q.pt is not null then extensions.st_distance(v.location, q.pt) / 1000.0 end as km,
      least(coalesce(v.delivery_radius_km, q.max_km), q.max_km) as limit_km
    from public.vendors v cross join q
    where v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.delivery_enabled
      and (p_business_type is null or v.business_type = p_business_type)
      and (p_cuisine is null or p_cuisine = any (v.cuisine_tags))
  ),
  scored as (
    select b.*,
      case when b.n is null then 0.5::real else greatest(
        extensions.word_similarity(b.n, app_private.normalize_place_name(coalesce(b.name_ar, '') || ' ' || coalesce(b.name_en, '') || ' ' || coalesce(b.name_fr, ''))),
        case when exists (select 1 from unnest(b.cuisine_tags) t where b.n like '%' || replace(t, '_', ' ') || '%'
                          or replace(t, '_', ' ') like '%' || b.n || '%') then 0.8 else 0 end,
        0.9 * coalesce((select max(extensions.word_similarity(b.n, app_private.normalize_place_name(
                 coalesce(i.name_ar, '') || ' ' || coalesce(i.name_en, '') || ' ' || coalesce(i.name_fr, ''))))
               from public.menu_items i where i.vendor_id = b.id and i.available), 0)
      )::real end as sc,
      case when b.n is null then 'nearby'
           when extensions.word_similarity(b.n, app_private.normalize_place_name(coalesce(b.name_ar, '') || ' ' || coalesce(b.name_en, ''))) >= 0.6 then 'name'
           when exists (select 1 from unnest(b.cuisine_tags) t where b.n like '%' || replace(t, '_', ' ') || '%') then 'cuisine'
           else 'dish' end as why
    from base b
    where b.pt is null or b.km <= b.limit_km or b.is_test
  )
  select s.id, s.name_ar, s.name_en, s.business_type, s.cuisine_tags,
    not (s.paused_until is not null and s.paused_until > now()), s.paused_until, round(s.km::numeric, 2),
    extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry), s.why, s.sc
  from scored s
  where s.n is null or s.sc >= 0.35
  order by (s.paused_until is not null and s.paused_until > now()), s.sc desc, s.km nulls last, s.id
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

drop function if exists public.vendor_search_pickup(double precision, double precision, integer, uuid);
create function public.vendor_search_pickup(
  p_lat double precision,
  p_lon double precision,
  p_limit integer default 10
)
returns table (
  vendor_id uuid, name_ar text, name_en text, business_type public.business_type, cuisine_tags text[],
  is_open boolean, paused_until timestamptz, straight_km numeric, vendor_lat double precision, vendor_lon double precision,
  matched text, score real
)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select app_private.lat_lon_point(p_lat, p_lon) as pt, public.config_numeric('pickup_search_km') as max_km),
  base as (
    select v.*, extensions.st_distance(v.location, q.pt) / 1000.0 as km, q.max_km
    from public.vendors v cross join q
    where p_lat is not null and p_lon is not null
      and v.orderable and v.listing_status = 'active' and v.claim_status = 'claimed' and v.pickup_enabled
  )
  select b.id, b.name_ar, b.name_en, b.business_type, b.cuisine_tags,
    not (b.paused_until is not null and b.paused_until > now()), b.paused_until, round(b.km::numeric, 2),
    extensions.st_y(b.location::extensions.geometry), extensions.st_x(b.location::extensions.geometry), 'nearby'::text, 0.5::real
  from base b
  where b.km <= b.max_km
  order by (b.paused_until is not null and b.paused_until > now()), b.km, b.id
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
$$;

revoke all on function public.vendor_search(text, double precision, double precision, public.business_type, text, integer),
  public.vendor_search_pickup(double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public.vendor_search(text, double precision, double precision, public.business_type, text, integer),
  public.vendor_search_pickup(double precision, double precision, integer) to service_role;

drop function if exists app_private.customer_hidden_vendors(uuid);
drop table if exists app_private.sim_demo_customers;
drop function if exists app_private.vendor_is_demo(uuid);
drop function if exists app_private.demo_vendor_ids();
commit;
