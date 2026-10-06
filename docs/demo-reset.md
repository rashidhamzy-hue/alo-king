# Running and resetting the kitchen-loop demo

The loop, end to end, with the demo vendor on the `/merchant` web screen:

1. Customer (a test WhatsApp number that has messaged the bot in the last 24 h) orders from the demo vendor and taps **Confirm Order**. They get "ORDER RECEIVED". For a vendor with a kitchen screen login or a linked owner phone the footer says the kitchen is confirming; for a vendor with neither it says it is a demo order (vendor not live) or that the restaurant has not been reached yet. Both have a **Cancel order** button until the kitchen accepts.
2. Sign in at `/merchant` as the demo vendor's kitchen login. The order appears under **New** with a chime. **Accept** (customer gets "accepted" with the ETA) or **Reject** (customer is invited to pick another kitchen).
3. **Food Ready** (silent, no customer message), then **Out for delivery (we deliver)** (customer gets "on the way" with the tracking link, and the ETA if the vendor has a prep time), then **Mark delivered** (customer gets "delivered" and the 1 to 5 star rating list in the same message). The delivery buttons only exist while no driver is assigned. They need the migration `20261006120000_merchant_self_delivery_status.sql` applied; until then Supabase rejects them with "merchants cannot set status".
4. The customer taps a star: stored in `order_ratings` (1 to 2 stars also ping the admin).

Every customer message is a free-form WhatsApp message, so it is only sent while the customer's 24 h window is open (message the bot first).

## Reset (SQL editor, service role)
Replace `<DEMO_VENDOR_ID>` and `<TEST_PHONE>` (digits only, the number you use to play the customer). Test orders are deleted, not edited, so the kitchen screen starts clean.

```sql
-- 1. the demo customer's test orders, ratings and offers
delete from public.order_ratings        where customer_phone = '<TEST_PHONE>';
delete from public.substitution_offers  where customer_phone = '<TEST_PHONE>';
delete from public.orders               where customer_phone = '<TEST_PHONE>' and vendor_id = '<DEMO_VENDOR_ID>';

-- 2. baskets, summaries and the numbered list
delete from public.baskets    where customer_phone = '<TEST_PHONE>';
update public.carts set status = 'expired' where customer_phone = '<TEST_PHONE>' and status = 'pending';
delete from public.quick_menus where customer_phone = '<TEST_PHONE>';

-- 3. optional: a clean first-time customer (also clears the name, address and language)
-- delete from public.customers where phone_number = '<TEST_PHONE>';
```

To replay only the kitchen steps on an existing order without deleting it, put it back to pending:

```sql
update public.orders
   set status = 'pending', accepted_at = null, ready_at = null, picked_up_at = null, delivered_at = null,
       customer_notified_status = null, escalated_at = null, driver_id = null
 where id = '<ORDER_ID>';
```

(The `orders_guard` trigger only restricts signed-in staff, so this works from the SQL editor.) Sent customer messages cannot be unsent.
