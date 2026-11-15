// Session K1, lane B leftover recorded by B4 (docs/HANDOFF.md, "Found and not changed"): an order sent after closing time.
// On staging (13 Nov 21:42 UTC, the probe's order) the plan asked (closed), the model sent a pin request saying "we continue
// later", and after the pin the turn had no card to send (create_order_from_quote refuses while closed), so the model answered
// with the greeting. The basket was gone by morning. Each case here was a failing test before its fix.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, read, recordKapso, use, type Sent } from "./flow-kit";
import { KEPT_BUTTON } from "@ak/agents/order-card";
import { ar } from "@ak/agents/messages";
import { offerKeptOrders } from "@ak/agents/cron";

let db: TestDb;
const ids: Record<string, string> = {};
const OPEN = `{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}`;
const CLOSED = `{"open":"08:00","close":"08:00","tz":"Asia/Beirut"}`;      // every minute of the day is outside 08:00-08:00
const hours = (h: string) => db.pg.query(`update settings set value = $1::jsonb where key = 'hours'`, [h]);
beforeAll(async () => {
  ({ db } = await openFlowDb());
  for (const [k, sku] of [["water", "AK-0103"], ["bread", "AK-0080"], ["coffee", "AK-0133"]] as const)
    ids[k] = (await db.one(`select id from products where sku = $1`, [sku])).id;
}, 60_000);
afterEach(async () => { vi.unstubAllGlobals(); await hours(OPEN); });
afterAll(async () => { await db?.pg.close(); });

const MESSAGE = "بدي كرتونة مي تنورين، ربطة خبز الفورنو وقهوة نجار";
const READING = {
  intent: "order", fulfilment: "delivery", transcript_quality: "good", needs_clarification: [],
  lines: [
    { qty: 1, raw: "كرتونة مي تنورين", unit: "each", query: "مي تنورين", modifiers: [], brand_hint: "تنورين", confidence: 0.9, source_hint: null },
    { qty: 1, raw: "ربطة خبز الفورنو", unit: "bundle", query: "خبز الفورنو", modifiers: [], brand_hint: "الفورنو", confidence: 0.9, source_hint: null },
    { qty: 1, raw: "قهوة نجار", unit: "each", query: "قهوة نجار", modifiers: [], brand_hint: "نجار", confidence: 0.9, source_hint: null },
  ],
  address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null },
};
const ADDRESS = { intent: "order", lines: [], fulfilment: "delivery", transcript_quality: "good", needs_clarification: [],
  address: { floor: "الطابق الأول", village: null, building: "بيت الاختبار", landmark: null, verbatim: "بيت الاختبار، الطابق الأول", recipient_name: null } };
const PIN = { latitude: 33.67739, longitude: 35.56355 };            // Baakline's centre (the probe's pin)
const bodyOf = (s: Sent) => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
/** B1c: the kept and minimum lines list the basket ("• 2 × name"); the fixed words around them are compared without it. */
const unlisted = (b: string) => b.replace(/\n(?:بسلّتك:|In your basket:|Dans votre panier :)(?=\n)/g, "").replace(/\n• [^\n]+/g, "");
const buttonIds = (s: Sent) => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id);
const GREETING = /أهلا|اهلا|مرحبا|شو بتحب تطلب/;

describe("an order sent after closing time (K1, B4's leftover)", () => {
  it("is kept, says when we open, and the pin gets no greeting; the tap after opening sends the card", async () => {
    const outbound = recordKapso();
    await hours(CLOSED);
    const t = flow(db, [read(READING), read(ADDRESS)]);

    // 1. The order, after hours: one fixed message by code (no tool loop), saying when we open, with the button to send it later.
    await t.text(MESSAGE);
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(1);
    expect(unlisted(bodyOf(outbound[0]!))).toBe(ar.fixed.closedKept("08:00"));
    expect(buttonIds(outbound[0]!)).toEqual([KEPT_BUTTON]);

    // 2. A pin anyway, at night: saved, answered by code with the hours, never with a greeting. No model call.
    await t.say({ type: "location", location: PIN });
    expect(t.seen).toHaveLength(1);
    expect(outbound).toHaveLength(2);
    expect(unlisted(bodyOf(outbound[1]!))).toBe(ar.fixed.closedKeptPin("08:00"));
    expect(bodyOf(outbound[1]!)).not.toMatch(GREETING);

    // 3. A tap while still closed: the same answer, the basket still kept.
    await t.tap(`${KEPT_BUTTON}`, "ابعت طلبي");
    expect(unlisted(bodyOf(outbound[2]!))).toBe(ar.fixed.closedKept("08:00"));

    // 4. We open. The tap continues where the pin left off: house and floor for a new place, then the card with all three items.
    await hours(OPEN);
    await t.tap(`${KEPT_BUTTON}`, "ابعت طلبي");
    expect(bodyOf(outbound.at(-1)!)).toContain("كرمال السائق");
    await t.text("بيت الاختبار، الطابق الأول");
    const card = outbound.at(-1)!;
    expect(bodyOf(card)).toContain("طلبك AK-");
    const c = await t.customer();
    const order = await db.one(`select * from orders where customer_id = $1`, [c.party_id]);
    const items = await db.all(`select product_id from order_items where order_id = $1`, [order.id]);
    expect(items.map((i: any) => i.product_id).sort()).toEqual([ids.water, ids.bread, ids.coffee].sort());
    expect(order.status).toBe("awaiting_confirmation");                       // the catalog never confirms; nor does this path
    for (const s of outbound) expect(bodyOf(s)).not.toMatch(/مرة تانية/);   // never "send the order again"
  }, 60_000);

  it("closing between the pin request and the address: the basket is kept, not answered with a greeting", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read(READING), read(ADDRESS)]);
    await t.text(MESSAGE);                                                   // open: the code's pin request
    expect(bodyOf(outbound[0]!).endsWith(ar.fixed.askPin)).toBe(true);
    await t.say({ type: "location", location: PIN });
    expect(bodyOf(outbound[1]!)).toContain("كرمال السائق");
    await hours(CLOSED);                                                     // 23:00 passes while they type the house
    await t.text("بيت الاختبار، الطابق الأول");
    expect(outbound).toHaveLength(3);
    expect(unlisted(bodyOf(outbound[2]!))).toBe(ar.fixed.closedKept("08:00"));
    expect(buttonIds(outbound[2]!)).toEqual([KEPT_BUTTON]);
    await hours(OPEN);
    await t.tap(KEPT_BUTTON, "ابعت طلبي");
    expect(bodyOf(outbound.at(-1)!)).toContain("طلبك AK-");                 // the house is already known: the card at once
  }, 60_000);

  it("the staging probe's path (21:42 UTC, the village in the text): no tool loop, and the pin is answered with the hours", async () => {
    const outbound = recordKapso();
    await hours(CLOSED);
    // On staging the plan's only issue was `closed`; the loop ran and the model asked for the pin itself. Now code answers.
    const t = flow(db, [read({ ...READING, address: { ...READING.address, village: "بعقلين", verbatim: "عبعقلين" } }),
                        [use("ask_location_pin", { text: "منكمّل بكرا الصبح. ابعتلنا موقعك" })], [use("reply", { text: "أهلا! شو بتحب تطلب؟" })]]);
    await t.text(MESSAGE + " عبعقلين");
    expect(t.seen).toHaveLength(1);
    expect(unlisted(bodyOf(outbound[0]!))).toBe(ar.fixed.closedKept("08:00"));
    await t.say({ type: "location", location: PIN });
    expect(t.seen).toHaveLength(1);
    const last = bodyOf(outbound.at(-1)!);
    expect(last).not.toMatch(GREETING);
    expect(unlisted(last)).toBe(ar.fixed.closedKeptPin("08:00"));
  }, 60_000);
  it("audit item 4: when we open, the kept order is offered once with its button, inside the 24-hour window", async () => {
    const outbound = recordKapso();
    await db.pg.query(`update kept_orders set cleared_at = now() where cleared_at is null`);   // earlier tests' customers
    await hours(CLOSED);
    const t = flow(db, [read(READING), read(ADDRESS)]);
    await t.text(MESSAGE);
    const c = await t.customer();
    const offer = () => offerKeptOrders({ db: t.client, send: t.deps.send });
    expect(await offer()).toBe(0);                                         // still closed: nothing goes out
    await hours(OPEN);
    expect(await offer()).toBe(1);
    expect(bodyOf(outbound.at(-1)!)).toBe(ar.fixed.keptOpen);
    expect(buttonIds(outbound.at(-1)!)).toEqual([KEPT_BUTTON]);
    expect(await offer()).toBe(0);                                         // once
    // The tap carries on as before: the pin, then the house, then the card. Taken, the kept order is cleared.
    await t.tap(KEPT_BUTTON, "ابعت طلبي");
    expect(outbound.at(-1)!.body.interactive.type).toBe("location_request_message");
    expect((await db.one(`select count(*)::int as n from kept_orders where party_id = $1 and cleared_at is null`, [c.party_id])).n).toBe(0);
  }, 60_000);

  it("audit item 4: a kept order older than the window is never offered (no message to someone outside 24 hours)", async () => {
    recordKapso();
    await hours(CLOSED);
    const t = flow(db, [read(READING)]);
    await t.text(MESSAGE);
    const c = await t.customer();
    await db.pg.query(`update kept_orders set kept_at = now() - interval '25 hours' where party_id = $1`, [c.party_id]);
    await hours(OPEN);
    expect(await offerKeptOrders({ db: t.client, send: t.deps.send })).toBe(0);
  }, 60_000);
});

