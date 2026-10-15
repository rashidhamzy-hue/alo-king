-- STAGING ONLY (DECISIONS §39.12, demo mode). Never applied by the migration job and never run at the production cut-over:
-- the cut-over checks that config demo_shops is empty on production. The staging deploy runs it after
-- alo-test-grill.sql, with the list built by scripts/demo/build-demo-menus.ts:
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -v demo_csv=<file> -f supabase/test-fixtures/demo-shops.sql
-- Safe to run again.
--
-- What it does, for the 20 real Shouf shops in supabase/test-fixtures/demo-shops.json:
--   * writes the dated config row demo_shops (a new row only when the list changed);
--   * makes each one claimed, orderable and active on staging, marked field_sources.demo, so it shows in search, the
--     smart list menu and the catalogue (and syncs to the Meta catalogue once it is connected, #181);
--   * publishes its menu once: the seed draft on staging, or the full harvested menu where demo-shops.json says so (Deli
--     Dough 350 items, J.O'S 52), LBP prices converted at the dated rate exactly as a merchant's approval does
--     (menu_draft_approve_section), without touching the draft; a changed source is published again while the shop has
--     never had an order;
--   * makes the owner's phone (app_private.owner_phones) its owner, kitchen WhatsApp and primary order channel, so every
--     order card goes to Rasheed; the shop's own numbers stay on record and are never used (the outbound guard of
--     20261015220000_demo_mode.sql reroutes anything else);
--   * puts a shop that left the list back as an unclaimed, not orderable seed listing.

\set ON_ERROR_STOP on
select set_config('app.actor_kind', 'system', false);
select set_config('app.audit_reason', 'staging demo shops (DECISIONS §39.12)', false);

drop table if exists pg_temp.demo_in;
create temp table demo_in (place_id text, name text, menu text, sections text, source_url text) on commit drop;
\if :{?demo_csv}
-- psql does not expand variables inside \copy: build the command first.
\set demo_copy '\\copy demo_in from ' :'demo_csv' ' with (format csv, header true)'
:demo_copy
\else
\echo 'demo shops: no list given (-v demo_csv=...); nothing changes'
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

do $$
declare
  r record;
  v public.vendors%rowtype;
  v_list jsonb := '[]';
  v_ids uuid[] := '{}';
  v_sections jsonb;
  v_md5 text;
  v_owner text := (select o.phone_e164 from app_private.owner_phones o order by o.created_at, o.phone_e164 limit 1);
  v_user uuid;
  v_n int;
begin
  if not exists (select 1 from demo_in) then
    return;
  end if;
  -- 1. The list, as a dated config row (a new row only when it changed).
  for r in select * from demo_in loop
    select * into v from public.vendors x where x.place_id = r.place_id and x.source like 'seed%' and not x.is_test;
    if v.id is null then
      raise notice 'demo shops: % (%) is not on this database; skipped', r.name, r.place_id;
      continue;
    end if;
    v_list := v_list || jsonb_build_array(jsonb_build_object('id', v.id, 'name', coalesce(v.name_en, v.name_ar)));
    v_ids := v_ids || v.id;
  end loop;
  if public.config_value('demo_shops') is distinct from v_list then
    insert into public.app_config (key, value, effective_from, note, created_by)
    -- After the newest row (two runs inside one transaction share now()).
    values ('demo_shops', v_list, greatest(now(), (select max(c.effective_from) + interval '1 millisecond' from public.app_config c
                                                    where c.key = 'demo_shops')),
            'staging fixture: demo shops for investors (DECISIONS §39.12)', null);
  end if;

  -- 2. A shop that left the list is a seed listing again.
  for v in select * from public.vendors x where x.field_sources ? 'demo' and not (x.id = any (v_ids)) loop
    update public.vendor_members set status = 'revoked'
    where vendor_id = v.id and status <> 'revoked'
      and (phone_e164 in (select o.phone_e164 from app_private.owner_phones o) or app_private.is_sim_phone(phone_e164));
    update public.vendor_order_channels set enabled = false where vendor_id = v.id and enabled;
    update public.vendor_private set owner_mobile = null, kitchen_whatsapp = null where vendor_id = v.id;
    delete from public.menu_item_photos where vendor_id = v.id and source = 'illustrative';
    update public.vendors set orderable = false, claim_status = 'unclaimed', field_sources = field_sources - 'demo' - 'demo_menu'
    where id = v.id;
  end loop;

  -- 3. Each demo shop: claimed and orderable, its menu, and the owner as its merchant.
  for r in select d.*, x.id as vendor_id from demo_in d join public.vendors x on x.place_id = d.place_id and x.id = any (v_ids) loop
    v_sections := case when r.menu = 'harvest' and coalesce(r.sections, '') <> '' then r.sections::jsonb
                       else (select dr.sections from public.menu_drafts dr where dr.vendor_id = r.vendor_id and dr.source = 'seed'
                             order by dr.created_at desc limit 1) end;
    v_md5 := md5(coalesce(v_sections::text, ''));
    update public.vendors set claim_status = 'claimed', orderable = v_sections is not null, listing_status = 'active',
      delivery_enabled = true, field_sources = field_sources || jsonb_build_object('demo', 'staging demo shop (DECISIONS §39.12)')
    where id = r.vendor_id and (claim_status <> 'claimed' or orderable is distinct from (v_sections is not null)
                                or not delivery_enabled or not field_sources ? 'demo');
    if v_sections is null then
      raise notice 'demo shops: % has no menu on this database; listed, not orderable', r.name;
    elsif (select field_sources ->> 'demo_menu' from public.vendors where id = r.vendor_id) is distinct from v_md5 then
      if exists (select 1 from public.order_items oi join public.menu_items i on i.id = oi.item_id where i.vendor_id = r.vendor_id) then
        raise notice 'demo shops: % has orders; its menu is kept as published', r.name;
      else
        delete from public.menu_items where vendor_id = r.vendor_id;
        delete from public.menu_sections where vendor_id = r.vendor_id;
        v_n := pg_temp.demo_publish(r.vendor_id, v_sections);
        update public.vendors set field_sources = field_sources || jsonb_build_object('demo_menu', v_md5) where id = r.vendor_id;
        raise notice 'demo shops: % published with % items', r.name, v_n;
      end if;
    end if;
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
  if v_owner is null then
    raise notice 'demo shops: no owner phone on this database; demo orders are not sent anywhere (see alo-test-grill.sql)';
  end if;
end;
$$;

select set_config('app.actor_kind', '', false);
select set_config('app.audit_reason', '', false);
