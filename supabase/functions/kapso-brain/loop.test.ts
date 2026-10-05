import { describe, expect, it } from "vitest";
import { agentLoop } from "./loop.ts";
import { LATENCY_TARGETS } from "./timing.ts";

type Step = { tool?: { name: string; input?: any }[]; text?: string };
// A scripted "model": each call returns the next step as an Anthropic-shaped response.
function script(steps: Step[]) {
  let i = 0; const seen: any[][] = [];
  return {
    seen, calls: () => i,
    call: async (messages: any[]) => {
      seen.push(JSON.parse(JSON.stringify(messages)));
      const st = steps[Math.min(i++, steps.length - 1)];
      const content: any[] = [];
      if (st.text) content.push({ type: "text", text: st.text });
      (st.tool ?? []).forEach((t, k) => content.push({ type: "tool_use", id: `t${i}_${k}`, name: t.name, input: t.input ?? {} }));
      return { content, stop_reason: st.tool?.length ? "tool_use" : "end_turn" };
    },
  };
}
const TERMINAL = JSON.stringify({ ok: true, basket_card_sent: true, terminal: true, instruction: "Reply with nothing." });
const run = (results: Record<string, string>) => async (n: string) => results[n] ?? JSON.stringify({ error: "unknown" });
const decl = () => true;

describe("agentLoop: model calls per turn", () => {
  it("add_items with SERVER MATCHES: ONE model call (the card is the answer)", async () => {
    const m = script([{ tool: [{ name: "add_items", input: { vendor_id: "king", items: [{ item_id: "a", quantity: 2 }, { item_id: "b", quantity: 1 }] } }] }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "2 shawarma and fries" }], call: m.call, run: run({ add_items: TERMINAL }), isDeclared: decl });
    expect(m.calls()).toBe(1); expect(r.calls).toBe(1);
    expect(r.calls).toBeLessThanOrEqual(LATENCY_TARGETS.freeTextModelCalls);
  });
  it("up to three present_offer cards in one response: still one call", async () => {
    const m = script([{ tool: [1, 2, 3].map((n) => ({ name: "present_offer", input: { n } })) }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "x" }], call: m.call, run: async () => JSON.stringify({ ok: true, card_sent: true, terminal: true }), isDeclared: decl });
    expect(r.calls).toBe(1);
  });
  it("without retrieval a single dish still costs search + add = 2 calls (the old way also paid a third, empty, call)", async () => {
    const m = script([{ tool: [{ name: "search_menu" }] }, { tool: [{ name: "basket_add" }] }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "a shawarma" }], call: m.call, run: run({ search_menu: JSON.stringify({ count: 3 }), basket_add: JSON.stringify({ ok: true, instruction: "Basket card already delivered. Reply with nothing." }) }), isDeclared: decl });
    expect(r.calls).toBe(2);
  });
  it("an error result goes back to the model, which explains in a second call", async () => {
    const m = script([{ tool: [{ name: "add_items" }] }, { text: "That one needs a sauce: garlic or spicy?" }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "x" }], call: m.call, run: run({ add_items: JSON.stringify({ ok: false, failed: [{ error: "choose 1" }] }) }), isDeclared: decl });
    expect(r.calls).toBe(2); expect(r.final).toContain("garlic");
    expect(JSON.stringify(m.seen[1])).toContain("tool_result");
  });
  it("a non-terminal tool (search) always needs the follow-up call", async () => {
    const m = script([{ tool: [{ name: "search_menu" }] }, { tool: [{ name: "present_offer" }] }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "something light" }], call: m.call, run: async (n) => (n === "present_offer" ? JSON.stringify({ ok: true, card_sent: true, terminal: true }) : JSON.stringify({ count: 2 })), isDeclared: decl });
    expect(r.calls).toBe(2);
  });
  it("a mixed batch (one terminal, one not) is not terminal", async () => {
    const m = script([{ tool: [{ name: "add_items" }, { name: "get_vendor_info" }] }, { text: "ok" }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "x" }], call: m.call, run: run({ add_items: TERMINAL, get_vendor_info: JSON.stringify({ vendor: {} }) }), isDeclared: decl });
    expect(r.calls).toBe(2);
  });
  it("undeclared tools are refused with an error result and the loop continues", async () => {
    const m = script([{ tool: [{ name: "rm_rf" }] }, { text: "sorry" }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "x" }], call: m.call, run: async () => "NEVER", isDeclared: (n) => n !== "rm_rf" });
    expect(r.calls).toBe(2); expect(JSON.stringify(m.seen[1])).toContain("tool not available");
  });
  it("is capped at 7 calls", async () => {
    const m = script([{ tool: [{ name: "search_menu" }] }]);
    const r = await agentLoop({ messages: [{ role: "user", content: "x" }], call: m.call, run: async () => JSON.stringify({ count: 1 }), isDeclared: decl });
    expect(r.calls).toBe(7);
  });
  it("returns the model's text when it answers without tools", async () => {
    const r = await agentLoop({ messages: [{ role: "user", content: "hi" }], call: script([{ text: "Welcome 👑" }]).call, run: run({}), isDeclared: decl });
    expect(r).toEqual({ final: "Welcome 👑", calls: 1 });
  });
});
