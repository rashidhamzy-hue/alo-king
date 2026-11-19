// AST1: the console assistant's eval: twenty founder questions (questions.json) on the invented day of world.ts. Shared by the free test
// (a scripted model: test/assistant-eval.test.ts) and the one live run (live.assistant.test.ts, the real model, capped).
// A question's facts are graded by code: each must appear in the answer (a list: any one). A fact is wrong when it is missing, or when the
// turn did not answer (over the cap, failed, or an answer the honesty check refused). The kill-gate counts wrong facts over all questions.
import type Anthropic from "@anthropic-ai/sdk";
import type { TestDb } from "../../test/db/harness";
import { pgDb } from "../../apps/console/test/kit";
import { askAssistant, type ModelFn, type TurnResult } from "../../apps/console/src/assistant/run";
import { hasArabic, westernDigits } from "../../apps/console/src/assistant/guard";
import type { Role } from "../../apps/console/src/roles";
import data from "./questions.json";
import { NOW, fakeGithub, fakeSentry } from "./world";

export interface Question { id: string; role: Role; lang?: "en" | "ar"; q: string; tools: string[]; facts: (string | string[])[]; must_not: string[];
  script: { tools: { name: string; input: Record<string, unknown> }[]; answer: string } }
export const QUESTIONS = data.questions as Question[];
/** The kill-gate (AST1): more than this many wrong facts in the live run and the panel stays off. */
export const MAX_WRONG_FACTS = 2;

/** The scenario's caps: high enough that the eval is never stopped by the assistant's own daily cap (the live run has its own meter). */
export async function switchOn(db: TestDb) {
  await db.pg.exec(`update settings set value = value || '{"enabled": true, "daily_cap_usd": 5, "monthly_cap_usd": 20}'::jsonb where key = 'assistant'`);
}

/** A model that follows a question's script: first its tool calls (if any), then its answer. Usage is invented and small. */
export function scriptedModel(script: Question["script"]): ModelFn & { calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  const fn = (async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    calls.push(JSON.parse(JSON.stringify(params)));
    const usage = { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 } as Anthropic.Messages.Usage;
    const toolsDone = params.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => (b as { type: string }).type === "tool_result"));
    if (script.tools.length && !toolsDone && (params.tool_choice as { type: string } | undefined)?.type !== "none")
      return { model: params.model, stop_reason: "tool_use", usage, content: script.tools.map((t, i) => ({ type: "tool_use", id: `toolu_${i}`, name: t.name, input: t.input, caller: undefined })) as unknown as Anthropic.Messages.ContentBlock[] };
    return { model: params.model, stop_reason: "end_turn", usage, content: [{ type: "text", text: script.answer, citations: null }] as unknown as Anthropic.Messages.ContentBlock[] };
  }) as ModelFn & { calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] };
  fn.calls = calls;
  return fn;
}

const norm = (s: string) => westernDigits(s).toLowerCase();
export interface Graded { id: string; outcome: string; facts: number; wrong: string[]; missingTools: string[]; forbidden: string[]; language: boolean; answer: string; usd: number; tools: string[] }
export function grade(q: Question, r: TurnResult): Graded {
  const a = norm(r.answer);
  const answered = r.outcome === "answered" && !!r.answer;
  const wrong = q.facts.filter((f) => !answered || !(Array.isArray(f) ? f : [f]).some((x) => a.includes(norm(x)))).map((f) => (Array.isArray(f) ? f.join(" | ") : f));
  const called = r.tools.map((t) => t.name);
  return { id: q.id, outcome: r.outcome, facts: q.facts.length, wrong, missingTools: q.tools.filter((t) => !called.includes(t)),
    forbidden: q.must_not.filter((m) => a.includes(norm(m))), language: (q.lang ?? "en") === "ar" ? hasArabic(r.answer) : !hasArabic(r.answer),
    answer: r.answer, usd: r.usd, tools: called };
}

export async function runQuestion(db: TestDb, q: Question, model: ModelFn): Promise<{ r: TurnResult; g: Graded }> {
  const r = await askAssistant({ db: pgDb(db), model, role: q.role, question: q.q, lang: q.lang ?? "en", now: NOW, sentry: fakeSentry, github: fakeGithub });
  return { r, g: grade(q, r) };
}
