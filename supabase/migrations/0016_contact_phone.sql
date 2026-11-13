-- Alo King Chouf: build plan 1.19. WhatsApp usernames can hide a customer's number: Kapso may send only the
-- business-scoped user id. Identity already rests on that id. What the rider needs is a number to call, so:
--   parties.contact_phone   the number the customer gave us to call them on (E.164). It is never used to send WhatsApp
--                           messages: party_address() still answers with the WhatsApp identity, so nobody who has not
--                           messaged us is ever messaged.
--   customer_contact_phone() the number a rider can call: the one they gave us, else their WhatsApp number if we have it.
--   set_contact_phone()      stores a number, checked for shape.
--   rider_job()              as 0006, with the phone from customer_contact_phone().

alter table parties add column if not exists contact_phone text;
alter table parties drop constraint if exists parties_contact_phone_e164;
alter table parties add constraint parties_contact_phone_e164 check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$');

create or replace function customer_contact_phone(p_party uuid) returns text language sql stable as $$
  select coalesce((select contact_phone from parties where id = p_party),
                  (select phone_e164 from party_identities where party_id = p_party and line = 'customer' and phone_e164 is not null
                    order by created_at desc limit 1)) $$;

create or replace function set_contact_phone(p_party uuid, p_phone text) returns text language plpgsql as $$
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'BAD_PHONE'; end if;
  update parties set contact_phone = p_phone where id = p_party and role = 'customer';
  if not found then raise exception 'NOT_A_CUSTOMER'; end if;
  return p_phone;
end $$;

create or replace function rider_job(p_delivery uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('delivery_id', d.id, 'driver_id', d.driver_id, 'status', d.status,
    'collect_usd', (select coalesce(sum(o.total_usd), 0) from delivery_stops s join orders o on o.id = s.order_id
                     where s.delivery_id = d.id and o.payment_method = 'cod'),
    'stops', (select jsonb_agg(jsonb_build_object(
        'seq', s.seq, 'kind', s.kind, 'done', s.completed_at is not null, 'arrived', s.arrived_at is not null,
        'source_id', s.source_id, 'source', src.name, 'source_village', sv.name_ar,
        'order_id', o.id, 'short_code', o.short_code, 'order_status', o.status, 'customer', pa.display_name,
        'phone', customer_contact_phone(o.customer_id),
        'village', ov.name_ar, 'lat', coalesce(s.lat, cp.lat), 'lng', coalesce(s.lng, cp.lng),
        'directions', nullif(concat_ws(' - ', cp.building, cp.floor, cp.directions), ''), 'notes', o.customer_notes,
        'payment_method', o.payment_method, 'total_usd', o.total_usd, 'fx_rate_lbp', o.fx_rate_lbp, 'change_for_usd', o.change_for_usd,
        'paid', exists (select 1 from payments p where p.order_id = o.id and p.status = 'confirmed'),
        'items', (select count(*) from order_items i where i.order_id = o.id)) order by s.seq)
      from delivery_stops s left join sources src on src.id = s.source_id left join villages sv on sv.id = src.village_id
      left join orders o on o.id = s.order_id left join parties pa on pa.id = o.customer_id
      left join villages ov on ov.id = o.village_id left join customer_places cp on cp.id = o.place_id
      where s.delivery_id = d.id))
  from deliveries d where d.id = p_delivery $$;

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
