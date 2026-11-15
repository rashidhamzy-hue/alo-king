// B1b: the four classes its "done when" names (SIM1 fixes 5, 6, 7 and 8), read by code from what a run recorded, so a run on main can
// be set against SIM1's baseline (docs/SIM_REPORT_2026-11-15.md) on the same definitions. Each reads only replies, paths and code failures.
//  - address (fix 5): the pin asked for again after the customer said they cannot send one or gave the address in words; the "which
//    village?" buttons when the customer had already named one of the villages offered, or asked twice; or "a first order needs a pin". (A pin request repeated after an item was added, and a pin outside
//    the area asked again after the pin, are the basket waiting and the refusal, and are not counted.)
//  - language (fix 6): a reply the code check calls another language (wrongLanguage of checks.ts), recomputed from the recorded replies.
//  - message rules (fix 7): the code check message_rules on any turn.
//  - off-topic (fix 8): the off-topic line in a conversation that is not an off-topic scenario.
// SIM1's first run, first 150 scenarios: 8, 14, 70, 16; all 463 judged first attempts: 28, 51, 246, 55 (language with the corrected
// check; the run's own wrong_language code counted 21 and 69).
import type { ConversationResult } from "./run";
import { CANNOT_PIN } from "../../packages/agents/src/pipeline";
import { wrongLanguage } from "./checks";
import type { Lang } from "./scenarios";

export interface B1bMeasures { address: boolean; language: boolean; messageRules: boolean; offTopic: boolean }

const FIRST_ORDER_PIN = /لأول طلب|first order|première commande/i;

/** The customer's words say they cannot send a pin, or give the address in words (a building, a floor, a quarter, a landmark). */
const NO_PIN_WORDS = new RegExp(`${CANNOT_PIN.source}|بناي|البنايه|البناية|طابق|الطابق|حارة|حاره|حي |حد ال|قرب|جنب|binaye|bineye|binaya|binen|building|tabe2|taba2|floor|7ay |7ara|janb|near|immeuble|étage|etage|quartier|près`, "iu");
/**
 * A pin request, then a customer turn that answered it in words (or said they cannot send one), then another pin request: the customer
 * was asked for the pin again instead of the address being taken. A pin request after an item was added is the basket still waiting.
 */
function pinAskedAgain(r: ConversationResult): boolean {
  let asked = false, inWords = false;
  for (const t of r.turns) {
    const a = t.action as { kind?: string; text?: string; texts?: string[] } | undefined;
    if (a?.kind === "pin") { asked = false; inWords = false; }
    const said = [a?.text, ...(a?.texts ?? [])].filter(Boolean).join(" ");
    const words = asked && a?.kind !== "pin" && a?.kind !== "tap" && NO_PIN_WORDS.test(said);
    if (t.replies.some((m) => m.kind === "location_request")) {
      if (asked && (words || inWords)) return true;
      asked = true;
    }
    if (words) inWords = true;
  }
  return false;
}

/** Letters only, one spelling of alef and ta marbuta, for finding a village's name in the customer's words. */
const foldName = (x: string) => x.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[^\p{L}\d ]+/gu, " ").replace(/\s+/g, " ").trim();
/**
 * "Which village is your pin in?" asked when it need not be: one of the villages offered was already in the customer's own words, or the
 * question came twice. Asked once, with no village said, it is the one short question the coordinator's decision allows.
 */
function villageAskedNeedlessly(r: ConversationResult): boolean {
  let asked = 0; const said: string[] = [];
  for (const t of r.turns) {
    const a = t.action as { text?: string; texts?: string[]; transcript?: string; kind?: string } | undefined;
    said.push(...[a?.text, a?.transcript, ...(a?.texts ?? [])].filter((x): x is string => !!x).map(foldName));
    for (const m of t.replies) {
      const villages = m.options.filter((o) => /^pinvillage:/.test(o.id)).map((o) => foldName(o.title));
      if (!villages.length) continue;
      if (++asked > 1) return true;
      if (villages.some((v) => v.length >= 3 && said.some((w) => ` ${w} `.includes(` ${v} `) || ` ${w} `.includes(` ل${v} `) || ` ${w} `.includes(` ع${v} `) || ` ${w} `.includes(` ب${v} `)))) return true;
    }
  }
  return false;
}

export function b1bMeasures(r: ConversationResult): B1bMeasures {
  const replies = r.turns.flatMap((t) => t.replies);
  const code = (c: string) => r.failures.some((f) => f.code === c) || r.turns.some((t) => (t.failures ?? []).some((f) => f.code === c));
  return {
    address: pinAskedAgain(r) || villageAskedNeedlessly(r) || replies.some((m) => FIRST_ORDER_PIN.test(m.text)),
    // Recomputed from the replies with this tree's check (checks.ts), so SIM1's recorded replies are judged by the same code.
    language: r.lang !== "mixed" && replies.some((m) => !!wrongLanguage(r.lang as Lang, m.text)),
    messageRules: code("message_rules"),
    offTopic: r.category !== "off_topic" && r.turns.some((t) => t.path === "off_topic"),
  };
}

/** SIM1's counts on the same definitions (first attempts of run 43696512658). */
export const SIM1_B1B_BASELINE = { first150: { conversations: 150, address: 8, language: 14, messageRules: 70, offTopic: 16 },
                                   all: { conversations: 463, address: 28, language: 51, messageRules: 246, offTopic: 55 } } as const;

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
