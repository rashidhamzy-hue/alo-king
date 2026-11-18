// Session FD2 (ordering food from places, end to end), migration 0249, on the real migrations and the seeded test place
// (scripts/staging/test-place.sql, the invented kitchen staging and the simulated customers also use). docs/DECISIONS.md, "FD2, 18 November 2026".
//   1. Only a customer the place is visible to can see its menu, be quoted a dish or order it; anyone else is "not on Alo King yet".
//   2. A dish's price is the database's: its own plus the options chosen. A required choice not made holds the card.
//   3. One shop per order; a food card and a grocery card are two orders, side by side.
//   4. The place's hours (closed means not orderable, also at the confirm tap); the arrival estimate is preparation plus the ride.
//   5. The food service fee (0 today) is its own line and company income; food is cash on delivery.
// Invented people and numbers only.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let place: string; let baqaata: string; let baakline: string;
let tester: { party: string; conv: string }; let stranger: { party: string; conv: string };
let shawarma: string; let falafel: string; let taouk: string;
let seq = 0;

export async function seedTestPlace(t: TestDb): Promise<string> {
  await t.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  return (await t.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id as string;
}
const customer = async (phone: string, tested: boolean) => {
  seq++;
  const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`FD2 customer ${seq}`])).id as string;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'customer', $2, $3)`, [party, `wa-fd2-${seq}`, phone]);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id as string;
  await db.pg.query(`insert into consent_events(party_id, line, kind, action, source, wording) values ($1, 'customer', 'transactional', 'opt_in', 'test', 'fd2')`, [party]);
  if (tested) await db.rpc("set_tester", { p_by: lead, p_phone: phone, p_on: true });
  return { party, conv };
};
const dish = async (name: string) => (await db.one(`select id from products where owner_source_id = $1 and name_en = $2`, [place, name])).id as string;
const option = async (product: string, name: string) =>
  (await db.one(`select o.id from dish_options o join dish_option_groups g on g.id = o.group_id where g.product_id = $1 and o.name_en = $2`, [product, name])).id as string;
const codes = (q: any) => (q.issues as { code: string }[]).map((i) => i.code);
const quote = (lines: unknown[], party: string | null, village: string | null = baakline) =>
  db.rpc("quote_order", { p_lines: lines, p_village: village, p_pickup: false, p_slot: null, p_party: party });

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89500, now() - interval '1 day')`);
  await db.pg.query(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
  place = await seedTestPlace(db);
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  // open all day for the tests (the seed says 09:00 to 23:00)
  await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "00:00", close: "00:00" } } });
  baqaata = (await db.one(`select id from villages where name_en = 'Baqaata'`)).id;
  baakline = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.pg.query(`update stock_levels set on_hand = 50`);
  tester = await customer("+96170000301", true);
  stranger = await customer("+96170000302", false);
  shawarma = await dish("Chicken shawarma sandwich"); falafel = await dish("Falafel sandwich"); taouk = await dish("Taouk plate");
}, 180_000);

describe("the seeded test place", () => {
  it("is made through FD1's own path: testers only, approved, its listing hidden, idempotent", async () => {
    expect(await db.one(`select visibility, buys_for_customer, approved_at is not null as approved, commission_pct::float as c from sources where id = $1`, [place]))
      .toEqual({ visibility: "testers", buys_for_customer: true, approved: true, c: 0 });
    expect((await db.one(`select hidden_at is not null as h from listings where listing_id = 'ak-test-kitchen-staging'`)).h).toBe(true);
    expect(await seedTestPlace(db)).toBe(place);
    expect((await db.one(`select count(*)::int n from products where owner_source_id = $1`, [place])).n).toBe(4);
  });
});

describe("1 who may see and order", () => {
  it("a tester sees the menu with its option groups; a stranger is told it is not on Alo King", async () => {
    const m = await db.rpc("place_menu", { p_party: tester.party, p_source: place });
    expect(m.ok).toBe(true);
    expect(m.dishes.map((d: any) => d.name_en).sort()).toEqual(["Chicken shawarma sandwich", "Falafel sandwich", "French fries", "Taouk plate"]);
    const sh = m.dishes.find((d: any) => d.name_en === "Chicken shawarma sandwich");
    expect(sh.groups.map((g: any) => [g.name_en, g.required, g.min, g.max])).toEqual([["Size", true, 1, 1], ["Bread", true, 1, 1], ["Add-ons", false, 0, 2]]);
    expect(await db.rpc("place_menu", { p_party: stranger.party, p_source: place })).toEqual({ ok: false, reason: "not_on_alo_king", dishes: [] });
    expect(await db.rpc("place_menu", { p_party: null, p_source: place })).toMatchObject({ ok: false });
  });

  it("a place named in the words is found by name or alias, with whether this customer may order from it", async () => {
    expect(await db.rpc("food_places_named", { p_party: tester.party, p_text: "بدي من مطبخ التجربة شاورما" }))
      .toEqual([{ source_id: place, name: "Alo King test kitchen", score: 1, orderable: true }]);
    expect((await db.rpc("food_places_named", { p_party: stranger.party, p_text: "something from the test kitchen please" }))[0])
      .toMatchObject({ source_id: place, orderable: false });
    expect(await db.rpc("food_places_named", { p_party: tester.party, p_text: "بدي خبز وحليب" })).toEqual([]);
  });

  it("the quote: a dish is coming_soon for a stranger and for no party; orderable for the tester", async () => {
    const line = [{ product_id: falafel, qty: 2 }];
    expect(codes(await quote(line, stranger.party))).toContain("coming_soon");
    expect(codes(await quote(line, null))).toContain("coming_soon");
    const q = await quote(line, tester.party);
    expect(codes(q)).not.toContain("coming_soon");
    expect(q.subtotal_usd).toBe(5);
    expect(q.shop).toMatchObject({ source_id: place, name: "Alo King test kitchen", kind: "place", prep_minutes: 20 });
    expect(q.food).toBe(true);
  });

  it("a stranger cannot make the order either", async () => {
    const r = await db.rpc("create_order_from_quote", { p_customer: stranger.party, p_conversation: stranger.conv, p_lines: [{ product_id: falafel, qty: 2 }],
      p_village: baakline, p_place: null, p_pickup: false });
    expect(r.created).toBe(false);
    expect(codes(r.quote)).toContain("coming_soon");
  });
});

describe("2 a dish's choices and price", () => {
  it("food_match finds the dish by its name on that place's menu, with the options the words named", async () => {
    const r = await db.rpc("food_match", { p_party: tester.party, p_source: place, p_lines: [
      { raw: "سندويش شاورما دجاج كبير صاج", query: "شاورما دجاج", qty: 2 },
      { raw: "falafel", query: "falafel sandwich", qty: 1 },
      { raw: "pizza", query: "pizza", qty: 1 }] });
    expect(r.lines[0]).toMatchObject({ status: "matched", qty: 2, chosen: { product_id: shawarma } });
    expect(new Set(r.lines[0].options)).toEqual(new Set([await option(shawarma, "Large"), await option(shawarma, "Saj")]));
    expect(r.lines[1]).toMatchObject({ status: "matched", chosen: { product_id: falafel } });
    expect(r.lines[2]).toMatchObject({ status: "not_found", chosen: null });
    expect(await db.rpc("food_match", { p_party: stranger.party, p_source: place, p_lines: [{ raw: "falafel", query: "falafel", qty: 1 }] }))
      .toMatchObject({ ok: false, reason: "not_on_alo_king" });
  });

  it("a required choice not made holds the card, and says which group with its options", async () => {
    const q = await quote([{ product_id: shawarma, qty: 1 }], tester.party);
    expect(q.ok).toBe(false);
    const need = q.issues.find((i: any) => i.code === "choice_required");
    expect(need.groups.map((g: any) => g.name_en)).toEqual(["Size", "Bread"]);
    expect(need.groups[0].options.map((o: any) => [o.name_en, Number(o.price_delta_usd)])).toEqual([["Regular", 0], ["Large", 2]]);
  });

  it("the price is the dish's plus the options', from the database; an unknown option is refused", async () => {
    const opts = [await option(shawarma, "Large"), await option(shawarma, "Saj"), await option(shawarma, "Extra garlic")];
    const q = await quote([{ product_id: shawarma, qty: 2, options: opts }], tester.party);
    expect(codes(q).filter((c) => !["closed"].includes(c))).toEqual([]);
    expect(q.lines[0]).toMatchObject({ unit_price_usd: 7, line_total_usd: 14, base_price_usd: 4 });
    expect(q.lines[0].options.map((o: any) => o.name_en)).toEqual(["Large", "Saj", "Extra garlic"]);
    expect(q.subtotal_usd).toBe(14);
    expect(codes(await quote([{ product_id: shawarma, qty: 1, options: [...opts, await option(taouk, "Garlic")] }], tester.party))).toContain("option_invalid");
    expect(codes(await quote([{ product_id: shawarma, qty: 1, options: [await option(shawarma, "Large"), await option(shawarma, "Regular"), await option(shawarma, "Saj")] }], tester.party)))
      .toContain("option_invalid");
  });
});

describe("3 one shop per order", () => {
  it("a basket from two shops is mixed_shops: no card", async () => {
    const hub = (await db.one(`select p.id from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id where s.kind = 'dark_store' and o.price_usd > 3 order by p.sku limit 1`)).id;
    const q = await quote([{ product_id: falafel, qty: 2 }, { product_id: hub, qty: 1 }], tester.party);
    const mixed = q.issues.find((i: any) => i.code === "mixed_shops");
    expect(mixed.shops.map((s: any) => s.kind)).toEqual(["hub", "place"]);
    const r = await db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv,
      p_lines: [{ product_id: falafel, qty: 2 }, { product_id: hub, qty: 1 }], p_village: baakline, p_place: null, p_pickup: false });
    expect(r.created).toBe(false);
  });

  it("a food card and a grocery card wait side by side; a new food card replaces only the food card", async () => {
    const hub = (await db.one(`select p.id from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id where s.kind = 'dark_store' and o.price_usd > 5 order by p.sku limit 1`)).id;
    const make = (lines: unknown[]) => db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv, p_lines: lines,
      p_village: baakline, p_place: null, p_pickup: false });
    const groceries = await make([{ product_id: hub, qty: 1 }]);
    const food = await make([{ product_id: falafel, qty: 2 }]);
    expect([groceries.created, food.created]).toEqual([true, true]);
    const status = async (id: string) => (await db.one(`select status::text s from orders where id = $1`, [id])).s;
    expect(await status(groceries.order_id)).toBe("awaiting_confirmation");
    const food2 = await make([{ product_id: falafel, qty: 3 }]);
    expect(await status(food.order_id)).toBe("cancelled");
    expect(await status(groceries.order_id)).toBe("awaiting_confirmation");
    expect(await status(food2.order_id)).toBe("awaiting_confirmation");
    await db.pg.query(`update orders set status = 'cancelled' where conversation_id = $1 and status = 'awaiting_confirmation'`, [tester.conv]);
  });

  it("food is cash on delivery", async () => {
    const r = await db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv, p_lines: [{ product_id: falafel, qty: 2 }],
      p_village: baakline, p_place: null, p_pickup: false, p_payment: "whish" });
    expect(r.created).toBe(false);
    expect(codes(r.quote)).toContain("food_cash_only");
  });
});

describe("4 hours and the arrival estimate", () => {
  it("closed means not orderable: outside its hours, a day off, or found closed today", async () => {
    const line = [{ product_id: falafel, qty: 2 }];
    const now = (await db.one(`select to_char(now() at time zone 'Asia/Beirut', 'HH24:MI') t, lower(to_char(now() at time zone 'Asia/Beirut', 'dy')) d`));
    const later = (await db.one(`select to_char((now() at time zone 'Asia/Beirut') + interval '2 hours', 'HH24:MI') a, to_char((now() at time zone 'Asia/Beirut') + interval '3 hours', 'HH24:MI') b`));
    await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: later.a, close: later.b } } });
    expect((await quote(line, tester.party)).issues.find((i: any) => i.code === "place_closed")).toMatchObject({ reason: "hours", opens: later.a });
    await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "00:00", close: "00:00", days_off: [now.d] } } });
    expect((await quote(line, tester.party)).issues.find((i: any) => i.code === "place_closed")).toMatchObject({ reason: "day_off" });
    await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "00:00", close: "00:00" } } });
    await db.pg.query(`update sources set closed_on = (now() at time zone 'Asia/Beirut')::date where id = $1`, [place]);
    expect((await quote(line, tester.party)).issues.find((i: any) => i.code === "place_closed")).toMatchObject({ reason: "closed_today" });
    await db.pg.query(`update sources set closed_on = null where id = $1`, [place]);
    expect(codes(await quote(line, tester.party))).not.toContain("place_closed");
  });

  it("the estimate is the place's preparation time plus the ride from its village to the customer's", async () => {
    const ride = Number((await db.one(`select travel_minutes($1, $2) m`, [baqaata, baakline])).m);
    expect((await quote([{ product_id: falafel, qty: 2 }], tester.party)).eta_minutes).toBe(20 + Math.round(ride));
    expect((await quote([{ product_id: falafel, qty: 2 }], tester.party, baqaata)).eta_minutes).toBe(20);
  });

  it("the confirm tap re-checks with the customer's own access, the options' prices and the place's hours", async () => {
    const opts = [await option(taouk, "Spicy")];
    const pin = await db.rpc("save_customer_pin", { p_party: tester.party, p_lat: 33.67739, p_lng: 35.56355, p_village: baakline });
    await db.rpc("set_contact_phone", { p_party: tester.party, p_phone: "+96170000301" }).catch(() => undefined);
    const r = await db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv, p_lines: [{ product_id: taouk, qty: 1, options: opts }],
      p_village: baakline, p_place: pin.place_id, p_pickup: false });
    expect(r.created).toBe(true);
    expect(await db.rpc("order_quote_issues", { p_order: r.order_id })).toEqual([]);
    const item = await db.one(`select unit_price_usd::float u, options from order_items where order_id = $1`, [r.order_id]);
    expect(item.u).toBe(8);
    expect(item.options.map((o: any) => o.name_en)).toEqual(["Spicy"]);
    await db.pg.query(`update sources set closed_on = (now() at time zone 'Asia/Beirut')::date where id = $1`, [place]);
    expect((await db.rpc("order_quote_issues", { p_order: r.order_id }))[0]).toMatchObject({ issue: "source_closed" });
    await db.pg.query(`update sources set closed_on = null where id = $1`, [place]);
    const c = await db.rpc("confirm_order_checked", { p_order: r.order_id, p_party: tester.party, p_wamid: "wamid.fd2.1" });
    expect(c.status).toBe("confirmed");
    const card = await db.rpc("order_card", { p_order: r.order_id, p_party: tester.party });
    expect(card.quote.shop).toMatchObject({ name: "Alo King test kitchen", kind: "place" });
    expect(card.quote.food).toBe(true);
    expect(card.quote.lines[0].options[0].name_ar).toBe("حار");
  });
});

describe("5 the food service fee and the ledger", () => {
  it("is 0 by default; set, it is its own line, in the total, and company income when the cash is collected", async () => {
    expect((await quote([{ product_id: falafel, qty: 2 }], tester.party)).service_fee_usd).toBe(0);
    await db.pg.query(`update settings set value = '{"service_fee_usd": 0.5}' where key = 'food'`);
    const q = await quote([{ product_id: falafel, qty: 2 }], tester.party);
    expect([q.subtotal_usd, q.service_fee_usd, q.total_usd]).toEqual([5, 0.5, 5 + 0.5 + Number(q.delivery_fee_usd)]);
    expect((await quote([{ product_id: (await db.one(`select p.id from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id where s.kind = 'dark_store' and o.price_usd > 6 limit 1`)).id, qty: 1 }], tester.party)).service_fee_usd).toBe(0);
    const r = await db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv, p_lines: [{ product_id: falafel, qty: 2 }],
      p_village: baakline, p_place: null, p_pickup: false });
    const o = await db.one(`select total_usd::float t, service_fee_usd::float s, delivery_fee_usd::float d from orders where id = $1`, [r.order_id]);
    expect(o.t).toBe(5 + 0.5 + o.d);
    const rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'FD2 rider') returning id`)).id;
    await db.rpc("post_cod_collection", { p_order: r.order_id, p_driver: rider, p_usd: o.t, p_lbp: 0 });
    const by = async (code: string) => Number((await db.one(`select coalesce(sum(e.usd_equiv), 0) s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = $1 and e.order_id = $2`, [code, r.order_id])).s);
    expect(await by("revenue_food_service")).toBe(-0.5);
    expect(await by(`merchant_payable:${place}`)).toBe(-5);
    expect(await by("revenue_delivery")).toBe(-o.d);
    expect(await by("cash_over_short")).toBe(0);
    expect(Number((await db.one(`select sum(usd_equiv) s from ledger_entries where order_id = $1`, [r.order_id])).s)).toBe(0);
    await db.pg.query(`update settings set value = '{"service_fee_usd": 0}' where key = 'food'`);
  });
});
