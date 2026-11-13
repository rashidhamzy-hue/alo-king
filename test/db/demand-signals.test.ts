// Build plan 1.12: one log of what customers asked for and could not get. The four misses B1 named are logged by the
// SQL functions that find them (plan_order, repeat_plan), so the turn code needs no extra call and no extra round trip.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb; let village: string; let labneh: string; let bread: string;
const signals = (party: string) => db.all(`select kind, origin, query, product_id, source_hint, village_id, village_said, detail
  from demand_signals where party_id = $1 order by kind, query`, [party]);
const customer = async (n: string) => (await db.rpc("touch_conversation", { p_line: "customer", p_wa_user_id: `bsuid-d${n}`, p_phone: `+96170200${n}`, p_name: `D ${n}` })).party_id as string;
const plan = (party: string, lines: unknown[], address: Record<string, unknown> = {}) =>
  db.rpc("plan_order", { p_party: party, p_intent: { intent: "order", lines, address } });

beforeAll(async () => {
  db = await openTestDb();
  await db.pg.exec(`insert into fx_rates(lbp_per_usd) values (89500);
    update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
    update stock_levels set on_hand = 50;
    insert into villages(name_en, name_ar, is_served) values ('Test Outside', 'قرية بعيدة', false);`);
  village = (await db.one(`select id from villages where name_en = 'Baakline'`)).id;
  labneh = (await db.one(`select id from products where name_en = 'Leen Taanayel Labneh Premium'`)).id;
  bread = (await db.one(`select p.id from products p join stock_levels l on l.product_id = p.id where p.id <> $1 order by p.name_en limit 1`, [labneh])).id;
});

describe("demand signals (1.12)", () => {
  it("an unsigned restaurant and an unknown product are logged from plan_order, with the customer's words", async () => {
    const c = await customer("01");
    const p = await plan(c, [
      { raw: "برغر من سناك أبو علي", query: "cheeseburger", qty: 1, source_hint: "Snack Abou Ali" },
      { raw: "زقزوق مقرمش", query: "zzqx crunchy wobble", qty: 2 },
    ]);
    expect(p.unavailable).toHaveLength(1);
    expect(p.lines[1].status).toBe("not_found");
    const s = await signals(c);
    expect(s).toEqual([
      expect.objectContaining({ kind: "unknown_product", origin: "plan_order", query: "zzqx crunchy wobble", detail: { raw: "زقزوق مقرمش" } }),
      expect.objectContaining({ kind: "unsigned_restaurant", origin: "plan_order", query: "برغر من سناك أبو علي", source_hint: "Snack Abou Ali" }),
    ]);
  });

  it("a matched product that is out of stock is logged against the product", async () => {
    const c = await customer("02");
    await db.pg.query(`update stock_levels set on_hand = 0, reserved = 0 where product_id = $1`, [labneh]);
    const p = await plan(c, [{ raw: "لبنة طعنايل", query: "Leen Taanayel Labneh Premium", qty: 1 }]);
    expect(p.lines[0]).toMatchObject({ status: "matched", chosen: { product_id: labneh, in_stock: false } });
    expect(await signals(c)).toEqual([expect.objectContaining({ kind: "out_of_stock", product_id: labneh, query: "لبنة طعنايل" })]);
    await db.pg.query(`update stock_levels set on_hand = 50 where product_id = $1`, [labneh]);
  });

  it("an order to a village we do not serve is logged as out of area, with the village", async () => {
    const c = await customer("03");
    const p = await plan(c, [{ raw: "لبنة", query: "Leen Taanayel Labneh Premium", qty: 1 }], { village: "قرية بعيدة" });
    expect(p.issues.map((i: any) => i.code)).toContain("village_not_served");
    const outside = (await db.one(`select id from villages where name_en = 'Test Outside'`)).id;
    expect(await signals(c)).toEqual([expect.objectContaining({ kind: "out_of_area", village_id: outside, village_said: "قرية بعيدة",
      detail: { recognised: true, village: "Test Outside" } })]);
  });

  it("a retried turn logs nothing twice; a clean plan logs nothing", async () => {
    const c = await customer("04");
    const lines = [{ raw: "زقزوق", query: "zzqx crunchy wobble", qty: 1 }];
    await plan(c, lines); await plan(c, lines);
    expect(await signals(c)).toHaveLength(1);
    const ok = await customer("05");
    const p = await plan(ok, [{ raw: "لبنة", query: "Leen Taanayel Labneh Premium", qty: 1 }]);
    expect(p.lines[0].status).toBe("matched");
    expect(await signals(ok)).toEqual([]);
  });

  it("'same as last time' logs the items of the last order that are gone", async () => {
    const c = await customer("06");
    await db.rpc("save_customer_pin", { p_party: c, p_lat: 33.68, p_lng: 35.56, p_village: village });
    const place = (await db.one(`select id from customer_places where party_id = $1`, [c])).id;
    const o = await db.rpc("create_order_from_quote", { p_customer: c, p_conversation: null, p_lines: [{ product_id: labneh, qty: 6 }, { product_id: bread, qty: 2 }],
      p_village: village, p_place: place, p_pickup: false, p_payment: "cod", p_change_for: null, p_notes: null });
    expect(o.created).toBe(true);
    await db.pg.query(`update orders set status = 'closed', delivered_at = now() where id = $1`, [o.order_id]);
    await db.pg.query(`update stock_levels set on_hand = 0, reserved = 0 where product_id = $1`, [bread]);
    const r = await db.rpc("repeat_plan", { p_party: c, p_order: null });
    expect(r.missing.map((m: any) => m.product_id)).toEqual([bread]);
    expect(await signals(c)).toEqual([expect.objectContaining({ kind: "out_of_stock", origin: "repeat", product_id: bread, detail: { order_id: o.order_id } })]);
    await db.pg.query(`update stock_levels set on_hand = 50 where product_id = $1`, [bread]);
  });

  it("a failure inside the log never breaks the plan", async () => {
    const c = await customer("07");
    await db.pg.exec(`begin; alter table demand_signals add constraint no_rows check (false) not valid;`);
    try {
      const p = await plan(c, [{ raw: "زقزوق", query: "zzqx crunchy wobble", qty: 1 }]);
      expect(p.lines[0].status).toBe("not_found");
    } finally { await db.pg.exec(`rollback`); }
  });

  it("the wrappers are what the app calls: volatile, same arguments, and they keep logging", async () => {
    const fns = await db.all(`select oid::regprocedure::text as fn, provolatile from pg_proc where proname in ('plan_order', 'plan_order_core', 'repeat_plan', 'repeat_plan_core') order by 1`);
    expect(fns).toEqual([
      { fn: "plan_order(uuid,jsonb,uuid,jsonb)", provolatile: "v" }, { fn: "plan_order_core(uuid,jsonb,uuid,jsonb)", provolatile: "s" },
      { fn: "repeat_plan(uuid,uuid)", provolatile: "v" }, { fn: "repeat_plan_core(uuid,uuid)", provolatile: "s" },
    ]);
    const src = await db.all(`select proname, prosrc from pg_proc where proname in ('plan_order', 'repeat_plan')`);
    for (const s of src) expect(s.prosrc, s.proname).toMatch(/log_(plan_)?demand/);
  });

  it("unmet_demand groups by what was asked, counting distinct customers", async () => {
    const a = await customer("08"), b = await customer("09");
    for (const p of [a, b]) await plan(p, [{ raw: "تمر هندي مركز", query: "qqvx tamarind concentrate", qty: 1 }]);
    const rows = await db.rpc<any[]>("unmet_demand", {});
    const tam = rows.find((r) => r.kind === "unknown_product" && r.label === "qqvx tamarind concentrate");
    expect(tam).toMatchObject({ asks: 2, customers: 2, said: ["qqvx tamarind concentrate"] });
    const lab = rows.find((r) => r.kind === "out_of_stock" && r.product_id === labneh);
    expect(lab).toMatchObject({ label: "Leen Taanayel Labneh Premium", customers: 1 });
  });
});
