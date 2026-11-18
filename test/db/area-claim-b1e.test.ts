// B1e: sim-021 through the real turn code (evals/cases/b1e_area_claims.json). The model's "we don't deliver to Botmeh" is refused when no
// tool said so this turn, and refused in English to an Arabizi customer; what a tool returned may be said back. The gateway checks again.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "./harness";
import { flow, openFlowDb, read, recordKapso, use, type Sent } from "./flow-kit";

let db: TestDb;
beforeAll(async () => { ({ db } = await openFlowDb()); }, 120_000);
afterAll(async () => { await db?.pg.close(); });
let outbound: Sent[];
beforeEach(() => { outbound = recordKapso(); });
afterEach(() => { vi.unstubAllGlobals(); });

const bodyOf = (s: Sent): string => s.body.text?.body ?? s.body.interactive?.body?.text ?? "";
const noAddress = { village: null, landmark: null, building: null, floor: null, recipient_name: null, verbatim: null };
const refusals = async (conversationId: string) =>
  (await db.all(`select trace->>'code' as code from agent_runs where agent = 'output_guard' and conversation_id = $1`, [conversationId])).map((r) => r.code);

describe("B1e: where we deliver is the database's to say (sim-021)", () => {
  it("«Ma fi tawseel la Botmeh» with no tool's answer is refused; the reworded question goes out", async () => {
    const t = flow(db, [
      read({ intent: "question", language: "arabizi", lines: [], address: noAddress }),
      [use("reply", { text: "Ma fi tawseel la Botmeh lal2an, lal2ayf. Shu baddak ta3mel?" })],
      [use("reply", { text: "Not yet: we don't deliver to Botmeh, and we're closed now until 08:00." })],
      [use("reply", { text: "Shu esm el balde? Aw ba3atle location pin." })],
    ]);
    const c = await t.customer();
    await t.text("baddi a3ref iza fi tawsil, shu sar bel order?");
    const all = outbound.map(bodyOf).join("\n");
    expect(all).toContain("Shu esm el balde?");
    expect(all).not.toMatch(/tawseel la Botmeh|deliver to Botmeh/u);
    expect(await refusals(c.conversation_id)).toEqual(["area_claim", "area_claim"]);
  });

  it("the answer resolve_place gave this turn may be said back, for that place", async () => {
    const t = flow(db, [
      read({ intent: "question", language: "arabizi", lines: [], address: noAddress }),
      [use("resolve_place", { village: "Baakline" })],
      [use("reply", { text: "Eh, mnwassel 3a Baakline. Shu baddak?" })],
    ]);
    const c = await t.customer();
    await t.text("baddi a3ref iza fi tawsil 3a Baakline, shu?");
    expect(outbound.map(bodyOf).join("\n")).toContain("mnwassel 3a Baakline");
    expect(await refusals(c.conversation_id)).toEqual([]);
  });

  it("English to an Arabizi customer is refused; the Arabizi reply goes out", async () => {
    const t = flow(db, [
      read({ intent: "question", language: "arabizi", lines: [], address: noAddress }),
      [use("reply", { text: "Not yet, the order is not ready. Do you want to add something?" })],
      [use("reply", { text: "Mesh jehez ba3d. Baddak tzid shi?" })],
    ]);
    const c = await t.customer();
    await t.text("baddi a3ref iza l order jehez, shu sar?");
    const all = outbound.map(bodyOf).join("\n");
    expect(all).toContain("Mesh jehez ba3d");
    expect(all).not.toContain("Not yet");
    expect(await refusals(c.conversation_id)).toEqual(["wrong_language"]);
  });
});
