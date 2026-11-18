// Session FIX1 (Sentry fix, Khraibeh, Safa Chicken, limits), migration 0241, on the real migrations. Written before the change.
//   1. Sentry ALO-KING-GATEWAY-6: the console's Worker called temperature_log_check with no arguments and PostgREST answered "Could not
//      find the function public.temperature_log_check without parameters". The Worker now passes p_now; p_now keeps a default of now().
//   2. Khraibeh is served, in the "mid" zone ($1.50, 30 minutes).
//   3. Safa Chicken is listed, with the same fields as LV1's rows and no phone or rating.
//   4. settings.sim_monthly_cap_usd: 2026-11 = 55, default 10.
//   5. LB1's capture page shrinks photos to 1600 px, JPEG quality 0.8.
//   6. The weekly size check raises a staff alert at 600 MB storage or 350 MB database.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asSupabase, openTestDb, type TestDb } from "./harness";
import { runTemperatureCheck } from "../../apps/console/src/temperature-check";
import { CAPTURE_JS } from "../../apps/console/src/capture-js";
import { KIND } from "../../apps/console/src/kinds";
import { findPhones } from "../../scripts/ci/no-personal-data.mjs";

const file = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
const MB = 1024 * 1024;
let db: TestDb;
beforeAll(async () => { db = await openTestDb(); }, 120_000);

describe("1. the Worker's temperature check", () => {
  /** PostgREST resolves a function by the names of the arguments it is sent: a call without p_now found nothing (the Sentry event). */
  const postgrest = () => {
    const calls: Record<string, unknown>[] = [];
    const real = asSupabase(db);
    return {
      calls,
      rpc: async <T,>(fn: string, args: Record<string, unknown> = {}) => {
        calls.push(args);
        if (fn === "temperature_log_check" && !("p_now" in args)) throw Object.assign(new Error("Could not find the function public.temperature_log_check without parameters in the schema cache"), { code: "PGRST202" });
        const r = await real.rpc(fn, args);
        if (r.error) throw new Error(r.error.message);
        return r.data as T;
      },
    };
  };

  it("calls it as the Worker does, with p_now, and gets the answer", async () => {
    const pg = postgrest();
    const r = await runTemperatureCheck(pg as never, new Date("2026-11-18T10:00:00Z"));
    expect(pg.calls).toEqual([{ p_now: "2026-11-18T10:00:00.000Z" }]);
    expect(r).toEqual({ missed: [] });
  });

  it("the Worker's scheduled handler goes through that helper, not an empty call", () => {
    const w = file("apps/console/src/worker.ts");
    expect(w).toContain("runTemperatureCheck(");
    expect(w).not.toMatch(/rpc\("temperature_log_check",\s*\{\s*\}\)/);
  });

  it("p_now has a default of now() in the database too (0241)", async () => {
    const f = await db.one(`select pronargdefaults as d, pg_get_function_arguments(oid) as a from pg_proc where proname = 'temperature_log_check'`);
    expect(f.d).toBe(1);
    expect(f.a).toMatch(/p_now timestamp with time zone DEFAULT now\(\)/);
    expect(await db.one(`select temperature_log_check() as r`)).toEqual({ r: { missed: [] } });
  });
});

describe("2. Khraibeh", () => {
  // The harness loads the village seed after the migrations; production has its villages before 0241 runs. So the migration's own
  // statement is run here on the seeded database, as a deploy would run it.
  beforeAll(async () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/0241_fix1.sql", import.meta.url)), "utf8");
    const stmt = /^update villages set .*Khraibeh';$/m.exec(sql)?.[0];
    expect(stmt, "0241 updates the village Khraibeh").toBeTruthy();
    await db.pg.exec(stmt!);
  });
  it("is served, in the mid zone, at $1.50 and 30 minutes, under its own name", async () => {
    const v = await db.one(`select v.name_en, v.name_ar, v.is_served, z.name as zone, z.delivery_fee_usd::text as fee, z.base_eta_minutes as eta
                              from villages v join zones z on z.id = v.zone_id where v.name_en = 'Khraibeh'`);
    expect(v).toEqual({ name_en: "Khraibeh", name_ar: "الخريبة", is_served: true, zone: "mid", fee: "1.50", eta: 30 });
  });
  it("no other village moved", async () => {
    const outer = await db.all<{ name_en: string }>(`select v.name_en from villages v join zones z on z.id = v.zone_id where z.name = 'outer'`);
    expect(outer.length).toBeGreaterThan(0);
    expect(outer.map((o) => o.name_en)).not.toContain("Khraibeh");
  });
});

describe("3. Safa Chicken", () => {
  it("is one listing, a restaurant in Boqaata, with a map link by place and no phone, rating, menu, hours or photo", async () => {
    const rows = await db.all<any>(`select * from listings where name = 'Safa Chicken'`);
    expect(rows.length).toBe(1);
    const l = rows[0];
    expect(l).toMatchObject({ kind: "restaurant", village: "Boqaata", hidden_at: null });
    expect(l.maps_url).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Safa%20Chicken&query_place_id=ChIJ[A-Za-z0-9_-]+$/);
    expect(Object.keys(l).sort()).toEqual(["created_at", "hidden_at", "kind", "km_from_hub", "listing_id", "maps_url", "name", "village"]);
    expect(findPhones(Object.values(l).join(" | "))).toEqual([]);
  });
  it("the place id is the one given (0x151f207a3c04bfb1:0xdf311a9f1d199c8a)", async () => {
    const { maps_url } = await db.one(`select maps_url from listings where name = 'Safa Chicken'`);
    const id = /query_place_id=(ChIJ[A-Za-z0-9_-]+)/.exec(maps_url)![1]!;
    const b = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(b[0]).toBe(0x0a); expect(b[2]).toBe(0x09); expect(b[11]).toBe(0x11);
    expect(`0x${b.subarray(3, 11).reverse().toString("hex")}:0x${b.subarray(12, 20).reverse().toString("hex")}`).toBe("0x151f207a3c04bfb1:0xdf311a9f1d199c8a");
  });
  it("sits where the founder's file puts Boqaata (2.6 to 4.1 km from the hub)", async () => {
    const { km } = await db.one(`select km_from_hub::float as km from listings where name = 'Safa Chicken'`);
    expect(km).toBeGreaterThanOrEqual(2.6); expect(km).toBeLessThanOrEqual(4.1);
  });
});

describe("4. the simulation ceiling", () => {
  it("is 55 for 2026-11 and 10 for every other month", async () => {
    expect((await db.one(`select value from settings where key = 'sim_monthly_cap_usd'`)).value).toEqual({ default_usd: 10, months: { "2026-11": 55 } });
  });
});

describe("5. the capture page's photos", () => {
  it("are shrunk to at most 1600 px on the long side, JPEG quality 0.8", () => {
    expect(CAPTURE_JS).toContain("MAX=1600");
    expect(CAPTURE_JS).not.toContain("MAX=2000");
    expect(CAPTURE_JS).toContain('"image/jpeg",0.8)');
    expect(CAPTURE_JS).not.toContain('"image/jpeg",0.85');
  });
});

describe("6. the weekly size check", () => {
  const open = async () => Number((await db.one(`select count(*) as n from ops_exceptions where kind = 'usage_near_limit' and status <> 'resolved'`)).n);
  it("the limits are settings: 600 MB storage, 350 MB database", async () => {
    expect((await db.one(`select value from settings where key = 'usage_alerts'`)).value).toEqual({ storage_mb: 600, database_mb: 350 });
  });
  it("below both: nothing is raised", async () => {
    expect(await db.rpc("usage_size_check", { p_storage_bytes: 599 * MB, p_database_bytes: 349 * MB })).toEqual({ raised: [], resolved: [] });
    expect(await open()).toBe(0);
  });
  it("at 600 MB of storage: one staff alert, naming the size and the limit; twice is still one", async () => {
    const r = await db.rpc("usage_size_check", { p_storage_bytes: 600 * MB, p_database_bytes: 100 * MB });
    expect(r.raised).toEqual(["storage"]);
    await db.rpc("usage_size_check", { p_storage_bytes: 610 * MB, p_database_bytes: 100 * MB });
    expect(await open()).toBe(1);
    expect(await db.one(`select detail->>'metric' as m, detail->>'limit_mb' as l from ops_exceptions where kind = 'usage_near_limit' and status <> 'resolved'`)).toEqual({ m: "storage", l: "600" });
  });
  it("back under the limit: the alert closes by itself", async () => {
    const r = await db.rpc("usage_size_check", { p_storage_bytes: 300 * MB, p_database_bytes: 100 * MB });
    expect(r.resolved).toEqual(["storage"]);
    expect(await open()).toBe(0);
  });
  it("at 350 MB of database: an alert for the database only", async () => {
    const r = await db.rpc("usage_size_check", { p_storage_bytes: 1 * MB, p_database_bytes: 350 * MB });
    expect(r.raised).toEqual(["database"]);
    await db.rpc("usage_size_check", { p_storage_bytes: 1 * MB, p_database_bytes: 1 * MB });
  });
  it("the console words the alert, and the weekly workflow calls the function with the sizes it read", () => {
    expect(KIND.usage_near_limit).toBeTruthy();
    const w = file(".github/workflows/usage-check.yml");
    expect(w).toContain("usage_size_check");
    expect(w).toContain("$DB_BYTES"); expect(w).toContain("$STORAGE_BYTES");
  });
});
