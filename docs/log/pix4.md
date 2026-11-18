# PIX4: the founder's product pictures into the approval queue, 18 November 2026 (Sonnet 5.5); migration 0242

**Result, plainly: 261 pictures wait for approval (Console, Photos); nothing is approved or visible to a customer; no stocked item is without a picture.**

## Counts (live run 44339740035 on staging, from `main`, USD 0: no model, no paid call)
| | |
|---|---|
| Files in the release | 291 (all in `product_images/`; `product_images_review/` was empty) |
| **Matched** (by the product code in the file name; the report agreed) | **291** |
| **Unmatched** | **0** |
| Skipped: the item already has an approved picture (29 earlier ones and the cauliflower AK-0016) | 30 |
| **Proposed** (all checks passed) | **251** |
| **Needs review** (a check failed; the reasons are on the card) | **10** |
| **Failed checks** | **10 items**: duplicate 16 flags over 9 items, heavy 1 (AK-0146, 89 KB at quality 58) |
| **Still no photo** | **0** (every active item has an approved or proposed picture) |
| In the queue now | 261 (251 + 10); staging coverage: 291 items, 30 approved, 261 proposed |
| Uploaded | 261 WebP files, 11.4 MB (ceiling 40 MB); bucket `media` 3.50 MB before, **14.89 MB after** |

Needs review: AK-0006 and AK-0019 (two orange pictures, distance 0.39: probably the same picture); AK-0112, AK-0113, AK-0116 (three Pepsi Diet bottles that look alike); AK-0207, AK-0209, AK-0213, AK-0249 (a 3 L oil, a vinegar, a 5 L oil and a toilet cleaner: tall bottles on white, flagged by the structure hash); AK-0146 (file over 80 KB at the lowest quality tried).

## What was found, and what I did about it
- The release held one `Archive.zip` and `image_fetch_report_v2.csv` (not v3). **Every row of the report has an empty picture address and page address.** So there was nothing to keep as a source record beyond the file name and report row.
- No existing source kind fits (`public_page` needs both addresses; `intake_photo` claims our own photograph; `web_search` is never shown). **0242** adds the source kind `founder_upload` (licence `founder_supplied`) with a required source note, and puts the licence on the list a customer may see **only after a person approves** (`review_product_image`, unchanged). This is the same footing as the founder's decision of 14 November for public pages; it is a licensing call the founder should know about. Where a later report has addresses, they are kept (`source_url`, `page_url`).
- 0242 also adds `needs_review`, `check_notes`, `deferred_at` (Later), `propose_picture_import`, `defer_product_image`, `pictures_missing` (by aisle) and `storage_bucket_bytes`. Migration numbers: 0242 used; next free stays 0249.

## What was built
- `scripts/images/import-release.mjs` and `lib/importcheck.mjs`; `images` workflow input `import_release` (tag) and `import_dry_run`. The release is downloaded into a new folder under the runner's temp directory, unzipped there, read only.
- Checks: opens; short side at least 600 px; the outer edge near-white (90% of it); the product's longest side at least 55% of the square and its box at least 5% of the area; no near-duplicate (16 x 16 colour thumbnail within 4, or the 64-bit structure hash within 3 bits and the thumbnail within 8) among the files and the pictures already queued; under 80 KB once stored. Output: 1000 x 1000 WebP, quality 80 stepped down only to fit, white padding, metadata stripped (tested).
- Console, **Photos** (`/photos`, Approve group): big picture, name, size; Approve / Reject / Later; filters To approve, Needs review, Later, **Needs a photo** (by aisle, tag "needs a photo", link to the label day page); keys a, r, l and the arrows; three full-width buttons on a phone. Reject needs no reason there (a note is optional).
- Tests (free): `scripts/images/test/import.test.mjs` (17), `test/db/pix4-queue.test.ts` (7), `apps/console/test/photos-pix4.test.ts` (10).

## Not proven
A person has not yet used the Photos screen on a phone; the 261 pictures were not looked at by a person (only by script); WebP in the **WhatsApp catalogue**: Meta's catalogue documents JPEG and PNG, so check that WebP is accepted before step 9, or make the feed serve a JPEG copy. The website and console show WebP.

## Still without a photo, by aisle
None. (Had any been missing, the Photos page's **Needs a photo** tab lists them by aisle; the front photo on label day closes each.)

### Founder actions (PIX4)
1. Console, **Photos**: approve a picture only if it shows exactly the item (same brand, product and size, one pack, no price tag, logo or text); otherwise **Reject**. Keys on a laptop: **a**, **r**, **l** (Later). Start with **To approve** (251 clean), then **Needs review** (10: look at the reason on the card).
2. Say if you do not accept founder-supplied pictures as customer-visible once approved (0242): rejecting one withdraws it at once.
