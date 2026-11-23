// Session TEST1 (the friends' test mode), migration 0271, on the real migrations and the seeded test place. docs/DECISIONS.md, "TEST1".
//   1. One setting, test_mode.enabled, that this database refuses unless it is marked as staging.
//   2. Only testers pass the gate; the probe keeps its path; everyone else is "not open yet" (the gateway's words).
//   3. A tester orders at any hour, with no stock; a stranger's rules are unchanged; a pin outside the area takes the nearest zone.
//   4. A test order: the customer's own tap confirms it; no stock, rider, picker, payment or ledger; it walks by itself to delivered and
//      the feedback question, and never closes. A food test order's call ahead is simulated and accepted.
//   5. Clear test orders: test orders only, logged, no cancel notice.
// Invented people and numbers only.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let lead: string; let place: string; let baakline: string; let hub: string; let hub2: string; let falafel: string;
let tester: { party: string; conv: string }; let stranger: { party: string; conv: string };
let seq = 0;

const customer = async (phone: string, tested: boolean) => {
  seq++;
  const party = (await db.one(`insert into parties(role, display_name) values ('customer', $1) returning id`, [`TEST1 customer ${seq}`])).id as string;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id, phone_e164) values ($1, 'customer', $2, $3)`, [party, `wa-test1-${seq}`, phone]);
  const conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id as string;
  await db.pg.query(`insert into consent_events(party_id, line, kind, action, source, wording) values ($1, 'customer', 'transactional', 'opt_in', 'test', 'test1')`, [party]);
  if (tested) await db.rpc("set_tester", { p_by: lead, p_phone: phone, p_on: true });
  return { party, conv };
};
const codes = (q: any) => (q.issues as { code: string }[]).map((i) => i.code);
const quote = (lines: unknown[], party: string | null) =>
  db.rpc("quote_order", { p_lines: lines, p_village: baakline, p_pickup: false, p_slot: null, p_party: party });
const status = async (id: string) => (await db.one(`select status::text s from orders where id = $1`, [id])).s as string;
const count = async (sql: string, args: unknown[] = []) => Number((await db.one(sql, args)).n);
const setMode = (on: boolean) => db.pg.query(`update settings set value = value || jsonb_build_object('enabled', $1::boolean) where key = 'test_mode'`, [on]);
/** A placed order with a pin in Baakline, waiting for the customer's own tap. */
async function card(who: { party: string; conv: string }, lines: unknown[]) {
  const pin = await db.rpc("save_customer_pin", { p_party: who.party, p_lat: 33.67739, p_lng: 35.56355, p_village: baakline });
  await db.pg.query(`update customer_places set building = 'Test building 1', floor = '2' where id = $1`, [pin.place_id]).catch(() => undefined);
  const r = await db.rpc("create_order_from_quote", { p_customer: who.party, p_conversation: who.conv, p_lines: lines, p_village: baakline,
                                                      p_place: pin.place_id, p_pickup: false });
  expect(r.created).toBe(true);
  return r.order_id as string;
}

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd, effective_from) values (89500, now() - interval '1 day')`);
  await db.pg.exec(readFileSync(new URL("../../scripts/staging/test-place.sql", import.meta.url), "utf8"));
  place = (await db.one(`select id from sources where listing_id = 'ak-test-kitchen-staging'`)).id;
  lead = (await db.one(`select id from parties where is_probe and role = 'ops_lead' limit 1`)).id;
  baakline = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  // The shop is closed all day and the hub holds nothing: a tester orders anyway, a stranger cannot.
  await db.pg.query(`update settings set value = '{"open":"03:00","close":"03:01","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
  await db.rpc("set_place_details", { p_source: place, p_by: lead, p_details: { hours: { open: "03:00", close: "03:01" } } });
  await db.pg.query(`update stock_levels set on_hand = 0, reserved = 0`);
  const hubs = await db.pg.query<{ id: string }>(`select p.id from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id
     where s.kind = 'dark_store' and p.is_active and o.price_usd between 3 and 20 order by p.sku limit 2`);
  hub = hubs.rows[0]!.id; hub2 = hubs.rows[1]!.id;
  falafel = (await db.one(`select id from products where owner_source_id = $1 and name_en = 'Falafel sandwich'`, [place])).id;
  tester = await customer("+96170000401", true);
  stranger = await customer("+96170000402", false);
  await db.pg.query(`update settings set value = value || '{"step_min_s": 0, "step_max_s": 0}'::jsonb where key = 'test_mode'`);
}, 180_000);

describe("1 the setting and its lock", () => {
  it("is off, and cannot be switched on in a database that is not marked as staging", async () => {
    expect(await db.rpc("test_mode_on")).toBe(false);
    await expect(setMode(true)).rejects.toThrow(/TEST_MODE_STAGING_ONLY/);
    await expect(db.rpc("change_setting_now", { p_key: "test_mode", p_field: "enabled", p_value: true, p_by: lead, p_reason: "try it" }))
      .rejects.toThrow();
    expect(await db.rpc("test_mode_on")).toBe(false);
  });
  it("with the staging mark (prepare-staging.sql) it switches on, and off again", async () => {
    await db.pg.exec(`insert into deployment_marker(environment) values ('staging')`);
    await expect(db.pg.exec(`insert into deployment_marker(environment) values ('production')`)).rejects.toThrow();
    await setMode(true);
    expect(await db.rpc("test_mode_on")).toBe(true);
  });
});

describe("2 the gate", () => {
  it("lets testers and the probe through, and nobody else", async () => {
    expect(await db.rpc("test_mode_gate", { p_party: tester.party })).toMatchObject({ on: true, allowed: true, tester: true });
    expect(await db.rpc("test_mode_gate", { p_party: stranger.party })).toMatchObject({ on: true, allowed: false });
    const probe = (await db.one(`insert into parties(role, display_name, is_probe) values ('customer', 'TEST1 probe', true) returning id`)).id;
    expect((await db.rpc("test_mode_gate", { p_party: probe })).allowed).toBe(true);
    await setMode(false);
    expect((await db.rpc("test_mode_gate", { p_party: stranger.party })).allowed).toBe(true);
    await setMode(true);
  });
});

describe("3 what a tester may order", () => {
  it("any hour, no stock: the tester's quote is clean, a stranger's is closed and out of stock", async () => {
    const t = await quote([{ product_id: hub, qty: 2 }], tester.party);
    expect(codes(t)).toEqual([]);
    expect(t.ok).toBe(true);
    expect(t.test_order).toBe(true);
    expect(t.subtotal_usd).toBeGreaterThan(0);
    expect(t.total_usd).toBeCloseTo(t.subtotal_usd + t.delivery_fee_usd, 2);
    const s = await quote([{ product_id: hub, qty: 2 }], stranger.party);
    expect(codes(s)).toEqual(expect.arrayContaining(["closed", "out_of_stock"]));
  });
  it("the minimum still holds, and a dish needs its place approved and visible (testers only) at any hour", async () => {
    const cheap = (await db.one(`select p.id from products p join offers o on o.product_id = p.id join sources s on s.id = o.source_id
       where s.kind = 'dark_store' and p.is_active and o.price_usd between 0.2 and 2 order by o.price_usd limit 1`)).id;
    expect(codes(await quote([{ product_id: cheap, qty: 1 }], tester.party))).toEqual(["below_minimum"]);
    expect(codes(await quote([{ product_id: falafel, qty: 3 }], tester.party))).toEqual([]);
    expect(codes(await quote([{ product_id: falafel, qty: 3 }], stranger.party))).toContain("coming_soon");
  });
  it("a pin far outside the area takes the nearest served village for a tester only", async () => {
    const far = await db.rpc("save_customer_pin", { p_party: tester.party, p_lat: 34.5, p_lng: 33.5 });     // at sea, far outside the area
    expect(far).toMatchObject({ status: "located", served: true, test_outside_area: true });
    expect(far.village_id).toBeTruthy();
    const no = await db.rpc("save_customer_pin", { p_party: stranger.party, p_lat: 34.5, p_lng: 33.5 });
    expect(no.status).toBe("outside");
  });
  it("a catalogue cart is priced for the tester (no stock, any hour)", async () => {
    const skus = await db.pg.query<{ sku: string }>(`select sku from products where id in ($1, $2) order by sku`, [hub, hub2]);
    const r = await db.rpc("plan_cart", { p_party: tester.party, p_items: skus.rows.map((x) => ({ sku: x.sku, qty: 2 })), p_village: baakline });
    expect(r.removed).toEqual([]);
    expect(r.quote.ok).toBe(true);
    expect(r.quote_lines).toHaveLength(2);
    const s = await db.rpc("plan_cart", { p_party: stranger.party, p_items: skus.rows.map((x) => ({ sku: x.sku, qty: 2 })), p_village: baakline });
    expect(s.removed.map((x: any) => x.reason)).toEqual(["out_of_stock", "out_of_stock"]);
  });
  it("the catalogue feed lists every pictured item as in stock in test mode", async () => {
    await db.pg.query(`insert into product_images(product_id, status, source_kind, licence, media_path, sha256, width_px, height_px, bytes, source_note)
       values ($1, 'approved', 'founder_upload', 'founder_supplied', 'pictures/test1/x.webp', $2, 1000, 1000, 50000, 'test1')`, [hub, "1".padStart(64, "0")]);
    const row = (await db.rpc("catalog_feed")).find((x: any) => x.product_id === hub);
    expect(row.in_stock).toBe(true);
    await setMode(false);
    expect((await db.rpc("catalog_feed")).find((x: any) => x.product_id === hub).in_stock).toBe(false);
    await setMode(true);
  });
});

describe("4 a test order", () => {
  let order: string;
  it("is marked, and only the customer's own tap confirms it; nothing is reserved and no rider is offered it", async () => {
    order = await card(tester, [{ product_id: hub, qty: 2 }]);
    expect((await db.one(`select is_test from orders where id = $1`, [order])).is_test).toBe(true);
    expect(await db.rpc("test_order_line", { p_order: order })).toBe("ar");
    await expect(db.rpc("transition_order", { p_order: order, p_to: "confirmed", p_actor: "agent" })).rejects.toThrow(/ILLEGAL_TRANSITION/);
    await expect(db.rpc("transition_order", { p_order: order, p_to: "confirmed", p_actor: "system" })).rejects.toThrow(/ILLEGAL_TRANSITION/);
    const c = await db.rpc("confirm_order_checked", { p_order: order, p_party: tester.party, p_wamid: "wamid.test1.1" });
    expect(c.status).toBe("confirmed");
    expect(await count(`select count(*) n from stock_movements where order_id = $1`, [order])).toBe(0);
    expect((await db.rpc("dispatch_order", { p_order: order })).status).toBe("test_order");
    expect(await db.rpc("orders_waiting_for_rider")).not.toContain(order);
    expect((await db.rpc("pick_queue", { p_limit: 50 })).map((x: any) => x.order_id)).not.toContain(order);
    expect(await count(`select count(*) n from place_calls where order_id = $1`, [order])).toBe(0);
  });
  it("walks by itself, one step at a time, to delivered and the feedback question; it never closes and no money moves", async () => {
    const walked: string[] = [];
    for (let i = 0; i < 8; i++) {
      const due = (await db.rpc("test_orders_due")).filter((d: any) => d.order_id === order);
      if (!due.length) break;
      expect(due).toHaveLength(1);
      expect(await db.rpc("test_order_advance", { p_order: order, p_step: due[0].step })).toBe(true);
      // until its message is marked sent, the same step comes back (the send is retried with the same key)
      expect((await db.rpc("test_orders_due")).find((d: any) => d.order_id === order)).toMatchObject({ step: due[0].step, resend: true });
      await db.rpc("test_order_step_sent", { p_order: order, p_step: due[0].step });
      walked.push(`${due[0].step}:${await status(order)}`);
    }
    expect(walked).toEqual(["preparing:preparing", "on_the_way:out_for_delivery", "at_door:arrived", "delivered:delivered", "feedback:delivered"]);
    expect((await db.one(`select asked_at is not null a from order_feedback where order_id = $1`, [order])).a).toBe(true);
    expect(await db.rpc("feedback_due")).not.toContainEqual(expect.objectContaining({ order_id: order }));
    await expect(db.rpc("transition_order", { p_order: order, p_to: "closed", p_actor: "system" })).rejects.toThrow(/TEST_ORDER_NEVER_CLOSES/);
    expect(await count(`select count(*) n from payments where order_id = $1`, [order])).toBe(0);
    expect(await count(`select count(*) n from ledger_entries where order_id = $1`, [order])).toBe(0);
    expect(await count(`select count(*) n from stock_movements where order_id = $1`, [order])).toBe(0);
    expect(await count(`select count(*) n from delivery_stops where order_id = $1`, [order])).toBe(0);
    const ev = await db.pg.query<{ actor: string; meta: any }>(`select actor::text, meta from order_events where order_id = $1 and reason = 'test_order_walk'`, [order]);
    expect(ev.rows.every((e) => e.actor === "system" && e.meta.test_order === true)).toBe(true);
  });
  it("a step taken before is not taken again", async () => {
    expect(await db.rpc("test_order_advance", { p_order: order, p_step: "preparing" })).toBe(true);
    expect(await count(`select count(*) n from order_events where order_id = $1 and to_status = 'preparing'`, [order])).toBe(1);
  });
  it("a food test order: the call ahead is simulated and accepted with the place's preparation time; nobody is asked to call", async () => {
    const food = await card(tester, [{ product_id: falafel, qty: 3 }]);
    await db.rpc("confirm_order_checked", { p_order: food, p_party: tester.party, p_wamid: "wamid.test1.2" });
    const call = await db.one(`select status, ready_in_min from place_calls where order_id = $1`, [food]);
    expect(call).toEqual({ status: "accepted", ready_in_min: 20 });
    const log = await db.pg.query<{ action: string; detail: any }>(`select action, detail from place_call_log l join place_calls c on c.id = l.call_id where c.order_id = $1 order by l.id`, [food]);
    expect(log.rows.map((r) => r.action)).toEqual(["created", "accepted"]);
    expect(log.rows[1]!.detail.simulated).toBe(true);
    const due = (await db.rpc("test_orders_due")).find((d: any) => d.order_id === food);
    expect(due).toMatchObject({ step: "preparing", food: true });
    expect(due.eta_minutes).toBeGreaterThanOrEqual(20);
  });
  it("a stranger's order is not a test order (when the stranger could order at all)", async () => {
    await setMode(false);
    await db.pg.query(`update stock_levels set on_hand = 50`);
    await db.pg.query(`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`);
    const o = await card(stranger, [{ product_id: hub, qty: 1 }, { product_id: hub2, qty: 1 }]);
    expect((await db.one(`select is_test from orders where id = $1`, [o])).is_test).toBe(false);
    await db.rpc("confirm_order_checked", { p_order: o, p_party: stranger.party, p_wamid: "wamid.test1.3" });
    expect(await count(`select count(*) n from stock_movements where order_id = $1 and reason = 'reserve'`, [o])).toBe(2);
    expect(await db.rpc("test_orders_due")).not.toContainEqual(expect.objectContaining({ order_id: o }));
    expect(await db.rpc("test_order_advance", { p_order: o, p_step: "preparing" })).toBe(false);       // the walk never touches it
    expect(await status(o)).toBe("confirmed");
    await setMode(true);
  });
});

describe("5 clearing", () => {
  it("only by staff with a reason; test orders only; logged; no cancel notice to the tester", async () => {
    const open = await card(tester, [{ product_id: hub, qty: 3 }]);
    await expect(db.rpc("clear_test_orders", { p_by: tester.party, p_reason: "done" })).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(db.rpc("clear_test_orders", { p_by: lead, p_reason: "" })).rejects.toThrow(/REASON_REQUIRED/);
    const before = await count(`select count(*) n from orders where not is_test and test_cleared_at is null`);
    const r = await db.rpc("clear_test_orders", { p_by: lead, p_reason: "end of the first friends' round" });
    expect(r.cleared).toBeGreaterThanOrEqual(3);
    expect(r.money_or_stock_rows).toBe(0);
    expect(await status(open)).toBe("cancelled");
    expect(await count(`select count(*) n from orders where is_test and test_cleared_at is null`)).toBe(0);
    expect(await count(`select count(*) n from orders where not is_test and test_cleared_at is null`)).toBe(before);
    expect((await db.rpc("customer_notices_due")).filter((n: any) => n.order_id === open)).toEqual([]);
    const log = await db.one(`select action, reason, (detail->>'count')::int c from test_mode_log order by id desc limit 1`);
    expect(log).toEqual({ action: "clear_test_orders", reason: "end of the first friends' round", c: r.cleared });
    expect(await db.rpc("test_orders_due")).toEqual([]);
  });
});
