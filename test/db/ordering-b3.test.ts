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
