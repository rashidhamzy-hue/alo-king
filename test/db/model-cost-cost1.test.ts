// Session COST1 (migration 0139): every model-calling workflow records tokens and dollars in model_costs, and the totals by
// workflow and day are in the AI cost view. The writer is record_model_cost; the prices a run starts with come from model_prices.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";
import { CostMeter, loadPrices, normalisePrices, recordRun, type Conn } from "../../scripts/lib/model-cost.mjs";

let db: TestDb;
// A PostgREST stand-in over PGlite: the two functions the scripts call.
const fetchImpl = (async (url: string, init: RequestInit) => {
  const fn = new URL(url).pathname.split("/rpc/")[1]!;
  const args = JSON.parse(String(init.body ?? "{}"));
  try {
    const keys = Object.keys(args);
    const rows = await db.all<any>(`select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
      keys.map((k) => (typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
    const body = fn === "record_model_cost" ? rows[0][fn] : rows;
    return new Response(JSON.stringify(body), { status: 200 });
  } catch (e) { return new Response(JSON.stringify({ message: (e as Error).message }), { status: 400 }); }
}) as unknown as typeof fetch;
const conn: Conn = { url: "http://db.invalid", key: "k", fetchImpl };

beforeAll(async () => { db = await openTestDb({ seeds: false }); }, 60_000);

const line = (usd: number) => ({ model: "claude-haiku-5-5", step: "s", calls: 3, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, web_searches: 0, usd });

describe("model_costs (0139)", () => {
  it("the prices a run starts with are the rows in force, from model_prices", async () => {
    const rows = await loadPrices(conn);
    const haiku = rows.find((r) => r.model === "claude-haiku-5-5")!;
    expect(haiku).toMatchObject({ input_usd_per_mtok: 0.1, output_usd_per_mtok: 0.5, cache_read_usd_per_mtok: 0.01, cache_write_usd_per_mtok: 0.125 });
    expect(rows.filter((r) => r.model === "claude-haiku-5-5")).toHaveLength(1);   // one row per model: the latest
    await db.pg.exec(`insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, source) values ('claude-haiku-5-5', '2999-01-01', 9, 9, 'test: future')`);
    expect((await loadPrices(conn)).find((r) => r.model === "claude-haiku-5-5")!.input_usd_per_mtok).toBe(0.1);   // a price from the future is not in force
    await db.pg.exec(`delete from model_prices where source = 'test: future'`);
  });

  it("a run's tokens and dollars are written with its workflow, run id, step and cap", async () => {
    const prices = await loadPrices(conn);
    const m = new CostMeter({ workflow: "language-pack", runId: "9001-1", capUsd: 5, prices });
    m.add("claude-haiku-5-5", { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 2000 }, "after");   // 0.0001 + 0.0001 + 0.00005 + 0.00025
    m.add("claude-haiku-5-5", { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 }, "after");          // 0.0001 + 0.0001
    m.add("claude-sonnet-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, "also");
    expect(await recordRun(conn, m.toRecord())).toBe(2);
    const rows = await db.all<any>(`select model, step, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd::text, cap_usd::text, stopped_at_cap from model_costs where run_id = '9001-1' order by model`);
    expect(rows[0]).toMatchObject({ model: "claude-haiku-5-5", step: "after", calls: 2, input_tokens: 2000, output_tokens: 400, cache_read_tokens: 5000, cache_write_tokens: 2000, stopped_at_cap: false });
    expect(Number(rows[0].usd)).toBeCloseTo(0.0001 + 0.0001 + 0.00005 + 0.00025 + 0.0001 + 0.0001, 6);
    expect(Number(rows[1].usd)).toBeCloseTo(2, 6);     // a million input tokens on Sonnet at 2.00 a million
    expect(Number(rows[0].cap_usd)).toBe(5);
  });

  it("recording a run again replaces it; it does not add to it", async () => {
    const prices = await loadPrices(conn);
    const m = new CostMeter({ workflow: "images", runId: "9002-1", capUsd: 1, prices });
    m.add("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 });
    await recordRun(conn, m.toRecord()); await recordRun(conn, m.toRecord());
    const r = await db.one<any>(`select count(*)::int as n, sum(usd)::text as usd from model_costs where run_id = '9002-1'`);
    expect(r.n).toBe(1); expect(Number(r.usd)).toBeCloseTo(0.01, 6);
  });

  it("a run that stopped at its cap says so", async () => {
    const prices = await loadPrices(conn);
    const m = new CostMeter({ workflow: "product-data", runId: "9003-1", capUsd: 0.001, prices });
    m.add("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(m.refusal("claude-haiku-5-5")).toBeTruthy();
    await recordRun(conn, m.toRecord());
    expect((await db.one<any>(`select stopped_at_cap from model_costs where run_id = '9003-1'`)).stopped_at_cap).toBe(true);
  });

  it("refuses a line with no model or no dollars, and writes nothing", async () => {
    await expect(recordRun(conn, { workflow: "w", run_id: "9004-1", cap_usd: 1, stopped_at_cap: false, lines: [{ ...line(0), model: "" }] })).rejects.toThrow(/NEEDS_A_MODEL/);
    await expect(db.pg.query(`select record_model_cost('w', '9004-1', 1, false, '[{"model":"m","calls":1}]'::jsonb)`)).rejects.toThrow(/NEEDS_USD/);
    await expect(db.pg.query(`select record_model_cost('w', '9004-1', 1, false, '[{"model":"m","usd":-1}]'::jsonb)`)).rejects.toThrow();
    expect((await db.one<any>(`select count(*)::int as n from model_costs where run_id = '9004-1'`)).n).toBe(0);
  });

  it("the totals by workflow and day are in the views, apart from what an order costs", async () => {
    await db.pg.exec(`truncate model_costs`);
    await recordRun(conn, { workflow: "images", run_id: "a", cap_usd: 1, stopped_at_cap: false, lines: [line(0.25)] });
    await recordRun(conn, { workflow: "images", run_id: "b", cap_usd: 1, stopped_at_cap: true, lines: [line(0.5)] });
    await recordRun(conn, { workflow: "sim-test", run_id: "c", cap_usd: 33, stopped_at_cap: false, lines: [line(10)] });
    await db.pg.exec(`update model_costs set day = '2026-11-15'`);
    const wd = await db.all<any>(`select workflow, runs, calls, usd::text, runs_stopped_at_cap from ai_cost_workflow_daily where day = '2026-11-15' order by workflow`);
    expect(wd).toEqual([{ workflow: "images", runs: 2, calls: 6, usd: "0.750000", runs_stopped_at_cap: 1 }, { workflow: "sim-test", runs: 1, calls: 3, usd: "10.000000", runs_stopped_at_cap: 0 }]);
    const d = await db.one<any>(`select workflow_usd::text, workflow_by, usd::text from ai_cost_daily where day = '2026-11-15'`);
    expect(Number(d.workflow_usd)).toBe(10.75);
    expect(d.workflow_by).toEqual({ images: 0.75, "sim-test": 10 });
    expect(Number(d.usd)).toBe(0);                 // building is not what an order costs: usd and usd_per_order are the Worker's alone
  });

  it("ai_cost_daily keeps its old columns, in order, ahead of the new ones", async () => {
    const cols = (await db.all<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'ai_cost_daily' order by ordinal_position`)).map((c) => c.column_name);
    expect(cols).toEqual(["day", "runs", "unpriced_runs", "usd", "orders", "usd_per_order", "real_usd", "real_orders", "real_usd_per_order", "workflow_usd", "workflow_by"]);
  });

  it("the table is under row security, and prices read as numbers", async () => {
    const t = await db.all<{ rowsecurity: boolean }>(`select rowsecurity from pg_tables where tablename = 'model_costs'`);
    expect(t[0]!.rowsecurity).toBe(true);
    expect(normalisePrices([{ model: "m", effective_from: "2026-01-01", input_usd_per_mtok: "1", output_usd_per_mtok: "2" }])[0]!.long_context_above_tokens).toBeNull();
  });
});
