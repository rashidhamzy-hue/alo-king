// B1b: the four classes its "done when" names (SIM1 fixes 5, 6, 7 and 8), read by code from what a run recorded, so a run on main can
// be set against SIM1's baseline (docs/SIM_REPORT_2026-11-15.md) on the same definitions. Each reads only replies, paths and code failures.
//  - address (fix 5): the pin asked for again after the customer answered without one; the "which village?" buttons after a pin;
//    or "a first order needs a pin". (A pin outside the area, refused, and asked again after a pin, is not counted.)
//  - language (fix 6): a reply the code check calls another language (wrongLanguage of checks.ts), recomputed from the recorded replies.
//  - message rules (fix 7): the code check message_rules on any turn.
//  - off-topic (fix 8): the off-topic line in a conversation that is not an off-topic scenario.
// SIM1's first run, first 150 scenarios: 11, 16, 70, 16; all 463 judged first attempts: 46, 56, 246, 55 (language with the corrected check;
// the run's own wrong_language code counted 21 and 69).
import type { ConversationResult } from "./run";
import { wrongLanguage } from "./checks";
import type { Lang } from "./scenarios";

export interface B1bMeasures { address: boolean; language: boolean; messageRules: boolean; offTopic: boolean }

const FIRST_ORDER_PIN = /لأول طلب|first order|première commande/i;

/** A pin request, then a customer turn that was not a pin, then another pin request. */
function pinAskedAgain(r: ConversationResult): boolean {
  let asked = false;
  for (const t of r.turns) {
    const pin = (t.action as { kind?: string } | undefined)?.kind === "pin";
    if (pin) asked = false;
    if (t.replies.some((m) => m.kind === "location_request")) {
      if (asked && !pin) return true;
      asked = true;
    }
  }
  return false;
}

export function b1bMeasures(r: ConversationResult): B1bMeasures {
  const replies = r.turns.flatMap((t) => t.replies);
  const code = (c: string) => r.failures.some((f) => f.code === c) || r.turns.some((t) => (t.failures ?? []).some((f) => f.code === c));
  return {
    address: pinAskedAgain(r) || replies.some((m) => m.options.some((o) => /^pinvillage:/.test(o.id))) || replies.some((m) => FIRST_ORDER_PIN.test(m.text)),
    // Recomputed from the replies with this tree's check (checks.ts), so SIM1's recorded replies are judged by the same code.
    language: r.lang !== "mixed" && replies.some((m) => !!wrongLanguage(r.lang as Lang, m.text)),
    messageRules: code("message_rules"),
    offTopic: r.category !== "off_topic" && r.turns.some((t) => t.path === "off_topic"),
  };
}

/** SIM1's counts on the same definitions (first attempts of run 43696512658). */
export const SIM1_B1B_BASELINE = { first150: { conversations: 150, address: 11, language: 16, messageRules: 70, offTopic: 16 },
                                   all: { conversations: 463, address: 46, language: 56, messageRules: 246, offTopic: 55 } } as const;

/** The section of the report: each class now, SIM1's rate on the same scenarios, the change, and B1b's target (down 80%). */
export function b1bSection(judged: ConversationResult[]): string[] {
  const n = judged.length;
  if (!n) return [];
  const m = judged.map(b1bMeasures);
  const count = (k: keyof B1bMeasures) => m.filter((x) => x[k]).length;
  const onlyFirst150 = judged.every((r) => Number(r.id.slice(4)) <= 150);
  const base = onlyFirst150 && n === 150 ? SIM1_B1B_BASELINE.first150 : SIM1_B1B_BASELINE.all;
  const row = (label: string, k: keyof B1bMeasures) => {
    const now = count(k) / n, was = base[k] / base.conversations;
    const change = was ? (now - was) / was : 0;
    return `| ${label} | ${count(k)} (${(100 * now).toFixed(1)}%) | ${base[k]} of ${base.conversations} (${(100 * was).toFixed(1)}%) | ${was ? `${(100 * change).toFixed(0)}%` : "-"} | ${change <= -0.8 ? "met" : "not met"} |`;
  };
  return ["## Address, language, message rules, off-topic (B1b measures)", "",
    `Definitions in \`evals/sim/b1b-measures.ts\`. Baseline: SIM1's first run, ${base === SIM1_B1B_BASELINE.first150 ? "the same first 150 scenarios" : "all judged first attempts"}. Target: down at least 80%.`, "",
    "| class | this run | SIM1 | change in rate | target |", "| --- | --- | --- | --- | --- |",
    row("address: pin asked again, village buttons, «first order needs a pin» (fix 5)", "address"),
    row("reply in another language (fix 6)", "language"),
    row("message rules (fix 7)", "messageRules"),
    row("off-topic line outside the off-topic scenarios (fix 8)", "offTopic"), ""];
}
