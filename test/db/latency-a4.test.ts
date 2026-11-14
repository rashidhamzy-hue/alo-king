// Session A4, audit 14 Nov item 3 (measure only; lane B fixes): how long the Concierge takes, by path, from agent_runs.
// agent_latency: p50, p90 and max of latency_ms (the turn itself) per day, model and path, with the mean tokens per run.
// turn_waits: for each Concierge turn, the wait before it started (webhook stored -> turn start, which includes the burst buffer)
// and the whole reply time the customer saw (webhook stored -> run recorded at the end of the turn).
import { beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "./harness";

let db: TestDb;
let conv: string;
beforeAll(async () => {
  db = await openTestDb({ seeds: false });
  const party = (await db.one(`insert into parties(role) values ('customer') returning id`)).id;
  await db.pg.query(`insert into party_identities(party_id, line, wa_user_id) values ($1, 'customer', 'LB.LAT')`, [party]);
  conv = (await db.one(`insert into conversations(line, party_id, last_inbound_at) values ('customer', $1, now()) returning id`, [party])).id;
  const run = (path: string, ms: number, out: number, at: string) => db.pg.query(
    `insert into agent_runs(agent, conversation_id, model, input_tokens, output_tokens, latency_ms, outcome, trace, created_at)
     values ('concierge', $1, 'claude-haiku-5-5', 1000, $2, $3, 'ok', jsonb_build_object('path', $4::text), $5::timestamptz)`, [conv, out, ms, path, at]);
  // ten "card" turns of 5.0 .. 5.9 s; ten "ask" turns of 9 .. 13.5 s (two model calls), as on staging 13-14 Nov
  for (let i = 0; i < 10; i++) await run("card", 5000 + i * 100, 300, `2026-11-14T08:0${i}:00Z`);
  for (let i = 0; i < 10; i++) await run("ask", 9000 + i * 500, 1200, `2026-11-14T09:0${i}:00Z`);
  // the founder's message of 14 Nov: stored at 05:00:15.0, the turn took 13.4 s and ended at 05:00:36.8
  await db.pg.query(`insert into wa_inbound_events(idempotency_key, line, event, payload, received_at)
     values ('lat-1', 'customer', 'whatsapp.message.received', jsonb_build_object('message', jsonb_build_object('id', 'wamid.LAT1', 'from_user_id', 'LB.LAT', 'type', 'text')), '2026-11-14T05:00:15.0Z')`);
  await run("ask", 13433, 1152, "2026-11-14T05:00:36.8Z");
}, 60_000);

describe("latency, measured (audit item 3)", () => {
  it("p50 and p90 per path, from latency_ms", async () => {
    const rows = await db.all<{ path: string; runs: number; p50_ms: number; p90_ms: number; max_ms: number; out_tokens: number }>(
      `select path, runs, p50_ms, p90_ms, max_ms, out_tokens from agent_latency where agent = 'concierge' and day = '2026-11-14' order by path`);
    const card = rows.find((r) => r.path === "card")!, ask = rows.find((r) => r.path === "ask")!;
    expect(card).toMatchObject({ runs: 10, p50_ms: 5450, max_ms: 5900, out_tokens: 300 });
    expect(card.p90_ms).toBe(5810);
    expect(ask.runs).toBe(11);
    expect(ask.max_ms).toBe(13500);
    expect(ask.p50_ms).toBe(11500);
  });

  it("the wait before the turn and the whole reply time the customer saw", async () => {
    const w = await db.one<{ wait_ms: number; turn_ms: number; reply_ms: number }>(
      `select wait_ms, turn_ms, reply_ms from turn_waits where conversation_id = $1 and turn_ms = 13433`, [conv]);
    expect(w.turn_ms).toBe(13433);
    expect(w.reply_ms).toBe(21800);
    expect(w.wait_ms).toBe(21800 - 13433);
  });

  it("clients cannot read either view", async () => {
    for (const v of ["agent_latency", "turn_waits"]) {
      const grants = await db.all(`select grantee from information_schema.role_table_grants where table_name = $1 and grantee in ('anon', 'authenticated')`, [v]);
      expect(grants).toEqual([]);
    }
  });
});
