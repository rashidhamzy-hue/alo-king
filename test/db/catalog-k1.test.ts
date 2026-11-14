// Build plan 1.21 (session K1): the WhatsApp catalog. The database stays the only source of price and stock; the catalog is a
// way to browse and choose, never a way to confirm. The tests the plan lists, on the real schema (migration 0085):
//   a cart order and the same order typed in chat produce identical quotes; a cart item that is out of stock is named and removed
//   before the card; a cart with a stale price shows the database price on the card; no product without an approved picture
//   appears in the feed; no product-list message is ever built with more than 30 products or 10 sections; a catalog cart never
//   confirms an order without the customer's tap.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, use, type Sent } from "./flow-kit";
import { supabaseOver } from "./supabase-shim";
import { catalogFeed, FEED_COLUMNS, feedCsv } from "../../apps/gateway/src/catalog-feed";
import { LIST_LIMITS, productListMessages } from "@ak/agents/catalog-messages";
import { CART_TEXT } from "@ak/agents/cart";

let db: TestDb;
let ops: string;
const ids: Record<string, string> = {};
const SKUS = { water: "AK-0103", bread: "AK-0080", coffee: "AK-0133" } as const;
const CATALOG_ID = "1234567890";
let BAAKLINE: string;
let n = 0;
async function approvePicture(sku: string, kind: "open_food_facts" | "intake_photo" | "web_search" = "intake_photo", approve = true) {
  n++;
  const product = (await db.one(`select id from products where sku = $1`, [sku])).id;
  const p = await db.rpc<any>("propose_product_image", { p_product: product, p_source_kind: kind,
    p_source_url: kind === "intake_photo" ? null : `https://example.test/${n}.jpg`, p_page_url: null,
    p_attribution: kind === "open_food_facts" ? "Open Food Facts contributors, CC BY-SA 3.0" : null,
    p_media_path: `product_images/${sku}/${n}.jpg`, p_sha256: `sha-k1-${n}`, p_width: 1200, p_height: 1200, p_bytes: 100000, p_vision: {} });
  if (approve) await db.rpc("review_product_image", { p_image: p.image_id ?? p.id, p_by: ops, p_decision: "approve", p_note: null });
}

beforeAll(async () => {
  ({ db } = await openFlowDb());
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  for (const [k, sku] of Object.entries(SKUS)) ids[k] = (await db.one(`select id from products where sku = $1`, [sku])).id;
  BAAKLINE = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.pg.query(`update settings set value = value || jsonb_build_object('catalog_id', $1::text, 'product_link', 'https://wa.me/96100000000?text={sku}') where key = 'catalog'`, [CATALOG_ID]);
  for (const sku of Object.values(SKUS)) await approvePicture(sku);
}, 60_000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db?.pg.close(); });

const bodyOf = (s: Sent) => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const cart = (items: { sku: string; qty: number; price?: number }[], text?: string) => ({
  type: "order", order: { catalog_id: CATALOG_ID, ...(text ? { text } : {}),
    product_items: items.map((i) => ({ product_retailer_id: i.sku, quantity: i.qty, item_price: i.price ?? 0, currency: "USD" })) } });
const priceOf = async (sku: string) => Number((await db.one(`select o.price_usd from offers o join products p on p.id = o.product_id
  join sources s on s.id = o.source_id where p.sku = $1 and s.kind = 'dark_store'`, [sku])).price_usd);
const READING = {
  intent: "order", fulfilment: "delivery", transcript_quality: "good", needs_clarification: [],
  lines: [
    { qty: 2, raw: "2 كرتونة مي تنورين", unit: "each", query: "مي تنورين", modifiers: [], brand_hint: "تنورين", confidence: 0.9, source_hint: null },
    { qty: 1, raw: "ربطة خبز الفورنو", unit: "bundle", query: "خبز الفورنو", modifiers: [], brand_hint: "الفورنو", confidence: 0.9, source_hint: null },
    { qty: 1, raw: "قهوة نجار", unit: "each", query: "قهوة نجار", modifiers: [], brand_hint: "نجار", confidence: 0.9, source_hint: null },
  ],
  address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null },
};
async function lastOrder(partyId: string) {
  const o = await db.one(`select * from orders where customer_id = $1 order by created_at desc limit 1`, [partyId]);
  const items = await db.all(`select product_id, qty::numeric as qty, unit_price_usd::numeric as unit from order_items where order_id = $1 order by product_id`, [o.id]);
  return { o, items: items.map((i: any) => ({ product_id: i.product_id, qty: Number(i.qty), unit: Number(i.unit) })) };
}

describe("categories (1.21 step 1, the approved list)", () => {
  const approved = JSON.parse(readFileSync(new URL("../../data/proposals/categories.json", import.meta.url), "utf8"));
  it("are the fifteen approved, in their order, with their approved names", async () => {
    const rows = await db.all(`select code, name_en, name_ar, sort_order from catalog_categories order by sort_order`);
    expect(rows.map((r: any) => [r.code, r.name_en, r.name_ar, r.sort_order]))
      .toEqual(approved.categories.map((c: any) => [c.code, c.name_en, c.name_ar, c.sort_order]));
  });
  it("place every product of the catalog exactly once, as approved except K1's seven checked moves", async () => {
    const report = await db.rpc<any>("catalog_feed_report");
    expect(report.not_placed).toEqual([]);
    expect(Number(report.placed)).toBe(291);
    const placed = new Map((await db.all(`select sku, category_code from catalog_placements`)).map((r: any) => [r.sku, r.category_code]));
    const moved = approved.assignments.filter((a: any) => placed.get(a.sku) !== a.category).map((a: any) => [a.sku, placed.get(a.sku)]).sort();
    expect(moved).toEqual([["AK-0064", "dairy_eggs"], ["AK-0066", "dairy_eggs"], ["AK-0100", "deli_ready_meals"], ["AK-0132", "water_drinks"],
                           ["AK-0168", "breakfast_cereal"], ["AK-0214", "cooking_baking"], ["AK-0215", "cooking_baking"]]);
  });
  it("split a category longer than one product list into named sub-groups", async () => {
    const big = await db.all(`select category_code, count(*)::int as n, count(subgroup_code)::int as grouped from catalog_placements group by 1 having count(*) > 30`);
    expect(big).toEqual([{ category_code: "water_drinks", n: 42, grouped: 42 }]);
    expect(Number((await db.one(`select max(c) as m from (select count(*) c from catalog_placements group by category_code, subgroup_code) x`)).m)).toBeLessThanOrEqual(30);
  });
});

describe("the feed (1.21 step 2)", () => {
  it("holds no product without an approved, customer-usable picture", async () => {
    await approvePicture("AK-0001", "intake_photo", false);                // proposed, never reviewed
    await approvePicture("AK-0002", "web_search", true);                   // approved, but its licence is unknown
    const feed = await db.rpc<any[]>("catalog_feed");
    expect(feed.map((r) => r.sku).sort()).toEqual(Object.values(SKUS).sort());
    const withPicture = await db.all(`select p.sku from products p join product_images i on i.product_id = p.id
      where i.status = 'approved' and product_image_licence_usable(i.licence)`);
    for (const r of feed) expect(withPicture.map((x: any) => x.sku)).toContain(r.sku);
  });

  it("is a CSV behind a password, priced and stocked from the database, with a signed picture link", async () => {
    const shim = supabaseOver(db);
    const signed: string[] = [];
    const deps = { db: shim.client, password: "pw", sign: async (p: string, s: number) => { signed.push(`${p}@${s}`); return `https://signed.test/${p}?t=x`; } };
    const req = (auth?: string) => new Request("https://gw/catalog/feed.csv", { headers: auth ? { Authorization: auth } : {} });
    expect((await catalogFeed(req(), deps)).status).toBe(401);
    expect((await catalogFeed(req(`Basic ${btoa("meta:wrong")}`), deps)).status).toBe(401);
    expect((await catalogFeed(req(`Basic ${btoa("meta:pw")}`), { ...deps, password: undefined })).status).toBe(404);
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [ids.coffee]);
    const res = await catalogFeed(req(`Basic ${btoa("meta:pw")}`), deps);
    await db.pg.query(`update stock_levels set on_hand = 500 where product_id = $1`, [ids.coffee]);
    expect(res.status).toBe(200);
    const [head, ...rows] = (await res.text()).trim().split("\n");
    expect(head).toBe(FEED_COLUMNS.join(","));
    expect(rows).toHaveLength(3);
    const water = rows.find((r) => r.startsWith(SKUS.water + ","))!;
    expect(water).toContain(`${(await priceOf(SKUS.water)).toFixed(2)} USD`);
    expect(water).toContain("in stock");
    expect(water).toContain(`https://wa.me/96100000000?text=${SKUS.water}`);
    expect(water).toContain("https://signed.test/product_images/AK-0103/");
    expect(rows.find((r) => r.startsWith(SKUS.coffee + ","))).toContain("out of stock");
    expect(signed.every((s) => s.endsWith("@604800"))).toBe(true);
  });

  it("answers 503 until a person sets the product link, and never guesses one", async () => {
    await db.pg.query(`update settings set value = value || '{"product_link": null}' where key = 'catalog'`);
    const res = await catalogFeed(new Request("https://gw/catalog/feed.csv", { headers: { Authorization: `Basic ${btoa("meta:pw")}` } }),
                                  { db: supabaseOver(db).client, password: "pw", sign: async () => "x" });
    await db.pg.query(`update settings set value = value || '{"product_link": "https://wa.me/96100000000?text={sku}"}' where key = 'catalog'`);
    expect(res.status).toBe(503);
  });

  it("credits a CC BY-SA picture in the row, and leaves out a row whose picture could not be signed", () => {
    const row = { sku: "AK-1", product_id: "x", name_en: "Thing", name_ar: "شي", brand: "B", price_usd: 1, in_stock: true, media_path: "m",
                  attribution: "Open Food Facts contributors, CC BY-SA 3.0", licence: "cc_by_sa", category_code: "c", category_en: "C", category_ar: "ج",
                  subgroup_en: null, subgroup_ar: null };
    const csv = feedCsv([row, { ...row, sku: "AK-2" }], { product_link: "https://l/{sku}" }, new Map([["AK-1", "https://img/1"]]));
    expect(csv).toContain("Photo: Open Food Facts contributors");
    expect(csv).not.toContain("AK-2");
  });
});

describe("product lists (1.21 step 4)", () => {
  it("never hold more than 30 products or 10 sections, whatever the category", () => {
    for (let trial = 0; trial < 300; trial++) {
      const sections = Array.from({ length: 1 + (trial % 14) }, (_, s) => ({ title: `قسم ${s} ${"ط".repeat(trial % 30)}`,
        skus: Array.from({ length: (trial * 7 + s * 13) % 47 }, (_, i) => `S${s}-${i}`) }));
      const total = sections.reduce((a, s) => a + s.skus.length, 0);
      const msgs = productListMessages("c", "عنوان", "نص", sections);
      let seen = 0;
      for (const m of msgs) {
        const action = (m as any).interactive.action;
        const count = action.sections.reduce((a: number, s: any) => a + s.product_items.length, 0);
        expect(count).toBeLessThanOrEqual(LIST_LIMITS.products);
        expect(action.sections.length).toBeLessThanOrEqual(LIST_LIMITS.sections);
        for (const s of action.sections) { expect(s.title.length).toBeLessThanOrEqual(24); expect(s.product_items.length).toBeGreaterThan(0); }
        expect((m as any).interactive.header.text.length).toBeLessThanOrEqual(60);
        seen += count;
      }
      expect(seen).toBe(total);
    }
  });

  it("the Concierge's show_catalog sends one category as interactive product lists through the gateway", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read({ intent: "question", lines: [], address: READING.address, needs_clarification: [] }),
                        [use("show_catalog", { category: "مياه" })]]);
    await t.text("شو عندكن مي؟");
    expect(outbound).toHaveLength(1);
    const msg = outbound[0]!.body;
    expect(msg.type).toBe("interactive");
    expect(msg.interactive.type).toBe("product_list");
    expect(msg.interactive.action.catalog_id).toBe(CATALOG_ID);
    expect(msg.interactive.action.sections.flatMap((s: any) => s.product_items.map((p: any) => p.product_retailer_id))).toEqual([SKUS.water, SKUS.coffee]);
  }, 60_000);

  it("refuses when the Meta catalog is not set up yet, and the turn goes on in words", async () => {
    await db.pg.query(`update settings set value = value || '{"catalog_id": null}' where key = 'catalog'`);
    const outbound = recordKapso();
    const t = flow(db, [read({ intent: "question", lines: [], address: READING.address, needs_clarification: [] }),
                        [use("show_catalog", {})], [use("reply", { text: "شو بتحب تطلب؟" })]]);
    await t.text("وريني الكتالوج");
    await db.pg.query(`update settings set value = value || jsonb_build_object('catalog_id', $1::text) where key = 'catalog'`, [CATALOG_ID]);
    expect(outbound.map((o) => o.body.type)).toEqual(["text"]);
  }, 60_000);
});

describe("a cart from the catalog (1.21 step 5)", () => {
  it("and the same order typed in chat produce identical quotes, and the cart never confirms without the tap", async () => {
    let outbound = recordKapso();
    const typed = flow(db, [read(READING)]);
    const c1 = await pinned(db, typed, BAAKLINE);
    await typed.text("بدي 2 كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار");
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");
    const a = await lastOrder(c1.party_id);

    outbound = recordKapso();
    const viaCart = flow(db, []);
    const c2 = await pinned(db, viaCart, BAAKLINE);
    await viaCart.say(cart([{ sku: SKUS.water, qty: 2, price: await priceOf(SKUS.water) }, { sku: SKUS.bread, qty: 1, price: await priceOf(SKUS.bread) },
                            { sku: SKUS.coffee, qty: 1, price: await priceOf(SKUS.coffee) }]));
    expect(viaCart.seen).toHaveLength(0);                                 // no model: code turns the cart into the card
    expect(outbound).toHaveLength(1);
    expect(bodyOf(outbound[0]!)).toContain("طلبك AK-");
    const b = await lastOrder(c2.party_id);
    expect(b.items).toEqual(a.items);
    for (const k of ["subtotal_usd", "delivery_fee_usd", "total_usd", "village_id", "payment_method"]) expect(b.o[k], k).toEqual(a.o[k]);

    // The catalog never confirms: the order waits for the tap, and only the tap confirms it.
    expect(b.o.status).toBe("awaiting_confirmation");
    await viaCart.tap(`order:confirm:${b.o.id}`, "تأكيد الطلب");
    expect((await db.one(`select status from orders where id = $1`, [b.o.id])).status).toBe("confirmed");
  }, 60_000);

  it("names an out-of-stock item and leaves it out before the card", async () => {
    const outbound = recordKapso();
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [ids.coffee]);
    const t = flow(db, []);
    const c = await pinned(db, t, BAAKLINE);
    await t.say(cart([{ sku: SKUS.water, qty: 3, price: await priceOf(SKUS.water) }, { sku: SKUS.coffee, qty: 1, price: await priceOf(SKUS.coffee) }]));
    await db.pg.query(`update stock_levels set on_hand = 500 where product_id = $1`, [ids.coffee]);
    expect(outbound).toHaveLength(2);
    const coffee = await db.one(`select name_ar, name_en from products where id = $1`, [ids.coffee]);
    expect(bodyOf(outbound[0]!)).toBe(CART_TEXT.removed([coffee.name_ar ?? coffee.name_en], 0));
    expect(bodyOf(outbound[1]!)).toContain("طلبك AK-");
    expect(bodyOf(outbound[1]!)).not.toContain(coffee.name_ar ?? coffee.name_en);
    const { items, o } = await lastOrder(c.party_id);
    expect(items.map((i) => i.product_id)).toEqual([ids.water]);
    expect(o.status).toBe("awaiting_confirmation");
  }, 60_000);

  it("with a stale price shows the database price on the card, and says so before it", async () => {
    const outbound = recordKapso();
    const t = flow(db, []);
    const c = await pinned(db, t, BAAKLINE);
    const real = await priceOf(SKUS.water);
    await t.say(cart([{ sku: SKUS.water, qty: 3, price: real - 0.5 }]));
    expect(outbound).toHaveLength(2);
    expect(bodyOf(outbound[0]!)).toContain(`$${real.toFixed(2)}`);
    expect(bodyOf(outbound[0]!)).toContain("تغيّر السعر");
    expect(bodyOf(outbound[1]!)).toContain(`$${(3 * real).toFixed(2)}`);              // three at the database price
    expect(bodyOf(outbound[1]!)).not.toContain(`$${(3 * (real - 0.5)).toFixed(2)}`);
    const { items } = await lastOrder(c.party_id);
    expect(items[0]!.unit).toBeCloseTo(real, 2);
  }, 60_000);

  it("from a new customer waits on the pin, like a typed order, then the house, then the card", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read({ intent: "order", lines: [], fulfilment: "delivery", needs_clarification: [],
                                address: { ...READING.address, building: "بيت الاختبار", floor: "2", verbatim: "بيت الاختبار، طابق 2" } })]);
    await t.say(cart([{ sku: SKUS.water, qty: 3, price: await priceOf(SKUS.water) }], "حد الساحة"));
    expect(outbound[0]!.body.interactive.type).toBe("location_request_message");
    await t.say({ type: "location", location: { latitude: 33.67739, longitude: 35.56355 } });
    expect(bodyOf(outbound.at(-1)!)).toContain("كرمال السائق");
    await t.text("بيت الاختبار، طابق 2");
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");
    const c = await t.customer();
    const { o, items } = await lastOrder(c.party_id);
    expect(items).toEqual([{ product_id: ids.water, qty: 3, unit: await priceOf(SKUS.water) }]);
    expect(o.customer_notes).toContain("حد الساحة");                     // the words sent with the cart travel to the rider
  }, 60_000);

  it("refuses a cart from another catalog, and an unknown item is said to be gone", async () => {
    let outbound = recordKapso();
    const t = flow(db, []);
    await pinned(db, t, BAAKLINE);
    await t.say({ type: "order", order: { catalog_id: "999", product_items: [{ product_retailer_id: SKUS.water, quantity: 1, item_price: 1, currency: "USD" }] } });
    expect(bodyOf(outbound[0]!)).toBe(CART_TEXT.wrongCatalog);
    outbound = recordKapso();
    await t.say(cart([{ sku: "AK-9999", qty: 1 }]));
    expect(bodyOf(outbound[0]!)).toBe(`${CART_TEXT.removed([], 1)}\n${CART_TEXT.nothing}`);
  }, 60_000);
});
