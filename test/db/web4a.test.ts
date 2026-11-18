// Session WEB4a (the website looks like the reference, stage 1), migration 0243, on the real migrations. Every call runs as the database role
// web_channel, as the Worker does. What this proves:
//   * the home page's rails are the catalogue's own cards, per category, in aisle order with what is in stock first (no score, no ranking);
//   * "most ordered" does not exist before the shop has 30 days of orders, and once it has, it counts orders of the last 30 days;
//   * the "Ask Alo King" strip is off unless settings.web.ask_alo_king is true;
//   * "Use my location" turns a position into a village (or the nearby served villages, or "outside") and stores nothing.
import { beforeAll, describe, expect, it } from "vitest";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { webCatalog, type RpcSource } from "@ak/commerce/index";

let db: TestDb; let cat: ReturnType<typeof webCatalog>;

function asWebChannel(t: TestDb): RpcSource {
  const inner = asSupabase(t);
  return { rpc: async (fn: string, args: Record<string, unknown>) => {
    await t.pg.exec("set role web_channel");
    try { return await inner.rpc(fn, args); } finally { await t.pg.exec("reset role"); }
  } };
}

beforeAll(async () => {
  db = await openTestDb();
  cat = webCatalog(asWebChannel(db));
  await db.pg.exec(`update stock_levels set on_hand = 10, reserved = 0`);
}, 120_000);

describe("web_home_extras: the home page's rails", () => {
  it("one rail per category with items, the category's own cards in aisle order, at most p_per, in stock first", async () => {
    const x = await cat.homeExtras(5);
    const home = await cat.home();
    expect(x.rails.map((r) => r.code)).toEqual(home.categories.map((c) => c.code));
    for (const r of x.rails) {
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.length).toBeLessThanOrEqual(5);
      const page = await cat.category(r.code);
      if (!page.ok) throw new Error(r.code);
      const order = page.sections.flatMap((s) => s.items.map((i) => i.sku));
      const idx = r.items.map((i) => order.indexOf(i.sku));
      expect(idx.every((i) => i >= 0)).toBe(true);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);          // all in stock here: the aisle's own order
      for (const card of r.items) expect(Object.keys(card)).toEqual(expect.arrayContaining(["sku", "name_en", "price_usd", "in_stock", "picture"]));
    }
  });

  it("an item out of stock goes after the ones in stock", async () => {
    const small = (await cat.home()).categories.filter((c) => c.count >= 3 && c.count <= 20)[0]!;   // a rail of 20 holds the whole category
    const first = (await cat.homeExtras(3)).rails.find((r) => r.code === small.code)!.items[0]!;
    await db.pg.query(`update stock_levels set on_hand = 0 where product_id = (select id from products where sku = $1)`, [first.sku]);
    try {
      const items = (await cat.homeExtras(20)).rails.find((r) => r.code === small.code)!.items;
      const at = items.findIndex((i) => i.sku === first.sku);
      expect(items[at]!.in_stock).toBe(false);
      expect(items.slice(at + 1).every((i) => !i.in_stock)).toBe(true);
    } finally { await db.pg.query(`update stock_levels set on_hand = 10 where product_id = (select id from products where sku = $1)`, [first.sku]); }
  });

  it("no 'most ordered' before the shop has 30 days of orders; after, it counts the last 30 days' orders", async () => {
    expect((await cat.homeExtras()).most_ordered).toBeNull();
    const party = (await db.one(`insert into parties(role, display_name) values ('customer', 'W4a') returning id`)).id;
    const src = (await db.one(`select id from sources where kind = 'dark_store' limit 1`)).id;
    const order = async (code: string, daysAgo: number, skus: string[]) => {
      const o = (await db.one(`insert into orders(short_code, customer_id, status, created_at, confirmed_at)
                               values ($1, $2, 'awaiting_confirmation', now() - make_interval(days => $3), now() - make_interval(days => $3)) returning id`, [code, party, daysAgo])).id;
      const f = (await db.one(`insert into fulfilments(order_id, source_id) values ($1, $2) returning id`, [o, src])).id;
      for (const s of skus) await db.pg.query(`insert into order_items(order_id, fulfilment_id, product_id, name_snapshot, qty, unit_price_usd)
                                               select $1, $2, id, name_en, 1, 1 from products where sku = $3`, [o, f, s]);
    };
    const [a, b] = (await cat.homeExtras(2)).rails[0]!.items.map((i) => i.sku);
    await order("AK-W4A1", 10, [a!, b!]);
    await order("AK-W4A2", 5, [b!]);
    expect((await cat.homeExtras()).most_ordered).toBeNull();          // 10 days of orders: not yet
    await order("AK-W4A3", 31, [a!]);                                  // the first order is now 31 days old
    const most = (await cat.homeExtras()).most_ordered!;
    expect(most.map((m) => m.sku).slice(0, 2)).toEqual([b, a]);       // b: two orders in the last 30 days; a: one (the 31-day-old one does not count)
  });

  it("the Ask Alo King strip is off unless the setting turns it on", async () => {
    expect((await cat.homeExtras()).ask).toBe(false);
    await db.pg.exec(`update settings set value = value || '{"ask_alo_king": true}' where key = 'web'`);
    try { expect((await cat.homeExtras()).ask).toBe(true); }
    finally { await db.pg.exec(`update settings set value = value - 'ask_alo_king' where key = 'web'`); }
  });
});

describe("web_locate_village: 'Use my location' keeps the village only", () => {
  it("a position at a served village's centre is that village, with its fee and time; nothing is stored", async () => {
    const v = await db.one<any>(`select vi.id, vi.name_en, vi.lat, vi.lng, z.delivery_fee_usd, z.base_eta_minutes from villages vi join zones z on z.id = vi.zone_id
                                  where vi.is_served and z.is_active and vi.lat is not null order by vi.name_en limit 1`);
    const before = await db.one<any>(`select (select count(*) from customer_places) as places, (select count(*) from web_sessions) as sessions`);
    const r = await cat.locateVillage(v.lat, v.lng);
    if (!r.ok) throw new Error("not ok");
    if (r.status === "located") {
      expect(r.village!.village_id).toBe(v.id);
      expect(r.village!.served).toBe(true);
      expect(Number(r.village!.fee_usd)).toBe(Number(v.delivery_fee_usd));
      expect(r.village!.eta_minutes).toBe(v.base_eta_minutes);
    } else {
      expect(r.status).toBe("unsure");                                // two village centres too close together to tell: the served ones to tap
      expect(r.choices.map((c) => c.village_id)).toContain(v.id);
    }
    expect(JSON.stringify(r)).not.toMatch(/"km"|"lat"|"lng"/);
    const after = await db.one<any>(`select (select count(*) from customer_places) as places, (select count(*) from web_sessions) as sessions`);
    expect(after).toEqual(before);
  });

  it("far away is outside, with no village; a bad position is refused", async () => {
    const r = await cat.locateVillage(48.85, 2.35);
    expect(r).toMatchObject({ ok: true, status: "outside", village: null, choices: [] });
    expect(await cat.locateVillage(200, 0)).toEqual({ ok: false, error: "bad_position" });
  });
});

// Stage 2 (0244): what a price is for. The founder's test: an item sold by weight says "per pack of about X g" or "per kg", never nothing.
describe("catalog_price_for: what a price is for, on the card, the product page and the basket", () => {
  const card = async (sku: string) => {
    const r = await cat.homeExtras(20);
    for (const rail of r.rails) { const c = rail.items.find((i) => i.sku === sku); if (c) return c; }
    const s = await cat.search(sku, 30); return s.matches.find((i) => i.sku === sku) ?? null;
  };
  it("a piece has none; a '500 g pack' is a pack of about 500 g; a name that says /Kg is per kg; a pack with no weight on file says so (null)", async () => {
    const p = await cat.product("AK-0046"); if (!p.ok) throw new Error("AK-0046");
    expect(p.product.price_for).toBeNull();                                                // Liban Lait Labneh 450G: one item
    const kafta = await cat.product("AK-0028"); if (!kafta.ok) throw new Error("AK-0028");
    expect(kafta.product.price_for).toEqual({ per: "pack", about_g: 500 });                // "500 g pack"
    const halloum = await cat.product("AK-0044"); if (!halloum.ok) throw new Error("AK-0044");
    expect(halloum.product.price_for).toEqual({ per: "kg", about_g: null });               // "Halloum /Kg"
    const labneh = await cat.product("AK-0042"); if (!labneh.ok) throw new Error("AK-0042");
    expect(labneh.product.price_for).toEqual({ per: "pack", about_g: null });              // by weight, no weight on file: never a guess
  });
  it("an approved pack weight is used; a proposed one is not", async () => {
    const id = (await db.one(`select id from products where sku = 'AK-0042'`)).id;
    // a packaged food's template has a size field (not a weight per pack): "350 g" printed on the pack
    await db.pg.query(`insert into product_field_values(product_id, field_key, value, source, status) values ($1, 'size', '"350 g"', 'label_photo', 'proposed')`, [id]);
    let p = await cat.product("AK-0042"); if (!p.ok) throw new Error("AK-0042");
    expect(p.product.price_for).toEqual({ per: "pack", about_g: null });
    await db.pg.query(`update product_field_values set status = 'approved', approved_at = now() where product_id = $1 and field_key = 'size'`, [id]);
    p = await cat.product("AK-0042"); if (!p.ok) throw new Error("AK-0042");
    expect(p.product.price_for).toEqual({ per: "pack", about_g: 350 });
    await db.pg.query(`delete from product_field_values where product_id = $1 and field_key = 'size'`, [id]);
  });
  it("cards carry it with their aisle; the basket's read gives it by sku, only for items the site shows, as web_channel", async () => {
    const c = await card("AK-0042");
    expect(c?.price_for).toEqual({ per: "pack", about_g: null });
    expect(c?.category_code).toBe("dairy_eggs");
    expect(await cat.priceFor(["AK-0042", "AK-0046", "AK-0044", "NOPE"])).toEqual({ "AK-0042": { per: "pack", about_g: null }, "AK-0044": { per: "kg", about_g: null } });
  });
});
