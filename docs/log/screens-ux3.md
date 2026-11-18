<!-- Moved from docs/screens/ux3/README.md on 18 November 2026 by session DOC2. The text is unchanged; the images it links to are now in the private screens bucket (console, Screens page, session ux3). -->

# UX3: the join pages and the Applicants tab (17 November 2026)

Ours, at 390 px, in Arabic (`-ar`) and English (`-en`): `SCREENS=docs/screens/ux3 npx vitest run test/screens/ux3.test.ts` (needs Chromium; not in CI). The real pages over the real
migrations; invented people only; the number confirmation is run as it runs for real (a code from the page, read by `claim_link_code`). The reference's matching screens are in
`docs/screens/ds2/` (`ref-web-join-rider-*`, `ref-web-for-vendors-*`; the first 2,200 px of each).

| Page | Ours | The reference |
|---|---|---|
| `/join/rider`, before the number is confirmed | `ux3-rider-390-*` | `ref-web-join-rider-390` |
| the code showing, with the WhatsApp button | `ux3-rider-code-390-*` | none |
| the form, once the number is confirmed | `ux3-rider-form-390-*` | none (below the cut) |
| the application received | `ux3-rider-applied-390-*` | none |
| `/for-vendors` | `ux3-vendor-390-*` | `ref-web-for-vendors-390` |
| `/for-vendors?place=<id>` (a listed place; counts as its claim) | `ux3-vendor-place-390-*` | none |
| the vendor application received | `ux3-vendor-applied-390-*` | none |
| Riders, Applicants tab (two waiting, one accepted, one declined) | `ux3-riders-applicants-390-*` | `ref-ops-riders-390` |
| Riders, Roster (the same page with its new tab bar) | `ux3-riders-roster-390-*` | `ref-ops-riders-390` |

`web-weights.txt`: what each website page downloads on a first visit in Chromium (page, stylesheet, script, fonts; nothing cached). All under 100 KB, measured after WEB2 was merged in; the Arabic form page is the heaviest at 80.0 KB.
