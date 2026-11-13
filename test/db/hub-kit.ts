// Shared rig for the hub tests (session C2): a database with every migration and seed, the clock open, an exchange rate,
// stock on the shelf, the hub in Baakline, staff parties, and short helpers that walk an order through the real SQL.
import { openTestDb, type TestDb } from "./harness";

export interface Hub {
  db: TestDb; village: string; hub: string; ops: string; picker: string; riders: string[];
  product: (nameEn: string) => Promise<string>;
}

let customers = 0;

export async function openHub(opts: { riders?: number; pickerOnOps?: boolean } = {}): Promise<Hub> {
  const db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 50;`);
  const village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  const hub = (await db.one(`update sources set village_id = $1 where kind = 'dark_store' returning id`, [village])).id;
  const ops = (await db.one(`insert into parties(role, display_name) values ('ops_lead', 'Hussein') returning id`)).id;
  await db.pg.exec(`insert into party_identities(party_id, line, phone_e164) values ('${ops}', 'ops', '+96171000001')`);
  const picker = (await db.one(`insert into parties(role, display_name) values ('picker', 'Rana') returning id`)).id;
  if (opts.pickerOnOps !== false) await db.pg.exec(`insert into party_identities(party_id, line, phone_e164) values ('${picker}', 'ops', '+96171000002')`);
  const riders: string[] = [];
  for (let i = 0; i < (opts.riders ?? 1); i++) {
    const r = (await db.one(`insert into parties(role, display_name) values ('driver', $1) returning id`, [`Rider${i + 1}`])).id;
    await db.pg.exec(`insert into party_identities(party_id, line, phone_e164) values ('${r}', 'ops', '+9617111110${i}')`);
    riders.push(r);
  }
  return { db, village, hub, ops, picker, riders, product: async (n) => (await db.one(`select id from products where name_en = $1`, [n])).id };
}

export interface Placed { orderId: string; customer: string; conversation: string; code: string }

/** A new customer (consented by confirming) places and confirms an order. COD confirms; a transfer waits for payment. */
export async function placeOrder(h: Hub, lines: { product_id: string; qty: number }[], payment: "cod" | "whish" = "cod", customer?: { party: string; conversation: string }): Promise<Placed> {
  const { db } = h;
  let c = customer;
  if (!c) {
    const n = ++customers;
    const t = await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-hub-${n}`, p_phone: `+9617000${String(n).padStart(4, "0")}`, p_name: `Customer ${n}` });
    await db.rpc("save_customer_pin", { p_party: t.party_id, p_lat: 33.68, p_lng: 35.56, p_village: h.village });
    c = { party: t.party_id, conversation: t.conversation_id };
  }
  const place = (await db.one(`select id from customer_places where party_id = $1 limit 1`, [c.party])).id;
  const o = await db.rpc("create_order_from_quote", { p_customer: c.party, p_conversation: c.conversation, p_lines: lines,
    p_village: h.village, p_place: place, p_pickup: false, p_payment: payment, p_change_for: null, p_notes: null });
  if (!o.created) throw new Error("order not created: " + JSON.stringify(o.quote.issues));
  await db.rpc("confirm_order_checked", { p_order: o.order_id, p_party: c.party, p_wamid: `w-${o.order_id}` });
  if (payment !== "cod") {
    const total = Number((await db.one(`select total_usd from orders where id = $1`, [o.order_id])).total_usd);
    await db.rpc("confirm_payment", { p_order: o.order_id, p_by: h.ops, p_external_ref: `WH-${o.short_code}`, p_amount_usd: total });
  }
  return { orderId: o.order_id, customer: c.party, conversation: c.conversation, code: o.short_code };
}

export const status = async (h: Hub, orderId: string) => (await h.db.one(`select status from orders where id = $1`, [orderId])).status as string;
export const total = async (h: Hub, orderId: string) => Number((await h.db.one(`select total_usd from orders where id = $1`, [orderId])).total_usd);
export const balance = async (h: Hub, code: string) => Number((await h.db.one(
  `select coalesce(sum(e.usd_equiv), 0) as s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = $1`, [code])).s);
export const stock = async (h: Hub, productId: string) => {
  const r = await h.db.one(`select on_hand, reserved from stock_levels where source_id = $1 and product_id = $2`, [h.hub, productId]);
  return { onHand: Number(r.on_hand), reserved: Number(r.reserved) };
};

/** Rider takes the order to the door through the real rider functions. Returns the delivery id. */
export async function deliverToDoor(h: Hub, orderId: string, rider = h.riders[0]!): Promise<string> {
  const { db } = h;
  await db.rpc("start_shift", { p_driver: rider });
  const d = await db.rpc("dispatch_order", { p_order: orderId });
  const delivery = d.delivery_id ?? (await db.one(`select s.delivery_id from delivery_stops s join deliveries d on d.id = s.delivery_id
     where s.order_id = $1 and d.status in ('offered','accepted','in_progress') limit 1`, [orderId])).delivery_id;
  await db.rpc("rider_respond", { p_delivery: delivery, p_driver: rider, p_accept: true });
  const p = await db.rpc("rider_picked_up", { p_delivery: delivery, p_driver: rider });
  if (p.ok === false) throw new Error("pickup refused: " + JSON.stringify(p));
  await db.rpc("rider_delivered", { p_order: orderId, p_driver: rider });
  return delivery;
}

/** Cash counted at the door: exactly the order's total in dollars. */
export async function collect(h: Hub, orderId: string, rider = h.riders[0]!): Promise<void> {
  await h.db.rpc("rider_collect", { p_order: orderId, p_driver: rider, p_usd: await total(h, orderId), p_lbp: 0 });
}

export async function expectBooksBalanced(h: Hub): Promise<void> {
  const off = await h.db.all(`select txn_id from ledger_entries group by txn_id having abs(sum(usd_equiv)) > 0.005`);
  if (off.length) throw new Error(`unbalanced transactions: ${JSON.stringify(off)}`);
  const s = Number((await h.db.one(`select coalesce(sum(usd_equiv), 0) as s from ledger_entries`)).s);
  if (Math.abs(s) > 0.005) throw new Error(`ledger sums to ${s}`);
}
