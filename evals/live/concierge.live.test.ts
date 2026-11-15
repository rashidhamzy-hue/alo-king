// Live eval: the real model on the neutrality and food-facts wording cases and the off-topic reading cases. Skipped unless asked for:
//   ALO_LIVE_EVAL=1 ANTHROPIC_API_KEY=... MODEL=claude-haiku-5-5 npx vitest run evals/live
// Prints one line per case. A case passes when the first reply the model tries gets through the output guard; the two-sentence
// rule alone is judged on the reply that went out (founder decision, M1: wordingPasses in ../run.ts). `must` / `must_not` are
// graded by a person from the report.
import { afterAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { replyPasses, runAddressCase, runGoAheadCase, runLiveReplyCase, runReadingCase, runWordingCase, wordingPasses, type AddressCase, type GoAheadCase, type WordingCase } from "../run";
import noReply from "../cases/no_reply.json";
import askByCode from "../cases/ask_by_code.json";
import address from "../cases/address_readings.json";
import neutral from "../cases/neutral_and_food_facts.json";
import offTopic from "../cases/off_topic.json";
import { startMeter, finishMeter } from "../../scripts/lib/model-cost.mjs";

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});
const live = env.ALO_LIVE_EVAL === "1" && !!env.ANTHROPIC_API_KEY;

// COST1: the run is counted in model_costs and stops at its dollar cap (MODEL_COST_CAP_USD). The meter wraps fetch, and each client below
// takes the wrapped fetch when it is built, so the meter starts here, before any describe block. No prices, no run (fail closed).
const meter = live ? await startMeter({ workflow: "language-pack", capDefault: 5, step: "live" }) : null;
afterAll(async () => { if (meter) await finishMeter(meter); });

describe.skipIf(!live)("live: Concierge wording", () => {
  const client = live ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! }) : null;
  const model = env.MODEL ?? "claude-haiku-5-5";
  it.each(neutral.cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const r = await runWordingCase(client!, model, c as WordingCase);
    console.log(JSON.stringify(r));
    const v = wordingPasses(r, c as WordingCase);
    expect(v.ok, `${v.why} ${JSON.stringify(r.attempts)}`).toBe(true);
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

describe.skipIf(!live)("live: go ahead with the waiting basket (SP1, 14 Nov «مشيلي الطلب»)", () => {
  const client = live ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! }) : null;
  const model = env.MODEL ?? "claude-haiku-5-5";
  it.each((askByCode.cases as GoAheadCase[]).map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const r = await runGoAheadCase(client!, model, c);
    console.log(JSON.stringify(r));
    expect(r.ok, r.why ?? "").toBe(true);
  }, 60_000);
});

describe.skipIf(!live)("live: every turn ends in a reply (SP2)", () => {
  const client = live ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY! }) : null;
  const model = env.MODEL ?? "claude-haiku-5-5";
  it.each(noReply.live.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const r = await runLiveReplyCase(client!, model, c);
    console.log(JSON.stringify({ ...r, bodies: undefined }));
    const v = replyPasses(r);
    expect(v.ok, `${v.why} ${JSON.stringify(r.steps)}`).toBe(true);
  }, 90_000);
});
