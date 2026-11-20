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
    expect(s).toEqual({ fx: 1, hub: "Baakline", stocked: s!.rows, rows: s!.rows, max_on_hand: 5000, probes: 4, open_shifts: 2, enabled: "true", places: 1 });
    expect((await sql`select on_hand from stock_levels where on_hand = 4321`).length).toBe(1);    // the second run did not overwrite stock
    // FD2: the seeded test place, once, testers only, approved, its listing hidden (scripts/staging/test-place.sql, run twice above)
    const kitchen = await sql`select s.visibility, s.approved_at is not null as approved, (select count(*)::int from products p where p.owner_source_id = s.id) as dishes,
        (select hidden_at is not null from listings l where l.listing_id = s.listing_id) as hidden from sources s where s.listing_id = 'ak-test-kitchen-staging'`;
    expect(kitchen).toEqual([{ visibility: "testers", approved: true, dishes: 4, hidden: true }]);
    const [g] = await sql`select can_send(p.id, 'customer', 'service', false) g from parties p where p.is_probe and p.role = 'customer'`;
    expect(g!.g).toBe("probe_sink");
    // OPS1: a probe ops lead confirms the probe riders' cash drops (0140). It has no identity, so no message and no push can reach it.
    const [lead] = await sql`select count(*)::int n, bool_and(not exists (select 1 from party_identities i where i.party_id = p.id)) no_identity from parties p where p.is_probe and p.role = 'ops_lead'`;
    expect(lead).toEqual({ n: 1, no_identity: true });
    expect(((await sql`select probe_remit_cash() r`)[0]!.r as { riders: number }).riders).toBe(0);       // nothing held yet: the call works and does nothing
    // FIX2 (0266): the probe orders only while the shop is open; open now for this check, whatever the hour CI runs at.
    await sql`update settings set value = '{"open":"00:00","close":"23:59:59","tz":"Asia/Beirut"}'::jsonb where key = 'hours'`;
    const [due] = await sql`select probe_due() d`;
    expect(due!.d).toMatchObject({ wa_user_id: "PR.0000000000000001" });
  });
});
