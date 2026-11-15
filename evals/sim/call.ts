// SIM1: the simulator's and the judge's request to Sonnet, with the optional features dropped one at a time if the API refuses
// the request shape (HTTP 400 naming that feature). The run says which were dropped. Nothing else is retried here.
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../../packages/agents/src/concierge";

export interface Features { format: boolean; autoCache: boolean; thinkingOff: boolean; dropped: string[] }
export const newFeatures = (): Features => ({ format: true, autoCache: true, thinkingOff: true, dropped: [] });

export async function sonnet(client: ModelClient, f: Features, base: { model: string; max_tokens: number; system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[]; effort: "low" | "medium"; schema: Record<string, unknown> }): Promise<string> {
  for (let tries = 0; tries < 4; tries++) {
    const body = {
      model: base.model, max_tokens: base.max_tokens, system: base.system, messages: base.messages,
      ...(f.thinkingOff ? { thinking: { type: "between_tools" } } : {}),
      ...(f.autoCache ? { cache_control: { type: "ephemeral" } } : {}),
      output_config: { effort: base.effort, ...(f.format ? { format: { type: "json_schema", schema: base.schema } } : {}) },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming;
    try {
      const res = await client.messages.create(body);
      if (res.stop_reason === "refusal") return "";
      return res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
    } catch (e) {
      const status = (e as { status?: number }).status;
      const msg = String((e as Error).message ?? e);
      if (status !== 400) throw e;
      if (f.format && /format|schema|output_config/i.test(msg)) { f.format = false; f.dropped.push(`structured output (${msg.slice(0, 80)})`); continue; }
      if (f.autoCache && /cache_control/i.test(msg)) { f.autoCache = false; f.dropped.push(`top-level cache_control (${msg.slice(0, 80)})`); continue; }
      if (f.thinkingOff && /thinking|between_tools/i.test(msg)) { f.thinkingOff = false; f.dropped.push(`thinking between_tools (${msg.slice(0, 80)})`); continue; }
      throw e;
    }
  }
  throw new Error("SONNET_REQUEST_REFUSED: the API refused every request shape");
}
