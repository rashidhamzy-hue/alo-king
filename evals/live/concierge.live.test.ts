// Live eval: the real model on the neutrality and food-facts wording cases and the off-topic reading cases. Skipped unless asked for:
//   ALO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... MODEL=claude-haiku-5-5 npx vitest run evals/live
// Prints one line per case. A case passes when the first reply the model tries gets through the output guard
// (a refusal followed by a good rewording is reported, not failed). `must` / `must_not` are graded by a person from the report.
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { runAddressCase, runReadingCase, runWordingCase, type AddressCase, type WordingCase } from "../run";
import address from "../cases/address_readings.json";
import neutral from "../cases/neutral_and_food_facts.json";
import offTopic from "../cases/off_topic.json";

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

describe.skipIf(!live)("live: stay on the job (1.18)", () => {
  const client = live ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! }) : null;
  const model = env.MODEL ?? "claude-haiku-5-5";
  it.each(offTopic.cases.map((c) => [c.text, c] as const))("%s", async (_t, c) => {
    const r = await runReadingCase(client!, model, c as { text: string; expect: "off_topic" | "not_off_topic" });
    console.log(JSON.stringify(r));
    expect(r.got).toBe(c.expect);
  }, 60_000);
});

describe.skipIf(!live)("live: where to deliver (B4, the founder's order of 13 Nov)", () => {
  const client = live ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! }) : null;
  const model = env.MODEL ?? "claude-haiku-5-5";
  it.each((address.cases as AddressCase[]).map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const r = await runAddressCase(client!, model, c);
    console.log(JSON.stringify(r));
    expect(r.ok, r.why ?? "").toBe(true);
  }, 60_000);
});
