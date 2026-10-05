// The model/tool loop, with the model injected so call counts are testable. A turn stops as soon as every tool result in a batch is terminal
// (the customer-facing card was already sent), instead of paying for a model call that would only say "nothing".
import { allTerminal } from "./trim.ts";

export type LoopOpts = {
  messages: any[];
  call: (messages: any[]) => Promise<any>; // one model request; returns the API response (content, stop_reason)
  run: (name: string, input: any) => Promise<string>;
  isDeclared: (name: string) => boolean;
  maxIter?: number;
};
export async function agentLoop(o: LoopOpts): Promise<{ final: string; calls: number }> {
  const messages = o.messages; let final = "", calls = 0;
  for (let i = 0; i < (o.maxIter ?? 7); i++) {
    const data = await o.call(messages); calls++;
    messages.push({ role: "assistant", content: data.content });
    const uses = (data.content ?? []).filter((b: any) => b.type === "tool_use");
    final = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (data.stop_reason !== "tool_use" || !uses.length) break;
    const results: any[] = [];
    for (const u of uses) {
      const ok = o.isDeclared(u.name);
      results.push({ type: "tool_result", tool_use_id: u.id, content: ok ? await o.run(u.name, u.input) : JSON.stringify({ error: "tool not available" }), ...(ok ? {} : { is_error: true }) });
    }
    if (allTerminal(results.map((r) => r.content))) break;
    messages.push({ role: "user", content: results });
  }
  return { final, calls };
}
