import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  catalogSyncPlan,
  parseCartOrder,
  productHash,
  productListMessage,
  productMessage,
  productSetBody,
  type DesiredProduct,
} from "./catalog";
import { checkInteractive } from "./meta-limits";

// Built against fixtures (§30.1.2): a catalogue needs the company's Meta business portfolio (cut-over).
const desired: DesiredProduct[] = JSON.parse(readFileSync("evals/catalog/desired.json", "utf8"));

describe("catalogue sync plan (§39.12)", () => {
  const img = (p: DesiredProduct, h: string) => `https://example.test/i/${p.retailer_id}?v=${h}`;
  it("sends every product the first time through items_batch, with our item id, the price in USD and the shop's set", () => {
    const { requests, record } = catalogSyncPlan(desired, {}, img);
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.method === "UPDATE")).toBe(true);
    expect(requests[0].data).toMatchObject({
      id: desired[0].retailer_id,
      price: "5.00 USD",
      custom_label_0: desired[0].product_set,
      visibility: "published",
      condition: "new",
    });
    expect(String(requests[0].data.image_link)).toContain(desired[0].retailer_id);
    expect(record.every((r) => r.visible)).toBe(true);
  });
  it("sends only what changed, and hides (never deletes) what left the menu", () => {
    const state = Object.fromEntries(
      desired.map((p) => [p.retailer_id, { hash: productHash(p), visible: true }]),
    );
    state["99999999-0000-0000-0000-000000000001"] = { hash: "old", visible: true };
    const changed = desired.map((p, k) => (k === 1 ? { ...p, price_minor: 350 } : p));
    const { requests, record } = catalogSyncPlan(changed, state, img);
    expect(requests).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ id: desired[1].retailer_id, price: "3.50 USD" }),
      }),
      {
        method: "UPDATE",
        data: {
          id: "99999999-0000-0000-0000-000000000001",
          availability: "out of stock",
          visibility: "staging",
        },
      },
    ]);
    expect(record.find((r) => r.retailer_id === "99999999-0000-0000-0000-000000000001")).toEqual({
      retailer_id: "99999999-0000-0000-0000-000000000001",
      hash: "hidden",
      visible: false,
    });
    expect(JSON.stringify(requests)).not.toMatch(/DELETE/);
  });
  it("a hidden item is not hidden again; it comes back when it returns to the menu; a nightly sync re-sends all", () => {
    const id = desired[0].retailer_id;
    const hidden = { [id]: { hash: "hidden", visible: false } };
    expect(catalogSyncPlan([], hidden, img).requests).toEqual([]);
    expect(catalogSyncPlan([desired[0]], hidden, img).requests[0].data).toMatchObject({
      id,
      visibility: "published",
    });
    const synced = Object.fromEntries(
      desired.map((p) => [p.retailer_id, { hash: productHash(p), visible: true }]),
    );
    expect(catalogSyncPlan(desired, synced, img).requests).toEqual([]);
    expect(catalogSyncPlan(desired, synced, img, true).requests).toHaveLength(3);
  });
  it("one product set per shop, filtered on custom_label_0", () => {
    expect(productSetBody("20000000-0000-0000-0000-00000000000a", "Alo Test Grill")).toEqual({
      name: "Alo Test Grill",
      filter: JSON.stringify({ custom_label_0: { eq: "20000000-0000-0000-0000-00000000000a" } }),
    });
  });
});

describe("multi-product message", () => {
  it("shows only items in stock, by section, within 30 items and 10 sections", () => {
    const many: DesiredProduct[] = Array.from({ length: 45 }, (_, k) => ({
      ...desired[0],
      retailer_id: `53000000-0000-0000-0000-${String(k).padStart(12, "0")}`,
      section: `Section ${k % 12} with a long name`,
    }));
    const p: any = productListMessage(
      "+96170000001",
      "1234567890",
      "مطعم أ",
      "Pick and send your cart",
      [...desired, ...many],
    );
    expect(checkInteractive(p)).toEqual([]);
    const ids = p.interactive.action.sections.flatMap((s: any) =>
      s.product_items.map((i: any) => i.product_retailer_id),
    );
    expect(ids).not.toContain(desired[2].retailer_id); // out of stock
    expect(ids.length).toBeLessThanOrEqual(30);
    expect(p.interactive.action.sections.length).toBeLessThanOrEqual(10);
  });
  it("the checker catches product lists over the limits", () => {
    const bad = {
      interactive: {
        type: "product_list",
        header: { type: "text", text: "x" },
        body: { text: "x" },
        action: {
          catalog_id: "1",
          sections: [{ title: "a", product_items: Array(31).fill({ product_retailer_id: "1" }) }],
        },
      },
    };
    expect(checkInteractive(bad).join()).toMatch(/31 products/);
  });
});

describe("cart order message", () => {
  const fx = JSON.parse(readFileSync("evals/catalog/order-message.json", "utf8"));
  it("reads item ids and quantities, merges repeats, drops junk, keeps the catalogue price only to report a change", () => {
    const o = parseCartOrder(fx.message)!;
    expect(o.catalogId).toBe("1234567890");
    expect(o.text).toBe("please fast");
    expect(o.lines).toEqual([
      { itemId: "53000000-0000-0000-0000-000000000001", quantity: 3, shownUsd: 0.01 },
      { itemId: "51000000-0000-0000-0000-000000000002", quantity: 1, shownUsd: 3 },
    ]);
  });
  it("a price in another currency is not kept", () => {
    const o = parseCartOrder({
      type: "order",
      order: {
        product_items: [
          {
            product_retailer_id: "53000000-0000-0000-0000-000000000001",
            quantity: 1,
            item_price: 450000,
            currency: "LBP",
          },
        ],
      },
    })!;
    expect(o.lines[0].shownUsd).toBeNull();
  });
  it("anything else is not an order", () => {
    expect(parseCartOrder({ type: "text", text: { body: "x" } })).toBeNull();
  });
});

describe("single-product message (§39.12)", () => {
  it("one catalogue item, no header, within Meta's limits", () => {
    const m: any = productMessage(
      "+96170000001",
      "1234567890",
      "53000000-0000-0000-0000-000000000001",
      "We found it",
      "Prices from the shop",
    );
    expect(m.to).toBe("96170000001");
    expect(m.interactive.action).toEqual({
      catalog_id: "1234567890",
      product_retailer_id: "53000000-0000-0000-0000-000000000001",
    });
    expect(checkInteractive(m)).toEqual([]);
    expect(
      checkInteractive({
        interactive: { ...m.interactive, header: { type: "text", text: "x" } },
      }).join(),
    ).toMatch(/no header/);
    expect(
      checkInteractive({
        interactive: { type: "product", body: { text: "x" }, action: { catalog_id: "1" } },
      }).join(),
    ).toMatch(/product_retailer_id/);
  });
});

// DECISIONS §39.15.2: the words Meta shows, and the item's page as its link.
import { withContent } from "./catalog";

describe("item content in the catalogue (session 5f)", () => {
  const raw = {
    retailer_id: "53000000-0000-0000-0000-000000000001",
    name: "HOT DOG",
    description: "📷 insatiablemunch via Openverse (flickr) · CC BY 2.0",
    name_en: "HOT DOG",
    name_ar: "هوت دوغ",
    shop_en: "West Diner",
    village_en: "Baakline",
    usually: ["sausage", "bun", "mustard"],
    has_options: true,
    price_minor: 450,
    currency: "USD" as const,
    availability: "in stock" as const,
    product_set: "v",
    brand: "West Diner",
    link: "https://alo-king.vercel.app/en/i/53000000-0000-0000-0000-000000000001",
  };
  it('titles "<Item> · <Shop>" in Title Case, describes without any credit, links to the item page', () => {
    const p = withContent(raw);
    expect(p.name).toBe("Hot Dog · West Diner");
    expect(p.description).toBe(
      "West Diner · Baakline\nهوت دوغ\nUsually made with sausage, bun and mustard.\nExtras chosen after you add it",
    );
    const plan = catalogSyncPlan([p], {}, () => "https://img.example/x");
    expect(plan.requests[0].data).toMatchObject({
      title: "Hot Dog · West Diner",
      link: raw.link,
      image_link: "https://img.example/x",
      brand: "West Diner",
    });
    expect(String(plan.requests[0].data.description)).not.toMatch(/📷|CC BY|Openverse/);
  });
  it("a new link changes the hash, so every product is sent again once", () => {
    expect(productHash(withContent(raw))).not.toBe(
      productHash(withContent({ ...raw, link: null })),
    );
  });
});
