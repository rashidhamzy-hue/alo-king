// Session CX1 (customer pack), through the real turn code, gateway and schema with a scripted model: the first-ever welcome, the
// confirmation with the card's two choices, "cancel my order" in words and by tap before and after picking starts, the handover
// code with a prepaid confirmation, and pickup at the hub said in words. docs/strategy/02-journeys.md section 1; 03 section B.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@ak/agents/messages";
import { cancelWords, pickupWords } from "@ak/agents/customer-pack";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";

let db: TestDb, ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const line = (raw: string, query: string, qty = 1) => ({ raw, query, qty, unit: "each", modifiers: [], brand_hint: null, source_hint: null, confidence: 0.9 });
const LABNEH = line("لبنة ليبان ليه 900 غ", "Liban Lait Labneh Baladieh 900G", 2);
const order = (lines: unknown[]) => ({ intent: "order", fulfilment: "delivery", lines,
  address: { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null } });
const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const buttonsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply);
const rowsOf = (s: Sent): { id: string; title: string }[] => (s.body.interactive?.action?.sections ?? []).flatMap((x: any) => x.rows);
const isCard = (s: Sent) => buttonsOf(s).some((b) => b.id.startsWith("order:confirm:"));
const all = () => outbound.map(bodyOf).join("\n---\n");

/** A pinned customer with a card waiting for the tap. */
async function withCard() {
  const t = flow(db, [read(order([LABNEH]))]);
  const c = await pinned(db, t, ids.BAAKLINE);
  await t.text("بدي 2 لبنة ليبان ليه");
  expect(outbound.find(isCard), all()).toBeTruthy();
  const o = await db.one(`select id, short_code from orders where customer_id = $1 order by created_at desc limit 1`, [c.party_id]);
  return { t, c, orderId: o.id as string, code: o.short_code as string };
}

describe("the words code reads", () => {
  it.each(["بدي الغي الطلب", "الغيلي طلبي لو سمحت", "ما عاد بدي الطلب", "baddi 2alghi el talab", "cancel my order", "I want to cancel", "annuler ma commande"])(
    "cancel: %s", (s) => { expect(cancelWords(s)).toBe(true); });
  it.each(["الغي الخبز", "cancel the bread", "بدي لبنة", "شو صار بطلبي"])("not cancel: %s", (s) => { expect(cancelWords(s)).toBe(false); });
  it.each(["بمرق باخدو", "باخدو من عندكن", "I'll pick it up", "pickup", "je passe le prendre", "bmor bekhdo"])("pickup: %s", (s) => { expect(pickupWords(s)).toBe(true); });
  it.each(["بدي توصيل لبعقلين", "deliver it please", "pick some bread"])("not pickup: %s", (s) => { expect(pickupWords(s)).toBe(false); });
});

describe("the first-ever welcome", () => {
  beforeAll(async () => { await db.pg.exec(`update settings set value = '{"enabled": true}' where key = 'welcome'`); });
  afterAll(async () => { await db.pg.exec(`update settings set value = '{"enabled": false}' where key = 'welcome'`); });

  it("a first hello: the welcome with three buttons and the privacy line, and no model call; never again", async () => {
    const t = flow(db, []);
    await t.text("مرحبا");
    expect(outbound).toHaveLength(1);
    expect(bodyOf(outbound[0]!)).toContain(ar.cx.privacy);
    expect(buttonsOf(outbound[0]!).map((b) => b.id)).toEqual(["welcome:order", "menu:browse", "welcome:area"]);
    expect(t.seen).toHaveLength(0);
    const c = await t.customer();
    expect((await db.one(`select privacy_wording from customer_welcomes where party_id = $1`, [c.party_id])).privacy_wording).toBe(ar.cx.privacy);
    await t.tap("welcome:order", ar.cx.orderButton);
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.cx.orderAsk);
    await t.tap("welcome:area", ar.cx.areaButton);
    expect(outbound.at(-1)!.body.interactive?.type).toBe("location_request_message");
    const n = outbound.length;
    await t.text("مرحبا");                                  // the model greets now (scripted: nothing more to say), no welcome again
    expect(outbound.slice(n).some((s) => bodyOf(s).includes(ar.cx.privacy))).toBe(false);
  });

  it("a first message that already orders: the welcome first, then the order goes on as usual", async () => {
    const t = flow(db, [read(order([LABNEH]))]);
    await pinned(db, t, ids.BAAKLINE);
    await t.text("بدي 2 لبنة ليبان ليه");
    expect(bodyOf(outbound[0]!)).toContain(ar.cx.privacy);
    expect(t.seen).toHaveLength(1);                           // the reading still ran
    expect(outbound.length).toBeGreaterThan(1);
  });

  it("a first message that is STOP gets no welcome", async () => {
    const t = flow(db, []);
    await t.text("STOP");
    expect(outbound.some((s) => bodyOf(s).includes(ar.cx.privacy))).toBe(false);
  });
});

describe("the confirmation carries the card's choices", () => {
  it("the card says what happens if an item is missing; Confirm answers with one list: missing item, the note, keep the change, cancel", async () => {
    const { t, c, orderId } = await withCard();
    expect(bodyOf(outbound.find(isCard)!)).toContain(ar.cx.missingLine("ask"));
    const n = outbound.length;
    await t.tap(`order:confirm:${orderId}`, ar.card.confirm);
    const reply = outbound.slice(n);
    expect(reply).toHaveLength(1);                            // still one message
    const ids = rowsOf(reply[0]!).map((r) => r.id);
    expect(ids).toContain(`choice:missing:best_match:${orderId}`);
    expect(ids).toContain(`choice:note:exact:${orderId}`);
    expect(ids).toContain(`choice:keep:x:${orderId}`);
    expect(ids).toContain(`order:cancel:${orderId}`);
    expect(ids.length).toBeLessThanOrEqual(10);
    await t.tap(`choice:missing:remove:${orderId}`, ar.cx.missingRow.remove);
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.cx.missingSet("remove"));
    const note = ids.find((x) => /^choice:note:\d+:/.test(x))!;
    await t.tap(note, "note");
    const o = await db.one(`select missing_pref, change_for_usd, total_usd, keep_change_credit from orders where id = $1`, [orderId]);
    expect(o.missing_pref).toBe("remove");
    expect(Number(o.change_for_usd)).toBeGreaterThan(Number(o.total_usd));
    await t.tap(`choice:keep:x:${orderId}`, ar.cx.keepRow);
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.cx.keepSet(Number(o.change_for_usd) - Number(o.total_usd)));
    expect((await db.one(`select keep_change_credit from orders where id = $1`, [orderId])).keep_change_credit).toBe(true);
    void c;
  });

  it("a prepaid order's confirmation carries its four-digit handover code", async () => {
    const { t, orderId } = await withCard();
    await db.pg.query(`update orders set payment_method = 'whish' where id = $1`, [orderId]);
    const n = outbound.length;
    await t.tap(`order:confirm:${orderId}`, ar.card.confirm);
    const code = (await db.one(`select handover_code from orders where id = $1`, [orderId])).handover_code as string;
    expect(code).toMatch(/^\d{4}$/);
    expect(bodyOf(outbound.slice(n)[0]!)).toContain(ar.cx.handoverCode(code));
  });
});

describe("cancel by the customer", () => {
  it("in words before picking: what a cancel gives back and one button; the tap cancels", async () => {
    const { t, orderId, code } = await withCard();
    await t.tap(`order:confirm:${orderId}`, ar.card.confirm);
    await t.text("بدي الغي الطلب");
    const ask = outbound.at(-1)!;
    expect(bodyOf(ask)).toBe(ar.cx.cancelAsk(code, 0));
    expect(buttonsOf(ask)).toEqual([{ id: `order:cancel:${orderId}`, title: ar.cx.cancelYes }]);
    await t.tap(`order:cancel:${orderId}`, ar.cx.cancelYes);
    expect((await db.one(`select status from orders where id = $1`, [orderId])).status).toBe("cancelled");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.tap.cancelled(code));
  });

  it("once picking started: nothing cancelled by the tap; the customer told it plainly, and a person has a case", async () => {
    const { t, c, orderId, code } = await withCard();
    await t.tap(`order:confirm:${orderId}`, ar.card.confirm);
    const picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'P') returning id`)).id;
    expect((await db.rpc("start_pick", { p_order: orderId, p_by: picker })).status).toBe("started");
    await t.tap(`order:cancel:${orderId}`, ar.card.cancel);
    expect((await db.one(`select status from orders where id = $1`, [orderId])).status).toBe("preparing");
    expect(all()).toContain(ar.cx.cancelAfterPickCash(code));
    expect(await db.all(`select 1 from handoffs where conversation_id = $1 and kind = 'order_problem' and state <> 'resolved'`, [c.conversation_id])).toHaveLength(1);
  });
});

describe("pickup at the hub, said in words", () => {
  it("off until a place is named: one line, and the card stays a delivery", async () => {
    const { t, orderId } = await withCard();
    await t.text("بمرق باخدو من عندكن");
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.cx.pickupOff);
    expect((await db.one(`select status, is_pickup from orders where id = $1`, [orderId]))).toEqual({ status: "awaiting_confirmation", is_pickup: false });
  });

  it("on: the waiting card is made again as a pickup at the named place, with no delivery fee", async () => {
    await db.pg.exec(`update settings set value = '{"enabled": true, "place_ar": "مستودع الاختبار", "place_en": "the test hub"}' where key = 'pickup'`);
    const { t, c } = await withCard();
    const n = outbound.length;
    await t.text("بمرق باخدو من عندكن");
    const card = outbound.slice(n).find(isCard);
    expect(card, outbound.slice(n).map(bodyOf).join("\n---\n")).toBeTruthy();
    expect(bodyOf(card!)).toContain(ar.cx.pickupAt("مستودع الاختبار"));
    const o = await db.one(`select is_pickup, delivery_fee_usd from orders where customer_id = $1 and status = 'awaiting_confirmation'`, [c.party_id]);
    expect(o.is_pickup).toBe(true);
    expect(Number(o.delivery_fee_usd)).toBe(0);
    await db.pg.exec(`update settings set value = '{"enabled": false, "place_ar": null, "place_en": null}' where key = 'pickup'`);
  });
});
