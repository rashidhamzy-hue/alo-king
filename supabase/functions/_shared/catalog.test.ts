import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogSyncPlan, parseCartOrder, productHash, productListMessage, type DesiredProduct } from "./catalog";
import { checkInteractive } from "./meta-limits";

// Built against fixtures (§30.1.2): a catalogue needs the company's Meta business portfolio (cut-over).
const desired: DesiredProduct[] = JSON.parse(readFileSync("evals/catalog/desired.json", "utf8"));
const img = (p: DesiredProduct) => `https://aloking.com/i/${p.retailer_id}.jpg`;

describe("catalogue sync plan", () => {
  it("creates everything the first time, with our item id as retailer_id and a set per branch", () => {
    const { requests, record } = catalogSyncPlan(desired, {}, img);
    expect(requests.map((r) => r.method)).toEqual(["CREATE", "CREATE", "CREATE"]);
    expect(requests[0]).toMatchObject({
      retailer_id: desired[0].retailer_id,
      data: { price: 500, currency: "USD", retailer_product_group_id: desired[0].product_set },
    });
    expect(record).toHaveLength(3);
  });
  it("sends only what changed, and deletes what left the menu", () => {
    const synced = Object.fromEntries(desired.map((p) => [p.retailer_id, productHash(p)]));
    synced["99999999-0000-0000-0000-000000000001"] = "old";
    const changed = desired.map((p, k) => (k === 1 ? { ...p, price_minor: 350 } : p));
    const { requests } = catalogSyncPlan(changed, synced, img);
    expect(requests).toEqual([
      expect.objectContaining({ method: "UPDATE", retailer_id: desired[1].retailer_id }),
      { method: "DELETE", retailer_id: "99999999-0000-0000-0000-000000000001" },
    ]);
  });
});

describe("multi-product message", () => {
  it("shows only items in stock, by section, within 30 items and 10 sections", () => {
    const many: DesiredProduct[] = Array.from({ length: 45 }, (_, k) => ({
      ...desired[0],
      retailer_id: `53000000-0000-0000-0000-${String(k).padStart(12, "0")}`,
      section: `Section ${k % 12} with a long name`,
    }));
    const p: any = productListMessage("+96170000001", "1234567890", "مطعم أ", "Pick and send your cart", [...desired, ...many]);
    expect(checkInteractive(p)).toEqual([]);
    const ids = p.interactive.action.sections.flatMap((s: any) => s.product_items.map((i: any) => i.product_retailer_id));
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
        action: { catalog_id: "1", sections: [{ title: "a", product_items: Array(31).fill({ product_retailer_id: "1" }) }] },
      },
    };
    expect(checkInteractive(bad).join()).toMatch(/31 products/);
  });
});

describe("cart order message", () => {
  const fx = JSON.parse(readFileSync("evals/catalog/order-message.json", "utf8"));
  it("reads only item ids and quantities, merges repeats, drops junk, ignores catalogue prices", () => {
    const o = parseCartOrder(fx.message)!;
    expect(o.catalogId).toBe("1234567890");
    expect(o.lines).toEqual([
      { itemId: "53000000-0000-0000-0000-000000000001", quantity: 3 },
      { itemId: "51000000-0000-0000-0000-000000000002", quantity: 1 },
    ]);
    expect(JSON.stringify(o)).not.toMatch(/item_price|0\.01/);
  });
  it("anything else is not an order", () => {
    expect(parseCartOrder({ type: "text", text: { body: "x" } })).toBeNull();
  });
});
