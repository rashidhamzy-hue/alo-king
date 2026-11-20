# PERF1: fast photos, clean storage, a cheap probe (20 November 2026)

Session PERF1, one bundle, migration **0267**. Decisions (nobody was asked): `docs/DECISIONS.md`, "PERF1, fast photos, clean storage, a cheap
probe, 20 November 2026". Rules changed: `docs/RULES.md` (picture files, page weight, screenshots, the staging heartbeat, the workflow caps, a
new media clean-up row). No ordering or prompt change (so no language gate or sim-test), no write to orders, payments, stock or the ledger,
no new agent, Kabsi not touched; B1g's files (ordering, search) not touched.

## What was built
1. **Fast photos**
   - `scripts/images/feed-jpegs.mjs`, the hourly `catalog-jpegs` job, also makes a **400 px** and an **800 px** WebP of every public picture
     (`toVariant`: white, whole, no metadata; quality from 80 down to the target, 15 KB and 50 KB; caps 25 KB and 80 KB), names them by content
     (`<sku>-<image id>-w<width>-<12 hex of sha256>.webp`) and records them (`catalog_picture_variants`, 0267). A withdrawn picture's copies
     are removed by the gateway's minute job (`syncCatalogPictures`) and by the job; the website stops naming them at once (`catalog_web_picture`).
   - **Cache header**: everything the job uploads to `catalog`, and the gateway's copy of each original (now read and written again instead of
     Storage's copy, which kept `no-cache`), is `public, max-age=31536000, immutable`. The job's `reheader` input uploads the existing originals
     and feed JPEGs again once.
   - **The website**: cards use the 400 px copy, `srcset` 400w/800w, `sizes`, width and height; lazy except the first visible row (the first
     two cards of an aisle's first section and of search); the product page uses the 800 px copy. `/categories/*` cached a week.
   - **The browser test** `test/screens/perf1.test.ts` (390 px, Arabic, slow 4G, CPU ×4; fails over 600 KB or LCP ≥ 2.5 s).
2. **Storage clean-up**: screens retention per page per chip (and the last 24 hours), WebP at 1× for kept and future shots (`screens`
   workflow actions `retain`, `webp`); the media clean-up of rejected or withdrawn pictures older than 3 days (`storage-clean`, daily).
3. **Probe cost**: recorded in `model_costs` (workflow `probe`), every 3 open hours, capped at USD 0.10 a day, `probe_silent` adjusted.

## Tested (free tests only)
- `test/db/perf1.test.ts` (9): the copies made once under hashed names and named by the website; caps, names and widths refused; a
  withdrawal takes them off the pages at once and out of the bucket on the next minute; strays and forget; the cache header string; the media
  list (old rejections only; never `labels/`, a shared file, or a rule's rejection under 8 days; rows kept); the probe every 180 minutes,
  its spend in `model_costs`, the cap stopping it and keeping `probe_silent` quiet; `probe_silent` after one period and 30 minutes.
- `scripts/images/test/variants.test.mjs` (real sharp: sizes, no metadata, refusals, names), `apps/web/test/perf1-pictures.test.ts` (which
  file a page draws; eager first row, lazy rest, width/height/srcset/sizes), `test/ci/screens-doc2.test.ts` (retention per page, WebP at 1×,
  uploads as WebP, the Screens page still opens every chip). sharp is not installed in CI, so the sharp tests run where it is (here, and the
  workflows); CI skips them, as it does WEB4b's.
- `npm run typecheck && npm test`, and the personal-data guard: see "Results" below.

## Before (measured 20 November, before any change)
Page weights (`perf1.test.ts`, staging, Arabic, 390 px, DPR 2, slow 4G, CPU ×4, first visit):

| Page | Bytes | Requests | Product pictures | LCP |
|---|---|---|---|---|
| `/` | 386.4 KB | 30 | 2, 56.6 KB | 1.89 s |
| `/aisles` | 491.7 KB | 25 | 0 | 1.46 s |
| `/c/dairy_eggs` | 357.4 KB | 18 | 7, 272.6 KB | 1.73 s |

Headers: catalogue pictures `private, no-cache` (as served); `/categories/*.webp` `public, max-age=0, must-revalidate`; `/_astro/*` already a
year, immutable; HTML `no-cache`.

Storage (staging, `storage.objects`):

| Bucket | Files | MB |
|---|---|---|
| catalog | 438 | 25.1 |
| screens | 681 | 165.1 |
| media | 407 | 15.6 |
| **total** | 1,526 | **205.8** |

Probe spend (agent_run_costs, probe parties, USD a day): 13 Nov 0.0056, 14 Nov 0.0562, 15 Nov 0.0298, 16 Nov 0.0348, 17 Nov 0.0677,
18 Nov 0.0485, **19 Nov 0.1102**, 20 Nov (to 19:00) 0.0545; none of it in `model_costs`.

## Results
- **Tests**: `npm run typecheck` clean; `npm test` locally 3,523 passed, 184 skipped. The 7 `test/pg` suites fail in this container only, because its
  Postgres has no pgvector (0212); they fail the same way without this change, and CI's `test` job ran them green. One real failure was
  found and fixed: `web4b-0252.test.ts` builds a database without 0252, and 0267 builds on 0252's table, so that database now also leaves
  out 0267. Personal-data guard clean. CI on #152 green (test, permissions-check, pilot-locks, CodeQL, secrets-and-dependencies).
- **Merged** as #152 (merge commit 2083a27). On `main`: ci 44803811002, **deploy-staging 44803918275 (0267 applied)**, console 44803918342
  and web 44804133178, all green.
- **On staging after the deploy** (the jobs by hand on `main`):
  - `catalog-jpegs` 44804137585 with `reheader`: **438 copies made** (219 pictures × 2). 400 px: average 10.8 KB, largest 23.3 KB, 4 over
    the 15 KB target and none over the 25 KB cap. 800 px: average 27.9 KB, largest 73.5 KB, 1 over the 50 KB target. **All 876 objects in
    `catalog` now carry `public, max-age=31536000, immutable`** (`storage.objects` metadata; 0 otherwise). A GET of a copy returns that
    header, and the second fetch is a CDN `HIT`. (`curl -I`, a HEAD request, still prints `private, no-cache`: Storage answers HEAD
    differently. Browsers GET.)
  - The pages on staging draw the hashed 400 px copies with the 400w/800w srcset (read from the aisle page's HTML).
    `/categories/*.webp` now returns `public, max-age=604800, stale-while-revalidate=86400`.
  - `screens` 44803830754 (action retain, then WebP): **681 files, 165.1 MB, then 259 files, 40.5 MB after retention, then 12.7 MB as WebP**.
    121 PNGs converted. All 16 chips kept, and **259 of 259 shots open through a signed link** (the Screens page's own path).
  - `storage-clean` 44804146060: **0 due**. The 89 rejected pictures (3.45 MB) were all rejected on 19 November, so they fall due on 22 November.
    Before and after that run: catalog 25.2, media 15.6, screens 40.5 MB. The screens figure was read mid-way through the screens run.
  - **The probe**: `settings.probe` on staging has `every_minutes` 180 and `daily_cap_usd` 0.10. The shop was closed when 0267 landed
    (21:55 Beirut), so `probe_due` had not yet written its first row. `record_probe_cost()` was run once by hand (the same function; it
    only upserts cost rows), and `model_costs` now holds `probe-2026-11-19` (27 calls, USD 0.1102) and `probe-2026-11-20` (24 calls,
    USD 0.0545). On 19 November `stopped_at_cap` is true after the fact: the cap did not exist that day. No heartbeat alert was open.

## After
Page weights (`perf1.test.ts`, the same conditions as "Before"; three runs after the deploy, the third in strict mode, passed):

| Page | Before | After | Pictures before → after | LCP before → after (3 runs) |
|---|---|---|---|---|
| `/` | 386.4 KB | **349.9 KB** | 56.6 → 18.8 KB | 1.89 → 1.34, 1.17, 1.13 s |
| `/aisles` | 491.7 KB | **492.0 KB** | none (the aisles' own photos) | 1.46 → 1.42, 1.45, 1.36 s |
| `/c/dairy_eggs` | 357.4 KB | **161.6 KB** | 272.6 → 75.8 KB | 1.73 → 0.79, 0.75, 1.89 s |

The very first run, straight after the deploy, measured home's LCP at **4.89 s** and the test failed as it should. The next three read
1.13 to 1.34 s on the same build: that first visit met a cold Worker. `/aisles` is unchanged: its 492 KB is the aisles' own 15 photos,
which load lazily but are near enough to load at once. That is under the target, so left as it is. A repeat visit to every page now takes
the pictures and the aisles' photos from cache.

Storage (staging):

| Bucket | Before | After (20 Nov, 20:00 UTC) | Due 22 Nov |
|---|---|---|---|
| catalog | 438 files, 25.1 MB | 876 files, **33.4 MB** (+219 × 2 copies, 8.3 MB) | 33.4 MB |
| screens | 681 files, 165.1 MB | 259 files, **12.7 MB** | 12.7 MB |
| media | 407 files, 15.6 MB | 407 files, **15.6 MB** | about 12.2 MB (the 89 rejected files, 3.45 MB) |
| **total** | **205.8 MB** | **61.7 MB** | **about 58.3 MB** |

**The 60 MB target is not met today: 61.7 MB.** It is met on 22 November, when the first rejected files fall due, unless new pictures arrive
first. Nothing else could be deleted without breaking a rule: the originals, feed JPEGs and copies are all in use, and the rest of `media`
is label, menu and voice records.

## What only a live account can prove
- The probe's first capped day, and `probe_silent`'s new text on a real silence. Both are proven in the tests only; the cap has not been
  reached on staging since 0267.
- The media clean-up's first real deletion (22 November, by the daily `storage-clean`).
- A phone on a real 4G network. The test throttles Chromium; it is not a handset.

## For the next session
- A screens `shoot` keeps a session's whole set for 24 hours, then the next retention keeps one shot per page. Review a session's shots
  within a day, or shoot again.
- `perf1.test.ts` measures staging. Run it after each website change: the `screens` workflow, action shoot, test `perf1.test.ts`, session `perf1`.
