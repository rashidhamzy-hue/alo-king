// Build plan 2.8: scheduled orders, on the real schema (every migration), through the real SQL and the real ops-line turn code.
// Windows and the calendar are rows a person edits; a slot is held only by the customer's tap; a full slot refuses; cut-offs,
// the earlier one for fresh goods; changes and cancelling before the cut-off; rescheduling; the rider in time for the window;
// shelf goods reserved at confirmation, fresh goods when the order comes due. Plus the card and the fixed replies.
import { beforeAll, describe, expect, it } from "vitest";
import { dispatchAndOffer } from "../../apps/gateway/src/ops-turn";
import { buttonReplyText, formatOrderCard, formatWindowChoice, parseWindowButton, windowButtonId, windowLabel, type DeliveryWindow, type Quote } from "@ak/agents/order-card";
import { collect, deliverToDoor, expectBooksBalanced, openHub, status, stock, type Hub } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>;
let WATER: string; let COFFEE: string; let FRESH: string;
let n = 0;

interface Card { orderId: string; party: string; code: string }

async function customer(): Promise<{ party: string; conversation: string; place: string }> {
  const k = ++n;
  const t = await h.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-sched-${k}`, p_phone: `+9617600${String(k).padStart(4, "0")}`, p_name: `Sched ${k}` });
  await h.db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
  const place = (await h.db.one(`select id from customer_places where party_id = $1 limit 1`, [t.party_id])).id;
  return { party: t.party_id, conversation: t.conversation_id, place };
}

/** A card (awaiting confirmation), as issueCard makes one. */
async function card(lines: { product_id: string; qty: number }[], who?: { party: string; conversation: string; place: string }, payment = "cod"): Promise<Card> {
  const c = who ?? await customer();
  const o = await h.db.rpc("create_order_from_quote", { p_customer: c.party, p_conversation: c.conversation, p_lines: lines,
    p_village: h.village, p_place: c.place, p_pickup: false, p_payment: payment, p_change_for: null, p_notes: null });
  if (!o.created) throw new Error("no card: " + JSON.stringify(o.quote.issues));
  return { orderId: o.order_id, party: c.party, code: o.short_code };
}
const choose = (c: Card, slot: string | null) => h.db.rpc("request_delivery_window", { p_order: c.orderId, p_slot: slot, p_party: c.party });
const confirm = (c: Card) => h.db.rpc("confirm_order_checked", { p_order: c.orderId, p_party: c.party, p_wamid: `w-${c.orderId}-${Math.random()}` });
const holds = async (slot: string) => Number((await h.db.one(`select count(*) as n from slot_holds where slot_id = $1`, [slot])).n);
const today = async () => (await h.db.one(`select (now() at time zone 'Asia/Beirut')::date::text as d`)).d as string;
/** The slot of one plan, `days` from today. */
async function slotOf(plan: string, days: number): Promise<string> {
  await h.db.rpc("generate_delivery_slots", {});
  return (await h.db.one(`select id from delivery_slots where plan_id = $1 and slot_date = (now() at time zone 'Asia/Beirut')::date + $2::int`, [plan, days])).id;
}
async function plan(fields: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(fields);
  return (await h.db.one(`insert into delivery_window_plans(${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(fields).map((v) => (Array.isArray(v) ? `{${v.join(",")}}` : v)))).id;
}
/** Moves a slot so that it starts `mins` minutes from now (time passing, without a clock in the test). */
async function startsIn(slot: string, mins: number) {
  await h.db.pg.query(`update delivery_slots set starts_at = now() + make_interval(mins => $2), ends_at = now() + make_interval(mins => $2 + 120),
                         order_by = now() + make_interval(mins => $2 - 120), fresh_order_by = now() + make_interval(mins => $2 - 720) where id = $1`, [slot, mins]);
}

let MORNING: string;   // every day, 10:00-12:00, 2 orders

beforeAll(async () => {
  h = await openHub();
  await h.db.pg.exec(`update settings set value = '0' where key = 'min_order_usd'`);   // small baskets keep the arithmetic readable
  line = opsLine(h);
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  FRESH = (await h.db.one(`select p.id from products p join offers o on o.product_id = p.id and o.is_available join stock_levels s on s.product_id = p.id
                            where p.storage = 'fresh' and p.is_active order by p.name_en limit 1`)).id;
  MORNING = await plan({ name: "Morning", starts: "10:00", ends: "12:00", capacity: 2, order_by_min: 120, fresh_order_by_min: 720 });
  await line.text(PHONES.rider(0), "حاضر");
}, 120_000);

describe("windows are rows a person edits (2.8 a)", () => {
  it("slots come from the plans for the days ahead, in the hub's time, with both cut-offs", async () => {
    const s = await h.db.one(`select * from delivery_slots where id = $1`, [await slotOf(MORNING, 2)]);
    const local = await h.db.one(`select to_char($1::timestamptz at time zone 'Asia/Beirut', 'HH24:MI') as st, to_char($2::timestamptz at time zone 'Asia/Beirut', 'HH24:MI') as ob,
                                         to_char($3::timestamptz at time zone 'Asia/Beirut', 'HH24:MI') as fob`, [s.starts_at, s.order_by, s.fresh_order_by]);
    expect(local).toEqual({ st: "10:00", ob: "08:00", fob: "22:00" });
    expect(Number(s.capacity)).toBe(2);
    expect(Number((await h.db.one(`select count(distinct slot_date) as n from delivery_slots where plan_id = $1`, [MORNING])).n)).toBe(7);
  });

  it("a closed day in the calendar has no window; a Ramadan plan replaces the ordinary ones on its days", async () => {
    const d = await today();
    await h.db.pg.query(`insert into delivery_calendar(kind, name, starts_on, ends_on, closed) values ('holiday', 'Holiday', $1::date + 3, $1::date + 3, true)`, [d]);
    await h.db.pg.query(`insert into delivery_calendar(kind, name, starts_on, ends_on) values ('ramadan', 'Ramadan', $1::date + 4, $1::date + 5)`, [d]);
    const iftar = await plan({ name: "Before iftar", starts: "15:00", ends: "17:00", capacity: 5, calendar_kind: "ramadan" });
    const on = async (days: number) => (await h.db.all(`select p.name from delivery_slots s join delivery_window_plans p on p.id = s.plan_id
                                                          where s.slot_date = $1::date + $2::int and not s.closed order by p.name`, [d, days])).map((r) => r.name);
    expect(await on(3)).toEqual([]);
    expect(await on(4)).toEqual(["Before iftar"]);
    expect(await on(2)).toEqual(["Morning"]);
    await h.db.pg.query(`delete from delivery_calendar`);
    await h.db.pg.query(`delete from delivery_window_plans where id = $1`, [iftar]);
    expect(await on(3)).toEqual(["Morning"]);
    expect(await on(4)).toEqual(["Morning"]);
  });

  it("a plan's new capacity reaches the slots; one slot a person edits keeps its own", async () => {
    const s3 = await slotOf(MORNING, 3);
    await h.db.rpc("edit_delivery_slot", { p_slot: s3, p_by: h.ops, p_capacity: 9 });
    await h.db.pg.query(`update delivery_window_plans set capacity = 3 where id = $1`, [MORNING]);
    expect(Number((await h.db.one(`select capacity from delivery_slots where id = $1`, [await slotOf(MORNING, 2)])).capacity)).toBe(3);
    expect(Number((await h.db.one(`select capacity from delivery_slots where id = $1`, [s3])).capacity)).toBe(9);
    await h.db.pg.query(`update delivery_window_plans set capacity = 2 where id = $1`, [MORNING]);
    await expect(h.db.rpc("edit_delivery_slot", { p_slot: s3, p_by: h.riders[0], p_capacity: 1 })).rejects.toThrow(/NOT_AUTHORISED/);
  });
});

describe("capacity: held at the tap, a full slot refuses (2.8 b, the acceptance test)", () => {
  let slot: string; let a: Card; let b: Card;
  beforeAll(async () => {
    slot = await slotOf(MORNING, 2);
    await h.db.rpc("edit_delivery_slot", { p_slot: slot, p_by: h.ops, p_capacity: 1 });
  });

  it("choosing a window holds nothing; the tap holds it", async () => {
    a = await card([{ product_id: WATER, qty: 1 }]);
    b = await card([{ product_id: COFFEE, qty: 1 }]);
    expect((await choose(a, slot)).ok).toBe(true);
    expect((await choose(b, slot)).ok).toBe(true);            // both cards were made while the slot had room
    expect(await holds(slot)).toBe(0);
    const r = await confirm(a);
    expect(r.status).toBe("confirmed");
    expect(r.window.slot_id).toBe(slot);
    expect(await holds(slot)).toBe(1);
  });

  it("A full slot refuses a scheduled order: back to draft, nothing held or reserved, logged as demand, never 'now' instead", async () => {
    const before = await stock(h, COFFEE);
    const r = await confirm(b);
    expect(r.status).toBe("slot_full");
    expect(r.changed).toBe(false);
    expect(await status(h, b.orderId)).toBe("draft");
    expect(await holds(slot)).toBe(1);
    expect(await stock(h, COFFEE)).toEqual(before);
    expect(await h.db.all(`select 1 from demand_signals where kind = 'no_slot' and party_id = $1`, [b.party])).toHaveLength(1);
    expect(r.windows.map((w: DeliveryWindow) => w.slot_id)).not.toContain(slot);
    expect(buttonReplyText(r)).toContain("امتلى");
  });

  it("the card never offers a full window, and asking for one is refused and logged", async () => {
    const open = await h.db.rpc("open_delivery_windows", { p_village: h.village });
    expect(open.map((w: DeliveryWindow) => w.slot_id)).not.toContain(slot);
    expect(open.length).toBeGreaterThan(0);
    const c = await card([{ product_id: COFFEE, qty: 1 }]);
    const r = await choose(c, slot);
    expect(r).toMatchObject({ ok: false, reason: "full" });
    expect(Number((await h.db.one(`select count(*) as n from demand_signals where kind = 'no_slot'`)).n)).toBe(2);
    await h.db.rpc("edit_delivery_slot", { p_slot: slot, p_by: h.ops, p_capacity: 2 });
  });
});

describe("cut-offs, the earlier one for fresh goods (2.8 c) and stock (2.8 g)", () => {
  let slot: string;
  beforeAll(async () => { slot = await slotOf(MORNING, 2); });

  it("past the order-by time a window is not offered, not chosen and not confirmed", async () => {
    const c = await card([{ product_id: WATER, qty: 1 }]);
    expect((await choose(c, slot)).ok).toBe(true);
    await h.db.pg.query(`update delivery_slots set order_by = now() - interval '1 minute' where id = $1`, [slot]);
    expect((await h.db.rpc("open_delivery_windows", { p_village: h.village })).map((w: DeliveryWindow) => w.slot_id)).not.toContain(slot);
    const r = await confirm(c);
    expect(r.status).toBe("slot_closed");
    expect(await status(h, c.orderId)).toBe("draft");
    expect((await choose(await card([{ product_id: WATER, qty: 1 }]), slot)).reason).toBe("cutoff");
    await h.db.pg.query(`update delivery_slots set order_by = starts_at - interval '2 hours' where id = $1`, [slot]);
  });

  it("an order with fresh goods follows the fresh cut-off; shelf goods alone still go", async () => {
    await h.db.pg.query(`update delivery_slots set fresh_order_by = now() - interval '1 minute' where id = $1`, [slot]);
    const fresh = await card([{ product_id: FRESH, qty: 1 }, { product_id: WATER, qty: 1 }]);
    expect((await choose(fresh, slot)).reason).toBe("fresh_cutoff");
    expect((await h.db.rpc("open_delivery_windows", { p_village: h.village, p_fresh: true })).map((w: DeliveryWindow) => w.slot_id)).not.toContain(slot);
    const shelf = await card([{ product_id: WATER, qty: 1 }]);
    expect((await choose(shelf, slot)).ok).toBe(true);
    await h.db.pg.query(`update delivery_slots set fresh_order_by = starts_at - interval '12 hours' where id = $1`, [slot]);
    await h.db.pg.query(`update orders set status = 'cancelled' where id = $1`, [shelf.orderId]);
  });

  it("at confirmation shelf goods are reserved and fresh goods are not (they are bought to order)", async () => {
    const water = await stock(h, WATER), fresh = await stock(h, FRESH);
    const c = await card([{ product_id: FRESH, qty: 2 }, { product_id: WATER, qty: 1 }]);
    await choose(c, await slotOf(MORNING, 4));
    expect((await confirm(c)).status).toBe("confirmed");
    expect(await stock(h, WATER)).toEqual({ ...water, reserved: water.reserved + 1 });
    expect(await stock(h, FRESH)).toEqual(fresh);
    await h.db.rpc("cancel_scheduled_order", { p_order: c.orderId, p_actor: "ops", p_by: h.ops, p_reason: "test cleanup" });
    expect(await stock(h, WATER)).toEqual(water);
    expect(await stock(h, FRESH)).toEqual(fresh);
  });
});

describe("the rider in time for the window, not at confirmation (2.8 f)", () => {
  let c: Card; let slot: string;
  beforeAll(async () => {
    slot = await slotOf(MORNING, 5);
    c = await card([{ product_id: FRESH, qty: 2 }, { product_id: COFFEE, qty: 1 }]);
    await choose(c, slot);
    expect((await confirm(c)).status).toBe("confirmed");
  });

  it("at confirmation nobody is told: no picker, no rider, not on the pick list, not picked early", async () => {
    const sent = line.outbox.length;
    expect((await dispatchAndOffer({ ...line.deps }, c.orderId)).status).toBe("scheduled");
    expect(line.outbox.length).toBe(sent);
    expect(await h.db.rpc("orders_waiting_for_rider", {})).not.toContain(c.orderId);
    expect((await h.db.rpc("pick_queue", { p_limit: 50 })).map((x: any) => x.order_id)).not.toContain(c.orderId);
    expect((await h.db.rpc("start_pick", { p_order: c.orderId, p_by: h.picker })).order_status).toBe("scheduled");
    const s = await h.db.rpc("order_status_for", { p_party: c.party });
    expect(s.window.slot_id).toBe(slot);
    expect(s.eta_remaining_minutes).toBeNull();
  });

  it("due, with its fresh goods not bought yet: ops is told once, nothing goes to the pickers; received, it goes", async () => {
    await startsIn(slot, 45);
    await h.db.pg.query(`update stock_levels set on_hand = reserved + 1 where product_id = $1`, [FRESH]);
    expect(await h.db.rpc("orders_waiting_for_rider", {})).toContain(c.orderId);
    const sent = line.outbox.length;
    expect((await dispatchAndOffer({ ...line.deps }, c.orderId)).status).toBe("stock_short");
    expect(line.outbox.length).toBe(sent);
    const exc = await h.db.all(`select detail from ops_exceptions where kind = 'scheduled_stock_short' and ref = $1 and status = 'open'`, [c.orderId]);
    expect(exc).toHaveLength(1);
    expect(exc[0].detail.lines[0].qty).toBe(2);
    const fresh = await stock(h, FRESH);
    await h.db.pg.query(`update stock_levels set on_hand = on_hand + 5 where product_id = $1`, [FRESH]);   // the goods are received
    expect((await dispatchAndOffer({ ...line.deps }, c.orderId)).status).toBe("waiting_for_pick");
    expect((await stock(h, FRESH)).reserved).toBe(fresh.reserved + 2);
    expect(await h.db.all(`select 1 from ops_exceptions where kind = 'scheduled_stock_short' and ref = $1 and status = 'open'`, [c.orderId])).toEqual([]);
    expect(line.to(h.picker).filter((m) => m.buttons.includes(`pick:start:${c.orderId}`))).toHaveLength(1);
    expect(line.to(h.ops).filter((m) => m.body.includes(`#${c.code}`) && m.body.includes("ناطر تحضير"))).toHaveLength(0);   // waited 0 minutes, not days
  });

  it("then it runs as any order: picked, rider offered, delivered, paid, closed, books at zero", async () => {
    await line.tap(PHONES.picker, `pick:start:${c.orderId}`);
    expect(await status(h, c.orderId)).toBe("preparing");
    await line.tap(PHONES.picker, `pick:done:${c.orderId}`);
    expect(await status(h, c.orderId)).toBe("ready");
    await deliverToDoor(h, c.orderId);
    await collect(h, c.orderId);
    expect(await status(h, c.orderId)).toBe("closed");
    expect((await stock(h, FRESH)).reserved).toBe(0);
    await expectBooksBalanced(h);
  });
});

describe("changes and cancelling before the cut-off (2.8 d)", () => {
  let slot: string;
  beforeAll(async () => { slot = await slotOf(MORNING, 6); await h.db.rpc("edit_delivery_slot", { p_slot: slot, p_by: h.ops, p_capacity: 1 }); });

  it("a change is a new card: nothing changes until the tap, then the old order goes and the new one takes its place in the full slot", async () => {
    const who = await customer();
    const old = await card([{ product_id: WATER, qty: 1 }], who);
    await choose(old, slot);
    expect((await confirm(old)).status).toBe("confirmed");
    expect(await holds(slot)).toBe(1);                                          // the slot is now full
    const edit = await h.db.rpc("handle_order_button", { p_order: old.orderId, p_action: "edit", p_party: who.party });
    expect(edit.status).toBe("change_open");
    const water = await stock(h, WATER);
    const neu = await card([{ product_id: WATER, qty: 3 }], who);
    const link = await h.db.rpc("link_replacement_order", { p_new: neu.orderId, p_old: old.orderId, p_party: who.party });
    expect(link).toMatchObject({ ok: true, replaces: old.code });
    expect(await status(h, old.orderId)).toBe("confirmed");                     // until the customer taps
    const r = await confirm(neu);
    expect(r).toMatchObject({ status: "confirmed", replaces: old.code });
    expect(buttonReplyText(r)).toContain(old.code);
    expect(await status(h, old.orderId)).toBe("cancelled");
    expect(await holds(slot)).toBe(1);
    expect((await h.db.one(`select order_id from slot_holds where slot_id = $1`, [slot])).order_id).toBe(neu.orderId);
    expect((await stock(h, WATER)).reserved).toBe(water.reserved - 1 + 3);
    await h.db.rpc("cancel_scheduled_order", { p_order: neu.orderId, p_actor: "ops", p_by: h.ops, p_reason: "test cleanup" });
  });

  it("the customer cancels from the card before the cut-off; after it the card says to write to us and nothing changes", async () => {
    const a = await card([{ product_id: WATER, qty: 1 }]);
    await choose(a, slot); await confirm(a);
    const r = await h.db.rpc("handle_order_button", { p_order: a.orderId, p_action: "cancel", p_party: a.party });
    expect(r).toMatchObject({ status: "cancelled", changed: true });
    expect(await holds(slot)).toBe(0);
    const b = await card([{ product_id: WATER, qty: 1 }]);
    await choose(b, slot); await confirm(b);
    await h.db.pg.query(`update delivery_slots set order_by = now() - interval '1 minute' where id = $1`, [slot]);
    const late = await h.db.rpc("handle_order_button", { p_order: b.orderId, p_action: "cancel", p_party: b.party });
    expect(late.status).toBe("too_late");
    expect(buttonReplyText(late)).toContain("اكتبلنا");
    expect(await status(h, b.orderId)).toBe("confirmed");
    const c2 = await card([{ product_id: WATER, qty: 2 }], { party: b.party, conversation: (await h.db.one(`select id from conversations where party_id = $1 limit 1`, [b.party])).id,
      place: (await h.db.one(`select id from customer_places where party_id = $1 limit 1`, [b.party])).id });
    expect((await h.db.rpc("link_replacement_order", { p_new: c2.orderId, p_old: b.orderId, p_party: b.party })).reason).toBe("too_late");
    await h.db.pg.query(`update delivery_slots set order_by = starts_at - interval '2 hours' where id = $1`, [slot]);
    await h.db.rpc("cancel_scheduled_order", { p_order: b.orderId, p_actor: "ops", p_by: h.ops, p_reason: "test cleanup" });
  });

  it("a paid order cancelled before the cut-off is owed back as credit; a paid order is changed by a person", async () => {
    const a = await card([{ product_id: WATER, qty: 1 }], undefined, "whish");
    await choose(a, slot);
    expect((await confirm(a)).status).toBe("awaiting_payment");
    const due = Number((await h.db.one(`select total_usd from orders where id = $1`, [a.orderId])).total_usd);
    await h.db.rpc("confirm_payment", { p_order: a.orderId, p_by: h.ops, p_external_ref: `WH-${a.code}`, p_amount_usd: due });
    expect(await status(h, a.orderId)).toBe("confirmed");
    const neu = await card([{ product_id: WATER, qty: 2 }], { party: a.party, conversation: (await h.db.one(`select id from conversations where party_id = $1 limit 1`, [a.party])).id,
      place: (await h.db.one(`select id from customer_places where party_id = $1 limit 1`, [a.party])).id });
    expect((await h.db.rpc("link_replacement_order", { p_new: neu.orderId, p_old: a.orderId, p_party: a.party })).reason).toBe("paid");
    const r = await h.db.rpc("handle_order_button", { p_order: a.orderId, p_action: "cancel", p_party: a.party });
    expect(r.status).toBe("cancelled");
    expect(Number(r.credit_usd)).toBeCloseTo(due, 2);
    expect(Number(await h.db.rpc("customer_credit_usd", { p_party: a.party }))).toBeCloseTo(due, 2);
    expect(buttonReplyText(r)).toContain("رصيد");
    await expectBooksBalanced(h);
  });
});

describe("rescheduling (2.8 e)", () => {
  it("the customer moves the order before the cut-off: the old hold goes, the new one is taken, both recorded", async () => {
    const from = await slotOf(MORNING, 2), to = await slotOf(MORNING, 3);
    const c = await card([{ product_id: WATER, qty: 1 }]);
    await choose(c, from); await confirm(c);
    const [hf, ht] = [await holds(from), await holds(to)];
    const r = await h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: to, p_actor: "customer", p_by: c.party });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect([await holds(from), await holds(to)]).toEqual([hf - 1, ht + 1]);
    expect(await h.db.all(`select actor from slot_changes where order_id = $1`, [c.orderId])).toEqual([{ actor: "customer" }]);
    expect((await h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: to, p_actor: "customer", p_by: (await customer()).party }).catch((e: Error) => e.message))).toMatch(/NOT_YOUR_ORDER/);
  });

  it("a full window is refused; ops may move an order past the cut-off, with a reason, but never past capacity", async () => {
    const full = await slotOf(MORNING, 6);
    await h.db.rpc("edit_delivery_slot", { p_slot: full, p_by: h.ops, p_capacity: 0 });
    const from = await slotOf(MORNING, 2);
    const c = await card([{ product_id: WATER, qty: 1 }]);
    await choose(c, from); await confirm(c);
    expect((await h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: full, p_actor: "customer", p_by: c.party })).reason).toBe("full");
    expect((await h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: full, p_actor: "ops", p_by: h.ops, p_reason: "rider short" })).reason).toBe("full");
    const past = await slotOf(MORNING, 3);
    await h.db.pg.query(`update delivery_slots set order_by = now() - interval '1 minute' where id = $1`, [past]);
    await expect(h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: past, p_actor: "ops", p_by: h.ops, p_reason: "" })).rejects.toThrow(/REASON_REQUIRED/);
    expect((await h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: past, p_actor: "customer", p_by: c.party })).reason).toBe("cutoff");
    expect((await h.db.rpc("reschedule_order", { p_order: c.orderId, p_slot: past, p_actor: "ops", p_by: h.ops, p_reason: "customer phoned" })).ok).toBe(true);
    expect((await h.db.one(`select slot_id from slot_holds where order_id = $1`, [c.orderId])).slot_id).toBe(past);
    expect((await h.db.one(`select reason from slot_changes where order_id = $1 and actor = 'ops'`, [c.orderId])).reason).toBe("customer phoned");
    await h.db.pg.query(`update delivery_slots set order_by = starts_at - interval '2 hours' where id = $1`, [past]);
  });

  it("a held window on a day the calendar closes is closed to new orders and goes to ops; the order keeps its promise", async () => {
    const s = await slotOf(MORNING, 5);
    const c = await card([{ product_id: WATER, qty: 1 }]);
    await choose(c, s); await confirm(c);
    await h.db.pg.query(`insert into delivery_calendar(kind, name, starts_on, ends_on, closed) values ('holiday', 'Closed', $1::date + 5, $1::date + 5, true)`, [await today()]);
    expect((await h.db.one(`select closed from delivery_slots where id = $1`, [s])).closed).toBe(true);
    expect(await h.db.all(`select 1 from ops_exceptions where kind = 'scheduled_day_changed' and ref = $1`, [s])).toHaveLength(1);
    expect(await status(h, c.orderId)).toBe("confirmed");
    expect(await holds(s)).toBe(1);
    await h.db.pg.query(`delete from delivery_calendar`);
  });
});

describe("the card and the fixed replies (order-card.ts)", () => {
  const w: DeliveryWindow = { slot_id: "11111111-2222-3333-4444-555555555555", date: "2026-11-20", dow: 5, day_offset: 6, starts: "10:00", ends: "12:00" };
  const q: Quote = { ok: true, issues: [], lines: [{ name: "Water", name_ar: "مي", qty: 1, unit: "each", line_total_usd: 3 }], subtotal_usd: 3, delivery_fee_usd: 2,
                     total_usd: 5, fx_rate_lbp: 89500, total_lbp: 447500, eta_minutes: 35, pickup: false, village: "Baakline", village_ar: "بعقلين", village_id: null };
  const order = "99999999-8888-7777-6666-555555555555";

  it("a scheduled card says the window, not minutes; a change says which order it replaces", () => {
    const body = (formatOrderCard({ orderId: order, shortCode: "AK-2001", quote: q, paymentMethod: "cod", window: w, replaces: "AK-1999" })[0] as any).interactive.body.text as string;
    expect(body).toContain("التوصيل: الجمعة 20/11، 10:00-12:00");
    expect(body).not.toContain("دقيقة");
    expect(body).toContain("AK-1999");
    const now = (formatOrderCard({ orderId: order, shortCode: "AK-2001", quote: q, paymentMethod: "cod" })[0] as any).interactive.body.text as string;
    expect(now).toContain("35 دقيقة");
    expect(windowLabel({ ...w, day_offset: 1 })).toBe("بكرا 10:00-12:00");
  });

  it("the window list: one row per open window, ids the parser reads back, and a plain line when there is none", () => {
    const m = formatWindowChoice(order, [w], { withNow: true }) as any;
    const ids = m.interactive.action.sections[0].rows.map((r: any) => r.id);
    expect(ids).toEqual([windowButtonId("now", order), windowButtonId(w.slot_id, order)]);
    expect(parseWindowButton(ids[0])).toEqual({ slotId: null, orderId: order });
    expect(parseWindowButton(ids[1])).toEqual({ slotId: w.slot_id, orderId: order });
    expect(m.interactive.action.sections[0].rows.every((r: any) => r.title.length <= 24)).toBe(true);
    expect((formatWindowChoice(order, []) as any).type).toBe("text");
    expect(buttonReplyText({ status: "confirmed", short_code: "AK-2001", changed: true, window: w })).toContain("الجمعة 20/11");
  });
});
