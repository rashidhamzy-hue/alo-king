// 1.22: two ways the live fast model broke the extraction contract on the generated eval set (13 Nov 2026, 126 of 986 runs).
// Both readings were thrown away and the turn fell back to the question loop. Cases from the run, then the fix.
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { extractOrder, type ModelClient } from "../../packages/agents/src/concierge";
import { OrderIntent } from "../../packages/agents/src/schemas";
import { z } from "zod";

const answering = (input: unknown): ModelClient => ({ messages: { create: async () => ({
  id: "m", type: "message", role: "assistant", model: "t", stop_reason: "tool_use", stop_sequence: null,
  content: [{ type: "tool_use", id: "tu", name: "extract_order", input }], usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message) } });
const reading = { intent: "order", language: "arabizi",
  lines: [{ raw: "kees corn flour men Domo (l zghir 200g)", query: "kees corn flour Domo", qty: 1, unit: "bag", confidence: 0.9 }] };

describe("the extraction contract on the live model (1.22)", () => {
  it("a reading sent as a JSON string inside `intent` is read (g0006: 'expected object, received string')", async () => {
    const r = await extractOrder(answering({ intent: JSON.stringify({ ...reading, lines: [{ ...reading.lines[0], unit: "pack" }] }) }), "m", { texts: ["x"], transcripts: [], state: {} });
    expect(r.intent?.lines[0]?.raw).toBe("kees corn flour men Domo (l zghir 200g)");
  });
  it("an invented unit becomes 'each' instead of failing the reading (g0014: unit 'bag')", async () => {
    const r = await extractOrder(answering({ intent: reading }), "m", { texts: ["x"], transcripts: [], state: {} });
    expect(r.intent?.lines[0]?.unit).toBe("each");
  });
  it("the schema the model sees still lists the units", () => {
    const js = JSON.stringify(z.toJSONSchema(OrderIntent, { io: "input" }));
    expect(js).toContain('"half_kg"');
  });
  it("the intent alone as a bare word is that reading (B1b, language-pack run 43746499760: «merci, yislamo» -> \"greeting\")", async () => {
    const r = await extractOrder(answering({ intent: "greeting" }), "m", { texts: ["merci, yislamo"], transcripts: [], state: {} });
    expect(r.intent?.intent).toBe("greeting");
    expect(r.intent?.lines).toEqual([]);
  });
  it("a string that is not JSON is still refused", async () => {
    const r = await extractOrder(answering({ intent: "order: bread" }), "m", { texts: ["x"], transcripts: [], state: {} });
    expect(r.intent).toBeNull();
  });
});

describe("repairing a reading written as almost-JSON (1.22)", () => {
  it("an escaped apostrophe, a trailing comma and a missing closing bracket are repaired; nothing else", async () => {
    const { parseLooseJson } = await import("../../packages/agents/src/concierge");
    expect(parseLooseJson(`{"intent": "order", "lines": [{"raw": "corn flakes Kellogg\\'s", "qty": 1,}]`)).toEqual({ intent: "order", lines: [{ raw: "corn flakes Kellogg's", qty: 1 }] });
    expect(parseLooseJson(`{"intent": "order", "lines": [{"raw": "kilo tenders djej Tanmia"`)).toEqual({ intent: "order", lines: [{ raw: "kilo tenders djej Tanmia" }] });
    expect(parseLooseJson(`{"intent": "order", "lines": [{"raw": "kilo tend`)).toBeUndefined();     // cut inside a string
    expect(parseLooseJson("order: bread")).toBeUndefined();
  });
});

it("one closing brace too many at the end is dropped (72 of 1,972 live runs, 13 Nov)", async () => {
  const { parseLooseJson } = await import("../../packages/agents/src/concierge");
  expect(parseLooseJson(`{"intent": "order", "lines": [{"raw": "3elbe Pomi 500g", "qty": 1}], "fulfilment": "unknown", "language": "mixed"}}`))
    .toEqual({ intent: "order", lines: [{ raw: "3elbe Pomi 500g", qty: 1 }], fulfilment: "unknown", language: "mixed" });
});
