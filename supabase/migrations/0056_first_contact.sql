-- Alo King Chouf: build plan 1.13 (session B3). Where a customer came from: an ad click, a QR code, a referral code.
-- Recorded once, from the customer's very first message, on the customer (parties.first_contact), and copied onto their first
-- order (orders.acquisition) while they have no order past the card stage. Data capture only: no reward, no message, no
-- marketing use (invariant 17); a referral code is stored, never acted on.
--   - Ad: Meta's click-to-WhatsApp referral on the first message (ctwa_clid, the ad's source_id and url, headline).
--   - QR code and referral code: read from the first message's text with the patterns in settings.contact_codes (data, so
--     the printed codes can change without code). Matching is case-insensitive.
--   - Anything else is "organic". Customers who wrote before this migration have no first_contact: unknown, never guessed.

alter table parties add column if not exists first_contact jsonb;
alter table orders add column if not exists acquisition jsonb;

insert into settings(key, value) values ('contact_codes',
  '{"qr_pattern": "\\mqr[-_ ]?([a-z0-9]{3,12})\\M", "referral_pattern": "\\mref[-_ ]?([a-z0-9]{3,12})\\M"}')
on conflict (key) do nothing;

-- Called by the turn for each customer turn with its first message. Writes only for a party with no first_contact whose first
-- inbound message this is, so a later ad click never rewrites how someone first came.
create or replace function record_first_contact(p_party uuid, p_wamid text, p_text text default null, p_referral jsonb default null)
returns jsonb language plpgsql as $$
declare v jsonb; codes jsonb := coalesce(setting('contact_codes'), '{}'); m text[];
begin
  if p_party is null or exists (select 1 from parties where id = p_party and first_contact is not null) then return null; end if;
  if exists (select 1 from wa_messages where party_id = p_party and direction = 'inbound' and wa_message_id is distinct from p_wamid) then
    return null;
  end if;
  v := jsonb_build_object('source', 'organic', 'wa_message_id', p_wamid, 'at', now());
  if p_referral is not null and jsonb_typeof(p_referral) = 'object' then
    v := v || jsonb_build_object('source', 'ad', 'ctwa_clid', p_referral->>'ctwa_clid', 'ad_id', p_referral->>'source_id',
                                 'ad_type', p_referral->>'source_type', 'ad_url', p_referral->>'source_url', 'headline', left(p_referral->>'headline', 200));
  end if;
  if p_text is not null and codes ? 'qr_pattern' then
    m := regexp_match(p_text, codes->>'qr_pattern', 'i');
    if m is not null then v := v || jsonb_build_object('qr_code', upper(m[1]));
      if v->>'source' = 'organic' then v := v || jsonb_build_object('source', 'qr'); end if; end if;
  end if;
  if p_text is not null and codes ? 'referral_pattern' then
    m := regexp_match(p_text, codes->>'referral_pattern', 'i');
    if m is not null then v := v || jsonb_build_object('referral_code', upper(m[1]));
      if v->>'source' = 'organic' then v := v || jsonb_build_object('source', 'referral'); end if; end if;
  end if;
  update parties set first_contact = v where id = p_party and first_contact is null;
  return v;
end $$;

-- The first order carries where the customer came from. "First" = while no order of theirs has gone past the card.
create or replace function orders_copy_acquisition() returns trigger language plpgsql as $$
begin
  if new.acquisition is null and not exists (
       select 1 from orders o where o.customer_id = new.customer_id and o.id <> new.id
          and o.status not in ('draft', 'awaiting_confirmation', 'cancelled')) then
    new.acquisition := (select first_contact from parties where id = new.customer_id);
  end if;
  return new;
end $$;
drop trigger if exists orders_acquisition on orders;
create trigger orders_acquisition before insert on orders for each row execute function orders_copy_acquisition();

do $$ begin
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on all functions in schema public to service_role; end if;
end $$;
