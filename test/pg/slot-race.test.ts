// Build plan 2.8 (b): the last place in a delivery window, on a real Postgres with two real connections.
// PGlite has one connection, so only here can two confirmation taps overlap. The slot row is locked before the count, so
// two customers tapping at once can never both take the last place: one is confirmed, the other gets slot_full.
import { afterAll, beforeAll, expect, it, describe } from "vitest";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";

const run = realPostgresAvailable() ? describe : describe.skip;
let pg: RealPg;
let sql: postgres.Sql;
let village: string;
let seq = 0;

/** A card for a new customer with the window chosen (awaiting confirmation, nothing held yet). */
async function cardFor(slot: string): Promise<{ order: string; party: string }> {
  const n = ++seq;
  const [t] = await sql`select touch_conversation('customer', ${"XX.slot" + n}, ${"+96170002" + String(n).padStart(3, "0")}, ${"Slot " + n}) as r`;
  const c = t!.r as { party_id: string; conversation_id: string };
  await sql`select save_customer_pin(${c.party_id}::uuid, 33.68, 35.56, ${village}::uuid)`;
  const [place] = await sql`select id from customer_places where party_id = ${c.party_id}`;
  const lines = await sql`select p.id as product_id, 4 as qty from products p where name_en = 'Tannourine Mineral Water 2L X6'`;
  const [o] = await sql`select create_order_from_quote(p_customer => ${c.party_id}::uuid, p_conversation => ${c.conversation_id}::uuid,
    p_lines => ${sql.json(lines as unknown as postgres.JSONValue)}, p_village => ${village}::uuid, p_place => ${place!.id}::uuid, p_pickup => false,
    p_payment => 'cod', p_change_for => null, p_notes => null) as r`;
  const order = o!.r as { order_id: string; created: boolean };
  expect(order.created, JSON.stringify(order)).toBe(true);
  const [w] = await sql`select request_delivery_window(${order.order_id}::uuid, ${slot}::uuid, ${c.party_id}::uuid) as r`;
  expect((w!.r as { ok: boolean }).ok).toBe(true);
  return { order: order.order_id, party: c.party_id };
}

/** The confirmation tap on its own connection, holding the transaction open for `holdMs` so the other tap overlaps it. */
async function tapHolding(c: { order: string; party: string }, holdMs: number): Promise<string> {
  const conn = pg.connect(1);
  try {
    return await conn.begin(async (tx) => {
      const [r] = await tx`select confirm_order_checked(${c.order}::uuid, ${c.party}::uuid, ${"wamid.slot." + c.order}) as r`;
      if (holdMs) await tx`select pg_sleep(${holdMs / 1000})`;
      return (r!.r as { status: string }).status;
    });
  } finally { await conn.end(); }
}

run("the last place in a window on real Postgres (two connections)", () => {
  beforeAll(async () => {
    pg = await startRealPostgres();
    sql = pg.connect(4);
    await sql.unsafe(`insert into fx_rates(lbp_per_usd) values (89500);
      update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}' where key = 'hours';
      update stock_levels set on_hand = 5000;
      insert into delivery_window_plans(name, starts, ends, capacity) values ('Race', '10:00', '12:00', 1);`);
    village = (await sql`select id from villages where name_en = 'Baakline'`)[0]!.id;
    await sql`update sources set village_id = ${village} where kind = 'dark_store'`;
  }, 180_000);
  afterAll(async () => { await sql?.end(); await pg?.stop(); }, 30_000);

  it("two customers tap at once for the last place: one is confirmed, the other is refused, one hold", async () => {
    await sql`select generate_delivery_slots()`;
    const [slot] = await sql`select id from delivery_slots where slot_date = (now() at time zone 'Asia/Beirut')::date + 2`;
    const a = await cardFor(slot!.id), b = await cardFor(slot!.id);
    const first = tapHolding(a, 800);
    await new Promise((r) => setTimeout(r, 150));
    const second = await tapHolding(b, 0);
    expect([await first, second].sort()).toEqual(["confirmed", "slot_full"]);
    const [held] = await sql`select count(*) as n from slot_holds where slot_id = ${slot!.id}`;
    expect(Number(held!.n)).toBe(1);
    const statuses = await sql`select status::text as status from orders where id in (${a.order}, ${b.order})`;
    expect(statuses.map((r) => r.status).sort()).toEqual(["confirmed", "draft"]);
  });
});
