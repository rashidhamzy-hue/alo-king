// Session W1: the customer side of scheduled orders (2.8), C3's requests 1 to 6 and G1-22, through the real turn code, tools and
// gateway on the real schema (every migration), with a scripted model. Windows are rows a person enters (delivery_window_plans);
// the clock is the database's. The reading of a time in words is judged by evals/cases/delivery_time.json.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Sent } from "./flow-kit";
import { formatWindowChoice, KEPT_BUTTON, windowButtonId, windowLabel, type DeliveryWindow } from "@ak/agents/order-card";
import { ar } from "@ak/agents/messages";

let db: TestDb; let VILLAGE: string;
const ids: Record<string, string> = {};
const OPEN = `{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}`;
const CLOSED = `{"open":"08:00","close":"08:00","tz":"Asia/Beirut"}`;
const hours = (h: string) => db.pg.query(`update settings set value = $1::jsonb where key = 'hours'`, [h]);
let MORNING: string; let EVENING: string; let OPS: string;

beforeAll(async () => {
  let x; ({ db, ids: x } = await openFlowDb());
  VILLAGE = x.BAAKLINE;
  await db.pg.exec(`update settings set value = '0' where key = 'min_order_usd'`);
  for (const [k, sku] of [["water", "AK-0103"], ["bread", "AK-0080"], ["coffee", "AK-0133"], ["tomato", "AK-0002"]] as const)
    ids[k] = (await db.one(`select id from products where sku = $1`, [sku])).id;
  // Two windows every day. Fresh goods three hours before the start, so tomorrow's windows are open whatever the hour of the run.
  const plan = async (name: string, starts: string, ends: string, capacity: number) => (await db.one(
    `insert into delivery_window_plans(name, starts, ends, capacity, order_by_min, fresh_order_by_min) values ($1, $2, $3, $4, 120, 180) returning id`,
    [name, starts, ends, capacity])).id as string;
  OPS = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops W1') returning id`)).id;
  MORNING = await plan("Morning", "10:00", "12:00", 5);
  EVENING = await plan("Evening", "18:00", "20:00", 5);
}, 120_000);
afterEach(async () => { vi.unstubAllGlobals(); await hours(OPEN); });
afterAll(async () => { await db?.pg.close(); });

/** The slot of one plan, `days` from today (the hub's date). */
async function slotOf(plan: string, days: number): Promise<string> {
  await db.rpc("generate_delivery_slots", {});
  return (await db.one(`select id from delivery_slots where plan_id = $1 and slot_date = (now() at time zone 'Asia/Beirut')::date + $2::int`, [plan, days])).id;
}
const line = (raw: string, query: string, brand: string | null = null) => ({ qty: 1, raw, unit: "each", query, modifiers: [], brand_hint: brand, confidence: 0.9, source_hint: null });
const WATER = line("كرتونة مي تنورين", "مي تنورين", "تنورين");
const BREAD = line("ربطة خبز الفورنو", "خبز الفورنو", "الفورنو");
const COFFEE = line("قهوة نجار", "قهوة نجار", "نجار");
const TOMATO = line("كيلو بندورة", "بندورة");
const order = (lines: unknown[], intent = "order") => ({ intent, fulfilment: "delivery", transcript_quality: "good", needs_clarification: [], lines,
  address: { floor: null, village: null, building: null, landmark: null, verbatim: null, recipient_name: null } });
const bodyOf = (s: Sent) => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
/** B1c: the kept and minimum lines list the basket ("• 2 × name"); the fixed words around them are compared without it. */
const unlisted = (b: string) => b.replace(/\n(?:بسلّتك:|In your basket:|Dans votre panier :)(?=\n)/g, "").replace(/\n• [^\n]+/g, "");
const rowIds = (s: Sent): string[] => (s.body.interactive?.action?.sections?.[0]?.rows ?? []).map((r: any) => r.id);
const buttonIds = (s: Sent): string[] => (s.body.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id);
const isCard = (s: Sent) => buttonIds(s).some((id) => id.startsWith("order:confirm:"));
const pick = (t: ReturnType<typeof flow>, id: string) => t.say({ type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: "x" } } });
const lastOrder = async (party: string) => db.one(`select * from orders where customer_id = $1 order by created_at desc limit 1`, [party]);
const label = async (slot: string) => windowLabel(await db.rpc("window_json", { p_slot: slot }) as DeliveryWindow);
const confirmId = (s: Sent) => buttonIds(s).find((id) => id.startsWith("order:confirm:"))!;

describe("a customer picks a window by words (C3's request 1, the eval case «بكرا الصبح»)", () => {
  it("an order said with its time gets a card for that window; the tap confirms it there and holds the slot", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read(order([WATER, BREAD]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("بدي كرتونة مي تنورين وربطة خبز الفورنو بكرا الصبح");
    const morning = await slotOf(MORNING, 1);
    expect(outbound).toHaveLength(1);
    expect(isCard(outbound[0]!)).toBe(true);
    expect(bodyOf(outbound[0]!)).toContain(ar.card.window(await label(morning)));
    const o = await lastOrder(c.party_id);
    expect(o.delivery_slot_id).toBe(morning);
    await t.tap(confirmId(outbound[0]!), "تأكيد الطلب");
    expect(bodyOf(outbound.at(-1)!)).toContain(`التوصيل ${await label(morning)}`);
    expect((await lastOrder(c.party_id)).status).toBe("confirmed");
    expect((await db.one(`select slot_id from slot_holds where order_id = $1`, [o.id])).slot_id).toBe(morning);
  }, 60_000);

  it("a time said on its own after the card («jumaa ba3d el dohr», «بكرا») is read by code, with no model call", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read(order([COFFEE]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("قهوة نجار");
    expect(isCard(outbound[0]!)).toBe(true);
    const o = await lastOrder(c.party_id);
    expect(o.delivery_slot_id).toBeNull();
    await t.text("بكرا");                                                        // two windows tomorrow: the customer chooses
    expect(t.seen).toHaveLength(1);
    const rows = rowIds(outbound.at(-1)!);
    expect(rows).toEqual([windowButtonId(await slotOf(MORNING, 1), o.id), windowButtonId(await slotOf(EVENING, 1), o.id)]);
    await t.text("بكرا المسا");                                                   // one window: it goes on the same card
    expect(t.seen).toHaveLength(1);
    expect(isCard(outbound.at(-1)!)).toBe(true);
    expect(confirmId(outbound.at(-1)!)).toBe(`order:confirm:${o.id}`);
    expect(bodyOf(outbound.at(-1)!)).toContain(await label(await slotOf(EVENING, 1)));
    expect((await lastOrder(c.party_id)).delivery_slot_id).toBe(await slotOf(EVENING, 1));
  }, 60_000);
});

describe("a customer picks a window by tap (C3's request 2: interactive.list_reply)", () => {
  it("the list row is read in the customer branch; the same card goes again with the window; confirm holds it", async () => {
    const outbound = recordKapso();
    const t = flow(db, [read(order([WATER]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("كرتونة مي تنورين");
    const o = await lastOrder(c.party_id);
    await t.text("مش هلّق، بعدين");                                               // "not now": every open window (with now, we are open)
    const rows = rowIds(outbound.at(-1)!);
    expect(rows[0]).toBe(windowButtonId("now", o.id));
    const evening = await slotOf(EVENING, 2);
    expect(rows).toContain(windowButtonId(evening, o.id));
    await pick(t, windowButtonId(evening, o.id));
    expect(t.seen).toHaveLength(1);                                               // a tap never reaches the model
    expect(confirmId(outbound.at(-1)!)).toBe(`order:confirm:${o.id}`);
    expect(bodyOf(outbound.at(-1)!)).toContain(await label(evening));
    await t.tap(`order:confirm:${o.id}`, "تأكيد الطلب");
    expect((await lastOrder(c.party_id)).status).toBe("confirmed");
    expect((await db.one(`select slot_id from slot_holds where order_id = $1`, [o.id])).slot_id).toBe(evening);
    // Where is my order: the window, never minutes (C3's request 6).
    await t.text("وين طلبي");
    expect(bodyOf(outbound.at(-1)!)).toBe(`✅ طلبك ${o.short_code}: مأكّد، والتوصيل ${await label(evening)}.`);
  }, 60_000);

  it("a full window is never offered; the slot that filled before the tap refuses and the others are offered (request 3)", async () => {
    const outbound = recordKapso();
    const full = await slotOf(MORNING, 3);
    await db.pg.query(`update delivery_slots set capacity = 1, edited_by = $2, edited_at = now() where id = $1`, [full, OPS]);
    const a = flow(db, [read(order([WATER]))]); const ca = await pinned(db, a, VILLAGE);
    const b = flow(db, [read(order([COFFEE]))]); const cb = await pinned(db, b, VILLAGE);
    await a.text("كرتونة مي"); await b.text("قهوة نجار");
    const oa = await lastOrder(ca.party_id), ob = await lastOrder(cb.party_id);
    await pick(a, windowButtonId(full, oa.id));
    await pick(b, windowButtonId(full, ob.id));                                  // both cards chose it while it had room
    await a.tap(`order:confirm:${oa.id}`, "تأكيد الطلب");
    expect((await lastOrder(ca.party_id)).status).toBe("confirmed");
    // Now full: never offered again, to anyone.
    const offered = (await db.rpc("open_delivery_windows", { p_village: VILLAGE, p_fresh: false, p_limit: 50 }) as DeliveryWindow[]).map((w) => w.slot_id);
    expect(offered).not.toContain(full);
    await b.tap(`order:confirm:${ob.id}`, "تأكيد الطلب");
    const reply = outbound.at(-2)!, list = outbound.at(-1)!;
    expect(bodyOf(reply)).toContain("امتلى");
    expect(rowIds(list).length).toBeGreaterThan(0);
    expect(rowIds(list).some((id) => id.includes(full))).toBe(false);
    expect((await db.one(`select status from orders where id = $1`, [ob.id])).status).toBe("draft");
    // The customer picks another window: the same lines as a new card for it, confirmed there.
    const other = await slotOf(EVENING, 3);
    await pick(b, windowButtonId(other, ob.id));
    const card = outbound.at(-1)!;
    expect(isCard(card)).toBe(true);
    expect(bodyOf(card)).toContain(await label(other));
    await b.tap(confirmId(card), "تأكيد الطلب");
    const nb = await lastOrder(cb.party_id);
    expect(nb.status).toBe("confirmed");
    expect(nb.delivery_slot_id).toBe(other);
  }, 60_000);
});

describe("after hours: a card can be made for a window (C3's request 5)", () => {
  it("an order said with its time after closing gets a card for that window; the tap confirms it; 'now' is refused", async () => {
    const outbound = recordKapso();
    await hours(CLOSED);
    const t = flow(db, [read(order([WATER, BREAD]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("بدي مي وخبز بكرا الصبح");
    expect(isCard(outbound[0]!)).toBe(true);
    expect(bodyOf(outbound[0]!)).not.toBe(ar.fixed.closedKept("08:00"));
    const o = await lastOrder(c.party_id);
    expect(o.delivery_slot_id).toBe(await slotOf(MORNING, 1));
    const now = await db.rpc("request_delivery_window", { p_order: o.id, p_slot: null, p_party: c.party_id });
    expect(now).toMatchObject({ ok: false, reason: "now_unavailable" });
    await t.tap(`order:confirm:${o.id}`, "تأكيد الطلب");
    expect((await lastOrder(c.party_id)).status).toBe("confirmed");
  }, 60_000);

  it("an order after closing with no time is kept, and the windows are offered with it; a row sends the basket for it", async () => {
    const outbound = recordKapso();
    await hours(CLOSED);
    const t = flow(db, [read(order([COFFEE]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("قهوة نجار");
    expect(outbound).toHaveLength(2);
    expect(unlisted(bodyOf(outbound[0]!))).toBe(ar.fixed.closedKept("08:00"));
    expect(buttonIds(outbound[0]!)).toEqual([KEPT_BUTTON]);
    expect(bodyOf(outbound[1]!)).toBe(ar.windows.orChoose);
    const evening = await slotOf(EVENING, 1);
    expect(rowIds(outbound[1]!)).toContain(windowButtonId(evening, null));
    await pick(t, windowButtonId(evening, null));
    const card = outbound.at(-1)!;
    expect(isCard(card)).toBe(true);
    expect(bodyOf(card)).toContain(await label(evening));
    await t.tap(confirmId(card), "تأكيد الطلب");
    const o = await lastOrder(c.party_id);
    expect(o.status).toBe("confirmed");
    expect(o.delivery_slot_id).toBe(evening);
    expect((await db.one(`select count(*)::int as n from kept_orders where party_id = $1 and cleared_at is null`, [c.party_id])).n).toBe(0);
  }, 60_000);
});

describe("fresh goods are bought for a window (0118: no stock now)", () => {
  it("only fresh goods short now: the windows are offered; the card is made for one; fresh is not reserved at the tap", async () => {
    const outbound = recordKapso();
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [ids.tomato]);
    const t = flow(db, [read(order([TOMATO, COFFEE]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("كيلو بندورة وقهوة نجار");
    expect(t.seen).toHaveLength(1);
    const list = outbound.at(-1)!;
    expect(bodyOf(list)).toContain("طازة");
    const morning = await slotOf(MORNING, 2);
    await pick(t, windowButtonId(morning, null));
    const card = outbound.at(-1)!;
    expect(isCard(card)).toBe(true);
    await t.tap(confirmId(card), "تأكيد الطلب");
    const o = await lastOrder(c.party_id);
    expect(o.status).toBe("confirmed");
    expect(o.delivery_slot_id).toBe(morning);
    const reserved = await db.all(`select product_id from stock_movements where order_id = $1 and reason = 'reserve'`, [o.id]);
    expect(reserved.map((r: any) => r.product_id)).toEqual([ids.coffee]);
    await db.pg.query(`update stock_levels set on_hand = 500 where product_id = $1`, [ids.tomato]);
  }, 60_000);
});

describe("a change is a new card that replaces the order (C3's request 4)", () => {
  async function scheduled(t: ReturnType<typeof flow>, words: string) {
    const outbound = recordKapso();
    const c = await pinned(db, t, VILLAGE);
    await t.text(words);
    await t.tap(confirmId(outbound.at(-1)!), "تأكيد الطلب");
    return { c, outbound, o: await lastOrder(c.party_id) };
  }

  it("edit, then «زيدلي ربطة خبز»: one card with both lines and the same window; confirming it replaces the old order", async () => {
    const t = flow(db, [read(order([WATER])), read(order([BREAD], "add_to_order"))]);
    const { c, outbound, o } = await scheduled(t, "كرتونة مي بكرا الصبح");
    expect(o.status).toBe("confirmed");
    await t.tap(`order:edit:${o.id}`, "تعديل");
    expect(bodyOf(outbound.at(-1)!)).toContain("منبعتلك ورقة جديدة");
    await t.text("زيدلي ربطة خبز");
    const card = outbound.at(-1)!;
    expect(isCard(card)).toBe(true);
    expect(bodyOf(card)).toContain(ar.card.replaces(o.short_code));
    expect(bodyOf(card)).toContain(await label(o.delivery_slot_id));
    const n = await lastOrder(c.party_id);
    expect(n.replaces_order_id).toBe(o.id);
    expect((await db.all(`select product_id from order_items where order_id = $1`, [n.id])).map((r: any) => r.product_id).sort()).toEqual([ids.water, ids.bread].sort());
    expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("confirmed");   // nothing moves before the tap
    await t.tap(`order:confirm:${n.id}`, "تأكيد الطلب");
    expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("cancelled");
    expect((await db.one(`select status from orders where id = $1`, [n.id])).status).toBe("confirmed");
    expect(Number((await db.one(`select count(*) as n from slot_holds where order_id in ($1, $2)`, [o.id, n.id])).n)).toBe(1);
  }, 60_000);

  it("edit, then a new time only («بكرا المسا»): the same lines on a new card for that window, replacing the order", async () => {
    const t = flow(db, [read(order([COFFEE]))]);
    const { c, outbound, o } = await scheduled(t, "قهوة نجار بكرا الصبح");
    await t.tap(`order:edit:${o.id}`, "تعديل");
    await t.text("بكرا المسا");
    expect(t.seen).toHaveLength(1);
    const card = outbound.at(-1)!;
    const evening = await slotOf(EVENING, 1);
    expect(bodyOf(card)).toContain(await label(evening));
    expect(bodyOf(card)).toContain(ar.card.replaces(o.short_code));
    await t.tap(confirmId(card), "تأكيد الطلب");
    const n = await lastOrder(c.party_id);
    expect(n.delivery_slot_id).toBe(evening);
    expect(n.status).toBe("confirmed");
    expect((await db.one(`select status from orders where id = $1`, [o.id])).status).toBe("cancelled");
    expect((await db.one(`select count(*)::int as n from slot_changes where order_id = $1`, [n.id])).n).toBe(1);
  }, 60_000);
});

describe("G1-22: a scheduled order goes without a fresh line that never arrived", () => {
  it("ops drops the line before picking: removed, totals follow, released; nobody else may, never the last line", async () => {
    recordKapso();
    const t = flow(db, [read(order([TOMATO, COFFEE]))]);
    const c = await pinned(db, t, VILLAGE);
    await t.text("كيلو بندورة وقهوة نجار بكرا الصبح");
    const o = await lastOrder(c.party_id);
    await t.tap(`order:confirm:${o.id}`, "تأكيد الطلب");
    // It comes due with no tomatoes in.
    await db.pg.query(`update delivery_slots set starts_at = now() + interval '30 minutes', ends_at = now() + interval '150 minutes',
                         order_by = now() - interval '90 minutes', fresh_order_by = now() - interval '150 minutes' where id = $1`, [o.delivery_slot_id]);
    await db.pg.query(`update stock_levels set on_hand = reserved where product_id = $1`, [ids.tomato]);
    expect(await db.rpc("release_scheduled_order", { p_order: o.id })).toBe("stock_short");
    const ops = OPS;
    await expect(db.rpc("drop_scheduled_line", { p_order: o.id, p_product: ids.tomato, p_by: c.party_id, p_reason: "not in" })).rejects.toThrow();
    const before = Number((await lastOrder(c.party_id)).total_usd);
    const tomatoUsd = Number((await db.one(`select round(qty * unit_price_usd, 2) as v from order_items where order_id = $1 and product_id = $2`, [o.id, ids.tomato])).v);
    const r = await db.rpc("drop_scheduled_line", { p_order: o.id, p_product: ids.tomato, p_by: ops, p_reason: "supplier had none" });
    expect(r).toMatchObject({ ok: true, lines: 1, released: "released", credit_usd: 0 });
    const after = await lastOrder(c.party_id);
    expect(Number(after.total_usd)).toBeCloseTo(before - tomatoUsd, 2);
    expect(after.released_at).not.toBeNull();
    expect((await db.one(`select status from ops_exceptions where kind = 'scheduled_stock_short' and ref = $1`, [o.id])).status).toBe("resolved");
    expect(await db.rpc("drop_scheduled_line", { p_order: o.id, p_product: ids.coffee, p_by: ops, p_reason: "test" })).toMatchObject({ ok: false });
    await db.pg.query(`update stock_levels set on_hand = 500 where product_id = $1`, [ids.tomato]);
  }, 60_000);
});

// Last: switching the plans off closes the slots that hold orders (C3: a changed day never cancels a promise), so nothing runs after it.
describe("no windows entered yet (staging today)", () => {
  it("a time in words is answered plainly and the order still goes now: never a window that does not exist", async () => {
    const outbound = recordKapso();
    await db.pg.query(`update delivery_window_plans set active = false`);
    try {
      const t = flow(db, [read(order([WATER]))]);
      const c = await pinned(db, t, VILLAGE);
      await t.text("كرتونة مي بكرا الصبح");
      expect(bodyOf(outbound[0]!)).toBe(ar.windows.noneAtAll);
      expect(isCard(outbound[1]!)).toBe(true);
      expect((await lastOrder(c.party_id)).delivery_slot_id).toBeNull();
    } finally {
      await db.pg.query(`update delivery_window_plans set active = true`);
    }
  }, 60_000);
});

describe("the list a customer sees", () => {
  it("every row title fits WhatsApp's 24 characters; a long day puts the times in the row's description", async () => {
    const w = (day_offset: number, dow: number, date: string): DeliveryWindow => ({ slot_id: "00000000-0000-0000-0000-000000000001", date, dow, day_offset, starts: "10:00", ends: "12:00" });
    const m = formatWindowChoice(null, [w(1, 4, "2026-11-19"), w(4, 3, "2026-11-18")]) as any;
    const rows = m.interactive.action.sections[0].rows;
    expect(rows[0]).toEqual({ id: "slot:00000000-0000-0000-0000-000000000001:basket", title: "بكرا 10:00-12:00" });
    expect(rows[1]).toMatchObject({ title: "الأربعا 18/11", description: "10:00-12:00" });
    for (const r of rows) expect(r.title.length).toBeLessThanOrEqual(24);
  });
});
