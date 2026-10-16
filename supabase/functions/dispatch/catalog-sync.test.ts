import { describe, expect, it } from "vitest";
import { catalogSyncStep, type CatalogApi } from "./catalog-sync";

const V = "20000000-0000-0000-0000-00000000000a";
const item = (k: number, extra: any = {}) => ({
  retailer_id: `53000000-0000-0000-0000-00000000000${k}`,
  name: `Dish ${k}`,
  price_minor: 100 * k,
  currency: "USD",
  availability: "in stock",
  product_set: V,
  brand: "Alo Test Grill",
  ...extra,
});

function fake(o: {
  state?: any;
  set?: string | null;
  batchOk?: boolean;
  jobs?: any[];
  refused?: string[];
  setRefused?: boolean;
  setThrows?: boolean;
}) {
  const calls: { fn: string; args: any }[] = [];
  let claims = 0;
  const batches: any[] = [];
  const sets: any[] = [];
  const rpc = async (fn: string, args: any) => {
    calls.push({ fn, args });
    switch (fn) {
      case "catalog_sync_claim":
        // One shop per claim, then the queue is empty.
        return {
          items:
            claims++ === 0
              ? (o.jobs ?? [{ vendor_id: V, force: false, queued_at: "2026-10-15T16:00:00Z" }])
              : [],
          catalog: { catalog_id: "987654321012", transport: "kapso" },
        };
      case "catalog_desired":
        return [item(1), item(2)];
      case "catalog_sync_state":
        return o.state ?? {};
      case "catalog_product_set":
        return args.p_product_set_id ?? o.set ?? null;
      default:
        return null;
    }
  };
  const api: CatalogApi = {
    batch: async (c, t, r) => {
      batches.push({ c, t, r });
      return o.batchOk === false
        ? { ok: false, error: "meta 500" }
        : { ok: true, refused: o.refused ?? [] };
    },
    productSet: async (c, t, b) => {
      sets.push({ c, t, b });
      if (o.setThrows) throw new Error("timeout");
      return o.setRefused ? null : "555555555555";
    },
    imageUrl: (id, h) => `https://x.test/dispatch?route=catalog-image&i=${id}&v=${h}`,
  };
  return { rpc, api, calls, batches, sets, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

describe("catalogue sync step in dispatch (DECISIONS §39.12)", () => {
  it("creates the shop's product set once, sends the changes, records the state and finishes the job", async () => {
    const f = fake({});
    expect(await catalogSyncStep(f.rpc, f.api)).toBe(1);
    expect(f.sets).toHaveLength(1);
    expect(f.sets[0].b.filter).toBe(JSON.stringify({ custom_label_0: { eq: V } }));
    expect(f.of("catalog_product_set")[1].args.p_product_set_id).toBe("555555555555");
    expect(f.batches).toHaveLength(1);
    expect(f.batches[0].c).toBe("987654321012");
    expect(f.batches[0].r.map((r: any) => r.data.id)).toEqual([
      item(1).retailer_id,
      item(2).retailer_id,
    ]);
    expect(f.of("catalog_sync_record")[0].args.p_items).toHaveLength(2);
    expect(f.of("catalog_sync_finish")[0].args).toEqual({
      p_vendor_id: V,
      p_queued_at: "2026-10-15T16:00:00Z",
      p_error: null,
    });
  });
  it("an existing set is reused, and nothing unchanged is sent", async () => {
    const { productHash } = await import("../_shared/catalog");
    const state = Object.fromEntries(
      [item(1), item(2)].map((p: any) => [p.retailer_id, { hash: productHash(p), visible: true }]),
    );
    const f = fake({ state, set: "444444444444" });
    await catalogSyncStep(f.rpc, f.api);
    expect(f.sets).toHaveLength(0);
    expect(f.batches).toHaveLength(0);
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBeNull();
  });
  it("a product set Meta refuses (still empty) is asked for after the products, and the job retries", async () => {
    const f = fake({ setRefused: true });
    expect(await catalogSyncStep(f.rpc, f.api)).toBe(1);
    expect(f.batches).toHaveLength(1);
    expect(f.of("catalog_sync_record")[0].args.p_items).toHaveLength(2);
    const order = f.calls.map((c) => c.fn);
    expect(order.indexOf("catalog_sync_record")).toBeLessThan(order.indexOf("catalog_product_set"));
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBe("catalogue product set not created");
  });
  it("the retry sends nothing again and creates the set over the products already in", async () => {
    const { productHash } = await import("../_shared/catalog");
    const state = Object.fromEntries(
      [item(1), item(2)].map((p: any) => [p.retailer_id, { hash: productHash(p), visible: true }]),
    );
    const f = fake({
      state,
      jobs: [{ vendor_id: V, force: false, queued_at: "2026-10-15T16:00:00Z", attempts: 2 }],
    });
    expect(await catalogSyncStep(f.rpc, f.api)).toBe(1);
    expect(f.batches).toHaveLength(0);
    expect(f.of("catalog_product_set")[1].args.p_product_set_id).toBe("555555555555");
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBeNull();
  });
  it("after the fifth refusal (the ops alert) the job finishes clean, so the shop's updates are not held", async () => {
    const f = fake({
      setRefused: true,
      jobs: [{ vendor_id: V, force: false, queued_at: "2026-10-15T16:00:00Z", attempts: 6 }],
    });
    await catalogSyncStep(f.rpc, f.api);
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBeNull();
    const g = fake({
      setRefused: true,
      jobs: [{ vendor_id: V, force: false, queued_at: "2026-10-15T16:00:00Z", attempts: 5 }],
    });
    await catalogSyncStep(g.rpc, g.api);
    expect(g.of("catalog_sync_finish")[0].args.p_error).toBe("catalogue product set not created");
  });
  it("a set request that fails outright counts as a refusal, the products stay recorded", async () => {
    const f = fake({ setThrows: true });
    expect(await catalogSyncStep(f.rpc, f.api)).toBe(1);
    expect(f.of("catalog_sync_record")).toHaveLength(1);
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBe("catalogue product set not created");
  });
  it("a failed batch is the error reported, and no set is asked for", async () => {
    const f = fake({ batchOk: false, setRefused: true });
    await catalogSyncStep(f.rpc, f.api);
    expect(f.sets).toHaveLength(0);
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBe("meta 500");
  });
  it("a refused batch is reported back (retried later) and nothing is recorded", async () => {
    const f = fake({ batchOk: false, set: "444444444444" });
    expect(await catalogSyncStep(f.rpc, f.api)).toBe(0);
    expect(f.of("catalog_sync_record")).toHaveLength(0);
    expect(f.of("catalog_sync_finish")[0].args.p_error).toBe("meta 500");
  });
});

describe("catalogue sync step: leases, budget and refused products (§39.12)", () => {
  it("takes one shop per claim, and stops when the worker has no time left for a whole job", async () => {
    const f = fake({});
    expect(await catalogSyncStep(f.rpc, f.api, undefined, () => 10_000)).toBe(0);
    expect(f.of("catalog_sync_claim")).toHaveLength(0);
    const g = fake({});
    await catalogSyncStep(g.rpc, g.api);
    expect(g.of("catalog_sync_claim").map((c) => c.args)).toEqual([{ p_limit: 1 }, { p_limit: 1 }]);
  });
  it("a product Meta refused is recorded as not shown, so it is never offered and is sent again", async () => {
    const f = fake({ set: "444444444444", refused: [item(2).retailer_id] });
    await catalogSyncStep(f.rpc, f.api);
    const rec = f.of("catalog_sync_record")[0].args.p_items;
    expect(rec.find((r: any) => r.retailer_id === item(2).retailer_id)).toEqual({
      retailer_id: item(2).retailer_id,
      hash: "refused",
      visible: false,
    });
    expect(rec.find((r: any) => r.retailer_id === item(1).retailer_id).visible).toBe(true);
  });
});

// DECISIONS §39.15.2: Meta's review status is the truth, read after every batch and in a paced sweep.
import { catalogStatusStep, recordStatusOf, STATUS_IDS_PER_READ } from "./catalog-sync";

describe("Meta's review status (session 5f)", () => {
  const statusApi = (pages: Record<string, { rows: any[]; next: string | null }>, fail = false) => {
    const asked: any[] = [];
    const api: CatalogApi = {
      batch: async () => ({ ok: true }),
      productSet: async () => "1",
      imageUrl: () => "https://x",
      status: async (c, t, q) => {
        asked.push({ c, t, q });
        if (fail) return { ok: false, error: "meta 400 (#100) bad" };
        if (q.ids)
          return {
            ok: true,
            rows: q.ids.map((id) => ({ retailer_id: id, review_status: "pending" })),
            next: null,
          };
        return { ok: true, ...(pages[q.after ?? ""] ?? { rows: [], next: null }) };
      },
    };
    return { api, asked };
  };

  it("after a batch, the status of what was sent is read (filtered by id, 50 at a time) and recorded", async () => {
    const calls: any[] = [];
    const rpc = async (fn: string, args: any) => {
      calls.push({ fn, args });
      return fn === "catalog_status_record" ? args.p_rows.length : null;
    };
    const { api, asked } = statusApi({});
    const ids = Array.from(
      { length: 120 },
      (_, k) => `53000000-0000-0000-0000-${String(k).padStart(12, "0")}`,
    );
    expect(await recordStatusOf(rpc, api, "987654321012", "graph", ids)).toBe(120);
    expect(asked.map((a) => a.q.ids.length)).toEqual([
      STATUS_IDS_PER_READ,
      STATUS_IDS_PER_READ,
      20,
    ]);
    expect(calls.filter((c) => c.fn === "catalog_status_record")).toHaveLength(3);
  });

  it("the sync step reads the status of the products it just sent", async () => {
    const f = fake({});
    const read: string[][] = [];
    f.api.status = async (_c, _t, q) => {
      read.push(q.ids ?? []);
      return { ok: true, rows: [], next: null };
    };
    await catalogSyncStep(f.rpc, f.api);
    expect(read.flat().sort()).toEqual([item(1).retailer_id, item(2).retailer_id].sort());
  });

  it("a due sweep reads one page, records it and keeps the cursor; nothing due: no call", async () => {
    const calls: any[] = [];
    let due: any = { due: true, after: null, catalog_id: "987654321012", transport: "graph" };
    const rpc = async (fn: string, args: any) => {
      calls.push({ fn, args });
      if (fn === "catalog_status_sweep_next") return due;
      if (fn === "catalog_status_record") return args.p_rows.length;
      return null;
    };
    const { api, asked } = statusApi({
      "": { rows: [{ retailer_id: "a", review_status: "approved" }], next: "c2" },
      c2: { rows: [{ retailer_id: "b", review_status: "rejected" }], next: null },
    });
    expect(await catalogStatusStep(rpc, api)).toBe(1);
    expect(asked[0].q).toEqual({ after: null, limit: 500 });
    expect(calls.find((c) => c.fn === "catalog_status_sweep_done").args).toEqual({
      p_catalog_id: "987654321012",
      p_next: "c2",
      p_failed: false,
    });
    due = { due: true, after: "c2", catalog_id: "987654321012", transport: "graph" };
    await catalogStatusStep(rpc, api);
    expect(calls.filter((c) => c.fn === "catalog_status_sweep_done")[1].args.p_next).toBeNull();
    due = { due: false };
    expect(await catalogStatusStep(rpc, api)).toBe(-1);
    expect(asked).toHaveLength(2);
  });

  it("a failed page keeps the cursor for a retry and records nothing", async () => {
    const calls: any[] = [];
    const rpc = async (fn: string, args: any) => {
      calls.push({ fn, args });
      return fn === "catalog_status_sweep_next"
        ? { due: true, after: "c9", catalog_id: "987654321012", transport: "graph" }
        : null;
    };
    const { api } = statusApi({}, true);
    expect(await catalogStatusStep(rpc, api)).toBe(0);
    expect(calls.find((c) => c.fn === "catalog_status_sweep_done").args.p_failed).toBe(true);
    expect(calls.some((c) => c.fn === "catalog_status_record")).toBe(false);
  });
});
