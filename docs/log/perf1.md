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
