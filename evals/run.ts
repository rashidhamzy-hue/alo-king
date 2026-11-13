// Scoring helpers for the voice-note evaluation. The extraction to score is extractOrder() in packages/agents/src/concierge.ts.
export interface TruthLine { item: string; qty: number; modifiers: string[]; source: string | null }
export interface Score { recall: number; precision: number; invented: number; qtyAccuracy: number }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));

export function scoreLines(truth: TruthLine[], got: { query: string; qty: number }[]): Score {
  const used = new Set<number>();
  let hits = 0, qtyOk = 0;
  for (const t of truth) {
    const i = got.findIndex((g, idx) => !used.has(idx) && same(g.query, t.item));
    if (i >= 0) { used.add(i); hits++; if (got[i]!.qty === t.qty) qtyOk++; }
  }
  return {
    recall: truth.length ? hits / truth.length : 1,
    precision: got.length ? hits / got.length : 1,
    invented: got.length - hits,
    qtyAccuracy: hits ? qtyOk / hits : 1,
  };
}

// ---------- Concierge wording cases (1.10 neutral and food facts, 1.18 stay on the job) ----------
// Runs the real ask loop on each case's customer message, with tools that return only the case's facts, and records the first
// reply the model tries and what the output guard says about it. A person grades `must` / `must_not` from the report.
// Live only: needs a model. `ALO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... npx vitest run evals/live` (see evals/README.md).
import { runAskLoop, type ConciergeTools, type ModelClient } from "../packages/agents/src/concierge";
import { checkModelText } from "../packages/agents/src/output-guard";

export interface WordingCase { id: string; customer: string; facts: string[]; approved?: string[] }
export interface WordingResult { id: string; attempts: { tool: string; text: string; refused: string | null }[]; sent: string | null; handoff: boolean }

export async function runWordingCase(client: ModelClient, model: string, c: WordingCase): Promise<WordingResult> {
  const approved = new Set(c.approved ?? []);
  const out: WordingResult = { id: c.id, attempts: [], sent: null, handoff: false };
  const speak = (tool: string) => async ({ text }: { text: string }) => {
    const v = checkModelText(text, { approvedFacts: approved });
    out.attempts.push({ tool, text, refused: v?.code ?? null });
    if (v) return { ok: false, error: `refused:${v.code}` };
    out.sent = text; return { ok: true };
  };
  const none = async () => ({ ok: false, error: "not_available_in_this_eval" });
  const tools: ConciergeTools = {
    search_catalog: async () => ({ reason: null, matches: [], facts: c.facts }),
    resolve_place: none, quote_order: none, ask_location_pin: speak("ask_location_pin"), send_confirmation: none,
    food_facts: async () => ({ products: [], facts: c.facts, approved_attributes: [...approved] }),
    reply: speak("reply"),
    handoff_human: async () => { out.handoff = true; return { ok: true }; },
  };
  await runAskLoop(client, model, { texts: [c.customer], transcripts: [], state: { facts_from_tools: c.facts }, reading: null, plan: null }, tools);
  return out;
}

// ---------- Reading cases (1.18 stay on the job) ----------
// The forced extraction on one message, compared with the expected class. Live only, like runWordingCase.
import { extractOrder } from "../packages/agents/src/concierge";

export async function runReadingCase(client: ModelClient, model: string, c: { text: string; expect: "off_topic" | "not_off_topic" }) {
  const r = await extractOrder(client, model, { texts: [c.text], transcripts: [], state: {} });
  const got = r.intent ? (r.intent.intent === "off_topic" && r.intent.lines.length === 0 ? "off_topic" : "not_off_topic") : "unreadable";
  return { text: c.text, expect: c.expect, got, intent: r.intent?.intent ?? null, ok: got === c.expect };
}
