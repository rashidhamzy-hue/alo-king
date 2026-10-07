# Alo King (ألو كينغ)

Alo King is a WhatsApp-native food, grocery and local-delivery platform for the Shouf region of Lebanon. React + TypeScript + Tailwind + shadcn/ui, react-router, @supabase/supabase-js, @tanstack/react-query. Mobile-first, bilingual EN/AR with an RTL toggle (Arabic font Tajawal, headings Cormorant Garamond, body Inter).

BACKEND: Do NOT provision a new database. Connect to my EXISTING Supabase project via env vars (add a .env and a single src/lib/supabase.ts):
VITE_SUPABASE_URL=https://hnjkietmwvkgbyrcnweq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xYOtf64oGjVcterTkS_saQ_tHSLthhy
VITE_MAPBOX_TOKEN=(optional, leave empty)
Never use a service-role key in the frontend. The schema already exists with RLS, do not create or alter tables.

SCHEMA FACTS (important):
- vendors: anon can SELECT ONLY these columns, so NEVER select('*') on vendors: vendor_id,name_en,name_ar,category_canonical,village_canonical,address,latitude,longitude,open_days,open_time,close_time,menu_available,is_live,is_active. 816 rows. Categories: Restaurant, Grocery, Cafe, Bakery, Sweets, etc. Some village_canonical are null (show as "Other"). Villages include Baakleen, Boqaata, Deir El Qamar, Barouk, Beit ed-Dine, Batloun, Kfar Nabrakh, Samqaniyeh, Damour, Chehime, Dmit, Kfar Him, Jahliyeh, Ain Zhalta.
- menu_items (public read): item_id,vendor_id,item_name_en,item_name_ar,section,price_usd,calories,protein_grams,carbs_grams,fat_grams,is_vegan,is_gluten_free,is_keto,is_halal,allergens. 5,354 rows. Macros are ESTIMATES: label them "approx.".
- orders (RLS by role, only for logged-in staff): id,short_code,vendor_id,customer_name,customer_phone,items(jsonb: [{item_id,name_en,name_ar,unit_price_usd,quantity}]),subtotal_usd,delivery_fee_usd,total_usd,status,payment_method,payment_status,delivery_village,building_landmark,notes,customer_lat,customer_lng,driver_id,driver_lat,driver_lng,driver_location_at,prep_minutes,created_at,accepted_at,ready_at,picked_up_at,delivered_at,cod_settled_at,is_expat_gift,gift_sender_name,gift_message. status values: pending, accepted, preparing, ready, out_for_delivery, delivered, cancelled, rejected. payment_status: unpaid, collected, paid, refunded.
- staff_profiles(user_id, role in merchant|driver|admin, vendor_id, display_name): a logged-in user can read their own row. Staff sign in with Supabase Auth email+password; after login read staff_profiles to learn role/vendor. If no row or wrong role, show a friendly "Your account isn't linked to a kitchen/driver profile yet, contact Alo King" screen. Provide sign-in AND sign-up forms.
- RPC track_order(p_order_id uuid) returns jsonb with: id,short_code,status,items,subtotal_usd,delivery_fee_usd,total_usd,payment_method,payment_status,delivery_village,is_expat_gift,gift_sender_name,gift_message,prep_minutes,created_at,accepted_at,ready_at,picked_up_at,delivered_at,vendor_name,vendor_lat,vendor_lng,customer_lat,customer_lng,driver_lat,driver_lng,driver_location_at. Callable by anon.
- RPC driver_cash_on_hand() returns numeric (cash held by the logged-in driver). Drivers may hold at most $150 cash; the database raises an error if a claim would exceed it, so show that error nicely.
- Edge function POST https://hnjkietmwvkgbyrcnweq.supabase.co/functions/v1/demo-chat with headers {apikey: <publishable key>, Content-Type: application/json} and body {messages:[{role:'user'|'assistant',content:string}]} returns {reply:string, order_id:string|null}. Send the last ~8 turns each time.
- Currency: always show USD and LBP, $1 = 89,500 LBP (single constant).

THEME: Emerald #064e3b, Gold #f59e0b, obsidian charcoal #090d16 background. Dark luxury look: subtle gold hairline borders, soft emerald glows, generous spacing, tasteful motion (framer-motion). No emoji overload, no generic stock-template feel.

ROUTES:

1) "/" Luxury landing page. Sections: (a) hero: "Order the Shouf, on WhatsApp." zero-download, text or Levantine voice note, AI macro/dietary tracking, with CTA buttons "Try it now" (scrolls to simulator) and "Open WhatsApp" (wa.me link constant in config, number +1 201-483-5474, the production number). (b) INTERACTIVE WHATSAPP PHONE SIMULATOR: realistic phone frame, WhatsApp-style chat bubbles, typing indicator, RTL-aware bubbles, quick-reply chips ("High-protein lunch in Baakleen", "Vegan mezze under $8", "شو في مناقيش بالباكلين؟", "Gluten-free dinner"), calls the demo-chat function. If the response has order_id show a gold button "Track this order live" linking to /track/<order_id>. Handle errors/429 gracefully. (c) LIVE SHOUF MERCHANT GRID: query vendors (explicit column list), search box, village filter chips with counts, category filter, paginated or "load more" grid of elegant cards (name EN/AR, category, village, hours). Header stat line: "816 merchants mapped across the Shouf" computed from data, plus a head-count of menu_items ("5,354 dishes with estimated macros"). Wording rule: describe merchants as "mapped" / "on the map", NOT as signed partners or "live partners". (d) EXPAT "SEND HOME" GIFT CALCULATOR: slider for gift value $10-$150, delivery fee $2, estimated card processing 2.9%+$0.30 (label "illustrative"), shows what the sender pays in USD, the value delivered in LBP, and King Crowns earned; note "Card checkout for gifts is coming soon" with an email/WhatsApp waitlist field (store in localStorage only for now). (e) KING CROWNS LOYALTY CALCULATOR: proposed program, 1 Crown per $1 spent, 100 Crowns = $5 cashback, tiers Prince (0+), Duke (500+, +1% bonus), King (2,000+, +2% bonus); inputs: orders per month and average basket; outputs: crowns/month, cashback $/year, tier reached and months to King. Label as "proposed program". (f) How it works (3 steps), footer. Do not invent testimonials, press logos or fake user counts.

2) "/merchant" Kitchen Terminal (tablet, landscape, big touch targets). Auth gate (role merchant, or admin with a vendor picker). Three columns NEW / IN KITCHEN / READY FOR PICKUP. Loads orders for the vendor and subscribes to Supabase Realtime postgres_changes on public.orders (filter by vendor_id for merchants). On INSERT: play a loud repeating audio chime (WebAudio generated tone, no external asset) until acknowledged, flash the card gold, update the browser tab title with the count. Include an "Enable sound" button (browsers need a gesture) and a mute toggle. Order card: short_code, age timer, items x qty, notes, delivery village + landmark, total USD/LBP, payment (COD unpaid), DEMO badge if notes start with "DEMO". Actions: pending -> "[ Accept (15m) ]" sets status 'accepted' and prep_minutes 15 (also long-press / dropdown for 10/20/30 min) and a "Reject" button with a reason in notes; accepted -> "[ Food Ready ]" sets status 'ready'. Only update status, prep_minutes, notes (the database blocks other edits). Show errors as toasts. Header shows vendor name, online/offline realtime indicator, today's order count and revenue.

3) "/driver" Driver PWA (phone, installable: web manifest + service worker via vite-plugin-pwa, icons generated simply, theme color #090d16). Auth gate (role driver). Top: Cash-on-Delivery gauge, a semicircular progress meter of driver_cash_on_hand() vs $150 cap, green below 60%, amber 60-90%, red above 90%, labeled "$X of $150 cash held". Realtime subscription to orders: new orders with status 'ready' and no driver appear as a full-screen dispatch modal with pickup vendor, drop-off village/landmark, total, whether COD and the cash impact on the gauge, and big buttons "Accept delivery" (update driver_id = my user id) and "Skip". If the database rejects due to the cash cap, show "Cash limit reached, settle with Alo King first". Active delivery screen: 1-tap navigation launchers for BOTH destinations: Waze (https://waze.com/ul?ll=LAT,LNG&navigate=yes) and Google Maps (https://www.google.com/maps/dir/?api=1&destination=LAT,LNG). Pickup coordinates come from vendors.latitude/longitude (read vendors with the explicit column list). Drop-off uses customer_lat/customer_lng if present, otherwise search by "landmark, village, Lebanon" text. Buttons: "Picked up" -> status 'out_for_delivery'; "Delivered" -> status 'delivered' AND payment_status 'collected' for COD (confirm dialog showing the amount to collect). While out_for_delivery, use navigator.geolocation.watchPosition and write driver_lat, driver_lng, driver_location_at at most every 8 seconds. Show my active deliveries and a today's-deliveries list.

4) "/track/:orderId" Customer Live Map Tracker (public, no login, mobile-first). Poll rpc track_order every 5 seconds (anon cannot use realtime). Elegant status timeline: Received, Kitchen accepted (show prep_minutes), Ready, On the way, Delivered, with timestamps; cancelled/rejected state handled. Map: react-leaflet. If VITE_MAPBOX_TOKEN is set use Mapbox tiles and Mapbox Directions for the route, otherwise use OpenStreetMap tiles (with attribution) and the public OSRM demo router for the route polyline; if routing fails fall back to a dashed straight line. Markers: restaurant, destination (only if customer_lat/lng exist), and an animated driver marker that glides to new positions when out_for_delivery. Fit bounds. Rough ETA if driver and destination coordinates exist (distance / 25 km/h). Itemized receipt: each line with qty x unit price, subtotal, delivery fee, total in USD and LBP, payment method + status, gift sender/message if is_expat_gift. Never display customer phone. Invalid/unknown order id shows a friendly not-found.

QUALITY: loading skeletons, empty states, error toasts, accessible contrast, responsive. Put shared constants (LBP_RATE=89500, COD_CAP=150, WHATSAPP number) in src/lib/config.ts. Keep each page in its own file with small reusable components. After building, make sure the app compiles with no TypeScript errors.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a4e49645-9681-4470-93b8-bb65224838b0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
