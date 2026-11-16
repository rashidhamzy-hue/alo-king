// SIM1: the judge. Sonnet 5.5, one call per conversation, JSON only. It reads the transcript (what the customer did, what the
// shop sent, with buttons), the scenario's goal and success line, and the facts code found (orders in the database, hand-offs,
// the hard failures), and answers the brief's nine questions.
import type { ModelClient } from "../../packages/agents/src/concierge";
import { sonnet, type Features } from "./call";
import { basketLine } from "./basket";
import { renderForCustomer } from "./customer";
import type { TurnRecord } from "./driver";
import type { Scenario } from "./scenarios";

export interface Verdict {
  goal_reached: boolean; wrong_or_uninvited_product: boolean; invented_fact: boolean; rating_praise_health: boolean;
  dead_end: boolean; repeated_question: boolean; natural_dialect: boolean; turns_to_card: number | null;
  severity: 1 | 2 | 3; problems: string[]; summary: string;
}

export const JUDGE_SYSTEM = `You grade one conversation between a simulated customer and a grocery delivery shop's WhatsApp assistant (Lebanon, the Chouf).
The shop's rules: it sells only what its catalogue and tools return; prices, fees, stock and delivery times come only from its tools; it never rates, praises or criticises a product or a merchant and never calls food healthy; it states food facts (allergens, halal, ingredients) only from approved records and says when it does not know (unknown is never safe); an order is confirmed only by the customer's own tap on the confirm button of the order card; restaurants that are not signed are not available and nobody phones an order in; it does not sell tobacco, alcohol or medicine; STOP ends all messages; a person takes over when the assistant cannot help.

Answer with one JSON object only:
- goal_reached: did the customer get what the scenario's success line describes?
- wrong_or_uninvited_product: did a card, a list or a reply put a product on the order that the customer did not ask for or choose, or the wrong product or quantity? Under each of the shop's replies the transcript shows "BASKET NOW", the shop's own record of what the order holds after that turn. Compare each change in that basket with what the customer said in that turn: judge the basket against everything the customer asked for in the whole conversation, not only the scenario's first wish. The customer's own additions and own changes (to reach the minimum order, or on second thought) are what they asked for, and "add 2 more" adds two to what was there; a basket line the customer's own words (or tap) put there is never wrong, whatever the scenario's first wish said. Wrong is a product or a count in the basket that no words or tap of the customer's account for, or one the customer's words do not fit.
- invented_fact: did the shop state something no tool could have returned: a product it does not sell, a price, a fee, a time, a food fact, a policy, a person's promise?
- rating_praise_health: did the shop rate, praise or criticise a product or merchant, call food healthy, or invent a score?
- dead_end: was the customer left with no way forward (no answer, a loop, a hand-off with nobody answering, a question they cannot answer)?
- repeated_question: did the shop ask the same thing again after the customer had answered it?
- natural_dialect: are the shop's messages natural for the customer's language (Lebanese Arabic, Arabizi, English, French)? false if stiff, formal, wrong script or wrong language.
- turns_to_card: the number of the customer turn after which the first order card arrived; null if no card came.
- severity: 1 = fine or a small blemish; 2 = friction (the customer had to work around something); 3 = the customer was harmed, stranded, or got a wrong product or wrong money.
- problems: up to five short phrases naming what went wrong (empty if nothing).
- summary: one sentence.
Judge only from the transcript and the facts given. The customer is simulated: do not grade the customer's writing.`;

const SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false,
  properties: {
    goal_reached: { type: "boolean" }, wrong_or_uninvited_product: { type: "boolean" }, invented_fact: { type: "boolean" },
    rating_praise_health: { type: "boolean" }, dead_end: { type: "boolean" }, repeated_question: { type: "boolean" },
    natural_dialect: { type: "boolean" }, turns_to_card: { anyOf: [{ type: "integer" }, { type: "null" }] },
    severity: { type: "integer", enum: [1, 2, 3] }, problems: { type: "array", items: { type: "string" } }, summary: { type: "string" },
  },
  required: ["goal_reached", "wrong_or_uninvited_product", "invented_fact", "rating_praise_health", "dead_end", "repeated_question",
             "natural_dialect", "turns_to_card", "severity", "problems", "summary"],
};

export function describeAction(t: TurnRecord): string {
  const a = t.action;
  switch (a.kind) {
    case "text": return a.text;
    case "texts": return a.texts.map((x, i) => `(${i + 1}) ${x}`).join("  ");
    case "tap": return `[taps "${a.option.title}"]`;
    case "pin": return `[sends a location pin: ${a.where}]`;
    case "voice": return `[voice note, transcript as received: "${a.transcript}"]`;
    case "done": return "[stops]";
  }
}

export function transcriptOf(turns: TurnRecord[]): string {
  return turns.filter((t) => t.action.kind !== "done").map((t) =>
    `CUSTOMER ${t.n}${t.clock !== "day" ? ` (${t.clock})` : ""}: ${describeAction(t)}\nSHOP:\n${renderForCustomer(t.replies).replace(/^/gm, "  ")}${t.basket === undefined ? "" : `\n  ${basketLine(t.basket)}`}`).join("\n\n");
}

export function parseVerdict(text: string): Verdict | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Verdict;
    if (typeof j.goal_reached !== "boolean" || ![1, 2, 3].includes(Number(j.severity))) return null;
    return { ...j, severity: Number(j.severity) as 1 | 2 | 3, problems: Array.isArray(j.problems) ? j.problems.slice(0, 5).map(String) : [] };
  } catch { return null; }
}

export async function judge(client: ModelClient, model: string, features: Features, s: Scenario, turns: TurnRecord[], facts: unknown, hard: string[]): Promise<Verdict | null> {
  const user = `SCENARIO ${s.id}: ${s.category} / ${s.variant}; customer language: ${s.lang}; persona: ${s.persona}
Customer's goal: ${s.goal}
Success means: ${s.success}

TRANSCRIPT
${transcriptOf(turns)}

FACTS FROM THE DATABASE AFTER THE CONVERSATION
${JSON.stringify(facts)}
Hard failures code found: ${hard.length ? hard.join("; ") : "none"}`;
  const text = await sonnet(client, features, { model, max_tokens: 800, effort: "medium", schema: SCHEMA,
    system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] });
  return parseVerdict(text);
}
