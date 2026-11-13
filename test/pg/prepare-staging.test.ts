// scripts/staging/prepare-staging.sql on a real Postgres, run twice as two deploys would (4.10, 0.13).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";

const run = realPostgresAvailable() ? describe : describe.skip;
let pg: RealPg, sql: postgres.Sql;

run("staging preparation", () => {
  beforeAll(async () => { pg = await startRealPostgres(); sql = pg.connect(2); }, 180_000);
  afterAll(async () => { await sql?.end(); await pg?.stop(); }, 30_000);

  it("is idempotent and leaves a store that can take an order and a probe that can deliver it", async () => {
    pg.psql("scripts/staging/prepare-staging.sql");
    await sql`update stock_levels set on_hand = 4321 where product_id = (select id from products order by sku limit 1)`;   // a later real count
    pg.psql("scripts/staging/prepare-staging.sql");
    const [s] = await sql`select (select count(*) from fx_rates)::int fx,
      (select v.name_en from sources src join villages v on v.id = src.village_id where src.kind = 'dark_store') hub,
      (select count(*) from stock_levels where on_hand > 0)::int stocked, (select count(*) from stock_levels)::int rows,
      (select max(on_hand) from stock_levels)::int max_on_hand,
      (select count(*) from parties where is_probe)::int probes,
      (select count(*) from driver_shifts sh join parties p on p.id = sh.driver_id where p.is_probe and sh.ended_at is null)::int open_shifts,
      (select value->>'enabled' from settings where key = 'probe') enabled,
      (select count(*) from customer_places cp join parties p on p.id = cp.party_id where p.is_probe)::int places`;
    expect(s).toEqual({ fx: 1, hub: "Baakline", stocked: s!.rows, rows: s!.rows, max_on_hand: 5000, probes: 2, open_shifts: 1, enabled: "true", places: 1 });
    expect((await sql`select on_hand from stock_levels where on_hand = 4321`).length).toBe(1);    // the second run did not overwrite stock
    const [g] = await sql`select can_send(p.id, 'customer', 'service', false) g from parties p where p.is_probe and p.role = 'customer'`;
    expect(g!.g).toBe("probe_sink");
    const [due] = await sql`select probe_due() d`;
    expect(due!.d).toMatchObject({ wa_user_id: "PR.0000000000000001" });
  });
});
