// SIM1: stand-in models for the dry run (SIM_MOCK=1) and the tests: the plumbing (copy, guard, turn code, checks, budget, report)
// runs end to end with no API key and no cost to anyone. They are crude on purpose; they prove the wiring, not the Concierge.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../../packages/agents/src/concierge";

const msg = (content: unknown[], usage = { input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }): Anthropic.Message =>
  ({ id: "msg_mock", type: "message", role: "assistant", model: "mock", content, stop_reason: content.some((c: any) => c.type === "tool_use") ? "tool_use" : "end_turn",
     stop_sequence: null, usage } as unknown as Anthropic.Message);
const lastUser = (body: Anthropic.MessageCreateParamsNonStreaming): string => {
  const u = [...body.messages].reverse().find((m) => m.role === "user");
  if (!u) return "";
  return typeof u.content === "string" ? u.content : u.content.map((b: any) => (b.type === "text" ? b.text : b.type === "tool_result" ? JSON.stringify(b.content) : "")).join(" ");
};

/** Reads "item, item - deliver to Village" into the reading; answers every other call with one short reply. */
export function mockConcierge(): ModelClient {
  let n = 0;
  return { messages: { create: async (body) => {
    const tc = body.tool_choice as { type?: string; name?: string } | undefined;
    if (tc?.name === "extract_order") {
      const text = lastUser(body);
      const said = (text.match(/"texts":\["([^"]*)"/)?.[1] ?? text.match(/"primary":"([^"]*)"/)?.[1] ?? "").replace(/\\n/g, " ");
      const [items, where] = said.split(" - deliver to ");
      const lines = (items ?? "").split(/,\s*/).map((q) => q.trim()).filter((q) => q.length > 1 && !/^stop$/i.test(q))
        .map((q) => ({ raw: q, query: q, qty: 1, confidence: 0.9 }));
      const intent = { intent: lines.length ? "order" : "question", language: "en", lines, fulfilment: "delivery", address: { village: where?.trim() || null } };
      return msg([{ type: "tool_use", id: `tu_m${++n}`, name: "extract_order", input: { intent } }]);
    }
    return msg([{ type: "tool_use", id: `tu_m${++n}`, name: "reply", input: { text: "Which one would you like?" } }]);
  } } };
}

/** Sends the scenario's items, taps the first offered option (the card's confirm), sends a pin when asked, then stops. */
export function mockCustomer(itemsFor: (system: string) => string): ModelClient {
  return { messages: { create: async (body) => {
    const sys = (body.system as Anthropic.TextBlockParam[]).map((b) => b.text).join("\n");
    const shop = lastUser(body);
    const turns = body.messages.filter((m) => m.role === "assistant").length;
    let move: Record<string, unknown>;
    if (turns === 0) move = { action: "text", text: itemsFor(sys), texts: null, option: null, goal: "in_progress" };
    else if (turns >= 5) move = { action: "done", text: null, texts: null, option: null, goal: "impossible" };
    else if (/Send location/.test(shop) || (turns === 1 && !/\[b\d+\]/.test(shop))) move = { action: "pin", text: null, texts: null, option: null, goal: "in_progress" };
    else {
      const ref = shop.match(/\[(b\d+)\]/)?.[1];
      move = ref ? { action: "tap", text: null, texts: null, option: ref, goal: "in_progress" } : { action: "done", text: null, texts: null, option: null, goal: "reached" };
    }
    return msg([{ type: "text", text: JSON.stringify(move) }], { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 });
  } } };
}

export function mockJudge(): ModelClient {
  return { messages: { create: async (body) => {
    const text = lastUser(body);
    const confirmed = /"status":"(confirmed|awaiting_payment|preparing)"/.test(text);
    const v = { goal_reached: confirmed, wrong_or_uninvited_product: false, invented_fact: false, rating_praise_health: false, dead_end: !confirmed,
                repeated_question: false, natural_dialect: true, turns_to_card: confirmed ? 1 : null, severity: confirmed ? 1 : 2,
                problems: confirmed ? [] : ["mock: no confirmed order"], summary: "mock verdict" };
    return msg([{ type: "text", text: JSON.stringify(v) }], { input_tokens: 2000, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  } } };
}
