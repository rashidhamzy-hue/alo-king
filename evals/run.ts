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
import { REPLY_RULE } from "../packages/agents/src/messages";

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
    resolve_place: none, quote_order: none, ask_location_pin: speak("ask_location_pin"), send_confirmation: none, show_catalog: none,
    food_facts: async () => ({ products: [], facts: c.facts, approved_attributes: [...approved] }),
    reply: speak("reply"),
    handoff_human: async () => { out.handoff = true; return { ok: true }; },
  };
  // The ask loop's input as turn.ts sends it, with M1's length rule.
  const ask = { texts: [c.customer], transcripts: [], state: { facts_from_tools: c.facts }, reading: null, plan: null, reply_rule: REPLY_RULE };
  await runAskLoop(client, model, ask, tools);
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

/** B4: where to deliver, as the model reads it. `village`: accepted spellings (null: must stay empty); `not_village`: never the village. */
export interface AddressCase { id: string; texts?: string[]; transcripts?: string[]; state?: Record<string, unknown>; village: string[] | null; not_village?: string[] }
export function judgeAddress(c: AddressCase, village: string | null): { ok: boolean; why: string | null } {
  const fold = (x: string) => x.toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "").replace(/^(ال|al |el )/, "").trim();
  const v = village ? fold(village) : null;
  if (v && (c.not_village ?? []).some((n) => v.includes(fold(n)) || fold(n).includes(v))) return { ok: false, why: `neighbourhood read as village: ${village}` };
  if (c.village === null) return v ? { ok: false, why: `village should be empty, got ${village}` } : { ok: true, why: null };
  if (!v) return { ok: false, why: "village left out" };
  return c.village.some((w) => v.includes(fold(w)) || fold(w).includes(v)) ? { ok: true, why: null } : { ok: false, why: `wrong village ${village}` };
}
export async function runAddressCase(client: ModelClient, model: string, c: AddressCase) {
  const r = await extractOrder(client, model, { texts: c.texts ?? [], transcripts: (c.transcripts ?? []).map((primary) => ({ primary })), state: c.state ?? {} });
  const village = r.intent?.address.village ?? null;
  return { id: c.id, village, landmark: r.intent?.address.landmark ?? null, ...judgeAddress(c, village) };
}

// ---------- Ask by code (SP1) ----------
// "Go ahead" with a basket waiting: the reading must name no new line and be about ordering, so code carries the basket on
// (pipeline.ts isGoAhead) instead of a second model call. `go_ahead: false` cases must not be read that way.
import { isGoAhead } from "../packages/agents/src/pipeline";
import type { OrderIntent } from "../packages/agents/src/schemas";
/** basket_lines: the reading may instead name the waiting basket's lines again; the planner then cards them, also with no second call. */
export interface GoAheadCase { id: string; texts: string[]; state?: Record<string, unknown>; go_ahead: boolean; basket_lines?: number }
export function judgeGoAhead(c: GoAheadCase, intent: OrderIntent | null): { ok: boolean; why: string | null } {
  const got = isGoAhead(intent, c.texts.join("\n"));
  if (got === c.go_ahead) return { ok: true, why: null };
  if (c.go_ahead && c.basket_lines && intent?.intent === "order" && intent.lines.length === c.basket_lines) return { ok: true, why: null };
  return { ok: false, why: intent ? `read as ${intent.intent} with ${intent.lines.length} line(s)` : "unreadable" };
}
export async function runGoAheadCase(client: ModelClient, model: string, c: GoAheadCase) {
  const r = await extractOrder(client, model, { texts: c.texts, transcripts: [], state: c.state ?? {} });
  return { id: c.id, intent: r.intent?.intent ?? null, lines: r.intent?.lines.length ?? null, ...judgeGoAhead(c, r.intent) };
}
