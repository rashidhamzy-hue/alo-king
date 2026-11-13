# Proposals (build plan 5.18, session N1)

Everything in this folder is a **proposal**. None of it has been applied to the catalog, the database or a customer message.
A person approves; another task applies. Files are written by `scripts/product-data/propose-catalog.mjs` and
`scripts/product-data/fetch-product-data.mjs`, run on staging by `.github/workflows/product-data.yml`.

| File | What it is | Who approves | Used by |
| --- | --- | --- | --- |
| `categories.json` | 12 to 15 customer categories in Arabic and English, in display order, and the category and place of each of the 291 items | The founder approves the list (1.21 step 1) | Task 1.21 (session K1): the catalog feed and the collections |
| `names.json` | A cleaned English and Arabic display name and pack size for each item, next to the current name. `added_words` lists words the model had to add (spelling fixes); `ar_source: model_written` means the Arabic name needs an Arabic reader | The ops lead, item by item; refused items are in `rejected` and keep their current name | Whoever applies catalog names (console catalog page) |
| `product-facts-summary.json` | Counts from the last run of the facts step: how many items got a proposed fact of each kind | Nobody: it is a report | `docs/HANDOFF.md` |

The **product facts** (ingredients, allergens, nutrition panel, diet labels) are not files: they are rows in `product_facts`,
status `partial`, source `open_food_facts`, each with the Open Food Facts text it came from. They are never approved by code
(the database refuses it). A person confirms every field against the pack at intake (5.15) and records it as source `label`;
only then can a customer be told. No allergen proposal for an item means **unknown**, not allergen-free.

Rules the generators follow, each checked in code and tested (`scripts/product-data/test/`):
- A model writes no food fact. It maps Open Food Facts' own text onto our fourteen allergens with a quote that must be a literal part of that text and be about that allergen, and it renders the ingredient list in Arabic (script, length and every number checked).
- Names and categories may not gain praise, health, diet, religion or freshness words, and no number may change (invariants 14 to 16). The catalog's existing "Healthy" category is not carried over.
- Open Food Facts data is under the Open Database Licence; its attribution travels with every proposed fact.
