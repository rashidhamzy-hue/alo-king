// Native WhatsApp cart from the Meta catalogue (DECISIONS §39.12, §30.1.2 as amended): built now on the US test number. The
// server stays the source of truth: the catalogue is a synced mirror of the database, and every cart is re-priced by the
// server before checkout.
//   - sync: the desired catalogue (catalog_desired) is diffed against what was last pushed (catalog_sync_state) into
//     Catalog Batch API requests (items_batch); retailer id = our menu item id, one product set per shop (custom_label_0 =
//     the shop's id). An item that leaves the menu is hidden (visibility "staging"), never deleted.
//   - browse: a single-product message, or a multi-product message by section (at most 30 items in 10 sections)
//   - order: the customer's "send cart" arrives as an `order` message; only retailer ids and quantities are used. The
//     catalogue's price is kept only to tell the customer when the server's price differs; it is never charged.

export type DesiredProduct = {
  retailer_id: string;
  name: string;
  name_en?: string | null;
  description?: string;
  price_minor: number;
  currency: "USD";
  availability: "in stock" | "out of stock";
  product_set: string;
  brand?: string | null;
  has_options?: boolean;
  section?: string;
  section_en?: string;
  /** The item's own photo (Storage path); the catalogue holds only items that have one (session 5e). */
  photo?: string | null;
  /** Changes when the photo is made again under the same path (a new pick or new processing). */
  photo_hash?: string | null;
};

/** A stable hash of what Meta shows for a product, so unchanged items are not re-sent. */
export function productHash(p: DesiredProduct): string {
  const s = JSON.stringify([
    p.name,
    p.description ?? "",
    p.price_minor,
    p.currency,
    p.availability,
    p.product_set,
    p.brand ?? "",
    p.photo ?? "",
    // Only when set, so products without one keep their hash (no needless resend).
    ...(p.photo_hash ? [p.photo_hash] : []),
  ]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** One request of the Catalog Batch API (POST /{catalog_id}/items_batch, item_type PRODUCT_ITEM, allow_upsert). */
export type BatchRequest = { method: "UPDATE"; data: Record<string, unknown> };
export type SyncState = Record<string, { hash: string; visible: boolean }>;

const price = (minor: number) => `${(Math.max(0, Math.round(minor)) / 100).toFixed(2)} USD`;

/**
 * The requests that turn the synced state into the desired one, and the state to record once Meta took them. A product
 * is (re)sent when it is new, changed, was hidden, or on a forced (nightly) sync; an item no longer desired and still
 * visible is hidden. Hidden items stay in the state, so a later hide is never repeated.
 */
export function catalogSyncPlan(
  desired: DesiredProduct[],
  state: SyncState,
  imageUrl: (p: DesiredProduct, hash: string) => string,
  force = false,
): { requests: BatchRequest[]; record: { retailer_id: string; hash: string; visible: boolean }[] } {
  const requests: BatchRequest[] = [];
  const record: { retailer_id: string; hash: string; visible: boolean }[] = [];
  const seen = new Set<string>();
  for (const p of desired) {
    seen.add(p.retailer_id);
    const hash = productHash(p);
    const cur = state[p.retailer_id];
    record.push({ retailer_id: p.retailer_id, hash, visible: true });
    if (!force && cur?.visible && cur.hash === hash) continue;
    const img = imageUrl(p, hash);
    requests.push({
      method: "UPDATE",
      data: {
        id: p.retailer_id,
        title: p.name.slice(0, 150),
        description: (p.description || p.name_en || p.name).slice(0, 500),
        availability: p.availability,
        condition: "new",
        price: price(p.price_minor),
        link: img,
        image_link: img,
        brand: (p.brand || "Alo King").slice(0, 100),
        custom_label_0: p.product_set,
        visibility: "published",
      },
    });
  }
  for (const [id, cur] of Object.entries(state)) {
    if (seen.has(id)) continue;
    record.push({ retailer_id: id, hash: cur.visible ? "hidden" : cur.hash, visible: false });
    if (cur.visible || force)
      requests.push({
        method: "UPDATE",
        data: { id, availability: "out of stock", visibility: "staging" },
      });
  }
  return { requests, record };
}

/** The product set of one shop: every product whose custom_label_0 is the shop's id. */
export const productSetBody = (vendorId: string, name: string) => ({
  name: name.slice(0, 100),
  filter: JSON.stringify({ custom_label_0: { eq: vendorId } }),
});

export type CatalogProduct = {
  retailer_id: string;
  name_ar?: string | null;
  name_en?: string | null;
  price_usd?: number | string;
  section?: string | null;
  section_en?: string | null;
};

/** A multi-product message, by section, within Meta's limits (30 items, 10 sections). */
export function productListMessage(
  to: string,
  catalogId: string,
  header: string,
  body: string,
  products: (CatalogProduct | DesiredProduct)[],
  opts: { lang?: "ar" | "en" | "fr" | "arabizi"; footer?: string } = {},
) {
  const sections = new Map<string, string[]>();
  let n = 0;
  for (const p of products) {
    if ("availability" in p && p.availability !== "in stock") continue;
    if (n >= 30) break;
    const title = opts.lang === "ar" ? p.section : (p.section_en ?? p.section);
    const key = Array.from(String(title || "Menu"))
      .slice(0, 24)
      .join("");
    if (!sections.has(key)) {
      if (sections.size >= 10) continue;
      sections.set(key, []);
    }
    if (sections.get(key)!.includes(p.retailer_id)) continue;
    sections.get(key)!.push(p.retailer_id);
    n++;
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "product_list",
      header: { type: "text", text: Array.from(header).slice(0, 60).join("") },
      body: { text: body.slice(0, 1024) },
      ...(opts.footer ? { footer: { text: Array.from(opts.footer).slice(0, 60).join("") } } : {}),
      action: {
        catalog_id: catalogId,
        sections: [...sections].map(([title, ids]) => ({
          title,
          product_items: ids.map((id) => ({ product_retailer_id: id })),
        })),
      },
    },
  };
}

/** A single-product message: one item with its image, price and description from the catalogue. */
export function productMessage(
  to: string,
  catalogId: string,
  retailerId: string,
  body: string,
  footer?: string,
) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "interactive",
    interactive: {
      type: "product",
      body: { text: body.slice(0, 1024) },
      ...(footer ? { footer: { text: Array.from(footer).slice(0, 60).join("") } } : {}),
      action: { catalog_id: catalogId, product_retailer_id: retailerId },
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CartLine = { itemId: string; quantity: number; shownUsd: number | null };

/**
 * The lines of a cart the customer sent (`type: "order"`): our item ids and quantities, merged per item; unknown ids
 * and silly quantities are dropped. The catalogue's price (`item_price`, USD only) is kept as `shownUsd` so the server
 * can tell the customer when its own price differs; it is never charged.
 */
export function parseCartOrder(
  msg: any,
): { catalogId: string | null; text: string | null; lines: CartLine[] } | null {
  if (msg?.type !== "order" || !Array.isArray(msg?.order?.product_items)) return null;
  const lines = new Map<string, CartLine>();
  for (const it of msg.order.product_items) {
    const id = String(it?.product_retailer_id ?? "");
    const q = Math.trunc(Number(it?.quantity));
    if (!UUID.test(id) || !Number.isFinite(q) || q < 1) continue;
    const shown = Number(it?.item_price);
    const usd =
      String(it?.currency ?? "USD").toUpperCase() === "USD" && Number.isFinite(shown) && shown >= 0
        ? Math.round(shown * 100) / 100
        : null;
    const cur = lines.get(id);
    lines.set(id, {
      itemId: id,
      quantity: Math.min(50, (cur?.quantity ?? 0) + q),
      shownUsd: cur ? cur.shownUsd : usd,
    });
  }
  const text = typeof msg.order.text === "string" ? msg.order.text.slice(0, 300) : null;
  return {
    catalogId: msg.order.catalog_id ? String(msg.order.catalog_id) : null,
    text,
    lines: [...lines.values()].slice(0, 30),
  };
}

// ---- Session 5e: a shop's menu as product messages, grouped by its sections, the best sections first ------------------
export type ShopMenuSection = {
  section_id: string | null;
  name_ar: string;
  name_en: string;
  total: number;
  products: CatalogProduct[];
};

/**
 * The first product message of a shop: sections in the order given (best first), at most `perSection` items of each,
 * at most 30 items and 10 sections (Meta's limits). `rest` is every section not shown in full, in the same order, for the
 * list that opens them.
 */
export function packShopMenu(
  sections: ShopMenuSection[],
  opts: { perSection: number; maxItems?: number; maxSections?: number },
): { products: CatalogProduct[]; rest: ShopMenuSection[] } {
  const maxItems = Math.min(opts.maxItems ?? 30, 30);
  const maxSections = Math.min(opts.maxSections ?? 10, 10);
  const products: CatalogProduct[] = [];
  const rest: ShopMenuSection[] = [];
  let shown = 0;
  for (const s of sections) {
    const room = maxItems - products.length;
    // A shop with few sections shows more of each (a 2-section shop is not cut at 6).
    const per = Math.max(
      opts.perSection,
      Math.floor(maxItems / Math.min(sections.length, maxSections)),
    );
    const take = shown < maxSections && room > 0 ? Math.min(per, room, s.products.length) : 0;
    if (take > 0) {
      shown++;
      for (const p of s.products.slice(0, take))
        products.push({ ...p, section: s.name_ar, section_en: s.name_en });
    }
    if (take < s.total) rest.push(s);
  }
  return { products, rest };
}
