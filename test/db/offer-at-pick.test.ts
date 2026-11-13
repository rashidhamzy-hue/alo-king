// Build plan 2.4: the rider is offered when picking starts, not at confirmation. The pickers hear about the order instead;
// ops hears when nobody starts it; the rider cannot take goods that are not ready, and collects the recalculated total.
import { beforeAll, describe, expect, it } from "vitest";
import { dispatchAndOffer } from "../../apps/gateway/src/ops-turn";
import { expectBooksBalanced, openHub, placeOrder, status, total, type Hub, type Placed } from "./hub-kit";
import { opsLine, PHONES } from "./ops-kit";

let h: Hub; let line: ReturnType<typeof opsLine>; let WATER: string; let COFFEE: string;

beforeAll(async () => {
  h = await openHub();
  line = opsLine(h);
  WATER = await h.product("Tannourine Mineral Water 2L X6");
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  await line.text(PHONES.rider(0), "حاضر");
}, 120_000);

describe("offer the rider when picking starts (2.4)", () => {
  let o: Placed;
  beforeAll(async () => { o = await placeOrder(h, [{ product_id: WATER, qty: 2 }, { product_id: COFFEE, qty: 1 }]); });

  it("at confirmation the pickers are told, once, and no rider is offered", async () => {
    expect((await dispatchAndOffer({ ...line.deps }, o.orderId)).status).toBe("waiting_for_pick");
    await dispatchAndOffer({ ...line.deps }, o.orderId);                      // the cron's next minute
    const notices = line.to(h.picker).filter((m) => m.buttons.includes(`pick:start:${o.orderId}`));
    expect(notices).toHaveLength(1);
    expect(line.to(h.riders[0]!).filter((m) => m.buttons.some((b) => b.startsWith("job:accept")))).toHaveLength(0);
    expect(await h.db.all(`select 1 from deliveries`)).toEqual([]);
    expect(await h.db.rpc("orders_waiting_for_rider", {})).toContain(o.orderId);   // the cron keeps asking
  });

  it("an order nobody starts reaches ops after the alert time", async () => {
    await h.db.pg.query(`update orders set confirmed_at = now() - interval '15 minutes' where id = $1`, [o.orderId]);
    await dispatchAndOffer({ ...line.deps }, o.orderId);
    expect(line.to(h.ops).at(-1)!.body).toContain(`#${o.code}`);
    expect(line.to(h.ops).at(-1)!.body).toContain("ناطر تحضير");
  });

  it("the picker starts it and the rider is offered at that moment", async () => {
    await line.tap(PHONES.picker, `pick:start:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("preparing");
    const accept = line.lastButtons(h.riders[0]!).find((b) => b.startsWith("job:accept:"));
    expect(accept).toBeTruthy();
    await line.tap(PHONES.rider(0), accept!);
    expect((await h.db.one(`select status from deliveries`)).status).toBe("accepted");
  });

  it("the rider at the hub cannot take the goods before they are ready", async () => {
    const picked = line.lastButtons(h.riders[0]!).find((b) => b.startsWith("job:picked:"))!;
    await line.tap(PHONES.rider(0), picked);
    expect(line.to(h.riders[0]!).at(-1)!.body).toContain("لسّا عم يتحضّر");
    expect(await status(h, o.orderId)).toBe("preparing");
    expect(await h.db.all(`select 1 from stock_movements where order_id = $1 and reason = 'pick'`, [o.orderId])).toEqual([]);
  });

  it("a line comes up short, the picker finishes, the rider is told it is ready and collects the recalculated total", async () => {
    await line.text(PHONES.picker, "ناقص 1");                              // the first line in shelf order, whichever it is
    const due = await total(h, o.orderId);
    await line.tap(PHONES.picker, `pick:done:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("ready");
    expect(line.to(h.riders[0]!).at(-1)!.body).toContain(`#${o.code} جاهز`);
    const picked = line.lastButtons(h.riders[0]!).find((b) => b.startsWith("job:picked:"))!;
    await line.tap(PHONES.rider(0), picked);
    expect(await status(h, o.orderId)).toBe("out_for_delivery");
    const drop = [...line.to(h.riders[0]!)].reverse().find((m) => m.buttons.some((b) => b.startsWith("stop:delivered")))!;
    expect(drop.body).toContain(`$${due.toFixed(2)}`);
    await line.tap(PHONES.rider(0), `stop:delivered:${o.orderId}`);
    await line.tap(PHONES.rider(0), `stop:exact:${o.orderId}`);
    expect(await status(h, o.orderId)).toBe("closed");
    expect(Number(await h.db.rpc("driver_cash_usd", { p_driver: h.riders[0] }))).toBeCloseTo(due, 2);
    await expectBooksBalanced(h);
  });

  it("a confirmed order waiting for its picker is never batched onto another rider's job", async () => {
    const a = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    const b = await placeOrder(h, [{ product_id: WATER, qty: 3 }]);
    await h.db.rpc("start_pick", { p_order: a.orderId, p_by: h.picker });
    const d = await h.db.rpc("dispatch_order", { p_order: a.orderId });
    expect(d.status).toBe("offered");
    expect(d.orders).toEqual([a.orderId]);
    expect((await h.db.rpc("dispatch_order", { p_order: b.orderId })).status).toBe("waiting_for_pick");
    await h.db.rpc("rider_respond", { p_delivery: d.delivery_id, p_driver: h.riders[0], p_accept: false });
  });

  it("a hub without a picker on the ops line offers at confirmation, as before", async () => {
    await h.db.pg.query(`update parties set is_blocked = true where id = $1`, [h.picker]);
    const c = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    expect((await h.db.rpc("dispatch_order", { p_order: c.orderId })).status).not.toBe("waiting_for_pick");
    await h.db.pg.query(`update parties set is_blocked = false where id = $1`, [h.picker]);
  });
});
