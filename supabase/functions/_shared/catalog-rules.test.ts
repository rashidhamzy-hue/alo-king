// Catalogue rules (DECISIONS §39.15.4): one validator for the sync, the demo photo pipeline and the merchant copilot.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  CATALOG_LANGS,
  CATALOG_RULES,
  imageHeader,
  issuesText,
  MAX_EMOJI,
  PROMO_WORDS,
  validateCatalogItem,
  type CatalogIssue,
} from "./catalog-rules";
import { catalogDescription, catalogTitle, itemName } from "./item-text";

const codes = (x: CatalogIssue[]) => x.map((i) => i.code);

// ---- Byte fixtures: just the header bytes each format starts with -----------------------------------------------------
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const str = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
const pad = (a: number[], n = 64) =>
  new Uint8Array([...a, ...new Array(Math.max(0, n - a.length)).fill(0)]);

const png = (w: number, h: number) =>
  pad([
    0x89,
    ...str("PNG"),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...str("IHDR"),
    ...be32(w),
    ...be32(h),
    8,
    2,
    0,
    0,
    0,
  ]);
// SOI, an APP0 segment, a DQT-like segment, then SOF2 (progressive) with height and width.
const jpeg = (w: number, h: number) =>
  pad([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...str("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xdb,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xff,
    0xc2,
    0x00,
    0x11,
    0x08,
    ...be32(h).slice(2),
    ...be32(w).slice(2),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
const webpLossy = (w: number, h: number) =>
  pad([
    ...str("RIFF"),
    0,
    0,
    0,
    0,
    ...str("WEBP"),
    ...str("VP8 "),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    ...le16(w),
    ...le16(h),
  ]);
const webpLossless = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return pad([
    ...str("RIFF"),
    0,
    0,
    0,
    0,
    ...str("WEBP"),
    ...str("VP8L"),
    0,
    0,
    0,
    0,
    0x2f,
    bits & 255,
    (bits >>> 8) & 255,
    (bits >>> 16) & 255,
    (bits >>> 24) & 255,
  ]);
};
const webpExtended = (w: number, h: number) =>
  pad([
    ...str("RIFF"),
    0,
    0,
    0,
    0,
    ...str("WEBP"),
    ...str("VP8X"),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...le24(w - 1),
    ...le24(h - 1),
  ]);

describe("the rules (data)", () => {
  it("have unique codes and every word in Arabic, English, French and Arabizi", () => {
    expect(new Set(CATALOG_RULES.map((r) => r.code)).size).toBe(CATALOG_RULES.length);
    for (const r of CATALOG_RULES) {
      expect(r.code).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(r.basis.length).toBeGreaterThan(5);
      for (const l of CATALOG_LANGS)
        for (const t of [r.rule, r.problem, r.fix])
          expect(t[l]?.trim().length, `${r.code} ${l}`).toBeGreaterThan(5);
      // Arabic text is Arabic; the Latin languages carry no Arabic letters.
      expect(r.rule.ar).toMatch(/\p{Script=Arabic}/u);
      for (const l of ["en", "fr", "arabizi"] as const)
        expect(r.rule[l] + r.problem[l] + r.fix[l]).not.toMatch(/\p{Script=Arabic}/u);
      // The same placeholders in every language, so the filled words agree.
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      for (const l of CATALOG_LANGS) {
        expect(ph(r.problem[l]), `${r.code} ${l}`).toBe(ph(r.problem.en));
        expect(ph(r.fix[l]), `${r.code} ${l}`).toBe(ph(r.fix.en));
      }
    }
  });
  it("cover everything §39.15.4 lists, and say which ones only Meta's review can see", () => {
    const all = CATALOG_RULES.map((r) => r.code);
    for (const c of [
      "image_too_small",
      "image_not_square",
      "image_not_https",
      "image_placeholder",
      "image_text_overlay",
      "image_watermark",
      "image_collage",
      "title_all_caps",
      "title_mixed_language",
      "title_too_long",
      "price_not_positive",
      "description_contact",
      "description_promotional",
      "policy_medicine",
      "policy_alcohol",
      "policy_tobacco",
    ])
      expect(all).toContain(c);
    expect(
      CATALOG_RULES.filter((r) => !r.checkedHere)
        .map((r) => r.code)
        .sort(),
    ).toEqual(["image_collage", "image_text_overlay", "image_watermark"]);
  });
  it("keep the promotional words short, in all four languages", () => {
    for (const l of CATALOG_LANGS) {
      expect(PROMO_WORDS[l].length).toBeGreaterThan(3);
      expect(PROMO_WORDS[l].length).toBeLessThan(15);
    }
  });
});

describe("image header: width and height without a decoder", () => {
  it.each([
    ["png", png(800, 600), { format: "png", width: 800, height: 600 }],
    [
      "jpeg (SOF2 after other segments and a fill byte)",
      jpeg(1600, 1200),
      { format: "jpeg", width: 1600, height: 1200 },
    ],
    ["webp lossy (VP8)", webpLossy(640, 480), { format: "webp", width: 640, height: 480 }],
    ["webp lossless (VP8L)", webpLossless(512, 1024), { format: "webp", width: 512, height: 1024 }],
    [
      "webp extended (VP8X)",
      webpExtended(3000, 2000),
      { format: "webp", width: 3000, height: 2000 },
    ],
  ])("%s", (_k, bytes, want) => {
    expect(imageHeader(bytes)).toEqual(want);
  });
  it("reads what sharp writes (baseline and progressive JPEG, PNG, WebP)", async () => {
    const base = () =>
      sharp({ create: { width: 700, height: 520, channels: 3, background: "#c84" } });
    for (const [b, f] of [
      [await base().jpeg().toBuffer(), "jpeg"],
      [await base().jpeg({ progressive: true, mozjpeg: true }).toBuffer(), "jpeg"],
      [await base().png().toBuffer(), "png"],
      [await base().webp().toBuffer(), "webp"],
      [await base().webp({ lossless: true }).toBuffer(), "webp"],
    ] as const)
      expect(imageHeader(new Uint8Array(b))).toEqual({ format: f, width: 700, height: 520 });
  });
  it("answers null for anything else (a GIF, a PDF, a cut header, nothing)", () => {
    expect(imageHeader(pad(str("GIF89a")))).toBeNull();
    expect(imageHeader(pad(str("%PDF-1.7")))).toBeNull();
    expect(imageHeader(jpeg(800, 800).subarray(0, 30))).toBeNull();
    expect(imageHeader(new Uint8Array(0))).toBeNull();
    expect(imageHeader(null)).toBeNull();
  });
});

describe("photo checks", () => {
  const big = (n = 400_000) => ({ size: n });
  it("a photo at least 500 × 500, square enough, on https, passes", () => {
    expect(
      validateCatalogItem({}, { width: 1600, height: 1200, ...big(), url: "https://x.test/i.jpg" }),
    ).toEqual([]);
  });
  it("too small, from the header bytes, with the size in the message", () => {
    // The fixture is 64 bytes, so it is also tiny: the size test reads width and height from the header.
    const r = validateCatalogItem({}, { bytes: png(320, 240) });
    expect(codes(r)).toContain("image_too_small");
    const small = r.find((i) => i.code === "image_too_small")!;
    expect(small.message.en).toBe(
      "This photo is too small (320 × 240), so WhatsApp will refuse it.",
    );
    expect(small.message.ar).toContain("320 × 240");
    expect(small.fix.fr).toMatch(/au moins 500 × 500/);
  });
  it("width and height are used when there are no bytes (a decoder measured them)", () => {
    expect(codes(validateCatalogItem({}, { width: 499, height: 800, ...big() }))).toEqual([
      "image_too_small",
    ]);
    expect(codes(validateCatalogItem({}, { width: 500, height: 500, ...big() }))).toEqual([]);
  });
  it("a square crop must keep the item: the long side at most twice the short side", () => {
    expect(codes(validateCatalogItem({}, { width: 1000, height: 2000, ...big() }))).toEqual([]);
    expect(codes(validateCatalogItem({}, { width: 2100, height: 1000, ...big() }))).toEqual([
      "image_not_square",
    ]);
  });
  it("the address must be https", () => {
    expect(codes(validateCatalogItem({}, { url: "http://x.test/a.jpg" }))).toEqual([
      "image_not_https",
    ]);
    expect(
      codes(validateCatalogItem({}, { url: "https://x.test/dispatch?route=catalog-image&i=1" })),
    ).toEqual([]);
  });
  it("placeholders: a known file name, a known hash, a tiny file, a flat picture", () => {
    for (const name of [
      "woocommerce-placeholder.png",
      "no-image.jpg",
      "noimage.png",
      "coming_soon.jpg",
      "default-product.jpg",
    ])
      expect(
        codes(
          validateCatalogItem(
            {},
            { url: `https://shop.test/wp/${name}?v=2`, width: 800, height: 800, ...big() },
          ),
        ),
      ).toEqual(["image_placeholder"]);
    expect(
      codes(
        validateCatalogItem(
          {},
          {
            sha256: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
            width: 800,
            height: 800,
            ...big(),
          },
        ),
      ),
    ).toEqual(["image_placeholder"]);
    expect(codes(validateCatalogItem({}, { width: 800, height: 800, size: 2200 }))).toEqual([
      "image_placeholder",
    ]);
    // 800 × 800 JPEG at 4 KB: a flat picture with a word on it, never a photo of a dish.
    expect(
      codes(validateCatalogItem({}, { width: 1600, height: 1600, size: 12_000, format: "jpeg" })),
    ).toEqual(["image_placeholder"]);
    // A PNG is not judged by bytes per pixel (flat colours are what PNG is for), only by the tiny size.
    expect(
      codes(validateCatalogItem({}, { width: 1600, height: 1600, size: 12_000, format: "png" })),
    ).toEqual([]);
    // Our own storage paths and the image route are never placeholders.
    expect(
      codes(
        validateCatalogItem(
          {},
          {
            name: "merchant/20000000-0000-0000-0000-00000000000a/53000000-0000-0000-0000-000000000001.jpg",
            width: 800,
            height: 800,
            ...big(),
          },
        ),
      ),
    ).toEqual([]);
  });
  it("real encoded files: a flat 800 × 800 JPEG is a placeholder, a photo-like one passes", async () => {
    const flat = new Uint8Array(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: "#fff" } })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer(),
    );
    expect(codes(validateCatalogItem({}, { bytes: flat }))).toEqual(["image_placeholder"]);
    const photo = new Uint8Array(
      await sharp({
        create: {
          width: 800,
          height: 800,
          channels: 3,
          background: "#884422",
          noise: { type: "gaussian", mean: 128, sigma: 30 },
        },
      })
        .jpeg({ quality: 82 })
        .toBuffer(),
    );
    expect(codes(validateCatalogItem({}, { bytes: photo }))).toEqual([]);
  });
  it("a header claiming more than 20000 px is unreadable, before anything is stored (review)", () => {
    expect(codes(validateCatalogItem({}, { bytes: png(30000, 900) }))).toEqual([
      "image_unreadable",
    ]);
    expect(codes(validateCatalogItem({}, { width: 900, height: 25000, size: 400_000 }))).toEqual([
      "image_unreadable",
    ]);
    expect(
      codes(validateCatalogItem({}, { width: 20000, height: 20000, size: 4_000_000 })),
    ).toEqual([]);
  });
  it("bytes we cannot read are unreadable, unless a decoder measured them", () => {
    expect(codes(validateCatalogItem({}, { bytes: pad(str("GIF89a"), 9000) }))).toEqual([
      "image_unreadable",
    ]);
    expect(
      codes(validateCatalogItem({}, { bytes: pad(str("GIF89a"), 9000), width: 900, height: 900 })),
    ).toEqual([]);
  });
});

describe("title rules (§39.15.2)", () => {
  it("a name is required, and fits in 150 UTF-16 units", () => {
    expect(codes(validateCatalogItem({ title: "  " }))).toEqual(["title_missing"]);
    expect(codes(validateCatalogItem({ title: "x".repeat(150) }))).toEqual([]);
    const r = validateCatalogItem({ title: "Big Plate ".repeat(16) });
    expect(codes(r)).toEqual(["title_too_long"]);
    expect(r[0].message.en).toMatch(/\(159 characters; WhatsApp allows 150\)/);
  });
  it("never ALL CAPS, with the fix written out; acronyms, sizes and 7UP are not shouting", () => {
    const r = validateCatalogItem({ title: "HOT DOG" });
    expect(codes(r)).toEqual(["title_all_caps"]);
    expect(r[0].fix.en).toBe("Write it in normal letters, like “Hot Dog”.");
    expect(r[0].fix.ar).toContain("Hot Dog");
    expect(codes(validateCatalogItem({ title: "PEPSI 330ML" }))).toEqual(["title_all_caps"]);
    for (const ok of [
      "BBQ",
      "XL BBQ",
      "BBQ Wings",
      "7UP",
      "Chicken BURGER",
      "McFlurry Oreo",
      "Pepsi 330 ml",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
  });
  it("one language: Arabic and Latin letters together are refused; a size's unit or a lone letter is not Latin text", () => {
    const r = validateCatalogItem({ title: "Sujuk & Cheese Platter صحن سجق جبنة" });
    expect(codes(r)).toEqual(["title_mixed_language"]);
    expect(r[0].message.en).toContain("Sujuk & Cheese Platter".replace(" &", ""));
    for (const ok of ["مياه 1.5 L", "بيبسي 330 ml", "كومبو A", "صحن سجق", "Sujuk Platter"])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
  });
  it("only the item part counts for language and capitals: a shop name in another script or in capitals is fine", () => {
    expect(
      codes(validateCatalogItem({ title: "صحن سجق · BUN BROS", item_name: "صحن سجق" })),
    ).toEqual([]);
    expect(codes(validateCatalogItem({ title: "Burger · BUN BROS", item_name: "Burger" }))).toEqual(
      [],
    );
  });
  it("no prices, offers or contact details in a name", () => {
    for (const bad of [
      "Burger $5",
      "Burger 5$",
      "Burger + FREE fries",
      "Pizza 03 123 456",
      "Shawarma www.shop.com",
      "Wings 20% off",
    ])
      expect(codes(validateCatalogItem({ title: bad })), bad).toEqual(["title_promotional"]);
    expect(codes(validateCatalogItem({ title: "Gluten-Free Bread" }))).toEqual([]);
  });
  it("a diet claim with free is not an offer: '<word>-free' and '<word> free' (review)", () => {
    for (const ok of [
      "Cholesterol Free Oil",
      "Sesame-free Hummus",
      "Wheat Free Bread",
      "Seed free grapes",
      "Combo FREE fries",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
  });
  it("the titles item-text.ts builds pass: Title Case fixes capitals, the shop is named, the Arabic name moves out", () => {
    const parts = {
      name_en: "HOT DOG",
      name_ar: "هوت دوغ",
      shop_en: "BUN BROS",
      village_en: "Baakleen",
    };
    const title = catalogTitle(parts);
    expect(title).toBe("Hot Dog · BUN BROS");
    expect(
      validateCatalogItem({
        title,
        item_name: itemName(parts),
        description: catalogDescription(parts),
        price_minor: 450,
      }),
    ).toEqual([]);
  });
});

describe("price", () => {
  it("above zero, in cents or dollars", () => {
    expect(codes(validateCatalogItem({ price_minor: 0 }))).toEqual(["price_not_positive"]);
    expect(codes(validateCatalogItem({ price_minor: -100 }))).toEqual(["price_not_positive"]);
    expect(codes(validateCatalogItem({ price_minor: null }))).toEqual(["price_not_positive"]);
    expect(codes(validateCatalogItem({ price_usd: "abc" }))).toEqual(["price_not_positive"]);
    expect(codes(validateCatalogItem({ price_usd: 0 }))).toEqual(["price_not_positive"]);
    expect(codes(validateCatalogItem({ price_minor: 1 }))).toEqual([]);
    expect(codes(validateCatalogItem({ price_usd: "4.5" }))).toEqual([]);
    // Not given: not checked (the copilot's photo check knows no price).
    expect(codes(validateCatalogItem({}))).toEqual([]);
  });
});

describe("description: no contact details, no promotional text", () => {
  it.each([
    ["Call us on +961 3 123 456 for more", "+961 3 123 456"],
    ["Order: 03-123456 / 70 123 456", "03-123456"],
    ["Rkhis: ٠٣١٢٣٤٥٦", "٠٣١٢٣٤٥٦"],
    ["See https://shop.example/menu", "https://shop.example/menu"],
    ["Menu at www.shop.com", "www.shop.com"],
    ["Visit shop.lb today", "shop.lb"],
    ["Write to orders@shop.com", "orders@shop.com"],
  ])("contact: %s", (d, found) => {
    const r = validateCatalogItem({ description: d });
    expect(codes(r)).toEqual(["description_contact"]);
    expect(r[0].message.en).toContain(found);
  });
  it.each([
    ["Free fries with every burger", "free"],
    ["Big discount today", "discount"],
    ["Best price in town", "best price"],
    ["The best burger!!!", "!!!"],
    ["Yummy 😋🔥🍔🍟 burger", "emoji"],
    ["Now 20% off", "% off"],
    ["Frites gratuites, prix offert", "offert"],
    ["Profitez de la promo", "promo"],
    ["بطاطا مجانية مع كل سندويش", "مجانيه"],
    ["خصم على كل الأصناف", "خصم"],
    ["أفضل سعر بالمنطقة", "افضل سعر"],
    ["batata bbalesh ma3 kel sandwich", "bbalesh"],
    ["5asem 3a kel shi", "5asem"],
  ])("promotional: %s", (d, found) => {
    const r = validateCatalogItem({ description: d });
    expect(codes(r)).toEqual(["description_promotional"]);
    expect(r[0].message.en).toContain(`(${found})`);
  });
  it("free is an offer alone or opening a phrase: 'Free fries', '+ free fries', ', free delivery' (review)", () => {
    for (const bad of [
      "Free fries with every burger",
      "Burger + free fries",
      "Big burger, free delivery",
      "FREE",
    ])
      expect(codes(validateCatalogItem({ description: bad })), bad).toEqual([
        "description_promotional",
      ]);
  });
  it("what the dish is without, sizes, weights, nutrition and up to three emoji are fine", () => {
    for (const ok of [
      "Gluten-free bun, sugar free sauce, free-range eggs.",
      "Sans gluten, fait maison.",
      "Burger · Baakleen\nبرغر\nBeef, cheddar and pickles.\n≈ 520 kcal · 32 g protein (estimated)\nExtras chosen after you add it",
      "Serves 2-3 · 1.5 L · 250 g",
      "Spicy 🌶️🔥 and good 😋",
      "Free from nuts.",
      "Cholesterol Free, Sesame-free, Wheat Free, seed free.",
      "Antibiotic-free chicken, free-range eggs.",
    ])
      expect(codes(validateCatalogItem({ description: ok })), ok).toEqual([]);
    expect(MAX_EMOJI).toBe(3);
  });
});

describe("commerce policy: no medicine (§38.3), alcohol or tobacco in the catalogue", () => {
  it.each([
    [{ name_en: "Panadol Extra 24 tablets" }, "panadol"],
    [{ name_fr: "Médicament contre la toux" }, "medicament"],
    [{ name_ar: "دواء للسعال" }, "دواء"],
    [{ name_ar: "بانادول" }, "بانادول"],
    [{ title: "Dawa lal ras" }, "dawa"],
    [{ title: "Vitamin C", business_type: "pharmacy" }, "pharmacy"],
  ])("medicine: %o", (item, found) => {
    const r = validateCatalogItem(item);
    expect(codes(r)).toEqual(["policy_medicine"]);
    expect(r[0].message.en).toBe("Medicines can't be sold on Alo King.");
    expect(found).toBeTruthy();
  });
  it.each([
    [{ title: "Lemonade", contains_alcohol: true }],
    [{ name_en: "Almaza Beer 330 ml" }],
    [{ name_ar: "بيرة الماظة" }],
    [{ title: "Red wine glass" }],
    [{ title: "Mixed drinks", section_en: "Beers & Wines" }],
  ])("alcohol: %o", (item) => {
    expect(codes(validateCatalogItem(item))).toEqual(["policy_alcohol"]);
  });
  it("non-alcoholic drinks and dishes cooked with wine are not alcohol", () => {
    for (const ok of [
      "Non-alcoholic beer",
      "Root Beer",
      "Beer battered onion rings",
      "Ginger ale",
      "عرق سوس",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
  });
  it.each([
    ["Marlboro Red"],
    ["Cigarettes pack"],
    ["Shisha double apple"],
    ["Paquet de tabac"],
    ["Chicha pomme"],
    ["علبة دخان"],
    ["سجائر"],
    ["أرجيلة تفاحتين"],
    ["2argileh tefe7tein"],
    ["Tombak 3ajami"],
    ["IQOS heets"],
    ["Vape pen"],
  ])("tobacco: %s", (title) => {
    expect(codes(validateCatalogItem({ title }))).toEqual(["policy_tobacco"]);
  });
  it("antibiotic-free food is not medicine, in English, French and Arabic (review)", () => {
    for (const ok of [
      "Antibiotic-Free Chicken Breast",
      "Antibiotics free chicken",
      "Poulet sans antibiotiques",
      "دجاج بدون مضادات حيوية",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
    expect(codes(validateCatalogItem({ title: "Antibiotic cream" }))).toEqual(["policy_medicine"]);
    for (const ok of [
      "Antibiotic-free poultry",
      "Antibiotic free salmon",
      "Œufs sans antibiotiques",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
    // One word list with the customer's refusal (_shared/medicine.ts): what one knows, the other knows.
    for (const bad of [
      "Sirop contre la toux",
      "Meds kit",
      "حبوب وجع",
      "الدواء",
      "مضادات حيوية",
      "المضادات الحيوية",
    ])
      expect(codes(validateCatalogItem({ title: bad })), bad).toEqual(["policy_medicine"]);
    for (const ok of [
      "بطاطا يدوية",
      "كبة يدوية",
      "معجنات يدوية الصنع",
      "قهوة بدوية",
      // A claim after punctuation is about the food before it.
      "Chicken breast, antibiotic free",
      "Organic chicken, antibiotic-free",
      "Whole chicken. Antibiotic free",
      "Chicken breast: antibiotic free",
      "Salmon fillet; no antibiotics",
      "Poulet fermier, sans antibiotiques",
      "دجاج طازج، بدون مضادات حيوية",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
  });
  it("a pastry called cigars is judged with its section; tobacco brands stay tobacco whatever the section (review)", () => {
    expect(codes(validateCatalogItem({ title: "Cigars", section_en: "Pastries" }))).toEqual([]);
    expect(
      codes(validateCatalogItem({ title: "Cigars", section: "حلويات", section_en: "Sweets" })),
    ).toEqual([]);
    expect(codes(validateCatalogItem({ title: "Cigars", section_en: "Smoking" }))).toEqual([
      "policy_tobacco",
    ]);
    expect(codes(validateCatalogItem({ title: "Marlboro Gold", section_en: "Sweets" }))).toEqual([
      "policy_tobacco",
    ]);
  });
  it("pastries called cigars are food", () => {
    for (const ok of [
      "Cheese cigars",
      "Cigares au fromage",
      "Rakakat cheese cigars",
      "Chocolate cigarettes",
      "Cigarettes russes",
      "سيكار جبنة",
    ])
      expect(codes(validateCatalogItem({ title: ok })), ok).toEqual([]);
  });
  it("the shop's part of a title never counts (a café called Arguileh still sells coffee)", () => {
    expect(
      codes(validateCatalogItem({ title: "Espresso · Arguileh Café", item_name: "Espresso" })),
    ).toEqual([]);
  });
});

describe("what the merchant reads", () => {
  it("one line per issue, problem then fix, in the merchant's language, each rule once", () => {
    const r = [
      ...validateCatalogItem({ title: "HOT DOG", price_usd: 0 }),
      ...validateCatalogItem({ price_usd: 0 }),
    ];
    expect(issuesText(r, "en")).toBe(
      "• This name is all in capital letters. Write it in normal letters, like “Hot Dog”.\n• This item has no price (or a price of 0). Set its price, e.g. «price <item> 4.5».",
    );
    for (const l of CATALOG_LANGS) expect(issuesText(r, l).split("\n")).toHaveLength(2);
    expect(issuesText(r, "ar")).toMatch(/\p{Script=Arabic}/u);
    expect(issuesText(r, "fr")).toMatch(/majuscules/);
    expect(issuesText(r, "arabizi")).toMatch(/CAPS/);
  });
});
