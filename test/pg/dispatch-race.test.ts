// Task 4.6: the per-rider lock in dispatch_order, on a real Postgres with real concurrent connections.
// PGlite has one connection, so before this no test could make two dispatches overlap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";

const run = realPostgresAvailable() ? describe : describe.skip;
let pg: RealPg;
let sql: postgres.Sql;
let village: string;
let seq = 0;

async function party(role: string, name: string): Promise<string> {
  return (await sql`insert into parties(role, display_name) values (${role}, ${name}) returning id`)[0]!.id;
}
async function confirmedOrder(): Promise<string> {
  const n = ++seq;
  const [t] = await sql`select touch_conversation('customer', ${"XX.race" + n}, ${"+96170001" + String(n).padStart(3, "0")}, ${"Race " + n}) as r`;
  const c = t!.r as { party_id: string; conversation_id: string };
  await sql`select save_customer_pin(${c.party_id}::uuid, 33.68, 35.56, ${village}::uuid)`;
  const [place] = await sql`select id from customer_places where party_id = ${c.party_id}`;
  const lines = await sql`select p.id as product_id, 16 as qty, 'لبنة' as raw from products p where name_en = 'Leen Taanayel Labneh Premium'`;
  const [o] = await sql`select create_order_from_quote(p_customer => ${c.party_id}::uuid, p_conversation => ${c.conversation_id}::uuid,
    p_lines => ${sql.json(lines as unknown as postgres.JSONValue)}, p_village => ${village}::uuid, p_place => ${place!.id}::uuid, p_pickup => false,
    p_payment => 'cod', p_change_for => null, p_notes => null) as r`;
  const order = o!.r as { order_id: string; created: boolean };
  expect(order.created, JSON.stringify(order)).toBe(true);
  const [ok] = await sql`select confirm_order_checked(${order.order_id}::uuid, ${c.party_id}::uuid, ${"wamid.race" + n}) as r`;
  expect((ok!.r as { changed: boolean }).changed).toBe(true);
  return order.order_id;
}
const activeFor = async (driver: string) =>
  Number((await sql`select count(*) as n from deliveries where driver_id = ${driver} and status in ('offered','accepted','in_progress')`)[0]!.n);

/** Dispatch on its own connection, holding the transaction open for `holdMs` after the call, so the other dispatch overlaps it. */
async function dispatchHolding(orderId: string, holdMs: number): Promise<{ status: string; driver_id?: string }> {
  const c = pg.connect(1);
  try {
    return await c.begin(async (tx) => {
      const [r] = await tx`select dispatch_order(${orderId}::uuid) as r`;
      if (holdMs) await tx`select pg_sleep(${holdMs / 1000})`;
      return r!.r as { status: string; driver_id?: string };
    });
  } finally { await c.end(); }
}

run("dispatch race on real Postgres (two connections)", () => {
  beforeAll(async () => {
    pg = await startRealPostgres();
    sql = pg.connect(4);
    await sql.unsafe(`insert into fx_rates(lbp_per_usd) values (89500);
      update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
      update settings set value = jsonb_set(value, '{max_orders}', '1') where key = 'batching';   -- one order per delivery: the race is about the rider
      update stock_levels set on_hand = 5000;`);
    village = (await sql`select id from villages where name_en = 'Baakline'`)[0]!.id;
    await sql`update sources set village_id = ${village} where kind = 'dark_store'`;
  }, 180_000);
  afterAll(async () => { await sql?.end(); await pg?.stop(); }, 30_000);

  it("two orders, one rider, the first dispatch still open: the rider gets one job, the other order waits", async () => {
    const rider = await party("driver", "Solo");
    await sql`select start_shift(${rider}::uuid)`;
    const [a, b] = [await confirmedOrder(), await confirmedOrder()];
    const first = dispatchHolding(a, 800);
    await new Promise((r) => setTimeout(r, 150));              // A holds the rider's lock inside its open transaction
    const second = await dispatchHolding(b, 0);
    expect(second.status).toBe("no_rider");                   // B could not take the locked rider and did not wait for it
    expect((await first).status).toBe("offered");
    expect(await activeFor(rider)).toBe(1);
  });

  it("after the first commits, a later dispatch sees the rider busy (no double job across transactions)", async () => {
    const rider = await party("driver", "Busy");
    await sql`select start_shift(${rider}::uuid)`;
    const [a, b] = [await confirmedOrder(), await confirmedOrder()];
    expect((await dispatchHolding(a, 0)).driver_id).toBe(rider);
    expect((await dispatchHolding(b, 0)).status).toBe("no_rider");
    expect(await activeFor(rider)).toBe(1);
  });

  it("the same order dispatched from two connections at once becomes one delivery", async () => {
    const r1 = await party("driver", "R1"); const r2 = await party("driver", "R2");
    await sql`select start_shift(${r1}::uuid)`; await sql`select start_shift(${r2}::uuid)`;
    const o = await confirmedOrder();
    const [x, y] = await Promise.all([dispatchHolding(o, 300), dispatchHolding(o, 300)]);
    expect([x.status, y.status].sort()).toEqual(["already", "offered"]);
    const n = await sql`select count(*) as n from delivery_stops s join deliveries d on d.id = s.delivery_id
                        where s.order_id = ${o} and s.kind = 'dropoff' and d.status in ('offered','accepted','in_progress')`;
    expect(Number(n[0]!.n)).toBe(1);
  });

  it("twenty orders dispatched at once to five riders: nobody ever holds two jobs", async () => {
    const riders = await Promise.all([1, 2, 3, 4, 5].map((i) => party("driver", "Many " + i)));
    for (const r of riders) await sql`select start_shift(${r}::uuid)`;
    const orders: string[] = [];
    for (let i = 0; i < 20; i++) orders.push(await confirmedOrder());
    const free = Number((await sql`select count(*) as n from driver_shifts sh where sh.ended_at is null
      and not exists (select 1 from deliveries d where d.driver_id = sh.driver_id and d.status in ('offered','accepted','in_progress'))`)[0]!.n);
    const results = await Promise.all(orders.map((o) => dispatchHolding(o, 50)));
    const offered = results.filter((r) => r.status === "offered");
    const per = new Map<string, number>();
    for (const r of offered) per.set(r.driver_id!, (per.get(r.driver_id!) ?? 0) + 1);
    expect([...per.values()].every((n) => n === 1)).toBe(true);
    const doubled = await sql`select driver_id from deliveries where status in ('offered','accepted','in_progress') group by 1 having count(*) > 1`;
    expect(doubled).toHaveLength(0);                           // across every rider in the database, not only these five
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(free);
  });
});
