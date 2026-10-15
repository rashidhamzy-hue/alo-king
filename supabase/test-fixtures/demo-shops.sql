-- STAGING ONLY (DECISIONS §39.12, demo mode). Never applied by the migration job and never run at the production cut-over:
-- the cut-over checks that config demo_shops is empty on production. The staging deploy runs it after
-- alo-test-grill.sql, with the menu overrides built by scripts/demo/build-demo-menus.ts:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -v demo=on -v demo_csv=<file> -f supabase/test-fixtures/demo-shops.sql
-- Without -v demo=on it changes nothing.
-- Safe to run again.
--
-- What it does (Rasheed, 15 October: every shop on staging with a menu, growing as menus are added):
--   * the demo shops are every real seed shop whose menu has at least one priced item (27 on 15 October, Eatout included);
--     the menu is the seed draft, or the full harvested one for the shops demo-shops.json lists (Deli Dough, J.O'S);
--   * writes the dated config row demo_shops (a new row only when the list changed);
--   * makes each one claimed, orderable and active on staging, marked field_sources.demo, so it shows in search, the
--     smart list menu and the catalogue (and syncs to the Meta catalogue once it is connected, #181);
--   * publishes its menu once (Deli Dough 350 items, J.O'S 52 from the harvest), LBP prices converted at the dated rate exactly as a merchant's approval does
--     (menu_draft_approve_section), without touching the draft; a changed source is published again while the shop has
--     never had an order;
--   * makes the owner's phone (app_private.owner_phones) its owner, kitchen WhatsApp and primary order channel, so every
--     order card goes to Rasheed; the shop's own numbers stay on record and are never used (the outbound guard of
--     20261015220000_demo_mode.sql reroutes anything else);
--   * puts a shop that is no longer a demo shop back as an unclaimed, not orderable seed listing; a shop without a priced
--     menu keeps its "Not on Alo King yet" listing (§39.3).

\set ON_ERROR_STOP on
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'staging demo shops (DECISIONS §39.12)', false);

drop table if exists demo_in;
drop table if exists demo_shops_now;
create temp table demo_in (place_id text, name text, menu text, sections text, source_url text) on commit drop;
select set_config('app.demo_fixture', 'off', false);
\if :{?demo}
select set_config('app.demo_fixture', :'demo', false);
\endif
\if :{?demo_csv}
-- psql does not expand variables inside \copy: build the command first.
\set demo_copy '\\copy demo_in from ' :'demo_csv' ' with (format csv, header true)'
:demo_copy
\else
\echo 'demo shops: no menu overrides given (-v demo_csv=...)'
\endif

-- One shop's menu from draft sections: the conversion of app_private.menu_draft_approve_section (USD as is, LBP at the
-- dated rate, a price that rounds to $0 or an option price without a currency hides the item), plus the shop's own item
-- image (Fred's Food), kept for the demo-photos script.
create or replace function pg_temp.demo_publish(p_vendor uuid, p_sections jsonb) returns integer
language plpgsql
as $$
declare
  v_s jsonb;
  v_item jsonb;
  v_opt jsonb;
  v_choice jsonb;
  v_section uuid;
  v_new uuid;
  v_group uuid;
  v_price numeric;
  v_rate numeric := public.usd_lbp_rate();
  v_sort int := 0;
  v_n int;
  v_total int := 0;
begin
  for v_s in select * from jsonb_array_elements(p_sections) loop
    v_sort := v_sort + 10;
    v_section := null;
    v_n := 0;
    for v_item in select * from jsonb_array_elements(coalesce(v_s -> 'items', '[]')) loop
      v_price := case
        when jsonb_typeof(v_item -> 'price') <> 'number' then null
        when v_item ->> 'currency' = 'USD' then round((v_item ->> 'price')::numeric, 2)
        when v_item ->> 'currency' = 'LBP' then round((v_item ->> 'price')::numeric / v_rate, 2)
        else null end;
      if v_price = 0 and (v_item ->> 'price')::numeric > 0 then
        v_price := null;
      end if;
      if v_price is null or coalesce(v_item ->> 'name_ar', v_item ->> 'name_en', v_item ->> 'name_fr') is null or exists (
        select 1 from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) o, jsonb_array_elements(coalesce(o -> 'choices', '[]')) c
        where jsonb_typeof(c -> 'price') = 'number' and (c ->> 'price')::numeric > 0
          and coalesce(c ->> 'currency', v_item ->> 'currency') is null) then
        continue;
      end if;
      if v_section is null then
        insert into public.menu_sections (vendor_id, name_ar, name_en, name_fr, sort_order)
        values (p_vendor, left(v_s ->> 'name_ar', 80), left(v_s ->> 'name_en', 80),
                coalesce(left(v_s ->> 'name_fr', 80), case when v_s ->> 'name_ar' is null and v_s ->> 'name_en' is null then 'Menu' end), v_sort)
        returning id into v_section;
      end if;
      insert into public.menu_items (vendor_id, section_id, name_ar, name_en, name_fr, description, price_usd, sort_order)
      values (p_vendor, v_section, left(v_item ->> 'name_ar', 120), left(v_item ->> 'name_en', 120), left(v_item ->> 'name_fr', 120),
              left(coalesce(v_item ->> 'description', v_item ->> 'unit'), 500), v_price, v_n * 10)
      returning id into v_new;
      v_n := v_n + 1;
      v_total := v_total + 1;
      if (v_item ->> 'image_url') ~ '^https://' and char_length(v_item ->> 'image_url') <= 500 then
        insert into app_private.demo_item_sources (item_id, image_url) values (v_new, v_item ->> 'image_url');
      end if;
      for v_opt in select * from jsonb_array_elements(coalesce(v_item -> 'options', '[]')) loop
        if jsonb_array_length(coalesce(v_opt -> 'choices', '[]')) = 0 then
          continue;
        end if;
        insert into public.menu_option_groups (item_id, name_ar, name_en, min_select, max_select)
        values (v_new, case when (v_opt ->> 'name') ~ '[؀-ۿ]' then left(v_opt ->> 'name', 60) end,
                case when (v_opt ->> 'name') !~ '[؀-ۿ]' then left(coalesce(v_opt ->> 'name', 'Options'), 60) end,
                least(greatest(coalesce((v_opt ->> 'min')::int, 0), 0), 10),
                least(greatest(coalesce((v_opt ->> 'max')::int, 1), greatest(coalesce((v_opt ->> 'min')::int, 0), 1)), 20))
        returning id into v_group;
        for v_choice in select * from jsonb_array_elements(v_opt -> 'choices') loop
          insert into public.menu_options (group_id, name_ar, name_en, price_delta_usd)
          values (v_group, case when (v_choice ->> 'name') ~ '[؀-ۿ]' then left(v_choice ->> 'name', 60) end,
                  case when (v_choice ->> 'name') !~ '[؀-ۿ]' then left(coalesce(v_choice ->> 'name', '?'), 60) end,
                  case when coalesce(jsonb_typeof(v_choice -> 'price'), 'null') <> 'number' then 0
                       when coalesce(v_choice ->> 'currency', v_item ->> 'currency') = 'LBP' then round((v_choice ->> 'price')::numeric / v_rate, 2)
                       when coalesce(v_choice ->> 'currency', v_item ->> 'currency') = 'USD' then round((v_choice ->> 'price')::numeric, 2)
                       else 0 end);
        end loop;
      end loop;
    end loop;
  end loop;
  return v_total;
end;
$$;

-- A draft with at least one priced item (the rule that makes a shop a demo shop).
create or replace function pg_temp.demo_priced(p_sections jsonb) returns boolean
language sql immutable
as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_sections, '[]')) s, jsonb_array_elements(coalesce(s -> 'items', '[]')) i
                 where jsonb_typeof(i -> 'price') = 'number' and (i ->> 'price')::numeric > 0 and i ->> 'currency' in ('USD', 'LBP'));
$$;

do $$
declare
  r record;
  v public.vendors%rowtype;
  v_list jsonb := '[]';
  v_ids uuid[] := '{}';
  v_md5 text;
  v_owner text := (select o.phone_e164 from app_private.owner_phones o order by o.created_at, o.phone_e164 limit 1);
  v_user uuid;
  v_n int;
begin
  -- Only when the deploy asks for it (-v demo=on): never by accident elsewhere.
  if current_setting('app.demo_fixture', true) is distinct from 'on' then
    raise notice 'demo shops: not switched on (-v demo=on); nothing changes';
    return;
  end if;
  -- The demo shops: every real (seed) shop whose menu, the full harvested one where demo-shops.json says so, else its seed
  -- draft, has at least one priced item. A shop without one keeps its "Not on Alo King yet" listing.
  create temp table demo_shops_now on commit drop as
    select x.id as vendor_id, coalesce(x.name_en, x.name_ar) as name, m.sections
    from public.vendors x
    cross join lateral (
      select coalesce(
        (select d.sections::jsonb from demo_in d where d.place_id = x.place_id and d.menu = 'harvest' and coalesce(d.sections, '') <> ''),
        (select dr.sections from public.menu_drafts dr where dr.vendor_id = x.id and dr.source = 'seed' order by dr.created_at desc limit 1)
      ) as sections) m
    where x.source like 'seed%' and not x.is_test and x.listing_status = 'active' and pg_temp.demo_priced(m.sections)
    order by coalesce(x.name_en, x.name_ar), x.id;

  -- 1. The list, as a dated config row (a new row only when it changed).
  select coalesce(jsonb_agg(jsonb_build_object('id', d.vendor_id, 'name', d.name) order by d.name, d.vendor_id), '[]'),
         coalesce(array_agg(d.vendor_id), '{}')
    into v_list, v_ids from demo_shops_now d;
  if public.config_value('demo_shops') is distinct from v_list then
    insert into public.app_config (key, value, effective_from, note, created_by)
    -- After the newest row (two runs inside one transaction share now()).
    values ('demo_shops', v_list, greatest(now(), (select max(c.effective_from) + interval '1 millisecond' from public.app_config c
                                                    where c.key = 'demo_shops')),
            'staging fixture: demo shops for investors, every shop with a priced menu (DECISIONS §39.12)', null);
  end if;

  -- 2. A shop that is no longer a demo shop is a seed listing again.
  for v in select * from public.vendors x where x.field_sources ? 'demo' and not (x.id = any (v_ids)) loop
    update public.vendor_members set status = 'revoked'
    where vendor_id = v.id and status <> 'revoked'
      and (phone_e164 in (select o.phone_e164 from app_private.owner_phones o) or app_private.is_sim_phone(phone_e164));
    update public.vendor_order_channels set enabled = false where vendor_id = v.id and enabled;
    update public.vendor_private set owner_mobile = null, kitchen_whatsapp = null where vendor_id = v.id;
    delete from public.menu_item_photos where vendor_id = v.id and source in ('illustrative', 'merchant_site');
    -- The menu the demo published from seed prices goes too (a claim must start from the merchant's confirmation, §15),
    -- unless the shop has orders.
    if not exists (select 1 from public.order_items oi join public.menu_items i on i.id = oi.item_id where i.vendor_id = v.id) then
      delete from public.menu_items where vendor_id = v.id;
      delete from public.menu_sections where vendor_id = v.id;
    end if;
    update public.vendors set orderable = false, claim_status = 'unclaimed', field_sources = field_sources - 'demo' - 'demo_menu'
    where id = v.id;
  end loop;

  -- 3. Each demo shop: its menu, claimed and orderable, and the owner as its merchant.
  for r in select * from demo_shops_now loop
    v_md5 := md5(r.sections::text);
    update public.vendors set claim_status = 'claimed', listing_status = 'active', delivery_enabled = true,
      field_sources = field_sources || jsonb_build_object('demo', 'staging demo shop (DECISIONS §39.12)')
    where id = r.vendor_id and (claim_status <> 'claimed' or not delivery_enabled or not field_sources ? 'demo');
    if (select field_sources ->> 'demo_menu' from public.vendors where id = r.vendor_id) is distinct from v_md5 then
      if exists (select 1 from public.order_items oi join public.menu_items i on i.id = oi.item_id where i.vendor_id = r.vendor_id) then
        raise notice 'demo shops: % has orders; its menu is kept as published', r.name;
      else
        delete from public.menu_items where vendor_id = r.vendor_id;
        delete from public.menu_sections where vendor_id = r.vendor_id;
        v_n := pg_temp.demo_publish(r.vendor_id, r.sections);
        update public.vendors set field_sources = field_sources || jsonb_build_object('demo_menu', v_md5) where id = r.vendor_id;
        raise notice 'demo shops: % published with % items', r.name, v_n;
      end if;
    end if;
    -- Orderable once it has a published item (a draft whose prices all round to $0 publishes none).
    update public.vendors set orderable = exists (select 1 from public.menu_items i where i.vendor_id = r.vendor_id)
    where id = r.vendor_id and orderable is distinct from exists (select 1 from public.menu_items i where i.vendor_id = r.vendor_id);
    insert into public.vendor_private (vendor_id) values (r.vendor_id) on conflict (vendor_id) do nothing;
    if v_owner is not null then
      v_user := app_private.auth_user_for_phone(v_owner);
      insert into public.vendor_members (vendor_id, user_id, phone_e164, role, status, display_name)
      values (r.vendor_id, v_user, v_owner, 'owner', 'active', 'Rasheed (demo)')
      on conflict (vendor_id, phone_e164) do update set status = 'active', role = 'owner', user_id = excluded.user_id;
      update public.vendor_private set owner_mobile = v_owner, kitchen_whatsapp = v_owner
      where vendor_id = r.vendor_id and (owner_mobile is distinct from v_owner or kitchen_whatsapp is distinct from v_owner);
      update public.vendor_order_channels set target = v_owner, channel = 'whatsapp'
      where vendor_id = r.vendor_id and role = 'primary' and enabled and (target is distinct from v_owner or channel <> 'whatsapp');
      if not exists (select 1 from public.vendor_order_channels c where c.vendor_id = r.vendor_id and c.role = 'primary' and c.enabled) then
        insert into public.vendor_order_channels (vendor_id, channel, role, target) values (r.vendor_id, 'whatsapp', 'primary', v_owner);
      end if;
    end if;
  end loop;
  raise notice 'demo shops: % on staging', jsonb_array_length(v_list);
  if v_owner is null then
    raise notice 'demo shops: no owner phone on this database; demo orders are not sent anywhere (see alo-test-grill.sql)';
  end if;
end;
$$;

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
