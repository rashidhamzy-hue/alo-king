# CON1: a simple console (19 November 2026)

Session CON1 (Opus 5.5). Prompt: the founder finds the console confusing (Pictures, Photos and Gallery all existed); make it simple without
losing any working function. Decisions: `docs/DECISIONS.md`, "CON1, a simple console, 19 November 2026" (14 rows; nobody was asked).
**No migration** (0258 not needed). No ordering, reading or prompt code changed, so no language gate and no simulation; free tests only.
Kabsi not touched. MENU2 works on the Menus page in parallel: its insides are untouched (CON1 only links to it and posts to its dish route).

## The new map of the console
| Section | Pages (address) | Who |
|---|---|---|
| **Today** | Needs attention and today's numbers (`/`), Inbox (`/inbox`; Complaints and All exceptions are its and Today's tabs) | ops lead, admin |
| **Orders** | Orders, groceries and food, filterable (`/orders?kind=grocery\|food`), Food calls (`/food`), Pick queue (`/pick`), Rider jobs (`/rider-jobs`) | ops lead, admin |
| **Approvals** | One inbox (`/approve`): Names, Photos, Label readings, Dishes, Places, Second approvals, Refunds, Auto-approvals; one card at a time | ops lead, admin |
| **Products** | Catalogue, Photos (one page; "As a list" is the older Pictures), Label work (`/labels`: Progress, Photograph, Approve readings, Food facts, Readiness), Readiness, Search words, Weights | ops lead, admin |
| **Stock** | Stock counts, Purchase orders, Receiving, Bins, Label day photos, Temperature log, Returns | everyone |
| **People** | Riders (and Rider applicants), Staff (admin), Places (and Testers), Food places, Menus | ops lead, admin |
| **Money** | Ledger, To confirm, Refunds, Day open, Day close (cash drops are the Ledger's tab) | ops lead, admin |
| **Settings** (behind your name) | Settings (admin); **Advanced**: Screens, Template health, Zones and fees, Delivery windows, Exchange rate, the hub, Design components (once "Gallery") | admin; an ops lead sees the Advanced tools their role opens |
| **Pick** | the picker's own place: a picker sees Pick and Stock only, and their Today opens the pick queue | picker |

Phone bar: ops lead and admin **Today, Orders, Approvals, Stock, More**; picker **Pick, Stock, Label photos, More**.

## What was built (files)
- `apps/console/src/nav.ts`: the seven groups by role, Advanced, the phone bar, a link that is current on a moved page; one Approvals badge.
- `apps/console/src/app.ts`: `MOVED` (eight older addresses answer **301** to the page they live in, query kept), `drawOlder` (a new page draws the
  older page's own handler, under the older route's roles), `Ctx.top` (a tab bar above a drawn page), `act()` honours `return_to` for the inbox
  and Photos only, `Deps.errorsLast24h`.
- `apps/console/src/html.ts`: the name opens Settings; the assistant's button and panel; Advanced in the command bar.
- `pages/approve.ts`: the inbox's eight kinds (new cards: dish, place, spot check; refunds apart from second approvals; `view=list` draws the older lists).
- `pages/today.ts`: needs attention (13 kinds, most urgent first, one tap each), today's numbers (orders, sales, delivery time, restaurant acceptance time); the old board folded.
- `pages/photos.ts` (As a list), `pages/labels.ts` (new), `pages/intakeframe.ts` (the flow's tab bar), `pages/hubs.ts` (More: sections, Settings, Advanced, you; `/assistant`), `pages/gallery.ts` (`/components`), `pages/orders.ts` (groceries or food), `pages/stock.ts` (listed for every role), `pages/zones.ts` (the hub's anchor).
- `pages/food.ts`, `places.ts`, `listings.ts`: a second heading removed (the page drew its own `<h1>` under the shell's).
- `apps/console/src/worker.ts`, `wrangler.jsonc`: Sentry's count of errors (read-only token; `SENTRY_ORG` alo-king, `SENTRY_API` de.sentry.io).
- `packages/ui/styles/console.css` → `ui.generated.ts`: the name link, the assistant, the attention list (the sheet's ceiling 66,000 → 70,000 characters).
- `apps/console/src/i18n.ts`: the new words, Arabic and English (model-written: `docs/ARABIC_REVIEW.md`, CON1).

## Tests (all free)
- `apps/console/test/con1.test.ts` (12, CI): every address the console answered before CON1 (50) reaches its page; the eight moved ones answer 301
  with their query; item pages and posts keep their addresses; every page is in a menu; the admin, ops lead and picker each see only their sections
  (sidebar, phone bar, More); the inbox's eight kinds, a dish card approved and back to the next card, a place card refused by the database and back;
  `view=list`; Today's order of urgency, one tap each, the four numbers (acceptance 8 min from invented calls), Sentry's three states and its reader
  (URL, token, failure to null); the Orders filter; the assistant on every page.
- `test/screens/con1.test.ts` (Chromium, the `screens` workflow): the 50 old addresses in a real browser (one heading each, never "Not for your
  role"), each role's sections, then **32 screenshots**: Today, Approvals, Orders and Photos at 390 and 1440 px, light and dark, Arabic and
  English, with no sideways scroll and no control under 44 px on a phone, the assistant's button on a phone and its panel at 1440.
- Updated to the new map (the old layout was what they pinned): `shell`, `ds1`, `today`, `today-inbox`, `ux2a`, `ux2b-approve`, `ux2b-intake`,
  `label-queue-lb1`; the kit's browser follows a 301 and, after signing in, the picker's redirect to Pick, as a browser does.
- `npm run typecheck && npm test`, the personal-data guard (with gitleaks 8.21.2) and the repository hygiene check: see the pull request.

## What only a live account can prove
- Sentry's number on Today: needs the founder's read-only token (`docs/STATUS.md`, founder action p). The reader is tested against a fake.
- The screens are of invented data on the real pages; staging shows them with staging's data once merged and deployed.
- The Arabic is model-written (`docs/ARABIC_REVIEW.md`).

## Founder actions (CON1)
1. **Look at the screens and say "go"**: Console, **Screens**, chip **CON1** (Today, Approvals, Orders, Photos; phone and laptop, light and dark, Arabic and English).
2. **Sentry on Today** (optional, any time): `docs/STATUS.md`, action p.
