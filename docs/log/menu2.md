# MENU2: menus from any source (19 November 2026)

Session MENU2 (Opus 5.5). Prompt: the coordinator's (one "Add a menu" box for photos, a PDF, a link, pasted text, a Word file, an Excel or CSV
file; links fetched in the workflow with a headless browser; the same reading run under one cap; approval made fast but still per dish;
re-imports show only what changed; Safa Chicken imported from its oddmenu page as the first real case). The choices the build made are
`docs/DECISIONS.md`, "MENU2, menus from any source, 19 November 2026" (16 rows). Migrations **0259 and 0260**. Merged as
[rashidhamzy-hue/alo-king#141](https://github.com/rashidhamzy-hue/alo-king/pull/141); the deploy fix it needed as
[rashidhamzy-hue/alo-king#142](https://github.com/rashidhamzy-hue/alo-king/pull/142). No new agent; no write to orders, payments, stock or the
ledger; no place opened; nothing messages a place.

## Built
1. **Sources** (0259): `menu_sources` (pdf, link, text, docx, sheet; several per place; "the whole menu" or not) and `menu_source_pages`
   (what is read: a fetched web page, a PDF, a pasted text, a Word file's text, a sheet). `add_menu_source` (ops lead, admin; the reading
   party may add a link only); pasted text and a PDF get their page at once; `menu_fetch_queue` and `record_menu_source_pages` for the fetch.
2. **The fetch** (`scripts/menus/crawl.mjs`, `fetch.mjs`, `extract.mjs`), in the `menu-read` workflow: links with Playwright's Chromium
   (robots.txt first and for every page; same host under the start page's path; tabs pressed; one fetch per page, a 1.5 s pause, at most 40;
   never a sign-in, account, cart, order or terms link; the site's repeated header taken off; each page's text and a private screenshot kept);
   Word, Excel and CSV taken out to text by a small in-repo zip reader (no new package). Photos are unchanged (FD1).
3. **Reading** (`batch.mjs`): photos and pages in one batch under one cap (USD 2): a text page as text, a PDF as the document, a page with no
   text as its screenshot. The reader's form gains the description as printed, `price_clear`, flags with a note, the source line, the PDF page;
   sizes printed on separate lines become one dish with sizes; a range is never one price.
4. **Proposals and approval** (0260): `price_status` ("price to confirm": not approvable until typed), flags (the reader's, a range caught in
   SQL, a praise or health word in a name or description), `menu_dish_clean`, `approve_menu_section` (each through `review_menu_dish`, so
   each dish keeps who approved it), re-import comparison (unchanged out of the queue; price changed with the old price; new; removed from a
   whole menu, approved = off sale), the stamp waiting for every source page, `menu_place_report`.
5. **Console, Menus page**: the "Add a menu" box (the photo button as before; a file: PDF, .docx, .xlsx, .csv or a photo; a link; pasted
   text; "this is the whole menu"); Sources (each with its state, pages kept but not read, the text of a page at `/menus/page/<id>`); dishes
   by section beside their source (photo, screenshot, PDF and page, the text, the web page, the source line); "Approve all N clean dish(es)
   in this section"; flagged rows one by one, with a price box per size when sizes exist; New / Price changed (was …) / No longer in the menu.
   Plain words for every new refusal; the Arabic in `docs/ARABIC_REVIEW.md` (FD1 section, "MENU2 additions"; not yet read by a reader).
6. **CI**: Chromium is installed only when the fetcher or its fixtures change, and then the browser test must run.

## Tested (USD 0)
- `test/db/menu2-sources.test.ts` (18): every source kind and who may add it; the saved invented fixtures (`test/fixtures/menus/files/`:
  .docx, .xlsx with two sheets, .csv with quotes and a lira price, pasted text, a PDF made from the .docx); Windows-Arabic CSV; the fetch
  (screenshots stored privately, failures counted to three); one batch for text pages, the PDF as a document, a screenshot only without text;
  flags, ranges, price to confirm, praise in a description; section approval (only clean ids, each recorded); typed sizes; the stamp waiting
  for pages; a re-import (unchanged, price changed, new, removed; removal approved takes the dish off sale, rejection keeps it); no write to
  orders, payments, stock or the ledger in either migration.
- `test/db/menu2-crawl.test.ts` (6): robots.txt rules, which links are sections, header lines, the loop on a fake site (tabs, one fetch per
  page, robots, sign-in, 40 pages), and **Chromium on the saved, invented JavaScript menu page** (`test/fixtures/menus/js-site/`) served on
  127.0.0.1: every section and the Drinks tab's found, each opened once, the robots-disallowed section and the sign-in link never opened. In
  CI this ran for real on #141 (Chromium installed).
- `apps/console/test/menu2.test.ts` (3): the box with every kind, section approval and a typed price, a re-import's badges.
- FD1's tests pass; two FD1 expectations were updated on purpose (a sized dish keeps its currency; the prompt's description sentence).
- CI on #141: all 278 test files passed, the real-Postgres suites included. Locally the `test/pg` suites cannot start (no pgvector here).

## The live run: Safa Chicken on staging
Run [44496658705](https://github.com/rashidhamzy-hue/alo-king/actions/runs/44496658705) (`menu-read` on `main`, 19 November, 09:28 to 09:37
UTC; inputs `place` = Safa Chicken's id, `link` = https://oddmenu.com/ar/p/ssafa-chicken, whole menu). The founder's pasted Gemini text was
not used.
- **Fetched**: 16 pages, each opened once (robots.txt allows `/`): the start page and its 14 Food sections, plus COLD BEVERAGES from the Drinks
  tab = **15 sections**. Each page's text and screenshot are kept. The start page (only the section list) and **OFFERS** (the page shows no
  item) were kept but not read.
- **Read**: 14 sections, **136 dishes** proposed, **108 clean**, **28 flagged**. Cost **USD 0.0086** (claude-haiku-5-5, half price, 14
  requests, 51,756 input and 23,874 output tokens), recorded in `model_costs`.

| Section | Dishes | Clean | Flagged | Price to confirm |
|---|---|---|---|---|
| OFFERS / عروضات | 0 | 0 | 0 | 0 (the page shows no item) |
| APPETIZERS / مقبلات | 17 | 17 | 0 | 0 |
| SALADS / سلطات | 4 | 4 | 0 | 0 |
| SANDWICHES / سندويشات | 23 | 23 | 0 | 0 |
| SHAWARMA / شاورما | 11 | 11 | 0 | 0 |
| DAILY DISH / صحن يومي | 8 | 7 | 1 | 1 |
| BURGERS / برغرز | 6 | 5 | 1 | 0 |
| WRAPS | 3 | 3 | 0 | 0 |
| PIZZA & PASTA | 8 | 4 | 4 | 0 |
| PLATES / صحون | 13 | 10 | 3 | 0 |
| SMOKED RICE / ارز مدخن | 6 | 4 | 2 | 0 |
| KIDS MEAL / وجبة اطفال | 2 | 0 | 2 | 0 |
| TAKE-OUT / DINE-IN | 15 | 0 | 15 | 15 |
| DIPS | 7 | 7 | 0 | 0 |
| COLD BEVERAGES (Drinks tab) | 13 | 13 | 0 | 0 |
| **Total** | **136** | **108** | **28** | **16** |

**Sizes found** (each size keeps its own printed price): ساندويش شاورما دجاج small 3.5 / large 5; ساندويش شاورما لحمة small 4.5 / large 6
(the page prints each as two lines; read as one dish with two sizes); بطاطا مقلية small 2.75 / large 5.5; كولسلو small 2.25 / large 3.5;
Pepsi Plastic one size "330ml" 1.11 and Water one size "Small" 0.28 (the page prints the size under the name; a single size is harmless: one
choice).

**Every flagged row** (approved one by one on the Menus page):
- **A price range, price to confirm (16)**: TAKE-OUT / DINE-IN: فروج فحم 11–17, نصف فروج فحم 6–11, فروج غاز 9–16, نصف فروج غاز 5.5–9,
  دجاج بروستد 16–18, نصف بروستد 8.5–10, كيلو مشاوي مشكلة 35–41, كيلو طاووق مشوي 20–26, كيلو لحم مشوي 45–51, كيلو فخاد مشوية 12–18,
  كيلو جوانح مشوية 12–18, كيلو كباب مشوي 35–41, كيلو اسكالوب 33–35, كيلو كرسبي 33–35, كيلو ناغتس 33–35; DAILY DISH: مندي لحم 12–20. The
  page shows only the range and opening a dish shows nothing more, so the sizes behind it are not on the source: ask the place, then type the
  price (or reject and add the sizes later).
- **Description cut off in the source (2)**: Spicy Chicken Ranch ("…for a tantalizing", also a praise word), Chicken Fettuccine Alfredo
  ("…butter, and").
- **A praise word in the printed description (6)**: Supreme ("delight"), Spicy Chicken Ranch ("tantalizing"), Vegeterian ("perfectly"),
  Safa Special Burger («مميز»), كيلو رز مدخن and نصف كيلو رز مدخن («مميزة»). Change the description, then approve (invariant 14).
- **Unclear name (2)**: صحن بروتين (a stray "غرام 300" line), صحن سودة ("غرام 2oo", probably 200).
- **Other (3)**: وجبة كريسبي and وجبة ناجتس (description ends at «وصلصة», sauce not named), سجق (description names no main item; «توم» spelling).

The place stays **off** on staging (its visibility was not changed; the founder sets testers only when the menu is approved) and was not
messaged. Nothing is on sale: every dish waits for a person.

## On staging
- 0259 and 0260 applied by deploy-staging run 44494071116 (from `main` at cf37003). That run then failed at the catalog bucket's name check,
  which had failed every deploy since WEB4b's feed JPEG copies appeared (`<sku>-<image>.feed.jpg`), so the Worker deploy was skipped. Fixed
  in #142 (the check accepts the feed copies; all 458 objects match). deploy-staging run 44499190711 from `main` at 19511de: green, Worker
  included. The console (its own workflow) deployed the new Menus page at 09:12 UTC (console run 44494071137).
- Safa Chicken's import (above) is on staging, waiting for approval.

## Not proven (only a live account or a person can)
- The new Menus page clicked through by a person on staging (the console tests drive it end to end in the rig; nobody has signed in to the
  staging console in this session).
- A PDF, a Word, an Excel or a CSV file, and pasted text, read by the live model: only the scripted Batch API read them here (one live run
  allowed). The reader's prompt and form are the same for every kind.
- Approving Safa's dishes, the stamp and `approve_merchant`: the founder's (below).

## Founder actions (MENU2)
See the founder report in the session's last message, also kept here:
1. **Approve Safa's menu** (staging console, signed in as admin or ops lead): **Approve**, **Menus** (or `/menus`), **Safa Chicken**. Under
   **Dishes to check** each section shows its clean dishes with their source line; open "the screenshot" or "the web page" if in doubt, then
   **Approve all N clean dish(es) in this section** (13 sections; 108 dishes). For each flagged card: TAKE-OUT and مندي لحم: ask Safa, type
   the price as printed in **Price as printed**, **Approve this dish** (or **Reject** with a reason); the six praise descriptions: edit the
   **Description as printed** box (remove the praise word), **Approve this dish**; the others: check the screenshot, correct the name if
   needed, approve. Then **Stamp: menu checked today**. Then the place's page: **Visibility** testers only, **Approve the place**.
2. **Adding a menu later** (any place): the Menus page's **Add a menu** box: photos with **Photograph a menu page**; or choose a PDF, Word,
   Excel or CSV file; or paste a link; or paste the text; tick "This is the whole menu" if it is; **Add**. Then GitHub, **Actions**,
   **menu-read**, **Run workflow**, branch **main**, `max_usd` 2, **Run workflow**. Re-importing the whole menu later lists only what changed.
