# Shouf pilot seed (DECISIONS §38)

- `source/` holds Rasheed's three files (ratings and review counts removed before commit, §15.2):
  - `01_shouf_merchants_315.csv`: 315 merchants in the 12 pilot villages.
  - `02_shouf_photos.json`: 2,927 Google photo URLs for 234 merchants. Copied into the private `vendor-photos`
    bucket by `scripts/shouf/copy-photos.mjs` (CI job `seed-photos` after each staging deploy) as `source = seed`,
    `status = pending`; shown only on a claimed vendor's page after the merchant confirms them; deleted on request.
  - `03_shouf_digital_menus.json`: 19 restaurant menus and 2 supermarket catalogues, loaded as draft menus.
- `osm/` (when committed): landmarks and place names for the pilot area from OpenStreetMap (© OpenStreetMap
  contributors, ODbL), written by `scripts/shouf/osm-fetch.mjs`. While it is not committed, the staging deploy fetches
  it and uploads the result as the `osm-pilot` artifact.
- `verify.sql`: the §38.2 item 7 verification queries (read-only).

`scripts/load-seed.sh` normalises the merchants with `scripts/vendors/build-shouf.ts` and loads them with
`app_private.shouf_load_seed()`: every merchant unclaimed, not orderable, no public page, `source = seed_shouf_2026_10`,
every field `seed` until the merchant confirms it; the 12 villages are switched on. Changes here only in a `Data:` pull
request (§38.1).
