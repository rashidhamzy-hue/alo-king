# Product data standard

The founder's document of 16 November 2026, "Alo King: product data, search and 2026-27 practices", converted by session PD1
(step 0). Where this document and a session prompt differ on a field list, this document wins; on scope, the prompt wins. Decisions that
follow from it are in `docs/DECISIONS.md` ("Founder decisions, 16 November 2026"); the sessions that build it (PD1, SR1, LD1, B1d, DS2,
WEB3) are in `docs/NEXT_SESSIONS.md`. What PD1 built from it is in `docs/HANDOFF.md`, "PD1".

---

## Alo King: product data, search and 2026-27 practices

### Summary

The bot cannot answer "snacks with no sugar for 5 kids" because the catalogue holds almost no such products and not one of the 291 items has an approved food fact. The fix is a product data standard that every item, now and future, must meet before it goes live, plus search that can filter by those facts. Both matter more than any design work, because in 2026 the leading grocery apps win on data and search.

- **Data first.** Every grocery item and every vendor dish gets the same complete record: names in four languages, pictures, label facts (ingredients, allergens, nutrition per 100 g, printed claims), audience and occasion tags, storage, supply and search words.

- **Filled automatically, approved safely.** Barcode lookups, label photos and supplier sheets fill the record; exact matches go live on their own, anything uncertain waits for a person.

- **Search that understands intent.** Keyword plus meaning-based search, inside the existing Postgres, with filters for diet, sugar, protein and age.

- **The bot honest about gaps.** When nothing fits, it says so, offers the nearest real item and records the request as unmet demand.

- **Design paused on Claude.** Rashid designs in Lovable or elsewhere; the result comes back as a visual reference, not as code.

### Why the two voice notes failed

Five causes stack up; the repository explains all of them. The exact replies Rashid received are on staging and were not checked here.

| #   | Cause                                        | What the repository shows                                                                                                                                                                                                                         |
|-----|----------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1   | Nothing in stock fits                        | No protein bars at all. The only item with "protein" in its name is Balance Protein Crackers (70 g). Only three items say "no sugar" or "zero sugar": two Lipton iced teas and a Cafe21 coffee stick. No sugar-free snacks for children           |
| 2   | Zero approved food facts                     | Of 291 items, 86 have a nutrition proposal and 35 an ingredients proposal waiting from Open Food Facts; none is approved. By the founder's rule, the bot may not state a fact without an approved record, so it cannot say any item is sugar-free |
| 3   | The safety check blocks the words themselves | The output check refuses any reply containing "protein" or "بدون سكر" unless an approved record came back, even when the word is part of the product's printed name or repeats the customer's own request                                         |
| 4   | No fields for what was asked                 | There is no field for "no added sugar" as a printed claim, no sugar figure that can be filtered (nutrition is one block of text per product), and no audience or occasion tag such as "kids" or "lunchbox"                                        |
| 5   | Search cannot filter by facts                | Search matches words and names only; it cannot answer "snacks, under 5 g sugar, for children"                                                                                                                                                     |

**What the right answer looks like, with today's catalogue:** "We don't carry protein bars yet, I've noted it. For no-sugar snacks, I can't confirm sugar for our snacks yet. The packs that say 'no sugar' are Lipton Ice Tea Zero Sugar ($0.69) and Cafe21 2-in-1 No Sugar ($0.24)." Then the request is logged as unmet demand, so the evening purchase proposal can add the products customers ask for.

**What it looks like once the data exists:** "Here are 6 snacks whose pack says 'no added sugar', each under 5 g sugar per 100 g. For 5 kids I'd put 2 of each in the basket; want me to?"

### The product data standard: every item, by category

Every item gets a common core, plus the fields of its own category's template: food fields never appear on a cleaning product, and a shampoo or a pet food gets the data its own category needs. The system picks the template from the category; a new category needs its template before its first item goes live. Readiness has two levels, so the catalogue is not frozen while facts are collected: sellable (the core is complete; the item can be ordered, and its facts show as "not confirmed yet") and fact-complete (its template is complete too; only these items can answer a filter such as "no added sugar" or "fragrance-free"). The console shows both levels for every item.

**The core, for every item**

| Group                      | Fields                                                                                                                      | Source                                      | Approved by                                                       |
|----------------------------|-----------------------------------------------------------------------------------------------------------------------------|---------------------------------------------|-------------------------------------------------------------------|
| Identity                   | Barcode (GTIN), brand, name in Arabic, English and French plus the spoken Lebanese name, size and unit, pack count, variant | Barcode lookup, supplier sheet, label photo | Automatic on an exact barcode match; otherwise a person           |
| Selling                    | Price in USD, cost, margin, sell unit, case size, limits per order, active or paused                                        | Supplier invoice, founder                   | Price changes over 10% need a second approver (built)             |
| Pictures                   | Front pack shot (clean, 1200 px); back of pack wherever the back carries facts or warnings                                  | Supplier, web, own photos at receiving      | Automatic when barcode and printed name match; otherwise a person |
| Category and kind          | Category, sub-category, product kind ("protein bar", "dish soap"), substitute group, the category template it follows       | Rules plus AI proposal                      | Automatic by rules                                                |
| Audience and occasion      | Kids, toddlers, lunchbox, breakfast, party, Ramadan, cleaning day                                                           | AI proposal                                 | Automatic: shopping tags, never health or safety claims           |
| Storage, handling, packing | Storage zone, temperature, fragile, heavy, chilled bag; **packed apart from food** for chemicals                            | Rules by category, label                    | Automatic by rules                                                |
| Supply                     | Supplier, supplier code, lead time, case pack, reorder point, origin                                                        | Supplier, Bassem                            | A person                                                          |
| Search words               | Every way a customer says it, in four languages and local names                                                             | AI proposal plus rules (built)              | Automatic by the existing rules                                   |

**The category templates**

| Template (categories)                                                                                                               | Extra fields                                                                                                                                                                                                                                                                                                                                                                                     | Required to be fact-complete                  | Approved by                                                                                                                       |
|-------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| Packaged food and drinks (pantry, snacks, canned, cooking, home bake, cereals, dairy, deli, frozen, healthy, beverages, hot drinks) | Ingredients as printed; the 14 allergen groups (contains, may contain, free); nutrition per 100 g or 100 ml as numbers (energy, fat, saturated fat, carbohydrate, sugars, added sugars where printed, protein, fibre, salt) and serving size; printed claims ("no added sugar", "high protein", "gluten free"); caffeine for drinks; certifications with evidence; diet derived from ingredients | Ingredients, allergens, nutrition             | Nutrition, ingredients and claims automatic when label photo and barcode record agree; allergens and certificates always a person |
| Fresh produce                                                                                                                       | Variety, origin, sold by kg or fixed pack with average weight, season                                                                                                                                                                                                                                                                                                                            | Origin, sale unit                             | Automatic by rules                                                                                                                |
| Meat and poultry                                                                                                                    | Animal, cut, fresh or frozen, weight per pack, use-by, halal certificate of the supplier                                                                                                                                                                                                                                                                                                         | Cut, weight, halal evidence if halal is shown | Halal always a person, with the certificate                                                                                       |
| Bakery and daily bread                                                                                                              | Baked by, baked daily or packaged, ingredients and allergens as declared by the bakery, best-before                                                                                                                                                                                                                                                                                              | Allergens as declared                         | A person (bakery's declaration)                                                                                                   |
| Water                                                                                                                               | Volume, pack count, type (mineral, drinking), gallon exchange and deposit                                                                                                                                                                                                                                                                                                                        | Volume, type                                  | Automatic                                                                                                                         |
| Cleaning and household                                                                                                              | Use and surface, active ingredient as printed, hazard warnings and pictograms (corrosive, flammable, irritant), "keep away from children", scent, dilution, count                                                                                                                                                                                                                                | Hazard warnings as printed                    | A person for hazard warnings; the rest automatic                                                                                  |
| Beauty and personal care                                                                                                            | Ingredients as printed (INCI list), hair or skin type, printed claims (fragrance-free, paraben-free, SPF), age (adult or kids), period after opening                                                                                                                                                                                                                                             | Ingredients, age                              | Automatic from the label photo; a person for any claim that sounds medical                                                        |
| Baby and child                                                                                                                      | Age range; size and weight range for nappies; count; baby food follows the food template plus the age printed                                                                                                                                                                                                                                                                                    | Age range                                     | Automatic from the pack                                                                                                           |
| Pet zone                                                                                                                            | Species, life stage, pet weight range, ingredients and analytical constituents (protein %, fat %) as printed, pack weight                                                                                                                                                                                                                                                                        | Species, life stage                           | Automatic from the pack                                                                                                           |
| Gas and household services (future)                                                                                                 | Cylinder size, exchange or new, safety rules for the rider                                                                                                                                                                                                                                                                                                                                       | Size, exchange                                | A person                                                                                                                          |

**The safety line stays as the founder set it:** an allergen, a halal status, a health claim or a hazard warning is never inferred by AI; it is read from the pack, the certificate or the supplier's declaration. The code already treats cleaning, beauty, baby and pet categories as non-food, so food words never attach to them.

### The standard for vendor menu items

A restaurant dish has no barcode or printed label, so the vendor is the source: everything about food is shown as "declared by the vendor", and the vendor accepts that responsibility in the terms.

| Group                 | Fields                                                                                                                                                 | Source                                           | Approved by                                         |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|-----------------------------------------------------|
| Identity              | Dish name in Arabic, English and French plus the spoken name, menu section, short description (what is in it, not praise)                              | Menu photo, PDF or link, read by AI              | The vendor confirms on WhatsApp, then ops           |
| Price and options     | Base price; option groups (size, bread, extras, without, spice level) each with required or optional, minimum and maximum choices and the price change | Menu, vendor                                     | The vendor confirms; ops approves before going live |
| Pictures              | A real photo of the dish, or none; never a stock photo of another restaurant's dish                                                                    | Vendor, own photo                                | Ops                                                 |
| Portion               | Serves how many, weight or pieces where known                                                                                                          | Vendor                                           | Vendor                                              |
| Availability          | Hours per day, sold-out switch, days off, preparation time                                                                                             | Vendor, changed by WhatsApp message with one tap | Vendor                                              |
| Declared food facts   | Allergens, halal, vegetarian, vegan, fasting, contains sugar or not, spicy                                                                             | Vendor's declaration, stored with its date       | Vendor, shown as "declared by the vendor"           |
| Audience and occasion | Kids' portion, family meal, breakfast, late night, Ramadan iftar                                                                                       | AI proposal                                      | Automatic (shopping tags)                           |
| Search words          | Every way a customer says the dish ("مناقيش زعتر", "man2oushe", "zaatar pie")                                                                          | AI proposal plus rules                           | Automatic                                           |

The vendor's own packaged goods (a bakery's sealed biscuits, a butcher's packed meat) follow the grocery standard above, with the vendor as the supplier.

### How every new item and vendor gets filled

Adding an item should take a person under a minute: one barcode scan or one supplier line starts it, the system fills the rest, and only uncertain fields wait in the approval queue.

**For a grocery item**

1.  **Start:** a barcode scan at receiving, a supplier invoice line, or a customer request logged as unmet demand.

2.  **Look up by barcode:** Open Food Facts and retailer listings for name, brand, size, ingredients, nutrition and pictures.

3.  **Read the pack:** a front and back photo at receiving, read by a vision model into the fields of the item's category template (for food: ingredients, allergens, nutrition numbers, printed claims; for a cleaning product: hazard warnings and active ingredient; and so on).

4.  **Compare the sources:** where the barcode lookup and the label photo agree, the field is marked confirmed.

5.  **Propose the rest:** names in four languages, kind, substitute group, audience and occasion tags, search words.

6.  **Approve:** exact matches go live on their own; allergens, certificates and anything where sources disagree go to the console's Approve queue.

7.  **Re-check:** when a supplier changes a recipe or a pack, a new label photo replaces the old facts; facts expire after 12 months without a re-check.

**For a vendor**

1.  The vendor signs up, accepts the terms and sends the menu as a photo, PDF or link.

2.  AI reads it into dishes, prices and option groups.

3.  The vendor checks it on WhatsApp, fixes it with a message, and confirms with one tap.

4.  Ops approves, places a staff test order, and switches the vendor on.

5.  Later changes ("no brown bread today", "40 minutes tonight") arrive by message and take effect with one tap, with undo for 10 minutes; new dishes and price changes go to ops.

**Measured weekly:** the share of active items with every required field (target 100%), the share with nutrition numbers, items waiting for approval, and unmet requests by kind (for example "protein bars: 3 requests").

### Data that makes recommendations good

Facts let the agent answer "is it sugar-free?"; recommending well needs a second layer: how products relate to each other, to meals, to people and to money. Most of it can be proposed by AI and checked by rules, because none of it is a health or safety claim.

| Data                                      | What it lets the agent do                                          | Example                                                                               |
|-------------------------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| Substitutes                               | Offer the closest real swap when an item is missing or asked for   | No Lipton zero sugar: another zero-sugar iced tea of the same size                    |
| Complements ("goes with")                 | Suggest one item that completes the basket                         | Hummus with pita; charcoal with meat                                                  |
| Lebanese dishes and recipes as baskets    | Turn "I want things for mjadra" or "tabbouleh for 6" into a basket | Mjadra: lentils, rice or burghul, onions, oil                                         |
| Portions                                  | Get quantities right for a number of people                        | Bread bags per person per day; rice per person for a main dish; snack packs per child |
| Pack format                               | Fit the occasion                                                   | Single-serve for lunchboxes, family pack for gatherings, multipack                    |
| Unit price (per kg, per litre, per piece) | Answer "the cheapest" and "a basket under $30" honestly           | Two sizes of the same oil compared per litre                                          |
| Taste and type                            | Match a request in plain words                                     | Salty or sweet, spicy, crunchy, chocolate, plain                                      |
| Local and brand origin                    | Serve customers who prefer Lebanese products                       | "Made in Lebanon" as printed, local producer                                          |
| Seasons and occasions                     | Surface the right items at the right time                          | Ramadan (dates, jallab, qamar el din), back to school, summer, Christmas              |
| Our own sales signals                     | Rank by what customers here actually buy and reorder               | Bought together, reordered weekly, accepted as a substitute                           |
| The customer's own memory                 | Personalise without guessing                                       | Stated brands, stated restrictions, "the usual" (built, with consent)                 |
| One search document per item              | Let search by meaning work in four languages                       | All of the item's fields and words in one text, refreshed when the item changes       |

**The rules for recommending stay as decided:** one suggestion per order at most, the customer's restrictions always win, facts only from approved records, no praise words or ratings, and ranking by facts (fits the request, in stock, unit price), never by opinion. A set of at least 50 real requests ("breakfast for 4", "lunchbox snacks for the week", "mjadra for 6", "a basket under $20") with the expected basket is scored on every change.

### What the leaders do in 2026-27, and what Alo King adopts

The 2026 race is no longer delivery speed alone: every leading grocery app now has an AI assistant that turns a request, a list or a photo into a cart, and it works only because the product data underneath is structured. Alo King already has the assistant (on WhatsApp); what it lacks is the data.

| Practice                                                                                     | Who does it (2026)                                                                                                                                    | Alo King                                                                                              |
|----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| An assistant that turns a request into a cart ("a week of kids' lunches", "order my usuals") | Instacart Clementine (September 2026), Uber Eats Cart Assistant, DoorDash                                                                             | Have it on WhatsApp; add it to the website; needs the data below to answer diet and audience requests |
| A photo of a handwritten list becomes a cart                                                 | Instacart, Uber Eats                                                                                                                                  | Planned (BK1); move earlier, it suits older customers                                                 |
| Saved dietary preferences applied everywhere                                                 | Instacart: 14 preferences including high protein, gluten-free, lactose-free                                                                           | Add "no added sugar", "high protein", "kids", fasting, plus allergies (already kept with consent)     |
| Nutrition and diet tags extracted by vision models from pack images                          | Instacart Health Tags                                                                                                                                 | Same method, with the founder's approval rule on top                                                  |
| Allergens and diet as pass/fail filters, filled first; nutrition next                        | Grocery data specialists' guidance                                                                                                                    | The order of work in the data session                                                                 |
| Never infer a safety claim from a name or photo; the pack is the source                      | Grocery tagging guidance, 2026                                                                                                                        | Already the founder's rule; keep it                                                                   |
| Hybrid search: keywords plus meaning, under business rules                                   | Standard practice in 2026; large gains in relevance and fewer zero-result searches reported                                                           | Add inside Postgres (pgvector)                                                                        |
| Catalogues readable by AI agents (structured data, product feeds)                            | Google's Universal Commerce Protocol (January 2026), OpenAI's Agentic Commerce Protocol; Instacart takes orders started in ChatGPT, Claude and Gemini | Structured product data on the website now (cheap); agent checkout only when it reaches Lebanon       |
| Deals and cheaper alternatives inside the assistant's answer                                 | Instacart Clementine                                                                                                                                  | Later, with vendor-funded offers, clearly labelled                                                    |

**What this means for Alo King:** the voice-note ordering is already ahead of most of Lebanon; the gap to the global leaders is the catalogue's data and search, and that is where the next sessions should go.

### Technology choices

Keep the stack; add three things to it. Nothing here needs a paid plan before the pilot.

| Need                                                                   | Choice                                                                                                                                                    | Why                                                                                     |
|------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Search by meaning ("snacks for kids", "something sweet without sugar") | **pgvector** in the existing Supabase Postgres, combined with the built word search and the language pack (hybrid search), then filters by approved facts | One database, no extra service; hybrid search is the 2026 standard                      |
| Embeddings for Arabic, Arabizi, English and French                     | A multilingual embedding model; Cloudflare Workers AI (bge-m3) is the first one to test, since the Workers already run there                              | Runs beside the gateway; cheap; must be scored on Lebanese queries before it is trusted |
| Nutrition and claims as filterable numbers                             | New columns or a typed view over the approved product facts (sugars, protein, salt per 100 g; printed claims as a list)                                   | "Under 5 g sugar" and "high protein" become one query                                   |
| Pack reading                                                           | The built label-scan path, extended to every field of the standard                                                                                        | Already in the code; it just needs to run on every item                                 |
| Barcode lookup                                                         | Open Food Facts first (113 of 291 items found), retailer listings second                                                                                  | Free; already wired                                                                     |
| Structured data on the website                                         | Product JSON-LD with price, stock, nutrition and claims on every product page                                                                             | Search engines and AI agents read it; cheap to add                                      |
| Assistant on the website                                               | The same Concierge as WhatsApp, in a chat panel                                                                                                           | One brain, two doors                                                                    |

**The safety check stays, narrowed.** It exists so the bot never claims a product is sugar-free, high in protein or healthy without an approved record, and that rule is right. What is wrong is that it also blocks the word when it is simply part of a name. The narrowed rule:

- **Allowed as a name:** a food word inside the exact name of a product or dish that a tool returned this turn, or inside the customer's own words said back. "We have Balance Protein Crackers, $0.69", "X Protein Bar", a restaurant's "Protein Chicken Wrap", "you asked for protein bars".

- **Still a claim, still refused without an approved record:** "this bar has 20 g of protein", "it's sugar-free", "good for kids", "healthy".

- **With an approved record:** the bot states the fact with its source ("the pack says no added sugar").

### Design from Lovable as a reference

The Lovable design should come back as a picture of what to build, not as code to paste in: Lovable writes a React app, while the Alo King website is server-rendered Astro and the console uses no React by decision.

- **What Rashid hands over:** screenshots of every screen at phone and laptop size, the colours, fonts and spacing Lovable used, and a short screen recording of the motion he likes.

- **What a session does with it:** puts the colours and type into the one token file, rebuilds the shared components to match, then restyles the pages already built in DS1. The data, rules and tests stay as they are.

- **What stays fixed whatever the design:** Arabic first and right-to-left, fast on a slow phone, no star ratings or praise words, food facts shown with their source, "Order on WhatsApp" on every page.

- **Changing the brand:** the vivid category colours in the Lovable prompt go beyond the ink-and-gold decision; if Rashid and the founder prefer them, it is one edit to the token file.

### The message for the Fable planning chat

Rashid pastes this into the Fable chat with this document attached; the chat writes the session prompts.

Attached: "Alo King: product data, search and 2026-27 practices"
(founder, 16 Nov 2026). Decisions, a new priority, and my reading of
main as Rashid downloaded it this morning.

1. Design is paused on Claude. Rashid designs in Lovable or elsewhere
and will send screenshots, tokens and motion as a reference. When it
arrives, plan one session that applies it to packages/ui and the
DS1 pages; do not import Lovable's code.

2. A voice note asking for "snacks with no sugar for 5 kids" and
another asking for "protein bars with no sugar" both failed.
Section 2 of the document lists the five causes. Plan the fix as
two sessions and decide whether they run before T1 (my view: PD1
before T1, because the friends will ask exactly this):
- PD1, product data standard (Opus, high):
a) the common core and the category templates of section 3: food
fields only on food; cleaning, beauty, baby, pet, water, meat,
produce and bakery each with their own fields; a new category
cannot go live without its template;
b) nutrition as numbers, printed claims, audience and occasion
tags, hazard warnings, supply fields, and the vendor dish
standard of section 4;
c) two readiness levels: sellable (core complete; facts shown as
"not confirmed yet") and fact-complete (template complete; only
these answer fact filters), both visible per item in the
console. The catalogue must not freeze while facts are
collected;
d) the intake pipeline and auto-approval rules of section 5 for
every current and future item, vendor and dish; allergens,
halal certificates and hazard warnings always go to a person;
e) the narrowed safety check of section 8 ("Technology choices"): a food word inside the
exact name of a product or dish a tool returned this turn, or
in the customer's own words, is a name, not a claim; a stated
fact still needs an approved record. Failing tests first,
including "X Protein Bar" and a dish called "Protein Chicken
Wrap";
f) the recommendation data of section 6: substitutes, complements,
Lebanese dishes as baskets, portions per person, pack format,
unit price, taste and type, local origin, seasons, and one
search document per item; proposed by AI and checked by rules,
none of it a health claim;
g) the honest answer when nothing fits, with the request logged
as unmet demand;
h) an enrichment run over the 291 items into the approval queue,
within a dollar cap. 115 items are not in Open Food Facts and
34 have no barcode: say how their facts get filled before stock
arrives (retailer listings, supplier sheets) and at the first
receiving (label photos).
- SR1, search by meaning and facts (Opus, high): hybrid search in
Postgres (pgvector plus the built word search and language pack),
filters by approved facts (sugar, protein, diet, allergens,
audience, category template fields), used by the chat and the
website, scored on a new set of at least 100 Lebanese requests in
four languages, including the two that failed and non-food ones
("fragrance-free shampoo for kids", "dog food for a puppy"), plus
the 50 basket requests of section 6 ("mjadra for 6", "lunchbox
snacks for the week", "a basket under $20"). Say whether SR1 also
cuts the wrong products that remain (25 to 29 per 150 simulated
customers after B1c and CX1); if not, plan the fix.

3. Assortment: list what customers will ask for that we do not stock
(protein bars, sugar-free snacks for children and similar) as a
proposal for the founder's purchasing list.

4. The website should also carry structured product data (JSON-LD)
and, later, the same assistant as WhatsApp in a chat panel. Fit
these into the plan where you think best.

5. Gate A as I read main: HO1, B1a, B1b, B1c, CX1, DS1, D4b, OPS1,
COST1, PIX and BK0 merged; simulated customers pass 89 of 150 with
zero silences. Left: T1, the pictures approved, and the Arabic
read (CX1's privacy line first). Confirm this, list every open
founder action from HANDOFF in one place with exact steps, and say
what gate A still needs from me.

Keep every CLAUDE.md invariant. Reply with the updated wave table and
the paste-ready prompts for PD1 and SR1.

### Sources

Repository rashidhamzy-hue/alo-king as downloaded 16 November 2026: supabase/seed/catalog.csv, data/proposals/product-facts-summary.json, packages/agents/src/output-guard.ts, packages/agents/src/pack-rules.ts, supabase/migrations/0021_food_facts.sql, docs/HANDOFF.md. External pages, read 16 November 2026:

- [TechCrunch: Instacart launches Clementine](https://techcrunch.com/2026/09/09/instacart-launches-an-ai-grocery-shopping-assistant-called-clementine)

- [Canadian Grocer: Clementine and saved dietary preferences](https://canadiangrocer.com/instacarts-clementine-tackles-dinner-decision-fatigue-ai)

- [Stellagent: Clementine and orders started in ChatGPT, Claude and Gemini](https://stellagent.ai/insights/instacart-clementine-ai-shopping-assistant)

- [Instacart: Smart Shop and Health Tags](https://company.instacart.ca/updates/introducing-smart-shop-personalization)

- [Retail TouchPoints: 14 dietary preferences](https://www.retailtouchpoints.com/features/news-briefs/instacart-debuts-ai-powered-tools-to-supercharge-healthy-food-shopping)

- [eWeek: Uber Eats Cart Assistant](https://www.eweek.com/news/uber-ai-cart-assistant-grocery-shopping/)

- [Anglera: attribute schema for grocery](https://www.anglera.com/blog/grocery-cpg-attributes)

- [Local Express: allergen and dietary tagging in 2026](https://www.localexpress.io/post/allergen-and-dietary-tagging-for-grocery-ecommerce)

- [Sparq: hybrid search in 2026](https://www.sparq.ai/blogs/hybrid-search-architecture-shopify-ai-rules-2026)

- [FocusReactive: pgvector, Algolia and Pinecone for catalogues](https://focusreactive.com/blog/vector-search-architecture-for-e-commerce-catalogs-integrating-algoliapinecone-via-headless-cms/)

- [eMarketer: Google's Universal Commerce Protocol](https://www.emarketer.com/content/google-brings-checkout-ai-mode-races-rivals-agentic-commerce)

- [Respan: agentic commerce engineering, May 2026](https://www.respan.ai/resources/agentic-commerce-engineering)

---

## Appendix: the coordinator's notes of 16 November

From the coordinator's note of 16 November (morning), sections 5 and 6, kept here because PD1's run and the purchasing list use them.

### The 115 items not in Open Food Facts and the 34 with no barcode

- **The 34 with no barcode** are produce, meat, bakery and eggs. Their templates ask for origin, sale unit, cut, weight, the supplier's halal certificate and the bakery's declaration, not nutrition. Rules fill what rules can; the supplier sheet (action 4) fills the rest; a person approves halal and allergens.
- **The 115 not in Open Food Facts** already have a research file each in `data/research/` (brand and retailer pages, written 14 November). PD1's run turns those into proposals in the new fields. Where two published sources agree, nutrition numbers and ingredients go live. Where only one page exists, or none, the item stays "sellable" with "not confirmed yet" and goes on the shelf-visit list (action 3).
- **At the first receiving**, a front and back label photo replaces every web fact (the rule "label beats web" is already in the database), and allergens are approved from the pack.

### Assortment proposal for the purchasing list

Checked against the 291. Rule: tier 1 goes on the next purchase list in small quantities; tier 2 waits until the unmet-demand log shows three requests from two different customers in 14 days.

| Tier | Kind | What the catalogue has today |
|---|---|---|
| 1 | Protein bars (two or three flavours) | None; one protein cracker |
| 1 | Sugar-free or no-added-sugar snacks for children (fruit pouches, plain biscuits, small juice boxes with no added sugar) | None; the only "zero sugar" items are two iced teas and a coffee stick |
| 1 | Dates, dried fruit, raw unsalted nuts in family packs | None; nuts only as 14 to 25 g salted snack packs |
| 1 | Oats, muesli or granola | None; one cereal bar |
| 1 | Nappies sizes 1 to 4, and infant formula by stage | Sizes 5 and 6 only; no formula, no baby food |
| 1 | Dog food (adult and puppy), dry cat food | Two wet cat foods and litter; nothing for dogs |
| 1 | Honey, halawa | None; one jam, one tahini |
| 2 | Gluten-free bread, pasta or biscuits | None (asked for last night) |
| 2 | Lactose-free milk; oat, almond or soy drink | None |
| 2 | Sweetener (stevia), sugar-free chocolate or biscuits | None |
| 2 | High-protein yoghurt or milk drinks | Two low-fat Greek yoghurts |
| 2 | Kids' shampoo and soap without fragrance; sunscreen | One baby shampoo |
| 2 | Batteries, lighters, candles, charcoal | Not found |
| 2 | Brown rice, wholewheat pasta, rice cakes in more flavours | One corn and rice cake |

Brands and pack sizes are Bassem's and the supplier's choice. Every new item enters through PD1's intake, so it arrives with its template filled.
