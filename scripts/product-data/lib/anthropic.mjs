// One forced tool call to the fast model. The model answers only by calling the tool; the caller validates every field.
// Token use is counted so a run can say what it spent.
import { fetchRetry } from "./http.mjs";

export class Fatal extends Error {}

export function newUsage() { return { calls: 0, input_tokens: 0, output_tokens: 0 }; }

/** Returns the tool's input. Throws Fatal for a request or key problem (retrying will not help), Error otherwise. */
export async function callTool({ apiKey, model, system, tool, content, maxTokens = 2000, usage = null, fetchImpl = fetch, retries = 3 }) {
  const body = { model, max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: "tool", name: tool.name }, messages: [{ role: "user", content }] };
  const res = await fetchRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { fetchImpl, timeoutMs: 90000, retries });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if ([400, 401, 403, 404].includes(res.status)) throw new Fatal(`model_http_${res.status}: ${detail}`);
    throw new Error(`model_http_${res.status}`);
  }
  const out = await res.json();
  if (usage) { usage.calls++; usage.input_tokens += out.usage?.input_tokens ?? 0; usage.output_tokens += out.usage?.output_tokens ?? 0; }
  const block = (out.content ?? []).find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!block?.input || typeof block.input !== "object") throw new Error("model_no_tool_call");
  return block.input;
}
