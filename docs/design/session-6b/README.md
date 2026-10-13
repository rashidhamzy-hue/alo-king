# Session 6b screenshots (DECISIONS §37.5)

Playwright screenshots from the website quality passes, run against fixture data (`scripts/web/fixtures.mjs`: made-up shops,
claims, applications and orders; nothing here is a real business or person). Mobile is 390 px wide, desktop 1440 px (shown at
about 700 px). Lighthouse mobile scores are in `lighthouse.txt`. The full set of every page, state, language and size is the
`website-screenshots` artifact of the CI run (`qa-out/` for the public pages, `qa-out-private/` for the staff pages).

Public pages (`scripts/web/qa.mjs`): for merchants (ar, en, fr), claim search and results, the claim flow (details, code, done),
registration (business, location, papers, done), driver sign-up, merchant terms, collection mandate.
Staff pages (`scripts/web/qa-private.mjs`): sign-in, merchant home with the AI onboarding side panel (docked on desktop, a
sheet on mobile), the kitchen terminal, the claims queue, the driver applications queue, the no-access screen, the driver app.

## The self-review loop (§37.5)
1. Round 1 (public): the search icon covered the first letter of the placeholder (field padding lost to the base layer), the
   country picker mixed an Arabic country name with its digits, step labels truncated on a phone, sticky header drawn mid-page in
   full-page shots.
2. Round 1 (staff): unlabeled form fields in the legacy profile and menu editor, a kitchen order card whose buttons overflowed
   its column beside the docked panel, a panel sheet whose close button overlapped the panel's own, English-only titles.
3. Round 2: every public page and every staff page, three languages, two sizes, passes axe, overflow and console checks;
   remaining notes are in `docs/decisions/LOG.md` ("session 6b PR").
