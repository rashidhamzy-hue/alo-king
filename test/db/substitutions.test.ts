// Build plan 2.2: missing item and substitution. The customer taps keep or remove with the price difference shown; no answer
// means remove; the total is recalculated before the order is ready. Never substituted silently.
// Includes the Phase 2 acceptance test: a pick with one missing item, one accepted substitute and one refund leaves stock,
// the order total, the rider's cash due and the ledger consistent.
import { beforeAll, describe, expect, it } from "vitest";
import { handleSubstitutionButton } from "../../apps/gateway/src/ops-turn";
import { balance, collect, deliverToDoor, expectBooksBalanced, openHub, placeOrder, status, stock, total, type Hub, type Placed } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>; let WATER: string; let COFFEE: string; let BREAD: string; let CARDAMOM: string; let STAR: string;
let taps = 0;
const customerTap = (o: Placed, id: string) => handleSubstitutionButton({ ...line.deps, turnKey: `customer:wamid.c${++taps}` }, o.customer, id, `wamid.c${taps}`);
const itemOf = async (orderId: string, product: string, st = "ok") => (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2 and status = $3`, [orderId, product, st])).id;
const nOf = async (orderId: string, product: string) => (await h.db.rpc("pick_list", { p_order: orderId })).lines.find((l: any) => l.product_id === product).n;

beforeAll(async () => {
  h = await openHub();
  line = opsLine(h);
  await h.db.pg.exec(`update settings set value = value || '{"offer_substitutes": true}' where key = 'picking'`);
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  BREAD = await h.product("Al Forno Pita White Bread Big 800G");
  CARDAMOM = await h.product("Najjar Cafe Cardamom 180G");
  STAR = await h.product("Najjar Star Café Coffee Regular 180G");
}, 120_000);

describe("acceptance: one missing item, one accepted substitute, one refund (Phase 2)", () => {
  let o: Placed; let before: Record<string, { onHand: number; reserved: number }>;
  beforeAll(async () => {
    before = { WATER: await stock(h, WATER), COFFEE: await stock(h, COFFEE), BREAD: await stock(h, BREAD), CARDAMOM: await stock(h, CARDAMOM) };
    o = await placeOrder(h, [{ product_id: WATER, qty: 2 }, { product_id: COFFEE, qty: 1 }, { product_id: BREAD, qty: 2 }]);
    await line.tap(PHONES.picker, `pick:start:${o.orderId}`);
  });

  it("coffee is missing: the picker is offered substitutes of the same kind, in stock, nearest in price, and a remove option", async () => {
    await line.text(PHONES.picker, `ناقص ${await nOf(o.orderId, COFFEE)}`);
    const rows = line.to(h.picker).at(-1)!.rows;
    const missing = await itemOf(o.orderId, COFFEE, "missing");
    expect(rows[0]).toBe(`sub:offer:${missing}:${CARDAMOM}`);
    expect(rows).toContain(`sub:offer:${missing}:${STAR}`);
    expect(rows.at(-1)).toBe(`pick:remove:${missing}`);
    expect(await total(h, o.orderId)).toBeCloseTo(2 * 2.01 + 3.25 + 2 * 1.01 + Number((await h.db.one(`select delivery_fee_usd from orders where id = $1`, [o.orderId])).delivery_fee_usd), 2);
  });

  it("the picker offers cardamom: it is reserved at once and the customer sees both prices and the difference", async () => {
    const missing = await itemOf(o.orderId, COFFEE, "missing");
    await line.pickRow(PHONES.picker, `sub:offer:${missing}:${CARDAMOM}`);
    expect((await stock(h, CARDAMOM)).reserved).toBe(before.CARDAMOM!.reserved + 1);
    const q = line.to(o.customer).at(-1)!;
    expect(q.line).toBe("customer");
    expect(q.body).toContain("$3.25"); expect(q.body).toContain("$3.49"); expect(q.body).toContain("أغلى بـ:\n$0.24");
    expect(q.buttons[0]).toMatch(/^sub:keep:/); expect(q.buttons[1]).toMatch(/^sub:remove:/);
    // the order cannot be finished while the customer decides
    await line.tap(PHONES.picker, `pick:done:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("preparing");
    expect(line.to(h.picker).map((m) => m.body).join("|")).toContain("ناطرين الزبون");
  });

  it("the customer taps keep: a new line at the price shown, the old one marked substituted, the total recalculated, the picker told", async () => {
    const keep = line.to(o.customer).at(-1)!.buttons[0]!;
    expect(await customerTap(o, keep)).toBe(true);
    const sub = await h.db.one(`select qty, unit_price_usd, substitution_of from order_items where order_id = $1 and product_id = $2`, [o.orderId, CARDAMOM]);
    expect(Number(sub.unit_price_usd)).toBe(3.49);
    expect(sub.substitution_of).toBe(await itemOf(o.orderId, COFFEE, "substituted"));
    expect(line.to(o.customer).at(-1)!.body).toContain("حطّينا البديل");
    expect(line.to(h.picker).at(-1)!.body).toContain("قبل");
    // a second tap changes nothing
    await customerTap(o, keep);
    expect((await h.db.all(`select 1 from order_items where order_id = $1 and product_id = $2`, [o.orderId, CARDAMOM])).length).toBe(1);
  });

  it("bread is missing too and the picker takes it off; then picked: ready, and the customer hears both changes", async () => {
    await line.text(PHONES.picker, `ناقص ${await nOf(o.orderId, BREAD)}`);
    const missing = await itemOf(o.orderId, BREAD, "missing");
    await line.pickRow(PHONES.picker, `pick:remove:${missing}`);
    await line.tap(PHONES.picker, `pick:done:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("ready");
    const told = line.to(o.customer).at(-1)!.body;
    expect(told).toContain("ما لقينا"); expect(told).toContain("بدل");
    const fee = Number((await h.db.one(`select delivery_fee_usd from orders where id = $1`, [o.orderId])).delivery_fee_usd);
    expect(await total(h, o.orderId)).toBeCloseTo(2 * 2.01 + 3.49 + fee, 2);
  });

  it("the rider collects the recalculated total; after delivery a damaged pack is refunded; stock, cash and the ledger agree", async () => {
    const due = await total(h, o.orderId);
    const delivery = await deliverToDoor(h, o.orderId);
    const job = await h.db.rpc("rider_job", { p_delivery: delivery });
    expect(Number(job.collect_usd)).toBeCloseTo(due, 2);                   // the rider's cash due is the new total
    await collect(h, o.orderId);
    expect(await status(h, o.orderId)).toBe("closed");
    expect(Number(await h.db.rpc("driver_cash_usd", { p_driver: h.riders[0] }))).toBeCloseTo(due, 2);

    await h.db.rpc("refund_order", { p_order: o.orderId, p_by: h.ops, p_amount_usd: 2.01, p_charged_to: "goods", p_reason: "damaged", p_settle: "credit" });
    expect(Number(await h.db.rpc("customer_credit_usd", { p_party: o.customer }))).toBeCloseTo(2.01, 2);

    // stock: what left the shelf is exactly what was delivered; nothing is left reserved
    expect(await stock(h, WATER)).toEqual({ onHand: before.WATER!.onHand - 2, reserved: before.WATER!.reserved });
    expect(await stock(h, CARDAMOM)).toEqual({ onHand: before.CARDAMOM!.onHand - 1, reserved: before.CARDAMOM!.reserved });
    // coffee and bread were not on the shelf: written off as missing at pick, never sold
    expect(await stock(h, COFFEE)).toEqual({ onHand: before.COFFEE!.onHand - 1, reserved: before.COFFEE!.reserved });
    expect(await stock(h, BREAD)).toEqual({ onHand: before.BREAD!.onHand - 2, reserved: before.BREAD!.reserved });
    // money: goods revenue is the delivered goods less the refund
    expect(Number(await h.db.rpc("order_revenue_usd", { p_order: o.orderId, p_code: "revenue_goods" }))).toBeCloseTo(2 * 2.01 + 3.49 - 2.01, 2);
    expect(Number((await h.db.one(`select amount_usd from payments where order_id = $1`, [o.orderId])).amount_usd)).toBeCloseTo(due, 2);
    await expectBooksBalanced(h);
  });
});

describe("no answer, late answers, restrictions, prepaid, someone else's order (2.2)", () => {
  const startMissing = async (o: Placed, product: string) => {
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: h.picker });
    const r = await h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, product), p_by: h.picker });
    return r;
  };

  it("no answer means remove: an overdue offer is taken off when the picker finishes and the substitute goes back", async () => {
    const o = await placeOrder(h, [{ product_id: WATER, qty: 1 }, { product_id: COFFEE, qty: 1 }]);
    const r = await startMissing(o, COFFEE);
    expect(r.decision).toBe("pending");
    const reserved = (await stock(h, STAR)).reserved;
    const offer = await h.db.rpc("pick_offer_substitute", { p_missing: r.missing_item, p_product: STAR, p_by: h.picker });
    expect((await stock(h, STAR)).reserved).toBe(reserved + 1);
    await h.db.pg.query(`update substitution_offers set expires_at = now() - interval '1 second' where id = $1`, [offer.offer_id]);
    const f = await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker });
    expect(f.status).toBe("ready");
    expect(f.changes.removed).toHaveLength(1);
    expect((await stock(h, STAR)).reserved).toBe(reserved);
    expect((await h.db.one(`select status from substitution_offers where id = $1`, [offer.offer_id])).status).toBe("expired");
    // the customer taps keep after the deadline: nothing changes, and they are told so
    await customerTap(o, `sub:keep:${offer.offer_id}`);
    expect(line.to(o.customer).at(-1)!.body).toContain("خلص وقت");
    expect(await h.db.all(`select 1 from order_items where order_id = $1 and product_id = $2`, [o.orderId, STAR])).toEqual([]);
  });

  it("a customer with a stated restriction is offered no substitute: unknown is never safe", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    await h.db.pg.query(`update orders set customer_notes = '⚠️ قيود الزبون (لازم يتأكّد قبل التحضير): بلا سكر' where id = $1`, [o.orderId]);
    const r = await startMissing(o, COFFEE);
    expect(r).toMatchObject({ decision: "removed", blocked: "customer_restrictions" });
    await expect(h.db.rpc("pick_offer_substitute", { p_missing: r.missing_item, p_product: STAR, p_by: h.picker })).rejects.toThrow(/LINE_NOT_MISSING/);
    await h.db.rpc("transition_order", { p_order: o.orderId, p_to: "cancelled", p_actor: "ops", p_actor_id: h.ops, p_reason: "nothing_in_stock" });
  });

  it("a paid prepaid order is offered nothing dearer, and a cheaper kept substitute is owed back as credit", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }], "whish");
    const r = await startMissing(o, COFFEE);
    expect(r.candidates.map((c: any) => c.product_id)).toEqual([STAR]);       // cardamom and instant cost more
    await expect(h.db.rpc("pick_offer_substitute", { p_missing: r.missing_item, p_product: CARDAMOM, p_by: h.picker })).rejects.toThrow(/NOT_A_CANDIDATE/);
    const offer = await h.db.rpc("pick_offer_substitute", { p_missing: r.missing_item, p_product: STAR, p_by: h.picker });
    expect(Number(offer.diff_usd)).toBeCloseTo(-0.52, 2);
    await customerTap(o, `sub:keep:${offer.offer_id}`);
    expect(Number(await h.db.rpc("customer_credit_usd", { p_party: o.customer }))).toBeCloseTo(0.52, 2);
    expect((await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: h.picker })).status).toBe("ready");
    await expectBooksBalanced(h);
  });

  it("only the order's customer can answer, and an order cancelled mid-question releases its stock once", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 1 }, { product_id: WATER, qty: 2 }]);
    const r = await startMissing(o, COFFEE);
    const offer = await h.db.rpc("pick_offer_substitute", { p_missing: r.missing_item, p_product: STAR, p_by: h.picker });
    const stranger = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await expect(h.db.rpc("answer_substitution", { p_offer: offer.offer_id, p_party: stranger.customer, p_keep: true })).rejects.toThrow(/NOT_YOUR_ORDER/);
    const star = await stock(h, STAR); const water = await stock(h, WATER);
    await h.db.rpc("transition_order", { p_order: o.orderId, p_to: "cancelled", p_actor: "ops", p_actor_id: h.ops, p_reason: "customer called" });
    expect((await stock(h, STAR)).reserved).toBe(star.reserved - 1);
    expect((await stock(h, WATER)).reserved).toBe(water.reserved - 2);
    await h.db.rpc("expire_substitution_offers", {});
    await h.db.pg.query(`update substitution_offers set expires_at = now() - interval '1 second' where id = $1`, [offer.offer_id]);
    expect(await h.db.rpc("expire_substitution_offers", {})).toBe(1);
    expect((await stock(h, STAR)).reserved).toBe(star.reserved - 1);     // not released a second time
    await expectBooksBalanced(h);
  });

  it("a tap that is not a substitution button is left for the rest of the customer turn", async () => {
    expect(await customerTap({ customer: h.ops } as Placed, "order:confirm:00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

void balance;
