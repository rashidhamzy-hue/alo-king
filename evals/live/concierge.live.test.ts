// Live wording eval: the real model on the neutrality, food-facts and off-topic cases. Skipped unless asked for:
//   ALO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... MODEL=claude-haiku-5-5 npx vitest run evals/live
// Prints one line per case. A case passes when the first reply the model tries gets through the output guard
// (a refusal followed by a good rewording is reported, not failed). `must` / `must_not` are graded by a person from the report.
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { runWordingCase, type WordingCase } from "../run";
import neutral from "../cases/neutral_and_food_facts.json";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const live = env.ALO_LIVE_EVAL === "1" && !!env.ANTHROPIC_API_KEY;

describe.skipIf(!live)("live: Concierge wording", () => {
  const client = live ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! }) : null;
  const model = env.MODEL ?? "claude-haiku-5-5";
  it.each(neutral.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const r = await runWordingCase(client!, model, c as WordingCase);
    console.log(JSON.stringify(r));
    expect(r.attempts[0]?.refused ?? null, JSON.stringify(r.attempts)).toBeNull();
  }, 60_000);
});
