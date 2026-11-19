// AST1: one question, one answer. The model (claude-sonnet-5-5 by settings.assistant) may call the read-only tools of tools.ts for a few
// rounds, then answers; the code then checks every number against what the tools returned in this turn (guard.ts) before anyone sees it.
// Spend is priced by the database (ast_record_cost, model_prices) and counted against settings.assistant's daily and monthly caps (ast_spend)
// before every model call: over a cap the turn stops and says so. Nothing here writes outside the assistant's own log and cost rows.
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db";
import type { Role } from "../roles";
import { hasArabic, unsupportedNumbers } from "./guard";
import { runTool, toolsFor, type ToolEnv } from "./tools";
import { SYSTEM } from "./prompt";

type Msg = Anthropic.Messages.MessageParam;
type Block = Anthropic.Messages.ContentBlock;
/** The model, as one function: the real one calls the Messages API; tests and the eval's free run use a scripted one. */
export type ModelFn = (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => Promise<Pick<Anthropic.Messages.Message, "content" | "stop_reason" | "usage" | "model">>;

export function anthropicModel(apiKey: string, opts: { baseURL?: string; fetch?: typeof fetch } = {}): ModelFn {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}), ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  return (params) => client.messages.create(params);
}

export interface Spend { enabled: boolean; allowed: boolean; reason: string | null; day_usd: number; month_usd: number; daily_cap_usd: number; monthly_cap_usd: number;
  model: string; digest_model: string; max_tool_rounds: number }
export const readSpend = async (db: Db, now: Date) => normaliseSpend(await db.rpc<Record<string, unknown>>("ast_spend", { p_now: now.toISOString() }));
export function normaliseSpend(s: Record<string, unknown> | null): Spend {
  const n = (k: string) => Number(s?.[k] ?? 0);
  return { enabled: s?.enabled === true, allowed: s?.allowed === true, reason: (s?.reason as string | null) ?? null, day_usd: n("day_usd"), month_usd: n("month_usd"),
    daily_cap_usd: n("daily_cap_usd"), monthly_cap_usd: n("monthly_cap_usd"), model: String(s?.model ?? "claude-sonnet-5-5"),
    digest_model: String(s?.digest_model ?? "claude-haiku-5-5"), max_tool_rounds: Math.min(6, Math.max(1, n("max_tool_rounds") || 4)) };
}

export interface TurnInput {
  db: Db; model: ModelFn; role: Role; question: string; lang: "en" | "ar"; now: Date;
  /** Earlier questions and answers of this person (text only, oldest first): context, never a source of figures. */
  history?: { question: string; answer: string }[];
  sentry?: ToolEnv["sentry"]; github?: ToolEnv["github"];
}
export type Outcome = "answered" | "unverified" | "over_cap" | "off" | "failed";
export interface TurnResult { outcome: Outcome; answer: string; tools: { name: string; input: unknown; ok: boolean }[]; usd: number; model: string | null;
  unsupported: number[]; reason?: string | null; results: unknown[] }

const MAX_QUESTION = 600;

/** The day and time the model is told (Beirut): numbers in it count as given, as the tools' own do. */
export function clock(now: Date) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", weekday: "long" }).format(now);
  const y = new Date(now.getTime() - 86_400_000);
  return { day, time, weekday, yesterday: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(y) };
}

export async function askAssistant(t: TurnInput): Promise<TurnResult> {
  const question = t.question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
  const used: TurnResult["tools"] = [];
  const results: unknown[] = [];
  let usd = 0;
  let spend = await readSpend(t.db, t.now);
  const base = { tools: used, usd: 0, model: null as string | null, unsupported: [] as number[], results };
  if (!spend.enabled) return { ...base, outcome: "off", answer: "", reason: "off" };
  if (!spend.allowed) return { ...base, outcome: "over_cap", answer: "", reason: spend.reason };
  const env: ToolEnv = { db: t.db, now: t.now, role: t.role, sentry: t.sentry, github: t.github };
  const tools = toolsFor(env);
  if (!tools.length) return { ...base, outcome: "off", answer: "", reason: "role" };
  const toolDefs: Anthropic.Messages.Tool[] = tools.map((x, i) => ({ name: x.name, description: x.description, input_schema: x.input_schema as Anthropic.Messages.Tool.InputSchema,
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}) }));
  const lang = hasArabic(question) ? "ar" : /[a-z]/i.test(question) ? "en" : t.lang;
  const c = clock(t.now);
  const context = `Today is ${c.weekday} ${c.day}; the time in Beirut is ${c.time}; yesterday was ${c.yesterday}. The person asking is ${t.role === "admin" ? "the admin (every tool, money included)" : "an ops lead (operations only: money totals and model spend are for the admin, say so if asked)"}. Answer in ${lang === "ar" ? "Arabic" : "English"}.`;
  const messages: Msg[] = [];
  for (const h of (t.history ?? []).slice(-3)) {
    messages.push({ role: "user", content: h.question.slice(0, MAX_QUESTION) }, { role: "assistant", content: h.answer.slice(0, 1500) || "-" });
  }
  messages.push({ role: "user", content: `${context}\n\nQuestion: ${question}` });
  const system: Anthropic.Messages.TextBlockParam[] = [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }];

  let model: string | null = null;
  const call = async (toolChoice: "auto" | "none"): Promise<Block[] | "over_cap"> => {
    spend = await readSpend(t.db, t.now);
    if (!spend.allowed) return "over_cap";
    const res = await t.model({ model: spend.model, max_tokens: 4000, system, tools: toolDefs, tool_choice: { type: toolChoice }, messages,
      output_config: { effort: "medium" } } as Anthropic.Messages.MessageCreateParamsNonStreaming);
    model = res.model ?? spend.model;
    const u = res.usage;
    usd += Number(await t.db.rpc("ast_record_cost", { p_workflow: "assistant", p_model: spend.model, p_step: "answer", p_in: u?.input_tokens ?? 0, p_out: u?.output_tokens ?? 0,
      p_cache_read: u?.cache_read_input_tokens ?? 0, p_cache_write: u?.cache_creation_input_tokens ?? 0 }));
    if (res.stop_reason === "refusal") throw new Error("refusal");
    return res.content;
  };
  const textOf = (content: Block[]) => content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  try {
    let answer = "";
    for (let round = 0; round <= spend.max_tool_rounds; round++) {
      const content = await call(round < spend.max_tool_rounds ? "auto" : "none");
      if (content === "over_cap") return { ...base, usd, model, outcome: "over_cap", answer: "", reason: spend.reason };
      const calls = content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      messages.push({ role: "assistant", content });
      if (!calls.length) { answer = textOf(content); break; }
      const outs = await Promise.all(calls.map(async (b) => {
        const r = await runTool(env, b.name, b.input);
        used.push({ name: b.name, input: b.input, ok: r.ok });
        results.push(r.result);
        return { type: "tool_result" as const, tool_use_id: b.id, content: JSON.stringify(r.result).slice(0, 60_000), ...(r.ok ? {} : { is_error: true }) };
      }));
      messages.push({ role: "user", content: outs });
    }
    // The honesty check: every figure from this turn's tool results (or the question, or today's date and time).
    const sources = [...results.map((r) => JSON.stringify(r)), question, context];
    let bad = unsupportedNumbers(answer, sources);
    if (bad.length && answer) {
      messages.push({ role: "user", content: `These figures are not in this turn's tool results: ${bad.join(", ")}. Rewrite the answer using only figures that appear in the tool results above; where a figure is not there, say the data does not show it. Do not compute new figures.` });
      const again = await call("none");
      if (again === "over_cap") return { ...base, usd, model, outcome: "over_cap", answer: "", reason: spend.reason };
      answer = textOf(again);
      bad = unsupportedNumbers(answer, sources);
    }
    if (!answer) return { ...base, usd, model, outcome: "failed", answer: "", unsupported: [] };
    return { ...base, usd, model, outcome: bad.length ? "unverified" : "answered", answer, unsupported: bad };
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "assistant_turn_failed", err: String((e as Error)?.message ?? e).slice(0, 200) }));
    return { ...base, usd, model, outcome: "failed", answer: "" };
  }
}
