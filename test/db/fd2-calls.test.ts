// Session FD2, migration 0250: staff call the place ahead; the rider buys at the counter with a float; the shift balance. On the real
// migrations and the seeded test place. docs/DECISIONS.md, "FD2, 18 November 2026". Invented people and numbers only.
//   1. A confirmed food order makes one call task. No rider is offered the job until staff record the place accepted.
//   2. Item missing: the customer is asked, never swapped; their tap keeps the rest or cancels. Closed: cancelled, the place closed today.
//      Price changed: lower is applied; higher waits for the customer's own tap.
//   3. The float: given, paid to the place with the receipt, returned; the end-of-shift balance shows any difference; the ledger balances.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let picker: string; let place: string; let baakline: string; let rider: string;
let tester: { party: string; conv: string; pin: string };
let falafel: string; let taouk: string; let fries: string;
let seq = 0;

const customer = async (phone: string) => {
  seq++;
  const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`FD2 call customer ${seq}`])).id as string;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'customer', $2, $3)`, [party, `wa-fd2c-${seq}`, phone]);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id as string;
  await db.pg.query(`insert into consent_events(party_id, line, kind, action, source, wording) values ($1, 'customer', 'transactional', 'opt_in', 'test', 'fd2')`, [party]);
  await db.rpc("set_tester", { p_by: lead, p_phone: phone, p_on: true });
  const pin = (await db.rpc("save_customer_pin", { p_party: party, p_lat: 33.67739, p_lng: 35.56355, p_village: baakline })).place_id as string;
  return { party, conv, pin };
};
const dish = async (name: string) => (await db.one(`select id from products where owner_source_id = $1 and name_en = $2`, [place, name])).id as string;
const option = async (product: string, name: string) =>
  (await db.one(`select o.id from dish_options o join dish_option_groups g on g.id = o.group_id where g.product_id = $1 and o.name_en = $2`, [product, name])).id as string;
const status = async (order: string) => (await db.one(`select status::text s from orders where id = $1`, [order])).s as string;
const callOf = async (order: string) => db.one(`select * from place_calls where order_id = $1`, [order]);
let wamid = 0;
async function confirmedOrder(lines: unknown[]) {
  const r = await db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv, p_lines: lines,
    p_village: baakline, p_place: tester.pin, p_pickup: false });
  expect(r.created).toBe(true);
  const c = await db.rpc("confirm_order_checked", { p_order: r.order_id, p_party: tester.party, p_wamid: `wamid.fd2c.${++wamid}` });
  expect(c.status).toBe("confirmed");
  return r.order_id as string;
}

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89500, now() - interval '1 day')`);
  await db.pg.query(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  place = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Picker') returning id`)).id;
  await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "00:00", close: "00:00" } } });
  baakline = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'FD2 rider') returning id`)).id;
  await db.rpc("start_shift", { p_driver: rider });
  tester = await customer("+96170000401");
  falafel = await dish("Falafel sandwich"); taouk = await dish("Taouk plate"); fries = await dish("French fries");
}, 180_000);

describe("1 the call ahead", () => {
  it("a confirmed food order makes one call task; no rider is offered until the place accepted", async () => {
    const order = await confirmedOrder([{ product_id: falafel, qty: 2 }]);
    const call = await callOf(order);
    expect(call).toMatchObject({ status: "to_call", source_id: place });
    const list = await db.rpc("food_calls_console", {});
    const row = list.find((x: any) => x.order_id === order);
    expect(row).toMatchObject({ place: "Alo King test kitchen", phone: "+96100000090", status: "to_call" });
    expect(row.items.map((i: any) => [i.name, Number(i.qty)])).toEqual([["Falafel sandwich", 2]]);
    expect(await db.rpc("dispatch_order", { p_order: order })).toMatchObject({ status: "waiting_for_place", short_code: row.short_code });
    await expect(db.rpc("food_call_accept", { p_call: call.id, p_by: picker, p_ready_in_min: 15 })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("food_call_accept", { p_call: call.id, p_by: lead, p_ready_in_min: 500 })).rejects.toThrow(/READY_IN/);
    const a = await db.rpc("food_call_accept", { p_call: call.id, p_by: lead, p_ready_in_min: 15 });
    expect(a.notice).toBe("accepted");
    expect(a.eta_minutes).toBe(15 + a.ride_min);
    expect(await status(order)).toBe("preparing");
    const d = await db.rpc("dispatch_order", { p_order: order });
    expect(d.status).not.toBe("waiting_for_place");
    await expect(db.rpc("food_call_accept", { p_call: call.id, p_by: lead, p_ready_in_min: 15 })).rejects.toThrow(/CALL_ALREADY_ACCEPTED/);
    expect((await db.all(`select action from place_call_log where call_id = $1 order by id`, [call.id])).map((x: any) => x.action)).toEqual(["created", "accepted"]);
    await expect(db.pg.query(`delete from place_call_log where call_id = $1`, [call.id])).rejects.toThrow(/append-only/);
  });

  it("a grocery order makes no call", async () => {
    const hub = (await db.one(`select p.id from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id where s.kind = 'dark_store' and o.price_usd > 5 order by p.sku limit 1`)).id;
    await db.pg.query(`update stock_levels set on_hand = 50 where product_id = $1`, [hub]);
    const order = await confirmedOrder([{ product_id: hub, qty: 1 }]);
    expect(await callOf(order)).toBeUndefined();
  });
});

describe("2 what staff find on the phone", () => {
  it("an item missing: the customer is asked; keeping the rest drops the line and recounts; staff call again", async () => {
    const order = await confirmedOrder([{ product_id: falafel, qty: 2 }, { product_id: fries, qty: 1 }]);
    const call = await callOf(order);
    const items = (await db.rpc("food_calls_console", {})).find((x: any) => x.order_id === order).items;
    const friesItem = items.find((i: any) => i.name === "French fries").item_id;
    const r = await db.rpc("food_call_item_missing", { p_call: call.id, p_by: lead, p_item: friesItem });
    expect(r).toMatchObject({ notice: "item_missing", status: "waiting_customer", pending: { kind: "item_missing", name: "French fries" } });
    await expect(db.rpc("food_call_accept", { p_call: call.id, p_by: lead, p_ready_in_min: 10 })).rejects.toThrow(/CUSTOMER_ASKED/);
    expect(await db.rpc("dispatch_order", { p_order: order })).toMatchObject({ status: "waiting_for_place" });
    expect((await db.rpc("food_call_waiting", { p_party: tester.party })).call_id).toBe(call.id);
    const before = Number((await db.one(`select total_usd from orders where id = $1`, [order])).total_usd);
    // someone else's tap does nothing; a wrong answer is refused
    const other = await customer("+96170000402");
    expect(await db.rpc("food_call_answer", { p_call: call.id, p_party: other.party, p_answer: "drop" })).toMatchObject({ ok: false, reason: "not_found" });
    await expect(db.rpc("food_call_answer", { p_call: call.id, p_party: tester.party, p_answer: "accept" })).rejects.toThrow(/ANSWER_INVALID/);
    const a = await db.rpc("food_call_answer", { p_call: call.id, p_party: tester.party, p_answer: "drop" });
    expect(a).toMatchObject({ ok: true, answer: "drop" });
    expect(Number(a.total_usd)).toBe(before - 2);
    expect((await db.one(`select status from order_items where id = $1`, [friesItem])).status).toBe("removed");
    expect((await callOf(order)).status).toBe("to_call");
    expect(await db.rpc("food_call_answer", { p_call: call.id, p_party: tester.party, p_answer: "drop" })).toMatchObject({ ok: false, reason: "not_waiting" });
    await db.rpc("food_call_accept", { p_call: call.id, p_by: lead, p_ready_in_min: 10 });
    expect(await status(order)).toBe("preparing");
  });

  it("an item missing: the customer may cancel the order instead", async () => {
    const order = await confirmedOrder([{ product_id: falafel, qty: 2 }]);
    const call = await callOf(order);
    const item = (await db.one(`select id from order_items where order_id = $1`, [order])).id;
    await db.rpc("food_call_item_missing", { p_call: call.id, p_by: lead, p_item: item });
    expect(await db.rpc("food_call_answer", { p_call: call.id, p_party: tester.party, p_answer: "cancel" })).toMatchObject({ ok: true, answer: "cancelled" });
    expect(await status(order)).toBe("cancelled");
    expect((await callOf(order)).status).toBe("cancelled");
  });

  it("closed: the order is cancelled and the place is closed for the rest of the day", async () => {
    const order = await confirmedOrder([{ product_id: falafel, qty: 2 }]);
    const call = await callOf(order);
    const r = await db.rpc("food_call_closed", { p_call: call.id, p_by: lead });
    expect(r.notice).toBe("closed");
    expect(await status(order)).toBe("cancelled");
    const q = await db.rpc("quote_order", { p_lines: [{ product_id: falafel, qty: 2 }], p_village: baakline, p_pickup: false, p_slot: null, p_party: tester.party });
    expect(q.issues.find((i: any) => i.code === "place_closed")).toMatchObject({ reason: "closed_today" });
    await db.pg.query(`update sources set closed_on = null where id = $1`, [place]);
  });

  it("a price changed: lower is applied and said; higher waits for the customer's own tap", async () => {
    const order = await confirmedOrder([{ product_id: taouk, qty: 1, options: [await option(taouk, "Garlic")] }]);
    const call = await callOf(order);
    const item = (await db.one(`select id from order_items where order_id = $1`, [order])).id;
    const total0 = Number((await db.one(`select total_usd from orders where id = $1`, [order])).total_usd);
    await expect(db.rpc("food_call_price", { p_call: call.id, p_by: lead, p_item: item, p_unit_usd: 0 })).rejects.toThrow(/PRICE_INVALID/);
    const lower = await db.rpc("food_call_price", { p_call: call.id, p_by: lead, p_item: item, p_unit_usd: 7.5 });
    expect(lower.notice).toBe("price_lower");
    expect(Number(lower.total_usd)).toBe(total0 - 0.5);
    const up = await db.rpc("food_call_price", { p_call: call.id, p_by: lead, p_item: item, p_unit_usd: 9 });
    expect(up).toMatchObject({ notice: "price_up", status: "waiting_customer" });
    expect(Number(up.pending.total_now)).toBe(total0 + 1);
    expect(Number((await db.one(`select total_usd from orders where id = $1`, [order])).total_usd)).toBe(total0 - 0.5);   // nothing changed yet
    const a = await db.rpc("food_call_answer", { p_call: call.id, p_party: tester.party, p_answer: "accept" });
    expect(Number(a.total_usd)).toBe(total0 + 1);
    expect((await callOf(order)).status).toBe("to_call");
  });

  it("a price up the customer declines cancels the order", async () => {
    const order = await confirmedOrder([{ product_id: falafel, qty: 2 }]);
    const call = await callOf(order);
    const item = (await db.one(`select id from order_items where order_id = $1`, [order])).id;
    await db.rpc("food_call_price", { p_call: call.id, p_by: lead, p_item: item, p_unit_usd: 3 });
    expect(await db.rpc("food_call_answer", { p_call: call.id, p_party: tester.party, p_answer: "cancel" })).toMatchObject({ answer: "cancelled" });
    expect(await status(order)).toBe("cancelled");
  });
});

describe("3 the rider buys at the counter", () => {
  it("float given, paid to the place with the receipt, cash at the door, float returned: the shift balance and the ledger", async () => {
    const order = await confirmedOrder([{ product_id: falafel, qty: 2 }]);
    const call = await callOf(order);
    await db.rpc("food_call_accept", { p_call: call.id, p_by: lead, p_ready_in_min: 10 });
    await expect(db.rpc("rider_float_give", { p_rider: rider, p_by: picker, p_amount_usd: 20 })).rejects.toThrow(/NOT_AUTHORISED|ROLE/);
    await expect(db.rpc("rider_float_give", { p_rider: rider, p_by: lead, p_amount_usd: 500 })).rejects.toThrow(/FLOAT_OVER_MAX/);
    expect((await db.rpc("rider_float_give", { p_rider: rider, p_by: lead, p_amount_usd: 20 })).float_usd).toBe(20);
    await expect(db.rpc("rider_paid_place", { p_order: order, p_rider: rider, p_by: lead, p_amount_usd: 5, p_receipt_path: null })).rejects.toThrow(/RECEIPT_REQUIRED/);
    await expect(db.rpc("rider_paid_place", { p_order: order, p_rider: rider, p_by: lead, p_amount_usd: 5, p_receipt_path: `food-receipts/${order}/../x.jpg` })).rejects.toThrow(/RECEIPT_REQUIRED/);
    // the place charged 5.50 for 5.00 of food: the difference shows; nothing is deducted from anyone
    const paid = await db.rpc("rider_paid_place", { p_order: order, p_rider: rider, p_by: lead, p_amount_usd: 5.5, p_receipt_path: `food-receipts/${order}/r1.jpg` });
    expect(paid).toMatchObject({ ok: true, float_usd: 14.5, difference_usd: 0.5 });
    await expect(db.rpc("rider_paid_place", { p_order: order, p_rider: rider, p_by: lead, p_amount_usd: 5.5, p_receipt_path: `food-receipts/${order}/r2.jpg` })).rejects.toThrow(/ALREADY_RECORDED/);
    const total = Number((await db.one(`select total_usd from orders where id = $1`, [order])).total_usd);
    await db.rpc("post_cod_collection", { p_order: order, p_driver: rider, p_usd: total, p_lbp: 0 });
    await expect(db.rpc("rider_float_return", { p_rider: rider, p_by: lead, p_amount_usd: 50 })).rejects.toThrow(/RETURN_OVER_FLOAT/);
    await db.rpc("rider_float_return", { p_rider: rider, p_by: lead, p_amount_usd: 14.5 });
    const b = await db.rpc("rider_shift_balance", { p_rider: rider });
    expect(b.float).toEqual({ given_usd: 20, paid_to_places_usd: 5.5, returned_usd: 14.5, held_usd: 0, expected_held_usd: 0 });
    expect(b.cash.collected_usd).toBe(total);
    const row = b.orders.find((o: any) => o.order_id === order);
    expect(row).toMatchObject({ owed_usd: 5, paid_usd: 5.5, difference_usd: 0.5, place: "Alo King test kitchen" });
    expect(b.differences).toBeGreaterThanOrEqual(1);
    // the place's account: owed 5 (credited at the door), paid 5.50 (debited at the counter): 0.50 the rider paid over, visible
    const payable = Number((await db.one(`select coalesce(sum(e.usd_equiv), 0) s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = $1 and e.order_id = $2`, [`merchant_payable:${place}`, order])).s);
    expect(payable).toBe(0.5);
    const unbalanced = await db.all(`select txn_id from ledger_entries group by txn_id having sum(usd_equiv) <> 0`);
    expect(unbalanced).toEqual([]);
    expect((await db.rpc("riders_float_console", {})).some((x: any) => x.rider_id === rider)).toBe(true);
  });

  it("only a food order, confirmed, takes a counter payment", async () => {
    const r = await db.rpc("create_order_from_quote", { p_customer: tester.party, p_conversation: tester.conv, p_lines: [{ product_id: fries, qty: 3 }],
      p_village: baakline, p_place: tester.pin, p_pickup: false });
    await expect(db.rpc("rider_paid_place", { p_order: r.order_id, p_rider: rider, p_by: lead, p_amount_usd: 6, p_receipt_path: `food-receipts/${r.order_id}/r.jpg` }))
      .rejects.toThrow(/ORDER_NOT_CONFIRMED/);
  });
});
