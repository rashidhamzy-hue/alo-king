-- 0120 (session M1, message design): what the fixed messages need from the database, in the conversation's language.
--
-- name_gaps: a product shown to an Arabic chat with no approved Arabic name (the English name was shown instead). One row per
--   product and language, counted, so the names page knows what to approve first (SYSTEM_BRIEF rule 6). Written only by
--   record_name_gaps(); a failure there never stops a card.
-- order_address(order): the card's address line: the village in both languages, the building and floor the customer gave (B4).
-- lira_answer(party): "how much in lira?" (founder decision 2). Today's rate is current_fx(); the customer's latest open order is
--   shown in lira at its own rate (fixed at confirmation, else today's), rounded to 1,000 as order_card (0119) rounds.
-- repeat_offer(party): 0071's text, plus 'names' (each item's English and Arabic name), so the greeting names them in the
--   conversation's language. 'items' is unchanged.
-- order_card(order, party): 0119's text, plus each line's product_id, so a card sent again records its name gaps too.

create table name_gaps (
  product_id  uuid not null references products(id) on delete cascade,
  lang        text not null check (lang in ('ar', 'en', 'fr')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  seen        int not null default 1,
  last_where  text,
  primary key (product_id, lang)
);

create or replace function record_name_gaps(p_products uuid[], p_lang text, p_where text default null) returns int
language sql set search_path = public, pg_temp as $$
  with ins as (
    insert into name_gaps(product_id, lang, last_where)
    select distinct p.id, p_lang, left(p_where, 40) from products p where p.id = any(coalesce(p_products, '{}'))
       and p_lang in ('ar', 'en', 'fr')
    on conflict (product_id, lang) do update set last_seen = now(), seen = name_gaps.seen + 1, last_where = excluded.last_where
    returning 1)
  select count(*)::int from ins $$;

-- The gaps still open: products whose Arabic name is still missing, most seen first. For the names page (D4) and reports.
create or replace view name_gaps_open as
  select g.product_id, p.sku, p.name_en, g.lang, g.seen, g.first_seen, g.last_seen
    from name_gaps g join products p on p.id = g.product_id
   where g.lang <> 'ar' or nullif(btrim(coalesce(p.name_ar, '')), '') is null
   order by g.seen desc, g.last_seen desc;

create or replace function order_address(p_order uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('village_en', v.name_en, 'village_ar', v.name_ar,
                            'building', nullif(btrim(coalesce(cp.building, '')), ''), 'floor', nullif(btrim(coalesce(cp.floor, '')), ''))
    from orders o
    left join customer_places cp on cp.id = o.place_id
    left join villages v on v.id = coalesce(o.village_id, cp.village_id)
   where o.id = p_order and not o.is_pickup $$;

create or replace function lira_answer(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('rate', current_fx(), 'order', (
    select jsonb_build_object('short_code', o.short_code, 'total_usd', o.total_usd,
                              'total_lbp', round(o.total_usd * coalesce(o.fx_rate_lbp, current_fx()) / 1000) * 1000)
      from orders o
     where o.customer_id = p_party and coalesce(o.fx_rate_lbp, current_fx()) is not null
       and o.status in ('awaiting_confirmation', 'awaiting_payment', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived')
     order by o.created_at desc limit 1)) $$;

create or replace function repeat_offer(p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select case when o.id is null then null else jsonb_build_object('order_id', o.id, 'short_code', o.short_code,
           'items', (select coalesce(jsonb_agg(coalesce(p.name_ar, i.name_snapshot) order by i.id), '[]'::jsonb)
                       from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok'),
           'names', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name', i.name_snapshot, 'name_ar', p.name_ar) order by i.id), '[]'::jsonb)
                       from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok')) end
  from (select last_closed_order(p_party) as lid) l left join orders o on o.id = l.lid $$;

create or replace function order_card(p_order uuid, p_party uuid) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_id', o.id, 'short_code', o.short_code, 'status', o.status, 'payment_method', o.payment_method,
    'change_for_usd', o.change_for_usd, 'window', window_json(o.delivery_slot_id),
    'replaces', (select r.short_code from orders r where r.id = o.replaces_order_id),
    -- A transfer chosen because a first order was over the cash cap (1.16) says so again on the card sent again.
    'prepay', case when o.payment_method <> 'cod' and coalesce((setting('first_order')->>'max_cod_usd')::numeric, 0) > 0
                        and o.total_usd > (setting('first_order')->>'max_cod_usd')::numeric
                        and not exists (select 1 from orders d where d.customer_id = o.customer_id and d.status in ('delivered', 'closed'))
                   then jsonb_build_object('reason', 'first_order', 'maxCodUsd', (setting('first_order')->>'max_cod_usd')::numeric) end,
    'quote', jsonb_build_object('ok', true, 'issues', '[]'::jsonb,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name', i.name_snapshot, 'name_ar', p.name_ar, 'qty', i.qty, 'unit', p.sell_unit,
                                  'line_total_usd', round(i.qty * i.unit_price_usd, 2), 'modifiers', i.modifiers, 'note', i.note) order by i.id), '[]'::jsonb)
                  from order_items i join products p on p.id = i.product_id where i.order_id = o.id and i.status = 'ok'),
      'subtotal_usd', o.subtotal_usd, 'delivery_fee_usd', o.delivery_fee_usd, 'small_order_fee_usd', o.small_order_fee_usd,
      'dues_usd', o.dues_usd + c.credit, 'credit_usd', c.credit, 'total_usd', o.total_usd,
      'fx_rate_lbp', coalesce(o.fx_rate_lbp, current_fx()),
      'total_lbp', case when coalesce(o.fx_rate_lbp, current_fx()) is null then null else round(o.total_usd * coalesce(o.fx_rate_lbp, current_fx()) / 1000) * 1000 end,
      'eta_minutes', (select z.base_eta_minutes from villages v join zones z on z.id = v.zone_id where v.id = o.village_id),
      'pickup', o.is_pickup, 'village_id', o.village_id,
      'village', (select name_en from villages where id = o.village_id), 'village_ar', (select name_ar from villages where id = o.village_id)))
    from orders o, lateral (select coalesce(sum(amount_usd), 0) as credit from credit_applications where order_id = o.id) c
   where o.id = p_order and o.customer_id = p_party $$;

alter table name_gaps enable row level security;
select pin_search_paths();

do $$ declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table name_gaps from %I', r);
      execute format('revoke all on table name_gaps_open from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table name_gaps to service_role;
    grant select on table name_gaps_open to service_role;
  end if;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema public from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema public from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
