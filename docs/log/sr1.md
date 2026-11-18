<!-- Moved from docs/HANDOFF.md, "Status", on 18 November 2026 by session DOC2. The text below is unchanged; links to images under docs/screens/ no longer resolve (the images are in the private screens bucket; the console's Screens page lists them). -->

### SR1: search by meaning and facts, 16 November 2026 (Opus 5.5); migrations 0212 to 0216
Branch `claude/wizardly-rubin-puf4v8`. Pull requests #104 (step 1: the request set and today's baseline), #106 (steps 2 to 8: the search,
migrations 0212 to 0216), #107 (CI's permission check waits for Postgres over TCP; the live reading's after result) and the closing docs, all merged.

**The request set (step 1, before any search code).** `evals/search/requests.json`: 135 requests (Arabic 42, English 43, French 27,
Lebanese in Latin letters 23), each with what must come back (products, a kind, or "nothing fits") and the facts it asks for. It holds the
two voice notes of 15 November in all four languages, non-food requests ("fragrance-free shampoo for kids", "dog food for a puppy", cat food,
diapers by age), allergies, and requests that mix a fact, an audience and a count. `evals/search/baskets.json`: 52 basket requests (a dish
for N people, a week of lunchbox snacks, a budget basket). The facts the expected results rest on are a seeded set of approved test facts,
`evals/search/facts.json`, loaded into the test database only (`test/db/search-kit.ts`), never into staging: invented values on seed
products and six invented items (SR1T-*: a protein bar with and one without sugar, kids' rice cakes, a fragrance-free kids' shampoo,
gluten-free pasta, lactose-free milk). `evals/search/score.ts` judges a returned item by those test facts, apart from the search's own SQL.

**Baseline: today's `search_catalog` on the customer's words** (`evals/search/test/baseline.test.ts`, `evals/search/results/baseline.json`):

| | requests | right item in the first five | share | returned items failing a fact filter | "nothing fits" answered |
| --- | --- | --- | --- | --- | --- |
| all | 135 | 96 | 0.711 | 169 | 9 of 19 |
| Arabic | 42 | 33 | 0.786 | 40 | 2 of 5 |
| Latin letters | 23 | 17 | 0.739 | 20 | 1 of 2 |
| English | 43 | 29 | 0.674 | 76 | 5 of 10 |
| French | 27 | 17 | 0.630 | 33 | 1 of 2 |
| plain kinds | 46 | 45 | 0.978 | 0 | |
| one fact | 32 | 14 | 0.438 | 73 | |
| fact, audience and count | 10 | 2 | 0.200 | 17 | |

Today's search finds plain items well and fails on facts: "no sugar" brings sugar and coffee sachets, "low fat yogurt" brings full-fat
laban, "lactose free milk" brings ordinary milk, and an allergy is not a filter at all. Baskets: today nothing builds one (0 of 52).

**The search (steps 2 to 8; migrations 0212 to 0216).**

| Item | What SR1 built | Tested by |
| --- | --- | --- |
| (2) Hybrid search in Postgres (0212, 0214) | pgvector in the `extensions` schema; `product_embeddings` (one per item and model, from PD1's search document, re-embedded when its digest changes: `embedding_jobs`, `save_product_embeddings`); `find_products(query, filters, limit, embedding, model, cache_key)`: the word list (the language pack's `catalog_pack_scan` on the query and its singular, a family word such as "snacks" or «تسالي» for its kinds, and the words of the search document, a word most documents hold not counting), the meaning list (cosine distance, the nearest 40 within `meaning_max_distance`), merged by reciprocal rank fusion (k 60; a preferred shopping tag as a third list), then the hard filters. Order: the fused rank, then in stock, the nutrient asked for, how fast it sells, the price: no praise, no paid placement. One function for the Concierge's tool, the honest answer, the baskets and the website | `test/db/search-sr1.test.ts` (the meaning list with small invented vectors: an item found by meaning alone, a far one cut, fusion, filters on meaning matches), `evals/search/test/search.score.test.ts` |
| (3) Filters by approved facts only (0213) | `product_passes_filters`: sugar, fat, salt (the printed claim, else the approved panel against the EU claim thresholds in `settings.search.thresholds`), protein (claim, or 20% of energy), any nutrient ceiling or floor, printed claims, allergens and diets through `product_meets_restrictions` ("may contain" fails), species, life stage, age range, and an audience for a template with an age field (on food an audience only ranks). Only a fact-complete item passes a fact filter; a food filter never passes on a non-food item; an unknown filter key fails closed; no cache of facts (a withdrawn claim stops passing at once). Each match carries the records that made it pass, with their source | the same test file; the scorer judges every returned item by the test facts, written apart from the SQL |
| (4) The reading step | `packages/search/src/reading.ts` (its own package, so the website imports it without agent code; re-exported by `packages/agents`): ceilings and floors ("under 5 g of sugar", «أقل من ٥ غ سكر»), claims, allergies and diets (a restriction), species and life stage, age, audience, shopping tags, the count, the people, a budget, a basket. Code, no model. 35 cases in `evals/cases/sr1_search_reading.json`, 7 of them reading bugs found on the request set, each written as a failing case before its fix (feminine «خالية», «3ando» read as an age, «œufs», «pauvres en sel», «ل ٤» with `\b` after an Arabic letter, «للجمعة», «بأقل من») | `evals/test/search-reading.test.ts` |
| (5) Embeddings | `packages/agents/src/embeddings.ts` (the Worker's Workers AI binding, `"ai"` in `wrangler.jsonc`, with a 1.5 s timeout; the REST API for the evals), `packages/agents/src/search.ts`: the cached query embedding first (one call); else, when `settings.search.embeddings` is on and today's spend (`model_costs`, workflow `search`) is under `daily_cap_usd` (0.5), embed, record the tokens and dollars (`record_embedding_cost`, priced on the day's tokens: one query is about $0.0000001), search again with it and cache it (the key is the folded query; the words are not kept). Any failure or the cap: the words-only result stands. Embeddings are **off** until staging's documents are embedded | `test/db/search-sr1.test.ts` (cache, cost row, cap, failure, no price refused) |
| (6) Baskets (0215) | `build_basket(text, ask, filters)`: a dish for N from PD1's `dishes` and `dish_kinds` (the dish found in the words, `dish_in_text`), a week of lunchbox snacks from `portions` and the `lunchbox` tag, a budget basket from `basket_themes` (staples, party, cleaning; data); quantities by code (`basket_quantity`: the size printed, the count printed, `kind_piece_weights`, half-kilo steps), cheapest sufficient item first, every stated filter applied; kinds left out are said (not carried, not on sale, none passes). The turn prices it with `quote_order` and sends the card the customer confirms (`basketAnswer`, `packages/agents/src/honest.ts`) | `evals/search/test/baskets.score.test.ts`: **52 of 52** (before SR1 nothing built a basket from words: 0); the card waits for the tap (`test/db/search-sr1.test.ts`) |
| (7) Facts said with their source; the honest answer | `honestAnswer` now searches with `find_products`: items that pass are listed by code, each priced by `quote_order` and followed by its facts with their source ("the pack says “No added sugar”", "the nutrition panel on the pack: 0.4 g sugar per 100 g"); when nothing passes, PD1's honest answer runs (not carried, cannot confirm, or "none fits by what the packs say" when every checked item fails) and the demand row is logged. With only an allergy or a diet and nothing confirmed, the usual ordering path runs as before (the restriction on the card, 1.14). The Concierge's `search_catalog` tool goes through `find_products` with the filters read from the model's phrase and the customer's own words (the clause about that kind; every allergy anywhere), returns each match's facts, and unlocks only those facts for that product in the output guard | `test/db/search-sr1.test.ts` (the two voice notes, Arabic, the puppy), `test/db/honest-answer-pd1.test.ts` |
| (8) The website | `web_catalog_search(text, limit, filters)` (0216) calls `find_products`; the search page reads its box with the same reading step (`apps/web/src/pages/search.astro`, functional only); a miss is logged as `facts_unconfirmed` when items exist but none passes | `test/db/search-sr1.test.ts`, `test/db/web-catalog-web1.test.ts` |

**The request set after SR1 (free, words alone, `evals/search/results/word.json`):** 135 of 135 right in the first five (1.000; Arabic
42/42, Latin letters 23/23, English 43/43, French 27/27); **returned items failing a fact filter: 0** (baseline 169); every "nothing fits"
request returns nothing (19/19). Said plainly: this set was written in this session, the six invented items carry language-pack terms
written for them, and the reading cases were fixed on it, so 1.000 is the ceiling of a set that shares its author with the code, not a
measure of real customers. The live reading model's run (below) and the friends' test are the honest measures. The meaning subset
(m001 to m024, paraphrases with no catalogue word, added after the set was scored, to measure the meaning list): words alone 8 of 24,
today's search 8 of 24.

**The live reading model, once before and once after** (`evals/search/live.search.test.ts`, workflow `search-eval`; claude-haiku-5-5 reads
each request with the real prompt and schema, then the search runs on each line it reads; seeded test facts in PGlite; each run USD 0.0314,
recorded in `model_costs`, workflow `search-eval`, runs 43892126352-1 and 43895057208-1, both far under their USD 1 caps):

| | before: the reading, then `search_catalog` | after: the reading, then the reading step and `find_products` |
| --- | --- | --- |
| right item in the first five | 85 of 135 (0.630) | **119 of 135 (0.881)** |
| Arabic | 29/42 (0.690) | 36/42 (0.857) |
| Latin letters | 10/23 (0.435) | 16/23 (0.696) |
| English | 29/43 (0.674) | 40/43 (0.930) |
| French | 17/27 (0.630) | 27/27 (1.000) |
| returned items failing a fact filter | 153 | **0** |
| "nothing fits" | 9 of 19 | **19 of 19** |
| meaning subset (m001 to m024) | 8 of 24 | 8 of 24 |

Every one of the 16 misses after is a request the live model read with **no item line at all**: eight short requests for an item («مي», "mayy",
"bayd", "3adas", "zeit zeitoun", "7alib", «أكل قطط», "3asir lal wled") and eight fact requests ("drinks with no sugar", "vegan snacks",
"snacks under 5 g of sugar", "zebde bala mele7", «معكرونة خالية من الغلوتين» ...). The model read them the same way before. In the chat such a turn goes to
the Concierge's ask loop, whose `search_catalog` tool reads the customer's own words with the same reading step (free score on those
words: right); this harness runs no ask loop, so 0.881 is a floor for the chat, not its measure. The Latin-letter share (0.696) is below
0.85 for that reason only: six of its seven misses are bare one-word requests. Not tuned further on this set: the friends' test measures it.

**Embeddings (step 5): built, not yet measured.** The search-eval run on `main` (43900693145) called Workers AI over REST for bge-m3 and
qwen3-embedding-0.6b and got **401 Authentication error** for both: the repository's `CLOUDFLARE_API_TOKEN` deploys Workers but has no
Workers AI permission (founder action below). Nothing was spent and nothing was guessed. So `settings.search.embeddings` stays **off**:
every search on staging runs on words alone, which is the designed fallback and what all the numbers above measure. The comparison
(bge-m3 first, qwen3 if bge-m3 does not beat words on Arabic and Latin letters, both recorded; the meaning subset m001 to m024 is where
words alone get 8 of 24) runs once the token can call Workers AI; then staging's documents are embedded (`staging_embed:<model>`) and the
switch turned on (`switch:<model>`), both steps of `search-eval`. The Worker's own `AI` binding needs no token; it is deployed and unused
while the switch is off.

**Latency on staging** (`scripts/search/staging.mjs latency`, run 43900693145, 30 queries each, round trip from the runner): `search_catalog`
median 249 ms; `find_products` on words 285 ms, **36 ms added**; with a fact filter ("no sugar") 304 ms, **55 ms added**. Under the 150 ms
limit. The meaning list (an embedding call, about one Workers AI round trip, cached per query) is not in these numbers: embeddings are off.

**The language gate, once, at the end** (`language-pack`, `after` on main at 2a242e5, run 43900743255, claude-haiku-5-5, 990 cases):
**wrong products 0** (precision 1.000), **F1 0.915** (Lebanese Arabic 0.923, Latin letters 0.891, English 0.961, French 0.940, mixed 0.933);
249,490 tokens in and 156,748 out, about USD 0.10 at the 0092 list price, recorded in `model_costs`, far under its USD 5 cap. The gate holds.

**The sim-test, once, at the end: it did not run a conversation.** `sim-test` on main at 2a242e5 (run 43900749787, limit 50, budget USD 10)
stopped in about a minute while it copied staging into its throwaway database, before the first simulated customer and before any model call
(no `model-cost.json`; USD 0 spent): `new row for relation "product_facts" violates check constraint "product_facts_check"`. The cause is
in the simulator's copy, not in SR1: `evals/sim/world.ts` empties every column that points at a person, so an approved fact arrives with
`approved_at` set and `approved_by` empty, and 0021's check `(approved_by is null) = (approved_at is null)` refuses it. The run at 08:14
(43829590880) passed because staging then held no approved food fact; it now does (approved since, on staging; SR1's migrations write no
`product_facts` row). `evals/sim` belongs to LB1 in this wave, so SR1 did not change it and did not run the sim-test a second time: it would
fail the same way. **The fix, for the owner of `evals/sim`:** in the world loader, when a blanked column is `approved_by`, keep the row
approved by a stand-in staff party created in the throwaway database (or set `approved_at` to null and leave the fact out of the copy only
if that is the decision). With it, one limit-50 run measures SR1's last gate (zero silences after a hand-off, no code-checked failure class).

**Not proven (what only a live account or a later run can show):**
- **Search by meaning.** Built and tested against an in-process model only; the embedding comparison and the switch wait for the token
  (founder action 1 below). Until then every search is words alone.
- **The sim-test gate** (above): not measured, because the simulator could not copy staging.
- **The two voice notes of 15 November answered on staging by WhatsApp.** The request set holds them in all four languages and they pass
  with the live reading model in PGlite; a real reply on the staging number is the friends' test's to show.
- **The Arabic** of the fact-with-source lines and the basket lines (founder action 2 below). A basket's "not included" line names the
  kind in English inside an Arabic sentence (kind names are data in English today); a translation of kind names is a later data task.
- **The website search page** is functional only (design paused); it calls the same function and filters.
- **LB1's 0210 and 0211** were not on main when SR1 merged 0212 to 0216; whoever deploys them applies with `--include-all`.

**Changed expectations in older tests, and why.** `test/db/honest-answer-pd1.test.ts`: an approved record for a product of the kind used
to let the usual path answer; now the record must show the product fits (Kinder's panel says 52 g sugar, so it never passes "no sugar"),
and the honest answer runs. `test/db/web-catalog-web1.test.ts` holds unchanged: equal matches share a rank, so the same words in three
scripts give the same order. `test/ci/backup-bk0-workflows.test.ts`: the restore container is the pgvector image of the copy's major
(a copy of staging now holds the vector extension). `packages/agents/test/messages.rules.test.ts`: the new messages rendered (snapshots
only grew). CI's real-Postgres suites install the runner's `postgresql-<n>-pgvector`, and the permission check runs `pgvector/pgvector:0.8.0-pg17`.

### Founder actions (SR1)
1. **Let the Cloudflare token call Workers AI** (search by meaning stays off until then; words alone answer meanwhile). dash.cloudflare.com,
   your avatar (top right), **My Profile**, **API Tokens**; on the token the repository uses as `CLOUDFLARE_API_TOKEN`, **⋯**, **Edit**;
   under **Permissions**, **+ Add more**: **Account**, **Workers AI**, **Edit**; **Continue to summary**, **Update token**. The token's value
   does not change, so nothing in GitHub changes. Then tell the planning chat "Workers AI token fixed": a session runs `search-eval` with
   `embed` (the comparison, under USD 1), and only if a model beats words alone, `staging_embed:<model>` and `switch:<model>`.
2. **Arabic to read** (`docs/ARABIC_REVIEW.md`, "SR1"): the lines that state a fact with its source, and the basket lines.
