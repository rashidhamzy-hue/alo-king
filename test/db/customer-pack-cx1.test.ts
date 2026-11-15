// Session CX1 (customer pack), on the real schema (0143 to 0146): the first-ever welcome's record, the two choices of the order card
// (what to do with a missing item, which note the customer pays with and the change kept as credit), self-service cancel until
// picking starts and the exact refundable amount after, the four-digit handover code for prepaid orders, pickup at the hub with no
// delivery fee, and at most four messages started by code per order. docs/strategy/02-journeys.md section 1; 03 section B.
import { beforeAll, describe, expect, it } from "vitest";
import { balance, deliverToDoor, expectBooksBalanced, openHub, placeOrder, status, stock, total, type Hub } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";
import { riderButtonId } from "@ak/agents/job-card";
import { messages, STAFF_LANG } from "@ak/agents/messages";

let h: Hub; let COFFEE: string; let CARDAMOM: string; let LABNEH: string;
beforeAll(async () => {
  // No picker on the ops line: a rider is offered the job at confirmation (as before the pick queue), so the door tests need no pick.
  h = await openHub({ pickerOnOps: false, riders: 4 });
  await h.db.pg.exec(`update settings set value = '{"enabled": true}' where key = 'welcome'`);
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  CARDAMOM = await h.product("Najjar Cafe Cardamom 180G");
  LABNEH = await h.product("Liban Lait Labneh Baladieh 900G");
}, 120_000);

const newCustomer = async (n: string) => h.db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-cx1-${n}`, p_phone: null, p_name: n });
const inbound = (party: string, wamid: string) => h.db.pg.query(
  `insert into wa_messages(line, direction, party_id, wa_message_id, type, status, body) values ('customer', 'inbound', $1, $2, 'text', 'received', 'مرحبا')`, [party, wamid]);
const itemOf = async (order: string, product: string, st = "ok") =>
  (await h.db.one(`select id from order_items where order_id = $1 and product_id = $2 and status = $3`, [order, product, st])).id as string;
/** One open pick per picker (pick_open_for): each pick here gets its own picker. */
const picker = async () => (await h.db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id as string;
const credit = async (party: string) => Number(await h.db.rpc("customer_credit_usd", { p_party: party }));

describe("the first-ever welcome is claimed once, on the first message only", () => {
  it("a new customer's first message: claimed, with the privacy wording and language kept; never twice", async () => {
    const c = await newCustomer("w1");
    await inbound(c.party_id, "wamid.w1.a");
    expect(await h.db.rpc("claim_welcome", { p_party: c.party_id, p_turn_ids: ["wamid.w1.a"], p_lang: "ar", p_privacy: "PRIVACY LINE" })).toBe(true);
    // A retried turn gets the same answer (the outbox key stops a second send); a later turn does not.
    expect(await h.db.rpc("claim_welcome", { p_party: c.party_id, p_turn_ids: ["wamid.w1.a"], p_lang: "ar", p_privacy: "PRIVACY LINE" })).toBe(true);
    await inbound(c.party_id, "wamid.w1.b");
    expect(await h.db.rpc("claim_welcome", { p_party: c.party_id, p_turn_ids: ["wamid.w1.b"], p_lang: "ar", p_privacy: "PRIVACY LINE" })).toBe(false);
    const w = await h.db.one(`select privacy_wording, lang, wa_message_id from customer_welcomes where party_id = $1`, [c.party_id]);
    expect(w).toEqual({ privacy_wording: "PRIVACY LINE", lang: "ar", wa_message_id: "wamid.w1.a" });
  });

  it("a customer who wrote before (or ordered) gets none", async () => {
    const c = await newCustomer("w2");
    await inbound(c.party_id, "wamid.w2.old");
    await inbound(c.party_id, "wamid.w2.new");
    expect(await h.db.rpc("claim_welcome", { p_party: c.party_id, p_turn_ids: ["wamid.w2.new"], p_lang: "en", p_privacy: "x" })).toBe(false);
  });

  it("switched off by the setting", async () => {
    const c = await newCustomer("w3");
    await h.db.pg.exec(`update settings set value = '{"enabled": false}' where key = 'welcome'`);
    expect(await h.db.rpc("claim_welcome", { p_party: c.party_id, p_turn_ids: ["wamid.w3"], p_lang: "ar", p_privacy: "x" })).toBe(false);
    await h.db.pg.exec(`update settings set value = '{"enabled": true}' where key = 'welcome'`);
  });
});

describe("the card's choices: missing item and which note", () => {
  it("the customer sets them on their own order; a stranger cannot; the note must be above the total", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    expect((await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "missing", p_value: "remove" })).ok).toBe(true);
    const stranger = (await newCustomer("stranger")).party_id;
    await expect(h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: stranger, p_choice: "missing", p_value: "ask" })).rejects.toThrow(/NOT_YOUR_ORDER/);
    const t = await total(h, o.orderId);
    expect(t).toBeLessThan(10);
    const small = await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "keep_change", p_value: "true" });
    expect(small).toMatchObject({ ok: false, reason: "needs_note" });
    const note = await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "note", p_value: "20" });
    expect(note).toMatchObject({ ok: true, note_usd: 20 });
    expect(Number(note.change_usd)).toBeCloseTo(20 - t, 2);
    await expect(h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "note", p_value: "37" })).rejects.toThrow(/UNKNOWN_NOTE/);
    expect((await h.db.one(`select missing_pref, change_for_usd from orders where id = $1`, [o.orderId]))).toEqual({ missing_pref: "remove", change_for_usd: "20.00" });
  });

  it("remove: a missing line is taken off without a substitute being offered, even when substitutes are on", async () => {
    await h.db.pg.exec(`update settings set value = value || '{"offer_substitutes": true}' where key = 'picking'`);
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 1 }, { product_id: LABNEH, qty: 1 }]);
    await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "missing", p_value: "remove" });
    const pk = await picker();
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: pk });
    const r = await h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, COFFEE), p_by: pk });
    expect(r).toMatchObject({ decision: "removed", preference: "remove" });
    expect(await h.db.all(`select 1 from substitution_offers where order_id = $1`, [o.orderId])).toHaveLength(0);
    // Too late to change once picking started.
    expect(await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "missing", p_value: "ask" })).toMatchObject({ ok: false, reason: "too_late" });
  });

  it("best match: the closest substitute within the allowed extra is kept for the customer at once; no question is asked", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }, { product_id: LABNEH, qty: 1 }]);
    const before = await total(h, o.orderId);
    await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "missing", p_value: "best_match" });
    const pk = await picker();
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: pk });
    const r = await h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, COFFEE), p_by: pk });
    expect(r.decision).toBe("substituted");
    expect(Number(r.diff_usd)).toBeLessThanOrEqual(0.5);
    const offer = await h.db.one(`select status, answer_wamid from substitution_offers where order_id = $1`, [o.orderId]);
    expect(offer).toEqual({ status: "kept", answer_wamid: "standing_choice:best_match" });
    expect(await itemOf(o.orderId, CARDAMOM)).toBeTruthy();
    expect(await total(h, o.orderId)).toBeCloseTo(before + Number(r.diff_usd), 2);
    const done = await h.db.rpc("finish_pick", { p_order: o.orderId, p_by: pk });
    expect(done.status).toBe("ready");
    expect(done.changes.substituted).toHaveLength(1);       // told to the customer once, with what changed at the shelf
  });

  it("best match with nothing within the allowed extra: the line is taken off, never a dearer swap", async () => {
    await h.db.pg.exec(`update settings set value = value || '{"best_match_max_extra_usd": -5}' where key = 'card_choices'`);
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }, { product_id: LABNEH, qty: 1 }]);
    await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "missing", p_value: "best_match" });
    const pk = await picker();
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: pk });
    const r = await h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, COFFEE), p_by: pk });
    expect(r).toMatchObject({ decision: "removed", preference: "best_match" });
    await h.db.pg.exec(`update settings set value = value || '{"best_match_max_extra_usd": 0.5}' where key = 'card_choices'`);
  });

  it("ask (the default): unchanged, the picker offers and the customer is asked", async () => {
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 1 }, { product_id: LABNEH, qty: 1 }]);
    const pk = await picker();
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: pk });
    const r = await h.db.rpc("pick_item_missing", { p_item: await itemOf(o.orderId, COFFEE), p_by: pk });
    expect(r.decision).toBe("pending");
    await h.db.pg.exec(`update settings set value = value || '{"offer_substitutes": false}' where key = 'picking'`);
  });

  it("keep the change as credit: the rider gives no change; the note is booked, the rest is the customer's credit, books balanced", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    const t = await total(h, o.orderId);
    await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "note", p_value: "20" });
    expect((await h.db.rpc("set_order_choice", { p_order: o.orderId, p_party: o.customer, p_choice: "keep_change", p_value: "true" })).ok).toBe(true);
    const rider = h.riders[0]!;
    const cashBefore = Number(await h.db.rpc("driver_cash_usd", { p_driver: rider }));
    const delivery = await deliverToDoor(h, o.orderId);
    const job = await h.db.rpc("rider_job", { p_delivery: delivery });
    expect(job.stops.find((s: any) => s.order_id === o.orderId)).toMatchObject({ keep_change: true, change_for_usd: 20 });
    const r = await h.db.rpc("rider_collect", { p_order: o.orderId, p_driver: rider, p_usd: 20, p_lbp: 0 });
    expect(Number(r.credit_usd)).toBeCloseTo(20 - t, 2);
    expect(await status(h, o.orderId)).toBe("closed");
    expect(Number(await h.db.rpc("driver_cash_usd", { p_driver: rider })) - cashBefore).toBeCloseTo(20, 2);
    expect(await credit(o.customer)).toBeCloseTo(20 - t, 2);
    expect(Number((await h.db.one(`select coalesce(sum(-usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id
      where a.code = 'revenue_goods' and e.order_id = $1`, [o.orderId])).s)).toBeCloseTo(t - Number((await h.db.one(`select delivery_fee_usd from orders where id = $1`, [o.orderId])).delivery_fee_usd), 2);
    await expectBooksBalanced(h);
  });

  it("without the choice, change given is unchanged (and too much still refused)", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    const t = await total(h, o.orderId);
    await deliverToDoor(h, o.orderId, h.riders[1]);
    await expect(h.db.rpc("rider_collect", { p_order: o.orderId, p_driver: h.riders[1], p_usd: 20, p_lbp: 0 })).rejects.toThrow(/AMOUNT_MISMATCH/);
    const r = await h.db.rpc("rider_collect", { p_order: o.orderId, p_driver: h.riders[1], p_usd: 20, p_lbp: 0, p_change_usd: Number((20 - t).toFixed(2)) });
    expect(Number(r.credit_usd)).toBe(0);
    await expectBooksBalanced(h);
  });
});

describe("self-service cancel until picking starts", () => {
  it("a cash order before picking: the customer's tap cancels it and the stock goes back", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 2 }]);
    const reserved = (await stock(h, LABNEH)).reserved;
    const r = await h.db.rpc("handle_order_button", { p_order: o.orderId, p_action: "cancel", p_party: o.customer, p_wamid: "w-cancel-1" });
    expect(r).toMatchObject({ status: "cancelled", changed: true });
    expect(Number(r.credit_usd)).toBe(0);
    expect(await status(h, o.orderId)).toBe("cancelled");
    expect((await stock(h, LABNEH)).reserved).toBe(reserved - 2);
  });

  it("a paid order before picking: cancelled, and everything paid becomes credit (fee included: no rider has it)", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }], "whish");
    const t = await total(h, o.orderId);
    const r = await h.db.rpc("customer_cancel_order", { p_order: o.orderId, p_party: o.customer, p_wamid: "w-cancel-2" });
    expect(r.status).toBe("cancelled");
    expect(Number(r.credit_usd)).toBeCloseTo(t, 2);
    expect(await credit(o.customer)).toBeCloseTo(t, 2);
    await expectBooksBalanced(h);
  });

  it("a rider's open offer is withdrawn with the cancel", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    await h.db.rpc("start_shift", { p_driver: h.riders[2] });
    const d = await h.db.rpc("dispatch_order", { p_order: o.orderId });
    expect(d.status).toBe("offered");
    expect((await h.db.rpc("customer_cancel_order", { p_order: o.orderId, p_party: o.customer })).status).toBe("cancelled");
    // Withdrawn: the offer is gone, or (an offer that carried other waiting orders too) it keeps them and loses this one.
    const left = await h.db.one(`select d.status, count(s.id) filter (where s.order_id = $2) as mine from deliveries d
      left join delivery_stops s on s.delivery_id = d.id where d.id = $1 group by d.status`, [d.delivery_id, o.orderId]);
    expect(left.status === "cancelled" || Number(left.mine) === 0).toBe(true);
  });

  it("once picking started: nothing is cancelled; the exact refundable amount is computed from the lines and payments", async () => {
    await h.db.pg.exec(`update products set storage = 'fresh' where id = '${COFFEE}'`);       // as if it could not go back on the shelf
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 1 }, { product_id: LABNEH, qty: 1 }], "whish");
    const paid = await total(h, o.orderId);
    const coffee = Number((await h.db.one(`select qty * unit_price_usd as v from order_items where order_id = $1 and product_id = $2`, [o.orderId, COFFEE])).v);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: await picker() });
    const r = await h.db.rpc("handle_order_button", { p_order: o.orderId, p_action: "cancel", p_party: o.customer, p_wamid: "w-cancel-3" });
    expect(r).toMatchObject({ status: "too_late", reason: "picking_started", changed: false, cancellable: false });
    expect(Number(r.paid_usd)).toBeCloseTo(paid, 2);
    expect(Number(r.refundable_usd)).toBeCloseTo(paid - coffee, 2);           // the fee is still refundable: the order has not left
    expect(r.kept).toHaveLength(1);
    expect(await status(h, o.orderId)).toBe("preparing");
    await h.db.pg.exec(`update products set storage = 'ambient' where id = '${COFFEE}'`);
  });

  it("a cash order once picking started: nothing paid, nothing to refund, and not cancelled by the tap", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    await h.db.rpc("start_pick", { p_order: o.orderId, p_by: await picker() });
    const r = await h.db.rpc("cancel_terms", { p_order: o.orderId });
    expect(r).toMatchObject({ cancellable: false, reason: "picking_started" });
    expect(Number(r.refundable_usd)).toBe(0);
  });
});

describe("the four-digit handover code for prepaid orders", () => {
  it("a prepaid order gets a code when it is confirmed; a cash order none", async () => {
    const paid = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }], "whish");
    const cash = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    expect((await h.db.one(`select handover_code from orders where id = $1`, [paid.orderId])).handover_code).toMatch(/^\d{4}$/);
    expect((await h.db.one(`select handover_code from orders where id = $1`, [cash.orderId])).handover_code).toBeNull();
  });

  it("at the door: Delivered is refused without the code; a wrong code is counted; the right one hands it over and closes it", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }], "whish");
    const code = (await h.db.one(`select handover_code from orders where id = $1`, [o.orderId])).handover_code as string;
    // Earlier tests left orders waiting (some mid-pick): dispatch would batch them into this rider's trip. This test is about one door.
    await h.db.pg.query(`update orders set status = 'cancelled' where status in ('confirmed', 'preparing', 'ready') and id <> $1`, [o.orderId]);
    await h.db.rpc("start_shift", { p_driver: h.riders[3] });
    const d = await h.db.rpc("dispatch_order", { p_order: o.orderId });
    const rider = d.driver_id as string;
    await h.db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
    expect((await h.db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider })).ok).not.toBe(false);
    expect((await h.db.rpc("rider_job", { p_delivery: d.delivery_id })).stops.find((s: any) => s.order_id === o.orderId).code_required).toBe(true);
    await expect(h.db.rpc("rider_delivered", { p_order: o.orderId, p_driver: rider })).rejects.toThrow(/HANDOVER_CODE_REQUIRED/);
    expect(await h.db.rpc("rider_code_pending", { p_driver: rider })).toBe(o.orderId);
    const wrong = code === "0000" ? "1111" : "0000";
    expect(await h.db.rpc("rider_handover", { p_order: o.orderId, p_driver: rider, p_code: wrong })).toMatchObject({ ok: false, result: "wrong", tries_left: 4 });
    const ok = await h.db.rpc("rider_handover", { p_order: o.orderId, p_driver: rider, p_code: code });
    expect(ok).toMatchObject({ ok: true, result: "ok", paid: true });
    expect(await status(h, o.orderId)).toBe("closed");
  });

  it("on the ops line: the rider taps Delivered, is asked for the code, types a wrong one then the right one; handed over", async () => {
    const O = messages(STAFF_LANG).ops;
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }], "whish");
    const code = (await h.db.one(`select handover_code from orders where id = $1`, [o.orderId])).handover_code as string;
    await h.db.pg.query(`update orders set status = 'cancelled' where status in ('confirmed', 'preparing', 'ready') and id <> $1`, [o.orderId]);
    const d = await h.db.rpc("dispatch_order", { p_order: o.orderId });
    const rider = d.driver_id as string;
    const phone = PHONES.rider(h.riders.indexOf(rider));
    await h.db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
    await h.db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider });
    const line = opsLine(h);
    await line.tap(phone, riderButtonId({ kind: "stop", action: "delivered", id: o.orderId }));
    expect(line.to(rider).at(-1)!.body).toBe(O.askCode(o.code));
    expect(await status(h, o.orderId)).toBe("out_for_delivery");
    await line.text(phone, code === "0000" ? "1111" : "0000");
    expect(line.to(rider).at(-1)!.body).toBe(O.wrongCode(4));
    await line.text(phone, code);
    expect(line.to(rider).at(-1)!.body).toBe(O.codeOk(o.code));
    expect(await status(h, o.orderId)).toBe("closed");
  });

  it("five wrong tries lock it and raise an ops exception", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }], "whish");
    const code = (await h.db.one(`select handover_code from orders where id = $1`, [o.orderId])).handover_code as string;
    const wrong = code === "0000" ? "1111" : "0000";
    let last: any;
    for (let i = 0; i < 5; i++) last = await h.db.rpc("check_handover_code", { p_order: o.orderId, p_code: wrong, p_by: h.ops });
    expect(last.result).toBe("locked");
    expect((await h.db.rpc("check_handover_code", { p_order: o.orderId, p_code: code, p_by: h.ops })).result).toBe("locked");
    expect(await h.db.all(`select 1 from ops_exceptions where kind = 'handover_locked' and ref = $1`, [o.code])).toHaveLength(1);
  });
});

describe("pickup at the hub with no delivery fee", () => {
  const pickupOrder = async (payment: "cod" | "whish") => {
    const c = await newCustomer(`p-${payment}-${Math.random()}`);
    const o = await h.db.rpc("create_order_from_quote", { p_customer: c.party_id, p_conversation: c.conversation_id, p_lines: [{ product_id: LABNEH, qty: 1 }],
      p_village: null, p_place: null, p_pickup: true, p_payment: payment, p_change_for: null, p_notes: null });
    expect(o.created).toBe(true);
    await h.db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: c.party_id, p_wamid: `w-${o.order_id}` });
    if (payment !== "cod") await h.db.rpc("confirm_payment", { p_order: o.order_id, p_by: h.ops, p_external_ref: `WH-${o.short_code}`, p_amount_usd: await total(h, o.order_id) });
    const pk = await picker();
    await h.db.rpc("start_pick", { p_order: o.order_id, p_by: pk });
    await h.db.rpc("finish_pick", { p_order: o.order_id, p_by: pk });
    return { id: o.order_id as string, code: o.short_code as string, customer: c.party_id as string };
  };

  it("no fee on the quote, and the place comes from the setting (off until a person names it)", async () => {
    const q = await h.db.rpc("quote_order", { p_lines: [{ product_id: LABNEH, qty: 1 }], p_village: null, p_pickup: true });
    expect(Number(q.delivery_fee_usd)).toBe(0);
    expect(await h.db.rpc("pickup_place", { p_lang: "ar" })).toBeNull();
    await h.db.pg.exec(`update settings set value = '{"enabled": true, "place_ar": "مستودع الاختبار", "place_en": "the test hub"}' where key = 'pickup'`);
    expect(await h.db.rpc("pickup_place", { p_lang: "en" })).toBe("the test hub");
  });

  it("ready: the customer's notice is due once, with the place; nobody offers it to a rider", async () => {
    const o = await pickupOrder("cod");
    expect(await status(h, o.id)).toBe("ready");
    const due = (await h.db.rpc("customer_notices_due")).filter((n: any) => n.order_id === o.id);
    expect(due.map((n: any) => n.kind)).toEqual(["pickup_ready"]);
    expect(due[0].params).toEqual([o.code, "مستودع الاختبار"]);
    expect(await h.db.rpc("orders_waiting_for_rider")).not.toContain(o.id);
  });

  it("cash at the counter: the payment goes to the hub's till, no rider and no fee; closed; books balanced", async () => {
    const o = await pickupOrder("cod");
    const t = await total(h, o.id);
    const till = await balance(h, "hub_cash");
    await expect(h.db.rpc("hub_handover", { p_order: o.id, p_by: h.picker })).rejects.toThrow(/AMOUNT_REQUIRED/);
    const r = await h.db.rpc("hub_handover", { p_order: o.id, p_by: h.picker, p_usd: 20, p_change_usd: Number((20 - t).toFixed(2)) });
    expect(r).toMatchObject({ ok: true, status: "closed" });
    expect(await balance(h, "hub_cash") - till).toBeCloseTo(t, 2);
    expect(Number(await h.db.rpc("driver_cash_usd", { p_driver: h.picker }))).toBeCloseTo(0, 2);
    expect(Number((await h.db.one(`select delivery_fee_usd from orders where id = $1`, [o.id])).delivery_fee_usd)).toBe(0);
    await expectBooksBalanced(h);
  });

  it("prepaid at the counter: the code is asked for, as at a door", async () => {
    const o = await pickupOrder("whish");
    const code = (await h.db.one(`select handover_code from orders where id = $1`, [o.id])).handover_code as string;
    expect((await h.db.rpc("hub_handover", { p_order: o.id, p_by: h.ops, p_code: null })).ok).toBe(false);
    expect(await h.db.rpc("hub_handover", { p_order: o.id, p_by: h.ops, p_code: code })).toMatchObject({ ok: true, status: "closed" });
  });
});

describe("at most four messages started by code per order", () => {
  it("anything not essential is refused past four; essential ones always go; a retried key keeps its answer", async () => {
    const o = await placeOrder(h, [{ product_id: LABNEH, qty: 1 }]);
    const claim = (kind: string, key: string) => h.db.rpc("claim_order_message", { p_order: o.orderId, p_kind: kind, p_key: key });
    expect((await claim("on_the_way", "k1")).allowed).toBe(true);
    expect((await claim("rider_at_door", "k2")).allowed).toBe(true);
    expect((await claim("order_delayed", "k3")).allowed).toBe(true);
    expect((await claim("shelf_changes", "k4")).allowed).toBe(true);
    expect(await claim("feedback", "k5")).toMatchObject({ allowed: false, reason: "over_budget" });
    expect((await claim("substitute_question", "k6")).allowed).toBe(true);
    expect((await claim("on_the_way", "k1")).allowed).toBe(true);
    expect(await h.db.rpc("order_message_count", { p_order: o.orderId })).toEqual({ sent: 5, skipped: 1, cap: 4 });
  });
});
