# Web research per product (sessions R1, R2, R3; loaded by P2), 14 November 2026

Fable sessions research each catalog item on the public web with their own WebSearch and WebFetch tools and write one file per item:
`data/research/AK-0123.json`. Nothing here is applied or approved. Session P2's workflow reads these files in GitHub Actions,
downloads the pictures, runs the vision check, and stores pictures and facts as **proposals** for a person to approve in the console.

Rules for researchers
- Every value is copied from a page you opened in this session, with that page's address. Never from memory, never from a similar
  product, never from another size or flavour. If no page states it, leave it out. Missing is correct; guessed is a defect (invariant 15).
- The product must match brand, product, variant and size. Prefer, in order: the brand's own site, Open Food Facts, a large retailer
  (Lebanon or Gulf first, because recipes differ by market). Record the market the page is for.
- No praise, health or diet claims of your own (invariant 14). Diet labels only when the page shows the pack's own claim or certificate.
- Loose produce and unbranded items: picture only; no ingredient or nutrition research.

File shape
```json
{
  "sku": "AK-0123",
  "matched": { "brand": "", "product": "", "size": "", "barcode": "", "confidence": "exact | likely | unsure", "note": "" },
  "pictures": [
    { "image_url": "https://...", "page_url": "https://...", "site": "", "site_kind": "brand | retailer | open_food_facts | other",
      "looks": "one pack, plain background, no watermark/logo/price/text, front view" }
  ],
  "ingredients": { "text": "", "language": "en | ar | fr", "page_url": "", "market": "" },
  "allergens":   { "contains": [], "may_contain": [], "quote": "", "page_url": "" },
  "nutrition":   { "per": "100 g | 100 ml | serving (xx g)", "energy_kcal": null, "fat_g": null, "saturated_fat_g": null,
                   "carbohydrate_g": null, "sugars_g": null, "fibre_g": null, "protein_g": null, "salt_g": null, "sodium_mg": null,
                   "page_url": "" },
  "diet_labels": [ { "label": "halal | vegetarian | vegan | gluten_free | lactose_free | organic", "basis": "what the pack or certificate says", "page_url": "" } ],
  "storage": { "text": "", "page_url": "" },
  "origin":  { "country": "", "page_url": "" },
  "not_found": [ "ingredients", "nutrition" ]
}
```
Up to five pictures per item, best first. `quote` is the literal allergen sentence from the page. Omit a block rather than fill it with nulls.
