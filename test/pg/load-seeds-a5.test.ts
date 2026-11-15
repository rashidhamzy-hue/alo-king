// scripts/ci/load-seeds.sh on a real Postgres, run as three deploys would: the approved pilot settings (the 25 served villages and
// the small-order fee) load once, and a later console change is never put back by a deploy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { realPostgresAvailable, startRealPostgres, type RealPg } from "./real-postgres";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const run = realPostgresAvailable() ? describe : describe.skip;
let pg: RealPg, sql: postgres.Sql;
const seeds = () => execFileSync("bash", ["scripts/ci/load-seeds.sh"], { cwd: repo, env: { ...process.env, DATABASE_URL: pg.url }, stdio: "pipe" }).toString();

run("load-seeds.sh", () => {
  beforeAll(async () => { pg = await startRealPostgres({ seeds: false }); sql = pg.connect(2); }, 180_000);
  afterAll(async () => { await sql?.end(); await pg?.stop(); }, 30_000);

  it("loads the catalog once and the approved pilot settings once: 25 villages served, the 5 USD minimum, no small-order fee; a deploy never undoes a console change", async () => {
    const first = seeds();
    expect(first).toContain("seed proposed_pilot_settings");
    const [a] = await sql`select (select count(*) from villages where is_served)::int served, (select value from settings where key = 'small_order_fee') fee,
                                 (select count(*) from products)::int products, (select count(*) from settings where key = 'seed_applied:proposed_pilot_settings')::int marker`;
    // B1a: the founder's decision of 15 Nov 2026, a 5 USD minimum and no small-order fee at launch.
    expect(a).toMatchObject({ served: 25, fee: { below_subtotal_usd: 0, fee_usd: 0 }, marker: 1 });
    expect(a!.products).toBeGreaterThan(200);
    expect(first).toMatch(/villages: \d+, served: 25/);
    expect(first).toMatch(/small_order_fee: \{.*"fee_usd": 0[,}]/);
    expect(first).toContain("seed minimum_order_2026_11_15");
    expect(first).toContain("min_order_usd: 5");

    // the console changes both; the next deploys leave them alone
    await sql`update villages set is_served = true where name_en = (select name_en from villages where not is_served limit 1)`;
    await sql`update settings set value = '{"below_subtotal_usd": 12, "fee_usd": 0.75}' where key = 'small_order_fee'`;
    const second = seeds(), third = seeds();
    expect(second).toContain("catalog seeds skipped");
    expect(second).toContain("proposed_pilot_settings skipped");
    expect(third).toContain("proposed_pilot_settings skipped");
    expect(third).toContain("minimum_order_2026_11_15 skipped");
    const [b] = await sql`select (select count(*) from villages where is_served)::int served, (select value from settings where key = 'small_order_fee') fee, (select count(*) from products)::int products`;
    expect(b).toMatchObject({ served: 26, fee: { below_subtotal_usd: 12, fee_usd: 0.75 }, products: a!.products });
  });

  it("a database that already has the catalog (staging) still gets the settings, once", async () => {
    await sql`delete from settings where key = 'seed_applied:proposed_pilot_settings'`;
    await sql`update villages set is_served = false`;
    expect(seeds()).toContain("seed proposed_pilot_settings");
    const [c] = await sql`select (select count(*) from villages where is_served)::int served`;
    expect(c!.served).toBe(25);
  });

  it("staging, where the old fee (0.50 under 10 USD) was loaded on 14 Nov: the 15 Nov decision is applied once, then left to the console", async () => {
    await sql`delete from settings where key = 'seed_applied:minimum_order_2026_11_15'`;
    await sql`update settings set value = '{"below_subtotal_usd": 10, "fee_usd": 0.50}' where key = 'small_order_fee'`;
    await sql`update settings set value = '7' where key = 'min_order_usd'`;
    expect(seeds()).toContain("seed minimum_order_2026_11_15");
    const [d] = await sql`select (select value from settings where key = 'small_order_fee') fee, (select value from settings where key = 'min_order_usd') min`;
    expect(d).toMatchObject({ fee: { below_subtotal_usd: 0, fee_usd: 0 }, min: 5 });
    await sql`update settings set value = '6' where key = 'min_order_usd'`;
    expect(seeds()).toContain("minimum_order_2026_11_15 skipped");
    expect((await sql`select value from settings where key = 'min_order_usd'`)[0]!.value).toBe(6);
  });
});
