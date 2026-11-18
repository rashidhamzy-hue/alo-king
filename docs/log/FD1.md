# FD1: the friends' test food, places and menus (18 November 2026)

Session FD1 (Opus 5.5, high). Prompt: the coordinator's, after decision 3 of `docs/DECISIONS.md`, "Founder decisions, 18 November 2026". The
choices the build made are `docs/DECISIONS.md`, "FD1, the friends' test food: places and menus, 18 November 2026" (13 rows). Migrations
**0245 to 0247** (0248 left unused). Ordering food is **FD2**'s (`docs/NEXT_SESSIONS.md`).

## Built
1. **A place from a listing** (0245). Staff (ops lead, admin) make a merchant source from an LV1 listing: name, village (chosen; the form
   proposes the listing's village where the villages list knows its name or an alias), the place's **public phone** (in `place_contacts`,
   shown only on the console's Places page; no client role or website function reads it; nothing sends to it), hours (open, close, days off),
   preparation time (0 to 180 min), **visibility off / testers / public**. A new place is off and closed. `buys_for_customer`: Alo King buys at
   the counter (or staff call it in); tier `assisted`. **Public is refused by a trigger** unless the owner's claim (`listing_claims`) or vendor
   application (`join_applications`) for the listing is on file. Every change is in the append-only `place_log`.
2. **The tester list**: `settings.testers {"numbers": []}`, customer numbers in E.164, added and removed on the Places page (`set_tester`),
   logged; `is_tester(party)`.
3. **Orderable** (0245): `place_orderable_for(place, party)` = approved by `approve_merchant()` and (public, or testers and a tester).
   `product_orderable()` now says no for a dish whose place is not approved and public, so every general read (quotes, carts, website,
   catalogue feed) keeps a testers-only dish out for everyone; `product_orderable_for(product, party)` and `places_for(party)` are for FD2.
   `search_catalog` drops a non-public dish, and a named place that is not public answers `merchant_not_onboarded`.
4. **Menus from photos** (0246). The Menus page photographs a menu page per photo, shrunk on the phone to 1600 px, JPEG 0.8 (`/menus.js`,
   LB1's method and FIX1's numbers), stored privately under `menus/<place>/<day>/<hash>.jpg`, recorded once (`record_menu_photo`).
   **The `menu-read` workflow** (`scripts/menus/`, MODEL_FAST, the Message Batches API at half price, **cap USD 2**, recorded in `model_costs`)
   reads every waiting photo into **dish proposals**: section, names in Arabic and English (a name not printed is written by the reader and
   marked), the price as printed with USD or LBP, sizes, options and add-ons with prices. The reader's form has no field for a description, a
   food fact, a health claim or a rating, and `record_menu_reading` keeps nothing else. A failed reading leaves the photo waiting.
5. **Every dish waits for a person** (`review_menu_dish`): approve (correct names, section, price, currency first) or reject with a reason.
   Approval makes the product the place owns, its offer, and 0205's option groups (sizes as one required choice priced against the
   smallest; options as printed; add-ons optional). **A name with a praise or health word is refused until changed.** A dish read again keeps
   its product.
6. **Prices** (0246, 0247): as printed; **LBP at today's rate** (`current_fx`) on approval and again on every new rate (a trigger on `fx_rates`);
   USD never moves; the printed figure is kept on the proposal and on each option. **`settings.food.service_fee_usd` = 0** (company income;
   on the Settings page, 0 to 5). Delivery fee: the zone's, as for groceries. FD2 applies both.
7. **"Menu checked on <date>"** (`stamp_menu_checked`): refused while a photo is unread or a dish waits.
8. **Dish food facts** (`dish_facts_status`): each of 20 attributes "declared by the vendor" (0205's declarations, with the date) or
   "not confirmed yet". The Menus page shows "Not confirmed yet" for every dish of a place whose owner has agreed to nothing.
9. **`approve_merchant()` for a place** (0247): approved dishes and the stamp; no commission (0), no terms; opens it **for its visibility
   only**. A signed merchant's path is 0009's, unchanged.
10. **Console** (functional, DS2 components): **Places** (`/places`: list, New place from a listing, Testers; one place's page with
    visibility, approval and details) and **Menus** (`/menus`, `/menus/<place>`: photos, dishes to check beside their photo, on sale with
    today's dollars and food facts, the stamp). Both in the Approve group of the menu, ops lead and admin only. Every action goes through the
    action log. Plain words for every new refusal (`explain`). Arabic in `docs/ARABIC_REVIEW.md` ("FD1"), not yet read by a reader.

## Tested (USD 0 except the dry run)
- `test/db/fd1-places.test.ts` (20): places, the phone kept off `sources` and from client roles, details, visibility and the owner rule by
  every path (a hand-typed update too), a vendor application counting, the tester list, photos, readings (no food fact kept), dish approval
  with sizes, options, add-ons and LBP at 89,500 then 90,000, the name rule, rejection, facts status, the stamp, approval for its visibility
  (before approval nobody; testers only: a tester yes, anyone else no, out of search; off; public), the older merchant path unchanged, and no
  write to orders, payments, stock, the ledger or listings in the three migrations. Written first: with 0245 to 0247 moved aside, every one fails.
- `test/db/menu-read-fd1.test.ts` (6): the run against a scripted Batch API (one read, one errored, one unreadable; cost at half price; the
  failures stay waiting), a sized dish with no base price, the cap (at most 2; photos past the worst case wait), no price no spend, the dry run
  writes nothing, request ids the API accepts.
- `apps/console/test/fd1-places.test.ts` (5): both pages end to end in the rig (the place from its listing with the village proposed, the
  phone shown, visibility refused in plain words, testers, a photo stored and recorded (form and script ways), a PDF refused, dishes approved
  and the claim name refused, the stamp, approval for testers, the action log), closed to pickers.
- `test/ci/fd1-arabic.test.ts`: the Arabic table equals the pages; no praise or health word.
- `npm run typecheck` and `npm test`: see the pull request. Locally the `test/pg` suites cannot start (this container's Postgres has no
  pgvector: `extension "vector" is not available`, as before this session); CI runs them.
- **The dry run** (`menu-read`, two invented menus in `test/fixtures/menus/`, the only live model call): see "The dry run" below.

## The dry run
Run [44265300345](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44265300345) (18 November, 08:15 to 08:18 UTC; a temporary
push trigger on this branch, removed in the next commit, because a dispatch-only workflow must be on `main` first). The first attempt
(run 44265070922) was refused by the Batch API before any spend: request ids may hold only letters, digits, `_` and `-`, and the dry run used
file names (`example-bakery.jpg`). Fixed, with a test; real photo ids are uuids.
- **Two invented menus, 2 photos, 15 dishes proposed, 15 of 15 right**: every name, section and price as printed, **every currency right**
  (eight lira prices on the grill menu, its "Prices in L.L." line; seven dollar prices on the Arabic-only bakery menu, `$0.75` included), the
  shawarma's two sizes (450,000 and 650,000), its bread choice (Saj +50,000) and add-on (extra garlic +50,000), the bakery's add-ons and the
  lahm bi ajine's two sizes with no base price. No description, no food fact, no claim.
- **USD 0.0008** (claude-haiku-5-5, half price, 6,599 input and 1,738 output tokens), recorded in `model_costs` (`menu-read`, step `dry_run`).
- **What it got wrong, and what changed:** (1) it put Latin words in Arabic name fields ("Regular", "Large", "Arabic", "Saj"): 0246 now keeps a
  name in the Arabic field only if it has Arabic letters (and in the English one only with Latin letters), moving it across where the other is
  empty, so the person sees an empty Arabic name to type, never a Latin one shown as Arabic; the prompt now says so too (not re-run: one live
  call per session). (2) It did not mark the English names it wrote for the Arabic-only bakery as `translated`: the flag is a hint only; the
  Menus page shows both names beside the photo for the person. (3) It read the bread choice as optional; the person sets it on approval only
  by rejecting and noting it (the choice's "required" is not editable on the page yet: FD2 or a later change, if a real menu needs it).

## Not proven (only a live account can)
- Staging has none of it until the next `deploy-staging` from `main` (0245 to 0247 then apply). No real menu has been read; the reader's
  accuracy on a real Lebanese menu photo (handwriting, glare, two columns) is unmeasured: every dish is checked by a person, which is the guard.
- The shrink script on a real phone (camera, several photos at once). The plain form works without it.
- Ordering a dish, the card, the rider buying at the counter and the ledger: **FD2**.
- Nothing shows a place on the website yet; the LV1 listing of a place stays on the Food page as before (never orderable there).

## Founder actions (FD1)
After the next staging deploy (Actions, **deploy-staging**, branch `main`), signed in to the console (staging) as admin:
1. **Create Safa Chicken from its listing.** Menu **Approve**, then **Places** (the menu link, or `/places`), tab **New place**: type
   `Safa`, **Find**, on "Safa Chicken" press **Make a place**. Check the village (Baqaata is proposed), type the place's **public phone**
   (+961..., shown only here; we never message it), **Opens**, **Closes**, tick its days off, **Preparation time**, **Make the place**.
   The place's page opens; it is **Off**.
2. **Upload its menu photos.** On the place's page, **Menu** (or `/menus`, the place). On a phone: **Photograph a menu page**, one page per
   photo, flat, sharp, the whole page in the frame; several can be chosen at once. Each is shrunk on the phone and saved; the list shows
   "Waits for the reading run".
3. **Run the reading.** GitHub, the repository, **Actions**, **menu-read**, **Run workflow**, branch **main**, leave `max_usd` at **2** and
   **dry_run unticked**, **Run workflow**. When it ends, its summary says how many photos were read and dishes proposed. If it says a batch
   is still processing, run it again with `batch_ids` set to the id it printed; if photos were left for the cap, run it again.
4. **Approve the dishes.** Back on the Menus page, under **Dishes to check**, each dish with **the photo** link: compare the names (a badge
   says when a name was not printed and the reader wrote it; another when a name praises or claims health: change it), the **Price as
   printed** and the **Currency** (USD or LBP), then **Approve this dish**; or type a reason and **Reject**. Lira prices need today's rate
   recorded (Money, Rate). When none is left: **Stamp: menu checked today**.
5. **Set testers only and approve.** The place's page: **Visibility**, **Testers only**, a reason, **Set the visibility**; then **Approve
   the place**. It is orderable by testers only, once FD2 is merged.
6. **Add the testers.** **Places**, tab **Testers**: each tester's WhatsApp number in full (+961...), **Add the tester**.
7. **The other Baqaata places** (up to 10): steps 1, 2, 4 and 5 for each; one reading run (step 3) reads every waiting photo of every place.
8. **Public, later**: only once the owner agrees and has claimed the place ("Claim <listing>" on WhatsApp) or applied (`/for-vendors`):
   the place's page, **Visibility**, **Public**, the reason. The database refuses it before.
