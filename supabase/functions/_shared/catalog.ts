// Native WhatsApp cart from the Meta catalogue (DECISIONS §30.1.2), built against fixtures: it needs the
// company's Meta business portfolio, so it is switched on at cut-over (config `catalog_enabled`).
//   - sync: the desired catalogue (catalog_desired) is diffed against what was last pushed
//     (catalog_synced) into Catalog Batch API requests; retailer_id = our menu item id, one product set
//     per branch
//   - browse: a multi-product message by section (at most 30 items, 10 sections)
//   - order: the customer's "send cart" arrives as an `order` message; only retailer ids and quantities
//     are read. Catalogue prices are never trusted: the server re-prices every line from the database.

export type DesiredProduct = {
  retailer_id: string;
  name: string;
  name_en?: string | null;
  description?: string;
  price_minor: number;
  currency: "USD";
  availability: "in stock" | "out of stock";
  product_set: string;
  has_options?: boolean;
  section?: string;
};

/** A stable hash of what Meta shows for a product, so unchanged items are not re-sent. */
export function productHash(p: DesiredProduct): string {
  const s = JSON.stringify([p.name, p.description ?? "", p.price_minor, p.currency, p.availability, p.product_set]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export type BatchRequest = {
  method: "CREATE" | "UPDATE" | "DELETE";
  retailer_id: string;
  data?: Record<string, unknown>;
};

/** Catalog Batch API requests that turn the synced state into the desired one. */
export function catalogSyncPlan(
  desired: DesiredProduct[],
  synced: Record<string, string>,
  imageUrl: (p: DesiredProduct) => string,
): { requests: BatchRequest[]; record: { retailer_id: string; hash: string }[] } {
  const requests: BatchRequest[] = [];
  const seen = new Set<string>();
  for (const p of desired) {
    seen.add(p.retailer_id);
    const hash = productHash(p);
    if (synced[p.retailer_id] === hash) continue;
    requests.push({
      method: synced[p.retailer_id] ? "UPDATE" : "CREATE",
      retailer_id: p.retailer_id,
      data: {
        name: p.name.slice(0, 150),
        description: (p.description || p.name_en || p.name).slice(0, 500),
        price: p.price_minor,
        currency: p.currency,
        availability: p.availability,
        condition: "new",
        image_url: imageUrl(p),
        url: imageUrl(p),
        retailer_product_group_id: p.product_set,
      },
    });
  }
  for (const id of Object.keys(synced)) if (!seen.has(id)) requests.push({ method: "DELETE", retailer_id: id });
  return { requests, record: desired.map((p) => ({ retailer_id: p.retailer_id, hash: productHash(p) })) };
}

/** A multi-product message for one branch, by section, within Meta's limits (30 items, 10 sections). */
export function productListMessage(
  to: string,
  catalogId: string,
  header: string,
  body: string,
  products: DesiredProduct[],
) {
  const sections = new Map<string, string[]>();
  let n = 0;
  for (const p of products) {
    if (p.availability !== "in stock" || n >= 30) continue;
    const key = (p.section || "Menu").slice(0, 24);
    if (!sections.has(key)) {
      if (sections.size >= 10) continue;
      sections.set(key, []);
    }
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
      header: { type: "text", text: header.slice(0, 60) },
      body: { text: body.slice(0, 1024) },
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The lines of a cart the customer sent (`type: "order"`): our item ids and quantities only. Prices in the
 * message (`item_price`) are ignored; unknown ids and silly quantities are dropped.
 */
export function parseCartOrder(msg: any): { catalogId: string | null; lines: { itemId: string; quantity: number }[] } | null {
  if (msg?.type !== "order" || !Array.isArray(msg?.order?.product_items)) return null;
  const lines = new Map<string, number>();
  for (const it of msg.order.product_items) {
    const id = String(it?.product_retailer_id ?? "");
    const q = Math.trunc(Number(it?.quantity));
    if (!UUID.test(id) || !Number.isFinite(q) || q < 1) continue;
    lines.set(id, Math.min(50, (lines.get(id) ?? 0) + q));
  }
  return {
    catalogId: msg.order.catalog_id ? String(msg.order.catalog_id) : null,
    lines: [...lines].slice(0, 30).map(([itemId, quantity]) => ({ itemId, quantity })),
  };
}
