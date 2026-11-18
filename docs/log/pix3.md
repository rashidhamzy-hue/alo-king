<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### PIX3: a picture for every item, 18 November 2026 (Sonnet 5.5); no migration

**Result, plainly: "a candidate for every item" is NOT met; "or a reason" is.** 291 items: **29 approved** (the PIX2 queue was approved since), **1 new candidate waiting** (AK-0016 Cauliflower, `public_page`, Wikimedia Commons), **261 without a picture, each with a named reason**: 162 `search_off` (no source this session can read) and 99 `none_passed` (a picture was tried and the check refused it: size, background, pack or product; reasons per item in `product_image_attempts`).

**Why so few.** This build sandbox cannot reach Open Food Facts (time-out) or any retail page, only Wikimedia Commons; there is still no search key (founder declined one, PIX2). Retailer and brand pages therefore could not be read, and Open Food Facts by barcode was not re-run (PIX already tried it, 91 `none_passed`; the same pictures would fail the same check).

**What was done.** Six generic Commons photos added to `data/pictures/candidates.csv` for loose produce still missing: carrot (AK-0008), lettuce (AK-0012), eggplant (AK-0014), mint (AK-0023), radish bunch (AK-0024), garlic bag (AK-0025), all free licences (public domain, CC0, CC BY-SA), page and time stored. `images` run 44252459417 from this branch (`from_list`, `max_usd` 3): 92 listed items tried, **1 proposed (cauliflower), 91 refused** by the vision check; the six new ones all refused (the check wants the exact item and size; a generic Commons photo of a head of lettuce did not satisfy it). **Spend USD 0.0246 of the USD 3 cap** (64 calls, `model_costs` row 44252459417-1). Meat, bakery without a pack, cheese by weight (33 items): no generic photo listed, the pack is the thing sold and a generic photo would mislead; they go to the label-day list. Nothing approved automatically.

**Candidates per category** (waiting): Fruits & Vegetables 1; every other category 0. **Still without a picture (261):** the 25 produce lines minus the approved ones, plus all packed food, cleaning, beauty, water, baby and pet items whose Open Food Facts picture failed or does not exist, and all loose meat, cheese and bakery.

**How the label-day front photos fill the rest.** LB1's label day already photographs the front of each pack. A front photo taken there is an `intake_photo` (`own_photo`, always customer-usable) and goes through the same approval queue. `photograph_at_intake` (artifact `photograph-at-intake`, 261 items) is the list; each pack photographed on label day closes one of them, with no search, licence or size problem. This is the only route that covers the 162 `search_off` items.

### Founder actions (PIX3)
1. **Approve the one candidate.** Console, **Approve** (`/approve`), tab **Pictures**: the cauliflower card; approve only if it shows exactly one cauliflower on a plain background with no logo or text. Or the older page `/pictures`, Approve.
2. **Photograph the rest on label day** (Console, Intake, Photograph): front of every pack; each is queued under Approve, Pictures.
3. If a person wants to add rows: `data/pictures/candidates.csv` (sku, picture address, page address, time), then GitHub, Actions, **images**, Run workflow, `from_list` ticked, `max_usd` 3.
