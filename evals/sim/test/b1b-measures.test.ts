// B1b: the four classes read from a conversation's turns (evals/sim/b1b-measures.ts).
import { describe, expect, it } from "vitest";
import { b1bMeasures, b1bSection } from "../b1b-measures";
import type { ConversationResult } from "../run";

const turn = (kind: string, replies: { kind?: string; text?: string; options?: { id: string; title: string }[] }[], extra: Record<string, unknown> = {}) =>
  ({ action: { kind }, replies: replies.map((r) => ({ kind: r.kind ?? "text", text: r.text ?? "", options: r.options ?? [] })), failures: [], path: null, ...extra });
const conv = (turns: unknown[], extra: Record<string, unknown> = {}) => ({ id: "sim-001", category: "plain_order", turns, failures: [], ...extra }) as unknown as ConversationResult;

describe("B1b measures", () => {
  it("the pin asked again after words, not after a pin", () => {
    expect(b1bMeasures(conv([turn("text", [{ kind: "location_request" }]), turn("text", [{ kind: "location_request" }])])).address).toBe(true);
    expect(b1bMeasures(conv([turn("text", [{ kind: "location_request" }]), turn("pin", [{ kind: "location_request" }])])).address).toBe(false);
  });
  it("the village buttons after a pin, and «a first order needs a pin»", () => {
    expect(b1bMeasures(conv([turn("pin", [{ kind: "buttons", options: [{ id: "pinvillage:x", title: "A" }] }])])).address).toBe(true);
    expect(b1bMeasures(conv([turn("text", [{ text: "For a first order we need your location" }])])).address).toBe(true);
  });
  it("language and message rules from the code checks; the off-topic line outside its scenarios", () => {
    const r = conv([turn("text", [{ text: "x" }], { path: "off_topic", failures: [{ code: "wrong_language", detail: "" }] })], { failures: [{ code: "message_rules", detail: "" }] });
    expect(b1bMeasures(r)).toEqual({ address: false, language: true, messageRules: true, offTopic: true });
    expect(b1bMeasures({ ...r, category: "off_topic" } as ConversationResult).offTopic).toBe(false);
    expect(b1bSection([r]).join("\n")).toContain("| message rules (fix 7) | 1 (100.0%) | 246 of 463");
  });
});
