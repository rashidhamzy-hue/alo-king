// OPS1 (15 Nov 2026): the hourly probe orders AK-1043 and AK-1044 stopped at "confirmed" on staging, and nothing was told why.
// Cause: every probe order is cash on delivery; the probe riders collect it and never hand it in, so their cash held rose past
// the soft cap (settings.cash_cap, 150) and dispatch_order, correctly, offered the job to nobody ("no_rider"). The cap is not
// the bug (CLAUDE.md invariant 5). The probe has to do what a rider does at the end of a round: hand the cash to the hub,
// and have an ops lead confirm it, through the same two SQL functions (probe_remit_cash, 0140).
import { beforeAll, describe, expect, it } from "vitest";
import { collect, deliverToDoor, expectBooksBalanced, openHub, placeOrder, status, type Hub } from "./hub-kit";

let h: Hub; let COFFEE: string; let probeOps: string;
const rider = () => h.riders[0]!;
const cash = async (id: string) => Number((await h.db.one(`select driver_cash_usd($1) c`, [id])).c);

beforeAll(async () => {
  h = await openHub({ riders: 2, pickerOnOps: false });             // staging has no picker on the ops line: orders are offered at confirmation
  COFFEE = await h.product("Najjar Cafe Classic Normal 180G");
  await h.db.pg.exec(`update parties set is_probe = true where role = 'driver'`);
  probeOps = (await h.db.one(`insert into parties(role, display_name, is_probe) values ('ops_lead', 'Probe ops lead', true) returning id`)).id;
  await h.db.pg.exec(`update settings set value = value || '{"enabled": true}' where key = 'probe'`);
  for (const r of h.riders) await h.db.rpc("start_shift", { p_driver: r });
}, 120_000);

describe("the probe riders and the cash cap (the 15 November stall)", () => {
  it("riders over the soft cap get no offer: dispatch answers no_rider and the order waits at confirmed", async () => {
    // Make the cap small enough to reach in two orders, as 19 hourly orders reached 150 on staging.
    const first = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    const t1 = Number((await h.db.one(`select total_usd from orders where id = $1`, [first.orderId])).total_usd);
    await h.db.pg.query(`update settings set value = jsonb_build_object('soft_usd', $1::numeric, 'hard_usd', 200) where key = 'cash_cap'`, [t1]);
    await deliverToDoor(h, first.orderId, h.riders[0]); await collect(h, first.orderId, h.riders[0]);
    const second = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    await deliverToDoor(h, second.orderId, h.riders[1]); await collect(h, second.orderId, h.riders[1]);
    expect(await cash(h.riders[0]!)).toBeGreaterThanOrEqual(t1);
    expect(await cash(h.riders[1]!)).toBeGreaterThanOrEqual(t1);
    const third = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    expect(await h.db.rpc("dispatch_order", { p_order: third.orderId })).toMatchObject({ status: "no_rider" });
    expect(await status(h, third.orderId)).toBe("confirmed");
    (globalThis as { __third?: string }).__third = third.orderId;
  }, 120_000);

  it("the probe hands in its riders' cash through the real drop and confirm, and the books stay balanced", async () => {
    const before = Number((await h.db.one(`select coalesce(sum(e.usd_equiv), 0) s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = 'hub_cash'`)).s);
    const r = await h.db.rpc("probe_remit_cash");
    expect(r).toMatchObject({ riders: 2 });
    for (const id of h.riders) expect(await cash(id)).toBe(0);
    const drops = await h.db.all(`select status, confirmed_by from cash_drops order by created_at`);
    expect(drops.length).toBe(2);
    expect(drops.every((d) => d.status === "confirmed" && d.confirmed_by === probeOps)).toBe(true);
    const after = Number((await h.db.one(`select coalesce(sum(e.usd_equiv), 0) s from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = 'hub_cash'`)).s);
    expect(after).toBeGreaterThan(before);
    await expectBooksBalanced(h);
  });

  it("then the waiting order is offered, as the cron's next minute does", async () => {
    const third = (globalThis as { __third?: string }).__third!;
    expect(await h.db.rpc("dispatch_order", { p_order: third })).toMatchObject({ status: "offered" });
  });

  it("running it again with nothing held does nothing", async () => {
    await h.db.rpc("probe_remit_cash");                           // the offered rider holds nothing new
    expect(await h.db.rpc("probe_remit_cash")).toMatchObject({ riders: 0 });
    expect((await h.db.all(`select 1 from cash_drops`)).length).toBe(2);
  });
});

describe("probe_remit_cash can never touch a real rider's money", () => {
  it("is a no-op while the probe is switched off (production), and skips a rider who is not a probe", async () => {
    const real = (await h.db.one(`insert into parties(role, display_name) values ('driver', 'Real rider') returning id`)).id;
    await h.db.pg.exec(`insert into party_identities(party_id, line, phone_e164) values ('${real}', 'ops', '+96171999999')`);
    await h.db.pg.exec(`update driver_shifts set ended_at = now() where driver_id = any('{${h.riders.join(",")}}'::uuid[])`);   // only the real rider is on shift
    await h.db.rpc("start_shift", { p_driver: real });
    const o = await placeOrder(h, [{ product_id: COFFEE, qty: 2 }]);
    await deliverToDoor(h, o.orderId, real); await collect(h, o.orderId, real);
    const held = await cash(real);
    expect(held).toBeGreaterThan(0);
    await h.db.rpc("probe_remit_cash");                           // probe enabled: still not a probe party
    expect(await cash(real)).toBe(held);
    await h.db.pg.exec(`update settings set value = value || '{"enabled": false}' where key = 'probe'`);
    await h.db.pg.exec(`update parties set is_probe = true where id = '${real}'`);
    expect(await h.db.rpc("probe_remit_cash")).toMatchObject({ skipped: "probe_disabled" });
    expect(await cash(real)).toBe(held);                          // probe off: even a probe party's cash stays
    await h.db.pg.exec(`update settings set value = value || '{"enabled": true}' where key = 'probe'; update parties set is_probe = false where id = '${real}'`);
  }, 120_000);

  it("does nothing without a probe ops lead, and is not callable by the public roles", async () => {
    await h.db.pg.exec(`update parties set is_blocked = true where id = '${probeOps}'`);
    expect(await h.db.rpc("probe_remit_cash")).toMatchObject({ skipped: "no_probe_ops_lead" });
    const grants = await h.db.all(`select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated') and has_function_privilege(r.rolname, 'probe_remit_cash()', 'execute')`);
    expect(grants).toEqual([]);
  });
});
