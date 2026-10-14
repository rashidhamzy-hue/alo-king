-- Rollback of 20261014160000_delivery_area.sql: the 12 villages only, the earlier Shouf load and draft summary, no
-- draft provenance columns. Config rows in force cannot be deleted (dated tables), so a newer pilot_place_ids row puts the
-- 12 villages back; pilot_merchant_place_ids stays (nothing reads it after this rollback). Vendors and drafts stay.
insert into public.app_config (key, value, effective_from, note, created_by) values
  ('pilot_place_ids', public.config_value('pilot_merchant_place_ids'), now(), 'Rollback of the §39.2 delivery area: the 12 villages', null);
drop function public.delivery_area_proposal();

create or replace function app_private.shouf_load_seed(p_sha256 text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pilot text[] := array(select jsonb_array_elements_text(public.config_value('pilot_place_ids')));
  v_vendors jsonb;
  n_towns integer;
  n_drafts integer;
  n_drafts_updated integer;
  n_grocery integer;
  v_places jsonb;
  r record;
begin
  v_vendors := app_private.vendors_load_seed(p_sha256, 'seed_shouf_2026_10', 'vendors_shouf');

  -- A merchant whose file row names no pilot village gets the nearest one (by the village's centre).
  update public.vendors v
  set town_id = (select p.id from public.places p where p.id = any (v_pilot)
                 order by p.centroid operator(extensions.<->) v.location limit 1)
  where v.source = 'seed_shouf_2026_10' and v.claim_status = 'unclaimed' and v.location is not null
    and (v.town_id is null or not (v.town_id = any (v_pilot)))
    and coalesce(v.field_sources ->> 'town_id', 'seed') = 'seed';
  get diagnostics n_towns = row_count;

  -- The two catalogue shops are supermarkets (§38.2.3), whatever the type the file gave.
  update public.vendors v set business_type = 'grocery_supermarket'
  where v.source = 'seed_shouf_2026_10' and v.business_type <> 'grocery_supermarket'
    and coalesce(v.field_sources ->> 'business_type', 'seed') = 'seed'
    and exists (select 1 from app_private.seed_menu_drafts d where d.place_id = v.place_id and d.kind = 'supermarket');
  get diagnostics n_grocery = row_count;

  -- Draft menus: one seed draft per unclaimed vendor; refreshed only while nothing in it is approved.
  for r in select d.place_id, d.sections::jsonb as sections from app_private.seed_menu_drafts d loop
    perform app_private.menu_draft_check(r.sections);
  end loop;
  insert into public.menu_drafts (vendor_id, source, status, sections, warnings, model)
  select v.id, 'seed', 'draft',
    (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s),
    '["seed: every price is from a public listing; the merchant confirms each section"]'::jsonb, null
  from app_private.seed_menu_drafts d join public.vendors v on v.place_id = d.place_id
  where v.claim_status = 'unclaimed'
  on conflict (vendor_id) where source = 'seed' do nothing;
  get diagnostics n_drafts = row_count;
  update public.menu_drafts m
  set sections = (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s)
  from app_private.seed_menu_drafts d join public.vendors v on v.place_id = d.place_id
  where m.vendor_id = v.id and m.source = 'seed' and m.status = 'draft' and v.claim_status = 'unclaimed'
    and m.sections is distinct from (select jsonb_agg(s || jsonb_build_object('approved', false)) from jsonb_array_elements(d.sections::jsonb) s);
  get diagnostics n_drafts_updated = row_count;

  v_places := app_private.pilot_places_apply();

  update app_private.seed_loads
  set counts = counts || jsonb_build_object('towns_nearest_village', n_towns, 'grocery_set', n_grocery,
    'drafts_new', n_drafts, 'drafts_updated', n_drafts_updated, 'places', v_places,
    'vendors_total', (select count(*) from public.vendors where source = 'seed_shouf_2026_10'),
    'whatsapp_candidates', (select count(*) from public.vendors v join public.vendor_private p on p.vendor_id = v.id
                            where v.source = 'seed_shouf_2026_10' and p.phone_seed_mobile))
  where name = 'vendors_shouf';
  return (select counts from app_private.seed_loads where name = 'vendors_shouf');
end;
$$;

create or replace function app_private.menu_draft_summary(p_draft_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('draft_id', d.id, 'vendor_id', d.vendor_id, 'status', d.status, 'usd_lbp_rate', public.usd_lbp_rate(),
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
      'index', s.ord - 1,
      'name', coalesce(s.v ->> 'name_ar', s.v ->> 'name_en', s.v ->> 'name_fr', 'Menu'),
      'approved', coalesce((s.v ->> 'approved')::boolean, false),
      'items', jsonb_array_length(s.v -> 'items'),
      'priced', (select count(*) from jsonb_array_elements(s.v -> 'items') i
                 where jsonb_typeof(i -> 'price') = 'number' and i ->> 'currency' in ('USD', 'LBP')),
      'preview', (select jsonb_agg(left(coalesce(i ->> 'name_ar', i ->> 'name_en', i ->> 'name_fr'), 40)
                                   || coalesce(' · ' || case i ->> 'currency' when 'USD' then '$' || (i ->> 'price')
                                     when 'LBP' then '≈ $' || round((i ->> 'price')::numeric / public.usd_lbp_rate(), 2)::text end, ''))
                  from (select i from jsonb_array_elements(s.v -> 'items') i limit 8) x)
    ) order by s.ord) from jsonb_array_elements(d.sections) with ordinality s (v, ord)), '[]'))
  from public.menu_drafts d where d.id = p_draft_id;
$$;

alter table public.menu_drafts drop column source_url, drop column captured_at;
alter table app_private.seed_menu_drafts drop column source_url, drop column captured_at;
select app_private.pilot_places_apply();
