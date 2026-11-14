-- Alo King Chouf, session C4 (commerce core), docs/SYSTEM_PLAN.md section 1. Migrations 0128-0133.
--
-- 0128: where an order came from, and the idempotency key of the confirm action on a channel that has no WhatsApp message id.
--   orders.channel      'whatsapp' (the default: every order made before C4, typed or tapped in chat), 'catalog' (a WhatsApp
--                       catalog cart), 'web', 'console', 'app'. A label for reports and the console; no function decides
--                       anything on it. Nothing here sets 'catalog': the customer-line turn (turn.ts) is not C4's to change,
--                       so a catalog cart is still recorded as 'whatsapp' until the session that next touches turn.ts sets it.
--   orders.request_key  the key the website sends with its confirm action (0131). Unique: a confirm sent twice confirms once,
--                       and a key can never confirm a second order.
-- settings.web: C1 is approved (14 Nov; invariant 4 reads "a customer's own confirm action on a channel where we verified them"),
-- so confirm_on_page is set to true here, even over an earlier false. Turning it off makes every web confirm answer
-- 'confirm_on_whatsapp' (0131): the card goes to the customer's WhatsApp and the tap there confirms, as for a chat order.

alter table orders add column if not exists channel text not null default 'whatsapp';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_channel' and conrelid = 'orders'::regclass) then
    alter table orders add constraint orders_channel check (channel in ('whatsapp', 'catalog', 'web', 'console', 'app'));
  end if;
end $$;
alter table orders add column if not exists request_key text;
create unique index if not exists orders_request_key on orders(request_key) where request_key is not null;
create index if not exists orders_channel_created on orders(channel, created_at);

insert into settings(key, value) values ('web', jsonb_build_object(
  'confirm_on_page', true,          -- C1 approved: a session linked by a claimed code may confirm on the page
  'session_days', 90,               -- a signed-in device (docs/WEBSITE.md "Identity and consent", step 3)
  'anonymous_session_days', 30,     -- a browsing session with a cart and no number yet
  'link_code_minutes', 10))         -- SYSTEM_PLAN 1: a link code expires in 10 minutes
on conflict (key) do update set value = jsonb_build_object('session_days', 90, 'anonymous_session_days', 30, 'link_code_minutes', 10)
                                        || settings.value || jsonb_build_object('confirm_on_page', true),
                                updated_at = now();
