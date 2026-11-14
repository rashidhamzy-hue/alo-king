// Session A4, audit 14 Nov item 6: agent_runs stored tokens but no cost, so cost per order (4.11) could not be read.
// Prices are data (model_prices, dated); agent_run_costs prices each run with the price in force that day; ai_cost_daily gives
// the day's AI cost, orders and cost per order, with the staging probe kept apart. A run with no price is unpriced, never $0.
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb;
let realConv: string, probeConv: string;
const run = (conv: string | null, model: string | null, input: number, output: number, at: string) => db.pg.query(
  `insert into agent_runs(agent, conversation_id, model, input_tokens, output_tokens, latency_ms, outcome, created_at) values ('concierge', $1, $2, $3, $4, 5000, 'ok', $5::timestamptz)`,
  [conv, model, input, output, at]);

beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  const real = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  const probe = (await db.one(`insert into parties(role, is_probe) values ('customer', true) returning id`)).id;
  realConv = (await db.one(`insert into conversations(line, party_id) values ('customer', $1) returning id`, [real])).id;
  probeConv = (await db.one(`insert into conversations(line, party_id) values ('customer', $1) returning id`, [probe])).id;
  // 15 Nov (Beirut): two real turns, one probe turn, one turn with no model (a pin), one on a model with no price
  await run(realConv, "claude-haiku-5-5", 5000, 1200, "2026-11-15T08:00:00Z");
  await run(realConv, "claude-haiku-5-5", 1000, 300, "2026-11-15T08:05:00Z");
  await run(probeConv, "claude-haiku-5-5", 4000, 1000, "2026-11-15T09:00:00Z");
  await run(realConv, "claude-haiku-5-5", 0, 0, "2026-11-15T08:06:00Z");
  await run(realConv, "claude-unknown-9", 1000, 1000, "2026-11-15T10:00:00Z");
  await db.pg.query(`insert into orders(short_code, customer_id, conversation_id, status, created_at) values ('C1', $1, $2, 'closed', '2026-11-15T08:06:00Z')`, [real, realConv]);
  await db.pg.query(`insert into orders(short_code, customer_id, conversation_id, status, created_at) values ('C2', $1, $2, 'closed', '2026-11-15T09:01:00Z')`, [probe, probeConv]);
}, 60_000);

describe("AI cost from agent_runs (audit item 6)", () => {
  it("the prices are data, dated, for both models the Worker uses", async () => {
    const p = await db.all<{ model: string; input_usd_per_mtok: string; output_usd_per_mtok: string }>(
      `select model, input_usd_per_mtok::text, output_usd_per_mtok::text from model_prices where model in ('claude-haiku-5-5', 'claude-sonnet-5-5') order by model`);
    expect(p.map((x) => [x.model, Number(x.input_usd_per_mtok), Number(x.output_usd_per_mtok)]))
      .toEqual([["claude-haiku-5-5", 0.1, 0.5], ["claude-sonnet-5-5", 2, 10]]);
  });

  it("each run is priced at the rate of its day; a model with no price is unpriced, not free", async () => {
    const rows = await db.all<{ input_tokens: number; usd: string | null; priced: boolean }>(
      `select r.input_tokens, c.usd::text, c.priced from agent_run_costs c join agent_runs r on r.id = c.run_id order by r.created_at`);
    // 5000 in, 1200 out on Haiku 5.5: 5000 * 0.10 / 1e6 + 1200 * 0.50 / 1e6 = 0.0005 + 0.0006
    expect(Number(rows[0]!.usd)).toBeCloseTo(0.0011, 10);
    expect(rows.find((r) => r.input_tokens === 0)!.usd).toBe("0.0000000000");
    const unknown = rows.at(-1)!;
    expect(unknown).toMatchObject({ priced: false, usd: null });
  });

  it("a new price applies from its date, and earlier runs keep the old one", async () => {
    await db.pg.exec(`insert into model_prices(model, effective_from, input_usd_per_mtok, output_usd_per_mtok, source) values ('claude-haiku-5-5', '2026-11-16', 1, 1, 'test')`);
    await run(realConv, "claude-haiku-5-5", 1_000_000, 0, "2026-11-16T08:00:00Z");
    const later = await db.one<{ usd: string }>(`select c.usd::text from agent_run_costs c join agent_runs r on r.id = c.run_id where r.input_tokens = 1000000`);
    expect(Number(later.usd)).toBe(1);
    const first = await db.one<{ usd: string }>(`select c.usd::text from agent_run_costs c join agent_runs r on r.id = c.run_id where r.input_tokens = 5000`);
    expect(Number(first.usd)).toBeCloseTo(0.0011, 10);
    await db.pg.exec(`delete from model_prices where source = 'test'`);
  });

  it("cost per order, by day, with the probe kept apart", async () => {
    const d = await db.one<any>(`select * from ai_cost_daily where day = '2026-11-15'`);
    expect(d.runs).toBe(5);
    expect(d.unpriced_runs).toBe(1);
    expect(d.orders).toBe(2);
    expect(Number(d.usd)).toBeCloseTo(0.0011 + 0.00025 + 0.0009, 10);
    expect(d.real_orders).toBe(1);
    expect(Number(d.real_usd)).toBeCloseTo(0.0011 + 0.00025, 10);
    expect(Number(d.real_usd_per_order)).toBeCloseTo(0.00135, 10);
  });

  it("clients cannot read the prices or the costs", async () => {
    for (const v of ["model_prices", "agent_run_costs", "ai_cost_daily"]) {
      expect(await db.all(`select grantee from information_schema.role_table_grants where table_name = $1 and grantee in ('anon', 'authenticated')`, [v])).toEqual([]);
    }
  });
});
