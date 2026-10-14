// Shouf draft menus (DECISIONS §38.2 items 2–3): the 19 restaurant menus and the 2 supermarket catalogues
// in supabase/seed/shouf/source/03_shouf_digital_menus.json become menu drafts (`source = seed`,
// `status = draft`) in the shape app_private.menu_draft_check() accepts. Nothing here is orderable: a
// section reaches the menu only when the claimed merchant approves it (§18.3), and an item without a
// clear price never does. Prices are kept exactly as printed, with their currency.

export type DraftOption = {
  name: string;
  min: number;
  max: number;
  choices: { name: string }[];
};
export type DraftItem = {
  name_en: string;
  name_ar?: string;
  description?: string;
  price: number | null;
  currency: "USD" | "LBP" | null;
  confidence: number;
  unit?: string;
  sku?: string;
  image_url?: string;
  options?: DraftOption[];
};
export type DraftSection = {
  name_ar: string | null;
  name_en: string;
  name_fr: string | null;
  items: DraftItem[];
};
export type ShoufDraft = {
  place_id: string;
  kind: "restaurant" | "supermarket";
  vendor_name: string;
  sections: DraftSection[];
  /** Where the menu came from and when (§39.4): a repo path for the seed files. */
  source_url: string;
  captured_at: string;
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

const MENUS_03 = "supabase/seed/shouf/source/03_shouf_digital_menus.json";
// 03 carries no date of its own: it was committed with §38 on 14 October 2026 (PR #138).
const MENUS_03_CAPTURED = "2026-10-14";

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
      source_url: MENUS_03,
      captured_at: MENUS_03_CAPTURED,
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
      source_url: MENUS_03,
      captured_at: MENUS_03_CAPTURED,
    });
  }
  return out;
}

// ---- Owner menu photos (DECISIONS §39.4 source 1) ----------------------------------------------------------------

type RawOwnerMenus = {
  received: string;
  restaurant_menus: {
    place_id: string;
    duplicate_place_ids?: string[];
    vendor_name: string;
    vendor_name_ar?: string;
    currency: "USD" | "LBP";
    items: {
      section: string;
      item_name: string;
      item_name_ar?: string;
      price_raw: string;
      section_note?: string;
      description?: string;
    }[];
  }[];
};

const OWNER_MENUS = "supabase/seed/shouf/source/04_owner_menu_photos_2026-10-14.json";
// A trailing size shared by every choice: "Kafta / Kabab 1 kg" is Kafta 1 kg or Kabab 1 kg.
const SHARED_SIZE = /\s+((?:\d+(?:\.\d+)?|½)\s*(?:kg|g)|\(\d+\))$/i;

/**
 * "A / B" priced once is one item with a required choice (§39.4): "Soft Drinks / Iced Tea" → Soft Drinks or Iced Tea.
 * Null when the name has no " / ".
 */
export function choiceOf(name: string): DraftOption | null {
  const parts = name
    .split(/\s+\/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const size = parts[parts.length - 1].match(SHARED_SIZE);
  if (size) parts[parts.length - 1] = parts[parts.length - 1].slice(0, size.index).trim();
  return {
    name: "Choice",
    min: 1,
    max: 1,
    choices: parts.map((p) => ({ name: clip(size ? `${p} ${size[1]}` : p, 60) })),
  };
}

/** The owner's transcribed menu photos as seed drafts: sections as printed, prices in the printed currency. */
export function ownerDrafts(raw: RawOwnerMenus): ShoufDraft[] {
  return raw.restaurant_menus.map((m) => {
    const order: string[] = [];
    const bySection = new Map<string, DraftItem[]>();
    for (const i of m.items) {
      if (!bySection.has(i.section)) {
        order.push(i.section);
        bySection.set(i.section, []);
      }
      const p = parsePrice(i.price_raw);
      // A price printed in the other currency than the menu's is not trusted: asked at approval instead.
      const price = p.currency === m.currency ? p : { price: null, currency: null };
      const description = [i.description, i.section_note]
        .map((x) => x?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(". ");
      const choice = choiceOf(i.item_name);
      bySection.get(i.section)!.push({
        name_en: clip(i.item_name.replace(/\s+/g, " ").trim(), 120),
        ...(i.item_name_ar?.trim() ? { name_ar: clip(i.item_name_ar.trim(), 120) } : {}),
        ...(description ? { description: clip(description, 500) } : {}),
        ...price,
        confidence: SEED_CONFIDENCE,
        ...(choice ? { options: [choice] } : {}),
      });
    }
    return {
      place_id: m.place_id,
      kind: "restaurant" as const,
      vendor_name: m.vendor_name,
      sections: order.map((name) => ({
        name_ar: null,
        name_en: name,
        name_fr: null,
        items: bySection.get(name)!,
      })),
      source_url: OWNER_MENUS,
      captured_at: raw.received,
    };
  });
}

/** Listings the owner file names as the same shop (§39.4): duplicate place id → the place id that is kept. */
export function ownerDuplicates(raw: RawOwnerMenus): Map<string, string> {
  return new Map(
    raw.restaurant_menus.flatMap((m) =>
      (m.duplicate_place_ids ?? []).map((d) => [d, m.place_id] as const),
    ),
  );
}
