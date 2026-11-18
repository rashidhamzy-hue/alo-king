<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### LV1: Chouf places listed before they sign, 17 November 2026 (Sonnet 5.5); migrations 0224 and 0225
Founder decision of 17 November: `docs/DECISIONS.md`, "Listings before they sign, 17 November 2026" (first commit; it also changed the prospect-list line of `CLAUDE.md`
and the sentence of BUILD_PLAN 8.13 that said there is no claim page). No simulation and no live model call (rule 12); the claim turn runs with a scripted model that fails if asked.
Each part's tests were written first and failed without the migrations or code.

| Part | What LV1 built | Tested by |
|---|---|---|
| 1. The table | `listings` (0224), apart from merchants: no link to merchants, sources, offers, products or orders, and no column for a phone, rating, review count, menu, hours or photo. 0225 loads the 460 rows of `supabase/seed/chouf_listings.csv` (written by `scripts/listings/make-seed-migration.mjs`; 34 places have no village in the file and read "village not listed"). The file passes the personal-data guard | `test/db/lv1-listings.test.ts` (35), `test/ci/listings-lv1.test.ts` (file, guard, 0225 equals the file) |
| 2. Website | `/food` (kind, village, sort by distance or name only; 20 a page; Next and Previous), `/food/<id>` (name, kind, village, distance, map link, "Not on Alo King yet. You can't order from here yet."), JSON-LD LocalBusiness with a name and an address locality and nothing else. Never cached (a hidden page must be gone at once); a door on the home page. No picture, no price | LV1 block of `test/web/pages-web1.test.ts` (18) |
| 3. Demand | "I want to order from here": a form post with no field; `web_listing_want` calls `log_demand` kind `listing` once per anonymous session (cookie `ak_session`, the session of 0129) or signed-in customer, ever; 0224 redefines `log_demand` so only that kind keys on the person | same |
| 4. Remove | `/food/<id>/remove`: who (owner, manager, staff, someone else) and an optional reason, no contact detail. Hidden at once; `listing_removal_requests` and the append-only `listing_log` record who, why and when; an ops exception `listing_removal` is the staff case. Limits (`settings.listings`: 5 a session a day, 20 an hour): over one, the request is recorded and the case raised but the page is left up for staff (`hide_listing`). `restore_listing`, `hide_listing` and `keep_listing_hidden` are ops lead and admin only, with a reason, each logged | same, `apps/console/test/listings.test.ts` |
| 5. Claim | The website's button opens our WhatsApp with `Claim <listing_id>` typed. `turn.ts` reads it by code before any model (STOP first): `claim_listing` opens a staff case (kind other) with the listing and the sender, one fixed reply (`fixed.listingClaimed`), no welcome, outcome `claim`. Anything but "Claim" and a known id goes on as a message. It changes nothing about the listing and sends nothing else; there is no number to message | `test/db/lv1-claim-turn.test.ts` (6) |
| 6. Console | `/listings` (ops lead, admin; in the Approve group): Search (demand and claims per place, hide with a reason), Hidden and requests (who, why, when; restore with a reason; close the request), Claims (the sender's number, staff only, and the Inbox case). The exception kind `listing_removal` opens the Hidden tab | `apps/console/test/listings.test.ts` (7) |
| 7. Words | Arabic, English and French: `docs/ARABIC_REVIEW.md`, LV1 (a test holds the table equal to the dictionaries) | `test/ci/listings-lv1.test.ts` |

**Screens and weight.** `docs/screens/lv1/`: the Food page, a filtered Food page, a place, a place after "I want to order from here" and the remove form, at 390 px, Arabic and English
(`SCREENS=docs/screens/lv1 npx vitest run test/screens/lv1.test.ts`, needs Chromium). Every Food page on a first visit with its fonts (`web-weights.txt`): English 62 to 73 KB, Arabic 84 to 93 KB;
the Arabic home page is 95.6 KB (the new Food door added about 1.5 KB; DS2's measure said 96.4 KB, so check it again before WEB2 adds to it). Nothing scrolls sideways at 390 px.

**Not proven, and what to know.**
- Not on a phone or staging; 0224 and 0225 are applied only in the test database until the next staging deploy. A claim has not reached a real WhatsApp. `ak_session` is new: WEB2's cart and sign-in should reuse it.
- Anyone can hide a page without being checked (the decision: hiding is the safe side); the limits and the staff case are the guard. Restoring is staff only.
- Arabic, English and French wait for a reader (`docs/ARABIC_REVIEW.md`, LV1). The names of the places are the file's own; Arabic village names appear only where the delivery villages list knows the spelling.
- After hours a claim's case is recorded and its ladder starts at opening (HO1); the reply does not promise a time. After a verified claim nothing happens: that is Phase 8 (E1).
- `web_allowed` in `scripts/check_permissions.sh` and `WEB_CHANNEL_FUNCTIONS` list the four new website functions; the permission script itself needs a real Postgres (CI).
- Migration numbers: 0224 and 0225 used; 0226 is next (0219 and 0220 stay WEB3's).
**Founder actions.** None. (The listings file holds no number; the prospect list's phones and ratings stay in the private bucket.)
