<!-- Moved from docs/screens/ds2/README.md on 18 November 2026 by session DOC2. The text is unchanged; the images it links to are now in the private screens bucket (console, Screens page, session ds2). -->

# DS2: the restyled pages beside the design reference (17 November 2026)

Ours: `web-*` and `console-*`, at 390 and 1280 px, in English and Arabic, from `SCREENS=<folder> npx vitest run test/screens/ds2.test.ts`
(the real pages over the real migrations, seed catalog, invented data; no picture is approved in the seed, so cards show the placeholder).
The reference: `ref-web-*` and `ref-ops-*`, photographed from the founder's reference app running locally (English only: it has no
Arabic; phone numbers and the demo's first names are masked; its kitchens list was not in the archive, so Food screens show none).
Long pages are cut at the bottom. `web-weights.txt`: what each website page downloads on a first visit.

## Website

| Page | Ours | The reference's screen |
|---|---|---|
| Home | `web-home-{390,1280}-{en,ar}`, `web-home-check-…` (the delivery check answered) | `ref-web-home-{390,1280}` |
| Aisle | `web-aisle-…` | `ref-web-aisle-…` (and `ref-web-aisles-…`, the page of all aisles: WEB2) |
| Product | `web-product-…` (facts approved), `web-product-bare-…` (nothing approved: "not confirmed yet") | `ref-web-product-…` |
| Search | `web-search-…`, `web-search-miss-…` | `ref-web-search-…` |
| Gallery | `web-gallery-…` | none (ours only) |
| Privacy, terms | `web-privacy-…`, `web-terms-…` | none (the reference has no such page) |
| Offline | `web-offline-…` | none |

## Console

| Page | Ours | The reference's screen |
|---|---|---|
| Frame, admin (Today) | `console-shell-admin-…`, `console-more-admin-…` | `ref-ops-shell-admin-…`, `ref-ops-today-…` |
| Frame, lead (Today; Dispatch in the phone bar) | `console-shell-lead-…`, `console-dispatch-lead-…` | `ref-ops-shell-lead-…`, `ref-ops-dispatch-…` |
| Frame, picker (Pick, Stock, Intake) | `console-shell-picker-…`, `console-stock-picker-…` | `ref-ops-shell-picker-…`, `ref-ops-pick-…`, `ref-ops-stock-…` |
| Label day: photographing | `console-capture-…`, `console-capture-list-…` | `ref-ops-intake-…` |
| Label day: approvals | `console-label-approvals-…` | `ref-ops-approve-…` |
| Gallery | `console-gallery-…` | none |

## Reference screens not built yet (for the sessions that build them)

`ref-web-cart`, `ref-web-checkout`, `ref-web-order`, `ref-web-account`, `ref-web-signin`, `ref-web-pay`, `ref-web-how`, `ref-web-for-vendors`,
`ref-web-join-rider`, `ref-web-send-home`; `ref-ops-inbox`, `ref-ops-orders`, `ref-ops-riders`, `ref-ops-money`, `ref-ops-reports`,
`ref-ops-vendors`, `ref-ops-settings`. Which session builds each: `docs/HANDOFF.md`, DS2.
