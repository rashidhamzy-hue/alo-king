// SIM1: from the run's results to docs/SIM_REPORT (markdown) and one failing-case file per failure class (evals/cases/sim_<class>.json).
// Failure classes are the hard checks code ran on every turn and the judge's findings; they are ranked by count times severity.
import { NOTE_CODES } from "./checks";
import { describeAction, transcriptOf } from "./judge";
import type { ConversationResult, RunSummary } from "./run";

export interface ClassRow { cls: string; source: "code" | "judge"; conversations: number; severity: number; score: number; examples: ConversationResult[] }

const JUDGE_CLASSES: [string, (r: ConversationResult) => boolean][] = [
  ["judge_goal_not_reached", (r) => !!r.verdict && !r.verdict.goal_reached],
  ["judge_wrong_product", (r) => !!r.verdict?.wrong_or_uninvited_product],
  ["judge_invented_fact", (r) => !!r.verdict?.invented_fact],
  ["judge_rating_or_health_word", (r) => !!r.verdict?.rating_praise_health],
  ["judge_dead_end", (r) => !!r.verdict?.dead_end],
  ["judge_repeated_question", (r) => !!r.verdict?.repeated_question],
  ["judge_unnatural_dialect", (r) => !!r.verdict && !r.verdict.natural_dialect],
];
export const OWNER: Record<string, string> = {
  no_reply: "ordering lane", silence_after_handoff: "hand-off", confirmed_without_tap: "ordering lane", card_total_mismatch: "ordering lane",
  invented_price: "ordering lane", turn_error: "ordering lane", sent_after_opt_out: "ordering lane", wrong_language: "message design",
  message_rules: "message design", judge_goal_not_reached: "ordering lane", judge_wrong_product: "ordering lane", judge_invented_fact: "ordering lane",
  judge_rating_or_health_word: "message design", judge_dead_end: "hand-off", judge_repeated_question: "ordering lane", judge_unnatural_dialect: "message design",
};

/** The hand-off reasons code writes are codes; the model's own (handoff_human) are free text, grouped here by what they are about. */
export function handoffGroup(reason: string): string {
  const head = reason.split(":")[0]!.trim();
  if (/^(agent_did_not_finish|model_turn_cap|model_capacity|plan_handoff|delivery_problem)$/.test(head)) return head;
  // HO1 (0135): a case's reason starts with its kind, which code chose.
  if (/^(person_requested|order_problem|complaint|refund|payment|safety|other)$/.test(head)) return `case: ${head}`;
  if (/^(agent_error|button_error|window_error|substitution_error)$/.test(head)) return `code error: ${head}`;
  const r = reason.toLowerCase();
  if (/refund|rembours|money back|مصاري|ترجع/.test(r)) return "model: refund asked";
  if (/halal|allerg|vegan|gluten|ingredient|egg|sesame|food fact|kitchen|merchant/.test(r)) return "model: food fact not on record";
  if (/cancel/.test(r)) return "model: cancel (no button or already confirmed)";
  if (/minimum/.test(r)) return "model: below the minimum order";
  if (/complain|late|spoiled|damaged|not good|was bad|upset|terrible/.test(r)) return "model: complaint";
  if (/person|human|team|shakhs|real|bot|فريق|شخص/.test(r)) return "model: asked for a person";
  return "model: other";
}
/** One line per cause for conversations that ended in an error (a request id or a date in the message does not split a cause). */
export const errorCause = (e: string | null): string => (e ?? "unknown").split("\n")[0]!.replace(/"request_id":"[^"]+"/, "").replace(/req_\w+/g, "").slice(0, 220);

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}
const PHONE = /\+?\d[\d\s-]{7,}\d/g;
/** No phone number reaches the report, whatever a message carried. */
export const scrub = (t: string) => t.replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 && !/^\d{4}-\d{2}-\d{2}$/.test(m) ? "[number]" : m));

export function classes(rs: ConversationResult[]): ClassRow[] {
  const rows = new Map<string, ClassRow>();
  const add = (cls: string, source: "code" | "judge", r: ConversationResult, sev: number) => {
    const row = rows.get(cls) ?? { cls, source, conversations: 0, severity: 0, score: 0, examples: [] };
    row.conversations++; row.severity += sev; row.examples.push(r);
    rows.set(cls, row);
  };
  for (const r of rs) {
    const codes = new Map<string, number>();
    for (const f of r.failures) if (!NOTE_CODES.has(f.code)) codes.set(f.code, Math.max(codes.get(f.code) ?? 0, f.severity));
    for (const [c, sev] of codes) add(c, "code", r, sev);
    for (const [c, test] of JUDGE_CLASSES) if (test(r)) add(c, "judge", r, r.verdict!.severity);
  }
  return [...rows.values()].map((x) => ({ ...x, severity: x.severity / x.conversations, score: x.conversations * (x.severity / x.conversations),
    examples: x.examples.sort((a, b) => a.turns.length - b.turns.length) })).sort((a, b) => b.score - a.score || a.cls.localeCompare(b.cls));
}

function table(head: string[], rows: (string | number)[][]): string {
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}
function groupRate(rs: ConversationResult[], key: (r: ConversationResult) => string): (string | number)[][] {
  const g = new Map<string, ConversationResult[]>();
  for (const r of rs) g.set(key(r), [...(g.get(key(r)) ?? []), r]);
  return [...g].sort((a, b) => a[0].localeCompare(b[0])).map(([k, xs]) => {
    const judged = xs.filter((r) => r.status === "judged");
    return [k, xs.length, judged.length, judged.filter((r) => r.passed).length, pct(judged.filter((r) => r.passed).length, judged.length)];
  });
}
function excerpt(r: ConversationResult, cls: string): string {
  const why = r.failures.filter((f) => f.code === cls).map((f) => `turn ${f.turn}: ${f.detail}`).slice(0, 2).join("; ")
    || (r.verdict ? `${r.verdict.summary} ${r.verdict.problems.length ? `(${r.verdict.problems.join("; ")})` : ""}` : "");
  const t = transcriptOf(r.turns).split("\n");
  const body = t.length > 36 ? [...t.slice(0, 34), `  ... (${t.length - 34} more lines)`] : t;
  return `**${r.id}** (seed ${r.seed}${r.attempt ? `, repeat ${r.attempt}` : ""}; ${r.category}/${r.variant}; ${r.lang}${r.voice ? ", voice" : ""}${r.burst ? ", burst" : ""}): ${scrub(why)}\n\n\`\`\`\n${scrub(body.join("\n"))}\n\`\`\``;
}

export interface ReportInput { summary: RunSummary; runUrl: string | null; commit: string | null; date: string }

export function buildReport(inp: ReportInput): { markdown: string; cases: Record<string, unknown> } {
  const { summary } = inp;
  const all = summary.results;
  const first = all.filter((r) => r.attempt === 0);
  const judged = first.filter((r) => r.status === "judged");
  const passed = judged.filter((r) => r.passed);
  const cls = classes(judged);
  const turns = first.flatMap((r) => r.turns.filter((t) => t.action.kind !== "done"));
  const modelTurns = turns.filter((t) => t.modelCalls > 0);
  const handed = first.filter((r) => (r.facts?.handoffs.length ?? 0) > 0);
  const reasons = new Map<string, number>();
  for (const r of handed) for (const h of new Set(r.facts!.handoffs.map(handoffGroup))) reasons.set(h, (reasons.get(h) ?? 0) + 1);
  const silenced = first.filter((r) => r.failures.some((f) => f.code === "silence_after_handoff"));
  const silentMsgs = first.reduce((s, r) => s + r.failures.filter((f) => f.code === "silence_after_handoff").length, 0);
  // Before HO1 a hand-off raised agent_handoff; after it, the case raises support_case (0135).
  const alerted = handed.filter((r) => (r.facts?.exceptions.agent_handoff ?? 0) + (r.facts?.exceptions.support_case ?? 0) > 0).length;
  const costs = first.map((r) => r.usd.total);
  const repeats = all.filter((r) => r.attempt > 0);
  const errors = new Map<string, number>();
  for (const r of all.filter((x) => x.status === "error")) errors.set(errorCause(r.error), (errors.get(errorCause(r.error)) ?? 0) + 1);
  const keyLimit = all.find((r) => /usage limits/.test(r.error ?? ""));
  const stopped = summary.stoppedBy ?? (keyLimit ? `the API key's own usage limit (HTTP 400: ${errorCause(keyLimit.error).replace(/^.*"message":"([^"]+)".*$/, "$1")})` : "nothing (every planned conversation ran)");

  const L: string[] = [];
  L.push(`# Simulated customers: failure report, ${inp.date}`, "");
  L.push(`Session SIM1. ${first.length} simulated customer conversations with the real Concierge (${summary.models.concierge}), each played by ${summary.models.customer} and judged by ${summary.models.judge}.`,
    `Run: ${inp.runUrl ?? "local"}${inp.commit ? `, code ${inp.commit.slice(0, 10)}` : ""}, ${summary.started} to ${summary.finished}. Database: PGlite with main's migrations and ${summary.source === "staging" ? "a read-only copy of staging's catalogue and settings" : "the repository seeds (no staging copy)"}.`,
    `Voice is tested at transcript level: a voice note is the customer's words turned by code into a noisy transcript in the shape Kapso returns; no audio is made or heard.`,
    `Kapso sends were recorded, never sent (${summary.guard.kapsoRecorded} recorded). Staging requests: ${summary.guard.stagingRequests.map((x) => `${x.method} ${x.count}`).join(", ") || "none"}; refused by the guard: ${summary.guard.refused.length}.`, "");
  L.push("## Totals", "");
  L.push(table(["", "value"], [
    ["conversations (first attempt)", first.length], ["judged", judged.length], ["passed", `${passed.length} (${pct(passed.length, judged.length)} of judged)`],
    ["not judged: budget stop / error / judge gave no verdict", `${first.filter((r) => r.status === "budget_stop").length} / ${first.filter((r) => r.status === "error").length} / ${first.filter((r) => r.status === "unjudged").length}`],
    ["repeat attempts (failing seeds)", repeats.length],
    ["conversations where a Concierge call failed at the API (429, 5xx: capacity, not the product)", first.filter((r) => r.conciergeApiErrors > 0).length],
    ["customer turns", turns.length], ["spend, total", usd(summary.spent)],
    ["spend: Concierge / customer / judge", `${usd(summary.byRole.concierge.usd)} / ${usd(summary.byRole.customer.usd)} / ${usd(summary.byRole.judge.usd)}`],
    ["model calls", summary.calls],
    [`calibration (first ${summary.calibration?.conversations ?? 0})`, summary.calibration ? `${usd(summary.calibration.usdPerConversation)} a conversation, projected ${usd(summary.calibration.projectedTotal)} for all` : "-"],
    ["stopped by", stopped],
  ]), "");
  if (errors.size) L.push(table(["conversations that ended in an error (all attempts), by cause", "count"], [...errors].sort((a, b) => b[1] - a[1]).map(([k, v]) => [scrub(k.replace(/\|/g, "/")), v])), "");
  L.push("A conversation **passes** when code found no hard failure on any turn and the judge found the goal reached with no wrong product, no invented fact, no rating or health word and no dead end.", "");
  if (summary.adjustments.length || summary.featuresDropped.length) {
    L.push("What the run changed in its own copy (never on staging):", "", ...summary.adjustments.map((a) => `- ${scrub(a)}`), ...summary.featuresDropped.map((f) => `- request feature dropped after the API refused it: ${f}`), "");
  }
  L.push("## Pass rate by scenario", "", table(["scenario", "run", "judged", "passed", "pass rate"], groupRate(first, (r) => `${r.category} / ${r.variant}`)), "");
  L.push(table(["category", "run", "judged", "passed", "pass rate"], groupRate(first, (r) => r.category)), "");
  L.push("## Pass rate by language", "", table(["language", "run", "judged", "passed", "pass rate"], groupRate(first, (r) => r.lang)), "");
  L.push(table(["form", "run", "judged", "passed", "pass rate"], groupRate(first, (r) => (r.voice ? "voice note" : r.burst ? "burst" : "typed"))), "");
  L.push("## Failure classes, ranked by count times severity", "",
    "Severity 3: the customer was harmed, stranded, or got a wrong product or wrong money; 2: friction; 1: a blemish. Code classes carry a fixed severity; judge classes the judge's.", "",
    table(["rank", "class", "found by", "conversations", "share of judged", "mean severity", "score", "owner"],
      cls.map((c, i) => [i + 1, c.cls, c.source, c.conversations, pct(c.conversations, judged.length), c.severity.toFixed(2), c.score.toFixed(1), OWNER[c.cls] ?? "ordering lane"])), "");
  for (const c of cls) {
    L.push(`### ${c.cls} (${c.conversations} conversations, severity ${c.severity.toFixed(2)})`, "");
    for (const r of c.examples.slice(0, 3)) L.push(excerpt(r, c.cls), "");
  }
  L.push("## Hand-offs and silence (baseline for the hand-off redesign)", "");
  L.push(table(["", "value"], [
    ["conversations with a hand-off", `${handed.length} (${pct(handed.length, first.length)})`],
    ["of those, an ops exception raised (agent_handoff before HO1, support_case after; ops alerted by the cron)", `${alerted}`],
    ["customers left in silence after a hand-off", `${silenced.length} (${pct(silenced.length, handed.length)} of hand-offs)`],
    ["follow-up messages that got no reply", silentMsgs],
  ]), "");
  L.push("Codes are written by code; \"model:\" reasons are the Concierge's own hand-off (handoff_human), grouped by what its free text is about.", "");
  L.push(table(["hand-off reason", "conversations", "share of all"], [...reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v, first.length)])), "");
  L.push("No person answers in a simulation. Before HO1 every message after a hand-off met the gateway's `human` outcome: stored, nothing sent. Since HO1 a hand-off opens a case and the bot keeps answering; a turn after it with no reply of any kind is counted here.", "");
  L.push("## Time per turn", "");
  L.push(table(["turns", "count", "median s", "95th s", "model calls per turn (mean)"], [
    ["all customer turns", turns.length, quantile(turns.map((t) => t.seconds), 0.5).toFixed(1), quantile(turns.map((t) => t.seconds), 0.95).toFixed(1), (turns.reduce((s, t) => s + t.modelCalls, 0) / (turns.length || 1)).toFixed(2)],
    ["turns that called the model", modelTurns.length, quantile(modelTurns.map((t) => t.seconds), 0.5).toFixed(1), quantile(modelTurns.map((t) => t.seconds), 0.95).toFixed(1), (modelTurns.reduce((s, t) => s + t.modelCalls, 0) / (modelTurns.length || 1)).toFixed(2)],
  ]), "", "Seconds are the turn's processing in the run (database in process, model over the network), from the burst's end to the last message out; the burst buffer's wait is not included.", "");
  L.push("## Cost", "");
  L.push(table(["", "value"], [
    ["per conversation, mean", usd(costs.reduce((a, b) => a + b, 0) / (costs.length || 1))], ["per conversation, median", usd(quantile(costs, 0.5))], ["per conversation, 95th", usd(quantile(costs, 0.95))],
    ["Concierge only, per conversation (mean)", usd(first.reduce((s, r) => s + r.usd.concierge, 0) / (first.length || 1))],
    ["total spend (every call, repeats included)", usd(summary.spent)],
  ]), "", "Every call is priced from its usage and the model_prices rows (0092, 0102), as agent_run_costs prices a turn.", "");
  const judgedRepeats = repeats.filter((r) => r.status === "judged");
  if (repeats.length && !judgedRepeats.length) {
    L.push("## How often a failure repeats", "", `Not measured: ${repeats.length} repeat attempts of ${new Set(repeats.map((r) => r.id)).size} failing seeds were started and none could run (${[...new Set(repeats.map((r) => errorCause(r.error)))].map(scrub).join("; ").slice(0, 300)}).`, "");
  } else if (repeats.length) {
    const seeds = [...new Set(repeats.map((r) => r.id))];
    const again = seeds.map((id) => { const xs = repeats.filter((r) => r.id === id && r.status === "judged"); return { id, runs: xs.length, failed: xs.filter((r) => !r.passed).length }; });
    const stable = again.filter((x) => x.runs && x.failed === x.runs).length, flaky = again.filter((x) => x.failed > 0 && x.failed < x.runs).length, never = again.filter((x) => x.runs && x.failed === 0).length;
    L.push("## How often a failure repeats", "", `Failing seeds run again: ${seeds.length}, ${repeats.length} attempts. Failed every repeat: ${stable}; some repeats: ${flaky}; passed every repeat: ${never}.`, "");
    const byClass = cls.map((c) => { const ids = new Set(c.examples.map((r) => r.id)); const rs = repeats.filter((r) => ids.has(r.id) && r.status === "judged");
      const hit = rs.filter((r) => classes([r]).some((x) => x.cls === c.cls)).length; return [c.cls, rs.length, hit, pct(hit, rs.length)]; });
    L.push(table(["class", "repeat attempts of its seeds", "class seen again", "repeat rate"], byClass), "");
  }
  L.push("## The ten fixes that matter most", "", "(written by the session from the classes above)", "");
  L.push("## Failing cases written", "", "Each class above is in `evals/cases/sim_<class>.json`: the customer's side of each failing conversation, what the shop sent, and what was wrong. Not fixed here.", "");

  const cases: Record<string, unknown> = {};
  for (const c of cls) {
    cases[`sim_${c.cls}`] = {
      about: `SIM1 (${inp.date}): simulated conversations where ${c.source === "code" ? "a code check" : "the judge"} found ${c.cls}. Failing on purpose: not fixed by SIM1. Owner: ${OWNER[c.cls] ?? "ordering lane"}. Invented customers, invented numbers.`,
      severity: Number(c.severity.toFixed(2)), owner: OWNER[c.cls] ?? "ordering lane",
      cases: c.examples.slice(0, 25).map((r) => ({
        id: `${r.id}${r.attempt ? `-r${r.attempt}` : ""}`, seed: r.seed, category: r.category, variant: r.variant, lang: r.lang, voice: r.voice, burst: r.burst, clock: r.clock,
        customer: r.turns.filter((t) => t.action.kind !== "done").map((t) => scrub(describeAction(t))),
        shop: r.turns.filter((t) => t.action.kind !== "done").map((t) => t.replies.map((m) => scrub(`${m.text}${m.options.length ? ` [${m.options.map((o) => o.title).join(" | ")}]` : ""}`))),
        found: c.source === "code" ? r.failures.filter((f) => f.code === c.cls).map((f) => ({ turn: f.turn, detail: scrub(f.detail) }))
                                   : { severity: r.verdict?.severity, problems: r.verdict?.problems, summary: r.verdict?.summary },
        expect: `no ${c.cls}`,
      })),
    };
  }
  return { markdown: L.join("\n"), cases };
}

