# WEB4b: the website's food pages, and three small fixes (19 November 2026)

Session WEB4b (Opus 5.5, high). Branch `claude/zen-wright-uhk73z`. Migration **0252** (the next free number). The choices the build made are
`docs/DECISIONS.md`, "WEB4b, the website's food pages and three small fixes, 19 November 2026" (11 rows). Nobody was asked. No ordering,
reading or prompt code changed, so no language gate and no simulation ran (rule 12); model spend USD 0. Kabsi was not touched.

## Built
1. **The food pages, on FD2's API** (`webFood()`, 0251; the reference's look, rendered on the server, no React in the browser):
   - **`/food`**: LV1's listings exactly as before, and above them **"Order from these places"** only when the visitor may order from one
     (`web_food_places` with the visitor's session: a signed-in tester sees the testers-only places; everyone else sees public ones, none
     today). Each with its village, its preparation time and "Taking orders now" or "Closed, opens 09:00".
   - **`/food/place/<id>`**: the menu by section (both names, 0252), the database's prices, each dish's choices (sizes, options, add-ons;
     the price change beside each); a **required choice is a required radio** and the server checks every choice against the dish's own
     groups before it goes in: a missing one comes back to the dish with the group named ("Choose Size first, then add it."). Each dish's
     **allergens and diet**: "declared by the place" with the value, or "not confirmed yet: ask us"; never "safe". A place the visitor may
     not order from is **404**: the site never says a testers-only place exists.
   - **The food basket `/food/basket`**: kept **apart from the grocery basket** (a cookie of ids only, priced again by `web_food_quote` on
     every view); one less, one more, remove, empty; the dishes, the service fee when above 0, the delivery fee and the arrival estimate
     once the visitor has a saved place, the total; what stops it (a closed place, a choice to make, a dish gone, the minimum) in words,
     and then no checkout button. **One place at a time**: a dish from a second place asks "Start a new food basket?", naming both.
   - **`/food/checkout`**: sign in by a WhatsApp code; a saved place or a pin, house and floor; "a request or an allergy, for the place"
     (read out on the call); **cash on delivery only**; the card in the WhatsApp card's own words with «🍗 من: <place>»; **"Send the order
     to my WhatsApp"** (`web_food_order`): the card goes to WhatsApp and the customer's Confirm tap there places the order (invariant 4,
     C1). The page becomes the order page; the food basket is emptied with it.
   - One filled call to action per page; Arabic mirrored by start/end classes; 94 new words (`w4b_`) in Arabic, English and French, listed
     in `docs/ARABIC_REVIEW.md` ("WEB4b"), not yet read by an Arabic reader.
2. **Rider shifts** (0252): 09:00 to 15:00 and 15:00 to 21:00, through `change_setting_now` (the function the console's Settings page
   calls), logged with the reason "match the 09:00–21:00 hours (founder decision 18 Nov)". The Settings page can now change each shift edge
   (a field may be a path; a shift starts before it ends). Founder action c is closed.
3. **Search data** (0252): Halloum AK-0044 carried "Liban Lait" as its brand («لبن ليت», «ليبن ليت», "Liban Lait", "liban lait"; its brand
   is Leentaanayel), so «لبن» found it. **Checked across staging** (read only, `brand_word_collisions()`): three more brand words were
   another item's kind word: «ماي سترو» on Maestro tea AK-0143 («ماي», water), "tanour al asir" on Tannour bread AK-0088 ("asir", juice),
   "indomie mee" on Indomie AK-0174 ("mee", water). The seven are removed, the items' search documents rebuilt, and a trigger refuses
   them on every later write, logging it in `search_word_drops`. Two other rows the check lists are right and stay ("nes cafe" on a
   Nescafe; "neskafeh"). Case first: `evals/cases/web4b_brand_words.json`.
4. **The WhatsApp catalogue's pictures** (0252, `scripts/images/feed-jpegs.mjs`, `.github/workflows/catalog-jpegs.yml`,
   `apps/gateway/src/catalog-feed.ts`): each public picture gets one JPEG copy, 1000 × 1000 on white, under 150 KB, made once by the
   hourly workflow (sharp), at `<sku>-<image>.feed.jpg` in the public `catalog` bucket; the feed's `image_link` is that JPEG, and only
   while the picture is approved. A withdrawn picture leaves the feed at once and the bucket on the gateway's next minute. Why not in the
   Worker: the free plan's 10 ms of CPU cannot decode and encode a picture. Meta was not touched.
5. The web smoke test checks «لبن» does not find Halloum, «ماي» does not find the tea, `/food` shows no testers-only place, `/food/basket`
   answers, and an unknown place is 404.

## Tested (free)
- `test/web/web4b-food.test.ts` (11, the built site over the real migrations with FD2's test kitchen and a second invented kitchen):
  who sees which place (anonymous and a non-tester: no orderable place, its page 404, its dishes not in search; a tester: the section
  above the listings); the menu by section with the database's prices and required radios, in English and Arabic; a missing required
  choice and another dish's option refused before the basket; the basket apart from groceries, priced as `web_food_quote` prices it, one
  less, remove, empty; the second place's question, replace and keep; a hand-written cookie; facts declared and not confirmed, no
  "safe"/praise/health word on any food page in three languages; a closed place; checkout: sign-in, the card with 🍗, cash only, one
  primary action, the order `awaiting_confirmation`, `cod`, `web`, the note kept, `web_card_requests`, options on the item, the basket
  emptied; the service fee from the setting.
- `test/web/web4b-lib.test.ts` (8): the cookie, merging, the 30-line cap, the choice check.
- `test/db/web4b-0252.test.ts` (21): before 0252 «لبن» finds Halloum and «ماي» the tea; after, none of the five queries finds the wrong
  item and the right ones still do (chat and website); the job cannot write the words again; the collision check; the shifts, their log,
  the blocked party, the Settings page's four edges and the shift-order rule; a one-word field unchanged.
- `test/db/catalog-public-a5.test.ts` and `catalog-k1.test.ts` (the feed's existing tests, adjusted): the feed links the JPEG, only once
  made; made only for a public picture; over 150 KB refused; withdrawn removed; the hourly pass keeps and forgets. `scripts/images/test/feed-jpegs.test.mjs`
  (3, real sharp): a 1000 px WebP becomes a 1000 × 1000 JPEG under 150 KB; a tall picture whole on white; no metadata.
- `test/ci/web4b-words.test.ts`, `test/ci/screens-doc2.test.ts` (the food pages beside the reference), `test/ci/ux2b-arabic.test.ts` (the console's
  new Arabic lines are in the review table).
- **Tests changed on purpose:** `test/web/pages-web1.test.ts` and `apps/console/test/ux3-applicants.test.ts` (the shifts shown: now 09:00–15:00 and
  15:00–21:00); `apps/console/test/windows.test.ts` (its 08:00 to 10:00 window is now before the first shift, so B1f's rule no longer offers
  it: the test's window is 10:00 to 12:00);
  `catalog-public-a5` and `catalog-k1` (the feed's address is the JPEG's).
- `test/screens/web4b.test.ts` (Chromium, here and by the `screens` workflow): six pages at 390 and 1440 px in Arabic, English and
  French, dark at 390; no sideways scroll; at most one primary action.

## First-visit weights (390 px, uncompressed, everything the page loads)
| Page | Arabic | English | French |
| --- | --- | --- | --- |
| `/food` (a tester) | 194.1 KB | 184.6 KB | 185.1 KB |
| `/food/place/<id>` | 209.3 KB | 199.0 KB | 199.7 KB |
| `/food/place/<id>` with a dish's choices open | 209.5 KB | 199.2 KB | 199.8 KB |
| `/food/basket` | 191.3 KB | 182.5 KB | 182.8 KB |
| `/food/checkout` | 141.9 KB | 133.7 KB | 134.1 KB |

Mostly the stylesheet and the fonts; the food pages load no picture.

## On staging (after the merge, 19 November)
Merged as [rashidhamzy-hue/alo-king#138](https://github.com/rashidhamzy-hue/alo-king/pull/138) on the founder's "go" (CI green on the head and on
`main`). `deploy-staging` from `main`: run 44478115516, green (0252 applied; 172 migrations recorded). The web deploy and smoke test: run
44478324022, green, with WEB4b's new checks. Read on staging afterwards (read only):
- **Rider shifts** 09:00–15:00 and 15:00–21:00; four Settings-log rows with the founder's reason; the four edges editable on the Settings page.
- **Search**: «لبن» finds AK-0041, 0048, 0050, 0052, 0056, 0057 (no Halloum); «ماي» the four waters (no tea); "asir" the juices (no bread);
  "mee" the waters (no noodles); «حلوم» still Halloum (AK-0044, AK-0060); «مايسترو» the tea. The seven words are in `search_word_drops`.
- **Feed JPEGs**: 229 public pictures; the `catalog-jpegs` workflow, started once by hand from `main` (run 44481560575; hourly after that),
  makes their JPEGs at 1.5 to 3.5 s each (25 made in its first two minutes; what one run leaves, the next hourly run makes). A made copy is
  public, `image/jpeg`, 1000 × 1000, no metadata; the largest of the first 25 is 136 KB, the average about 82 KB.
- Not this session's: an `images` import run at 07:36 (release `pictures-2`) failed because the release has no `product_images` folder.

## Not proven (only a live account or a person can)
- A real place: none is approved yet (FD1's founder steps); the test kitchen stands in. A tester's own phone signing in on the site and
  tapping Confirm on WhatsApp for a web food card (the card is the same `web_card_requests` path as WEB2's grocery cards).
- Meta reading the JPEG feed (Commerce Manager is founder step 9).
- The Arabic of the new words (an Arabic reader).

## Founder actions (WEB4b)
1. **Look at the food pages** (the stage stop): console, **More**, **Screens**, chip **WEB4B**: `web4b-food-place` (a place's menu),
   `web4b-food-place-choose` (a dish's choices, a required one named), `web4b-food-basket`, and also `web4b-food-list`,
   `web4b-food-switch`, `web4b-food-checkout`, at 390 and 1440 px, Arabic and English (French and dark too). Reply "go" or what to change.
2. To see them live on staging after the merge: add your WhatsApp number on the console's **Places**, **Testers**; then on the website
   **Sign in** (the WhatsApp code), **Food places**, "Alo King test kitchen".
