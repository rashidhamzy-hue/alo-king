// Build plan 2.10: a rider who cannot continue. Ops marks the rider off on the ops line; each open delivery is re-offered;
// goods on the road go to another rider from the hub (or are called off and counted back in); the cash the rider holds is
// handed over with a count; the first rider's exposure and earnings stay correct. On the real schema.
import { beforeAll, describe, expect, it } from "vitest";
import { balance, expectBooksBalanced, openHub, placeOrder, status, total, type Hub, type Placed } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>; let WATER: string; let COFFEE: string;
let R1: string; let R2: string;
const cash = async (r: string) => Number(await h.db.rpc("driver_cash_usd", { p_driver: r }));
const pending = async (r: string) => Number(await h.db.rpc("driver_pending_cod_usd", { p_driver: r }));
const earnings = async (r: string) => Number(await h.db.rpc("rider_earnings_usd", { p_driver: r }));
const fee = async (o: Placed) => Number((await h.db.one(`select delivery_fee_usd from orders where id = $1`, [o.orderId])).delivery_fee_usd);

beforeAll(async () => {
  h = await openHub({ riders: 2, pickerOnOps: false });
  line = opsLine(h);
  [R1, R2] = h.riders as [string, string];
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
}, 120_000);

describe("a rider who cannot continue, with one order delivered and one on board (2.10)", () => {
  let a: Placed; let b: Placed;

  it("the first rider takes a batch of two, delivers one and collects its cash", async () => {
    await line.text(PHONES.rider(0), "حاضر");
    a = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    b = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    const d = await h.db.rpc("dispatch_order", { p_order: a.orderId });
    expect(d.orders).toEqual([a.orderId, b.orderId]);
    await line.tap(PHONES.rider(0), `job:accept:${d.delivery_id}`);
    await line.tap(PHONES.rider(0), `job:picked:${d.delivery_id}`);
    await line.tap(PHONES.rider(0), `stop:delivered:${a.orderId}`);
    await line.tap(PHONES.rider(0), `stop:exact:${a.orderId}`);
    expect(await status(h, a.orderId)).toBe("closed");
    expect(await status(h, b.orderId)).toBe("out_for_delivery");
    expect(await cash(R1)).toBeCloseTo(await total(h, a.orderId), 2);
    expect(await pending(R1)).toBeCloseTo(await total(h, b.orderId), 2);
  });

  it("the ops lead lists the riders on shift and confirms", async () => {
    await line.text(PHONES.rider(1), "حاضر");                                // a second rider comes on shift
    await line.text(PHONES.ops, "سائقين");
    const rows = line.to(h.ops).filter((m) => m.buttons.some((x) => x.startsWith("roff:ask:")));
    expect(rows.map((m) => m.buttons[0])).toEqual([`roff:ask:${R1}`, `roff:ask:${R2}`]);
    await line.tap(PHONES.ops, `roff:ask:${R1}`);
    expect(line.lastButtons(h.ops)).toEqual([`roff:yes:${R1}`]);
  });

  it("marked off: shift ended, the order on board transferred and offered to the second rider from the hub; everyone told", async () => {
    await line.tap(PHONES.ops, `roff:yes:${R1}`);
    expect(await h.db.one(`select ended_at is not null as ended from driver_shifts where driver_id = $1 order by started_at desc limit 1`, [R1])).toEqual({ ended: true });
    const summary = line.to(h.ops).at(-1)!;
    expect(summary.body).toContain(`#${b.code}`);
    expect(summary.buttons).toEqual([`roff:back:${b.orderId}`, `roff:cash:${R1}`]);
    expect(line.to(R1).at(-1)!.body).toContain("وقّفنا طلباتك");
    expect(line.to(b.customer).at(-1)!.body).toContain("رح يتأخّر");
    // the second rider has the offer, with the pickup at the hub
    const accept = line.lastButtons(R2).find((x) => x.startsWith("job:accept:"))!;
    const job = await h.db.rpc("rider_job", { p_delivery: accept.split(":")[2] });
    expect(job.stops.map((s: any) => [s.kind, s.source_id ?? s.order_id])).toEqual([["pickup", h.hub], ["dropoff", b.orderId]]);
  });

  it("the first rider's exposure is only the cash they hold, and they can no longer act on the transferred order", async () => {
    expect(await pending(R1)).toBe(0);
    expect(Number(await h.db.rpc("driver_exposure_usd", { p_driver: R1 }))).toBeCloseTo(await total(h, a.orderId), 2);
    await expect(h.db.rpc("rider_delivered", { p_order: b.orderId, p_driver: R1 })).rejects.toThrow(/NOT_YOUR_ORDER/);
    const jobs = (await h.db.all(`select 1 from deliveries`)).length;
    expect((await h.db.rpc("dispatch_order", { p_order: b.orderId })).status).not.toBe("offered");   // offered once, not twice
    expect((await h.db.all(`select 1 from deliveries`)).length).toBe(jobs);
  });

  it("the second rider delivers; the fee goes to whoever delivered; the first rider's cash is handed over with a count", async () => {
    const accept = line.lastButtons(R2).find((x) => x.startsWith("job:accept:"))!;
    await line.tap(PHONES.rider(1), accept);
    await line.tap(PHONES.rider(1), `job:picked:${accept.split(":")[2]}`);
    await line.tap(PHONES.rider(1), `stop:delivered:${b.orderId}`);
    await line.tap(PHONES.rider(1), `stop:exact:${b.orderId}`);
    expect(await status(h, b.orderId)).toBe("closed");
    expect(await earnings(R1)).toBeCloseTo(await fee(a), 2);
    expect(await earnings(R2)).toBeCloseTo(await fee(b), 2);
    expect(await cash(R2)).toBeCloseTo(await total(h, b.orderId), 2);

    const till = await balance(h, "hub_cash");
    await line.tap(PHONES.ops, `roff:cash:${R1}`);
    expect(await cash(R1)).toBe(0);
    expect(await balance(h, "hub_cash")).toBeCloseTo(till + await total(h, a.orderId), 2);
    expect(await h.db.rpc("rider_statement", { p_driver: R1 })).toMatchObject({ cash_held_usd: 0 });
    await expectBooksBalanced(h);
  });
});

describe("a job not yet picked up, and an order called off (2.10)", () => {
  it("an accepted job not yet picked up is cancelled and its order waits for the next rider", async () => {
    const c = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    const d = await h.db.rpc("dispatch_order", { p_order: c.orderId });
    expect(d.driver_id).toBe(R2);
    await h.db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: R2, p_accept: true });
    const r = await h.db.rpc("mark_rider_off", { p_driver: R2, p_by: h.ops });
    expect(r.requeued.map((x: any) => x.order_id)).toEqual([c.orderId]);
    expect(r.stranded).toEqual([]);
    expect((await h.db.one(`select status from deliveries where id = $1`, [d.delivery_id])).status).toBe("cancelled");
    expect(await h.db.rpc("orders_waiting_for_rider", {})).toContain(c.orderId);
    expect(await status(h, c.orderId)).toBe("confirmed");
    expect((await h.db.rpc("mark_rider_off", { p_driver: R2, p_by: h.ops })).already).toBe(true);     // a second tap records nothing
    expect((await h.db.one(`select count(*) n from rider_incidents where driver_id = $1`, [R2])).n).toBe(1);
    await h.db.rpc("transition_order", { p_order: c.orderId, p_to: "cancelled", p_actor: "ops", p_actor_id: h.ops, p_reason: "test cleanup" });
  });

  it("a paid order on board is called off: no charge, its money owed back as credit, the goods counted back in", async () => {
    await line.text(PHONES.rider(0), "حاضر");
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }], "whish");
    const paid = await total(h, o.orderId);
    const d = await h.db.rpc("dispatch_order", { p_order: o.orderId });
    await h.db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: R1, p_accept: true });
    await h.db.rpc("rider_picked_up", { p_delivery: d.delivery_id, p_driver: R1 });
    // From here the hub has a picker on the ops line (it receives the return button). A picker cannot mark a rider off.
    await h.db.pg.exec(`insert into party_identities(party_id, line, phone_e164) values ('${h.picker}', 'ops', '${PHONES.picker}')`);
    await line.text(PHONES.picker, "سائقين");
    expect(line.to(h.picker).at(-1)!.body).toContain("للإدارة");
    await line.text(PHONES.ops, "سائقين");
    await line.tap(PHONES.ops, `roff:yes:${R1}`);
    expect(await h.db.rpc("orders_waiting_for_rider", {})).toContain(o.orderId);       // nobody on shift: it waits

    await line.tap(PHONES.ops, `roff:back:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("failed_delivery");
    expect(Number(await h.db.rpc("customer_credit_usd", { p_party: o.customer }))).toBeCloseTo(paid, 2);
    expect(Number(await h.db.rpc("customer_dues_usd", { p_customer: o.customer }))).toBe(0);
    expect(line.to(o.customer).at(-1)!.body).toContain("ظرف طارئ");
    expect(line.lastButtons(h.picker)).toEqual([`ret:open:${o.orderId}`]);
    await line.tap(PHONES.picker, `ret:default:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("closed");
    await line.tap(PHONES.ops, `roff:back:${o.orderId}`);                       // a late second tap changes nothing
    expect(line.to(h.ops).at(-1)!.body).toContain(`#${o.code}`);
    await expectBooksBalanced(h);
  });
});
