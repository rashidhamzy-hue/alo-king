import { describe, expect, it, vi } from "vitest";
import {
  fetchOff,
  lookupProduct,
  normalizeGtin,
  normalizeOff,
  productCardText,
} from "./open-food-facts.ts";

const NIDO = {
  status: 1,
  product: {
    product_name: "Nido Fortified Milk Powder",
    brands: "Nestlé, Nido",
    quantity: "900 g",
    allergens_tags: ["en:milk", "en:soybeans", "en:unknown-thing"],
    ingredients_text: "Whole milk powder, soy lecithin",
    nutriscore_grade: "C",
    nutriments: { "energy-kcal_100g": 497.4 },
    image_front_url: "https://images.openfoodfacts.org/images/products/1.jpg",
  },
};

describe("Open Food Facts (§39.5)", () => {
  it("accepts only GTINs with a valid check digit, Arabic digits and spaces allowed", () => {
    expect(normalizeGtin("5281234567892")).toBeNull();
    expect(normalizeGtin("4006381333931")).toBe("4006381333931");
    expect(normalizeGtin("٤٠٠٦٣٨١٣٣٣٩٣١")).toBe("4006381333931");
    expect(normalizeGtin("4006 3813 33931")).toBe("4006381333931");
    expect(normalizeGtin("96385074")).toBe("96385074");
    expect(normalizeGtin("036000291452")).toBe("036000291452");
    expect(normalizeGtin("1234")).toBeNull();
    expect(normalizeGtin("+96170123456")).toBeNull();
  });

  it("normalises a product to our allergens, marks unknown tags out, keeps OFF images only", () => {
    const p = normalizeOff("4006381333931", NIDO);
    expect(p).toMatchObject({
      found: true,
      name: "Nido Fortified Milk Powder",
      brand: "Nestlé",
      quantity: "900 g",
      allergens: ["dairy", "soy"],
      nutriscore_grade: "c",
      energy_kcal_100g: 497,
    });
    expect(p.image_url).toMatch(/^https:\/\/images\.openfoodfacts\.org\//);
    const bad = normalizeOff("4006381333931", {
      status: 1,
      product: { ...NIDO.product, image_front_url: "https://evil.example/x.jpg" },
    });
    expect(bad.image_url).toBeNull();
    expect(normalizeOff("4006381333931", { status: 0 })).toMatchObject({
      found: false,
      name: null,
      allergens: [],
    });
  });

  it("asks OFF with a named User-Agent and a deadline; 404 is 'not found', 5xx throws", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(NIDO), { status: 200 }));
    const p = await fetchOff("4006381333931", { fetch: f as unknown as typeof fetch });
    expect(p.found).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v2\/product\/4006381333931\.json\?fields=/);
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/^AloKing\//);
    expect(init.signal).toBeDefined();
    const nf = await fetchOff("4006381333931", {
      fetch: (async () => new Response("", { status: 404 })) as typeof fetch,
    });
    expect(nf.found).toBe(false);
    await expect(
      fetchOff("4006381333931", {
        fetch: (async () => new Response("", { status: 503 })) as typeof fetch,
      }),
    ).rejects.toThrow(/503/);
  });

  it("reads the cache first, asks OFF only on a miss and writes the answer back", async () => {
    const calls: string[] = [];
    const cached = { barcode: "4006381333931", found: true, name: "Cached", allergens: [] };
    const hit = await lookupProduct("4006381333931", {
      rpc: async (fn) => (calls.push(fn), cached),
      fetch: (async () => {
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    expect(hit?.name).toBe("Cached");
    expect(calls).toEqual(["off_product_get"]);
    const writes: unknown[] = [];
    const miss = await lookupProduct("4006381333931", {
      rpc: async (fn, a) => (fn === "off_product_put" ? (writes.push(a.p_product), null) : null),
      fetch: (async () => new Response(JSON.stringify(NIDO))) as typeof fetch,
    });
    expect(miss?.name).toBe("Nido Fortified Milk Powder");
    expect(writes).toHaveLength(1);
    const down = await lookupProduct("4006381333931", {
      rpc: async () => null,
      fetch: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(down).toBeNull();
  });

  it("shows the merchant what OFF says, marked estimated, with the ODbL attribution", () => {
    const t = productCardText(normalizeOff("4006381333931", NIDO), "4006381333931");
    expect(t).toMatch(/Nido Fortified Milk Powder · Nestlé · 900 g/);
    expect(t).toMatch(/estimated/);
    expect(t).toMatch(/حليب dairy/);
    expect(t).toMatch(/ODbL/);
    expect(productCardText(normalizeOff("4006381333931", { status: 0 }), "4006381333931")).toMatch(
      /not on Open Food Facts/,
    );
    expect(productCardText(null, "4006381333931")).toMatch(/not reachable/);
  });
});
