// Session B3 (ordering): 1.8, 1.13, 1.17, 2.9 on the real schema. Only the model (scripted) and Kapso's HTTP endpoint
// (a recorder) are replaced. 1.22 is in catalog-language.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, pinned, read, recordKapso, type Ids, type Sent } from "./flow-kit";
import { runTurn } from "../../apps/gateway/src/turn";
import { FIXED } from "@ak/agents/order-card";

let db: TestDb, ids: Ids;
beforeAll(async () => { ({ db, ids } = await openFlowDb()); }, 120_000);
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => vi.unstubAllGlobals());

const ORDER = { intent: "order", fulfilment: "delivery",
  lines: [{ raw: "علبتين لبنة ليبان ليه", query: "لبنة ليبان ليه", qty: 2, confidence: 0.9 }], address: { village: "بعقلين" } };

describe("model text is marked for the gateway's second check (A2's request)", () => {
  it("a reply the model wrote goes out with authored: model; the card written by code does not", async () => {
    const { use } = await import("./flow-kit");
    const t = flow(db, [read({ intent: "order", lines: [{ raw: "زقزوق مقرمش", query: "زقزوق مقرمش", qty: 1, confidence: 0.5 }] }),
                        [use("reply", { text: "ما لقيت هيدا عنا. شو بتحب بدالو؟" })]]);
    await t.customer();
    const reqs: any[] = [];
    const send = t.deps.send;
    await runTurn({ ...t.deps, send: async (r) => { reqs.push(r); return send(r); } }, t.pending({ type: "text", text: { body: "بدي زقزوق مقرمش" } }), {});
    expect(reqs.map((r) => r.authored?.by ?? null)).toEqual(["model"]);
  });
});

describe("typing indicator and a cap on model turns (1.8)", () => {
  it("the typing indicator goes on the message being answered, once, only when the model is needed", async () => {
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    const typing = vi.fn(async () => undefined);
    const p = t.pending({ type: "text", text: { body: "بدي علبتين لبنة ليبان ليه" } });
    await runTurn({ ...t.deps, typing }, p, {});
    expect(typing).toHaveBeenCalledTimes(1);
    expect(typing).toHaveBeenCalledWith(p[0]!.event.message.id);
    const tap = vi.fn(async () => undefined);
    await runTurn({ ...t.deps, typing: tap }, t.pending({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "marketing:no", title: "x" } } }), {});
    expect(tap).not.toHaveBeenCalled();                                 // a button needs no model, so no indicator
  });

  it("a typing indicator that fails never stops the turn", async () => {
    const t = flow(db, [read(ORDER)]);
    await pinned(db, t, ids.BAAKLINE);
    const r = await runTurn({ ...t.deps, typing: async () => { throw new Error("kapso down"); } }, t.pending({ type: "text", text: { body: "بدي لبنة" } }), {});
    expect(r.outcome).toBe("card");
  });

  it("past the hourly cap a person takes over: no model call, the customer is told, ops are alerted once an hour", async () => {
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 2}' where key = 'model_turns'`);
    const t = flow(db, [read(ORDER)]);
    const c = await pinned(db, t, ids.BAAKLINE);
    await db.pg.query(`insert into parties(role, display_name) values ('ops_lead', 'Ops') returning id`);
    for (let i = 0; i < 2; i++) await db.pg.query(`insert into agent_runs(agent, conversation_id, model, input_tokens, output_tokens, latency_ms, outcome)
                                                    values ('concierge', $1, 'fast', 900, 50, 1000, 'ok')`, [c.conversation_id]);
    expect(await db.rpc("model_turn_budget", { p_party: c.party_id })).toEqual({ allowed: false, used: 2, limit: 2 });
    await t.text("بدي كمان لبنة");
    expect(t.seen).toHaveLength(0);
    expect(outbound.map((o) => o.body.text?.body)).toContain(FIXED.handoff);
    expect((await db.one(`select human_handoff from conversations where id = $1`, [c.conversation_id])).human_handoff).toBe(true);
    expect(await db.all(`select kind from ops_exceptions where kind = 'model_turn_cap' and ref like $1`, [`${c.party_id}:%`])).toHaveLength(1);
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 20}' where key = 'model_turns'`);
  });

  it("answers that need no model are never capped", async () => {
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 0}' where key = 'model_turns'`);
    const t = flow(db, []);
    await t.customer();
    await t.text("وين صار طلبي؟");                                     // a quick intent, answered by the database
    expect(t.seen).toHaveLength(0);
    expect(outbound.map((o) => o.body.text?.body)).not.toContain(FIXED.handoff);
    await db.pg.exec(`update settings set value = '{"per_customer_per_hour": 20}' where key = 'model_turns'`);
  });
});
