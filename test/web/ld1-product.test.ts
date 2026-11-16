// Session LD1 (website product data). The product page and its JSON-LD are built from ONE read (web_catalog_product, 0218), so they can never
// disagree. On the real migrations and seed, in PGlite, as the role web_channel; no browser, no server, no model.
//   1  the page's view follows the item's own template; an unapproved field reads "not confirmed yet" in Arabic, English and French;
//      an approved fact shows its source; nothing unknown reads as safe
//   2  the JSON-LD (schema.org Product): name in the page's language, approved pictures only, brand, gtin only when real, size, an Offer
//      in USD with availability from stock, nutrition and printed claims only for a fact-complete item, no person's name; ItemList
//   3  for every template, page and JSON-LD agree
//   4  every product page's JSON-LD parses and has the required Product and Offer fields, over every item the site shows
import { beforeAll, describe, expect, it } from "vitest";
import { asSupabase, openTestDb, type TestDb } from "../db/harness";
import { makeFactComplete } from "../db/fact-kit";
import { LANGS, DICTS, t, type Lang } from "../../apps/web/src/lib/i18n";
import { productView, type ProductView } from "../../apps/web/src/lib/product";
import { categoryJsonLd, productJsonLd, jsonLdScript } from "../../apps/web/src/lib/jsonld";
import { FIELD_LABELS, VALUE_WORDS } from "../../apps/web/src/lib/fields";
import { pictureUrl } from "../../apps/web/src/lib/db";

const ORIGIN = "https://shop.example.test";
const ENV = { SUPABASE_URL: "https://db.example.test", PICTURE_TRANSFORMS: "off" };
const PERSON = "Zed Q. Reviewer";
let db: TestDb; let ops: string; let n = 0;

async function read(sku: string): Promise<any> {
  const inner = asSupabase(db);
  await db.pg.exec("set role web_channel");
  try { return (await inner.rpc("web_catalog_product", { p_sku: sku })).data; } finally { await db.pg.exec("reset role"); }
}
const imageOf = (ok: any) => (ok.picture ? pictureUrl(ENV, ok.picture.path, 1200) : null);
const build = (lang: Lang, ok: any) => ({ view: productView(lang, ok), ld: productJsonLd(lang, ok, { origin: ORIGIN, imageUrl: imageOf(ok) }) as any });
const nth = async (category: string, i = 0, sub?: string) =>
  (await db.one(`select sku, id from products where category = $1 and ($3::text is null or sub_type = $3) and is_active order by sku offset $2 limit 1`, [category, i, sub ?? null]));
const value = (product: string, key: string, v: unknown, source = "label_photo") =>
  db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status, proposed_by, approved_by, approved_at, reviewed_at)
               values ($1, $2, $3::jsonb, $4, 'approved', $5, $5, now(), now())`, [product, key, JSON.stringify(v), source, ops]);
async function picture(sku: string, kind: "intake_photo" | "open_food_facts" = "intake_photo", approve = true) {
  n++;
  const pid = (await db.one(`select id from products where sku = $1`, [sku])).id;
  const r = await db.rpc<any>("propose_product_image", { p_product: pid, p_source_kind: kind, p_source_url: kind === "intake_photo" ? null : `https://example.test/${n}.jpg`, p_page_url: null,
    p_attribution: kind === "open_food_facts" ? `Photo by ${PERSON}, CC BY-SA 3.0` : null, p_media_path: `product_images/${sku}/${n}.jpg`, p_sha256: `sha-ld1-${n}`, p_width: 1200, p_height: 1200, p_bytes: 100000, p_vision: {} });
  if (approve) { await db.rpc("review_product_image", { p_image: r.image_id, p_by: ops, p_decision: "approve", p_note: null }); await db.rpc("catalog_picture_copied", { p_image: r.image_id }); }
}
const text = (v: ProductView) => JSON.stringify(v);
const rowsOf = (v: ProductView) => [...v.details, ...v.food.groups.flatMap((g) => g.lines), ...(v.nutrition?.rows ?? [])];

beforeAll(async () => {
  db = await openTestDb();
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', $1) returning id`, [PERSON])).id;
  await db.pg.exec(`update stock_levels set on_hand = 10, reserved = 0; update stock_levels set on_hand = 0 where product_id = (select id from products where sku = 'AK-0046')`);
}, 120_000);

describe("1. the page shows the item's own template", () => {
  it("not confirmed yet reads the same words in Arabic, English and French", () => {
    expect(t("en", "not_confirmed_yet")).toBe("Not confirmed yet");
    expect(t("ar", "not_confirmed_yet")).toBe("لم يتم التأكيد بعد");
    expect(t("fr", "not_confirmed_yet")).toBe("Pas encore confirmé");
  });

  it.each([["Cleaning & Household", "cleaning_household"], ["Beauty & Personal Care", "beauty_personal_care"], ["Baby & Child", "baby_child"], ["Pet Zone", "pet"], ["Water", "water"]])(
    "%s: no nutrition, allergen or diet line in any language", async (category, template) => {
      const ok = await read((await nth(category)).sku);
      expect(ok.template.code).toBe(template);
      for (const lang of LANGS) {
        const v = productView(lang, ok);
        expect(v.food.show, `${lang} ${template}`).toBe(false);
        expect(v.food.groups).toEqual([]);
        expect(v.nutrition).toBeNull();
        expect(v.details.length).toBeGreaterThan(0);
        for (const w of [DICTS[lang].allergens, DICTS[lang].diets, DICTS[lang].nutrition, DICTS[lang].contains, DICTS[lang].free_of, DICTS[lang].may_contain]) expect(text(v), `${lang}: ${w}`).not.toContain(w);
      }
    });

  it("an unapproved field reads not confirmed yet, an approved one shows its value and its source, in the page's language", async () => {
    const it = await nth("Cleaning & Household", 3);
    await value(it.id, "hazard_warnings", ["Irritant"], "label_photo");
    await value(it.id, "scent", "Lemon", "brand_site");
    const ok = await read(it.sku);
    const en = productView("en", ok); const ar = productView("ar", ok); const fr = productView("fr", ok);
    const row = (v: ProductView, label: string) => v.details.find((r) => r.label === label)!;
    expect(row(en, FIELD_LABELS.hazard_warnings!.en)).toMatchObject({ value: "Irritant", how: "from the pack" });
    expect(row(en, FIELD_LABELS.scent!.en)).toMatchObject({ value: "Lemon", how: "from the brand's own page" });
    expect(row(ar, FIELD_LABELS.hazard_warnings!.ar)).toMatchObject({ value: "Irritant", how: "من العبوة" });
    expect(row(fr, FIELD_LABELS.hazard_warnings!.fr)!.how).toBe("d'après l'emballage");
    // an item with nothing approved: the field its template requires reads not confirmed yet, with no value and no source
    const bare = productView("en", await read((await nth("Cleaning & Household", 6)).sku));
    expect(row(bare, FIELD_LABELS.hazard_warnings!.en)).toEqual({ label: FIELD_LABELS.hazard_warnings!.en, value: null, how: null });
    expect(bare.details.every((r) => (r.value === null) === (r.how === null))).toBe(true);
  });

  it("food: unknown is never shown as safe; the groups list what is not confirmed; an approved fact shows its source", async () => {
    const it = await nth("Dairy & Eggs", 1);
    const f = await db.rpc<string>("propose_product_fact", { p_product: it.id, p_attribute: "milk", p_value: "contains", p_status: "declared", p_source: "label", p_by: ops });
    await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
    const ok = await read(it.sku);
    for (const lang of LANGS) {
      const v = productView(lang, ok);
      expect(v.food.show).toBe(true);
      const allergen = v.food.groups.find((g) => g.kind === "allergen")!;
      expect(allergen.lines.map((l) => l.text)).toEqual([`${DICTS[lang].contains}: ${lang === "ar" ? "حليب" : "Milk"}`]);
      expect(allergen.lines[0]!.how).toContain(DICTS[lang].src_label);
      expect(allergen.notVerified.length).toBe(13);
      expect(text(v)).not.toMatch(new RegExp(DICTS[lang].free_of));
      expect(v.nutrition).toBeNull();
      expect(v.nutritionNotConfirmed).toBe(true);
    }
  });

  it("praise and health words never come from the page's own wording", () => {
    for (const lang of LANGS) for (const k of Object.keys(DICTS[lang]).filter((k) => /^(details_|not_confirmed|how_|src_|claims_|nut_)/.test(k))) {
      expect(DICTS[lang][k], `${lang}.${k}`).not.toMatch(/\b(healthy|healthier|best|tasty|delicious|good for|safe|safer)\b|صحي|لذيذ|الأفضل|آمن|sain|délicieux|meilleur|sûr/i);
    }
  });

  it("every field the read can return has a label and its words in all three languages", async () => {
    const keys = (await db.all<any>(`select distinct key from template_fields where store = 'values' and (template_code not in ('core', 'vendor_dish') or key in ('pack_count', 'variant', 'origin'))`)).map((r) => r.key as string);
    for (const k of keys) { expect(FIELD_LABELS[k], k).toBeDefined(); for (const l of LANGS) expect(FIELD_LABELS[k]![l], `${k} ${l}`).toBeTruthy(); }
    const enums = (await db.all<any>(`select distinct unnest(allowed) as v from template_fields where store = 'values' and type = 'enum' and template_code <> 'vendor_dish'
                                       union select distinct unnest(allowed) from template_fields where key = 'pictograms'`)).map((r) => r.v as string);
    for (const v of enums) { expect(VALUE_WORDS[v], v).toBeDefined(); for (const l of LANGS) expect(VALUE_WORDS[v]![l], `${v} ${l}`).toBeTruthy(); }
  });
});

describe("2. the JSON-LD", () => {
  it("a Product with its name in the page's language, a USD Offer from the same read, and availability from stock", async () => {
    const it = await nth("Dairy & Eggs", 0);
    await db.pg.query(`update products set name_ar = 'منتج تجربة' where id = $1`, [it.id]);
    const ok = await read(it.sku);
    const ar = productJsonLd("ar", ok, { origin: ORIGIN, imageUrl: null }) as any;
    const en = productJsonLd("en", ok, { origin: ORIGIN, imageUrl: null }) as any;
    expect(ar["@context"]).toBe("https://schema.org"); expect(ar["@type"]).toBe("Product");
    expect(ar.name).toBe("منتج تجربة"); expect(en.name).toBe(ok.product.name_en);
    expect(en.offers).toEqual({ "@type": "Offer", url: `${ORIGIN}/p/${it.sku}`, price: Number(ok.product.price_usd).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock" });
    expect(en.sku).toBe(it.sku);
    const out = await read("AK-0046");
    expect((productJsonLd("en", out, { origin: ORIGIN, imageUrl: null }) as any).offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("an approved picture is the image; a proposed one, or none, gives no image key at all", async () => {
    const a = (await nth("Dairy & Eggs", 2)).sku; const b = (await nth("Dairy & Eggs", 3)).sku;
    await picture(a, "intake_photo", true); await picture(b, "intake_photo", false);
    const withPic = await read(a); const without = await read(b);
    expect((productJsonLd("en", withPic, { origin: ORIGIN, imageUrl: imageOf(withPic) }) as any).image).toBe(pictureUrl(ENV, withPic.picture.path, 1200));
    expect("image" in (productJsonLd("en", without, { origin: ORIGIN, imageUrl: imageOf(without) }) as any)).toBe(false);
  });

  it("brand, size and gtin come only from approved or real data", async () => {
    const it = await nth("Dairy & Eggs", 4);
    await value(it.id, "size", "750 ml");
    const ld = productJsonLd("en", await read(it.sku), { origin: ORIGIN, imageUrl: null }) as any;
    expect(ld.size).toBe("750 ml");
    const real = await db.one<any>(`select sku, barcode from products where web_real_gtin(barcode) is not null and is_active order by sku limit 1`);
    expect((productJsonLd("en", await read(real.sku), { origin: ORIGIN, imageUrl: null }) as any).gtin).toBe(real.barcode.replace(/\s/g, ""));
    const weighed = await db.one<any>(`select sku from products where barcode like '22%' and is_active limit 1`);
    const w = productJsonLd("en", await read(weighed.sku), { origin: ORIGIN, imageUrl: null }) as any;
    expect("gtin" in w).toBe(false);                       // the store's weighed-goods code is not a GTIN
    const unbranded = await db.one<any>(`select sku from products where brand ilike '%unbranded%' and is_active limit 1`);
    expect("brand" in (productJsonLd("en", await read(unbranded.sku), { origin: ORIGIN, imageUrl: null }) as any)).toBe(false);
    const branded = await db.one<any>(`select sku, brand from products where brand is not null and brand not ilike '%unbranded%' and is_active limit 1`);
    expect((productJsonLd("en", await read(branded.sku), { origin: ORIGIN, imageUrl: null }) as any).brand).toEqual({ "@type": "Brand", name: branded.brand });
  });

  it("nutrition and printed claims only for a fact-complete item; unapproved ones never", async () => {
    const it = await nth("Snacks & Candy", 5);
    await db.pg.query(`update products set name_ar = 'منتج تجربة' where id = $1`, [it.id]);
    // proposed only: nothing leaves
    const f = await db.rpc<string>("propose_product_fact", { p_product: it.id, p_attribute: "nutrition", p_value: null, p_status: "declared", p_source: "label", p_by: ops,
      p_detail: { per: "100g", values: { energy_kcal: 480, fat: 20, sugars: 21, proteins: 6, salt: 0.5 } } });
    await db.pg.query(`insert into product_claims(product_id, claim_code, quote, source) values ($1, 'low_sugar', 'Low sugar', 'label_photo')`, [it.id]);
    let ld = productJsonLd("en", await read(it.sku), { origin: ORIGIN, imageUrl: null }) as any;
    expect("nutrition" in ld).toBe(false); expect(JSON.stringify(ld)).not.toContain("Low sugar");
    // approved but the item is not fact-complete: still nothing
    await db.rpc("approve_product_fact", { p_fact: f, p_by: ops });
    await db.pg.query(`update product_claims set status = 'approved', approved_by = $2, approved_at = now() where product_id = $1`, [it.id, ops]);
    ld = productJsonLd("en", await read(it.sku), { origin: ORIGIN, imageUrl: null }) as any;
    expect("nutrition" in ld).toBe(false); expect("additionalProperty" in ld).toBe(false);
    // fact-complete: both, as numbers per 100 g
    await makeFactComplete(db, it.id, ops);
    ld = productJsonLd("en", await read(it.sku), { origin: ORIGIN, imageUrl: null }) as any;
    expect(ld.nutrition).toEqual({ "@type": "NutritionInformation", servingSize: "100 g", calories: "480 kcal", fatContent: "20 g", sugarContent: "21 g", proteinContent: "6 g" });
    expect(ld.additionalProperty).toEqual([{ "@type": "PropertyValue", name: "Printed on the pack", value: "Low sugar" }]);
  });

  it("no person's name, no evidence, no picture credit line, and nothing a visitor must not see", async () => {
    const a = (await nth("Dairy & Eggs", 6)).sku;
    await picture(a, "open_food_facts", true);
    const it = await nth("Cleaning & Household", 4);
    await value(it.id, "hazard_warnings", ["Irritant"]);
    for (const sku of [a, it.sku]) {
      const ok = await read(sku);
      for (const lang of LANGS) {
        const { view, ld } = build(lang, ok);
        expect(JSON.stringify(ld)).not.toContain(PERSON); expect(JSON.stringify(view)).not.toContain(PERSON);
        expect(JSON.stringify(ld)).not.toMatch(/evidence|approved_by|proposed_by|attribution/);
      }
    }
  });

  it("the script is safe to put in a page: nothing can close the tag", () => {
    const s = jsonLdScript([{ "@context": "https://schema.org", "@type": "Product", name: "</script><script>alert(1)</script>  " }]);
    expect(s).not.toContain("</script"); expect(s).not.toContain("<script"); expect(s).not.toContain(" ");
    expect(JSON.parse(s)[0].name).toContain("alert(1)");
  });

  it("a category page carries an ItemList of what it lists, each with its address and name", async () => {
    const cards = [{ sku: "AK-0001", name_en: "Potato", name_ar: "بطاطا", name_fr: null }, { sku: "AK-0002", name_en: "Tomato", name_ar: null, name_fr: null }];
    const ld = categoryJsonLd("ar", { name: "خضرة وفواكه", path: "/c/fruits_vegetables", cards }, ORIGIN) as any;
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(2);
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, url: `${ORIGIN}/p/AK-0001`, name: "بطاطا" },
      { "@type": "ListItem", position: 2, url: `${ORIGIN}/p/AK-0002`, name: "Tomato" }]);
  });
});

describe("3. the page and its JSON-LD never disagree, for every template", () => {
  const samples: [string, string, number][] = [
    ["Dairy & Eggs", "packaged_food", 7], ["Fruits & Vegetables", "fresh_produce", 0], ["Meat & Poultry", "meat_poultry", 0], ["Bakery", "bakery", 0], ["Water", "water", 0],
    ["Cleaning & Household", "cleaning_household", 5], ["Beauty & Personal Care", "beauty_personal_care", 0], ["Baby & Child", "baby_child", 0], ["Pet Zone", "pet", 0]];

  it.each(samples)("%s (%s): every statement in the JSON-LD is on the page, in all three languages", async (category, template, i) => {
    const it = await nth(category, i);
    if (template === "packaged_food") { await makeFactComplete(db, it.id, ops, { nutrition: { energy_kcal: 310, fat: 12, saturated_fat: 4, carbohydrates: 40, sugars: 9, proteins: 8, fibre: 3, salt: 1.1 } });
      await db.pg.query(`insert into product_claims(product_id, claim_code, quote, source, status, approved_by, approved_at) values ($1, 'high_protein', 'High protein', 'label_photo', 'approved', $2, now())`, [it.id, ops]); }
    if (template === "cleaning_household") await value(it.id, "hazard_warnings", ["Irritant"]);
    await picture(it.sku, "intake_photo", i % 2 === 0);
    await value(it.id, "size", "500 g");
    const ok = await read(it.sku);
    expect(ok.template.code).toBe(template);
    for (const lang of LANGS) {
      const { view, ld } = build(lang, ok);
      expect(ld.name, "name").toBe(view.name);
      expect(ld.offers.price, "price").toBe(view.price.toFixed(2));
      expect(ld.offers.priceCurrency).toBe("USD");
      expect(ld.offers.availability, "stock").toBe(view.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock");
      expect(ld.brand?.name ?? null, "brand").toBe(view.brand);
      expect(ld.size ?? null, "size").toBe(view.size); expect(view.size).toBe("500 g");
      expect(ld.gtin ?? null, "gtin").toBe(view.gtin);
      expect(("image" in ld), "image").toBe(view.hasPicture);
      // nutrition: in the JSON-LD only what the page shows, with the same numbers; absent exactly when the page has no panel
      expect("nutrition" in ld, "nutrition").toBe(view.nutrition !== null);
      if (view.nutrition) {
        const map: Record<string, string> = { calories: "energy_kcal", fatContent: "fat_g", saturatedFatContent: "saturated_fat_g", carbohydrateContent: "carbohydrate_g", sugarContent: "sugars_g", proteinContent: "protein_g", fiberContent: "fibre_g" };
        for (const [prop, key] of Object.entries(map)) {
          const row = view.nutrition.rows.find((r) => r.key === key);
          expect(prop in ld.nutrition, `${lang} ${prop}`).toBe(!!row);
          if (row) expect(parseFloat(ld.nutrition[prop])).toBe(row.num);
        }
        expect(ld.nutrition.servingSize).toBe(view.nutrition.per);
      }
      // claims: the same printed words
      expect((ld.additionalProperty ?? []).map((p: any) => p.value), "claims").toEqual(view.claims.map((c) => c.quote));
      // a template without food has none of it, on the page or in the data
      if (!ok.template.is_food) { expect("nutrition" in ld).toBe(false); expect(view.food.show).toBe(false); }
      // the page has something to say about every template: fields, food groups or a panel not confirmed yet
      expect(rowsOf(view).length + view.food.groups.length + view.details.length + (view.nutritionNotConfirmed ? 1 : 0)).toBeGreaterThan(0);
    }
  });
});

describe("4. every product page's JSON-LD is valid", () => {
  it("parses, and has the required Product and Offer fields, for every item the site shows, in every language", async () => {
    const items = await db.all<any>(`select sku from products where is_active and owner_source_id is null order by sku`);
    expect(items.length).toBe(291);
    let shown = 0; let withGtin = 0; let withNutrition = 0; const unpriced: string[] = [];
    for (const p of items) {
      const ok = await read(p.sku);
      if (!ok.ok) continue;
      shown++;
      for (const lang of LANGS) {
        const raw = jsonLdScript([productJsonLd(lang, ok, { origin: ORIGIN, imageUrl: imageOf(ok) })]);
        const ld = JSON.parse(raw)[0];
        const where = `${p.sku} ${lang}`;
        expect(ld["@context"], where).toBe("https://schema.org"); expect(ld["@type"], where).toBe("Product");
        expect(typeof ld.name === "string" && ld.name.trim().length > 0, `${where} name`).toBe(true);
        expect(ld.sku, where).toBe(p.sku);
        if (Number(ok.product.price_usd) > 0) {
          expect(ld.offers["@type"], where).toBe("Offer");
          expect(ld.offers.url, where).toBe(`${ORIGIN}/p/${p.sku}`);
          expect(ld.offers.price, where).toMatch(/^\d+\.\d{2}$/);
          expect(Number(ld.offers.price), where).toBe(Number(ok.product.price_usd));
          expect(ld.offers.priceCurrency, where).toBe("USD");
          expect(["https://schema.org/InStock", "https://schema.org/OutOfStock"], where).toContain(ld.offers.availability);
        } else {
          // no price entered yet (the seed has four): no Offer rather than a price of 0
          expect("offers" in ld, where).toBe(false); if (lang === "en") unpriced.push(p.sku);
        }
        if (ok.picture) expect(ld.image, where).toMatch(/^https:\/\//);
        if (ld.gtin) { expect(ld.gtin, where).toMatch(/^\d{8}$|^\d{12,14}$/); if (lang === "en") withGtin++; }
        if (ld.nutrition) { expect(ld.nutrition["@type"], where).toBe("NutritionInformation"); withNutrition++; }
        // no empty value anywhere, and a JSON round trip changes nothing
        const empty = (v: unknown): boolean => v === null || v === undefined || v === "" || (Array.isArray(v) && v.some(empty)) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).some(empty));
        expect(empty(ld), `${where} has an empty value`).toBe(false);
        expect(JSON.parse(JSON.stringify(ld))).toEqual(ld);
      }
    }
    expect(shown, "items the site shows").toBe(items.length);
    expect(unpriced.sort()).toEqual(["AK-0190", "AK-0204", "AK-0205", "AK-0206"]);
    expect(withGtin).toBeGreaterThan(150);
    expect(withNutrition).toBeGreaterThan(0);
  }, 300_000);
});
