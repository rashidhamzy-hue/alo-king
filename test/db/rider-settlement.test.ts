// Acceptance test for the rider pay model: riders keep 100% of delivery fees and tips, the company pays no wage.
// Follows the money for one rider through a shift where one customer pays entirely in lira and one pays in dollars
// by transfer, to the point where the rider has handed over the hub's share and every account is settled.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let village: string; let ops: string; let rider: string;
const FX = 89500;
const bal = async (code: string) => Number((await db.one(
  `select coalesce(sum(e.usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = $1`, [code])).s);

async function placeOrder(n: number, payment: "cod" | "whish") {
  const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-s${n}`, p_phone: `+9617010000${n}`, p_name: `Customer ${n}` });
  await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: village });
  const place = (await db.one(`select id from customer_places where party_id = $1`, [t.party_id])).id;
  const prod = (await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: t.party_id, p_conversation: t.conversation_id, p_lines: [{ product_id: prod, qty: 12 }],
    p_village: village, p_place: place, p_pickup: false, p_payment: payment, p_change_for: null, p_notes: null });
  await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: t.party_id, p_wamid: `w-s${n}` });
  const row = await db.one(`select total_usd, delivery_fee_usd, subtotal_usd from orders where id = $1`, [o.order_id]);
  return { id: o.order_id as string, total: Number(row.total_usd), fee: Number(row.delivery_fee_usd), goods: Number(row.subtotal_usd) };
}
async function deliver(orderId: string) {
  const d = await db.rpc("dispatch_order", { p_order: orderId });
  expect(d.status).toBe("offered");
  await db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: rider, p_accept: true });
  await db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: rider });
  return db.rpc("rider_delivered", { p_order: orderId, p_driver: rider });
}

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (${FX});
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 500;`);
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [village]);
  ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`)).id;
  rider = (await db.one(`insert into parties(role, display_name) values ('driver', 'Rami') returning id`)).id;
  await db.rpc("start_shift", { p_driver: rider });
}, 120_000);

describe("rider settlement: fees and tips belong to the rider, in whatever currency the customer paid", () => {
  let cod: Awaited<ReturnType<typeof placeOrder>>, prepaid: Awaited<ReturnType<typeof placeOrder>>;
  let lbpCollected = 0, lbpKept = 0;

  it("customer pays the whole order in lira: the rider holds lira, and the fee is owed to the rider, not booked as revenue", async () => {
    cod = await placeOrder(1, "cod");
    await deliver(cod.id);
    lbpCollected = Math.round((cod.total * FX) / 1000) * 1000;
    await db.rpc("rider_collect", { p_order: cod.id, p_driver: rider, p_usd: 0, p_lbp: lbpCollected });

    const cash = await db.one(`select * from driver_cash_native($1)`, [rider]);
    expect(Number(cash.usd)).toBe(0); expect(Number(cash.lbp)).toBe(lbpCollected);
    const st = await db.rpc("rider_statement", { p_driver: rider });
    expect(Number(st.earnings_usd)).toBe(cod.fee);
    expect(await bal("revenue_delivery")).toBe(0);                    // the delivery fee never stays in company revenue
    expect(await bal("revenue_goods")).toBeCloseTo(-cod.goods, 2);    // the goods do
  });

  it("a prepaid order: the company already holds the fee, so it owes it to the rider who delivered", async () => {
    prepaid = await placeOrder(2, "whish");
    await db.rpc("confirm_payment", { p_order: prepaid.id, p_by: ops, p_external_ref: "WH-552201", p_amount_usd: prepaid.total });
    const r = await deliver(prepaid.id);
    expect(r).toMatchObject({ paid: true, needs_cash: false });
    expect((await db.one(`select status from orders where id = $1`, [prepaid.id])).status).toBe("closed");
    expect(Number((await db.rpc("rider_statement", { p_driver: rider })).earnings_usd)).toBeCloseTo(cod.fee + prepaid.fee, 2);
    expect(await bal("revenue_delivery")).toBe(0);
  });

  it("end of shift: the rider keeps their earnings out of the lira they carry and hands the rest to the hub", async () => {
    const earned = cod.fee + prepaid.fee;
    await expect(db.rpc("pay_rider_earnings", { p_driver: rider, p_by: rider })).rejects.toThrow(/NOT_AUTHORISED/);
    const paid = await db.rpc("pay_rider_earnings", { p_driver: rider, p_by: ops });
    lbpKept = Number(paid.kept_lbp);
    expect(Number(paid.kept_usd)).toBe(0);                            // the rider had no dollars
    expect(lbpKept).toBe(Math.round((earned * FX) / 1000) * 1000);    // so the earnings come out of the lira, to the nearest 1,000
    expect(Number(paid.paid_from_hub_usd)).toBe(0);                   // and the hub till pays nothing
    expect(Number(paid.to_hand_over_lbp)).toBe(lbpCollected - lbpKept);
    expect(Number((await db.rpc("rider_statement", { p_driver: rider })).earnings_usd)).toBe(0);
    expect((await db.rpc("pay_rider_earnings", { p_driver: rider, p_by: ops })).kept_from_cash_usd).toBe(0);   // paying twice pays nothing

    const drop = await db.rpc("declare_cash_drop", { p_driver: rider, p_method: "hub", p_usd: 0, p_lbp: lbpCollected - lbpKept, p_receipt_ref: null });
    await db.rpc("confirm_cash_drop", { p_drop: drop, p_by: ops });
    const cash = await db.one(`select * from driver_cash_native($1)`, [rider]);
    expect(Number(cash.usd)).toBe(0); expect(Number(cash.lbp)).toBe(0);
    expect((await db.rpc("close_shift", { p_driver: rider })).closed).toBe(true);
  });

  it("the books reconcile: nothing unexplained, the hub holds exactly the company's share", async () => {
    expect(Number((await db.one(`select coalesce(sum(usd_equiv), 0) as s from ledger_entries`)).s)).toBeCloseTo(0, 2);
    const perTxn = await db.all(`select txn_id from ledger_entries group by txn_id having abs(sum(usd_equiv)) > 0.005`);
    expect(perTxn).toEqual([]);                                       // every single transaction balances on its own
    expect(await bal(`driver_cash:${rider}`)).toBeCloseTo(0, 2);
    expect(await bal(`rider_payable:${rider}`)).toBeCloseTo(0, 2);
    expect(await bal("revenue_delivery")).toBe(0);
    // lira from the COD order, less the rider's two fees, is what reached the hub; the prepaid order's money sits in the Whish account
    expect(await bal("hub_cash")).toBeCloseTo(cod.total - cod.fee - prepaid.fee, 1);
    expect(await bal("whish_clearing")).toBeCloseTo(prepaid.total, 2);
    expect(await bal("revenue_goods")).toBeCloseTo(-(cod.goods + prepaid.goods), 2);
  });
});
