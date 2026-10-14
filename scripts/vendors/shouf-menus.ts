// Shouf draft menus (DECISIONS §38.2 items 2–3): the 19 restaurant menus and the 2 supermarket catalogues
// in supabase/seed/shouf/source/03_shouf_digital_menus.json become menu drafts (`source = seed`,
// `status = draft`) in the shape app_private.menu_draft_check() accepts. Nothing here is orderable: a
// section reaches the menu only when the claimed merchant approves it (§18.3), and an item without a
// clear price never does. Prices are kept exactly as printed, with their currency.

export type DraftItem = {
  name_en: string;
  description?: string;
  price: number | null;
  currency: "USD" | "LBP" | null;
  confidence: number;
  unit?: string;
  sku?: string;
  image_url?: string;
};
export type DraftSection = {
  name_ar: string;
  name_en: string;
  name_fr: string;
  items: DraftItem[];
};
export type ShoufDraft = {
  place_id: string;
  kind: "restaurant" | "supermarket";
  vendor_name: string;
  sections: DraftSection[];
};

type RawMenus = {
  restaurant_menus: {
    place_id: string;
    vendor_name: string;
    items: { item_name: string; description?: string; price_raw?: string; image_url?: string }[];
  }[];
  supermarket_catalogs: {
    place_id: string;
    vendor_name: string;
    catalog: {
      category: string;
      sku: string;
      item_name: string;
      unit?: string;
      price_usd?: number | null;
    }[];
  }[];
};

// A seed price is a hint for the merchant to confirm, never a fact (§38.2: "please confirm").
const SEED_CONFIDENCE = 0.5;

/** "$9.00", "9 $", "Mix\t\n\n0.16 $", "150,000 LL" → amount and currency; anything else → no price. */
export function parsePrice(raw: string | undefined | null): {
  price: number | null;
  currency: "USD" | "LBP" | null;
} {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  const usd =
    t.match(/\$\s*(\d+(?:[.,]\d{1,2})?)\s*$/) ?? t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:\$|usd)\s*$/i);
  if (usd) {
    const n = Number(usd[1].replace(",", "."));
    return Number.isFinite(n) && n > 0
      ? { price: n, currency: "USD" }
      : { price: null, currency: null };
  }
  const lbp = t.match(/(\d{1,3}(?:[,.\s]\d{3})+|\d{4,})\s*(?:l\.?l\.?|lbp|ل\.?ل\.?)\s*$/i);
  if (lbp) {
    const n = Number(lbp[1].replace(/[,.\s]/g, ""));
    return n > 0 ? { price: n, currency: "LBP" } : { price: null, currency: null };
  }
  return { price: null, currency: null };
}

// Section names for the supermarket catalogue categories, in the three menu languages.
const GROCERY_SECTIONS: Record<string, [string, string]> = {
  "Water & Beverages": ["مياه ومشروبات", "Eaux et boissons"],
  "Dairy & Eggs": ["ألبان وبيض", "Produits laitiers et œufs"],
  "Pantry & Staples": ["مؤونة وأساسيات", "Épicerie de base"],
  "Bakery & Bread": ["خبز ومخبوزات", "Pain et boulangerie"],
  "Coffee & Tea": ["قهوة وشاي", "Café et thé"],
  "Snacks & Sweets": ["سناكات وحلويات", "Snacks et douceurs"],
  "Household & Baby": ["منزل وأطفال", "Maison et bébé"],
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const httpsUrl = (u: string | undefined) =>
  u && /^https:\/\/[^\s]+$/.test(u) && u.length <= 500 ? u : undefined;

export function shoufDrafts(raw: RawMenus): ShoufDraft[] {
  const out: ShoufDraft[] = [];
  for (const m of raw.restaurant_menus) {
    const items: DraftItem[] = m.items.map((i) => {
      const p = parsePrice(i.price_raw);
      const name = clip(i.item_name.replace(/\s+/g, " ").trim(), 120);
      return {
        name_en: name,
        ...(i.description?.trim()
          ? { description: clip(i.description.replace(/\s+/g, " ").trim(), 500) }
          : {}),
        ...p,
        confidence: SEED_CONFIDENCE,
        ...(httpsUrl(i.image_url) ? { image_url: httpsUrl(i.image_url) } : {}),
      };
    });
    // The file has no sections for restaurants: one "Menu" section the merchant can split when claiming.
    out.push({
      place_id: m.place_id,
      kind: "restaurant",
      vendor_name: m.vendor_name,
      sections: [{ name_ar: "القائمة", name_en: "Menu", name_fr: "Menu", items }],
    });
  }
  for (const c of raw.supermarket_catalogs) {
    const order: string[] = [];
    const bySection = new Map<string, DraftItem[]>();
    for (const i of c.catalog) {
      if (!bySection.has(i.category)) {
        order.push(i.category);
        bySection.set(i.category, []);
      }
      const ok = typeof i.price_usd === "number" && i.price_usd > 0;
      bySection.get(i.category)!.push({
        name_en: clip(i.item_name.replace(/\s+/g, " ").trim(), 120),
        price: ok ? (i.price_usd as number) : null,
        currency: ok ? "USD" : null,
        confidence: SEED_CONFIDENCE,
        ...(i.unit ? { unit: i.unit } : {}),
        sku: i.sku,
      });
    }
    out.push({
      place_id: c.place_id,
      kind: "supermarket",
      vendor_name: c.vendor_name,
      sections: order.map((name) => ({
        name_ar: GROCERY_SECTIONS[name]?.[0] ?? name,
        name_en: name,
        name_fr: GROCERY_SECTIONS[name]?.[1] ?? name,
        items: bySection.get(name)!,
      })),
    });
  }
  return out;
}
