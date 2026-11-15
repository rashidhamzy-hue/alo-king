// SIM1 follow-up: the ten fixes of docs/SIM_REPORT_2026-11-15.md as tests on a conversation's result, so a failing conversation can
// be counted under the fix that would have saved it, and the follow-up's 100 repeated seeds drawn in proportion to them.
// Each test reads only what the run recorded (replies, paths, code failures, the judge's flags). A conversation can match several.
import { hash, rng, shuffle } from "./rng";
import type { ConversationResult } from "./run";

export interface Fix { id: string; title: string; test: (r: ConversationResult) => boolean }

const replies = (r: ConversationResult) => r.turns.flatMap((t) => t.replies);
const said = (r: ConversationResult, re: RegExp) => replies(r).some((m) => re.test(m.text));
const code = (r: ConversationResult, c: string) => r.failures.some((f) => f.code === c);

export const FIXES: Fix[] = [
  { id: "minimum_order", title: "1. the minimum order said by code, with its amount",
    test: (r) => said(r, /الحد الأدنى|minimum|minimal|7ad el adna|7add el adna|montant minimum/i) },
  { id: "handoff_silence", title: "2. no silence after a hand-off", test: (r) => code(r, "silence_after_handoff") },
  { id: "lost_basket", title: "3. the basket kept while it is built",
    test: (r) => said(r, /ما عندك طلب مفتوح|no open order|pas de commande en cours|aucune commande/i) || !!r.verdict?.repeated_question },
  { id: "basket_changes", title: "4. the basket changes only by what the customer picked", test: (r) => !!r.verdict?.wrong_or_uninvited_product },
  { id: "first_order_pin", title: "5. a first order without a map pin",
    test: (r) => r.category === "address" || replies(r).some((m) => m.options.some((o) => /^pinvillage:/.test(o.id))) || said(r, /لأول طلب|first order|première commande/i) },
  { id: "language", title: "6. replies in the customer's language", test: (r) => code(r, "wrong_language") || (!!r.verdict && !r.verdict.natural_dialect) },
  { id: "message_rules", title: "7. line length and Latin digits in model text", test: (r) => code(r, "message_rules") },
  { id: "greeting_off_topic", title: "8. greetings and thanks are not off-topic", test: (r) => r.category !== "off_topic" && r.turns.some((t) => t.path === "off_topic") },
  { id: "refused_cancel", title: "9. a refused cancel gets a fixed answer",
    test: (r) => r.failures.some((f) => f.code === "turn_error" && /ILLEGAL_TRANSITION/.test(f.detail)) || (r.category === "cancel" && r.variant !== "before_confirm") },
  { id: "catalogue_claim", title: "10. no catalogue claim without a tool result", test: (r) => !!r.verdict?.invented_fact },
];

export const fixesOf = (r: ConversationResult): string[] => FIXES.filter((f) => f.test(r)).map((f) => f.id);

/** Largest-remainder shares of `n` in proportion to `counts` (a fix with no conversation gets nothing). */
export function apportion(counts: Record<string, number>, n: number): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return Object.fromEntries(Object.keys(counts).map((k) => [k, 0]));
  const raw = Object.entries(counts).map(([k, c]) => ({ k, exact: (c * n) / total }));
  const out = Object.fromEntries(raw.map((x) => [x.k, Math.floor(x.exact)]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const x of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.k.localeCompare(b.k))) { if (left <= 0) break; out[x.k]!++; left--; }
  return out;
}

export interface FollowUpPick { id: string; seed: number; fix: string; fixes: string[] }
/**
 * `n` failing first attempts, in proportion to how many failing conversations each fix covers. Each fix draws, seeded, from the
 * failing conversations it covers that no earlier fix took; a fix that runs short passes its rest to the next draw. Deterministic.
 */
export function pickFollowUp(results: ConversationResult[], n: number, seed: number): { counts: Record<string, number>; quota: Record<string, number>; picked: FollowUpPick[] } {
  const failing = results.filter((r) => r.attempt === 0 && r.status === "judged" && !r.passed).sort((a, b) => a.id.localeCompare(b.id));
  const tags = new Map(failing.map((r) => [r.id, fixesOf(r)]));
  const counts = Object.fromEntries(FIXES.map((f) => [f.id, failing.filter((r) => tags.get(r.id)!.includes(f.id)).length]));
  const quota = apportion(counts, n);
  const taken = new Set<string>();
  const picked: FollowUpPick[] = [];
  let carry = 0;
  for (const f of [...FIXES].sort((a, b) => counts[b.id]! - counts[a.id]! || a.id.localeCompare(b.id))) {
    const want = quota[f.id]! + carry;
    const pool = shuffle(rng(seed ^ hash(f.id)), failing.filter((r) => tags.get(r.id)!.includes(f.id) && !taken.has(r.id)));
    const got = pool.slice(0, want);
    for (const r of got) { taken.add(r.id); picked.push({ id: r.id, seed: r.seed, fix: f.id, fixes: tags.get(r.id)! }); }
    carry = want - got.length;
  }
  return { counts, quota, picked: picked.sort((a, b) => a.id.localeCompare(b.id)) };
}
